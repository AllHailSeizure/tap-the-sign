import type { Hono } from 'hono';
import type { TriggerResponse, UiResponse } from '@devvit/web/shared';

/**
 * Drives an app's Hono routes directly in-process inside a `@devvit/test` world
 * without running an HTTP listener or logging in to Reddit.
 */
export class ScenarioRunner {
  constructor(private readonly app: Hono) {}

  async postJson<TResponse = unknown>(path: string, payload: unknown): Promise<TResponse> {
    const res = await this.app.fetch(
      new Request(`http://localhost${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
    );
    if (!res.ok) {
      throw new Error(`Route ${path} failed with HTTP ${res.status}: ${await res.text()}`);
    }
    return (await res.json()) as TResponse;
  }

  trigger(slug: string, event: unknown): Promise<TriggerResponse> {
    return this.postJson<TriggerResponse>(`/internal/triggers/${slug}`, event);
  }

  menu(slug: string, request: unknown): Promise<UiResponse> {
    return this.postJson<UiResponse>(`/internal/menu/${slug}`, request);
  }

  form(slug: string, values: unknown): Promise<UiResponse> {
    return this.postJson<UiResponse>(`/internal/forms/${slug}`, values);
  }
}
