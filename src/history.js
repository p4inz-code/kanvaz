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

  /* Copies EVERY field of a card record instead of a hand-maintained
     whitelist. Found live 2026-09-20: snapshot() and cloneRefForRestore()
     each listed fields by hand, so every field added since (groupId,
     hidden, highlighted, modelFormat, renderMode, bgColor, cameraPosition/
     Target, animationPlaying, volume, brightness/contrast/saturation,
     pdf state, palette, ...) was silently DROPPED on every undo/redo —
     an unrelated Ctrl+Z ungrouped cards, un-hid layers, cleared
     highlights, and left 3D cards with no modelFormat ("Unknown 3D model
     format"). Reproduced against the running app before this fix. A new
     persisted card field now only needs buildFullCardRecord() +
     deserialise() defaults in cards.js — history picks it up on its own.
     Primitives (incl. the huge dataUrl STRING — immutable, so 50 undo
     entries share one copy, no RAM multiplication) are copied by value;
     object/array fields are deep-cloned because they ARE mutated in place
     elsewhere (tag splice, annotation strokes, properties, camera,
     mapPosition) — the same aliasing hazard cloneRefForRestore documents
     below. cloneJsonSafe keeps one non-JSON-safe plugin blob from
     breaking undo for the whole board. */
  function copyCardRecord(c) {
    var out = {};
    for (var k in c) {
      if (!Object.prototype.hasOwnProperty.call(c, k)) continue;
      var v = c[k];
      out[k] = (v !== null && typeof v === 'object') ? cloneJsonSafe(v) : v;
    }
    return out;
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
    /* v6.4.0: serialiseForHistory(), NOT serialise() — serialise() splits
       a shared card into a content-less stub for the save file (its
       content lives in KanvazBoards' cross-board registry instead, which
       has no undo history of its own). Snapshotting that stub here would
       mean every undo push loses a shared card's type/text/dataUrl/etc
       outright — see serialiseForHistory()'s own comment for the full
       reasoning. Undo/redo needs the complete live record every time. */
    var src = KanvazCards.serialiseForHistory();
    var refs = [];
    for (var i = 0; i < src.length; i++) refs.push(copyCardRecord(src[i]));

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
    return copyCardRecord(ref);
  }

  function cloneRefsForRestore(refs) {
    var out = [];
    for (var i = 0; i < refs.length; i++) out.push(cloneRefForRestore(refs[i]));
    return out;
  }

  /* ── Restore snapshot ── */

  function restore(snap) {
    locked = true;

    /* deserialise() does a full clearAll()/rebuild of every card's DOM
       element, which tears down annotate.js's overlay canvas and
       toolbar along with the old element (they're not something a
       snapshot restore can meaningfully skip past). Direct feedback:
       undoing a stroke mid-annotation silently kicked you out of
       annotate mode entirely, with no visible reason why. Capture
       what was active before the rebuild and, if that card still
       exists afterward, hand annotate mode straight back to it. */
    var reactivateAnnotateId = (typeof KanvazAnnotate !== 'undefined')
      ? KanvazAnnotate.getActiveCardId()
      : null;

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

    if (reactivateAnnotateId && document.getElementById(reactivateAnnotateId)) {
      KanvazAnnotate.activate(reactivateAnnotateId);
    }

    locked = false;
    KanvazApp.markDirty();

    /* Refresh inspector if open */
    if (typeof KanvazInspector !== 'undefined' && KanvazInspector.isOpen()) {
      KanvazInspector.refresh();
    }

    /* The Properties panel shows values straight from the cards (render
       mode, clip, opacity, tags...). Without this it kept showing the
       pre-undo values until something else re-rendered it. Found live
       2026-09-21: undoing a Matcap switch left Matcap highlighted. */
    if (typeof KanvazProperties !== 'undefined' && KanvazProperties.isSectionVisible &&
        KanvazProperties.isSectionVisible() && KanvazProperties.refresh) {
      KanvazProperties.refresh();
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
