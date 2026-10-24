# Repair outcomes (DESIGN-DEEP §4.1)

Rules in outcome.mjs's header. Items sent in a round (carried-in items count in the round they were carried into); outcome at the last cycle of the round the item went into. Percentages of all items sent.

## Mapping: strict

| run | round | sent | fixed | touched | untouched | no check | unmapped | build failed | untouched stopped for no progress |
|---|---|---|---|---|---|---|---|---|---|
| rep1j | 1 | 21 | 6 (29%) | 2 (10%) | 0 (0%) | 0 | 13 | 0 | 0 |
| rep1j | 2 | 27 | 19 (70%) | 0 (0%) | 0 (0%) | 0 | 8 | 0 | 0 |
| rep1j | 3 | 11 | 5 (45%) | 0 (0%) | 0 (0%) | 1 | 5 | 0 | 0 |
| rep1j | 4 | 7 | 2 (29%) | 0 (0%) | 0 (0%) | 1 | 4 | 0 | 0 |
| rep1j | 5 | 10 | 0 (0%) | 0 (0%) | 0 (0%) | 0 | 6 | 4 | 0 |
| rep1j | 6 | 14 | 8 (57%) | 0 (0%) | 0 (0%) | 1 | 5 | 0 | 0 |
| rep1k | 1 | 26 | 19 (73%) | 0 (0%) | 0 (0%) | 1 | 6 | 0 | 0 |
| rep1k | 2 | 25 | 16 (64%) | 0 (0%) | 0 (0%) | 0 | 9 | 0 | 0 |
| rep1k | 3 | 16 | 5 (31%) | 0 (0%) | 0 (0%) | 0 | 11 | 0 | 0 |
| rep1k | 4 | 20 | 7 (35%) | 0 (0%) | 0 (0%) | 0 | 13 | 0 | 0 |
| rep1k | 5 | 14 | 1 (7%) | 0 (0%) | 0 (0%) | 1 | 1 | 11 | 0 |
| rep1k | 6 | 20 | 1 (5%) | 0 (0%) | 0 (0%) | 6 | 13 | 0 | 0 |
| rep1l | 1 | 17 | 6 (35%) | 0 (0%) | 0 (0%) | 2 | 9 | 0 | 0 |
| rep1l | 2 | 33 | 12 (36%) | 0 (0%) | 0 (0%) | 2 | 19 | 0 | 0 |
| rep1m | 1 | 17 | 8 (47%) | 0 (0%) | 0 (0%) | 3 | 6 | 0 | 0 |
| rep1m | 2 | 32 | 13 (41%) | 0 (0%) | 0 (0%) | 2 | 17 | 0 | 0 |
| all | — | 310 | 128 (41%) | 2 (1%) | 0 (0%) | 20 | 145 | 15 | 0 |

Of the 130 items judged (a check, a mapped command, a program that built): fixed 98%, touched 2%, untouched 0% .

By the size of the message that sent the item (every send, outcome at the cycle it went into), mapping strict:

| items in the message | sends | fixed | touched | untouched | untouched of judged | no check / unmapped |
|---|---|---|---|---|---|---|
| 1–5 | 68 | 24 | 0 | 0 | 0% | 5 / 35 |
| 6–10 | 193 | 75 | 0 | 2 | 3% | 13 / 103 |
| 11+ | 109 | 29 | 2 | 0 | 0% | 2 / 64 |

Unmapped under strict: 145 (by object: Transformation 26, profile command 15, compare command 12, ingest command 10, pipeline command 10, bin operation 8, window operation 7, Ingestion 6, validate command 6, window transformation 6, expression evaluator 5, verify command 4, Lineage command 3, pivot operation 3, aggregate operation 3, Error handling 2, Profile command 2, Validate command 2, audit logging 2, pivot transformation 2, aggregate transformation 2, rollup transformation 2, drift command 1, normalize operation 1, encode operation 1, rollup operation 1, detect operation 1, hash operation 1, bin transformation 1)

## Mapping: stem

| run | round | sent | fixed | touched | untouched | no check | unmapped | build failed | untouched stopped for no progress |
|---|---|---|---|---|---|---|---|---|---|
| rep1j | 1 | 21 | 6 (29%) | 2 (10%) | 0 (0%) | 0 | 13 | 0 | 0 |
| rep1j | 2 | 27 | 19 (70%) | 0 (0%) | 2 (7%) | 0 | 6 | 0 | 2 |
| rep1j | 3 | 11 | 5 (45%) | 0 (0%) | 0 (0%) | 1 | 5 | 0 | 0 |
| rep1j | 4 | 7 | 2 (29%) | 0 (0%) | 1 (14%) | 1 | 3 | 0 | 1 |
| rep1j | 5 | 10 | 0 (0%) | 0 (0%) | 3 (30%) | 0 | 3 | 4 | 0 |
| rep1j | 6 | 14 | 8 (57%) | 0 (0%) | 1 (7%) | 1 | 4 | 0 | 1 |
| rep1k | 1 | 26 | 19 (73%) | 2 (8%) | 3 (12%) | 1 | 1 | 0 | 3 |
| rep1k | 2 | 25 | 16 (64%) | 1 (4%) | 7 (28%) | 0 | 1 | 0 | 7 |
| rep1k | 3 | 16 | 5 (31%) | 0 (0%) | 10 (63%) | 0 | 1 | 0 | 10 |
| rep1k | 4 | 20 | 7 (35%) | 0 (0%) | 12 (60%) | 0 | 1 | 0 | 12 |
| rep1k | 5 | 14 | 1 (7%) | 0 (0%) | 1 (7%) | 1 | 0 | 11 | 1 |
| rep1k | 6 | 20 | 1 (5%) | 7 (35%) | 3 (15%) | 6 | 3 | 0 | 3 |
| rep1l | 1 | 17 | 6 (35%) | 0 (0%) | 9 (53%) | 2 | 0 | 0 | 8 |
| rep1l | 2 | 33 | 12 (36%) | 4 (12%) | 15 (45%) | 2 | 0 | 0 | 14 |
| rep1m | 1 | 17 | 8 (47%) | 0 (0%) | 1 (6%) | 3 | 5 | 0 | 1 |
| rep1m | 2 | 32 | 13 (41%) | 0 (0%) | 9 (28%) | 2 | 8 | 0 | 7 |
| all | — | 310 | 128 (41%) | 16 (5%) | 77 (25%) | 20 | 54 | 15 | 70 |

Of the 221 items judged (a check, a mapped command, a program that built): fixed 58%, touched 7%, untouched 35%  (of which the command was not in the program at all: 4).

By the size of the message that sent the item (every send, outcome at the cycle it went into), mapping stem:

| items in the message | sends | fixed | touched | untouched | untouched of judged | no check / unmapped |
|---|---|---|---|---|---|---|
| 1–5 | 68 | 24 | 2 | 20 | 43% | 5 / 13 |
| 6–10 | 193 | 75 | 13 | 54 | 38% | 13 / 38 |
| 11+ | 109 | 29 | 20 | 23 | 32% | 2 / 23 |

Unmapped under stem: 54 (by object: Transformation 26, Ingestion 6, window transformation 6, expression evaluator 5, Error handling 2, audit logging 2, pivot transformation 2, aggregate transformation 2, rollup transformation 2, bin transformation 1)

## Rule: output (unseen in the unmapped column)

| run | round | sent | fixed | touched | untouched | no check | unmapped | build failed | untouched stopped for no progress |
|---|---|---|---|---|---|---|---|---|---|
| rep1j | 1 | 21 | 6 (29%) | 0 (0%) | 15 (71%) | 0 | 0 | 0 | 0 |
| rep1j | 2 | 27 | 19 (70%) | 0 (0%) | 8 (30%) | 0 | 0 | 0 | 8 |
| rep1j | 3 | 11 | 5 (45%) | 0 (0%) | 5 (45%) | 1 | 0 | 0 | 5 |
| rep1j | 4 | 7 | 2 (29%) | 0 (0%) | 4 (57%) | 1 | 0 | 0 | 4 |
| rep1j | 5 | 10 | 0 (0%) | 0 (0%) | 6 (60%) | 0 | 0 | 4 | 0 |
| rep1j | 6 | 14 | 8 (57%) | 0 (0%) | 5 (36%) | 1 | 0 | 0 | 5 |
| rep1k | 1 | 26 | 19 (73%) | 0 (0%) | 6 (23%) | 1 | 0 | 0 | 6 |
| rep1k | 2 | 25 | 16 (64%) | 0 (0%) | 9 (36%) | 0 | 0 | 0 | 9 |
| rep1k | 3 | 16 | 5 (31%) | 0 (0%) | 11 (69%) | 0 | 0 | 0 | 11 |
| rep1k | 4 | 20 | 7 (35%) | 0 (0%) | 13 (65%) | 0 | 0 | 0 | 13 |
| rep1k | 5 | 14 | 1 (7%) | 0 (0%) | 1 (7%) | 1 | 0 | 11 | 1 |
| rep1k | 6 | 20 | 1 (5%) | 1 (5%) | 12 (60%) | 6 | 0 | 0 | 12 |
| rep1l | 1 | 17 | 6 (35%) | 1 (6%) | 8 (47%) | 2 | 0 | 0 | 8 |
| rep1l | 2 | 33 | 12 (36%) | 2 (6%) | 17 (52%) | 2 | 0 | 0 | 17 |
| rep1m | 1 | 17 | 8 (47%) | 0 (0%) | 6 (35%) | 3 | 0 | 0 | 6 |
| rep1m | 2 | 32 | 13 (41%) | 2 (6%) | 15 (47%) | 2 | 0 | 0 | 15 |
| all | — | 310 | 128 (41%) | 6 (2%) | 141 (45%) | 20 | 0 | 15 | 120 |

Of the 275 items judged (a check, a sighting, a program that built): fixed 47%, touched 2%, untouched 51% .

By the size of the message that sent the item (every send, outcome at the cycle it went into), mapping output:

| items in the message | sends | fixed | touched | untouched | untouched of judged | no check / unmapped |
|---|---|---|---|---|---|---|
| 1–5 | 68 | 24 | 7 | 28 | 47% | 5 / 0 |
| 6–10 | 193 | 75 | 27 | 78 | 43% | 13 / 0 |
| 11+ | 109 | 29 | 16 | 50 | 53% | 2 / 0 |

Unmapped under output: 0 (by object: )

## Output rule against stem

No check (sent in the reviewer's words, no output to compare): 20 items; build failed at round end: 15; both apart.

At round end: 202 of 275 agree (73%); of the 221 that both rules judge (stem mapped, output sighted), 202 agree (91%).

| output (rows) / stem (columns) | fixed | touched | untouched | unmapped | build_failed |
|---|---|---|---|---|---|
| fixed | 128 | 0 | 0 | 0 | 0 |
| touched | 0 | 1 | 4 | 1 | 0 |
| untouched | 0 | 15 | 73 | 53 | 0 |
| unseen | 0 | 0 | 0 | 0 | 0 |
| build_failed | 0 | 0 | 0 | 0 | 0 |

Send by send: 225 of 334 agree (67%).

| output (rows) / stem (columns) | fixed | touched | untouched | unmapped | build_failed |
|---|---|---|---|---|---|
| fixed | 128 | 0 | 0 | 0 | 0 |
| touched | 0 | 19 | 19 | 12 | 0 |
| untouched | 0 | 16 | 78 | 62 | 0 |
| unseen | 0 | 0 | 0 | 0 | 0 |
| build_failed | 0 | 0 | 0 | 0 | 0 |

Disagreements at round end where both rules judge:

| run | round | item | object | output | stem | stem by cycle | output by cycle |
|---|---|---|---|---|---|---|---|
| rep1j | 1 | V1.1.9 | Pipeline | untouched | touched | C1.2:untouched C1.3:untouched(reverted) C1.4:touched(reverted) | C1.2:touched C1.3:untouched(reverted) C1.4:untouched(reverted) |
| rep1j | 1 | V1.3.7 | Pipeline | untouched | touched | C1.4:touched(reverted) | C1.4:untouched(reverted) |
| rep1k | 1 | V1.2.2 | window operation | untouched | touched | C1.3:touched C1.4:touched | C1.3:touched C1.4:untouched |
| rep1k | 1 | V1.3.1 | window operation | untouched | touched | C1.4:touched | C1.4:untouched |
| rep1k | 2 | V2.1.3 | bin operation | untouched | touched | C2.2:touched | C2.2:untouched |
| rep1k | 6 | V1.1.9 | ingest command | untouched | touched | C6.1:touched | C6.1:untouched |
| rep1k | 6 | V2.1.4 | profile command | untouched | touched | C6.1:touched | C6.1:untouched |
| rep1k | 6 | V2.1.7 | compare command | untouched | touched | C6.1:touched | C6.1:untouched |
| rep1k | 6 | V2.1.8 | compare command | untouched | touched | C6.1:touched | C6.1:untouched |
| rep1k | 6 | V4.2.1 | validate command | untouched | touched | C6.1:touched | C6.1:untouched |
| rep1k | 6 | V4.2.2 | validate command | untouched | touched | C6.1:touched | C6.1:untouched |
| rep1k | 6 | V4.2.3 | validate command | untouched | touched | C6.1:touched | C6.1:untouched |
| rep1l | 1 | V1.3.3 | pipeline command | touched | untouched | C1.4:untouched | C1.4:touched |
| rep1l | 2 | V1.1.5 | pivot operation | untouched | touched | C2.1:touched | C2.1:untouched |
| rep1l | 2 | V1.3.3 | pipeline command | untouched | touched | C2.1:touched | C2.1:untouched |
| rep1l | 2 | V2.1.3 | compare command | untouched | touched | C2.2:touched | C2.2:untouched |
| rep1l | 2 | V2.3.2 | compare command | touched | untouched | C2.4:untouched | C2.4:touched |
| rep1m | 2 | V2.3.6 | profile command | touched | untouched | C2.4:untouched | C2.4:touched |
| rep1m | 2 | V2.3.7 | profile command | touched | untouched | C2.4:untouched | C2.4:touched |

Stem unmapped, by the output rule: fixed 0, touched 1, untouched 53, unseen 0

## Items

| run | round | item | object | first sent into | outcomes by cycle (stem) | end (stem) | end (strict) | end (output) | stopped (no progress) | carried into next round |
|---|---|---|---|---|---|---|---|---|---|---|
| rep1j | 1 | V1.1.1 | Transformation | C1.2 | C1.2:unmapped C1.3:unmapped(reverted) C1.4:unmapped(reverted) | unmapped | unmapped | untouched |  | yes |
| rep1j | 1 | V1.1.2 | Transformation | C1.2 | C1.2:unmapped C1.3:unmapped(reverted) C1.4:unmapped(reverted) | unmapped | unmapped | untouched |  | yes |
| rep1j | 1 | V1.1.3 | Transformation | C1.2 | C1.2:fixed | fixed | fixed | fixed |  |  |
| rep1j | 1 | V1.1.4 | Transformation | C1.2 | C1.2:fixed | fixed | fixed | fixed |  |  |
| rep1j | 1 | V1.1.5 | Transformation | C1.2 | C1.2:fixed | fixed | fixed | fixed |  |  |
| rep1j | 1 | V1.1.6 | Transformation | C1.2 | C1.2:fixed | fixed | fixed | fixed |  |  |
| rep1j | 1 | V1.1.7 | Transformation | C1.2 | C1.2:fixed | fixed | fixed | fixed |  |  |
| rep1j | 1 | V1.1.8 | Error handling | C1.2 | C1.2:fixed | fixed | fixed | fixed |  |  |
| rep1j | 1 | V1.1.9 | Pipeline | C1.2 | C1.2:untouched C1.3:untouched(reverted) C1.4:touched(reverted) | touched | touched | untouched |  |  |
| rep1j | 1 | V1.2.1 | Transformation | C1.3 | C1.3:unmapped(reverted) C1.4:unmapped(reverted) | unmapped | unmapped | untouched |  | yes |
| rep1j | 1 | V1.2.2 | Transformation | C1.3 | C1.3:unmapped(reverted) C1.4:unmapped(reverted) | unmapped | unmapped | untouched |  | yes |
| rep1j | 1 | V1.2.3 | Transformation | C1.3 | C1.3:unmapped(reverted) C1.4:unmapped(reverted) | unmapped | unmapped | untouched |  | yes |
| rep1j | 1 | V1.2.4 | Transformation | C1.3 | C1.3:unmapped(reverted) C1.4:unmapped(reverted) | unmapped | unmapped | untouched |  | yes |
| rep1j | 1 | V1.3.1 | Transformation | C1.4 | C1.4:unmapped(reverted) | unmapped | unmapped | untouched |  | yes |
| rep1j | 1 | V1.3.2 | Transformation | C1.4 | C1.4:unmapped(reverted) | unmapped | unmapped | untouched |  | yes |
| rep1j | 1 | V1.3.3 | Transformation | C1.4 | C1.4:unmapped(reverted) | unmapped | unmapped | untouched |  | yes |
| rep1j | 1 | V1.3.4 | Transformation | C1.4 | C1.4:unmapped(reverted) | unmapped | unmapped | untouched |  | yes |
| rep1j | 1 | V1.3.5 | Error handling | C1.4 | C1.4:unmapped(reverted) | unmapped | unmapped | untouched |  |  |
| rep1j | 1 | V1.3.6 | Transformation | C1.4 | C1.4:unmapped(reverted) | unmapped | unmapped | untouched |  | yes |
| rep1j | 1 | V1.3.7 | Pipeline | C1.4 | C1.4:touched(reverted) | touched | touched | untouched |  |  |
| rep1j | 1 | V1.3.8 | Error handling | C1.4 | C1.4:unmapped(reverted) | unmapped | unmapped | untouched |  |  |
| rep1j | 2 | V1.1.1 (carried in) | Transformation | C2.1 | C2.1:unmapped C2.4:unmapped | unmapped | unmapped | untouched | yes | yes |
| rep1j | 2 | V1.1.2 (carried in) | Transformation | C2.1 | C2.1:unmapped C2.2:unmapped | unmapped | unmapped | untouched | yes | yes |
| rep1j | 2 | V1.2.1 (carried in) | Transformation | C2.1 | C2.1:unmapped | unmapped | unmapped | untouched | yes |  |
| rep1j | 2 | V1.2.2 (carried in) | Transformation | C2.1 | C2.1:unmapped C2.2:unmapped | unmapped | unmapped | untouched | yes | yes |
| rep1j | 2 | V1.2.3 (carried in) | Transformation | C2.1 | C2.1:fixed | fixed | fixed | fixed |  |  |
| rep1j | 2 | V1.2.4 (carried in) | Transformation | C2.1 | C2.1:fixed | fixed | fixed | fixed |  |  |
| rep1j | 2 | V1.3.1 (carried in) | Transformation | C2.1 | C2.1:fixed | fixed | fixed | fixed |  |  |
| rep1j | 2 | V1.3.2 (carried in) | Transformation | C2.1 | C2.1:fixed | fixed | fixed | fixed |  |  |
| rep1j | 2 | V1.3.3 (carried in) | Transformation | C2.1 | C2.1:fixed | fixed | fixed | fixed |  |  |
| rep1j | 2 | V1.3.4 (carried in) | Transformation | C2.1 | C2.1:fixed | fixed | fixed | fixed |  |  |
| rep1j | 2 | V1.3.6 (carried in) | Transformation | C2.1 | C2.1:fixed | fixed | fixed | fixed |  |  |
| rep1j | 2 | V2.1.1 | Transformation | C2.2 | C2.2:fixed | fixed | fixed | fixed |  |  |
| rep1j | 2 | V2.1.2 | Transformation | C2.2 | C2.2:fixed | fixed | fixed | fixed |  |  |
| rep1j | 2 | V2.1.3 | Transformation | C2.2 | C2.2:unmapped C2.3:fixed | fixed | fixed | fixed |  |  |
| rep1j | 2 | V2.1.4 | Profile command | C2.2 | C2.2:fixed | fixed | fixed | fixed |  |  |
| rep1j | 2 | V2.1.5 | Profile command | C2.2 | C2.2:untouched C2.3:untouched | untouched | unmapped | untouched | yes | yes |
| rep1j | 2 | V2.1.7 | Transformation | C2.2 | C2.2:fixed | fixed | fixed | fixed |  |  |
| rep1j | 2 | V2.2.1 | Transformation | C2.3 | C2.3:fixed | fixed | fixed | fixed |  |  |
| rep1j | 2 | V2.2.2 | Transformation | C2.3 | C2.3:unmapped | unmapped | unmapped | untouched | yes | yes |
| rep1j | 2 | V2.2.3 | Transformation | C2.3 | C2.3:fixed | fixed | fixed | fixed |  |  |
| rep1j | 2 | V2.2.4 | Transformation | C2.3 | C2.3:fixed | fixed | fixed | fixed |  |  |
| rep1j | 2 | V2.2.5 | Profile command | C2.3 | C2.3:untouched C2.4:untouched | untouched | unmapped | untouched | yes | yes |
| rep1j | 2 | V2.2.6 | Compare command | C2.3 | C2.3:fixed | fixed | fixed | fixed |  |  |
| rep1j | 2 | V2.2.7 | Ingestion | C2.3 | C2.3:unmapped C2.4:unmapped | unmapped | unmapped | untouched | yes | yes |
| rep1j | 2 | V2.2.8 | Transformation | C2.3 | C2.3:fixed | fixed | fixed | fixed |  |  |
| rep1j | 2 | V2.3.1 | Transformation | C2.4 | C2.4:fixed | fixed | fixed | fixed |  |  |
| rep1j | 2 | V2.3.2 | Transformation | C2.4 | C2.4:fixed | fixed | fixed | fixed |  |  |
| rep1j | 3 | V1.1.1 (carried in) | Transformation | C3.1 | C3.1:unmapped | unmapped | unmapped | untouched | yes | yes |
| rep1j | 3 | V1.1.2 (carried in) | Transformation | C3.1 | C3.1:unmapped | unmapped | unmapped | untouched | yes |  |
| rep1j | 3 | V1.2.2 (carried in) | Transformation | C3.1 | C3.1:unmapped | unmapped | unmapped | untouched | yes |  |
| rep1j | 3 | V2.1.5 (carried in) | Profile command | C3.1 | C3.1:fixed | fixed | fixed | fixed |  |  |
| rep1j | 3 | V2.2.2 (carried in) | Transformation | C3.1 | C3.1:unmapped | unmapped | unmapped | untouched | yes | yes |
| rep1j | 3 | V2.2.5 (carried in) | Profile command | C3.1 | C3.1:fixed | fixed | fixed | fixed |  |  |
| rep1j | 3 | V2.2.7 (carried in) | Ingestion | C3.1 | C3.1:unmapped | unmapped | unmapped | untouched | yes | yes |
| rep1j | 3 | V3.1.1 | Error handling | C3.2 | C3.2:fixed | fixed | fixed | fixed |  |  |
| rep1j | 3 | V3.2.1 | — | C3.3 | C3.3:no_check | no_check | no_check | no_check |  |  |
| rep1j | 3 | V3.3.1 | Transformation | C3.4 | C3.4:fixed | fixed | fixed | fixed |  |  |
| rep1j | 3 | V3.3.2 | Transformation | C3.4 | C3.4:fixed | fixed | fixed | fixed |  |  |
| rep1j | 4 | V1.1.1 (carried in) | Transformation | C4.1 | C4.1:unmapped | unmapped | unmapped | untouched | yes | yes |
| rep1j | 4 | V2.2.2 (carried in) | Transformation | C4.1 | C4.1:unmapped | unmapped | unmapped | untouched | yes | yes |
| rep1j | 4 | V2.2.7 (carried in) | Ingestion | C4.1 | C4.1:unmapped | unmapped | unmapped | untouched | yes | yes |
| rep1j | 4 | V4.1.1 | Validate command | C4.2 | C4.2:untouched C4.3:untouched | untouched | unmapped | untouched | yes | yes |
| rep1j | 4 | V4.2.2 | Transformation | C4.3 | C4.3:fixed | fixed | fixed | fixed |  |  |
| rep1j | 4 | V4.2.1 | — | C4.3 | C4.3:no_check | no_check | no_check | no_check |  |  |
| rep1j | 4 | V4.3.1 | Validate command | C4.4 | C4.4:fixed | fixed | fixed | fixed |  |  |
| rep1j | 5 | V1.1.1 (carried in) | Transformation | C5.1 | C5.1:build_failed | build_failed | build_failed | build_failed | yes | yes |
| rep1j | 5 | V2.2.2 (carried in) | Transformation | C5.1 | C5.1:build_failed | build_failed | build_failed | build_failed | yes | yes |
| rep1j | 5 | V2.2.7 (carried in) | Ingestion | C5.1 | C5.1:build_failed | build_failed | build_failed | build_failed | yes | yes |
| rep1j | 5 | V4.1.1 (carried in) | Validate command | C5.1 | C5.1:build_failed | build_failed | build_failed | build_failed | yes | yes |
| rep1j | 5 | V5.1.1 | Ingestion | C5.3 | C5.3:unmapped(reverted) C5.4:unmapped(reverted) | unmapped | unmapped | untouched |  | yes |
| rep1j | 5 | V5.1.2 | Lineage command | C5.3 | C5.3:untouched(reverted) C5.4:untouched(reverted) | untouched | unmapped | untouched |  | yes |
| rep1j | 5 | V5.2.1 | Ingestion | C5.4 | C5.4:unmapped(reverted) C5.5:unmapped(reverted) | unmapped | unmapped | untouched |  | yes |
| rep1j | 5 | V5.2.2 | Lineage command | C5.4 | C5.4:untouched(reverted) C5.5:untouched(reverted) | untouched | unmapped | untouched |  | yes |
| rep1j | 5 | V5.3.1 | Transformation | C5.5 | C5.5:unmapped(reverted) | unmapped | unmapped | untouched |  | yes |
| rep1j | 5 | V5.3.2 | Lineage command | C5.5 | C5.5:untouched(reverted) | untouched | unmapped | untouched |  | yes |
| rep1j | 6 | V1.1.1 (carried in) | Transformation | C6.1 | C6.1:unmapped | unmapped | unmapped | untouched | yes |  |
| rep1j | 6 | V2.2.2 (carried in) | Transformation | C6.1 | C6.1:unmapped | unmapped | unmapped | untouched | yes |  |
| rep1j | 6 | V2.2.7 (carried in) | Ingestion | C6.1 | C6.1:unmapped | unmapped | unmapped | untouched | yes |  |
| rep1j | 6 | V4.1.1 (carried in) | Validate command | C6.1 | C6.1:untouched | untouched | unmapped | untouched | yes |  |
| rep1j | 6 | V5.1.1 (carried in) | Ingestion | C6.1 | C6.1:fixed | fixed | fixed | fixed |  |  |
| rep1j | 6 | V5.1.2 (carried in) | Lineage command | C6.1 | C6.1:fixed | fixed | fixed | fixed |  |  |
| rep1j | 6 | V5.2.1 (carried in) | Ingestion | C6.1 | C6.1:fixed | fixed | fixed | fixed |  |  |
| rep1j | 6 | V5.2.2 (carried in) | Lineage command | C6.1 | C6.1:fixed | fixed | fixed | fixed |  |  |
| rep1j | 6 | V5.3.1 (carried in) | Transformation | C6.1 | C6.1:fixed | fixed | fixed | fixed |  |  |
| rep1j | 6 | V5.3.2 (carried in) | Lineage command | C6.1 | C6.1:fixed | fixed | fixed | fixed |  |  |
| rep1j | 6 | G57 | — | C6.2 | C6.2:no_check | no_check | no_check | no_check | yes |  |
| rep1j | 6 | V6.1.1 | Transformation | C6.2 | C6.2:unmapped C6.3:unmapped | unmapped | unmapped | untouched | yes |  |
| rep1j | 6 | V6.1.2 | Transformation | C6.2 | C6.2:fixed | fixed | fixed | fixed |  |  |
| rep1j | 6 | V6.1.3 | Audit logging | C6.2 | C6.2:fixed | fixed | fixed | fixed |  |  |
| rep1k | 1 | V1.1.1 | filter operation | C1.2 | C1.2:fixed | fixed | fixed | fixed |  |  |
| rep1k | 1 | V1.1.2 | expression evaluator | C1.2 | C1.2:unmapped C1.3:unmapped | unmapped | unmapped | untouched | yes | yes |
| rep1k | 1 | V1.1.3 | aggregate operation | C1.2 | C1.2:touched C1.3:fixed | fixed | fixed | fixed |  |  |
| rep1k | 1 | V1.1.4 | join operation | C1.2 | C1.2:touched C1.3:fixed | fixed | fixed | fixed |  |  |
| rep1k | 1 | V1.1.5 | window operation | C1.2 | C1.2:touched C1.3:fixed | fixed | fixed | fixed |  |  |
| rep1k | 1 | V1.1.6 | pivot operation | C1.2 | C1.2:touched C1.4:fixed | fixed | fixed | fixed | yes |  |
| rep1k | 1 | V1.1.7 | unpivot operation | C1.2 | C1.2:fixed | fixed | fixed | fixed |  |  |
| rep1k | 1 | V1.1.8 | fill operation | C1.2 | C1.2:fixed | fixed | fixed | fixed |  |  |
| rep1k | 1 | V1.1.9 | ingest command | C1.2 | C1.2:untouched C1.3:untouched | untouched | unmapped | untouched | yes | yes |
| rep1k | 1 | V1.1.10 | manifest command | C1.2 | C1.2:fixed | fixed | fixed | fixed |  |  |
| rep1k | 1 | V1.1.11 | verify command | C1.2 | C1.2:touched C1.3:touched C1.4:untouched | untouched | unmapped | untouched | yes | yes |
| rep1k | 1 | V1.1.12 | pipeline command | C1.2 | C1.2:untouched C1.3:untouched | untouched | unmapped | untouched | yes | yes |
| rep1k | 1 | V1.2.1 | aggregate operation | C1.3 | C1.3:fixed | fixed | fixed | fixed |  |  |
| rep1k | 1 | V1.2.2 | window operation | C1.3 | C1.3:touched C1.4:touched | touched | unmapped | untouched | yes | yes |
| rep1k | 1 | V1.2.3 | aggregate operation | C1.3 | C1.3:fixed | fixed | fixed | fixed |  |  |
| rep1k | 1 | V1.2.4 | join operation | C1.3 | C1.3:fixed | fixed | fixed | fixed |  |  |
| rep1k | 1 | V1.2.5 | pivot operation | C1.3 | C1.3:fixed | fixed | fixed | fixed |  |  |
| rep1k | 1 | V1.2.6 | ingest command | C1.3 | C1.3:fixed | fixed | fixed | fixed |  |  |
| rep1k | 1 | V1.2.7 | error handling | C1.3 | C1.3:fixed | fixed | fixed | fixed |  |  |
| rep1k | 1 | V1.2.8 | fill operation | C1.3 | C1.3:fixed | fixed | fixed | fixed |  |  |
| rep1k | 1 | V1.2.9 | error handling | C1.3 | C1.3:fixed | fixed | fixed | fixed |  |  |
| rep1k | 1 | V1.3.1 | window operation | C1.4 | C1.4:touched | touched | unmapped | untouched | yes | yes |
| rep1k | 1 | V1.3.2 | pivot operation | C1.4 | C1.4:fixed | fixed | fixed | fixed |  |  |
| rep1k | 1 | V1.3.3 | pivot operation | C1.4 | C1.4:fixed | fixed | fixed | fixed |  |  |
| rep1k | 1 | V1.3.4 | expression evaluator | C1.4 | C1.4:fixed | fixed | fixed | fixed |  |  |
| rep1k | 1 | V1.3.5 | — | C1.4 | C1.4:no_check | no_check | no_check | no_check |  |  |
| rep1k | 2 | V1.1.2 (carried in) | expression evaluator | C2.1 | C2.1:unmapped | unmapped | unmapped | untouched | yes | yes |
| rep1k | 2 | V1.1.9 (carried in) | ingest command | C2.1 | C2.1:untouched | untouched | unmapped | untouched | yes | yes |
| rep1k | 2 | V1.1.11 (carried in) | verify command | C2.1 | C2.1:untouched | untouched | unmapped | untouched | yes | yes |
| rep1k | 2 | V1.1.12 (carried in) | pipeline command | C2.1 | C2.1:untouched | untouched | unmapped | untouched | yes | yes |
| rep1k | 2 | V1.2.2 (carried in) | window operation | C2.1 | C2.1:fixed | fixed | fixed | fixed |  |  |
| rep1k | 2 | V1.3.1 (carried in) | window operation | C2.1 | C2.1:fixed | fixed | fixed | fixed |  |  |
| rep1k | 2 | V2.1.1 | rollup operation | C2.2 | C2.2:touched C2.3:fixed | fixed | fixed | fixed |  |  |
| rep1k | 2 | V2.1.2 | detect operation | C2.2 | C2.2:fixed | fixed | fixed | fixed |  |  |
| rep1k | 2 | V2.1.3 | bin operation | C2.2 | C2.2:touched | touched | unmapped | untouched | yes | yes |
| rep1k | 2 | V2.1.4 | profile command | C2.2 | C2.2:untouched C2.3:untouched | untouched | unmapped | untouched | yes | yes |
| rep1k | 2 | V2.1.5 | compare command | C2.2 | C2.2:fixed | fixed | fixed | fixed |  |  |
| rep1k | 2 | V2.1.6 | compare command | C2.2 | C2.2:fixed | fixed | fixed | fixed |  |  |
| rep1k | 2 | V2.1.7 | compare command | C2.2 | C2.2:untouched C2.3:untouched | untouched | unmapped | untouched | yes | yes |
| rep1k | 2 | V2.1.8 | compare command | C2.2 | C2.2:untouched C2.3:untouched | untouched | unmapped | untouched | yes | yes |
| rep1k | 2 | V2.1.9 | window operation | C2.2 | C2.2:touched C2.3:untouched | untouched | unmapped | untouched | yes |  |
| rep1k | 2 | V2.1.10 | window operation | C2.2 | C2.2:fixed | fixed | fixed | fixed |  |  |
| rep1k | 2 | V2.2.1 | rollup operation | C2.3 | C2.3:fixed | fixed | fixed | fixed |  |  |
| rep1k | 2 | V2.2.2 | rollup operation | C2.3 | C2.3:fixed | fixed | fixed | fixed |  |  |
| rep1k | 2 | V2.2.3 | detect operation | C2.3 | C2.3:fixed | fixed | fixed | fixed |  |  |
| rep1k | 2 | V2.2.4 | compare command | C2.3 | C2.3:fixed | fixed | fixed | fixed |  |  |
| rep1k | 2 | V2.3.1 | rollup operation | C2.4 | C2.4:fixed | fixed | fixed | fixed |  |  |
| rep1k | 2 | V2.3.2 | rollup operation | C2.4 | C2.4:fixed | fixed | fixed | fixed |  |  |
| rep1k | 2 | V2.3.3 | detect operation | C2.4 | C2.4:fixed | fixed | fixed | fixed |  |  |
| rep1k | 2 | V2.3.4 | window operation | C2.4 | C2.4:fixed | fixed | fixed | fixed |  |  |
| rep1k | 2 | V2.3.5 | pipeline command | C2.4 | C2.4:fixed | fixed | fixed | fixed |  |  |
| rep1k | 3 | V1.1.2 (carried in) | expression evaluator | C3.1 | C3.1:unmapped | unmapped | unmapped | untouched | yes | yes |
| rep1k | 3 | V1.1.9 (carried in) | ingest command | C3.1 | C3.1:untouched | untouched | unmapped | untouched | yes | yes |
| rep1k | 3 | V1.1.11 (carried in) | verify command | C3.1 | C3.1:untouched | untouched | unmapped | untouched | yes | yes |
| rep1k | 3 | V1.1.12 (carried in) | pipeline command | C3.1 | C3.1:untouched | untouched | unmapped | untouched | yes | yes |
| rep1k | 3 | V2.1.3 (carried in) | bin operation | C3.1 | C3.1:untouched C3.3:untouched | untouched | unmapped | untouched | yes | yes |
| rep1k | 3 | V2.1.4 (carried in) | profile command | C3.1 | C3.1:untouched | untouched | unmapped | untouched | yes | yes |
| rep1k | 3 | V2.1.7 (carried in) | compare command | C3.1 | C3.1:untouched | untouched | unmapped | untouched | yes | yes |
| rep1k | 3 | V2.1.8 (carried in) | compare command | C3.1 | C3.1:untouched | untouched | unmapped | untouched | yes | yes |
| rep1k | 3 | V3.1.1 | bin operation | C3.2 | C3.2:touched C3.3:untouched | untouched | unmapped | untouched | yes | yes |
| rep1k | 3 | V3.1.2 | resample operation | C3.2 | C3.2:fixed | fixed | fixed | fixed |  |  |
| rep1k | 3 | V3.1.3 | drift command | C3.2 | C3.2:fixed | fixed | fixed | fixed |  |  |
| rep1k | 3 | V3.1.4 | error handling | C3.2 | C3.2:fixed | fixed | fixed | fixed |  |  |
| rep1k | 3 | V3.1.5 | pipeline command | C3.2 | C3.2:untouched C3.3:untouched | untouched | unmapped | untouched | yes | yes |
| rep1k | 3 | V3.2.1 | drift command | C3.3 | C3.3:untouched | untouched | unmapped | untouched | yes |  |
| rep1k | 3 | V3.2.2 | error handling | C3.3 | C3.3:fixed | fixed | fixed | fixed |  |  |
| rep1k | 3 | V3.3.1 | drift command | C3.4 | C3.4:fixed | fixed | fixed | fixed |  |  |
| rep1k | 4 | V1.1.2 (carried in) | expression evaluator | C4.1 | C4.1:unmapped | unmapped | unmapped | untouched | yes | yes |
| rep1k | 4 | V1.1.9 (carried in) | ingest command | C4.1 | C4.1:untouched | untouched | unmapped | untouched | yes | yes |
| rep1k | 4 | V1.1.11 (carried in) | verify command | C4.1 | C4.1:untouched | untouched | unmapped | untouched | yes |  |
| rep1k | 4 | V1.1.12 (carried in) | pipeline command | C4.1 | C4.1:untouched | untouched | unmapped | untouched | yes | yes |
| rep1k | 4 | V2.1.3 (carried in) | bin operation | C4.1 | C4.1:untouched | untouched | unmapped | untouched | yes | yes |
| rep1k | 4 | V2.1.4 (carried in) | profile command | C4.1 | C4.1:untouched | untouched | unmapped | untouched | yes | yes |
| rep1k | 4 | V2.1.7 (carried in) | compare command | C4.1 | C4.1:untouched | untouched | unmapped | untouched | yes | yes |
| rep1k | 4 | V2.1.8 (carried in) | compare command | C4.1 | C4.1:untouched | untouched | unmapped | untouched | yes | yes |
| rep1k | 4 | V3.1.1 (carried in) | bin operation | C4.1 | C4.1:untouched | untouched | unmapped | untouched | yes | yes |
| rep1k | 4 | V3.1.5 (carried in) | pipeline command | C4.1 | C4.1:untouched | untouched | unmapped | untouched | yes | yes |
| rep1k | 4 | V4.1.1 | validate command | C4.2 | C4.2:untouched C4.3:fixed | fixed | fixed | fixed |  |  |
| rep1k | 4 | V4.1.2 | validate command | C4.2 | C4.2:fixed | fixed | fixed | fixed |  |  |
| rep1k | 4 | V4.1.3 | validate command | C4.2 | C4.2:fixed | fixed | fixed | fixed |  |  |
| rep1k | 4 | V4.1.4 | validate command | C4.2 | C4.2:fixed | fixed | fixed | fixed |  |  |
| rep1k | 4 | V4.1.5 | validate command | C4.2 | C4.2:fixed | fixed | fixed | fixed |  |  |
| rep1k | 4 | V4.1.6 | validate command | C4.2 | C4.2:untouched C4.3:fixed | fixed | fixed | fixed |  |  |
| rep1k | 4 | V4.2.1 | validate command | C4.3 | C4.3:untouched | untouched | unmapped | untouched | yes | yes |
| rep1k | 4 | V4.2.2 | validate command | C4.3 | C4.3:untouched | untouched | unmapped | untouched | yes | yes |
| rep1k | 4 | V4.2.3 | validate command | C4.3 | C4.3:untouched | untouched | unmapped | untouched | yes | yes |
| rep1k | 4 | V4.3.1 | validate command | C4.4 | C4.4:fixed | fixed | fixed | fixed |  |  |
| rep1k | 5 | V1.1.2 (carried in) | expression evaluator | C5.1 | C5.1:build_failed | build_failed | build_failed | build_failed | yes | yes |
| rep1k | 5 | V1.1.9 (carried in) | ingest command | C5.1 | C5.1:build_failed C5.3:touched C5.4:untouched | untouched | unmapped | untouched | yes | yes |
| rep1k | 5 | V1.1.12 (carried in) | pipeline command | C5.1 | C5.1:build_failed | build_failed | build_failed | build_failed | yes |  |
| rep1k | 5 | V2.1.3 (carried in) | bin operation | C5.1 | C5.1:build_failed | build_failed | build_failed | build_failed | yes | yes |
| rep1k | 5 | V2.1.4 (carried in) | profile command | C5.1 | C5.1:build_failed | build_failed | build_failed | build_failed | yes | yes |
| rep1k | 5 | V2.1.7 (carried in) | compare command | C5.1 | C5.1:build_failed | build_failed | build_failed | build_failed | yes | yes |
| rep1k | 5 | V2.1.8 (carried in) | compare command | C5.1 | C5.1:build_failed | build_failed | build_failed | build_failed | yes | yes |
| rep1k | 5 | V3.1.1 (carried in) | bin operation | C5.1 | C5.1:build_failed | build_failed | build_failed | build_failed | yes | yes |
| rep1k | 5 | V3.1.5 (carried in) | pipeline command | C5.1 | C5.1:build_failed | build_failed | build_failed | build_failed | yes |  |
| rep1k | 5 | V4.2.1 (carried in) | validate command | C5.1 | C5.1:build_failed | build_failed | build_failed | build_failed | yes | yes |
| rep1k | 5 | V4.2.2 (carried in) | validate command | C5.1 | C5.1:build_failed | build_failed | build_failed | build_failed | yes | yes |
| rep1k | 5 | V4.2.3 (carried in) | validate command | C5.1 | C5.1:build_failed | build_failed | build_failed | build_failed | yes | yes |
| rep1k | 5 | G5 | — | C5.3 | C5.3:no_check | no_check | no_check | no_check | yes | yes |
| rep1k | 5 | V5.1.1 | lineage command | C5.3 | C5.3:fixed | fixed | fixed | fixed |  |  |
| rep1k | 6 | G5 (carried in) | — | C6.1 | C6.1:no_check | no_check | no_check | no_check |  |  |
| rep1k | 6 | V1.1.2 (carried in) | expression evaluator | C6.1 | C6.1:unmapped | unmapped | unmapped | untouched | yes |  |
| rep1k | 6 | V1.1.9 (carried in) | ingest command | C6.1 | C6.1:touched | touched | unmapped | untouched | yes |  |
| rep1k | 6 | V2.1.3 (carried in) | bin operation | C6.1 | C6.1:untouched | untouched | unmapped | untouched | yes |  |
| rep1k | 6 | V2.1.4 (carried in) | profile command | C6.1 | C6.1:touched | touched | unmapped | untouched | yes |  |
| rep1k | 6 | V2.1.7 (carried in) | compare command | C6.1 | C6.1:touched | touched | unmapped | untouched | yes |  |
| rep1k | 6 | V2.1.8 (carried in) | compare command | C6.1 | C6.1:touched | touched | unmapped | untouched | yes |  |
| rep1k | 6 | V3.1.1 (carried in) | bin operation | C6.1 | C6.1:untouched | untouched | unmapped | untouched | yes |  |
| rep1k | 6 | V4.2.1 (carried in) | validate command | C6.1 | C6.1:touched | touched | unmapped | untouched | yes |  |
| rep1k | 6 | V4.2.2 (carried in) | validate command | C6.1 | C6.1:touched | touched | unmapped | untouched | yes |  |
| rep1k | 6 | V4.2.3 (carried in) | validate command | C6.1 | C6.1:touched | touched | unmapped | untouched | yes |  |
| rep1k | 6 | G87 | — | C6.2 | C6.2:no_check | no_check | no_check | no_check | yes |  |
| rep1k | 6 | G88 | — | C6.2 | C6.2:no_check | no_check | no_check | no_check | yes |  |
| rep1k | 6 | V6.1.1 | audit logging | C6.2 | C6.2:unmapped | unmapped | unmapped | untouched | yes |  |
| rep1k | 6 | V6.1.2 | ingest command | C6.2 | C6.2:untouched | untouched | unmapped | untouched | yes |  |
| rep1k | 6 | V6.1.3 | — | C6.2 | C6.2:no_check | no_check | no_check | no_check |  |  |
| rep1k | 6 | V6.1.4 | — | C6.2 | C6.2:no_check | no_check | no_check | no_check |  |  |
| rep1k | 6 | V6.2.1 | validate command | C6.3 | C6.3:fixed | fixed | fixed | fixed |  |  |
| rep1k | 6 | V6.2.2 | — | C6.3 | C6.3:no_check | no_check | no_check | no_check |  |  |
| rep1k | 6 | V6.3.1 | audit logging | C6.4 | C6.4:unmapped | unmapped | unmapped | touched |  |  |
| rep1l | 1 | V1.1.1 | derive operation | C1.2 | C1.2:fixed | fixed | fixed | fixed |  |  |
| rep1l | 1 | V1.1.2 | derive operation | C1.2 | C1.2:fixed | fixed | fixed | fixed |  |  |
| rep1l | 1 | V1.1.3 | join operation | C1.2 | C1.2:fixed | fixed | fixed | fixed |  |  |
| rep1l | 1 | V1.1.4 | window operation | C1.2 | C1.2:fixed | fixed | fixed | fixed |  |  |
| rep1l | 1 | V1.1.5 | pivot operation | C1.2 | C1.2:untouched | untouched | unmapped | untouched | yes | yes |
| rep1l | 1 | V1.1.6 | unpivot operation | C1.2 | C1.2:fixed | fixed | fixed | fixed |  |  |
| rep1l | 1 | V1.1.9 | ingest command | C1.2 | C1.2:untouched | untouched | unmapped | untouched | yes | yes |
| rep1l | 1 | V1.1.10 | ingest command | C1.2 | C1.2:fixed | fixed | fixed | fixed |  |  |
| rep1l | 1 | V1.2.1 | ingest command | C1.3 | C1.3:untouched | untouched | unmapped | untouched | yes | yes |
| rep1l | 1 | V1.2.2 | aggregate operation | C1.3 | C1.3:untouched | untouched | unmapped | untouched | yes | yes |
| rep1l | 1 | V1.2.3 | window operation | C1.3 | C1.3:untouched | untouched | unmapped | untouched | yes | yes |
| rep1l | 1 | V1.2.4 | window operation | C1.3 | C1.3:untouched | untouched | unmapped | untouched | yes | yes |
| rep1l | 1 | V1.2.5 | — | C1.3 | C1.3:no_check | no_check | no_check | no_check |  |  |
| rep1l | 1 | V1.2.6 | — | C1.3 | C1.3:no_check | no_check | no_check | no_check |  |  |
| rep1l | 1 | V1.3.1 | aggregate operation | C1.4 | C1.4:untouched | untouched | unmapped | untouched | yes | yes |
| rep1l | 1 | V1.3.2 | window operation | C1.4 | C1.4:untouched | untouched | unmapped | untouched | yes | yes |
| rep1l | 1 | V1.3.3 | pipeline command | C1.4 | C1.4:untouched | untouched | unmapped | touched |  | yes |
| rep1l | 2 | V1.1.5 (carried in) | pivot operation | C2.1 | C2.1:touched | touched | unmapped | untouched | yes |  |
| rep1l | 2 | V1.1.9 (carried in) | ingest command | C2.1 | C2.1:fixed | fixed | fixed | fixed |  |  |
| rep1l | 2 | V1.2.1 (carried in) | ingest command | C2.1 | C2.1:touched C2.2:untouched | untouched | unmapped | untouched | yes |  |
| rep1l | 2 | V1.2.2 (carried in) | aggregate operation | C2.1 | C2.1:touched C2.2:untouched | untouched | unmapped | untouched | yes |  |
| rep1l | 2 | V1.2.3 (carried in) | window operation | C2.1 | C2.1:touched C2.2:untouched | untouched | unmapped | untouched | yes |  |
| rep1l | 2 | V1.2.4 (carried in) | window operation | C2.1 | C2.1:fixed | fixed | fixed | fixed |  |  |
| rep1l | 2 | V1.3.1 (carried in) | aggregate operation | C2.1 | C2.1:fixed | fixed | fixed | fixed |  |  |
| rep1l | 2 | V1.3.2 (carried in) | window operation | C2.1 | C2.1:fixed | fixed | fixed | fixed |  |  |
| rep1l | 2 | V1.3.3 (carried in) | pipeline command | C2.1 | C2.1:touched | touched | unmapped | untouched | yes |  |
| rep1l | 2 | V2.1.1 | profile command | C2.2 | C2.2:untouched | untouched | unmapped | untouched | yes |  |
| rep1l | 2 | V2.1.2 | profile command | C2.2 | C2.2:untouched | untouched | unmapped | untouched | yes |  |
| rep1l | 2 | V2.1.3 | compare command | C2.2 | C2.2:touched | touched | unmapped | untouched | yes |  |
| rep1l | 2 | V2.1.4 | error handling | C2.2 | C2.2:fixed | fixed | fixed | fixed |  |  |
| rep1l | 2 | V2.1.5 | deduplicate operation | C2.2 | C2.2:touched C2.3:fixed | fixed | fixed | fixed |  |  |
| rep1l | 2 | V2.1.6 | split operation | C2.2 | C2.2:touched C2.3:fixed | fixed | fixed | fixed |  |  |
| rep1l | 2 | V2.1.7 | assert operation | C2.2 | C2.2:fixed | fixed | fixed | fixed |  |  |
| rep1l | 2 | V2.1.8 | normalize operation | C2.2 | C2.2:untouched(absent) | untouched | unmapped | untouched | yes |  |
| rep1l | 2 | V2.1.9 | encode operation | C2.2 | C2.2:untouched(absent) | untouched | unmapped | untouched | yes |  |
| rep1l | 2 | V2.1.10 | rollup operation | C2.2 | C2.2:untouched(absent) | untouched | unmapped | untouched | yes |  |
| rep1l | 2 | V2.1.11 | detect operation | C2.2 | C2.2:untouched(absent) | untouched | unmapped | untouched | yes |  |
| rep1l | 2 | V2.1.12 | bin operation | C2.2 | C2.2:untouched(absent) C2.4:touched | touched | unmapped | touched | yes |  |
| rep1l | 2 | V2.1.13 | hash operation | C2.2 | C2.2:touched C2.3:fixed | fixed | fixed | fixed |  |  |
| rep1l | 2 | V2.1.14 | pivot operation | C2.2 | C2.2:untouched | untouched | unmapped | untouched | yes |  |
| rep1l | 2 | V2.2.1 | deduplicate operation | C2.3 | C2.3:fixed | fixed | fixed | fixed |  |  |
| rep1l | 2 | V2.2.2 | split operation | C2.3 | C2.3:fixed | fixed | fixed | fixed |  |  |
| rep1l | 2 | V2.2.3 | hash operation | C2.3 | C2.3:touched C2.4:untouched | untouched | unmapped | untouched | yes |  |
| rep1l | 2 | V2.2.4 | profile command | C2.3 | C2.3:untouched | untouched | unmapped | untouched | yes |  |
| rep1l | 2 | V2.2.5 | compare command | C2.3 | C2.3:untouched | untouched | unmapped | untouched | yes |  |
| rep1l | 2 | V2.2.6 | — | C2.3 | C2.3:no_check | no_check | no_check | no_check |  |  |
| rep1l | 2 | V2.3.1 | profile command | C2.4 | C2.4:untouched | untouched | unmapped | untouched | yes |  |
| rep1l | 2 | V2.3.2 | compare command | C2.4 | C2.4:untouched | untouched | unmapped | touched |  |  |
| rep1l | 2 | V2.3.3 | bin operation | C2.4 | C2.4:fixed | fixed | fixed | fixed |  |  |
| rep1l | 2 | V2.3.4 | — | C2.4 | C2.4:no_check | no_check | no_check | no_check |  |  |
| rep1m | 1 | V1.1.1 | sample sort and basic transformations | C1.2 | C1.2:fixed | fixed | fixed | fixed |  |  |
| rep1m | 1 | V1.1.2 | join transformation | C1.2 | C1.2:fixed | fixed | fixed | fixed |  |  |
| rep1m | 1 | V1.1.3 | window transformation | C1.2 | C1.2:unmapped C1.3:unmapped | unmapped | unmapped | untouched | yes | yes |
| rep1m | 1 | V1.1.4 | pivot transformation | C1.2 | C1.2:unmapped | unmapped | unmapped | untouched | yes | yes |
| rep1m | 1 | V1.1.5 | manifest command | C1.2 | C1.2:fixed | fixed | fixed | fixed |  |  |
| rep1m | 1 | V1.1.7 | pipeline command | C1.2 | C1.2:untouched C1.3:untouched | untouched | unmapped | untouched | yes | yes |
| rep1m | 1 | V1.2.1 | window transformation | C1.3 | C1.3:unmapped | unmapped | unmapped | untouched | yes | yes |
| rep1m | 1 | V1.2.2 | window transformation | C1.3 | C1.3:unmapped | unmapped | unmapped | untouched | yes | yes |
| rep1m | 1 | V1.2.3 | — | C1.3 | C1.3:no_check | no_check | no_check | no_check |  |  |
| rep1m | 1 | V1.2.4 | aggregate transformation | C1.3 | C1.3:unmapped | unmapped | unmapped | untouched | yes | yes |
| rep1m | 1 | V1.2.5 | error handling | C1.3 | C1.3:fixed | fixed | fixed | fixed |  |  |
| rep1m | 1 | V1.3.1 | — | C1.4 | C1.4:no_check | no_check | no_check | no_check |  |  |
| rep1m | 1 | V1.3.2 | window transformation | C1.4 | C1.4:fixed | fixed | fixed | fixed |  |  |
| rep1m | 1 | V1.3.3 | window transformation | C1.4 | C1.4:fixed | fixed | fixed | fixed |  |  |
| rep1m | 1 | V1.3.4 | aggregate transformation | C1.4 | C1.4:fixed | fixed | fixed | fixed |  |  |
| rep1m | 1 | V1.3.5 | schema validation | C1.4 | C1.4:fixed | fixed | fixed | fixed |  |  |
| rep1m | 1 | V1.3.6 | — | C1.4 | C1.4:no_check | no_check | no_check | no_check |  |  |
| rep1m | 2 | V1.1.3 (carried in) | window transformation | C2.1 | C2.1:unmapped | unmapped | unmapped | untouched | yes |  |
| rep1m | 2 | V1.1.4 (carried in) | pivot transformation | C2.1 | C2.1:unmapped | unmapped | unmapped | untouched | yes |  |
| rep1m | 2 | V1.1.7 (carried in) | pipeline command | C2.1 | C2.1:untouched | untouched | unmapped | untouched | yes |  |
| rep1m | 2 | V1.2.1 (carried in) | window transformation | C2.1 | C2.1:unmapped | unmapped | unmapped | untouched | yes |  |
| rep1m | 2 | V1.2.2 (carried in) | window transformation | C2.1 | C2.1:unmapped | unmapped | unmapped | untouched | yes |  |
| rep1m | 2 | V1.2.4 (carried in) | aggregate transformation | C2.1 | C2.1:unmapped | unmapped | unmapped | untouched | yes |  |
| rep1m | 2 | V2.1.1 | profile command | C2.2 | C2.2:untouched C2.3:untouched | untouched | unmapped | untouched | yes |  |
| rep1m | 2 | V2.1.2 | profile command | C2.2 | C2.2:untouched C2.3:untouched | untouched | unmapped | untouched | yes |  |
| rep1m | 2 | V2.1.3 | compare command | C2.2 | C2.2:touched C2.3:untouched | untouched | unmapped | untouched | yes |  |
| rep1m | 2 | V2.1.4 | compare command | C2.2 | C2.2:fixed | fixed | fixed | fixed |  |  |
| rep1m | 2 | V2.1.5 | error handling | C2.2 | C2.2:fixed | fixed | fixed | fixed |  |  |
| rep1m | 2 | V2.1.6 | error handling | C2.2 | C2.2:fixed | fixed | fixed | fixed |  |  |
| rep1m | 2 | V2.1.15 | window transformation | C2.2 | C2.2:fixed | fixed | fixed | fixed |  |  |
| rep1m | 2 | V2.2.1 | profile command | C2.3 | C2.3:untouched | untouched | unmapped | untouched | yes |  |
| rep1m | 2 | V2.2.2 | profile command | C2.3 | C2.3:untouched | untouched | unmapped | untouched | yes |  |
| rep1m | 2 | V2.2.3 | profile command | C2.3 | C2.3:untouched | untouched | unmapped | untouched | yes |  |
| rep1m | 2 | V2.2.4 | split transformation | C2.3 | C2.3:fixed | fixed | fixed | fixed |  |  |
| rep1m | 2 | V2.2.5 | expression evaluator | C2.3 | C2.3:fixed | fixed | fixed | fixed |  |  |
| rep1m | 2 | V2.2.6 | hash transformation | C2.3 | C2.3:unmapped C2.4:fixed | fixed | fixed | fixed |  |  |
| rep1m | 2 | V2.2.7 | — | C2.3 | C2.3:no_check | no_check | no_check | no_check |  |  |
| rep1m | 2 | V2.2.8 | encode transformation | C2.3 | C2.3:fixed | fixed | fixed | fixed |  |  |
| rep1m | 2 | V2.2.9 | rollup transformation | C2.3 | C2.3:unmapped | unmapped | unmapped | untouched | yes |  |
| rep1m | 2 | V2.2.10 | detect transformation | C2.3 | C2.3:fixed | fixed | fixed | fixed |  |  |
| rep1m | 2 | V2.2.11 | bin transformation | C2.3 | C2.3:unmapped C2.4:unmapped | unmapped | unmapped | untouched | yes |  |
| rep1m | 2 | V2.2.12 | compare command | C2.3 | C2.3:fixed | fixed | fixed | fixed |  |  |
| rep1m | 2 | V2.3.1 | — | C2.4 | C2.4:no_check | no_check | no_check | no_check |  |  |
| rep1m | 2 | V2.3.2 | hash transformation | C2.4 | C2.4:fixed | fixed | fixed | fixed |  |  |
| rep1m | 2 | V2.3.3 | detect transformation | C2.4 | C2.4:fixed | fixed | fixed | fixed |  |  |
| rep1m | 2 | V2.3.4 | bin transformation | C2.4 | C2.4:fixed | fixed | fixed | fixed |  |  |
| rep1m | 2 | V2.3.5 | rollup transformation | C2.4 | C2.4:unmapped | unmapped | unmapped | untouched | yes |  |
| rep1m | 2 | V2.3.6 | profile command | C2.4 | C2.4:untouched | untouched | unmapped | touched |  |  |
| rep1m | 2 | V2.3.7 | profile command | C2.4 | C2.4:untouched | untouched | unmapped | touched |  |  |
