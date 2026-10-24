# Round 2 report

Official score: 450/481; first delivery 312/481

§12i measures: wall 996 s; guards 21→50; regressions 0 (changed text 0, unchanged 0); reverted 0; fallback reviews 0 (items 0); no program run seen 0; tokens uncached/cache read/out: executor 89126/5654016/20446, attribution 28792/0/1223, checks 44484/56832/12148, reviewer 170953/2596096/14601, formalizer 61111/16512/17561, interrupted_management 0/0/0; non-executor cost 617817 (uncached + 0.1 × cache read + out).

Interface counts:

- Reviewer items: reported 34, entered a repair list 26 (verified 19, logged 7, fallback 0), blocked 8; every entry ended once: yes; no_input 0; reviews 3 (void sessions 0); blocked by input_claim_false 8.
- Check writing: admitted 17/17, unknown never told the model 0; dropped after the repairs 0 (none); runs refused as an unknown subcommand 0; units no check rests on 182 (reported only).
- Guards: 21 at the start, 50 at the end, new 29; flips on changed text 0, on unchanged text 0; retired as superseded 0; repairs reverted 0.
- Requirements given: work order source zone delta, 39021 characters in 46 paragraphs of 18 objects (this round 38 (29792 characters), revised 1 (441 characters), edge 0 (0 characters), open item 7 (6498 characters)), 0 object heads; this round's edges to a block 0, to an object 1; 1 comparisons (guards on revised units) (every round's text: 47615 in 79 blocks); review requests 130976 characters in 3 sessions.
- Package use (review items sent to a repair list): objects 9/18 (50%), paragraphs 16/46 (35%); cited objects in the package 9/9.
- Revision recall (gold set deterministic-data-pipeline-go): 0/0 of the gold set's located entries recorded (0 in the gold set, 0 not located in the text); precision 0/1 of the round's modifications on a gold sentence.
- Relation recall (gold set deterministic-data-pipeline-go): 3/5 of the gold set's located entries recorded (by an edge 0, by the same object 3) (5 in the gold set, 0 not located in the text); by gold kind same_rules 0/2, extends 3/3; missed R2.S15.P3.s2 → R1.S3.P9.s5, R2.S10.P3.s1 → R1.S3.P2.s5.

Everything else is in report.json.
