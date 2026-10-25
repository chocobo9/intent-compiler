# R2 findings on R1 commands, and how their text came in the R2 package

| run | R2 findings | on R1 window/aggregate/join/pivot | cited units by role in the package | R1 cases failing at R2 end |
|---|---|---|---|---|
| rep1j | 17 | 5 | object view (this round) 15 | 1 |
| rep1k | 19 | 3 | open item 13 | 1 |
| rep1n | 19 | 3 | open item 7 | 16 |

## rep1j: 17 R2 findings, 5 on R1 window/aggregate/join/pivot

| item | disposition | command | cited units: role in the R2 package | text |
|---|---|---|---|---|
| V2.1.6 | blocked | pivot | R1.S3.P19.s4.c3: object view (this round); R1.S3.P19.s4.c4: object view (this round); R1.S3.P19.s5.c1: object view (this round) | **`pivot` does not preserve the first matching value when that value is empty.** Requirement: R1.S3.P19. Command: `dpipe-test.exe transform  |
| V2.1.7 | sent | window | R1.S3.P14.s9.c3: object view (this round); R1.S3.P14.s9.c4: object view (this round); R1.S3.P14.s9.c5: object view (this round) | **`ntile` assigns incorrect groups when `n` exceeds the partition size.** Requirement: R1.S3.P14. Command: `dpipe-test.exe transform --input |
| V2.2.2 | sent | aggregate | R1.S3.P9: object view (this round); R1.S3.P10.s1: object view (this round); R1.S3.P11.s5: object view (this round) | `aggregate` has no effect. |
| V2.3.1 | sent | pivot | R1.S3.P19.s4.c2: object view (this round); R1.S3.P19.s4.c4: object view (this round); R1.S3.P19.s4.c5: object view (this round) | Pivot first-match rule violated. Requirement R1.S3.P19: the first matching input row must supply the cell, including an empty value. Command |
| V2.3.2 | sent | pivot | R1.S3.P19.s8.c2: object view (this round); R1.S3.P19.s8.c3: object view (this round); R1.S3.P19.s8.c4: object view (this round) | Pivot missing-column error names the wrong column. Requirement R1.S3.P19: missing `value` must report `ERROR: invalid recipe: column missing |

R1 cases failing at R2's end: 1 (transform.derive 1).
R1 text in the R2 package, by role: object view (this round) 3, object view (edge) 3.

## rep1k: 19 R2 findings, 3 on R1 window/aggregate/join/pivot

| item | disposition | command | cited units: role in the R2 package | text |
|---|---|---|---|---|
| V2.1.9 | sent | window | R1.S3.P14.s9.c1: open item; R1.S3.P14.s9.c2: open item; R1.S3.P14.s9.c3: open item; R1.S3.P14.s9.c4: open item; R1.S3.P14.s9.c5: open item; R1.S3.P15.s1: open item; R1.S3.P15.s2: open item; R1.S3.P16.s1: open item | **`ntile` assigns incorrect groups when `n` exceeds row count.** Requirement: R1.S3.P14. Input `id,value\n1,2.0\n2,3.0\n`, recipe `ntile` wi |
| V2.1.10 | logged | window | R1.S3.P14.s5.c1: open item; R1.S3.P14.s5.c3: open item; R1.S3.P14.s5.c5: open item; R1.S3.P16.s2: open item | **`lag` does not apply required numeric formatting.** Requirement: R1.S3.P16. In the same window command, source value `2.0` produced lag ou |
| V2.3.4 | sent | window | R1.S3.P14.s9.c4: open item | **`ntile` assigns incorrect groups when `n` exceeds row count.** Requirement: first `k mod n` groups receive one row each. Command: `dpipe t |

R1 cases failing at R2's end: 1 (transform.derive 1).
R1 text in the R2 package, by role: revised 1, open item 8.

## rep1n: 19 R2 findings, 3 on R1 window/aggregate/join/pivot

| item | disposition | command | cited units: role in the R2 package | text |
|---|---|---|---|---|
| V2.2.3 | logged | aggregate | R1.S3.P9.s7: open item; R1.S3.P9.s9: open item | Aggregate empty numeric groups use `0` instead of `NaN`. |
| V2.2.4 | sent | aggregate | R1.S8.P1.s3.c2: open item; R1.S8.P1.s3.c3: open item; R1.S8.P1.s3.c4: open item | Aggregate does not reject missing referenced columns. |
| V2.3.1 | sent | window | R1.S3.P2: open item; R1.S3.P9: open item | Window rank ignores `order_by` when `column` is omitted. Requirement: rank rows using the specified ordering fields. Command: `dpipe transfo |

R1 cases failing at R2's end: 16 (transform.derive 1, transform.join 2, transform.window 11, transform.pivot 2).
R1 text in the R2 package, by role: open item 11.

