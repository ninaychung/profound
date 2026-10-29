// Loads the built site, checks for JS errors, compares numbers with the Python output, takes screenshots.
const { chromium } = require('playwright');
const fs = require('fs');
(async () => {
  const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1200, height: 900 } });
  const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  await p.goto('file://' + process.cwd() + '/site/index.html'); await p.waitForTimeout(500);
  const js = await p.evaluate(() => window.AEO.summary());
  const py = JSON.parse(fs.readFileSync('sample_output/metrics.json'));
  let bad = 0; const chk = (n, a, c) => { if (Math.abs(a - c) > 1e-9) { bad++; console.log('MISMATCH', n, a, c); } };
  py.topics.forEach(t => { const j = js.topics.find(x => x.topic === t.topic); chk(t.topic + ' base', j.b, t.baseline); chk(t.topic + ' curr', j.c, t.current); chk(t.topic + ' d', j.d, t.change_pp); });
  py.prompts.forEach(t => { const j = js.prompts.find(x => x.id === t.prompt_id); chk(t.prompt_id, j.d, t.change_pp); });
  chk('overall base', js.overallBalanced[0], py.overall.balanced_vis.baseline); chk('overall curr', js.overallBalanced[1], py.overall.balanced_vis.current);
  py.topics.forEach(t => { const j = js.topics.find(x => x.topic === t.topic); chk(t.topic + ' ci lo', j.ci[0], t.ci95_pp[0]); chk(t.topic + ' ci hi', j.ci[1], t.ci95_pp[1]); chk(t.topic + ' rel', j.rel, t.relative_change); for (const m in t.per_model_p) chk(t.topic + ' p ' + m, j.p[m], t.per_model_p[m]); chk(t.topic + ' raw cur k', j.raw.c.k, t.raw.current.k); });
  const pyc = py.checks.map(c => c.name + ':' + c.status).sort().join('|'), jsc = js.checks.map(c => c[0] + ':' + c[1]).sort().join('|'); if (pyc !== jsc) { bad++; console.log('CHECK MISMATCH\n', pyc, '\n', jsc); }
  py.winners.forEach(wr => { const j = js.winners.find(x => x.topic === wr.topic && x.window === wr.window); py.brands.forEach(b => chk('winner ' + wr.topic + wr.window + b, j[b], wr[b])); });
  chk('ok', js.hygiene.ok, py.hygiene.successful_answers); chk('dupes', js.hygiene.dupes, py.hygiene.duplicate_rows_removed); chk('errors', js.hygiene.errors, py.hygiene.error_rows_excluded);
  console.log('parity mismatches:', bad, '| js errors:', errs);
  await p.screenshot({ path: 'test/full.png', fullPage: true });
  await p.setViewportSize({ width: 390, height: 800 }); await p.waitForTimeout(400); await p.screenshot({ path: 'test/mobile.png', fullPage: true });
  await b.close();
})();
