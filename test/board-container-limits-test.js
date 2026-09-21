#!/usr/bin/env node
/* ============================================================
   Kanvaz — board-container.js decompression-limit test
   Usage: node test/board-container-limits-test.js
   ============================================================ */

var path = require('path');
var assert = require('assert');
var JSZip = require(path.join(__dirname, '..', 'node_modules', 'jszip'));
var bc = require(path.join(__dirname, '..', 'src', 'board-container.js'));

function makeZip(files) {
  var z = new JSZip();
  Object.keys(files).forEach(function(n) { z.file(n, files[n]); });
  return z.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}

function rejects(p, re, label) {
  return p.then(function() { assert.fail(label + ' should have been rejected'); }, function(e) {
    assert.ok(re.test(e.message), label + ': wrong error: ' + e.message);
  });
}

var tiny = JSON.stringify({ boards: [{ cards: [] }] });

makeZip({ 'board.json': tiny }).then(function(buf) {
  return bc.unpackBoard(buf).then(function(out) {
    assert.deepStrictEqual(JSON.parse(out), JSON.parse(tiny));
    console.log('  ✓ a normal board still opens unchanged');
  });
}).then(function() {
  /* highly compressible 4 MB board.json in a tiny zip = the zip-bomb shape */
  return makeZip({ 'board.json': JSON.stringify({ pad: new Array(4 * 1024 * 1024).join('a') }) }).then(function(buf) {
    assert.ok(buf.length < 100 * 1024, 'the bomb-shaped fixture must be small on disk, got ' + buf.length);
    return rejects(bc.unpackBoard(buf, { maxBoardJsonBytes: 1024 * 1024 }), /larger than the allowed size/, 'oversized board.json');
  });
}).then(function() {
  console.log('  ✓ tiny zip that inflates past the board.json cap is rejected before inflating');
  return makeZip({ 'board.json': tiny, 'assets/a.png': Buffer.alloc(2 * 1024 * 1024, 1) }).then(function(buf) {
    return rejects(bc.unpackBoard(buf, { maxAssetBytes: 1024 * 1024 }), /larger than the allowed size/, 'oversized asset');
  });
}).then(function() {
  console.log('  ✓ oversized asset entry is rejected');
  return makeZip({ 'board.json': tiny, 'a.bin': Buffer.alloc(600 * 1024, 1), 'b.bin': Buffer.alloc(600 * 1024, 2) }).then(function(buf) {
    return rejects(bc.unpackBoard(buf, { maxTotalBytes: 1024 * 1024 }), /unpacked size is too large/, 'total size');
  });
}).then(function() {
  console.log('  ✓ many moderate entries cannot add up past the total cap');
  var files = { 'board.json': tiny };
  for (var i = 0; i < 30; i++) files['f' + i + '.txt'] = 'x';
  return makeZip(files).then(function(buf) {
    return rejects(bc.unpackBoard(buf, { maxEntries: 10 }), /too many entries/, 'entry count');
  });
}).then(function() {
  console.log('  ✓ entry-count cap enforced');
  console.log('\nALL BOARD CONTAINER LIMIT TESTS PASSED');
  process.exit(0);
}).catch(function(e) {
  console.error('\nBOARD CONTAINER LIMIT TEST FAILED');
  console.error(e);
  process.exit(1);
});
