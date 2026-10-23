# Round 1 report

Official score: 108/219

| Stage | Calls | Tokens | Stand-in calls |
|---|---|---|---|
| understanding (attribution) | 1 | in 14199, cache read 0, out 1922 | 0 |
| acceptance (checks) | 3 | in 52543, cache read 14848, out 20592 | 0 |
| coding | 4 | in 77753, cache read 1261440, out 13963 | 0 |
| interrupted attempts: understanding | 0 | in 0, cache read 0, out 0 | 0 |
| interrupted attempts: acceptance | 0 | in 0, cache read 0, out 0 | 0 |
| interrupted attempts: coding | 0 | in 0, cache read 0, out 0 | 0 |

Scope: 16 objects. Zones: task 16, protection 0, status 0, source blocks 48, anchors 0.
Execution: done; 4 cycles (3 repairs), kept C1.4 with 0 failing; 0 contests; carried 0; sessions 1 (0 broken).
Wall time 992 s. attribution 23.6 s (1×, 0–24 s); check writing 161.7 s (1×, 24–185 s); checks 0.0 s (1×, 24–24 s); coding 137.0 s (1×, 24–161 s); build 18.1 s (4×, 161–986 s); trial 8.8 s (4×, 172–988 s); waiting for checks 10.1 s (2×, 175–990 s); guard rerun 6.0 s (8×, 185–990 s); review 582.6 s (3×, 187–942 s); formalize 57.4 s (3×, 451–963 s); premise checks 0.0 s (3×, 469–963 s); repair 142.4 s (3×, 469–985 s).
Determinations on the final program: 3 stated values (A), 0 by a reference (B), 0 by judgment (C), all A and B compared by code.
Open: program wrong 0, uncovered 0, reference disagreement pending 0, ambiguous 0; closed as uncheckable 0.
Review acceptance: first delivery C1.1 bc871edb (official 108/219); trial runs 4 (0 failed); reviews 3 (void sessions 0): #1 on C1.1: reported 6, blocked 0, malformed 0, sent 1 (fallback 6, the whole reply: no_input 6), leads given 2, program runs seen 16; #2 on C1.2: reported 7, blocked 0, malformed 0, sent 1 (fallback 7, the whole reply: no_input 7), leads given 0, program runs seen 12; #3 on C1.3: reported 7, blocked 0, malformed 0, sent 1 (fallback 7, the whole reply: no_input 7), leads given 0, program runs seen 17.
Reviewer items: reported 20, entered a repair list 3; premise checks blocked 0 (none), logged and sent 0 (none); fallback in 3 review(s), 20 item(s), whole reply 3 (no_input 20); reviews with no program run seen 0.
Guards: 0 at the start, 1 at the end, new 1 (G1); flips on changed text 0, on unchanged text 0; retired as superseded 0; repairs reverted 0.
Guard coverage: 1/131 live units; uncovered 130 (R1.S0.P1.s1, R1.S2.P1.s1, R1.S2.P2.s1, R1.S2.P2.s2, R1.S2.P3.s2, R1.S2.P3.s3, R1.S2.P3.s4, R1.S2.P4.s1, R1.S2.P4.s2, R1.S2.P5.s1, R1.S2.P6.s1, R1.S2.P6.s3, R1.S6.P2.s1, R1.S6.P2.s2, R1.S6.P2.s3, R1.S3.P1.s1, R1.S3.P2.s2, R1.S3.P2.s4, R1.S3.P2.s5, R1.S3.P24.s1, R1.S3.P3.s2, R1.S3.P3.s3, R1.S3.P3.s4, R1.S3.P3.s5, R1.S3.P3.s6 and 105 more; the full list is in report.json). Leads to the reviewer: library 2, judgment 0.
Reviewer (gpt-5.6-luna-fast): 3 sessions, in 98278, cache read 1031168, out 11905, cache share 0.913. Formalizer (gpt-5.6-luna-fast): 3 calls, in 38387, cache read 5248, out 4970, cache share 0.12.
§12i measures: wall 992 s; guards 0→1; regressions 0 (changed text 0, unchanged 0); reverted 0; fallback reviews 3 (items 20); no program run seen 0; tokens uncached/cache read/out: executor 77753/1261440/13963, attribution 14199/0/1922, checks 52543/14848/20592, reviewer 98278/1031168/11905, formalizer 38387/5248/4970, probes 0/0/0, judge 0/0/0, interrupted_management 0/0/0; non-executor cost 347922 (uncached + 0.1 × cache read + out).
Ledger: open program wrong 0 (confirmed by a ruling 0), uncovered 0, reference pending 0; listed only 3 (unverified 3); ended this round 3 (unverified 3); sent 3 times; held 0.
Checks: 22 entered, 0 stale, 0 retired; 3 run, 1 passed, 2 failed.
Objects: 0 landed, 2 not landed, 14 unknown.

| Object | Status | Basis |
|---|---|---|
| O1 dpipe CLI | unknown | derived_disagreement, no_checks |
| O2 ingest operation | unknown | derived_disagreement, no_checks |
| O3 transform operation | unknown | derived_disagreement, no_checks |
| O4 expression evaluator | unknown | derived_disagreement, no_checks |
| O5 basic and aggregate transformations | unknown | derived_disagreement, no_checks |
| O6 join transformation | not_landed | not landed K14 |
| O7 window transformation | unknown | derived_disagreement, no_checks |
| O8 pivot transformation | unknown | derived_disagreement, no_checks |
| O9 unpivot transformation | unknown | derived_disagreement, no_checks |
| O10 fill transformation | unknown | derived_disagreement, no_checks |
| O11 verify operation | unknown | derived_disagreement, no_checks |
| O12 manifest operation | unknown | derived_disagreement, no_checks |
| O13 pipeline operation | not_landed | not landed K11 |
| O14 determinism contract | unknown | derived_disagreement, no_checks |
| O15 error handling | unknown |  |
| O16 build requirement | unknown | no_checks |

Loss attribution: no checkable expectation 14; IC's own 0 (); executor 2 (O6, O13).
