# Round 6 report

Official score: 698/716; first delivery 696/716

§12i measures: wall 940 s; guards 91→98; regressions 2 (changed text 2, unchanged 0); reverted 0; fallback reviews 2 (items 3); no program run seen 0; tokens uncached/cache read/out: executor 49042/1310976/4585, attribution 37161/46080/756, checks 47629/86144/9719, reviewer 187756/4003456/12607, formalizer 52300/27520/3625, interrupted_management 0/0/0; non-executor cost 767873 (uncached + 0.1 × cache read + out).

Interface counts:

- Reviewer items: reported 7, entered a repair list 7 (verified 3, logged 1, fallback 3), blocked 0; every entry ended once: yes; no_input 0; reviews 3 (void sessions 0); blocked by none.
- Check writing: admitted 12/12, unknown never told the model 0; dropped after the repairs 1 (verbatim_mismatch 1); runs refused as an unknown subcommand 0; units no check rests on 20 (reported only).
- Guards: 91 at the start, 98 at the end, new 12; flips on changed text 2 (G87, G88), on unchanged text 0; retired as superseded 0; repairs reverted 0.
- Flip classification (source: revision record / object change / relation edge / none): revision 0, object 0, edge 2, none 0; G87 C6.1 changed text (edge; expected derived), G88 C6.1 changed text (edge; expected derived).
- Requirements given: work order source zone delta, 20694 characters in 26 paragraphs of 10 objects (this round 3 (4050 characters), revised 1 (1569 characters), edge 0 (0 characters), open item 22 (8127 characters)), 6 object heads; this round's edges to a block 0, to an object 11; 6 comparisons (guards on revised units) (every round's text: 73309 in 136 blocks); review requests 71927 characters in 3 sessions.
- Package use (review items sent to a repair list): objects 3/10 (30%), paragraphs 4/26 (15%); cited objects in the package 3/3.
- Revision recall (gold set deterministic-data-pipeline-go): 0/0 of the gold set's located entries recorded (0 in the gold set, 0 not located in the text); precision 0/1 of the round's modifications on a gold sentence.
- Relation recall (gold set deterministic-data-pipeline-go): 3/3 of the gold set's located entries recorded (by an edge 2, by the same object 1) (3 in the gold set, 0 not located in the text); by gold kind depends_on 1/1, same_rules 1/1, extends 1/1.

Everything else is in report.json.
