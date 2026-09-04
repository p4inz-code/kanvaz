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
var RECOVERY_DIR = path.join(app.getPath('userData'), 'recovery');
var RECENT_FILES_PATH = path.join(app.getPath('userData'), 'recent.json');
var MAX_RECENT = 8;
var LARGE_FILE_WARN_MB = 200;
var MAX_FILE_SIZE_MB   = 500;

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
var MAX_CATALOG_BYTES = 256 * 1024;
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
    createWindow();
    registerIPC();

    /* BUG 5: fresh launch with a .kanvaz file on the command line
       (double-click a file, or "Open with Kanvaz"). */
    var startupFile = pendingFileOpen || findKanvazArg(process.argv);
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
  });

  app.on('activate', function() {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
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

function createWindow() {
  /* Reset per new window. allowClose is only ever flipped to true right
     before a deliberate close (see 'force-close' below); without this
     reset, macOS can hit a stale `true` here — window-all-closed doesn't
     quit on darwin, and app.on('activate') can spawn a fresh window
     after the last one closes, which would then skip the unsaved-
     changes check on its own first close attempt. */
  allowClose = false;

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
      webSecurity: true
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
  if (!fs.existsSync(RECOVERY_DIR)) {
    fs.mkdirSync(RECOVERY_DIR, { recursive: true });
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
     titlebar, useful when Top Mode has the chrome hidden. Plain
     middle-mouse-drag is already used for canvas panning, so this is
     deliberately gated behind holding Tab too (checked renderer-side)
     to avoid colliding with that. Moves the real OS window position,
     which a CSS app-region drag zone can't do from an arbitrary point
     on the canvas — only from a marked region. */
  ipcMain.on('window-drag-by', function(event, delta) {
    if (!mainWindow) return;
    var b = mainWindow.getBounds();
    mainWindow.setPosition(b.x + delta.dx, b.y + delta.dy);
  });

  /* Top Mode (and the persistent Auto-hide toolbar setting) remove all
     toolbar/titlebar chrome, so the 320x240 unconditional floor no
     longer applies — relax it further to a real reference-viewing
     floor while either is active, and restore the standard floor
     immediately on exit. */
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
        { name: 'All Supported Media', extensions: ['jpg','jpeg','png','gif','bmp','webp','mp4','webm','mov','mkv','avi','mp3','wav','ogg','m4a'] },
        { name: 'Images', extensions: ['jpg','jpeg','png','gif','bmp','webp'] },
        { name: 'Video', extensions: ['mp4','webm','mov','mkv','avi'] },
        { name: 'Audio', extensions: ['mp3','wav','ogg','m4a'] }
      ],
      properties: ['openFile']
    });
    return result ? result[0] : null;
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

  /* ── IPC: Recent files ── */

  ipcMain.handle('recent-get', function() {
    try {
      if (!fs.existsSync(RECENT_FILES_PATH)) return [];
      var raw = fs.readFileSync(RECENT_FILES_PATH, 'utf8');
      return JSON.parse(raw);
    } catch (e) {
      return [];
    }
  });

  ipcMain.handle('recent-add', function(event, filePath) {
    try {
      var list = [];
      if (fs.existsSync(RECENT_FILES_PATH)) {
        list = JSON.parse(fs.readFileSync(RECENT_FILES_PATH, 'utf8'));
      }
      list = list.filter(function(p) { return p !== filePath; });
      list.unshift(filePath);
      if (list.length > MAX_RECENT) list = list.slice(0, MAX_RECENT);
      fs.writeFileSync(RECENT_FILES_PATH, JSON.stringify(list), 'utf8');
      return list;
    } catch (e) {
      return [];
    }
  });

  ipcMain.handle('recent-remove', function(event, filePath) {
    try {
      var list = [];
      if (fs.existsSync(RECENT_FILES_PATH)) {
        list = JSON.parse(fs.readFileSync(RECENT_FILES_PATH, 'utf8'));
      }
      list = list.filter(function(p) { return p !== filePath; });
      fs.writeFileSync(RECENT_FILES_PATH, JSON.stringify(list), 'utf8');
      return list;
    } catch (e) {
      return [];
    }
  });

  /* ── IPC: Recovery ── */

  ipcMain.handle('recovery-write', function(event, data) {
    var recovPath = path.join(RECOVERY_DIR, 'autosave.kanvaz.tmp');
    return fs.promises.writeFile(recovPath, data, 'utf8')
      .then(function() { return { ok: true }; })
      .catch(function(e) { return { ok: false, error: e.message }; });
  });

  ipcMain.handle('recovery-read', function() {
    try {
      var recovPath = path.join(RECOVERY_DIR, 'autosave.kanvaz.tmp');
      if (!fs.existsSync(recovPath)) return { ok: false };
      var data = fs.readFileSync(recovPath, 'utf8');
      return { ok: true, data: data };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  ipcMain.handle('recovery-clear', function() {
    try {
      var recovPath = path.join(RECOVERY_DIR, 'autosave.kanvaz.tmp');
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
  var DROP_MEDIA_EXTS = ['jpg', 'jpeg', 'png', 'bmp', 'webp', 'gif', 'mp4', 'webm', 'mov', 'mkv', 'avi', 'mp3', 'wav', 'ogg', 'm4a'];

  ipcMain.handle('resolve-dropped-paths', function(event, paths) {
    var out = [];
    for (var i = 0; i < paths.length; i++) {
      var p = paths[i];
      try {
        var stat = fs.statSync(p);
        if (stat.isDirectory()) {
          var entries = fs.readdirSync(p);
          for (var j = 0; j < entries.length; j++) {
            var full = path.join(p, entries[j]);
            try {
              if (fs.statSync(full).isFile()) {
                var ext = entries[j].split('.').pop().toLowerCase();
                if (DROP_MEDIA_EXTS.indexOf(ext) !== -1) out.push(full);
              }
            } catch (e) { /* unreadable entry inside the folder — skip it, don't fail the whole drop */ }
          }
        } else if (stat.isFile()) {
          out.push(p);
        }
      } catch (e) { /* path vanished or is unreadable — skip it, don't fail the whole drop */ }
    }
    return out;
  });

  /* ── IPC: Settings ── */

  ipcMain.handle('settings-read', function() {
    try {
      var settingsPath = path.join(app.getPath('userData'), 'settings.json');
      if (!fs.existsSync(settingsPath)) return { ok: true, data: null };
      var raw = fs.readFileSync(settingsPath, 'utf8');
      return { ok: true, data: raw };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  ipcMain.handle('settings-write', function(event, data) {
    var settingsPath = path.join(app.getPath('userData'), 'settings.json');
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

  /* Clean reset — clears settings, recent-files list, recovery/autosave
     cache, and the first-run flag. Deliberately touches ONLY paths
     under app.getPath('userData') — every one of them is a
     Kanvaz-internal cache/preference file, never a saved .kanvaz board.
     Boards always live wherever the user chose via the save dialog, a
     location entirely outside userData by construction — there is no
     path in this function that could ever reach one, so no exclusion
     list is needed; the safety comes from what's simply never touched
     here, not from filtering. */
  ipcMain.handle('reset-app-data', function(event, clearCaches) {
    try {
      var userDataDir = app.getPath('userData');
      var settingsPath = path.join(userDataDir, 'settings.json');
      var flagPath = path.join(userDataDir, 'first-run-done');

      if (fs.existsSync(settingsPath)) fs.unlinkSync(settingsPath);
      if (fs.existsSync(RECENT_FILES_PATH)) fs.unlinkSync(RECENT_FILES_PATH);
      if (fs.existsSync(flagPath)) fs.unlinkSync(flagPath);

      if (fs.existsSync(RECOVERY_DIR)) {
        var files = fs.readdirSync(RECOVERY_DIR);
        for (var i = 0; i < files.length; i++) {
          /* RECOVERY_DIR is only ever expected to hold flat recovery
             files, but fs.unlinkSync throws EISDIR on a directory —
             which would abort this whole reset (caught by the outer
             try/catch, reported as a failure) over one unexpected
             subdirectory. rmSync with recursive+force handles either
             case without throwing, same as the cache-clearing block
             just below. */
          fs.rmSync(path.join(RECOVERY_DIR, files[i]), { recursive: true, force: true });
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

  /* ── Board templates (v5.1.0) ──
     Bundled with the app itself (assets/templates/), not fetched from
     anywhere — unlike Browse Official Plugins' catalog, this needs no
     network call at all. Renderer has no filesystem access of its own,
     so both listing and loading go through the main process; the id is
     re-validated against the manifest's own list (not trusted directly
     as a filename) before it's ever joined into a path. */
  var TEMPLATES_DIR = path.join(__dirname, '..', 'assets', 'templates');

  function readTemplateManifest() {
    return fs.promises.readFile(path.join(TEMPLATES_DIR, 'manifest.json'), 'utf8').then(function(raw) {
      try {
        var list = JSON.parse(raw);
        return Array.isArray(list) ? list : [];
      } catch (e) {
        throw new Error('templates manifest is not valid JSON');
      }
    });
  }

  ipcMain.handle('templates-list', function() {
    return readTemplateManifest().then(function(list) {
      return { ok: true, templates: list };
    }).catch(function(e) {
      return { ok: false, error: e.message };
    });
  });

  ipcMain.handle('template-load', function(event, id) {
    return readTemplateManifest().then(function(list) {
      var entry = list.filter(function(t) { return t.id === id; })[0];
      if (!entry) throw new Error('unknown template id');
      return fs.promises.readFile(path.join(TEMPLATES_DIR, entry.file), 'utf8');
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

  ipcMain.handle('plugins-scan', function() {
    try {
      return { ok: true, plugins: pluginLoader.scanPlugins(app.getPath('userData')) };
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
    var scanned = pluginLoader.scanPlugins(userData);
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
      pluginLoader.approvePlugin(userData, manifest.id, manifest.version, manifest.permissions || []);
      return { ok: true, approved: true };
    });
  });

  ipcMain.handle('plugins-set-enabled', function(event, pluginId, enabled) {
    try {
      var userData = app.getPath('userData');
      if (enabled) {
        /* Re-check fresh — never trust a stored flag alone for turning
           something ON. If this plugin currently needs consent (new
           install, or a permission-escalating update since it was last
           approved), refuse rather than silently enabling it. */
        var scanned = pluginLoader.scanPlugins(userData);
        var plugin = scanned.filter(function(p) { return p.manifest && p.manifest.id === pluginId; })[0];
        if (!plugin || !plugin.valid || plugin.needsConsent) {
          return { ok: false, error: 'this plugin needs to be reviewed and approved first' };
        }
      }
      pluginLoader.setEnabled(userData, pluginId, !!enabled);
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  ipcMain.handle('plugins-remove', function(event, pluginFolder, pluginId) {
    var userData = app.getPath('userData');
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
      var scanned = pluginLoader.scanPlugins(userData);
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
    return pluginLoader.removePlugin(userData, pluginFolder, idToClear);
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
  ipcMain.handle('plugins-storage-get', function(event, pluginId) {
    try {
      return { ok: true, data: pluginLoader.readPluginStorage(app.getPath('userData'), pluginId) };
    } catch (e) {
      return { ok: false, error: e.message, data: {} };
    }
  });

  ipcMain.handle('plugins-storage-set', function(event, pluginId, data) {
    return pluginLoader.writePluginStorage(app.getPath('userData'), pluginId, data);
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
    var scanned = pluginLoader.scanPlugins(app.getPath('userData'));
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
  var recovPath = path.join(RECOVERY_DIR, 'autosave.kanvaz.tmp');
  if (fs.existsSync(recovPath)) {
    if (mainWindow) {
      mainWindow.webContents.send('recovery-available');
    }
  }
}
