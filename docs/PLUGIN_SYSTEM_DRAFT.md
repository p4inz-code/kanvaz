# Kanvaz Plugin System — Design Draft

> Status: planning only, no implementation yet. This is a living doc, not a spec commitment.

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

## Open questions

- Exact shape of the command-palette UI (modal overlay vs. side panel)
- Whether plugin settings get their own Settings sub-page automatically, or
  plugins render their own settings UI into a provided container
- Whether disabled-but-installed plugins should still show in the palette
  (grayed out) or disappear entirely
- Distribution: drop-in folder only for v1, vs. a community-maintained
  GitHub index later
