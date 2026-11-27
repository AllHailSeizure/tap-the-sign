# Contributing to tap-the-sign

## Ground Rules
* **Discuss big changes first.** Open an issue or ping Nate before adding new Devvit triggers, external API domains, or large refactors so we don't duplicate work.
* **File a good issue.** Open a [GitHub issue](https://github.com/AllHailSeizure/tap-the-sign/issues) with steps to reproduce, the subreddit, and expected vs actual behaviour.
* **Work via Pull Requests to `master`.** Never push directly to `master`. Create a feature/fix branch, verify `npm run check` passes, and open a PR.
* **Do not edit `src/server/test-harness/` locally.** The virtual Reddit test harness is synced from `AllHailSeizure/devvit-app-template`. If the harness needs a fix or new fake API, update it upstream in `devvit-app-template` and run `npm run harness:sync`.
* **Keep HTTP permissions minimal.** Every outbound fetch domain must be declared in `devvit.json` under `permissions.http.domains` and stubbed in `FakeHttp` during tests.
* **Code style.** Use type-only imports where the codebase does (`import type { … }`). Avoid `any`.

## Local Setup

### Prerequisites
* Node.js (check `.node-version` in the repo root)
* Reddit Developer CLI (`devvit`) — only required if running live `devvit playtest` sessions

### Quick Start
```bash
# 1. Clone and install
git clone https://github.com/AllHailSeizure/tap-the-sign.git
cd tap-the-sign
npm install

# 2. Run the full local verification suite (no Reddit login required)
npm run check
```

## Available Commands
* `npm run check` — Runs ESLint, TypeScript typecheck (`tsc --noEmit`), Vitest suite, and Vite build (`dist/server/index.cjs`). **Run this before opening a PR.**
* `npm test` — Runs Vitest against the offline `FakeRedditWorld` harness (no Reddit login required).
* `npm run lint` / `npm run typecheck` — Run linter or TypeScript compiler standalone.
* `npm run format` — Formats source with Prettier (config in `.prettierrc`).
* `npm run harness:check` — Verifies `src/server/test-harness/` has not drifted from `devvit-app-template`.
* `npm run dev` — Starts `npx devvit playtest` on a test subreddit (requires `npx devvit login`).

## Writing Tests (`createModTest`)
All server triggers, menus, forms, and scheduled jobs must be covered by Vitest scenarios using `createModTest()`:
* **Use plain `test(...)` calls.** Do not use `test.each` or `test.for`—they bypass the `createModTest()` wrapper and will not receive `world` or `runner`. Loop over cases and call `test(...)` inside the loop instead.
* **Stub all HTTP calls.** Unstubbed `fetch` calls and domains missing from `devvit.json` will automatically fail tests.
* **Endpoint coverage.** `expectAllEndpointsCovered()` fails the suite if any declared endpoint in `devvit.json` lacks a test scenario.

## Workflow & Releases
1. Branch off `master`: `git checkout master && git pull && git checkout -b fix/short-description`
2. Make your changes and add/update tests in `src/server/*.test.ts`.
3. Run `npm run check` and `npm run harness:check` to ensure CI will pass.
4. Open a PR targeting `master`.
5. **Releases are tag-triggered (`vX.Y.Z`) and require Nate's approval.** Do not push version tags or bump `package.json` versions inside feature PRs unless requested.

By contributing, you agree your contributions are licensed under the project's [MIT License](LICENSE).
