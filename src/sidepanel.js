/* sidepanel.js — left side panel orchestrator (v7.x redesign)
 *
 * Replaces the old top board-tab strip and the floating Settings
 * popover with one unified panel: an always-visible icon rail
 * (Boards / Properties / Settings) plus a content pane that opens and
 * closes with the S key (or clicking a rail icon). See
 * docs/SIDE_PANEL_PLAN.md for the full architecture writeup.
 *
 * This module owns only the SHELL (rail active-state, open/closed
 * state, persistence, section dispatch) — each section's actual
 * content is rendered by the module that already owns that data:
 * boards.js (Boards), properties.js (Properties), ui.js (Settings).
 */

var KanvazSidePanel = (function() {

  var SECTIONS = ['boards', 'properties', 'settings'];

  var railEl     = null;
  var contentEl  = null;
  var isOpenFlag = false;
  var currentSection = 'boards';

  /* ── Persistence ── (same settings.json path every other preference
     in this app uses — see ui.js's SETTINGS_DEFAULTS comment on why
     this isn't localStorage) */

  function loadPersistedState() {
    if (typeof KanvazUI_Extended === 'undefined') return;
    var s = KanvazUI_Extended.getSettings();
    if (!s) return;
    isOpenFlag = !!s.sidePanelOpen;
    if (SECTIONS.indexOf(s.sidePanelSection) !== -1) currentSection = s.sidePanelSection;
  }

  /* Called from ui.js's applySettings() once the REAL settings.json
     contents have loaded (init() below runs before that async read
     resolves, so its own loadPersistedState() call only ever sees
     defaults) — re-syncs the rail/content DOM to whatever was actually
     persisted last session, without re-running the one-time rail
     button wiring in init(). A no-op past the very first settings load
     since isOpenFlag/currentSection won't have drifted from what's on
     disk in between (nothing else writes settings.json's copy of these
     two keys except this module itself). */
  function refreshPersistedState() {
    if (!railEl || !contentEl) return; /* init() hasn't run yet */
    loadPersistedState();
    updateRailActiveState();
    updateContentVisibility();
    if (isOpenFlag) renderCurrentSection();
  }

  function persistState() {
    if (typeof KanvazUI_Extended === 'undefined') return;
    var s = KanvazUI_Extended.getSettings();
    if (!s) return;
    s.sidePanelOpen = isOpenFlag;
    s.sidePanelSection = currentSection;
    if (KanvazUI_Extended.saveSettings) KanvazUI_Extended.saveSettings();
  }

  /* ── Rendering ── */

  function updateRailActiveState() {
    if (!railEl) return;
    var btns = railEl.querySelectorAll('.rail-btn');
    for (var i = 0; i < btns.length; i++) {
      btns[i].classList.toggle('active', btns[i].dataset.section === currentSection && isOpenFlag);
    }
  }

  function updateContentVisibility() {
    if (!contentEl) return;
    contentEl.classList.toggle('collapsed', !isOpenFlag);
  }

  /* Tears down whatever the PREVIOUS section left behind that needs
     explicit cleanup before a new one renders into the same container
     — right now just Settings' plugin-list identity guard (see ui.js's
     closeSettingsSection() for why this matters for an in-flight scan). */
  function teardownSection(name) {
    if (name === 'settings' && typeof KanvazUI_Extended !== 'undefined' && KanvazUI_Extended.closeSettingsSection) {
      KanvazUI_Extended.closeSettingsSection();
    }
  }

  function renderCurrentSection() {
    if (!contentEl) return;
    if (currentSection === 'boards') {
      if (typeof KanvazBoards !== 'undefined') KanvazBoards.renderBoardsList(contentEl);
    } else if (currentSection === 'properties') {
      if (typeof KanvazProperties !== 'undefined') KanvazProperties.renderInto(contentEl);
    } else if (currentSection === 'settings') {
      if (typeof KanvazUI_Extended !== 'undefined') KanvazUI_Extended.renderSettingsInto(contentEl);
    }
  }

  /* ── Public API ── */

  function showSection(name) {
    if (SECTIONS.indexOf(name) === -1) return;
    var wasOpen = isOpenFlag;
    var prevSection = currentSection;
    isOpenFlag = true;
    currentSection = name;
    if (wasOpen && prevSection !== name) teardownSection(prevSection);
    updateRailActiveState();
    updateContentVisibility();
    renderCurrentSection();
    persistState();
  }

  function close() {
    if (!isOpenFlag) return;
    teardownSection(currentSection);
    isOpenFlag = false;
    updateRailActiveState();
    updateContentVisibility();
    persistState();
  }

  /* Dedicated toggle semantics for a specific section (what the S key
     and the "Open Settings" command use): closed -> open to that
     section; open on a different section -> switch to it (doesn't
     close); open on THAT section already -> close. Matches how a
     dedicated "Settings" shortcut should behave once Settings is one
     section among several in a shared panel, not a standalone popover
     anymore — pressing S is never a no-op and never surprises you by
     closing a panel you were using for something else. */
  function toggle(section) {
    section = section || currentSection;
    if (!isOpenFlag) {
      showSection(section);
    } else if (currentSection === section) {
      close();
    } else {
      showSection(section);
    }
  }

  function isSectionOpen(name) {
    return isOpenFlag && currentSection === name;
  }

  function isOpen() { return isOpenFlag; }

  /* ── Account corner menu (About/Shortcuts/Profile) ──
     Plain dismiss-on-outside-click popover, same convention every
     other small menu in this app uses. Profile item is a stub until
     the Profiles system (Phase 2) lands — see docs/PROFILES_SYSTEM_PLAN.md. */
  function initAccountMenu() {
    var btn = document.getElementById('btn-account');
    var menu = document.getElementById('account-menu');
    if (!btn || !menu) return;

    function positionMenu() {
      var rect = btn.getBoundingClientRect();
      menu.style.left = Math.max(8, rect.right - 170) + 'px';
      menu.style.top  = (rect.bottom + 6) + 'px';
    }

    function openMenu() {
      positionMenu();
      menu.hidden = false;
      setTimeout(function() {
        document.addEventListener('mousedown', dismissOnOutsideClick);
      }, 0);
    }

    function closeMenu() {
      menu.hidden = true;
      document.removeEventListener('mousedown', dismissOnOutsideClick);
    }

    function dismissOnOutsideClick(e) {
      if (!menu.contains(e.target) && e.target !== btn) closeMenu();
    }

    btn.addEventListener('click', function(e) {
      e.stopPropagation();
      if (menu.hidden) openMenu(); else closeMenu();
    });

    var aboutItem = document.getElementById('account-menu-about');
    if (aboutItem) {
      aboutItem.addEventListener('click', function() {
        closeMenu();
        if (typeof KanvazUI_Extended !== 'undefined') KanvazUI_Extended.showAbout();
      });
    }

    var shortcutsItem = document.getElementById('account-menu-shortcuts');
    if (shortcutsItem) {
      shortcutsItem.addEventListener('click', function() {
        closeMenu();
        if (typeof KanvazUI_Extended !== 'undefined') KanvazUI_Extended.showShortcuts();
      });
    }
  }

  /* ── Init ── */

  function init() {
    railEl    = document.getElementById('side-panel-rail');
    contentEl = document.getElementById('side-panel-content');
    if (!railEl || !contentEl) return;

    loadPersistedState();

    var btns = railEl.querySelectorAll('.rail-btn');
    for (var i = 0; i < btns.length; i++) {
      (function(btn) {
        btn.addEventListener('click', function() {
          var section = btn.dataset.section;
          /* Clicking the rail icon for the section that's ALREADY open
             closes the panel (same toggle feel as pressing S again);
             clicking a different section's icon switches to it without
             closing — matches how VS Code's own activity bar behaves. */
          if (isOpenFlag && currentSection === section) {
            close();
          } else {
            showSection(section);
          }
        });
      })(btns[i]);
    }

    updateRailActiveState();
    updateContentVisibility();
    if (isOpenFlag) renderCurrentSection();

    initAccountMenu();
  }

  return {
    init:                 init,
    showSection:          showSection,
    close:                close,
    toggle:               toggle,
    isOpen:               isOpen,
    isSectionOpen:        isSectionOpen,
    refreshPersistedState: refreshPersistedState
  };

})();

if (typeof window !== 'undefined') { window.KanvazSidePanel = KanvazSidePanel; }
