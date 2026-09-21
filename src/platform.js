/* platform.js — which OS the renderer is running on, and how to WORD a
   keyboard shortcut for it.

   The key handling itself was already right on every platform (shortcuts.js
   treats Ctrl and Cmd alike); what was Windows-only was what the app SAYS:
   tooltips, the shortcuts overlay and the command palette all wrote "Ctrl".
   This is the one place that decides the wording:

     Windows / Linux   unchanged: Ctrl+Shift+S
     macOS             the Apple notation: ⇧⌘S   (modifiers in the order ⌃ ⌥ ⇧ ⌘,
                       then the key, nothing between them)
                       A description rather than a real shortcut keeps its
                       words: "Ctrl + drag" becomes "⌘ drag".

   It also sets a class on <html> (platform-mac / platform-win / platform-linux)
   so CSS can adapt the window chrome (macOS gets native traffic lights).

   ES5/var-only. Usable in Node for the test (module.exports). */

var KanvazPlatform = (function() {

  function detect(platformString, userAgent) {
    var p = String(platformString || ''), ua = String(userAgent || '');
    if (/Mac/i.test(p) || /Macintosh|Mac OS X/i.test(ua)) return 'mac';
    if (/Win/i.test(p) || /Windows/i.test(ua)) return 'win';
    if (/Linux|X11|CrOS/i.test(p + ' ' + ua)) return 'linux';
    return 'win';
  }

  var MODS = { ctrl: 'Ctrl', control: 'Ctrl', cmd: 'Ctrl', command: 'Ctrl', alt: 'Alt', option: 'Alt', shift: 'Shift' };
  var SYMBOL = { Ctrl: '⌘', Alt: '⌥', Shift: '⇧' };        /* ⌘ ⌥ ⇧ */
  var ORDER = ['Alt', 'Shift', 'Ctrl'];                                    /* ⌥ ⇧ ⌘ (⌃ is unused by this app) */
  var NAMED_KEYS = { enter: '↩', return: '↩', delete: '⌫', backspace: '⌫', esc: '⎋', escape: '⎋', tab: '⇥', space: 'Space' };

  /* One shortcut-looking run: one or more modifiers, then a final token. */
  var RUN = /\b((?:Ctrl|Control|Cmd|Command|Alt|Option|Shift)(?:\s*\+\s*(?:Ctrl|Control|Cmd|Command|Alt|Option|Shift))*)\s*\+\s*([A-Za-z0-9]+(?:\.\.[A-Za-z0-9]+)?|[,.\/\[\]=\-])/g;

  function convertRun(mods, last) {
    var seen = {};
    var parts = mods.split('+');
    for (var pi = 0; pi < parts.length; pi++) {
      var k = MODS[parts[pi].trim().toLowerCase()];
      if (k) seen[k] = true;
    }
    var symbols = '';
    for (var i = 0; i < ORDER.length; i++) if (seen[ORDER[i]]) symbols += SYMBOL[ORDER[i]];
    var lower = last.toLowerCase();
    if (NAMED_KEYS[lower]) return symbols + NAMED_KEYS[lower];
    /* a single key (or a key range like 1..9) is a real shortcut; a longer
       lowercase word (drag, click, scroll, wheel) is a description */
    if (/^[A-Za-z0-9]$/.test(last) || /\.\./.test(last) || /^[,.\/\[\]=\-]$/.test(last)) return symbols + last.toUpperCase();
    return symbols + ' ' + last;
  }

  /* Rewrites every shortcut in a string for macOS. Text with no shortcut in
     it is returned as it came. */
  function macifyText(text) {
    var s = String(text);
    s = s.replace(RUN, function(all, mods, last) { return convertRun(mods, last); });
    /* a stray modifier word left over ("hold Ctrl", "Alt-drag") */
    return s.replace(/\bCtrl\b/g, SYMBOL.Ctrl).replace(/\bAlt\b/g, SYMBOL.Alt).replace(/\bShift\b/g, SYMBOL.Shift);
  }

  var current = 'win';
  try { current = detect(typeof navigator !== 'undefined' ? navigator.platform : '', typeof navigator !== 'undefined' ? navigator.userAgent : ''); } catch (e) { /* keep default */ }

  function label(text) { return current === 'mac' ? macifyText(text) : text; }

  function applyClass() {
    try {
      if (typeof document !== 'undefined' && document.documentElement) {
        document.documentElement.classList.add('platform-' + current);
      }
    } catch (e) { /* no DOM (Node test) */ }
  }
  applyClass();

  return {
    detect: detect,
    macifyText: macifyText,
    label: label,
    isMac: function() { return current === 'mac'; },
    isWindows: function() { return current === 'win'; },
    isLinux: function() { return current === 'linux'; },
    current: function() { return current; }
  };

})();

if (typeof module !== 'undefined' && module.exports) { module.exports = KanvazPlatform; }
