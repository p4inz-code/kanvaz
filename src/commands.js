/* commands.js — command registry + Ctrl+K Command Palette (v4.3.0)

   KanvazCommands is the single registry both Kanvaz's own core actions
   and KanvazPluginAPI.registerCommand() (plugin-api.js) write into — a
   plugin command and a core command are indistinguishable once
   registered, which is what makes the palette list every one of them
   automatically instead of needing a plugin to build its own UI.

   The registry itself (registerCommand/getCommand/getAllCommands/
   getPaletteCommands/runCommand/fuzzyScore) touches no DOM global and
   is required directly by test/command-registry-test.js — real
   automated coverage of the validation and fuzzy-match logic, not just
   a manual smoke test. Only the palette UI functions below it
   (openPalette/closePalette/render...) touch `document`, and those are
   never called from that test.

   `shortcut` on a registered command is a DISPLAY hint only — shown
   next to the label in the palette, exactly like the existing
   `shortcut` field on card context-menu items (see ui.js's
   showCardContextMenu). The actual key handling for Kanvaz's own core
   commands still lives in shortcuts.js's keydown dispatcher, unchanged;
   registerCoreCommands() below calls the exact same functions that
   dispatcher already calls. Two independent bindings pointing at the
   same action, not a rebinding of one into the other — deliberately
   the lower-risk shape for this pass, not an oversight. */

var KanvazCommands = (function() {

  var commands = {};   /* id -> { id, label, run, shortcut, showInPalette, contextMenu } */

  function registerCommand(id, def) {
    if (!id || typeof id !== 'string') {
      console.error('[Kanvaz] registerCommand requires a string id');
      return false;
    }
    if (!def || typeof def.run !== 'function' || !def.label) {
      console.error('[Kanvaz] registerCommand("' + id + '") requires { label, run(context) }');
      return false;
    }
    if (commands[id]) {
      console.warn('[Kanvaz] command "' + id + '" was already registered — overwriting');
    }
    commands[id] = {
      id: id,
      label: def.label,
      run: def.run,
      shortcut: def.shortcut || null,
      showInPalette: def.showInPalette !== false,
      contextMenu: def.contextMenu || null
    };
    return true;
  }

  function getCommand(id) {
    return commands[id] || null;
  }

  function getAllCommands() {
    return Object.keys(commands).map(function(id) { return commands[id]; });
  }

  function getPaletteCommands() {
    return getAllCommands().filter(function(c) { return c.showInPalette; });
  }

  function runCommand(id, context) {
    var cmd = commands[id];
    if (!cmd) return false;
    try {
      cmd.run(context || {});
    } catch (e) {
      console.error('[Kanvaz] command "' + id + '" threw:', e.message);
    }
    return true;
  }

  /* ── Fuzzy match — simple ordered-subsequence scorer, zero dependency.
     Every character of `query` must appear in `text` in order (not
     necessarily contiguous) — same relaxed matching VS Code's palette
     uses. Returns null on no match, otherwise a score where lower is a
     tighter match (gaps between matched characters cost 1 each), so
     "cmd" beats "create media document" for query "cmd" even though
     both match. */
  function fuzzyScore(query, text) {
    if (!query) return 0;
    if (!text) return null;
    var q = query.toLowerCase();
    var t = text.toLowerCase();
    var qi = 0, ti = 0, score = 0, lastMatch = -1;
    while (qi < q.length && ti < t.length) {
      if (q.charAt(qi) === t.charAt(ti)) {
        if (lastMatch !== -1) score += (ti - lastMatch - 1);
        lastMatch = ti;
        qi++;
      }
      ti++;
    }
    if (qi < q.length) return null;
    /* Slight bias toward matches starting near the beginning of the
       label — "Save Board" for query "sa" should beat "Reset Size". */
    return score + t.indexOf(q.charAt(0));
  }

  /* ── Core commands — dogfooding: every one of these calls the exact
     same function shortcuts.js's keydown handler already calls for the
     matching key. Registered once at init() so the palette is useful
     from the very first Ctrl+K, not just for plugin-registered ones. */
  function registerCoreCommands() {
    registerCommand('core.saveBoard', {
      label: 'Save Board', shortcut: 'Ctrl+S',
      run: function() { if (typeof KanvazBoards !== 'undefined') KanvazBoards.saveBoard(); }
    });
    registerCommand('core.saveBoardAs', {
      label: 'Save Board As…', shortcut: 'Ctrl+Shift+S',
      run: function() { if (typeof KanvazBoards !== 'undefined') KanvazBoards.saveBoardAs(); }
    });
    registerCommand('core.openBoard', {
      label: 'Open Board…', shortcut: 'Ctrl+O',
      run: function() { if (typeof KanvazBoards !== 'undefined') KanvazBoards.openBoard(); }
    });
    registerCommand('core.newBoard', {
      label: 'New Board',
      run: function() { if (typeof KanvazBoards !== 'undefined') KanvazBoards.newBoard(false); }
    });
    registerCommand('core.searchCards', {
      label: 'Search Cards', shortcut: 'Ctrl+F',
      run: function() { if (typeof KanvazUI !== 'undefined') KanvazUI.showSearchBar(); }
    });
    registerCommand('core.undo', {
      label: 'Undo', shortcut: 'Ctrl+Z',
      run: function() { if (typeof KanvazHistory !== 'undefined') KanvazHistory.undo(); }
    });
    registerCommand('core.redo', {
      label: 'Redo', shortcut: 'Ctrl+Y',
      run: function() { if (typeof KanvazHistory !== 'undefined') KanvazHistory.redo(); }
    });
    registerCommand('core.selectAll', {
      label: 'Select All Cards', shortcut: 'Ctrl+A',
      run: function() { if (typeof KanvazCards !== 'undefined') KanvazCards.selectAll(); }
    });
    registerCommand('core.deselectAll', {
      label: 'Deselect All', shortcut: 'Esc',
      run: function() { if (typeof KanvazCards !== 'undefined') KanvazCards.deselectAll(); }
    });
    registerCommand('core.deleteSelected', {
      label: 'Delete Selected Card(s)', shortcut: 'Delete',
      run: function() { if (typeof KanvazCards !== 'undefined') KanvazCards.deleteSelected(); }
    });
    registerCommand('core.duplicateSelected', {
      label: 'Duplicate Selected Card(s)', shortcut: 'Ctrl+D',
      run: function() { if (typeof KanvazCards !== 'undefined') KanvazCards.duplicateSelected(); }
    });
    registerCommand('core.togglePinSelected', {
      label: 'Toggle Pin on Selected Card(s)', shortcut: 'P',
      run: function() { if (typeof KanvazCards !== 'undefined') KanvazCards.togglePinSelected(); }
    });
    registerCommand('core.openConnections', {
      label: 'Open Connections (Selected Card)', shortcut: 'C',
      run: function() {
        var sel = typeof KanvazCards !== 'undefined' ? KanvazCards.getSelected() : null;
        if (!sel) { if (typeof KanvazUI !== 'undefined') KanvazUI.toast('Select a card first'); return; }
        if (typeof KanvazInspector !== 'undefined') KanvazInspector.open(sel);
      }
    });
    registerCommand('core.openProperties', {
      label: 'Open Properties (Selected Card)', shortcut: 'E',
      run: function() {
        var sel = typeof KanvazCards !== 'undefined' ? KanvazCards.getSelected() : null;
        if (!sel) { if (typeof KanvazUI !== 'undefined') KanvazUI.toast('Select a card first'); return; }
        if (typeof KanvazProperties !== 'undefined') KanvazProperties.open(sel);
      }
    });
    registerCommand('core.zoomIn', {
      label: 'Zoom In', shortcut: '+',
      run: function() { if (typeof KanvazCanvas !== 'undefined') KanvazCanvas.zoomIn(); }
    });
    registerCommand('core.zoomOut', {
      label: 'Zoom Out', shortcut: '-',
      run: function() { if (typeof KanvazCanvas !== 'undefined') KanvazCanvas.zoomOut(); }
    });
    registerCommand('core.zoomReset', {
      label: 'Reset Zoom', shortcut: '0',
      run: function() { if (typeof KanvazCanvas !== 'undefined') KanvazCanvas.zoomReset(); }
    });
    registerCommand('core.zoomFit', {
      label: 'Zoom to Fit', shortcut: 'F',
      run: function() { if (typeof KanvazCanvas !== 'undefined') KanvazCanvas.zoomFit(); }
    });
    /* No dedicated key binding (4.9.0) — 'F'/'Shift+F' already both
       resolve to Zoom to Fit above (a keydown handler matching e.key
       against both cases), and every other easy modifier combo is
       already claimed elsewhere. Command Palette + context menu (see
       app.js) are enough surface for something used this occasionally. */
    registerCommand('core.zoomToSelection', {
      label: 'Zoom to Selection',
      run: function() { if (typeof KanvazCanvas !== 'undefined') KanvazCanvas.zoomToSelection(); }
    });
    registerCommand('core.toggleMapView', {
      label: 'Toggle Map View', shortcut: 'M',
      run: function() { if (typeof KanvazMapView !== 'undefined') KanvazMapView.toggle(); }
    });
    registerCommand('core.toggleClickThrough', {
      label: 'Toggle Click-through (Reference Mode)', shortcut: 'T',
      run: function() { if (typeof KanvazApp !== 'undefined') KanvazApp.toggleClickThrough(); }
    });
    registerCommand('core.toggleTheme', {
      label: 'Toggle Theme (Dark/Light)', shortcut: 'L',
      run: function() {
        if (typeof KanvazUI_Extended === 'undefined') return;
        var s = KanvazUI_Extended.getSettings();
        if (!s) return;
        var nextTheme = s.theme === 'light' ? 'dark' : 'light';
        if (typeof KanvazUI_Extended.setTheme === 'function') {
          KanvazUI_Extended.setTheme(nextTheme);
        } else {
          s.theme = nextTheme;
          document.documentElement.setAttribute('data-theme', nextTheme);
          KanvazBridge.writeSettings(JSON.stringify(s));
        }
        if (typeof KanvazCanvas !== 'undefined') KanvazCanvas.drawGrid();
        if (typeof KanvazUI !== 'undefined') KanvazUI.toast('Theme: ' + nextTheme);
      }
    });
    /* v6.0.0: on by default now (see ui.js's SETTINGS_DEFAULTS) — no
       longer gets a dedicated key (that's Toggle Click-through's now,
       above), just Command Palette + the Settings checkbox for the
       minority of people who want it off. */
    registerCommand('core.toggleAlwaysOnTop', {
      label: 'Toggle Always on Top',
      run: function() { if (typeof KanvazApp !== 'undefined') KanvazApp.toggleAlwaysOnTop(); }
    });
    registerCommand('core.openSettings', {
      label: 'Open Settings', shortcut: 'S',
      run: function() { if (typeof KanvazUI_Extended !== 'undefined') KanvazUI_Extended.showSettings(); }
    });
    registerCommand('core.openAbout', {
      label: 'About Kanvaz', shortcut: 'I',
      run: function() { if (typeof KanvazUI_Extended !== 'undefined') KanvazUI_Extended.showAbout(); }
    });
    registerCommand('core.showShortcuts', {
      label: 'Show Keyboard Shortcuts', shortcut: '?',
      run: function() { if (typeof KanvazUI !== 'undefined') KanvazUI.showShortcuts(); }
    });
  }

  /* ══════════════════════════════════════════════════════════════
     Command Palette UI — Ctrl+K. Built lazily on first open(), same
     pattern as the search bar / opacity picker (app.js, cards.js):
     one detached DOM subtree, inline cssText, appended to <body> once
     and reused after that rather than rebuilt every open.
     ══════════════════════════════════════════════════════════════ */

  var overlay = null, inputEl = null, listEl = null;
  var filtered = [];
  var selectedIndex = 0;
  var paletteOpen = false;

  function rowStyle(isSelected) {
    return [
      'display:flex', 'align-items:center', 'justify-content:space-between',
      'gap:12px', 'padding:8px 12px', 'border-radius:var(--radius-md)',
      'cursor:pointer', 'font-size:13px',
      'color:' + (isSelected ? 'var(--color-text)' : 'var(--color-text-2)'),
      'background:' + (isSelected ? 'var(--color-surface-2)' : 'transparent')
    ].join(';');
  }

  function buildDom() {
    if (overlay) return;

    overlay = document.createElement('div');
    overlay.id = 'command-palette-overlay';
    overlay.style.cssText = [
      'position:fixed', 'inset:0', 'background:var(--color-overlay)',
      'z-index:60000', 'display:none', 'align-items:flex-start',
      'justify-content:center', 'padding-top:15vh'
    ].join(';');
    overlay.onclick = function(e) { if (e.target === overlay) closePalette(); };

    var panel = document.createElement('div');
    panel.style.cssText = [
      'width:480px', 'max-width:90vw', 'max-height:60vh',
      'background:var(--color-surface)', 'border:1px solid var(--color-border-2)',
      'border-radius:var(--radius-lg)', 'box-shadow:0 16px 48px var(--color-shadow)',
      'display:flex', 'flex-direction:column', 'overflow:hidden',
      'animation:about-card-in 0.15s cubic-bezier(0.16,1,0.3,1)'
    ].join(';');
    panel.onclick = function(e) { e.stopPropagation(); };

    var inputRow = document.createElement('div');
    inputRow.style.cssText = 'padding:12px 14px;border-bottom:1px solid var(--color-border-2);flex-shrink:0;';

    inputEl = document.createElement('input');
    inputEl.type = 'text';
    inputEl.placeholder = 'Type a command…';
    inputEl.style.cssText = [
      'width:100%', 'background:transparent', 'border:none', 'outline:none',
      'color:var(--color-text)', 'font-family:var(--font-ui)', 'font-size:14px'
    ].join(';');
    inputRow.appendChild(inputEl);

    listEl = document.createElement('div');
    listEl.style.cssText = 'overflow-y:auto;padding:6px;flex:1;';

    panel.appendChild(inputRow);
    panel.appendChild(listEl);
    overlay.appendChild(panel);
    document.body.appendChild(overlay);

    inputEl.addEventListener('input', render);
    inputEl.addEventListener('keydown', function(e) {
      /* Stop propagation so the global KanvazShortcuts keydown handler
         never also sees these keys — without this, typing "a" to filter
         for "Select All" would ALSO trigger the a/A annotate shortcut
         underneath the palette. */
      e.stopPropagation();
      if (e.key === 'Escape') { closePalette(); return; }
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        if (filtered.length) { selectedIndex = (selectedIndex + 1) % filtered.length; renderList(); }
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        if (filtered.length) { selectedIndex = (selectedIndex - 1 + filtered.length) % filtered.length; renderList(); }
        return;
      }
      if (e.key === 'Enter') { e.preventDefault(); execSelected(); return; }
    });
  }

  function render() {
    var query = inputEl.value.trim();
    var all = getPaletteCommands();
    if (!query) {
      filtered = all.slice().sort(function(a, b) { return a.label.localeCompare(b.label); });
    } else {
      var scored = [];
      for (var i = 0; i < all.length; i++) {
        var s = fuzzyScore(query, all[i].label);
        if (s !== null) scored.push({ cmd: all[i], score: s });
      }
      scored.sort(function(a, b) { return a.score - b.score; });
      filtered = scored.map(function(x) { return x.cmd; });
    }
    selectedIndex = 0;
    renderList();
  }

  function renderList() {
    listEl.innerHTML = '';
    if (!filtered.length) {
      var empty = document.createElement('div');
      empty.textContent = 'No matching commands';
      empty.style.cssText = 'padding:20px;text-align:center;color:var(--color-text-3);font-size:12px;';
      listEl.appendChild(empty);
      return;
    }
    for (var i = 0; i < filtered.length; i++) {
      (function(cmd, idx) {
        var row = document.createElement('div');
        row.style.cssText = rowStyle(idx === selectedIndex);

        var label = document.createElement('span');
        label.textContent = cmd.label;
        label.style.cssText = 'overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
        row.appendChild(label);

        if (cmd.shortcut) {
          var sc = document.createElement('span');
          sc.textContent = cmd.shortcut;
          sc.style.cssText = 'font-family:var(--font-mono);font-size:11px;color:var(--color-text-3);flex-shrink:0;';
          row.appendChild(sc);
        }

        row.addEventListener('mouseenter', function() {
          selectedIndex = idx;
          renderList();
        });
        row.addEventListener('click', function() { execSelected(); });

        listEl.appendChild(row);
      })(filtered[i], i);
    }
    var selEl = listEl.children[selectedIndex];
    if (selEl && selEl.scrollIntoView) selEl.scrollIntoView({ block: 'nearest' });
  }

  function execSelected() {
    var cmd = filtered[selectedIndex];
    closePalette();
    if (cmd) runCommand(cmd.id, {});
  }

  function openPalette() {
    buildDom();
    paletteOpen = true;
    overlay.style.display = 'flex';
    inputEl.value = '';
    render();
    setTimeout(function() { inputEl.focus(); }, 0);
  }

  function closePalette() {
    if (overlay) overlay.style.display = 'none';
    paletteOpen = false;
  }

  function togglePalette() {
    if (paletteOpen) closePalette();
    else openPalette();
  }

  function init() {
    registerCoreCommands();
  }

  return {
    init: init,
    registerCommand: registerCommand,
    getCommand: getCommand,
    getAllCommands: getAllCommands,
    getPaletteCommands: getPaletteCommands,
    runCommand: runCommand,
    fuzzyScore: fuzzyScore,
    openPalette: openPalette,
    closePalette: closePalette,
    togglePalette: togglePalette,
    isPaletteOpen: function() { return paletteOpen; }
  };

})();

/* Dual export: a real <script> tag in Kanvaz itself (window global) vs.
   a plain `require()` from test/command-registry-test.js (CommonJS) —
   same guarded pattern as src/board-container.js and src/plugin-
   loader.js use for their own Node-testable modules. Nothing above this
   point touches `window`/`document` except inside function bodies that
   the Node test never calls, so requiring this file is safe. */
if (typeof window !== 'undefined') { window.KanvazCommands = KanvazCommands; }
if (typeof module !== 'undefined' && module.exports) { module.exports = KanvazCommands; }
