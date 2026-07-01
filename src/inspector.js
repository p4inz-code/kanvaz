/* inspector.js — Connection Inspector panel (v3.0)
 *
 * Shows a panel listing all connections (outgoing + incoming)
 * for the currently selected reference. Allows creating new
 * connections, editing metadata, and deleting connections.
 */

var KanvazInspector = (function() {

  var panelEl  = null;
  var activeId = null;  /* reference ID currently being inspected */

  /* ── Styles ── */

  var PANEL_CSS = [
    'position:fixed',
    'right:12px',
    'top:52px',
    'bottom:12px',
    'width:300px',
    'background:var(--color-surface)',
    'border:1px solid var(--color-border-2)',
    'border-radius:10px',
    'box-shadow:0 8px 32px rgba(0,0,0,0.5)',
    'z-index:20000',
    'display:flex',
    'flex-direction:column',
    'overflow:hidden',
    'font-family:var(--font-ui)',
    'font-size:13px',
    'color:var(--color-text)'
  ].join(';');

  var HEADER_CSS = [
    'padding:14px 16px 10px',
    'border-bottom:1px solid var(--color-border)',
    'display:flex',
    'align-items:center',
    'justify-content:space-between',
    'flex-shrink:0'
  ].join(';');

  var BODY_CSS = [
    'flex:1',
    'overflow-y:auto',
    'padding:12px 16px'
  ].join(';');

  var SECTION_TITLE_CSS = [
    'font-size:10px',
    'text-transform:uppercase',
    'letter-spacing:0.08em',
    'color:var(--color-text-3)',
    'margin:12px 0 6px',
    'font-weight:600'
  ].join(';');

  var CONN_ROW_CSS = [
    'padding:8px 10px',
    'background:var(--color-surface-2)',
    'border-radius:6px',
    'margin-bottom:6px',
    'cursor:default',
    'position:relative'
  ].join(';');

  var TAG_CSS = [
    'display:inline-block',
    'font-size:10px',
    'padding:2px 6px',
    'border-radius:3px',
    'margin-right:4px',
    'font-weight:600'
  ].join(';');

  /* ── Connection type display ── */

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
    /* Insert spaces before capitals: 'InspiredBy' → 'Inspired By' */
    return type.replace(/([A-Z])/g, ' $1').trim();
  }

  /* ── Open / Close ── */

  function open(refId) {
    if (panelEl && activeId === refId) { close(); return; }
    if (panelEl) close();

    activeId = refId;
    var cards = KanvazCards.getAll();
    var ref   = cards[refId];
    if (!ref) return;

    panelEl = document.createElement('div');
    panelEl.id = 'connection-inspector';
    panelEl.style.cssText = PANEL_CSS;

    /* ── Header ── */
    var header = document.createElement('div');
    header.style.cssText = HEADER_CSS;

    var titleWrap = document.createElement('div');
    titleWrap.style.cssText = 'overflow:hidden;';

    var titleRow = document.createElement('div');
    titleRow.style.cssText = 'font-weight:600;font-size:14px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;';

    var icon = '';
    if (typeof KanvazRefTypes !== 'undefined') {
      icon = KanvazRefTypes.getIcon(ref.type) + ' ';
    }
    titleRow.textContent = icon + (ref.name || 'Untitled');
    titleWrap.appendChild(titleRow);

    var subtitle = document.createElement('div');
    subtitle.style.cssText = 'font-size:11px;color:var(--color-text-3);margin-top:2px;';
    var outCount = KanvazConnections.getFrom(refId).length;
    var inCount  = KanvazConnections.getTo(refId).length;
    subtitle.textContent = (outCount + inCount) + ' connection' + ((outCount + inCount) !== 1 ? 's' : '');
    titleWrap.appendChild(subtitle);
    header.appendChild(titleWrap);

    var closeBtn = document.createElement('button');
    closeBtn.textContent = '\u2715';
    closeBtn.title = 'Close';
    closeBtn.style.cssText = 'background:none;border:none;color:var(--color-text-3);font-size:16px;cursor:pointer;padding:4px 6px;line-height:1;';
    closeBtn.onmouseenter = function() { closeBtn.style.color = 'var(--color-text)'; };
    closeBtn.onmouseleave = function() { closeBtn.style.color = 'var(--color-text-3)'; };
    closeBtn.onclick = close;
    header.appendChild(closeBtn);

    panelEl.appendChild(header);

    /* ── Body ── */
    var body = document.createElement('div');
    body.id = 'inspector-body';
    body.style.cssText = BODY_CSS;

    renderConnections(body, refId);
    panelEl.appendChild(body);

    /* ── Footer: Add connection button ── */
    var footer = document.createElement('div');
    footer.style.cssText = 'padding:10px 16px;border-top:1px solid var(--color-border);flex-shrink:0;';

    var addBtn = document.createElement('button');
    addBtn.textContent = '+ Add connection';
    addBtn.style.cssText = [
      'width:100%',
      'padding:8px',
      'background:var(--color-accent-bg)',
      'border:1px solid var(--color-accent)',
      'border-radius:6px',
      'color:var(--color-accent)',
      'font-family:var(--font-ui)',
      'font-size:12px',
      'cursor:pointer',
      'transition:background 0.1s'
    ].join(';');
    addBtn.onmouseenter = function() { addBtn.style.background = 'rgba(74,158,255,0.2)'; };
    addBtn.onmouseleave = function() { addBtn.style.background = 'var(--color-accent-bg)'; };
    addBtn.onclick = function() { showAddDialog(refId); };
    footer.appendChild(addBtn);

    panelEl.appendChild(footer);
    document.body.appendChild(panelEl);
  }

  function close() {
    if (panelEl && panelEl.parentNode) {
      panelEl.parentNode.removeChild(panelEl);
    }
    panelEl  = null;
    activeId = null;
  }

  function isOpen() {
    return !!panelEl;
  }

  function refresh() {
    if (!activeId) return;
    var body = document.getElementById('inspector-body');
    if (!body) return;
    body.innerHTML = '';
    renderConnections(body, activeId);

    /* Update subtitle count */
    var outCount = KanvazConnections.getFrom(activeId).length;
    var inCount  = KanvazConnections.getTo(activeId).length;
    var subtitle = panelEl.querySelector('div[style*="font-size:11px"]');
    if (subtitle) {
      subtitle.textContent = (outCount + inCount) + ' connection' + ((outCount + inCount) !== 1 ? 's' : '');
    }
  }

  /* ── Render connection list ── */

  function renderConnections(container, refId) {
    var outgoing = KanvazConnections.getFrom(refId);
    var incoming = KanvazConnections.getTo(refId);
    var cards    = KanvazCards.getAll();

    if (outgoing.length === 0 && incoming.length === 0) {
      var empty = document.createElement('div');
      empty.style.cssText = 'text-align:center;color:var(--color-text-3);padding:40px 20px;font-size:12px;';
      empty.innerHTML = 'No connections yet.<br><span style="font-size:11px;opacity:0.7;">Click \u201c+ Add connection\u201d below to link this reference to another.</span>';
      container.appendChild(empty);
      return;
    }

    /* Outgoing */
    if (outgoing.length) {
      var outTitle = document.createElement('div');
      outTitle.style.cssText = SECTION_TITLE_CSS;
      outTitle.textContent = 'Outgoing (' + outgoing.length + ')';
      container.appendChild(outTitle);

      for (var i = 0; i < outgoing.length; i++) {
        container.appendChild(buildConnectionRow(outgoing[i], 'to', cards));
      }
    }

    /* Incoming */
    if (incoming.length) {
      var inTitle = document.createElement('div');
      inTitle.style.cssText = SECTION_TITLE_CSS;
      inTitle.textContent = 'Incoming (' + incoming.length + ')';
      container.appendChild(inTitle);

      for (var j = 0; j < incoming.length; j++) {
        container.appendChild(buildConnectionRow(incoming[j], 'from', cards));
      }
    }
  }

  function buildConnectionRow(conn, direction, cards) {
    var row = document.createElement('div');
    row.style.cssText = CONN_ROW_CSS;

    /* Target reference info */
    var targetId = direction === 'to' ? conn.toRefId : conn.fromRefId;
    var target   = cards[targetId];
    var targetName = target ? (target.name || 'Untitled') : '(deleted)';

    /* Type tag */
    var tag = document.createElement('span');
    tag.style.cssText = TAG_CSS + 'background:' + typeColor(conn.type) + '22;color:' + typeColor(conn.type) + ';';
    tag.textContent = typeLabel(conn.type);
    row.appendChild(tag);

    /* Priority indicator */
    if (conn.priority && conn.priority > 1) {
      var pTag = document.createElement('span');
      pTag.style.cssText = TAG_CSS + 'background:rgba(255,255,255,0.06);color:var(--color-text-3);';
      pTag.textContent = conn.priority === 3 ? 'High' : 'Medium';
      row.appendChild(pTag);
    }

    /* Arrow + target name */
    var nameRow = document.createElement('div');
    nameRow.style.cssText = 'margin-top:6px;font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;';

    var arrow = direction === 'to' ? '\u2192 ' : '\u2190 ';
    var icon  = '';
    if (target && typeof KanvazRefTypes !== 'undefined') {
      icon = KanvazRefTypes.getIcon(target.type) + ' ';
    }
    nameRow.textContent = arrow + icon + targetName;
    row.appendChild(nameRow);

    /* Note */
    if (conn.note) {
      var noteEl = document.createElement('div');
      noteEl.style.cssText = 'margin-top:4px;font-size:11px;color:var(--color-text-3);font-style:italic;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;';
      noteEl.textContent = conn.note;
      row.appendChild(noteEl);
    }

    /* Action buttons (edit / delete) */
    var actions = document.createElement('div');
    actions.style.cssText = 'position:absolute;top:6px;right:8px;display:flex;gap:4px;';

    var editBtn = document.createElement('button');
    editBtn.textContent = '\u270E';
    editBtn.title = 'Edit';
    editBtn.style.cssText = 'background:none;border:none;color:var(--color-text-3);cursor:pointer;font-size:12px;padding:2px;';
    editBtn.onmouseenter = function() { editBtn.style.color = 'var(--color-accent)'; };
    editBtn.onmouseleave = function() { editBtn.style.color = 'var(--color-text-3)'; };
    (function(c) {
      editBtn.onclick = function() { showEditDialog(c); };
    })(conn);
    actions.appendChild(editBtn);

    var delBtn = document.createElement('button');
    delBtn.textContent = '\u2715';
    delBtn.title = 'Remove';
    delBtn.style.cssText = 'background:none;border:none;color:var(--color-text-3);cursor:pointer;font-size:12px;padding:2px;';
    delBtn.onmouseenter = function() { delBtn.style.color = '#EF4444'; };
    delBtn.onmouseleave = function() { delBtn.style.color = 'var(--color-text-3)'; };
    (function(c) {
      delBtn.onclick = function() {
        KanvazConnections.remove(c.id);
        KanvazHistory.push();
        refresh();
        KanvazUI.toast('Connection removed');
      };
    })(conn);
    actions.appendChild(delBtn);

    row.appendChild(actions);

    /* Click row to select target reference */
    row.style.cursor = 'pointer';
    (function(tid) {
      row.ondblclick = function() {
        var el = document.getElementById(tid);
        if (el) {
          KanvazCards.selectCard(tid);
          el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      };
    })(targetId);

    return row;
  }

  /* ── Add connection dialog ── */

  function showAddDialog(fromRefId) {
    var overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;background:var(--color-overlay);z-index:30000;display:flex;align-items:center;justify-content:center;';

    var dialog = document.createElement('div');
    dialog.style.cssText = [
      'background:var(--color-surface)',
      'border:1px solid var(--color-border-2)',
      'border-radius:10px',
      'padding:20px',
      'width:320px',
      'max-height:80vh',
      'overflow-y:auto',
      'box-shadow:0 12px 40px rgba(0,0,0,0.6)'
    ].join(';');

    /* Title */
    var title = document.createElement('div');
    title.style.cssText = 'font-weight:600;font-size:14px;margin-bottom:16px;';
    title.textContent = 'Add Connection';
    dialog.appendChild(title);

    /* Target reference picker */
    var targetLabel = document.createElement('div');
    targetLabel.style.cssText = SECTION_TITLE_CSS + 'margin-top:0;';
    targetLabel.textContent = 'Connect to';
    dialog.appendChild(targetLabel);

    var targetSelect = document.createElement('select');
    targetSelect.style.cssText = 'width:100%;padding:8px;background:var(--color-surface-2);border:1px solid var(--color-border);border-radius:6px;color:var(--color-text);font-family:var(--font-ui);font-size:12px;margin-bottom:12px;';

    var cards = KanvazCards.getAll();
    var optDefault = document.createElement('option');
    optDefault.value = '';
    optDefault.textContent = 'Select a reference...';
    targetSelect.appendChild(optDefault);

    for (var id in cards) {
      if (id === fromRefId) continue;
      var c = cards[id];
      var opt = document.createElement('option');
      opt.value = id;
      var icon = '';
      if (typeof KanvazRefTypes !== 'undefined') {
        icon = KanvazRefTypes.getIcon(c.type) + ' ';
      }
      opt.textContent = icon + (c.name || 'Untitled');
      targetSelect.appendChild(opt);
    }
    dialog.appendChild(targetSelect);

    /* Relationship type */
    var typeLabel2 = document.createElement('div');
    typeLabel2.style.cssText = SECTION_TITLE_CSS;
    typeLabel2.textContent = 'Relationship';
    dialog.appendChild(typeLabel2);

    var typeSelect = document.createElement('select');
    typeSelect.style.cssText = targetSelect.style.cssText;

    var types = KanvazConnections.CONNECTION_TYPES;
    for (var t = 0; t < types.length; t++) {
      var tOpt = document.createElement('option');
      tOpt.value = types[t];
      tOpt.textContent = typeLabel(types[t]);
      typeSelect.appendChild(tOpt);
    }
    dialog.appendChild(typeSelect);

    /* Note */
    var noteLabel2 = document.createElement('div');
    noteLabel2.style.cssText = SECTION_TITLE_CSS;
    noteLabel2.textContent = 'Note (optional)';
    dialog.appendChild(noteLabel2);

    var noteInput = document.createElement('input');
    noteInput.type = 'text';
    noteInput.placeholder = 'Why are these connected?';
    noteInput.style.cssText = 'width:100%;padding:8px;background:var(--color-surface-2);border:1px solid var(--color-border);border-radius:6px;color:var(--color-text);font-family:var(--font-ui);font-size:12px;margin-bottom:12px;box-sizing:border-box;';
    dialog.appendChild(noteInput);

    /* Priority */
    var priLabel = document.createElement('div');
    priLabel.style.cssText = SECTION_TITLE_CSS;
    priLabel.textContent = 'Priority';
    dialog.appendChild(priLabel);

    var priSelect = document.createElement('select');
    priSelect.style.cssText = typeSelect.style.cssText;
    var priOpts = [['1', 'Low'], ['2', 'Medium'], ['3', 'High']];
    for (var p = 0; p < priOpts.length; p++) {
      var pOpt = document.createElement('option');
      pOpt.value = priOpts[p][0];
      pOpt.textContent = priOpts[p][1];
      priSelect.appendChild(pOpt);
    }
    dialog.appendChild(priSelect);

    /* Buttons */
    var btnRow = document.createElement('div');
    btnRow.style.cssText = 'display:flex;gap:8px;margin-top:16px;';

    var cancelBtn = document.createElement('button');
    cancelBtn.textContent = 'Cancel';
    cancelBtn.style.cssText = 'flex:1;padding:8px;background:var(--color-surface-2);border:1px solid var(--color-border);border-radius:6px;color:var(--color-text);font-family:var(--font-ui);font-size:12px;cursor:pointer;';
    cancelBtn.onclick = function() { overlay.parentNode.removeChild(overlay); };
    btnRow.appendChild(cancelBtn);

    var createBtn = document.createElement('button');
    createBtn.textContent = 'Create';
    createBtn.style.cssText = 'flex:1;padding:8px;background:var(--color-accent);border:none;border-radius:6px;color:#fff;font-family:var(--font-ui);font-size:12px;cursor:pointer;font-weight:600;';
    createBtn.onclick = function() {
      var targetId = targetSelect.value;
      if (!targetId) {
        KanvazUI.toast('Select a reference to connect to');
        return;
      }
      KanvazConnections.create(fromRefId, targetId, typeSelect.value, {
        note:     noteInput.value,
        priority: parseInt(priSelect.value, 10)
      });
      KanvazHistory.push();
      overlay.parentNode.removeChild(overlay);
      refresh();
      KanvazUI.toast('Connection created');
    };
    btnRow.appendChild(createBtn);

    dialog.appendChild(btnRow);
    overlay.appendChild(dialog);

    /* Close on backdrop */
    overlay.onclick = function(e) {
      if (e.target === overlay) overlay.parentNode.removeChild(overlay);
    };

    document.body.appendChild(overlay);
    targetSelect.focus();
  }

  /* ── Edit connection dialog ── */

  function showEditDialog(conn) {
    var overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;background:var(--color-overlay);z-index:30000;display:flex;align-items:center;justify-content:center;';

    var dialog = document.createElement('div');
    dialog.style.cssText = [
      'background:var(--color-surface)',
      'border:1px solid var(--color-border-2)',
      'border-radius:10px',
      'padding:20px',
      'width:300px',
      'box-shadow:0 12px 40px rgba(0,0,0,0.6)'
    ].join(';');

    var title = document.createElement('div');
    title.style.cssText = 'font-weight:600;font-size:14px;margin-bottom:16px;';
    title.textContent = 'Edit Connection';
    dialog.appendChild(title);

    /* Type */
    var typeLabel3 = document.createElement('div');
    typeLabel3.style.cssText = SECTION_TITLE_CSS + 'margin-top:0;';
    typeLabel3.textContent = 'Relationship';
    dialog.appendChild(typeLabel3);

    var typeSelect = document.createElement('select');
    typeSelect.style.cssText = 'width:100%;padding:8px;background:var(--color-surface-2);border:1px solid var(--color-border);border-radius:6px;color:var(--color-text);font-family:var(--font-ui);font-size:12px;margin-bottom:12px;';

    var types = KanvazConnections.CONNECTION_TYPES;
    for (var t = 0; t < types.length; t++) {
      var tOpt = document.createElement('option');
      tOpt.value = types[t];
      tOpt.textContent = typeLabel(types[t]);
      if (types[t] === conn.type) tOpt.selected = true;
      typeSelect.appendChild(tOpt);
    }
    dialog.appendChild(typeSelect);

    /* Note */
    var noteLabel3 = document.createElement('div');
    noteLabel3.style.cssText = SECTION_TITLE_CSS;
    noteLabel3.textContent = 'Note';
    dialog.appendChild(noteLabel3);

    var noteInput = document.createElement('input');
    noteInput.type = 'text';
    noteInput.value = conn.note || '';
    noteInput.style.cssText = 'width:100%;padding:8px;background:var(--color-surface-2);border:1px solid var(--color-border);border-radius:6px;color:var(--color-text);font-family:var(--font-ui);font-size:12px;margin-bottom:12px;box-sizing:border-box;';
    dialog.appendChild(noteInput);

    /* Priority */
    var priLabel2 = document.createElement('div');
    priLabel2.style.cssText = SECTION_TITLE_CSS;
    priLabel2.textContent = 'Priority';
    dialog.appendChild(priLabel2);

    var priSelect = document.createElement('select');
    priSelect.style.cssText = typeSelect.style.cssText;
    var priOpts = [['1', 'Low'], ['2', 'Medium'], ['3', 'High']];
    for (var p = 0; p < priOpts.length; p++) {
      var pOpt = document.createElement('option');
      pOpt.value = priOpts[p][0];
      pOpt.textContent = priOpts[p][1];
      if (parseInt(priOpts[p][0], 10) === conn.priority) pOpt.selected = true;
      priSelect.appendChild(pOpt);
    }
    dialog.appendChild(priSelect);

    /* Buttons */
    var btnRow = document.createElement('div');
    btnRow.style.cssText = 'display:flex;gap:8px;margin-top:16px;';

    var cancelBtn = document.createElement('button');
    cancelBtn.textContent = 'Cancel';
    cancelBtn.style.cssText = 'flex:1;padding:8px;background:var(--color-surface-2);border:1px solid var(--color-border);border-radius:6px;color:var(--color-text);font-family:var(--font-ui);font-size:12px;cursor:pointer;';
    cancelBtn.onclick = function() { overlay.parentNode.removeChild(overlay); };
    btnRow.appendChild(cancelBtn);

    var saveBtn = document.createElement('button');
    saveBtn.textContent = 'Save';
    saveBtn.style.cssText = 'flex:1;padding:8px;background:var(--color-accent);border:none;border-radius:6px;color:#fff;font-family:var(--font-ui);font-size:12px;cursor:pointer;font-weight:600;';
    saveBtn.onclick = function() {
      KanvazConnections.update(conn.id, {
        type:     typeSelect.value,
        note:     noteInput.value,
        priority: parseInt(priSelect.value, 10)
      });
      KanvazHistory.push();
      overlay.parentNode.removeChild(overlay);
      refresh();
      KanvazUI.toast('Connection updated');
    };
    btnRow.appendChild(saveBtn);

    dialog.appendChild(btnRow);
    overlay.appendChild(dialog);

    overlay.onclick = function(e) {
      if (e.target === overlay) overlay.parentNode.removeChild(overlay);
    };

    document.body.appendChild(overlay);
  }

  /* ── Public API ── */

  return {
    open:    open,
    close:   close,
    isOpen:  isOpen,
    refresh: refresh
  };

})();
