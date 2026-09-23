/* scratch-board.js — Scratch Board (9.5.0)
   Third view alongside Board/Map. Q&A decision: identical card behavior
   to Board view (same #canvas-world, same cards, same camera — this is
   NOT a separate layout algorithm like Map View), plus:
     - a configurable background (ruled lines / plain color / grid),
       independent of the app theme (#scratch-bg-canvas, replaces
       #canvas-grid only while active)
     - a board-wide annotation layer, independent of per-card annotation,
       with pen/highlighter/line/arrow/rectangle/ellipse tools
       (#scratch-strokes-canvas, a sibling of #canvas-world so it always
       renders above every card)
     - the existing Connections system is reused as-is for cross-card
       references; nothing here duplicates it.

   Deliberately does NOT reuse annotate.js's draw functions directly —
   that module is tightly coupled to per-card DOM positioning and a
   locally-transformed (CSS-transform) canvas. Scratch's stroke canvas is
   a full-viewport SCREEN-space overlay (not CSS-transformed with
   #canvas-world), so every stroke point is stored in WORLD coordinates
   and mapped through KanvazCanvas.worldToScreen on every redraw instead —
   the same technique Map View's connection-line renderer already uses
   for its DOM-independent lines.

   Known limitation (documented, not silently dropped): strokes are NOT
   currently part of KanvazHistory's undo/redo — history.js snapshots
   cards+connections only, and correctly extending it was out of scope
   for this pass. "Clear all strokes" is provided as a coarse manual
   undo. Stroke width is fixed in screen pixels (does not scale with
   zoom), matching how the toolbar's line weight looks at any zoom. */

var KanvazScratchBoard = (function() {

  var bgCanvas = null, bgCtx = null;
  var strokeCanvas = null, strokeCtx = null;
  var toolbarEl = null;

  var active = false;

  var BG_STYLES = ['lines', 'color', 'grid'];
  var bgStyle = 'lines';
  var bgColor = '#1b1b22';
  /* Lines and grid get their OWN accent color, independent of each other
     and of bgColor (the plain fill) — null means "not customized yet",
     auto-derived from bgColor's light/dark-ness (isDarkColor, below) so
     existing boards look exactly as before until someone actually picks
     a custom one. */
  var lineAccentColor = null;
  var gridAccentColor = null;

  /* Drawing tools. 'select' is a distinct pseudo-tool, not in this list —
     it's the Illustrator/Figma-style default state where the canvas
     behaves exactly like Board view (pan, click/drag cards, marquee-
     select) and NO stroke can be started. Found live: with a draw tool
     always armed and no way to turn it off, the user couldn't pan or
     select cards at all while Scratch was open — "select mode on, tools
     off; select mode off, tools on" was the explicit fix requested. */
  var TOOLS = ['pen', 'highlighter', 'line', 'arrow', 'rect', 'ellipse', 'eraser'];
  var ERASER_RADIUS = 16; /* screen px — generous enough to hit a thin line without being a "clear half the board" click */
  var currentTool = 'select';
  var currentColor = '#7C5CFC';
  var MIN_WIDTH = 1, MAX_WIDTH = 24, DEFAULT_WIDTH = 3;
  var currentWidth = DEFAULT_WIDTH;
  var currentOpacity = 1;   /* 0.1..1, user-adjustable; highlighter still applies its own extra cap on top */

  /* Audit fix: setState() previously trusted a loaded board file's
     "scratchStrokes" array completely — no cap on stroke count or points
     per stroke, and no per-stroke shape validation. drawStrokes() does a
     full O(strokes * points) redraw on every pan/zoom/resize frame while
     Scratch view is active (see canvas.js's applyTransform() hook), so a
     crafted/corrupted board file with an enormous strokes array (or one
     stroke with millions of points) would make the UI visibly stutter or
     freeze the moment the user pans/zooms/resizes with Scratch open —
     not on file load itself, but on the very next interaction. These
     caps are generous for any real hand-drawn annotation (a few thousand
     points is already an extremely long freehand gesture) while keeping
     a worst-case redraw bounded. */
  var MAX_STROKES = 4000;
  var MAX_POINTS_PER_STROKE = 4000;

  function sanitizeStrokes(raw) {
    if (!Array.isArray(raw)) return [];
    var out = [];
    for (var i = 0; i < raw.length && out.length < MAX_STROKES; i++) {
      var s = raw[i];
      if (!s || typeof s !== 'object' || !Array.isArray(s.points)) continue;
      var tool = TOOLS.indexOf(s.tool) !== -1 ? s.tool : 'pen';
      var color = typeof s.color === 'string' ? s.color : '#7C5CFC';
      var width = (typeof s.width === 'number' && isFinite(s.width)) ? Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, s.width)) : DEFAULT_WIDTH;
      var opacity = (typeof s.opacity === 'number' && isFinite(s.opacity)) ? Math.max(0.1, Math.min(1, s.opacity)) : 1;
      var points = [];
      for (var j = 0; j < s.points.length && points.length < MAX_POINTS_PER_STROKE; j++) {
        var p = s.points[j];
        if (p && typeof p.x === 'number' && typeof p.y === 'number' && isFinite(p.x) && isFinite(p.y)) {
          points.push({ x: p.x, y: p.y });
        }
      }
      if (points.length >= 1) out.push({ tool: tool, color: color, width: width, opacity: opacity, points: points });
    }
    return out;
  }

  /* Committed strokes: { tool, color, points: [{x,y}] } — points are
     world-space. pen/highlighter accumulate many points; line/arrow/
     rect/ellipse store exactly two (start, end). */
  var strokes = [];

  var isDrawing = false;
  var drawStart = null;   /* world {x,y} — shape tools */
  var livePoints = null;  /* world points — pen/highlighter, in progress */

  var redrawRafId = null;

  /* ── Init ── */

  function init() {
    bgCanvas = document.getElementById('scratch-bg-canvas');
    strokeCanvas = document.getElementById('scratch-strokes-canvas');
    toolbarEl = document.getElementById('scratch-toolbar');
    if (!bgCanvas || !strokeCanvas) return;

    bgCtx = bgCanvas.getContext('2d');
    strokeCtx = strokeCanvas.getContext('2d');

    bindToolbar();
    bindDrawing();

    var container = document.getElementById('canvas-container');
    if (container && typeof ResizeObserver !== 'undefined') {
      new ResizeObserver(function() {
        resizeCanvases();
        requestRedraw();
      }).observe(container);
    } else {
      window.addEventListener('resize', function() {
        resizeCanvases();
        requestRedraw();
      });
    }

    resizeCanvases();
  }

  function resizeCanvases() {
    var container = document.getElementById('canvas-container');
    if (!container) return;
    var w = container.clientWidth;
    var h = container.clientHeight;
    if (bgCanvas.width !== w || bgCanvas.height !== h) {
      bgCanvas.width = w;
      bgCanvas.height = h;
    }
    if (strokeCanvas.width !== w || strokeCanvas.height !== h) {
      strokeCanvas.width = w;
      strokeCanvas.height = h;
    }
  }

  /* Called from canvas.js's applyTransform() rAF-throttled redraw hook
     (see the small addition there) so the background and strokes track
     pan/zoom in lockstep with the cards, without Scratch Board owning
     its own separate pan/zoom loop. */
  function redraw() {
    if (!active) return;
    resizeCanvases();
    drawBackground();
    drawStrokes();
  }

  function requestRedraw() {
    if (!active) return;
    if (redrawRafId) return;
    redrawRafId = requestAnimationFrame(function() {
      redrawRafId = null;
      redraw();
    });
  }

  /* ── Show / hide ── */

  function setActive(on) {
    if (active === on) return;
    active = on;

    var grid = document.getElementById('canvas-grid');

    if (active) {
      if (grid) grid.style.display = 'none';
      /* Bug fix (found live): setting style.display = '' only REMOVES an
         inline override, it doesn't force a value — main.css gives both
         these canvases a base `display: none` rule (deliberately, so
         they're hidden before this module ever runs), so clearing back
         to '' just fell through to that stylesheet rule again and left
         them invisible AND non-hit-testable despite `active` being true.
         canvas-grid (below, in the deactivate branch) doesn't have this
         problem — it has no competing stylesheet display rule, so '' does
         correctly fall back to its natural default there. */
      bgCanvas.style.display = 'block';
      strokeCanvas.style.display = 'block';
      if (toolbarEl) toolbarEl.classList.add('visible');
      resizeCanvases();
      redraw();
    } else {
      if (grid) grid.style.display = '';
      bgCanvas.style.display = 'none';
      strokeCanvas.style.display = 'none';
      strokeCanvas.style.pointerEvents = 'none';
      if (toolbarEl) toolbarEl.classList.remove('visible');
      if (typeof KanvazCanvas !== 'undefined' && KanvazCanvas.drawGrid) KanvazCanvas.drawGrid();
    }

    updateToggleBtn();
    syncProperties();
  }

  function isActive() { return active; }

  /* False whenever the Select tool is active, even though Scratch itself
     is — that's the whole point of Select: Illustrator/Figma-style "hands
     off drawing, canvas behaves like Board view" mode. canvas.js checks
     THIS (not isActive()) to decide whether to block its own pan/
     marquee-select gestures. */
  function isToolArmed() { return active && currentTool !== 'select'; }

  /* Bug avoided here: going inactive always falls back to Board (Map's
     own toggle()/updateToggleBtn() runs its own correction right after
     this, in app.js's btn-view-map handler, when the switch is actually
     Scratch -> Map) — so restoring btnBoard's active class unconditionally
     on deactivate is correct for both real target views, not just Board. */
  function updateToggleBtn() {
    var btnBoard   = document.getElementById('btn-view-board');
    var btnScratch = document.getElementById('btn-view-scratch');
    if (btnBoard) {
      if (active) btnBoard.classList.remove('view-toggle-active');
      else btnBoard.classList.add('view-toggle-active');
    }
    if (btnScratch) {
      if (active) btnScratch.classList.add('view-toggle-active');
      else btnScratch.classList.remove('view-toggle-active');
    }
  }

  /* ── Background rendering ──
     Deliberately a single-tier grid/ruled-line renderer, simpler than
     canvas-grid's two-tier minor/major system — this is a plain
     annotate-everything surface, not a precision alignment aid, so the
     extra fidelity isn't worth the complexity here. World-spaced and
     offset by the live viewport (tx/ty/scale) so it pans/zooms exactly
     like canvas-grid does. */

  function isDarkColor(hex) {
    var r = parseInt(hex.substr(1, 2), 16) || 0;
    var g = parseInt(hex.substr(3, 2), 16) || 0;
    var b = parseInt(hex.substr(5, 2), 16) || 0;
    var luma = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    return luma < 0.5;
  }

  function drawBackground() {
    if (!bgCtx) return;
    var w = bgCanvas.width, h = bgCanvas.height;
    bgCtx.clearRect(0, 0, w, h);
    bgCtx.fillStyle = bgColor;
    bgCtx.fillRect(0, 0, w, h);

    if (bgStyle === 'color') return;

    var vp = (typeof KanvazCanvas !== 'undefined' && KanvazCanvas.getViewport)
      ? KanvazCanvas.getViewport() : { tx: 0, ty: 0, scale: 1 };
    var tx = vp.tx, ty = vp.ty, scale = vp.scale || 1;

    var autoColor = isDarkColor(bgColor) ? 'rgba(255,255,255,0.14)' : 'rgba(0,0,0,0.14)';
    bgCtx.strokeStyle = (bgStyle === 'lines' ? lineAccentColor : gridAccentColor) || autoColor;
    bgCtx.lineWidth = 1;

    if (bgStyle === 'lines') {
      var spacing = 28 * scale;
      if (spacing < 6) return; /* too dense to be useful, skip like drawGrid does at extreme zoom */
      var startY = ty % spacing;
      bgCtx.beginPath();
      for (var y = startY; y < h; y += spacing) {
        bgCtx.moveTo(0, Math.round(y) + 0.5);
        bgCtx.lineTo(w, Math.round(y) + 0.5);
      }
      bgCtx.stroke();
    } else if (bgStyle === 'grid') {
      var cell = 24 * scale;
      if (cell < 4) return;
      var offX = tx % cell;
      var offY = ty % cell;
      bgCtx.beginPath();
      for (var gx = offX; gx < w; gx += cell) {
        bgCtx.moveTo(Math.round(gx) + 0.5, 0);
        bgCtx.lineTo(Math.round(gx) + 0.5, h);
      }
      for (var gy = offY; gy < h; gy += cell) {
        bgCtx.moveTo(0, Math.round(gy) + 0.5);
        bgCtx.lineTo(w, Math.round(gy) + 0.5);
      }
      bgCtx.stroke();
    }
  }

  function cycleBgStyle() {
    var idx = BG_STYLES.indexOf(bgStyle);
    bgStyle = BG_STYLES[(idx + 1) % BG_STYLES.length];
    updateBgStyleBtn();
    requestRedraw();
    markDirty();
  }

  function updateBgStyleBtn() {
    var btn = document.getElementById('scratch-tool-bgstyle');
    if (btn) {
      var titles = { lines: 'Background: ruled lines (click to cycle)', color: 'Background: plain color (click to cycle)', grid: 'Background: grid (click to cycle)' };
      btn.title = titles[bgStyle] || 'Background style';
    }
    /* The accent swatch only means something for 'lines'/'grid' (the
       plain 'color' style has no line strokes to tint) — hidden for
       'color', and re-targeted to whichever of lineAccentColor/
       gridAccentColor is relevant whenever the style changes. */
    var accentSwatch = document.getElementById('scratch-accent-color-swatch');
    if (accentSwatch) {
      if (bgStyle === 'color') {
        accentSwatch.style.display = 'none';
      } else {
        accentSwatch.style.display = '';
        accentSwatch.title = (bgStyle === 'lines' ? 'Line' : 'Grid') + ' color';
        var current = (bgStyle === 'lines' ? lineAccentColor : gridAccentColor) || (isDarkColor(bgColor) ? '#ffffff' : '#000000');
        accentSwatch.value = current;
      }
    }
  }

  /* ── Stroke rendering ── */

  /* Takes a stroke-shaped object ({tool, width, opacity, ...}) rather than
     just a tool name, since width/opacity are now per-stroke (captured at
     draw time from the toolbar's live settings — see currentWidth/
     currentOpacity) instead of one fixed value for the whole tool. The
     highlighter still enforces its own minimum width and an opacity
     ceiling on top of whatever the user picked — a 2px "highlighter"
     wouldn't read as one, and a fully opaque one hides everything under
     it, defeating the point of a highlighter. */
  function strokeStyleFor(s) {
    var width = (typeof s.width === 'number') ? s.width : DEFAULT_WIDTH;
    var opacity = (typeof s.opacity === 'number') ? s.opacity : 1;
    if (s.tool === 'highlighter') return { width: Math.max(width, 10), alpha: Math.min(opacity, 0.35), cap: 'round' };
    return { width: width, alpha: opacity, cap: 'round' };
  }

  /* worldToScreen() (canvas.js) returns PAGE-absolute coordinates
     (it adds container.getBoundingClientRect().left/top so cursor math
     works anywhere on the page). strokeCanvas is an absolute, inset:0
     child of #canvas-container, so its own bounding rect is identical to
     the container's — meaning worldToScreen's page-absolute output and
     this canvas's local (0,0)-origin coordinate space differ by exactly
     that same rect.left/top, which is also exactly what worldToScreen
     added. Recomputing from the raw viewport (tx/ty/scale) instead of
     calling worldToScreen + subtracting the rect back out avoids two
     redundant getBoundingClientRect() calls per point on every redraw. */
  function worldToLocal(pt) {
    var vp = (typeof KanvazCanvas !== 'undefined' && KanvazCanvas.getViewport)
      ? KanvazCanvas.getViewport() : { tx: 0, ty: 0, scale: 1 };
    return { x: pt.x * vp.scale + vp.tx, y: pt.y * vp.scale + vp.ty };
  }

  /* projectFn: optional, defaults to worldToLocal (the live canvas's own
     pan/zoom). exportRenderStrokes() (below) passes a DIFFERENT projection
     — the export canvas's own bounding-box/scale, not the live viewport —
     so the same drawing logic renders correctly into either target. */
  function drawOneStroke(ctx, s, projectFn) {
    if (!s.points || s.points.length < 1) return;
    var project = projectFn || worldToLocal;
    var style = strokeStyleFor(s);
    ctx.save();
    ctx.globalAlpha = style.alpha;
    ctx.strokeStyle = s.color;
    ctx.lineWidth = style.width;
    ctx.lineCap = style.cap;
    ctx.lineJoin = 'round';

    if (s.tool === 'pen' || s.tool === 'highlighter') {
      var pts = s.points;
      if (pts.length < 3) {
        ctx.beginPath();
        var only0 = project(pts[0]);
        ctx.moveTo(only0.x, only0.y);
        for (var oi = 1; oi < pts.length; oi++) { var op = project(pts[oi]); ctx.lineTo(op.x, op.y); }
        ctx.stroke();
      } else {
        /* Quadratic-through-midpoints smoothing — a standard, cheap
           freehand-ink technique (each raw point becomes a curve control
           point, the curve itself passes through the MIDPOINT of each
           consecutive pair) that removes the faceted look of a plain
           polyline without any real cost or dependency. Only applied to
           the final committed render, not the live in-progress segment
           drawLiveSegment() paints per pointermove — smoothing needs the
           next point to already exist, which a live last segment doesn't
           have yet, and redoing it every frame would cost more than it's
           worth for a preview that's about to be replaced anyway. */
        ctx.beginPath();
        var p0 = project(pts[0]);
        var p1 = project(pts[1]);
        ctx.moveTo(p0.x, p0.y);
        ctx.lineTo((p0.x + p1.x) / 2, (p0.y + p1.y) / 2);
        for (var i = 1; i < pts.length - 1; i++) {
          var cur = project(pts[i]);
          var next = project(pts[i + 1]);
          var midX = (cur.x + next.x) / 2, midY = (cur.y + next.y) / 2;
          ctx.quadraticCurveTo(cur.x, cur.y, midX, midY);
        }
        var last = project(pts[pts.length - 1]);
        ctx.lineTo(last.x, last.y);
        ctx.stroke();
      }
    } else if (s.points.length >= 2) {
      var a = project(s.points[0]);
      var b = project(s.points[1]);
      if (s.tool === 'line') {
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
      } else if (s.tool === 'arrow') {
        drawArrow(ctx, a.x, a.y, b.x, b.y);
      } else if (s.tool === 'rect') {
        ctx.strokeRect(a.x, a.y, b.x - a.x, b.y - a.y);
      } else if (s.tool === 'ellipse') {
        drawEllipse(ctx, a.x, a.y, b.x, b.y);
      }
    }
    ctx.restore();
  }

  function drawArrow(ctx, x1, y1, x2, y2) {
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
    var angle = Math.atan2(y2 - y1, x2 - x1);
    var headLen = 12;
    ctx.beginPath();
    ctx.moveTo(x2, y2);
    ctx.lineTo(x2 - headLen * Math.cos(angle - Math.PI / 6), y2 - headLen * Math.sin(angle - Math.PI / 6));
    ctx.moveTo(x2, y2);
    ctx.lineTo(x2 - headLen * Math.cos(angle + Math.PI / 6), y2 - headLen * Math.sin(angle + Math.PI / 6));
    ctx.stroke();
  }

  function drawEllipse(ctx, x1, y1, x2, y2) {
    var cx = (x1 + x2) / 2, cy = (y1 + y2) / 2;
    var rx = Math.abs(x2 - x1) / 2, ry = Math.abs(y2 - y1) / 2;
    ctx.beginPath();
    ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
    ctx.stroke();
  }

  /* ── Eraser ── Whole-stroke eraser (drag over a stroke to remove it
     entirely), the standard behavior in whiteboard apps — not pixel-level
     partial erasing, which would need a raster (not vector) stroke model.
     Hit-tests against each stroke's actual rendered geometry in LOCAL
     canvas space (matching where the cursor really is), not just a
     straight line between its two corner points — a rect/ellipse's real
     edges, not the diagonal across its bounding box. */

  function distToSegment(p, a, b) {
    var dx = b.x - a.x, dy = b.y - a.y;
    var lenSq = dx * dx + dy * dy;
    var t = lenSq > 0 ? ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq : 0;
    t = Math.max(0, Math.min(1, t));
    var px = a.x + t * dx, py = a.y + t * dy;
    return Math.sqrt((p.x - px) * (p.x - px) + (p.y - py) * (p.y - py));
  }

  function strokeSegmentsLocal(s) {
    var pts = s.points;
    if (!pts || pts.length < 1) return [];
    if (s.tool === 'pen' || s.tool === 'highlighter') {
      var segs = [];
      var prev = worldToLocal(pts[0]);
      for (var i = 1; i < pts.length; i++) {
        var cur = worldToLocal(pts[i]);
        segs.push([prev, cur]);
        prev = cur;
      }
      return segs;
    }
    if (pts.length < 2) return [];
    var a = worldToLocal(pts[0]), b = worldToLocal(pts[1]);
    if (s.tool === 'line' || s.tool === 'arrow') return [[a, b]];
    if (s.tool === 'rect') {
      var x1 = Math.min(a.x, b.x), x2 = Math.max(a.x, b.x);
      var y1 = Math.min(a.y, b.y), y2 = Math.max(a.y, b.y);
      return [
        [{ x: x1, y: y1 }, { x: x2, y: y1 }],
        [{ x: x2, y: y1 }, { x: x2, y: y2 }],
        [{ x: x2, y: y2 }, { x: x1, y: y2 }],
        [{ x: x1, y: y2 }, { x: x1, y: y1 }]
      ];
    }
    if (s.tool === 'ellipse') {
      var cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2;
      var rx = Math.abs(b.x - a.x) / 2, ry = Math.abs(b.y - a.y) / 2;
      var esegs = [], N = 24, prevP = null;
      for (var k = 0; k <= N; k++) {
        var t = (k / N) * Math.PI * 2;
        var p = { x: cx + rx * Math.cos(t), y: cy + ry * Math.sin(t) };
        if (prevP) esegs.push([prevP, p]);
        prevP = p;
      }
      return esegs;
    }
    return [];
  }

  function eraseAt(localX, localY) {
    var changed = false;
    var p = { x: localX, y: localY };
    for (var i = strokes.length - 1; i >= 0; i--) {
      var style = strokeStyleFor(strokes[i]);
      var radius = ERASER_RADIUS + style.width / 2;
      var segs = strokeSegmentsLocal(strokes[i]);
      for (var j = 0; j < segs.length; j++) {
        if (distToSegment(p, segs[j][0], segs[j][1]) <= radius) {
          strokes.splice(i, 1);
          changed = true;
          break;
        }
      }
    }
    return changed;
  }

  function drawCommittedOnly() {
    if (!strokeCtx) return;
    strokeCtx.clearRect(0, 0, strokeCanvas.width, strokeCanvas.height);
    for (var i = 0; i < strokes.length; i++) drawOneStroke(strokeCtx, strokes[i]);
  }

  function liveStrokeShape() {
    return { tool: currentTool, color: currentColor, width: currentWidth, opacity: currentOpacity };
  }

  function drawStrokes() {
    drawCommittedOnly();
    if (isDrawing) {
      if ((currentTool === 'pen' || currentTool === 'highlighter') && livePoints && livePoints.length) {
        var ls = liveStrokeShape(); ls.points = livePoints;
        drawOneStroke(strokeCtx, ls);
      } else if (drawStart && liveEnd) {
        var ss = liveStrokeShape(); ss.points = [drawStart, liveEnd];
        drawOneStroke(strokeCtx, ss);
      }
    }
  }

  var liveEnd = null;

  /* Perf (found live — a full committed-strokes redraw on every single
     pointermove got visibly laggy once a board had more than a handful
     of strokes on it, same class of frame-cost annotate.js already
     avoids for its own per-card canvas). Same fix as annotate.js's own
     onMove(): draw only what changed for this frame instead of repainting
     the whole layer.
       - pen/highlighter: append ONE short two-point segment per move
         event directly onto the live canvas (no clear) — never re-strokes
         the already-drawn part of the gesture, so this is O(1) per move
         instead of O(points so far), and (for the translucent
         highlighter) avoids the same compounding-opacity bug annotate.js
         documents for the identical reason.
       - line/arrow/rect/ellipse: these have to erase-and-redraw their
         live preview every frame (the shape's extent changes, not just
         grows), so those still need a full-layer restore — but from a
         cached ImageData snapshot taken ONCE at pointerdown, not a
         strokes-array replay every frame. */
  var committedSnapshot = null;
  var lastLivePoint = null;

  function drawLiveSegment(p0, p1) {
    var style = strokeStyleFor(liveStrokeShape());
    var a = worldToLocal(p0), b = worldToLocal(p1);
    strokeCtx.save();
    strokeCtx.globalAlpha = style.alpha;
    strokeCtx.strokeStyle = currentColor;
    strokeCtx.lineWidth = style.width;
    strokeCtx.lineCap = style.cap;
    strokeCtx.lineJoin = 'round';
    strokeCtx.beginPath();
    strokeCtx.moveTo(a.x, a.y);
    strokeCtx.lineTo(b.x, b.y);
    strokeCtx.stroke();
    strokeCtx.restore();
  }

  /* ── Pointer handling ──
     strokeCanvas.style.pointerEvents only becomes 'auto' while a tool is
     armed (see bindToolbar/setTool below) — cards underneath stay fully
     clickable/draggable the rest of the time, per the Q&A's requirement
     that Scratch's card behavior stays identical to Board view. Panning/
     marquee-select on the canvas underneath is blocked for the same
     duration by a matching guard added in canvas.js's own mousedown
     handler (see KanvazScratchBoard.isToolArmed()) — found live: without
     it, a drag meant to draw a stroke also started a pan underneath it
     at the same time. */

  function localPoint(e) {
    var rect = strokeCanvas.getBoundingClientRect();
    return { sx: e.clientX - rect.left, sy: e.clientY - rect.top };
  }

  function toWorld(sx, sy) {
    var container = document.getElementById('canvas-container');
    var rect = container.getBoundingClientRect();
    return KanvazCanvas.screenToWorld(sx + rect.left, sy + rect.top);
  }

  /* Illustrator-style Shift constrain: line/arrow snap to 0/45/90°
     increments, rect/ellipse constrain to equal width/height (a perfect
     square/circle). Computed in WORLD space, which is safe here — the
     board's pan/zoom is a uniform scale + translate (no shear/rotation),
     so an angle or an equal-aspect relationship in world space is the
     same relationship on screen. */
  function constrainShapePoint(start, raw, tool, shiftKey) {
    if (!shiftKey) return raw;
    var dx = raw.x - start.x, dy = raw.y - start.y;
    if (tool === 'line' || tool === 'arrow') {
      var dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < 0.0001) return raw;
      var angle = Math.atan2(dy, dx);
      var snap = Math.round(angle / (Math.PI / 4)) * (Math.PI / 4);
      return { x: start.x + Math.cos(snap) * dist, y: start.y + Math.sin(snap) * dist };
    }
    if (tool === 'rect' || tool === 'ellipse') {
      var m = Math.max(Math.abs(dx), Math.abs(dy));
      return { x: start.x + (dx < 0 ? -m : m), y: start.y + (dy < 0 ? -m : m) };
    }
    return raw;
  }

  function bindDrawing() {
    strokeCanvas.addEventListener('pointerdown', function(e) {
      /* Bug fix (found live): this never checked which button was
         pressed, so a middle-mouse or right-mouse drag while a tool was
         armed drew a stroke too — middle-drag is supposed to be blocked
         entirely (matches canvas.js's own middle-mouse pan, which IS
         correctly blocked while a tool is armed; drawing on top of that
         block defeats the point), and right-click is reserved for a
         future context menu, not a stray line. Left button / primary
         touch or pen contact only (e.button 0), same convention
         canvas.js's own pan logic already uses throughout. */
      if (!active || currentTool === 'select' || e.button !== 0 || strokeCanvas.style.pointerEvents !== 'auto') return;
      e.preventDefault();
      var lp = localPoint(e);
      isDrawing = true;
      if (currentTool === 'eraser') {
        if (eraseAt(lp.sx, lp.sy)) { drawCommittedOnly(); markDirty(); }
      } else {
        var wp = toWorld(lp.sx, lp.sy);
        if (currentTool === 'pen' || currentTool === 'highlighter') {
          livePoints = [wp];
          lastLivePoint = wp;
        } else {
          drawStart = wp;
          liveEnd = wp;
          drawCommittedOnly();
          committedSnapshot = strokeCtx.getImageData(0, 0, strokeCanvas.width, strokeCanvas.height);
        }
      }
      /* setPointerCapture can throw (InvalidPointerId) if the browser's
         internal pointer bookkeeping doesn't consider this pointerId
         "active" at the moment it's called — seen from synthetic/
         automated input, not just real mouse/touch. It's purely an
         optimization here (keeps receiving move/up even if the cursor
         leaves the canvas mid-drag); losing it isn't fatal, an uncaught
         exception here would be, so it's not allowed to propagate. */
      try { strokeCanvas.setPointerCapture && strokeCanvas.setPointerCapture(e.pointerId); } catch (err) {}
    });

    strokeCanvas.addEventListener('pointermove', function(e) {
      if (!isDrawing) return;
      var lp = localPoint(e);
      if (currentTool === 'eraser') {
        if (eraseAt(lp.sx, lp.sy)) drawCommittedOnly();
        return;
      }
      var wp = toWorld(lp.sx, lp.sy);
      if (currentTool === 'pen' || currentTool === 'highlighter') {
        if (!lastLivePoint) { lastLivePoint = wp; livePoints = livePoints || [wp]; return; }
        livePoints.push(wp);
        drawLiveSegment(lastLivePoint, wp);
        lastLivePoint = wp;
      } else {
        /* Defensive: drawStart is always set by pointerdown before
           isDrawing becomes true, but a pointermove landing here with it
           still null (a stray/out-of-order event) must not crash the
           renderer over a single missed frame of a live preview. */
        if (!drawStart) return;
        liveEnd = constrainShapePoint(drawStart, wp, currentTool, e.shiftKey);
        if (committedSnapshot) strokeCtx.putImageData(committedSnapshot, 0, 0);
        var ps = liveStrokeShape(); ps.points = [drawStart, liveEnd];
        drawOneStroke(strokeCtx, ps);
      }
    });

    function finish(e) {
      if (!isDrawing) return;
      isDrawing = false;
      if (currentTool === 'eraser') {
        markDirty();
        return;
      }
      if (currentTool === 'pen' || currentTool === 'highlighter') {
        if (livePoints && livePoints.length > 1) {
          var ls = liveStrokeShape(); ls.points = livePoints;
          strokes.push(ls);
        }
        livePoints = null;
        lastLivePoint = null;
      } else if (drawStart && liveEnd) {
        var dx = liveEnd.x - drawStart.x, dy = liveEnd.y - drawStart.y;
        if (Math.abs(dx) > 1 || Math.abs(dy) > 1) {
          var ss = liveStrokeShape(); ss.points = [drawStart, liveEnd];
          strokes.push(ss);
        }
      }
      drawStart = null;
      liveEnd = null;
      committedSnapshot = null;
      drawCommittedOnly();
      markDirty();
    }

    strokeCanvas.addEventListener('pointerup', finish);
    strokeCanvas.addEventListener('pointercancel', finish);

    /* Bug fix (found live): right-clicking while a draw/eraser tool was
       armed still opened the normal Board right-click menu (New Note,
       Export board, etc.) — canvas.js's own contextmenu handler only
       checks e.target === container/world/gridCanvas, which correctly
       excludes strokeCanvas, so that specific listener was never the
       cause; whatever the exact path, the fix that's actually robust
       regardless of which other listener the event would otherwise
       reach is to stop it right here, at the top of the canvas that's
       supposed to have exclusive control while a tool is armed — same
       principle as the pan-block in canvas.js. In Select mode this
       listener no-ops (isToolArmed() false) and the event passes
       through untouched, same as every other pointer event already
       does — Board view's own right-click menu works exactly as normal
       there. */
    strokeCanvas.addEventListener('contextmenu', function(e) {
      if (isToolArmed()) { e.preventDefault(); e.stopPropagation(); }
    });
  }

  function markDirty() {
    if (typeof KanvazApp !== 'undefined' && KanvazApp.markDirty) KanvazApp.markDirty();
  }

  /* Keeps properties.js's Scratch Board section in sync whenever the
     TOOLBAR is what changed (a Properties-panel-driven change already
     re-renders itself directly, see refreshIfVisible() there) — same
     guarded refresh() call cards.js/history.js already use for the
     per-card case. */
  function syncProperties() {
    if (typeof KanvazProperties !== 'undefined' && KanvazProperties.isSectionVisible &&
        KanvazProperties.isSectionVisible() && KanvazProperties.refresh) {
      KanvazProperties.refresh();
    }
  }

  /* ── Toolbar ── */

  /* Remembers the last drawing tool so "V" (toggleSelectTool, below) can
     jump back to it — mirrors Illustrator/Photoshop's own "hold/press a
     key to flip to Selection, press again to return to what you were
     doing" convention. Defaults to 'pen' before any tool has ever been
     picked. */
  var lastDrawTool = 'pen';

  function setTool(tool) {
    if (tool !== 'select' && TOOLS.indexOf(tool) === -1) return;
    if (tool !== 'select') lastDrawTool = tool;
    currentTool = tool;
    if (tool === 'select') {
      /* pointer-events:none lets clicks/drags pass straight through to
         #canvas-world/cards below, same as Scratch being fully inactive —
         this is the "canvas behaves exactly like Board view" mode. */
      strokeCanvas.style.pointerEvents = 'none';
      strokeCanvas.style.cursor = '';
    } else {
      strokeCanvas.style.pointerEvents = 'auto';
      /* Crosshair while a draw tool is armed — the same visual convention
         Figma/Canva/FigJam use so it's obvious a click will draw, not
         select/pan. */
      strokeCanvas.style.cursor = 'crosshair';
    }
    var btns = document.querySelectorAll('.scratch-tool-btn[data-tool]');
    for (var i = 0; i < btns.length; i++) {
      if (btns[i].getAttribute('data-tool') === tool) btns[i].classList.add('scratch-tool-active');
      else btns[i].classList.remove('scratch-tool-active');
    }
    syncProperties();
  }

  function bindToolbar() {
    var btns = document.querySelectorAll('.scratch-tool-btn[data-tool]');
    for (var i = 0; i < btns.length; i++) {
      (function(btn) {
        btn.addEventListener('click', function() {
          setTool(btn.getAttribute('data-tool'));
        });
      })(btns[i]);
    }

    /* Every input below routes through the same exported setColor/
       setWidth/setOpacity/setBgColor/setTool functions properties.js's
       Scratch section (added this pass) also calls — one code path for
       both surfaces, so a change made in either place is immediately
       reflected in the other (each setter also calls syncProperties()). */
    var colorSwatch = document.getElementById('scratch-color-swatch');
    if (colorSwatch) {
      colorSwatch.value = currentColor;
      colorSwatch.addEventListener('input', function() { setColor(colorSwatch.value); });
    }

    var widthInput = document.getElementById('scratch-width-input');
    if (widthInput) {
      widthInput.value = currentWidth;
      widthInput.addEventListener('input', function() { setWidth(widthInput.value); });
    }

    var opacityInput = document.getElementById('scratch-opacity-input');
    if (opacityInput) {
      opacityInput.value = Math.round(currentOpacity * 100);
      opacityInput.addEventListener('input', function() { setOpacity(opacityInput.value / 100); });
    }

    var bgSwatch = document.getElementById('scratch-bgcolor-swatch');
    if (bgSwatch) {
      bgSwatch.value = bgColor;
      bgSwatch.addEventListener('input', function() { setBgColor(bgSwatch.value); });
    }

    var accentSwatch = document.getElementById('scratch-accent-color-swatch');
    if (accentSwatch) {
      accentSwatch.addEventListener('input', function() {
        if (bgStyle === 'lines') setLineColor(accentSwatch.value);
        else if (bgStyle === 'grid') setGridColor(accentSwatch.value);
      });
    }

    var bgBtn = document.getElementById('scratch-tool-bgstyle');
    if (bgBtn) bgBtn.addEventListener('click', cycleBgStyle);

    var clearBtn = document.getElementById('scratch-tool-clear');
    if (clearBtn) {
      clearBtn.addEventListener('click', confirmClean);
    }

    /* Illustrator/Figma default: Select, not a drawing tool — opening
       Scratch view must not put the user one click away from drawing
       across the whole board by accident. */
    setTool('select');
    updateBgStyleBtn();
  }

  /* ── Persistence — mirrors KanvazMapView.getState()/setState(), wired
     into boards.js's saveCurrentBoardState()/loadBoardState() the same
     way. Camera state is NOT included here: Scratch reuses the same
     KanvazCanvas viewport as Board view (per the Q&A — identical card
     behavior to Board), so canvasTx/canvasTy/canvasScale already cover it. ── */

  function getState() {
    return {
      bgStyle: bgStyle,
      bgColor: bgColor,
      lineAccentColor: lineAccentColor,
      gridAccentColor: gridAccentColor,
      strokes: strokes
    };
  }

  function setState(state) {
    state = state || {};
    bgStyle = BG_STYLES.indexOf(state.bgStyle) !== -1 ? state.bgStyle : 'lines';
    bgColor = state.bgColor || '#1b1b22';
    lineAccentColor = typeof state.lineAccentColor === 'string' ? state.lineAccentColor : null;
    gridAccentColor = typeof state.gridAccentColor === 'string' ? state.gridAccentColor : null;
    strokes = sanitizeStrokes(state.strokes);
    var bgSwatch = document.getElementById('scratch-bgcolor-swatch');
    if (bgSwatch) bgSwatch.value = bgColor;
    updateBgStyleBtn();
  }

  /* ── Live accessors — used by the toolbar's own inputs (bindToolbar,
     above) and by properties.js's Scratch Board section, so both
     surfaces read/drive the exact same state rather than keeping a
     second copy. Every setter also syncs the toolbar's own DOM control,
     so changing a value from Properties is reflected in the toolbar
     immediately (and vice versa, since the toolbar's own inputs call
     these same setters). ── */

  function getTool() { return currentTool; }

  /* "V" toggle (wired from canvas.js, only while Scratch is active — see
     its own comment) — flips between Select (canvas behaves like Board
     view) and whichever drawing tool was last active, matching
     Illustrator/Photoshop's press-to-select, press-again-to-resume
     convention. */
  function toggleSelectTool() {
    setTool(currentTool === 'select' ? lastDrawTool : 'select');
  }
  function getColor() { return currentColor; }
  function setColor(hex) {
    if (typeof hex !== 'string') return;
    currentColor = hex;
    var el = document.getElementById('scratch-color-swatch');
    if (el) el.value = hex;
  }
  function getWidth() { return currentWidth; }
  function setWidth(v) {
    v = parseFloat(v);
    if (!isFinite(v)) return;
    currentWidth = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, v));
    var el = document.getElementById('scratch-width-input');
    if (el) el.value = currentWidth;
  }
  function getOpacity() { return currentOpacity; }
  function setOpacity(v) {
    v = parseFloat(v);
    if (!isFinite(v)) return;
    currentOpacity = Math.max(0.1, Math.min(1, v));
    var el = document.getElementById('scratch-opacity-input');
    if (el) el.value = Math.round(currentOpacity * 100);
  }
  function getBgStyle() { return bgStyle; }
  function setBgStyle(style) {
    if (BG_STYLES.indexOf(style) === -1) return;
    bgStyle = style;
    updateBgStyleBtn();
    requestRedraw();
    markDirty();
    syncProperties();
  }
  function getBgColor() { return bgColor; }
  function setBgColor(hex) {
    if (typeof hex !== 'string') return;
    bgColor = hex;
    var el = document.getElementById('scratch-bgcolor-swatch');
    if (el) el.value = hex;
    requestRedraw();
    markDirty();
  }
  function getLineColor() { return lineAccentColor; }
  function setLineColor(hex) {
    if (typeof hex !== 'string') return;
    lineAccentColor = hex;
    updateBgStyleBtn();
    requestRedraw();
    markDirty();
  }
  function getGridColor() { return gridAccentColor; }
  function setGridColor(hex) {
    if (typeof hex !== 'string') return;
    gridAccentColor = hex;
    updateBgStyleBtn();
    requestRedraw();
    markDirty();
  }
  function getStrokeCount() { return strokes.length; }

  /* ── Export support (cards.js's generateExportCanvas) ──
     Board/selection image export used to have zero awareness of Scratch
     content at all — an exported PNG/JPEG of a board with real strokes on
     it silently left them out, found live by the owner exporting a board
     that was mostly Scratch annotations and getting back what looked like
     a near-blank image (whatever real cards existed, rendered as their
     placeholder box; the strokes themselves nowhere). These two functions
     give cards.js a way to fold Scratch content into the SAME export
     canvas it already builds for cards, without cards.js needing to know anything
     about stroke geometry — it computes its own bounding box/scale (the
     same way it already does for cards) and hands this module a plain
     world-point -> canvas-local-point function to draw through. */

  function getStrokesWorldBounds() {
    var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (var i = 0; i < strokes.length; i++) {
      var pts = strokes[i].points;
      for (var j = 0; j < pts.length; j++) {
        if (pts[j].x < minX) minX = pts[j].x;
        if (pts[j].y < minY) minY = pts[j].y;
        if (pts[j].x > maxX) maxX = pts[j].x;
        if (pts[j].y > maxY) maxY = pts[j].y;
      }
    }
    if (minX === Infinity) return null;
    return { minX: minX, minY: minY, maxX: maxX, maxY: maxY };
  }

  function exportRenderStrokes(ctx, mapFn) {
    for (var i = 0; i < strokes.length; i++) drawOneStroke(ctx, strokes[i], mapFn);
  }
  function clearStrokes() {
    strokes = [];
    drawStrokes();
    markDirty();
    syncProperties();
  }

  /* Bug fix (found live): this used to fall back to window.confirm() — a
     plain OS-native dialog (title bar, native button chrome) that breaks
     the custom UI entirely, something the app has a standing rule
     against anywhere in Kanvaz. There is no KanvazUI.confirm() — the
     app's real confirmation mechanism is KanvazUI.showDialog(title,
     message, buttons), the same one boards.js's "Delete board?" and
     app.js's "Unsaved changes" dialogs already use — so this now calls
     that directly instead of a function that never existed. Shared by
     both the toolbar's own clear button and properties.js's "Clean
     board" button, so there's one call site to keep in sync, not two. */
  function confirmClean() {
    if (!strokes.length) return;
    if (typeof KanvazUI === 'undefined' || !KanvazUI.showDialog) { clearStrokes(); return; }
    KanvazUI.showDialog(
      'Clean board?',
      'This removes every stroke on this Scratch Board — not undo-reversible.',
      [
        { label: 'Clean board', cls: 'danger', action: function() { clearStrokes(); } },
        { label: 'Cancel', cls: '', action: function() {} }
      ]
    );
  }

  return {
    init: init,
    setActive: setActive,
    isActive: isActive,
    isToolArmed: isToolArmed,
    redraw: redraw,
    getState: getState,
    setState: setState,
    TOOLS: TOOLS,
    BG_STYLES: BG_STYLES,
    setTool: setTool,
    getTool: getTool,
    toggleSelectTool: toggleSelectTool,
    getColor: getColor,
    setColor: setColor,
    getWidth: getWidth,
    setWidth: setWidth,
    getOpacity: getOpacity,
    setOpacity: setOpacity,
    getBgStyle: getBgStyle,
    setBgStyle: setBgStyle,
    getBgColor: getBgColor,
    setBgColor: setBgColor,
    getLineColor: getLineColor,
    setLineColor: setLineColor,
    getGridColor: getGridColor,
    setGridColor: setGridColor,
    getStrokeCount: getStrokeCount,
    getStrokesWorldBounds: getStrokesWorldBounds,
    exportRenderStrokes: exportRenderStrokes,
    clearStrokes: clearStrokes,
    confirmClean: confirmClean
  };

})();
