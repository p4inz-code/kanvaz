#!/usr/bin/env node
/* release-notes.js — fills in an empty GitHub release body from the matching
   CHANGELOG.md section.

   Every Kanvaz release before v9.0.0 (64 of them) was published with an
   empty body: only the one-line title (already set from CHANGELOG when the
   release was cut) shows on the releases page, and the real changelist for
   that version is never visible without leaving GitHub. This finds each
   release's "## [X.Y.Z]" section in CHANGELOG.md (the header line itself is
   dropped — the release page's own title already carries that text) and
   PATCHes the release body via `gh release edit`.

   Usage:
     node tools/release-notes.js              (all releases with an empty body)
     node tools/release-notes.js v8.8.5        (just this one, even if it has a body)
     node tools/release-notes.js --dry-run     (print what would change, write nothing)

   Requires the gh CLI, authenticated, with access to the repo. */

var cp = require('child_process');
var fs = require('fs');
var path = require('path');

var CHANGELOG_PATH = path.join(__dirname, '..', 'CHANGELOG.md');
var REPO = 'p4inz-code/kanvaz';

function sh(args) {
  var r = cp.spawnSync('gh', args, { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  if (r.status !== 0) throw new Error('gh ' + args.join(' ') + ' failed: ' + (r.stderr || r.stdout));
  return r.stdout;
}

/* { "9.0.0": "### Platform\n- ...\n\n### Security\n- ...", ... } — version
   without the leading "v", section body without its own "## [...] — ..." header. */
function parseChangelog() {
  var text = fs.readFileSync(CHANGELOG_PATH, 'utf8');
  var lines = text.split('\n');
  var sections = {};
  var currentVersion = null;
  var buf = [];
  function flush() {
    if (currentVersion) sections[currentVersion] = buf.join('\n').trim();
    buf = [];
  }
  for (var i = 0; i < lines.length; i++) {
    var m = /^## \[([0-9]+\.[0-9]+\.[0-9]+)\]/.exec(lines[i]);
    if (m) { flush(); currentVersion = m[1]; continue; }
    if (currentVersion) buf.push(lines[i]);
  }
  flush();
  return sections;
}

function listReleases() {
  var out = sh(['release', 'list', '--repo', REPO, '--limit', '200', '--json', 'tagName,name,isDraft']);
  return JSON.parse(out).filter(function(r) { return !r.isDraft; });
}

function currentBody(tag) {
  return sh(['release', 'view', tag, '--repo', REPO, '--json', 'body']).trim();
}

function main() {
  var args = process.argv.slice(2);
  var dryRun = args.indexOf('--dry-run') !== -1;
  var only = args.filter(function(a) { return a.charAt(0) !== '-'; })[0];

  var sections = parseChangelog();
  var releases = listReleases();
  if (only) {
    var tag = only.charAt(0) === 'v' ? only : 'v' + only;
    releases = releases.filter(function(r) { return r.tagName === tag; });
    if (!releases.length) { console.error('no release found for ' + tag); process.exit(1); }
  }

  var patched = 0, skippedHasBody = 0, skippedNoSection = 0, failed = 0;
  for (var i = 0; i < releases.length; i++) {
    var r = releases[i];
    var version = r.tagName.replace(/^v/, '');
    if (!only) {
      var bodyNow = JSON.parse(sh(['release', 'view', r.tagName, '--repo', REPO, '--json', 'body'])).body;
      if (bodyNow && bodyNow.trim()) { skippedHasBody++; continue; }
    }
    var section = sections[version];
    if (!section) {
      console.log('  (no CHANGELOG.md section for ' + r.tagName + ' — skipped)');
      skippedNoSection++;
      continue;
    }
    if (dryRun) {
      console.log('--- ' + r.tagName + ' (' + section.length + ' chars) ---');
      console.log(section.slice(0, 200) + (section.length > 200 ? '…' : ''));
      patched++;
      continue;
    }
    try {
      sh(['release', 'edit', r.tagName, '--repo', REPO, '--notes', section]);
      console.log('  ✓ ' + r.tagName);
      patched++;
    } catch (e) {
      console.log('  ✗ ' + r.tagName + ': ' + e.message);
      failed++;
    }
  }
  console.log('\n' + (dryRun ? 'would patch' : 'patched') + ': ' + patched + ', already had a body: ' + skippedHasBody + ', no CHANGELOG section: ' + skippedNoSection + ', failed: ' + failed);
  if (failed) process.exit(1);
}

if (require.main === module) {
  main();
} else {
  module.exports = { parseChangelog: parseChangelog };
}
