/* preload.js — secure context bridge */

var contextBridge = require('electron').contextBridge;
var ipcRenderer = require('electron').ipcRenderer;

/* Redesign v1 Phase 2: main.js passes this at window-creation time (see
   createWindow's additionalArguments) so the renderer can decide,
   synchronously at boot, whether this launch is going straight to a
   specific .kanvaz file — a plain boolean snapshot, not a live IPC call,
   since it's fixed for the lifetime of this window. */
var hasStartupFileArg = process.argv.indexOf('--kanvaz-has-startup-file=1') !== -1;

contextBridge.exposeInMainWorld('KanvazBridge', {

  /* Launch info */
  hasStartupFile:  function() { return hasStartupFileArg; },

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
  readPdfBytes: function(filePath) { return ipcRenderer.invoke('pdf-read-bytes', filePath); },

  /* File I/O */
  readFile:        function(p) { return ipcRenderer.invoke('file-read', p); },
  writeFile:       function(p, d) { return ipcRenderer.invoke('file-write', p, d); },

  /* Media */
  loadMedia:       function(p) { return ipcRenderer.invoke('media-load', p); },
  loadModel:       function(p) { return ipcRenderer.invoke('model-load', p); },

  /* Recent files */
  getRecent:       function() { return ipcRenderer.invoke('recent-get'); },
  addRecent:       function(p) { return ipcRenderer.invoke('recent-add', p); },
  removeRecent:    function(p) { return ipcRenderer.invoke('recent-remove', p); },

  /* Recovery */
  writeRecovery:   function(d) { return ipcRenderer.invoke('recovery-write', d); },
  readRecovery:    function() { return ipcRenderer.invoke('recovery-read'); },
  clearRecovery:   function() { return ipcRenderer.invoke('recovery-clear'); },

  /* Profiles (offline, no login — docs/PROFILES_SYSTEM_PLAN.md) */
  listProfiles:    function() { return ipcRenderer.invoke('profiles-list'); },
  getActiveProfile: function() { return ipcRenderer.invoke('profiles-get-active'); },
  createProfile:   function(name, opts) { return ipcRenderer.invoke('profiles-create', name, opts); },
  switchProfile:   function(id) { return ipcRenderer.invoke('profiles-switch', id); },
  renameProfile:   function(id, name) { return ipcRenderer.invoke('profiles-rename', id, name); },
  updateProfile:   function(id, fields) { return ipcRenderer.invoke('profiles-update', id, fields); },
  setProfileAvatar: function(id, dataUrl) { return ipcRenderer.invoke('profiles-set-avatar', id, dataUrl); },
  deleteProfile:   function(id) { return ipcRenderer.invoke('profiles-delete', id); },
  exportProfile:   function(id) { return ipcRenderer.invoke('profiles-export', id); },
  importProfile:   function() { return ipcRenderer.invoke('profiles-import'); },

  /* Shell */
  openExternal:    function(url) { ipcRenderer.send('shell-open-external', url); },
  resolveDroppedPaths: function(paths) { return ipcRenderer.invoke('resolve-dropped-paths', paths); },
  fetchUrlPreview: function(url) { return ipcRenderer.invoke('fetch-url-preview', url); },
  listTemplates:   function() { return ipcRenderer.invoke('templates-list'); },
  loadTemplate:    function(id) { return ipcRenderer.invoke('template-load', id); },
  saveTemplate:    function(name, description, cards) { return ipcRenderer.invoke('template-save', name, description, cards); },
  deleteTemplate:  function(id) { return ipcRenderer.invoke('template-delete', id); },
  setSmartSearchEnabled: function(enabled) { return ipcRenderer.invoke('smart-search-set-enabled', enabled); },
  smartSearchIndex: function(cards) { return ipcRenderer.invoke('smart-search-index', cards); },
  smartSearchQuery: function(query) { return ipcRenderer.invoke('smart-search-query', query); },
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
  loadUnpackedPlugin:   function() { return ipcRenderer.invoke('plugins-load-unpacked'); },
  fetchOfficialCatalog: function() { return ipcRenderer.invoke('catalog-fetch'); },
  fetchTemplatesCatalog: function() { return ipcRenderer.invoke('templates-catalog-fetch'); },
  fetchTemplateContent: function(contentUrl) { return ipcRenderer.invoke('templates-catalog-fetch-item', contentUrl); },
  installFromCatalog:   function(entry) { return ipcRenderer.invoke('plugins-install-from-catalog', entry); },

  /* MCP Bridge (4.4.0) — startMcpBridge/stopMcpBridge re-verify main-
     process-side that the calling context actually has an approved,
     enabled plugin declaring the 'server' permission before opening
     anything (see main.js) — these two methods alone grant nothing.
     mcpInvokeResult is the renderer's reply half of the main→renderer
     round trip that 'mcp-invoke' (added to the on()/off() allowlist
     below) is the push half of; see plugin-api.js's mcpBridge.onInvoke(). */
  startMcpBridge:  function() { return ipcRenderer.invoke('mcp-bridge-start'); },
  stopMcpBridge:   function() { return ipcRenderer.invoke('mcp-bridge-stop'); },
  mcpInvokeResult: function(payload) { ipcRenderer.send('mcp-invoke-result', payload); },

  /* Settings */
  readSettings:    function() { return ipcRenderer.invoke('settings-read'); },
  writeSettings:   function(d) { return ipcRenderer.invoke('settings-write', d); },
  resetAppData:    function(clearCaches) { return ipcRenderer.invoke('reset-app-data', !!clearCaches); },
  relaunchApp:     function() { ipcRenderer.send('app-relaunch'); },
  firstRunCheck:   function() { return ipcRenderer.invoke('first-run-check'); },

  /* Auto-updater */
  checkForUpdates: function() { ipcRenderer.send('check-for-updates'); },
  downloadUpdate:  function() { ipcRenderer.send('download-update'); },
  installUpdate:   function() { ipcRenderer.send('install-update'); },

  /* Main → Renderer events */
  on: function(channel, fn) {
    var allowed = ['recovery-available', 'window-maximized-changed', 'check-unsaved-before-close', 'open-file-from-argv', 'update-available', 'update-download-progress', 'update-downloaded', 'mcp-invoke', 'smart-search-crashed'];
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
    var allowed = ['recovery-available', 'window-maximized-changed', 'check-unsaved-before-close', 'open-file-from-argv', 'update-available', 'update-download-progress', 'update-downloaded', 'mcp-invoke', 'smart-search-crashed'];
    if (allowed.indexOf(channel) !== -1) {
      ipcRenderer.removeAllListeners(channel);
    }
  }

});
