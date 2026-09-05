/* Template Maker & Manager — an official Kanvaz plugin
   Zero permissions requested: only uses registerSettingsPanel, the
   Runtime Data API (getCards/createCardFromData), per-plugin storage,
   and the community-templates catalog fetchers — none of which touch
   the network beyond that one fixed, disclosed catalog endpoint (see
   main.js's templates-catalog-fetch(-item) handlers in Kanvaz core).

   Ships as a separate release asset, not bundled in the Kanvaz
   installer — install it the same way as any third-party plugin
   (Settings → Plugins → Add a Plugin…).

   Templates are stored as plain JSON (a card array, the exact shape
   KanvazPluginAPI.getCards() already returns) — this plugin never
   invents its own file format. "Install a community template" fetches
   one such JSON file from this repo's community-templates/ folder and
   both inserts it immediately and saves a local copy, so re-using it
   later never needs the network again. */

(function() {

  var PLUGIN_ID = document.currentScript ? document.currentScript.getAttribute('data-plugin-id') : 'studio.northbyte.template-maker';

  /* Zero permissions declared, never touches a gated namespace — same
     reasoning as theme-creator/main.js's own comment on this: safe to
     read the bare KanvazPluginAPI global from inside deferred callbacks
     here specifically because this plugin never needs a scoped one. */

  function loadData() {
    return KanvazPluginAPI.storage.load(PLUGIN_ID).then(function(data) {
      if (!data || !Array.isArray(data.templates)) return { templates: [] };
      return data;
    });
  }

  function saveData(data) {
    return KanvazPluginAPI.storage.save(PLUGIN_ID, data);
  }

  /* Bumped on every insert so repeatedly inserting the same template
     doesn't stack every copy in the exact same spot — a plain running
     offset, reset each time the Settings panel is freshly rendered
     (there's no reason for it to persist across sessions). */
  var insertOffset = 0;

  function insertTemplateCards(cards) {
    if (!cards || !cards.length) return;
    var minX = Infinity, minY = Infinity;
    for (var i = 0; i < cards.length; i++) {
      if (cards[i].x < minX) minX = cards[i].x;
      if (cards[i].y < minY) minY = cards[i].y;
    }
    if (!isFinite(minX)) { minX = 0; minY = 0; }
    insertOffset += 24;
    var created = 0;
    for (var j = 0; j < cards.length; j++) {
      var c = cards[j];
      var id = KanvazPluginAPI.createCardFromData(
        c,
        (c.x - minX) + insertOffset,
        (c.y - minY) + insertOffset
      );
      if (id) created++;
    }
    KanvazPluginAPI.showToast(
      created === cards.length ? 'Inserted ' + created + ' card(s)' : 'Inserted ' + created + ' of ' + cards.length + ' card(s) — some failed, see console',
      created === cards.length ? 'success' : 'error'
    );
  }

  /* ── Settings panel UI ── */

  function row(container) {
    var el = document.createElement('div');
    el.style.cssText = 'display:flex;align-items:center;gap:8px;padding:8px 0;border-bottom:1px solid var(--color-border);';
    container.appendChild(el);
    return el;
  }

  function smallBtn(label, onClick, cls) {
    var b = document.createElement('button');
    b.textContent = label;
    b.className = 'btn' + (cls ? ' ' + cls : '');
    b.style.cssText = 'font-size:11px;padding:4px 8px;cursor:pointer;';
    b.onclick = onClick;
    return b;
  }

  function render(container) {
    var wrap = document.createElement('div');
    wrap.style.cssText = 'font-family:var(--font-ui);font-size:12px;color:var(--color-text);';
    container.appendChild(wrap);

    var intro = document.createElement('div');
    intro.style.cssText = 'color:var(--color-text-3);font-size:11px;margin-bottom:10px;';
    intro.textContent = 'Save the current board as a reusable template, or insert one you already have. Everything here stays on your machine unless you choose to browse community templates below.';
    wrap.appendChild(intro);

    var saveRow = row(wrap);
    var nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.placeholder = 'Template name';
    nameInput.style.cssText = 'flex:1;background:var(--color-surface-2);border:1px solid var(--color-border-2);border-radius:4px;color:var(--color-text);font-size:12px;padding:5px 8px;';
    saveRow.appendChild(nameInput);
    saveRow.appendChild(smallBtn('Save current board as template', function() {
      var name = nameInput.value.trim();
      if (!name) { KanvazPluginAPI.showToast('Type a name first', 'error'); return; }
      var cards = KanvazPluginAPI.getCards();
      if (!cards.length) { KanvazPluginAPI.showToast('This board has no cards to save', 'error'); return; }
      var snapshot;
      loadData().then(function(data) {
        data.templates.push({ id: 'tpl-' + Date.now(), name: name, createdAt: new Date().toISOString(), cards: cards });
        snapshot = data;
        return saveData(data);
      }).then(function(result) {
        /* Per-plugin storage has a real 5MB cap (see plugin-loader.js) —
           an image/video-heavy board's embedded dataUrls can blow past
           that easily. Without checking result.ok here, a rejected write
           would silently show "Saved" while nothing was actually
           persisted — the template would vanish the moment the Settings
           panel is reopened. */
        if (!result || !result.ok) {
          snapshot.templates.pop();
          KanvazPluginAPI.showToast('Could not save — ' + (result && result.error ? result.error : 'too large for plugin storage. Templates with lots of embedded images/video may not fit.'), 'error');
          return;
        }
        nameInput.value = '';
        KanvazPluginAPI.showToast('Saved "' + name + '" (' + cards.length + ' cards)', 'success');
        renderMyTemplates();
      });
    }));

    var myLabel = document.createElement('div');
    myLabel.style.cssText = 'font-size:11px;color:var(--color-text-3);text-transform:uppercase;letter-spacing:0.06em;margin:14px 0 4px;';
    myLabel.textContent = 'My templates';
    wrap.appendChild(myLabel);

    var myList = document.createElement('div');
    wrap.appendChild(myList);

    function renderMyTemplates() {
      myList.innerHTML = '';
      loadData().then(function(data) {
        if (!data.templates.length) {
          var empty = document.createElement('div');
          empty.style.cssText = 'color:var(--color-text-3);font-size:11px;padding:6px 0;';
          empty.textContent = 'No saved templates yet.';
          myList.appendChild(empty);
          return;
        }
        data.templates.forEach(function(tpl) {
          var r = row(myList);
          var label = document.createElement('span');
          label.style.cssText = 'flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
          label.textContent = tpl.name + ' (' + tpl.cards.length + ')';
          r.appendChild(label);
          r.appendChild(smallBtn('Insert', function() { insertTemplateCards(tpl.cards); }));
          r.appendChild(smallBtn('Rename', function() {
            var next = window.prompt('Rename template:', tpl.name);
            if (!next || !next.trim() || next.trim() === tpl.name) return;
            loadData().then(function(d) {
              var t = d.templates.filter(function(x) { return x.id === tpl.id; })[0];
              if (t) t.name = next.trim();
              return saveData(d);
            }).then(renderMyTemplates);
          }));
          r.appendChild(smallBtn('Delete', function() {
            KanvazPluginAPI.showConfirmDialog('Delete template?', '"' + tpl.name + '" will be removed. This cannot be undone.', [
              { label: 'Delete', cls: 'danger', action: function() {
                loadData().then(function(d) {
                  d.templates = d.templates.filter(function(x) { return x.id !== tpl.id; });
                  return saveData(d);
                }).then(renderMyTemplates);
              } },
              { label: 'Cancel', cls: '', action: function() {} }
            ]);
          }, 'danger'));
        });
      });
    }
    renderMyTemplates();

    /* ── Community templates (network, disclosed) ── */

    var commLabel = document.createElement('div');
    commLabel.style.cssText = 'font-size:11px;color:var(--color-text-3);text-transform:uppercase;letter-spacing:0.06em;margin:16px 0 4px;';
    commLabel.textContent = 'Community templates';
    wrap.appendChild(commLabel);

    var commSub = document.createElement('div');
    commSub.style.cssText = 'color:var(--color-text-3);font-size:11px;margin-bottom:6px;';
    commSub.textContent = 'Fetched from Kanvaz’s own GitHub repo, only when you click Browse below.';
    wrap.appendChild(commSub);

    var commList = document.createElement('div');
    wrap.appendChild(commList);

    var browseBtn = smallBtn('Browse community templates…', function() {
      commList.innerHTML = 'Loading…';
      KanvazPluginAPI.fetchCommunityTemplates().then(function(result) {
        commList.innerHTML = '';
        if (!result || !result.ok) {
          commList.textContent = 'Could not fetch the catalog' + (result && result.error ? ': ' + result.error : '.');
          return;
        }
        if (!result.catalog.length) {
          commList.textContent = 'No community templates listed yet.';
          return;
        }
        result.catalog.forEach(function(entry) {
          var r = row(commList);
          var label = document.createElement('span');
          label.style.cssText = 'flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
          label.title = entry.description || '';
          label.textContent = entry.name + (entry.author ? ' — ' + entry.author : '');
          r.appendChild(label);
          r.appendChild(smallBtn('Install', function() {
            KanvazPluginAPI.fetchTemplateContent(entry.contentUrl).then(function(res) {
              if (!res || !res.ok) {
                KanvazPluginAPI.showToast('Could not fetch this template' + (res && res.error ? ': ' + res.error : ''), 'error');
                return;
              }
              return loadData().then(function(data) {
                data.templates.push({ id: 'tpl-' + Date.now(), name: entry.name, createdAt: new Date().toISOString(), cards: res.cards });
                return saveData(data);
              }).then(function(saveResult) {
                /* Insert regardless of whether the local copy fit
                   (5MB per-plugin storage cap) — a failed local save
                   just means re-using it later needs the network again,
                   not that this install should silently do nothing. */
                if (!saveResult || !saveResult.ok) {
                  KanvazPluginAPI.showToast('Installed, but could not save a local copy (' + (saveResult && saveResult.error ? saveResult.error : 'too large') + ') — you\'ll need to re-fetch it next time', 'error');
                } else {
                  renderMyTemplates();
                }
                insertTemplateCards(res.cards);
              });
            });
          }));
        });
      }).catch(function(e) {
        commList.textContent = 'Could not fetch the catalog: ' + e.message;
      });
    });
    wrap.appendChild(browseBtn);
  }

  KanvazPluginAPI.registerSettingsPanel('template-maker', {
    label: 'Templates',
    render: render
  });

})();
