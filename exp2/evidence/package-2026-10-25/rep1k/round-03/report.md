# Round 3 report

Official score: 534/535; first delivery 521/535

§12i measures: wall 844 s; guards 60→74; regressions 1 (changed text 1, unchanged 0); reverted 0; fallback reviews 0 (items 0); no program run seen 0; tokens uncached/cache read/out: executor 51779/1460608/8131, attribution 31750/71680/1767, checks 39337/72064/9265, reviewer 158146/2400256/9659, formalizer 47911/22016/5661, interrupted_management 0/0/0; non-executor cost 560098 (uncached + 0.1 × cache read + out).

Interface counts:

- Reviewer items: reported 8, entered a repair list 8 (verified 7, logged 1, fallback 0), blocked 0; every entry ended once: yes; no_input 0; reviews 3 (void sessions 0); blocked by none.
- Check writing: admitted 10/10, unknown never told the model 0; dropped after the repairs 0 (none); runs refused as an unknown subcommand 0; units no check rests on 65 (reported only).
- Guards: 60 at the start, 74 at the end, new 15; flips on changed text 1 (G40), on unchanged text 0; retired as superseded 1 (G40); repairs reverted 0.
- Flip classification (source: revision record / object change / relation edge / none): revision 1, object 1, edge 0, none 0; G40 C3.1 changed text (revision, object; expected derived).
- Requirements given: work order source zone delta, 24127 characters in 38 paragraphs of 13 objects (this round 18 (10713 characters), revised 3 (3549 characters), edge 0 (0 characters), open item 17 (7205 characters)), 0 object heads; this round's edges to a block 0, to an object 1; 1 comparisons (guards on revised units) (every round's text: 58206 in 89 blocks); review requests 82806 characters in 3 sessions.
- Package use (review items sent to a repair list): objects 4/13 (31%), paragraphs 9/38 (24%); cited objects in the package 4/4.
- Revision recall (gold set deterministic-data-pipeline-go): 3/4 of the gold set's located entries recorded (4 in the gold set, 0 not located in the text); precision 3/7 of the round's modifications on a gold sentence; missed R3.S2.P3 → R2.S13.P4.s4.c3.
- Relation recall (gold set deterministic-data-pipeline-go): 4/5 of the gold set's located entries recorded (by an edge 1, by the same object 3) (5 in the gold set, 0 not located in the text); by gold kind depends_on 0/1, extends 2/2, same_rules 2/2; missed R3.S3.P4.s2 → R2.S3.P5.s5.

Everything else is in report.json.
