---

### Which file do I download?

| Platform | Download this | Skip these |
|---|---|---|
| **Windows** | `Kanvaz-Setup-<version>.exe` — the installer (recommended: auto-updates, Start Menu shortcut, "Open with" registration). Or `Kanvaz-<version>.exe` — the **portable** build, no install, no auto-update, run it from anywhere. | `*.blockmap`, `latest.yml` |
| **macOS (Apple Silicon)** | `Kanvaz-<version>-arm64.dmg` — M1/M2/M3/M4 Macs. Open it, drag Kanvaz into Applications. Unsigned (see the README's Gatekeeper note: right-click → Open the first time). | `latest-mac.yml` |
| **macOS (Intel)** | `Kanvaz-<version>.dmg` — pre-2020 or Intel-based Macs (no `-x64` in the filename — electron-builder only suffixes the non-default arch). Same install/Gatekeeper steps as above. Not sure which you have? Apple menu → About This Mac: "Apple" chip = Apple Silicon, "Intel" chip = Intel. | `latest-mac.yml` |
| **Linux** | `Kanvaz-<version>.AppImage` — `chmod +x` it and run; no install step. | `latest-linux.yml` |

Everything else in this release's assets is **not for end users** — they're metadata the app and its build process read automatically:
- **`*.blockmap`, `latest.yml` / `latest-mac.yml` / `latest-linux.yml`** — differential-update metadata `electron-updater` reads when Kanvaz checks for updates. You never open these yourself.
- **`SHA256SUMS-*.txt`** — checksums for the installer built on that platform's CI runner, for anyone who wants to verify a download wasn't corrupted or tampered with (`sha256sum -c SHA256SUMS-windows-latest.txt`, etc.).
- **`kanvaz-*-<version>.zip`** (AI Export, MCP Bridge, Template Maker & Manager, Theme Creator) — official plugin bundles, matching the base install's "Browse Official Plugins" catalog. The base app already lets you install these in one click; these zips exist for offline installs or manual review.
