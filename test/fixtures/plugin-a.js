/* This plugin declares NO permissions (see plugin-scope-harness.html's
   manifest for 'plugin.no-server'). It also attempts the exact
   self-privilege-escalation bypass an early draft of buildScopedAPI()
   actually shipped with (caught by this test, not by ship): calling
   _buildScopedAPI() on itself with a forged manifest to synthesize a
   scope it was never granted. */
var bypassScope = null;
var bypassThrew = false;
try {
  bypassScope = window.KanvazPluginAPI._buildScopedAPI({ permissions: ['server'] });
} catch (e) {
  bypassThrew = true;
}

window.__log.push({
  id: 'plugin.no-server',
  hasMcpBridge: !!(window.KanvazPluginAPI && window.KanvazPluginAPI.mcpBridge),
  hasCardType: typeof window.KanvazPluginAPI.registerCardType === 'function'
});

window.__bypassAttempt = {
  builderReachable: typeof window.KanvazPluginAPI._buildScopedAPI === 'function',
  threw: bypassThrew,
  forgedScopeHasMcpBridge: !!(bypassScope && bypassScope.mcpBridge)
};
