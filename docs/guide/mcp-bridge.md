---
title: "MCP Bridge"
layout: default
---

# MCP Bridge

*Verified against Kanvaz v9.7.0, MCP Bridge plugin v1.5.0.*

MCP Bridge lets an AI assistant — Claude Desktop, Claude Code, or any
other [Model Context Protocol](https://modelcontextprotocol.io)
client — read and edit your active board over a **local-only**
connection. No cloud relay: the AI's tool calls reach Kanvaz through a
named pipe/socket on your own machine.

## Installing and connecting

1. Install MCP Bridge like any [plugin](plugins.md) — Settings →
   Plugins → Add a Plugin. It declares the `server` permission
   (Kanvaz's only in-use gated permission today), so you'll see and
   approve that explicitly.
2. It's **off by default**. Turn it on from its Settings panel, which
   shows the connection status live.
3. Point your MCP client at `official-plugins/mcp-bridge/server.js` —
   a standalone Node process, separate from the Kanvaz app itself,
   that speaks real MCP over stdio and relays to Kanvaz over the local
   socket.

## What it changes, and how safely

Every tool call MCP Bridge makes lands in Kanvaz's own undo history —
**exactly like a manual edit**. If an AI assistant does something you
don't want, `Ctrl+Z` undoes it the same as anything you did by hand.
Every request is also token-authenticated; a client without the right
token is refused, not silently served.

## The 46 tools

| Category | Tools |
|---|---|
| Board | `getActiveBoard`, `createBoard`, `listBoards`, `switchBoard`, `renameBoard`, `deleteBoard`, `saveBoard` |
| Cards | `listCards`, `getCard`, `createCard`, `updateCard`, `deleteCard`, `addReference`, `tagCard`, `search`, `duplicateCard`, `flipCard`, `bringCardToFront`, `sendCardToBack` |
| Layout | `groupCards`, `ungroupCards`, `alignCards`, `distributeCards`, `tidyUp` |
| Connections | `getConnections`, `connectCards`, `removeConnection` |
| Shared cards | `shareCardToBoard`, `unlinkSharedCard` |
| History & view | `undo`, `redo`, `zoomIn`, `zoomOut`, `zoomReset`, `zoomFit`, `toggleMapView` |
| Settings | `getSettings`, `updateSettings` |
| Task Tracker | `listTasks`, `addTask`, `deleteTask`, `toggleTask`, `addSubtask`, `toggleSubtask`, `deleteSubtask`, `setTaskCardLink` |

`alignCards` supports `left`/`right`/`center-h`/`top`/`bottom`/`middle-v`;
`distributeCards` supports the `x`/`y` axis. Installing a plugin isn't
itself a tool — plugin management stays UI-only, deliberately never
exposed to an AI assistant.

## Related

- [Plugins](plugins.md) — installing MCP Bridge, the permission model
- [Task Tracker](task-tracker.md) — what the Task Tracker tools operate on
- [Map View](map-view.md) — what `connectCards`/`removeConnection` visualize
