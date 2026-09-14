/* boards.js — board tab system, save/load, autosave, startup screen */

var KanvazBoards = (function() {

  var boards        = [];     /* array of { id, name, cards, canvas } */
  var activeIdx     = 0;
  var currentPath   = null;
  var autosaveTimer = null;
  var AUTOSAVE_MS   = 30000;
  var VERSION       = '7.16.0';

  /* ── Shared cards (v6.4.0) — "same card, no duplicate, edit once
     updates everywhere" (Are.na-style), across boards in ONE .kanvaz
     file. A shared card's real content (text, media reference, color,
     annotations, tags — everything except its position/size on a given
     board) lives ONCE in this registry, keyed by a stable sharedId that
     survives copies. Every board that has an instance of it stores only
     a lightweight stub in its own cards[] array — see cards.js's
     serialise()/deserialise() for the stub/content split. Because only
     one board is ever "live" in KanvazCards at a time, the other boards'
     stubs are re-merged with whatever's currently in this registry the
     next time THEY become active — so an edit made while board A is open
     is already there once you switch to board B, with zero real-time
     sync machinery needed. */
  var sharedCards = {}; /* { sharedId: contentFields } */

  function newSharedId() {
    return 'shared-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
  }

  function getSharedCardContent(sharedId) {
    return sharedCards[sharedId] || null;
  }

  function setSharedCardContent(sharedId, content) {
    sharedCards[sharedId] = content;
  }

  /* Rollback helper for a failed shareCardToBoard() call (cards.js) —
     removes a registry entry that was only ever written speculatively,
     before its first (and, at the time of the failed call, only) board
     instance actually got added. pruneUnusedSharedCards() would also
     catch this on the next serialise(), but cleaning it up immediately
     avoids a stale entry sitting in memory (and, if the app crashes
     before the next save, in a recovery-file snapshot) in the meantime. */
  function deleteSharedCardContent(sharedId) {
    delete sharedCards[sharedId];
  }

  /* A shared card stub is only useful as long as SOME board still has an
     instance pointing at it — otherwise it's dead weight sitting in the
     save file forever (e.g. every instance got unlinked or deleted).
     Called from serialise() below, after saveCurrentBoardState() has
     synced the active board, so every board's .cards array reflects
     current membership. */
  function pruneUnusedSharedCards() {
    var used = {};
    for (var i = 0; i < boards.length; i++) {
      var bc = boards[i].cards || [];
      for (var j = 0; j < bc.length; j++) {
        if (bc[j].sharedId) used[bc[j].sharedId] = true;
      }
    }
    for (var id in sharedCards) {
      if (!used[id]) delete sharedCards[id];
    }
  }

  /* Adds a new instance of an already-shared card to a DIFFERENT board's
     serialised cards[] array. Deliberately refuses the currently active
     board — that board's real state lives in KanvazCards, not in this
     stale snapshot, so appending here would be invisible until the next
     switch/save and could be clobbered by saveCurrentBoardState() before
     that. The active board doesn't need this anyway: "share to a board"
     only makes sense for a board you're not already looking at. */
  function addSharedInstanceToBoard(targetBoardId, stub) {
    var idx = findBoardIndexById(targetBoardId);
    if (idx === -1) return { ok: false, error: 'no board with that id' };
    if (idx === activeIdx) return { ok: false, error: 'that board is already open' };
    if (!boards[idx].cards) boards[idx].cards = [];
    boards[idx].cards.push(stub);
    renderBoardsList();
    return { ok: true };
  }

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
    newBoard(true);
    /* Note: startAutosave() is called from KanvazUI_Extended.applySettings()
       after settings have loaded — calling it here would use the wrong
       interval since settings.autosaveInterval isn't loaded yet. */
    showStartupScreen();
  }

  /* v7.x redesign — renders into the left side panel's Boards section
     (a vertical list) instead of the old horizontal top tab strip,
     which is removed entirely. `container` is only passed the first
     time (when sidepanel.js switches to this section); every other
     call site below (switchBoard, newBoard, deleteBoard, etc.) just
     calls renderBoardsList() with no args to refresh wherever it was
     last rendered — same remembered-container pattern ui.js's Settings
     section uses. */
  var lastBoardsContainer = null;

  function renderBoardsList(container) {
    container = container || lastBoardsContainer;
    if (!container) return;
    lastBoardsContainer = container;
    container.innerHTML = '';

    var list = document.createElement('div');
    list.style.cssText = 'padding:8px;';

    for (var i = 0; i < boards.length; i++) {
      (function(idx) {
        var isActive = (idx === activeIdx);
        var row = document.createElement('div');
        row.style.cssText = [
          'display:flex',
          'align-items:center',
          'gap:8px',
          'padding:8px 10px',
          'margin-bottom:2px',
          'cursor:pointer',
          'border-radius:6px',
          'background:' + (isActive ? 'var(--color-accent-bg)' : 'transparent'),
          'color:' + (isActive ? 'var(--color-accent)' : 'var(--color-text-2)'),
          'transition:background 0.1s, color 0.1s'
        ].join(';');

        if (!isActive) {
          row.onmouseenter = function() { row.style.background = 'var(--color-surface-2)'; };
          row.onmouseleave = function() { row.style.background = 'transparent'; };
        }

        var nameSpan = document.createElement('span');
        nameSpan.textContent = boards[idx].name;
        nameSpan.style.cssText = 'overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1;font-size:13px;';
        row.appendChild(nameSpan);

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
          row.appendChild(countBadge);
        }

        /* Close/delete button — only show if more than 1 board */
        if (boards.length > 1) {
          var closeBtn = document.createElement('button');
          closeBtn.innerHTML = '&times;';
          closeBtn.title = 'Delete board';
          closeBtn.style.cssText = 'background:none;border:none;cursor:pointer;color:var(--color-text-3);font-size:14px;font-family:var(--font-ui);padding:0;line-height:1;flex-shrink:0;';
          closeBtn.onclick = function(e) {
            e.stopPropagation();
            deleteBoard(idx);
          };
          row.appendChild(closeBtn);
        }

        row.onclick = function() { switchBoard(idx); };

        /* Double-click to rename */
        row.ondblclick = function(e) {
          e.stopPropagation();
          renameBoard(idx, nameSpan);
        };

        list.appendChild(row);
      })(i);
    }
    container.appendChild(list);

    /* New board / Start from Template */
    var actionsRow = document.createElement('div');
    actionsRow.style.cssText = 'display:flex;gap:6px;padding:0 8px 8px;';

    var addBtn = document.createElement('button');
    addBtn.textContent = '+ New board';
    addBtn.style.cssText = 'flex:1;padding:7px;background:var(--color-accent-bg);border:1px solid var(--color-accent);border-radius:6px;color:var(--color-accent);font-family:var(--font-ui);font-size:12px;cursor:pointer;transition:background 0.1s;';
    addBtn.onmouseenter = function() { addBtn.style.background = 'rgba(157,127,255,0.15)'; };
    addBtn.onmouseleave = function() { addBtn.style.background = 'var(--color-accent-bg)'; };
    addBtn.onclick = function() { newBoard(false); };
    actionsRow.appendChild(addBtn);

    /* v5.1.0 — "Start from Template" sits right next to "New board"
       since it's the same decision point (what should this new board
       start as), not buried in Settings the way plugin browsing is. */
    var templateBtn = document.createElement('button');
    templateBtn.textContent = 'Template';
    templateBtn.title = 'Start from Template';
    templateBtn.style.cssText = 'padding:7px 10px;background:transparent;border:1px solid var(--color-border);border-radius:6px;color:var(--color-text-2);font-family:var(--font-ui);font-size:12px;cursor:pointer;transition:background 0.1s;';
    templateBtn.onmouseenter = function() { templateBtn.style.background = 'var(--color-surface-2)'; };
    templateBtn.onmouseleave = function() { templateBtn.style.background = 'transparent'; };
    templateBtn.onclick = function() { renderTemplateGalleryInto(container); };
    actionsRow.appendChild(templateBtn);
    container.appendChild(actionsRow);

    /* Quick drop — drop a file directly onto this zone to add it to the
       currently active board, without needing the canvas visible at
       all (useful once the panel covers enough of the screen, or on a
       smaller window). Reuses the exact same drop-handling path the
       main canvas drop target already goes through (KanvazApp.
       handleDroppedFiles) — a default position near the current
       viewport center, same reasoning ui.js's "Generate test cards"
       button already uses for where to place things when there's no
       real drop coordinate to anchor to. */
    var quickDrop = document.createElement('div');
    quickDrop.style.cssText = 'margin:4px 8px 8px;padding:16px 8px;border:1.5px dashed var(--color-border-2);border-radius:8px;text-align:center;color:var(--color-text-3);font-size:11px;line-height:1.5;transition:border-color 0.1s, background 0.1s;';
    quickDrop.textContent = 'Quick drop — paste an image or drag media anywhere onto the board.';
    quickDrop.ondragover = function(e) {
      e.preventDefault();
      quickDrop.style.borderColor = 'var(--color-accent)';
      quickDrop.style.background = 'var(--color-accent-bg)';
    };
    quickDrop.ondragleave = function() {
      quickDrop.style.borderColor = 'var(--color-border-2)';
      quickDrop.style.background = 'transparent';
    };
    quickDrop.ondrop = function(e) {
      e.preventDefault();
      quickDrop.style.borderColor = 'var(--color-border-2)';
      quickDrop.style.background = 'transparent';
      if (typeof KanvazApp === 'undefined' || !KanvazApp.handleDroppedFiles) return;
      var files = e.dataTransfer ? e.dataTransfer.files : null;
      if (!files || !files.length) return;
      var vp = (typeof KanvazCanvas !== 'undefined') ? KanvazCanvas.getViewport() : null;
      var worldPos = vp
        ? { x: (-vp.tx / vp.scale) + 200, y: (-vp.ty / vp.scale) + 200 }
        : { x: 200, y: 200 };
      KanvazApp.handleDroppedFiles(files, worldPos);
    };
    container.appendChild(quickDrop);

    renderSmartFoldersInto(container);
  }

  /* Smart Folders — saved search queries (app.js's search bar, the
     star button). Direct feedback: "where will user actually see the
     smart folders?... i made smart folder but i cnat see it anywhere."
     They were only ever visible as chips under the search bar itself,
     which meant reopening search (Ctrl+F) was the only way to find one
     again after closing it. A persistent list here — the same side
     panel section that already lists boards and templates — means a
     saved search stays discoverable without having to remember it
     exists. Clicking one opens the search bar with that query applied,
     same result as typing it in fresh. */
  function renderSmartFoldersInto(container) {
    if (typeof KanvazUI_Extended === 'undefined') return;
    var s = KanvazUI_Extended.getSettings();
    /* Favorites first — same ordering as the search bar's own chip row
       (app.js's renderSmartFolderChips); .slice() first so sort() never
       mutates the underlying settings.json array as a side effect of
       just rendering it. */
    var folders = ((s && s.smartFolders) || []).slice().sort(function(a, b) {
      return (b.favorite ? 1 : 0) - (a.favorite ? 1 : 0);
    });

    var heading = document.createElement('div');
    heading.textContent = 'SMART FOLDERS';
    heading.style.cssText = 'font-size:10px;font-weight:600;letter-spacing:0.06em;color:var(--color-text-3);padding:10px 8px 4px;';
    container.appendChild(heading);

    /* Direct feedback: "where will user actually see the smart
       folders?... i made smart folder but i can't see it anywhere" —
       this whole section used to return early (render nothing at all)
       until at least one existed, which meant there was zero indication
       here of what a Smart Folder even is or how to make one. A short,
       permanent how-to takes that early-return's place instead of
       nothing. */
    if (!folders.length) {
      var hint = document.createElement('div');
      hint.style.cssText = 'padding:0 8px 12px;font-size:11px;line-height:1.5;color:var(--color-text-3);';
      hint.textContent = 'None yet. Open Search (Ctrl+F), type a query, then click the star icon to save it here for one click next time.';
      container.appendChild(hint);
      return;
    }

    var list = document.createElement('div');
    list.style.cssText = 'padding:0 8px 8px;';

    for (var i = 0; i < folders.length; i++) {
      (function(folder) {
        var row = document.createElement('div');
        row.style.cssText = 'display:flex;align-items:center;gap:8px;padding:7px 10px;margin-bottom:2px;cursor:pointer;border-radius:6px;color:var(--color-text-2);transition:background 0.1s;';
        row.onmouseenter = function() { row.style.background = 'var(--color-surface-2)'; };
        row.onmouseleave = function() { row.style.background = 'transparent'; };

        var icon = document.createElement('span');
        icon.style.cssText = 'display:flex;color:' + (folder.favorite ? 'var(--color-red)' : 'var(--color-text-3)') + ';flex-shrink:0;';
        /* Favorited folders get the same filled heart the search bar's
           own chip row uses — one visual language for "this one" across
           both places a Smart Folder shows up. */
        icon.innerHTML = folder.favorite
          ? '<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M12 21s-6.7-4.35-9.3-8.1C1 10.3 1.7 6.9 4.6 5.4 6.9 4.2 9.6 5 12 7.3 14.4 5 17.1 4.2 19.4 5.4c2.9 1.5 3.6 4.9 1.9 7.5C18.7 16.65 12 21 12 21z"/></svg>'
          : '<svg width="12" height="12" viewBox="0 0 14 14" fill="none"><path d="M7 1.5l1.6 3.4 3.7.5-2.7 2.6.6 3.7L7 9.9l-3.2 1.8.6-3.7-2.7-2.6 3.7-.5L7 1.5z" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/></svg>';
        row.appendChild(icon);

        var label = document.createElement('span');
        label.textContent = folder.name;
        label.style.cssText = 'flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:13px;';
        row.appendChild(label);

        var del = document.createElement('span');
        del.textContent = '×';
        del.title = 'Delete this Smart Folder';
        del.style.cssText = 'color:var(--color-text-3);cursor:pointer;flex-shrink:0;';
        del.addEventListener('click', function(e) {
          e.stopPropagation();
          var s2 = KanvazUI_Extended.getSettings();
          s2.smartFolders = (s2.smartFolders || []).filter(function(f) { return f.id !== folder.id; });
          KanvazBridge.writeSettings(JSON.stringify(s2));
          renderBoardsList(container);
        });
        row.appendChild(del);

        row.addEventListener('click', function() {
          if (typeof KanvazUI !== 'undefined' && KanvazUI.showSearchBar) {
            KanvazUI.showSearchBar();
            setTimeout(function() {
              var input = document.querySelector('#search-bar input');
              if (input) {
                input.value = folder.query;
                input.dispatchEvent(new Event('input', { bubbles: true }));
              }
            }, 0);
          }
        });

        /* Direct feedback: "right click on search will give options
           open, fav it with heart svg and more" — same shared
           smartFolder context-menu branch the search bar's own chips
           use (app.js's showContextMenu), so Open/Favorite/Rename/Edit
           query/Delete stay one implementation, not two copies drifting
           apart between this panel and the search bar row. */
        row.addEventListener('contextmenu', function(e) {
          e.preventDefault();
          if (typeof KanvazUI !== 'undefined' && KanvazUI.showContextMenu) {
            KanvazUI.showContextMenu(e.clientX, e.clientY, 'smartFolder', folder);
          }
        });

        list.appendChild(row);
      })(folders[i]);
    }
    container.appendChild(list);
  }

  /* ── Start from Template (moved inline, v7.x redesign) ──
     Used to be ui.js's showTemplateGallery() — a fixed centered modal
     popup. Direct feedback: this space (the Boards section of the side
     panel) already exists for exactly this decision (what should a new
     board start as), so the gallery now renders IN PLACE of the boards
     list here instead of opening a popup on top of everything, with a
     "← Boards" button to go back. Same KanvazBridge.listTemplates()/
     loadTemplate() calls the old popup used — only the container and
     the back-navigation are new. */
  function renderTemplateGalleryInto(container) {
    container.innerHTML = '';
    lastBoardsContainer = container;

    var header = document.createElement('div');
    header.style.cssText = 'display:flex;align-items:center;gap:8px;padding:10px 8px 4px;';

    var backBtn = document.createElement('button');
    backBtn.textContent = '← Boards';
    backBtn.style.cssText = 'background:none;border:none;color:var(--color-text-2);font-family:var(--font-ui);font-size:12px;cursor:pointer;padding:2px 0;';
    backBtn.onclick = function() { renderBoardsList(container); };
    header.appendChild(backBtn);
    container.appendChild(header);

    var title = document.createElement('div');
    title.style.cssText = 'font-size:14px;font-weight:600;color:var(--color-text);padding:4px 8px 2px;';
    title.textContent = 'Start from Template';
    container.appendChild(title);

    var sub = document.createElement('div');
    sub.style.cssText = 'font-size:11px;color:var(--color-text-3);padding:0 8px 12px;';
    sub.textContent = 'Bundled with Kanvaz — no network call, ever.';
    container.appendChild(sub);

    /* Save current board as a new user template. Renders its own tiny
       inline name/description form in place of the button on click,
       same "expand in place, no popup" pattern the redesign already
       uses (see sidepanel.js's profile edit form). User templates are
       machine-wide (userData/templates/, not per-profile) — a starter-
       board layout someone builds is a reusable asset, not a per-
       profile preference the way settings/recents are. */
    var saveRow = document.createElement('div');
    saveRow.style.cssText = 'padding:0 8px 12px;';
    var saveBtn = document.createElement('button');
    saveBtn.textContent = '+ Save current board as template';
    saveBtn.style.cssText = 'width:100%;padding:7px;background:transparent;border:1px dashed var(--color-border-2);border-radius:6px;color:var(--color-text-2);font-family:var(--font-ui);font-size:12px;cursor:pointer;';
    saveRow.appendChild(saveBtn);
    container.appendChild(saveRow);

    var listEl = document.createElement('div');
    listEl.style.cssText = 'padding:0 8px;font-size:12px;color:var(--color-text-3);';
    listEl.textContent = 'Loading…';
    container.appendChild(listEl);

    function reloadList() { renderTemplateGalleryInto(container); }

    saveBtn.onclick = function() {
      saveRow.innerHTML = '';
      var nameInput = document.createElement('input');
      nameInput.type = 'text';
      nameInput.placeholder = 'Template name';
      nameInput.style.cssText = 'width:100%;box-sizing:border-box;padding:6px 8px;margin-bottom:6px;background:var(--color-surface-2);border:1px solid var(--color-border-2);border-radius:5px;color:var(--color-text);font-family:var(--font-ui);font-size:12px;';
      var descInput = document.createElement('input');
      descInput.type = 'text';
      descInput.placeholder = 'Description (optional)';
      descInput.style.cssText = nameInput.style.cssText;
      var btnRow = document.createElement('div');
      btnRow.style.cssText = 'display:flex;gap:6px;';
      var confirmBtn = document.createElement('button');
      confirmBtn.textContent = 'Save';
      confirmBtn.style.cssText = 'flex:1;padding:6px;background:var(--color-accent);border:none;border-radius:5px;color:#fff;font-family:var(--font-ui);font-size:12px;font-weight:600;cursor:pointer;';
      var cancelBtn = document.createElement('button');
      cancelBtn.textContent = 'Cancel';
      cancelBtn.style.cssText = 'flex:1;padding:6px;background:var(--color-surface-2);border:1px solid var(--color-border-2);border-radius:5px;color:var(--color-text-2);font-family:var(--font-ui);font-size:12px;cursor:pointer;';
      cancelBtn.onclick = reloadList;
      confirmBtn.onclick = function() {
        var name = nameInput.value.trim();
        if (!name) { nameInput.focus(); return; }
        confirmBtn.disabled = true;
        confirmBtn.textContent = 'Saving…';
        var cards = (typeof KanvazCards !== 'undefined') ? KanvazCards.serialise() : [];
        if (!cards.length) {
          KanvazUI.toast('Nothing on this board to save as a template', 'error');
          reloadList();
          return;
        }
        KanvazBridge.saveTemplate(name, descInput.value, cards).then(function(res) {
          if (!res || !res.ok) {
            KanvazUI.toast((res && res.error) || 'Could not save template', 'error');
            reloadList();
            return;
          }
          KanvazUI.toast('Saved "' + name + '" as a template');
          reloadList();
        }).catch(function(e) {
          KanvazUI.toast('Could not save template: ' + e.message, 'error');
          reloadList();
        });
      };
      btnRow.appendChild(confirmBtn);
      btnRow.appendChild(cancelBtn);
      saveRow.appendChild(nameInput);
      saveRow.appendChild(descInput);
      saveRow.appendChild(btnRow);
      nameInput.focus();
    };

    if (typeof KanvazBridge === 'undefined' || !KanvazBridge.listTemplates) {
      listEl.textContent = 'Not available in this build.';
      return;
    }

    KanvazBridge.listTemplates().then(function(result) {
      /* Stale-response guard: the user may have clicked "← Boards"
         (or switched to a different section entirely) before this
         promise resolved — container would then belong to whatever
         renders there now. lastBoardsContainer only ever points at the
         MOST RECENT render target, so this check is enough to detect
         "am I still the thing showing" without a separate token/flag. */
      if (lastBoardsContainer !== container || !container.isConnected) return;

      if (!result || !result.ok) {
        listEl.textContent = 'Could not load templates' + (result && result.error ? ': ' + result.error : '.');
        return;
      }
      var templates = result.templates || [];
      listEl.textContent = '';
      if (!templates.length) {
        listEl.textContent = 'No templates bundled with this build.';
        return;
      }

      for (var i = 0; i < templates.length; i++) {
        (function(entry) {
          var row = document.createElement('div');
          row.style.cssText = 'padding:10px 0;border-bottom:1px solid var(--color-border);';

          var top = document.createElement('div');
          top.style.cssText = 'display:flex;align-items:center;justify-content:space-between;gap:8px;';

          var nameWrap = document.createElement('div');
          nameWrap.style.cssText = 'display:flex;align-items:center;gap:6px;min-width:0;overflow:hidden;';
          var name = document.createElement('div');
          name.style.cssText = 'font-size:12px;color:var(--color-text);font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
          name.textContent = entry.name;
          nameWrap.appendChild(name);
          if (entry.source === 'user') {
            var badge = document.createElement('span');
            badge.textContent = 'Yours';
            badge.style.cssText = 'flex-shrink:0;font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:0.04em;padding:1px 6px;border-radius:999px;background:var(--color-accent-bg);color:var(--color-accent);';
            nameWrap.appendChild(badge);
          }
          top.appendChild(nameWrap);

          var actions = document.createElement('div');
          actions.style.cssText = 'display:flex;gap:4px;flex-shrink:0;';

          var useBtn = document.createElement('button');
          useBtn.textContent = 'Use';
          useBtn.style.cssText = 'background:var(--color-accent-bg);border:1px solid var(--color-accent);border-radius:4px;color:var(--color-accent);padding:3px 10px;font-size:11px;font-family:var(--font-ui);cursor:pointer;flex-shrink:0;';
          useBtn.onclick = function() {
            useBtn.disabled = true;
            useBtn.textContent = 'Loading…';
            useTemplate(entry, function() { renderBoardsList(container); }, function() {
              useBtn.disabled = false;
              useBtn.textContent = 'Use';
            });
          };
          actions.appendChild(useBtn);

          /* Only user-saved templates can be deleted — built-in ones
             ship with the app and have no delete concept (see main.js's
             template-delete handler, which refuses any id not in the
             user manifest). */
          if (entry.source === 'user') {
            var delBtn = document.createElement('button');
            delBtn.textContent = '✕';
            delBtn.title = 'Delete this template';
            delBtn.style.cssText = 'background:none;border:1px solid var(--color-border-2);border-radius:4px;color:var(--color-text-3);padding:3px 7px;font-size:11px;font-family:var(--font-ui);cursor:pointer;flex-shrink:0;';
            delBtn.onclick = function() {
              KanvazBridge.deleteTemplate(entry.id).then(function(res) {
                if (!res || !res.ok) {
                  KanvazUI.toast((res && res.error) || 'Could not delete template', 'error');
                  return;
                }
                reloadList();
              });
            };
            actions.appendChild(delBtn);
          }

          top.appendChild(actions);
          row.appendChild(top);

          if (entry.description) {
            var desc = document.createElement('div');
            desc.style.cssText = 'font-size:11px;color:var(--color-text-3);margin-top:3px;line-height:1.4;';
            desc.textContent = entry.description;
            row.appendChild(desc);
          }

          listEl.appendChild(row);
        })(templates[i]);
      }
    }).catch(function(e) {
      if (lastBoardsContainer !== container || !container.isConnected) return;
      listEl.textContent = 'Could not load templates: ' + e.message;
    });
  }

  /* ── New board ── */

  /* Bug-bounty fix (v5.3.0): initialCards (optional) lets a caller — so
     far only boards.js's renderTemplateGalleryInto() — populate the fresh board
     BEFORE 'boardLoad' fires, instead of calling KanvazCards.deserialise()
     itself afterward. That second pattern used to be what the Template
     Gallery did, and it meant any plugin listening for 'boardLoad' (to
     react to "a new board is now active," e.g. via KanvazCards.getAll())
     saw a board with zero cards — deserialise() ran, silently, only
     after the event had already gone out. Every other board-load path
     (loadBoardState(), below) already deserialises first and fires the
     event after; this brings newBoard() in line with that same order
     for its one caller that actually has cards to load up front. */
  /* Shared by the Boards panel's template gallery and the Home
     Screen's own template row — same load-and-start-a-board flow,
     just a different "what happens after" step (stay on the gallery
     vs. close the Home Screen), so that's the one thing callers still
     provide themselves. */
  function useTemplate(entry, onDone, onError) {
    return KanvazBridge.loadTemplate(entry.id).then(function(res) {
      if (!res || !res.ok) {
        KanvazUI.toast((res && res.error) || 'Could not load template', 'error');
        if (onError) onError();
        return;
      }
      newBoard(true, entry.name, res.cards);
      KanvazApp.markDirty();
      KanvazHistory.push();
      KanvazUI.toast('Started board from "' + entry.name + '"');
      if (onDone) onDone();
    }).catch(function(e) {
      KanvazUI.toast('Could not load template: ' + e.message, 'error');
      if (onError) onError();
    });
  }

  function newBoard(silent, name, initialCards) {
    saveCurrentBoardState();

    var id = 'board-' + Date.now();
    var board = {
      id:       id,
      name:     (name && name.trim()) || ('Board ' + (boards.length + 1)),
      cards:    initialCards || [],
      canvasTx: 0,
      canvasTy: 0,
      canvasScale: 1.0
    };

    boards.push(board);
    activeIdx = boards.length - 1;

    if (KanvazCards.resetSessionState) KanvazCards.resetSessionState();
    if (initialCards) {
      KanvazCards.deserialise(initialCards);
    } else {
      KanvazCards.clearAll();
    }
    if (typeof KanvazConnections !== 'undefined') KanvazConnections.clear();
    KanvazCanvas.zoomReset();
    KanvazHistory.clear();
    emitBoardEvent('boardLoad');

    renderBoardsList();
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

    /* Bug fix: same "feels stuck, no feedback" issue as deleting the
       active board — switching TO a board holding a heavy 3D model is
       the far more common way to hit this same multi-second, main-
       thread-blocking parse. A toast plus a one-frame defer at least
       gives the user something to look at while it works instead of a
       silent freeze that looks identical to a hang. */
    KanvazUI.toast('Loading board…');
    setTimeout(function() {
      loadBoardState(boards[idx]);
      renderBoardsList();
      updateTitle();
    }, 20);
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
    if (KanvazCards.resetSessionState) KanvazCards.resetSessionState();
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
      renderBoardsList();
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
        /* renderBoardsList() rebuilds the list (innerHTML = ''), which
           removes this still-focused input from the DOM — that fires a
           native 'blur' on it first, which was wired to commit() above.
           Left alone, Escape would "cancel" by committing whatever was
           typed, same as Enter. Unhook the blur handler first so the
           teardown is silent. */
        input.onblur = null;
        renderBoardsList();
      }
    };
  }

  /* ── Delete board ── */

  function deleteBoard(idx) {
    if (boards.length <= 1) {
      KanvazUI.toast('Cannot delete the last board', 'error');
      return;
    }

    /* Audit fix: `idx` is a snapshot of this board's position at the
       moment the user clicked the tab's close button — but the actual
       deletion below only runs later, after they confirm in this dialog,
       and boards.splice()/insertion can happen in the meantime (an MCP
       Bridge call creating/deleting/renaming a board while the dialog is
       still open is a real, not just theoretical, source of this since
       an AI client isn't blocked by a modal the way a human is). A stale
       positional index at confirm-time could delete the wrong board
       entirely, or one that no longer exists. Capturing the board's
       stable id now and re-resolving its CURRENT index right before the
       actual mutation closes that gap — same principle `findBoardIndexById`
       already exists for. */
    var targetId = boards[idx].id;
    var targetName = boards[idx].name;

    KanvazUI.showDialog(
      'Delete board?',
      '"' + targetName + '" and all its cards will be removed.',
      [
        {
          label: 'Delete',
          cls: 'danger',
          action: function() {
            var currentIdx = findBoardIndexById(targetId);
            if (currentIdx === -1) {
              KanvazUI.toast('That board no longer exists', 'error');
              return;
            }
            if (boards.length <= 1) {
              KanvazUI.toast('Cannot delete the last board', 'error');
              return;
            }
            idx = currentIdx;
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
              /* Bug fix: "when i try to delete a board it takes 10sec
                 and stuck" — deleting the ACTIVE board means the newly-
                 active one loads right here, synchronously, and a board
                 holding a heavy 3D model (a real multi-second GLTF/FBX
                 parse, not a bug in the parse itself) blocked the main
                 thread with the confirm dialog barely closed and zero
                 visual feedback — indistinguishable from a hang. A
                 toast + a one-frame defer lets the browser actually
                 paint that toast before the blocking parse starts,
                 instead of queuing both behind the same paint. */
              KanvazUI.toast('Loading board…');
              var idxToLoad = activeIdx;
              setTimeout(function() {
                loadBoardState(boards[idxToLoad]);
                renderBoardsList();
                updateTitle();
              }, 20);
            } else {
              if (idx < activeIdx) {
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
              renderBoardsList();
              updateTitle();
            }

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
    renderBoardsList();
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

    renderBoardsList();
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
    /* Defensive: covers the second-instance handoff too — someone
       double-clicks another .kanvaz file while Kanvaz is already
       running and showing the Start Screen. closeStartup() is a no-op
       if the screen isn't showing, so this is safe from every call
       site, not just the recent-item click that used to call it
       explicitly. */
    closeStartup();
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

    boards      = data.boards;
    activeIdx   = data.activeIdx || 0;
    /* v6.4.0: files saved before shared cards existed simply have no
       stubs referencing anything, so an empty registry is correct, not
       a fallback that loses data. */
    sharedCards = data.sharedCards || {};

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
    renderBoardsList();
    updateTitle();
    KanvazHistory.clear();
  }

  /* ── Serialise entire file ── */

  function serialise() {
    saveCurrentBoardState();
    pruneUnusedSharedCards();
    var out = {
      version:     VERSION,
      savedAt:     new Date().toISOString(),
      activeIdx:   activeIdx,
      boards:      boards,
      /* v6.4.0: shared-card content registry — see the block comment
         above sharedCards' declaration for the full design. */
      sharedCards: sharedCards
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

  /* "Edited 12 min ago" / "yesterday" / "Sep 11" — same rough tiers
     most file-manager-style UIs use, cheapest thing that reads
     naturally without pulling in a date-formatting library for one
     small label. */
  function formatRelativeTime(mtimeMs) {
    if (!mtimeMs) return '';
    var diffMs = Date.now() - mtimeMs;
    var minute = 60000, hour = 3600000, day = 86400000;
    if (diffMs < minute) return 'just now';
    if (diffMs < hour) return Math.round(diffMs / minute) + ' min ago';
    if (diffMs < day) return Math.round(diffMs / hour) + ' hr ago';
    if (diffMs < 2 * day) return 'yesterday';
    if (diffMs < 7 * day) return Math.round(diffMs / day) + ' days ago';
    var d = new Date(mtimeMs);
    var months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    return months[d.getMonth()] + ' ' + d.getDate();
  }

  /* Bug-bounty fix: toggleHomeScreen()'s own `#startup-screen` DOM
     check only catches an ALREADY-RENDERED overlay — but the overlay
     itself isn't created until the Promise.all(...).then(...) below
     resolves, a real IPC round trip. Two Ctrl+H presses in quick
     succession (or OS key-repeat), or two clicks on the titlebar logo
     before the first call's IPC round trip finishes, both see "not
     open yet" and both proceed — stacking two overlays, each with its
     own document-level Escape listener that closeStartup() only ever
     tears down one at a time. This flag closes that window: set
     synchronously before the async work starts, cleared once the
     overlay actually lands in the DOM (or on any early-return/failure
     path that never gets there). */
  var startupScreenOpening = false;

  /* manual=true (from the account menu's "Home Screen" item, or the
     "core.openHomeScreen" command) bypasses both the startup-file and
     openOnStartup gates below — those exist to decide whether this
     shows automatically on launch, not whether the user is ever
     allowed to see it again. Direct feedback: "how will user go back
     to home screen add a option too." */
  function showStartupScreen(manual) {
    if (startupScreenOpening || document.getElementById('startup-screen')) return;
    startupScreenOpening = true;

    /* Redesign v1 Phase 2: skipped entirely (no IPC round-trip, no
       flash) when this launch is going straight to a specific .kanvaz
       file — double-click a file, "Open with Kanvaz", or a second-
       instance handoff. hasStartupFile() is a synchronous snapshot set
       at window creation (see preload.js), so this check is safe to
       make before any settings/recent IPC has resolved. */
    if (!manual && typeof KanvazBridge !== 'undefined' && KanvazBridge.hasStartupFile && KanvazBridge.hasStartupFile()) {
      startupScreenOpening = false;
      return;
    }

    /* Respect openOnStartup setting — check is INSIDE the async callback
       rather than at the top, because loadSettings() runs asynchronously
       via IPC and may not have completed yet when showStartupScreen() is
       first called during init(). By the time getRecent() resolves, the
       settings IPC will have resolved too. */
    /* Redesign v1 Phase 2: "the Start Screen... the profile switcher
       lives here too if more than one profile exists" — fetched
       alongside recent boards so both are available by the time the
       screen actually renders, rather than a second IPC round-trip
       after the fact. Multi-profile launch behavior stays "auto-load
       last-active, no forced picker" (decided in
       docs/PROFILES_SYSTEM_PLAN.md) — this is a lightweight indicator +
       switch link, not a picker gating the rest of the screen. */
    var profilesPromise = (typeof KanvazBridge !== 'undefined' && KanvazBridge.listProfiles && KanvazBridge.getActiveProfile)
      ? Promise.all([KanvazBridge.listProfiles(), KanvazBridge.getActiveProfile()])
      : Promise.resolve([[], null]);

    var templatesPromise = (typeof KanvazBridge !== 'undefined' && KanvazBridge.listTemplates)
      ? KanvazBridge.listTemplates()
      : Promise.resolve({ ok: false, templates: [] });

    Promise.all([KanvazBridge.getRecent(), profilesPromise, templatesPromise]).then(function(results) {
      var recent = results[0] || [];
      var profiles = results[1][0] || [];
      var activeProfile = results[1][1];
      var templates = (results[2] && results[2].ok && results[2].templates) || [];
      /* Direct feedback: "fill the empty space the current kanvaz home
         screen has... rather than 4-5 opts in doom [blank] space" — a
         brand-new install with zero recent boards used to skip the
         Home Screen entirely and land on a blank canvas, which is
         exactly backwards from "make it feel like a real app." Quick
         Start alone is worth showing even with nothing to resume yet;
         only the Recent section itself is conditional now, further
         down. */

      if (!manual && typeof KanvazUI_Extended !== 'undefined') {
        var s = KanvazUI_Extended.getSettings();
        if (s && s.openOnStartup === false) { startupScreenOpening = false; return; }
      }

      /* v7.x — Home Screen redesign. Direct feedback: "where is start
         up home screen i want proper it like photoshop not this same
         but liek this... dont keep taht anmoying pop up which ask
         user recents." Replaces the small centered modal (backdrop-
         blurred popup floating over the canvas) with a real full-
         screen takeover — a permanent surface with its own header,
         a prominent New/Open pair, and a recent-boards grid, closer
         to how Photoshop's/other pro tools' own start screens read.
         Same skip conditions as before (a specific file on launch, or
         openOnStartup === false) — only the screen itself changed. */
      var overlay = document.createElement('div');
      overlay.id = 'startup-screen';
      overlay.style.cssText = [
        'position:fixed',
        'inset:0',
        'background:var(--color-bg)',
        'z-index:99998',
        'display:flex',
        'flex-direction:row',
        'overflow:hidden'
      ].join(';');

      /* v3 — real sidebar-nav layout instead of a single centered
         column. Direct feedback with a reference image: "no side bar
         in home screen and then no profile stuff nor no border all is
         center focused which is not at all like the ref." Left rail
         (logo + Home/Templates/Boards/Settings nav, same four
         destinations the reference shows) plus a profile avatar in the
         main column's own top-right corner — full-height, full-width,
         nothing artificially capped to a centered column on a wide
         monitor. */
      var sidebar = document.createElement('div');
      sidebar.style.cssText = 'flex-shrink:0;width:220px;height:100%;display:flex;flex-direction:column;padding:20px 14px;border-right:1px solid var(--color-border);box-sizing:border-box;';

      /* Same logo-as-toggle affordance as the titlebar's own logo
         (which this screen currently covers) — clicking it here goes
         the other direction, back to whatever board is open behind
         this overlay. Direct feedback: "make kanvaz icon in this
         corner the button to go home to canvaz and canvaz to home." */
      /* Direct feedback: "why not using same logo as in inside" — this
         used to hand-draw its own standalone SVG approximation of the
         app icon instead of reusing the actual artwork, so it visibly
         didn't match the titlebar's real logo (index.html's
         #titlebar-logo, the same assets/icons/icon-128.png used for the
         taskbar icon). Now a plain <img> of that same file, same
         circular crop (.logo-icon's border-radius:50% fix) — one source
         of truth for what the Kanvaz logo looks like, not two. */
      var logoRow = document.createElement('div');
      logoRow.style.cssText = 'display:flex;align-items:center;gap:10px;cursor:pointer;font-family:var(--font-ui);padding:6px 10px 20px;';
      logoRow.title = 'Back to Board';
      logoRow.innerHTML = '<img src="../assets/icons/icon-128.png" alt="" width="26" height="26" style="border-radius:50%;object-fit:contain;flex-shrink:0;"><span style="font-size:19px;font-weight:600;color:var(--color-text);font-family:var(--font-ui);">Kanvaz</span>';
      logoRow.onclick = closeStartup;
      sidebar.appendChild(logoRow);

      /* Direct feedback: "something can be opened directly inside home
         [screen] instead of going to canvaz" — a one-click path to
         Templates/Boards/Settings instead of closing the Home Screen
         blind and hunting for the side panel's rail icons afterward.
         Home itself is the current screen (marked active, no-op) —
         matches the reference's own nav shape, where the highlighted
         item is wherever you already are. */
      var NAV_ICON_HOME = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M9 22V12h6v10"/></svg>';
      var NAV_ICON_TEMPLATES = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>';
      var NAV_ICON_BOARDS = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>';
      var NAV_ICON_SETTINGS = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>';

      var navItems = [
        { icon: NAV_ICON_HOME, label: 'Home', active: true, onClick: null },
        { icon: NAV_ICON_TEMPLATES, label: 'Templates', active: false, onClick: function() {
          closeStartup();
          if (typeof KanvazSidePanel !== 'undefined' && KanvazSidePanel.showSection) KanvazSidePanel.showSection('boards');
          if (lastBoardsContainer) renderTemplateGalleryInto(lastBoardsContainer);
        } },
        { icon: NAV_ICON_BOARDS, label: 'Boards', active: false, onClick: function() {
          closeStartup();
          if (typeof KanvazSidePanel !== 'undefined' && KanvazSidePanel.showSection) KanvazSidePanel.showSection('boards');
        } },
        { icon: NAV_ICON_SETTINGS, label: 'Settings', active: false, onClick: function() {
          closeStartup();
          if (typeof KanvazSidePanel !== 'undefined' && KanvazSidePanel.showSection) KanvazSidePanel.showSection('settings');
        } }
      ];
      for (var ni = 0; ni < navItems.length; ni++) {
        (function(item) {
          var navBtn = document.createElement('div');
          navBtn.style.cssText = 'display:flex;align-items:center;gap:10px;padding:9px 12px;margin-bottom:2px;border-radius:8px;cursor:pointer;font-size:13px;font-weight:' + (item.active ? '600' : '500') + ';color:' + (item.active ? 'var(--color-accent)' : 'var(--color-text-2)') + ';background:' + (item.active ? 'var(--color-accent-bg)' : 'transparent') + ';transition:background 0.1s,color 0.1s;';
          var iconEl = document.createElement('span');
          iconEl.style.cssText = 'display:flex;flex-shrink:0;';
          iconEl.innerHTML = item.icon;
          navBtn.appendChild(iconEl);
          var labelEl = document.createElement('span');
          labelEl.textContent = item.label;
          navBtn.appendChild(labelEl);
          if (!item.active) {
            navBtn.onmouseenter = function() { navBtn.style.background = 'var(--color-surface-2)'; navBtn.style.color = 'var(--color-text)'; };
            navBtn.onmouseleave = function() { navBtn.style.background = 'transparent'; navBtn.style.color = 'var(--color-text-2)'; };
            navBtn.onclick = item.onClick;
          }
          sidebar.appendChild(navBtn);
        })(navItems[ni]);
      }

      var sidebarSpacer = document.createElement('div');
      sidebarSpacer.style.cssText = 'flex:1;';
      sidebar.appendChild(sidebarSpacer);

      /* Bottom of sidebar: version + (when there's an actual choice to
         make) a profile switch link — "no forced picker" per
         docs/PROFILES_SYSTEM_PLAN.md, so a single-profile household
         sees just the version line. */
      var sidebarFooter = document.createElement('div');
      sidebarFooter.style.cssText = 'padding:10px 10px 4px;border-top:1px solid var(--color-border);font-size:10px;color:var(--color-text-3);';
      var verEl = document.createElement('div');
      verEl.textContent = 'Kanvaz v' + VERSION;
      sidebarFooter.appendChild(verEl);
      if (profiles.length > 1 && activeProfile) {
        var switchLink = document.createElement('button');
        switchLink.textContent = 'Switch profile (' + activeProfile.name + ')';
        switchLink.style.cssText = 'display:block;background:none;border:none;color:var(--color-accent);font-family:var(--font-ui);font-size:10px;cursor:pointer;padding:4px 0 0;text-align:left;';
        switchLink.onclick = function() {
          closeStartup();
          if (typeof KanvazSidePanel !== 'undefined' && KanvazSidePanel.showManageProfilesDialog) {
            KanvazSidePanel.showManageProfilesDialog();
          }
        };
        sidebarFooter.appendChild(switchLink);
      }
      sidebar.appendChild(sidebarFooter);
      overlay.appendChild(sidebar);

      /* Right column — everything that isn't the sidebar, scrollable on
         its own so the sidebar always stays put. */
      var rightCol = document.createElement('div');
      rightCol.style.cssText = 'flex:1;min-width:0;height:100%;display:flex;flex-direction:column;overflow-y:auto;';

      /* Profile avatar, top-right of the main column — direct feedback:
         "no profile stuff." A single circular initial rather than a
         fake notification bell/search bar the reference shows but
         Kanvaz has no real backing feature for yet — this one IS real:
         click opens the same profile management the sidebar's own
         "Switch profile" link does.
         Bug fix: "where is option to put profile photo? add it" — the
         option already existed (Manage Profiles → Change Photo…,
         stored as activeProfile.avatarDataUrl), it just never showed up
         anywhere — this avatar always rendered the plain initial letter
         regardless of whether a photo was actually set. Now shows the
         real photo when one exists, falling back to the initial only
         when it doesn't. */
      var topBar = document.createElement('div');
      topBar.style.cssText = 'flex-shrink:0;display:flex;justify-content:flex-end;padding:18px 32px 0;';
      var avatarBtn = document.createElement('button');
      var avatarInitial = (activeProfile && activeProfile.name) ? activeProfile.name.trim().charAt(0).toUpperCase() : 'K';
      if (activeProfile && activeProfile.avatarDataUrl) {
        var avatarImg = document.createElement('img');
        avatarImg.src = activeProfile.avatarDataUrl;
        avatarImg.alt = '';
        avatarImg.style.cssText = 'width:100%;height:100%;border-radius:50%;object-fit:cover;';
        avatarBtn.appendChild(avatarImg);
      } else {
        avatarBtn.textContent = avatarInitial;
      }
      avatarBtn.title = (activeProfile && activeProfile.name) ? activeProfile.name : 'Profile';
      avatarBtn.style.cssText = 'width:32px;height:32px;border-radius:50%;background:var(--color-accent);border:none;color:#fff;font-family:var(--font-ui);font-size:13px;font-weight:600;cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0;padding:0;overflow:hidden;';
      avatarBtn.onclick = function() {
        closeStartup();
        if (typeof KanvazSidePanel !== 'undefined' && KanvazSidePanel.showManageProfilesDialog) {
          KanvazSidePanel.showManageProfilesDialog();
        }
      };
      topBar.appendChild(avatarBtn);
      rightCol.appendChild(topBar);

      /* Main content — full width of the right column now (minus its
         own side padding), not artificially capped to a centered
         column like a document. */
      var main = document.createElement('div');
      main.style.cssText = 'flex:1;width:100%;padding:8px 40px 40px;box-sizing:border-box;';

      /* v7.x — Home Screen v2. Direct feedback with a reference image:
         "fill the empty space the current kanvaz home screen has...
         make it look real professional rather than 4-5 opts in doom
         [blank] space." A personalized greeting, richer Quick Start
         tiles (icon badge + title + subtitle, not a flat button row),
         and a Recent grid with a real relative-time readout instead of
         a bare path. Adapted to what Kanvaz genuinely has, not a
         literal copy of the reference — no fake storage meter or
         invented "shared with you" section standing in for features
         that don't exist. */
      var hour = new Date().getHours();
      var timeOfDay = hour < 12 ? 'morning' : (hour < 18 ? 'afternoon' : 'evening');
      var greetName = (activeProfile && activeProfile.name) ? activeProfile.name : null;

      var greeting = document.createElement('div');
      greeting.style.cssText = 'font-size:30px;font-weight:700;color:var(--color-text);margin-bottom:6px;';
      greeting.textContent = greetName ? ('Good ' + timeOfDay + ', ' + greetName) : ('Good ' + timeOfDay);
      main.appendChild(greeting);

      var subGreeting = document.createElement('div');
      subGreeting.style.cssText = 'font-size:14px;color:var(--color-text-3);margin-bottom:28px;';
      subGreeting.textContent = 'Start a new board or continue where you left off.';
      main.appendChild(subGreeting);

      /* Quick start — three rich tiles instead of a flat button row.
         New Board stays visually primary (accent-filled), matching
         its role as the one action that always applies even with zero
         history. */
      var quickLabel = document.createElement('div');
      quickLabel.textContent = 'Quick start';
      quickLabel.style.cssText = 'font-size:13px;font-weight:600;color:var(--color-text);margin-bottom:12px;';
      main.appendChild(quickLabel);

      var quickGrid = document.createElement('div');
      quickGrid.style.cssText = 'display:grid;grid-template-columns:repeat(3, 1fr);gap:12px;margin-bottom:32px;';

      function buildQuickTile(opts) {
        var tile = document.createElement('div');
        tile.style.cssText = [
          'display:flex', 'align-items:center', 'gap:14px', 'padding:16px',
          'border-radius:10px', 'cursor:pointer',
          'transition:transform 0.12s, background 0.12s, border-color 0.12s',
          opts.primary
            ? 'background:var(--color-accent);border:1px solid var(--color-accent);'
            : 'background:var(--color-surface);border:1px solid var(--color-border-2);'
        ].join(';');

        var iconBadge = document.createElement('div');
        iconBadge.style.cssText = 'flex-shrink:0;width:36px;height:36px;border-radius:8px;display:flex;align-items:center;justify-content:center;background:' + (opts.primary ? 'rgba(255,255,255,0.2)' : 'var(--color-accent-bg)') + ';color:' + (opts.primary ? '#fff' : 'var(--color-accent)') + ';';
        iconBadge.innerHTML = opts.icon;
        tile.appendChild(iconBadge);

        var textCol = document.createElement('div');
        textCol.style.cssText = 'flex:1;min-width:0;';
        var titleEl = document.createElement('div');
        titleEl.style.cssText = 'font-size:13px;font-weight:600;color:' + (opts.primary ? '#fff' : 'var(--color-text)') + ';margin-bottom:2px;';
        titleEl.textContent = opts.title;
        textCol.appendChild(titleEl);
        var subEl = document.createElement('div');
        subEl.style.cssText = 'font-size:11px;color:' + (opts.primary ? 'rgba(255,255,255,0.75)' : 'var(--color-text-3)') + ';overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
        subEl.textContent = opts.subtitle;
        textCol.appendChild(subEl);
        tile.appendChild(textCol);

        tile.onmouseenter = function() { tile.style.transform = 'translateY(-2px)'; };
        tile.onmouseleave = function() { tile.style.transform = 'none'; };
        tile.onclick = opts.onClick;
        return tile;
      }

      var ICON_PLUS = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>';
      var ICON_FOLDER = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>';
      var ICON_GRID = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>';

      quickGrid.appendChild(buildQuickTile({
        primary: true, icon: ICON_PLUS, title: 'New Board', subtitle: 'Begin with an open canvas',
        onClick: closeStartup
      }));
      quickGrid.appendChild(buildQuickTile({
        primary: false, icon: ICON_FOLDER, title: 'Open from computer', subtitle: 'Open a .kanvaz file',
        onClick: function() {
          closeStartup();
          if (typeof KanvazBoards !== 'undefined' && KanvazBoards.openBoard) KanvazBoards.openBoard();
        }
      }));
      quickGrid.appendChild(buildQuickTile({
        primary: false, icon: ICON_GRID, title: 'Browse templates', subtitle: 'Start with a curated layout',
        onClick: function() {
          closeStartup();
          if (typeof KanvazSidePanel !== 'undefined' && KanvazSidePanel.showSection) KanvazSidePanel.showSection('boards');
          if (lastBoardsContainer) renderTemplateGalleryInto(lastBoardsContainer);
        }
      }));
      main.appendChild(quickGrid);

      /* Templates preview — real content instead of empty space.
         Direct feedback: "polish the home screen with more details
         its still looks a lot empty tbh." Kanvaz ships 14 real
         production-researched templates (VFX/game-dev/animation/UI-UX/
         etc, see docs/REDESIGN_V1_SPRINT.md) that a Home Screen
         showing nothing about them undersells badly. Shows the first
         few with their real name + description; "Browse all" opens
         the full gallery the same way the Quick Start tile does. */
      if (templates.length) {
        var tmplHeaderRow = document.createElement('div');
        tmplHeaderRow.style.cssText = 'display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;';
        var tmplLabel = document.createElement('div');
        tmplLabel.textContent = 'Start from a template';
        tmplLabel.style.cssText = 'font-size:13px;font-weight:600;color:var(--color-text);';
        tmplHeaderRow.appendChild(tmplLabel);
        var browseAllLink = document.createElement('button');
        browseAllLink.textContent = 'Browse all (' + templates.length + ') →';
        browseAllLink.style.cssText = 'background:none;border:none;color:var(--color-accent);font-family:var(--font-ui);font-size:12px;cursor:pointer;padding:0;';
        browseAllLink.onclick = function() {
          closeStartup();
          if (typeof KanvazSidePanel !== 'undefined' && KanvazSidePanel.showSection) KanvazSidePanel.showSection('boards');
          if (lastBoardsContainer) renderTemplateGalleryInto(lastBoardsContainer);
        };
        tmplHeaderRow.appendChild(browseAllLink);
        main.appendChild(tmplHeaderRow);

        var tmplGrid = document.createElement('div');
        tmplGrid.style.cssText = 'display:grid;grid-template-columns:repeat(auto-fill, minmax(200px, 1fr));gap:12px;margin-bottom:32px;';

        var previewTemplates = templates.slice(0, 4);
        for (var ti = 0; ti < previewTemplates.length; ti++) {
          (function(entry) {
            var tCard = document.createElement('div');
            tCard.style.cssText = 'display:flex;flex-direction:column;padding:14px;background:var(--color-surface);border:1px solid var(--color-border-2);border-radius:10px;cursor:pointer;transition:border-color 0.12s, transform 0.12s;';

            var tTitle = document.createElement('div');
            tTitle.style.cssText = 'font-size:13px;font-weight:600;color:var(--color-text);margin-bottom:5px;';
            tTitle.textContent = entry.name;
            tCard.appendChild(tTitle);

            var tDesc = document.createElement('div');
            tDesc.style.cssText = 'font-size:11px;color:var(--color-text-3);line-height:1.4;overflow:hidden;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;';
            tDesc.textContent = entry.description || '';
            tCard.appendChild(tDesc);

            tCard.onmouseenter = function() { tCard.style.borderColor = 'var(--color-accent)'; tCard.style.transform = 'translateY(-2px)'; };
            tCard.onmouseleave = function() { tCard.style.borderColor = 'var(--color-border-2)'; tCard.style.transform = 'none'; };
            /* Bug-bounty fix: no double-click guard, unlike the
               equivalent Boards-panel "Use" button (which disables
               itself first) — a fast double-click here fired
               loadTemplate()+newBoard()+KanvazHistory.push() twice
               concurrently. */
            tCard.onclick = function() {
              if (tCard.style.pointerEvents === 'none') return;
              tCard.style.pointerEvents = 'none';
              tCard.style.opacity = '0.6';
              useTemplate(entry, closeStartup, function() {
                tCard.style.opacity = '1';
                tCard.style.pointerEvents = '';
              });
            };

            tmplGrid.appendChild(tCard);
          })(previewTemplates[ti]);
        }
        main.appendChild(tmplGrid);
      }

      /* Recent boards — a real grid of tiles, not a plain list, the
         part of the "photoshop-like" reference that actually changed
         the layout shape rather than just the chrome around it. No
         real thumbnails (a board isn't rendered to an image anywhere
         today — a genuine future feature, not squeezed in here), so
         each tile gets a deterministic color banner (hashed from its
         own filename, same idea Map View already uses to color-code
         nodes by tag) for visual variety instead of a flat icon-on-
         white-card that reads more like a file manager than an app.
         Skipped entirely when there's nothing to show yet — a first
         launch still gets the full Quick Start section above. */
      if (recent.length) {
        var label = document.createElement('div');
        label.textContent = 'Recent';
        label.style.cssText = 'font-size:13px;font-weight:600;color:var(--color-text);margin-bottom:12px;';
        main.appendChild(label);

        var grid = document.createElement('div');
        grid.style.cssText = 'display:grid;grid-template-columns:repeat(auto-fill, minmax(180px, 1fr));gap:14px;';

        for (var i = 0; i < recent.length; i++) {
          (function(entry) {
            var p = entry.path;
            var tile = document.createElement('div');
            tile.style.cssText = [
              'display:flex', 'flex-direction:column', 'overflow:hidden',
              'background:var(--color-surface)',
              'border:1px solid var(--color-border-2)',
              'border-radius:10px',
              'cursor:pointer',
              'transition:border-color 0.12s, transform 0.12s'
            ].join(';');

            var parts = p.split(/[\\/]/);
            var fname = parts[parts.length - 1];
            var dir   = parts.slice(0, -1).join('/');

            /* Deterministic hue from the filename — same tiny hash-
               to-hue trick map-view.js's own hashColor() uses for
               tag colors, kept as its own copy here since it's a few
               lines and not worth a cross-module dependency for. */
            var hash = 0;
            for (var h = 0; h < fname.length; h++) hash = (hash * 31 + fname.charCodeAt(h)) | 0;
            var hue = Math.abs(hash) % 360;

            var banner = document.createElement('div');
            banner.style.cssText = 'height:64px;background:linear-gradient(135deg, hsl(' + hue + ',55%,42%), hsl(' + ((hue + 40) % 360) + ',55%,30%));display:flex;align-items:center;justify-content:center;flex-shrink:0;';
            banner.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.85)" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 15l4.5-4.5a2 2 0 0 1 2.8 0L15 15"/><circle cx="15.5" cy="8.5" r="1.5"/></svg>';
            tile.appendChild(banner);

            var textCol = document.createElement('div');
            textCol.style.cssText = 'padding:10px 12px;';

            /* Security fix (carried forward from the old popup): fname/
               dir come from a filesystem path that can originate from a
               .kanvaz file someone else shared (added to recent.json
               via the argv/open-file handoff, not just the user's own
               Save dialog) — set via textContent, never innerHTML, so
               a crafted filename can never be interpreted as markup. */
            var fnameEl = document.createElement('div');
            fnameEl.style.cssText = 'font-size:13px;color:var(--color-text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;margin-bottom:2px;';
            fnameEl.textContent = fname;
            textCol.appendChild(fnameEl);

            var metaEl = document.createElement('div');
            metaEl.style.cssText = 'font-size:10px;color:var(--color-text-3);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
            metaEl.textContent = 'Board · ' + formatRelativeTime(entry.mtimeMs);
            metaEl.title = dir;
            textCol.appendChild(metaEl);

            tile.appendChild(textCol);

            tile.onmouseenter = function() { tile.style.borderColor = 'var(--color-accent)'; tile.style.transform = 'translateY(-2px)'; };
            tile.onmouseleave = function() { tile.style.borderColor = 'var(--color-border-2)'; tile.style.transform = 'none'; };

            /* Reuses openFilePath() (was previously a duplicate inline
               copy of its readFile/parse/load logic) — picks up the
               same unsaved-changes guard and newer-version warning for
               free, and removes the drift risk of two copies. */
            tile.onclick = function() {
              closeStartup();
              openFilePath(p);
            };

            grid.appendChild(tile);
          })(recent[i]);
        }
        main.appendChild(grid);
      }

      rightCol.appendChild(main);

      /* A real, honest tip banner instead of the reference's fictional
         "watch tutorial" video — Kanvaz's actual equivalent is the
         built-in keyboard shortcuts overlay. */
      var tipBanner = document.createElement('div');
      tipBanner.style.cssText = 'flex-shrink:0;width:calc(100% - 80px);margin:0 40px 20px;padding:16px 20px;background:var(--color-surface);border:1px solid var(--color-border-2);border-radius:10px;display:flex;align-items:center;justify-content:space-between;gap:16px;box-sizing:border-box;';
      var tipText = document.createElement('div');
      tipText.innerHTML = '<div style="font-size:10px;font-weight:600;letter-spacing:0.06em;color:var(--color-accent);margin-bottom:4px;">NEW HERE?</div><div style="font-size:13px;color:var(--color-text);">Press <strong>?</strong> anytime for the full keyboard shortcuts list.</div>';
      tipBanner.appendChild(tipText);
      var tipBtn = document.createElement('button');
      tipBtn.textContent = 'Show Shortcuts';
      tipBtn.style.cssText = 'flex-shrink:0;padding:9px 16px;background:var(--color-accent-bg);border:1px solid var(--color-accent);border-radius:6px;color:var(--color-accent);font-family:var(--font-ui);font-size:12px;font-weight:600;cursor:pointer;';
      tipBtn.onclick = function() {
        closeStartup();
        if (typeof KanvazUI !== 'undefined' && KanvazUI.showShortcuts) KanvazUI.showShortcuts();
      };
      tipBanner.appendChild(tipBtn);
      rightCol.appendChild(tipBanner);

      /* Footer branding — P4inz | Atharva Patil, same order used
         everywhere else in the app now (About screen, README). No
         "Studios" suffix — direct correction: "its not p4inz studio
         its only p4inz | then my name." */
      var footer = document.createElement('div');
      footer.style.cssText = 'flex-shrink:0;padding:0 40px 16px;text-align:center;font-size:11px;color:var(--color-text-3);';
      footer.textContent = 'P4inz | Atharva Patil';
      rightCol.appendChild(footer);

      overlay.appendChild(rightCol);
      document.body.appendChild(overlay);
      startupScreenOpening = false;

      /* Escape dismisses into an empty board, same as picking
         "New Board" — there's no backdrop to click away from anymore
         (this is a real full-screen surface, not a popup over the
         canvas), so Escape is the one non-button way out. */
      function onEscape(e) {
        if (e.key === 'Escape') { closeStartup(); }
      }
      document.addEventListener('keydown', onEscape);
      overlay._onEscape = onEscape;
    }).catch(function(e) {
      startupScreenOpening = false;
      console.warn('[Kanvaz] startup screen IPC failed:', e);
    });
  }

  /* Toggle for the Ctrl+H shortcut (shortcuts.js) — showHomeScreen()
     alone would stack a second #startup-screen overlay on top of the
     first if called while it's already open (no duplicate-id guard in
     showStartupScreen), which the mouse-driven entry points never hit
     since the overlay itself covers the titlebar logo that opens it.
     A keyboard shortcut has no such natural coverage, so it needs its
     own explicit open/close check. */
  function toggleHomeScreen() {
    if (document.getElementById('startup-screen')) {
      closeStartup();
    } else {
      showStartupScreen(true);
    }
  }

  function closeStartup() {
    var el = document.getElementById('startup-screen');
    if (!el) return;
    /* The full-screen Home Screen has no backdrop to click away from,
       so it binds its own document-level Escape listener — has to be
       unhooked here or it leaks forever and keeps firing closeStartup()
       (harmless once, since the element it looks for is already gone,
       but a real leaked listener all the same). */
    if (el._onEscape) document.removeEventListener('keydown', el._onEscape);
    if (el.parentNode) el.parentNode.removeChild(el);
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
    showHomeScreen: function() { showStartupScreen(true); },
    toggleHomeScreen: toggleHomeScreen,
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
    deleteBoardById:  deleteBoardById,
    /* v6.4.0 — shared cards across boards */
    newSharedId:             newSharedId,
    getSharedCardContent:    getSharedCardContent,
    setSharedCardContent:    setSharedCardContent,
    deleteSharedCardContent: deleteSharedCardContent,
    addSharedInstanceToBoard: addSharedInstanceToBoard,
    renderBoardsList: renderBoardsList,
    /* Exported for sidepanel.js's profile switcher (Phase 2) — switching
       profiles is "ending this user session" per docs/
       PROFILES_SYSTEM_PLAN.md, so it needs the exact same Save/Don't
       Save/Cancel gate the open-a-different-board path already uses,
       not a second copy of the same three-button dialog. */
    confirmDiscardIfDirty: confirmDiscardIfDirty
  };

})();

/* Dual export — same guarded pattern as src/commands.js and src/board-
   container.js use: a real <script> tag in Kanvaz itself (window
   global) vs. a plain require() from test/shared-cards-test.js
   (CommonJS). Nothing above this point touches `window`/`document` at
   require time — only inside function bodies, which a Node test can
   avoid calling (or stub document for, as that test does) — so
   requiring this file is safe. */
if (typeof window !== 'undefined') { window.KanvazBoards = KanvazBoards; }
if (typeof module !== 'undefined' && module.exports) { module.exports = KanvazBoards; }
