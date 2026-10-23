# Replay fixtures from the five real R1 runs (2026-10-23)

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
