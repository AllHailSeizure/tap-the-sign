/**
 * Self-tests for the shared harness. They use an inline app and devvit config, so
 * they run unchanged in every repo that syncs this folder.
 */
import { Hono } from 'hono';
import { describe, expect } from 'vitest';
import { context, reddit, redis, scheduler, settings } from '@devvit/web/server';
import type { OnCommentCreateRequest, OnPostSubmitRequest, T1, T3 } from '@devvit/web/shared';
import {
  createModTest,
  cronMatches,
  parseDuration,
  endpointCoverage,
  type DevvitConfig,
} from './index';

const config: DevvitConfig = {
  triggers: {
    onPostSubmit: '/internal/triggers/post-submit',
    onCommentCreate: '/internal/triggers/comment-create',
    onPostReport: '/internal/triggers/post-report',
    onModAction: '/internal/triggers/mod-action',
    onModMail: '/internal/triggers/mod-mail',
    onAppInstall: '/internal/triggers/app-install',
  },
  menu: {
    items: [{ endpoint: '/internal/menu/whoami', forUserType: 'moderator', location: 'post' }],
  },
  forms: { note: '/internal/forms/note' },
  scheduler: {
    tasks: {
      hourly: { endpoint: '/internal/scheduler/hourly', cron: '0 * * * *' },
      later: '/internal/scheduler/later',
    },
  },
  permissions: { http: { domains: ['api.example.com'] } },
  settings: {
    subreddit: {
      enabled: { type: 'boolean', defaultValue: true },
      word: { type: 'string', defaultValue: 'spam' },
    },
  },
};

function createApp(): Hono {
  const app = new Hono();
  app.post('/internal/triggers/post-submit', async (c) => {
    const ev = await c.req.json<OnPostSubmitRequest>();
    const word = (await settings.get<string>('word')) ?? '';
    const post = await reddit.getPostById(ev.post!.id as T3);
    const mods = await reddit
      .getModerators({ subredditName: context.subredditName!, username: ev.author!.name })
      .all();
    if (!mods.length && post.title.includes(word)) {
      const reply = await post.addComment({ text: `Removed: contains "${word}"` });
      await reply.distinguish(true);
      await post.remove();
      await reddit.report(post, { reason: 'word filter' });
    }
    return c.json({ status: 'ok' });
  });
  app.post('/internal/triggers/comment-create', async (c) => {
    const ev = await c.req.json<OnCommentCreateRequest>();
    if (ev.comment!.body.includes('!flair')) {
      const user = await reddit.getUserById(ev.comment!.author as `t2_${string}`);
      await reddit.setUserFlair({
        subredditName: 'testsub',
        username: user!.username,
        text: 'Regular',
      });
      const parent = await reddit.getCommentById(ev.comment!.id as T1);
      await parent.reply({ text: 'Flair set.' });
    }
    return c.json({ status: 'ok' });
  });
  app.post('/internal/triggers/post-report', async (c) => {
    const ev = await c.req.json<{ post: { id: T3 } }>();
    const post = await reddit.getPostById(ev.post.id);
    if (post.authorName === 'AutoModerator') await post.ignoreReports();
    return c.json({ status: 'ok' });
  });
  app.post('/internal/triggers/mod-action', async (c) => {
    const ev = await c.req.json<{ action: string; targetUser?: { name: string } }>();
    await redis.set(`last-action`, `${ev.action}:${ev.targetUser?.name ?? ''}`);
    return c.json({ status: 'ok' });
  });
  app.post('/internal/triggers/mod-mail', async (c) => {
    const ev = await c.req.json<{ conversationId: string }>();
    await reddit.modMail.reply({
      conversationId: ev.conversationId,
      body: 'Thanks, we will look.',
      isInternal: false,
    });
    return c.json({ status: 'ok' });
  });
  app.post('/internal/triggers/app-install', async (c) => {
    await reddit.createWikiPage({
      subredditName: 'testsub',
      page: 'bot/config',
      content: 'installed',
    });
    await scheduler.runJob({ name: 'later', runAt: new Date(Date.now() + 90 * 60_000) });
    return c.json({ status: 'ok' });
  });
  app.post('/internal/menu/whoami', async (c) =>
    c.json({ showToast: `${await reddit.getCurrentUsername()} on ${context.postId}` })
  );
  app.post('/internal/forms/note', async (c) => {
    const values = await c.req.json<{ user: string; note: string }>();
    await reddit.addModNote({
      subreddit: 'testsub',
      user: values.user,
      note: values.note,
      label: 'ABUSE_WARNING',
    });
    return c.json({ showToast: 'Noted.' });
  });
  app.post('/internal/scheduler/hourly', async (c) => {
    await redis.incrBy('hourly-runs', 1);
    return c.json({});
  });
  app.post('/internal/scheduler/later', async (c) => {
    const res = await fetch('https://api.example.com/ping');
    await redis.set('later', await res.text());
    return c.json({});
  });
  return app;
}

const test = createModTest({ appFactory: createApp, devvitConfig: config });

describe('FakeRedditWorld + ScenarioRunner', () => {
  test('settings start from devvit.json defaults', async () => {
    expect(await settings.get('word')).toBe('spam');
    expect(await settings.get('enabled')).toBe(true);
  });

  test('configure() rejects undeclared settings', async ({ configure }) => {
    expect(() => configure({ wrod: 'x' })).toThrow(/not declared/);
    configure({ word: 'buy' });
    expect(await settings.get('word')).toBe('buy');
  });

  test('a user post fires onPostSubmit and the app actions are logged', async ({
    world,
    runner,
  }) => {
    const post = await runner.userPosts('alice', { title: 'spam offer' });
    expect(world.isRemoved(post.id)).toBe(true);
    const [reply] = world.commentsOn(post.id);
    expect(reply).toMatchObject({ authorName: 'test-app', distinguished: true, stickied: true });
    expect(world.describeActions()).toEqual([
      `test-app comment ${post.id} id=${reply?.id} "Removed: contains \\"spam\\""`,
      `test-app distinguish ${reply?.id} sticky=true`,
      `test-app remove ${post.id}`,
      `test-app report ${post.id} reason=word filter`,
    ]);
    expect(world.post(post.id)?.reports).toEqual([
      expect.objectContaining({ reason: 'word filter', mod: true }),
    ]);
  });

  test('moderators are exempt via getModerators', async ({ world, runner }) => {
    world.mod('modsy');
    const post = await runner.userPosts('modsy', { title: 'spam talk' });
    expect(world.isRemoved(post.id)).toBe(false);
    expect(world.actions).toEqual([]);
  });

  test('threaded comments, user lookup by id, flair', async ({ world, runner }) => {
    const post = world.seedPost({ title: 'hello', author: 'alice' });
    const top = await runner.userComments('bob', post.id, 'nice');
    const reply = await runner.userComments('carol', top.id, '!flair please');
    expect(world.userFlair('carol')).toMatchObject({ text: 'Regular' });
    expect(world.commentsOn(reply.id)[0]?.body).toBe('Flair set.');
    const tree = await (await reddit.getPostById(post.id)).comments.all();
    expect(tree.map((c) => c.id)).toEqual([top.id]);
    expect((await tree[0]!.replies.all()).map((c) => c.id)).toEqual([reply.id]);
  });

  test('locked threads reject non-moderator replies', async ({ world }) => {
    const post = world.seedPost({ title: 'locked', locked: true });
    await expect(reddit.submitComment({ id: post.id, text: 'x', runAs: 'USER' })).rejects.toThrow(
      /locked/
    );
    await expect(reddit.submitComment({ id: post.id, text: 'mod note' })).resolves.toBeDefined();
  });

  test('reports, bots and ignoreReports', async ({ world, runner }) => {
    world.bot('AutoModerator');
    const post = world.seedPost({ title: 'automod post', author: 'AutoModerator' });
    await runner.report(post.id, 'spam');
    expect(world.post(post.id)?.ignoringReports).toBe(true);
    expect(await reddit.getReports({ subreddit: 'testsub', type: 'all' }).all()).toHaveLength(0);
  });

  test('mod actions, bans and modmail', async ({ world, runner }) => {
    await runner.modBans('modsy', 'troll', 'rule 1');
    expect(await redis.get('last-action')).toBe('banuser:troll');
    expect(
      await reddit.getBannedUsers({ subredditName: 'testsub', username: 'troll' }).all()
    ).toHaveLength(1);
    const convo = await runner.userModmails('troll', 'Why?', 'Please unban');
    expect(world.modmail[0]?.messages.map((m) => m.author)).toEqual(['troll', 'test-app']);
    expect(world.describeActions().at(-1)).toBe(
      `test-app modmailReply ${convo.id} "Thanks, we will look."`
    );
  });

  test('menus run as the clicking user and moderator-only items are enforced', async ({
    world,
    runner,
  }) => {
    const post = world.seedPost({ title: 'x' });
    world.mod('modsy');
    const res = await runner.as('modsy').menu('whoami', { location: 'post', targetId: post.id });
    expect(res.showToast).toBe(`modsy on ${post.id}`);
    await expect(
      runner.as('alice').menu('whoami', { location: 'post', targetId: post.id })
    ).rejects.toThrow(/moderator-only/);
  });

  test('forms are addressed by devvit.json name; mod notes recorded', async ({ world, runner }) => {
    await runner.as('modsy').form('note', { user: 'alice', note: 'be nice' });
    expect(world.modNotes).toEqual([
      expect.objectContaining({ user: 'alice', note: 'be nice', label: 'ABUSE_WARNING' }),
    ]);
  });

  test('install creates a wiki page and schedules a job that runs when the clock reaches it', async ({
    world,
    runner,
    http,
    clock,
  }) => {
    clock.set('2026-03-01T10:30:00Z');
    http.stub('api.example.com', 'pong', { path: '/ping' });
    await runner.install();
    expect(world.wikiPage('bot/config')?.content).toBe('installed');
    const ran = await runner.advance('2h');
    // hourly cron at 11:00 and 12:00; the one-off job at 12:00
    expect(ran).toEqual(['hourly', 'hourly', 'later']);
    expect(await redis.get('later')).toBe('pong');
    expect(await redis.get('hourly-runs')).toBe('2');
    expect(new Date(clock.now()).toISOString()).toBe('2026-03-01T12:30:00.000Z');
    expect(await runner.advance('1h')).toEqual(['hourly']);
  });

  test('redis TTLs follow the fake clock', async ({ clock }) => {
    clock.set('2026-03-01T00:00:00Z');
    await redis.set('k', 'v', { expiration: new Date(Date.now() + 60_000) });
    clock.advance(30_000);
    expect(await redis.get('k')).toBe('v');
    clock.advance(31_000);
    expect(await redis.get('k')).toBeUndefined();
  });

  test('unstubbed fetch throws in the app and fails the test at teardown', async ({ http }) => {
    await expect(fetch('https://api.example.com/x')).rejects.toThrow(/UNSTUBBED/);
    await expect(fetch('https://www.reddit.com/r/all.json')).rejects.toThrow(/BLOCKED/);
    await expect(fetch('https://elsewhere.test/')).rejects.toThrow(/permissions\.http\.domains/);
    expect(() => http.stub('oauth.reddit.com', {})).toThrow(/refusing/);
    expect(http.violations).toHaveLength(3);
    expect(() => http.assertNoViolations()).toThrow(/3 unexpected fetch/);
    http.violations.length = 0; // acknowledged, so teardown passes
  });

  test('generated ids never collide with ids a test seeded', async ({ world }) => {
    world.seedPost({ id: 't3_p1', title: 'seeded' });
    world.seedComment({ id: 't1_c2', parentId: 't3_p1', body: 'seeded' });
    const p = world.seedPost({ title: 'generated' });
    const c = world.seedComment({ parentId: p.id, body: 'generated' });
    expect([p.id, c.id]).not.toContain('t3_p1');
    expect(c.id).not.toBe('t1_c2');
    expect(() => world.seedPost({ id: 't3_p1', title: 'dup' })).toThrow(/already exists/);
  });

  test('fire-and-forget fetches are checked in the test that started them', async ({ http }) => {
    http.json('api.example.com', { ok: true });
    void Promise.resolve().then(() => fetch('https://api.example.com/late'));
    // No await here: teardown settles the event loop and still sees the call.
    expect(http.calls.length).toBeLessThanOrEqual(1);
  });

  test('clock.advance takes durations', async ({ clock }) => {
    clock.set('2026-03-01T00:00:00Z');
    clock.advance('1d2h');
    expect(new Date(clock.now()).toISOString()).toBe('2026-03-02T02:00:00.000Z');
  });

  test('scenario DSL reports the failing step with the action log', async ({ runner }) => {
    const ok = await runner
      .scenario('filtered post')
      .given('the filter word is spam', async () => expect(await settings.get('word')).toBe('spam'))
      .when('alice posts spam', ({ runner: r }) =>
        r.userPosts('alice', { title: 'spam', id: 't3_s1' })
      )
      .then('the app removed it', ({ world, log }) => {
        expect(world.isRemoved('t3_s1')).toBe(true);
        expect(log).toContain('test-app remove t3_s1');
      })
      .run();
    expect(ok.actions).toHaveLength(4);
    await expect(
      runner
        .scenario('broken')
        .when('bob posts spam', ({ runner: r }) =>
          r.userPosts('bob', { title: 'spam', id: 't3_s2' })
        )
        .then('nothing happened', ({ actions }) => expect(actions).toHaveLength(0))
        .run()
    ).rejects.toThrow(
      /Scenario "broken" failed at then "nothing happened"[\s\S]*test-app remove t3_s2/
    );
  });

  test('coverage tracks every declared endpoint hit in this file', async () => {
    const { missing } = endpointCoverage(config);
    // Every endpoint except the never-clicked ones above has been hit by now.
    expect(missing).toEqual([]);
  });
});

describe('helpers', () => {
  test('cron matcher', () => {
    expect(cronMatches('*/5 * * * *', new Date('2026-01-01T00:10:00Z'))).toBe(true);
    expect(cronMatches('*/5 * * * *', new Date('2026-01-01T00:11:00Z'))).toBe(false);
    expect(cronMatches('0 9 * * 1-5', new Date('2026-01-05T09:00:00Z'))).toBe(true); // Monday
    expect(cronMatches('0 9 * * 1-5', new Date('2026-01-04T09:00:00Z'))).toBe(false); // Sunday
    expect(cronMatches('0 0 1 * *', new Date('2026-02-01T00:00:00Z'))).toBe(true);
    expect(cronMatches('0 0 * * * *', new Date('2026-02-01T05:00:00Z'))).toBe(true); // 6-field
  });

  test('durations', () => {
    expect(parseDuration('1h30m')).toBe(5_400_000);
    expect(parseDuration('7d')).toBe(604_800_000);
    expect(() => parseDuration('soon')).toThrow();
  });
});
