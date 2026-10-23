# Round 1 report

Official score: 149/219

| Stage | Calls | Tokens | Stand-in calls |
|---|---|---|---|
| understanding (attribution) | 2 | in 18803, cache read 13952, out 5000 | 0 |
| acceptance (checks) | 3 | in 51194, cache read 30976, out 26083 | 0 |
| coding | 4 | in 93386, cache read 1357952, out 5334 | 0 |
| interrupted attempts: understanding | 0 | in 0, cache read 0, out 0 | 0 |
| interrupted attempts: acceptance | 0 | in 0, cache read 0, out 0 | 0 |
| interrupted attempts: coding | 0 | in 0, cache read 0, out 0 | 0 |

Scope: 39 objects. Zones: task 39, protection 0, status 0, source blocks 48, anchors 0.
Execution: cycles_spent; 4 cycles (3 repairs), kept C1.4 with 0 failing; 0 contests; carried 18; sessions 1 (0 broken).
Wall time 1164 s. attribution 30.7 s (1×, 0–31 s); check writing 172.2 s (1×, 31–203 s); checks 0.0 s (1×, 31–31 s); coding 295.5 s (1×, 31–326 s); build 7.1 s (4×, 326–1082 s); trial 8.6 s (4×, 330–1085 s); waiting for checks 0.0 s (2×, 332–1105 s); guard rerun 57.4 s (11×, 332–1105 s); review 326.4 s (3×, 341–966 s); formalize 131.2 s (3×, 483–1008 s); premise checks 26.1 s (3×, 543–1018 s); repair 219.6 s (3×, 554–1081 s).
Determinations on the final program: 5 stated values (A), 32 by a reference (B), 0 by judgment (C), all A and B compared by code.
Open: program wrong 25, uncovered 0, reference disagreement pending 8, ambiguous 0; closed as uncheckable 0.
Review acceptance: first delivery C1.1 ddb3d0c1 (official 112/219); trial runs 4 (0 failed); reviews 3 (void sessions 0): #1 on C1.1: reported 17, blocked 1, malformed 0, sent 16, logged 7, leads given 26, program runs seen 18; #2 on C1.2: reported 7, blocked 1, malformed 0, sent 6, logged 1, leads given 4, program runs seen 20; #3 on C1.3: reported 12, blocked 0, malformed 0, sent 12 (fallback 1: no_input 1), logged 2, leads given 3, program runs seen 5.
Reviewer items: reported 36, entered a repair list 34 (verified 23, logged 10, fallback 1), blocked 2; every entry ended once: yes; premise checks blocked 2 (not_reproduced 1, input_claim_false 1), logged and sent 11 (value_not_stated 7, reference_failed 2, value_not_computed 2); fallback in 1 review(s), 1 item(s), whole reply 0 (no_input 1); reviews with no program run seen 0.
Guards: 0 at the start, 28 at the end, new 28 (G1, G2, G3, G4, G5, G6, G7, G8, G9, G10, G11, G12, G13, G14, G15, G16, G17, G18, G19, G20, G21, G22, G23, G24, G25, G26, G27, G28); flips on changed text 0, on unchanged text 0; retired as superseded 0; repairs reverted 0.
Guard coverage: 58/131 live units; uncovered 73 (R1.S0.P1.s1, R1.S2.P4.s1, R1.S2.P4.s2, R1.S3.P7.s1, R1.S3.P9.s3, R1.S3.P9.s4, R1.S3.P9.s5, R1.S3.P9.s6, R1.S3.P9.s7, R1.S3.P9.s8, R1.S3.P9.s9, R1.S3.P9.s10, R1.S3.P11.s1, R1.S3.P11.s3, R1.S3.P11.s4, R1.S3.P11.s5, R1.S3.P11.s8, R1.S3.P12.s1, R1.S3.P12.s2, R1.S3.P12.s3, R1.S3.P12.s4, R1.S3.P12.s5, R1.S3.P12.s6, R1.S3.P12.s10, R1.S3.P13.s1 and 48 more; the full list is in report.json). Leads to the reviewer: library 33, judgment 0.
Reviewer (gpt-5.6-luna-fast): 3 sessions, in 123720, cache read 1494784, out 12738, cache share 0.924. Formalizer (gpt-5.6-luna-fast): 4 calls, in 76098, cache read 5504, out 22619, cache share 0.067.
§12i measures: wall 1164 s; guards 0→28; regressions 0 (changed text 0, unchanged 0); reverted 0; fallback reviews 1 (items 1); no program run seen 0; tokens uncached/cache read/out: executor 93386/1357952/5334, attribution 18803/13952/5000, checks 51194/30976/26083, reviewer 123720/1494784/12738, formalizer 76098/5504/22619, probes 0/0/0, judge 0/0/0, interrupted_management 0/0/0; non-executor cost 490777 (uncached + 0.1 × cache read + out).
Ledger: open program wrong 25 (confirmed by a ruling 0), uncovered 0, reference pending 8; listed only 4 (unverified 2, blocked 2); ended this round 15 (unverified 2, fixed 7, blocked 2, ruled_program_right 4); sent 46 times; held 19.
Checks: 41 entered, 0 stale, 4 retired; 37 run, 21 passed, 16 failed.
Check writing: admitted 41/41, unknown 0 (never told the model 0); dropped after the repairs 2 (verbatim_mismatch 1, reference_value_missing 1); read the one way they could mean: doubled escapes 1; runs refused as an unknown subcommand 0.
Objects: 13 landed, 15 not landed, 11 unknown.

| Object | Status | Basis |
|---|---|---|
| O1 dpipe CLI and deterministic data pipeline | not_landed | not landed K1 |
| O2 ingest command | unknown | only_weak |
| O3 schema validation | landed | strong pass K3 |
| O4 schema column constraints | landed | strong pass K4 |
| O5 ingest validation ordering | unknown | no_checks |
| O6 ingest primary key | unknown | only_weak |
| O7 ingest output and checksum | landed | strong pass K7 |
| O8 transform command | unknown | only_weak |
| O9 transformation recipe execution | landed | strong pass K9 |
| O10 expression operator precedence | landed | strong pass K10 |
| O11 expression NaN arithmetic | landed | strong pass K11 |
| O12 expression functions | landed | strong pass K12 |
| O13 expression evaluator | not_landed | not landed K13 |
| O14 derive formatting | landed | strong pass K14 |
| O15 sample and basic transformation operations | not_landed | not landed K15 |
| O16 aggregate output ordering and formatting | landed | strong pass K16 |
| O17 aggregate having clause | not_landed | not landed K17 |
| O18 join transformation | not_landed | not landed K18 |
| O19 window transformation | unknown | no_checks |
| O20 window functions | unknown | no_checks |
| O21 window output shape | landed | strong pass K21 |
| O22 window result formatting | not_landed | not landed K22 |
| O23 window column validation | not_landed | not landed K23 |
| O24 pivot transformation | not_landed | not landed K24 |
| O25 pivot behavior | not_landed | not landed K25 |
| O26 unpivot transformation | not_landed | not landed K26 |
| O27 unpivot behavior | landed | strong pass K27 |
| O28 fill transformation | not_landed | not landed K28 |
| O29 fill behavior | not_landed | not landed K29 |
| O30 transform output and checksum | unknown | only_weak |
| O31 verify command | not_landed | not landed K31 |
| O32 checksum verification | landed | strong pass K32 |
| O33 manifest command | unknown | only_weak |
| O34 manifest generation | unknown | reading; suspect K34 |
| O35 pipeline command | not_landed | not landed K35 |
| O36 pipeline execution | unknown | no_checks |
| O37 determinism contract | unknown | only_weak |
| O38 error handling | landed | strong pass K39, K40 |
| O39 dpipe buildability | not_landed | not landed K38 |

Loss attribution: no checkable expectation 11; IC's own 0 (); executor 15 (O1, O13, O15, O17, O18, O22, O23, O24, O25, O26, O28, O29, O31, O35, O39).
