# Contributing

Thanks for helping improve **Tap the Sign**.

## Report a problem

Open a [GitHub issue](https://github.com/AllHailSeizure/tap-the-sign/issues) with a clear title, what you expected, and what happened. For app behavior on a specific subreddit, your moderators may also be the right first contact.

## Propose a code change

1. Fork the repository on GitHub.
2. Create a branch with a short, descriptive name.
3. Make your change and open a **pull request against `master`**.
4. Describe the change and how you verified it.

Maintainers review PRs when they can; there is no guarantee every contribution will be merged.

## Code style

Match the existing TypeScript in `src/`. The repo uses **ESLint** and **Prettier** (see `eslint.config.mjs` and `.prettierrc`). Before you open a PR, run:

```sh
npm run lint
npm run format
```

Use type-only imports where the codebase already does (`import type { … }`). Avoid `any` unless you have a strong reason and the linter allows it.