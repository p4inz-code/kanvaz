/* shortcuts.js — keyboard shortcut dispatcher */

var KanvazShortcuts = (function() {

  function init() {
    document.addEventListener('keydown', function(e) {
      handle(e);
    });
  }

  function handle(e) {
    var tag    = document.activeElement && document.activeElement.tagName;
    var inText = (tag === 'TEXTAREA' || tag === 'INPUT');
    var ctrl   = e.ctrlKey || e.metaKey;
    var shift  = e.shiftKey;

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

    /* ── Always fire regardless of focus ── */

    if (ctrl && shift && e.key === 'S') {
      e.preventDefault();
      KanvazBoards.saveBoardAs();
      return;
    }

    if (ctrl && !shift && e.key === 's') {
      e.preventDefault();
      KanvazBoards.saveBoard();
      return;
    }

    if (ctrl && !shift && e.key === 'o') {
      e.preventDefault();
      KanvazBoards.openBoard();
      return;
    }

    if (ctrl && !shift && e.key === 'f') {
      e.preventDefault();
      KanvazUI.showSearchBar();
      return;
    }

    if (ctrl && shift && e.key === 'F') {
      e.preventDefault();
      KanvazUI.toggleMoodLock();
      return;
    }

    /* ── Skip text inputs below this line ──
       Ctrl+Z/Ctrl+Y/Ctrl+Shift+Z/Ctrl+A have native meanings inside a
       textarea (undo typing, redo, select all text) — they must NOT be
       hijacked into board-level undo/redo/select-all while the user is
       typing in a note. Ctrl+S/Ctrl+Shift+S/Ctrl+O/Ctrl+Shift+F/Ctrl+F
       have no native textarea meaning, so those stay above as "always
       fire". */
    if (inText) return;

    /* Quick search — / is the vim/Blender convention for instant search */
    if (e.key === '/') {
      e.preventDefault();
      KanvazUI.showSearchBar();
      return;
    }

    /* Top Mode — easier single-key trigger than Ctrl+Shift+F (kept
       above for backward compat/muscle memory). Tab has a native
       meaning inside text inputs (focus navigation), which is exactly
       why it's gated behind the inText check above rather than being
       an "always fire" shortcut. */
    if (e.key === 'Tab') {
      e.preventDefault();
      KanvazUI.toggleMoodLock();
      return;
    }

    if (ctrl && !shift && e.key === 'z') {
      e.preventDefault();
      KanvazHistory.undo();
      return;
    }

    if ((ctrl && !shift && e.key === 'y') || (ctrl && shift && e.key === 'Z')) {
      e.preventDefault();
      KanvazHistory.redo();
      return;
    }

    if (ctrl && !shift && e.key === 'a') {
      e.preventDefault();
      KanvazCards.selectAll();
      return;
    }

    /* Always on top — works in both views */
    if (e.key === 't' || e.key === 'T') { KanvazApp.toggleAlwaysOnTop(); return; }

    /* Theme toggle — works in both views */
    if (e.key === 'l' || e.key === 'L') {
      if (typeof KanvazUI_Extended !== 'undefined') {
        var s = KanvazUI_Extended.getSettings();
        if (s) {
          s.theme = s.theme === 'light' ? 'dark' : 'light';
          document.documentElement.setAttribute('data-theme', s.theme);
          KanvazBridge.writeSettings(JSON.stringify(s));
          KanvazCanvas.drawGrid();
          KanvazUI.toast('Theme: ' + s.theme);
        }
      }
      return;
    }

    /* Help — works in both views */
    if (e.key === '?') { KanvazUI.showShortcuts(); return; }

    /* Settings — toggle open/close */
    if (e.key === 's' || e.key === 'S') {
      if (typeof KanvazUI_Extended !== 'undefined') KanvazUI_Extended.showSettings();
      return;
    }

    /* About — toggle open/close */
    if (e.key === 'i' || e.key === 'I') {
      if (typeof KanvazUI_Extended !== 'undefined') KanvazUI_Extended.showAbout();
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
    if (e.key === 'f' || e.key === 'F') { e.preventDefault(); KanvazCanvas.zoomFit(); return; }

    /* Escape — deselect, close panels */
    if (e.key === 'Escape') {
      KanvazUI.closeAll();
      KanvazCards.deselectAll();
      return;
    }

    /* Card shortcuts — only if a card is selected */
    var sel = KanvazCards.getSelected();
    if (!sel) return;

    if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      KanvazCards.deleteCard(sel);
      return;
    }

    if (ctrl && e.key === 'd') {
      e.preventDefault();
      KanvazCards.duplicateCard(sel);
      return;
    }

    if (e.key === 'p' || e.key === 'P') {
      KanvazCards.togglePin(sel);
      return;
    }

    if (e.key === 'a' || e.key === 'A') {
      if (typeof KanvazAnnotate !== 'undefined') {
        var selCard = KanvazCards.getAll()[sel];
        if (selCard && selCard.type !== 'note' && selCard.type !== 'audio') {
          KanvazAnnotate.activate(sel);
        }
      }
      return;
    }

    if (e.key === 'h' || e.key === 'H') {
      if (typeof KanvazAnnotate !== 'undefined') {
        KanvazAnnotate.toggleVisibility(sel);
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

    /* Arrow nudge */
    var nudge = shift ? 10 : 1;
    if (e.key === 'ArrowLeft')  { e.preventDefault(); KanvazCards.nudge(sel, -nudge, 0); return; }
    if (e.key === 'ArrowRight') { e.preventDefault(); KanvazCards.nudge(sel,  nudge, 0); return; }
    if (e.key === 'ArrowUp')    { e.preventDefault(); KanvazCards.nudge(sel, 0, -nudge); return; }
    if (e.key === 'ArrowDown')  { e.preventDefault(); KanvazCards.nudge(sel, 0,  nudge); return; }
  }

  return { init: init };

})();
