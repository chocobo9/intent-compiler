# Round 2 report

Official score: 364/481; first delivery 275/481

§12i measures: wall 910 s; guards 20→42; regressions 0 (changed text 0, unchanged 0); reverted 0; fallback reviews 2 (items 2); no program run seen 0; tokens uncached/cache read/out: executor 86724/3606656/14093, attribution 23881/5120/1120, checks 90530/15744/18449, reviewer 175147/2348544/14071, formalizer 103140/27520/21493, interrupted_management 0/0/0; non-executor cost 687524 (uncached + 0.1 × cache read + out).

Interface counts:

- Reviewer items: reported 24, entered a repair list 24 (verified 21, logged 1, fallback 2), blocked 0; every entry ended once: yes; no_input 1; reviews 3 (void sessions 0); blocked by none.
- Check writing: admitted 13/13, unknown never told the model 0; dropped after the repairs 2 (methods_disagree 2); runs refused as an unknown subcommand 0; units no check rests on 180 (reported only).
- Guards: 20 at the start, 42 at the end, new 22; flips on changed text 0, on unchanged text 0; retired as superseded 0; repairs reverted 0.
- Requirements given: work order source zone delta, 39147 characters in 41 paragraphs of 19 objects (this round 31 (29892 characters), revised 0 (0 characters), edge 0 (0 characters), open item 10 (7518 characters)), 1 object heads; this round's edges to a block 0, to an object 3; 0 comparisons (guards on revised units) (every round's text: 48668 in 99 blocks); review requests 133567 characters in 3 sessions.
- Package use (review items sent to a repair list): objects 13/19 (68%), paragraphs 20/41 (49%); cited objects in the package 13/13.
- Revision recall (gold set deterministic-data-pipeline-go): 0/0 of the gold set's located entries recorded (0 in the gold set, 0 not located in the text); precision 0/0 of the round's modifications on a gold sentence.
- Relation recall (gold set deterministic-data-pipeline-go): 4/5 of the gold set's located entries recorded (by an edge 1, by the same object 3) (5 in the gold set, 0 not located in the text); by gold kind same_rules 1/2, extends 3/3; missed R2.S15.P3.s2 → R1.S3.P9.s5.

Everything else is in report.json.
