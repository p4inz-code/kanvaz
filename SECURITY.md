# Security Policy

## Supported Versions

| Version | Supported |
|---------|-----------|
| 4.2.x   | Yes       |
| < 4.2   | No        |

Only the latest release receives security updates. Kanvaz is a solo-maintained
open-source project — backporting fixes to older versions is not feasible.

## Reporting a Vulnerability

**Do not open a public issue for security vulnerabilities.**

Email **atharva.patil.cg@gmail.com** with:

- A description of the vulnerability
- Steps to reproduce
- The impact (what an attacker could do)
- Your Kanvaz version and OS

You'll receive an acknowledgment within 48 hours. Fixes for confirmed
vulnerabilities will be released as soon as possible and credited in the
changelog (unless you prefer to remain anonymous).

## Security Model

Kanvaz is a **100% offline desktop application**. Key points:

- **No network calls** except an optional, user-initiated "Check for updates"
  button in the About screen. Clicking it fires two independent requests to
  `api.github.com` — the bundled auto-updater's own release check, and a
  separate version-info lookup for the About screen's display — never
  automatically, and never anything else.
- **No telemetry, analytics, or tracking** of any kind.
- **No accounts or authentication** — there's nothing to log into.
- **No remote code execution** — as of 4.1.0, a `.kanvaz` file is a zip
  container (`board.json` plus one file per embedded asset, each with a
  SHA-256 integrity hash) instead of one giant base64-encoded JSON blob.
  `board.json` itself is parsed with `JSON.parse()`, never `eval()`. Files
  saved by 4.0.1 and earlier (plain JSON with base64 media inline) still
  open exactly as before — Kanvaz detects the format automatically and only
  ever writes the new container going forward.
- **Content Security Policy** is enforced via Electron's CSP header, blocking
  inline scripts and restricting network access. As of 4.2.0, `script-src`
  also allows `file:` — narrowly, only to load a user-installed plugin's own
  entry script (see the Plugin System section below). This did not add
  `unsafe-inline` or `unsafe-eval`; those remain fully blocked.
- **All data stays local** — your `.kanvaz` files never leave your machine.

## Plugin System (added in 4.2.0) — trust model

Kanvaz supports third-party plugins (Settings → Plugins → Add a Plugin…).
Read this section before installing one from anywhere other than Kanvaz's own
official-plugins releases.

- **Plugins are never auto-discovered or auto-run.** A plugin only loads
  after you review it in Settings and approve it in a native OS dialog
  (`dialog.showMessageBox`, not a web page element) — something no script
  running inside Kanvaz can script, click, or forge on your behalf.
- **The sandbox model is convention-based, not process-isolated.** This is a
  deliberate design choice, the same trust model browser extensions and VS
  Code extensions use — not an oversight. A plugin's entry script runs in the
  same renderer page context as the rest of Kanvaz, not in a separate
  sandboxed process, iframe, or worker.
- **What that means in practice: an approved plugin has the same access to
  your computer as Kanvaz itself.** The permission list shown in the consent
  dialog (`cardTypes`, `commands`, `network`, `filesystem`) describes what the
  plugin's author *says* it needs — it is not a technical enforcement
  boundary. Kanvaz does not currently sandbox a plugin's code down to only
  its declared permissions. A plugin that declares zero permissions is, from
  a security standpoint, not meaningfully more restricted than one that
  declares all of them.
- **The practical guidance: only approve plugins from developers you trust**,
  the same way you'd vet a browser extension before installing it. Kanvaz's
  own official plugins (published as separate, independently-versioned
  release assets — never bundled into the base installer) are the safest
  starting point.
- **This is disclosed, not hidden**, because pretending otherwise would be
  worse than the limitation itself. Real per-plugin isolation (e.g. one
  sandboxed process/context per plugin) is a larger architecture change
  tracked as possible future work, not implemented as of 4.2.0.

## Known Build-Time Vulnerabilities

`npm audit` reports 6 high-severity vulnerabilities. These are all in
**build-time dependencies** (electron-builder toolchain) and do not affect the
running application. They are intentionally tolerated because upgrading
electron-builder would break the locked build system.
