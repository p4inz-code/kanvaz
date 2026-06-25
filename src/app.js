/* app.js — renderer entry point */

var KanvazApp = (function() {

  var alwaysOnTop = false;
  var currentBoardPath = null;
  var boardDirty = false;

  /* ── Boot ── */

  function init() {
    KanvazErrors.init();

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

    /* Wire every button — CSP blocks inline onclick, so bind here */
    bindGlobalUI();

    /* Zoom display is now updated reactively from canvas.js applyTransform() */

    updateSaveStatus('ready');
    updateCardCount(0);
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
    on('btn-view-toggle', function() {
      if (typeof KanvazMapView !== 'undefined') KanvazMapView.toggle();
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
    });

    KanvazBridge.on('window-maximized-changed', function(isMax) {
      setMaximizedIcon(!!isMax);
    });
  }

  /* ── File drop ── */

  function handleDroppedFiles(files, worldPos) {
    for (var i = 0; i < files.length; i++) {
      (function(file, idx) {
        var pos = { x: worldPos.x + idx * 24, y: worldPos.y + idx * 24 };
        if (!file.path) {
          KanvazErrors.handle('FILE_NOT_FOUND', file.name);
          return;
        }
        KanvazMedia.loadFromFile(file, function(result, err) {
          if (err) {
            if (err === 'FILE_TOO_LARGE') {
              KanvazUI.toast('File too large for Kanvaz (max 500MB). Use a smaller preview or proxy file.', 'error');
            } else if (err === 'FILE_TYPE_INVALID') {
              KanvazUI.toast('"' + file.name + '" is not supported. Supported: JPG, PNG, GIF, BMP, WEBP, MP4, WEBM, MOV, MKV, AVI, MP3, WAV, OGG, M4A', 'error');
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
        });
      })(files[i], i);
    }
  }

  /* ── Clipboard paste ── */

  function handlePaste(e) {
    var items = e.clipboardData && e.clipboardData.items;
    if (!items) return;
    for (var i = 0; i < items.length; i++) {
      if (items[i].type.indexOf('image') !== -1) {
        var blob = items[i].getAsFile();
        if (!blob) continue;
        (function(b) {
          var reader = new FileReader();
          reader.onload = function(ev) {
            var scale = KanvazCanvas.getScale();
            var pasteCount = document.querySelectorAll('.card').length;
            var offset = (pasteCount % 8) * 24;
            var pos = {
              x: (-KanvazCanvas.getTx() / scale) + 80 + offset,
              y: (-KanvazCanvas.getTy() / scale) + 80 + offset
            };
            KanvazCards.createFromDataUrl(ev.target.result, 'pasted-image.png', pos);
          };
          reader.readAsDataURL(b);
        })(blob);
      }
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
            });
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

      var items = [
        {
          label: 'Annotate',
          action: function() {
            if (typeof KanvazAnnotate !== 'undefined') KanvazAnnotate.activate(card.id);
          }
        },
        {
          label: 'Connections',
          shortcut: 'C',
          action: function() {
            if (typeof KanvazInspector !== 'undefined') KanvazInspector.open(card.id);
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
        },
        { sep: true },
        {
          label: 'Flip horizontal',
          action: function() { KanvazCards.flipCard(card.id, 'h'); }
        },
        {
          label: 'Flip vertical',
          action: function() { KanvazCards.flipCard(card.id, 'v'); }
        },
        {
          label: 'Reset size',
          action: function() { KanvazCards.resetSize(card.id); }
        },
        { sep: true },
        {
          label: 'Opacity',
          submenu: true,
          action: function() { KanvazCards.showOpacityPicker(card.id, x, y); }
        },
        {
          label: 'Clear annotations',
          action: function() {
            if (typeof KanvazAnnotate !== 'undefined') KanvazAnnotate.clearAnnotations(card.id);
          }
        },
        { sep: true },
        {
          label: 'Delete',
          shortcut: 'Del',
          danger: true,
          action: function() { KanvazCards.deleteCard(card.id); }
        }
      ];

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
          el.innerHTML = item.label + (item.shortcut ? '<span class="ctx-shortcut">' + item.shortcut + '</span>' : '');
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

      menu.style.left = x + 'px';
      menu.style.top  = y + 'px';
      menu.style.display = 'block';

      var rect = menu.getBoundingClientRect();
      if (rect.right  > window.innerWidth)  menu.style.left = (x - rect.width)  + 'px';
      if (rect.bottom > window.innerHeight) menu.style.top  = (y - rect.height) + 'px';
    }

    function showContextMenu(x, y, type, target) {
      var menu = document.getElementById('context-menu');
      if (!menu) return;
      menu.innerHTML = '';
      menu.className = 'visible';

      var items = [];
      if (type === 'canvas') {
        items = [
          { label: 'New note', shortcut: 'Dbl-click', action: function() {
            var pos = KanvazCanvas.screenToWorld(x, y);
            if (typeof KanvazCards !== 'undefined') KanvazCards.createNote(pos.x, pos.y);
          }},
          { sep: true },
          { label: 'Reset zoom', shortcut: '0', action: function() { KanvazCanvas.zoomReset(); }},
          { label: 'Fit all cards', shortcut: 'F', action: function() { KanvazCanvas.zoomFit(); }}
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
          el.innerHTML = item.label + (item.shortcut ? '<span class="ctx-shortcut">' + item.shortcut + '</span>' : '');
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
      menu.style.left = x + 'px';
      menu.style.top  = y + 'px';
      menu.style.display = 'block';

      var rect = menu.getBoundingClientRect();
      if (rect.right > window.innerWidth)  menu.style.left = (x - rect.width) + 'px';
      if (rect.bottom > window.innerHeight) menu.style.top = (y - rect.height) + 'px';
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
      /* Exit mood lock on Escape */
      var app = document.getElementById('app');
      if (app && app.dataset.moodlock === '1') toggleMoodLock();
    }

    function toggleMoodLock() {
      var app = document.getElementById('app');
      if (!app) return;
      var active = app.dataset.moodlock === '1';
      var toolbar   = document.getElementById('toolbar');
      var tabs      = document.getElementById('board-tabs');
      var statusbar = document.getElementById('statusbar');
      var titlebar  = document.getElementById('titlebar');
      if (active) {
        app.dataset.moodlock = '0';
        if (toolbar)   toolbar.style.display   = '';
        if (tabs)      tabs.style.display      = '';
        if (statusbar) statusbar.style.display = '';
        if (titlebar)  titlebar.style.display  = '';
        KanvazUI.toast('Mood lock off');
      } else {
        app.dataset.moodlock = '1';
        if (toolbar)   toolbar.style.display   = 'none';
        if (tabs)      tabs.style.display      = 'none';
        if (statusbar) statusbar.style.display = 'none';
        if (titlebar)  titlebar.style.display  = 'none';
        KanvazUI.toast('Mood lock — Esc to exit');
      }
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

  return {
    toggleAlwaysOnTop: toggleAlwaysOnTop,
    updateSaveStatus:  updateSaveStatus,
    updateCardCount:   updateCardCount,
    updateEmptyState:  updateEmptyState,
    getCurrentPath:    function() { return currentBoardPath; },
    setCurrentPath:    function(p) {
      currentBoardPath = p;
      var el = document.getElementById('titlebar-title');
      if (el && p) {
        var parts = p.split(/[\\/]/);
        el.textContent = parts[parts.length - 1];
      }
    },
    markDirty:         function() {
      boardDirty = true;
      updateSaveStatus('unsaved');
    },
    markClean:         function() {
      boardDirty = false;
      updateSaveStatus('saved');
    },
    isDirty:           function() { return boardDirty; }
  };

})();
