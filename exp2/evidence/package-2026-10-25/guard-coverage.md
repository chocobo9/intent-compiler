# Guard coverage, rep1j vs rep1k (2026-10-25)

Same script for both runs (`guardCoverage` of guards.ts over the guards live at the end of R4; units = rule-bearing
units still in force; a unit counts when a live guard rests on it or finer). Source states: the runs' own
`state/exp2-state.json` under `D:\huawei\EvoCodeBench\harbor_runs\exp2-icacc-r6-luna56-low-{rep1j,rep1k}-20261025`.

| | rep1j (chain block, ab190b9) | rep1k (package batch, b4f079d) |
|---|---|---|
| R4 units covered by a live guard at the end of R4 | 3 / 47 (6%) | 16 / 49 (33%) |
| all live units covered at the end of R4 | 56 / 455 (12%) | 134 / 459 (29%) |
| guards at the end of R1–R6 | 8 / 31 / 46 / 54 / 60 / 72 | 34 / 60 / 74 / 85 / 86 / 98 |
| checks entered (all admitted) R1–R6 | 7 / 9 / 11 / 7 / 8 / 6 | 20 / 12 / 10 / 4 / 5 / 12 |
