#!/usr/bin/env node
/* ============================================================
   Kanvaz — plugin-api.js scoped-API test (4.4.0)
   Verifies KanvazPluginLoader's per-plugin permission scoping in a
   real browser: a plugin that didn't declare "server" never sees
   KanvazPluginAPI.mcpBridge at load time; one that did, does; a
   deferred callback using a captured local reference keeps working
   later; and — the specific regression this test exists to catch —
   the bare window.KanvazPluginAPI is genuinely back to the full,
   ungated object once loading finishes, not silently left pointing at
   whichever plugin loaded last. That exact bug shipped in an early
   draft of this feature (a classic-script `var X = ...` top-level
   binding IS window.X, not an independent reference to it — reassigning
   window.KanvazPluginAPI inside the loop also reassigns what the bare
   `KanvazPluginAPI` identifier resolves to everywhere else in the same
   file) and was only caught by running this exact scenario in a real
   browser, not by reading the code.
   Usage: node test/plugin-scope-test.js
   ============================================================ */

var puppeteer;
try {
  puppeteer = require('puppeteer-core');
} catch (e) {
  console.log('SKIP — puppeteer-core not installed (run: npm install puppeteer-core)');
  process.exit(0);
}
var path = require('path');
var fs = require('fs');

function findChrome() {
  if (process.env.PUPPETEER_EXECUTABLE_PATH && fs.existsSync(process.env.PUPPETEER_EXECUTABLE_PATH)) {
    return process.env.PUPPETEER_EXECUTABLE_PATH;
  }
  var candidates = [];
  if (process.platform === 'win32') {
    candidates = [
      'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
      process.env.LOCALAPPDATA + '\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'
    ];
  } else if (process.platform === 'darwin') {
    candidates = [
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Chromium.app/Contents/MacOS/Chromium'
    ];
  } else {
    candidates = ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser'];
    var cacheRoot = path.join(require('os').homedir(), '.cache', 'puppeteer', 'chrome');
    if (fs.existsSync(cacheRoot)) {
      var revs = fs.readdirSync(cacheRoot);
      for (var r = 0; r < revs.length; r++) candidates.push(path.join(cacheRoot, revs[r], 'chrome-linux64', 'chrome'));
    }
  }
  for (var i = 0; i < candidates.length; i++) {
    if (candidates[i] && fs.existsSync(candidates[i])) return candidates[i];
  }
  return null;
}

(async () => {
  var chromePath = findChrome();
  if (!chromePath) {
    console.log('SKIP — no Chrome/Chromium binary found.');
    process.exit(0);
  }

  var pass = true;
  function check(label, cond) {
    console.log((cond ? '  ✓ ' : '  ✗ ') + label);
    if (!cond) pass = false;
  }

  var browser = await puppeteer.launch({ executablePath: chromePath, headless: 'new', args: ['--no-sandbox', '--disable-setuid-sandbox'] });
  var page = await browser.newPage();
  var pageErrors = [];
  page.on('pageerror', function(e) { pageErrors.push(e.message); });

  await page.goto('file://' + path.join(__dirname, 'fixtures', 'plugin-scope-harness.html'));
  await new Promise(function(r) { setTimeout(r, 400); });

  var log = await page.evaluate(function() { return window.__log; });
  var pluginA = (log || []).filter(function(e) { return e.id === 'plugin.no-server'; })[0];
  var pluginB = (log || []).filter(function(e) { return e.id === 'plugin.with-server'; })[0];

  check('no page errors during load', pageErrors.length === 0);
  check('both plugins loaded and self-reported', log && log.length === 2);
  check('a plugin WITHOUT "server" permission does not see mcpBridge at load time', pluginA && pluginA.hasMcpBridge === false);
  check('a plugin WITHOUT "server" permission still sees the ungated registerCardType', pluginA && pluginA.hasCardType === true);
  check('a plugin WITH "server" permission DOES see mcpBridge at load time', pluginB && pluginB.hasMcpBridge === true);
  check('a plugin WITH "server" permission still sees the ungated registerCardType', pluginB && pluginB.hasCardType === true);

  var bypass = await page.evaluate(function() { return window.__bypassAttempt; });
  check('_buildScopedAPI is not reachable on a plugin\'s own scoped API (self-privilege-escalation regression check)', bypass && bypass.builderReachable === false);
  check('calling the (unreachable) builder on a forged manifest never yields mcpBridge', bypass && bypass.forgedScopeHasMcpBridge === false);

  var deferredOk = await page.evaluate(function() { return window.__deferredCallbackHasMcpBridge; });
  check('a deferred callback using its own captured API reference still sees mcpBridge.start later', deferredOk === true);

  var globalAfter = await page.evaluate(function() { return window.__globalAfterAllLoadedHasMcpBridge; });
  check('the resting window.KanvazPluginAPI is the real full/ungated object once loading finishes (regression check)', globalAfter === false);

  var coreStillWorks = await page.evaluate(function() {
    return typeof window.KanvazPluginAPI.registerCardType === 'function' &&
           typeof window.KanvazPluginAPI._getAllCardTypeDefs === 'function' &&
           typeof window.KanvazPluginAPI.mcpBridge === 'undefined';
  });
  check('core Kanvaz internals remain available on the resting global, mcpBridge does not leak into it', coreStillWorks);

  /* ── Concurrency check ──
     Regression test for a real bug the correctness/reliability review
     found: loadEnabledPlugins() (fires automatically at page load) and
     loadUnpacked() (Settings -> "Load unpacked plugin", reachable any
     time) each swap window.KanvazPluginAPI independently, with no
     coordination between them — before the fix, two concurrently in-
     flight calls could interleave their scope-swaps and corrupt which
     scope a given plugin's script actually saw. Fresh page (no plugins
     preloaded yet) so loadEnabledPlugins() genuinely injects plugin-a/b
     with real scope swaps, not a loadedIds-guarded no-op. Both
     scanPlugins() (for a/b) and loadUnpackedPlugin() (for a third
     plugin, c) are given an artificial delay via evaluateOnNewDocument
     (must run before the page's own scripts, so the harness's default-0
     reset doesn't clobber it) so their respective enqueue() calls land
     close enough together to genuinely exercise the shared queue rather
     than trivially completing one before the other starts. */
  var page2 = await browser.newPage();
  var page2Errors = [];
  page2.on('pageerror', function(e) { page2Errors.push(e.message); });
  await page2.evaluateOnNewDocument(function() { window.__concurrentDelayMs = 80; });
  await page2.goto('file://' + path.join(__dirname, 'fixtures', 'plugin-scope-harness.html'));
  var concurrentResult = await page2.evaluate(function() { return window.KanvazPluginLoader.loadUnpacked(); });
  await new Promise(function(r) { setTimeout(r, 400); });

  var log2 = await page2.evaluate(function() { return window.__log; });
  var pluginA2 = (log2 || []).filter(function(e) { return e.id === 'plugin.no-server'; })[0];
  var pluginB2 = (log2 || []).filter(function(e) { return e.id === 'plugin.with-server'; })[0];
  var pluginC2 = (log2 || []).filter(function(e) { return e.id === 'plugin.concurrent-c'; })[0];

  check('concurrency check: no page errors', page2Errors.length === 0);
  check('concurrency check: loadUnpacked() itself reports success', concurrentResult && concurrentResult.ok === true);
  check('concurrency check: all three plugins loaded despite the race (a/b via loadEnabledPlugins, c via loadUnpacked)', log2 && log2.length === 3);
  check('concurrency check: plugin-a (no permission) still correctly lacks mcpBridge', pluginA2 && pluginA2.hasMcpBridge === false);
  check('concurrency check: plugin-b ("server") still correctly HAS mcpBridge', pluginB2 && pluginB2.hasMcpBridge === true);
  check('concurrency check: plugin-c ("server", loaded via the CONCURRENT loadUnpacked call) still correctly HAS mcpBridge', pluginC2 && pluginC2.hasMcpBridge === true);

  var globalAfter2 = await page2.evaluate(function() { return !!(window.KanvazPluginAPI && window.KanvazPluginAPI.mcpBridge); });
  check('concurrency check: resting global is back to the full/ungated API once both operations finish', globalAfter2 === false);

  await browser.close();
  console.log('\n' + (pass ? 'ALL PLUGIN SCOPE TESTS PASSED' : 'SOME PLUGIN SCOPE TESTS FAILED'));
  process.exit(pass ? 0 : 1);
})();
