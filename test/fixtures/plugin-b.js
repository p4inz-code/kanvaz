/* Captures its own scoped API at top-level synchronous time — the
   documented convention every real plugin (theme-creator, mcp-bridge)
   follows, same reason document.currentScript-based PLUGIN_ID capture
   exists. */
var MY_API = window.KanvazPluginAPI;
window.__log.push({
  id: 'plugin.with-server',
  hasMcpBridge: !!(MY_API && MY_API.mcpBridge),
  hasCardType: typeof MY_API.registerCardType === 'function'
});

/* Simulates a deferred callback (e.g. a Settings-panel button's click
   handler) using the CAPTURED local reference, exercised after loading
   has moved on to some other state entirely. */
setTimeout(function() {
  window.__deferredCallbackHasMcpBridge = !!(MY_API && MY_API.mcpBridge && typeof MY_API.mcpBridge.start === 'function');
  window.__globalAfterAllLoadedHasMcpBridge = !!(window.KanvazPluginAPI && window.KanvazPluginAPI.mcpBridge);
}, 50);
