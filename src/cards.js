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
      card.x = snapToGrid(origX + dx);
      card.y = snapToGrid(origY + dy);
      el.style.left = card.x + 'px';
      el.style.top  = card.y + 'px';
    }

    function onUp() {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      if (moved) {
        KanvazApp.markDirty();
        KanvazHistory.push();
      }
    }

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
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

    function onMove(ev) {
      var dx = (ev.clientX - startX) / scale;
      var dy = (ev.clientY - startY) / scale;
      var newW = startW;
      var newH = startH;
      var newX = startCX;
      var newY = startCY;

      if (dir === 'br' || dir === 'mr' || dir === 'tr') newW = startW + dx;
      if (dir === 'bl' || dir === 'ml' || dir === 'tl') { newW = startW - dx; newX = startCX + dx; }
      if (dir === 'br' || dir === 'bc' || dir === 'bl') newH = startH + dy;
      if (dir === 'tr' || dir === 'tc' || dir === 'tl') { newH = startH - dy; newY = startCY + dy; }

      var isCorner = (dir === 'br' || dir === 'tr' || dir === 'bl' || dir === 'tl');
      if (aspectLock && card.type !== 'note' && card.type !== 'audio' && card.type !== 'url' && card.type !== 'file' && isCorner) {
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
      newX = snapToGrid(newX);
      newY = snapToGrid(newY);

      newW = Math.max(CARD_MIN_W, newW);
      newH = Math.max(CARD_MIN_H, newH);

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
      if (typeof KanvazAnnotate !== 'undefined') {
        KanvazAnnotate.resize(card.id, Math.round(card.w), Math.round(card.h));
      }
      KanvazApp.markDirty();
      KanvazHistory.push();
    }

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }

  /* ── Video controls (delegated) ── */

  var PLAY_ICON  = '<svg viewBox="0 0 10 10" fill="currentColor"><polygon points="1,1 9,5 1,9"/></svg>';
  var PAUSE_ICON = '<svg viewBox="0 0 10 10" fill="currentColor"><rect x="1" y="1" width="3" height="8"/><rect x="6" y="1" width="3" height="8"/></svg>';
  var MUTE_ICON  = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M3 5.5h2l3-3v11l-3-3H3a1 1 0 0 1-1-1v-3a1 1 0 0 1 1-1z"/><line x1="12" y1="5" x2="12" y2="11" stroke-linecap="round"/><line x1="14.5" y1="3.5" x2="14.5" y2="12.5" stroke-linecap="round"/></svg>';
  var MUTED_ICON = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M3 5.5h2l3-3v11l-3-3H3a1 1 0 0 1-1-1v-3a1 1 0 0 1 1-1z"/><line x1="11" y1="5.5" x2="15" y2="10.5" stroke-linecap="round"/><line x1="15" y1="5.5" x2="11" y2="10.5" stroke-linecap="round"/></svg>';
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
    var card = {
      id:       id,
      type:     'note',
      dataUrl:  null,
      name:     'Note',
      path:     null,
      x:        x,
      y:        y,
      w:        240,
      h:        160,
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

    return card;
  }

  /* ── Create color swatch ── */

  function createColorCard(x, y, hex) {
    var id = nextId();
    var color = hex || '#9D7FFF';
    var card = {
      id:       id,
      type:     'color',
      dataUrl:  null,
      name:     color,
      path:     null,
      x:        x,
      y:        y,
      w:        160,
      h:        160,
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

    return card;
  }

  /* ── Create URL reference ── */

  function createUrlCard(x, y) {
    var id = nextId();
    var card = {
      id:       id,
      type:     'url',
      dataUrl:  null,
      name:     'URL reference',
      path:     null,
      x:        x,
      y:        y,
      w:        220,
      h:        90,
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

    return card;
  }

  /* ── Create File reference ──
     Points at a file on disk without embedding it (hasMedia:false in
     reference-types.js) — for linking a source PSD, script, brief, or
     any other file too big/impractical to embed as base64. */

  function createFileRefCard(x, y) {
    KanvazBridge.openRefFileDialog(null).then(function(p) {
      if (!p) return; /* cancelled — never create an empty, useless card */
      var id = nextId();
      var card = {
        id:       id,
        type:     'file',
        dataUrl:  null,
        name:     basenameOf(p),
        path:     p,
        x:        x,
        y:        y,
        w:        220,
        h:        90,
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
    }).catch(function(e) { console.warn('[Kanvaz] openRefFileDialog IPC failed:', e); });
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
    } else if (card.type === 'color') {
      buildColorCard(el, card);
    } else if (card.type === 'url') {
      buildUrlCard(el, card);
    } else if (card.type === 'file') {
      buildFileRefCard(el, card);
    }

    buildCardBar(el, card);
    buildPinIndicator(el);
    buildResizeHandles(el);

    world.appendChild(el);
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

    scrub.appendChild(playBtn);
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

  function buildNoteCard(el, card) {
    var accent = document.createElement('div');
    accent.className = 'note-accent-bar';
    el.appendChild(accent);

    var ta = document.createElement('textarea');
    ta.className = 'note-body';
    ta.placeholder = 'Note';
    ta.value = card.text || '';
    ta.style.cssText = 'width:100%;height:100%;padding-bottom:28px;';

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
        var preview = ta.value.trim();
        nameEl.textContent = preview
          ? (preview.length > 20 ? preview.slice(0, 20) + '…' : preview)
          : (card.name || 'Note');
      }
    });

    ta.addEventListener('blur', function() {
      KanvazHistory.push();
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
        swatch.style.background = newColor;
        hex = newColor;
        label.textContent = formatColorString(hex, format);
        /* Update card bar name + badge */
        var barName = el.querySelector('.card-filename');
        if (barName) barName.textContent = newColor;
        var barBadge = el.querySelector('.card-badge');
        if (barBadge) barBadge.style.background = newColor;
        KanvazApp.markDirty();
      });

      picker.addEventListener('change', function() {
        KanvazHistory.push();
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
  }

  /* ── URL reference card ── */

  var LINK_ICON = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M6.5 9.5a3 3 0 0 0 4.24 0l2-2a3 3 0 0 0-4.24-4.24l-1 1"/><path d="M9.5 6.5a3 3 0 0 0-4.24 0l-2 2a3 3 0 0 0 4.24 4.24l1-1"/></svg>';
  var OPEN_ICON = '<svg viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M6 2H2v10h10V8"/><path d="M8 2h4v4"/><path d="M12 2 6.5 7.5"/></svg>';

  /* Kanvaz never fetches link previews/favicons for these — the app makes
     zero background network calls (see PRIVACY.md), and a URL card is no
     exception. It's a fast, offline note-to-self of a link: paste it,
     open it in your real browser when you need it. */
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

    function updateOpenState() {
      var has = !!(card.url && card.url.trim());
      openBtn.style.display = has ? '' : 'none';
    }
    updateOpenState();

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

    body.appendChild(input);
    body.appendChild(openBtn);
    el.appendChild(body);
    updateBarName();
  }

  /* ── File reference card ── */

  var FOLDER_ICON = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M2 4.5a1 1 0 0 1 1-1h3l1.5 1.5H13a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1v-7.5z"/></svg>';
  var CHANGE_ICON = '<svg viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M2 7a5 5 0 0 1 8.5-3.5M12 7a5 5 0 0 1-8.5 3.5"/><path d="M10 1v3h-3M4 13v-3h3"/></svg>';

  function buildFileRefCard(el, card) {
    var accent = document.createElement('div');
    accent.className = 'url-accent-bar';
    accent.innerHTML = FOLDER_ICON;
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
      var ext = (card.type === 'pdf') ? 'pdf' : null;
      KanvazBridge.openRefFileDialog(ext).then(function(p) {
        if (!p) return;
        card.path = p;
        card.name = basenameOf(p);
        label.textContent = card.name;
        label.title = card.path;
        var barName = el.querySelector('.card-filename');
        if (barName) barName.textContent = card.name;
        KanvazApp.markDirty();
        KanvazHistory.push();
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
    bar.appendChild(name);

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

  /* ── Tag chips (inline editing) ── */

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
        KanvazApp.markDirty();
        KanvazHistory.push();
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
      if (!query) { dropdown.classList.remove('visible'); return; }

      var existing = card.tags || [];
      var matches = collectAllTags().filter(function(t) {
        return existing.indexOf(t) === -1 && t.indexOf(query) !== -1;
      });
      if (!matches.length) { dropdown.classList.remove('visible'); return; }

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
    var positions = [
      { name: 'tl', style: 'top:-5.5px;left:-5.5px;cursor:nw-resize;' },
      { name: 'tc', style: 'top:-5.5px;left:50%;transform:translateX(-50%);cursor:n-resize;' },
      { name: 'tr', style: 'top:-5.5px;right:-5.5px;cursor:ne-resize;' },
      { name: 'ml', style: 'top:50%;left:-5.5px;transform:translateY(-50%);cursor:w-resize;' },
      { name: 'mr', style: 'top:50%;right:-5.5px;transform:translateY(-50%);cursor:e-resize;' },
      { name: 'bl', style: 'bottom:-5.5px;left:-5.5px;cursor:sw-resize;' },
      { name: 'bc', style: 'bottom:-5.5px;left:50%;transform:translateX(-50%);cursor:s-resize;' },
      { name: 'br', style: 'bottom:-5.5px;right:-5.5px;cursor:se-resize;' }
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

  /* ── Duplicate ── */

  /* Clones one card and inserts the copy — no selection change, no
     history push, no dirty flag. Shared by the single and bulk paths,
     same split as removeCardCore/finishDelete above. */
  function duplicateCardCore(id) {
    var src = cards[id];
    if (!src) return null;

    var newCard = JSON.parse(JSON.stringify(src));
    newCard.id  = nextId();
    newCard.x  += 20;
    newCard.y  += 20;
    newCard.z   = ++zCounter;

    cards[newCard.id] = newCard;
    renderCard(newCard);
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

  function serialise() {
    var out = [];
    for (var id in cards) {
      var c = cards[id];
      var strokes = (typeof KanvazAnnotate !== 'undefined')
        ? KanvazAnnotate.getStrokes(id)
        : (c.annotations || []);
      out.push({
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
        color:       c.color       || null,
        mimeType:    c.mimeType    || null,
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
        muted:        c.muted        !== undefined ? c.muted : null
      });
    }
    return out;
  }

  function deserialise(arr) {
    clearAll();
    if (!arr) return;
    for (var i = 0; i < arr.length; i++) {
      var c = arr[i];

      /* v3 field defaults — ensures v2.x files load cleanly */
      if (!c.tags)        c.tags        = [];
      if (!c.properties)  c.properties  = {};
      if (!c.mapPosition) c.mapPosition = null;
      if (!c.url)         c.url         = null;
      if (!c.color)       c.color       = null;
      if (!c.mimeType)    c.mimeType    = null;

      /* v4 field defaults — ensures pre-4.0 files (and files saved by
         the buggy 4.0.0 serialise() that dropped these) load cleanly.
         Render-time code also falls back per-field, this just keeps
         the in-memory card object's shape consistent right after load. */
      if (!c.objectFit)    c.objectFit    = null;
      if (!c.playbackRate) c.playbackRate = null;
      if (!c.audioLoop)    c.audioLoop    = false;
      if (!c.colorFormat)  c.colorFormat  = null;
      if (c.muted === undefined) c.muted  = null;

      cards[c.id] = c;
      renderCard(c);
      if (c.z > zCounter) zCounter = c.z;

      /* Restore opacity */
      if (c.opacity !== undefined && c.opacity !== 1.0) {
        var el = document.getElementById(c.id);
        if (el) el.style.opacity = c.opacity;
      }

      /* Restore flip */
      if (c.flipH || c.flipV) {
        var fel = document.getElementById(c.id);
        if (fel) {
          var media = fel.querySelector('img, video');
          if (media) {
            var sx = c.flipH ? -1 : 1;
            var sy = c.flipV ? -1 : 1;
            media.style.transform = 'scale(' + sx + ',' + sy + ')';
          }
        }
      }

      /* Restore annotations */
      if (c.annotations && c.annotations.length && typeof KanvazAnnotate !== 'undefined') {
        var cardEl = document.getElementById(c.id);
        if (cardEl) KanvazAnnotate.loadStrokes(c.id, c.annotations, cardEl);
      }
    }
    updateEmptyState();
    updateCount();
  }

  function clearAll() {
    if (typeof KanvazAnnotate !== 'undefined') KanvazAnnotate.detachAll();
    for (var id in cards) {
      var el = document.getElementById(id);
      if (el) el.parentNode.removeChild(el);
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
  }

  /* ── Flip ── */

  function flipCard(id, axis) {
    var card = cards[id];
    if (!card) return;
    /* Only visual media cards can be flipped — note/color/audio have no
       img/video element and flipping them would just corrupt flipH/flipV
       state that never gets used. */
    if (card.type === 'note' || card.type === 'color' || card.type === 'audio' || card.type === 'url' || card.type === 'file') return;
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
    }
    KanvazApp.markDirty();
    KanvazHistory.push();
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
  }

  function deselectAll() {
    clearSelectionVisuals();
    selectedId = null;
    multiSelectedIds = [];
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
    createColorCard:   createColorCard,
    createUrlCard:     createUrlCard,
    createFileRefCard: createFileRefCard,
    generateTestCards: generateTestCards,
    selectCard:        selectCard,
    selectAll:         selectAll,
    deselectAll:       deselectAll,
    deleteCard:        deleteCard,
    deleteSelected:    deleteSelected,
    duplicateCard:     duplicateCard,
    duplicateSelected: duplicateSelected,
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
    deserialise:       deserialise,
    clearAll:          clearAll,
    getAll:            getAll,
    getSelected:       function() { return selectedId; },
    getSelectedIds:    getSelectedIds
  };

})();
