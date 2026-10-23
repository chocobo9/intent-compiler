# Corpus scan of the 26 EvoCodeBench tasks (2026-10-23, no model calls)

Purpose: raw material for generalising beyond dpipe before changing mechanisms (expert-lens step 2). Source:
`D:/huawei/EvoCodeBench/docs/data/tasks/*.json` (rounds' markdown, 13 models' per-round per-case results).

Files: `scan.json` (per task: language, rounds, chars per round, revision / withdrawal / cross-reference cue
sentences per round, regression lower bound, first-violation round), `revision-samples.json` (up to 6 cue sentences
per round per task), `slice.json` + `slice-all.mjs` (IC's deterministic slicing run on every round).

## Findings

1. **The code-side backbone is task-generic (observed).** `splitRound` + `tilingProblems` on all 26 tasks × every
   round: 0 tiling problems, 0 errors; 1,056 sections, 5,342 paragraphs, 10,081 sentences, 22,074 clauses; tables and
   code blocks handled on every task that has them. Slicing and ids need no change for a task switch.
2. **Revision is common across the corpus, not a dpipe quirk (observed, cue-based).** 21 of 26 tasks have revision
   cue sentences in rounds ≥ 2; dpipe has 31 cue sentences over 9 rounds, eventq 54/12, gomlops 28/6, secaudit 6/5,
   service-mesh 8/6, lsm-kvstore 5/3. Withdrawals (no longer / removed / must not) appear in 18 tasks.
3. **The regex cues are candidates, not gold (observed).** Round-1 hits are mostly domain words (`rename`, `drop`,
   `replace each empty value`); rounds ≥ 2 hits are mostly genuine ("SCAN now uses an exclusive end key",
   "This replaces the previous single-probe logic", "Previously it was 2^(-age/60)", "now maps to [-1,1] instead of
   [0,1]"). A gold set needs one labelling pass (model at medium over rounds ≥ 2 candidates, spot-checked by hand);
   that gives a cross-task recall test for attribution's modification records (DESIGN §12j.7 item 12).
4. **Regression across rounds happens on every task (observed, lower bound).** `regress_lb_median` is a lower bound
   (cases failing in round r that did not fail in r−1, minus the number of cases new to r); it is > 0 for 15 tasks and
   reaches 24–54 on gomlops, multiservice-deploy, hermetic-build, minicc, flowr. First official violation is at round 1
   or 2 for every task. This is the phenomenon guards are for; it is not specific to dpipe.
5. **Task shapes differ in what matters for IC (observed).** Text per round: dpipe 1–25k chars; eventq 11–31k every
   round (245k total, 22 cases: too coarse to score); secaudit 15 rounds / 73k / 68 cases. Go CLI tasks with ≥ 100
   cases and best model < 100%: lsm-kvstore (487 cases, best 90%), service-mesh (147, 86%), buildctl (401, 99%),
   mlpipe-orchestrator (130, 98%), hermetic-build (153, 100%, 42 regressions median).

## What this does not show
Attribution recall and guard validity on other tasks need model runs (attribution only: one call per round, cheap).
Nothing here says which mechanism helps; it says the inputs those mechanisms act on exist on every task.
