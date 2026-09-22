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

  /* 3D card renderer.setPixelRatio() cap. 'medium' (2) matches what every
     3D card silently used before this setting existed — Low is the new,
     lighter default; High goes past native pixel density on most screens,
     which is where the "may run slower" warning earns its keep. */
  function pixelRatioCap(level) {
    if (level === 'high') return 3;
    if (level === 'medium') return 2;
    return 1;
  }

  /* PDF preview canvas render scale (screen device-pixel-ratio cap). Same
     numbers PDF preview already used unconditionally (capped at 3) —
     Low/Medium now actually back off from that ceiling instead of every
     PDF always rendering at the sharpest setting regardless of the card's
     visible size. */
  function pdfDprCap(level) {
    if (level === 'high') return 3;
    if (level === 'medium') return 2;
    return 1;
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
    pixelRatioCap: pixelRatioCap,
    pdfDprCap: pdfDprCap,
    adobeMaxSide: adobeMaxSide
  };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = KanvazPreviewQuality;
