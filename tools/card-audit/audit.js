/* Card-audit helper, loaded after the app by tools/card-audit/server.js.

   window.KZAudit.build() puts one card of every type on the board, in a grid,
   each at its DEFAULT size, and returns [{type, id, rect}]. Everything else
   (hover, select, screenshots) is done with real pointer events from outside,
   so what is audited is what a user would see. */
(function() {
  var MEDIA = '/__audit/media/';

  function toDataUrl(file) {
    return fetch(MEDIA + file).then(function(r) { return r.blob(); }).then(function(b) {
      return new Promise(function(res) { var fr = new FileReader(); fr.onload = function() { res(fr.result); }; fr.readAsDataURL(b); });
    });
  }

  function loadMedia(file, mime, name) {
    return toDataUrl(file).then(function(du) {
      /* a FileReader data URL from a blob carries the server's content type */
      return new Promise(function(res, rej) {
        KanvazMedia.loadFromDataUrl(du, name, function(result, err) { err || !result ? rej(new Error('media ' + name + ': ' + err)) : res(result); });
      });
    });
  }

  function ready() {
    return new Promise(function(res) {
      (function wait() {
        if (window.KanvazCards && window.KanvazBoards && document.getElementById('canvas-container')) res(); else setTimeout(wait, 100);
      })();
    });
  }

  /* Leaves the Home Screen and starts an empty board. */
  function openBoard() {
    return ready().then(function() {
      var s = document.getElementById('startup-screen');
      if (s) { try { KanvazBoards.newBoard(); } catch (e) { /* fall through */ } }
      return new Promise(function(r) { setTimeout(r, 600); });
    });
  }

  var COLS = 4, GX = 40, GY = 40, CELL_W = 460, CELL_H = 400;

  function build(opts) {
    opts = opts || {};
    return openBoard().then(function() {
      if (KanvazCards.clearAll) KanvazCards.clearAll();
      var made = [];
      var n = 0;
      function at() { var i = n++; return { x: GX + (i % COLS) * CELL_W, y: GY + Math.floor(i / COLS) * CELL_H }; }
      function add(type, card) { made.push({ type: type, id: card.id }); return card; }

      var steps = [
        function() { return loadMedia('image.png', 'image/png', 'image.png').then(function(r) { add('image', KanvazCards.createFromMedia(r, at())); }); },
        function() { return loadMedia('anim.gif', 'image/gif', 'anim.gif').then(function(r) { add('gif', KanvazCards.createFromMedia(r, at())); }); },
        function() { return loadMedia('clip.webm', 'video/webm', 'clip.webm').then(function(r) { add('video', KanvazCards.createFromMedia(r, at())); }); },
        function() { return loadMedia('tone.wav', 'audio/wav', 'tone.wav').then(function(r) { add('audio', KanvazCards.createFromMedia(r, at())); }); },
        function() {
          return toDataUrl('model.glb').then(function(du) {
            var card = KanvazCards.createFromMedia({ type: 'model3d', dataUrl: du.replace(/^data:[^;]*/, 'data:model/gltf-binary'), name: 'model.glb', originalPath: null, modelFormat: 'glb', naturalW: 420, naturalH: 340, displayW: 420, displayH: 340 }, at());
            add('model3d', card);
          });
        }
      ];
      /* notes / text / colour / url / file are synchronous */
      var chain = Promise.resolve();
      steps.forEach(function(s) { chain = chain.then(s); });
      return chain.then(function() {
        var p = at(); var note = KanvazCards.createNote(p.x, p.y); note.text = 'A note with some text.\nSecond line of the note to show wrapping and the footer.'; add('note', note);
        p = at(); var text = KanvazCards.createTextCard(p.x, p.y); text.text = 'Bare text label'; add('text', text);
        p = at(); var color = KanvazCards.createColorCard(p.x, p.y); add('color', color);
        p = at(); var url = KanvazCards.createUrlCard(p.x, p.y); url.url = 'https://example.com/a/fairly/long/path/to/a/reference'; url.urlPreview = { title: 'Example reference page', image: null }; add('url', url);
        p = at(); var file = KanvazCards.createFileRefCardAtPath(p.x, p.y, 'C:\\Projects\\shots\\scene_010_layout_v003.psd'); if (file) add('file', file);
        /* re-render so the text set above shows, then leave nothing selected */
        var all = KanvazCards.serialise();
        KanvazCards.deserialise(all);
        KanvazCards.deselectAll && KanvazCards.deselectAll();
        return new Promise(function(r) { setTimeout(r, 2500); });
      }).then(function() {
        return made.map(function(m) {
          var el = document.getElementById(m.id);
          var b = el ? el.getBoundingClientRect() : null;
          return { type: m.type, id: m.id, rect: b ? { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) } : null };
        });
      });
    });
  }

  /* Centres a card in the canvas at the given zoom (default 100%). */
  function focus(id, scale) {
    var c = KanvazCards.getAll()[id];
    var box = document.getElementById('canvas-container').getBoundingClientRect();
    scale = scale || 1;
    KanvazCanvas.setViewport(box.width / 2 - (c.x + c.w / 2) * scale, box.height / 2 - (c.y + c.h / 2) * scale, scale);
    var el = document.getElementById(id);
    var r = el.getBoundingClientRect();
    return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height), cx: Math.round(r.x + r.width / 2), cy: Math.round(r.y + r.height / 2) };
  }

  /* Things that are part of the card frame, not content that can "collide". */
  var FRAME = /(resize-handle|card-pin|conn-port|port-dot|card-annotation-dot|annotation-dot)/;

  function visible(e) {
    var cs = getComputedStyle(e);
    if (cs.display === 'none' || cs.visibility === 'hidden' || parseFloat(cs.opacity) < 0.05) return false;
    var r = e.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  }
  function ownText(e) {
    for (var i = 0; i < e.childNodes.length; i++) if (e.childNodes[i].nodeType === 3 && e.childNodes[i].nodeValue.trim()) return true;
    return false;
  }
  function label(e) {
    var t = (e.className && e.className.baseVal !== undefined ? e.className.baseVal : e.className) || e.tagName;
    return String(t).split(' ')[0] + (ownText(e) ? '("' + e.textContent.trim().slice(0, 18) + '")' : '');
  }
  function inter(a, b) {
    var w = Math.min(a.right, b.right) - Math.max(a.left, b.left);
    var h = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
    return w > 0 && h > 0 ? Math.round(w) + 'x' + Math.round(h) : null;
  }

  /* Measures the card AS IT IS RIGHT NOW (call it after a real hover/click):
     overlap between content elements, content poking outside the card, text
     cut off without an ellipsis, and buttons too small to hit. */
  function audit(id) {
    var el = document.getElementById(id);
    var card = el.getBoundingClientRect();
    var all = [].slice.call(el.querySelectorAll('*')).filter(function(e) { return visible(e) && !FRAME.test(String(e.className && e.className.baseVal !== undefined ? e.className.baseVal : e.className)); });
    var content = all.filter(function(e) {
      var tag = e.tagName;
      return ownText(e) || tag === 'BUTTON' || tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SVG' || tag === 'svg' || tag === 'CANVAS' || tag === 'VIDEO' || tag === 'IMG' || tag === 'AUDIO' || /scrub-bar|media-play-btn|card-bar-pill|type-pill/.test(String(e.className));
    });
    var issues = [];
    /* skip pairs where one is inside the other, and media surfaces that are
       meant to sit under overlays */
    var SURFACE = /^(VIDEO|IMG|CANVAS|TEXTAREA)$/;
    for (var i = 0; i < content.length; i++) {
      for (var j = i + 1; j < content.length; j++) {
        var a = content[i], b = content[j];
        if (a.contains(b) || b.contains(a)) continue;
        if (SURFACE.test(a.tagName) || SURFACE.test(b.tagName)) continue;
        var x = inter(a.getBoundingClientRect(), b.getBoundingClientRect());
        if (x) issues.push({ kind: 'overlap', a: label(a), b: label(b), size: x });
      }
    }
    content.forEach(function(e) {
      var r = e.getBoundingClientRect();
      if (r.left < card.left - 1 || r.right > card.right + 1 || r.top < card.top - 1 || r.bottom > card.bottom + 1) {
        issues.push({ kind: 'outside-card', el: label(e), by: [Math.round(card.left - r.left), Math.round(r.right - card.right), Math.round(card.top - r.top), Math.round(r.bottom - card.bottom)].join(',') });
      }
      if (ownText(e)) {
        var cs = getComputedStyle(e);
        if (e.scrollWidth > e.clientWidth + 1 && cs.overflow !== 'visible' && cs.textOverflow !== 'ellipsis') issues.push({ kind: 'text-cut-no-ellipsis', el: label(e), scroll: e.scrollWidth, client: e.clientWidth });
      }
      if ((e.tagName === 'BUTTON' || /media-play-btn/.test(String(e.className))) && (r.width < 18 || r.height < 18)) issues.push({ kind: 'small-target', el: label(e), size: Math.round(r.width) + 'x' + Math.round(r.height) });
    });
    return { id: id, type: el.className.replace(/\s+/g, ' '), rect: { w: Math.round(card.width), h: Math.round(card.height) }, elements: content.length, issues: issues };
  }

  window.KZAudit = { ready: ready, build: build, openBoard: openBoard, focus: focus, audit: audit };
})();
