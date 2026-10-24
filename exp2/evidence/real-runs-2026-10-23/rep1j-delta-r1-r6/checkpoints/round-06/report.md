# Round 6 report

Official score: 710/716; first delivery 699/716

§12i measures: wall 538 s; guards 62→72; regressions 1 (changed text 0, unchanged 1); reverted 0; fallback reviews 0 (items 0); no program run seen 0; tokens uncached/cache read/out: executor 60205/1401216/3926, attribution 35513/5120/491, checks 45197/86912/9734, reviewer 118543/1707264/7467, formalizer 52582/11008/3112, interrupted_management 0/0/0; non-executor cost 453669 (uncached + 0.1 × cache read + out).

Interface counts:

- Reviewer items: reported 3, entered a repair list 3 (verified 3, logged 0, fallback 0), blocked 0; every entry ended once: yes; no_input 0; reviews 2 (void sessions 0); blocked by none.
- Check writing: admitted 6/6, unknown never told the model 0; dropped after the repairs 1 (verbatim_mismatch 1); runs refused as an unknown subcommand 0; units no check rests on 20 (reported only).
- Guards: 62 at the start, 72 at the end, new 12; flips on changed text 0, on unchanged text 1 (G57); retired as superseded 0; repairs reverted 0.
- Flip classification (source: revision record / object change / relation edge / none): revision 0, object 0, edge 0, none 1; G57 C6.1 regression (none; expected derived).
- Requirements given: work order source zone delta, 55086 characters in 9 objects (4 this round, 4 by an edge, 1 by open items), 54 guards listed; over the limit of 9966 (87473): dropped O10, O12, the guards' outputs, still over (every round's text: 69686 in 92 blocks); review requests 119992 characters in 2 sessions.
- Revision recall (gold set deterministic-data-pipeline-go): 0/0 of the gold set's located entries recorded (0 in the gold set, 0 not located in the text); precision 0/0 of the round's modifications on a gold sentence.
- Relation recall (gold set deterministic-data-pipeline-go): 1/3 of the gold set's located entries recorded (by an edge 0, by the same object 1) (3 in the gold set, 0 not located in the text); by gold kind depends_on 0/1, same_rules 0/1, extends 1/1; missed R6.S2.P3.s7 → R2.S19.P1, R6.S7.P1.s4 → R2.S3.P6.s1.

Everything else is in report.json.
