/* boards.js — board tab system, save/load, autosave, startup screen */

var KanvazBoards = (function() {

  var boards        = [];     /* array of { id, name, cards, canvas } */
  var activeIdx     = 0;
  var currentPath   = null;
  var autosaveTimer = null;
  var AUTOSAVE_MS   = 30000;
  var VERSION       = '5.2.0';

  /* ── Plugin event hooks (4.3.0) ──
     Fired at the two points that mean "the active board's identity or
     on-disk state actually changed" — a new/switched/opened board
     (boardLoad) or a real Save/Save As landing on disk (boardSave).
     Autosave's recovery-file write deliberately does NOT fire boardSave
     — see doAutosave()'s own comment on why it never touches
     currentPath; firing boardSave there would misrepresent a crash-
     recovery snapshot as a real save to a plugin listening for one. */
  function emitBoardEvent(type) {
    if (typeof KanvazPluginAPI === 'undefined' || !KanvazPluginAPI._emit) return;
    KanvazPluginAPI._emit(type, getActiveBoardInfo());
  }

  function getActiveBoardInfo() {
    var b = boards[activeIdx];
    if (!b) return null;
    return { id: b.id, name: b.name, path: currentPath };
  }

  /* ── Init ── */

  function init() {
    var tabBar = document.getElementById('board-tabs');
    if (!tabBar) createTabBar();

    newBoard(true);
    /* Note: startAutosave() is called from KanvazUI_Extended.applySettings()
       after settings have loaded — calling it here would use the wrong
       interval since settings.autosaveInterval isn't loaded yet. */
    showStartupScreen();
  }

  /* ── Tab bar DOM ── */

  function createTabBar() {
    var tabBar = document.getElementById('board-tabs');
    if (!tabBar) return;
    tabBar.style.cssText = [
      'display:flex',
      'align-items:center',
      'height:32px',
      'background:var(--color-chrome)',
      'border-bottom:1px solid var(--color-border)',
      'padding:0 8px',
      'gap:2px',
      'overflow-x:auto',
      'flex-shrink:0'
    ].join(';');
  }

  function renderTabs() {
    var tabBar = document.getElementById('board-tabs');
    if (!tabBar) return;
    tabBar.innerHTML = '';

    for (var i = 0; i < boards.length; i++) {
      (function(idx) {
        var tab = document.createElement('div');
        var isActive = (idx === activeIdx);
        tab.style.cssText = [
          'display:flex',
          'align-items:center',
          'gap:6px',
          'padding:4px 10px',
          'cursor:pointer',
          'font-size:12px',
          'white-space:nowrap',
          'max-width:160px',
          'background:' + (isActive ? 'var(--color-surface)' : 'transparent'),
          'color:' + (isActive ? 'var(--color-text)' : 'var(--color-text-3)'),
          isActive
            ? 'border-radius:4px 4px 0 0;border:1px solid var(--color-border);border-bottom:2px solid var(--color-accent)'
            : 'border-radius:4px;border:1px solid transparent;border-bottom:2px solid transparent',
          'transition:background 0.1s, color 0.1s'
        ].join(';');

        if (!isActive) {
          tab.onmouseenter = function() { tab.style.background = 'var(--color-surface-2)'; tab.style.color = 'var(--color-text-2)'; };
          tab.onmouseleave = function() { tab.style.background = 'transparent'; tab.style.color = 'var(--color-text-3)'; };
        }

        var nameSpan = document.createElement('span');
        nameSpan.textContent = boards[idx].name;
        nameSpan.style.cssText = 'overflow:hidden;text-overflow:ellipsis;flex:1;';
        tab.appendChild(nameSpan);

        /* Card count badge */
        var cardCount = 0;
        if (idx === activeIdx) {
          var allCards = KanvazCards.getAll();
          for (var _k in allCards) cardCount++;
        } else {
          cardCount = (boards[idx].cards && boards[idx].cards.length) ? boards[idx].cards.length : 0;
        }
        if (cardCount > 0) {
          var countBadge = document.createElement('span');
          countBadge.textContent = cardCount;
          countBadge.style.cssText = 'font-size:9px;color:var(--color-text-3);background:var(--color-surface-2);padding:1px 5px;border-radius:8px;flex-shrink:0;font-weight:500;';
          tab.appendChild(countBadge);
        }

        /* Close button — only show if more than 1 board */
        if (boards.length > 1) {
          var closeBtn = document.createElement('button');
          closeBtn.innerHTML = '&times;';
          closeBtn.style.cssText = 'background:none;border:none;cursor:pointer;color:var(--color-text-3);font-size:14px;padding:0;line-height:1;';
          closeBtn.onclick = function(e) {
            e.stopPropagation();
            deleteBoard(idx);
          };
          tab.appendChild(closeBtn);
        }

        tab.onclick = function() { switchBoard(idx); };

        /* Double-click to rename */
        tab.ondblclick = function(e) {
          e.stopPropagation();
          renameBoard(idx, nameSpan);
        };

        tabBar.appendChild(tab);
      })(i);
    }

    /* Add board button */
    var addBtn = document.createElement('button');
    addBtn.textContent = '+';
    addBtn.title = 'New board';
    addBtn.style.cssText = 'background:none;border:none;cursor:pointer;color:var(--color-text-3);font-size:18px;padding:0 6px;line-height:1;';
    addBtn.onmouseenter = function() { addBtn.style.color = 'var(--color-text)'; };
    addBtn.onmouseleave = function() { addBtn.style.color = 'var(--color-text-3)'; };
    addBtn.onclick = function() { newBoard(false); };
    tabBar.appendChild(addBtn);

    /* v5.1.0 — "Start from Template" sits right next to "New board"
       since it's the same decision point (what should this new board
       start as), not buried in Settings the way plugin browsing is. */
    var templateBtn = document.createElement('button');
    templateBtn.textContent = '⌗';
    templateBtn.title = 'Start from Template';
    templateBtn.style.cssText = 'background:none;border:none;cursor:pointer;color:var(--color-text-3);font-size:14px;padding:0 6px;line-height:1;';
    templateBtn.onmouseenter = function() { templateBtn.style.color = 'var(--color-text)'; };
    templateBtn.onmouseleave = function() { templateBtn.style.color = 'var(--color-text-3)'; };
    templateBtn.onclick = function() {
      if (typeof KanvazUI !== 'undefined' && KanvazUI.showTemplateGallery) KanvazUI.showTemplateGallery();
    };
    tabBar.appendChild(templateBtn);
  }

  /* ── New board ── */

  function newBoard(silent, name) {
    saveCurrentBoardState();

    var id = 'board-' + Date.now();
    var board = {
      id:       id,
      name:     (name && name.trim()) || ('Board ' + (boards.length + 1)),
      cards:    [],
      canvasTx: 0,
      canvasTy: 0,
      canvasScale: 1.0
    };

    boards.push(board);
    activeIdx = boards.length - 1;

    KanvazCards.clearAll();
    if (typeof KanvazConnections !== 'undefined') KanvazConnections.clear();
    KanvazCanvas.zoomReset();
    KanvazHistory.clear();
    emitBoardEvent('boardLoad');

    renderTabs();
    updateTitle();

    /* Audit fix: a new tab is a real content change to the file (it
       will be saved as part of boards[] next time), but this never
       marked the file dirty — silent(true) call sites are internal
       (app startup, legacy-file recovery) where there's nothing to
       lose yet, so only the user-initiated (!silent) path counts. */
    if (!silent) {
      KanvazUI.toast('New board created');
      if (typeof KanvazApp !== 'undefined' && KanvazApp.markDirty) KanvazApp.markDirty();
    }
  }

  /* ── Switch board ── */

  function switchBoard(idx) {
    if (idx === activeIdx) return;
    saveCurrentBoardState();
    activeIdx = idx;

    /* Close inspector — cards will be different on the new board */
    if (typeof KanvazInspector !== 'undefined') KanvazInspector.close();
    /* Clear any active search — leaving it open would show a stale
       query against a board it was never applied to */
    if (typeof KanvazUI !== 'undefined' && KanvazUI.hideSearchBar) KanvazUI.hideSearchBar();

    loadBoardState(boards[idx]);
    renderTabs();
    updateTitle();
  }

  /* ── Save current board state into boards array ── */

  function saveCurrentBoardState() {
    if (!boards[activeIdx]) return;
    boards[activeIdx].cards       = KanvazCards.serialise();
    boards[activeIdx].canvasTx    = KanvazCanvas.getTx();
    boards[activeIdx].canvasTy    = KanvazCanvas.getTy();
    boards[activeIdx].canvasScale = KanvazCanvas.getScale();

    /* v3: save map view state */
    if (typeof KanvazMapView !== 'undefined') {
      var ms = KanvazMapView.getState();
      boards[activeIdx].mapTx    = ms.tx;
      boards[activeIdx].mapTy    = ms.ty;
      boards[activeIdx].mapScale = ms.scale;
    }
  }

  /* ── Load board state from boards array ── */

  function loadBoardState(board) {
    KanvazCards.deserialise(board.cards || []);
    /* Audit fix: panTo() then setZoom() used to fight each other —
       setZoom's pivot math rewrites tx/ty based on the ratio from
       whatever scale the PREVIOUS board was at, throwing away the pan
       just restored. setViewport() assigns all three in one shot. */
    KanvazCanvas.setViewport(board.canvasTx || 0, board.canvasTy || 0, board.canvasScale || 1.0);

    /* v3: restore map view state */
    if (typeof KanvazMapView !== 'undefined') {
      KanvazMapView.setState({
        tx:    board.mapTx    || 0,
        ty:    board.mapTy    || 0,
        scale: board.mapScale || 1.0
      });
      if (KanvazMapView.isActive()) KanvazMapView.render();
    }

    KanvazHistory.clear();
    emitBoardEvent('boardLoad');
  }

  /* ── Rename board ── */

  function renameBoard(idx, nameSpan) {
    var input = document.createElement('input');
    input.type = 'text';
    input.value = boards[idx].name;
    input.style.cssText = 'background:var(--color-surface-2);border:1px solid var(--color-accent);border-radius:3px;color:var(--color-text);font-size:12px;padding:1px 4px;width:100px;outline:none;font-family:var(--font-ui);';

    nameSpan.parentNode.replaceChild(input, nameSpan);
    input.focus();
    input.select();

    function commit() {
      var val = input.value.trim() || boards[idx].name;
      var changed = (val !== boards[idx].name);
      boards[idx].name = val;
      renderTabs();
      /* Audit fix: renaming a tab is a real, savable content change and
         was never marked dirty — a rename right before closing the app
         would take the !boardDirty fast-close path (no save prompt) and
         be silently lost. */
      if (changed && typeof KanvazApp !== 'undefined' && KanvazApp.markDirty) KanvazApp.markDirty();
    }

    input.onblur = commit;
    input.onkeydown = function(e) {
      if (e.key === 'Enter') { e.preventDefault(); commit(); }
      if (e.key === 'Escape') {
        /* renderTabs() rebuilds the tab bar (innerHTML = ''), which
           removes this still-focused input from the DOM — that fires a
           native 'blur' on it first, which was wired to commit() above.
           Left alone, Escape would "cancel" by committing whatever was
           typed, same as Enter. Unhook the blur handler first so the
           teardown is silent. */
        input.onblur = null;
        renderTabs();
      }
    };
  }

  /* ── Delete board ── */

  function deleteBoard(idx) {
    if (boards.length <= 1) {
      KanvazUI.toast('Cannot delete the last board', 'error');
      return;
    }

    KanvazUI.showDialog(
      'Delete board?',
      '"' + boards[idx].name + '" and all its cards will be removed.',
      [
        {
          label: 'Delete',
          cls: 'danger',
          action: function() {
            var wasActive = (idx === activeIdx);

            /* Cascade-delete connections for all cards on this board.
               For the board being deleted RIGHT NOW while active, read
               the live card list instead of boards[idx].cards — that
               snapshot is only refreshed by saveCurrentBoardState() (on
               switchBoard()/newBoard()), so any card added or moved
               since the last switch wouldn't be in it yet, and its
               connections would survive as orphans. */
            if (typeof KanvazConnections !== 'undefined') {
              var cardIdsToClean = [];
              if (wasActive) {
                cardIdsToClean = Object.keys(KanvazCards.getAll());
              } else if (boards[idx].cards) {
                for (var ci = 0; ci < boards[idx].cards.length; ci++) {
                  cardIdsToClean.push(boards[idx].cards[ci].id);
                }
              }
              for (var cj = 0; cj < cardIdsToClean.length; cj++) {
                KanvazConnections.removeAllFor(cardIdsToClean[cj]);
              }
            }

            boards.splice(idx, 1);

            if (wasActive) {
              if (activeIdx >= boards.length) activeIdx = boards.length - 1;
              loadBoardState(boards[activeIdx]);
            } else if (idx < activeIdx) {
              /* A board before the active one was removed — shift the
                 index to keep pointing at the SAME (still-active) board.
                 Do NOT call loadBoardState here: that would re-deserialise
                 the active board from its possibly-stale serialised
                 `.cards` (last synced at the previous switch/save),
                 discarding any live unsaved edits made since then. */
              activeIdx -= 1;
            }
            /* idx > activeIdx: a later board was removed, active board
               and its index are unaffected. */

            renderTabs();
            updateTitle();
            KanvazApp.markDirty();
          }
        },
        { label: 'Cancel', cls: '', action: function() {} }
      ]
    );
  }

  /* ── MCP Bridge / plugin-facing board management (4.5.0) ──
     Everything below operates by board ID, never by array index — an
     index is only ever meaningful for as long as nothing else has
     changed the boards array, which is exactly the kind of assumption
     an AI-driven caller (issuing calls one at a time, with a human or
     another process potentially acting on the app in between) can't
     safely rely on. Human-facing UI code above (renameBoard,
     deleteBoard, switchBoard) keeps using indices — it's driven
     directly by click handlers on the tab bar, which already knows its
     own index; changing that path isn't in scope here. */

  function findBoardIndexById(id) {
    for (var i = 0; i < boards.length; i++) {
      if (boards[i].id === id) return i;
    }
    return -1;
  }

  function listBoardsInfo() {
    /* Card counts for every board except the active one come from each
       board's last-synced `.cards` snapshot (only refreshed on
       switch/save, per saveCurrentBoardState's own doc comment above)
       — sync the ACTIVE board's snapshot first so its own count is
       exact, not stale from the last time something else was active. */
    saveCurrentBoardState();
    return boards.map(function(b, i) {
      return { id: b.id, name: b.name, cardCount: (b.cards || []).length, active: i === activeIdx };
    });
  }

  function switchBoardById(id) {
    var idx = findBoardIndexById(id);
    if (idx === -1) return { ok: false, error: 'no board with that id' };
    switchBoard(idx);
    return { ok: true };
  }

  function renameBoardById(id, newName) {
    var idx = findBoardIndexById(id);
    if (idx === -1) return { ok: false, error: 'no board with that id' };
    var val = (newName || '').trim();
    if (!val) return { ok: false, error: 'name cannot be empty' };
    var changed = (val !== boards[idx].name);
    boards[idx].name = val;
    if (idx === activeIdx) updateTitle();
    renderTabs();
    if (changed && typeof KanvazApp !== 'undefined' && KanvazApp.markDirty) KanvazApp.markDirty();
    return { ok: true, id: boards[idx].id, name: boards[idx].name };
  }

  /* Stateless confirm gate — no server-side token/session to track and
     nothing to expire. Without confirm:true, returns what WOULD be
     deleted (name + card count) and stops there; the caller has to
     deliberately re-issue the call with confirm:true to actually do
     it. Board deletion — unlike every card-level MCP tool — is NOT
     undo-reversible: KanvazHistory is scoped per-board and is cleared
     outright on every board switch/load (see loadBoardState above), so
     there's no undo stack left to roll a deleted board back from once
     you've navigated away from the confirm response. That asymmetry
     with the rest of this tool surface is exactly why this one gets
     an explicit confirmation step and the others don't. */
  function deleteBoardById(id, confirm) {
    var idx = findBoardIndexById(id);
    if (idx === -1) return { ok: false, error: 'no board with that id' };
    if (boards.length <= 1) return { ok: false, error: 'cannot delete the last board' };

    var target = boards[idx];
    var cardCount = (idx === activeIdx) ? Object.keys(KanvazCards.getAll()).length : (target.cards || []).length;

    if (!confirm) {
      return {
        ok: true,
        needsConfirmation: true,
        id: target.id,
        name: target.name,
        cardCount: cardCount,
        message: 'This will permanently delete "' + target.name + '" and its ' + cardCount + ' card(s) — not undo-reversible. Call again with confirm:true to proceed.'
      };
    }

    var wasActive = (idx === activeIdx);

    /* Same cascade-delete-connections logic as the dialog-driven
       deleteBoard() above — see its own comment for why the active
       board reads its live card list instead of the possibly-stale
       serialised snapshot. */
    if (typeof KanvazConnections !== 'undefined') {
      var cardIdsToClean = [];
      if (wasActive) {
        cardIdsToClean = Object.keys(KanvazCards.getAll());
      } else if (target.cards) {
        for (var ci = 0; ci < target.cards.length; ci++) cardIdsToClean.push(target.cards[ci].id);
      }
      for (var cj = 0; cj < cardIdsToClean.length; cj++) KanvazConnections.removeAllFor(cardIdsToClean[cj]);
    }

    boards.splice(idx, 1);

    if (wasActive) {
      if (activeIdx >= boards.length) activeIdx = boards.length - 1;
      loadBoardState(boards[activeIdx]);
    } else if (idx < activeIdx) {
      activeIdx -= 1;
    }

    renderTabs();
    updateTitle();
    if (typeof KanvazApp !== 'undefined' && KanvazApp.markDirty) KanvazApp.markDirty();
    return { ok: true, deleted: true, id: target.id, name: target.name };
  }

  /* ── Guard against silently discarding unsaved work ──
     Audit fix: opening a different board (via the toolbar Open button,
     a recent-file click, or double-clicking a .kanvaz file / handing
     one off from a second app instance while Kanvaz is already running)
     used to call straight into readFile()+loadFromJSON(), which does a
     full `boards = data.boards` replace with zero check for unsaved
     work on the board currently open — unlike window close, which
     already prompts via handleCloseRequest() in app.js. This mirrors
     that same Save / Don't Save / Cancel pattern for the "open" path. */
  function confirmDiscardIfDirty(proceed) {
    var dirty = (typeof KanvazApp !== 'undefined' && KanvazApp.isDirty) ? KanvazApp.isDirty() : false;
    if (!dirty) { proceed(); return; }

    KanvazUI.showDialog(
      'Unsaved changes',
      'Opening a different board will discard unsaved changes here. Save first?',
      [
        {
          label: 'Save',
          cls: 'primary',
          action: function() {
            saveBoard(function(ok) { if (ok) proceed(); });
          }
        },
        {
          label: "Don't Save",
          cls: 'danger',
          action: function() { proceed(); }
        },
        { label: 'Cancel', cls: '', action: function() {} }
      ]
    );
  }

  /* Warn (never block) if a file was saved by a newer major version of
     Kanvaz than is currently running — VERSION was previously write-only
     (stamped into every save, never read back for any compatibility
     decision). This doesn't attempt real migration, just an honest
     heads-up instead of silently loading a possibly-mismatched shape. */
  function warnIfNewerVersion(data) {
    if (!data || typeof data.version !== 'string') return;
    var fileMajor = parseInt(data.version.split('.')[0], 10);
    var appMajor  = parseInt(VERSION.split('.')[0], 10);
    if (!isNaN(fileMajor) && !isNaN(appMajor) && fileMajor > appMajor) {
      KanvazUI.toast('This file was saved by a newer version of Kanvaz (v' + data.version + ') — some data may not display correctly.', 'error');
    }
  }

  /* ── Save to file ── */

  /* Extracted from saveBoard() below so a caller that already HAS a
     path (saveBoard's own currentPath branch, and the new MCP-Bridge-
     facing saveBoardToPath() further down) can write without ever
     going through the native OS Save dialog — that dialog requires a
     human mouse click, which an AI-driven call has no way to supply;
     a plugin calling it would just hang forever. */
  function writeSerialisedBoardTo(p, onDone) {
    if (!p) {
      if (onDone) onDone(false);
      return;
    }
    currentPath = p;
    KanvazApp.setCurrentPath(p);

    var data = serialise();
    var json;
    try {
      json = JSON.stringify(data, null, 2);
    } catch (e) {
      /* Audit fix: a plugin card's pluginData is arbitrary, plugin-
         controlled data with no guarantee of being JSON-safe (circular
         reference, a function, etc.) — an uncaught throw here used to
         mean Save could fail with zero feedback (an uncaught exception
         inside a directly-invoked function, not a promise chain, so
         there was no .catch() to reach). doAutosave() below already
         guards its own JSON.stringify this same way; Save/Save As
         didn't. Now: log which card, tell the user clearly, don't
         silently fail. */
      console.error('[Kanvaz] could not serialize board for save:', e.message);
      KanvazUI.toast('Save failed — a card\'s data could not be saved (see console)', 'error');
      if (onDone) onDone(false);
      return;
    }
    KanvazBridge.writeFile(p, json).then(function(result) {
      if (result.ok) {
        KanvazBridge.addRecent(p);
        KanvazApp.markClean();
        KanvazBridge.clearRecovery();
        KanvazUI.toast('Board saved', 'success');
        emitBoardEvent('boardSave');
        if (onDone) onDone(true);
      } else {
        KanvazUI.toast('Save failed: ' + result.error, 'error');
        if (onDone) onDone(false);
      }
    }).catch(function(e) {
      console.warn('[Kanvaz] writeFile IPC failed:', e);
      KanvazUI.toast('Save failed — could not reach the file system', 'error');
      if (onDone) onDone(false);
    });
  }

  function saveBoard(onDone) {
    saveCurrentBoardState();

    var savePath = currentPath;

    if (savePath) {
      writeSerialisedBoardTo(savePath, onDone);
    } else {
      var defaultName = (boards[activeIdx] ? boards[activeIdx].name : 'untitled') + '.kanvaz';
      KanvazBridge.saveFileDialog(defaultName).then(function(p) {
        writeSerialisedBoardTo(p, onDone);
      }).catch(function(e) {
        console.warn('[Kanvaz] saveFileDialog IPC failed:', e);
        KanvazUI.toast('Could not open the save dialog', 'error');
        if (onDone) onDone(false);
      });
    }
  }

  /* ── MCP Bridge / plugin-facing save (4.5.0) ──
     Same underlying write path as saveBoard() above, but NEVER opens
     the native OS Save dialog even on a first-time save — uses the
     board's existing currentPath if it has one (explicitPath is then
     ignored, same "don't silently redirect an already-placed file"
     behavior a human clicking plain Save would expect), otherwise
     requires explicitPath to establish one. Returns a Promise so the
     MCP tool handler can await a clean {ok, path} result instead of
     the callback style the rest of this file already uses internally. */
  function saveBoardToPath(explicitPath) {
    saveCurrentBoardState();
    var p = currentPath || explicitPath;
    if (!p) {
      return Promise.resolve({ ok: false, error: 'this board has no file path yet — pass a path to create one' });
    }
    return new Promise(function(resolve) {
      writeSerialisedBoardTo(p, function(ok) {
        resolve(ok ? { ok: true, path: p } : { ok: false, error: 'save failed — see Kanvaz for the exact reason' });
      });
    });
  }

  /* ── Save As ── */

  function saveBoardAs() {
    saveCurrentBoardState();
    var defaultName = (boards[activeIdx] ? boards[activeIdx].name : 'untitled') + '.kanvaz';
    KanvazBridge.saveFileDialog(defaultName).then(function(p) {
      if (!p) return;
      currentPath = p;
      KanvazApp.setCurrentPath(p);
      var data;
      try {
        data = JSON.stringify(serialise(), null, 2);
      } catch (e) {
        /* Audit fix — same reasoning as saveBoard()'s doSave() above. */
        console.error('[Kanvaz] could not serialize board for save:', e.message);
        KanvazUI.toast('Save failed — a card\'s data could not be saved (see console)', 'error');
        return;
      }
      KanvazBridge.writeFile(p, data).then(function(result) {
        if (result.ok) {
          KanvazBridge.addRecent(p);
          KanvazApp.markClean();
          KanvazBridge.clearRecovery();
          /* Fixed: was /[\/]/ (forward-slash only) — on Windows a path
             like C:\Users\name\project.kanvaz has no forward slash to
             split on, so .pop() returned the WHOLE absolute path
             instead of just the filename in the toast. */
          KanvazUI.toast('Board saved as ' + p.split(/[\\/]/).pop(), 'success');
          emitBoardEvent('boardSave');
        } else {
          /* Was a bare "Save failed" — dropped the actual reason, unlike
             saveBoard()'s equivalent toast just above. */
          KanvazUI.toast('Save failed: ' + result.error, 'error');
        }
      }).catch(function(e) {
        console.warn('[Kanvaz] writeFile IPC failed:', e);
        KanvazUI.toast('Save failed — could not reach the file system', 'error');
      });
    }).catch(function(e) {
      console.warn('[Kanvaz] saveFileDialog IPC failed:', e);
      KanvazUI.toast('Could not open the save dialog', 'error');
    });
  }

  /* ── Open board ── */

  function openBoard() {
    KanvazBridge.openFileDialog().then(function(p) {
      if (!p) return;
      openFilePath(p);
    }).catch(function(e) {
      console.warn('[Kanvaz] openFileDialog IPC failed:', e);
      KanvazUI.toast('Could not open the file dialog', 'error');
    });
  }

  /* ── Open a board given a path directly ──
     Shared by openBoard() (picked via dialog), the BUG 5 argv/open-file
     handler (double-clicking a .kanvaz file, or a second instance
     handing off its file to this one), and the startup screen's recent-
     boards list. Gated behind confirmDiscardIfDirty() (audit fix) so
     none of those paths can silently blow away unsaved work. */
  function openFilePath(p) {
    confirmDiscardIfDirty(function() {
      KanvazBridge.readFile(p).then(function(result) {
        if (!result.ok) {
          KanvazUI.toast('Could not open file', 'error');
          return;
        }
        try {
          var data = JSON.parse(result.data);
          /* Schema validation — accept current shape (data.boards) or a
             flat legacy shape (data.cards at top level); loadFromJSON
             migrates the legacy shape automatically. Anything else is
             genuinely not a Kanvaz file. */
          if (!data || (!Array.isArray(data.boards) && !Array.isArray(data.cards))) {
            KanvazUI.toast('File format not recognised', 'error');
            return;
          }
          warnIfNewerVersion(data);
          loadFromJSON(data);
          currentPath = p;
          KanvazApp.setCurrentPath(p);
          KanvazBridge.addRecent(p);
          KanvazApp.markClean();
          KanvazBridge.clearRecovery();
          /* Zoom to fit so cards are always visible */
          setTimeout(function() { KanvazCanvas.zoomFit(); }, 100);
          KanvazUI.toast('Board opened', 'success');
        } catch (e) {
          KanvazUI.toast('File appears corrupted', 'error');
        }
      }).catch(function(e) {
        console.warn('[Kanvaz] readFile IPC failed:', e);
        KanvazUI.toast('Could not read that file', 'error');
      });
    });
  }

  /* ── Load from JSON data ── */

  /* ══════════════════════════════════════════
     LEGACY FORMAT MIGRATION
     Every public version since v2.0.1 has required data.boards to
     exist, silently rejecting (or, worse, silently no-op'ing) any
     file that predates the boards[] wrapper — a genuine old-format
     file just appeared to load empty, with no real explanation.
     If we see a flat legacy shape (cards at the top level, no
     boards[] array), wrap it into a single synthetic board instead
     of discarding the user's content.
     ══════════════════════════════════════════ */
  function migrateLegacyShape(data) {
    if (!data) return null;
    if (Array.isArray(data.boards)) return data;               /* already current shape */
    if (!Array.isArray(data.cards)) return null;                /* not a recognisable shape at all */

    return {
      version:   data.version || '1.x (migrated)',
      activeIdx: 0,
      boards: [{
        id:          'legacy-board-' + Date.now(),
        name:        'Recovered Board',
        cards:       data.cards,
        canvasTx:    data.tx    || 0,
        canvasTy:    data.ty    || 0,
        canvasScale: data.scale || 1.0,
        mapTx: 0, mapTy: 0, mapScale: 1.0
      }],
      connections: data.connections || []
    };
  }

  function loadFromJSON(data) {
    if (!data || !data.boards) {
      var migrated = migrateLegacyShape(data);
      if (!migrated) return;
      data = migrated;
      if (typeof KanvazUI !== 'undefined') {
        KanvazUI.toast('Old Kanvaz file format detected — migrated automatically', 'success');
      }
    }

    boards    = data.boards;
    activeIdx = data.activeIdx || 0;

    /* v3: load connections (empty array for v2 files) */
    if (typeof KanvazConnections !== 'undefined') {
      KanvazConnections.deserialise(data.connections || []);
    }

    if (!boards.length) {
      newBoard(true);
      return;
    }

    /* Clear any active search — a newly opened file's cards were
       never filtered against it */
    if (typeof KanvazUI !== 'undefined' && KanvazUI.hideSearchBar) KanvazUI.hideSearchBar();

    /* Guard against a corrupted/malformed file pointing activeIdx past
       the end of the boards array — without this, boards[activeIdx]
       below is undefined and loadBoardState crashes on `.cards`. */
    if (activeIdx < 0 || activeIdx >= boards.length) activeIdx = 0;

    loadBoardState(boards[activeIdx]);
    renderTabs();
    updateTitle();
    KanvazHistory.clear();
  }

  /* ── Serialise entire file ── */

  function serialise() {
    saveCurrentBoardState();
    var out = {
      version:     VERSION,
      savedAt:     new Date().toISOString(),
      activeIdx:   activeIdx,
      boards:      boards
    };

    /* v3: include connections */
    if (typeof KanvazConnections !== 'undefined') {
      out.connections = KanvazConnections.serialise();
    }

    return out;
  }

  /* ── Autosave ── */

  function startAutosave() {
    if (autosaveTimer) clearInterval(autosaveTimer);
    var intervalMs = AUTOSAVE_MS;
    if (typeof KanvazUI_Extended !== 'undefined') {
      var s = KanvazUI_Extended.getSettings();
      if (s && s.autosaveInterval && s.autosaveInterval >= 10) {
        intervalMs = s.autosaveInterval * 1000;
      }
    }
    console.log('[Kanvaz] autosave started, interval=' + (intervalMs / 1000) + 's');
    autosaveTimer = setInterval(function() {
      doAutosave();
    }, intervalMs);
  }

  var autosaveInFlight = false;

  /* Audit fix: this used to run unconditionally on every tick regardless
     of whether anything had actually changed — re-serializing every
     card's full embedded dataUrl (JSON.stringify on the renderer's main
     thread), sending it whole over IPC, and writing it to disk, every
     30s, forever, even on a board the user has only been panning
     around. On a media-heavy board that's a real periodic hitch plus
     needless disk-write amplification for zero benefit. Also had no
     guard against a new tick starting while a previous write was still
     in flight (autosaveInFlight below). */
  function doAutosave() {
    if (typeof KanvazApp !== 'undefined' && KanvazApp.isDirty && !KanvazApp.isDirty()) return;
    if (autosaveInFlight) return;

    saveCurrentBoardState();
    try {
      var data = JSON.stringify(serialise());
    } catch (e) {
      console.warn('[Kanvaz] autosave serialise failed:', e.message);
      return;
    }
    autosaveInFlight = true;
    KanvazBridge.writeRecovery(data).then(function(r) {
      autosaveInFlight = false;
      if (!r || !r.ok) {
        console.warn('[Kanvaz] autosave recovery write failed');
      } else {
        /* Brief "recovery saved" indicator so user knows autosave works */
        var el = document.getElementById('status-autosave');
        if (el) {
          el.textContent = '\u2713 Recovery saved';
          el.style.opacity = '1';
          setTimeout(function() { el.style.opacity = '0'; }, 2000);
        }
      }
    }).catch(function(e) {
      autosaveInFlight = false;
      console.warn('[Kanvaz] writeRecovery IPC failed:', e);
    });

    /* Note: deliberately does NOT also write to currentPath. Autosave's
       job is crash recovery (the recovery file above). Writing the user's
       unsaved edits into their ACTUAL file every 30s would silently
       undermine the "Don't Save" choice in the unsaved-changes-on-close
       dialog — by the time the user picks "Don't Save", the edits would
       already be on disk in their real file. Only explicit Save/Save As/
       the close-confirmation Save action should touch currentPath. */
  }

  /* ── Startup screen ── */

  function showStartupScreen() {
    /* Respect openOnStartup setting — check is INSIDE the async callback
       rather than at the top, because loadSettings() runs asynchronously
       via IPC and may not have completed yet when showStartupScreen() is
       first called during init(). By the time getRecent() resolves, the
       settings IPC will have resolved too. */
    KanvazBridge.getRecent().then(function(recent) {
      if (!recent || !recent.length) return;


      if (typeof KanvazUI_Extended !== 'undefined') {
        var s = KanvazUI_Extended.getSettings();
        if (s && s.openOnStartup === false) return;
      }

      var overlay = document.createElement('div');
      overlay.id = 'startup-screen';
      overlay.style.cssText = [
        'position:fixed',
        'inset:0',
        'background:rgba(14,14,16,0.92)',
        'z-index:99998',
        'display:flex',
        'align-items:center',
        'justify-content:center',
        'backdrop-filter:blur(4px)'
      ].join(';');

      var panel = document.createElement('div');
      panel.style.cssText = [
        'background:var(--color-surface)',
        'border:1px solid var(--color-border-2)',
        'border-radius:12px',
        'padding:28px',
        'width:400px',
        'max-height:80vh',
        'overflow-y:auto',
        'box-shadow:0 24px 64px rgba(0,0,0,0.7)'
      ].join(';');

      /* Logo row */
      var logoRow = document.createElement('div');
      logoRow.style.cssText = 'display:flex;align-items:center;gap:10px;margin-bottom:20px;';
      logoRow.innerHTML = '<svg width="24" height="24" viewBox="0 0 18 18" fill="none"><rect x="2" y="6" width="12" height="9" rx="2" fill="#2A2A35"/><rect x="3" y="4" width="12" height="9" rx="2" fill="#1A1A22" stroke="#2E2E3A" stroke-width="0.5"/><rect x="4" y="2" width="12" height="9" rx="2" fill="#DCDCE8"/><circle cx="14" cy="3" r="2" fill="#4A9EFF"/></svg><span style="font-size:18px;font-weight:600;color:var(--color-text);">Kanvaz</span>';
      panel.appendChild(logoRow);

      /* Recent files */
      var label = document.createElement('div');
      label.textContent = 'Recent boards';
      label.style.cssText = 'font-size:11px;color:var(--color-text-3);margin-bottom:8px;text-transform:uppercase;letter-spacing:0.06em;';
      panel.appendChild(label);

      for (var i = 0; i < recent.length; i++) {
        (function(p) {
          var row = document.createElement('div');
          row.style.cssText = [
            'display:flex',
            'align-items:center',
            'gap:8px',
            'padding:8px 10px',
            'border-radius:6px',
            'cursor:pointer',
            'transition:background 0.1s'
          ].join(';');

          var parts = p.split(/[\\/]/);
          var fname = parts[parts.length - 1];
          var dir   = parts.slice(0, -1).join('/');

          /* Security fix: fname/dir come from a filesystem path that can
             originate from a .kanvaz file someone else shared (added to
             recent.json via the argv/open-file handoff, not just the
             user's own Save dialog). This used to be concatenated
             straight into row.innerHTML with no escaping — a crafted
             filename could inject HTML/script, and since 4.2.0's CSP
             allows script-src file:, an injected <script src="file://...">
             would actually execute. The icon SVG is static/trusted
             markup so it's still set via innerHTML; the two untrusted
             strings are now set via textContent, which can never be
             interpreted as markup. */
          var iconHolder = document.createElement('div');
          iconHolder.innerHTML = '<svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M2 3.5A1.5 1.5 0 013.5 2h2.086a1 1 0 01.707.293l.914.914H10.5A1.5 1.5 0 0112 4.707V9.5A1.5 1.5 0 0110.5 11h-8A1.5 1.5 0 011 9.5V3.5z" stroke="var(--color-text-3)" stroke-width="1.2"/></svg>';
          row.appendChild(iconHolder.firstChild);

          var textCol = document.createElement('div');
          textCol.style.cssText = 'flex:1;overflow:hidden;';

          var fnameEl = document.createElement('div');
          fnameEl.style.cssText = 'font-size:13px;color:var(--color-text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
          fnameEl.textContent = fname;

          var dirEl = document.createElement('div');
          dirEl.style.cssText = 'font-size:10px;color:var(--color-text-3);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-family:var(--font-mono);';
          dirEl.textContent = dir;

          textCol.appendChild(fnameEl);
          textCol.appendChild(dirEl);
          row.appendChild(textCol);

          row.onmouseenter = function() { row.style.background = 'var(--color-surface-2)'; };
          row.onmouseleave = function() { row.style.background = 'transparent'; };

          /* Reuses openFilePath() (was previously a duplicate inline
             copy of its readFile/parse/load logic) — picks up the same
             unsaved-changes guard and newer-version warning for free,
             and removes the drift risk of two copies of this logic. */
          row.onclick = function() {
            closeStartup();
            openFilePath(p);
          };

          panel.appendChild(row);
        })(recent[i]);
      }

      /* New board button */
      var newBtn = document.createElement('button');
      newBtn.textContent = 'Start with empty board';
      newBtn.style.cssText = [
        'margin-top:16px',
        'width:100%',
        'padding:9px',
        'background:var(--color-accent-bg)',
        'border:1px solid var(--color-accent)',
        'border-radius:6px',
        'color:var(--color-accent)',
        'font-family:var(--font-ui)',
        'font-size:13px',
        'cursor:pointer',
        'transition:background 0.1s'
      ].join(';');
      newBtn.onmouseenter = function() { newBtn.style.background = 'rgba(var(--color-accent-rgb),0.2)'; };
      newBtn.onmouseleave = function() { newBtn.style.background = 'var(--color-accent-bg)'; };
      newBtn.onclick = closeStartup;
      panel.appendChild(newBtn);

      overlay.appendChild(panel);
      document.body.appendChild(overlay);

      /* Close on backdrop click */
      overlay.onclick = function(e) {
        if (e.target === overlay) closeStartup();
      };
    }).catch(function(e) {
      console.warn('[Kanvaz] getRecent IPC failed:', e);
    });
  }

  function closeStartup() {
    var el = document.getElementById('startup-screen');
    if (el && el.parentNode) el.parentNode.removeChild(el);
  }

  /* ── Title bar update ── */

  function updateTitle() {
    var el = document.getElementById('titlebar-title');
    if (!el) return;
    var name = boards[activeIdx] ? boards[activeIdx].name : 'Untitled';
    var base = currentPath ? currentPath.split(/[\\/]/).pop() : name;

    /* Phase 3 — unsaved changes dot. Single authoritative place that
       writes #titlebar-title, so the dot can't go stale on board
       switch/delete the way a second, independent writer would. Built
       as text + a colored span rather than one text blob so the dot
       can pick up the same amber "unsaved" color used in the status
       bar, instead of inheriting the plain title color. */
    var dirty = (typeof KanvazApp !== 'undefined' && KanvazApp.isDirty) ? KanvazApp.isDirty() : false;
    el.textContent = base;
    if (dirty) {
      var dot = document.createElement('span');
      dot.className = 'titlebar-dirty-dot';
      dot.textContent = ' ●';
      dot.title = 'Unsaved changes';
      el.appendChild(dot);
    }
  }

  return {
    init:         init,
    newBoard:     newBoard,
    openBoard:    openBoard,
    openFilePath: openFilePath,
    updateTitle:  updateTitle,
    saveBoard:    saveBoard,
    saveBoardAs:  saveBoardAs,
    loadFromJSON: loadFromJSON,
    serialise:    serialise,
    doAutosave:      doAutosave,
    startAutosave:   startAutosave,
    getVersion:      function() { return VERSION; },
    getActiveBoardInfo: getActiveBoardInfo,
    saveBoardToPath:  saveBoardToPath,
    listBoardsInfo:   listBoardsInfo,
    switchBoardById:  switchBoardById,
    renameBoardById:  renameBoardById,
    deleteBoardById:  deleteBoardById
  };

})();
