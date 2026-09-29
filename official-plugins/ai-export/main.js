/* AI Export — an official Kanvaz plugin
   Zero permissions requested: reads via the Runtime Data API
   (getCards/getConnections/getTasks/listBoards/switchBoard) and writes
   through the plugin API's own exportAIData save dialog — nothing here
   opens a network connection or a listener.

   Ships as a separate release asset, not bundled in the Kanvaz
   installer — install it the same way as any third-party plugin
   (Settings → Plugins → Add a Plugin…).

   Produces two files from one export: a versioned JSON contract any
   AI agent's tooling can parse, and a Markdown digest built from the
   exact same walked data so a human can just paste it into a chat
   window. No MCP connection needed — this works even if MCP Bridge
   isn't installed at all. Everything stays on this machine; nothing
   here ever calls the network.

   See docs/AI_EXPORT_AND_MAP_NOTES_PLAN.md for the full design and the
   user/developer audit that shaped this — every decision below (scope
   selector, metadata-only media, source-tagged notes, the fallback
   branch for a card type this plugin doesn't recognize) traces back to
   a specific finding in that doc, not a guess made here. */

(function() {

  var PLUGIN_ID = document.currentScript ? document.currentScript.getAttribute('data-plugin-id') : 'studio.northbyte.ai-export';
  var EXPORT_SCHEMA_VERSION = 1;

  /* Zero permissions declared, never touches a gated namespace — same
     reasoning as theme-creator/main.js's and template-maker/main.js's
     own comments on this. */

  /* ── Card type -> media descriptor ──
     Every KNOWN type gets a specific, useful shape. Anything this
     plugin doesn't recognize (a future built-in type, or a type a
     THIRD-PARTY plugin registered via registerCardType) still falls
     through to a generic-but-present entry — never dropped, never a
     thrown error partway through a walk. */
  function mediaFor(card) {
    switch (card.type) {
      case 'image': case 'gif': case 'video': case 'audio': case 'model3d': case 'file':
        return { kind: card.type };
      case 'color':
        return { kind: 'color', hex: card.color || null };
      case 'url':
        return { kind: 'url', href: card.url || null };
      case 'note': case 'text':
        return null; /* the card's own body already lives in notes[] below */
      default:
        /* Unknown/future type (built-in or third-party-registered) —
           still exports as a complete, valid entry. */
        return { kind: card.type || 'unknown' };
    }
  }

  /* ── Notes ──
     Merges the two real sources of "written text on this card" in the
     actual data model (see the plan doc's ground-truth audit):
       - a Note or Text card's own body (card.text)
       - every Annotate-tool text-label stroke in card.annotations
         (tool === 'text', per annotate.js's own stroke shape)
     Always returns an array (possibly empty) — never undefined, so an
     agent never has to guess whether "no notes" means "empty" or
     "not extracted." */
  /* Known, narrow limitation — traced through cards.js/annotate.js,
     not guessed: `card.annotations` here is the RAW live property on
     the card object, which annotate.js only re-syncs from its own
     live drawing-overlay state (KanvazAnnotate's `overlays[id].strokes`)
     at serialize time — i.e. on a board switch or a save, same as
     buildFullCardRecord() does for the real .kanvaz file. A text
     annotation drawn on the CURRENTLY active board, with no save or
     board switch since, could be one draw-stroke fresher than what
     this export captures. This is not an AI-Export-specific gap: a
     Ctrl+S right now would write the exact same not-yet-resynced
     state to the .kanvaz file, so this plugin's freshness already
     matches the app's own save semantics — noted here so it's a
     documented characteristic, not a silent surprise. */
  function notesForCard(card) {
    var notes = [];
    if ((card.type === 'note' || card.type === 'text') && card.text && card.text.trim()) {
      notes.push({ text: card.text.trim(), source: 'note' });
    }
    var ann = card.annotations || [];
    for (var i = 0; i < ann.length; i++) {
      if (ann[i] && ann[i].tool === 'text' && ann[i].text && ann[i].text.trim()) {
        notes.push({ text: ann[i].text.trim(), source: 'annotation' });
      }
    }
    return notes;
  }

  function cardEntry(card) {
    var entry = {
      id: card.id,
      type: card.type,
      name: card.name || card.type,
      tags: card.tags || [],
      notes: notesForCard(card),
      customProperties: card.properties || {},
      media: mediaFor(card)
    };
    if (card.sharedId) entry.sharedId = card.sharedId;
    return entry;
  }

  function boardEntry(boardInfo, cards, connections) {
    var cardIds = {};
    for (var i = 0; i < cards.length; i++) cardIds[cards[i].id] = true;
    var conns = [];
    for (var j = 0; j < connections.length; j++) {
      var c = connections[j];
      /* Connections are file-level in the live data model, but this
         board's entry should only list edges where both ends are
         actually on it — a cross-board edge (rare, but the id space
         is file-wide) would otherwise appear to dangle here. */
      if (cardIds[c.fromRefId] && cardIds[c.toRefId]) {
        conns.push({ from: c.fromRefId, to: c.toRefId, type: c.type });
      }
    }
    return {
      id: boardInfo.id,
      name: boardInfo.name,
      cards: cards.map(cardEntry),
      connections: conns
    };
  }

  /* ── Error system ──
     Three real bugs found live-testing this plugin all came from the
     same root cause: assuming a Runtime Data API call's sync/async
     shape instead of checking it. `switchBoard()` turned out to be
     SYNCHRONOUS (returns a plain {ok,error} object, not a Promise) —
     calling .then() on it threw "switchTo.then is not a function" the
     moment the walk hit a board that wasn't already active. The fix
     isn't just patching that one call site; it's never trusting a
     call's shape again anywhere in this file, so the next time
     Kanvaz's own internals shift under this plugin (a sync function
     becoming async, or vice versa — it has happened before in this
     codebase) this degrades to a clear message instead of a cryptic
     TypeError three frames deep in a loop. */

  /* Always returns a real Promise, whether `result` is one already, a
     plain value, or something a future Kanvaz version returns as a
     thenable-but-not-technically-a-Promise. This one wrapper is what
     makes every call site below safe regardless of which shape the
     underlying function actually has today. */
  function asPromise(result) {
    return Promise.resolve(result);
  }

  /* Fails loud and SPECIFIC, once, before any real work starts,
     instead of letting a missing/renamed API method surface as an
     opaque "X is not a function" from deep inside the walk. This is
     the single highest-leverage guard for not having to touch this
     file again the next time the Runtime Data API's surface changes —
     a removed or renamed method becomes one clear sentence naming
     exactly which capability is missing, not a stack trace. */
  var REQUIRED_API = ['getActiveBoard', 'listBoards', 'switchBoard', 'getCards', 'getConnections', 'getTasks', 'exportAIData', 'showToast'];
  function checkAPISurface() {
    var missing = [];
    for (var i = 0; i < REQUIRED_API.length; i++) {
      if (typeof KanvazPluginAPI[REQUIRED_API[i]] !== 'function') missing.push(REQUIRED_API[i]);
    }
    if (missing.length) {
      throw new Error('this Kanvaz build is missing: ' + missing.join(', ') + ' — AI Export needs a newer Kanvaz version');
    }
  }

  /* A single labeled step in the walk. Never throws — every failure
     becomes a { ok: false, error } result the caller can decide what
     to do with (skip this one board, or abort everything), instead of
     letting an exception unwind through however many promise frames
     happen to be on the stack at the time. */
  function step(label, fn) {
    return asPromise(null).then(fn).then(function(value) {
      return { ok: true, value: value };
    }, function(e) {
      var msg = (e && e.message) ? e.message : String(e);
      console.error('[Kanvaz AI Export] ' + label + ' failed:', e);
      return { ok: false, error: label + ': ' + msg };
    });
  }

  /* ── Walk ──
     scope 'board': just the active board, zero side effects.
     scope 'all': visits every board via switchBoard() — the ONLY way
     to read a non-active board's real (post-shared-card-merge)
     content, since only the active board's cards live in KanvazCards
     at any moment (see the plan doc's shared-card ground-truth note).
     That switching is a real, visible side effect on the live app, so
     the original active board is captured up front and restored via
     restoreOriginalBoard() in EVERY exit path below — success, a
     per-board failure, or a total failure. An export must never leave
     the user looking at a different board than the one they started
     on, no matter what went wrong partway through. */
  function walk(scope) {
    checkAPISurface();

    if (scope === 'board') {
      var active = KanvazPluginAPI.getActiveBoard();
      if (!active || !active.id) throw new Error('no active board to export');
      var board = boardEntry(active, KanvazPluginAPI.getCards(), KanvazPluginAPI.getConnections());
      return Promise.resolve({ boards: [board], skipped: [] });
    }

    var originalId = KanvazPluginAPI.getActiveBoard().id;
    var infos = KanvazPluginAPI.listBoards();
    if (!Array.isArray(infos)) infos = [];
    var boards = [];
    var skipped = [];

    function restoreOriginalBoard() {
      return step('restoring your original board', function() {
        return asPromise(KanvazPluginAPI.switchBoard(originalId));
      });
    }

    function visitOne(info) {
      if (!info || !info.id) {
        skipped.push({ board: (info && info.name) || 'unknown', reason: 'malformed board entry' });
        return Promise.resolve();
      }
      return step('switching to "' + info.name + '"', function() {
        var alreadyActive = KanvazPluginAPI.getActiveBoard().id === info.id;
        return alreadyActive ? asPromise({ ok: true }) : asPromise(KanvazPluginAPI.switchBoard(info.id));
      }).then(function(switchResult) {
        if (!switchResult.ok) {
          skipped.push({ board: info.name, reason: switchResult.error });
          return;
        }
        return step('reading "' + info.name + '"', function() {
          return boardEntry(info, KanvazPluginAPI.getCards(), KanvazPluginAPI.getConnections());
        }).then(function(readResult) {
          if (readResult.ok) boards.push(readResult.value);
          else skipped.push({ board: info.name, reason: readResult.error });
        });
      });
    }

    /* Sequential, not Promise.all — each step depends on the previous
       switch having actually completed (only one board's data is ever
       live in KanvazCards at a time), so these cannot run concurrently
       regardless of how tempting that looks. */
    var chain = Promise.resolve();
    for (var i = 0; i < infos.length; i++) {
      (function(info) { chain = chain.then(function() { return visitOne(info); }); })(infos[i]);
    }

    return chain
      .then(function() { return restoreOriginalBoard(); })
      .then(function() { return { boards: boards, skipped: skipped }; })
      .catch(function(e) {
        /* Whatever went wrong, still try to get the user back to where
           they started before this rejection propagates up. */
        return restoreOriginalBoard().then(function() { throw e; });
      });
  }

  function buildTree(scope, boards) {
    return {
      kanvazExportVersion: EXPORT_SCHEMA_VERSION,
      exportedAt: new Date().toISOString(),
      sourceApp: { name: 'Kanvaz', version: (typeof KanvazBoards !== 'undefined' && KanvazBoards.getVersion) ? KanvazBoards.getVersion() : null },
      scope: scope,
      boards: boards,
      tasks: KanvazPluginAPI.getTasks()
    };
  }

  function toJSON(tree) {
    return JSON.stringify(tree, null, 2);
  }

  function esc(s) { return (s || '').replace(/\r?\n/g, ' ').trim(); }

  function toMarkdown(tree) {
    var lines = [];
    lines.push('# Kanvaz export (' + (tree.scope === 'all' ? 'all boards' : 'this board') + ')');
    lines.push('');
    lines.push('_Exported ' + tree.exportedAt + ' — schema v' + tree.kanvazExportVersion + '_');
    lines.push('');
    for (var bi = 0; bi < tree.boards.length; bi++) {
      var board = tree.boards[bi];
      lines.push('## ' + board.name);
      lines.push('');
      for (var ci = 0; ci < board.cards.length; ci++) {
        var c = board.cards[ci];
        lines.push('### ' + esc(c.name) + ' (' + c.type + ')');
        if (c.tags.length) lines.push('Tags: ' + c.tags.join(', '));
        /* Omit the whole Notes heading for a card with none — a
           dangling "Notes:" with nothing under it on every single
           note-less card is exactly the noise the user-POV audit
           flagged. */
        if (c.notes.length) {
          lines.push('Notes:');
          for (var ni = 0; ni < c.notes.length; ni++) {
            lines.push('- ' + esc(c.notes[ni].text) + ' _(' + c.notes[ni].source + ')_');
          }
        }
        var outgoing = board.connections.filter(function(conn) { return conn.from === c.id; });
        for (var oi = 0; oi < outgoing.length; oi++) {
          var target = board.cards.filter(function(x) { return x.id === outgoing[oi].to; })[0];
          if (target) lines.push('Connects to: ' + esc(target.name) + ' (' + outgoing[oi].type + ')');
        }
        lines.push('');
      }
    }
    if (tree.tasks.length) {
      lines.push('## Tasks');
      for (var ti = 0; ti < tree.tasks.length; ti++) {
        var t = tree.tasks[ti];
        lines.push('- [' + (t.done ? 'x' : ' ') + '] ' + esc(t.text));
      }
    }
    return lines.join('\n');
  }

  function humanSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  }

  function countCards(tree) {
    var n = 0;
    for (var i = 0; i < tree.boards.length; i++) n += tree.boards[i].cards.length;
    return n;
  }

  function runExport(scope, statusEl) {
    statusEl.textContent = 'Walking board data…';
    var walkResult;
    Promise.resolve()
      .then(function() { return walk(scope); })
      .then(function(res) {
        walkResult = res;
        if (!walkResult.boards.length) {
          throw new Error('nothing exportable — every board failed to read (' +
            walkResult.skipped.map(function(s) { return s.board + ': ' + s.reason; }).join('; ') + ')');
        }
        statusEl.textContent = 'Writing files…';
        var tree = buildTree(scope, walkResult.boards);
        var json = toJSON(tree);
        var markdown = toMarkdown(tree);
        var baseName = 'kanvaz-ai-export-' + new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
        return asPromise(KanvazPluginAPI.exportAIData({ baseName: baseName, json: json, markdown: markdown })).then(function(res) {
          statusEl.textContent = '';
          if (!res || res.cancelled) return;
          if (!res.ok) {
            KanvazPluginAPI.showToast('Export failed — ' + (res.error || 'unknown error'), 'error');
            return;
          }
          var cardCount = countCards(tree);
          var sizeBytes = json.length + markdown.length;
          var msg = 'Exported ' + cardCount + ' card(s), ' + humanSize(sizeBytes) + ' total — written to this machine, nothing sent anywhere';
          /* A board that failed mid-walk doesn't silently vanish from
             the export with no trace — the user hears about it right
             in the success toast, not just in the console. */
          if (walkResult.skipped.length) {
            msg += '. Skipped ' + walkResult.skipped.length + ' board(s): ' +
              walkResult.skipped.map(function(s) { return s.board; }).join(', ');
          }
          KanvazPluginAPI.showToast(msg, walkResult.skipped.length ? 'warning' : 'success');
        });
      })
      .catch(function(e) {
        statusEl.textContent = '';
        var msg = (e && e.message) ? e.message : String(e);
        console.error('[Kanvaz AI Export] export failed:', e);
        KanvazPluginAPI.showToast('Export failed — ' + msg, 'error');
      });
  }

  function render(container) {
    var wrap = document.createElement('div');
    wrap.style.cssText = 'font-family:var(--font-ui);font-size:12px;color:var(--color-text);';
    container.appendChild(wrap);

    var intro = document.createElement('div');
    intro.style.cssText = 'color:var(--color-text-3);font-size:11px;margin-bottom:10px;line-height:1.4;';
    intro.textContent = 'Export a JSON + Markdown pair any AI agent can read — no MCP connection needed. Written to a file on this machine; Kanvaz never sends it anywhere.';
    wrap.appendChild(intro);

    var scopeRow = document.createElement('div');
    scopeRow.style.cssText = 'display:flex;align-items:center;gap:8px;margin-bottom:10px;';
    var scopeLabel = document.createElement('span');
    scopeLabel.style.cssText = 'color:var(--color-text-2);font-size:11px;';
    scopeLabel.textContent = 'Scope';
    var scopeSelect = document.createElement('select');
    scopeSelect.style.cssText = 'flex:1;background:var(--color-surface-2);border:1px solid var(--color-border-2);border-radius:4px;color:var(--color-text);font-size:12px;padding:5px 8px;font-family:var(--font-ui);';
    var optBoard = document.createElement('option');
    optBoard.value = 'board';
    optBoard.textContent = 'This board';
    var optAll = document.createElement('option');
    optAll.value = 'all';
    optAll.textContent = 'All boards in this file';
    scopeSelect.appendChild(optBoard);
    scopeSelect.appendChild(optAll);
    scopeRow.appendChild(scopeLabel);
    scopeRow.appendChild(scopeSelect);
    wrap.appendChild(scopeRow);

    var statusEl = document.createElement('div');
    statusEl.style.cssText = 'color:var(--color-text-3);font-size:11px;margin-bottom:8px;min-height:14px;';
    wrap.appendChild(statusEl);

    var exportBtn = document.createElement('button');
    exportBtn.textContent = 'Export for AI agent…';
    exportBtn.style.cssText = 'width:100%;padding:6px;background:var(--color-accent-bg);border:1px solid var(--color-accent);border-radius:6px;color:var(--color-accent);font-family:var(--font-ui);font-size:12px;cursor:pointer;';
    exportBtn.onclick = function() { runExport(scopeSelect.value, statusEl); };
    wrap.appendChild(exportBtn);
  }

  KanvazPluginAPI.registerSettingsPanel('ai-export', {
    label: 'AI Export',
    render: render
  });

})();
