# Round 3 report

Official score: 507/535; first delivery 505/535

§12i measures: wall 1353 s; guards 63→83; regressions 2 (changed text 2, unchanged 0); reverted 1; fallback reviews 1 (items 1); no program run seen 0; tokens uncached/cache read/out: executor 83102/3733504/11795, attribution 37114/33920/2581, checks 38161/72320/7238, reviewer 190908/3725568/14713, formalizer 171224/22016/14413, interrupted_management 0/0/0; non-executor cost 861734 (uncached + 0.1 × cache read + out).

Interface counts:

- Reviewer items: reported 16, entered a repair list 14 (verified 12, logged 1, fallback 1), blocked 2; every entry ended once: yes; no_input 0; reviews 3 (void sessions 0); blocked by unit_not_in_force 1, not_reproduced 1.
- Check writing: admitted 8/8, unknown never told the model 0; dropped after the repairs 1 (verbatim_mismatch 1); runs refused as an unknown subcommand 0; units no check rests on 71 (reported only).
- Guards: 63 at the start, 83 at the end, new 22; flips on changed text 2 (G42, G51), on unchanged text 0; retired as superseded 2 (G42, G51); repairs reverted 1.
- Flip classification (source: revision record / object change / relation edge / none): revision 2, object 3, edge 0, none 1; G42 C3.1 changed text (revision, object; expected derived), G51 C3.1 changed text (revision, object; expected derived), G59 C3.2 changed text (object; expected derived/verbatim), G72 C3.2 regression (none; expected derived).
- Requirements given: work order source zone delta, 29516 characters in 73 blocks (every round's text: 64934 in 206); review requests 86692 characters in 3 sessions.
- Revisions recorded: 7 paragraphs of this round's text read like a revision, 2 of them are recorded as revising earlier text; 4 modifications this round; cue paragraphs with none: R3.S2.P3, R3.S3.P4, R3.S5.P1, R3.S9.P3, R3.S16.P1.

Everything else is in report.json.
