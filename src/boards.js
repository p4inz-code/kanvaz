/* boards.js — board tab system, save/load, autosave, startup screen */

var KanvazBoards = (function() {

  var boards        = [];     /* array of { id, name, cards, canvas } */
  var activeIdx     = 0;
  var currentPath   = null;
  var autosaveTimer = null;
  var AUTOSAVE_MS   = 30000;
  var VERSION       = '3.6.9';

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
  }

  /* ── New board ── */

  function newBoard(silent) {
    saveCurrentBoardState();

    var id = 'board-' + Date.now();
    var board = {
      id:       id,
      name:     'Board ' + (boards.length + 1),
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

    renderTabs();
    updateTitle();

    if (!silent) KanvazUI.toast('New board created');
  }

  /* ── Switch board ── */

  function switchBoard(idx) {
    if (idx === activeIdx) return;
    saveCurrentBoardState();
    activeIdx = idx;

    /* Close inspector — cards will be different on the new board */
    if (typeof KanvazInspector !== 'undefined') KanvazInspector.close();

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
    KanvazCanvas.panTo(board.canvasTx || 0, board.canvasTy || 0);
    KanvazCanvas.setZoom(board.canvasScale || 1.0);

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
      boards[idx].name = val;
      renderTabs();
    }

    input.onblur = commit;
    input.onkeydown = function(e) {
      if (e.key === 'Enter') { e.preventDefault(); commit(); }
      if (e.key === 'Escape') { renderTabs(); }
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

            /* Cascade-delete connections for all cards on this board */
            if (typeof KanvazConnections !== 'undefined' && boards[idx].cards) {
              for (var ci = 0; ci < boards[idx].cards.length; ci++) {
                KanvazConnections.removeAllFor(boards[idx].cards[ci].id);
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

  /* ── Save to file ── */

  function saveBoard(onDone) {
    saveCurrentBoardState();

    var savePath = currentPath;

    function doSave(p) {
      if (!p) {
        if (onDone) onDone(false);
        return;
      }
      currentPath = p;
      KanvazApp.setCurrentPath(p);

      var data = serialise();
      KanvazBridge.writeFile(p, JSON.stringify(data, null, 2)).then(function(result) {
        if (result.ok) {
          KanvazBridge.addRecent(p);
          KanvazApp.markClean();
          KanvazBridge.clearRecovery();
          KanvazUI.toast('Board saved', 'success');
          if (onDone) onDone(true);
        } else {
          KanvazUI.toast('Save failed: ' + result.error, 'error');
          if (onDone) onDone(false);
        }
      });
    }

    if (savePath) {
      doSave(savePath);
    } else {
      var defaultName = (boards[activeIdx] ? boards[activeIdx].name : 'untitled') + '.kanvaz';
      KanvazBridge.saveFileDialog(defaultName).then(function(p) {
        doSave(p);
      });
    }
  }

  /* ── Save As ── */

  function saveBoardAs() {
    saveCurrentBoardState();
    var defaultName = (boards[activeIdx] ? boards[activeIdx].name : 'untitled') + '.kanvaz';
    KanvazBridge.saveFileDialog(defaultName).then(function(p) {
      if (!p) return;
      currentPath = p;
      KanvazApp.setCurrentPath(p);
      var data = JSON.stringify(serialise(), null, 2);
      KanvazBridge.writeFile(p, data).then(function(result) {
        if (result.ok) {
          KanvazBridge.addRecent(p);
          KanvazApp.markClean();
          KanvazBridge.clearRecovery();
          KanvazUI.toast('Board saved as ' + p.split(/[\/]/).pop(), 'success');
        } else {
          KanvazUI.toast('Save failed', 'error');
        }
      });
    });
  }

  /* ── Open board ── */

  function openBoard() {
    KanvazBridge.openFileDialog().then(function(p) {
      if (!p) return;
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

  function doAutosave() {
    saveCurrentBoardState();
    try {
      var data = JSON.stringify(serialise());
    } catch (e) {
      console.warn('[Kanvaz] autosave serialise failed:', e.message);
      return;
    }
    KanvazBridge.writeRecovery(data).then(function(r) {
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

          row.innerHTML = '<svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M2 3.5A1.5 1.5 0 013.5 2h2.086a1 1 0 01.707.293l.914.914H10.5A1.5 1.5 0 0112 4.707V9.5A1.5 1.5 0 0110.5 11h-8A1.5 1.5 0 011 9.5V3.5z" stroke="var(--color-text-3)" stroke-width="1.2"/></svg>'
            + '<div style="flex:1;overflow:hidden;">'
            + '<div style="font-size:13px;color:var(--color-text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + fname + '</div>'
            + '<div style="font-size:10px;color:var(--color-text-3);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-family:var(--font-mono);">' + dir + '</div>'
            + '</div>';

          row.onmouseenter = function() { row.style.background = 'var(--color-surface-2)'; };
          row.onmouseleave = function() { row.style.background = 'transparent'; };

          row.onclick = function() {
            closeStartup();
            KanvazBridge.readFile(p).then(function(result) {
              if (!result.ok) {
                KanvazUI.toast('File not found', 'error');
                KanvazBridge.removeRecent(p);
                return;
              }
              try {
                var data = JSON.parse(result.data);
                if (!data || (!Array.isArray(data.boards) && !Array.isArray(data.cards))) {
                  KanvazUI.toast('File format not recognised', 'error');
                  return;
                }
                loadFromJSON(data);
                currentPath = p;
                KanvazApp.setCurrentPath(p);
                KanvazBridge.addRecent(p);
                KanvazApp.markClean();
                KanvazBridge.clearRecovery();
                setTimeout(function() { KanvazCanvas.zoomFit(); }, 100);
                KanvazUI.toast('Board opened', 'success');
              } catch (e) {
                KanvazUI.toast('File appears corrupted', 'error');
              }
            });
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
    el.textContent = currentPath
      ? currentPath.split(/[\\/]/).pop()
      : name;
  }

  return {
    init:         init,
    newBoard:     newBoard,
    openBoard:    openBoard,
    saveBoard:    saveBoard,
    saveBoardAs:  saveBoardAs,
    loadFromJSON: loadFromJSON,
    serialise:    serialise,
    doAutosave:      doAutosave,
    startAutosave:   startAutosave,
    getVersion:      function() { return VERSION; }
  };

})();
