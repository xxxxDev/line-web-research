# Security

## How line-web-research is meant to run

line-web-research is a research prototype for local use on your own Mac, with your own LINE account and your own copy of the LINE Chrome extension. It is not meant for LAN or public deployment.

- The web version's local Node service listens only on `127.0.0.1`. The page talks only to its own origin, and the service forwards requests only to a fixed allowlist of LINE hosts. It checks Host, Origin and Fetch Metadata, does not follow upstream redirects, and does not log headers, cookies, request bodies or query strings.
- To LINE's servers, both versions present the official extension's identity: the web version sends the extension's origin as the `Origin` header of every forwarded request, and the Electron version keeps the extension's ID through its manifest key. See "How compatibility works" in the README.
- In the foreground (`npm start`) the login lives only in memory. The background service keeps each session's LINE cookies encrypted with AES-256-GCM in `~/Library/Application Support/line-web-research/login-vault/`. The 256-bit key is kept only in the macOS Keychain (`local.line-web-research.login-vault.v1`). The folder is 0700 and its files are 0600; ciphertext is bound to the origin (including port) and session. Logging out removes the matching data, and cookies without an expiry time are dropped after 90 days without use.
- The same folder holds `instances.json`, `service.log` (startup status only) and the control socket `service.sock` (mode 0600).
- The Electron version stores its data in `~/Library/Application Support/LINE Electron Prototype`, separate from LINE's official desktop app and Chrome. Its prepared extension has permissions reduced to `storage` and hosts limited to LINE domains.

## Keep in mind

- The login vault is not a chat backup. A program that controls your current macOS account, or can read that browser profile, may still be able to use your login. Do not share your browser profile, `login-vault/` or the Keychain key.
- Copy only the LINE extension's own files into `vendor/line/`. Do not copy anything else from your Chrome profile (cookies, login data and so on), and do not upload or redistribute the extension files.
- Using an unofficial client may violate LINE's terms of service and may get your account restricted.
- The Electron app is named XXNE, so it is not mistaken for LINE's official app. It has no Developer ID signature, notarization or automatic updates.
- A LINE extension update may break the compatibility layer. Only extension version 3.7.2 is supported; other versions are untested.

## Reporting a vulnerability

Please do not open a public issue for a security problem. Email [support@v-ax.com](mailto:support@v-ax.com) instead. You can also use GitHub's **Report a vulnerability** button on this repository.

Include line-web-research, the version or commit, the relevant platform, minimal steps to reproduce, and the expected and observed results. Use fictional data where possible and redact sensitive information from errors or screenshots.

Do not send passwords, tokens, private keys, account data, raw private logs, LINE credentials, login vault contents or chat content. Include only the information needed to reproduce the problem.

For ordinary usage questions and non-sensitive bugs, use this repository's issue tracker.
