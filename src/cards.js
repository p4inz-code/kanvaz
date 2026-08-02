/* cards.js — card engine with EVENT DELEGATION
   All mouse interactions (select, drag, resize, video controls, GIF pause,
   right-click menu) are handled by ONE set of listeners bound to `world`
   at init time. Cards are looked up by data-card-id from the live `cards`
   object — never via stale closures over per-element listeners.
   This is the Priority 1 fix from the final audit. */

var KanvazCards = (function() {

  var cards = {};        /* id → card object (single source of truth) */
  var cardCount = 0;
  var selectedId = null;
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
      if (target.closest('.tag-chip-remove') || target.closest('.tag-chip-add') || target.closest('.tag-input')) {
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

    /* ── click: GIF pause/resume toggle ── */
    world.addEventListener('click', function(e) {
      if (e.target.tagName !== 'IMG') return;
      var cardEl = e.target.closest('.card-gif');
      if (!cardEl) return;
      var card = cards[cardEl.dataset.cardId];
      if (!card) return;
      toggleGifPause(e.target, card);
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
      if (aspectLock && card.type !== 'note' && card.type !== 'audio' && isCorner) {
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
  }

  function seekVideo(cardEl, e, track) {
    if (!cardEl) return;
    var vid = cardEl.querySelector('video, audio');
    if (!vid || !vid.duration) return;
    var rect = track.getBoundingClientRect();
    var pct = (e.clientX - rect.left) / rect.width;
    vid.currentTime = Math.max(0, Math.min(1, pct)) * vid.duration;
  }

  /* ── GIF pause/resume (delegated) ── */

  function toggleGifPause(img, card) {
    if (img._paused) {
      img.src = img._origSrc;
      img._paused = false;
    } else {
      var cvs = document.createElement('canvas');
      cvs.width  = img.naturalWidth  || card.w;
      cvs.height = img.naturalHeight || card.h;
      var ctx = cvs.getContext('2d');
      ctx.drawImage(img, 0, 0);
      img.src = cvs.toDataURL('image/png');
      img._paused = true;
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
    }

    buildCardBar(el, card);
    buildPinIndicator(el);
    buildResizeHandles(el);

    world.appendChild(el);
  }

  /* ── Image card ── */

  function buildImageCard(el, card) {
    var img = document.createElement('img');
    img.src = card.dataUrl;
    img.style.cssText = 'display:block;width:100%;height:100%;object-fit:cover;pointer-events:none;';
    img.onerror = function() {
      el.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;width:100%;height:100%;background:var(--color-surface);color:var(--color-text-3);font-size:12px;">Missing media</div>';
    };
    el.appendChild(img);
  }

  /* ── GIF card ── */

  function buildGifCard(el, card) {
    var img = document.createElement('img');
    img.src = card.dataUrl;
    img.style.cssText = 'display:block;width:100%;height:calc(100% - 24px);object-fit:cover;cursor:pointer;';
    img.title = 'Click to pause / resume';
    img._origSrc = card.dataUrl;
    img._paused = false;
    el.appendChild(img);
  }

  /* ── Video card ── */

  function buildVideoCard(el, card) {
    var vid = document.createElement('video');
    vid.preload = 'auto';
    vid.muted = true;
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

    /* Error handler — show message, hide scrub bar */
    vid.onerror = function() {
      vid.style.display = 'none';
      scrub.style.display = 'none';
      var errDiv = document.createElement('div');
      errDiv.style.cssText = 'display:flex;align-items:center;justify-content:center;width:100%;height:100%;background:var(--color-surface-2);color:var(--color-text-3);font-size:11px;font-family:var(--font-ui);text-align:center;padding:12px;';
      errDiv.textContent = 'Video format not supported \u2014 try MP4 (H.264) or WebM';
      el.insertBefore(errDiv, el.firstChild);
    };

    /* Only play after data is loaded — prevents corrupt partial display */
    vid.onloadeddata = function() {
      vid.play();
      playBtn.innerHTML = PAUSE_ICON;
    };

    vid.src = card.dataUrl;
    el.appendChild(vid);

    /* Scrub track */
    var track = document.createElement('div');
    track.className = 'scrub-bar';
    var fill = document.createElement('div');
    fill.className = 'scrub-fill';
    fill.style.width = '0%';
    track.appendChild(fill);

    /* Time display */
    var timeEl = document.createElement('span');
    timeEl.className = 'scrub-time';
    timeEl.textContent = '0:00';

    /* Mute button */
    var muteBtn = document.createElement('button');
    muteBtn.className = 'media-mute-btn';
    muteBtn.style.cssText = 'background:none;border:none;cursor:pointer;color:var(--color-text-3);padding:0;display:flex;align-items:center;';
    muteBtn.innerHTML = MUTED_ICON; /* starts muted */
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
      timeEl.textContent = KanvazMedia.formatTime(vid.currentTime) + ' / ' + KanvazMedia.formatTime(vid.duration);
    });
  }

  /* ── Audio card ── */

  function buildAudioCard(el, card) {
    /* Icon area — fills the card above the scrub bar + card bar.
       Height set by CSS (.audio-icon-area) using container-query-aware calc */
    var iconArea = document.createElement('div');
    iconArea.className = 'audio-icon-area';
    iconArea.innerHTML = [
      '<svg class="audio-icon-svg" viewBox="0 0 36 36" fill="none">',
        '<path d="M13 24V9.6L27 6v14.4" stroke="var(--color-accent)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>',
        '<circle cx="9" cy="24" r="4" stroke="var(--color-accent)" stroke-width="2"/>',
        '<circle cx="23" cy="20.4" r="4" stroke="var(--color-accent)" stroke-width="2"/>',
      '</svg>'
    ].join('');
    el.appendChild(iconArea);

    /* Audio element — hidden, playback only. Not autoplayed/looped
       (multiple audio cards autoplaying at once would be unpleasant). */
    var aud = document.createElement('audio');
    aud.src = card.dataUrl;
    aud.preload = 'metadata';
    aud.loop = false;
    aud.style.display = 'none';
    el.appendChild(aud);

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

    var timeEl = document.createElement('span');
    timeEl.className = 'scrub-time';
    timeEl.textContent = '0:00';

    var muteBtn = document.createElement('button');
    muteBtn.className = 'media-mute-btn';
    muteBtn.style.cssText = 'background:none;border:none;cursor:pointer;color:var(--color-accent);padding:0;display:flex;align-items:center;';
    muteBtn.innerHTML = MUTE_ICON; /* audio starts unmuted */
    muteBtn.title = 'Toggle mute';

    scrub.appendChild(playBtn);
    scrub.appendChild(track);
    scrub.appendChild(timeEl);
    scrub.appendChild(muteBtn);
    el.appendChild(scrub);

    aud.addEventListener('timeupdate', function() {
      if (!aud.duration) return;
      var pct = (aud.currentTime / aud.duration) * 100;
      fill.style.width = pct + '%';
      timeEl.textContent = KanvazMedia.formatTime(aud.currentTime) + ' / ' + KanvazMedia.formatTime(aud.duration);
    });

    /* Reset to play icon when playback ends naturally (not looped) */
    aud.addEventListener('ended', function() {
      playBtn.innerHTML = PLAY_ICON;
    });
  }

  /* ── Note card ── */

  function buildNoteCard(el, card) {
    var ta = document.createElement('textarea');
    ta.className = 'note-body';
    ta.placeholder = 'Type a note…';
    ta.value = card.text || '';
    ta.style.cssText = 'width:100%;height:100%;padding-bottom:28px;';

    ta.addEventListener('input', function() {
      card.text = ta.value;
      KanvazApp.markDirty();
    });

    ta.addEventListener('blur', function() {
      KanvazHistory.push();
    });

    el.appendChild(ta);
  }

  /* ── Color swatch card ── */

  function buildColorCard(el, card) {
    var hex = card.color || '#9D7FFF';
    var swatch = document.createElement('div');
    swatch.className = 'color-swatch';
    swatch.style.cssText = 'width:100%;height:calc(100% - 48px);background:' + hex + ';cursor:pointer;border-radius:6px 6px 0 0;';

    var label = document.createElement('div');
    label.className = 'color-label';
    label.style.cssText = 'height:24px;display:flex;align-items:center;justify-content:center;font-family:var(--font-mono);font-size:11px;color:var(--color-text-2);letter-spacing:0.05em;text-transform:uppercase;user-select:all;';
    label.textContent = hex;

    /* Click swatch → open native color picker */
    swatch.addEventListener('click', function(e) {
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
        label.textContent = newColor;
        hex = newColor;
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
    el.appendChild(label);
  }

  /* ── Card bar (filename + badge) ── */

  function buildCardBar(el, card) {
    var bar = document.createElement('div');
    bar.className = 'card-bar';

    var name = document.createElement('span');
    name.className = 'card-filename ellipsis';
    name.textContent = card.name;
    bar.appendChild(name);

    if (card.type === 'gif') {
      var badge = document.createElement('span');
      badge.className = 'card-badge badge-gif';
      badge.textContent = 'GIF';
      bar.appendChild(badge);
    } else if (card.type === 'video') {
      var vbadge = document.createElement('span');
      vbadge.className = 'card-badge badge-vid';
      vbadge.textContent = 'VID';
      bar.appendChild(vbadge);
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

    function addTag() {
      var val = input.value.trim().toLowerCase();
      if (val && (!card.tags || card.tags.indexOf(val) === -1)) {
        if (!card.tags) card.tags = [];
        card.tags.push(val);
        KanvazApp.markDirty();
        KanvazHistory.push();
      }
      buildTagBar(cardEl, card);
    }

    input.addEventListener('keydown', function(e) {
      e.stopPropagation();
      if (e.key === 'Enter') { addTag(); }
      if (e.key === 'Escape') { buildTagBar(cardEl, card); }
    });
    input.addEventListener('blur', function() { addTag(); });

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
    if (selectedId && selectedId !== id) {
      var prev = document.getElementById(selectedId);
      if (prev) prev.classList.remove('selected');
    }
    selectedId = id;
    var el = document.getElementById(id);
    if (el) el.classList.add('selected');
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

  function doDelete(id) {
    var card = cards[id];
    if (!card) return;

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
    if (selectedId === id) {
      selectedId = null;
      /* Auto-select another remaining card so a keyboard-only bulk
         delete (Delete, Delete, Delete...) keeps working instead of
         going dead after the first one — without this, selectedId
         stays null and every subsequent Delete press is a no-op until
         the user clicks something again. Picks the most recently
         created remaining card (simple, predictable) rather than
         attempting spatial "nearest" selection. */
      var remainingIds = Object.keys(cards);
      if (remainingIds.length) {
        var lastId = remainingIds[remainingIds.length - 1];
        selectCard(lastId);
      }
    }

    /* Close inspector if it was showing this reference */
    if (typeof KanvazInspector !== 'undefined' && KanvazInspector.isOpen()) {
      KanvazInspector.close();
    }

    updateEmptyState();
    updateCount();
    KanvazApp.markDirty();
    KanvazHistory.push();
  }

  /* ── Duplicate ── */

  function duplicateCard(id) {
    var src = cards[id];
    if (!src) return;

    var newCard = JSON.parse(JSON.stringify(src));
    newCard.id  = nextId();
    newCard.x  += 20;
    newCard.y  += 20;
    newCard.z   = ++zCounter;

    cards[newCard.id] = newCard;
    renderCard(newCard);
    selectCard(newCard.id);
    updateCount();
    KanvazApp.markDirty();
    KanvazHistory.push();
    KanvazUI.toast('Duplicated');
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
        mimeType:    c.mimeType    || null
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
    if (card.type === 'note' || card.type === 'color' || card.type === 'audio') return;
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
    selectedId = ids[ids.length - 1];
    KanvazUI.toast('All ' + ids.length + ' cards selected');
  }

  function deselectAll() {
    var allEls = document.querySelectorAll('.card.selected');
    for (var i = 0; i < allEls.length; i++) {
      allEls[i].classList.remove('selected');
    }
    selectedId = null;
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
    generateTestCards: generateTestCards,
    selectCard:        selectCard,
    selectAll:         selectAll,
    deselectAll:       deselectAll,
    deleteCard:        deleteCard,
    duplicateCard:     duplicateCard,
    togglePin:         togglePin,
    bringToFront:      bringToFront,
    sendToBack:        sendToBack,
    flipCard:          flipCard,
    resetSize:         resetSize,
    showOpacityPicker: showOpacityPicker,
    nudge:             nudge,
    serialise:         serialise,
    deserialise:       deserialise,
    clearAll:          clearAll,
    getAll:            getAll,
    getSelected:       function() { return selectedId; }
  };

})();
