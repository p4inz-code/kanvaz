/* openable-types.js — which files Kanvaz can be asked to open from the OS
   ("Open with Kanvaz" in Explorer / Finder / a Linux file manager, or a path on
   the command line), and how to pull them out of a launch's arguments.

   One list, used by three things that must never disagree:
     - main.js, to pick the files out of process.argv / second-instance / the
       macOS open-file event;
     - package.json's fileAssociations (test/openable-types-test.js fails if a
       type here is missing there, or the other way round);
     - the "supported" wording.

   Only types Kanvaz actually turns into a card are listed. Text and code files
   are deliberately NOT: they can preview inside a file card, but registering
   Kanvaz next to every .txt/.json/.js in an "Open with" menu would be noise.

   Node-only, ES5/var-only like the rest of src/. */

'use strict';

var path = require('path');
var pathGuard = require('./path-guard');

var GROUPS = {
  image:  { name: 'Image',            exts: ['jpg', 'jpeg', 'png', 'bmp', 'webp'],
            mimes: ['image/jpeg', 'image/png', 'image/bmp', 'image/webp'] },
  gif:    { name: 'Animated GIF',     exts: ['gif'], mimes: ['image/gif'] },
  video:  { name: 'Video',            exts: ['mp4', 'webm', 'mov', 'mkv', 'avi'],
            mimes: ['video/mp4', 'video/webm', 'video/quicktime', 'video/x-matroska', 'video/x-msvideo'] },
  audio:  { name: 'Audio',            exts: ['mp3', 'wav', 'ogg', 'm4a'],
            mimes: ['audio/mpeg', 'audio/wav', 'audio/x-wav', 'audio/ogg', 'audio/mp4'] },
  model:  { name: '3D Model',         exts: ['glb', 'gltf', 'obj', 'fbx', 'stl', 'ply', 'vox', 'usd', 'usda', 'usdc', 'usdz'],
            mimes: ['model/gltf-binary', 'model/gltf+json', 'model/obj', 'model/stl', 'model/vnd.usdz+zip'] },
  blender: { name: 'Blender File',    exts: ['blend'], mimes: ['application/x-blender'] },
  pdf:    { name: 'PDF Document',     exts: ['pdf'], mimes: ['application/pdf'] },
  adobe:  { name: 'Adobe File',       exts: ['psd', 'psb', 'ai', 'xd', 'indd', 'indt'],
            mimes: ['image/vnd.adobe.photoshop', 'application/vnd.adobe.illustrator', 'application/vnd.adobe.xd', 'application/x-indesign'] }
};

var MAX_FILES_PER_LAUNCH = 50;

var ALL = [];
var groupKeys = Object.keys(GROUPS);
for (var gi = 0; gi < groupKeys.length; gi++) ALL = ALL.concat(GROUPS[groupKeys[gi]].exts);

function extOf(p) {
  var base = path.basename(String(p)).replace(/[. ]+$/, '');
  var e = path.extname(base).toLowerCase();
  return e ? e.slice(1) : '';
}

function isOpenable(p) { return ALL.indexOf(extOf(p)) !== -1; }

/* The files in an argv-like list that Kanvaz should add to a board: local,
   absolute (relative ones are resolved against cwd), a supported extension,
   and a real regular file. Flags (--x), the Electron executable, the app
   folder, .kanvaz boards (handled separately) and UNC/remote paths are all
   skipped. At most MAX_FILES_PER_LAUNCH are returned. */
function filesFromArgv(argv, cwd, exists) {
  var out = [];
  var isFile = exists || function(p) { try { return require('fs').statSync(p).isFile(); } catch (e) { return false; } };
  for (var i = 0; i < argv.length && out.length < MAX_FILES_PER_LAUNCH; i++) {
    var a = argv[i];
    if (typeof a !== 'string' || !a || a.charAt(0) === '-') continue;
    if (/^[\\/]{2}/.test(a)) continue;                       /* UNC / device path */
    if (!isOpenable(a)) continue;
    var abs = path.resolve(cwd || process.cwd(), a);
    if (!pathGuard.isLocalAbsolutePath(abs)) continue;
    if (!isFile(abs)) continue;
    if (out.indexOf(abs) === -1) out.push(abs);
  }
  return out;
}

module.exports = {
  GROUPS: GROUPS,
  ALL: ALL,
  MAX_FILES_PER_LAUNCH: MAX_FILES_PER_LAUNCH,
  extOf: extOf,
  isOpenable: isOpenable,
  filesFromArgv: filesFromArgv
};
