# Plugin scaffold

A copy-and-rename starting point for a Kanvaz plugin. See
[`docs/PLUGIN_AUTHORING.md`](../PLUGIN_AUTHORING.md) for the full walkthrough.

## Quick start

1. Copy this folder somewhere outside the Kanvaz repo and rename it.
2. Edit `plugin.json` — set a unique `id`, your `name`, and a real `description`.
3. Edit `main.js` — replace the example command/storage/event code with your own.
4. In Kanvaz: Settings → Plugins → **Load unpacked plugin** → pick your folder.
5. Click "Load unpacked plugin" again after every edit to reload it.

This folder is intentionally **not** under `official-plugins/` — that
directory is reserved for Kanvaz's own official, CI-packaged plugins
(`.github/workflows/build.yml` zips every subfolder there as a release
asset). Copy this scaffold out to its own location before building on it.
