/* shortcuts.js — keyboard shortcut dispatcher */

var KanvazShortcuts = (function() {

  function init() {
    document.addEventListener('keydown', function(e) {
      handle(e);
    });
  }

  /* Input types that don't accept free-text typing — a checkbox, color
     swatch, or range slider being focused shouldn't suppress single-key
     shortcuts (T, 0, L, etc.) the way an actual text field should. */
  var NON_TEXT_INPUT_TYPES = ['checkbox', 'radio', 'range', 'color', 'button', 'submit', 'reset', 'file', 'image'];

  function handle(e) {
    var activeEl = document.activeElement;
    var tag      = activeEl && activeEl.tagName;
    var isTextInput = tag === 'INPUT' && NON_TEXT_INPUT_TYPES.indexOf(activeEl.type) === -1;
    /* Audit fix: a focused <select> (e.g. the Theme or Snap-increment
       dropdown in Settings) wasn't covered here. The canvas can still
       have a card selected while Settings is open, so pressing
       ArrowUp/ArrowDown intending to cycle the dropdown's options fell
       through to the arrow-key nudge branch below instead — which calls
       e.preventDefault(), silently nudging the (possibly hidden-behind-
       the-panel) selected card instead of changing the dropdown value.
       Every other global single-key shortcut below this point already
       intentionally skips while inText is true (e.g. so "t" typed into
       a note doesn't toggle Always-on-Top); a focused select belongs in
       that same category. */
    var inText   = (tag === 'TEXTAREA' || isTextInput || tag === 'SELECT');
    var ctrl     = e.ctrlKey || e.metaKey;
    var shift    = e.shiftKey;
    /* Audit fix: every ctrl-combo check below used to compare e.key
       directly against a hardcoded case ('s' for plain Ctrl+S, 'S' for
       Ctrl+Shift+S), assuming Shift-off implies lowercase. That's false
       under Caps Lock — the browser reports e.key as uppercase while
       e.shiftKey stays false. Concretely, with Caps Lock on: Ctrl+S
       (save) failed to match, fell through, and was caught by the
       unconditional lowercase/uppercase 's'/'S' check further down that
       opens Settings instead — no save happened, no error shown.
       Ctrl+A (Select All) similarly fell through into the 'a'/'A'
       annotate-mode shortcut. Comparing against a lowercased key and
       relying solely on the real e.shiftKey/ctrl booleans for modifier
       state (never on the letter's case) is Caps-Lock-independent. */
    var keyLower = (e.key || '').toLowerCase();

    /* Ignore OS key-repeat (holding a key down) for everything except
       arrow-key nudge. Without this, holding Ctrl+D creates several
       duplicates, holding P toggles pin on/off rapidly (stacked "Card
       pinned"/"Card unpinned" toasts), holding Ctrl+S writes the file
       repeatedly, etc. Arrow keys are the one case where holding-to-
       repeat is the expected UX (continuous nudge). */
    if (e.repeat
        && e.key !== 'ArrowLeft' && e.key !== 'ArrowRight'
        && e.key !== 'ArrowUp'   && e.key !== 'ArrowDown') {
      return;
    }

    /* Presentation Mode (app.js) is deliberately read-only. Placed here,
       before even the "always fire" section below, rather than as a
       check threaded through Undo/Redo/Save/every individual per-card
       shortcut further down this ~400-line dispatcher — a single
       allowlist (Escape to exit, Left/Right to step between cards) is
       far easier to audit and trust than trying to enumerate every
       mutating shortcut in this file and remembering to gate each one.
       Blocking Ctrl+S/Ctrl+O/Undo/Redo/M/zoom too while presenting is a
       deliberate, acceptable trade-off, not an oversight — none of them
       are needed mid-presentation, and Escape always gets you back to
       normal editing in one keypress if one of them is genuinely
       wanted. */
    if (typeof KanvazApp !== 'undefined' && KanvazApp.isPresentationModeActive && KanvazApp.isPresentationModeActive()) {
      if (e.key === 'Escape')    { KanvazApp.togglePresentationMode(); return; }
      if (e.key === 'ArrowLeft')  { e.preventDefault(); KanvazApp.presentationStep(-1); return; }
      if (e.key === 'ArrowRight') { e.preventDefault(); KanvazApp.presentationStep(1);  return; }
      return;
    }

    /* ── Always fire regardless of focus ── */

    if (ctrl && shift && keyLower === 's') {
      e.preventDefault();
      KanvazBoards.saveBoardAs();
      return;
    }

    if (ctrl && !shift && keyLower === 's') {
      e.preventDefault();
      KanvazBoards.saveBoard();
      return;
    }

    if (ctrl && !shift && keyLower === 'o') {
      e.preventDefault();
      KanvazBoards.openBoard();
      return;
    }

    if (ctrl && !shift && keyLower === 'f') {
      e.preventDefault();
      /* Audit fix (4.7.0): this used to fire unconditionally — pressing
         Ctrl+F while Map View was open opened Board View's own search
         overlay instead, which operates on .card elements sitting
         behind Map View's fullscreen container, invisible and useless
         until you closed Map View to see it. Route to whichever view
         is actually on screen. */
      if (typeof KanvazMapView !== 'undefined' && KanvazMapView.isActive()) {
        KanvazMapView.showSearchBar();
      } else {
        KanvazUI.showSearchBar();
      }
      return;
    }

    /* Command Palette — Ctrl+K, unclaimed in Kanvaz today (see
       ROADMAP.md's v4.3.0 section for why Ctrl+K over Ctrl+Shift+P).
       "Always fire" like Save/Open/Search above it: a palette should be
       reachable even while a text field is focused. The palette's own
       input traps its keydown events (see commands.js) so this can't
       double-fire once it's open. */
    if (ctrl && !shift && keyLower === 'k') {
      e.preventDefault();
      if (typeof KanvazCommands !== 'undefined') KanvazCommands.togglePalette();
      return;
    }

    /* Direct feedback: "keep one shortcut other than [the logo click] to
       go and come back to home and canvas, like h or whatever feels
       easy" — plain H is already Toggle Annotation Visibility (below),
       so Ctrl+H (unclaimed, no native textarea meaning to fight) is the
       Home Screen toggle instead. "Always fire" like Ctrl+K just above:
       reachable even mid-typing in a note, same as any other view
       switch. toggleHomeScreen() (not showHomeScreen()) so pressing it
       again while already on the Home Screen goes back to the board
       instead of stacking a second overlay. */
    if (ctrl && !shift && keyLower === 'h') {
      e.preventDefault();
      if (typeof KanvazBoards !== 'undefined' && KanvazBoards.toggleHomeScreen) KanvazBoards.toggleHomeScreen();
      return;
    }

    /* Top Mode toggle — Ctrl+Shift+T, unclaimed by anything else here
       (bare 'a' is already Annotate, so this reintroduction deliberately
       doesn't reuse it). No native textarea meaning to fight, same as
       Ctrl+S/Ctrl+Shift+S/Ctrl+O/Ctrl+F/Ctrl+H above — "always fire" so
       it's reachable even mid-typing in a note, same reasoning as Ctrl+H
       just above it. Works in both Board and Map view. */
    if (ctrl && shift && keyLower === 't') {
      e.preventDefault();
      if (typeof KanvazApp !== 'undefined' && KanvazApp.toggleTopMode) KanvazApp.toggleTopMode();
      return;
    }

    /* ── Skip text inputs below this line ──
       Ctrl+Z/Ctrl+Y/Ctrl+Shift+Z/Ctrl+A have native meanings inside a
       textarea (undo typing, redo, select all text) — they must NOT be
       hijacked into board-level undo/redo/select-all while the user is
       typing in a note. Ctrl+S/Ctrl+Shift+S/Ctrl+O/Ctrl+F have no
       native textarea meaning, so those stay above as "always fire". */
    if (inText) return;

    /* Quick search — / is the vim/Blender convention for instant search */
    if (e.key === '/') {
      e.preventDefault();
      if (typeof KanvazMapView !== 'undefined' && KanvazMapView.isActive()) {
        KanvazMapView.showSearchBar();
      } else {
        KanvazUI.showSearchBar();
      }
      return;
    }

    if (ctrl && !shift && keyLower === 'z') {
      e.preventDefault();
      KanvazHistory.undo();
      return;
    }

    if ((ctrl && !shift && keyLower === 'y') || (ctrl && shift && keyLower === 'z')) {
      e.preventDefault();
      KanvazHistory.redo();
      return;
    }

    if (ctrl && !shift && keyLower === 'a') {
      e.preventDefault();
      KanvazCards.selectAll();
      return;
    }

    /* Group / Ungroup — standard Illustrator/Figma bindings. Group
       needs 2+ selected (a "group" of one is meaningless); Ungroup acts
       on whatever group(s) the current selection touches. */
    if (ctrl && !shift && keyLower === 'g') {
      e.preventDefault();
      KanvazCards.groupCards(KanvazCards.getSelectedIds());
      return;
    }
    if (ctrl && shift && keyLower === 'g') {
      e.preventDefault();
      KanvazCards.ungroupCards(KanvazCards.getSelectedIds());
      return;
    }

    /* Theme toggle — works in both views. Binary dark/light toggle, same
       as before (a plugin theme still collapses to 'light' on press —
       cycling through every registered theme is a possible future
       enhancement, not attempted here). */
    if (e.key === 'l' || e.key === 'L') {
      if (typeof KanvazUI_Extended !== 'undefined') {
        var s = KanvazUI_Extended.getSettings();
        if (s) {
          var nextTheme = s.theme === 'light' ? 'dark' : 'light';
          /* Audit fix: this used to set data-theme directly, bypassing
             KanvazPluginAPI._applyTheme() — the path applySettings()
             (ui.js) correctly uses for the Settings dropdown. Setting
             the attribute directly meant any previously-injected
             <style data-plugin-theme> element from a plugin theme was
             never removed, just left inert in <head>. Going through
             KanvazUI_Extended.setTheme() persists AND applies through
             that same correct path — it internally calls
             KanvazPluginAPI._applyTheme(), which cleans up any stale
             plugin theme <style> tag before setting data-theme. */
          if (typeof KanvazUI_Extended.setTheme === 'function') {
            KanvazUI_Extended.setTheme(nextTheme);
          } else {
            s.theme = nextTheme;
            document.documentElement.setAttribute('data-theme', nextTheme);
            KanvazBridge.writeSettings(JSON.stringify(s));
          }
          KanvazCanvas.drawGrid();
          KanvazUI.toast('Theme: ' + nextTheme);
        }
      }
      return;
    }

    /* Help — works in both views */
    if (e.key === '?') { KanvazUI.showShortcuts(); return; }

    /* v7.x redesign — S toggles the whole left side panel (Boards/
       Properties/Settings), not just a floating Settings popover
       anymore. Opens to the Settings section specifically the first
       time (matches the historical S-key meaning); after that it
       remembers whichever section was last active. */
    if (e.key === 's' || e.key === 'S') {
      if (typeof KanvazSidePanel !== 'undefined') KanvazSidePanel.toggle('settings');
      return;
    }

    /* About — toggle open/close */
    if (!shift && (e.key === 'i' || e.key === 'I')) {
      if (typeof KanvazUI_Extended !== 'undefined') KanvazUI_Extended.showAbout();
      return;
    }

    /* Isolate View — Shift+I, Maya's own binding for the same feature.
       Hides every card not currently selected; toggling again (or
       Escape, below) brings everything back. */
    if (shift && (e.key === 'i' || e.key === 'I')) {
      if (typeof KanvazCards !== 'undefined') KanvazCards.toggleIsolate();
      return;
    }

    /* Map view toggle */
    if (e.key === 'm' || e.key === 'M') {
      if (typeof KanvazMapView !== 'undefined') KanvazMapView.toggle();
      return;
    }

    /* Delegate to map view if active — blocks all board-specific
       shortcuts below (zoom, card operations, etc.) while map is shown */
    if (typeof KanvazMapView !== 'undefined' && KanvazMapView.isActive()) {
      KanvazMapView.handleKey(e);
      return;
    }

    /* Zoom (board canvas only — map view handles its own zoom) */
    if (e.key === '0') { e.preventDefault(); KanvazCanvas.zoomReset(); return; }
    if (e.key === '=' || e.key === '+') { e.preventDefault(); KanvazCanvas.zoomIn(); return; }
    if (e.key === '-' || e.key === '_') { e.preventDefault(); KanvazCanvas.zoomOut(); return; }
    if (!shift && (e.key === 'f' || e.key === 'F')) { e.preventDefault(); KanvazCanvas.zoomFit(); return; }
    /* Shift+F — Zoom to Selection. The command (core.zoomToSelection,
       KanvazCanvas.zoomToSelection) has existed since 4.9.0 and was
       reachable via the Command Palette, but never had a dedicated key
       — a real gap, not a stylistic one, on an app that otherwise binds
       every common view action. zoomToSelection() already falls back to
       fitting everything when nothing is selected, so this is safe with
       no selection too. */
    if (shift && (e.key === 'f' || e.key === 'F')) { e.preventDefault(); KanvazCanvas.zoomToSelection(); return; }

    /* View bookmarks — Ctrl+1..9 saves the current pan/zoom to a
       numbered slot, plain 1..9 jumps back to it. Maya/Photoshop-style,
       session-only (see canvas.js's saveViewBookmark comment for why).
       Digits 1-9 were completely unbound before this. */
    if (e.key >= '1' && e.key <= '9') {
      e.preventDefault();
      if (ctrl) KanvazCanvas.saveViewBookmark(e.key);
      else KanvazCanvas.recallViewBookmark(e.key);
      return;
    }

    /* Escape — deselect, close panels, exit Isolate View if active */
    if (e.key === 'Escape') {
      KanvazUI.closeAll();
      KanvazCards.deselectAll();
      if (typeof KanvazCards.isIsolateActive === 'function' && KanvazCards.isIsolateActive()) {
        KanvazCards.toggleIsolate();
      }
      return;
    }

    /* Card shortcuts — only if a card is selected */
    var sel = KanvazCards.getSelected();
    if (!sel) return;

    /* Bulk-capable operations act on the whole Select-All set when more
       than one card is selected (KanvazCards.*Selected() each collapse
       to the exact same single-card behavior as before when only one
       card is selected — see cards.js). Panel/overlay operations below
       (Annotate, Connections, Properties) stay single-target: opening
       many property panels at once has no sensible meaning, so those
       keep using `sel`, the one "primary" selected card. */

    if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      KanvazCards.deleteSelected();
      return;
    }

    if (ctrl && keyLower === 'd') {
      e.preventDefault();
      KanvazCards.duplicateSelected();
      return;
    }

    if (e.key === 'p' || e.key === 'P') {
      KanvazCards.togglePinSelected();
      return;
    }

    if (e.key === 'a' || e.key === 'A') {
      if (typeof KanvazAnnotate !== 'undefined') {
        var selCard = KanvazCards.getAll()[sel];
        /* Audit fix: this guard predates the 'url'/'file'/'text' card
           types and was never updated when they were added — the context
           menu's equivalent "Annotate" guard (app.js) already excludes
           all five non-visual types; this keyboard shortcut didn't,
           so pressing A on a URL/file-reference/text card would open
           the annotation overlay on something with no image/video to
           annotate. */
        if (selCard && selCard.type !== 'note' && selCard.type !== 'audio' && selCard.type !== 'color' && selCard.type !== 'url' && selCard.type !== 'file' && selCard.type !== 'text') {
          KanvazAnnotate.activate(sel);
        }
      }
      return;
    }

    if (e.key === 'h' || e.key === 'H') {
      if (typeof KanvazAnnotate !== 'undefined') {
        var hideIds = KanvazCards.getSelectedIds();
        for (var hi = 0; hi < hideIds.length; hi++) {
          KanvazAnnotate.toggleVisibility(hideIds[hi]);
        }
      }
      return;
    }

    if (e.key === 'c' || e.key === 'C') {
      if (typeof KanvazInspector !== 'undefined') {
        KanvazInspector.open(sel);
      }
      return;
    }

    if (e.key === 'e' || e.key === 'E') {
      if (typeof KanvazProperties !== 'undefined') {
        KanvazProperties.open(sel);
      }
      return;
    }

    /* Arrow nudge — nudge() already debounces its own history push
       (see cards.js), so looping it across a multi-selection here still
       results in exactly one undo step per burst of arrow presses. */
    var nudge = shift ? 10 : 1;
    var nudgeIds = KanvazCards.getSelectedIds();
    if (e.key === 'ArrowLeft') {
      e.preventDefault();
      for (var nl = 0; nl < nudgeIds.length; nl++) KanvazCards.nudge(nudgeIds[nl], -nudge, 0);
      return;
    }
    if (e.key === 'ArrowRight') {
      e.preventDefault();
      for (var nr = 0; nr < nudgeIds.length; nr++) KanvazCards.nudge(nudgeIds[nr], nudge, 0);
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      for (var nu = 0; nu < nudgeIds.length; nu++) KanvazCards.nudge(nudgeIds[nu], 0, -nudge);
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      for (var nd = 0; nd < nudgeIds.length; nd++) KanvazCards.nudge(nudgeIds[nd], 0, nudge);
      return;
    }
  }

  return { init: init };

})();
