/* link-controller.js — runs the Kanvaz Link connector inside the app.

   main.js only creates one of these, calls attachWindow(win) when the window
   exists, and stop() on quit. Everything else lives here so it can be tested
   in plain Node: Electron's dialog / ipcMain / window arrive as parameters.

   What it owns:
     - config (<userData>/link-config.json): enabled flag and the consent the
       user gave per client name. Consent is asked HERE, with a native dialog,
       never by the renderer.
     - the private drop directory (<userData>/link-drop, 0700), emptied at
       start and stop, and the discovery file (link.json) clients read.
     - the delivery queue. A delivery waits until the renderer says it is
       ready, then main reads the named file itself (path-guard.readDropFile),
       deletes it, and sends the bytes to the renderer. The renderer never
       receives a path.
     - three IPC handlers for Settings: status, enable/disable, forget consent.

   Off by default it is not: the listener is available, but nothing is accepted
   until the user answers the consent dialog for a program.

   Node-only apart from the parameters. ES5/var-only like the rest of src/. */

'use strict';

var fs = require('fs');
var path = require('path');
var linkServer = require('./link-server');
var mcpAuth = require('./mcp-auth');
var pathGuard = require('./path-guard');

var DROP_DIR_NAME = 'link-drop';
var CONFIG_FILE = 'link-config.json';
var QUEUE_TTL_MS = 10 * 60 * 1000;      /* a delivery not placed within 10 minutes is dropped */
var RENDERER_REPLY_MS = 45 * 1000;
var MAX_CLIENTS_REMEMBERED = 20;

/* Consent is remembered per NORMALISED, case-folded name (see
   link-server.normalizeName), in a prototype-less map so a program called
   "__proto__" or "constructor" is an ordinary entry, not a lookup that always
   succeeds. */
function keyOf(name) { return String(name).toLowerCase(); }

var MIME = {
  glb: 'model/gltf-binary', obj: 'text/plain', fbx: 'application/octet-stream'
};

/* opts: { dataDir, appVersion, dialog, ipcMain, maxModelBytes, log(msg),
           now() (tests), platform (tests) } */
function createLinkController(opts) {
  var dataDir = opts.dataDir;
  var dropDir = path.join(dataDir, DROP_DIR_NAME);
  var log = opts.log || function() {};
  var now = opts.now || Date.now;
  var win = null;
  var rendererReady = false;
  var server = null;
  var token = null;
  var running = false;
  var queue = [];
  var inflight = Object.create(null);
  var sessionConsent = Object.create(null);   /* "allow this session" answers, never written to disk */
  var starting = false;
  var cfg = loadConfig();

  function configPath() { return path.join(dataDir, CONFIG_FILE); }

  function loadConfig() {
    var c = { enabled: true, consent: Object.create(null) };
    try {
      var raw = JSON.parse(fs.readFileSync(path.join(dataDir, CONFIG_FILE), 'utf8'));
      if (raw && typeof raw === 'object') {
        if (raw.enabled === false) c.enabled = false;
        if (raw.consent && typeof raw.consent === 'object') {
          var keys = Object.keys(raw.consent).slice(0, MAX_CLIENTS_REMEMBERED);
          for (var i = 0; i < keys.length; i++) {
            var v = raw.consent[keys[i]];
            if (v === 'granted' || v === 'denied') c.consent[keys[i]] = v;
          }
        }
      }
    } catch (e) { /* first run or unreadable: defaults */ }
    return c;
  }

  /* Keeps the remembered list bounded while the app runs (it was only bounded
     when the file was loaded, so a flood of junk names could push a real
     "allowed" answer out on the next start). Oldest denials go first. */
  function trimConsent() {
    var keys = Object.keys(cfg.consent);
    while (keys.length > MAX_CLIENTS_REMEMBERED) {
      var drop = -1;
      for (var i = 0; i < keys.length; i++) if (cfg.consent[keys[i]] === 'denied') { drop = i; break; }
      if (drop === -1) drop = 0;
      delete cfg.consent[keys[drop]];
      keys.splice(drop, 1);
    }
  }

  function saveConfig() {
    trimConsent();
    try {
      var tmp = configPath() + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(cfg), { encoding: 'utf8', mode: 384 });
      fs.renameSync(tmp, configPath());
    } catch (e) { log('link: could not save config: ' + e.message); }
  }

  /* ── drop directory ── */

  function ensureDropDir() {
    fs.mkdirSync(dropDir, { recursive: true, mode: 448 });
    try { fs.chmodSync(dropDir, 448); } catch (e) { /* not supported on this filesystem */ }
  }

  /* Removes leftovers from a crash or an abandoned delivery. Only plain files
     directly inside the drop directory: never follows a link out of it. */
  function purgeDropDir() {
    var names;
    try { names = fs.readdirSync(dropDir); } catch (e) { return; }
    for (var i = 0; i < names.length; i++) {
      var p = path.join(dropDir, names[i]);
      try {
        var st = fs.lstatSync(p);
        if (st.isFile() || st.isSymbolicLink()) fs.unlinkSync(p);
      } catch (e) { /* in use or already gone */ }
    }
  }

  /* ── what this Kanvaz can receive ── */

  function capabilities() {
    return {
      deliver: {
        formats: ['glb', 'fbx', 'obj'],
        maxBytes: opts.maxModelBytes || 250 * 1024 * 1024,
        animation: { clips: 'select' },
        gltf: { draco: false, meshopt: false, ktx2: false, webp: true, lights: 'ignored', embeddedResourcesOnly: true },
        initialCamera: true,
        upAxis: ['y', 'z'],
        replaceInPlace: false,
        consumesFile: true
      }
    };
  }

  /* ── consent ── */

  function getConsent(name) {
    var k = keyOf(name);
    if (cfg.consent[k]) return cfg.consent[k];
    if (sessionConsent[k]) return sessionConsent[k];
    return 'unknown';
  }

  function requestConsent(name, done) {
    var safe = linkServer.normalizeName(name);
    var msg = {
      type: 'question',
      buttons: ['Allow', 'Allow this session only', 'Don\'t allow'],
      defaultId: 2,
      cancelId: 2,
      title: 'Send 3D models to Kanvaz?',
      message: '“' + safe + '” wants to send 3D models to Kanvaz.',
      detail: 'It will be able to add model cards to your boards. It cannot read your boards or your files. ' +
        'The name shown is chosen by the program asking. You can change this later in Settings.',
      noLink: true
    };
    var finish = function(idx) {
      var k = keyOf(name);
      if (idx === 0) { cfg.consent[k] = 'granted'; saveConfig(); }
      else if (idx === 1) { sessionConsent[k] = 'granted'; }
      else { cfg.consent[k] = 'denied'; saveConfig(); }
      done();
      flush();
    };
    try {
      var p = opts.dialog.showMessageBox(win || undefined, msg);
      if (p && typeof p.then === 'function') p.then(function(r) { finish(r && typeof r.response === 'number' ? r.response : 2); }, function() { finish(2); });
      else finish(2);
    } catch (e) { finish(2); }
  }

  /* ── deliveries ── */

  function reject(d, reason) {
    if (server) server.protocol.setResult(d.deliveryId, { state: 'rejected', reason: reason });
    log('link: delivery ' + d.deliveryId + ' rejected: ' + reason);
  }

  function onDeliver(d) {
    if (!running) return { state: 'rejected', reason: 'Kanvaz Link is switched off' };
    queue.push({ d: d, at: now() });
    setTimeout(flush, 0);
    return { state: 'queued' };
  }

  function unlinkQuiet(p) { try { fs.unlinkSync(p); } catch (e) { /* already gone */ } }

  /* Sends every queued delivery whose turn has come. Safe to call any time. */
  function flush() {
    if (!running || !rendererReady || !win || !win.webContents || win.isDestroyed && win.isDestroyed()) return;
    while (queue.length) {
      var item = queue.shift();
      var d = item.d;
      if (now() - item.at > QUEUE_TTL_MS) { reject(d, 'expired before Kanvaz could place it'); unlinkQuiet(d.path); continue; }
      /* Consent may have been withdrawn since it was queued. */
      if (getConsent(d.client) !== 'granted') { reject(d, 'permission was withdrawn'); unlinkQuiet(d.path); continue; }
      var r = pathGuard.readDropFile(dropDir, d.path, {
        formats: [d.format], maxBytes: capabilities().deliver.maxBytes, expectedSize: d.sizeBytes, sha256: d.sha256
      });
      if (!r.ok) { reject(d, r.reason); continue; }
      unlinkQuiet(d.path);
      inflight[d.deliveryId] = setTimeout(function(id, dd) {
        return function() { delete inflight[id]; reject(dd, 'Kanvaz did not confirm the model was placed'); };
      }(d.deliveryId, d), RENDERER_REPLY_MS);
      win.webContents.send('link-deliver', {
        deliveryId: d.deliveryId,
        name: d.name,
        format: d.format,
        dataUrl: 'data:' + (MIME[d.format] || 'application/octet-stream') + ';base64,' + r.data.toString('base64'),
        sizeBytes: d.sizeBytes,
        animationClip: d.animationClip,
        cameraPosition: d.cameraPosition,
        cameraTarget: d.cameraTarget,
        bgColor: d.bgColor,
        upAxis: d.upAxis,
        source: d.source
      });
    }
  }

  /* ── lifecycle ── */

  function start(cb) {
    cb = cb || function() {};
    if (running || starting) { cb(null); return; }   /* two overlapping starts would split the token from the listener */
    if (!cfg.enabled) { cb(null); return; }
    starting = true;
    try {
      fs.mkdirSync(dataDir, { recursive: true });
      ensureDropDir();
      purgeDropDir();
    } catch (e) { starting = false; log('link: cannot prepare drop directory: ' + e.message); cb(e); return; }
    token = mcpAuth.generateToken();
    var endpoint = linkServer.defaultEndpoint(opts.platform || process.platform, dataDir);
    server = linkServer.createServer({
      endpoint: endpoint,
      deps: {
        token: token, dropDir: dropDir, appVersion: opts.appVersion || '0',
        capabilities: capabilities, getConsent: getConsent, requestConsent: requestConsent, onDeliver: onDeliver
      }
    });
    server.start(function(err) {
      starting = false;
      if (err) { log('link: listener failed to start: ' + err.message); server = null; cb(err); return; }
      running = true;
      try {
        /* Written only now that something is really listening. */
        linkServer.writeDiscovery(dataDir, {
          protocol: linkServer.PROTOCOL, endpoint: endpoint, token: token, dropDir: dropDir,
          pid: process.pid, appVersion: opts.appVersion || '0'
        });
      } catch (e) { log('link: could not write discovery file: ' + e.message); }
      cb(null);
    });
  }

  function stop(cb) {
    cb = cb || function() {};
    running = false;
    var keys = Object.keys(inflight);
    for (var i = 0; i < keys.length; i++) { clearTimeout(inflight[keys[i]]); delete inflight[keys[i]]; }
    queue = [];
    linkServer.removeDiscovery(dataDir);
    var s = server;
    server = null;
    purgeDropDir();
    if (!s) { cb(); return; }
    s.stop(cb);
  }

  function attachWindow(w) {
    win = w;
    rendererReady = false;
    if (w && w.webContents && typeof w.webContents.on === 'function') {
      /* A reload or a new page load means the renderer is not listening. */
      w.webContents.on('did-start-loading', function() { rendererReady = false; });
    }
  }

  function detachWindow() { win = null; rendererReady = false; }

  /* ── IPC (registered once) ── */

  function fromWindow(event) {
    return !!(win && win.webContents && event && event.sender === win.webContents);
  }

  function clientList() {
    var out = [];
    var names = Object.keys(cfg.consent);
    for (var i = 0; i < names.length; i++) out.push({ name: names[i], state: cfg.consent[names[i]] });
    return out;
  }

  function registerIpc() {
    var ipc = opts.ipcMain;
    ipc.on('link-renderer-ready', function(event) {
      if (!fromWindow(event)) return;
      rendererReady = true;
      flush();
    });
    ipc.on('link-result', function(event, r) {
      if (!fromWindow(event) || !r || typeof r.deliveryId !== 'string' || !inflight[r.deliveryId]) return;
      clearTimeout(inflight[r.deliveryId]);
      delete inflight[r.deliveryId];
      if (server) {
        server.protocol.setResult(r.deliveryId, r.ok === true
          ? { state: 'placed', cardId: typeof r.cardId === 'string' ? r.cardId : null }
          : { state: 'rejected', reason: typeof r.reason === 'string' ? r.reason : 'the model could not be shown' });
      }
      if (r.ok === true && win) {
        try { if (win.isMinimized()) win.restore(); win.show(); win.focus(); } catch (e) { /* focus is best effort */ }
      }
    });
    ipc.handle('link-get-status', function(event) {
      if (!fromWindow(event)) return { ok: false };
      return { ok: true, enabled: cfg.enabled, running: running, clients: clientList() };
    });
    ipc.handle('link-set-enabled', function(event, on) {
      if (!fromWindow(event)) return { ok: false };
      cfg.enabled = on === true;
      saveConfig();
      if (cfg.enabled) {
        return new Promise(function(res) { start(function(err) { res({ ok: !err, enabled: cfg.enabled, running: running }); }); });
      }
      return new Promise(function(res) { stop(function() { res({ ok: true, enabled: false, running: false }); }); });
    });
    ipc.handle('link-forget-consent', function(event, name) {
      if (!fromWindow(event)) return { ok: false };
      if (typeof name === 'string') { delete cfg.consent[keyOf(name)]; delete sessionConsent[keyOf(name)]; }
      else { cfg.consent = Object.create(null); sessionConsent = Object.create(null); }
      saveConfig();
      return { ok: true, clients: clientList() };
    });
  }

  registerIpc();

  return {
    start: start, stop: stop, attachWindow: attachWindow, detachWindow: detachWindow,
    dropDir: dropDir, isRunning: function() { return running; },
    /* test hooks */
    _flush: flush, _config: function() { return cfg; }
  };
}

module.exports = { createLinkController: createLinkController, DROP_DIR_NAME: DROP_DIR_NAME, CONFIG_FILE: CONFIG_FILE };
