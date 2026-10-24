# Round 2 report

Official score: 480/481; first delivery 395/481

§12i measures: wall 908 s; guards 8→31; regressions 1 (changed text 1, unchanged 0); reverted 0; fallback reviews 0 (items 0); no program run seen 0; tokens uncached/cache read/out: executor 89327/4823424/18029, attribution 24951/33280/1292, checks 39460/56064/9621, reviewer 247696/3197568/12726, formalizer 70993/44928/9901, interrupted_management 0/0/0; non-executor cost 749824 (uncached + 0.1 × cache read + out).

Interface counts:

- Reviewer items: reported 17, entered a repair list 16 (verified 15, logged 1, fallback 0), blocked 1; every entry ended once: yes; no_input 0; reviews 3 (void sessions 0); blocked by input_claim_false 1.
- Check writing: admitted 9/9, unknown never told the model 0; dropped after the repairs 0 (none); runs refused as an unknown subcommand 0; units no check rests on 201 (reported only).
- Guards: 8 at the start, 31 at the end, new 24; flips on changed text 1 (G3), on unchanged text 0; retired as superseded 1 (G3); repairs reverted 0.
- Flip classification (source: revision record / object change / relation edge / none): revision 0, object 1, edge 1, none 0; G3 C2.1 changed text (object, edge; expected derived/verbatim).
- Requirements given: work order source zone delta, 48781 characters in 8 objects (5 this round, 3 by an edge, 0 by open items), 8 guards listed (every round's text: 45460 in 45 blocks); review requests 163604 characters in 3 sessions.
- Revision recall (gold set deterministic-data-pipeline-go): 0/0 of the gold set's located entries recorded (0 in the gold set, 0 not located in the text); precision 0/7 of the round's modifications on a gold sentence.
- Relation recall (gold set deterministic-data-pipeline-go): 5/5 of the gold set's located entries recorded (by an edge 0, by the same object 5) (5 in the gold set, 0 not located in the text); by gold kind same_rules 2/2, extends 3/3.

Everything else is in report.json.
