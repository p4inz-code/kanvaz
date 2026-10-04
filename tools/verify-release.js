#!/usr/bin/env node
/* verify-release.js — checks a DRAFT release's real downloaded assets before
   anyone clicks publish.

   Why: this class of bug has already shipped more than once. 8 releases
   (v7.14.0-v7.21.0) went out with no installers; v9.6.0 had two draft
   releases for one tag; v9.7.0 shipped a download guide naming files that do
   not exist and SHA256SUMS files naming files nobody could download. The
   checksum step in build.yml is continue-on-error, so a broken one is
   invisible. This turns each of those into a red check on the tag.

   Usage:
     node tools/verify-release.js <assetsDir> <version> [--releases <releases.json>] [--tag vX.Y.Z]

   <assetsDir>  directory holding every downloaded asset of the draft
   <version>    X.Y.Z (no leading v)
   --releases   optional JSON from `gh release list --json tagName,isDraft`;
                enables the one-release-per-tag check
   Exit code 0 = all checks passed, 1 = at least one failed (all are listed).

   Dependency-free; hashes with Node crypto so it behaves the same on any
   runner. Exports its functions so test/verify-release-test.js can exercise
   them without network access. */

var fs = require('fs');
var path = require('path');
var crypto = require('crypto');

var ROOT = path.join(__dirname, '..');

/* The exact set an electron-builder + build.yml run must produce. Names are
   the GitHub asset names (spaces already replaced by dashes). */
function requiredAssets(version, pluginDirs) {
  var v = version;
  var list = [
    'Kanvaz-Setup-' + v + '.exe',
    'Kanvaz-' + v + '.exe',
    'Kanvaz-' + v + '-arm64.dmg',
    'Kanvaz-' + v + '.dmg',
    'Kanvaz-' + v + '.AppImage',
    'latest.yml',
    'latest-mac.yml',
    'latest-linux.yml',
    'SHA256SUMS-windows-latest.txt',
    'SHA256SUMS-macos-latest.txt',
    'SHA256SUMS-ubuntu-latest.txt'
  ];
  for (var i = 0; i < pluginDirs.length; i++) {
    list.push('kanvaz-' + pluginDirs[i] + '-' + v + '.zip');
  }
  return list;
}

function isInstaller(name) {
  return /\.(exe|dmg|AppImage)$/.test(name);
}

/* Every concrete file name the download guide tells users to grab or skip.
   Wildcards (`*.blockmap`, `kanvaz-*-<version>.zip`) and commands with
   spaces are not file names, and tokens without a known extension (the
   "-x64" aside) are prose, so they are skipped on purpose. */
function guideAssetNames(guideText, version) {
  var names = [];
  var re = /`([^`]+)`/g;
  var m;
  while ((m = re.exec(guideText)) !== null) {
    var tok = m[1].replace(/<version>/g, version);
    if (/[\s*]/.test(tok)) continue;
    if (!/\.(exe|dmg|AppImage|yml|txt)$/.test(tok)) continue;
    if (names.indexOf(tok) === -1) names.push(tok);
  }
  return names;
}

/* "<sha256>  <name>" or "<sha256> *<name>" (sha256sum / shasum -a 256). */
function parseSums(text) {
  var out = [];
  var lines = text.split(/\r?\n/);
  for (var i = 0; i < lines.length; i++) {
    var m = /^([0-9a-fA-F]{64})\s+\*?(.+?)\s*$/.exec(lines[i]);
    if (m) out.push({ hash: m[1].toLowerCase(), name: m[2] });
  }
  return out;
}

function sha256File(p) {
  return new Promise(function(resolve, reject) {
    var h = crypto.createHash('sha256');
    var s = fs.createReadStream(p);
    s.on('data', function(c) { h.update(c); });
    s.on('error', reject);
    s.on('end', function() { resolve(h.digest('hex')); });
  });
}

/* releases: array of {tagName, isDraft} from `gh release list --json`.
   Catches the v9.6.0 incident: two drafts for one tag (one often listed as
   "untagged-..."). */
function checkReleases(releases, tag) {
  var errors = [];
  var same = 0;
  for (var i = 0; i < releases.length; i++) {
    var r = releases[i];
    if (r.tagName === tag) same++;
    if (r.isDraft && /^untagged-/.test(r.tagName)) {
      errors.push('stray untagged draft release "' + r.tagName + '" exists (likely a duplicate for ' + tag + ')');
    }
  }
  if (same === 0) errors.push('no release found for tag ' + tag);
  if (same > 1) errors.push(same + ' releases share the tag ' + tag + ' (expected exactly 1)');
  return errors;
}

function verify(opts) {
  var dir = opts.dir;
  var version = opts.version;
  var errors = [];
  var present = fs.readdirSync(dir);

  var expected = requiredAssets(version, opts.pluginDirs);
  var i;
  for (i = 0; i < expected.length; i++) {
    if (present.indexOf(expected[i]) === -1) errors.push('missing asset: ' + expected[i]);
  }

  if (opts.guideText) {
    var guideNames = guideAssetNames(opts.guideText, version);
    for (i = 0; i < guideNames.length; i++) {
      if (present.indexOf(guideNames[i]) === -1) {
        errors.push('download guide names "' + guideNames[i] + '" but no such asset exists (the 9.7.0 bug class)');
      }
    }
  }

  for (i = 0; i < present.length; i++) {
    if (isInstaller(present[i])) {
      var size = fs.statSync(path.join(dir, present[i])).size;
      if (size === 0) errors.push('installer is zero bytes: ' + present[i]);
    }
  }

  /* Checksums: every line must name a real asset with a matching hash, and
     every installer must be covered by exactly one line across all files. */
  var sumsFiles = present.filter(function(n) { return /^SHA256SUMS-.*\.txt$/.test(n); });
  var covered = {};
  var jobs = [];
  sumsFiles.forEach(function(sf) {
    var entries = parseSums(fs.readFileSync(path.join(dir, sf), 'utf8'));
    if (entries.length === 0) errors.push(sf + ' contains no checksum lines');
    entries.forEach(function(e) {
      covered[e.name] = (covered[e.name] || 0) + 1;
      var target = path.join(dir, e.name);
      if (present.indexOf(e.name) === -1) {
        errors.push(sf + ' lists "' + e.name + '" which is not an uploaded asset (so `sha256sum -c` would fail)');
        return;
      }
      jobs.push(sha256File(target).then(function(actual) {
        if (actual !== e.hash) errors.push(sf + ': hash mismatch for ' + e.name);
      }));
    });
  });
  present.forEach(function(n) {
    if (isInstaller(n) && !covered[n]) errors.push('installer has no checksum line in any SHA256SUMS file: ' + n);
    if (covered[n] > 1) errors.push('installer appears in more than one checksum line: ' + n);
  });

  if (opts.releases) {
    errors = errors.concat(checkReleases(opts.releases, opts.tag || ('v' + version)));
  }

  return Promise.all(jobs).then(function() { return errors; });
}

function pluginDirsFromRepo() {
  var base = path.join(ROOT, 'official-plugins');
  return fs.readdirSync(base).filter(function(n) {
    return fs.statSync(path.join(base, n)).isDirectory();
  }).sort();
}

function main(argv) {
  var args = argv.slice(2);
  var positional = [];
  var releasesPath = null;
  var tag = null;
  for (var i = 0; i < args.length; i++) {
    if (args[i] === '--releases') releasesPath = args[++i];
    else if (args[i] === '--tag') tag = args[++i];
    else positional.push(args[i]);
  }
  if (positional.length < 2) {
    console.error('usage: node tools/verify-release.js <assetsDir> <version> [--releases file.json] [--tag vX.Y.Z]');
    return Promise.resolve(2);
  }
  var guidePath = path.join(ROOT, '.github', 'release-download-guide.md');
  var opts = {
    dir: positional[0],
    version: positional[1].replace(/^v/, ''),
    pluginDirs: pluginDirsFromRepo(),
    guideText: fs.existsSync(guidePath) ? fs.readFileSync(guidePath, 'utf8') : null,
    releases: releasesPath ? JSON.parse(fs.readFileSync(releasesPath, 'utf8')) : null,
    tag: tag
  };
  if (!opts.guideText) {
    console.error('could not read .github/release-download-guide.md — refusing to skip the guide check silently');
    return Promise.resolve(1);
  }
  return verify(opts).then(function(errors) {
    if (errors.length === 0) {
      console.log('verify-release: all checks passed for ' + opts.version +
        ' (' + fs.readdirSync(opts.dir).length + ' assets, checksums recomputed from the real files)');
      return 0;
    }
    console.error('verify-release: ' + errors.length + ' problem(s) with ' + opts.version + ':');
    errors.forEach(function(e) { console.error('  - ' + e); });
    return 1;
  });
}

module.exports = {
  requiredAssets: requiredAssets,
  guideAssetNames: guideAssetNames,
  parseSums: parseSums,
  checkReleases: checkReleases,
  verify: verify
};

if (require.main === module) {
  main(process.argv).then(function(code) { process.exit(code); }, function(e) {
    console.error('verify-release crashed:', e && e.stack || e);
    process.exit(1);
  });
}
