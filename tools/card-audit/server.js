/* Card-audit harness server.

   Serves the real src/ folder over http so the UI can be rendered and
   screenshotted in any browser (including the Claude app's Browser pane)
   WITHOUT launching Electron. index.html gets two extra scripts injected before
   the app's own: shim.js (a stand-in for the preload's KanvazBridge) and, after
   the app, audit.js (builds one card of every type).

   Run: node tools/card-audit/server.js [port]   (default 5599)
   Dev tool only; not packaged (package.json build.files is src/** only). */

var http = require('http');
var fs = require('fs');
var path = require('path');

var ROOT = path.join(__dirname, '..', '..', 'src');
var HERE = __dirname;
var PORT = parseInt(process.argv[2] || '5599', 10);

var TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.gif': 'image/gif', '.webm': 'video/webm', '.wav': 'audio/wav', '.glb': 'model/gltf-binary',
  '.wasm': 'application/wasm', '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf', '.ico': 'image/x-icon'
};

function send(res, code, body, type) {
  res.writeHead(code, { 'Content-Type': type || 'text/plain', 'Cache-Control': 'no-store' });
  res.end(body);
}

function within(base, p) {
  var rel = path.relative(base, p);
  return rel && rel.indexOf('..') !== 0 && !path.isAbsolute(rel);
}

http.createServer(function(req, res) {
  var url = decodeURIComponent(req.url.split('?')[0]);
  if (url === '/' || url === '/index.html') {
    var html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
    /* the shim must run before any app script; audit.js after all of them */
    html = html.replace('<script src="errors.js"></script>', '<script src="/__audit/shim.js"></script>\n<script src="errors.js"></script>');
    html = html.replace('<script src="app.js"></script>', '<script src="app.js"></script>\n<script src="/__audit/audit.js"></script>');
    return send(res, 200, html, TYPES['.html']);
  }
  var base = ROOT, file;
  if (url.indexOf('/__audit/') === 0) { base = HERE; file = path.join(HERE, url.slice('/__audit/'.length)); }
  else file = path.join(ROOT, url);
  if (!within(base, file) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) return send(res, 404, 'not found');
  send(res, 200, fs.readFileSync(file), TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream');
}).listen(PORT, '127.0.0.1', function() {
  console.log('card-audit harness on http://127.0.0.1:' + PORT + '/');
});
