# Security Policy

## Supported Versions

| Version | Supported |
|---------|-----------|
| 3.7.x   | Yes       |
| < 3.7   | No        |

Only the latest release receives security updates. Kanvaz is a solo-maintained
open-source project — backporting fixes to older versions is not feasible.

## Reporting a Vulnerability

**Do not open a public issue for security vulnerabilities.**

Email **masteratharva9@gmail.com** with:

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
  button in the About screen (single GET to `api.github.com`).
- **No telemetry, analytics, or tracking** of any kind.
- **No accounts or authentication** — there's nothing to log into.
- **No remote code execution** — `.kanvaz` files are plain JSON with base64
  media. They are parsed with `JSON.parse()`, never `eval()`.
- **Content Security Policy** is enforced via Electron's CSP header, blocking
  inline scripts and restricting network access.
- **All data stays local** — your `.kanvaz` files never leave your machine.

## Known Build-Time Vulnerabilities

`npm audit` reports 6 high-severity vulnerabilities. These are all in
**build-time dependencies** (electron-builder toolchain) and do not affect the
running application. They are intentionally tolerated because upgrading
electron-builder would break the locked build system.
