import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, vi } from 'vitest';
import { reddit, redis } from '@devvit/web/server';
import type { MenuItemRequest, T3 } from '@devvit/web/shared';
import { createApp } from './app';
import { createModTest } from './test-harness';

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
});
