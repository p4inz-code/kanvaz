#!/usr/bin/env node
/* server.js — MCP Bridge stdio shim (standalone, plain Node — NOT part
   of the Electron app, NOT bundled into the Kanvaz installer)

   This is the process Claude Desktop / Claude Code actually spawns (see
   README.md for the config snippet) — it speaks the real MCP protocol
   over stdio using the official @modelcontextprotocol/sdk, and for
   every tool call it forwards a small JSON request to Kanvaz's already-
   running local listener (a named pipe on Windows, a Unix domain socket
   on macOS/Linux — see src/main.js's mcp-bridge-start handler) and
   relays the response back as the tool's result.

   Kanvaz itself never spawns, manages, or depends on this process —
   the AI client owns its lifecycle entirely, same as any other MCP
   server. If Kanvaz isn't running, or MCP Bridge isn't enabled in its
   Settings, every tool call here fails with a clear message rather than
   hanging silently. */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

const CONNECT_TIMEOUT_MS = 20000;

function getSocketPath() {
  if (process.env.KANVAZ_MCP_SOCKET) return process.env.KANVAZ_MCP_SOCKET;
  if (process.platform === 'win32') return '\\\\.\\pipe\\kanvaz-mcp-bridge';
  /* Best-effort default matching Electron's app.getPath('userData') for
     a productName of "Kanvaz" — set KANVAZ_MCP_SOCKET above if your
     install resolves somewhere else. Windows needs no such guess: named
     pipes aren't filesystem paths, so there's nothing OS-profile-
     dependent to get wrong there. */
  if (process.platform === 'darwin') {
    return path.join(os.homedir(), 'Library', 'Application Support', 'Kanvaz', 'mcp-bridge.sock');
  }
  return path.join(os.homedir(), '.config', 'Kanvaz', 'mcp-bridge.sock');
}

/* One ephemeral connection per tool call — simpler and more robust than
   holding a persistent socket open across calls (no reconnect/stale-
   connection state to manage), and the overhead of a fresh local pipe
   connection is negligible next to an LLM round trip anyway. Framing
   matches main.js's handleMcpBridgeConnection() exactly: one JSON
   object per line, both directions. */
function callKanvaz(method, params) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(getSocketPath());
    let buffer = '';
    const id = Math.random().toString(36).slice(2);

    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error('Kanvaz did not respond in time.'));
    }, CONNECT_TIMEOUT_MS);

    socket.setEncoding('utf8');
    socket.on('connect', () => {
      socket.write(JSON.stringify({ id, method, params }) + '\n');
    });
    socket.on('data', (chunk) => {
      buffer += chunk;
      const nl = buffer.indexOf('\n');
      if (nl === -1) return;
      clearTimeout(timer);
      const line = buffer.slice(0, nl);
      socket.end();
      try {
        const res = JSON.parse(line);
        if (res.error) reject(new Error(res.error));
        else resolve(res.result);
      } catch (e) {
        reject(new Error('Kanvaz sent back something that was not valid JSON: ' + e.message));
      }
    });
    socket.on('error', (e) => {
      clearTimeout(timer);
      reject(new Error('Could not reach Kanvaz — make sure it is running and MCP Bridge is enabled in Settings -> Plugins. (' + e.message + ')'));
    });
  });
}

function textResult(value) {
  return { content: [{ type: 'text', text: JSON.stringify(value, null, 2) }] };
}

function errorResult(e) {
  return { content: [{ type: 'text', text: 'Error: ' + e.message }], isError: true };
}

/* Wraps every tool callback in the same try/catch so a Kanvaz-side
   error (bridge disabled, card not found, bad connection ids, ...)
   comes back as a normal MCP tool error the client can show the user
   and recover from, instead of an unhandled rejection killing this
   process. */
function tool(method) {
  return async (args) => {
    try {
      return textResult(await callKanvaz(method, args));
    } catch (e) {
      return errorResult(e);
    }
  };
}

const server = new McpServer({ name: 'kanvaz-mcp-bridge', version: '1.0.0' });

server.registerTool('getActiveBoard', {
  title: 'Get active board',
  description: 'Returns the currently open Kanvaz board (id, name, file path).'
}, tool('getActiveBoard'));

server.registerTool('listCards', {
  title: 'List cards',
  description: 'Lists cards on the active board, optionally filtered by type or tag.',
  inputSchema: {
    type: z.string().optional().describe('Card type to filter by, e.g. "note", "image", "url"'),
    tag: z.string().optional().describe('Only cards carrying this tag')
  }
}, async (args) => {
  try {
    return textResult(await callKanvaz('listCards', { filters: args }));
  } catch (e) {
    return errorResult(e);
  }
});

server.registerTool('getCard', {
  title: 'Get card',
  description: 'Returns one card by id.',
  inputSchema: { id: z.string() }
}, tool('getCard'));

server.registerTool('createCard', {
  title: 'Create card',
  description: 'Creates a new note, text, color, url, or file-reference card. "text" is a bare floating label with no background/border, for titling a section of the board directly — "note" is a boxed textarea for actual note content. For an image/video/audio file or a plain URL card, prefer addReference instead.',
  inputSchema: {
    type: z.enum(['note', 'text', 'color', 'url', 'file']),
    x: z.number().optional(),
    y: z.number().optional(),
    data: z.object({
      text: z.string().optional().describe('Initial text, for type "note" or "text"'),
      color: z.string().optional().describe('Hex color, for type "color"'),
      url: z.string().optional().describe('URL, for type "url"'),
      path: z.string().optional().describe('Absolute file path, for type "file"'),
      tags: z.array(z.string()).optional()
    }).optional()
  }
}, tool('createCard'));

/* This field list is a hand-kept duplicate of src/cards.js's own
   UPDATABLE_FIELDS array — there's no way to share it directly across
   the process boundary (this is a separate, standalone Node/ESM
   script, not part of the Electron bundle). If you add/remove a field
   from UPDATABLE_FIELDS, update this schema too, and vice versa —
   cards.js's own updateCardData() now warns to the console on any
   patch field outside UPDATABLE_FIELDS, which is the best available
   safety net against the two silently drifting apart. */
server.registerTool('updateCard', {
  title: 'Update card',
  description: 'Applies a partial update to an existing card (name, text, url, color, tags, position, size, pinned).',
  inputSchema: {
    id: z.string(),
    patch: z.object({
      name: z.string().optional(),
      text: z.string().optional(),
      url: z.string().optional(),
      color: z.string().optional(),
      tags: z.array(z.string()).optional(),
      x: z.number().optional(),
      y: z.number().optional(),
      w: z.number().optional(),
      h: z.number().optional(),
      pinned: z.boolean().optional()
    })
  }
}, tool('updateCard'));

server.registerTool('deleteCard', {
  title: 'Delete card',
  description: 'Deletes a card by id. Lands in undo history like a manual delete — reversible with Ctrl+Z in Kanvaz.',
  inputSchema: { id: z.string() }
}, tool('deleteCard'));

server.registerTool('addReference', {
  title: 'Add reference',
  description: 'Creates a card from a local file path (image/video/audio embeds; anything else becomes a file-reference card) or a URL (a URL reference card).',
  inputSchema: {
    path: z.string().optional().describe('Absolute path to a local file'),
    url: z.string().optional().describe('A URL — mutually exclusive with path'),
    x: z.number().optional(),
    y: z.number().optional()
  }
}, tool('addReference'));

server.registerTool('tagCard', {
  title: 'Tag card',
  description: 'Sets a card\'s full tag list (replaces any existing tags).',
  inputSchema: { id: z.string(), tags: z.array(z.string()) }
}, tool('tagCard'));

server.registerTool('search', {
  title: 'Search cards',
  description: 'Searches the active board by name, type, or tag (case-insensitive substring match).',
  inputSchema: { query: z.string() }
}, tool('search'));

server.registerTool('getConnections', {
  title: 'Get connections',
  description: 'Lists every reference connection on the active board.'
}, tool('getConnections'));

server.registerTool('connectCards', {
  title: 'Connect cards',
  description: 'Creates a directional connection between two cards (e.g. "InspiredBy", "RelatedTo").',
  inputSchema: {
    fromId: z.string(),
    toId: z.string(),
    type: z.enum(['RelatedTo', 'InspiredBy', 'DerivedFrom', 'AlternativeTo', 'Supports', 'UsedIn', 'References']).optional()
  }
}, tool('connectCards'));

/* ── Card extras (4.5.0) ── */

server.registerTool('flipCard', {
  title: 'Flip card',
  description: 'Flips an image/video/gif card horizontally or vertically.',
  inputSchema: { id: z.string(), axis: z.enum(['h', 'v']) }
}, tool('flipCard'));

server.registerTool('duplicateCard', {
  title: 'Duplicate card',
  description: 'Duplicates a card, offset slightly from the original.',
  inputSchema: { id: z.string() }
}, tool('duplicateCard'));

server.registerTool('bringCardToFront', {
  title: 'Bring card to front',
  description: 'Raises a card to the top of the z-order.',
  inputSchema: { id: z.string() }
}, tool('bringCardToFront'));

server.registerTool('sendCardToBack', {
  title: 'Send card to back',
  description: 'Lowers a card to the bottom of the z-order.',
  inputSchema: { id: z.string() }
}, tool('sendCardToBack'));

/* ── Board management (4.5.0) ──
   deleteBoard is NOT undo-reversible (undo history is per-board and is
   cleared on every board switch/load) — the two-step confirm pattern
   below exists specifically because of that, unlike every card tool
   above. Call it once without confirm to see what would be deleted,
   then again with confirm:true to actually delete it. */

server.registerTool('createBoard', {
  title: 'Create board',
  description: 'Creates a new, empty board and switches to it.',
  inputSchema: { name: z.string().optional() }
}, tool('createBoard'));

server.registerTool('listBoards', {
  title: 'List boards',
  description: 'Lists every open board (id, name, card count, which one is active) — not just the active one.'
}, tool('listBoards'));

server.registerTool('switchBoard', {
  title: 'Switch board',
  description: 'Switches to a different open board by id.',
  inputSchema: { id: z.string() }
}, tool('switchBoard'));

server.registerTool('renameBoard', {
  title: 'Rename board',
  description: 'Renames a board by id.',
  inputSchema: { id: z.string(), name: z.string() }
}, tool('renameBoard'));

server.registerTool('deleteBoard', {
  title: 'Delete board',
  description: 'Deletes a board by id. NOT undo-reversible. Call once without confirm to see what would be deleted (name, card count); call again with confirm:true to actually delete it.',
  inputSchema: { id: z.string(), confirm: z.boolean().optional() }
}, tool('deleteBoard'));

server.registerTool('saveBoard', {
  title: 'Save board',
  description: 'Saves the active board. Uses its existing file path if it has one (path is ignored in that case); otherwise path is required to establish one. Never opens a native file-picker dialog.',
  inputSchema: { path: z.string().optional() }
}, tool('saveBoard'));

/* ── History / view control (4.5.0) ── */

server.registerTool('undo', { title: 'Undo', description: 'Undoes the last change on the active board.' }, tool('undo'));
server.registerTool('redo', { title: 'Redo', description: 'Redoes the last undone change on the active board.' }, tool('redo'));
server.registerTool('zoomIn', { title: 'Zoom in', description: 'Zooms the canvas in one step.' }, tool('zoomIn'));
server.registerTool('zoomOut', { title: 'Zoom out', description: 'Zooms the canvas out one step.' }, tool('zoomOut'));
server.registerTool('zoomReset', { title: 'Reset zoom', description: 'Resets canvas zoom to 100%.' }, tool('zoomReset'));
server.registerTool('zoomFit', { title: 'Zoom to fit', description: 'Zooms/pans the canvas so every card is visible.' }, tool('zoomFit'));
server.registerTool('toggleMapView', { title: 'Toggle map view', description: 'Switches between Board view and Map view.' }, tool('toggleMapView'));

/* ── Settings (4.5.0) — everything except plugin management ──
   This field list is a hand-kept duplicate of src/ui.js's own
   SETTINGS_DEFAULTS object (same reasoning as updateCard's patch
   schema above — separate standalone script, no way to import it
   directly). Plugin enable/disable/approval state was never part of
   this object at all; the exclusion is structural, not enforced by
   this schema. */

server.registerTool('getSettings', {
  title: 'Get settings',
  description: 'Returns the current app settings (theme, autosave interval, grid snap, etc. — everything except plugin management).'
}, tool('getSettings'));

server.registerTool('updateSettings', {
  title: 'Update settings',
  description: 'Applies a partial settings update, live. Everything Settings -> Appearance/Behavior/Files/Developer covers except plugin management.',
  inputSchema: {
    patch: z.object({
      theme: z.string().optional().describe('"dark", "light", or a registered plugin theme id'),
      autosaveInterval: z.number().optional().describe('seconds, minimum 10'),
      showMinimap: z.boolean().optional(),
      cardShadows: z.boolean().optional(),
      dotGridVisible: z.boolean().optional(),
      openOnStartup: z.boolean().optional(),
      confirmDelete: z.boolean().optional(),
      defaultCardW: z.number().optional(),
      animationsOn: z.boolean().optional(),
      alwaysOnTop: z.boolean().optional(),
      doubleClickCreatesNote: z.boolean().optional(),
      leftDragPan: z.boolean().optional(),
      autoHideChrome: z.boolean().optional(),
      gridSnapEnabled: z.boolean().optional(),
      gridSnapIncrement: z.enum(['minor', 'major']).optional(),
      topModeAutoOnTop: z.boolean().optional(),
      devShowFPS: z.boolean().optional(),
      devShowIds: z.boolean().optional()
    })
  }
}, tool('updateSettings'));

const transport = new StdioServerTransport();
await server.connect(transport);
