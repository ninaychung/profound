const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch(); const errs = [];
  for (const [name, vp] of [['d', { width: 1280, height: 900 }], ['m', { width: 390, height: 800 }]]) {
    const p = await b.newPage({ viewport: vp }); p.on('pageerror', (e) => errs.push(name + ' ' + e.message)); p.on('console', (m) => { if (m.type() === 'error') errs.push(name + ' ' + m.text()); });
    await p.goto('file://' + process.cwd() + '/site/index.html');
    await p.screenshot({ path: `shots/${name}1.png`, fullPage: true });
    await p.click('#load-go');
    for (let n = 2; n <= 9; n++) {
      if (n > 2) await p.click(`.step[data-step="${n - 1}"] .next`);
      await p.waitForTimeout(150);
      await p.screenshot({ path: `shots/${name}${n}.png`, fullPage: true });
    }
    await p.click('#code-btn'); await p.waitForTimeout(100); await p.screenshot({ path: `shots/${name}10.png` });
    // overflow check
    const ov = await p.evaluate(() => document.documentElement.scrollWidth - innerWidth); if (ov > 0) errs.push(name + ' horizontal overflow ' + ov);
  }
  console.log('errors:', errs); await b.close();
})();
