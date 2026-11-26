import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, vi } from 'vitest';
import { reddit, redis } from '@devvit/web/server';
import type { MenuItemRequest, T3 } from '@devvit/web/shared';
import { createApp } from './app';
import { createModTest, expectAllEndpointsCovered } from './test-harness';

const test = createModTest({ appFactory: createApp });

const fixture = (name: string): string =>
  readFileSync(fileURLToPath(new URL(`./__fixtures__/${name}`, import.meta.url)), 'utf8');

const tap = (postId: T3): MenuItemRequest => ({ targetId: postId, location: 'post' });

describe('tap-the-sign menu action', () => {
  test('posts the sign image once and claims the post', async ({ world, runner }) => {
    const postId = 't3_plain1' as T3;
    world.seedPost({ id: postId, title: 'A theory of everything', selftext: 'No math here.' });

    const res = await runner.menu('tap-the-sign', tap(postId));

    expect(res.showToast).toEqual({ text: 'Tapped the sign.', appearance: 'success' });
    const comments = world.commentsOn(postId);
    expect(comments).toHaveLength(1);
    expect(comments[0]?.body).toContain('"e":"img"');
    expect(comments[0]?.body).toContain('mediaUrl');
    expect(await redis.get(`tap-the-sign:tapped:${postId}`)).toBe('1');
    // No nontrivial math in the body, so no math reply under the meme.
    expect(world.commentsOn(comments[0]!.id)).toHaveLength(0);
  });

  test('refuses to tap the same post twice', async ({ world, runner }) => {
    const postId = 't3_twice1' as T3;
    world.seedPost({ id: postId, title: 'Twice', selftext: '' });

    await runner.menu('tap-the-sign', tap(postId));
    const second = await runner.menu('tap-the-sign', tap(postId));

    expect(second.showToast).toEqual({ text: 'Already tapped!', appearance: 'neutral' });
    expect(world.commentsOn(postId)).toHaveLength(1);
  });

  test('replies under the meme with Unicode math, then locks and distinguishes it', async ({
    world,
    runner,
  }) => {
    const postId = 't3_math1' as T3;
    world.seedPost({ id: postId, title: 'Clifford seam', selftext: fixture('clifford-seam.md') });

    await runner.menu('tap-the-sign', tap(postId));

    const meme = world.commentsOn(postId)[0];
    expect(meme).toBeDefined();
    const replies = world.commentsOn(meme!.id);
    expect(replies).toHaveLength(1);
    expect(replies[0]?.body.length).toBeGreaterThan(0);
    expect(replies[0]?.locked).toBe(true);
    expect(replies[0]?.distinguished).toBe(true);
  });

  test('releases the claim when the meme comment fails so it can be retried', async ({
    world,
    runner,
  }) => {
    const postId = 't3_fail1' as T3;
    world.seedPost({ id: postId, title: 'Failing', selftext: '' });
    vi.mocked(reddit.submitComment).mockRejectedValueOnce(new Error('boom'));
    vi.spyOn(console, 'error').mockImplementation(() => {});

    const res = await runner.menu('tap-the-sign', tap(postId));

    expect(res.showToast).toEqual({
      text: 'Could not tap the sign: boom',
      appearance: 'neutral',
    });
    expect(await redis.get(`tap-the-sign:tapped:${postId}`)).toBeUndefined();

    const retry = await runner.menu('tap-the-sign', tap(postId));
    expect(retry.showToast).toEqual({ text: 'Tapped the sign.', appearance: 'success' });
  });

  test('a failed math reply leaves the meme and the claim in place', async ({ world, runner }) => {
    const postId = 't3_mathfail' as T3;
    world.seedPost({ id: postId, title: 'Math', selftext: fixture('clifford-seam.md') });
    vi.mocked(reddit.submitComment)
      .mockImplementationOnce(vi.mocked(reddit.submitComment).getMockImplementation()!)
      .mockRejectedValueOnce(new Error('rate limited'));
    vi.spyOn(console, 'error').mockImplementation(() => {});

    const res = await runner.menu('tap-the-sign', tap(postId));

    expect(res.showToast).toEqual({ text: 'Tapped the sign.', appearance: 'success' });
    const [meme] = world.commentsOn(postId);
    expect(world.commentsOn(meme!.id)).toHaveLength(0);
    expect(await redis.get(`tap-the-sign:tapped:${postId}`)).toBe('1');
  });
});

describe('scenarios', () => {
  test('any user can tap the sign on a post from the post menu', async ({ runner }) => {
    await runner
      .scenario('a reader taps the sign')
      .given('alice posts a theory', ({ world }) => {
        world.seedPost({ id: 't3_toe', title: 'TOE', selftext: 'No math.', author: 'alice' });
      })
      .when('bob taps the sign from the post menu', ({ runner: r }) =>
        r.as('bob').menu('tap-the-sign', tap('t3_toe' as T3))
      )
      .then('the app comments the sign image as itself', ({ actions, world }) => {
        expect(actions.map((a) => `${a.actor} ${a.type} ${a.target}`)).toEqual([
          'test-app comment t3_toe',
        ]);
        expect(world.appComments()).toHaveLength(1);
      })
      .run();
  });
});

// Keep last.
test('every devvit.json endpoint has a scenario', () => {
  expectAllEndpointsCovered();
});
