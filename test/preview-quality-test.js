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

  /* Bug fix, found live: pixelRatioCap/pdfDprCap used to be Math.min(nativeDpr, cap)
     — on any display with devicePixelRatio 1 (ordinary, non-HiDPI, the common
     case), min(1,1) === min(1,2) === min(1,3) === 1, so Low/Medium/High were
     ALL the same number and the setting had literally no visible effect there.
     pixelRatioFor/pdfDprFor take the native DPR as a real input and multiply
     (0.5x / 1x / 1.5x, capped at 3) instead of capping under it, so every level
     produces a genuinely different number on EVERY display, HiDPI or not. */
  assert.deepStrictEqual([Q.pixelRatioFor('low', 1), Q.pixelRatioFor('medium', 1), Q.pixelRatioFor('high', 1)], [0.5, 1, 1.5], 'at native DPR 1 (ordinary display), the three levels must still be visibly different');
  assert.deepStrictEqual([Q.pixelRatioFor('low', 2), Q.pixelRatioFor('medium', 2), Q.pixelRatioFor('high', 2)], [1, 2, 3], 'at native DPR 2 (Retina/HiDPI), matches the old 1/2/3 numbers exactly — no regression for that class of display');
  assert.strictEqual(Q.pixelRatioFor('high', 4), 3, 'High is still capped overall (3) even on a very high native DPR');
  assert.deepStrictEqual([Q.pdfDprFor('low', 1), Q.pdfDprFor('medium', 1), Q.pdfDprFor('high', 1)], [0.5, 1, 1.5], 'same fix applies to PDF preview DPI');
  assert.deepStrictEqual([Q.adobeMaxSide('low'), Q.adobeMaxSide('medium'), Q.adobeMaxSide('high')], [1536, 3072, 6144], 'Adobe preview max side matches what main.js already used');
  console.log('  ✓ pixelRatioFor/pdfDprFor: real difference at every native DPR (bug fix), adobeMaxSide unchanged');

  assert(Q.HIGH_WARNING.length > 20 && /slow/i.test(Q.HIGH_WARNING), 'a real, specific warning string exists for the High option');
  console.log('  ✓ HIGH_WARNING is a real, specific string');

  console.log('ALL PREVIEW QUALITY TESTS PASSED');
}

run();
