---

### Which file do I download?

| Platform | Download this | Skip these |
|---|---|---|
| **Windows** | `Kanvaz Setup <version>.exe` — the installer (recommended: auto-updates, Start Menu shortcut, "Open with" registration). Or `Kanvaz <version>.exe` — the **portable** build, no install, no auto-update, run it from anywhere. | `*.blockmap`, `latest.yml` |
| **macOS** | `Kanvaz-<version>-arm64.dmg` — open it, drag Kanvaz into Applications. Unsigned (see the README's Gatekeeper note: right-click → Open the first time). | `latest-mac.yml` |
| **Linux** | `Kanvaz-<version>.AppImage` — `chmod +x` it and run; no install step. | `latest-linux.yml` |

Everything else in this release's assets is **not for end users** — they're metadata the app and its build process read automatically:
- **`*.blockmap`, `latest.yml` / `latest-mac.yml` / `latest-linux.yml`** — differential-update metadata `electron-updater` reads when Kanvaz checks for updates. You never open these yourself.
- **`SHA256SUMS-*.txt`** — checksums for the installer built on that platform's CI runner, for anyone who wants to verify a download wasn't corrupted or tampered with (`sha256sum -c SHA256SUMS-windows-latest.txt`, etc.).
- **`kanvaz-*-<version>.zip`** (MCP Bridge, Template Maker & Manager, Theme Creator) — official plugin bundles, matching the base install's "Browse Official Plugins" catalog. The base app already lets you install these in one click; these zips exist for offline installs or manual review.
