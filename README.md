# ACME Desk: weekly AI-answer review

A small tool for a marketing director and two content marketers who can investigate **one issue per week**. It reads an export of AI answers (`answers.jsonl`, `prompts.json`), compares two time periods, and recommends one thing to look into, with the answers to read.

**Live site:** `https://ninaychung.github.io/profound/`  (see "Hosting" below)

## This week's result
**Investigate Integrations.** ACME Desk's mention rate on Integrations questions fell from 30% to 15% like-for-like (-15 pp), in both ChatGPT (40% to 20%) and Gemini (20% to 10%). The other two topics rose 5 pp each. The 95% interval for the Integrations change is -28 to -2 pp, which only just excludes zero, and the per-engine tests are not significant (ChatGPT p=0.10, Gemini p=0.22). The right wording is **"consistent and worth investigating, not proven"**.

The raw headline (47% to 26%) is misleading: the engine mix flipped between periods (ChatGPT 240 to 60 answers, Gemini 60 to 240) and the engines differ a lot. Like-for-like computes the rate inside each engine and averages the engines equally.

## Setup and use
**Hosted site (main deliverable).** `site/index.html` is one self-contained file with the sample data built in. Open it in a browser, or host it (below). Use the left nav: Analysis (landing page), Recommendation, and the data and brief pages. To use next week's export, go to *Answers data* and upload `answers.jsonl` (and `prompts.json` on *Topics and Prompts* if it changed). Nothing leaves the browser. Edits live in the open tab only.

**Command line.** `python -m aeo.analysis data/answers.jsonl data/prompts.json --out sample_output` writes `weekly_brief.md`, `metrics.json` and `slack_summary.txt`.

**Rebuild after editing `site/src/`:** `python site/build.py` (writes `site/index.html` and `docs/index.html`).

## Dependencies
- Site: none. Plain JavaScript, no libraries, no network calls.
- Python tool and tests: Python 3.9+, standard library only. Tests: `python -m unittest discover -s tests`.
- Browser tests (optional): Node and Playwright. `node test/browser_check.js` checks that the site's numbers match the Python output (0 mismatches on the sample).

## Hosting on GitHub Pages
Push the repo, then Settings > Pages > Deploy from a branch > `main` and folder `/docs`. The site is `docs/index.html` (a copy of `site/index.html` written by the build).

## How the numbers work
- **Mention rate** = answers naming the brand / successful answers. **Citation rate** = answers citing the brand's own domain / successful answers (answers, not distinct URLs).
- **Cleaning:** 6 duplicate `answer_id` rows removed; 12 error rows excluded from every denominator (an error is not brand absence); 600 successful answers remain (300 per period).
- **Periods:** baseline = Sep 1-14, current = Oct 1-14 (2026, America/New_York dates), found from gaps in the dates.
- **Uncertainty:** 95% interval from 2,000 seeded bootstrap resamples, plus a two-proportion test per engine. Hover any number on the site to see its arithmetic.

## Assumptions
- Engines count equally, and topics count equally (a topic is the average of its prompts). These are choices, not facts about buyer behaviour.
- The 12 prompts are the tracked set, and are what buyers actually ask. This cannot be tested from the data.
- Two periods per export; the earlier one is the baseline.
- Brand mentions come from the `mentions` field. They were checked against `response_text` and agree on all 600 successful answers.
- No AI model is used in any calculation.

## Limitations
- Small samples. After the engine swap, each engine has only 20 answers in one of the periods. Direction is more trustworthy than the size of any single change. The intervals are optimistic because repeated answers to one prompt are not independent.
- Observation only. There is no traffic, lead, revenue or content-change data, so the data cannot say why mentions changed or whether it matters commercially.
- Competitors are named in every answer, so their mention rate is 100%. Average list position is only measured when a brand is named, so it should not be read as visibility.

## What I would do next
1. Ask the customer what changed on their integrations and CRM pages between September and October, and why the engine mix changed.
2. Re-run next week with an equal number of answers per engine, so the ChatGPT and Gemini comparison is not limited to 20 answers in one period.
3. If Integrations still falls, read the sample answers for p33 and p31 and compare ACME's pages with the pages the answers cite.
4. Schedule the weekly run and post the summary to Slack.

## Unfinished
- Posting to Slack on a schedule is not built. The Slack text is generated; sending it needs a webhook and a scheduler.
- No engine-specific recommendation (the samples are too small to support one).
- Charts are hand-built SVG with no export to PNG.
- If the export's field names change, the tool stops and names the missing fields rather than guessing.
- The files in `docs/` (walkthrough, step by step, interview prep) were written alongside the site; re-read them against the site before relying on a number.

## Walkthrough material
`docs/walkthrough.md` is the ten-minute script that follows the site; `docs/step_by_step.md` has the calculations in order; `docs/interview_prep.md` has short answers to likely questions.

## AI assistance and checking
Built with Claude (Claude Code). Claude wrote the code; the plan, the format choices and the review are the author's. Checks run: unit tests; in-page checks (hand recomputation of the headline topic, mentions vs answer text, denominators, engine mix); duplicate and error counts compared against a separate profiling script; Python and JavaScript outputs compared; the site loaded in a headless browser (no console errors, filters, tooltips, phone width).
