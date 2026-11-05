---
title: "Build your first plugin"
layout: default
description: "Write a Kanvaz plugin in about ten minutes: a folder, two files and no build step."
---

# Build your first plugin

*Verified against Kanvaz v9.8.2.*

A Kanvaz plugin is a folder with two files. There is no build step, no framework and nothing to install. You can add your own Command Palette entries, card types, themes and settings panels, and you are free to sell what you make. This page gets a first plugin running, then points to the full reference.

If you only want to use plugins, see [Plugins](plugins.html).

## The folder

```text
card-counter/
  plugin.json   the manifest
  main.js       plain browser JavaScript
```

`plugin.json`:

```json
{
  "id": "yourname.card-counter",
  "name": "Card Counter",
  "version": "1.0.0",
  "kanvazApiVersion": 1,
  "entry": "main.js",
  "permissions": [],
  "description": "Adds a Command Palette entry that tells you how many cards are on the board.",
  "author": "Your Name"
}
```

- `id` must be unique. Use your own name or handle as the prefix.
- `kanvazApiVersion` stays at `1`. It is a compatibility gate, not a counter.
- `permissions` stays empty unless you need a gated feature. Most plugins do not.
- `description` and `permissions` are what the user sees in the consent dialog before the plugin runs.

## The code

`main.js`:

```js
(function() {
  var PLUGIN_ID = document.currentScript
    ? document.currentScript.getAttribute('data-plugin-id')
    : 'yourname.card-counter';

  KanvazPluginAPI.registerCommand('card-counter.count', {
    label: 'Card Counter: Count cards',
    run: function() {
      var cards = KanvazPluginAPI.getCards();
      var selected = KanvazPluginAPI.getSelected();
      var message = 'This board has ' + cards.length + ' cards.';
      if (selected.length) message += ' ' + selected.length + ' selected.';
      KanvazPluginAPI.showToast(message, 'success');
    }
  });
})();
```

Capture `document.currentScript` once at the top, as shown. It is only reliable while your script first runs, not later inside a button click or a promise callback.

The complete example, including a small use of per-plugin storage, is in [`docs/plugin-examples/card-counter`](https://github.com/p4inz-code/kanvaz/tree/main/docs/plugin-examples/card-counter) in the repository.

## Run it

1. Open Settings, then Plugins, and choose Load unpacked plugin.
2. Pick your `card-counter` folder. Loading an unpacked plugin skips the consent dialog, on purpose, for local development.
3. Press `Ctrl+K` and type "count". Your command is in the list, like any built-in one.
4. Edit `main.js`, then choose Load unpacked plugin again. It reloads fresh. No restart.

## What you can use without any permission

| Call | What it does |
|---|---|
| `registerCommand(id, { label, run })` | Adds an entry to the Command Palette |
| `registerCardType(id, { render, create, label, icon })` | Adds a new kind of card |
| `registerTheme(id, { name, css })` | Adds a whole theme |
| `registerSettingsPanel(id, { label, render })` | Adds a section to Settings |
| `on(event, handler)` | Reacts to `cardCreate`, `cardUpdate`, `cardDelete`, `boardLoad`, `boardSave` and `selectionChange` |
| `getCards()`, `getSelected()`, `getConnections()`, `getActiveBoard()` | Reads the board (read-only) |
| `storage.load(id)`, `storage.save(id, data)` | Private JSON storage for your plugin, up to 5 MB |
| `createCardFromData(data, x, y)` | Inserts a card of any type |
| `showToast(message, type)`, `showConfirmDialog(title, message, buttons)` | Kanvaz's own toast and dialog |

None of these touch the network or your files. The one gated feature today is the MCP Bridge namespace, which needs the `server` permission and is not something a first plugin should reach for.

## Share it

Zip the folder and share the zip anywhere: your own site, a repository, a Discord server. People install it from Settings, then Plugins, then Add a Plugin. Kanvaz reads your `description` and `permissions` back to them before anything runs.

You can sell a plugin. Kanvaz takes no cut, requires no registration and has no marketplace. There are no in-app payments, so sell the zip on your own platform. Plugins also cannot phone home: a plugin's own network request is blocked by the page's security policy, so build it as a one-time download.

## Safety, honestly

A plugin runs inside Kanvaz and is trusted like a browser extension once the user approves it. It is not sandboxed. That is why every install goes through an explicit consent step, and why users are asked again if a plugin's files change. Read [Privacy and your data](privacy-and-your-data.html) and the security policy in the repository if you plan to distribute one.

## Where to go next

- The full reference: [PLUGIN_AUTHORING.md](https://github.com/p4inz-code/kanvaz/blob/main/docs/PLUGIN_AUTHORING.md)
- A blank starting point: [`docs/plugin-scaffold`](https://github.com/p4inz-code/kanvaz/tree/main/docs/plugin-scaffold)
- Real examples: the four official plugins in [`official-plugins`](https://github.com/p4inz-code/kanvaz/tree/main/official-plugins)
- Stuck? [Contact and support](contact.html)
