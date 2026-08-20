/* MCP Bridge — an official Kanvaz plugin (4.4.0)

   Exposes the active board to any MCP-compatible AI client (Claude
   Desktop, Claude Code, etc.) via a local-only named pipe / Unix socket
   that Kanvaz's main process listens on (see src/main.js's mcp-bridge-*
   IPC handlers) — this file is the renderer-side half: it registers the
   Settings toggle and the actual tool-call handler that answers every
   request with real data by calling the exact same KanvazCards/
   KanvazConnections functions the UI itself uses, so every AI-driven
   change lands in undo history exactly like a manual edit.

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
    statusRenderers.forEach(function(fn) { fn(); });
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
    } else if (args.type === 'color') {
      card = KanvazCards.createColorCard(pos.x, pos.y, data.color);
    } else if (args.type === 'url') {
      card = KanvazCards.createUrlCard(pos.x, pos.y);
      if (data.url !== undefined) card = MCP_API.updateCard(card.id, { url: data.url });
    } else if (args.type === 'file') {
      if (!data.path) throw new Error('createCard type "file" requires data.path');
      card = KanvazCards.createFileRefCardAtPath(pos.x, pos.y, data.path);
    } else {
      throw new Error('unsupported type "' + args.type + '" for createCard — use "note"/"color"/"url"/"file", or addReference for an image/video/audio file or a URL card in one step');
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
    var conn = KanvazConnections.create(fromId, toId, type);
    if (!conn) throw new Error('could not create connection — check that fromId/toId are real, distinct card ids');
    return conn;
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
      case 'getConnections':  return MCP_API.getConnections();
      case 'connectCards':    return connectCards(args.fromId, args.toId, args.type);
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
