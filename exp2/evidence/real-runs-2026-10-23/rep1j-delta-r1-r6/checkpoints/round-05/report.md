# Round 5 report

Official score: 673/680; first delivery 673/680

§12i measures: wall 785 s; guards 55→60; regressions 1 (changed text 1, unchanged 0); reverted 3; fallback reviews 0 (items 0); no program run seen 0; tokens uncached/cache read/out: executor 55486/1885696/7028, attribution 35200/43520/1479, checks 45570/84096/10366, reviewer 212816/3772160/12901, formalizer 94805/22016/6750, interrupted_management 0/0/0; non-executor cost 812066 (uncached + 0.1 × cache read + out).

Interface counts:

- Reviewer items: reported 9, entered a repair list 6 (verified 3, logged 3, fallback 0), blocked 3; every entry ended once: yes; no_input 0; reviews 3 (void sessions 0); blocked by not_reproduced 3.
- Check writing: admitted 8/8, unknown never told the model 0; dropped after the repairs 1 (unknown_block 1); runs refused as an unknown subcommand 0; units no check rests on 31 (reported only).
- Guards: 55 at the start, 60 at the end, new 7; flips on changed text 1 (G1), on unchanged text 0; retired as superseded 1 (G1); repairs reverted 3.
- Flip classification (source: revision record / object change / relation edge / none): revision 1, object 1, edge 0, none 3; G1 C5.2 changed text (revision, object; expected verbatim), G57 C5.3 regression (none; expected derived), G57 C5.4 regression (none; expected derived), G57 C5.5 regression (none; expected derived).
- Requirements given: work order source zone delta, 50263 characters in 7 objects (6 this round, 0 by an edge, 1 by open items), 48 guards listed; over the limit of 12921 (80619): dropped O10, O12, the guards' outputs, still over (every round's text: 66308 in 88 blocks); review requests 159307 characters in 3 sessions.
- Revision recall (gold set deterministic-data-pipeline-go): 7/8 of the gold set's located entries recorded (8 in the gold set, 0 not located in the text); precision 8/9 of the round's modifications on a gold sentence; missed R5.S1.P2.s5 → R1.S3.P24.s1.c3.
- Relation recall (gold set deterministic-data-pipeline-go): 2/2 of the gold set's located entries recorded (by an edge 1, by the same object 1) (2 in the gold set, 0 not located in the text); by gold kind same_format 1/1, extends 1/1.

Everything else is in report.json.
