---
title: "Privacy and your data"
layout: default
description: "What Kanvaz stores, where it lives, and the complete list of network requests it can make."
---

# Privacy and your data

*Verified against Kanvaz v9.8.2 and the project's PRIVACY.md.*

Kanvaz collects nothing about you. It has no accounts, no telemetry and no servers of its own. This page is the plain-language version of the [privacy policy](https://github.com/p4inz-code/kanvaz/blob/main/PRIVACY.md), which is the source of truth.

## What Kanvaz never does

- No accounts, sign-up or login.
- No usage tracking, analytics or error reporting.
- No cloud storage. Boards are `.kanvaz` files on your own computer.
- No automatic network requests. Nothing is sent on a timer, at startup or in the background.

## Where your data lives

| What | Where |
|---|---|
| Boards | Wherever you saved the `.kanvaz` file |
| Embedded media | Inside the board file, nowhere else |
| Settings, recent boards, crash-recovery copy | Kanvaz's own data folder on your computer, one set per profile |
| Crash log | `crash.log` in the data folder. Local only, capped at 1 MB, with your home path replaced by `~`. You can delete it any time |
| MCP Bridge token | `mcp-bridge.token` in the data folder, only while the bridge is on |

## Every network request Kanvaz can make

Each one happens only because you clicked something.

| You click | What is contacted | Why |
|---|---|---|
| Check for updates | GitHub's public releases API, and GitHub release downloads if you choose to update | See whether a newer version exists |
| Browse Official Plugins | A public catalog file on `raw.githubusercontent.com` | Show the list of official plugins |
| Install a plugin from that list | GitHub release hosts only, from a fixed allowlist | Download the plugin zip |
| Browse community templates | `raw.githubusercontent.com` | Show the template list |
| Fetch a preview on a URL card | The website you typed, and the host of its preview image | Show a title and picture for the link |
| Open a link | Your default browser | Only http and https links are opened |

Those servers can see your IP address the way any website would. Kanvaz sends nothing else about you.

## Things that look like network features but are not

- Smart Search runs entirely on your device.
- MCP Bridge talks to an AI client on the same computer through a local pipe or socket. It never opens a network port.
- AI Export writes files to your disk. It sends nothing.

## Plugins are the one thing to think about

A plugin you approve runs inside Kanvaz and is trusted like a browser extension. It is not sandboxed and could make its own network requests. Only install plugins from developers you trust. Kanvaz asks you to approve a plugin before it runs and asks again if its files change. See [Plugins](plugins.html).

## Found something that contradicts this?

If the source code does something this page does not say, that is a bug. Please [open an issue](https://github.com/p4inz-code/kanvaz/issues/new) or email [atharva.patil.cg@gmail.com](mailto:atharva.patil.cg@gmail.com). For security problems, use email and read the [security policy](https://github.com/p4inz-code/kanvaz/blob/main/SECURITY.md).
