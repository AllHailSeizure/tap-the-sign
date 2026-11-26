import type { Hono } from 'hono';
import type { TestAPI } from 'vitest';
import {
  createDevvitTest,
  type DevvitFixtures,
  type DevvitTestConfig,
} from '@devvit/test/server/vitest';
import {
  declaredHttpDomains,
  declaredSettingKeys,
  loadDevvitConfig,
  type DevvitConfig,
} from './devvit-config';
import { EventFactory } from './events';
import { FakeClock } from './fake-clock';
import { FakeHttp } from './fake-http';
import { FakeRedditWorld, type WorldExtension } from './fake-reddit-world';
import { ScenarioRunner } from './scenario-runner';

/** Bumped whenever the harness changes; apps record the version they synced. */
export const HARNESS_VERSION = '2.1.0';

export * from './fake-reddit-world';
export {
  ScenarioRunner,
  Scenario,
  type StepContext,
  type RequestOptions,
  type RouteResult,
} from './scenario-runner';
export { EventFactory } from './events';
export {
  FakeHttp,
  UnstubbedFetchError,
  isRedditHost,
  type HttpCall,
  type StubHandler,
} from './fake-http';
export { FakeClock, parseDuration } from './fake-clock';
export { cronMatches } from './cron';
export { endpointCoverage, expectAllEndpointsCovered } from './coverage';
export {
  declaredEndpoints,
  loadDevvitConfig,
  schedulerTasks,
  type DevvitConfig,
} from './devvit-config';

export interface ModFixtures extends DevvitFixtures {
  world: FakeRedditWorld;
  runner: ScenarioRunner;
  http: FakeHttp;
  clock: FakeClock;
  events: EventFactory;
  /** Merge settings for this test; throws on keys devvit.json does not declare. */
  configure: (values: Record<string, unknown>) => void;
}

export interface ModTestOptions extends DevvitTestConfig {
  appFactory: () => Hono;
  extensions?: WorldExtension[];
  /** devvit.json contents; defaults to ./devvit.json from the working directory. */
  devvitConfig?: DevvitConfig;
  /** Reject settings keys that devvit.json does not declare. Default true. */
  strictSettings?: boolean;
  /** Seed settings with devvit.json `defaultValue`s, as an install would. Default true. */
  applySettingDefaults?: boolean;
  /** Enforce devvit.json `permissions.http.domains` in FakeHttp. Default true. */
  enforceHttpAllowlist?: boolean;
}

function settingDefaults(config: DevvitConfig): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const scope of [config.settings?.global, config.settings?.subreddit]) {
    for (const [key, def] of Object.entries(scope ?? {})) {
      if (def.defaultValue !== undefined) out[key] = def.defaultValue;
    }
  }
  return out;
}

function checkKeys(config: DevvitConfig, values: Record<string, unknown>, where: string): void {
  const declared = declaredSettingKeys(config);
  const unknown = Object.keys(values).filter((k) => !declared.has(k));
  if (unknown.length) {
    throw new Error(
      `${where}: settings not declared in devvit.json: ${unknown.join(', ')} ` +
        '(typo? or pass strictSettings: false)'
    );
  }
}

/** Yields to the event loop until no new fetches have been made for a few turns. */
async function settle(http: FakeHttp): Promise<void> {
  let quiet = 0;
  for (let i = 0; i < 50 && quiet < 3; i++) {
    const before = http.calls.length;
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    quiet = http.calls.length === before ? quiet + 1 : 0;
  }
}

function wrapTestApi<T extends (...args: never[]) => unknown>(
  target: T,
  options: ModTestOptions,
  config: DevvitConfig
): T {
  const { appFactory, extensions = [] } = options;
  return new Proxy(target, {
    apply(fn, thisArg, argArray: unknown[]) {
      const args = [...argArray];
      let lastFnIndex = -1;
      for (let i = args.length - 1; i >= 0; i--) {
        if (typeof args[i] === 'function') {
          lastFnIndex = i;
          break;
        }
      }
      if (lastFnIndex !== -1) {
        const userFn = args[lastFnIndex] as (ctx: ModFixtures) => unknown;
        args[lastFnIndex] = async (ctx: DevvitFixtures) => {
          if (options.applySettingDefaults !== false) {
            ctx.mocks.settings.set({ ...settingDefaults(config), ...(options.settings ?? {}) });
          }
          const world = new FakeRedditWorld(ctx.mocks, {
            subredditName: ctx.subredditName,
            subredditId: ctx.subredditId,
            username: ctx.username,
            userId: ctx.userId,
          });
          world.installDefaultSpies();
          const http = new FakeHttp(
            options.enforceHttpAllowlist === false ? undefined : declaredHttpDomains(config)
          );
          http.install();
          const clock = new FakeClock();
          for (const ext of extensions) world.use(ext);
          const runner = new ScenarioRunner(appFactory(), {
            world,
            config,
            headers: ctx.headers,
            mocks: ctx.mocks,
            clock,
            http,
          });
          const configure = (values: Record<string, unknown>) => {
            if (options.strictSettings !== false) checkKeys(config, values, 'configure()');
            ctx.mocks.settings.update(values);
          };
          let failure: unknown;
          try {
            await userFn({
              ...ctx,
              world,
              runner,
              http,
              clock,
              events: new EventFactory(world),
              configure,
            });
          } catch (err) {
            failure = err;
          } finally {
            // Let fire-and-forget work (e.g. un-awaited remote logging) finish inside
            // the test that started it, so its fetches are checked here and do not
            // leak into the next test.
            await settle(http);
            clock.restore();
          }
          if (failure !== undefined) throw failure;
          http.assertNoViolations();
        };
      }
      const result = Reflect.apply(fn, thisArg, args);
      if (typeof result === 'function') {
        return wrapTestApi(result as (...args: never[]) => unknown, options, config);
      }
      return result;
    },
    get(fn, prop, receiver) {
      const value = Reflect.get(fn, prop, receiver);
      if (typeof value === 'function') {
        return wrapTestApi(value as (...args: never[]) => unknown, options, config);
      }
      return value;
    },
  });
}

/**
 * `test` with `{ world, runner, http, clock, events, configure }` fixtures on top
 * of `@devvit/test`. Only plain `test(...)` calls get the fixtures (see README).
 */
export function createModTest(options: ModTestOptions): TestAPI<ModFixtures> {
  const config = options.devvitConfig ?? loadDevvitConfig();
  const { username, userId, subredditName, subredditId, settings, appConfig, strictSettings } =
    options;
  const devvitConfig: DevvitTestConfig = {
    username,
    userId,
    subredditName,
    subredditId,
    settings,
    appConfig,
  };
  if (strictSettings !== false && options.settings)
    checkKeys(config, options.settings, 'createModTest()');
  const baseTest = createDevvitTest(devvitConfig);
  return wrapTestApi(
    baseTest as unknown as (...args: never[]) => unknown,
    options,
    config
  ) as unknown as TestAPI<ModFixtures>;
}
