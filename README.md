# Tap the Sign

A [Reddit Devvit](https://developers.reddit.com/docs) Web app. It adds a **"Tap the Sign"** post-menu action that comments a "tap the sign" image on the post, once per post. If the post body contains LaTeX, the app also replies under the image with the math converted to readable Unicode, then distinguishes and locks that reply.

- **Devvit app:** `tap-the-sign` · **App Store version:** `2.0.1`
- **Legal:** [Terms](https://allhailseizure.github.io/tap-the-sign/terms/) · [Privacy](https://allhailseizure.github.io/tap-the-sign/privacy/)
- Built from [`AllHailSeizure/devvit-app-template`](https://github.com/AllHailSeizure/devvit-app-template). The app was moved out of [`AllHailSeizure/Reddit-Devvit`](https://github.com/AllHailSeizure/Reddit-Devvit) (`tap-the-sign/`, source commit `649cd2a9e8fece8b3253d373f34ff911e42f931e`) with its subfolder git history preserved.

## Layout

| Path | Purpose |
| --- | --- |
| `src/server/tap-the-sign.ts` | Menu route `/internal/menu/tap-the-sign`: Redis once-per-post claim (`tap-the-sign:tapped:{postId}`), image upload, meme comment, and math reply |
| `src/server/latex-unicode.ts` | LaTeX extraction, repair, and Unicode conversion used for the reply |
| `src/server/__fixtures__/` | Real-post fixture for the conversion tests |
| `assets/tap-the-sign.png` | Sign image, inlined into the server bundle at build time |

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

See `src/server/tap-the-sign.test.ts` for working examples.

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
