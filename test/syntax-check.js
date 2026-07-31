/* syntax-check.js — verifies all src/*.js files parse without errors */
var fs = require('fs');
var files = fs.readdirSync('src').filter(function(x) {
  return x.endsWith('.js');
}).map(function(x) {
  return 'src/' + x;
});

var errors = [];
files.forEach(function(p) {
  try {
    new Function(fs.readFileSync(p, 'utf8'));
  } catch(e) {
    errors.push(p + ': ' + e.message);
  }
});

if (errors.length) {
  errors.forEach(function(e) { console.error(e); });
  process.exit(1);
} else {
  console.log('  ALL ' + files.length + ' files pass syntax check');
}
