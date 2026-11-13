#!/usr/bin/env node
/* Checks the live guide site: every page in the sidebar answers, every internal link and image loads,
   every #anchor lands on a real heading, and every external link answers.
   Usage: node tools/check-live-site.js [baseUrl]
   Exits 1 if anything is broken. Run weekly by .github/workflows/weekly-check.yml.
   Needs Node 20 (built-in fetch). */

var BASE = (process.argv[2] || 'https://p4inz-code.github.io').replace(/\/$/, '');
var SITE = BASE + '/kanvaz';

/* sites that refuse automated requests but work in a browser: never report these */
var IGNORE = [
  /github\.com\/p4inz-code\/kanvaz\/stargazers$/,
  /linkedin\.com/,
  /discord\.gg/,
  /discord\.com/,
  /buymeacoffee\.com/,
  /npmjs\.com/
];
function ignored(u) { return IGNORE.some(function(r) { return r.test(u); }); }

var problems = [];
function bad(kind, where, what) { problems.push(kind + ': ' + what + (where ? '  (on ' + where + ')' : '')); }

function get(url, tries) {
  tries = tries || 2;
  return fetch(url, { redirect: 'follow', headers: { 'user-agent': 'kanvaz-site-check' }, signal: AbortSignal.timeout(30000) })
    .catch(function(e) { if (tries > 1) return get(url, tries - 1); return { status: 0, text: function() { return Promise.resolve(''); }, error: e }; });
}

function attrs(html, name) {
  var out = [], re = new RegExp(name + '="([^"]+)"', 'g'), m;
  while ((m = re.exec(html)) !== null) out.push(m[1].replace(/&amp;/g, '&'));
  return out;
}

function pool(list, limit, fn) {
  var i = 0, results = [];
  function next() {
    if (i >= list.length) return Promise.resolve();
    var item = list[i++];
    return fn(item).then(function(r) { results.push(r); return next(); });
  }
  var workers = [];
  for (var k = 0; k < limit; k++) workers.push(next());
  return Promise.all(workers).then(function() { return results; });
}

(async function main() {
  var home = await get(SITE + '/guide/');
  if (home.status !== 200) { console.log('The guide home page returned ' + home.status); process.exit(1); }
  var homeHtml = await home.text();
  var pagePaths = {};
  pagePaths['/kanvaz/'] = true;
  pagePaths['/kanvaz/guide/'] = true;
  attrs(homeHtml, 'href').forEach(function(h) {
    if (/^\/kanvaz\/guide\/[^#?]*$/.test(h)) pagePaths[h] = true;
  });
  var pages = Object.keys(pagePaths).sort();
  console.log(pages.length + ' pages from the sidebar');

  var htmlByPath = {};
  await pool(pages, 6, function(p) {
    return get(BASE + p).then(function(r) {
      if (r.status !== 200) { bad('PAGE', '', p + ' returned ' + r.status); return null; }
      return r.text().then(function(t) { htmlByPath[p] = t; });
    });
  });

  var internal = {}, external = {};
  var fragments = [];
  Object.keys(htmlByPath).forEach(function(p) {
    var html = htmlByPath[p];
    if (/\{\{|\{%/.test(html)) bad('TEMPLATE', p, 'unrendered template text');
    attrs(html, 'href').concat(attrs(html, 'src')).forEach(function(h) {
      if (/^(mailto:|javascript:|data:)/.test(h)) return;
      var u;
      try { u = new URL(h, BASE + p); } catch (e) { return; }
      if (u.origin === BASE) {
        if (u.hash && u.pathname) fragments.push({ from: p, path: u.pathname, frag: u.hash.slice(1) });
        if (u.pathname) internal[u.pathname + u.search] = p;
      } else if (/^https?:$/.test(u.protocol)) {
        u.hash = '';
        if (!ignored(u.href)) external[u.href] = p;
      }
    });
  });

  /* anchors */
  fragments.forEach(function(f) {
    var html = htmlByPath[f.path];
    if (html === undefined) return;
    var ids = attrs(html, 'id');
    if (f.frag && ids.indexOf(f.frag) === -1) bad('ANCHOR', f.from, f.path + '#' + f.frag + ' has no such heading');
  });

  var internalList = Object.keys(internal);
  var externalList = Object.keys(external);
  console.log(internalList.length + ' internal targets, ' + externalList.length + ' external targets');

  await pool(internalList, 8, function(p) {
    return get(BASE + p).then(function(r) { if (r.status !== 200) bad('LINK', internal[p], p + ' returned ' + r.status); });
  });
  await pool(externalList, 6, function(u) {
    return get(u).then(function(r) {
      if (r.status === 429 || r.status === 999) return;   /* rate limited, not broken */
      if (r.status < 200 || r.status >= 400) bad('EXTERNAL', external[u], u + ' returned ' + r.status);
    });
  });

  if (problems.length) {
    console.log('\n' + problems.length + ' problem(s):');
    problems.forEach(function(p) { console.log('  ' + p); });
    process.exit(1);
  }
  console.log('\nAll clear: pages, links, images and anchors are fine.');
})();
