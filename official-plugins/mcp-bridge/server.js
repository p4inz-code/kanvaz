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
  description: 'Creates a new note, color, url, or file-reference card. For an image/video/audio file or a plain URL card, prefer addReference instead.',
  inputSchema: {
    type: z.enum(['note', 'color', 'url', 'file']),
    x: z.number().optional(),
    y: z.number().optional(),
    data: z.object({
      text: z.string().optional().describe('Initial text, for type "note"'),
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

const transport = new StdioServerTransport();
await server.connect(transport);
