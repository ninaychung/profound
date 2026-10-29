# Interview prep, from the practice run

## Fix before the real review
1. **One number, two answers.** By hand you got 12/100 = 12% for October Integrations; the page showed 15%. Both are right (raw vs like-for-like). Say both numbers in one breath: raw 12/100 = 12%, like-for-like 15%. Hover the Integrations cell in the heatmap to show the arithmetic.
2. **Don't say "significant" without a test.** The interval just excludes 0 and the per-engine tests are not significant (p=0.10, p=0.22). Say: "consistent across engines and prompts, worth investigating, not proven."
3. **Say what the number means.** After every number, one "so what". Example: "30% to 15%: ACME went from being on the shortlist in about 3 of 10 integration answers to about 1.5 of 10."
4. **Lead with one sentence.** "Integrations is the one topic where ACME is mentioned less in both ChatGPT and Gemini, so that's the issue I'd investigate this week; the size is uncertain because the samples are small."
5. **Make the structure answer the question.** Question: which topic should ACME focus on? Three branches, each with a number: (a) is the change real (engine mix, duplicates, noise): raw -24 pp vs like-for-like -15 pp, interval -28 to -2; (b) is it big enough to matter (relative -50% vs +12% for the others); (c) can the team act on it (own CRM page cited in 16% to 6% of answers; weakest prompt p33).
6. **Ask a question when the floor opens.** Examples: "How does your team usually act on a visibility drop: refresh a page or write new content?" "How do you decide how many answers to sample per engine each week?"
7. **Have a real "what AI got wrong" example** (see below). Do not invent one.
8. **Add the alternatives.** "Why not Help desk or Reporting": +5 pp like-for-like each, intervals include 0; the pooled drop (-19 pp) is the engine mix.

## Things you said that the data doesn't support
- "ACME is #1 when the answer lists three brands." Only three brands exist, and ACME can only appear when a third slot is listed, so every ACME mention is in a three-brand answer. Where it sits when it appears is spread evenly: #1 in 75, #2 in 74, #3 in 69 answers.
- "Make sure you have an even number of responses per engine." Equal samples are better; unequal ones are fine if you compare each engine to itself, which like-for-like does.
- "I think it's statistically significant." See point 2.
- "Clearqueue doesn't show up." It is named in every answer, always #2 or #3, so it is visible but never first. The brand chart now shows this.

## Questions you were asked, with short answers
- *Data quality?* 618 lines, 6 exact duplicate rows removed, 12 error rows excluded from every denominator (an error is not brand absence; they are spread across prompts and engines), 600 analysed. Mention annotations match the answer text in all 600.
- *Numerator and denominator?* Answers mentioning ACME / successful answers. Like-for-like: computed per engine, then averaged equally.
- *Noise?* See the interval and p-values above. Small cells: 5 answers per prompt per engine in the thin windows.
- *Reproduce one number by hand?* Integrations, October: ChatGPT 4/20, Gemini 8/80; raw 12/100; like-for-like (20% + 10%)/2 = 15%.
- *Why this issue over the others?* Only topic that fell in both engines; others rose 5 pp; relative drop -50%; own CRM page cited less.
- *Team finds nothing?* Re-run with equal samples per engine; if inside the interval, drop it and take the next topic; also ask the customer what changed on the pages.
- *How does it save the director's time?* It removes cleaning, tallying, spotting the engine-mix problem and picking the answers to read. Say what it removes, not a percentage (it was not timed).
- *What breaks if the format changes?* A renamed or missing field now stops the run with a message naming the fields. Nothing silently changes. Mapping new names is a manual step today.
- *Director doesn't trust AI answers?* Every number links to the rows behind it; the Answers data tab shows the source rows, the Recommendation tab lists the checks, and View code shows the calculations, which contain no AI.
- *Run every Monday and post to Slack?* Clarify first (which channel, who owns the export, what triggers a run, what happens if the export is late). Changes: add a scheduler and a Slack send; stays the same: the analysis. Effort: summary text exists already; wiring and scheduling is roughly half a day plus access. Trade-offs: a posted summary is easy to skim but hides the drill-down, so include the link. Risks: late or reshaped exports, posting a wrong number with nobody checking (keep the checks result in the message).
- *Columns may change?* Validate the schema, fail loudly, show a mapping step; AI-assisted field mapping is an option but needs a human to confirm the mapping before numbers are trusted.

## Real examples of what AI got wrong or missed in this build
- The first version showed raw citation counts by topic; they were distorted by the same engine mix as the headline. Replaced with a like-for-like citation rate.
- Every prompt bar was hatched as "small sample", which made the flag meaningless; replaced with one banner.
- Average list position looked meaningful but was misleading: ACME's position only counts answers that name it, and it is named in a minority of answers. Replaced by a chart of how often each brand appears, with position shown beside it.
- The headline number could not be reproduced by hand; added hover calculations and a checks list.
(Say which of these you caught yourself and which came out of the practice run.)
