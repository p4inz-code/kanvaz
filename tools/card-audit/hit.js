/* CDP script: for the file cards, checks what is actually under the centre of
   the Open / Change buttons (a real hit test, not a style check). */
module.exports = async function (cdp) {
  return JSON.parse(await cdp.eval("JSON.stringify([].slice.call(document.querySelectorAll('.card-file')).map(function(c){ var f=c.className.indexOf('has-file-preview')!==-1; var btns=[].slice.call(c.querySelectorAll('button')).filter(function(b){ return /url-open-btn|url-change|file-/.test(b.className) || b.title; }).map(function(b){ var r=b.getBoundingClientRect(); var hit=document.elementFromPoint(r.x+r.width/2, r.y+r.height/2); return {btn:(b.title||b.className).slice(0,24), reachable: hit===b || b.contains(hit) , coveredBy: hit && !(hit===b||b.contains(hit)) ? (hit.className||hit.tagName).toString().split(' ')[0] : null}; }); return {name:(c.querySelector('.card-bar-title')||{}).textContent, preview:f, buttons:btns}; }))"));
};
