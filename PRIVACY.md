# Privacy

Kanvaz collects nothing about you. It has no accounts, no telemetry, and no
servers of its own. It is offline by default, and it makes a small, fixed set
of network requests **only when you click something that needs one**, listed
in full below.

*Corrected 2026-09-20: an earlier version of this page said Kanvaz "connects to
nothing." That was wrong — the update check, plugin and template catalogs, and
URL-card previews all make requests. This page now lists every one.*

## What Kanvaz never does

- **No accounts.** There's no sign-up, login, or user identity of any kind.
- **No telemetry or analytics.** Kanvaz does not track usage, errors, or
  any other data, and has no backend to send it to.
- **No cloud storage.** Your boards are saved as `.kanvaz` files on your own
  computer, wherever you choose to save them. Kanvaz never uploads a board,
  a card, or a file anywhere.
- **Your media stays yours.** Images, video, audio, and 3D models you drop onto
  the canvas are embedded directly into your `.kanvaz` file. Nothing leaves
  your machine unless you share that file yourself.
- **Nothing automatic.** No request is made on a timer, at startup, or in the
  background. Every request below happens because you clicked the thing that
  triggers it.

## Every network request Kanvaz can make

| You click… | What is contacted | What is sent | Why |
|---|---|---|---|
| **Check for updates** (Settings / About) | `api.github.com` (GitHub's public releases API) and, if you choose to download, `github.com` release assets | A standard HTTPS request (your IP address and a `Kanvaz` user-agent, as with any web request). No board data. | Find out whether a newer version exists, and download it if you say so. |
| **Browse Official Plugins** | `raw.githubusercontent.com` (a public catalog file in this repo) | A standard HTTPS request. | Show the list of official plugins. |
| **Install a plugin** from that list | `github.com` / GitHub release hosts only (a fixed allowlist) | A standard HTTPS request. | Download the plugin's zip. |
| **Browse community templates** (Template Maker plugin) | `raw.githubusercontent.com` | A standard HTTPS request. | Show the list of community templates. |
| **Fetch preview** on a URL card | **The website you typed into that card** — and, if that page names a preview image, the image's host | A standard request to that site (your IP address, a browser-like user-agent). The link you entered is the only thing revealed. | Read that page's title and thumbnail. Off until you press the button; never on paste, type, or load. Requests to loopback, private-network, link-local, and other reserved addresses are refused, including via redirects. |
| **Open in browser** (URL card, release notes) | Whatever your default browser then loads | The URL is handed to your operating system; Kanvaz itself sends nothing. | Open a link. Only `http(s)` links are opened. |

That is the complete list. GitHub and any site you ask Kanvaz to preview can
see the request the same way they would see any browser request from your IP
address; see GitHub's own privacy statement for how they handle that.

## Local-only features that are *not* network features

- **MCP Bridge** (an optional official plugin, off by default) lets a local AI
  client running on your own machine read and edit the open board through a
  named pipe / Unix socket. It never opens a network port. See `SECURITY.md`
  for its trust model.
- **Smart Search** runs entirely on your device.
- **Crash log.** If Kanvaz hits an unexpected error or the renderer crashes, a
  short record (time, error message, stack trace, Kanvaz version, OS) is
  appended to `crash.log` in Kanvaz's own data folder. It is never uploaded
  anywhere. Your home-directory path is replaced with `~`, it is capped at
  1 MB, and you can delete it any time. If you report a bug you may choose to
  attach it.
- **MCP token file.** While MCP Bridge is on, `mcp-bridge.token` in the data
  folder holds a random access token for the local pipe; it is deleted when the
  bridge stops.
- **Plugins you install can do more than Kanvaz itself.** A plugin runs inside
  the app and, once you approve it, is trusted like a browser extension — it
  is not sandboxed and could make its own network requests. Only install
  plugins from developers you trust. Details in `SECURITY.md`.

If you ever find anything in the source code that contradicts this page,
please open an issue — it would be a bug, not intended behavior.
