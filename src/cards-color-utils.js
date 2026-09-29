/* cards-color-utils.js — pure color-format/contrast helpers (v9.7.0,
 * split out of cards.js)
 *
 * Fourth piece of the file-size cleanup. Same "only move what's
 * genuinely pure" rule as map-view-utils.js: every function here takes
 * explicit parameters and touches no card/DOM state, so this was safe
 * to extract without live verification. Note: colorpicker.js and the
 * Theme Creator plugin each carry their own independent copy of
 * hexToRgb — pre-existing duplication, left alone here; consolidating
 * those is a separate cleanup, not part of this split.
 */

var KanvazCardsColorUtils = (function() {

  function hexToRgb(hex) {
    var h = hex.replace('#', '');
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    return {
      r: parseInt(h.substring(0, 2), 16),
      g: parseInt(h.substring(2, 4), 16),
      b: parseInt(h.substring(4, 6), 16)
    };
  }

  function rgbToHsl(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    var max = Math.max(r, g, b), min = Math.min(r, g, b);
    var h, s, l = (max + min) / 2;
    if (max === min) {
      h = s = 0;
    } else {
      var d = max - min;
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      if (max === r)      h = (g - b) / d + (g < b ? 6 : 0);
      else if (max === g) h = (b - r) / d + 2;
      else                 h = (r - g) / d + 4;
      h /= 6;
    }
    return { h: Math.round(h * 360), s: Math.round(s * 100), l: Math.round(l * 100) };
  }

  function formatColorString(hex, format) {
    var rgb = hexToRgb(hex);
    if (format === 'rgb') {
      return 'rgb(' + rgb.r + ', ' + rgb.g + ', ' + rgb.b + ')';
    }
    if (format === 'hsl') {
      var hsl = rgbToHsl(rgb.r, rgb.g, rgb.b);
      return 'hsl(' + hsl.h + ', ' + hsl.s + '%, ' + hsl.l + '%)';
    }
    return hex.toUpperCase();
  }

  /* WCAG 2 relative luminance / contrast ratio of two #rrggbb colours.
     Anything that does not parse counts as black. */
  function relLuminance(hex) {
    var m = /^#?([0-9a-f]{6})$/i.exec(String(hex || ''));
    var n = m ? parseInt(m[1], 16) : 0;
    var ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map(function(v) {
      v /= 255;
      return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
  }
  function contrastRatio(a, b) {
    var la = relLuminance(a), lb = relLuminance(b);
    return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
  }

  return {
    hexToRgb: hexToRgb,
    rgbToHsl: rgbToHsl,
    formatColorString: formatColorString,
    relLuminance: relLuminance,
    contrastRatio: contrastRatio
  };

})();
