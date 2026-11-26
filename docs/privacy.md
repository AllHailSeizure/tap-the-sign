---
layout: default
title: Privacy Policy
permalink: /privacy/
---

# Privacy Policy — Tap the Sign

**Effective Date:** 2026-11-25

## 1. Overview

This Privacy Policy explains what data **Tap the Sign** ("the app") handles when it is installed on a Reddit community through Reddit's Devvit platform. The app adds a **"Tap the Sign"** item to the post menu. When someone uses it on a post, the app comments a "tap the sign" image on that post. If the post's text contains LaTeX math, the app also posts a reply under the image with that math converted to readable Unicode.

## 2. Data the App Processes

- **Post identifier.** The ID of the post the menu action was used on.
- **Post text.** When the action runs, the app reads the post's body text once to find LaTeX math and convert it to Unicode. The text is processed in memory only. It is not stored by the app.
- **Comments the app creates.** The image comment and the optional math reply are posted publicly on Reddit under the app's account. The math reply is distinguished and locked.
- **Once-per-post marker.** A small key in the app's Devvit Redis storage, scoped to the installing subreddit, records that a post has already been tapped. It holds the post ID and no user data, and it stays until the app is uninstalled.
- **Diagnostic logs.** Devvit platform logs record post and comment IDs, character counts, and error messages so the app can be operated and debugged. They do not contain usernames or post text.

The app does **not** record which user used the menu action. It does not collect personal information, and it does not use cookies or tracking.

## 3. Sharing

The app sends no data to third-party services. The sign image is uploaded to Reddit's own media hosting so it can appear in the comment. Data is never sold, used for advertising, or used to train machine-learning models.

## 4. Retention and Deletion

- The once-per-post markers stay in the subreddit's Devvit Redis storage while the app is installed, and are removed when a moderator uninstalls the app.
- Comments posted by the app are normal Reddit comments. Moderators can remove them at any time.
- Log retention is controlled by Reddit's Devvit platform.

## 5. Contact

For questions, or to request removal of a comment, contact the moderators of the subreddit where the app is installed, or open an issue at [github.com/AllHailSeizure/tap-the-sign](https://github.com/AllHailSeizure/tap-the-sign/issues).
