---
title: "Installation & updates"
layout: default
description: "Download, install, verify, update and uninstall Kanvaz on Windows, macOS and Linux."
---

# Installation & updates

*Verified against Kanvaz v9.8.2.*

Kanvaz needs no account, no sign-in, and makes no network call on first launch. Pick the file for your system from the [latest release](https://github.com/p4inz-code/kanvaz/releases/latest).

## Which file do I download?

| Your system | Download | Notes |
|---|---|---|
| Windows | `Kanvaz-Setup-<version>.exe` | The installer. Recommended: Start Menu shortcut, "Open with" registration for supported files, and update checks. |
| | `Kanvaz-<version>.exe` | Portable build. Run it from anywhere, nothing is installed. |
| macOS, Apple Silicon (M1 and newer) | `Kanvaz-<version>-arm64.dmg` | Open it and drag Kanvaz into Applications. |
| macOS, Intel | `Kanvaz-<version>.dmg` | Same steps. There is no `-x64` in this name. |
| Linux | `Kanvaz-<version>.AppImage` | `chmod +x` it and run it. No install step. |

Not sure which Mac you have? Apple menu → About This Mac. A chip named "Apple ..." means Apple Silicon; "Intel" means Intel.

Everything else attached to a release is metadata, not something you open: `.blockmap` files, `latest*.yml` (read by the updater), `SHA256SUMS-*.txt` (checksums), and `kanvaz-*.zip` (the official plugins, which you can also install from inside Kanvaz).

## The first launch: "unsigned app" warnings

Kanvaz is not code-signed (certificates cost money and this app is free). Both warnings below are normal for unsigned software and not a sign that anything is wrong.

Windows: SmartScreen shows "Windows protected your PC." Click More info → Run anyway.

macOS: Gatekeeper says the app "cannot be opened." Right-click (or Control-click) the app and choose Open, then confirm once. After that it opens normally.

Linux: no warning. Make the AppImage executable first:

```bash
chmod +x Kanvaz-*.AppImage
./Kanvaz-*.AppImage
```

The first time you open Kanvaz a short welcome card appears, then the Home Screen. See the [Quick Start](quick-start.html).

## Verify your download (optional)

Each release has a `SHA256SUMS-*.txt` file per platform. Put it in the same folder as the installer and run:

```bash
sha256sum -c SHA256SUMS-windows-latest.txt
```

(use `SHA256SUMS-macos-latest.txt` or `SHA256SUMS-ubuntu-latest.txt` for the other platforms; on macOS `shasum -a 256 -c` works too). On Windows without a `sha256sum` tool, PowerShell can print the hash to compare by eye:

```powershell
Get-FileHash .\Kanvaz-Setup-<version>.exe -Algorithm SHA256
```

## Updating

- Check for updates is a button in the About screen (`I`, or Command Palette → "About Kanvaz"). It is a request you start yourself; Kanvaz never checks in the background on its own.
- On the Windows installer and Linux AppImage builds Kanvaz can download and apply the update.
- On macOS (unsigned) the button points you to the release page; download the new `.dmg` and drag it over the old app.
- The Windows portable build has no installed copy to replace, so it also just points you to the release page; download the new `.exe`.

Your boards are ordinary files on your disk and are not touched by updates. An older Kanvaz can open files saved by a newer version of the same major version; if a file comes from a newer major version Kanvaz warns you that some data may not display correctly.

## Uninstalling

- Windows installer: Settings → Apps → Kanvaz → Uninstall (the same as any installed app).
- Windows portable, Linux AppImage: delete the file.
- macOS: drag Kanvaz out of Applications into the Trash.

Your `.kanvaz` boards are separate files and stay where you saved them.

## Build it yourself

Kanvaz is open source (MIT). Building from source needs Node.js 20+; the commands are in the [README](https://github.com/p4inz-code/kanvaz#build-from-source).

## Next

- [Quick Start](quick-start.html): from install to your first board
- [Troubleshooting](troubleshooting.html)
- [About Kanvaz](about.html): the offline and privacy model
