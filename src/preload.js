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

  /* PureRef import */
  openPurDialog:   function() { return ipcRenderer.invoke('dialog-open-pur'); },
  importPur:       function(p) { return ipcRenderer.invoke('pur-import', p); },

  /* Settings */
  readSettings:    function() { return ipcRenderer.invoke('settings-read'); },
  writeSettings:   function(d) { return ipcRenderer.invoke('settings-write', d); },
  resetAppData:    function() { return ipcRenderer.invoke('reset-app-data'); },
  relaunchApp:     function() { ipcRenderer.send('app-relaunch'); },
  firstRunCheck:   function() { return ipcRenderer.invoke('first-run-check'); },

  /* Main → Renderer events */
  on: function(channel, fn) {
    var allowed = ['recovery-available', 'window-maximized-changed', 'check-unsaved-before-close', 'open-file-from-argv'];
    if (allowed.indexOf(channel) !== -1) {
      ipcRenderer.on(channel, function(event, data) { fn(data); });
    }
  },

  off: function(channel) {
    ipcRenderer.removeAllListeners(channel);
  }

});
