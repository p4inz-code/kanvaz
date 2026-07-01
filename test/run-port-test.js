const puppeteer = require('puppeteer-core');
const path = require('path');

(async () => {
  const browser = await puppeteer.launch({
    executablePath: '/home/claude/.cache/puppeteer/chrome/linux-131.0.6778.204/chrome-linux64/chrome',
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1400, height: 900 });
  await page.goto('file://' + path.resolve('/tmp/porttest.html'));

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
})();
