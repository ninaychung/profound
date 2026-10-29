/* ACME Desk answer-engine review. Plain JS, no dependencies, runs entirely in the browser.
   The calculations mirror aeo/analysis.py; test/browser_check.js checks both give the same numbers. */
(function () {
'use strict';
const NS = 'http://www.w3.org/2000/svg';
const MIN_CELL_N = 10, BOOT_N = 2000, BOOT_SEED = 12345;
const REQUIRED = ['answer_id', 'prompt_id', 'model', 'observed_at', 'status', 'mentions', 'citations'];

/* ---------- tiny DOM helpers (all data goes through textContent) ---------- */
function mk(ns, tag, attrs, kids) {
  const e = ns ? document.createElementNS(ns, tag) : document.createElement(tag);
  for (const k in attrs || {}) {
    const v = attrs[k];
    if (v == null || v === false) continue;
    if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (k === 'text') e.textContent = v;
    else e.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids || []) if (c != null) e.append(c.nodeType ? c : document.createTextNode(String(c)));
  return e;
}
const S = (t, a, ...k) => mk(NS, t, a, k);
const H = (t, a, ...k) => mk(null, t, a, k);
const $ = (s) => document.querySelector(s);
const short = (m) => m.split(' ').pop();
const pct = (v, d = 0) => v == null ? 'n/a' : (v * 100).toFixed(d) + '%';
const pp = (v) => v == null ? 'n/a' : (v >= 0 ? '+' : '−') + Math.abs(v).toFixed(0) + ' pp';
const sum = (a) => a.reduce((x, y) => x + y, 0);
const mean = (a) => a.length ? sum(a) / a.length : null;
const ease = (t) => 1 - Math.pow(1 - t, 3);
const kn = (x) => x.k + ' of ' + x.n;

/* ---------- data ---------- */
let D = null;
const st = { brand: 'ACME Desk', metric: 'mention', model: 'all', topic: 'all', d1: 1, d2: 14, cov: 'bal', hidden: new Set(), tab: 'data', code: 'core', q: '', f: 'all', shown: 25 };

function parseJSONL(text) {
  return text.split(/\r?\n/).filter((l) => l.trim()).map((l, i) => {
    try { return JSON.parse(l); } catch (e) { throw new Error('Line ' + (i + 1) + ' is not valid JSON'); }
  });
}
const dayNum = (s) => Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10)) / 864e5;

function build(raw, prompts, rawText) {
  if (!raw.length) throw new Error('No rows found in the answers file.');
  const missing = REQUIRED.filter((k) => !(k in raw[0]));
  if (missing.length) throw new Error('The export is missing expected fields: ' + missing.join(', ') + '. Found: ' + Object.keys(raw[0]).sort().join(', ') + '. The format may have changed; rename the new fields to the expected ones and reload.');
  const pm = {}; prompts.forEach((p) => pm[p.prompt_id] = p);
  const seen = new Set(); let dupes = 0; const table = [];
  const ok = [];
  for (const r of raw) {
    const src = JSON.stringify(r);
    if (seen.has(r.answer_id)) { dupes++; table.push({ id: r.answer_id, status: 'duplicate', r, src }); continue; }
    seen.add(r.answer_id);
    if (r.status !== 'success') { table.push({ id: r.answer_id, status: 'error', r, src }); continue; }
    r.__src = src; ok.push(r); table.push({ id: r.answer_id, status: 'included', r, src });
  }
  let unknown = 0;
  for (const r of ok) {
    r.date = r.observed_at.slice(0, 10);
    if (!pm[r.prompt_id]) unknown++;
    r.topic = pm[r.prompt_id] ? pm[r.prompt_id].topic : null;
    r.br = {}; r.mentions.forEach((m) => r.br[m.brand] = m.position);
  }
  const days = [...new Set(ok.map((r) => r.date))].sort();
  const clusters = []; let cur = [days[0]];
  for (let i = 1; i < days.length; i++) {
    if (dayNum(days[i]) - dayNum(cur[cur.length - 1]) > 3) { clusters.push(cur); cur = []; }
    cur.push(days[i]);
  }
  clusters.push(cur);
  if (clusters.length < 2) throw new Error('Need two observation windows (e.g. Sep 1–14 and Oct 1–14).');
  const b = clusters[0], c = clusters[clusters.length - 1];
  const d = {
    prompts, pm, raw: ok, table, rawText, hygiene: { rawLines: raw.length, dupes, errors: table.filter((t) => t.status === 'error').length, ok: ok.length, unknown },
    baseline: [b[0], b[b.length - 1]], current: [c[0], c[c.length - 1]],
    models: [...new Set(ok.map((r) => r.model))].sort(),
    topicOrder: [...new Set(prompts.map((p) => p.topic))], topics: [],
  };
  const bs = [...new Set(ok.flatMap((r) => Object.keys(r.br)))].sort();
  d.brands = (bs.includes('ACME Desk') ? ['ACME Desk'] : []).concat(bs.filter((x) => x !== 'ACME Desk'));
  d.focal = d.brands[0];
  d.maxDay = Math.max(dayNum(d.baseline[1]) - dayNum(d.baseline[0]), dayNum(d.current[1]) - dayNum(d.current[0])) + 1;
  d.detected = { baseline: d.baseline.slice(), current: d.current.slice() }; d.span = [days[0], days[days.length - 1]];
  tagWindows(d); d.extra = new Set(); refreshTopics(d);
  return d;
}
function tagWindows(d) {
  d.rows = [];
  for (const r of d.raw) {
    if (r.topic == null) continue;
    const inB = r.date >= d.baseline[0] && r.date <= d.baseline[1];
    const inC = r.date >= d.current[0] && r.date <= d.current[1];
    if (!inB && !inC) continue;
    r.w = inB ? 'baseline' : 'current';
    r.day = dayNum(r.date) - dayNum(r.w === 'baseline' ? d.baseline[0] : d.current[0]) + 1;
    d.rows.push(r);
  }
}

/* ---------- metrics ---------- */
/* CALC-START */
const inRange = (r) => r.day >= st.d1 && r.day <= st.d2;
function sub(w, o = {}) {
  return D.rows.filter((r) => r.w === w && inRange(r) && (!o.topic || r.topic === o.topic) && (!o.prompt || r.prompt_id === o.prompt));
}
/* Share of rows satisfying pred. m = 'all' computes the share inside each answer engine first,
   then averages the engines with equal weight ("like-for-like"). m = an engine name uses that engine only. */
function rate(rows, pred, m = st.model) {
  const models = m === 'all' ? D.models : [m]; const per = {}; const vs = [];
  for (const mm of models) {
    const s = rows.filter((r) => r.model === mm); if (!s.length) continue;
    const k = s.filter(pred).length; per[mm] = { n: s.length, k, v: k / s.length }; vs.push(k / s.length);
  }
  return { v: mean(vs), n: sum(Object.values(per).map((x) => x.n)), k: sum(Object.values(per).map((x) => x.k)), per };
}
/* A topic's value is the average of its prompts' like-for-like rates. */
function agg(w, o, pred, m = st.model) {
  if (o.topic) {
    const rs = D.prompts.filter((p) => p.topic === o.topic).map((p) => rate(sub(w, { prompt: p.prompt_id }), pred, m));
    const vs = rs.filter((x) => x.v != null).map((x) => x.v);
    return { v: mean(vs), n: sum(rs.map((x) => x.n)), k: sum(rs.map((x) => x.k)), per: rate(sub(w, o), pred, m).per };
  }
  return rate(sub(w, o), pred, m);
}
const mentions = (b) => (r) => b in r.br;
const first = (b) => (r) => r.br[b] === 1;
const citesOwn = (b) => { const slug = b.toLowerCase().replace(/ /g, '-'); return (r) => r.citations.some((c) => c.url.includes(slug)); };
const metricPred = (b = st.brand) => st.metric === 'first' ? first(b) : mentions(b);
const metricName = () => st.metric === 'first' ? 'Ranked-first rate' : 'Mention rate';

/* --- uncertainty: seeded bootstrap of a topic's like-for-like change (same algorithm as analysis.py) --- */
function mulberry32(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
const bootCache = new Map();
function bootCI(topic, pred, key, m) {
  const ck = [D.rawText.length, key, topic, m, st.d1, st.d2, D.baseline.join(), D.current.join()].join('|');
  if (bootCache.has(ck)) return bootCache.get(ck);
  const models = m === 'all' ? D.models : [m];
  const pids = D.prompts.filter((p) => p.topic === topic).map((p) => p.prompt_id);
  const cells = {};
  for (const w of ['baseline', 'current']) for (const p of pids) {
    cells[w + p] = [];
    for (const mm of models) {
      const v = sub(w, { prompt: p }).filter((r) => r.model === mm && r.topic === topic).sort((a, z) => a.answer_id < z.answer_id ? -1 : a.answer_id > z.answer_id ? 1 : 0).map((r) => pred(r) ? 1 : 0);
      if (v.length) cells[w + p].push(v);
    }
  }
  const rnd = mulberry32(BOOT_SEED + D.topics.indexOf(topic)), diffs = [];
  for (let i = 0; i < BOOT_N; i++) {
    const side = {};
    for (const w of ['baseline', 'current']) {
      const pr = [];
      for (const p of pids) {
        const mr = [];
        for (const arr of cells[w + p]) { const n = arr.length; let k = 0; for (let j = 0; j < n; j++) k += arr[Math.floor(rnd() * n)]; mr.push(k / n); }
        if (mr.length) pr.push(mean(mr));
      }
      side[w] = mean(pr);
    }
    diffs.push((side.current - side.baseline) * 100);
  }
  diffs.sort((a, z) => a - z);
  const out = [diffs[Math.floor(0.025 * BOOT_N)], diffs[Math.floor(0.975 * BOOT_N)]];
  bootCache.set(ck, out); return out;
}
function erf(x) { const s = x < 0 ? -1 : 1; x = Math.abs(x); const t = 1 / (1 + 0.3275911 * x); return s * (1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x)); }
function twoPropP(k1, n1, k2, n2) {
  if (!n1 || !n2) return null; const p = (k1 + k2) / (n1 + n2), se = Math.sqrt(p * (1 - p) * (1 / n1 + 1 / n2));
  if (se === 0) return 1; return 1 - erf(Math.abs((k2 / n2 - k1 / n1) / se) / Math.SQRT2);
}
/* CALC-END */
const avgPos = (rows, b) => mean(rows.filter((r) => b in r.br).map((r) => r.br[b]));
const brandColor = (b) => ['var(--s1)', 'var(--s2)', 'var(--s3)'][D.brands.indexOf(b)] || 'var(--muted)';
function full(fn) { const s = { ...st }; st.d1 = 1; st.d2 = D.maxDay; st.model = 'all'; try { return fn(); } finally { Object.assign(st, s); } }

function topicRows(pred, m = st.model, key = 'x') {
  return D.topics.map((t) => {
    const b = agg('baseline', { topic: t }, pred, m), c = agg('current', { topic: t }, pred, m);
    const pmod = D.models.map((mm) => {
      const bb = agg('baseline', { topic: t }, pred, mm), cc = agg('current', { topic: t }, pred, mm);
      const pb = bb.per[mm] || { k: 0, n: 0 }, pc = cc.per[mm] || { k: 0, n: 0 };
      return { m: mm, b: bb.v, c: cc.v, nb: pb.n, nc: pc.n, kb: pb.k, kc: pc.k, p: twoPropP(pb.k, pb.n, pc.k, pc.n) };
    });
    const moves = pmod.filter((x) => x.b != null && x.c != null).map((x) => x.c - x.b);
    const raw = { b: { k: sub('baseline', { topic: t }).filter(pred).length, n: sub('baseline', { topic: t }).length }, c: { k: sub('current', { topic: t }).filter(pred).length, n: sub('current', { topic: t }).length } };
    return { topic: t, b: b.v, c: c.v, d: (c.v - b.v) * 100, rel: b.v ? (c.v - b.v) / b.v : null, nb: b.n, nc: c.n, pmod, raw,
      down: moves.length > 0 && moves.every((x) => x < 0), up: moves.length > 0 && moves.every((x) => x > 0), pred, m, key };
  }).sort((a, b) => a.d - b.d);
}
function withCI(rows) { rows.forEach((t) => { t.ci = bootCI(t.topic, t.pred, t.key, t.m); }); return rows; }
function promptRows(topic, pred = metricPred(), m = st.model) {
  return D.prompts.filter((p) => !topic || topic === 'all' || p.topic === topic).map((p) => {
    const b = agg('baseline', { prompt: p.prompt_id }, pred, m), c = agg('current', { prompt: p.prompt_id }, pred, m);
    const cells = [...Object.values(b.per), ...Object.values(c.per)].map((x) => x.n);
    const minN = cells.length ? Math.min(...cells) : 0;
    return { p, b: b.v, c: c.v, d: b.v == null || c.v == null ? null : (c.v - b.v) * 100, minN, thin: minN < MIN_CELL_N, bn: b.n, cn: c.n, bper: b.per, cper: c.per };
  }).filter((x) => x.d != null).sort((a, b) => Math.abs(a.d - b.d) > 1e-6 ? a.d - b.d : a.p.prompt_id.localeCompare(b.p.prompt_id));
}
const focalRows = () => withCI(topicRows(mentions(D.focal), 'all', 'focal'));

/* ---------- tooltip ---------- */
const tipEl = () => $('#tip');
function showTip(evt, strong, lines) {
  const t = tipEl(); t.textContent = '';
  t.append(H('b', { text: strong }));
  (lines || []).forEach((l) => t.append(H('div', { class: 'r', text: l })));
  t.style.opacity = 1;
  const x = (evt.clientX != null ? evt.clientX : 0), y = (evt.clientY != null ? evt.clientY : 0);
  t.style.left = Math.min(x + 14, window.innerWidth - 300) + 'px';
  t.style.top = Math.min(y + 14, window.innerHeight - 140) + 'px';
}
const hideTip = () => { tipEl().style.opacity = 0; };
function hit(el, strong, lines, click) {
  el.addEventListener('pointermove', (e) => showTip(e, strong, lines));
  el.addEventListener('pointerleave', hideTip);
  el.addEventListener('focus', () => { const r = el.getBoundingClientRect(); showTip({ clientX: r.left + r.width / 2, clientY: r.top }, strong, lines); });
  el.addEventListener('blur', hideTip);
  if (click) {
    el.setAttribute('tabindex', '0'); el.setAttribute('role', 'button');
    const v = curView, run = (e) => (v ? withView(v, () => click(e)) : click(e));
    el.addEventListener('click', run);
    el.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); run(e); } });
  }
  return el;
}
function tween(ms, fn) {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) { fn(1); return; }
  const t0 = performance.now();
  (function f(now) { const t = Math.min(1, (now - t0) / ms); fn(t); if (t < 1) requestAnimationFrame(f); })(t0);
}

/* ---------- drawer (the evidence) ---------- */
function openDrawer(title, sub, groups, intro) {
  const dr = $('#drawer'), body = dr.querySelector('.body');
  dr.querySelector('h2').textContent = title; dr.querySelector('.sub').textContent = sub || '';
  body.textContent = '';
  if (intro) body.append(intro);
  groups.forEach((g) => {
    body.append(H('h3', { text: g.heading + ' (' + g.rows.length + ')', style: 'font-size:14px;margin:12px 0 6px' }));
    if (!g.rows.length) body.append(H('p', { class: 'muted', text: 'No matching answers.' }));
    g.rows.slice(0, 40).forEach((r) => body.append(answerCard(r)));
    if (g.rows.length > 40) body.append(H('p', { class: 'muted', text: '…and ' + (g.rows.length - 40) + ' more.' }));
  });
  dr.classList.add('open'); dr.setAttribute('aria-hidden', 'false');
  dr.querySelector('button').focus();
}
function answerCard(r) {
  const tags = D.brands.map((b) => H('span', { class: 'tag', style: b in r.br ? 'border-color:' + brandColor(b) : 'opacity:.4', text: b in r.br ? '#' + r.br[b] + ' ' + b : 'no ' + b }));
  return H('div', { class: 'ans' },
    H('div', null, H('code', { text: r.answer_id }), ' · ' + r.date + ' · ' + r.model + ' · ' + r.prompt_id + ' (' + (r.w || 'outside windows') + ')'),
    H('div', { class: 'muted', text: D.pm[r.prompt_id] ? D.pm[r.prompt_id].prompt : '', style: 'margin:2px 0 6px' }),
    H('div', null, ...tags),
    H('pre', { text: r.response_text }),
    H('div', { class: 'muted', text: 'Cited: ' + (r.citations.map((c) => c.url.split('//')[1]).join(', ') || 'none') }),
    H('details', null, H('summary', { text: 'Raw record' }), H('pre', { class: 'code', text: JSON.stringify(JSON.parse(r.__src), null, 1) })));
}
function closeDrawer() { const dr = $('#drawer'); dr.classList.remove('open'); dr.setAttribute('aria-hidden', 'true'); }
function scopeLabel() { return 'Engines: ' + (st.model === 'all' ? 'all (equal weight)' : st.model) + ' · days ' + st.d1 + '–' + st.d2; }
function showAnswers(title, filt, intro) {
  openDrawer(title, scopeLabel(), ['baseline', 'current'].map((w) => ({
    heading: (w === 'baseline' ? 'Baseline ' : 'Current ') + (w === 'baseline' ? D.baseline : D.current).join(' to '),
    rows: sub(w).filter((r) => (st.model === 'all' || r.model === st.model) && filt(r)),
  })), intro);
}

/* "How this number was built": the arithmetic, with the real counts */
function calcNode(t, brand, label) {
  const box = H('div', { class: 'calc' });
  box.append(H('h3', { text: 'How this number was built', style: 'font-size:14px;margin:0 0 6px' }));
  const lines = [];
  const eng = st.model === 'all' ? D.models : [st.model];
  ['baseline', 'current'].forEach((w) => {
    const rr = [];
    const a = agg(w, { topic: t.topic }, t.pred, t.m);
    eng.forEach((mm) => { const p = a.per[mm]; if (p) rr.push([mm, p]); });
    const win = (w === 'baseline' ? 'Baseline ' + D.baseline[0].slice(5) + ' to ' + D.baseline[1].slice(5) : 'Current ' + D.current[0].slice(5) + ' to ' + D.current[1].slice(5));
    lines.push(win + ':');
    rr.forEach(([mm, p]) => lines.push('   ' + mm + ': ' + p.k + ' of ' + p.n + ' answers ' + (st.metric === 'first' && t.key !== 'focal' ? 'rank ' + brand + ' first' : 'mention ' + brand) + ' = ' + pct(p.v, 1)));
    const rawk = sum(rr.map(([, p]) => p.k)), rawn = sum(rr.map(([, p]) => p.n));
    lines.push('   Raw (all answers pooled): ' + rawk + ' / ' + rawn + ' = ' + pct(rawk / rawn, 1));
    if (rr.length > 1) lines.push('   Like-for-like (average of the engine rates): (' + rr.map(([, p]) => pct(p.v, 1)).join(' + ') + ') / ' + rr.length + ' = ' + pct(a.v, 1));
  });
  const d = (t.c - t.b) * 100;
  lines.push('Change = ' + pct(t.c, 1) + ' − ' + pct(t.b, 1) + ' = ' + pp(d) + (t.rel != null ? ' (' + (t.rel * 100 >= 0 ? '+' : '−') + Math.abs(t.rel * 100).toFixed(0) + '% relative)' : ''));
  box.append(H('pre', { class: 'code', text: lines.join('\n') }));
  box.append(H('p', { class: 'cap', text: 'Why two numbers? ChatGPT and Gemini mention the brand at different rates, and the share of answers from each changed between windows. Raw mixes that change in with the real one. Like-for-like gives each engine the same weight in both windows.' }));
  if (t.ci) box.append(H('p', { class: 'cap', text: '95% bootstrap interval of the like-for-like change: ' + pp(t.ci[0]) + ' to ' + pp(t.ci[1]) + (t.ci[0] <= 0 && t.ci[1] >= 0 ? '. It includes 0, so this data alone cannot rule out no change.' : '. It excludes 0, but repeated answers to the same prompt make it optimistic.') + ' Engine by engine: ' + t.pmod.map((x) => short(x.m) + ' p=' + (x.p == null ? 'n/a' : x.p.toFixed(2))).join(', ') + ' (plain two-proportion test).' }));
  return box;
}

/* ---------- charts ---------- */
function frame(host, W, Hh, label) {
  host.textContent = '';
  const s = S('svg', { viewBox: '0 0 ' + W + ' ' + Hh, role: 'img', 'aria-label': label });
  host.append(s); return s;
}
function pool(rs, pred) { return rs.length ? rs.filter(pred).length / rs.length : null; }
/* ---------- checks ---------- */
function jsChecks() {
  return full(() => {
    const out = [], rows = D.rows, all = [...new Set(rows.flatMap((r) => r.mentions.map((m) => m.brand)))];
    let bad = 0; rows.forEach((r) => all.forEach((b) => { if ((b in r.br) !== r.response_text.includes(b)) bad++; }));
    out.push(['Mention annotations match the answer text', bad ? 'FAIL' : 'PASS', (rows.length * all.length - bad) + ' of ' + rows.length * all.length + ' answer-by-brand checks agree']);
    const bp = rows.filter((r) => Object.values(r.br).sort().join() !== Object.keys(r.br).map((_, i) => i + 1).join()).length;
    out.push(['Shortlist positions are 1..n with no gaps or repeats', bp ? 'FAIL' : 'PASS', bp + ' answers violate']);
    out.push(['No answer_id appears twice after cleaning', new Set(D.raw.map((r) => r.answer_id)).size === D.raw.length ? 'PASS' : 'FAIL', D.raw.length + ' unique successful answers']);
    const cells = sum(['baseline', 'current'].map((w) => sum(Object.values(rate(sub(w), () => true, 'all').per).map((p) => p.n))));
    out.push(['Denominators equal successful answers in the windows', cells === rows.length ? 'PASS' : 'FAIL', cells + ' answers counted across engines and windows']);
    const tr = focalRows()[0]; let ok = true, drift = 0; const msg = [];
    ['baseline', 'current'].forEach((w) => {
      let k = 0, n = 0; const per = [];
      D.models.forEach((m) => { let kk = 0, nn = 0; for (const r of rows) if (r.topic === tr.topic && r.w === w && r.model === m) { nn++; if (D.focal in r.br) kk++; } k += kk; n += nn; if (nn) per.push(kk / nn); });
      const rawHand = k / n, lfl = mean(per), rep = w === 'baseline' ? tr.raw.b : tr.raw.c;
      ok = ok && Math.abs(rawHand - rep.k / rep.n) < 1e-12; drift = Math.max(drift, Math.abs(lfl - (w === 'baseline' ? tr.b : tr.c)));
      msg.push(w + ': raw ' + k + '/' + n + ' = ' + pct(rawHand, 1) + '; like-for-like mean of ' + per.map((p) => pct(p)).join(', ') + ' = ' + pct(lfl, 1));
    });
    if (ok && drift >= 1e-9) msg.push('engine-mean and prompt-mean differ by ' + (drift * 100).toFixed(2) + ' pp (unequal answers per prompt)');
    out.push(['Hand recomputation of ' + tr.topic, !ok ? 'FAIL' : drift < 1e-9 ? 'PASS' : 'WARN', msg.join('; ')]);
    const pb = new Set(rows.filter((r) => r.w === 'baseline').map((r) => r.prompt_id)), pc = new Set(rows.filter((r) => r.w === 'current').map((r) => r.prompt_id));
    out.push(['Same prompts in both windows', pb.size === pc.size && [...pb].every((p) => pc.has(p)) ? 'PASS' : 'WARN', pb.size + ' prompts baseline, ' + pc.size + ' current']);
    const nb = rows.filter((r) => r.w === 'baseline').length, nc = rows.length - nb;
    const skew = Math.max(...D.models.map((m) => Math.abs(rows.filter((r) => r.w === 'baseline' && r.model === m).length / nb - rows.filter((r) => r.w === 'current' && r.model === m).length / nc)));
    out.push(['Engine mix is the same in both windows', skew < .15 ? 'PASS' : 'WARN', 'largest shift ' + pct(skew) + (skew < .15 ? ' (raw numbers are comparable)' : ' (raw numbers are NOT comparable; use like-for-like)')]);
    const thin = promptRows('all', mentions(D.focal), 'all').filter((p) => p.thin).length;
    out.push(['No small prompt-level cells', thin ? 'WARN' : 'PASS', thin + ' of ' + D.prompts.length + ' prompts have a cell under ' + MIN_CELL_N + ' answers']);
    return out;
  });
}

/* ---------- source data + code viewers ---------- */
function download(name, text, type) {
  const a = H('a', { href: URL.createObjectURL(new Blob([text], { type: type || 'text/plain' })), download: name }); document.body.append(a); a.click(); a.remove();
}
function cleanedCSV() {
  const q = (v) => '"' + String(v).replace(/"/g, '""') + '"';
  return ['answer_id,date,window,engine,prompt_id,topic,brands_in_order,own_domain_cited'].concat(D.rows.map((r) =>
    [r.answer_id, r.date, r.w, r.model, r.prompt_id, r.topic, Object.entries(r.br).sort((a, b) => a[1] - b[1]).map((e) => e[1] + ':' + e[0]).join(' | '), citesOwn(D.focal)(r)].map(q).join(','))).join('\n');
}
function dumbbell(host, items, o) {
  const W = Math.max(host.clientWidth, 300), padL = 44, padR = 84, rowH = 70, top = 24;
  const Hh = top + items.length * rowH + 6, dm = o.max;
  const s = frame(host, W, Hh, o.label), x = (v) => padL + (W - padL - padR) * v / dm;
  for (let v = 0; v <= dm; v += o.step) {
    s.append(S('line', { x1: x(v), x2: x(v), y1: top - 6, y2: Hh - 4, stroke: v === 0 ? 'var(--axis)' : 'var(--grid)' }));
    s.append(S('text', { x: x(v), y: 10, 'text-anchor': 'middle', class: 'tm', text: v + '%' }));
  }
  items.forEach((it, i) => {
    const y0 = top + i * rowH, ty = y0 + 36, xb = x(it.b * 100), xc = xb + (x(it.c * 100) - xb) * ease(o.prog), right = xc >= xb;
    const g = S('g');
    g.append(S('rect', { class: 'hit', x: 0, y: y0, width: W, height: rowH - 4, rx: 8 }));
    if (i) g.append(S('line', { x1: 0, x2: W, y1: y0 - 2, y2: y0 - 2, stroke: it.total ? 'var(--axis)' : 'var(--grid)' }));
    g.append(S('text', { x: 0, y: y0 + 16, class: 't1', style: 'font-weight:700;font-size:13px', text: it.label }));
    if (it.sub) g.append(S('text', { x: 0, y: y0 + 60, class: 'tm', text: 'By engine: ' + it.sub }));
    g.append(S('line', { x1: xb, x2: xc, y1: ty, y2: ty, stroke: 'var(--axis)', 'stroke-width': 3, 'stroke-linecap': 'round' }));
    g.append(S('circle', { cx: xb, cy: ty, r: 7, fill: '#fff', stroke: 'var(--s3)', 'stroke-width': 2.5 }));
    g.append(S('circle', { cx: xc, cy: ty, r: 7, fill: o.color, stroke: '#fff', 'stroke-width': 2 }));
    g.append(S('text', { x: right ? xb - 12 : xb + 12, y: ty + 4, 'text-anchor': right ? 'end' : 'start', style: 'font-size:12px;font-weight:500;fill:var(--s3)', text: pct(it.b) }));
    g.append(S('text', { x: right ? xc + 12 : xc - 12, y: ty + 4, 'text-anchor': right ? 'start' : 'end', style: 'font-size:12px;font-weight:700;fill:var(--ink)', opacity: o.prog, text: pct(it.c) }));
    const d = (it.c - it.b) * 100;
    g.append(S('text', { x: W - 2, y: ty + 5, 'text-anchor': 'end', style: 'font-weight:700;font-size:14px;fill:' + (d < 0 ? 'var(--neg)' : 'var(--ok)'), opacity: o.prog, text: (d < 0 ? '▼ ' : d > 0 ? '▲ ' : '') + pp(d) }));
    hit(g, it.label, it.tip, it.click); s.append(g);
  });
}
function dotKey(host, v) {
  host.textContent = '';
  host.append(H('span', null, H('i', { class: 'kd hol' }), ' Hollow grey dot = baseline (' + dshort(v.baseline[0], v.baseline[1]) + ')'), H('span', null, H('i', { class: 'kd fil' }), ' Filled blue dot = current (' + dshort(v.current[0], v.current[1]) + ')'), H('span', { class: 'kn', text: 'Right-hand number = change in percentage points' }));
}

function renderTopics(prog = 1) {
  const rows = withCI(topicRows(metricPred(), st.model, st.brand + st.metric)).filter((t) => st.topic === 'all' || t.topic === st.topic);
  const items = rows.map((t) => ({
    label: t.topic, b: t.b, c: t.c,
    sub: t.pmod.map((x) => short(x.m) + ' ' + pct(x.b) + ' → ' + pct(x.c)).join('   ·   '),
    tip: [metricName() + ' (like-for-like): ' + pct(t.b, 1) + ' → ' + pct(t.c, 1) + ' (' + pp(t.d) + ', ' + (t.rel == null ? 'n/a' : (t.rel * 100 >= 0 ? '+' : '−') + Math.abs(t.rel * 100).toFixed(0) + '%') + ' relative)',
      'Raw (all answers pooled): ' + kn(t.raw.b) + ' = ' + pct(t.raw.b.k / t.raw.b.n) + ' → ' + kn(t.raw.c) + ' = ' + pct(t.raw.c.k / t.raw.c.n)]
      .concat(t.pmod.map((x) => x.m + ': ' + pct(x.b) + ' (n=' + x.nb + ') → ' + pct(x.c) + ' (n=' + x.nc + ')'))
      .concat(['95% interval ' + pp(t.ci[0]) + ' to ' + pp(t.ci[1]), 'Click for the arithmetic and the answers']),
    click: () => { CH.topic.topic = t.topic; renderAll(); showAnswers(t.topic + ': answers that ' + (st.metric === 'first' ? 'do not rank ' + st.brand + ' first' : 'do not mention ' + st.brand) + ' in the current window', (r) => r.topic === t.topic && !metricPred()(r) && r.w === 'current', calcNode(t, st.brand)); },
  }));
  items.push(allTopicsItem(metricPred(), metricName(), 'mention ' + st.brand));
  const mx = Math.min(100, Math.ceil(Math.max(...items.flatMap((t) => [t.b, t.c])) * 10) * 10 + 10);
  dumbbell($('#c-topics'), items, { max: mx, step: mx > 60 ? 20 : 10, color: brandColor(st.brand), prog, label: st.brand + ' ' + metricName().toLowerCase() + ' by topic, baseline vs current' });
}

function renderOwn() {
  const items = D.topics.filter((t) => st.topic === 'all' || t === st.topic).map((t) => {
    const b = agg('baseline', { topic: t }, citesOwn(st.brand)), c = agg('current', { topic: t }, citesOwn(st.brand));
    return { label: t, b: b.v, c: c.v, sub: Object.keys(b.per).map((m) => short(m) + ' ' + pct(b.per[m].v) + ' → ' + pct((c.per[m] || {}).v)).join('   ·   '),
      tip: ['Share of answers citing ' + st.brand + "'s own domain", pct(b.v, 1) + ' → ' + pct(c.v, 1), 'Counts answers, not distinct URLs'],
      click: () => showAnswers(t + ': answers citing ' + st.brand + "'s domain", (r) => r.topic === t && citesOwn(st.brand)(r)) };
  });
  items.push(allTopicsItem(citesOwn(st.brand), 'Citation rate', 'cite ' + st.brand + "'s domain"));
  const mx = Math.max(30, Math.ceil(Math.max(...items.flatMap((i) => [i.b, i.c])) * 10) * 10 + 10);
  dumbbell($('#c-own'), items, { max: mx, step: 10, color: brandColor(st.brand), prog: 1, label: 'Own-domain citation rate by topic' });
}
function renderTrend() {
  const host = $('#c-trend'), W = Math.max(host.clientWidth, 300), Hh = 250, pl = 36, pr = 90, pt = 14, pb = 26;
  const days = []; for (let d = st.d1; d <= st.d2; d++) days.push(d);
  const topic = st.topic === 'all' ? undefined : st.topic, pred = metricPred();
  const series = ['baseline', 'current'].map((w) => days.map((d) => {
    const rs = D.rows.filter((r) => r.w === w && Math.abs(r.day - d) <= 1 && r.day >= st.d1 && r.day <= st.d2 && (!topic || r.topic === topic));
    const x = rate(rs, pred); return { d, v: x.v, n: x.n };
  }));
  const all = series.flat().filter((p) => p.v != null).map((p) => p.v);
  const mx = Math.min(1, Math.ceil(Math.max(0.1, ...all) * 10) / 10 + 0.1);
  const s = frame(host, W, Hh, st.brand + ' ' + metricName().toLowerCase() + ' by day of window, 3-day rolling');
  const x = (d) => pl + (W - pl - pr) * (days.length === 1 ? .5 : (d - st.d1) / (st.d2 - st.d1)), y = (v) => pt + (Hh - pt - pb) * (1 - v / mx);
  for (let v = 0; v <= mx + 1e-9; v += mx > .6 ? .2 : .1) {
    s.append(S('line', { x1: pl, x2: W - pr, y1: y(v), y2: y(v), stroke: v === 0 ? 'var(--axis)' : 'var(--grid)' }));
    s.append(S('text', { x: pl - 6, y: y(v) + 4, 'text-anchor': 'end', class: 'tm', text: Math.round(v * 100) + '%' }));
  }
  days.forEach((d) => { if (d % (W < 520 ? 4 : 2) === 1) s.append(S('text', { x: x(d), y: Hh - 6, 'text-anchor': 'middle', class: 'tm', text: 'Day ' + d })); });
  const styles = [{ c: 'var(--muted)', dash: '5 4', name: 'Baseline' }, { c: brandColor(st.brand), dash: null, name: 'Current' }];
  series.forEach((ser, i) => {
    const pts = ser.filter((p) => p.v != null);
    s.append(S('path', { d: pts.map((p, j) => (j ? 'L' : 'M') + x(p.d) + ' ' + y(p.v)).join(' '), fill: 'none', stroke: styles[i].c, 'stroke-width': 2.5, 'stroke-dasharray': styles[i].dash, 'stroke-linecap': 'round' }));
    const last = pts[pts.length - 1];
    if (last) s.append(S('text', { x: x(last.d) + 8, y: y(last.v) + 4, class: 't1', text: styles[i].name + ' ' + pct(last.v) }));
  });
  const cross = S('line', { y1: pt, y2: Hh - pb, stroke: 'var(--ink2)', opacity: 0 }); s.append(cross);
  const ov = S('rect', { x: pl, y: pt, width: W - pl - pr, height: Hh - pt - pb, fill: 'transparent' });
  ov.addEventListener('pointermove', (e) => {
    const r = s.getBoundingClientRect(), px = (e.clientX - r.left) * (W / r.width);
    const d = Math.max(st.d1, Math.min(st.d2, Math.round(st.d1 + (px - pl) / (W - pl - pr) * (st.d2 - st.d1))));
    cross.setAttribute('x1', x(d)); cross.setAttribute('x2', x(d)); cross.setAttribute('opacity', 1);
    const i = d - st.d1;
    showTip(e, 'Day ' + d + ' of each window', series.map((ser, k) => styles[k].name + ': ' + pct(ser[i].v) + ' (n=' + ser[i].n + ')').concat(['3-day rolling; read the shape, not single days']));
  });
  ov.addEventListener('pointerleave', () => { cross.setAttribute('opacity', 0); hideTip(); });
  s.append(ov);
}
function codeText() {
  const src = window.SOURCES || {};
  if (st.code === 'py') return ['analysis.py', src['analysis.py'] || ''];
  if (st.code === 'full') return ['app.js', src['app.js'] || ''];
  const a = src['app.js'] || '', i = a.indexOf('/* CALC-START */'), j = a.indexOf('/* CALC-END */');
  return ['app.js (core calculations)', i >= 0 ? a.slice(i, j) : a];
}
function renderCode() {
  const host = $('#code-host'); host.textContent = '';
  const [name, text] = codeText();
  host.append(H('p', { class: 'cap', text: 'The calculations behind every number. The same logic exists twice: in this page (JavaScript, runs in your browser) and in analysis.py (Python, used by the notebook). A test checks they agree. No AI model is involved in any calculation.' }));
  const s = H('select', { 'aria-label': 'Choose a code view', onchange: (e) => { st.code = e.target.value; renderCode(); } }, ...[['core', 'Core calculations (this page)'], ['full', 'Full page script'], ['py', 'analysis.py (Python version)']].map(([v, l]) => H('option', { value: v, text: l })));
  s.value = st.code;
  host.append(H('div', { class: 'toolbar' }, s, H('button', { class: 'btn', text: 'Copy', onclick: () => { try { navigator.clipboard.writeText(text); } catch (e) { /* ignore */ } } }), H('button', { class: 'btn', text: 'Download ' + name.split(' ')[0], onclick: () => download(name.split(' ')[0], text) })));
  host.append(H('pre', { class: 'code codeview', text: text }));
}

/* ================= guided workflow ================= */
const STEPS = [[1, 'Inputs'], [2, 'Load & clean'], [3, 'Mention rate'], [4, 'Topic & engine'], [5, 'Who wins'], [6, 'Buyer questions'], [7, 'Significance'], [8, 'Checks'], [9, 'Recommendation']];
const VIEW_STEPS = { 3: ['brand', 'metric', 'days'], 4: ['brand', 'metric', 'model', 'topic', 'days'], 6: ['brand', 'metric', 'model', 'topic', 'days'] };
const CHECK_WHY = [
  'The brand list stored with each answer agrees with whether the brand name really appears in the answer text. If they disagreed, every rate would sit on a wrong label.',
  'Each answer ranks its brands #1, #2, #3 with no gaps or repeats, so “ranked first” means one thing.',
  'No answer was counted twice.',
  'The answers inside each rate add up to the answers collected, so none was dropped or double counted.',
  'The headline topic was recomputed by hand from the raw rows and compared with what this page reports.',
  'Both windows ask the same questions, so a difference is not caused by different prompts.',
  'Whether ChatGPT and Gemini were sampled in the same proportions in both windows. If not, raw numbers are not comparable.',
  'Whether any prompt has an engine-and-window group with fewer than ' + MIN_CELL_N + ' answers. Small groups bounce around.',
];
/* ---- matrix heatmap (topics or prompts by engine) ---- */
function matrix(host, defs, o) {
  const W = Math.max(host.clientWidth, 300), narrow = W < 560, gap = 12, ng = o.groups.length;
  const labelW = narrow ? Math.min(112, W * .28) : 230, flagW = narrow ? 54 : 96, cw = (W - labelW - flagW - gap * (ng - 1)) / o.cols.length, ch = 46, top = 58;
  const gi = []; o.groups.forEach((g, k) => { for (let j = 0; j < g.n; j++) gi.push(k); });
  const cx = (i) => labelW + cw * i + gap * gi[i], fs = narrow ? 10 : 12;
  const s = frame(host, W, top + defs.length * ch + 4, o.label);
  let ci = 0;
  o.groups.forEach((g) => {
    const x0 = cx(ci), x1 = cx(ci + g.n - 1) + cw;
    s.append(S('text', { x: (x0 + x1) / 2, y: 14, 'text-anchor': 'middle', class: 't1', style: 'font-weight:700;font-size:' + (narrow ? 11 : 13) + 'px', text: g.label }));
    s.append(S('line', { x1: x0 + 2, x2: x1 - 2, y1: 23, y2: 23, stroke: g.outline ? 'var(--ink)' : 'var(--axis)', 'stroke-width': g.outline ? 2 : 1 }));
    ci += g.n;
  });
  o.cols.forEach((c, i) => s.append(S('text', { x: cx(i) + cw / 2, y: 42, 'text-anchor': 'middle', class: 'tm', style: 'font-size:' + fs + 'px', text: narrow ? c.label.slice(0, 4) + '.' : c.label })));
  s.append(S('text', { x: W - 2, y: 14, 'text-anchor': 'end', class: 't1', style: 'font-weight:700;font-size:' + (narrow ? 11 : 13) + 'px', text: 'Change' }));
  if (!narrow && o.flagSub) s.append(S('text', { x: W - 2, y: 42, 'text-anchor': 'end', class: 'tm', text: o.flagSub }));
  defs.forEach((d, r) => {
    const y = top + r * ch, maxc = Math.floor(labelW / 6.4);
    if (d.total) s.append(S('line', { x1: 0, x2: W, y1: y - 1, y2: y - 1, stroke: 'var(--axis)' }));
    if (d.color) s.append(S('circle', { cx: 5, cy: y + ch / 2, r: 5, fill: d.color }));
    s.append(S('text', { x: d.color ? 16 : 0, y: y + ch / 2 + 4, class: 't1', style: 'font-size:13px;font-weight:' + (d.total ? 700 : 500), text: d.label.length > maxc - 2 ? d.label.slice(0, maxc - 3) + '…' : d.label }));
    d.cells.forEach((c, i) => {
      const g = S('g'), x = cx(i) + 2;
      if (c.fill) g.append(S('rect', { x, y: y + 2, width: cw - 4, height: ch - 4, rx: 6, fill: c.fill, 'fill-opacity': c.op }));
      else g.append(S('rect', { x, y: y + 2, width: cw - 4, height: ch - 4, rx: 6, fill: 'var(--wash)' }));
      g.append(S('text', { x: x + (cw - 4) / 2, y: y + ch / 2 + 5, 'text-anchor': 'middle', style: 'font-weight:650;font-size:13px;pointer-events:none;' + (c.op > .6 ? 'fill:#fff' : ''), class: c.op > .6 ? '' : 't1', text: c.text }));
      hit(g, d.label, c.tip, c.click); s.append(g);
    });
    if (d.flag) {
      const pw = narrow ? 48 : 66, bad = d.flagBad, zero = /^\+0 pp|^−0 pp/.test(d.flag);
      s.append(S('rect', { x: W - pw, y: y + 9, width: pw, height: 28, rx: 14, fill: zero ? 'var(--wash)' : bad ? 'rgba(217,45,32,.12)' : 'rgba(55,108,255,.12)' }));
      s.append(S('text', { x: W - pw / 2, y: y + ch / 2 + 5, 'text-anchor': 'middle', style: 'font-weight:700;font-size:' + (narrow ? 11 : 13) + 'px;fill:' + (zero ? 'var(--muted)' : bad ? 'var(--neg)' : 'var(--ok)'), text: d.flag }));
    }
  });
  let k = 0;
  o.groups.forEach((g) => { if (g.outline) s.append(S('rect', { x: cx(k) - 1, y: top - 1, width: cx(k + g.n - 1) + cw - cx(k) + 2, height: defs.length * ch + 2, rx: 8, fill: 'none', stroke: 'var(--ink)', 'stroke-width': 1.5, 'pointer-events': 'none' })); k += g.n; });
}
function cellStyle(v, mode, mx) {
  if (v == null) return {};
  if (mode === 'change') return { fill: v < 0 ? 'var(--neg)' : 'var(--s1)', op: Math.abs(v) < 0.5 ? 0.08 : 0.15 + 0.8 * Math.min(1, Math.abs(v) / mx) };
  return { fill: 'var(--s1)', op: 0.08 + 0.87 * Math.min(1, v / mx) };
}

/* ================= pages ================= */
const PAGES = [['about', 'About ACME Desk'], ['prompts', 'Topics and Prompts'], ['competitors', 'Competitors'], ['answers', 'Answers data'], ['analysis', 'Analysis'], ['reco', 'Recommendation']];
const TOPIC_COLORS = ['#7a4fd1', '#b8860b', '#c2306e', '#8d5a2b', '#5f6b7a', '#6b8e23', '#0e7490', '#9f1239'];
const topicColor = (t) => { const i = D.topicOrder.indexOf(t); return TOPIC_COLORS[(i < 0 ? 0 : i) % TOPIC_COLORS.length]; };
const VERIFY = [
  "Did anything change on ACME's CRM / integrations pages or docs between the windows?",
  'Why did the sampled engine mix change? Was it deliberate?',
  'How much pipeline comes from integration-driven buyers? Equal topic weights is an assumption.',
  'Are these prompts the ones buyers actually use?',
  'Whether any of this affects traffic, leads or revenue. The export has none of that data.',
];
let page = 'analysis';
/* each chart owns its filters ("view"); withView applies one temporarily so the shared calculations can be reused */
const CH = {}; let curView = null;
const defView = (x) => Object.assign({ metric: 'mention', model: 'all', topic: 'all', baseline: D.detected.baseline.slice(), current: D.detected.current.slice() }, x);
function initViews() { CH.topic = defView({ type: 'heat' }); CH.own = defView(); CH.ci = defView(); CH.bars = defView(); CH.kpi = defView(); CH.pos = defView(); }
function withView(v, fn) {
  const sv = { metric: st.metric, model: st.model, topic: st.topic, d1: st.d1, d2: st.d2, brand: st.brand }, sd = { b: D.baseline, c: D.current, m: D.maxDay }, prev = curView;
  st.brand = D.focal; st.metric = v.metric; st.model = v.model; st.topic = v.topic;
  D.baseline = v.baseline; D.current = v.current; D.maxDay = Math.max(dayNum(v.baseline[1]) - dayNum(v.baseline[0]), dayNum(v.current[1]) - dayNum(v.current[0])) + 1;
  tagWindows(D); refreshTopics(D); st.d1 = 1; st.d2 = D.maxDay; if (!D.topics.includes(st.topic)) st.topic = 'all';
  curView = v;
  try { return fn(); } finally { curView = prev; Object.assign(st, sv); D.baseline = sd.b; D.current = sd.c; D.maxDay = sd.m; tagWindows(D); refreshTopics(D); }
}
function inView(v, host, fn) { withView(v, () => { if (!windowsOk()) { host.textContent = ''; host.append(H('div', { class: 'warn', text: 'No answers in one of these periods. Adjust the dates.' })); return; } fn(); }); }
const selEl = (label, opts, val, on) => { const s = H('select', { 'aria-label': label, onchange: (e) => on(e.target.value) }, ...opts.map(([v, l]) => H('option', { value: v, text: l }))); s.value = val; return H('label', { class: 'inl' }, label, s); };
function periodEl(obj, cb) {
  const msg = H('span', { class: 'cap', style: 'margin:0;color:var(--neg)', role: 'alert' });
  const grp = (label, w) => H('div', { class: 'pgrp' }, H('b', { text: label }),
    ...[0, 1].map((i) => [i ? H('span', { text: 'to' }) : null, H('input', { type: 'date', value: obj[w][i], min: D.span[0], max: D.span[1], 'aria-label': label + (i ? ' end' : ' start'),
      onchange: (e) => { const v = e.target.value, other = obj[w][1 - i]; if (!v) { e.target.value = obj[w][i]; return; }
        if ((i ? other : v) > (i ? v : other)) { msg.textContent = 'The start date must be on or before the end date.'; e.target.value = obj[w][i]; return; }
        obj[w] = obj[w].slice(); obj[w][i] = v; cb(); } })]).flat());
  return H('div', { class: 'period' }, grp('Baseline', 'baseline'), grp('Current', 'current'), msg);
}
const periodText = (o) => 'Baseline ' + dshort(o.baseline[0], o.baseline[1]) + ', ' + o.baseline[0].slice(0, 4) + '  ·  Current ' + dshort(o.current[0], o.current[1]) + ', ' + o.current[0].slice(0, 4);
function chartCtl(host, view, fields) {
  host.textContent = '';
  const topics = fields.includes('topic') ? (view.from ? D.topicOrder.filter((t) => D.raw.some((r) => r.topic === t)) : withView(view, () => D.topics.slice())) : [];
  const els = [], redo = () => renderAnalysis();
  if (fields.includes('type')) els.push(selEl('Chart', [['heat', 'Heatmap'], ['dumb', 'Dumbbell']], view.type, (v) => { view.type = v; redo(); }));
  if (fields.includes('metric')) els.push(selEl('Metric', [['mention', 'Mention rate'], ['first', 'Ranked-first rate']], view.metric, (v) => { view.metric = v; redo(); }));
  if (fields.includes('model')) els.push(selEl('Answer engine', [['all', 'All engines, equal weight'], ...D.models.map((m) => [m, m])], view.model, (v) => { view.model = v; redo(); }));
  if (fields.includes('topic')) els.push(selEl('Topic', [['all', 'All topics'], ...topics.map((t) => [t, t])], topics.includes(view.topic) ? view.topic : 'all', (v) => { view.topic = v; redo(); }));
  host.append(H('div', { class: 'cctl' }, ...els));
  if (fields.includes('period')) host.append(H('p', { class: 'cap', style: 'margin:0', text: periodText(view) }));
  if (fields.includes('range')) {
    host.append(H('p', { class: 'cap', style: 'margin:0', text: 'Dates: ' + dshort(view.from, view.to) + ', ' + view.to.slice(0, 4) + ' (current window)' }));
  }
}
const docs = { brief: { text: '', edit: false }, cbrief: { text: '', edit: false } };
const fillSelect = (sel, opts, val) => { sel.textContent = ''; opts.forEach(([v, l]) => sel.append(H('option', { value: v, text: l }))); sel.value = val; };

function renderNav() {
  const nav = $('#nav'); nav.textContent = '';
  PAGES.forEach(([k, l]) => nav.append(H('button', { class: 'nb' + (k === page ? ' active' : ''), 'aria-current': k === page ? 'page' : null, text: l, onclick: () => go(k) })));
  $('#code-link').classList.toggle('active', page === 'code');
}
function go(k) {
  if (!D) return;
  page = k; closeDrawer(); closeModal(); hideTip();
  document.querySelectorAll('.page').forEach((p) => { p.hidden = p.dataset.page !== k; });
  renderNav(); renderPage();
  window.scrollTo(0, 0);
  try { history.replaceState(null, '', '#' + k); } catch (e) { /* ignore */ }
}
function renderAll() { if (D) renderPage(); }
function renderPage() {
  ({ about: renderAbout, prompts: renderPromptsPage, competitors: renderCompetitors, answers: renderAnswers, analysis: renderAnalysis, reco: renderRecoPage, code: renderCode }[page] || (() => {}))();
}

/* ---- topics / windows bookkeeping ---- */
function refreshTopics(d) {
  const has = (t, w) => d.rows.some((r) => r.topic === t && r.w === w);
  d.topics = d.topicOrder.filter((t) => has(t, 'baseline') && has(t, 'current'));
}
function applyWindows() {
  D.maxDay = Math.max(dayNum(D.baseline[1]) - dayNum(D.baseline[0]), dayNum(D.current[1]) - dayNum(D.current[0])) + 1;
  tagWindows(D); refreshTopics(D); bootCache.clear(); st.d1 = 1; st.d2 = D.maxDay; renderAll();
}
function promptsChanged() {
  D.pm = {}; D.prompts.forEach((p) => { D.pm[p.prompt_id] = p; });
  D.raw.forEach((r) => { r.topic = D.pm[r.prompt_id] ? D.pm[r.prompt_id].topic : null; });
  D.hygiene.unknown = D.raw.filter((r) => r.topic == null).length;
  const used = [...new Set(D.prompts.map((p) => p.topic))];
  D.topicOrder = D.topicOrder.filter((t) => used.includes(t) || D.extra.has(t)).concat(used.filter((t) => !D.topicOrder.includes(t)));
  applyWindows();
}

/* ---- period picker (shared by Analysis and Recommendation) ---- */
function renderPeriod(host) {
  host.textContent = ''; host.append(H('p', { style: 'margin:0', text: periodText(D) }));
}

/* ---- About ACME Desk: editable docs ---- */
function paras(host, text, empty) {
  if (!text.trim()) { host.append(H('p', { class: 'muted', text: empty })); return; }
  text.split(/\n\s*\n/).forEach((p, i) => {
    const t = p.trim(); if (!t) return;
    if (i === 0 && t.startsWith('Customer:')) { const [a, ...b] = t.split('\n'); host.append(H('h3', { text: a.replace('Customer: ', ''), style: 'margin:0 0 8px;font-size:18px' })); if (b.length) host.append(H('p', { text: b.join(' ') })); }
    else if (t.startsWith('Objective:')) host.append(H('p', null, H('b', { text: 'Objective: ' }), t.replace('Objective: ', '')));
    else host.append(H('p', { text: t }));
  });
}
function docCard(key, title, empty, upload) {
  const d = docs[key], card = H('div', { class: 'card brief' });
  const head = H('div', { class: 'toolbar', style: 'justify-content:space-between;margin-top:0' }, H('h3', { text: title, style: 'font-size:15px;margin:0' }));
  const btns = H('div', { class: 'toolbar', style: 'margin:0' });
  if (d.edit) {
    const ta = H('textarea', { style: 'min-height:260px;font-family:inherit;font-size:14px', 'aria-label': 'Edit ' + title }); ta.value = d.text;
    btns.append(H('button', { class: 'btn primary', text: 'Save', onclick: () => { d.text = ta.value; d.edit = false; renderAbout(); } }), H('button', { class: 'btn', text: 'Cancel', onclick: () => { d.edit = false; renderAbout(); } }));
    head.append(btns); card.append(head, ta);
  } else {
    if (upload) { const f = H('input', { type: 'file', accept: '.txt,.md', style: 'display:none', onchange: async (e) => { const file = e.target.files[0]; if (file) { d.text = await file.text(); renderAbout(); } } });
      btns.append(f, H('button', { class: 'btn', text: 'Upload competitor_brief.txt', onclick: () => f.click() })); }
    btns.append(H('button', { class: 'btn', text: 'Edit', onclick: () => { d.edit = true; renderAbout(); } }));
    head.append(btns); card.append(head); paras(card, d.text, empty);
  }
  return card;
}
function renderAbout() {
  const host = $('#brief'); host.textContent = '';
  host.append(docCard('brief', 'Customer brief', 'The brief is empty. Press Edit to add text.', false));
}

/* ---- Topics and Prompts: editable, colour-coded ---- */
function renderPromptsPage() {
  const host = $('#prompts-host'); host.textContent = '';
  const err = H('p', { class: 'cap', style: 'color:var(--neg);margin:6px 0', role: 'alert' });
  const up = H('input', { type: 'file', accept: '.json', style: 'display:none', onchange: async (e) => {
    const f = e.target.files[0]; if (!f) return;
    try {
      const arr = JSON.parse(await f.text());
      if (!Array.isArray(arr) || !arr.length || arr.some((p) => !p || !p.prompt_id || !p.topic || !p.prompt)) throw new Error('expected a list of {prompt_id, topic, prompt}');
      D.prompts = arr; D.topicOrder = [...new Set(arr.map((p) => p.topic))]; D.extra = new Set(); promptsChanged();
    } catch (x) { err.textContent = 'Could not load prompts.json: ' + x.message; }
  } });
  host.append(H('div', { class: 'toolbar' }, up, H('button', { class: 'btn', text: 'Upload prompts.json', onclick: () => up.click() }),
    H('button', { class: 'btn', text: 'Download prompts.json', onclick: () => download('prompts.json', JSON.stringify(D.prompts, null, 2), 'application/json') })), err);
  D.topicOrder.forEach((t) => {
    const ps = D.prompts.filter((p) => p.topic === t);
    host.append(H('div', { class: 'tsec', style: 'border-left-color:' + topicColor(t) },
      H('div', { class: 'toolbar', style: 'margin-top:0' }, H('span', { class: 'dotc', style: 'background:' + topicColor(t) }), H('b', { text: t, style: 'font-size:15px' }), H('span', { class: 'cap', style: 'margin:0', text: ps.length + ' prompt' + (ps.length === 1 ? '' : 's') })),
      H('div', { class: 'tablewrap', style: 'max-height:none' }, H('table', null, H('thead', null, H('tr', null, ...['prompt_id', 'prompt'].map((h) => H('th', { text: h })))),
        H('tbody', null, ...ps.map((p) => H('tr', null, H('td', { style: 'width:90px' }, H('code', { text: p.prompt_id })), H('td', { text: p.prompt }))))))));
  });
}

let comps = null;
function renderCompetitors() {
  const host = $('#comp-host'); host.textContent = '';
  if (!comps) comps = D.brands.filter((b) => b !== D.focal).map((n) => ({ n, added: false }));
  const named = (n) => D.raw.filter((r) => r.mentions.some((m) => m.brand === n)).length;
  const err = H('p', { class: 'cap', style: 'color:var(--neg);margin:6px 0', role: 'alert' });
  const inp = H('input', { placeholder: 'Add a competitor', 'aria-label': 'Competitor name', style: 'min-width:220px' });
  const add = () => { const n = inp.value.trim(); if (!n) return; if (comps.some((c) => c.n.toLowerCase() === n.toLowerCase()) || n === D.focal) { err.textContent = 'That name is already listed.'; return; } comps.push({ n, added: true }); renderCompetitors(); };
  inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') add(); });
  host.append(H('ul', { class: 'plain' }, ...comps.map((c) => H('li', { style: 'font-size:16px;color:var(--ink);margin:6px 0' }, c.n, ' ',
    H('span', { class: 'cap', style: 'margin:0 8px', text: c.added ? 'added by you; not in the answer data' : 'named in ' + named(c.n) + ' answers' }),
    c.added ? H('button', { class: 'btn', text: 'Remove', onclick: () => { comps = comps.filter((x) => x !== c); renderCompetitors(); } }) : null))),
    H('div', { class: 'toolbar' }, inp, H('button', { class: 'btn', text: 'Add', onclick: add })), err,
    H('p', { class: 'cap', text: 'Only competitors named in the answer data appear in the charts.' }));
}

/* ---- generic filterable table ---- */
const tstate = {};
function dtable(host, id, cols, rows, o = {}) {
  const ts = tstate[id] || (tstate[id] = { f: {}, sort: null, shown: o.page || 50 });
  host.textContent = '';
  const val = (c, r) => { const v = c.get(r); return v == null ? '' : v; };
  const passes = (c, r) => {
    const f = ts.f[c.key]; if (f == null || f === '' || (typeof f === 'object' && !f.from && !f.to)) return true;
    const v = val(c, r);
    if (c.type === 'select') return String(v) === f;
    if (c.type === 'num') return +v >= +f;
    if (c.type === 'date') { const d = String(v).slice(0, 10); return (!f.from || d >= f.from) && (!f.to || d <= f.to); }
    return String(v).toLowerCase().includes(f.toLowerCase());
  };
  const thead = H('tr', null), frow = H('tr', { class: 'fr' }), tb = H('tbody'), tf = H('tfoot'), info = H('p', { class: 'cap', style: 'margin:6px 0' }), more = H('div');
  const body = () => {
    let rs = rows.filter((r) => cols.every((c) => passes(c, r)));
    if (ts.sort) { const c = cols.find((x) => x.key === ts.sort.key), dir = ts.sort.dir; rs = rs.slice().sort((a, z) => { const x = val(c, a), y = val(c, z); return (typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y))) * dir; }); }
    tb.textContent = '';
    rs.slice(0, ts.shown).forEach((r) => {
      const tr = H('tr', o.rowClick ? { class: 'clickrow', tabindex: '0', onclick: () => o.rowClick(r), onkeydown: (e) => { if (e.key === 'Enter') o.rowClick(r); } } : null);
      cols.forEach((c) => { const td = H('td', { class: (c.cls || '') + (c.wrap ? ' wrapc' : '') }); const cell = c.render ? c.render(r) : String(val(c, r)); td.append(cell.nodeType ? cell : document.createTextNode(cell)); if (c.tip) { const [a, b] = c.tip(r); hit(td, a, b); } tr.append(td); });
      tb.append(tr);
    });
    tf.textContent = '';
    if (o.footer) tf.append(H('tr', null, ...o.footer(rs).map((x, i) => H('td', { text: String(x), style: 'font-weight:650', class: cols[i].cls || '' }))));
    info.textContent = 'Showing ' + Math.min(ts.shown, rs.length) + ' of ' + rs.length + (rs.length < rows.length ? ' (filtered from ' + rows.length + ')' : '') + ' rows';
    more.textContent = '';
    if (rs.length > ts.shown) more.append(H('button', { class: 'btn', text: 'Show ' + Math.min(50, rs.length - ts.shown) + ' more', onclick: () => { ts.shown += 50; body(); } }));
  };
  cols.forEach((c) => {
    const arrow = ts.sort && ts.sort.key === c.key ? (ts.sort.dir > 0 ? ' ▲' : ' ▼') : '';
    thead.append(H('th', { class: c.cls || '', style: 'cursor:pointer', title: 'Click to sort', onclick: () => { ts.sort = ts.sort && ts.sort.key === c.key ? (ts.sort.dir > 0 ? { key: c.key, dir: -1 } : null) : { key: c.key, dir: 1 }; dtable(host, id, cols, rows, o); } }, H('span', { class: c.mono ? 'mono' : '', text: c.label + arrow })));
    const th = H('th', { class: c.cls || '' });
    if (c.type === 'none') { /* no filter for this column */ }
    else if (c.type === 'select') { const s = H('select', { 'aria-label': 'Filter ' + c.label, onchange: (e) => { ts.f[c.key] = e.target.value; ts.shown = o.page || 50; body(); } }, H('option', { value: '', text: 'All' }), ...[...new Set(rows.map((r) => String(val(c, r))))].sort().map((v) => H('option', { value: v, text: v }))); s.value = ts.f[c.key] || ''; th.append(s); }
    else if (c.type === 'date') { const f = ts.f[c.key] || (ts.f[c.key] = { from: '', to: '' }); th.append(H('input', { type: 'date', value: f.from, 'aria-label': c.label + ' from', onchange: (e) => { f.from = e.target.value; body(); } }), H('input', { type: 'date', value: f.to, 'aria-label': c.label + ' to', onchange: (e) => { f.to = e.target.value; body(); } })); }
    else th.append(H('input', { type: c.type === 'num' ? 'number' : 'search', min: c.type === 'num' ? 0 : null, placeholder: c.type === 'num' ? '≥' : 'Filter', value: ts.f[c.key] || '', 'aria-label': 'Filter ' + c.label, oninput: (e) => { ts.f[c.key] = e.target.value; ts.shown = o.page || 50; body(); } }));
    frow.append(th);
  });
  host.append(H('div', { class: 'tablewrap dt', style: 'max-height:' + (o.maxH || 560) + 'px' }, H('table', null, H('thead', null, thead, frow), tb, tf)), info, more);
  body();
}

/* ---- Answers data ---- */
function openRowEditor(t) {
  const b = $('#modal-body'); b.textContent = '';
  const why = t.status === 'error' ? 'Cleaning status: error. status = error means no answer was collected, so it is left out of every denominator (an error is not brand absence).' : t.status === 'duplicate' ? 'Cleaning status: duplicate. The same answer_id appeared earlier, so only the first copy counts.' : 'Cleaning status: included. This row feeds the numbers.';
  const ta = H('textarea', { style: 'min-height:300px', 'aria-label': 'Record JSON' }); ta.value = JSON.stringify(JSON.parse(t.src), null, 2);
  const err = H('p', { class: 'cap', style: 'color:var(--neg)', role: 'alert' });
  const rebuild = (items) => { try { rebuildRaw(items); closeModal(); } catch (e) { err.textContent = e.message; } };
  b.append(H('h2', { text: t.id, style: 'font-size:18px;margin:0 0 4px' }), H('p', { class: 'cap', text: why }), ta, err,
    H('div', { class: 'toolbar' }, H('button', { class: 'btn primary', text: 'Save changes', onclick: () => { let o; try { o = JSON.parse(ta.value); } catch (e) { err.textContent = 'Not valid JSON: ' + e.message; return; } rebuild(D.table.map((x) => x === t ? o : JSON.parse(x.src))); } }),
      H('button', { class: 'btn', text: 'Delete this row', onclick: () => rebuild(D.table.filter((x) => x !== t).map((x) => JSON.parse(x.src))) }), H('button', { class: 'btn', text: 'Cancel', onclick: closeModal })));
  $('#modal').hidden = false; $('#modal .close').focus();
}
function rebuildRaw(items) {
  const text = items.map((o) => JSON.stringify(o)).join('\n'), old = D;
  const nd = build(items, old.prompts, text);
  nd.topicOrder = old.topicOrder.slice(); nd.extra = old.extra; nd.baseline = old.baseline; nd.current = old.current;
  D = nd; initViews(); applyWindows();
}
const mon = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const dshort = (a, z) => { const x = a.split('-'), y = z.split('-'); return mon[+x[1] - 1] + ' ' + +x[2] + '–' + (x[1] === y[1] ? '' : mon[+y[1] - 1] + ' ') + +y[2]; };
function renderAnswers() {
  const hy = D.hygiene, nb = D.rows.filter((r) => r.w === 'baseline').length, nc = D.rows.length - nb, host = $('#cleanup'); host.textContent = '';
  const pill = (v, l, tipT, tipL) => hit(H('span', { class: 'pill' }, H('b', { text: String(v) }), ' ' + l), tipT, tipL);
  host.append(
    pill(hy.rawLines, 'lines read', 'Lines read', ['Every line in answers.jsonl, before cleaning.']),
    pill(hy.dupes, 'duplicates removed', 'Duplicates removed', ['Lines whose answer_id already appeared: the same answer exported twice. Only the first is kept.']),
    pill(hy.errors, 'errors removed', 'Errors removed', ['status = error: no answer was collected, so they are left out of every denominator (an error is not brand absence).']),
    pill(hy.ok, 'successful answers', 'Successful answers', [hy.rawLines + ' − ' + hy.dupes + ' − ' + hy.errors + ' = ' + hy.ok]),
    pill(nb, 'in baseline', 'Baseline window', [D.baseline.join(' to ') + ': ' + nb + ' successful answers']),
    pill(nc, 'in current', 'Current window', [D.current.join(' to ') + ': ' + nc + ' successful answers']));
  $('#win-note').textContent = 'Baseline = ' + dshort(D.baseline[0], D.baseline[1]) + ', ' + D.baseline[0].slice(0, 4) + '. Current = ' + dshort(D.current[0], D.current[1]) + ', ' + D.current[0].slice(0, 4) + '.';
  const cnt = (w, m, p) => D.rows.filter((r) => r.w === w && r.model === m && r.prompt_id === p).length;
  const cc = []; ['baseline', 'current'].forEach((w) => D.models.forEach((m) => cc.push([w, m])));
  const prow = D.prompts.map((p) => Object.assign({ p }, ...cc.map(([w, m]) => ({ [w + m]: cnt(w, m, p.prompt_id) }))));
  const cols = [
    { key: 'id', label: 'prompt_id', type: 'select', get: (r) => r.p.prompt_id, mono: true },
    { key: 'topic', label: 'topic', type: 'select', get: (r) => r.p.topic, render: (r) => H('span', null, H('span', { class: 'dotc', style: 'background:' + topicColor(r.p.topic) }), r.p.topic) },
    { key: 'prompt', label: 'prompt', type: 'select', get: (r) => r.p.prompt }]
    .concat(cc.map(([w, m]) => ({ key: w + m, label: short(m) + ' · ' + w, type: 'none', get: (r) => r[w + m], tip: (r) => [w + ' · ' + m, [r.p.prompt_id + ': ' + r[w + m] + ' successful answers']] })));
  dtable($('#t-clean'), 'counts', cols, prow, { page: 100, maxH: 420, footer: (rs) => ['', '', 'Total of rows shown'].concat(cc.map(([w, m]) => sum(rs.map((r) => r[w + m])))) });
  D.table.forEach((x) => { x.o = x.o || JSON.parse(x.src); });
  const keys = []; D.table.forEach((x) => Object.keys(x.o).forEach((k) => { if (!keys.includes(k)) keys.push(k); }));
  const str = (v) => v == null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v);
  const dcols = [{ key: '_clean', label: 'Cleaning status', type: 'select', cls: 'derived', get: (x) => x.status,
    render: (x) => H('span', { class: 'badge ' + (x.status === 'included' ? 'pass' : x.status === 'error' ? 'fail' : 'warn'), text: x.status }),
    tip: (x) => ['Cleaning status: ' + x.status, [x.status === 'included' ? 'Feeds the numbers.' : x.status === 'error' ? 'status = error: no answer collected; excluded from every denominator.' : 'Same answer_id as an earlier row; removed.', 'Added by this tool. Not part of the original data.']] }]
    .concat(keys.map((k) => {
      const distinct = new Set(D.table.map((x) => str(x.o[k])));
      return { key: k, label: k, mono: true, get: (x) => str(x.o[k]), type: k === 'observed_at' ? 'date' : distinct.size <= 12 && k !== 'response_text' && k !== 'mentions' && k !== 'citations' ? 'select' : 'text', wrap: k === 'response_text' || k === 'mentions' || k === 'citations', cls: k === 'response_text' ? 'rt' : k === 'mentions' || k === 'citations' ? 'js' : '' };
    }));
  dtable($('#src-host'), 'answers', dcols, D.table, { rowClick: openRowEditor, page: 50, maxH: 640 });
}

/* ---- tiles with hover calculations ---- */
function tile(label, value, delta, cls, sub, tipTitle, tipLines) {
  const el = H('div', { class: 'tile' }, H('div', { class: 'l', text: label }), H('div', { class: 'v', text: value }), H('div', { class: 'd ' + (cls || ''), text: delta }), H('div', { class: 'sb2', text: sub }));
  return hit(el, tipTitle, tipLines);
}
function lflLines(pred) {
  const o = {};
  ['baseline', 'current'].forEach((w) => {
    const r = rate(sub(w), pred, st.model), eng = Object.keys(r.per);
    o[w] = { v: r.v, line: (w === 'baseline' ? 'Baseline: ' : 'Current: ') + eng.map((m) => short(m) + ' ' + r.per[m].k + ' of ' + r.per[m].n + ' = ' + pct(r.per[m].v, 1)).join(', ') + (eng.length > 1 ? ' → average ' : ' → ') + pct(r.v, 1) };
  });
  return o;
}
function allTopicsItem(pred, what, noun) {
  const rb = rate(sub('baseline'), pred, st.model), rc = rate(sub('current'), pred, st.model), eng = Object.keys(rc.per || {}), d = (rc.v - rb.v) * 100;
  return { label: 'All topics', total: true, b: rb.v, c: rc.v,
    sub: eng.map((m) => short(m) + ' ' + pct((rb.per[m] || {}).v) + ' → ' + pct(rc.per[m].v)).join('   ·   '),
    tip: [what + ' (like-for-like, all topics): ' + pct(rb.v, 1) + ' → ' + pct(rc.v, 1) + ' (' + pp(d) + ')'].concat(eng.map((m) => m + ': ' + pct((rb.per[m] || {}).v, 1) + ' (n=' + ((rb.per[m] || {}).n || 0) + ') → ' + pct(rc.per[m].v, 1) + ' (n=' + rc.per[m].n + ')'), ['Click to read the current answers that do not ' + noun]),
    click: () => showAnswers('All topics: current answers that do not ' + noun, (r) => r.w === 'current' && !pred(r)) };
}
function renderKpis() {
  const f = st.brand, host = $('#kpis'); host.textContent = '';
  const eng = st.model === 'all' ? 'like-for-like' : st.model, avg = st.model === 'all' ? 'then the engines averaged equally' : 'for ' + st.model + ' only';
  const ment = lflLines(mentions(f)), cite = lflLines(citesOwn(f));
  const dm = (ment.current.v - ment.baseline.v) * 100, dc = (cite.current.v - cite.baseline.v) * 100;
  host.append(
    tile('Mention rate (' + eng + ')', pct(ment.current.v, 1), pp(dm) + ' vs baseline ' + pct(ment.baseline.v, 1), dm < 0 ? 'neg' : 'pos', 'answers that name ' + f, 'Mention rate', ['Answers naming ' + f + ' ÷ successful answers, per engine, ' + avg + '.', ment.baseline.line, ment.current.line, 'Change = ' + pct(ment.current.v, 1) + ' − ' + pct(ment.baseline.v, 1) + ' = ' + pp(dm)]),
    tile('Citation rate (' + eng + ')', pct(cite.current.v, 1), pp(dc) + ' vs baseline ' + pct(cite.baseline.v, 1), dc < 0 ? 'neg' : 'pos', 'answers citing ' + f + "'s domain", 'Citation rate', ['Answers with at least one citation to ' + f + "'s own domain ÷ successful answers, per engine, " + avg + '.', cite.baseline.line, cite.current.line, 'Counts answers, not distinct URLs.']));
  const pos = (w) => { const ms = D.rows.filter((r) => r.w === w && f in r.br && (st.model === 'all' || r.model === st.model)); return { n: ms.length, s: sum(ms.map((r) => r.br[f])), v: mean(ms.map((r) => r.br[f])) }; };
  const pb = pos('baseline'), pc = pos('current'), f2 = (v) => v == null ? 'n/a' : v.toFixed(2), dp = pc.v == null || pb.v == null ? null : pc.v - pb.v;
  host.append(tile('Average position when mentioned', f2(pc.v), dp == null ? '' : (dp >= 0 ? '+' : '−') + Math.abs(dp).toFixed(2) + ' vs baseline ' + f2(pb.v), '', '1 = listed first', 'Average position', ['Sum of ' + f + "'s list positions ÷ answers that mention it" + (st.model === 'all' ? ', all engines pooled.' : ', ' + st.model + ' only.'), 'Baseline: ' + pb.s + ' ÷ ' + pb.n + ' = ' + f2(pb.v), 'Current: ' + pc.s + ' ÷ ' + pc.n + ' = ' + f2(pc.v)]));
}

/* ---- heatmap: topic x engine x window ---- */
function renderLfl() {
  const pred = metricPred(), cols = [], groups = [];
  (st.model === 'all' ? D.models : [st.model]).forEach((m) => { groups.push({ label: short(m), n: 2 }); ['baseline', 'current'].forEach((w) => cols.push({ m, w, label: w === 'baseline' ? 'Baseline' : 'Current' })); });
  if (st.model === 'all') { groups.push({ label: 'Like-for-like', n: 2, outline: true }); ['baseline', 'current'].forEach((w) => cols.push({ m: 'all', w, label: w === 'baseline' ? 'Baseline' : 'Current' })); }
  const items = D.topics.filter((t) => st.topic === 'all' || t === st.topic).map((t) => ({ label: t, o: { topic: t }, topic: t })).concat([{ label: 'All topics', o: {}, topic: null }]);
  const get = (it, w, m) => it.o.topic ? agg(w, it.o, pred, m) : rate(sub(w), pred, m);
  const defs = items.map((it) => {
    const b = get(it, 'baseline', st.model).v, c = get(it, 'current', st.model).v, d = (c - b) * 100;
    return { label: it.label, color: it.topic ? topicColor(it.topic) : null, flag: pp(d), flagBad: d < 0, total: !it.topic, cells: cols.map((col) => {
      const a = get(it, col.w, col.m), v = a.v == null ? null : a.v * 100, per = D.models.map((m) => { const p = (get(it, col.w, m).per || {})[m]; return p ? short(m) + ' ' + p.k + ' of ' + p.n + ' = ' + pct(p.v, 1) : null; }).filter(Boolean);
      const tipL = col.m === 'all'
        ? ['Like-for-like: each engine’s own rate, averaged equally.'].concat(per, [it.o.topic ? 'A topic is the average of its prompts’ like-for-like rates.' : 'Average of the engine rates.', '= ' + pct(a.v, 1)])
        : [a.k + ' of ' + a.n + ' answers ' + (st.metric === 'first' ? 'rank ' : 'name ') + st.brand + (it.o.topic ? ' (average across the topic’s prompts)' : ''), '= ' + pct(a.v, 1)];
      return Object.assign({ text: v == null ? 'n/a' : pct(a.v), tip: tipL.concat(['Click to read the answers']),
        click: () => { const mf = (r) => col.m === 'all' || r.model === col.m; let intro; if (it.topic) { const t = topicRows(pred, col.m, 'x').find((x) => x.topic === it.topic); if (t) intro = calcNode(t, st.brand); }
          openDrawer(it.label + ' · ' + (col.m === 'all' ? 'like-for-like' : col.m) + ' · ' + col.w, '', [{ heading: (col.w === 'baseline' ? 'Baseline' : 'Current') + ' answers that ' + (st.metric === 'first' ? 'rank ' : 'name ') + st.brand, rows: sub(col.w, it.o).filter((r) => mf(r) && pred(r)) }, { heading: 'Answers that do not', rows: sub(col.w, it.o).filter((r) => mf(r) && !pred(r)) }], intro); } }, cellStyle(v, 'level', 60));
    }) };
  });
  matrix($('#c-lfl'), defs, { cols: cols.map((c) => ({ label: c.label })), groups, flagSub: st.model === 'all' ? 'like-for-like' : short(st.model), label: st.brand + ' ' + metricName().toLowerCase() + ' by topic, engine and window' });
}

/* ---- how often each brand appears ---- */
function renderVisibility() {
  const host = $('#c-pos');
  inView(CH.pos, host, () => {
    host.textContent = '';
    const get = (b, w) => st.topic === 'all' ? rate(sub(w), mentions(b), st.model) : agg(w, { topic: st.topic }, mentions(b), st.model);
    const items = D.brands.map((b) => ({ b, rb: get(b, 'baseline'), rc: get(b, 'current') })).sort((a, z) => (z.rc.v || 0) - (a.rc.v || 0));
    const posRows = (b) => D.rows.filter((r) => r.w === 'current' && b in r.br && (st.model === 'all' || r.model === st.model) && (st.topic === 'all' || r.topic === st.topic));
    items.forEach((it) => {
      const pr = posRows(it.b), ap = pr.length ? mean(pr.map((r) => r.br[it.b])) : null, v = it.rc.v || 0, me = it.b === D.focal, lines = (r, w) => w + ': ' + (r.per ? Object.keys(r.per).map((m) => short(m) + ' ' + r.per[m].k + ' of ' + r.per[m].n + ' = ' + pct(r.per[m].v, 1)).join(', ') + ' → average ' : '') + pct(r.v, 1);
      host.append(hit(H('div', { class: 'vb' + (me ? ' me' : '') }, H('span', { class: 'nm', text: it.b + (me ? ' (customer)' : '') }),
        H('span', { class: 'trk' }, H('i', { style: 'width:' + (v * 100).toFixed(1) + '%;background:' + brandColor(it.b) })),
        H('b', { class: 'av', text: pct(it.rc.v) }), H('div', { class: 'cap', style: 'margin:0' }, H('div', { text: 'of answers name it (baseline ' + pct(it.rb.v) + ')' }), H('div', { text: 'Average position when named: ' + (ap == null ? 'n/a' : ap.toFixed(2)) }))),
        it.b + ' · mention rate', ['Answers naming ' + it.b + ' ÷ successful answers, per engine, then averaged equally.', lines(it.rb, 'Baseline'), lines(it.rc, 'Current'), ap == null ? 'Never named in this selection.' : 'Average list position when named (1 = first; lower is better): ' + pr.reduce((a, r) => a + r.br[it.b], 0) + ' ÷ ' + pr.length + ' = ' + ap.toFixed(2) + ' (current, pooled engines)']));
    });
    const f = items.find((x) => x.b === D.focal), others = items.filter((x) => x.b !== D.focal);
    if (f && f.rc.v != null) host.append(H('p', { class: 'callout', text: D.focal + ' is missing from ' + pct(1 - f.rc.v) + ' of current answers' + (st.topic === 'all' ? '' : ' on ' + st.topic) + (others.length ? ', while ' + others.map((x) => x.b + ' is named in ' + pct(x.rc.v)).join(' and ') + '.' : '.') }));
  });
}

/* ---- interval plot (both metrics) ---- */
function renderForest() {
  const host = $('#c-ci'), W = Math.max(host.clientWidth, 300);
  const A = withCI(topicRows(metricPred(), st.model, st.brand + st.metric)), B = withCI(topicRows(citesOwn(st.brand), st.model, st.brand + 'cite'));
  const topics = D.topics.slice(), get = (arr, t) => arr.find((x) => x.topic === t);
  const rowH = 72, top = 26, labelW = W < 520 ? 96 : 150, padR = 10;
  const all = topics.flatMap((t) => [get(A, t), get(B, t)]).flatMap((r) => [r.ci[0], r.ci[1]]);
  const lo = Math.min(-30, Math.floor(Math.min(...all) / 10) * 10), hi = Math.max(30, Math.ceil(Math.max(...all) / 10) * 10);
  const x = (v) => labelW + (W - labelW - padR) * (v - lo) / (hi - lo);
  const s = frame(host, W, top + topics.length * rowH + 4, 'Change with 95% interval, mention rate and citation rate, by topic');
  for (let v = lo; v <= hi; v += 10) { s.append(S('line', { x1: x(v), x2: x(v), y1: top - 8, y2: top + topics.length * rowH, stroke: v === 0 ? 'var(--ink2)' : 'var(--grid)' })); s.append(S('text', { x: x(v), y: 12, 'text-anchor': 'middle', class: 'tm', text: v })); }
  topics.forEach((t, i) => {
    const y0 = top + i * rowH; s.append(S('text', { x: 0, y: y0 + 24, class: 't1', style: 'font-weight:600;font-size:13px', text: t })); s.append(S('circle', { cx: -6, cy: y0 + 20, r: 0 }));
    [[A, 'var(--s1)', metricName()], [B, 'var(--s2)', 'Citation rate']].forEach(([arr, col, nm], k) => {
      const r = get(arr, t), y = y0 + 14 + k * 28, excl = r.ci[1] < 0 || r.ci[0] > 0, g = S('g');
      g.append(S('rect', { class: 'hit', x: labelW - 4, y: y - 12, width: W - labelW, height: 26, rx: 6 }));
      g.append(S('line', { x1: x(r.ci[0]), x2: x(r.ci[1]), y1: y, y2: y, stroke: col, 'stroke-width': 4, 'stroke-linecap': 'round', opacity: excl ? 1 : .5 }));
      g.append(S('circle', { cx: x(r.d), cy: y, r: 6, fill: col, stroke: 'var(--surface)', 'stroke-width': 2 }));
      g.append(S('text', { x: x(r.ci[1]) + 8, y: y + 4, class: 'tm', style: 'paint-order:stroke;stroke:#fff;stroke-width:4px', text: pp(r.d) + (W < 520 ? '' : excl ? ' · likely real' : ' · could be 0') }));
      hit(g, t + ' · ' + nm, ['Like-for-like: ' + pct(r.b, 1) + ' → ' + pct(r.c, 1) + ' = ' + pp(r.d), '95% interval (2,000 resamples of the answers): ' + pp(r.ci[0]) + ' to ' + pp(r.ci[1]), excl ? 'Excludes 0: a real change is more likely, not certain.' : 'Includes 0: “no change” is still plausible.', 'Per-engine tests: ' + r.pmod.map((q) => short(q.m) + ' p = ' + (q.p == null ? 'n/a' : q.p.toFixed(2))).join(', ')], null);
      s.append(g);
    });
  });
  const tb = $('#ci-table'); tb.textContent = '';
  const eng = (r) => r.pmod.map((q) => short(q.m) + ' ' + q.nb + ' → ' + q.nc).join(' · ');
  const rowsT = topics.flatMap((t) => [[get(A, t), 'Mention rate'], [get(B, t), 'Citation rate']].map(([r, nm]) => ({ t, nm, r })));
  tb.append(H('div', { class: 'tablewrap', style: 'max-height:none;margin-top:12px' }, H('table', null,
    H('thead', null, H('tr', null, ...['Topic', 'Measure', 'Change', 'Plausible range', 'Verdict', 'Answers per engine (baseline → current)', 'p-value by engine'].map((x) => H('th', { text: x })))),
    H('tbody', null, ...rowsT.map(({ t, nm, r }) => { const excl = r.ci[1] < 0 || r.ci[0] > 0; return H('tr', null,
      H('td', { text: t }), H('td', { text: nm }), H('td', { text: pp(r.d), style: 'font-weight:650;color:' + (r.d < 0 ? 'var(--neg)' : 'var(--ok)') }),
      H('td', { text: pp(r.ci[0]) + ' to ' + pp(r.ci[1]) }), H('td', { text: excl ? 'Likely real' : 'Could be 0', style: 'font-weight:650;white-space:nowrap' }),
      H('td', null, ...r.pmod.map((q) => H('div', { text: short(q.m) + ' ' + q.nb + ' → ' + q.nc }))), H('td', { style: 'white-space:nowrap' }, ...r.pmod.map((q) => H('div', { text: short(q.m) + ' ' + (q.p == null ? 'n/a' : q.p.toFixed(2)) })))); })))));
  tb.append(H('p', { class: 'cap', style: 'margin-top:8px', text: 'Answers per engine are counts of successful answers in each period. Small or uneven counts widen the range, and more answers per engine and period would narrow it.' }));
  const lg = $('#ci-legend'); lg.textContent = '';
  lg.append(H('span', null, H('span', { class: 'sw', style: 'background:var(--s1)' }), ' ' + metricName()), H('span', null, H('span', { class: 'sw', style: 'background:var(--s2)' }), ' Citation rate'),
    H('span', null, H('i', { class: 'kd est' }), ' Best estimate of the change'), H('span', null, H('i', { class: 'kl' }), ' Range it could plausibly be (95% interval)'), H('span', null, H('i', { class: 'kl faded' }), ' Faded: range includes 0, so it could be no change'));
}

/* ---- change by topic and prompt ---- */
function renderBars() {
  const host = $('#c-ppp'), pred = metricPred(), m = st.model;
  const items = [];
  D.topics.filter((t) => st.topic === 'all' || t === st.topic).forEach((t) => {
    const b = agg('baseline', { topic: t }, pred, m), c = agg('current', { topic: t }, pred, m);
    items.push({ head: true, color: topicColor(t), label: t, d: (c.v - b.v) * 100, tip: ['Topic: ' + pct(b.v, 1) + ' → ' + pct(c.v, 1) + ' = ' + pp((c.v - b.v) * 100), 'Average of the topic’s prompts, engines equally weighted.'] });
    promptRows(t, pred, m).forEach((r) => items.push({ color: topicColor(t), label: r.p.prompt_id + ' · ' + r.p.prompt, d: r.d,
      tip: [r.p.topic, 'Like-for-like: ' + pct(r.b, 1) + ' → ' + pct(r.c, 1) + ' = ' + pp(r.d), 'Baseline: ' + Object.keys(r.bper).map((q) => short(q) + ' ' + r.bper[q].k + '/' + r.bper[q].n).join(', '), 'Current: ' + Object.keys(r.cper).map((q) => short(q) + ' ' + r.cper[q].k + '/' + r.cper[q].n).join(', '), 'Smallest group: ' + r.minN + ' answers. Click to read them.'],
      click: () => openDrawer(r.p.prompt_id + ': ' + r.p.prompt, '', [{ heading: 'Baseline answers that ' + (st.metric === 'first' ? 'rank ' : 'name ') + st.brand, rows: sub('baseline', { prompt: r.p.prompt_id }).filter((a) => (m === 'all' || a.model === m) && pred(a)) }, { heading: 'Current answers that do not', rows: sub('current', { prompt: r.p.prompt_id }).filter((a) => (m === 'all' || a.model === m) && !pred(a)) }]) }));
  });
  ppBars(host, items, 'Change by topic and prompt, percentage points');
  const mins = items.filter((x) => !x.head).map((x) => 0); void mins;
}
function ppBars(host, rows, label) {
  const W = Math.max(host.clientWidth, 300), rowH = 40, top = 6, padR = W < 520 ? 8 : 90;
  const mx = Math.max(20, Math.ceil(Math.max(...rows.map((r) => Math.abs(r.d))) / 10) * 10);
  const s = frame(host, W, top + rows.length * rowH + 4, label), x0 = (W - padR) / 2 + 20, sc = ((W - padR) / 2 - 30) / mx, maxChars = Math.floor(W / 6.6);
  s.append(S('line', { x1: x0, x2: x0, y1: top, y2: top + rows.length * rowH, stroke: 'var(--axis)' }));
  rows.forEach((r, i) => {
    const y0 = top + i * rowH, len = Math.abs(r.d) * sc, bx = r.d < 0 ? x0 - len : x0, col = r.d < 0 ? 'var(--neg)' : 'var(--pos)', g = S('g');
    g.append(S('rect', { class: 'hit', x: 0, y: y0, width: W, height: rowH - 2, rx: 8 }));
    g.append(S('rect', { x: 0, y: y0 + 3, width: 4, height: rowH - 8, rx: 2, fill: r.color || 'var(--muted)' }));
    g.append(S('text', { x: 12, y: y0 + 14, class: 't1', style: 'font-size:' + (r.head ? 13 : 12) + 'px;font-weight:' + (r.head ? 650 : 400), text: r.label.length > maxChars ? r.label.slice(0, maxChars - 1) + '…' : r.label }));
    g.append(S('rect', { x: bx, y: y0 + 20, width: Math.max(len, 1), height: r.head ? 14 : 11, rx: 3, fill: col, opacity: r.head ? 1 : .8 }));
    g.append(S('text', { x: r.d < 0 ? bx - 6 : bx + len + 6, y: y0 + 31, 'text-anchor': r.d < 0 ? 'end' : 'start', style: 'font-weight:650;fill:' + col, text: pp(r.d) }));
    hit(g, r.label, r.tip, r.click); s.append(g);
  });
}

/* ---- recommendation ---- */
function recoData() {
  const rows = focalRows(), top = rows[0], ok = top.d < 0 && top.down, ps = promptRows(top.topic, mentions(D.focal), 'all').slice(0, 4);
  const cur2 = sub('current', { topic: top.topic });
  const lost = ps.slice(0, 2).flatMap((p) => cur2.filter((r) => !(D.focal in r.br) && r.prompt_id === p.p.prompt_id).sort((a, z) => a.model.localeCompare(z.model) || a.answer_id.localeCompare(z.answer_id)).slice(0, 3));
  return { rows, top, ok, ps, lost, excl: top.ci[0] > 0 || top.ci[1] < 0 };
}
function slackText(top, ps) {
  return [D.focal + ' in AI answers: weekly check (' + D.baseline.join(' to ') + ' vs ' + D.current.join(' to ') + ')',
    'Look at: ' + top.topic + '. Mention rate ' + pct(top.b) + ' → ' + pct(top.c) + ' like-for-like (' + pp(top.d) + ').',
    'Weakest questions: ' + ps.map((r) => r.p.prompt_id + ' (' + pp(r.d) + ')').join(', ') + '. Worth investigating, not proven.'].join('\n');
}
function needN(p1, p2) {
  if (p1 == null || p2 == null || p1 === p2) return null;
  const pb = (p1 + p2) / 2;
  return Math.ceil(Math.pow(1.96 * Math.sqrt(2 * pb * (1 - pb)) + 0.8416 * Math.sqrt(p1 * (1 - p1) + p2 * (1 - p2)), 2) / Math.pow(p1 - p2, 2));
}
function windowsOk() { return D.topics.length > 0 && D.rows.some((r) => r.w === 'baseline') && D.rows.some((r) => r.w === 'current'); }
function renderRecoPage() {
  const msg = $('#r-msg'), body = $('#r-body'); renderPeriod($('#period-r'));
  const bad = !windowsOk(); msg.hidden = !bad; body.hidden = bad; $('#reco-actions').hidden = bad;
  msg.textContent = 'There are no topics with answers in both time periods. Adjust the dates above or the prompts.';
  if (bad) { $('#reco').textContent = ''; return; }
  const { rows, top, ok, ps, lost, excl } = recoData(), host = $('#reco'); host.textContent = '';
  host.append(H('div', { class: 'eyebrow', text: 'Recommended action for the week' }));
  host.append(H('h2', { text: ok ? 'Investigate why ' + D.focal + ' is mentioned less in ' + top.topic + ' answers' : 'No topic shows a consistent like-for-like decline' }));
  host.append(H('p', { style: 'margin:4px 0 0;max-width:80ch', text: ok ? D.focal + ' is mentioned less in both ChatGPT and Gemini on ' + top.topic + ' questions (' + pct(top.b) + ' → ' + pct(top.c) + ' like-for-like, ' + pp(top.d) + '). The direction is consistent; the size is uncertain because the samples are small.' : 'The largest like-for-like move is ' + top.topic + ' at ' + pp(top.d) + ', not consistent across engines.' }));
  const b = $('#reco-detail'); b.textContent = '';
  const h = (t) => H('h3', { text: t, style: 'font-size:15px;margin:20px 0 6px' });
  b.append(h('Why'), H('ul', { class: 'plain' },
    H('li', { text: 'Like-for-like mention rate fell from ' + pct(top.b) + ' to ' + pct(top.c) + ' (' + pp(top.d) + ', −' + Math.abs(top.rel * 100).toFixed(0) + '% relative).' }),
    H('li', { text: 'By engine: ' + top.pmod.map((x) => x.m + ' ' + pct(x.b) + ' → ' + pct(x.c)).join(', ') + '.' }),
    H('li', { text: rows.length > 1 ? (rows.slice(1).every((r) => r.d >= 0) ? 'Every other topic rose (' : 'Other topics: ') + rows.slice(1).map((r) => r.topic + ' ' + pp(r.d)).join(', ') + ').' : 'Only one topic has answers in both periods.' }),
    H('li', { text: 'Weakest questions: ' + ps.map((r) => r.p.prompt_id + ' (' + pp(r.d) + ')').join(', ') + '.' }),
    H('li', { text: 'Pooled numbers look worse (raw ' + pp((top.raw.c.k / top.raw.c.n - top.raw.b.k / top.raw.b.n) * 100) + ') partly because the engine mix changed. That is why this uses like-for-like.' })));
  b.append(h('Sample answers in the ' + top.topic + ' topic'), H('p', { class: 'cap', text: 'Current answers that do not mention ' + D.focal + ', on the weakest prompts. Click one to read it.' }), H('div', { class: 'chips' }, ...lost.map((r) => H('button', { class: 'chip', text: r.answer_id, onclick: () => openDrawer(r.answer_id, r.prompt_id + ' · ' + r.model, [{ heading: 'Answer', rows: [r] }]) }))));
  const eg = top.pmod.map((x) => { const nn = needN(x.b, x.c); return short(x.m) + ': ' + x.nb + ' baseline and ' + x.nc + ' current answers' + (nn ? ' (about ' + nn + ' per period would be needed to detect a drop this size reliably)' : ''); });
  const ab = $('#reco-actions'); ab.textContent = '';
  ab.append(H('h3', { text: 'This week action items', style: 'font-size:15px;margin:0 0 8px' }), H('div', { class: 'tablewrap', style: 'max-height:none' }, H('table', null, H('thead', null, H('tr', null, ...['Owner', 'Action'].map((x) => H('th', { text: x })))), H('tbody', null, ...[
    ['Content marketer', 'Read the sample answers below (and their baseline twins). Note which competitors and sources the answers lean on when ' + D.focal + ' is missing.'],
    ['Content marketer', 'Compare ' + D.focal + "'s " + top.topic.toLowerCase() + ' pages with the pages the answers cite most, looking for thin or missing content on ' + ps.slice(0, 2).map((p) => p.p.prompt_id).join(', ') + '.'],
    ['Director', 'Ask the customer what changed on those pages between the windows, and why the engine mix changed.']].map((r) => H('tr', null, ...r.map((c) => H('td', { text: c }))))))));
  b.append(h('Assumptions'), H('ul', { class: 'plain' },
    H('li', { text: 'Baseline (' + dshort(D.baseline[0], D.baseline[1]) + ') and current (' + dshort(D.current[0], D.current[1]) + ') are compared as given. Nothing outside those dates is used.' }),
    H('li', { text: 'A brand is “mentioned” when an answer names it. Failed (error) answers are left out, not counted as the brand being absent.' }),
    H('li', { text: 'Engines count equally (like-for-like), because the engine mix changed between periods (' + top.pmod.map((x) => short(x.m) + ' ' + x.nb + ' → ' + x.nc).join(', ') + ' answers in ' + top.topic + ').' }),
    H('li', { text: 'Topics count equally, and a topic is the average of its prompts.' }),
    H('li', { text: 'The prompts in the export are the questions buyers actually ask.' })));
  b.append(h('Limitations'), H('ul', { class: 'plain' },
    H('li', { text: 'Not statistically significant yet. The 95% interval is ' + pp(top.ci[0]) + ' to ' + pp(top.ci[1]) + (excl ? ', which only just stays below 0.' : ', which includes 0.') + ' Per-engine p-values are ' + top.pmod.map((x) => short(x.m) + ' ' + (x.p == null ? 'n/a' : x.p.toFixed(2))).join(' and ') + ' (below 0.05 is the usual bar).' }),
    H('li', { text: 'Small samples: ' + eg.join('; ') + '. Repeated answers to the same prompt make the interval look tighter than it is.' }),
    H('li', { text: 'The export has no traffic, lead or revenue data, so we cannot say whether this affects the business.' }),
    H('li', { text: 'It cannot say why. We do not know what changed on ' + D.focal + "'s " + top.topic.toLowerCase() + ' pages or why the engine mix changed.' })));
  b.append(h('How this was checked'), H('ul', { class: 'plain' }, ...jsChecks().map(([nm, res, det]) => H('li', { text: (res === 'PASS' ? 'Passed: ' : 'Note: ') + nm + ' (' + det + ')' })),
    H('li', { text: 'Passed: the Python and JavaScript versions of the calculations give identical results on the supplied data (checked outside this page; see View code).' })));
  b.append(h('Slack-ready'), H('pre', { class: 'code', text: slackText(top, ps) }));
}

function renderAnalysis() {
  hideTip();
  chartCtl($('#ctl-topic'), CH.topic, ['type', 'model', 'topic', 'period']);
  chartCtl($('#ctl-pos'), CH.pos, ['model', 'topic', 'period']);
  chartCtl($('#ctl-own'), CH.own, ['model', 'topic', 'period']);
  chartCtl($('#ctl-ci'), CH.ci, ['model', 'period']);
  chartCtl($('#ctl-bars'), CH.bars, ['model', 'topic', 'period']);
  withView(CH.kpi, () => { if (windowsOk()) renderKpis(); else $('#kpis').textContent = ''; });
  const heat = CH.topic.type === 'heat'; $('#c-lfl').hidden = !heat; $('#c-topics').hidden = heat;
  $('#lg-topic').hidden = heat; $('#lg-heat').hidden = !heat; dotKey($('#lg-topic'), CH.topic); dotKey($('#lg-own'), CH.own);
  $('#lg-heat').textContent = ''; $('#lg-heat').append(H('span', null, '0%'), H('i', { class: 'grad' }), H('span', null, '60%+ of answers name ' + D.focal));
  $('#t-topic').textContent = 'Mention rate'; $('#cap-topic').textContent = 'Share of answers that name ' + D.focal + ', by topic, answer engine and period.';
  inView(CH.topic, heat ? $('#c-lfl') : $('#c-topics'), () => { if (heat) renderLfl(); else renderTopics(); });
  renderVisibility();
  inView(CH.own, $('#c-own'), renderOwn);
  inView(CH.ci, $('#c-ci'), renderForest);
  inView(CH.bars, $('#c-ppp'), renderBars);
}

/* ---------- modal + wiring ---------- */
function closeModal() { $('#modal').hidden = true; }
function setData(raw, prompts, rawText) {
  const old = D;
  D = build(raw, prompts, rawText); bootCache.clear();
  D.extra = new Set(); D.detected = { baseline: D.baseline.slice(), current: D.current.slice() };
  st.brand = D.focal; st.metric = 'mention'; st.model = 'all'; st.topic = 'all'; st.d1 = 1; st.d2 = D.maxDay; st.q = ''; st.f = 'all'; st.shown = 25;
  Object.keys(tstate).forEach((k) => delete tstate[k]); initViews();
  void old; $('#err').textContent = '';
  go(page === 'code' ? 'analysis' : page);
}
function loadSample() { setData(parseJSONL(window.SAMPLE.answers), JSON.parse(JSON.stringify(window.SAMPLE.prompts)), window.SAMPLE.answers); }
async function loadFiles(files) {
  try {
    let raw = null, rawText = '', prompts = D ? D.prompts : JSON.parse(JSON.stringify(window.SAMPLE.prompts));
    for (const f of files) { const txt = await f.text(); if (txt.trim().startsWith('[')) prompts = JSON.parse(txt); else { raw = parseJSONL(txt); rawText = txt; } }
    if (!raw) throw new Error('No answers file found (expected JSON Lines with one answer per line).');
    setData(raw, prompts, rawText);
  } catch (e) { $('#err').textContent = 'Could not load: ' + e.message; }
}
function init() {
  docs.brief.text = (window.SAMPLE.brief || '').trim();
  $('#files').onchange = (e) => loadFiles([...e.target.files]);
  $('#sample').onclick = loadSample;
  $('#code-link').onclick = () => go('code');
  $('#modal .close').onclick = closeModal;
  $('#modal').addEventListener('click', (e) => { if (e.target.id === 'modal') closeModal(); });
  $('#drawer button').onclick = closeDrawer;
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { closeDrawer(); closeModal(); } });
  let t; window.addEventListener('resize', () => { clearTimeout(t); t = setTimeout(() => { if (page === 'analysis' || page === 'reco') renderAll(); }, 150); });
  try {
    const m = /#(\w+)/.exec(location.hash); if (m && [...PAGES.map((p) => p[0]), 'code'].includes(m[1])) page = m[1];
    loadSample();
  } catch (e) { $('#err').textContent = 'Could not load the sample data: ' + e.message; }
}

/* exposed for tests */
window.AEO = { summary() {
  return full(() => ({
    topics: focalRows().map((r) => ({ topic: r.topic, b: r.b, c: r.c, d: r.d, rel: r.rel, ci: r.ci, p: Object.fromEntries(r.pmod.map((x) => [x.m, x.p])), raw: r.raw })),
    prompts: promptRows('all', mentions(D.focal), 'all').map((r) => ({ id: r.p.prompt_id, d: r.d })),
    overallBalanced: [rate(sub('baseline'), mentions(D.focal), 'all').v, rate(sub('current'), mentions(D.focal), 'all').v],
    winners: D.topics.flatMap((t) => ['baseline', 'current'].map((w) => Object.assign({ topic: t, window: w }, ...D.brands.map((b) => ({ [b]: agg(w, { topic: t }, first(b), 'all').v || 0 }))))),
    hygiene: D.hygiene, checks: jsChecks(),
  }));
}, loadText(t, p) { setData(parseJSONL(t), p || D.prompts, t); } };
document.addEventListener('DOMContentLoaded', init);
})();
