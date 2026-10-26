# Batch 1, commit 5: the debt slice replayed on recorded runs

Budget per round: the reviewer's line (round text × 2 + 10k) less A and B of the delivery package, at most 8 paragraphs. Old runs have no COVERED lines: nothing leaves the debt through the slice here, so this replays the queue and the rotation, not their effect.

## rep1n

| round | debt sentences / paragraphs at start | line | A + B | budget D | sent | cut | sent characters | rotation |
|---|---|---|---|---|---|---|---|---|
| R2 | 62 / 30 | 59,200 | 29,829 | 29,371 | 8 | 0 | 5,594 | 8/30 |
| R3 | 261 / 104 | 28,872 | 11,509 | 17,363 | 8 | 0 | 5,109 | 16/104 |
| R4 | 329 / 130 | 19,540 | 6,008 | 13,532 | 8 | 0 | 6,950 | 24/130 |
| R5 | 377 / 151 | 18,614 | 5,081 | 13,533 | 8 | 0 | 2,316 | 32/151 |
| R6 | 414 / 166 | 16,644 | 4,019 | 12,625 | 8 | 0 | 4,537 | 39/166 |

(i) (i)-class commands with a paragraph in the slice within 2 rounds: 2/11 (18%); not judged (no round after it, or no object by that name): 5.
  - R2 join (2 cases; objects O10): not in the slice within 2 rounds
  - R2 pivot (2 cases; objects O12): in the slice at R3
  - R3 join (2 cases; objects O10): not in the slice within 2 rounds
  - R3 window (11 cases; objects O11): in the slice at R4
  - R3 pivot (2 cases; objects O12): not in the slice within 2 rounds
  - R4 join (2 cases; objects O10): not in the slice within 2 rounds
  - R4 window (11 cases; objects O11): not in the slice within 2 rounds
  - R4 pivot (2 cases; objects O12): not in the slice within 2 rounds
  - R5 join (2 cases; objects O10): not in the slice within 2 rounds
  - R5 window (11 cases; objects O11): not in the slice within 2 rounds
  - R5 pivot (2 cases; objects O12): not in the slice within 2 rounds
  - R6 ingest (1 cases; objects O2, O3, O4): no round after it
  - R6 join (2 cases; objects O10): no round after it
  - R6 determinism (2 cases; objects O19): no round after it
  - R6 window (11 cases; objects O11): no round after it
  - R6 pivot (2 cases; objects O12): no round after it
(ii) sentences in the slice and under an open item: 0.
(iii) entry to first send: sent 82, never sent by the end 340 (of 422 that entered the debt); rounds waited: 0 → 22, 1 → 11, 2 → 22, 3 → 27; max 3; within 3 rounds 82.

## rep1p (registry by the dev line's code)

| round | debt sentences / paragraphs at start | line | A + B | budget D | sent | cut | sent characters | rotation |
|---|---|---|---|---|---|---|---|---|
| R2 | 89 / 37 | 59,200 | 29,829 | 29,371 | 8 | 0 | 6,209 | 8/37 |
| R3 | 240 / 96 | 28,872 | 10,830 | 18,042 | 8 | 0 | 5,234 | 16/96 |
| R4 | 295 / 120 | 19,540 | 6,008 | 13,532 | 8 | 0 | 4,859 | 23/120 |
| R5 | 349 / 143 | 18,614 | 5,178 | 13,436 | 8 | 0 | 2,442 | 31/143 |
| R6 | 383 / 155 | 16,644 | 4,050 | 12,594 | 8 | 0 | 2,355 | 38/155 |

(i) (i)-class commands with a paragraph in the slice within 2 rounds: 0/10 (0%); not judged (no round after it, or no object by that name): 9.
  - R1 determinism (1 cases; objects O15): not in the slice within 2 rounds
  - R2 derive (3 cases; objects none): not in the slice within 2 rounds
  - R3 derive (1 cases; objects none): not in the slice within 2 rounds
  - R3 hash (1 cases; objects O28): not in the slice within 2 rounds
  - R3 detect (3 cases; objects O25): not in the slice within 2 rounds
  - R3 bin (2 cases; objects O26): not in the slice within 2 rounds
  - R4 derive (1 cases; objects none): not in the slice within 2 rounds
  - R4 hash (1 cases; objects O28): not in the slice within 2 rounds
  - R4 detect (3 cases; objects O25): not in the slice within 2 rounds
  - R5 derive (1 cases; objects none): not in the slice within 2 rounds
  - R5 hash (1 cases; objects O28): not in the slice within 2 rounds
  - R5 profile (11 cases; objects O18): not in the slice within 2 rounds
  - R5 detect (3 cases; objects O25): not in the slice within 2 rounds
  - R5 compare (2 cases; objects O27): not in the slice within 2 rounds
  - R6 derive (1 cases; objects none): no round after it
  - R6 hash (1 cases; objects O28): no round after it
  - R6 profile (11 cases; objects O18): no round after it
  - R6 bin (1 cases; objects O26): no round after it
  - R6 compare (2 cases; objects O27): no round after it
(ii) sentences in the slice and under an open item: 0.
(iii) entry to first send: sent 95, never sent by the end 312 (of 407 that entered the debt); rounds waited: 0 → 29, 1 → 19, 2 → 19, 3 → 20, 4 → 8; max 4; within 3 rounds 87.

## rep1q (registry by the dev line's code)

| round | debt sentences / paragraphs at start | line | A + B | budget D | sent | cut | sent characters | rotation |
|---|---|---|---|---|---|---|---|---|
| R2 | 81 / 32 | 59,200 | 29,829 | 29,371 | 8 | 0 | 4,523 | 8/32 |
| R3 | 263 / 104 | 28,872 | 11,113 | 17,759 | 8 | 0 | 8,719 | 16/104 |
| R4 | 321 / 131 | 19,540 | 6,008 | 13,532 | 8 | 0 | 2,055 | 24/131 |
| R5 | 363 / 151 | 18,614 | 4,989 | 13,625 | 8 | 0 | 3,405 | 32/151 |

(i) (i)-class commands with a paragraph in the slice within 2 rounds: 5/10 (50%); not judged (no round after it, or no object by that name): 3.
  - R2 ingest (4 cases; objects O3, O4, O5): in the slice at R3
  - R2 pivot (2 cases; objects O13): in the slice at R3
  - R3 ingest (4 cases; objects O3, O4, O5): in the slice at R4
  - R3 window (3 cases; objects O12): in the slice at R4
  - R3 pivot (4 cases; objects O13): not in the slice within 2 rounds
  - R3 deduplicate (4 cases; objects O31): not in the slice within 2 rounds
  - R4 window (3 cases; objects O12): in the slice at R5
  - R4 pivot (4 cases; objects O13): not in the slice within 2 rounds
  - R4 deduplicate (4 cases; objects O31): not in the slice within 2 rounds
  - R4 profile (17 cases; objects O22, O23, O24, O25, O26, O27, O28, O29, O30): not in the slice within 2 rounds
  - R5 pivot (4 cases; objects O13): no round after it
  - R5 deduplicate (4 cases; objects O31): no round after it
  - R5 profile (17 cases; objects O22, O23, O24, O25, O26, O27, O28, O29, O30): no round after it
(ii) sentences in the slice and under an open item: 0.
(iii) entry to first send: sent 81, never sent by the end 284 (of 365 that entered the debt); rounds waited: 0 → 16, 1 → 25, 2 → 15, 3 → 25; max 3; within 3 rounds 81.

<!-- data: {"rep1n-20261025":{"iRows":[{"r":2,"op":"join","cases":2,"objects":["O10"],"hit":null,"in_run":true},{"r":2,"op":"pivot","cases":2,"objects":["O12"],"hit":3,"in_run":true},{"r":3,"op":"join","cases":2,"objects":["O10"],"hit":null,"in_run":true},{"r":3,"op":"window","cases":11,"objects":["O11"],"hit":4,"in_run":true},{"r":3,"op":"pivot","cases":2,"objects":["O12"],"hit":null,"in_run":true},{"r":4,"op":"join","cases":2,"objects":["O10"],"hit":null,"in_run":true},{"r":4,"op":"window","cases":11,"objects":["O11"],"hit":null,"in_run":true},{"r":4,"op":"pivot","cases":2,"objects":["O12"],"hit":null,"in_run":true},{"r":5,"op":"join","cases":2,"objects":["O10"],"hit":null,"in_run":true},{"r":5,"op":"window","cases":11,"objects":["O11"],"hit":null,"in_run":true},{"r":5,"op":"pivot","cases":2,"objects":["O12"],"hit":null,"in_run":true},{"r":6,"op":"ingest","cases":1,"objects":["O2","O3","O4"],"hit":null,"in_run":false},{"r":6,"op":"join","cases":2,"objects":["O10"],"hit":null,"in_run":false},{"r":6,"op":"determinism","cases":2,"objects":["O19"],"hit":null,"in_run":false},{"r":6,"op":"window","cases":11,"objects":["O11"],"hit":null,"in_run":false},{"r":6,"op":"pivot","cases":2,"objects":["O12"],"hit":null,"in_run":false}],"both":0,"waits":{"0":22,"1":11,"2":22,"3":27},"never":340,"entered":422},"rep1p-20261026":{"iRows":[{"r":1,"op":"determinism","cases":1,"objects":["O15"],"hit":null,"in_run":true},{"r":2,"op":"derive","cases":3,"objects":[],"hit":null,"in_run":true},{"r":3,"op":"derive","cases":1,"objects":[],"hit":null,"in_run":true},{"r":3,"op":"hash","cases":1,"objects":["O28"],"hit":null,"in_run":true},{"r":3,"op":"detect","cases":3,"objects":["O25"],"hit":null,"in_run":true},{"r":3,"op":"bin","cases":2,"objects":["O26"],"hit":null,"in_run":true},{"r":4,"op":"derive","cases":1,"objects":[],"hit":null,"in_run":true},{"r":4,"op":"hash","cases":1,"objects":["O28"],"hit":null,"in_run":true},{"r":4,"op":"detect","cases":3,"objects":["O25"],"hit":null,"in_run":true},{"r":5,"op":"derive","cases":1,"objects":[],"hit":null,"in_run":true},{"r":5,"op":"hash","cases":1,"objects":["O28"],"hit":null,"in_run":true},{"r":5,"op":"profile","cases":11,"objects":["O18"],"hit":null,"in_run":true},{"r":5,"op":"detect","cases":3,"objects":["O25"],"hit":null,"in_run":true},{"r":5,"op":"compare","cases":2,"objects":["O27"],"hit":null,"in_run":true},{"r":6,"op":"derive","cases":1,"objects":[],"hit":null,"in_run":false},{"r":6,"op":"hash","cases":1,"objects":["O28"],"hit":null,"in_run":false},{"r":6,"op":"profile","cases":11,"objects":["O18"],"hit":null,"in_run":false},{"r":6,"op":"bin","cases":1,"objects":["O26"],"hit":null,"in_run":false},{"r":6,"op":"compare","cases":2,"objects":["O27"],"hit":null,"in_run":false}],"both":0,"waits":{"0":29,"1":19,"2":19,"3":20,"4":8},"never":312,"entered":407},"rep1q-20261026":{"iRows":[{"r":2,"op":"ingest","cases":4,"objects":["O3","O4","O5"],"hit":3,"in_run":true},{"r":2,"op":"pivot","cases":2,"objects":["O13"],"hit":3,"in_run":true},{"r":3,"op":"ingest","cases":4,"objects":["O3","O4","O5"],"hit":4,"in_run":true},{"r":3,"op":"window","cases":3,"objects":["O12"],"hit":4,"in_run":true},{"r":3,"op":"pivot","cases":4,"objects":["O13"],"hit":null,"in_run":true},{"r":3,"op":"deduplicate","cases":4,"objects":["O31"],"hit":null,"in_run":true},{"r":4,"op":"window","cases":3,"objects":["O12"],"hit":5,"in_run":true},{"r":4,"op":"pivot","cases":4,"objects":["O13"],"hit":null,"in_run":true},{"r":4,"op":"deduplicate","cases":4,"objects":["O31"],"hit":null,"in_run":true},{"r":4,"op":"profile","cases":17,"objects":["O22","O23","O24","O25","O26","O27","O28","O29","O30"],"hit":null,"in_run":true},{"r":5,"op":"pivot","cases":4,"objects":["O13"],"hit":null,"in_run":false},{"r":5,"op":"deduplicate","cases":4,"objects":["O31"],"hit":null,"in_run":false},{"r":5,"op":"profile","cases":17,"objects":["O22","O23","O24","O25","O26","O27","O28","O29","O30"],"hit":null,"in_run":false}],"both":0,"waits":{"0":16,"1":25,"2":15,"3":25},"never":284,"entered":365}} -->
