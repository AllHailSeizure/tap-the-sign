import { getRequestListener } from '@hono/node-server';
import { createServer, getServerPort } from '@devvit/web/server';
import { createApp } from './app';

const app = createApp();

createServer(getRequestListener(app.fetch.bind(app))).listen(getServerPort());
