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
                                  0 or 1 in the common case; >1 only after
                                  Select All (Ctrl+A) — there's no rectangle/
                                  shift-click multi-select in this app yet. */
  var world = null;
  var zCounter = 1;

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
      selectCard(card.id);
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
      selectCard(card.id);
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
        emitCardEvent('cardUpdate', card);
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
    var aspectLock  = !e.shiftKey;
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
      if (aspectLock && card.type !== 'note' && card.type !== 'audio' && card.type !== 'url' && card.type !== 'file' && card.type !== 'text' && isCorner) {
        newH = newW / aspectRatio;
      }

      if (aspectLock && isCorner) {
        /* Snap width only, then re-derive height from the snapped width
           — snapping both dimensions independently would distort the
           locked aspect ratio (e.g. a 4:3 image ending up 1:1-ish). */
        newW = snapToGrid(newW);
        newH = newW / aspectRatio;
      } else {
        newW = snapToGrid(newW);
        newH = snapToGrid(newH);
      }

      newW = Math.max(CARD_MIN_W, newW);
      newH = Math.max(CARD_MIN_H, newH);

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

  var PLAY_ICON  = '<svg viewBox="0 0 10 10" fill="currentColor"><polygon points="1,1 9,5 1,9"/></svg>';
  var PAUSE_ICON = '<svg viewBox="0 0 10 10" fill="currentColor"><rect x="1" y="1" width="3" height="8"/><rect x="6" y="1" width="3" height="8"/></svg>';
  var MUTE_ICON  = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M3 5.5h2l3-3v11l-3-3H3a1 1 0 0 1-1-1v-3a1 1 0 0 1 1-1z"/><line x1="12" y1="5" x2="12" y2="11" stroke-linecap="round"/><line x1="14.5" y1="3.5" x2="14.5" y2="12.5" stroke-linecap="round"/></svg>';
  var MUTED_ICON = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M3 5.5h2l3-3v11l-3-3H3a1 1 0 0 1-1-1v-3a1 1 0 0 1 1-1z"/><line x1="11" y1="5.5" x2="15" y2="10.5" stroke-linecap="round"/><line x1="15" y1="5.5" x2="11" y2="10.5" stroke-linecap="round"/></svg>';
  /* v6.x — ArtDeck-inspired frame analysis tools */
  var FRAME_BACK_ICON    = '<svg viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="1.3"><path d="M6.5 1.5L2 5l4.5 3.5" stroke-linecap="round" stroke-linejoin="round"/><line x1="1" y1="1" x2="1" y2="9" stroke-linecap="round"/></svg>';
  var FRAME_FORWARD_ICON = '<svg viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="1.3"><path d="M3.5 1.5L8 5l-4.5 3.5" stroke-linecap="round" stroke-linejoin="round"/><line x1="9" y1="1" x2="9" y2="9" stroke-linecap="round"/></svg>';
  var ONION_SKIN_ICON     = '<svg viewBox="0 0 14 14" fill="none"><circle cx="5.5" cy="7" r="4" fill="currentColor" opacity="0.35"/><circle cx="8.5" cy="7" r="4" stroke="currentColor" stroke-width="1.3"/></svg>';
  var LOOP_ICON  = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M2 8a6 6 0 0 1 10.5-4"/><path d="M14 8a6 6 0 0 1-10.5 4"/><path d="M12 1.2v3.5H8.5"/><path d="M4 14.8v-3.5H7.5"/></svg>';
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
      vid.play();
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
    }
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
    if (typeof KanvazPluginAPI === 'undefined' || !KanvazPluginAPI._emit) return;
    KanvazPluginAPI._emit(type, card);
  }

  function emitSelectionChange() {
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
    var size = sizeFor('file', 220, 90);
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
  var ANNOTATION_DOT_ICON = '<svg viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><path d="M8.5 1.5l2 2L4 10 1.5 10.5 2 8z"/></svg>';

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
      KanvazMedia.loadFromPath(p, function(result, err) {
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

        var el = document.getElementById(id);
        if (el) {
          el.classList.remove('card-error');
          var errBox = el.querySelector('.card-error-state');
          if (errBox) errBox.parentNode.removeChild(errBox);
          var relinkBtn = el.querySelector('.card-relink-btn');
          if (relinkBtn) relinkBtn.parentNode.removeChild(relinkBtn);
          rebuildCardMedia(el, card);
          var nameEl = el.querySelector('.card-filename');
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

    if (card.type === 'image')      buildImageCard(el, card);
    else if (card.type === 'gif')   buildGifCard(el, card);
    else if (card.type === 'video') buildVideoCard(el, card);
    else if (card.type === 'audio') buildAudioCard(el, card);
  }

  /* ── Image card ── */

  function buildImageCard(el, card) {
    if (!card.objectFit) card.objectFit = 'cover';

    var skeleton = document.createElement('div');
    skeleton.className = 'card-skeleton';
    el.appendChild(skeleton);

    var img = document.createElement('img');
    img.src = card.dataUrl;
    img.style.cssText = 'display:block;width:100%;height:100%;object-fit:' + card.objectFit + ';pointer-events:none;';

    img.onload = function() {
      removeSkeleton(el);
      var dims = el.querySelector('.card-dims');
      if (dims) dims.textContent = img.naturalWidth + '×' + img.naturalHeight;
    };
    img.onerror = function() {
      removeSkeleton(el);
      img.style.display = 'none';
      showMediaError(el, card);
    };

    el.appendChild(img);
    buildAnnotationDot(el, card);
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
    img.style.cssText = 'display:block;width:100%;height:calc(100% - 24px);object-fit:cover;cursor:pointer;';
    img.title = 'Click to pause / resume';
    img._origSrc = card.dataUrl;
    img._paused = false;

    img.onload = function() { removeSkeleton(el); };
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
    vid.style.cssText = 'display:block;width:100%;object-fit:cover;pointer-events:none;';

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
      vid.play();
      playBtn.innerHTML = PAUSE_ICON;
    };

    vid.onloadedmetadata = function() {
      var durBadge = el.querySelector('.card-duration');
      if (durBadge && vid.duration) durBadge.textContent = KanvazMedia.formatTime(vid.duration);
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

    scrub.appendChild(playBtn);
    scrub.appendChild(frameBackBtn);
    scrub.appendChild(frameForwardBtn);
    scrub.appendChild(onionBtn);
    scrub.appendChild(track);
    scrub.appendChild(timeEl);
    scrub.appendChild(muteBtn);
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
      var badge = el.querySelector('.badge-audio');
      if (badge && aud.duration) badge.textContent = 'AUDIO · ' + KanvazMedia.formatTime(aud.duration);
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

    scrub.appendChild(playBtn);
    scrub.appendChild(track);
    scrub.appendChild(timeEl);
    scrub.appendChild(muteBtn);
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
      var countEl = el.querySelector('.card-char-count');
      if (countEl) countEl.textContent = count + (count === 1 ? ' char' : ' chars');

      /* Live preview of the note text as the card bar "filename",
         falling back to the card's actual name once emptied again. */
      var nameEl = el.querySelector('.card-filename');
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
      var barName = el.querySelector('.card-filename');
      if (barName) barName.textContent = newColor;
      var barBadge = el.querySelector('.card-badge');
      if (barBadge) barBadge.style.background = newColor;
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

    /* Click swatch → open native color picker */
    swatch.addEventListener('click', function(e) {
      if (el.dataset.justDragged) { delete el.dataset.justDragged; return; }
      e.stopPropagation();

      /* BUG 2 fix: clean up any orphaned picker left over from a previous
         swatch click that never fired 'change' (Escape, click-away, etc.)
         — otherwise these <input type="color"> elements pile up in the
         DOM forever. */
      var oldPicker = document.querySelector('input[type="color"][data-kanvaz-picker]');
      if (oldPicker && oldPicker.parentNode) oldPicker.parentNode.removeChild(oldPicker);

      var picker = document.createElement('input');
      picker.type = 'color';
      picker.value = hex;
      picker.dataset.kanvazPicker = '1';
      picker.style.cssText = 'position:absolute;opacity:0;pointer-events:none;';
      document.body.appendChild(picker);

      function removePicker() {
        if (picker.parentNode) picker.parentNode.removeChild(picker);
      }

      picker.addEventListener('input', function() {
        var newColor = picker.value;
        card.color = newColor;
        card.name  = newColor;
        applyColorVisual(newColor);
        KanvazApp.markDirty();
      });

      picker.addEventListener('change', function() {
        KanvazHistory.push();
        emitCardEvent('cardUpdate', card);
        removePicker();
      });

      /* Fallback cleanup: fires when the native picker closes without a
         'change' event (Escape, clicking away). Delayed so a genuine
         'change' (which also blurs) removes it via the handler above
         first — removePicker() is idempotent either way. */
      picker.addEventListener('blur', function() {
        setTimeout(removePicker, 200);
      });

      picker.click();
    });

    el.appendChild(swatch);
    el.appendChild(labelRow);
    el.appendChild(paletteStrip);
  }

  /* ── URL reference card ── */

  var LINK_ICON = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M6.5 9.5a3 3 0 0 0 4.24 0l2-2a3 3 0 0 0-4.24-4.24l-1 1"/><path d="M9.5 6.5a3 3 0 0 0-4.24 0l-2 2a3 3 0 0 0 4.24 4.24l1-1"/></svg>';
  var OPEN_ICON = '<svg viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M6 2H2v10h10V8"/><path d="M8 2h4v4"/><path d="M12 2 6.5 7.5"/></svg>';
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
      var barName = el.querySelector('.card-filename');
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
  var CHANGE_ICON = '<svg viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M2 7a5 5 0 0 1 8.5-3.5M12 7a5 5 0 0 1-8.5 3.5"/><path d="M10 1v3h-3M4 13v-3h3"/></svg>';

  /* v5.0.0 — a "file" card used to always show the same flat folder icon
     regardless of what it actually pointed at. A shared document-shaped
     base (page + folded corner) with a short extension-derived label
     stamped on it reads as a real per-type preview without needing a
     different SVG per format — same idea as a Finder/Explorer file icon.
     Purely local: derived from the path string only, no file read. */
  var FILE_ICON_BASE = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><path d="M4 1.5h5.5L12.5 4.5V14a.5.5 0 0 1-.5.5H4a.5.5 0 0 1-.5-.5V2a.5.5 0 0 1 .5-.5z"/><path d="M9.5 1.5V4.5h3"/></svg>';
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
        var barName = el.querySelector('.card-filename');
        if (barName) barName.textContent = card.name;
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

  /* ── Card bar (filename + badge) ── */

  function buildCardBar(el, card) {
    var bar = document.createElement('div');
    bar.className = 'card-bar';

    if (card.sharedId) {
      var sharedBadge = document.createElement('span');
      sharedBadge.className = 'card-badge badge-shared';
      sharedBadge.title = 'Shared across boards — editing it here updates every board it appears on';
      sharedBadge.textContent = '⛓';
      bar.appendChild(sharedBadge);
    }

    bar.appendChild(buildNameSpan(card, el));

    if (card.type === 'image') {
      /* Populated once the image loads (see buildImageCard's onload) —
         naturalWidth/Height aren't known until then. */
      var dimsBadge = document.createElement('span');
      dimsBadge.className = 'card-badge card-dims';
      bar.appendChild(dimsBadge);
    } else if (card.type === 'gif') {
      var badge = document.createElement('span');
      badge.className = 'card-badge badge-gif';
      badge.textContent = 'GIF';
      bar.appendChild(badge);
    } else if (card.type === 'video') {
      var vbadge = document.createElement('span');
      vbadge.className = 'card-badge badge-vid';
      vbadge.textContent = 'VID';
      bar.appendChild(vbadge);
      /* Populated once metadata loads (see buildVideoCard's
         onloadedmetadata) — duration isn't known before then. */
      var vdur = document.createElement('span');
      vdur.className = 'card-badge card-duration';
      bar.appendChild(vdur);
    } else if (card.type === 'audio') {
      var abadge = document.createElement('span');
      abadge.className = 'card-badge badge-audio';
      abadge.textContent = 'AUDIO';
      bar.appendChild(abadge);
    } else if (card.type === 'note') {
      var nbadge = document.createElement('span');
      nbadge.className = 'card-badge badge-note';
      nbadge.textContent = 'NOTE';
      bar.appendChild(nbadge);

      var charCount = document.createElement('span');
      charCount.className = 'card-badge card-char-count';
      var len = (card.text || '').length;
      charCount.textContent = len + (len === 1 ? ' char' : ' chars');
      bar.appendChild(charCount);
    } else if (card.type === 'color') {
      var cbadge = document.createElement('span');
      cbadge.className = 'card-badge';
      cbadge.style.cssText = 'background:' + (card.color || '#9D7FFF') + ';width:12px;height:12px;border-radius:50%;border:1.5px solid var(--color-border-2);padding:0;';
      bar.appendChild(cbadge);
    }

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
    name.className = 'card-filename ellipsis';
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
    var nameEl = el.querySelector('.card-filename');
    if (!nameEl) return;
    var nameParent = nameEl.parentNode;

    var input = document.createElement('input');
    input.type = 'text';
    input.className = 'card-filename-input';
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
    var positions = [
      { name: 'tl', style: 'top:-7.5px;left:-7.5px;cursor:nw-resize;' },
      { name: 'tc', style: 'top:-7.5px;left:50%;transform:translateX(-50%);cursor:n-resize;' },
      { name: 'tr', style: 'top:-7.5px;right:-7.5px;cursor:ne-resize;' },
      { name: 'ml', style: 'top:50%;left:-7.5px;transform:translateY(-50%);cursor:w-resize;' },
      { name: 'mr', style: 'top:50%;right:-7.5px;transform:translateY(-50%);cursor:e-resize;' },
      { name: 'bl', style: 'bottom:-7.5px;left:-7.5px;cursor:sw-resize;' },
      { name: 'bc', style: 'bottom:-7.5px;left:50%;transform:translateX(-50%);cursor:s-resize;' },
      { name: 'br', style: 'bottom:-7.5px;right:-7.5px;cursor:se-resize;' }
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
    /* Selecting any single card always collapses a prior multi-selection
       (e.g. after Ctrl+A) down to just this one — there's no group-drag
       or group-select-add in this app, so a click/drag/create always
       means "just this card now", same as clicking one of several
       highlighted rows in a file browser. */
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
          { label: 'Cancel', cls: '',       action: function() {} }
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

    /* Pause any playing media before removing the DOM element */
    var el = document.getElementById(id);
    if (el) {
      var mediaEl = el.querySelector('video, audio');
      if (mediaEl) mediaEl.pause();
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
          { label: 'Cancel', cls: '',       action: function() {} }
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

    if (!card.sharedId) {
      card.sharedId = KanvazBoards.newSharedId();
    }

    /* Push current content into the registry right away (rather than
       waiting for the next save/switch) so the target board — which may
       become active before this one saves again — sees it immediately.
       buildFullCardRecord() is the same normalizer serialise() itself
       uses, so this can't drift from what an actual save would produce. */
    var full = buildFullCardRecord(card);
    var content = {};
    for (var ck in full) {
      if (SHARED_CARD_INSTANCE_FIELDS.indexOf(ck) === -1) content[ck] = full[ck];
    }
    KanvazBoards.setSharedCardContent(card.sharedId, content);

    var stub = { sharedId: card.sharedId, id: nextId(), x: card.x, y: card.y, w: card.w, h: card.h, z: card.z, pinned: false, opacity: 1.0, mapPosition: null };
    var result = KanvazBoards.addSharedInstanceToBoard(targetBoardId, stub);
    if (result.ok) {
      syncSharedBadge(card);
      KanvazApp.markDirty();
    }
    return result;
  }

  function unlinkSharedCard(id) {
    var card = cards[id];
    if (!card || !card.sharedId) return;
    card.sharedId = null;
    syncSharedBadge(card);
    KanvazApp.markDirty();
    KanvazHistory.push();
    KanvazUI.toast('Unlinked — this is now its own independent copy');
  }

  /* Adds/removes the "shared" badge on an already-rendered card in place
     — deliberately NOT a full renderCard() re-run, which would append a
     second DOM element with the same id rather than replacing the first
     (renderCard() is only ever called for a card that doesn't have an
     element yet: initial deserialise, create, duplicate). */
  function syncSharedBadge(card) {
    var el = document.getElementById(card.id);
    if (!el) return;
    var bar = el.querySelector('.card-bar');
    if (!bar) return;
    var existing = bar.querySelector('.badge-shared');
    if (card.sharedId) {
      if (!existing) {
        var b = document.createElement('span');
        b.className = 'card-badge badge-shared';
        b.title = 'Shared across boards — editing it here updates every board it appears on';
        b.textContent = '⛓';
        bar.insertBefore(b, bar.firstChild);
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

  /* ── Send to back ── */

  function sendToBack(id) {
    var card = cards[id];
    if (!card) return;
    card.z = 0;
    var el = document.getElementById(id);
    if (el) el.style.zIndex = 0;
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
    shareCardToBoard:  shareCardToBoard,
    unlinkSharedCard:  unlinkSharedCard,
    showShareToBoardPicker: showShareToBoardPicker,
    togglePin:         togglePin,
    togglePinSelected: togglePinSelected,
    bringToFront:      bringToFront,
    sendToBack:        sendToBack,
    flipCard:          flipCard,
    resetSize:         resetSize,
    showOpacityPicker: showOpacityPicker,
    toggleObjectFit:   toggleObjectFit,
    showSpeedPicker:   showSpeedPicker,
    refreshAnnotationDot: refreshAnnotationDot,
    nudge:             nudge,
    serialise:         serialise,
    serialiseForHistory: serialiseForHistory,
    deserialise:       deserialise,
    clearAll:          clearAll,
    resetSessionState: resetSessionState,
    getAll:            getAll,
    getSelected:       function() { return selectedId; },
    getSelectedIds:    getSelectedIds
  };

})();
