#!/usr/bin/env node
/* model3d-modes-test.js — render modes for 3D cards, against the REAL
   vendored Three.js (not a mock).

   The bug this guards: Matcap used to build MeshMatcapMaterial({matcap, map})
   and nothing else, so a coloured or see-through model lost its colour,
   opacity, alpha map and sidedness the moment Matcap was selected. */

var assert = require('assert');
var path = require('path');
var url = require('url');
var Modes = require('../src/model3d-modes');

var THREE_URL = url.pathToFileURL(path.join(__dirname, '..', 'src', 'vendor', 'three', 'three.module.js')).href;

function sceneWith(THREE, materials) {
  var root = new THREE.Group();
  materials.forEach(function(m) {
    var mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), m);
    root.add(mesh);
  });
  return root;
}

async function run() {
  var THREE = await import(THREE_URL);
  var matcapTex = new THREE.Texture();
  var ctx = { matcapTex: matcapTex };

  var keys = Modes.list().map(function(x) { return x[0]; });
  assert.deepStrictEqual(keys, ['normal', 'clay', 'matcap', 'wireframe', 'shadedwire', 'normals', 'normalmap', 'albedo', 'uv', 'roughness', 'metalness', 'ao', 'alpha'], 'modes are grouped: Shading, Topology, Surface, Texture');
  assert.strictEqual(Modes.list()[0][1], 'Shaded', 'the lit view is labelled Shaded');
  assert(Modes.isKnown('normal') && !Modes.isKnown('bogus'), 'isKnown');
  console.log('  ✓ registry: 13 modes in 4 groups (persisted key for the lit view stays "normal")');

  var tex = new THREE.Texture();
  var aMap = new THREE.Texture();
  var glass = new THREE.MeshStandardMaterial({ color: 0xff8800, transparent: true, opacity: 0.35, side: THREE.DoubleSide, map: tex, alphaMap: aMap, depthWrite: false });
  var solid = new THREE.MeshStandardMaterial({ color: 0x3366cc });
  var root = sceneWith(THREE, [glass, [glass, solid]]);
  var single = root.children[0], multi = root.children[1];

  Modes.applyToScene(THREE, root, 'matcap', ctx);
  var mc = single.material;
  assert(mc.isMeshMatcapMaterial, 'matcap builds a matcap material');
  assert.strictEqual(mc.color.getHex(), 0xff8800, 'matcap keeps the base colour');
  assert.strictEqual(mc.opacity, 0.35, 'matcap keeps the opacity');
  assert.strictEqual(mc.transparent, true, 'matcap keeps transparency');
  assert.strictEqual(mc.side, THREE.DoubleSide, 'matcap keeps double-sidedness');
  assert.strictEqual(mc.map, tex, 'matcap keeps the colour texture');
  assert.strictEqual(mc.alphaMap, aMap, 'matcap keeps the alpha map');
  assert.strictEqual(mc.depthWrite, false, 'matcap keeps depthWrite (no sorting artefacts)');
  assert.strictEqual(mc.matcap, matcapTex, 'matcap uses the shared matcap texture');
  assert.notStrictEqual(mc.color, glass.color, 'colour is a copy, not the original object');
  assert(Array.isArray(multi.material) && multi.material.length === 2, 'multi-material mesh stays an array');
  assert.strictEqual(multi.material[1].color.getHex(), 0x3366cc, 'each slot keeps its own colour');
  console.log('  ✓ matcap keeps colour, opacity, transparency, sidedness, textures; multi-material stays an array');

  Modes.applyToScene(THREE, root, 'wireframe', ctx);
  var wf = single.material;
  assert.strictEqual(wf.wireframe, true, 'wireframe is on');
  assert(wf.isMeshBasicMaterial, 'wireframe is unlit');
  assert.strictEqual(wf.color.getHex(), 0xdcdcec, 'lines are one neutral colour, not the material colour');
  assert.strictEqual(wf.map, null, 'no texture in the lines');
  assert.strictEqual(wf.alphaMap, null, 'no alpha map');
  assert(wf.vertexColors === false, 'no vertex colours');
  assert(wf.transparent === false && wf.opacity === 1, 'lines are opaque even for a see-through material');
  assert.strictEqual(wf.side, THREE.DoubleSide, 'far edges show through');
  assert.strictEqual(multi.material[1].color.getHex(), 0xdcdcec, 'every slot of a multi-material mesh gets the same neutral line');
  assert.strictEqual(glass.wireframe, false, 'the ORIGINAL material is never mutated');
  console.log('  ✓ wireframe is neutral, opaque lines: no colour, texture or transparency; original material untouched');

  Modes.applyToScene(THREE, root, 'normals', ctx);
  assert(single.material.isMeshNormalMaterial, 'normals builds a normal material');
  assert.strictEqual(single.material.opacity, 0.35, 'normals keeps opacity');
  assert.strictEqual(single.material.side, THREE.DoubleSide, 'normals keeps sidedness');

  Modes.applyToScene(THREE, root, 'albedo', ctx);
  assert(single.material.isMeshBasicMaterial, 'albedo is unlit');
  assert.strictEqual(single.material.color.getHex(), 0xff8800, 'albedo shows the base colour');
  assert.strictEqual(single.material.map, tex, 'albedo shows the texture');
  assert.strictEqual(single.material.transparent, true, 'albedo keeps transparency');

  Modes.applyToScene(THREE, root, 'alpha', ctx);
  var am = single.material;
  assert(am.isMeshBasicMaterial && am.transparent === false, 'alpha view is opaque so the ramp itself is visible');
  assert.strictEqual(am.opacity, 0.35, 'alpha view reads the material opacity');
  assert.strictEqual(am.alphaMap, aMap, 'alpha view reads the alpha map');
  assert.strictEqual(am.map, tex, 'alpha view reads the texture alpha channel');
  var shader = { fragmentShader: 'a\n#include <opaque_fragment>\n#include <tonemapping_fragment>\n#include <colorspace_fragment>\nb' };
  am.onBeforeCompile(shader);
  assert(shader.fragmentShader.indexOf('vec3( diffuseColor.a )') !== -1, 'the shader writes the alpha as grey');
  assert(shader.fragmentShader.indexOf('#include <colorspace_fragment>') === -1 && shader.fragmentShader.indexOf('#include <tonemapping_fragment>') === -1, 'tone mapping and colour-space steps are dropped so the ramp is raw');
  assert.strictEqual(am.customProgramCacheKey(), 'kanvaz-alpha-view', 'has its own program cache key (not shared with Albedo)');
  console.log('  ✓ normals, albedo and alpha views carry opacity/sidedness/textures across');

  Modes.applyToScene(THREE, root, 'matcap', ctx);
  var first = single.material;
  Modes.applyToScene(THREE, root, 'wireframe', ctx);
  Modes.applyToScene(THREE, root, 'matcap', ctx);
  assert.strictEqual(single.material, first, 'toggling back reuses the cached material');
  var built = Modes.builtMaterials(single);
  assert(built.length >= 5 && built.indexOf(glass) === -1, 'builtMaterials lists what this module made (for disposal) and never the original');

  Modes.applyToScene(THREE, root, 'normal', ctx);
  assert.strictEqual(single.material, glass, 'Shaded restores the original material object');
  assert.strictEqual(multi.material[0], glass, 'and restores each slot of a multi-material mesh');
  Modes.applyToScene(THREE, root, 'not-a-mode', ctx);
  assert.strictEqual(single.material, glass, 'an unknown mode falls back to the original instead of a blank model');
  /* hidden-line removal helpers for wireframe */
  var hroot = sceneWith(THREE, [new THREE.MeshStandardMaterial({ color: 0x336699 })]);
  var skinned = new THREE.SkinnedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial());
  hroot.add(skinned);
  var morph = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial());
  morph.morphTargetInfluences = [0];
  hroot.add(morph);
  var plain = hroot.children[0];
  var count = function(m) { return m.children.filter(function(c) { return Modes.isHelper(c); }).length; };
  Modes.applyToScene(THREE, hroot, 'wireframe', ctx);
  assert.strictEqual(count(plain), 1, 'a plain mesh gets one depth-only helper in wireframe');
  var helper = plain.children.filter(function(c) { return Modes.isHelper(c); })[0];
  assert(helper.material.colorWrite === false && helper.material.depthWrite === true && helper.material.polygonOffset === true, 'the helper draws no colour, only depth, pushed back');
  assert.strictEqual(helper.geometry, plain.geometry, 'it shares the geometry (no copy)');
  assert.strictEqual(count(skinned), 0, 'a skinned mesh gets no helper (it would not follow the skeleton)');
  assert.strictEqual(count(morph), 0, 'a morphing mesh gets no helper');
  Modes.applyToScene(THREE, hroot, 'wireframe', ctx);
  assert.strictEqual(count(plain), 1, 'applying wireframe twice does not stack helpers');
  assert.strictEqual(helper.material, plain.material === helper.material ? null : helper.material, 'helper material is separate from the wire material');
  Modes.applyToScene(THREE, hroot, 'matcap', ctx);
  assert.strictEqual(count(plain), 0, 'leaving wireframe removes the helper');
  assert.strictEqual(plain.material.isMeshMatcapMaterial, true, 'and the helper never gets its material swapped');
  Modes.applyToScene(THREE, hroot, 'wireframe', ctx);
  Modes.applyToScene(THREE, hroot, 'normal', ctx);
  assert.strictEqual(count(plain), 0, 'Shaded has no helpers either');
  console.log('  ✓ wireframe hides back lines with a depth-only helper (skipped for skinned/morph meshes), removed again on leaving');
  /* the modeler's modes */
  var nm = new THREE.Texture(), rmap = new THREE.Texture(), amap = new THREE.Texture();
  var pbr = new THREE.MeshStandardMaterial({ color: 0xff0000, roughness: 0.3, metalness: 0.9, normalMap: nm, roughnessMap: rmap, metalnessMap: rmap, aoMap: amap });
  var proot = sceneWith(THREE, [pbr]);
  var pm = proot.children[0];
  Modes.applyToScene(THREE, proot, 'clay', ctx);
  assert(pm.material.isMeshStandardMaterial && pm.material.color.getHex() === 0xb9b9c6 && pm.material.map === null, 'clay is neutral grey with no colour or texture');
  assert.strictEqual(pm.material.normalMap, nm, 'clay keeps the normal map (sculpted detail)');
  Modes.applyToScene(THREE, proot, 'shadedwire', ctx);
  assert.strictEqual(pm.material, pbr, 'wire on shaded keeps the model\'s own material');
  var ov = pm.children.filter(function(c) { return Modes.isHelper(c); });
  assert(ov.length === 1 && ov[0].material.wireframe === true && ov[0].material.transparent === true && ov[0].material.depthWrite === false && ov[0].material.polygonOffsetFactor < 0, 'a translucent wire overlay pulled toward the camera, not writing depth');
  Modes.applyToScene(THREE, proot, 'normal', ctx);
  assert.strictEqual(pm.children.filter(function(c) { return Modes.isHelper(c); }).length, 0, 'the overlay is removed again');
  Modes.applyToScene(THREE, proot, 'normalmap', ctx);
  assert(pm.material.map === nm && pm.material.isMeshBasicMaterial, 'normal map view shows the normal texture unlit');
  var fake = { fragmentShader: '#include <opaque_fragment>\n#include <tonemapping_fragment>\n#include <colorspace_fragment>' };
  pm.material.onBeforeCompile(fake);
  assert(fake.fragmentShader.indexOf('diffuseColor.rgb') !== -1 && fake.fragmentShader.indexOf('colorspace') === -1, 'raw texture values, no colour-space step');
  var plainRoot = sceneWith(THREE, [new THREE.MeshStandardMaterial()]);
  Modes.applyToScene(THREE, plainRoot, 'normalmap', ctx);
  var f2 = { fragmentShader: '#include <opaque_fragment>' };
  plainRoot.children[0].material.onBeforeCompile(f2);
  assert(f2.fragmentShader.indexOf('0.5, 0.5, 1.0') !== -1, 'no normal map: flat "up" blue');
  Modes.applyToScene(THREE, proot, 'roughness', ctx);
  assert(pm.material.map === rmap && Math.abs(pm.material.color.r - 0.3) < 1e-6, 'roughness view: green channel of the map x the roughness factor');
  var f3 = { fragmentShader: '#include <opaque_fragment>' }; pm.material.onBeforeCompile(f3);
  assert(f3.fragmentShader.indexOf('diffuseColor.g') !== -1, 'roughness reads green');
  Modes.applyToScene(THREE, proot, 'metalness', ctx);
  var f4 = { fragmentShader: '#include <opaque_fragment>' }; pm.material.onBeforeCompile(f4);
  assert(f4.fragmentShader.indexOf('diffuseColor.b') !== -1 && Math.abs(pm.material.color.r - 0.9) < 1e-6, 'metalness reads blue x the metalness factor');
  Modes.applyToScene(THREE, proot, 'ao', ctx);
  var f5 = { fragmentShader: '#include <opaque_fragment>' }; pm.material.onBeforeCompile(f5);
  assert(pm.material.map === amap && f5.fragmentShader.indexOf('diffuseColor.r') !== -1, 'occlusion reads red of the AO map');
  var keysUsed = ['rough', 'metal', 'ao'].map(function() { return 1; });
  Modes.applyToScene(THREE, proot, 'uv', { matcapTex: matcapTex, checkerTex: rmap });
  assert.strictEqual(pm.material.map, rmap, 'UV grid uses the checker texture');
  console.log('  ✓ Clay, Wire on Shaded, Normal Map, UV Grid, Roughness, Metalness, Occlusion build the right materials');

  /* availability: modes with nothing to show are greyed with a reason */
  var av = Modes.availability(proot);
  assert(av.normalmap.ok && av.ao.ok && av.uv.ok && av.clay.ok, 'a fully textured model offers everything');
  var bare = sceneWith(THREE, [new THREE.MeshStandardMaterial({ color: 0x888888 })]);
  var ab = Modes.availability(bare);
  assert(ab.normalmap.ok === false && /normal map/i.test(ab.normalmap.reason), 'no normal map: Normal Map is unavailable and says why');
  assert(ab.ao.ok === false && /occlusion/i.test(ab.ao.reason), 'no AO texture: Occlusion is unavailable and says why');
  assert(ab.uv.ok === true, 'a BoxGeometry has UVs');
  bare.children[0].geometry.deleteAttribute('uv');
  assert(Modes.availability(bare).uv.ok === false, 'no UVs: UV Grid is unavailable');
  assert(ab.roughness.ok && ab.metalness.ok && ab.wireframe.ok && ab.shadedwire.ok, 'factor views and wire modes are always available');
  console.log('  ✓ availability: unusable modes are reported with a plain reason');
  console.log('  ✓ cache reuse, disposal list, restore to Shaded, unknown mode falls back');
}

run().then(function() { console.log('ALL MODEL3D MODES TESTS PASSED'); })
  .catch(function(e) { console.log('MODEL3D MODES TEST FAILED'); console.log(e && e.stack || e); process.exit(1); });
