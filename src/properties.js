/* properties.js — Properties panel for key-value metadata editing (v3.8)
 *
 * Opens a side panel for the selected card, showing all custom
 * key-value properties. Users can add, edit, and delete properties.
 * Press E with a card selected to toggle the panel.
 */

var KanvazProperties = (function() {

  var panelEl  = null;
  var activeId = null;

  /* ── Styles ── */

  var PANEL_CSS = [
    'position:fixed',
    'left:12px',
    'top:52px',
    'bottom:12px',
    'width:280px',
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
    'color:var(--color-text)',
    'animation:panel-slide-in 0.15s ease-out'
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

  var ROW_CSS = [
    'padding:6px 8px',
    'background:var(--color-surface-2)',
    'border-radius:6px',
    'margin-bottom:6px',
    'position:relative',
    'display:flex',
    'flex-direction:column',
    'gap:4px'
  ].join(';');

  var INPUT_CSS = [
    'width:100%',
    'padding:4px 6px',
    'border:1px solid var(--color-border)',
    'border-radius:4px',
    'background:var(--color-bg)',
    'color:var(--color-text)',
    'font-family:var(--font-ui)',
    'font-size:12px',
    'outline:none',
    'box-sizing:border-box'
  ].join(';');

  var INPUT_FOCUS_BORDER = 'var(--color-accent)';

  var LABEL_CSS = 'font-size:10px;text-transform:uppercase;letter-spacing:0.06em;color:var(--color-text-3);font-weight:600;';

  /* ── Panel open/close ── */

  function open(refId) {
    if (panelEl && activeId === refId) { close(); return; }
    if (panelEl) close();

    activeId = refId;
    var allCards = KanvazCards.getAll();
    var card = allCards[refId];
    if (!card) return;

    /* Ensure properties object exists */
    if (!card.properties) card.properties = {};

    panelEl = document.createElement('div');
    panelEl.id = 'properties-panel';
    panelEl.style.cssText = PANEL_CSS;

    /* Stop keyboard shortcuts (Delete, P, etc.) from leaking through to
       the global card-shortcuts dispatcher while focus/interaction is
       anywhere inside this panel — not just its inputs (shortcuts.js
       already skips text inputs on its own; this also covers the
       panel's buttons and other non-input elements). Escape and E are
       handled here directly instead of being swallowed, so the panel's
       own documented close shortcuts (see closeBtn's "Close (E)" title)
       keep working no matter where focus is once the panel is open —
       previously they only worked while focus was still outside the
       panel entirely, since stopping propagation blocked them from
       ever reaching the global handler that normally toggles this panel. */
    panelEl.addEventListener('keydown', function(e) {
      if (e.key === 'Escape' || e.key === 'e' || e.key === 'E') {
        e.stopPropagation();
        close();
        return;
      }
      e.stopPropagation();
    });

    /* ── Header ── */
    var header = document.createElement('div');
    header.style.cssText = HEADER_CSS;

    var titleWrap = document.createElement('div');
    titleWrap.style.cssText = 'overflow:hidden;flex:1;';

    var titleRow = document.createElement('div');
    titleRow.style.cssText = 'font-weight:600;font-size:14px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;';
    titleRow.textContent = 'Properties';
    titleWrap.appendChild(titleRow);

    var subtitle = document.createElement('div');
    subtitle.style.cssText = 'font-size:11px;color:var(--color-text-3);margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;';
    subtitle.textContent = card.name || 'Untitled';
    titleWrap.appendChild(subtitle);
    header.appendChild(titleWrap);

    var closeBtn = document.createElement('button');
    closeBtn.textContent = '✕';
    closeBtn.title = 'Close (E)';
    closeBtn.style.cssText = 'background:none;border:none;color:var(--color-text-3);font-size:16px;cursor:pointer;padding:4px 6px;line-height:1;flex-shrink:0;';
    closeBtn.onmouseenter = function() { closeBtn.style.color = 'var(--color-text)'; };
    closeBtn.onmouseleave = function() { closeBtn.style.color = 'var(--color-text-3)'; };
    closeBtn.onclick = close;
    header.appendChild(closeBtn);
    panelEl.appendChild(header);

    /* ── Body ── */
    var body = document.createElement('div');
    body.id = 'properties-body';
    body.style.cssText = BODY_CSS;

    renderProperties(body, card);
    panelEl.appendChild(body);

    /* ── Footer: Add property button ── */
    var footer = document.createElement('div');
    footer.style.cssText = 'padding:10px 16px;border-top:1px solid var(--color-border);flex-shrink:0;';

    var addBtn = document.createElement('button');
    addBtn.textContent = '+ Add property';
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
    addBtn.onmouseenter = function() { addBtn.style.background = 'rgba(157,127,255,0.15)'; };
    addBtn.onmouseleave = function() { addBtn.style.background = 'var(--color-accent-bg)'; };
    addBtn.onclick = function() { addProperty(card); };
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

  function isOpen() { return panelEl !== null; }

  /* ── Render all properties ── */

  function renderProperties(body, card) {
    body.innerHTML = '';

    var keys = Object.keys(card.properties || {});
    if (keys.length === 0) {
      var empty = document.createElement('div');
      empty.style.cssText = 'text-align:center;color:var(--color-text-3);font-size:12px;padding:24px 0;line-height:1.5;';
      empty.textContent = 'No properties yet. Click "+ Add property" to create one.';
      body.appendChild(empty);
      return;
    }

    for (var i = 0; i < keys.length; i++) {
      (function(key) {
        var val = card.properties[key];
        var row = document.createElement('div');
        row.style.cssText = ROW_CSS;

        /* Key label */
        var keyLabel = document.createElement('div');
        keyLabel.style.cssText = 'display:flex;align-items:center;justify-content:space-between;';

        var keyText = document.createElement('span');
        keyText.style.cssText = LABEL_CSS;
        keyText.textContent = key;
        keyLabel.appendChild(keyText);

        /* Delete button */
        var delBtn = document.createElement('span');
        delBtn.textContent = '✕';
        delBtn.title = 'Remove property';
        delBtn.style.cssText = 'cursor:pointer;color:var(--color-text-3);font-size:11px;line-height:1;padding:2px;';
        delBtn.onmouseenter = function() { delBtn.style.color = '#FF6B6B'; };
        delBtn.onmouseleave = function() { delBtn.style.color = 'var(--color-text-3)'; };
        delBtn.onclick = function() {
          delete card.properties[key];
          KanvazApp.markDirty();
          KanvazHistory.push();
          renderProperties(body, card);
        };
        keyLabel.appendChild(delBtn);
        row.appendChild(keyLabel);

        /* Value input */
        var valInput = document.createElement('input');
        valInput.type = 'text';
        valInput.value = val;
        valInput.style.cssText = INPUT_CSS;
        valInput.onfocus = function() { valInput.style.borderColor = INPUT_FOCUS_BORDER; };
        valInput.onblur = function() {
          valInput.style.borderColor = 'var(--color-border)';
          var newVal = valInput.value.trim();
          if (newVal !== card.properties[key]) {
            card.properties[key] = newVal;
            KanvazApp.markDirty();
            KanvazHistory.push();
          }
        };
        valInput.addEventListener('keydown', function(e) {
          if (e.key === 'Enter') valInput.blur();
        });
        row.appendChild(valInput);
        body.appendChild(row);
      })(keys[i]);
    }
  }

  /* ── Add new property ── */

  function addProperty(card) {
    var body = document.getElementById('properties-body');
    if (!body) return;

    /* Check if an add form already exists */
    if (body.querySelector('.prop-add-form')) return;

    var form = document.createElement('div');
    form.className = 'prop-add-form';
    form.style.cssText = ROW_CSS + ';border:1px solid var(--color-accent);';

    var keyLabel = document.createElement('div');
    keyLabel.style.cssText = LABEL_CSS;
    keyLabel.textContent = 'Key';
    form.appendChild(keyLabel);

    var keyInput = document.createElement('input');
    keyInput.type = 'text';
    keyInput.placeholder = 'e.g. artist, source, priority';
    keyInput.style.cssText = INPUT_CSS;
    form.appendChild(keyInput);

    var valLabel = document.createElement('div');
    valLabel.style.cssText = LABEL_CSS + ';margin-top:4px;';
    valLabel.textContent = 'Value';
    form.appendChild(valLabel);

    var valInput = document.createElement('input');
    valInput.type = 'text';
    valInput.placeholder = 'value';
    valInput.style.cssText = INPUT_CSS;
    form.appendChild(valInput);

    /* Buttons row */
    var btnRow = document.createElement('div');
    btnRow.style.cssText = 'display:flex;gap:6px;margin-top:6px;';

    var saveBtn = document.createElement('button');
    saveBtn.textContent = 'Add';
    saveBtn.style.cssText = 'flex:1;padding:5px;background:var(--color-accent);border:none;border-radius:4px;color:#fff;font-family:var(--font-ui);font-size:11px;cursor:pointer;font-weight:600;';
    saveBtn.onclick = function() {
      var k = keyInput.value.trim();
      var v = valInput.value.trim();
      if (!k) { keyInput.focus(); return; }
      if (!card.properties) card.properties = {};
      card.properties[k] = v;
      KanvazApp.markDirty();
      KanvazHistory.push();
      renderProperties(body, card);
    };

    var cancelBtn = document.createElement('button');
    cancelBtn.textContent = 'Cancel';
    cancelBtn.style.cssText = 'flex:1;padding:5px;background:var(--color-surface-2);border:1px solid var(--color-border);border-radius:4px;color:var(--color-text-2);font-family:var(--font-ui);font-size:11px;cursor:pointer;';
    cancelBtn.onclick = function() {
      renderProperties(body, card);
    };

    btnRow.appendChild(saveBtn);
    btnRow.appendChild(cancelBtn);
    form.appendChild(btnRow);

    body.appendChild(form);
    keyInput.focus();

    /* Enter on value input = save */
    valInput.addEventListener('keydown', function(e) {
      if (e.key === 'Enter') saveBtn.click();
    });

    /* Tab from key to value */
    keyInput.addEventListener('keydown', function(e) {
      if (e.key === 'Enter') { valInput.focus(); e.preventDefault(); }
      if (e.key === 'Escape') cancelBtn.click();
    });
  }

  /* ── API ── */

  return {
    open:    open,
    close:   close,
    isOpen:  isOpen
  };

})();
