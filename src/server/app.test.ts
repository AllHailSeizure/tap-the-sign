import { describe, expect } from 'vitest';
import { redis } from '@devvit/web/server';
import type { MenuItemRequest, OnPostSubmitRequest, T3 } from '@devvit/web/shared';
import { createApp } from './app';
import { createModTest } from './test-harness';

const test = createModTest({
  appFactory: createApp,
  settings: {
    enabled: true,
    botSignature: 'I am a bot.',
  },
});

describe('template app', () => {
  test('ignores normal posts on post-submit trigger', async ({ world, runner }) => {
    const postId = 't3_normal1' as T3;
    world.seedPost({ id: postId, title: 'Normal physics discussion' });

    const res = await runner.trigger('post-submit', {
      type: 'PostSubmit',
      post: { id: postId, title: 'Normal physics discussion' },
    } as unknown as OnPostSubmitRequest);

    expect(res).toEqual({ status: 'ok' });
    expect(world.isRemoved(postId)).toBe(false);
    expect(world.commentsOn(postId)).toHaveLength(0);
    expect(await redis.get(`app:post-handled:${postId}`)).toBe('1');
  });

  test('removes and comments on [TEST-REMOVE] posts via FakeRedditWorld', async ({
    world,
    runner,
  }) => {
    const postId = 't3_remove1' as T3;
    world.seedPost({ id: postId, title: '[TEST-REMOVE] Spam post' });

    await runner.trigger('post-submit', {
      type: 'PostSubmit',
      post: { id: postId, title: '[TEST-REMOVE] Spam post' },
    } as unknown as OnPostSubmitRequest);

    expect(world.isRemoved(postId)).toBe(true);
    const comments = world.commentsOn(postId);
    expect(comments).toHaveLength(1);
    expect(comments[0]?.body).toContain('Removed by template rule.');
    expect(comments[0]?.body).toContain('^I ^am ^a ^bot.');
  });

  test('handles example moderator menu action', async ({ runner }) => {
    const res = await runner.menu('example-action', {
      targetId: 't3_menu1',
      location: 'post',
    } satisfies MenuItemRequest);

    expect(res.showToast).toEqual({
      text: 'Action ran on t3_menu1.',
      appearance: 'success',
    });
  });
});
