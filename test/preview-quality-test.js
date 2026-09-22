/* Unit tests for src/preview-quality.js — the Low/Medium/High numbers shared
   by main.js (Adobe worker), cards.js (3D pixel ratio, PDF DPI) and
   properties.js (per-card override).
   Run: node test/preview-quality-test.js */
var assert = require('assert');
var Q = require('../src/preview-quality');

function run() {
  assert.deepStrictEqual(Q.LEVELS, ['low', 'medium', 'high']);
  assert.strictEqual(Q.DEFAULT_LEVEL, 'low', 'global default is Low — a deliberately light default');
  console.log('  ✓ three levels, default is low');

  assert.strictEqual(Q.resolve(undefined, 'high'), 'high', 'no card override: falls back to the global setting');
  assert.strictEqual(Q.resolve('medium', 'high'), 'medium', 'a card override wins over the global setting');
  assert.strictEqual(Q.resolve(undefined, undefined), 'low', 'nothing set at all: falls back to the hard default');
  assert.strictEqual(Q.resolve('bogus', 'high'), 'high', 'an invalid card override is ignored, falls back to global');
  assert.strictEqual(Q.resolve(undefined, 'bogus'), 'low', 'an invalid global setting (e.g. old settings.json) falls back to the hard default');
  console.log('  ✓ resolve(): per-card override beats global, invalid values never produced');

  assert.deepStrictEqual([Q.pixelRatioCap('low'), Q.pixelRatioCap('medium'), Q.pixelRatioCap('high')], [1, 2, 3], '3D pixel ratio cap climbs low->high, medium matches the old unconditional default');
  assert.deepStrictEqual([Q.pdfDprCap('low'), Q.pdfDprCap('medium'), Q.pdfDprCap('high')], [1, 2, 3], 'PDF DPI cap climbs low->high, high matches the old unconditional ceiling');
  assert.deepStrictEqual([Q.adobeMaxSide('low'), Q.adobeMaxSide('medium'), Q.adobeMaxSide('high')], [1536, 3072, 6144], 'Adobe preview max side matches what main.js already used');
  console.log('  ✓ pixelRatioCap/pdfDprCap/adobeMaxSide: monotonically increasing, matches pre-existing hardcoded numbers');

  assert(Q.HIGH_WARNING.length > 20 && /slow/i.test(Q.HIGH_WARNING), 'a real, specific warning string exists for the High option');
  console.log('  ✓ HIGH_WARNING is a real, specific string');

  console.log('ALL PREVIEW QUALITY TESTS PASSED');
}

run();
