/* Stand-in for the Electron preload's window.KanvazBridge, for the card-audit
   harness only. Every method the app might call resolves to a harmless "ok"
   value; a few that the UI reads shape-sensitively are given real defaults.
   Nothing here touches disk or network. */
(function() {
  var defaults = {
    getRecent: function() { return Promise.resolve([]); },
    listProfiles: function() { return Promise.resolve({ ok: true, profiles: [{ id: 'default', name: 'Audit', avatar: null }], activeId: 'default' }); },
    getActiveProfile: function() { return Promise.resolve({ id: 'default', name: 'Audit', avatar: null }); },
    readSettings: function() { return Promise.resolve({ ok: true, data: JSON.stringify({ welcomeSeen: true }) }); },
    firstRunCheck: function() { return Promise.resolve({ ok: true, firstRun: false }); },
    scanPlugins: function() { return Promise.resolve({ ok: true, plugins: [] }); },
    listTemplates: function() { return Promise.resolve({ ok: true, templates: [] }); },
    readRecovery: function() { return Promise.resolve({ ok: false }); },
    getPathForFile: function() { return ''; },
    on: function() {}, off: function() {},
    isMaximized: function() { return Promise.resolve(false); },
    getRecentChangelog: function() { return Promise.resolve({ ok: true, entries: [] }); }
  };
  var target = {};
  window.KanvazBridge = new Proxy(target, {
    get: function(t, k) {
      if (k in defaults) return defaults[k];
      if (typeof k !== 'string') return undefined;
      return function() { return Promise.resolve({ ok: true, data: null }); };
    }
  });
  window.__AUDIT_HARNESS__ = true;
})();
