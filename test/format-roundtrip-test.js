#!/usr/bin/env node
/* ============================================================
   Kanvaz — .kanvaz container format round-trip test
   Verifies the v2 zip container (src/board-container.js) never
   loses or corrupts data, correctly tells old plain-JSON files
   apart from new zip ones, and degrades a single damaged asset
   gracefully instead of taking the whole board down.
   Usage: node test/format-roundtrip-test.js
   ============================================================ */

var path = require('path');
var assert = require('assert');
var boardContainer = require(path.join(__dirname, '..', 'src', 'board-container.js'));

var PNG_1PX = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

var testBoard = {
  version: '4.1.0',
  savedAt: new Date().toISOString(),
  activeIdx: 0,
  boards: [{
    id: 'board-1', name: 'Test Board',
    cards: [
      { id: 'card-img', type: 'image', dataUrl: 'data:image/png;base64,' + PNG_1PX, name: 'pixel.png', path: null, x: 0, y: 0, w: 100, h: 100, z: 1, pinned: false, annotations: [] },
      { id: 'card-note', type: 'note', dataUrl: null, name: 'Note', text: 'hello world', path: null, x: 0, y: 0, w: 100, h: 100, z: 2, pinned: false, annotations: [] },
      { id: 'card-url', type: 'url', dataUrl: null, name: 'URL reference', url: 'https://example.com', path: null, x: 0, y: 0, w: 100, h: 100, z: 3, pinned: false, annotations: [] }
    ],
    canvasX: 0, canvasY: 0, canvasScale: 1
  }],
  connections: []
};

function run() {
  var originalJson = JSON.stringify(testBoard);
  var oldBuf = Buffer.from(originalJson, 'utf8');

  assert.strictEqual(boardContainer.looksLikeZip(oldBuf), false, 'plain JSON must NOT be detected as zip');
  console.log('  ✓ old plain-JSON files still detected correctly');

  return boardContainer.packBoard(originalJson).then(function(zipBuf) {
    assert.strictEqual(boardContainer.looksLikeZip(zipBuf), true, 'packed board must be detected as zip');
    console.log('  ✓ new saves produce a real zip container (' + zipBuf.length + 'B vs ' + originalJson.length + 'B as plain JSON)');

    return boardContainer.unpackBoard(zipBuf).then(function(unpackedJson) {
      var unpacked = JSON.parse(unpackedJson);
      var imgCard  = unpacked.boards[0].cards[0];
      var noteCard = unpacked.boards[0].cards[1];
      var urlCard  = unpacked.boards[0].cards[2];

      assert.strictEqual(imgCard.dataUrl, 'data:image/png;base64,' + PNG_1PX, 'image dataUrl must survive round trip byte-for-byte');
      assert.strictEqual(imgCard.assetRef, undefined, 'assetRef bookkeeping must not leak into the rehydrated card');
      assert.strictEqual(imgCard.assetHash, undefined, 'assetHash bookkeeping must not leak into the rehydrated card');
      console.log('  ✓ embedded media round-trips byte-for-byte, no leftover container fields');

      assert.strictEqual(noteCard.text, 'hello world');
      assert.strictEqual(noteCard.dataUrl, null);
      assert.strictEqual(urlCard.url, 'https://example.com');
      console.log('  ✓ non-media cards (note/url/etc) pass through untouched');

      var JSZip = require('jszip');
      return JSZip.loadAsync(zipBuf).then(function(zip) {
        return zip.file('assets/card-img.png').async('nodebuffer').then(function(buf) {
          var tampered = Buffer.concat([buf, Buffer.from([0xFF])]);
          zip.file('assets/card-img.png', tampered);
          return zip.generateAsync({ type: 'nodebuffer' });
        });
      }).then(function(tamperedZipBuf) {
        return boardContainer.unpackBoard(tamperedZipBuf).then(function(resultJson) {
          var result = JSON.parse(resultJson);
          assert.strictEqual(result.boards[0].cards[0].dataUrl, null, 'a corrupted asset must resolve to null (Missing media UI), never throw or return bad bytes');
          console.log('  ✓ a corrupted asset degrades to "missing media" instead of crashing or silently returning bad data');
        });
      });
    });
  });
}

run().then(function() {
  console.log('\nALL FORMAT ROUND-TRIP TESTS PASSED');
  process.exit(0);
}).catch(function(e) {
  console.error('\nFORMAT ROUND-TRIP TEST FAILED');
  console.error(e);
  process.exit(1);
});
