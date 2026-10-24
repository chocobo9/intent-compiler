# Round 5 report

Official score: 666/680; first delivery 666/680

§12i measures: wall 680 s; guards 86→86; regressions 5 (changed text 4, unchanged 1); reverted 0; fallback reviews 0 (items 0); no program run seen 0; tokens uncached/cache read/out: executor 56416/1909120/8519, attribution 41563/39040/2600, checks 48973/78336/8811, reviewer 117391/2315648/7668, formalizer 10153/5504/859, interrupted_management 0/0/0; non-executor cost 481871 (uncached + 0.1 × cache read + out).

Interface counts:

- Reviewer items: reported 1, entered a repair list 1 (verified 1, logged 0, fallback 0), blocked 0; every entry ended once: yes; no_input 0; reviews 2 (void sessions 0); blocked by none.
- Check writing: admitted 5/5, unknown never told the model 0; dropped after the repairs 3 (unknown_block 1, reference_value_missing 2); runs refused as an unknown subcommand 0; units no check rests on 37 (reported only).
- Guards: 86 at the start, 86 at the end, new 5; flips on changed text 4 (G2, G3, G4, G16), on unchanged text 1 (G5); retired as superseded 4 (G2, G3, G4, G16); repairs reverted 0.
- Flip classification (source: revision record / object change / relation edge / none): revision 2, object 4, edge 1, none 1; G2 C5.2 changed text (revision, object; expected derived), G3 C5.2 changed text (revision, object; expected verbatim), G4 C5.2 changed text (object, edge; expected verbatim), G5 C5.2 regression (none; expected derived), G16 C5.2 changed text (object; expected computed/derived).
- Requirements given: work order source zone delta, 19262 characters in 52 paragraphs of 10 objects (this round 27 (5178 characters), revised 4 (1957 characters), edge 0 (0 characters), open item 21 (8331 characters)), 0 object heads; this round's edges to a block 0, to an object 1; 3 comparisons (guards on revised units) (every round's text: 69865 in 132 blocks); review requests 50319 characters in 2 sessions.
- Package use (review items sent to a repair list): objects 1/10 (10%), paragraphs 4/52 (8%); cited objects in the package 1/1.
- Revision recall (gold set deterministic-data-pipeline-go): 4/8 of the gold set's located entries recorded (8 in the gold set, 0 not located in the text); precision 4/5 of the round's modifications on a gold sentence; missed R5.S1.P2.s5 → R1.S3.P24.s1.c3, R5.S1.P3.s2 → R1.S5.P2.s3, R5.S1.P3.s4 → R1.S2.P6.s3, R5.S1.P3.s5 → R1.S3.P24.s1.c3.
- Relation recall (gold set deterministic-data-pipeline-go): 2/2 of the gold set's located entries recorded (by an edge 1, by the same object 1) (2 in the gold set, 0 not located in the text); by gold kind same_format 1/1, extends 1/1.

Everything else is in report.json.
