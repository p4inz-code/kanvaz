/* cards.js — card engine with EVENT DELEGATION
   All mouse interactions (select, drag, resize, video controls, GIF pause,
   right-click menu) are handled by ONE set of listeners bound to `world`
   at init time. Cards are looked up by data-card-id from the live `cards`
   object — never via stale closures over per-element listeners.
   This is the Priority 1 fix from the final audit. */

var KanvazCards = (function() {

  var cards = {};        /* id → card object (single source of truth) */
  var cardCount = 0;
  var selectedId = null;      /* "primary" selection — the one card that
                                  single-target features (Annotate, Connections,
                                  Properties) act on. Always the last id in
                                  multiSelectedIds when more than one is selected. */
  var multiSelectedIds = [];  /* full multi-select set. Kept in sync with the
                                  '.selected' DOM class by every function that
                                  changes selection (selectCard/selectAll/
                                  deselectAll/clearAll/setMultiSelection). Length
                                  0 or 1 in the common case; >1 after Select
                                  All (Ctrl+A), Ctrl/Cmd-clicking two or more
                                  cards by hand (toggleCardInSelection), or
                                  canvas.js's own marquee/rubber-band drag
                                  select (Ctrl+drag or V-toggled drag on empty
                                  canvas — see canvas.js's setMultiSelection
                                  call), which feeds into this exact same
                                  state. */
  var isolateActive = false;  /* Isolate View (Shift+I, Maya's own binding
                                  for the same feature) — true while every
                                  non-selected card is hidden. See
                                  toggleIsolate() below. */
  var world = null;
  var zCounter = 1;
  /* Direct feedback: "Send to Back doesn't work." Real bug, not a
     misreport — sendToBack() used to hard-set card.z = 0 for every
     card, so sending a SECOND card to back never actually put it
     behind a first card already at 0: CSS breaks z-index ties by DOM/
     paint order (later-appended element wins), not by which action
     happened more recently, so the second card stayed visually on top
     of the first despite both having "sent it to back." bringToFront()
     never had this problem since it always assigns a strictly higher
     ++zCounter than anything before it; backCounter is the same idea
     mirrored downward, so each additional Send to Back is guaranteed
     to land strictly behind every card already there, including ones
     sent to back earlier. */
  var backCounter = 0;

  var CARD_MIN_W = 80;
  var CARD_MIN_H = 80;

  /* v5.2.0 — remembered last-used size per card type, so the next new
     card of a type someone just resized starts at that size instead of
     the fixed default every time. Session-scoped only (in-memory), same
     deliberate scope decision as recentTags below — the pain point is a
     single working session spent creating many cards of one type, not
     remembering preferences across app restarts. Media types (image/
     video/gif/audio) are deliberately excluded: their initial size is
     already driven by the actual file's own dimensions, not a fixed
     default, so "remembering" one file's size would be wrong for the next. */
  var rememberedSizes = {};

  function sizeFor(type, defaultW, defaultH) {
    var r = rememberedSizes[type];
    return r ? { w: r.w, h: r.h } : { w: defaultW, h: defaultH };
  }

  /* Bug-bounty fix (v5.3.0): rememberedSizes and recentTags (declared
     further down, next to buildTagBar) were both introduced as module-
     level state with no reset path — clearAll()/deserialise() run on
     every undo/redo too (see history.js), so resetting them THERE would
     wipe "recently used" mid-editing-session on a plain Ctrl+Z, which is
     wrong in the other direction. This is the dedicated reset for the
     actual board-transition boundary instead: boards.js calls it from
     newBoard() and loadBoardState() (covering switch/open/recovery/
     template-restore — every loadBoardState() call site), never from
     clearAll() itself. Before this fix, resizing a Note on Board A and
     then switching to Board B would have new Notes on B silently inherit
     Board A's size, and B's tag-autocomplete would show A's recent tags
     — a real cross-board leak, not the "session-scoped" (single board)
     behavior the v5.2.0 CHANGELOG entry described. */
  function resetSessionState() {
    rememberedSizes = {};
    recentTags = [];
  }

  /* ── Init ── */

  function init(worldEl) {
    world = worldEl;
    bindDelegatedEvents();
  }

  /* ══════════════════════════════════════════════════════════════
     EVENT DELEGATION — bound ONCE on `world`, never re-attached.
     Cards are recreated on board load/switch but listeners here
     never need to know about individual card elements at bind time.
     ══════════════════════════════════════════════════════════════ */

  function bindDelegatedEvents() {

    /* ── mousedown: resize handles, video controls, select+drag ── */
    world.addEventListener('mousedown', function(e) {
      if (e.button !== 0) return;
      var target = e.target;

      /* Direct feedback: right-click a card for the context menu, then
         left-click any card afterward — the menu stayed on screen while
         the card underneath still selected/dragged, an accessibility
         bug (the menu becomes unreachable/unusable clutter, not just
         cosmetic). Root cause: app.js's own "close context menu on
         outside click" listener sits on `document`, but every branch
         below this point calls e.stopPropagation() before the event
         ever bubbles that far — a plain card click never reached it.
         Closing it directly here, before any of those branches run,
         fixes every one of them at once instead of patching each
         stopPropagation() call site individually. */
      var openMenu = document.getElementById('context-menu');
      if (openMenu && openMenu.className.indexOf('visible') !== -1 && typeof KanvazUI !== 'undefined' && KanvazUI.hideContextMenu) {
        KanvazUI.hideContextMenu();
      }

      /* Direct feedback: "add pan control like alt + drag left mb, take
         reference from maya" — Maya's Alt+drag always means "navigate
         the camera," regardless of what's under the cursor (a resize
         handle, a card, a scrub bar — everything). Bailing out here,
         before any of the specific-target checks below and without
         stopping propagation, lets the event fall through untouched to
         canvas.js's own mousedown handler on the ancestor `container`,
         which is where the actual pan starts (see its matching
         `e.altKey` branch in shouldPan). */
      if (e.altKey) return;

      /* Resize handle */
      if (target.classList.contains('resize-handle')) {
        e.stopPropagation();
        e.preventDefault();
        var rCardEl = target.closest('.card');
        if (!rCardEl) return;
        var rCard = cards[rCardEl.dataset.cardId];
        if (!rCard) return;
        startResize(rCard, rCardEl, target.dataset.handle, e);
        return;
      }

      /* Video play/pause button */
      var playBtn = target.closest('.media-play-btn');
      if (playBtn) {
        e.stopPropagation();
        toggleVideoPlay(playBtn.closest('.card'));
        return;
      }

      /* Video mute button */
      var muteBtn = target.closest('.media-mute-btn');
      if (muteBtn) {
        e.stopPropagation();
        toggleVideoMute(muteBtn.closest('.card'));
        return;
      }

      /* Audio loop toggle */
      var loopBtn = target.closest('.media-loop-btn');
      if (loopBtn) {
        e.stopPropagation();
        toggleAudioLoop(loopBtn.closest('.card'));
        return;
      }

      /* Video scrub track */
      var track = target.closest('.scrub-bar');
      if (track) {
        e.stopPropagation();
        seekVideo(track.closest('.card'), e, track);
        return;
      }

      /* Tag chips — remove/add/input must never trigger a card drag.
         mousedown fires before the chip's own click handler, so without
         this the underlying card would select/drag before the tag
         action ever runs. */
      if (target.closest('.tag-chip-remove') || target.closest('.tag-chip-add') || target.closest('.tag-input') || target.closest('.tag-autocomplete')) {
        e.stopPropagation();
        return;
      }

      /* Card body — select, bring to front, maybe drag */
      var cardEl = target.closest('.card');
      if (!cardEl) return; /* empty canvas — canvas.js handles pan/deselect */

      var card = cards[cardEl.dataset.cardId];
      if (!card) return;

      e.stopPropagation();

      /* Ctrl/Cmd-click toggles this card in or out of the multi-selection
         instead of collapsing to just this one — the only way to build a
         group of specific cards (Select All is the other, all-or-nothing
         path into multiSelectedIds). Never starts a drag on its own, so
         toggling doesn't also yank the card under the cursor. */
      if (e.ctrlKey || e.metaKey) {
        toggleCardInSelection(card.id);
        return;
      }

      /* A plain click on a card that's already part of the current
         multi-selection keeps the whole group selected (so it can be
         dragged together); a plain click on any card outside that group
         collapses back down to just this one, same as before. */
      if (multiSelectedIds.length > 1 && multiSelectedIds.indexOf(card.id) !== -1) {
        selectedId = card.id;
      } else if (card.groupId && getGroupMembers(card.groupId).length > 1) {
        /* Persistent grouping (Ctrl+G) — clicking any member selects the
           whole group, same as clicking one shape in an Illustrator/
           Figma group. */
        setMultiSelection(getGroupMembers(card.groupId));
        selectedId = card.id;
      } else {
        selectCard(card.id);
      }
      bringToFront(card.id);

      /* Let textareas/inputs/buttons receive focus normally — no drag */
      if (target.tagName === 'TEXTAREA' || target.tagName === 'INPUT' || target.tagName === 'BUTTON') {
        return;
      }

      if (card.pinned) return;

      startDrag(card, cardEl, e);
    });

    /* ── click: GIF pause/resume toggle (image itself, or the card-bar
       toggle button added in Phase 2) ── */
    world.addEventListener('click', function(e) {
      var isImg = e.target.tagName === 'IMG';
      var toggleBtn = e.target.closest('.gif-toggle-btn');
      if (!isImg && !toggleBtn) return;
      var cardEl = e.target.closest('.card-gif');
      if (!cardEl) return;
      var card = cards[cardEl.dataset.cardId];
      if (!card) return;
      /* Audit fix: the GIF img is the only media element built WITHOUT
         pointer-events:none (buildGifCard sets cursor:pointer on it
         specifically for this click-to-pause feature), so mousedown on
         it starts a drag same as anywhere else on the card, and mouseup
         fires this click too — toggling pause on every single drag of a
         GIF card. Every other click handler descended from a drag
         already checks this same dataset flag (see startDrag/
         justDragged); this one just never did. */
      if (cardEl.dataset.justDragged) { delete cardEl.dataset.justDragged; return; }
      var img = cardEl.querySelector('img');
      if (!img) return;
      if (toggleBtn) e.stopPropagation();
      toggleGifPause(img, card);
    });

    /* ── right-click: card context menu ── */
    world.addEventListener('contextmenu', function(e) {
      var cardEl = e.target.closest('.card');
      if (!cardEl) return;
      var card = cards[cardEl.dataset.cardId];
      if (!card) return;
      e.preventDefault();
      e.stopPropagation();
      /* Same preserve-the-group/multi-selection logic as the plain-click
         handler above — right-clicking a card that's already part of an
         active multi-selection or persistent group must not collapse it
         first, or the context menu's "Group" item (which needs 2+
         selected) could never show after a real multi-select. */
      if (multiSelectedIds.length > 1 && multiSelectedIds.indexOf(card.id) !== -1) {
        selectedId = card.id;
      } else if (card.groupId && getGroupMembers(card.groupId).length > 1) {
        setMultiSelection(getGroupMembers(card.groupId));
        selectedId = card.id;
      } else {
        selectCard(card.id);
      }
      KanvazUI.showCardContextMenu(e.clientX, e.clientY, card);
    });
  }

  /* ── Drag (move) ── */

  function startDrag(card, el, e) {
    var startX = e.clientX;
    var startY = e.clientY;
    var origX  = card.x;
    var origY  = card.y;
    var scale  = KanvazCanvas.getScale();
    var moved  = false;

    /* Group drag: dragging any member of an active multi-selection moves
       every member by the same delta instead of just the one under the
       cursor — otherwise Ctrl-click multi-select could build a group but
       never actually rearrange it together. Alignment-snap and grid-snap
       stay single-card-only (groupOrigins is null otherwise): snapping
       each member independently mid-group-move would distort the
       group's relative spacing rather than preserve it. */
    var groupOrigins = null;
    if (multiSelectedIds.length > 1 && multiSelectedIds.indexOf(card.id) !== -1) {
      groupOrigins = {};
      for (var gi = 0; gi < multiSelectedIds.length; gi++) {
        var gid = multiSelectedIds[gi];
        var gcard = cards[gid];
        if (gcard) groupOrigins[gid] = { x: gcard.x, y: gcard.y };
      }
    }

    function onMove(ev) {
      var dx = (ev.clientX - startX) / scale;
      var dy = (ev.clientY - startY) / scale;
      if (!moved && Math.abs(dx) < 2 && Math.abs(dy) < 2) return;
      moved = true;
      /* BUG fix: the browser still fires a native 'click' on the original
         mousedown target once the mouse comes back up over it — dragging
         doesn't suppress click the way it does on touch. For plain cards
         that's harmless, but the color card's swatch/label/copy-button
         have their own click handlers (open color picker, cycle format,
         copy hex) that would otherwise fire immediately after every drag,
         making the card feel like it snaps back / "won't move". Flag the
         element so those handlers can recognize and skip that one click. */
      el.dataset.justDragged = '1';

      if (groupOrigins) {
        for (var id in groupOrigins) {
          var gcard = cards[id];
          var gel = document.getElementById(id);
          if (!gcard || !gel) continue;
          gcard.x = groupOrigins[id].x + dx;
          gcard.y = groupOrigins[id].y + dy;
          gel.style.left = gcard.x + 'px';
          gel.style.top  = gcard.y + 'px';
        }
        return;
      }

      var nx = snapToGrid(origX + dx);
      var ny = snapToGrid(origY + dy);

      /* v5.2.0 — snap-to-other-cards alignment guides. Deliberately only
         active when grid-snap is off: both are "where should this card's
         position round to" answers, and letting them compete card-by-card
         would make drags feel unpredictable rather than helpful. */
      var gridSettings = (typeof KanvazUI_Extended !== 'undefined') ? KanvazUI_Extended.getSettings() : null;
      if (!gridSettings || !gridSettings.gridSnapEnabled) {
        var snap = findAlignmentSnap(card.id, nx, ny, card.w, card.h);
        if (snap.x !== null) { nx = snap.x; showAlignGuideV(snap.guideX); }
        else if (alignGuideV) alignGuideV.style.display = 'none';
        if (snap.y !== null) { ny = snap.y; showAlignGuideH(snap.guideY); }
        else if (alignGuideH) alignGuideH.style.display = 'none';
      } else {
        hideAlignGuides();
      }

      card.x = nx;
      card.y = ny;
      el.style.left = card.x + 'px';
      el.style.top  = card.y + 'px';
    }

    function onUp() {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      hideAlignGuides();
      if (moved) {
        KanvazApp.markDirty();
        KanvazHistory.push();
        if (groupOrigins) {
          for (var id in groupOrigins) {
            var gcard = cards[id];
            if (gcard) emitCardEvent('cardUpdate', gcard);
          }
        } else {
          emitCardEvent('cardUpdate', card);
        }
      }
    }

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }

  /* ── Alignment guides (v5.2.0) ──
     Snaps a dragged card's left/center/right (and top/center/bottom) to
     any other card's matching edge within ALIGN_THRESHOLD world-units,
     with a thin guide line spanning the board at the aligned coordinate
     — same idea as Figma/Illustrator smart guides, scoped to one axis
     match at a time (the single closest candidate per axis, not every
     card that happens to be within range). */
  var ALIGN_THRESHOLD = 6;
  var alignGuideV = null;
  var alignGuideH = null;

  function ensureAlignGuides() {
    if (!alignGuideV) {
      alignGuideV = document.createElement('div');
      alignGuideV.className = 'align-guide align-guide-v';
      world.appendChild(alignGuideV);
    }
    if (!alignGuideH) {
      alignGuideH = document.createElement('div');
      alignGuideH.className = 'align-guide align-guide-h';
      world.appendChild(alignGuideH);
    }
  }

  function showAlignGuideV(x) {
    ensureAlignGuides();
    alignGuideV.style.left = x + 'px';
    alignGuideV.style.display = '';
  }

  function showAlignGuideH(y) {
    ensureAlignGuides();
    alignGuideH.style.top = y + 'px';
    alignGuideH.style.display = '';
  }

  function hideAlignGuides() {
    if (alignGuideV) alignGuideV.style.display = 'none';
    if (alignGuideH) alignGuideH.style.display = 'none';
  }

  function findAlignmentSnap(excludeId, x, y, w, h) {
    var candidatesX = [x, x + w / 2, x + w];
    var candidatesY = [y, y + h / 2, y + h];
    var bestXDelta = ALIGN_THRESHOLD, bestX = null, bestXGuide = null;
    var bestYDelta = ALIGN_THRESHOLD, bestY = null, bestYGuide = null;

    for (var id in cards) {
      if (id === excludeId) continue;
      var c = cards[id];
      var edgesX = [c.x, c.x + c.w / 2, c.x + c.w];
      var edgesY = [c.y, c.y + c.h / 2, c.y + c.h];
      var i, j, d;
      for (i = 0; i < candidatesX.length; i++) {
        for (j = 0; j < edgesX.length; j++) {
          d = Math.abs(candidatesX[i] - edgesX[j]);
          if (d < bestXDelta) {
            bestXDelta = d;
            bestX = x + (edgesX[j] - candidatesX[i]);
            bestXGuide = edgesX[j];
          }
        }
      }
      for (i = 0; i < candidatesY.length; i++) {
        for (j = 0; j < edgesY.length; j++) {
          d = Math.abs(candidatesY[i] - edgesY[j]);
          if (d < bestYDelta) {
            bestYDelta = d;
            bestY = y + (edgesY[j] - candidatesY[i]);
            bestYGuide = edgesY[j];
          }
        }
      }
    }
    return { x: bestX, guideX: bestXGuide, y: bestY, guideY: bestYGuide };
  }

  /* ── Resize ── */

  function snapToGrid(val) {
    if (typeof KanvazUI_Extended === 'undefined') return val;
    var s = KanvazUI_Extended.getSettings();
    if (!s || !s.gridSnapEnabled) return val;
    /* World-space grid spacing is scale-independent — the grid's
       on-screen size changes with zoom, but its logical spacing in
       world units (24 minor / 120 major) never does. */
    var increment = s.gridSnapIncrement === 'major' ? 120 : 24;
    return Math.round(val / increment) * increment;
  }

  function startResize(card, el, dir, e) {
    var startX  = e.clientX;
    var startY  = e.clientY;
    var startW  = card.w;
    var startH  = card.h;
    var startCX = card.x;
    var startCY = card.y;
    var scale   = KanvazCanvas.getScale();
    /* v7.x — Shift now LOCKS proportions instead of freeing them, matching
       every other design tool (Figma, Photoshop, Illustrator all resize
       freely by default and use Shift to constrain aspect ratio). This is
       a deliberate, disclosed behavior flip from the previous default
       (aspect-locked without Shift, free while holding it) — the old
       default was backwards from user expectation coming from any other
       design tool, flagged directly by user feedback.

       Bug fix: aspectLock used to be read ONCE here from the initial
       mousedown event and never rechecked — pressing Shift only AFTER
       the drag had already started (the natural "start resizing freely,
       then hold Shift once you want to lock it" workflow, and the only
       way most people actually use this) did nothing, reported as
       "shift while resize doesn't work at all." Read live from each
       mousemove event's own modifier state inside onMove instead, so
       toggling Shift up/down mid-drag engages/disengages the lock in
       real time, same as every other design tool. */
    var aspectRatio = startW / startH;

    /* Audit fix: handle visibility used to be pure CSS :hover, so
       dragging a handle away from the card mid-resize made every
       handle (including the one still being dragged) fade out —
       :hover only tracks the live pointer position, which constantly
       leaves the card/handle area during a real drag. `.resizing` pins
       full opacity on all of them for the drag's duration; `.active`
       on the one actually being dragged makes it visibly grow, per
       explicit request, so it's obvious which handle is live. */
    el.classList.add('resizing');
    e.target.classList.add('active');

    function onMove(ev) {
      var dx = (ev.clientX - startX) / scale;
      var dy = (ev.clientY - startY) / scale;
      var newW = startW;
      var newH = startH;

      if (dir === 'br' || dir === 'mr' || dir === 'tr') newW = startW + dx;
      if (dir === 'bl' || dir === 'ml' || dir === 'tl') newW = startW - dx;
      if (dir === 'br' || dir === 'bc' || dir === 'bl') newH = startH + dy;
      if (dir === 'tr' || dir === 'tc' || dir === 'tl') newH = startH - dy;

      var isCorner = (dir === 'br' || dir === 'tr' || dir === 'bl' || dir === 'tl');
      /* Bug fix (v7.x, found while re-verifying resize after the Shift-
         semantics flip): these two conditions used to be checked
         separately, with the type exclusion (note/audio/url/file/text
         never aspect-lock, since they have no meaningful "natural"
         ratio) only applied to the FIRST block. The second block re-
         derived newH from newW under the bare `aspectLock && isCorner`
         condition with no type check at all — so a note/text/etc. card
         got its corner-drag aspect-locked anyway regardless of the
         exclusion the first block existed to enforce. Computed once
         here so both branches below agree on whether this card/corner
         combination actually locks. */
      var lockThisResize = ev.shiftKey && isCorner && card.type !== 'note' && card.type !== 'audio' && card.type !== 'url' && card.type !== 'file' && card.type !== 'text';

      if (lockThisResize) {
        /* Snap width only, then re-derive height from the snapped width
           — snapping both dimensions independently would distort the
           locked aspect ratio (e.g. a 4:3 image ending up 1:1-ish).
           Audit fix: newW/newH used to be clamped to CARD_MIN_W/H
           INDEPENDENTLY after this derivation — for a card whose aspect
           ratio is far from square, shrinking past the point where the
           derived height would fall below CARD_MIN_H clamped ONLY the
           height back up, silently breaking the locked ratio right at
           the floor (e.g. a 4:1 card could clamp to a 1:1 square).
           Instead, clamp newW itself to whichever floor keeps BOTH
           dimensions at or above their minimums once height is derived
           from it — so the independent post-hoc clamp below is never
           needed for the locked case. */
        newW = snapToGrid(newW);
        var minWForLock = Math.max(CARD_MIN_W, CARD_MIN_H * aspectRatio);
        newW = Math.max(minWForLock, newW);
        newH = newW / aspectRatio;
      } else {
        newW = snapToGrid(newW);
        newH = snapToGrid(newH);
        newW = Math.max(CARD_MIN_W, newW);
        newH = Math.max(CARD_MIN_H, newH);
      }

      /* Audit fix: position must be derived from the FIXED opposite
         edge using the FINAL clamped/snapped size, not from the raw
         pointer delta. This used to set newX = startCX + dx
         unconditionally — once newW pinned at CARD_MIN_W (dragged past
         the card's own right edge), newX kept tracking the cursor
         anyway, so the card detached from its anchor and followed the
         mouse indefinitely. Anchoring to the true opposite edge (right
         edge for left-handles, bottom edge for top-handles) keeps the
         un-dragged edge genuinely stationary, which also fixes aspect-
         lock's corner anchor drift — previously newY for a tl/tr corner
         came from the raw dy even though newH had already been
         re-derived from the snapped width, so the "fixed" corner wasn't
         actually fixed. */
      var newX = startCX;
      var newY = startCY;
      if (dir === 'bl' || dir === 'ml' || dir === 'tl') newX = startCX + startW - newW;
      if (dir === 'tr' || dir === 'tc' || dir === 'tl') newY = startCY + startH - newH;
      newX = snapToGrid(newX);
      newY = snapToGrid(newY);

      card.w = newW;
      card.h = newH;
      card.x = newX;
      card.y = newY;

      el.style.width  = newW + 'px';
      el.style.height = newH + 'px';
      el.style.left   = newX + 'px';
      el.style.top    = newY + 'px';
    }

    function onUp() {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      el.classList.remove('resizing');
      e.target.classList.remove('active');
      if (typeof KanvazAnnotate !== 'undefined') {
        KanvazAnnotate.resize(card.id, Math.round(card.w), Math.round(card.h));
      }
      rememberedSizes[card.type] = { w: card.w, h: card.h };
      KanvazApp.markDirty();
      KanvazHistory.push();
      emitCardEvent('cardUpdate', card);
    }

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }

  /* ── Video controls (delegated) ── */

  /* v7.x — redrawn to match the 16x16 stroke-icon grid the rest of the
     media controls (MUTE_ICON/LOOP_ICON/COPY_ICON below) already use.
     The previous PLAY/PAUSE/frame-step/onion-skin icons sat on a mix of
     10x10 and 14x14 viewBoxes with no shared margin convention, so they
     rendered at visibly different apparent sizes/weights next to icons
     from the same toolbar — the exact "needs really better controls"
     inconsistency flagged in user feedback. Play/pause stay solid fills
     (the universal media-player convention, unlike the stroke-outline
     style everything else here uses) but now share the same 16x16 grid
     and optical sizing as their neighbors. */
  /* v7.x — icon set switched to Feather Icons (MIT license,
     https://github.com/feathericons/feather) paths, verbatim, at
     Feather's native 24x24 viewBox/stroke-width. Play/pause keep a
     solid currentColor fill instead of Feather's default outline —
     legible-at-14px matters more than perfect consistency for exactly
     these two, and solid play/pause is the near-universal convention
     (YouTube, Spotify, every OS media control) even in otherwise
     outline-icon apps. */
  var PLAY_ICON  = '<svg viewBox="0 0 24 24" fill="currentColor" stroke="none"><polygon points="5 3 19 12 5 21 5 3"/></svg>';
  var PAUSE_ICON = '<svg viewBox="0 0 24 24" fill="currentColor" stroke="none"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>';
  var MUTE_ICON  = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"/></svg>';
  var MUTED_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><line x1="23" y1="9" x2="17" y2="15"/><line x1="17" y1="9" x2="23" y2="15"/></svg>';
  /* v6.x — ArtDeck-inspired frame analysis tools, redrawn v7.x for the
     same 16x16 grid unification as above. */
  var FRAME_BACK_ICON    = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="19 20 9 12 19 4 19 20"/><line x1="5" y1="19" x2="5" y2="5"/></svg>';
  var FRAME_FORWARD_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 4 15 12 5 20 5 4"/><line x1="19" y1="5" x2="19" y2="19"/></svg>';
  /* No direct Feather equivalent for "onion skin" (ghost the previous
     frame) — "layers" is the closest existing Feather icon to the same
     underlying idea (stacked/overlaid frames). */
  var ONION_SKIN_ICON     = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/></svg>';
  var LOOP_ICON  = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M2 8a6 6 0 0 1 10.5-4"/><path d="M14 8a6 6 0 0 1-10.5 4"/><path d="M12 1.2v3.5H8.5"/><path d="M4 14.8v-3.5H7.5"/></svg>';
  /* v8.x polish item — video/audio "expand" affordance, flagged as
     missing since v7.0.0's own control-polish pass and never built.
     Feather Icons' "maximize" glyph, same convention as every other
     icon here. */
  var EXPAND_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"/></svg>';
  var COPY_ICON  = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><rect x="5.5" y="5.5" width="8.5" height="8.5" rx="1.5"/><path d="M10.5 5.5V3.5A1.5 1.5 0 0 0 9 2H3.5A1.5 1.5 0 0 0 2 3.5V9a1.5 1.5 0 0 0 1.5 1.5h2"/></svg>';

  /* ── Color format helpers (hex ↔ rgb ↔ hsl) ── */

  function hexToRgb(hex) {
    var h = hex.replace('#', '');
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    return {
      r: parseInt(h.substring(0, 2), 16),
      g: parseInt(h.substring(2, 4), 16),
      b: parseInt(h.substring(4, 6), 16)
    };
  }

  function rgbToHsl(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    var max = Math.max(r, g, b), min = Math.min(r, g, b);
    var h, s, l = (max + min) / 2;
    if (max === min) {
      h = s = 0;
    } else {
      var d = max - min;
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      if (max === r)      h = (g - b) / d + (g < b ? 6 : 0);
      else if (max === g) h = (b - r) / d + 2;
      else                 h = (r - g) / d + 4;
      h /= 6;
    }
    return { h: Math.round(h * 360), s: Math.round(s * 100), l: Math.round(l * 100) };
  }

  function formatColorString(hex, format) {
    var rgb = hexToRgb(hex);
    if (format === 'rgb') {
      return 'rgb(' + rgb.r + ', ' + rgb.g + ', ' + rgb.b + ')';
    }
    if (format === 'hsl') {
      var hsl = rgbToHsl(rgb.r, rgb.g, rgb.b);
      return 'hsl(' + hsl.h + ', ' + hsl.s + '%, ' + hsl.l + '%)';
    }
    return hex.toUpperCase();
  }

  function toggleVideoPlay(cardEl) {
    if (!cardEl) return;
    var vid = cardEl.querySelector('video, audio');
    var btn = cardEl.querySelector('.media-play-btn');
    if (!vid || !btn) return;
    if (vid.paused) {
      /* Bug fix: play() returns a Promise that rejects with a benign
         AbortError/"interrupted by a call to pause()" (or "...by end of
         playback") whenever playback is stopped again — by another
         click, the card being deselected/removed, or the clip simply
         ending — before the browser finishes actually starting it. A
         bare, unhandled vid.play() turned that into an unhandled
         promise rejection, which errors.js's global handler then
         surfaced as a scary E999 toast for something that isn't a real
         error at all. Every other genuine rejection still logs. */
      var playResult = vid.play();
      if (playResult && playResult.catch) {
        playResult.catch(function(e) {
          if (e && e.name !== 'AbortError') console.warn('[Kanvaz] media play() failed:', e.message);
        });
      }
      btn.innerHTML = PAUSE_ICON;
    } else {
      vid.pause();
      btn.innerHTML = PLAY_ICON;
    }
  }

  function toggleVideoMute(cardEl) {
    if (!cardEl) return;
    var vid = cardEl.querySelector('video, audio');
    var btn = cardEl.querySelector('.media-mute-btn');
    if (!vid || !btn) return;
    vid.muted = !vid.muted;
    btn.innerHTML = vid.muted ? MUTED_ICON : MUTE_ICON;
    btn.style.color = vid.muted ? 'var(--color-text-3)' : 'var(--color-accent)';
    /* Persist — same pattern as toggleAudioLoop just below. Without
       this the mute state only ever lived on the live <video>/<audio>
       element and reverted to the type's hardcoded default every reload. */
    var card = cards[cardEl.dataset.cardId];
    if (card) {
      card.muted = vid.muted;
      KanvazApp.markDirty();
      refreshPropertiesIfOpen(card);
    }
  }

  /* ── Volume slider (v7.x) ──
     A real per-card volume LEVEL, not just the binary mute toggle that
     existed before — feedback specifically asked for "better controls,"
     and a mute-only toggle with no way to set how loud something plays
     is a real gap next to any other media player. Not delegated through
     world's central mousedown handler the way the buttons above are —
     a native <input type="range"> needs its own direct 'input' listener
     to track a drag, and its own mousedown stopPropagation so dragging
     the thumb doesn't start moving the card underneath it (the same
     concern buildResizeHandles' handles already had to solve). */
  function buildVolumeSlider(mediaEl, card) {
    var slider = document.createElement('input');
    slider.type = 'range';
    slider.className = 'media-volume-slider';
    slider.min = 0;
    slider.max = 1;
    slider.step = 0.05;
    var initialVolume = (card.volume !== undefined && card.volume !== null) ? card.volume : 1;
    slider.value = initialVolume;
    mediaEl.volume = initialVolume;
    slider.title = 'Volume';
    slider.addEventListener('mousedown', function(e) { e.stopPropagation(); });
    slider.addEventListener('click', function(e) { e.stopPropagation(); });
    slider.addEventListener('input', function() {
      var v = parseFloat(slider.value);
      mediaEl.volume = v;
      card.volume = v;
      /* Dragging the slider above 0 while muted is a clearer "I want
         sound now" signal than making the user find the mute button
         too — matches how every native OS/browser volume slider
         already behaves. DOM lookup deliberately scoped inside this
         branch — 'input' fires on every tick of a drag, and the common
         case (already unmuted) has no reason to touch the DOM at all. */
      if (v > 0 && mediaEl.muted) {
        mediaEl.muted = false;
        card.muted = false;
        var cardEl = document.getElementById(card.id);
        var muteBtn = cardEl ? cardEl.querySelector('.media-mute-btn') : null;
        if (muteBtn) {
          muteBtn.innerHTML = MUTE_ICON;
          muteBtn.style.color = 'var(--color-accent)';
        }
      }
      KanvazApp.markDirty();
    });
    return slider;
  }

  function toggleAudioLoop(cardEl) {
    if (!cardEl) return;
    var aud = cardEl.querySelector('audio');
    var btn = cardEl.querySelector('.media-loop-btn');
    if (!aud || !btn) return;
    aud.loop = !aud.loop;
    btn.classList.toggle('active', aud.loop);
    var card = cards[cardEl.dataset.cardId];
    if (card) {
      card.audioLoop = aud.loop;
      KanvazApp.markDirty();
      refreshPropertiesIfOpen(card);
    }
  }

  function seekVideo(cardEl, e, track) {
    if (!cardEl) return;
    var vid = cardEl.querySelector('video, audio');
    if (!vid || !vid.duration) return;

    function doSeek(evt) {
      var rect = track.getBoundingClientRect();
      var pct = (evt.clientX - rect.left) / rect.width;
      vid.currentTime = Math.max(0, Math.min(1, pct)) * vid.duration;
    }

    doSeek(e);

    /* Draggable scrub thumb — keep seeking while the mouse is held down
       and moved, not just on the initial click. */
    function onMove(evt) { doSeek(evt); }
    function onUp() {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    }
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }

  /* ── GIF pause/resume (delegated) ── */

  function toggleGifPause(img, card) {
    var cardEl = img.closest('.card');
    var overlay = cardEl ? cardEl.querySelector('.gif-pause-overlay') : null;
    var toggleBtn = cardEl ? cardEl.querySelector('.gif-toggle-btn') : null;

    if (img._paused) {
      img.src = img._origSrc;
      img._paused = false;
      if (overlay) overlay.classList.remove('visible');
      if (toggleBtn) toggleBtn.innerHTML = PAUSE_ICON;
    } else {
      var cvs = document.createElement('canvas');
      cvs.width  = img.naturalWidth  || card.w;
      cvs.height = img.naturalHeight || card.h;
      var ctx = cvs.getContext('2d');
      ctx.drawImage(img, 0, 0);
      img.src = cvs.toDataURL('image/png');
      img._paused = true;
      if (overlay) overlay.classList.add('visible');
      if (toggleBtn) toggleBtn.innerHTML = PLAY_ICON;
    }
  }

  /* ── ID generator ── */

  function nextId() {
    cardCount++;
    return 'card-' + Date.now() + '-' + cardCount;
  }

  /* ── Plugin event hooks (4.3.0) ──
     cardCreate/cardUpdate/cardDelete fire at the exact points that
     already trigger an undo-history push in THIS file — the same
     "this is a real, committed change" boundary the app already relies
     on for undo, reused rather than inventing a second, possibly
     inconsistent notion of what counts as a change. Covers every
     creation/deletion path (all six create*Card functions plus
     duplicateCardCore, and removeCardCore/finishDelete respectively)
     and cards.js's own field/geometry mutations (drag, resize, flip,
     pin, resize-to-natural, nudge, z-order, relink, object-fit, speed,
     and note/url/color content commits).
     Deliberately NOT wired into annotate.js, map-view.js, inspector.js,
     or properties.js's own KanvazHistory.push() call sites yet — those
     modules own their own state outside the canonical card object this
     event carries, and covering them is real follow-up work, not
     something forgotten. selectionChange fires from selectCard/
     selectAll/deselectAll/setMultiSelection below. */
  function emitCardEvent(type, card) {
    /* Bug fix: catches every existing (and future) 'cardUpdate' call
       site in one place — see refreshPropertiesIfOpen()'s own comment
       below for the actual bug this closes (Properties panel going
       stale while open, e.g. the loop toggle). Systematic instead of
       patching each individual on-canvas control one at a time.

       Real bug caught live while testing this: passing THIS card
       through, not refreshing unconditionally — a note card's own
       text-editing <textarea> fires 'cardUpdate' on every blur (even
       with no real change), and blurring it is a completely ordinary
       side effect of focusing ANY other input on screen, including
       the Properties panel's own "+Add property" key/value fields. An
       unconditional refresh here meant clicking "+Add property" for
       card B, while some unrelated note card A's textarea happened to
       still hold focus, immediately blurred A, fired 'cardUpdate' for
       A, and wiped the whole panel (including the just-opened,
       not-yet-saved form) — the exact "edited B, it landed on A"
       report. Only ever refresh for the card Properties is actually
       showing. */
    if (type === 'cardUpdate') refreshPropertiesIfOpen(card);
    refreshLayersIfOpen();
    if (typeof KanvazPluginAPI === 'undefined' || !KanvazPluginAPI._emit) return;
    KanvazPluginAPI._emit(type, card);
  }

  /* Bug fix: "when i'm in properties tab and i click any card it shows
     nothing but when i open tab again then it does" + "loop on/off is
     not in sync with the card" — the Properties panel only ever
     re-rendered when its OWN section was (re)opened; nothing told it
     to refresh when the selection changed, or when a card was mutated
     from its own on-canvas controls (the loop/mute toggle icons on an
     audio/video card) while Properties happened to already be open and
     showing that same card. renderInto() itself already re-reads the
     live selection every time it runs (a prior fix) — the missing
     piece was ever calling it again after the panel's first render.

     forCard (optional): when the caller knows which specific card
     changed (every emitCardEvent('cardUpdate', card) site does), skip
     the refresh entirely unless that card is the one actually selected
     — Properties always shows the live selection, so a refresh
     triggered by any OTHER card is not just wasted work, it actively
     wipes whatever the user is doing in the panel right now. Callers
     with no specific card in mind (the plain selection-change path)
     omit it and always refresh, since a selection change legitimately
     means "show whatever's selected now" unconditionally. Also skips
     while the "+Add property" mini-form is open — even a refresh for
     the RIGHT card would otherwise discard an in-progress, unsaved
     key/value the user hasn't clicked Add on yet. */
  function refreshPropertiesIfOpen(forCard) {
    if (typeof KanvazProperties === 'undefined' || !KanvazProperties.isOpen || !KanvazProperties.isOpen() || !KanvazProperties.refresh) return;
    if (forCard && forCard.id !== selectedId) return;
    if (document.querySelector('.prop-add-form')) return;
    KanvazProperties.refresh();
  }

  function emitSelectionChange() {
    refreshPropertiesIfOpen();
    refreshLayersIfOpen();
    if (typeof KanvazPluginAPI === 'undefined' || !KanvazPluginAPI._emit) return;
    KanvazPluginAPI._emit('selectionChange', getSelectedIds());
  }

  /* ── Create from media result ── */

  function createFromMedia(mediaResult, pos) {
    var id = nextId();
    var w = Math.max(CARD_MIN_W, mediaResult.displayW || 300);
    var h = Math.max(CARD_MIN_H, mediaResult.displayH || 200);

    var card = {
      id:       id,
      type:     mediaResult.type,
      dataUrl:  mediaResult.dataUrl,
      name:     mediaResult.name,
      path:     mediaResult.originalPath,
      x:        pos.x,
      y:        pos.y,
      w:        w,
      h:        h,
      z:        ++zCounter,
      pinned:   false,
      opacity:  1.0,
      flipH:    false,
      flipV:    false,
      naturalW: mediaResult.naturalW || w,
      naturalH: mediaResult.naturalH || h,
      annotations: []
    };

    /* v7.x — 3D model preview defaults. modelFormat drives which Three.js
       loader buildModel3DCard() picks; renderMode/bgColor/animationPlaying
       are real per-card display preferences, same "missing → sensible
       default" pattern as objectFit/playbackRate/colorFormat elsewhere
       in this whitelist. */
    if (mediaResult.type === 'model3d') {
      card.modelFormat = mediaResult.modelFormat || null;
      card.renderMode = 'normal';
      card.bgColor = null;
      card.animationPlaying = false;
    }

    cards[id] = card;
    renderCard(card);
    selectCard(id);
    updateEmptyState();
    updateCount();

    if (typeof KanvazHistory !== 'undefined') {
      KanvazHistory.push();
    }
    emitCardEvent('cardCreate', card);

    return card;
  }

  /* ── Create from dataUrl (clipboard) ── */

  function createFromDataUrl(dataUrl, name, pos) {
    KanvazMedia.loadFromDataUrl(dataUrl, name, function(result, err) {
      if (err || !result) {
        KanvazErrors.handle('MEDIA_LOAD_FAIL', err);
        return;
      }
      createFromMedia(result, pos);
      KanvazUI.toast('Image pasted', 'success');
    });
  }

  /* ── Create note ── */

  function createNote(x, y) {
    var id = nextId();
    var size = sizeFor('note', 240, 160);
    var card = {
      id:       id,
      type:     'note',
      dataUrl:  null,
      name:     'Note',
      path:     null,
      x:        x,
      y:        y,
      w:        size.w,
      h:        size.h,
      z:        ++zCounter,
      pinned:   false,
      text:     '',
      annotations: []
    };

    cards[id] = card;
    renderCard(card);
    selectCard(id);
    updateEmptyState();
    updateCount();

    /* Focus the textarea */
    setTimeout(function() {
      var el = document.getElementById(id);
      if (el) {
        var ta = el.querySelector('.note-body');
        if (ta) ta.focus();
      }
    }, 50);

    if (typeof KanvazHistory !== 'undefined') {
      KanvazHistory.push();
    }
    emitCardEvent('cardCreate', card);

    return card;
  }

  /* ── Create bare text label ──
     Distinct from Note: no surface/border/card-bar chrome at all — a
     floating label for titling/annotating a section of the board
     directly, not a boxed textarea. Resize handles, tag bar, and pin
     indicator still work exactly like every other card type; only the
     name-strip/badge chrome (buildCardBar) is skipped. */
  function createTextCard(x, y) {
    var id = nextId();
    var size = sizeFor('text', 220, 80);
    var card = {
      id:       id,
      type:     'text',
      dataUrl:  null,
      name:     'Text',
      path:     null,
      x:        x,
      y:        y,
      w:        size.w,
      h:        size.h,
      z:        ++zCounter,
      pinned:   false,
      text:     '',
      annotations: []
    };

    cards[id] = card;
    renderCard(card);
    selectCard(id);
    updateEmptyState();
    updateCount();

    /* Focus the textarea */
    setTimeout(function() {
      var el = document.getElementById(id);
      if (el) {
        var ta = el.querySelector('.text-body');
        if (ta) ta.focus();
      }
    }, 50);

    if (typeof KanvazHistory !== 'undefined') {
      KanvazHistory.push();
    }
    emitCardEvent('cardCreate', card);

    return card;
  }

  /* ── Create color swatch ── */

  function createColorCard(x, y, hex) {
    var id = nextId();
    var color = hex || '#9D7FFF';
    var size = sizeFor('color', 160, 160);
    var card = {
      id:       id,
      type:     'color',
      dataUrl:  null,
      name:     color,
      path:     null,
      x:        x,
      y:        y,
      w:        size.w,
      h:        size.h,
      z:        ++zCounter,
      pinned:   false,
      color:    color,
      annotations: []
    };

    cards[id] = card;
    renderCard(card);
    selectCard(id);
    updateEmptyState();
    updateCount();

    /* Open color picker immediately */
    setTimeout(function() {
      var el = document.getElementById(id);
      if (el) {
        var swatch = el.querySelector('.color-swatch');
        if (swatch) swatch.click();
      }
    }, 100);

    if (typeof KanvazHistory !== 'undefined') {
      KanvazHistory.push();
    }
    emitCardEvent('cardCreate', card);

    return card;
  }

  /* ── Create URL reference ── */

  function createUrlCard(x, y) {
    var id = nextId();
    var size = sizeFor('url', 220, 90);
    var card = {
      id:       id,
      type:     'url',
      dataUrl:  null,
      name:     'URL reference',
      path:     null,
      x:        x,
      y:        y,
      w:        size.w,
      h:        size.h,
      z:        ++zCounter,
      pinned:   false,
      url:      '',
      annotations: []
    };

    cards[id] = card;
    renderCard(card);
    selectCard(id);
    updateEmptyState();
    updateCount();

    /* Focus the URL input immediately so typing/pasting a link is the
       very next thing that happens — same "ready to go" feel as a new
       note dropping in with the cursor already active. */
    setTimeout(function() {
      var el = document.getElementById(id);
      var input = el && el.querySelector('.url-input');
      if (input) input.focus();
    }, 50);

    if (typeof KanvazHistory !== 'undefined') {
      KanvazHistory.push();
    }
    emitCardEvent('cardCreate', card);

    return card;
  }

  /* ── Create File reference ──
     Points at a file on disk without embedding it (hasMedia:false in
     reference-types.js) — for linking a source PSD, script, brief, or
     any other file too big/impractical to embed as base64. */

  function createFileRefCard(x, y) {
    KanvazBridge.openRefFileDialog(null).then(function(p) {
      if (!p) return; /* cancelled — never create an empty, useless card */
      createFileRefCardAtPath(x, y, p);
    }).catch(function(e) { console.warn('[Kanvaz] openRefFileDialog IPC failed:', e); });
  }

  /* Extracted from createFileRefCard() above so a caller that already
     HAS a path (the MCP Bridge official plugin's addReference tool —
     see official-plugins/mcp-bridge — is the reason this exists) can
     build the exact same card without an OS file-picker dialog in the
     way. Returns the new card, or null if p is falsy. */
  function createFileRefCardAtPath(x, y, p) {
    if (!p) return null;
    var id = nextId();
    /* Direct feedback: a file-reference card pointing at something with
       a real inline preview (PDF, or now an image) needs real room to
       show it — the old flat 220x90 "compact icon + label" default
       looked fine for a plain .zip/.docx reference but absurd for a
       preview-capable one. Tracked as its own remembered-size bucket
       ('file-preview') separate from plain file refs ('file') so
       resizing one category never drags the other's default around
       with it — you don't want a big image preview's remembered size
       forcing a plain-icon .zip card to also default huge, or vice
       versa. */
    var isPreviewable = isPdfPath(p) || isImagePath(p);
    var size = isPreviewable ? sizeFor('file-preview', 340, 260) : sizeFor('file', 220, 90);
    var card = {
      id:       id,
      type:     'file',
      dataUrl:  null,
      name:     basenameOf(p),
      path:     p,
      x:        x,
      y:        y,
      w:        size.w,
      h:        size.h,
      z:        ++zCounter,
      pinned:   false,
      annotations: []
    };
    cards[id] = card;
    renderCard(card);
    selectCard(id);
    updateEmptyState();
    updateCount();
    if (typeof KanvazHistory !== 'undefined') KanvazHistory.push();
    emitCardEvent('cardCreate', card);
    return card;
  }

  /* ── Create a plugin-registered card type ──
     typeId must be currently registered via KanvazPluginAPI.registerCardType
     with a create(x,y) function. The plugin's create() supplies whatever
     content fields it wants (name, w, h, pluginData); Kanvaz always
     assigns id/type/z/pinned/annotations itself so a plugin can never
     collide with another card's id or corrupt z-order bookkeeping. */
  function createPluginCard(typeId, x, y) {
    if (typeof KanvazPluginAPI === 'undefined' || !KanvazPluginAPI._createCard) return null;
    var partial = KanvazPluginAPI._createCard(typeId, x, y) || {};

    /* Audit fix: `partial.w || 200` only caught falsy values (0, NaN,
       undefined) — a negative number or a non-numeric string like
       "200px" passed straight through. A string w/h silently corrupts
       startResize()'s aspectRatio math (string concatenation instead of
       division → NaN/Infinity) and canvas.js's zoomFit() bounding box
       (c.x + c.w becomes string concat, so that card is silently
       excluded from the fit-all bounds) on every subsequent resize/fit.
       Number(...) + isFinite(...) rejects anything that isn't a real,
       usable number, and the CARD_MIN_W/H floor (already enforced on
       every other creation path — see createFromMedia above) stops a
       plugin from creating a degenerate near-zero card with broken
       resize-handle geometry. */
    var w = Number(partial.w);
    if (!isFinite(w) || w <= 0) w = 200;
    w = Math.max(CARD_MIN_W, w);

    var h = Number(partial.h);
    if (!isFinite(h) || h <= 0) h = 150;
    h = Math.max(CARD_MIN_H, h);

    var id = nextId();
    var card = {
      id:          id,
      type:        typeId,
      dataUrl:     partial.dataUrl !== undefined ? partial.dataUrl : null,
      name:        partial.name !== undefined ? partial.name : typeId,
      path:        partial.path !== undefined ? partial.path : null,
      x:           x,
      y:           y,
      w:           w,
      h:           h,
      z:           ++zCounter,
      pinned:      false,
      pluginData:  partial.pluginData || null,
      annotations: []
    };

    cards[id] = card;
    renderCard(card);
    selectCard(id);
    updateEmptyState();
    updateCount();
    if (typeof KanvazHistory !== 'undefined') KanvazHistory.push();
    emitCardEvent('cardCreate', card);
    return card;
  }

  /* No Node `path` module in the renderer (contextIsolation) — just
     split on whichever slash the OS used. */
  function basenameOf(p) {
    var parts = p.split(/[\\/]/);
    return parts[parts.length - 1] || p;
  }

  /* ── Render card DOM ──
     NOTE: el.id AND el.dataset.cardId are both set to card.id.
     el.id is used by ~15 lookup sites (document.getElementById).
     el.dataset.cardId is the source of truth for delegated handlers
     resolving DOM → data via closest('.card'). Both always match. */

  function renderCard(card) {
    var el = document.createElement('div');
    el.id = card.id;
    el.dataset.cardId = card.id;
    el.className = 'card card-' + card.type;
    el.style.left   = card.x + 'px';
    el.style.top    = card.y + 'px';
    el.style.width  = card.w + 'px';
    el.style.height = card.h + 'px';
    el.style.zIndex = card.z;

    if (card.type === 'image') {
      buildImageCard(el, card);
    } else if (card.type === 'gif') {
      buildGifCard(el, card);
    } else if (card.type === 'video') {
      buildVideoCard(el, card);
    } else if (card.type === 'audio') {
      buildAudioCard(el, card);
    } else if (card.type === 'note') {
      buildNoteCard(el, card);
    } else if (card.type === 'text') {
      buildTextCard(el, card);
    } else if (card.type === 'color') {
      buildColorCard(el, card);
    } else if (card.type === 'url') {
      buildUrlCard(el, card);
    } else if (card.type === 'file') {
      buildFileRefCard(el, card);
    } else if (card.type === 'model3d') {
      buildModel3DCard(el, card);
    } else if (typeof KanvazPluginAPI !== 'undefined' && KanvazPluginAPI._hasCardType(card.type)) {
      buildPluginCard(el, card);
    } else {
      buildUnknownCard(el, card);
    }

    /* Text cards are a bare floating label — skip the name-strip/badge
       chrome entirely (buildCardBar), but still support tags like every
       other card type (buildTagBar is self-contained, not nested inside
       buildCardBar's output). */
    if (card.type === 'text') {
      buildTagBar(el, card);
    } else {
      buildCardBar(el, card);
    }
    buildPinIndicator(el);
    buildResizeHandles(el);
    if (card.hidden) el.classList.add('card-layer-hidden');

    world.appendChild(el);
  }

  /* ── Plugin-registered card types (4.2.0) ──
     Renders via the registering plugin's own render(el, card). If the
     plugin that owns this type isn't currently loaded (disabled/removed
     since the board was saved) — or its render() throws — this falls
     through to buildUnknownCard() instead of taking anything else down,
     same graceful-degradation principle as missing media. */
  function buildPluginCard(el, card) {
    try {
      /* Audit fix: the def lookup itself used to run OUTSIDE this try
         block — if _getCardType ever returned something without a
         .render method (or threw), the exception escaped buildPluginCard
         entirely and propagated up into renderCard()/deserialise()'s
         load loop, uncaught. Moved inside so ANY failure in this
         function — lookup or render — degrades to buildUnknownCard. */
      var def = KanvazPluginAPI._getCardType(card.type);
      if (!def || typeof def.render !== 'function') {
        throw new Error('no render() registered for type "' + card.type + '"');
      }
      def.render(el, card);
    } catch (e) {
      console.error('[Kanvaz Plugin] render() failed for card type "' + card.type + '":', e.message);
      buildUnknownCard(el, card);
    }
  }

  /* A card whose type is neither a built-in nor a currently-registered
     plugin type. Shows a clear, calm placeholder instead of a blank or
     broken card — the rest of the board is unaffected. */
  function buildUnknownCard(el, card) {
    /* Audit fix: buildUnknownCard() can now be reached AFTER a plugin's
       render() already partially built content and then threw partway
       through (e.g. appended a <video>, set .src, started playback,
       then threw on a later line) — without clearing first, the
       placeholder was simply appended alongside whatever the broken
       render left behind, showing both at once and leaking any
       listeners/media the partial render started. Clearing first is a
       harmless no-op on the normal "type was never registered at all"
       path, since el is already empty there. */
    el.innerHTML = '';
    var wrap = document.createElement('div');
    wrap.className = 'card-unknown-type';
    wrap.style.cssText = 'display:flex;flex-direction:column;align-items:center;justify-content:center;width:100%;height:100%;gap:6px;padding:10px;text-align:center;color:var(--color-text-3);';
    var icon = document.createElement('div');
    icon.innerHTML = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9.5 9a2.5 2.5 0 015 0c0 1.5-2 1.8-2 3.5"/><circle cx="12.5" cy="16" r="0.6" fill="currentColor" stroke="none"/></svg>';
    var label = document.createElement('div');
    label.style.cssText = 'font-size:11px;line-height:1.4;';
    label.textContent = 'Unknown card type — needs plugin: ' + card.type;
    wrap.appendChild(icon);
    wrap.appendChild(label);
    el.appendChild(wrap);
  }

  /* ══════════════════════════════════════════════════════════════
     PHASE 2 shared media-card helpers — skeleton loading shimmer,
     themed error state + Relink, and a persistent annotation dot.
     Used by image/GIF/video (the three types that load an async
     media element and can be annotated).
     ══════════════════════════════════════════════════════════════ */

  var BROKEN_MEDIA_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/><line x1="4" y1="4" x2="20" y2="20" stroke="var(--color-red)"/></svg>';
  var ANNOTATION_DOT_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"/></svg>';

  function removeSkeleton(el) {
    var sk = el.querySelector('.card-skeleton');
    if (!sk) return;
    sk.classList.add('card-skeleton-out');
    setTimeout(function() {
      if (sk.parentNode) sk.parentNode.removeChild(sk);
    }, 220);
  }

  /* Skeleton + spinner both gone — used once a video's first frame (or
     an image's pixels) has actually rendered. */
  function clearLoadingState(el) {
    removeSkeleton(el);
    var sp = el.querySelector('.card-spinner');
    if (sp && sp.parentNode) sp.parentNode.removeChild(sp);
  }

  /* ── Audio waveform generator ──
     Decodes the audio buffer and downsamples it to a handful of peak
     values so it can be rendered as a subtle static bar-chart behind
     the icon area. Best-effort: any failure (unsupported format,
     decode error) just leaves the waveform empty — never blocks
     playback, which works independently via the <audio> element. */
  var WAVEFORM_BARS = 32;

  function generateWaveform(dataUrl, callback) {
    var AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx || typeof fetch === 'undefined') {
      callback(null);
      return;
    }
    fetch(dataUrl)
      .then(function(res) { return res.arrayBuffer(); })
      .then(function(buf) {
        var ctx = new AudioCtx();
        return ctx.decodeAudioData(buf);
      })
      .then(function(audioBuffer) {
        var raw = audioBuffer.getChannelData(0);
        var blockSize = Math.max(1, Math.floor(raw.length / WAVEFORM_BARS));
        var peaks = [];
        for (var i = 0; i < WAVEFORM_BARS; i++) {
          var start = i * blockSize;
          var max = 0;
          for (var j = 0; j < blockSize; j++) {
            var v = Math.abs(raw[start + j] || 0);
            if (v > max) max = v;
          }
          peaks.push(max);
        }
        callback(peaks);
      })
      .catch(function() { callback(null); });
  }

  /* Persistent top-left dot shown whenever a card has annotations —
     unlike the hover-only card bar, this stays visible so it's always
     clear at a glance which cards have markup on them. */
  function buildAnnotationDot(el, card) {
    var existing = el.querySelector('.card-annotation-dot');
    if (existing) existing.parentNode.removeChild(existing);
    if (card.annotations && card.annotations.length) {
      var dot = document.createElement('div');
      dot.className = 'card-annotation-dot';
      dot.title = 'Has annotations';
      dot.innerHTML = ANNOTATION_DOT_ICON;
      el.appendChild(dot);
    }
  }

  /* Live refresh for the annotation dot — card.annotations only gets
     populated at save/load time (see serialise/deserialise), so mid-
     session drawing or clearing needs to check annotate.js's actual
     live stroke list instead. Called from annotate.js after a stroke
     is added and after "Clear annotations". */
  function refreshAnnotationDot(id) {
    var el = document.getElementById(id);
    var card = cards[id];
    if (!el || !card) return;
    var count = (typeof KanvazAnnotate !== 'undefined' && KanvazAnnotate.getStrokes)
      ? KanvazAnnotate.getStrokes(id).length
      : (card.annotations || []).length;
    var existing = el.querySelector('.card-annotation-dot');
    if (count > 0 && !existing) {
      var dot = document.createElement('div');
      dot.className = 'card-annotation-dot';
      dot.title = 'Has annotations';
      dot.innerHTML = ANNOTATION_DOT_ICON;
      el.appendChild(dot);
    } else if (count === 0 && existing) {
      existing.parentNode.removeChild(existing);
    }
  }

  function addRelinkButton(el, card) {
    var bar = el.querySelector('.card-bar');
    if (!bar || bar.querySelector('.card-relink-btn')) return;
    var btn = document.createElement('button');
    btn.className = 'card-relink-btn';
    btn.textContent = 'Relink';
    btn.title = 'Choose a replacement file';
    btn.addEventListener('click', function(e) {
      e.stopPropagation();
      relinkCard(card.id);
    });
    bar.appendChild(btn);
  }

  function showMediaError(el, card, reason) {
    if (el.querySelector('.card-error-state')) return;
    el.classList.add('card-error');
    var box = document.createElement('div');
    box.className = 'card-error-state';
    var icon = document.createElement('div');
    icon.className = 'card-error-icon';
    icon.innerHTML = BROKEN_MEDIA_ICON;
    var name = document.createElement('div');
    name.className = 'card-error-name ellipsis';
    name.textContent = card.name || 'Missing media';
    box.appendChild(icon);
    box.appendChild(name);
    if (reason) {
      var reasonEl = document.createElement('div');
      reasonEl.className = 'card-error-reason';
      reasonEl.textContent = reason;
      box.appendChild(reasonEl);
    }
    el.appendChild(box);
    /* Relink still makes sense even for a codec failure, not just a
       moved/missing file — the user may have another take of the same
       clip already encoded as MP4/WebM sitting right next to this one. */
    addRelinkButton(el, card);
  }

  /* ── Relink — pick a replacement file for a card with missing/broken
     media (source file moved or deleted). Same load pipeline as
     drag-drop, just entered via a file dialog instead of a drop. ── */
  function relinkCard(id) {
    var card = cards[id];
    if (!card) return;
    KanvazBridge.openMediaDialog().then(function(p) {
      if (!p) return;
      var ext = p.split('.').pop().toLowerCase();
      var loader = KanvazMedia.MODEL_EXTS.indexOf(ext) !== -1 ? KanvazMedia.loadModelFromPath :
        (KanvazMedia.EXTERNAL_CONVERT_EXTS.indexOf(ext) !== -1 ? KanvazMedia.loadExternalModelFromPath : KanvazMedia.loadFromPath);
      loader(p, function(result, err) {
        if (err || !result) {
          KanvazUI.toast('Could not load replacement file', 'error');
          return;
        }
        if (result.type !== card.type) {
          KanvazUI.toast('Replacement must also be a ' + card.type + ' file', 'error');
          return;
        }
        card.dataUrl  = result.dataUrl;
        card.name     = result.name;
        card.path     = result.originalPath;
        card.naturalW = result.naturalW;
        card.naturalH = result.naturalH;
        if (result.type === 'model3d') card.modelFormat = result.modelFormat;

        var el = document.getElementById(id);
        if (el) {
          el.classList.remove('card-error');
          var errBox = el.querySelector('.card-error-state');
          if (errBox) errBox.parentNode.removeChild(errBox);
          var relinkBtn = el.querySelector('.card-relink-btn');
          if (relinkBtn) relinkBtn.parentNode.removeChild(relinkBtn);
          rebuildCardMedia(el, card);
          var nameEl = el.querySelector('.card-bar-title');
          if (nameEl) nameEl.textContent = card.name;
        }
        KanvazApp.markDirty();
        KanvazHistory.push();
        emitCardEvent('cardUpdate', card);
        KanvazUI.toast('Relinked', 'success');
      });
    }).catch(function(e) { console.warn('[Kanvaz] openMediaDialog IPC failed:', e); });
  }

  /* Rebuilds just the media portion of a card (image/gif/video/audio
     element + skeleton/error state) in place, leaving the card bar,
     tag bar, pin indicator and resize handles untouched. Used by
     Relink after a successful reload. */
  function rebuildCardMedia(el, card) {
    var KEEP_CLASSES = ['card-bar', 'tag-bar', 'card-pin', 'resize-handle'];
    var toRemove = [];
    for (var i = 0; i < el.children.length; i++) {
      var child = el.children[i];
      var keep = false;
      for (var k = 0; k < KEEP_CLASSES.length; k++) {
        if (child.classList.contains(KEEP_CLASSES[k])) { keep = true; break; }
      }
      if (!keep) toRemove.push(child);
    }
    for (var r = 0; r < toRemove.length; r++) el.removeChild(toRemove[r]);

    /* Relinking a 3D model swaps in a brand new viewer/scene — the old
       one's GPU resources (geometry/material/texture/renderer) must be
       released first or they leak exactly like a delete-without-dispose
       would. */
    disposeModel3D(card.id);

    if (card.type === 'image')        buildImageCard(el, card);
    else if (card.type === 'gif')     buildGifCard(el, card);
    else if (card.type === 'video')   buildVideoCard(el, card);
    else if (card.type === 'audio')   buildAudioCard(el, card);
    else if (card.type === 'model3d') buildModel3DCard(el, card);
  }

  /* ── Image card ── */

  function buildImageCard(el, card) {
    if (!card.objectFit) card.objectFit = 'cover';

    var skeleton = document.createElement('div');
    skeleton.className = 'card-skeleton';
    el.appendChild(skeleton);

    var img = document.createElement('img');
    img.src = card.dataUrl;
    img.style.cssText = 'display:block;width:100%;height:100%;object-fit:' + card.objectFit + ';pointer-events:none;filter:' + getFilterCss(card) + ';';

    img.onload = function() {
      removeSkeleton(el);
      var meta = el.querySelector('.card-bar-meta');
      if (meta) meta.textContent = 'Image · ' + img.naturalWidth + ' × ' + img.naturalHeight;
    };
    img.onerror = function() {
      removeSkeleton(el);
      img.style.display = 'none';
      showMediaError(el, card);
    };

    el.appendChild(img);
    buildAnnotationDot(el, card);
  }

  /* Non-destructive image/video adjustments — brightness/contrast/
     saturation, applied as a CSS filter() on the img/video element
     itself (never touching card.dataUrl), so they're free to change or
     reset at any time with no re-encoding and no quality loss. Filter
     functions at 100% are a visual no-op, so a card that's never had
     any of these touched renders identically whether the properties
     exist on it or not — safe to always emit the full filter string
     rather than conditionally omitting default terms. */
  function getFilterCss(card) {
    /* Loose null check on purpose: a deserialised card's missing fields
       come back as `null` (see buildFullCardRecord's whitelist), not
       `undefined` — a strict undefined check here would pass `null`
       straight into the CSS string as "brightness(null%)", a silently
       broken filter that visually does nothing but isn't the same as
       actually having no filter set. */
    var b = (card.adjustBrightness != null) ? card.adjustBrightness : 100;
    var c = (card.adjustContrast != null) ? card.adjustContrast : 100;
    var s = (card.adjustSaturate != null) ? card.adjustSaturate : 100;
    return 'brightness(' + b + '%) contrast(' + c + '%) saturate(' + s + '%)';
  }

  function setAdjustment(id, key, value) {
    var card = cards[id];
    if (!card) return;
    card[key] = value;
    var el = document.getElementById(id);
    if (el) {
      var media = el.querySelector('img, video');
      if (media) media.style.filter = getFilterCss(card);
    }
    KanvazApp.markDirty();
  }

  /* Layer visibility (Layers panel eye icon) — a persistent per-card
     `hidden` flag, distinct from Isolate View's transient
     `.card-isolated-hidden` class (that one clears itself on exit;
     this one is a real saved property, same class of thing as
     `pinned`). Applied via its own CSS class so the two mechanisms
     never fight over the same class name. */
  function toggleCardVisibility(id) {
    var card = cards[id];
    if (!card) return;
    card.hidden = !card.hidden;
    var el = document.getElementById(id);
    if (el) el.classList.toggle('card-layer-hidden', card.hidden);
    KanvazApp.markDirty();
    KanvazHistory.push();
    refreshLayersIfOpen();
  }

  /* ── Layers panel ── Sidebar tab (icon rail, sidepanel.js) listing
     every card in top-to-bottom z-order — closest thing this app has
     to Photoshop/Figma's Layers panel. Click a row to select that card
     (selecting no longer bumps z-order on its own — see below), an eye
     icon toggles `hidden` (a real persisted property), a lock icon
     reuses the existing `pinned` concept (a locked layer already means
     "can't be dragged" in this app, no need to invent a second flag
     that means the same thing). Rows are drag-to-reorder (see
     `reorderLayers`) and right-click-able (same context menu as an
     on-canvas card). */
  var draggedLayerId = null;

  function renderLayersInto(container) {
    container.innerHTML = '';

    var title = document.createElement('div');
    title.style.cssText = 'font-size:11px;color:var(--color-text-3);text-transform:uppercase;letter-spacing:0.06em;padding:14px 14px 8px;';
    title.textContent = 'Layers';
    container.appendChild(title);

    var allIds = getAllIds();
    if (!allIds.length) {
      var empty = document.createElement('div');
      empty.style.cssText = 'text-align:center;color:var(--color-text-3);font-size:12px;padding:24px 14px;line-height:1.5;';
      empty.textContent = 'No layers on this board yet.';
      container.appendChild(empty);
      return;
    }

    /* Topmost (highest z) first, matching Photoshop/Figma's own layer
       ordering convention. */
    allIds.sort(function(a, b) { return (cards[b].z || 0) - (cards[a].z || 0); });

    var list = document.createElement('div');
    list.style.cssText = 'padding:0 8px 14px;';

    var selectedIdsNow = getSelectedIds();
    var selectedSet = {};
    for (var s = 0; s < selectedIdsNow.length; s++) selectedSet[selectedIdsNow[s]] = true;

    for (var i = 0; i < allIds.length; i++) {
      (function(id) {
        var card = cards[id];
        if (!card) return;

        var row = document.createElement('div');
        row.style.cssText = 'display:flex;align-items:center;gap:8px;padding:6px 8px;border-radius:5px;cursor:pointer;font-family:var(--font-ui);font-size:12px;' +
          (selectedSet[id] ? 'background:var(--color-accent-bg);color:var(--color-text);' : 'color:var(--color-text-2);');
        row.onmouseenter = function() { if (!selectedSet[id]) row.style.background = 'var(--color-surface-2)'; };
        row.onmouseleave = function() { if (!selectedSet[id]) row.style.background = 'transparent'; };
        /* Real bug caught live (manual double-click did nothing): every
           click here rebuilds the whole list via renderLayersInto,
           including the FIRST of the two clicks that make up a native
           double-click. That destroys the original name span before
           the browser ever gets to fire its 'dblclick' event on it, so
           the rename handler below always found a detached element and
           silently bailed. e.detail is the browser's own click-count
           for this sequence (1 for a lone click, 2 for the second click
           of a double-click within the OS's double-click interval) —
           skipping the rebuild on detail > 1 leaves that second click's
           target (which the browser resolves fresh, same visual spot)
           intact for 'dblclick' to fire on right after. */
        row.onclick = function(e) {
          if (e.detail > 1) return;
          selectCard(id);
          renderLayersInto(container);
        };

        /* Right-click a layer row for the same context menu the canvas
           card itself uses (Rename, Pin, Bring to front/Send to back,
           Delete, etc.) — previously the row had no contextmenu handler
           at all, so right-clicking it did nothing.
           selectCard() below triggers emitSelectionChange() ->
           refreshLayersIfOpen(), which calls renderLayersInto() and
           rebuilds every row SYNCHRONOUSLY before this function even
           gets to the menu call — the exact same "rebuilt out from
           under me" hazard the double-click fix above exists for. Any
           `nameEl` captured in this closure is stale by then, so the
           Rename override looks its row's name span up fresh, by id,
           at click time instead of relying on one. */
        row.oncontextmenu = function(e) {
          e.preventDefault();
          e.stopPropagation();
          selectCard(id);
          if (typeof KanvazUI !== 'undefined') {
            KanvazUI.showCardContextMenu(e.clientX, e.clientY, card, function() {
              var freshContainer = document.getElementById('side-panel-content') || container;
              var freshNameEl = freshContainer.querySelector('[data-layer-name-for="' + id + '"]');
              if (freshNameEl) startLayerRowRename(id, freshNameEl, freshContainer);
            });
          }
        };

        /* Drag-to-reorder: dragging a row above/below another changes
           that card's z-order directly, mirroring Photoshop/Figma's own
           layers-list behavior. Selecting a row no longer bumps it to
           the front on its own (see the plain click handler above) —
           that was fighting this exact workflow, since clicking a card
           to inspect it before reordering would silently move it to the
           top first. */
        row.draggable = true;
        row.ondragstart = function(e) {
          draggedLayerId = id;
          e.dataTransfer.effectAllowed = 'move';
          row.style.opacity = '0.4';
        };
        row.ondragend = function() {
          row.style.opacity = '';
          draggedLayerId = null;
        };
        row.ondragover = function(e) {
          if (!draggedLayerId || draggedLayerId === id) return;
          e.preventDefault();
          e.dataTransfer.dropEffect = 'move';
          row.style.borderTop = '2px solid var(--color-accent)';
        };
        row.ondragleave = function() {
          row.style.borderTop = '';
        };
        row.ondrop = function(e) {
          e.preventDefault();
          row.style.borderTop = '';
          if (!draggedLayerId || draggedLayerId === id) return;
          var order = allIds.slice();
          var fromIdx = order.indexOf(draggedLayerId);
          if (fromIdx === -1) return;
          order.splice(fromIdx, 1);
          var toIdx = order.indexOf(id);
          if (toIdx === -1) return;
          order.splice(toIdx, 0, draggedLayerId);
          reorderLayers(order);
          renderLayersInto(container);
        };

        var nameEl = document.createElement('span');
        nameEl.style.cssText = 'flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
        /* Terminology audit fix: this used to build its own fallback
           label (charAt(0).toUpperCase() + slice(1)), which gives "Url"
           instead of "URL", "Gif" instead of "GIF", "Model3d" instead of
           "3D" — the exact display names the app already has, via
           getCardTypeLabel()/CARD_TYPE_LABELS above, just not reused
           here. */
        nameEl.textContent = (card.name && card.name.trim()) ? card.name : getCardTypeLabel(card);
        nameEl.title = 'Double-click to rename';
        nameEl.dataset.layerNameFor = id;
        nameEl.ondblclick = function(e) {
          e.stopPropagation();
          startLayerRowRename(id, nameEl, container);
        };
        row.appendChild(nameEl);

        /* Labeled "Pin"/"Unpin", not "Lock"/"Unlock" — this is the exact
           same `pinned` property the rest of the app already has a name
           for (right-click menu, the P shortcut, the Shortcuts overlay
           all say "Pin"). The lock icon is just a clear visual metaphor
           for what pinning does; the words shouldn't invent a second
           name for a concept that already has one. */
        /* Feather Icons (MIT License, see THIRD_PARTY_NOTICES.md) —
           individual paths copied inline, same pattern already used for
           every other icon in this app, rather than colored emoji glyphs
           that clash with the rest of the UI's flat line-icon look. */
        var lockBtn = document.createElement('span');
        lockBtn.title = card.pinned ? 'Unpin' : 'Pin';
        lockBtn.innerHTML = card.pinned
          ? '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>'
          : '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 9.9-1"/></svg>';
        lockBtn.style.cssText = 'cursor:pointer;line-height:0;color:var(--color-text-2);opacity:' + (card.pinned ? '1' : '0.45') + ';';
        lockBtn.onclick = function(e) {
          e.stopPropagation();
          togglePin(id);
          renderLayersInto(container);
        };
        row.appendChild(lockBtn);

        var eyeBtn = document.createElement('span');
        eyeBtn.title = card.hidden ? 'Show' : 'Hide';
        eyeBtn.innerHTML = card.hidden
          ? '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>'
          : '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>';
        eyeBtn.style.cssText = 'cursor:pointer;line-height:0;color:var(--color-text-2);opacity:' + (card.hidden ? '0.6' : '1') + ';';
        eyeBtn.onclick = function(e) {
          e.stopPropagation();
          toggleCardVisibility(id);
          renderLayersInto(container);
        };
        row.appendChild(eyeBtn);

        list.appendChild(row);
      })(allIds[i]);
    }

    container.appendChild(list);
  }

  /* Double-click a Layers row's name to rename inline — planned as
     follow-up work after the panel's first pass (v7.20.0), built now.
     Writes through updateCardData(id, {name: val}), the same single
     path startRenameCard() (the on-canvas card-bar rename) already
     uses — not a second, parallel rename mechanism — so a commit here
     fires the exact same 'cardUpdate' event and refreshLayersIfOpen()
     redraws the whole list with the new name for free. Mirrors
     startRenameCard()'s own event-guarding exactly (stop mousedown/
     click/dblclick/keydown from bubbling into the row's onclick, which
     would otherwise re-select/re-render mid-edit; Enter commits,
     Escape or an empty/unchanged value cancels). */
  function startLayerRowRename(id, nameEl, container) {
    var card = cards[id];
    if (!card || !nameEl.parentNode) return;
    var parent = nameEl.parentNode;

    var input = document.createElement('input');
    input.type = 'text';
    input.value = card.name || '';
    input.style.cssText = 'flex:1;min-width:0;background:var(--color-surface-2);border:1px solid var(--color-accent);border-radius:4px;color:var(--color-text);font-family:var(--font-ui);font-size:12px;padding:2px 6px;';

    parent.replaceChild(input, nameEl);
    input.focus();
    input.select();

    var done = false;
    function finish(commit) {
      if (done) return;
      done = true;
      var val = input.value.trim();
      if (commit && val && val !== card.name) {
        updateCardData(id, { name: val });
        return;
      }
      /* Cancelled, empty, or unchanged — updateCardData never ran (so
         refreshLayersIfOpen() never fired), and the input is still
         sitting in the live DOM. Just redraw the whole panel to put
         the plain name label back. */
      renderLayersInto(container);
    }

    input.addEventListener('mousedown', function(e) { e.stopPropagation(); });
    input.addEventListener('click',     function(e) { e.stopPropagation(); });
    input.addEventListener('dblclick',  function(e) { e.stopPropagation(); });
    input.addEventListener('keydown', function(e) {
      e.stopPropagation();
      if (e.key === 'Enter')  { e.preventDefault(); finish(true); }
      if (e.key === 'Escape') { e.preventDefault(); finish(false); }
    });
    input.addEventListener('blur', function() { finish(true); });
  }

  function refreshLayersIfOpen() {
    if (typeof KanvazSidePanel === 'undefined' || !KanvazSidePanel.isSectionOpen || !KanvazSidePanel.isSectionOpen('layers')) return;
    var container = document.getElementById('side-panel-content');
    if (container) renderLayersInto(container);
  }

  /* Toggle object-fit cover ↔ contain (right-click menu, image cards only) */
  function toggleObjectFit(id) {
    var card = cards[id];
    if (!card || card.type !== 'image') return;
    card.objectFit = (card.objectFit === 'contain') ? 'cover' : 'contain';
    var el = document.getElementById(id);
    if (el) {
      var img = el.querySelector('img');
      if (img) img.style.objectFit = card.objectFit;
    }
    KanvazApp.markDirty();
    KanvazHistory.push();
    emitCardEvent('cardUpdate', card);
  }

  /* ── GIF card ── */

  function buildGifCard(el, card) {
    var skeleton = document.createElement('div');
    skeleton.className = 'card-skeleton';
    el.appendChild(skeleton);

    var img = document.createElement('img');
    img.src = card.dataUrl;
    img.style.cssText = 'display:block;width:100%;height:calc(100% - 24px);object-fit:cover;cursor:pointer;filter:' + getFilterCss(card) + ';';
    img.title = 'Click to pause / resume';
    img._origSrc = card.dataUrl;
    img._paused = false;

    img.onload = function() {
      removeSkeleton(el);
      /* GIFs don't have any loop-duration data available anywhere in
         this codebase to show truthfully — a <img>'s naturalWidth/
         Height IS available for a GIF exactly like a static image, so
         that's what's shown here rather than fabricating a duration
         field with no real data behind it. */
      var meta = el.querySelector('.card-bar-meta');
      if (meta) meta.textContent = 'GIF · ' + img.naturalWidth + ' × ' + img.naturalHeight;
    };
    img.onerror = function() {
      removeSkeleton(el);
      img.style.display = 'none';
      showMediaError(el, card);
    };

    el.appendChild(img);

    /* Pause/resume toggle button — same action as clicking the image,
       just also reachable without hovering the exact frame. */
    var toggleBtn = document.createElement('button');
    toggleBtn.className = 'gif-toggle-btn';
    toggleBtn.innerHTML = PAUSE_ICON;
    toggleBtn.title = 'Play/Pause';
    el.appendChild(toggleBtn);

    /* Pause overlay — shown centered while paused, fades out on resume */
    var overlay = document.createElement('div');
    overlay.className = 'gif-pause-overlay';
    overlay.innerHTML = PLAY_ICON;
    el.appendChild(overlay);

    buildAnnotationDot(el, card);
  }

  /* ── Video card ── */

  function buildVideoCard(el, card) {
    var skeleton = document.createElement('div');
    skeleton.className = 'card-skeleton';
    el.appendChild(skeleton);

    var spinner = document.createElement('div');
    spinner.className = 'card-spinner';
    el.appendChild(spinner);

    var vid = document.createElement('video');
    vid.preload = 'auto';
    /* Defaults to muted (autoplay-friendly, no surprise audio on drop),
       but respects a previously-saved mute/unmute choice. */
    vid.muted = (card.muted !== undefined) ? card.muted : true;
    vid.loop = true;
    vid.playsInline = true;
    /* Height set by CSS (.card-video > video) using container-query-aware calc */
    vid.style.cssText = 'display:block;width:100%;object-fit:cover;pointer-events:none;filter:' + getFilterCss(card) + ';';

    /* Scrub bar — built before vid.src so we can reference it in handlers */
    var scrub = document.createElement('div');
    scrub.className = 'video-scrub';

    /* Play/pause button */
    var playBtn = document.createElement('button');
    playBtn.className = 'media-play-btn';
    playBtn.style.cssText = 'background:none;border:none;cursor:pointer;color:var(--color-text-2);padding:0;display:flex;align-items:center;';
    playBtn.innerHTML = PLAY_ICON; /* starts as play — video plays on loadeddata */
    playBtn.title = 'Play/Pause';

    /* Always-visible thin progress line — sits right above the card
       bar, unlike the full scrub UI (which only shows on hover). */
    var progressLine = document.createElement('div');
    progressLine.className = 'video-progress-line';
    var progressFill = document.createElement('div');
    progressFill.className = 'video-progress-fill';
    progressLine.appendChild(progressFill);

    /* Error handler — themed broken-media state, same as image/GIF */
    vid.onerror = function() {
      clearLoadingState(el);
      vid.style.display = 'none';
      scrub.style.display = 'none';
      progressLine.style.display = 'none';
      /* BUG fix: video data is embedded as a base64 data URL (see
         README — media never re-reads from disk after import), so
         "the file moved" can't be why this fired. MEDIA_ERR_SRC_NOT_
         SUPPORTED means Chromium just can't decode this codec/
         container — almost always MKV or AVI (documented Known
         Limitation). Say that plainly instead of showing the generic
         "Missing media" state, which wrongly implies Relink can fix it
         by pointing at the exact same unsupported file again. */
      var reason = null;
      if (vid.error && vid.error.code === MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED) {
        reason = 'Format not supported — try re-exporting as MP4 (H.264) or WebM.';
      }
      showMediaError(el, card, reason);
    };
    /* Only play after data is loaded — prevents corrupt partial display */
    vid.onloadeddata = function() {
      clearLoadingState(el);
      vid.playbackRate = card.playbackRate || 1;
      /* Bug fix: same benign-rejection risk as toggleVideoPlay() above
         — autoplaying immediately on load races especially easily with
         a user who's already clicked pause/deleted the card before the
         browser finishes starting it. */
      var playResult = vid.play();
      if (playResult && playResult.catch) {
        playResult.catch(function(e) {
          if (e && e.name !== 'AbortError') console.warn('[Kanvaz] media autoplay failed:', e.message);
        });
      }
      playBtn.innerHTML = PAUSE_ICON;
    };

    vid.onloadedmetadata = function() {
      var meta = el.querySelector('.card-bar-meta');
      if (meta && vid.duration) meta.textContent = 'Video · ' + KanvazMedia.formatTime(vid.duration);
    };

    vid.src = card.dataUrl;
    el.appendChild(vid);
    el.appendChild(progressLine);

    /* Scrub track */
    var track = document.createElement('div');
    track.className = 'scrub-bar';
    var fill = document.createElement('div');
    fill.className = 'scrub-fill';
    fill.style.width = '0%';
    track.appendChild(fill);
    var thumb = document.createElement('div');
    thumb.className = 'scrub-thumb';
    thumb.style.left = '0%';
    track.appendChild(thumb);

    /* Time display */
    var timeEl = document.createElement('span');
    timeEl.className = 'scrub-time';
    timeEl.textContent = '0:00';

    /* Mute button — icon/color reflects vid.muted's actual starting
       state above (default muted, or a restored unmuted preference)
       rather than always assuming muted. */
    var muteBtn = document.createElement('button');
    muteBtn.className = 'media-mute-btn';
    muteBtn.style.cssText = 'background:none;border:none;cursor:pointer;color:' +
      (vid.muted ? 'var(--color-text-3)' : 'var(--color-accent)') + ';padding:0;display:flex;align-items:center;';
    muteBtn.innerHTML = vid.muted ? MUTED_ICON : MUTE_ICON;
    muteBtn.title = 'Toggle mute';

    /* v6.x — frame-stepping + onion-skin (ArtDeck-inspired analysis
       tools). Frame duration is a fixed 1/30s approximation, not a true
       frame-boundary detection — HTML5 <video> has no reliable
       cross-browser way to query a container's actual frame rate or
       seek to an exact frame index, so this is a disclosed, deliberate
       approximation rather than something silently wrong. Good enough
       for "step through and check spacing/timing," not frame-accurate
       for variable-frame-rate footage. */
    var FRAME_DURATION = 1 / 30;
    var onionEnabled = false;
    var onionCanvas = null;

    function ensureOnionCanvas() {
      if (onionCanvas) return;
      onionCanvas = document.createElement('canvas');
      onionCanvas.className = 'video-onion-canvas';
      onionCanvas.style.cssText = 'position:absolute;top:0;left:0;pointer-events:none;';
      el.insertBefore(onionCanvas, progressLine);
    }

    function captureOnionGhost() {
      if (!vid.videoWidth) return; /* nothing decoded yet to ghost */
      ensureOnionCanvas();
      onionCanvas.width  = vid.clientWidth;
      onionCanvas.height = vid.clientHeight;
      var octx = onionCanvas.getContext('2d');
      octx.clearRect(0, 0, onionCanvas.width, onionCanvas.height);
      octx.globalAlpha = 0.4;
      octx.drawImage(vid, 0, 0, onionCanvas.width, onionCanvas.height);
    }

    function stepFrame(dir) {
      if (!vid.duration) return;
      vid.pause();
      playBtn.innerHTML = PLAY_ICON;
      if (onionEnabled) captureOnionGhost();
      vid.currentTime = Math.max(0, Math.min(vid.duration, vid.currentTime + dir * FRAME_DURATION));
    }

    var frameBackBtn = document.createElement('button');
    frameBackBtn.className = 'media-play-btn';
    frameBackBtn.style.cssText = 'background:none;border:none;cursor:pointer;color:var(--color-text-2);padding:0;display:flex;align-items:center;';
    frameBackBtn.innerHTML = FRAME_BACK_ICON;
    frameBackBtn.title = 'Step back one frame (~1/30s)';
    frameBackBtn.addEventListener('click', function(e) { e.stopPropagation(); stepFrame(-1); });
    frameBackBtn.addEventListener('mousedown', function(e) { e.stopPropagation(); });

    var frameForwardBtn = document.createElement('button');
    frameForwardBtn.className = 'media-play-btn';
    frameForwardBtn.style.cssText = 'background:none;border:none;cursor:pointer;color:var(--color-text-2);padding:0;display:flex;align-items:center;';
    frameForwardBtn.innerHTML = FRAME_FORWARD_ICON;
    frameForwardBtn.title = 'Step forward one frame (~1/30s)';
    frameForwardBtn.addEventListener('click', function(e) { e.stopPropagation(); stepFrame(1); });
    frameForwardBtn.addEventListener('mousedown', function(e) { e.stopPropagation(); });

    var onionBtn = document.createElement('button');
    onionBtn.className = 'media-play-btn';
    onionBtn.style.cssText = 'background:none;border:none;cursor:pointer;color:var(--color-text-2);padding:0;display:flex;align-items:center;';
    onionBtn.innerHTML = ONION_SKIN_ICON;
    onionBtn.title = 'Onion-skin: ghost the previous frame while stepping';
    onionBtn.addEventListener('click', function(e) {
      e.stopPropagation();
      onionEnabled = !onionEnabled;
      onionBtn.style.color = onionEnabled ? 'var(--color-accent)' : 'var(--color-text-2)';
      if (!onionEnabled && onionCanvas) {
        onionCanvas.getContext('2d').clearRect(0, 0, onionCanvas.width, onionCanvas.height);
      }
    });
    onionBtn.addEventListener('mousedown', function(e) { e.stopPropagation(); });

    var volumeSlider = buildVolumeSlider(vid, card);

    /* v8.x polish — expand to real browser fullscreen. requestFullscreen()
       on the <video> element itself (not the card) gives native
       fullscreen video chrome (play/pause/volume/seek) for free, rather
       than simulating a fullscreen view with custom CSS — the simpler,
       more robust choice, and consistent with how every other browser-
       based video player already does this. */
    var expandBtn = document.createElement('button');
    expandBtn.className = 'media-play-btn';
    expandBtn.style.cssText = 'background:none;border:none;cursor:pointer;color:var(--color-text-2);padding:0;display:flex;align-items:center;';
    expandBtn.innerHTML = EXPAND_ICON;
    expandBtn.title = 'Fullscreen';
    expandBtn.addEventListener('click', function(e) {
      e.stopPropagation();
      if (vid.requestFullscreen) vid.requestFullscreen();
    });
    expandBtn.addEventListener('mousedown', function(e) { e.stopPropagation(); });

    scrub.appendChild(playBtn);
    scrub.appendChild(frameBackBtn);
    scrub.appendChild(frameForwardBtn);
    scrub.appendChild(onionBtn);
    scrub.appendChild(track);
    scrub.appendChild(timeEl);
    scrub.appendChild(muteBtn);
    scrub.appendChild(volumeSlider);
    scrub.appendChild(expandBtn);
    el.appendChild(scrub);

    /* Update scrub on timeupdate — intrinsic to this video element,
       recreated and discarded together with it, not part of the
       delegation refactor. */
    vid.addEventListener('timeupdate', function() {
      if (!vid.duration) return;
      var pct = (vid.currentTime / vid.duration) * 100;
      fill.style.width = pct + '%';
      thumb.style.left = pct + '%';
      progressFill.style.width = pct + '%';
      timeEl.textContent = KanvazMedia.formatTime(vid.currentTime) + ' / ' + KanvazMedia.formatTime(vid.duration);
    });

    buildAnnotationDot(el, card);
  }

  /* Playback speed picker — same floating-panel pattern as the opacity
     picker, reached from the "Playback speed" context menu item. */
  function showSpeedPicker(id, x, y) {
    var existing = document.getElementById('speed-picker');
    if (existing) existing.parentNode.removeChild(existing);

    var card = cards[id];
    if (!card) return;
    var el = document.getElementById(id);
    var vid = el ? el.querySelector('video') : null;
    if (!vid) return;

    var current = card.playbackRate || 1;

    var picker = document.createElement('div');
    picker.id = 'speed-picker';
    picker.style.cssText = [
      'position:fixed',
      'left:' + x + 'px',
      'top:' + y + 'px',
      'background:var(--color-surface)',
      'border:1px solid var(--color-border-2)',
      'border-radius:8px',
      'padding:6px',
      'z-index:20001',
      'box-shadow:0 8px 24px rgba(0,0,0,0.6)',
      'display:flex',
      'gap:4px'
    ].join(';');

    var speeds = [0.5, 1, 2];
    for (var i = 0; i < speeds.length; i++) {
      (function(speed) {
        var btn = document.createElement('button');
        btn.className = 'speed-picker-btn' + (speed === current ? ' active' : '');
        btn.textContent = speed + '×';
        btn.addEventListener('click', function(e) {
          e.stopPropagation();
          card.playbackRate = speed;
          vid.playbackRate = speed;
          KanvazApp.markDirty();
          KanvazHistory.push();
          emitCardEvent('cardUpdate', card);
          if (picker.parentNode) picker.parentNode.removeChild(picker);
        });
        picker.appendChild(btn);
      })(speeds[i]);
    }

    document.body.appendChild(picker);

    setTimeout(function() {
      document.addEventListener('mousedown', function closePicker(e) {
        if (!picker.contains(e.target)) {
          if (picker.parentNode) picker.parentNode.removeChild(picker);
          document.removeEventListener('mousedown', closePicker);
        }
      });
    }, 50);
  }

  /* ── Audio card ── */

  function buildAudioCard(el, card) {
    /* Icon area — fills the card above the scrub bar + card bar.
       Height set by CSS (.audio-icon-area) using container-query-aware calc */
    var iconArea = document.createElement('div');
    iconArea.className = 'audio-icon-area';
    iconArea.innerHTML = [
      '<div class="audio-waveform"></div>',
      '<svg class="audio-icon-svg" viewBox="0 0 36 36" fill="none">',
        '<path d="M13 24V9.6L27 6v14.4" stroke="var(--color-accent)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>',
        '<circle cx="9" cy="24" r="4" stroke="var(--color-accent)" stroke-width="2"/>',
        '<circle cx="23" cy="20.4" r="4" stroke="var(--color-accent)" stroke-width="2"/>',
      '</svg>'
    ].join('');
    el.appendChild(iconArea);

    /* Best-effort — silently leaves the waveform empty if decoding
       fails, playback via <audio> below is unaffected either way. */
    generateWaveform(card.dataUrl, function(peaks) {
      if (!peaks) return;
      var wf = iconArea.querySelector('.audio-waveform');
      if (!wf) return;
      var bars = '';
      for (var i = 0; i < peaks.length; i++) {
        var h = Math.max(8, Math.round(peaks[i] * 100));
        bars += '<span style="height:' + h + '%"></span>';
      }
      wf.innerHTML = bars;
    });

    /* Audio element — hidden, playback only. Not autoplayed by default
       (multiple audio cards autoplaying at once would be unpleasant).
       Loop is opt-in via the scrub bar toggle, off by default. */
    var aud = document.createElement('audio');
    aud.src = card.dataUrl;
    aud.preload = 'metadata';
    aud.loop = !!card.audioLoop;
    /* Defaults to unmuted (audio cards are explicitly about hearing the
       sound), but respects a previously-saved mute/unmute choice —
       same shared toggleVideoMute() persists this for both card types. */
    aud.muted = (card.muted !== undefined) ? card.muted : false;
    aud.style.display = 'none';
    el.appendChild(aud);

    /* Pulse the icon while playing, stop when paused/ended */
    aud.addEventListener('play',  function() { el.classList.add('audio-playing'); });
    aud.addEventListener('pause', function() { el.classList.remove('audio-playing'); });

    aud.addEventListener('loadedmetadata', function() {
      var meta = el.querySelector('.card-bar-meta');
      if (meta && aud.duration) meta.textContent = 'Audio · ' + KanvazMedia.formatTime(aud.duration);
    });

    /* Scrub bar — always visible (no preview frame to hover-reveal it) */
    var scrub = document.createElement('div');
    scrub.className = 'audio-scrub';

    var playBtn = document.createElement('button');
    playBtn.className = 'media-play-btn';
    playBtn.style.cssText = 'background:none;border:none;cursor:pointer;color:var(--color-text-2);padding:0;display:flex;align-items:center;';
    playBtn.innerHTML = PLAY_ICON; /* audio does not autoplay */
    playBtn.title = 'Play/Pause';

    var track = document.createElement('div');
    track.className = 'scrub-bar';
    var fill = document.createElement('div');
    fill.className = 'scrub-fill';
    fill.style.width = '0%';
    track.appendChild(fill);
    var thumb = document.createElement('div');
    thumb.className = 'scrub-thumb';
    thumb.style.left = '0%';
    track.appendChild(thumb);

    var timeEl = document.createElement('span');
    timeEl.className = 'scrub-time';
    timeEl.textContent = '0:00';

    var muteBtn = document.createElement('button');
    muteBtn.className = 'media-mute-btn';
    muteBtn.style.cssText = 'background:none;border:none;cursor:pointer;color:' +
      (aud.muted ? 'var(--color-text-3)' : 'var(--color-accent)') + ';padding:0;display:flex;align-items:center;';
    muteBtn.innerHTML = aud.muted ? MUTED_ICON : MUTE_ICON;
    muteBtn.title = 'Toggle mute';

    var loopBtn = document.createElement('button');
    loopBtn.className = 'media-loop-btn' + (aud.loop ? ' active' : '');
    loopBtn.style.cssText = 'background:none;border:none;cursor:pointer;color:var(--color-text-3);padding:0;display:flex;align-items:center;';
    loopBtn.innerHTML = LOOP_ICON;
    loopBtn.title = 'Loop';

    var volumeSlider = buildVolumeSlider(aud, card);

    scrub.appendChild(playBtn);
    scrub.appendChild(track);
    scrub.appendChild(timeEl);
    scrub.appendChild(muteBtn);
    scrub.appendChild(volumeSlider);
    scrub.appendChild(loopBtn);
    el.appendChild(scrub);

    aud.addEventListener('timeupdate', function() {
      if (!aud.duration) return;
      var pct = (aud.currentTime / aud.duration) * 100;
      fill.style.width = pct + '%';
      thumb.style.left = pct + '%';
      timeEl.textContent = KanvazMedia.formatTime(aud.currentTime) + ' / ' + KanvazMedia.formatTime(aud.duration);
    });

    /* Reset to play icon when playback ends naturally (not looped) */
    aud.addEventListener('ended', function() {
      playBtn.innerHTML = PLAY_ICON;
    });
  }

  /* ── Note card ── */

  /* v5.2.0 — deliberately small: escape first, then a handful of
     line/inline substitutions. Not a spec-complete Markdown parser (no
     nested emphasis, no tables, no reference links) — this is a quick
     "make my note readable" preview, not a document authoring tool, and
     a bigger dependency for that is not worth pulling in. Escaping HTML
     first is what makes this safe to render via innerHTML: a note
     containing "<img onerror=...>" becomes inert text, never a live tag,
     before any markdown substitution ever sees it. */
  function escapeHtml(s) {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function noteMarkdownToHtml(text) {
    var lines = escapeHtml(text || '').split('\n');
    var html = '';
    var inList = false;
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];
      var heading = /^(#{1,3})\s+(.*)$/.exec(line);
      var listItem = /^[-*]\s+(.*)$/.exec(line);

      if (listItem) {
        if (!inList) { html += '<ul>'; inList = true; }
        html += '<li>' + inlineMarkdown(listItem[1]) + '</li>';
        continue;
      }
      if (inList) { html += '</ul>'; inList = false; }

      if (heading) {
        var level = heading[1].length + 2; /* h3..h5 — a note is a small card, not a document */
        html += '<h' + level + '>' + inlineMarkdown(heading[2]) + '</h' + level + '>';
      } else if (line.trim() === '') {
        html += '<br>';
      } else {
        html += '<p>' + inlineMarkdown(line) + '</p>';
      }
    }
    if (inList) html += '</ul>';
    return html;
  }

  function inlineMarkdown(s) {
    return s
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/(^|[^*])\*(?!\*)(.+?)\*(?!\*)/g, '$1<em>$2</em>')
      .replace(/`(.+?)`/g, '<code>$1</code>')
      .replace(/\[(.+?)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
  }

  function buildNoteCard(el, card) {
    var accent = document.createElement('div');
    accent.className = 'note-accent-bar';
    el.appendChild(accent);

    var previewToggle = document.createElement('button');
    previewToggle.className = 'note-preview-toggle';
    previewToggle.title = 'Toggle Markdown preview';
    previewToggle.textContent = 'M↓';

    var ta = document.createElement('textarea');
    ta.className = 'note-body';
    ta.placeholder = 'Note';
    ta.value = card.text || '';
    ta.style.cssText = 'width:100%;height:100%;padding-bottom:28px;';

    var preview = document.createElement('div');
    preview.className = 'note-preview';

    /* DOM-only view state, deliberately not saved to the card/file —
       this is "how am I looking at this text right now", not a property
       of the note itself, same category as which card is selected. */
    var previewing = false;

    function renderPreview() {
      preview.innerHTML = noteMarkdownToHtml(card.text || '');
    }

    function setPreviewing(on) {
      previewing = on;
      if (on) renderPreview();
      ta.style.display = on ? 'none' : '';
      preview.style.display = on ? '' : 'none';
      previewToggle.classList.toggle('active', on);
    }

    previewToggle.addEventListener('click', function(e) {
      e.stopPropagation();
      setPreviewing(!previewing);
    });
    previewToggle.addEventListener('mousedown', function(e) { e.stopPropagation(); });

    ta.addEventListener('input', function() {
      card.text = ta.value;
      KanvazApp.markDirty();

      var count = ta.value.length;
      var countEl = el.querySelector('.card-bar-meta');
      if (countEl) countEl.textContent = count + (count === 1 ? ' char' : ' chars');

      /* Live preview of the note text as the card bar "filename",
         falling back to the card's actual name once emptied again. */
      var nameEl = el.querySelector('.card-bar-title');
      if (nameEl) {
        var preview2 = ta.value.trim();
        nameEl.textContent = preview2
          ? (preview2.length > 20 ? preview2.slice(0, 20) + '…' : preview2)
          : (card.name || 'Note');
      }
    });

    ta.addEventListener('blur', function() {
      KanvazHistory.push();
      emitCardEvent('cardUpdate', card);
    });

    preview.style.display = 'none';
    preview.addEventListener('mousedown', function(e) { e.stopPropagation(); });

    el.appendChild(previewToggle);
    el.appendChild(ta);
    el.appendChild(preview);
  }

  /* ── Bare text label ── */

  function buildTextCard(el, card) {
    var ta = document.createElement('textarea');
    ta.className = 'text-body';
    ta.placeholder = 'Text';
    ta.value = card.text || '';
    ta.style.cssText = 'width:100%;height:100%;';

    ta.addEventListener('input', function() {
      card.text = ta.value;
      KanvazApp.markDirty();
    });

    ta.addEventListener('blur', function() {
      KanvazHistory.push();
      emitCardEvent('cardUpdate', card);
    });

    el.appendChild(ta);
  }

  /* ── Color swatch card ── */

  function buildColorCard(el, card) {
    var hex = card.color || '#9D7FFF';
    var format = card.colorFormat || 'hex'; /* 'hex' | 'rgb' | 'hsl' */

    var swatch = document.createElement('div');
    swatch.className = 'color-swatch';
    swatch.style.background = hex;

    /* Contrast checker — white/black "Aa" samples so the user can judge
       text-on-swatch legibility at a glance without leaving the canvas. */
    var contrast = document.createElement('div');
    contrast.className = 'color-contrast';
    contrast.innerHTML = '<span class="contrast-white">Aa</span><span class="contrast-black">Aa</span>';
    swatch.appendChild(contrast);

    var labelRow = document.createElement('div');
    labelRow.className = 'color-label-row';

    var label = document.createElement('div');
    label.className = 'color-label';
    label.title = 'Click to switch hex / rgb / hsl';
    label.textContent = formatColorString(hex, format);

    var copyBtn = document.createElement('button');
    copyBtn.className = 'color-copy-btn';
    copyBtn.title = 'Copy hex to clipboard';
    copyBtn.innerHTML = COPY_ICON;

    /* Click the label to cycle display format — hex ↔ rgb ↔ hsl */
    label.addEventListener('click', function(e) {
      if (el.dataset.justDragged) { delete el.dataset.justDragged; return; }
      e.stopPropagation();
      format = (format === 'hex') ? 'rgb' : (format === 'rgb' ? 'hsl' : 'hex');
      card.colorFormat = format;
      label.textContent = formatColorString(hex, format);
      KanvazApp.markDirty();
    });

    /* v5.2.0 — palette mode: a small strip of saved swatches per card,
       so a color card can hold "this project's palette" instead of just
       one color. Shared with the native-picker flow below so clicking a
       palette chip and dragging the OS color picker commit the exact
       same way (dirty/history/event/bar-badge all in one place). */
    function applyColorVisual(newColor) {
      hex = newColor;
      swatch.style.background = newColor;
      label.textContent = formatColorString(hex, format);
      var barName = el.querySelector('.card-bar-title');
      if (barName) barName.textContent = newColor;
      var barSwatch = el.querySelector('.card-bar-color-swatch');
      if (barSwatch) barSwatch.style.background = newColor;
    }

    function commitColorChange(newColor) {
      card.color = newColor;
      card.name  = newColor;
      applyColorVisual(newColor);
      KanvazApp.markDirty();
      KanvazHistory.push();
      emitCardEvent('cardUpdate', card);
    }

    var paletteStrip = document.createElement('div');
    paletteStrip.className = 'color-palette-strip';
    paletteStrip.addEventListener('mousedown', function(e) { e.stopPropagation(); });

    function renderPalette() {
      paletteStrip.innerHTML = '';
      var palette = card.palette || [];
      for (var i = 0; i < palette.length; i++) {
        (function(swatchHex, idx) {
          var chip = document.createElement('div');
          chip.className = 'color-palette-chip';
          chip.style.background = swatchHex;
          chip.title = swatchHex.toUpperCase() + ' — click to use, right-click to remove';
          chip.addEventListener('click', function(e) {
            e.stopPropagation();
            if (el.dataset.justDragged) { delete el.dataset.justDragged; return; }
            commitColorChange(swatchHex);
          });
          chip.addEventListener('contextmenu', function(e) {
            e.preventDefault();
            e.stopPropagation();
            card.palette.splice(idx, 1);
            renderPalette();
            KanvazApp.markDirty();
            KanvazHistory.push();
            emitCardEvent('cardUpdate', card);
          });
          paletteStrip.appendChild(chip);
        })(palette[i], i);
      }

      var addBtn = document.createElement('button');
      addBtn.className = 'color-palette-add';
      addBtn.title = "Save this card's current color to its palette";
      addBtn.textContent = '+';
      addBtn.addEventListener('click', function(e) {
        e.stopPropagation();
        if (el.dataset.justDragged) { delete el.dataset.justDragged; return; }
        if (!card.palette) card.palette = [];
        if (card.palette.indexOf(hex) === -1) {
          card.palette.push(hex);
          renderPalette();
          KanvazApp.markDirty();
          KanvazHistory.push();
          emitCardEvent('cardUpdate', card);
        }
      });
      paletteStrip.appendChild(addBtn);
    }
    renderPalette();

    /* Copy button always copies the hex value, regardless of what
       format is currently displayed — hex is the portable/pasteable one. */
    copyBtn.addEventListener('click', function(e) {
      if (el.dataset.justDragged) { delete el.dataset.justDragged; return; }
      e.stopPropagation();
      var toCopy = hex.toUpperCase();
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(toCopy).then(function() {
          if (typeof KanvazUI !== 'undefined') KanvazUI.toast('Copied ' + toCopy, 'success');
        }).catch(function() {
          if (typeof KanvazUI !== 'undefined') KanvazUI.toast('Could not copy to clipboard', 'error');
        });
      }
    });

    labelRow.appendChild(label);
    labelRow.appendChild(copyBtn);

    /* Click swatch → open Kanvaz's own color picker (colorpicker.js),
       replacing the native OS/Chromium dialog this used to open via a
       hidden <input type="color"> proxy — same on-screen anchoring
       problem class the annotation and 3D-card pickers had, solved
       once for all three by not depending on a native popup at all. */
    swatch.addEventListener('click', function(e) {
      if (el.dataset.justDragged) { delete el.dataset.justDragged; return; }
      e.stopPropagation();
      var swatchRect = swatch.getBoundingClientRect();
      KanvazColorPicker.open(swatchRect.right + 8, swatchRect.top, hex, {
        onChange: function(newColor) {
          card.color = newColor;
          card.name  = newColor;
          applyColorVisual(newColor);
          KanvazApp.markDirty();
        },
        onCommit: function() {
          KanvazHistory.push();
          emitCardEvent('cardUpdate', card);
        }
      });
    });

    el.appendChild(swatch);
    el.appendChild(labelRow);
    el.appendChild(paletteStrip);
  }

  /* ── URL reference card ── */

  var LINK_ICON = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M6.5 9.5a3 3 0 0 0 4.24 0l2-2a3 3 0 0 0-4.24-4.24l-1 1"/><path d="M9.5 6.5a3 3 0 0 0-4.24 0l-2 2a3 3 0 0 0 4.24 4.24l1-1"/></svg>';
  var OPEN_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>';
  var PREVIEW_ICON = '<svg viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M1 7s2.2-4 6-4 6 4 6 4-2.2 4-6 4-6-4-6-4z"/><circle cx="7" cy="7" r="1.6"/></svg>';

  /* v5.0.0 — the one deliberate exception to "Kanvaz makes zero background
     network calls" (see SECURITY.md), and it's still opt-in per card, not
     silent: the fetch only ever happens when the user clicks the preview
     button below, never on paste/type/load. A previously-fetched preview
     is stored on the card (card.urlPreview) and re-rendered from that
     saved data on every future load — no re-fetch, no live remote <img>
     reference that could phone home again just by opening the board. */
  function buildUrlCard(el, card) {
    var accent = document.createElement('div');
    accent.className = 'url-accent-bar';
    accent.innerHTML = LINK_ICON;
    el.appendChild(accent);

    var body = document.createElement('div');
    body.className = 'url-body';

    var input = document.createElement('input');
    input.type = 'text';
    input.className = 'url-input';
    input.placeholder = 'https://…';
    input.value = card.url || '';
    input.spellcheck = false;

    var openBtn = document.createElement('button');
    openBtn.className = 'url-open-btn';
    openBtn.innerHTML = OPEN_ICON;
    openBtn.title = 'Open in your default browser';

    var previewBtn = document.createElement('button');
    previewBtn.className = 'url-open-btn';
    previewBtn.innerHTML = PREVIEW_ICON;
    previewBtn.title = 'Fetch a title/thumbnail preview from this link (one-time network request)';

    var previewArea = document.createElement('div');
    previewArea.className = 'url-preview';

    function renderPreview() {
      var p = card.urlPreview;
      if (!p || (!p.title && !p.image)) {
        previewArea.style.display = 'none';
        el.classList.remove('has-preview');
        previewArea.innerHTML = '';
        return;
      }
      el.classList.add('has-preview');
      previewArea.style.display = '';
      previewArea.innerHTML = '';
      if (p.image) {
        var img = document.createElement('img');
        img.className = 'url-preview-thumb';
        img.src = p.image;
        img.alt = '';
        previewArea.appendChild(img);
      }
      if (p.title) {
        var titleEl = document.createElement('div');
        titleEl.className = 'url-preview-title';
        titleEl.textContent = p.title;
        previewArea.appendChild(titleEl);
      }
    }

    function updateOpenState() {
      var has = !!(card.url && card.url.trim());
      openBtn.style.display    = has ? '' : 'none';
      previewBtn.style.display = has ? '' : 'none';
    }
    updateOpenState();
    renderPreview();

    function updateBarName() {
      var barName = el.querySelector('.card-bar-title');
      if (!barName) return;
      var v = (card.url || '').trim();
      barName.textContent = v
        ? (v.length > 28 ? v.slice(0, 28) + '…' : v)
        : (card.name || 'URL reference');
    }

    input.addEventListener('input', function() {
      card.url = input.value;
      KanvazApp.markDirty();
      updateOpenState();
      updateBarName();
    });

    input.addEventListener('blur', function() {
      if (el.dataset.justDragged) { delete el.dataset.justDragged; return; }
      KanvazHistory.push();
      emitCardEvent('cardUpdate', card);
    });

    /* mousedown on the input must not start a card drag — same pattern
       as tag inputs and other in-card text fields. */
    input.addEventListener('mousedown', function(e) { e.stopPropagation(); });

    openBtn.addEventListener('click', function(e) {
      e.stopPropagation();
      if (el.dataset.justDragged) { delete el.dataset.justDragged; return; }
      var raw = (card.url || '').trim();
      if (!raw) return;
      var target = /^https?:\/\//i.test(raw) ? raw : 'https://' + raw;
      KanvazBridge.openExternal(target);
    });
    openBtn.addEventListener('mousedown', function(e) { e.stopPropagation(); });

    previewBtn.addEventListener('click', function(e) {
      e.stopPropagation();
      if (el.dataset.justDragged) { delete el.dataset.justDragged; return; }
      var raw = (card.url || '').trim();
      if (!raw || previewBtn.disabled) return;
      previewBtn.disabled = true;
      previewBtn.classList.add('loading');
      KanvazBridge.fetchUrlPreview(raw).then(function(res) {
        previewBtn.disabled = false;
        previewBtn.classList.remove('loading');
        if (!res || !res.ok) {
          KanvazUI.toast((res && res.error) ? 'Preview failed: ' + res.error : 'Preview failed', 'error');
          return;
        }
        if (!res.title && !res.image) {
          KanvazUI.toast('No preview data found for this link');
          return;
        }
        card.urlPreview = { title: res.title || null, image: res.image || null };
        renderPreview();
        KanvazApp.markDirty();
        KanvazHistory.push();
        emitCardEvent('cardUpdate', card);
      }).catch(function(e) {
        previewBtn.disabled = false;
        previewBtn.classList.remove('loading');
        KanvazUI.toast('Preview failed: ' + e.message, 'error');
      });
    });
    previewBtn.addEventListener('mousedown', function(e) { e.stopPropagation(); });

    body.appendChild(input);
    body.appendChild(previewBtn);
    body.appendChild(openBtn);
    el.appendChild(body);
    el.appendChild(previewArea);
    updateBarName();
  }

  /* ── File reference card ── */

  var FOLDER_ICON = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M2 4.5a1 1 0 0 1 1-1h3l1.5 1.5H13a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1v-7.5z"/></svg>';
  var CHANGE_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>';

  /* v5.0.0 — a "file" card used to always show the same flat folder icon
     regardless of what it actually pointed at. A shared document-shaped
     base (page + folded corner) with a short extension-derived label
     stamped on it reads as a real per-type preview without needing a
     different SVG per format — same idea as a Finder/Explorer file icon.
     Purely local: derived from the path string only, no file read. */
  var FILE_ICON_BASE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>';
  var FILE_EXT_GROUPS = {
    pdf:  ['pdf'],
    zip:  ['zip', 'rar', '7z', 'tar', 'gz'],
    doc:  ['doc', 'docx', 'rtf', 'odt'],
    xls:  ['xls', 'xlsx', 'csv', 'ods'],
    ppt:  ['ppt', 'pptx', 'odp'],
    code: ['js', 'ts', 'py', 'json', 'html', 'css', 'c', 'cpp', 'rs', 'go', 'java'],
    text: ['txt', 'md']
  };

  function fileIconLabel(path) {
    var m = /\.([a-z0-9]+)$/i.exec((path || '').trim());
    var ext = m ? m[1].toLowerCase() : '';
    if (!ext) return null;
    for (var group in FILE_EXT_GROUPS) {
      if (FILE_EXT_GROUPS[group].indexOf(ext) !== -1) {
        return group === 'code' || group === 'text' ? ext.slice(0, 4).toUpperCase() : group.toUpperCase();
      }
    }
    return ext.length <= 4 ? ext.toUpperCase() : null;
  }

  /* v7.x — real scroll/zoom PDF preview, right inside the resizable
     file-reference card. Uses pdfjs-dist (Apache-2.0, Mozilla), vendored
     as two plain files in src/vendor/pdfjs/ rather than pulled in as an
     npm dependency electron-builder would bundle whole (the full
     package is ~35MB of locale/cmap/demo-viewer files this app never
     uses; the actual renderer needs just the two runtime files, ~1.7MB
     total — see THIRD_PARTY_NOTICES.md for the attribution).

     Deliberately does NOT go through media-load's IPC path (that one
     returns a data: URL meant to be EMBEDDED into the card forever) —
     a file-reference card's whole point is pointing at a file without
     embedding it, so this re-reads the PDF's bytes from disk fresh on
     every render via its own pdf-read-bytes IPC call and never persists
     what it read. Same disclosed limitation as every other file-ref
     card: if the file moves, the preview breaks until re-pointed. */
  function isPdfPath(p) {
    return /\.pdf$/i.test((p || '').trim());
  }

  /* Direct feedback: "any image reference card should show the image
     itself" — a file-ref card pointing at an image showed only the
     generic file icon, same as a .zip or .docx would. Same extension
     list main.js's 'media-load' IPC handler already allows for a real
     (embedded) image card — reusing it here keeps "which files count as
     an image" defined in exactly one place in spirit, even though this
     path calls loadMedia() fresh per render rather than embedding. */
  function isImagePath(p) {
    return /\.(jpe?g|png|gif|bmp|webp)$/i.test((p || '').trim());
  }

  /* Electron's bundled Chromium lags a couple of years behind the
     absolute newest JS engine features by design (this project doesn't
     chase every Electron point release) — pdfjs-dist's own "legacy"
     build already backs off some of the newest syntax, but still
     assumes `Promise.withResolvers` (Chrome 119+) exists. Rather than
     chase an ever-older pdfjs-dist version hoping to find one with zero
     assumptions beyond this runtime's actual baseline, polyfill the one
     specific gap directly — a five-line, spec-accurate implementation,
     not a shim pretending to be something bigger. */
  if (typeof Promise.withResolvers !== 'function') {
    Promise.withResolvers = function() {
      var resolve, reject;
      var promise = new Promise(function(res, rej) { resolve = res; reject = rej; });
      return { promise: promise, resolve: resolve, reject: reject };
    };
  }

  var pdfjsLoadPromise = null;
  function loadPdfJs() {
    if (!pdfjsLoadPromise) {
      pdfjsLoadPromise = import('./vendor/pdfjs/pdf.min.mjs').then(function(lib) {
        /* Points at a thin wrapper, not pdf.worker.min.mjs directly —
           the Promise.withResolvers polyfill above only patches THIS
           (main) thread's global scope; a Worker gets its own separate
           globals and needs the exact same patch applied inside it. */
        lib.GlobalWorkerOptions.workerSrc = './vendor/pdfjs/pdf.worker.wrapper.mjs';
        return lib;
      });
    }
    return pdfjsLoadPromise;
  }

  function base64ToUint8Array(base64) {
    var binary = atob(base64);
    var bytes = new Uint8Array(binary.length);
    for (var i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }

  /* Card id -> pdf.js document instance, so removeCardCore()/clearAll()/
     the "Change file" re-point-away-from-PDF path can .destroy() it.
     Audit fix: this didn't exist before — a PDF preview's pdf.js document
     (which owns its own decoded-page cache and, for the Worker build,
     a live Worker thread) was never released on delete, a real memory
     leak matching the same class of bug already fixed for video/audio
     decoders in removeCardCore/clearAll. */
  var pdfPreviewDocs = {};

  function disposePdfPreview(id) {
    var doc = pdfPreviewDocs[id];
    if (!doc) return;
    delete pdfPreviewDocs[id];
    try { doc.destroy(); } catch (e) { console.warn('[Kanvaz] pdf.js document dispose failed:', e); }
  }

  function buildPdfPreview(el, card) {
    var wrap = document.createElement('div');
    wrap.className = 'pdf-preview';

    var scrollArea = document.createElement('div');
    scrollArea.className = 'pdf-scroll-area';
    /* Scrolling/zooming INSIDE the preview must not also pan/zoom the
       whole board underneath it — the world canvas listens for wheel
       globally, same reason note-card textareas already have to guard
       their own scroll interactions. */
    scrollArea.addEventListener('wheel', function(e) { e.stopPropagation(); });
    scrollArea.addEventListener('mousedown', function(e) { e.stopPropagation(); });

    var canvas = document.createElement('canvas');
    scrollArea.appendChild(canvas);
    wrap.appendChild(scrollArea);

    var statusEl = document.createElement('div');
    statusEl.className = 'pdf-status';
    statusEl.textContent = 'Loading PDF…';
    scrollArea.appendChild(statusEl);

    var toolbar = document.createElement('div');
    toolbar.className = 'pdf-toolbar';

    function toolBtn(svg, title) {
      var b = document.createElement('button');
      b.className = 'pdf-toolbar-btn';
      b.innerHTML = svg;
      b.title = title;
      b.addEventListener('mousedown', function(e) { e.stopPropagation(); });
      return b;
    }

    var prevBtn = toolBtn(FRAME_BACK_ICON, 'Previous page');
    var pageLabel = document.createElement('span');
    pageLabel.className = 'pdf-page-label';
    pageLabel.textContent = '–';
    var nextBtn = toolBtn(FRAME_FORWARD_ICON, 'Next page');
    var zoomOutBtn = toolBtn('<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4"><circle cx="7" cy="7" r="5"/><line x1="4.5" y1="7" x2="9.5" y2="7" stroke-linecap="round"/><line x1="11" y1="11" x2="14" y2="14" stroke-linecap="round"/></svg>', 'Zoom out');
    var zoomInBtn = toolBtn('<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4"><circle cx="7" cy="7" r="5"/><line x1="4.5" y1="7" x2="9.5" y2="7" stroke-linecap="round"/><line x1="7" y1="4.5" x2="7" y2="9.5" stroke-linecap="round"/><line x1="11" y1="11" x2="14" y2="14" stroke-linecap="round"/></svg>', 'Zoom in');

    toolbar.appendChild(prevBtn);
    toolbar.appendChild(pageLabel);
    toolbar.appendChild(nextBtn);
    toolbar.appendChild(zoomOutBtn);
    toolbar.appendChild(zoomInBtn);
    wrap.appendChild(toolbar);

    el.appendChild(wrap);

    var state = {
      doc: null,
      page: (card.pdfPage && card.pdfPage >= 1) ? card.pdfPage : 1,
      zoom: card.pdfZoom || 1,
      numPages: 0
    };

    function renderPage() {
      if (!state.doc) return;
      state.doc.getPage(state.page).then(function(page) {
        var viewport = page.getViewport({ scale: state.zoom });
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        var ctx = canvas.getContext('2d');
        page.render({ canvasContext: ctx, viewport: viewport });
        pageLabel.textContent = state.page + ' / ' + state.numPages;
        prevBtn.disabled = state.page <= 1;
        nextBtn.disabled = state.page >= state.numPages;
      }).catch(function(e) {
        statusEl.textContent = 'Could not render page: ' + e.message;
        statusEl.style.display = '';
      });
    }

    prevBtn.onclick = function() {
      if (state.page <= 1) return;
      state.page--;
      card.pdfPage = state.page;
      KanvazApp.markDirty();
      renderPage();
    };
    nextBtn.onclick = function() {
      if (state.page >= state.numPages) return;
      state.page++;
      card.pdfPage = state.page;
      KanvazApp.markDirty();
      renderPage();
    };
    zoomInBtn.onclick = function() {
      state.zoom = Math.min(4, state.zoom + 0.25);
      card.pdfZoom = state.zoom;
      KanvazApp.markDirty();
      renderPage();
    };
    zoomOutBtn.onclick = function() {
      state.zoom = Math.max(0.25, state.zoom - 0.25);
      card.pdfZoom = state.zoom;
      KanvazApp.markDirty();
      renderPage();
    };

    if (!card.path) {
      statusEl.textContent = 'No file path set for this card.';
      return;
    }

    KanvazBridge.readPdfBytes(card.path).then(function(res) {
      if (!res || !res.ok) {
        statusEl.textContent = 'Could not read PDF: ' + ((res && res.error) || 'unknown error');
        return Promise.reject(new Error('read failed'));
      }
      var bytes = base64ToUint8Array(res.base64);
      return loadPdfJs().then(function(lib) {
        return lib.getDocument({ data: bytes }).promise;
      });
    }).then(function(doc) {
      if (!document.body.contains(el)) { doc.destroy(); return; } /* card deleted while loading */
      state.doc = doc;
      pdfPreviewDocs[card.id] = doc;
      state.numPages = doc.numPages;
      if (state.page > state.numPages) state.page = 1;
      statusEl.style.display = 'none';
      renderPage();
    }).catch(function(e) {
      if (statusEl.style.display !== 'none') {
        statusEl.textContent = statusEl.textContent.indexOf('Could not') === 0 ? statusEl.textContent : ('Could not load PDF: ' + e.message);
      }
    });
  }

  /* Real inline preview for a file-ref card pointing at an image —
     mirrors buildPdfPreview's own disclosed limitation exactly: reads
     the file fresh via KanvazBridge.loadMedia() on every render and
     never persists the result onto card.dataUrl. A file reference
     stays a reference, not an embed — if the file moves, the preview
     breaks until re-pointed via Change, same as PDF. No disposal
     function needed here (unlike PDF's pdf.js document handle) since
     an <img> with a data: URL is just a DOM node + a string, garbage
     collected normally once the card element is removed. */
  function buildFileImagePreview(el, card) {
    var wrap = document.createElement('div');
    wrap.className = 'file-image-preview';

    var statusEl = document.createElement('div');
    statusEl.className = 'pdf-status';
    statusEl.textContent = 'Loading…';
    wrap.appendChild(statusEl);

    var img = document.createElement('img');
    img.style.display = 'none';
    wrap.appendChild(img);

    el.appendChild(wrap);

    if (typeof KanvazBridge === 'undefined' || !KanvazBridge.loadMedia) return;
    KanvazBridge.loadMedia(card.path).then(function(res) {
      if (!document.body.contains(el)) return; /* card deleted while loading */
      if (!res || !res.ok || !res.dataUrl) {
        statusEl.textContent = 'Could not load image' + (res && res.error ? ': ' + res.error : '');
        return;
      }
      img.src = res.dataUrl;
      img.onload = function() { statusEl.style.display = 'none'; img.style.display = ''; };
      img.onerror = function() { statusEl.textContent = 'Could not load image'; };
    }).catch(function(e) {
      if (!document.body.contains(el)) return;
      statusEl.textContent = 'Could not load image: ' + e.message;
    });
  }

  function buildFileRefCard(el, card) {
    var accent = document.createElement('div');
    accent.className = 'url-accent-bar file-type-icon';
    accent.innerHTML = FILE_ICON_BASE;

    function updateIcon() {
      var label = fileIconLabel(card.path);
      var existingTag = accent.querySelector('.file-type-tag');
      if (existingTag) existingTag.remove();
      if (label) {
        var tag = document.createElement('span');
        tag.className = 'file-type-tag';
        tag.textContent = label;
        accent.appendChild(tag);
      }
    }

    updateIcon();
    el.appendChild(accent);

    /* v7.x — a .pdf gets a real in-card scroll/zoom preview between the
       accent bar and the label/button row below, which stays unchanged
       for every file type including PDF (Open/Change both still make
       sense for a PDF reference exactly like any other file). The
       modifier class switches .card-file's default "center a compact
       icon+label" layout to "fill the resizable card with the preview,
       label row pinned at the bottom" — scoped to this one card so
       every other file-ref card's compact look is untouched. */
    if (isPdfPath(card.path)) {
      el.classList.add('has-file-preview');
      buildPdfPreview(el, card);
    } else if (isImagePath(card.path)) {
      el.classList.add('has-file-preview');
      buildFileImagePreview(el, card);
    }

    var body = document.createElement('div');
    body.className = 'url-body';

    var label = document.createElement('span');
    label.className = 'url-label ellipsis';
    label.title = card.path || '';
    label.textContent = card.name || 'File reference';

    var openBtn = document.createElement('button');
    openBtn.className = 'url-open-btn';
    openBtn.innerHTML = OPEN_ICON;
    openBtn.title = 'Open with your default app for this file type';
    openBtn.addEventListener('click', function(e) {
      e.stopPropagation();
      if (el.dataset.justDragged) { delete el.dataset.justDragged; return; }
      if (!card.path) return;
      KanvazBridge.openPath(card.path).then(function(err) {
        if (err) KanvazUI.toast(err, 'error');
      });
    });
    openBtn.addEventListener('mousedown', function(e) { e.stopPropagation(); });

    var changeBtn = document.createElement('button');
    changeBtn.className = 'url-open-btn';
    changeBtn.innerHTML = CHANGE_ICON;
    changeBtn.title = 'Point this card at a different file';
    changeBtn.addEventListener('click', function(e) {
      e.stopPropagation();
      if (el.dataset.justDragged) { delete el.dataset.justDragged; return; }
      /* buildFileRefCard() is only ever reached via renderCard()'s
         card.type === 'file' branch — a 'pdf' card.type was a ghost
         registry entry with no creation path, now removed (see
         reference-types.js), so this was permanently dead code. No
         extension filter for a generic file reference. */
      var ext = null;
      KanvazBridge.openRefFileDialog(ext).then(function(p) {
        if (!p) return;
        card.path = p;
        card.name = basenameOf(p);
        label.textContent = card.name;
        label.title = card.path;
        updateIcon();
        var barName = el.querySelector('.card-bar-title');
        if (barName) barName.textContent = card.name;

        /* v7.x — re-point may cross the PDF/image/plain-file lines: add,
           remove, or rebuild the in-card preview to match, rather than
           leaving a stale preview (or a missing one) until the next
           full reload.
           Audit fix: re-pointing from one PDF to a DIFFERENT PDF used to
           hit neither branch below (isPdfPath was true both before and
           after, and a preview already existed) — the OLD file's already-
           rendered preview just sat there unchanged, showing the wrong
           document's pages. Now any re-point that lands on a PDF rebuilds
           the preview fresh, and the old pdf.js document (if any) is
           always disposed first regardless of which branch is taken.
           Same rebuild-fresh treatment now applies re-pointing between
           two different images (a stale <img src> would otherwise just
           sit there showing the old file). */
        var existingPreview = el.querySelector('.pdf-preview, .file-image-preview');
        disposePdfPreview(card.id);
        if (isPdfPath(card.path)) {
          delete card.pdfPage; delete card.pdfZoom;
          if (existingPreview) existingPreview.remove();
          el.classList.add('has-file-preview');
          buildPdfPreview(el, card);
        } else if (isImagePath(card.path)) {
          if (existingPreview) existingPreview.remove();
          el.classList.add('has-file-preview');
          buildFileImagePreview(el, card);
        } else if (existingPreview) {
          el.classList.remove('has-file-preview');
          existingPreview.remove();
        }

        KanvazApp.markDirty();
        KanvazHistory.push();
        emitCardEvent('cardUpdate', card);
      }).catch(function(e) { console.warn('[Kanvaz] openRefFileDialog IPC failed:', e); });
    });
    changeBtn.addEventListener('mousedown', function(e) { e.stopPropagation(); });

    body.appendChild(label);
    body.appendChild(changeBtn);
    body.appendChild(openBtn);
    el.appendChild(body);
  }

  /* ══════════════════════════════════════════════════════════════
     3D model card (v7.x) — Kanvaz's 5th flagship feature.
     Renders card.dataUrl (an embedded GLB/glTF/OBJ/FBX, per the
     "embed like image/video/audio, not file-reference like .pdf"
     architecture decision) via a vendored Three.js. This UI is
     deliberately plain/functional — the user is designing the real
     UI in Figma separately and will re-skin this later — but the
     underlying wiring (render modes, animation, disposal) is meant
     to be correct and complete now.
     ══════════════════════════════════════════════════════════════ */

  /* Card id -> { dispose: fn } for every live 3D viewer, so
     removeCardCore()/clearAll() can release GPU resources (geometries,
     materials, textures, the renderer's WebGL context, the ResizeObserver,
     any in-flight rAF loop) instead of leaking them the way a plain DOM
     removal would. */
  var model3dInstances = {};

  function disposeModel3D(id) {
    var inst = model3dInstances[id];
    if (!inst) return;
    delete model3dInstances[id];
    try { inst.dispose(); } catch (e) { console.warn('[Kanvaz] 3D viewer dispose failed:', e); }
  }

  /* setRenderMode/setBgColor/resetCamera only exist once Three.js and
     the model have actually finished loading (loadThreeJs().then(...)
     in buildModel3DCard) — null while a card is still mid-load, which
     callers (Properties panel) need to handle same as any other
     "card exists but its live element/state isn't ready yet" case. */
  function getModel3DControls(id) {
    var inst = model3dInstances[id];
    if (!inst || !inst.setRenderMode) return null;
    return inst;
  }

  /* Electron 22's bundled Chromium is old enough that dynamic import()
     of these ES module files still works fine (unlike pdf.js, Three.js
     0.186 doesn't reach for anything newer than this runtime supports),
     so no polyfill is needed here the way pdf.js needed Promise.withResolvers. */
  var threeLoadPromise = null;
  function loadThreeJs() {
    if (!threeLoadPromise) {
      threeLoadPromise = Promise.all([
        import('./vendor/three/three.module.js'),
        import('./vendor/three/loaders/GLTFLoader.js'),
        import('./vendor/three/loaders/OBJLoader.js'),
        import('./vendor/three/loaders/FBXLoader.js'),
        import('./vendor/three/loaders/STLLoader.js'),
        import('./vendor/three/loaders/PLYLoader.js'),
        import('./vendor/three/loaders/VOXLoader.js'),
        import('./vendor/three/loaders/USDLoader.js'),
        import('./vendor/three/controls/OrbitControls.js')
      ]).then(function(mods) {
        return {
          THREE:          mods[0],
          GLTFLoader:     mods[1].GLTFLoader,
          OBJLoader:      mods[2].OBJLoader,
          FBXLoader:      mods[3].FBXLoader,
          STLLoader:      mods[4].STLLoader,
          PLYLoader:      mods[5].PLYLoader,
          VOXLoader:      mods[6].VOXLoader,
          buildVoxMesh:   mods[6].buildMesh,
          USDLoader:      mods[7].USDLoader,
          OrbitControls:  mods[8].OrbitControls
        };
      });
    }
    return threeLoadPromise;
  }

  function model3dDataToArrayBuffer(dataUrl) {
    var base64 = dataUrl.substring(dataUrl.indexOf(',') + 1);
    var binary = atob(base64);
    var bytes = new Uint8Array(binary.length);
    for (var i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes.buffer;
  }

  function model3dDataToText(dataUrl) {
    var buf = model3dDataToArrayBuffer(dataUrl);
    return new TextDecoder('utf-8').decode(buf);
  }

  /* Loads card.dataUrl into a THREE.Object3D per card.modelFormat.
     onLoad(root, animations). GLTFLoader/FBXLoader/OBJLoader.parse() all
     work directly off the already-embedded bytes — nothing re-reads from
     disk, matching the embedded-card architecture decision. A .gltf (as
     opposed to .glb) that references external .bin/texture files by
     relative path will fail those specific resource loads since there's
     no filesystem/server to resolve them against — a disclosed
     limitation, same class as FBX being "best-effort": only a
     self-contained (embedded-buffers) .gltf or a .glb is guaranteed to
     fully render. */
  function loadModelIntoScene(card, three, onLoad, onError) {
    var format = card.modelFormat;
    try {
      if (format === 'glb' || format === 'gltf') {
        var gltfLoader = new three.GLTFLoader();
        gltfLoader.parse(model3dDataToArrayBuffer(card.dataUrl), '', function(gltf) {
          onLoad(gltf.scene, gltf.animations || []);
        }, onError);
      } else if (format === 'obj') {
        var objLoader = new three.OBJLoader();
        var obj = objLoader.parse(model3dDataToText(card.dataUrl));
        onLoad(obj, []);
      } else if (format === 'fbx') {
        var fbxLoader = new three.FBXLoader();
        var fbx = fbxLoader.parse(model3dDataToArrayBuffer(card.dataUrl), '');
        onLoad(fbx, fbx.animations || []);
      } else if (format === 'stl' || format === 'ply') {
        /* STLLoader/PLYLoader.parse() return a bare BufferGeometry, not
           an Object3D tree like the other three loaders — wrap it in a
           Mesh so applyRenderMode()'s root.traverse() + node.isMesh
           check (built for GLTF/OBJ/FBX's own Object3D output) works on
           it unchanged, no special-casing needed anywhere else in the
           3D pipeline. Neither format carries a material, so every STL/
           PLY card gets the same flat default — camera/lighting-side
           make it read as it should, no per-format material story to
           design. computeVertexNormals() only runs when normals are
           actually missing (STL files always ship them; PLY does not
           always) — matches Three.js's own loader examples' guidance
           for these two formats specifically. */
        var stlOrPlyLoader = (format === 'stl') ? new three.STLLoader() : new three.PLYLoader();
        var geometry = stlOrPlyLoader.parse(model3dDataToArrayBuffer(card.dataUrl));
        if (!geometry.attributes.normal) geometry.computeVertexNormals();
        var mesh = new three.THREE.Mesh(geometry, new three.THREE.MeshStandardMaterial({ color: 0xb0b0b0, metalness: 0.1, roughness: 0.7 }));
        onLoad(mesh, []);
      } else if (format === 'vox') {
        /* VOXLoader.parse() returns an array of chunks — one per model
           in a multi-model .vox file — each turned into a real, fully
           colored/textured Mesh by the vendored buildMesh() helper
           (greedy-meshed voxel geometry + a MeshStandardMaterial reading
           a baked palette texture, not a placeholder). Only the FIRST
           model renders if the file has more than one — same "first
           only" scope decision already made for multi-clip GLTF
           animations elsewhere in this function, not a new precedent. */
        var voxLoader = new three.VOXLoader();
        var chunks = voxLoader.parse(model3dDataToArrayBuffer(card.dataUrl));
        if (!chunks || !chunks.length) { onError(new Error('Empty or unreadable .vox file')); return; }
        var voxMesh = three.buildVoxMesh(chunks[0]);
        onLoad(voxMesh, []);
      } else if (format === 'usd' || format === 'usda' || format === 'usdc' || format === 'usdz') {
        /* Unlike every other loader here, USDLoader.parse() is itself
           callback-based (onLoad/onError passed straight through, not
           called synchronously) — it awaits per-texture load promises
           internally before firing onLoad, since a USD scene's textures
           may live inside a .usdz zip archive it has to decompress
           first. It also content-sniffs the actual bytes (a zip's PK
           magic, USDC's "PXR-USDC" crate header, else assumes ASCII
           USDA text) rather than trusting the file extension, so the
           same call handles all four extensions without a branch per
           sub-format. No animation extraction path is exposed by this
           loader today — matches OBJLoader's own no-animation contract
           above, not a gap specific to USD. */
        var usdLoader = new three.USDLoader();
        usdLoader.parse(model3dDataToArrayBuffer(card.dataUrl), '', function(group) {
          onLoad(group, []);
        }, onError);
      } else {
        onError(new Error('Unknown 3D model format: ' + format));
      }
    } catch (e) {
      onError(e);
    }
  }

  /* A small procedural gradient used as the Matcap render mode's shading
     reference — a neutral studio-light look with no shipped asset file,
     since the plan calls for Matcap without adding binary assets. */
  function buildMatcapTexture(THREE) {
    var size = 128;
    var canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    var ctx = canvas.getContext('2d');
    var grad = ctx.createRadialGradient(size * 0.35, size * 0.32, size * 0.04, size * 0.5, size * 0.5, size * 0.68);
    grad.addColorStop(0,   '#ffffff');
    grad.addColorStop(0.5, '#8fa3c9');
    grad.addColorStop(1,   '#1b2130');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, size, size);
    var tex = new THREE.CanvasTexture(canvas);
    tex.needsUpdate = true;
    return tex;
  }

  /* A mesh's .material is a single Material object UNLESS it has more
     than one geometry group (multiple material "slots" — a very common
     real-world case: most multi-part glTF/FBX exports use this), in
     which case Three.js gives it an ARRAY of materials instead. Every
     piece of code below that touches node.material needs to treat both
     shapes uniformly rather than assuming a single object — an array
     has no .clone()/.dispose()/.map property of its own, so code written
     only for the single-material case silently breaks (throws, caught
     by a try/catch further up, aborting mid-operation) the moment it
     meets a multi-material mesh. */
  function model3dAsMaterialArray(matOrArray) {
    return Array.isArray(matOrArray) ? matOrArray : [matOrArray];
  }

  function model3dDisposeMaterial(mat) {
    if (!mat) return;
    var mapSlots = ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap',
      'emissiveMap', 'bumpMap', 'displacementMap', 'alphaMap', 'envMap', 'matcap'];
    for (var i = 0; i < mapSlots.length; i++) {
      var tex = mat[mapSlots[i]];
      if (tex && typeof tex.dispose === 'function') tex.dispose();
    }
    mat.dispose();
  }

  /* Walks the whole loaded scene disposing every geometry and every
     material this card ever created for it — the as-loaded material,
     PLUS the wireframe clone and Matcap material lazily built per-mesh
     when the user switches render modes (see applyRenderMode below). A
     bare DOM removal would leak all of this: geometries/materials/
     textures live on the GPU, not just in JS heap, so only explicit
     .dispose() calls actually free that memory. */
  function disposeModel3DScene(root) {
    root.traverse(function(node) {
      if (node.geometry) node.geometry.dispose();
      var mats = [];
      function addMats(m) {
        if (!m) return;
        var arr = model3dAsMaterialArray(m);
        for (var i = 0; i < arr.length; i++) {
          if (mats.indexOf(arr[i]) === -1) mats.push(arr[i]);
        }
      }
      addMats(node.material);
      if (node.userData) {
        addMats(node.userData.kanvazOrigMaterial);
        addMats(node.userData.kanvazWireframeMat);
        addMats(node.userData.kanvazMatcapMat);
      }
      for (var i = 0; i < mats.length; i++) model3dDisposeMaterial(mats[i]);
    });
  }

  /* Switches every mesh in the scene between the three v1 render modes.
     Normal = the material exactly as the file's own loader produced it
     (baked textures included, per the "exact-file rendering" decision).
     Wireframe/Matcap materials are built lazily, once per mesh, and
     cached on the mesh's userData so toggling back and forth is instant
     and doesn't keep allocating new GPU materials. */
  function applyRenderMode(THREE, root, mode, matcapTex) {
    root.traverse(function(node) {
      if (!node.isMesh) return;
      if (!node.userData.kanvazOrigMaterial) node.userData.kanvazOrigMaterial = node.material;

      /* Bug fix: a mesh with more than one material slot (multiple
         geometry groups — routine in real-world multi-part exports, not
         an edge case) has node.material as an ARRAY, not a single
         Material. The old code called .clone()/read .map directly on
         whatever node.material was, which threw on an array (no such
         methods) — silently aborting this traverse callback for that
         mesh, so wireframe/matcap never took effect on it (and, since
         .traverse()'s callback errors aren't caught per-node, could stop
         the WHOLE walk partway through the scene depending on traversal
         order). Building the wireframe/matcap replacement as the SAME
         shape (array in, array out; single in, single out) keeps every
         later consumer of node.material — the renderer, disposal below —
         working exactly like it does for a single-material mesh. */
      var isMultiMat = Array.isArray(node.userData.kanvazOrigMaterial);
      var origMats = model3dAsMaterialArray(node.userData.kanvazOrigMaterial);

      if (mode === 'wireframe') {
        if (!node.userData.kanvazWireframeMat) {
          var wfMats = origMats.map(function(m) {
            var wf = m.clone();
            wf.wireframe = true;
            return wf;
          });
          node.userData.kanvazWireframeMat = isMultiMat ? wfMats : wfMats[0];
        }
        node.material = node.userData.kanvazWireframeMat;
      } else if (mode === 'matcap') {
        if (!node.userData.kanvazMatcapMat) {
          var mcMats = origMats.map(function(m) {
            return new THREE.MeshMatcapMaterial({ matcap: matcapTex, map: m.map || null });
          });
          node.userData.kanvazMatcapMat = isMultiMat ? mcMats : mcMats[0];
        }
        node.material = node.userData.kanvazMatcapMat;
      } else {
        node.material = node.userData.kanvazOrigMaterial;
      }
    });
  }

  /* Frames the camera on the loaded object's bounding box — every load
     (and every "Reset view" click) starts from the same predictable
     framed shot. Camera orbit state is deliberately NOT persisted across
     save/reload (disclosed simplicity trade-off from the plan) — this is
     what re-establishes the view every time instead. */
  function frameModel3DCamera(THREE, root, camera, controls) {
    var box = new THREE.Box3().setFromObject(root);
    /* Audit fix: a model with zero actual mesh geometry (a .glb/.obj/.fbx
       that parses fine but contains only lights/cameras/empty nodes, or
       a degenerate export) leaves the box at its default empty state —
       min=+Infinity, max=-Infinity. getSize() then yields -Infinity per
       axis and getCenter() yields NaN (Infinity + -Infinity). The old
       `|| 1` fallback below never caught this because -Infinity is
       truthy, so it silently produced a NaN camera position/target that
       never renders anything and that "Reset view" (which calls this
       same function) can't recover from either. isFinite() catches both
       the NaN and Infinite cases the old falsy-check missed. */
    if (!isFinite(box.min.x) || !isFinite(box.max.x)) {
      box.min.set(-0.5, -0.5, -0.5);
      box.max.set(0.5, 0.5, 0.5);
    }
    var size = box.getSize(new THREE.Vector3());
    var center = box.getCenter(new THREE.Vector3());
    var maxDim = Math.max(size.x, size.y, size.z) || 1;
    var fovRad = camera.fov * (Math.PI / 180);
    var dist = (maxDim / 2) / Math.tan(fovRad / 2) * 1.6;
    camera.position.set(center.x + dist * 0.55, center.y + dist * 0.4, center.z + dist * 0.72);
    camera.near = Math.max(maxDim / 100, 0.01);
    camera.far  = Math.max(maxDim * 100, 100);
    camera.updateProjectionMatrix();
    controls.target.copy(center);
    controls.update();
  }

  function buildModel3DCard(el, card) {
    el.classList.add('card-model3d-loading');

    var skeleton = document.createElement('div');
    skeleton.className = 'card-skeleton';
    el.appendChild(skeleton);
    var spinner = document.createElement('div');
    spinner.className = 'card-spinner';
    el.appendChild(spinner);

    var viewport = document.createElement('div');
    viewport.className = 'model3d-viewport';
    /* Bug fix: orbiting/panning/zooming inside the 3D viewport was
       dragging and zooming the WHOLE BOARD underneath it — this listener
       was simply missing. cards.js's world-level mousedown delegate
       (bindDelegatedEvents) falls through to startDrag() for any
       mousedown on a card that isn't one of a short list of known
       interactive regions (video scrub bar, tag chips, etc.); the 3D
       viewport was never added to that list, so every orbit-drag also
       started a real card drag at the same time. Same story for wheel —
       the board's own pan/zoom listens on wheel globally, so scrolling
       to dolly the 3D camera also zoomed the canvas underneath. Matches
       the exact pattern the PDF preview already established for the
       same reason (buildPdfPreview's scrollArea, above). */
    viewport.addEventListener('mousedown', function(e) {
      /* Stopping propagation here blocks world's delegated handler from
         ever seeing this mousedown, which would otherwise also skip the
         select/bring-to-front it normally does before deciding whether
         to drag — replicate just that part directly so clicking into
         the viewport (nearly the whole card) still selects it like
         clicking anywhere else on a card does, it just never starts a
         board-level card drag. OrbitControls' own listener is bound
         directly to the canvas (a descendant of viewport) and always
         gets this same mousedown first, before it bubbles up here. */
      selectCard(card.id);
      bringToFront(card.id);
      e.stopPropagation();
    });
    viewport.addEventListener('wheel', function(e) { e.stopPropagation(); });
    el.appendChild(viewport);

    var canvas = document.createElement('canvas');
    canvas.className = 'model3d-canvas';
    viewport.appendChild(canvas);

    var toolbar = document.createElement('div');
    toolbar.className = 'model3d-toolbar';
    /* Same fix as viewport above — a mousedown that lands on the
       toolbar's own background (its padding/gaps between buttons, not
       a button itself — each button already stops propagation
       individually) would otherwise still fall through to world's
       delegated handler and start a card drag. */
    toolbar.addEventListener('mousedown', function(e) { e.stopPropagation(); });
    el.appendChild(toolbar);

    /* v8.x fix: found while auditing card UI for weak spots — every
       other annotatable card type (image/gif, video, audio) gets this
       "N annotations" badge; 3D model cards never did, an oversight
       from v7.4.0. Annotating a 3D card already worked regardless
       (KanvazAnnotate.activate() lazily attaches its own overlay by
       card id, not dependent on this badge existing) — this only adds
       the missing visual indicator, synchronously like the other card
       types do, not gated on the model finishing its async load. */
    buildAnnotationDot(el, card);

    loadThreeJs().then(function(three) {
      if (!document.body.contains(el)) return; /* card deleted while loading */
      var THREE = three.THREE;

      var renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true, alpha: true });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));

      var scene = new THREE.Scene();
      if (card.bgColor) scene.background = new THREE.Color(card.bgColor);

      var camera = new THREE.PerspectiveCamera(45, 1, 0.01, 1000);

      scene.add(new THREE.HemisphereLight(0xffffff, 0x444455, 1.1));
      var keyLight = new THREE.DirectionalLight(0xffffff, 1.4);
      keyLight.position.set(3, 5, 4);
      scene.add(keyLight);

      var controls = new three.OrbitControls(camera, renderer.domElement);
      controls.enableDamping = false; /* render-on-demand, not a continuous loop — see 'change' handler below */
      controls.screenSpacePanning = true;

      var matcapTex = buildMatcapTexture(THREE);
      var root = null;
      var mixer = null;
      var clip = null;
      var action = null;
      var isPlaying = false;
      var rafId = null;
      var clock = new THREE.Timer(); /* THREE.Clock is deprecated as of r186 */
      var disposed = false;

      function sizeToCard() {
        var w = Math.max(1, viewport.clientWidth);
        var h = Math.max(1, viewport.clientHeight);
        renderer.setSize(w, h, false);
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
      }

      function renderFrame() {
        if (disposed) return;
        renderer.render(scene, camera);
      }

      function animateLoop() {
        if (disposed) return;
        clock.update();
        var delta = clock.getDelta();
        if (mixer && isPlaying) mixer.update(delta);
        renderFrame();
        updateAnimUI(); /* no-ops until buildAnimationControls() exists — safe even before a model with clips has loaded */
        if (isPlaying) {
          rafId = requestAnimationFrame(animateLoop);
        } else {
          rafId = null;
        }
      }

      function startLoopIfPlaying() {
        if (isPlaying && rafId === null) {
          clock.update(); /* re-baseline so resuming doesn't jump the clip forward by the idle gap */
          rafId = requestAnimationFrame(animateLoop);
        }
      }

      controls.addEventListener('change', function() {
        if (!isPlaying) renderFrame();
      });

      /* v8.x polish item: persist camera orbit position across saves/
         reloads — previously deliberate v7.4.0 scope ("every load
         reframes to a default view"), revisited now that 3D is this
         line's flagship identity rather than a launch-scope footnote.
         Saved on OrbitControls' own 'end' event (fires once per
         orbit/pan/zoom gesture, not per mousemove frame like 'change'
         does) — same one-history-entry-per-gesture convention
         setRenderMode/setBgColor above already use, not a new pattern.
         Plain objects, not THREE.Vector3 instances, since card state
         has to survive a full JSON serialise/deserialise round-trip
         through the .kanvaz save format. */
      controls.addEventListener('end', function() {
        card.cameraPosition = { x: camera.position.x, y: camera.position.y, z: camera.position.z };
        card.cameraTarget   = { x: controls.target.x, y: controls.target.y, z: controls.target.z };
        KanvazApp.markDirty();
        KanvazHistory.push();
      });

      var resizeObserver = new ResizeObserver(function() {
        sizeToCard();
        renderFrame();
      });
      resizeObserver.observe(viewport);

      /* Registered as early as possible (everything it touches — renderer,
         controls, matcapTex, resizeObserver — already exists at this
         point) so that if ANYTHING later in this setup throws (toolbar
         construction, the model load call, etc.), the outer .catch()'s
         disposeModel3D() call actually has something to release instead
         of leaking whatever got created before the throw. root/rafId are
         read live at dispose-time via closure, so registering before
         either is assigned is safe. */
      model3dInstances[card.id] = {
        dispose: function() {
          disposed = true;
          isPlaying = false;
          if (rafId !== null) cancelAnimationFrame(rafId);
          resizeObserver.disconnect();
          controls.dispose();
          if (root) disposeModel3DScene(root);
          matcapTex.dispose();
          renderer.dispose();
        }
      };

      /* ── Toolbar: render mode buttons ── */
      var modeButtons = {};
      function setActiveModeButton(mode) {
        var keys = Object.keys(modeButtons);
        for (var i = 0; i < keys.length; i++) {
          modeButtons[keys[i]].classList.toggle('active', keys[i] === mode);
        }
      }
      function setRenderMode(mode, persist) {
        card.renderMode = mode;
        if (root) applyRenderMode(THREE, root, mode, matcapTex);
        setActiveModeButton(mode);
        renderFrame();
        if (persist) {
          KanvazApp.markDirty();
          KanvazHistory.push();
          emitCardEvent('cardUpdate', card);
        }
      }
      var modes = [['normal', 'Normal'], ['wireframe', 'Wireframe'], ['matcap', 'Matcap']];
      var modeGroup = document.createElement('div');
      modeGroup.className = 'model3d-mode-group';
      for (var mi = 0; mi < modes.length; mi++) {
        (function(modeKey, modeLabel) {
          var btn = document.createElement('button');
          btn.className = 'model3d-mode-btn';
          btn.textContent = modeLabel;
          btn.title = modeLabel + ' shading';
          btn.addEventListener('click', function(e) {
            e.stopPropagation();
            setRenderMode(modeKey, true);
          });
          btn.addEventListener('mousedown', function(e) { e.stopPropagation(); });
          modeButtons[modeKey] = btn;
          modeGroup.appendChild(btn);
        })(modes[mi][0], modes[mi][1]);
      }
      toolbar.appendChild(modeGroup);

      /* ── Toolbar: background color + reset view ──
         Kanvaz's own color picker (colorpicker.js) instead of a native
         <input type="color"> — same reasoning as the color-card swatch
         and the annotation toolbar's custom-color button. */
      function setBgColor(hex, persist) {
        scene.background = new THREE.Color(hex);
        bgSwatch.style.background = hex;
        renderFrame();
        if (persist) {
          card.bgColor = hex;
          KanvazApp.markDirty();
          KanvazHistory.push();
          emitCardEvent('cardUpdate', card);
        }
      }

      var bgSwatch = document.createElement('button');
      bgSwatch.className = 'model3d-bg-swatch';
      bgSwatch.title = 'Background color';
      bgSwatch.style.background = card.bgColor || '#1c1c22';
      bgSwatch.addEventListener('click', function(e) {
        e.stopPropagation();
        var rect = bgSwatch.getBoundingClientRect();
        KanvazColorPicker.open(rect.left, rect.bottom + 6, card.bgColor || '#1c1c22', {
          onChange: function(hex) { setBgColor(hex, false); },
          onCommit: function(hex) { setBgColor(hex, true); }
        });
      });
      bgSwatch.addEventListener('mousedown', function(e) { e.stopPropagation(); });
      toolbar.appendChild(bgSwatch);

      function resetCamera() {
        if (root) frameModel3DCamera(THREE, root, camera, controls);
        renderFrame();
      }

      /* Exposed on the same per-card registry dispose() already lives
         on, so the Properties panel can drive this exact card's own
         toolbar controls (getModel3DControls() below) instead of a
         second, separate notion of "what mode/background is this
         card" that could drift from what's actually rendering. */
      model3dInstances[card.id].setRenderMode  = function(mode) { setRenderMode(mode, true); };
      /* Split the same way the on-card swatch's own input/change split
         already is: previewBgColor for live drag feedback (no history
         entry per tick), setBgColor for the final committed value. A
         single always-persisting setter here would push a new undo
         entry on every drag tick while dragging the picker. */
      model3dInstances[card.id].previewBgColor = function(hex) { setBgColor(hex, false); };
      model3dInstances[card.id].setBgColor     = function(hex) { setBgColor(hex, true); };
      model3dInstances[card.id].resetCamera    = resetCamera;

      var resetBtn = document.createElement('button');
      resetBtn.className = 'model3d-reset-btn';
      resetBtn.title = 'Reset view';
      resetBtn.textContent = '⟲';
      resetBtn.addEventListener('click', function(e) {
        e.stopPropagation();
        resetCamera();
      });
      resetBtn.addEventListener('mousedown', function(e) { e.stopPropagation(); });
      toolbar.appendChild(resetBtn);

      /* ── Animation play/pause + scrub (only added once we know the
         model actually has clips — see onLoad below) ── */
      var animScrub = null;
      var animPlayBtn = null;
      var animTrack = null;
      var animFill = null;
      var animTimeEl = null;

      function buildAnimationControls() {
        animScrub = document.createElement('div');
        animScrub.className = 'video-scrub model3d-anim-scrub';

        animPlayBtn = document.createElement('button');
        animPlayBtn.className = 'media-play-btn';
        animPlayBtn.style.cssText = 'background:none;border:none;cursor:pointer;color:var(--color-text-2);padding:0;display:flex;align-items:center;';
        animPlayBtn.innerHTML = isPlaying ? PAUSE_ICON : PLAY_ICON;
        animPlayBtn.title = 'Play/Pause animation';
        animPlayBtn.addEventListener('click', function(e) {
          e.stopPropagation();
          isPlaying = !isPlaying;
          if (action) action.paused = !isPlaying;
          animPlayBtn.innerHTML = isPlaying ? PAUSE_ICON : PLAY_ICON;
          startLoopIfPlaying();
          if (!isPlaying) renderFrame();
          card.animationPlaying = isPlaying;
          KanvazApp.markDirty();
          KanvazHistory.push();
          emitCardEvent('cardUpdate', card);
        });
        animPlayBtn.addEventListener('mousedown', function(e) { e.stopPropagation(); });

        animTrack = document.createElement('div');
        animTrack.className = 'scrub-bar';
        animFill = document.createElement('div');
        animFill.className = 'scrub-fill';
        animTrack.appendChild(animFill);
        animTrack.addEventListener('mousedown', function(e) {
          e.stopPropagation();
          scrubToClientX(e.clientX);
          var onMove = function(ev) { scrubToClientX(ev.clientX); };
          var onUp = function() {
            document.removeEventListener('mousemove', onMove);
            document.removeEventListener('mouseup', onUp);
          };
          document.addEventListener('mousemove', onMove);
          document.addEventListener('mouseup', onUp);
        });

        function scrubToClientX(clientX) {
          if (!action || !clip) return;
          var rect = animTrack.getBoundingClientRect();
          var pct = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
          action.time = pct * clip.duration;
          action.paused = true;
          isPlaying = false;
          animPlayBtn.innerHTML = PLAY_ICON;
          if (mixer) mixer.update(0);
          renderFrame();
          updateAnimUI();
          card.animationPlaying = false;
          KanvazApp.markDirty();
          KanvazHistory.push();
          emitCardEvent('cardUpdate', card);
        }

        animTimeEl = document.createElement('span');
        animTimeEl.className = 'scrub-time';
        animTimeEl.textContent = '0:00';

        animScrub.appendChild(animPlayBtn);
        animScrub.appendChild(animTrack);
        animScrub.appendChild(animTimeEl);
        el.appendChild(animScrub);
      }

      function updateAnimUI() {
        if (!action || !clip || !animFill) return;
        var t = action.time % clip.duration;
        var pct = clip.duration ? (t / clip.duration) * 100 : 0;
        animFill.style.width = pct + '%';
        animTimeEl.textContent = KanvazMedia.formatTime(t) + ' / ' + KanvazMedia.formatTime(clip.duration);
      }


      loadModelIntoScene(card, three, function(loadedRoot, animations) {
        if (disposed) return;
        root = loadedRoot;
        scene.add(root);
        applyRenderMode(THREE, root, card.renderMode || 'normal', matcapTex);
        setActiveModeButton(card.renderMode || 'normal');
        sizeToCard();
        /* Restore a saved camera position/target if this card has one
           (see the OrbitControls 'end' listener above) — only on first
           load, never overriding a fresh frameModel3DCamera() call that
           a real geometry change (a relink, a format-changed reload)
           should still get. "Reset view" (resetCamera(), below) always
           re-frames regardless of what's saved, by design — this is
           the only place the saved position is ever actually restored. */
        if (card.cameraPosition && card.cameraTarget) {
          camera.position.set(card.cameraPosition.x, card.cameraPosition.y, card.cameraPosition.z);
          controls.target.set(card.cameraTarget.x, card.cameraTarget.y, card.cameraTarget.z);
          camera.updateProjectionMatrix();
          controls.update();
        } else {
          frameModel3DCamera(THREE, root, camera, controls);
        }

        if (animations && animations.length) {
          /* Disclosed limitation (audit finding, v1 scope): only the
             FIRST clip plays — a multi-clip-authored model (e.g. separate
             "idle"/"walk"/"run" actions baked into one file) has no clip
             picker in this plain/functional v1 UI. Matches the plan's
             "just render" scope for animation; a picker is exactly the
             kind of control surface meant to wait for the real Figma-
             designed UI rather than bolt one in ahead of it. */
          mixer = new THREE.AnimationMixer(root);
          clip = animations[0];
          action = mixer.clipAction(clip);
          action.play();
          isPlaying = !!card.animationPlaying;
          action.paused = !isPlaying;
          buildAnimationControls();
          if (animations.length > 1 && animTimeEl) {
            animTimeEl.title = 'This model has ' + animations.length + ' animation clips — only the first ("' +
              (clip.name || 'Clip 1') + '") plays. Clip selection isn\'t supported yet.';
          }
          updateAnimUI();
          startLoopIfPlaying();
        }

        el.classList.remove('card-model3d-loading');
        clearLoadingState(el);
        renderFrame();
      }, function(err) {
        console.warn('[Kanvaz] 3D model load failed:', err);
        clearLoadingState(el);
        el.classList.remove('card-model3d-loading');
        viewport.style.display = 'none';
        toolbar.style.display = 'none';
        showMediaError(el, card, 'Could not load this 3D model — the file may be corrupt, or (for .gltf) reference external files Kanvaz can\'t reach.');
      });
    }).catch(function(e) {
      console.error('[Kanvaz] Three.js failed to load:', e);
      clearLoadingState(el);
      el.classList.remove('card-model3d-loading');
      /* Bug fix: if something threw partway through the .then() callback
         above (e.g. WebGLRenderer construction failing because the board
         already has enough live 3D cards to hit Chromium's WebGL context
         limit — a real risk given multiple idle 3D cards are an explicit
         supported case here), the renderer/controls/matcap texture that
         DID get created before the throw would otherwise never be
         disposed. disposeModel3D() is a safe no-op if registration never
         got that far. */
      disposeModel3D(card.id);
      showMediaError(el, card, 'Could not initialize the 3D viewer.');
    });
  }

  /* ── Card bar (name + metadata + type pill) ──
     Redesign v1 Phase 3 (card visual polish) — rebuilt as an always-
     visible two-line footer (name, then at-a-glance metadata) plus one
     consistently-styled type pill, matching the design reference. Used
     to be a single hover-only row of small, per-type-colored badges
     crammed next to a monospace filename. */

  var CARD_TYPE_LABELS = {
    image: 'Image', gif: 'GIF', video: 'Video', audio: 'Audio',
    note: 'Note', text: 'Text', color: 'Color', url: 'URL',
    file: 'File', model3d: '3D'
  };

  function getCardTypeLabel(card) {
    return CARD_TYPE_LABELS[card.type] || (card.type || '').toUpperCase();
  }

  /* Metadata line under the name. Image/video leave it blank here and
     fill it in asynchronously once their real data is known (see
     buildImageCard's onload / buildVideoCard's onloadedmetadata,
     targeting .card-bar-meta directly) — mirrors the old dims/duration
     badges' own timing, just writing into one shared element now
     instead of a dedicated badge each. */
  function getCardMetaText(card) {
    if (card.type === 'note') {
      var len = (card.text || '').length;
      return len + (len === 1 ? ' char' : ' chars');
    }
    /* Color's title IS the hex value (see commitColorChange — card.name
       is set to the hex string itself), and the swatch dot next to the
       title already shows it visually too — repeating it a third time
       on the meta line would be pure redundancy, not information. */
    if (card.type === 'color') return '';
    if (card.type === 'url') return card.url || '';
    if (card.type === 'file') {
      if (!card.path) return '';
      var parts = card.path.split(/[\\/]/);
      return parts[parts.length - 1];
    }
    if (card.type === 'model3d') return card.modelFormat ? card.modelFormat.toUpperCase() : '';
    return '';
  }

  function buildCardBar(el, card) {
    var bar = document.createElement('div');
    bar.className = 'card-bar';

    var info = document.createElement('div');
    info.className = 'card-bar-info';

    var titleRow = document.createElement('div');
    titleRow.className = 'card-bar-title-row';

    if (card.sharedId) {
      var sharedIcon = document.createElement('span');
      sharedIcon.className = 'card-bar-shared-icon';
      sharedIcon.title = 'Shared across boards — editing it here updates every board it appears on';
      sharedIcon.textContent = '⛓';
      titleRow.appendChild(sharedIcon);
    }

    if (card.type === 'color') {
      var swatch = document.createElement('span');
      swatch.className = 'card-bar-color-swatch';
      swatch.style.background = card.color || '#9D7FFF';
      titleRow.appendChild(swatch);
    }

    titleRow.appendChild(buildNameSpan(card, el));
    info.appendChild(titleRow);

    var meta = document.createElement('div');
    meta.className = 'card-bar-meta';
    meta.textContent = getCardMetaText(card);
    info.appendChild(meta);

    bar.appendChild(info);

    var pill = document.createElement('span');
    pill.className = 'card-type-pill';
    pill.textContent = getCardTypeLabel(card);
    bar.appendChild(pill);

    el.appendChild(bar);
    buildTagBar(el, card);
  }

  /* ── Rename (4.7.0) ──
     Board View's own equivalent of Map View's startRenameNode. Shared
     with buildCardBar's initial render so the "what does the name label
     actually show" logic (note-preview substitution) lives in exactly
     one place — building it twice risked the two copies drifting apart
     the first time either one changed. */
  function buildNameSpan(card, el) {
    var name = document.createElement('span');
    name.className = 'card-bar-title ellipsis';
    if (card.type === 'note') {
      /* Preview the note's own text instead of the generic "Note" name,
         once there's something to show — kept in sync live by the
         'input' listener in buildNoteCard. */
      var notePreview = (card.text || '').trim();
      name.textContent = notePreview
        ? (notePreview.length > 20 ? notePreview.slice(0, 20) + '…' : notePreview)
        : (card.name || 'Note');
    } else {
      name.textContent = card.name;
    }
    name.title = 'Double-click to rename';
    name.addEventListener('dblclick', function(e) {
      e.stopPropagation();
      startRenameCard(card.id);
    });
    return name;
  }

  /* Single-arg, same shape as Map View's startRenameNode(refId) — looks
     its own element up rather than requiring the caller to have one
     handy, so the context-menu "Rename" action (app.js) can call this
     exactly like every other id-only card action. */
  function startRenameCard(id) {
    var card = cards[id];
    var el = document.getElementById(id);
    if (!card || !el) return;
    var nameEl = el.querySelector('.card-bar-title');
    if (!nameEl) return;
    var nameParent = nameEl.parentNode;

    var input = document.createElement('input');
    input.type = 'text';
    input.className = 'card-bar-title-input';
    input.value = card.name || '';

    nameParent.replaceChild(input, nameEl);
    input.focus();
    input.select();

    var done = false;
    function finish(commit) {
      if (done) return;
      done = true;
      var val = input.value.trim();
      if (commit && val && val !== card.name) {
        /* updateCardData rebuilds the whole card element (including a
           fresh card-bar via buildCardBar), so the input is already
           gone by the time this returns — nothing left to clean up. */
        updateCardData(id, { name: val });
        return;
      }
      /* Cancelled, empty, or unchanged — updateCardData never ran, so
         the input is still sitting in the live DOM. Swap it back for a
         label ourselves using the exact same builder buildCardBar used,
         not a second copy of its display logic. */
      if (input.parentNode) input.parentNode.replaceChild(buildNameSpan(card, el), input);
    }

    /* Same reasoning as Map View's rename input: stop these from
       reaching the card's own mousedown (drag-start) / dblclick
       (nothing bound today, but future-proof) handlers. */
    input.addEventListener('mousedown', function(e) { e.stopPropagation(); });
    input.addEventListener('dblclick',  function(e) { e.stopPropagation(); });
    input.addEventListener('keydown', function(e) {
      e.stopPropagation();
      if (e.key === 'Enter')  { e.preventDefault(); finish(true); }
      if (e.key === 'Escape') { e.preventDefault(); finish(false); }
    });
    input.addEventListener('blur', function() { finish(true); });
  }

  /* ── Tag chips (inline editing) ── */

  /* v5.2.0 — recently-used tags, most-recent first, for one-click re-add
     without typing anything first (see updateDropdown() below). Session-
     scoped only (in-memory, not written to settings.json or the board
     file) — a deliberate, smaller scope than persisting across restarts,
     since the real pain point this solves is re-tagging many cards in
     one sitting, not remembering tags from a week ago. */
  var recentTags = [];
  var RECENT_TAGS_MAX = 8;

  function noteRecentTag(tag) {
    var idx = recentTags.indexOf(tag);
    if (idx !== -1) recentTags.splice(idx, 1);
    recentTags.unshift(tag);
    if (recentTags.length > RECENT_TAGS_MAX) recentTags.length = RECENT_TAGS_MAX;
  }

  function collectAllTags() {
    var allTags = {};
    for (var id in cards) {
      var c = cards[id];
      if (c.tags && c.tags.length) {
        for (var t = 0; t < c.tags.length; t++) {
          allTags[c.tags[t]] = true;
        }
      }
    }
    return Object.keys(allTags).sort();
  }

  function buildTagBar(el, card) {
    var existing = el.querySelector('.tag-bar');
    if (existing) existing.parentNode.removeChild(existing);

    var tagBar = document.createElement('div');
    tagBar.className = 'tag-bar';

    if (card.tags && card.tags.length) {
      for (var i = 0; i < card.tags.length; i++) {
        (function(tag, idx) {
          var chip = document.createElement('span');
          chip.className = 'tag-chip';
          chip.textContent = tag;

          var removeBtn = document.createElement('span');
          removeBtn.className = 'tag-chip-remove';
          removeBtn.textContent = '\u00D7';
          removeBtn.title = 'Remove tag';
          removeBtn.addEventListener('click', function(e) {
            e.stopPropagation();
            card.tags.splice(idx, 1);
            buildTagBar(el, card);
            KanvazApp.markDirty();
            KanvazHistory.push();
            emitCardEvent('cardUpdate', card);
          });
          chip.appendChild(removeBtn);
          tagBar.appendChild(chip);
        })(card.tags[i], i);
      }
    }

    var addBtn = document.createElement('span');
    addBtn.className = 'tag-chip tag-chip-add';
    addBtn.textContent = '+';
    addBtn.title = 'Add tag';
    addBtn.addEventListener('click', function(e) {
      e.stopPropagation();
      showTagInput(el, card, tagBar);
    });
    tagBar.appendChild(addBtn);

    el.appendChild(tagBar);
  }

  function showTagInput(cardEl, card, tagBar) {
    var existingInput = tagBar.querySelector('.tag-input');
    if (existingInput) return;

    var input = document.createElement('input');
    input.className = 'tag-input';
    input.type = 'text';
    input.placeholder = 'tag name';
    input.style.cssText = 'width:70px;padding:1px 4px;border:1px solid var(--color-accent);border-radius:3px;background:var(--color-surface-2);color:var(--color-text);font-size:10px;font-family:var(--font-ui);outline:none;';

    /* Autocomplete dropdown — suggests tags already used elsewhere on
       the board, filtered to what's typed so far and excluding tags
       already on this card. Floated on <body> (position:fixed), same
       pattern as the opacity/speed pickers — `.card` has
       overflow:hidden, so a dropdown nested inside the tag bar would
       get clipped instead of popping out above the card. */
    var dropdown = document.createElement('div');
    dropdown.className = 'tag-autocomplete';
    document.body.appendChild(dropdown);

    function closeDropdown() {
      if (dropdown.parentNode) dropdown.parentNode.removeChild(dropdown);
    }

    function addTag(val) {
      val = (val !== undefined ? val : input.value).trim().toLowerCase();
      if (val && (!card.tags || card.tags.indexOf(val) === -1)) {
        if (!card.tags) card.tags = [];
        card.tags.push(val);
        noteRecentTag(val);
        KanvazApp.markDirty();
        KanvazHistory.push();
        emitCardEvent('cardUpdate', card);
      }
      closeDropdown();
      buildTagBar(cardEl, card);
    }

    function positionDropdown() {
      var rect = input.getBoundingClientRect();
      dropdown.style.left = rect.left + 'px';
      dropdown.style.top  = rect.top + 'px';
    }

    function updateDropdown() {
      var query = input.value.trim().toLowerCase();
      dropdown.innerHTML = '';
      var existing = card.tags || [];
      var matches;
      if (!query) {
        /* Nothing typed yet — offer one-click re-add from recent tags
           instead of hiding the dropdown entirely. */
        matches = recentTags.filter(function(t) { return existing.indexOf(t) === -1; });
        if (!matches.length) { dropdown.classList.remove('visible'); return; }
      } else {
        matches = collectAllTags().filter(function(t) {
          return existing.indexOf(t) === -1 && t.indexOf(query) !== -1;
        });
        if (!matches.length) { dropdown.classList.remove('visible'); return; }
      }

      for (var i = 0; i < Math.min(matches.length, 6); i++) {
        (function(tag) {
          var item = document.createElement('div');
          item.className = 'tag-autocomplete-item';
          item.textContent = tag;
          /* mousedown + preventDefault — stops the input from blurring,
             so the blur handler's addTag() never fires with stale text
             for this interaction; this handler adds the clicked tag
             directly instead. */
          item.addEventListener('mousedown', function(e) {
            e.preventDefault();
            e.stopPropagation();
            addTag(tag);
          });
          dropdown.appendChild(item);
        })(matches[i]);
      }
      positionDropdown();
      dropdown.classList.add('visible');
    }

    input.addEventListener('input', updateDropdown);
    input.addEventListener('focus', updateDropdown);

    /* buildTagBar() below rebuilds the tag bar, which removes this
       still-focused input from the DOM — that fires a native 'blur' on
       it first, which is wired to addTag() below. Left alone, Escape
       would "cancel" by adding whatever partial text was typed as a
       real tag, same as Enter. This flag lets the blur handler know a
       cancel is already in progress so it skips addTag(). */
    var cancelled = false;

    input.addEventListener('keydown', function(e) {
      e.stopPropagation();
      if (e.key === 'Enter') { addTag(); }
      if (e.key === 'Escape') {
        cancelled = true;
        closeDropdown();
        buildTagBar(cardEl, card);
      }
    });
    input.addEventListener('blur', function() {
      if (cancelled) return;
      addTag();
    });

    tagBar.insertBefore(input, tagBar.querySelector('.tag-chip-add'));
    input.focus();
  }

  /* ── Pin indicator ── */

  function buildPinIndicator(el) {
    var pin = document.createElement('div');
    pin.className = 'card-pin';
    el.appendChild(pin);
  }

  /* ── Resize handles — pure DOM markers, no listeners (delegated) ── */

  function buildResizeHandles(el) {
    /* -7.5px keeps the handle's center at the same point relative to
       the card edge as the old 8px/-5.5px handle did (center = offset +
       size/2 = -1.5px past the edge either way) — audit fix made the
       handle itself bigger (12px, easier to grab) without shifting it. */
    /* Bug bounty fix: half-offsets used to be a flat -7.5px (half of
       the old fixed 12px handle) — now that .resize-handle's own size
       scales with the card (clamp(10px,3.2cqw,20px), see main.css), a
       fixed offset would leave the handle visibly off-center on the
       edge at any size other than the one -7.5px happened to match.
       calc() against the exact same clamp() keeps it centered on the
       border at every size. */
    var HALF_OFFSET = 'calc(clamp(10px, 3.2cqw, 20px) * -0.5)';
    var positions = [
      { name: 'tl', style: 'top:' + HALF_OFFSET + ';left:' + HALF_OFFSET + ';cursor:nw-resize;' },
      { name: 'tc', style: 'top:' + HALF_OFFSET + ';left:50%;transform:translateX(-50%);cursor:n-resize;' },
      { name: 'tr', style: 'top:' + HALF_OFFSET + ';right:' + HALF_OFFSET + ';cursor:ne-resize;' },
      { name: 'ml', style: 'top:50%;left:' + HALF_OFFSET + ';transform:translateY(-50%);cursor:w-resize;' },
      { name: 'mr', style: 'top:50%;right:' + HALF_OFFSET + ';transform:translateY(-50%);cursor:e-resize;' },
      { name: 'bl', style: 'bottom:' + HALF_OFFSET + ';left:' + HALF_OFFSET + ';cursor:sw-resize;' },
      { name: 'bc', style: 'bottom:' + HALF_OFFSET + ';left:50%;transform:translateX(-50%);cursor:s-resize;' },
      { name: 'br', style: 'bottom:' + HALF_OFFSET + ';right:' + HALF_OFFSET + ';cursor:se-resize;' }
    ];

    for (var i = 0; i < positions.length; i++) {
      var h = document.createElement('div');
      h.className = 'resize-handle';
      h.style.cssText += positions[i].style;
      h.dataset.handle = positions[i].name;
      el.appendChild(h);
    }
  }

  /* ── Select ── */

  function selectCard(id) {
    /* Plain click/drag/create always collapses a prior multi-selection
       down to just this one card, same as clicking one of several
       highlighted rows in a file browser. Ctrl/Cmd-click
       (toggleCardInSelection) and canvas.js's marquee/rubber-band drag
       both grow or shrink a selection instead of calling this; the
       world mousedown/contextmenu handlers also skip calling this
       entirely when the click lands on a card that's already part of
       the current multi-selection or a persistent group (Ctrl+G), so
       either survives a click on one of its own members. */
    if (multiSelectedIds.length > 1) {
      clearSelectionVisuals();
    } else if (selectedId && selectedId !== id) {
      var prev = document.getElementById(selectedId);
      if (prev) prev.classList.remove('selected');
    }
    selectedId = id;
    multiSelectedIds = [id];
    var el = document.getElementById(id);
    if (el) el.classList.add('selected');
    emitSelectionChange();
  }

  /* Remove the '.selected' class from every card currently wearing it,
     without touching selectedId/multiSelectedIds — callers update that
     state themselves right after. Shared by selectCard/selectAll/
     deselectAll/setMultiSelection so there's exactly one place that
     touches the DOM for this. */
  function clearSelectionVisuals() {
    var allEls = document.querySelectorAll('.card.selected');
    for (var i = 0; i < allEls.length; i++) {
      allEls[i].classList.remove('selected');
    }
  }

  /* Select an explicit set of cards (used after a bulk duplicate, so the
     newly-created copies become the new selection). Ids that no longer
     exist are skipped defensively. */
  function setMultiSelection(ids) {
    clearSelectionVisuals();
    var applied = [];
    for (var i = 0; i < ids.length; i++) {
      var el = document.getElementById(ids[i]);
      if (el) {
        el.classList.add('selected');
        applied.push(ids[i]);
      }
    }
    multiSelectedIds = applied;
    selectedId = applied.length ? applied[applied.length - 1] : null;
    emitSelectionChange();
  }

  /* Ctrl/Cmd-click add-or-remove for building a specific multi-selection
     by hand (the click-driven counterpart to Select All). Starting from
     a single plain selection, the first Ctrl-click grows it to a group
     of two rather than just swapping which one card is selected. */
  function toggleCardInSelection(id) {
    var base = multiSelectedIds.length ? multiSelectedIds.slice() : (selectedId ? [selectedId] : []);
    var idx = base.indexOf(id);
    if (idx !== -1) {
      base.splice(idx, 1);
    } else {
      base.push(id);
    }
    setMultiSelection(base);
  }

  /* Returns every currently-selected id (length 0, 1, or many). This is
     the set that bulk-capable operations (delete, duplicate, pin, hide
     annotations, nudge) act on. Single-target features (Annotate,
     Connections inspector, Properties panel) should keep using
     getSelected() below, which returns just the one "primary" id — it
     doesn't make sense to pop open 40 Properties panels at once. */
  function getSelectedIds() {
    if (multiSelectedIds.length) return multiSelectedIds.slice();
    return selectedId ? [selectedId] : [];
  }

  /* ── Z-order ── */

  function bringToFront(id) {
    var card = cards[id];
    if (!card) return;
    card.z = ++zCounter;
    var el = document.getElementById(id);
    if (el) el.style.zIndex = card.z;
  }

  /* ── Layers panel drag-to-reorder ──
     orderedIdsTopToBottom is the FULL new top-to-bottom order (as drawn
     in the Layers list) after a drag-drop. Reassigns z so that order is
     preserved exactly, without touching any card's z relative to
     something outside this list (there is nothing outside this list —
     getAllIds() is every card) and without colliding with zCounter's
     next value, so a subsequent bringToFront() still lands above
     everything. Unlike bringToFront (a lightweight, non-undoable
     selection-adjacent nudge), this is a real structural change users
     will expect to persist and undo, so it marks dirty and pushes
     history like sendToBack does. */
  function reorderLayers(orderedIdsTopToBottom) {
    var n = orderedIdsTopToBottom.length;
    for (var i = 0; i < n; i++) {
      var card = cards[orderedIdsTopToBottom[i]];
      if (!card) continue;
      card.z = zCounter + (n - i);
      var el = document.getElementById(card.id);
      if (el) el.style.zIndex = card.z;
    }
    zCounter += n;
    KanvazApp.markDirty();
    KanvazHistory.push();
  }

  /* ── Delete ── */

  function deleteCard(id) {
    var card = cards[id];
    if (!card) return;

    var confirmDel = false;
    if (typeof KanvazUI_Extended !== 'undefined') {
      var s = KanvazUI_Extended.getSettings();
      confirmDel = s && s.confirmDelete;
    }

    if (confirmDel) {
      KanvazUI.showDialog(
        'Delete card?',
        'Remove "' + card.name + '" from the canvas?',
        [
          { label: 'Delete', cls: 'danger', action: function() { doDelete(id); } },
          /* v8.x dialog-polish: 'primary' here drives showDialog()'s
             Enter-to-confirm focus onto the safe choice, not a visual
             preference — see the identical note on boards.js's own
             "Delete board?" dialog for the full reasoning. */
          { label: 'Cancel', cls: 'primary', action: function() {} }
        ]
      );
    } else {
      doDelete(id);
    }
  }

  /* Removes one card's DOM/annotate/connections/map state — no history
     push, no dirty flag, no empty-state/count refresh. Shared by the
     single-card path (doDelete) and the bulk path (deleteMultiple) so a
     multi-delete does exactly this work N times and the "finish up"
     bookkeeping (below) exactly once, instead of once per card. */
  function removeCardCore(id) {
    var card = cards[id];
    if (!card) return false;

    /* Pause any playing media before removing the DOM element.
       Audit fix: this used to only pause() — clearAll() (board switch/
       undo/redo) already learned that pause() alone leaves the decoder
       in limbo (uncollectable, and audible if unmuted) and fixed it with
       removeAttribute('src')+load(); single-card delete had the same gap
       and never got the same fix. Matched here so both delete paths
       release decoders the same way. */
    var el = document.getElementById(id);
    if (el) {
      var mediaEl = el.querySelector('video, audio');
      if (mediaEl) {
        mediaEl.pause();
        mediaEl.removeAttribute('src');
        mediaEl.load();
      }
      disposeModel3D(id);
      disposePdfPreview(id);
      el.parentNode.removeChild(el);
    }

    if (typeof KanvazAnnotate !== 'undefined') KanvazAnnotate.detach(id);

    /* Cascade-remove all connections involving this reference */
    if (typeof KanvazConnections !== 'undefined') {
      KanvazConnections.removeAllFor(id);
    }

    delete cards[id];
    if (multiSelectedIds.length) {
      var idx = multiSelectedIds.indexOf(id);
      if (idx !== -1) multiSelectedIds.splice(idx, 1);
    }
    if (selectedId === id) selectedId = null;
    emitCardEvent('cardDelete', card);
    return true;
  }

  /* Post-delete bookkeeping shared by the single and bulk paths. Picks
     a remaining card to auto-select (if any) so a keyboard-only bulk
     delete (Delete, Delete, Delete...) keeps working instead of going
     dead after the first one — without this, selectedId stays null and
     every subsequent Delete press is a no-op until the user clicks
     something again. Picks the most recently created remaining card
     (simple, predictable) rather than attempting spatial "nearest"
     selection. */
  function finishDelete() {
    if (!selectedId) {
      var remainingIds = Object.keys(cards);
      if (remainingIds.length) {
        selectCard(remainingIds[remainingIds.length - 1]);
      } else {
        multiSelectedIds = [];
        emitSelectionChange();
      }
    }

    /* Close inspector if it was showing a reference that's now gone */
    if (typeof KanvazInspector !== 'undefined' && KanvazInspector.isOpen()) {
      KanvazInspector.close();
    }

    updateEmptyState();
    updateCount();
    KanvazApp.markDirty();
    KanvazHistory.push();
    /* Unconditional, not folded into the selectCard()/emitSelectionChange()
       branch above: when the still-selected card ISN'T the one that got
       deleted, neither of those fire, and the Layers panel would keep
       showing a row for a card that no longer exists. */
    refreshLayersIfOpen();
  }

  function doDelete(id) {
    if (!removeCardCore(id)) return;
    finishDelete();
  }

  /* Public alias for doDelete() — deletes immediately, skipping the
     optional confirm-dialog gate deleteCard() applies for human
     misclicks. Meant for programmatic callers (the MCP Bridge official
     plugin's deleteCard tool is the reason this exists) where the
     caller's own action already WAS the deliberate confirmation — a
     blocking dialog only a human can see would hang an AI-driven
     request waiting for a click that will never come. Still lands in
     undo history exactly like a manual delete, so it's just as
     reversible either way. */
  function deleteCardImmediate(id) {
    if (!cards[id]) {
      console.error('[Kanvaz] deleteCardImmediate("' + id + '") — no card with that id, nothing deleted');
      return;
    }
    doDelete(id);
  }

  /* Deletes every id in the array with exactly one history push / dirty
     flag / count refresh at the end, instead of one per card — the same
     pattern generateTestCards() already uses for bulk creation. */
  function deleteMultiple(ids) {
    if (!ids || !ids.length) return;
    var deletedAny = false;
    for (var i = 0; i < ids.length; i++) {
      if (removeCardCore(ids[i])) deletedAny = true;
    }
    if (deletedAny) finishDelete();
  }

  /* Shortcut/menu entry point that's multi-select aware: deletes just
     one card (identical behavior to before, including the optional
     per-card confirm dialog) when a single card is selected, or all
     selected cards behind one confirm dialog when more than one is. */
  function deleteSelected() {
    var ids = getSelectedIds();
    if (!ids.length) return;
    if (ids.length === 1) { deleteCard(ids[0]); return; }

    var confirmDel = false;
    if (typeof KanvazUI_Extended !== 'undefined') {
      var s = KanvazUI_Extended.getSettings();
      confirmDel = s && s.confirmDelete;
    }

    if (confirmDel) {
      KanvazUI.showDialog(
        'Delete ' + ids.length + ' cards?',
        'Remove ' + ids.length + ' selected cards from the canvas?',
        [
          { label: 'Delete', cls: 'danger', action: function() { deleteMultiple(ids); } },
          { label: 'Cancel', cls: 'primary', action: function() {} }
        ]
      );
    } else {
      deleteMultiple(ids);
    }
  }

  /* ── Programmatic update (MCP Bridge / plugins) ──
     A generic partial-update entry point for callers that don't come
     through any of the specific hand-built UI mutators above (drag,
     resize, the note textarea, the color picker, ...). Rather than
     replicate each of those mutators' own surgical DOM patching for
     every possible field, this whitelists the fields a caller may set,
     mutates the card object, then rebuilds its DOM element from scratch
     via the same renderCard() every creation/deserialise path already
     uses — correct and simple, at the cost of being a full teardown/
     rebuild instead of an in-place patch (fine for an occasional
     programmatic edit; NOT what drag/resize should use, which is why
     they keep their own lighter-weight paths). */
  /* Kept in sync BY HAND with the zod `patch` schema in
     official-plugins/mcp-bridge/server.js's updateCard tool — that's a
     separate, standalone Node/ESM script with no way to import this
     array directly. Update both if this list ever changes.
     'properties' (4.5.0) — the same custom key-value object the
     Properties panel (properties.js) edits in place; there's no
     dedicated get/set API for it, it's just a plain object field on
     the card, exactly like `tags`. If the Properties panel happens to
     be open for this exact card when a caller patches it this way,
     the panel's own DOM won't refresh until it's reopened — a known,
     minor gap, not something this pass fixes. */
  var UPDATABLE_FIELDS = ['name', 'text', 'url', 'color', 'tags', 'properties', 'x', 'y', 'w', 'h', 'pinned'];

  function updateCardData(id, patch) {
    var card = cards[id];
    if (!card) {
      console.error('[Kanvaz] updateCardData("' + id + '") — no card with that id, nothing changed');
      return null;
    }
    if (!patch || typeof patch !== 'object') {
      console.error('[Kanvaz] updateCardData("' + id + '") requires a patch object');
      return null;
    }

    var changed = false;
    var ignored = [];
    for (var k in patch) {
      if (Object.prototype.hasOwnProperty.call(patch, k) && UPDATABLE_FIELDS.indexOf(k) === -1) ignored.push(k);
    }
    if (ignored.length) {
      console.warn('[Kanvaz] updateCardData("' + id + '") — ignoring field(s) not in UPDATABLE_FIELDS: ' + ignored.join(', '));
    }

    for (var i = 0; i < UPDATABLE_FIELDS.length; i++) {
      var f = UPDATABLE_FIELDS[i];
      if (Object.prototype.hasOwnProperty.call(patch, f)) {
        card[f] = patch[f];
        changed = true;
      }
    }
    if (!changed) return card;

    /* w/h go through the same floor every other resize path enforces —
       a caller-supplied patch is exactly the kind of unchecked input
       createPluginCard() already has a near-identical guard for. */
    if (patch.w !== undefined) {
      var w = Number(card.w);
      card.w = (isFinite(w) && w > 0) ? Math.max(CARD_MIN_W, w) : CARD_MIN_W;
    }
    if (patch.h !== undefined) {
      var h = Number(card.h);
      card.h = (isFinite(h) && h > 0) ? Math.max(CARD_MIN_H, h) : CARD_MIN_H;
    }

    var wasSelected = (selectedId === id);
    var el = document.getElementById(id);
    /* Audit fix: same removeChild+renderCard rebuild as above leaked a
       3D card's live Three.js viewer (renderer/GPU context/geometries/
       textures/ResizeObserver/rAF loop) every time — buildModel3DCard()
       unconditionally overwrites model3dInstances[id] with a fresh
       instance, so the OLD one's dispose() was never called and just
       got dropped. Reachable via something as ordinary as renaming a 3D
       card (startRenameCard -> updateCardData), not just MCP/plugins —
       a few renames exhausts Chromium's ~16 WebGL-context limit. Same
       leak existed for a PDF file-ref card's pdf.js document. Both are
       already the exact functions rebuildCardMedia() calls for the same
       reason on its own rebuild path — mirrored here. */
    disposeModel3D(id);
    disposePdfPreview(id);
    if (el && el.parentNode) el.parentNode.removeChild(el);
    /* Audit fix: this removes+recreates the card's whole DOM element
       (needed since the patch can change type-dependent structure), but
       never told KanvazAnnotate — its overlays{} map kept pointing at
       the just-removed canvas, and attach()'s own `if (overlays[cardId])
       return` guard then blocked ever creating a fresh one. Reachable
       only via MCP Bridge's updateCard tool or a plugin (the UI's own
       card-editing paths don't route through here), but the result was
       a card's annotations silently going invisible until a full board
       reload — the strokes survive in card.annotations so nothing is
       actually lost, just unreachable on screen. Detach before removal,
       reattach after render so the overlay follows the new element. */
    if (typeof KanvazAnnotate !== 'undefined') KanvazAnnotate.detach(id);
    renderCard(card);
    if (card.annotations && card.annotations.length && typeof KanvazAnnotate !== 'undefined') {
      var newEl = document.getElementById(id);
      if (newEl) KanvazAnnotate.loadStrokes(id, card.annotations, newEl);
    }
    if (card.pinned) {
      var newEl = document.getElementById(id);
      if (newEl) newEl.classList.add('pinned');
    }
    if (wasSelected) selectCard(id);

    KanvazApp.markDirty();
    if (typeof KanvazHistory !== 'undefined') KanvazHistory.push();
    emitCardEvent('cardUpdate', card);
    return card;
  }

  /* Tag mutation currently only exists as a UI-input side effect buried
     inside buildTagBar()'s closures (see showTagInput's addTag() and the
     per-chip remove handler) — this is the standalone equivalent for a
     programmatic caller that just wants to set the full tag list.
     setTagsCore() does the actual mutation with no dirty/history/event
     side effects, so a batch caller (setTagsMultiple() below) can apply
     it to many cards behind one history push instead of one per card. */
  function setTagsCore(id, tags) {
    var card = cards[id];
    if (!card) {
      console.error('[Kanvaz] setTags("' + id + '") — no card with that id, nothing changed');
      return null;
    }
    /* Bug-bounty fix (v5.3.0): used to noteRecentTag() every tag in the
       new list, including ones the card already had — a bulk-tag over
       Map View's selection (setTagsMultiple, below) would re-surface
       every pre-existing tag on every selected card as "recently used",
       flooding the 8-slot recency list with old tags and burying the one
       tag the user actually just typed. Only the genuinely NEW tags
       (present now, absent from the card's previous list) count as a
       real "use" for recency purposes. */
    var prevTags = card.tags || [];
    card.tags = Array.isArray(tags) ? tags.slice() : [];
    for (var ti = 0; ti < card.tags.length; ti++) {
      if (prevTags.indexOf(card.tags[ti]) === -1) noteRecentTag(card.tags[ti]);
    }
    var el = document.getElementById(id);
    if (el) {
      var existingBar = el.querySelector('.tag-bar');
      if (existingBar) buildTagBar(el, card);
    }
    return card;
  }

  function setTags(id, tags) {
    var card = setTagsCore(id, tags);
    if (!card) return null;
    KanvazApp.markDirty();
    if (typeof KanvazHistory !== 'undefined') KanvazHistory.push();
    emitCardEvent('cardUpdate', card);
    return card;
  }

  /* v5.2.0 — fixes the known bulk-tag-undo-batching gap (flagged since
     v4.7.0): Map View's bulk "Tag" action used to call setTags() once per
     selected card, pushing one undo step per card instead of one for the
     whole batch — still fully undoable, just needed more than one Ctrl+Z
     for a large selection. ids: array of card ids. tagOf(id): function
     returning the full new tag array for that card (the caller already
     knows how to add/remove a tag from each card's existing list). */
  function setTagsMultiple(ids, tagOf) {
    if (!ids || !ids.length) return;
    var changedAny = false;
    for (var i = 0; i < ids.length; i++) {
      var newTags = tagOf(ids[i]);
      if (newTags && setTagsCore(ids[i], newTags)) changedAny = true;
    }
    if (changedAny) {
      KanvazApp.markDirty();
      if (typeof KanvazHistory !== 'undefined') KanvazHistory.push();
      for (var j = 0; j < ids.length; j++) {
        var c = cards[ids[j]];
        if (c) emitCardEvent('cardUpdate', c);
      }
    }
  }

  /* Pure, read-only — mirrors app.js's applySearchFilter() matching
     logic (name/type/tag substring, case-insensitive) but RETURNS
     matches instead of dimming DOM elements, since a programmatic
     caller (or a future in-app search-that-returns-results feature)
     needs data back, not a visual side effect. Deliberately not shared
     code with applySearchFilter() — that one is tightly coupled to
     el.style.opacity DOM mutation, this one has zero DOM dependency. */
  function search(query) {
    var q = (query || '').trim().toLowerCase();
    if (!q) return [];
    var out = [];
    for (var id in cards) {
      var c = cards[id];
      var nameMatch = (c.name || '').toLowerCase().indexOf(q) !== -1;
      var typeMatch = (c.type || '').toLowerCase().indexOf(q) !== -1;
      var tagMatch = false;
      if (c.tags && c.tags.length) {
        for (var t = 0; t < c.tags.length; t++) {
          if (c.tags[t].toLowerCase().indexOf(q) !== -1) { tagMatch = true; break; }
        }
      }
      if (nameMatch || typeMatch || tagMatch) out.push(c);
    }
    return out;
  }

  /* ── Duplicate ── */

  /* Clones one card and inserts the copy — no selection change, no
     history push, no dirty flag. Shared by the single and bulk paths,
     same split as removeCardCore/finishDelete above. */
  function duplicateCardCore(id) {
    var src = cards[id];
    if (!src) return null;

    var newCard;
    try {
      newCard = JSON.parse(JSON.stringify(src));
    } catch (e) {
      /* Audit fix: pluginData is arbitrary, plugin-controlled data with
         no guarantee of being JSON-safe (circular reference, a
         function, etc.). An uncaught clone failure here used to abort
         duplicateCardCore() entirely — and duplicateSelected()'s batch
         loop has no per-item try/catch, so one bad plugin card inside a
         multi-select duplicate silently aborted the WHOLE batch partway
         through, with nothing added and no error shown for that or any
         later card in the selection. Fall back to a shallow copy with
         pluginData dropped rather than hard-failing the batch. */
      console.error('[Kanvaz] duplicate: card "' + id + '" could not be deep-cloned (likely non-JSON-safe pluginData) — duplicating without it:', e.message);
      newCard = {};
      for (var k in src) {
        if (Object.prototype.hasOwnProperty.call(src, k)) newCard[k] = src[k];
      }
      newCard.pluginData = null;
    }
    newCard.id  = nextId();
    newCard.x  += 20;
    newCard.y  += 20;
    newCard.z   = ++zCounter;
    /* v6.4.0 — Duplicate always forks to an independent copy, even for a
       shared card. Keeping the same sharedId here would silently turn
       "Duplicate" into "add another linked instance to this same board"
       — a very different, much more surprising action than what
       Duplicate does for every other field, and one that already has
       its own explicit entry point ("Share to board"). */
    newCard.sharedId = null;

    cards[newCard.id] = newCard;
    renderCard(newCard);
    emitCardEvent('cardCreate', newCard);
    return newCard.id;
  }

  function duplicateCard(id) {
    var newId = duplicateCardCore(id);
    if (!newId) return;
    selectCard(newId);
    updateCount();
    KanvazApp.markDirty();
    KanvazHistory.push();
    KanvazUI.toast('Duplicated');
  }

  /* ── Create a card from a full serialised record (v6.5.0) ──
     Generic escape hatch: takes ANY card-shaped object matching what
     serialise()/deserialise() already round-trip (the exact shape a
     template file or a KanvazPluginAPI.getCards() clone already is) and
     inserts it into the LIVE board as one new card, without touching or
     clearing anything else already on the board — unlike deserialise(),
     which replaces the whole board's cards[] wholesale. This is what
     lets a plugin (the Template Maker & Manager official plugin, first)
     insert an arbitrary card type from a saved template, instead of
     being limited to registerCardType()'s own create() (which only ever
     makes ONE specific plugin-owned type, not "any card"). Always forks
     to a fresh, independent card — an imported/inserted card is never
     silently made a shared-card instance of whatever it happened to be
     shared with in its original file. */
  function createCardFromSerialized(data, x, y) {
    if (!data || typeof data.type !== 'string') return null;
    var c = {};
    for (var k in data) {
      if (Object.prototype.hasOwnProperty.call(data, k)) c[k] = data[k];
    }
    c.id = nextId();
    c.sharedId = null;
    if (typeof x === 'number') c.x = x;
    if (typeof y === 'number') c.y = y;
    c.z = ++zCounter;
    if (!c.tags) c.tags = [];
    if (!c.properties) c.properties = {};
    if (!c.annotations) c.annotations = [];
    if (c.opacity === undefined) c.opacity = 1.0;
    if (c.pinned === undefined) c.pinned = false;

    cards[c.id] = c;
    try {
      renderCard(c);
    } catch (e) {
      console.error('[Kanvaz] createCardFromSerialized: card "' + c.id + '" (type "' + c.type + '") failed to render — removing it:', e.message);
      delete cards[c.id];
      return null;
    }
    updateEmptyState();
    updateCount();
    if (typeof KanvazHistory !== 'undefined') KanvazHistory.push();
    emitCardEvent('cardCreate', c);
    return c.id;
  }

  /* Multi-select aware duplicate: one card behaves exactly as before;
     more than one duplicates the whole set behind one history push and
     selects the new copies (mirrors what a single Ctrl+D does — the
     result of the action becomes the new selection). */
  function duplicateSelected() {
    var ids = getSelectedIds();
    if (!ids.length) return;
    if (ids.length === 1) { duplicateCard(ids[0]); return; }

    var newIds = [];
    for (var i = 0; i < ids.length; i++) {
      var nid = duplicateCardCore(ids[i]);
      if (nid) newIds.push(nid);
    }
    if (!newIds.length) return;

    setMultiSelection(newIds);
    updateCount();
    KanvazApp.markDirty();
    KanvazHistory.push();
    KanvazUI.toast('Duplicated ' + newIds.length + ' cards');
  }

  /* ── Shared cards across boards (v6.4.0) ──
     "Share to board" turns THIS card into a shared card (assigning it a
     sharedId the first time, if it doesn't have one yet) and drops a new
     linked instance onto a different board — content stays in sync
     because both instances round-trip through KanvazBoards' registry on
     every save/load (see serialise()/deserialise() above). "Unlink" is
     the reverse: this one instance keeps its current content as its own
     private copy and stops listening to the shared registry. */
  function shareCardToBoard(id, targetBoardId) {
    var card = cards[id];
    if (!card) return { ok: false, error: 'card not found' };
    if (typeof KanvazBoards === 'undefined' || !KanvazBoards.newSharedId) {
      return { ok: false, error: 'boards module unavailable' };
    }

    /* Audit fix: card.sharedId used to be assigned and the registry
       written UNCONDITIONALLY, before knowing whether
       addSharedInstanceToBoard() would actually succeed (it refuses an
       unknown target board id, or the currently-active board). A failed
       call left the card with a sharedId set and a live registry entry
       for it, but zero board instances actually pointing at it anywhere
       — an orphaned "shared" card that isn't shared with anything, and
       whose badge never synced (syncSharedBadge only runs on success)
       so the inconsistency wasn't even visible. Track whether sharedId
       was newly assigned here so a failure can roll it — and the
       registry write — back to exactly the pre-call state. */
    var isNewSharedId = !card.sharedId;
    var sharedId = card.sharedId || KanvazBoards.newSharedId();

    /* Push current content into the registry right away (rather than
       waiting for the next save/switch) so the target board — which may
       become active before this one saves again — sees it immediately.
       buildFullCardRecord() is the same normalizer serialise() itself
       uses, so this can't drift from what an actual save would produce. */
    var full = buildFullCardRecord(card);
    full.sharedId = sharedId;
    var content = {};
    for (var ck in full) {
      if (SHARED_CARD_INSTANCE_FIELDS.indexOf(ck) === -1) content[ck] = full[ck];
    }
    KanvazBoards.setSharedCardContent(sharedId, content);

    var stub = { sharedId: sharedId, id: nextId(), x: card.x, y: card.y, w: card.w, h: card.h, z: card.z, pinned: false, opacity: 1.0, mapPosition: null };
    var result = KanvazBoards.addSharedInstanceToBoard(targetBoardId, stub);
    if (result.ok) {
      card.sharedId = sharedId;
      syncSharedBadge(card);
      KanvazApp.markDirty();
    } else if (isNewSharedId && typeof KanvazBoards.deleteSharedCardContent === 'function') {
      KanvazBoards.deleteSharedCardContent(sharedId);
    }
    return result;
  }

  /* Audit fix: used to return nothing at all — a bad id or a card that
     was never shared silently did nothing, indistinguishable from a real
     unlink to any caller. The MCP Bridge plugin's own unlinkSharedCard
     tool wrapped this and always reported {ok:true} regardless, since it
     had no signal to check. Returns a real boolean now so callers (and
     that plugin) can tell a no-op from an actual unlink. */
  function unlinkSharedCard(id) {
    var card = cards[id];
    if (!card || !card.sharedId) return false;
    card.sharedId = null;
    syncSharedBadge(card);
    KanvazApp.markDirty();
    KanvazHistory.push();
    KanvazUI.toast('Unlinked — this is now its own independent copy');
    return true;
  }

  /* Adds/removes the "shared" badge on an already-rendered card in place
     — deliberately NOT a full renderCard() re-run, which would append a
     second DOM element with the same id rather than replacing the first
     (renderCard() is only ever called for a card that doesn't have an
     element yet: initial deserialise, create, duplicate). */
  function syncSharedBadge(card) {
    var el = document.getElementById(card.id);
    if (!el) return;
    var titleRow = el.querySelector('.card-bar-title-row');
    if (!titleRow) return;
    var existing = titleRow.querySelector('.card-bar-shared-icon');
    if (card.sharedId) {
      if (!existing) {
        var b = document.createElement('span');
        b.className = 'card-bar-shared-icon';
        b.title = 'Shared across boards — editing it here updates every board it appears on';
        b.textContent = '⛓';
        titleRow.insertBefore(b, titleRow.firstChild);
      }
    } else if (existing) {
      existing.parentNode.removeChild(existing);
    }
  }

  /* ── Pin ── */

  function togglePin(id) {
    var card = cards[id];
    if (!card) return;
    card.pinned = !card.pinned;
    var el = document.getElementById(id);
    if (el) {
      if (card.pinned) {
        el.classList.add('pinned');
      } else {
        el.classList.remove('pinned');
      }
    }
    KanvazUI.toast(card.pinned ? 'Card pinned' : 'Card unpinned');
    KanvazApp.markDirty();
    KanvazHistory.push();
    emitCardEvent('cardUpdate', card);
  }

  /* Multi-select aware pin toggle: one card behaves exactly as before
     (including its own toast); more than one toggles every selected
     card to the SAME target state (based on the primary/last-selected
     card's current state) behind one toast and one history push,
     rather than N individual "Card pinned"/"Card unpinned" toasts that
     could each disagree if cards started in a mixed pinned state. */
  function togglePinSelected() {
    var ids = getSelectedIds();
    if (!ids.length) return;
    if (ids.length === 1) { togglePin(ids[0]); return; }

    var primary = cards[selectedId];
    var target = primary ? !primary.pinned : true;
    var changed = 0;

    for (var i = 0; i < ids.length; i++) {
      var card = cards[ids[i]];
      if (!card || card.pinned === target) continue;
      card.pinned = target;
      var el = document.getElementById(ids[i]);
      if (el) el.classList[target ? 'add' : 'remove']('pinned');
      changed++;
      emitCardEvent('cardUpdate', card);
    }

    if (!changed) return;
    KanvazUI.toast((target ? 'Pinned ' : 'Unpinned ') + changed + ' cards');
    KanvazApp.markDirty();
    KanvazHistory.push();
  }

  /* ── Helpers ── */

  function updateEmptyState() {
    var hasCards = Object.keys(cards).length > 0;
    KanvazApp.updateEmptyState(!hasCards);
  }

  function updateCount() {
    var n = Object.keys(cards).length;
    KanvazApp.updateCardCount(n);
  }

  /* ── Serialise / deserialise ── */

  /* Fields that stay per-instance even for a shared card — everything
     about WHERE/HOW it sits on THIS particular board, never what it
     actually is. Kept as an explicit list (not "everything else") so a
     future card field defaults to being SHARED (round-tripped through
     the registry, so every board sees the same content) unless someone
     deliberately decides it's per-placement and adds it here. */
  var SHARED_CARD_INSTANCE_FIELDS = ['id', 'sharedId', 'x', 'y', 'w', 'h', 'z', 'pinned', 'opacity', 'mapPosition'];

  /* Builds the full, unsplit record for a live card — every persisted
     field, shared-card content included. Used by BOTH serialise() (which
     then splits a shared card's record into registry-content + stub) and
     serialiseForHistory() (which needs the complete record every time,
     never a stub — see that function's own comment for why). Pulled out
     so the two callers can't drift on which fields exist or what their
     defaults are. */
  function buildFullCardRecord(c) {
    var strokes = (typeof KanvazAnnotate !== 'undefined')
      ? KanvazAnnotate.getStrokes(c.id)
      : (c.annotations || []);
    return {
      id:          c.id,
      type:        c.type,
      dataUrl:     c.dataUrl,
      name:        c.name,
      path:        c.path,
      x:           c.x,
      y:           c.y,
      w:           c.w,
      h:           c.h,
      z:           c.z,
      pinned:      c.pinned,
      text:        c.text || '',
      opacity:     c.opacity !== undefined ? c.opacity : 1.0,
      flipH:       c.flipH  || false,
      flipV:       c.flipV  || false,
      naturalW:    c.naturalW || c.w,
      naturalH:    c.naturalH || c.h,
      annotations: strokes,
      /* v3 fields */
      tags:        c.tags        || [],
      properties:  c.properties  || {},
      mapPosition: c.mapPosition || null,
      url:         c.url         || null,
      urlPreview:  c.urlPreview  || null,
      color:       c.color       || null,
      palette:     c.palette     || null,
      mimeType:    c.mimeType    || null,
      /* v4.2.0 — plugin-owned card types read/write this bucket
         directly (render(el, card) has the whole card object); a
         plugin's create()/render() are responsible for its shape,
         Kanvaz core just round-trips it opaquely. */
      pluginData:  c.pluginData  || null,
      /* v4 fields — per-card display/playback preferences. Each of
         these already has a "missing → default" fallback wherever
         it's read (objectFit in buildImageCard, playbackRate in
         buildVideoCard, audioLoop in buildAudioCard, colorFormat in
         buildColorCard), so omitting them here is silently "safe"
         but throws the feature away on every save — this whitelist
         has to be kept in sync by hand whenever a new persisted
         per-card field is added. */
      objectFit:    c.objectFit    || null,
      playbackRate: c.playbackRate || null,
      audioLoop:    c.audioLoop    || false,
      colorFormat:  c.colorFormat  || null,
      muted:        c.muted        !== undefined ? c.muted : null,
      /* v7.x — real per-card volume level (0–1), not just binary mute. */
      volume:       c.volume       !== undefined ? c.volume : null,
      /* v7.x — PDF preview's current page/zoom (file-ref cards pointing
         at a .pdf), same "missing → sensible default" fallback pattern
         as the rest of this per-card-display-preference block. */
      pdfPage:      c.pdfPage      || null,
      pdfZoom:      c.pdfZoom      || null,
      /* v7.x — 3D model preview display preferences (embedded model
         card, dataUrl holds the actual .glb/.gltf/.obj/.fbx bytes like
         any other media type). */
      modelFormat:      c.modelFormat      || null,
      renderMode:       c.renderMode       || null,
      bgColor:          c.bgColor          || null,
      animationPlaying: c.animationPlaying || false,
      /* v8.x — camera orbit position, now persisted (was deliberately
         NOT saved through v7.4.0-v8.2.0: "every load resets to a framed
         default view"). Revisited once 3D became this line's flagship
         identity rather than a launch-scope footnote. Plain {x,y,z}
         objects (not THREE.Vector3 instances) so this round-trips
         through JSON like every other card field. */
      cameraPosition:   c.cameraPosition   || null,
      cameraTarget:     c.cameraTarget     || null,
      /* v7.x — non-destructive image/video adjustments (setAdjustment,
         applied as a CSS filter, never touching dataUrl). Same
         "missing -> default" fallback as objectFit etc. above. */
      adjustBrightness: c.adjustBrightness !== undefined ? c.adjustBrightness : null,
      adjustContrast:   c.adjustContrast   !== undefined ? c.adjustContrast   : null,
      adjustSaturate:   c.adjustSaturate   !== undefined ? c.adjustSaturate   : null,
      /* v7.x — persistent card grouping (Ctrl+G/Ctrl+Shift+G). */
      groupId:      c.groupId      || null,
      /* v7.x — Layers panel visibility toggle (distinct from Isolate
         View's transient hide, which never touches this field). */
      hidden:       c.hidden       || false,
      /* v6.4.0 */
      sharedId:     c.sharedId     || null
    };
  }

  function serialise() {
    var out = [];
    for (var id in cards) {
      var c = cards[id];
      var full = buildFullCardRecord(c);

      /* v6.4.0 — shared cards: split into a content payload (pushed into
         KanvazBoards' cross-board registry) and a lightweight per-board
         stub (what actually gets stored in THIS board's cards[]). See
         boards.js's sharedCards block comment for the full design. */
      if (c.sharedId && typeof KanvazBoards !== 'undefined' && KanvazBoards.setSharedCardContent) {
        var content = {};
        for (var k in full) {
          if (SHARED_CARD_INSTANCE_FIELDS.indexOf(k) === -1) content[k] = full[k];
        }
        KanvazBoards.setSharedCardContent(c.sharedId, content);

        var stub = { sharedId: c.sharedId };
        for (var si = 0; si < SHARED_CARD_INSTANCE_FIELDS.length; si++) {
          var f = SHARED_CARD_INSTANCE_FIELDS[si];
          stub[f] = full[f];
        }
        out.push(stub);
      } else {
        out.push(full);
      }
    }
    return out;
  }

  /* v6.4.0 — used by history.js for undo/redo snapshots ONLY, never for
     the save file. Undo needs the complete live state of every card
     exactly as it was at that point in time, including a shared card's
     full content — serialise()'s stub/registry split is wrong here: the
     registry is a single mutable object with no undo history of its
     own, so restoring an old STUB against the CURRENT registry content
     would silently "un-revert" any shared-card edit undo is trying to
     roll back. No registry writes happen here either — snapshotting
     board state for undo must never have the side effect of overwriting
     other boards' view of a shared card. */
  function serialiseForHistory() {
    var out = [];
    for (var id in cards) {
      out.push(buildFullCardRecord(cards[id]));
    }
    return out;
  }

  function deserialise(arr) {
    clearAll();
    if (!arr) return;
    for (var i = 0; i < arr.length; i++) {
      var c = arr[i];

      /* v6.4.0 — shared cards. Two different shapes can arrive here with
         a sharedId set:
         (a) a save-file STUB — {sharedId, x, y, w, h, z, pinned, opacity,
             mapPosition} only, no `type` — needs its real content merged
             back in from KanvazBoards' registry, every time, so an edit
             made on a different board while this one wasn't active is
             picked up the moment this board becomes active again.
         (b) a FULL record with content already present — from
             KanvazHistory's undo/redo (serialiseForHistory() always
             returns full records, see its own comment for why). An
             undo/redo that reverts a shared card's content IS an edit —
             like any other edit to a shared card, it must be pushed back
             into the registry so other boards see the reverted content
             too, not silently ignored in favor of whatever's currently
             sitting in the registry. */
      if (c.sharedId) {
        if (c.type !== undefined) {
          if (typeof KanvazBoards !== 'undefined' && KanvazBoards.setSharedCardContent) {
            var restoredContent = {};
            for (var rk in c) {
              if (SHARED_CARD_INSTANCE_FIELDS.indexOf(rk) === -1) restoredContent[rk] = c[rk];
            }
            KanvazBoards.setSharedCardContent(c.sharedId, restoredContent);
          }
        } else {
          var sharedContent = (typeof KanvazBoards !== 'undefined' && KanvazBoards.getSharedCardContent)
            ? KanvazBoards.getSharedCardContent(c.sharedId)
            : null;
          if (sharedContent) {
            var merged = {};
            for (var ck in sharedContent) merged[ck] = sharedContent[ck];
            for (var fi = 0; fi < SHARED_CARD_INSTANCE_FIELDS.length; fi++) {
              var ff = SHARED_CARD_INSTANCE_FIELDS[fi];
              merged[ff] = c[ff];
            }
            merged.sharedId = c.sharedId;
            c = merged;
          } else {
            c.type = c.type || 'unknown';
          }
        }
      }

      /* Audit fix: this loop used to have no per-card isolation —
         `cards[c.id] = c` ran, then renderCard(c) ran, with nothing
         catching a throw from either. Since buildPluginCard() already
         has its own try/catch (a plugin render() failure degrades to
         buildUnknownCard and can't escape here), this is now a second,
         outer safety net for anything else that could throw in this
         loop body — without it, ANY uncaught exception partway through
         would silently truncate the board: every card at or after the
         failure point would never be added to cards{} at all, and a
         save right after would write a silently-shortened file. Wrap
         each card's full restore in try/catch so one bad entry is
         skipped (with a console error) instead of taking the rest of
         the board down with it. */
      try {
        /* v3 field defaults — ensures v2.x files load cleanly */
        if (!c.tags)        c.tags        = [];
        if (!c.properties)  c.properties  = {};
        if (!c.mapPosition) c.mapPosition = null;
        if (!c.url)         c.url         = null;
        if (!c.urlPreview)  c.urlPreview  = null;
        if (!c.color)       c.color       = null;
        if (!c.palette)     c.palette     = null;
        if (!c.mimeType)    c.mimeType    = null;
        if (!c.pluginData)  c.pluginData  = null;

        /* v4 field defaults — ensures pre-4.0 files (and files saved by
           the buggy 4.0.0 serialise() that dropped these) load cleanly.
           Render-time code also falls back per-field, this just keeps
           the in-memory card object's shape consistent right after load. */
        if (!c.objectFit)    c.objectFit    = null;
        if (!c.playbackRate) c.playbackRate = null;
        if (!c.audioLoop)    c.audioLoop    = false;
        if (!c.colorFormat)  c.colorFormat  = null;
        if (c.muted === undefined) c.muted  = null;
        if (c.volume === undefined) c.volume = null;
        if (!c.pdfPage) c.pdfPage = null;
        if (!c.pdfZoom) c.pdfZoom = null;
        if (!c.modelFormat) c.modelFormat = null;
        if (!c.renderMode)  c.renderMode  = 'normal';
        if (!c.bgColor)     c.bgColor     = null;
        if (c.animationPlaying === undefined) c.animationPlaying = false;
        if (!c.cameraPosition) c.cameraPosition = null;
        if (!c.cameraTarget)   c.cameraTarget   = null;
        if (c.sharedId === undefined) c.sharedId = null;

        cards[c.id] = c;
        renderCard(c);
        if (c.z > zCounter) zCounter = c.z;

        /* Restore opacity */
        if (c.opacity !== undefined && c.opacity !== 1.0) {
          var el = document.getElementById(c.id);
          if (el) el.style.opacity = c.opacity;
        }

        /* Restore annotations — BEFORE flip, so the annotation canvas
           (created by loadStrokes -> attach) already exists by the time
           flip-restore below looks for it. */
        if (c.annotations && c.annotations.length && typeof KanvazAnnotate !== 'undefined') {
          var cardEl = document.getElementById(c.id);
          if (cardEl) KanvazAnnotate.loadStrokes(c.id, c.annotations, cardEl);
        }

        /* Restore flip — also applies to the annotation overlay (audit
           fix: on load, only the media element was ever flipped; the
           overlay stayed unmirrored until the user manually re-flipped
           the card in that session). */
        if (c.flipH || c.flipV) {
          var fel = document.getElementById(c.id);
          if (fel) {
            var sx = c.flipH ? -1 : 1;
            var sy = c.flipV ? -1 : 1;
            var media = fel.querySelector('img, video');
            if (media) media.style.transform = 'scale(' + sx + ',' + sy + ')';
            var annotCanvas = fel.querySelector('.annotation-canvas');
            if (annotCanvas) annotCanvas.style.transform = 'scale(' + sx + ',' + sy + ')';
          }
        }
      } catch (e) {
        console.error('[Kanvaz] failed to load card' + (c && c.id ? ' "' + c.id + '"' : '') + ' — skipping it, the rest of the board will still load:', e.message);
      }
    }
    updateEmptyState();
    updateCount();
  }

  function clearAll() {
    if (typeof KanvazAnnotate !== 'undefined') KanvazAnnotate.detachAll();
    for (var id in cards) {
      var el = document.getElementById(id);
      if (el) {
        /* Audit fix: unlike removeCardCore (single-card delete), this
           path never paused video/audio before detaching it — and this
           is the path board switch, file open, AND every undo/redo
           runs through. A detached-but-still-playing <video>/<audio>
           keeps decoding (uncollectable) and, if unmuted, keeps
           playing audibly from a card that's no longer on screen.
           Clearing src + calling load() after pause fully releases the
           decoder instead of leaving it in limbo. */
        var mediaEl = el.querySelector('video, audio');
        if (mediaEl) {
          mediaEl.pause();
          mediaEl.removeAttribute('src');
          mediaEl.load();
        }
        disposeModel3D(id);
        disposePdfPreview(id);
        el.parentNode.removeChild(el);
      }
    }
    cards = {};
    selectedId = null;
    multiSelectedIds = [];
    updateEmptyState();
    updateCount();
  }

  function getAll() {
    return cards;
  }

  /* Real board thumbnails (replacing the Home Screen's gradient-banner
     placeholder) — a small offscreen canvas with one colored rectangle
     per card, same type-color scheme and "fit everything, 30% padding"
     framing as ui.js's own minimap (drawMinimap/computeWorld), kept as
     an independent copy rather than a shared dependency since a
     thumbnail is generated once at save time (boards.js's
     writeSerialisedBoardTo) and has no live viewport indicator or
     click-to-pan behavior to share with the minimap's own render loop.
     JPEG at modest quality, not PNG — this can run on every save, and
     a lossless PNG of even a simple rectangle collage is needlessly
     large for something that's just a small preview thumbnail. */
  function generateThumbnail() {
    var THUMB_W = 320, THUMB_H = 200;
    var ids = getAllIds();
    if (!ids.length) return null;

    var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (var i = 0; i < ids.length; i++) {
      var c = cards[ids[i]];
      if (c.x < minX) minX = c.x;
      if (c.y < minY) minY = c.y;
      if (c.x + c.w > maxX) maxX = c.x + c.w;
      if (c.y + c.h > maxY) maxY = c.y + c.h;
    }
    var boardW = Math.max(maxX - minX, 1) * 1.15;
    var boardH = Math.max(maxY - minY, 1) * 1.15;
    var midX = (minX + maxX) / 2;
    var midY = (minY + maxY) / 2;
    var scale = Math.min(THUMB_W / boardW, THUMB_H / boardH);

    var canvas = document.createElement('canvas');
    canvas.width = THUMB_W;
    canvas.height = THUMB_H;
    var ctx = canvas.getContext('2d');
    /* Read the theme's real surface color rather than hardcoding dark —
       same technique drawMinimap() (ui.js) already uses for its own
       viewport-indicator color, so a light theme gets a light-toned
       thumbnail background instead of a dark one baked in regardless. */
    var bg = getComputedStyle(document.documentElement).getPropertyValue('--color-surface').trim() || '#0E0E10';
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, THUMB_W, THUMB_H);

    for (var j = 0; j < ids.length; j++) {
      var card = cards[ids[j]];
      var color = card.type === 'note'  ? '#4CAF82'
                : card.type === 'video' ? '#F0A500'
                : card.type === 'gif'   ? '#4A9EFF'
                : card.type === 'audio' ? '#9D7FFF'
                : card.type === 'color' ? (card.color || '#DCDCE8')
                : '#DCDCE8';
      var rx = (THUMB_W / 2) + (card.x - midX) * scale;
      var ry = (THUMB_H / 2) + (card.y - midY) * scale;
      var rw = Math.max(2, card.w * scale);
      var rh = Math.max(2, card.h * scale);
      ctx.fillStyle = color;
      ctx.globalAlpha = 0.85;
      ctx.fillRect(rx, ry, rw, rh);
    }
    ctx.globalAlpha = 1;

    return canvas.toDataURL('image/jpeg', 0.6);
  }

  /* Export board/selection as PNG — unlike generateThumbnail() above
     (deliberately simplified colored rectangles, tiny and fast, run on
     every save), this draws each card's REAL content: the actual
     image/video/gif pixels via drawImage, a note's actual text
     (manually wrapped — canvas has no built-in text-wrap), a color
     card's actual fill. Capped to MAX_EXPORT_DIM on the long edge so a
     sprawling board doesn't produce a multi-hundred-megapixel canvas
     (Chromium has real per-canvas pixel limits, and nothing needs a
     print-resolution export of a reference board). Falls back to a
     plain labeled rectangle for card types with no single obvious
     "real content" to rasterize (url/file/model3d/audio/unknown) —
     still useful as a layout reference, just not pixel-faithful. */
  var MAX_EXPORT_DIM = 4096;
  var EXPORT_PADDING = 40;

  function wrapText(ctx, text, maxWidth) {
    var words = (text || '').split(/\s+/);
    var lines = [];
    var line = '';
    for (var i = 0; i < words.length; i++) {
      var test = line ? line + ' ' + words[i] : words[i];
      if (ctx.measureText(test).width > maxWidth && line) {
        lines.push(line);
        line = words[i];
      } else {
        line = test;
      }
    }
    if (line) lines.push(line);
    return lines;
  }

  function generateExportCanvas(ids) {
    var relevant = [];
    for (var i = 0; i < ids.length; i++) {
      var c = cards[ids[i]];
      if (c) relevant.push(c);
    }
    if (!relevant.length) return null;

    var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (var j = 0; j < relevant.length; j++) {
      var card = relevant[j];
      if (card.x < minX) minX = card.x;
      if (card.y < minY) minY = card.y;
      if (card.x + card.w > maxX) maxX = card.x + card.w;
      if (card.y + card.h > maxY) maxY = card.y + card.h;
    }
    var boardW = (maxX - minX) + EXPORT_PADDING * 2;
    var boardH = (maxY - minY) + EXPORT_PADDING * 2;
    var scale = Math.min(1, MAX_EXPORT_DIM / Math.max(boardW, boardH));

    var canvas = document.createElement('canvas');
    canvas.width = Math.round(boardW * scale);
    canvas.height = Math.round(boardH * scale);
    var ctx = canvas.getContext('2d');
    var bg = getComputedStyle(document.documentElement).getPropertyValue('--color-surface').trim() || '#1A1A22';
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    /* Reading order (top-to-bottom, left-to-right) so overlapping cards
       stack the same way they visually do on the real board (z-order
       isn't captured here — this is a flat export, not a live scene). */
    relevant.sort(function(a, b) { return (a.z || 0) - (b.z || 0); });

    for (var k = 0; k < relevant.length; k++) {
      var card2 = relevant[k];
      var rx = (card2.x - minX + EXPORT_PADDING) * scale;
      var ry = (card2.y - minY + EXPORT_PADDING) * scale;
      var rw = card2.w * scale;
      var rh = card2.h * scale;
      var el = document.getElementById(card2.id);
      var mediaEl = el ? el.querySelector('img, video') : null;

      if ((card2.type === 'image' || card2.type === 'gif') && mediaEl && mediaEl.tagName === 'IMG' && mediaEl.complete) {
        try { ctx.drawImage(mediaEl, rx, ry, rw, rh); } catch (e) { /* tainted/broken image — fall through to placeholder below */ }
      } else if (card2.type === 'video' && mediaEl && mediaEl.tagName === 'VIDEO' && mediaEl.readyState >= 2) {
        try { ctx.drawImage(mediaEl, rx, ry, rw, rh); } catch (e) { /* same fallback */ }
      } else if (card2.type === 'color') {
        ctx.fillStyle = card2.color || '#888888';
        ctx.fillRect(rx, ry, rw, rh);
      } else if (card2.type === 'note' || card2.type === 'text') {
        ctx.fillStyle = card2.type === 'note' ? 'rgba(157,127,255,0.12)' : 'rgba(0,0,0,0)';
        if (card2.type === 'note') ctx.fillRect(rx, ry, rw, rh);
        ctx.fillStyle = '#E8E8F0';
        var fontSize = Math.max(10, Math.round(14 * scale));
        ctx.font = fontSize + 'px sans-serif';
        var lines = wrapText(ctx, card2.text || '', rw - 16 * scale);
        for (var li = 0; li < lines.length && li * (fontSize * 1.3) < rh - 16 * scale; li++) {
          ctx.fillText(lines[li], rx + 8 * scale, ry + 8 * scale + (li + 1) * fontSize * 1.3);
        }
      } else {
        /* Placeholder for url/file/model3d/audio/unknown/plugin types. */
        ctx.fillStyle = 'rgba(220,220,232,0.08)';
        ctx.fillRect(rx, ry, rw, rh);
        ctx.strokeStyle = 'rgba(220,220,232,0.3)';
        ctx.strokeRect(rx, ry, rw, rh);
        ctx.fillStyle = '#9A9AA8';
        ctx.font = Math.max(9, Math.round(11 * scale)) + 'px sans-serif';
        ctx.fillText(getCardTypeLabel(card2), rx + 8 * scale, ry + 20 * scale);
      }
    }

    return canvas;
  }

  function exportAsImage(ids) {
    var canvas = generateExportCanvas(ids);
    if (!canvas) {
      if (typeof KanvazUI !== 'undefined') KanvazUI.toast('Nothing to export', 'error');
      return;
    }
    var dataUrl = canvas.toDataURL('image/png');
    var name = (ids.length === 1 && cards[ids[0]] && cards[ids[0]].name) || 'board';
    if (typeof KanvazBridge === 'undefined' || !KanvazBridge.exportImageSave) return;
    KanvazBridge.exportImageSave(name, dataUrl).then(function(res) {
      if (!res || res.cancelled) return;
      if (!res.ok) {
        if (typeof KanvazUI !== 'undefined') KanvazUI.toast('Export failed — ' + (res.error || 'unknown error'), 'error');
        return;
      }
      if (typeof KanvazUI !== 'undefined') KanvazUI.toast('Exported as image');
    });
  }

  /* ── Nudge (arrow keys) ── */

  var nudgeTimer = null;

  function nudge(id, dx, dy) {
    var card = cards[id];
    if (!card || card.pinned) return;
    card.x += dx;
    card.y += dy;
    var el = document.getElementById(id);
    if (el) {
      el.style.left = card.x + 'px';
      el.style.top  = card.y + 'px';
    }
    KanvazApp.markDirty();

    /* Debounced history push — wait 300ms after last nudge before
       recording, so holding an arrow key doesn't flood the undo stack
       with 50 entries of 1px moves. */
    if (nudgeTimer) clearTimeout(nudgeTimer);
    nudgeTimer = setTimeout(function() {
      nudgeTimer = null;
      KanvazHistory.push();
      emitCardEvent('cardUpdate', card);
    }, 300);
  }

  /* ── Align (multi-select) ──
     Photoshop/Illustrator-style: align every selected card's edge or
     center to the shared bounding box of the whole selection. Pinned
     cards are skipped (same "don't move a pinned card" rule nudge()
     already enforces) but still count toward the bounding box, so
     aligning around a pinned anchor card works as expected. One
     history push for the whole operation, not per-card — matches
     deleteMultiple()'s own convention for bulk operations. */
  function alignCards(ids, mode) {
    if (!ids || ids.length < 2) return;
    var relevant = [];
    for (var i = 0; i < ids.length; i++) {
      var c = cards[ids[i]];
      if (c) relevant.push(c);
    }
    if (relevant.length < 2) return;

    var minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (var j = 0; j < relevant.length; j++) {
      var r = relevant[j];
      if (r.x < minX) minX = r.x;
      if (r.x + r.w > maxX) maxX = r.x + r.w;
      if (r.y < minY) minY = r.y;
      if (r.y + r.h > maxY) maxY = r.y + r.h;
    }

    var changed = false;
    for (var k = 0; k < relevant.length; k++) {
      var card = relevant[k];
      if (card.pinned) continue;
      var newX = card.x, newY = card.y;
      if (mode === 'left') newX = minX;
      else if (mode === 'right') newX = maxX - card.w;
      else if (mode === 'center-h') newX = minX + (maxX - minX - card.w) / 2;
      else if (mode === 'top') newY = minY;
      else if (mode === 'bottom') newY = maxY - card.h;
      else if (mode === 'middle-v') newY = minY + (maxY - minY - card.h) / 2;

      if (newX !== card.x || newY !== card.y) {
        card.x = newX;
        card.y = newY;
        var el = document.getElementById(card.id);
        if (el) {
          el.style.left = newX + 'px';
          el.style.top = newY + 'px';
        }
        changed = true;
      }
    }

    if (changed) {
      KanvazApp.markDirty();
      KanvazHistory.push();
    }
  }

  /* Distribute evenly (axis: 'h' or 'v') — keeps the two outermost cards
     fixed and spaces every card between them so the GAPS are equal,
     matching Figma/Illustrator's "Distribute spacing" rather than
     "Distribute centers" (the more common expectation for reference
     boards, where cards are usually different sizes). Needs 3+ cards:
     with exactly 2 there's only one gap, nothing to make even. */
  function distributeCards(ids, axis) {
    if (!ids || ids.length < 3) return;
    var relevant = [];
    for (var i = 0; i < ids.length; i++) {
      var c = cards[ids[i]];
      if (c && !c.pinned) relevant.push(c);
    }
    if (relevant.length < 3) return;

    var sizeKey = axis === 'h' ? 'w' : 'h';
    var posKey = axis === 'h' ? 'x' : 'y';
    relevant.sort(function(a, b) { return a[posKey] - b[posKey]; });

    var first = relevant[0];
    var last = relevant[relevant.length - 1];
    var span = (last[posKey] + last[sizeKey]) - first[posKey];
    var totalSize = 0;
    for (var j = 0; j < relevant.length; j++) totalSize += relevant[j][sizeKey];
    var gap = (span - totalSize) / (relevant.length - 1);

    var changed = false;
    var cursor = first[posKey];
    for (var k = 0; k < relevant.length; k++) {
      var card = relevant[k];
      var newPos = (k === 0) ? card[posKey] : cursor;
      if (newPos !== card[posKey]) {
        card[posKey] = newPos;
        var el = document.getElementById(card.id);
        if (el) el.style[axis === 'h' ? 'left' : 'top'] = newPos + 'px';
        changed = true;
      }
      cursor = card[posKey] + card[sizeKey] + gap;
    }

    if (changed) {
      KanvazApp.markDirty();
      KanvazHistory.push();
    }
  }

  /* Card grouping (Ctrl+G / Ctrl+Shift+G) — a persistent grouping, unlike
     the transient multi-selection above: clicking any member later
     re-selects the whole group (see the world mousedown handler), and
     dragging any member already moves the whole group for free via the
     existing multi-select group-drag in startDrag(). Deliberately just
     a shared `groupId` string on each card, no separate group entity to
     keep in sync — "every card with this id" IS the group. */
  function getGroupMembers(groupId) {
    if (!groupId) return [];
    var allIds = getAllIds();
    var members = [];
    for (var i = 0; i < allIds.length; i++) {
      var c = cards[allIds[i]];
      if (c && c.groupId === groupId) members.push(allIds[i]);
    }
    return members;
  }

  function groupCards(ids) {
    if (!ids || ids.length < 2) return;
    var groupId = 'group-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    var changed = false;
    for (var i = 0; i < ids.length; i++) {
      var c = cards[ids[i]];
      if (c) { c.groupId = groupId; changed = true; }
    }
    if (changed) {
      KanvazApp.markDirty();
      KanvazHistory.push();
      if (typeof KanvazUI !== 'undefined') KanvazUI.toast('Grouped ' + ids.length + ' cards');
    }
  }

  /* Ungroups every group touched by the given ids — if the selection
     spans two different existing groups, both are dissolved, matching
     Illustrator's own "Ungroup acts on every selected group" behavior
     rather than picking just one arbitrarily. */
  function ungroupCards(ids) {
    if (!ids || !ids.length) return;
    var groupIdsToClear = {};
    for (var i = 0; i < ids.length; i++) {
      var c = cards[ids[i]];
      if (c && c.groupId) groupIdsToClear[c.groupId] = true;
    }
    var keys = Object.keys(groupIdsToClear);
    if (!keys.length) return;
    var allIds = getAllIds();
    var changed = false;
    for (var j = 0; j < allIds.length; j++) {
      var card = cards[allIds[j]];
      if (card && card.groupId && groupIdsToClear[card.groupId]) {
        card.groupId = null;
        changed = true;
      }
    }
    if (changed) {
      KanvazApp.markDirty();
      KanvazHistory.push();
      if (typeof KanvazUI !== 'undefined') KanvazUI.toast('Ungrouped');
    }
  }

  /* Every card id currently on the board, in no particular order — a
     thin wrapper so callers (the canvas right-click menu's "Tidy up
     board") don't need their own reference to the module-private
     `cards` object. */
  function getAllIds() {
    return Object.keys(cards);
  }

  /* Isolate View (Shift+I) — Maya/Blender's own "hide everything except
     what's selected, then bring it all back" toggle. Applied purely as a
     DOM class (.card-isolated-hidden, see main.css) rather than any
     stored id list: exiting just strips the class from whatever
     currently has it, which stays correct even if a card was created or
     deleted while isolated — no stale-id bookkeeping to get wrong. */
  function isIsolateActive() {
    return isolateActive;
  }

  function toggleIsolate() {
    if (isolateActive) exitIsolate();
    else enterIsolate();
  }

  function enterIsolate() {
    var selected = getSelectedIds();
    if (!selected.length) {
      if (typeof KanvazUI !== 'undefined') KanvazUI.toast('Select one or more cards first', 'error');
      return;
    }
    var selectedSet = {};
    for (var i = 0; i < selected.length; i++) selectedSet[selected[i]] = true;
    var allIds = getAllIds();
    for (var j = 0; j < allIds.length; j++) {
      if (!selectedSet[allIds[j]]) {
        var el = document.getElementById(allIds[j]);
        if (el) el.classList.add('card-isolated-hidden');
      }
    }
    isolateActive = true;
    if (typeof KanvazUI !== 'undefined') KanvazUI.toast('Isolate view on — Shift+I to exit');
  }

  function exitIsolate() {
    var hidden = document.querySelectorAll('.card-isolated-hidden');
    for (var i = 0; i < hidden.length; i++) hidden[i].classList.remove('card-isolated-hidden');
    isolateActive = false;
    if (typeof KanvazUI !== 'undefined') KanvazUI.toast('Isolate view off');
  }

  /* Tidy up — packs cards into a grid, closest thing this app has to
     Miro/Figma's "Tidy up" or Blender's "Arrange". Sorts by current
     reading order (top-to-bottom, then left-to-right) so the resulting
     grid roughly preserves the layout's existing sense of order instead
     of scrambling it, then lays cards out in a roughly square grid sized
     off the LARGEST card in the set — every cell is uniform, so a mix of
     card sizes doesn't overlap, at the cost of extra whitespace around
     smaller cards. Anchored at the selection's own top-left corner
     rather than some fixed board origin, so tidying a group in the
     middle of a busy board doesn't relocate it across the canvas. */
  var TIDY_GAP = 24;
  function tidyUp(ids) {
    if (!ids || ids.length < 2) return;
    var relevant = [];
    for (var i = 0; i < ids.length; i++) {
      var c = cards[ids[i]];
      if (c && !c.pinned) relevant.push(c);
    }
    if (relevant.length < 2) return;

    relevant.sort(function(a, b) { return (a.y - b.y) || (a.x - b.x); });

    var originX = Infinity, originY = Infinity, maxW = 0, maxH = 0;
    for (var j = 0; j < relevant.length; j++) {
      if (relevant[j].x < originX) originX = relevant[j].x;
      if (relevant[j].y < originY) originY = relevant[j].y;
      if (relevant[j].w > maxW) maxW = relevant[j].w;
      if (relevant[j].h > maxH) maxH = relevant[j].h;
    }

    var columns = Math.max(1, Math.ceil(Math.sqrt(relevant.length)));
    var cellW = maxW + TIDY_GAP;
    var cellH = maxH + TIDY_GAP;
    var changed = false;

    for (var k = 0; k < relevant.length; k++) {
      var card = relevant[k];
      var row = Math.floor(k / columns);
      var col = k % columns;
      var newX = originX + col * cellW;
      var newY = originY + row * cellH;
      if (newX !== card.x || newY !== card.y) {
        card.x = newX;
        card.y = newY;
        var el = document.getElementById(card.id);
        if (el) {
          el.style.left = newX + 'px';
          el.style.top = newY + 'px';
        }
        changed = true;
      }
    }

    if (changed) {
      KanvazApp.markDirty();
      KanvazHistory.push();
    }
  }

  /* ── Send to back ── */

  function sendToBack(id) {
    var card = cards[id];
    if (!card) return;
    card.z = --backCounter;
    var el = document.getElementById(id);
    if (el) el.style.zIndex = card.z;
    KanvazApp.markDirty();
    KanvazHistory.push();
    emitCardEvent('cardUpdate', card);
  }

  /* ── Flip ── */

  function flipCard(id, axis) {
    var card = cards[id];
    if (!card) return;
    /* Only visual media cards can be flipped — note/color/audio/text have
       no img/video element and flipping them would just corrupt flipH/
       flipV state that never gets used. */
    if (card.type === 'note' || card.type === 'color' || card.type === 'audio' || card.type === 'url' || card.type === 'file' || card.type === 'text') return;
    if (!card.flipH) card.flipH = false;
    if (!card.flipV) card.flipV = false;
    if (axis === 'h') card.flipH = !card.flipH;
    if (axis === 'v') card.flipV = !card.flipV;
    var el = document.getElementById(id);
    if (el) {
      var sx = card.flipH ? -1 : 1;
      var sy = card.flipV ? -1 : 1;
      var media = el.querySelector('img, video');
      if (media) media.style.transform = 'scale(' + sx + ',' + sy + ')';
      /* Audit fix: the annotation overlay is a SIBLING of the media
         element, not a child, so it was never touched by the transform
         above — circle a detail, flip the card, and the circle stays
         put while the image mirrors under it, now marking the wrong
         spot. Applying the identical transform to the overlay canvas
         flips the drawn pixels right along with the image, with no
         need to re-project the stored stroke coordinates. */
      var annotCanvas = el.querySelector('.annotation-canvas');
      if (annotCanvas) annotCanvas.style.transform = 'scale(' + sx + ',' + sy + ')';
    }
    KanvazApp.markDirty();
    KanvazHistory.push();
    emitCardEvent('cardUpdate', card);
  }

  /* ── Direct transform edit (Properties panel's X/Y/W/H fields) ──
     `patch` supplies only the keys the user actually changed (e.g. just
     {x: 120}), so this only touches what's given rather than requiring
     every field on every call. Mirrors resetSize()'s own pattern for
     applying a size change: clamp to the same CARD_MIN_W/H floor the
     drag-resize handles already enforce, rescale the annotation overlay
     via KanvazAnnotate.resize() when the size actually changes (same as
     resetSize — an annotation layer sized for the OLD dimensions would
     otherwise misalign the moment the card resizes), markDirty + push
     history once for the whole patch rather than per-field. */
  function setTransform(id, patch, persist) {
    var card = cards[id];
    if (!card || !patch) return;
    var el = document.getElementById(id);

    if (typeof patch.x === 'number' && isFinite(patch.x)) {
      card.x = patch.x;
      if (el) el.style.left = card.x + 'px';
    }
    if (typeof patch.y === 'number' && isFinite(patch.y)) {
      card.y = patch.y;
      if (el) el.style.top = card.y + 'px';
    }

    var sizeChanged = false;
    if (typeof patch.w === 'number' && isFinite(patch.w)) {
      card.w = Math.max(CARD_MIN_W, Math.round(patch.w));
      if (el) el.style.width = card.w + 'px';
      sizeChanged = true;
    }
    if (typeof patch.h === 'number' && isFinite(patch.h)) {
      card.h = Math.max(CARD_MIN_H, Math.round(patch.h));
      if (el) el.style.height = card.h + 'px';
      sizeChanged = true;
    }
    if (sizeChanged && typeof KanvazAnnotate !== 'undefined') {
      KanvazAnnotate.resize(id, card.w, card.h);
    }

    /* persist:false (drag-to-scrub Properties panel fields — see
       properties.js) applies the live value every tick, same as any
       other caller, but skips markDirty/history/emitCardEvent on every
       single pixel of mouse movement — same reasoning as nudge()'s own
       debounce just above: recording 60 history entries for one drag
       gesture would flood undo. The scrub handler calls this once more
       with persist left at its default (true) on mouseup for the real
       commit. */
    if (persist === false) return;

    KanvazApp.markDirty();
    KanvazHistory.push();
    emitCardEvent('cardUpdate', card);
  }

  /* ── Reset size to natural dimensions capped at 600px ── */

  function resetSize(id) {
    var card = cards[id];
    if (!card) return;
    var w = Math.min(card.naturalW || card.w, KanvazMedia.MAX_DROP_WIDTH);
    var ratio = w / (card.naturalW || card.w);
    var h = Math.round((card.naturalH || card.h) * ratio);
    card.w = w;
    card.h = h;
    var el = document.getElementById(id);
    if (el) {
      el.style.width  = w + 'px';
      el.style.height = h + 'px';
    }
    if (typeof KanvazAnnotate !== 'undefined') {
      KanvazAnnotate.resize(id, Math.round(w), Math.round(h));
    }
    KanvazApp.markDirty();
    KanvazHistory.push();
    emitCardEvent('cardUpdate', card);
  }

  /* ── Opacity picker ── */

  function showOpacityPicker(id, x, y) {
    var existing = document.getElementById('opacity-picker');
    if (existing) existing.parentNode.removeChild(existing);

    var card = cards[id];
    if (!card) return;
    var currentOpacity = card.opacity !== undefined ? card.opacity : 1.0;

    var picker = document.createElement('div');
    picker.id = 'opacity-picker';
    picker.style.cssText = [
      'position:fixed',
      'left:' + x + 'px',
      'top:' + y + 'px',
      'background:var(--color-surface)',
      'border:1px solid var(--color-border-2)',
      'border-radius:8px',
      'padding:12px 14px',
      'z-index:20001',
      'box-shadow:0 8px 24px rgba(0,0,0,0.6)',
      'min-width:180px'
    ].join(';');

    var label = document.createElement('div');
    label.style.cssText = 'font-size:11px;color:var(--color-text-3);margin-bottom:8px;text-transform:uppercase;letter-spacing:0.06em;';
    label.textContent = 'Opacity';
    picker.appendChild(label);

    var row = document.createElement('div');
    row.style.cssText = 'display:flex;align-items:center;gap:10px;';

    var slider = document.createElement('input');
    slider.type = 'range';
    slider.min = 0.1;
    slider.max = 1.0;
    slider.step = 0.05;
    slider.value = currentOpacity;
    slider.style.cssText = 'flex:1;accent-color:var(--color-accent);';

    var valLabel = document.createElement('span');
    valLabel.style.cssText = 'font-family:var(--font-mono);font-size:11px;color:var(--color-text-2);min-width:32px;text-align:right;';
    valLabel.textContent = Math.round(currentOpacity * 100) + '%';

    slider.oninput = function() {
      var val = parseFloat(slider.value);
      card.opacity = val;
      valLabel.textContent = Math.round(val * 100) + '%';
      var el = document.getElementById(id);
      if (el) el.style.opacity = val;
      KanvazApp.markDirty();
    };

    row.appendChild(slider);
    row.appendChild(valLabel);
    picker.appendChild(row);
    document.body.appendChild(picker);

    /* Auto-close on outside click */
    setTimeout(function() {
      document.addEventListener('mousedown', function closePicker(e) {
        if (!picker.contains(e.target)) {
          if (picker.parentNode) picker.parentNode.removeChild(picker);
          document.removeEventListener('mousedown', closePicker);
          KanvazHistory.push();
          emitCardEvent('cardUpdate', card);
        }
      });
    }, 50);
  }

  /* ── Share to board picker (v6.4.0) ──
     Lists every OTHER board (the active one is excluded — you already
     have this card here) and drops a shared instance onto whichever one
     is clicked. Modeled directly on showOpacityPicker's popover pattern
     just above. */
  function showShareToBoardPicker(id, x, y) {
    var existing = document.getElementById('share-board-picker');
    if (existing) existing.parentNode.removeChild(existing);

    var card = cards[id];
    if (!card) return;
    if (typeof KanvazBoards === 'undefined' || !KanvazBoards.listBoardsInfo) return;

    var allBoards = KanvazBoards.listBoardsInfo();
    var others = allBoards.filter(function(b) { return !b.active; });

    var picker = document.createElement('div');
    picker.id = 'share-board-picker';
    picker.style.cssText = [
      'position:fixed',
      'left:' + x + 'px',
      'top:' + y + 'px',
      'background:var(--color-surface)',
      'border:1px solid var(--color-border-2)',
      'border-radius:8px',
      'padding:8px',
      'z-index:20001',
      'box-shadow:0 8px 24px rgba(0,0,0,0.6)',
      'min-width:180px',
      'max-height:280px',
      'overflow-y:auto'
    ].join(';');

    var label = document.createElement('div');
    label.style.cssText = 'font-size:11px;color:var(--color-text-3);margin:2px 6px 8px;text-transform:uppercase;letter-spacing:0.06em;';
    label.textContent = 'Share to board';
    picker.appendChild(label);

    if (!others.length) {
      var empty = document.createElement('div');
      empty.style.cssText = 'font-size:12px;color:var(--color-text-3);padding:6px;';
      empty.textContent = 'No other boards yet — create one first.';
      picker.appendChild(empty);
    }

    for (var oi = 0; oi < others.length; oi++) {
      (function(b) {
        var row = document.createElement('div');
        row.style.cssText = 'padding:7px 8px;border-radius:5px;cursor:pointer;font-size:13px;color:var(--color-text);';
        row.textContent = b.name;
        row.onmouseenter = function() { row.style.background = 'var(--color-surface-2)'; };
        row.onmouseleave = function() { row.style.background = 'transparent'; };
        row.onclick = function() {
          var result = shareCardToBoard(id, b.id);
          if (picker.parentNode) picker.parentNode.removeChild(picker);
          if (result.ok) {
            KanvazHistory.push();
            KanvazUI.toast('Shared to "' + b.name + '"', 'success');
          } else {
            KanvazUI.toast(result.error || 'Could not share this card', 'error');
          }
        };
        picker.appendChild(row);
      })(others[oi]);
    }

    document.body.appendChild(picker);

    setTimeout(function() {
      document.addEventListener('mousedown', function closePicker(e) {
        if (!picker.contains(e.target)) {
          if (picker.parentNode) picker.parentNode.removeChild(picker);
          document.removeEventListener('mousedown', closePicker);
        }
      });
    }, 50);
  }

  /* ── Select all ── */

  function selectAll() {
    var ids = Object.keys(cards);
    if (!ids.length) return;
    for (var i = 0; i < ids.length; i++) {
      var el = document.getElementById(ids[i]);
      if (el) el.classList.add('selected');
    }
    multiSelectedIds = ids.slice();
    selectedId = ids[ids.length - 1];
    KanvazUI.toast('All ' + ids.length + ' cards selected');
    emitSelectionChange();
  }

  function deselectAll() {
    clearSelectionVisuals();
    selectedId = null;
    multiSelectedIds = [];
    emitSelectionChange();
  }

  /* Dev Mode — bulk-generate N synthetic note cards for stress-testing
     render/scroll/zoom performance at scale. Deliberately bypasses
     createNote()'s per-card selectCard()/focus()/history-push — doing
     that N times for N=50-100 would thrash badly. One history push,
     one render pass, at the end. */
  function generateTestCards(n, baseX, baseY) {
    var cols = Math.max(1, Math.ceil(Math.sqrt(n)));
    for (var i = 0; i < n; i++) {
      var id = nextId();
      var col = i % cols;
      var row = Math.floor(i / cols);
      var card = {
        id: id, type: 'note', dataUrl: null,
        name: 'Test card ' + (i + 1),
        path: null,
        x: baseX + col * 280, y: baseY + row * 200,
        w: 240, h: 160, z: ++zCounter, pinned: false,
        text: 'Generated test card #' + (i + 1) + ' for stress-testing.',
        annotations: [],
        tags: [], properties: {}, mapPosition: null,
        url: null, color: null, mimeType: null
      };
      cards[id] = card;
      renderCard(card);
    }
    updateEmptyState();
    updateCount();
    if (typeof KanvazHistory !== 'undefined') KanvazHistory.push();
  }

  return {
    init:              init,
    createFromMedia:   createFromMedia,
    createFromDataUrl: createFromDataUrl,
    createNote:        createNote,
    createTextCard:    createTextCard,
    createColorCard:   createColorCard,
    createUrlCard:     createUrlCard,
    createFileRefCard: createFileRefCard,
    createFileRefCardAtPath: createFileRefCardAtPath,
    createPluginCard: createPluginCard,
    generateTestCards: generateTestCards,
    selectCard:        selectCard,
    selectAll:         selectAll,
    setMultiSelection: setMultiSelection,
    deselectAll:       deselectAll,
    deleteCard:        deleteCard,
    deleteCardImmediate: deleteCardImmediate,
    deleteSelected:    deleteSelected,
    updateCardData:    updateCardData,
    setTags:           setTags,
    setTagsMultiple:   setTagsMultiple,
    search:            search,
    startRenameCard:   startRenameCard,
    deleteMultiple:    deleteMultiple,
    duplicateCard:     duplicateCard,
    duplicateSelected: duplicateSelected,
    createCardFromSerialized: createCardFromSerialized,
    shareCardToBoard:  shareCardToBoard,
    unlinkSharedCard:  unlinkSharedCard,
    showShareToBoardPicker: showShareToBoardPicker,
    togglePin:         togglePin,
    togglePinSelected: togglePinSelected,
    bringToFront:      bringToFront,
    sendToBack:        sendToBack,
    flipCard:          flipCard,
    resetSize:         resetSize,
    setTransform:      setTransform,
    alignCards:        alignCards,
    distributeCards:   distributeCards,
    tidyUp:            tidyUp,
    getAllIds:         getAllIds,
    toggleIsolate:     toggleIsolate,
    isIsolateActive:   isIsolateActive,
    groupCards:        groupCards,
    ungroupCards:      ungroupCards,
    getGroupMembers:   getGroupMembers,
    toggleCardVisibility: toggleCardVisibility,
    renderLayersInto:  renderLayersInto,
    reorderLayers:     reorderLayers,
    showOpacityPicker: showOpacityPicker,
    toggleObjectFit:   toggleObjectFit,
    setAdjustment:     setAdjustment,
    showSpeedPicker:   showSpeedPicker,
    refreshAnnotationDot: refreshAnnotationDot,
    nudge:             nudge,
    serialise:         serialise,
    serialiseForHistory: serialiseForHistory,
    deserialise:       deserialise,
    clearAll:          clearAll,
    resetSessionState: resetSessionState,
    getAll:            getAll,
    generateThumbnail: generateThumbnail,
    generateExportCanvas: generateExportCanvas,
    exportAsImage:     exportAsImage,
    getSelected:       function() { return selectedId; },
    getSelectedIds:    getSelectedIds,
    getModel3DControls: getModel3DControls
  };

})();
