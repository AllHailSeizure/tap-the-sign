# devvit-app-template

Standard template for standalone [Reddit Devvit](https://developers.reddit.com/docs) Web apps under `AllHailSeizure`.

## Included Stack

- **Runtime & SDK:** Node `24` (`.node-version`), `@devvit/web`, `@devvit/start`, `@devvit/shared-types`, and `devvit` CLI pinned consistently (`0.15.6`).
- **Server:** Hono (`src/server/app.ts` separated from `src/server/index.ts` so routes can be tested in-process).
- **Quality gates:** `npm run check` runs `eslint`, `tsc --noEmit` (`strict: true`), `vitest`, and `vite build` (`dist/server/index.cjs`).
- **No-login testing:** `@devvit/test` (`createDevvitTest()`) extended by `FakeRedditWorld` + `ScenarioRunner` (`src/server/test-harness/`) for testing Hono triggers/menus and mocking Moderation/Listing/Flair APIs without logging in to Reddit.
- **Helpers:** Lightweight `logger()` (`src/server/helpers/logger.ts`) and `formatSignature()` (`src/server/helpers/signature.ts`).
- **CI/CD & Legal Docs:** GitHub Actions CI (`ci.yml`), manual lockstep release (`release.yml`), and per-repo GitHub Pages legal site (`docs/` + `pages.yml`).

---

## Creating a New App From This Template

1. On GitHub, click **Use this template → Create a new repository** under `AllHailSeizure` (public, default branch `master`).
2. Clone the new repository and customize these files:
   - `package.json` — set `"name"` to your app slug and `"version"` to your starting 3-part SemVer (e.g. `"0.1.0"` or matching your existing Devvit App Store version).
   - `devvit.json` — set `"name"` to your unique Devvit app slug, update `dev.subreddit`, `permissions`, `triggers`, `menu`, and `settings`.
   - `assets/icon.png` — replace the placeholder icon.
   - `docs/_config.yml` — update `title` and `baseurl` (`"/<your-repo-name>"`).
   - `docs/privacy.md` & `docs/terms.md` — replace `<APP_NAME>` and tailor data/terms sections.
3. Install dependencies and verify locally:

```sh
npm install
npm run check
```

4. Enable **GitHub Pages** in repository **Settings → Pages → Source: GitHub Actions** so `docs/` publishes to `https://allhailseizure.github.io/<repo>/`.
5. Configure the `DEVVIT_AUTH_TOKEN` secret (see below).

---

## Local Commands

```sh
npm run check       # lint + typecheck + test + vite build
npm run lint        # ESLint
npm run typecheck   # tsc --noEmit
npm test            # Vitest (no Reddit login required)
npm run build       # Vite build -> dist/server/index.cjs
npm run dev         # npx devvit playtest (requires Devvit login)
```

### No-Login Testing (`FakeRedditWorld` + `ScenarioRunner`)

`@devvit/test` (`createDevvitTest()`) isolates Redis, Settings, Scheduler, and Context in memory per test, while leaving Reddit Moderation, Listings, and Flair APIs unimplemented. `createModTest()` in `src/server/test-harness/` layers:

- **`FakeRedditWorld`:** stateful in-memory posts/comments and `vi.spyOn` handlers for `reddit.submitComment` and `reddit.remove`, plus a `.use(extension)` hook for adding module-specific spies (`getComments`, `getPostsByUser`, `getModerators`, `setUserFlair`, etc.).
- **`ScenarioRunner`:** calls `createApp().fetch(...)` directly against `/internal/triggers/*`, `/internal/menu/*`, and `/internal/forms/*`.

See `src/server/app.test.ts` for a working example.

---

## Required GitHub Secret (`DEVVIT_AUTH_TOKEN`)

The manual release workflow requires a repository (or organization) secret named **`DEVVIT_AUTH_TOKEN`** containing the **full raw contents** of your logged-in `~/.devvit/token` file:

```sh
npx devvit login
npx devvit whoami
gh secret set DEVVIT_AUTH_TOKEN < ~/.devvit/token
```

On Windows PowerShell:

```powershell
npx devvit whoami
Get-Content -LiteralPath (Join-Path $env:USERPROFILE '.devvit/token') -Raw |
  gh secret set DEVVIT_AUTH_TOKEN
```

> **Security & reliability note:** `DEVVIT_AUTH_TOKEN` is an undocumented CLI environment variable holding your personal Reddit OAuth refresh token — not a scoped CI service account. Keep it strictly on `master` release jobs (never PR workflows), rotate it if compromised, and note that it can expire or require re-login (`devvit login`) if Reddit invalidates sessions.

---

## Versioning & Release Process

### Versioning Rules

- **Strict 3-part SemVer only:** `MAJOR.MINOR.PATCH` (e.g. `1.2.0`). Never use 4-part versions or prerelease suffixes for releases.
- **Lockstep invariant:** Every release keeps four artifacts identical:
  1. `package.json` (`"version": "X.Y.Z"`)
  2. Git tag (`vX.Y.Z`)
  3. GitHub Release (`vX.Y.Z`)
  4. Devvit App Store (`X.Y.Z`)

### Running a Release

1. Merge all changes to `master` and wait for **CI** (`ci.yml`) to pass.
2. Open **Actions → Release Devvit app → Run workflow** on `master`:
   - **`bump`:** `patch`, `minor`, `major`, or `explicit`
   - **`version`:** only fill in when `bump` is `explicit` (e.g. `1.0.0`)
   - **`visibility`:** `unlisted` (default) or `public`
3. The workflow bumps `package.json` & `package-lock.json`, runs `npm run check`, authenticates via `DEVVIT_AUTH_TOKEN`, runs `npx --no devvit publish --version X.Y.Z` (with `DEVVIT_ALLOW_SOURCE_UPLOAD=1` and optional `--public`), commits + tags `vX.Y.Z` on `master`, creates GitHub Release `vX.Y.Z`, and asserts `tag == package.json == Devvit App Store version`.

> Note: `devvit publish` submits a version to Reddit's Developer Portal. Installing/upgrading on a subreddit (`devvit install`) and deploying any external Supabase migrations/functions remain separate steps.
