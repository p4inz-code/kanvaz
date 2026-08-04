/* main.js — Kanvaz main process */

var electron = require('electron');
var app = electron.app;
var BrowserWindow = electron.BrowserWindow;
var ipcMain = electron.ipcMain;
var dialog = electron.dialog;
var shell = electron.shell;
var path = require('path');
var fs = require('fs');

var purImport = require('./pur-import');
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
    if (process.platform !== 'darwin') app.quit();
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

  ipcMain.handle('pur-import', function(event, filePath) {
    return fs.promises.readFile(filePath)
      .then(function(buffer) {
        var parsed = purImport.parsePurFile(buffer);
        return { ok: true, images: parsed.images, count: parsed.count };
      })
      .catch(function(e) {
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

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('update-available', function(info) {
    if (mainWindow) {
      mainWindow.webContents.send('update-available', { version: info && info.version });
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
