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
   Layer 1 (4.2.0) shipped registerCardType, registerTheme, and
   registerSettingsPanel. 4.3.0 adds registerCommand, on(event, handler),
   and the read-only Runtime Data API (getCards/getSelected/
   getConnections/getActiveBoard) — see commands.js for the command
   registry + Ctrl+K palette these commands appear in. Property field
   types (registerPropertyFieldType) and the network/fs permissioned
   namespaces are still not implemented — nothing is stubbed as a silent
   no-op, since a half-working method is worse than an honest "not
   available yet". */

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
  /* ── registerCommand (4.3.0) — thin pass-through to KanvazCommands,
     the same registry Kanvaz's own core actions register into (see
     commands.js). A plugin command and a core command are
     indistinguishable once registered — both show up in the Ctrl+K
     palette automatically. */
  function registerCommand(id, def) {
    if (typeof KanvazCommands === 'undefined') {
      console.error('[Kanvaz Plugin] registerCommand is unavailable (KanvazCommands not loaded)');
      return;
    }
    if (!id || typeof id !== 'string') {
      console.error('[Kanvaz Plugin] registerCommand requires a string id');
      return;
    }
    if (!def || typeof def.run !== 'function' || !def.label) {
      console.error('[Kanvaz Plugin] registerCommand("' + id + '") requires { label, run(context) }');
      return;
    }
    KanvazCommands.registerCommand(id, def);
  }

  /* ── Event hooks (4.3.0) — KanvazPluginAPI.on(event, handler).
     cards.js/boards.js call _emit() below at the exact points that
     already trigger an undo-history push (cards.js) or a real board
     load/save (boards.js) — see the comment above emitCardEvent() in
     cards.js for the precise, deliberately scoped list of mutation
     points this covers. Returns an unsubscribe function, same shape as
     a DOM EventTarget convenience wrapper would. */
  var EVENT_NAMES = { cardCreate: true, cardUpdate: true, cardDelete: true, boardLoad: true, boardSave: true, selectionChange: true };
  var eventHandlers = {};

  function on(event, handler) {
    if (!EVENT_NAMES[event]) {
      console.error('[Kanvaz Plugin] on("' + event + '") — unknown event. Valid events: ' + Object.keys(EVENT_NAMES).join(', '));
      return function() {};
    }
    if (typeof handler !== 'function') {
      console.error('[Kanvaz Plugin] on("' + event + '") requires a handler function');
      return function() {};
    }
    if (!eventHandlers[event]) eventHandlers[event] = [];
    eventHandlers[event].push(handler);
    return function off() {
      var arr = eventHandlers[event];
      if (!arr) return;
      var idx = arr.indexOf(handler);
      if (idx !== -1) arr.splice(idx, 1);
    };
  }

  /* Internal — not part of the documented plugin-facing surface (see
     the _-prefix convention already used by _getCardType etc. below).
     Each handler runs isolated in its own try/catch so one broken
     plugin listener can't stop the others, or the core mutation that
     triggered this, from completing. */
  function _emit(event, data) {
    var handlers = eventHandlers[event];
    if (!handlers || !handlers.length) return;
    var snapshot = handlers.slice();
    for (var i = 0; i < snapshot.length; i++) {
      try {
        snapshot[i](data);
      } catch (e) {
        console.error('[Kanvaz Plugin] "' + event + '" handler threw:', e.message);
      }
    }
  }

  /* ── Runtime Data API (4.3.0) — read-only snapshots, not live
     references. A plugin mutating a card object it got back from
     getCards()/getSelected() directly (instead of going through a
     future write API) would silently desync from the real card — no
     re-render, no history push, no persisted change. Returning a clone
     closes that footgun off entirely; see cloneCard()'s own fallback
     for the same non-JSON-safe-pluginData edge case duplicateCardCore()
     in cards.js already guards against. */
  function cloneCard(card) {
    try {
      return JSON.parse(JSON.stringify(card));
    } catch (e) {
      var copy = {};
      for (var k in card) {
        if (Object.prototype.hasOwnProperty.call(card, k)) copy[k] = card[k];
      }
      copy.pluginData = null;
      return copy;
    }
  }

  function getCards() {
    if (typeof KanvazCards === 'undefined') return [];
    var all = KanvazCards.getAll();
    var out = [];
    for (var id in all) {
      if (Object.prototype.hasOwnProperty.call(all, id)) out.push(cloneCard(all[id]));
    }
    return out;
  }

  function getSelected() {
    if (typeof KanvazCards === 'undefined') return [];
    var ids = KanvazCards.getSelectedIds();
    var all = KanvazCards.getAll();
    var out = [];
    for (var i = 0; i < ids.length; i++) {
      if (all[ids[i]]) out.push(cloneCard(all[ids[i]]));
    }
    return out;
  }

  function getConnections() {
    if (typeof KanvazConnections === 'undefined') return [];
    return KanvazConnections.serialise();
  }

  function getActiveBoard() {
    if (typeof KanvazBoards === 'undefined' || !KanvazBoards.getActiveBoardInfo) return null;
    return KanvazBoards.getActiveBoardInfo();
  }

  /* ── Write functions (4.4.0) ──
     Audit fix: updateCardData/setTags/deleteCardImmediate/search were
     added to cards.js for the MCP Bridge official plugin, but only ever
     reachable via the bare KanvazCards global — nowhere on the
     documented KanvazPluginAPI surface, unlike every READ function
     above. A plugin author reading only this file's public methods
     would have no way to discover board-mutation was possible at all.
     These are thin, ungated wrappers (matching getCards/getSelected/
     etc. above — general-purpose Runtime API, not MCP-Bridge-specific,
     and not gated on any permission, same as every other method in
     this file except mcpBridge) that just forward to the real
     cards.js functions, which already do their own id/argument
     validation and console.error on misuse. */
  function updateCard(id, patch) {
    if (typeof KanvazCards === 'undefined') return null;
    return KanvazCards.updateCardData(id, patch);
  }

  function setCardTags(id, tags) {
    if (typeof KanvazCards === 'undefined') return null;
    return KanvazCards.setTags(id, tags);
  }

  function deleteCard(id) {
    if (typeof KanvazCards === 'undefined') return;
    KanvazCards.deleteCardImmediate(id);
  }

  function searchCards(query) {
    if (typeof KanvazCards === 'undefined') return [];
    return KanvazCards.search(query);
  }

  /* ── Card extras (4.5.0) — not reachable through updateCard's patch ──
     flip/duplicate/z-order aren't plain field assignments the way
     pinned/tags/properties are (flipCard toggles an axis, duplicate
     creates a NEW card, z-order is relative "front"/"back" not an
     absolute value) — each keeps its own KanvazCards function and gets
     a thin same-shape wrapper here instead of an awkward patch-object
     encoding. */
  function flipCard(id, axis) {
    if (typeof KanvazCards === 'undefined') return;
    KanvazCards.flipCard(id, axis);
  }

  function duplicateCard(id) {
    if (typeof KanvazCards === 'undefined') return null;
    return KanvazCards.duplicateCard(id);
  }

  function bringCardToFront(id) {
    if (typeof KanvazCards === 'undefined') return;
    KanvazCards.bringToFront(id);
  }

  function sendCardToBack(id) {
    if (typeof KanvazCards === 'undefined') return;
    KanvazCards.sendToBack(id);
  }

  /* ── Board management (4.5.0) ──
     Thin wrappers over boards.js's own by-id functions (see their much
     longer comments there for the actual reasoning — by-id not by-
     index, board deletion's stateless confirm gate, saveBoardToPath
     never popping the native OS dialog). Nothing here is gated on any
     permission — same as every method above except mcpBridge. */
  function createBoard(name) {
    if (typeof KanvazBoards === 'undefined') return null;
    KanvazBoards.newBoard(false, name);
    return KanvazBoards.getActiveBoardInfo();
  }

  function listBoards() {
    if (typeof KanvazBoards === 'undefined' || !KanvazBoards.listBoardsInfo) return [];
    return KanvazBoards.listBoardsInfo();
  }

  function switchBoard(id) {
    if (typeof KanvazBoards === 'undefined' || !KanvazBoards.switchBoardById) return { ok: false, error: 'unavailable in this build' };
    return KanvazBoards.switchBoardById(id);
  }

  function renameBoard(id, name) {
    if (typeof KanvazBoards === 'undefined' || !KanvazBoards.renameBoardById) return { ok: false, error: 'unavailable in this build' };
    return KanvazBoards.renameBoardById(id, name);
  }

  function deleteBoard(id, confirm) {
    if (typeof KanvazBoards === 'undefined' || !KanvazBoards.deleteBoardById) return { ok: false, error: 'unavailable in this build' };
    return KanvazBoards.deleteBoardById(id, confirm);
  }

  function saveBoard(path) {
    if (typeof KanvazBoards === 'undefined' || !KanvazBoards.saveBoardToPath) {
      return Promise.resolve({ ok: false, error: 'unavailable in this build' });
    }
    return KanvazBoards.saveBoardToPath(path);
  }

  /* ── History / view control (4.5.0) — direct pass-throughs, nothing
     to wrap beyond an existence guard; every one of these already does
     its own no-op-when-nothing-to-do handling (e.g. undo() with an
     empty stack). */
  function undo() { if (typeof KanvazHistory !== 'undefined') KanvazHistory.undo(); }
  function redo() { if (typeof KanvazHistory !== 'undefined') KanvazHistory.redo(); }
  function zoomIn() { if (typeof KanvazCanvas !== 'undefined') KanvazCanvas.zoomIn(); }
  function zoomOut() { if (typeof KanvazCanvas !== 'undefined') KanvazCanvas.zoomOut(); }
  function zoomReset() { if (typeof KanvazCanvas !== 'undefined') KanvazCanvas.zoomReset(); }
  function zoomFit() { if (typeof KanvazCanvas !== 'undefined') KanvazCanvas.zoomFit(); }
  function toggleMapView() { if (typeof KanvazMapView !== 'undefined') KanvazMapView.toggle(); }

  /* ── Settings (4.5.0) — everything except plugin management, which
     was never reachable through this path in the first place: plugin
     enable/disable/approval state lives entirely in plugin-state.json,
     a separate main-process-only file `KanvazUI_Extended.updateSettings`
     (ui.js) has no access to and never touches. The exclusion is
     structural, not a checklist this function has to remember. Returns
     a CLONE, not KanvazUI_Extended.getSettings()'s live reference —
     same reasoning as getCards()/getSelected() above: a caller
     mutating the object it got back directly, instead of going through
     updateSettings(), would silently desync from the real settings
     with no persist and no live apply. */
  function getSettings() {
    if (typeof KanvazUI_Extended === 'undefined') return {};
    try {
      return JSON.parse(JSON.stringify(KanvazUI_Extended.getSettings()));
    } catch (e) {
      return {};
    }
  }

  function updateSettings(patch) {
    if (typeof KanvazUI_Extended === 'undefined' || !KanvazUI_Extended.updateSettings) {
      return { ok: false, error: 'unavailable in this build' };
    }
    return KanvazUI_Extended.updateSettings(patch);
  }

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

  /* ── Scoped per-plugin API (4.4.0) ──
     Everything above this point is universally available to every
     plugin regardless of declared permissions — registerCardType/
     registerTheme/registerSettingsPanel/registerCommand/on/the Runtime
     Data API/storage were all already shipped un-gated (4.2.0–4.3.0)
     and changing that now would be a bigger, riskier behavioral change
     than this pass is trying to make (it would, for instance, silently
     break Theme Creator's own registerCommand call unless its manifest
     also declared a "commands" permission it doesn't request today).

     What's new here is narrower and more honest about what it actually
     achieves: PERMISSION-GATED namespaces (currently just `mcpBridge`,
     gated on the 'server' permission — see plugin-loader.js) are
     conditionally present on the object a given plugin's own script
     sees. "Sees" is doing real work in that sentence and deserves the
     same honesty as everywhere else in this file: KanvazPluginLoader
     (below) loads plugins ONE AT A TIME and points the bare
     `window.KanvazPluginAPI` global at a scope built specifically for
     whichever plugin's <script> tag is currently executing — but that
     binding is only guaranteed correct DURING that plugin's own
     synchronous top-level execution (the documented "runs top-level and
     registers itself synchronously" convention every plugin already
     follows for the exact same reason `document.currentScript` is only
     reliable then — see storage's PLUGIN_ID convention above). A plugin
     that wants to use a gated namespace later (e.g. inside a Settings-
     panel button's click handler) must capture it into a local variable
     at the top of its entry file, same as PLUGIN_ID — re-reading the
     bare `KanvazPluginAPI` global from inside a deferred callback will
     see whatever plugin loaded most recently, not necessarily its own
     scope, once loading has moved on. This closes the specific honesty
     gap the 4.4.0 roadmap flagged (a gated namespace is now genuinely
     ABSENT, not just undocumented, from what a plugin sees at
     registration time) without claiming the full per-process isolation
     that was explicitly declined for this stretch (see SECURITY.md) —
     a plugin's script still shares the renderer's page context and can,
     if it goes looking, reach `window.KanvazBridge` or another global
     directly. Convention-based, disclosed, not hidden — same trust
     model as everything else in this file. */
  var GATED_NAMESPACES = {
    server: function(scoped) { scoped.mcpBridge = mcpBridge; }
  };

  /* Audit fix (caught before ship, not after): buildScopedAPI() used to
     copy EVERY key of fullAPI into the object handed to a plugin,
     including `_buildScopedAPI` itself — fullAPI._buildScopedAPI IS this
     very function. Any plugin, regardless of its own declared
     permissions, could therefore call
     `KanvazPluginAPI._buildScopedAPI({permissions:['server']})` on
     itself and get back a fully-privileged scope with `mcpBridge`
     attached, completely defeating the gate this whole mechanism exists
     to enforce — the builder was trusting whatever `manifest` object the
     CALLER handed it, not anything actually recorded about that caller.
     `_buildScopedAPI` (and anything else a plugin could use to re-
     derive a privileged scope for itself) must never appear in a scoped
     copy — it's for KanvazPluginLoader's own internal use only, via the
     `baseAPI` reference it captures once at its own module-init time,
     never via a scope a plugin's script can see. */
  var NEVER_SCOPED = { _buildScopedAPI: true };

  function buildScopedAPI(manifest) {
    var scoped = {};
    for (var key in fullAPI) {
      if (!Object.prototype.hasOwnProperty.call(fullAPI, key)) continue;
      if (NEVER_SCOPED[key]) continue;
      scoped[key] = fullAPI[key];
    }
    var permissions = (manifest && manifest.permissions) || [];
    for (var i = 0; i < permissions.length; i++) {
      var grant = GATED_NAMESPACES[permissions[i]];
      if (grant) grant(scoped);
    }
    return scoped;
  }

  /* ── mcpBridge namespace (4.4.0) — only reachable by a plugin that
     declared the 'server' permission (see buildScopedAPI above). Thin
     wrapper over KanvazBridge's own mcp-bridge-* IPC methods; the REAL
     gate is main-process-side (main.js's mcp-bridge-start handler
     re-verifies this plugin is actually approved+enabled with 'server'
     before opening anything — never trusts the renderer's say-so alone,
     same pattern as every other plugin IPC handler). */
  var mcpBridge = {
    start: function() {
      if (typeof KanvazBridge === 'undefined' || !KanvazBridge.startMcpBridge) {
        return Promise.resolve({ ok: false, error: 'MCP Bridge is unavailable in this build' });
      }
      return KanvazBridge.startMcpBridge();
    },
    stop: function() {
      if (typeof KanvazBridge === 'undefined' || !KanvazBridge.stopMcpBridge) {
        return Promise.resolve({ ok: false, error: 'MCP Bridge is unavailable in this build' });
      }
      return KanvazBridge.stopMcpBridge();
    },
    /* Registers the function that answers every incoming tool call —
       see official-plugins/mcp-bridge/main.js for the real handler.
       Only one handler at a time; registering a new one replaces the
       last (a plugin toggling MCP Bridge off/on, or re-registering via
       "Load unpacked plugin" dev-mode reload, must never end up with
       two competing handlers each answering — and each REPLYING to —
       the same incoming request).
       Audit fix (caught before ship): this used to just call
       KanvazBridge.on(...), which ADDS a listener — ipcRenderer.on does
       not dedupe. The comment above already claimed "replaces the
       last"; the code didn't. KanvazBridge.off('mcp-invoke') first
       (removeAllListeners on that channel — safe, since nothing else in
       Kanvaz core or any other plugin listens on it) makes that true. */
    onInvoke: function(handler) {
      if (typeof KanvazBridge === 'undefined' || !KanvazBridge.on) return function() {};
      if (KanvazBridge.off) KanvazBridge.off('mcp-invoke');
      KanvazBridge.on('mcp-invoke', function(payload) {
        Promise.resolve()
          .then(function() { return handler(payload.method, payload.args); })
          .then(function(result) {
            KanvazBridge.mcpInvokeResult({ requestId: payload.requestId, result: result });
          })
          .catch(function(e) {
            KanvazBridge.mcpInvokeResult({ requestId: payload.requestId, error: (e && e.message) || String(e) });
          });
      });
      return function off() { if (KanvazBridge.off) KanvazBridge.off('mcp-invoke'); };
    }
  };

  var fullAPI = {
    registerCardType: registerCardType,
    registerTheme: registerTheme,
    registerSettingsPanel: registerSettingsPanel,
    registerCommand: registerCommand,
    on: on,
    getCards: getCards,
    getSelected: getSelected,
    getConnections: getConnections,
    getActiveBoard: getActiveBoard,
    updateCard: updateCard,
    setCardTags: setCardTags,
    deleteCard: deleteCard,
    searchCards: searchCards,
    flipCard: flipCard,
    duplicateCard: duplicateCard,
    bringCardToFront: bringCardToFront,
    sendCardToBack: sendCardToBack,
    createBoard: createBoard,
    listBoards: listBoards,
    switchBoard: switchBoard,
    renameBoard: renameBoard,
    deleteBoard: deleteBoard,
    saveBoard: saveBoard,
    undo: undo,
    redo: redo,
    zoomIn: zoomIn,
    zoomOut: zoomOut,
    zoomReset: zoomReset,
    zoomFit: zoomFit,
    toggleMapView: toggleMapView,
    getSettings: getSettings,
    updateSettings: updateSettings,
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
    _getAllSettingsPanels: getAllSettingsPanels,
    _emit: _emit,
    _buildScopedAPI: buildScopedAPI
  };

  return fullAPI;
})();

window.KanvazPluginAPI = KanvazPluginAPI;

var KanvazPluginLoader = (function() {

  var loadedIds = {};
  var lastScanResult = [];

  /* The TRUE, never-scoped API object — captured once, right now,
     before any plugin has had a chance to load. This is NOT the same
     as writing `KanvazPluginAPI` everywhere below and hoping it stays
     put: `var KanvazPluginAPI = ...` at this file's top level is a
     plain script (not a module), so that binding IS window.
     KanvazPluginAPI — the bare identifier and the window property are
     one and the same storage slot, not two independent references to
     it. The very first version of this scope-swap mechanism used the
     bare identifier for the "restore the full API" step and silently
     restored whichever plugin's SCOPED object happened to be sitting
     in that slot at the time instead of the real base object — caught
     by a headless-Chromium test asserting the resting global actually
     lacked a gated namespace after loading finished. baseAPI below is
     a plain local variable in THIS closure, never itself the target of
     a `window.KanvazPluginAPI = ...` assignment, so it can't suffer
     the same aliasing. */
  var baseAPI = window.KanvazPluginAPI;

  /* Per-plugin scope injection timeout — a defensive backstop only.
     Loading is now SEQUENTIAL (see loadEnabledPlugins below): each
     plugin's <script> tag must finish (onload OR onerror) before the
     next one is injected, so window.KanvazPluginAPI reliably points at
     the scope built for whichever plugin is currently executing. If a
     script somehow never fires either event, this timeout moves on
     anyway rather than blocking every plugin after it from ever loading. */
  var INJECT_TIMEOUT_MS = 5000;

  /* Audit fix (caught before ship): loadEnabledPlugins() and
     loadUnpacked() each built their OWN independent promise chain
     around the window.KanvazPluginAPI scope-swap, with no coordination
     between them — there is exactly ONE window.KanvazPluginAPI slot,
     and nothing stopped, say, a Settings-panel "Load unpacked plugin"
     click from swapping the scope mid-way through startup's
     loadEnabledPlugins() chain still being in flight for a DIFFERENT
     plugin, corrupting which scope that other plugin's script actually
     saw. All scope-swapping operations now funnel through this single
     shared queue — enqueue() — so at most one is ever touching
     window.KanvazPluginAPI at a time, regardless of which of the two
     public entry points below triggered it or how many times either is
     called concurrently. */
  var loadQueue = Promise.resolve();

  function enqueue(work) {
    var result = loadQueue.then(work, work);
    /* Keep the queue alive even if `work` rejects — swallow the error
       for the QUEUE's sake only; `result` (returned to the actual
       caller below) still carries the real rejection. */
    loadQueue = result.then(function() {}, function() {});
    return result;
  }

  /* Returns a Promise that resolves once this one plugin's script has
     either loaded or failed to. Swaps window.KanvazPluginAPI to a scope
     built specifically for this plugin's declared permissions
     immediately before injecting — see buildScopedAPI()'s big comment
     above for exactly what that does and doesn't guarantee. */
  function injectPlugin(plugin) {
    if (loadedIds[plugin.manifest.id]) return Promise.resolve();
    loadedIds[plugin.manifest.id] = true;

    window.KanvazPluginAPI = baseAPI._buildScopedAPI(plugin.manifest);

    return new Promise(function(resolve) {
      var done = false;
      function finish() {
        if (done) return;
        done = true;
        resolve();
      }

      var script = document.createElement('script');
      script.setAttribute('data-plugin-id', plugin.manifest.id);
      script.src = plugin.entryUrl;
      script.onload = finish;
      script.onerror = function() {
        console.error('[Kanvaz Plugin] Failed to load "' + plugin.manifest.name + '" from ' + plugin.entryUrl);
        finish();
      };
      document.body.appendChild(script);
      setTimeout(finish, INJECT_TIMEOUT_MS);
    });
  }

  /* Chains each plugin's injectPlugin() one after another (not
     Promise.all — that would go back to injecting everything at once,
     defeating the whole point of the scope swap above) so plugin B
     never starts loading while plugin A's scoped window.KanvazPluginAPI
     is still the active one. Restores the full, ungated API as the
     resting global state once every plugin has finished, exactly as
     before this change — Kanvaz's own core code (ui.js/cards.js calling
     KanvazPluginAPI._getAllCardTypeDefs() etc.) never sees a scoped
     view, only a plugin's own script does, and only while it's loading. */
  function loadEnabledPlugins() {
    return enqueue(function() {
      if (typeof KanvazBridge === 'undefined' || !KanvazBridge.scanPlugins) {
        return Promise.resolve({ ok: false, plugins: [] });
      }
      return KanvazBridge.scanPlugins().then(function(result) {
        if (!result || !result.ok) return result;
        lastScanResult = result.plugins || [];
        var toLoad = lastScanResult.filter(function(p) { return p.valid && p.enabled && !p.needsConsent; });

        var chain = Promise.resolve();
        for (var i = 0; i < toLoad.length; i++) {
          (function(p) {
            chain = chain.then(function() { return injectPlugin(p); });
          })(toLoad[i]);
        }
        return chain.then(function() {
          window.KanvazPluginAPI = baseAPI;
          return result;
        });
      }).catch(function(e) {
        console.error('[Kanvaz Plugin] loadEnabledPlugins failed:', e.message);
        window.KanvazPluginAPI = baseAPI;
        return { ok: false, plugins: [] };
      });
    });
  }

  /* ── "Load unpacked plugin" dev workflow (4.4.0) ──
     Settings -> Developer. Bypasses BOTH the real plugins directory and
     the consent dialog on purpose (main.js's plugins-load-unpacked
     handler does the same manifest validation every real plugin goes
     through, just skips scanPlugins()'s directory-listing and the
     native approval dialog) — this is a developer opting into running
     their own in-progress code, the same trust level as opening a
     terminal, not something an ordinary install flow should ever do.
     Re-running this (e.g. after editing the plugin's own files) always
     re-injects — deletes any prior loadedIds entry for this exact id
     first — which is what makes clicking the button again after an
     edit work as a lightweight "reload this plugin" without needing a
     separate hot-reload-everything mechanism. */
  function loadUnpacked() {
    if (typeof KanvazBridge === 'undefined' || !KanvazBridge.loadUnpackedPlugin) {
      return Promise.resolve({ ok: false, error: 'unavailable in this build' });
    }
    /* The native folder-picker dialog itself runs OUTSIDE the queue —
       there's no scope-swapping happening yet, and queuing it would
       block every other pending plugin-load operation on however long
       the user takes to pick a folder or cancel. Only the actual
       injection (from here through the restore) needs the shared queue
       from enqueue() above, for the same reason loadEnabledPlugins()
       does. */
    return KanvazBridge.loadUnpackedPlugin().then(function(result) {
      if (!result || !result.ok || result.cancelled) return result;
      return enqueue(function() {
        delete loadedIds[result.manifest.id];
        return injectPlugin({ manifest: result.manifest, entryUrl: result.entryUrl }).then(function() {
          /* One-off injection outside the normal sequential startup
             chain — restore the full, ungated API as the resting global
             state immediately after, same as loadEnabledPlugins() does
             once ITS chain finishes. */
          window.KanvazPluginAPI = baseAPI;
          return result;
        });
      });
    });
  }

  return {
    loadEnabledPlugins: loadEnabledPlugins,
    loadUnpacked: loadUnpacked,
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
