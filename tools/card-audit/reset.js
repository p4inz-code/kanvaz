/* CDP script: reloads the renderer (so edited src/ is picked up), discards the
   crash-recovery prompt, and goes to a fresh empty board. */
module.exports = async function (cdp) {
  async function clickText(re) {
    var p = await cdp.eval("(function(){var els=[].slice.call(document.querySelectorAll('button,div,a,span')).filter(function(e){var r=e.getBoundingClientRect(); return r.width>0 && r.height>0 && " + re + ".test((e.textContent||'').trim()) && e.children.length<4;}); els.sort(function(a,b){return a.getBoundingClientRect().width*a.getBoundingClientRect().height - b.getBoundingClientRect().width*b.getBoundingClientRect().height;}); if(!els.length) return null; var r=els[0].getBoundingClientRect(); return {x:r.x+r.width/2,y:r.y+r.height/2};})()");
    if (p) await cdp.click(p.x, p.y);
    return !!p;
  }
  var out = {};
  out.reload = await Promise.race([cdp.send('Page.reload', { ignoreCache: true }).then(function() { return 'sent'; }), new Promise(function(r) { setTimeout(function() { r('TIMEOUT'); }, 15000); })]);
  await cdp.sleep(4500);
  out.discard = await clickText('/^Discard$/'); await cdp.sleep(700);
  out.welcome = await clickText('/^Start using Kanvaz$/'); await cdp.sleep(600);
  out.newBoard = await clickText('/^New Board/'); await cdp.sleep(1000);
  return out;
};
