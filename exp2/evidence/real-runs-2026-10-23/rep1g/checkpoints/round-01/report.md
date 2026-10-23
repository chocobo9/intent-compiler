# Round 1 report

Official score: 187/219

| Stage | Calls | Tokens | Stand-in calls |
|---|---|---|---|
| understanding (attribution) | 1 | in 14199, cache read 0, out 1838 | 0 |
| acceptance (checks) | 3 | in 32595, cache read 29184, out 12675 | 0 |
| coding | 4 | in 62907, cache read 2174208, out 19096 | 0 |
| interrupted attempts: understanding | 0 | in 0, cache read 0, out 0 | 0 |
| interrupted attempts: acceptance | 0 | in 0, cache read 0, out 0 | 0 |
| interrupted attempts: coding | 0 | in 0, cache read 0, out 0 | 0 |

Scope: 14 objects. Zones: task 14, protection 0, status 0, source blocks 35, anchors 0.
Execution: cycles_spent; 4 cycles (3 repairs), kept C1.4 with 0 failing; 0 contests; carried 3; sessions 1 (0 broken).
Wall time 935 s. attribution 15.1 s (1×, 0–15 s); check writing 83.9 s (1×, 15–99 s); checks 0.0 s (1×, 15–15 s); coding 156.7 s (1×, 15–172 s); build 7.1 s (4×, 172–913 s); trial 8.3 s (4×, 176–916 s); waiting for checks 0.0 s (2×, 178–927 s); guard rerun 30.0 s (11×, 178–927 s); review 443.3 s (3×, 181–842 s); formalize 110.0 s (3×, 410–869 s); premise checks 19.1 s (3×, 443–874 s); repair 135.6 s (3×, 451–912 s).
Determinations on the final program: 2 stated values (A), 10 by a reference (B), 0 by judgment (C), all A and B compared by code.
Open: program wrong 4, uncovered 0, reference disagreement pending 0, ambiguous 0; closed as uncheckable 0.
Review acceptance: first delivery C1.1 7f3cf972 (official 56/219); trial runs 4 (0 failed); reviews 3 (void sessions 0): #1 on C1.1: reported 12, blocked 0, malformed 0, sent 12 (fallback 2: no_assertion 2), leads given 9, program runs seen 13; #2 on C1.2: reported 8, blocked 0, malformed 0, sent 8, logged 1, leads given 2, program runs seen 14; #3 on C1.3: reported 5, blocked 0, malformed 0, sent 5, leads given 1, program runs seen 7.
Reviewer items: reported 25, entered a repair list 25 (verified 22, logged 1, fallback 2), blocked 0; every entry ended once: yes; premise checks blocked 0 (none), logged and sent 1 (value_not_stated 1); fallback in 1 review(s), 2 item(s), whole reply 0 (no_assertion 2); reviews with no program run seen 0.
Guards: 0 at the start, 30 at the end, new 30 (G1, G2, G3, G4, G5, G6, G7, G8, G9, G10, G11, G12, G13, G14, G15, G16, G17, G18, G19, G20, G21, G22, G23, G24, G25, G26, G27, G28, G29, G30); flips on changed text 0, on unchanged text 0; retired as superseded 0; repairs reverted 0.
Guard coverage: 103/131 live units; uncovered 28 (R1.S0.P1.s1, R1.S2.P1.s1, R1.S2.P2.s1, R1.S2.P2.s2, R1.S2.P3.s2, R1.S2.P3.s3, R1.S2.P3.s4, R1.S2.P4.s1, R1.S2.P4.s2, R1.S2.P5.s1, R1.S2.P6.s1, R1.S2.P6.s3, R1.S3.P18.s1, R1.S3.P18.s2, R1.S3.P18.s3, R1.S3.P18.s4, R1.S3.P19.s2, R1.S3.P19.s3, R1.S3.P19.s4, R1.S3.P19.s6, R1.S3.P19.s7, R1.S3.P19.s8, R1.S5.P1.s1, R1.S5.P2.s1, R1.S5.P2.s2 and 3 more; the full list is in report.json). Leads to the reviewer: library 12, judgment 0.
Reviewer (gpt-5.6-luna-fast): 3 sessions, in 105886, cache read 1694592, out 12154, cache share 0.941. Formalizer (gpt-5.6-luna-fast): 4 calls, in 58498, cache read 16512, out 14792, cache share 0.22.
§12i measures: wall 935 s; guards 0→30; regressions 0 (changed text 0, unchanged 0); reverted 0; fallback reviews 1 (items 2); no program run seen 0; tokens uncached/cache read/out: executor 62907/2174208/19096, attribution 14199/0/1838, checks 32595/29184/12675, reviewer 105886/1694592/12154, formalizer 58498/16512/14792, probes 0/0/0, judge 0/0/0, interrupted_management 0/0/0; non-executor cost 426666 (uncached + 0.1 × cache read + out).
Ledger: open program wrong 4 (confirmed by a ruling 0), uncovered 0, reference pending 0; listed only 2 (unverified 2); ended this round 22 (fixed 19, unverified 2, ruled_program_right 1); sent 31 times; held 3.
Checks: 13 entered, 0 stale, 1 retired; 12 run, 11 passed, 1 failed.
Check writing: admitted 13/13, unknown 0 (never told the model 0); dropped after the repairs 1 (verbatim_mismatch 1); read the one way they could mean: unquoted expected string 3; runs refused as an unknown subcommand 0.
Objects: 10 landed, 1 not landed, 3 unknown.

| Object | Status | Basis |
|---|---|---|
| O1 dpipe CLI | unknown | only_weak |
| O2 ingestion | unknown | no_checks |
| O3 transformation | landed | strong pass K3 |
| O4 transformation operations | landed | strong pass K4 |
| O5 join operation | landed | strong pass K5 |
| O6 window operation | landed | strong pass K6 |
| O7 pivot operation | not_landed | not landed K7 |
| O8 unpivot operation | landed | strong pass K8 |
| O9 fill operation | landed | strong pass K9 |
| O10 verification | landed | strong pass K10 |
| O11 manifest generation | unknown | no_checks |
| O12 pipeline orchestration | landed | strong pass K11 |
| O13 determinism contract | landed | strong pass K12 |
| O14 error handling | landed | strong pass K13 |

Loss attribution: no checkable expectation 3; IC's own 0 (); executor 1 (O7).
