/* CDP script: starts a board, then reports what is on it. Used before and after
   launching Kanvaz the way an OS "Open with" does (electron . <file>). */
module.exports = async function (cdp) {
  var mode = process.env.MODE || 'summary';
  async function clickText(re) {
    var p = await cdp.eval("(function(){var els=[].slice.call(document.querySelectorAll('button,div,a,span')).filter(function(e){var r=e.getBoundingClientRect(); return r.width>0 && r.height>0 && " + re + ".test((e.textContent||'').trim()) && e.children.length<4;}); els.sort(function(a,b){return a.getBoundingClientRect().width*a.getBoundingClientRect().height - b.getBoundingClientRect().width*b.getBoundingClientRect().height;}); if(!els.length) return null; var r=els[0].getBoundingClientRect(); return {x:r.x+r.width/2,y:r.y+r.height/2};})()");
    if (p) await cdp.click(p.x, p.y);
    return !!p;
  }
  var out = {};
  if (mode === 'start') {
    out.welcome = await clickText('/^Start using Kanvaz$/'); await cdp.sleep(600);
    out.newBoard = await clickText('/^New Board/'); await cdp.sleep(1000);
  }
  out.startScreen = await cdp.eval("!!document.getElementById('startup-screen')");
  out.cards = JSON.parse(await cdp.eval("JSON.stringify(Object.keys(KanvazCards.getAll()).map(function(k){var c=KanvazCards.getAll()[k]; return c.type+':'+c.name+(c.modelFormat?'('+c.modelFormat+')':'');}))"));
  out.toast = await cdp.eval("[].slice.call(document.querySelectorAll('[class*=toast]')).map(function(e){return e.textContent.trim();}).filter(Boolean).slice(-2)");
  if (process.env.SHOT) out.shot = await cdp.shot(process.env.SHOT);
  return out;
};
