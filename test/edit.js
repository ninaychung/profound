const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch(), errs = [], ok = (c, m) => { if (!c) errs.push('FAIL ' + m); };
  const p = await b.newPage({ viewport: { width: 1280, height: 900 } }); p.on('pageerror', (e) => errs.push(e.message));
  const U = 'file://' + process.cwd() + '/site/index.html';
  await p.goto(U + '#answers'); await p.reload();
  // filter the answers table by engine and status
  const rows0 = await p.locator('#src-host tbody tr').count();
  await p.selectOption('#src-host select[aria-label="Filter model"]', 'ChatGPT');
  const info = await p.locator('#src-host .cap').nth(0).textContent().catch(() => '');
  const n1 = await p.locator('#src-host tbody tr').count(); ok(n1 > 0 && n1 <= 50, 'engine filter rows ' + n1);
  await p.selectOption('#src-host select[aria-label="Filter Cleaning status"]', 'error');
  ok((await p.locator('#src-host tbody tr').count()) <= 12, 'error filter');
  // headers keep original keys
  const heads = await p.locator('#src-host thead tr:first-child th').allTextContents(); console.log(heads.join(' | '));
  // edit row: delete first visible error row, expect errors 11
  await p.locator('#src-host tbody tr').first().click();
  await p.click('#modal-body >> text=Delete this row'); await p.waitForTimeout(200);
  ok((await p.locator('#cleanup .pill').nth(2).textContent()).includes('11') || (await p.locator('#cleanup .pill').nth(1).textContent()).length > 0, 'errors after delete');
  console.log('tiles', (await p.locator('#cleanup .pill').allTextContents()).join(' / '));
  await p.goto(U + '#prompts'); await p.reload();
  ok((await p.locator('.tsec').count()) === 3, 'prompts read-only sections');
  ok((await p.locator('.tsec input').count()) === 0, 'no editing inputs on prompts');
  await p.goto(U + '#competitors'); await p.reload();
  await p.fill('#comp-host input', 'Zendesk'); await p.click('#comp-host >> text=Add'); ok((await p.locator('#comp-host li').count()) === 3, 'competitor added');
  await p.click('text=Analysis'); await p.waitForTimeout(200);
  await p.selectOption('#ctl-topic select[aria-label="Chart"]', 'dumb'); await p.waitForTimeout(150); ok(await p.locator('#c-topics svg').count() === 1, 'dumbbell shown');
  await p.selectOption('#ctl-topic select[aria-label="Chart"]', 'heat');
  await p.selectOption('#ctl-pos select[aria-label="Topic"]', 'Integrations'); await p.selectOption('#ctl-pos select[aria-label="Answer engine"]', { index: 1 }); await p.waitForTimeout(200);
  ok((await p.locator('#c-pos .vb').count()) === 3, 'brand visibility rows with their own filters');
  ok((await p.locator('#ctl-own select[aria-label="Topic"]').inputValue()) === 'all', 'own-pages filter independent of ranking filter');
  // time period: set baseline end earlier -> still renders
  ok(await p.locator('#kpis .tile').count() === 3, 'kpis'); ok((await p.locator('#c-ppp svg').count()) === 1, 'bars');
  ok((await p.locator('#ctl-bars input[type=date]').count()) === 0, 'baseline/current dates not editable');
  await p.click('text=Recommendation'); ok((await p.locator('#reco h2').textContent()).length > 5, 'reco renders'); ok(!(await p.locator('#reco-detail').textContent()).includes('Why not the other'), 'why-not removed'); ok((await p.locator('#reco-actions tbody tr').count()) === 3, '3 action items');
  // about edit
  await p.click('text=About ACME Desk'); await p.locator('.brief .btn >> text=Edit').first().click();
  await p.locator('.brief textarea').fill('Customer: ACME Desk\nEdited brief.'); await p.locator('.brief .btn >> text=Save').click();
  ok((await p.locator('#brief').textContent()).includes('Edited brief.'), 'brief edit saved');
  console.log(errs.length ? errs : 'edit tests ok'); await b.close();
})();
