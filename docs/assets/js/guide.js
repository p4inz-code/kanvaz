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
