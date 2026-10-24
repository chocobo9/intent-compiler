# Items carried in untouched: their outcome in the next round (output rule)

An item untouched at the end of round n (its check's output unchanged since it was sent) and carried into round n+1, by the output rule at the last cycle it went into in n+1.

| run | round carried from | carried | fixed | touched | untouched | build_failed | unseen | not sent again |
|---|---|---|---|---|---|---|---|---|
| rep1j | R1 → R2 | 11 | 7 | 0 | 4 | 0 | 0 | 0 |
| rep1j | R2 → R3 | 7 | 2 | 0 | 5 | 0 | 0 | 0 |
| rep1j | R3 → R4 | 3 | 0 | 0 | 3 | 0 | 0 | 0 |
| rep1j | R4 → R5 | 4 | 0 | 0 | 0 | 4 | 0 | 0 |
| rep1j | R5 → R6 | 6 | 6 | 0 | 0 | 0 | 0 | 0 |
| rep1k | R1 → R2 | 6 | 2 | 0 | 4 | 0 | 0 | 0 |
| rep1k | R2 → R3 | 8 | 0 | 0 | 8 | 0 | 0 | 0 |
| rep1k | R3 → R4 | 10 | 0 | 0 | 10 | 0 | 0 | 0 |
| rep1k | R4 → R5 | 12 | 0 | 0 | 1 | 11 | 0 | 0 |
| rep1k | R5 → R6 | 2 | 1 | 0 | 1 | 0 | 0 | 0 |
| rep1l | R1 → R2 | 8 | 4 | 0 | 4 | 0 | 0 | 0 |
| rep1m | R1 → R2 | 6 | 0 | 0 | 6 | 0 | 0 | 0 |
| all | — | 83 | 22 (27%) | 0 (0%) | 46 (55%) | 15 (18%) | 0 (0%) | 0 (0%) |

Untouched runs: every item from the first round it ended untouched, the rounds in a row it stayed untouched, and what came after (not carried: the round was the run's last or the item left the ledger).

| rounds untouched in a row, then | items |
|---|---|
| 1 round(s), then build_failed | 4 |
| 1 round(s), then fixed | 22 |
| 1 round(s), then not carried | 47 |
| 2 round(s), then build_failed | 2 |
| 2 round(s), then not carried | 11 |
| 3 round(s), then build_failed | 6 |
| 3 round(s), then not carried | 2 |
| 4+ round(s), then build_failed | 3 |
| 4+ round(s), then not carried | 2 |

Items:

| run | item | rounds | next round |
|---|---|---|---|
| rep1j | V1.1.1 | R1 → R2 | untouched |
| rep1j | V1.1.2 | R1 → R2 | untouched |
| rep1j | V1.2.1 | R1 → R2 | untouched |
| rep1j | V1.2.2 | R1 → R2 | untouched |
| rep1j | V1.2.3 | R1 → R2 | fixed |
| rep1j | V1.2.4 | R1 → R2 | fixed |
| rep1j | V1.3.1 | R1 → R2 | fixed |
| rep1j | V1.3.2 | R1 → R2 | fixed |
| rep1j | V1.3.3 | R1 → R2 | fixed |
| rep1j | V1.3.4 | R1 → R2 | fixed |
| rep1j | V1.3.6 | R1 → R2 | fixed |
| rep1j | V1.1.1 | R2 → R3 | untouched |
| rep1j | V1.1.2 | R2 → R3 | untouched |
| rep1j | V1.2.2 | R2 → R3 | untouched |
| rep1j | V2.1.5 | R2 → R3 | fixed |
| rep1j | V2.2.2 | R2 → R3 | untouched |
| rep1j | V2.2.5 | R2 → R3 | fixed |
| rep1j | V2.2.7 | R2 → R3 | untouched |
| rep1j | V1.1.1 | R3 → R4 | untouched |
| rep1j | V2.2.2 | R3 → R4 | untouched |
| rep1j | V2.2.7 | R3 → R4 | untouched |
| rep1j | V1.1.1 | R4 → R5 | build_failed |
| rep1j | V2.2.2 | R4 → R5 | build_failed |
| rep1j | V2.2.7 | R4 → R5 | build_failed |
| rep1j | V4.1.1 | R4 → R5 | build_failed |
| rep1j | V5.1.1 | R5 → R6 | fixed |
| rep1j | V5.1.2 | R5 → R6 | fixed |
| rep1j | V5.2.1 | R5 → R6 | fixed |
| rep1j | V5.2.2 | R5 → R6 | fixed |
| rep1j | V5.3.1 | R5 → R6 | fixed |
| rep1j | V5.3.2 | R5 → R6 | fixed |
| rep1k | V1.1.2 | R1 → R2 | untouched |
| rep1k | V1.1.9 | R1 → R2 | untouched |
| rep1k | V1.1.11 | R1 → R2 | untouched |
| rep1k | V1.1.12 | R1 → R2 | untouched |
| rep1k | V1.2.2 | R1 → R2 | fixed |
| rep1k | V1.3.1 | R1 → R2 | fixed |
| rep1k | V1.1.2 | R2 → R3 | untouched |
| rep1k | V1.1.9 | R2 → R3 | untouched |
| rep1k | V1.1.11 | R2 → R3 | untouched |
| rep1k | V1.1.12 | R2 → R3 | untouched |
| rep1k | V2.1.3 | R2 → R3 | untouched |
| rep1k | V2.1.4 | R2 → R3 | untouched |
| rep1k | V2.1.7 | R2 → R3 | untouched |
| rep1k | V2.1.8 | R2 → R3 | untouched |
| rep1k | V1.1.2 | R3 → R4 | untouched |
| rep1k | V1.1.9 | R3 → R4 | untouched |
| rep1k | V1.1.11 | R3 → R4 | untouched |
| rep1k | V1.1.12 | R3 → R4 | untouched |
| rep1k | V2.1.3 | R3 → R4 | untouched |
| rep1k | V2.1.4 | R3 → R4 | untouched |
| rep1k | V2.1.7 | R3 → R4 | untouched |
| rep1k | V2.1.8 | R3 → R4 | untouched |
| rep1k | V3.1.1 | R3 → R4 | untouched |
| rep1k | V3.1.5 | R3 → R4 | untouched |
| rep1k | V1.1.2 | R4 → R5 | build_failed |
| rep1k | V1.1.9 | R4 → R5 | untouched |
| rep1k | V1.1.12 | R4 → R5 | build_failed |
| rep1k | V2.1.3 | R4 → R5 | build_failed |
| rep1k | V2.1.4 | R4 → R5 | build_failed |
| rep1k | V2.1.7 | R4 → R5 | build_failed |
| rep1k | V2.1.8 | R4 → R5 | build_failed |
| rep1k | V3.1.1 | R4 → R5 | build_failed |
| rep1k | V3.1.5 | R4 → R5 | build_failed |
| rep1k | V4.2.1 | R4 → R5 | build_failed |
| rep1k | V4.2.2 | R4 → R5 | build_failed |
| rep1k | V4.2.3 | R4 → R5 | build_failed |
| rep1k | V1.1.9 | R5 → R6 | untouched |
| rep1k | G5 | R5 → R6 | fixed |
| rep1l | V1.1.5 | R1 → R2 | untouched |
| rep1l | V1.1.9 | R1 → R2 | fixed |
| rep1l | V1.2.1 | R1 → R2 | untouched |
| rep1l | V1.2.2 | R1 → R2 | untouched |
| rep1l | V1.2.3 | R1 → R2 | untouched |
| rep1l | V1.2.4 | R1 → R2 | fixed |
| rep1l | V1.3.1 | R1 → R2 | fixed |
| rep1l | V1.3.2 | R1 → R2 | fixed |
| rep1m | V1.1.3 | R1 → R2 | untouched |
| rep1m | V1.1.4 | R1 → R2 | untouched |
| rep1m | V1.1.7 | R1 → R2 | untouched |
| rep1m | V1.2.1 | R1 → R2 | untouched |
| rep1m | V1.2.2 | R1 → R2 | untouched |
| rep1m | V1.2.4 | R1 → R2 | untouched |
