/* canvas.js — infinite canvas engine */

var KanvazCanvas = (function() {

  /* ── State ── */
  var container = null;
  var world = null;
  var gridCanvas = null;
  var gridCtx = null;

  var tx = 0;   /* translate X */
  var ty = 0;   /* translate Y */
  var scale = 1.0;

  var ZOOM_MIN  = 0.08;
  var ZOOM_MAX  = 5.0;
  /* Audit fix: zoom used to be additive (scale +/- a flat 0.10), which
     makes the perceptual step wildly non-uniform — enormous near
     ZOOM_MIN (0.18->0.08 halves the board in one notch), invisible near
     ZOOM_MAX (4.9->5.0 is 2%). It also meant zoom-in and zoom-out
     weren't exact inverses once either clamp was touched, so 100% could
     become permanently unreachable (18, 28, ... 98, 108% and never
     exactly 100 again). Multiplicative factors fix both: scale*FACTOR
     and scale/FACTOR are always exact inverses, and the perceptual step
     stays constant across the whole range. */
  var ZOOM_FACTOR      = 1.1;
  var ZOOM_FACTOR_FINE = 1.02;

  var isPanning = false;
  var panMoved = false;
  var panStartX = 0;
  var panStartY = 0;
  var panOriginX = 0;
  var panOriginY = 0;

  var spaceDown = false;

  /* Marquee (rubber-band) multi-select — Ctrl+left-drag on empty canvas,
     or a plain left-drag while "V" mode is toggled on (V has no other
     meaning in Kanvaz; there's no persistent per-tool mode elsewhere in
     the app, so this is a lightweight momentary/toggle affordance, not
     a full tool-switching system). */
  var marqueeModeOn = false;
  var isMarqueeSelecting = false;
  var marqueeStartX = 0;
  var marqueeStartY = 0;
  var marqueeEl = null;

  /* ── Init ── */

  function init(containerEl, worldEl, gridEl) {
    container = containerEl;
    world = worldEl;
    gridCanvas = gridEl;
    gridCtx = gridEl.getContext('2d');

    bindEvents();
    resizeGrid();
    drawGrid();
    applyTransform();

    window.addEventListener('resize', function() {
      resizeGrid();
      drawGrid();
    });

    new MutationObserver(function() {
      cachedAccentRgb = null;
      drawGrid();
    }).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  }

  /* Safe-clamp tx/ty to prevent CSS transform overflow.
     Chromium can handle transforms up to ~16 million px but
     going past ~5 million causes jank. Also guard NaN/Infinity. */
  var TX_LIMIT = 5000000;

  function clampTranslate() {
    if (isNaN(tx) || !isFinite(tx)) tx = 0;
    if (isNaN(ty) || !isFinite(ty)) ty = 0;
    if (isNaN(scale) || !isFinite(scale) || scale <= 0) scale = 1.0;
    if (tx > TX_LIMIT)  tx = TX_LIMIT;
    if (tx < -TX_LIMIT) tx = -TX_LIMIT;
    if (ty > TX_LIMIT)  ty = TX_LIMIT;
    if (ty < -TX_LIMIT) ty = -TX_LIMIT;
  }

  var gridRafId = null;

  /* Accent-tinted major grid lines, cached — same 1x1-canvas-readback
     technique getMarqueeFillColor() already uses to turn an arbitrary
     CSS color string into RGB components without a color-parsing
     library. Cached because drawGrid() runs every animation frame
     during pan/zoom; invalidated via a MutationObserver on data-theme
     rather than chasing every place that attribute gets set (built-in
     theme toggle in three separate files, plus any plugin-authored
     theme) — one central invalidation point that can't miss a caller. */
  var cachedAccentRgb = null;

  function getAccentRgb() {
    if (cachedAccentRgb) return cachedAccentRgb;
    var accent = getComputedStyle(document.documentElement).getPropertyValue('--color-accent').trim();
    var c = document.createElement('canvas');
    c.width = 1; c.height = 1;
    var ctx = c.getContext('2d');
    ctx.fillStyle = accent || '#7C5CFC';
    ctx.fillRect(0, 0, 1, 1);
    var d = ctx.getImageData(0, 0, 1, 1).data;
    cachedAccentRgb = d[0] + ',' + d[1] + ',' + d[2];
    return cachedAccentRgb;
  }

  /* ── Transform ── */

  function applyTransform() {
    clampTranslate();
    world.style.transform = 'translate(' + tx + 'px, ' + ty + 'px) scale(' + scale + ')';

    /* Throttle grid redraws — one per animation frame */
    if (!gridRafId) {
      gridRafId = requestAnimationFrame(function() {
        gridRafId = null;
        drawGrid();
      });
    }
    updateStatusBar();
    updateZoomBtn();
  }

  function updateZoomBtn() {
    var btn = document.getElementById('zoom-display');
    if (btn) btn.textContent = Math.round(scale * 100) + '%';
  }

  function setZoom(newScale, pivotX, pivotY) {
    if (pivotX === undefined) {
      pivotX = container.clientWidth / 2;
      pivotY = container.clientHeight / 2;
    }

    var clampedScale = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, newScale));
    var ratio = clampedScale / scale;

    tx = pivotX - ratio * (pivotX - tx);
    ty = pivotY - ratio * (pivotY - ty);
    scale = clampedScale;

    applyTransform();
  }

  function zoomIn(pivotX, pivotY) {
    setZoom(scale * ZOOM_FACTOR, pivotX, pivotY);
  }

  function zoomOut(pivotX, pivotY) {
    setZoom(scale / ZOOM_FACTOR, pivotX, pivotY);
  }

  function zoomReset() {
    tx = 0;
    ty = 0;
    scale = 1.0;
    applyTransform();
  }

  /* onlyIds (4.9.0, optional) — restrict the fitted bounding box to just
     these card ids instead of every card on the board. zoomToSelection()
     below is the only caller that passes it; every existing call site
     (keyboard shortcut, toolbar button, MCP Bridge's zoomFit tool) is
     unaffected, since omitting it keeps the original "fit everything"
     behavior exactly as it was. */
  function zoomFit(onlyIds) {
    var cards = (typeof KanvazCards !== 'undefined') ? KanvazCards.getAll() : {};
    var ids = onlyIds && onlyIds.length ? onlyIds : Object.keys(cards);

    if (!ids.length) {
      tx = 0; ty = 0; scale = 1.0;
      applyTransform();
      return;
    }

    var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (var i = 0; i < ids.length; i++) {
      var c = cards[ids[i]];
      if (c.x < minX) minX = c.x;
      if (c.y < minY) minY = c.y;
      if (c.x + c.w > maxX) maxX = c.x + c.w;
      if (c.y + c.h > maxY) maxY = c.y + c.h;
    }

    var pad    = 60;
    var worldW = maxX - minX + pad * 2;
    var worldH = maxY - minY + pad * 2;
    var vw     = container.clientWidth;
    var vh     = container.clientHeight;
    var newScale = Math.min(vw / worldW, vh / worldH, ZOOM_MAX);
    newScale = Math.max(ZOOM_MIN, newScale);

    scale = newScale;
    tx = (vw / 2) - (minX + worldW / 2 - pad) * scale;
    ty = (vh / 2) - (minY + worldH / 2 - pad) * scale;

    applyTransform();
  }

  /* Zoom to selection (4.9.0) — falls back to the normal fit-everything
     behavior when nothing is selected, rather than a no-op or an error,
     since "zoom to selection with nothing selected" has an obvious
     reasonable meaning (there's nothing selection-specific to zoom to). */
  function zoomToSelection() {
    var ids = (typeof KanvazCards !== 'undefined' && KanvazCards.getSelectedIds) ? KanvazCards.getSelectedIds() : [];
    zoomFit(ids);
  }

  function panBy(dx, dy) {
    tx += dx;
    ty += dy;
    applyTransform();
  }

  function panTo(x, y) {
    tx = x;
    ty = y;
    applyTransform();
  }

  /* Audit fix: board load/switch used to call panTo(savedTx, savedTy)
     then setZoom(savedScale) — but setZoom's pivot math REWRITES tx/ty
     based on the ratio between the CURRENT scale (whatever the previous
     board happened to be at) and the new one, immediately overwriting
     the pan just restored. The board would land somewhere else on
     screen every time, and how far off depended on whichever board you
     switched from. Assign all three in one shot, no pivot math. */
  function setViewport(x, y, newScale) {
    tx = x;
    ty = y;
    scale = (isFinite(newScale) && newScale > 0) ? Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, newScale)) : 1.0;
    applyTransform();
  }

  /* ── Grid drawing ── */

  function resizeGrid() {
    gridCanvas.width = container.clientWidth;
    gridCanvas.height = container.clientHeight;
  }

  function drawGrid() {
    var w = gridCanvas.width;
    var h = gridCanvas.height;

    gridCtx.clearRect(0, 0, w, h);

    var baseSpacing = 24;
    var spacing = baseSpacing * scale;

    /* Fade grid at extreme zoom levels.
       Audit fix (4.7.0): the low end used to fade linearly down to
       exactly 0 AT ZOOM_MIN — meaning the grid vanished completely
       right as you reached the most-zoomed-out view, exactly when
       having some spatial reference matters most for a large board.
       Fading toward a floor BELOW ZOOM_MIN instead means alpha never
       actually reaches 0 within the reachable zoom range — the grid
       stays faintly visible everywhere the user can actually zoom to.
       The separate density-based minorFade/majorFade below (screen-
       space line spacing, not raw scale) still handles the "lines too
       close together look like a solid wash" problem on its own — this
       change only affects the extreme-zoom-out zero-out, not that. */
    var GRID_FADE_FLOOR = ZOOM_MIN * 0.5;
    var alpha = 1.0;
    if (scale < 0.25) alpha = (scale - GRID_FADE_FLOOR) / (0.25 - GRID_FADE_FLOOR);
    if (scale > 3.0)  alpha = 1.0 - (scale - 3.0) / (ZOOM_MAX - 3.0);
    alpha = Math.max(0, Math.min(1, alpha));

    if (alpha <= 0) return;

    /* Origin offset so grid moves with pan */
    var ox = ((tx % spacing) + spacing) % spacing;
    var oy = ((ty % spacing) + spacing) % spacing;

    var isLight = document.documentElement.getAttribute('data-theme') === 'light';
    var lineColor = isLight ? '0, 0, 0' : '255, 255, 255';
    var minorAlpha = (isLight ? 0.10 : 0.09) * alpha;
    var majorAlpha = (isLight ? 0.22 : 0.20) * alpha;

    /* Major/minor line grid (same treatment as Map View) — a bolder
       line every 5th cell instead of a uniform dot field. */
    var MAJOR_EVERY = 5;
    var majorSpacing = spacing * MAJOR_EVERY;
    var majorOx = ((tx % majorSpacing) + majorSpacing) % majorSpacing;
    var majorOy = ((ty % majorSpacing) + majorSpacing) % majorSpacing;

    /* Density fade — lines packed closer than ~12-24px apart visually
       merge (anti-aliased edges overlap) into a wash that looked like
       the grid "going white" when zooming out. Fade each line type out
       smoothly as its own spacing approaches that merge threshold,
       instead of drawing at full alpha right up until an abrupt cutoff.
       Verified empirically (measured pixel brightness across the full
       zoom range) before landing on these thresholds. */
    var minorFade = 1.0;
    if (spacing < 20) minorFade = Math.max(0, (spacing - 12) / (20 - 12));
    minorAlpha *= minorFade;

    var majorFade = 1.0;
    if (majorSpacing < 40) majorFade = Math.max(0, (majorSpacing - 24) / (40 - 24));
    majorAlpha *= majorFade;

    gridCtx.lineWidth = 1;

    if (minorFade > 0.01) {
      gridCtx.strokeStyle = 'rgba(' + lineColor + ', ' + minorAlpha + ')';
      gridCtx.beginPath();
      var x = ox;
      while (x < w) {
        gridCtx.moveTo(x + 0.5, 0);
        gridCtx.lineTo(x + 0.5, h);
        x += spacing;
      }
      var y = oy;
      while (y < h) {
        gridCtx.moveTo(0, y + 0.5);
        gridCtx.lineTo(w, y + 0.5);
        y += spacing;
      }
      gridCtx.stroke();
    }

    if (majorFade > 0.01) {
      /* Major lines carry a faint accent tint rather than plain gray —
         the same brand color used everywhere else in the app (selection
         rings, active states), just at a low enough alpha to stay a
         quiet structural cue instead of competing with card content. */
      var accentRgb = getAccentRgb();
      gridCtx.strokeStyle = 'rgba(' + accentRgb + ', ' + (majorAlpha * 0.85) + ')';
      gridCtx.beginPath();
      var mx = majorOx;
      while (mx < w) {
        gridCtx.moveTo(mx + 0.5, 0);
        gridCtx.lineTo(mx + 0.5, h);
        mx += majorSpacing;
      }
      var my = majorOy;
      while (my < h) {
        gridCtx.moveTo(0, my + 0.5);
        gridCtx.lineTo(w, my + 0.5);
        my += majorSpacing;
      }
      gridCtx.stroke();

      /* Small accent dots at major-line intersections — a CAD-style
         anchor point at every 5th cell, reinforcing the grid as a real
         measuring surface instead of a flat tiled texture. Same fade as
         the lines they mark, so they never outlive the lines around
         them at extreme zoom. */
      var dotAlpha = majorAlpha * 1.3;
      gridCtx.fillStyle = 'rgba(' + accentRgb + ', ' + Math.min(1, dotAlpha) + ')';
      var dotR = Math.min(1.6, 1 + scale * 0.15);
      var dy = majorOy;
      while (dy < h) {
        var dx = majorOx;
        while (dx < w) {
          gridCtx.beginPath();
          gridCtx.arc(dx, dy, dotR, 0, Math.PI * 2);
          gridCtx.fill();
          dx += majorSpacing;
        }
        dy += majorSpacing;
      }
    }
  }

  /* ── Events ── */

  function bindEvents() {
    /* Scroll to zoom */
    container.addEventListener('wheel', function(e) {
      e.preventDefault();

      /* Audit fix: a plain `else` branch here treated ANY non-negative
         deltaY as "zoom out" — including deltaY === 0, which is exactly
         what a horizontal scroll (Shift+wheel, or a trackpad's
         horizontal swipe) reports. That silently zoomed the canvas OUT
         on a gesture with no vertical intent at all. Explicitly no-op
         on zero. */
      if (e.deltaY === 0) return;

      var rect = container.getBoundingClientRect();
      var pivotX = e.clientX - rect.left;
      var pivotY = e.clientY - rect.top;

      var factor = e.ctrlKey ? ZOOM_FACTOR_FINE : ZOOM_FACTOR;
      /* Magnitude-aware: a precision trackpad emits many small-delta
         events per gesture where a mouse wheel emits few large-delta
         ones — scaling the exponent by deltaY means a gentle swipe
         moves the zoom gently instead of applying a full step per
         event regardless of how small the actual input was. */
      var exponent = -e.deltaY / 100;
      var newScale = scale * Math.pow(factor, exponent);

      setZoom(newScale, pivotX, pivotY);
    }, { passive: false });

    /* Panning — middle mouse, space+drag, or left-drag on empty canvas.
       Ctrl+left-drag (or plain left-drag while marqueeModeOn) takes
       priority over the default left-drag-pans-canvas behavior — a
       marquee selection box needs the same gesture pan already claims,
       so it has to be checked and excluded first. */
    container.addEventListener('mousedown', function(e) {
      var isEmptyTarget = (e.target === container || e.target === world || e.target === gridCanvas);

      if (e.button === 0 && isEmptyTarget && (e.ctrlKey || e.metaKey || marqueeModeOn)) {
        e.preventDefault();
        startMarquee(e.clientX, e.clientY);
        return;
      }

      var leftDragEnabled = true;
      if (typeof KanvazUI_Extended !== 'undefined') {
        var s = KanvazUI_Extended.getSettings();
        leftDragEnabled = !s || s.leftDragPan !== false;
      }

      var shouldPan = (e.button === 1)
        || (e.button === 0 && spaceDown)
        || (e.button === 0 && isEmptyTarget && leftDragEnabled);

      if (shouldPan) {
        e.preventDefault();
        isPanning = true;
        panStartX = e.clientX;
        panStartY = e.clientY;
        panOriginX = tx;
        panOriginY = ty;
        panMoved = false;
        container.classList.add('grabbing');
      }
    });

    window.addEventListener('mousemove', function(e) {
      if (isMarqueeSelecting) { updateMarquee(e.clientX, e.clientY); return; }
      if (!isPanning) return;
      var dx = e.clientX - panStartX;
      var dy = e.clientY - panStartY;
      if (Math.abs(dx) > 2 || Math.abs(dy) > 2) panMoved = true;
      tx = panOriginX + dx;
      ty = panOriginY + dy;
      applyTransform();
    });

    window.addEventListener('mouseup', function(e) {
      if (isMarqueeSelecting) { finishMarquee(e.clientX, e.clientY); return; }
      if (isPanning) {
        isPanning = false;
        container.classList.remove('grabbing');
        if (spaceDown) container.classList.add('grab');

        /* Left-click on empty canvas without drag = deselect all */
        if (e.button === 0 && !panMoved && typeof KanvazCards !== 'undefined') {
          KanvazCards.deselectAll();
        }
      }
    });

    /* Space key for pan mode */
    window.addEventListener('keydown', function(e) {
      if (e.code === 'Space' && e.target.tagName !== 'TEXTAREA' && e.target.tagName !== 'INPUT') {
        if (!spaceDown) {
          spaceDown = true;
          container.classList.add('grab');
        }
        e.preventDefault();
      }
    });

    window.addEventListener('keyup', function(e) {
      if (e.code === 'Space') {
        spaceDown = false;
        if (!isPanning) container.classList.remove('grab');
      }
    });

    /* "V" toggles marquee-select mode — a plain left-drag on empty
       canvas then draws a selection box instead of panning, without
       needing to hold Ctrl every time. Same text-input guard every
       other bare-letter shortcut in this app uses. Escape (handled in
       ui.js's closeAll(), which calls setMarqueeMode(false)) also exits
       it, same convention as every other modal-ish state in this app. */
    window.addEventListener('keydown', function(e) {
      if ((e.key === 'v' || e.key === 'V') && e.target.tagName !== 'TEXTAREA' && e.target.tagName !== 'INPUT') {
        setMarqueeMode(!marqueeModeOn);
      }
    });

    /* Double-click canvas to create note — opt-in via Settings (off by default) */
    container.addEventListener('dblclick', function(e) {
      if (e.target === container || e.target === world || e.target === gridCanvas) {
        var enabled = false;
        if (typeof KanvazUI_Extended !== 'undefined') {
          var s = KanvazUI_Extended.getSettings();
          enabled = s && s.doubleClickCreatesNote === true;
        }
        if (!enabled) return;
        if (typeof KanvazCards !== 'undefined') {
          var pos = screenToWorld(e.clientX, e.clientY);
          KanvazCards.createNote(pos.x, pos.y);
        }
      }
    });

    /* Right-click on canvas */
    container.addEventListener('contextmenu', function(e) {
      if (e.target === container || e.target === world || e.target === gridCanvas) {
        e.preventDefault();
        if (typeof KanvazUI !== 'undefined') {
          KanvazUI.showContextMenu(e.clientX, e.clientY, 'canvas', null);
        }
      }
    });
  }

  function setMarqueeMode(on) {
    marqueeModeOn = !!on;
    if (container) container.classList.toggle('marquee-mode', marqueeModeOn);
    if (typeof KanvazUI !== 'undefined' && KanvazUI.toast) {
      KanvazUI.toast(marqueeModeOn ? 'Selection mode on — drag to box-select (V or Esc to exit)' : 'Selection mode off');
    }
  }

  /* Resolves whatever format --color-accent happens to be (hex/rgb/hsl/
     named — themes and plugin themes aren't guaranteed to use any one
     of these) into an rgba() string at a fixed low alpha, via a 1x1
     canvas readback — the one reliable, format-agnostic way to parse an
     arbitrary CSS color string in JS without a real color-parsing
     library. Recomputed on every marquee start rather than cached, so a
     theme switch is always reflected immediately — this only runs once
     per drag, not per mousemove, so there's no real cost to not caching
     it. */
  function getMarqueeFillColor() {
    var accent = getComputedStyle(document.documentElement).getPropertyValue('--color-accent').trim();
    var c = document.createElement('canvas');
    c.width = 1; c.height = 1;
    var ctx = c.getContext('2d');
    ctx.fillStyle = accent || '#7C5CFC';
    ctx.fillRect(0, 0, 1, 1);
    var d = ctx.getImageData(0, 0, 1, 1).data;
    return 'rgba(' + d[0] + ',' + d[1] + ',' + d[2] + ',0.12)';
  }

  function startMarquee(clientX, clientY) {
    isMarqueeSelecting = true;
    marqueeStartX = clientX;
    marqueeStartY = clientY;
    if (!marqueeEl) {
      marqueeEl = document.createElement('div');
      marqueeEl.id = 'marquee-select-box';
      document.body.appendChild(marqueeEl);
    }
    marqueeEl.style.left = clientX + 'px';
    marqueeEl.style.top = clientY + 'px';
    marqueeEl.style.width = '0px';
    marqueeEl.style.height = '0px';
    marqueeEl.style.background = getMarqueeFillColor();
    marqueeEl.style.display = 'block';
  }

  /* Tracked in raw screen/client coordinates (not world) — the box is a
     fixed-position screen overlay, so it needs to visually stay put
     under the cursor regardless of the board's own pan/zoom; conversion
     to world space only happens once, in finishMarquee, for the actual
     card-intersection test. */
  function updateMarquee(clientX, clientY) {
    var left = Math.min(marqueeStartX, clientX);
    var top = Math.min(marqueeStartY, clientY);
    var w = Math.abs(clientX - marqueeStartX);
    var h = Math.abs(clientY - marqueeStartY);
    marqueeEl.style.left = left + 'px';
    marqueeEl.style.top = top + 'px';
    marqueeEl.style.width = w + 'px';
    marqueeEl.style.height = h + 'px';
  }

  function finishMarquee(clientX, clientY) {
    isMarqueeSelecting = false;
    if (marqueeEl) marqueeEl.style.display = 'none';

    /* A click with no real drag (box smaller than a few px) is a plain
       click, not a selection attempt — matches the existing "click
       empty canvas = deselect" convention below rather than selecting
       nothing via an accidental zero-size box. */
    if (Math.abs(clientX - marqueeStartX) < 3 && Math.abs(clientY - marqueeStartY) < 3) {
      if (typeof KanvazCards !== 'undefined') KanvazCards.deselectAll();
      return;
    }

    var p1 = screenToWorld(marqueeStartX, marqueeStartY);
    var p2 = screenToWorld(clientX, clientY);
    var boxX1 = Math.min(p1.x, p2.x);
    var boxY1 = Math.min(p1.y, p2.y);
    var boxX2 = Math.max(p1.x, p2.x);
    var boxY2 = Math.max(p1.y, p2.y);

    if (typeof KanvazCards === 'undefined') return;
    var all = KanvazCards.getAll();
    var hitIds = [];
    for (var id in all) {
      var c = all[id];
      var cardIntersects = c.x < boxX2 && (c.x + c.w) > boxX1 && c.y < boxY2 && (c.y + c.h) > boxY1;
      if (cardIntersects) hitIds.push(id);
    }
    KanvazCards.setMultiSelection(hitIds);
  }

  /* ── Coordinate conversion ── */

  function screenToWorld(sx, sy) {
    var rect = container.getBoundingClientRect();
    return {
      x: (sx - rect.left - tx) / scale,
      y: (sy - rect.top  - ty) / scale
    };
  }

  function worldToScreen(wx, wy) {
    var rect = container.getBoundingClientRect();
    return {
      x: wx * scale + tx + rect.left,
      y: wy * scale + ty + rect.top
    };
  }

  /* ── Status bar update ── */

  function updateStatusBar() {
    var zoomEl = document.getElementById('status-zoom');
    var posEl  = document.getElementById('status-pos');

    if (zoomEl) {
      zoomEl.textContent = Math.round(scale * 100) + '%';
    }

    if (posEl) {
      var cx = Math.round(-tx / scale);
      var cy = Math.round(-ty / scale);
      posEl.textContent = cx + ', ' + cy;
    }
  }

  /* ── Drop handling ── */

  function initDrop(onFiles) {
    var overlay = document.getElementById('drop-overlay');

    container.addEventListener('dragover', function(e) {
      e.preventDefault();
      e.stopPropagation();
      if (overlay) overlay.classList.add('visible');
    });

    container.addEventListener('dragleave', function(e) {
      if (e.relatedTarget && container.contains(e.relatedTarget)) return;
      if (overlay) overlay.classList.remove('visible');
    });

    container.addEventListener('drop', function(e) {
      e.preventDefault();
      e.stopPropagation();
      if (overlay) overlay.classList.remove('visible');

      var files = e.dataTransfer.files;
      if (!files || !files.length) return;

      var worldPos = screenToWorld(e.clientX, e.clientY);

      var fileArray = [];
      for (var i = 0; i < files.length; i++) {
        fileArray.push(files[i]);
      }

      if (typeof onFiles === 'function') {
        onFiles(fileArray, worldPos);
      }
    });
  }

  /* ── Viewport info for minimap ── */

  function getViewport() {
    return {
      tx: tx,
      ty: ty,
      scale: scale,
      width: container ? container.clientWidth : 0,
      height: container ? container.clientHeight : 0
    };
  }

  /* ── Public API ── */

  return {
    init:           init,
    setZoom:        setZoom,
    zoomIn:         zoomIn,
    zoomOut:        zoomOut,
    zoomReset:      zoomReset,
    zoomFit:        zoomFit,
    zoomToSelection: zoomToSelection,
    panBy:          panBy,
    panTo:          panTo,
    setViewport:    setViewport,
    initDrop:       initDrop,
    screenToWorld:  screenToWorld,
    worldToScreen:  worldToScreen,
    getViewport:    getViewport,
    getScale:       function() { return scale; },
    getTx:          function() { return tx; },
    getTy:          function() { return ty; },
    drawGrid:       drawGrid,
    setMarqueeMode: setMarqueeMode,
    isMarqueeModeOn: function() { return marqueeModeOn; }
  };

})();
