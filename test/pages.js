const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch(), errs = [];
  for (const [n, vp] of [['d', { width: 1280, height: 900 }], ['m', { width: 390, height: 800 }]]) {
    const p = await b.newPage({ viewport: vp }); p.on('pageerror', (e) => errs.push(n + ' ' + e.message));
    for (const k of ['analysis', 'reco', 'about', 'prompts', 'competitors', 'answers']) {
      await p.goto('file://' + process.cwd() + '/site/index.html#' + k); await p.reload(); await p.waitForTimeout(150);
      await p.screenshot({ path: `shots/q_${n}_${k}.png`, fullPage: k === 'analysis' || k === 'reco' });
      const ov = await p.evaluate(() => document.documentElement.scrollWidth - innerWidth); if (ov > 0) errs.push(n + ' ' + k + ' overflow ' + ov);
    }
  }
  console.log('errors', errs); await b.close();
})();
