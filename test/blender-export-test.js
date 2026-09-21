#!/usr/bin/env node
/* blender-export-test.js — the .blend -> GLB export script.

   Part 1 (always): the script text is well-formed and only passes options
   that are checked against Blender's own property list.
   Part 2 (only when a real Blender is installed; skipped on CI): builds a
   .blend with a visible mesh, a hidden mesh, a second scene and an
   alpha-blended material, converts it with the SAME arguments main.js uses
   (spawn with an argument array), and reads the GLB back. */

var assert = require('assert');
var fs = require('fs');
var os = require('os');
var path = require('path');
var cp = require('child_process');
var be = require('../src/blender-export');
var bd = require('../src/blender-detect');

function run() {
  var s = be.buildExportScript();
  assert(/^import bpy, sys/.test(s), 'starts with the import line');
  assert(s.indexOf("'use_visible': True") !== -1 && s.indexOf("'use_active_scene': True") !== -1, 'hidden objects and other scenes are excluded');
  assert(s.indexOf('if k in known') !== -1, 'each option is checked against the operator before use');
  assert(s.indexOf('WEBP') === -1, 'default run keeps the exporter\'s own texture format');
  assert(be.buildExportScript({ smallTextures: true }).indexOf("'export_image_format': 'WEBP'") !== -1, 'retry mode switches textures to WebP');
  assert(s.indexOf('"') === -1, 'no double quotes, so it survives Windows argument quoting');
  console.log('  ✓ script text: hidden objects and extra scenes excluded, options checked, retry mode present');

  var exe = bd.findBlenderExecutable(null);
  if (!exe) { console.log('  (real-Blender part skipped — no Blender found)'); return; }

  var dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kz-blend-'));
  var blend = path.join(dir, 't.blend');
  var glb = path.join(dir, 't.glb');
  var maker = [
    'import bpy, sys',
    'bpy.ops.wm.read_factory_settings(use_empty=True)',
    'def mat(name, alpha):',
    '    m = bpy.data.materials.new(name); m.use_nodes = True',
    '    m.node_tree.nodes["Principled BSDF"].inputs["Alpha"].default_value = alpha',
    '    try: m.surface_render_method = "BLENDED"',
    '    except Exception: pass',
    '    try: m.blend_method = "BLEND"',
    '    except Exception: pass',
    '    return m',
    'bpy.ops.mesh.primitive_cube_add(location=(0,0,0)); a = bpy.context.active_object; a.name = "ShownCube"',
    'a.data.materials.append(mat("glass", 0.4))',
    'bpy.ops.mesh.primitive_cube_add(location=(3,0,0)); h = bpy.context.active_object; h.name = "HiddenCube"',
    'h.hide_viewport = True; h.hide_render = True',
    's2 = bpy.data.scenes.new("Other")',
    'o = bpy.data.objects.new("OtherSceneObj", bpy.data.meshes.new("om")); s2.collection.objects.link(o)',
    'bpy.ops.wm.save_as_mainfile(filepath=sys.argv[-1])'
  ].join('\n');
  var mk = cp.spawnSync(exe, ['--background', '--factory-startup', '--python-expr', maker, '--', blend], { encoding: 'utf8', timeout: 120000 });
  assert(fs.existsSync(blend), 'test .blend was created: ' + (mk.stderr || '').slice(-300));

  var args = ['--background', '--disable-autoexec', '--factory-startup', blend, '--python-exit-code', '1', '--python-expr', be.buildExportScript(), '--', glb];
  var r = cp.spawnSync(exe, args, { encoding: 'utf8', timeout: 180000, windowsHide: true });
  assert.strictEqual(r.status, 0, 'Blender exited 0: ' + (r.stderr || '').slice(-300));
  var b = fs.readFileSync(glb);
  var j = JSON.parse(b.slice(20, 20 + b.readUInt32LE(12)).toString());
  var names = (j.nodes || []).map(function(n) { return n.name; });
  assert(names.indexOf('ShownCube') !== -1, 'the visible object is exported');
  assert.strictEqual(names.indexOf('HiddenCube'), -1, 'the hidden object is NOT exported');
  assert.strictEqual(names.indexOf('OtherSceneObj'), -1, 'objects from another scene are NOT exported');
  var g = (j.materials || []).filter(function(m) { return m.name === 'glass'; })[0];
  assert(g, 'the material is exported');
  assert.strictEqual(g.alphaMode, 'BLEND', 'alpha blending survives the export');
  assert(Math.abs(g.pbrMetallicRoughness.baseColorFactor[3] - 0.4) < 0.01, 'the 0.4 opacity survives the export');
  console.log('  ✓ real Blender: hidden object and other scenes left out, alpha blend + opacity kept');

  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { /* temp dir, best effort */ }
}

try { run(); console.log('ALL BLENDER EXPORT TESTS PASSED'); }
catch (e) { console.log('BLENDER EXPORT TEST FAILED'); console.log(e && e.stack || e); process.exit(1); }
