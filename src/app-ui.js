/* app-ui.js — KanvazUI: toasts, dialogs, context menu, presentation/top
 * mode, PureRef drop handling (v9.7.0, split out of app.js)
 *
 * Second piece of the planned file-size cleanup, after cards-export.js.
 * This was `window.KanvazUI = (function() {...})()`, nested inside
 * app.js's own KanvazApp closure — checked every reference inside it
 * before moving: the ENTIRE block touched exactly one piece of
 * KanvazApp's private state (a bare `importPurFile()` call from the
 * canvas right-click menu's "Import .pur file" item), already exposed
 * on KanvazApp's own public API as `importPurFile`. That one call is
 * now `KanvazApp.importPurFile()` — everything else here was already
 * fully self-contained (DOM lookups by id, other modules' public APIs),
 * so the rest of this file is unchanged from what lived in app.js.
 */

  window.KanvazUI = (function() {

    /* Polish fix: .toast is already display:flex;gap:8px in main.css —
       clearly laid out to hold an icon next to the text — but nothing
       ever put an icon there. Toasts were the one recurring piece of
       app chrome that was text-only while everything else (toolbar,
       titlebar, context menu, card badges) uses the same hand-drawn
       stroke-SVG icon language. Small check/✕/! glyphs in that same
       convention (viewBox 14x14, stroke-width 1.5, currentColor so it
       inherits .toast.success/.error/.warning's existing color rules
       with zero extra color logic needed here). */
    var TOAST_ICONS = {
      success: '<svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M2.5 7.5l3 3 6-6.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>',
      /* Redesign v1: was an X shape — now that error toasts also carry a
         real dismiss (×) button (see toast() below), the same glyph
         used for both "this is an error" and "click to close this"
         in one toast was genuinely confusing (reported directly, after
         a screenshot showed both). A circled exclamation reads as
         status, not as another clickable-looking × next to the real
         one. */
      error:   '<svg width="14" height="14" viewBox="0 0 14 14" fill="none"><circle cx="7" cy="7" r="6" stroke="currentColor" stroke-width="1.4"/><path d="M7 4v3.5M7 9.8v.01" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>',
      warning: '<svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M7 1.5l6 10.5H1L7 1.5z" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/><path d="M7 5.5v3M7 10.5v.01" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>'
    };

    function toast(msg, type) {
      var container = document.getElementById('toast-container');
      if (!container) return;

      var el = document.createElement('div');
      el.className = 'toast' + (type ? ' ' + type : '');

      if (type && TOAST_ICONS[type]) {
        var iconEl = document.createElement('span');
        iconEl.style.cssText = 'display:flex;flex-shrink:0;';
        iconEl.innerHTML = TOAST_ICONS[type];
        el.appendChild(iconEl);
      }
      var textEl = document.createElement('span');
      textEl.textContent = msg;
      el.appendChild(textEl);

      function dismiss() {
        el.classList.add('out');
        setTimeout(function() {
          if (el.parentNode) el.parentNode.removeChild(el);
        }, 200);
      }

      /* Direct feedback: an error toast now often carries real technical
         detail (see errors.js's handle()) worth actually reading, or
         screenshotting to report — the old flat 2800ms for every toast
         type made that "vanish before I can catch it." Errors now stay
         up ~4x longer and get an explicit close button so dismissing
         one is a deliberate click, not a race against a timer; plain
         success/info/warning toasts keep the original quick auto-
         dismiss, since those are just brief confirmations. Hovering an
         error toast also pauses its timer — reading takes longer than
         skimming, and a mouse sitting over it is a clear "still looking
         at this" signal. */
      if (type === 'error') {
        var closeBtn = document.createElement('button');
        closeBtn.className = 'toast-close';
        closeBtn.innerHTML = '&times;';
        closeBtn.title = 'Dismiss';
        closeBtn.onclick = dismiss;
        el.appendChild(closeBtn);

        var autoTimer = null;
        var remaining = 12000;
        var startedAt = Date.now();
        function arm(ms) {
          startedAt = Date.now();
          autoTimer = setTimeout(dismiss, ms);
        }
        el.addEventListener('mouseenter', function() {
          if (autoTimer) { clearTimeout(autoTimer); remaining -= (Date.now() - startedAt); }
        });
        el.addEventListener('mouseleave', function() {
          arm(Math.max(1500, remaining));
        });
        arm(remaining);
      } else {
        setTimeout(dismiss, 2800);
      }

      container.appendChild(el);
    }

    function showDialog(title, message, buttons) {
      var overlay = document.getElementById('dialog-overlay');
      var titleEl = document.getElementById('dialog-title');
      var msgEl   = document.getElementById('dialog-message');
      var btnsEl  = document.getElementById('dialog-btns');

      if (!overlay) return;

      titleEl.textContent = title;
      msgEl.textContent   = message;
      btnsEl.innerHTML    = '';

      var primaryBtnEl = null;
      for (var i = 0; i < buttons.length; i++) {
        (function(btn) {
          var el = document.createElement('button');
          el.className = 'btn ' + (btn.cls || '');
          el.textContent = btn.label;
          el.onclick = function() {
            closeDialog();
            if (btn.action) btn.action();
          };
          btnsEl.appendChild(el);
          if (btn.cls === 'primary') primaryBtnEl = el;
        })(buttons[i]);
      }

      overlay.classList.add('visible');

      /* v8.x polish: every dialog through this function used to be
         mouse-only for confirming — Escape-to-cancel already worked
         (shortcuts.js's global handler calls closeDialog()), but
         nothing focused a button, so Enter did nothing at all, unlike
         the near-universal "Enter = default action" convention every
         native OS dialog follows. Native <button> elements already
         respond to Enter when focused — no custom keydown handler
         needed, just actually focus the primary one.
         Deliberately ONLY when a button is explicitly marked
         cls:'primary' — checked every existing showDialog() call site
         in this codebase before adding this, and button ordering is
         NOT a safe proxy for "which one is safe to default to": at
         least one real dialog (ui.js's "Remove plugin?") puts its
         destructive button LAST with no primary marking, which a
         naive "focus the last button" fallback would have silently
         made Enter trigger. No primary means no auto-focus at all —
         same as before this change, not a guess. Deferred one frame
         since the overlay's own display transition can otherwise
         swallow a focus call made in the same tick. */
      if (primaryBtnEl) setTimeout(function() { primaryBtnEl.focus(); }, 0);
    }

    function closeDialog() {
      var overlay = document.getElementById('dialog-overlay');
      if (overlay) overlay.classList.remove('visible');
      var input = document.getElementById('dialog-input');
      if (input) input.style.display = 'none';
      var exportForm = document.getElementById('dialog-export-form');
      if (exportForm) { exportForm.style.display = 'none'; exportForm.innerHTML = ''; }
      var linkForm = document.getElementById('dialog-link-form');
      if (linkForm) { linkForm.style.display = 'none'; linkForm.innerHTML = ''; }
      var boxEl = document.getElementById('dialog-box');
      if (boxEl) boxEl.classList.remove('dialog-box-wide');
    }

    /* Export-as-format picker — the Adobe/Maya-style "choose format +
       quality, then export" dialog, direct request ("export as which
       will open a window where user can choose which format to export
       in and quality of it"). Reuses the SAME custom dialog-overlay
       every other confirmation in this app uses (never a native OS file-
       type picker) — just with a real form injected into
       #dialog-export-form instead of a plain message string. */
    function showExportPicker(ids) {
      var overlay = document.getElementById('dialog-overlay');
      var titleEl = document.getElementById('dialog-title');
      var msgEl   = document.getElementById('dialog-message');
      var formEl  = document.getElementById('dialog-export-form');
      var btnsEl  = document.getElementById('dialog-btns');
      var boxEl   = document.getElementById('dialog-box');
      if (!overlay || !formEl) return;
      if (boxEl) boxEl.classList.add('dialog-box-wide');

      /* Direct feedback: "i right clicked the vid and it says export to
         PNG, srsly?" — same underlying scope (no real video encoder, see
         canvasToBmpDataUrl's own comment on the format list above), but
         at least tell the user up front that a video card only gives up
         a still frame, not the whole clip, instead of leaving them to
         infer it after the fact. */
      var hasVideoCard = false;
      for (var vci = 0; vci < ids.length; vci++) {
        var vcCard = (typeof KanvazCards !== 'undefined') ? KanvazCards.getCard(ids[vci]) : null;
        if (vcCard && vcCard.type === 'video') { hasVideoCard = true; break; }
      }
      titleEl.textContent = 'Export as…';
      var exportMsg = ids.length > 1 ? ('Exporting ' + ids.length + ' cards — one file per card, into a folder you choose.') : 'Choose a format and quality.';
      if (hasVideoCard) exportMsg += ' Video cards export their current frame as a still image — Kanvaz can\'t re-encode video yet.';
      msgEl.textContent = exportMsg;
      msgEl.style.display = '';
      formEl.innerHTML = '';
      formEl.style.display = 'flex';
      btnsEl.innerHTML = '';

      var formatRow = document.createElement('div');
      formatRow.className = 'dialog-export-row';
      var formatLabel = document.createElement('label');
      formatLabel.textContent = 'Format';
      var formatSel = document.createElement('select');
      /* WebP added — direct request ("png can be converted into web and
         web can be into other too"): Chromium's own canvas.toDataURL
         supports image/webp natively, no extra dependency, so this is a
         real, working conversion, not a stub. A true VIDEO container
         conversion (e.g. re-encoding an .mp4 to a different codec/
         container) is a genuinely different, much bigger scope — it
         needs a real video encoder (ffmpeg-class dependency), not
         something a <canvas> can do — deliberately not attempted here
         rather than shipping a fake "convert" that silently doesn't
         work. Video CARDS still export a still frame in any of these
         three image formats, same as before. */
      var formatChoices = ['png', 'jpeg', 'webp', 'bmp'];
      for (var fi = 0; fi < formatChoices.length; fi++) {
        var o = document.createElement('option');
        o.value = formatChoices[fi]; o.textContent = formatChoices[fi].toUpperCase();
        formatSel.appendChild(o);
      }
      formatRow.appendChild(formatLabel);
      formatRow.appendChild(formatSel);
      formEl.appendChild(formatRow);

      var qualityRow = document.createElement('div');
      qualityRow.className = 'dialog-export-row';
      var qualityLabel = document.createElement('label');
      qualityLabel.textContent = 'Quality';
      var qualitySlider = document.createElement('input');
      qualitySlider.type = 'range';
      qualitySlider.min = '10'; qualitySlider.max = '100'; qualitySlider.value = '92';
      var qualityValue = document.createElement('span');
      qualityValue.textContent = '92%';
      qualitySlider.oninput = function() { qualityValue.textContent = qualitySlider.value + '%'; };
      qualityRow.appendChild(qualityLabel);
      qualityRow.appendChild(qualitySlider);
      qualityRow.appendChild(qualityValue);
      formEl.appendChild(qualityRow);

      /* Quality only means anything for a lossy format (PNG and BMP are
         both always lossless) — hidden, not just disabled, so the dialog
         doesn't show a control that visibly does nothing. */
      function syncQualityVisibility() {
        qualityRow.style.display = (formatSel.value === 'png' || formatSel.value === 'bmp') ? 'none' : '';
      }
      formatSel.onchange = syncQualityVisibility;
      syncQualityVisibility();

      /* Image size — direct request for "proper professional detailed
         export settings." Percent-of-original is deliberately simpler
         than a raw Width/Height pair (Photoshop's own "Scale" field):
         every selected card can be a different native size, so one
         shared Width/Height pair would mean something different for
         each — a shared percentage always means the same thing. */
      var sizeRow = document.createElement('div');
      sizeRow.className = 'dialog-export-row';
      var sizeLabel = document.createElement('label');
      sizeLabel.textContent = 'Size';
      var sizeSel = document.createElement('select');
      var sizeChoices = [['1', '100% (original)'], ['0.75', '75%'], ['0.5', '50%'], ['0.25', '25%']];
      for (var si = 0; si < sizeChoices.length; si++) {
        var so = document.createElement('option');
        so.value = sizeChoices[si][0]; so.textContent = sizeChoices[si][1];
        sizeSel.appendChild(so);
      }
      sizeRow.appendChild(sizeLabel);
      sizeRow.appendChild(sizeSel);
      formEl.appendChild(sizeRow);

      var cancelBtn = document.createElement('button');
      cancelBtn.className = 'btn';
      cancelBtn.textContent = 'Cancel';
      cancelBtn.onclick = closeDialog;

      var exportBtn = document.createElement('button');
      exportBtn.className = 'btn primary';
      exportBtn.textContent = 'Export';
      exportBtn.onclick = function() {
        closeDialog();
        if (typeof KanvazCards !== 'undefined') {
          KanvazCards.exportCardsAsFormat(ids, formatSel.value, parseInt(qualitySlider.value, 10) / 100, parseFloat(sizeSel.value));
        }
      };

      btnsEl.appendChild(cancelBtn);
      btnsEl.appendChild(exportBtn);
      overlay.classList.add('visible');
    }

    /* Discord-style external-link confirmation — direct request: "add a
       warning like msg discord does before you click any links...
       friendly, not something like Windows error handling." Every
       embedded link (What's New entries, URL-card Open, the About
       screen's GitHub link, ...) routes through this instead of calling
       KanvazBridge.openExternal directly — EXCEPT the Check for Updates
       flow, which the user explicitly carved out (it's already its own
       deliberate, disclosed action, not a link buried in content). Has
       its own "Don't ask me again" checkbox, persisted like every other
       preference via KanvazUI_Extended's settings, not a native confirm(). */
    function confirmExternalLink(url) {
      if (!url || typeof KanvazBridge === 'undefined') return;
      var settings = (typeof KanvazUI_Extended !== 'undefined' && KanvazUI_Extended.getSettings) ? KanvazUI_Extended.getSettings() : null;
      if (settings && settings.skipExternalLinkWarning) {
        KanvazBridge.openExternal(url);
        return;
      }

      var overlay = document.getElementById('dialog-overlay');
      var titleEl = document.getElementById('dialog-title');
      var msgEl   = document.getElementById('dialog-message');
      var formEl  = document.getElementById('dialog-link-form');
      var btnsEl  = document.getElementById('dialog-btns');
      if (!overlay || !formEl) { KanvazBridge.openExternal(url); return; }

      titleEl.textContent = 'Leaving Kanvaz';
      msgEl.textContent = 'This link opens outside Kanvaz, in your default browser. Want to go ahead?';
      msgEl.style.display = '';
      formEl.innerHTML = '';
      formEl.style.display = 'flex';
      btnsEl.innerHTML = '';

      var urlBox = document.createElement('div');
      urlBox.className = 'dialog-link-url';
      urlBox.textContent = url;
      formEl.appendChild(urlBox);

      var checkRow = document.createElement('label');
      checkRow.className = 'dialog-link-checkbox-row';
      var checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      var checkText = document.createElement('span');
      checkText.textContent = "Don't ask me again";
      checkRow.appendChild(checkbox);
      checkRow.appendChild(checkText);
      formEl.appendChild(checkRow);

      var noBtn = document.createElement('button');
      noBtn.className = 'btn';
      noBtn.textContent = 'No';
      noBtn.onclick = closeDialog;

      var yesBtn = document.createElement('button');
      yesBtn.className = 'btn primary';
      yesBtn.textContent = 'Yes, open it';
      yesBtn.onclick = function() {
        closeDialog();
        if (checkbox.checked && typeof KanvazUI_Extended !== 'undefined' && KanvazUI_Extended.updateSettings) {
          KanvazUI_Extended.updateSettings({ skipExternalLinkWarning: true });
        }
        KanvazBridge.openExternal(url);
      };

      btnsEl.appendChild(noBtn);
      btnsEl.appendChild(yesBtn);
      overlay.classList.add('visible');
      setTimeout(function() { yesBtn.focus(); }, 0);
    }

    /* Kanvaz-styled stand-in for window.prompt() — same dialog overlay
       as showDialog, with a text field added in. onSubmit gets the
       trimmed value, or is never called if cancelled/empty (matches
       window.prompt()'s null-on-cancel, but callers only ever wanted
       a non-empty result anyway). */
    function showPrompt(title, message, defaultValue, onSubmit) {
      var overlay = document.getElementById('dialog-overlay');
      var titleEl = document.getElementById('dialog-title');
      var msgEl   = document.getElementById('dialog-message');
      var input   = document.getElementById('dialog-input');
      var btnsEl  = document.getElementById('dialog-btns');
      if (!overlay || !input) return;

      titleEl.textContent = title;
      msgEl.textContent   = message || '';
      msgEl.style.display = message ? '' : 'none';
      input.style.display = '';
      input.value = defaultValue || '';
      btnsEl.innerHTML = '';

      function submit() {
        var val = input.value.trim();
        closeDialog();
        msgEl.style.display = '';
        if (val) onSubmit(val);
      }

      input.onkeydown = function(e) {
        if (e.key === 'Enter') { e.preventDefault(); submit(); }
        if (e.key === 'Escape') { e.preventDefault(); closeDialog(); msgEl.style.display = ''; }
      };

      var cancelBtn = document.createElement('button');
      cancelBtn.className = 'btn';
      cancelBtn.textContent = 'Cancel';
      cancelBtn.onclick = function() { closeDialog(); msgEl.style.display = ''; };

      var okBtn = document.createElement('button');
      okBtn.className = 'btn primary';
      okBtn.textContent = 'OK';
      okBtn.onclick = submit;

      btnsEl.appendChild(cancelBtn);
      btnsEl.appendChild(okBtn);

      overlay.classList.add('visible');
      setTimeout(function() { input.focus(); input.select(); }, 0);
    }

    function showCardContextMenu(x, y, card, renameOverride) {
      var menu = document.getElementById('context-menu');
      if (!menu) return;
      menu.innerHTML = '';
      menu.className = 'visible';

      var items = [];

      /* Annotate — only for visual media cards, not notes, audio, color, URL, or file refs */
      if (card.type !== 'note' && card.type !== 'audio' && card.type !== 'color' && card.type !== 'url' && card.type !== 'file' && card.type !== 'text') {
        items.push({
          label: 'Annotate',
          action: function() {
            if (typeof KanvazAnnotate !== 'undefined') KanvazAnnotate.activate(card.id);
          }
        });
      }

      items.push({
          /* From the Layers panel, Rename edits inline in that row
             (renameOverride) instead of jumping to the on-canvas card's
             own rename input — right-clicking a row and choosing Rename
             should rename in place, not pull focus onto the board. */
          label: 'Rename',
          action: renameOverride || function() { KanvazCards.startRenameCard(card.id); }
        },
        {
          label: 'Connections',
          shortcut: 'C',
          action: function() {
            if (typeof KanvazInspector !== 'undefined') KanvazInspector.open(card.id);
          }
        },
        {
          label: 'Properties',
          shortcut: 'E',
          action: function() {
            if (typeof KanvazProperties !== 'undefined') KanvazProperties.open(card.id);
          }
        },
        { sep: true },
        {
          label: 'Duplicate',
          shortcut: 'Ctrl+D',
          action: function() { KanvazCards.duplicateCard(card.id); }
        },
        {
          label: card.pinned ? 'Unpin' : 'Pin',
          shortcut: 'P',
          action: function() { KanvazCards.togglePin(card.id); }
        },
        {
          label: 'Bring to front',
          action: function() { KanvazCards.bringToFront(card.id); }
        },
        {
          label: 'Send to back',
          action: function() { KanvazCards.sendToBack(card.id); }
        }
      );

      /* Group / Ungroup — Group only makes sense with 2+ selected;
         Ungroup only when the right-clicked card is actually part of
         one. Mirrors the Ctrl+G/Ctrl+Shift+G shortcuts exactly. */
      var selIds = KanvazCards.getSelectedIds();
      if (selIds.length > 1) {
        items.push({
          label: 'Group',
          shortcut: 'Ctrl+G',
          action: function() { KanvazCards.groupCards(selIds); }
        });
      }
      if (card.groupId) {
        items.push({
          label: 'Ungroup',
          shortcut: 'Ctrl+Shift+G',
          action: function() { KanvazCards.ungroupCards([card.id]); }
        });
      }
      if (selIds.length > 1) {
        items.push({
          label: 'Export selection as PNG',
          action: function() { KanvazCards.exportAsImage(selIds, 'png'); }
        });
        items.push({
          label: 'Export selection as JPEG',
          action: function() { KanvazCards.exportAsImage(selIds, 'jpeg'); }
        });
      }

      /* Export as format (converter) — direct request: "kanvaz becomes a
         sort of converter too... someone just copy pasted pics and wants
         now to create a set of img locally." Distinct from the composite
         board/selection export above (which flattens everything onto ONE
         canvas) — this exports each image/GIF/video card's OWN media as
         its own separate file. Works on the right-clicked card alone, or
         every image/GIF/video card in the current multi-selection if
         it's part of one (non-convertible types in that selection are
         silently skipped, not an error). */
      var exportCandidateIds = (selIds.length > 1 && selIds.indexOf(card.id) !== -1) ? selIds : [card.id];
      var exportableIds = [];
      for (var eti = 0; eti < exportCandidateIds.length; eti++) {
        var etCard = KanvazCards.getCard(exportCandidateIds[eti]);
        if (etCard && (etCard.type === 'image' || etCard.type === 'gif' || etCard.type === 'video')) exportableIds.push(exportCandidateIds[eti]);
      }
      if (exportableIds.length) {
        /* Bug fix: "i right clicked the vid and it says export to PNG,
           srsly?" — a video card CAN only "quick export" a single decoded
           frame as a still image (no real video encoder in this app —
           see the ROADMAP note on why video-to-video is out of scope),
           which the plain "Quick export as PNG" label never made clear.
           Reads as a real bug even though the behavior itself is the
           correct, already-scoped one. Labeling it explicitly as a frame
           grab for video (mixed selections included) fixes the
           confusion without changing what actually happens. */
        var exportHasVideo = false;
        for (var evi = 0; evi < exportableIds.length; evi++) {
          var evCard = KanvazCards.getCard(exportableIds[evi]);
          if (evCard && evCard.type === 'video') { exportHasVideo = true; break; }
        }
        var quickLabel = exportHasVideo
          ? (exportableIds.length > 1 ? 'Quick export frame(s) as PNG (' + exportableIds.length + ')' : 'Quick export current frame as PNG')
          : (exportableIds.length > 1 ? 'Quick export as PNG (' + exportableIds.length + ')' : 'Quick export as PNG');
        items.push({ sep: true });
        items.push({
          label: quickLabel,
          action: function() { KanvazCards.exportCardsAsFormat(exportableIds, 'png', 0.92); }
        });
        items.push({
          label: 'Export as…',
          action: function() { if (typeof KanvazUI !== 'undefined' && KanvazUI.showExportPicker) KanvazUI.showExportPicker(exportableIds); }
        });
      }

      /* Media-only items: flip, reset size */
      if (card.type !== 'note' && card.type !== 'color' && card.type !== 'audio' && card.type !== 'url' && card.type !== 'file' && card.type !== 'text') {
        items.push({ sep: true });
        items.push({
          label: 'Flip horizontal',
          action: function() { KanvazCards.flipCard(card.id, 'h'); }
        });
        items.push({
          label: 'Flip vertical',
          action: function() { KanvazCards.flipCard(card.id, 'v'); }
        });
        items.push({
          label: 'Reset size',
          action: function() { KanvazCards.resetSize(card.id); }
        });
      }

      /* Image-only: cover/contain toggle */
      if (card.type === 'image') {
        items.push({
          label: 'Image fit: ' + ((card.objectFit === 'contain') ? 'Contain' : 'Cover') + ' (click to switch)',
          action: function() { KanvazCards.toggleObjectFit(card.id); }
        });
      }

      /* Video-only: playback speed */
      if (card.type === 'video') {
        items.push({
          label: 'Playback speed',
          submenu: true,
          action: function() { KanvazCards.showSpeedPicker(card.id, x, y); }
        });
      }

      /* 3D model-only: Normal/Wireframe/Matcap + Reset Camera — direct
         feedback, a second way in besides hovering the card's own
         toolbar strip. */
      if (card.type === 'model3d') {
        items.push({
          label: '3D View',
          submenu: true,
          action: function() { KanvazCards.showModel3DModePicker(card.id, x, y); }
        });
      }

      items.push({ sep: true });
      items.push({
        label: 'Opacity',
        submenu: true,
        action: function() { KanvazCards.showOpacityPicker(card.id, x, y); }
      });
      if (card.type !== 'note' && card.type !== 'audio' && card.type !== 'color' && card.type !== 'url' && card.type !== 'file' && card.type !== 'text') {
        items.push({
          label: 'Clear annotations',
          action: function() {
            if (typeof KanvazAnnotate !== 'undefined') KanvazAnnotate.clearAnnotations(card.id);
          }
        });
      }
      if (card.type === 'url') {
        items.push({
          label: 'Open in browser',
          action: function() {
            var raw = (card.url || '').trim();
            if (!raw) return;
            var target = /^https?:\/\//i.test(raw) ? raw : 'https://' + raw;
            KanvazUI.confirmExternalLink(target);
          }
        });
        items.push({
          label: 'Copy link',
          action: function() {
            var raw = (card.url || '').trim();
            if (!raw) return;
            if (navigator.clipboard && navigator.clipboard.writeText) {
              navigator.clipboard.writeText(raw).then(function() {
                KanvazUI.toast('Copied link', 'success');
              }).catch(function() {
                KanvazUI.toast('Could not copy to clipboard', 'error');
              });
            }
          }
        });
      }
      if (card.type === 'file') {
        items.push({
          label: 'Open file',
          action: function() {
            if (!card.path) return;
            KanvazBridge.openPath(card.path).then(function(err) {
              if (err) KanvazUI.toast(err, 'error');
            });
          }
        });
        items.push({
          label: 'Copy path',
          action: function() {
            if (!card.path) return;
            if (navigator.clipboard && navigator.clipboard.writeText) {
              navigator.clipboard.writeText(card.path).then(function() {
                KanvazUI.toast('Copied path', 'success');
              }).catch(function() {
                KanvazUI.toast('Could not copy to clipboard', 'error');
              });
            }
          }
        });
      }
      /* Shared cards across boards (v6.4.0) */
      items.push({ sep: true });
      items.push({
        label: 'Share to board',
        submenu: true,
        action: function() { KanvazCards.showShareToBoardPicker(card.id, x, y); }
      });
      if (card.sharedId) {
        items.push({
          label: 'Unlink from shared card',
          action: function() { KanvazCards.unlinkSharedCard(card.id); }
        });
      }

      items.push({ sep: true });
      items.push({
          label: 'Delete',
          shortcut: 'Del',
          danger: true,
          action: function() { KanvazCards.deleteCard(card.id); }
      });

      for (var i = 0; i < items.length; i++) {
        if (items[i].sep) {
          var sep = document.createElement('div');
          sep.className = 'ctx-sep';
          menu.appendChild(sep);
          continue;
        }
        (function(item) {
          var el = document.createElement('div');
          el.className = 'ctx-item' + (item.danger ? ' danger' : '');
          /* Built via DOM APIs rather than innerHTML — every item.label
             here is a static string today, but building menus from
             textContent/DOM nodes instead of string concatenation means
             a future item sourced from user data (a card name, a tag)
             can't reopen an XSS path just by being added to this list. */
          el.appendChild(document.createTextNode(item.label));
          if (item.shortcut) {
            var shortcutEl = document.createElement('span');
            shortcutEl.className = 'ctx-shortcut';
            shortcutEl.textContent = item.shortcut;
            el.appendChild(shortcutEl);
          }
          el.addEventListener('mousedown', function(ev) {
            ev.preventDefault();
            ev.stopPropagation();
          });
          el.addEventListener('click', function(ev) {
            ev.preventDefault();
            ev.stopPropagation();
            hideContextMenu();
            if (item.action) item.action();
          });
          menu.appendChild(el);
        })(items[i]);
      }

      KanvazApp.positionMenuInViewport(menu, x, y);
    }

    function showContextMenu(x, y, type, target) {
      var menu = document.getElementById('context-menu');
      if (!menu) return;
      menu.innerHTML = '';
      menu.className = 'visible';

      var items = [];
      if (type === 'canvas') {
        items = [
          { label: 'New note', shortcut: (function() {
              /* Audit fix: this used to unconditionally show "Dbl-click"
                 as if it always worked — doubleClickCreatesNote defaults
                 to false, so for most users double-clicking the canvas
                 does nothing. Only show the hint when it's actually true. */
              if (typeof KanvazUI_Extended !== 'undefined') {
                var s = KanvazUI_Extended.getSettings();
                if (s && s.doubleClickCreatesNote) return 'Dbl-click';
              }
              return undefined;
            })(), action: function() {
            var pos = KanvazCanvas.screenToWorld(x, y);
            if (typeof KanvazCards !== 'undefined') KanvazCards.createNote(pos.x, pos.y);
          }},
          { label: 'New text', action: function() {
            var pos = KanvazCanvas.screenToWorld(x, y);
            if (typeof KanvazCards !== 'undefined') KanvazCards.createTextCard(pos.x, pos.y);
          }},
          { label: 'New color swatch', action: function() {
            var pos = KanvazCanvas.screenToWorld(x, y);
            if (typeof KanvazCards !== 'undefined') KanvazCards.createColorCard(pos.x, pos.y);
          }},
          { label: 'New URL reference', action: function() {
            var pos = KanvazCanvas.screenToWorld(x, y);
            if (typeof KanvazCards !== 'undefined') KanvazCards.createUrlCard(pos.x, pos.y);
          }},
          { label: 'New file reference', action: function() {
            var pos = KanvazCanvas.screenToWorld(x, y);
            if (typeof KanvazCards !== 'undefined') KanvazCards.createFileRefCard(pos.x, pos.y);
          }},
          { sep: true },
          { label: 'Import .pur file', action: function() { KanvazApp.importPurFile(); }},
          { sep: true },
          { label: 'Tidy up board', action: function() {
            if (typeof KanvazCards === 'undefined') return;
            KanvazCards.tidyUp(KanvazCards.getAllIds());
          }},
          { label: 'Export board as PNG', action: function() {
            if (typeof KanvazCards === 'undefined') return;
            KanvazCards.exportAsImage(KanvazCards.getAllIds(), 'png');
          }},
          { label: 'Export board as JPEG', action: function() {
            if (typeof KanvazCards === 'undefined') return;
            KanvazCards.exportAsImage(KanvazCards.getAllIds(), 'jpeg');
          }},
          { sep: true },
          { label: 'Reset zoom', shortcut: '0', action: function() { KanvazCanvas.zoomReset(); }},
          { label: 'Fit all cards', shortcut: 'F', action: function() { KanvazCanvas.zoomFit(); }}
        ];

        /* Plugin-registered card types with a create(x,y) — inserted
           right after the built-in "New ..." entries, before the
           Import .pur separator. Without this, registerCardType() had
           no user-facing way to actually instantiate one.

           Audit fix: this whole block used to run with no try/catch.
           This function fires on EVERY right-click on the canvas, and
           by this point menu.innerHTML/.className above have already
           made #context-menu visible — if _getAllCardTypeDefs() ever
           returned something malformed (e.g. an entry missing .label/
           .id from a plugin mid-unregister, or simply not an array),
           the exception would abort showContextMenu() before the render
           loop below ever runs, leaving the menu flagged visible but
           empty/mispositioned — and since nothing here is transient,
           EVERY subsequent right-click would repeat the same throw,
           permanently breaking the entire canvas context menu (built-
           ins included) for the rest of the session. Wrapping it means
           a bad plugin registration degrades to "no plugin items this
           time", never to "no context menu at all". */
        try {
          if (typeof KanvazPluginAPI !== 'undefined' && KanvazPluginAPI._getAllCardTypeDefs) {
            var pluginTypes = (KanvazPluginAPI._getAllCardTypeDefs() || []).filter(function(t) {
              return t && t.hasCreate && typeof t.id === 'string' && typeof t.label === 'string';
            });
            if (pluginTypes.length) {
              var pluginItems = pluginTypes.map(function(t) {
                return { label: 'New ' + t.label, action: function() {
                  var pos = KanvazCanvas.screenToWorld(x, y);
                  if (typeof KanvazCards !== 'undefined') KanvazCards.createPluginCard(t.id, pos.x, pos.y);
                }};
              });
              items = items.slice(0, 4).concat([{ sep: true }], pluginItems, items.slice(4));
            }
          }
        } catch (e) {
          console.error('[Kanvaz Plugin] failed to build plugin context-menu items, showing built-in items only:', e.message);
        }
      }

      /* Direct feedback: "right click on search will give options open,
         fav it with heart svg and more" — a Smart Folder chip/row (the
         search bar's own row of saved-search chips, or its persistent
         twin in the Boards side panel) had no interaction besides a
         left-click-to-run and a small delete "×". `target` here is the
         folder object itself ({id, name, query, favorite}) — the search
         bar subsystem (applySearchFilter/searchInput/showSearchBar/
         renderSmartFolderChips) lives in app.js's own KanvazApp closure,
         not here, so these go through KanvazApp's public API. */
      if (type === 'smartFolder') {
        var folder = target;
        items = [
          { label: 'Open', action: function() {
            if (!KanvazApp.isSearchActive()) KanvazApp.showSearchBar();
            setTimeout(function() {
              var input = KanvazApp.getSearchInput();
              if (input) input.value = folder.query;
              KanvazApp.applySearchFilter(folder.query);
            }, 0);
          }},
          { label: folder.favorite ? 'Remove from Favorites' : 'Add to Favorites', action: function() {
            var s = KanvazUI_Extended.getSettings();
            if (!s || !s.smartFolders) return;
            var f = s.smartFolders.filter(function(x) { return x.id === folder.id; })[0];
            if (!f) return;
            f.favorite = !f.favorite;
            KanvazBridge.writeSettings(JSON.stringify(s));
            KanvazApp.renderSmartFolderChips();
          }},
          { label: 'Rename', action: function() {
            showPrompt('Rename Smart Folder', 'New name:', folder.name, function(newName) {
              var s = KanvazUI_Extended.getSettings();
              if (!s || !s.smartFolders) return;
              var f = s.smartFolders.filter(function(x) { return x.id === folder.id; })[0];
              if (!f) return;
              f.name = newName;
              KanvazBridge.writeSettings(JSON.stringify(s));
              KanvazApp.renderSmartFolderChips();
            });
          }},
          { label: 'Edit query', action: function() {
            showPrompt('Edit Smart Folder query', 'Search query:', folder.query, function(newQuery) {
              var s = KanvazUI_Extended.getSettings();
              if (!s || !s.smartFolders) return;
              var f = s.smartFolders.filter(function(x) { return x.id === folder.id; })[0];
              if (!f) return;
              f.query = newQuery;
              KanvazBridge.writeSettings(JSON.stringify(s));
              KanvazApp.renderSmartFolderChips();
            });
          }},
          { sep: true },
          { label: 'Delete', danger: true, action: function() {
            var s = KanvazUI_Extended.getSettings();
            if (!s || !s.smartFolders) return;
            s.smartFolders = s.smartFolders.filter(function(f) { return f.id !== folder.id; });
            KanvazBridge.writeSettings(JSON.stringify(s));
            KanvazApp.renderSmartFolderChips();
          }}
        ];
      }

      for (var i = 0; i < items.length; i++) {
        if (items[i].sep) {
          var sep = document.createElement('div');
          sep.className = 'ctx-sep';
          menu.appendChild(sep);
          continue;
        }
        (function(item) {
          var el = document.createElement('div');
          el.className = 'ctx-item' + (item.danger ? ' danger' : '');
          /* Built via DOM APIs rather than innerHTML — every item.label
             here is a static string today, but building menus from
             textContent/DOM nodes instead of string concatenation means
             a future item sourced from user data (a card name, a tag)
             can't reopen an XSS path just by being added to this list. */
          el.appendChild(document.createTextNode(item.label));
          if (item.shortcut) {
            var shortcutEl = document.createElement('span');
            shortcutEl.className = 'ctx-shortcut';
            shortcutEl.textContent = item.shortcut;
            el.appendChild(shortcutEl);
          }
          el.addEventListener('mousedown', function(ev) {
            ev.preventDefault();
            ev.stopPropagation();
          });
          el.addEventListener('click', function(ev) {
            ev.preventDefault();
            ev.stopPropagation();
            hideContextMenu();
            if (item.action) item.action();
          });
          menu.appendChild(el);
        })(items[i]);
      }

      /* Position — keep within viewport */
      KanvazApp.positionMenuInViewport(menu, x, y);
    }

    function hideContextMenu() {
      var menu = document.getElementById('context-menu');
      if (menu) {
        menu.className = '';
        menu.style.display = 'none';
      }
    }

    function closeAll() {
      closeDialog();
      hideContextMenu();
      /* Live-audit catch: the Shortcuts overlay (`?`, ui.js's
         showShortcuts()) was never included here — Escape is this
         app's universal "close whatever's open" key everywhere else,
         but pressing it with the Shortcuts overlay open did nothing to
         the overlay while still running the rest of this function's
         side effects (KanvazCards.deselectAll(), called by shortcuts.js
         right after closeAll() on Escape) — confirmed live: opened the
         overlay, dispatched a real Escape keydown, overlay was still
         there afterward. Direct DOM removal matches showShortcuts()'s
         own close path (its Close button and backdrop-click handler
         both do exactly this) rather than calling back into ui.js for
         what's a one-line, self-contained fix. */
      var shortcutsOverlay = document.getElementById('shortcuts-overlay');
      if (shortcutsOverlay && shortcutsOverlay.parentNode) shortcutsOverlay.parentNode.removeChild(shortcutsOverlay);
      if (typeof KanvazAnnotate !== 'undefined') KanvazAnnotate.deactivate();
      if (typeof KanvazProperties !== 'undefined') KanvazProperties.close();
      /* Escape closes the side panel's content pane regardless of which
         section was showing — KanvazProperties.close() above only acts
         when Properties specifically was the active section. */
      if (typeof KanvazSidePanel !== 'undefined') KanvazSidePanel.close();
      if (typeof KanvazCanvas !== 'undefined' && KanvazCanvas.isMarqueeModeOn && KanvazCanvas.isMarqueeModeOn()) {
        KanvazCanvas.setMarqueeMode(false);
      }
    }

    var chromeAutoHideOn   = false;
    var chromeHoverZone    = null;
    var chromeRevealTimer  = null;

    /* Audit fix: the revealed top bar doubles as a real OS drag region
       (-webkit-app-region: drag on #moodlock-hover-zone / #titlebar in
       main.css), so grabbing it to move the window is the main reason
       to reveal it at all. But once an OS-native window drag starts,
       the OS owns the mouse — this renderer stops getting reliable
       mouseenter/mouseleave/mousemove events on the dragged element
       until the drag ends. The 700ms auto-hide timer below doesn't
       know a drag is in progress, so it could (and did) fire mid-drag,
       yanking #top-chrome (the actual drag region) out from under the
       user's cursor — chrome vanishes almost immediately and the
       window stops moving, since there's no drag region left to drag.
       chromeDragGuard suspends the hide timer for the whole mousedown-
       to-mouseup gesture on the revealed chrome, regardless of what
       mouse events do or don't fire while the OS has control. */
    var chromeDragGuard     = false;

    /* v6.0.0: this used to OR in Top Mode's own moodlockOn flag too —
       Top Mode is gone (see CHANGELOG), so the persistent Auto-hide
       toolbar setting is the only thing driving chrome visibility now. */
    function chromeAutoHideActive() {
      return chromeAutoHideOn;
    }

    function chromeShow() {
      if (chromeRevealTimer) { clearTimeout(chromeRevealTimer); chromeRevealTimer = null; }
      var app = document.getElementById('app');
      if (app) app.classList.add('moodlock-reveal');
    }

    function chromeScheduleHide() {
      if (chromeDragGuard) return; /* mid window-drag — never hide the drag region out from under the user */
      if (chromeRevealTimer) clearTimeout(chromeRevealTimer);
      /* Short grace delay so moving from the hover zone straight into
         the toolbar/titlebar doesn't immediately hide it again. */
      chromeRevealTimer = setTimeout(function() {
        var app = document.getElementById('app');
        if (app) app.classList.remove('moodlock-reveal');
        chromeRevealTimer = null;
      }, 700);
    }

    function chromeDragStart() {
      chromeDragGuard = true;
      chromeShow();
    }

    function chromeDragEnd() {
      if (!chromeDragGuard) return;
      chromeDragGuard = false;
      chromeScheduleHide();
    }

    /* Coordinate-based fallback for the hover-reveal strip — see the
       call site's own comment on why this exists alongside (not
       instead of) chromeHoverZone's mouseenter/mouseleave pair.
       Deliberately has a dead zone (4px–80px) where it does nothing:
       that's roughly where the revealed #top-chrome itself lives once
       shown, and topChrome already has its own correct mouseenter/
       mouseleave pair for "still interacting with the revealed
       toolbar" — this fallback firing chromeScheduleHide() in that
       range would fight that logic and hide the toolbar out from under
       an active click. Below the dead zone it schedules a hide exactly
       like leaving the hover zone normally would, so a missed
       mouseenter earlier can't leave the chrome stuck open forever
       with nothing left to close it. */
    function chromeEdgeMouseMove(e) {
      /* clientX > 44 matches the hover strip's own real horizontal
         extent (see #moodlock-hover-zone's left:44px in main.css) —
         it starts after the side panel rail on purpose, so hovering
         the rail's own top icon doesn't also spuriously reveal the
         toolbar. */
      if (e.clientY <= 4 && e.clientX > 44) chromeShow();
      else if (e.clientY > 80) chromeScheduleHide();
    }

    /* Turns the hover-reveal chrome mechanic on/off at the DOM level.
       Called whenever chromeAutoHideOn changes — the wasActive/isActive
       comparison is a leftover of when this also had to reconcile
       against Top Mode's own separate flag (now removed, see
       CHANGELOG's v6.0.0 entry); harmless to keep as a plain no-op
       guard against redundant setup/teardown calls. */
    function syncChromeAutoHide(wasActive) {
      var app = document.getElementById('app');
      if (!app) return;
      var isActive = chromeAutoHideActive();
      if (isActive === wasActive) return;

      var topChrome = document.getElementById('top-chrome');

      if (isActive) {
        app.classList.add('moodlock-active');
        chromeHoverZone = document.createElement('div');
        chromeHoverZone.id = 'moodlock-hover-zone';
        chromeHoverZone.addEventListener('mouseenter', chromeShow);
        chromeHoverZone.addEventListener('mouseleave', chromeScheduleHide);
        chromeHoverZone.addEventListener('mousedown', chromeDragStart);
        document.body.appendChild(chromeHoverZone);
        if (topChrome) {
          topChrome.addEventListener('mouseenter', chromeShow);
          topChrome.addEventListener('mouseleave', chromeScheduleHide);
          topChrome.addEventListener('mousedown', chromeDragStart);
        }
        /* window-level, capture phase — an OS-native app-region drag can
           swallow the mouseup on whatever element it started on, so this
           is listened for globally rather than only on chromeHoverZone/
           topChrome to guarantee chromeDragGuard always gets cleared.
           Audit fix: mouseup alone isn't enough — if the window loses
           focus mid-drag (a UAC/native dialog steals focus, an OS
           snap-assist overlay appears, an Alt+Tab lands while the button
           is still down), the terminating mouseup may never be delivered
           to this window's listeners at all, leaving chromeDragGuard
           stuck true forever and permanently disabling auto-hide for
           the rest of the session. blur is the reliable backstop. */
        window.addEventListener('mouseup', chromeDragEnd, true);
        window.addEventListener('blur', chromeDragEnd);
        /* Robustness fix (reported: "hover the top edge doesn't reveal"
           — not reproduced via CDP-simulated input even across a full
           reveal/hide/reveal cycle, but relying ONLY on mouseenter/
           mouseleave on a 16px-tall element that also carries
           -webkit-app-region:drag is fragile in real use: a fast mouse
           movement can cross a thin target without ever firing its own
           mouseenter (the browser only guarantees mousemove sampling,
           not that every pixel-row boundary produces an enter/leave
           pair), and a real OS drag-region's hit-testing is a known
           rough edge for hover events on Windows specifically. This
           window-level mousemove is a coordinate-based fallback that
           doesn't depend on that one enter event ever firing — it
           reveals whenever the cursor is anywhere near the top edge,
           regardless of whether the hover zone's own listener caught
           it. Cheap: one branch per mousemove, only registered while
           auto-hide is actually on. */
        window.addEventListener('mousemove', chromeEdgeMouseMove);
        KanvazBridge.setMoodLockSize(true);
      } else {
        app.classList.remove('moodlock-active', 'moodlock-reveal');
        if (chromeHoverZone) { chromeHoverZone.remove(); chromeHoverZone = null; }
        if (chromeRevealTimer) { clearTimeout(chromeRevealTimer); chromeRevealTimer = null; }
        chromeDragGuard = false;
        window.removeEventListener('mouseup', chromeDragEnd, true);
        window.removeEventListener('blur', chromeDragEnd);
        window.removeEventListener('mousemove', chromeEdgeMouseMove);
        if (topChrome) {
          topChrome.removeEventListener('mouseenter', chromeShow);
          topChrome.removeEventListener('mouseleave', chromeScheduleHide);
          topChrome.removeEventListener('mousedown', chromeDragStart);
        }
        KanvazBridge.setMoodLockSize(false);
      }
    }

    var tabHeld = false;
    var windowDragActive = false;
    var windowDragLastX = 0;
    var windowDragLastY = 0;

    /* Tab+MMB whole-window drag — an alternative way to move the
       window from anywhere on screen, not just a titlebar strip.
       Gated behind holding Tab because plain middle-mouse-drag is
       already used for canvas panning in both Board and Map View;
       without the Tab gate this would collide with that. Tab used to
       also toggle Top Mode on the same keydown (removed in v6.0.0 —
       see CHANGELOG), which made holding it for this drag a known,
       accepted side-effect collision; Tab is unclaimed by anything else
       now, so that tradeoff no longer applies. */
    window.addEventListener('keydown', function(e) {
      if (e.key === 'Tab') tabHeld = true;
    }, true);
    window.addEventListener('keyup', function(e) {
      if (e.key === 'Tab') tabHeld = false;
    }, true);
    window.addEventListener('blur', function() { tabHeld = false; });

    /* Real bug found via live user audit: "when I re-targeted the
       Kanvaz window, the S key (Settings open/close) wasn't working."
       Root cause is bigger than just S — shortcuts.js's whole dispatcher
       has one early `if (inText) return;` gating EVERY single-key
       shortcut (S, L, F, 0, P, C, E, M, H, and more), where `inText` is
       computed from `document.activeElement`'s tag. Switching to another
       app and back does NOT blur whatever textarea/input was focused in
       Chromium — focus state survives a window-level blur/focus cycle by
       design, the same way switching browser tabs and back doesn't blur
       a focused field either. So editing a note, then alt-tabbing away
       and back, leaves `inText` silently true forever afterward, with no
       visual sign anything is still "in edit mode" — every single-key
       shortcut just does nothing until the user happens to click that
       same field again and then click away. Forcing a blur on whatever
       was focused the moment the WINDOW itself loses focus matches what
       a user actually expects ("I left the app, I'm done with that
       field for now") and, as a real bonus, guarantees in-progress edits
       get committed through each field's own existing blur handler
       (history push, dirty-flag, etc.) rather than sitting one alt-tab
       away from being lost if the app closes while the user is away. */
    window.addEventListener('blur', function() {
      var ae = document.activeElement;
      if (ae && ae !== document.body &&
          (ae.tagName === 'TEXTAREA' || ae.tagName === 'INPUT' || ae.tagName === 'SELECT' || ae.isContentEditable)) {
        ae.blur();
      }
    });

    function initTabMmbWindowDrag() {
      window.addEventListener('mousedown', function(e) {
        if (e.button !== 1 || !tabHeld) return;
        e.preventDefault();
        e.stopPropagation();
        windowDragActive = true;
        windowDragLastX = e.screenX;
        windowDragLastY = e.screenY;
      }, true); /* capture phase — intercepts before canvas/map pan handlers */

      window.addEventListener('mousemove', function(e) {
        if (!windowDragActive) return;
        var dx = e.screenX - windowDragLastX;
        var dy = e.screenY - windowDragLastY;
        windowDragLastX = e.screenX;
        windowDragLastY = e.screenY;
        if (dx || dy) KanvazBridge.dragWindowBy(dx, dy);
      }, true);

      window.addEventListener('mouseup', function(e) {
        if (e.button === 1) windowDragActive = false;
      }, true);
    }

    initTabMmbWindowDrag();

    /* Called by ui.js when the persistent "Auto-hide toolbar" setting
       changes. Never touches the statusbar — it's a standing
       preference, not a presentation mode. */
    function setChromeAutoHide(enabled) {
      var app = document.getElementById('app');
      if (!app) return;
      var wasActive = chromeAutoHideActive();
      chromeAutoHideOn = !!enabled;
      syncChromeAutoHide(wasActive);
    }

    function showShortcuts() {
      KanvazUI_Extended.showShortcuts();
    }

    /* Close context menu on outside click */
    document.addEventListener('mousedown', function(e) {
      var menu = document.getElementById('context-menu');
      if (menu && !menu.contains(e.target)) {
        hideContextMenu();
      }
    });

    return {
      toast:               toast,
      showDialog:          showDialog,
      showExportPicker:    showExportPicker,
      confirmExternalLink: confirmExternalLink,
      showPrompt:          showPrompt,
      closeDialog:         closeDialog,
      showCardContextMenu: showCardContextMenu,
      showContextMenu:     showContextMenu,
      hideContextMenu:     hideContextMenu,
      setChromeAutoHide:   setChromeAutoHide,
      /* Bug fix (found live, right after the app-ui.js split): both
         functions actually live in KanvazApp's own closure (part of the
         search-bar subsystem, not moved here) — delegating instead of
         referencing them bare, which threw ReferenceError and left
         window.KanvazUI entirely unassigned. boards.js, commands.js, and
         shortcuts.js all call KanvazUI.showSearchBar()/hideSearchBar()
         directly, so this contract has to keep working from here. */
      showSearchBar:       function() { KanvazApp.showSearchBar(); },
      hideSearchBar:       function() { KanvazApp.hideSearchBar(); },
      closeAll:            closeAll,
      showAbout:           function() { KanvazUI_Extended.showAbout(); },
      showShortcuts:       showShortcuts
    };

  })();
