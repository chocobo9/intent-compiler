# Round 2 report

Official score: 474/481; first delivery 410/481

§12i measures: wall 936 s; guards 34→60; regressions 0 (changed text 0, unchanged 0); reverted 0; fallback reviews 0 (items 0); no program run seen 1; tokens uncached/cache read/out: executor 70817/3600256/16762, attribution 23704/5120/1304, checks 85143/15744/15029, reviewer 171728/2443008/11214, formalizer 81976/22016/15534, interrupted_management 0/0/0; non-executor cost 654221 (uncached + 0.1 × cache read + out).

Interface counts:

- Reviewer items: reported 19, entered a repair list 19 (verified 16, logged 3, fallback 0), blocked 0; every entry ended once: yes; no_input 0; reviews 3 (void sessions 0); blocked by none.
- Check writing: admitted 12/12, unknown never told the model 0; dropped after the repairs 1 (methods_disagree 1); runs refused as an unknown subcommand 0; units no check rests on 181 (reported only).
- Guards: 34 at the start, 60 at the end, new 26; flips on changed text 0, on unchanged text 0; retired as superseded 0; repairs reverted 0.
- Requirements given: work order source zone delta, 38779 characters in 27 paragraphs of 18 objects (this round 18 (29792 characters), revised 1 (656 characters), edge 0 (0 characters), open item 8 (5251 characters)), 1 object heads; this round's edges to a block 0, to an object 2; 2 comparisons (guards on revised units) (every round's text: 46984 in 63 blocks); review requests 125458 characters in 3 sessions.
- Package use (review items sent to a repair list): objects 7/18 (39%), paragraphs 9/27 (33%); cited objects in the package 7/7.
- Revision recall (gold set deterministic-data-pipeline-go): 0/0 of the gold set's located entries recorded (0 in the gold set, 0 not located in the text); precision 0/1 of the round's modifications on a gold sentence.
- Relation recall (gold set deterministic-data-pipeline-go): 4/5 of the gold set's located entries recorded (by an edge 1, by the same object 3) (5 in the gold set, 0 not located in the text); by gold kind same_rules 1/2, extends 3/3; missed R2.S15.P3.s2 → R1.S3.P9.s5.

Everything else is in report.json.
