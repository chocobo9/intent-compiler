# Round 4 report

Official score: 638/639; first delivery 630/639

§12i measures: wall 698 s; guards 47→54; regressions 0 (changed text 0, unchanged 0); reverted 0; fallback reviews 1 (items 1); no program run seen 1; tokens uncached/cache read/out: executor 51327/1745408/6087, attribution 36048/0/377, checks 82129/36096/10610, reviewer 182027/2890496/8287, formalizer 112195/27520/6354, interrupted_management 0/0/0; non-executor cost 733438 (uncached + 0.1 × cache read + out).

Interface counts:

- Reviewer items: reported 6, entered a repair list 4 (verified 3, logged 0, fallback 1), blocked 2; every entry ended once: yes; no_input 0; reviews 3 (void sessions 0); blocked by input_claim_false 1, not_reproduced 1.
- Check writing: admitted 7/7, unknown never told the model 0; dropped after the repairs 0 (none); runs refused as an unknown subcommand 0; units no check rests on 44 (reported only).
- Guards: 47 at the start, 54 at the end, new 8; flips on changed text 0, on unchanged text 0; retired as superseded 0; repairs reverted 0.
- Requirements given: work order source zone delta, 45653 characters in 6 objects (3 this round, 3 by an edge, 0 by open items), 40 guards listed; over the limit of 14310 (73737): dropped O10, O12, the guards' outputs, still over (every round's text: 60544 in 69 blocks); review requests 147030 characters in 3 sessions.
- Revision recall (gold set deterministic-data-pipeline-go): 0/0 of the gold set's located entries recorded (0 in the gold set, 0 not located in the text); precision 0/0 of the round's modifications on a gold sentence.
- Relation recall (gold set deterministic-data-pipeline-go): 0/0 of the gold set's located entries recorded (by an edge 0, by the same object 0) (0 in the gold set, 0 not located in the text); by gold kind .

Everything else is in report.json.
