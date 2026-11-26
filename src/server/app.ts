import { Hono } from 'hono';
import { register } from './tap-the-sign';

export function createApp(): Hono {
  const app = new Hono();
  register(app);
  return app;
}
