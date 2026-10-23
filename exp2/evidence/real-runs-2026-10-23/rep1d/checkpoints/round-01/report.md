# Round 1 report

Official score: 142/219

| Stage | Calls | Tokens | Stand-in calls |
|---|---|---|---|
| understanding (attribution) | 1 | in 14199, cache read 0, out 2482 | 0 |
| acceptance (checks) | 3 | in 38890, cache read 30208, out 17605 | 0 |
| coding | 2 | in 26099, cache read 262016, out 6405 | 0 |
| interrupted attempts: understanding | 0 | in 0, cache read 0, out 0 | 0 |
| interrupted attempts: acceptance | 0 | in 0, cache read 0, out 0 | 0 |
| interrupted attempts: coding | 0 | in 0, cache read 0, out 0 | 0 |

Scope: 21 objects. Zones: task 21, protection 0, status 1, source blocks 50, anchors 0.
Execution: done; 2 cycles (1 repairs), kept C1.2 with 0 failing; 0 contests; carried 0; sessions 1 (0 broken).
Wall time 1029 s. attribution 22.3 s (1×, 0–22 s); checks 149.9 s (2×, 22–172 s); coding 186.6 s (1×, 172–359 s); build 4.7 s (2×, 359–670 s); trial 2.6 s (2×, 363–671 s); guard rerun 10.6 s (5×, 365–677 s); review 527.9 s (2×, 370–969 s); formalize 78.2 s (2×, 605–1003 s); premise checks 1.0 s (2×, 650–1003 s); repair 17.9 s (1×, 651–668 s).
Determinations on the final program: 2 stated values (A), 18 by a reference (B), 0 by judgment (C), all A and B compared by code.
Open: program wrong 0, uncovered 0, reference disagreement pending 1, ambiguous 0; closed as uncheckable 0.
Review acceptance: first delivery C1.1 be30a825 (official 107/219); trial runs 2 (0 failed); reviews 2 (void sessions 0): #1 on C1.1: reported 10, blocked 9, malformed 0, sent 1, leads given 13; #2 on C1.2: reported 7, blocked 7, malformed 0, sent 0, leads given 0.
Reviewer items: reported 17, entered a repair list 1; premise checks blocked 16 (no_input 16).
Guards: 0 at the start, 9 at the end, new 9 (G1, G2, G3, G4, G5, G6, G7, G8, G9); flips on changed text 0, on unchanged text 0; retired as superseded 0; repairs reverted 0.
Guard coverage: 19/131 live units; uncovered 112 (R1.S0.P1.s1, R1.S2.P6.s1, R1.S2.P6.s3, R1.S6.P2.s1, R1.S6.P2.s2, R1.S6.P2.s3, R1.S2.P2.s1, R1.S2.P2.s2, R1.S2.P3.s2, R1.S2.P3.s3, R1.S2.P3.s4, R1.S2.P4.s1, R1.S2.P4.s2, R1.S3.P1.s1, R1.S3.P2.s2, R1.S3.P2.s4, R1.S3.P2.s5, R1.S3.P3.s2, R1.S3.P3.s3, R1.S3.P4.s1, R1.S3.P4.s2, R1.S3.P4.s3, R1.S3.P5.s2, R1.S3.P5.s4, R1.S3.P5.s5 and 87 more; the full list is in report.json). Leads to the reviewer: library 13, judgment 0.
Reviewer (gpt-5.6-luna-fast): 2 sessions, in 65667, cache read 1099264, out 9750, cache share 0.944. Formalizer (gpt-5.6-luna-fast): 4 calls, in 52361, cache read 9984, out 10161, cache share 0.16.
Ledger: open program wrong 0 (confirmed by a ruling 0), uncovered 0, reference pending 1; listed only 16 (blocked 16); ended this round 18 (blocked 16, fixed 1, ruled_program_right 1); sent 1 times; held 0.
Checks: 21 entered, 0 stale, 1 retired; 20 run, 8 passed, 12 failed.
Objects: 4 landed, 8 not landed, 10 unknown.

| Object | Status | Basis |
|---|---|---|
| O1 dpipe CLI | unknown | only_weak |
| O2 ingestion | unknown | only_weak |
| O3 schema validation | landed | strong pass K3 |
| O4 transformation | unknown | no_checks |
| O5 expression evaluator | landed | strong pass K4 |
| O6 sampling | unknown | no_checks |
| O7 sorting | landed | strong pass K6 |
| O8 rename operation | landed | strong pass K7 |
| O9 drop operation | unknown | no_checks |
| O10 aggregation | not_landed | not landed K8 |
| O11 join operation | not_landed | not landed K9, K19 |
| O12 window operation | not_landed | not landed K10 |
| O13 pivot operation | not_landed | not landed K11, K20 |
| O14 unpivot operation | not_landed | not landed K12, K21 |
| O15 fill operation | not_landed | not landed K13 |
| O16 verification | not_landed | not landed K14 |
| O17 manifest | unknown | no_checks |
| O18 pipeline | unknown | no_checks |
| O19 determinism contract | unknown | only_weak |
| O20 error handling | unknown | not_run |
| O21 build configuration | not_landed | not landed K17 |
| O22 transformation operations | unknown | no_checks |

Loss attribution: no checkable expectation 10; IC's own 0 (); executor 8 (O10, O11, O12, O13, O14, O15, O16, O21).
