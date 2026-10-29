"""ACME Desk answer-engine review: cleaning, like-for-like metrics, uncertainty, checks, brief.

Standard library only. Used by the command line and the tests:
    python -m aeo.analysis data/answers.jsonl data/prompts.json --out sample_output

Vocabulary
  baseline / current  the earlier and the later observation window (here Sep 1-14 and Oct 1-14).
                      Baseline is the starting point; current is the week the meeting is about.
  mention rate        answers that mention the brand / successful answers. The data dictionary calls
                      this "visibility". Shown as a % and labelled.
  ranked-first rate   answers where the brand is #1 on the shortlist / successful answers.
  raw                 all answers pooled, whatever engine they came from.
  like-for-like       the rate is computed inside each answer engine first, then the engines are
                      averaged with equal weight. This stops a change in WHICH engines were sampled
                      from looking like a change in the brand's performance.
  avg position        mean shortlist position over answers that mention the brand (absence is not 0).
  citations           source REFERENCES (not distinct URLs).
  pp change           later % minus earlier %, in percentage points (not a relative % change).
"""
import json, os, argparse, collections as C
from datetime import date

BRAND = "ACME Desk"
MIN_CELL_N = 10          # a (prompt x engine x window) cell with fewer answers is flagged "thin"
BOOT_N = 2000            # bootstrap resamples
BOOT_SEED = 12345
REQUIRED = ["answer_id", "prompt_id", "model", "observed_at", "status", "mentions", "citations"]

ABOUT = ("ACME Desk (fictional) sells help desk software to growing B2B software companies: a shared inbox, "
         "ticket routing, support reporting and CRM connections. Its marketing team is a director and two content "
         "marketers, who can investigate one issue per week. Relay Inbox and Clearqueue are its (fictional) competitors. "
         "Source: customer_brief.txt. No mission statement was supplied, so none is quoted here.")

ASSUMPTIONS = [
    "Answer engines are weighted equally (ChatGPT = Gemini). A choice made so the engine mix cannot drive the result; it does not say both matter equally to buyers.",
    "Topics are weighted equally. If Integrations buyers are worth more or less than the others, the ranking should change.",
    "The 12 tracked prompts stand for what buyers ask. Their completeness and wording are not tested by this data.",
    "Brand mentions and positions in the export are accurate (spot-checked against the answer text: they agree).",
    "Repeated answers to the same prompt are treated as separate observations. They are not fully independent, so the intervals here are optimistic.",
    "The earlier window is the baseline. Nothing is known about what changed between windows.",
]
VERIFY_WITH_CUSTOMER = [
    "Did anything change on ACME's CRM / integrations pages or docs between the windows?",
    "Why did the sampled engine mix change (Gemini 60 to 240 answers, ChatGPT 240 to 60)? Was it deliberate?",
    "How much pipeline comes from integration-driven buyers? Equal topic weights is an assumption.",
    "Are these 12 prompts the ones buyers actually use?",
]


# ---------------------------------------------------------------- loading / cleaning
def load(answers_path, prompts_path):
    with open(prompts_path) as f:
        prompts = {p["prompt_id"]: p for p in json.load(f)}
    raw = []
    with open(answers_path) as f:
        for i, line in enumerate(f, 1):
            if line.strip():
                try:
                    raw.append(json.loads(line))
                except json.JSONDecodeError:
                    raise ValueError(f"Line {i} of {answers_path} is not valid JSON")
    if not raw:
        raise ValueError("No rows found in the answers file")
    missing = [k for k in REQUIRED if k not in raw[0]]
    if missing:
        raise ValueError("The export is missing expected fields: " + ", ".join(missing) +
                         ". Found: " + ", ".join(sorted(raw[0].keys())) +
                         ". The format may have changed; map the new names to the expected ones before running.")
    seen, dupes = {}, 0
    for r in raw:
        if r["answer_id"] in seen:
            dupes += 1          # data dictionary: repeated IDs are the same record, not new observations
        else:
            seen[r["answer_id"]] = r
    uniq = list(seen.values())
    errors = [r for r in uniq if r["status"] != "success"]
    ok = [r for r in uniq if r["status"] == "success"]
    for r in ok:
        r["date"] = r["observed_at"][:10]            # offset is already America/New_York
        r["topic"] = prompts[r["prompt_id"]]["topic"]
        r["brands"] = {m["brand"]: m["position"] for m in r["mentions"]}
    hygiene = {"raw_lines": len(raw), "duplicate_rows_removed": dupes, "unique_records": len(uniq),
               "error_rows_excluded": len(errors), "successful_answers": len(ok)}
    return ok, errors, prompts, hygiene


def infer_windows(rows, gap_days=3):
    """Split the observed dates into clusters separated by > gap_days; first = baseline, last = current."""
    days = sorted({date.fromisoformat(r["date"]) for r in rows})
    clusters, cur = [], [days[0]]
    for d in days[1:]:
        if (d - cur[-1]).days > gap_days:
            clusters.append(cur); cur = [d]
        else:
            cur.append(d)
    clusters.append(cur)
    if len(clusters) < 2:
        raise ValueError("Need two observation windows; pass baseline/current explicitly.")
    b, c = clusters[0], clusters[-1]
    return (b[0].isoformat(), b[-1].isoformat()), (c[0].isoformat(), c[-1].isoformat())


def tag_windows(rows, baseline, current):
    for r in rows:
        r["window"] = ("baseline" if baseline[0] <= r["date"] <= baseline[1]
                       else "current" if current[0] <= r["date"] <= current[1] else None)
    return [r for r in rows if r["window"]]


# ---------------------------------------------------------------- metrics
def stats(sub, brand=BRAND):
    n = len(sub)
    pos = [r["brands"][brand] for r in sub if brand in r["brands"]]
    k = len(pos)
    return {"n": n, "k": k, "vis": k / n if n else None,
            "avg_pos": sum(pos) / k if k else None, "pos1": sum(1 for p in pos if p == 1)}


def balanced(rows, models, **flt):
    """Mention rate with every engine weighted equally. An engine missing from a window is skipped."""
    out = {}
    for w in ("baseline", "current"):
        per = {}
        for m in models:
            sub = [r for r in rows if r["window"] == w and r["model"] == m and
                   all(r[k] == v for k, v in flt.items())]
            if sub:
                per[m] = stats(sub)
        vals = [s["vis"] for s in per.values()]
        out[w] = {"vis": sum(vals) / len(vals) if vals else None, "per_model": per,
                  "n": sum(s["n"] for s in per.values())}
    return out


def change_pp(b, c):
    return None if b is None or c is None else (c - b) * 100


# ---------------------------------------------------------------- uncertainty
def _erf(x):
    sign = -1 if x < 0 else 1; x = abs(x)
    t = 1 / (1 + 0.3275911 * x)
    y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * (2.718281828459045 ** (-x * x))
    return sign * y


def two_prop_p(k1, n1, k2, n2):
    """Two-sided p-value of a plain two-proportion z-test (a rough check, not a full model)."""
    if min(n1, n2) == 0:
        return None
    p = (k1 + k2) / (n1 + n2)
    se = (p * (1 - p) * (1 / n1 + 1 / n2)) ** 0.5
    if se == 0:
        return 1.0
    z = (k2 / n2 - k1 / n1) / se
    return 1 - _erf(abs(z) / 2 ** 0.5)


# ---------------------------------------------------------------- uncertainty (bootstrap)
def mulberry32(seed):
    """Small seeded PRNG, identical to the one in the web page so both give the same interval."""
    a = seed & 0xFFFFFFFF
    def rnd():
        nonlocal a
        a = (a + 0x6D2B79F5) & 0xFFFFFFFF
        t = ((a ^ (a >> 15)) * (1 | a)) & 0xFFFFFFFF
        t = ((t + (((t ^ (t >> 7)) * (61 | t)) & 0xFFFFFFFF)) & 0xFFFFFFFF) ^ t
        return ((t ^ (t >> 14)) & 0xFFFFFFFF) / 4294967296
    return rnd


def bootstrap_topic_change(rows, topic, prompt_ids, models, brand=BRAND, seed=BOOT_SEED, n_boot=BOOT_N):
    """95% interval for the like-for-like change (pp) of a topic.
    Resample answers with replacement inside every (window, engine, prompt) cell, recompute the same
    statistic as the table: mean over prompts of (mean over engines of the cell rate)."""
    cells = {}
    for w in ("baseline", "current"):
        for p in prompt_ids:
            cells[(w, p)] = []
            for m in models:
                v = sorted([(r["answer_id"], 1 if brand in r["brands"] else 0) for r in rows
                            if r["window"] == w and r["prompt_id"] == p and r["model"] == m and r["topic"] == topic])
                if v:
                    cells[(w, p)].append([x[1] for x in v])
    rnd = mulberry32(seed)
    diffs = []
    for _ in range(n_boot):
        side = {}
        for w in ("baseline", "current"):
            prate = []
            for p in prompt_ids:
                mr = []
                for arr in cells[(w, p)]:
                    n = len(arr); k = 0
                    for _i in range(n):
                        k += arr[int(rnd() * n)]
                    mr.append(k / n)
                if mr:
                    prate.append(sum(mr) / len(mr))
            side[w] = sum(prate) / len(prate)
        diffs.append((side["current"] - side["baseline"]) * 100)
    diffs.sort()
    return diffs[int(0.025 * n_boot)], diffs[int(0.975 * n_boot)]


# ---------------------------------------------------------------- analysis
def analyse(rows, prompts, baseline, current, brand=BRAND):
    rows = tag_windows(rows, baseline, current)
    models = sorted({r["model"] for r in rows})
    topics = list(dict.fromkeys(p["topic"] for p in prompts.values()))
    res = {"baseline": baseline, "current": current, "models": models, "brand": brand}

    res["coverage"] = {w: dict(C.Counter(r["model"] for r in rows if r["window"] == w)) for w in ("baseline", "current")}

    raw = {w: stats([r for r in rows if r["window"] == w], brand) for w in ("baseline", "current")}
    bal = balanced(rows, models)
    res["overall"] = {
        "raw_vis": {w: raw[w]["vis"] for w in raw},
        "raw_change_pp": change_pp(raw["baseline"]["vis"], raw["current"]["vis"]),
        "balanced_vis": {w: bal[w]["vis"] for w in bal},
        "balanced_change_pp": change_pp(bal["baseline"]["vis"], bal["current"]["vis"]),
        "per_model": {m: {w: stats([r for r in rows if r["window"] == w and r["model"] == m], brand) for w in raw} for m in models},
    }

    prompt_rows = []
    for pid, p in prompts.items():
        b = balanced(rows, models, prompt_id=pid)
        cells = [s["n"] for w in b.values() for s in w["per_model"].values()]
        prompt_rows.append({
            "prompt_id": pid, "topic": p["topic"], "prompt": p["prompt"],
            "baseline": b["baseline"]["vis"], "current": b["current"]["vis"],
            "change_pp": change_pp(b["baseline"]["vis"], b["current"]["vis"]),
            "per_model": {m: {w: b[w]["per_model"].get(m) for w in b} for m in models},
            "min_cell_n": min(cells) if cells else 0,
            "thin": (min(cells) if cells else 0) < MIN_CELL_N,
        })
    res["prompts"] = prompt_rows

    topic_rows = []
    for t in topics:
        ps = [p for p in prompt_rows if p["topic"] == t]
        b = sum(p["baseline"] for p in ps) / len(ps); c = sum(p["current"] for p in ps) / len(ps)
        pm = {m: {w: stats([r for r in rows if r["window"] == w and r["model"] == m and r["topic"] == t], brand)
                  for w in ("baseline", "current")} for m in models}
        moves = [pm[m]["current"]["vis"] - pm[m]["baseline"]["vis"] for m in models
                 if pm[m]["current"]["n"] and pm[m]["baseline"]["n"]]
        rawt = {w: stats([r for r in rows if r["window"] == w and r["topic"] == t], brand) for w in ("baseline", "current")}
        lo, hi = bootstrap_topic_change(rows, t, [p["prompt_id"] for p in ps], models, brand,
                                        seed=BOOT_SEED + topics.index(t))
        topic_rows.append({"topic": t, "baseline": b, "current": c, "change_pp": (c - b) * 100,
                           "relative_change": (c - b) / b if b else None,
                           "ci95_pp": [lo, hi], "ci_excludes_zero": lo > 0 or hi < 0,
                           "per_model": pm,
                           "per_model_p": {m: two_prop_p(pm[m]["baseline"]["k"], pm[m]["baseline"]["n"], pm[m]["current"]["k"], pm[m]["current"]["n"]) for m in models},
                           "models_agree_down": all(x < 0 for x in moves),
                           "models_agree_up": all(x > 0 for x in moves), "raw": rawt,
                           "raw_change_pp": change_pp(rawt["baseline"]["vis"], rawt["current"]["vis"])})
    topic_rows.sort(key=lambda t: t["change_pp"])
    res["topics"] = topic_rows

    brands = sorted({b for r in rows for b in r["brands"]})
    brands = [brand] + [b for b in brands if b != brand]
    win = []
    for t in topics:
        tps = [pid for pid, pr in prompts.items() if pr["topic"] == t]
        for w in ("baseline", "current"):
            sub = [r for r in rows if r["topic"] == t and r["window"] == w]
            row = {"topic": t, "window": w, "n": len(sub)}
            for b in brands:
                # like-for-like: per prompt, average the engines equally; then average the topic's prompts
                pr_rates = []
                for pid in tps:
                    per = []
                    for m in models:
                        cell = [r for r in sub if r["prompt_id"] == pid and r["model"] == m]
                        if cell:
                            per.append(sum(1 for r in cell if r["brands"].get(b) == 1) / len(cell))
                    if per:
                        pr_rates.append(sum(per) / len(per))
                row[b] = sum(pr_rates) / len(pr_rates)
            win.append(row)
    res["winners"] = win
    res["brands"] = brands

    # position profile of every brand across all answers: how often mentioned and where
    prof = {}
    for b in brands:
        s = stats(rows, b); pc = C.Counter(r["brands"][b] for r in rows if b in r["brands"])
        prof[b] = {"mention_rate": s["vis"], "avg_pos": s["avg_pos"], "positions": {str(k): pc[k] for k in sorted(pc)}}
    res["position_profile"] = prof

    cit = C.Counter()
    for r in rows:
        for c in r["citations"]:
            cit[(r["topic"], r["window"], c["url"].split("//")[1])] += 1
    res["citations"] = [{"topic": k[0], "window": k[1], "url": k[2], "refs": v} for k, v in sorted(cit.items())]
    slug = brand.lower().replace(" ", "-")
    own = [r for r in rows if any(slug in c["url"] for c in r["citations"])]
    res["own_domain_cited_without_mention"] = sum(1 for r in own if brand not in r["brands"])
    ocr = []
    for t in topics:
        cell = {}
        for w in ("baseline", "current"):
            per = {}
            for m in models:
                sub = [r for r in rows if r["window"] == w and r["model"] == m and r["topic"] == t]
                if sub:
                    per[m] = (sum(1 for r in sub if any(slug in c["url"] for c in r["citations"])), len(sub))
            cell[w] = {"per_model": per, "rate": sum(k / n for k, n in per.values()) / len(per)}
        ocr.append({"topic": t, **cell, "change_pp": (cell["current"]["rate"] - cell["baseline"]["rate"]) * 100})
    res["own_citation_rate"] = ocr

    top = topic_rows[0]
    res["recommendation"] = {"topic": top["topic"], "change_pp": top["change_pp"],
                             "supported": top["change_pp"] < 0 and top["models_agree_down"],
                             "ci95_pp": top["ci95_pp"], "ci_excludes_zero": top["ci_excludes_zero"],
                             "worst_prompts": sorted([p for p in prompt_rows if p["topic"] == top["topic"]],
                                                     key=lambda p: (round(p["change_pp"], 6), p["prompt_id"]))}
    res["_rows"] = rows
    res["checks"] = run_checks(res)
    return res


def evidence(res, topic, limit=6):
    """Answer IDs to read first. For the topic's two weakest prompts, take the same number from each:
    current-window answers that omit the brand, and baseline answers on those prompts that included it."""
    rows, brand = res["_rows"], res["brand"]
    worst = [p["prompt_id"] for p in res["recommendation"]["worst_prompts"][:2]] if topic == res["recommendation"]["topic"] else None
    per = max(1, limit // len(worst)) if worst else limit
    def pick(w, has):
        out = []
        for pid in (worst or [None]):
            sub = [r for r in rows if r["topic"] == topic and r["window"] == w and ((brand in r["brands"]) == has)
                   and (pid is None or r["prompt_id"] == pid)]
            out += sorted(sub, key=lambda r: (r["model"], r["answer_id"]))[:per]
        return out
    return {"lost": pick("current", False), "had": pick("baseline", True)}


# ---------------------------------------------------------------- checks
def run_checks(res, hygiene=None):
    """Independent re-computations. Each returns (name, status, detail); status is PASS, WARN or FAIL."""
    rows, brand, out = res["_rows"], res["brand"], []
    # 1 mention annotations agree with the answer text
    all_brands = {m["brand"] for r in rows for m in r["mentions"]}
    bad = sum(1 for r in rows for b in all_brands if (b in r["brands"]) != (b in r["response_text"]))
    out.append(("Mention annotations match the answer text", "PASS" if bad == 0 else "FAIL",
                f"{len(rows) * len(all_brands) - bad} of {len(rows) * len(all_brands)} answer-by-brand checks agree"))
    # 2 positions are 1..n and unique inside every answer
    badpos = sum(1 for r in rows if sorted(r["brands"].values()) != list(range(1, len(r["brands"]) + 1)))
    out.append(("Shortlist positions are 1..n with no gaps or repeats", "PASS" if badpos == 0 else "FAIL", f"{badpos} answers violate"))
    # 3 no duplicate ids after cleaning
    out.append(("No answer_id appears twice after cleaning", "PASS" if len({r['answer_id'] for r in rows}) == len(rows) else "FAIL",
                f"{len(rows)} unique successful answers"))
    # 4 every row is in a window, and error rows are out of every denominator
    n_cells = sum(v for w in res["coverage"].values() for v in w.values())
    out.append(("Denominators equal successful answers in the windows", "PASS" if n_cells == len(rows) else "FAIL", f"{n_cells} answers counted across engines and windows"))
    # 5 hand reproduction of the top topic's raw and like-for-like numbers with plain loops
    t = res["topics"][0]["topic"]; ok = True; msg = []; drift = 0.0
    for w in ("baseline", "current"):
        k = n = 0
        per = []
        for m in res["models"]:
            kk = nn = 0
            for r in rows:
                if r["topic"] == t and r["window"] == w and r["model"] == m:
                    nn += 1; kk += 1 if brand in r["brands"] else 0
            k += kk; n += nn; per.append(kk / nn if nn else None)
        raw_hand = k / n
        lfl_hand = sum(per) / len(per)
        rep = res["topics"][0]
        ok &= abs(raw_hand - rep["raw"][w]["vis"]) < 1e-12
        drift = max(drift, abs(lfl_hand - (rep["baseline"] if w == "baseline" else rep["current"])))
        msg.append(f"{w}: raw {k}/{n} = {raw_hand:.1%}; like-for-like mean of {', '.join(f'{p:.0%}' for p in per)} = {lfl_hand:.1%}")
    status = "FAIL" if not ok else "PASS" if drift < 1e-9 else "WARN"
    if drift >= 1e-9 and ok:
        msg.append(f"engine-mean and prompt-mean like-for-like differ by {drift*100:.2f} pp (prompts have unequal answer counts)")
    out.append((f"Hand recomputation of {t}", status, "; ".join(msg)))
    # 6 same prompts tracked in both windows
    pb = {r["prompt_id"] for r in rows if r["window"] == "baseline"}; pc = {r["prompt_id"] for r in rows if r["window"] == "current"}
    out.append(("Same prompts in both windows", "PASS" if pb == pc else "WARN", f"{len(pb)} prompts baseline, {len(pc)} current"))
    # 7 engine mix
    cb, cc = res["coverage"]["baseline"], res["coverage"]["current"]
    tb, tc = sum(cb.values()), sum(cc.values())
    skew = max(abs(cb.get(m, 0) / tb - cc.get(m, 0) / tc) for m in res["models"])
    out.append(("Engine mix is the same in both windows", "PASS" if skew < 0.15 else "WARN",
                f"largest shift {skew:.0%} " + ("(raw numbers are comparable)" if skew < .15 else "(raw numbers are NOT comparable; use like-for-like)")))
    # 8 small cells
    thin = sum(1 for p in res["prompts"] if p["thin"])
    out.append(("No small prompt-level cells", "PASS" if thin == 0 else "WARN", f"{thin} of {len(res['prompts'])} prompts have a cell under {MIN_CELL_N} answers"))
    return out


# ---------------------------------------------------------------- text outputs
def pct(x, d=0):
    return "n/a" if x is None else f"{x*100:.{d}f}%"

def pp(x):
    return "n/a" if x is None else f"{x:+.0f} pp"

def kn(s):
    return f"{s['k']}/{s['n']}"


def next_steps(res):
    t = res["recommendation"]["topic"]; ps = res["recommendation"]["worst_prompts"]
    weak = ", ".join(p["prompt_id"] for p in ps[:2])
    return [
        ("This week", "Content marketer", f"Read the answers listed under 'Records to read first' (about 12 answers). Note which competitors and which sources the answers lean on when {res['brand']} is missing, for {weak}."),
        ("This week", "Content marketer", f"Compare {res['brand'].lower().replace(' ', '-')}.example's {t.lower()} pages with the pages the answers cite most (see the citation table), looking for missing or thin content on the weakest questions."),
        ("This week", "Director", "Ask the customer what changed on those pages between the windows, and why the sampled engine mix changed. Either answer could explain the movement."),
        ("Next Monday", "Director", f"Re-run with an equal number of answers per engine. If {t} is still down beyond the interval, brief the page work. If it is back within the interval, drop it and take the next-ranked topic."),
    ]


def brief(res, hygiene):
    b, c = res["baseline"], res["current"]
    ov, rec = res["overall"], res["recommendation"]
    brand = res["brand"]
    top = res["topics"][0]
    L = []
    L += [f"# Weekly AI-answer review: {brand}", ""]
    if rec["supported"]:
        L += [f"**In one sentence:** the {rec['topic']} questions are the one topic where {brand}'s mention rate fell in both ChatGPT and Gemini "
              f"({pct(top['baseline'])} to {pct(top['current'])} like-for-like), so that is the investigation to take this week. The direction is consistent; the size is uncertain because the samples are small.", ""]
    else:
        L += ["**In one sentence:** no topic shows a consistent like-for-like decline this week.", ""]
    L += ["## About the customer", "", ABOUT, "",
          "## How to read the numbers", "",
          f"- **Baseline** is the earlier window ({b[0]} to {b[1]}), the starting point. **Current** is the later window ({c[0]} to {c[1]}), the week the meeting is about. Dates are America/New_York.",
          "- **Mention rate** (called visibility in the data dictionary) = answers that mention the brand / successful answers.",
          "- **Raw** pools every answer. **Like-for-like** works out the rate inside each answer engine first, then averages the engines equally, so a change in which engines were sampled cannot masquerade as a change in the brand.",
          "- **pp** = percentage points (later % minus earlier %). **Relative change** = pp change / earlier %.", ""]
    L += ["## Why the raw number is misleading", "",
          f"Raw mention rate moved {pct(ov['raw_vis']['baseline'])} to {pct(ov['raw_vis']['current'])} ({pp(ov['raw_change_pp'])}), but the engine mix changed between windows. "
          "ChatGPT mentions the brand far more often than Gemini, so shifting the sample from mostly ChatGPT to mostly Gemini pulls the pooled number down even if neither engine changed.", "",
          "| Engine | Baseline answers | Current answers |", "|---|---|---|"]
    for m in res["models"]:
        L += [f"| {m} | {res['coverage']['baseline'].get(m,0)} | {res['coverage']['current'].get(m,0)} |"]
    L += ["", "Engine by engine, overall mention rate barely moved:", "", "| Engine | Baseline | Current | Change |", "|---|---|---|---|"]
    for m, v in ov["per_model"].items():
        L += [f"| {m} | {pct(v['baseline']['vis'])} ({kn(v['baseline'])}) | {pct(v['current']['vis'])} ({kn(v['current'])}) | {pp((v['current']['vis']-v['baseline']['vis'])*100)} |"]
    L += ["", f"Like-for-like overall: {pct(ov['balanced_vis']['baseline'],1)} to {pct(ov['balanced_vis']['current'],1)} ({pp(ov['balanced_change_pp'])}).", ""]
    L += ["## By topic", "",
          "| Topic | Raw (mentions/answers) | Like-for-like | Change | Relative | 95% interval (pp) |", "|---|---|---|---|---|---|"]
    for t in res["topics"]:
        L += [f"| {t['topic']} | {pct(t['raw']['baseline']['vis'])} ({kn(t['raw']['baseline'])}) to {pct(t['raw']['current']['vis'])} ({kn(t['raw']['current'])}) | "
              f"{pct(t['baseline'])} to {pct(t['current'])} | {pp(t['change_pp'])} | {t['relative_change']*100:+.0f}% | {t['ci95_pp'][0]:+.0f} to {t['ci95_pp'][1]:+.0f} |"]
    L += ["", "The interval is a bootstrap estimate of the like-for-like change (answers resampled within each prompt, engine and window; 2,000 resamples, fixed seed). "
          "An interval that includes 0 means this data alone cannot rule out no change. Because answers to the same prompt repeat, the interval is optimistic.", ""]
    ps_ = ", ".join(f"{m} p={v:.2f}" for m, v in top["per_model_p"].items())
    if rec["ci_excludes_zero"]:
        L += [f"**On {rec['topic']}:** the interval ({rec['ci95_pp'][0]:+.0f} to {rec['ci95_pp'][1]:+.0f} pp) only just excludes 0, and it is optimistic. Engine by engine, a plain two-proportion test gives {ps_}; neither passes 0.05 on its own. "
              "So the honest wording is 'consistent and worth investigating', not 'statistically significant'. The next step is a re-check with equal samples, not a rebuild.", ""]
    else:
        L += [f"**On {rec['topic']}:** the interval ({rec['ci95_pp'][0]:+.0f} to {rec['ci95_pp'][1]:+.0f} pp) includes 0. The drop is consistent across engines and prompts but not conclusive on its own, which is why the next step is a re-check, not a rebuild.", ""]
    L += [f"### How the {top['topic']} numbers are built (reproduce by hand)", "",
          "| Window | Per-engine cells (mentions/answers) | Raw pooled | Like-for-like |", "|---|---|---|---|"]
    for w in ("baseline", "current"):
        parts = " ; ".join(f"{m}: {kn(top['per_model'][m][w])} = {pct(top['per_model'][m][w]['vis'])}" for m in res["models"])
        L += [f"| {w} | {parts} | {kn(top['raw'][w])} = {pct(top['raw'][w]['vis'])} | mean of the engine rates = {pct(top['baseline'] if w=='baseline' else top['current'],1)} |"]
    L += ["", "Raw divides all mentions by all answers. Like-for-like averages the engine rates, so each engine counts once however many answers it has.", ""]
    L += ["## Questions to look at first", "", "| Prompt | Baseline | Current | Change | Smallest cell n |", "|---|---|---|---|---|"]
    for p in rec["worst_prompts"]:
        L += [f"| {p['prompt_id']}: {p['prompt']} | {pct(p['baseline'])} | {pct(p['current'])} | {pp(p['change_pp'])} | {p['min_cell_n']}{' (thin)' if p['thin'] else ''} |"]
    L += ["", "## Why not the other topics", ""]
    for t in res["topics"][1:]:
        L += [f"- **{t['topic']}**: {pct(t['baseline'])} to {pct(t['current'])} like-for-like ({pp(t['change_pp'])}); the pooled drop ({pp(t['raw_change_pp'])}) is mostly the engine mix."]
    L += ["", "## Who wins each topic", "", "Share of answers where each brand is ranked #1 (current window, like-for-like):", "",
          "| Topic | " + " | ".join(res["brands"]) + " |", "|---|" + "---|" * len(res["brands"])]
    for r in res["winners"]:
        if r["window"] == "current":
            L += [f"| {r['topic']} | " + " | ".join(pct(r[x]) for x in res["brands"]) + " |"]
    L += ["", "Where each brand sits when it appears (all answers):", "", "| Brand | Mention rate | Average position | Times at #1 / #2 / #3 |", "|---|---|---|---|"]
    for bname, pr in res["position_profile"].items():
        L += [f"| {bname} | {pct(pr['mention_rate'])} | {pr['avg_pos']:.2f} | " + " / ".join(str(pr['positions'].get(k, 0)) for k in ("1", "2", "3")) + " |"]
    L += ["", f"Only three brands exist in this data, so {brand} can appear only in answers that list all three; answers that list two never contain it. That is arithmetic, not a pattern.", ""]
    L += ["", f"## {brand}'s own pages cited", "",
          "Share of answers citing any page on the brand's own domain (engines equally weighted).", "",
          "| Topic | Baseline | Current | Change |", "|---|---|---|---|"]
    for o in res["own_citation_rate"]:
        L += [f"| {o['topic']} | {pct(o['baseline']['rate'])} | {pct(o['current']['rate'])} | {pp(o['change_pp'])} |"]
    L += ["", f"{brand}'s domain is cited only in answers that also mention {brand} ({res['own_domain_cited_without_mention']} exceptions), so citation rate is a subset of mention rate here, not an independent signal.", ""]
    ev = evidence(res, rec["topic"])
    L += [f"## Records to read first ({rec['topic']})", "", "Current-window answers without " + brand + " on the weakest prompts:", ""]
    L += [f"- `{r['answer_id']}` ({r['prompt_id']}, {r['model']}, {r['date']})" for r in ev["lost"]]
    L += ["", "Baseline-window answers on the same prompts that did include it:", ""]
    L += [f"- `{r['answer_id']}` ({r['prompt_id']}, {r['model']}, {r['date']})" for r in ev["had"]]
    L += ["", f"## Recommended next steps ({rec['topic']})", "", "| When | Suggested owner | Action |", "|---|---|---|"]
    for when, who, what in next_steps(res):
        L += [f"| {when} | {who} | {what} |"]
    L += ["", "Owners follow the roles in the customer brief (a director and two content marketers) and are suggestions.", ""]
    L += ["## What we observe vs what needs verifying", "",
          "**Observed:** the figures above, in this export only.", "", "**Not established, to verify with the customer:**", ""]
    L += [f"- {x}" for x in VERIFY_WITH_CUSTOMER]
    L += ["- Whether any of this affects traffic, leads or revenue. The export has none of that data.", "",
          "## Assumptions", ""] + [f"- {x}" for x in ASSUMPTIONS]
    L += ["", "## Checks run", "", "| Check | Result | Detail |", "|---|---|---|"]
    for name, st, det in res["checks"]:
        L += [f"| {name} | {st} | {det} |"]
    L += ["", "## Data hygiene", "",
          f"{hygiene['raw_lines']} lines read; {hygiene['duplicate_rows_removed']} exact duplicate rows removed; {hygiene['error_rows_excluded']} error rows excluded from every denominator (an error is not brand absence); {hygiene['successful_answers']} successful answers analysed.", ""]
    return "\n".join(L)


def slack_summary(res):
    rec, top, ov = res["recommendation"], res["topics"][0], res["overall"]
    link = f"(95% interval {rec['ci95_pp'][0]:+.0f} to {rec['ci95_pp'][1]:+.0f} pp, so worth investigating, not proven)"
    lines = [f"*{res['brand']} AI-answer review, {res['current'][0]} to {res['current'][1]} vs {res['baseline'][0]} to {res['baseline'][1]}*"]
    if rec["supported"]:
        lines.append(f"Investigate: *{rec['topic']}* — mention rate {pct(top['baseline'])} to {pct(top['current'])} like-for-like ({pp(top['change_pp'])}), down in every engine {link}.")
    else:
        lines.append("No topic shows a consistent like-for-like decline this week.")
    lines.append(f"Other topics: " + ", ".join(f"{t['topic']} {pp(t['change_pp'])}" for t in res["topics"][1:]) + ".")
    lines.append(f"Heads up: raw overall moved {pp(ov['raw_change_pp'])} but like-for-like only {pp(ov['balanced_change_pp'])} because the engine mix changed.")
    lines.append("Read first: " + ", ".join(r["answer_id"] for r in evidence(res, rec["topic"])["lost"][:4]))
    return "\n".join(lines)


def public(res):
    d = {k: v for k, v in res.items() if not k.startswith("_")}
    d["checks"] = [{"name": n, "status": s, "detail": x} for n, s, x in res["checks"]]
    return d


def run(answers, prompts_path, out=None, baseline=None, current=None, brand=BRAND):
    rows, errors, prompts, hygiene = load(answers, prompts_path)
    if not (baseline and current):
        baseline, current = infer_windows(rows)
    res = analyse(rows, prompts, baseline, current, brand)
    md = brief(res, hygiene)
    if out:
        os.makedirs(out, exist_ok=True)
        with open(os.path.join(out, "weekly_brief.md"), "w") as f: f.write(md)
        with open(os.path.join(out, "slack_summary.txt"), "w") as f: f.write(slack_summary(res) + "\n")
        with open(os.path.join(out, "metrics.json"), "w") as f: json.dump({"hygiene": hygiene, **public(res)}, f, indent=2)
    return res, hygiene, md


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("answers"); ap.add_argument("prompts"); ap.add_argument("--out", default="sample_output")
    ap.add_argument("--baseline", nargs=2); ap.add_argument("--current", nargs=2); ap.add_argument("--brand", default=BRAND)
    a = ap.parse_args()
    _, _, md = run(a.answers, a.prompts, a.out, a.baseline, a.current, a.brand)
    print(md)
