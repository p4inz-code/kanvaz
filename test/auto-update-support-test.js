/* Unit tests for src/auto-update-support.js — the platform-support and
   error-wording rules behind the "Check for updates" flow.
   Run: node test/auto-update-support-test.js */
var assert = require('assert');
var S = require('../src/auto-update-support');

function run() {
  assert.deepStrictEqual(S.supportFor('win32', false), { ok: true, reason: null }, 'installed Windows: supported');
  assert.deepStrictEqual(S.supportFor('win32', true), { ok: false, reason: 'portable' }, 'portable Windows: unsupported');
  assert.deepStrictEqual(S.supportFor('linux', false), { ok: true, reason: null }, 'Linux AppImage: supported (no signature needed)');
  assert.deepStrictEqual(S.supportFor('darwin', false), { ok: false, reason: 'mac-unsigned' }, 'macOS: unsupported (unsigned build)');
  assert.deepStrictEqual(S.supportFor('darwin', true), { ok: false, reason: 'mac-unsigned' }, 'macOS always unsupported regardless of the portable flag');
  console.log('  ✓ platform support: Windows installed + Linux AppImage real-update, portable + mac fall back');

  assert.strictEqual(S.friendlyError(new Error('HttpError: 404 Not Found')), "Couldn't find a release on GitHub");
  assert.strictEqual(S.friendlyError(new Error('HttpError: 403 rate limit')), 'GitHub rate-limited this check — try again in a few minutes');
  assert.strictEqual(S.friendlyError(new Error('getaddrinfo ENOTFOUND api.github.com')), "Couldn't check — no internet, or GitHub unreachable");
  assert.strictEqual(S.friendlyError(new Error('connect ETIMEDOUT')), "Couldn't check — no internet, or GitHub unreachable");
  assert.strictEqual(S.friendlyError(new Error('something odd')), "Couldn't check for updates: something odd");
  assert.strictEqual(S.friendlyError(null), "Couldn't check for updates: Unknown error");
  console.log('  ✓ error wording: 404/403/network cases get plain text, everything else keeps its message');

  console.log('ALL AUTO-UPDATE SUPPORT TESTS PASSED');
}

run();
