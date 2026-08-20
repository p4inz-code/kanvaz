# Kanvaz Plugin System — Design Draft

> Status: planning only, no implementation yet. This is a living doc, not a spec commitment.

## Implementation status as of 4.4.0 (read this first)

This doc is the original design vision and predates the actual build — treat
everything below as aspirational unless listed here as shipped.

- **Shipped in 4.2.0:** manifest scan/validation, permission-escalation-
  forces-re-consent, native-dialog-mediated install consent,
  `registerCardType` (with a working create/render/context-menu path),
  `registerTheme` + `applyTheme` (full-peer theme model, live-preview draft
  convention), `registerSettingsPanel`, per-plugin persistent storage
  (`storage.load`/`storage.save`, size-capped), Settings → Plugins UI
  (list/enable/disable/remove/Add-a-Plugin), graceful degradation for
  missing/broken plugin types, a first official plugin (Theme Creator).
- **Shipped in 4.3.0:** `registerCommand` + the Ctrl+K Command Palette (see
  `src/commands.js`), `KanvazPluginAPI.on(event, handler)` for `cardCreate`/
  `cardUpdate`/`cardDelete`/`boardLoad`/`boardSave`/`selectionChange`, and
  the read-only Runtime Data API (`getCards`/`getSelected`/
  `getConnections`/`getActiveBoard`). Theme Creator registers one real
  command ("Randomize Preview") as a working reference example.
- **Shipped in 4.4.0:** a second official plugin, MCP Bridge (local-only MCP
  server exposing the active board to an AI client — see its own README);
  a real, verified `server` permission gate (see the corrected section just
  below — this is narrower than, and architecturally different from, what
  the original "Runtime API surface" section below describes, but it's real
  where the 4.2.0/4.3.0 note below said nothing was); CI packaging of
  official-plugin release assets; the "Browse Official Plugins" catalog tab;
  "Load unpacked plugin" dev-mode loading.
- **NOT yet shipped**, despite being sketched below: `registerPropertyFieldType`,
  generic `KanvazPluginAPI.network`/`.fs` namespaces (nothing in scope
  through 4.4.0 has needed them — see the correction below for why building
  unused permission surface isn't free).
- **Corrected permission model, current as of 4.4.0:** the original plan's
  "If a permission isn't declared... not present to call at all" line under
  Runtime API surface is now real, but narrower and differently-shaped than
  originally sketched. What actually shipped: `KanvazPluginLoader` injects
  plugins ONE AT A TIME and points the bare `window.KanvazPluginAPI` global
  at a scope built specifically for whichever plugin's script is currently
  executing — a permission-gated namespace (today: `mcpBridge`, gated on
  `server`) is genuinely absent from that scope unless declared and
  approved. This is real (verified in a real browser by
  `test/plugin-scope-test.js`, including a regression an early draft
  actually shipped and that test caught), but it is NOT process isolation —
  a plugin's script still shares the renderer's page context and can reach
  `window.KanvazBridge`/`window.KanvazCards`/etc. directly if it goes
  looking, same as always. And it only covers `mcpBridge` today —
  `cardTypes`/`commands`/`network`/`filesystem` remain informational-only in
  the consent dialog text, unchanged from 4.2.0–4.3.0, because nothing
  gates on them and building that gate before anything actually needs it
  would just be unused, untested surface area. See SECURITY.md's "Plugin
  System — trust model" section for the full, current, honest writeup, and
  the security-note comment blocks above the plugin IPC handlers in
  `src/main.js` and above `buildScopedAPI()` in `src/plugin-api.js`. True
  per-plugin process isolation remains tracked as real future work, not a
  4.4.0 claim.

## Design goal

Simple as After Effects *scripting* (drop-in `.jsx`-style scripts, ScriptUI panels) —
never as complex as After Effects *itself* or its native compiled-plugin SDK. No
build step, no separate toolchain, no native code. A plugin author writes plain
JS in the same style Kanvaz's own renderer modules already use (IIFE + globals,
loaded via `<script>` tag, no bundler) and drops it in a folder.

## Why plugins at all

Kanvaz dev winds down after a few more builds. A plugin API is the only way to
get coverage for "innumerous fields of work" (VFX, architecture, fashion,
writing, game dev, etc.) without personally building tooling for each field —
the community can extend it after active development stops. It also gives the
AI integration a clean, fully-removable home: ship it as the first plugin, not
baked into core, so "don't want AI in your build → don't install the plugin"
is literally true.

## Three plugin categories

1. **Visual/structural** — new card types, Properties field types, custom
   panels, pure-CSS themes (zero-code-execution plugins, opens plugin-making
   to non-developers too).
2. **Behavioral/workflow** — commands (named actions bindable to a shortcut
   and/or the command palette), event hooks reacting to app activity.
3. **Data/integration** — import/export formats, AI providers, anything
   needing network or filesystem access.

## File layout

```
%APPDATA%/Kanvaz/plugins/
  my-plugin/
    plugin.json     <- manifest
    main.js         <- entry script, plain JS, no build step
    icon.png        <- optional
    README.md       <- optional
```

## Manifest schema

```json
{
  "id": "com.author.pluginname",
  "name": "Human Readable Name",
  "version": "1.0.0",
  "kanvazApiVersion": 1,
  "entry": "main.js",
  "permissions": ["cardTypes", "commands", "network", "filesystem"],
  "description": "One line.",
  "author": "Name"
}
```

`kanvazApiVersion` is checked against Kanvaz's own internal constant at load
time. Mismatch = plugin is skipped and logged visibly in Settings → Plugins →
Errors, never a silent failure, never a crash.

## Load workflow

1. On launch, main process scans the plugins folder, reads each `plugin.json`,
   validates schema + API version.
2. Any plugin requesting permissions not yet granted triggers a one-time
   install consent dialog listing exactly what it's asking for (same spirit as
   a browser extension permissions prompt). Zero-permission plugins
   auto-approve silently.
3. Approved + enabled plugins get injected as a `<script>` tag *after* all core
   app scripts have loaded, so `KanvazPluginAPI` and every core global already
   exists. The plugin's `main.js` runs top-level and registers itself
   synchronously (`registerCardType`, `registerCommand`, etc.) — same pattern
   every existing Kanvaz module already follows.
4. Settings → Plugins lists installed plugins: name, version, author,
   permissions, enable/disable toggle, "Reveal in folder," "Remove."
   - Disable = don't inject next launch (soft toggle, no file deletion).
   - Remove = delete that plugin's own folder only.
5. Boards containing cards from a since-disabled/removed plugin degrade to a
   generic "Unknown card type (needs plugin: X)" placeholder — same
   graceful-degradation principle as missing-media cards, never a crash.

## Runtime API surface

```js
KanvazPluginAPI.registerCardType(id, {
  label, icon,
  create(x, y),            // -> new card data object
  render(el, card),         // -> populate DOM
  serialize(card),          // -> plain JSON
  deserialize(json),        // -> card object
  contextMenuItems(card)    // -> [{ label, action }]
});

KanvazPluginAPI.registerCommand(id, {
  label,
  run(context),
  shortcut,          // optional, e.g. 'Ctrl+Shift+X'
  showInPalette,     // boolean
  contextMenu        // 'card' | 'canvas' | null
});

KanvazPluginAPI.registerPropertyFieldType(id, {
  label, renderEditor, renderDisplay
});

KanvazPluginAPI.on(event, handler);
// events: cardCreate, cardUpdate, cardDelete, boardLoad, boardSave, selectionChange

KanvazPluginAPI.getCards();
KanvazPluginAPI.getSelected();
KanvazPluginAPI.getConnections();
KanvazPluginAPI.getActiveBoard();

// Real as of 4.4.0, not in the original sketch — added once MCP Bridge
// needed write access and there was no reason to make it reach around
// to the bare KanvazCards global to get it:
KanvazPluginAPI.updateCard(id, patch);   // -> updated card, or null if id doesn't exist
KanvazPluginAPI.setCardTags(id, tags);   // -> updated card, or null if id doesn't exist
KanvazPluginAPI.deleteCard(id);          // undo-reversible, no confirm dialog (that's deliberate — see cards.js)
KanvazPluginAPI.searchCards(query);      // -> matching cards, name/type/tag substring match

// ── Using a GATED namespace (only mcpBridge exists today) ──
// A gated namespace is present on window.KanvazPluginAPI ONLY during
// your own plugin's synchronous top-level script execution — capture
// it into a local variable right away, at the top of your entry file,
// exactly like the existing PLUGIN_ID/document.currentScript
// convention below. Re-reading the bare `KanvazPluginAPI` identifier
// later (inside a button click handler, a registerCommand's run(), a
// storage.load().then(...) callback — anything that runs after your
// own script's initial synchronous pass) will NOT reliably see your
// scope; loading may have moved on to a different plugin's scope, or
// been restored to the base (ungated) one, by the time that callback
// actually runs. Get this wrong and a gated call just throws
// "Cannot read properties of undefined" with no hint why — there's no
// friendlier error, because by the time it happens the reference you
// captured (or didn't) is long gone. This is exactly the same
// reasoning storage's PLUGIN_ID capture already documents, applied to
// a case where getting it wrong doesn't just break one call, it makes
// the whole feature look silently absent.
//
//   (function() {
//     var MY_API = window.KanvazPluginAPI;   // capture NOW, synchronously
//     var PLUGIN_ID = document.currentScript.getAttribute('data-plugin-id');
//
//     someButton.onclick = function() {
//       MY_API.mcpBridge.start();   // correct — uses the captured reference
//       // window.KanvazPluginAPI.mcpBridge.start() here would be WRONG —
//       // don't re-read the bare global from inside a deferred callback.
//     };
//   })();
//
// See official-plugins/mcp-bridge/main.js for the real, working example
// this pattern is drawn from.

KanvazPluginAPI.settings.get(key);
KanvazPluginAPI.settings.set(key, value);
// namespaced per plugin id automatically — can't touch core settings or
// another plugin's settings

KanvazPluginAPI.network.fetch(url, opts);
// only exists on the API object if "network" permission was declared

KanvazPluginAPI.fs.readFile(path);
KanvazPluginAPI.fs.writeFile(path, data);
// only exist if "filesystem" permission declared; routed through IPC with the
// same extension/path guardrails as the existing shell-open-path handler —
// never raw require('fs') in plugin code
```

If a permission isn't declared in the manifest, that namespace is simply
absent from the object handed to the plugin — not just unauthorized, not
present to call at all.

## Command Palette

One generic entry point (Ctrl+Shift+P style) that lists every registered
command from every loaded plugin automatically. This is what makes
"workflow" plugins possible without each one needing bespoke UI — a plugin
registers a command once and it's immediately discoverable and bindable.

## End-user install workflow (no folder-hunting required)

Settings → Plugins tab has a single "Add a Plugin" button.

1. Click it. Kanvaz creates `%APPDATA%/Kanvaz/plugins/` if it doesn't exist yet,
   then opens it in the OS file explorer via the same `shell.openPath` IPC
   handler already built for File reference cards — no new plumbing.
2. User drags the downloaded plugin folder into that window.
3. User alt-tabs back to Kanvaz. On window-focus regained, Kanvaz silently
   re-scans the plugins folder. Any new valid `plugin.json` triggers the
   one-time permissions consent dialog automatically.

No file-system watcher — `fs.watch`-style live detection can fire mid-copy on
a large plugin and try to load a half-written folder. Focus-regained rescan
has no such race, since the user's file-explorer interaction is always
finished by the time they tab back. Keep a manual "Refresh" as a small
fallback in an advanced/kebab menu for edge cases, but it shouldn't be needed
for the common path.

End state: Add a Plugin → drag folder in → tab back → consent dialog if
needed → installed. No manual path-typing, no knowing where `%APPDATA%` is.

## Distribution: core app ships with zero bundled plugins

The base Kanvaz installer never contains any plugin, including official ones —
this is what makes "100% offline by default" true in the strongest sense, not
just true-until-a-toggle. Official first-party plugins (AI suggest-tags,
theme plugin, any future ones) ship as a separate, independently-versioned
release asset — e.g. `kanvaz-official-plugins-1.0.0.zip` alongside
`Kanvaz Setup 4.2.0.exe` on GitHub Releases — and install through the exact
same Add-a-Plugin folder-drop flow as any third-party plugin. Decouples
release cadence (patch the AI plugin without cutting a new Kanvaz release) and
doubles as a dogfooding check: if the official pack can't install the normal
way, the normal way isn't good enough.

Natural later addition, not needed for v1: a "Browse Official Plugins" list in
the same Settings tab, architecturally identical to the existing "Check for
updates" button — one deliberate, disclosed network call, never automatic,
fetching a small plugin-catalog JSON instead of a release manifest. One-click
install with no folder-dragging, for the official pack specifically.

## Dev workflow

- Settings → Developer → "Load unpacked plugin" (Chrome extension dev-mode
  pattern) — point at any folder with a `plugin.json`, loads immediately,
  bypasses the real plugins directory and the consent dialog.
- "Reload plugins" — hot-reload without restarting the app.
- Plugin errors surface in the existing Developer diagnostics panel.

## Build order (draft)

1. Manifest + loader + permissions/consent dialog + card-type registration
   (security/trust foundation — nothing else works without this)
2. Commands API + Command Palette (unlocks workflow plugins specifically)
3. Event hooks + scoped data API (deeper automation)
4. Two flagship plugins proving both ends of the permission spectrum: the AI
   "suggest tags" plugin (full permissions) and a pure-CSS theme plugin (zero
   permissions) — ship as real value *and* as the reference examples other
   authors copy from
5. Scaffold template + written docs — last, only if there's runway left

Steps 1–2 are load-bearing. Everything after is additive and can slip without
blocking the rest.

## Official plugin code style (decided during the 4.2.0 audit)

`test/lint.js`'s strict "var-only" ES5 rule (no `const`/`let`/arrow
functions/`.forEach`) applies only to `src/` — it does NOT apply to
`official-plugins/`, and this is a deliberate decision, not an oversight the
lint scope happened to miss. The var-only rule exists for `src/`'s own
long-term maintainability under Kanvaz's specific historical ES5 constraint;
it isn't a requirement Kanvaz imposes on plugin authors (third-party plugins
obviously aren't bound by it either — a plugin is just a `<script>` tag, it
can use whatever JS the target Electron/Chromium version supports). The
Theme Creator plugin (`official-plugins/theme-creator/main.js`) uses
`.forEach` freely for exactly this reason.

## Known limitation: theme completeness for non-default color schemes

`main.css` has a handful of rules (selected-card shadow softening,
context-menu shadow, hover tint, etc.) scoped to the literal selector
`[data-theme="light"]` rather than driven by the `--color-*` variable
system. A plugin theme (Theme Creator or otherwise) sets `data-theme` to its
own id, never literally `"light"` — so even a deliberately light/white
plugin theme falls back to the dark-tuned versions of those few rules. The
CSS *variable* set itself is complete and verified 1:1 against the Theme
Creator's generator (25/25 color variables match) — this is a smaller,
purely cosmetic gap at the selector level, not a missing-variable bug.
Fixing it properly means deriving those rules from computed luminance in JS
rather than a hardcoded theme-id selector — a scoped future improvement, not
done in 4.2.0.

## Open questions

- Exact shape of the command-palette UI (modal overlay vs. side panel)
- Whether plugin settings get their own Settings sub-page automatically, or
  plugins render their own settings UI into a provided container
- Whether disabled-but-installed plugins should still show in the palette
  (grayed out) or disappear entirely
- Distribution: drop-in folder only for v1, vs. a community-maintained
  GitHub index later
