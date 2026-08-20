/* Loaded via KanvazPluginLoader.loadUnpacked() specifically, concurrently
   with plugin-a.js/plugin-b.js loading via the normal loadEnabledPlugins()
   path — see the concurrency check in test/plugin-scope-test.js. Declares
   'server' like plugin-b.js, so if the two independent load chains ever
   interleave without the shared queue serializing them, this plugin could
   end up seeing plugin-a's (or nobody's) scope instead of its own. */
var MY_API = window.KanvazPluginAPI;
window.__log.push({
  id: 'plugin.concurrent-c',
  hasMcpBridge: !!(MY_API && MY_API.mcpBridge),
  hasCardType: typeof MY_API.registerCardType === 'function'
});
