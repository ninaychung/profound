# Weekly AI-answer review: ACME Desk

**In one sentence:** the Integrations questions are the one topic where ACME Desk's mention rate fell in both ChatGPT and Gemini (30% to 15% like-for-like), so that is the investigation to take this week. The direction is consistent; the size is uncertain because the samples are small.

## About the customer

ACME Desk (fictional) sells help desk software to growing B2B software companies: a shared inbox, ticket routing, support reporting and CRM connections. Its marketing team is a director and two content marketers, who can investigate one issue per week. Relay Inbox and Clearqueue are its (fictional) competitors. Source: customer_brief.txt. No mission statement was supplied, so none is quoted here.

## How to read the numbers

- **Baseline** is the earlier window (2026-09-01 to 2026-09-14), the starting point. **Current** is the later window (2026-10-01 to 2026-10-14), the week the meeting is about. Dates are America/New_York.
- **Mention rate** (called visibility in the data dictionary) = answers that mention the brand / successful answers.
- **Raw** pools every answer. **Like-for-like** works out the rate inside each answer engine first, then averages the engines equally, so a change in which engines were sampled cannot masquerade as a change in the brand.
- **pp** = percentage points (later % minus earlier %). **Relative change** = pp change / earlier %.

## Why the raw number is misleading

Raw mention rate moved 47% to 26% (-21 pp), but the engine mix changed between windows. ChatGPT mentions the brand far more often than Gemini, so shifting the sample from mostly ChatGPT to mostly Gemini pulls the pooled number down even if neither engine changed.

| Engine | Baseline answers | Current answers |
|---|---|---|
| ChatGPT | 240 | 60 |
| Google Gemini | 60 | 240 |

Engine by engine, overall mention rate barely moved:

| Engine | Baseline | Current | Change |
|---|---|---|---|
| ChatGPT | 53% (128/240) | 50% (30/60) | -3 pp |
| Google Gemini | 20% (12/60) | 20% (48/240) | +0 pp |

Like-for-like overall: 36.7% to 35.0% (-2 pp).

## By topic

| Topic | Raw (mentions/answers) | Like-for-like | Change | Relative | 95% interval (pp) |
|---|---|---|---|---|---|
| Integrations | 36% (36/100) to 12% (12/100) | 30% to 15% | -15 pp | -50% | -28 to -2 |
| Help desk selection | 52% (52/100) to 33% (33/100) | 40% to 45% | +5 pp | +12% | -11 to +19 |
| Reporting and operations | 52% (52/100) to 33% (33/100) | 40% to 45% | +5 pp | +12% | -9 to +19 |

The interval is a bootstrap estimate of the like-for-like change (answers resampled within each prompt, engine and window; 2,000 resamples, fixed seed). An interval that includes 0 means this data alone cannot rule out no change. Because answers to the same prompt repeat, the interval is optimistic.

**On Integrations:** the interval (-28 to -2 pp) only just excludes 0, and it is optimistic. Engine by engine, a plain two-proportion test gives ChatGPT p=0.10, Google Gemini p=0.22; neither passes 0.05 on its own. So the honest wording is 'consistent and worth investigating', not 'statistically significant'. The next step is a re-check with equal samples, not a rebuild.

### How the Integrations numbers are built (reproduce by hand)

| Window | Per-engine cells (mentions/answers) | Raw pooled | Like-for-like |
|---|---|---|---|
| baseline | ChatGPT: 32/80 = 40% ; Google Gemini: 4/20 = 20% | 36/100 = 36% | mean of the engine rates = 30.0% |
| current | ChatGPT: 4/20 = 20% ; Google Gemini: 8/80 = 10% | 12/100 = 12% | mean of the engine rates = 15.0% |

Raw divides all mentions by all answers. Like-for-like averages the engine rates, so each engine counts once however many answers it has.

## Questions to look at first

| Prompt | Baseline | Current | Change | Smallest cell n |
|---|---|---|---|---|
| p33: Compare help desk tools for a team that needs CRM ticket sync. | 30% | 5% | -25 pp | 5 (thin) |
| p31: Which help desk tools connect support tickets with CRM accounts? | 32% | 20% | -12 pp | 5 (thin) |
| p32: What support platforms integrate well with a sales CRM? | 30% | 18% | -13 pp | 5 (thin) |
| p34: Which support tools help sales teams see open customer issues? | 28% | 18% | -10 pp | 5 (thin) |

## Why not the other topics

- **Help desk selection**: 40% to 45% like-for-like (+5 pp); the pooled drop (-19 pp) is mostly the engine mix.
- **Reporting and operations**: 40% to 45% like-for-like (+5 pp); the pooled drop (-19 pp) is mostly the engine mix.

## Who wins each topic

Share of answers where each brand is ranked #1 (current window, like-for-like):

| Topic | ACME Desk | Clearqueue | Relay Inbox |
|---|---|---|---|
| Help desk selection | 18% | 0% | 82% |
| Reporting and operations | 13% | 0% | 87% |
| Integrations | 5% | 0% | 95% |

Where each brand sits when it appears (all answers):

| Brand | Mention rate | Average position | Times at #1 / #2 / #3 |
|---|---|---|---|
| ACME Desk | 36% | 1.97 | 75 / 74 / 69 |
| Clearqueue | 100% | 2.25 | 0 / 451 / 149 |
| Relay Inbox | 100% | 1.12 | 525 / 75 / 0 |

Only three brands exist in this data, so ACME Desk can appear only in answers that list all three; answers that list two never contain it. That is arithmetic, not a pattern.


## ACME Desk's own pages cited

Share of answers citing any page on the brand's own domain (engines equally weighted).

| Topic | Baseline | Current | Change |
|---|---|---|---|
| Help desk selection | 19% | 21% | +2 pp |
| Reporting and operations | 21% | 19% | -3 pp |
| Integrations | 16% | 6% | -9 pp |

ACME Desk's domain is cited only in answers that also mention ACME Desk (0 exceptions), so citation rate is a subset of mention rate here, not an independent signal.

## Records to read first (Integrations)

Current-window answers without ACME Desk on the weakest prompts:

- `a0503` (p33, ChatGPT, 2026-10-03)
- `a0507` (p33, ChatGPT, 2026-10-07)
- `a0511` (p33, ChatGPT, 2026-10-11)
- `a0501` (p31, ChatGPT, 2026-10-01)
- `a0509` (p31, ChatGPT, 2026-10-09)
- `a0513` (p31, ChatGPT, 2026-10-13)

Baseline-window answers on the same prompts that did include it:

- `a0215` (p33, ChatGPT, 2026-09-01)
- `a0235` (p33, ChatGPT, 2026-09-07)
- `a0243` (p33, ChatGPT, 2026-09-01)
- `a0201` (p31, ChatGPT, 2026-09-01)
- `a0209` (p31, ChatGPT, 2026-09-09)
- `a0225` (p31, ChatGPT, 2026-09-11)

## Recommended next steps (Integrations)

| When | Suggested owner | Action |
|---|---|---|
| This week | Content marketer | Read the answers listed under 'Records to read first' (about 12 answers). Note which competitors and which sources the answers lean on when ACME Desk is missing, for p33, p31. |
| This week | Content marketer | Compare acme-desk.example's integrations pages with the pages the answers cite most (see the citation table), looking for missing or thin content on the weakest questions. |
| This week | Director | Ask the customer what changed on those pages between the windows, and why the sampled engine mix changed. Either answer could explain the movement. |
| Next Monday | Director | Re-run with an equal number of answers per engine. If Integrations is still down beyond the interval, brief the page work. If it is back within the interval, drop it and take the next-ranked topic. |

Owners follow the roles in the customer brief (a director and two content marketers) and are suggestions.

## What we observe vs what needs verifying

**Observed:** the figures above, in this export only.

**Not established, to verify with the customer:**

- Did anything change on ACME's CRM / integrations pages or docs between the windows?
- Why did the sampled engine mix change (Gemini 60 to 240 answers, ChatGPT 240 to 60)? Was it deliberate?
- How much pipeline comes from integration-driven buyers? Equal topic weights is an assumption.
- Are these 12 prompts the ones buyers actually use?
- Whether any of this affects traffic, leads or revenue. The export has none of that data.

## Assumptions

- Answer engines are weighted equally (ChatGPT = Gemini). A choice made so the engine mix cannot drive the result; it does not say both matter equally to buyers.
- Topics are weighted equally. If Integrations buyers are worth more or less than the others, the ranking should change.
- The 12 tracked prompts stand for what buyers ask. Their completeness and wording are not tested by this data.
- Brand mentions and positions in the export are accurate (spot-checked against the answer text: they agree).
- Repeated answers to the same prompt are treated as separate observations. They are not fully independent, so the intervals here are optimistic.
- The earlier window is the baseline. Nothing is known about what changed between windows.

## Checks run

| Check | Result | Detail |
|---|---|---|
| Mention annotations match the answer text | PASS | 1800 of 1800 answer-by-brand checks agree |
| Shortlist positions are 1..n with no gaps or repeats | PASS | 0 answers violate |
| No answer_id appears twice after cleaning | PASS | 600 unique successful answers |
| Denominators equal successful answers in the windows | PASS | 600 answers counted across engines and windows |
| Hand recomputation of Integrations | PASS | baseline: raw 36/100 = 36.0%; like-for-like mean of 40%, 20% = 30.0%; current: raw 12/100 = 12.0%; like-for-like mean of 20%, 10% = 15.0% |
| Same prompts in both windows | PASS | 12 prompts baseline, 12 current |
| Engine mix is the same in both windows | WARN | largest shift 60% (raw numbers are NOT comparable; use like-for-like) |
| No small prompt-level cells | WARN | 12 of 12 prompts have a cell under 10 answers |

## Data hygiene

618 lines read; 6 exact duplicate rows removed; 12 error rows excluded from every denominator (an error is not brand absence); 600 successful answers analysed.
