# Contributing

Thanks for helping. line-web-research is a small research project, so a short, focused change is the easiest to review.

## Before you start

- For a bug, open an issue with what you did, what you expected and what happened, plus the commit you used, your macOS, Node.js and browser versions, and the version of the LINE extension.
- For a larger change or a new feature, open an issue first so we can agree on the approach.
- For a security problem, follow [SECURITY.md](SECURITY.md) instead.
- Never put LINE code, icons or assets, your login vault, or real chat content in an issue or a pull request.

## Development

You need Node.js 22 or later and your own copy of the official LINE Chrome extension. The README explains how to get the extension and how to start the web version and the Electron version.

```sh
npm start   # the web version
```

The project's test suite is maintained separately and is not part of this repository. In your pull request, describe how you checked the change: what you ran, on which macOS version and browser, and what you saw, including which account features you tried by hand.

## Guidelines

- Match the style of the code around your change.
- Keep the project local: no LAN or public deployment, and no change that weakens the local service's own checks.
- Changes for bulk or automated messaging, advertising or monitoring other people are not accepted.
- Keep README.md and README.zh-TW.md in step, with the same number of lines.
- Code comments are in English and say why, not what.
