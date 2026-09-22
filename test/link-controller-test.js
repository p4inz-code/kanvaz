#!/usr/bin/env node
/* link-controller-test.js — the Kanvaz Link connector as main.js runs it.

   Electron's dialog / ipcMain / window are replaced by small fakes; the
   listener, the drop directory, the queue and the file handling are real, and
   a fake add-on talks to it over a real named pipe / Unix socket.

   Walks the whole story: first contact and the consent prompt, a delivery
   that waits for the renderer, the bytes reaching the renderer (and the file
   being deleted), the result travelling back to the add-on, then the ways it
   must say no. */

var assert = require('assert');
var fs = require('fs');
var os = require('os');
var path = require('path');
var net = require('net');
var crypto = require('crypto');
var lc = require('../src/link-controller');

var W = process.platform === 'win32';
var TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'kz-linkc-'));

function sleep(ms) { return new Promise(function(r) { setTimeout(r, ms); }); }
async function until(fn, what) {
  for (var i = 0; i < 100; i++) { if (fn()) return; await sleep(30); }
  throw new Error('timed out waiting for: ' + what);
}

function fakes(answerIdx) {
  var f = { sent: [], dialogs: [], handlers: {}, listeners: {}, focus: 0, answer: answerIdx };
  f.webContents = {
    send: function(ch, payload) { f.sent.push({ ch: ch, payload: payload }); },
    on: function(ev, fn) { f.listeners[ev] = fn; }
  };
  f.win = { webContents: f.webContents, isDestroyed: function() { return false; }, isMinimized: function() { return false; }, restore: function() {}, show: function() {}, focus: function() { f.focus++; } };
  f.dialog = { showMessageBox: function(w, msg) { f.dialogs.push(msg); return Promise.resolve({ response: f.answer }); } };
  f.ipcMain = {
    on: function(ch, fn) { f.handlers[ch] = fn; },
    handle: function(ch, fn) { f.handlers[ch] = fn; }
  };
  f.fromWin = { sender: f.webContents };
  f.fromOther = { sender: {} };
  return f;
}

function connect(endpoint) {
  return new Promise(function(resolve, reject) {
    var s = net.connect(endpoint);
    var buf = '', waiting = [];
    s.setEncoding('utf8');
    s.on('data', function(c) {
      buf += c;
      var nl;
      while ((nl = buf.indexOf('\n')) !== -1) { var line = buf.slice(0, nl); buf = buf.slice(nl + 1); var w = waiting.shift(); if (w) w(JSON.parse(line)); }
    });
    s.on('error', reject);
    s.on('connect', function() {
      resolve({ send: function(o) { return new Promise(function(res) { waiting.push(res); s.write(JSON.stringify(o) + '\n'); }); }, close: function() { s.destroy(); } });
    });
  });
}

function discovery(dir) { return JSON.parse(fs.readFileSync(path.join(dir, 'link.json'), 'utf8')); }
function startCtl(dir, f) {
  var ctl = lc.createLinkController({ dataDir: dir, appVersion: '9.9.9', dialog: f.dialog, ipcMain: f.ipcMain, maxModelBytes: 1024 * 1024, log: function() {} });
  ctl.attachWindow(f.win);
  return new Promise(function(res, rej) { ctl.start(function(e) { e ? rej(e) : res(ctl); }); });
}

async function run() {
  var dir = path.join(TMP, 'kanvaz');
  fs.mkdirSync(dir, { recursive: true });
  var stale = path.join(dir, 'link-drop');
  fs.mkdirSync(stale, { recursive: true });
  fs.writeFileSync(path.join(stale, 'leftover.glb'), 'old');

  var f = fakes(0);   /* 0 = "Allow" */
  var ctl = await startCtl(dir, f);
  assert(ctl.isRunning());
  assert(!fs.existsSync(path.join(stale, 'leftover.glb')), 'leftovers in the drop directory are purged at start');
  var info = discovery(dir);
  assert(info.protocol === 1 && info.dropDir === ctl.dropDir && /^[0-9a-f]{64}$/.test(info.token), 'discovery file has the endpoint, token and drop dir');
  if (!W) {
    assert.strictEqual(fs.statSync(path.join(dir, 'link.json')).mode & 0o777, 0o600, 'discovery file is 0600');
    assert.strictEqual(fs.statSync(ctl.dropDir).mode & 0o777, 0o700, 'drop directory is 0700');
  }
  console.log('  ✓ start: drop dir prepared and purged, discovery file written after listen');

  /* first contact -> native dialog, once */
  var c = await connect(info.endpoint);
  var nonce = crypto.randomBytes(16).toString('hex');
  var hello = await c.send({ token: info.token, id: 1, method: 'hello', nonce: nonce, client: { name: 'Kanvaz Link for Blender', version: '1.0' } });
  assert(hello.ok && hello.consent === 'pending', 'first hello: consent pending');
  assert.deepStrictEqual(hello.capabilities.deliver.formats, ['glb', 'fbx', 'obj'], 'formats advertised');
  assert.strictEqual(hello.capabilities.deliver.gltf.draco, false, 'Draco is advertised as unsupported');
  assert.strictEqual(hello.capabilities.deliver.animation.clips, 'select', 'clip selection advertised');
  await until(function() { return f.dialogs.length === 1; }, 'consent dialog');
  assert(/Kanvaz Link for Blender/.test(f.dialogs[0].message), 'the dialog names the program');
  assert.strictEqual(f.dialogs[0].defaultId, 2, 'the default button is "Don\'t allow"');
  await until(function() { return ctl._config().consent['kanvaz link for blender'] === 'granted'; }, 'consent stored');
  assert(fs.existsSync(path.join(dir, 'link-config.json')), 'consent persisted to disk');
  var h2 = await c.send({ token: info.token, id: 2, method: 'hello', nonce: nonce, client: { name: 'Kanvaz Link for Blender' } });
  assert.strictEqual(h2.consent, 'granted');
  assert.strictEqual(f.dialogs.length, 1, 'no second prompt');
  console.log('  ✓ first contact shows one native prompt (default Deny); the answer is remembered');

  /* a delivery waits for the renderer */
  var model = crypto.randomBytes(2000);
  var file = path.join(ctl.dropDir, 'cube.glb');
  fs.writeFileSync(file, model);
  var deliver = { token: info.token, id: 3, method: 'deliver', client: { name: 'Kanvaz Link for Blender' }, path: file, format: 'glb', name: 'Cube', sizeBytes: model.length,
    sha256: crypto.createHash('sha256').update(model).digest('hex'), animation: { clip: 1 }, upAxis: 'z', source: { app: 'blender', version: '5.2', objectId: 'o1' } };
  var d = await c.send(deliver);
  assert(d.ok && d.state === 'queued');
  await sleep(150);
  assert.strictEqual(f.sent.length, 0, 'nothing is sent while the renderer is not ready');
  assert(fs.existsSync(file), 'the file is not touched until it is time');

  f.handlers['link-renderer-ready'](f.fromOther);
  await sleep(100);
  assert.strictEqual(f.sent.length, 0, 'a "ready" from anything but the app window is ignored');
  f.handlers['link-renderer-ready'](f.fromWin);
  await until(function() { return f.sent.length === 1; }, 'delivery sent to the renderer');
  var msg = f.sent[0];
  assert.strictEqual(msg.ch, 'link-deliver');
  var p = msg.payload;
  assert.strictEqual(p.dataUrl, 'data:model/gltf-binary;base64,' + model.toString('base64'), 'the renderer gets the exact bytes');
  assert(p.deliveryId === d.deliveryId && p.name === 'Cube' && p.animationClip === 1 && p.upAxis === 'z', 'metadata carried across');
  assert.strictEqual(p.path, undefined, 'the renderer is never given a path');
  assert(!fs.existsSync(file), 'the file is deleted once read');
  var s1 = await c.send({ token: info.token, id: 4, method: 'status', deliveryId: d.deliveryId });
  assert.strictEqual(s1.state, 'queued', 'still queued until the renderer answers');

  f.handlers['link-result'](f.fromOther, { deliveryId: d.deliveryId, ok: true, cardId: 'evil' });
  assert.strictEqual((await c.send({ token: info.token, id: 5, method: 'status', deliveryId: d.deliveryId })).state, 'queued', 'a result from a foreign sender is ignored');
  f.handlers['link-result'](f.fromWin, { deliveryId: d.deliveryId, ok: true, cardId: 'card-42' });
  var s2 = await c.send({ token: info.token, id: 6, method: 'status', deliveryId: d.deliveryId });
  assert(s2.state === 'placed' && s2.cardId === 'card-42', 'the add-on can see the model was placed');
  assert(f.focus >= 1, 'Kanvaz raises its window when a model lands');
  console.log('  ✓ delivery waits for the renderer, arrives byte-for-byte, file deleted, result reaches the add-on');

  /* the ways it must say no */
  async function rejectedWith(patchFile, patch, re, why) {
    var fp = path.join(ctl.dropDir, patchFile.name);
    fs.writeFileSync(fp, patchFile.bytes);
    var req = Object.assign({ token: info.token, id: 20, method: 'deliver', client: { name: 'Kanvaz Link for Blender' }, path: fp, format: 'glb', name: 'x', sizeBytes: patchFile.bytes.length }, patch || {});
    var r = await c.send(req);
    if (r.ok) {
      await until(function() { return true; }, 'noop');
      await sleep(200);
      var st = await c.send({ token: info.token, id: 21, method: 'status', deliveryId: r.deliveryId });
      assert.strictEqual(st.state, 'rejected', why + ' -> rejected (was ' + st.state + ')');
      assert(re.test(st.reason || ''), why + ': reason "' + st.reason + '" should match ' + re);
    } else {
      assert(re.test((r.reason || r.message || r.error || '')), why + ': "' + (r.reason || r.message || r.error) + '"');
    }
  }
  var sentBefore = f.sent.length;
  await rejectedWith({ name: 'a.glb', bytes: Buffer.from('12345678') }, { sizeBytes: 999 }, /size does not match/, 'a size that differs from the announced one');
  await rejectedWith({ name: 'b.glb', bytes: Buffer.from('abcdefgh') }, { sha256: '0'.repeat(64) }, /checksum/, 'a wrong checksum');
  await rejectedWith({ name: 'c.glb', bytes: Buffer.from('abcdefgh') }, { format: 'obj' }, /format not allowed/, 'a file whose extension is not the announced format');
  await rejectedWith({ name: 'd.glb', bytes: Buffer.alloc(2 * 1024 * 1024) }, {}, /larger|too large|limit/, 'a file over the size limit');
  var out = path.join(TMP, 'outside.glb'); fs.writeFileSync(out, 'secret');
  var r1 = await c.send({ token: info.token, id: 22, method: 'deliver', client: { name: 'Kanvaz Link for Blender' }, path: out, format: 'glb', sizeBytes: 6 });
  assert(!r1.ok, 'a file outside the drop directory is refused'); assert(fs.existsSync(out), 'and is left alone');
  assert.strictEqual(f.sent.length, sentBefore, 'none of those reached the renderer');
  console.log('  ✓ wrong size, wrong checksum, wrong extension, oversize and outside-the-dir files never reach the renderer');

  /* foreign sender cannot use the settings channels */
  assert.strictEqual((await f.handlers['link-get-status'](f.fromOther)).ok, false, 'status is for the app window only');
  var stt = await f.handlers['link-get-status'](f.fromWin);
  assert(stt.ok && stt.running && stt.clients[0].name === 'kanvaz link for blender' && stt.clients[0].state === 'granted');
  var fg = await f.handlers['link-forget-consent'](f.fromWin, 'Kanvaz Link for Blender');
  assert.deepStrictEqual(fg.clients, [], 'forget removes the remembered answer');
  var h3 = await c.send({ token: info.token, id: 30, method: 'hello', nonce: nonce, client: { name: 'Kanvaz Link for Blender' } });
  assert.strictEqual(h3.consent, 'pending', 'after forgetting, the prompt returns');
  await until(function() { return f.dialogs.length === 2; }, 'second dialog after forget');
  console.log('  ✓ settings channels are window-only; forgetting consent brings the prompt back');
  c.close();

  /* switch off */
  var off = await f.handlers['link-set-enabled'](f.fromWin, false);
  assert(off.ok && off.running === false);
  assert(!fs.existsSync(path.join(dir, 'link.json')), 'discovery file removed when switched off');
  assert.deepStrictEqual(fs.readdirSync(ctl.dropDir), [], 'drop directory emptied');
  await new Promise(function(res) { var s = net.connect(info.endpoint); s.on('error', function() { res(); }); s.on('connect', function() { s.destroy(); assert.fail('still listening'); }); });
  assert.strictEqual(JSON.parse(fs.readFileSync(path.join(dir, 'link-config.json'), 'utf8')).enabled, false, 'the off switch is remembered');
  var on = await f.handlers['link-set-enabled'](f.fromWin, true);
  assert(on.ok && on.running, 'and can be switched back on');
  await new Promise(function(res) { ctl.stop(res); });
  console.log('  ✓ off switch stops the listener, removes the discovery file, empties the drop dir, and is remembered');

  /* "this session only" and "deny" */
  var dir2 = path.join(TMP, 'k2'); fs.mkdirSync(dir2);
  var f2 = fakes(1);   /* 1 = allow this session */
  var ctl2 = await startCtl(dir2, f2);
  var i2 = discovery(dir2);
  var c2 = await connect(i2.endpoint);
  await c2.send({ token: i2.token, id: 1, method: 'hello', nonce: nonce, client: { name: 'Session Tool' } });
  await until(function() { return f2.dialogs.length === 1; }, 'dialog');
  await sleep(100);
  assert.strictEqual((await c2.send({ token: i2.token, id: 2, method: 'hello', nonce: nonce, client: { name: 'Session Tool' } })).consent, 'granted', 'allowed for the session');
  assert.strictEqual(fs.existsSync(path.join(dir2, 'link-config.json')) && JSON.parse(fs.readFileSync(path.join(dir2, 'link-config.json'), 'utf8')).consent['session tool'], false, 'a session-only answer is never written to disk');
  c2.close();
  await new Promise(function(res) { ctl2.stop(res); });

  var dir3 = path.join(TMP, 'k3'); fs.mkdirSync(dir3);
  var f3 = fakes(2);   /* 2 = don't allow */
  var ctl3 = await startCtl(dir3, f3);
  var i3 = discovery(dir3);
  var c3 = await connect(i3.endpoint);
  await c3.send({ token: i3.token, id: 1, method: 'hello', nonce: nonce, client: { name: 'Nope' } });
  await until(function() { return f3.dialogs.length === 1; }, 'dialog');
  await sleep(100);
  var fpx = path.join(ctl3.dropDir, 'n.glb'); fs.writeFileSync(fpx, 'abcd');
  var dn = await c3.send({ token: i3.token, id: 2, method: 'deliver', client: { name: 'Nope' }, path: fpx, format: 'glb', sizeBytes: 4 });
  assert(!dn.ok && dn.state === 'rejected', 'a denied client cannot deliver');
  f3.handlers['link-renderer-ready'](f3.fromWin); await sleep(100);
  assert.strictEqual(f3.sent.length, 0, 'nothing reaches the renderer');
  c3.close();
  await new Promise(function(res) { ctl3.stop(res); });
  var ctl3b = lc.createLinkController({ dataDir: dir3, appVersion: '9', dialog: f3.dialog, ipcMain: fakes(2).ipcMain, log: function() {} });
  assert.strictEqual(ctl3b._config().consent['nope'], 'denied', 'a denial survives a restart');
  console.log('  ✓ "this session only" is not persisted; "don\'t allow" blocks delivery and survives a restart');

  /* window reload */
  var dir4 = path.join(TMP, 'k4'); fs.mkdirSync(dir4);
  var f4 = fakes(0);
  var ctl4 = await startCtl(dir4, f4);
  f4.handlers['link-renderer-ready'](f4.fromWin);
  f4.listeners['did-start-loading']();
  var i4 = discovery(dir4);
  var c4 = await connect(i4.endpoint);
  await c4.send({ token: i4.token, id: 1, method: 'hello', nonce: nonce, client: { name: 'T' } });
  await until(function() { return ctl4._config().consent['t'] === 'granted'; }, 'consent');
  var fp4 = path.join(ctl4.dropDir, 'r.glb'); fs.writeFileSync(fp4, 'abcd');
  await c4.send({ token: i4.token, id: 2, method: 'deliver', client: { name: 'T' }, path: fp4, format: 'glb', sizeBytes: 4 });
  await sleep(150);
  assert.strictEqual(f4.sent.length, 0, 'after a page reload nothing is sent until the renderer says it is ready again');
  f4.handlers['link-renderer-ready'](f4.fromWin);
  await until(function() { return f4.sent.length === 1; }, 'sent after ready');
  c4.close();
  await new Promise(function(res) { ctl4.stop(res); });
  console.log('  ✓ a page reload pauses delivery until the renderer is ready again');

  /* a hostile client name cannot pollute Object.prototype: consent is kept
     in null-prototype maps (Object.create(null)) keyed by the lower-cased
     name specifically so "__proto__" is an ordinary entry, never a write
     through the prototype chain. */
  var dir5 = path.join(TMP, 'k5'); fs.mkdirSync(dir5);
  var f5 = fakes(0);
  var ctl5 = await startCtl(dir5, f5);
  var i5 = discovery(dir5);
  var c5 = await connect(i5.endpoint);
  await c5.send({ token: i5.token, id: 1, method: 'hello', nonce: nonce, client: { name: '__proto__' } });
  await until(function() { return f5.dialogs.length === 1; }, 'dialog for __proto__');
  await sleep(100);
  var h5 = await c5.send({ token: i5.token, id: 2, method: 'hello', nonce: nonce, client: { name: '__proto__' } });
  assert.strictEqual(h5.consent, 'granted', '"__proto__" as a name is treated like any other string');
  assert.strictEqual(({}).polluted, undefined, 'Object.prototype was never touched');
  assert(!Object.prototype.hasOwnProperty.call({}, 'polluted'), 'plain objects remain unaffected');
  await c5.send({ token: i5.token, id: 3, method: 'hello', nonce: nonce, client: { name: 'constructor' } });
  await until(function() { return f5.dialogs.length === 2; }, 'dialog for constructor');
  await sleep(100);
  var stt5 = await f5.handlers['link-get-status'](f5.fromWin);
  var names5 = stt5.clients.map(function(c) { return c.name; }).sort();
  assert.deepStrictEqual(names5, ['__proto__', 'constructor'], 'both are stored as ordinary, independent entries');
  c5.close();
  await new Promise(function(res) { ctl5.stop(res); });
  console.log('  ✓ a client named "__proto__" or "constructor" is just a string key, never touches Object.prototype');

  /* name-variant spoofing: casing/whitespace/hidden characters must not let
     a denied program back in under a "different" name, and must not split
     one program's consent across several dialog prompts. */
  var dir6 = path.join(TMP, 'k6'); fs.mkdirSync(dir6);
  var f6 = fakes(2);   /* 2 = don't allow */
  var ctl6 = await startCtl(dir6, f6);
  var i6 = discovery(dir6);
  var c6a = await connect(i6.endpoint);
  await c6a.send({ token: i6.token, id: 1, method: 'hello', nonce: nonce, client: { name: 'Kanvaz Link for Blender' } });
  await until(function() { return f6.dialogs.length === 1; }, 'first dialog');
  await sleep(100);
  assert.strictEqual(ctl6._config().consent['kanvaz link for blender'], 'denied', 'denied under the normalised name');
  var c6b = await connect(i6.endpoint);
  var spoof = await c6b.send({ token: i6.token, id: 2, method: 'hello', nonce: nonce, client: { name: '  KANVAZ LINK   FOR BLENDER  ' } });
  assert.strictEqual(spoof.consent, 'denied', 'a case/whitespace variant of a denied name is still denied');
  assert.strictEqual(f6.dialogs.length, 1, 'no second prompt for a variant of an already-answered name');
  c6a.close(); c6b.close();
  await new Promise(function(res) { ctl6.stop(res); });
  console.log('  ✓ name variants (case, whitespace) share one consent answer and cannot re-prompt or bypass a denial');

  /* consent flood cap: a stream of distinct client names must not grow the
     remembered list without bound — trimConsent() keeps it at
     MAX_CLIENTS_REMEMBERED (20), dropping denials first. */
  var dir7 = path.join(TMP, 'k7'); fs.mkdirSync(dir7);
  var f7 = fakes(2);   /* 2 = don't allow, so every flood entry is a denial */
  var ctl7 = await startCtl(dir7, f7);
  var i7 = discovery(dir7);
  for (var fl = 0; fl < 30; fl++) {
    var cf = await connect(i7.endpoint);
    var nonceF = crypto.randomBytes(16).toString('hex');
    await cf.send({ token: i7.token, id: 1, method: 'hello', nonce: nonceF, client: { name: 'flood-client-' + fl } });
    await until((function(n) { return function() { return f7.dialogs.length === n; }; })(fl + 1), 'flood dialog ' + fl);
    await sleep(20);
    cf.close();
  }
  var keys7 = Object.keys(ctl7._config().consent);
  assert(keys7.length <= 20, 'the remembered consent list never exceeds MAX_CLIENTS_REMEMBERED (has ' + keys7.length + ')');
  assert(fs.existsSync(path.join(dir7, 'link-config.json')), 'trimmed list is still persisted');
  var onDisk7 = JSON.parse(fs.readFileSync(path.join(dir7, 'link-config.json'), 'utf8')).consent;
  assert(Object.keys(onDisk7).length <= 20, 'the file on disk is bounded too');
  await new Promise(function(res) { ctl7.stop(res); });
  console.log('  ✓ consent flood: 30 distinct clients never push the remembered list past 20');

  /* overlapping start(): two callers racing to start the same controller
     (e.g. the app.js init path firing twice) must not split the token from
     the listener or leave it half-started. */
  var dir8 = path.join(TMP, 'k8'); fs.mkdirSync(dir8);
  var f8 = fakes(0);
  var ctl8 = lc.createLinkController({ dataDir: dir8, appVersion: '9.9.9', dialog: f8.dialog, ipcMain: f8.ipcMain, log: function() {} });
  ctl8.attachWindow(f8.win);
  var results8 = await Promise.all([
    new Promise(function(res) { ctl8.start(function(e) { res(e || null); }); }),
    new Promise(function(res) { ctl8.start(function(e) { res(e || null); }); })
  ]);
  assert(results8[0] === null && results8[1] === null, 'both overlapping start() calls report success, neither errors');
  assert(ctl8.isRunning(), 'the controller ends up running');
  var i8 = discovery(dir8);
  var c8 = await connect(i8.endpoint);
  var pong8 = await c8.send({ token: i8.token, id: 1, method: 'ping' });
  assert.strictEqual(pong8.pong, true, 'the token that was written matches the listener that is actually running');
  c8.close();
  await new Promise(function(res) { ctl8.stop(res); });
  console.log('  ✓ overlapping start() calls never split the token from the listener');
}

run().then(function() {
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) { /* temp */ }
  console.log('ALL LINK CONTROLLER TESTS PASSED');
  process.exit(0);
}).catch(function(e) {
  console.log('LINK CONTROLLER TEST FAILED');
  console.log(e && e.stack || e);
  process.exit(1);
});
