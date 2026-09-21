/* CDP script (run with docs/handoff-assets/cdp/run.js against a running Kanvaz
   started with --remote-debugging-port=9333): dismisses the welcome screen,
   opens a fresh board and lays out one card of EVERY type at its default size,
   using real files from tools/card-audit/media. Leaves the app open. */
var M = 'F:/OBL/Kanvaz/tools/card-audit/media/';
module.exports = async function (cdp) {
  var out = {};
  async function clickText(re) {
    var p = await cdp.eval("(function(){var els=[].slice.call(document.querySelectorAll('button,div,a,span')).filter(function(e){var r=e.getBoundingClientRect(); return r.width>0 && r.height>0 && " + re + ".test((e.textContent||'').trim()) && e.children.length<4;}); els.sort(function(a,b){return a.getBoundingClientRect().width*a.getBoundingClientRect().height - b.getBoundingClientRect().width*b.getBoundingClientRect().height;}); if(!els.length) return null; var r=els[0].getBoundingClientRect(); return {x:r.x+r.width/2,y:r.y+r.height/2};})()");
    if (p) await cdp.click(p.x, p.y);
    return !!p;
  }
  out.welcome = await clickText('/^Start using Kanvaz$/'); await cdp.sleep(600);
  out.newBoard = await clickText('/^New Board/'); await cdp.sleep(1200);
  out.errs0 = await cdp.eval("window.__errs = []; var oe = console.error; console.error = function(){ window.__errs.push([].slice.call(arguments).map(String).join(' ').slice(0,200)); oe.apply(console, arguments); }; 1");

  var COLS = 4, GX = 60, GY = 60, CW = 520, CH = 420, n = 0;
  var ids = {};
  var SHOT = process.env.CARD_SHOT || 'C:/Users/Admin/AppData/Local/Temp/claude/F--OBL-Kanvaz/f86a41c1-de7a-45d6-a49e-490fd571d6eb/scratchpad/live/review-board.png';
  function pos() { var i = n++; return '{x:' + (GX + (i % COLS) * CW) + ',y:' + (GY + Math.floor(i / COLS) * CH) + '}'; }
  async function media(type, file) {
    var r = await cdp.eval("new Promise(function(res){ KanvazMedia.loadFromPath('" + M + file + "', function(result, err){ if(err||!result){res('ERR '+err);return;} var c=KanvazCards.createFromMedia(result," + pos() + "); res(c.id); }); })");
    ids[type] = r;
  }
  await media('image', 'image.png');
  await media('gif', 'anim.gif');
  await media('video', 'clip.webm');
  await media('audio', 'tone.wav');
  ids.model3d = await cdp.eval("new Promise(function(res){ KanvazMedia.loadModelFromPath('" + M + "model.glb', function(result, err){ if(err||!result){res('ERR '+err);return;} var c=KanvazCards.createFromMedia(result," + pos() + "); res(c.id); }); })");
  ids.note = await cdp.eval("(function(){ var p=" + pos() + "; var c=KanvazCards.createNote(p.x,p.y); return c.id; })()");
  ids.text = await cdp.eval("(function(){ var p=" + pos() + "; var c=KanvazCards.createTextCard(p.x,p.y); return c.id; })()");
  ids.color = await cdp.eval("(function(){ var p=" + pos() + "; var c=KanvazCards.createColorCard(p.x,p.y); return c.id; })()");
  ids.url = await cdp.eval("(function(){ var p=" + pos() + "; var c=KanvazCards.createUrlCard(p.x,p.y); return c.id; })()");
  ids.file = await cdp.eval("(function(){ var p=" + pos() + "; var c=KanvazCards.createFileRefCardAtPath(p.x,p.y,'C:\\\\Projects\\\\shots\\\\scene_010_layout_v003.psd'); return c && c.id; })()");
  ids.pdfOrText = await cdp.eval("(function(){ var p=" + pos() + "; var c=KanvazCards.createFileRefCardAtPath(p.x,p.y,'F:\\\\OBL\\\\Kanvaz\\\\README.md'); return c && c.id; })()");
  var A = 'F:/OBL/Kanvaz/tools/card-audit/media/adobe/';
  var adobe = [['psd', 'sample.psd'], ['psb', 'sample.psb'], ['psdNoComposite', 'nocomposite.psd'], ['psdTransparent', 'transparent.psd'], ['ai', 'sample.ai'], ['pdf', '../sample.pdf'], ['xd', 'sample.xd'], ['fresco', 'sample.fresco']];
  for (var ai = 0; ai < adobe.length; ai++) {
    ids[adobe[ai][0]] = await cdp.eval("(function(){ var p=" + pos() + "; var c=KanvazCards.createFileRefCardAtPath(p.x,p.y,'" + A + adobe[ai][1] + "'); return c && c.id; })()");
  }
  await cdp.sleep(2500);
  // Give the note/text/url some content the way a user would, then frame everything.
  await cdp.eval("(function(){ var a=KanvazCards.getAll(); var n=a['" + ids.note + "']; n.text='A note with some text.\\nSecond line, to show wrapping and the footer.'; var t=a['" + ids.text + "']; t.text='Bare text label'; var u=a['" + ids.url + "']; u.url='https://example.com/a/fairly/long/path/to/a/reference'; u.urlPreview={title:'Example reference page',image:null}; var d=KanvazCards.serialise(); KanvazCards.deserialise(d); return 1; })()");
  await cdp.sleep(2500);
  await cdp.eval("KanvazCanvas.zoomFit(); KanvazCards.deselectAll && KanvazCards.deselectAll(); 1");
  await cdp.sleep(800);
  out.ids = ids;
  out.count = await cdp.eval("document.querySelectorAll('.card').length");
  out.link = await cdp.eval("KanvazBridge.linkGetStatus ? KanvazBridge.linkGetStatus().then(function(r){return JSON.stringify(r);}) : 'no linkGetStatus'");
  out.errs = await cdp.eval("window.__errs");
  out.shot = await cdp.shot(SHOT);
  return out;
};
