/* main.js — Kanvaz main process */

var electron = require('electron');
var app = electron.app;
var BrowserWindow = electron.BrowserWindow;
var ipcMain = electron.ipcMain;
var dialog = electron.dialog;
var shell = electron.shell;
var path = require('path');
var fs = require('fs');

var mainWindow = null;
var allowClose = false;
var RECOVERY_DIR = path.join(app.getPath('userData'), 'recovery');
var RECENT_FILES_PATH = path.join(app.getPath('userData'), 'recent.json');
var MAX_RECENT = 8;
var LARGE_FILE_WARN_MB = 200;
var MAX_FILE_SIZE_MB   = 500;

/* ── Startup ── */

app.whenReady().then(function() {
  ensureDirectories();
  createWindow();
  registerIPC();
});

app.on('window-all-closed', function() {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', function() {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

/* ── Window ── */

function createWindow() {
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

  mainWindow.on('maximize', function() {
    if (mainWindow) mainWindow.webContents.send('window-maximized-changed', true);
  });

  mainWindow.on('unmaximize', function() {
    if (mainWindow) mainWindow.webContents.send('window-maximized-changed', false);
  });

  mainWindow.webContents.on('did-finish-load', function() {
    checkCrashRecovery();
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
    return result || null;
  });

  /* ── IPC: File read/write ── */

  ipcMain.handle('file-read', function(event, filePath) {
    return fs.promises.readFile(filePath, 'utf8')
      .then(function(data) { return { ok: true, data: data }; })
      .catch(function(e) { return { ok: false, error: e.message }; });
  });

  ipcMain.handle('file-write', function(event, filePath, data) {
    return fs.promises.writeFile(filePath, data, 'utf8')
      .then(function() { return { ok: true }; })
      .catch(function(e) { return { ok: false, error: e.message }; });
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
    return fs.promises.writeFile(settingsPath, data, 'utf8')
      .then(function() { return { ok: true }; })
      .catch(function(e) { return { ok: false, error: e.message }; });
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
  ipcMain.handle('reset-app-data', function() {
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
          fs.unlinkSync(path.join(RECOVERY_DIR, files[i]));
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
