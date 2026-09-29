/* MCP Bridge — an official Kanvaz plugin (4.4.0, expanded 4.5.0)

   Exposes almost the whole app to any MCP-compatible AI client (Claude
   Desktop, Claude Code, etc.) via a local-only named pipe / Unix socket
   that Kanvaz's main process listens on (see src/main.js's mcp-bridge-*
   IPC handlers) — this file is the renderer-side half: it registers the
   Settings toggle and the actual tool-call handler that answers every
   request with real data by calling the exact same KanvazPluginAPI/
   KanvazCards/KanvazConnections functions the UI itself uses, so every
   AI-driven change lands in undo history exactly like a manual edit
   wherever undo applies at all (board-level actions — create/switch/
   rename/delete/save a board — are NOT undo-tracked the way card edits
   are; see boards.js's own comments on deleteBoardById for why board
   deletion specifically requires an explicit confirm step as a result).

   4.5.0 widened the surface from "read/write cards" to nearly the full
   app, deliberately excluding ONE thing: plugin management (install/
   enable/disable/remove a plugin, Browse Official Plugins, Load
   unpacked plugin). That's not a checklist exclusion — plugin
   enable/disable state lives entirely in plugin-state.json, a separate
   main-process-only file nothing in KanvazPluginAPI ever touches, so
   there was never a path from this plugin's tool calls to that file in
   the first place.

   v7.x adds shared-cards-across-boards (shareCardToBoard/unlinkSharedCard,
   thin pass-throughs to the KanvazPluginAPI wrappers added specifically
   for this). updateSettings' schema (server.js) was also corrected —
   `topModeAutoOnTop` was removed from Kanvaz itself in v6.0.0 (Top Mode
   no longer exists) but the schema here still offered it as a no-op
   field until now; `windowOpacity`/`smartSearchEnabled` were added since
   they're real, current settings that were simply never added when they
   shipped.

   Requests a single permission: "server" (run a local listener). See
   README.md in this folder for the Claude Desktop / Claude Code setup
   steps and the standalone server.js this plugin ships alongside — that
   script is a plain Node process spawned BY the AI client, not by
   Kanvaz, and is what actually speaks the MCP protocol; this file only
   answers the tool calls it forwards in. */

(function() {

  /* document.currentScript is only reliable during a script's own
     initial synchronous run — capture both the plugin id AND this
     plugin's own scoped KanvazPluginAPI view right now, at the top,
     before any async callback (button click, storage.load().then, ...)
     could run and find window.KanvazPluginAPI pointing at some OTHER
     plugin's scope instead (see plugin-api.js's big comment on
     buildScopedAPI() for exactly why). Every later reference in this
     file goes through this local MCP_API, never the bare global. */
  var PLUGIN_ID = document.currentScript ? document.currentScript.getAttribute('data-plugin-id') : 'studio.northbyte.mcp-bridge';
  var MCP_API = window.KanvazPluginAPI;

  var running = false;
  var lastError = null;
  var statusRenderers = [];

  function notifyStatus() {
    for (var sri = 0; sri < statusRenderers.length; sri++) statusRenderers[sri]();
  }

  /* ── Card sanitization for anything crossing the bridge ──
     A card's dataUrl is a base64 blob that can be several MB for a
     large image/video — echoing that back as an MCP tool result would
     dump megabytes of base64 into the AI client's context for no
     reason (it can't do anything useful with inline pixel data it
     didn't ask to see). Replaced with a plain boolean. pluginData is
     arbitrary and plugin-owned — not meaningful to an external tool,
     dropped entirely rather than serialized blind. */
  function sanitizeCard(card) {
    if (!card) return null;
    var out = {};
    for (var k in card) {
      if (!Object.prototype.hasOwnProperty.call(card, k)) continue;
      if (k === 'dataUrl') { out.hasMedia = !!card.dataUrl; continue; }
      if (k === 'pluginData') continue;
      if (k === 'annotations') { out.annotationCount = (card.annotations || []).length; continue; }
      out[k] = card[k];
    }
    return out;
  }

  /* Simple cascade so a burst of AI-created cards with no explicit x/y
     don't all land in exactly the same spot — same spirit as
     duplicateCardCore()'s +20/+20 offset in cards.js, just applied at
     creation time instead of duplication time. */
  var dropCursor = { x: 120, y: 120 };
  function nextDropPos(args) {
    var x = typeof args.x === 'number' ? args.x : dropCursor.x;
    var y = typeof args.y === 'number' ? args.y : dropCursor.y;
    if (args.x === undefined && args.y === undefined) {
      dropCursor.x += 32;
      dropCursor.y += 32;
    }
    return { x: x, y: y };
  }

  /* ── Tool implementations ──
     Reads and most writes (update/tag/delete/search) go through
     MCP_API's own documented wrappers. Card CREATION and connectCards
     still call KanvazCards/KanvazConnections directly — those globals
     are reachable in this same-page-context sandbox regardless (see
     plugin-api.js's header comment), and KanvazPluginAPI has no
     generic "createCard"/connection-creation wrapper of its own to
     route through (each concrete card type has its own create
     function, and only registerCardType-registered plugin card types
     get a uniform creation path). Either way, calling the real
     KanvazCards/KanvazConnections functions — directly or via a thin
     KanvazPluginAPI wrapper over the same function — is exactly what
     makes "every AI-driven change lands in undo history like a manual
     edit" true for free: those functions already push undo history and
     mark the board dirty themselves. */

  function listCards(filters) {
    var all = MCP_API.getCards();
    filters = filters || {};
    if (filters.type) all = all.filter(function(c) { return c.type === filters.type; });
    if (filters.tag) all = all.filter(function(c) { return c.tags && c.tags.indexOf(filters.tag) !== -1; });
    return all.map(sanitizeCard);
  }

  function getCard(id) {
    var found = MCP_API.getCards().filter(function(c) { return c.id === id; })[0];
    return found ? sanitizeCard(found) : null;
  }

  function createCard(args) {
    if (typeof KanvazCards === 'undefined') throw new Error('Kanvaz card engine unavailable');
    var pos = nextDropPos(args);
    var data = args.data || {};
    var card;

    if (args.type === 'note') {
      card = KanvazCards.createNote(pos.x, pos.y);
      if (data.text !== undefined) card = MCP_API.updateCard(card.id, { text: data.text });
    } else if (args.type === 'text') {
      card = KanvazCards.createTextCard(pos.x, pos.y);
      if (data.text !== undefined) card = MCP_API.updateCard(card.id, { text: data.text });
    } else if (args.type === 'color') {
      card = KanvazCards.createColorCard(pos.x, pos.y, data.color);
    } else if (args.type === 'url') {
      card = KanvazCards.createUrlCard(pos.x, pos.y);
      if (data.url !== undefined) card = MCP_API.updateCard(card.id, { url: data.url });
    } else if (args.type === 'file') {
      if (!data.path) throw new Error('createCard type "file" requires data.path');
      card = KanvazCards.createFileRefCardAtPath(pos.x, pos.y, data.path);
    } else {
      throw new Error('unsupported type "' + args.type + '" for createCard — use "note"/"text"/"color"/"url"/"file", or addReference for an image/video/audio file or a URL card in one step');
    }

    if (!card) throw new Error('failed to create card');
    if (data.tags) card = MCP_API.setCardTags(card.id, data.tags) || card;
    return sanitizeCard(card);
  }

  /* From here down, everything goes through KanvazPluginAPI's own
     documented wrappers (added alongside these — see plugin-api.js)
     rather than reaching around to the bare KanvazCards global, even
     though both reach the exact same underlying functions in this
     same-page-context sandbox. Demonstrating the documented surface in
     the reference implementation, not just the create* paths above
     (which have no KanvazPluginAPI equivalent to route through). */
  function updateCard(id, patch) {
    var card = MCP_API.updateCard(id, patch || {});
    if (!card) throw new Error('card not found: ' + id);
    return sanitizeCard(card);
  }

  function deleteCard(id) {
    var existed = MCP_API.getCards().some(function(c) { return c.id === id; });
    if (!existed) return { ok: true, deleted: false };
    MCP_API.deleteCard(id);
    return { ok: true, deleted: true };
  }

  function tagCard(id, tags) {
    var card = MCP_API.setCardTags(id, tags || []);
    if (!card) throw new Error('card not found: ' + id);
    return sanitizeCard(card);
  }

  function search(query) {
    return (MCP_API.searchCards(query) || []).map(sanitizeCard);
  }

  function connectCards(fromId, toId, type) {
    if (typeof KanvazConnections === 'undefined') throw new Error('Connections module unavailable');
    /* 9.5.2: max 8 connections per node either direction — same cap the
       UI itself enforces (map-view.js's drag-to-wire, inspector.js's
       Add Connection dialog). Checked here too so an AI-driven call
       can't bypass it just because it doesn't go through either of
       those two UI entry points. */
    if (KanvazConnections.canAddConnection && !KanvazConnections.canAddConnection(fromId, toId)) {
      throw new Error('one of these cards already has ' + (KanvazConnections.MAX_CONNECTIONS_PER_NODE || 8) + ' connections — the max per card');
    }
    var conn = KanvazConnections.create(fromId, toId, type);
    if (!conn) throw new Error('could not create connection — check that fromId/toId are real, distinct card ids');
    return conn;
  }

  /* 9.7.0 — connectCards had no counterpart: a tool could create a
     connection but never remove one, so undoing a bad wire meant asking
     the user to do it by hand in the UI. Same direct-module-call
     precedent as connectCards above. */
  function removeConnection(connId) {
    if (typeof KanvazConnections === 'undefined') throw new Error('Connections module unavailable');
    KanvazConnections.remove(connId);
    return { ok: true };
  }

  /* 9.7.0 — group/align/distribute/tidy: real, everyday board-organizing
     operations the UI's own Properties panel exposes (multi-select ->
     Align/Distribute Evenly/Tidy Up), previously reachable by a human
     but not by an AI client at all. Same "call KanvazCards directly"
     pattern as everything else in this file — no KanvazPluginAPI wrapper
     needed, this sandbox already has it in scope. */
  function requireCards() {
    if (typeof KanvazCards === 'undefined') throw new Error('Cards module unavailable');
    return KanvazCards;
  }
  function groupCards(ids) {
    if (!Array.isArray(ids) || ids.length < 2) throw new Error('groupCards needs at least 2 card ids');
    requireCards().groupCards(ids);
    return { ok: true };
  }
  function ungroupCards(ids) {
    if (!Array.isArray(ids) || !ids.length) throw new Error('ungroupCards needs at least 1 card id');
    requireCards().ungroupCards(ids);
    return { ok: true };
  }
  function alignCards(ids, mode) {
    if (!Array.isArray(ids) || ids.length < 2) throw new Error('alignCards needs at least 2 card ids');
    requireCards().alignCards(ids, mode);
    return { ok: true };
  }
  function distributeCards(ids, axis) {
    if (!Array.isArray(ids) || ids.length < 3) throw new Error('distributeCards needs at least 3 card ids (nothing to distribute with fewer)');
    requireCards().distributeCards(ids, axis);
    return { ok: true };
  }
  function tidyUp(ids) {
    if (!Array.isArray(ids) || !ids.length) throw new Error('tidyUp needs at least 1 card id');
    requireCards().tidyUp(ids);
    return { ok: true };
  }

  /* ── Task Tracker (9.5.2) ── Same "call the real module directly"
     precedent connectCards already set above — KanvazTaskTracker has no
     KanvazPluginAPI wrapper of its own (nothing else needed one before
     this), and this same-page-context sandbox can already reach it
     directly, exactly like KanvazCards/KanvazConnections. Every write
     already marks the board dirty on its own (see task-tracker.js);
     nothing extra needed here for that. */
  function requireTaskTracker() {
    if (typeof KanvazTaskTracker === 'undefined') throw new Error('Task Tracker is unavailable in this build of Kanvaz');
    return KanvazTaskTracker;
  }

  function listTasks() {
    return requireTaskTracker().getAll();
  }

  function addTask(text) {
    var t = requireTaskTracker().addTask(text);
    if (!t) throw new Error('addTask requires a non-empty "text"');
    return t;
  }

  function deleteTask(id) {
    var ok = requireTaskTracker().removeTask(id);
    return { ok: ok };
  }

  function toggleTask(id) {
    var T = requireTaskTracker();
    var ok = T.toggleTask(id);
    var task = T.getTask(id);
    if (!task) throw new Error('task not found: ' + id);
    if (!ok && task.subtasks.length) throw new Error('this task has subtasks — its done state is derived from them, not directly toggleable (see toggleSubtask)');
    return task;
  }

  function addSubtask(taskId, text) {
    var T = requireTaskTracker();
    var st = T.addSubtask(taskId, text);
    if (!st) throw new Error('addSubtask requires a real taskId, non-empty "text", and fewer than ' + T.MAX_SUBTASKS + ' existing subtasks');
    return T.getTask(taskId);
  }

  function toggleSubtask(taskId, subId) {
    var T = requireTaskTracker();
    T.toggleSubtask(taskId, subId);
    var task = T.getTask(taskId);
    if (!task) throw new Error('task not found: ' + taskId);
    return task;
  }

  function deleteSubtask(taskId, subId) {
    var ok = requireTaskTracker().removeSubtask(taskId, subId);
    return { ok: ok };
  }

  function setTaskCardLink(taskId, cardId) {
    var T = requireTaskTracker();
    T.setCardLink(taskId, cardId || null);
    var task = T.getTask(taskId);
    if (!task) throw new Error('task not found: ' + taskId);
    return task;
  }

  /* Loads a file from disk (image/video/audio -> a real media card,
     same path createFromMedia() always takes) or falls back to a plain
     file-reference card for anything KanvazMedia doesn't recognize as
     embeddable media — mirrors exactly what dropping that same file
     onto the canvas by hand would do. */
  function addReference(args) {
    var pos = nextDropPos(args);

    if (args.url) {
      var urlCard = KanvazCards.createUrlCard(pos.x, pos.y);
      urlCard = MCP_API.updateCard(urlCard.id, { url: args.url });
      return Promise.resolve(sanitizeCard(urlCard));
    }

    if (!args.path) throw new Error('addReference requires either "path" or "url"');
    if (typeof KanvazMedia === 'undefined') throw new Error('Media loader unavailable');

    return new Promise(function(resolve, reject) {
      KanvazMedia.loadFromPath(args.path, function(result, err) {
        if (result) {
          resolve(sanitizeCard(KanvazCards.createFromMedia(result, pos)));
          return;
        }
        /* Audit fix: this used to only fall back to a plain file-
           reference card for the exact literal 'FILE_TYPE_INVALID' or
           'FILE_NOT_FOUND'. Only the first ever actually occurs on this
           path — loadFromPath() (media.js) forwards whatever main.js's
           media-load IPC handler returns, and that handler's "file
           doesn't exist" case is a raw Node fs error (e.g.
           "ENOENT: no such file or directory, stat '...'"), never the
           literal string 'FILE_NOT_FOUND' (that string is only ever
           produced by the unrelated drag-and-drop loadFromFile() path,
           which addReference never calls). So a missing file always hit
           the reject() below instead of the documented "anything else
           becomes a file-reference card" fallback. Broadened to fall
           back for anything except a genuine IPC-layer failure — a
           missing/oversized/unsupported file all reasonably become an
           inert file-reference card (same as any other file-ref card,
           it just won't resolve until the path exists again), matching
           what this tool's own docs already promise. */
        if (err !== 'IPC_FAIL') {
          var fileCard = KanvazCards.createFileRefCardAtPath(pos.x, pos.y, args.path);
          if (fileCard) { resolve(sanitizeCard(fileCard)); return; }
        }
        reject(new Error(err || 'failed to add reference for path: ' + args.path));
      });
    });
  }

  /* ── Shared cards across boards (v6.4.0/v6.5.0) ──
     Thin pass-throughs to KanvazPluginAPI's own wrappers (added
     specifically so plugins like this one could reach them) — no
     sanitizeCard() needed, these already return the same {ok, ...}
     shape shareCardToBoard()/unlinkSharedCard() define in cards.js. */
  function shareCardToBoard(id, targetBoardId) {
    if (!MCP_API.shareCardToBoard) throw new Error('shared cards are unavailable in this build of Kanvaz');
    if (!targetBoardId) throw new Error('shareCardToBoard requires targetBoardId — call listBoards first to find one');
    return MCP_API.shareCardToBoard(id, targetBoardId);
  }

  function unlinkSharedCard(id) {
    if (!MCP_API.unlinkSharedCard) throw new Error('shared cards are unavailable in this build of Kanvaz');
    /* Audit fix: this used to report {ok:true} unconditionally — Kanvaz's
       own unlinkSharedCard() now returns a real boolean (a bad id or a
       card that was never shared is a no-op), so forward that instead of
       lying about success on a call that did nothing. */
    var didUnlink = MCP_API.unlinkSharedCard(id);
    return didUnlink ? { ok: true } : { ok: false, error: 'card not found or not currently shared' };
  }

  function handleInvoke(method, args) {
    args = args || {};
    switch (method) {
      case 'getActiveBoard':  return MCP_API.getActiveBoard();
      case 'listCards':       return listCards(args.filters);
      case 'getCard':         return getCard(args.id);
      case 'createCard':      return createCard(args);
      case 'updateCard':      return updateCard(args.id, args.patch);
      case 'deleteCard':      return deleteCard(args.id);
      case 'addReference':    return addReference(args);
      case 'tagCard':         return tagCard(args.id, args.tags);
      case 'search':          return search(args.query);
      case 'getConnections':   return MCP_API.getConnections();
      case 'connectCards':     return connectCards(args.fromId, args.toId, args.type);
      case 'removeConnection': return removeConnection(args.id);

      /* Group / align / distribute / tidy (9.7.0) */
      case 'groupCards':       return groupCards(args.ids);
      case 'ungroupCards':     return ungroupCards(args.ids);
      case 'alignCards':       return alignCards(args.ids, args.mode);
      case 'distributeCards':  return distributeCards(args.ids, args.axis);
      case 'tidyUp':           return tidyUp(args.ids);

      /* Card extras (4.5.0) */
      case 'flipCard':          MCP_API.flipCard(args.id, args.axis); return { ok: true };
      case 'duplicateCard':     return sanitizeCard(MCP_API.duplicateCard(args.id));
      case 'bringCardToFront':  MCP_API.bringCardToFront(args.id); return { ok: true };
      case 'sendCardToBack':    MCP_API.sendCardToBack(args.id); return { ok: true };

      /* Shared cards across boards (v7.x) */
      case 'shareCardToBoard':  return shareCardToBoard(args.id, args.targetBoardId);
      case 'unlinkSharedCard':  return unlinkSharedCard(args.id);

      /* Board management (4.5.0) */
      case 'createBoard':  return MCP_API.createBoard(args.name);
      case 'listBoards':   return MCP_API.listBoards();
      case 'switchBoard':  return MCP_API.switchBoard(args.id);
      case 'renameBoard':  return MCP_API.renameBoard(args.id, args.name);
      case 'deleteBoard':  return MCP_API.deleteBoard(args.id, !!args.confirm);
      case 'saveBoard':    return MCP_API.saveBoard(args.path);

      /* History / view (4.5.0) */
      case 'undo':           MCP_API.undo(); return { ok: true };
      case 'redo':           MCP_API.redo(); return { ok: true };
      case 'zoomIn':         MCP_API.zoomIn(); return { ok: true };
      case 'zoomOut':        MCP_API.zoomOut(); return { ok: true };
      case 'zoomReset':      MCP_API.zoomReset(); return { ok: true };
      case 'zoomFit':        MCP_API.zoomFit(); return { ok: true };
      case 'toggleMapView':  MCP_API.toggleMapView(); return { ok: true };

      /* Settings (4.5.0) — everything except plugin management */
      case 'getSettings':     return MCP_API.getSettings();
      case 'updateSettings':  return MCP_API.updateSettings(args.patch);

      /* Task Tracker (9.5.2) */
      case 'listTasks':       return listTasks();
      case 'addTask':         return addTask(args.text);
      case 'deleteTask':      return deleteTask(args.id);
      case 'toggleTask':      return toggleTask(args.id);
      case 'addSubtask':      return addSubtask(args.taskId, args.text);
      case 'toggleSubtask':   return toggleSubtask(args.taskId, args.subtaskId);
      case 'deleteSubtask':   return deleteSubtask(args.taskId, args.subtaskId);
      case 'setTaskCardLink': return setTaskCardLink(args.taskId, args.cardId);

      default:
        throw new Error('unknown MCP Bridge method: "' + method + '"');
    }
  }

  /* ── Enable / disable ──
     Audit fixes (caught before ship):
     1. onInvoke() is registered BEFORE start() now, not after — with
        the old ordering there was a real (if narrow) window where the
        local pipe was already open but nothing was listening for
        'mcp-invoke' yet, so a request arriving in that gap just sat
        until the main process's 15s timeout instead of failing fast.
        onInvoke() replacing rather than stacking (see plugin-api.js)
        makes registering it early harmless even if start() then fails.
     2. invokeUnsubscribe is now tracked and actually called on disable
        — previously nothing ever unsubscribed, relying entirely on the
        NEXT onInvoke() call to implicitly replace the old listener.
        Harmless today given that self-replacing behavior, but leaving
        a plugin's own listener registered after the user has explicitly
        told it to stop is the wrong invariant to rely on. */
  var invokeUnsubscribe = null;

  function setRunning(next) {
    if (!MCP_API.mcpBridge) {
      lastError = 'This Kanvaz build did not grant the "server" permission to this plugin — try removing and re-adding it.';
      notifyStatus();
      return Promise.resolve();
    }

    if (!next) {
      return MCP_API.mcpBridge.stop().then(function() {
        if (invokeUnsubscribe) { invokeUnsubscribe(); invokeUnsubscribe = null; }
        lastError = null;
        running = false;
        MCP_API.storage.save(PLUGIN_ID, { enabled: false });
        notifyStatus();
      });
    }

    invokeUnsubscribe = MCP_API.mcpBridge.onInvoke(handleInvoke);
    return MCP_API.mcpBridge.start().then(function(result) {
      if (!result || !result.ok) {
        lastError = (result && result.error) || 'failed to start';
        running = false;
        if (invokeUnsubscribe) { invokeUnsubscribe(); invokeUnsubscribe = null; }
      } else {
        lastError = null;
        running = true;
      }
      MCP_API.storage.save(PLUGIN_ID, { enabled: running });
      notifyStatus();
    });
  }

  /* Restore the user's own prior choice across restarts — off by
     default only on FIRST install/never-toggled, exactly like every
     other persisted setting in this app. */
  MCP_API.storage.load(PLUGIN_ID).then(function(data) {
    if (data && data.enabled) setRunning(true);
  });

  /* ── Settings panel ── */

  MCP_API.registerSettingsPanel('mcp-bridge', {
    label: 'MCP Bridge',
    render: function(container) {
      container.style.cssText = 'font-size:12px;';

      var intro = document.createElement('div');
      intro.style.cssText = 'color:var(--color-text-3);font-size:11px;margin-bottom:10px;line-height:1.4;';
      intro.textContent = 'Lets an MCP client (Claude Desktop, Claude Code, ...) read and edit this board over a local-only connection. Off by default. See this plugin’s README.md for the client setup steps.';
      container.appendChild(intro);

      var row = document.createElement('div');
      row.style.cssText = 'display:flex;align-items:center;gap:10px;margin-bottom:8px;';

      var toggleBtn = document.createElement('button');
      toggleBtn.style.cssText = 'padding:5px 12px;border-radius:6px;border:1px solid var(--color-accent);background:var(--color-accent-bg);color:var(--color-accent);font-family:var(--font-ui);font-size:11px;cursor:pointer;';
      toggleBtn.onclick = function() {
        toggleBtn.disabled = true;
        setRunning(!running).then(function() { toggleBtn.disabled = false; });
      };
      row.appendChild(toggleBtn);

      var statusEl = document.createElement('span');
      statusEl.style.cssText = 'font-size:11px;color:var(--color-text-2);';
      row.appendChild(statusEl);

      container.appendChild(row);

      var errEl = document.createElement('div');
      errEl.style.cssText = 'font-size:11px;color:var(--color-red);margin-top:4px;';
      container.appendChild(errEl);

      function refresh() {
        toggleBtn.textContent = running ? 'Disable' : 'Enable';
        statusEl.textContent = running ? 'Running' : 'Stopped';
        errEl.textContent = lastError || '';
        errEl.style.display = lastError ? '' : 'none';
      }
      statusRenderers.push(refresh);
      refresh();
    }
  });

})();
