/* CDP script: spreads the audit board's cards into a roomy grid, closes any
   open colour picker, and frames everything. */
module.exports = async function (cdp) {
  var out = {};
  out.moved = await cdp.eval("(function(){ try { if (KanvazColorPicker && KanvazColorPicker.close) KanvazColorPicker.close(); } catch(e){} var data = KanvazCards.serialise(); var order = ['image','gif','video','audio','model3d','note','text','color','url','file']; var byType = {}; data.forEach(function(c){ (byType[c.type] = byType[c.type] || []).push(c); }); var list = []; order.forEach(function(t){ (byType[t]||[]).forEach(function(c){ list.push(c); }); }); var i = 0; var COLS = 4, CW = 680, CH = 480; list.forEach(function(c){ c.x = 80 + (i % COLS) * CW; c.y = 80 + Math.floor(i / COLS) * CH; i++; }); KanvazCards.deserialise(data); return list.length; })()");
  await cdp.sleep(3000);
  await cdp.eval("KanvazCanvas.zoomFit(); KanvazCards.deselectAll && KanvazCards.deselectAll(); 1");
  await cdp.sleep(800);
  out.overlaps = await cdp.eval("(function(){ var r=[].slice.call(document.querySelectorAll('.card')).map(function(e){return e.getBoundingClientRect();}); var n=0; for(var i=0;i<r.length;i++)for(var j=i+1;j<r.length;j++){ if(r[i].left<r[j].right&&r[j].left<r[i].right&&r[i].top<r[j].bottom&&r[j].top<r[i].bottom) n++; } return n; })()");
  out.picker = await cdp.eval("!!document.querySelector('.color-picker, #kanvaz-colorpicker, [class*=colorpicker]') && getComputedStyle(document.querySelector('.color-picker, #kanvaz-colorpicker, [class*=colorpicker]')).display");
  out.shot = await cdp.shot('C:/Users/Admin/AppData/Local/Temp/claude/F--OBL-Kanvaz/f86a41c1-de7a-45d6-a49e-490fd571d6eb/scratchpad/live/review-board2.png');
  return out;
};
