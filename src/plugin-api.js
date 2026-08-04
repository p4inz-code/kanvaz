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
  var pluginThemes = {};
  var activeThemeStyleEl = null;

  /* Audit fix: renderCard() in cards.js checks built-in types (image,
     gif, video, audio, note, color, url, file) BEFORE ever consulting
     the plugin registry, so a plugin registering one of those exact ids
     can't corrupt built-in rendering — but its own render() silently
     becomes unreachable for that type, with no signal to the plugin
     author about why. Warn at registration time instead of leaving them
     to discover it by trial and error. */
  var BUILTIN_CARD_TYPES = { image: true, gif: true, video: true, audio: true, note: true, color: true, url: true, file: true };

  function registerCardType(id, def) {
    if (!id || typeof id !== 'string') {
      console.error('[Kanvaz Plugin] registerCardType requires a string id');
      return;
    }
    if (BUILTIN_CARD_TYPES[id] === true) {
      console.warn('[Kanvaz Plugin] registerCardType("' + id + '") — "' + id + '" is a built-in Kanvaz card type; built-ins always take priority, so this plugin\'s render() will never actually run. Choose a unique id.');
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

  function getAllCardTypeDefs() {
    return Object.keys(pluginCardTypes).map(function(id) {
      var def = pluginCardTypes[id];
      return { id: id, label: def.label || id, icon: def.icon || null, hasCreate: typeof def.create === 'function' };
    });
  }

  function createCard(id, x, y) {
    var def = pluginCardTypes[id];
    if (!def || typeof def.create !== 'function') return null;
    try {
      return def.create(x, y);
    } catch (e) {
      console.error('[Kanvaz Plugin] create() failed for card type "' + id + '":', e.message);
      return null;
    }
  }

  var pluginSettingsPanels = {};

  /* registerSettingsPanel(id, { label, render(container) }) — adds a
     labeled section to the Settings panel; render() gets a plain empty
     <div> to fill in with whatever plain DOM the plugin wants (color
     pickers, buttons, lists — no constraints beyond "it's a div"). */
  function registerSettingsPanel(id, def) {
    if (!id || typeof id !== 'string') {
      console.error('[Kanvaz Plugin] registerSettingsPanel requires a string id');
      return;
    }
    if (!def || typeof def.render !== 'function' || !def.label) {
      console.error('[Kanvaz Plugin] registerSettingsPanel("' + id + '") requires { label, render(container) }');
      return;
    }
    pluginSettingsPanels[id] = def;
  }

  function getAllSettingsPanels() {
    return Object.keys(pluginSettingsPanels).map(function(id) {
      return { id: id, def: pluginSettingsPanels[id] };
    });
  }

  /* registerTheme(id, { name, css }) — css must be a complete
     `:root[data-theme="<id>"] { --color-...: ...; }` block defining
     every variable the built-in dark/light themes define (see
     main.css). Treating a plugin theme as a full peer of dark/light,
     rather than a partial override layered on top of one of them,
     avoids any CSS specificity/cascade-order ambiguity — applyTheme()
     below sets data-theme to the plugin's own id, exactly like
     switching to "dark" or "light" already works. */
  /* Audit fix: 'dark' and 'light' are Kanvaz's own built-in theme ids,
     hardcoded as the first two <option>s in the Settings theme dropdown
     (see ui.js's showSettings()). Nothing previously stopped a plugin
     from registering one of those exact ids too — the dropdown would
     then show two entries both saying "Dark" (or "Light"), and
     applyTheme('dark') would inject the PLUGIN's css for
     data-theme="dark" regardless of which of the two identical-looking
     options the user actually picked, silently overriding the built-in
     theme app-wide. (Ids starting with "__" are deliberately NOT
     rejected here — that prefix is the existing, intentional convention
     for ephemeral live-preview drafts; see getAllThemes() below, which
     already filters them out of anything user-facing.) */
  var RESERVED_THEME_IDS = { dark: true, light: true };

  function registerTheme(id, def) {
    if (!id || typeof id !== 'string') {
      console.error('[Kanvaz Plugin] registerTheme requires a string id');
      return;
    }
    if (RESERVED_THEME_IDS[id] === true) {
      console.error('[Kanvaz Plugin] registerTheme("' + id + '") — "' + id + '" is a reserved built-in theme id, choose a unique one');
      return;
    }
    if (!def || typeof def.css !== 'string' || !def.css || typeof def.name !== 'string' || !def.name) {
      console.error('[Kanvaz Plugin] registerTheme("' + id + '") requires { name, css }');
      return;
    }
    pluginThemes[id] = def;
    document.dispatchEvent(new CustomEvent('kanvaz-theme-registered', { detail: { id: id, name: def.name } }));
  }

  function getAllThemes() {
    /* Ids starting with "__" are treated as internal/ephemeral (e.g. a
       live-preview draft while the user is still adjusting colors) and
       excluded from anything user-facing like the Settings dropdown —
       applyTheme() itself still works on them directly by id. */
    return Object.keys(pluginThemes)
      .filter(function(id) { return id.indexOf('__') !== 0; })
      .map(function(id) { return { id: id, name: pluginThemes[id].name }; });
  }

  /* Swaps the active plugin theme stylesheet (if any) and sets
     data-theme. Called from ui.js's applySettings() instead of a bare
     setAttribute, so a plugin theme and the two built-ins go through
     the exact same code path. themeId of 'dark'/'light'/falsy just
     clears any plugin stylesheet and sets data-theme normally. */
  function applyTheme(themeId) {
    if (activeThemeStyleEl && activeThemeStyleEl.parentNode) {
      activeThemeStyleEl.parentNode.removeChild(activeThemeStyleEl);
      activeThemeStyleEl = null;
    }
    if (themeId && pluginThemes[themeId]) {
      var styleEl = document.createElement('style');
      styleEl.setAttribute('data-plugin-theme', themeId);
      styleEl.textContent = pluginThemes[themeId].css;
      document.head.appendChild(styleEl);
      activeThemeStyleEl = styleEl;
    }
    document.documentElement.setAttribute('data-theme', themeId || 'dark');
  }

  /* Persistent per-plugin storage. A plugin must pass its OWN id as
     the first argument on every call — capture it once, at the top of
     your entry file (top-level, synchronous execution, before any
     async code), via:
       var PLUGIN_ID = document.currentScript.getAttribute('data-plugin-id');
     document.currentScript is only reliably set during a script's own
     initial synchronous run, not later inside callbacks — hence
     capturing it once up front rather than re-reading it on demand. */
  var storage = {
    load: function(pluginId) {
      if (typeof KanvazBridge === 'undefined' || !KanvazBridge.getPluginStorage) {
        return Promise.resolve({});
      }
      return KanvazBridge.getPluginStorage(pluginId).then(function(result) {
        return (result && result.ok) ? result.data : {};
      }).catch(function() { return {}; });
    },
    save: function(pluginId, data) {
      if (typeof KanvazBridge === 'undefined' || !KanvazBridge.setPluginStorage) {
        return Promise.resolve({ ok: false });
      }
      return KanvazBridge.setPluginStorage(pluginId, data);
    }
  };

  return {
    registerCardType: registerCardType,
    registerTheme: registerTheme,
    registerSettingsPanel: registerSettingsPanel,
    storage: storage,
    /* Public — a plugin (e.g. a theme creator/editor) can call this
       directly to preview or switch to any registered theme, including
       a throwaway id it registered itself purely for a live-preview
       draft (see registerTheme's "__"-prefixed-id convention above). */
    applyTheme: applyTheme,
    /* Underscore-prefixed: internal, read by cards.js/ui.js/app.js, not
       part of the documented plugin-facing surface. _applyTheme is
       kept as an alias so existing internal call sites (ui.js) don't
       need to change. */
    _getCardType: getCardType,
    _hasCardType: hasCardType,
    _getAllCardTypeDefs: getAllCardTypeDefs,
    _createCard: createCard,
    _getAllThemes: getAllThemes,
    _applyTheme: applyTheme,
    _getAllSettingsPanels: getAllSettingsPanels
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
