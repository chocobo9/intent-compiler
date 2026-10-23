# Round 2 report

Official score: 346/481

| Stage | Calls | Tokens | Stand-in calls |
|---|---|---|---|
| understanding (attribution) | 1 | in 29190, cache read 0, out 1634 | 0 |
| acceptance (checks) | 3 | in 63007, cache read 59904, out 25769 | 0 |
| coding | 4 | in 168546, cache read 3800960, out 16743 | 0 |
| interrupted attempts: understanding | 0 | in 0, cache read 0, out 0 | 0 |
| interrupted attempts: acceptance | 0 | in 0, cache read 0, out 0 | 0 |
| interrupted attempts: coding | 0 | in 0, cache read 0, out 0 | 0 |

Scope: 23 objects. Zones: task 40, protection 0, status 7, source blocks 95, anchors 0.
Execution: cycles_spent; 4 cycles (3 repairs), kept C2.4 with 0 failing; 0 contests; carried 22; sessions 1 (0 broken).
Wall time 1043 s. attribution 19.6 s (1×, 0–20 s); check writing 167.8 s (1×, 20–188 s); checks 11.4 s (1×, 20–32 s); carry-over 7.6 s (2×, 32–39 s); coding 132.5 s (1×, 40–172 s); build 4.9 s (4×, 172–969 s); trial 12.3 s (4×, 173–972 s); waiting for checks 10.8 s (2×, 177–1020 s); guard rerun 146.2 s (12×, 188–1019 s); review 248.5 s (3×, 217–778 s); formalize 157.3 s (3×, 297–857 s); premise checks 61.3 s (3×, 342–897 s); repair 203.5 s (3×, 355–968 s).
Determinations on the final program: 11 stated values (A), 44 by a reference (B), 0 by judgment (C), all A and B compared by code.
Open: program wrong 25, uncovered 0, reference disagreement pending 8, ambiguous 0; closed as uncheckable 0.
Review acceptance: first delivery C2.1 7856bb40 (official 191/481); trial runs 4 (0 failed); reviews 3 (void sessions 0): #1 on C2.1: reported 17, blocked 1, malformed 0, sent 16, logged 4, leads given 28, program runs seen 22; #2 on C2.2: reported 12, blocked 0, malformed 0, sent 12 (fallback 1: not_formalized 1), logged 1, leads given 8, program runs seen 13; #3 on C2.3: reported 14, blocked 0, malformed 0, sent 14, logged 4, leads given 3, program runs seen 28.
Reviewer items: reported 43, entered a repair list 42 (verified 32, logged 9, fallback 1), blocked 1; every entry ended once: yes; premise checks blocked 1 (not_reproduced 1), logged and sent 10 (reference_failed 3, value_not_computed 2, value_not_stated 5); fallback in 1 review(s), 1 item(s), whole reply 0 (not_formalized 1); reviews with no program run seen 0.
Guards: 28 at the start, 92 at the end, new 64 (G29, G30, G31, G32, G33, G34, G35, G36, G37, G38, G39, G40, G41, G42, G43, G44, G45, G46, G47, G48, G49, G50, G51, G52, G53, G54, G55, G56, G57, G58, G59, G60, G61, G62, G63, G64, G65, G66, G67, G68, G69, G70, G71, G72, G73, G74, G75, G76, G77, G78, G79, G80, G81, G82, G83, G84, G85, G86, G87, G88, G89, G90, G91, G92); flips on changed text 0, on unchanged text 0; retired as superseded 0; repairs reverted 0.
Guard coverage: 255/346 live units; uncovered 91 (R1.S2.P4.s1, R1.S2.P4.s2, R1.S3.P7.s1, R1.S3.P13.s1, R1.S3.P13.s2, R1.S3.P13.s3, R1.S3.P13.s4, R1.S3.P14.s1, R1.S3.P14.s3, R1.S3.P14.s4, R1.S3.P14.s5, R1.S3.P14.s6, R1.S3.P14.s7, R1.S3.P14.s8, R1.S3.P14.s9, R1.S3.P16.s1, R1.S3.P16.s2, R1.S3.P22.s1, R1.S3.P22.s2, R1.S3.P23.s2, R1.S3.P23.s3, R1.S3.P23.s7, R1.S4.P1.s1, R1.S4.P2.s1, R1.S4.P2.s2 and 66 more; the full list is in report.json). Leads to the reviewer: library 39, judgment 0.
Reviewer (gpt-5.6-luna-fast): 3 sessions, in 152317, cache read 1660288, out 15336, cache share 0.916. Formalizer (gpt-5.6-luna-fast): 4 calls, in 114286, cache read 22016, out 27196, cache share 0.162.
§12i measures: wall 1043 s; guards 28→92; regressions 0 (changed text 0, unchanged 0); reverted 0; fallback reviews 1 (items 1); no program run seen 0; tokens uncached/cache read/out: executor 168546/3800960/16743, attribution 29190/0/1634, checks 63007/59904/25769, reviewer 152317/1660288/15336, formalizer 114286/22016/27196, probes 0/0/0, judge 0/0/0, interrupted_management 0/0/0; non-executor cost 602956 (uncached + 0.1 × cache read + out).
Ledger: open program wrong 25 (confirmed by a ruling 0), uncovered 0, reference pending 8; listed only 9 (unverified 6, blocked 3); ended this round 43 (fixed 38, unverified 4, blocked 1); sent 71 times; held 25.
Checks: 18 entered, 0 stale, 0 retired; 55 run, 47 passed, 8 failed.
Check writing: admitted 18/18, unknown 0 (never told the model 0); dropped after the repairs 5 (unknown_block 2, methods_disagree 3); read the one way they could mean: unquoted expected string 5; runs refused as an unknown subcommand 0.
Objects: 20 landed, 7 not landed, 32 unknown.

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
| O22 window result formatting | not_landed | not landed K22 |
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
| O38 error handling | landed | strong pass K39, K40, K44, K55, K57 |
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
| O51 normalize transform | unknown | only_weak |
| O52 encode transform | unknown | only_weak |
| O53 rollup transform | unknown | only_weak |
| O54 detect transform | unknown | only_weak |
| O55 bin transform | unknown | only_weak |
| O56 compare command | unknown | no_checks |
| O57 compare behavior | unknown | no_checks |
| O58 compare output report | unknown | no_checks |
| O59 hash transform | unknown | no_checks |

Loss attribution: no checkable expectation 32; IC's own 0 (); executor 7 (O13, O22, O28, O29, O31, O39, O44).
