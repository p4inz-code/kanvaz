/* Theme Creator — an official Kanvaz plugin
   Zero permissions requested: only uses registerTheme, registerSettingsPanel,
   and per-plugin storage, none of which touch the network or filesystem
   outside Kanvaz's own managed plugin-storage folder.

   Ships as a separate release asset, not bundled in the Kanvaz installer —
   install it the same way as any third-party plugin (Settings → Plugins →
   Add a Plugin…). */

(function() {

  /* document.currentScript is only reliable during a script's own initial
     synchronous execution — capture the id now, once, rather than trying
     to re-read it later from inside a button click handler. */
  var PLUGIN_ID = document.currentScript ? document.currentScript.getAttribute('data-plugin-id') : 'studio.northbyte.theme-creator';

  var KANVAZ_DEFAULTS = {
    bg: '#0E0E10', surface: '#1A1A22', accent: '#9D7FFF',
    text: '#DCDCE8', text2: '#A0A0B8',
    success: '#4CAF82', warning: '#F0A500', danger: '#FF5A5A'
  };

  var STARTER_PRESET = {
    id: 'preset-example-midnight-teal',
    name: 'Midnight Teal (example)',
    colors: {
      bg: '#0B1418', surface: '#132228', accent: '#2DD4BF',
      text: '#E2F1EF', text2: '#8FB3AE',
      success: '#4CAF82', warning: '#F0A500', danger: '#FF6B6B'
    },
    pinned: false, starred: false
  };

  var COLOR_FIELDS = [
    { key: 'bg',      label: 'Background' },
    { key: 'surface', label: 'Surface (panels)' },
    { key: 'accent',  label: 'Accent' },
    { key: 'text',    label: 'Text (primary)' },
    { key: 'text2',   label: 'Text (secondary)' },
    { key: 'success', label: 'Success' },
    { key: 'warning', label: 'Warning' },
    { key: 'danger',  label: 'Danger' }
  ];

  /* ── Small self-contained color math — no external dependency ── */

  function hexToRgb(hex) {
    hex = String(hex).replace('#', '');
    if (hex.length === 3) {
      hex = hex.split('').map(function(c) { return c + c; }).join('');
    }
    var num = parseInt(hex, 16) || 0;
    return { r: (num >> 16) & 255, g: (num >> 8) & 255, b: num & 255 };
  }

  function rgbToHex(r, g, b) {
    function h(n) {
      var s = Math.max(0, Math.min(255, Math.round(n))).toString(16);
      return s.length === 1 ? '0' + s : s;
    }
    return '#' + h(r) + h(g) + h(b);
  }

  function rgbString(hex) {
    var c = hexToRgb(hex);
    return c.r + ', ' + c.g + ', ' + c.b;
  }

  function mix(hexA, hexB, amount) {
    var a = hexToRgb(hexA), b = hexToRgb(hexB);
    return rgbToHex(
      a.r + (b.r - a.r) * amount,
      a.g + (b.g - a.g) * amount,
      a.b + (b.b - a.b) * amount
    );
  }

  function lighten(hex, amount) { return mix(hex, '#ffffff', amount); }
  function darken(hex, amount)  { return mix(hex, '#000000', amount); }

  function luminance(hex) {
    var c = hexToRgb(hex);
    return (0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b) / 255;
  }

  /* Builds a complete :root[data-theme="..."] block covering every
     variable the built-in dark/light themes define (see main.css) —
     a full peer theme, not a partial override, so there's never any
     CSS specificity ambiguity with the built-ins. */
  function buildThemeCss(themeId, c) {
    var bgIsLight = luminance(c.bg) > 0.5;
    var step = bgIsLight ? darken : lighten; /* moves away from bg, toward "elevated" surfaces */
    var textInv = luminance(c.text) > 0.5 ? '#0E0E10' : '#FFFFFF';

    var surface2  = step(c.surface, 0.05);
    var surface3  = step(c.surface, 0.10);
    var chrome    = step(c.bg, 0.05);
    var border    = step(c.surface, 0.14);
    var border2   = step(c.surface, 0.22);
    var accentDim = darken(c.accent, 0.15);
    var text3     = mix(c.text2, c.bg, 0.3); /* a third, more washed-out text tone, direction-agnostic */

    return (
      ':root[data-theme="' + themeId + '"] {\n' +
      '  --color-canvas: ' + c.bg + ';\n' +
      '  --color-chrome: ' + chrome + ';\n' +
      '  --color-surface: ' + c.surface + ';\n' +
      '  --color-surface-rgb: ' + rgbString(c.surface) + ';\n' +
      '  --color-surface-2: ' + surface2 + ';\n' +
      '  --color-surface-3: ' + surface3 + ';\n' +
      '  --color-border: ' + border + ';\n' +
      '  --color-border-2: ' + border2 + ';\n' +
      '  --color-port: ' + surface2 + ';\n' +
      '  --color-accent: ' + c.accent + ';\n' +
      '  --color-accent-rgb: ' + rgbString(c.accent) + ';\n' +
      '  --color-accent-dim: ' + accentDim + ';\n' +
      '  --color-accent-bg: rgba(' + rgbString(c.accent) + ', 0.14);\n' +
      '  --color-amber: ' + c.warning + ';\n' +
      '  --color-amber-bg: rgba(' + rgbString(c.warning) + ', 0.12);\n' +
      '  --color-red: ' + c.danger + ';\n' +
      '  --color-red-bg: rgba(' + rgbString(c.danger) + ', 0.12);\n' +
      '  --color-green: ' + c.success + ';\n' +
      '  --color-text: ' + c.text + ';\n' +
      '  --color-text-2: ' + c.text2 + ';\n' +
      '  --color-text-3: ' + text3 + ';\n' +
      '  --color-text-inv: ' + textInv + ';\n' +
      '  --color-shadow: rgba(0, 0, 0, ' + (bgIsLight ? '0.12' : '0.5') + ');\n' +
      '  --color-bg: var(--color-canvas);\n' +
      '  --color-overlay: rgba(0, 0, 0, ' + (bgIsLight ? '0.25' : '0.6') + ');\n' +
      '}\n'
    );
  }

  /* ── Storage ── */

  var storageCache = null; /* { presets: [...] } */

  function loadPresets() {
    if (storageCache) return Promise.resolve(storageCache);
    return KanvazPluginAPI.storage.load(PLUGIN_ID).then(function(data) {
      storageCache = (data && Array.isArray(data.presets)) ? data : { presets: [STARTER_PRESET] };
      return storageCache;
    });
  }

  function savePresets() {
    return KanvazPluginAPI.storage.save(PLUGIN_ID, storageCache || { presets: [] });
  }

  /* ── Registration ── */

  var draft = {};
  COLOR_FIELDS.forEach(function(f) { draft[f.key] = KANVAZ_DEFAULTS[f.key]; });

  function previewDraft() {
    KanvazPluginAPI.registerTheme('__theme-creator-draft__', {
      name: 'Draft (unsaved)',
      css: buildThemeCss('__theme-creator-draft__', draft)
    });
    KanvazPluginAPI.applyTheme('__theme-creator-draft__');
  }

  function registerPresetAsTheme(preset) {
    KanvazPluginAPI.registerTheme(preset.id, {
      name: preset.name,
      css: buildThemeCss(preset.id, preset.colors)
    });
  }

  KanvazPluginAPI.registerSettingsPanel('theme-creator', {
    label: 'Theme Creator',
    render: function(container) {
      container.style.cssText = 'font-size:12px;';

      var intro = document.createElement('div');
      intro.style.cssText = 'color:var(--color-text-3);font-size:11px;margin-bottom:8px;line-height:1.4;';
      intro.textContent = 'Pick colors below for a live preview, then save it as a named preset. Presets are saved on this device.';
      container.appendChild(intro);

      var grid = document.createElement('div');
      grid.style.cssText = 'display:grid;grid-template-columns:1fr 1fr;gap:6px 10px;margin-bottom:10px;';
      container.appendChild(grid);

      COLOR_FIELDS.forEach(function(f) {
        var wrap = document.createElement('label');
        wrap.style.cssText = 'display:flex;align-items:center;gap:6px;cursor:pointer;';

        var input = document.createElement('input');
        input.type = 'color';
        input.value = draft[f.key];
        input.style.cssText = 'width:26px;height:20px;border:1px solid var(--color-border);border-radius:4px;background:none;cursor:pointer;padding:0;';
        input.addEventListener('input', function() {
          draft[f.key] = input.value;
          previewDraft();
        });

        var lbl = document.createElement('span');
        lbl.style.cssText = 'color:var(--color-text-2);font-size:11px;';
        lbl.textContent = f.label;

        wrap.appendChild(input);
        wrap.appendChild(lbl);
        grid.appendChild(wrap);
      });

      /* Save-as-preset row */
      var saveRow = document.createElement('div');
      saveRow.style.cssText = 'display:flex;gap:6px;margin-bottom:10px;';

      var nameInput = document.createElement('input');
      nameInput.type = 'text';
      nameInput.placeholder = 'Preset name';
      nameInput.style.cssText = 'flex:1;background:var(--color-surface-2);border:1px solid var(--color-border);border-radius:4px;color:var(--color-text);padding:4px 6px;font-size:11px;font-family:var(--font-ui);outline:none;';
      saveRow.appendChild(nameInput);

      var saveBtn = document.createElement('button');
      saveBtn.textContent = 'Save as Preset';
      saveBtn.style.cssText = 'background:var(--color-accent-bg);border:1px solid var(--color-accent);border-radius:4px;color:var(--color-accent);padding:4px 8px;font-size:11px;font-family:var(--font-ui);cursor:pointer;white-space:nowrap;';
      saveBtn.onclick = function() {
        var name = (nameInput.value || '').trim();
        if (!name) { nameInput.focus(); return; }
        loadPresets().then(function(data) {
          data.presets.push({
            id: 'preset-' + Date.now(),
            name: name,
            colors: JSON.parse(JSON.stringify(draft)),
            pinned: false,
            starred: false
          });
          return savePresets();
        }).then(function() {
          nameInput.value = '';
          renderPresetsList();
        });
      };
      saveRow.appendChild(saveBtn);
      container.appendChild(saveRow);

      /* Reset to Kanvaz defaults — always available, never affected by
         saved presets. Goes through the same path the Settings Theme
         dropdown itself uses, so it persists correctly. */
      var resetBtn = document.createElement('button');
      resetBtn.textContent = 'Reset to Kanvaz Defaults';
      resetBtn.style.cssText = 'width:100%;margin-bottom:12px;padding:5px;background:transparent;border:1px solid var(--color-border);border-radius:6px;color:var(--color-text-2);font-family:var(--font-ui);font-size:11px;cursor:pointer;';
      resetBtn.onclick = function() {
        if (typeof KanvazUI_Extended !== 'undefined' && KanvazUI_Extended.setTheme) {
          KanvazUI_Extended.setTheme('dark');
        }
        COLOR_FIELDS.forEach(function(f) { draft[f.key] = KANVAZ_DEFAULTS[f.key]; });
        renderColorInputs();
      };
      container.appendChild(resetBtn);

      var presetsHeader = document.createElement('div');
      presetsHeader.style.cssText = 'font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;color:var(--color-text-3);margin-bottom:4px;';
      presetsHeader.textContent = 'Saved Presets';
      container.appendChild(presetsHeader);

      var presetsListEl = document.createElement('div');
      container.appendChild(presetsListEl);

      function renderColorInputs() {
        var inputs = grid.querySelectorAll('input[type="color"]');
        COLOR_FIELDS.forEach(function(f, i) { inputs[i].value = draft[f.key]; });
        previewDraft();
      }

      function renderPresetsList() {
        loadPresets().then(function(data) {
          presetsListEl.innerHTML = '';
          var sorted = data.presets.slice().sort(function(a, b) {
            if (!!a.pinned !== !!b.pinned) return a.pinned ? -1 : 1;
            return 0;
          });
          if (!sorted.length) {
            var empty = document.createElement('div');
            empty.style.cssText = 'color:var(--color-text-3);font-size:11px;padding:4px 0;';
            empty.textContent = 'No presets saved yet.';
            presetsListEl.appendChild(empty);
            return;
          }
          sorted.forEach(function(preset) {
            presetsListEl.appendChild(buildPresetRow(preset, data));
          });
        });
      }

      function buildPresetRow(preset, data) {
        var row = document.createElement('div');
        row.style.cssText = 'display:flex;align-items:center;gap:4px;padding:5px 0;border-bottom:1px solid var(--color-border);';

        var nameEl = document.createElement('span');
        nameEl.style.cssText = 'flex:1;color:var(--color-text);font-size:11px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;cursor:text;';
        nameEl.textContent = (preset.starred ? '★ ' : '') + preset.name;
        nameEl.title = 'Click to rename';
        nameEl.onclick = function() {
          var input = document.createElement('input');
          input.type = 'text';
          input.value = preset.name;
          input.style.cssText = 'flex:1;background:var(--color-surface-2);border:1px solid var(--color-accent);border-radius:3px;color:var(--color-text);padding:1px 4px;font-size:11px;font-family:var(--font-ui);outline:none;';
          function commit() {
            var v = (input.value || '').trim();
            if (v) preset.name = v;
            savePresets().then(renderPresetsList);
          }
          input.addEventListener('blur', commit);
          input.addEventListener('keydown', function(e) { if (e.key === 'Enter') input.blur(); });
          row.replaceChild(input, nameEl);
          input.focus();
          input.select();
        };
        row.appendChild(nameEl);

        function iconBtn(symbol, title, active, onClick) {
          var b = document.createElement('button');
          b.textContent = symbol;
          b.title = title;
          b.style.cssText = 'background:none;border:none;cursor:pointer;font-size:12px;padding:0 3px;color:' + (active ? 'var(--color-accent)' : 'var(--color-text-3)') + ';';
          b.onclick = onClick;
          return b;
        }

        row.appendChild(iconBtn('📌', preset.pinned ? 'Unpin' : 'Pin', preset.pinned, function() {
          preset.pinned = !preset.pinned;
          savePresets().then(renderPresetsList);
        }));
        row.appendChild(iconBtn('★', preset.starred ? 'Unstar' : 'Star', preset.starred, function() {
          preset.starred = !preset.starred;
          savePresets().then(renderPresetsList);
        }));

        var applyBtn = document.createElement('button');
        applyBtn.textContent = 'Apply';
        applyBtn.style.cssText = 'background:var(--color-accent-bg);border:1px solid var(--color-accent);border-radius:4px;color:var(--color-accent);padding:2px 6px;font-size:10px;font-family:var(--font-ui);cursor:pointer;';
        applyBtn.onclick = function() {
          registerPresetAsTheme(preset);
          if (typeof KanvazUI_Extended !== 'undefined' && KanvazUI_Extended.setTheme) {
            KanvazUI_Extended.setTheme(preset.id);
          }
        };
        row.appendChild(applyBtn);

        var editBtn = document.createElement('button');
        editBtn.textContent = 'Edit';
        editBtn.title = 'Load this preset\'s colors into the editor above';
        editBtn.style.cssText = 'background:none;border:none;color:var(--color-text-3);font-size:10px;font-family:var(--font-ui);cursor:pointer;text-decoration:underline;padding:0 3px;';
        editBtn.onclick = function() {
          COLOR_FIELDS.forEach(function(f) { draft[f.key] = preset.colors[f.key] || KANVAZ_DEFAULTS[f.key]; });
          renderColorInputs();
        };
        row.appendChild(editBtn);

        var delBtn = document.createElement('button');
        delBtn.textContent = '✕';
        delBtn.title = 'Delete preset';
        delBtn.style.cssText = 'background:none;border:none;color:var(--color-text-3);font-size:11px;cursor:pointer;padding:0 3px;';
        delBtn.onclick = function() {
          data.presets = data.presets.filter(function(p) { return p.id !== preset.id; });
          storageCache = data;
          savePresets().then(renderPresetsList);
        };
        row.appendChild(delBtn);

        return row;
      }

      renderPresetsList();
    }
  });

})();
