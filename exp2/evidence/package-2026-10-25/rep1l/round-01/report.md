# Round 1 report

Official score: 190/219; first delivery 140/219

§12i measures: wall 930 s; guards 0→20; regressions 0 (changed text 0, unchanged 0); reverted 0; fallback reviews 1 (items 2); no program run seen 0; tokens uncached/cache read/out: executor 49558/1524992/16776, attribution 14199/0/2787, checks 48345/15232/17148, reviewer 123071/2366976/16304, formalizer 57352/16512/11376, interrupted_management 0/0/0; non-executor cost 530454 (uncached + 0.1 × cache read + out).

Interface counts:

- Reviewer items: reported 19, entered a repair list 17 (verified 14, logged 1, fallback 2), blocked 2; every entry ended once: yes; no_input 0; reviews 3 (void sessions 0); blocked by input_claim_false 2.
- Check writing: admitted 23/23, unknown never told the model 0; dropped after the repairs 1 (reference_value_missing 1); runs refused as an unknown subcommand 0; units no check rests on 103 (reported only).
- Guards: 0 at the start, 20 at the end, new 20; flips on changed text 0, on unchanged text 0; retired as superseded 0; repairs reverted 0.
- Requirements given: work order source zone delta, 23350 characters in 40 paragraphs of 16 objects (this round 40 (21793 characters), revised 0 (0 characters), edge 0 (0 characters), open item 0 (0 characters)), 4 object heads; this round's edges to a block 0, to an object 16; 0 comparisons (guards on revised units) (every round's text: 22645 in 65 blocks); review requests 79546 characters in 3 sessions.
- Package use (review items sent to a repair list): objects 8/16 (50%), paragraphs 18/40 (45%); cited objects in the package 8/8.
- Revision recall (gold set deterministic-data-pipeline-go): 0/0 of the gold set's located entries recorded (0 in the gold set, 0 not located in the text); precision 0/0 of the round's modifications on a gold sentence.
- Relation recall (gold set deterministic-data-pipeline-go): 0/0 of the gold set's located entries recorded (by an edge 0, by the same object 0) (0 in the gold set, 0 not located in the text); by gold kind .

Everything else is in report.json.
