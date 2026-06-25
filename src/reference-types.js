/* reference-types.js — type registry for all reference kinds (v3.0)
 *
 * Central place to define what types of references exist, how they
 * display, what icon they use, and what fields they support.
 * media.js still handles file-drop type detection; this module
 * handles the abstract type system on top of that.
 */

var KanvazRefTypes = (function() {

  /* ── Type definitions ──
   *
   * Each type has:
   *   label     — human-readable display name
   *   icon      — single emoji for compact display
   *   category  — grouping: 'media', 'link', 'abstract'
   *   hasMedia  — whether the ref embeds base64 data
   *   fields    — type-specific fields beyond the base card schema
   */
  var TYPES = {
    image:   { label: 'Image',   icon: '\uD83D\uDDBC\uFE0F', category: 'media',    hasMedia: true,  fields: [] },
    gif:     { label: 'GIF',     icon: '\uD83C\uDFAC',       category: 'media',    hasMedia: true,  fields: [] },
    video:   { label: 'Video',   icon: '\uD83C\uDFA5',       category: 'media',    hasMedia: true,  fields: [] },
    audio:   { label: 'Audio',   icon: '\uD83C\uDFB5',       category: 'media',    hasMedia: true,  fields: [] },
    note:    { label: 'Note',    icon: '\uD83D\uDCDD',       category: 'abstract', hasMedia: false, fields: [] },
    url:     { label: 'URL',     icon: '\uD83D\uDD17',       category: 'link',     hasMedia: false, fields: ['url'] },
    pdf:     { label: 'PDF',     icon: '\uD83D\uDCC4',       category: 'media',    hasMedia: true,  fields: ['pageCount'] },
    color:   { label: 'Color',   icon: '\uD83C\uDFA8',       category: 'abstract', hasMedia: false, fields: ['color'] },
    file:    { label: 'File',    icon: '\uD83D\uDCC1',       category: 'link',     hasMedia: false, fields: ['fileSize', 'mimeType'] },
    outcome: { label: 'Outcome', icon: '\uD83C\uDFAF',       category: 'abstract', hasMedia: false, fields: [] }
  };

  /* ── Queries ── */

  function getType(typeName) {
    return TYPES[typeName] || null;
  }

  function getLabel(typeName) {
    var t = TYPES[typeName];
    return t ? t.label : typeName;
  }

  function getIcon(typeName) {
    var t = TYPES[typeName];
    return t ? t.icon : '\u2753';
  }

  function getCategory(typeName) {
    var t = TYPES[typeName];
    return t ? t.category : 'unknown';
  }

  function hasMedia(typeName) {
    var t = TYPES[typeName];
    return t ? t.hasMedia : false;
  }

  function isValid(typeName) {
    return !!TYPES[typeName];
  }

  function getAllTypes() {
    var out = [];
    for (var k in TYPES) {
      out.push(k);
    }
    return out;
  }

  function getTypesByCategory(category) {
    var out = [];
    for (var k in TYPES) {
      if (TYPES[k].category === category) out.push(k);
    }
    return out;
  }

  /* ── Public API ── */

  return {
    TYPES:              TYPES,
    getType:            getType,
    getLabel:           getLabel,
    getIcon:            getIcon,
    getCategory:        getCategory,
    hasMedia:           hasMedia,
    isValid:            isValid,
    getAllTypes:         getAllTypes,
    getTypesByCategory: getTypesByCategory
  };

})();
