/* CDP script: puts the named 3D card in each of the given modes and screenshots it. */
var fs = require('fs');
module.exports = async function (cdp) {
  var dir = process.env.SHOT_DIR;
  fs.mkdirSync(dir, { recursive: true });
  var modes = (process.env.MODES || 'normal,wireframe').split(',');
  var info = JSON.parse(await cdp.eval("(function(){ var all=KanvazCards.getAll(); var pick=null; Object.keys(all).forEach(function(k){ if(!pick && all[k].type==='model3d' && (all[k].name||'').indexOf('" + (process.env.NAME || 'test2') + "')===0) pick=all[k]; }); var box=document.getElementById('canvas-container').getBoundingClientRect(); KanvazCanvas.setViewport(box.width/2-(pick.x+pick.w/2)*1.4, box.height/2-(pick.y+pick.h/2)*1.4, 1.4); var r=document.getElementById(pick.id).getBoundingClientRect(); return JSON.stringify({id:pick.id,x:r.x,y:r.y,w:r.width,h:r.height}); })()"));
  await cdp.move(5, 5); await cdp.sleep(300);
  for (var i = 0; i < modes.length; i++) {
    await cdp.eval("KanvazCards.getModel3DControls('" + info.id + "').setRenderMode('" + modes[i] + "'); 1");
    await cdp.sleep(900);
    var r = await cdp.send('Page.captureScreenshot', { format: 'png', clip: { x: info.x, y: info.y, width: info.w, height: info.h * 0.83, scale: 1 } });
    fs.writeFileSync(dir + '/' + modes[i] + '.png', Buffer.from(r.data, 'base64'));
  }
  return info;
};
