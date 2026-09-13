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

    /* Phase 2 — offline profiles (docs/PROFILES_SYSTEM_PLAN.md). Label
       refreshes every time the menu opens rather than once at init(),
       since the active profile can change without a page reload (a
       rename doesn't relaunch, only a switch does). */
    var profileLabel = document.getElementById('account-menu-profile-label');
    if (profileLabel && typeof KanvazBridge !== 'undefined' && KanvazBridge.getActiveProfile) {
      /* Reassigning the openMenu binding here is enough — the click
         handler above closes over the variable, not its value at
         registration time, so it always calls whichever function
         openMenu currently refers to. */
      var origOpenMenu = openMenu;
      openMenu = function() {
        origOpenMenu();
        KanvazBridge.getActiveProfile().then(function(p) {
          profileLabel.textContent = p && p.name ? p.name : 'Profile';
        }).catch(function() { /* leave the last-known label showing */ });
      };
    }

    var profilesItem = document.getElementById('account-menu-profiles');
    if (profilesItem) {
      profilesItem.addEventListener('click', function() {
        closeMenu();
        showManageProfilesDialog();
      });
    }
  }

  /* ── Manage Profiles dialog ──
     Plain centered overlay, same visual convention as boards.js's
     showStartupScreen() (fixed inset, blurred backdrop, one card).
     Rebuilds its own list on every mutation (create/rename/delete)
     instead of trying to patch individual rows — this dialog is only
     ever open for a few seconds at a time, so simplicity wins over
     incremental DOM diffing here. */
  function showManageProfilesDialog() {
    if (typeof KanvazBridge === 'undefined' || !KanvazBridge.listProfiles) return;

    var existing = document.getElementById('profiles-dialog');
    if (existing && existing.parentNode) existing.parentNode.removeChild(existing);

    var overlay = document.createElement('div');
    overlay.id = 'profiles-dialog';
    overlay.className = 'profiles-dialog-overlay';

    var panel = document.createElement('div');
    panel.className = 'profiles-dialog-panel';

    var title = document.createElement('div');
    title.className = 'profiles-dialog-title';
    title.textContent = 'Manage Profiles';
    panel.appendChild(title);

    var note = document.createElement('div');
    note.className = 'profiles-dialog-note';
    note.textContent = 'Offline, on this device only — no login, not a security boundary between people sharing this computer.';
    panel.appendChild(note);

    var list = document.createElement('div');
    list.className = 'profiles-dialog-list';
    panel.appendChild(list);

    function rebuild() {
      Promise.all([KanvazBridge.listProfiles(), KanvazBridge.getActiveProfile()]).then(function(r) {
        renderList(r[0] || [], r[1] || null);
      });
    }

    function switchTo(id) {
      if (typeof KanvazBoards !== 'undefined' && KanvazBoards.confirmDiscardIfDirty) {
        KanvazBoards.confirmDiscardIfDirty(function() { doSwitch(id); });
      } else {
        doSwitch(id);
      }
    }

    function doSwitch(id) {
      KanvazBridge.switchProfile(id).then(function(res) {
        if (res && res.ok) {
          KanvazBridge.relaunchApp();
        } else if (typeof KanvazUI !== 'undefined') {
          KanvazUI.toast((res && res.error) || 'Could not switch profile', 'error');
        }
      });
    }

    /* Downscales a picked image to a small square avatar entirely in
       the renderer (an <img> + <canvas>) before it ever reaches the IPC
       call — keeps manifest.json's inline avatarDataUrl small regardless
       of how large the source photo was, with no new main-process image
       processing or dependency. */
    function pickAndSetAvatar(profileId, onDone) {
      KanvazBridge.openMediaDialog().then(function(filePath) {
        if (!filePath) { onDone(); return; }
        KanvazBridge.loadMedia(filePath).then(function(res) {
          if (!res || !res.ok || !res.dataUrl || res.dataUrl.indexOf('image/') === -1) {
            if (typeof KanvazUI !== 'undefined') KanvazUI.toast('Could not load that image', 'error');
            onDone();
            return;
          }
          var img = new Image();
          img.onload = function() {
            var SIZE = 96;
            var canvas = document.createElement('canvas');
            canvas.width = SIZE;
            canvas.height = SIZE;
            var ctx = canvas.getContext('2d');
            var side = Math.min(img.width, img.height);
            var sx = (img.width - side) / 2;
            var sy = (img.height - side) / 2;
            ctx.drawImage(img, sx, sy, side, side, 0, 0, SIZE, SIZE);
            var small = canvas.toDataURL('image/png');
            KanvazBridge.setProfileAvatar(profileId, small).then(function() { onDone(); });
          };
          img.onerror = function() {
            if (typeof KanvazUI !== 'undefined') KanvazUI.toast('Could not load that image', 'error');
            onDone();
          };
          img.src = res.dataUrl;
        });
      });
    }

    function buildAvatarEl(p) {
      var av = document.createElement('div');
      av.className = 'profiles-dialog-avatar';
      if (p.avatarDataUrl) {
        var img = document.createElement('img');
        img.src = p.avatarDataUrl;
        av.appendChild(img);
      } else {
        av.textContent = (p.name || '?').trim().charAt(0).toUpperCase();
      }
      return av;
    }

    function renderList(profiles, active) {
      list.innerHTML = '';
      for (var i = 0; i < profiles.length; i++) {
        (function(p) {
          var isActive = active && active.id === p.id;
          var row = document.createElement('div');
          row.className = 'profiles-dialog-row' + (isActive ? ' active' : '');

          var main = document.createElement('div');
          main.className = 'profiles-dialog-row-main';
          main.appendChild(buildAvatarEl(p));

          var textCol = document.createElement('div');
          textCol.className = 'profiles-dialog-text-col';
          var nameEl = document.createElement('div');
          nameEl.className = 'profiles-dialog-name';
          nameEl.textContent = p.name + (isActive ? ' (current)' : '');
          if (p.guest) {
            var badge = document.createElement('span');
            badge.className = 'profiles-dialog-badge';
            badge.textContent = 'Guest';
            nameEl.appendChild(badge);
          }
          textCol.appendChild(nameEl);
          if (p.description) {
            var descEl = document.createElement('div');
            descEl.className = 'profiles-dialog-desc';
            descEl.textContent = p.description;
            textCol.appendChild(descEl);
          }
          main.appendChild(textCol);
          row.appendChild(main);

          var actions = document.createElement('div');
          actions.className = 'profiles-dialog-actions';

          if (!isActive) {
            var switchBtn = document.createElement('button');
            switchBtn.className = 'profiles-dialog-btn';
            switchBtn.textContent = 'Switch';
            switchBtn.onclick = function() { switchTo(p.id); };
            actions.appendChild(switchBtn);
          }

          var editBtn = document.createElement('button');
          editBtn.className = 'profiles-dialog-btn';
          editBtn.textContent = 'Edit';
          editBtn.onclick = function() { renderEditForm(p); };
          actions.appendChild(editBtn);

          var exportBtn = document.createElement('button');
          exportBtn.className = 'profiles-dialog-btn';
          exportBtn.textContent = 'Export';
          exportBtn.title = 'Save this profile as a portable .kanvazprofile file';
          exportBtn.onclick = function() {
            exportBtn.disabled = true;
            KanvazBridge.exportProfile(p.id).then(function(res) {
              exportBtn.disabled = false;
              if (!res || res.cancelled) return;
              if (!res.ok) {
                if (typeof KanvazUI !== 'undefined') KanvazUI.toast(res.error || 'Could not export profile', 'error');
                return;
              }
              if (typeof KanvazUI !== 'undefined') KanvazUI.toast('Exported "' + p.name + '"');
            }).catch(function(e) {
              exportBtn.disabled = false;
              if (typeof KanvazUI !== 'undefined') KanvazUI.toast('Could not export profile: ' + e.message, 'error');
            });
          };
          actions.appendChild(exportBtn);

          if (!isActive && profiles.length > 1) {
            var deleteBtn = document.createElement('button');
            deleteBtn.className = 'profiles-dialog-btn danger';
            deleteBtn.textContent = 'Delete';
            deleteBtn.onclick = function() {
              if (typeof KanvazUI !== 'undefined' && KanvazUI.showDialog) {
                KanvazUI.showDialog(
                  'Delete profile',
                  'Delete "' + p.name + '"? Its settings, recent-boards list, and recovery cache are removed — this does not touch any .kanvaz board file.',
                  [
                    { label: 'Delete', cls: 'danger', action: function() {
                      KanvazBridge.deleteProfile(p.id).then(function(res) {
                        if (!res || !res.ok) {
                          KanvazUI.toast((res && res.error) || 'Could not delete', 'error');
                          return;
                        }
                        rebuild();
                      });
                    } },
                    { label: 'Cancel', cls: '', action: function() {} }
                  ]
                );
              }
            };
            actions.appendChild(deleteBtn);
          }

          row.appendChild(actions);
          list.appendChild(row);

          /* Inline edit form — replaces this row's action buttons with
             name/description fields + a photo picker, swapped back to
             the plain row on Save/Cancel via rebuild(). Kept as a
             sibling row rather than a separate dialog so it stays
             inside the same overlay/scroll context. */
          function renderEditForm() {
            var formRow = document.createElement('div');
            formRow.className = 'profiles-dialog-row profiles-dialog-edit-row';

            var nameInput = document.createElement('input');
            nameInput.type = 'text';
            nameInput.className = 'profiles-dialog-input';
            nameInput.value = p.name;
            nameInput.placeholder = 'Name';

            var descInput = document.createElement('input');
            descInput.type = 'text';
            descInput.className = 'profiles-dialog-input';
            descInput.value = p.description || '';
            descInput.placeholder = 'Description (optional)';

            var photoBtn = document.createElement('button');
            photoBtn.className = 'profiles-dialog-btn';
            photoBtn.textContent = 'Change Photo…';
            photoBtn.onclick = function() {
              photoBtn.disabled = true;
              pickAndSetAvatar(p.id, function() {
                photoBtn.disabled = false;
                rebuild();
              });
            };

            var saveBtn = document.createElement('button');
            saveBtn.className = 'profiles-dialog-btn primary';
            saveBtn.textContent = 'Save';
            saveBtn.onclick = function() {
              KanvazBridge.updateProfile(p.id, { name: nameInput.value, description: descInput.value }).then(function(res) {
                if (!res || !res.ok) {
                  if (typeof KanvazUI !== 'undefined') KanvazUI.toast((res && res.error) || 'Could not save', 'error');
                  return;
                }
                rebuild();
              });
            };

            var cancelBtn = document.createElement('button');
            cancelBtn.className = 'profiles-dialog-btn';
            cancelBtn.textContent = 'Cancel';
            cancelBtn.onclick = function() { rebuild(); };

            formRow.appendChild(nameInput);
            formRow.appendChild(descInput);
            var formActions = document.createElement('div');
            formActions.className = 'profiles-dialog-actions';
            formActions.appendChild(photoBtn);
            formActions.appendChild(saveBtn);
            formActions.appendChild(cancelBtn);
            formRow.appendChild(formActions);

            row.parentNode.replaceChild(formRow, row);
          }
        })(profiles[i]);
      }
    }

    var createRow = document.createElement('div');
    createRow.className = 'profiles-dialog-create';
    var createInput = document.createElement('input');
    createInput.type = 'text';
    createInput.placeholder = 'New profile name';
    createInput.className = 'profiles-dialog-input';
    var createBtn = document.createElement('button');
    createBtn.className = 'profiles-dialog-btn primary';
    createBtn.textContent = '+ New Profile';
    createBtn.onclick = function() {
      var name = createInput.value.trim();
      if (!name) return;
      KanvazBridge.createProfile(name).then(function() {
        createInput.value = '';
        rebuild();
      });
    };
    createInput.addEventListener('keydown', function(e) {
      if (e.key === 'Enter') createBtn.click();
      e.stopPropagation();
    });
    createRow.appendChild(createInput);
    createRow.appendChild(createBtn);
    panel.appendChild(createRow);

    /* Quick "Add Guest Profile" — a profile named "Guest" (de-duplicated
       if one already exists) tagged guest:true purely for the badge
       shown above; it persists like any other profile (see the
       createProfileEntry comment on why this isn't an ephemeral/
       auto-wipe mode). Skips the name-typing step for the common
       "someone else wants to use Kanvaz for five minutes" case. */
    var guestBtn = document.createElement('button');
    guestBtn.className = 'profiles-dialog-btn';
    guestBtn.style.cssText = 'width:100%;margin-bottom:12px;';
    guestBtn.textContent = '+ Add Guest Profile';
    guestBtn.onclick = function() {
      KanvazBridge.listProfiles().then(function(profiles) {
        var n = 1;
        var base = 'Guest';
        var taken = {};
        var pl = profiles || [];
        for (var j = 0; j < pl.length; j++) { taken[pl[j].name] = true; }
        var name = base;
        while (taken[name]) { n++; name = base + ' ' + n; }
        KanvazBridge.createProfile(name, { guest: true }).then(function() { rebuild(); });
      });
    };
    panel.insertBefore(guestBtn, createRow);

    /* Import Profile — the offline answer to "sync" (docs/
       PROFILES_SYSTEM_PLAN.md): a .kanvazprofile file exported from any
       Kanvaz install (this one or another machine) becomes a brand new
       local profile here, never overwriting an existing one. */
    var importBtn = document.createElement('button');
    importBtn.className = 'profiles-dialog-btn';
    importBtn.style.cssText = 'width:100%;margin-bottom:12px;';
    importBtn.textContent = 'Import Profile…';
    importBtn.onclick = function() {
      importBtn.disabled = true;
      KanvazBridge.importProfile().then(function(res) {
        importBtn.disabled = false;
        if (!res) return;
        if (res.cancelled) return;
        if (!res.ok) {
          if (typeof KanvazUI !== 'undefined') KanvazUI.toast(res.error || 'Could not import profile', 'error');
          return;
        }
        if (typeof KanvazUI !== 'undefined') KanvazUI.toast('Imported "' + res.name + '" as a new profile');
        rebuild();
      }).catch(function(e) {
        importBtn.disabled = false;
        if (typeof KanvazUI !== 'undefined') KanvazUI.toast('Could not import profile: ' + e.message, 'error');
      });
    };
    panel.insertBefore(importBtn, createRow);

    var closeBtn = document.createElement('button');
    closeBtn.className = 'profiles-dialog-close';
    closeBtn.textContent = 'Close';
    closeBtn.onclick = function() { overlay.parentNode.removeChild(overlay); };
    panel.appendChild(closeBtn);

    overlay.appendChild(panel);
    overlay.addEventListener('mousedown', function(e) {
      if (e.target === overlay) overlay.parentNode.removeChild(overlay);
    });
    document.body.appendChild(overlay);

    rebuild();
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
