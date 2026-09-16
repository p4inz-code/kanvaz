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

  /* Distinct from isOpen() above, and the fix for a real bug confirmed
     live (screenshot: a card visibly selected with handles on canvas,
     Properties tab open, panel still showing "Select a card..."):
     isOpen()'s activeId !== null check only ever becomes true once
     open(refId) has run — but the Properties SECTION can become
     visible without ever going through open(refId) at all, e.g.
     clicking the Properties rail icon directly (sidepanel.js calls
     showSection('properties') straight away, bypassing this module's
     open() entirely), or the side panel restoring "properties" as its
     persisted last-open section on boot. In that state activeId stays
     null forever, so refresh()/refreshPropertiesIfOpen() — both gated
     on isOpen() — silently no-op on every subsequent selection change,
     and the panel never updates until a manual close/reopen (which
     goes through open() and sets activeId for the first time) "fixes"
     it — exactly the reported "I have to refresh it" behavior. This
     asks the real question for refresh purposes — "is the Properties
     section the one currently visible" — with no activeId dependency. */
  function isSectionVisible() {
    return typeof KanvazSidePanel !== 'undefined' && KanvazSidePanel.isSectionOpen('properties');
  }

  /* Bug fix: "when i'm in properties tab and i click any card it shows
     nothing but when i open tab again then it does" + "loop on/off is
     not in sync with the card" — cards.js now calls this (via
     refreshPropertiesIfOpen()) on every selection change and every
     'cardUpdate' plugin event, so this panel never needs a manual
     close/reopen to catch up with either a different card being
     selected or this same card changing under an on-canvas control
     (the loop/mute toggle icons, playback speed picker, tag removal,
     …). renderInto() itself already re-reads the live selection every
     time it runs — this just gives outside code a way to ask it to run
     again. Gates on isSectionVisible(), not isOpen() — see that
     function's own comment for why the activeId-based check silently
     broke this exact refresh path. */
  function refresh() {
    if (panelEl && panelEl.isConnected && isSectionVisible()) renderInto(panelEl);
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
    renderLayerSection(body, card, activeId);
    renderTagsSection(body, card, activeId);
    renderInfoSection(body, card, activeId);
    renderMediaSection(body, card, activeId);
    renderAdjustmentsSection(body, card, activeId);
    renderModel3DSection(body, card, activeId);
    renderPlaybackSection(body, card, activeId);
    renderUrlSection(body, card, activeId);
    renderFileSection(body, card, activeId);
    renderAnnotateSection(body, card, activeId);

    var customHeading = document.createElement('div');
    customHeading.style.cssText = SECTION_TITLE_CSS;
    customHeading.textContent = 'Custom Properties';
    body.appendChild(customHeading);

    /* Bug fix: "what is this add new property [for]?" — the feature had
       no explanation anywhere, just an empty list and a button. One
       line, naming the actual use case (Tags already covers loose
       labels; this is for structured key/value facts specific to this
       card — artist, source, shot number, license, whatever the board
       needs) so it reads as a real tool instead of an unexplained
       key/value form. */
    var customHint = document.createElement('div');
    customHint.style.cssText = 'font-size:11px;color:var(--color-text-3);line-height:1.4;margin-bottom:8px;';
    customHint.textContent = 'Your own key/value facts for this card: artist, source, shot number, license, anything the board needs.';
    body.appendChild(customHint);

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

    /* Direct feedback: "when we hover and drag in Maya, Adobe, Figma
       these values change — apply that to every box containing
       numbers." Drag-to-scrub on the LABEL specifically (not the input
       itself, which still needs to support normal click-to-place-
       cursor/select-and-type editing) — the same split Figma/Maya use.
       Live-updates the real card on every tick (via setTransform's new
       persist:false — see its own comment in cards.js) so the card
       visibly moves/resizes on the canvas as you drag, exactly like
       scrubbing there does, then commits once for real (one undo step)
       on mouseup — same "debounce the history, not the visual" pattern
       nudge() already established for arrow-key movement. Shift held
       while dragging = fine control (0.2 units/px) for precise nudges,
       matching the same modifier's role in every one of those apps. */
    function field(label, key, value, onCommit, disabled) {
      var wrap = document.createElement('div');
      var lbl = document.createElement('div');
      lbl.style.cssText = LABEL_CSS + ';margin-bottom:3px;';
      lbl.textContent = label;
      if (!disabled) lbl.style.cursor = 'ew-resize';
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

      if (disabled) return;

      lbl.addEventListener('mousedown', function(e) {
        if (e.button !== 0) return;
        e.preventDefault();
        var startX = e.clientX;
        var startVal = parseFloat(input.value) || 0;
        var moved = false;

        function onMove(ev) {
          var delta = ev.clientX - startX;
          if (Math.abs(delta) > 1) moved = true;
          var sensitivity = ev.shiftKey ? 0.2 : 1;
          var n = Math.round(startVal + delta * sensitivity);
          input.value = n;
          var patch = {};
          patch[key] = n;
          KanvazCards.setTransform(cardId, patch, false);
        }
        function onUp() {
          document.removeEventListener('mousemove', onMove);
          document.removeEventListener('mouseup', onUp);
          if (moved) {
            var n = parseFloat(input.value);
            if (isFinite(n)) onCommit(n);
          }
        }
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
      });
    }

    var locked = !!card.pinned;
    field('X', 'x', card.x, function(n) { KanvazCards.setTransform(cardId, { x: n }); }, locked);
    field('Y', 'y', card.y, function(n) { KanvazCards.setTransform(cardId, { y: n }); }, locked);
    field('W', 'w', card.w, function(n) { KanvazCards.setTransform(cardId, { w: n }); });
    field('H', 'h', card.h, function(n) { KanvazCards.setTransform(cardId, { h: n }); });

    body.appendChild(grid);
  }

  /* ── Layer & Opacity — Photoshop/Illustrator-style tools ──
     Opacity mirrors showOpacityPicker()'s own popover exactly (live
     update on input, one history push when the user finishes dragging,
     via 'change' rather than every 'input' tick) so behavior stays
     identical whether opacity is changed from here or from the card's
     own right-click menu. Bring to Front / Send to Back call the same
     KanvazCards functions the context menu uses — bringToFront()
     deliberately doesn't push its own history (it also fires on every
     card selection, a hot path), matching existing behavior exactly
     rather than introducing a new history-on-click convention here. */
  function renderLayerSection(body, card, cardId) {
    var title = document.createElement('div');
    title.style.cssText = SECTION_TITLE_CSS;
    title.textContent = 'Layer';
    body.appendChild(title);

    var opacityRow = document.createElement('div');
    opacityRow.style.cssText = 'margin-bottom:10px;';
    var opacityLabelRow = document.createElement('div');
    opacityLabelRow.style.cssText = 'display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;';
    var opacityLabel = document.createElement('span');
    opacityLabel.style.cssText = LABEL_CSS;
    opacityLabel.textContent = 'Opacity';
    var opacityValue = document.createElement('span');
    opacityValue.style.cssText = 'font-family:var(--font-mono);font-size:11px;color:var(--color-text-2);';
    var currentOpacity = card.opacity !== undefined ? card.opacity : 1.0;
    opacityValue.textContent = Math.round(currentOpacity * 100) + '%';
    opacityLabelRow.appendChild(opacityLabel);
    opacityLabelRow.appendChild(opacityValue);
    opacityRow.appendChild(opacityLabelRow);

    var slider = document.createElement('input');
    slider.type = 'range';
    slider.min = 0.1;
    slider.max = 1.0;
    slider.step = 0.05;
    slider.value = currentOpacity;
    slider.style.cssText = 'width:100%;accent-color:var(--color-accent);';
    slider.oninput = function() {
      var val = parseFloat(slider.value);
      card.opacity = val;
      opacityValue.textContent = Math.round(val * 100) + '%';
      var el = document.getElementById(cardId);
      if (el) el.style.opacity = val;
      if (typeof KanvazApp !== 'undefined') KanvazApp.markDirty();
    };
    slider.onchange = function() {
      if (typeof KanvazHistory !== 'undefined') KanvazHistory.push();
    };
    opacityRow.appendChild(slider);
    body.appendChild(opacityRow);

    var layerBtnRow = document.createElement('div');
    layerBtnRow.style.cssText = 'display:flex;gap:6px;margin-bottom:16px;';
    var frontBtn = document.createElement('button');
    frontBtn.textContent = 'Bring to Front';
    frontBtn.style.cssText = 'flex:1;padding:6px;background:var(--color-surface-2);border:1px solid var(--color-border-2);border-radius:5px;color:var(--color-text-2);font-family:var(--font-ui);font-size:11px;cursor:pointer;';
    frontBtn.onclick = function() { if (typeof KanvazCards !== 'undefined') KanvazCards.bringToFront(cardId); };
    var backBtn = document.createElement('button');
    backBtn.textContent = 'Send to Back';
    backBtn.style.cssText = frontBtn.style.cssText;
    backBtn.onclick = function() { if (typeof KanvazCards !== 'undefined') KanvazCards.sendToBack(cardId); };
    layerBtnRow.appendChild(frontBtn);
    layerBtnRow.appendChild(backBtn);
    body.appendChild(layerBtnRow);

    /* Align — only shown when the CURRENT selection is a real multi-
       select (2+ cards), matching Illustrator's own Align panel
       behavior of being inert/hidden for a single object. Acts on the
       whole selection, not just this one card. */
    var selectedIds = (typeof KanvazCards !== 'undefined' && KanvazCards.getSelectedIds) ? KanvazCards.getSelectedIds() : [];
    if (selectedIds.length > 1) {
      var alignTitle = document.createElement('div');
      alignTitle.style.cssText = SECTION_TITLE_CSS;
      alignTitle.textContent = 'Align (' + selectedIds.length + ' selected)';
      body.appendChild(alignTitle);

      var alignGrid = document.createElement('div');
      alignGrid.style.cssText = 'display:grid;grid-template-columns:repeat(3,1fr);gap:6px;margin-bottom:16px;';

      var ALIGN_MODES = [
        ['left', 'Left'], ['center-h', 'Center'], ['right', 'Right'],
        ['top', 'Top'], ['middle-v', 'Middle'], ['bottom', 'Bottom']
      ];
      for (var ai = 0; ai < ALIGN_MODES.length; ai++) {
        (function(mode, label) {
          var btn = document.createElement('button');
          btn.textContent = label;
          btn.style.cssText = 'padding:6px 2px;background:var(--color-surface-2);border:1px solid var(--color-border-2);border-radius:5px;color:var(--color-text-2);font-family:var(--font-ui);font-size:10px;cursor:pointer;';
          btn.onclick = function() {
            if (typeof KanvazCards !== 'undefined') KanvazCards.alignCards(KanvazCards.getSelectedIds(), mode);
          };
          alignGrid.appendChild(btn);
        })(ALIGN_MODES[ai][0], ALIGN_MODES[ai][1]);
      }
      body.appendChild(alignGrid);

      /* Distribute — needs 3+ cards (with exactly 2 there's only one
         gap, nothing to make even), unlike Align which is useful at 2. */
      if (selectedIds.length > 2) {
        var distTitle = document.createElement('div');
        distTitle.style.cssText = SECTION_TITLE_CSS;
        distTitle.textContent = 'Distribute evenly';
        body.appendChild(distTitle);

        var distRow = document.createElement('div');
        distRow.style.cssText = 'display:grid;grid-template-columns:repeat(2,1fr);gap:6px;margin-bottom:16px;';

        var DIST_MODES = [['h', 'Horizontally'], ['v', 'Vertically']];
        for (var di = 0; di < DIST_MODES.length; di++) {
          (function(axis, label) {
            var btn = document.createElement('button');
            btn.textContent = label;
            btn.style.cssText = 'padding:6px 2px;background:var(--color-surface-2);border:1px solid var(--color-border-2);border-radius:5px;color:var(--color-text-2);font-family:var(--font-ui);font-size:10px;cursor:pointer;';
            btn.onclick = function() {
              if (typeof KanvazCards !== 'undefined') KanvazCards.distributeCards(KanvazCards.getSelectedIds(), axis);
            };
            distRow.appendChild(btn);
          })(DIST_MODES[di][0], DIST_MODES[di][1]);
        }
        body.appendChild(distRow);
      }

      /* Tidy up — packs the selection into a grid. Useful at 2+ (unlike
         Distribute, which needs 3+ to mean anything), so it sits with
         Align rather than gated behind the Distribute-only threshold. */
      var tidyBtn = document.createElement('button');
      tidyBtn.textContent = 'Tidy up selection';
      tidyBtn.style.cssText = 'width:100%;padding:6px 2px;background:var(--color-surface-2);border:1px solid var(--color-border-2);border-radius:5px;color:var(--color-text-2);font-family:var(--font-ui);font-size:10px;cursor:pointer;margin-bottom:16px;';
      tidyBtn.onclick = function() {
        if (typeof KanvazCards !== 'undefined') KanvazCards.tidyUp(KanvazCards.getSelectedIds());
      };
      body.appendChild(tidyBtn);
    }
  }

  /* ── Tags ── Originally added alongside the small on-card tag bar
     (easy to miss and cramped on a small card), even though tags are
     one of the three things search actually matches against (name/
     type/tag — see app.js's applySearchFilter). v8.9.0, direct
     request: tag editing lives here ONLY now — cards.js's own in-card
     tag bar (buildTagBar/showTagInput) was removed entirely, this
     section is the sole place tags get added, removed, or viewed.
     Goes through KanvazCards.setTags() (a full-array replace with its
     own dirty/history/event handling) rather than splicing card.tags
     directly, so this never has to duplicate that bookkeeping — and
     since this panel re-renders itself after every call, it always
     reflects the true tag list with no separate sync step needed. */
  function renderTagsSection(body, card, cardId) {
    var title = document.createElement('div');
    title.style.cssText = SECTION_TITLE_CSS;
    title.textContent = 'Tags';
    body.appendChild(title);

    var wrap = document.createElement('div');
    wrap.style.cssText = 'display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin-bottom:16px;';

    var tags = card.tags || [];
    for (var i = 0; i < tags.length; i++) {
      (function(tag) {
        var chip = document.createElement('span');
        chip.style.cssText = 'display:flex;align-items:center;gap:4px;padding:3px 8px;background:var(--color-surface-2);border:1px solid var(--color-border-2);border-radius:999px;font-size:11px;color:var(--color-text-2);';
        var label = document.createElement('span');
        label.textContent = tag;
        chip.appendChild(label);
        var rm = document.createElement('span');
        rm.textContent = '×';
        rm.title = 'Remove tag';
        rm.style.cssText = 'cursor:pointer;color:var(--color-text-3);line-height:1;';
        rm.onclick = function() {
          var next = (card.tags || []).filter(function(t) { return t !== tag; });
          if (typeof KanvazCards !== 'undefined') KanvazCards.setTags(cardId, next);
          if (panelEl) renderInto(panelEl);
        };
        chip.appendChild(rm);
        wrap.appendChild(chip);
      })(tags[i]);
    }

    var addInput = document.createElement('input');
    addInput.type = 'text';
    addInput.placeholder = '+ tag';
    addInput.style.cssText = 'width:60px;padding:3px 8px;background:transparent;border:1px dashed var(--color-border-2);border-radius:999px;color:var(--color-text);font-family:var(--font-ui);font-size:11px;outline:none;';

    /* Direct feedback: "remove the tag stuff [from cards], keep it in
       Properties only" — the in-card tag bar's own input had a real
       autocomplete dropdown (recent + board-wide tags, filtered as you
       type); this is the equivalent for the one remaining tag editor,
       via a native <datalist> instead of rebuilding that floating
       dropdown's own positioning logic here. A datalist gets the
       browser's own suggestion UI for free and behaves correctly
       inside this panel's own scroll container with zero custom
       layout code — recent tags first (most likely to be reused right
       now), then every other tag already used anywhere on the board. */
    if (typeof KanvazCards !== 'undefined' && KanvazCards.getAllTags) {
      var existingTags = card.tags || [];
      var recent = KanvazCards.getRecentTags ? KanvazCards.getRecentTags() : [];
      var all = KanvazCards.getAllTags();
      var seen = {};
      var suggestions = [];
      var candidates = recent.concat(all);
      for (var si = 0; si < candidates.length; si++) {
        var t = candidates[si];
        if (!seen[t] && existingTags.indexOf(t) === -1) { seen[t] = true; suggestions.push(t); }
      }
      if (suggestions.length) {
        var listId = 'tag-suggestions-' + cardId;
        var datalist = document.createElement('datalist');
        datalist.id = listId;
        for (var oi = 0; oi < suggestions.length; oi++) {
          var opt = document.createElement('option');
          opt.value = suggestions[oi];
          datalist.appendChild(opt);
        }
        addInput.setAttribute('list', listId);
        wrap.appendChild(datalist);
      }
    }

    function commitTag() {
      var val = addInput.value.trim().toLowerCase();
      if (!val) return;
      if ((card.tags || []).indexOf(val) !== -1) { addInput.value = ''; return; }
      if (typeof KanvazCards !== 'undefined') KanvazCards.setTags(cardId, (card.tags || []).concat([val]));
      if (panelEl) renderInto(panelEl);
    }
    addInput.addEventListener('keydown', function(e) {
      if (e.key === 'Enter') commitTag();
    });
    /* A datalist option click fires 'change' on the input (not
       'keydown'), so picking a suggestion with the mouse needs its own
       commit path — without this, clicking a suggestion filled the
       input but never actually added the tag until Enter was also
       pressed. */
    addInput.addEventListener('change', commitTag);
    wrap.appendChild(addInput);
    body.appendChild(wrap);
  }

  /* ── Info ── Read-only card identity — mainly useful alongside
     Settings' "Show card/connection IDs" overlay and for anyone
     scripting the MCP Bridge tools (which address cards by this exact
     id), so it's copyable rather than just displayed. */
  function renderInfoSection(body, card, cardId) {
    var title = document.createElement('div');
    title.style.cssText = SECTION_TITLE_CSS;
    title.textContent = 'Info';
    body.appendChild(title);

    var row = document.createElement('div');
    row.style.cssText = 'display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:16px;font-size:11px;color:var(--color-text-3);';

    var idText = document.createElement('span');
    idText.style.cssText = 'font-family:var(--font-mono);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
    idText.textContent = 'ID: ' + cardId;
    idText.title = cardId;
    row.appendChild(idText);

    var copyBtn = document.createElement('button');
    copyBtn.textContent = 'Copy';
    copyBtn.style.cssText = 'flex-shrink:0;padding:2px 8px;background:none;border:1px solid var(--color-border-2);border-radius:5px;color:var(--color-text-2);font-family:var(--font-ui);font-size:10px;cursor:pointer;';
    copyBtn.onclick = function() {
      if (!navigator.clipboard) return;
      navigator.clipboard.writeText(cardId).then(function() {
        if (typeof KanvazUI !== 'undefined') KanvazUI.toast('Copied card ID', 'success');
      });
    };
    row.appendChild(copyBtn);
    body.appendChild(row);
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
    var hasModelFormat = card.type === 'model3d' && card.modelFormat;

    if (!hasResolution && !hasModelFormat) return;

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
  }

  /* ── Adjustments — non-destructive brightness/contrast/saturation via
     CSS filter() (cards.js's setAdjustment/getFilterCss), never touching
     the card's own dataUrl. Image/GIF/video only — a filter on a note or
     color swatch has no visual meaning. Live update on drag (matching
     Opacity's own convention above), one history push per completed
     drag rather than one per tick. */
  function renderAdjustmentsSection(body, card, cardId) {
    if (card.type !== 'image' && card.type !== 'gif' && card.type !== 'video') return;

    var title = document.createElement('div');
    title.style.cssText = SECTION_TITLE_CSS;
    title.textContent = 'Adjustments';
    body.appendChild(title);

    var ADJUSTMENTS = [
      ['adjustBrightness', 'Brightness'],
      ['adjustContrast', 'Contrast'],
      ['adjustSaturate', 'Saturation']
    ];

    for (var i = 0; i < ADJUSTMENTS.length; i++) {
      (function(key, label) {
        var row = document.createElement('div');
        row.style.cssText = 'margin-bottom:10px;';

        var labelRow = document.createElement('div');
        labelRow.style.cssText = 'display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;';
        var labelEl = document.createElement('span');
        labelEl.style.cssText = LABEL_CSS;
        labelEl.textContent = label;
        var valueEl = document.createElement('span');
        valueEl.style.cssText = 'font-family:var(--font-mono);font-size:11px;color:var(--color-text-2);';
        var current = (card[key] != null) ? card[key] : 100;
        valueEl.textContent = current + '%';
        labelRow.appendChild(labelEl);
        labelRow.appendChild(valueEl);
        row.appendChild(labelRow);

        var slider = document.createElement('input');
        slider.type = 'range';
        slider.min = 0;
        slider.max = 200;
        slider.step = 1;
        slider.value = current;
        slider.style.cssText = 'width:100%;accent-color:var(--color-accent);';
        slider.oninput = function() {
          var val = parseInt(slider.value, 10);
          valueEl.textContent = val + '%';
          if (typeof KanvazCards !== 'undefined') KanvazCards.setAdjustment(cardId, key, val);
        };
        slider.onchange = function() {
          if (typeof KanvazHistory !== 'undefined') KanvazHistory.push();
        };
        row.appendChild(slider);
        body.appendChild(row);
      })(ADJUSTMENTS[i][0], ADJUSTMENTS[i][1]);
    }

    var resetBtn = document.createElement('button');
    resetBtn.textContent = 'Reset adjustments';
    resetBtn.style.cssText = 'width:100%;padding:6px 2px;background:var(--color-surface-2);border:1px solid var(--color-border-2);border-radius:5px;color:var(--color-text-2);font-family:var(--font-ui);font-size:10px;cursor:pointer;margin-bottom:16px;';
    resetBtn.onclick = function() {
      if (typeof KanvazCards === 'undefined') return;
      KanvazCards.setAdjustment(cardId, 'adjustBrightness', 100);
      KanvazCards.setAdjustment(cardId, 'adjustContrast', 100);
      KanvazCards.setAdjustment(cardId, 'adjustSaturate', 100);
      if (typeof KanvazHistory !== 'undefined') KanvazHistory.push();
      if (typeof renderInto === 'function' && panelEl) renderInto(panelEl);
    };
    body.appendChild(resetBtn);
  }

  /* ── 3D model — mirrors the card's own on-canvas toolbar (shading
     mode, background, reset view) via KanvazCards.getModel3DControls(),
     the same live render-mode/background state the toolbar itself
     drives, not a second copy of it. Only shows once the model has
     actually finished loading (getModel3DControls returns null before
     then) — the section just doesn't render meanwhile rather than
     showing controls that would silently no-op. */
  function renderModel3DSection(body, card, cardId) {
    if (card.type !== 'model3d') return;
    var controls = (typeof KanvazCards !== 'undefined') ? KanvazCards.getModel3DControls(cardId) : null;
    if (!controls) return;

    var title = document.createElement('div');
    title.style.cssText = SECTION_TITLE_CSS;
    title.textContent = '3D View';
    body.appendChild(title);

    var modeRow = document.createElement('div');
    modeRow.style.cssText = 'display:flex;gap:6px;margin-bottom:10px;';
    var modes = [['normal', 'Normal'], ['wireframe', 'Wireframe'], ['matcap', 'Matcap']];
    for (var i = 0; i < modes.length; i++) {
      (function(modeKey, modeLabel) {
        var isOn = (card.renderMode || 'normal') === modeKey;
        var btn = document.createElement('button');
        btn.textContent = modeLabel;
        btn.style.cssText = 'flex:1;padding:5px 4px;background:' + (isOn ? 'var(--color-accent-bg)' : 'var(--color-surface-2)') + ';border:1px solid ' + (isOn ? 'var(--color-accent)' : 'var(--color-border-2)') + ';border-radius:5px;color:' + (isOn ? 'var(--color-accent)' : 'var(--color-text-2)') + ';font-family:var(--font-ui);font-size:11px;cursor:pointer;';
        btn.onclick = function() {
          controls.setRenderMode(modeKey);
          if (panelEl) renderInto(panelEl);
        };
        modeRow.appendChild(btn);
      })(modes[i][0], modes[i][1]);
    }
    body.appendChild(modeRow);

    var bgRow = document.createElement('div');
    bgRow.style.cssText = 'display:flex;align-items:center;gap:8px;margin-bottom:10px;';
    var bgLabel = document.createElement('div');
    bgLabel.style.cssText = LABEL_CSS;
    bgLabel.textContent = 'Background';
    var bgSwatchEl = document.createElement('button');
    /* Bug bounty fix: "the... color picker... [is] so small" — 20x20
       was a hard target to click precisely and barely readable as a
       color preview. */
    bgSwatchEl.style.cssText = 'width:28px;height:28px;border-radius:6px;border:1px solid var(--color-border-2);background:' + (card.bgColor || '#1c1c22') + ';cursor:pointer;padding:0;';
    bgSwatchEl.onclick = function() {
      var rect = bgSwatchEl.getBoundingClientRect();
      KanvazColorPicker.open(rect.right + 8, rect.top, card.bgColor || '#1c1c22', {
        onChange: function(hex) { controls.previewBgColor(hex); bgSwatchEl.style.background = hex; },
        onCommit: function(hex) { controls.setBgColor(hex); if (panelEl) renderInto(panelEl); }
      });
    };
    bgRow.appendChild(bgLabel);
    bgRow.appendChild(bgSwatchEl);
    body.appendChild(bgRow);

    var resetBtn = document.createElement('button');
    resetBtn.textContent = 'Reset Camera';
    resetBtn.style.cssText = 'width:100%;padding:6px;background:none;border:1px solid var(--color-border-2);border-radius:5px;color:var(--color-text-2);font-family:var(--font-ui);font-size:12px;cursor:pointer;margin-bottom:16px;';
    resetBtn.onclick = function() { controls.resetCamera(); };
    body.appendChild(resetBtn);
  }

  /* ── Playback (video/audio) — volume, speed, loop surfaced here too,
     not just on the card's own hover-only controls, which are easy to
     miss or hard to hit precisely on a small card. */
  function renderPlaybackSection(body, card, cardId) {
    if (card.type !== 'video' && card.type !== 'audio') return;

    var title = document.createElement('div');
    title.style.cssText = SECTION_TITLE_CSS;
    title.textContent = 'Playback';
    body.appendChild(title);

    function getMediaEl() {
      var el = document.getElementById(cardId);
      return el ? el.querySelector(card.type === 'video' ? 'video' : 'audio') : null;
    }

    var volRow = document.createElement('div');
    volRow.style.cssText = 'display:flex;align-items:center;gap:8px;margin-bottom:10px;';
    var volLabel = document.createElement('div');
    volLabel.style.cssText = LABEL_CSS + 'flex-shrink:0;width:44px;';
    volLabel.textContent = 'Volume';
    var volInput = document.createElement('input');
    volInput.type = 'range';
    volInput.min = '0';
    volInput.max = '1';
    volInput.step = '0.05';
    volInput.value = (card.volume !== undefined && card.volume !== null) ? card.volume : 1;
    volInput.style.cssText = 'flex:1;';
    volInput.addEventListener('input', function() {
      card.volume = parseFloat(volInput.value);
      var mediaEl = getMediaEl();
      if (mediaEl) mediaEl.volume = card.volume;
      KanvazApp.markDirty();
    });
    volInput.addEventListener('change', function() { KanvazHistory.push(); });
    volInput.addEventListener('mousedown', function(e) { e.stopPropagation(); });
    volRow.appendChild(volLabel);
    volRow.appendChild(volInput);
    body.appendChild(volRow);

    if (card.type === 'video') {
      var speedRow = document.createElement('div');
      speedRow.style.cssText = 'display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;';
      var speedLabel = document.createElement('div');
      speedLabel.style.cssText = 'font-size:12px;color:var(--color-text-2);';
      speedLabel.textContent = 'Speed: ' + (card.playbackRate || 1) + '×';
      var speedBtn = document.createElement('button');
      speedBtn.textContent = 'Change';
      speedBtn.style.cssText = 'padding:4px 10px;background:none;border:1px solid var(--color-border-2);border-radius:5px;color:var(--color-text-2);font-family:var(--font-ui);font-size:11px;cursor:pointer;';
      speedBtn.onclick = function() {
        var rect = speedBtn.getBoundingClientRect();
        KanvazCards.showSpeedPicker(cardId, rect.left, rect.bottom + 4);
      };
      speedRow.appendChild(speedLabel);
      speedRow.appendChild(speedBtn);
      body.appendChild(speedRow);
    }

    if (card.type === 'audio') {
      var loopRow = document.createElement('div');
      loopRow.style.cssText = 'display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;';
      var loopLabel = document.createElement('div');
      loopLabel.style.cssText = 'font-size:12px;color:var(--color-text-2);';
      loopLabel.textContent = 'Loop';
      var loopBtn = document.createElement('button');
      var isLoop = !!card.audioLoop;
      loopBtn.textContent = isLoop ? 'On' : 'Off';
      loopBtn.style.cssText = 'padding:4px 10px;background:' + (isLoop ? 'var(--color-accent-bg)' : 'none') + ';border:1px solid ' + (isLoop ? 'var(--color-accent)' : 'var(--color-border-2)') + ';border-radius:5px;color:' + (isLoop ? 'var(--color-accent)' : 'var(--color-text-2)') + ';font-family:var(--font-ui);font-size:11px;cursor:pointer;';
      loopBtn.onclick = function() {
        card.audioLoop = !card.audioLoop;
        var mediaEl = getMediaEl();
        if (mediaEl) mediaEl.loop = card.audioLoop;
        KanvazApp.markDirty();
        KanvazHistory.push();
        if (panelEl) renderInto(panelEl);
      };
      loopRow.appendChild(loopLabel);
      loopRow.appendChild(loopBtn);
      body.appendChild(loopRow);
    }
  }

  /* ── URL card — mirrors the card's own inline controls, useful when
     the card itself is too small on the canvas to comfortably read or
     click. Edits the exact same card.url field, not a separate copy. */
  function renderUrlSection(body, card, cardId) {
    if (card.type !== 'url') return;

    var title = document.createElement('div');
    title.style.cssText = SECTION_TITLE_CSS;
    title.textContent = 'Link';
    body.appendChild(title);

    var input = document.createElement('input');
    input.type = 'text';
    input.value = card.url || '';
    input.placeholder = 'https://…';
    input.spellcheck = false;
    input.style.cssText = INPUT_CSS + ';margin-bottom:8px;';
    input.addEventListener('input', function() {
      card.url = input.value;
      KanvazApp.markDirty();
      var el = document.getElementById(cardId);
      var urlInput = el && el.querySelector('.url-input');
      if (urlInput && urlInput !== input) urlInput.value = input.value;
      var barName = el && el.querySelector('.card-bar-title');
      if (barName) {
        var v = (card.url || '').trim();
        barName.textContent = v ? (v.length > 28 ? v.slice(0, 28) + '…' : v) : (card.name || 'URL reference');
      }
    });
    input.addEventListener('blur', function() { KanvazHistory.push(); });
    body.appendChild(input);

    var btnRow = document.createElement('div');
    btnRow.style.cssText = 'display:flex;gap:8px;margin-bottom:16px;';

    var openBtn = document.createElement('button');
    openBtn.textContent = 'Open';
    openBtn.style.cssText = 'padding:4px 10px;background:none;border:1px solid var(--color-border-2);border-radius:5px;color:var(--color-text-2);font-family:var(--font-ui);font-size:11px;cursor:pointer;';
    openBtn.onclick = function() {
      var raw = (card.url || '').trim();
      if (!raw) return;
      var target = /^https?:\/\//i.test(raw) ? raw : 'https://' + raw;
      KanvazBridge.openExternal(target);
    };
    btnRow.appendChild(openBtn);

    var copyBtn = document.createElement('button');
    copyBtn.textContent = 'Copy';
    copyBtn.style.cssText = openBtn.style.cssText;
    copyBtn.onclick = function() {
      var raw = (card.url || '').trim();
      if (!raw || !navigator.clipboard) return;
      navigator.clipboard.writeText(raw).then(function() {
        if (typeof KanvazUI !== 'undefined') KanvazUI.toast('Copied link', 'success');
      });
    };
    btnRow.appendChild(copyBtn);
    body.appendChild(btnRow);
  }

  /* ── File-reference card — resolved path, quick actions. "Change
     file" (re-pointing to a different path) stays on the card itself
     — that flow also rebuilds the PDF/image preview in place, real
     enough logic that duplicating it here isn't worth the risk of the
     two copies drifting apart. */
  function renderFileSection(body, card, cardId) {
    if (card.type !== 'file') return;

    var title = document.createElement('div');
    title.style.cssText = SECTION_TITLE_CSS;
    title.textContent = 'File';
    body.appendChild(title);

    var pathRow = document.createElement('div');
    pathRow.style.cssText = 'font-size:11px;color:var(--color-text-2);word-break:break-all;margin-bottom:10px;line-height:1.5;';
    pathRow.textContent = card.path || '(no file)';
    body.appendChild(pathRow);

    var btnRow = document.createElement('div');
    btnRow.style.cssText = 'display:flex;gap:8px;flex-wrap:wrap;margin-bottom:16px;';

    var openBtn = document.createElement('button');
    openBtn.textContent = 'Open';
    openBtn.style.cssText = 'padding:4px 10px;background:none;border:1px solid var(--color-border-2);border-radius:5px;color:var(--color-text-2);font-family:var(--font-ui);font-size:11px;cursor:pointer;';
    openBtn.onclick = function() {
      if (!card.path) return;
      KanvazBridge.openPath(card.path).then(function(err) {
        if (err && typeof KanvazUI !== 'undefined') KanvazUI.toast(err, 'error');
      });
    };
    btnRow.appendChild(openBtn);

    var revealBtn = document.createElement('button');
    revealBtn.textContent = 'Reveal in folder';
    revealBtn.style.cssText = openBtn.style.cssText;
    revealBtn.onclick = function() {
      if (!card.path) return;
      KanvazBridge.revealInFolder(card.path);
    };
    btnRow.appendChild(revealBtn);

    var copyBtn = document.createElement('button');
    copyBtn.textContent = 'Copy path';
    copyBtn.style.cssText = openBtn.style.cssText;
    copyBtn.onclick = function() {
      if (!card.path || !navigator.clipboard) return;
      navigator.clipboard.writeText(card.path).then(function() {
        if (typeof KanvazUI !== 'undefined') KanvazUI.toast('Copied path', 'success');
      });
    };
    btnRow.appendChild(copyBtn);

    body.appendChild(btnRow);
  }

  /* ── Annotate — draw straight from the panel, no right-click needed.
     Direct feedback: "add annotation tools to properties panel asw so
     so user can do it from there too." Tool/color buttons are built
     from the exact same TOOLS/COLORS lists and mutate the exact same
     shared state the floating on-card toolbar uses (via
     KanvazAnnotate.setActiveTool/setActiveColor) — this is a second
     set of controls for the same state, not a second independent
     annotation mode that could drift out of sync with what's actually
     drawing strokes on the card. */
  var NOT_ANNOTATABLE_TYPES = { note: 1, audio: 1, color: 1, url: 1, file: 1, text: 1 };

  function renderAnnotateSection(body, card, cardId) {
    if (NOT_ANNOTATABLE_TYPES[card.type]) return;
    if (typeof KanvazAnnotate === 'undefined') return;

    var title = document.createElement('div');
    title.style.cssText = SECTION_TITLE_CSS;
    title.textContent = 'Annotate';
    body.appendChild(title);

    var isActive = KanvazAnnotate.getActiveCardId() === cardId;

    if (!isActive) {
      var startBtn = document.createElement('button');
      startBtn.textContent = 'Start Annotating';
      startBtn.style.cssText = [
        'width:100%', 'padding:8px', 'background:var(--color-surface-2)',
        'border:1px solid var(--color-border-2)', 'border-radius:6px',
        'color:var(--color-text)', 'font-family:var(--font-ui)', 'font-size:12px',
        'cursor:pointer', 'margin-bottom:16px'
      ].join(';');
      startBtn.onclick = function() {
        KanvazAnnotate.activate(cardId);
        if (panelEl) renderInto(panelEl);
      };
      body.appendChild(startBtn);
      return;
    }

    var toolRow = document.createElement('div');
    toolRow.style.cssText = 'display:flex;flex-wrap:wrap;gap:4px;margin-bottom:8px;';
    var tools = KanvazAnnotate.getTools();
    var activeTool = KanvazAnnotate.getActiveTool();
    for (var i = 0; i < tools.length; i++) {
      (function(tool) {
        var isOn = activeTool === tool.id;
        var btn = document.createElement('button');
        btn.title = tool.title;
        btn.innerHTML = tool.icon;
        btn.style.cssText = 'background:' + (isOn ? 'var(--color-accent-bg)' : 'var(--color-surface-2)') + ';border:1px solid ' + (isOn ? 'var(--color-accent)' : 'var(--color-border-2)') + ';border-radius:4px;cursor:pointer;color:var(--color-text);padding:5px 7px;display:flex;align-items:center;justify-content:center;';
        btn.onclick = function() {
          KanvazAnnotate.setActiveTool(tool.id);
          if (panelEl) renderInto(panelEl);
        };
        toolRow.appendChild(btn);
      })(tools[i]);
    }
    body.appendChild(toolRow);

    var colorRow = document.createElement('div');
    colorRow.style.cssText = 'display:flex;gap:6px;margin-bottom:12px;';
    var colors = KanvazAnnotate.getColors();
    var activeColor = KanvazAnnotate.getActiveColor();
    for (var j = 0; j < colors.length; j++) {
      (function(color) {
        var sw = document.createElement('button');
        sw.style.cssText = 'width:16px;height:16px;border-radius:50%;background:' + color + ';border:2px solid ' + (activeColor === color ? 'var(--color-text)' : 'transparent') + ';cursor:pointer;padding:0;';
        sw.onclick = function() {
          KanvazAnnotate.setActiveColor(color);
          if (panelEl) renderInto(panelEl);
        };
        colorRow.appendChild(sw);
      })(colors[j]);
    }
    body.appendChild(colorRow);

    var actionsRow = document.createElement('div');
    actionsRow.style.cssText = 'display:flex;gap:8px;align-items:center;margin-bottom:16px;';

    if (card.annotations && card.annotations.length) {
      var annLabel = document.createElement('div');
      annLabel.style.cssText = 'font-size:12px;color:var(--color-text-2);flex:1;';
      annLabel.textContent = card.annotations.length + ' annotation' + (card.annotations.length === 1 ? '' : 's');
      actionsRow.appendChild(annLabel);

      var clearBtn = document.createElement('button');
      clearBtn.textContent = 'Clear';
      clearBtn.style.cssText = 'padding:4px 10px;background:none;border:1px solid var(--color-border-2);border-radius:5px;color:var(--color-text-2);font-family:var(--font-ui);font-size:11px;cursor:pointer;';
      clearBtn.onclick = function() {
        KanvazAnnotate.clearAnnotations(cardId);
        if (panelEl) renderInto(panelEl);
      };
      actionsRow.appendChild(clearBtn);
    }

    var stopBtn = document.createElement('button');
    stopBtn.textContent = 'Stop Annotating';
    stopBtn.style.cssText = 'padding:4px 10px;background:none;border:1px solid var(--color-border-2);border-radius:5px;color:var(--color-text-2);font-family:var(--font-ui);font-size:11px;cursor:pointer;margin-left:auto;';
    stopBtn.onclick = function() {
      KanvazAnnotate.deactivate();
      if (panelEl) renderInto(panelEl);
    };
    actionsRow.appendChild(stopBtn);

    body.appendChild(actionsRow);
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
    isOpen:            isOpen,
    isSectionVisible:  isSectionVisible,
    refresh:    refresh,
    renderInto: renderInto
  };

})();
