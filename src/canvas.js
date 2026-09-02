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

  function zoomFit() {
    var cards = (typeof KanvazCards !== 'undefined') ? KanvazCards.getAll() : {};
    var ids = Object.keys(cards);

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

    /* Fade grid at extreme zoom levels */
    var alpha = 1.0;
    if (scale < 0.25) alpha = (scale - ZOOM_MIN) / (0.25 - ZOOM_MIN);
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
      gridCtx.strokeStyle = 'rgba(' + lineColor + ', ' + majorAlpha + ')';
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

    /* Panning — middle mouse, space+drag, or left-drag on empty canvas */
    container.addEventListener('mousedown', function(e) {
      var isEmptyTarget = (e.target === container || e.target === world || e.target === gridCanvas);
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
      if (!isPanning) return;
      var dx = e.clientX - panStartX;
      var dy = e.clientY - panStartY;
      if (Math.abs(dx) > 2 || Math.abs(dy) > 2) panMoved = true;
      tx = panOriginX + dx;
      ty = panOriginY + dy;
      applyTransform();
    });

    window.addEventListener('mouseup', function(e) {
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
    drawGrid:       drawGrid
  };

})();
