# 10-minute walkthrough (follow the site, left nav, top to bottom)

**Say first (15 s):** "Integrations is the one topic where ACME Desk is mentioned less in both ChatGPT and Gemini, so that is what I would investigate this week. The direction is consistent, but the sample is small, so I would call it worth investigating, not proven."

1. **(1 min) The task.** Director spends about 3 hours a week; team can investigate one issue. Only evidence is the answer export: no traffic, leads or revenue. *Open: About ACME Desk.*
2. **(1 min) The data and cleaning.** *Answers data tab.* 618 lines, 6 duplicate `answer_id` rows removed, 12 error rows excluded (an error is not brand absence), 600 successful answers, 300 per period. Baseline = Sep 1-14, current = Oct 1-14.
3. **(2 min) The trap.** *Analysis tab, top tiles and heatmap.* Raw mention rate looks like 47% to 26%, but the engine mix flipped (ChatGPT 240 to 60 answers, Gemini 60 to 240) and ChatGPT names ACME far more than Gemini. Like-for-like (rate inside each engine, engines averaged equally): 36.7% to 35.0%. Hover a heatmap cell to show the arithmetic. Hand check: Integrations, October: ChatGPT 4/20, Gemini 8/80; raw 12/100 = 12%; like-for-like (20% + 10%)/2 = 15%.
4. **(2 min) The issue.** *Heatmap, then Mention rate change by topic and prompt.* Integrations 30% to 15% (-15 pp), down in both engines (40% to 20%, 20% to 10%). Help desk and Reporting rose 5 pp each. Weakest prompts: p33, p31, p32, p34. Click a cell to read the answers.
5. **(1 min) Visibility.** *How often each brand appears.* ACME is named in 35% of answers; Relay and Clearqueue in 100%. That is why average position alone is misleading.
6. **(1 min) How sure.** *Is each change real or noise?* Integrations: interval -28 to -2 pp, only just excludes 0; per-engine p-values 0.10 and 0.22. Help desk and Reporting could be 0. Samples are 20 answers in one period per engine.
7. **(1 min) What to do.** *Recommendation tab.* Three action items, sample answers to read, assumptions, limitations, how it was checked.
8. **(1 min) What I did not do / next.** Slack posting on a schedule, engine-specific advice, why the engine mix changed, content-change history.

## Changed requirement: be ready
- **Different engine weighting:** change the engine filter on any chart; mention that equal weighting is a choice.
- **A third period or new week:** upload a new `answers.jsonl` on the Answers data tab; periods are re-detected from the dates.
- **Run weekly and post to Slack:** the analysis stays the same; add a scheduler and a Slack send. Clarify channel, export owner and late-export handling first. Slack text already exists on the Recommendation tab.
- **Position instead of mention rate:** average position is shown beside each brand; it only counts answers that name the brand.
- **Column names change:** the tool stops and names the missing fields.

## Questions to expect
See `interview_prep.md` for short answers, and `step_by_step.md` for the calculations in order.
