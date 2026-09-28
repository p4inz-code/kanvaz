#!/usr/bin/env node
/* ============================================================
   task-tracker-test.js — unit tests for src/task-tracker.js's data
   model (the locked v1 spec from docs/ROADMAP.md's Task Tracker entry).

   Runs the REAL src/task-tracker.js source in a vm sandbox (same
   technique history-alias-test.js already uses for a browser-global
   IIFE module) rather than reimplementing its logic — covers: add/
   remove task and subtask, the done/gating rule (a task with subtasks
   can't be toggled directly, its done state is derived), the 5-subtask
   cap, progress aggregation, card-link set/clear, and serialise/
   deserialise round-tripping (including tolerance for a malformed/
   oversized file).
   ============================================================ */

var fs = require('fs');
var path = require('path');
var vm = require('vm');

var pass = true;
function check(name, cond) {
  if (cond) { console.log('  ✓ ' + name); }
  else { console.log('  ✗ ' + name); pass = false; }
}

var sandbox = { console: console, KanvazApp: { markDirty: function() {} } };
vm.createContext(sandbox);
var src = fs.readFileSync(path.join(__dirname, '..', 'src', 'task-tracker.js'), 'utf8');
vm.runInContext(src, sandbox, { filename: 'task-tracker.js' });
var T = sandbox.KanvazTaskTracker;

function run() {
  check('module loaded', typeof T === 'object' && T !== null);
  check('MAX_SUBTASKS is 5, per the locked spec', T.MAX_SUBTASKS === 5);

  /* ── Add / remove task ── */
  var t1 = T.addTask('Write the pitch deck');
  check('addTask returns a real task object', !!t1 && t1.text === 'Write the pitch deck' && t1.done === false && t1.cardLink === null);
  check('a fresh task has no subtasks', Array.isArray(t1.subtasks) && t1.subtasks.length === 0);
  check('addTask rejects an empty/whitespace-only string', T.addTask('   ') === null);
  check('getAll reflects the added task', T.getAll().length === 1);

  var t2 = T.addTask('Second task');
  check('a second independent task can be added', T.getAll().length === 2);
  check('removeTask removes the right one', T.removeTask(t2.id) === true && T.getAll().length === 1);
  check('removeTask on an unknown id is a safe no-op', T.removeTask('nope') === false);

  /* ── Done toggling, no subtasks: direct toggle works ── */
  check('toggleTask flips done on a task with no subtasks', T.toggleTask(t1.id) === true && T.getTask(t1.id).done === true);
  T.toggleTask(t1.id); /* back to false for the rest of the test */

  /* ── Subtasks gate the parent, ONLY once they exist ── */
  var s1 = T.addSubtask(t1.id, 'Slide 1');
  check('addSubtask returns a real subtask', !!s1 && s1.text === 'Slide 1' && s1.done === false);
  check('toggleTask now REFUSES to toggle directly (gated by subtasks)', T.toggleTask(t1.id) === false);
  check('parent done did not change from the refused toggle', T.getTask(t1.id).done === false);

  var s2 = T.addSubtask(t1.id, 'Slide 2');
  T.toggleSubtask(t1.id, s1.id);
  check('parent stays not-done while any subtask is still open', T.getTask(t1.id).done === false);
  T.toggleSubtask(t1.id, s2.id);
  check('parent becomes done automatically once EVERY subtask is done', T.getTask(t1.id).done === true);
  T.toggleSubtask(t1.id, s2.id);
  check('un-completing one subtask un-completes the derived parent', T.getTask(t1.id).done === false);

  /* ── 5-subtask cap ── */
  T.addSubtask(t1.id, 'Slide 3');
  T.addSubtask(t1.id, 'Slide 4');
  var overCap = T.addSubtask(t1.id, 'Slide 5 — one too many');
  check('a task already at 4 subtasks can take a 5th (cap is 5, not 4)', T.getTask(t1.id).subtasks.length === 5);
  var pastCap = T.addSubtask(t1.id, 'Slide 6 — must be refused');
  check('the 6th subtask is refused outright, cap enforced at exactly 5', pastCap === null && T.getTask(t1.id).subtasks.length === 5);

  /* ── removeSubtask re-derives parent done, and re-opens room under the cap ── */
  T.removeSubtask(t1.id, s1.id);
  check('removeSubtask actually removes it', T.getTask(t1.id).subtasks.length === 4);
  var afterRemoveRoom = T.addSubtask(t1.id, 'Slide 5b');
  check('removing a subtask frees a cap slot for a new one', !!afterRemoveRoom && T.getTask(t1.id).subtasks.length === 5);

  /* ── Progress aggregation — null with no subtasks, real numbers with some ── */
  var plain = T.addTask('No subtasks here');
  check('getProgress is null for a task with zero subtasks (no aggregate to show)', T.getProgress(plain) === null);
  var withSubs = T.getTask(t1.id);
  var prog = T.getProgress(withSubs);
  check('getProgress reports done/total/pct correctly', prog !== null && prog.total === 5 && prog.pct === Math.round((prog.done / prog.total) * 100));

  /* ── Card link ── */
  T.setCardLink(t1.id, 'card-abc123');
  check('setCardLink stores the id', T.getTask(t1.id).cardLink === 'card-abc123');
  T.setCardLink(t1.id, null);
  check('setCardLink(null) clears it back to unlinked (optional field)', T.getTask(t1.id).cardLink === null);

  /* ── setTaskText ── */
  T.setTaskText(plain.id, 'Renamed task');
  check('setTaskText renames a task', T.getTask(plain.id).text === 'Renamed task');
  T.setTaskText(plain.id, '   ');
  check('setTaskText ignores an empty rename (keeps the last real value)', T.getTask(plain.id).text === 'Renamed task');

  /* ── Serialise / deserialise round trip ── */
  var snapshot = T.serialise();
  check('serialise returns a plain array matching getAll()', Array.isArray(snapshot) && snapshot.length === T.getAll().length);
  T.deserialise(snapshot);
  check('deserialise round-trips the exact same task count', T.getAll().length === snapshot.length);
  var reloaded = T.getTask(t1.id);
  check('a reloaded task keeps its subtasks and derived state', !!reloaded && reloaded.subtasks.length === 5);

  /* ── deserialise tolerance: malformed / oversized input never throws ── */
  var threw = false;
  try {
    T.deserialise([
      null,
      { id: 'x' } /* missing text — must be skipped, not crash */,
      { id: 'valid-1', text: 'ok', subtasks: (function() {
          /* 20 fake subtasks in a raw save file — deserialise must cap
             at MAX_SUBTASKS on load too, not just via addSubtask(). */
          var arr = [];
          for (var i = 0; i < 20; i++) arr.push({ id: 's' + i, text: 'sub ' + i, done: false });
          return arr;
        })() }
    ]);
  } catch (e) { threw = true; }
  check('deserialise never throws on malformed entries', !threw);
  check('a bad entry (no text) is silently skipped, a good one kept', T.getAll().length === 1 && T.getAll()[0].id === 'valid-1');
  check('deserialise enforces the 5-subtask cap on LOAD too, not just on addSubtask', T.getAll()[0].subtasks.length === 5);
  check('deserialise(undefined/non-array) clears to an empty list, never throws', (function() {
    try { T.deserialise(undefined); return T.getAll().length === 0; } catch (e) { return false; }
  })());

  if (pass) {
    console.log('ALL TASK TRACKER TESTS PASSED');
  } else {
    console.log('SOME TASK TRACKER TESTS FAILED');
    process.exit(1);
  }
}

run();
