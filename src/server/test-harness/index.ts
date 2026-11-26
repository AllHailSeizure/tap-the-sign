import type { Hono } from 'hono';
import type { TestAPI } from 'vitest';
import {
  createDevvitTest,
  type DevvitFixtures,
  type DevvitTestConfig,
} from '@devvit/test/server/vitest';
import { FakeRedditWorld, type WorldExtension } from './fake-reddit-world';
import { ScenarioRunner } from './scenario-runner';

export {
  FakeRedditWorld,
  type FakeCommentRecord,
  type FakePostRecord,
  type WorldExtension,
} from './fake-reddit-world';
export { ScenarioRunner } from './scenario-runner';

export interface ModFixtures extends DevvitFixtures {
  world: FakeRedditWorld;
  runner: ScenarioRunner;
}

export interface ModTestOptions extends DevvitTestConfig {
  appFactory: () => Hono;
  extensions?: WorldExtension[];
}

function wrapTestApi<T extends (...args: never[]) => unknown>(
  target: T,
  appFactory: () => Hono,
  extensions: WorldExtension[]
): T {
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
          const world = new FakeRedditWorld(ctx.mocks);
          world.installDefaultSpies();
          for (const ext of extensions) {
            world.use(ext);
          }
          const runner = new ScenarioRunner(appFactory());
          return userFn({ ...ctx, world, runner });
        };
      }
      const result = Reflect.apply(fn, thisArg, args);
      if (typeof result === 'function') {
        return wrapTestApi(result as (...args: never[]) => unknown, appFactory, extensions);
      }
      return result;
    },
    get(fn, prop, receiver) {
      const value = Reflect.get(fn, prop, receiver);
      if (typeof value === 'function') {
        return wrapTestApi(value as (...args: never[]) => unknown, appFactory, extensions);
      }
      return value;
    },
  });
}

export function createModTest(options: ModTestOptions): TestAPI<ModFixtures> {
  const { appFactory, extensions = [], ...devvitConfig } = options;
  const baseTest = createDevvitTest(devvitConfig);
  return wrapTestApi(
    baseTest as unknown as (...args: never[]) => unknown,
    appFactory,
    extensions
  ) as unknown as TestAPI<ModFixtures>;
}
