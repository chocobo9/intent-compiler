# Round 1 report

Official score: 125/219; first delivery 103/219

§12i measures: wall 1161 s; guards 0→18; regressions 0 (changed text 0, unchanged 0); reverted 0; fallback reviews 1 (items 1); no program run seen 0; tokens uncached/cache read/out: executor 34141/603520/2817, attribution 17670/13952/3840, checks 32734/30720/14855, reviewer 144166/2297984/18957, formalizer 67382/16512/23953, interrupted_management 0/0/0; non-executor cost 559474 (uncached + 0.1 × cache read + out).

Interface counts:

- Reviewer items: reported 33, entered a repair list 23 (verified 19, logged 3, fallback 1), blocked 10; every entry ended once: yes; no_input 1; reviews 3 (void sessions 0); blocked by input_claim_false 9, not_reproduced 1.
- Check writing: admitted 21/21, unknown never told the model 0; dropped after the repairs 0 (none); runs refused as an unknown subcommand 0; units no check rests on 105 (reported only).
- Guards: 0 at the start, 18 at the end, new 18; flips on changed text 0, on unchanged text 0; retired as superseded 0; repairs reverted 0.
- Requirements given: work order source zone delta, 23794 characters in 23 objects (23 this round, 0 by an edge, 0 by open items), 0 guards listed (every round's text: 22594 in 63 blocks); review requests 79519 characters in 3 sessions.
- Revision recall (gold set deterministic-data-pipeline-go): 0/0 of the gold set's located entries recorded (0 in the gold set, 0 not located in the text); precision 0/0 of the round's modifications on a gold sentence.
- Relation recall (gold set deterministic-data-pipeline-go): 0/0 of the gold set's located entries recorded (by an edge 0, by the same object 0) (0 in the gold set, 0 not located in the text); by gold kind .

Everything else is in report.json.
