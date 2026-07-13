var puppeteer;
try {
  puppeteer = require('puppeteer-core');
} catch (e) {
  console.log('SKIP — puppeteer-core not installed (run: npm install puppeteer-core)');
  process.exit(0);
}
var path = require('path');
var fs   = require('fs');
var os   = require('os');

/* ══════════════════════════════════════════
   Find a real Chrome/Chromium binary.
   Never hardcode a path tied to one machine/session — check env
   override first, then common install locations per OS, in order.
   ══════════════════════════════════════════ */
function findChrome() {
  if (process.env.PUPPETEER_EXECUTABLE_PATH &&
      fs.existsSync(process.env.PUPPETEER_EXECUTABLE_PATH)) {
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
    candidates = [
      '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable',
      '/usr/bin/chromium', '/usr/bin/chromium-browser'
    ];
    /* Also check puppeteer's own cache dir for any installed revision,
       instead of hardcoding one exact version string. */
    var cacheRoot = path.join(os.homedir(), '.cache', 'puppeteer', 'chrome');
    if (fs.existsSync(cacheRoot)) {
      var revs = fs.readdirSync(cacheRoot);
      for (var r = 0; r < revs.length; r++) {
        var guess = path.join(cacheRoot, revs[r], 'chrome-linux64', 'chrome');
        candidates.push(guess);
      }
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
    console.log('  Fix: set PUPPETEER_EXECUTABLE_PATH to your Chrome install, e.g.');
    console.log('  Windows: set PUPPETEER_EXECUTABLE_PATH=C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe');
    process.exit(0);
  }

  /* Copy the committed test harness into a real temp file every run —
     never assume a file already sits in /tmp from a previous session. */
  var harnessSrc  = path.join(__dirname, 'port-alignment.html');
  var harnessTemp = path.join(os.tmpdir(), 'kanvaz-porttest.html');
  fs.copyFileSync(harnessSrc, harnessTemp);

  const browser = await puppeteer.launch({
    executablePath: chromePath,
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1400, height: 900 });
  await page.goto('file://' + harnessTemp);

  // Test at multiple zoom/pan levels — the exact conditions that broke before
  const cases = [
    { tx: 0,    ty: 0,   scale: 1.0 },
    { tx: 0,    ty: 0,   scale: 1.5 },   // 150% — the screenshot zoom
    { tx: 200,  ty: 100, scale: 1.5 },   // panned + zoomed
    { tx: -300, ty: -50, scale: 0.5 },   // zoomed out + panned
    { tx: 137,  ty: -88, scale: 2.3 }    // arbitrary messy values
  ];

  let allPass = true;
  for (const c of cases) {
    const r = await page.evaluate((tx,ty,s) => window.runTest(tx,ty,s), c.tx, c.ty, c.scale);
    console.log('\n=== transform: tx='+c.tx+' ty='+c.ty+' scale='+c.scale+' ===');
    for (const p of r.ports) {
      const oe = p.out_error, ie = p.in_error;
      const outOK = Math.abs(oe[0]) < 0.5 && Math.abs(oe[1]) < 0.5;
      const inOK = Math.abs(ie[0]) < 0.5 && Math.abs(ie[1]) < 0.5;
      if (!outOK || !inOK) allPass = false;
      console.log('  Node '+p.node+' OUT: formula='+JSON.stringify(p.out_formula)+
                  ' actual='+JSON.stringify(p.out_actual)+
                  ' error='+JSON.stringify(oe)+' '+(outOK?'PASS':'*** FAIL ***'));
      console.log('  Node '+p.node+' IN:  formula='+JSON.stringify(p.in_formula)+
                  ' actual='+JSON.stringify(p.in_actual)+
                  ' error='+JSON.stringify(ie)+' '+(inOK?'PASS':'*** FAIL ***'));
    }
    // Screen-space check: does the SVG line's start endpoint sit on dot A's screen center?
    console.log('  SVG line endpoint vs dot screen positions:');
    console.log('    dotA (out) screen center:', JSON.stringify(r.dotA_screen_center));
    console.log('    dotB (in)  screen center:', JSON.stringify(r.dotB_screen_center));
  }

  console.log('\n========================================');
  console.log(allPass ? 'ALL CASES PASS — formula matches real DOM at every zoom/pan'
                      : 'SOME CASES FAILED');
  console.log('========================================');

  await browser.close();
  fs.unlinkSync(harnessTemp);
  if (!allPass) process.exit(1);
})();
