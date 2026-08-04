/* app.js — renderer entry point */

var KanvazApp = (function() {

  var alwaysOnTop = false;
  var currentBoardPath = null;
  var boardDirty = false;

  /* ── Boot ── */

  function init() {
    KanvazErrors.init();

    try {
      var container = document.getElementById('canvas-container');
      var world     = document.getElementById('canvas-world');
      var grid      = document.getElementById('canvas-grid');

      KanvazCanvas.init(container, world, grid);
      KanvazCards.init(world);
      KanvazHistory.init();
      KanvazShortcuts.init();
      KanvazBoards.init();
      if (typeof KanvazMapView !== 'undefined') KanvazMapView.init();
      KanvazUI_Extended.init();

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

      /* Auto-updater — main process checks/downloads in the background;
         we just report the two moments that matter to the user. */
      KanvazBridge.on('update-available', function(info) {
        KanvazUI.toast('Update' + (info && info.version ? ' v' + info.version : '') + ' found — downloading…');
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
    on('btn-export',        function() { KanvazBoards.saveBoardAs(); });
    on('btn-always-on-top', function() { toggleAlwaysOnTop(); });
    on('btn-minimize',      function() { KanvazBridge.minimize(); });
    on('btn-maximize',      function() { KanvazBridge.maximize(); });
    on('btn-close',         function() { KanvazBridge.close(); });

    /* Toolbar */
    on('btn-new',       function() { KanvazBoards.newBoard(); });
    on('btn-open',      function() { KanvazBoards.openBoard(); });
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
    on('btn-settings',  function() { KanvazUI.showSettings(); });
    on('btn-about',     function() { KanvazUI.showAbout(); });
    on('btn-shortcuts', function() { KanvazUI.showShortcuts(); });

    /* Maximize/restore icon toggle */
    var iconMax = document.getElementById('icon-maximize');
    var iconRes = document.getElementById('icon-restore');
    var btnMax  = document.getElementById('btn-maximize');

    function setMaximizedIcon(isMax) {
      if (!iconMax || !iconRes) return;
      iconMax.style.display = isMax ? 'none' : '';
      iconRes.style.display = isMax ? '' : 'none';
      if (btnMax) btnMax.title = isMax ? 'Restore' : 'Maximize';
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
        KanvazMedia.loadFromFile(file, function(result, err) {
          if (err) {
            if (err === 'FILE_TOO_LARGE') {
              KanvazUI.toast('File too large for Kanvaz (max 500MB). Use a smaller preview or proxy file.', 'error');
            } else if (err === 'FILE_TYPE_INVALID') {
              KanvazUI.toast('"' + file.name + '" is not supported. Supported: JPG, PNG, GIF, BMP, WEBP, MP4, WEBM, MOV, MP3, WAV, OGG, M4A', 'error');
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
      'border-radius:8px', 'box-shadow:0 8px 32px var(--color-shadow)',
      'z-index:10000',
      'animation:search-bar-in 0.2s ease-out'
    ].join(';');

    var icon = document.createElement('span');
    icon.style.cssText = 'color:var(--color-text-3);font-size:14px;flex-shrink:0;';
    icon.textContent = '\uD83D\uDD0D';

    searchInput = document.createElement('input');
    searchInput.type = 'text';
    searchInput.placeholder = 'Search by name, type, or tag…';
    searchInput.style.cssText = [
      'flex:1', 'background:transparent', 'border:none', 'outline:none',
      'color:var(--color-text)', 'font-family:var(--font-ui)', 'font-size:13px'
    ].join(';');

    var closeBtn = document.createElement('span');
    closeBtn.style.cssText = 'cursor:pointer;color:var(--color-text-3);font-size:16px;flex-shrink:0;';
    closeBtn.textContent = '\u00D7';
    closeBtn.addEventListener('click', function() { hideSearchBar(); });

    searchInput.addEventListener('input', function() { applySearchFilter(searchInput.value); });
    searchInput.addEventListener('keydown', function(e) {
      e.stopPropagation();
      if (e.key === 'Escape') hideSearchBar();
    });

    searchBar.appendChild(icon);
    searchBar.appendChild(searchInput);
    searchBar.appendChild(closeBtn);
    document.body.appendChild(searchBar);

    searchInput.focus();
  }

  function focusSearchBar() {
    if (searchInput) searchInput.focus();
  }

  function hideSearchBar() {
    searchActive = false;
    if (searchBar) { searchBar.remove(); searchBar = null; searchInput = null; }
    clearSearchFilter();
  }

  function applySearchFilter(query) {
    var q = query.trim().toLowerCase();
    var allCards = KanvazCards.getAll();
    for (var id in allCards) {
      var card = allCards[id];
      var el = document.getElementById(id);
      if (!el) continue;

      if (!q) {
        el.style.opacity = '';
        el.style.filter = '';
        continue;
      }

      var nameMatch = (card.name || '').toLowerCase().indexOf(q) !== -1;
      var typeMatch = (card.type || '').toLowerCase().indexOf(q) !== -1;
      var tagMatch = false;
      if (card.tags && card.tags.length) {
        for (var t = 0; t < card.tags.length; t++) {
          if (card.tags[t].toLowerCase().indexOf(q) !== -1) { tagMatch = true; break; }
        }
      }

      if (nameMatch || typeMatch || tagMatch) {
        el.style.opacity = '';
        el.style.filter = '';
      } else {
        el.style.opacity = '0.12';
        el.style.filter = 'grayscale(1)';
      }
    }
  }

  function clearSearchFilter() {
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

  function toggleAlwaysOnTop() {
    alwaysOnTop = !alwaysOnTop;
    KanvazBridge.setAlwaysOnTop(alwaysOnTop);
    var btn = document.getElementById('btn-always-on-top');
    if (btn) {
      btn.style.color = alwaysOnTop ? 'var(--color-accent)' : '';
    }
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

  /* Silent variant for Top Mode's auto-on-top feature — updates the
     live window state and toolbar button, but doesn't toast or
     persist to settings, since this is a temporary side-effect of
     Top Mode, not the user's own explicit, durable preference. */
  function setAlwaysOnTopSilent(flag) {
    alwaysOnTop = flag;
    KanvazBridge.setAlwaysOnTop(flag);
    var btn = document.getElementById('btn-always-on-top');
    if (btn) btn.style.color = flag ? 'var(--color-accent)' : '';
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

  /* ── Recovery dialog ── */

  function showRecoveryDialog() {
    KanvazUI.showDialog(
      'Recover unsaved board?',
      'Kanvaz found an unsaved board from a previous session. Do you want to restore it?',
      [
        {
          label: 'Restore',
          cls: 'primary',
          action: function() {
            KanvazBridge.readRecovery().then(function(result) {
              if (!result || !result.ok || !result.data) {
                KanvazUI.toast('Backup file not found — nothing to restore.', 'error');
                return;
              }

              var data;
              try {
                data = JSON.parse(result.data);
              } catch (e) {
                KanvazUI.toast('Backup file is corrupted and could not be restored.', 'error');
                return;
              }

              if (!data || !Array.isArray(data.boards)) {
                KanvazUI.toast('Backup file format not recognised.', 'error');
                return;
              }

              KanvazBoards.loadFromJSON(data);
              KanvazBridge.clearRecovery();
              KanvazUI.toast('Board restored', 'success');
              setTimeout(function() { KanvazCanvas.zoomFit(); }, 100);
            }).catch(function(e) { console.warn('[Kanvaz] readRecovery IPC failed:', e); });
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
  }

  /* ── Large file warning ── */

  /* showLargeFileDialog removed — replaced by toast (hard block >500MB)
     and inline Add/Cancel dialog (200-500MB warn tier) in handleDroppedFiles */

  /* ── UI module (inline for Day 1, full ui.js comes Day 5) ── */

  window.KanvazUI = (function() {

    function toast(msg, type) {
      var container = document.getElementById('toast-container');
      if (!container) return;

      var el = document.createElement('div');
      el.className = 'toast' + (type ? ' ' + type : '');
      el.textContent = msg;
      container.appendChild(el);

      setTimeout(function() {
        el.classList.add('out');
        setTimeout(function() {
          if (el.parentNode) el.parentNode.removeChild(el);
        }, 200);
      }, 2800);
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
        })(buttons[i]);
      }

      overlay.classList.add('visible');
    }

    function closeDialog() {
      var overlay = document.getElementById('dialog-overlay');
      if (overlay) overlay.classList.remove('visible');
    }

    function showCardContextMenu(x, y, card) {
      var menu = document.getElementById('context-menu');
      if (!menu) return;
      menu.innerHTML = '';
      menu.className = 'visible';

      var items = [];

      /* Annotate — only for visual media cards, not notes, audio, color, URL, or file refs */
      if (card.type !== 'note' && card.type !== 'audio' && card.type !== 'color' && card.type !== 'url' && card.type !== 'file') {
        items.push({
          label: 'Annotate',
          action: function() {
            if (typeof KanvazAnnotate !== 'undefined') KanvazAnnotate.activate(card.id);
          }
        });
      }

      items.push({
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

      /* Media-only items: flip, reset size */
      if (card.type !== 'note' && card.type !== 'color' && card.type !== 'audio' && card.type !== 'url' && card.type !== 'file') {
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
      if (card.type !== 'note' && card.type !== 'audio' && card.type !== 'color' && card.type !== 'url' && card.type !== 'file') {
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
      if (typeof KanvazAnnotate !== 'undefined') KanvazAnnotate.deactivate();
      if (typeof KanvazProperties !== 'undefined') KanvazProperties.close();
      /* Exit Top Mode on Escape */
      var app = document.getElementById('app');
      if (app && app.dataset.moodlock === '1') toggleMoodLock();
    }

    var moodlockOn         = false;
    var chromeAutoHideOn   = false;
    var chromeHoverZone    = null;
    var chromeRevealTimer  = null;
    var moodlockBadge      = null;

    function chromeAutoHideActive() {
      return moodlockOn || chromeAutoHideOn;
    }

    function chromeShow() {
      if (chromeRevealTimer) { clearTimeout(chromeRevealTimer); chromeRevealTimer = null; }
      var app = document.getElementById('app');
      if (app) app.classList.add('moodlock-reveal');
    }

    function chromeScheduleHide() {
      if (chromeRevealTimer) clearTimeout(chromeRevealTimer);
      /* Short grace delay so moving from the hover zone straight into
         the toolbar/titlebar doesn't immediately hide it again. */
      chromeRevealTimer = setTimeout(function() {
        var app = document.getElementById('app');
        if (app) app.classList.remove('moodlock-reveal');
        chromeRevealTimer = null;
      }, 700);
    }

    /* Top Mode's reveal is intentionally more minimal than the general
       Auto-hide toolbar setting's reveal: only app name + project title
       + window controls (minimize/maximize/close) — not the full
       toolbar/tabs, and not export/always-on-top either. The Auto-hide
       *setting* (no Top Mode) still reveals the full toolbar, since
       that one's a standing convenience preference, not a presentation
       mode. Driven by a separate class so the two don't have to share
       exactly the same visual treatment. */
    function syncMinimalClass() {
      var app = document.getElementById('app');
      if (!app) return;
      if (moodlockOn) app.classList.add('moodlock-minimal');
      else app.classList.remove('moodlock-minimal');
    }

    /* Small persistent reminder that Top Mode is active — independent
       of the hover-reveal state, since the whole point of Top Mode is
       that the chrome is normally hidden; without this there was no
       way to tell it was on (or how to get out) without already
       knowing the shortcut. */
    function syncMoodlockBadge() {
      if (moodlockOn && !moodlockBadge) {
        moodlockBadge = document.createElement('div');
        moodlockBadge.id = 'moodlock-badge';
        moodlockBadge.textContent = 'Top Mode — Tab to exit';
        document.body.appendChild(moodlockBadge);
      } else if (!moodlockOn && moodlockBadge) {
        moodlockBadge.remove();
        moodlockBadge = null;
      }
    }

    /* Turns the hover-reveal chrome mechanic on/off at the DOM level.
       Called whenever moodlockOn or chromeAutoHideOn changes — only
       actually enables/disables when the *combined* state flips, so
       toggling one off while the other is still on doesn't tear down
       the shared hover machinery out from under it. */
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
        document.body.appendChild(chromeHoverZone);
        if (topChrome) {
          topChrome.addEventListener('mouseenter', chromeShow);
          topChrome.addEventListener('mouseleave', chromeScheduleHide);
        }
        KanvazBridge.setMoodLockSize(true);
      } else {
        app.classList.remove('moodlock-active', 'moodlock-reveal');
        if (chromeHoverZone) { chromeHoverZone.remove(); chromeHoverZone = null; }
        if (chromeRevealTimer) { clearTimeout(chromeRevealTimer); chromeRevealTimer = null; }
        if (topChrome) {
          topChrome.removeEventListener('mouseenter', chromeShow);
          topChrome.removeEventListener('mouseleave', chromeScheduleHide);
        }
        KanvazBridge.setMoodLockSize(false);
      }
    }

    var moodlockWasAlwaysOnTop = false;

    var tabHeld = false;
    var windowDragActive = false;
    var windowDragLastX = 0;
    var windowDragLastY = 0;

    /* Tab+MMB whole-window drag — an alternative way to move the
       window from anywhere on screen, not just a titlebar strip.
       Gated behind holding Tab because plain middle-mouse-drag is
       already used for canvas panning in both Board and Map View;
       without the Tab gate this would collide with that.

       Known tradeoff, not hidden: Tab already toggles Top Mode on
       keydown (see toggleMoodLock). Holding Tab to start this drag
       will also flip Top Mode as a side-effect of that same keydown,
       since the two features share the same key. Living with this
       for now since debouncing "tap vs hold" reliably would need
       deferring the Top Mode toggle to keyup and add real latency to
       what's currently an instant, well-liked toggle ("top works nice
       fr"). Revisit if this combination proves annoying in practice. */
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

    function toggleMoodLock() {
      var app = document.getElementById('app');
      if (!app) return;
      var wasActive = chromeAutoHideActive();
      var statusbar = document.getElementById('statusbar');

      moodlockOn = !moodlockOn;
      app.dataset.moodlock = moodlockOn ? '1' : '0';
      if (statusbar) statusbar.style.display = moodlockOn ? 'none' : '';
      syncChromeAutoHide(wasActive);
      syncMinimalClass();
      syncMoodlockBadge();

      /* Auto always-on-top, if the setting is enabled — Top Mode is a
         "float this over everything else" presentation mode, so it's
         a natural pairing. Remembers whether always-on-top was already
         on beforehand so exiting Top Mode restores that instead of
         just forcing it off (doesn't fight a user's own independent
         Always-on-Top preference if they'd already turned it on). */
      var topModeAutoOnTop = false;
      if (typeof KanvazUI_Extended !== 'undefined') {
        var tmSettings = KanvazUI_Extended.getSettings();
        topModeAutoOnTop = !!(tmSettings && tmSettings.topModeAutoOnTop);
      }
      if (topModeAutoOnTop) {
        if (moodlockOn) {
          moodlockWasAlwaysOnTop = alwaysOnTop;
          if (!alwaysOnTop) setAlwaysOnTopSilent(true);
        } else if (!moodlockWasAlwaysOnTop && alwaysOnTop) {
          setAlwaysOnTopSilent(false);
        }
      }

      KanvazUI.toast(moodlockOn
        ? 'Top Mode — drag the top bar to move window, hover to reveal toolbar, Esc or Tab to exit'
        : 'Top Mode off');
    }

    /* Called by ui.js when the persistent "Auto-hide toolbar" setting
       changes. Unlike Top Mode, this never touches the statusbar —
       it's a standing preference, not a presentation mode. */
    function setChromeAutoHide(enabled) {
      var app = document.getElementById('app');
      if (!app) return;
      var wasActive = chromeAutoHideActive();
      chromeAutoHideOn = !!enabled;
      syncChromeAutoHide(wasActive);
    }

    function showSettings() {
      KanvazUI_Extended.showSettings();
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
      closeDialog:         closeDialog,
      showCardContextMenu: showCardContextMenu,
      showContextMenu:     showContextMenu,
      hideContextMenu:     hideContextMenu,
      toggleMoodLock:      toggleMoodLock,
      setChromeAutoHide:   setChromeAutoHide,
      showSearchBar:       showSearchBar,
      hideSearchBar:       hideSearchBar,
      closeAll:            closeAll,
      showSettings:        showSettings,
      closeSettings:       function() { KanvazUI_Extended.closeSettings(); },
      showAbout:           function() { KanvazUI_Extended.showAbout(); },
      showShortcuts:       showShortcuts
    };

  })();

  /* Boot on DOMContentLoaded */
  document.addEventListener('DOMContentLoaded', function() {
    init();
  });

  /* ── PureRef import ── */

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
