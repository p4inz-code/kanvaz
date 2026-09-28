/* preview-quality.js — the Low/Medium/High preview-quality setting's actual
   numbers, in one place so main.js (Adobe worker), cards.js (3D renderer
   pixel ratio, PDF canvas DPI) and properties.js (the per-card override row)
   can never disagree about what "High" means.

   Global default is 'low' (Settings → Preview Quality) — a deliberately
   conservative default, since "High" on a large/complex board can
   genuinely slow a modest machine down; anyone who wants sharper previews
   opts in, per the same reasoning Smart Search's default-off already uses.
   A card's own `previewQuality` field (undefined by default) overrides the
   global setting for just that one card — set from Properties, for the one
   heavy model or PDF that needs to look better (or lighter) than everything
   else on the board.

   Loaded directly by both the renderer (a plain <script>, like platform.js)
   and main.js (via require()) — ES5/var-only, no Node-only APIs, so it
   works unmodified in either context. */
var KanvazPreviewQuality = (function() {
  'use strict';

  var LEVELS = ['low', 'medium', 'high'];
  var DEFAULT_LEVEL = 'low';

  function isLevel(v) { return LEVELS.indexOf(v) !== -1; }

  /* cardOverride: card.previewQuality (may be undefined/invalid).
     globalSetting: the Settings value (may itself be missing/invalid on an
     old settings.json). Always returns a real level, never garbage. */
  function resolve(cardOverride, globalSetting) {
    if (isLevel(cardOverride)) return cardOverride;
    if (isLevel(globalSetting)) return globalSetting;
    return DEFAULT_LEVEL;
  }

  /* Bug found live (direct report: "when I do low to high resolution for
     3D card it doesn't work or give any diff"): both of the functions
     below used to be a plain CAP — Math.min(devicePixelRatio, cap) — on
     the OS's real device pixel ratio. On any ordinary, non-HiDPI display
     (devicePixelRatio === 1, the common case on Windows, and exactly
     what a bug report with zero visible difference between levels
     implies), min(1, 1) === min(1, 2) === min(1, 3) === 1 — Low/Medium/
     High all resolved to the SAME number, so the setting could never
     produce a visible difference on that class of machine at all,
     regardless of which level was picked. It only ever did anything on
     a Retina/HiDPI screen, where devicePixelRatio already exceeds 1.

     Fixed by making each level a real MULTIPLIER on the native ratio
     instead of a ceiling under it — Low deliberately renders BELOW
     native (lighter GPU load, the "may run faster" side of the trade-off
     this setting is supposed to offer), Medium matches native exactly
     (unchanged from what every 3D card silently used before this
     setting existed), High supersamples past native. Every level now
     produces a real, different number on every display, HiDPI or not;
     the overall result is still capped (3 for 3D, matching the old
     ceiling) so a very high native DPR times the High multiplier can't
     run away to something absurd. */
  function pixelRatioFor(level, nativeDpr) {
    var dpr = (typeof nativeDpr === 'number' && nativeDpr > 0) ? nativeDpr : 1;
    if (level === 'high') return Math.min(dpr * 1.5, 3);
    if (level === 'low') return Math.max(dpr * 0.5, 0.5);
    return dpr; /* medium: native, unchanged behavior */
  }

  /* Same fix, same reasoning, for PDF preview's render scale — the old
     ceiling-of-3 stays the effective max at native DPR 2 (High = 3), a
     non-HiDPI display now actually gets three different, visibly
     distinct render scales instead of all three landing on 1. */
  function pdfDprFor(level, nativeDpr) {
    return pixelRatioFor(level, nativeDpr);
  }

  /* Longest side, in pixels, of a decoded PSD/PSB/etc. preview image —
     mirrors the values main.js's adobe-preview IPC handler already used. */
  function adobeMaxSide(level) {
    if (level === 'high') return 6144;
    if (level === 'medium') return 3072;
    return 1536;
  }

  /* Shown next to the High option in Settings and on the per-card override
     — the friendly, specific warning the owner asked for instead of a bare
     "this might be slow." */
  var HIGH_WARNING = 'High-quality previews use more GPU/CPU — a board with several 3D or PDF cards may run slower or get warm on a laptop. Safe to try; switch back to Medium or Low any time.';

  return {
    LEVELS: LEVELS,
    DEFAULT_LEVEL: DEFAULT_LEVEL,
    HIGH_WARNING: HIGH_WARNING,
    isLevel: isLevel,
    resolve: resolve,
    pixelRatioFor: pixelRatioFor,
    pdfDprFor: pdfDprFor,
    adobeMaxSide: adobeMaxSide
  };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = KanvazPreviewQuality;
