import { vi } from 'vitest';

/** Hosts the harness never lets a test reach, even through a stub. */
const REDDIT_HOSTS = [
  /(^|\.)reddit\.com$/i,
  /(^|\.)redd\.it$/i,
  /(^|\.)redditmedia\.com$/i,
  /(^|\.)redditstatic\.com$/i,
];

export function isRedditHost(host: string): boolean {
  return REDDIT_HOSTS.some((re) => re.test(host));
}

export interface HttpCall {
  method: string;
  url: string;
  host: string;
  path: string;
  headers: Record<string, string>;
  body: string | undefined;
  /** Parsed JSON body, if the body was JSON. */
  json: unknown;
}

export type StubResult = Response | string | object | null | undefined;
export type StubHandler = (call: HttpCall) => StubResult | Promise<StubResult>;

interface Stub {
  host: string;
  match: (call: HttpCall) => boolean;
  handler: StubHandler;
  times?: number;
  hits: number;
}

export class UnstubbedFetchError extends Error {}

/**
 * Fake `fetch`: per-domain stubs; unstubbed calls throw inside the app AND are
 * recorded so the test fails at teardown even if the app swallowed the error.
 * reddit.com (and redd.it, redditmedia, redditstatic) is always blocked.
 * If `allowedDomains` is set (from devvit.json `permissions.http.domains`),
 * calls to other hosts fail the same way real Devvit would refuse them.
 */
export class FakeHttp {
  readonly calls: HttpCall[] = [];
  readonly violations: string[] = [];
  private readonly stubs: Stub[] = [];

  constructor(private readonly allowedDomains: string[] | undefined) {}

  install(): void {
    vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => this.handle(input, init));
  }

  /**
   * Stub requests to `host` (exact host, `www.` ignored). `path` narrows by
   * pathname prefix, RegExp on the full URL, or a predicate.
   */
  stub(
    host: string,
    handler: StubHandler | StubResult,
    opts: {
      path?: string | RegExp | ((call: HttpCall) => boolean);
      method?: string;
      times?: number;
    } = {}
  ): this {
    const normalized = host.replace(/^www\./, '').toLowerCase();
    if (isRedditHost(normalized)) {
      throw new Error(
        `FakeHttp: refusing to stub ${host}; the harness never talks to Reddit over HTTP.`
      );
    }
    const { path, method, times } = opts;
    const match = (call: HttpCall): boolean => {
      if (call.host.replace(/^www\./, '') !== normalized) return false;
      if (method && call.method !== method.toUpperCase()) return false;
      if (path === undefined) return true;
      if (typeof path === 'string') return call.path.startsWith(path);
      if (path instanceof RegExp) return path.test(call.url);
      return path(call);
    };
    const fn: StubHandler =
      typeof handler === 'function' ? (handler as StubHandler) : () => handler;
    // Later stubs win, so a test can override a default stub.
    this.stubs.unshift({ host: normalized, match, handler: fn, times, hits: 0 });
    return this;
  }

  /** Shorthand: respond with JSON. */
  json(
    host: string,
    body: unknown,
    opts: Parameters<FakeHttp['stub']>[2] & { status?: number } = {}
  ): this {
    return this.stub(host, () => Response.json(body, { status: opts.status ?? 200 }), opts);
  }

  callsTo(host: string): HttpCall[] {
    const h = host.replace(/^www\./, '').toLowerCase();
    return this.calls.filter((c) => c.host.replace(/^www\./, '') === h);
  }

  /** Throws if any unstubbed / blocked call happened. Called at teardown. */
  assertNoViolations(): void {
    if (this.violations.length) {
      throw new UnstubbedFetchError(
        `FakeHttp: ${this.violations.length} unexpected fetch call(s):\n  ${this.violations.join('\n  ')}\n` +
          'Stub them with http.stub(host, ...) / http.json(host, ...).'
      );
    }
  }

  private async handle(input: Parameters<typeof fetch>[0], init?: RequestInit): Promise<Response> {
    const req = input instanceof Request ? input : new Request(String(input), init);
    const url = new URL(req.url);
    const rawBody =
      init?.body ?? (input instanceof Request ? await input.clone().text() : undefined);
    const body =
      typeof rawBody === 'string'
        ? rawBody
        : rawBody === null || rawBody === undefined
          ? undefined
          : String(rawBody);
    let json: unknown;
    if (body) {
      try {
        json = JSON.parse(body);
      } catch {
        json = undefined;
      }
    }
    const headers: Record<string, string> = {};
    new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined)).forEach(
      (v, k) => {
        headers[k] = v;
      }
    );
    const call: HttpCall = {
      method: (init?.method ?? req.method ?? 'GET').toUpperCase(),
      url: url.toString(),
      host: url.hostname.toLowerCase(),
      path: url.pathname,
      headers,
      body,
      json,
    };
    this.calls.push(call);

    if (isRedditHost(call.host)) {
      return this.fail(
        `BLOCKED ${call.method} ${call.url} (reddit hosts are never reachable from tests)`
      );
    }
    if (this.allowedDomains && !this.domainAllowed(call.host)) {
      return this.fail(
        `${call.method} ${call.url}: host not in devvit.json permissions.http.domains, real Devvit would refuse it`
      );
    }
    const stub = this.stubs.find(
      (s) => (s.times === undefined || s.hits < s.times) && s.match(call)
    );
    if (!stub) return this.fail(`UNSTUBBED ${call.method} ${call.url}`);
    stub.hits++;
    const result = await stub.handler(call);
    if (result instanceof Response) return result;
    if (result === null || result === undefined) return new Response(null, { status: 204 });
    if (typeof result === 'string') return new Response(result, { status: 200 });
    return Response.json(result);
  }

  private domainAllowed(host: string): boolean {
    // Devvit matches exact hostnames; subdomains must be listed separately.
    return (this.allowedDomains ?? []).some((d) => d.toLowerCase() === host);
  }

  private fail(message: string): never {
    this.violations.push(message);
    throw new UnstubbedFetchError(`FakeHttp: ${message}`);
  }
}
