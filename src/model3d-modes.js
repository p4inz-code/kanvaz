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

  /* Bookkeeping lives in module-private WeakSet/WeakMaps, NOT in node.userData:
     GLTFLoader copies a file's node "extras" into userData, so a hostile glTF
     could otherwise set "kanvazModeHelper" (making real meshes get deleted) or
     "kanvazOrigMaterial" (making a mesh render with junk). */
  var HELPERS = new WeakSet();
  var ORIG = new WeakMap();        /* mesh -> its material(s) as the file made them */
  var BUILT = new WeakMap();       /* mesh -> { modeKey: replacement material(s) } */
  var SHARED_BY_SRC = {};          /* modeKey -> WeakMap(source material -> replacement) */
  function isHelper(n) { return HELPERS.has(n); }

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

  /* Shows a texture's raw channel as grey, the way an image editor would:
     colour-space conversion and tone mapping are dropped from the shader, so
     the value on screen is the value in the file. channel is 'r', 'g' or 'b'
     of the mixed diffuseColor the standard shader builds from colour x map. */
  function rawChannelView(mat, channel, cacheKey) {
    mat.onBeforeCompile = function(shader) {
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <opaque_fragment>', 'gl_FragColor = vec4( vec3( diffuseColor.' + channel + ' ), 1.0 );')
        .replace('#include <tonemapping_fragment>', '')
        .replace('#include <colorspace_fragment>', '');
    };
    mat.customProgramCacheKey = function() { return cacheKey; };
    return mat;
  }

  /* A flat scalar (roughness / metalness factor) as an exact grey. */
  function scalarColor(THREE, v) {
    var c = new THREE.Color();
    c.setRGB(v, v, v, THREE.LinearSRGBColorSpace);
    return c;
  }

  var MODES = [
    { key: 'normal', label: 'Shaded', group: 'Shading', title: 'Shaded: the model as the file describes it', build: null },

    /* Neutral untextured surface with soft studio lighting: judge form and
       silhouette without colour or texture getting in the way. Normal maps are
       kept because they are part of the sculpted detail. */
    { key: 'clay', label: 'Clay', group: 'Shading', title: 'Clay: neutral grey material, lit, keeps normal-map detail',
      build: function(THREE, m) {
        var mat = new THREE.MeshStandardMaterial({ color: 0xb9b9c6, roughness: 0.82, metalness: 0, normalMap: m.normalMap || null });
        if (m.normalScale && mat.normalScale) mat.normalScale.copy(m.normalScale);
        mat.side = m.side;
        return mat;
      } },

    { key: 'normals', label: 'Normals', group: 'Surface', title: 'Normals: surface direction as colour (view space, like the normal matcap in Blender)',
      build: function(THREE, m) {
        var mat = new THREE.MeshNormalMaterial({
          normalMap: m.normalMap || null,
          bumpMap: m.bumpMap || null
        });
        if (m.normalScale && mat.normalScale) mat.normalScale.copy(m.normalScale);
        return copySurface(mat, m);
      } },

    { key: 'matcap', label: 'Matcap', group: 'Shading', title: 'Matcap: studio shading that keeps colour and transparency',
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

    { key: 'wireframe', label: 'Wireframe', group: 'Topology', title: 'Wireframe: clean mesh edges, no colour or texture', hideBackLines: true,
      /* Pure structure. It ignores the material's colour, texture and
         transparency on purpose: the first version was a lit clone (lines came
         out white or black by lighting), the second kept the material colour
         (tinted, and a textured model drew a noisy texture in the lines). What
         reads best on the dark board is one neutral light line colour, opaque,
         both sides drawn so the far edges show through. */
      build: function(THREE, m) {
        return new THREE.MeshBasicMaterial({
          color: 0xdcdcec,
          wireframe: true,
          side: THREE.DoubleSide,
          transparent: false,
          opacity: 1
        });
      } },

    /* Topology check on the real surface: the file's own materials stay, with
       the mesh edges drawn over them (light, semi-transparent, pulled toward
       the camera so they do not z-fight). The view a modeler keeps on. */
    { key: 'shadedwire', label: 'Wire on Shaded', group: 'Topology', overlayWire: true, title: 'Wire on Shaded: the model with its mesh edges over it',
      build: null },

    /* The normal map itself, raw, as an image editor shows it. Flat blue means
       "no normal map on this material". A green that looks inverted (flipped Y
       between OpenGL and DirectX) is the classic thing this is for. */
    { key: 'normalmap', label: 'Normal Map', group: 'Surface', title: 'Normal Map: the tangent-space normal texture as stored',
      needs: 'normalMap',
      build: function(THREE, m) {
        var mat = new THREE.MeshBasicMaterial({ color: 0xffffff, map: m.normalMap || null });
        mat.side = m.side;
        var flat = !m.normalMap;
        mat.onBeforeCompile = function(shader) {
          shader.fragmentShader = shader.fragmentShader
            .replace('#include <opaque_fragment>', flat ? 'gl_FragColor = vec4( 0.5, 0.5, 1.0, 1.0 );' : 'gl_FragColor = vec4( diffuseColor.rgb, 1.0 );')
            .replace('#include <tonemapping_fragment>', '')
            .replace('#include <colorspace_fragment>', '');
        };
        mat.customProgramCacheKey = function() { return flat ? 'kanvaz-nmap-flat' : 'kanvaz-nmap'; };
        return mat;
      } },

    /* UV layout check: a coloured, lettered checker. Squares that stretch into
       rectangles or shear are stretched UVs; squares of different sizes on
       different parts mean uneven texel density. */
    { key: 'uv', label: 'UV Grid', group: 'Texture', title: 'UV Grid: checker pattern to spot stretched UVs and uneven texel density',
      needs: 'uv',
      build: function(THREE, m, ctx) {
        var mat = new THREE.MeshBasicMaterial({ map: ctx.checkerTex || null, color: 0xffffff });
        mat.side = m.side;
        return mat;
      } },

    /* Texture channels, raw. Roughness is the green channel of a glTF
       metallic-roughness texture, metalness the blue, occlusion the red of the
       AO texture; each is multiplied by the material's own factor, as the
       renderer does. With no texture the factor shows as one flat grey. */
    { key: 'roughness', label: 'Roughness', group: 'Texture', title: 'Roughness: white = rough, black = glossy',
      build: function(THREE, m) {
        var mat = new THREE.MeshBasicMaterial({ map: m.roughnessMap || null, color: scalarColor(THREE, m.roughness === undefined ? 1 : m.roughness) });
        mat.side = m.side;
        return rawChannelView(mat, 'g', 'kanvaz-rough');
      } },
    { key: 'metalness', label: 'Metalness', group: 'Texture', title: 'Metalness: white = metal, black = non-metal',
      build: function(THREE, m) {
        var mat = new THREE.MeshBasicMaterial({ map: m.metalnessMap || null, color: scalarColor(THREE, m.metalness === undefined ? 0 : m.metalness) });
        mat.side = m.side;
        return rawChannelView(mat, 'b', 'kanvaz-metal');
      } },
    { key: 'ao', label: 'Occlusion', group: 'Texture', title: 'Ambient occlusion: the baked AO texture (white = open, black = occluded)',
      needs: 'aoMap',
      build: function(THREE, m) {
        var mat = new THREE.MeshBasicMaterial({ map: m.aoMap || null, color: 0xffffff });
        mat.side = m.side;
        return rawChannelView(mat, 'r', 'kanvaz-ao');
      } },

    /* Base colour with no lighting at all: what the artist painted. */
    { key: 'albedo', label: 'Albedo', group: 'Texture', title: 'Albedo: base colour and texture, unlit',
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
    { key: 'alpha', label: 'Alpha', group: 'Texture', title: 'Alpha: opacity as black (clear) to white (solid)',
      build: function(THREE, m) {
        /* A glTF OPAQUE material ignores its texture's alpha when rendered (the
           renderer forces 1.0), so show it solid here too instead of black holes. */
        var solid = !m.transparent && !(m.alphaTest > 0);
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
            .replace('#include <opaque_fragment>', solid ? 'gl_FragColor = vec4( 1.0, 1.0, 1.0, 1.0 );' : 'gl_FragColor = vec4( vec3( diffuseColor.a ), 1.0 );')
            .replace('#include <tonemapping_fragment>', '')
            .replace('#include <colorspace_fragment>', '');
        };
        /* Without this key the renderer would reuse one compiled program
           for this and a plain Albedo material. */
        mat.customProgramCacheKey = function() { return solid ? 'kanvaz-alpha-view-solid' : 'kanvaz-alpha-view'; };
        return mat;
      } }
  ];

  /* Hidden-line removal for wireframe. A dense mesh (a subdivided head, a
     sphere) drew the far side's lines through the near side, which piled up
     into a solid white blob. Each mesh gets an invisible child that writes
     depth only (pushed slightly back with polygon offset, so the lines on the
     surface still pass the depth test); the far lines then fail the test and
     disappear, exactly like a wireframe view in a 3D package.
     Skipped for skinned, instanced and morphing meshes: a child sharing only
     the geometry would not follow their deformation and would hide the wrong
     lines. Those keep the plain see-through wire. */
  var occluderCache = null;
  function occluderFor(THREE) {
    if (!occluderCache || occluderCache.THREE !== THREE) {
      occluderCache = {
        THREE: THREE,
        material: new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: true, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1, side: THREE.DoubleSide })
      };
    }
    return occluderCache.material;
  }
  function canOcclude(node) {
    return !node.isSkinnedMesh && !node.isInstancedMesh && !(node.morphTargetInfluences && node.morphTargetInfluences.length);
  }
  /* Wire drawn over the model's own surface (Wire on Shaded). */
  var overlayCache = null;
  function overlayMaterial(THREE) {
    if (!overlayCache || overlayCache.THREE !== THREE) {
      overlayCache = {
        THREE: THREE,
        material: new THREE.MeshBasicMaterial({ color: 0xf2f2ff, wireframe: true, transparent: true, opacity: 0.55, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 })
      };
    }
    return overlayCache.material;
  }
  function addOverlays(THREE, root) {
    var targets = [];
    root.traverse(function(n) { if (n.isMesh && !HELPERS.has(n) && canOcclude(n)) targets.push(n); });
    for (var i = 0; i < targets.length; i++) {
      var h = new THREE.Mesh(targets[i].geometry, overlayMaterial(THREE));
      HELPERS.add(h);
      h.renderOrder = 1;
      h.matrixAutoUpdate = false;
      h.raycast = function() {};
      targets[i].add(h);
    }
  }

  /* Which modes have something to show for this model, so the UI can grey out
     the rest with a reason instead of offering a mode that draws nothing.
     Reads the original materials. */
  function availability(root) {
    var has = { normalMap: false, aoMap: false, uv: false };
    root.traverse(function(n) {
      if (!n.isMesh || HELPERS.has(n)) return;
      if (n.geometry && n.geometry.attributes && n.geometry.attributes.uv) has.uv = true;
      var mats = asArray(ORIG.get(n) || n.material);
      for (var i = 0; i < mats.length; i++) {
        if (mats[i] && mats[i].normalMap) has.normalMap = true;
        if (mats[i] && mats[i].aoMap) has.aoMap = true;
      }
    });
    var reasons = { normalMap: 'This model has no normal map.', aoMap: 'This model has no ambient-occlusion texture.', uv: 'This model has no UV coordinates.' };
    var out = {};
    for (var m = 0; m < MODES.length; m++) {
      var need = MODES[m].needs;
      out[MODES[m].key] = (!need || has[need]) ? { ok: true } : { ok: false, reason: reasons[need] };
    }
    return out;
  }

  /* Coloured, lettered checker for UV Grid. */
  function buildCheckerTexture(THREE, doc) {
    var size = 1024, cells = 16, cs = size / cells;
    var canvas = (doc || document).createElement('canvas');
    canvas.width = size; canvas.height = size;
    var c = canvas.getContext('2d');
    for (var y = 0; y < cells; y++) {
      for (var x = 0; x < cells; x++) {
        var hue = (x / cells) * 300;
        var light = ((x + y) % 2) ? 62 : 38;
        c.fillStyle = 'hsl(' + Math.round(hue) + ',55%,' + light + '%)';
        c.fillRect(x * cs, y * cs, cs, cs);
      }
    }
    c.fillStyle = 'rgba(255,255,255,0.9)';
    c.font = 'bold ' + Math.round(cs * 0.34) + 'px sans-serif';
    c.textAlign = 'center'; c.textBaseline = 'middle';
    for (var yy = 0; yy < cells; yy += 2) {
      for (var xx = 0; xx < cells; xx += 2) c.fillText(String.fromCharCode(65 + xx / 2) + (yy / 2 + 1), xx * cs + cs, yy * cs + cs);
    }
    var tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.userData = { kanvazShared: true };   /* one texture for every card: never disposed by a single card's teardown */
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.anisotropy = 8;
    tex.needsUpdate = true;
    return tex;
  }

  function removeHelpers(root) {
    var found = [];
    root.traverse(function(n) { if (HELPERS.has(n)) found.push(n); });
    for (var i = 0; i < found.length; i++) if (found[i].parent) found[i].parent.remove(found[i]);
  }
  function addHelpers(THREE, root) {
    var targets = [];
    root.traverse(function(n) { if (n.isMesh && !HELPERS.has(n) && canOcclude(n)) targets.push(n); });
    for (var i = 0; i < targets.length; i++) {
      var h = new THREE.Mesh(targets[i].geometry, occluderFor(THREE));
      HELPERS.add(h);
      h.renderOrder = -1;
      h.matrixAutoUpdate = false;   /* identity: it sits exactly on its parent */
      h.raycast = function() {};    /* never pickable */
      targets[i].add(h);
    }
  }

  function find(key) {
    for (var i = 0; i < MODES.length; i++) if (MODES[i].key === key) return MODES[i];
    return null;
  }

  /* [[key, label, title, group], ...] in display order. */
  function list() {
    var out = [];
    /* The picker's order, grouped by what a modeler reaches for. */
    var order = ['normal', 'clay', 'matcap', 'wireframe', 'shadedwire', 'normals', 'normalmap', 'albedo', 'uv', 'roughness', 'metalness', 'ao', 'alpha'];
    for (var i = 0; i < order.length; i++) {
      var m = find(order[i]);
      if (m) out.push([m.key, m.label, m.title, m.group || 'Other']);
    }
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
    removeHelpers(root);
    if (mode.hideBackLines) addHelpers(THREE, root);
    if (mode.overlayWire) addOverlays(THREE, root);
    root.traverse(function(node) {
      if (!node.isMesh || HELPERS.has(node)) return;
      if (!ORIG.has(node)) ORIG.set(node, node.material);
      var orig = ORIG.get(node);
      if (!mode.build) { node.material = orig; return; }
      var cache = BUILT.get(node);
      if (!cache) { cache = {}; BUILT.set(node, cache); }
      if (!cache[mode.key]) {
        /* Meshes that share one source material share one replacement too
           (a model with hundreds of instances of the same material used to get
           hundreds of copies). */
        var perSrc = SHARED_BY_SRC[mode.key] || (SHARED_BY_SRC[mode.key] = new WeakMap());
        var built = asArray(orig).map(function(m) {
          var b = perSrc.get(m);
          if (!b) { b = mode.build(THREE, m, ctx || {}); perSrc.set(m, b); }
          return b;
        });
        cache[mode.key] = Array.isArray(orig) ? built : built[0];
      }
      node.material = cache[mode.key];
    });
  }

  /* Every material this module built for a mesh, flattened, so the owner
     can dispose them when the card is deleted. */
  function builtMaterials(node) {
    var out = [];
    var cache = BUILT.get(node);
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
    isHelper: isHelper,
    originalMaterial: function(node) { return ORIG.get(node) || null; },
    availability: availability,
    buildCheckerTexture: buildCheckerTexture,
    applyToScene: applyToScene,
    builtMaterials: builtMaterials,
    buildMatcapTexture: buildMatcapTexture
  };

})();

if (typeof module !== 'undefined' && module.exports) { module.exports = KanvazModel3DModes; }
