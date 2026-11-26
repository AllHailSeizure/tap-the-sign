# Offline virtual-Reddit test harness

Version: see `HARNESS_VERSION` in `index.ts`. **This folder is owned by
[devvit-app-template](https://github.com/AllHailSeizure/devvit-app-template).
Do not edit it in an app repo.** Run `npm run harness:sync` to pull updates.

Nothing here talks to Reddit. The harness needs no Devvit login. `reddit.com`,
`redd.it`, `redditmedia.com` and `redditstatic.com` are hard-blocked even if a
test tries to stub them.

## Fixtures

```ts
const test = createModTest({ appFactory: createApp, settings: { botSignature: 'I am a bot.' } });

test('…', async ({ world, runner, http, clock, events, configure, mocks }) => { … });
```

Each test gets:

| Fixture             | What it is                                                                             |
| ------------------- | -------------------------------------------------------------------------------------- |
| `world`             | `FakeRedditWorld`: the in-memory Reddit, plus the log of everything the app did        |
| `runner`            | `ScenarioRunner`: simulates Reddit activity, then calls the app's routes               |
| `http`              | `FakeHttp`: per-domain `fetch` stubs                                                   |
| `clock`             | `FakeClock`: `set` / `advance`. `Date` and Redis TTLs follow it                        |
| `events`            | `EventFactory`: builds trigger payloads (PostV2 / CommentV2 / UserV2) from world state |
| `configure(values)` | Merges settings. It throws on keys `devvit.json` does not declare                      |
| `mocks`             | Raw `@devvit/test` mocks: redis, settings, scheduler, media, …                         |

Settings start from the `defaultValue`s in `devvit.json`, as on a fresh install.
Test `settings` are applied on top.

Options for `createModTest`:

- `strictSettings` (default `true`): reject undeclared setting keys.
- `applySettingDefaults` (default `true`).
- `enforceHttpAllowlist` (default `true`).
- `devvitConfig`: an inline config, for tests that do not use `./devvit.json`.
- `extensions`: `world.use(...)` hooks.

Only plain `test(...)` receives fixtures. `test.each` / `test.for` bypass the
wrapper, so loop instead.

## FakeRedditWorld

- **Seed state** (not logged as app actions):
  - `seedPost`, `seedComment` (threaded via `parentId`).
  - `user`, `mod`, `approvedUser`, `banned`, `bot`.
  - `seedUserFlair`, `seedWikiPage`, `seedReport`, `seedModmail`, `subreddit(name)`.
- **Spied `reddit.*` calls**:
  - Posts and comments: `getPostById`, `getCommentById`, `getComments`, `submitComment`, `submitPost`, `submitCustomPost`.
  - Moderation: `remove`, `approve`, `report`.
  - Current, app and other users: `getCurrentUser`, `getCurrentUsername`, `getAppUser`, `getUserByUsername`, `getUserById`, `getCurrentSubreddit`.
  - Subreddit user lists: `getModerators`, `getApprovedUsers`, `getBannedUsers`, `getMutedUsers`, `banUser`, `unbanUser`, `approveUser`, `removeUser`, `muteUser`, `unmuteUser`.
  - Flair: `setUserFlair`, `removeUserFlair`, `setPostFlair`, `removePostFlair`.
  - Listings: `getPostsByUser`, `getCommentsByUser`, `getNewPosts`, `getHotPosts`, `getTopPosts`, `getRisingPosts`, `getControversialPosts`, `getReports`, `getModQueue`, `getSpam`.
  - Notes: `addRemovalNote`, `addModNote`, `getModNotes`.
  - Wiki: `getWikiPage`, `getWikiPages`, `createWikiPage`, `updateWikiPage`.
  - Private messages: `sendPrivateMessage`, `sendPrivateMessageAsSubreddit`.
  - `reddit.modMail`: `reply`, `createConversation`, `createModNotification`, `createModInboxConversation`, `createModDiscussionConversation`, `getConversation`, `archiveConversation`, `unarchiveConversation`.
- **Post and Comment objects**:
  - Fields: `authorName`, `flair`, `locked`, `removed`, `approved`, `stickied`, `distinguishedBy`, `ignoringReports`, `numberOfReports`, `userReportReasons`, …
  - Methods: `addComment` / `reply`, `remove`, `approve`, `lock`, `unlock`, `distinguish(sticky)`, `undistinguish`, `sticky`, `ignoreReports`, `delete`, `edit`, `getAuthor`.
  - Listings: `comments` / `replies`, with `.all()`, `.get(n)` and `for await`.
- **User objects**: `getUserFlairBySubreddit`, `getModPermissionsForSubreddit`, `getPosts`, `getComments`.
- **Rules it enforces**:
  - Replying to a locked post or comment as a non-moderator throws.
  - Replying to a deleted thing throws.
  - A banned user cannot comment.
  - `runAs: 'USER'` comments are authored by the clicking user.
  - The app account (`context.appSlug`, `test-app` in tests) is a moderator.
- **What the app did**:
  - `world.actions`: structured log entries.
  - `world.describeActions(since?)`: snapshot-friendly lines, for example `test-app remove t3_p1` or `test-app comment t3_p1 id=t1_c2 "…"`.
  - Use `world.mark()` with `world.actionsSince(mark)` to look at part of the log.
- **Queries**:
  - `post`, `comment`, `commentsOn`, `commentsInPost`, `appComments`.
  - `isRemoved`, `isModerator`, `userFlair`, `wikiPage`.
  - The raw collections `modmail`, `modNotes` and `privateMessages`.

## ScenarioRunner

- **Low level**:
  - `trigger(slug, event)`, `menu(slug, {location, targetId})`.
  - `form(name, values)`: `name` is a `devvit.json` `forms` key or a slug.
  - `runTask(name)`, `postJson(path, body)`, `request(path, body)` (status + body).
  - `runner.as('modsy')` runs requests as that user. It sets `context.username` and `context.userId`, and `context.postId` / `commentId` for post and comment menus. Moderator-only menu items throw for non-moderators.
- **Simulated activity**: each call changes world state, then fires only the triggers the app declares in `devvit.json`.
  - `userPosts`, `userComments`, `userEditsComment`, `userDeletesPost`, `userDeletesComment`.
  - `report`, `flairPost`, `modAction`, `modRemoves`, `modApproves`, `modBans`.
  - `userModmails`, `install`, `upgrade`.
- **Time**: `advance('2h')` steps the fake clock minute by minute. It runs every `devvit.json` cron task and every job the app queued with `scheduler.runJob` (one-off `runAt` or cron) as it comes due, and returns the task names that ran.
- **Given / when / then**:

  ```ts
  await runner
    .scenario('second post in 24h is removed')
    .given('alice posted this morning', ({ world }) =>
      world.seedPost({ title: 'one', author: 'alice' })
    )
    .when('alice posts again', ({ runner }) => runner.userPosts('alice', { title: 'two' }))
    .then('the app removed it', ({ log }) => expect(log).toContain('test-app remove t3_…'))
    .run();
  ```

  `then` steps receive the app's `actions` / `log` since the first `when`. A failing step names the step and prints the action log.

- **Coverage**: `expectAllEndpointsCovered()` throws if any trigger, menu, form or scheduler endpoint in `devvit.json` was not reached (non-404) by a runner call in the same test file. Put it in a last test in your scenario file.

## FakeHttp

```ts
http.json('api.example.com', { ok: true }, { path: '/v1/thing', method: 'POST' });
http.stub('api.example.com', (call) =>
  (call.json as { q: string }).q === 'x' ? { hit: true } : new Response('no', { status: 404 })
);
http.callsTo('api.example.com'); // recorded calls with parsed JSON bodies
```

- An unstubbed call throws inside the app. It is also recorded, so the test fails at teardown even if the app catches the error.
- Calls to hosts not listed in `devvit.json` `permissions.http.domains` fail the same way. Matching is exact, as on Devvit.
- At teardown the harness yields to the event loop until fetches stop, so un-awaited work (e.g. fire-and-forget remote logging) is checked in the test that started it and cannot leak into the next test.
- To assert on a failure on purpose, check `http.violations`, then clear it with `http.violations.length = 0`.

## Syncing

- `npm run harness:sync` replaces this folder and `scripts/sync-test-harness.mjs` with template `master`, and records the source commit in `.harness-sync.json`.
- `--ref vX` pins a tag or branch. `--source ../devvit-app-template` uses a local checkout.
- `npm run harness:check` (the weekly `harness-drift` workflow) fails when the folder differs from upstream.
- Bump `HARNESS_VERSION` in the template whenever the harness changes.

## Known gaps vs real Devvit

- **Snapshots**: Reddit objects are snapshots built from world state. Real objects also are, but real Listings paginate, while fake ones return a single page.
- **Unspied calls**: `reddit.*` methods not listed above fall through to `@devvit/test`'s partial plugin mocks, which may throw "unimplemented". These include widgets, rules, removal reasons, flair templates, the moderation log, vault, crosspost, polls and `getPostData`. Add them with `world.use(...)`, or upstream them.
- **Permissions**: the harness does not check moderator permissions for the app account; the app is assumed to be a full moderator. Reddit's rate limits, spam filters, AutoModerator and Crowd Control are not modeled.
- **Platform side effects**: triggers fire only when a test calls the runner. Reddit's own events (AutoModerator removals, admin actions, edits by other apps) do not happen on their own. App actions do not re-fire triggers; on Reddit, an app's own comment fires `onCommentCreate` and its own removal fires `onModAction` with the app as moderator. Deliver those yourself (e.g. `runner.modAction('test-app', 'removelink', { targetId })`) when the app depends on them.
- **Event payloads**: they follow the protobuf JSON shapes, but enum fields use numeric values and many optional fields are defaulted. A self post's `url` is its own reddit.com permalink, as in Reddit's API; this is assumed for trigger payloads, not verified against live events. Pass `url: ''` to model a payload with no URL.
- **IDs**: generated ids (`t3_p1`, `t1_c2`, ...) skip ids a test already seeded; seeding a duplicate id throws.
- **Cron**: the matcher runs at minute resolution in UTC. A 6-field (seconds) expression fires once per matching minute. Jobs fire in sequence, not concurrently.
- **Settings**: validation (types, `onValidate` handlers) is not run. Secrets are plain values.
- **Realtime, payments and the client webview** are not modeled. Use `mocks.realtime` / `mocks.media` directly.
