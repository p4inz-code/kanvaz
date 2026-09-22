#!/usr/bin/env node
/* link-server-test.js — the Kanvaz Link listener (src/link-server.js).

   Part 1 drives the protocol with no socket. Part 2 starts the real server on
   a real named pipe / Unix socket and talks to it with a fake add-on, including
   hostile clients (wrong token, oversize line, junk, too many connections). */

var assert = require('assert');
var fs = require('fs');
var os = require('os');
var path = require('path');
var net = require('net');
var crypto = require('crypto');
var ls = require('../src/link-server');

var TOKEN = crypto.randomBytes(32).toString('hex');
var W = process.platform === 'win32';
var TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'kz-link-'));
var DROP = path.join(TMP, 'drop');
fs.mkdirSync(DROP);

function deps(overrides) {
  var state = { consent: 'unknown', asked: 0, delivered: [] };
  var d = {
    token: TOKEN, dropDir: DROP, appVersion: '9.9.9',
    capabilities: function() { return { deliver: { formats: ['glb', 'gltf'], maxBytes: 1000000, animation: { clips: 'select' } } }; },
    getConsent: function() { return state.consent; },
    requestConsent: function(name, cb) { state.asked++; state.lastName = name; state.cb = cb; },
    onDeliver: function(x) { state.delivered.push(x); return { state: 'queued' }; }
  };
  for (var k in (overrides || {})) d[k] = overrides[k];
  return { deps: d, state: state };
}

function good(extra) {
  var o = { token: TOKEN, id: 1, method: 'deliver', client: { name: 'Blender' }, path: path.join(DROP, 'a.glb'), format: 'glb', name: 'Cube', sizeBytes: 1234 };
  for (var k in (extra || {})) o[k] = extra[k];
  return o;
}

function partOne() {
  var t = deps();
  var p = ls.createProtocol(t.deps);

  /* auth + method whitelist */
  assert.strictEqual(p.handle({ id: 1, method: 'ping' }).error, 'unauthorized', 'no token is refused');
  assert.strictEqual(p.handle({ id: 1, method: 'ping', token: 'x'.repeat(64) }).error, 'unauthorized', 'wrong token is refused');
  assert.strictEqual(p.handle(null).ok, false, 'non-object refused');
  assert.strictEqual(p.handle({ token: TOKEN, id: 2, method: 'ping' }).pong, true, 'ping works with the token');
  ['exec', 'invoke', 'shutdown', '__proto__', 'constructor', 'toString'].forEach(function(m) {
    assert.strictEqual(p.handle({ token: TOKEN, id: 3, method: m }).error, 'unsupported', m + ' is not a method');
  });
  console.log('  ✓ token required on every request; only hello/deliver/status/ping exist');

  /* normalizeName: the same safety net the consent dialog and consent
     store both rely on — two names that look the same to a person must
     come out identical, so a denied program cannot sneak back in as
     "Name ", "name", or with a hidden formatting character. */
  assert.strictEqual(ls.normalizeName('Kanvaz Link for Blender'), 'Kanvaz Link for Blender', 'ordinary name passes through');
  assert.strictEqual(ls.normalizeName('  Kanvaz Link   for Blender  '), 'Kanvaz Link for Blender', 'whitespace collapsed and trimmed');
  assert.strictEqual(ls.normalizeName('Kanvaz​Link​for​Blender'), 'KanvazLinkforBlender', 'zero-width joiners stripped');
  assert.strictEqual(ls.normalizeName('Kanvaz\u0000Link\u001fBlender'), 'KanvazLinkBlender', 'control characters stripped');
  assert.strictEqual(ls.normalizeName('‮Kanvaz'), 'Kanvaz', 'bidi override stripped');
  assert.strictEqual(ls.normalizeName('x'.repeat(200)), 'x'.repeat(64), 'capped at 64 characters');
  assert.strictEqual(ls.normalizeName(''), 'unknown client', 'empty name falls back');
  assert.strictEqual(ls.normalizeName(42), 'unknown client', 'non-string falls back');
  assert.strictEqual(ls.normalizeName(null), 'unknown client', 'null falls back');
  console.log('  ✓ normalizeName: whitespace/control/bidi/zero-width stripped, length capped, non-strings fall back');

  /* hello */
  assert.strictEqual(p.handle({ token: TOKEN, id: 4, method: 'hello' }).error, 'bad-request', 'hello needs a nonce');
  assert.strictEqual(p.handle({ token: TOKEN, id: 4, method: 'hello', nonce: 'nothex!!nothex!!' }).error, 'bad-request', 'non-hex nonce refused');
  var nonce = crypto.randomBytes(16).toString('hex');
  var h = p.handle({ token: TOKEN, id: 5, method: 'hello', nonce: nonce, client: { name: 'Blender', version: '5.2' } });
  assert(h.ok && h.protocol === 1 && h.appVersion === '9.9.9' && h.dropDir === DROP, 'hello reply');
  assert.strictEqual(h.proof, ls.serverProof(TOKEN, nonce), 'proof is the HMAC of the nonce under the token');
  assert.notStrictEqual(h.proof, ls.serverProof('0'.repeat(64), nonce), 'proof cannot be produced without the token');
  assert.strictEqual(h.consent, 'pending', 'unknown client: consent pending');
  assert.strictEqual(t.state.asked, 1, 'the user is asked exactly once');
  p.handle({ token: TOKEN, id: 6, method: 'hello', nonce: nonce, client: { name: 'Blender' } });
  assert.strictEqual(t.state.asked, 1, 'a second hello does not stack a second dialog');
  assert.deepStrictEqual(h.capabilities.deliver.formats, ['glb', 'gltf'], 'capabilities are advertised as data');
  console.log('  ✓ hello: HMAC proof, capabilities, one consent prompt however many hellos');

  /* consent gating */
  var r = p.handle(good());
  assert.strictEqual(r.state, 'awaiting-consent', 'no delivery while consent is pending');
  assert.strictEqual(t.state.delivered.length, 0, 'nothing reached main');
  t.state.consent = 'denied';
  assert.strictEqual(p.handle(good()).state, 'rejected', 'denied is rejected');
  assert.strictEqual(t.state.delivered.length, 0, 'still nothing reached main');
  t.state.consent = 'granted';
  console.log('  ✓ deliveries wait for, and honour, the native consent answer');

  /* validation */
  function bad(patch, code, why) {
    var res = p.handle(good(patch));
    assert.strictEqual(res.ok, false, why + ' must fail');
    assert.strictEqual(res.error, code, why + ' -> ' + code + ' (got ' + res.error + ')');
  }
  bad({ path: 'relative/a.glb' }, 'bad-request', 'relative path');
  bad({ path: path.join(TMP, 'a.glb') }, 'bad-request', 'a file outside the drop dir');
  bad({ path: path.join(DROP, '..', 'a.glb') }, 'bad-request', '.. traversal');
  bad({ path: DROP }, 'bad-request', 'the drop dir itself');
  bad({ path: '\\\\evil\\share\\a.glb' }, 'bad-request', 'a UNC path');
  bad({ path: 42 }, 'bad-request', 'a non-string path');
  bad({ path: path.join(DROP, 'a\0.glb') }, 'bad-request', 'a NUL byte');
  bad({ format: 'exe' }, 'unsupported-format', 'an unlisted format');
  bad({ format: 'fbx' }, 'unsupported-format', 'a format this Kanvaz did not advertise');
  bad({ sizeBytes: 0 }, 'bad-request', 'zero size');
  bad({ sizeBytes: -5 }, 'bad-request', 'negative size');
  bad({ sizeBytes: 1.5 }, 'bad-request', 'fractional size');
  bad({ sizeBytes: '12' }, 'bad-request', 'string size');
  bad({ sizeBytes: 5000000 }, 'too-large', 'over the advertised limit');
  bad({ sha256: 'abc' }, 'bad-request', 'a short sha');
  assert.strictEqual(t.state.delivered.length, 0, 'no invalid delivery reached main');
  console.log('  ✓ 15 hostile or malformed deliveries are refused before main sees them');

  /* sanitising */
  var ok = p.handle(good({
    name: '..\\..\\evil<>:"|?*name.glb', animation: { clip: 3 }, upAxis: 'z', bgColor: '#112233',
    camera: { position: { x: 1, y: 2, z: 3 }, target: { x: 0, y: 0, z: 0 } },
    source: { app: 'blender', version: '5.2', objectId: 'abc' }, sha256: 'A'.repeat(64),
    extraUnknown: { rm: '-rf' }, __proto__: { admin: true }
  }));
  assert(ok.ok && ok.state === 'queued' && /^[0-9a-f]{16}$/.test(ok.deliveryId), 'a valid delivery is queued');
  var d = t.state.delivered[0];
  assert(d.name.indexOf('/') === -1 && d.name.indexOf('\\') === -1 && d.name.indexOf(':') === -1 && d.name.indexOf('<') === -1 && d.name.charAt(0) !== '.', 'the name is a plain file name: ' + d.name);
  assert.strictEqual(d.animationClip, 3); assert.strictEqual(d.upAxis, 'z'); assert.strictEqual(d.bgColor, '#112233');
  assert.deepStrictEqual(d.cameraPosition, { x: 1, y: 2, z: 3 });
  assert.strictEqual(d.sha256, 'a'.repeat(64), 'sha is lower-cased');
  assert.strictEqual(d.extraUnknown, undefined, 'unknown fields are ignored');
  var d2 = p.handle(good({ id: 9, animation: { clip: -1 }, upAxis: 'x', bgColor: 'red', camera: { position: 1 } }));
  var dd = t.state.delivered[t.state.delivered.length - 1];
  assert(d2.ok && dd.animationClip === 0 && dd.upAxis === null && dd.bgColor === null && dd.cameraPosition === null, 'out-of-range optional fields fall back to defaults');
  console.log('  ✓ names, colours, axes, camera and clip are sanitised; unknown fields ignored');

  /* status + results + bounded queue */
  var st = p.handle({ token: TOKEN, id: 10, method: 'status', deliveryId: ok.deliveryId });
  assert(st.ok && st.state === 'queued');
  assert.strictEqual(p.setResult(ok.deliveryId, { state: 'placed', cardId: 'card-1' }), true);
  st = p.handle({ token: TOKEN, id: 11, method: 'status', deliveryId: ok.deliveryId });
  assert(st.state === 'placed' && st.cardId === 'card-1', 'status reports placed with the card id');
  assert.strictEqual(p.handle({ token: TOKEN, id: 12, method: 'status', deliveryId: 'nope' }).error, 'unknown-delivery');
  assert.strictEqual(p.setResult('nope', { state: 'placed' }), false, 'unknown delivery ids are ignored');
  var t2 = deps(); t2.state.consent = 'granted';
  var p2 = ls.createProtocol(t2.deps);
  for (var i = 0; i < ls.MAX_QUEUED; i++) assert(p2.handle(good({ id: i })).ok, 'queue slot ' + i);
  assert.strictEqual(p2.handle(good({ id: 99 })).error, 'busy', 'the queue is bounded');
  var first = t2.state.delivered[0].deliveryId;
  p2.setResult(first, { state: 'placed', cardId: 'c' });
  assert(p2.handle(good({ id: 100 })).ok, 'a finished delivery frees a slot');
  var t3 = deps({ onDeliver: function() { return { state: 'rejected', reason: 'renderer not ready' }; } }); t3.state.consent = 'granted';
  var r3 = ls.createProtocol(t3.deps).handle(good());
  assert(r3.ok === false && r3.state === 'rejected' && r3.reason === 'renderer not ready', 'main can reject and the reason is passed back');
  console.log('  ✓ status, results, bounded queue and main-side rejection');

  var name1 = ls.cleanName('   ');
  assert.strictEqual(typeof name1, 'string');
  assert.strictEqual(ls.defaultEndpoint('win32', 'C:\\Users\\a\\AppData\\Roaming\\Kanvaz').indexOf('\\\\.\\pipe\\kanvaz-link-'), 0, 'Windows endpoint is a per-install named pipe');
  assert.notStrictEqual(ls.defaultEndpoint('win32', 'C:\\a'), ls.defaultEndpoint('win32', 'C:\\b'), 'different installs get different pipes');
  assert(ls.defaultEndpoint('linux', '/home/u/.config/Kanvaz').indexOf('link.sock') !== -1);
  assert(ls.defaultEndpoint('linux', '/x'.repeat(60)).indexOf(os.tmpdir()) === 0, 'an over-long socket path moves under the temp dir');
  console.log('  ✓ endpoint naming');
}

/* ── part 2: real socket ─────────────────────────────────── */

function client(endpoint) {
  return new Promise(function(resolve, reject) {
    var s = net.connect(endpoint);
    var buf = '', waiting = [], closed = false;
    s.setEncoding('utf8');
    s.on('data', function(c) {
      buf += c;
      var nl;
      while ((nl = buf.indexOf('\n')) !== -1) {
        var line = buf.slice(0, nl); buf = buf.slice(nl + 1);
        var w = waiting.shift(); if (w) w(JSON.parse(line));
      }
    });
    s.on('close', function() { closed = true; waiting.forEach(function(w) { w(null); }); waiting = []; });
    s.on('error', function() {});
    s.on('connect', function() {
      resolve({
        sock: s,
        send: function(o) { return new Promise(function(res) { waiting.push(res); s.write(JSON.stringify(o) + '\n'); }); },
        raw: function(str) { s.write(str); },
        closed: function() { return closed; },
        waitClose: function() { return new Promise(function(res) { if (closed) return res(); s.on('close', function() { res(); }); }); }
      });
    });
    s.on('error', reject);
  });
}

async function partTwo() {
  var endpoint = ls.defaultEndpoint(process.platform, TMP);
  var t = deps(); t.state.consent = 'granted';
  var srv = ls.createServer({ endpoint: endpoint, deps: t.deps });
  await new Promise(function(res, rej) { srv.start(function(e) { e ? rej(e) : res(); }); });
  assert(srv.isRunning());

  if (!W) {
    var mode = fs.statSync(endpoint).mode & 0o777;
    assert.strictEqual(mode, 0o600, 'the socket is 0600');
    assert.strictEqual(fs.statSync(path.dirname(endpoint)).mode & 0o777, 0o700, 'its directory is 0700');
  }

  var c = await client(endpoint);
  var nonce = crypto.randomBytes(16).toString('hex');
  var h = await c.send({ token: TOKEN, id: 1, method: 'hello', nonce: nonce, client: { name: 'Blender' } });
  assert(h.ok && h.proof === ls.serverProof(TOKEN, nonce), 'hello over a real socket');
  var d = await c.send(Object.assign(good({ id: 2 })));
  assert(d.ok && d.state === 'queued', 'deliver over a real socket');
  assert.strictEqual(t.state.delivered.length, 1);
  var pn = await c.send({ token: TOKEN, id: 3, method: 'ping' });
  assert.strictEqual(pn.pong, true);
  c.sock.destroy();
  console.log('  ✓ real ' + (W ? 'named pipe' : 'Unix socket') + ': hello, deliver, ping');

  var bad = await client(endpoint);
  var ur = await bad.send({ token: 'f'.repeat(64), id: 1, method: 'hello', nonce: nonce });
  assert.strictEqual(ur.error, 'unauthorized');
  await bad.waitClose();
  assert(bad.closed(), 'a wrong token gets one answer and the connection is closed');

  var junk = await client(endpoint);
  var jp = new Promise(function(res) { junk.sock.once('data', function(x) { res(x); }); });
  junk.raw('this is not json\n');
  assert(/bad-json/.test(await jp), 'junk gets a bad-json answer');
  await junk.waitClose();

  var big = await client(endpoint);
  big.raw('{"token":"' + 'a'.repeat(ls.MAX_LINE_BYTES + 100));
  await big.waitClose();
  assert(big.closed(), 'an oversize unterminated line drops the connection');
  var big2 = await client(endpoint);
  big2.raw('{"a":"' + 'b'.repeat(ls.MAX_LINE_BYTES + 100) + '"}\n');
  await big2.waitClose();
  assert(big2.closed(), 'an oversize terminated line drops the connection');
  console.log('  ✓ wrong token, junk, and oversize lines are all cut off');

  var many = [];
  for (var i = 0; i < ls.MAX_CONNECTIONS; i++) many.push(await client(endpoint));
  var extra = await client(endpoint);
  await extra.waitClose();
  assert(extra.closed(), 'connection number ' + (ls.MAX_CONNECTIONS + 1) + ' is refused');
  var still = await many[0].send({ token: TOKEN, id: 1, method: 'ping' });
  assert.strictEqual(still.pong, true, 'existing connections keep working');
  many.forEach(function(m) { m.sock.destroy(); });
  console.log('  ✓ connection cap');

  /* the server survives all of that (give it a moment to notice the closed connections) */
  await new Promise(function(r) { setTimeout(r, 200); });
  var after = await client(endpoint);
  assert.strictEqual((await after.send({ token: TOKEN, id: 1, method: 'ping' })).pong, true, 'server still healthy after abuse');
  after.sock.destroy();

  /* discovery file */
  var info = { protocol: 1, endpoint: endpoint, token: TOKEN, dropDir: DROP, pid: process.pid, appVersion: '9.9.9' };
  var file = ls.writeDiscovery(TMP, info);
  assert.deepStrictEqual(JSON.parse(fs.readFileSync(file, 'utf8')), info, 'discovery file round-trips');
  assert(!fs.existsSync(file + '.tmp'), 'atomic: no temp file left');
  if (!W) assert.strictEqual(fs.statSync(file).mode & 0o777, 0o600, 'discovery file is 0600');
  ls.removeDiscovery(TMP);
  assert(!fs.existsSync(file), 'removed on stop');
  console.log('  ✓ discovery file is atomic, private and removable');

  await new Promise(function(res) { srv.stop(res); });
  assert(!srv.isRunning());
  await new Promise(function(res) {
    var s = net.connect(endpoint);
    s.on('error', function() { res(); });
    s.on('connect', function() { s.destroy(); assert.fail('still listening after stop'); });
  });
  if (!W) assert(!fs.existsSync(endpoint), 'the socket file is removed on stop');
  console.log('  ✓ stop closes the listener' + (W ? '' : ' and removes the socket'));

  /* auth timeout: a connection that never proves it has the token must not
     be able to sit on one of the (few) connection slots forever — it gets
     dropped after authTimeoutMs regardless of the idle timer, which only
     starts counting once a request has actually authenticated. */
  var endpoint2 = ls.defaultEndpoint(process.platform, TMP) + '2';
  var t2 = deps(); t2.state.consent = 'granted';
  var srv2 = ls.createServer({ endpoint: endpoint2, deps: t2.deps, authTimeoutMs: 200 });
  await new Promise(function(res, rej) { srv2.start(function(e) { e ? rej(e) : res(); }); });
  var silent = await client(endpoint2);
  assert(!silent.closed(), 'not dropped immediately');
  await silent.waitClose();
  assert(silent.closed(), 'a connection that never authenticates is dropped once authTimeoutMs elapses');
  /* an authenticated connection is unaffected by the same deadline: it must
     prove the token WITHIN the window (a ping right away), then survive
     long past it. */
  var real = await client(endpoint2);
  var pingNow = await real.send({ token: TOKEN, id: 1, method: 'ping' });
  assert.strictEqual(pingNow.pong, true, 'authenticates immediately');
  await new Promise(function(r) { setTimeout(r, 250); });   /* past authTimeoutMs, but already authenticated */
  var pingAfter = await real.send({ token: TOKEN, id: 2, method: 'ping' });
  assert.strictEqual(pingAfter.pong, true, 'a client that authenticated before the deadline is never dropped for it');
  real.sock.destroy();
  await new Promise(function(res) { srv2.stop(res); });
  console.log('  ✓ auth timeout: silent connections are dropped, authenticated ones are unaffected');
}

(async function() {
  try {
    partOne();
    await partTwo();
    try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) { /* temp */ }
    console.log('ALL LINK SERVER TESTS PASSED');
    process.exit(0);
  } catch (e) {
    console.log('LINK SERVER TEST FAILED');
    console.log(e && e.stack || e);
    process.exit(1);
  }
})();
