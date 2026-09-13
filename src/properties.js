/* properties.js — Properties panel for key-value metadata editing (v3.8)
 *
 * Shows the selected card's custom key-value properties, editable
 * in place. Press E with a card selected to toggle it.
 *
 * v7.x redesign: renders into the left side panel's content pane
 * (see sidepanel.js) instead of building its own floating fixed-
 * position panel — open()/close() now delegate to
 * KanvazSidePanel.toggle('properties')/close() so this is just one
 * more section in the unified panel rather than a competing overlay.
 */

var KanvazProperties = (function() {

  var panelEl  = null;
  var activeId = null;

  /* ── Styles ── */

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

  /* Same "reads as an actual heading" treatment ui.js's Settings section
     headers got — bold, full-brightness text with a bottom border,
     not muted uppercase label text easy to mistake for a caption. */
  var SECTION_TITLE_CSS = 'font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:0.4px;color:var(--color-text);margin:0 0 8px;padding-bottom:5px;border-bottom:1px solid var(--color-border);';

  /* ── Panel open/close ── */

  /* open(refId) — toggles the side panel to the Properties section for
     this card. Delegates to KanvazSidePanel entirely; this module no
     longer owns any floating panel or DOM attachment itself. */
  function open(refId) {
    if (typeof KanvazSidePanel === 'undefined') return;
    if (activeId === refId && KanvazSidePanel.isSectionOpen('properties')) {
      close();
      return;
    }
    activeId = refId;
    KanvazSidePanel.showSection('properties');
  }

  function close() {
    activeId = null;
    if (typeof KanvazSidePanel !== 'undefined' && KanvazSidePanel.isSectionOpen('properties')) {
      KanvazSidePanel.close();
    }
  }

  /* isOpen() keeps its historical meaning ("is a specific card's
     Properties currently showing"), used by app.js's closeAll() to
     decide whether to close it along with every other overlay. */
  function isOpen() {
    return activeId !== null && typeof KanvazSidePanel !== 'undefined' && KanvazSidePanel.isSectionOpen('properties');
  }

  /* ── Render into the side panel's content pane ──
     Called by sidepanel.js whenever the Properties section becomes the
     active one — either via open(refId) above (a specific card) or by
     the user clicking the Properties rail icon directly.

     Self-review fix: this used to only fall back to the live selection
     when activeId was still null, then STICK to whatever it found
     forever after — every real entry point (the E shortcut, the command
     palette, and the right-click context menu, which calls selectCard()
     before opening) always targets the currently selected card anyway,
     so once activeId was set once, selecting a DIFFERENT card and
     reopening Properties via the rail icon kept showing the first
     card's properties instead of the new selection. A real properties/
     inspector panel (Photoshop, Illustrator) always reflects whatever
     is currently selected — there's no "pin to a specific object"
     concept — so this now re-syncs to the live selection on every
     render instead of latching once. */
  function renderInto(container) {
    container.innerHTML = '';
    panelEl = container;

    var liveSelection = (typeof KanvazCards !== 'undefined') ? KanvazCards.getSelected() : null;
    if (liveSelection) activeId = liveSelection;

    var allCards = (typeof KanvazCards !== 'undefined') ? KanvazCards.getAll() : {};
    var card = activeId ? allCards[activeId] : null;

    if (!card) {
      var empty = document.createElement('div');
      empty.style.cssText = 'padding:24px 16px;text-align:center;color:var(--color-text-3);font-size:12px;line-height:1.5;';
      empty.textContent = 'Select a card to see its properties.';
      container.appendChild(empty);
      return;
    }

    if (!card.properties) card.properties = {};

    /* Stop keyboard shortcuts (Delete, P, etc.) from leaking through to
       the global card-shortcuts dispatcher while focus/interaction is
       anywhere inside this section — not just its inputs (shortcuts.js
       already skips text inputs on its own; this also covers this
       section's buttons and other non-input elements). Only swallows
       plain, unmodified keys — Ctrl/Cmd-modified shortcuts (Save, Open,
       ...) still reach the global handler regardless of focus here.
       Self-review fix: `container` is the persistent #side-panel-content
       element, re-used across every render (only its CHILDREN get wiped
       by innerHTML='' above) — attaching this listener unconditionally
       on every renderInto() call stacked a new one each time the
       Properties section was switched to, never removed, each retaining
       its own closure. Guard with a one-time marker so this attaches
       exactly once per container, ever. */
    if (!container.dataset.propertiesKeydownBound) {
      container.dataset.propertiesKeydownBound = '1';
      container.addEventListener('keydown', function(e) {
        if (!e.ctrlKey && !e.metaKey) {
          e.stopPropagation();
        }
      });
    }

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
    container.appendChild(header);

    /* ── Body ── */
    var body = document.createElement('div');
    body.id = 'properties-body';
    body.style.cssText = BODY_CSS;

    renderTransformSection(body, card, activeId);
    renderMediaSection(body, card, activeId);

    var customHeading = document.createElement('div');
    customHeading.style.cssText = SECTION_TITLE_CSS;
    customHeading.textContent = 'Custom Properties';
    body.appendChild(customHeading);

    /* Custom key-value properties get their OWN sub-container rather
       than rendering straight into `body` — renderProperties() below
       does `.innerHTML = ''` on whatever it's given every time a
       property is added/edited/removed, and body now also holds the
       Transform/Media sections above; clearing the whole body on every
       edit would wipe those out from under the user mid-session. */
    var propsListEl = document.createElement('div');
    propsListEl.id = 'properties-custom-list';
    body.appendChild(propsListEl);

    renderProperties(propsListEl, card);
    container.appendChild(body);

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
    container.appendChild(footer);
  }

  /* ── Transform (X / Y / W / H) — Photoshop/Illustrator-style
     properties bar. Pinned cards can't be moved by dragging (see
     nudge()'s own pinned guard in cards.js), so their X/Y fields are
     disabled here too rather than silently no-opping the edit. */
  function renderTransformSection(body, card, cardId) {
    var title = document.createElement('div');
    title.style.cssText = SECTION_TITLE_CSS;
    title.textContent = 'Transform';
    body.appendChild(title);

    var grid = document.createElement('div');
    grid.style.cssText = 'display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:16px;';

    function field(label, value, onCommit, disabled) {
      var wrap = document.createElement('div');
      var lbl = document.createElement('div');
      lbl.style.cssText = LABEL_CSS + ';margin-bottom:3px;';
      lbl.textContent = label;
      wrap.appendChild(lbl);

      var input = document.createElement('input');
      input.type = 'number';
      input.value = Math.round(value);
      input.style.cssText = INPUT_CSS;
      input.disabled = !!disabled;
      if (disabled) input.style.opacity = '0.5';
      input.onfocus = function() { input.style.borderColor = INPUT_FOCUS_BORDER; };
      input.onblur = function() {
        input.style.borderColor = 'var(--color-border)';
        var n = parseFloat(input.value);
        if (isFinite(n)) onCommit(n);
      };
      input.addEventListener('keydown', function(e) {
        if (e.key === 'Enter') input.blur();
      });
      wrap.appendChild(input);
      grid.appendChild(wrap);
    }

    var locked = !!card.pinned;
    field('X', card.x, function(n) { KanvazCards.setTransform(cardId, { x: n }); }, locked);
    field('Y', card.y, function(n) { KanvazCards.setTransform(cardId, { y: n }); }, locked);
    field('W', card.w, function(n) { KanvazCards.setTransform(cardId, { w: n }); });
    field('H', card.h, function(n) { KanvazCards.setTransform(cardId, { h: n }); });

    body.appendChild(grid);
  }

  /* ── Media info (read-only resolution/format) + Annotations ──
     Resolution comes straight off card.naturalW/naturalH — already
     stored on the card data model for image/gif/video cards at import
     time (see cards.js's createFromMedia), not re-measured from the
     live DOM here. Nothing renders for card types that don't apply
     (note/text/color/url/file have no natural media dimensions and no
     annotation overlay of their own). */
  function renderMediaSection(body, card, cardId) {
    var hasResolution = (card.type === 'image' || card.type === 'gif' || card.type === 'video') && card.naturalW && card.naturalH;
    var hasAnnotations = card.annotations && card.annotations.length > 0;
    var hasModelFormat = card.type === 'model3d' && card.modelFormat;

    if (!hasResolution && !hasAnnotations && !hasModelFormat) return;

    var title = document.createElement('div');
    title.style.cssText = SECTION_TITLE_CSS;
    title.textContent = 'Media';
    body.appendChild(title);

    var infoRow = document.createElement('div');
    infoRow.style.cssText = 'font-size:12px;color:var(--color-text-2);margin-bottom:8px;line-height:1.6;';

    if (hasResolution) {
      var res = document.createElement('div');
      res.textContent = 'Resolution: ' + card.naturalW + ' × ' + card.naturalH;
      infoRow.appendChild(res);
    }
    if (hasModelFormat) {
      var fmt = document.createElement('div');
      fmt.textContent = 'Format: ' + card.modelFormat.toUpperCase();
      infoRow.appendChild(fmt);
    }
    if (infoRow.childNodes.length) body.appendChild(infoRow);

    if (hasAnnotations) {
      var annRow = document.createElement('div');
      annRow.style.cssText = 'display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;';

      var annLabel = document.createElement('div');
      annLabel.style.cssText = 'font-size:12px;color:var(--color-text-2);';
      annLabel.textContent = card.annotations.length + ' annotation' + (card.annotations.length === 1 ? '' : 's');
      annRow.appendChild(annLabel);

      var clearBtn = document.createElement('button');
      clearBtn.textContent = 'Clear';
      clearBtn.style.cssText = 'padding:4px 10px;background:none;border:1px solid var(--color-border-2);border-radius:5px;color:var(--color-text-2);font-family:var(--font-ui);font-size:11px;cursor:pointer;';
      clearBtn.onclick = function() {
        if (typeof KanvazAnnotate !== 'undefined' && KanvazAnnotate.clearAnnotations) {
          KanvazAnnotate.clearAnnotations(cardId);
        }
      };
      annRow.appendChild(clearBtn);
      body.appendChild(annRow);
    }
  }

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
        delBtn.onmouseenter = function() { delBtn.style.color = 'var(--color-red)'; };
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
    var body = document.getElementById('properties-custom-list');
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
    open:       open,
    close:      close,
    isOpen:     isOpen,
    renderInto: renderInto
  };

})();
