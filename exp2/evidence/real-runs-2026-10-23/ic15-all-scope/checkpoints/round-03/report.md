# Round 3 report

Official score: 389/535

| Stage | Calls | Tokens | Stand-in calls |
|---|---|---|---|
| understanding (attribution) | 1 | in 29173, cache read 5120, out 777 | 0 |
| acceptance (checks) | 3 | in 44959, cache read 73344, out 13278 | 0 |
| coding | 4 | in 92829, cache read 6330368, out 16292 | 0 |
| interrupted attempts: understanding | 0 | in 0, cache read 0, out 0 | 0 |
| interrupted attempts: acceptance | 0 | in 0, cache read 0, out 0 | 0 |
| interrupted attempts: coding | 0 | in 0, cache read 0, out 0 | 0 |

Scope: 8 objects. Zones: task 29, protection 0, status 15, source blocks 114, anchors 0.
Execution: done; 4 cycles (3 repairs), kept C3.1 with 2 failing; 0 contests; carried 10; sessions 1 (0 broken).
Wall time 1199 s. attribution 13.5 s (1×, 0–14 s); check writing 107.0 s (1×, 14–121 s); checks 21.0 s (1×, 14–35 s); carry-over 13.2 s (2×, 35–49 s); coding 174.5 s (1×, 49–223 s); build 5.2 s (4×, 223–1113 s); trial 15.0 s (4×, 224–1118 s); waiting for checks 0.0 s (2×, 228–1172 s); guard rerun 214.7 s (9×, 228–1172 s); review 332.0 s (3×, 288–947 s); formalize 126.4 s (3×, 418–1009 s); premise checks 15.9 s (3×, 451–1012 s); repair 236.3 s (3×, 456–1112 s); revert 0.3 s (3×, 578–1172 s).
Determinations on the final program: 15 stated values (A), 43 by a reference (B), 0 by judgment (C), all A and B compared by code.
Open: program wrong 15, uncovered 0, reference disagreement pending 8, ambiguous 0; closed as uncheckable 0.
Review acceptance: first delivery C3.1 62c0d5f3 (official 389/535); trial runs 4 (0 failed); reviews 3 (void sessions 0): #1 on C3.1: reported 7, blocked 0, malformed 0, sent 7, logged 3, leads given 9, program runs seen 22; #2 on C3.1: reported 10, blocked 1, malformed 0, sent 9, logged 3, leads given 0, program runs seen 17; #3 on C3.1: reported 15, blocked 1, malformed 0, sent 14 (fallback 10: no_input 10), logged 3, leads given 0, program runs seen 4.
Reviewer items: reported 32, entered a repair list 30 (verified 11, logged 9, fallback 10), blocked 2; every entry ended once: yes; premise checks blocked 2 (input_claim_false 1, unit_not_in_force 1), logged and sent 9 (value_not_stated 6, reference_failed 3); fallback in 1 review(s), 10 item(s), whole reply 0 (no_input 10); reviews with no program run seen 0.
Guards: 92 at the start, 103 at the end, new 11 (G93, G94, G95, G96, G97, G98, G99, G100, G101, G102, G103); flips on changed text 0, on unchanged text 2 (G84, G92); retired as superseded 0; repairs reverted 3.
Guard coverage: 249/413 live units; uncovered 164 (R1.S2.P4.s1, R1.S2.P4.s2, R1.S3.P7.s1, R1.S3.P13.s1, R1.S3.P13.s4, R1.S3.P14.s1, R1.S3.P14.s3, R1.S3.P14.s5, R1.S3.P14.s6, R1.S3.P14.s7, R1.S3.P14.s9, R1.S3.P22.s1, R1.S3.P22.s2, R1.S3.P23.s2, R1.S3.P23.s3, R1.S3.P23.s7, R1.S4.P1.s1, R1.S4.P2.s1, R1.S4.P2.s2, R1.S8.P1.s2, R1.S8.P2.s1, R2.S24.P1.s1, R2.S2.P1.s1, R2.S2.P2.s1, R2.S2.P2.s2 and 139 more; the full list is in report.json). Leads to the reviewer: library 9, judgment 0.
Reviewer (gpt-5.6-luna-fast): 3 sessions, in 166110, cache read 2669568, out 14218, cache share 0.941. Formalizer (gpt-5.6-luna-fast): 4 calls, in 125806, cache read 22016, out 20110, cache share 0.149.
§12i measures: wall 1199 s; guards 92→103; regressions 2 (changed text 0, unchanged 2); reverted 3; fallback reviews 1 (items 10); no program run seen 0; tokens uncached/cache read/out: executor 92829/6330368/16292, attribution 29173/5120/777, checks 44959/73344/13278, reviewer 166110/2669568/14218, formalizer 125806/22016/20110, probes 0/0/0, judge 0/0/0, interrupted_management 0/0/0; non-executor cost 691436 (uncached + 0.1 × cache read + out).
Ledger: open program wrong 15 (confirmed by a ruling 0), uncovered 0, reference pending 8; listed only 46 (unverified 6, blocked 5, discarded 35); ended this round 44 (fixed 7, discarded 35, blocked 2); sent 35 times; held 15.
Checks: 10 entered, 2 stale, 0 retired; 58 run, 49 passed, 9 failed.
Check writing: admitted 5/10, unknown 5 (never told the model 0); dropped after the repairs 4 (unknown_block 1, methods_disagree 3); read the one way they could mean: leading program name 7, unquoted expected string 12; runs refused as an unknown subcommand 0.
Objects: 20 landed, 7 not landed, 35 unknown.

| Object | Status | Basis |
|---|---|---|
| O1 dpipe CLI and deterministic data pipeline | unknown | only_weak |
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
| O15 sample and basic transformation operations | landed | strong pass K15 |
| O16 aggregate output ordering and formatting | landed | strong pass K16 |
| O17 aggregate having clause | landed | strong pass K17 |
| O18 join transformation | landed | strong pass K18 |
| O19 window transformation | unknown | no_checks |
| O20 window functions | unknown | no_checks |
| O21 window output shape | landed | strong pass K21 |
| O22 window result formatting | landed | strong pass K22 |
| O23 window column validation | unknown | only_weak |
| O24 pivot transformation | landed | strong pass K24 |
| O25 pivot behavior | landed | strong pass K25 |
| O26 unpivot transformation | landed | strong pass K26 |
| O27 unpivot behavior | landed | strong pass K27 |
| O28 fill transformation | not_landed | not landed K28 |
| O29 fill behavior | not_landed | not landed K29 |
| O30 transform output and checksum | unknown | only_weak |
| O31 verify command | not_landed | not landed K31 |
| O32 checksum verification | landed | strong pass K32 |
| O33 manifest command | unknown | only_weak |
| O34 manifest generation | unknown | reading; suspect K34 |
| O35 pipeline command | landed | strong pass K35 |
| O36 pipeline execution | unknown | no_checks |
| O37 determinism contract | unknown | only_weak |
| O38 error handling | not_landed | not landed K63, K69 |
| O39 dpipe buildability | not_landed | not landed K38 |
| O40 profile command | unknown | only_weak |
| O41 profile type inference | unknown | no_checks |
| O42 profile output schema | unknown | no_checks |
| O43 profile numeric statistics | unknown | no_checks |
| O44 profile string statistics | not_landed | not landed K46 |
| O45 profile datetime statistics | unknown | no_checks |
| O46 profile correlation matrix | unknown | only_weak |
| O47 profile output formatting | unknown | no_checks |
| O48 deduplicate transform | unknown | only_weak |
| O49 split transform | unknown | only_weak |
| O50 assert transform | unknown | no_checks |
| O51 normalize transform | unknown | derived_disagreement, no_checks |
| O52 encode transform | unknown | only_weak |
| O53 rollup transform | unknown | only_weak |
| O54 detect transform | unknown | only_weak |
| O55 bin transform | unknown | only_weak |
| O56 compare command | unknown | no_checks |
| O57 compare behavior | unknown | no_checks |
| O58 compare output report | unknown | no_checks |
| O59 hash transform | unknown | no_checks |
| O60 drift command | unknown | derived_disagreement, only_weak |
| O61 resample transform | unknown | derived_disagreement, no_checks |
| O62 watermark transform | unknown | no_checks |

Loss attribution: no checkable expectation 35; IC's own 0 (); executor 7 (O13, O28, O29, O31, O38, O39, O44).
