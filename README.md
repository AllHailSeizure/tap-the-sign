# Tap the Sign

**One tap on a post. A sign image appears in the comments—and when the post hides math in LaTeX, a locked, easy-to-read Unicode reply shows up underneath.**

A [Reddit Devvit](https://developers.reddit.com/docs) app for communities that love the “tap the sign” meme and want math-heavy posts to stay readable for everyone.

<!-- SCREENSHOT: Post menu open on a thread, with "Tap the Sign" visible among the actions -->

> 📸 Screenshot coming soon: the post **⋯** menu with **Tap the Sign** highlighted.

## What it does

- **Sign image comment** — Someone uses **Tap the Sign** on a post. The app posts a “tap the sign” image as a comment from the app account.
- **Once per post** — Each post can only be tapped once while the app stays installed. A second try shows a neutral toast: *Already tapped!*
- **LaTeX → Unicode (when it applies)** — If the post body contains non-trivial LaTeX math, the app replies under the sign image with that math converted to readable Unicode text. That reply is **distinguished** and **locked**.
- **No math, no extra reply** — Posts with plain text only get the sign image; no follow-up comment.
- **Graceful failures** — If posting the image fails, the “already tapped” lock is cleared so someone can try again. If only the math reply fails, the sign image stays and the post still counts as tapped.

The LaTeX conversion is **best effort**. It is not a full TeX engine; complex layout (big fractions, matrices, etc.) may look flattened or imperfect. See [Terms of Service](https://allhailseizure.github.io/tap-the-sign/terms/) for the accuracy disclaimer.

## Who can use it

The post-menu action is available to **any signed-in Reddit user** on posts in a subreddit where the app is installed—not moderators only.

## Install the app on your subreddit

1. Sign in as a **moderator** of the subreddit.
2. Open Reddit’s **Developer** / **Mod Tools** flow for [Devvit apps](https://developers.reddit.com/docs) and install **Tap the Sign** (`tap-the-sign`) on your community.  
   *(Use the listing or install link Reddit provides for this app; the maintainers publish version **2.0.1** to the Devvit App Store.)*
3. Confirm the app is enabled. No in-app settings or configuration screen is required—the menu item appears on posts automatically.

To remove the app, uninstall it from the same Devvit / mod tools area. That clears the per-post “already tapped” markers stored for your subreddit (see [Privacy Policy](https://allhailseizure.github.io/tap-the-sign/privacy/)).

## How to use it

1. Open a **post** in a subreddit where **Tap the Sign** is installed.
2. Open the post **⋯** (overflow) menu.
3. Choose **Tap the Sign**.

### What you’ll see

| Result | Toast message |
| --- | --- |
| Success | **Tapped the sign.** (success) |
| Post already tapped | **Already tapped!** (neutral) |
| Error (e.g. Reddit API issue) | **Could not tap the sign:** *reason* (neutral) |

### Example: post with LaTeX

After a successful tap on a physics post, the thread might look like this:

```text
[Post author’s text with \( \mathcal{H} \) and other LaTeX…]

  └─ [App] (image: tap the sign)
       └─ [App, distinguished, locked] Unicode lines derived from the post’s math
```

### Example: plain post

```text
[Post with no LaTeX math]

  └─ [App] (image: tap the sign)
       (no second comment)
```

### Rules of thumb

- **One tap per post** — Encourage users to tap once; repeats are blocked on purpose.
- **Comments are public** — Image and math replies are normal Reddit comments from the app. Mods can remove them anytime.
- **No user tracking** — The app does not record *who* tapped; it only remembers *which posts* were already tapped.

There are **no** slash commands, chat triggers, mod configuration forms, or scheduled jobs in this app—only the **Tap the Sign** post menu item.

## Legal & support

- [Terms of Service](https://allhailseizure.github.io/tap-the-sign/terms/)
- [Privacy Policy](https://allhailseizure.github.io/tap-the-sign/privacy/)
- Questions or bug reports: [GitHub Issues](https://github.com/AllHailSeizure/tap-the-sign/issues)  
  For comment removal, contact your subreddit’s moderators.

## License

This project is licensed under the **MIT License** — see [LICENSE](LICENSE). Copyright (c) 2026 Nate Bosma.

Want to suggest a code change? See **[CONTRIBUTING.md](CONTRIBUTING.md)**.