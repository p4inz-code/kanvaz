/* map-view.js — relationship map visualization (v3.0)
 *
 * Node-editor-style view: references as cards with connection ports,
 * linked by bezier "tube" curves. Drag from a port to connect.
 */

var KanvazMapView = (function() {

  /* ── State ── */
  var container = null;
  var world     = null;
  var svg       = null;
  var active    = false;
  var gridCanvas = null;
  var gridCtx    = null;
  var gridRafId  = null;
  var lastGridTx = null;
  var lastGridTy = null;
  var lastGridScale = null;
  var resizeRafId = null;

  var tx    = 0;
  var ty    = 0;
  var scale = 1.0;

  var ZOOM_MIN  = 0.15;
  var ZOOM_MAX  = 3.0;
  var ZOOM_STEP = 0.08;

  var isPanning   = false;
  var panStartX   = 0;
  var panStartY   = 0;
  var panOriginX  = 0;
  var panOriginY  = 0;

  var selectedNode = null;
  var dragNode     = null;
  var dragOffsetX  = 0;
  var dragOffsetY  = 0;

  /* Multi-select (4.7.0) — deliberately kept separate from selectedNode
     above rather than folded into it: selectedNode drives connection
     highlighting, Properties/Inspector open, and single-drag, none of
     which have an obvious "which one" answer for a multi-selection.
     Additive layer instead of a rewrite of the existing single-select
     path, so nothing already working risks regressing. */
  var multiSelected  = {};   /* refId -> true */
  var marqueeEl      = null;
  var marqueeStartX  = 0;
  var marqueeStartY  = 0;
  var groupDragStart = null; /* {x, y} world coords at drag start, for multi-node drag */
  var groupDragOrigins = null; /* refId -> {x, y} mapPosition at drag start */

  /* Wire-drag state (connecting) */
  var wireFrom     = null;   /* ref ID we're dragging a wire from */
  var wirePreview  = null;   /* live SVG path element */
  var hasRenderedOnce = false;

  /* ── Node sizing ── */
  var NODE_W      = 176;   /* border-box width (global * reset forces box-sizing:border-box) */
  var NODE_H      = 52;    /* content-box height */
  var NODE_BORDER = 1.5;
  var PORT_INSET  = 1;     /* Measured offset of port-dot center from node
                              border-box edge. Empirically verified against
                              real Chromium layout: OUT center = mapX+NODE_W-1,
                              IN center = mapX+1. The 1px = half the dot's own
                              2px border. See /tmp port test. DO NOT change
                              without re-running the browser measurement. */
  var NODE_PAD    = 14;    /* padding: 0 14px */
  var NODE_FULL_W = NODE_W;  /* border-box: width already includes border+padding */
  var NODE_FULL_H = NODE_H;  /* border-box: height already includes border */
  var PORT_R      = 7;   /* port dot radius */
  var AUTO_COLS   = 5;
  var AUTO_GAP_X  = 240;
  var AUTO_GAP_Y  = 90;

  /* ── Node color-coding (4.7.0) ──
     By tag if the card has one (deterministic hash -> hue, so the same
     tag always gets the same color across a session without needing a
     stored palette), else by card type from this fixed set — visual
     grouping at a glance, the actual ask, without needing a UI toggle
     between "by tag" and "by type" modes. */
  var NODE_TYPE_COLORS = {
    image: '#5FA8E0', gif: '#F0A500', video: '#FF5A5A', audio: '#4CAF82',
    note: '#9D7FFF', text: '#9D7FFF', url: '#5FA8E0', color: '#F0A500', file: '#8F8FC2'
  };

  function hashColor(str) {
    var hash = 0;
    for (var i = 0; i < str.length; i++) hash = (hash * 31 + str.charCodeAt(i)) | 0;
    var hue = Math.abs(hash) % 360;
    return 'hsl(' + hue + ', 65%, 60%)';
  }

  function nodeAccentColor(card) {
    if (card.tags && card.tags.length) return hashColor(card.tags[0]);
    return NODE_TYPE_COLORS[card.type] || 'var(--color-border-2)';
  }

  /* ── Type colors ──
     Polish fix: kept in sync with inspector.js's TYPE_COLORS, which has
     the full reasoning — was a raw, unmodified Tailwind palette with no
     relation to Kanvaz's own purple-accent identity; recolored to the
     app's actual tokens where a fit exists, plus two new hand-picked
     hues only where 7 distinct types need more separation than 4
     existing tokens provide. */
  var TYPE_COLORS = {
    RelatedTo:     '#8F8FC2',
    InspiredBy:    '#9D7FFF',
    DerivedFrom:   '#5FA8E0',
    AlternativeTo: '#F0A500',
    Supports:      '#4CAF82',
    UsedIn:        '#FF5A5A',
    References:    '#E07AC0'
  };

  function typeColor(t) { return TYPE_COLORS[t] || '#6B7280'; }
  function typeLabel(t) { return t.replace(/([A-Z])/g, ' $1').trim(); }

  /* ══════════════════════════════════════════
     BEZIER MATH — Unreal/Maya style
     ══════════════════════════════════════════ */

  /* High-tension horizontal bezier — control points pull far out
     horizontally so the cable "pours" out of the port before curving.
     Minimum tension of 90px ensures short-distance connections still
     look like cables not diagonal lines. */
  function bezierPath(x1, y1, x2, y2) {
    var dx = x2 - x1;
    /* Tension is distance-proportional but floored at 90 and capped
       so very long connections don't look too stiff */
    var tension = Math.max(90, Math.min(Math.abs(dx) * 0.55, 320));
    /* When target is to the LEFT of source, increase tension further
       so the cable loops around gracefully */
    if (dx < 0) tension = Math.max(140, Math.abs(dx) * 0.7);
    return 'M ' + x1 + ' ' + y1
      + ' C ' + (x1 + tension) + ' ' + y1
      + ', '  + (x2 - tension) + ' ' + y2
      + ', '  + x2 + ' ' + y2;
  }

  /* ══════════════════════════════════════════
     PORT POSITIONS — pure world-space arithmetic

     The SVG and all nodes are children of #map-world, which carries the
     pan/zoom transform. So SVG draws in WORLD coordinates — the same
     space where nodes are positioned via left/top = mapPosition.x/y.

     Port dot centers (from their CSS, box-sizing:border-box):
       Output: right:-PORT_R, top:50% → center at (mapPos.x + NODE_W, mapPos.y + NODE_H/2)
       Input:  left:-PORT_R,  top:50% → center at (mapPos.x,          mapPos.y + NODE_H/2)

     No getBoundingClientRect. No screen→world conversion. No cache.
     This is exact because SVG and nodes share the world coordinate system.
     ══════════════════════════════════════════ */

  /* ══════════════════════════════════════════
     PORT POSITIONS

     TWO sources, used in different contexts:

     1. outPort/inPort — MATH from mapPosition. Fast, used for the
        bezier PATH shape (control points, midpoint labels) where a
        1px difference is invisible.

     2. domPort — reads the ACTUAL rendered port-dot center from the
        DOM via getBoundingClientRect, converted to world coords. This
        is the SINGLE SOURCE OF TRUTH for tube ENDPOINTS and terminator
        dots, because it reflects hover transforms, sub-pixel rounding,
        and any node shift that stored mapPosition doesn't capture.

     Real node editors anchor wires to the DOM handle, not to stored
     coordinates. That's what domPort does.
     ══════════════════════════════════════════ */

  function outPort(card) {
    return {
      x: card.mapPosition.x + NODE_W - PORT_INSET,
      y: card.mapPosition.y + NODE_H / 2
    };
  }
  function inPort(card) {
    return {
      x: card.mapPosition.x + PORT_INSET,
      y: card.mapPosition.y + NODE_H / 2
    };
  }

  /* Read the live rendered port-dot center in WORLD coordinates.
     Returns null if the node/port isn't in the DOM yet or if the
     rect is zero-sized (hidden, mid-animation, DPI edge-case on
     some Windows machines). Caller falls back to math. */
  function domPort(refId, side) {
    if (!world) return null;
    var cls = (side === 'out') ? '.map-port-out' : '.map-port-in';
    var dot = document.querySelector('.map-node[data-ref-id="' + refId + '"] ' + cls);
    if (!dot) return null;
    var wRect = world.getBoundingClientRect();
    var dRect = dot.getBoundingClientRect();
    /* Guard: zero-size rects mean the element isn't laid out yet
       (display:none ancestor, entrance animation at frame 0, or
       a DPI-scaling edge-case on certain Windows setups). Return
       null so the caller uses the math fallback instead of (0,0). */
    if (dRect.width === 0 || dRect.height === 0) return null;
    if (wRect.width === 0 || wRect.height === 0) return null;
    var x = (dRect.left + dRect.width / 2 - wRect.left) / scale;
    var y = (dRect.top  + dRect.height / 2 - wRect.top) / scale;
    /* Sanity: if the computed position is wildly outside the expected
       range, the DOM read was unreliable — fall back to math instead.
       Audit fix: this was a flat 50000 constant, never checked against
       the auto-layout math below (AUTO_COLS=5, AUTO_GAP_Y=90 → any card
       without a manual mapPosition gets y = floor(idx/5)*90+60). Solving
       for where that first exceeds 50000 gives row 556, i.e. card index
       ~2780 — past that point, EVERY auto-laid-out card on a large board
       permanently fell back to the less-accurate math-based port
       position instead of the real DOM one, a correctness cliff that
       gets worse the bigger the board. Raised generously so it only
       ever catches genuinely bogus values (corruption, a stray NaN/
       Infinity slipping through), not legitimate large-board layouts —
       comfortably covers tens of thousands of auto-positioned cards. */
    if (x < -5000 || x > 500000 || y < -5000 || y > 500000) return null;
    return { x: x, y: y };
  }

  /* Resolved endpoint: DOM truth if available, else math fallback.
     domPort() itself guards against unreliable reads (unlaid-out nodes,
     zero-size rects mid-animation) and returns null in those cases. */
  function resolveOut(card) {
    /* BUG fix: this used to hard-skip domPort() for the entire first-open
       animation window (useMathOnly) and fall back to a hand-measured
       "PORT_INSET" pixel constant instead — calibrated once against one
       Chromium render. On a different DPI/scaling setup that constant is
       simply wrong, which showed up as cables/ports being persistently
       misaligned on some Windows machines and not others. domPort() already
       has its own per-node, per-call zero-rect guard (falls back to math
       only when a node genuinely isn't laid out yet), so it's always safe
       to try it first — no need for a blanket window that forces the
       fragile constant on machines where it doesn't hold. */
    var dom = domPort(card.id, 'out');
    return dom || outPort(card);
  }
  function resolveIn(card) {
    var dom = domPort(card.id, 'in');
    return dom || inPort(card);
  }

  /* ══════════════════════════════════════════
     INIT
     ══════════════════════════════════════════ */

  function init() {
    if (container) return;

    container = document.createElement('div');
    container.id = 'map-container';
    container.style.cssText = [
      'position:absolute', 'inset:0', 'overflow:hidden',
      'display:none', 'background:var(--color-bg)'
    ].join(';');

    gridCanvas = document.createElement('canvas');
    gridCanvas.id = 'map-grid';
    gridCanvas.style.cssText = ['position:absolute', 'left:0', 'top:0'].join(';');
    gridCtx = gridCanvas.getContext('2d');
    container.appendChild(gridCanvas);

    world = document.createElement('div');
    world.id = 'map-world';
    world.style.cssText = [
      'position:absolute', 'left:0', 'top:0',
      'width:1px', 'height:1px', 'transform-origin:0 0'
    ].join(';');

    svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('id', 'map-svg');
    svg.style.cssText = [
      'position:absolute', 'left:0', 'top:0',
      'width:1px', 'height:1px', 'overflow:visible',
      'pointer-events:none'
    ].join(';');

    world.appendChild(svg);
    container.appendChild(world);

    var cc = document.getElementById('canvas-container');
    if (cc) cc.appendChild(container);

    resizeMapGrid();
    window.addEventListener('resize', function() {
      resizeMapGrid();
      if (!active) return;
      drawMapGrid();
      /* Audit fix: connection lines were never re-derived on resize —
         only the background grid was. domPort()'s live DOM measurement
         (see PORT POSITIONS above) is correct at the instant it runs,
         but a window resize (or a Windows display-scaling change, which
         fires as a resize event too) shifts every node's
         getBoundingClientRect() without anything telling renderLines()
         to recompute. Cables stayed pinned to wherever they were last
         drawn — reported as "starts at the wrong point, ends at the
         wrong point" specifically after a resize/DPI change, not on a
         fresh Map View open (which already re-renders via the settle
         loop below).
         Audit fix #2: renderLines() rebuilds every connection's DOM
         (removes+recreates SVG elements, one getBoundingClientRect
         pair per port) — expensive, and native OS drag-resize fires
         'resize' continuously, once per frame. Coalescing through a
         single in-flight rAF (same pattern applyTransform() already
         uses for the grid below) collapses a whole burst of resize
         events into one re-render right after the drag settles,
         instead of rebuilding the SVG on every intermediate frame. */
      if (!resizeRafId) {
        resizeRafId = requestAnimationFrame(function() {
          resizeRafId = null;
          renderLines(false);
        });
      }
    });

    bindEvents();
  }

  /* ══════════════════════════════════════════
     EVENTS
     ══════════════════════════════════════════ */

  function bindEvents() {

    /* Scroll zoom */
    container.addEventListener('wheel', function(e) {
      e.preventDefault();
      cancelCameraAnim();
      var dir = e.deltaY < 0 ? 1 : -1;
      var newScale = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, scale + dir * ZOOM_STEP));
      var rect = container.getBoundingClientRect();
      var mx = e.clientX - rect.left;
      var my = e.clientY - rect.top;
      var wx = (mx - tx) / scale;
      var wy = (my - ty) / scale;
      tx = mx - wx * newScale;
      ty = my - wy * newScale;
      scale = newScale;
      applyTransform();
      updateZoomDisplay();
    }, { passive: false });

    /* Mousedown — pan, node drag, port drag */
    container.addEventListener('mousedown', function(e) {

      /* Port click — start or complete a wire */
      var portEl = e.target.closest('.map-port');
      if (portEl && e.button === 0) {
        e.preventDefault();
        e.stopPropagation();
        var nodeEl = portEl.closest('.map-node');
        if (!nodeEl) return;
        var portRefId = nodeEl.dataset.refId;

        /* If already wiring, complete the connection to this node */
        if (wireFrom && wireFrom !== portRefId) {
          completeWire(portRefId);
          return;
        }

        /* Only start wires from the output port (right side) */
        if (portEl.classList.contains('map-port-out') && !wireFrom) {
          startWire(portRefId);
        }
        return;
      }

      var nodeEl = e.target.closest('.map-node');

      /* Shift+drag on empty area — marquee select, instead of pan.
         Shift+click on a node — toggle it in the multi-selection,
         instead of the normal single-select. Plain click/drag keeps
         its existing meaning either way (pan on empty area, single-
         select+drag on a node) so nothing already working changes
         unless Shift is actually held. */
      if (e.button === 0 && e.shiftKey) {
        e.preventDefault();
        if (nodeEl) {
          var toggleId = nodeEl.dataset.refId;
          if (multiSelected[toggleId]) delete multiSelected[toggleId];
          else multiSelected[toggleId] = true;
          applyMultiSelectStyles();
          updateBulkActionBar();
        } else {
          startMarquee(e);
        }
        return;
      }

      /* Pan — middle-click or left-click empty area */
      if (e.button === 1 || (e.button === 0 && !nodeEl)) {
        e.preventDefault();
        cancelCameraAnim();
        isPanning  = true;
        panStartX  = e.clientX;
        panStartY  = e.clientY;
        panOriginX = tx;
        panOriginY = ty;
        container.style.cursor = 'grabbing';
        selectNode(null);
        clearMultiSelect();
        cancelWire();
        return;
      }

      /* Node click */
      if (nodeEl && e.button === 0) {
        var refId = nodeEl.dataset.refId;

        /* If wiring, complete the connection */
        if (wireFrom && wireFrom !== refId) {
          completeWire(refId);
          return;
        }

        selectNode(refId);
        cancelPreview();

        /* Start drag — if this node is part of an active multi-
           selection, drag the whole group together instead of just
           this one node. */
        var cardsNow = KanvazCards.getAll();
        if (multiSelected[refId]) {
          var rect0 = container.getBoundingClientRect();
          groupDragStart = {
            x: (e.clientX - rect0.left - tx) / scale,
            y: (e.clientY - rect0.top  - ty) / scale
          };
          groupDragOrigins = {};
          for (var gid in multiSelected) {
            var gcard = cardsNow[gid];
            if (gcard && gcard.mapPosition) groupDragOrigins[gid] = { x: gcard.mapPosition.x, y: gcard.mapPosition.y };
          }
        } else {
          clearMultiSelect();
        }

        dragNode = refId;
        var nRect = nodeEl.getBoundingClientRect();
        dragOffsetX = (e.clientX - nRect.left) / scale;
        dragOffsetY = (e.clientY - nRect.top)  / scale;
        e.preventDefault();
        return;
      }
    });

    /* Mousemove — pan, drag, wire preview */
    window.addEventListener('mousemove', function(e) {
      if (!active) return;

      if (isPanning) {
        tx = panOriginX + (e.clientX - panStartX);
        ty = panOriginY + (e.clientY - panStartY);
        applyTransform();
        return;
      }

      if (marqueeEl) {
        updateMarquee(e);
        return;
      }

      if (dragNode) {
        var rect = container.getBoundingClientRect();
        var cards = KanvazCards.getAll();

        /* Group drag — move every multi-selected node by the same
           world-space delta the primary dragged node has moved. */
        if (groupDragStart && groupDragOrigins) {
          var curX = (e.clientX - rect.left - tx) / scale;
          var curY = (e.clientY - rect.top  - ty) / scale;
          var dx = curX - groupDragStart.x;
          var dy = curY - groupDragStart.y;
          for (var gid in groupDragOrigins) {
            var gcard = cards[gid];
            if (!gcard) continue;
            var origin = groupDragOrigins[gid];
            if (!gcard.mapPosition) gcard.mapPosition = { x: 0, y: 0 };
            gcard.mapPosition.x = Math.round(origin.x + dx);
            gcard.mapPosition.y = Math.round(origin.y + dy);
            var gel = document.querySelector('.map-node[data-ref-id="' + gid + '"]');
            if (gel) {
              gel.style.left = gcard.mapPosition.x + 'px';
              gel.style.top  = gcard.mapPosition.y + 'px';
            }
          }
          renderLines();
          return;
        }

        var wx = (e.clientX - rect.left - tx) / scale - dragOffsetX;
        var wy = (e.clientY - rect.top  - ty) / scale - dragOffsetY;
        var card  = cards[dragNode];
        if (card) {
          if (!card.mapPosition) card.mapPosition = { x: 0, y: 0 };
          card.mapPosition.x = Math.round(wx);
          card.mapPosition.y = Math.round(wy);
          var el = document.querySelector('.map-node[data-ref-id="' + dragNode + '"]');
          if (el) {
            el.style.left = card.mapPosition.x + 'px';
            el.style.top  = card.mapPosition.y + 'px';
          }
          renderLines();
        }
        return;
      }

      /* Wire preview — follow cursor from source port (pure world coords) */
      if (wireFrom && wirePreview) {
        var rect2 = container.getBoundingClientRect();
        var mx = (e.clientX - rect2.left - tx) / scale;
        var my = (e.clientY - rect2.top  - ty) / scale;
        var fromCard = KanvazCards.getAll()[wireFrom];
        if (fromCard && fromCard.mapPosition) {
          var origin = resolveOut(fromCard);
          wirePreview.setAttribute('d', bezierPath(origin.x, origin.y, mx, my));
        }
      }
    });

    /* Mouseup */
    window.addEventListener('mouseup', function(e) {
      if (!active) return;
      if (isPanning) {
        isPanning = false;
        container.style.cursor = '';
      }
      if (marqueeEl) {
        finishMarquee(e);
      }
      if (dragNode) {
        KanvazApp.markDirty();
        KanvazHistory.push();
        dragNode = null;
        groupDragStart = null;
        groupDragOrigins = null;
        container.style.cursor = '';
      }
    });

    /* Double-click node — jump to Board View and center that card */
    container.addEventListener('dblclick', function(e) {
      var nodeEl = e.target.closest('.map-node');
      if (!nodeEl) return;
      var refId = nodeEl.dataset.refId;
      if (!refId) return;
      e.preventDefault();
      hide();
      updateToggleBtn();
      KanvazCards.selectCard(refId);
      /* Center the card in viewport */
      var cardEl = document.getElementById(refId);
      if (cardEl) {
        var cc = document.getElementById('canvas-container');
        var cScale = KanvazCanvas.getScale();
        var cx = cardEl.offsetLeft + cardEl.offsetWidth / 2;
        var cy = cardEl.offsetTop + cardEl.offsetHeight / 2;
        var vpW = cc ? cc.clientWidth : window.innerWidth;
        var vpH = cc ? cc.clientHeight : window.innerHeight;
        KanvazCanvas.panTo(vpW / 2 - cx * cScale, vpH / 2 - cy * cScale);
      }
    });

    /* Right-click */
    container.addEventListener('contextmenu', function(e) {
      e.preventDefault();
      var nodeEl = e.target.closest('.map-node');
      if (nodeEl) showNodeMenu(nodeEl.dataset.refId, e.clientX, e.clientY);
    });
  }

  /* ══════════════════════════════════════════
     WIRE DRAGGING (connect by dragging)
     ══════════════════════════════════════════ */

  function startWire(fromRefId) {
    wireFrom = fromRefId;
    container.style.cursor = 'crosshair';

    /* Highlight source port */
    var portEl = document.querySelector('.map-node[data-ref-id="' + fromRefId + '"] .map-port-out');
    if (portEl) {
      portEl.style.background = 'var(--color-accent)';
      portEl.style.transform = 'translateY(-50%) scale(1.4)';
      portEl.style.boxShadow = '0 0 0 6px var(--color-accent-bg)';
    }

    /* Create preview bezier */
    wirePreview = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    wirePreview.setAttribute('stroke', 'var(--color-accent)');
    wirePreview.setAttribute('stroke-width', '2.5');
    wirePreview.setAttribute('stroke-dasharray', '6 4');
    wirePreview.setAttribute('fill', 'none');
    wirePreview.setAttribute('stroke-linecap', 'round');
    wirePreview.setAttribute('opacity', '0.9');
    wirePreview.style.filter = 'drop-shadow(0 0 6px var(--color-accent))';
    wirePreview.style.pointerEvents = 'none';
    svg.appendChild(wirePreview);

    KanvazUI.toast('Drop on a reference to connect \u00B7 Esc to cancel');
  }

  function completeWire(toRefId) {
    if (!wireFrom || wireFrom === toRefId) {
      cancelWire();
      return;
    }
    var fromId = wireFrom;
    cancelWire();
    showTypePicker(fromId, toRefId);
  }

  function cancelWire() {
    if (wirePreview && wirePreview.parentNode) {
      wirePreview.parentNode.removeChild(wirePreview);
    }
    wirePreview = null;

    if (wireFrom) {
      var portEl = document.querySelector('.map-node[data-ref-id="' + wireFrom + '"] .map-port-out');
      if (portEl) {
        portEl.style.background = 'var(--color-port)';
        portEl.style.transform = 'translateY(-50%)';
        portEl.style.boxShadow = '';
      }
    }
    wireFrom = null;
    if (container) container.style.cursor = '';
  }

  /* ══════════════════════════════════════════
     TRANSFORM
     ══════════════════════════════════════════ */

  function applyTransform() {
    if (!world) return;
    world.style.transform = 'translate(' + tx + 'px,' + ty + 'px) scale(' + scale + ')';
    if (!gridRafId) {
      gridRafId = requestAnimationFrame(function() {
        gridRafId = null;
        if (tx === lastGridTx && ty === lastGridTy && scale === lastGridScale) return;
        lastGridTx = tx; lastGridTy = ty; lastGridScale = scale;
        drawMapGrid();
      });
    }
  }

  function resizeMapGrid() {
    if (!gridCanvas || !container) return;
    gridCanvas.width  = container.clientWidth;
    gridCanvas.height = container.clientHeight;
  }

  /* Same dot-grid visual language as Board View (canvas.js) — kept as a
     separate copy rather than a cross-module call, since Map View has
     its own independent tx/ty/scale state and the two views' grids
     need to stay visually identical without coupling the two modules. */
  function drawMapGrid() {
    if (!gridCtx || !gridCanvas) return;
    var w = gridCanvas.width;
    var h = gridCanvas.height;
    gridCtx.clearRect(0, 0, w, h);

    var baseSpacing = 24;
    var spacing = baseSpacing * scale;

    /* Audit fix (4.7.0) — same fix as canvas.js's drawGrid(): fading to
       exactly 0 AT ZOOM_MIN meant the grid vanished completely right at
       the most-zoomed-out view, exactly when a large board needs it
       most. Fading toward a floor below ZOOM_MIN instead means alpha
       never actually reaches 0 within the reachable zoom range. */
    var GRID_FADE_FLOOR = ZOOM_MIN * 0.5;
    var alpha = 1.0;
    if (scale < 0.25) alpha = (scale - GRID_FADE_FLOOR) / (0.25 - GRID_FADE_FLOOR);
    if (scale > 3.0)  alpha = 1.0 - (scale - 3.0) / (ZOOM_MAX - 3.0);
    alpha = Math.max(0, Math.min(1, alpha));
    if (alpha <= 0) return;

    var ox = ((tx % spacing) + spacing) % spacing;
    var oy = ((ty % spacing) + spacing) % spacing;

    var isLight = document.documentElement.getAttribute('data-theme') === 'light';
    var lineColor = isLight ? '0, 0, 0' : '255, 255, 255';
    var minorAlpha = (isLight ? 0.10 : 0.09) * alpha;
    var majorAlpha = (isLight ? 0.22 : 0.20) * alpha;

    /* Node-editor "blueprint" grid — minor lines every cell, a bolder
       major line every 5th, matching the graph-editor look artists
       already know from Blender/UE/Houdini rather than a dot field. */
    var MAJOR_EVERY = 5;
    var majorSpacing = spacing * MAJOR_EVERY;
    var majorOx = ((tx % majorSpacing) + majorSpacing) % majorSpacing;
    var majorOy = ((ty % majorSpacing) + majorSpacing) % majorSpacing;

    /* Density fade — lines packed closer than ~12-24px apart visually
       merge into a wash (this was the "grid goes white zooming out"
       bug — empirically measured, not guessed: pixel brightness
       climbed 21→155 well before the old fixed cutoff kicked in).
       Fade each line type out smoothly as its own spacing approaches
       the merge threshold instead of an abrupt cutoff. */
    var minorFade = 1.0;
    if (spacing < 20) minorFade = Math.max(0, (spacing - 12) / (20 - 12));
    minorAlpha *= minorFade;

    var majorFade = 1.0;
    if (majorSpacing < 40) majorFade = Math.max(0, (majorSpacing - 24) / (40 - 24));
    majorAlpha *= majorFade;

    gridCtx.lineWidth = 1;

    /* Minor lines — single path for all of them (one fill/stroke call) */
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

    /* Major lines on top, bolder */
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

  /* ══════════════════════════════════════════
     EASED CAMERA MOVES (fitAll / resetView only)
     Deliberately NOT used for wheel-zoom or drag-pan — those are
     already tuned jank-free via rAF-throttled direct assignment
     (v3.5.x lag fix). This is only for one-shot, discrete camera
     jumps, where a short eased tween reads as "premium" instead
     of "polling". Any user interaction cancels it immediately so
     it never fights real input.
     ══════════════════════════════════════════ */
  var camAnimFrame = null;

  function cancelCameraAnim() {
    if (camAnimFrame) { cancelAnimationFrame(camAnimFrame); camAnimFrame = null; }
  }

  function animateCameraTo(targetTx, targetTy, targetScale, durationMs) {
    cancelCameraAnim();
    var fromTx = tx, fromTy = ty, fromScale = scale;
    var startTime = null;

    function easeOutCubic(t) { return 1 - Math.pow(1 - t, 3); }

    function step(now) {
      if (startTime === null) startTime = now;
      var elapsed = now - startTime;
      var t = Math.min(1, elapsed / durationMs);
      var e = easeOutCubic(t);
      tx    = fromTx    + (targetTx    - fromTx)    * e;
      ty    = fromTy    + (targetTy    - fromTy)    * e;
      scale = fromScale + (targetScale - fromScale) * e;
      applyTransform();
      updateZoomDisplay();
      if (t < 1) {
        camAnimFrame = requestAnimationFrame(step);
      } else {
        tx = targetTx; ty = targetTy; scale = targetScale;
        applyTransform();
        updateZoomDisplay();
        camAnimFrame = null;
      }
    }
    camAnimFrame = requestAnimationFrame(step);
  }

  function updateZoomDisplay() {
    var el = document.getElementById('zoom-display');
    if (el) el.textContent = Math.round(scale * 100) + '%';
    var st = document.getElementById('status-zoom');
    if (st) st.textContent = Math.round(scale * 100) + '%';
  }

  /* ══════════════════════════════════════════
     SHOW / HIDE
     ══════════════════════════════════════════ */

  function show() {
    init();
    active = true;
    container.style.display = '';
    var cw = document.getElementById('canvas-world');
    var cg = document.getElementById('canvas-grid');
    var ce = document.getElementById('canvas-empty');
    if (cw) cw.style.display = 'none';
    if (cg) cg.style.display = 'none';
    if (ce) ce.style.display = 'none';
    resizeMapGrid();
    render();
    applyTransform();
    drawMapGrid();
    updateZoomDisplay();
  }

  function hide() {
    active = false;
    hasRenderedOnce = false;
    cancelCameraAnim();
    cancelPreview();
    hideSearchBar();
    clearMultiSelect();
    if (container) container.style.display = 'none';
    var cw = document.getElementById('canvas-world');
    var cg = document.getElementById('canvas-grid');
    var ce = document.getElementById('canvas-empty');
    if (cw) cw.style.display = '';
    if (cg) cg.style.display = '';
    if (ce) ce.style.display = '';
    cancelWire();
    var boardScale = KanvazCanvas.getScale();
    var el = document.getElementById('zoom-display');
    if (el) el.textContent = Math.round(boardScale * 100) + '%';
    var st = document.getElementById('status-zoom');
    if (st) st.textContent = Math.round(boardScale * 100) + '%';
  }

  function toggle() {
    if (active) { hide(); } else { show(); }
    updateToggleBtn();
  }

  function isActive() { return active; }

  function updateToggleBtn() {
    var btnBoard = document.getElementById('btn-view-board');
    var btnMap   = document.getElementById('btn-view-map');
    if (btnBoard) {
      if (active) {
        btnBoard.classList.remove('view-toggle-active');
      } else {
        btnBoard.classList.add('view-toggle-active');
      }
    }
    if (btnMap) {
      if (active) {
        btnMap.classList.add('view-toggle-active');
      } else {
        btnMap.classList.remove('view-toggle-active');
      }
    }
  }

  /* ══════════════════════════════════════════
     RENDER
     ══════════════════════════════════════════ */

  function render() {
    if (!active || !world) return;

    cancelPreview();

    /* Clear old nodes */
    var old = world.querySelectorAll('.map-node');
    for (var r = 0; r < old.length; r++) world.removeChild(old[r]);

    /* Clear empty state */
    var existingEmpty = document.getElementById('map-empty');
    if (existingEmpty) existingEmpty.parentNode.removeChild(existingEmpty);

    var cards = KanvazCards.getAll();
    var cardCount = 0;
    for (var cid in cards) cardCount++;

    /* Empty state */
    if (cardCount === 0) {
      var emptyEl = document.createElement('div');
      emptyEl.id = 'map-empty';
      emptyEl.style.cssText = [
        'position:absolute', 'inset:0', 'display:flex',
        'flex-direction:column', 'align-items:center', 'justify-content:center',
        'color:var(--color-text-3)', 'font-family:var(--font-ui)',
        'pointer-events:none'
      ].join(';');
      emptyEl.innerHTML = '<div style="font-size:32px;margin-bottom:12px;opacity:0.3;">⬡</div>'
        + '<div style="font-size:13px;font-weight:500;margin-bottom:6px;">No references yet</div>'
        + '<div style="font-size:11px;opacity:0.6;">Add images, notes, or media in Board view first</div>';
      container.appendChild(emptyEl);
      updateStatusBar(cards);
      return;
    }

    var isFirstOpen = !hasRenderedOnce;

    var idx = 0;
    for (var id in cards) {
      var card = cards[id];
      if (!card.mapPosition) {
        var col = idx % AUTO_COLS;
        var row = Math.floor(idx / AUTO_COLS);
        card.mapPosition = {
          x: col * AUTO_GAP_X + 60,
          y: row * AUTO_GAP_Y + 60
        };
      }
      var nodeEl = buildNode(card);
      if (isFirstOpen) {
        nodeEl.classList.add('map-node-entrance');
        nodeEl.style.animationDelay = Math.min(idx * 35, 420) + 'ms';
      }
      world.appendChild(nodeEl);
      idx++;
    }

    /* On first open, entrance animations mean some nodes' rects aren't
       laid out yet on the very first frame — resolveOut/resolveIn already
       fall back to math per-node when that happens, so this initial call
       is always safe. */
    renderLines(true);

    if (isFirstOpen) {
      /* BUG fix: this used to switch to DOM-accurate lines exactly once,
         after a single guessed setTimeout duration meant to outlast the
         staggered entrance animations. That guess depends on the machine
         being fast enough (and animations being enabled at all — OS
         "reduce motion" / animations-off settings finish instantly, and
         a throttled/backgrounded tab can delay a timer well past its
         target), so on some machines the "final" re-render fired before
         layout had actually settled, leaving cables permanently pinned to
         the wrong spot. Re-rendering across a bounded run of animation
         frames instead means every render keeps refining toward the true
         DOM position rather than betting everything on one timed guess —
         it self-corrects regardless of how fast entrance animations
         actually played out on this particular machine. */
      var framesLeft = 40; /* ~0.6s+ at 60fps — comfortably outlasts the ~840ms staggered entrance */
      var settle = function() {
        renderLines(false);
        framesLeft--;
        if (framesLeft > 0) requestAnimationFrame(settle);
      };
      requestAnimationFrame(settle);
    } else {
      renderLines(false);
    }
    updateStatusBar(cards);

    /* Dev safety net — full self-diagnostic after each render.
       Uses requestIdleCallback (falls back to a longer setTimeout)
       instead of a fixed 30ms delay — diagnose() forces synchronous
       layout (getBoundingClientRect per node), and a flat 30ms delay
       landed squarely inside the ~480ms eased camera tween + staggered
       entrance animations on first open, causing visible jank right
       when switching into Map View. */
    if (typeof requestIdleCallback === 'function') {
      requestIdleCallback(function() { diagnose(); }, { timeout: 1500 });
    } else {
      setTimeout(function() { diagnose(); }, 600);
    }

    /* Fit all nodes into view on first open */
    if (!hasRenderedOnce) {
      hasRenderedOnce = true;
      fitAll(cards);
    }

    /* render() rebuilds every .map-node from scratch — a search filter
       active before this call would otherwise silently reset (fresh
       nodes have no dimming applied yet) until the user retyped. */
    if (searchInput) applySearchFilter(searchInput.value);
    /* Same reasoning for an active multi-selection's outline. */
    if (Object.keys(multiSelected).length) applyMultiSelectStyles();
  }

  /* Fit all nodes into viewport */
  function fitAll(cards) {
    var minX = Infinity; var minY = Infinity;
    var maxX = -Infinity; var maxY = -Infinity;
    var count = 0;
    for (var id in cards) {
      var c = cards[id];
      if (!c.mapPosition) continue;
      minX = Math.min(minX, c.mapPosition.x);
      minY = Math.min(minY, c.mapPosition.y);
      maxX = Math.max(maxX, c.mapPosition.x + NODE_FULL_W);
      maxY = Math.max(maxY, c.mapPosition.y + NODE_FULL_H);
      count++;
    }
    if (count === 0) return;
    var rect = container.getBoundingClientRect();
    var padX = 80; var padY = 60;
    var contentW = maxX - minX + padX * 2;
    var contentH = maxY - minY + padY * 2;
    var newScale = Math.min(rect.width / contentW, rect.height / contentH, 1.5);
    newScale = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, newScale));
    var targetTx = (rect.width  / 2) - ((minX + (maxX - minX) / 2) * newScale);
    var targetTy = (rect.height / 2) - ((minY + (maxY - minY) / 2) * newScale);
    animateCameraTo(targetTx, targetTy, newScale, 480);
  }

  /* ══════════════════════════════════════════
     NODE BUILDER — with ports
     ══════════════════════════════════════════ */

  function buildNode(card) {
    var el = document.createElement('div');
    el.className = 'map-node';
    el.dataset.refId = card.id;
    el.style.cssText = [
      'position:absolute',
      'left:' + card.mapPosition.x + 'px',
      'top:'  + card.mapPosition.y + 'px',
      'width:' + NODE_W + 'px',
      'height:' + NODE_H + 'px',
      'background:var(--color-surface)',
      'border:1.5px solid var(--color-border-2)',
      'border-radius:10px',
      'display:flex',
      'align-items:center',
      'gap:8px',
      'padding:0 14px',
      'cursor:grab',
      'user-select:none',
      'box-shadow:0 2px 10px var(--color-shadow)',
      'transition:border-color 0.15s, box-shadow 0.15s',
      'overflow:visible'
    ].join(';');

    /* ── Color-coding accent stripe (4.7.0) ──
       A separate absolutely-positioned child, not the node's own
       border-color, so it never fights with hover/selection/multi-
       select — all three of which already claim border-color/outline/
       box-shadow. Matches the node's own left-corner radius so it
       doesn't poke out past the rounded edge. */
    var accent = document.createElement('div');
    accent.className = 'map-node-accent';
    accent.style.cssText = [
      'position:absolute', 'left:0', 'top:0', 'bottom:0', 'width:4px',
      'background:' + nodeAccentColor(card),
      'border-radius:9px 0 0 9px', 'pointer-events:none'
    ].join(';');
    el.appendChild(accent);

    /* ── Input port (left edge) ── */
    var portIn = document.createElement('div');
    portIn.className = 'map-port map-port-in';
    portIn.style.cssText = [
      'position:absolute',
      'left:-' + PORT_R + 'px',
      'top:50%',
      'transform:translateY(-50%)',
      'width:' + (PORT_R * 2) + 'px',
      'height:' + (PORT_R * 2) + 'px',
      'border-radius:50%',
      'background:var(--color-port)',
      'border:2px solid var(--color-border-2)',
      'cursor:crosshair',
      'transition:background 0.12s, transform 0.12s, border-color 0.12s',
      'z-index:2'
    ].join(';');
    portIn.onmouseenter = function() {
      if (!wireFrom) return;
      portIn.style.background = 'var(--color-accent)';
      portIn.style.borderColor = 'var(--color-accent)';
      portIn.style.transform = 'translateY(-50%) scale(1.4)';
      portIn.style.boxShadow = '0 0 0 6px var(--color-accent-bg)';
    };
    portIn.onmouseleave = function() {
      portIn.style.background = 'var(--color-port)';
      portIn.style.borderColor = 'var(--color-border-2)';
      portIn.style.transform = 'translateY(-50%)';
      portIn.style.boxShadow = '';
    };
    el.appendChild(portIn);

    /* ── Output port (right edge) ── */
    var portOut = document.createElement('div');
    portOut.className = 'map-port map-port-out';
    portOut.style.cssText = [
      'position:absolute',
      'right:-' + PORT_R + 'px',
      'top:50%',
      'transform:translateY(-50%)',
      'width:' + (PORT_R * 2) + 'px',
      'height:' + (PORT_R * 2) + 'px',
      'border-radius:50%',
      'background:var(--color-port)',
      'border:2px solid var(--color-border-2)',
      'cursor:crosshair',
      'transition:background 0.15s, transform 0.15s',
      'z-index:2'
    ].join(';');
    portOut.onmouseenter = function() {
      portOut.style.background = 'var(--color-accent)';
      portOut.style.transform = 'translateY(-50%) scale(1.5)';
      portOut.style.boxShadow = '0 0 0 6px var(--color-accent-bg)';
    };
    portOut.onmouseleave = function() {
      if (wireFrom === card.id) return;
      portOut.style.background = 'var(--color-port)';
      portOut.style.transform = 'translateY(-50%)';
      portOut.style.boxShadow = '';
    };
    el.appendChild(portOut);

    /* ── Thumbnail / icon ── */
    var thumb = document.createElement('div');
    thumb.style.cssText = 'width:30px;height:30px;border-radius:6px;flex-shrink:0;display:flex;align-items:center;justify-content:center;font-size:16px;background:var(--color-surface-2);overflow:hidden;';
    if (card.dataUrl && (card.type === 'image' || card.type === 'gif')) {
      var img = document.createElement('img');
      img.src = card.dataUrl;
      img.style.cssText = 'width:100%;height:100%;object-fit:cover;';
      thumb.appendChild(img);
    } else {
      var icon = (typeof KanvazRefTypes !== 'undefined') ? KanvazRefTypes.getIcon(card.type) : '\u2753';
      thumb.textContent = icon;
    }
    el.appendChild(thumb);

    /* ── Name ── */
    var nameEl = document.createElement('div');
    nameEl.className = 'map-node-name';
    nameEl.style.cssText = 'flex:1;font-size:11px;font-family:var(--font-ui);color:var(--color-text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;line-height:1.3;';
    nameEl.textContent = card.name || 'Untitled';
    /* Double-click the name specifically to rename — the node's own
       dblclick (jump to Board View) is on the whole node, so this needs
       stopPropagation or both would fire. */
    nameEl.addEventListener('dblclick', function(e) {
      e.stopPropagation();
      startRenameNode(card.id);
    });
    el.appendChild(nameEl);

    /* ── Connection count ── */
    var connCount = (typeof KanvazConnections !== 'undefined') ? KanvazConnections.getAll(card.id).length : 0;
    if (connCount > 0) {
      var badge = document.createElement('div');
      badge.style.cssText = 'font-size:9px;color:var(--color-accent);background:var(--color-accent-bg);padding:2px 5px;border-radius:10px;flex-shrink:0;font-weight:600;';
      badge.textContent = connCount;
      el.appendChild(badge);
    }

    /* ── Hover ── */
    el.onmouseenter = function() {
      if (dragNode) return;
      el.style.borderColor = 'var(--color-accent)';
      el.style.boxShadow = '0 0 0 2px var(--color-accent), 0 2px 12px rgba(var(--color-accent-rgb),0.25)';
      highlightConnections(card.id);
      schedulePreview(card, el);
    };
    el.onmouseleave = function() {
      cancelPreview();
      if (selectedNode === card.id) return;
      el.style.borderColor = 'var(--color-border-2)';
      el.style.boxShadow = '0 2px 10px var(--color-shadow)';
      unhighlightConnections();
    };

    return el;
  }

  /* ══════════════════════════════════════════
     HOVER PREVIEW — a bigger look at a node's actual content, since the
     node itself only has room for a 30px icon/thumbnail and a name.
     Standard tooltip-delay pattern (don't flash one for every node the
     cursor passes over while moving toward something else); fixed-
     position relative to the viewport (not map-world), so pan/zoom
     never has to reposition it while it's open.
     ══════════════════════════════════════════ */
  var previewTimer = null;
  var previewEl     = null;
  var PREVIEW_DELAY = 350;

  function schedulePreview(card, nodeEl) {
    cancelPreview();
    previewTimer = setTimeout(function() {
      previewTimer = null;
      showPreview(card, nodeEl);
    }, PREVIEW_DELAY);
  }

  function cancelPreview() {
    if (previewTimer) { clearTimeout(previewTimer); previewTimer = null; }
    if (previewEl && previewEl.parentNode) previewEl.parentNode.removeChild(previewEl);
    previewEl = null;
  }

  function showPreview(card, nodeEl) {
    /* Re-fetch — card content (esp. note/text) can change while a
       node sits un-rebuilt between renders. */
    var live = KanvazCards.getAll()[card.id] || card;

    var box = document.createElement('div');
    box.className = 'map-preview';
    box.style.cssText = [
      'position:fixed', 'z-index:29000', 'pointer-events:none',
      'background:var(--color-surface)', 'border:1px solid var(--color-border-2)',
      'border-radius:10px', 'box-shadow:0 12px 32px var(--color-shadow)',
      'padding:10px', 'max-width:260px',
      'font-family:var(--font-ui)', 'color:var(--color-text)',
      'opacity:0', 'transition:opacity 0.1s ease-out'
    ].join(';');

    if ((live.type === 'image' || live.type === 'gif') && live.dataUrl) {
      var img = document.createElement('img');
      img.src = live.dataUrl;
      img.style.cssText = 'display:block;max-width:240px;max-height:180px;border-radius:6px;object-fit:contain;';
      box.appendChild(img);
    } else if (live.type === 'color') {
      var swatch = document.createElement('div');
      swatch.style.cssText = 'width:240px;height:100px;border-radius:6px;background:' + (live.color || '#9D7FFF') + ';';
      box.appendChild(swatch);
      var hexLabel = document.createElement('div');
      hexLabel.style.cssText = 'margin-top:6px;font-size:11px;font-family:monospace;color:var(--color-text-2);';
      hexLabel.textContent = live.color || '#9D7FFF';
      box.appendChild(hexLabel);
    } else if (live.type === 'note' || live.type === 'text') {
      var textEl = document.createElement('div');
      textEl.style.cssText = 'font-size:12px;line-height:1.5;white-space:pre-wrap;word-break:break-word;max-height:160px;overflow:hidden;';
      textEl.textContent = (live.text || '').trim() || '(empty)';
      box.appendChild(textEl);
    } else if (live.type === 'url') {
      var urlEl = document.createElement('div');
      urlEl.style.cssText = 'font-size:11px;word-break:break-all;color:var(--color-accent);';
      urlEl.textContent = live.url || '(no URL set)';
      box.appendChild(urlEl);
    } else if (live.type === 'file') {
      var pathEl = document.createElement('div');
      pathEl.style.cssText = 'font-size:11px;word-break:break-all;color:var(--color-text-2);';
      pathEl.textContent = live.path || '(no path)';
      box.appendChild(pathEl);
    } else {
      /* video/audio/plugin types: no cheap way to grab a real frame or
         waveform from Map View (the actual <video>/<audio> elements
         only exist in Board View's DOM) — name + a bigger icon is an
         honest scope limit here, not an oversight. */
      var icon = (typeof KanvazRefTypes !== 'undefined') ? KanvazRefTypes.getIcon(live.type) : '❓';
      var fallback = document.createElement('div');
      fallback.style.cssText = 'font-size:32px;text-align:center;padding:8px 24px;';
      fallback.textContent = icon;
      box.appendChild(fallback);
    }

    document.body.appendChild(box);

    /* Position: to the right of the node, flipped to the left if that
       would run off-screen. Vertically centered on the node, clamped
       into the viewport. */
    var nodeRect = nodeEl.getBoundingClientRect();
    var boxRect = box.getBoundingClientRect();
    var left = nodeRect.right + 12;
    if (left + boxRect.width > window.innerWidth) {
      left = nodeRect.left - boxRect.width - 12;
    }
    left = Math.max(8, Math.min(left, window.innerWidth - boxRect.width - 8));
    var top = nodeRect.top + nodeRect.height / 2 - boxRect.height / 2;
    top = Math.max(8, Math.min(top, window.innerHeight - boxRect.height - 8));
    box.style.left = left + 'px';
    box.style.top  = top + 'px';

    requestAnimationFrame(function() { box.style.opacity = '1'; });
    previewEl = box;
  }

  /* ══════════════════════════════════════════
     INLINE RENAME
     There's no rename UI anywhere else in Kanvaz today — Properties
     panel only ever displayed card.name read-only. Reuses
     KanvazCards.updateCardData() (the same path MCP Bridge's updateCard
     tool uses) so dirty-flag/undo-history/cardUpdate event all fire
     consistently, and Board View's own card-bar filename picks up the
     change too, not just this node. render() afterward is the simplest
     correct way to reflect the new name here — same pattern this file
     already uses after "Remove all connections". */
  function startRenameNode(refId) {
    var nodeEl = document.querySelector('.map-node[data-ref-id="' + refId + '"]');
    if (!nodeEl) return;
    var nameEl = nodeEl.querySelector('.map-node-name');
    if (!nameEl) return;
    var card = KanvazCards.getAll()[refId];
    if (!card) return;

    var input = document.createElement('input');
    input.type = 'text';
    input.className = 'map-node-name-input';
    input.value = card.name || '';
    input.style.cssText = [
      'flex:1', 'min-width:0', 'font-size:11px', 'font-family:var(--font-ui)',
      'color:var(--color-text)', 'background:var(--color-surface-2)',
      'border:1px solid var(--color-accent)', 'border-radius:4px', 'padding:0 4px'
    ].join(';');

    nameEl.parentNode.replaceChild(input, nameEl);
    input.focus();
    input.select();

    var done = false;
    function finish(commit) {
      if (done) return;
      done = true;
      if (commit) {
        var val = input.value.trim();
        if (val && val !== card.name) {
          KanvazCards.updateCardData(refId, { name: val });
        }
      }
      if (active) render();
    }

    /* Stop these from reaching the container's own mousedown/dblclick
       handlers — without this, clicking into the input to position the
       caret would be read as "click empty area" (pan) or drag-start. */
    input.addEventListener('mousedown', function(e) { e.stopPropagation(); });
    input.addEventListener('dblclick',  function(e) { e.stopPropagation(); });
    input.addEventListener('keydown', function(e) {
      e.stopPropagation();
      if (e.key === 'Enter')  { e.preventDefault(); finish(true); }
      if (e.key === 'Escape') { e.preventDefault(); finish(false); }
    });
    input.addEventListener('blur', function() { finish(true); });
  }

  /* ══════════════════════════════════════════
     BEZIER TUBE LINES
     ══════════════════════════════════════════ */

  function renderLines(isFirstOpen) {
    if (!svg) return;

    var oldLines = svg.querySelectorAll('.conn-line, .conn-label, .conn-glow');
    for (var i = 0; i < oldLines.length; i++) svg.removeChild(oldLines[i]);

    if (typeof KanvazConnections === 'undefined') return;

    var conns = KanvazConnections.serialise();
    var cards = KanvazCards.getAll();

    for (var j = 0; j < conns.length; j++) {
      var conn = conns[j];
      var fromCard = cards[conn.fromRefId];
      var toCard   = cards[conn.toRefId];
      if (!fromCard || !toCard) continue;
      if (!fromCard.mapPosition || !toCard.mapPosition) continue;

      var op = resolveOut(fromCard);
      var ip = resolveIn(toCard);

      /* Skip if nodes overlap */
      var dx = ip.x - op.x;
      var dy = ip.y - op.y;
      var dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < 20) continue;

      var color = typeColor(conn.type);
      var d = bezierPath(op.x, op.y, ip.x, ip.y);

      /* Outer glow — soft wide halo */
      var glow = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      glow.setAttribute('class', 'conn-glow');
      glow.setAttribute('d', d);
      glow.setAttribute('stroke', color);
      glow.setAttribute('stroke-width', '10');
      glow.setAttribute('stroke-opacity', '0.07');
      glow.setAttribute('fill', 'none');
      glow.setAttribute('stroke-linecap', 'round');
      glow.dataset.connId = conn.id;
      svg.appendChild(glow);

      /* Inner shadow for depth */
      var shadow = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      shadow.setAttribute('class', 'conn-glow');
      shadow.setAttribute('d', d);
      shadow.setAttribute('stroke', 'var(--color-text-inv)');
      shadow.setAttribute('stroke-width', '4');
      shadow.setAttribute('stroke-opacity', '0.25');
      shadow.setAttribute('fill', 'none');
      shadow.setAttribute('stroke-linecap', 'round');
      shadow.dataset.connId = conn.id;
      svg.appendChild(shadow);

      /* Main tube — solid, rounded, no arrowhead */
      var line = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      line.setAttribute('class', 'conn-line');
      line.setAttribute('d', d);
      line.setAttribute('stroke', color);
      line.setAttribute('stroke-width', '3');
      line.setAttribute('stroke-opacity', '0.75');
      line.setAttribute('fill', 'none');
      line.setAttribute('stroke-linecap', 'round');
      line.dataset.connId = conn.id;
      svg.appendChild(line);

      /* Dot terminator at output port (source ball) */
      var dotOut = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      dotOut.setAttribute('class', 'conn-glow');
      dotOut.setAttribute('cx', op.x);
      dotOut.setAttribute('cy', op.y);
      dotOut.setAttribute('r', '4');
      dotOut.setAttribute('fill', color);
      dotOut.setAttribute('fill-opacity', '0.85');
      dotOut.dataset.connId = conn.id;
      svg.appendChild(dotOut);

      /* Dot terminator at input port (destination ball) */
      var dotIn = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      dotIn.setAttribute('class', 'conn-glow');
      dotIn.setAttribute('cx', ip.x);
      dotIn.setAttribute('cy', ip.y);
      dotIn.setAttribute('r', '4');
      dotIn.setAttribute('fill', color);
      dotIn.setAttribute('fill-opacity', '0.9');
      dotIn.dataset.connId = conn.id;
      svg.appendChild(dotIn);

      /* Label at bezier midpoint */
      var mx = (op.x + ip.x) / 2;
      var my = (op.y + ip.y) / 2 - 10;
      var label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      label.setAttribute('class', 'conn-label');
      label.setAttribute('x', mx);
      label.setAttribute('y', my);
      label.setAttribute('text-anchor', 'middle');
      label.setAttribute('fill', color);
      label.setAttribute('font-size', '9.5');
      label.setAttribute('font-family', 'var(--font-ui)');
      label.setAttribute('font-weight', '500');
      label.setAttribute('opacity', '0.65');
      var devIds = false;
      if (typeof KanvazUI_Extended !== 'undefined') {
        var devS = KanvazUI_Extended.getSettings();
        devIds = !!(devS && devS.devShowIds);
      }
      label.textContent = typeLabel(conn.type) + (devIds ? ' [' + conn.id + ']' : '');
      svg.appendChild(label);

      /* Entrance: tube draws on, halo/dots/label fade in — first open only.
         Never runs during drag-triggered re-renders (isFirstOpen is only
         ever true from render()'s initial call). */
      if (isFirstOpen) {
        var stagger = Math.min(j * 55, 500);
        var len = line.getTotalLength();
        line.style.strokeDasharray  = len + ' ' + len;
        line.style.strokeDashoffset = String(len);
        line.style.transition = 'stroke-dashoffset 0.55s cubic-bezier(0.22,0.61,0.36,1) ' + stagger + 'ms';
        glow.style.opacity = '0'; shadow.style.opacity = '0';
        dotOut.style.opacity = '0'; dotIn.style.opacity = '0'; label.style.opacity = '0';
        glow.style.transition = shadow.style.transition = dotOut.style.transition =
          dotIn.style.transition = label.style.transition =
          'opacity 0.4s ease-out ' + (stagger + 250) + 'ms';
        (function(l, gl, sh, dO, dI, lb) {
          requestAnimationFrame(function() {
            requestAnimationFrame(function() {
              l.style.strokeDashoffset = '0';
              gl.style.opacity = ''; sh.style.opacity = '';
              dO.style.opacity = ''; dI.style.opacity = ''; lb.style.opacity = '';
            });
          });
        })(line, glow, shadow, dotOut, dotIn, label);
      }
    }
  }

  function highlightConnections(refId) {
    if (!svg) return;
    var conns = KanvazConnections.getAll(refId);
    var ids = {};
    for (var i = 0; i < conns.length; i++) ids[conns[i].id] = true;

    var lines = svg.querySelectorAll('.conn-line');
    for (var j = 0; j < lines.length; j++) {
      lines[j].setAttribute('stroke-opacity', ids[lines[j].dataset.connId] ? '1' : '0.1');
      lines[j].setAttribute('stroke-width',   ids[lines[j].dataset.connId] ? '3.5' : '2.5');
    }
    var glows = svg.querySelectorAll('.conn-glow');
    for (var g = 0; g < glows.length; g++) {
      glows[g].setAttribute('stroke-opacity', ids[glows[g].dataset.connId] ? '0.18' : '0.02');
    }
    var labels = svg.querySelectorAll('.conn-label');
    for (var k = 0; k < labels.length; k++) {
      labels[k].setAttribute('opacity', '0.15');
    }
  }

  function unhighlightConnections() {
    if (!svg) return;
    var lines = svg.querySelectorAll('.conn-line');
    for (var j = 0; j < lines.length; j++) {
      lines[j].setAttribute('stroke-opacity', '0.55');
      lines[j].setAttribute('stroke-width', '2.5');
    }
    var glows = svg.querySelectorAll('.conn-glow');
    for (var g = 0; g < glows.length; g++) {
      glows[g].setAttribute('stroke-opacity', '0.08');
    }
    var labels = svg.querySelectorAll('.conn-label');
    for (var k = 0; k < labels.length; k++) {
      labels[k].setAttribute('opacity', '0.6');
    }
  }

  /* ══════════════════════════════════════════
     MULTI-SELECT & MARQUEE (4.7.0)
     ══════════════════════════════════════════ */

  function startMarquee(e) {
    var rect = container.getBoundingClientRect();
    marqueeStartX = e.clientX - rect.left;
    marqueeStartY = e.clientY - rect.top;
    marqueeEl = document.createElement('div');
    marqueeEl.id = 'map-marquee';
    marqueeEl.style.cssText = [
      'position:absolute', 'border:1px solid var(--color-accent)',
      'background:rgba(var(--color-accent-rgb),0.12)', 'z-index:90',
      'pointer-events:none'
    ].join(';');
    marqueeEl.style.left = marqueeStartX + 'px';
    marqueeEl.style.top  = marqueeStartY + 'px';
    marqueeEl.style.width = '0px';
    marqueeEl.style.height = '0px';
    container.appendChild(marqueeEl);
  }

  function updateMarquee(e) {
    var rect = container.getBoundingClientRect();
    var curX = e.clientX - rect.left;
    var curY = e.clientY - rect.top;
    var left = Math.min(marqueeStartX, curX);
    var top  = Math.min(marqueeStartY, curY);
    var w = Math.abs(curX - marqueeStartX);
    var h = Math.abs(curY - marqueeStartY);
    marqueeEl.style.left = left + 'px';
    marqueeEl.style.top = top + 'px';
    marqueeEl.style.width = w + 'px';
    marqueeEl.style.height = h + 'px';
  }

  function finishMarquee(e) {
    var mRect = marqueeEl.getBoundingClientRect();
    if (marqueeEl.parentNode) marqueeEl.parentNode.removeChild(marqueeEl);
    marqueeEl = null;

    /* A marquee narrower/shorter than this is almost certainly an
       accidental Shift+click, not an intentional drag — don't wipe out
       an existing multi-selection over a few-pixel jitter. */
    if (mRect.width < 4 && mRect.height < 4) return;

    /* Marquee only ever starts with Shift already held (see the
       mousedown handler), so this always extends whatever's already
       selected rather than replacing it — consistent with Shift's
       "add to selection" meaning on a single node too. */
    var nodes = world.querySelectorAll('.map-node');
    for (var i = 0; i < nodes.length; i++) {
      var nRect = nodes[i].getBoundingClientRect();
      var intersects = !(nRect.right < mRect.left || nRect.left > mRect.right ||
                          nRect.bottom < mRect.top || nRect.top > mRect.bottom);
      if (intersects) multiSelected[nodes[i].dataset.refId] = true;
    }
    applyMultiSelectStyles();
    updateBulkActionBar();
  }

  function applyMultiSelectStyles() {
    var nodes = world.querySelectorAll('.map-node');
    for (var i = 0; i < nodes.length; i++) {
      var id = nodes[i].dataset.refId;
      if (multiSelected[id]) {
        nodes[i].classList.add('map-node-multiselected');
      } else {
        nodes[i].classList.remove('map-node-multiselected');
      }
    }
  }

  function clearMultiSelect() {
    multiSelected = {};
    applyMultiSelectStyles();
    updateBulkActionBar();
  }

  /* ── Bulk action bar ── */
  var bulkBar = null;

  function updateBulkActionBar() {
    var ids = Object.keys(multiSelected);
    if (ids.length === 0) {
      if (bulkBar && bulkBar.parentNode) bulkBar.parentNode.removeChild(bulkBar);
      bulkBar = null;
      return;
    }

    if (!bulkBar) {
      bulkBar = document.createElement('div');
      bulkBar.id = 'map-bulk-bar';
      bulkBar.style.cssText = [
        'position:absolute', 'bottom:20px', 'left:50%', 'transform:translateX(-50%)',
        'display:flex', 'align-items:center', 'gap:10px', 'padding:8px 14px',
        'background:var(--color-surface)', 'border:1px solid var(--color-border-2)',
        'border-radius:var(--radius-lg)', 'box-shadow:0 8px 32px var(--color-shadow)',
        'z-index:100', 'font-family:var(--font-ui)', 'font-size:12px', 'color:var(--color-text)'
      ].join(';');
      container.appendChild(bulkBar);
    }

    bulkBar.innerHTML = '';
    var countEl = document.createElement('span');
    countEl.style.cssText = 'color:var(--color-text-2);';
    bulkBar.appendChild(countEl);

    function makeBtn(label, onClick) {
      var b = document.createElement('button');
      b.className = 'btn';
      b.textContent = label;
      b.style.cssText = 'font-size:12px;padding:4px 10px;';
      b.addEventListener('click', onClick);
      return b;
    }

    bulkBar.appendChild(makeBtn('Tag', function() {
      var tag = window.prompt('Add tag to ' + Object.keys(multiSelected).length + ' selected card(s):');
      if (!tag) return;
      tag = tag.trim();
      if (!tag) return;
      var allCards = KanvazCards.getAll();
      for (var id in multiSelected) {
        var c = allCards[id];
        if (!c) continue;
        var tags = (c.tags || []).slice();
        if (tags.indexOf(tag) === -1) tags.push(tag);
        KanvazCards.setTags(id, tags);
      }
      KanvazUI.toast('Tagged ' + Object.keys(multiSelected).length + ' card(s) "' + tag + '"');
    }));

    bulkBar.appendChild(makeBtn('Delete', function() {
      var idsToDelete = Object.keys(multiSelected);
      var n = idsToDelete.length;
      KanvazUI.showDialog(
        'Delete ' + n + ' card' + (n === 1 ? '' : 's') + '?',
        'This removes ' + n + ' card' + (n === 1 ? '' : 's') + ' and any connections attached to ' + (n === 1 ? 'it' : 'them') + '. This can be undone with Ctrl+Z.',
        [
          { label: 'Delete', cls: 'danger', action: function() {
            /* One history push for the whole batch, not one per card —
               deleteMultiple() already exists for exactly this (the
               same helper deleteSelected()'s multi-select path uses in
               Board View), so undoing this is a single Ctrl+Z. */
            KanvazCards.deleteMultiple(idsToDelete);
            clearMultiSelect();
            render();
            KanvazUI.toast(n + ' card' + (n === 1 ? '' : 's') + ' deleted');
          }},
          { label: 'Cancel', cls: '' }
        ]
      );
    }));

    bulkBar.appendChild(makeBtn('Clear', clearMultiSelect));

    countEl.textContent = ids.length + ' selected';
  }

  /* ══════════════════════════════════════════
     SELECTION
     ══════════════════════════════════════════ */

  function selectNode(refId) {
    if (selectedNode) {
      var oldEl = document.querySelector('.map-node[data-ref-id="' + selectedNode + '"]');
      if (oldEl) {
        oldEl.style.borderColor = 'var(--color-border-2)';
        oldEl.style.boxShadow = '0 2px 10px var(--color-shadow)';
      }
      unhighlightConnections();
    }
    selectedNode = refId;
    if (refId) {
      var el = document.querySelector('.map-node[data-ref-id="' + refId + '"]');
      if (el) {
        el.style.borderColor = 'var(--color-accent)';
        el.style.boxShadow = '0 0 0 2px var(--color-accent), 0 2px 12px rgba(var(--color-accent-rgb),0.25)';
      }
      KanvazCards.selectCard(refId);
    }
  }

  /* ══════════════════════════════════════════
     TYPE PICKER (after wire drop)
     ══════════════════════════════════════════ */

  function showTypePicker(fromId, toId) {
    var overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;background:var(--color-overlay);z-index:30000;display:flex;align-items:center;justify-content:center;';

    var panel = document.createElement('div');
    panel.style.cssText = [
      'background:var(--color-surface)',
      'border:1px solid var(--color-border-2)',
      'border-radius:10px',
      'padding:14px',
      'width:220px',
      'box-shadow:0 12px 40px var(--color-shadow)'
    ].join(';');

    var title = document.createElement('div');
    title.style.cssText = 'font-weight:600;font-size:12px;margin-bottom:10px;color:var(--color-text);font-family:var(--font-ui);';
    title.textContent = 'Connection type';
    panel.appendChild(title);

    var types = KanvazConnections.CONNECTION_TYPES;
    for (var i = 0; i < types.length; i++) {
      (function(type) {
        var btn = document.createElement('button');
        btn.style.cssText = [
          'display:block', 'width:100%', 'padding:7px 10px',
          'margin-bottom:3px', 'background:var(--color-surface-2)',
          'border:1px solid transparent', 'border-radius:6px',
          'color:var(--color-text)', 'font-family:var(--font-ui)',
          'font-size:12px', 'cursor:pointer', 'text-align:left',
          'transition:border-color 0.1s'
        ].join(';');
        var dot = document.createElement('span');
        dot.style.cssText = 'display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:8px;background:' + typeColor(type) + ';';
        btn.appendChild(dot);
        btn.appendChild(document.createTextNode(typeLabel(type)));
        btn.onmouseenter = function() { btn.style.borderColor = typeColor(type); };
        btn.onmouseleave = function() { btn.style.borderColor = 'transparent'; };
        btn.onclick = function() {
          KanvazConnections.create(fromId, toId, type);
          KanvazHistory.push();
          overlay.parentNode.removeChild(overlay);
          render();
          KanvazUI.toast('Connected: ' + typeLabel(type));
        };
        panel.appendChild(btn);
      })(types[i]);
    }

    overlay.appendChild(panel);
    overlay.onclick = function(e) {
      if (e.target === overlay) overlay.parentNode.removeChild(overlay);
    };
    document.body.appendChild(overlay);
  }

  /* ══════════════════════════════════════════
     NODE CONTEXT MENU
     ══════════════════════════════════════════ */

  function showNodeMenu(refId, x, y) {
    selectNode(refId);
    var menu = document.getElementById('context-menu');
    if (!menu) return;
    menu.innerHTML = '';
    menu.className = 'visible';

    var items = [
      {
        label: 'Rename',
        shortcut: 'Dbl-click name',
        action: function() { startRenameNode(refId); }
      },
      {
        label: 'Connect from here\u2026',
        action: function() { startWire(refId); }
      },
      {
        label: 'Connections',
        shortcut: 'C',
        action: function() {
          if (typeof KanvazInspector !== 'undefined') KanvazInspector.open(refId);
        }
      },
      { sep: true },
      {
        label: 'Go to on board',
        action: function() {
          hide();
          updateToggleBtn();
          var el = document.getElementById(refId);
          if (el) {
            KanvazCards.selectCard(refId);
            el.scrollIntoView({ behavior: 'smooth', block: 'center' });
          }
        }
      },
      { sep: true },
      {
        label: 'Remove all connections',
        danger: true,
        action: function() {
          var removed = KanvazConnections.removeAllFor(refId);
          if (removed > 0) {
            KanvazHistory.push();
            render();
            KanvazUI.toast(removed + ' connection' + (removed !== 1 ? 's' : '') + ' removed');
          } else {
            KanvazUI.toast('No connections to remove');
          }
        }
      }
    ];

    for (var i = 0; i < items.length; i++) {
      if (items[i].sep) {
        var sep = document.createElement('div');
        sep.className = 'ctx-sep';
        menu.appendChild(sep);
        continue;
      }
      var row = document.createElement('div');
      row.className = 'ctx-item' + (items[i].danger ? ' danger' : '');
      var labelSpan = document.createElement('span');
      labelSpan.textContent = items[i].label;
      row.appendChild(labelSpan);
      if (items[i].shortcut) {
        var shortcut = document.createElement('span');
        shortcut.className = 'ctx-shortcut';
        shortcut.textContent = items[i].shortcut;
        row.appendChild(shortcut);
      }
      (function(action) {
        row.onclick = function() { menu.className = ''; action(); };
      })(items[i].action);
      menu.appendChild(row);
    }

    menu.style.left = x + 'px';
    menu.style.top  = y + 'px';
  }

  /* ══════════════════════════════════════════
     RUNTIME SELF-DIAGNOSTIC
     Advanced health check. Runs on Map View open + on demand via
     KanvazMapView.diagnose(). Catches the bug classes that have hit
     this project: port drift, orphan connections, NaN transforms,
     connections pointing at missing cards, duplicate connections.
     ══════════════════════════════════════════ */

  function diagnose() {
    var report = { ok: true, issues: [] };
    function flag(sev, msg) {
      report.issues.push({ severity: sev, message: msg });
      if (sev === 'error') report.ok = false;
    }

    var cards = KanvazCards.getAll();

    /* 1. Transform sanity — NaN/Infinity would blank the canvas */
    if (isNaN(tx) || !isFinite(tx)) flag('error', 'map tx is NaN/Infinity: ' + tx);
    if (isNaN(ty) || !isFinite(ty)) flag('error', 'map ty is NaN/Infinity: ' + ty);
    if (isNaN(scale) || !isFinite(scale) || scale <= 0) flag('error', 'map scale invalid: ' + scale);

    /* 2. Connections referencing missing cards (orphans) */
    if (typeof KanvazConnections !== 'undefined') {
      var conns = KanvazConnections.serialise();
      for (var i = 0; i < conns.length; i++) {
        var c = conns[i];
        if (!cards[c.fromRefId]) flag('warn', 'connection ' + c.id + ' fromRefId "' + c.fromRefId + '" has no card');
        if (!cards[c.toRefId])   flag('warn', 'connection ' + c.id + ' toRefId "' + c.toRefId + '" has no card');
      }

      /* 3. Duplicate connections (same from+to+type) */
      var seen = {};
      for (var d = 0; d < conns.length; d++) {
        var key = conns[d].fromRefId + '|' + conns[d].toRefId + '|' + conns[d].type;
        if (seen[key]) flag('warn', 'duplicate connection: ' + key);
        seen[key] = true;
      }
    }

    /* 4. Port alignment — compare math vs real DOM for every node */
    if (active && container) {
      var wRect = world.getBoundingClientRect();
      var portIssues = 0;
      for (var id in cards) {
        if (!cards[id].mapPosition) continue;
        var nodeEl = document.querySelector('.map-node[data-ref-id="' + id + '"]');
        if (!nodeEl) continue;
        var outDot = nodeEl.querySelector('.map-port-out');
        var inDot  = nodeEl.querySelector('.map-port-in');
        if (!outDot || !inDot) { flag('error', 'node "' + id + '" missing port dots'); continue; }

        var oR = outDot.getBoundingClientRect();
        var iR = inDot.getBoundingClientRect();
        var domOutX = (oR.left + oR.width / 2 - wRect.left) / scale;
        var domOutY = (oR.top  + oR.height / 2 - wRect.top)  / scale;
        var domInX  = (iR.left + iR.width / 2 - wRect.left) / scale;
        var domInY  = (iR.top  + iR.height / 2 - wRect.top)  / scale;
        var mOut = outPort(cards[id]);
        var mIn  = inPort(cards[id]);
        if (Math.abs(domOutX - mOut.x) > 1.5) { portIssues++;
          flag('error', 'outPort X drift on "' + id + '": DOM=' + Math.round(domOutX) + ' math=' + Math.round(mOut.x)); }
        if (Math.abs(domOutY - mOut.y) > 1.5) { portIssues++;
          flag('error', 'outPort Y drift on "' + id + '": DOM=' + Math.round(domOutY) + ' math=' + Math.round(mOut.y)); }
        if (Math.abs(domInX - mIn.x) > 1.5) { portIssues++;
          flag('error', 'inPort X drift on "' + id + '": DOM=' + Math.round(domInX) + ' math=' + Math.round(mIn.x)); }
        if (Math.abs(domInY - mIn.y) > 1.5) { portIssues++;
          flag('error', 'inPort Y drift on "' + id + '": DOM=' + Math.round(domInY) + ' math=' + Math.round(mIn.y)); }
      }
      if (portIssues === 0) report.portAlignment = 'OK';
    }

    /* Report */
    if (report.ok && report.issues.length === 0) {
      console.log('%c[Kanvaz] ✓ Self-diagnostic passed — no issues', 'color:#4CAF82');
    } else {
      var errCount = 0; var warnCount = 0; var wi;
      for (wi = 0; wi < report.issues.length; wi++) {
        if (report.issues[wi].severity === 'error') errCount++;
        else warnCount++;
      }
      console.log('%c[Kanvaz] Self-diagnostic: ' + errCount + ' errors, ' + warnCount + ' warnings',
        errCount ? 'color:#FF5A5A;font-weight:bold' : 'color:#F0A500');
      var ri;
      for (ri = 0; ri < report.issues.length; ri++) {
        console.log('  [' + report.issues[ri].severity + '] ' + report.issues[ri].message);
      }
    }
    return report;
  }

  /* ══════════════════════════════════════════
     STATUS BAR
     ══════════════════════════════════════════ */

  function updateStatusBar(cards) {
    var refCount = 0;
    for (var k in cards) refCount++;
    var connCount = (typeof KanvazConnections !== 'undefined') ? KanvazConnections.count() : 0;
    var cardsEl = document.getElementById('status-cards');
    if (cardsEl) cardsEl.textContent = refCount + ' refs \u00B7 ' + connCount + ' conn';
  }

  /* ══════════════════════════════════════════
     VIEW STATE
     ══════════════════════════════════════════ */

  function getState()  { return { tx: tx, ty: ty, scale: scale }; }
  function setState(s) {
    if (!s) return;
    /* Audit fix: this restores tx/ty/scale from board-file data that
       could be corrupted, hand-edited, or from a version-skewed file —
       `s.scale || 1.0` only caught falsy/0/NaN, not a negative number
       (mirrors the whole map via a negative CSS scale()) or a value
       wildly outside the normal zoom range. Unlike canvas.js's
       clampTranslate(), Map View had no equivalent sanitization
       anywhere — this is the missing counterpart. */
    var newTx    = Number(s.tx);
    var newTy    = Number(s.ty);
    var newScale = Number(s.scale);
    tx    = isFinite(newTx) ? newTx : 0;
    ty    = isFinite(newTy) ? newTy : 0;
    scale = (isFinite(newScale) && newScale > 0) ? Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, newScale)) : 1.0;
    if (active) { applyTransform(); updateZoomDisplay(); }
  }
  function resetView() {
    animateCameraTo(0, 0, 1.0, 320);
  }

  /* ══════════════════════════════════════════
     KEYBOARD
     ══════════════════════════════════════════ */

  /* ══════════════════════════════════════════
     SEARCH / FILTER (4.7.0)
     Same matching rule as Board View's own search (app.js — name/type/
     tag substring match) so "find a card" behaves identically no matter
     which view you're in. Dims non-matching nodes rather than hiding
     them outright, same reasoning as Board View: hiding would also mean
     re-deriving every connection line touching a hidden node, which
     isn't worth the complexity for what's fundamentally a visual aid. */
  var searchBar = null;
  var searchInput = null;

  function showSearchBar() {
    if (searchBar) { searchInput.focus(); return; }

    searchBar = document.createElement('div');
    searchBar.id = 'map-search-bar';
    searchBar.style.cssText = [
      'position:absolute', 'top:16px', 'left:50%', 'transform:translateX(-50%)',
      'width:320px', 'display:flex', 'align-items:center', 'gap:8px',
      'padding:8px 14px', 'background:var(--color-surface)',
      'border:1px solid var(--color-border-2)', 'border-radius:var(--radius-lg)',
      'box-shadow:0 8px 32px var(--color-shadow)', 'z-index:100'
    ].join(';');

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

    var closeBtn = document.createElement('span');
    closeBtn.style.cssText = 'cursor:pointer;color:var(--color-text-3);font-size:16px;flex-shrink:0;';
    closeBtn.textContent = '×';
    closeBtn.addEventListener('click', hideSearchBar);

    searchInput.addEventListener('input', function() { applySearchFilter(searchInput.value); });
    searchInput.addEventListener('keydown', function(e) {
      e.stopPropagation();
      if (e.key === 'Escape') hideSearchBar();
    });

    searchBar.appendChild(icon);
    searchBar.appendChild(searchInput);
    searchBar.appendChild(closeBtn);
    if (container) container.appendChild(searchBar);
    searchInput.focus();
  }

  function hideSearchBar() {
    if (searchBar && searchBar.parentNode) searchBar.parentNode.removeChild(searchBar);
    searchBar = null;
    searchInput = null;
    applySearchFilter('');
  }

  function applySearchFilter(query) {
    var q = query.trim().toLowerCase();
    var nodes = world ? world.querySelectorAll('.map-node') : [];
    for (var i = 0; i < nodes.length; i++) {
      var nodeEl = nodes[i];
      var refId = nodeEl.getAttribute('data-ref-id');
      var card = refId ? KanvazCards.getAll()[refId] : null;
      if (!card || !q) {
        nodeEl.style.opacity = '';
        nodeEl.style.filter = '';
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
        nodeEl.style.opacity = '';
        nodeEl.style.filter = '';
      } else {
        nodeEl.style.opacity = '0.12';
        nodeEl.style.filter = 'grayscale(1)';
      }
    }
  }

  function handleKey(e) {
    if (!active) return false;

    if (e.key === 'Escape') {
      if (searchBar) { hideSearchBar(); return true; }
      if (Object.keys(multiSelected).length) { clearMultiSelect(); return true; }
      if (wireFrom) { cancelWire(); return true; }
      if (typeof KanvazInspector !== 'undefined' && KanvazInspector.isOpen()) {
        KanvazInspector.close(); return true;
      }
      if (selectedNode) { selectNode(null); return true; }
    }

    if (e.key === '0' && !e.ctrlKey && !e.shiftKey) {
      resetView(); return true;
    }

    if ((e.key === 'c' || e.key === 'C') && selectedNode) {
      if (typeof KanvazInspector !== 'undefined') KanvazInspector.open(selectedNode);
      return true;
    }

    if (e.key === 'f' || e.key === 'F') {
      e.preventDefault();
      fitAll(KanvazCards.getAll());
      return true;
    }

    if (e.key === 'Delete' && selectedNode) {
      var removed = KanvazConnections.removeAllFor(selectedNode);
      if (removed > 0) {
        KanvazHistory.push();
        render();
        KanvazUI.toast(removed + ' connection' + (removed !== 1 ? 's' : '') + ' removed');
      }
      return true;
    }

    return false;
  }

  /* ── Public API ── */

  return {
    init: init, show: show, hide: hide, toggle: toggle,
    isActive: isActive, render: render,
    getState: getState, setState: setState, resetView: resetView,
    handleKey: handleKey, updateToggleBtn: updateToggleBtn,
    diagnose: diagnose,
    showSearchBar: showSearchBar, hideSearchBar: hideSearchBar
  };

})();
