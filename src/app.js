/* app.js — renderer entry point */

var KanvazApp = (function() {

  var alwaysOnTop = false;
  var currentBoardPath = null;
  var boardDirty = false;

  /* ── Boot ── */

  function init() {
    KanvazErrors.init();
    if (typeof KanvazTooltip !== 'undefined') KanvazTooltip.init();

    try {
      var container = document.getElementById('canvas-container');
      var world     = document.getElementById('canvas-world');
      var grid      = document.getElementById('canvas-grid');

      KanvazCanvas.init(container, world, grid);
      KanvazCards.init(world);
      KanvazHistory.init();
      KanvazShortcuts.init();
      if (typeof KanvazCommands !== 'undefined') KanvazCommands.init();
      KanvazBoards.init();
      if (typeof KanvazMapView !== 'undefined') KanvazMapView.init();
      KanvazUI_Extended.init();
      if (typeof KanvazSidePanel !== 'undefined') KanvazSidePanel.init();

      KanvazCanvas.initDrop(function(files, worldPos) {
        handleDroppedFiles(files, worldPos);
      });

      /* Paste from clipboard */
      document.addEventListener('paste', function(e) {
        handlePaste(e);
      });

      /* Recovery check */
      KanvazBridge.on('recovery-available', function() {
        showRecoveryDialog();
      });

      /* BUG 1 fix: main process intercepts window close and asks us
         whether it's safe to close (unsaved changes check). */
      KanvazBridge.on('check-unsaved-before-close', function() {
        handleCloseRequest();
      });

      /* BUG 5 fix: main process sends this when Kanvaz is launched (or
         handed off via single-instance lock) with a .kanvaz file — e.g.
         double-clicking a file, or "Open with Kanvaz". */
      KanvazBridge.on('open-file-from-argv', function(filePath) {
        if (filePath) KanvazBoards.openFilePath(filePath);
      });

      /* Audit fix (live-tested): this used to fire a "found —
         downloading…" toast and silently start the download right
         then, with no way to say no — main.js's autoDownload flag is
         now false specifically so this dialog is the actual decision
         point, not a courtesy notice after the fact.

         Portable-build case (also live-tested): there is no well-defined
         in-place auto-update for the portable .exe — electron-updater
         has no concept of it, and quitAndInstall() would try to run the
         (NSIS-only) downloaded installer against an exe that was never
         "installed" anywhere. So a portable build never even gets the
         auto-download option — only the release-page link. */
      KanvazBridge.on('update-available', function(info) {
        /* Reset so a second check-for-updates in the same session (the
           user cancelled, or re-checked later) gets its own fresh set
           of 25%-milestone toasts instead of the tracker still sitting
           at wherever a previous download left off. */
        lastProgressMilestone = -1;
        var version = info && info.version;
        var label = 'Kanvaz' + (version ? ' v' + version : '') + ' is available.';
        var releaseUrl = 'https://github.com/p4inz-code/kanvaz/releases/latest';

        if (info && info.isPortable) {
          KanvazUI.showDialog(
            'Update available',
            label + ' Auto-update isn\'t supported for the portable build — download the new version from the release page and replace this .exe yourself.',
            [
              { label: 'Open release page', cls: 'primary', action: function() { KanvazBridge.openExternal(releaseUrl); } },
              { label: 'Later', cls: '' }
            ]
          );
          return;
        }

        KanvazUI.showDialog(
          'Update available',
          label + ' Download and install it automatically, or open the release page to grab it yourself?',
          [
            { label: 'Download automatically', cls: 'primary', action: function() { KanvazBridge.downloadUpdate(); } },
            { label: 'Open release page', cls: '', action: function() { KanvazBridge.openExternal(releaseUrl); } },
            { label: 'Later', cls: '' }
          ]
        );
      });

      /* Download progress feedback (4.9.0) — the flow used to go
         straight from "found" to silence until "ready to restart," with
         nothing shown in between even though electron-updater was
         already emitting real progress numbers the whole time. Toasts
         at 25% milestones rather than a live-updating bar — toast()
         always creates a brand-new element per call (no in-place update
         path), and progress events fire far more often than every 25%,
         so a toast per event would spam the corner of the screen. */
      var lastProgressMilestone = -1;
      KanvazBridge.on('update-download-progress', function(info) {
        var percent = info && typeof info.percent === 'number' ? info.percent : null;
        if (percent === null) return;
        var milestone = Math.floor(percent / 25) * 25;
        if (milestone > lastProgressMilestone && milestone > 0) {
          lastProgressMilestone = milestone;
          KanvazUI.toast('Downloading update… ' + milestone + '%');
        }
      });

      KanvazBridge.on('update-downloaded', function(info) {
        KanvazUI.showDialog(
          'Update ready',
          'Kanvaz' + (info && info.version ? ' v' + info.version : '') + ' has been downloaded. Restart now to install it?',
          [
            { label: 'Restart & Install', cls: 'primary', action: function() { KanvazBridge.installUpdate(); } },
            { label: 'Later', cls: '' }
          ]
        );
      });

      /* Wire every button — CSP blocks inline onclick, so bind here */
      bindGlobalUI();

      /* Zoom display is now updated reactively from canvas.js applyTransform() */

      updateSaveStatus('ready');
      updateCardCount(0);
    } catch (e) {
      console.error('[Kanvaz] init() crashed:', e);
      if (typeof KanvazUI !== 'undefined' && KanvazUI.toast) {
        KanvazUI.toast('Boot error: ' + e.message, 'error');
      }
    }
  }

  /* ── Global UI bindings (CSP-safe: no inline onclick) ── */

  function bindGlobalUI() {
    function on(id, handler) {
      var el = document.getElementById(id);
      if (el) el.addEventListener('click', handler);
    }

    /* Titlebar */
    on('btn-minimize',      function() { KanvazBridge.minimize(); });
    on('btn-maximize',      function() { KanvazBridge.maximize(); });
    on('btn-close',         function() { KanvazBridge.close(); });

    /* Toolbar */
    /* Bug-bounty fix: this called showHomeScreen() while every other
       entry point (Ctrl+H, the account-menu item, the Command Palette)
       deliberately calls toggleHomeScreen() to avoid stacking a second
       #startup-screen overlay — this one click path was missed, and
       since the overlay renders behind this same clickable logo (it's
       only reachable again after the overlay covers it), a double-click
       here could genuinely stack two. */
    on('titlebar-logo', function() { if (KanvazBoards.toggleHomeScreen) KanvazBoards.toggleHomeScreen(); });
    on('btn-new',       function() { KanvazBoards.newBoard(); });
    on('btn-open',      function() { KanvazBoards.openBoard(); });
    /* Bug fix: this toolbar button was wired to the PureRef-only
       importPurFile() — see importMediaFiles()'s own comment above for
       the direct feedback that prompted switching it to a general
       "import any supported file" picker instead. .pur import is still
       reachable from the canvas right-click menu's own "Import .pur
       file" entry (commands.js), unchanged. */
    on('btn-import',    function() { importMediaFiles(); });
    on('btn-save',      function() { KanvazBoards.saveBoard(); });
    on('btn-zoom-in',   function() { KanvazCanvas.zoomIn(); });
    on('btn-zoom-out',  function() { KanvazCanvas.zoomOut(); });
    on('zoom-display',  function() { KanvazCanvas.zoomReset(); });
    on('btn-undo',      function() { KanvazHistory.undo(); });
    on('btn-redo',      function() { KanvazHistory.redo(); });
    on('btn-view-board', function() {
      if (typeof KanvazMapView !== 'undefined' && KanvazMapView.isActive()) KanvazMapView.toggle();
    });
    on('btn-view-map', function() {
      if (typeof KanvazMapView !== 'undefined' && !KanvazMapView.isActive()) KanvazMapView.toggle();
    });
    /* v7.x redesign — Settings moved into the left side panel; About/
       Shortcuts consolidated into the corner account-menu button (see
       sidepanel.js's initAccountMenu, wired from KanvazSidePanel.init()). */

    /* Maximize/restore icon toggle */
    var iconMax = document.getElementById('icon-maximize');
    var iconRes = document.getElementById('icon-restore');
    var btnMax  = document.getElementById('btn-maximize');

    function setMaximizedIcon(isMax) {
      if (!iconMax || !iconRes) return;
      iconMax.style.display = isMax ? 'none' : '';
      iconRes.style.display = isMax ? '' : 'none';
      if (btnMax) btnMax.dataset.tooltip = isMax ? 'Restore' : 'Maximize';
    }

    KanvazBridge.isMaximized().then(function(isMax) {
      setMaximizedIcon(!!isMax);
    }).catch(function() {});

    KanvazBridge.on('window-maximized-changed', function(isMax) {
      setMaximizedIcon(!!isMax);
    });
  }

  /* ── File drop ── */

  /* Shared by drag-drop and clipboard paste — grid-arranges N new items
     from a base point in drop/paste order, left-to-right top-to-bottom,
     so a batch of any size never stacks on top of itself.
     Spacing is sized off the real defaultCardW setting (default 600,
     user-configurable up to 1200) plus margin — a fixed 220px spacing
     looked fixed but cards could still overlap since real dropped/
     pasted images are routinely 400-600px wide, wider than the gap. */
  function gridArrangePos(baseX, baseY, idx, total) {
    var cardW = 600, cardH = 450;
    if (typeof KanvazUI_Extended !== 'undefined') {
      var s = KanvazUI_Extended.getSettings();
      if (s && s.defaultCardW && s.defaultCardW >= 80) {
        cardW = s.defaultCardW;
        cardH = Math.round(cardW * 0.75); /* reasonable 4:3-ish assumption for spacing purposes only */
      }
    }
    var gapX = cardW + 40;
    var gapY = cardH + 40;
    var cols = Math.max(1, Math.ceil(Math.sqrt(total)));
    var col = idx % cols;
    var row = Math.floor(idx / cols);
    return { x: baseX + col * gapX, y: baseY + row * gapY };
  }

  /* Shared by both context menus below — flips to the opposite side if
     the natural position would overflow, then clamps the final result
     within the viewport. The flip alone wasn't enough at small window
     sizes: if the menu is wider/taller than the available space even
     after flipping, it still clipped off the *other* edge. */
  function positionMenuInViewport(menu, x, y) {
    menu.style.left = x + 'px';
    menu.style.top  = y + 'px';
    menu.style.display = 'block';

    var rect = menu.getBoundingClientRect();
    var left = x, top = y;
    if (rect.right  > window.innerWidth)  left = x - rect.width;
    if (rect.bottom > window.innerHeight) top  = y - rect.height;
    left = Math.max(4, Math.min(left, window.innerWidth  - rect.width  - 4));
    top  = Math.max(4, Math.min(top,  window.innerHeight - rect.height - 4));
    menu.style.left = left + 'px';
    menu.style.top  = top + 'px';
  }

  function handleDroppedFiles(files, worldPos) {
    /* Intercept .pur files — route to PureRef importer */
    for (var p = 0; p < files.length; p++) {
      if (files[p].path && files[p].path.toLowerCase().slice(-4) === '.pur') {
        importPurFromPath(files[p].path);
        return;
      }
    }

    /* Folder-drop auto-arrange (4.8.0) — a dropped folder arrives here
       as one opaque, unreadable "File" (the renderer has no filesystem
       access at all to look inside it itself); resolve-dropped-paths
       expands any folder into the loose image/video/audio files
       directly inside it (non-recursive) and passes plain files
       straight through unchanged. Same grid-arrange behavior below
       either way — this only changes what's IN the files array before
       that runs, giving the "dump a folder of images" workflow the
       same fast one-step result as an actual .pur import's own grid
       fallback (v4.6.1), without needing PureRef at all. */
    var pathsToResolve = [];
    for (var pi = 0; pi < files.length; pi++) {
      if (files[pi].path) pathsToResolve.push(files[pi].path);
    }
    if (typeof KanvazBridge !== 'undefined' && KanvazBridge.resolveDroppedPaths && pathsToResolve.length) {
      KanvazBridge.resolveDroppedPaths(pathsToResolve).then(function(resolvedPaths) {
        if (!resolvedPaths.length) {
          KanvazUI.toast('No supported image/video/audio files found in the dropped item(s)', 'error');
          return;
        }
        var resolvedFiles = [];
        for (var ri = 0; ri < resolvedPaths.length; ri++) {
          var rp = resolvedPaths[ri];
          var sep = Math.max(rp.lastIndexOf('/'), rp.lastIndexOf('\\'));
          resolvedFiles.push({ path: rp, name: sep === -1 ? rp : rp.slice(sep + 1) });
        }
        placeDroppedFiles(resolvedFiles, worldPos);
      }).catch(function(e) {
        console.warn('[Kanvaz] resolveDroppedPaths IPC failed, falling back to the raw drop:', e);
        placeDroppedFiles(files, worldPos);
      });
      return;
    }

    placeDroppedFiles(files, worldPos);
  }

  function placeDroppedFiles(files, worldPos) {
    /* Grid-arrange the drop instead of a small diagonal cascade — a
       24px-per-file offset barely separates cards that are ~200-300px,
       so any real batch drop (10-20 files) visually stacked on top of
       each other. Cards keep drop order (left-to-right, top-to-bottom)
       so "in sequence" is preserved, they just no longer overlap. */
    for (var i = 0; i < files.length; i++) {
      (function(file, idx) {
        var pos = gridArrangePos(worldPos.x, worldPos.y, idx, files.length);
        if (!file.path) {
          KanvazErrors.handle('FILE_NOT_FOUND', file.name);
          return;
        }
        var isModelFile = KanvazMedia.MODEL_EXTS.indexOf(file.path.split('.').pop().toLowerCase()) !== -1;
        var isExternalConvertFile = KanvazMedia.EXTERNAL_CONVERT_EXTS.indexOf(file.path.split('.').pop().toLowerCase()) !== -1;
        KanvazMedia.loadFromFile(file, function(result, err) {
          if (err) {
            if (err === 'FILE_TOO_LARGE') {
              KanvazUI.toast((isModelFile || isExternalConvertFile)
                ? 'Model too large for Kanvaz (max 150MB). Try a decimated/compressed export.'
                : 'File too large for Kanvaz (max 500MB). Use a smaller preview or proxy file.', 'error');
            } else if (err === 'FILE_TYPE_INVALID') {
              KanvazUI.toast('"' + file.name + '" is not supported. Supported: JPG, PNG, GIF, BMP, WEBP, MP4, WEBM, MOV, MP3, WAV, OGG, M4A, GLB, GLTF, OBJ, FBX, STL, PLY, VOX, USD, USDZ, BLEND', 'error');
            } else if (err === 'EXTERNAL_TOOL_NOT_FOUND') {
              /* Blender genuinely not installed is the expected, common
                 case for most users, not a bug — fall back to a plain
                 file-reference card (same pattern PDF/unsupported-type
                 cards already use) instead of a hard error, and say
                 plainly why, since "could not load" alone would look
                 like Kanvaz is broken rather than a missing optional
                 tool. */
              KanvazCards.createFileRefCardAtPath(pos.x, pos.y, file.path);
              /* Direct feedback: "it says download blender like what?"
                 — the old message named a requirement with no context
                 for what it even is or whether it's optional. Blender
                 is a separate, real (and free) 3D tool at blender.org,
                 entirely optional — Kanvaz already added the file as a
                 real reference either way, this is purely about
                 unlocking the LIVE 3D preview on top of that. */
              KanvazUI.toast('"' + file.name + '" added as a file reference. For a live 3D preview, install the free Blender app (blender.org) and drop it again — totally optional either way.', 'warning');
            } else if (err === 'EXTERNAL_TOOL_FAILED') {
              /* Direct feedback: "the .blend dropped but error came...
                 didn't add to list" — this branch showed the error but,
                 unlike EXTERNAL_TOOL_NOT_FOUND right above it, never
                 fell back to a file-reference card, leaving nothing on
                 the board at all. Blender being installed but failing
                 to convert THIS specific file (corrupt, or using a
                 feature the conversion script can't handle) is no
                 different from Blender not being installed at all from
                 the user's perspective — either way, live 3D preview
                 isn't happening, but the file itself is still real and
                 worth keeping a reference to. Same fallback, same
                 "something is better than nothing" reasoning. */
              KanvazCards.createFileRefCardAtPath(pos.x, pos.y, file.path);
              KanvazUI.toast('Blender could not convert "' + file.name + '" — the file may be corrupt or use features this conversion can\'t handle. Added it as a file reference instead.', 'error');
            } else {
              KanvazUI.toast('Could not load "' + file.name + '"', 'error');
            }
            return;
          }

          /* 200MB-500MB: confirm before adding */
          if (result.large) {
            var roundedMB = Math.round(result.sizeMB);
            KanvazUI.showDialog(
              'Large file',
              'Large file (' + roundedMB + 'MB) — may affect canvas performance. Add anyway?',
              [
                { label: 'Add',    cls: 'primary', action: function() { KanvazCards.createFromMedia(result, pos); } },
                { label: 'Cancel', cls: '',         action: function() {} }
              ]
            );
            return;
          }

          KanvazCards.createFromMedia(result, pos);

          /* Warn on formats Chromium may not support */
          if (result.ext === 'mkv' || result.ext === 'avi') {
            KanvazUI.toast(file.name + ' may not play — MKV/AVI support is limited. MP4 or WebM recommended.', 'error');
          }
        });
      })(files[i], i);
    }
  }

  /* ── Clipboard paste ── */

  /* ══════════════════════════════════════════
     SEARCH / FILTER (Ctrl+F or /)
     Floating search bar that filters cards live by name, type, or tag.
     Dims non-matching cards (opacity 0.15) instead of hiding them so
     spatial context is preserved — you can still see where things are
     relative to each other, just with the matches visually popping.
     Esc or clearing the input restores all cards to full opacity.
     ══════════════════════════════════════════ */
  var searchBar = null;
  var searchInput = null;
  var searchActive = false;
  /* Bug-bounty fix: the type-filter dropdown (typeMenu, built fresh
     inside showSearchBar() below) is appended straight to document.body
     rather than inside searchBar, so closing the search bar never
     touched it — leaving it floating, orphaned, and un-clickable-away
     the moment searchBar itself was removed out from under it. Set by
     showSearchBar() each time it (re)builds the dropdown's own
     closeTypeMenu(), so hideSearchBar() below has something to call. */
  var closeTypeMenuFn = null;

  /* Session-scoped (not persisted to settings — this is "where did I
     leave it this session," same category as which card is selected),
     null until the user actually drags it once, meaning "use the
     default centered spot." Direct feedback: "make search bar movable
     as user want." */
  var searchBarPos = null;

  function positionSearchElements() {
    var left = searchBarPos ? searchBarPos.x + 'px' : '50%';
    var top  = searchBarPos ? searchBarPos.y + 'px' : '90px';
    var xform = searchBarPos ? 'none' : 'translateX(-50%)';
    if (searchBar) { searchBar.style.left = left; searchBar.style.top = top; searchBar.style.transform = xform; }
    var secondTop = searchBarPos ? (searchBarPos.y + 42) + 'px' : '132px';
    if (smartFolderRow) { smartFolderRow.style.left = left; smartFolderRow.style.top = secondTop; smartFolderRow.style.transform = xform; }
    if (commandResultsEl) { commandResultsEl.style.left = left; commandResultsEl.style.top = secondTop; commandResultsEl.style.transform = xform; }
  }

  function showSearchBar() {
    if (searchActive) { focusSearchBar(); return; }
    searchActive = true;

    searchBar = document.createElement('div');
    searchBar.id = 'search-bar';
    searchBar.style.cssText = [
      'position:fixed', 'top:90px', 'left:50%', 'transform:translateX(-50%)',
      'width:320px', 'display:flex', 'align-items:center', 'gap:8px',
      'padding:8px 14px',
      'background:var(--color-surface)', 'border:1px solid var(--color-border-2)',
      'border-radius:var(--radius-lg)', 'box-shadow:0 8px 32px var(--color-shadow)',
      'z-index:10000',
      'animation:search-bar-in 0.2s ease-out'
    ].join(';');

    /* Drag handle — a dedicated grip rather than "drag the bar's own
       background," since flex children already fill nearly all of the
       bar's width and leave no practical grab area otherwise. */
    var dragHandle = document.createElement('span');
    dragHandle.title = 'Drag to move';
    dragHandle.style.cssText = 'cursor:move;flex-shrink:0;display:flex;color:var(--color-text-3);';
    dragHandle.innerHTML = '<svg width="10" height="14" viewBox="0 0 10 14" fill="currentColor"><circle cx="2" cy="2" r="1.3"/><circle cx="8" cy="2" r="1.3"/><circle cx="2" cy="7" r="1.3"/><circle cx="8" cy="7" r="1.3"/><circle cx="2" cy="12" r="1.3"/><circle cx="8" cy="12" r="1.3"/></svg>';
    dragHandle.addEventListener('mousedown', function(e) {
      e.preventDefault();
      var rect = searchBar.getBoundingClientRect();
      var offX = e.clientX - rect.left;
      var offY = e.clientY - rect.top;
      function onMove(ev) {
        searchBarPos = { x: ev.clientX - offX, y: ev.clientY - offY };
        positionSearchElements();
      }
      function onUp() {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
      }
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });
    searchBar.appendChild(dragHandle);

    /* Polish fix: was a raw magnifying-glass emoji, rendered via the OS
       emoji font \u2014 visually clashes with every other icon in the app,
       which is a hand-drawn stroke-based SVG set (stroke-width:1.5,
       stroke-linecap:round, see index.html's toolbar icons). Matching
       that convention here instead of standing out as the one emoji
       in an otherwise all-vector UI. */
    var icon = document.createElement('span');
    icon.style.cssText = 'color:var(--color-text-3);flex-shrink:0;display:flex;';
    icon.innerHTML = '<svg width="14" height="14" viewBox="0 0 14 14" fill="none"><circle cx="6" cy="6" r="4.5" stroke="currentColor" stroke-width="1.5"/><path d="M9.5 9.5L12.5 12.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>';

    searchInput = document.createElement('input');
    searchInput.type = 'text';
    searchInput.placeholder = 'Search by name, type, or tag…';
    searchInput.style.cssText = [
      'flex:1', 'background:transparent', 'border:none', 'outline:none',
      'color:var(--color-text)', 'font-family:var(--font-ui)', 'font-size:13px'
    ].join(';');

    /* v6.2.0 \u2014 Smart Folders: a saved search that keeps re-running
       itself, Eagle's own standout feature. Stored in settings.json
       (settings.smartFolders), not per-board \u2014 these are reusable query
       patterns ("all my color-graded shots," "tag:hero"), not content
       tied to one specific board. */
    var saveBtn = document.createElement('span');
    saveBtn.title = 'Save this search as a Smart Folder';
    saveBtn.style.cssText = 'cursor:pointer;color:var(--color-text-3);flex-shrink:0;display:flex;';
    saveBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M7 1.5l1.6 3.4 3.7.5-2.7 2.6.6 3.7L7 9.9l-3.2 1.8.6-3.7-2.7-2.6 3.7-.5L7 1.5z" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/></svg>';
    saveBtn.addEventListener('click', function() {
      var q = searchInput.value.trim();
      if (!q) { KanvazUI.toast('Type a search first'); return; }
      KanvazUI.showPrompt('Save Smart Folder', 'Name this Smart Folder:', q, function(name) {
        if (typeof KanvazUI_Extended === 'undefined') return;
        var s = KanvazUI_Extended.getSettings();
        if (!s) return;
        if (!s.smartFolders) s.smartFolders = [];
        s.smartFolders.push({ id: 'sf-' + Date.now(), name: name, query: q });
        KanvazBridge.writeSettings(JSON.stringify(s));
        renderSmartFolderChips();
        KanvazUI.toast('Saved Smart Folder "' + name + '"');
      });
    });

    /* Type filter \u2014 click the funnel to filter by card type, cards
       get dimmed the same way a text mismatch already dims them; click
       "Clear filter" while one is active to clear it. Direct feedback:
       "the circled svg must work as [a filter]... more types of object
       can be searched with search, types of ref cards not the color
       swatch" \u2014 this was a color-proximity filter before, replaced
       outright rather than added alongside (see clearSearchFilter's
       area below for the removed color-matching code). */
    var typeFilterBtn = document.createElement('span');
    typeFilterBtn.title = 'Filter by card type';
    typeFilterBtn.style.cssText = 'cursor:pointer;flex-shrink:0;display:flex;align-items:center;justify-content:center;width:20px;height:20px;color:' + (activeTypeFilter ? 'var(--color-accent)' : 'var(--color-text-3)') + ';';
    typeFilterBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/></svg>';

    var typeMenu = null;

    function closeTypeMenu() {
      if (typeMenu) { typeMenu.remove(); typeMenu = null; }
      document.removeEventListener('mousedown', onOutsideClick, true);
      document.removeEventListener('keydown', onTypeMenuEscape, true);
    }
    closeTypeMenuFn = closeTypeMenu;
    function onOutsideClick(e) {
      if (typeMenu && !typeMenu.contains(e.target) && e.target !== typeFilterBtn) closeTypeMenu();
    }
    /* Polish fix: Escape used to close the search bar itself but leave
       this dropdown open and orphaned behind it — same class of cleanup
       gap hideSearchBar()'s own commandResultsEl removal exists to
       prevent. Added/removed in lockstep with onOutsideClick (not a
       bare unconditional document listener added once per search-bar
       session) so reopening the search bar repeatedly can't stack up
       duplicate listeners the way a naive always-on binding would. */
    function onTypeMenuEscape(e) {
      if (e.key === 'Escape' && typeMenu) closeTypeMenu();
    }

    typeFilterBtn.addEventListener('click', function(e) {
      e.stopPropagation();
      if (typeMenu) { closeTypeMenu(); return; }

      var rect = typeFilterBtn.getBoundingClientRect();
      typeMenu = document.createElement('div');
      typeMenu.style.cssText = 'position:fixed;left:' + rect.left + 'px;top:' + (rect.bottom + 8) + 'px;background:var(--color-surface);border:1px solid var(--color-border-2);border-radius:var(--radius-md);box-shadow:0 8px 32px var(--color-shadow);z-index:20001;padding:4px;min-width:140px;';

      if (activeTypeFilter) {
        var clearRow = document.createElement('div');
        clearRow.textContent = 'Clear filter';
        clearRow.style.cssText = 'padding:6px 10px;font-size:12px;color:var(--color-text-2);cursor:pointer;border-radius:5px;border-bottom:1px solid var(--color-border);margin-bottom:2px;';
        clearRow.addEventListener('mouseenter', function() { clearRow.style.background = 'var(--color-surface-2)'; });
        clearRow.addEventListener('mouseleave', function() { clearRow.style.background = 'transparent'; });
        clearRow.addEventListener('click', function() {
          setTypeFilter(null);
          typeFilterBtn.style.color = 'var(--color-text-3)';
          closeTypeMenu();
        });
        typeMenu.appendChild(clearRow);
      }

      for (var i = 0; i < CARD_TYPE_FILTER_OPTIONS.length; i++) {
        (function(opt) {
          var row = document.createElement('div');
          var isOn = activeTypeFilter === opt[0];
          /* Polish fix: "polish improve the filter opt in search bar" —
             the only signal for "this is the active type" used to be the
             label's own text color, easy to miss at a glance in a plain
             list of 10 otherwise-identical rows. A trailing checkmark
             reads instantly the way every other menu with a persisted
             choice in the app already does (Theme, Grid style). */
          row.style.cssText = 'display:flex;align-items:center;justify-content:space-between;gap:10px;padding:6px 10px;font-size:12px;color:' + (isOn ? 'var(--color-accent)' : 'var(--color-text)') + ';cursor:pointer;border-radius:5px;';
          var label = document.createElement('span');
          label.textContent = opt[1];
          row.appendChild(label);
          if (isOn) {
            var check = document.createElement('span');
            check.innerHTML = '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>';
            check.style.cssText = 'display:flex;flex-shrink:0;';
            row.appendChild(check);
          }
          row.addEventListener('mouseenter', function() { row.style.background = 'var(--color-surface-2)'; });
          row.addEventListener('mouseleave', function() { row.style.background = 'transparent'; });
          row.addEventListener('click', function() {
            setTypeFilter(opt[0]);
            typeFilterBtn.style.color = 'var(--color-accent)';
            closeTypeMenu();
          });
          typeMenu.appendChild(row);
        })(CARD_TYPE_FILTER_OPTIONS[i]);
      }

      document.body.appendChild(typeMenu);
      setTimeout(function() {
        document.addEventListener('mousedown', onOutsideClick, true);
        document.addEventListener('keydown', onTypeMenuEscape, true);
      }, 0);
    });

    var closeBtn = document.createElement('span');
    closeBtn.style.cssText = 'cursor:pointer;color:var(--color-text-3);font-size:16px;flex-shrink:0;';
    closeBtn.textContent = '\u00D7';
    closeBtn.addEventListener('click', function() { hideSearchBar(); });

    searchInput.addEventListener('input', function() {
      applySearchFilter(searchInput.value);
      updateCommandResults(searchInput.value);
    });
    searchInput.addEventListener('keydown', function(e) {
      e.stopPropagation();
      if (e.key === 'Escape') hideSearchBar();
    });

    searchBar.appendChild(icon);
    searchBar.appendChild(searchInput);
    searchBar.appendChild(typeFilterBtn);
    searchBar.appendChild(saveBtn);
    searchBar.appendChild(closeBtn);
    document.body.appendChild(searchBar);

    /* Saved Smart Folders \u2014 a row of clickable chips under the input,
       only rendered when at least one exists. Rebuilt (not just shown/
       hidden) on every open/save/delete so a folder saved from a
       previous session \u2014 or deleted just now \u2014 is always accurate. */
    smartFolderRow = document.createElement('div');
    smartFolderRow.id = 'smart-folder-row';
    smartFolderRow.style.cssText = 'position:fixed;top:132px;left:50%;transform:translateX(-50%);width:320px;display:flex;flex-wrap:wrap;gap:6px;z-index:10000;';
    document.body.appendChild(smartFolderRow);
    renderSmartFolderChips();

    /* Direct feedback: "the search tool can search settings, tools and
       about and all stuff in app can be searched from it." The Command
       Palette (Ctrl+K) already covers every registered command
       (Settings/About/Shortcuts/etc.), but that's a second shortcut
       the user has to already know about — this surfaces the same
       matches directly under the board search bar instead, so there's
       one search habit that reaches everything, not two separate ones. */
    commandResultsEl = document.createElement('div');
    commandResultsEl.id = 'search-command-results';
    commandResultsEl.style.cssText = 'position:fixed;top:132px;left:50%;transform:translateX(-50%);width:320px;background:var(--color-surface);border:1px solid var(--color-border-2);border-radius:var(--radius-md);box-shadow:0 8px 32px var(--color-shadow);z-index:10000;padding:4px;display:none;';
    document.body.appendChild(commandResultsEl);

    positionSearchElements();
    searchInput.focus();
  }

  var smartFolderRow = null;
  var commandResultsEl = null;

  /* Matches the search query against every registered app command
     (KanvazCommands — the same registry Ctrl+K's palette reads from)
     and shows up to 3 results right under the search bar. Runs a
     command and closes the search bar on click, same "pick it and
     you're done" feel as clicking a card result. */
  function updateCommandResults(query) {
    if (!commandResultsEl) return;
    commandResultsEl.innerHTML = '';
    var q = (query || '').trim();
    if (!q || typeof KanvazCommands === 'undefined') {
      commandResultsEl.style.display = 'none';
      return;
    }

    var all = KanvazCommands.getAllCommands();
    var scored = [];
    for (var i = 0; i < all.length; i++) {
      var score = KanvazCommands.fuzzyScore(q, all[i].label);
      if (score !== null) scored.push({ cmd: all[i], score: score });
    }
    scored.sort(function(a, b) { return a.score - b.score; });
    var top = scored.slice(0, 3);

    if (!top.length) {
      commandResultsEl.style.display = 'none';
      return;
    }

    var heading = document.createElement('div');
    heading.textContent = 'APP';
    heading.style.cssText = 'font-size:9px;font-weight:600;letter-spacing:0.08em;color:var(--color-text-3);padding:6px 8px 3px;';
    commandResultsEl.appendChild(heading);

    for (var j = 0; j < top.length; j++) {
      (function(cmd) {
        var row = document.createElement('div');
        row.style.cssText = 'display:flex;align-items:center;justify-content:space-between;padding:6px 8px;font-size:12px;color:var(--color-text);cursor:pointer;border-radius:5px;';
        var label = document.createElement('span');
        label.textContent = cmd.label;
        row.appendChild(label);
        if (cmd.shortcut) {
          var shortcut = document.createElement('span');
          shortcut.textContent = cmd.shortcut;
          shortcut.style.cssText = 'font-size:10px;color:var(--color-text-3);font-family:var(--font-mono);';
          row.appendChild(shortcut);
        }
        row.addEventListener('mouseenter', function() { row.style.background = 'var(--color-surface-2)'; });
        row.addEventListener('mouseleave', function() { row.style.background = 'transparent'; });
        row.addEventListener('mousedown', function(e) { e.preventDefault(); });
        row.addEventListener('click', function() {
          KanvazCommands.runCommand(cmd.id);
          hideSearchBar();
        });
        commandResultsEl.appendChild(row);
      })(top[j].cmd);
    }

    commandResultsEl.style.display = '';
  }

  function renderSmartFolderChips() {
    /* Also refreshes the persistent Smart Folders list in the Boards
       side panel (boards.js), if that section happens to be showing
       right now — same underlying settings.smartFolders array, two
       places it's rendered. */
    if (typeof KanvazBoards !== 'undefined' && KanvazBoards.renderBoardsList) {
      KanvazBoards.renderBoardsList();
    }
    if (!smartFolderRow) return;
    smartFolderRow.innerHTML = '';
    if (typeof KanvazUI_Extended === 'undefined') return;
    var s = KanvazUI_Extended.getSettings();
    /* Favorites first \u2014 same ordering the side panel's own Smart
       Folders list (boards.js) applies, so "favorite one, find it
       faster" holds true in both places it's rendered. .slice() before
       .sort() so this never reorders the underlying settings.json array
       itself (sort() mutates in place) just from rendering. */
    var folders = ((s && s.smartFolders) || []).slice().sort(function(a, b) {
      return (b.favorite ? 1 : 0) - (a.favorite ? 1 : 0);
    });
    for (var i = 0; i < folders.length; i++) {
      (function(folder) {
        var chip = document.createElement('div');
        chip.style.cssText = 'display:flex;align-items:center;gap:5px;padding:3px 8px;background:var(--color-surface);border:1px solid var(--color-border-2);border-radius:999px;font-size:11px;color:var(--color-text-2);cursor:pointer;box-shadow:0 2px 8px var(--color-shadow);';
        chip.title = 'Left-click: run this search. Right-click: more options.';

        if (folder.favorite) {
          var heart = document.createElement('span');
          heart.style.cssText = 'display:flex;color:var(--color-red);flex-shrink:0;';
          heart.innerHTML = '<svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><path d="M12 21s-6.7-4.35-9.3-8.1C1 10.3 1.7 6.9 4.6 5.4 6.9 4.2 9.6 5 12 7.3 14.4 5 17.1 4.2 19.4 5.4c2.9 1.5 3.6 4.9 1.9 7.5C18.7 16.65 12 21 12 21z"/></svg>';
          chip.appendChild(heart);
        }

        var label = document.createElement('span');
        label.textContent = folder.name;
        chip.appendChild(label);
        var del = document.createElement('span');
        del.textContent = '\u00D7';
        del.style.cssText = 'color:var(--color-text-3);cursor:pointer;';
        del.title = 'Delete this Smart Folder';
        del.addEventListener('click', function(e) {
          e.stopPropagation();
          var s2 = KanvazUI_Extended.getSettings();
          if (!s2 || !s2.smartFolders) return;
          s2.smartFolders = s2.smartFolders.filter(function(f) { return f.id !== folder.id; });
          KanvazBridge.writeSettings(JSON.stringify(s2));
          renderSmartFolderChips();
        });
        chip.appendChild(del);
        chip.addEventListener('click', function() {
          if (searchInput) {
            searchInput.value = folder.query;
            applySearchFilter(folder.query);
          }
        });
        /* Direct feedback: "right click on search will give options
           open, fav it with heart svg and more" \u2014 routes to the same
           smartFolder branch showCardContextMenu's sibling
           showContextMenu() gained above, so Open/Favorite/Rename/
           Edit query/Delete are all one shared implementation instead
           of a second copy living here. */
        chip.addEventListener('contextmenu', function(e) {
          e.preventDefault();
          if (typeof KanvazUI !== 'undefined' && KanvazUI.showContextMenu) {
            KanvazUI.showContextMenu(e.clientX, e.clientY, 'smartFolder', folder);
          }
        });
        smartFolderRow.appendChild(chip);
      })(folders[i]);
    }
  }

  function focusSearchBar() {
    if (searchInput) searchInput.focus();
  }

  function hideSearchBar() {
    searchActive = false;
    if (searchBar) { searchBar.remove(); searchBar = null; searchInput = null; }
    if (smartFolderRow) { smartFolderRow.remove(); smartFolderRow = null; }
    if (commandResultsEl) { commandResultsEl.remove(); commandResultsEl = null; }
    if (closeTypeMenuFn) { closeTypeMenuFn(); closeTypeMenuFn = null; }
    clearSearchFilter();
  }

  /* v6.2.0 — color search (Eagle's own standout feature). Dominant color
     is computed on first use per card and cached in-memory only
     Combines with the text query via AND: with both set, a card must
     match the text AND be the selected type to stay visible.

     v7.x — this used to be a color-proximity filter (average-sample a
     card's dominant color, click a swatch to match nearby colors).
     Direct feedback: "the circled svg must work as sort between
     settings and more types of object can be searched with search,
     types of ref cards not the color swatch." Replaced outright rather
     than added alongside — the old color-filter UI was the only way
     to ever set it, so keeping that matching code with no way to
     trigger it left dead code behind. */
  var activeTypeFilter = null; /* card.type string, or null */
  var CARD_TYPE_FILTER_OPTIONS = [
    ['image', 'Image'], ['gif', 'GIF'], ['video', 'Video'], ['audio', 'Audio'],
    ['note', 'Note'], ['text', 'Text'], ['color', 'Color'], ['url', 'URL'],
    ['file', 'File'], ['model3d', '3D Model']
  ];

  function setTypeFilter(type) {
    activeTypeFilter = type;
    applySearchFilter(searchInput ? searchInput.value : '');
  }

  function applySearchFilter(query) {
    var q = query.trim().toLowerCase();
    var allCards = KanvazCards.getAll();
    for (var id in allCards) {
      var card = allCards[id];
      var el = document.getElementById(id);
      if (!el) continue;

      if (!q && !activeTypeFilter) {
        el.style.opacity = '';
        el.style.filter = '';
        continue;
      }

      var textOk = true;
      if (q) {
        var nameMatch = (card.name || '').toLowerCase().indexOf(q) !== -1;
        var typeMatch = (card.type || '').toLowerCase().indexOf(q) !== -1;
        var tagMatch = false;
        if (card.tags && card.tags.length) {
          for (var t = 0; t < card.tags.length; t++) {
            if (card.tags[t].toLowerCase().indexOf(q) !== -1) { tagMatch = true; break; }
          }
        }
        textOk = nameMatch || typeMatch || tagMatch;
      }

      var typeOk = !activeTypeFilter || card.type === activeTypeFilter;

      if (textOk && typeOk) {
        el.style.opacity = '';
        el.style.filter = '';
      } else {
        el.style.opacity = '0.12';
        el.style.filter = 'grayscale(1)';
      }
    }

    scheduleSmartSearch(q);
  }

  /* v6.3.0 — Smart Search: an async enhancement layer on top of the
     synchronous substring match above, never a replacement for it. The
     substring pass already ran and dimmed/undimmed everything by the
     time this resolves (a real IPC round-trip to the worker, not
     instant) — this only ever REVEALS more cards a plain substring
     match missed (lemmatized/fuzzy hits), never re-dims one substring
     already matched. Completely inert — no timer set, no IPC call made
     — when the setting is off, which is the actual point of its own
     off switch, not just a UI toggle. */
  var smartSearchDebounceTimer = null;
  /* Bug-bounty fix: the index used to get rebuilt (full-board
     re-lemmatization, on the worker side) on every single debounced
     keystroke, not just when the board's cards had actually changed —
     independently flagged by two review angles as real, avoidable cost
     on the search-typing hot path. Indexing now happens at most once
     per search-bar session (reset whenever the bar opens/closes), and
     every subsequent keystroke only sends the query itself. A card
     edited WHILE the search bar stays open won't be reflected in Smart
     Search's results until the bar is reopened — an accepted, disclosed
     staleness window, since the synchronous substring pass above it is
     always accurate regardless and never depends on this index. */
  var smartSearchIndexedThisSession = false;

  function smartSearchIsOn() {
    if (typeof KanvazUI_Extended === 'undefined') return false;
    var s = KanvazUI_Extended.getSettings();
    return !!(s && s.smartSearchEnabled);
  }

  /* Bug-bounty fix: crashing the worker used to leave settings.json's
     smartSearchEnabled sitting at true forever with no way back to
     false except an unrelated Settings change — the checkbox kept
     claiming the feature was on while it was actually dead. main.js's
     worker now tells the renderer directly the moment it crashes. */
  if (typeof KanvazBridge !== 'undefined' && KanvazBridge.on) {
    KanvazBridge.on('smart-search-crashed', function() {
      if (typeof KanvazUI_Extended === 'undefined') return;
      var s = KanvazUI_Extended.getSettings();
      if (!s || !s.smartSearchEnabled) return;
      s.smartSearchEnabled = false;
      KanvazBridge.writeSettings(JSON.stringify(s));
      if (typeof KanvazUI !== 'undefined') KanvazUI.toast('Smart Search stopped unexpectedly and was turned off — plain search still works.', 'error');
    });
  }

  function scheduleSmartSearch(q) {
    if (smartSearchDebounceTimer) { clearTimeout(smartSearchDebounceTimer); smartSearchDebounceTimer = null; }
    if (!q || !smartSearchIsOn() || typeof KanvazBridge === 'undefined' || !KanvazBridge.smartSearchQuery) return;

    smartSearchDebounceTimer = setTimeout(function() {
      smartSearchDebounceTimer = null;

      var indexed = smartSearchIndexedThisSession
        ? Promise.resolve()
        : (function() {
            var allCards = KanvazCards.getAll();
            var cardTexts = [];
            for (var id in allCards) {
              var c = allCards[id];
              cardTexts.push({
                id: id,
                text: [c.name, c.type, (c.tags || []).join(' '), c.text || ''].join(' ')
              });
            }
            smartSearchIndexedThisSession = true;
            return KanvazBridge.smartSearchIndex(cardTexts);
          })();

      indexed.then(function() {
        return KanvazBridge.smartSearchQuery(q);
      }).then(function(res) {
        if (!res || !res.results) return;
        /* If the query changed again while this round-trip was in
           flight, the input's current value no longer matches what was
           actually searched — applying stale results now would reveal
           cards for a query the user isn't looking at anymore. */
        if (!searchInput || searchInput.value.trim().toLowerCase() !== q) return;
        for (var i = 0; i < res.results.length; i++) {
          var el = document.getElementById(res.results[i]);
          if (!el) continue;
          /* Bug-bounty fix (v6.2.0, carried forward through the color
             → type filter swap): this used to unconditionally reveal
             every Smart Search match, ignoring the active filter
             entirely — silently breaking the "must match both"
             contract the substring pass above already established. A
             Smart-Search-only match still has to pass the same type
             check to actually get revealed. */
          if (activeTypeFilter) {
            var card = KanvazCards.getAll()[res.results[i]];
            if (!card || card.type !== activeTypeFilter) continue;
          }
          el.style.opacity = '';
          el.style.filter = '';
        }
      }).catch(function() { /* Smart Search unavailable — the substring match above already stands on its own */ });
    }, 300);
  }

  function clearSearchFilter() {
    activeTypeFilter = null;
    smartSearchIndexedThisSession = false;
    if (smartSearchDebounceTimer) { clearTimeout(smartSearchDebounceTimer); smartSearchDebounceTimer = null; }
    var allCards = KanvazCards.getAll();
    for (var id in allCards) {
      var el = document.getElementById(id);
      if (el) { el.style.opacity = ''; el.style.filter = ''; }
    }
  }

  function handlePaste(e) {
    var items = e.clipboardData && e.clipboardData.items;
    if (!items) return;

    /* Collect image items first so we know the real count up front —
       the previous approach read document.querySelectorAll('.card').length
       inside each async FileReader callback, which is both racy (async
       completion order isn't guaranteed to match paste order) and used
       the same too-small 24px cascade that stacked drag-dropped files. */
    var imageItems = [];
    for (var i = 0; i < items.length; i++) {
      if (items[i].type.indexOf('image') !== -1) {
        var blob = items[i].getAsFile();
        if (blob) imageItems.push(blob);
      }
    }
    if (!imageItems.length) return;

    var scale = KanvazCanvas.getScale();
    var baseX = (-KanvazCanvas.getTx() / scale) + 80;
    var baseY = (-KanvazCanvas.getTy() / scale) + 80;

    for (var j = 0; j < imageItems.length; j++) {
      (function(b, idx) {
        var pos = gridArrangePos(baseX, baseY, idx, imageItems.length);
        var reader = new FileReader();
        reader.onload = function(ev) {
          KanvazCards.createFromDataUrl(ev.target.result, 'pasted-image.png', pos);
        };
        reader.readAsDataURL(b);
      })(imageItems[j], j);
    }
  }

  /* ── Always on top ── */

  /* v6.0.0: no dedicated toolbar button any more — on by default (see
     ui.js's SETTINGS_DEFAULTS), reachable via Command Palette or the
     Settings checkbox for the minority who want it off. */
  function toggleAlwaysOnTop() {
    /* Self-audit catch (Top Mode review): this is reachable via the
       Command Palette regardless of Top Mode, and both flips the live
       window state AND persists to settings.json. Invoking it while Top
       Mode has forced always-on-top on would silently overwrite the
       user's real, persisted preference with Top Mode's transient
       state, then diverge further the moment Settings next re-applies
       or the app restarts. Block it here and point at the actual way
       out, same as any other "this needs Top Mode off first" case. */
    if (topModeActive) {
      KanvazUI.toast('Exit Top Mode first (Ctrl+Shift+T)', 'warning');
      return;
    }
    alwaysOnTop = !alwaysOnTop;
    KanvazBridge.setAlwaysOnTop(alwaysOnTop);
    /* Persist to settings so the value survives restart */
    if (typeof KanvazUI_Extended !== 'undefined') {
      var s = KanvazUI_Extended.getSettings();
      if (s) {
        s.alwaysOnTop = alwaysOnTop;
        KanvazBridge.writeSettings(JSON.stringify(s));
      }
    }
    KanvazUI.toast(alwaysOnTop ? 'Always on top: on' : 'Always on top: off');
  }

  /* v6.0.0: called from ui.js's applySettings() (both on startup and on
     every Settings-panel change), to keep this module's own `alwaysOnTop`
     var in sync with the persisted setting — without this, toggleAlwaysOnTop()
     (still reachable via Command Palette) would get the in-memory value
     out of sync with the actual window state the very first time it's
     called after a settings change, and flip the wrong direction.
     Doesn't toast or re-persist — ui.js already owns that side of it. */
  function syncAlwaysOnTop(flag) {
    alwaysOnTop = !!flag;
    KanvazBridge.setAlwaysOnTop(alwaysOnTop);
  }

  /* ── Top Mode (reintroduced, v8.7.0, per direct request) ──
     Removed entirely in v6.0.0 on the reasoning that "float on top +
     hide the chrome" had become the app's own persistent default, so a
     separate mode toggling the same two things felt redundant. That
     default only ever covered always-on-top + the auto-hide toolbar,
     though — it never touched the side panel, which stays open (or
     closed, whatever it was) regardless. "Get everything but the
     canvas out of the way, right now, then back to exactly how it
     was" is a real, distinct ask from the standing defaults, which is
     why this is back as its own toggle rather than just pointing the
     shortcut at the existing Settings checkboxes.

     Deliberately session-only — never written to settings.json. A
     momentary "floating reference, minimal chrome" working state is
     not a standing preference, the same reasoning already applied to
     Isolate View and view bookmarks. Entering it temporarily overrides
     always-on-top and the auto-hide-chrome setting via the same
     functions their own Settings checkboxes call (syncAlwaysOnTop /
     KanvazUI.setChromeAutoHide) — neither persists on its own, so the
     real persisted settings are untouched and exiting restores them
     exactly.

     Self-audit catch after shipping: that "untouched" claim was only
     true for the specific values captured AT ENTRY. Two other code
     paths write these same two settings and didn't know Top Mode
     existed: ui.js's applySettings() (runs on ANY Settings change, not
     just these two, and would silently snap the live window back to
     the plain persisted value out from under Top Mode's forced
     override) and toggleAlwaysOnTop() (Command Palette — would persist
     Top Mode's transient forced-true state as the user's real
     preference). Fixed by guarding both: toggleAlwaysOnTop() refuses to
     run while Top Mode is active (see above), and applySettings()
     calls noteSettingChangedDuringTopMode() below instead of live-
     applying — keeping Top Mode's forced state in effect while still
     making sure exitTopMode() restores whatever the user's LATEST real
     preference actually is, not a stale entry-time snapshot. */
  var topModeActive  = false;
  var topModeRestore = null;

  function isTopModeActive() {
    return topModeActive;
  }

  /* Called by ui.js's applySettings() instead of live-applying
     alwaysOnTop/autoHideChrome while Top Mode owns them — updates what
     exitTopMode() will restore to, without disturbing Top Mode's
     current forced-on state. No-ops harmlessly if Top Mode isn't
     active (nothing should call it then, but cheap to guard). */
  function noteSettingChangedDuringTopMode(key, value) {
    if (!topModeActive || !topModeRestore) return;
    if (key === 'alwaysOnTop' || key === 'autoHideChrome') {
      topModeRestore[key] = !!value;
    }
  }

  function toggleTopMode() {
    if (topModeActive) exitTopMode(); else enterTopMode();
  }

  function enterTopMode() {
    if (topModeActive) return;
    topModeActive = true;

    var settings = (typeof KanvazUI_Extended !== 'undefined' && KanvazUI_Extended.getSettings)
      ? KanvazUI_Extended.getSettings() : null;
    var sidePanelWasOpen = (typeof KanvazSidePanel !== 'undefined' && KanvazSidePanel.isOpen && KanvazSidePanel.isOpen());

    topModeRestore = {
      alwaysOnTop:      alwaysOnTop,
      autoHideChrome:   settings ? !!settings.autoHideChrome : false,
      sidePanelWasOpen: sidePanelWasOpen
    };

    syncAlwaysOnTop(true);
    if (typeof KanvazUI !== 'undefined' && KanvazUI.setChromeAutoHide) KanvazUI.setChromeAutoHide(true);
    if (sidePanelWasOpen) KanvazSidePanel.close();

    /* Live-CDP-audit catch: this used to target #app, but #app sits
       BEHIND #startup-screen (the Home Screen, position:fixed, opaque,
       z-index 99998) in paint order — the accent border was completely
       invisible any time the Home Screen was open, verified with a
       real screenshot. document.body is an ancestor of every one of
       this app's full-screen overlays (#startup-screen included), so a
       ::after pseudo-element on it (see main.css) paints correctly
       regardless of which screen is showing underneath. */
    document.body.classList.add('top-mode-active');
    showTopModeBadge();

    KanvazUI.toast('Top Mode on — Ctrl+Shift+T to exit');
  }

  function exitTopMode() {
    if (!topModeActive) return;
    topModeActive = false;

    var r = topModeRestore || { alwaysOnTop: alwaysOnTop, autoHideChrome: false, sidePanelWasOpen: false };
    topModeRestore = null;

    syncAlwaysOnTop(!!r.alwaysOnTop);
    if (typeof KanvazUI !== 'undefined' && KanvazUI.setChromeAutoHide) KanvazUI.setChromeAutoHide(!!r.autoHideChrome);
    /* Self-audit catch: re-check isOpen() here rather than blindly
       toggling back open. If the user manually reopened the side panel
       WHILE Top Mode was active (clicked a rail icon), it's already
       open — toggle() would then hit its "open on this section already"
       branch and close it right back, fighting the user's own action.
       Only reopen it here if it's still closed. */
    if (r.sidePanelWasOpen && typeof KanvazSidePanel !== 'undefined' && KanvazSidePanel.toggle
        && !(KanvazSidePanel.isOpen && KanvazSidePanel.isOpen())) {
      KanvazSidePanel.toggle();
    }

    document.body.classList.remove('top-mode-active');
    hideTopModeBadge();

    KanvazUI.toast('Top Mode off');
  }

  function showTopModeBadge() {
    if (document.getElementById('top-mode-badge')) return;
    var badge = document.createElement('div');
    badge.id = 'top-mode-badge';
    badge.textContent = 'Top Mode — Ctrl+Shift+T to exit';
    document.body.appendChild(badge);
  }

  function hideTopModeBadge() {
    var badge = document.getElementById('top-mode-badge');
    if (badge) badge.remove();
  }

  /* ── Presentation Mode ──
     Backlog item: "Presentation/kiosk mode for presenting a board from
     inside the app." Distinct from Top Mode above, which is a working-
     session convenience (still fully editable) — this is for showing a
     board TO SOMEONE ELSE (a client/director review), so it goes
     further: toolbar AND side panel are hard-hidden (never revealed on
     hover, unlike Top Mode's auto-hide-chrome), and the board becomes
     read-only for as long as it's active. Read-only is enforced at a
     single choke point (cards.js's one delegated mousedown handler
     checks this mode first and returns immediately) rather than
     threading a check through every individual drag/resize/delete/
     rename call site — deliberately trades "click a card to select it
     while presenting" for a much smaller, more confidently-correct
     surface to get right and verify. Session-only, same scoping
     decision as Top Mode and view bookmarks — nothing here is ever
     written to the board file. Mutually exclusive with Top Mode (enter
     ing this exits Top Mode first) since both fight over the side panel
     -restore bookkeeping and showing two badges at once would be noise. */
  var presentationModeActive = false;
  var presentationRestore    = null;
  var presentationCardIds    = [];
  var presentationIndex      = -1;

  function isPresentationModeActive() {
    return presentationModeActive;
  }

  function togglePresentationMode() {
    if (presentationModeActive) exitPresentationMode(); else enterPresentationMode();
  }

  function enterPresentationMode() {
    if (presentationModeActive) return;
    if (topModeActive) exitTopMode();
    presentationModeActive = true;

    var sidePanelWasOpen = (typeof KanvazSidePanel !== 'undefined' && KanvazSidePanel.isOpen && KanvazSidePanel.isOpen());
    presentationRestore = { sidePanelWasOpen: sidePanelWasOpen };
    if (sidePanelWasOpen) KanvazSidePanel.close();

    var openMenu = document.getElementById('context-menu');
    if (openMenu && typeof KanvazUI !== 'undefined' && KanvazUI.hideContextMenu) KanvazUI.hideContextMenu();

    /* Closes a real gap the mousedown/contextmenu guards below can't:
       a card selected BEFORE entering Presentation Mode is still a
       valid target for a stray Delete/Ctrl+D/Ctrl+G keypress, which
       route through shortcuts.js, not through cards.js's own mouse
       handlers. Clearing selection on entry means every one of those
       commands has nothing to act on (each already no-ops safely on an
       empty selection, the same convention zoomToSelection's own
       "nothing selected" fallback already relies on) — cheaper and
       more certain than gating every individual keyboard shortcut. */
    if (typeof KanvazCards !== 'undefined' && KanvazCards.deselectAll) KanvazCards.deselectAll();

    presentationCardIds = (typeof KanvazCards !== 'undefined' && KanvazCards.getAllIds) ? KanvazCards.getAllIds() : [];
    presentationIndex = -1;

    document.body.classList.add('presentation-mode-active');
    showPresentationBadge();

    if (typeof KanvazCanvas !== 'undefined' && KanvazCanvas.zoomFit) KanvazCanvas.zoomFit();
    KanvazUI.toast('Presentation Mode on — read-only, ←/→ to step through cards, Esc to exit');
  }

  function exitPresentationMode() {
    if (!presentationModeActive) return;
    presentationModeActive = false;

    var r = presentationRestore || { sidePanelWasOpen: false };
    presentationRestore = null;

    if (r.sidePanelWasOpen && typeof KanvazSidePanel !== 'undefined' && KanvazSidePanel.toggle
        && !(KanvazSidePanel.isOpen && KanvazSidePanel.isOpen())) {
      KanvazSidePanel.toggle();
    }

    document.body.classList.remove('presentation-mode-active');
    hidePresentationBadge();

    KanvazUI.toast('Presentation Mode off');
  }

  /* dir is +1 (next) or -1 (previous), wraps around both ends.
     zoomFit([id]) is the same instant (non-animated) framing every
     other zoom action in this app already uses (recallViewBookmark,
     zoomToSelection) — no new animation system introduced just for
     this. */
  function presentationStep(dir) {
    if (!presentationModeActive || !presentationCardIds.length) return;
    presentationIndex += dir;
    if (presentationIndex < 0) presentationIndex = presentationCardIds.length - 1;
    if (presentationIndex >= presentationCardIds.length) presentationIndex = 0;
    var id = presentationCardIds[presentationIndex];
    if (typeof KanvazCanvas !== 'undefined' && KanvazCanvas.zoomFit) KanvazCanvas.zoomFit([id]);
  }

  function showPresentationBadge() {
    if (document.getElementById('presentation-mode-badge')) return;
    var badge = document.createElement('div');
    badge.id = 'presentation-mode-badge';
    badge.textContent = 'Presentation Mode — ←/→ next/prev card, Esc to exit';
    document.body.appendChild(badge);
  }

  function hidePresentationBadge() {
    var badge = document.getElementById('presentation-mode-badge');
    if (badge) badge.remove();
  }

  /* ── Save status ── */

  function updateSaveStatus(state) {
    var el = document.getElementById('status-save');
    if (!el) return;
    el.className = 'status-item';
    if (state === 'saved') {
      el.textContent = 'Saved';
      el.classList.add('saved');
    } else if (state === 'unsaved') {
      el.textContent = 'Unsaved changes';
      el.classList.add('unsaved');
    } else if (state === 'saving') {
      el.textContent = 'Saving…';
    } else {
      el.textContent = 'Ready';
    }
  }

  /* ── Card count ── */

  function updateCardCount(n) {
    var el = document.getElementById('status-cards');
    if (el) el.textContent = n;
  }

  /* ── Empty state ── */

  function updateEmptyState(isEmpty) {
    var el = document.getElementById('canvas-empty');
    if (!el) return;
    if (isEmpty) {
      el.classList.remove('hidden');
    } else {
      el.classList.add('hidden');
    }
  }

  /* ── Unsaved changes on close (BUG 1 fix) ── */

  function handleCloseRequest() {
    if (!boardDirty) {
      KanvazBridge.clearRecovery();
      KanvazBridge.forceClose();
      return;
    }

    KanvazUI.showDialog(
      'Unsaved changes',
      'You have unsaved changes. Save before closing?',
      [
        {
          label: 'Save',
          cls: 'primary',
          action: function() {
            KanvazBoards.saveBoard(function(ok) {
              if (ok) {
                KanvazBridge.clearRecovery();
                KanvazBridge.forceClose();
              }
              /* if save failed/was cancelled, saveBoard already toasted —
                 leave the window open so the user can try again */
            });
          }
        },
        {
          label: "Don't Save",
          cls: 'danger',
          action: function() {
            KanvazBridge.clearRecovery();
            KanvazBridge.forceClose();
          }
        },
        {
          label: 'Cancel',
          cls: '',
          action: function() {}
        }
      ]
    );
  }

  /* ── Recovery dialog ──
     v8.x polish: this used to show the exact same generic "Kanvaz
     found an unsaved board... do you want to restore it?" regardless
     of what was actually in the recovery file — the user had to click
     Restore just to find out whether it was even the board they
     wanted, with no clean way to back out if it wasn't (Discard, at
     that point, throws away something already loaded). Now reads and
     parses the recovery file FIRST, so the dialog's own message can
     say specifically what it found (board count, total card count,
     how long ago) — an actually informed decision, not a blind one.
     "Restore" below reuses this already-parsed `data` rather than
     reading the file a second time. */
  function showRecoveryDialog() {
    KanvazBridge.readRecovery().then(function(result) {
      if (!result || !result.ok || !result.data) return; /* nothing real to recover — no dialog at all */

      var data;
      try {
        data = JSON.parse(result.data);
      } catch (e) {
        /* Corrupt recovery file — still worth telling the user rather
           than silently discarding it, but there's genuinely nothing
           to restore, so no Restore/Discard choice makes sense either. */
        KanvazUI.toast('Found a backup from a previous session, but it was corrupted and could not be restored.', 'error');
        KanvazBridge.clearRecovery();
        return;
      }
      if (!data || !Array.isArray(data.boards)) {
        KanvazUI.toast('Found a backup from a previous session, but its format wasn\'t recognised.', 'error');
        KanvazBridge.clearRecovery();
        return;
      }

      var boardCount = data.boards.length;
      var cardCount = 0;
      for (var i = 0; i < data.boards.length; i++) {
        if (data.boards[i] && Array.isArray(data.boards[i].cards)) cardCount += data.boards[i].cards.length;
      }
      var whenText = (result.mtimeMs && typeof KanvazBoards.formatRelativeTime === 'function')
        ? KanvazBoards.formatRelativeTime(result.mtimeMs) : 'an earlier session';
      var boardWord = boardCount === 1 ? 'board' : 'boards';
      var cardWord  = cardCount === 1 ? 'card' : 'cards';
      var message = 'Kanvaz found an unsaved board from ' + whenText + ' — ' +
        boardCount + ' ' + boardWord + ', ' + cardCount + ' ' + cardWord + ' total. Restore it?';

      KanvazUI.showDialog(
        'Recover unsaved board?',
        message,
        [
          {
            label: 'Restore',
            cls: 'primary',
            action: function() {
              KanvazBoards.loadFromJSON(data);
              KanvazBridge.clearRecovery();
              KanvazUI.toast('Board restored', 'success');
              setTimeout(function() { KanvazCanvas.zoomFit(); }, 100);
            }
          },
          {
            label: 'Discard',
            cls: 'danger',
            action: function() {
              KanvazBridge.clearRecovery();
            }
          }
        ]
      );
    }).catch(function(e) { console.warn('[Kanvaz] readRecovery IPC failed:', e); });
  }

  /* ── Large file warning ── */

  /* showLargeFileDialog removed — replaced by toast (hard block >500MB)
     and inline Add/Cancel dialog (200-500MB warn tier) in handleDroppedFiles */

  /* ── UI module (inline for Day 1, full ui.js comes Day 5) ── */

  window.KanvazUI = (function() {

    /* Polish fix: .toast is already display:flex;gap:8px in main.css —
       clearly laid out to hold an icon next to the text — but nothing
       ever put an icon there. Toasts were the one recurring piece of
       app chrome that was text-only while everything else (toolbar,
       titlebar, context menu, card badges) uses the same hand-drawn
       stroke-SVG icon language. Small check/✕/! glyphs in that same
       convention (viewBox 14x14, stroke-width 1.5, currentColor so it
       inherits .toast.success/.error/.warning's existing color rules
       with zero extra color logic needed here). */
    var TOAST_ICONS = {
      success: '<svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M2.5 7.5l3 3 6-6.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>',
      /* Redesign v1: was an X shape — now that error toasts also carry a
         real dismiss (×) button (see toast() below), the same glyph
         used for both "this is an error" and "click to close this"
         in one toast was genuinely confusing (reported directly, after
         a screenshot showed both). A circled exclamation reads as
         status, not as another clickable-looking × next to the real
         one. */
      error:   '<svg width="14" height="14" viewBox="0 0 14 14" fill="none"><circle cx="7" cy="7" r="6" stroke="currentColor" stroke-width="1.4"/><path d="M7 4v3.5M7 9.8v.01" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>',
      warning: '<svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M7 1.5l6 10.5H1L7 1.5z" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/><path d="M7 5.5v3M7 10.5v.01" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>'
    };

    function toast(msg, type) {
      var container = document.getElementById('toast-container');
      if (!container) return;

      var el = document.createElement('div');
      el.className = 'toast' + (type ? ' ' + type : '');

      if (type && TOAST_ICONS[type]) {
        var iconEl = document.createElement('span');
        iconEl.style.cssText = 'display:flex;flex-shrink:0;';
        iconEl.innerHTML = TOAST_ICONS[type];
        el.appendChild(iconEl);
      }
      var textEl = document.createElement('span');
      textEl.textContent = msg;
      el.appendChild(textEl);

      function dismiss() {
        el.classList.add('out');
        setTimeout(function() {
          if (el.parentNode) el.parentNode.removeChild(el);
        }, 200);
      }

      /* Direct feedback: an error toast now often carries real technical
         detail (see errors.js's handle()) worth actually reading, or
         screenshotting to report — the old flat 2800ms for every toast
         type made that "vanish before I can catch it." Errors now stay
         up ~4x longer and get an explicit close button so dismissing
         one is a deliberate click, not a race against a timer; plain
         success/info/warning toasts keep the original quick auto-
         dismiss, since those are just brief confirmations. Hovering an
         error toast also pauses its timer — reading takes longer than
         skimming, and a mouse sitting over it is a clear "still looking
         at this" signal. */
      if (type === 'error') {
        var closeBtn = document.createElement('button');
        closeBtn.className = 'toast-close';
        closeBtn.innerHTML = '&times;';
        closeBtn.title = 'Dismiss';
        closeBtn.onclick = dismiss;
        el.appendChild(closeBtn);

        var autoTimer = null;
        var remaining = 12000;
        var startedAt = Date.now();
        function arm(ms) {
          startedAt = Date.now();
          autoTimer = setTimeout(dismiss, ms);
        }
        el.addEventListener('mouseenter', function() {
          if (autoTimer) { clearTimeout(autoTimer); remaining -= (Date.now() - startedAt); }
        });
        el.addEventListener('mouseleave', function() {
          arm(Math.max(1500, remaining));
        });
        arm(remaining);
      } else {
        setTimeout(dismiss, 2800);
      }

      container.appendChild(el);
    }

    function showDialog(title, message, buttons) {
      var overlay = document.getElementById('dialog-overlay');
      var titleEl = document.getElementById('dialog-title');
      var msgEl   = document.getElementById('dialog-message');
      var btnsEl  = document.getElementById('dialog-btns');

      if (!overlay) return;

      titleEl.textContent = title;
      msgEl.textContent   = message;
      btnsEl.innerHTML    = '';

      var primaryBtnEl = null;
      for (var i = 0; i < buttons.length; i++) {
        (function(btn) {
          var el = document.createElement('button');
          el.className = 'btn ' + (btn.cls || '');
          el.textContent = btn.label;
          el.onclick = function() {
            closeDialog();
            if (btn.action) btn.action();
          };
          btnsEl.appendChild(el);
          if (btn.cls === 'primary') primaryBtnEl = el;
        })(buttons[i]);
      }

      overlay.classList.add('visible');

      /* v8.x polish: every dialog through this function used to be
         mouse-only for confirming — Escape-to-cancel already worked
         (shortcuts.js's global handler calls closeDialog()), but
         nothing focused a button, so Enter did nothing at all, unlike
         the near-universal "Enter = default action" convention every
         native OS dialog follows. Native <button> elements already
         respond to Enter when focused — no custom keydown handler
         needed, just actually focus the primary one.
         Deliberately ONLY when a button is explicitly marked
         cls:'primary' — checked every existing showDialog() call site
         in this codebase before adding this, and button ordering is
         NOT a safe proxy for "which one is safe to default to": at
         least one real dialog (ui.js's "Remove plugin?") puts its
         destructive button LAST with no primary marking, which a
         naive "focus the last button" fallback would have silently
         made Enter trigger. No primary means no auto-focus at all —
         same as before this change, not a guess. Deferred one frame
         since the overlay's own display transition can otherwise
         swallow a focus call made in the same tick. */
      if (primaryBtnEl) setTimeout(function() { primaryBtnEl.focus(); }, 0);
    }

    function closeDialog() {
      var overlay = document.getElementById('dialog-overlay');
      if (overlay) overlay.classList.remove('visible');
      var input = document.getElementById('dialog-input');
      if (input) input.style.display = 'none';
    }

    /* Kanvaz-styled stand-in for window.prompt() — same dialog overlay
       as showDialog, with a text field added in. onSubmit gets the
       trimmed value, or is never called if cancelled/empty (matches
       window.prompt()'s null-on-cancel, but callers only ever wanted
       a non-empty result anyway). */
    function showPrompt(title, message, defaultValue, onSubmit) {
      var overlay = document.getElementById('dialog-overlay');
      var titleEl = document.getElementById('dialog-title');
      var msgEl   = document.getElementById('dialog-message');
      var input   = document.getElementById('dialog-input');
      var btnsEl  = document.getElementById('dialog-btns');
      if (!overlay || !input) return;

      titleEl.textContent = title;
      msgEl.textContent   = message || '';
      msgEl.style.display = message ? '' : 'none';
      input.style.display = '';
      input.value = defaultValue || '';
      btnsEl.innerHTML = '';

      function submit() {
        var val = input.value.trim();
        closeDialog();
        msgEl.style.display = '';
        if (val) onSubmit(val);
      }

      input.onkeydown = function(e) {
        if (e.key === 'Enter') { e.preventDefault(); submit(); }
        if (e.key === 'Escape') { e.preventDefault(); closeDialog(); msgEl.style.display = ''; }
      };

      var cancelBtn = document.createElement('button');
      cancelBtn.className = 'btn';
      cancelBtn.textContent = 'Cancel';
      cancelBtn.onclick = function() { closeDialog(); msgEl.style.display = ''; };

      var okBtn = document.createElement('button');
      okBtn.className = 'btn primary';
      okBtn.textContent = 'OK';
      okBtn.onclick = submit;

      btnsEl.appendChild(cancelBtn);
      btnsEl.appendChild(okBtn);

      overlay.classList.add('visible');
      setTimeout(function() { input.focus(); input.select(); }, 0);
    }

    function showCardContextMenu(x, y, card, renameOverride) {
      var menu = document.getElementById('context-menu');
      if (!menu) return;
      menu.innerHTML = '';
      menu.className = 'visible';

      var items = [];

      /* Annotate — only for visual media cards, not notes, audio, color, URL, or file refs */
      if (card.type !== 'note' && card.type !== 'audio' && card.type !== 'color' && card.type !== 'url' && card.type !== 'file' && card.type !== 'text') {
        items.push({
          label: 'Annotate',
          action: function() {
            if (typeof KanvazAnnotate !== 'undefined') KanvazAnnotate.activate(card.id);
          }
        });
      }

      items.push({
          /* From the Layers panel, Rename edits inline in that row
             (renameOverride) instead of jumping to the on-canvas card's
             own rename input — right-clicking a row and choosing Rename
             should rename in place, not pull focus onto the board. */
          label: 'Rename',
          action: renameOverride || function() { KanvazCards.startRenameCard(card.id); }
        },
        {
          label: 'Connections',
          shortcut: 'C',
          action: function() {
            if (typeof KanvazInspector !== 'undefined') KanvazInspector.open(card.id);
          }
        },
        {
          label: 'Properties',
          shortcut: 'E',
          action: function() {
            if (typeof KanvazProperties !== 'undefined') KanvazProperties.open(card.id);
          }
        },
        { sep: true },
        {
          label: 'Duplicate',
          shortcut: 'Ctrl+D',
          action: function() { KanvazCards.duplicateCard(card.id); }
        },
        {
          label: card.pinned ? 'Unpin' : 'Pin',
          shortcut: 'P',
          action: function() { KanvazCards.togglePin(card.id); }
        },
        {
          label: 'Bring to front',
          action: function() { KanvazCards.bringToFront(card.id); }
        },
        {
          label: 'Send to back',
          action: function() { KanvazCards.sendToBack(card.id); }
        }
      );

      /* Group / Ungroup — Group only makes sense with 2+ selected;
         Ungroup only when the right-clicked card is actually part of
         one. Mirrors the Ctrl+G/Ctrl+Shift+G shortcuts exactly. */
      var selIds = KanvazCards.getSelectedIds();
      if (selIds.length > 1) {
        items.push({
          label: 'Group',
          shortcut: 'Ctrl+G',
          action: function() { KanvazCards.groupCards(selIds); }
        });
      }
      if (card.groupId) {
        items.push({
          label: 'Ungroup',
          shortcut: 'Ctrl+Shift+G',
          action: function() { KanvazCards.ungroupCards([card.id]); }
        });
      }
      if (selIds.length > 1) {
        items.push({
          label: 'Export selection as image',
          action: function() { KanvazCards.exportAsImage(selIds); }
        });
      }

      /* Media-only items: flip, reset size */
      if (card.type !== 'note' && card.type !== 'color' && card.type !== 'audio' && card.type !== 'url' && card.type !== 'file' && card.type !== 'text') {
        items.push({ sep: true });
        items.push({
          label: 'Flip horizontal',
          action: function() { KanvazCards.flipCard(card.id, 'h'); }
        });
        items.push({
          label: 'Flip vertical',
          action: function() { KanvazCards.flipCard(card.id, 'v'); }
        });
        items.push({
          label: 'Reset size',
          action: function() { KanvazCards.resetSize(card.id); }
        });
      }

      /* Image-only: cover/contain toggle */
      if (card.type === 'image') {
        items.push({
          label: 'Image fit: ' + ((card.objectFit === 'contain') ? 'Contain' : 'Cover') + ' (click to switch)',
          action: function() { KanvazCards.toggleObjectFit(card.id); }
        });
      }

      /* Video-only: playback speed */
      if (card.type === 'video') {
        items.push({
          label: 'Playback speed',
          submenu: true,
          action: function() { KanvazCards.showSpeedPicker(card.id, x, y); }
        });
      }

      items.push({ sep: true });
      items.push({
        label: 'Opacity',
        submenu: true,
        action: function() { KanvazCards.showOpacityPicker(card.id, x, y); }
      });
      if (card.type !== 'note' && card.type !== 'audio' && card.type !== 'color' && card.type !== 'url' && card.type !== 'file' && card.type !== 'text') {
        items.push({
          label: 'Clear annotations',
          action: function() {
            if (typeof KanvazAnnotate !== 'undefined') KanvazAnnotate.clearAnnotations(card.id);
          }
        });
      }
      if (card.type === 'url') {
        items.push({
          label: 'Open in browser',
          action: function() {
            var raw = (card.url || '').trim();
            if (!raw) return;
            var target = /^https?:\/\//i.test(raw) ? raw : 'https://' + raw;
            KanvazBridge.openExternal(target);
          }
        });
        items.push({
          label: 'Copy link',
          action: function() {
            var raw = (card.url || '').trim();
            if (!raw) return;
            if (navigator.clipboard && navigator.clipboard.writeText) {
              navigator.clipboard.writeText(raw).then(function() {
                KanvazUI.toast('Copied link', 'success');
              }).catch(function() {
                KanvazUI.toast('Could not copy to clipboard', 'error');
              });
            }
          }
        });
      }
      if (card.type === 'file') {
        items.push({
          label: 'Open file',
          action: function() {
            if (!card.path) return;
            KanvazBridge.openPath(card.path).then(function(err) {
              if (err) KanvazUI.toast(err, 'error');
            });
          }
        });
        items.push({
          label: 'Copy path',
          action: function() {
            if (!card.path) return;
            if (navigator.clipboard && navigator.clipboard.writeText) {
              navigator.clipboard.writeText(card.path).then(function() {
                KanvazUI.toast('Copied path', 'success');
              }).catch(function() {
                KanvazUI.toast('Could not copy to clipboard', 'error');
              });
            }
          }
        });
      }
      /* Shared cards across boards (v6.4.0) */
      items.push({ sep: true });
      items.push({
        label: 'Share to board',
        submenu: true,
        action: function() { KanvazCards.showShareToBoardPicker(card.id, x, y); }
      });
      if (card.sharedId) {
        items.push({
          label: 'Unlink from shared card',
          action: function() { KanvazCards.unlinkSharedCard(card.id); }
        });
      }

      items.push({ sep: true });
      items.push({
          label: 'Delete',
          shortcut: 'Del',
          danger: true,
          action: function() { KanvazCards.deleteCard(card.id); }
      });

      for (var i = 0; i < items.length; i++) {
        if (items[i].sep) {
          var sep = document.createElement('div');
          sep.className = 'ctx-sep';
          menu.appendChild(sep);
          continue;
        }
        (function(item) {
          var el = document.createElement('div');
          el.className = 'ctx-item' + (item.danger ? ' danger' : '');
          /* Built via DOM APIs rather than innerHTML — every item.label
             here is a static string today, but building menus from
             textContent/DOM nodes instead of string concatenation means
             a future item sourced from user data (a card name, a tag)
             can't reopen an XSS path just by being added to this list. */
          el.appendChild(document.createTextNode(item.label));
          if (item.shortcut) {
            var shortcutEl = document.createElement('span');
            shortcutEl.className = 'ctx-shortcut';
            shortcutEl.textContent = item.shortcut;
            el.appendChild(shortcutEl);
          }
          el.addEventListener('mousedown', function(ev) {
            ev.preventDefault();
            ev.stopPropagation();
          });
          el.addEventListener('click', function(ev) {
            ev.preventDefault();
            ev.stopPropagation();
            hideContextMenu();
            if (item.action) item.action();
          });
          menu.appendChild(el);
        })(items[i]);
      }

      positionMenuInViewport(menu, x, y);
    }

    function showContextMenu(x, y, type, target) {
      var menu = document.getElementById('context-menu');
      if (!menu) return;
      menu.innerHTML = '';
      menu.className = 'visible';

      var items = [];
      if (type === 'canvas') {
        items = [
          { label: 'New note', shortcut: (function() {
              /* Audit fix: this used to unconditionally show "Dbl-click"
                 as if it always worked — doubleClickCreatesNote defaults
                 to false, so for most users double-clicking the canvas
                 does nothing. Only show the hint when it's actually true. */
              if (typeof KanvazUI_Extended !== 'undefined') {
                var s = KanvazUI_Extended.getSettings();
                if (s && s.doubleClickCreatesNote) return 'Dbl-click';
              }
              return undefined;
            })(), action: function() {
            var pos = KanvazCanvas.screenToWorld(x, y);
            if (typeof KanvazCards !== 'undefined') KanvazCards.createNote(pos.x, pos.y);
          }},
          { label: 'New text', action: function() {
            var pos = KanvazCanvas.screenToWorld(x, y);
            if (typeof KanvazCards !== 'undefined') KanvazCards.createTextCard(pos.x, pos.y);
          }},
          { label: 'New color swatch', action: function() {
            var pos = KanvazCanvas.screenToWorld(x, y);
            if (typeof KanvazCards !== 'undefined') KanvazCards.createColorCard(pos.x, pos.y);
          }},
          { label: 'New URL reference', action: function() {
            var pos = KanvazCanvas.screenToWorld(x, y);
            if (typeof KanvazCards !== 'undefined') KanvazCards.createUrlCard(pos.x, pos.y);
          }},
          { label: 'New file reference', action: function() {
            var pos = KanvazCanvas.screenToWorld(x, y);
            if (typeof KanvazCards !== 'undefined') KanvazCards.createFileRefCard(pos.x, pos.y);
          }},
          { sep: true },
          { label: 'Import .pur file', action: function() { importPurFile(); }},
          { sep: true },
          { label: 'Tidy up board', action: function() {
            if (typeof KanvazCards === 'undefined') return;
            KanvazCards.tidyUp(KanvazCards.getAllIds());
          }},
          { label: 'Export board as image', action: function() {
            if (typeof KanvazCards === 'undefined') return;
            KanvazCards.exportAsImage(KanvazCards.getAllIds());
          }},
          { sep: true },
          { label: 'Reset zoom', shortcut: '0', action: function() { KanvazCanvas.zoomReset(); }},
          { label: 'Fit all cards', shortcut: 'F', action: function() { KanvazCanvas.zoomFit(); }}
        ];

        /* Plugin-registered card types with a create(x,y) — inserted
           right after the built-in "New ..." entries, before the
           Import .pur separator. Without this, registerCardType() had
           no user-facing way to actually instantiate one.

           Audit fix: this whole block used to run with no try/catch.
           This function fires on EVERY right-click on the canvas, and
           by this point menu.innerHTML/.className above have already
           made #context-menu visible — if _getAllCardTypeDefs() ever
           returned something malformed (e.g. an entry missing .label/
           .id from a plugin mid-unregister, or simply not an array),
           the exception would abort showContextMenu() before the render
           loop below ever runs, leaving the menu flagged visible but
           empty/mispositioned — and since nothing here is transient,
           EVERY subsequent right-click would repeat the same throw,
           permanently breaking the entire canvas context menu (built-
           ins included) for the rest of the session. Wrapping it means
           a bad plugin registration degrades to "no plugin items this
           time", never to "no context menu at all". */
        try {
          if (typeof KanvazPluginAPI !== 'undefined' && KanvazPluginAPI._getAllCardTypeDefs) {
            var pluginTypes = (KanvazPluginAPI._getAllCardTypeDefs() || []).filter(function(t) {
              return t && t.hasCreate && typeof t.id === 'string' && typeof t.label === 'string';
            });
            if (pluginTypes.length) {
              var pluginItems = pluginTypes.map(function(t) {
                return { label: 'New ' + t.label, action: function() {
                  var pos = KanvazCanvas.screenToWorld(x, y);
                  if (typeof KanvazCards !== 'undefined') KanvazCards.createPluginCard(t.id, pos.x, pos.y);
                }};
              });
              items = items.slice(0, 4).concat([{ sep: true }], pluginItems, items.slice(4));
            }
          }
        } catch (e) {
          console.error('[Kanvaz Plugin] failed to build plugin context-menu items, showing built-in items only:', e.message);
        }
      }

      /* Direct feedback: "right click on search will give options open,
         fav it with heart svg and more" — a Smart Folder chip/row (the
         search bar's own row of saved-search chips, or its persistent
         twin in the Boards side panel) had no interaction besides a
         left-click-to-run and a small delete "×". `target` here is the
         folder object itself ({id, name, query, favorite}) — nested
         inside KanvazApp's IIFE, so this reaches applySearchFilter/
         searchInput/showSearchBar/renderSmartFolderChips directly via
         closure, same as every other cross-boundary call already made
         from within this same window.KanvazUI IIFE. */
      if (type === 'smartFolder') {
        var folder = target;
        items = [
          { label: 'Open', action: function() {
            if (!searchActive) showSearchBar();
            setTimeout(function() {
              if (searchInput) searchInput.value = folder.query;
              applySearchFilter(folder.query);
            }, 0);
          }},
          { label: folder.favorite ? 'Remove from Favorites' : 'Add to Favorites', action: function() {
            var s = KanvazUI_Extended.getSettings();
            if (!s || !s.smartFolders) return;
            var f = s.smartFolders.filter(function(x) { return x.id === folder.id; })[0];
            if (!f) return;
            f.favorite = !f.favorite;
            KanvazBridge.writeSettings(JSON.stringify(s));
            renderSmartFolderChips();
          }},
          { label: 'Rename', action: function() {
            showPrompt('Rename Smart Folder', 'New name:', folder.name, function(newName) {
              var s = KanvazUI_Extended.getSettings();
              if (!s || !s.smartFolders) return;
              var f = s.smartFolders.filter(function(x) { return x.id === folder.id; })[0];
              if (!f) return;
              f.name = newName;
              KanvazBridge.writeSettings(JSON.stringify(s));
              renderSmartFolderChips();
            });
          }},
          { label: 'Edit query', action: function() {
            showPrompt('Edit Smart Folder query', 'Search query:', folder.query, function(newQuery) {
              var s = KanvazUI_Extended.getSettings();
              if (!s || !s.smartFolders) return;
              var f = s.smartFolders.filter(function(x) { return x.id === folder.id; })[0];
              if (!f) return;
              f.query = newQuery;
              KanvazBridge.writeSettings(JSON.stringify(s));
              renderSmartFolderChips();
            });
          }},
          { sep: true },
          { label: 'Delete', danger: true, action: function() {
            var s = KanvazUI_Extended.getSettings();
            if (!s || !s.smartFolders) return;
            s.smartFolders = s.smartFolders.filter(function(f) { return f.id !== folder.id; });
            KanvazBridge.writeSettings(JSON.stringify(s));
            renderSmartFolderChips();
          }}
        ];
      }

      for (var i = 0; i < items.length; i++) {
        if (items[i].sep) {
          var sep = document.createElement('div');
          sep.className = 'ctx-sep';
          menu.appendChild(sep);
          continue;
        }
        (function(item) {
          var el = document.createElement('div');
          el.className = 'ctx-item' + (item.danger ? ' danger' : '');
          /* Built via DOM APIs rather than innerHTML — every item.label
             here is a static string today, but building menus from
             textContent/DOM nodes instead of string concatenation means
             a future item sourced from user data (a card name, a tag)
             can't reopen an XSS path just by being added to this list. */
          el.appendChild(document.createTextNode(item.label));
          if (item.shortcut) {
            var shortcutEl = document.createElement('span');
            shortcutEl.className = 'ctx-shortcut';
            shortcutEl.textContent = item.shortcut;
            el.appendChild(shortcutEl);
          }
          el.addEventListener('mousedown', function(ev) {
            ev.preventDefault();
            ev.stopPropagation();
          });
          el.addEventListener('click', function(ev) {
            ev.preventDefault();
            ev.stopPropagation();
            hideContextMenu();
            if (item.action) item.action();
          });
          menu.appendChild(el);
        })(items[i]);
      }

      /* Position — keep within viewport */
      positionMenuInViewport(menu, x, y);
    }

    function hideContextMenu() {
      var menu = document.getElementById('context-menu');
      if (menu) {
        menu.className = '';
        menu.style.display = 'none';
      }
    }

    function closeAll() {
      closeDialog();
      hideContextMenu();
      /* Live-audit catch: the Shortcuts overlay (`?`, ui.js's
         showShortcuts()) was never included here — Escape is this
         app's universal "close whatever's open" key everywhere else,
         but pressing it with the Shortcuts overlay open did nothing to
         the overlay while still running the rest of this function's
         side effects (KanvazCards.deselectAll(), called by shortcuts.js
         right after closeAll() on Escape) — confirmed live: opened the
         overlay, dispatched a real Escape keydown, overlay was still
         there afterward. Direct DOM removal matches showShortcuts()'s
         own close path (its Close button and backdrop-click handler
         both do exactly this) rather than calling back into ui.js for
         what's a one-line, self-contained fix. */
      var shortcutsOverlay = document.getElementById('shortcuts-overlay');
      if (shortcutsOverlay && shortcutsOverlay.parentNode) shortcutsOverlay.parentNode.removeChild(shortcutsOverlay);
      if (typeof KanvazAnnotate !== 'undefined') KanvazAnnotate.deactivate();
      if (typeof KanvazProperties !== 'undefined') KanvazProperties.close();
      /* Escape closes the side panel's content pane regardless of which
         section was showing — KanvazProperties.close() above only acts
         when Properties specifically was the active section. */
      if (typeof KanvazSidePanel !== 'undefined') KanvazSidePanel.close();
      if (typeof KanvazCanvas !== 'undefined' && KanvazCanvas.isMarqueeModeOn && KanvazCanvas.isMarqueeModeOn()) {
        KanvazCanvas.setMarqueeMode(false);
      }
    }

    var chromeAutoHideOn   = false;
    var chromeHoverZone    = null;
    var chromeRevealTimer  = null;

    /* Audit fix: the revealed top bar doubles as a real OS drag region
       (-webkit-app-region: drag on #moodlock-hover-zone / #titlebar in
       main.css), so grabbing it to move the window is the main reason
       to reveal it at all. But once an OS-native window drag starts,
       the OS owns the mouse — this renderer stops getting reliable
       mouseenter/mouseleave/mousemove events on the dragged element
       until the drag ends. The 700ms auto-hide timer below doesn't
       know a drag is in progress, so it could (and did) fire mid-drag,
       yanking #top-chrome (the actual drag region) out from under the
       user's cursor — chrome vanishes almost immediately and the
       window stops moving, since there's no drag region left to drag.
       chromeDragGuard suspends the hide timer for the whole mousedown-
       to-mouseup gesture on the revealed chrome, regardless of what
       mouse events do or don't fire while the OS has control. */
    var chromeDragGuard     = false;

    /* v6.0.0: this used to OR in Top Mode's own moodlockOn flag too —
       Top Mode is gone (see CHANGELOG), so the persistent Auto-hide
       toolbar setting is the only thing driving chrome visibility now. */
    function chromeAutoHideActive() {
      return chromeAutoHideOn;
    }

    function chromeShow() {
      if (chromeRevealTimer) { clearTimeout(chromeRevealTimer); chromeRevealTimer = null; }
      var app = document.getElementById('app');
      if (app) app.classList.add('moodlock-reveal');
    }

    function chromeScheduleHide() {
      if (chromeDragGuard) return; /* mid window-drag — never hide the drag region out from under the user */
      if (chromeRevealTimer) clearTimeout(chromeRevealTimer);
      /* Short grace delay so moving from the hover zone straight into
         the toolbar/titlebar doesn't immediately hide it again. */
      chromeRevealTimer = setTimeout(function() {
        var app = document.getElementById('app');
        if (app) app.classList.remove('moodlock-reveal');
        chromeRevealTimer = null;
      }, 700);
    }

    function chromeDragStart() {
      chromeDragGuard = true;
      chromeShow();
    }

    function chromeDragEnd() {
      if (!chromeDragGuard) return;
      chromeDragGuard = false;
      chromeScheduleHide();
    }

    /* Coordinate-based fallback for the hover-reveal strip — see the
       call site's own comment on why this exists alongside (not
       instead of) chromeHoverZone's mouseenter/mouseleave pair.
       Deliberately has a dead zone (4px–80px) where it does nothing:
       that's roughly where the revealed #top-chrome itself lives once
       shown, and topChrome already has its own correct mouseenter/
       mouseleave pair for "still interacting with the revealed
       toolbar" — this fallback firing chromeScheduleHide() in that
       range would fight that logic and hide the toolbar out from under
       an active click. Below the dead zone it schedules a hide exactly
       like leaving the hover zone normally would, so a missed
       mouseenter earlier can't leave the chrome stuck open forever
       with nothing left to close it. */
    function chromeEdgeMouseMove(e) {
      /* clientX > 44 matches the hover strip's own real horizontal
         extent (see #moodlock-hover-zone's left:44px in main.css) —
         it starts after the side panel rail on purpose, so hovering
         the rail's own top icon doesn't also spuriously reveal the
         toolbar. */
      if (e.clientY <= 4 && e.clientX > 44) chromeShow();
      else if (e.clientY > 80) chromeScheduleHide();
    }

    /* Turns the hover-reveal chrome mechanic on/off at the DOM level.
       Called whenever chromeAutoHideOn changes — the wasActive/isActive
       comparison is a leftover of when this also had to reconcile
       against Top Mode's own separate flag (now removed, see
       CHANGELOG's v6.0.0 entry); harmless to keep as a plain no-op
       guard against redundant setup/teardown calls. */
    function syncChromeAutoHide(wasActive) {
      var app = document.getElementById('app');
      if (!app) return;
      var isActive = chromeAutoHideActive();
      if (isActive === wasActive) return;

      var topChrome = document.getElementById('top-chrome');

      if (isActive) {
        app.classList.add('moodlock-active');
        chromeHoverZone = document.createElement('div');
        chromeHoverZone.id = 'moodlock-hover-zone';
        chromeHoverZone.addEventListener('mouseenter', chromeShow);
        chromeHoverZone.addEventListener('mouseleave', chromeScheduleHide);
        chromeHoverZone.addEventListener('mousedown', chromeDragStart);
        document.body.appendChild(chromeHoverZone);
        if (topChrome) {
          topChrome.addEventListener('mouseenter', chromeShow);
          topChrome.addEventListener('mouseleave', chromeScheduleHide);
          topChrome.addEventListener('mousedown', chromeDragStart);
        }
        /* window-level, capture phase — an OS-native app-region drag can
           swallow the mouseup on whatever element it started on, so this
           is listened for globally rather than only on chromeHoverZone/
           topChrome to guarantee chromeDragGuard always gets cleared.
           Audit fix: mouseup alone isn't enough — if the window loses
           focus mid-drag (a UAC/native dialog steals focus, an OS
           snap-assist overlay appears, an Alt+Tab lands while the button
           is still down), the terminating mouseup may never be delivered
           to this window's listeners at all, leaving chromeDragGuard
           stuck true forever and permanently disabling auto-hide for
           the rest of the session. blur is the reliable backstop. */
        window.addEventListener('mouseup', chromeDragEnd, true);
        window.addEventListener('blur', chromeDragEnd);
        /* Robustness fix (reported: "hover the top edge doesn't reveal"
           — not reproduced via CDP-simulated input even across a full
           reveal/hide/reveal cycle, but relying ONLY on mouseenter/
           mouseleave on a 16px-tall element that also carries
           -webkit-app-region:drag is fragile in real use: a fast mouse
           movement can cross a thin target without ever firing its own
           mouseenter (the browser only guarantees mousemove sampling,
           not that every pixel-row boundary produces an enter/leave
           pair), and a real OS drag-region's hit-testing is a known
           rough edge for hover events on Windows specifically. This
           window-level mousemove is a coordinate-based fallback that
           doesn't depend on that one enter event ever firing — it
           reveals whenever the cursor is anywhere near the top edge,
           regardless of whether the hover zone's own listener caught
           it. Cheap: one branch per mousemove, only registered while
           auto-hide is actually on. */
        window.addEventListener('mousemove', chromeEdgeMouseMove);
        KanvazBridge.setMoodLockSize(true);
      } else {
        app.classList.remove('moodlock-active', 'moodlock-reveal');
        if (chromeHoverZone) { chromeHoverZone.remove(); chromeHoverZone = null; }
        if (chromeRevealTimer) { clearTimeout(chromeRevealTimer); chromeRevealTimer = null; }
        chromeDragGuard = false;
        window.removeEventListener('mouseup', chromeDragEnd, true);
        window.removeEventListener('blur', chromeDragEnd);
        window.removeEventListener('mousemove', chromeEdgeMouseMove);
        if (topChrome) {
          topChrome.removeEventListener('mouseenter', chromeShow);
          topChrome.removeEventListener('mouseleave', chromeScheduleHide);
          topChrome.removeEventListener('mousedown', chromeDragStart);
        }
        KanvazBridge.setMoodLockSize(false);
      }
    }

    var tabHeld = false;
    var windowDragActive = false;
    var windowDragLastX = 0;
    var windowDragLastY = 0;

    /* Tab+MMB whole-window drag — an alternative way to move the
       window from anywhere on screen, not just a titlebar strip.
       Gated behind holding Tab because plain middle-mouse-drag is
       already used for canvas panning in both Board and Map View;
       without the Tab gate this would collide with that. Tab used to
       also toggle Top Mode on the same keydown (removed in v6.0.0 —
       see CHANGELOG), which made holding it for this drag a known,
       accepted side-effect collision; Tab is unclaimed by anything else
       now, so that tradeoff no longer applies. */
    window.addEventListener('keydown', function(e) {
      if (e.key === 'Tab') tabHeld = true;
    }, true);
    window.addEventListener('keyup', function(e) {
      if (e.key === 'Tab') tabHeld = false;
    }, true);
    window.addEventListener('blur', function() { tabHeld = false; });

    function initTabMmbWindowDrag() {
      window.addEventListener('mousedown', function(e) {
        if (e.button !== 1 || !tabHeld) return;
        e.preventDefault();
        e.stopPropagation();
        windowDragActive = true;
        windowDragLastX = e.screenX;
        windowDragLastY = e.screenY;
      }, true); /* capture phase — intercepts before canvas/map pan handlers */

      window.addEventListener('mousemove', function(e) {
        if (!windowDragActive) return;
        var dx = e.screenX - windowDragLastX;
        var dy = e.screenY - windowDragLastY;
        windowDragLastX = e.screenX;
        windowDragLastY = e.screenY;
        if (dx || dy) KanvazBridge.dragWindowBy(dx, dy);
      }, true);

      window.addEventListener('mouseup', function(e) {
        if (e.button === 1) windowDragActive = false;
      }, true);
    }

    initTabMmbWindowDrag();

    /* Called by ui.js when the persistent "Auto-hide toolbar" setting
       changes. Never touches the statusbar — it's a standing
       preference, not a presentation mode. */
    function setChromeAutoHide(enabled) {
      var app = document.getElementById('app');
      if (!app) return;
      var wasActive = chromeAutoHideActive();
      chromeAutoHideOn = !!enabled;
      syncChromeAutoHide(wasActive);
    }

    function showShortcuts() {
      KanvazUI_Extended.showShortcuts();
    }

    /* Close context menu on outside click */
    document.addEventListener('mousedown', function(e) {
      var menu = document.getElementById('context-menu');
      if (menu && !menu.contains(e.target)) {
        hideContextMenu();
      }
    });

    return {
      toast:               toast,
      showDialog:          showDialog,
      showPrompt:          showPrompt,
      closeDialog:         closeDialog,
      showCardContextMenu: showCardContextMenu,
      showContextMenu:     showContextMenu,
      hideContextMenu:     hideContextMenu,
      setChromeAutoHide:   setChromeAutoHide,
      showSearchBar:       showSearchBar,
      hideSearchBar:       hideSearchBar,
      closeAll:            closeAll,
      showAbout:           function() { KanvazUI_Extended.showAbout(); },
      showShortcuts:       showShortcuts
    };

  })();

  /* Boot on DOMContentLoaded */
  document.addEventListener('DOMContentLoaded', function() {
    init();
  });

  /* ── PureRef import ── */

  /* Bug fix: the toolbar's "Import" button used to call importPurFile()
     — PureRef-only — even though nothing about the button (a generic
     tray-and-arrow icon, the plain label "Import") signals that
     narrowing, and Kanvaz already supports importing every media type
     placeDroppedFiles() below handles (images/GIF/video/audio/3D
     models). Direct feedback: "the import button is made for all kinds
     of import regardless of format... via import button everything
     which is supported in kanvaz will be imported." .pur import keeps
     its own explicit "Import .pur file" entry in the canvas right-click
     menu (commands.js/context menu, unchanged) for anyone who
     specifically wants that. Reuses the exact same
     KanvazMedia.loadFromFile → KanvazCards.createFromMedia pipeline a
     real drag-and-drop already goes through — one path for "add these
     files to the board," not a second copy. */
  function importMediaFiles() {
    KanvazBridge.importMediaDialog().then(function(paths) {
      if (!paths || !paths.length) return;
      var files = paths.map(function(p) {
        var sep = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'));
        return { path: p, name: sep === -1 ? p : p.slice(sep + 1) };
      });
      var vp = (typeof KanvazCanvas !== 'undefined') ? KanvazCanvas.getViewport() : null;
      var worldPos = vp
        ? { x: (-vp.tx / vp.scale) + 200, y: (-vp.ty / vp.scale) + 200 }
        : { x: 200, y: 200 };
      placeDroppedFiles(files, worldPos);
    }).catch(function(e) {
      console.warn('[Kanvaz] importMediaDialog IPC failed:', e);
      KanvazUI.toast('Could not open the file dialog', 'error');
    });
  }

  function importPurFile() {
    KanvazBridge.openPurDialog().then(function(purPath) {
      if (!purPath) return;
      KanvazUI.toast('Importing PureRef file…', 'success');
      KanvazBridge.importPur(purPath).then(function(result) {
        if (!result.ok) {
          KanvazErrors.handle('LOAD_FAIL', result.error);
          return;
        }
        if (result.count === 0) {
          KanvazUI.toast('No images found in .pur file', 'error');
          return;
        }
        placePurImages(result.images);
      }).catch(function(e) {
        KanvazErrors.handle('LOAD_FAIL', e);
      });
    }).catch(function(e) {
      /* Audit fix: the outer openPurDialog() chain had no .catch at
         all — every other promise chain in this file at least logs on
         a transport-level rejection; this one was a genuine unhandled
         rejection with zero logging and zero user feedback if the
         dialog IPC call itself failed. */
      console.warn('[Kanvaz] openPurDialog IPC failed:', e);
      KanvazUI.toast('Could not open the file dialog', 'error');
    });
  }

  function importPurFromPath(purPath) {
    KanvazUI.toast('Importing PureRef file…', 'success');
    KanvazBridge.importPur(purPath).then(function(result) {
      if (!result.ok) {
        KanvazErrors.handle('LOAD_FAIL', result.error);
        return;
      }
      if (result.count === 0) {
        KanvazUI.toast('No images found in .pur file', 'error');
        return;
      }
      placePurImages(result.images);
    }).catch(function(e) {
      KanvazErrors.handle('LOAD_FAIL', e);
    });
  }

  function placePurImages(images) {
    var placed = 0;
    var total = images.length;

    for (var i = 0; i < total; i++) {
      (function(img) {
        /* Measure natural size from the dataUrl, then create card */
        KanvazMedia.getNaturalSize(img.dataUrl, function(natW, natH) {
          /* Apply PureRef scale */
          var w = Math.round(Math.abs(natW * (img.scaleX || 1)));
          var h = Math.round(Math.abs(natH * (img.scaleY || 1)));

          /* Cap to reasonable size */
          var sz = KanvazMedia.capSize(w, h);

          var mediaResult = {
            ok: true,
            dataUrl: img.dataUrl,
            name: img.name || 'pur-image',
            type: 'image',
            originalPath: null,
            sizeMB: 0,
            naturalW: natW,
            naturalH: natH,
            displayW: sz.w,
            displayH: sz.h
          };

          KanvazCards.createFromMedia(mediaResult, { x: img.x, y: img.y });
          placed++;

          if (placed === total) {
            KanvazApp.markDirty();
            KanvazUI.toast(total + ' image' + (total > 1 ? 's' : '') + ' imported from PureRef', 'success');
            setTimeout(function() { KanvazCanvas.zoomFit(); }, 200);
          }
        });
      })(images[i]);
    }
  }

  /* BUG 6 fix: push the current filename + dirty state to the OS-level
     window title (taskbar, Alt-Tab preview). The #titlebar-title element
     below only updates Kanvaz's own custom in-app titlebar — it never
     touched the real window title, which stayed hardcoded to 'Kanvaz'. */
  function updateWindowTitle() {
    var name = currentBoardPath
      ? currentBoardPath.split(/[\\/]/).pop()
      : 'Untitled';
    if (typeof KanvazBridge !== 'undefined' && KanvazBridge.setWindowTitle) {
      KanvazBridge.setWindowTitle('Kanvaz — ' + name + (boardDirty ? ' *' : ''));
    }
  }

  return {
    toggleAlwaysOnTop: toggleAlwaysOnTop,
    syncAlwaysOnTop:   syncAlwaysOnTop,
    toggleTopMode:     toggleTopMode,
    isTopModeActive:   isTopModeActive,
    noteSettingChangedDuringTopMode: noteSettingChangedDuringTopMode,
    togglePresentationMode:  togglePresentationMode,
    isPresentationModeActive: isPresentationModeActive,
    presentationStep:  presentationStep,
    /* Exposed for the side panel's "Quick drop" zone (boards.js) —
       exact same file-drop handling path the main canvas drop target
       already uses, just reached from a different DOM element. */
    handleDroppedFiles: handleDroppedFiles,
    updateSaveStatus:  updateSaveStatus,
    updateCardCount:   updateCardCount,
    updateEmptyState:  updateEmptyState,
    getCurrentPath:    function() { return currentBoardPath; },
    setCurrentPath:    function(p) {
      if (p === currentBoardPath) return;
      currentBoardPath = p;
      /* boards.js's updateTitle() is the single authoritative writer of
         #titlebar-title (also handles the unsaved-changes dot) — call
         through to it instead of duplicating the DOM write here. */
      if (typeof KanvazBoards !== 'undefined' && KanvazBoards.updateTitle) KanvazBoards.updateTitle();
      updateWindowTitle();
    },
    markDirty:         function() {
      /* No-op once already dirty — markDirty() is called from ~30 sites
         across the app (most mutations), so skipping the DOM/title
         refresh when nothing actually changed avoids needless repeated
         work without changing behavior for the "just became dirty" case. */
      if (boardDirty) return;
      boardDirty = true;
      updateSaveStatus('unsaved');
      if (typeof KanvazBoards !== 'undefined' && KanvazBoards.updateTitle) KanvazBoards.updateTitle();
      updateWindowTitle();
    },
    markClean:         function() {
      if (!boardDirty) return;
      boardDirty = false;
      updateSaveStatus('saved');
      if (typeof KanvazBoards !== 'undefined' && KanvazBoards.updateTitle) KanvazBoards.updateTitle();
      updateWindowTitle();
    },
    isDirty:           function() { return boardDirty; },
    importPurFile:     importPurFile,
    importPurFromPath: importPurFromPath
  };

})();
