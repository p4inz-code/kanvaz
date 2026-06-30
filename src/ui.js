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
      var wx    = mx * WORLD - vp.width  / 2;
      var wy    = my * WORLD - vp.height / 2;
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

    ctx.strokeStyle = '#4A9EFF';
    ctx.lineWidth   = 1;
    ctx.strokeRect(vx, vy, vw, vh);
  }

  /* ── Settings panel ── */

  var settingsOpen = false;

  var SETTINGS_DEFAULTS = {
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
    leftDragPan:      true
  };

  var settings = {};

  function loadSettings() {
    settings = JSON.parse(JSON.stringify(SETTINGS_DEFAULTS));
    applySettings();
    /* Load from userData via IPC */
    KanvazBridge.readSettings().then(function(result) {
      if (result && result.ok && result.data) {
        try {
          var loaded = JSON.parse(result.data);
          for (var k in loaded) {
            if (SETTINGS_DEFAULTS.hasOwnProperty(k)) settings[k] = loaded[k];
          }
          applySettings();
        } catch (e) {
          console.warn('[Kanvaz] Failed to parse settings, using defaults:', e.message);
        }
      }
    });
  }

  function saveSettings() {
    KanvazBridge.writeSettings(JSON.stringify(settings)).then(function() {});
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

    /* Restart autosave timer with current interval setting */
    if (typeof KanvazBoards !== 'undefined' && KanvazBoards.startAutosave) {
      KanvazBoards.startAutosave();
    }
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
      'background:var(--color-surface)',
      'border:1px solid var(--color-border-2)',
      'border-radius:10px',
      'padding:16px',
      'z-index:9000',
      'box-shadow:0 8px 32px rgba(0,0,0,0.6)',
      'font-size:13px'
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

    var rows = [
      { key: 'showMinimap',     label: 'Show minimap',          type: 'toggle' },
      { key: 'dotGridVisible',  label: 'Dot grid',              type: 'toggle' },
      { key: 'cardShadows',     label: 'Card shadows',          type: 'toggle' },
      { key: 'animationsOn',    label: 'Animations',            type: 'toggle' },
      { key: 'openOnStartup',   label: 'Show recent on startup',type: 'toggle' },
      { key: 'confirmDelete',   label: 'Confirm before delete', type: 'toggle' },
      { key: 'leftDragPan',     label: 'Left-drag empty canvas to pan', type: 'toggle' },
      { key: 'doubleClickCreatesNote', label: 'Double-click canvas creates note', type: 'toggle' },
      { key: 'autosaveInterval',label: 'Autosave (seconds)',    type: 'number', min: 10, max: 300 },
      { key: 'defaultCardW',    label: 'Default card width (px)',type: 'number', min: 80, max: 1200 }
    ];

    for (var i = 0; i < rows.length; i++) {
      (function(row) {
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
        }

        panel.appendChild(el);
      })(rows[i]);
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
  }

  function closeSettings() {
    settingsOpen = false;
    var el = document.getElementById('settings-panel');
    if (el && el.parentNode) el.parentNode.removeChild(el);
  }

  /* ── About screen ── */

  function showAbout() {
    var overlay = document.createElement('div');
    overlay.id = 'about-screen';
    overlay.style.cssText = [
      'position:fixed',
      'inset:0',
      'background:rgba(0,0,0,0.65)',
      'z-index:60000',
      'display:flex',
      'align-items:center',
      'justify-content:center'
    ].join(';');

    var box = document.createElement('div');
    box.style.cssText = [
      'background:var(--color-surface)',
      'border:1px solid var(--color-border-2)',
      'border-radius:12px',
      'padding:32px 28px',
      'width:320px',
      'text-align:center',
      'box-shadow:0 16px 48px rgba(0,0,0,0.7)'
    ].join(';');

    box.innerHTML = [
      '<svg width="40" height="40" viewBox="0 0 18 18" fill="none" style="margin-bottom:12px;">',
        '<rect x="2" y="6" width="12" height="9" rx="2" fill="#2A2A35"/>',
        '<rect x="3" y="4" width="12" height="9" rx="2" fill="#1A1A22" stroke="#2E2E3A" stroke-width="0.5"/>',
        '<rect x="4" y="2" width="12" height="9" rx="2" fill="#DCDCE8"/>',
        '<circle cx="14" cy="3" r="2" fill="#4A9EFF"/>',
      '</svg>',
      '<div style="font-size:22px;font-weight:700;color:var(--color-text);margin-bottom:4px;">Kanvaz</div>',
      '<div style="font-size:13px;color:var(--color-text-3);margin-bottom:20px;">Your canvas. Your references.</div>',
      '<div style="font-size:12px;color:var(--color-text-3);margin-bottom:16px;font-family:var(--font-mono);">Version 3.4.0</div>',
      '<div style="font-size:13px;color:var(--color-text-2);margin-bottom:6px;">Made by <span style="color:var(--color-text);">Atharva Patil</span> — Northbyte Studios</div>',
      '<div style="font-size:12px;color:var(--color-text-3);margin-bottom:20px;">Navi Mumbai, India</div>',
      '<div style="font-size:12px;color:var(--color-text-3);line-height:1.7;margin-bottom:20px;">Built for VFX artists, 3D artists,<br>and the people who teach them.</div>',
      '<div style="font-size:11px;color:var(--color-text-3);line-height:1.8;margin-bottom:16px;">Free forever. MIT License.<br>No telemetry. No internet.<br>Your files never leave your machine.</div>',
      '<div style="font-size:11px;color:var(--color-accent);line-height:1.7;margin-bottom:24px;">Reference Operating System<br>Actively developed — v3.4.0</div>'
    ].join('');

    var closeBtn = document.createElement('button');
    closeBtn.textContent = 'Close';
    closeBtn.style.cssText = 'padding:8px 24px;background:var(--color-surface-2);border:1px solid var(--color-border-2);border-radius:6px;color:var(--color-text-2);font-family:var(--font-ui);font-size:13px;cursor:pointer;';
    closeBtn.onmouseenter = function() { closeBtn.style.background = 'var(--color-surface-3)'; };
    closeBtn.onmouseleave = function() { closeBtn.style.background = 'var(--color-surface-2)'; };
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
      'background:rgba(0,0,0,0.65)',
      'z-index:60000',
      'display:flex',
      'align-items:center',
      'justify-content:center'
    ].join(';');

    var box = document.createElement('div');
    box.style.cssText = [
      'background:var(--color-surface)',
      'border:1px solid var(--color-border-2)',
      'border-radius:12px',
      'padding:24px 28px',
      'width:480px',
      'max-height:80vh',
      'overflow-y:auto',
      'box-shadow:0 16px 48px rgba(0,0,0,0.7)'
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
          ['Dbl-click canvas', 'New note']
        ]
      },
      {
        name: 'Cards',
        items: [
          ['Click',     'Select card'],
          ['Drag',      'Move card'],
          ['Delete',    'Delete card'],
          ['Ctrl+D',    'Duplicate'],
          ['P',         'Pin / unpin'],
          ['H',         'Hide annotations'],
          ['Arrow keys','Nudge 1px'],
          ['Shift+Arrow','Nudge 10px']
        ]
      },
      {
        name: 'File',
        items: [
          ['Ctrl+S', 'Save board'],
          ['Ctrl+O', 'Open board'],
          ['Ctrl+Z', 'Undo'],
          ['Ctrl+Y', 'Redo']
        ]
      },
      {
        name: 'View',
        items: [
          ['T',           'Always on top'],
          ['Ctrl+Shift+F','Mood lock'],
          ['?',           'This screen'],
          ['Esc',         'Deselect / close']
        ]
      }
    ];

    var cols = document.createElement('div');
    cols.style.cssText = 'display:grid;grid-template-columns:1fr 1fr;gap:16px 24px;';

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
    });
  }

  function doShowFirstRun() {

    var overlay = document.createElement('div');
    overlay.id = 'first-run';
    overlay.style.cssText = [
      'position:fixed',
      'inset:0',
      'background:rgba(14,14,16,0.94)',
      'z-index:99999',
      'display:flex',
      'align-items:center',
      'justify-content:center'
    ].join(';');

    var box = document.createElement('div');
    box.style.cssText = [
      'background:var(--color-surface)',
      'border:1px solid var(--color-border-2)',
      'border-radius:14px',
      'padding:36px 32px',
      'width:360px',
      'text-align:center',
      'box-shadow:0 24px 64px rgba(0,0,0,0.8)'
    ].join(';');

    box.innerHTML = [
      '<svg width="52" height="52" viewBox="0 0 18 18" fill="none" style="margin-bottom:16px;">',
        '<rect x="2" y="6" width="12" height="9" rx="2" fill="#2A2A35"/>',
        '<rect x="3" y="4" width="12" height="9" rx="2" fill="#1A1A22" stroke="#2E2E3A" stroke-width="0.5"/>',
        '<rect x="4" y="2" width="12" height="9" rx="2" fill="#DCDCE8"/>',
        '<circle cx="14" cy="3" r="2" fill="#4A9EFF"/>',
      '</svg>',
      '<div style="font-size:24px;font-weight:700;color:var(--color-text);margin-bottom:6px;">Welcome to Kanvaz</div>',
      '<div style="font-size:14px;color:var(--color-text-3);margin-bottom:28px;line-height:1.6;">Your infinite canvas for VFX references, mood boards, and creative notes.</div>',
      '<div style="text-align:left;margin-bottom:24px;">',
        '<div style="display:flex;gap:12px;align-items:flex-start;margin-bottom:14px;">',
          '<div style="width:28px;height:28px;border-radius:6px;background:var(--color-accent-bg);border:1px solid var(--color-accent);display:flex;align-items:center;justify-content:center;flex-shrink:0;font-size:14px;">⬇</div>',
          '<div><div style="font-size:13px;color:var(--color-text);margin-bottom:2px;">Drop any file</div><div style="font-size:12px;color:var(--color-text-3);">Images, GIFs, and videos land right on the canvas</div></div>',
        '</div>',
        '<div style="display:flex;gap:12px;align-items:flex-start;margin-bottom:14px;">',
          '<div style="width:28px;height:28px;border-radius:6px;background:var(--color-surface-2);border:1px solid var(--color-border);display:flex;align-items:center;justify-content:center;flex-shrink:0;font-size:14px;">✱</div>',
          '<div><div style="font-size:13px;color:var(--color-text);margin-bottom:2px;">Double-click</div><div style="font-size:12px;color:var(--color-text-3);">Create a sticky note anywhere on the canvas</div></div>',
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
  }

  return {
    init:           init,
    showSettings:   showSettings,
    closeSettings:  closeSettings,
    showAbout:      showAbout,
    showShortcuts:  showShortcuts,
    loadSettings:   loadSettings,
    getSettings:    function() { return settings; }
  };

})();
