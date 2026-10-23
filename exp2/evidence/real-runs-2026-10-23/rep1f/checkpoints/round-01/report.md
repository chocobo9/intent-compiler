# Round 1 report

Official score: (scored locally; empty offline)

| Stage | Calls | Tokens | Stand-in calls |
|---|---|---|---|
| understanding (attribution) | 1 | in 14199, cache read 0, out 363 | 0 |
| acceptance (checks) | 3 | in 37528, cache read 28160, out 21798 | 0 |
| coding | 3 | in 29183, cache read 495488, out 8678 | 0 |
| interrupted attempts: understanding | 0 | in 0, cache read 0, out 0 | 0 |
| interrupted attempts: acceptance | 0 | in 0, cache read 0, out 0 | 0 |
| interrupted attempts: coding | 0 | in 0, cache read 0, out 0 | 0 |

Scope: 8 objects. Zones: task 8, protection 0, status 0, source blocks 8, anchors 0.
Execution: trial_spent; 3 cycles (0 repairs), kept none with 0 failing; 0 contests; carried 8; sessions 1 (0 broken).
Wall time 136 s. attribution 10.7 s (1×, 0–11 s); check writing 125.5 s (1×, 11–136 s); checks 0.0 s (1×, 11–11 s); coding 78.3 s (1×, 11–89 s); build 0.5 s (3×, 89–136 s); trial 0.4 s (3×, 89–136 s); trial fix 45.2 s (2×, 90–135 s); waiting for checks 0.3 s (1×, 136–136 s).
Determinations on the final program: 6 stated values (A), 0 by a reference (B), 0 by judgment (C), all A and B compared by code.
Open: program wrong 0, uncovered 0, reference disagreement pending 0, ambiguous 0; closed as uncheckable 0.
Review acceptance: first delivery none; trial runs 3 (3 failed); reviews 0 (void sessions 0): none.
Reviewer items: reported 0, entered a repair list 0 (verified 0, logged 0, fallback 0), blocked 0; every entry ended once: yes; premise checks blocked 0 (none), logged and sent 0 (none); fallback in 0 review(s), 0 item(s), whole reply 0 (none); reviews with no program run seen 0.
Guards: 0 at the start, 0 at the end, new 0; flips on changed text 0, on unchanged text 0; retired as superseded 0; repairs reverted 0.
Guard coverage: n/a. Leads to the reviewer: library 0, judgment 0.
Reviewer (?): 0 sessions, in 0, cache read 0, out 0, cache share n/a. Formalizer (?): 0 calls, in 0, cache read 0, out 0, cache share n/a.
§12i measures: wall 136 s; guards 0→0; regressions 0 (changed text 0, unchanged 0); reverted 0; fallback reviews 0 (items 0); no program run seen 0; tokens uncached/cache read/out: executor 29183/495488/8678, attribution 14199/0/363, checks 37528/28160/21798, reviewer 0/0/0, formalizer 0/0/0, probes 0/0/0, judge 0/0/0, interrupted_management 0/0/0; non-executor cost 76704 (uncached + 0.1 × cache read + out).
Ledger: open program wrong 0 (confirmed by a ruling 0), uncovered 0, reference pending 0; listed only 0; ended this round 0; sent 0 times; held 0.
Checks: 13 entered, 0 stale, 0 retired; 6 run, 0 passed, 6 failed.
Check writing: admitted 6/13, unknown 7 (never told the model 0); dropped after the repairs 3 (verbatim_mismatch 1, computed_by_hand 1, reference_output 1); read the one way they could mean: unquoted expected string 17; runs refused as an unknown subcommand 0.
Objects: 0 landed, 3 not landed, 5 unknown.

| Object | Status | Basis |
|---|---|---|
| O1 dpipe CLI | unknown | no_checks |
| O2 ingest command | unknown | no_checks |
| O3 transform command | not_landed | not landed K1 |
| O4 verify command | unknown | derived_disagreement, no_checks |
| O5 manifest command | unknown | no_checks |
| O6 pipeline command | not_landed | not landed K9 |
| O7 determinism contract | unknown | no_checks |
| O8 error handling and build requirements | not_landed | not landed K10, K11, K12, K13 |

Loss attribution: no checkable expectation 5; IC's own 0 (); executor 3 (O3, O6, O8).
