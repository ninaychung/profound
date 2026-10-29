const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1200, height: 900 } });
  const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  await p.goto('file://' + process.cwd() + '/site/index.html'); await p.waitForTimeout(500);
  await p.locator('#c-topics .hit').first().click(); await p.waitForTimeout(300);
  console.log('drawer open:', await p.locator('#drawer.open').count(), '| calc box:', await p.locator('#drawer .calc').count(), '| cards:', await p.locator('#drawer .ans').count());
  console.log((await p.locator('#drawer .calc pre').innerText()).split('\n').slice(0, 9).join('\n'));
  await p.keyboard.press('Escape');
  // competitor + ranked-first metric
  await p.selectOption('#f-brand', 'Relay Inbox'); await p.selectOption('#f-metric', 'first'); await p.waitForTimeout(300);
  console.log('view note:', await p.locator('#view-note').isVisible(), '| topics title:', await p.locator('#c-topics').evaluate(e => e.closest('section').querySelector('h2').innerText));
  console.log('tooltip sample:'); await p.locator('#c-topics .hit').first().hover(); await p.waitForTimeout(150); console.log((await p.locator('#tip').innerText()).split('\n').slice(0, 4).join(' | '));
  await p.screenshot({ path: 'test/relay.png', fullPage: false });
  await p.selectOption('#f-brand', 'ACME Desk'); await p.selectOption('#f-metric', 'mention');
  // under the hood tabs
  await p.click('[data-tab="checks"]'); console.log('check rows:', await p.locator('#tab-checks tbody tr').count());
  await p.click('[data-tab="code"]'); console.log('code chars:', (await p.locator('#tab-code pre').innerText()).length);
  await p.selectOption('#tab-code select', 'py'); console.log('py starts:', (await p.locator('#tab-code pre').innerText()).slice(0, 40));
  await p.click('[data-tab="data"]'); await p.fill('#tab-data input[type=search]', 'a0502'); await p.waitForTimeout(150); console.log('search rows:', await p.locator('#src-rows tbody tr').count());
  await p.selectOption('#tab-data select', 'error'); await p.fill('#tab-data input[type=search]', ''); await p.waitForTimeout(150); console.log('error rows:', await p.locator('#src-rows tbody tr').count());
  await p.locator('#src-rows tbody tr').first().click(); await p.waitForTimeout(150); console.log('error drawer:', (await p.locator('#drawer .sub').innerText()).slice(0, 60)); await p.keyboard.press('Escape');
  // bad format message
  const msg = await p.evaluate(() => { try { window.AEO.loadText('{"id":"x","prompt_id":"p11","model":"m"}'); return 'no error'; } catch (e) { return e.message; } });
  console.log('bad format ->', msg.slice(0, 120));
  // dup/err counts
  console.log('hygiene:', await p.textContent('#hyg'));
  await p.screenshot({ path: 'test/full.png', fullPage: true });
  await p.setViewportSize({ width: 390, height: 800 }); await p.waitForTimeout(400); await p.screenshot({ path: 'test/mobile.png', fullPage: true });
  await p.setViewportSize({ width: 1200, height: 900 }); await p.click('#theme'); await p.waitForTimeout(300); await p.screenshot({ path: 'test/dark.png' });
  console.log('errors:', errs); await b.close();
})();
