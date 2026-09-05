#!/usr/bin/env node
/* ============================================================
   smart-search-test.js — real-worker-boundary tests for
   smart-search-worker.js (v6.3.0).

   Spawns the actual worker (same file main.js loads), same pattern
   pur-import-test.js's runInWorker() already uses — verifies the real
   process boundary (postMessage/structured-clone), not just the
   lemmatization/similarity logic in isolation. wink-nlp/wink-eng-lite-
   web-model/wink-distance are pure-JS, dependency-free packages
   (deliberately chosen over a transformer model — see CHANGELOG's
   6.3.0 entry for why), so there's no native-binary boundary to worry
   about here the way pur-import-worker.js's Buffer round-trip needed.
   ============================================================ */

var path = require('path');
var Worker = require('worker_threads').Worker;

var pass = true;
function check(name, cond) {
  if (cond) { console.log('  ✓ ' + name); }
  else { console.log('  ✗ ' + name); pass = false; }
}

function withWorker(fn) {
  return new Promise(function(resolve, reject) {
    var w = new Worker(path.join(__dirname, '..', 'src', 'smart-search-worker.js'));
    var pending = {};
    var reqId = 0;
    var settled = false;

    /* Bug-bounty fix: this used to have no self-timeout, unlike
       pur-import-test.js's own runInWorker() — a hung (not erroring)
       worker left this test's promise chain unsettled forever, with
       only validate.js's much coarser outer execSync timeout ever
       stopping it, reporting a generic crash instead of the real cause
       and potentially leaving the worker thread dangling. */
    var timeout = setTimeout(function() {
      if (settled) return;
      settled = true;
      w.terminate();
      reject(new Error('worker test itself timed out'));
    }, 8000);

    w.on('message', function(msg) {
      var cb = pending[msg.requestId];
      if (!cb) return;
      delete pending[msg.requestId];
      cb(msg);
    });
    w.once('error', function(e) {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      reject(e);
    });

    function send(msg) {
      return new Promise(function(res) {
        var id = ++reqId;
        msg.requestId = id;
        pending[id] = res;
        w.postMessage(msg);
      });
    }

    fn(send).then(function(result) {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      w.terminate();
      resolve(result);
    }).catch(function(e) {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      w.terminate();
      reject(e);
    });
  });
}

console.log('\nTest A — lemmatized match: plural/verb-tense query finds singular/base-form card text');
withWorker(function(send) {
  return send({
    type: 'index',
    cards: [
      { id: 'card-1', text: 'red sports car concept art' },
      { id: 'card-2', text: 'blue truck reference' },
      { id: 'card-3', text: 'forest photo mood board' }
    ]
  }).then(function() {
    return send({ type: 'query', query: 'cars' }); /* plural query, singular in the indexed text */
  }).then(function(result) {
    check('worker responded with query-done', result.type === 'query-done');
    check('plural "cars" matches the card containing singular "car"', result.results.indexOf('card-1') !== -1);
    check('unrelated cards are not matched', result.results.indexOf('card-2') === -1 && result.results.indexOf('card-3') === -1);
  });
}).then(function() {
  console.log('\nTest B — partial multi-word overlap ranks above no overlap, exact unrelated text scores nothing');
  return withWorker(function(send) {
    return send({
      type: 'index',
      cards: [
        { id: 'exact',    text: 'red car reference' },
        { id: 'partial',  text: 'red sports car concept art' },
        { id: 'unrelated',text: 'totally different forest scene' }
      ]
    }).then(function() {
      return send({ type: 'query', query: 'red car' });
    }).then(function(result) {
      var exactIdx = result.results.indexOf('exact');
      var partialIdx = result.results.indexOf('partial');
      check('both overlapping cards matched', exactIdx !== -1 && partialIdx !== -1);
      check('closer match (exact) ranks above the looser partial match', exactIdx !== -1 && partialIdx !== -1 && exactIdx < partialIdx);
      check('unrelated text scores no match at all', result.results.indexOf('unrelated') === -1);
    });
  });
}).then(function() {
  console.log('\nTest C — empty query returns no results (never matches everything by accident)');
  return withWorker(function(send) {
    return send({ type: 'index', cards: [{ id: 'x', text: 'anything at all' }] }).then(function() {
      return send({ type: 'query', query: '' });
    }).then(function(result) {
      check('empty query returns zero results', Array.isArray(result.results) && result.results.length === 0);
    });
  });
}).then(function() {
  console.log('\nTest D — re-indexing replaces the previous index, not merges with it');
  return withWorker(function(send) {
    return send({ type: 'index', cards: [{ id: 'old-card', text: 'red car' }] }).then(function() {
      return send({ type: 'index', cards: [{ id: 'new-card', text: 'blue truck' }] });
    }).then(function() {
      return send({ type: 'query', query: 'red car' });
    }).then(function(result) {
      check('a stale card from before re-indexing is gone', result.results.indexOf('old-card') === -1);
    });
  });
}).then(function() {
  console.log(pass ? '\nALL SMART SEARCH TESTS PASSED' : '\nSMART SEARCH TESTS FAILED');
  process.exit(pass ? 0 : 1);
}).catch(function(e) {
  console.log('  ✗ worker threw: ' + e.message);
  console.log('\nSMART SEARCH TESTS FAILED');
  process.exit(1);
});
