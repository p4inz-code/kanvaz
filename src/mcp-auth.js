/* mcp-auth.js — per-launch token for the local MCP Bridge pipe/socket.

   Before this, anything that could open \\.\pipe\kanvaz-mcp-bridge (or the
   Unix socket) could drive Kanvaz: create/delete cards and boards, read
   settings. Now every request line must carry the token main.js generated
   when the bridge was started. The token is 256 random bits, written to a
   file in Kanvaz's own data folder (mode 0600 where the OS honors it) that
   the legitimate MCP shim reads, and deleted when the bridge stops.

   Honest scope: this stops other USERS, sandboxed apps that cannot read
   Kanvaz's data folder, and a stray or confused local client that never
   read the file. It does NOT stop malware already running as the same
   user, which can read that file too; that threat is outside what any
   local-IPC token can address.

   Node-only, no electron require, so test/mcp-auth-test.js can run it.
   ES5/var-only like the rest of src/. */

var fs = require('fs');
var path = require('path');
var crypto = require('crypto');

var TOKEN_FILE_NAME = 'mcp-bridge.token';

function generateToken() {
  return crypto.randomBytes(32).toString('hex');
}

function tokenFilePath(dataDir) {
  return path.join(dataDir, TOKEN_FILE_NAME);
}

/* Atomic write (tmp + rename) so a shim never reads a half-written token. */
function writeTokenFile(dataDir, token) {
  var target = tokenFilePath(dataDir);
  var tmp = target + '.tmp';
  fs.writeFileSync(tmp, token, { encoding: 'utf8', mode: 384 /* 0o600 */ });
  fs.renameSync(tmp, target);
  return target;
}

function removeTokenFile(dataDir) {
  try { fs.unlinkSync(tokenFilePath(dataDir)); } catch (e) { /* already gone */ }
}

/* Constant-time comparison. Anything that is not a string of the right
   length is rejected without comparing. */
function verifyToken(candidate, expected) {
  if (typeof candidate !== 'string' || typeof expected !== 'string' || !expected) return false;
  var a = Buffer.from(candidate, 'utf8');
  var b = Buffer.from(expected, 'utf8');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

module.exports = {
  TOKEN_FILE_NAME: TOKEN_FILE_NAME,
  generateToken: generateToken,
  tokenFilePath: tokenFilePath,
  writeTokenFile: writeTokenFile,
  removeTokenFile: removeTokenFile,
  verifyToken: verifyToken
};
