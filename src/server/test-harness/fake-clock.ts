import { vi } from 'vitest';

/**
 * Test clock. Real time until the first `set`/`advance`; after that `Date` is
 * frozen at the fake time (only `Date` is faked, so `setTimeout` and promises
 * behave normally). Redis TTLs in `@devvit/test` follow `Date`, so advancing the
 * clock also expires keys.
 */
export class FakeClock {
  private frozen = false;

  now(): number {
    return Date.now();
  }

  date(): Date {
    return new Date(this.now());
  }

  get isFrozen(): boolean {
    return this.frozen;
  }

  set(time: Date | number | string): void {
    if (!this.frozen) {
      vi.useFakeTimers({ toFake: ['Date'] });
      this.frozen = true;
    }
    vi.setSystemTime(new Date(time));
  }

  /** Move time forward by ms or a duration string ('90s', '5m', '2h', '7d'). Does not run jobs; see `runner.advance`. */
  advance(duration: number | string): void {
    this.set(this.now() + parseDuration(duration));
  }

  /** Called by the fixture after each test. */
  restore(): void {
    if (this.frozen) vi.useRealTimers();
    this.frozen = false;
  }
}

const UNIT_MS: Record<string, number> = {
  ms: 1,
  s: 1000,
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000,
  w: 604_800_000,
};

/** `parseDuration('90m')`, `'2h'`, `'7d'`, `'1h30m'`, or a number of ms. */
export function parseDuration(input: string | number): number {
  if (typeof input === 'number') return input;
  let total = 0;
  const re = /(\d+(?:\.\d+)?)\s*(ms|s|m|h|d|w)/g;
  let matched = '';
  for (const m of input.matchAll(re)) {
    total += Number(m[1]) * (UNIT_MS[m[2] ?? 'ms'] ?? 1);
    matched += m[0];
  }
  if (!matched || matched.replace(/\s/g, '') !== input.replace(/\s/g, '')) {
    throw new Error(`Cannot parse duration "${input}"`);
  }
  return total;
}
