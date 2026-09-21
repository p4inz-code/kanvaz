/* blender-export.js — the Python that Blender runs to turn a dropped .blend
   into a GLB for the 3D card (see main.js convertBlendToGlb).

   It is passed to Blender with --python-expr (a packaged app's files live
   inside app.asar, which Blender cannot read, so a .py file on disk is not
   an option) and is built here so it can be tested against a real Blender.

   What the defaults got wrong, found by exporting a test file with the old
   one-line script:
     - hidden objects (eye or monitor icon off) were exported, so the card
       showed things the artist had hidden;
     - use_active_scene is off by default, so a file with more than one
       scene exported all of them stacked on top of each other.
   Both are switched on here. Everything else stays at the exporter's own
   defaults on purpose (no Draco, cameras/lights off, embedded textures),
   because those are what the Three.js loader in the card can read.

   Every option is checked against the operator's own property list before
   it is passed, so an option a future Blender renames or drops is skipped
   instead of crashing the whole conversion. */

'use strict';

/* opts.smallTextures: re-export with WebP textures at reduced quality.
   Used only as a retry when the first GLB was over the size limit (large
   PNG textures are the usual cause). WebP keeps alpha, unlike JPEG. */
function buildExportScript(opts) {
  opts = opts || {};
  var extra = [
    "'use_visible': True",
    "'use_active_scene': True"
  ];
  if (opts.smallTextures) {
    extra.push("'export_image_format': 'WEBP'");
    extra.push("'export_image_quality': 70");
  }
  return [
    'import bpy, sys',
    'op = bpy.ops.export_scene.gltf',
    'known = set(op.get_rna_type().properties.keys())',
    "kw = {'filepath': sys.argv[-1], 'export_format': 'GLB'}",
    'for k, v in {' + extra.join(', ') + '}.items():',
    '    if k in known: kw[k] = v',
    'op(**kw)'
  ].join('\n');
}

module.exports = { buildExportScript: buildExportScript };
