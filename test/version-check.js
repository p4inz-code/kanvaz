/* version-check.js — verifies version consistency across all 6 locked locations */
var fs = require('fs');
var v = require('../package.json').version;
var errors = [];

var boards = fs.readFileSync('src/boards.js', 'utf8');
if (boards.indexOf("'" + v + "'") === -1) errors.push('boards.js VERSION mismatch');

var ui = fs.readFileSync('src/ui.js', 'utf8');
if (ui.indexOf('Version ' + v) === -1) errors.push('ui.js about-version mismatch');
if (ui.indexOf('v' + v) === -1) errors.push('ui.js tagline mismatch');

var readme = fs.readFileSync('README.md', 'utf8');
if (readme.indexOf(v) === -1) errors.push('README.md mismatch');

var pdf = fs.readFileSync('docs/generate_overview_pdf.py', 'utf8');
if (pdf.indexOf('v' + v) === -1) errors.push('generate_overview_pdf.py mismatch');

if (errors.length) {
  errors.forEach(function(e) { console.error('  !! ' + e); });
  process.exit(1);
} else {
  console.log('  All 6 version locations match: ' + v);
}
