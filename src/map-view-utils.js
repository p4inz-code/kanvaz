/* map-view-utils.js — Map View's pure color/bezier helpers (v9.7.0,
 * split out of map-view.js)
 *
 * Third piece of the file-size cleanup, and the narrowest of the three:
 * only the handful of genuinely PURE functions in map-view.js — take
 * explicit parameters, touch no shared pan/zoom/DOM state (`container`,
 * `world`, `tx`/`ty`/`scale`, `selectedNode`, ...) — were safe to move
 * without live verification. Everything else in map-view.js (rendering,
 * wire drag, the minimap) stays put; it shares that mutable state too
 * deeply to split blind.
 */

var KanvazMapViewUtils = (function() {

  /* ── Node color-coding (4.7.0) ──
     By tag if the card has one (deterministic hash -> hue, so the same
     tag always gets the same color across a session without needing a
     stored palette), else by card type from this fixed set — visual
     grouping at a glance, the actual ask, without needing a UI toggle
     between "by tag" and "by type" modes. */
  var NODE_TYPE_COLORS = {
    image: '#5FA8E0', gif: '#F0A500', video: '#FF5A5A', audio: '#4CAF82',
    note: '#9D7FFF', text: '#9D7FFF', url: '#5FA8E0', color: '#F0A500', file: '#8F8FC2',
    /* v8.x fix: 'model3d' was missing here too — same "forgot to update
       when 3D shipped in v7.4.0" gap already found in reference-types.js
       and plugin-api.js. Every 3D model node fell through to the plain
       'var(--color-border-2)' fallback below, reading as visually
       undefined/neutral instead of getting its own accent like every
       other type does — a real, visible gap on exactly the card type
       this v8.x line is meant to make the flagship identity. */
    model3d: '#2FB8A8'
  };

  function hashColor(str) {
    var hash = 0;
    for (var i = 0; i < str.length; i++) hash = (hash * 31 + str.charCodeAt(i)) | 0;
    var hue = Math.abs(hash) % 360;
    return 'hsl(' + hue + ', 65%, 60%)';
  }

  function nodeAccentColor(card) {
    if (card.tags && card.tags.length) return hashColor(card.tags[0]);
    return NODE_TYPE_COLORS[card.type] || 'var(--color-border-2)';
  }

  /* ── Type colors ──
     Polish fix: kept in sync with inspector.js's TYPE_COLORS, which has
     the full reasoning — was a raw, unmodified Tailwind palette with no
     relation to Kanvaz's own purple-accent identity; recolored to the
     app's actual tokens where a fit exists, plus two new hand-picked
     hues only where 7 distinct types need more separation than 4
     existing tokens provide. */
  var TYPE_COLORS = {
    RelatedTo:     '#8F8FC2',
    InspiredBy:    '#9D7FFF',
    DerivedFrom:   '#5FA8E0',
    AlternativeTo: '#F0A500',
    Supports:      '#4CAF82',
    UsedIn:        '#FF5A5A',
    References:    '#E07AC0'
  };

  function typeColor(t) { return TYPE_COLORS[t] || '#6B7280'; }
  function typeLabel(t) { return t.replace(/([A-Z])/g, ' $1').trim(); }

  /* ══════════════════════════════════════════
     BEZIER MATH — Unreal/Maya style
     ══════════════════════════════════════════ */

  /* High-tension horizontal bezier — control points pull far out
     horizontally so the cable "pours" out of the port before curving.
     Minimum tension of 90px ensures short-distance connections still
     look like cables not diagonal lines.

     Bug fix (found live via QA): two or more connections between the
     SAME pair of cards (allowed — different types can coexist, up to
     the 8-cap) all resolve to the exact same op/ip endpoints, so they
     used to produce the byte-identical path string and render as one
     fully overlapping tube with every label stacked at the same point
     — unreadable, and easy to trigger for real (wire one relationship,
     then add a second one later between the same two cards). `perpOffset`
     bows just the control points — endpoints stay exactly on the real
     ports — so each connection in a shared-pair bundle fans out into
     its own visually distinct arc instead of hiding the others. */
  function bezierPath(x1, y1, x2, y2, perpOffset) {
    var dx = x2 - x1;
    /* Tension is distance-proportional but floored at 90 and capped
       so very long connections don't look too stiff */
    var tension = Math.max(90, Math.min(Math.abs(dx) * 0.55, 320));
    /* When target is to the LEFT of source, increase tension further
       so the cable loops around gracefully */
    if (dx < 0) tension = Math.max(140, Math.abs(dx) * 0.7);
    var off = perpOffset || 0;
    return 'M ' + x1 + ' ' + y1
      + ' C ' + (x1 + tension) + ' ' + (y1 + off)
      + ', '  + (x2 - tension) + ' ' + (y2 + off)
      + ', '  + x2 + ' ' + y2;
  }

  return {
    hashColor: hashColor,
    nodeAccentColor: nodeAccentColor,
    typeColor: typeColor,
    typeLabel: typeLabel,
    bezierPath: bezierPath
  };

})();
