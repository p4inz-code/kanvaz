/* usage: node run.js <script.js>
   script.js: module.exports = async function(cdp) { ... }
   cdp.send(method, params) -> result; cdp.eval(expr) -> value (awaits promises);
   cdp.click(x, y, opts), cdp.key(key, code), cdp.shot(path), cdp.sleep(ms) */
var fs = require('fs');
var http = require('http');
var WebSocket = require('F:/OBL/Kanvaz/node_modules/ws');

function targets() {
  return new Promise(function(res, rej) {
    http.get('http://127.0.0.1:9333/json', function(r) {
      var d = ''; r.on('data', function(c) { d += c; }); r.on('end', function() { res(JSON.parse(d)); });
    }).on('error', rej);
  });
}

targets().then(function(ts) {
  var t = ts.filter(function(x) { return x.type === 'page'; })[0];
  var ws = new WebSocket(t.webSocketDebuggerUrl, { maxPayload: 200 * 1024 * 1024 });
  var id = 0, pending = {};
  ws.on('message', function(d) {
    var m = JSON.parse(d.toString());
    if (m.id && pending[m.id]) { pending[m.id](m); delete pending[m.id]; }
  });
  function send(method, params) {
    return new Promise(function(res, rej) {
      var i = ++id;
      pending[i] = function(m) { m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result); };
      ws.send(JSON.stringify({ id: i, method: method, params: params || {} }));
    });
  }
  var cdp = {
    send: send,
    eval: function(expr) {
      return send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }).then(function(r) {
        if (r.exceptionDetails) throw new Error('JS exception: ' + (r.exceptionDetails.exception && r.exceptionDetails.exception.description));
        return r.result.value;
      });
    },
    click: function(x, y, opts) {
      opts = opts || {};
      var btn = opts.button || 'left';
      return send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: x, y: y })
        .then(function() { return send('Input.dispatchMouseEvent', { type: 'mousePressed', x: x, y: y, button: btn, clickCount: opts.clickCount || 1 }); })
        .then(function() { return send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: x, y: y, button: btn, clickCount: opts.clickCount || 1 }); });
    },
    move: function(x, y) { return send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: x, y: y }); },
    key: function(key, code, vk) {
      var p = { key: key, code: code || ('Key' + key.toUpperCase()), windowsVirtualKeyCode: vk || key.toUpperCase().charCodeAt(0), text: key.length === 1 ? key : undefined };
      return send('Input.dispatchKeyEvent', Object.assign({ type: 'keyDown' }, p))
        .then(function() { return send('Input.dispatchKeyEvent', Object.assign({ type: 'keyUp' }, p)); });
    },
    shot: function(file) {
      return send('Page.captureScreenshot', { format: 'png' }).then(function(r) { fs.writeFileSync(file, Buffer.from(r.data, 'base64')); return file; });
    },
    sleep: function(ms) { return new Promise(function(r) { setTimeout(r, ms); }); }
  };
  ws.on('open', function() {
    Promise.resolve(require(require('path').resolve(process.argv[2]))(cdp)).then(function(out) {
      console.log(JSON.stringify(out, null, 1));
      process.exit(0);
    }).catch(function(e) { console.error('SCRIPT ERROR', e.message); process.exit(1); });
  });
  setTimeout(function() { console.error('TIMEOUT'); process.exit(1); }, 120000);
});
