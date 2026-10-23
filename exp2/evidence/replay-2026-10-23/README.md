# Replay fixtures from the seven real R1 runs (2026-10-23)

Extracted from `origin/exp2-pure-ic` 2250130, `exp2/evidence/real-runs-2026-10-23/<run>/exp2-state.json`, for the batch C
tests (`test/exp2/batch-c.test.ts`). One file per run with what a replay needs and nothing else:

- `round1_text`: the R1 requirements as the run had them (`sources[0].text`);
- `attribution_replies`: the attribution model's replies in order (`calls[].response_text`), so the registry's objects are the run's;
- `check_replies`: the check-writing model's replies in order (`check_calls[].response_text`);
- `checks`: the library the run entered (its leads to the reviewer are among them);
- `first_cycle_runs`: the runs of the first cycle (which library checks failed, i.e. were given as leads);
- `review_calls`, `formalize_calls`: the reviewer's and the formalizer's replies, with their ids.

`sessions/`: the three reviewer sessions of rep1e as exported (copied unchanged from `rep1e/review-sessions/`).
rep1 has no review (void at the first review); rep1d's reviewer sessions were not exported.

rep1f and rep1g were added from `origin/exp2-pure-ic` be04db7 (the same fields; their reviewer sessions were not exported, and rep1f
has no review: void at the first review on a docker outage).

`baseline-fe6562d.json`: the interface counts of the seven runs replayed on the src of fe6562d (check writing: entered, admitted,
unknown, unknown never told, dropped, normalized; review round on a program that fails every call: reported, entered, verified,
fallback, blocked, inputs from materials, no_input, conservation errors). `test/exp2/replay-baseline.test.ts` holds later code to
the same or better counts; `IC_WRITE_REPLAY_BASELINE=1` rewrites the file.
