# Round 3 report

Official score: 534/535; first delivery 534/535

§12i measures: wall 1274 s; guards 32→46; regressions 0 (changed text 0, unchanged 0); reverted 0; fallback reviews 0 (items 0); no program run seen 0; tokens uncached/cache read/out: executor 130762/2023040/7243, attribution 27985/5120/767, checks 39549/71808/9875, reviewer 202299/3326720/12823, formalizer 82117/11008/2280, interrupted_management 0/0/0; non-executor cost 719161 (uncached + 0.1 × cache read + out).

Interface counts:

- Reviewer items: reported 4, entered a repair list 4 (verified 2, logged 2, fallback 0), blocked 0; every entry ended once: yes; no_input 0; reviews 3 (void sessions 0); blocked by none.
- Check writing: admitted 11/11, unknown never told the model 0; dropped after the repairs 0 (none); runs refused as an unknown subcommand 0; units no check rests on 66 (reported only).
- Guards: 32 at the start, 46 at the end, new 15; flips on changed text 0, on unchanged text 0; retired as superseded 0; repairs reverted 0.
- Requirements given: work order source zone delta, 54789 characters in 8 objects (5 this round, 3 by an edge, 0 by open items), 30 guards listed; over the limit of 28308 (65121): dropped no object, the guards' outputs, still over (every round's text: 55707 in 64 blocks); review requests 172470 characters in 3 sessions.
- Revision recall (gold set deterministic-data-pipeline-go): 2/4 of the gold set's located entries recorded (4 in the gold set, 0 not located in the text); precision 1/2 of the round's modifications on a gold sentence; missed R3.S2.P3 → R2.S13.P4.s4.c3, R3.S3.P1 → R2.S11.P5.s3.
- Relation recall (gold set deterministic-data-pipeline-go): 5/5 of the gold set's located entries recorded (by an edge 2, by the same object 3) (5 in the gold set, 0 not located in the text); by gold kind depends_on 1/1, extends 2/2, same_rules 2/2.

Everything else is in report.json.
