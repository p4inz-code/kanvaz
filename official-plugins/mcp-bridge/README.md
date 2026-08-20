# MCP Bridge — official Kanvaz plugin

Lets an MCP-compatible AI client (Claude Desktop, Claude Code, or any other
tool that speaks [MCP](https://modelcontextprotocol.io)) read and edit your
active Kanvaz board over a local-only connection.

- **Off by default.** Installing this plugin does nothing until you approve
  it (native OS consent dialog, same as any other Kanvaz plugin) and then
  flip it on in Settings → Plugins → MCP Bridge.
- **Local only, always.** Kanvaz listens on a named pipe (Windows) or a Unix
  domain socket (macOS/Linux) — never a TCP port, never reachable from
  another machine. Nothing about this plugin makes an outbound network call.
- **Every change is a normal Kanvaz edit.** Card create/update/delete/tag/
  connect all go through the exact same functions the UI itself uses, so
  everything the AI does lands in undo history — `Ctrl+Z` reverts it exactly
  like a manual edit would.

## Install

Same as any other plugin: Settings → Plugins → Add a Plugin, drop this
folder in, approve the "run a local server" permission when asked.

## Set up your MCP client

This plugin ships two parts:

1. **`main.js`** — runs *inside* Kanvaz (the renderer plugin you just
   installed). It's what actually answers tool calls.
2. **`server.js`** — a *separate*, plain Node.js script that speaks the real
   MCP protocol over stdio. Your AI client spawns this itself; Kanvaz never
   runs or manages it.

Install `server.js`'s own dependencies once:

```bash
cd path/to/this/plugin/folder
npm install
```

Then point your MCP client at it. For Claude Desktop, add this to your
`claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "kanvaz": {
      "command": "node",
      "args": ["/absolute/path/to/official-plugins/mcp-bridge/server.js"]
    }
  }
}
```

For Claude Code, add an MCP server the same way via its own MCP config (see
Claude Code's docs for the exact file/command for your setup) — the
`command`/`args` shape is the same.

Restart your client, open Kanvaz with a board loaded, enable MCP Bridge in
Settings → Plugins, and the tools below become available.

## Troubleshooting

"Could not reach Kanvaz" from a tool call means either Kanvaz isn't running,
or MCP Bridge isn't enabled in Settings → Plugins right now — both are
required every time, by design (nothing here auto-starts on its own).

If Kanvaz's `userData` directory isn't in the default location for your OS,
set `KANVAZ_MCP_SOCKET` to the exact socket path before starting your MCP
client. Not needed on Windows — named pipes don't depend on that at all.

## Tools

| Tool | Does |
|---|---|
| `getActiveBoard` | Returns the open board's id/name/path |
| `listCards` | Lists cards, optionally filtered by `type` or `tag` |
| `getCard` | Gets one card by id |
| `createCard` | Creates a note/color/url/file card |
| `updateCard` | Partial update (name/text/url/color/tags/position/size/pinned) |
| `deleteCard` | Deletes a card (undo-reversible) |
| `addReference` | Creates a card from a local file path or a URL |
| `tagCard` | Sets a card's full tag list |
| `search` | Searches by name/type/tag |
| `getConnections` | Lists connections on the board |
| `connectCards` | Creates a directional connection between two cards |

A card's `dataUrl` (the actual embedded image/video/audio bytes) is never
sent over the bridge — you'll see `hasMedia: true/false` instead. Nothing
here can hand raw pixel data to an AI client; there'd be no point, and it
would be enormous.

**A card's local file path IS sent, though** — `listCards`/`getCard`/`search`
return the real absolute path for any file-reference card, not just when you
explicitly call `addReference`/`createCard type:"file"` yourself. That's by
design (round-tripping a path is the point of a file reference), but it's
worth knowing before you enable this: an absolute path can reveal your OS
username (via the home-directory prefix) and folder structure to whatever AI
client you've connected. See `SECURITY.md`'s MCP Bridge section for the full,
current disclosure of what this plugin can and can't do, including its
current limits around trusting other installed plugins once this one is on.

## Security note

This plugin's local pipe/socket has no per-connection authentication beyond
"you're a process on this machine" — and the `server` permission gate that
controls whether `KanvazPluginAPI.mcpBridge` is even visible to a plugin's
script doesn't extend to the underlying `KanvazBridge` IPC transport, which
every loaded plugin shares regardless of its own declared permissions. In
practice: **if you enable MCP Bridge, only install other Kanvaz plugins you
trust just as much as this one** — a malicious co-resident plugin could, in
principle, intercept or spoof what an external AI client believes about your
board. Full detail in `SECURITY.md`.
