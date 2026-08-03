/* plugin-api.js — Kanvaz plugin runtime API + loader (renderer)

   window.KanvazPluginAPI is the ONLY intended surface a plugin's own
   script should call. window.KanvazPluginLoader scans for installed
   plugins via the main process and injects each enabled, already-
   approved one as a real <script src="file://..."> tag (allowed by the
   4.2.0 CSP change — see index.html), so a plugin's code runs as a
   normal loaded script, not injected/eval'd text.

   Sandbox model: convention-based, not iframe/worker-isolated. A
   plugin's script executes in this same page context — same trust
   model as VS Code extensions, not Figma's iframe-sandboxed model. This
   is a disclosed, deliberate v1 trade-off: registerCardType() is the
   intended surface, and any future permissioned API (network,
   filesystem) will exist on this object only if the plugin declared and
   the user approved that permission — but nothing here physically
   prevents a plugin's script from reaching other page globals directly.
   Layer 1 ships exactly one real method: registerCardType. Commands,
   property field types, and events are not implemented yet — nothing is
   stubbed as a silent no-op, since a half-working method is worse than
   an honest "not available yet". */

var KanvazPluginAPI = (function() {

  var pluginCardTypes = {};

  function registerCardType(id, def) {
    if (!id || typeof id !== 'string') {
      console.error('[Kanvaz Plugin] registerCardType requires a string id');
      return;
    }
    if (!def || typeof def.render !== 'function') {
      console.error('[Kanvaz Plugin] registerCardType("' + id + '") requires at least a render(el, card) function');
      return;
    }
    if (pluginCardTypes[id]) {
      console.warn('[Kanvaz Plugin] card type "' + id + '" was already registered — overwriting');
    }
    pluginCardTypes[id] = def;
  }

  function getCardType(id) {
    return pluginCardTypes[id];
  }

  function hasCardType(id) {
    return !!pluginCardTypes[id];
  }

  return {
    registerCardType: registerCardType,
    /* Underscore-prefixed: internal, read by cards.js, not part of the
       documented plugin-facing surface. */
    _getCardType: getCardType,
    _hasCardType: hasCardType
  };
})();

window.KanvazPluginAPI = KanvazPluginAPI;

var KanvazPluginLoader = (function() {

  var loadedIds = {};
  var lastScanResult = [];

  function injectPlugin(plugin) {
    if (loadedIds[plugin.manifest.id]) return;
    var script = document.createElement('script');
    script.setAttribute('data-plugin-id', plugin.manifest.id);
    script.src = plugin.entryUrl;
    script.onerror = function() {
      console.error('[Kanvaz Plugin] Failed to load "' + plugin.manifest.name + '" from ' + plugin.entryUrl);
    };
    document.body.appendChild(script);
    loadedIds[plugin.manifest.id] = true;
  }

  function loadEnabledPlugins() {
    if (typeof KanvazBridge === 'undefined' || !KanvazBridge.scanPlugins) {
      return Promise.resolve({ ok: false, plugins: [] });
    }
    return KanvazBridge.scanPlugins().then(function(result) {
      if (!result || !result.ok) return result;
      lastScanResult = result.plugins || [];
      for (var i = 0; i < lastScanResult.length; i++) {
        var p = lastScanResult[i];
        if (p.valid && p.enabled && !p.needsConsent) {
          injectPlugin(p);
        }
      }
      return result;
    }).catch(function(e) {
      console.error('[Kanvaz Plugin] loadEnabledPlugins failed:', e.message);
      return { ok: false, plugins: [] };
    });
  }

  return {
    loadEnabledPlugins: loadEnabledPlugins,
    isLoaded: function(id) { return !!loadedIds[id]; },
    getLastScanResult: function() { return lastScanResult; }
  };
})();

window.KanvazPluginLoader = KanvazPluginLoader;

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', function() {
    KanvazPluginLoader.loadEnabledPlugins();
  });
} else {
  KanvazPluginLoader.loadEnabledPlugins();
}
