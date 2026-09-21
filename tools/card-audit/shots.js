/* CDP script: for each wanted card, centres it at 100%, hovers it with a real
   mouse move, and saves a screenshot cropped to the card plus the strip below.
   Env: SHOT_DIR (output folder), WANT (comma list of "type" or "name~substring"). */
var fs = require('fs');
module.exports = async function (cdp) {
  var dir = process.env.SHOT_DIR || 'C:/Users/Admin/AppData/Local/Temp/claude/F--OBL-Kanvaz/f86a41c1-de7a-45d6-a49e-490fd571d6eb/scratchpad/live/shots';
  fs.mkdirSync(dir, { recursive: true });
  var want = (process.env.WANT || 'model3d,color').split(',');
  var out = {};
  for (var i = 0; i < want.length; i++) {
    var w = want[i];
    var info = await cdp.eval("(function(){ var all=KanvazCards.getAll(); var w='" + w + "'; var pick=null; Object.keys(all).forEach(function(k){ var c=all[k]; if(pick) return; if(w.indexOf('name~')===0 ? (c.name||'').toLowerCase().indexOf(w.slice(5).toLowerCase())!==-1 : c.type===w) pick=c; }); if(!pick) return null; var box=document.getElementById('canvas-container').getBoundingClientRect(); KanvazCanvas.setViewport(box.width/2-(pick.x+pick.w/2), box.height/2-(pick.y+pick.h/2), 1); var el=document.getElementById(pick.id); var r=el.getBoundingClientRect(); return {id:pick.id, name:pick.name, x:r.x, y:r.y, w:r.width, h:r.height}; })()");
    if (!info) { out[w] = 'not found'; continue; }
    await cdp.move(5, 5); await cdp.sleep(250);
    await cdp.eval("KanvazCards.deselectAll && KanvazCards.deselectAll(); 1");
    await cdp.sleep(300);
    var safe = w.replace(/[^a-z0-9]+/gi, '_');
    // idle
    var r0 = await cdp.send('Page.captureScreenshot', { format: 'png', clip: { x: Math.max(0, info.x - 12), y: Math.max(0, info.y - 12), width: info.w + 24, height: info.h + 24, scale: 1 } });
    fs.writeFileSync(dir + '/' + safe + '-idle.png', Buffer.from(r0.data, 'base64'));
    // hover
    await cdp.move(info.x + info.w / 2, info.y + info.h / 2); await cdp.sleep(700);
    var r1 = await cdp.send('Page.captureScreenshot', { format: 'png', clip: { x: Math.max(0, info.x - 12), y: Math.max(0, info.y - 12), width: info.w + 24, height: info.h + 110, scale: 1 } });
    fs.writeFileSync(dir + '/' + safe + '-hover.png', Buffer.from(r1.data, 'base64'));
    out[w] = { id: info.id, name: info.name, w: Math.round(info.w), h: Math.round(info.h) };
  }
  return out;
};
