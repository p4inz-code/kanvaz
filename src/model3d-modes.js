/* ============================================================
   model3d-modes.js — render modes for 3D model cards

   Each mode is data: a key, a label and a build(THREE, srcMaterial, ctx)
   that returns the replacement for ONE original material. "normal" (shown
   as "Shaded") returns nothing: the file's own material is used untouched.
   applyToScene() swaps every mesh's material, building each replacement
   once per mesh and caching it on node.userData.kanvazModeMats, so toggling
   modes is instant and does not keep allocating GPU materials.

   Why this exists as a module: the first version hard-coded three modes as
   branches in cards.js. Matcap built a bare MeshMatcapMaterial({matcap,
   map}), which dropped the base colour, opacity, alpha map and sidedness,
   so any coloured or transparent model turned into a blue-grey opaque
   blob. Every builder below now carries the source material's colour and
   transparency across, and a registry is what lets a later phase (depth,
   UV checker, plugin-registered modes) add a mode without touching cards.js.

   The persisted key for the lit view stays 'normal' (existing .kanvaz
   files, undo history and plugins use it); only its label changed.
   ============================================================ */

var KanvazModel3DModes = (function() {

  /* Copies the properties that decide whether and how a surface is see-
     through or double-sided, so a replacement material keeps them. */
  function copySurface(dst, src) {
    dst.side        = src.side;
    dst.transparent = !!src.transparent;
    dst.opacity     = (src.opacity !== undefined) ? src.opacity : 1;
    dst.depthWrite  = (src.depthWrite !== undefined) ? src.depthWrite : true;
    dst.alphaTest   = src.alphaTest || 0;
    return dst;
  }

  function colorOf(THREE, m) {
    return (m && m.color && m.color.isColor) ? m.color.clone() : new THREE.Color(0xffffff);
  }

  var MODES = [
    { key: 'normal', label: 'Shaded', title: 'Shaded: the model as the file describes it', build: null },

    { key: 'normals', label: 'Normals', title: 'Normals: surface direction as colour',
      build: function(THREE, m) {
        var mat = new THREE.MeshNormalMaterial({
          normalMap: m.normalMap || null,
          bumpMap: m.bumpMap || null
        });
        if (m.normalScale && mat.normalScale) mat.normalScale.copy(m.normalScale);
        return copySurface(mat, m);
      } },

    { key: 'matcap', label: 'Matcap', title: 'Matcap: studio shading that keeps colour and transparency',
      build: function(THREE, m, ctx) {
        var mat = new THREE.MeshMatcapMaterial({
          matcap: ctx.matcapTex,
          color: colorOf(THREE, m),
          map: m.map || null,
          alphaMap: m.alphaMap || null,
          normalMap: m.normalMap || null,
          vertexColors: !!m.vertexColors
        });
        if (m.normalScale && mat.normalScale) mat.normalScale.copy(m.normalScale);
        return copySurface(mat, m);
      } },

    { key: 'wireframe', label: 'Wireframe', title: 'Wireframe: the mesh edges, with the original colour',
      build: function(THREE, m) {
        var wf = m.clone();
        wf.wireframe = true;
        /* A transmission (glass) pass over lines just muddies them. */
        if ('transmission' in wf) wf.transmission = 0;
        return wf;
      } },

    /* Base colour with no lighting at all: what the artist painted. */
    { key: 'albedo', label: 'Albedo', title: 'Albedo: base colour and texture, unlit',
      build: function(THREE, m) {
        var mat = new THREE.MeshBasicMaterial({
          color: colorOf(THREE, m),
          map: m.map || null,
          alphaMap: m.alphaMap || null,
          vertexColors: !!m.vertexColors
        });
        return copySurface(mat, m);
      } },

    /* Opacity as a grey ramp: white = opaque, black = fully transparent.
       Reads the same three inputs a real alpha does (material opacity, the
       texture's alpha channel, an alpha map) by letting the standard
       shader compute diffuseColor.a, then writing that as the colour. The
       colour-space and tone-mapping steps are dropped so the ramp is the
       raw value rather than a gamma-lifted one. */
    { key: 'alpha', label: 'Alpha', title: 'Alpha: opacity as black (clear) to white (solid)',
      build: function(THREE, m) {
        var mat = new THREE.MeshBasicMaterial({
          color: 0xffffff,
          map: m.map || null,
          alphaMap: m.alphaMap || null
        });
        mat.side = m.side;
        mat.opacity = (m.opacity !== undefined) ? m.opacity : 1;
        mat.transparent = false;
        mat.alphaTest = 0;
        mat.onBeforeCompile = function(shader) {
          shader.fragmentShader = shader.fragmentShader
            .replace('#include <opaque_fragment>', 'gl_FragColor = vec4( vec3( diffuseColor.a ), 1.0 );')
            .replace('#include <tonemapping_fragment>', '')
            .replace('#include <colorspace_fragment>', '');
        };
        /* Without this key the renderer would reuse one compiled program
           for this and a plain Albedo material. */
        mat.customProgramCacheKey = function() { return 'kanvaz-alpha-view'; };
        return mat;
      } }
  ];

  function find(key) {
    for (var i = 0; i < MODES.length; i++) if (MODES[i].key === key) return MODES[i];
    return null;
  }

  /* [[key, label, title], ...] in display order. */
  function list() {
    var out = [];
    for (var i = 0; i < MODES.length; i++) out.push([MODES[i].key, MODES[i].label, MODES[i].title]);
    return out;
  }

  function isKnown(key) { return !!find(key); }

  function asArray(m) { return Array.isArray(m) ? m : [m]; }

  /* Swaps every mesh's material for the given mode. A mesh with several
     material slots has an ARRAY for .material, so replacements keep the
     same shape (array in, array out). An unknown key falls back to the
     original materials rather than leaving the model blank. */
  function applyToScene(THREE, root, key, ctx) {
    var mode = find(key) || find('normal');
    root.traverse(function(node) {
      if (!node.isMesh) return;
      var ud = node.userData;
      if (!ud.kanvazOrigMaterial) ud.kanvazOrigMaterial = node.material;
      if (!mode.build) { node.material = ud.kanvazOrigMaterial; return; }
      if (!ud.kanvazModeMats) ud.kanvazModeMats = {};
      if (!ud.kanvazModeMats[mode.key]) {
        var orig = ud.kanvazOrigMaterial;
        var built = asArray(orig).map(function(m) { return mode.build(THREE, m, ctx || {}); });
        ud.kanvazModeMats[mode.key] = Array.isArray(orig) ? built : built[0];
      }
      node.material = ud.kanvazModeMats[mode.key];
    });
  }

  /* Every material this module built for a mesh, flattened, so the owner
     can dispose them when the card is deleted. */
  function builtMaterials(node) {
    var out = [];
    var cache = node.userData && node.userData.kanvazModeMats;
    if (!cache) return out;
    var keys = Object.keys(cache);
    for (var i = 0; i < keys.length; i++) {
      var arr = asArray(cache[keys[i]]);
      for (var j = 0; j < arr.length; j++) {
        if (arr[j] && out.indexOf(arr[j]) === -1) out.push(arr[j]);
      }
    }
    return out;
  }

  /* Neutral studio shading reference, generated (no binary asset). Neutral
     on purpose: a matcap multiplies the material colour, so a blue-tinted
     one would tint every model. */
  function buildMatcapTexture(THREE, doc) {
    var size = 128;
    var canvas = (doc || document).createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    var ctx = canvas.getContext('2d');
    var grad = ctx.createRadialGradient(size * 0.35, size * 0.32, size * 0.04, size * 0.5, size * 0.5, size * 0.68);
    grad.addColorStop(0,    '#ffffff');
    grad.addColorStop(0.45, '#c9c9c9');
    grad.addColorStop(0.8,  '#6a6a6a');
    grad.addColorStop(1,    '#2a2a2a');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, size, size);
    var tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.needsUpdate = true;
    return tex;
  }

  return {
    list: list,
    isKnown: isKnown,
    applyToScene: applyToScene,
    builtMaterials: builtMaterials,
    buildMatcapTexture: buildMatcapTexture
  };

})();

if (typeof module !== 'undefined' && module.exports) { module.exports = KanvazModel3DModes; }
