#!/usr/bin/env node
/* ============================================================
   Kanvaz — MCP Bridge end-to-end test
   Real MCP protocol, both ends: a real MCP Client (from
   @modelcontextprotocol/sdk) drives the actual, unmodified
   official-plugins/mcp-bridge/server.js as a spawned child process —
   exactly how Claude Desktop/Code would — while a fake "Kanvaz" named-
   pipe/socket listener stands in for the real app, using the identical
   line-delimited-JSON framing main.js's handleMcpBridgeConnection()
   uses. Verifies the full external-facing round trip: MCP tool call ->
   server.js -> local pipe -> "Kanvaz" -> back as a proper MCP result.

   Requires official-plugins/mcp-bridge's OWN dependencies (a separate,
   standalone npm install — see official-plugins/mcp-bridge/package.json
   — deliberately not part of the root install, since that script isn't
   part of the Electron app). SKIPs gracefully if they're not installed,
   same pattern as run-port-test.js skipping without a real Chrome.
   Usage: node test/mcp-bridge-e2e-test.mjs
   ============================================================ */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PLUGIN_DIR = path.join(__dirname, '..', 'official-plugins', 'mcp-bridge');

if (!fs.existsSync(path.join(PLUGIN_DIR, 'node_modules'))) {
  console.log('SKIP — official-plugins/mcp-bridge/node_modules missing.');
  console.log('  Fix: cd official-plugins/mcp-bridge && npm install');
  process.exit(0);
}

const net = await import('node:net');
const sdkClientPath = path.join(PLUGIN_DIR, 'node_modules', '@modelcontextprotocol', 'sdk', 'dist', 'esm', 'client', 'index.js');
const sdkStdioPath = path.join(PLUGIN_DIR, 'node_modules', '@modelcontextprotocol', 'sdk', 'dist', 'esm', 'client', 'stdio.js');
const { Client } = await import(pathToFileURL(sdkClientPath).href);
const { StdioClientTransport } = await import(pathToFileURL(sdkStdioPath).href);

const PIPE_PATH = process.platform === 'win32'
  ? '\\\\.\\pipe\\kanvaz-mcp-bridge-TEST'
  : path.join(__dirname, '..', 'kanvaz-mcp-bridge-test.sock');

let pass = true;
function check(label, cond) {
  console.log((cond ? '  ✓ ' : '  ✗ ') + label);
  if (!cond) pass = false;
}

/* ---- Fake Kanvaz listener ---- */
const fakeCards = {
  'card-1': { id: 'card-1', type: 'note', name: 'Note', text: 'hello', tags: [], x: 0, y: 0 }
};

const fakeServer = net.createServer((socket) => {
  var buffer = '';
  socket.setEncoding('utf8');
  socket.on('data', function(chunk) {
    buffer += chunk;
    var nl = buffer.indexOf('\n');
    if (nl === -1) return;
    var req = JSON.parse(buffer.slice(0, nl));
    var result, error;
    if (req.method === 'getActiveBoard') {
      result = { id: 'board-1', name: 'Test Board', path: null };
    } else if (req.method === 'getCard') {
      result = fakeCards[req.params.id] || null;
    } else if (req.method === 'createCard') {
      result = { id: 'card-2', type: req.params.type, name: 'created', hasMedia: false };
    } else if (req.method === 'listBoards') {
      result = [{ id: 'board-1', name: 'Test Board', cardCount: 1, active: true }];
    } else if (req.method === 'deleteBoard') {
      result = req.params.confirm
        ? { ok: true, deleted: true, id: req.params.id, name: 'Board 2' }
        : { ok: true, needsConfirmation: true, id: req.params.id, name: 'Board 2', cardCount: 3, message: 'confirm to proceed' };
    } else if (req.method === 'getSettings') {
      result = { theme: 'dark', autosaveInterval: 30 };
    } else if (req.method === 'undo') {
      result = { ok: true };
    } else {
      error = 'fake server: unhandled method ' + req.method;
    }
    socket.write(JSON.stringify({ id: req.id, result: result, error: error }) + '\n');
  });
});

try {
  if (process.platform !== 'win32' && fs.existsSync(PIPE_PATH)) fs.unlinkSync(PIPE_PATH);
} catch (e) { /* ignore */ }

await new Promise((resolve, reject) => {
  fakeServer.on('error', reject);
  fakeServer.listen(PIPE_PATH, resolve);
});

/* ---- Real MCP client driving the real, unmodified server.js ---- */
const transport = new StdioClientTransport({
  command: process.execPath,
  args: ['server.js'],
  cwd: PLUGIN_DIR,
  env: Object.assign({}, process.env, { KANVAZ_MCP_SOCKET: PIPE_PATH })
});

const client = new Client({ name: 'kanvaz-test-client', version: '1.0.0' });
await client.connect(transport);

const toolsResult = await client.listTools();
const toolNames = toolsResult.tools.map((t) => t.name).sort();
check('all 30 tools registered (11 original + 19 from the 4.5.0 whole-app expansion)', toolNames.length === 30);
check('getActiveBoard present', toolNames.includes('getActiveBoard'));
check('createCard present', toolNames.includes('createCard'));
check('connectCards present', toolNames.includes('connectCards'));
check('deleteBoard present (board management)', toolNames.includes('deleteBoard'));
check('undo present (history)', toolNames.includes('undo'));
check('zoomFit present (view control)', toolNames.includes('zoomFit'));
check('updateSettings present (settings, minus plugin management)', toolNames.includes('updateSettings'));
check('no plugin-management tool exists (install/enable/disable a plugin stays UI-only)', !toolNames.some((n) => /plugin/i.test(n)));

const r1 = await client.callTool({ name: 'getActiveBoard', arguments: {} });
check('getActiveBoard round-trips real data', JSON.parse(r1.content[0].text).name === 'Test Board');
check('getActiveBoard is not flagged as an error', !r1.isError);

const r2 = await client.callTool({ name: 'getCard', arguments: { id: 'card-1' } });
check('getCard returns the fake card', JSON.parse(r2.content[0].text).text === 'hello');

const r3 = await client.callTool({ name: 'getCard', arguments: { id: 'does-not-exist' } });
check('getCard for a missing id returns null, not an error', JSON.parse(r3.content[0].text) === null && !r3.isError);

const r4 = await client.callTool({ name: 'createCard', arguments: { type: 'note', data: { text: 'hi' } } });
check('createCard round-trips the fake created card', JSON.parse(r4.content[0].text).id === 'card-2');

const r5 = await client.callTool({ name: 'getConnections', arguments: {} });
check('an unhandled/erroring method surfaces as isError:true, not a crash', r5.isError === true && /unhandled method/.test(r5.content[0].text));

const r6 = await client.callTool({ name: 'listBoards', arguments: {} });
check('listBoards round-trips real data', Array.isArray(JSON.parse(r6.content[0].text)) && JSON.parse(r6.content[0].text)[0].name === 'Test Board');

const r7 = await client.callTool({ name: 'deleteBoard', arguments: { id: 'board-2' } });
const r7data = JSON.parse(r7.content[0].text);
check('deleteBoard without confirm returns needsConfirmation, does not delete', r7data.needsConfirmation === true && !r7data.deleted);

const r8 = await client.callTool({ name: 'deleteBoard', arguments: { id: 'board-2', confirm: true } });
const r8data = JSON.parse(r8.content[0].text);
check('deleteBoard with confirm:true actually deletes', r8data.deleted === true);

const r9 = await client.callTool({ name: 'getSettings', arguments: {} });
check('getSettings round-trips real data', JSON.parse(r9.content[0].text).theme === 'dark');

const r10 = await client.callTool({ name: 'undo', arguments: {} });
check('undo round-trips ok:true', JSON.parse(r10.content[0].text).ok === true);

await client.close();
fakeServer.close();
try {
  if (process.platform !== 'win32') fs.unlinkSync(PIPE_PATH);
} catch (e) { /* ignore */ }

console.log('\n' + (pass ? 'ALL MCP BRIDGE E2E TESTS PASSED' : 'SOME MCP BRIDGE E2E TESTS FAILED'));
process.exit(pass ? 0 : 1);
