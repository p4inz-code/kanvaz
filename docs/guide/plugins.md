---
title: "Plugins"
layout: default
---

# Plugins

*Verified against Kanvaz v9.7.0.*

Kanvaz's plugin system lets a JavaScript file extend the app — new
Settings panels, Command Palette entries, themes, or (with explicit
permission) a local server connection. Same trust model as VS Code
extensions: a plugin runs in the app's normal page context, not
physically sandboxed — what's actually enforced is **explicit,
per-permission user approval**, checked again on every update.

## Installing a plugin

Settings → Plugins → **Add a Plugin…**. Kanvaz shows the plugin's
declared permissions before it ever runs — nothing loads until you
approve them. If a later version asks for *more* permissions than you
already approved, that's treated as a fresh, unapproved request; an
old approval never silently covers an escalated one.

## Permissions

A plugin declares what it needs in its manifest; Kanvaz only exposes
the matching API surface. As of this version, `server` (run a local
listener other tools can connect to) is the one gated permission in
active use, declared only by MCP Bridge — see
`KanvazPluginAPI.mcpBridge`, which is simply absent from a plugin's
scoped API unless its manifest declares `server`.

## The four official plugins

| Plugin | What it does |
|---|---|
| **Theme Creator** | Design your own color theme with live preview, save it as a named preset, reset to defaults anytime. Zero permissions. |
| **Template Maker & Manager** | Save any board as a reusable template, manage your collection, browse/install community templates. Zero permissions — see [Templates](templates.md). |
| **MCP Bridge** | Lets an AI assistant read/edit your active board over a local-only connection. Requires `server`. Off by default; every change it makes lands in undo history like a manual edit — see [MCP Bridge](mcp-bridge.md). |
| **AI Export** (added 9.7.0) | Exports the current board or every board as a JSON + Markdown pair any AI agent can read — no MCP connection, no server. Zero permissions. Includes each card's tags, properties, and notes (Note-card text and Annotate-tool labels, merged). |

All four are maintained in this repository (`official-plugins/`) and
published as separate release assets — not bundled into the main
installer, so you only take on a plugin's footprint if you actually
want it.

## For plugin authors

See `docs/PLUGIN_AUTHORING.md` for the full API reference if you're
writing your own.

## Related

- [MCP Bridge](mcp-bridge.md) — the deepest-reaching official plugin, its own full guide
- [Templates](templates.md) — Template Maker in detail
- [Settings](settings.md) — where plugin-contributed panels appear
