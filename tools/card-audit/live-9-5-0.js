/* live-9-5-0.js — CDP live-verification for v9.5.0: the new format
   previews (HDR/EXR/Krita/OBJ+MTL/labeled-fallback) and Scratch Board.
   Run against a Kanvaz instance started with --remote-debugging-port=9333
   via docs/handoff-assets/cdp/run.js. Static-only checks (test suite,
   code review) already passed; this is the live pass the earlier static
   work couldn't cover. */
var fs = require('fs');
module.exports = async function (cdp) {
  var out = {};
  var SHOT = process.env.SHOT_DIR || 'C:/Users/Admin/AppData/Local/Temp/claude/F--OBL-Kanvaz/f86a41c1-de7a-45d6-a49e-490fd571d6eb/scratchpad/live';
  fs.mkdirSync(SHOT, { recursive: true });
  var M = 'F:/OBL/Kanvaz/tools/card-audit/media/formats/';

  await cdp.eval("window.__errs = []; var oe = console.error; console.error = function(){ window.__errs.push([].slice.call(arguments).map(String).join(' ').slice(0,300)); oe.apply(console, arguments); }; var ow = console.warn; console.warn = function(){ window.__errs.push('WARN ' + [].slice.call(arguments).map(String).join(' ').slice(0,200)); ow.apply(console, arguments); }; window.addEventListener('error', function(e){ window.__errs.push('onerror ' + e.message); }); 1");

  async function clickText(re) {
    var p = await cdp.eval("(function(){var els=[].slice.call(document.querySelectorAll('button,div,a,span')).filter(function(e){var r=e.getBoundingClientRect(); return r.width>0 && r.height>0 && " + re + ".test((e.textContent||'').trim()) && e.children.length<4;}); els.sort(function(a,b){return a.getBoundingClientRect().width*a.getBoundingClientRect().height - b.getBoundingClientRect().width*b.getBoundingClientRect().height;}); if(!els.length) return null; var r=els[0].getBoundingClientRect(); return {x:r.x+r.width/2,y:r.y+r.height/2};})()");
    if (p) await cdp.click(p.x, p.y);
    return !!p;
  }

  out.welcome = await clickText('/^Start using Kanvaz$/'); await cdp.sleep(500);
  out.newBoard = await clickText('/^New Board/'); await cdp.sleep(1000);

  /* ── Part 1: new format previews ── */
  var files = [
    ['hdr', 'sample.hdr'], ['exr', 'sample.exr'], ['kra', 'sample.kra'],
    ['obj', 'sample.obj'],
    ['c4d', 'sample.c4d'], ['hip', 'sample.hip'], ['ma', 'sample.ma'],
    ['clip', 'sample.clip'], ['procreate', 'sample.procreate'], ['ztl', 'sample.ztl']
  ];
  var ids = {};
  for (var i = 0; i < files.length; i++) {
    var x = 80 + (i % 5) * 260, y = 80 + Math.floor(i / 5) * 260;
    var r = await cdp.eval("(function(){ var c=KanvazCards.createFileRefCardAtPath(" + x + "," + y + ",'" + M + files[i][1] + "'); return c && c.id; })()");
    ids[files[i][0]] = r;
  }
  out.createdIds = ids;
  await cdp.sleep(3000); /* let async previews (IPC to main, worker threads) resolve */

  out.cardInfo = JSON.parse(await cdp.eval("JSON.stringify(Object.keys(" + JSON.stringify(ids) + ").reduce(function(acc,k){ var id=" + JSON.stringify(ids) + "[k]; var c=KanvazCards.getAll()[id]; acc[k]=c?{type:c.type,hasDataUrl:!!c.dataUrl,dataUrlLen:(c.dataUrl||'').length,name:c.name}:null; return acc; },{}))"));

  await cdp.eval("KanvazCanvas.zoomFit(); 1");
  await cdp.sleep(600);
  out.formatsShot = await cdp.shot(SHOT + '/formats-board.png');

  /* Zoomed crops of the two most complex previews (HDR tone-mapped, Krita extracted) */
  for (var fk = 0; fk < files.length; fk++) {
    var key = files[fk][0];
    var cid = ids[key];
    if (!cid) continue;
    var rect = await cdp.eval("(function(){ var e=document.getElementById('" + cid + "'); if(!e) return null; var r=e.getBoundingClientRect(); return JSON.stringify({x:r.x,y:r.y,w:r.width,h:r.height}); })()");
    if (!rect) continue;
    var rr = JSON.parse(rect);
    var shot = await cdp.send('Page.captureScreenshot', { format: 'png', clip: { x: rr.x, y: rr.y, width: rr.w, height: rr.h, scale: 1 } });
    fs.writeFileSync(SHOT + '/format-' + key + '.png', Buffer.from(shot.data, 'base64'));
  }

  out.errsAfterFormats = await cdp.eval("window.__errs");

  /* ── Part 2: Scratch Board ── */
  await cdp.eval("window.__errs = []; 1");
  var scratchBtn = await cdp.eval("(function(){ var b=document.getElementById('btn-view-scratch'); var r=b.getBoundingClientRect(); return JSON.stringify({x:r.x+r.width/2,y:r.y+r.height/2}); })()");
  var sb = JSON.parse(scratchBtn);
  await cdp.click(sb.x, sb.y); await cdp.sleep(500);
  out.scratchActiveAfterClick = await cdp.eval("KanvazScratchBoard.isActive()");
  out.scratchToolbarVisible = await cdp.eval("document.getElementById('scratch-toolbar').classList.contains('visible')");

  /* Draw a pen stroke */
  var container = JSON.parse(await cdp.eval("(function(){ var r=document.getElementById('canvas-container').getBoundingClientRect(); return JSON.stringify({x:r.x,y:r.y,w:r.width,h:r.height}); })()"));
  var cx = container.x + container.w / 2, cy = container.y + container.h / 2;
  await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: cx - 100, y: cy - 50, button: 'left', clickCount: 1 });
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: cx - 50, y: cy - 20 });
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: cx, y: cy });
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: cx + 60, y: cy + 30 });
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: cx + 60, y: cy + 30, button: 'left', clickCount: 1 });
  await cdp.sleep(300);
  out.strokeCountAfterPen = await cdp.eval("KanvazScratchBoard.getState().strokes.length");

  /* Switch to rect tool, draw a shape */
  var rectBtn = await cdp.eval("(function(){ var b=document.getElementById('scratch-tool-rect'); var r=b.getBoundingClientRect(); return JSON.stringify({x:r.x+r.width/2,y:r.y+r.height/2}); })()");
  var rb = JSON.parse(rectBtn);
  await cdp.click(rb.x, rb.y); await cdp.sleep(200);
  await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: cx - 150, y: cy + 60, button: 'left', clickCount: 1 });
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: cx - 60, y: cy + 140 });
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: cx - 60, y: cy + 140, button: 'left', clickCount: 1 });
  await cdp.sleep(300);
  out.strokeCountAfterRect = await cdp.eval("KanvazScratchBoard.getState().strokes.length");

  /* Cycle bg style twice (lines -> color -> grid) and screenshot each */
  var bgBtn = await cdp.eval("(function(){ var b=document.getElementById('scratch-tool-bgstyle'); var r=b.getBoundingClientRect(); return JSON.stringify({x:r.x+r.width/2,y:r.y+r.height/2}); })()");
  var bb = JSON.parse(bgBtn);
  out.bgStyleShots = [];
  for (var s = 0; s < 3; s++) {
    var style = await cdp.eval("KanvazScratchBoard.getState().bgStyle");
    var shot2 = await cdp.send('Page.captureScreenshot', { format: 'png' });
    var fname = SHOT + '/scratch-bg-' + style + '.png';
    fs.writeFileSync(fname, Buffer.from(shot2.data, 'base64'));
    out.bgStyleShots.push({ style: style, file: fname });
    await cdp.click(bb.x, bb.y); await cdp.sleep(300);
  }

  /* Change bg color via the color input directly (native <input type=color> pickers can't be driven by CDP mouse events) */
  await cdp.eval("(function(){ var el=document.getElementById('scratch-bgcolor-swatch'); el.value='#204020'; el.dispatchEvent(new Event('input')); return 1; })()");
  await cdp.sleep(300);
  out.bgColorAfterChange = await cdp.eval("KanvazScratchBoard.getState().bgColor");

  /* Switch away to Board, then back to Scratch — confirm strokes persisted (no board save/load involved, same in-memory module) */
  var boardBtn = await cdp.eval("(function(){ var b=document.getElementById('btn-view-board'); var r=b.getBoundingClientRect(); return JSON.stringify({x:r.x+r.width/2,y:r.y+r.height/2}); })()");
  var bd = JSON.parse(boardBtn);
  await cdp.click(bd.x, bd.y); await cdp.sleep(400);
  out.scratchActiveAfterBoardClick = await cdp.eval("KanvazScratchBoard.isActive()");
  out.cardsClickableAfterBoardClick = await cdp.eval("document.getElementById('scratch-strokes-canvas').style.display");

  await cdp.click(sb.x, sb.y); await cdp.sleep(400);
  out.strokeCountAfterRoundTrip = await cdp.eval("KanvazScratchBoard.getState().strokes.length");

  /* Bug-fix verification: "M" shortcut while Scratch is active must NOT leave the stroke canvas on top of Map View */
  await cdp.eval("(function(){ document.activeElement && document.activeElement.blur && document.activeElement.blur(); return 1; })()");
  await cdp.key('m', 'KeyM', 77); await cdp.sleep(600);
  out.mapActiveAfterM = await cdp.eval("KanvazMapView.isActive()");
  out.scratchActiveAfterM = await cdp.eval("KanvazScratchBoard.isActive()");
  out.strokeCanvasDisplayAfterM = await cdp.eval("document.getElementById('scratch-strokes-canvas').style.display");
  out.strokeCanvasPointerEventsAfterM = await cdp.eval("getComputedStyle(document.getElementById('scratch-strokes-canvas')).pointerEvents");
  out.mapShotAfterM = await cdp.shot(SHOT + '/map-after-M-from-scratch.png');

  /* Back to board */
  await cdp.key('m', 'KeyM', 77); await cdp.sleep(400);

  /* Bug-fix verification: clicking Scratch button twice should NOT kick back to Board */
  await cdp.click(sb.x, sb.y); await cdp.sleep(300);
  await cdp.click(sb.x, sb.y); await cdp.sleep(300);
  out.scratchActiveAfterDoubleClick = await cdp.eval("KanvazScratchBoard.isActive()");

  out.errsAfterScratch = await cdp.eval("window.__errs");
  out.finalShot = await cdp.shot(SHOT + '/scratch-final.png');

  return out;
};
