# Round 1 report

Official score: 206/219; first delivery 162/219

§12i measures: wall 1665 s; guards 0→21; regressions 0 (changed text 0, unchanged 0); reverted 0; fallback reviews 1 (items 1); no program run seen 0; tokens uncached/cache read/out: executor 49676/1584768/13766, attribution 14199/0/1674, checks 31007/29696/13790, reviewer 127823/2029056/14398, formalizer 103649/22016/19502, interrupted_management 0/0/0; non-executor cost 534119 (uncached + 0.1 × cache read + out).

Interface counts:

- Reviewer items: reported 18, entered a repair list 17 (verified 12, logged 4, fallback 1), blocked 1; every entry ended once: yes; no_input 0; reviews 3 (void sessions 0); blocked by input_claim_false 1.
- Check writing: admitted 16/16, unknown never told the model 0; dropped after the repairs 0 (none); runs refused as an unknown subcommand 0; units no check rests on 114 (reported only).
- Guards: 0 at the start, 21 at the end, new 21; flips on changed text 0, on unchanged text 0; retired as superseded 0; repairs reverted 0.
- Requirements given: work order source zone delta, 23193 characters in 40 paragraphs of 17 objects (this round 40 (21793 characters), revised 0 (0 characters), edge 0 (0 characters), open item 0 (0 characters)), 0 object heads; this round's edges to a block 0, to an object 8; 0 comparisons (guards on revised units) (every round's text: 21138 in 40 blocks); review requests 76066 characters in 3 sessions.
- Package use (review items sent to a repair list): objects 7/17 (41%), paragraphs 10/40 (25%); cited objects in the package 7/7.
- Revision recall (gold set deterministic-data-pipeline-go): 0/0 of the gold set's located entries recorded (0 in the gold set, 0 not located in the text); precision 0/0 of the round's modifications on a gold sentence.
- Relation recall (gold set deterministic-data-pipeline-go): 0/0 of the gold set's located entries recorded (by an edge 0, by the same object 0) (0 in the gold set, 0 not located in the text); by gold kind .

Everything else is in report.json.
