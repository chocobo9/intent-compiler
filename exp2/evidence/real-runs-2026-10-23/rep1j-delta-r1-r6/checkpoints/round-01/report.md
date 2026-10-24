# Round 1 report

Official score: 177/219; first delivery 108/219

§12i measures: wall 732 s; guards 0→8; regressions 0 (changed text 0, unchanged 0); reverted 2; fallback reviews 0 (items 0); no program run seen 0; tokens uncached/cache read/out: executor 61458/1867136/15174, attribution 14199/0/518, checks 25822/28160/9355, reviewer 143446/1556096/13244, formalizer 55800/16512/13791, interrupted_management 0/0/0; non-executor cost 436252 (uncached + 0.1 × cache read + out).

Interface counts:

- Reviewer items: reported 21, entered a repair list 21 (verified 15, logged 6, fallback 0), blocked 0; every entry ended once: yes; no_input 0; reviews 3 (void sessions 0); blocked by none.
- Check writing: admitted 7/7, unknown never told the model 0; dropped after the repairs 1 (reference_value_missing 1); runs refused as an unknown subcommand 0; units no check rests on 114 (reported only).
- Guards: 0 at the start, 8 at the end, new 8; flips on changed text 0, on unchanged text 0; retired as superseded 0; repairs reverted 2.
- Flip classification (source: revision record / object change / relation edge / none): revision 0, object 0, edge 0, none 2; G3 C1.3 regression (none; expected derived/verbatim), G3 C1.4 regression (none; expected derived/verbatim).
- Requirements given: work order source zone delta, 22490 characters in 9 objects (9 this round, 0 by an edge, 0 by open items), 0 guards listed (every round's text: 19379 in 11 blocks); review requests 74956 characters in 3 sessions.
- Revision recall (gold set deterministic-data-pipeline-go): 0/0 of the gold set's located entries recorded (0 in the gold set, 0 not located in the text); precision 0/0 of the round's modifications on a gold sentence.
- Relation recall (gold set deterministic-data-pipeline-go): 0/0 of the gold set's located entries recorded (by an edge 0, by the same object 0) (0 in the gold set, 0 not located in the text); by gold kind .

Everything else is in report.json.
