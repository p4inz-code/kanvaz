/* ui.js — minimap, settings panel, about screen, shortcuts overlay, first run */

var KanvazUI_Extended = (function() {

  /* ── Minimap ── */

  var minimapEl  = null;
  var minimapCtx = null;
  var minimapRAF = null;
  var MMAP_W = 120;
  var MMAP_H = 80;

  function initMinimap() {
    var wrap = document.createElement('div');
    wrap.id = 'minimap-wrap';
    wrap.style.cssText = [
      'position:fixed',
      'bottom:34px',
      'right:12px',
      'width:' + MMAP_W + 'px',
      'height:' + MMAP_H + 'px',
      'background:var(--color-surface)',
      'border:1px solid var(--color-border)',
      'border-radius:6px',
      'overflow:hidden',
      'z-index:500',
      'opacity:0.85',
      'cursor:pointer'
    ].join(';');

    var cvs = document.createElement('canvas');
    cvs.width  = MMAP_W;
    cvs.height = MMAP_H;
    cvs.style.cssText = 'display:block;width:100%;height:100%;';
    wrap.appendChild(cvs);

    document.body.appendChild(wrap);
    minimapEl  = cvs;
    minimapCtx = cvs.getContext('2d');

    /* Click minimap to pan canvas there */
    wrap.addEventListener('mousedown', function(e) {
      e.stopPropagation();
      var rect  = wrap.getBoundingClientRect();
      var mx    = (e.clientX - rect.left) / MMAP_W;
      var my    = (e.clientY - rect.top)  / MMAP_H;
      var vp    = KanvazCanvas.getViewport();
      var WORLD = computeWorld();
      /* vp.width/height are screen-space pixels; the on-canvas viewport
         is that divided by the current zoom (see drawMinimap()'s own
         vw/vh below, which does the same division). Skipping /vp.scale
         here made minimap click-to-pan only line up at exactly 100%
         zoom and drift further off the more zoomed in/out the canvas was. */
      var scale = vp.scale || 1;
      var wx    = mx * WORLD - (vp.width  / scale) / 2;
      var wy    = my * WORLD - (vp.height / scale) / 2;
      KanvazCanvas.panTo(-wx, -wy);
    });

    startMinimapLoop();
  }

  function startMinimapLoop() {
    function tick() {
      var wrap = document.getElementById('minimap-wrap');
      if (wrap && wrap.style.display !== 'none') {
        drawMinimap();
      }
      minimapRAF = requestAnimationFrame(tick);
    }
    minimapRAF = requestAnimationFrame(tick);
  }

  function computeWorld() {
    var cards = KanvazCards.getAll();
    var ids = Object.keys(cards);
    if (!ids.length) return 4000;
    var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (var i = 0; i < ids.length; i++) {
      var c = cards[ids[i]];
      if (c.x < minX) minX = c.x;
      if (c.y < minY) minY = c.y;
      if (c.x + c.w > maxX) maxX = c.x + c.w;
      if (c.y + c.h > maxY) maxY = c.y + c.h;
    }
    var vp = KanvazCanvas.getViewport();
    var worldW = Math.max(maxX - minX, vp.width  / (vp.scale || 1)) * 1.3;
    var worldH = Math.max(maxY - minY, vp.height / (vp.scale || 1)) * 1.3;
    return Math.max(worldW, worldH, 1000);
  }

  function drawMinimap() {
    if (!minimapCtx) return;
    var ctx   = minimapCtx;
    var vp    = KanvazCanvas.getViewport();
    var cards = KanvazCards.getAll();
    var WORLD = computeWorld();
    var sx    = MMAP_W / WORLD;
    var sy    = MMAP_H / WORLD;

    ctx.clearRect(0, 0, MMAP_W, MMAP_H);

    /* Cards */
    for (var id in cards) {
      var c = cards[id];
      var color = c.type === 'note'  ? '#4CAF82'
                : c.type === 'video' ? '#F0A500'
                : c.type === 'gif'   ? '#4A9EFF'
                : '#DCDCE8';
      ctx.fillStyle = color;
      ctx.globalAlpha = 0.6;
      ctx.fillRect(
        (c.x / WORLD) * MMAP_W,
        (c.y / WORLD) * MMAP_H,
        Math.max(2, (c.w / WORLD) * MMAP_W),
        Math.max(2, (c.h / WORLD) * MMAP_H)
      );
    }

    ctx.globalAlpha = 1;

    /* Viewport indicator */
    var vx = (-vp.tx / vp.scale / WORLD) * MMAP_W;
    var vy = (-vp.ty / vp.scale / WORLD) * MMAP_H;
    var vw = (vp.width  / vp.scale / WORLD) * MMAP_W;
    var vh = (vp.height / vp.scale / WORLD) * MMAP_H;

    ctx.strokeStyle = getComputedStyle(document.documentElement).getPropertyValue('--color-accent').trim() || '#4A9EFF';
    ctx.lineWidth   = 1;
    ctx.strokeRect(vx, vy, vw, vh);
  }

  /* ── Settings panel ── */

  var settingsOpen = false;
  var currentPluginsListEl = null;

  var SETTINGS_VERSION = 2;

  var SETTINGS_DEFAULTS = {
    _version:         SETTINGS_VERSION,
    theme:            'dark',
    autosaveInterval: 30,
    showMinimap:      true,
    cardShadows:      true,
    dotGridVisible:   true,
    openOnStartup:    true,
    confirmDelete:    false,
    defaultCardW:     600,
    animationsOn:     true,
    alwaysOnTop:      false,
    doubleClickCreatesNote: false,
    leftDragPan:      true,
    autoHideChrome:   false,
    gridSnapEnabled:  false,
    gridSnapIncrement: 'minor',
    topModeAutoOnTop: false,
    devShowFPS:       false,
    devShowIds:       false
  };

  /* ── Settings migrations ──
     Each entry: { from: N, to: N+1, migrate: function(s) { ... return s; } }
     Runs in order when loaded _version < SETTINGS_VERSION.
     To add a new migration: bump SETTINGS_VERSION, add an entry here. */
  var SETTINGS_MIGRATIONS = [
    { from: 1, to: 2, migrate: function(s) {
      /* v1→v2: no transform needed, just establishes the versioning system.
         Future migrations go here, e.g.:
         if (s.oldKey !== undefined) { s.newKey = s.oldKey; delete s.oldKey; } */
      return s;
    }}
  ];

  function migrateSettings(loaded) {
    var v = loaded._version || 1;
    if (v >= SETTINGS_VERSION) return loaded;
    for (var i = 0; i < SETTINGS_MIGRATIONS.length; i++) {
      var m = SETTINGS_MIGRATIONS[i];
      if (v === m.from) {
        loaded = m.migrate(loaded);
        v = m.to;
        loaded._version = v;
      }
    }
    return loaded;
  }

  var settings = {};

  function loadSettings() {
    settings = JSON.parse(JSON.stringify(SETTINGS_DEFAULTS));
    applySettings();
    /* Load from userData via IPC */
    KanvazBridge.readSettings().then(function(result) {
      if (result && result.ok && result.data) {
        try {
          var loaded = JSON.parse(result.data);
          loaded = migrateSettings(loaded);
          var migrated = (loaded._version || 1) !== SETTINGS_VERSION;
          for (var k in loaded) {
            if (SETTINGS_DEFAULTS.hasOwnProperty(k)) settings[k] = loaded[k];
          }
          settings._version = SETTINGS_VERSION;
          applySettings();
          /* Persist migrated settings so migration only runs once */
          if (migrated) {
            KanvazBridge.writeSettings(JSON.stringify(settings)).catch(function() {});
          }
        } catch (e) {
          console.warn('[Kanvaz] Failed to parse settings, using defaults:', e.message);
        }
      }
    }).catch(function(e) {
      console.warn('[Kanvaz] settings IPC failed:', e);
    });
  }

  function saveSettings() {
    KanvazBridge.writeSettings(JSON.stringify(settings)).then(function() {}).catch(function(e) { console.warn('[Kanvaz] writeSettings IPC failed:', e); });
    applySettings();
  }

  function applySettings() {
    /* Minimap */
    var mw = document.getElementById('minimap-wrap');
    if (mw) mw.style.display = settings.showMinimap ? '' : 'none';

    /* Grid */
    var grid = document.getElementById('canvas-grid');
    if (grid) grid.style.display = settings.dotGridVisible ? '' : 'none';

    /* Card shadows */
    var styleId = 'kanvaz-settings-style';
    var existing = document.getElementById(styleId);
    if (existing) existing.parentNode.removeChild(existing);

    var style = document.createElement('style');
    style.id = styleId;
    var css = '';

    if (!settings.cardShadows) {
      css += '.card { box-shadow: none !important; }\n';
    }

    if (!settings.animationsOn) {
      css += '* { transition: none !important; animation: none !important; }\n';
    }

    style.textContent = css;
    document.head.appendChild(style);

    /* Empty-state hint text reflects double-click setting */
    var hint = document.getElementById('empty-sub-hint');
    if (hint) {
      hint.innerHTML = settings.doubleClickCreatesNote
        ? 'Double-click to add a note · Ctrl+V to paste an image'
        : 'Right-click for options · Ctrl+V to paste an image';
    }

    /* Always on top — apply persisted value */
    if (typeof KanvazBridge !== 'undefined' && KanvazBridge.setAlwaysOnTop) {
      KanvazBridge.setAlwaysOnTop(!!settings.alwaysOnTop);
    }

    /* Auto-hide toolbar — same hover-reveal mechanic Top Mode uses,
       but as a persistent setting instead of a shortcut-gated mode.
       Independent of Top Mode's own state; either one hides the
       chrome, and setChromeAutoHide reconciles them so turning one
       off doesn't undo the other. */
    if (typeof KanvazUI !== 'undefined' && KanvazUI.setChromeAutoHide) {
      KanvazUI.setChromeAutoHide(!!settings.autoHideChrome);
    }

    /* Dev Mode: FPS / render-time overlay */
    syncFpsOverlay(!!settings.devShowFPS);

    /* Dev Mode: show card/connection IDs — pure CSS attr() overlay for
       cards (DOM id) and Map View nodes (data-ref-id); connection IDs
       are handled in map-view.js's renderLines() since SVG text needs
       an actual element, not a CSS pseudo-element. */
    var idStyleId = 'kanvaz-dev-ids-style';
    var existingIdStyle = document.getElementById(idStyleId);
    if (existingIdStyle) existingIdStyle.parentNode.removeChild(existingIdStyle);
    if (settings.devShowIds) {
      var idStyle = document.createElement('style');
      idStyle.id = idStyleId;
      idStyle.textContent =
        '.card::after { content: attr(id); position:absolute; top:2px; left:4px; font-size:9px; font-family:var(--font-mono); color:var(--color-accent); background:rgba(0,0,0,0.7); padding:1px 4px; border-radius:3px; pointer-events:none; z-index:100; }\n' +
        '.map-node::after { content: attr(data-ref-id); position:absolute; bottom:-16px; left:0; font-size:9px; font-family:var(--font-mono); color:var(--color-accent); background:rgba(0,0,0,0.7); padding:1px 4px; border-radius:3px; pointer-events:none; z-index:50; white-space:nowrap; }';
      document.head.appendChild(idStyle);
    }

    /* Theme — apply to root element */
    var theme = settings.theme || 'dark';
    if (typeof KanvazPluginAPI !== 'undefined' && KanvazPluginAPI._applyTheme) {
      KanvazPluginAPI._applyTheme(theme);
    } else {
      document.documentElement.setAttribute('data-theme', theme);
    }

    /* Restart autosave timer with current interval setting */
    if (typeof KanvazBoards !== 'undefined' && KanvazBoards.startAutosave) {
      KanvazBoards.startAutosave();
    }
  }

  /* ── Dev Mode: FPS / render-time overlay ── */
  var fpsRafId = null;
  var fpsFrameCount = 0;
  var fpsLastTime = 0;
  var fpsLastFrameStart = 0;

  function syncFpsOverlay(enabled) {
    var el = document.getElementById('dev-fps-overlay');
    if (enabled && !el) {
      el = document.createElement('div');
      el.id = 'dev-fps-overlay';
      el.style.cssText = [
        'position:fixed', 'top:8px', 'left:8px', 'z-index:99999',
        'background:rgba(0,0,0,0.7)', 'color:#4CAF82',
        'font-family:var(--font-mono)', 'font-size:11px',
        'padding:4px 8px', 'border-radius:4px', 'pointer-events:none',
        'white-space:pre'
      ].join(';');
      document.body.appendChild(el);
      fpsFrameCount = 0;
      fpsLastTime = performance.now();
      fpsLoop();
    } else if (!enabled && el) {
      el.remove();
      if (fpsRafId) { cancelAnimationFrame(fpsRafId); fpsRafId = null; }
    }
  }

  function fpsLoop() {
    var now = performance.now();
    var frameTime = fpsLastFrameStart ? (now - fpsLastFrameStart) : 0;
    fpsLastFrameStart = now;
    fpsFrameCount++;

    if (now - fpsLastTime >= 500) {
      var fps = Math.round((fpsFrameCount * 1000) / (now - fpsLastTime));
      var el = document.getElementById('dev-fps-overlay');
      if (el) el.textContent = 'FPS: ' + fps + '\nframe: ' + frameTime.toFixed(1) + 'ms';
      fpsFrameCount = 0;
      fpsLastTime = now;
    }
    fpsRafId = requestAnimationFrame(fpsLoop);
  }

  /* ── Dev Mode: export debug info for bug reports ── */
  function exportDebugInfo() {
    var cards = (typeof KanvazCards !== 'undefined') ? KanvazCards.getAll() : {};
    var cardCount = Object.keys(cards).length;
    var connCount = 0;
    if (typeof KanvazConnections !== 'undefined' && KanvazConnections.serialise) {
      connCount = KanvazConnections.serialise().length;
    }
    var info = [
      'Kanvaz Debug Info',
      '==================',
      'Version: ' + (typeof KanvazBoards !== 'undefined' && KanvazBoards.getVersion ? KanvazBoards.getVersion() : 'unknown'),
      'Platform: ' + navigator.platform,
      'User agent: ' + navigator.userAgent,
      'Theme: ' + (settings.theme || 'dark'),
      'Cards on current board: ' + cardCount,
      'Connections (file-level): ' + connCount,
      'Window size: ' + window.innerWidth + 'x' + window.innerHeight,
      'Settings: ' + JSON.stringify(settings, null, 2)
    ].join('\n');

    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(info).then(function() {
        KanvazUI.toast('Debug info copied to clipboard');
      }, function() {
        KanvazUI.toast('Could not copy — clipboard access denied', 'error');
      });
    } else {
      KanvazUI.toast('Clipboard unavailable', 'error');
    }
  }

  /* ── Reset Kanvaz (settings & cache only) ──
     Explicitly, prominently states what this does and doesn't touch —
     this is a destructive-feeling action even though it can never
     reach a saved board file by construction (main.js's handler only
     ever touches paths under userData, and boards live wherever the
     user saved them, entirely outside that). */
  function confirmResetAppData() {
    KanvazUI.showDialog(
      'Reset Kanvaz?',
      'This clears settings, the recent-files list, and the autosave/recovery cache, then restarts Kanvaz with defaults. Your saved .kanvaz board files are never touched — this only ever affects app-internal preferences and cache. Any unsaved changes in the board you currently have open will be lost, the same as closing without saving. "Reset & Clear Caches" also wipes Electron’s own HTTP/GPU/local-storage caches — slower to rebuild on next launch, but the move if something looks visually broken and a normal reset didn’t fix it.',
      [
        { label: 'Reset', cls: 'danger', action: function() { doResetAppData(false); } },
        { label: 'Reset & Clear Caches', cls: 'danger', action: function() { doResetAppData(true); } },
        { label: 'Cancel', cls: '', action: function() {} }
      ]
    );
  }

  function doResetAppData(clearCaches) {
    KanvazBridge.resetAppData(clearCaches).then(function(result) {
      if (result && result.ok) {
        KanvazUI.toast('Reset complete — restarting…');
        setTimeout(function() { KanvazBridge.relaunchApp(); }, 800);
      } else {
        KanvazUI.toast('Reset failed: ' + ((result && result.error) || 'unknown error'), 'error');
      }
    }, function() {
      KanvazUI.toast('Reset failed — could not reach the app process', 'error');
    });
  }

  function showSettings() {
    if (settingsOpen) { closeSettings(); return; }
    settingsOpen = true;

    var panel = document.createElement('div');
    panel.id = 'settings-panel';
    panel.style.cssText = [
      'position:fixed',
      'top:80px',
      'right:12px',
      'width:280px',
      'max-height:calc(100vh - 100px)',
      'overflow-y:auto',
      'background:var(--color-surface)',
      'border:1px solid var(--color-border-2)',
      'border-radius:var(--radius-lg)',
      'padding:16px',
      'z-index:9000',
      'box-shadow:0 8px 32px var(--color-shadow)',
      'font-size:13px',
      /* Polish fix: no entrance animation at all — instant pop, unlike
         About/Dialog/Shortcuts (all now fade+scale in) and Inspector/
         Properties (slide in from their docked edge). Settings is a
         right-anchored panel like Inspector, so it gets the same
         panel-slide-in-right treatment. */
      'animation:panel-slide-in-right 0.15s ease-out'
    ].join(';');

    var title = document.createElement('div');
    title.style.cssText = 'font-size:14px;font-weight:600;color:var(--color-text);margin-bottom:14px;display:flex;align-items:center;justify-content:space-between;';

    var titleText = document.createElement('span');
    titleText.textContent = 'Settings';
    title.appendChild(titleText);

    var closeX = document.createElement('button');
    closeX.innerHTML = '&times;';
    closeX.style.cssText = 'background:none;border:none;cursor:pointer;color:var(--color-text-3);font-size:16px;padding:0;line-height:1;';
    closeX.addEventListener('click', function() { closeSettings(); });
    title.appendChild(closeX);

    panel.appendChild(title);

    var themeOptions = [['dark', 'Dark'], ['light', 'Light']];
    if (typeof KanvazPluginAPI !== 'undefined' && KanvazPluginAPI._getAllThemes) {
      var pluginThemeList = KanvazPluginAPI._getAllThemes();
      for (var ti = 0; ti < pluginThemeList.length; ti++) {
        themeOptions.push([pluginThemeList[ti].id, pluginThemeList[ti].name]);
      }
    }

    var rows = [
      { section: 'Appearance' },
      { key: 'theme',           label: 'Theme',                 type: 'select', options: themeOptions },
      { key: 'showMinimap',     label: 'Show minimap',          type: 'toggle' },
      { key: 'dotGridVisible',  label: 'Grid lines',            type: 'toggle' },
      { key: 'cardShadows',     label: 'Card shadows',          type: 'toggle' },
      { key: 'animationsOn',    label: 'Animations',            type: 'toggle' },
      { section: 'Behavior' },
      { key: 'openOnStartup',   label: 'Show recent on startup',type: 'toggle' },
      { key: 'confirmDelete',   label: 'Confirm before delete', type: 'toggle' },
      { key: 'leftDragPan',     label: 'Left-drag empty canvas to pan', type: 'toggle' },
      { key: 'autoHideChrome',  label: 'Auto-hide toolbar (hover top edge to reveal)', type: 'toggle' },
      { key: 'topModeAutoOnTop', label: 'Top Mode auto-enables Always on Top', type: 'toggle' },
      { key: 'doubleClickCreatesNote', label: 'Double-click canvas creates note', type: 'toggle' },
      { key: 'gridSnapEnabled', label: 'Snap to grid (move & resize)', type: 'toggle' },
      { key: 'gridSnapIncrement', label: 'Snap increment', type: 'select', options: [['minor','Minor (24px)'],['major','Major (120px)']] },
      { section: 'Files' },
      { key: 'autosaveInterval',label: 'Autosave (seconds)',    type: 'number', min: 10, max: 300 },
      { key: 'defaultCardW',    label: 'Default card width (px)',type: 'number', min: 80, max: 1200 },
      { section: 'Reset' },
      { label: 'Reset Kanvaz (settings & cache only)', type: 'button', buttonLabel: 'Reset',
        action: function() { confirmResetAppData(); } },
      { section: 'Developer' },
      { key: 'devShowFPS',      label: 'FPS / render-time overlay', type: 'toggle' },
      { key: 'devShowIds',      label: 'Show card/connection IDs',  type: 'toggle' },
      { label: 'Run diagnostics now', type: 'button', buttonLabel: 'Run',
        action: function() {
          if (typeof KanvazMapView !== 'undefined' && KanvazMapView.diagnose) {
            KanvazMapView.diagnose();
            KanvazUI.toast('Diagnostics run — see console (F12 / Ctrl+Shift+I)');
          } else {
            KanvazUI.toast('Diagnostics only available in Map View', 'error');
          }
        } },
      { label: 'Generate 50 test cards', type: 'button', buttonLabel: 'Generate',
        action: function() {
          if (typeof KanvazCards !== 'undefined' && KanvazCards.generateTestCards) {
            var vp = (typeof KanvazCanvas !== 'undefined') ? KanvazCanvas.getViewport() : null;
            var bx = vp ? (-vp.tx / vp.scale) + 60 : 60;
            var by = vp ? (-vp.ty / vp.scale) + 60 : 60;
            KanvazCards.generateTestCards(50, bx, by);
            KanvazUI.toast('Generated 50 test cards');
          }
        } },
      { label: 'Export debug info', type: 'button', buttonLabel: 'Copy',
        action: function() { exportDebugInfo(); } },
      { label: 'Load unpacked plugin…', type: 'button', buttonLabel: 'Load',
        action: function() {
          if (typeof KanvazPluginLoader === 'undefined' || !KanvazPluginLoader.loadUnpacked) {
            KanvazUI.toast('Not available in this build', 'error');
            return;
          }
          KanvazPluginLoader.loadUnpacked().then(function(result) {
            if (!result || result.cancelled) return;
            if (result.ok) {
              KanvazUI.toast('Loaded "' + result.manifest.name + '" (dev mode — click Load again to reload after edits)');
              if (currentPluginsListEl) refreshPluginsList(currentPluginsListEl);
            } else {
              KanvazUI.toast(result.error || 'Could not load that folder', 'error');
            }
          });
        } }
    ];

    for (var i = 0; i < rows.length; i++) {
      (function(row) {
        /* Section header */
        if (row.section) {
          var hdr = document.createElement('div');
          hdr.style.cssText = 'font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:0.6px;color:var(--color-text-3);margin:14px 0 4px;';
          hdr.textContent = row.section;
          panel.appendChild(hdr);
          return;
        }
        var el = document.createElement('div');
        el.style.cssText = 'display:flex;align-items:center;justify-content:space-between;padding:8px 0;border-bottom:1px solid var(--color-border);';

        var lbl = document.createElement('span');
        lbl.style.cssText = 'color:var(--color-text-2);';
        lbl.textContent = row.label;
        el.appendChild(lbl);

        if (row.type === 'toggle') {
          var track = document.createElement('div');
          track.style.cssText = 'position:relative;width:34px;height:18px;border-radius:9px;cursor:pointer;transition:background 0.2s;background:' + (settings[row.key] ? 'var(--color-accent)' : 'var(--color-border-2)') + ';flex-shrink:0;';

          var thumb = document.createElement('div');
          thumb.style.cssText = 'position:absolute;top:2px;left:' + (settings[row.key] ? '16px' : '2px') + ';width:14px;height:14px;border-radius:50%;background:#fff;transition:left 0.2s;';
          track.appendChild(thumb);

          track.onclick = function() {
            settings[row.key] = !settings[row.key];
            track.style.background = settings[row.key] ? 'var(--color-accent)' : 'var(--color-border-2)';
            thumb.style.left = settings[row.key] ? '16px' : '2px';
            saveSettings();
          };

          el.appendChild(track);

        } else if (row.type === 'number') {
          var inp = document.createElement('input');
          inp.type = 'number';
          inp.min  = row.min;
          inp.max  = row.max;
          inp.value = settings[row.key];
          inp.style.cssText = 'width:64px;background:var(--color-surface-2);border:1px solid var(--color-border);border-radius:4px;color:var(--color-text);padding:3px 6px;font-size:12px;font-family:var(--font-mono);text-align:right;outline:none;';
          inp.onchange = function() {
            var v = parseInt(inp.value);
            if (!isNaN(v)) {
              settings[row.key] = Math.max(row.min, Math.min(row.max, v));
              inp.value = settings[row.key];
              saveSettings();
            }
          };
          el.appendChild(inp);

        } else if (row.type === 'select') {
          var sel = document.createElement('select');
          sel.style.cssText = 'width:90px;background:var(--color-surface-2);border:1px solid var(--color-border);border-radius:4px;color:var(--color-text);padding:3px 6px;font-size:12px;font-family:var(--font-ui);outline:none;';
          for (var oi = 0; oi < row.options.length; oi++) {
            var opt = document.createElement('option');
            opt.value = row.options[oi][0];
            opt.textContent = row.options[oi][1];
            if (settings[row.key] === row.options[oi][0]) opt.selected = true;
            sel.appendChild(opt);
          }
          sel.onchange = function() {
            settings[row.key] = sel.value;
            saveSettings();
          };
          el.appendChild(sel);

        } else if (row.type === 'button') {
          var btn = document.createElement('button');
          btn.textContent = row.buttonLabel || 'Run';
          btn.style.cssText = 'background:var(--color-accent-bg);border:1px solid var(--color-accent);border-radius:4px;color:var(--color-accent);padding:4px 10px;font-size:11px;font-family:var(--font-ui);cursor:pointer;transition:background 0.1s;';
          btn.onmouseenter = function() { btn.style.background = 'rgba(var(--color-accent-rgb),0.25)'; };
          btn.onmouseleave = function() { btn.style.background = 'var(--color-accent-bg)'; };
          btn.onclick = function() { if (row.action) row.action(); };
          el.appendChild(btn);
        }

        panel.appendChild(el);
      })(rows[i]);
    }

    /* Plugins section (4.2.0) — not part of the generic rows[] renderer
       above since its content is async (comes from a scan IPC call) and
       each row needs bespoke controls (enable toggle vs. a consent
       button, Remove). */
    var pluginsHdr = document.createElement('div');
    pluginsHdr.style.cssText = 'font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:0.6px;color:var(--color-text-3);margin:14px 0 4px;';
    pluginsHdr.textContent = 'Plugins';
    panel.appendChild(pluginsHdr);

    var pluginsList = document.createElement('div');
    pluginsList.id = 'plugins-list';
    panel.appendChild(pluginsList);
    currentPluginsListEl = pluginsList;
    refreshPluginsList(pluginsList);

    var addPluginBtn = document.createElement('button');
    addPluginBtn.textContent = 'Add a Plugin…';
    addPluginBtn.style.cssText = 'margin-top:8px;width:100%;padding:6px;background:var(--color-accent-bg);border:1px solid var(--color-accent);border-radius:6px;color:var(--color-accent);font-family:var(--font-ui);font-size:12px;cursor:pointer;transition:background 0.1s;';
    addPluginBtn.onmouseenter = function() { addPluginBtn.style.background = 'rgba(var(--color-accent-rgb),0.25)'; };
    addPluginBtn.onmouseleave = function() { addPluginBtn.style.background = 'var(--color-accent-bg)'; };
    addPluginBtn.onclick = function() {
      if (typeof KanvazBridge !== 'undefined' && KanvazBridge.openPluginsFolder) {
        KanvazBridge.openPluginsFolder();
      }
    };
    panel.appendChild(addPluginBtn);

    var browseBtn = document.createElement('button');
    browseBtn.textContent = 'Browse Official Plugins…';
    browseBtn.style.cssText = 'margin-top:6px;width:100%;padding:6px;background:transparent;border:1px solid var(--color-border);border-radius:6px;color:var(--color-text-2);font-family:var(--font-ui);font-size:12px;cursor:pointer;transition:background 0.1s;';
    browseBtn.onmouseenter = function() { browseBtn.style.background = 'var(--color-surface-2)'; };
    browseBtn.onmouseleave = function() { browseBtn.style.background = 'transparent'; };
    browseBtn.onclick = function() { showOfficialPluginsBrowser(); };
    panel.appendChild(browseBtn);

    /* Plugin-registered settings panels (e.g. Theme Creator) — each
       gets its own labeled section and a plain empty container the
       plugin fills in itself via render(container). The header + empty
       container are built and placed here (so ordering in the panel
       stays right after the plugin list / Add button and before About),
       but the actual render(container) calls are deferred until AFTER
       document.body.appendChild(panel) below — see pendingPluginPanelRenders.
       Audit fix: this used to call render(container) immediately, while
       `panel` was still an off-DOM, detached subtree. Any plugin whose
       render() reads layout (getBoundingClientRect/offsetWidth, both 0
       on a detached element) or resolves a CSS custom property via
       getComputedStyle (which can't see :root while disconnected from
       document) — exactly the kind of thing a theme-reading Theme
       Creator plausibly does — would silently get wrong/empty values. */
    var pendingPluginPanelRenders = [];
    if (typeof KanvazPluginAPI !== 'undefined' && KanvazPluginAPI._getAllSettingsPanels) {
      var panels = KanvazPluginAPI._getAllSettingsPanels();
      for (var pi = 0; pi < panels.length; pi++) {
        (function(panelEntry) {
          var hdr = document.createElement('div');
          hdr.style.cssText = 'font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:0.6px;color:var(--color-text-3);margin:14px 0 4px;';
          hdr.textContent = panelEntry.def.label;
          panel.appendChild(hdr);

          var container = document.createElement('div');
          panel.appendChild(container);
          pendingPluginPanelRenders.push(panelEntry, container);
        })(panels[pi]);
      }
    }

    /* About link */
    var aboutBtn = document.createElement('button');
    aboutBtn.textContent = 'About Kanvaz';
    aboutBtn.style.cssText = 'margin-top:12px;width:100%;padding:7px;background:transparent;border:1px solid var(--color-border);border-radius:6px;color:var(--color-text-2);font-family:var(--font-ui);font-size:12px;cursor:pointer;transition:background 0.1s;';
    aboutBtn.onmouseenter = function() { aboutBtn.style.background = 'var(--color-surface-2)'; };
    aboutBtn.onmouseleave = function() { aboutBtn.style.background = 'transparent'; };
    aboutBtn.onclick = function() { closeSettings(); showAbout(); };
    panel.appendChild(aboutBtn);

    document.body.appendChild(panel);

    /* Now that the panel is attached to document.body, run each plugin
       settings panel's render(container) — getComputedStyle/getBoundingClientRect
       inside a plugin's render() now behave normally. Still individually
       try/catch-wrapped so one broken plugin panel can't break the rest
       of Settings; on failure the container gets a small visible note
       instead of being silently empty (was console-only before). */
    for (var ppi = 0; ppi < pendingPluginPanelRenders.length; ppi += 2) {
      (function(panelEntry, container) {
        try {
          panelEntry.def.render(container);
        } catch (e) {
          console.error('[Kanvaz Plugin] settings panel "' + panelEntry.id + '" render() failed:', e.message);
          var errNote = document.createElement('div');
          errNote.style.cssText = 'font-size:11px;color:var(--color-red);';
          errNote.textContent = 'This plugin panel failed to load.';
          container.appendChild(errNote);
        }
      })(pendingPluginPanelRenders[ppi], pendingPluginPanelRenders[ppi + 1]);
    }
  }

  function closeSettings() {
    settingsOpen = false;
    currentPluginsListEl = null;
    var el = document.getElementById('settings-panel');
    if (el && el.parentNode) el.parentNode.removeChild(el);
  }

  /* ── Plugins (4.2.0) ──
     Add-a-Plugin flow: the button above opens the plugins folder for the
     user to drop a folder into (no manual path-typing). This list
     re-scans on section-open and on window focus (see init() below) so
     a plugin dropped in while Settings is already open picks up as soon
     as the user tabs back — no watcher, no race on a half-finished
     copy, since the file-explorer interaction is always finished by the
     time focus returns here. */

  function refreshPluginsList(container) {
    if (typeof KanvazBridge === 'undefined' || !KanvazBridge.scanPlugins) return;
    KanvazBridge.scanPlugins().then(function(result) {
      /* Audit fix: closeSettings() removes #settings-panel from
         document.body, which only nulls THAT panel's parentNode —
         `container` (the #plugins-list div passed in here) still has
         its own parentNode pointing at the now-detached panel element,
         which is still truthy. So the old `!container.parentNode` check
         never actually caught "Settings was closed while this scan was
         in flight". Comparing identity against the current
         currentPluginsListEl (reset to null by closeSettings(), and
         reassigned to a brand-new element by the next showSettings())
         correctly detects both cases: Settings closed entirely, or
         closed and reopened before this older scan resolved. */
      if (container !== currentPluginsListEl) return;
      container.innerHTML = '';
      var plugins = (result && result.ok) ? result.plugins : [];
      if (!plugins.length) {
        var empty = document.createElement('div');
        empty.style.cssText = 'font-size:11px;color:var(--color-text-3);padding:6px 0;';
        empty.textContent = 'No plugins installed yet.';
        container.appendChild(empty);
        return;
      }
      for (var i = 0; i < plugins.length; i++) {
        container.appendChild(buildPluginRow(plugins[i], container));
      }
    }).catch(function() {});
  }

  function buildPluginRow(plugin, listContainer) {
    var row = document.createElement('div');
    row.style.cssText = 'padding:8px 0;border-bottom:1px solid var(--color-border);';

    if (!plugin.valid) {
      var nameEl = document.createElement('div');
      nameEl.style.cssText = 'font-size:12px;color:var(--color-text-2);';
      nameEl.textContent = plugin.folder;
      var reasonEl = document.createElement('div');
      reasonEl.style.cssText = 'font-size:11px;color:var(--color-red);margin-top:2px;';
      reasonEl.textContent = 'Invalid: ' + plugin.reason;
      row.appendChild(nameEl);
      row.appendChild(reasonEl);
      return row;
    }

    var top = document.createElement('div');
    top.style.cssText = 'display:flex;align-items:center;justify-content:space-between;gap:8px;';

    var info = document.createElement('div');
    info.style.cssText = 'font-size:12px;color:var(--color-text);';
    info.textContent = plugin.manifest.name + ' — v' + plugin.manifest.version;
    top.appendChild(info);

    if (plugin.needsConsent) {
      var reviewBtn = document.createElement('button');
      reviewBtn.textContent = 'Review & Enable';
      reviewBtn.style.cssText = 'background:var(--color-accent-bg);border:1px solid var(--color-accent);border-radius:4px;color:var(--color-accent);padding:3px 8px;font-size:11px;font-family:var(--font-ui);cursor:pointer;flex-shrink:0;';
      /* Calls straight through to the main process, which re-reads this
         plugin's manifest itself and shows a native OS dialog — the
         renderer never constructs the consent prompt or decides what
         permissions are being requested (see the security note in
         main.js's plugins-review-and-enable handler). */
      reviewBtn.onclick = function() {
        reviewBtn.disabled = true;
        KanvazBridge.reviewAndEnablePlugin(plugin.folder).then(function(result) {
          reviewBtn.disabled = false;
          if (result && result.ok && result.approved) {
            refreshPluginsList(listContainer);
            if (typeof KanvazPluginLoader !== 'undefined') {
              KanvazPluginLoader.loadEnabledPlugins();
            }
          } else if (result && !result.ok) {
            KanvazUI.toast(result.error || 'Could not review this plugin', 'error');
          }
          /* result.ok && !result.approved just means the user clicked
             Cancel on the native dialog — nothing to do. */
        });
      };
      top.appendChild(reviewBtn);
    } else {
      var track = document.createElement('div');
      track.style.cssText = 'position:relative;width:34px;height:18px;border-radius:9px;cursor:pointer;transition:background 0.2s;background:' + (plugin.enabled ? 'var(--color-accent)' : 'var(--color-border-2)') + ';flex-shrink:0;';
      var thumb = document.createElement('div');
      thumb.style.cssText = 'position:absolute;top:2px;left:' + (plugin.enabled ? '16px' : '2px') + ';width:14px;height:14px;border-radius:50%;background:#fff;transition:left 0.2s;';
      track.appendChild(thumb);
      track.onclick = function() {
        var newEnabled = !plugin.enabled;
        KanvazBridge.setPluginEnabled(plugin.manifest.id, newEnabled).then(function(result) {
          refreshPluginsList(listContainer);
          if (result && !result.ok) {
            KanvazUI.toast(result.error || 'Could not update this plugin', 'error');
          } else if (newEnabled && typeof KanvazPluginLoader !== 'undefined') {
            KanvazPluginLoader.loadEnabledPlugins();
          } else if (!newEnabled) {
            KanvazUI.toast('Disabled — takes effect after restart', 'success');
          }
        });
      };
      top.appendChild(track);
    }

    row.appendChild(top);

    if (plugin.manifest.author) {
      var authorEl = document.createElement('div');
      authorEl.style.cssText = 'font-size:10px;color:var(--color-text-3);margin-top:2px;';
      authorEl.textContent = 'by ' + plugin.manifest.author;
      row.appendChild(authorEl);
    }

    var removeBtn = document.createElement('button');
    removeBtn.textContent = 'Remove';
    removeBtn.style.cssText = 'margin-top:4px;background:none;border:none;color:var(--color-text-3);font-size:10px;font-family:var(--font-ui);cursor:pointer;padding:0;text-decoration:underline;';
    removeBtn.onclick = function() {
      KanvazUI.showDialog(
        'Remove plugin?',
        'Remove "' + plugin.manifest.name + '"? This deletes its folder from disk.',
        [
          { label: 'Cancel', cls: '' },
          { label: 'Remove', cls: 'danger', action: function() {
            KanvazBridge.removePlugin(plugin.folder, plugin.manifest.id).then(function() {
              refreshPluginsList(listContainer);
            });
          } }
        ]
      );
    };
    row.appendChild(removeBtn);

    return row;
  }

  /* ── Browse Official Plugins (4.4.0) ──
     One deliberate network call (see main.js's catalog-fetch handler —
     same disclosure discipline as Check for Updates), fired only when
     this button is clicked. Overlay built lazily on first open, same
     inline-cssText pattern as the Command Palette / search bar / opacity
     picker rather than a permanent DOM fixture. */
  function showOfficialPluginsBrowser() {
    /* Audit fix: a double-click (or open/close/reopen in quick
       succession, before the previous overlay's own close() finished
       removing it) used to stack a second full-screen overlay on top of
       the first — closing the front one left the first still sitting
       underneath, looking like the dialog didn't actually close, and
       two independent "Install" buttons for the same entry could fire
       concurrently. A fixed id + an early return if one's already open
       is simpler and safer than trying to track open/close state. */
    var existing = document.getElementById('official-plugins-overlay');
    if (existing) return;

    var overlay = document.createElement('div');
    overlay.id = 'official-plugins-overlay';
    overlay.style.cssText = [
      'position:fixed', 'inset:0', 'background:var(--color-overlay)',
      'z-index:60000', 'display:flex', 'align-items:center',
      'justify-content:center'
    ].join(';');
    overlay.onclick = function(e) { if (e.target === overlay) close(); };

    var panel = document.createElement('div');
    panel.style.cssText = [
      'width:420px', 'max-width:90vw', 'max-height:70vh', 'overflow-y:auto',
      'background:var(--color-surface)', 'border:1px solid var(--color-border-2)',
      'border-radius:var(--radius-lg)', 'box-shadow:0 16px 48px var(--color-shadow)',
      'padding:20px', 'animation:about-card-in 0.15s cubic-bezier(0.16,1,0.3,1)'
    ].join(';');
    panel.onclick = function(e) { e.stopPropagation(); };

    var title = document.createElement('div');
    title.style.cssText = 'font-size:14px;font-weight:600;color:var(--color-text);margin-bottom:4px;display:flex;justify-content:space-between;align-items:center;';
    var titleText = document.createElement('span');
    titleText.textContent = 'Official Plugins';
    title.appendChild(titleText);
    var closeX = document.createElement('button');
    closeX.innerHTML = '&times;';
    closeX.style.cssText = 'background:none;border:none;cursor:pointer;color:var(--color-text-3);font-size:16px;padding:0;line-height:1;';
    closeX.onclick = function() { close(); };
    title.appendChild(closeX);
    panel.appendChild(title);

    var sub = document.createElement('div');
    sub.style.cssText = 'font-size:11px;color:var(--color-text-3);margin-bottom:14px;';
    sub.textContent = 'Fetched once, just now, from Kanvaz’s own GitHub repo — the only network call this makes.';
    panel.appendChild(sub);

    var listEl = document.createElement('div');
    listEl.textContent = 'Loading…';
    listEl.style.cssText = 'font-size:12px;color:var(--color-text-3);';
    panel.appendChild(listEl);

    overlay.appendChild(panel);
    document.body.appendChild(overlay);

    function close() {
      if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
    }

    if (typeof KanvazBridge === 'undefined' || !KanvazBridge.fetchOfficialCatalog) {
      listEl.textContent = 'Not available in this build.';
      return;
    }

    KanvazBridge.fetchOfficialCatalog().then(function(result) {
      if (!result || !result.ok) {
        listEl.textContent = 'Could not fetch the catalog' + (result && result.error ? ': ' + result.error : '.');
        return;
      }
      var installedIds = {};
      if (typeof KanvazPluginLoader !== 'undefined') {
        var scanned = KanvazPluginLoader.getLastScanResult() || [];
        for (var s = 0; s < scanned.length; s++) {
          if (scanned[s].valid) installedIds[scanned[s].manifest.id] = true;
        }
      }

      listEl.textContent = '';
      listEl.style.color = '';
      var catalog = result.catalog || [];
      if (!catalog.length) {
        listEl.textContent = 'No official plugins listed right now.';
        return;
      }

      for (var i = 0; i < catalog.length; i++) {
        (function(entry) {
          var row = document.createElement('div');
          row.style.cssText = 'padding:10px 0;border-bottom:1px solid var(--color-border);';

          var top = document.createElement('div');
          top.style.cssText = 'display:flex;align-items:center;justify-content:space-between;gap:8px;';

          var name = document.createElement('div');
          name.style.cssText = 'font-size:12px;color:var(--color-text);font-weight:500;';
          name.textContent = entry.name + ' — v' + entry.version;
          top.appendChild(name);

          var alreadyIn = !!installedIds[entry.id];
          var installBtn = document.createElement('button');
          installBtn.textContent = alreadyIn ? 'Installed' : 'Install';
          installBtn.disabled = alreadyIn;
          installBtn.style.cssText = 'background:' + (alreadyIn ? 'transparent' : 'var(--color-accent-bg)') + ';border:1px solid ' + (alreadyIn ? 'var(--color-border)' : 'var(--color-accent)') + ';border-radius:4px;color:' + (alreadyIn ? 'var(--color-text-3)' : 'var(--color-accent)') + ';padding:3px 10px;font-size:11px;font-family:var(--font-ui);cursor:' + (alreadyIn ? 'default' : 'pointer') + ';flex-shrink:0;';
          if (!alreadyIn) {
            installBtn.onclick = function() {
              installBtn.disabled = true;
              installBtn.textContent = 'Installing…';
              KanvazBridge.installFromCatalog(entry).then(function(res) {
                if (res && res.ok) {
                  installBtn.textContent = 'Installed';
                  KanvazUI.toast(entry.name + ' installed — review & enable it below', 'success');
                  if (currentPluginsListEl) refreshPluginsList(currentPluginsListEl);
                  /* Audit fix: refreshPluginsList() above does its OWN
                     independent KanvazBridge.scanPlugins() call to
                     render the Settings plugin list — it does NOT
                     update KanvazPluginLoader's cached lastScanResult,
                     which is what THIS browser's installedIds map reads
                     from (see below). Without also calling this, a
                     plugin installed just now still shows a clickable
                     "Install" button (inviting a redundant re-download)
                     if the user closes and reopens Browse Official
                     Plugins before enabling anything else in the
                     meantime. */
                  if (typeof KanvazPluginLoader !== 'undefined') KanvazPluginLoader.loadEnabledPlugins();
                } else {
                  installBtn.disabled = false;
                  installBtn.textContent = 'Install';
                  KanvazUI.toast((res && res.error) || 'Install failed', 'error');
                }
              }).catch(function() {
                installBtn.disabled = false;
                installBtn.textContent = 'Install';
                KanvazUI.toast('Install failed', 'error');
              });
            };
          }
          top.appendChild(installBtn);
          row.appendChild(top);

          if (entry.description) {
            var desc = document.createElement('div');
            desc.style.cssText = 'font-size:11px;color:var(--color-text-3);margin-top:3px;line-height:1.4;';
            desc.textContent = entry.description;
            row.appendChild(desc);
          }

          if (entry.permissions && entry.permissions.length) {
            /* Plain permission-string list, not the friendlier prose the
               real consent dialog shows — that prose (describePermissions())
               only exists main-process-side (plugin-loader.js) and is
               generated fresh from the plugin's OWN manifest at approval
               time, never from anything the renderer fetched over the
               network. This is just a heads-up before installing, not a
               substitute for that real consent step, which still happens
               afterward via the normal Review & Enable flow below. */
            var perms = document.createElement('div');
            perms.style.cssText = 'font-size:10px;color:var(--color-text-3);margin-top:3px;';
            perms.textContent = 'Requests: ' + entry.permissions.join(', ');
            row.appendChild(perms);
          }

          listEl.appendChild(row);
        })(catalog[i]);
      }
    }).catch(function(e) {
      listEl.textContent = 'Could not fetch the catalog: ' + e.message;
    });
  }

  /* ── About screen ── */

  /* ── Check for updates ──
     The ONLY network call anywhere in Kanvaz. Fires only when the user
     clicks the button in the About screen — never automatically, never
     on startup. Compares against GitHub's latest release tag. */
  function compareVersions(a, b) {
    var pa = a.replace(/^v/i, '').split('.').map(Number);
    var pb = b.replace(/^v/i, '').split('.').map(Number);
    for (var i = 0; i < Math.max(pa.length, pb.length); i++) {
      var na = pa[i] || 0, nb = pb[i] || 0;
      if (na !== nb) return na - nb;
    }
    return 0;
  }

  function checkForUpdates(btn) {
    var status = document.getElementById('about-update-status');
    if (!status) return;
    if (btn) btn.disabled = true;
    status.style.color = 'var(--color-text-3)';
    status.textContent = 'Checking…';

    /* Packaged builds only: this is the one place that kicks off the
       real download (electron-updater, main process) — same click,
       same "only when you click this" promise as the GitHub check
       below. If a newer build is found it downloads in the background
       and a "Restart & Install" prompt shows up when it's ready
       (see app.js's 'update-downloaded' handling). */
    if (typeof KanvazBridge !== 'undefined' && KanvazBridge.checkForUpdates) {
      KanvazBridge.checkForUpdates();
    }

    var currentVersion = (typeof KanvazBoards !== 'undefined' && KanvazBoards.getVersion)
      ? KanvazBoards.getVersion() : '0.0.0';

    /* fetch() never times out on its own — without this, a hanging
       connection (captive portal, flaky wifi) would leave the button
       disabled and "Checking…" on screen indefinitely. */
    var controller = (typeof AbortController !== 'undefined') ? new AbortController() : null;
    var timeoutId = controller ? setTimeout(function() { controller.abort(); }, 8000) : null;

    fetch('https://api.github.com/repos/p4inz-code/kanvaz/releases/latest',
          controller ? { signal: controller.signal } : {})
      .then(function(res) {
        if (timeoutId) clearTimeout(timeoutId);
        if (res.status === 403) {
          var resetHeader = res.headers.get('X-RateLimit-Reset');
          var resetMsg = 'GitHub rate-limited this check';
          if (resetHeader) {
            var resetDate = new Date(parseInt(resetHeader, 10) * 1000);
            resetMsg += ' — try again after ' + resetDate.toLocaleTimeString();
          } else {
            resetMsg += ' — try again in a few minutes';
          }
          var err = new Error(resetMsg);
          err.isRateLimit = true;
          throw err;
        }
        if (res.status === 404) throw new Error('Release info not found on GitHub');
        if (!res.ok) throw new Error('GitHub returned ' + res.status);
        return res.json();
      })
      .then(function(data) {
        var latest = (data.tag_name || '').replace(/^v/i, '');
        if (!latest) throw new Error('No release tag found');
        var cmp = compareVersions(latest, currentVersion);
        if (cmp > 0) {
          status.style.color = 'var(--color-accent)';
          status.textContent = '';

          /* Built via DOM APIs rather than innerHTML — `latest` comes
             from the GitHub API response, and even though it's our own
             repo's release feed, untrusted-network-data should never
             be concatenated into innerHTML. */
          status.appendChild(document.createTextNode('v' + latest + ' is available — '));
          var link = document.createElement('a');
          link.href = '#';
          link.id = 'about-update-link';
          link.style.color = 'var(--color-accent)';
          link.style.textDecoration = 'underline';
          link.textContent = 'view release';
          link.onclick = function(e) {
            e.preventDefault();
            if (typeof KanvazBridge !== 'undefined' && KanvazBridge.openExternal) {
              KanvazBridge.openExternal(data.html_url || 'https://github.com/p4inz-code/kanvaz/releases/latest');
            }
          };
          status.appendChild(link);
        } else {
          status.style.color = 'var(--color-text-3)';
          status.textContent = "You're up to date (v" + currentVersion + ')';
        }
      })
      .catch(function(err) {
        status.style.color = 'var(--color-text-3)';
        if (err && err.name === 'AbortError') {
          status.textContent = 'Timed out — check your connection and try again';
        } else if (err && err.isRateLimit) {
          status.textContent = err.message;
        } else {
          status.textContent = "Couldn't check — no internet, or GitHub unreachable";
        }
      })
      .then(function() {
        if (btn) btn.disabled = false;
      });
  }

  function showAbout() {
    var existing = document.getElementById('about-screen');
    if (existing) { existing.parentNode.removeChild(existing); return; }

    var overlay = document.createElement('div');
    overlay.id = 'about-screen';
    overlay.className = 'modal-overlay';

    var box = document.createElement('div');
    box.className = 'about-card';

    box.innerHTML = [
      '<div class="about-logo">',
        '<img src="../assets/icons/icon-128.png" alt="" width="44" height="44">',
      '</div>',
      '<div class="about-title">Kanvaz</div>',
      '<div class="about-subtitle">A visual reference workspace for creative professionals.</div>',
      '<div class="about-version">Version 4.5.0</div>',
      '<div id="about-update-status" class="about-update-status"></div>',
      '<div class="about-divider"></div>',
      '<div class="about-author">Developed by <strong>Atharva Patil</strong></div>',
      '<div class="about-studio">Northbyte Studios — Navi Mumbai, India</div>',
      '<div class="about-desc">Built for VFX and 3D artists,<br>and the studios and educators who rely on them.</div>',
      '<div class="about-divider"></div>',
      '<div class="about-privacy">Free and open source. MIT License.<br>No telemetry, no background network activity.<br>Your data stays on your machine.</div>',
      '<div class="about-tagline">Reference Operating System<br>Actively maintained — v4.5.0</div>'
    ].join('');

    var updateBtn = document.createElement('button');
    updateBtn.className = 'about-btn about-btn-update';
    updateBtn.textContent = 'Check for updates';
    updateBtn.title = 'Checks GitHub for a newer release — the only network activity Kanvaz ever does, and only when you click this.';
    updateBtn.onclick = function() { checkForUpdates(updateBtn); };
    box.appendChild(updateBtn);

    var closeBtn = document.createElement('button');
    closeBtn.className = 'about-btn about-btn-close';
    closeBtn.textContent = 'Close';
    closeBtn.onclick = function() {
      if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
    };
    box.appendChild(closeBtn);

    overlay.appendChild(box);
    document.body.appendChild(overlay);

    overlay.onclick = function(e) {
      if (e.target === overlay) overlay.parentNode.removeChild(overlay);
    };
  }

  /* ── Shortcuts overlay ── */

  function showShortcuts() {
    var existing = document.getElementById('shortcuts-overlay');
    if (existing) { existing.parentNode.removeChild(existing); return; }

    var overlay = document.createElement('div');
    overlay.id = 'shortcuts-overlay';
    overlay.style.cssText = [
      'position:fixed',
      'inset:0',
      'background:var(--color-overlay)',
      'z-index:60000',
      'display:flex',
      'align-items:center',
      'justify-content:center',
      /* Polish fix: matches the same modal-overlay-in fade every other
         full-screen overlay (About, Dialog) now uses, instead of
         popping in instantly. */
      'animation:modal-overlay-in 0.15s ease-out'
    ].join(';');

    var box = document.createElement('div');
    box.style.cssText = [
      'background:var(--color-surface)',
      'border:1px solid var(--color-border-2)',
      /* Polish fix: was a one-off 12px — every other floating panel/
         modal in the app now standardizes on --radius-lg (10px). */
      'border-radius:var(--radius-lg)',
      'padding:24px 28px',
      'width:480px',
      'max-height:80vh',
      'overflow-y:auto',
      'box-shadow:0 16px 48px var(--color-shadow)',
      'animation:about-card-in 0.2s cubic-bezier(0.16,1,0.3,1)'
    ].join(';');

    var title = document.createElement('div');
    title.style.cssText = 'font-size:15px;font-weight:600;color:var(--color-text);margin-bottom:16px;';
    title.textContent = 'Keyboard shortcuts';
    box.appendChild(title);

    var groups = [
      {
        name: 'Canvas',
        items: [
          ['Scroll',           'Zoom in / out'],
          ['Ctrl + Scroll',    'Fine zoom'],
          ['Middle mouse',     'Pan'],
          ['Space + drag',     'Pan'],
          ['0',                'Reset zoom'],
          ['+ / -',            'Zoom step'],
          ['F',                'Fit all cards'],
          /* Audit fix: this row used to unconditionally say "New note",
             but doubleClickCreatesNote defaults to false (see settings
             default above) — for most users double-clicking the canvas
             does nothing, so an unqualified claim here is actively
             wrong for the common case. */
          ['Dbl-click canvas', 'New note (if enabled in Settings)'],
          ['Ctrl+F or /',      'Search']
        ]
      },
      {
        name: 'Cards',
        items: [
          ['Click',      'Select card'],
          ['Ctrl+A',     'Select all'],
          ['Drag',       'Move card'],
          ['Arrow keys', 'Nudge 1px'],
          ['Shift+Arrow','Nudge 10px'],
          ['Delete',     'Delete card'],
          ['Ctrl+D',     'Duplicate'],
          ['P',          'Pin / unpin'],
          ['A',          'Annotate'],
          ['H',          'Hide annotations'],
          ['C',          'Connections'],
          ['E',          'Properties']
        ]
      },
      {
        name: 'File',
        items: [
          ['Ctrl+S',       'Save board'],
          ['Ctrl+Shift+S', 'Save as'],
          ['Ctrl+O',       'Open board'],
          ['Ctrl+Z',       'Undo'],
          ['Ctrl+Y',       'Redo']
        ]
      },
      {
        name: 'View',
        items: [
          ['M',           'Board \u2194 Map view'],
          ['L',           'Light \u2194 Dark theme'],
          ['T',           'Always on top'],
          ['Tab',         'Top Mode (also Ctrl+Shift+F)'],
          ['S',           'Settings'],
          ['I',           'About'],
          ['?',           'This screen'],
          ['Esc',         'Deselect / close']
        ]
      }
    ];

    var cols = document.createElement('div');
    cols.style.cssText = 'display:grid;grid-template-columns:1fr 1fr 1fr;gap:16px 24px;';

    for (var g = 0; g < groups.length; g++) {
      var group = groups[g];
      var col = document.createElement('div');

      var groupTitle = document.createElement('div');
      groupTitle.style.cssText = 'font-size:11px;color:var(--color-text-3);text-transform:uppercase;letter-spacing:0.06em;margin-bottom:8px;';
      groupTitle.textContent = group.name;
      col.appendChild(groupTitle);

      for (var r = 0; r < group.items.length; r++) {
        var row = document.createElement('div');
        row.style.cssText = 'display:flex;justify-content:space-between;align-items:center;padding:4px 0;border-bottom:1px solid var(--color-border);gap:8px;';

        var keyEl = document.createElement('span');
        keyEl.style.cssText = 'font-family:var(--font-mono);font-size:11px;color:var(--color-text-2);background:var(--color-surface-2);border:1px solid var(--color-border-2);border-radius:3px;padding:1px 5px;white-space:nowrap;flex-shrink:0;';
        keyEl.textContent = group.items[r][0];

        var descEl = document.createElement('span');
        descEl.style.cssText = 'font-size:12px;color:var(--color-text-3);text-align:right;';
        descEl.textContent = group.items[r][1];

        row.appendChild(keyEl);
        row.appendChild(descEl);
        col.appendChild(row);
      }

      cols.appendChild(col);
    }

    box.appendChild(cols);

    var closeBtn = document.createElement('button');
    closeBtn.textContent = 'Close';
    closeBtn.style.cssText = 'margin-top:20px;padding:7px 20px;background:var(--color-surface-2);border:1px solid var(--color-border-2);border-radius:6px;color:var(--color-text-2);font-family:var(--font-ui);font-size:12px;cursor:pointer;display:block;margin-left:auto;';
    closeBtn.onclick = function() {
      if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
    };
    box.appendChild(closeBtn);

    overlay.appendChild(box);
    document.body.appendChild(overlay);

    overlay.onclick = function(e) {
      if (e.target === overlay && overlay.parentNode) overlay.parentNode.removeChild(overlay);
    };
  }

  /* ── First run welcome ── */

  function showFirstRunIfNeeded() {
    KanvazBridge.firstRunCheck().then(function(result) {
      if (!result || result.done) return;
      doShowFirstRun();
    }).catch(function(e) {
      console.warn('[Kanvaz] firstRunCheck IPC failed:', e);
    });
  }

  function doShowFirstRun() {

    var overlay = document.createElement('div');
    overlay.id = 'first-run';
    overlay.style.cssText = [
      'position:fixed',
      'inset:0',
      /* Polish fix: was a bespoke near-opaque rgba() unique to this one
         screen, not even matching --color-overlay's alpha model. This
         is a new user's very first impression of the app — it should
         look like it belongs to the same design system as every other
         overlay, not a one-off. */
      'background:var(--color-overlay)',
      'z-index:99999',
      'display:flex',
      'align-items:center',
      'justify-content:center',
      'animation:modal-overlay-in 0.15s ease-out'
    ].join(';');

    var box = document.createElement('div');
    box.style.cssText = [
      'background:var(--color-surface)',
      'border:1px solid var(--color-border-2)',
      'border-radius:var(--radius-lg)',
      'padding:36px 32px',
      'width:360px',
      'text-align:center',
      'box-shadow:0 24px 64px var(--color-shadow)',
      'animation:about-card-in 0.2s cubic-bezier(0.16,1,0.3,1)'
    ].join(';');

    /* Audit fix: this tip used to unconditionally say "Double-click /
       Create a sticky note anywhere on the canvas" — but
       doubleClickCreatesNote defaults to false (see ui.js settings
       schema), so a brand-new user following this exact first-run tip
       would double-click and see nothing happen. Mirror the same
       settings-aware branching already used for the empty-canvas hint
       text above, so first-run only ever describes what will actually
       occur. */
    var firstRunSettings = (typeof KanvazUI_Extended !== 'undefined' && KanvazUI_Extended.getSettings) ? KanvazUI_Extended.getSettings() : null;
    var secondTipRow = (firstRunSettings && firstRunSettings.doubleClickCreatesNote)
      ? '<div><div style="font-size:13px;color:var(--color-text);margin-bottom:2px;">Double-click</div><div style="font-size:12px;color:var(--color-text-3);">Create a sticky note anywhere on the canvas</div></div>'
      : '<div><div style="font-size:13px;color:var(--color-text);margin-bottom:2px;">Right-click</div><div style="font-size:12px;color:var(--color-text-3);">Open the canvas menu to add a note or reference</div></div>';

    box.innerHTML = [
      '<svg width="52" height="52" viewBox="0 0 18 18" fill="none" style="margin-bottom:16px;">',
        '<rect x="2" y="6" width="12" height="9" rx="2" fill="#2A2A35"/>',
        '<rect x="3" y="4" width="12" height="9" rx="2" fill="#1A1A22" stroke="#2E2E3A" stroke-width="0.5"/>',
        '<rect x="4" y="2" width="12" height="9" rx="2" fill="#DCDCE8"/>',
        '<circle cx="14" cy="3" r="2" fill="#4A9EFF"/>',
      '</svg>',
      '<div style="font-size:24px;font-weight:700;color:var(--color-text);margin-bottom:6px;">Welcome to Kanvaz</div>',
      '<div style="font-size:14px;color:var(--color-text-3);margin-bottom:28px;line-height:1.6;">Collect, connect, and understand your references — all offline.</div>',
      '<div style="text-align:left;margin-bottom:24px;">',
        /* Polish fix: the drop/double-click tip icons were raw Unicode
           glyphs (⬇, ✱) standing in front of what's otherwise an
           all-vector, hand-drawn stroke-icon UI (see index.html's
           toolbar icons — stroke-width:1.5, currentColor). Replaced
           with small SVGs in that same convention so first-run doesn't
           visually clash with the rest of the app. "?" in the third
           tip is left as literal text since it names the actual key to
           press, not a decorative stand-in. */
        '<div style="display:flex;gap:12px;align-items:flex-start;margin-bottom:14px;">',
          '<div style="width:28px;height:28px;border-radius:6px;background:var(--color-accent-bg);border:1px solid var(--color-accent);display:flex;align-items:center;justify-content:center;flex-shrink:0;color:var(--color-accent);"><svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M7 1v7M4 5l3 3 3-3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M2 10v1.5A1.5 1.5 0 003.5 13h7A1.5 1.5 0 0012 11.5V10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg></div>',
          '<div><div style="font-size:13px;color:var(--color-text);margin-bottom:2px;">Drop any file</div><div style="font-size:12px;color:var(--color-text-3);">Images, GIFs, and videos land right on the canvas</div></div>',
        '</div>',
        '<div style="display:flex;gap:12px;align-items:flex-start;margin-bottom:14px;">',
          '<div style="width:28px;height:28px;border-radius:6px;background:var(--color-surface-2);border:1px solid var(--color-border);display:flex;align-items:center;justify-content:center;flex-shrink:0;color:var(--color-text-2);"><svg width="14" height="14" viewBox="0 0 14 14" fill="none"><circle cx="7" cy="7" r="2.75" stroke="currentColor" stroke-width="1.5"/><circle cx="7" cy="7" r="6" stroke="currentColor" stroke-width="1.2" opacity="0.4"/></svg></div>',
          secondTipRow,
        '</div>',
        '<div style="display:flex;gap:12px;align-items:flex-start;">',
          '<div style="width:28px;height:28px;border-radius:6px;background:var(--color-surface-2);border:1px solid var(--color-border);display:flex;align-items:center;justify-content:center;flex-shrink:0;font-size:14px;">?</div>',
          '<div><div style="font-size:13px;color:var(--color-text);margin-bottom:2px;">Press ? anytime</div><div style="font-size:12px;color:var(--color-text-3);">Opens the full keyboard shortcuts list</div></div>',
        '</div>',
      '</div>'
    ].join('');

    var startBtn = document.createElement('button');
    startBtn.textContent = 'Start using Kanvaz';
    startBtn.style.cssText = 'width:100%;padding:11px;background:var(--color-accent);border:none;border-radius:8px;color:#fff;font-family:var(--font-ui);font-size:14px;font-weight:600;cursor:pointer;transition:background 0.1s;';
    startBtn.onmouseenter = function() { startBtn.style.background = 'var(--color-accent-dim)'; };
    startBtn.onmouseleave = function() { startBtn.style.background = 'var(--color-accent)'; };
    startBtn.onclick = function() {
      if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
    };
    box.appendChild(startBtn);

    overlay.appendChild(box);
    document.body.appendChild(overlay);
  }

  /* ── Init ── */

  function init() {
    loadSettings();
    initMinimap();
    showFirstRunIfNeeded();

    /* Plugins (4.2.0): re-scan whenever the window regains focus, so a
       plugin folder dropped in via "Add a Plugin…" is picked up as soon
       as the user tabs back — only does anything if the Plugins section
       is actually on screen right now. */
    window.addEventListener('focus', function() {
      if (settingsOpen && currentPluginsListEl) {
        refreshPluginsList(currentPluginsListEl);
      }
    });

    /* A plugin (e.g. Theme Creator) can register a new theme after
       Settings has already been built once — rebuild the panel so its
       Theme dropdown picks up the addition, rather than requiring the
       user to close and reopen Settings themselves.

       Audit fix: registerTheme()'s own "__"-prefixed-id convention marks
       an id as an internal/ephemeral live-preview draft (see plugin-api.js's
       getAllThemes(), which already filters these out of anything user-
       facing) — but this listener didn't check e.detail.id before
       reacting, even though the CustomEvent carries it. A live color-
       picker preview (exactly the pattern that convention exists for —
       see the Theme Creator plugin) calls registerTheme('__draft__', ...)
       on every slider tick; each one fully closed and rebuilt Settings,
       destroying any open dropdown/native color picker and discarding
       whatever the user was mid-typing in an unrelated field. Only real,
       user-facing theme registrations should trigger a rebuild. */
    document.addEventListener('kanvaz-theme-registered', function(e) {
      var id = e && e.detail && e.detail.id;
      if (id && id.indexOf('__') === 0) return;
      if (settingsOpen) {
        closeSettings();
        showSettings();
      }
    });
  }

  return {
    init:           init,
    showSettings:   showSettings,
    closeSettings:  closeSettings,
    showAbout:      showAbout,
    showShortcuts:  showShortcuts,
    loadSettings:   loadSettings,
    getSettings:    function() { return settings; },
    /* Narrow, deliberate setter for plugins (e.g. Theme Creator) that
       need to change the active theme and have it persist + apply
       through the exact same path the Settings dropdown itself uses —
       not a generic "set any setting" hook, just this one field. */
    setTheme: function(themeId) {
      settings.theme = themeId;
      saveSettings();
    },
    /* Generic settings patch (4.5.0, MCP Bridge) — whitelisted against
       SETTINGS_DEFAULTS (never `_version`, that's internal migration
       bookkeeping, not a user-facing setting) so an unknown or
       plugin-management-adjacent key can't sneak in even if a caller
       tried. `theme` needs no special-casing despite setTheme()
       existing above it — that function is just `settings.theme = x;
       saveSettings()`, and applySettings() (called by saveSettings())
       already re-applies whatever settings.theme currently holds via
       KanvazPluginAPI._applyTheme() every time it runs, regardless of
       which code path set that field. One saveSettings() call at the
       end batches every changed field into a single persist + apply,
       not one per field. Returns which keys were actually applied vs.
       ignored, so a caller can tell a typo'd key from a real failure. */
    updateSettings: function(patch) {
      if (!patch || typeof patch !== 'object') return { ok: false, error: 'patch must be an object' };
      var applied = [];
      var ignored = [];
      for (var key in patch) {
        if (!Object.prototype.hasOwnProperty.call(patch, key)) continue;
        if (key === '_version' || !SETTINGS_DEFAULTS.hasOwnProperty(key)) { ignored.push(key); continue; }
        settings[key] = patch[key];
        applied.push(key);
      }
      if (applied.length) saveSettings();
      return { ok: true, applied: applied, ignored: ignored };
    }
  };

})();
