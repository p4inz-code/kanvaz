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

/* ---- custom UI layer: reading progress, back to top, lightbox, tabs, callouts, table scroll ---- */
(function () {
  var doc = document.getElementById('doc');

  /* reading progress and back to top */
  var bar = document.createElement('div'); bar.id = 'progress'; bar.setAttribute('aria-hidden', 'true'); document.body.appendChild(bar);
  var top = document.createElement('button'); top.id = 'to-top'; top.type = 'button'; top.setAttribute('aria-label', 'Back to top');
  top.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5M5 12l7-7 7 7"/></svg>';
  top.addEventListener('click', function () { window.scrollTo({ top: 0, behavior: 'smooth' }); });
  document.body.appendChild(top);
  var ticking = false;
  function onScroll() {
    if (ticking) return; ticking = true;
    window.requestAnimationFrame(function () {
      var h = document.documentElement, max = h.scrollHeight - h.clientHeight;
      bar.style.width = (max > 0 ? Math.min(100, (h.scrollTop / max) * 100) : 0) + '%';
      top.classList.toggle('on', h.scrollTop > 700);
      ticking = false;
    });
  }
  window.addEventListener('scroll', onScroll, { passive: true }); onScroll();

  /* pointer glow on the home cards */
  [].slice.call(document.querySelectorAll('.cards a')).forEach(function (a) {
    a.addEventListener('pointermove', function (e) { var r = a.getBoundingClientRect(); a.style.setProperty('--mx', (e.clientX - r.left) + 'px'); a.style.setProperty('--my', (e.clientY - r.top) + 'px'); });
  });

  if (!doc) return;

  /* callouts: a blockquote that starts with Note, Tip, Warning or Important */
  [].slice.call(doc.querySelectorAll('blockquote')).forEach(function (q) {
    var m = /^\s*(Note|Tip|Warning|Important|Caution)\b[:.]?\s*/i.exec(q.textContent);
    if (!m) return;
    var kind = m[1].toLowerCase();
    q.classList.add('callout', kind === 'warning' || kind === 'caution' || kind === 'important' ? 'callout-warn' : kind === 'tip' ? 'callout-tip' : 'callout-note');
    q.setAttribute('data-label', m[1][0].toUpperCase() + m[1].slice(1).toLowerCase());
  });

  /* tables scroll sideways inside their own box, with our scrollbar */
  [].slice.call(doc.querySelectorAll('table')).forEach(function (t) {
    if (t.parentNode.classList.contains('table-scroll')) return;
    var w = document.createElement('div'); w.className = 'table-scroll';
    t.parentNode.insertBefore(w, t); w.appendChild(t);
  });

  /* tabs: <div class="tabs" data-tabs><section data-tab="Windows">...</section>...</div> */
  [].slice.call(doc.querySelectorAll('[data-tabs]')).forEach(function (box, bi) {
    var secs = [].slice.call(box.querySelectorAll(':scope > section[data-tab]'));
    if (!secs.length) return;
    var list = document.createElement('div'); list.className = 'tablist'; list.setAttribute('role', 'tablist');
    var ua = navigator.userAgent, os = /Mac/.test(ua) ? 'macOS' : /Linux|X11/.test(ua) && !/Android/.test(ua) ? 'Linux' : 'Windows';
    var btns = secs.map(function (s, i) {
      var b = document.createElement('button'); b.type = 'button'; b.setAttribute('role', 'tab');
      b.id = 'tab-' + bi + '-' + i; b.textContent = s.getAttribute('data-tab');
      s.setAttribute('role', 'tabpanel'); s.setAttribute('aria-labelledby', b.id);
      list.appendChild(b); return b;
    });
    box.insertBefore(list, box.firstChild);
    function pick(i, focus) {
      btns.forEach(function (b, j) { b.setAttribute('aria-selected', j === i ? 'true' : 'false'); b.tabIndex = j === i ? 0 : -1; secs[j].hidden = j !== i; });
      if (focus) btns[i].focus();
    }
    var start = 0; secs.forEach(function (s, i) { if (s.getAttribute('data-tab') === os) start = i; });
    pick(start);
    btns.forEach(function (b, i) {
      b.addEventListener('click', function () { pick(i); });
      b.addEventListener('keydown', function (e) {
        if (e.key === 'ArrowRight') { e.preventDefault(); pick((i + 1) % btns.length, true); }
        if (e.key === 'ArrowLeft') { e.preventDefault(); pick((i - 1 + btns.length) % btns.length, true); }
      });
    });
  });

  /* lightbox: every image in the page body and the gallery opens large, with arrows and Esc */
  var shots = [].slice.call(doc.querySelectorAll('img')).filter(function (i) { return !i.closest('a[href^="http"]') && (i.naturalWidth === 0 || i.naturalWidth > 120 || i.closest('.gallery, figure')); });
  if (!shots.length) return;
  var lb = document.createElement('div'); lb.id = 'lb'; lb.hidden = true; lb.setAttribute('role', 'dialog'); lb.setAttribute('aria-modal', 'true'); lb.setAttribute('aria-label', 'Image viewer');
  lb.innerHTML = '<div class="lb-stage"><img alt=""></div><div class="lb-cap"></div><button class="lb-x" type="button" aria-label="Close">&times;</button><button class="lb-prev" type="button" aria-label="Previous image">&#8249;</button><button class="lb-next" type="button" aria-label="Next image">&#8250;</button>';
  document.body.appendChild(lb);
  var lbImg = lb.querySelector('img'), lbCap = lb.querySelector('.lb-cap'), cur = 0, last = null;
  function show(i) {
    cur = (i + shots.length) % shots.length;
    var s = shots[cur], fc = s.closest('figure') && s.closest('figure').querySelector('figcaption');
    lbImg.src = s.currentSrc || s.src; lbImg.alt = s.alt || '';
    lbCap.innerHTML = '';
    var t = document.createElement('span'); t.textContent = (fc && fc.textContent) || s.alt || ''; lbCap.appendChild(t);
    var n = document.createElement('small'); n.textContent = (cur + 1) + ' of ' + shots.length; lbCap.appendChild(n);
  }
  function open(i) { last = document.activeElement; show(i); lb.hidden = false; document.body.style.overflow = 'hidden'; lb.querySelector('.lb-x').focus(); }
  function close() { lb.hidden = true; document.body.style.overflow = ''; if (last && last.focus) last.focus(); }
  shots.forEach(function (img, i) {
    img.addEventListener('click', function (e) { e.preventDefault(); open(i); });
    var a = img.closest('a'); if (a && !/^https?:/.test(a.getAttribute('href') || '')) a.addEventListener('click', function (e) { if (a.contains(img)) { e.preventDefault(); open(i); } });
  });
  lb.addEventListener('click', function (e) { if (e.target === lb || e.target === lbImg || e.target.classList.contains('lb-stage') || e.target.classList.contains('lb-x')) close(); });
  lb.querySelector('.lb-prev').addEventListener('click', function (e) { e.stopPropagation(); show(cur - 1); });
  lb.querySelector('.lb-next').addEventListener('click', function (e) { e.stopPropagation(); show(cur + 1); });
  document.addEventListener('keydown', function (e) {
    if (lb.hidden) return;
    if (e.key === 'Escape') { e.stopPropagation(); close(); }
    else if (e.key === 'ArrowLeft') show(cur - 1);
    else if (e.key === 'ArrowRight') show(cur + 1);
  }, true);
})();

/* reveal home sections and cards as they scroll into view */
(function () {
  if (!('IntersectionObserver' in window)) return;
  var els = [].slice.call(document.querySelectorAll('.lp-reveal'));
  if (!els.length) return;
  var io = new IntersectionObserver(function (es) { es.forEach(function (e) { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } }); }, { threshold: 0.08 });
  els.forEach(function (el, i) { if (el.getBoundingClientRect().top < window.innerHeight) return; el.classList.add('js-reveal'); io.observe(el); });
})();

/* project tag filter on the More by P4inz page */
(function () {
  var box = document.getElementById('chips'), cards = [].slice.call(document.querySelectorAll('.proj-card'));
  if (!box || !cards.length) return;
  var counts = {}; cards.forEach(function (c) { c.getAttribute('data-tags').split('|').forEach(function (t) { counts[t] = (counts[t] || 0) + 1; }); });
  var tags = Object.keys(counts).filter(function (t) { return counts[t] > 1; }).sort(function (a, b) { return counts[b] - counts[a] || a.localeCompare(b); });
  var on = null;
  function apply() { cards.forEach(function (c) { c.hidden = !!on && c.getAttribute('data-tags').split('|').indexOf(on) < 0; }); [].slice.call(box.children).forEach(function (b) { b.setAttribute('aria-pressed', String(b.getAttribute('data-t') === (on || ''))); }); }
  ['All'].concat(tags).forEach(function (t) {
    var b = document.createElement('button'); b.type = 'button'; b.setAttribute('data-t', t === 'All' ? '' : t); b.textContent = t === 'All' ? 'All' : t + ' (' + counts[t] + ')';
    b.addEventListener('click', function () { on = t === 'All' || on === t ? null : t; apply(); });
    box.appendChild(b);
  });
  var q = (location.hash || '').slice(1); if (q && counts[decodeURIComponent(q)]) on = decodeURIComponent(q);
  apply();
})();

/* home page: swap the still screenshot for the walkthrough GIF only when asked (it is large) */
(function () {
  var btn = document.getElementById('tour-btn');
  if (!btn) return;
  btn.addEventListener('click', function () {
    var img = document.querySelector('.lp-hero-art .p-a img');
    var gif = btn.getAttribute('data-gif');
    if (img && gif) { img.removeAttribute('width'); img.removeAttribute('height'); img.src = gif; img.alt = 'Kanvaz walkthrough: home screen, canvas, Map View, dark and light themes'; }
    var cap = document.querySelector('.lp-hero-art .p-a figcaption');
    if (cap) cap.textContent = 'The 14 second tour';
    btn.hidden = true;
  });
})();

/* home page motion: liquid button origin, magnetic pull, print tilt, hero drift, number count-up */
(function () {
  if (!document.body.classList.contains('landing')) return;
  var fine = window.matchMedia('(hover: hover) and (pointer: fine)').matches;
  var calm = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* where the liquid starts: the point where the pointer entered, then it follows */
  [].slice.call(document.querySelectorAll('.lp-btn')).forEach(function (b) {
    function at(e) { var r = b.getBoundingClientRect(); b.style.setProperty('--mx', (e.clientX - r.left) + 'px'); b.style.setProperty('--my', (e.clientY - r.top) + 'px'); }
    b.addEventListener('pointerenter', at);
    b.addEventListener('pointermove', at);
  });

  /* count the ledger numbers up when they come into view */
  var nums = [].slice.call(document.querySelectorAll('.lp-ledger b')).filter(function (b) { return /^\d+$/.test(b.textContent.trim()); });
  if (nums.length && 'IntersectionObserver' in window && !calm) {
    var seen = new IntersectionObserver(function (es) {
      es.forEach(function (e) {
        if (!e.isIntersecting) return;
        seen.unobserve(e.target);
        var el = e.target, end = parseInt(el.textContent, 10), t0 = null;
        el.textContent = '0';
        function step(t) {
          if (t0 === null) t0 = t;
          var p = Math.min(1, (t - t0) / 1100), eased = 1 - Math.pow(1 - p, 3);
          el.textContent = String(Math.round(end * eased));
          if (p < 1) requestAnimationFrame(step); else el.textContent = String(end);
        }
        requestAnimationFrame(step);
      });
    }, { threshold: 0.6 });
    nums.forEach(function (n) { seen.observe(n); });
  }

  if (!fine || calm) return;

  /* magnetic pull: buttons, links and pills lean toward the pointer when it is near */
  var pullers = [].slice.call(document.querySelectorAll('.lp-btn, .lp-link, .lp-tour, .star-btn')).map(function (el) { return { el: el, x: 0, y: 0 }; });
  var last = null, ticking = false;
  function update() {
    ticking = false;
    if (!last) return;
    pullers.forEach(function (p) {
      var r = p.el.getBoundingClientRect();
      if (r.bottom < -100 || r.top > innerHeight + 100) return;
      var cx = r.left + r.width / 2 - p.x, cy = r.top + r.height / 2 - p.y;
      var dx = last.clientX - cx, dy = last.clientY - cy, dist = Math.sqrt(dx * dx + dy * dy);
      var reach = Math.max(r.width, r.height) * 0.7 + 46, tx = 0, ty = 0;
      if (dist < reach) { var pull = 1 - dist / reach; tx = dx * pull * 0.32; ty = dy * pull * 0.32; }
      if (Math.abs(tx - p.x) > 0.2 || Math.abs(ty - p.y) > 0.2) { p.x = tx; p.y = ty; p.el.style.translate = tx.toFixed(1) + 'px ' + ty.toFixed(1) + 'px'; }
    });
  }
  document.addEventListener('pointermove', function (e) { last = e; if (!ticking) { ticking = true; requestAnimationFrame(update); } }, { passive: true });
  document.addEventListener('pointerleave', function () { last = { clientX: -9999, clientY: -9999 }; update(); });

  /* prints tilt toward the pointer and catch the light */
  [].slice.call(document.querySelectorAll('.lp-row .print, .p-mini')).forEach(function (pr) {
    pr.addEventListener('pointermove', function (e) {
      var r = pr.getBoundingClientRect(), x = (e.clientX - r.left) / r.width - 0.5, y = (e.clientY - r.top) / r.height - 0.5;
      pr.classList.add('tilting');
      pr.style.setProperty('--rx', (-y * 5).toFixed(2) + 'deg');
      pr.style.setProperty('--ry', (x * 6).toFixed(2) + 'deg');
    });
    pr.addEventListener('pointerleave', function () { pr.classList.remove('tilting'); pr.style.removeProperty('--rx'); pr.style.removeProperty('--ry'); });
  });

  /* the hero prints drift a little against the pointer */
  var art = document.querySelector('.lp-hero-art');
  if (art) {
    var raf = 0, px = 0, py = 0;
    window.addEventListener('pointermove', function (e) {
      px = e.clientX / innerWidth - 0.5; py = e.clientY / innerHeight - 0.5;
      if (!raf) raf = requestAnimationFrame(function () { raf = 0; art.style.setProperty('--px', px.toFixed(3)); art.style.setProperty('--py', py.toFixed(3)); });
    }, { passive: true });
  }
})();
