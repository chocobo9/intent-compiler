# (i) cases against the debt slice, opusb3

## The slice per round

| round | paragraphs sent | why | origin rounds | characters / budget | debt at the start (sentences / paragraphs) |
|---|---|---|---|---|---|
| R1 | 0 | — | — | 0 / 25811 | — |
| R2 | 7 | gap 7 | R1 7 | 2029 / 29371 | 8 / 7 |
| R3 | 8 | gap 8 | R1 2, R2 6 | 1340 / 16765 | 128 / 59 |
| R4 | 8 | gap 8 | R1 2, R2 3, R3 3 | 1329 / 13848 | 142 / 63 |
| R5 | 8 | gap 3, never passed 3, rotation 2 | R1 2, R4 1, R2 3, R3 2 | 4803 / 13325 | 111 / 48 |
| R6 | 8 | rotation 8 | R2 8 | 2151 / 12594 | 78 / 40 |

## Objects of the (i) ops at the round's start

| round | op | (i) cases | objects | behaviour sentences | held | failing | unverified | in debt | under an open item | in this round's slice |
|---|---|---|---|---|---|---|---|---|---|---|
| R3 | encode | 6 | O50 encode transform | 13 | 0 | 12 | 1 | 10 | 3 | 0 paragraphs |
| R3 | rename-drop | 3 | O27 rename operation; O28 drop operation | 2 | 2 | 0 | 0 | 0 | 0 | 0 paragraphs |
| R3 | normalize | 2 | O49 normalize transform | 14 | 0 | 12 | 2 | 11 | 3 | 0 paragraphs |
| R3 | deduplicate | 1 | O46 deduplicate transform | 7 | 0 | 6 | 1 | 6 | 1 | 1 paragraphs |
| R4 | window | 7 | O31 window operation | 17 | 17 | 0 | 0 | 0 | 1 | 0 paragraphs |
| R4 | normalize | 2 | O49 normalize transform | 16 | 4 | 0 | 12 | 12 | 0 | 0 paragraphs |
| R4 | compare | 2 | O54 compare command; O55 compare logic; O56 compare output; O57 compare error handling; O58 compare options | 36 | 15 | 0 | 21 | 21 | 0 | 0 paragraphs |
| R4 | deduplicate | 1 | O46 deduplicate transform | 7 | 6 | 0 | 1 | 1 | 0 | 1 paragraphs |
| R5 | window | 7 | O31 window operation | 17 | 17 | 0 | 0 | 0 | 1 | 0 paragraphs |
| R5 | encode | 4 | O50 encode transform | 13 | 12 | 0 | 1 | 1 | 3 | 0 paragraphs |
| R5 | normalize | 2 | O49 normalize transform | 16 | 4 | 0 | 12 | 12 | 0 | 1 paragraphs |
| R5 | compare | 2 | O54 compare command; O55 compare logic; O56 compare output; O57 compare error handling; O58 compare options | 36 | 15 | 0 | 21 | 21 | 0 | 0 paragraphs |
| R5 | deduplicate | 1 | O46 deduplicate transform | 7 | 7 | 0 | 0 | 0 | 0 | 0 paragraphs |
| R6 | window | 7 | O31 window operation | 17 | 17 | 0 | 0 | 0 | 1 | 0 paragraphs |
| R6 | profile | 7 | O42 profile command; O43 profile type inference; O44 profile output; O45 profile correlation | 70 | 69 | 1 | 0 | 0 | 29 | 0 paragraphs |
| R6 | encode | 4 | O50 encode transform | 13 | 12 | 0 | 1 | 1 | 3 | 1 paragraphs |
| R6 | determinism | 2 | O39 determinism contract | 3 | 2 | 1 | 0 | 0 | 1 | 0 paragraphs |
| R6 | normalize | 2 | O49 normalize transform | 16 | 4 | 1 | 11 | 11 | 1 | 1 paragraphs |
| R6 | compare | 2 | O54 compare command; O55 compare logic; O56 compare output; O57 compare error handling; O58 compare options | 36 | 15 | 0 | 21 | 21 | 0 | 3 paragraphs |
| R6 | deduplicate | 1 | O46 deduplicate transform | 7 | 6 | 1 | 0 | 0 | 1 | 0 paragraphs |

Totals by round: R3 12 cases; their objects' sentences held 2, failing 30, unverified 4, in debt 27; paragraphs sliced 1. R4 12 cases; their objects' sentences held 42, failing 0, unverified 34, in debt 34; paragraphs sliced 1. R5 16 cases; their objects' sentences held 55, failing 0, unverified 34, in debt 34; paragraphs sliced 1. R6 25 cases; their objects' sentences held 125, failing 4, unverified 33, in debt 33; paragraphs sliced 5.
