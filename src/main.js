/* main.js — Kanvaz main process */

var electron = require('electron');
var app = electron.app;
var BrowserWindow = electron.BrowserWindow;
var ipcMain = electron.ipcMain;
var dialog = electron.dialog;
var shell = electron.shell;
var path = require('path');
var fs = require('fs');
var net = require('net');
var https = require('https');
var http = require('http');
var nodeUrl = require('url');
var JSZip = require('jszip');
var Worker = require('worker_threads').Worker;

var boardContainer = require('./board-container');
var pluginLoader = require('./plugin-loader');
var kanvazProfiles = require('./profiles');

/* electron-updater is a real dependency (see package.json), but it's
   wrapped in try/catch anyway — if it's ever missing (e.g. a stripped
   dev checkout without a full npm install) the app should still start
   normally with updates simply unavailable, not crash on require(). */
var autoUpdater = null;
try {
  autoUpdater = require('electron-updater').autoUpdater;
} catch (e) {
  autoUpdater = null;
}

var mainWindow = null;
var allowClose = false;
var pendingFileOpen = null;
/* Redesign v1 Phase 2: settings/recent/recovery are now owned by the
   ACTIVE PROFILE (docs/PROFILES_SYSTEM_PLAN.md), not fixed paths under
   userData directly — so these are functions, re-resolved on every
   call, not module-level constants. A profile switch mid-session (see
   'profiles-switch' below) takes effect on the very next call with no
   extra plumbing, since nothing ever caches the resolved path. */
function getRecoveryDir() {
  return path.join(kanvazProfiles.getActiveProfileDir(app.getPath('userData')), 'recovery');
}
function getRecentFilesPath() {
  return path.join(kanvazProfiles.getActiveProfileDir(app.getPath('userData')), 'recent.json');
}
/* Board thumbnails (Home Screen "Recent" tiles) — a small separate
   {absolutePath: jpegDataUrl} map, deliberately NOT stored inside the
   .kanvaz board files themselves: the Home Screen's recent-boards list
   only ever needs a cheap fs.statSync() per entry today (see
   recent-get below), and reading every recent board's full JSON just
   to pull out one field would defeat that — a board file can embed
   sizeable video/3D data. This map is small (one JPEG per board,
   capped by MAX_THUMBNAILS below) and quick to read whole. */
function getThumbnailsPath() {
  return path.join(kanvazProfiles.getActiveProfileDir(app.getPath('userData')), 'thumbnails.json');
}
var MAX_THUMBNAILS = 50;
var MAX_RECENT = 8;
var LARGE_FILE_WARN_MB = 200;
var MAX_FILE_SIZE_MB   = 500;
/* v7.x — 3D models get their own, tighter cap than general media. A 500MB
   glTF/OBJ/FBX is almost always an authoring mistake (unbaked textures,
   uncompressed point clouds) and would stall the render-on-demand viewer
   for way too long on load; 150MB comfortably covers real game/VFX assets
   while keeping the embed-into-savefile cost sane. */
var MAX_MODEL_SIZE_MB  = 150;

/* ── MCP Bridge (4.4.0) — main-process side ──
   The only official plugin allowed to open this listener; checked by
   id, never by anything a renderer/plugin claims about itself (same
   "never trust the renderer's say-so" discipline as the rest of the
   plugin IPC surface below). Local IPC only — a named pipe on Windows,
   a Unix domain socket on macOS/Linux — never a TCP port, so there is
   no "bound to the wrong interface" failure mode to even worry about:
   nothing outside this machine's own kernel can ever reach it. */
var MCP_BRIDGE_PLUGIN_ID = 'studio.northbyte.mcp-bridge';
var MCP_BRIDGE_TIMEOUT_MS = 15000;
var mcpBridgeServer = null;
var mcpBridgePending = {};
var mcpBridgeRequestSeq = 0;

/* Module-level (not inside registerIPC()) specifically so before-quit's
   cleanup — defined outside registerIPC(), at the top-level startup
   block below — can actually reach this to terminate it. A registerIPC()-
   local var would have been invisible there, silently leaking the
   worker process past app quit until the OS itself reaped it. */
var smartSearchWorker = null;
var smartSearchPending = {};
var smartSearchReqId = 0;

function getMcpBridgeSocketPath() {
  if (process.platform === 'win32') return '\\\\.\\pipe\\kanvaz-mcp-bridge';
  return path.join(app.getPath('userData'), 'mcp-bridge.sock');
}

/* Asks the renderer to run one MCP tool call (createCard, listCards,
   ...) and resolves with its result. No existing IPC pattern in this
   file does a main→renderer→main round trip (every other push here —
   'update-available', 'recovery-available', etc. — is fire-and-forget),
   so this builds the small amount of correlation plumbing that needs:
   a generated request id, a pending-promise map, and a timeout so one
   stuck/ignored request can't leak a promise forever. */
function invokeRenderer(method, args) {
  return new Promise(function(resolve, reject) {
    if (!mainWindow || mainWindow.isDestroyed()) {
      reject(new Error('Kanvaz window is not available'));
      return;
    }
    mcpBridgeRequestSeq++;
    var requestId = 'mcp-' + Date.now() + '-' + mcpBridgeRequestSeq;
    var timer = setTimeout(function() {
      delete mcpBridgePending[requestId];
      reject(new Error('renderer did not respond within ' + (MCP_BRIDGE_TIMEOUT_MS / 1000) + 's'));
    }, MCP_BRIDGE_TIMEOUT_MS);
    mcpBridgePending[requestId] = { resolve: resolve, reject: reject, timer: timer };
    mainWindow.webContents.send('mcp-invoke', { requestId: requestId, method: method, args: args });
  });
}

/* One connection = one client session (the standalone stdio shim script
   in official-plugins/mcp-bridge/server.js, spawned by Claude Desktop/
   Code's own MCP client machinery — Kanvaz itself never spawns or
   manages that process). Framing is newline-delimited JSON, one request
   or response object per line — deliberately the simplest thing that
   works rather than a heavier framed-binary protocol.

   Audit correction: the line above used to call this "a trusted same-
   machine, already-permissioned local channel, not anything untrusted
   input needs defending against at the byte level" — true for WHO can
   reach this listener at all (see SECURITY.md's MCP Bridge section for
   the honest, current statement of that), but not a reason to skip a
   basic resource-safety cap: a connecting process that simply never
   sends '\n' would previously grow `buffer` unbounded, a memory-
   exhaustion DoS against the main process. MAX_LINE_BUFFER_BYTES below
   closes that regardless of how trusted the caller is meant to be. */
var MAX_LINE_BUFFER_BYTES = 10 * 1024 * 1024;

function handleMcpBridgeConnection(socket) {
  var buffer = '';
  socket.setEncoding('utf8');
  socket.on('data', function(chunk) {
    buffer += chunk;
    if (buffer.length > MAX_LINE_BUFFER_BYTES) {
      socket.destroy();
      return;
    }
    var lines = buffer.split('\n');
    buffer = lines.pop();
    for (var i = 0; i < lines.length; i++) {
      (function(line) {
        line = line.trim();
        if (!line) return;
        var req;
        try {
          req = JSON.parse(line);
        } catch (e) {
          socket.write(JSON.stringify({ id: null, error: 'invalid JSON: ' + e.message }) + '\n');
          return;
        }
        /* Bug bounty fix: a syntactically valid JSON line whose value is
           the literal `null` (or any non-object) passed the try/catch
           above unharmed, then req.method/req.params below threw
           synchronously — uncaught, since this runs inside a socket
           'data' callback with nothing above it to catch it, crashing
           the ENTIRE main process (every open board, not just this
           connection) on one malformed line from whatever's connected
           to the pipe/socket. */
        if (!req || typeof req !== 'object' || Array.isArray(req)) {
          socket.write(JSON.stringify({ id: null, error: 'request must be a JSON object with method/params' }) + '\n');
          return;
        }
        invokeRenderer(req.method, req.params).then(function(result) {
          socket.write(JSON.stringify({ id: req.id, result: result }) + '\n');
        }).catch(function(e) {
          socket.write(JSON.stringify({ id: req.id, error: e.message }) + '\n');
        });
      })(lines[i]);
    }
  });
  socket.on('error', function() { /* client disconnected mid-write, etc. — nothing to clean up per-socket */ });
}

function startMcpBridgeServer() {
  if (mcpBridgeServer) return Promise.resolve({ ok: true, alreadyRunning: true });

  var socketPath = getMcpBridgeSocketPath();

  function listen() {
    return new Promise(function(resolve, reject) {
      var server = net.createServer(handleMcpBridgeConnection);
      server.on('error', function(e) { reject(e); });
      server.listen(socketPath, function() {
        mcpBridgeServer = server;
        resolve({ ok: true });
      });
    });
  }

  if (process.platform === 'win32') return listen();

  /* POSIX only: a stale socket FILE left behind by an unclean previous
     shutdown makes listen() fail with EADDRINUSE even though nothing is
     actually using it — Windows named pipes have no such filesystem
     artifact to clean up, hence the branch above skipping this. */
  return new Promise(function(resolve) {
    fs.unlink(socketPath, function() { resolve(); });
  }).then(listen);
}

/* ── Browse Official Plugins (4.4.0) ──
   The one deliberate network call this feature makes, same disclosure
   discipline as "Check for updates": fires ONLY when the user clicks
   "Browse Official Plugins" (never on a timer or at startup), and stays
   in the main process rather than adding a new CSP connect-src entry
   that would make raw.githubusercontent.com trivially fetchable from
   ANY renderer/plugin code going forward — routing it through one
   narrow IPC handler keeps the same "only main process reaches the
   network" discipline every other Kanvaz network call already follows. */
var OFFICIAL_CATALOG_URL = 'https://raw.githubusercontent.com/p4inz-code/kanvaz/main/official-plugins/catalog.json';
/* v6.5.0 — same fixed-URL, read-only pattern as OFFICIAL_CATALOG_URL
   above, for the Template Maker & Manager official plugin's "browse
   community templates" feature. A template is just JSON (a card array,
   same shape KanvazCards.serialise() already produces), never a zip/
   executable, so there's no install-time extraction step to guard here
   the way plugins-install-from-catalog has to — the plugin itself
   fetches this catalog, then a template's own contentUrl, both through
   this one narrow main-process handler, never a raw renderer fetch(). */
var TEMPLATES_CATALOG_URL = 'https://raw.githubusercontent.com/p4inz-code/kanvaz/main/community-templates/catalog.json';
var MAX_CATALOG_BYTES = 256 * 1024;
var MAX_TEMPLATE_BYTES = 8 * 1024 * 1024;
var MAX_PLUGIN_ZIP_BYTES = 25 * 1024 * 1024;
/* Decompressed-output cap — see plugins-install-from-catalog's own
   comment for why MAX_PLUGIN_ZIP_BYTES (compressed) alone doesn't
   protect against a zip bomb. Generous relative to any real plugin
   (Kanvaz's own official plugins are a few hundred KB uncompressed). */
var MAX_PLUGIN_EXTRACTED_BYTES = 200 * 1024 * 1024;
/* Plural — see httpsGetBuffer()'s comment on why a redirect target
   (GitHub's own asset CDN) needs its own entry here too. */
var ALLOWED_DOWNLOAD_HOSTS = ['github.com', 'objects.githubusercontent.com', 'github-releases.githubusercontent.com'];

/* allowedHosts (array), when passed, is re-checked against EVERY hop,
   not just the initial URL — audit fix: the original version only
   validated entry.downloadUrl's host at the plugins-install-from-
   catalog call site, before ever calling this function; a redirect's
   Location header was followed unconditionally regardless of where it
   pointed. Currently benign (GitHub's own release-asset redirects stay
   on GitHub-operated infra) but the allowlist's actual guarantee was
   weaker than its stated purpose — an open redirect anywhere in the
   chain, or a future catalog format change, could otherwise silently
   send a "github.com-only" download somewhere else entirely. Plural
   because GitHub's own release-download flow redirects github.com ->
   objects.githubusercontent.com (a signed, time-limited S3 URL) — a
   single-host check would break real downloads, not just attacker-
   controlled ones. */
function httpsGetBuffer(urlStr, maxBytes, allowedHosts, redirectsLeft) {
  if (redirectsLeft === undefined) redirectsLeft = 3;
  if (allowedHosts) {
    var checkUrl;
    try { checkUrl = new nodeUrl.URL(urlStr); } catch (e) { return Promise.reject(new Error('invalid URL')); }
    if (checkUrl.protocol !== 'https:' || allowedHosts.indexOf(checkUrl.hostname) === -1) {
      return Promise.reject(new Error('refused: "' + checkUrl.hostname + '" is not an allowed host'));
    }
  }
  return new Promise(function(resolve, reject) {
    var req = https.get(urlStr, { headers: { 'User-Agent': 'Kanvaz' } }, function(res) {
      /* GitHub release assets are served via a redirect to a signed S3
         URL — a small, capped number of hops, never an open-ended chain. */
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        if (redirectsLeft <= 0) { reject(new Error('too many redirects')); return; }
        httpsGetBuffer(res.headers.location, maxBytes, allowedHosts, redirectsLeft - 1).then(resolve, reject);
        return;
      }
      if (res.statusCode !== 200) {
        res.resume();
        reject(new Error('HTTP ' + res.statusCode));
        return;
      }
      var chunks = [];
      var total = 0;
      var tooLarge = false;
      res.on('data', function(chunk) {
        if (tooLarge) return;
        total += chunk.length;
        if (total > maxBytes) {
          tooLarge = true;
          reject(new Error('response exceeded the ' + Math.round(maxBytes / 1024) + 'KB limit'));
          res.destroy();
          return;
        }
        chunks.push(chunk);
      });
      res.on('end', function() { if (!tooLarge) resolve(Buffer.concat(chunks)); });
      res.on('error', reject);
    });
    req.on('error', reject);
    req.setTimeout(15000, function() { req.destroy(new Error('request timed out')); });
  });
}

/* Returns a Promise that resolves once the OS handle is actually
   released, not just once .close() was called — audit fix: the
   original version nulled mcpBridgeServer and returned right away,
   fire-and-forget. That allowed mcp-bridge-stop's IPC handler to resolve (and
   the Settings toggle re-enable itself) before the underlying pipe/
   socket had actually finished closing; a fast Disable-then-Enable
   click could hit the still-closing handle and fail to (re)listen for
   no reason a user could understand. net.Server#close() accepts a
   callback fired once every connection is closed and the server has
   stopped listening — awaiting that removes the self-race entirely.
   window-all-closed/before-quit call this without awaiting the
   result, which is fine — the app is exiting either way. */
function stopMcpBridgeServer() {
  for (var id in mcpBridgePending) {
    clearTimeout(mcpBridgePending[id].timer);
    mcpBridgePending[id].reject(new Error('MCP Bridge stopped'));
  }
  mcpBridgePending = {};
  if (!mcpBridgeServer) return Promise.resolve();
  var server = mcpBridgeServer;
  mcpBridgeServer = null;
  return new Promise(function(resolve) {
    server.close(function() { resolve(); });
  });
}

/* ── URL card preview fetch (v5.0.0) ──
   The ONLY network call in Kanvaz that isn't a user-clicked "check for
   updates"/"browse plugins" action — but it's still explicit-per-use,
   not silent or background: it only fires when the user clicks a URL
   card's "Fetch preview" button, never on paste/type/load. Disclosed in
   SECURITY.md and the URL card's own tooltip. Kept in the main process
   (not a renderer fetch()) so it isn't subject to the target site's own
   CORS policy — most sites don't send CORS headers at all, which would
   silently break this for the majority of real URLs if done client-side. */
var MAX_URL_PREVIEW_HTML_BYTES  = 512 * 1024;
var MAX_URL_PREVIEW_IMAGE_BYTES = 2 * 1024 * 1024;

function fetchUrlBuffer(urlStr, maxBytes, redirectsLeft) {
  if (redirectsLeft === undefined) redirectsLeft = 3;
  var parsed;
  try { parsed = new nodeUrl.URL(urlStr); } catch (e) { return Promise.reject(new Error('invalid URL')); }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    return Promise.reject(new Error('only http/https URLs are supported'));
  }
  var mod = parsed.protocol === 'https:' ? https : http;
  return new Promise(function(resolve, reject) {
    var req = mod.get(urlStr, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Kanvaz/1.0)' } }, function(res) {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        if (redirectsLeft <= 0) { reject(new Error('too many redirects')); return; }
        var next;
        try { next = new nodeUrl.URL(res.headers.location, urlStr).toString(); }
        catch (e) { reject(new Error('invalid redirect target')); return; }
        fetchUrlBuffer(next, maxBytes, redirectsLeft - 1).then(resolve, reject);
        return;
      }
      if (res.statusCode !== 200) { res.resume(); reject(new Error('HTTP ' + res.statusCode)); return; }
      var chunks = [];
      var total = 0;
      var tooLarge = false;
      res.on('data', function(chunk) {
        if (tooLarge) return;
        total += chunk.length;
        if (total > maxBytes) {
          tooLarge = true;
          reject(new Error('response exceeded the ' + Math.round(maxBytes / 1024) + 'KB limit'));
          res.destroy();
          return;
        }
        chunks.push(chunk);
      });
      res.on('end', function() {
        if (!tooLarge) resolve({ buf: Buffer.concat(chunks), contentType: res.headers['content-type'] || '' });
      });
      res.on('error', reject);
    });
    req.on('error', reject);
    req.setTimeout(10000, function() { req.destroy(new Error('request timed out')); });
  });
}

/* Deliberately a couple of regexes, not a full HTML parser — this only
   ever reads two well-known meta tags plus <title>, and pulling in a DOM
   parser dependency for that would be a lot of surface area (and attack
   surface, parsing arbitrary third-party HTML) for very little gain. */
function extractUrlMeta(html) {
  function metaContent(prop) {
    var re1 = new RegExp('<meta[^>]+(?:property|name)=["\']' + prop + '["\'][^>]*content=["\']([^"\']*)["\']', 'i');
    var m = html.match(re1);
    if (m) return m[1];
    var re2 = new RegExp('<meta[^>]+content=["\']([^"\']*)["\'][^>]*(?:property|name)=["\']' + prop + '["\']', 'i');
    var m2 = html.match(re2);
    return m2 ? m2[1] : null;
  }
  var title = metaContent('og:title');
  if (!title) {
    var tm = html.match(/<title[^>]*>([^<]*)<\/title>/i);
    if (tm) title = tm[1].trim();
  }
  return { title: title || null, image: metaContent('og:image') };
}

/* ── argv / file-open helper (BUG 5) ── */

function findKanvazArg(argv) {
  for (var i = 0; i < argv.length; i++) {
    if (/\.kanvaz$/i.test(argv[i])) return argv[i];
  }
  return null;
}

/* ── Single-instance lock (BUG 4) ──
   Kanvaz reads/writes .kanvaz files and a shared recovery/settings dir —
   two instances racing against the same files can corrupt them. If this
   process loses the lock, another instance is already running: hand off
   (via 'second-instance' below, in that other process) and quit. */
var gotLock = app.requestSingleInstanceLock();

if (!gotLock) {
  app.quit();
} else {

  /* ── Startup ── */

  app.whenReady().then(function() {
    ensureDirectories();

    /* BUG 5: fresh launch with a .kanvaz file on the command line
       (double-click a file, or "Open with Kanvaz"). Computed BEFORE
       createWindow() so it can be handed to the renderer at window
       creation time (see createWindow's additionalArguments) instead
       of only after 'did-finish-load'. */
    var startupFile = pendingFileOpen || findKanvazArg(process.argv);
    createWindow(!!startupFile);
    registerIPC();

    if (startupFile && mainWindow) {
      mainWindow.webContents.once('did-finish-load', function() {
        mainWindow.webContents.send('open-file-from-argv', startupFile);
      });
    }

    /* Auto-updater — wires up event listeners only. Kanvaz makes no
       background network calls (see the About screen's privacy note),
       so this never checks on its own; it only fires when the user
       clicks "Check for updates", via the 'check-for-updates' IPC
       handler below. */
    if (app.isPackaged && autoUpdater) {
      wireAutoUpdaterEvents();
    }
  });

  app.on('window-all-closed', function() {
    stopMcpBridgeServer();
    if (process.platform !== 'darwin') app.quit();
  });

  /* Covers the darwin case above (window-all-closed doesn't quit there)
     and every other quit path (Cmd/Ctrl+Q, dock/taskbar quit, OS
     shutdown) — a stray open pipe/socket surviving the app itself would
     be a genuinely confusing state for the next launch to find. */
  app.on('before-quit', function() {
    stopMcpBridgeServer();
    if (smartSearchWorker) { smartSearchWorker.terminate(); smartSearchWorker = null; }
  });

  app.on('activate', function() {
    if (BrowserWindow.getAllWindows().length === 0) createWindow(false);
  });

  /* BUG 4: a second launch (e.g. double-clicking another .kanvaz file
     while Kanvaz is already open) fires this on the FIRST instance
     instead of opening a second window. Focus the existing window and
     open the file there if one was passed. */
  app.on('second-instance', function(event, argv) {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
    var filePath = findKanvazArg(argv);
    if (filePath) mainWindow.webContents.send('open-file-from-argv', filePath);
  });

  /* BUG 5: macOS file-open event — can fire before the window (or even
     app.whenReady) exists, so queue it via pendingFileOpen if so. */
  app.on('open-file', function(event, filePath) {
    event.preventDefault();
    if (mainWindow) {
      mainWindow.webContents.send('open-file-from-argv', filePath);
    } else {
      pendingFileOpen = filePath;
    }
  });

}

/* ── Window ── */

function createWindow(hasStartupFile) {
  /* Reset per new window. allowClose is only ever flipped to true right
     before a deliberate close (see 'force-close' below); without this
     reset, macOS can hit a stale `true` here — window-all-closed doesn't
     quit on darwin, and app.on('activate') can spawn a fresh window
     after the last one closes, which would then skip the unsaved-
     changes check on its own first close attempt. */
  allowClose = false;

  /* Redesign v1 Phase 2: the renderer's Start Screen must not appear at
     all when this launch is going straight to a specific .kanvaz file
     (double-click a file, "Open with Kanvaz") — passed as a launch-time
     flag rather than an IPC round-trip so the renderer can skip it
     synchronously at boot, before Boards.init() ever calls
     showStartupScreen(), avoiding a startup-screen flash underneath the
     board that's about to load. */
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 320,
    minHeight: 240,
    frame: false,
    transparent: false,
    backgroundColor: '#0E0E10',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      webSecurity: true,
      /* Chromium's native spellcheck (red squiggle + inline correction
         bubble) is unstyled OS chrome that doesn't match Kanvaz's own
         theme and can't be suppressed from the renderer side (it isn't
         gated by the DOM 'contextmenu' event at all). Off globally, same
         call already made per-field for rename inputs. */
      spellcheck: false,
      additionalArguments: ['--kanvaz-has-startup-file=' + (hasStartupFile ? '1' : '0')]
    },
    icon: path.join(__dirname, '..', 'assets', 'icons', 'icon.png'),
    title: 'Kanvaz'
  });

  mainWindow.loadFile(path.join(__dirname, 'index.html'));

  mainWindow.once('ready-to-show', function() {
    mainWindow.show();
  });

  mainWindow.on('closed', function() {
    mainWindow = null;
  });

  /* BUG 1 fix: intercept close — ask renderer whether there are unsaved
     changes before actually closing. The renderer responds via the
     'force-close' IPC message (see ipcMain.on('force-close', ...)) once
     it has decided (no unsaved changes, or user chose Save/Don't Save). */
  mainWindow.on('close', function(e) {
    if (allowClose) return;
    e.preventDefault();
    mainWindow.webContents.send('check-unsaved-before-close');
  });

  /* If the renderer actually crashes (not a caught JS exception — the
     whole render process dying: OOM, GPU driver fault, etc.) it can
     never send back 'force-close', so without this the window above
     would sit forever with its close already prevented, waiting for a
     reply that's never coming. There's nothing left to save at that
     point, so allow the close to proceed instead of hanging forever. */
  mainWindow.webContents.on('render-process-gone', function(event, details) {
    console.error('[Kanvaz] Renderer process gone:', details && details.reason);
    allowClose = true;
    if (mainWindow) mainWindow.close();
  });

  mainWindow.on('maximize', function() {
    if (mainWindow) mainWindow.webContents.send('window-maximized-changed', true);
  });

  mainWindow.on('unmaximize', function() {
    if (mainWindow) mainWindow.webContents.send('window-maximized-changed', false);
  });

  mainWindow.webContents.on('did-finish-load', function() {
    checkCrashRecovery();
  });

  /* SECURITY (added during the 4.2.0 plugin-system audit): Kanvaz is a
     single-page app — index.html never legitimately navigates itself,
     and nothing in the renderer ever legitimately opens a child window.
     Without these two guards, a malicious/compromised script running in
     the renderer (a plugin abusing the disclosed convention-based
     sandbox model, or any future DOM-injection bug) could navigate the
     whole window to an attacker page — e.g. reading a local file via
     KanvazBridge and exfiltrating it via location.href — completely
     bypassing the CSP's connect-src allowlist, since CSP governs
     fetch/XHR/WebSocket, not top-level navigation or window.open(). */
  mainWindow.webContents.on('will-navigate', function(event) {
    event.preventDefault();
  });

  mainWindow.webContents.setWindowOpenHandler(function() {
    return { action: 'deny' };
  });
}

/* ── Directories ── */

function ensureDirectories() {
  /* Also runs the profiles migration (idempotent) — this is the first
     thing whenReady() calls, before anything else touches a
     settings/recent/recovery path. */
  kanvazProfiles.ensureMigrated(app.getPath('userData'));
  var recoveryDir = getRecoveryDir();
  if (!fs.existsSync(recoveryDir)) {
    fs.mkdirSync(recoveryDir, { recursive: true });
  }
}

/* ── IPC: Window controls ── */

function registerIPC() {

  ipcMain.on('window-minimize', function() {
    if (mainWindow) mainWindow.minimize();
  });

  ipcMain.on('window-maximize', function() {
    if (!mainWindow) return;
    if (mainWindow.isMaximized()) {
      mainWindow.unmaximize();
    } else {
      mainWindow.maximize();
    }
  });

  ipcMain.on('window-close', function() {
    if (mainWindow) mainWindow.close();
  });

  /* BUG 1 fix: renderer calls this once it has decided closing is OK
     (no unsaved changes, or user chose Save/Don't Save in the dialog). */
  ipcMain.on('force-close', function() {
    allowClose = true;
    if (mainWindow) mainWindow.close();
  });

  ipcMain.handle('window-is-maximized', function() {
    return mainWindow ? mainWindow.isMaximized() : false;
  });

  ipcMain.on('window-set-always-on-top', function(event, flag) {
    if (mainWindow) mainWindow.setAlwaysOnTop(flag);
  });

  /* BUG 6 fix: renderer calls this after save/open with the display
     filename so the OS-level window title (taskbar, Alt-Tab preview)
     reflects the open file. The custom in-app titlebar already showed
     it via #titlebar-title — window.setTitle() itself was never
     called, so it stayed hardcoded to 'Kanvaz'. */
  ipcMain.on('set-window-title', function(event, title) {
    if (mainWindow) mainWindow.setTitle(title);
  });

  /* Tab+MMB whole-window drag — an alternative to dragging via the
     titlebar, useful when the Auto-hide toolbar setting has the chrome
     hidden. Plain middle-mouse-drag is already used for canvas panning,
     so this is deliberately gated behind holding Tab too (checked
     renderer-side) to avoid colliding with that. Moves the real OS
     window position, which a CSS app-region drag zone can't do from an
     arbitrary point on the canvas — only from a marked region. */
  ipcMain.on('window-drag-by', function(event, delta) {
    if (!mainWindow) return;
    var b = mainWindow.getBounds();
    mainWindow.setPosition(b.x + delta.dx, b.y + delta.dy);
  });

  /* The persistent Auto-hide toolbar setting removes all toolbar/
     titlebar chrome (formerly shared with the now-removed Top Mode —
     see v6.0.0's CHANGELOG entry), so the 320x240 unconditional floor
     no longer applies — relax it further to a real reference-viewing
     floor while it's active, and restore the standard floor immediately
     on exit. Channel name kept as -moodlock- internally rather than
     renamed, to avoid an unrelated cross-file rename churning this
     diff — it's an implementation detail, not user-facing. */
  ipcMain.on('window-set-moodlock-size', function(event, active) {
    if (!mainWindow) return;
    if (active) {
      mainWindow.setMinimumSize(220, 160);
    } else {
      mainWindow.setMinimumSize(320, 240);
      var b = mainWindow.getBounds();
      if (b.width < 320 || b.height < 240) {
        mainWindow.setBounds({
          x: b.x, y: b.y,
          width: Math.max(b.width, 320),
          height: Math.max(b.height, 240)
        });
      }
    }
  });

  /* ── IPC: File dialogs ── */

  ipcMain.handle('dialog-open-file', function() {
    var result = dialog.showOpenDialogSync(mainWindow, {
      title: 'Open Board',
      filters: [{ name: 'Kanvaz Board', extensions: ['kanvaz'] }],
      properties: ['openFile']
    });
    return result ? result[0] : null;
  });

  ipcMain.handle('dialog-save-file', function(event, defaultName) {
    var result = dialog.showSaveDialogSync(mainWindow, {
      title: 'Save Board',
      defaultPath: defaultName || 'untitled.kanvaz',
      filters: [{ name: 'Kanvaz Board', extensions: ['kanvaz'] }]
    });
    if (!result) return null;
    /* BUG fix: Windows' native save dialog only auto-appends the filter
       extension when the typed filename has NO dot at all. Any board name
       containing a dot (dates, versions like "Ref v1.2", "Board 4.10")
       makes Windows treat the text after the last dot as the extension the
       user "chose", and it saves the file with no .kanvaz extension at
       all. That silently breaks two things later: the file gets no
       registered icon (looks like a plain/unknown file), and it becomes
       invisible in the Open dialog, which filters strictly to *.kanvaz.
       Force the extension unconditionally so this can never happen. */
    if (!/\.kanvaz$/i.test(result)) {
      result += '.kanvaz';
    }
    return result;
  });

  /* Phase 2 "Relink" — pick a replacement file for a card whose media
     is missing (moved/deleted source file). Reuses the same media-load
     pipeline as drag-drop/open, just entered from a file picker instead
     of a drop event. */
  ipcMain.handle('dialog-open-media', function() {
    var result = dialog.showOpenDialogSync(mainWindow, {
      title: 'Relink Media',
      filters: [
        { name: 'All Supported Media', extensions: ['jpg','jpeg','png','gif','bmp','webp','mp4','webm','mov','mkv','avi','mp3','wav','ogg','m4a','glb','gltf','obj','fbx'] },
        { name: 'Images', extensions: ['jpg','jpeg','png','gif','bmp','webp'] },
        { name: 'Video', extensions: ['mp4','webm','mov','mkv','avi'] },
        { name: 'Audio', extensions: ['mp3','wav','ogg','m4a'] },
        { name: '3D Models', extensions: ['glb','gltf','obj','fbx'] }
      ],
      properties: ['openFile']
    });
    return result ? result[0] : null;
  });

  /* Bug fix: the toolbar's "Import" button (next to New/Open/Save) was
     wired to the PureRef-only .pur importer — a real, named feature
     that deserves its own toolbar button per the comment on the
     'dialog-open-pur' handler below, but not what "Import" reads as to
     someone who hasn't discovered that specific tooltip yet, and not
     what the button icon (a generic tray-and-arrow) suggests. Direct
     feedback: "the import button is made for all kinds of import
     regardless of format... via import button everything which is
     supported in kanvaz will be imported." Same filter set as Relink
     Media above, just multi-select and a different dialog title —
     .pur import keeps its own dedicated entry point (this toolbar
     button no longer touches it; the canvas right-click menu's
     "Import .pur file" item is unaffected). */
  ipcMain.handle('dialog-import-media', function() {
    var result = dialog.showOpenDialogSync(mainWindow, {
      title: 'Import Files',
      filters: [
        { name: 'All Supported Media', extensions: ['jpg','jpeg','png','gif','bmp','webp','mp4','webm','mov','mkv','avi','mp3','wav','ogg','m4a','glb','gltf','obj','fbx'] },
        { name: 'Images', extensions: ['jpg','jpeg','png','gif','bmp','webp'] },
        { name: 'Video', extensions: ['mp4','webm','mov','mkv','avi'] },
        { name: 'Audio', extensions: ['mp3','wav','ogg','m4a'] },
        { name: '3D Models', extensions: ['glb','gltf','obj','fbx'] }
      ],
      properties: ['openFile', 'multiSelections']
    });
    return result || [];
  });

  /* File Reference card — picks any file on disk to link to (not
     embedded, unlike media cards). PDF reference cards reuse the same
     dialog with a .pdf filter. */
  ipcMain.handle('dialog-open-ref-file', function(event, ext) {
    var filters = ext
      ? [{ name: ext.toUpperCase() + ' files', extensions: [ext] }]
      : [{ name: 'All Files', extensions: ['*'] }];
    var result = dialog.showOpenDialogSync(mainWindow, {
      title: 'Choose a file to reference',
      filters: filters,
      properties: ['openFile']
    });
    return result ? result[0] : null;
  });

  /* Open a referenced File/PDF card's linked path in the OS default
     app — same idea as double-clicking it in Explorer.

     Security note: unlike the dialog above, the path passed here can
     come from a .kanvaz file's saved data — including one someone
     else shared — not just a file the user picked in this session. A
     board is just JSON, so a card's "path" field could in principle
     be crafted to point at a local executable/script, and openPath()
     runs a file with its OS-registered default handler, which for an
     .exe/.bat/etc IS "run it". Block the extensions that would launch
     rather than open something to look at/read — every legitimate
     reference use (docs, source files, PDFs, project files) is
     unaffected, only the actually dangerous case is closed off. */
  var UNSAFE_OPEN_EXTENSIONS = ['exe','bat','cmd','com','scr','ps1','vbs','vbe','js','jse','wsf','wsh','msi','msp','jar','sh','app','apk','lnk','reg'];
  ipcMain.handle('shell-open-path', function(event, filePath) {
    if (typeof filePath !== 'string' || !filePath) return 'Invalid path';
    var ext = path.extname(filePath).toLowerCase().replace('.', '');
    if (UNSAFE_OPEN_EXTENSIONS.indexOf(ext) !== -1) {
      return 'Kanvaz won\'t open ' + ext.toUpperCase() + ' files directly for safety — open it from Explorer if you trust the source.';
    }
    return shell.openPath(filePath);
  });

  /* Reveal a file-ref card's linked path in the OS file manager with the
     item pre-selected — no extension gate needed, unlike shell-open-
     path above: this only ever opens Explorer/Finder itself, never the
     file's own default handler, so there's no "runs a script" risk to
     block regardless of what a shared board's saved path points at. */
  ipcMain.handle('shell-reveal-in-folder', function(event, filePath) {
    if (typeof filePath !== 'string' || !filePath) return false;
    shell.showItemInFolder(filePath);
    return true;
  });

  /* ── IPC: File read/write ── */

  ipcMain.handle('file-read', function(event, filePath) {
    return fs.promises.readFile(filePath)
      .then(function(buf) {
        if (boardContainer.looksLikeZip(buf)) return boardContainer.unpackBoard(buf);
        return buf.toString('utf8'); /* pre-4.1.0 plain-JSON file */
      })
      .then(function(jsonStr) { return { ok: true, data: jsonStr }; })
      .catch(function(e) { return { ok: false, error: e.message }; });
  });

  ipcMain.handle('file-write', function(event, filePath, data) {
    var tmpPath = filePath + '.tmp';
    return boardContainer.packBoard(data)
      .then(function(zipBuf) { return fs.promises.writeFile(tmpPath, zipBuf); })
      .then(function() {
        return fs.promises.rename(tmpPath, filePath);
      })
      .then(function() { return { ok: true }; })
      .catch(function(e) {
        /* Clean up .tmp if rename failed */
        try { fs.unlinkSync(tmpPath); } catch (_) {}
        return { ok: false, error: e.message };
      });
  });

  /* ── IPC: Media loading ── */

  ipcMain.handle('media-load', function(event, filePath) {
    return fs.promises.stat(filePath).then(function(stats) {
      var sizeMB = stats.size / (1024 * 1024);

      /* Hard block over 500MB — do not read the file */
      if (sizeMB > MAX_FILE_SIZE_MB) {
        return { ok: false, error: 'FILE_TOO_LARGE', sizeMB: sizeMB };
      }

      var ext = path.extname(filePath).toLowerCase().replace('.', '');
      var allowed = ['jpg','jpeg','png','gif','bmp','webp','mp4','webm','mov','mkv','avi','mp3','wav','ogg','m4a'];
      if (allowed.indexOf(ext) === -1) {
        return { ok: false, error: 'FILE_TYPE_INVALID', ext: ext };
      }

      return fs.promises.readFile(filePath).then(function(data) {
        var b64 = data.toString('base64');
        var mimeMap = {
          jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png',
          gif: 'image/gif', bmp: 'image/bmp', webp: 'image/webp',
          mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime',
          mkv: 'video/x-matroska', avi: 'video/x-msvideo',
          mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', m4a: 'audio/mp4'
        };
        return {
          ok: true,
          dataUrl: 'data:' + mimeMap[ext] + ';base64,' + b64,
          ext: ext,
          sizeMB: sizeMB,
          large: sizeMB > LARGE_FILE_WARN_MB,
          name: path.basename(filePath),
          originalPath: filePath
        };
      });
    }).catch(function(e) {
      return { ok: false, error: e.message };
    });
  });

  /* v7.x — reads a PDF's raw bytes for the file-reference card's live
     in-card preview (scroll/zoom via pdfjs-dist, vendored in
     src/vendor/pdfjs/ — see PLUGIN... no, this isn't a plugin, see
     THIRD_PARTY_NOTICES.md for the Apache-2.0 attribution). Deliberately
     NOT the same path media-load() above uses: that one returns a data
     URL meant to be EMBEDDED into the card and the save file forever —
     a file-reference card's whole point is pointing at a file WITHOUT
     embedding it, so this re-reads from disk on demand every time a PDF
     card needs to render, never persists what it read, and returns raw
     base64 (no data: URL wrapper — pdf.js wants raw bytes, not a data
     URI) so there's no chance of it accidentally ending up in a save
     file via a copy-paste of media-load's own return shape. Same size
     cap as media-load for the same reason: a full-file synchronous(ish)
     read into a string across a Node<->Chromium IPC boundary needs a
     hard limit to stay safe. */
  ipcMain.handle('pdf-read-bytes', function(event, filePath) {
    return fs.promises.stat(filePath).then(function(stats) {
      var sizeMB = stats.size / (1024 * 1024);
      if (sizeMB > MAX_FILE_SIZE_MB) {
        return { ok: false, error: 'FILE_TOO_LARGE', sizeMB: sizeMB };
      }
      if (path.extname(filePath).toLowerCase() !== '.pdf') {
        return { ok: false, error: 'not a .pdf file' };
      }
      return fs.promises.readFile(filePath).then(function(data) {
        return { ok: true, base64: data.toString('base64'), sizeMB: sizeMB };
      });
    }).catch(function(e) {
      return { ok: false, error: e.message };
    });
  });

  /* ── IPC: Recent files ── */

  /* v7.x — 3D model loading. Follows media-load's EMBED pattern (a
     model3d card is self-contained like image/video/audio, not a
     file-reference), but kept as its own handler with its own size cap
     and extension allowlist rather than folding into media-load — same
     reasoning as pdf-read-bytes being kept separate above: a distinct
     card type with distinct constraints deserves a distinct, easy-to-audit
     entry point instead of one handler accreting special cases. */
  ipcMain.handle('model-load', function(event, filePath) {
    return fs.promises.stat(filePath).then(function(stats) {
      var sizeMB = stats.size / (1024 * 1024);

      if (sizeMB > MAX_MODEL_SIZE_MB) {
        return { ok: false, error: 'FILE_TOO_LARGE', sizeMB: sizeMB };
      }

      var ext = path.extname(filePath).toLowerCase().replace('.', '');
      var allowed = ['glb', 'gltf', 'obj', 'fbx'];
      if (allowed.indexOf(ext) === -1) {
        return { ok: false, error: 'FILE_TYPE_INVALID', ext: ext };
      }

      return fs.promises.readFile(filePath).then(function(data) {
        var b64 = data.toString('base64');
        var mimeMap = {
          glb: 'model/gltf-binary', gltf: 'model/gltf+json',
          obj: 'text/plain', fbx: 'application/octet-stream'
        };
        return {
          ok: true,
          dataUrl: 'data:' + mimeMap[ext] + ';base64,' + b64,
          modelFormat: ext,
          sizeMB: sizeMB,
          name: path.basename(filePath),
          originalPath: filePath
        };
      });
    }).catch(function(e) {
      return { ok: false, error: e.message };
    });
  });

  /* recent.json on disk stays a plain array of path strings (the
     format recent-add/recent-remove below already read and write,
     and the one existing installs' saved files are already in) — no
     migration needed. This handler is the only place that enriches
     it with a real mtime for the Home Screen's "Edited X ago" text,
     computed fresh per call rather than stored, and it's also the one
     natural place to quietly drop entries whose file no longer exists
     (moved/deleted since it was added) instead of leaving a stale
     path that would fail when clicked. */
  ipcMain.handle('recent-get', function() {
    var p = getRecentFilesPath();
    var thumbs = {};
    try {
      var tp = getThumbnailsPath();
      if (fs.existsSync(tp)) thumbs = JSON.parse(fs.readFileSync(tp, 'utf8')) || {};
    } catch (e) { /* thumbnails.json missing/corrupt — tiles just fall back to the gradient banner */ }
    try {
      if (!fs.existsSync(p)) return [];
      var paths = JSON.parse(fs.readFileSync(p, 'utf8'));
      var out = [];
      for (var i = 0; i < paths.length; i++) {
        try {
          var stat = fs.statSync(paths[i]);
          out.push({ path: paths[i], mtimeMs: stat.mtimeMs, thumbnailDataUrl: thumbs[paths[i]] || null });
        } catch (e) { /* file moved/deleted since it was added — drop it */ }
      }
      return out;
    } catch (e) {
      return [];
    }
  });

  /* Called right after a successful board save (boards.js's
     writeSerialisedBoardTo) with a JPEG dataUrl already rendered in the
     renderer (KanvazCards.generateThumbnail()) — this handler only
     persists it. Capped at MAX_THUMBNAILS entries, oldest (by insertion
     order) dropped first, so this file can't grow without bound across
     a long-running profile that's saved hundreds of different boards. */
  ipcMain.handle('board-thumbnail-save', function(event, filePath, dataUrl) {
    if (!filePath || !dataUrl) return { ok: false };
    var tp = getThumbnailsPath();
    var map = {};
    try {
      if (fs.existsSync(tp)) map = JSON.parse(fs.readFileSync(tp, 'utf8')) || {};
    } catch (e) { map = {}; }
    delete map[filePath];
    map[filePath] = dataUrl;
    var keys = Object.keys(map);
    if (keys.length > MAX_THUMBNAILS) {
      var toDrop = keys.slice(0, keys.length - MAX_THUMBNAILS);
      for (var i = 0; i < toDrop.length; i++) delete map[toDrop[i]];
    }
    try {
      fs.writeFileSync(tp, JSON.stringify(map), 'utf8');
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  ipcMain.handle('recent-add', function(event, filePath) {
    var p = getRecentFilesPath();
    try {
      var list = [];
      if (fs.existsSync(p)) {
        list = JSON.parse(fs.readFileSync(p, 'utf8'));
      }
      list = list.filter(function(f) { return f !== filePath; });
      list.unshift(filePath);
      if (list.length > MAX_RECENT) list = list.slice(0, MAX_RECENT);
      fs.writeFileSync(p, JSON.stringify(list), 'utf8');
      return list;
    } catch (e) {
      return [];
    }
  });

  ipcMain.handle('recent-remove', function(event, filePath) {
    var p = getRecentFilesPath();
    try {
      var list = [];
      if (fs.existsSync(p)) {
        list = JSON.parse(fs.readFileSync(p, 'utf8'));
      }
      list = list.filter(function(f) { return f !== filePath; });
      fs.writeFileSync(p, JSON.stringify(list), 'utf8');
      return list;
    } catch (e) {
      return [];
    }
  });

  /* ── IPC: Recovery ── */

  ipcMain.handle('recovery-write', function(event, data) {
    var recoveryDir = getRecoveryDir();
    /* Redesign v1 Phase 2: a just-created or just-switched-to profile
       may not have a recovery/ subfolder yet — getActiveProfileDir()
       only guarantees the profile's own root dir exists, not this
       subfolder, so ensure it here rather than assuming boot-time
       ensureDirectories() already covered whichever profile is active
       right now. */
    if (!fs.existsSync(recoveryDir)) fs.mkdirSync(recoveryDir, { recursive: true });
    var recovPath = path.join(recoveryDir, 'autosave.kanvaz.tmp');
    return fs.promises.writeFile(recovPath, data, 'utf8')
      .then(function() { return { ok: true }; })
      .catch(function(e) { return { ok: false, error: e.message }; });
  });

  ipcMain.handle('recovery-read', function() {
    try {
      var recovPath = path.join(getRecoveryDir(), 'autosave.kanvaz.tmp');
      if (!fs.existsSync(recovPath)) return { ok: false };
      var data = fs.readFileSync(recovPath, 'utf8');
      return { ok: true, data: data };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  ipcMain.handle('recovery-clear', function() {
    try {
      var recovPath = path.join(getRecoveryDir(), 'autosave.kanvaz.tmp');
      if (fs.existsSync(recovPath)) fs.unlinkSync(recovPath);
      return { ok: true };
    } catch (e) {
      return { ok: false };
    }
  });

  /* ── IPC: Shell ── */

  ipcMain.on('shell-open-external', function(event, url) {
    if (typeof url === 'string' && (url.startsWith('https://') || url.startsWith('http://'))) {
      shell.openExternal(url);
    }
  });

  /* ── IPC: Dropped-folder expansion (4.8.0) ──
     e.dataTransfer.files gives the renderer a File object for whatever
     was dropped, folder included — but a folder's "File" is just an
     opaque zero-byte entry, not its contents. The renderer has no
     filesystem access at all (contextIsolation:true, no nodeIntegration
     — see this file's own header), so resolving "is this a folder, and
     if so what's in it" has to happen here. Same media extensions
     media.js's own IMAGE_EXTS/GIF_EXTS/VIDEO_EXTS/AUDIO_EXTS accept —
     duplicated rather than required cross-module since media.js is a
     classic-script renderer file, not something this main-process
     module can require(). Non-recursive on purpose: "a folder of loose
     images," not an arbitrary directory tree walk. */
  var DROP_MEDIA_EXTS = ['jpg', 'jpeg', 'png', 'bmp', 'webp', 'gif', 'mp4', 'webm', 'mov', 'mkv', 'avi', 'mp3', 'wav', 'ogg', 'm4a', 'glb', 'gltf', 'obj', 'fbx'];

  /* Bug-bounty fix (v5.3.0): this used to be a synchronous statSync/
     readdirSync loop — one blocking syscall per top-level path, plus one
     more per file inside every dropped folder, all on Electron's MAIN
     process thread (which also owns the native window's message pump,
     same class of bug the v4.6.0 .pur-import hang was). Dropping a large
     folder (thousands of files) or a folder on a slow/network drive
     froze the entire app — every window, all IPC, the menu, the auto-
     updater — for the duration. Switched to fs.promises with each
     folder's entries stat'd in parallel via Promise.all, same as the
     rest of this file's async IPC handlers; error handling is unchanged
     per-entry (an unreadable path is skipped, never fails the whole drop). */
  ipcMain.handle('resolve-dropped-paths', function(event, paths) {
    return Promise.all(paths.map(function(p) {
      return fs.promises.stat(p).then(function(stat) {
        if (stat.isDirectory()) {
          return fs.promises.readdir(p).then(function(entries) {
            return Promise.all(entries.map(function(name) {
              var full = path.join(p, name);
              return fs.promises.stat(full).then(function(s) {
                if (!s.isFile()) return null;
                var ext = name.split('.').pop().toLowerCase();
                return DROP_MEDIA_EXTS.indexOf(ext) !== -1 ? full : null;
              }).catch(function() { return null; /* unreadable entry — skip it */ });
            }));
          }).catch(function() { return []; /* unreadable folder — skip it */ });
        } else if (stat.isFile()) {
          return [p];
        }
        return [];
      }).catch(function() { return []; /* path vanished or is unreadable — skip it */ });
    })).then(function(results) {
      var out = [];
      for (var i = 0; i < results.length; i++) {
        for (var j = 0; j < results[i].length; j++) {
          if (results[i][j]) out.push(results[i][j]);
        }
      }
      return out;
    });
  });

  /* ── IPC: Settings ── */

  ipcMain.handle('settings-read', function() {
    try {
      var settingsPath = path.join(kanvazProfiles.getActiveProfileDir(app.getPath('userData')), 'settings.json');
      if (!fs.existsSync(settingsPath)) return { ok: true, data: null };
      var raw = fs.readFileSync(settingsPath, 'utf8');
      return { ok: true, data: raw };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  ipcMain.handle('settings-write', function(event, data) {
    var settingsPath = path.join(kanvazProfiles.getActiveProfileDir(app.getPath('userData')), 'settings.json');
    var tmpPath = settingsPath + '.tmp';
    return fs.promises.writeFile(tmpPath, data, 'utf8')
      .then(function() {
        return fs.promises.rename(tmpPath, settingsPath);
      })
      .then(function() { return { ok: true }; })
      .catch(function(e) {
        try { fs.unlinkSync(tmpPath); } catch (_) {}
        return { ok: false, error: e.message };
      });
  });

  ipcMain.handle('first-run-check', function() {
    try {
      var flagPath = path.join(app.getPath('userData'), 'first-run-done');
      var done = fs.existsSync(flagPath);
      if (!done) fs.writeFileSync(flagPath, '1', 'utf8');
      return { done: done };
    } catch (e) {
      return { done: false };
    }
  });

  /* ── IPC: Profiles (Redesign v1 Phase 2, docs/PROFILES_SYSTEM_PLAN.md) ──
     Each handler is a thin wrapper over profiles.js — see that module
     for the actual storage/migration logic. Switching profiles doesn't
     hot-swap any in-memory state here or in the renderer (settings
     caches, board state, etc.) — the renderer relaunches the whole app
     via the existing 'app-relaunch' IPC right after a successful
     switch, same as the plan's "treat it as ending this user session"
     decision, not a new mechanism. */
  ipcMain.handle('profiles-list', function() {
    return kanvazProfiles.listProfiles(app.getPath('userData'));
  });

  ipcMain.handle('profiles-get-active', function() {
    return kanvazProfiles.getActiveProfile(app.getPath('userData'));
  });

  ipcMain.handle('profiles-create', function(event, name, opts) {
    return kanvazProfiles.createProfile(app.getPath('userData'), name, opts);
  });

  ipcMain.handle('profiles-switch', function(event, id) {
    return kanvazProfiles.switchProfile(app.getPath('userData'), id);
  });

  ipcMain.handle('profiles-rename', function(event, id, name) {
    return kanvazProfiles.renameProfile(app.getPath('userData'), id, name);
  });

  ipcMain.handle('profiles-update', function(event, id, fields) {
    return kanvazProfiles.updateProfileMeta(app.getPath('userData'), id, fields);
  });

  ipcMain.handle('profiles-set-avatar', function(event, id, dataUrl) {
    return kanvazProfiles.setProfileAvatar(app.getPath('userData'), id, dataUrl);
  });

  ipcMain.handle('profiles-delete', function(event, id) {
    return kanvazProfiles.deleteProfile(app.getPath('userData'), id);
  });

  /* Export/Import a profile as a portable .kanvazprofile file — the
     offline answer to "sync" (docs/PROFILES_SYSTEM_PLAN.md). A profile
     folder holds only small JSON/text files (settings, recent list,
     recovery snapshot, optional Smart Search index) — never a real
     .kanvaz board, so there's no risk of accidentally bundling someone's
     large media library into this file. Recursively zips every file
     under the profile's own directory, plus a synthesized profile.json
     carrying the manifest-level fields (name/description/avatarDataUrl/
     guest) that live in the SHARED profiles/manifest.json, not inside
     the profile's own folder — without it, an imported profile would
     have no name or avatar at all. */
  function addDirToZip(zip, dir, prefix) {
    var entries = fs.readdirSync(dir, { withFileTypes: true });
    for (var i = 0; i < entries.length; i++) {
      var entry = entries[i];
      var full = path.join(dir, entry.name);
      var zipPath = prefix ? prefix + '/' + entry.name : entry.name;
      if (entry.isDirectory()) {
        addDirToZip(zip, full, zipPath);
      } else {
        zip.file(zipPath, fs.readFileSync(full));
      }
    }
  }

  ipcMain.handle('profiles-export', function(event, id) {
    var userData = app.getPath('userData');
    var list = kanvazProfiles.listProfiles(userData);
    var entry = list.filter(function(p) { return p.id === id; })[0];
    if (!entry) return Promise.resolve({ ok: false, error: 'no profile with that id' });

    var profileDir = kanvazProfiles.getProfileDirById(userData, id);
    if (!fs.existsSync(profileDir)) return Promise.resolve({ ok: false, error: 'profile folder not found on disk' });

    var savePath = dialog.showSaveDialogSync(mainWindow, {
      title: 'Export Profile',
      defaultPath: (entry.name || 'profile').replace(/[\\/:*?"<>|]/g, '_') + '.kanvazprofile',
      filters: [{ name: 'Kanvaz Profile', extensions: ['kanvazprofile'] }]
    });
    if (!savePath) return Promise.resolve({ ok: false, error: null, cancelled: true });

    var zip = new JSZip();
    try {
      addDirToZip(zip, profileDir, '');
      zip.file('profile.json', JSON.stringify({
        name: entry.name, description: entry.description || '',
        avatarDataUrl: entry.avatarDataUrl || null, guest: !!entry.guest
      }));
    } catch (e) {
      return Promise.resolve({ ok: false, error: e.message });
    }

    return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }).then(function(buf) {
      return fs.promises.writeFile(savePath, buf);
    }).then(function() {
      return { ok: true, path: savePath };
    }).catch(function(e) {
      return { ok: false, error: e.message };
    });
  });

  ipcMain.handle('profiles-import', function() {
    var openPath = dialog.showOpenDialogSync(mainWindow, {
      title: 'Import Profile',
      filters: [{ name: 'Kanvaz Profile', extensions: ['kanvazprofile'] }],
      properties: ['openFile']
    });
    if (!openPath || !openPath[0]) return Promise.resolve({ ok: false, error: null, cancelled: true });

    var userData = app.getPath('userData');
    return fs.promises.readFile(openPath[0]).then(function(buf) {
      if (buf.length > MAX_PLUGIN_EXTRACTED_BYTES) {
        throw new Error('file is too large to be a valid profile export');
      }
      return JSZip.loadAsync(buf);
    }).then(function(zip) {
      var names = Object.keys(zip.files);

      /* Same zip-bomb defense pattern as plugins-install-from-catalog:
         reject upfront on declared size, then track actual decompressed
         bytes as they resolve. */
      var declaredTotal = 0;
      for (var d = 0; d < names.length; d++) {
        var f = zip.files[names[d]];
        if (!f.dir) declaredTotal += (f._data && f._data.uncompressedSize) || 0;
      }
      if (declaredTotal > MAX_PLUGIN_EXTRACTED_BYTES) {
        throw new Error('profile archive declares ' + Math.round(declaredTotal / (1024 * 1024)) + 'MB uncompressed — too large to be a real profile export');
      }

      return zip.file('profile.json').async('string').then(function(metaRaw) {
        return JSON.parse(metaRaw);
      }).catch(function() {
        return {}; /* missing/corrupt profile.json — import proceeds with default naming rather than failing outright */
      }).then(function(meta) {
        var newEntry = kanvazProfiles.createImportedProfileEntry(userData, meta);
        var targetDir = kanvazProfiles.getProfileDirById(userData, newEntry.id);
        var resolvedTargetDir = path.resolve(targetDir) + path.sep;

        var writtenTotal = 0;
        var writes = [];
        for (var i = 0; i < names.length; i++) {
          (function(relPath) {
            if (relPath === 'profile.json') return; /* metadata only, not a real profile file */
            var file = zip.files[relPath];
            if (file.dir) return;
            var destPath = path.resolve(path.join(targetDir, relPath));
            if (destPath.indexOf(resolvedTargetDir) !== 0) return; /* zip-slip guard — skip, don't abort the whole import */
            writes.push(file.async('nodebuffer').then(function(data) {
              writtenTotal += data.length;
              if (writtenTotal > MAX_PLUGIN_EXTRACTED_BYTES) {
                throw new Error('profile archive exceeded the decompressed size limit');
              }
              fs.mkdirSync(path.dirname(destPath), { recursive: true });
              fs.writeFileSync(destPath, data);
            }));
          })(names[i]);
        }
        return Promise.all(writes).then(function() {
          return { ok: true, id: newEntry.id, name: newEntry.name };
        }).catch(function(e) {
          /* Clean up the partially-written profile folder AND its
             manifest entry — never leave a half-imported profile
             sitting around that looks real but is missing files. */
          try { fs.rmSync(targetDir, { recursive: true, force: true }); } catch (cleanupErr) {}
          kanvazProfiles.deleteProfile(userData, newEntry.id);
          throw e;
        });
      });
    }).catch(function(e) {
      return { ok: false, error: e.message };
    });
  });

  /* Clean reset — clears the ACTIVE PROFILE's settings, recent-files
     list, and recovery/autosave cache, plus the machine-wide first-run
     flag. Deliberately touches ONLY paths under app.getPath('userData')
     — every one of them is a Kanvaz-internal cache/preference file,
     never a saved .kanvaz board. Boards always live wherever the user
     chose via the save dialog, a location entirely outside userData by
     construction — there is no path in this function that could ever
     reach one, so no exclusion list is needed; the safety comes from
     what's simply never touched here, not from filtering. Redesign v1
     Phase 2: this resets the CURRENT profile's own preferences, same as
     it always reset "the app's" preferences before profiles existed —
     it does not touch the profile manifest or any other profile. */
  ipcMain.handle('reset-app-data', function(event, clearCaches) {
    try {
      var userDataDir = app.getPath('userData');
      var settingsPath = path.join(kanvazProfiles.getActiveProfileDir(userDataDir), 'settings.json');
      var flagPath = path.join(userDataDir, 'first-run-done');

      if (fs.existsSync(settingsPath)) fs.unlinkSync(settingsPath);
      if (fs.existsSync(getRecentFilesPath())) fs.unlinkSync(getRecentFilesPath());
      if (fs.existsSync(flagPath)) fs.unlinkSync(flagPath);

      var recoveryDir = getRecoveryDir();
      if (fs.existsSync(recoveryDir)) {
        var files = fs.readdirSync(recoveryDir);
        for (var i = 0; i < files.length; i++) {
          /* recoveryDir is only ever expected to hold flat recovery
             files, but fs.unlinkSync throws EISDIR on a directory —
             which would abort this whole reset (caught by the outer
             try/catch, reported as a failure) over one unexpected
             subdirectory. rmSync with recursive+force handles either
             case without throwing, same as the cache-clearing block
             just below. */
          fs.rmSync(path.join(recoveryDir, files[i]), { recursive: true, force: true });
        }
      }

      /* App reset v2 — opt-in via the "Reset & Clear Caches" button.
         Wipes Electron/Chromium's own HTTP cache, GPU shader cache,
         and DOM local storage under userData. Not part of the default
         reset since it makes the next launch slower to warm back up
         (fresh GPU shader compiles) — only worth it when something
         looks visually broken and a normal reset didn't fix it. */
      if (clearCaches) {
        var cacheDirs = ['Cache', 'Code Cache', 'GPUCache', 'DawnCache', 'Local Storage'];
        for (var c = 0; c < cacheDirs.length; c++) {
          var dir = path.join(userDataDir, cacheDirs[c]);
          if (fs.existsSync(dir)) {
            fs.rmSync(dir, { recursive: true, force: true });
          }
        }
      }

      return { ok: true };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  ipcMain.on('app-relaunch', function() {
    app.relaunch();
    app.exit(0);
  });

  /* ── IPC: Auto-updater ── */

  ipcMain.on('check-for-updates', function() {
    if (autoUpdater && app.isPackaged) autoUpdater.checkForUpdates();
  });

  /* Audit fix: autoDownload used to be true, so a newer version started
     downloading the instant it was found — no choice, no confirmation.
     Now autoDownload is false (see wireAutoUpdaterEvents below) and this
     is what the renderer's "Download automatically" button calls once
     the user has actually said yes. */
  ipcMain.on('download-update', function() {
    if (autoUpdater && app.isPackaged) autoUpdater.downloadUpdate();
  });

  ipcMain.on('install-update', function() {
    if (autoUpdater) autoUpdater.quitAndInstall();
  });

  /* ── IPC: PureRef import ── */

  ipcMain.handle('dialog-open-pur', function() {
    var result = dialog.showOpenDialogSync(mainWindow, {
      title: 'Import PureRef File',
      filters: [{ name: 'PureRef Board', extensions: ['pur'] }],
      properties: ['openFile']
    });
    return result ? result[0] : null;
  });

  /* Audit fix: parsePurFile() used to run directly, synchronously, right
     here — on the main process, which also owns the native window's
     message pump. Any nontrivial .pur file (real PureRef boards routinely
     embed hundreds of images) blocked the ENTIRE app, not just this
     import, showing as "(Not Responding)". Runs in a worker_thread now —
     pur-import.js is pure Buffer/CPU work with zero Electron dependencies,
     so it needs no other IPC access from inside the worker. A 30s timeout
     is a backstop against a worker itself hanging on some edge case the
     parser's own internal caps don't catch; terminate() either way so the
     worker doesn't linger. */
  ipcMain.handle('pur-import', function(event, filePath) {
    return fs.promises.readFile(filePath).then(function(buffer) {
      return new Promise(function(resolve) {
        var worker = new Worker(path.join(__dirname, 'pur-import-worker.js'));
        var settled = false;
        var timeout = setTimeout(function() {
          if (settled) return;
          settled = true;
          worker.terminate();
          resolve({ ok: false, error: 'Import timed out — this .pur file may be too large or use an unsupported format variant' });
        }, 30000);

        worker.once('message', function(result) {
          if (settled) return;
          settled = true;
          clearTimeout(timeout);
          worker.terminate();
          resolve(result);
        });
        worker.once('error', function(e) {
          if (settled) return;
          settled = true;
          clearTimeout(timeout);
          worker.terminate();
          resolve({ ok: false, error: e.message });
        });

        worker.postMessage(buffer);
      });
    }).catch(function(e) {
      return { ok: false, error: e.message };
    });
  });

  /* ── Smart Search (v6.3.0) ──
     A long-lived worker, unlike pur-import's one-shot-per-call worker
     above — loading wink-nlp's ~4MB language model is real, one-time
     work not worth repeating on every keystroke. Spawned ONLY when the
     user turns Smart Search on (smart-search-set-enabled) and killed the
     instant it's off, so nothing NLP-related sits resident in memory
     for anyone who hasn't opted in — the point of the feature's own off
     switch, not just a cosmetic toggle in Settings. (The three vars this
     reads/writes are declared at module scope up top, not here — see
     the comment there for why.) */
  /* Bug-bounty fixes (found by this feature's own review pass, before
     ever shipping): resolves every still-pending call with a failure —
     used by BOTH the crash path and the disable path below, which used
     to only exist on the crash path. Disabling Smart Search while an
     index/query call was still in flight used to reassign
     smartSearchPending to a fresh object without settling what was in
     the old one first, permanently hanging that caller's promise —
     the exact bug the crash handler already knew to avoid, just not
     carried through to this second path that needed the same fix. */
  function settleAllSmartSearchPending(failure) {
    for (var id in smartSearchPending) {
      clearTimeout(smartSearchPending[id].timer);
      smartSearchPending[id].resolve(failure);
    }
    smartSearchPending = {};
  }

  function smartSearchSend(msg) {
    if (!smartSearchWorker) return Promise.resolve({ ok: false, error: 'Smart Search is off' });
    var requestId = ++smartSearchReqId;
    msg.requestId = requestId;
    return new Promise(function(resolve) {
      /* Timeout backstop — same class of protection MCP Bridge's own
         pending-request map and pur-import's worker call already have.
         Without it, a worker that hangs (rather than crashing, which
         the 'error' listener below already handles) instead of erroring
         on some pathological input leaves this promise unsettled
         forever — and since a search debounce cycle fires a fresh
         index+query pair every 300ms, that leak compounds on every
         subsequent keystroke instead of staying a one-off. */
      var timer = setTimeout(function() {
        if (!smartSearchPending[requestId]) return;
        delete smartSearchPending[requestId];
        resolve({ ok: false, error: 'Smart Search timed out' });
      }, 10000);
      smartSearchPending[requestId] = { resolve: resolve, timer: timer };
      smartSearchWorker.postMessage(msg);
    });
  }

  ipcMain.handle('smart-search-set-enabled', function(event, enabled) {
    if (enabled && !smartSearchWorker) {
      smartSearchWorker = new Worker(path.join(__dirname, 'smart-search-worker.js'));
      smartSearchWorker.on('message', function(result) {
        var pending = smartSearchPending[result.requestId];
        if (!pending) return;
        clearTimeout(pending.timer);
        delete smartSearchPending[result.requestId];
        pending.resolve(result);
      });
      smartSearchWorker.on('error', function() {
        /* A crashed worker leaves every still-pending call hanging
           forever otherwise — resolve them all with a clear failure so
           the renderer's search just falls back to plain text matching
           instead of silently never getting a response. Also tells the
           renderer directly (rather than leaving it to find out only
           when its next call fails) so it can flip the persisted
           smartSearchEnabled setting back to false — without this, the
           Settings checkbox keeps claiming Smart Search is on while
           it's actually silently dead, a real state-lying bug the
           feature's own review pass caught before shipping. */
        settleAllSmartSearchPending({ ok: false, error: 'Smart Search worker crashed' });
        smartSearchWorker = null;
        if (mainWindow) mainWindow.webContents.send('smart-search-crashed');
      });
    } else if (!enabled && smartSearchWorker) {
      smartSearchWorker.terminate();
      smartSearchWorker = null;
      settleAllSmartSearchPending({ ok: false, error: 'Smart Search was turned off' });
    }
    return true;
  });

  ipcMain.handle('smart-search-index', function(event, cards) {
    return smartSearchSend({ type: 'index', cards: cards });
  });

  ipcMain.handle('smart-search-query', function(event, query) {
    return smartSearchSend({ type: 'query', query: query });
  });

  /* ── IPC: Plugins ──
     Every handler here operates only under app.getPath('userData')/plugins
     — never anywhere else on disk. See plugin-loader.js for the path-
     containment checks backing removePlugin().

     SECURITY NOTE (fixed after an independent audit caught this): a
     plugin's own entry script runs in the same renderer page context as
     the rest of the app (the chosen convention-based sandbox model —
     see plugin-api.js), which means ANY renderer-exposed IPC method is
     reachable by a plugin's own code, not just by the real Settings UI.
     An earlier draft of this file had a 'plugins-approve' handler that
     blindly wrote whatever (id, version, permissions) the renderer sent
     — which meant a plugin could silently grant itself (or a different
     plugin) any permission with no real consent ever happening. Fixed
     by making 'plugins-review-and-enable' take ONLY a folder name: the
     main process re-reads that plugin's manifest.json itself (never
     trusts a renderer-supplied permission list or version string) and
     gates the actual approval behind a native OS dialog.showMessageBox
     — a real modal a co-resident script cannot script/auto-click,
     unlike the renderer's own DOM. 'plugins-set-enabled' similarly
     re-checks consent status fresh before honoring an enable=true
     request, so it can't be used as a side-door around the dialog
     either.

     A SEPARATE, STILL-OPEN LIMITATION (found on a later audit pass,
     documented rather than silently left implicit): the permission list
     shown in that consent dialog (network/filesystem/cardTypes/etc.) is
     not actually enforced at the IPC layer below — it exists to inform
     the user's decision, not to sandbox what an approved plugin's code
     can call. Because a plugin's script shares the renderer's page
     context, once approved it can call ANY KanvazBridge method exposed
     on window (readFile, writeFile, resetAppData, relaunchApp, etc.),
     regardless of which permissions it declared or was shown approving.
     True per-permission enforcement would require running each plugin
     in its own isolated JS context (e.g. one BrowserView/contextBridge
     per plugin) rather than the current same-page convention-based
     model — a larger architecture change tracked as a future layer, not
     done in 4.2.0. This is disclosed in SECURITY.md; the practical
     guidance for users is the same as VS Code extensions or browser
     extensions: only approve plugins from developers you trust, the
     displayed permission list is a description of intent, not a
     technical guarantee. */

  /* ── Recent changelog (Home Screen "What's New") ──
     Reads CHANGELOG.md straight off disk and regex-extracts just the
     "## [version] — headline" lines — no network call, same offline
     discipline as the bundled templates below. Deliberately doesn't
     parse the bullet lists under each heading: version + one-line
     headline is what the changelog's own entries put right there for
     exactly this purpose, and a fuller parse would be one more thing
     to keep in sync with CHANGELOG.md's actual formatting. */
  ipcMain.handle('changelog-recent', function(event, count) {
    var limit = (typeof count === 'number' && count > 0) ? count : 3;
    var changelogPath = path.join(__dirname, '..', 'CHANGELOG.md');
    return fs.promises.readFile(changelogPath, 'utf8').then(function(raw) {
      var entries = [];
      var re = /^## \[([^\]]+)\]\s*—\s*(.+)$/gm;
      var match;
      while ((match = re.exec(raw)) !== null && entries.length < limit) {
        entries.push({ version: match[1], headline: match[2].trim() });
      }
      return { ok: true, entries: entries };
    }).catch(function(e) {
      return { ok: false, error: e.message, entries: [] };
    });
  });

  /* ── Board templates (v5.1.0) ──
     Bundled with the app itself (assets/templates/), not fetched from
     anywhere — unlike Browse Official Plugins' catalog, this needs no
     network call at all. Renderer has no filesystem access of its own,
     so both listing and loading go through the main process; the id is
     re-validated against the manifest's own list (not trusted directly
     as a filename) before it's ever joined into a path. */
  var TEMPLATES_DIR = path.join(__dirname, '..', 'assets', 'templates');
  /* User-saved templates live under userData, never under TEMPLATES_DIR
     — that folder ships inside the installed app package (read-only on
     a typical per-machine install, and wiped/replaced on every update
     regardless), the same reasoning every other user-generated file in
     this app already follows (settings, recovery, profiles). Bundled
     and user templates are merged at list time (each entry tagged
     `source`) and looked up in whichever directory its source says. */
  var USER_TEMPLATES_DIR = path.join(app.getPath('userData'), 'templates');
  var USER_TEMPLATES_MANIFEST = path.join(USER_TEMPLATES_DIR, 'manifest.json');

  function readTemplateManifest() {
    return fs.promises.readFile(path.join(TEMPLATES_DIR, 'manifest.json'), 'utf8').then(function(raw) {
      try {
        var list = JSON.parse(raw);
        return Array.isArray(list) ? list : [];
      } catch (e) {
        throw new Error('templates manifest is not valid JSON');
      }
    }).then(function(list) {
      for (var i = 0; i < list.length; i++) list[i].source = 'bundled';
      return list;
    });
  }

  /* User-saved templates' own manifest — same shape as the bundled one
     plus `source: 'user'`, missing entirely until the first Save.
     Self-caught bug: this originally returned entries with no `source`
     tag at all, so the renderer's `entry.source === 'user'` check
     (which decides whether to show the "Yours" badge and a delete
     button) was always false for a template the user had just saved —
     caught live, not in review, by checking the actual DOM after a
     save instead of trusting the list-rendered text alone. */
  function readUserTemplateManifest() {
    return fs.promises.readFile(USER_TEMPLATES_MANIFEST, 'utf8').then(function(raw) {
      try {
        var list = JSON.parse(raw);
        return Array.isArray(list) ? list : [];
      } catch (e) {
        return [];
      }
    }).catch(function() {
      return [];
    }).then(function(list) {
      for (var i = 0; i < list.length; i++) list[i].source = 'user';
      return list;
    });
  }

  function writeUserTemplateManifest(list) {
    return fs.promises.mkdir(USER_TEMPLATES_DIR, { recursive: true }).then(function() {
      return fs.promises.writeFile(USER_TEMPLATES_MANIFEST, JSON.stringify(list), 'utf8');
    });
  }

  ipcMain.handle('templates-list', function() {
    return Promise.all([readTemplateManifest(), readUserTemplateManifest()]).then(function(results) {
      return { ok: true, templates: results[0].concat(results[1]) };
    }).catch(function(e) {
      return { ok: false, error: e.message };
    });
  });

  ipcMain.handle('template-load', function(event, id) {
    return Promise.all([readTemplateManifest(), readUserTemplateManifest()]).then(function(results) {
      var entry = results[0].concat(results[1]).filter(function(t) { return t.id === id; })[0];
      if (!entry) throw new Error('unknown template id');
      var dir = entry.source === 'user' ? USER_TEMPLATES_DIR : TEMPLATES_DIR;
      return fs.promises.readFile(path.join(dir, entry.file), 'utf8');
    }).then(function(raw) {
      try {
        return { ok: true, cards: JSON.parse(raw) };
      } catch (e) {
        throw new Error('template file is not valid JSON');
      }
    }).catch(function(e) {
      return { ok: false, error: e.message };
    });
  });

  /* Save the current board's cards as a new user template. `cards` is
     whatever the renderer already builds for a board save (serialised
     card objects) — stripped of nothing here; a template is just a
     starter board, and a user saving their own board as one presumably
     wants everything on it, media included, same as opening the file
     normally would restore. */
  ipcMain.handle('template-save', function(event, name, description, cards) {
    try {
      if (!name || !name.trim()) return { ok: false, error: 'name cannot be empty' };
      if (!Array.isArray(cards)) return { ok: false, error: 'no cards to save' };
    } catch (e) {
      return { ok: false, error: e.message };
    }
    var id = 'user-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
    var fileName = id + '.json';
    return fs.promises.mkdir(USER_TEMPLATES_DIR, { recursive: true }).then(function() {
      return fs.promises.writeFile(path.join(USER_TEMPLATES_DIR, fileName), JSON.stringify(cards), 'utf8');
    }).then(function() {
      return readUserTemplateManifest();
    }).then(function(list) {
      list.push({ id: id, name: name.trim(), description: (description || '').trim(), file: fileName });
      return writeUserTemplateManifest(list).then(function() { return { ok: true, id: id }; });
    }).catch(function(e) {
      return { ok: false, error: e.message };
    });
  });

  ipcMain.handle('template-delete', function(event, id) {
    return readUserTemplateManifest().then(function(list) {
      var idx = -1;
      for (var i = 0; i < list.length; i++) { if (list[i].id === id) { idx = i; break; } }
      if (idx === -1) return { ok: false, error: 'no user template with that id (built-in templates cannot be deleted)' };
      var entry = list[idx];
      list.splice(idx, 1);
      return writeUserTemplateManifest(list).then(function() {
        return fs.promises.unlink(path.join(USER_TEMPLATES_DIR, entry.file)).catch(function() {});
      }).then(function() { return { ok: true }; });
    }).catch(function(e) {
      return { ok: false, error: e.message };
    });
  });

  /* ── Template export/import (Template Maker & Manager plugin) ──
     Templates are plain JSON (see the plugin's own header comment), so
     the exported file is plain JSON too — no zip, unlike the profile
     export above, since a template never carries a folder of loose
     support files. TEMPLATE_FORMAT_VERSION guards the file's own shape:
     bump it only when a future change would make an older Kanvaz
     misread the fields below, and refuse to import anything higher than
     what this build understands instead of silently misinterpreting it. */
  var TEMPLATE_FORMAT_VERSION = 1;

  ipcMain.handle('templates-export-file', function(event, payload) {
    if (!payload || typeof payload.name !== 'string' || !Array.isArray(payload.cards)) {
      return Promise.resolve({ ok: false, error: 'nothing to export' });
    }
    var savePath = dialog.showSaveDialogSync(mainWindow, {
      title: 'Export Template',
      defaultPath: (payload.name || 'template').replace(/[\\/:*?"<>|]/g, '_') + '.kanvaztemplate',
      filters: [{ name: 'Kanvaz Template', extensions: ['kanvaztemplate'] }]
    });
    if (!savePath) return Promise.resolve({ ok: false, error: null, cancelled: true });

    var fileContents = {
      kanvazTemplateFormatVersion: TEMPLATE_FORMAT_VERSION,
      appVersion: app.getVersion(),
      name: payload.name,
      description: payload.description || '',
      createdAt: payload.createdAt || new Date().toISOString(),
      exportedAt: new Date().toISOString(),
      cards: payload.cards
    };
    return fs.promises.writeFile(savePath, JSON.stringify(fileContents, null, 2), 'utf8').then(function() {
      return { ok: true, path: savePath };
    }).catch(function(e) {
      return { ok: false, error: e.message };
    });
  });

  ipcMain.handle('templates-import-file', function() {
    var openPath = dialog.showOpenDialogSync(mainWindow, {
      title: 'Import Template',
      filters: [{ name: 'Kanvaz Template', extensions: ['kanvaztemplate', 'json'] }],
      properties: ['openFile']
    });
    if (!openPath || !openPath[0]) return Promise.resolve({ ok: false, error: null, cancelled: true });

    /* Same size backstop as profiles-import above: check the file's real
       size before reading it fully into memory, rather than trusting
       that "it's just JSON" caps it naturally — a template's cards can
       carry embedded image/video dataUrls same as a board file can, so
       nothing stops a corrupt or hostile file from being enormous. */
    return fs.promises.stat(openPath[0]).then(function(stat) {
      if (stat.size > MAX_PLUGIN_EXTRACTED_BYTES) {
        throw new Error('file is ' + Math.round(stat.size / (1024 * 1024)) + 'MB — too large to be a real template export');
      }
      return fs.promises.readFile(openPath[0], 'utf8');
    }).then(function(raw) {
      var data;
      try {
        data = JSON.parse(raw);
      } catch (e) {
        throw new Error('not a valid Kanvaz template file (bad JSON)');
      }
      if (!data || !Array.isArray(data.cards)) {
        throw new Error('not a valid Kanvaz template file (missing cards)');
      }
      /* Support-version gate: a template exported by a future Kanvaz with
         a higher format version may use fields this build doesn't know
         how to read. Refuse clearly rather than inserting a partially-
         understood card array — the same "tell the user, don't guess"
         rule main.js's plugin-loader.js applies to kanvazApiVersion. */
      var fileVersion = typeof data.kanvazTemplateFormatVersion === 'number' ? data.kanvazTemplateFormatVersion : 1;
      if (fileVersion > TEMPLATE_FORMAT_VERSION) {
        throw new Error('this template was made with a newer version of Kanvaz (format v' + fileVersion + ', this build supports up to v' + TEMPLATE_FORMAT_VERSION + ') — update Kanvaz to open it');
      }
      return {
        ok: true,
        name: data.name || path.basename(openPath[0], path.extname(openPath[0])),
        description: data.description || '',
        cards: data.cards,
        sourceAppVersion: data.appVersion || null
      };
    }).catch(function(e) {
      return { ok: false, error: e.message };
    });
  });

  /* Redesign v1: which plugins are enabled/approved is now PER-PROFILE
     (docs/PROFILES_SYSTEM_PLAN.md) — plugin CODE stays under the shared
     userData/plugins/ folder (installing a plugin is a machine-level
     action), but plugin-state.json (enabled/approved/permissions) now
     lives under the ACTIVE profile's own directory. Every handler below
     resolves both paths separately and passes them to plugin-loader.js
     as (userData, statePath, ...). */
  ipcMain.handle('plugins-scan', function() {
    try {
      var userData = app.getPath('userData');
      var statePath = kanvazProfiles.getActiveProfileDir(userData);
      return { ok: true, plugins: pluginLoader.scanPlugins(userData, statePath) };
    } catch (e) {
      return { ok: false, error: e.message, plugins: [] };
    }
  });

  ipcMain.handle('plugins-open-folder', function() {
    var dir = pluginLoader.ensurePluginsDir(app.getPath('userData'));
    return shell.openPath(dir);
  });

  ipcMain.handle('plugins-review-and-enable', function(event, pluginFolder) {
    var userData = app.getPath('userData');
    var statePath = kanvazProfiles.getActiveProfileDir(userData);
    var scanned = pluginLoader.scanPlugins(userData, statePath);
    var plugin = scanned.filter(function(p) { return p.folder === pluginFolder; })[0];

    if (!plugin || !plugin.valid) {
      return Promise.resolve({ ok: false, error: 'plugin not found or invalid' });
    }

    var manifest = plugin.manifest;
    var permText = pluginLoader.describePermissions(manifest.permissions);

    return dialog.showMessageBox(mainWindow, {
      type: 'question',
      buttons: ['Cancel', 'Approve & Enable'],
      defaultId: 0,
      cancelId: 0,
      title: 'Enable "' + manifest.name + '"?',
      message: '"' + manifest.name + '" (v' + manifest.version + ') wants to: ' + permText + '.',
      detail: 'Only approve this if you trust where it came from — like a browser extension, an approved plugin runs with the same access to your computer as Kanvaz itself, not just what\'s listed above. Kanvaz read this permission list directly from the plugin\'s own files, not from anything already running in the app.'
    }).then(function(result) {
      if (result.response !== 1) {
        return { ok: true, approved: false };
      }
      pluginLoader.approvePlugin(statePath, manifest.id, manifest.version, manifest.permissions || []);
      return { ok: true, approved: true };
    });
  });

  ipcMain.handle('plugins-set-enabled', function(event, pluginId, enabled) {
    try {
      var userData = app.getPath('userData');
      var statePath = kanvazProfiles.getActiveProfileDir(userData);
      if (enabled) {
        /* Re-check fresh — never trust a stored flag alone for turning
           something ON. If this plugin currently needs consent (new
           install, or a permission-escalating update since it was last
           approved), refuse rather than silently enabling it. */
        var scanned = pluginLoader.scanPlugins(userData, statePath);
        var plugin = scanned.filter(function(p) { return p.manifest && p.manifest.id === pluginId; })[0];
        if (!plugin || !plugin.valid || plugin.needsConsent) {
          return { ok: false, error: 'this plugin needs to be reviewed and approved first' };
        }
      }
      pluginLoader.setEnabled(statePath, pluginId, !!enabled);
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  ipcMain.handle('plugins-remove', function(event, pluginFolder, pluginId) {
    var userData = app.getPath('userData');
    var statePath = kanvazProfiles.getActiveProfileDir(userData);
    /* If both a folder and an id were given, only clear that id's stored
       approval state if we can POSITIVELY confirm folder and id belong
       to each other — never on the mere absence of a proven mismatch.
       (Security fix, found during the 4.2.0 audit: the original version
       only refused when a scanned entry for pluginFolder existed AND its
       id differed. A folder name that matched no real plugin at all —
       e.g. already deleted, or simply made up — fell through that check
       and still passed pluginId straight to removePlugin(), which
       unconditionally deletes state[pluginId]. That allowed any caller
       to wipe a completely unrelated, real plugin's approval/enabled state —
       silently forcing it back to needsConsent — via
       removePlugin('bogus-folder', 'victim.plugin.id').) */
    var idToClear = null;
    if (pluginId) {
      var scanned = pluginLoader.scanPlugins(userData, statePath);
      var match = scanned.filter(function(p) { return p.folder === pluginFolder; })[0];
      if (match && match.valid) {
        if (match.manifest.id !== pluginId) {
          return { ok: false, error: 'folder/id mismatch — refusing to remove' };
        }
        idToClear = pluginId; /* positively confirmed — safe to clear */
      }
      /* No scanned entry for pluginFolder (already broken/missing
         manifest): fall through and remove the folder only. Never clear
         a caller-supplied pluginId's state without a verified match. */
    }
    return pluginLoader.removePlugin(userData, statePath, pluginFolder, idToClear);
  });

  /* Per-plugin storage — used by e.g. the Theme Creator plugin to
     persist saved presets across restarts.

     HONEST SECURITY NOTE (corrected during the 4.2.0 audit — the
     original comment here overstated what this actually guarantees):
     the path-safety handling in plugin-loader.js guarantees a plugin's
     storage file can never escape its own namespaced location on disk
     (no path traversal). It does NOT verify which plugin's script is
     actually making a given call. Because every plugin's entry script
     runs in the same renderer page context as the rest of the app (the
     disclosed convention-based sandbox model — see plugin-api.js), any
     loaded plugin can, in principle, call this with a different
     plugin's id and read or overwrite its stored data. This is the same
     trust boundary as every other KanvazBridge method: approving a
     plugin grants it the same practical access as Kanvaz's own code,
     regardless of which permissions it declared or what the consent
     dialog listed. See SECURITY.md. writePluginStorage() itself does
     cap payload size (see plugin-loader.js) so a runaway/malicious
     write can't freeze the main process or exhaust disk. */
  /* Redesign v1: per-plugin storage (a plugin's saved presets/settings)
     is user content/preference, so it's per-profile too — same
     getActiveProfileDir() resolution as settings/recent/recovery. */
  ipcMain.handle('plugins-storage-get', function(event, pluginId) {
    try {
      var statePath = kanvazProfiles.getActiveProfileDir(app.getPath('userData'));
      return { ok: true, data: pluginLoader.readPluginStorage(statePath, pluginId) };
    } catch (e) {
      return { ok: false, error: e.message, data: {} };
    }
  });

  ipcMain.handle('plugins-storage-set', function(event, pluginId, data) {
    var statePath = kanvazProfiles.getActiveProfileDir(app.getPath('userData'));
    return pluginLoader.writePluginStorage(statePath, pluginId, data);
  });

  /* Settings -> Developer "Load unpacked plugin" (4.4.0) — dev-mode only,
     deliberately bypasses BOTH the real plugins directory and the
     consent dialog, same as Chrome extension dev mode. Still runs the
     exact same validateManifest() every real plugin goes through — a
     malformed plugin.json degrades the same way here as anywhere else,
     it just never asks the user to approve permissions first. The
     folder is picked via a native dialog (a real user gesture), so this
     can't be triggered by anything a plugin's own script does. */
  ipcMain.handle('plugins-load-unpacked', function() {
    var dirs = dialog.showOpenDialogSync(mainWindow, {
      title: 'Load unpacked Kanvaz plugin',
      properties: ['openDirectory']
    });
    if (!dirs || !dirs.length) return { ok: false, cancelled: true };

    var pluginDir = dirs[0];
    var manifestPath = path.join(pluginDir, 'plugin.json');
    if (!fs.existsSync(manifestPath)) {
      return { ok: false, error: 'No plugin.json found in that folder' };
    }

    var manifest;
    try {
      manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    } catch (e) {
      return { ok: false, error: 'plugin.json is not valid JSON' };
    }

    var validation = pluginLoader.validateManifest(manifest);
    if (!validation.ok) {
      return { ok: false, error: validation.reason };
    }

    var entryPath = path.resolve(path.join(pluginDir, manifest.entry));
    var resolvedPluginDir = path.resolve(pluginDir) + path.sep;
    if (entryPath.indexOf(resolvedPluginDir) !== 0 || !fs.existsSync(entryPath)) {
      return { ok: false, error: 'entry file "' + manifest.entry + '" not found' };
    }

    return {
      ok: true,
      manifest: manifest,
      entryUrl: nodeUrl.pathToFileURL(entryPath).href
    };
  });

  /* ── IPC: Browse Official Plugins (4.4.0) ── */

  ipcMain.handle('fetch-url-preview', function(event, urlStr) {
    var raw = (urlStr || '').trim();
    if (!raw) return Promise.resolve({ ok: false, error: 'no URL' });
    var target = /^https?:\/\//i.test(raw) ? raw : 'https://' + raw;
    return fetchUrlBuffer(target, MAX_URL_PREVIEW_HTML_BYTES).then(function(res) {
      var contentType = (res.contentType || '').split(';')[0].trim();
      if (contentType && contentType.indexOf('text/html') !== 0) {
        return { ok: true, title: null, image: null };
      }
      var meta = extractUrlMeta(res.buf.toString('utf8'));
      var result = { ok: true, title: meta.title, image: null };
      if (!meta.image) return result;
      var imageUrl;
      try { imageUrl = new nodeUrl.URL(meta.image, target).toString(); }
      catch (e) { return result; }
      return fetchUrlBuffer(imageUrl, MAX_URL_PREVIEW_IMAGE_BYTES).then(function(imgRes) {
        var mime = (imgRes.contentType || '').split(';')[0].trim();
        if (mime.indexOf('image/') !== 0) return result;
        result.image = 'data:' + mime + ';base64,' + imgRes.buf.toString('base64');
        return result;
      }).catch(function() { return result; /* title alone still lands */ });
    }).catch(function(e) {
      return { ok: false, error: e.message };
    });
  });

  ipcMain.handle('catalog-fetch', function() {
    return httpsGetBuffer(OFFICIAL_CATALOG_URL, MAX_CATALOG_BYTES).then(function(buf) {
      var parsed = JSON.parse(buf.toString('utf8'));
      if (!Array.isArray(parsed)) throw new Error('catalog is not a list');
      return { ok: true, catalog: parsed };
    }).catch(function(e) {
      return { ok: false, error: e.message };
    });
  });

  /* v6.5.0 — community templates catalog (Template Maker & Manager
     official plugin). Same fixed-URL, main-process-only network
     discipline as catalog-fetch above. */
  ipcMain.handle('templates-catalog-fetch', function() {
    return httpsGetBuffer(TEMPLATES_CATALOG_URL, MAX_CATALOG_BYTES).then(function(buf) {
      var parsed = JSON.parse(buf.toString('utf8'));
      if (!Array.isArray(parsed)) throw new Error('catalog is not a list');
      return { ok: true, catalog: parsed };
    }).catch(function(e) {
      return { ok: false, error: e.message };
    });
  });

  /* Fetches ONE template's actual JSON content (a card array) given a
     contentUrl from the catalog above — restricted to raw.githubusercontent.com
     the same way plugin zip downloads are restricted to GitHub's own
     hosts, so a tampered/malicious catalog entry can't redirect this to
     an arbitrary server. */
  ipcMain.handle('templates-catalog-fetch-item', function(event, contentUrl) {
    if (typeof contentUrl !== 'string' || !contentUrl) {
      return Promise.resolve({ ok: false, error: 'invalid content URL' });
    }
    return httpsGetBuffer(contentUrl, MAX_TEMPLATE_BYTES, ['raw.githubusercontent.com']).then(function(buf) {
      var parsed = JSON.parse(buf.toString('utf8'));
      if (!Array.isArray(parsed)) throw new Error('template is not a card list');
      return { ok: true, cards: parsed };
    }).catch(function(e) {
      return { ok: false, error: e.message };
    });
  });

  /* Installs straight from a catalog entry — no folder-dragging. The
     entry itself came from OFFICIAL_CATALOG_URL above (this repo's own
     main branch), but downloadUrl is checked again here independently
     rather than trusted blind, in case a future catalog format ever
     lets it point somewhere else. Extraction guards against zip-slip
     (a crafted entry path escaping the target folder) the same way
     board-container.js's own unpack path does — resolve every entry's
     real destination and refuse (skip, not abort the whole install) any
     that resolve outside pluginDir. Still goes through the exact same
     scanPlugins()/consent-dialog path as any other plugin afterward —
     this only places files on disk, it never enables anything. */
  ipcMain.handle('plugins-install-from-catalog', function(event, entry) {
    if (!entry || typeof entry.downloadUrl !== 'string' || typeof entry.id !== 'string' || !entry.id) {
      return Promise.resolve({ ok: false, error: 'invalid catalog entry' });
    }
    var parsedUrl;
    try {
      parsedUrl = new nodeUrl.URL(entry.downloadUrl);
    } catch (e) {
      return Promise.resolve({ ok: false, error: 'invalid download URL' });
    }
    if (parsedUrl.protocol !== 'https:' || ALLOWED_DOWNLOAD_HOSTS.indexOf(parsedUrl.hostname) === -1) {
      return Promise.resolve({ ok: false, error: 'downloads are only allowed from github.com releases' });
    }

    var pluginsDir = pluginLoader.ensurePluginsDir(app.getPath('userData'));
    var folderName = entry.id.replace(/[^a-zA-Z0-9._-]/g, '_');
    var targetDir = path.join(pluginsDir, folderName);
    var resolvedTargetDir = path.resolve(targetDir) + path.sep;

    return httpsGetBuffer(entry.downloadUrl, MAX_PLUGIN_ZIP_BYTES, ALLOWED_DOWNLOAD_HOSTS).then(function(buf) {
      return JSZip.loadAsync(buf);
    }).then(function(zip) {
      var names = Object.keys(zip.files);

      /* Audit fix — zip bomb: MAX_PLUGIN_ZIP_BYTES above only caps the
         COMPRESSED download; nothing previously capped decompressed
         output, so a small crafted zip could expand to gigabytes and
         exhaust disk during extraction, the exact DoS a size cap is
         supposed to prevent. Two layers: reject upfront using each
         entry's declared uncompressed size (no decompression needed —
         cheap, catches almost everything) via JSZip's internal
         `_data.uncompressedSize` (not a stable public API, hence the
         defensive fallback to 0 if the shape ever changes), THEN keep a
         running total of ACTUAL decompressed bytes as they resolve, so
         a zip that lies about its own declared size still gets caught
         before too much lands on disk. */
      var declaredTotal = 0;
      for (var d = 0; d < names.length; d++) {
        var f = zip.files[names[d]];
        if (!f.dir) declaredTotal += (f._data && f._data.uncompressedSize) || 0;
      }
      if (declaredTotal > MAX_PLUGIN_EXTRACTED_BYTES) {
        return Promise.reject(new Error('plugin archive declares ' + Math.round(declaredTotal / (1024 * 1024)) + 'MB uncompressed — exceeds the ' + Math.round(MAX_PLUGIN_EXTRACTED_BYTES / (1024 * 1024)) + 'MB limit'));
      }

      var writtenTotal = 0;
      var aborted = false;
      var writes = [];
      for (var i = 0; i < names.length; i++) {
        (function(relPath) {
          var file = zip.files[relPath];
          if (file.dir) return;
          var destPath = path.resolve(path.join(targetDir, relPath));
          if (destPath.indexOf(resolvedTargetDir) !== 0) return; /* zip-slip guard — skip, don't abort the whole install */
          writes.push(file.async('nodebuffer').then(function(data) {
            if (aborted) return;
            writtenTotal += data.length;
            if (writtenTotal > MAX_PLUGIN_EXTRACTED_BYTES) {
              aborted = true;
              throw new Error('plugin archive exceeded the ' + Math.round(MAX_PLUGIN_EXTRACTED_BYTES / (1024 * 1024)) + 'MB decompressed limit');
            }
            fs.mkdirSync(path.dirname(destPath), { recursive: true });
            fs.writeFileSync(destPath, data);
          }));
        })(names[i]);
      }
      return Promise.all(writes).catch(function(e) {
        /* Clean up whatever partial folder this attempt created —
           never leave a half-extracted (or bomb-truncated) plugin
           folder sitting in the real plugins directory. */
        try { fs.rmSync(targetDir, { recursive: true, force: true }); } catch (cleanupErr) { /* best effort */ }
        throw e;
      });
    }).then(function() {
      return { ok: true, folder: folderName };
    }).catch(function(e) {
      return { ok: false, error: e.message };
    });
  });

  /* ── IPC: MCP Bridge (4.4.0) ──
     Real enforcement, not just consent-dialog text: start/stop only
     honor the request if THE OFFICIAL MCP Bridge plugin specifically
     (MCP_BRIDGE_PLUGIN_ID) is actually approved AND enabled right now —
     re-checked fresh against disk every time, exactly like
     plugins-set-enabled above never trusts a stored flag alone. A
     plugin's own renderer-side code calling KanvazBridge.startMcpBridge()
     directly (bypassing KanvazPluginAPI.mcpBridge entirely) gains
     nothing from doing so — this is the real gate, that was only ever
     the documented surface.

     Audit fix — honesty gap in the ERROR message, not the gate itself:
     the 'server' permission (plugin-loader.js) is worded generically,
     as if any plugin declaring it gets a working local listener. It
     doesn't — this single listener is reserved for one specific
     plugin id, full stop, a single-tenant piece of infrastructure, not
     a generic per-plugin local-server framework (that's real future
     work, not attempted this pass). A well-behaved THIRD-PARTY plugin
     that honestly declares 'server', gets consent, and sees
     KanvazPluginAPI.mcpBridge present (buildScopedAPI() doesn't know
     about this single-tenant restriction — only main.js does) would
     previously see "not approved and enabled with the server
     permission" here, worded as if ITS OWN approval were the problem,
     when the real reason is this handler simply doesn't authorize any
     id but MCP_BRIDGE_PLUGIN_ID. Distinguishing the two honestly below. */
  ipcMain.handle('mcp-bridge-start', function() {
    var userData = app.getPath('userData');
    var scanned = pluginLoader.scanPlugins(userData, kanvazProfiles.getActiveProfileDir(userData));
    var plugin = scanned.filter(function(p) {
      return p.manifest && p.manifest.id === MCP_BRIDGE_PLUGIN_ID;
    })[0];
    if (!plugin) {
      return Promise.resolve({
        ok: false,
        error: 'This build\'s local MCP listener is reserved for the official MCP Bridge plugin (' + MCP_BRIDGE_PLUGIN_ID + '). A generic per-plugin local-server capability isn\'t implemented yet — declaring the "server" permission unlocks KanvazPluginAPI.mcpBridge, but only that one plugin id can actually start the listener.'
      });
    }
    var authorized = plugin.valid && plugin.enabled &&
      plugin.approvedPermissions && plugin.approvedPermissions.indexOf('server') !== -1;
    if (!authorized) {
      return Promise.resolve({ ok: false, error: 'MCP Bridge isn\'t approved and enabled yet — go to Settings → Plugins, approve it, then turn it on.' });
    }
    return startMcpBridgeServer().catch(function(e) {
      return { ok: false, error: e.message };
    });
  });

  ipcMain.handle('mcp-bridge-stop', function() {
    return stopMcpBridgeServer().then(function() {
      return { ok: true };
    });
  });

  /* One-way reply half of the mcp-invoke round trip (see invokeRenderer
     above) — ipcMain.on, not .handle, because the renderer already sent
     its result value directly in the payload; there's nothing for THIS
     message to return. */
  ipcMain.on('mcp-invoke-result', function(event, payload) {
    if (!payload || !payload.requestId) return;
    var pending = mcpBridgePending[payload.requestId];
    if (!pending) return; /* already timed out, or an unrecognized/duplicate reply */
    delete mcpBridgePending[payload.requestId];
    clearTimeout(pending.timer);
    if (payload.error) pending.reject(new Error(payload.error));
    else pending.resolve(payload.result);
  });

}

/* ── Auto-updater ──
   GitHub-releases-backed update feed (see build.publish in package.json —
   the same config electron-builder reads to publish releases from CI is
   what electron-updater reads at runtime to find them).

   Kanvaz's whole pitch is "no telemetry, no background network activity"
   (see the About screen) — so this module NEVER calls checkForUpdates()
   on its own. wireAutoUpdaterEvents() just registers listeners (inert,
   no network I/O); the actual check only fires from the 'check-for-updates'
   IPC handler, which only fires when the user clicks the button. Once
   they've asked, autoDownload quietly finishes the job in the background
   and installs only on their explicit "Restart & Install" — never a
   surprise relaunch while someone's mid-edit. */
function wireAutoUpdaterEvents() {
  if (!autoUpdater) return;

  /* Audit fix (live-tested): this used to be true, silently downloading
     the instant a newer version was found, with no way to say no. Now
     the renderer asks the user first (see app.js's 'update-available'
     handler) and only calls the new 'download-update' IPC (above) once
     they've actually said yes.

     Also: electron-builder's win.target here builds BOTH nsis and
     portable — only the NSIS installer is auto-updatable at all
     (electron-updater has no concept of a portable Windows build; there
     is no installed copy for quitAndInstall() to silently replace).
     Live-tested this session: running the PORTABLE .exe still found and
     "downloaded" an update and offered "Restart & Install" as if it
     were the installed build — misleading, since there's no well-defined
     in-place update for a portable exe to apply. isPortable below is
     electron-builder's own documented signal (the portable launcher sets
     this env var on the process it spawns) — when true, the renderer
     skips the auto-download option entirely and only offers the release
     page link. */
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;
  var isPortable = !!process.env.PORTABLE_EXECUTABLE_FILE;

  autoUpdater.on('update-available', function(info) {
    if (mainWindow) {
      mainWindow.webContents.send('update-available', { version: info && info.version, isPortable: isPortable });
    }
  });

  /* Progress feedback during the download itself (4.9.0) — the flow
     used to go straight from "found" to silence until "ready to
     restart," with no indication anything was actually happening in
     between. electron-updater already emits this event with real
     numbers; nothing here was ever reading it. */
  autoUpdater.on('download-progress', function(progress) {
    if (mainWindow) {
      mainWindow.webContents.send('update-download-progress', { percent: progress && progress.percent });
    }
  });

  autoUpdater.on('update-downloaded', function(info) {
    if (mainWindow) {
      mainWindow.webContents.send('update-downloaded', { version: info && info.version });
    }
  });

  autoUpdater.on('error', function(err) {
    /* Check failures (no internet, feed unreachable, etc.) are expected
       and shouldn't interrupt the user — log only. */
    console.error('[Kanvaz] auto-updater error:', err ? err.message : err);
  });
}

/* ── Crash recovery check ── */

function checkCrashRecovery() {
  var recovPath = path.join(getRecoveryDir(), 'autosave.kanvaz.tmp');
  if (fs.existsSync(recovPath)) {
    if (mainWindow) {
      mainWindow.webContents.send('recovery-available');
    }
  }
}
