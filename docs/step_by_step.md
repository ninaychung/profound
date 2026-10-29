# Step by step, in order

Every number below is from the supplied export and can be reproduced on the site (hover any number) or with `python -m aeo.analysis`.

## 1–2. Load and clean
**What:** read 618 lines of `answers.jsonl` and `prompts.json`. Remove 6 repeated rows, drop 12 error rows, leave 600 answers (300 per window).
**Why:**
- The data dictionary says a repeated `answer_id` is the same record exported twice, not a new observation. I checked that all 6 repeats were identical copies.
- An `error` row means no answer was collected. It is not "the brand was absent", so counting it would lower every rate. The errors are spread across engines, prompts and both windows (6 per window), so excluding them does not tilt the comparison.
**Windows:** dates are grouped into clusters more than 3 days apart: Sep 1–14 is the **baseline** (starting point), Oct 1–14 is the **current** window (the week the meeting is about).
**Means:** the denominators for everything after this are successful answers only.

## 3. Raw vs like-for-like (the key step)
**Definitions:** mention rate = answers that mention ACME Desk / successful answers.
**Raw:** 140/300 = 46.7% (Sep) and 78/300 = 26.0% (Oct): -21 pp.
**Why that can't be trusted:** engine mix per window was ChatGPT 240 / Gemini 60 in September and ChatGPT 60 / Gemini 240 in October. ChatGPT mentions ACME about half the time, Gemini about a fifth. Engine by engine, overall barely moved:

| Engine | Sep | Oct |
|---|---|---|
| ChatGPT | 128/240 = 53% | 30/60 = 50% |
| Gemini | 12/60 = 20% | 48/240 = 20% |

**Like-for-like:** compute each engine's rate, then average with equal weight: (53.3% + 20%) / 2 = 36.7% in Sep; (50% + 20%) / 2 = 35.0% in Oct: -2 pp.
**Why equal weights:** it removes "who got asked" from the comparison. It is a choice, not a claim that both engines matter equally to buyers.
**Means:** the -21 pp headline is almost entirely sampling mix; the real overall change is about -2 pp.

## 4. By topic
Each topic's value is the average of its 4 prompts' like-for-like rates.

| Topic | Raw | Engine cells (Sep to Oct) | Like-for-like | Change |
|---|---|---|---|---|
| Integrations | 36/100 to 12/100 | ChatGPT 32/80 to 4/20; Gemini 4/20 to 8/80 | 30% to 15% | -15 pp (-50% relative) |
| Help desk selection | 52/100 to 33/100 | ChatGPT 48/80 to 13/20; Gemini 4/20 to 20/80 | 40% to 45% | +5 pp |
| Reporting and operations | 52/100 to 33/100 | same counts as Help desk | 40% to 45% | +5 pp |

**Hand calculation (Integrations, October):** ChatGPT 4/20 = 20%, Gemini 8/80 = 10%; raw = 12/100 = 12%; like-for-like = (20% + 10%) / 2 = 15%.
**Why it matters:** raw shows all three topics falling (-24, -19, -19 pp). Like-for-like shows only Integrations falling, and it falls in both engines (ChatGPT 40% to 20%, Gemini 20% to 10%).
**Rule used for the recommendation:** biggest like-for-like drop, and it must appear in every engine.

## 5. Who wins each topic
**What:** the share of answers where each brand is ranked #1 (like-for-like, current window): Relay Inbox 82% / 87% / 95% (Help desk / Reporting / Integrations), ACME 18% / 13% / 5%, Clearqueue 0%.
**Means:** Relay is the default winner everywhere. ACME's ranked-first share on Integrations fell from 17.5% to 5%. Clearqueue is in every answer but always #2 or #3, so it never wins.
**Position profile (all answers):** ACME is mentioned in 218 of 600 answers; when it appears it is #1 in 75, #2 in 74, #3 in 69 (average 1.97). It can only appear when a third brand slot is listed, because Relay and Clearqueue are in every answer.

## 6. Which buyer questions moved
**What:** per prompt, current minus baseline like-for-like, in percentage points.
**Result:** Integrations: p33 -25, p31 -12.5, p32 -12.5, p34 -10. One non-Integrations prompt also fell: p21 (response time) -15 pp, while its topic rose because p14 (+22.5) and p24 (+20) rose.
**Caveat:** every prompt has an engine cell with only 5 answers, so read the ranking, not the exact bar size. I show one banner instead of flagging every bar.

## 7. How sure are we?
**Bootstrap:** resample answers with replacement inside each prompt, engine and window cell, recompute the topic change, repeat 2,000 times, and take the 2.5th and 97.5th percentiles (fixed random seed, so it is reproducible).
- Integrations: -28 to -2 pp (just excludes 0). Help desk: -11 to +19. Reporting: -9 to +19.
**Plain test per engine** (two-proportion z): z = (p2 - p1) / sqrt(p̂(1 - p̂)(1/n1 + 1/n2)).
- ChatGPT: p̂ = 36/100 = 0.36, se = 0.12, z = -1.67, p = 0.10. Gemini: p̂ = 0.12, se = 0.081, z = -1.23, p = 0.22.
**Means:** consistent direction and worth investigating, but not statistically significant on its own. Repeated answers to the same prompt make both measures optimistic. To confirm a 40% to 20% drop you would need about 80 answers per window in that engine; for 20% to 10%, about 200.

## 8. Checks
Eight independent checks: mention annotations match answer text (1,800 of 1,800 brand-by-answer checks), positions are valid, no duplicate IDs, denominators add up, hand recomputation of the headline topic, same prompts in both windows. Two warnings are real limitations: the engine mix differs (largest shift 60 points) and all 12 prompts have a small cell.

## 9. Assumptions, things to verify, next steps
- **Assumptions:** engines equal, topics equal, the 12 prompts represent buyer questions, repeated answers are treated as independent.
- **Verify with the customer:** whether integration pages changed between windows, why the engine mix changed, how much pipeline depends on integrations, whether the prompts are right.
- **Next steps:** read 12 flagged answers (content marketer, this week), compare ACME's integration pages with the pages the answers cite (content marketer), ask the customer what changed (director), re-run next Monday with equal samples per engine; if still down beyond the interval, brief the page work; if inside it, drop and take the next topic.
- **Evidence of a possible lead:** ACME's own pages are cited in 15.6% of Integrations answers in September and 6.3% in October (-9 pp), and only ever alongside a mention.

## 10–13. Code, Slack text, brief, records
The code is embedded (and viewable on the site). The Slack text and the brief are generated from the same numbers. The records to read first are three current-window answers without ACME for each of the two weakest prompts: p33 (a0503, a0507, a0511) and p31 (a0501, a0509, a0513; p31 ties with p32 at -12.5 pp and wins the tie alphabetically), each paired with baseline answers that did include ACME.
