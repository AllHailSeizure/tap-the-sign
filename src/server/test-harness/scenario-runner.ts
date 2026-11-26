import type { Hono } from 'hono';
import { Context, runWithContext } from '@devvit/web/server';
import type { MenuItemRequest, TriggerResponse, UiResponse, T1, T3 } from '@devvit/web/shared';
import type { DevvitFixtures } from '@devvit/test/server/vitest';
import { recordEndpointHit } from './coverage';
import { cronMatches } from './cron';
import { schedulerTasks, type DevvitConfig } from './devvit-config';
import { EventFactory } from './events';
import { FakeClock, parseDuration } from './fake-clock';
import type { FakeHttp } from './fake-http';
import type {
  FakeCommentRecord,
  FakePostRecord,
  FakeRedditWorld,
  FlairRecord,
  ModmailConversation,
  SeedPostOptions,
  WorldAction,
} from './fake-reddit-world';

export interface RunnerOptions {
  world?: FakeRedditWorld;
  config?: DevvitConfig;
  headers?: DevvitFixtures['headers'];
  mocks?: DevvitFixtures['mocks'];
  clock?: FakeClock;
  http?: FakeHttp;
}

export interface RequestOptions {
  /** Run the request as this user (sets context.username / userId). */
  as?: string;
  postId?: string;
  commentId?: string;
}

export interface RouteResult<T = unknown> {
  status: number;
  body: T;
}

/** Devvit trigger name → the EventFactory payload builder. */
type TriggerName =
  | 'onPostSubmit'
  | 'onPostCreate'
  | 'onPostUpdate'
  | 'onPostFlairUpdate'
  | 'onPostReport'
  | 'onPostDelete'
  | 'onCommentCreate'
  | 'onCommentSubmit'
  | 'onCommentUpdate'
  | 'onCommentReport'
  | 'onCommentDelete'
  | 'onModAction'
  | 'onModMail'
  | 'onAppInstall'
  | 'onAppUpgrade';

/**
 * Drives an app's Hono routes in-process inside the `@devvit/test` world: no HTTP
 * listener, no Reddit login. Low-level calls (`trigger`, `menu`, `form`,
 * `postJson`) hit a route directly. High-level calls (`userPosts`, `userComments`,
 * `report`, `modRemoves`, `advance`, ...) change FakeRedditWorld and then fire
 * whichever triggers or scheduler tasks the app declares in devvit.json, the way
 * Reddit would.
 */
export class ScenarioRunner {
  readonly world?: FakeRedditWorld;
  readonly events?: EventFactory;
  readonly clock: FakeClock;
  private readonly config: DevvitConfig;
  private readonly firedJobs = new Set<string>();

  constructor(
    private readonly app: Hono,
    private readonly opts: RunnerOptions = {},
    private readonly actingAs?: string
  ) {
    this.world = opts.world;
    this.events = opts.world ? new EventFactory(opts.world) : undefined;
    this.config = opts.config ?? {};
    this.clock = opts.clock ?? new FakeClock();
  }

  /** A runner whose requests run as `username` (menu clicks, form submits). */
  as(username: string): ScenarioRunner {
    return new ScenarioRunner(this.app, this.opts, username);
  }

  // ─── Low level ────────────────────────────────────────────────────────────

  async request<T = unknown>(
    path: string,
    payload: unknown,
    opts: RequestOptions = {}
  ): Promise<RouteResult<T>> {
    const as = opts.as ?? this.actingAs;
    const headers: Record<string, string | string[] | undefined> = { ...(this.opts.headers ?? {}) };
    if (as) {
      const user = this.world?.user(as);
      headers['devvit-user'] = user?.id ?? `t2_${as}`;
      headers['devvit-user-name'] = user?.username ?? as;
    }
    if (opts.postId) headers['devvit-post'] = opts.postId;
    if (opts.commentId) headers['devvit-comment'] = opts.commentId;
    const run = async () =>
      this.app.fetch(
        new Request(`http://localhost${path}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload ?? {}),
        })
      );
    const res = this.opts.headers ? await runWithContext(Context(headers), run) : await run();
    if (res.status !== 404) recordEndpointHit(path);
    const text = await res.text();
    let body: unknown = text;
    try {
      body = text ? JSON.parse(text) : undefined;
    } catch {
      // non-JSON body
    }
    return { status: res.status, body: body as T };
  }

  async postJson<TResponse = unknown>(
    path: string,
    payload: unknown,
    opts: RequestOptions = {}
  ): Promise<TResponse> {
    const res = await this.request<TResponse>(path, payload, opts);
    if (res.status < 200 || res.status >= 300) {
      throw new Error(`Route ${path} failed with HTTP ${res.status}: ${JSON.stringify(res.body)}`);
    }
    return res.body;
  }

  trigger(slug: string, event: unknown): Promise<TriggerResponse> {
    return this.postJson<TriggerResponse>(
      slug.startsWith('/') ? slug : `/internal/triggers/${slug}`,
      event
    );
  }

  /**
   * Click a menu item. `slug` is the path after /internal/menu/ or a full path.
   * When the runner acts as a specific user (`runner.as(name)`), moderator-only
   * items throw for non-moderators, as Reddit would not show them.
   */
  async menu(
    slug: string,
    request: MenuItemRequest | { targetId: string; location: string },
    opts: RequestOptions = {}
  ): Promise<UiResponse> {
    const path = slug.startsWith('/') ? slug : `/internal/menu/${slug}`;
    const as = opts.as ?? this.actingAs;
    const item = this.config.menu?.items?.find((i) => i.endpoint === path);
    if (as && item?.forUserType === 'moderator' && this.world && !this.world.isModerator(as)) {
      throw new Error(`Menu ${path} is moderator-only; ${as} would not see it`);
    }
    const ctx: RequestOptions = { ...opts };
    if (request.location === 'post') ctx.postId = request.targetId;
    if (request.location === 'comment') {
      ctx.commentId = request.targetId;
      ctx.postId = this.world?.comment(request.targetId)?.postId;
    }
    return this.postJson<UiResponse>(path, request, ctx);
  }

  /** Submit a form. `name` is a devvit.json `forms` key, a slug under /internal/forms/, or a full path. */
  async form(name: string, values: unknown, opts: RequestOptions = {}): Promise<UiResponse> {
    const path = name.startsWith('/')
      ? name
      : (this.config.forms?.[name] ?? `/internal/forms/${name}`);
    return this.postJson<UiResponse>(path, values, opts);
  }

  /** Run a devvit.json scheduler task now (body `{ name, data }`). */
  async runTask(name: string, data?: unknown): Promise<unknown> {
    const task = schedulerTasks(this.config).find((t) => t.name === name);
    if (!task) throw new Error(`Scheduler task "${name}" is not declared in devvit.json`);
    return this.postJson(task.endpoint, { name, data });
  }

  // ─── Simulated Reddit activity ───────────────────────────────────────────

  private requireWorld(): FakeRedditWorld {
    if (!this.world || !this.events)
      throw new Error('ScenarioRunner was created without a FakeRedditWorld');
    return this.world;
  }

  /** Fire a trigger if (and only if) the app declares it in devvit.json. */
  async fire(trigger: TriggerName, payload: unknown): Promise<TriggerResponse | undefined> {
    const path = this.config.triggers?.[trigger];
    if (!path) return undefined;
    return this.postJson<TriggerResponse>(path, payload);
  }

  async install(installer = 'testuser'): Promise<void> {
    await this.fire('onAppInstall', this.requireEvents().appInstall(installer));
  }

  async upgrade(installer = 'testuser'): Promise<void> {
    await this.fire('onAppUpgrade', this.requireEvents().appUpgrade(installer));
  }

  private requireEvents(): EventFactory {
    this.requireWorld();
    return this.events as EventFactory;
  }

  /** `author` submits a post; fires onPostCreate / onPostSubmit. */
  async userPosts(author: string, post: Omit<SeedPostOptions, 'author'>): Promise<FakePostRecord> {
    const rec = this.requireWorld().seedPost({ ...post, author });
    const ev = this.requireEvents();
    await this.fire('onPostCreate', ev.postCreate(rec.id));
    await this.fire('onPostSubmit', ev.postSubmit(rec.id));
    return rec;
  }

  /** `author` replies to a post or comment; fires onCommentCreate / onCommentSubmit. */
  async userComments(author: string, parentId: T1 | T3, body: string): Promise<FakeCommentRecord> {
    const rec = this.requireWorld().seedComment({ parentId, body, author });
    const ev = this.requireEvents();
    await this.fire('onCommentCreate', ev.commentCreate(rec.id));
    await this.fire('onCommentSubmit', ev.commentSubmit(rec.id));
    return rec;
  }

  async userEditsComment(commentId: T1, body: string): Promise<void> {
    const c = this.requireWorld().comment(commentId);
    if (!c) throw new Error(`comment ${commentId} not seeded`);
    c.body = body;
    c.edited = true;
    await this.fire('onCommentUpdate', this.requireEvents().commentUpdate(commentId));
  }

  async userDeletesPost(postId: T3): Promise<void> {
    const p = this.requireWorld().post(postId);
    if (!p) throw new Error(`post ${postId} not seeded`);
    p.deleted = true;
    await this.fire('onPostDelete', this.requireEvents().postDelete(postId));
  }

  async userDeletesComment(commentId: T1): Promise<void> {
    const c = this.requireWorld().comment(commentId);
    if (!c) throw new Error(`comment ${commentId} not seeded`);
    c.deleted = true;
    await this.fire('onCommentDelete', this.requireEvents().commentDelete(commentId));
  }

  /** A report on a post or comment; fires onPostReport / onCommentReport. */
  async report(targetId: T1 | T3, reason: string, by?: string): Promise<void> {
    this.requireWorld().seedReport(targetId, reason, by);
    const ev = this.requireEvents();
    if (targetId.startsWith('t3_'))
      await this.fire('onPostReport', ev.postReport(targetId, reason));
    else await this.fire('onCommentReport', ev.commentReport(targetId, reason));
  }

  /** Post flair changes (by a mod or OP); fires onPostFlairUpdate. */
  async flairPost(postId: T3, flair: FlairRecord | undefined): Promise<void> {
    const p = this.requireWorld().post(postId);
    if (!p) throw new Error(`post ${postId} not seeded`);
    p.flair = flair;
    await this.fire('onPostFlairUpdate', this.requireEvents().postFlairUpdate(postId));
  }

  /** Fire onModAction for an arbitrary action name (e.g. 'banuser', 'editflair'). */
  async modAction(
    moderator: string,
    action: string,
    target: { targetId?: string; targetUser?: string } = {}
  ): Promise<void> {
    this.requireWorld().mod(moderator);
    await this.fire(
      'onModAction',
      this.requireEvents().modAction({ action, moderator, ...target })
    );
  }

  /** A human moderator removes a post/comment; updates state and fires onModAction. */
  async modRemoves(
    moderator: string,
    targetId: T1 | T3,
    opts: { spam?: boolean } = {}
  ): Promise<void> {
    const w = this.requireWorld();
    const rec = targetId.startsWith('t3_') ? w.post(targetId) : w.comment(targetId);
    if (!rec) throw new Error(`${targetId} not seeded`);
    rec.removed = true;
    rec.spam = !!opts.spam;
    rec.approved = false;
    w.removedIds.add(targetId);
    const kind = targetId.startsWith('t3_') ? 'link' : 'comment';
    await this.modAction(moderator, opts.spam ? `spam${kind}` : `remove${kind}`, { targetId });
  }

  async modApproves(moderator: string, targetId: T1 | T3): Promise<void> {
    const w = this.requireWorld();
    const rec = targetId.startsWith('t3_') ? w.post(targetId) : w.comment(targetId);
    if (!rec) throw new Error(`${targetId} not seeded`);
    rec.removed = false;
    rec.spam = false;
    rec.approved = true;
    rec.reports = [];
    w.removedIds.delete(targetId);
    await this.modAction(moderator, `approve${targetId.startsWith('t3_') ? 'link' : 'comment'}`, {
      targetId,
    });
  }

  async modBans(moderator: string, username: string, reason?: string): Promise<void> {
    this.requireWorld().banned(username, { reason, by: moderator });
    await this.modAction(moderator, 'banuser', { targetUser: username });
  }

  /** A user writes in to modmail; fires onModMail. */
  async userModmails(from: string, subject: string, body: string): Promise<ModmailConversation> {
    const convo = this.requireWorld().seedModmail({ from, subject, body });
    await this.fire('onModMail', this.requireEvents().modMail(convo));
    return convo;
  }

  // ─── Time ────────────────────────────────────────────────────────────────

  /**
   * Advance the fake clock by `duration` ('5m', '2h', '7d', or ms), minute by
   * minute, running every devvit.json cron task and every job the app scheduled
   * with `scheduler.runJob` as it comes due. Returns the task names that ran.
   */
  async advance(duration: string | number): Promise<string[]> {
    const ms = parseDuration(duration);
    const start = this.clock.now();
    const end = start + ms;
    const ran: string[] = [];
    let t = Math.floor(start / 60_000) * 60_000 + 60_000;
    for (; t <= end; t += 60_000) {
      this.clock.set(t);
      ran.push(...(await this.runDue(new Date(t))));
    }
    this.clock.set(end);
    return ran;
  }

  private async runDue(now: Date): Promise<string[]> {
    const ran: string[] = [];
    for (const task of schedulerTasks(this.config)) {
      if (task.cron && cronMatches(task.cron, now)) {
        await this.postJson(task.endpoint, { name: task.name });
        ran.push(task.name);
      }
    }
    for (const { id, request } of this.opts.mocks?.scheduler.getScheduledActions() ?? []) {
      const name = request.action?.type;
      if (!name || this.firedJobs.has(id)) continue;
      const due = request.cron
        ? cronMatches(request.cron, now)
        : request.when
          ? new Date(request.when).getTime() <= now.getTime()
          : false;
      if (!due) continue;
      const task = schedulerTasks(this.config).find((tk) => tk.name === name);
      if (!task)
        throw new Error(
          `App scheduled job "${name}" but devvit.json declares no such scheduler task`
        );
      if (!request.cron) {
        this.firedJobs.add(id);
        await this.opts.mocks?.scheduler.plugin.Cancel({ id });
      }
      await this.postJson(task.endpoint, { name, data: request.action?.data });
      ran.push(name);
    }
    return ran;
  }

  // ─── Given / When / Then ─────────────────────────────────────────────────

  scenario(title: string): Scenario {
    return new Scenario(title, this, this.opts.http);
  }
}

export interface StepContext {
  world: FakeRedditWorld;
  runner: ScenarioRunner;
  http?: FakeHttp;
  /** Actions the app took since the first `when` step. */
  actions: WorldAction[];
  /** `world.describeActions()` for those actions. */
  log: string[];
}

type Step = { kind: 'given' | 'when' | 'then'; label: string; fn: (ctx: StepContext) => unknown };

/**
 * Readable scenarios:
 *
 *     await runner.scenario('second post in 24h is removed')
 *       .given('alice posted this morning', ({ world }) => world.seedPost({ ... }))
 *       .when('alice posts again', ({ runner }) => runner.userPosts('alice', { title: 'Again' }))
 *       .then('the app removed it', ({ log }) => expect(log).toContain('test-app remove t3_...'))
 *       .run();
 *
 * A failing step is reported with its label, the app's action log and fetch calls.
 */
export class Scenario {
  private readonly steps: Step[] = [];

  constructor(
    private readonly title: string,
    private readonly runner: ScenarioRunner,
    private readonly http?: FakeHttp
  ) {}

  given(label: string, fn: Step['fn']): this {
    this.steps.push({ kind: 'given', label, fn });
    return this;
  }

  when(label: string, fn: Step['fn']): this {
    this.steps.push({ kind: 'when', label, fn });
    return this;
  }

  then(label: string, fn: Step['fn']): this {
    this.steps.push({ kind: 'then', label, fn });
    return this;
  }

  /** Alias of the previous step kind, for readability. */
  and(label: string, fn: Step['fn']): this {
    const last = this.steps.at(-1);
    this.steps.push({ kind: last?.kind ?? 'given', label, fn });
    return this;
  }

  async run(): Promise<StepContext> {
    const world = this.runner.world;
    if (!world) throw new Error('Scenario needs a runner created by createModTest');
    let mark: number | undefined;
    const ctx = (): StepContext => {
      const since = mark ?? world.actions.length;
      return {
        world,
        runner: this.runner,
        http: this.http,
        actions: world.actionsSince(since),
        log: world.describeActions(since),
      };
    };
    for (const step of this.steps) {
      if (step.kind === 'when' && mark === undefined) mark = world.mark();
      try {
        await step.fn(ctx());
      } catch (err) {
        const e = err as Error;
        const log = world.describeActions(mark ?? 0);
        e.message =
          `Scenario "${this.title}" failed at ${step.kind} "${step.label}": ${e.message}\n` +
          `  app actions:${log.length ? `\n    ${log.join('\n    ')}` : ' (none)'}`;
        throw e;
      }
    }
    return ctx();
  }
}
