/* eslint-disable @typescript-eslint/no-this-alias -- facade objects close over the world */
import { vi } from 'vitest';
import { context, reddit, type Comment, type Post, type User } from '@devvit/web/server';
import type { T1, T3 } from '@devvit/web/shared';
import type { DevvitFixtures } from '@devvit/test/server/vitest';

export type T2 = `t2_${string}`;
export type T5 = `t5_${string}`;
type ThingId = T1 | T3;

export interface FlairRecord {
  text?: string;
  templateId?: string;
  cssClass?: string;
  backgroundColor?: string;
  textColor?: string;
}

export interface ReportRecord {
  reason: string;
  /** Username of the reporter; undefined for anonymous user reports. */
  by?: string;
  /** True when a moderator (or the app) filed it. */
  mod: boolean;
  at: number;
}

export interface FakeUserRecord {
  id: T2;
  username: string;
  createdAt: Date;
  linkKarma: number;
  commentKarma: number;
  isAdmin: boolean;
  suspended: boolean;
  /** Bot / app accounts (AutoModerator, other apps). Informational only. */
  isBot: boolean;
}

export interface BanRecord {
  reason?: string;
  note?: string;
  duration?: number;
  message?: string;
  by: string;
  at: number;
}

export interface FakeSubredditRecord {
  id: T5;
  name: string;
  moderators: Set<string>;
  approvedUsers: Set<string>;
  bannedUsers: Map<string, BanRecord>;
  mutedUsers: Set<string>;
  userFlair: Map<string, FlairRecord>;
  wiki: Map<string, WikiPageRecord>;
}

export interface WikiPageRecord {
  name: string;
  content: string;
  revisions: { id: string; content: string; reason?: string; author: string; at: number }[];
}

export interface FakePostRecord {
  id: T3;
  title: string;
  selftext?: string;
  url?: string;
  authorId?: string;
  authorName: string;
  subredditName: string;
  createdAt: Date;
  flair?: FlairRecord;
  removed: boolean;
  spam: boolean;
  approved: boolean;
  locked: boolean;
  stickied: boolean;
  distinguished: boolean;
  ignoringReports: boolean;
  deleted: boolean;
  nsfw: boolean;
  spoiler: boolean;
  edited: boolean;
  score: number;
  reports: ReportRecord[];
  postData?: Record<string, unknown>;
  /** Set for posts created with `submitCustomPost`. */
  custom?: { entry?: string };
}

export interface FakeCommentRecord {
  id: T1;
  parentId: T1 | T3;
  postId: T3;
  body: string;
  authorName: string;
  authorId?: string;
  subredditName: string;
  createdAt: Date;
  removed: boolean;
  spam: boolean;
  approved: boolean;
  locked: boolean;
  distinguished: boolean;
  stickied: boolean;
  ignoringReports: boolean;
  deleted: boolean;
  edited: boolean;
  score: number;
  reports: ReportRecord[];
}

export interface ModmailMessage {
  id: string;
  author: string;
  body: string;
  isInternal: boolean;
  at: number;
}

export interface ModmailConversation {
  id: string;
  subject: string;
  subredditName: string;
  /** The non-moderator participant, if any. */
  participant?: string;
  state: 'new' | 'inprogress' | 'archived';
  messages: ModmailMessage[];
}

export interface ModNoteRecord {
  id: string;
  kind: 'note' | 'removal';
  subredditName: string;
  user?: string;
  note?: string;
  label?: string;
  redditId?: string;
  reasonId?: string;
  by: string;
  at: number;
}

export interface PrivateMessageRecord {
  from: string;
  to: string;
  subject: string;
  text: string;
  at: number;
}

/** One thing the app did through the Reddit API. */
export interface WorldAction {
  seq: number;
  at: number;
  type: string;
  actor: string;
  target?: string;
  detail?: Record<string, unknown>;
}

export type WorldExtension = (world: FakeRedditWorld, mocks: DevvitFixtures['mocks']) => void;

export interface SeedPostOptions {
  id?: T3;
  title: string;
  selftext?: string;
  body?: string;
  url?: string;
  /** Author username. Defaults to a user named after authorId, or `testuser`. */
  author?: string;
  authorId?: string;
  subredditName?: string;
  createdAt?: Date | number;
  flair?: FlairRecord;
  score?: number;
  nsfw?: boolean;
  spoiler?: boolean;
  locked?: boolean;
  removed?: boolean;
  approved?: boolean;
}

export interface SeedCommentOptions {
  id?: T1;
  parentId: T1 | T3;
  body: string;
  author?: string;
  createdAt?: Date | number;
  score?: number;
  locked?: boolean;
  removed?: boolean;
  distinguished?: boolean;
}

/** RichTextBuilder keeps its document in private state; prefer its `build()` output. */
function serializeRichtext(richtext: unknown): string {
  const built =
    richtext && typeof (richtext as { build?: unknown }).build === 'function'
      ? (richtext as { build: () => unknown }).build()
      : richtext;
  return typeof built === 'string' ? built : JSON.stringify(built);
}

function textOf(opts: { text?: string; richtext?: unknown }): string {
  return opts.text ?? serializeRichtext(opts.richtext);
}

interface ListingLike<T> {
  all(): Promise<T[]>;
  get(count: number): Promise<T[]>;
  readonly children: T[];
  readonly hasMore: boolean;
  [Symbol.asyncIterator](): AsyncIterator<T>;
}

/** A finished, single-page Listing, enough for `.all()`, `.get(n)` and `for await`. */
export function fakeListing<T>(items: () => T[], limit?: number): ListingLike<T> {
  const page = () => {
    const all = items();
    return limit ? all.slice(0, limit) : all;
  };
  return {
    all: async () => page(),
    get: async (count: number) => page().slice(0, count),
    get children() {
      return page();
    },
    hasMore: false,
    async *[Symbol.asyncIterator]() {
      for (const item of page()) yield item;
    },
  };
}

class NotFoundError extends Error {}

/**
 * Stateful in-memory Reddit for one test, layered on `@devvit/test`.
 *
 * `@devvit/test` provides Redis, settings, scheduler, media and context. This class
 * spies on the `reddit` client from `@devvit/web/server` and backs it with
 * subreddits, users (mods, approved, banned, bots), threaded posts and comments,
 * flair, reports, removals/approvals, modmail, wiki pages, mod notes and private
 * messages. Every write the app makes is appended to `actions` (see `describeActions`).
 *
 * "Seed" methods (`seedPost`, `seedComment`, `mod`, `ban`, ...) set up state and
 * are not logged as app actions.
 */
export class FakeRedditWorld {
  readonly users = new Map<string, FakeUserRecord>();
  readonly subreddits = new Map<string, FakeSubredditRecord>();
  readonly posts = new Map<string, FakePostRecord>();
  readonly comments: FakeCommentRecord[] = [];
  readonly removedIds = new Set<string>();
  readonly modmail: ModmailConversation[] = [];
  readonly modNotes: ModNoteRecord[] = [];
  readonly privateMessages: PrivateMessageRecord[] = [];
  readonly actions: WorldAction[] = [];
  readonly subredditName: string;
  readonly appUsername: string;
  private seq = 1;
  private actionSeq = 1;

  constructor(
    private readonly mocks: DevvitFixtures['mocks'],
    opts: { subredditName?: string; subredditId?: string; username?: string; userId?: string } = {}
  ) {
    this.subredditName = opts.subredditName ?? 'testsub';
    this.appUsername = context.appSlug ?? 'test-app';
    this.subreddit(
      this.subredditName,
      (opts.subredditId as T5 | undefined) ?? `t5_${this.subredditName}`
    );
    this.user(this.appUsername, { id: 't2_app', isBot: true });
    this.subreddit().moderators.add(this.appUsername);
    if (opts.username) this.user(opts.username, opts.userId ? { id: opts.userId as T2 } : {});
  }

  // ─── Seeding ─────────────────────────────────────────────────────────────

  subreddit(name = this.subredditName, id?: T5): FakeSubredditRecord {
    const key = name.toLowerCase();
    let sub = this.subreddits.get(key);
    if (!sub) {
      sub = {
        id: id ?? `t5_${name}`,
        name,
        moderators: new Set(),
        approvedUsers: new Set(),
        bannedUsers: new Map(),
        mutedUsers: new Set(),
        userFlair: new Map(),
        wiki: new Map(),
      };
      this.subreddits.set(key, sub);
    }
    return sub;
  }

  /** Get or create a user. */
  user(username: string, opts: Partial<Omit<FakeUserRecord, 'username'>> = {}): FakeUserRecord {
    let u = this.findUser(username);
    if (!u) {
      u = {
        id: opts.id ?? `t2_${username.toLowerCase()}`,
        username,
        createdAt: opts.createdAt ?? new Date('2020-01-01T00:00:00Z'),
        linkKarma: opts.linkKarma ?? 100,
        commentKarma: opts.commentKarma ?? 100,
        isAdmin: opts.isAdmin ?? false,
        suspended: opts.suspended ?? false,
        isBot: opts.isBot ?? false,
      };
      this.users.set(u.id, u);
    } else {
      Object.assign(u, opts);
    }
    return u;
  }

  /** A moderator of the (default) subreddit. */
  mod(username: string, subredditName = this.subredditName): FakeUserRecord {
    const u = this.user(username);
    this.subreddit(subredditName).moderators.add(u.username);
    return u;
  }

  /** An approved user (contributor). */
  approvedUser(username: string, subredditName = this.subredditName): FakeUserRecord {
    const u = this.user(username);
    this.subreddit(subredditName).approvedUsers.add(u.username);
    return u;
  }

  banned(
    username: string,
    ban: Partial<BanRecord> = {},
    subredditName = this.subredditName
  ): FakeUserRecord {
    const u = this.user(username);
    this.subreddit(subredditName).bannedUsers.set(u.username, {
      by: 'seed',
      at: Date.now(),
      ...ban,
    });
    return u;
  }

  /** A bot account such as AutoModerator or another app. */
  bot(username: string): FakeUserRecord {
    return this.user(username, { isBot: true });
  }

  seedUserFlair(username: string, flair: FlairRecord, subredditName = this.subredditName): void {
    this.subreddit(subredditName).userFlair.set(this.user(username).username, flair);
  }

  seedWikiPage(page: string, content: string, subredditName = this.subredditName): WikiPageRecord {
    const rec: WikiPageRecord = {
      name: page,
      content,
      revisions: [{ id: this.nextId('rev'), content, author: 'seed', at: Date.now() }],
    };
    this.subreddit(subredditName).wiki.set(page, rec);
    return rec;
  }

  seedPost(opts: SeedPostOptions): FakePostRecord {
    const authorName = opts.author ?? this.findUserById(opts.authorId)?.username ?? 'testuser';
    const author = this.user(authorName, opts.authorId ? { id: opts.authorId as T2 } : {});
    const record: FakePostRecord = {
      id: this.claimId(opts.id, 't3_p') as T3,
      title: opts.title,
      selftext: opts.selftext ?? opts.body,
      url: opts.url,
      authorId: opts.authorId ?? author.id,
      authorName: author.username,
      subredditName: opts.subredditName ?? this.subredditName,
      createdAt: new Date(opts.createdAt ?? Date.now()),
      flair: opts.flair,
      removed: opts.removed ?? false,
      spam: false,
      approved: opts.approved ?? false,
      locked: opts.locked ?? false,
      stickied: false,
      distinguished: false,
      ignoringReports: false,
      deleted: false,
      nsfw: opts.nsfw ?? false,
      spoiler: opts.spoiler ?? false,
      edited: false,
      score: opts.score ?? 1,
      reports: [],
    };
    this.posts.set(record.id, record);
    if (record.removed) this.removedIds.add(record.id);
    return record;
  }

  seedComment(opts: SeedCommentOptions): FakeCommentRecord {
    const parentPostId = opts.parentId.startsWith('t3_')
      ? (opts.parentId as T3)
      : this.requireComment(opts.parentId as T1).postId;
    const author = this.user(opts.author ?? 'testuser');
    const record: FakeCommentRecord = {
      id: this.claimId(opts.id, 't1_c') as T1,
      parentId: opts.parentId,
      postId: parentPostId,
      body: opts.body,
      authorName: author.username,
      authorId: author.id,
      subredditName: this.posts.get(parentPostId)?.subredditName ?? this.subredditName,
      createdAt: new Date(opts.createdAt ?? Date.now()),
      removed: opts.removed ?? false,
      spam: false,
      approved: false,
      locked: opts.locked ?? false,
      distinguished: opts.distinguished ?? false,
      stickied: false,
      ignoringReports: false,
      deleted: false,
      edited: false,
      score: opts.score ?? 1,
      reports: [],
    };
    this.comments.push(record);
    if (record.removed) this.removedIds.add(record.id);
    return record;
  }

  /** A user report (anonymous unless `by` is given). */
  seedReport(targetId: ThingId, reason: string, by?: string): ReportRecord {
    const rec = this.requireThing(targetId);
    const report: ReportRecord = {
      reason,
      by,
      mod: by ? this.isModerator(by) : false,
      at: Date.now(),
    };
    rec.reports.push(report);
    return report;
  }

  seedModmail(opts: {
    from: string;
    subject: string;
    body: string;
    subredditName?: string;
  }): ModmailConversation {
    const convo: ModmailConversation = {
      id: this.nextId('mm'),
      subject: opts.subject,
      subredditName: opts.subredditName ?? this.subredditName,
      participant: opts.from,
      state: 'new',
      messages: [
        {
          id: this.nextId('msg'),
          author: opts.from,
          body: opts.body,
          isInternal: false,
          at: Date.now(),
        },
      ],
    };
    this.modmail.push(convo);
    return convo;
  }

  // ─── Queries ─────────────────────────────────────────────────────────────

  post(id: string): FakePostRecord | undefined {
    return this.posts.get(id);
  }

  comment(id: string): FakeCommentRecord | undefined {
    return this.comments.find((c) => c.id === id);
  }

  commentsOn(parentId: T1 | T3): FakeCommentRecord[] {
    return this.comments.filter((c) => c.parentId === parentId);
  }

  /** Every comment on a post at any depth, in creation order. */
  commentsInPost(postId: T3): FakeCommentRecord[] {
    return this.comments.filter((c) => c.postId === postId);
  }

  /** Comments the app account wrote. */
  appComments(): FakeCommentRecord[] {
    return this.comments.filter((c) => c.authorName === this.appUsername);
  }

  isRemoved(id: string): boolean {
    return this.removedIds.has(id);
  }

  isModerator(username: string, subredditName = this.subredditName): boolean {
    return this.subreddit(subredditName).moderators.has(this.user(username).username);
  }

  userFlair(username: string, subredditName = this.subredditName): FlairRecord | undefined {
    return this.subreddit(subredditName).userFlair.get(username);
  }

  wikiPage(page: string, subredditName = this.subredditName): WikiPageRecord | undefined {
    return this.subreddit(subredditName).wiki.get(page);
  }

  /** Position in the action log; pass to `actionsSince` / `describeActions`. */
  mark(): number {
    return this.actions.length;
  }

  actionsSince(mark: number): WorldAction[] {
    return this.actions.slice(mark);
  }

  actionsOf(type: string): WorldAction[] {
    return this.actions.filter((a) => a.type === type);
  }

  /**
   * Compact, snapshot-friendly lines such as
   * `test-app comment t3_p1 "Removed: …"` or `test-app remove t3_p1`.
   */
  describeActions(since = 0): string[] {
    return this.actions.slice(since).map((a) => {
      const detail = a.detail ? Object.entries(a.detail).filter(([, v]) => v !== undefined) : [];
      const text = detail
        .map(([k, v]) => {
          if (k === 'text') {
            const s = String(v).replace(/\s+/g, ' ');
            return JSON.stringify(s.length > 60 ? `${s.slice(0, 57)}...` : s);
          }
          return `${k}=${typeof v === 'string' ? v : JSON.stringify(v)}`;
        })
        .join(' ');
      return [a.actor, a.type, a.target, text].filter(Boolean).join(' ');
    });
  }

  /** Extension point for app-specific mocks. */
  use(extension: WorldExtension): this {
    extension(this, this.mocks);
    return this;
  }

  // ─── Internals ───────────────────────────────────────────────────────────

  private nextId(prefix: string): string {
    return `${prefix}${(this.seq++).toString(36)}`;
  }

  /** An explicit id must be unused; generated ids skip ids a test already seeded. */
  private claimId(explicit: string | undefined, prefix: string): string {
    const taken = (id: string) => this.posts.has(id) || this.comments.some((c) => c.id === id);
    if (explicit) {
      if (taken(explicit)) throw new Error(`FakeRedditWorld: ${explicit} already exists`);
      return explicit;
    }
    let id = this.nextId(prefix);
    while (taken(id)) id = this.nextId(prefix);
    return id;
  }

  private findUser(username: string | undefined): FakeUserRecord | undefined {
    if (!username) return undefined;
    const lower = username.toLowerCase();
    for (const u of this.users.values()) if (u.username.toLowerCase() === lower) return u;
    return undefined;
  }

  private findUserById(id: string | undefined): FakeUserRecord | undefined {
    return id ? this.users.get(id) : undefined;
  }

  private requireComment(id: T1): FakeCommentRecord {
    const c = this.comment(id);
    if (!c)
      throw new NotFoundError(
        `FakeRedditWorld: comment ${id} not found (seed it with world.seedComment)`
      );
    return c;
  }

  private requirePost(id: T3): FakePostRecord {
    const p = this.posts.get(id);
    if (!p)
      throw new NotFoundError(
        `FakeRedditWorld: post ${id} not found (seed it with world.seedPost)`
      );
    return p;
  }

  private requireThing(id: ThingId): FakePostRecord | FakeCommentRecord {
    return id.startsWith('t3_') ? this.requirePost(id as T3) : this.requireComment(id as T1);
  }

  /** The user the current request runs as (`context.username`). */
  currentUsername(): string {
    return context.username ?? 'testuser';
  }

  private actorFor(runAs?: string): string {
    return runAs === 'USER' ? this.currentUsername() : this.appUsername;
  }

  record(type: string, actor: string, target?: string, detail?: Record<string, unknown>): void {
    this.actions.push({ seq: this.actionSeq++, at: Date.now(), type, actor, target, detail });
  }

  private setRemoved(id: ThingId, removed: boolean, spam = false): void {
    const rec = this.requireThing(id);
    rec.removed = removed;
    rec.spam = removed && spam;
    if (removed) {
      rec.approved = false;
      this.removedIds.add(id);
    } else {
      rec.approved = true;
      rec.reports = [];
      this.removedIds.delete(id);
    }
  }

  createComment(parentId: ThingId, body: string, author: string): FakeCommentRecord {
    const parent = this.requireThing(parentId);
    if (parent.deleted) throw new Error(`FakeRedditWorld: cannot reply to deleted ${parentId}`);
    const post = parentId.startsWith('t3_')
      ? (parent as FakePostRecord)
      : this.requirePost((parent as FakeCommentRecord).postId);
    if ((parent.locked || post.locked) && !this.isModerator(author, post.subredditName)) {
      throw new Error(
        `FakeRedditWorld: ${author} cannot reply to locked ${parent.locked ? parentId : post.id}`
      );
    }
    if (this.subreddit(post.subredditName).bannedUsers.has(author)) {
      throw new Error(`FakeRedditWorld: ${author} is banned from r/${post.subredditName}`);
    }
    const rec = this.seedComment({ parentId, body, author });
    this.record('comment', author, parentId, { id: rec.id, text: body });
    return rec;
  }

  private createPost(opts: {
    title: string;
    text?: string;
    url?: string;
    subredditName?: string;
    author: string;
    flair?: FlairRecord;
    custom?: { entry?: string };
    postData?: Record<string, unknown>;
  }): FakePostRecord {
    const rec = this.seedPost({
      title: opts.title,
      selftext: opts.text,
      url: opts.url,
      author: opts.author,
      subredditName: opts.subredditName,
      flair: opts.flair,
    });
    rec.custom = opts.custom;
    rec.postData = opts.postData;
    this.record(opts.custom ? 'submitCustomPost' : 'submitPost', opts.author, rec.id, {
      title: opts.title,
      entry: opts.custom?.entry,
    });
    return rec;
  }

  // ─── Reddit object facades ────────────────────────────────────────────────

  userObject(rec: FakeUserRecord): User {
    const world = this;
    return {
      id: rec.id,
      username: rec.username,
      createdAt: rec.createdAt,
      linkKarma: rec.linkKarma,
      commentKarma: rec.commentKarma,
      isAdmin: rec.isAdmin,
      nsfw: false,
      url: `https://www.reddit.com/user/${rec.username}`,
      permalink: `/user/${rec.username}/`,
      hasVerifiedEmail: true,
      async getUserFlairBySubreddit(subredditName: string) {
        const f = world.subreddit(subredditName).userFlair.get(rec.username);
        return f ? { user: rec.username, flairText: f.text, flairCssClass: f.cssClass } : undefined;
      },
      async getModPermissionsForSubreddit(subredditName: string) {
        return world.isModerator(rec.username, subredditName) ? ['all'] : [];
      },
      getPosts: (opts: { limit?: number } = {}) =>
        fakeListing(() => world.postsBy(rec.username).map((p) => world.postObject(p)), opts.limit),
      getComments: (opts: { limit?: number } = {}) =>
        fakeListing(
          () => world.commentsBy(rec.username).map((c) => world.commentObject(c)),
          opts.limit
        ),
      async getSnoovatarUrl() {
        return undefined;
      },
      async getSocialLinks() {
        return [];
      },
      async getUserKarmaFromCurrentSubreddit() {
        return { fromPosts: rec.linkKarma, fromComments: rec.commentKarma };
      },
      toJSON() {
        return { id: rec.id, username: rec.username };
      },
    } as unknown as User;
  }

  postsBy(username: string): FakePostRecord[] {
    return [...this.posts.values()]
      .filter((p) => p.authorName.toLowerCase() === username.toLowerCase())
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  commentsBy(username: string): FakeCommentRecord[] {
    return this.comments
      .filter((c) => c.authorName.toLowerCase() === username.toLowerCase())
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  private thingMethods(rec: FakePostRecord | FakeCommentRecord) {
    const world = this;
    const actor = () => world.appUsername;
    return {
      async remove(isSpam = false) {
        world.setRemoved(rec.id, true, isSpam);
        world.record('remove', actor(), rec.id, isSpam ? { spam: true } : undefined);
      },
      async approve() {
        world.setRemoved(rec.id, false);
        world.record('approve', actor(), rec.id);
      },
      async lock() {
        rec.locked = true;
        world.record('lock', actor(), rec.id);
      },
      async unlock() {
        rec.locked = false;
        world.record('unlock', actor(), rec.id);
      },
      async distinguish(makeSticky = false) {
        rec.distinguished = true;
        if (makeSticky) rec.stickied = true;
        world.record('distinguish', actor(), rec.id, makeSticky ? { sticky: true } : undefined);
      },
      async undistinguish() {
        rec.distinguished = false;
        rec.stickied = false;
        world.record('undistinguish', actor(), rec.id);
      },
      async ignoreReports() {
        rec.ignoringReports = true;
        world.record('ignoreReports', actor(), rec.id);
      },
      async unignoreReports() {
        rec.ignoringReports = false;
        world.record('unignoreReports', actor(), rec.id);
      },
      async delete() {
        rec.deleted = true;
        world.record('delete', actor(), rec.id);
      },
      async addRemovalNote(opts: { reasonId: string; modNote?: string }) {
        world.addNote({
          kind: 'removal',
          redditId: rec.id,
          reasonId: opts.reasonId,
          note: opts.modNote,
        });
      },
      async getAuthor() {
        const u = world.findUser(rec.authorName);
        return u ? world.userObject(u) : undefined;
      },
      isApproved: () => rec.approved,
      isRemoved: () => rec.removed,
      isSpam: () => rec.spam,
      isLocked: () => rec.locked,
      isStickied: () => rec.stickied,
      isIgnoringReports: () => rec.ignoringReports,
      isEdited: () => rec.edited,
      isDistinguished: () => rec.distinguished,
      isDistinguishedBy: () => rec.distinguished,
    };
  }

  private snapshotFields(rec: FakePostRecord | FakeCommentRecord) {
    const sub = this.subreddit(rec.subredditName);
    return {
      id: rec.id,
      authorId: rec.authorId,
      authorName: rec.deleted ? '[deleted]' : rec.authorName,
      subredditId: sub.id,
      subredditName: sub.name,
      createdAt: rec.createdAt,
      score: rec.score,
      approved: rec.approved,
      removed: rec.removed,
      spam: rec.spam,
      locked: rec.locked,
      stickied: rec.stickied,
      distinguishedBy: rec.distinguished ? 'moderator' : undefined,
      ignoringReports: rec.ignoringReports,
      edited: rec.edited,
      numberOfReports: rec.reports.length,
      numReports: rec.reports.length,
      userReportReasons: rec.reports.filter((r) => !r.mod).map((r) => r.reason),
      modReportReasons: rec.reports.filter((r) => r.mod).map((r) => r.reason),
    };
  }

  postObject(rec: FakePostRecord): Post {
    const world = this;
    const flair = rec.flair
      ? {
          type: 'text',
          templateId: rec.flair.templateId,
          text: rec.flair.text,
          cssClass: rec.flair.cssClass,
          backgroundColor: rec.flair.backgroundColor,
          textColor: rec.flair.textColor,
        }
      : undefined;
    return {
      ...this.snapshotFields(rec),
      ...this.thingMethods(rec),
      title: rec.title,
      body: rec.deleted ? '[deleted]' : rec.selftext,
      url: rec.url ?? `https://www.reddit.com/r/${rec.subredditName}/comments/${rec.id.slice(3)}/`,
      permalink: `/r/${rec.subredditName}/comments/${rec.id.slice(3)}/`,
      flair,
      nsfw: rec.nsfw,
      spoiler: rec.spoiler,
      hidden: false,
      archived: false,
      quarantined: false,
      numberOfComments: world.commentsInPost(rec.id).length,
      comments: fakeListing(() => world.topLevelComments(rec.id)),
      isNsfw: () => rec.nsfw,
      isSpoiler: () => rec.spoiler,
      isArchived: () => false,
      isHidden: () => false,
      isQuarantined: () => false,
      async addComment(opts: { text?: string; richtext?: unknown; runAs?: string }) {
        return world.commentObject(
          world.createComment(rec.id, textOf(opts), world.actorFor(opts.runAs))
        );
      },
      async sticky(position?: number) {
        rec.stickied = true;
        world.record('sticky', world.appUsername, rec.id, position ? { position } : undefined);
      },
      async unsticky() {
        rec.stickied = false;
        world.record('unsticky', world.appUsername, rec.id);
      },
      async edit(opts: { text?: string; richtext?: unknown }) {
        rec.selftext = textOf(opts);
        rec.edited = true;
        world.record('edit', world.appUsername, rec.id, { text: rec.selftext });
      },
      async markAsNsfw() {
        rec.nsfw = true;
        world.record('markNsfw', world.appUsername, rec.id);
      },
      async unmarkAsNsfw() {
        rec.nsfw = false;
        world.record('unmarkNsfw', world.appUsername, rec.id);
      },
      async markAsSpoiler() {
        rec.spoiler = true;
        world.record('markSpoiler', world.appUsername, rec.id);
      },
      async unmarkAsSpoiler() {
        rec.spoiler = false;
        world.record('unmarkSpoiler', world.appUsername, rec.id);
      },
      async getPostData() {
        return rec.postData;
      },
      async setPostData(data: Record<string, unknown>) {
        rec.postData = data;
        world.record('setPostData', world.appUsername, rec.id);
      },
      async mergePostData(data: Record<string, unknown>) {
        rec.postData = { ...(rec.postData ?? {}), ...data };
        world.record('setPostData', world.appUsername, rec.id);
      },
      toJSON() {
        return { id: rec.id, title: rec.title, authorName: rec.authorName };
      },
    } as unknown as Post;
  }

  commentObject(rec: FakeCommentRecord): Comment {
    const world = this;
    return {
      ...this.snapshotFields(rec),
      ...this.thingMethods(rec),
      body: rec.deleted ? '[deleted]' : rec.body,
      parentId: rec.parentId,
      postId: rec.postId,
      permalink: `/r/${rec.subredditName}/comments/${rec.postId.slice(3)}/_/${rec.id.slice(3)}/`,
      url: `https://www.reddit.com/r/${rec.subredditName}/comments/${rec.postId.slice(3)}/_/${rec.id.slice(3)}/`,
      collapsedBecauseCrowdControl: false,
      replies: fakeListing(() => world.commentsOn(rec.id).map((c) => world.commentObject(c))),
      async reply(opts: { text?: string; richtext?: unknown; runAs?: string }) {
        return world.commentObject(
          world.createComment(rec.id, textOf(opts), world.actorFor(opts.runAs))
        );
      },
      async edit(opts: { text?: string; richtext?: unknown }) {
        rec.body = textOf(opts);
        rec.edited = true;
        world.record('edit', world.appUsername, rec.id, { text: rec.body });
        return world.commentObject(rec);
      },
      toJSON() {
        return { id: rec.id, body: rec.body, authorName: rec.authorName };
      },
    } as unknown as Comment;
  }

  private topLevelComments(postId: T3): Comment[] {
    return this.commentsOn(postId).map((c) => this.commentObject(c));
  }

  private addNote(
    opts: Omit<ModNoteRecord, 'id' | 'by' | 'at' | 'subredditName'> & { subredditName?: string }
  ): void {
    const note: ModNoteRecord = {
      id: this.nextId('note'),
      subredditName: opts.subredditName ?? this.subredditName,
      by: this.appUsername,
      at: Date.now(),
      ...opts,
    };
    this.modNotes.push(note);
    this.record(
      note.kind === 'removal' ? 'removalNote' : 'modNote',
      this.appUsername,
      note.redditId ?? note.user,
      {
        note: note.note,
        label: note.label,
        reasonId: note.reasonId,
      }
    );
  }

  private usersIn(set: Iterable<string>, username?: string): User[] {
    return [...set]
      .filter((name) => !username || name.toLowerCase() === username.toLowerCase())
      .map((name) => this.userObject(this.user(name)));
  }

  // ─── Spies ───────────────────────────────────────────────────────────────

  /** Installs the `reddit.*` spies. Called by `createModTest` for every test. */
  installDefaultSpies(): void {
    const world = this;
    type LooseSpy = (obj: object, method: string) => { mockImplementation(fn: unknown): unknown };
    const spy = (name: keyof typeof reddit & string, impl: (...args: never[]) => unknown) => {
      (vi.spyOn as unknown as LooseSpy)(reddit, name).mockImplementation(impl);
    };
    const sub = (name?: string) => world.subreddit(name ?? world.subredditName);

    spy('getPostById', async (id: T3) => world.postObject(world.requirePost(id)));
    spy('getCommentById', async (id: T1) => world.commentObject(world.requireComment(id)));
    spy(
      'submitComment',
      async (opts: { id: ThingId; text?: string; richtext?: unknown; runAs?: string }) =>
        world.commentObject(world.createComment(opts.id, textOf(opts), world.actorFor(opts.runAs)))
    );
    spy(
      'submitPost',
      async (opts: {
        title: string;
        text?: string;
        url?: string;
        subredditName?: string;
        runAs?: string;
        flairId?: string;
        flairText?: string;
      }) =>
        world.postObject(
          world.createPost({
            title: opts.title,
            text: opts.text,
            url: opts.url,
            subredditName: opts.subredditName,
            author: world.actorFor(opts.runAs),
            flair:
              opts.flairId || opts.flairText
                ? { templateId: opts.flairId, text: opts.flairText }
                : undefined,
          })
        )
    );
    spy(
      'submitCustomPost',
      async (opts: {
        title: string;
        subredditName?: string;
        entry?: string;
        postData?: Record<string, unknown>;
        runAs?: string;
      }) =>
        world.postObject(
          world.createPost({
            title: opts.title,
            subredditName: opts.subredditName,
            author: world.actorFor(opts.runAs),
            custom: { entry: opts.entry },
            postData: opts.postData,
          })
        )
    );
    spy('remove', async (id: ThingId, isSpam: boolean) => {
      world.setRemoved(id, true, isSpam);
      world.record('remove', world.appUsername, id, isSpam ? { spam: true } : undefined);
    });
    spy('approve', async (id: ThingId) => {
      world.setRemoved(id, false);
      world.record('approve', world.appUsername, id);
    });
    spy('report', async (thing: { id: ThingId }, opts: { reason: string }) => {
      world
        .requireThing(thing.id)
        .reports.push({ reason: opts.reason, by: world.appUsername, mod: true, at: Date.now() });
      world.record('report', world.appUsername, thing.id, { reason: opts.reason });
    });

    spy('getCurrentUsername', async () => world.currentUsername());
    spy('getCurrentUser', async () => world.userObject(world.user(world.currentUsername())));
    spy('getAppUser', async () => world.userObject(world.user(world.appUsername)));
    spy('getUserByUsername', async (username: string) => {
      const u = world.findUser(username);
      return u ? world.userObject(u) : undefined;
    });
    spy('getUserById', async (id: T2) => {
      const u = world.findUserById(id);
      return u ? world.userObject(u) : undefined;
    });
    spy('getCurrentSubreddit', async () => {
      const s = sub();
      return { id: s.id, name: s.name, title: s.name };
    });

    spy('getModerators', (opts: { subredditName?: string; username?: string; limit?: number }) =>
      fakeListing(
        () => world.usersIn(sub(opts.subredditName).moderators, opts.username),
        opts.limit
      )
    );
    spy('getApprovedUsers', (opts: { subredditName?: string; username?: string; limit?: number }) =>
      fakeListing(
        () => world.usersIn(sub(opts.subredditName).approvedUsers, opts.username),
        opts.limit
      )
    );
    spy('getBannedUsers', (opts: { subredditName?: string; username?: string; limit?: number }) =>
      fakeListing(
        () => world.usersIn(sub(opts.subredditName).bannedUsers.keys(), opts.username),
        opts.limit
      )
    );
    spy('getMutedUsers', (opts: { subredditName?: string; username?: string; limit?: number }) =>
      fakeListing(
        () => world.usersIn(sub(opts.subredditName).mutedUsers, opts.username),
        opts.limit
      )
    );
    spy(
      'banUser',
      async (opts: {
        subredditName?: string;
        username: string;
        duration?: number;
        reason?: string;
        note?: string;
        message?: string;
      }) => {
        const name = world.user(opts.username).username;
        sub(opts.subredditName).bannedUsers.set(name, {
          reason: opts.reason,
          note: opts.note,
          duration: opts.duration,
          message: opts.message,
          by: world.appUsername,
          at: Date.now(),
        });
        world.record('ban', world.appUsername, name, {
          duration: opts.duration,
          reason: opts.reason,
        });
      }
    );
    spy('unbanUser', async (username: string, subredditName?: string) => {
      sub(subredditName).bannedUsers.delete(world.user(username).username);
      world.record('unban', world.appUsername, username);
    });
    spy('approveUser', async (username: string, subredditName?: string) => {
      sub(subredditName).approvedUsers.add(world.user(username).username);
      world.record('approveUser', world.appUsername, username);
    });
    spy('removeUser', async (username: string, subredditName?: string) => {
      sub(subredditName).approvedUsers.delete(world.user(username).username);
      world.record('removeApprovedUser', world.appUsername, username);
    });
    spy('muteUser', async (username: string, subredditName?: string) => {
      sub(subredditName).mutedUsers.add(world.user(username).username);
      world.record('mute', world.appUsername, username);
    });
    spy('unmuteUser', async (username: string, subredditName?: string) => {
      sub(subredditName).mutedUsers.delete(world.user(username).username);
      world.record('unmute', world.appUsername, username);
    });

    spy(
      'setUserFlair',
      async (opts: {
        subredditName?: string;
        username: string;
        text?: string;
        flairTemplateId?: string;
        cssClass?: string;
        backgroundColor?: string;
        textColor?: string;
      }) => {
        const flair: FlairRecord = {
          text: opts.text,
          templateId: opts.flairTemplateId,
          cssClass: opts.cssClass,
          backgroundColor: opts.backgroundColor,
          textColor: opts.textColor,
        };
        sub(opts.subredditName).userFlair.set(world.user(opts.username).username, flair);
        world.record('setUserFlair', world.appUsername, opts.username, {
          text: opts.text,
          templateId: opts.flairTemplateId,
        });
      }
    );
    spy('removeUserFlair', async (subredditName: string, username: string) => {
      sub(subredditName).userFlair.delete(world.user(username).username);
      world.record('removeUserFlair', world.appUsername, username);
    });
    spy(
      'setPostFlair',
      async (opts: {
        subredditName?: string;
        postId: T3;
        text?: string;
        flairTemplateId?: string;
        cssClass?: string;
        backgroundColor?: string;
        textColor?: string;
      }) => {
        world.requirePost(opts.postId).flair = {
          text: opts.text,
          templateId: opts.flairTemplateId,
          cssClass: opts.cssClass,
          backgroundColor: opts.backgroundColor,
          textColor: opts.textColor,
        };
        world.record('setPostFlair', world.appUsername, opts.postId, {
          text: opts.text,
          templateId: opts.flairTemplateId,
        });
      }
    );
    spy('removePostFlair', async (_subredditName: string, postId: T3) => {
      world.requirePost(postId).flair = undefined;
      world.record('removePostFlair', world.appUsername, postId);
    });

    spy('getComments', (opts: { postId: T3; limit?: number }) =>
      fakeListing(() => world.topLevelComments(opts.postId), opts.limit)
    );
    spy('getPostsByUser', (opts: { username: string; limit?: number }) =>
      fakeListing(() => world.postsBy(opts.username).map((p) => world.postObject(p)), opts.limit)
    );
    spy('getCommentsByUser', (opts: { username: string; limit?: number }) =>
      fakeListing(
        () => world.commentsBy(opts.username).map((c) => world.commentObject(c)),
        opts.limit
      )
    );
    const subredditPosts = (subredditName: string | undefined, order: 'new' | 'score') =>
      [...world.posts.values()]
        .filter(
          (p) =>
            p.subredditName.toLowerCase() === (subredditName ?? world.subredditName).toLowerCase()
        )
        .sort((a, b) =>
          order === 'new' ? b.createdAt.getTime() - a.createdAt.getTime() : b.score - a.score
        )
        .map((p) => world.postObject(p));
    spy('getNewPosts', (opts: { subredditName?: string; limit?: number }) =>
      fakeListing(() => subredditPosts(opts.subredditName, 'new'), opts.limit)
    );
    for (const name of [
      'getHotPosts',
      'getTopPosts',
      'getRisingPosts',
      'getControversialPosts',
    ] as const) {
      spy(name, (opts: { subredditName?: string; limit?: number }) =>
        fakeListing(() => subredditPosts(opts.subredditName, 'score'), opts.limit)
      );
    }
    type QueueOpts = { subreddit?: string; type?: 'all' | 'post' | 'comment'; limit?: number };
    const queue = (opts: QueueOpts, pred: (r: FakePostRecord | FakeCommentRecord) => boolean) => {
      const name = (opts.subreddit ?? world.subredditName).toLowerCase();
      const things: (FakePostRecord | FakeCommentRecord)[] = [
        ...(opts.type === 'comment' ? [] : [...world.posts.values()]),
        ...(opts.type === 'post' ? [] : world.comments),
      ];
      return things
        .filter((t) => t.subredditName.toLowerCase() === name && !t.deleted && pred(t))
        .map((t) =>
          t.id.startsWith('t3_')
            ? world.postObject(t as FakePostRecord)
            : world.commentObject(t as FakeCommentRecord)
        );
    };
    const reported = (t: FakePostRecord | FakeCommentRecord) =>
      t.reports.length > 0 && !t.ignoringReports && !t.approved;
    spy('getReports', (opts: QueueOpts) => fakeListing(() => queue(opts, reported), opts.limit));
    spy('getModQueue', (opts: QueueOpts) =>
      fakeListing(() => queue(opts, (t) => reported(t) || (t.removed && t.spam)), opts.limit)
    );
    spy('getSpam', (opts: QueueOpts) => fakeListing(() => queue(opts, (t) => t.spam), opts.limit));

    spy(
      'addRemovalNote',
      async (opts: { itemIds: string[]; reasonId: string; modNote?: string }) => {
        for (const id of opts.itemIds)
          world.addNote({
            kind: 'removal',
            redditId: id,
            reasonId: opts.reasonId,
            note: opts.modNote,
          });
      }
    );
    spy(
      'addModNote',
      async (opts: {
        subreddit?: string;
        user: string;
        note: string;
        label?: string;
        redditId?: string;
      }) => {
        world.addNote({
          kind: 'note',
          subredditName: opts.subreddit,
          user: opts.user,
          note: opts.note,
          label: opts.label,
          redditId: opts.redditId,
        });
      }
    );
    spy('getModNotes', (opts: { subreddit?: string; user: string; limit?: number }) =>
      fakeListing(
        () =>
          world.modNotes
            .filter((n) => n.user?.toLowerCase() === opts.user.toLowerCase())
            .map((n) => ({
              id: n.id,
              user: { name: n.user },
              userNote: { note: n.note, label: n.label, redditId: n.redditId },
              createdAt: new Date(n.at),
              operator: { name: n.by },
            })),
        opts.limit
      )
    );

    const wikiObject = (subredditName: string, rec: WikiPageRecord) => ({
      name: rec.name,
      subredditName,
      content: rec.content,
      contentHtml: rec.content,
      revisionId: rec.revisions.at(-1)?.id,
      revisionDate: new Date(rec.revisions.at(-1)?.at ?? Date.now()),
      revisionReason: rec.revisions.at(-1)?.reason,
      revisionAuthor: world.userObject(
        world.user(rec.revisions.at(-1)?.author ?? world.appUsername)
      ),
    });
    spy('getWikiPage', async (subredditName: string, page: string) => {
      const rec = sub(subredditName).wiki.get(page);
      if (!rec)
        throw new NotFoundError(
          `FakeRedditWorld: wiki page r/${subredditName}/wiki/${page} not found`
        );
      return wikiObject(subredditName, rec);
    });
    spy('getWikiPages', async (subredditName: string) => [...sub(subredditName).wiki.keys()]);
    const writeWiki = (
      opts: { subredditName: string; page: string; content: string; reason?: string },
      create: boolean
    ) => {
      const s = sub(opts.subredditName);
      let rec = s.wiki.get(opts.page);
      if (!rec) {
        if (!create) throw new NotFoundError(`FakeRedditWorld: wiki page ${opts.page} not found`);
        rec = { name: opts.page, content: '', revisions: [] };
        s.wiki.set(opts.page, rec);
      }
      rec.content = opts.content;
      rec.revisions.push({
        id: world.nextId('rev'),
        content: opts.content,
        reason: opts.reason,
        author: world.appUsername,
        at: Date.now(),
      });
      world.record(create ? 'createWikiPage' : 'updateWikiPage', world.appUsername, opts.page, {
        reason: opts.reason,
      });
      return wikiObject(s.name, rec);
    };
    spy(
      'createWikiPage',
      async (opts: { subredditName: string; page: string; content: string; reason?: string }) =>
        writeWiki(opts, true)
    );
    spy(
      'updateWikiPage',
      async (opts: { subredditName: string; page: string; content: string; reason?: string }) =>
        writeWiki(opts, false)
    );

    spy('sendPrivateMessage', async (opts: { to: string; subject: string; text: string }) => {
      world.privateMessages.push({
        from: world.appUsername,
        to: opts.to,
        subject: opts.subject,
        text: opts.text,
        at: Date.now(),
      });
      world.record('privateMessage', world.appUsername, opts.to, {
        subject: opts.subject,
        text: opts.text,
      });
    });
    spy(
      'sendPrivateMessageAsSubreddit',
      async (opts: { to: string; subject: string; text: string; fromSubredditName: string }) => {
        const from = `r/${opts.fromSubredditName}`;
        world.privateMessages.push({
          from,
          to: opts.to,
          subject: opts.subject,
          text: opts.text,
          at: Date.now(),
        });
        world.record('privateMessage', from, opts.to, { subject: opts.subject, text: opts.text });
      }
    );

    vi.spyOn(reddit, 'modMail', 'get').mockReturnValue(world.modMailService() as never);
  }

  private modMailService() {
    const world = this;
    const find = (id: string) => {
      const c = world.modmail.find((m) => m.id === id);
      if (!c) throw new NotFoundError(`FakeRedditWorld: modmail conversation ${id} not found`);
      return c;
    };
    const view = (c: ModmailConversation) => ({
      conversation: {
        id: c.id,
        subject: c.subject,
        state: c.state,
        participant: c.participant ? { name: c.participant } : undefined,
        messages: Object.fromEntries(
          c.messages.map((m) => [
            m.id,
            {
              id: m.id,
              author: { name: m.author },
              bodyMarkdown: m.body,
              isInternal: m.isInternal,
            },
          ])
        ),
      },
      messages: Object.fromEntries(
        c.messages.map((m) => [
          m.id,
          { id: m.id, author: { name: m.author }, bodyMarkdown: m.body, isInternal: m.isInternal },
        ])
      ),
    });
    const create = (
      subject: string,
      body: string,
      opts: { subredditName?: string; to?: string; internal?: boolean }
    ) => {
      const convo: ModmailConversation = {
        id: world.nextId('mm'),
        subject,
        subredditName: opts.subredditName ?? world.subredditName,
        participant: opts.to,
        state: 'new',
        messages: [
          {
            id: world.nextId('msg'),
            author: world.appUsername,
            body,
            isInternal: !!opts.internal,
            at: Date.now(),
          },
        ],
      };
      world.modmail.push(convo);
      world.record('modmail', world.appUsername, convo.id, {
        subject,
        to: opts.to,
        internal: opts.internal || undefined,
        text: body,
      });
      return convo;
    };
    return {
      async getConversation(opts: { conversationId: string }) {
        return view(find(opts.conversationId));
      },
      async createModNotification(opts: {
        subject: string;
        bodyMarkdown: string;
        subredditId?: string;
      }) {
        return create(opts.subject, opts.bodyMarkdown, { internal: true }).id;
      },
      async createModInboxConversation(opts: {
        subject: string;
        bodyMarkdown: string;
        subredditId?: string;
      }) {
        return view(create(opts.subject, opts.bodyMarkdown, { internal: true }));
      },
      async createModDiscussionConversation(opts: {
        subject: string;
        bodyMarkdown: string;
        subredditId?: string;
      }) {
        return create(opts.subject, opts.bodyMarkdown, { internal: true }).id;
      },
      async createConversation(opts: {
        subredditName?: string;
        subject: string;
        body: string;
        to?: string | null;
      }) {
        return view(
          create(opts.subject, opts.body, {
            subredditName: opts.subredditName,
            to: opts.to ?? undefined,
          })
        );
      },
      async reply(opts: {
        conversationId: string;
        body: string;
        isInternal?: boolean;
        isAuthorHidden?: boolean;
      }) {
        const c = find(opts.conversationId);
        c.messages.push({
          id: world.nextId('msg'),
          author: world.appUsername,
          body: opts.body,
          isInternal: !!opts.isInternal,
          at: Date.now(),
        });
        c.state = 'inprogress';
        world.record('modmailReply', world.appUsername, c.id, {
          internal: opts.isInternal || undefined,
          text: opts.body,
        });
        return view(c);
      },
      async archiveConversation(id: string) {
        find(id).state = 'archived';
        world.record('modmailArchive', world.appUsername, id);
        return {};
      },
      async unarchiveConversation(id: string) {
        find(id).state = 'inprogress';
        world.record('modmailUnarchive', world.appUsername, id);
        return {};
      },
    };
  }
}
