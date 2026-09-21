/* CDP script: every render mode + camera view + turntable on the model card whose
   name starts with NAME, capturing console errors and screenshots. */
var fs = require('fs');
module.exports = async function (cdp) {
  var dir = process.env.SHOT_DIR;
  fs.mkdirSync(dir, { recursive: true });
  var out = {};
  await cdp.eval("window.__errs = []; var oe = console.error; console.error = function(){ window.__errs.push([].slice.call(arguments).map(String).join(' ').slice(0,300)); oe.apply(console, arguments); }; window.addEventListener('error', function(e){ window.__errs.push('onerror ' + e.message); }); var ow = console.warn; console.warn = function(){ window.__errs.push('WARN ' + [].slice.call(arguments).map(String).join(' ').slice(0,200)); ow.apply(console, arguments); }; 1");
  var info = JSON.parse(await cdp.eval("(function(){ var all=KanvazCards.getAll(); var pick=null; Object.keys(all).forEach(function(k){ if(!pick && all[k].type==='model3d' && (all[k].name||'').indexOf('" + (process.env.NAME || 'test2') + "')===0) pick=all[k]; }); var box=document.getElementById('canvas-container').getBoundingClientRect(); KanvazCanvas.setViewport(box.width/2-(pick.x+pick.w/2)*1.2, box.height/2-(pick.y+pick.h/2)*1.2, 1.2); var r=document.getElementById(pick.id).getBoundingClientRect(); return JSON.stringify({id:pick.id,x:r.x,y:r.y,w:r.width,h:r.height}); })()"));
  var ctl = "KanvazCards.getModel3DControls('" + info.id + "')";
  out.avail = JSON.parse(await cdp.eval("JSON.stringify(" + ctl + ".getModeAvailability())"));
  var unavailable = Object.keys(out.avail).filter(function(k) { return !out.avail[k].ok; });
  out.unavailable = unavailable;
  var modes = JSON.parse(await cdp.eval("JSON.stringify(KanvazCards.getRenderModes().map(function(m){return m[0];}))"));
  out.modes = modes;
  await cdp.move(5, 5); await cdp.sleep(300);
  for (var i = 0; i < modes.length; i++) {
    await cdp.eval(ctl + ".setRenderMode('" + modes[i] + "'); 1");
    await cdp.sleep(700);
    var r = await cdp.send('Page.captureScreenshot', { format: 'png', clip: { x: info.x, y: info.y, width: info.w, height: info.h * 0.8, scale: 0.6 } });
    fs.writeFileSync(dir + '/mode-' + modes[i] + '.png', Buffer.from(r.data, 'base64'));
    var active = await cdp.eval("(document.querySelector('#" + info.id + " .model3d-mode-picker')||{}).textContent");
    out['label_' + modes[i]] = active;
  }
  await cdp.eval(ctl + ".setRenderMode('normal'); 1"); await cdp.sleep(400);
  // camera views
  var views = ['front', 'back', 'left', 'right', 'top', 'bottom'];
  out.views = {};
  for (var v = 0; v < views.length; v++) {
    await cdp.eval(ctl + ".setViewPreset('" + views[v] + "'); 1");
    await cdp.sleep(500);
    out.views[views[v]] = await cdp.eval("JSON.stringify(KanvazCards.getAll()['" + info.id + "'].cameraPosition)");
    if (views[v] === 'front' || views[v] === 'top') {
      var rr = await cdp.send('Page.captureScreenshot', { format: 'png', clip: { x: info.x, y: info.y, width: info.w, height: info.h * 0.8, scale: 0.6 } });
      fs.writeFileSync(dir + '/view-' + views[v] + '.png', Buffer.from(rr.data, 'base64'));
    }
  }
  // turntable
  await cdp.eval(ctl + ".setTurntable(true); 1");
  var a = await cdp.eval("JSON.stringify(KanvazCards.getAll()['" + info.id + "'].cameraPosition)");
  await cdp.sleep(900);
  out.turntableTurns = await cdp.eval(ctl + ".getTurntable()");
  await cdp.eval(ctl + ".setTurntable(false); 1");
  // the real picker menus, opened with a real click
  await cdp.move(info.x + info.w / 2, info.y + info.h / 2); await cdp.sleep(500);
  var btn = JSON.parse(await cdp.eval("(function(){ var b=document.querySelector('#" + info.id + " .model3d-mode-picker'); var r=b.getBoundingClientRect(); return JSON.stringify({x:r.x+r.width/2,y:r.y+r.height/2,t:b.textContent}); })()"));
  await cdp.click(btn.x, btn.y); await cdp.sleep(400);
  out.menuItems = JSON.parse(await cdp.eval("JSON.stringify([].slice.call(document.querySelectorAll('.model3d-menu .model3d-menu-item, .model3d-menu .model3d-menu-head')).map(function(e){return (e.className.indexOf('head')!==-1?'## ':'')+e.textContent+(e.className.indexOf('disabled')!==-1?' [disabled]':'')+(e.className.indexOf('active')!==-1?' *':'');}))"));
  var rs = await cdp.send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(dir + '/menu-open.png', Buffer.from(rs.data, 'base64'));
  await cdp.key('Escape', 'Escape', 27); await cdp.sleep(300);
  out.menuClosedByEscape = await cdp.eval("!document.querySelector('.model3d-menu')");
  out.errs = await cdp.eval("window.__errs");
  return out;
};
