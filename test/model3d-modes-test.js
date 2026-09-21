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
  assert.deepStrictEqual(keys, ['normal', 'normals', 'matcap', 'wireframe', 'albedo', 'alpha'], 'mode order');
  assert.strictEqual(Modes.list()[0][1], 'Shaded', 'the lit view is labelled Shaded');
  assert(Modes.isKnown('normal') && !Modes.isKnown('bogus'), 'isKnown');
  console.log('  ✓ registry: Shaded, Normals, Matcap, Wireframe, Albedo, Alpha (persisted key for the lit view stays "normal")');

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
  assert.strictEqual(single.material.wireframe, true, 'wireframe is on');
  assert(single.material.isMeshBasicMaterial, 'wireframe is unlit, so lighting cannot turn lines white or black');
  assert.strictEqual(single.material.color.getHex(), 0xff8800, 'wireframe keeps the colour');
  assert.strictEqual(single.material.map, tex, 'wireframe keeps the texture');
  assert.strictEqual(single.material.opacity, 0.35, 'wireframe keeps the opacity');
  assert.strictEqual(glass.wireframe, false, 'the ORIGINAL material is never mutated');
  var darkMat = new THREE.MeshStandardMaterial({ color: 0x101010 });
  var droot = sceneWith(THREE, [darkMat]);
  Modes.applyToScene(THREE, droot, 'wireframe', ctx);
  var dh = { h: 0, s: 0, l: 0 };
  droot.children[0].material.color.getHSL(dh);
  assert(dh.l >= 0.49, 'a near-black colour is lifted so its lines are visible on the dark board');
  assert.strictEqual(darkMat.color.getHex(), 0x101010, 'and the original stays as it was');
  console.log('  ✓ wireframe keeps colour/opacity and leaves the original material alone');

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
  console.log('  ✓ cache reuse, disposal list, restore to Shaded, unknown mode falls back');
}

run().then(function() { console.log('ALL MODEL3D MODES TESTS PASSED'); })
  .catch(function(e) { console.log('MODEL3D MODES TEST FAILED'); console.log(e && e.stack || e); process.exit(1); });
