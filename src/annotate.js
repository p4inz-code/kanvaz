/* annotate.js — per-card annotation overlay */

var KanvazAnnotate = (function() {

  var COLORS = ['#FF5A5A', '#F0A500', '#4A9EFF', '#4CAF82', '#FFFFFF', '#DCDCE8'];
  var WIDTHS  = [2, 4, 8];

  var activeCardId  = null;
  var activeCanvas  = null;
  var activeCtx     = null;
  var activeTool    = 'pen';
  var activeColor   = '#FF5A5A';
  var activeWidth   = 2;
  var isDrawing     = false;
  var startX        = 0;
  var startY        = 0;
  var snapshot      = null;
  var overlays      = {};   /* cardId → { canvas, ctx, strokes, visible } */

  /* ── Attach overlay to a card element ── */

  function attach(cardId, cardEl) {
    if (overlays[cardId]) return;

    var cvs = document.createElement('canvas');
    cvs.className = 'annotation-canvas';
    cvs.style.cssText = [
      'position:absolute',
      'top:0',
      'left:0',
      'width:100%',
      'height:100%',
      'pointer-events:none',
      'z-index:8',
      'border-radius:6px'
    ].join(';');

    /* HiDPI/Retina fix: the canvas BUFFER is sized in real device pixels
       (CSS size * devicePixelRatio) so strokes render crisply, while the
       CSS box (set via the width:100%/height:100% above) stays at the
       card's normal size. ctx.scale(dpr, dpr) then lets every drawing
       call below keep using plain CSS-pixel coordinates — getPos(),
       stroke storage, and redraw() are all unchanged and still produce
       the exact same numbers as before this fix (dpr used to be
       implicitly 1 everywhere since the buffer was never enlarged), so
       saved annotations stay pixel-identical across machines with
       different display scaling. */
    var dpr  = window.devicePixelRatio || 1;
    var cssW = cardEl.offsetWidth  || 300;
    var cssH = cardEl.offsetHeight || 200;
    cvs.width  = Math.round(cssW * dpr);
    cvs.height = Math.round(cssH * dpr);

    cardEl.appendChild(cvs);

    var ctx = cvs.getContext('2d');
    ctx.scale(dpr, dpr);

    overlays[cardId] = {
      canvas:  cvs,
      ctx:     ctx,
      strokes: [],
      visible: true,
      dpr:     dpr
    };
  }

  /* ── Resize overlay when card resizes ── */

  function resize(cardId, w, h) {
    var ov = overlays[cardId];
    if (!ov) return;

    /* w/h arrive as the card's new CSS pixel size (see cards.js call
       sites) — the canvas BUFFER stays dpr times larger, same as attach().
       Audit fix: this used to prefer the dpr captured once back at
       attach() time over a fresh read, so if the window moved to a
       different-scaling monitor between attach() and this resize()
       call, every future redraw kept using the stale value — the
       overlay would render at the wrong sharpness for the display it's
       actually on. Reading live first (and syncing ov.dpr to match)
       means the very next resize — which fires whenever the card
       itself is dragged to a new size, a fairly frequent event — self-
       corrects instead of staying wrong for the rest of the session. */
    var dpr = window.devicePixelRatio || ov.dpr || 1;
    ov.dpr = dpr;
    var oldW = ov.canvas.width;
    var oldH = ov.canvas.height;
    var newW = Math.round(w * dpr);
    var newH = Math.round(h * dpr);

    if (oldW === 0 || oldH === 0) {
      ov.canvas.width  = newW;
      ov.canvas.height = newH;
      ov.ctx.scale(dpr, dpr);
      return;
    }

    /* Setting canvas.width/height clears the pixel buffer (and resets
       any transform, including the scale below), so snapshot the old
       content onto a temp canvas first, then scale it back in via
       drawImage — this makes annotations resize PROPORTIONALLY with
       the card, matching the underlying media (which uses object-fit:
       cover at 100% width/height). A naive getImageData/putImageData
       pair would paste the old bitmap at its old pixel size into the
       top-left corner instead of scaling. temp/getImageData/drawImage's
       SOURCE rect all work in raw buffer pixels regardless of any
       transform, so oldW/oldH (buffer pixels) are correct there; the
       DESTINATION rect below is drawn through the freshly re-applied
       dpr scale, so it uses w/h (CSS pixels) to land on the full new
       buffer, exactly like attach()/getPos() do everywhere else. */
    var temp = document.createElement('canvas');
    temp.width  = oldW;
    temp.height = oldH;
    temp.getContext('2d').drawImage(ov.canvas, 0, 0);

    ov.canvas.width  = newW;
    ov.canvas.height = newH;
    ov.ctx.scale(dpr, dpr);
    ov.ctx.drawImage(temp, 0, 0, oldW, oldH, 0, 0, w, h);
  }

  /* ── Activate annotation mode on a card ── */

  function activate(cardId) {
    deactivate();

    var ov = overlays[cardId];
    if (!ov) {
      var el = document.getElementById(cardId);
      if (!el) return;
      attach(cardId, el);
      ov = overlays[cardId];
    }

    activeCardId = cardId;
    activeCanvas = ov.canvas;
    activeCtx    = ov.ctx;

    activeCanvas.style.pointerEvents = 'all';
    activeCanvas.style.cursor = 'crosshair';

    showToolbar(cardId);
    bindDrawEvents();
  }

  /* ── Deactivate ── */

  function deactivate() {
    if (!activeCardId) return;

    if (activeCanvas) {
      activeCanvas.style.pointerEvents = 'none';
      activeCanvas.style.cursor = 'default';
      unbindDrawEvents();
    }

    hideToolbar();
    activeCardId = null;
    activeCanvas = null;
    activeCtx    = null;
  }

  /* ── Draw events ── */

  var boundMouseDown = null;
  var boundMouseMove = null;
  var boundMouseUp   = null;

  function bindDrawEvents() {
    boundMouseDown = function(e) { onDown(e); };
    boundMouseMove = function(e) { onMove(e); };
    boundMouseUp   = function(e) { onUp(e); };

    activeCanvas.addEventListener('mousedown', boundMouseDown);
    window.addEventListener('mousemove', boundMouseMove);
    window.addEventListener('mouseup', boundMouseUp);
  }

  function unbindDrawEvents() {
    if (!activeCanvas) return;
    if (boundMouseDown) activeCanvas.removeEventListener('mousedown', boundMouseDown);
    if (boundMouseMove) window.removeEventListener('mousemove', boundMouseMove);
    if (boundMouseUp)   window.removeEventListener('mouseup', boundMouseUp);
  }

  function getPos(e) {
    /* Plain CSS-pixel coordinates — the canvas context is scaled by
       devicePixelRatio (see attach()/resize()), so drawing calls made
       with these coordinates land correctly on the higher-resolution
       buffer without needing to know dpr here. This used to multiply by
       activeCanvas.width/rect.width as a buffer/CSS ratio, which was a
       no-op when the buffer was always exactly CSS-sized (pre-HiDPI-fix)
       — keeping this in CSS-pixel space is what keeps stored stroke
       coordinates identical to before, across any devicePixelRatio.

       Audit fix: the card (and this overlay canvas with it) lives inside
       #canvas-world, which carries the board's pan/zoom `scale` — so
       getBoundingClientRect() returns a rect already SCALED by it
       (rect.width === cssWidth * scale). e.clientX/Y are raw screen
       pixels, so the delta from rect.left/top is in scaled-screen-pixel
       space, not the canvas's own CSS-pixel space the stroke data and
       drawing calls use. That claim above ("no-op") was only ever true
       at exactly 100% zoom — dividing by scale is what actually
       converts screen pixels back to canvas-local CSS pixels; at any
       other zoom, strokes landed offset from the cursor by exactly that
       factor (crammed toward the corner when zoomed out, flung outside
       the card when zoomed in). */
    var rect = activeCanvas.getBoundingClientRect();
    var scale = (typeof KanvazCanvas !== 'undefined' && KanvazCanvas.getScale) ? KanvazCanvas.getScale() : 1;
    return {
      x: (e.clientX - rect.left) / scale,
      y: (e.clientY - rect.top) / scale
    };
  }

  var currentPenPoints = [];

  function onDown(e) {
    e.preventDefault();
    e.stopPropagation();
    isDrawing = true;
    var pos = getPos(e);
    startX = pos.x;
    startY = pos.y;
    currentPenPoints = [{ x: pos.x, y: pos.y }];

    if (activeTool === 'pen') {
      activeCtx.beginPath();
      activeCtx.moveTo(startX, startY);
    } else {
      /* Only 'rect'/'arrow' use this snapshot (see onMove: they repaint
         it before drawing each live-preview frame so the in-progress
         shape doesn't smear). 'pen' never reads `snapshot`, so skip the
         full-canvas readback for it — a real cost on a large annotation
         canvas, paid on every single pen stroke for no reason. */
      snapshot = activeCtx.getImageData(0, 0, activeCanvas.width, activeCanvas.height);
    }
  }

  function onMove(e) {
    if (!isDrawing) return;
    var pos = getPos(e);

    if (activeTool === 'pen') {
      currentPenPoints.push({ x: pos.x, y: pos.y });
      activeCtx.strokeStyle = activeColor;
      activeCtx.lineWidth   = activeWidth;
      activeCtx.lineCap     = 'round';
      activeCtx.lineJoin    = 'round';
      activeCtx.lineTo(pos.x, pos.y);
      activeCtx.stroke();

    } else if (activeTool === 'rect') {
      activeCtx.putImageData(snapshot, 0, 0);
      activeCtx.strokeStyle = activeColor;
      activeCtx.lineWidth   = activeWidth;
      activeCtx.strokeRect(startX, startY, pos.x - startX, pos.y - startY);

    } else if (activeTool === 'arrow') {
      activeCtx.putImageData(snapshot, 0, 0);
      drawArrow(activeCtx, startX, startY, pos.x, pos.y, activeColor, activeWidth);
    }
  }

  function onUp(e) {
    if (!isDrawing) return;
    isDrawing = false;
    var pos = getPos(e);

    var stroke = {
      tool:   activeTool,
      color:  activeColor,
      width:  activeWidth,
      points: activeTool === 'pen'
        ? currentPenPoints.slice()
        : { x1: startX, y1: startY, x2: pos.x, y2: pos.y }
    };

    if (activeTool === 'pen') {
      activeCtx.closePath();
    }

    var ov = overlays[activeCardId];
    if (ov) {
      ov.strokes.push(stroke);
      if (typeof KanvazCards !== 'undefined') KanvazCards.refreshAnnotationDot(activeCardId);
      /* Audit fix (CRITICAL): drawing a stroke is a real, savable edit —
         same as moving/resizing/deleting a card — but this never marked
         the board dirty or pushed undo history, unlike clearAnnotations()
         just below, which correctly does both. A session where the ONLY
         edits were annotations would take the close dialog's "no unsaved
         changes" fast path (which also wipes the crash-recovery cache),
         permanently losing every stroke with no save prompt at all, and
         Ctrl+Z right after drawing would silently do nothing (or undo
         something unrelated) instead of removing the stroke. */
      KanvazApp.markDirty();
      KanvazHistory.push();
    }
  }

  /* ── Arrow drawing ── */

  function drawArrow(ctx, x1, y1, x2, y2, color, width) {
    var headLen = 12 + width * 2;
    var angle   = Math.atan2(y2 - y1, x2 - x1);

    ctx.strokeStyle = color;
    ctx.lineWidth   = width;
    ctx.lineCap     = 'round';

    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(x2, y2);
    ctx.lineTo(
      x2 - headLen * Math.cos(angle - Math.PI / 6),
      y2 - headLen * Math.sin(angle - Math.PI / 6)
    );
    ctx.moveTo(x2, y2);
    ctx.lineTo(
      x2 - headLen * Math.cos(angle + Math.PI / 6),
      y2 - headLen * Math.sin(angle + Math.PI / 6)
    );
    ctx.stroke();
  }

  /* ── Redraw all strokes from JSON ── */

  function redraw(cardId) {
    var ov = overlays[cardId];
    if (!ov) return;
    /* clearRect (unlike getImageData/putImageData) respects the ctx.scale
       transform from attach()/resize(), so divide back to CSS-pixel
       units here — using the raw buffer size would ask it to clear a
       dpr-times-too-large area. Harmless in practice (clipped to the
       canvas either way) but dimensionally correct this way. */
    ov.ctx.clearRect(0, 0, ov.canvas.width / (ov.dpr || 1), ov.canvas.height / (ov.dpr || 1));
    for (var i = 0; i < ov.strokes.length; i++) {
      var s = ov.strokes[i];
      if (s.tool === 'pen' && s.points && s.points.length) {
        ov.ctx.strokeStyle = s.color;
        ov.ctx.lineWidth   = s.width;
        ov.ctx.lineCap     = 'round';
        ov.ctx.lineJoin    = 'round';
        ov.ctx.beginPath();
        ov.ctx.moveTo(s.points[0].x, s.points[0].y);
        for (var j = 1; j < s.points.length; j++) {
          ov.ctx.lineTo(s.points[j].x, s.points[j].y);
        }
        ov.ctx.stroke();
      } else if (s.tool === 'rect' && s.points) {
        ov.ctx.strokeStyle = s.color;
        ov.ctx.lineWidth   = s.width;
        ov.ctx.strokeRect(s.points.x1, s.points.y1, s.points.x2 - s.points.x1, s.points.y2 - s.points.y1);
      } else if (s.tool === 'arrow' && s.points) {
        drawArrow(ov.ctx, s.points.x1, s.points.y1, s.points.x2, s.points.y2, s.color, s.width);
      }
    }
  }

  /* ── Toggle visibility (H key) ── */

  function toggleVisibility(cardId) {
    var ov = overlays[cardId];
    if (!ov) return;
    ov.visible = !ov.visible;
    ov.canvas.style.display = ov.visible ? '' : 'none';
    KanvazUI.toast(ov.visible ? 'Annotations shown' : 'Annotations hidden');
  }

  /* ── Clear with confirm ── */

  function clearAnnotations(cardId) {
    KanvazUI.showDialog(
      'Clear annotations?',
      'This will permanently remove all drawings on this card.',
      [
        {
          label: 'Clear',
          cls: 'danger',
          action: function() {
            var ov = overlays[cardId];
            if (!ov) return;
            /* clearRect (unlike getImageData/putImageData) respects the
               ctx.scale transform from attach()/resize(), so divide back
               to CSS-pixel units here — using the raw buffer size would
               ask it to clear a dpr-times-too-large area. Harmless in
               practice (clipped to the canvas either way) but
               dimensionally correct this way. */
            ov.ctx.clearRect(0, 0, ov.canvas.width / (ov.dpr || 1), ov.canvas.height / (ov.dpr || 1));
            ov.strokes = [];
            if (typeof KanvazCards !== 'undefined') KanvazCards.refreshAnnotationDot(cardId);
            KanvazApp.markDirty();
            KanvazHistory.push();
            KanvazUI.toast('Annotations cleared');
          }
        },
        { label: 'Cancel', cls: '', action: function() {} }
      ]
    );
  }

  /* ── Annotation toolbar ── */

  var toolbarEl = null;

  function showToolbar(cardId) {
    if (toolbarEl) hideToolbar();

    var cardEl = document.getElementById(cardId);
    if (!cardEl) return;

    var tb = document.createElement('div');
    tb.id = 'annotate-toolbar';
    tb.style.cssText = [
      'position:fixed',
      'z-index:20000',
      'display:flex',
      'align-items:center',
      'gap:4px',
      'background:var(--color-surface)',
      'border:1px solid var(--color-border-2)',
      'border-radius:8px',
      'padding:4px 8px',
      /* Polish fix: hardcoded shadow that ignored Light theme. */
      'box-shadow:0 4px 16px var(--color-shadow)',
      'font-family:var(--font-ui)',
      'font-size:11px'
    ].join(';');

    /* Tool buttons */
    var tools = [
      { id: 'pen',   title: 'Pen',       icon: '<svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M2 12l1-3.5L9.5 2 12 4.5 5.5 11 2 12z" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/><path d="M8 3.5L10.5 6" stroke="currentColor" stroke-width="1.3"/></svg>' },
      { id: 'arrow', title: 'Arrow',     icon: '<svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M2.5 11.5L11.5 2.5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/><path d="M6 2.5h5.5v5.5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>' },
      { id: 'rect',  title: 'Rectangle', icon: '<svg width="14" height="14" viewBox="0 0 14 14" fill="none"><rect x="2" y="3.5" width="10" height="7" rx="1" stroke="currentColor" stroke-width="1.3"/></svg>' }
    ];

    for (var i = 0; i < tools.length; i++) {
      (function(tool) {
        var btn = document.createElement('button');
        btn.title = tool.title;
        btn.innerHTML = tool.icon;
        btn.style.cssText = 'background:' + (activeTool === tool.id ? 'var(--color-accent-bg)' : 'transparent') + ';border:1px solid ' + (activeTool === tool.id ? 'var(--color-accent)' : 'transparent') + ';border-radius:4px;cursor:pointer;color:var(--color-text);padding:4px 6px;display:flex;align-items:center;justify-content:center;';
        btn.onclick = function() {
          activeTool = tool.id;
          updateToolbar();
        };
        btn.dataset.toolBtn = tool.id;
        tb.appendChild(btn);
      })(tools[i]);
    }

    /* Separator */
    var sep1 = document.createElement('div');
    sep1.style.cssText = 'width:1px;height:16px;background:var(--color-border);margin:0 2px;';
    tb.appendChild(sep1);

    /* Color swatches */
    for (var j = 0; j < COLORS.length; j++) {
      (function(color) {
        var swatch = document.createElement('button');
        swatch.style.cssText = 'width:14px;height:14px;border-radius:50%;background:' + color + ';border:2px solid ' + (activeColor === color ? 'var(--color-text)' : 'transparent') + ';cursor:pointer;padding:0;flex-shrink:0;';
        swatch.onclick = function() {
          activeColor = color;
          updateToolbar();
        };
        swatch.dataset.colorSwatch = color;
        tb.appendChild(swatch);
      })(COLORS[j]);
    }

    /* Separator */
    var sep2 = document.createElement('div');
    sep2.style.cssText = 'width:1px;height:16px;background:var(--color-border);margin:0 2px;';
    tb.appendChild(sep2);

    /* Width buttons */
    for (var k = 0; k < WIDTHS.length; k++) {
      (function(width) {
        var btn = document.createElement('button');
        btn.style.cssText = 'background:' + (activeWidth === width ? 'var(--color-accent-bg)' : 'transparent') + ';border:1px solid ' + (activeWidth === width ? 'var(--color-accent)' : 'transparent') + ';border-radius:4px;cursor:pointer;color:var(--color-text);padding:3px 6px;display:flex;align-items:center;justify-content:center;';
        var dot = document.createElement('div');
        dot.style.cssText = 'width:' + Math.min(width * 2, 10) + 'px;height:' + Math.min(width * 2, 10) + 'px;border-radius:50%;background:currentColor;';
        btn.appendChild(dot);
        btn.onclick = function() {
          activeWidth = width;
          updateToolbar();
        };
        btn.dataset.widthBtn = width;
        tb.appendChild(btn);
      })(WIDTHS[k]);
    }

    /* Separator */
    var sep3 = document.createElement('div');
    sep3.style.cssText = 'width:1px;height:16px;background:var(--color-border);margin:0 2px;';
    tb.appendChild(sep3);

    /* Clear button */
    var clearBtn = document.createElement('button');
    clearBtn.textContent = 'Clear';
    clearBtn.style.cssText = 'background:transparent;border:1px solid transparent;border-radius:4px;cursor:pointer;color:var(--color-red);padding:3px 6px;font-size:11px;';
    clearBtn.onmouseenter = function() { clearBtn.style.borderColor = 'var(--color-red)'; };
    clearBtn.onmouseleave = function() { clearBtn.style.borderColor = 'transparent'; };
    clearBtn.onclick = function() { clearAnnotations(cardId); };
    tb.appendChild(clearBtn);

    /* Done button */
    var doneBtn = document.createElement('button');
    doneBtn.textContent = 'Done';
    doneBtn.style.cssText = 'background:var(--color-accent-bg);border:1px solid var(--color-accent);border-radius:4px;cursor:pointer;color:var(--color-accent);padding:3px 8px;font-size:11px;margin-left:2px;';
    doneBtn.onclick = function() { deactivate(); };
    tb.appendChild(doneBtn);

    document.body.appendChild(tb);
    toolbarEl = tb;
    toolbarCardId = cardId;

    /* Position above the card — and keep repositioning when the canvas
       pans/zooms. The toolbar is position:fixed (so it doesn't scroll
       with the canvas world), but the card it's anchored to IS inside
       the canvas world, so its screen position changes on every
       pan/zoom. Watch for style changes on the transform parent. */
    repositionToolbar();
    var worldEl = document.getElementById('canvas-world');
    if (worldEl && typeof MutationObserver !== 'undefined') {
      toolbarObserver = new MutationObserver(function() { repositionToolbar(); });
      toolbarObserver.observe(worldEl, { attributes: true, attributeFilter: ['style'] });
    }
    /* Audit fix: the MutationObserver above only catches the card
       moving relative to the screen because the canvas itself panned/
       zoomed (transform style change on #canvas-world). A plain window
       resize that shifts #canvas-container's own screen offset — e.g.
       a sidebar/toolbar reflow — doesn't touch that transform at all,
       so the toolbar could drift away from the card it's anchored to
       until the next pan/zoom happened to nudge it back into sync. */
    window.addEventListener('resize', repositionToolbar);
  }

  var toolbarCardId = null;
  var toolbarObserver = null;

  function repositionToolbar() {
    if (!toolbarEl || !toolbarCardId) return;
    var cardEl = document.getElementById(toolbarCardId);
    if (!cardEl) return;
    var rect = cardEl.getBoundingClientRect();
    toolbarEl.style.left = rect.left + 'px';
    toolbarEl.style.top  = Math.max(4, rect.top - 44) + 'px';
  }

  function updateToolbar() {
    if (!toolbarEl) return;
    var toolBtns   = toolbarEl.querySelectorAll('[data-tool-btn]');
    var swatches   = toolbarEl.querySelectorAll('[data-color-swatch]');
    var widthBtns  = toolbarEl.querySelectorAll('[data-width-btn]');

    for (var i = 0; i < toolBtns.length; i++) {
      var isActive = toolBtns[i].dataset.toolBtn === activeTool;
      toolBtns[i].style.background  = isActive ? 'var(--color-accent-bg)' : 'transparent';
      toolBtns[i].style.borderColor = isActive ? 'var(--color-accent)'    : 'transparent';
    }
    for (var j = 0; j < swatches.length; j++) {
      swatches[j].style.borderColor = swatches[j].dataset.colorSwatch === activeColor
        ? 'var(--color-text)' : 'transparent';
    }
    for (var k = 0; k < widthBtns.length; k++) {
      var isActiveW = parseInt(widthBtns[k].dataset.widthBtn) === activeWidth;
      widthBtns[k].style.background  = isActiveW ? 'var(--color-accent-bg)' : 'transparent';
      widthBtns[k].style.borderColor = isActiveW ? 'var(--color-accent)'    : 'transparent';
    }
  }

  function hideToolbar() {
    if (toolbarObserver) { toolbarObserver.disconnect(); toolbarObserver = null; }
    window.removeEventListener('resize', repositionToolbar);
    if (toolbarEl && toolbarEl.parentNode) {
      toolbarEl.parentNode.removeChild(toolbarEl);
    }
    toolbarEl = null;
    toolbarCardId = null;
  }

  /* ── Serialise / deserialise ── */

  function getStrokes(cardId) {
    var ov = overlays[cardId];
    return ov ? ov.strokes : [];
  }

  function loadStrokes(cardId, strokes, cardEl) {
    if (!overlays[cardId]) attach(cardId, cardEl);
    var ov = overlays[cardId];
    ov.strokes = strokes || [];
    redraw(cardId);
  }

  function detach(cardId) {
    var ov = overlays[cardId];
    if (ov && ov.canvas && ov.canvas.parentNode) {
      ov.canvas.parentNode.removeChild(ov.canvas);
    }
    delete overlays[cardId];
    if (activeCardId === cardId) deactivate();
  }

  /* Detach ALL overlays at once — used on board switch / clearAll.
     Without this, every board switch leaves the previous board's
     detached <canvas> overlay elements (and their stroke arrays)
     referenced forever in `overlays`, since individual card elements
     are removed from the DOM but never unregistered here. */
  function detachAll() {
    for (var id in overlays) {
      var ov = overlays[id];
      if (ov && ov.canvas && ov.canvas.parentNode) {
        ov.canvas.parentNode.removeChild(ov.canvas);
      }
    }
    overlays = {};
    deactivate();
  }

  return {
    attach:           attach,
    detach:           detach,
    detachAll:        detachAll,
    resize:           resize,
    activate:         activate,
    deactivate:       deactivate,
    toggleVisibility: toggleVisibility,
    clearAnnotations: clearAnnotations,
    getStrokes:       getStrokes,
    loadStrokes:      loadStrokes
  };

})();
