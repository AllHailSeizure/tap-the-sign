import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/** The parts of `devvit.json` the harness reads. */
export interface DevvitConfig {
  name?: string;
  triggers?: Record<string, string>;
  menu?: { items?: { endpoint: string; location?: string | string[]; forUserType?: string }[] };
  forms?: Record<string, string>;
  scheduler?: { tasks?: Record<string, string | { endpoint: string; cron?: string }> };
  permissions?: { http?: { enable?: boolean; domains?: string[] } };
  settings?: {
    global?: Record<string, { type?: string; isSecret?: boolean; defaultValue?: unknown }>;
    subreddit?: Record<string, { type?: string; isSecret?: boolean; defaultValue?: unknown }>;
  };
}

export interface SchedulerTask {
  name: string;
  endpoint: string;
  cron?: string;
}

/** Reads `devvit.json` from the working directory (vitest runs from the repo root). */
export function loadDevvitConfig(path = resolve(process.cwd(), 'devvit.json')): DevvitConfig {
  return JSON.parse(readFileSync(path, 'utf8')) as DevvitConfig;
}

export function schedulerTasks(config: DevvitConfig): SchedulerTask[] {
  return Object.entries(config.scheduler?.tasks ?? {}).map(([name, task]) =>
    typeof task === 'string' ? { name, endpoint: task } : { name, ...task }
  );
}

/** Every endpoint the app declares: triggers, menu items, forms and scheduler tasks. */
export function declaredEndpoints(config: DevvitConfig): string[] {
  const endpoints = [
    ...Object.values(config.triggers ?? {}),
    ...(config.menu?.items ?? []).map((item) => item.endpoint),
    ...Object.values(config.forms ?? {}),
    ...schedulerTasks(config).map((task) => task.endpoint),
  ];
  return [...new Set(endpoints)].sort();
}

export function declaredSettingKeys(config: DevvitConfig): Set<string> {
  return new Set([
    ...Object.keys(config.settings?.global ?? {}),
    ...Object.keys(config.settings?.subreddit ?? {}),
  ]);
}

export function declaredHttpDomains(config: DevvitConfig): string[] {
  return config.permissions?.http?.domains ?? [];
}
