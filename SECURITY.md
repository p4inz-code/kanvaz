# Security Policy

## Supported Versions

| Version | Supported |
|---------|-----------|
| 5.3.x   | Yes       |
| < 5.3   | No        |

Only the latest release receives security updates. Kanvaz is a solo-maintained
open-source project — backporting fixes to older versions is not feasible.

**v5.3.0 is the last actively-developed version of Kanvaz** (see README.md/CHANGELOG.md)
— this does not change how a real, confirmed security vulnerability is handled.
Report it the same way described below; it will still be fixed and released.

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

- **No network calls** except a small, fixed set of user-initiated ones, never
  automatic, never anything else:
  - "Check for updates" (About screen) — two requests to `api.github.com`.
  - "Browse Official Plugins" (Settings → Plugins, added 4.4.0) — one request
    to `raw.githubusercontent.com` for a small, static plugin-catalog JSON
    file, plus one more per plugin you actually choose to install (a
    `github.com/.../releases/download/...` zip; the main process refuses any
    `downloadUrl` that isn't `https://` on `github.com`).
  - **URL card "Fetch preview" button (added 5.0.0)** — only fires when you
    click it on a specific URL card, never on paste/type/load. Requests the
    page's own HTML (capped at 512KB) to read its `<title>`/`og:title` and
    `og:image`, then one more capped request (2MB) for the image itself if
    present. The fetched title/image are embedded into the card and saved
    with the board — reopening a board with an existing preview never
    re-fetches anything.
  - Every network call is made by the **main process**, never a raw `fetch()`
    from the renderer or a plugin's own script — see the CSP note below.
- **MCP Bridge (added 4.4.0, off by default) is local-only, never a network
  feature.** When enabled, Kanvaz listens on a named pipe (Windows) or a Unix
  domain socket (macOS/Linux) for an already-running MCP client on the same
  machine — never a TCP port, never reachable from another computer, and nothing
  it does makes an outbound connection either. See its own README
  (`official-plugins/mcp-bridge/README.md`) for exactly what it can do once
  enabled: every change it makes goes through the same functions the UI itself
  uses, so it's undo-reversible like any manual edit.
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
  `unsafe-inline` or `unsafe-eval`; those remain fully blocked. `connect-src`
  is still scoped to exactly `'self' https://api.github.com` — the 4.4.0
  catalog fetch deliberately does NOT add `raw.githubusercontent.com` there;
  it's fetched by the main process (which isn't CSP-constrained) specifically
  so no renderer/plugin script gains a new fetchable host as a side effect of
  this feature existing.
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
  sandboxed process, iframe, or worker. Full per-plugin process isolation was
  evaluated for the 4.4.0 stretch and explicitly declined (multi-week
  rearchitect, not worth it against a two-version budget and a two-plugin
  official ecosystem) — tracked as deliberate future work, not a gap anyone
  missed.
- **As of 4.4.0, permission-gated capabilities are genuinely absent from an
  unapproved plugin's own view of `KanvazPluginAPI` — not just undocumented,
  and not just at the object-property level.** Concretely: `KanvazPluginAPI.
  mcpBridge` (the only gated namespace that exists today, unlocked by the
  `server` permission) is a real object on the API view a plugin's own script
  sees ONLY if its manifest declares `server` and the user approved it.
  Closes the specific honesty gap the 4.2.0 release first disclosed below,
  verified by an automated browser test (`test/plugin-scope-test.js`) that
  loads two plugins side by side, one with the permission and one without,
  and asserts the one without it truly cannot reach it — including the
  specific bypass an early draft of this actually shipped with and the test
  now guards against: the scope-builder function itself used to be copied
  into every plugin's own scoped object, so ANY plugin could call it on
  itself with a forged permission list and synthesize full access. Caught
  and fixed before release, not after; the test asserts that path is closed.
- **What this does NOT change, and where the real remaining exposure is: a
  plugin's script still shares the renderer's page context**, and the
  `KanvazPluginAPI` scoping above is enforced only at the JS-object level —
  by which object the bare `window.KanvazPluginAPI` identifier happens to
  resolve to at the moment a plugin's own top-level code runs synchronously,
  not by any process, memory, or IPC-transport boundary. `window.KanvazBridge`
  itself — the underlying preload-exposed bridge `KanvazPluginAPI.mcpBridge`
  is a thin wrapper over — is **not** scoped per plugin; it's the one flat
  object every loaded script shares. Concretely, this means:
  - Any plugin, even one declaring zero permissions, can call
    `window.KanvazBridge.on('mcp-invoke', ...)` directly and receive every
    request meant for the approved MCP Bridge plugin, or call
    `window.KanvazBridge.startMcpBridge()` directly and succeed once MCP
    Bridge has ever been approved+enabled — bypassing `KanvazPluginAPI.
    mcpBridge`'s gating entirely, because Electron gives the main process no
    way to tell WHICH script in a shared page context made a given IPC call.
    This is genuinely new risk, not the pre-existing "shared page context"
    trade-off restated: before 4.4.0 there was no channel to an external,
    off-machine process at all. **If you enable MCP Bridge, only install
    OTHER plugins you trust just as much — not only the plugin declaring
    `server`.** Reducing this further requires the same real per-process
    isolation declined below; nothing short of that fully closes it, though
    `KanvazPluginAPI.mcpBridge.onInvoke()` replacing (not stacking) the
    previous listener at least means only one script's handler is ever live
    at a time, not an open-ended broadcast to N simultaneous listeners.
  - `cardTypes`/`commands`/`network`/`filesystem` in the manifest remain
    informational-only in the consent dialog text, exactly as before —
    `server` is the only namespace with real object-level gating, because
    it's the only capability dangerous enough (a local listener another
    process can connect to and drive your board through) to be worth
    building that for in this pass. A plugin declaring zero permissions is
    still, for everything except reaching `mcpBridge` at load time, not
    meaningfully more restricted at the code level than one declaring
    several.
  - Once MCP Bridge is running, the pipe/socket itself has no per-connection
    authentication beyond "you're a process on this machine" — any local
    process running as the same OS user can connect and issue tool calls,
    not only the intended `server.js` shim. This is what "local IPC only"
    protects against network exposure, not against another local program.
- **The practical guidance: only approve plugins from developers you trust**,
  the same way you'd vet a browser extension before installing it. Kanvaz's
  own official plugins (published as separate, independently-versioned
  release assets — never bundled into the base installer) are the safest
  starting point.
- **This is disclosed, not hidden**, because pretending otherwise would be
  worse than the limitation itself. Real per-plugin isolation (e.g. one
  sandboxed process/context per plugin) remains a larger architecture change
  tracked as possible future work, not implemented as of 4.4.0.

### MCP Bridge — a high-permission official plugin, read this if you enable it

`official-plugins/mcp-bridge` is the first official plugin to request the
`server` permission — worth calling out on its own given what that grants.

- **Off by default. Three separate steps to ever turn it on the FIRST time**
  (install, approve the consent dialog, flip the Settings → Plugins → MCP
  Bridge toggle) — none of it auto-starts on its own. After that first time,
  it remembers your own choice and reopens the listener automatically on
  every subsequent launch, the same way autosave-interval or any other
  persisted setting does — it does not re-ask on every single launch. If you
  want it off again, you have to explicitly disable it once; it then stays
  off until you re-enable it.
- **Main-process re-verification, not just the consent dialog.** Every start
  request is re-checked against the plugin's actual on-disk approval state
  (`main.js`'s `mcp-bridge-start` handler) before anything opens — the
  renderer's own say-so is never trusted alone, same discipline as every
  other plugin IPC handler in this codebase.
- **Local IPC only.** A named pipe (Windows) or Unix domain socket
  (macOS/Linux) — never a TCP port. Nothing outside this machine's kernel can
  reach it, full stop; there is no "bound to the wrong interface"
  misconfiguration possible the way there would be with a TCP listener.
- **Card and connection edits land in undo history; board-level and settings
  actions do not.** The card/connection tool handlers call the exact same
  `KanvazCards`/`KanvazConnections` functions the UI itself uses — an
  AI-driven edit is `Ctrl+Z`-reversible exactly like a manual one, by
  construction, not by a separate safety net bolted on afterward. `KanvazHistory`
  is per-board and is cleared on every board switch, so this guarantee does
  NOT extend to `deleteBoard`, `renameBoard`, `switchBoard`, or `updateSettings`
  — there is no undo stack for those. `deleteBoard` specifically requires two
  calls (once without `confirm`, which only returns what would be deleted;
  once with `confirm:true`, which actually deletes) as the safety net instead.
- **As of 4.5.0, the bridge exposes whole-app access** — board management
  (create/list/switch/rename/delete/save), undo/redo, zoom/map-view control,
  and settings (`getSettings`/`updateSettings`) — not just card/connection
  editing. The only carve-out is plugin management itself (installing,
  approving, or toggling plugins): that state lives in a main-process-only
  `plugin-state.json` that `KanvazPluginAPI` has no path to, so it's
  structurally unreachable from any plugin, not merely policy-excluded.
  `updateSettings` is whitelisted to the same `SETTINGS_DEFAULTS` keys the
  Settings UI itself exposes — it cannot write arbitrary keys.
- **A card's embedded media is never sent over the bridge.** `dataUrl` is
  stripped to a boolean `hasMedia` flag before anything crosses the pipe — see
  `official-plugins/mcp-bridge/main.js`'s `sanitizeCard()`.
- **A card's local file path IS sent, on every `listCards`/`getCard`/`search`
  call that touches a file-reference card — not only when you explicitly add
  one.** `sanitizeCard()` redacts `dataUrl` and drops `pluginData`, but does
  NOT redact `card.path` (an absolute OS path — on Windows this reveals your
  username via the home-directory prefix, plus whatever folder structure the
  path implies). This is by design — `addReference`/`createCard type:"file"`
  round-trip a path on purpose — but it's worth stating plainly next to the
  media-stripping bullet above rather than only being implied by the tool
  descriptions in `official-plugins/mcp-bridge/README.md`.

## Known Build-Time Vulnerabilities

`npm audit` reports 6 high-severity vulnerabilities. These are all in
**build-time dependencies** (electron-builder toolchain) and do not affect the
running application. They are intentionally tolerated because upgrading
electron-builder would break the locked build system.
