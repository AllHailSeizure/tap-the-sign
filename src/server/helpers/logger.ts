import { redis, settings } from '@devvit/web/server';

const MAX_LOG_ENTRIES = 500;

export type LogLevel = 'info' | 'warn' | 'error';

function formatLine(level: LogLevel, module: string, message: string, extra?: unknown): string {
  const ts = new Date().toISOString();
  const suffix = extra !== undefined ? ` ${JSON.stringify(extra)}` : '';
  return `[${ts}][${level.toUpperCase()}][${module}] ${message}${suffix}`;
}

function extractLogFields(extra?: unknown): Record<string, unknown> {
  if (!extra || typeof extra !== 'object' || Array.isArray(extra)) return {};
  const { action, reason, userId, postId, commentId, ...rest } = extra as Record<string, unknown>;
  const result: Record<string, unknown> = {};
  if (typeof action === 'string') result.action = action;
  if (typeof reason === 'string') result.reason = reason;
  if (typeof userId === 'string') result.user_id = userId;
  if (typeof postId === 'string') result.post_id = postId;
  if (typeof commentId === 'string') result.comment_id = commentId;
  if (Object.keys(rest).length > 0) result.extra = rest;
  return result;
}

async function persistToSupabase(
  level: LogLevel,
  module: string,
  message: string,
  extra?: unknown
): Promise<void> {
  try {
    const supabaseUrl = (await settings.get<string>('supabaseUrl')) || '';
    const supabaseKey = (await settings.get<string>('supabaseServiceKey')) || '';
    if (!supabaseUrl || !supabaseKey) return;

    const body = { level, module, message, ...extractLogFields(extra) };
    await fetch(`${supabaseUrl}/rest/v1/bot_logs`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${supabaseKey}`,
        apikey: supabaseKey,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal',
      },
      body: JSON.stringify(body),
    });
  } catch {
    // Never let remote logging break bot execution.
  }
}

async function persist(
  level: LogLevel,
  module: string,
  message: string,
  extra?: unknown
): Promise<void> {
  try {
    const ts = Date.now();
    const entry = JSON.stringify({ ts, level, module, message, extra });
    const key = `bot:log:${level}`;
    await redis.zAdd(key, { score: ts, member: entry });
    await redis.zRemRangeByRank(key, 0, -(MAX_LOG_ENTRIES + 1));
  } catch {
    // Never let Redis logging break bot execution.
  }
  void persistToSupabase(level, module, message, extra);
}

export function logger(module: string) {
  return {
    info(message: string, data?: unknown): void {
      console.log(formatLine('info', module, message, data));
      void persist('info', module, message, data);
    },
    warn(message: string, data?: unknown): void {
      console.warn(formatLine('warn', module, message, data));
      void persist('warn', module, message, data);
    },
    error(message: string, err?: unknown, data?: Record<string, unknown>): void {
      const errInfo = err instanceof Error ? { message: err.message, stack: err.stack } : err;
      const payload = { ...(data ?? {}), error: errInfo };
      console.error(formatLine('error', module, message, payload));
      void persist('error', module, message, payload);
    },
  };
}
