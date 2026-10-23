# Round 1 report

Official score: 39/219

| Stage | Calls | Tokens | Stand-in calls |
|---|---|---|---|
| understanding (attribution) | 3 | in 26026, cache read 27904, out 5436 | 0 |
| acceptance (checks) | 3 | in 61922, cache read 10496, out 21512 | 0 |
| coding | 1 | in 25196, cache read 297216, out 1565 | 0 |
| interrupted attempts: understanding | 0 | in 0, cache read 0, out 0 | 0 |
| interrupted attempts: acceptance | 0 | in 0, cache read 0, out 0 | 0 |
| interrupted attempts: coding | 0 | in 0, cache read 0, out 0 | 0 |

Scope: 16 objects. Zones: task 16, protection 0, status 0, source blocks 47, anchors 0.
Execution: done; 1 cycles (0 repairs), kept C1.1 with 0 failing; 0 contests; carried 0; sessions 1 (0 broken).
Wall time 882 s. attribution 45.1 s (1×, 0–45 s); checks 151.4 s (2×, 45–197 s); coding 384.2 s (1×, 197–581 s); build 5.1 s (1×, 581–586 s); trial 2.1 s (1×, 586–589 s); guard rerun 6.7 s (2×, 589–596 s); review 238.7 s (2×, 596–835 s).
Determinations on the final program: 6 stated values (A), 14 by a reference (B), 0 by judgment (C), all A and B compared by code.
Open: program wrong 0, uncovered 0, reference disagreement pending 7, ambiguous 0; closed as uncheckable 0.
Review acceptance: first delivery C1.1 3efd72ca (official 39/219); trial runs 1 (0 failed); reviews 1 (void sessions 2): #1 on C1.1 void: reported 0, blocked 0, malformed 0, sent 0, leads given 17.
Reviewer items: reported 0, entered a repair list 0; premise checks blocked 0 (none).
Guards: 0 at the start, 4 at the end, new 4 (G1, G2, G3, G4); flips on changed text 0, on unchanged text 0; retired as superseded 0; repairs reverted 0.
Guard coverage: 9/131 live units; uncovered 122 (R1.S0.P1.s1, R1.S2.P1.s1, R1.S2.P2.s1, R1.S2.P2.s2, R1.S2.P3.s2, R1.S2.P3.s3, R1.S2.P3.s4, R1.S2.P4.s1, R1.S2.P4.s2, R1.S2.P5.s1, R1.S2.P6.s1, R1.S2.P6.s3, R1.S6.P2.s1, R1.S6.P2.s2, R1.S6.P2.s3, R1.S3.P1.s1, R1.S3.P2.s2, R1.S3.P2.s4, R1.S3.P2.s5, R1.S3.P24.s1, R1.S3.P3.s2, R1.S3.P3.s3, R1.S3.P3.s4, R1.S3.P3.s5, R1.S3.P3.s6 and 97 more; the full list is in report.json). Leads to the reviewer: library 17, judgment 0.
Reviewer (gpt-5.6-luna-fast): 2 sessions, in 58476, cache read 714880, out 10831, cache share 0.924. Formalizer (?): 0 calls, in 0, cache read 0, out 0, cache share n/a.
Ledger: open program wrong 0 (confirmed by a ruling 0), uncovered 0, reference pending 7; listed only 0; ended this round 1 (ruled_program_right 1); sent 0 times; held 0.
Checks: 21 entered, 0 stale, 1 retired; 20 run, 4 passed, 16 failed.
Objects: 1 landed, 10 not landed, 5 unknown.

| Object | Status | Basis |
|---|---|---|
| O1 dpipe CLI | unknown | only_weak |
| O2 ingest command | not_landed | not landed K2 |
| O3 transform command | not_landed | not landed K3, K18 |
| O4 expression evaluator | unknown | no_checks |
| O5 transform operations | not_landed | not landed K5, K19 |
| O6 aggregate operation | not_landed | not landed K6 |
| O7 join operation | not_landed | not landed K7 |
| O8 window operation | not_landed | not landed K8 |
| O9 pivot operation | not_landed | not landed K9, K20 |
| O10 unpivot operation | not_landed | not landed K10 |
| O11 fill operation | not_landed | not landed K11 |
| O12 verify command | landed | strong pass K12 |
| O13 manifest command | not_landed | not landed K13 |
| O14 pipeline command | unknown | no_checks |
| O15 determinism contract | unknown | no_checks |
| O16 error handling | unknown | not_run |

Loss attribution: no checkable expectation 5; IC's own 0 (); executor 10 (O2, O3, O5, O6, O7, O8, O9, O10, O11, O13).
