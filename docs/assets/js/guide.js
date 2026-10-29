/* Kanvaz guide: theme toggle, mobile menu, "on this page" outline, heading anchors, copy buttons.
   Dependency-free; the page works fully without it (it only adds conveniences). */
(function () {
  var root = document.documentElement;

  /* theme toggle: remembers the choice, otherwise follows the OS */
  var themeBtn = document.getElementById('theme-btn');
  if (themeBtn) themeBtn.addEventListener('click', function () {
    var cur = root.getAttribute('data-theme');
    var dark = cur === 'dark' || (cur !== 'light' && window.matchMedia('(prefers-color-scheme: dark)').matches);
    var next = dark ? 'light' : 'dark';
    root.setAttribute('data-theme', next);
    try { localStorage.setItem('kanvaz-guide-theme', next); } catch (e) { /* private mode */ }
  });

  /* mobile navigation */
  var menuBtn = document.getElementById('menu-btn');
  var scrim = document.getElementById('scrim');
  function setNav(open) {
    document.body.classList.toggle('nav-open', open);
    if (menuBtn) menuBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
  }
  if (menuBtn) menuBtn.addEventListener('click', function () { setNav(!document.body.classList.contains('nav-open')); });
  if (scrim) scrim.addEventListener('click', function () { setNav(false); });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') setNav(false); });

  /* keep the active sidebar link in view */
  var active = document.querySelector('.sidebar a.active');
  if (active && active.scrollIntoView) { try { active.scrollIntoView({ block: 'center' }); } catch (e) { /* old browser */ } }

  var doc = document.getElementById('doc');
  if (!doc) return;

  /* heading anchors + outline */
  var heads = [].slice.call(doc.querySelectorAll('h2, h3'));
  var used = {};
  heads.forEach(function (h) {
    if (!h.id) {
      var base = h.textContent.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'section';
      var id = base, n = 2;
      while (used[id] || document.getElementById(id)) { id = base + '-' + n++; }
      h.id = id;
    }
    used[h.id] = true;
    var a = document.createElement('a');
    a.className = 'anchor'; a.href = '#' + h.id; a.setAttribute('aria-label', 'Link to this section'); a.textContent = '#';
    h.appendChild(a);
  });

  var toc = document.getElementById('toc');
  var list = document.getElementById('toc-list');
  if (toc && list && heads.length >= 3) {
    heads.forEach(function (h) {
      var li = document.createElement('li');
      if (h.tagName === 'H3') li.className = 'l3';
      var link = document.createElement('a');
      link.href = '#' + h.id;
      link.textContent = h.textContent.replace(/#$/, '').trim();
      li.appendChild(link); list.appendChild(li);
    });
    toc.hidden = false;
    if ('IntersectionObserver' in window) {
      var links = [].slice.call(list.querySelectorAll('a'));
      var byId = {}; links.forEach(function (l) { byId[l.getAttribute('href').slice(1)] = l; });
      var io = new IntersectionObserver(function (entries) {
        entries.forEach(function (en) {
          if (en.isIntersecting) { links.forEach(function (l) { l.classList.remove('on'); }); if (byId[en.target.id]) byId[en.target.id].classList.add('on'); }
        });
      }, { rootMargin: '-70px 0px -70% 0px' });
      heads.forEach(function (h) { io.observe(h); });
    }
  }

  /* copy buttons on code blocks */
  [].slice.call(doc.querySelectorAll('pre')).forEach(function (pre) {
    if (!navigator.clipboard) return;
    var b = document.createElement('button');
    b.type = 'button'; b.className = 'copy'; b.textContent = 'Copy';
    b.addEventListener('click', function () {
      var code = pre.querySelector('code');
      navigator.clipboard.writeText((code || pre).innerText.replace(/\n$/, '')).then(function () {
        b.textContent = 'Copied'; setTimeout(function () { b.textContent = 'Copy'; }, 1400);
      });
    });
    pre.appendChild(b);
  });
})();

/* ---- search: loads search.json on first open, fuzzy-ish scoring, keyboard driven ---- */
(function () {
  var sm = document.getElementById('sm'), input = document.getElementById('sm-input'), list = document.getElementById('sm-list');
  var btn = document.getElementById('search-btn');
  if (!sm || !input || !list || !window.KZ_SEARCH) return;
  var docs = null, loading = false, sel = 0, hits = [];

  function strip(s) { return s.replace(/[#*`>|_\[\]()!]/g, ' ').replace(/\s+/g, ' '); }
  function load(cb) {
    if (docs) return cb();
    if (loading) return;
    loading = true;
    fetch(window.KZ_SEARCH).then(function (r) { return r.json(); }).then(function (j) {
      docs = j.map(function (d) { var c = strip(d.c); return { t: d.t, u: d.u, d: d.d, c: c, tl: d.t.toLowerCase(), dl: d.d.toLowerCase(), cl: c.toLowerCase() }; });
      cb();
    }).catch(function () { list.innerHTML = '<li class="none">Search could not load. Check your connection and try again.</li>'; loading = false; });
  }
  function esc(s) { return s.replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function mark(s, toks) {
    var lo = s.toLowerCase(), on = new Array(s.length + 1), k, i, at;
    toks.forEach(function (t) {
      if (t.length < 2) return;
      at = 0;
      while ((at = lo.indexOf(t, at)) >= 0) { for (k = at; k < at + t.length; k++) on[k] = 1; at += t.length; }
    });
    var out = '', open = false;
    for (i = 0; i < s.length; i++) {
      if (on[i] && !open) { out += '<mark>'; open = true; }
      if (!on[i] && open) { out += '</mark>'; open = false; }
      out += esc(s.charAt(i));
    }
    return out + (open ? '</mark>' : '');
  }
  function run(q) {
    q = q.trim().toLowerCase();
    if (!q) { hits = docs.slice(0, 8).map(function (d) { return { d: d, s: 0, snip: d.d }; }); return render([]); }
    var toks = q.split(/\s+/).filter(Boolean);
    hits = [];
    docs.forEach(function (d) {
      var s = 0, ok = true, first = -1;
      toks.forEach(function (t) {
        var inT = d.tl.indexOf(t) >= 0, inD = d.dl.indexOf(t) >= 0, ic = d.cl.indexOf(t);
        if (!inT && !inD && ic < 0) { ok = false; return; }
        if (inT) s += 12; if (inD) s += 5;
        if (ic >= 0) { s += 2; var n = 0, p = ic; while (p >= 0 && n < 6) { n++; p = d.cl.indexOf(t, p + t.length); } s += n; if (first < 0 || ic < first) first = ic; }
      });
      if (!ok) return;
      var snip = first >= 0 ? (first > 50 ? '...' : '') + d.c.slice(Math.max(0, first - 50), first + 130) + '...' : d.d;
      hits.push({ d: d, s: s, snip: snip });
    });
    hits.sort(function (a, b) { return b.s - a.s; });
    hits = hits.slice(0, 9);
    render(toks);
  }
  function render(toks) {
    sel = 0;
    if (!hits.length) { list.innerHTML = '<li class="none">Nothing found. Try fewer words, or see <a href="' + window.KZ_SEARCH.replace('search.json', 'guide/contact.html') + '">Contact and support</a>.</li>'; return; }
    list.innerHTML = hits.map(function (h, i) {
      return '<li role="option" data-i="' + i + '"' + (i === 0 ? ' class="on"' : '') + '><a href="' + h.d.u + '"><b>' + mark(h.d.t, toks) + '</b><span>' + mark(h.snip || '', toks) + '</span></a></li>';
    }).join('');
  }
  function move(n) {
    var items = list.querySelectorAll('li[data-i]'); if (!items.length) return;
    items[sel].classList.remove('on'); sel = (sel + n + items.length) % items.length; items[sel].classList.add('on');
    items[sel].scrollIntoView({ block: 'nearest' });
  }
  function open() { sm.hidden = false; document.body.classList.add('sm-open'); input.value = ''; input.focus(); load(function () { run(''); }); }
  function close() { sm.hidden = true; document.body.classList.remove('sm-open'); }
  if (btn) btn.addEventListener('click', open);
  sm.addEventListener('mousedown', function (e) { if (e.target === sm) close(); });
  input.addEventListener('input', function () { if (docs) run(input.value); });
  input.addEventListener('keydown', function (e) {
    if (e.key === 'ArrowDown') { e.preventDefault(); move(1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); move(-1); }
    else if (e.key === 'Enter') { var a = list.querySelector('li.on a'); if (a) window.location = a.href; }
  });
  document.addEventListener('keydown', function (e) {
    var tag = (document.activeElement && document.activeElement.tagName) || '';
    if (e.key === 'Escape' && !sm.hidden) { close(); }
    else if ((e.key === '/' && !/INPUT|TEXTAREA|SELECT/.test(tag)) || ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k')) { e.preventDefault(); open(); }
  });
})();
