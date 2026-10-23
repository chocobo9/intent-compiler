# Control arm cost in the §12i formula (computed 2026-10-24 from OBSERVATIONS §17 tables)

Formula: uncached input + 0.1 × cache read + output, non-executor roles only. The control arm's only non-executor role
is the reviewer. Token cells in §17 are rounded to 0.01M, so each figure carries about ±0.1M.

| run | R5–R15 (the pre-registered window) | R1–R4 |
|---|---|---|
| L rep1 (exec low, reviewer medium) | 9.07 M | 2.17 M |
| L rep2 | 7.23 M | 2.10 M |
| M rep1 (exec medium) | 7.94 M | 2.19 M |
| M rep2 | 7.03 M | 1.94 M |

§12i compares IC (exec low) with L: use L rep1 and rep2, mean 8.15 M for R5–R15. Verdict: IC/control ≤ 0.5 (≤ 4.1 M) and
R15 ≥ 948/960 → win; ≥ 0.8 (≥ 6.5 M) or below the threshold → fail; between → unproven.

For scale: the all-scope ic15 run (fe6562d) spent, per round, R1 0.49 M, R2 0.60 M, R3 0.69 M non-executor (reviewer +
formalizer + checks + attribution; adjudication's 115k over three rounds not included) against the control's
0.5–0.6 M per round in R1–R4. The delta-scope run is expected to lower the reviewer's and formalizer's share.

`intent-exp2-measures --checkpoints <dir> --control-cost 8150000`
