/* tooltip.js — custom-styled tooltips, replacing the OS-native title
 * attribute box everywhere in the app at once.
 *
 * Direct feedback: "these box which comes when we hover over button,
 * make em customized not native defaults." Kanvaz uses a plain `title`
 * attribute on dozens of buttons/icons across cards.js, annotate.js,
 * boards.js, sidepanel.js, and more — retrofitting every one of them
 * individually to a custom tooltip component would be a huge, error-
 * prone diff for zero behavior change. Instead, this listens globally
 * (event delegation on document, capture phase) for ANY element with a
 * `title` attribute, suppresses the browser's own tooltip by stashing
 * and removing that attribute for as long as the element is hovered,
 * and shows a small styled tooltip that matches the rest of the app's
 * dark-panel look instead. Every existing title="..." in the whole
 * codebase gets this for free — nothing else needs to change.
 */

var KanvazTooltip = (function() {

  var tooltipEl   = null;
  var showTimer   = null;
  var currentEl   = null;
  var SHOW_DELAY  = 450;
  var MARGIN      = 8;

  function ensureTooltipEl() {
    if (tooltipEl) return tooltipEl;
    tooltipEl = document.createElement('div');
    tooltipEl.id = 'custom-tooltip';
    document.body.appendChild(tooltipEl);
    return tooltipEl;
  }

  /* Walks up from the actual hovered node to find the nearest ancestor
     carrying a real (non-empty) title attribute — matches how the
     native tooltip already behaves for a titled container with plain
     children (e.g. an icon <span> inside a titled <button>). */
  function findTitledAncestor(node) {
    while (node && node !== document.body && node.nodeType === 1) {
      if (node.hasAttribute && node.hasAttribute('title')) {
        var t = node.getAttribute('title');
        if (t && t.trim()) return node;
      }
      node = node.parentNode;
    }
    return null;
  }

  function positionTooltip(target, el) {
    var rect = target.getBoundingClientRect();
    /* Measure after the text is set but before deciding final
       placement — offsetWidth/Height reflect the real rendered size
       for THIS tooltip's text, not a guessed constant. */
    var tw = el.offsetWidth;
    var th = el.offsetHeight;

    var left = rect.left + (rect.width - tw) / 2;
    left = Math.max(MARGIN, Math.min(left, window.innerWidth - tw - MARGIN));

    var top = rect.bottom + MARGIN;
    var showAbove = (top + th + MARGIN) > window.innerHeight;
    if (showAbove) top = rect.top - th - MARGIN;
    /* Clamp again — a very short/tall viewport (or a target flush
       against an edge) could still push it off-screen either way. */
    top = Math.max(MARGIN, Math.min(top, window.innerHeight - th - MARGIN));

    el.style.left = left + 'px';
    el.style.top = top + 'px';
    el.classList.toggle('tooltip-above', showAbove);
  }

  function showTooltip(target, text) {
    if (currentEl !== target) return; /* hovered off before the delay elapsed */
    var el = ensureTooltipEl();
    el.textContent = text;
    el.classList.add('visible');
    /* Two-step: the element must be in the DOM and have its final text
       before measuring for position (offsetWidth needs real layout). */
    positionTooltip(target, el);
  }

  function hideTooltip() {
    if (tooltipEl) tooltipEl.classList.remove('visible');
  }

  function clearPending() {
    if (showTimer) { clearTimeout(showTimer); showTimer = null; }
  }

  function restoreTitle(el) {
    if (el && el.dataset && el.dataset.tooltipText !== undefined) {
      el.setAttribute('title', el.dataset.tooltipText);
      delete el.dataset.tooltipText;
    }
  }

  function onMouseOver(e) {
    var target = findTitledAncestor(e.target);
    if (target === currentEl) return; /* already the active tooltip target */

    if (currentEl) restoreTitle(currentEl);
    clearPending();
    hideTooltip();
    currentEl = target;
    if (!target) return;

    var text = target.getAttribute('title');
    /* Stash under a different key so the native tooltip never shows
       even for the SHOW_DELAY window before the custom one appears —
       removing the attribute immediately is what actually suppresses
       it; restoring happens on mouseout/dismiss below. */
    target.dataset.tooltipText = text;
    target.removeAttribute('title');

    showTimer = setTimeout(function() {
      showTooltip(target, text);
    }, SHOW_DELAY);
  }

  function onMouseOut(e) {
    if (!currentEl) return;
    var to = e.relatedTarget;
    /* Moving to a DESCENDANT of the same titled element (e.g. between
       an icon and its own text label inside one button) isn't really
       leaving it — only actually leaving the element's own subtree
       counts. */
    if (to && currentEl.contains(to)) return;
    restoreTitle(currentEl);
    currentEl = null;
    clearPending();
    hideTooltip();
  }

  /* A click (drag start, button press, anything) dismisses immediately
     — matches how a native tooltip also disappears the instant you
     interact rather than lingering over whatever just happened. */
  function onMouseDown() {
    clearPending();
    hideTooltip();
  }

  function init() {
    document.addEventListener('mouseover', onMouseOver, true);
    document.addEventListener('mouseout', onMouseOut, true);
    document.addEventListener('mousedown', onMouseDown, true);
    /* Panning/zooming the canvas or scrolling a list moves whatever
       was under the cursor without firing a fresh mouseover — leaving
       a stale tooltip pointing at empty space. Wheel is the one
       interaction that reliably fires on both. */
    window.addEventListener('wheel', onMouseDown, { passive: true, capture: true });
    window.addEventListener('blur', onMouseDown);
  }

  return { init: init };

})();

if (typeof window !== 'undefined') { window.KanvazTooltip = KanvazTooltip; }
