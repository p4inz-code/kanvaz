---

### Which file should I download?

Pick your system below. Everything else in this release is there for the app itself, so you can ignore it.

| Your system | Download | You can ignore |
|---|---|---|
| Windows | `Kanvaz-Setup-<version>.exe` is the installer, and the one I recommend: it updates itself and adds a Start Menu shortcut and "Open with" entries. `Kanvaz-<version>.exe` is a portable copy that needs no install and does not update itself. `Kanvaz-<version>-win.zip` is the unpacked app: unzip it, open the folder and start Kanvaz. It never unpacks itself into a temporary folder, so it is the friendliest choice for locked-down computers and for antivirus programs that dislike the portable copy. | `*.blockmap`, `latest.yml` |
| macOS, Apple Silicon | `Kanvaz-<version>-arm64.dmg` for M1, M2, M3 and M4 Macs. Open it and drag Kanvaz into Applications. The app is not signed, so the first time, right-click it and choose Open (the README has a short Gatekeeper note). | `latest-mac.yml` |
| macOS, Intel | `Kanvaz-<version>.dmg` for Intel-based Macs (there is no `-x64` in the name). Same steps as above. Not sure which Mac you have? Open the Apple menu, choose About This Mac, and look for "Apple" or "Intel" next to Chip or Processor. | `latest-mac.yml` |
| Linux | `Kanvaz-<version>.AppImage`. Run `chmod +x` on it, then start it. There is nothing to install. | `latest-linux.yml` |

The other files in the release are for the app and the build, not for you:
- `*.blockmap` and the `latest*.yml` files tell the built-in updater what changed between versions.
- The `SHA256SUMS-*.txt` files let you check that a download is intact and is the file I built, for example with `sha256sum -c SHA256SUMS-windows-latest.txt`.
- The `kanvaz-*-<version>.zip` files are the four official plugins (AI Export, MCP Bridge, Template Maker & Manager and Theme Creator). The app installs them in one click from Browse Official Plugins. The zips are for offline installs, or if you want to look inside first.
