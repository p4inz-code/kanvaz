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

  /* Wire-drag state (connecting) */
  var wireFrom     = null;   /* ref ID we're dragging a wire from */
  var wirePreview  = null;   /* live SVG path element */
  var hasRenderedOnce = false;

  /* ── Node sizing ── */
  var NODE_W      = 176;   /* content-box width */
  var NODE_H      = 52;    /* content-box height */
  var NODE_BORDER = 1.5;
  var NODE_PAD    = 14;    /* padding: 0 14px */
  var NODE_FULL_W = NODE_BORDER + NODE_PAD + NODE_W + NODE_PAD + NODE_BORDER; /* 207 */
  var NODE_FULL_H = NODE_BORDER + NODE_H + NODE_BORDER;                       /* 55 */
  var PORT_R      = 7;   /* port dot radius */
  var AUTO_COLS   = 5;
  var AUTO_GAP_X  = 240;
  var AUTO_GAP_Y  = 90;

  /* ── Type colors ── */
  var TYPE_COLORS = {
    RelatedTo:     '#6B7280',
    InspiredBy:    '#8B5CF6',
    DerivedFrom:   '#3B82F6',
    AlternativeTo: '#F59E0B',
    Supports:      '#10B981',
    UsedIn:        '#EF4444',
    References:    '#6366F1'
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

  /* Port centers — CSS right:-PORT_R positions the dot relative to the
     PADDING BOX edge, not the content edge. The padding box includes
     border + padding + content + padding, so we must add those offsets.
     
     Output dot center: paddingBox right edge = mapPos + border + pad + contentW + pad
     Input dot center:  paddingBox left edge  = mapPos + border */
  function outPort(card) {
    return {
      x: card.mapPosition.x + NODE_BORDER + NODE_PAD + NODE_W + NODE_PAD,
      y: card.mapPosition.y + NODE_BORDER + NODE_H / 2
    };
  }
  function inPort(card) {
    return {
      x: card.mapPosition.x + NODE_BORDER,
      y: card.mapPosition.y + NODE_BORDER + NODE_H / 2
    };
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

    bindEvents();
  }

  /* ══════════════════════════════════════════
     EVENTS
     ══════════════════════════════════════════ */

  function bindEvents() {

    /* Scroll zoom */
    container.addEventListener('wheel', function(e) {
      e.preventDefault();
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

      /* Pan — middle-click or left-click empty area */
      if (e.button === 1 || (e.button === 0 && !nodeEl)) {
        e.preventDefault();
        isPanning  = true;
        panStartX  = e.clientX;
        panStartY  = e.clientY;
        panOriginX = tx;
        panOriginY = ty;
        container.style.cursor = 'grabbing';
        selectNode(null);
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

        /* Start drag */
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

      if (dragNode) {
        var rect = container.getBoundingClientRect();
        var wx = (e.clientX - rect.left - tx) / scale - dragOffsetX;
        var wy = (e.clientY - rect.top  - ty) / scale - dragOffsetY;
        var cards = KanvazCards.getAll();
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

      /* Wire preview — update bezier to follow cursor */
      if (wireFrom && wirePreview) {
        var rect2 = container.getBoundingClientRect();
        var mx = (e.clientX - rect2.left - tx) / scale;
        var my = (e.clientY - rect2.top  - ty) / scale;
        var cards = KanvazCards.getAll();
        var fromCard = cards[wireFrom];
        if (fromCard && fromCard.mapPosition) {
          var op = outPort(fromCard);
          wirePreview.setAttribute('d', bezierPath(op.x, op.y, mx, my));
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
      if (dragNode) {
        KanvazApp.markDirty();
        KanvazHistory.push();
        dragNode = null;
        container.style.cursor = '';
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

    /* Create preview bezier */
    wirePreview = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    wirePreview.setAttribute('stroke', '#4A9EFF');
    wirePreview.setAttribute('stroke-width', '2.5');
    wirePreview.setAttribute('stroke-dasharray', '6 4');
    wirePreview.setAttribute('fill', 'none');
    wirePreview.setAttribute('stroke-linecap', 'round');
    wirePreview.setAttribute('opacity', '0.8');
    wirePreview.style.pointerEvents = 'none';
    svg.appendChild(wirePreview);

    /* Highlight source port */
    var portEl = document.querySelector('.map-node[data-ref-id="' + fromRefId + '"] .map-port-out');
    if (portEl) {
      portEl.style.background = '#4A9EFF';
      portEl.style.transform = 'scale(1.4)';
    }

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
    render();
    applyTransform();
    updateZoomDisplay();
  }

  function hide() {
    active = false;
    hasRenderedOnce = false;
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
      world.appendChild(buildNode(card));
      idx++;
    }

    renderLines();
    updateStatusBar(cards);

    /* Verify port alignment — logs warning if SVG vs DOM drift detected */
    setTimeout(function() { verifyPortAlignment(); }, 50);

    /* Fit all nodes into view on first open */
    if (!hasRenderedOnce) {
      hasRenderedOnce = true;
      fitAll(cards);
    }
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
    tx = (rect.width  / 2) - ((minX + (maxX - minX) / 2) * newScale);
    ty = (rect.height / 2) - ((minY + (maxY - minY) / 2) * newScale);
    scale = newScale;
    applyTransform();
    updateZoomDisplay();
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
      'box-shadow:0 2px 10px rgba(0,0,0,0.35)',
      'transition:border-color 0.15s, box-shadow 0.15s',
      'overflow:visible'
    ].join(';');

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
      portIn.style.background = '#4A9EFF';
      portIn.style.borderColor = '#4A9EFF';
      portIn.style.transform = 'translateY(-50%) scale(1.4)';
    };
    portIn.onmouseleave = function() {
      portIn.style.background = 'var(--color-port)';
      portIn.style.borderColor = 'var(--color-border-2)';
      portIn.style.transform = 'translateY(-50%)';
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
      portOut.style.background = '#4A9EFF';
      portOut.style.transform = 'translateY(-50%) scale(1.5)';
    };
    portOut.onmouseleave = function() {
      if (wireFrom === card.id) return;
      portOut.style.background = 'var(--color-border-2)';
      portOut.style.transform = 'translateY(-50%)';
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
    nameEl.style.cssText = 'flex:1;font-size:11px;font-family:var(--font-ui);color:var(--color-text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;line-height:1.3;';
    nameEl.textContent = card.name || 'Untitled';
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
      el.style.boxShadow = '0 2px 16px rgba(74,158,255,0.3)';
      highlightConnections(card.id);
    };
    el.onmouseleave = function() {
      if (selectedNode === card.id) return;
      el.style.borderColor = 'var(--color-border-2)';
      el.style.boxShadow = '0 2px 10px rgba(0,0,0,0.35)';
      unhighlightConnections();
    };

    return el;
  }

  /* ══════════════════════════════════════════
     BEZIER TUBE LINES
     ══════════════════════════════════════════ */

  function renderLines() {
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

      var op = outPort(fromCard);
      var ip = inPort(toCard);

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
      shadow.setAttribute('stroke', '#000');
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
      label.textContent = typeLabel(conn.type);
      svg.appendChild(label);
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
     SELECTION
     ══════════════════════════════════════════ */

  function selectNode(refId) {
    if (selectedNode) {
      var oldEl = document.querySelector('.map-node[data-ref-id="' + selectedNode + '"]');
      if (oldEl) {
        oldEl.style.borderColor = 'var(--color-border-2)';
        oldEl.style.boxShadow = '0 2px 10px rgba(0,0,0,0.35)';
      }
      unhighlightConnections();
    }
    selectedNode = refId;
    if (refId) {
      var el = document.querySelector('.map-node[data-ref-id="' + refId + '"]');
      if (el) {
        el.style.borderColor = 'var(--color-accent)';
        el.style.boxShadow = '0 0 0 2px rgba(74,158,255,0.3), 0 2px 16px rgba(74,158,255,0.3)';
      }
      KanvazCards.selectCard(refId);
    }
  }

  /* ══════════════════════════════════════════
     TYPE PICKER (after wire drop)
     ══════════════════════════════════════════ */

  function showTypePicker(fromId, toId) {
    var overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.4);z-index:30000;display:flex;align-items:center;justify-content:center;';

    var panel = document.createElement('div');
    panel.style.cssText = [
      'background:var(--color-surface)',
      'border:1px solid var(--color-border-2)',
      'border-radius:10px',
      'padding:14px',
      'width:220px',
      'box-shadow:0 12px 40px rgba(0,0,0,0.6)'
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
     DEBUG: PORT ALIGNMENT VERIFICATION
     Runs after every render — compares SVG port math against actual
     DOM port dot positions. Warns in console if they drift.
     ══════════════════════════════════════════ */

  function verifyPortAlignment() {
    if (!active || !container) return;
    var cards = KanvazCards.getAll();
    var issues = 0;

    for (var id in cards) {
      var card = cards[id];
      if (!card.mapPosition) continue;

      var nodeEl = document.querySelector('.map-node[data-ref-id="' + id + '"]');
      if (!nodeEl) continue;

      var outDot = nodeEl.querySelector('.map-port-out');
      var inDot  = nodeEl.querySelector('.map-port-in');
      if (!outDot || !inDot) continue;

      /* Get actual DOM positions (in world coords via container offset) */
      var cRect = container.getBoundingClientRect();
      var outRect = outDot.getBoundingClientRect();
      var inRect  = inDot.getBoundingClientRect();

      /* DOM dot center in world coords */
      var domOutX = (outRect.left + outRect.width / 2 - cRect.left - tx) / scale;
      var domOutY = (outRect.top  + outRect.height / 2 - cRect.top  - ty) / scale;
      var domInX  = (inRect.left  + inRect.width / 2  - cRect.left - tx) / scale;
      var domInY  = (inRect.top   + inRect.height / 2  - cRect.top  - ty) / scale;

      /* SVG computed positions */
      var svgOut = outPort(card);
      var svgIn  = inPort(card);

      /* Check alignment (allow 2px tolerance for rounding) */
      var threshold = 2;
      if (Math.abs(domOutX - svgOut.x) > threshold || Math.abs(domOutY - svgOut.y) > threshold) {
        console.warn('[Kanvaz] PORT MISALIGN — outPort for "' + (card.name || id) + '": DOM=(' +
          Math.round(domOutX) + ',' + Math.round(domOutY) + ') SVG=(' +
          Math.round(svgOut.x) + ',' + Math.round(svgOut.y) + ') delta=(' +
          Math.round(domOutX - svgOut.x) + ',' + Math.round(domOutY - svgOut.y) + ')');
        issues++;
      }
      if (Math.abs(domInX - svgIn.x) > threshold || Math.abs(domInY - svgIn.y) > threshold) {
        console.warn('[Kanvaz] PORT MISALIGN — inPort for "' + (card.name || id) + '": DOM=(' +
          Math.round(domInX) + ',' + Math.round(domInY) + ') SVG=(' +
          Math.round(svgIn.x) + ',' + Math.round(svgIn.y) + ') delta=(' +
          Math.round(domInX - svgIn.x) + ',' + Math.round(domInY - svgIn.y) + ')');
        issues++;
      }
    }

    if (issues === 0) {
      console.log('[Kanvaz] port alignment OK (' + Object.keys(cards).length + ' nodes checked)');
    }
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
    tx = s.tx || 0; ty = s.ty || 0; scale = s.scale || 1.0;
    if (active) { applyTransform(); updateZoomDisplay(); }
  }
  function resetView() {
    tx = 0; ty = 0; scale = 1.0;
    applyTransform(); updateZoomDisplay();
  }

  /* ══════════════════════════════════════════
     KEYBOARD
     ══════════════════════════════════════════ */

  function handleKey(e) {
    if (!active) return false;

    if (e.key === 'Escape') {
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
    verifyPortAlignment: verifyPortAlignment
  };

})();
