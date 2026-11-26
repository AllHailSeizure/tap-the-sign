import { Hono } from 'hono';
import { reddit, redis, settings } from '@devvit/web/server';
import type {
  MenuItemRequest,
  OnPostSubmitRequest,
  TriggerResponse,
  UiResponse,
  T3,
} from '@devvit/web/shared';
import { logger } from './helpers/logger';
import { formatSignature } from './helpers/signature';

const log = logger('app');

export function createApp(): Hono {
  const app = new Hono();

  app.post('/internal/triggers/post-submit', async (c) => {
    const enabled = (await settings.get<boolean>('enabled')) ?? true;
    if (!enabled) {
      return c.json<TriggerResponse>({ status: 'ok' });
    }

    const event = await c.req.json<OnPostSubmitRequest>();
    const post = event.post;
    if (!post) {
      return c.json<TriggerResponse>({ status: 'ok' });
    }

    const dedupeKey = `app:post-handled:${post.id}`;
    const claimed = await redis.set(dedupeKey, '1', { nx: true });
    if (!claimed) {
      return c.json<TriggerResponse>({ status: 'ok' });
    }
    await redis.expire(dedupeKey, 3600);

    // Replace this scaffold logic with your app's trigger behavior.
    const title = post.title ?? '';
    if (title.includes('[TEST-REMOVE]')) {
      const signature = formatSignature(await settings.get<string>('botSignature'));
      await reddit.submitComment({
        id: post.id as T3,
        text: `Removed by template rule.${signature}`,
      });
      await reddit.remove(post.id as T3, false);
      log.info('Removed test post', { postId: post.id });
    }

    return c.json<TriggerResponse>({ status: 'ok' });
  });

  app.post('/internal/menu/example-action', async (c) => {
    const req = await c.req.json<MenuItemRequest>();
    log.info('Example menu action triggered', { targetId: req.targetId });
    return c.json<UiResponse>({
      showToast: { text: `Action ran on ${req.targetId}.`, appearance: 'success' },
    });
  });

  return app;
}
