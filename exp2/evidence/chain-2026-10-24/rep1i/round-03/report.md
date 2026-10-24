# Round 3 report

Official score: 485/535; first delivery 438/535

§12i measures: wall 1026 s; guards 37→85; regressions 2 (changed text 1, unchanged 1); reverted 0; fallback reviews 0 (items 0); no program run seen 1; tokens uncached/cache read/out: executor 79481/3508992/12477, attribution 29351/5120/766, checks 98463/15744/11233, reviewer 234474/4791040/16640, formalizer 114526/16512/15580, interrupted_management 0/0/0; non-executor cost 1003875 (uncached + 0.1 × cache read + out).

Interface counts:

- Reviewer items: reported 23, entered a repair list 20 (verified 14, logged 6, fallback 0), blocked 3; every entry ended once: yes; no_input 0; reviews 3 (void sessions 0); blocked by input_claim_false 3.
- Check writing: admitted 10/10, unknown never told the model 0; dropped after the repairs 0 (none); runs refused as an unknown subcommand 0; units no check rests on 65 (reported only).
- Guards: 37 at the start, 85 at the end, new 49; flips on changed text 1 (G22), on unchanged text 1 (G29); retired as superseded 1 (G22); repairs reverted 0.
- Flip classification (source: revision record / object change / relation edge / none): revision 1, object 1, edge 0, none 1; G22 C3.1 changed text (revision, object; expected derived), G29 C3.1 regression (none; expected derived).
- Requirements given: work order source zone delta, 55616 characters in 22 objects (8 this round, 4 by an edge, 10 by open items), 19 guards listed; over the limit of 28308 (62005): dropped no object, the guards' outputs, still over (every round's text: 65484 in 222 blocks); review requests 182915 characters in 3 sessions.
- Revision recall (gold set deterministic-data-pipeline-go): 2/4 of the gold set's located entries recorded (4 in the gold set, 0 not located in the text); precision 1/3 of the round's modifications on a gold sentence; missed R3.S2.P3 → R2.S13.P4.s4.c3, R3.S3.P1 → R2.S11.P5.s3.
- Relation recall (gold set deterministic-data-pipeline-go): 5/5 of the gold set's located entries recorded (by an edge 2, by the same object 3) (5 in the gold set, 0 not located in the text); by gold kind depends_on 1/1, extends 2/2, same_rules 2/2.

Everything else is in report.json.
