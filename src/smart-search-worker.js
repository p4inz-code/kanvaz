/* smart-search-worker.js — Smart Search's lemmatize-and-rank engine,
   off Electron's main process thread.

   Unlike pur-import-worker.js (one task, then done), this worker stays
   alive for as long as Smart Search is enabled — main.js spawns it once
   (see window-set-... wait, see main.js's smart-search-enable handler)
   and reuses it for every index/query call, since loading wink-nlp's
   ~4MB language model is real, one-time work not worth repeating per
   keystroke. Terminated the instant Smart Search is turned off, so
   nothing AI/NLP-related stays resident in memory when the user hasn't
   asked for it — the whole point of the feature's own off switch.

   Pure JS, zero native dependencies (wink-nlp/wink-eng-lite-web-model/
   wink-distance are all dependency-free pure-JS packages) — deliberately
   chosen over a real transformer model (see CHANGELOG's 6.3.0 entry) to
   avoid the native-binary rebuild risk that class of dependency carries
   in an Electron app with no CI step for it. */

var parentPort = require('worker_threads').parentPort;
var winkNLP = require('wink-nlp');
var model = require('wink-eng-lite-web-model');
var dist = require('wink-distance');

var nlp = winkNLP(model);
var its = nlp.its;
var as = nlp.as;

/* { cardId: { bow: {...}, text: 'lemmatized text for substring fallback' } } */
var index = {};

function bowOf(text) {
  if (!text) return {};
  return nlp.readDoc(text).tokens().out(its.lemma, as.bow);
}

parentPort.on('message', function(msg) {
  if (msg.type === 'index') {
    index = {};
    for (var i = 0; i < msg.cards.length; i++) {
      var c = msg.cards[i];
      index[c.id] = bowOf(c.text);
    }
    parentPort.postMessage({ type: 'index-done', requestId: msg.requestId });

  } else if (msg.type === 'query') {
    var qbow = bowOf(msg.query);
    var qKeys = Object.keys(qbow);
    var results = [];
    if (qKeys.length) {
      for (var id in index) {
        var cbow = index[id];
        if (!Object.keys(cbow).length) continue;
        var cosineDist = dist.bow.cosine(qbow, cbow);
        /* cosine distance: 0 = identical bag-of-words, 1 = nothing
           shared. Threshold picked empirically (see the standalone
           verification run before this was wired in) — 0.75 catches
           partial multi-word overlap and single-lemma matches buried
           in a longer tag/name string, without matching two totally
           unrelated short strings that happen to share one common
           word like "a" or "the" (wink's lemma tokenizer already
           filters most stopwords out of the bag, but not all). */
        if (cosineDist <= 0.75) results.push({ id: id, score: 1 - cosineDist });
      }
      results.sort(function(a, b) { return b.score - a.score; });
    }
    parentPort.postMessage({ type: 'query-done', requestId: msg.requestId, results: results.map(function(r) { return r.id; }) });
  }
});
