# Building a Kanvaz Plugin

A practical, task-oriented guide to writing your own Kanvaz plugin — as
opposed to `docs/PLUGIN_SYSTEM_DRAFT.md`, which is the internal design/status
doc tracking what's shipped vs. planned. Start here if you just want to build
something; check that doc if you want the full history and current permission
model in detail.

A copy-and-rename starting point lives at `docs/plugin-scaffold/` — this doc
walks through what it contains and why.

## The shape of a plugin

A Kanvaz plugin is a folder with two required files:

```
my-plugin/
  plugin.json   ← manifest
  main.js       ← entry script (plain browser JS, no build step required)
```

`plugin.json`:

```json
{
  "id": "yourname.my-plugin",
  "name": "My Plugin",
  "version": "1.0.0",
  "kanvazApiVersion": 1,
  "entry": "main.js",
  "permissions": [],
  "description": "One sentence describing what this does.",
  "author": "Your Name"
}
```

- `id` — reverse-DNS-ish and globally unique; Kanvaz's own official plugins use `studio.northbyte.*`.
- `kanvazApiVersion` — `1` today; this is a compatibility gate, not a version pin — leave it at `1` unless a future Kanvaz release documents a v2.
- `permissions` — an array of permission strings. Leave it empty unless you specifically need a gated capability (see "Permissions" below) — an empty array is what almost every plugin should ship with, including both current official plugins.
- `entry` — the file Kanvaz loads and executes as a plain `<script>`.

`main.js` runs in the same page context as Kanvaz itself (not an iframe, not a
worker) — this is a deliberate, disclosed design choice (see `SECURITY.md`'s
"Plugin System — trust model"), not a sandbox. It's also why installing a
plugin goes through an explicit native-dialog consent step before it ever
runs.

## Loading your plugin while you build it

Settings → Plugins → **Load unpacked plugin** — pick your plugin's folder.
This skips the consent dialog (by design, for local dev) and re-loads the
plugin fresh every time you click it again after editing your files, so your
iteration loop is: edit `main.js` → click "Load unpacked plugin" again → see
the result. No packaging or restart needed.

## The capture-PLUGIN_ID pattern

`document.currentScript` is only reliable during your script's own initial,
synchronous execution — not later, inside a button click handler or a
`storage.load().then(...)` callback. Capture it once, at the top of your file:

```js
(function() {
  var PLUGIN_ID = document.currentScript
    ? document.currentScript.getAttribute('data-plugin-id')
    : 'yourname.my-plugin'; // fallback for manual testing outside Kanvaz's loader

  // ... the rest of your plugin
})();
```

Every `storage.load`/`storage.save` call and every permission check is keyed
off this id, so get it once, up front, exactly like this.

## What's available, unconditionally (no permission needed)

These are on `window.KanvazPluginAPI` for every plugin, always:

- **`registerCardType(id, { render(el, card), create(x, y), label, icon })`** — add a new card type. `render()` is required; `create()` is optional (needed if you want a toolbar/menu entry that makes one).
- **`registerTheme(id, { name, css })`** — `css` must be a complete `:root[data-theme="<id>"] { --color-...: ...; }` block defining every variable the built-in dark/light themes define (see `main.css`'s `:root {}` block for the full list) — a plugin theme is a full peer of "dark"/"light", not a partial override layered on top of one.
- **`registerSettingsPanel(id, { label, render(container) })`** — adds a labeled section to the Settings panel; `render()` hands you a plain empty `<div>`.
- **`registerCommand(id, { label, run(context), shortcut? })`** — adds an entry to the Ctrl+K Command Palette, indistinguishable from a core Kanvaz command once registered.
- **`on(event, handler)`** — subscribe to `cardCreate` / `cardUpdate` / `cardDelete` / `boardLoad` / `boardSave` / `selectionChange`. Returns an unsubscribe function.
- **The read-only Runtime Data API** — `getCards()`, `getSelected()`, `getConnections()`, `getActiveBoard()`.
- **`storage.load(PLUGIN_ID)` / `storage.save(PLUGIN_ID, data)`** — persistent, size-capped, per-plugin JSON storage. Both return Promises.

None of this touches the network or the filesystem outside Kanvaz's own
managed plugin-storage folder — see `SECURITY.md` before reaching for
anything that would.

## Permissions

As of this writing, the only real *gated* namespace is `mcpBridge` (gated on
the `server` permission) — everything listed above is un-gated and always
present. If your plugin doesn't touch MCP Bridge, leave `permissions: []`.

**If you do need a gated namespace**, capture `window.KanvazPluginAPI` into a
local variable at the top of your file (same moment as `PLUGIN_ID` above),
and use that captured reference everywhere below — never re-read the bare
`KanvazPluginAPI` global later from inside a deferred callback. Kanvaz's
loader re-points the bare global at a different, narrower scope for each
plugin as it loads them one at a time; a callback that fires later (a button
click, a `storage.load().then()`) would otherwise silently observe whichever
plugin loaded *last*, not your own scope. `official-plugins/mcp-bridge/main.js`
is the real, working reference for this pattern — read it before requesting
`server` in your own manifest.

## Testing before you ship

- `node test/validate.js` runs Kanvaz's own full suite, including plugin-loader manifest validation and permission-scoping checks — run it against your own dev copy of Kanvaz if you're testing against a local build.
- There is no plugin-specific test runner today. Manual testing via "Load unpacked plugin" is the real verification loop; a broken `render()` degrades gracefully to Kanvaz's built-in "unknown card type" placeholder rather than crashing the board, but test the happy path yourself regardless.

## Packaging for distribution

Zip your plugin's folder (containing `plugin.json` and `main.js`, plus
anything else it needs) and share the zip. A user installs it the same way
regardless of where it came from: Settings → Plugins → Add a Plugin… →
native folder/zip picker → the consent dialog reads your manifest's
`description` and `permissions` back to them before anything runs.

Kanvaz's own official plugins additionally go through
`official-plugins/*` + CI packaging (`.github/workflows/build.yml` zips each
subfolder as a GitHub Release asset) and get listed in
`official-plugins/catalog.json` for the in-app "Browse Official Plugins" tab
— that catalog is Kanvaz's own repo, not something third-party plugins are
added to. Distribute your own plugin however makes sense for you (your own
repo, a zip on a webpage, a Discord server) — Kanvaz doesn't require or
support any particular distribution channel beyond the local folder/zip
picker above.
