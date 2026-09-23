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
var url = require('url');
var pathGuard = require('./path-guard');

/* Some Linux file managers / xdg-open hand a launched app a file:// URI
   in argv instead of a plain path. Decode it back to a filesystem path so
   it is recognised the same way a bare path is; anything that is not a
   file:// URI (including a non-file:// URL, which is never openable) is
   returned unchanged. */
function fromFileUrl(a) {
  if (typeof a !== 'string' || !/^file:\/\//i.test(a)) return a;
  try { return url.fileURLToPath(a); } catch (e) { return a; }
}

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
            mimes: ['image/vnd.adobe.photoshop', 'application/vnd.adobe.illustrator', 'application/vnd.adobe.xd', 'application/x-indesign'] },
  /* 9.2.0 — Radiance HDR/.pic and OpenEXR: real in-card previews
     (hdr-preview.js — tone-mapped, not a colour-managed viewer; some EXR
     compression methods aren't decoded yet, see that module's own
     comment), same "real preview" tier as Adobe/PDF above. */
  hdr:    { name: 'HDR/EXR Image',    exts: ['hdr', 'pic', 'exr'],
            mimes: ['image/vnd.radiance', 'image/x-exr'] },
  /* 9.3.0 — Krita: a real whole-canvas preview (paint-preview.js finds the
     PNG Krita itself saves inside the .kra zip on every save), same
     "real preview" tier as everything above. Clip Studio (.clip) and
     Procreate (.procreate) do NOT get this treatment: .clip's internal
     structure isn't public/documented enough here to be confident of a
     correct read (unlike HDR/EXR and Krita, both built against a real
     spec or a well-understood zip layout), and Procreate's format is a
     proprietary compressed blob with no realistic path to a preview at
     all — both get the no-in-card-preview treatment below instead of a
     guess that could quietly show the wrong thing. */
  krita:  { name: 'Krita File',       exts: ['kra'], mimes: ['application/x-krita'] }
  /* Scope decision (2026-09-23): the no-in-card-preview groups that used
     to live here (ZBrush .ztl, Houdini .hip/.hipnc, Cinema 4D .c4d, Maya
     .ma/.mb, Clip Studio .clip, Procreate .procreate) have been removed
     from what Kanvaz claims to open/associate with at the OS level.
     None of them have a command-line/headless export the way Blender
     does, so there was no path to a real preview — they only ever
     became a generic labeled file-reference card. The owner's call:
     don't register file associations/"Open with Kanvaz" for formats
     Kanvaz can't actually show anything for; .blend keeps its real
     preview support (a local Blender install exports a real thumbnail),
     krita keeps its real embedded-composite preview. The removed
     formats are listed as Planned in README.md's format table and
     docs/ROADMAP.md — this is a "not yet", not a permanent no. */
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
  var seen = Object.create(null);   /* case-folded on Windows, so a path handed to us twice with different casing (a shortcut vs. a second-instance re-send, say) is still one card, not two */
  var isFile = exists || function(p) { try { return require('fs').statSync(p).isFile(); } catch (e) { return false; } };
  for (var i = 0; i < argv.length && out.length < MAX_FILES_PER_LAUNCH; i++) {
    var a = argv[i];
    if (typeof a !== 'string' || !a || a.charAt(0) === '-') continue;
    a = fromFileUrl(a);
    if (/^[\\/]{2}/.test(a)) continue;                       /* UNC / device path */
    /* NTFS alternate data streams: "photo.png:payload.exe" reads as an
       innocent-looking basename via path.extname, but resolves through
       fs.statSync/readFileSync to a hidden stream that can hold anything —
       same reasoning as path-guard.js's checkOpenable, applied here too
       since this path never goes through that check. */
    if (process.platform === 'win32' && a.indexOf(':', 2) !== -1) continue;
    if (!isOpenable(a)) continue;
    var abs = path.resolve(cwd || process.cwd(), a);
    if (!pathGuard.isLocalAbsolutePath(abs)) continue;
    if (!isFile(abs)) continue;
    var key = process.platform === 'win32' ? abs.toLowerCase() : abs;
    if (seen[key]) continue;
    seen[key] = true;
    out.push(abs);
  }
  return out;
}

module.exports = {
  GROUPS: GROUPS,
  ALL: ALL,
  MAX_FILES_PER_LAUNCH: MAX_FILES_PER_LAUNCH,
  extOf: extOf,
  isOpenable: isOpenable,
  filesFromArgv: filesFromArgv,
  fromFileUrl: fromFileUrl
};
