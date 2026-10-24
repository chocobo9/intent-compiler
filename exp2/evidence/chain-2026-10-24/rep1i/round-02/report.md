# Round 2 report

Official score: 346/481; first delivery 346/481

§12i measures: wall 961 s; guards 18→37; regressions 0 (changed text 0, unchanged 0); reverted 3; fallback reviews 0 (items 0); no program run seen 1; tokens uncached/cache read/out: executor 93047/5606656/21950, attribution 29055/0/5129, checks 50243/58880/16140, reviewer 164700/2237056/12383, formalizer 110308/16512/23080, interrupted_management 0/0/0; non-executor cost 642283 (uncached + 0.1 × cache read + out).

Interface counts:

- Reviewer items: reported 31, entered a repair list 27 (verified 19, logged 8, fallback 0), blocked 4; every entry ended once: yes; no_input 0; reviews 3 (void sessions 0); blocked by input_claim_false 4.
- Check writing: admitted 15/15, unknown never told the model 0; dropped after the repairs 0 (none); runs refused as an unknown subcommand 0; units no check rests on 172 (reported only).
- Guards: 18 at the start, 37 at the end, new 19; flips on changed text 0, on unchanged text 0; retired as superseded 0; repairs reverted 3.
- Flip classification (source: revision record / object change / relation edge / none): revision 0, object 0, edge 0, none 3; G29 C2.2 regression (none; expected derived), G29 C2.3 regression (none; expected derived), G29 C2.4 regression (none; expected derived).
- Requirements given: work order source zone delta, 49053 characters in 24 objects (14 this round, 6 by an edge, 4 by open items), 10 guards listed (every round's text: 55128 in 203 blocks); review requests 159593 characters in 3 sessions.
- Revision recall (gold set deterministic-data-pipeline-go): 0/0 of the gold set's located entries recorded (0 in the gold set, 0 not located in the text); precision 0/2 of the round's modifications on a gold sentence.
- Relation recall (gold set deterministic-data-pipeline-go): 4/5 of the gold set's located entries recorded (by an edge 1, by the same object 3) (5 in the gold set, 0 not located in the text); by gold kind same_rules 1/2, extends 3/3; missed R2.S15.P3.s2 → R1.S3.P9.s5.

Everything else is in report.json.
