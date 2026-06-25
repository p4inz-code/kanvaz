/* map-view.js — relationship map visualization (v3.1)
 *
 * Renders references as compact node cards and connections as
 * SVG lines on an infinite pan/zoom canvas. Independent view
 * state from the board canvas.
 *
 * Layout: manual drag-to-place. References without a mapPosition
 * are auto-positioned in a grid on first render.
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

  var selectedNode = null;   /* ref ID of selected node */
  var dragNode     = null;   /* ref ID being dragged */
  var dragOffsetX  = 0;
  var dragOffsetY  = 0;

  /* Connection creation state */
  var connectFrom = null;    /* ref ID of source when creating a connection */

  /* ── Node sizing ── */
  var NODE_W      = 160;
  var NODE_H      = 48;
  var AUTO_COLS   = 6;
  var AUTO_GAP_X  = 200;
  var AUTO_GAP_Y  = 80;

  /* ── Connection type colors (match inspector) ── */
  var TYPE_COLORS = {
    RelatedTo:     '#6B7280',
    InspiredBy:    '#8B5CF6',
    DerivedFrom:   '#3B82F6',
    AlternativeTo: '#F59E0B',
    Supports:      '#10B981',
    UsedIn:        '#EF4444',
    References:    '#6366F1'
  };

  function typeColor(type) {
    return TYPE_COLORS[type] || '#6B7280';
  }

  function typeLabel(type) {
    return type.replace(/([A-Z])/g, ' $1').trim();
  }

  /* ══════════════════════════════════════════════════════════
     INIT — build the map container once, inserted into DOM
     ══════════════════════════════════════════════════════════ */

  function init() {
    if (container) return;

    container = document.createElement('div');
    container.id = 'map-container';
    container.style.cssText = [
      'position:absolute',
      'inset:0',
      'overflow:hidden',
      'display:none',
      'background:var(--color-bg)'
    ].join(';');

    world = document.createElement('div');
    world.id = 'map-world';
    world.style.cssText = [
      'position:absolute',
      'left:0',
      'top:0',
      'width:1px',
      'height:1px',
      'transform-origin:0 0'
    ].join(';');

    /* SVG layer for connection lines (below nodes) */
    svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('id', 'map-svg');
    svg.style.cssText = [
      'position:absolute',
      'left:0',
      'top:0',
      'width:1px',
      'height:1px',
      'overflow:visible',
      'pointer-events:none'
    ].join(';');

    /* Arrow marker definition */
    var defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
    var defaultColors = ['#6B7280', '#8B5CF6', '#3B82F6', '#F59E0B', '#10B981', '#EF4444', '#6366F1'];
    for (var ci = 0; ci < defaultColors.length; ci++) {
      var marker = document.createElementNS('http://www.w3.org/2000/svg', 'marker');
      var safeId = defaultColors[ci].replace('#', '');
      marker.setAttribute('id', 'arrow-' + safeId);
      marker.setAttribute('viewBox', '0 0 10 10');
      marker.setAttribute('refX', '10');
      marker.setAttribute('refY', '5');
      marker.setAttribute('markerWidth', '8');
      marker.setAttribute('markerHeight', '8');
      marker.setAttribute('orient', 'auto-start-reverse');
      var path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('d', 'M 0 0 L 10 5 L 0 10 z');
      path.setAttribute('fill', defaultColors[ci]);
      marker.appendChild(path);
      defs.appendChild(marker);
    }
    svg.appendChild(defs);

    world.appendChild(svg);
    container.appendChild(world);

    /* Insert into canvas-container (sibling to canvas-world) */
    var canvasContainer = document.getElementById('canvas-container');
    if (canvasContainer) {
      canvasContainer.appendChild(container);
    }

    bindEvents();
  }

  /* ══════════════════════════════════════════════════════════
     EVENTS — pan, zoom, node interaction
     ══════════════════════════════════════════════════════════ */

  function bindEvents() {

    /* Scroll zoom */
    container.addEventListener('wheel', function(e) {
      e.preventDefault();
      var dir = e.deltaY < 0 ? 1 : -1;
      var newScale = scale + dir * ZOOM_STEP;
      newScale = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, newScale));

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

    /* Pan + node drag */
    container.addEventListener('mousedown', function(e) {
      var nodeEl = e.target.closest('.map-node');

      if (e.button === 1 || (e.button === 0 && !nodeEl)) {
        /* Pan — middle-click or left-click on empty area */
        e.preventDefault();
        isPanning  = true;
        panStartX  = e.clientX;
        panStartY  = e.clientY;
        panOriginX = tx;
        panOriginY = ty;
        container.style.cursor = 'grabbing';
        selectNode(null);
        cancelConnect();
        return;
      }

      /* Node click */
      if (nodeEl && e.button === 0) {
        var refId = nodeEl.dataset.refId;

        /* If in connect mode, complete the connection */
        if (connectFrom && connectFrom !== refId) {
          completeConnection(refId);
          return;
        }

        /* Select */
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
      }
    });

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
      }
    });

    /* Right-click on node — context menu */
    container.addEventListener('contextmenu', function(e) {
      e.preventDefault();
      var nodeEl = e.target.closest('.map-node');
      if (nodeEl) {
        showNodeMenu(nodeEl.dataset.refId, e.clientX, e.clientY);
      }
    });
  }

  /* ══════════════════════════════════════════════════════════
     TRANSFORM
     ══════════════════════════════════════════════════════════ */

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

  /* ══════════════════════════════════════════════════════════
     SHOW / HIDE
     ══════════════════════════════════════════════════════════ */

  function show() {
    init();
    active = true;
    container.style.display = '';

    /* Hide board world + grid + empty state */
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
    if (container) container.style.display = 'none';

    /* Restore board world */
    var cw = document.getElementById('canvas-world');
    var cg = document.getElementById('canvas-grid');
    var ce = document.getElementById('canvas-empty');
    if (cw) cw.style.display = '';
    if (cg) cg.style.display = '';
    if (ce) ce.style.display = '';

    cancelConnect();

    /* Restore board zoom display */
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
    var btn = document.getElementById('btn-view-toggle');
    if (!btn) return;
    var boardSpan = btn.querySelector('.vt-board');
    var mapSpan   = btn.querySelector('.vt-map');
    if (boardSpan) boardSpan.style.opacity = active ? '0.4' : '1';
    if (mapSpan)   mapSpan.style.opacity   = active ? '1' : '0.4';
  }

  /* ══════════════════════════════════════════════════════════
     RENDER — rebuild all nodes + lines
     ══════════════════════════════════════════════════════════ */

  function render() {
    if (!active || !world) return;

    /* Clear old nodes (keep SVG) */
    var oldNodes = world.querySelectorAll('.map-node');
    for (var r = 0; r < oldNodes.length; r++) {
      world.removeChild(oldNodes[r]);
    }

    var cards = KanvazCards.getAll();
    var idx = 0;

    for (var id in cards) {
      var card = cards[id];

      /* Auto-position if no mapPosition */
      if (!card.mapPosition) {
        var col = idx % AUTO_COLS;
        var row = Math.floor(idx / AUTO_COLS);
        card.mapPosition = {
          x: col * AUTO_GAP_X + 40,
          y: row * AUTO_GAP_Y + 40
        };
      }

      var node = buildNode(card);
      world.appendChild(node);
      idx++;
    }

    renderLines();
    updateStatusBar(cards);
  }

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
      'border-radius:8px',
      'display:flex',
      'align-items:center',
      'gap:8px',
      'padding:0 12px',
      'cursor:grab',
      'user-select:none',
      'box-shadow:0 2px 8px rgba(0,0,0,0.3)',
      'transition:border-color 0.15s, box-shadow 0.15s',
      'overflow:hidden'
    ].join(';');

    /* Thumbnail or icon */
    var thumb = document.createElement('div');
    thumb.style.cssText = 'width:28px;height:28px;border-radius:4px;flex-shrink:0;display:flex;align-items:center;justify-content:center;font-size:16px;background:var(--color-surface-2);overflow:hidden;';

    if (card.dataUrl && (card.type === 'image' || card.type === 'gif')) {
      var img = document.createElement('img');
      img.src = card.dataUrl;
      img.style.cssText = 'width:100%;height:100%;object-fit:cover;';
      thumb.appendChild(img);
    } else {
      var icon = '';
      if (typeof KanvazRefTypes !== 'undefined') {
        icon = KanvazRefTypes.getIcon(card.type);
      }
      thumb.textContent = icon || '\u2753';
    }
    el.appendChild(thumb);

    /* Name */
    var nameEl = document.createElement('div');
    nameEl.style.cssText = 'flex:1;font-size:11px;font-family:var(--font-ui);color:var(--color-text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;line-height:1.3;';
    nameEl.textContent = card.name || 'Untitled';
    el.appendChild(nameEl);

    /* Connection count badge */
    var connCount = 0;
    if (typeof KanvazConnections !== 'undefined') {
      connCount = KanvazConnections.getAll(card.id).length;
    }
    if (connCount > 0) {
      var badge = document.createElement('div');
      badge.style.cssText = 'font-size:9px;color:var(--color-accent);background:var(--color-accent-bg);padding:2px 5px;border-radius:10px;flex-shrink:0;font-weight:600;';
      badge.textContent = connCount;
      el.appendChild(badge);
    }

    /* Hover effect */
    el.onmouseenter = function() {
      if (dragNode) return;
      el.style.borderColor = 'var(--color-accent)';
      el.style.boxShadow = '0 2px 12px rgba(74,158,255,0.25)';
      highlightConnections(card.id);
    };
    el.onmouseleave = function() {
      if (selectedNode === card.id) return;
      el.style.borderColor = 'var(--color-border-2)';
      el.style.boxShadow = '0 2px 8px rgba(0,0,0,0.3)';
      unhighlightConnections();
    };

    return el;
  }

  /* ══════════════════════════════════════════════════════════
     SVG CONNECTION LINES
     ══════════════════════════════════════════════════════════ */

  function renderLines() {
    if (!svg) return;

    /* Remove old lines (keep defs) */
    var oldLines = svg.querySelectorAll('.conn-line, .conn-label');
    for (var i = 0; i < oldLines.length; i++) {
      svg.removeChild(oldLines[i]);
    }

    if (typeof KanvazConnections === 'undefined') return;

    var conns = KanvazConnections.serialise();
    var cards = KanvazCards.getAll();

    for (var j = 0; j < conns.length; j++) {
      var conn = conns[j];
      var fromCard = cards[conn.fromRefId];
      var toCard   = cards[conn.toRefId];
      if (!fromCard || !toCard) continue;
      if (!fromCard.mapPosition || !toCard.mapPosition) continue;

      var x1 = fromCard.mapPosition.x + NODE_W / 2;
      var y1 = fromCard.mapPosition.y + NODE_H / 2;
      var x2 = toCard.mapPosition.x   + NODE_W / 2;
      var y2 = toCard.mapPosition.y   + NODE_H / 2;

      /* Shorten line to stop at node edge */
      var dx = x2 - x1;
      var dy = y2 - y1;
      var dist = Math.sqrt(dx * dx + dy * dy);
      var pad = NODE_W / 2 + 4;
      if (dist < pad * 2) continue;
      var nx = dx / dist;
      var ny = dy / dist;
      var sx = x1 + nx * pad;
      var sy = y1 + ny * pad;
      var ex = x2 - nx * pad;
      var ey = y2 - ny * pad;

      var color = typeColor(conn.type);
      var safeId = color.replace('#', '');

      /* Line */
      var line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      line.setAttribute('class', 'conn-line');
      line.setAttribute('x1', sx);
      line.setAttribute('y1', sy);
      line.setAttribute('x2', ex);
      line.setAttribute('y2', ey);
      line.setAttribute('stroke', color);
      line.setAttribute('stroke-width', '1.5');
      line.setAttribute('stroke-opacity', '0.6');
      line.setAttribute('marker-end', 'url(#arrow-' + safeId + ')');
      line.dataset.connId = conn.id;
      svg.appendChild(line);

      /* Label at midpoint */
      var mx = (sx + ex) / 2;
      var my = (sy + ey) / 2;
      var label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      label.setAttribute('class', 'conn-label');
      label.setAttribute('x', mx);
      label.setAttribute('y', my - 6);
      label.setAttribute('text-anchor', 'middle');
      label.setAttribute('fill', color);
      label.setAttribute('font-size', '9');
      label.setAttribute('font-family', 'var(--font-ui)');
      label.setAttribute('opacity', '0.7');
      label.textContent = typeLabel(conn.type);
      svg.appendChild(label);
    }
  }

  function highlightConnections(refId) {
    if (!svg) return;
    var conns = KanvazConnections.getAll(refId);
    var connIds = {};
    for (var i = 0; i < conns.length; i++) connIds[conns[i].id] = true;

    var lines = svg.querySelectorAll('.conn-line');
    for (var j = 0; j < lines.length; j++) {
      if (connIds[lines[j].dataset.connId]) {
        lines[j].setAttribute('stroke-opacity', '1');
        lines[j].setAttribute('stroke-width', '2.5');
      } else {
        lines[j].setAttribute('stroke-opacity', '0.15');
      }
    }

    var labels = svg.querySelectorAll('.conn-label');
    for (var k = 0; k < labels.length; k++) {
      /* Labels don't have connId — just dim all non-highlighted */
      labels[k].setAttribute('opacity', '0.2');
    }
  }

  function unhighlightConnections() {
    if (!svg) return;
    var lines = svg.querySelectorAll('.conn-line');
    for (var j = 0; j < lines.length; j++) {
      lines[j].setAttribute('stroke-opacity', '0.6');
      lines[j].setAttribute('stroke-width', '1.5');
    }
    var labels = svg.querySelectorAll('.conn-label');
    for (var k = 0; k < labels.length; k++) {
      labels[k].setAttribute('opacity', '0.7');
    }
  }

  /* ══════════════════════════════════════════════════════════
     SELECTION + CONNECT MODE
     ══════════════════════════════════════════════════════════ */

  function selectNode(refId) {
    /* Deselect old */
    if (selectedNode) {
      var oldEl = document.querySelector('.map-node[data-ref-id="' + selectedNode + '"]');
      if (oldEl) {
        oldEl.style.borderColor = 'var(--color-border-2)';
        oldEl.style.boxShadow = '0 2px 8px rgba(0,0,0,0.3)';
      }
      unhighlightConnections();
    }

    selectedNode = refId;

    /* Select new */
    if (refId) {
      var el = document.querySelector('.map-node[data-ref-id="' + refId + '"]');
      if (el) {
        el.style.borderColor = 'var(--color-accent)';
        el.style.boxShadow = '0 0 0 2px rgba(74,158,255,0.3), 0 2px 12px rgba(74,158,255,0.25)';
      }
      /* Also select on board canvas */
      KanvazCards.selectCard(refId);
    }
  }

  function startConnect(fromRefId) {
    connectFrom = fromRefId;
    container.style.cursor = 'crosshair';
    KanvazUI.toast('Click a reference to connect to (Esc to cancel)');

    /* Highlight source node */
    var el = document.querySelector('.map-node[data-ref-id="' + fromRefId + '"]');
    if (el) {
      el.style.borderColor = '#10B981';
      el.style.boxShadow = '0 0 0 2px rgba(16,185,129,0.3)';
    }
  }

  function completeConnection(toRefId) {
    if (!connectFrom || connectFrom === toRefId) {
      cancelConnect();
      return;
    }

    /* Show type picker inline */
    showTypePicker(connectFrom, toRefId);
    cancelConnect();
  }

  function cancelConnect() {
    if (connectFrom) {
      var el = document.querySelector('.map-node[data-ref-id="' + connectFrom + '"]');
      if (el) {
        el.style.borderColor = selectedNode === connectFrom ? 'var(--color-accent)' : 'var(--color-border-2)';
        el.style.boxShadow = selectedNode === connectFrom
          ? '0 0 0 2px rgba(74,158,255,0.3), 0 2px 12px rgba(74,158,255,0.25)'
          : '0 2px 8px rgba(0,0,0,0.3)';
      }
    }
    connectFrom = null;
    if (container) container.style.cursor = '';
  }

  /* ══════════════════════════════════════════════════════════
     CONNECTION TYPE PICKER (inline)
     ══════════════════════════════════════════════════════════ */

  function showTypePicker(fromId, toId) {
    var overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.4);z-index:30000;display:flex;align-items:center;justify-content:center;';

    var panel = document.createElement('div');
    panel.style.cssText = [
      'background:var(--color-surface)',
      'border:1px solid var(--color-border-2)',
      'border-radius:10px',
      'padding:16px',
      'width:240px',
      'box-shadow:0 12px 40px rgba(0,0,0,0.6)'
    ].join(';');

    var title = document.createElement('div');
    title.style.cssText = 'font-weight:600;font-size:13px;margin-bottom:12px;color:var(--color-text);font-family:var(--font-ui);';
    title.textContent = 'Connection type';
    panel.appendChild(title);

    var types = KanvazConnections.CONNECTION_TYPES;
    for (var i = 0; i < types.length; i++) {
      (function(type) {
        var btn = document.createElement('button');
        btn.style.cssText = [
          'display:block',
          'width:100%',
          'padding:8px 10px',
          'margin-bottom:4px',
          'background:var(--color-surface-2)',
          'border:1px solid transparent',
          'border-radius:6px',
          'color:var(--color-text)',
          'font-family:var(--font-ui)',
          'font-size:12px',
          'cursor:pointer',
          'text-align:left',
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

  /* ══════════════════════════════════════════════════════════
     NODE CONTEXT MENU
     ══════════════════════════════════════════════════════════ */

  function showNodeMenu(refId, x, y) {
    selectNode(refId);

    var menu = document.getElementById('context-menu');
    if (!menu) return;
    menu.innerHTML = '';
    menu.className = 'visible';

    var items = [
      {
        label: 'Connect to\u2026',
        action: function() { startConnect(refId); }
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
        row.onclick = function() {
          menu.className = '';
          action();
        };
      })(items[i].action);

      menu.appendChild(row);
    }

    menu.style.left = x + 'px';
    menu.style.top  = y + 'px';
  }

  /* ══════════════════════════════════════════════════════════
     STATUS BAR
     ══════════════════════════════════════════════════════════ */

  function updateStatusBar(cards) {
    var refCount = 0;
    for (var k in cards) refCount++;
    var connCount = 0;
    if (typeof KanvazConnections !== 'undefined') connCount = KanvazConnections.count();

    var cardsEl = document.getElementById('status-cards');
    if (cardsEl) cardsEl.textContent = refCount + ' refs \u00B7 ' + connCount + ' conn';
  }

  /* ══════════════════════════════════════════════════════════
     VIEW STATE — save/restore per board
     ══════════════════════════════════════════════════════════ */

  function getState() {
    return { tx: tx, ty: ty, scale: scale };
  }

  function setState(state) {
    if (!state) return;
    tx    = state.tx    || 0;
    ty    = state.ty    || 0;
    scale = state.scale || 1.0;
    if (active) {
      applyTransform();
      updateZoomDisplay();
    }
  }

  function resetView() {
    tx = 0;
    ty = 0;
    scale = 1.0;
    applyTransform();
    updateZoomDisplay();
  }

  /* ══════════════════════════════════════════════════════════
     KEYBOARD — Esc cancels connect mode
     ══════════════════════════════════════════════════════════ */

  function handleKey(e) {
    if (!active) return false;

    if (e.key === 'Escape') {
      if (connectFrom) { cancelConnect(); return true; }
      /* Close inspector and deselect */
      if (typeof KanvazInspector !== 'undefined' && KanvazInspector.isOpen()) {
        KanvazInspector.close();
        return true;
      }
      if (selectedNode) { selectNode(null); return true; }
    }

    /* 0 — reset map zoom */
    if (e.key === '0' && !e.ctrlKey && !e.shiftKey) {
      resetView();
      return true;
    }

    /* C — open inspector for selected node */
    if ((e.key === 'c' || e.key === 'C') && selectedNode) {
      if (typeof KanvazInspector !== 'undefined') KanvazInspector.open(selectedNode);
      return true;
    }

    /* Delete — remove selected node's connections (not the ref itself) */
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
    init:           init,
    show:           show,
    hide:           hide,
    toggle:         toggle,
    isActive:       isActive,
    render:         render,
    getState:       getState,
    setState:       setState,
    resetView:      resetView,
    handleKey:      handleKey,
    updateToggleBtn: updateToggleBtn
  };

})();
