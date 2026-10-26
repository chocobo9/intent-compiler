# Commit 2 supplement 1: the cycles the old rule reverted, under the new rule (no revert)

raised: guards that flipped on unchanged text (now regression items). Material: the four parts (id; text of the units; command and input files; expected values and the output of the guard run again on that cycle's build, in the run's docker image). Sent again: items the cycle had fixed that the next repair message would carry under the new rule. Ids: the run's guard ids G1..Gn with no gap.

| run | round | cycle (old: reverted to) | raised | material complete | missing | fixed on this build (lost before) | sent again now | ids continuous |
|---|---|---|---|---|---|---|---|---|
| rep1j | R1 | C1.3 (C1.2) | 1 | 1/1 | none | 3 | 0 | yes |
| rep1j | R1 | C1.4 (C1.2) | 1 | 1/1 | none | 12 | 0 | yes |
| rep1j | R5 | C5.3 (C5.2) | 1 | 1/1 | none | 2 | 0 | yes |
| rep1j | R5 | C5.4 (C5.2) | 1 | 1/1 | none | 4 | 0 | yes |
| rep1j | R5 | C5.5 (C5.2) | 1 | 1/1 | none | 4 | 0 | yes |
| rep1n | R5 | C5.4 (C5.3) | 2 | 2/2 | none | 2 | 0 | yes |
| rep1n | R5 | C5.5 (C5.3) | 2 | 2/2 | none | 2 | 0 | yes |
| rep1n | R6 | C6.2 (C6.1) | 2 | 2/2 | none | 2 | 0 | yes |
| rep1n | R6 | C6.4 (C6.3) | 2 | 2/2 | none | 2 | 0 | yes |
| rep1o | R1 | C1.4 (C1.3) | 8 | 8/8 | none | 6 | 0 | yes |
| rep1o | R2 | C2.3 (C2.2) | 2 | 2/2 | none | 4 | 0 | yes |
| rep1o | R2 | C2.4 (C2.2) | 3 | 3/3 | none | 6 | 0 | yes |
| rep1o | R3 | C3.2 (C3.1) | 1 | 1/1 | none | 12 | 0 | yes |
| rep1o | R3 | C3.3 (C3.1) | 1 | 1/1 | none | 20 | 0 | yes |
| rep1o | R3 | C3.4 (C3.1) | 1 | 1/1 | none | 16 | 0 | yes |
| rep1o | R4 | C4.2 (C4.1) | 2 | 2/2 | none | 31 | 0 | yes |
| rep1o | R4 | C4.3 (C4.1) | 2 | 2/2 | none | 34 | 0 | yes |
| rep1o | R4 | C4.4 (C4.1) | 1 | 1/1 | none | 7 | 0 | yes |
| rep1o | R5 | C5.3 (C5.2) | 2 | 2/2 | none | 12 | 0 | yes |
| rep1o | R5 | C5.4 (C5.2) | 2 | 2/2 | none | 12 | 0 | yes |
| rep1o | R6 | C6.2 (C6.1) | 1 | 1/1 | none | 6 | 0 | yes |
| rep1o | R6 | C6.3 (C6.1) | 4 | 4/4 | none | 9 | 0 | yes |
| rep1o | R6 | C6.4 (C6.1) | 6 | 6/6 | none | 8 | 0 | yes |
| rep1j3 | R3 | C3.2 (C3.1) | 1 | 1/1 | none | 6 | 0 | yes |

Total: 24 cycles; raised 50, material complete 50/50; items fixed on those builds 222, sent again under the new rule 0 (the build is kept, and they pass on it, as revert-cost.json ran them).
