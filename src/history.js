/* history.js — undo / redo, 50 step limit (v3.0)
 *
 * Snapshots now include both references and connections.
 */

var KanvazHistory = (function() {

  var stack   = [];
  var pointer = -1;
  var MAX     = 50;
  var locked  = false;

  /* Plugin cards' pluginData is arbitrary, opaque data a third-party
     plugin controls — unlike every other field snapshotted below, it
     isn't guaranteed to be JSON-safe (a careless plugin could put a
     function, DOM reference, or circular structure in there). Clone it
     defensively so one bad plugin card can't throw inside snapshot()
     and break undo/redo for the ENTIRE board — it just loses its own
     plugin data on that one snapshot instead. */
  function cloneJsonSafe(v) {
    if (v === null || v === undefined) return v;
    try {
      return JSON.parse(JSON.stringify(v));
    } catch (e) {
      console.error('[Kanvaz] a plugin card\'s pluginData could not be cloned for undo history (not JSON-safe) — it will be lost on undo/redo for this step:', e.message);
      return null;
    }
  }

  /* ── Snapshot ──
     KanvazCards.serialise() includes each card's full dataUrl (base64
     media, can be tens of MB per card). A naive JSON.parse(JSON.stringify
     (...)) deep-clones that string into EVERY undo-stack entry — with
     MAX=50 steps, a media-heavy board could hold up to 50x copies of all
     embedded media in RAM at once.

     dataUrl/name/path/naturalW/naturalH/type/id/url/color/mimeType are
     never mutated in place after a card is created, so they're safe to
     share by reference across snapshots. Only the mutable fields
     (position/size/z/pin/text/opacity/flip/annotations/tags/properties/
     mapPosition) need deep copying. */
  function snapshot() {
    var src = KanvazCards.serialise();
    var refs = [];
    for (var i = 0; i < src.length; i++) {
      var c = src[i];
      refs.push({
        /* Immutable — shared by reference */
        id:       c.id,
        type:     c.type,
        dataUrl:  c.dataUrl,
        name:     c.name,
        path:     c.path,
        naturalW: c.naturalW,
        naturalH: c.naturalH,
        url:      c.url,
        color:    c.color,
        mimeType: c.mimeType,
        /* Mutable — cloned */
        x:           c.x,
        y:           c.y,
        w:           c.w,
        h:           c.h,
        z:           c.z,
        pinned:      c.pinned,
        text:        c.text,
        opacity:     c.opacity,
        flipH:       c.flipH,
        flipV:       c.flipV,
        /* v4 fields — primitives, safe to copy by value like the rest
           of this "Mutable" block. Without these, undo/redo would
           silently strip image fit / video speed / audio loop / color
           format on every single undo or redo, independent of the
           save-file whitelist bug this mirrors in KanvazCards.serialise(). */
        objectFit:    c.objectFit,
        playbackRate: c.playbackRate,
        audioLoop:    c.audioLoop,
        colorFormat:  c.colorFormat,
        muted:        c.muted,
        annotations: JSON.parse(JSON.stringify(c.annotations || [])),
        tags:        c.tags ? c.tags.slice() : [],
        properties:  c.properties ? JSON.parse(JSON.stringify(c.properties)) : {},
        mapPosition: c.mapPosition ? { x: c.mapPosition.x, y: c.mapPosition.y } : null,
        /* Audit fix (CRITICAL): pluginData was added to KanvazCards.
           serialise()'s save-file whitelist in 4.2.0 but never added
           here — every undo snapshot silently omitted it, so a single
           Ctrl+Z after ANY edit anywhere on the board (not just on a
           plugin card) would call KanvazCards.deserialise() with
           pluginData missing on every card, wiping it app-wide. Cloned
           (not shared by reference) since a plugin's render() has
           direct access to card.pluginData and can mutate it in place —
           sharing a reference would allow a later in-place mutation to
           retroactively corrupt earlier, already-pushed undo steps. */
        pluginData: cloneJsonSafe(c.pluginData)
      });
    }

    /* Snapshot connections (lightweight — no large data) */
    var conns = [];
    if (typeof KanvazConnections !== 'undefined') {
      conns = JSON.parse(JSON.stringify(KanvazConnections.serialise()));
    }

    return { refs: refs, conns: conns };
  }

  /* ── Push after any mutation ── */

  function push() {
    if (locked) return;
    stack = stack.slice(0, pointer + 1);
    stack.push(snapshot());
    if (stack.length > MAX) stack = stack.slice(stack.length - MAX);
    pointer = stack.length - 1;
    updateUI();
  }

  /* ── Undo ── */

  function undo() {
    if (pointer <= 0) { KanvazUI.toast('Nothing to undo'); return; }
    pointer--;
    restore(stack[pointer]);
    updateUI();
    KanvazUI.toast('Undo');
  }

  /* ── Redo ── */

  function redo() {
    if (pointer >= stack.length - 1) { KanvazUI.toast('Nothing to redo'); return; }
    pointer++;
    restore(stack[pointer]);
    updateUI();
    KanvazUI.toast('Redo');
  }

  /* Audit fix (CRITICAL): KanvazCards.deserialise() adopts the objects
     you hand it as the LIVE cards{} entries (`cards[c.id] = c`), and
     also mutates them in place while loading (v3/v4 field defaults).
     restore() used to pass snap.refs straight through — meaning after
     an undo, cards{} held the EXACT SAME objects still sitting in this
     stack entry. Any subsequent mutation (drag, resize, tag removal's
     splice, annotation drawing) then rewrote that stored snapshot in
     place. Concretely: move A, move B, undo (back to "A moved" state),
     drag A again, undo — the second undo restores a snapshot whose own
     .refs[A] was silently overwritten by the drag that happened AFTER
     restoring it, so the card doesn't move back. Undo-then-edit is an
     everyday workflow; this made undo unreliable exactly when needed.
     Fix: every restore hands deserialise() fresh objects, never the
     stack's own — same immutable-share/mutable-clone split snapshot()
     itself already uses above, so this stays cheap for large dataUrls. */
  function cloneRefForRestore(ref) {
    return {
      id:       ref.id,
      type:     ref.type,
      dataUrl:  ref.dataUrl,
      name:     ref.name,
      path:     ref.path,
      naturalW: ref.naturalW,
      naturalH: ref.naturalH,
      url:      ref.url,
      color:    ref.color,
      mimeType: ref.mimeType,
      x:            ref.x,
      y:            ref.y,
      w:            ref.w,
      h:            ref.h,
      z:            ref.z,
      pinned:       ref.pinned,
      text:         ref.text,
      opacity:      ref.opacity,
      flipH:        ref.flipH,
      flipV:        ref.flipV,
      objectFit:    ref.objectFit,
      playbackRate: ref.playbackRate,
      audioLoop:    ref.audioLoop,
      colorFormat:  ref.colorFormat,
      muted:        ref.muted,
      /* Object/array-typed fields get mutated IN PLACE elsewhere (tag
         removal splices card.tags, annotation drawing pushes into
         strokes, the Properties panel writes card.properties[key]
         directly) — these must be fresh copies, not shared references,
         or exactly the same aliasing bug this function exists to fix
         would just move one level deeper. */
      annotations: JSON.parse(JSON.stringify(ref.annotations || [])),
      tags:        ref.tags ? ref.tags.slice() : [],
      properties:  ref.properties ? JSON.parse(JSON.stringify(ref.properties)) : {},
      mapPosition: ref.mapPosition ? { x: ref.mapPosition.x, y: ref.mapPosition.y } : null,
      pluginData:  cloneJsonSafe(ref.pluginData)
    };
  }

  function cloneRefsForRestore(refs) {
    var out = [];
    for (var i = 0; i < refs.length; i++) out.push(cloneRefForRestore(refs[i]));
    return out;
  }

  /* ── Restore snapshot ── */

  function restore(snap) {
    locked = true;

    /* v3 snapshots: { refs, conns }. v2 snapshots: plain array. */
    if (snap && snap.refs) {
      KanvazCards.deserialise(cloneRefsForRestore(snap.refs));
      if (typeof KanvazConnections !== 'undefined') {
        KanvazConnections.deserialise(snap.conns || []);
      }
    } else {
      /* Backward compat: v2-style snapshot (plain card array) */
      KanvazCards.deserialise(cloneRefsForRestore(snap));
    }

    locked = false;
    KanvazApp.markDirty();

    /* Refresh inspector if open */
    if (typeof KanvazInspector !== 'undefined' && KanvazInspector.isOpen()) {
      KanvazInspector.refresh();
    }

    /* Re-render map view if active */
    if (typeof KanvazMapView !== 'undefined' && KanvazMapView.isActive()) {
      KanvazMapView.render();
    }
  }

  /* ── Clear ── */

  function clear() {
    stack   = [];
    pointer = -1;
    stack.push(snapshot());
    pointer = 0;
    updateUI();
  }

  /* ── Update toolbar ── */

  function updateUI() {
    var undoBtn = document.querySelector('[title="Undo (Ctrl+Z)"]');
    var redoBtn = document.querySelector('[title="Redo (Ctrl+Y)"]');
    if (undoBtn) undoBtn.style.opacity = pointer <= 0 ? '0.35' : '';
    if (redoBtn) redoBtn.style.opacity = pointer >= stack.length - 1 ? '0.35' : '';
  }

  function init() { clear(); }

  return { init: init, push: push, undo: undo, redo: redo, clear: clear };

})();
