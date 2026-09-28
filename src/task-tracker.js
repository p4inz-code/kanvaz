/* task-tracker.js — Task Tracker (v1), spec locked 2026-09-23 via a
   10-question Q&A (see docs/ROADMAP.md's "Task Tracker" entry for the
   full locked-decisions record). Built the next session, per the plan.

   Locked shape, deliberately minimal for v1:
     - ONE global list, file-level (same tier as connections[]/sharedCards
       in boards.js — not nested under any one board's own cards[]).
     - A task has: text, done/not-done, an OPTIONAL link to one card
       (click jumps to its board and zooms to it), and up to 5 subtasks.
     - Subtasks gate the parent's done state, but ONLY when subtasks
       actually exist — a task with none toggles done/not-done directly.
     - Both tasks and subtasks are deletable.
     - No undo/redo for v1 (same call already made for Scratch Board
       strokes) — never touches KanvazHistory.
     - Flat list for v1; grouped-by-linked-board is a real, agreed
       fast-follow, not built now — kept out of the data model's way by
       not needing a migration (cardLink is already per-task). */

var KanvazTaskTracker = (function() {

  var MAX_SUBTASKS = 5;
  var tasks = [];   /* [{id, text, done, cardLink, subtasks:[{id,text,done}]}] */

  function nextId(prefix) {
    return prefix + '-' + Date.now() + '-' + Math.random().toString(36).substr(2, 6);
  }

  function markDirty() {
    if (typeof KanvazApp !== 'undefined' && KanvazApp.markDirty) KanvazApp.markDirty();
  }

  function getTask(id) {
    for (var i = 0; i < tasks.length; i++) if (tasks[i].id === id) return tasks[i];
    return null;
  }

  function getSubtask(task, subId) {
    for (var i = 0; i < task.subtasks.length; i++) if (task.subtasks[i].id === subId) return task.subtasks[i];
    return null;
  }

  /* Subtasks gate the parent, ONLY when at least one exists — a task
     with zero subtasks keeps whatever `done` value toggleTask() gave it
     directly, this function is a no-op for it. */
  function recomputeParentDone(task) {
    if (!task.subtasks.length) return;
    var allDone = true;
    for (var i = 0; i < task.subtasks.length; i++) {
      if (!task.subtasks[i].done) { allDone = false; break; }
    }
    task.done = allDone;
  }

  function addTask(text) {
    text = (text || '').trim();
    if (!text) return null;
    var t = { id: nextId('task'), text: text, done: false, cardLink: null, subtasks: [] };
    tasks.push(t);
    markDirty();
    return t;
  }

  function removeTask(id) {
    for (var i = 0; i < tasks.length; i++) {
      if (tasks[i].id === id) { tasks.splice(i, 1); markDirty(); return true; }
    }
    return false;
  }

  function setTaskText(id, text) {
    var t = getTask(id);
    text = (text || '').trim();
    if (!t || !text) return;
    if (t.text === text) return;
    t.text = text;
    markDirty();
  }

  /* No-op (returns false) when the task has subtasks — its done state is
     derived, never directly toggleable, per the locked gating rule. */
  function toggleTask(id) {
    var t = getTask(id);
    if (!t || t.subtasks.length) return false;
    t.done = !t.done;
    markDirty();
    return true;
  }

  function addSubtask(taskId, text) {
    var t = getTask(taskId);
    text = (text || '').trim();
    if (!t || !text || t.subtasks.length >= MAX_SUBTASKS) return null;
    var st = { id: nextId('subtask'), text: text, done: false };
    t.subtasks.push(st);
    recomputeParentDone(t);
    markDirty();
    return st;
  }

  function removeSubtask(taskId, subId) {
    var t = getTask(taskId);
    if (!t) return false;
    for (var i = 0; i < t.subtasks.length; i++) {
      if (t.subtasks[i].id === subId) {
        t.subtasks.splice(i, 1);
        recomputeParentDone(t);
        markDirty();
        return true;
      }
    }
    return false;
  }

  function toggleSubtask(taskId, subId) {
    var t = getTask(taskId);
    if (!t) return;
    var st = getSubtask(t, subId);
    if (!st) return;
    st.done = !st.done;
    recomputeParentDone(t);
    markDirty();
  }

  function setCardLink(taskId, cardId) {
    var t = getTask(taskId);
    if (!t) return;
    t.cardLink = cardId || null;
    markDirty();
  }

  /* null when the task has no subtasks (nothing to show an aggregate
     for) — the caller (renderInto) only shows the "N/M — P%" line when
     this is non-null, matching "visible at a glance... not just bare
     checkmarks with no aggregate" for tasks that actually have parts. */
  function getProgress(t) {
    if (!t.subtasks.length) return null;
    var done = 0;
    for (var i = 0; i < t.subtasks.length; i++) if (t.subtasks[i].done) done++;
    return { done: done, total: t.subtasks.length, pct: Math.round((done / t.subtasks.length) * 100) };
  }

  function getAll() { return tasks; }

  function serialise() {
    return JSON.parse(JSON.stringify(tasks));
  }

  function deserialise(arr) {
    tasks = [];
    if (!Array.isArray(arr)) return;
    for (var i = 0; i < arr.length; i++) {
      var t = arr[i];
      if (!t || typeof t.id !== 'string' || typeof t.text !== 'string') continue;
      var subtasks = [];
      if (Array.isArray(t.subtasks)) {
        for (var j = 0; j < t.subtasks.length && subtasks.length < MAX_SUBTASKS; j++) {
          var st = t.subtasks[j];
          if (st && typeof st.id === 'string' && typeof st.text === 'string') {
            subtasks.push({ id: st.id, text: st.text, done: !!st.done });
          }
        }
      }
      tasks.push({
        id: t.id,
        text: t.text,
        done: !!t.done,
        cardLink: typeof t.cardLink === 'string' ? t.cardLink : null,
        subtasks: subtasks
      });
    }
  }

  /* ── UI (side-panel section, dispatched from sidepanel.js like Boards/
     Properties/Layers/Settings) ── */

  function jumpToCard(cardId) {
    if (typeof KanvazCards === 'undefined' || typeof KanvazBoards === 'undefined') return;
    function focusOnCurrentBoard() {
      if (!KanvazCards.getCard(cardId)) return false;
      KanvazCards.selectCard(cardId);
      if (typeof KanvazCanvas !== 'undefined' && KanvazCanvas.zoomFit) KanvazCanvas.zoomFit([cardId]);
      return true;
    }
    if (focusOnCurrentBoard()) return;
    var boardId = KanvazBoards.findBoardIdForCard && KanvazBoards.findBoardIdForCard(cardId);
    if (!boardId) {
      if (typeof KanvazUI !== 'undefined') KanvazUI.toast('That card no longer exists', 'error');
      return;
    }
    KanvazBoards.switchBoardById(boardId);
    /* switchBoardById rebuilds the whole board DOM synchronously (same
       assumption boards.js's own switch path already makes elsewhere in
       this codebase), so the card exists to select on the very next
       tick — still deferred one frame to be safe against any render
       work that itself schedules a frame. */
    setTimeout(focusOnCurrentBoard, 0);
  }

  function renderInto(container) {
    container.innerHTML = '';

    var header = document.createElement('div');
    header.style.cssText = 'padding:16px 16px 12px;border-bottom:1px solid var(--color-border);flex-shrink:0;';
    var titleRow = document.createElement('div');
    titleRow.style.cssText = 'font-weight:600;font-size:14px;';
    titleRow.textContent = 'Tasks';
    header.appendChild(titleRow);
    var doneCount = 0;
    for (var i = 0; i < tasks.length; i++) if (tasks[i].done) doneCount++;
    var subtitle = document.createElement('div');
    subtitle.style.cssText = 'font-size:11px;color:var(--color-text-3);margin-top:2px;';
    subtitle.textContent = tasks.length ? (doneCount + '/' + tasks.length + ' done') : 'No tasks yet';
    header.appendChild(subtitle);
    container.appendChild(header);

    var body = document.createElement('div');
    body.style.cssText = 'flex:1;overflow-y:auto;padding:12px 16px;';

    /* ── Add task ── */
    var addRow = document.createElement('div');
    addRow.style.cssText = 'display:flex;gap:6px;margin-bottom:14px;';
    var addInput = document.createElement('input');
    addInput.type = 'text';
    addInput.placeholder = 'Add a task…';
    addInput.style.cssText = 'flex:1;padding:7px 9px;background:var(--color-surface-2);border:1px solid var(--color-border);border-radius:6px;color:var(--color-text);font-family:var(--font-ui);font-size:12px;transition:border-color 0.12s;';
    /* Global focus-outline removal (direct request, main.css) means an
       input needs its OWN visible focus cue or it looks completely
       inert while typing — same accent-border convention the dialog's
       own text input already uses. */
    addInput.addEventListener('focus', function() { addInput.style.borderColor = 'var(--color-accent)'; });
    addInput.addEventListener('blur', function() { addInput.style.borderColor = 'var(--color-border)'; });
    function submitAdd() {
      if (addTask(addInput.value)) {
        addInput.value = '';
        renderInto(container);
        return;
      }
      /* Bug found live: clicking + (or pressing Enter) with an empty
         field used to silently do nothing — addTask() correctly refuses
         an empty/whitespace-only task, but nothing told the user WHY
         nothing happened, which reads exactly like a broken button.
         A brief red-flash border + refocus makes the refusal visible. */
      addInput.focus();
      addInput.style.borderColor = 'var(--color-red)';
      setTimeout(function() { addInput.style.borderColor = 'var(--color-border)'; }, 400);
    }
    addInput.addEventListener('keydown', function(e) {
      e.stopPropagation();
      if (e.key === 'Enter') { e.preventDefault(); submitAdd(); }
    });
    var addBtn = document.createElement('button');
    addBtn.textContent = '+';
    addBtn.title = 'Add task';
    addBtn.style.cssText = 'width:30px;flex-shrink:0;background:var(--color-accent-bg);border:1px solid var(--color-border);border-radius:6px;color:var(--color-accent);font-size:15px;cursor:pointer;transition:background 0.12s, border-color 0.12s;';
    addBtn.onmouseenter = function() { addBtn.style.background = 'var(--color-accent)'; addBtn.style.color = '#fff'; addBtn.style.borderColor = 'var(--color-accent)'; };
    addBtn.onmouseleave = function() { addBtn.style.background = 'var(--color-accent-bg)'; addBtn.style.color = 'var(--color-accent)'; addBtn.style.borderColor = 'var(--color-border)'; };
    addBtn.onclick = submitAdd;
    addRow.appendChild(addInput);
    addRow.appendChild(addBtn);
    body.appendChild(addRow);

    if (!tasks.length) {
      var empty = document.createElement('div');
      empty.style.cssText = 'font-size:12px;color:var(--color-text-3);text-align:center;padding:24px 8px;';
      empty.textContent = 'No tasks yet — add one above to start tracking your work on this file.';
      body.appendChild(empty);
    }

    for (var ti = 0; ti < tasks.length; ti++) {
      body.appendChild(renderTaskRow(tasks[ti], container));
    }

    container.appendChild(body);
  }

  function renderTaskRow(task, panelContainer) {
    var row = document.createElement('div');
    row.style.cssText = 'background:var(--color-surface-2);border:1px solid var(--color-border);border-radius:8px;padding:10px;margin-bottom:8px;transition:border-color 0.15s, box-shadow 0.15s;';
    row.onmouseenter = function() { row.style.borderColor = 'var(--color-border-2)'; row.style.boxShadow = '0 2px 10px var(--color-shadow)'; };
    row.onmouseleave = function() { row.style.borderColor = 'var(--color-border)'; row.style.boxShadow = ''; };

    var mainLine = document.createElement('div');
    mainLine.style.cssText = 'display:flex;align-items:flex-start;gap:8px;';

    var checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = task.done;
    checkbox.className = 'kanvaz-checkbox' + (task.subtasks.length ? ' kanvaz-checkbox-gated' : '');
    checkbox.style.cssText = 'margin-top:2px;';
    checkbox.disabled = task.subtasks.length > 0;
    checkbox.title = task.subtasks.length ? 'Completes automatically once every subtask is done' : 'Mark done';
    checkbox.onchange = function() {
      var wasDone = task.done;
      toggleTask(task.id);
      if (!wasDone && task.done && typeof KanvazUI !== 'undefined') KanvazUI.toast('Task done — nice work');
      renderInto(panelContainer);
    };
    mainLine.appendChild(checkbox);

    var textEl = document.createElement('div');
    textEl.style.cssText = 'flex:1;font-size:12px;line-height:1.4;color:var(--color-text);transition:color 0.15s;' + (task.done ? 'text-decoration:line-through;color:var(--color-text-3);' : '') + 'word-break:break-word;cursor:text;';
    textEl.textContent = task.text;
    textEl.title = 'Click to edit';
    textEl.onclick = function() {
      var ta = document.createElement('input');
      ta.type = 'text';
      ta.value = task.text;
      ta.style.cssText = 'flex:1;padding:2px 4px;background:var(--color-surface);border:1px solid var(--color-accent);border-radius:4px;color:var(--color-text);font-family:var(--font-ui);font-size:12px;';
      function commit() { setTaskText(task.id, ta.value); renderInto(panelContainer); }
      ta.addEventListener('keydown', function(e) { e.stopPropagation(); if (e.key === 'Enter') ta.blur(); if (e.key === 'Escape') { ta.value = task.text; ta.blur(); } });
      ta.addEventListener('blur', commit);
      mainLine.replaceChild(ta, textEl);
      ta.focus();
      ta.select();
    };
    mainLine.appendChild(textEl);

    var delBtn = document.createElement('button');
    delBtn.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';
    delBtn.title = 'Delete task';
    delBtn.style.cssText = 'flex-shrink:0;display:flex;align-items:center;justify-content:center;width:20px;height:20px;background:none;border:none;border-radius:4px;color:var(--color-text-3);cursor:pointer;transition:background 0.1s, color 0.1s;';
    delBtn.onmouseenter = function() { delBtn.style.background = 'var(--color-red-bg)'; delBtn.style.color = 'var(--color-red)'; };
    delBtn.onmouseleave = function() { delBtn.style.background = 'none'; delBtn.style.color = 'var(--color-text-3)'; };
    /* Direct request: deleting a task needs a real confirm first (a
       task can carry up to 5 subtasks and a card link — real work to
       recreate if clicked by accident). Same custom dialog every other
       destructive action in this app uses, never a native confirm().
       Subtask deletion stays a direct click — a single subtask line is
       low-stakes enough not to need its own confirm gate. */
    delBtn.onclick = function() {
      if (typeof KanvazUI === 'undefined' || !KanvazUI.showDialog) { removeTask(task.id); renderInto(panelContainer); return; }
      KanvazUI.showDialog(
        'Delete task?',
        '"' + task.text + '"' + (task.subtasks.length ? ' and its ' + task.subtasks.length + ' subtask' + (task.subtasks.length === 1 ? '' : 's') : '') + ' will be removed. This can\'t be undone.',
        [
          { label: 'Delete', cls: 'danger', action: function() { removeTask(task.id); renderInto(panelContainer); } },
          { label: 'Cancel', cls: '', action: function() {} }
        ]
      );
    };
    mainLine.appendChild(delBtn);

    row.appendChild(mainLine);

    /* ── Card link ── */
    var linkRow = document.createElement('div');
    linkRow.style.cssText = 'margin-top:6px;margin-left:24px;display:flex;align-items:center;gap:6px;font-size:10px;';
    if (task.cardLink) {
      var linkedCard = (typeof KanvazCards !== 'undefined') ? KanvazCards.getCard(task.cardLink) : null;
      var linkBtn = document.createElement('button');
      linkBtn.style.cssText = 'background:none;border:none;color:var(--color-accent);cursor:pointer;font-size:10px;padding:0;text-align:left;text-decoration:underline;text-decoration-color:transparent;transition:text-decoration-color 0.1s;';
      linkBtn.textContent = '→ ' + (linkedCard ? (linkedCard.name || 'Untitled') : 'Linked card');
      linkBtn.title = 'Jump to this card';
      linkBtn.onmouseenter = function() { linkBtn.style.textDecorationColor = 'var(--color-accent)'; };
      linkBtn.onmouseleave = function() { linkBtn.style.textDecorationColor = 'transparent'; };
      linkBtn.onclick = function() { jumpToCard(task.cardLink); };
      linkRow.appendChild(linkBtn);
      var unlinkBtn = document.createElement('button');
      unlinkBtn.textContent = 'Unlink';
      unlinkBtn.style.cssText = 'background:none;border:none;color:var(--color-text-3);cursor:pointer;font-size:10px;padding:0;transition:color 0.1s;';
      unlinkBtn.onmouseenter = function() { unlinkBtn.style.color = 'var(--color-red)'; };
      unlinkBtn.onmouseleave = function() { unlinkBtn.style.color = 'var(--color-text-3)'; };
      unlinkBtn.onclick = function() { setCardLink(task.id, null); renderInto(panelContainer); };
      linkRow.appendChild(unlinkBtn);
    } else {
      var linkPickBtn = document.createElement('button');
      linkPickBtn.textContent = '+ Link a card';
      linkPickBtn.style.cssText = 'background:none;border:none;color:var(--color-text-3);cursor:pointer;font-size:10px;padding:0;transition:color 0.1s;';
      linkPickBtn.onmouseenter = function() { linkPickBtn.style.color = 'var(--color-accent)'; };
      linkPickBtn.onmouseleave = function() { linkPickBtn.style.color = 'var(--color-text-3)'; };
      linkPickBtn.onclick = function() { showLinkPicker(task, panelContainer); };
      linkRow.appendChild(linkPickBtn);
    }
    row.appendChild(linkRow);

    /* ── Progress (only when subtasks exist) ── */
    var progress = getProgress(task);
    if (progress) {
      var progWrap = document.createElement('div');
      progWrap.style.cssText = 'margin-top:8px;margin-left:24px;';
      var progLabel = document.createElement('div');
      progLabel.style.cssText = 'font-size:10px;color:var(--color-text-3);margin-bottom:3px;';
      progLabel.textContent = progress.done + '/' + progress.total + ' — ' + progress.pct + '%';
      progWrap.appendChild(progLabel);
      var barTrack = document.createElement('div');
      barTrack.style.cssText = 'height:4px;background:var(--color-surface-3, rgba(255,255,255,0.08));border-radius:2px;overflow:hidden;';
      var barFill = document.createElement('div');
      barFill.style.cssText = 'height:100%;background:var(--color-accent);width:' + progress.pct + '%;transition:width 0.25s ease;';
      barTrack.appendChild(barFill);
      progWrap.appendChild(barTrack);
      row.appendChild(progWrap);
    }

    /* ── Subtasks ── */
    var subList = document.createElement('div');
    subList.style.cssText = 'margin-top:8px;margin-left:24px;';
    for (var si = 0; si < task.subtasks.length; si++) {
      subList.appendChild(renderSubtaskRow(task, task.subtasks[si], panelContainer));
    }
    if (task.subtasks.length < MAX_SUBTASKS) {
      var addSubRow = document.createElement('div');
      addSubRow.style.cssText = 'display:flex;gap:4px;margin-top:4px;';
      var addSubInput = document.createElement('input');
      addSubInput.type = 'text';
      addSubInput.placeholder = 'Add subtask (' + task.subtasks.length + '/' + MAX_SUBTASKS + ')';
      addSubInput.style.cssText = 'flex:1;padding:4px 6px;background:var(--color-surface);border:1px solid var(--color-border);border-radius:4px;color:var(--color-text);font-family:var(--font-ui);font-size:10px;transition:border-color 0.12s;';
      addSubInput.addEventListener('focus', function() { addSubInput.style.borderColor = 'var(--color-accent)'; });
      addSubInput.addEventListener('blur', function() { addSubInput.style.borderColor = 'var(--color-border)'; });
      function submitSubAdd() {
        if (addSubtask(task.id, addSubInput.value)) { renderInto(panelContainer); return; }
        /* Same empty-input feedback fix as the task Add button above. */
        addSubInput.focus();
        addSubInput.style.borderColor = 'var(--color-red)';
        setTimeout(function() { addSubInput.style.borderColor = 'var(--color-border)'; }, 400);
      }
      addSubInput.addEventListener('keydown', function(e) { e.stopPropagation(); if (e.key === 'Enter') { e.preventDefault(); submitSubAdd(); } });
      addSubRow.appendChild(addSubInput);
      subList.appendChild(addSubRow);
    }
    row.appendChild(subList);

    return row;
  }

  function renderSubtaskRow(task, sub, panelContainer) {
    var r = document.createElement('div');
    r.style.cssText = 'display:flex;align-items:center;gap:6px;margin-bottom:4px;';
    var cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = sub.done;
    cb.className = 'kanvaz-checkbox';
    cb.onchange = function() {
      var wasDone = sub.done;
      toggleSubtask(task.id, sub.id);
      if (!wasDone && sub.done && typeof KanvazUI !== 'undefined') KanvazUI.toast('Subtask done');
      renderInto(panelContainer);
    };
    r.appendChild(cb);
    var t = document.createElement('div');
    t.style.cssText = 'flex:1;font-size:11px;transition:color 0.15s;color:' + (sub.done ? 'var(--color-text-3);text-decoration:line-through;' : 'var(--color-text-2);');
    t.textContent = sub.text;
    r.appendChild(t);
    var del = document.createElement('button');
    del.innerHTML = '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';
    del.title = 'Delete subtask';
    del.style.cssText = 'display:flex;align-items:center;justify-content:center;width:16px;height:16px;background:none;border:none;border-radius:3px;color:var(--color-text-3);cursor:pointer;transition:background 0.1s, color 0.1s;';
    del.onmouseenter = function() { del.style.background = 'var(--color-red-bg)'; del.style.color = 'var(--color-red)'; };
    del.onmouseleave = function() { del.style.background = 'none'; del.style.color = 'var(--color-text-3)'; };
    del.onclick = function() { removeSubtask(task.id, sub.id); renderInto(panelContainer); };
    r.appendChild(del);
    return r;
  }

  /* Reuses the app's own custom dialog overlay (never a native picker) —
     a plain <select> of every card on the CURRENT board, since cross-
     board card browsing has no existing UI to hook into (same limitation
     connections.js's own "Connect to" picker already documents). */
  function showLinkPicker(task, panelContainer) {
    if (typeof KanvazUI === 'undefined' || !KanvazUI.showDialog) return;
    var cardsMap = (typeof KanvazCards !== 'undefined') ? KanvazCards.getAll() : {};
    var ids = [];
    for (var id in cardsMap) ids.push(id);
    if (!ids.length) {
      KanvazUI.toast('No cards on this board to link', 'error');
      return;
    }
    var overlay = document.getElementById('dialog-overlay');
    var formEl = document.getElementById('dialog-export-form');
    if (!overlay || !formEl) return;
    var titleEl = document.getElementById('dialog-title');
    var msgEl = document.getElementById('dialog-message');
    var btnsEl = document.getElementById('dialog-btns');
    titleEl.textContent = 'Link a card';
    msgEl.textContent = 'Only cards on the CURRENT board can be linked here.';
    msgEl.style.display = '';
    formEl.innerHTML = '';
    formEl.style.display = 'flex';
    btnsEl.innerHTML = '';

    var sel = document.createElement('select');
    sel.style.cssText = 'flex:1;padding:6px 8px;background:var(--color-surface-2);border:1px solid var(--color-border-2);border-radius:6px;color:var(--color-text);font-family:var(--font-ui);font-size:12px;';
    for (var i = 0; i < ids.length; i++) {
      var c = cardsMap[ids[i]];
      var o = document.createElement('option');
      o.value = ids[i];
      o.textContent = c.name || (c.type + ' card');
      sel.appendChild(o);
    }
    formEl.appendChild(sel);

    function close() {
      overlay.classList.remove('visible');
      formEl.style.display = 'none';
      formEl.innerHTML = '';
    }
    var cancelBtn = document.createElement('button');
    cancelBtn.className = 'btn';
    cancelBtn.textContent = 'Cancel';
    cancelBtn.onclick = close;
    var linkBtn = document.createElement('button');
    linkBtn.className = 'btn primary';
    linkBtn.textContent = 'Link';
    linkBtn.onclick = function() {
      setCardLink(task.id, sel.value);
      close();
      renderInto(panelContainer);
    };
    btnsEl.appendChild(cancelBtn);
    btnsEl.appendChild(linkBtn);
    overlay.classList.add('visible');
  }

  return {
    addTask: addTask,
    removeTask: removeTask,
    setTaskText: setTaskText,
    toggleTask: toggleTask,
    addSubtask: addSubtask,
    removeSubtask: removeSubtask,
    toggleSubtask: toggleSubtask,
    setCardLink: setCardLink,
    getProgress: getProgress,
    getAll: getAll,
    getTask: getTask,
    serialise: serialise,
    deserialise: deserialise,
    renderInto: renderInto,
    jumpToCard: jumpToCard,
    MAX_SUBTASKS: MAX_SUBTASKS
  };

})();
