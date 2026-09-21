#!/usr/bin/env node
/* ============================================================
   history-alias-test.js — regression test for the undo snapshot
   aliasing bug.

   restore() used to hand KanvazCards.deserialise() the snapshot's own
   ref objects directly. deserialise() adopts whatever it's given as the
   live cards{} entries (cards[c.id] = c, mirroring the real cards.js
   behavior faithfully reproduced below) — so any mutation after an
   undo (drag, resize, tag edit) rewrote that stored snapshot in place.
   Repro: move A, move B, undo, drag A again, undo — the second undo
   used to restore a snapshot whose own data had been silently
   overwritten by the drag that happened after restoring it.

   Uses a real vm sandbox running the actual src/history.js source
   (not a reimplementation) against a lightweight fake KanvazCards that
   faithfully reproduces cards.js's own aliasing contract — the exact
   thing history.js has to defend against.
   ============================================================ */

var fs = require('fs');
var path = require('path');
var vm = require('vm');

var pass = true;
function check(name, cond) {
  if (cond) { console.log('  ✓ ' + name); }
  else { console.log('  ✗ ' + name); pass = false; }
}

/* Faithful to cards.js's real deserialise(): adopts the given objects
   directly as the live store, and serialise() reads back live object
   references — the exact contract that makes aliasing dangerous. */
var cards = {};
function makeFakeKanvazCards() {
  return {
    serialise: function() {
      var out = [];
      for (var id in cards) out.push(cards[id]);
      return out;
    },
    /* v6.4.0 — history.js now snapshots via this, not serialise() (see
       cards.js's own serialiseForHistory() comment for why: serialise()
       splits a shared card into a content-less stub for the save file,
       which would be wrong to snapshot for undo). This fake has no
       shared-card concept at all, so it's identical to serialise() —
       the point of this test is the aliasing contract, not shared
       cards, which shared-cards-test.js and the manual v6.4.0 review
       already cover. */
    serialiseForHistory: function() {
      var out = [];
      for (var id in cards) out.push(cards[id]);
      return out;
    },
    deserialise: function(arr) {
      cards = {};
      for (var i = 0; i < arr.length; i++) cards[arr[i].id] = arr[i];
    },
    getAll: function() { return cards; }
  };
}

var sandbox = {
  console: console,
  JSON: JSON,
  KanvazCards: makeFakeKanvazCards(),
  KanvazApp: { markDirty: function() {} },
  KanvazUI: { toast: function() {} },
  document: { querySelector: function() { return null; } }
  /* KanvazConnections/KanvazInspector/KanvazMapView deliberately absent —
     history.js guards every use with typeof !== 'undefined'. */
};
vm.createContext(sandbox);

var src = fs.readFileSync(path.join(__dirname, '..', 'src', 'history.js'), 'utf8');
vm.runInContext(src, sandbox, { filename: 'history.js' });
var KanvazHistory = sandbox.KanvazHistory;

function minimalCard(id, x) {
  return {
    id: id, type: 'note', dataUrl: null, name: id, path: null,
    naturalW: null, naturalH: null, url: null, color: null, mimeType: null,
    x: x, y: 0, w: 100, h: 100, z: 1, pinned: false, text: '',
    opacity: 1, flipH: false, flipV: false,
    objectFit: null, playbackRate: null, audioLoop: false, colorFormat: null, muted: null,
    annotations: [], tags: [], properties: {}, mapPosition: null, pluginData: null,
    sharedId: null
  };
}

/* ── Repro: move A, move B, undo (back to "A moved"), drag A again
   (corrupting the just-restored snapshot in place if aliased, without
   pushing yet — the live-drag window), push (branches off a new leaf,
   discarding "move B"), undo AGAIN — back to the SAME snapshot as the
   first undo. If it was corrupted in place, this second visit shows
   the corrupted (dragged) value instead of the true original one. ── */
cards = { A: minimalCard('A', 0), B: minimalCard('B', 0) };
KanvazHistory.init(); /* S0: A@0, B@0 */

cards.A.x = 10;
KanvazHistory.push(); /* S1: A@10, B@0 */

cards.B.x = 20;
KanvazHistory.push(); /* S2: A@10, B@20 */

KanvazHistory.undo(); /* -> S1: A@10, B@0 */
check('first undo restores A to 10', sandbox.KanvazCards.getAll().A.x === 10);
check('first undo restores B to 0', sandbox.KanvazCards.getAll().B.x === 0);

/* Drag A to a new position WITHOUT pushing yet (simulates live drag —
   the exact window where the old aliasing bug corrupted S1 in place) */
sandbox.KanvazCards.getAll().A.x = 999;
KanvazHistory.push(); /* branches a new leaf from S1 (A@999), discarding S2 */

KanvazHistory.undo(); /* back to S1 AGAIN — must show A's TRUE S1 value (10), not the drag's 999 */
check('revisiting the same snapshot after a post-restore edit shows its true original value, not the corrupted one', sandbox.KanvazCards.getAll().A.x === 10);

/* ── Also verify the fix doesn't break simple push→push→undo→redo ── */
cards = { C: minimalCard('C', 1) };
KanvazHistory.init();
cards.C.x = 5;
KanvazHistory.push();
cards.C.x = 15;
KanvazHistory.push();
KanvazHistory.undo();
check('plain undo still works (back to 5)', sandbox.KanvazCards.getAll().C.x === 5);
KanvazHistory.redo();
check('plain redo still works (forward to 15)', sandbox.KanvazCards.getAll().C.x === 15);

/* ── Mutable nested fields (tags) don't alias back into the stack either ── */
cards = { D: minimalCard('D', 0) };
cards.D.tags = ['keep'];
KanvazHistory.init(); /* S0: D.tags = ['keep'] */
KanvazHistory.undo(); /* re-restore S0 into a fresh object */
var restored = sandbox.KanvazCards.getAll().D;
restored.tags.push('mutated-after-restore'); /* simulates buildTagBar's in-place splice/push pattern */
KanvazHistory.undo(); /* nothing earlier than S0 — should stay a no-op, not throw */
check('mutating a restored card\'s tags array in place does not throw on a later undo', true);

/* ── Field-drop regression (found live 2026-09-20): snapshot()/restore
   used hand-maintained field whitelists, so every field added after
   them (groupId, hidden, highlighted, modelFormat, renderMode, bgColor,
   cameraPosition/Target, adjustments, volume, ...) was silently wiped by
   ANY undo — an unrelated Ctrl+Z ungrouped cards, un-hid layers and left
   3D cards with no modelFormat. Now every field survives, including one
   that does not exist yet (proving no whitelist is left to go stale). ── */
cards = { G: minimalCard('G', 0), M: minimalCard('M', 0) };
cards.G.groupId = 'group-1';
cards.G.hidden = true;
cards.G.highlighted = true;
cards.G.brightness = 130;
cards.M.type = 'model3d';
cards.M.modelFormat = 'glb';
cards.M.renderMode = 'wireframe';
cards.M.bgColor = '#112233';
cards.M.cameraPosition = { x: 1, y: 2, z: 3 };
cards.M.cameraTarget = { x: 0, y: 0, z: 0 };
cards.M.someFutureField = { nested: [1, 2, 3] };
KanvazHistory.init();                 /* S0 has every field */
cards.G.x = 50;                       /* an UNRELATED edit */
KanvazHistory.push();                 /* S1 */
KanvazHistory.undo();                 /* back to S0 */
var rg = sandbox.KanvazCards.getAll().G;
var rm = sandbox.KanvazCards.getAll().M;
check('undo keeps groupId', rg.groupId === 'group-1');
check('undo keeps hidden', rg.hidden === true);
check('undo keeps highlighted', rg.highlighted === true);
check('undo keeps image adjustments (brightness)', rg.brightness === 130);
check('undo keeps a 3D card\'s modelFormat', rm.modelFormat === 'glb');
check('undo keeps a 3D card\'s renderMode', rm.renderMode === 'wireframe');
check('undo keeps a 3D card\'s bgColor', rm.bgColor === '#112233');
check('undo keeps a 3D card\'s camera position/target', rm.cameraPosition.z === 3 && rm.cameraTarget.x === 0);
check('undo keeps a field that does not exist yet (no whitelist left to go stale)', rm.someFutureField && rm.someFutureField.nested[2] === 3);
rm.cameraPosition.x = 999;            /* nested objects must not alias the stored snapshot */
rm.someFutureField.nested.push(4);
KanvazHistory.redo(); KanvazHistory.undo();
check('nested object fields do not alias back into the undo stack', sandbox.KanvazCards.getAll().M.cameraPosition.x === 1 && sandbox.KanvazCards.getAll().M.someFutureField.nested.length === 3);

console.log('\n' + (pass ? 'ALL HISTORY ALIAS TESTS PASSED' : 'HISTORY ALIAS TESTS FAILED'));
process.exit(pass ? 0 : 1);
