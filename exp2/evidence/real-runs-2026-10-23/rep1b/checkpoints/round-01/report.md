# Round 1 report

Official score: 126/219

| Stage | Calls | Tokens | Stand-in calls |
|---|---|---|---|
| understanding (attribution) | 2 | in 16565, cache read 13952, out 2667 | 0 |
| acceptance (checks) | 3 | in 37298, cache read 29696, out 16948 | 0 |
| coding | 1 | in 27345, cache read 361472, out 7887 | 0 |
| interrupted attempts: understanding | 0 | in 0, cache read 0, out 0 | 0 |
| interrupted attempts: acceptance | 0 | in 0, cache read 0, out 0 | 0 |
| interrupted attempts: coding | 0 | in 0, cache read 0, out 0 | 0 |

Scope: 16 objects. Zones: task 16, protection 0, status 0, source blocks 44, anchors 0.
Execution: done; 1 cycles (0 repairs), kept C1.1 with 0 failing; 0 contests; carried 0; sessions 1 (0 broken).
Wall time 545 s. attribution 34.5 s (1×, 0–35 s); checks 137.5 s (2×, 35–172 s); coding 124.0 s (1×, 172–296 s); build 4.7 s (1×, 296–301 s); trial 1.7 s (1×, 301–303 s); guard rerun 1.3 s (2×, 303–304 s); review 195.1 s (1×, 304–500 s); formalize 43.5 s (1×, 500–543 s); premise checks 0.0 s (1×, 543–543 s).
Determinations on the final program: 2 stated values (A), 0 by a reference (B), 0 by judgment (C), all A and B compared by code.
Open: program wrong 0, uncovered 0, reference disagreement pending 0, ambiguous 0; closed as uncheckable 0.
Review acceptance: first delivery C1.1 f0c69a2e (official 126/219); trial runs 1 (0 failed); reviews 1 (void sessions 0): #1 on C1.1: reported 14, blocked 0, malformed 14, sent 0, leads given 1.
Reviewer items: reported 14, entered a repair list 0; premise checks blocked 14 (malformed 14).
Guards: 0 at the start, 1 at the end, new 1 (G1); flips on changed text 0, on unchanged text 0; retired as superseded 0; repairs reverted 0.
Guard coverage: 0/131 live units; uncovered 131 (R1.S0.P1.s1, R1.S8.P2.s1, R1.S7.P1.s3, R1.S2.P1.s1, R1.S2.P2.s1, R1.S2.P2.s2, R1.S2.P3.s2, R1.S2.P3.s3, R1.S2.P3.s4, R1.S2.P4.s1, R1.S2.P4.s2, R1.S2.P5.s1, R1.S2.P6.s1, R1.S2.P6.s3, R1.S6.P2.s1, R1.S6.P2.s2, R1.S6.P2.s3, R1.S8.P1.s1, R1.S8.P1.s2, R1.S8.P1.s3, R1.S8.P1.s4, R1.S8.P1.s5, R1.S3.P1.s1, R1.S3.P2.s2, R1.S3.P2.s4 and 106 more; the full list is in report.json). Leads to the reviewer: library 1, judgment 0.
Reviewer (gpt-5.6-luna-fast): 1 sessions, in 62554, cache read 721920, out 6112, cache share 0.92. Formalizer (gpt-5.6-luna-fast): 2 calls, in 26769, cache read 4992, out 4621, cache share 0.157.
Ledger: open program wrong 0 (confirmed by a ruling 0), uncovered 0, reference pending 0; listed only 8 (blocked 8); ended this round 8 (blocked 8); sent 0 times; held 0.
Checks: 20 entered, 0 stale, 0 retired; 2 run, 1 passed, 1 failed.
Objects: 0 landed, 1 not landed, 15 unknown.

| Object | Status | Basis |
|---|---|---|
| O1 dpipe CLI | unknown | derived_disagreement, no_checks |
| O2 ingestion | unknown | derived_disagreement, no_checks |
| O3 transformation pipeline | unknown | derived_disagreement, no_checks |
| O4 expression evaluator | unknown | derived_disagreement, no_checks |
| O5 sampling and basic transforms | unknown | derived_disagreement, no_checks |
| O6 aggregate transform | unknown | derived_disagreement, no_checks |
| O7 join transform | unknown | derived_disagreement, not_run |
| O8 window transform | unknown | derived_disagreement, no_checks |
| O9 pivot transform | unknown | derived_disagreement, no_checks |
| O10 unpivot transform | unknown | derived_disagreement, no_checks |
| O11 fill transform | unknown | derived_disagreement, no_checks |
| O12 verification | unknown | derived_disagreement, no_checks |
| O13 manifest generation | unknown | derived_disagreement, no_checks |
| O14 pipeline command | unknown | derived_disagreement, no_checks |
| O15 determinism contract | unknown | derived_disagreement, no_checks |
| O16 error handling | not_landed | not landed K18 |

Loss attribution: no checkable expectation 15; IC's own 0 (); executor 1 (O16).
