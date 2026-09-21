/* CDP script: re-fetches main.css so a CSS-only edit shows up without reloading
   the page (keeps the board you built). */
module.exports = async function (cdp) {
  await cdp.eval("new Promise(function(res){var l=document.querySelector('link[rel=stylesheet][href*=\"main.css\"]'); var n=l.cloneNode(); n.href=l.getAttribute('href').split('?')[0]+'?v='+Date.now(); n.onload=function(){l.remove();res(1);}; l.parentNode.insertBefore(n,l.nextSibling);})");
  await cdp.sleep(500);
  return 'css reloaded';
};
