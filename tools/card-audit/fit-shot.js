/* CDP script: fits the whole board in view, counts overlapping cards, screenshots. */
module.exports = async function (cdp) {
  await cdp.eval("KanvazCanvas.zoomFit(); KanvazCards.deselectAll && KanvazCards.deselectAll(); 1");
  await cdp.sleep(900);
  var out = {};
  out.overlaps = await cdp.eval("(function(){ var r=[].slice.call(document.querySelectorAll('.card')).map(function(e){return e.getBoundingClientRect();}); var n=0; for(var i=0;i<r.length;i++)for(var j=i+1;j<r.length;j++){ if(r[i].left<r[j].right-1&&r[j].left<r[i].right-1&&r[i].top<r[j].bottom-1&&r[j].top<r[i].bottom-1) n++; } return n; })()");
  out.shot = await cdp.shot(process.env.SHOT);
  return out;
};
