/* CDP script: injects tools/card-audit/audit.js into the running app, then for
   EVERY card measures it idle, hovered (real mouse move) and selected (real
   click), and prints only the issues. Text output; use shots.js for pictures. */
var fs = require('fs');
module.exports = async function (cdp) {
  var src = fs.readFileSync('F:/OBL/Kanvaz/tools/card-audit/audit.js', 'utf8');
  await cdp.eval(src + '; 1');
  var cards = await cdp.eval("JSON.stringify(Object.keys(KanvazCards.getAll()).map(function(k){var c=KanvazCards.getAll()[k]; return {id:k,type:c.type,name:c.name};}))");
  cards = JSON.parse(cards);
  var report = [];
  for (var i = 0; i < cards.length; i++) {
    var c = cards[i];
    var f = await cdp.eval("JSON.stringify(KZAudit.focus('" + c.id + "', 1))");
    f = JSON.parse(f);
    var states = {};
    await cdp.move(3, 3); await cdp.eval("KanvazCards.deselectAll && KanvazCards.deselectAll(); 1"); await cdp.sleep(350);
    states.idle = JSON.parse(await cdp.eval("JSON.stringify(KZAudit.audit('" + c.id + "'))"));
    await cdp.move(f.cx, f.cy); await cdp.sleep(600);
    states.hover = JSON.parse(await cdp.eval("JSON.stringify(KZAudit.audit('" + c.id + "'))"));
    await cdp.click(f.cx, f.cy); await cdp.sleep(500);
    states.selected = JSON.parse(await cdp.eval("JSON.stringify(KZAudit.audit('" + c.id + "'))"));
    var row = { type: c.type, name: c.name, size: f.w + 'x' + f.h };
    ['idle', 'hover', 'selected'].forEach(function(st) { row[st] = states[st].issues; });
    report.push(row);
  }
  return report.map(function(r) {
    var n = r.idle.length + r.hover.length + r.selected.length;
    return { card: r.type + ' "' + r.name + '" ' + r.size, issues: n, idle: r.idle, hover: r.hover, selected: r.selected };
  });
};
