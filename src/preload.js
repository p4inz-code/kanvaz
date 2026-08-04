/* preload.js — secure context bridge */

var contextBridge = require('electron').contextBridge;
var ipcRenderer = require('electron').ipcRenderer;

contextBridge.exposeInMainWorld('KanvazBridge', {

  /* Window controls */
  minimize:        function() { ipcRenderer.send('window-minimize'); },
  maximize:        function() { ipcRenderer.send('window-maximize'); },
  close:           function() { ipcRenderer.send('window-close'); },
  forceClose:      function() { ipcRenderer.send('force-close'); },
  isMaximized:     function() { return ipcRenderer.invoke('window-is-maximized'); },
  setAlwaysOnTop:  function(flag) { ipcRenderer.send('window-set-always-on-top', flag); },
  setWindowTitle:  function(title) { ipcRenderer.send('set-window-title', title); },
  setMoodLockSize: function(active) { ipcRenderer.send('window-set-moodlock-size', active); },
  dragWindowBy: function(dx, dy) { ipcRenderer.send('window-drag-by', { dx: dx, dy: dy }); },

  /* File dialogs */
  openFileDialog:  function() { return ipcRenderer.invoke('dialog-open-file'); },
  saveFileDialog:  function(name) { return ipcRenderer.invoke('dialog-save-file', name); },
  openMediaDialog: function() { return ipcRenderer.invoke('dialog-open-media'); },
  openRefFileDialog: function(ext) { return ipcRenderer.invoke('dialog-open-ref-file', ext); },

  /* File I/O */
  readFile:        function(p) { return ipcRenderer.invoke('file-read', p); },
  writeFile:       function(p, d) { return ipcRenderer.invoke('file-write', p, d); },

  /* Media */
  loadMedia:       function(p) { return ipcRenderer.invoke('media-load', p); },

  /* Recent files */
  getRecent:       function() { return ipcRenderer.invoke('recent-get'); },
  addRecent:       function(p) { return ipcRenderer.invoke('recent-add', p); },
  removeRecent:    function(p) { return ipcRenderer.invoke('recent-remove', p); },

  /* Recovery */
  writeRecovery:   function(d) { return ipcRenderer.invoke('recovery-write', d); },
  readRecovery:    function() { return ipcRenderer.invoke('recovery-read'); },
  clearRecovery:   function() { return ipcRenderer.invoke('recovery-clear'); },

  /* Shell */
  openExternal:    function(url) { ipcRenderer.send('shell-open-external', url); },
  openPath:        function(p) { return ipcRenderer.invoke('shell-open-path', p); },

  /* PureRef import */
  openPurDialog:   function() { return ipcRenderer.invoke('dialog-open-pur'); },
  importPur:       function(p) { return ipcRenderer.invoke('pur-import', p); },

  /* Plugins — reviewAndEnablePlugin takes only a folder name; the main
     process re-reads that plugin's manifest itself and gates approval
     behind a native OS dialog, rather than trusting a renderer-supplied
     permission list (see the security note in main.js). */
  scanPlugins:          function() { return ipcRenderer.invoke('plugins-scan'); },
  openPluginsFolder:    function() { return ipcRenderer.invoke('plugins-open-folder'); },
  reviewAndEnablePlugin: function(folder) { return ipcRenderer.invoke('plugins-review-and-enable', folder); },
  setPluginEnabled:     function(id, enabled) { return ipcRenderer.invoke('plugins-set-enabled', id, enabled); },
  removePlugin:         function(folder, id) { return ipcRenderer.invoke('plugins-remove', folder, id); },
  getPluginStorage:     function(id) { return ipcRenderer.invoke('plugins-storage-get', id); },
  setPluginStorage:     function(id, data) { return ipcRenderer.invoke('plugins-storage-set', id, data); },

  /* Settings */
  readSettings:    function() { return ipcRenderer.invoke('settings-read'); },
  writeSettings:   function(d) { return ipcRenderer.invoke('settings-write', d); },
  resetAppData:    function(clearCaches) { return ipcRenderer.invoke('reset-app-data', !!clearCaches); },
  relaunchApp:     function() { ipcRenderer.send('app-relaunch'); },
  firstRunCheck:   function() { return ipcRenderer.invoke('first-run-check'); },

  /* Auto-updater */
  checkForUpdates: function() { ipcRenderer.send('check-for-updates'); },
  installUpdate:   function() { ipcRenderer.send('install-update'); },

  /* Main → Renderer events */
  on: function(channel, fn) {
    var allowed = ['recovery-available', 'window-maximized-changed', 'check-unsaved-before-close', 'open-file-from-argv', 'update-available', 'update-downloaded'];
    if (allowed.indexOf(channel) !== -1) {
      ipcRenderer.on(channel, function(event, data) { fn(data); });
    }
  },

  off: function(channel) {
    /* Same allowlist as on() above — keeps this from ever being usable
       to strip listeners off a channel it was never allowed to
       subscribe to in the first place. Not currently exploited anywhere
       (nothing in the renderer calls off() with an arbitrary channel),
       just closing the gap between the two. */
    var allowed = ['recovery-available', 'window-maximized-changed', 'check-unsaved-before-close', 'open-file-from-argv', 'update-available', 'update-downloaded'];
    if (allowed.indexOf(channel) !== -1) {
      ipcRenderer.removeAllListeners(channel);
    }
  }

});
