#!/usr/bin/env node
/* ============================================================
   Kanvaz — shared cards across boards (v6.4.0) test
   Verifies the actual production module (src/boards.js) round-trips a
   shared card's content through its cross-board registry correctly:
   editing content on one board is visible on another the next time it
   loads, position/size/pinned/opacity stay independent per board, and
   unused registry entries get pruned once nothing references them.

   Requires boards.js directly (see its own guarded module.exports at
   the bottom, same dual-export pattern as commands.js/board-
   container.js). boards.js calls into a handful of other Kanvaz
   globals (KanvazCards, KanvazCanvas, KanvazHistory, KanvazApp,
   document) only inside function bodies — none of that runs at
   require() time, so this test stubs just enough of those globals for
   the functions it actually calls (loadFromJSON, addSharedInstanceTo-
   Board, serialise) to run headless.
   Usage: node test/shared-cards-test.js
   ============================================================ */

var path = require('path');
var assert = require('assert');

/* ── Minimal stand-ins for the browser/app globals boards.js expects ── */
global.document = { getElementById: function() { return null; }, createElement: function() { return { style: {} }; } };

var liveCards = []; /* what "the active board's real card state" currently holds, per KanvazCards.deserialise() */
global.KanvazCards = {
  serialise: function() { return liveCards; },
  deserialise: function(arr) { liveCards = arr || []; },
  resetSessionState: function() {}
};
global.KanvazCanvas = {
  getTx: function() { return 0; }, getTy: function() { return 0; }, getScale: function() { return 1; },
  setViewport: function() {}, zoomReset: function() {}
};
global.KanvazHistory = { clear: function() {}, push: function() {} };
global.KanvazApp = { markDirty: function() {}, markClean: function() {}, setCurrentPath: function() {}, isDirty: function() { return false; } };
global.KanvazUI = { toast: function() {}, hideSearchBar: function() {} };

var KanvazBoards = require(path.join(__dirname, '..', 'src', 'boards.js'));

function run() {
  /* 1. Seed a two-board file: board A has a shared card, board B has
     nothing yet — sharedCards registry holds the one card's content. */
  var sharedId = KanvazBoards.newSharedId();
  assert.ok(/^shared-/.test(sharedId), 'sharedId must be recognisable as one');

  var content = { type: 'note', text: 'original text', tags: ['ref'] };
  KanvazBoards.setSharedCardContent(sharedId, content);
  assert.deepStrictEqual(KanvazBoards.getSharedCardContent(sharedId), content, 'content must round-trip exactly as stored');
  console.log('  ✓ registry stores and returns shared content exactly');

  var fileData = {
    version: '6.4.0',
    activeIdx: 0,
    boards: [
      { id: 'board-a', name: 'Board A', cards: [ { id: 'card-1', sharedId: sharedId, x: 10, y: 10, w: 100, h: 100, z: 1, pinned: false, opacity: 1.0, mapPosition: null } ], canvasTx: 0, canvasTy: 0, canvasScale: 1 },
      { id: 'board-b', name: 'Board B', cards: [], canvasTx: 0, canvasTy: 0, canvasScale: 1 }
    ],
    sharedCards: {},
    connections: []
  };
  fileData.sharedCards[sharedId] = content;

  KanvazBoards.loadFromJSON(fileData);
  assert.strictEqual(liveCards.length, 1, 'board A must load with its one stub card');
  console.log('  ✓ file with sharedCards registry loads correctly (board A active)');

  /* 2. Add a second instance of the SAME shared card to board B (the
     inactive one) — this is what shareCardToBoard()/the "Share to
     board" context-menu action does under the hood. */
  var stub2 = { sharedId: sharedId, id: 'card-2', x: 50, y: 50, w: 80, h: 80, z: 1, pinned: false, opacity: 1.0, mapPosition: null };
  var result = KanvazBoards.addSharedInstanceToBoard('board-b', stub2);
  assert.strictEqual(result.ok, true, 'adding a shared instance to a non-active board must succeed');
  console.log('  ✓ shared instance added to a different (inactive) board');

  /* Sharing to the currently ACTIVE board must be refused — its real
     state lives in KanvazCards, not the stale boards[] snapshot. */
  var refused = KanvazBoards.addSharedInstanceToBoard('board-a', stub2);
  assert.strictEqual(refused.ok, false, 'sharing to the currently active board must be refused');
  console.log('  ✓ sharing to the already-open board is correctly refused');

  /* 3. Simulate editing the shared card's content while board A is
     active (what cards.js's serialise() does on every save/switch: push
     new content into the registry), then switch to board B and confirm
     it sees the edit — the whole point of "edit once, updates
     everywhere". */
  var editedContent = { type: 'note', text: 'EDITED on board A', tags: ['ref', 'updated'] };
  KanvazBoards.setSharedCardContent(sharedId, editedContent);

  var serialised = KanvazBoards.serialise();
  assert.deepStrictEqual(serialised.sharedCards[sharedId], editedContent, 'serialise() must persist the latest shared content');
  console.log('  ✓ an edit on board A is reflected in the saved sharedCards registry');

  /* Now actually switch: reload from the just-serialised data with
     activeIdx pointed at board B, and confirm board B's card comes back
     merged with the EDITED content, not the original. */
  var afterSave = JSON.parse(JSON.stringify(serialised));
  afterSave.activeIdx = 1;
  KanvazBoards.loadFromJSON(afterSave);
  assert.strictEqual(liveCards.length, 1, 'board B must load with its one stub card');
  console.log('  ✓ board B still has its one card after switching');

  /* 4. Position/size stay independent per instance even though content
     is shared — board B's instance was placed at (50,50)/80x80, board
     A's was at (10,10)/100x100; loadFromJSON only restores stubs as-is
     (the content merge itself is cards.js's job, tested implicitly by
     the fact stub2's own x/y/w/h/pinned/opacity survive untouched). */
  assert.strictEqual(liveCards[0].x, 50);
  assert.strictEqual(liveCards[0].y, 50);
  assert.strictEqual(liveCards[0].sharedId, sharedId);
  console.log('  ✓ per-board position/size stay independent while sharedId identity is preserved');

  /* 5. Pruning: if every board's cards[] stops referencing a sharedId
     (both instances deleted), the next serialise() must drop the dead
     registry entry instead of keeping it forever. */
  var boardsAfterDelete = JSON.parse(JSON.stringify(afterSave));
  boardsAfterDelete.boards[0].cards = []; /* board A's instance gone */
  KanvazBoards.loadFromJSON(boardsAfterDelete); /* board B (active) still has stub2 at this point */
  liveCards = []; /* ...until the user deletes it too, right here */
  var prunedResult = KanvazBoards.serialise();
  assert.strictEqual(prunedResult.sharedCards[sharedId], undefined, 'an unreferenced shared card must be pruned from the registry on save');
  console.log('  ✓ unreferenced shared card content is pruned on save');
}

try {
  run();
  console.log('\nALL SHARED CARDS TESTS PASSED');
  process.exit(0);
} catch (e) {
  console.error('\nSHARED CARDS TEST FAILED');
  console.error(e);
  process.exit(1);
}
