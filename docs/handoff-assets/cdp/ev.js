/* usage: node ev.js <exprFile> [screenshotOut.png]
   Evaluates the JS in exprFile in the first page target (awaits promises),
   prints the JSON result, optionally saves a screenshot after. */
var fs = require('fs');
var http = require('http');
var WebSocket = require('F:/OBL/Kanvaz/node_modules/ws');

function getTargets() {
  return new Promise(function(res, rej) {
    http.get('http://127.0.0.1:9333/json', function(r) {
      var d = ''; r.on('data', function(c) { d += c; }); r.on('end', function() { res(JSON.parse(d)); });
    }).on('error', rej);
  });
}

getTargets().then(function(ts) {
  var t = ts.filter(function(x) { return x.type === 'page'; })[0];
  if (!t) { console.error('no page target'); process.exit(2); }
  var ws = new WebSocket(t.webSocketDebuggerUrl, { maxPayload: 200 * 1024 * 1024 });
  var expr = fs.readFileSync(process.argv[2], 'utf8');
  var shot = process.argv[3];
  ws.on('open', function() {
    ws.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression: expr, returnByValue: true, awaitPromise: true } }));
  });
  ws.on('message', function(d) {
    var m = JSON.parse(d.toString());
    if (m.id === 1) {
      var r = m.result && m.result.result;
      if (m.result && m.result.exceptionDetails) console.log('JS EXCEPTION: ' + JSON.stringify(m.result.exceptionDetails.exception && m.result.exceptionDetails.exception.description));
      else console.log(r && r.subtype === 'error' ? 'JS ERROR: ' + r.description : JSON.stringify(r ? r.value : m, null, 1));
      if (shot) ws.send(JSON.stringify({ id: 2, method: 'Page.captureScreenshot', params: { format: 'png' } }));
      else process.exit(0);
    } else if (m.id === 2) {
      fs.writeFileSync(shot, Buffer.from(m.result.data, 'base64'));
      console.log('screenshot saved ' + shot);
      process.exit(0);
    }
  });
  ws.on('error', function(e) { console.error('WS ERROR', e.message); process.exit(1); });
  setTimeout(function() { console.error('TIMEOUT'); process.exit(1); }, 30000);
});
