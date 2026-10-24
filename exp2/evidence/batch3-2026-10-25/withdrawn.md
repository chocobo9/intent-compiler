# Checks written as withdrawn, read as stating the requirement (batch 3b)

| run | library checks | written as withdrawn | guards born from them |
|---|---|---|---|
| r1 | 30 | none | none |
| r1-rep1b | 20 | none | none |
| r1-rep1c | 21 | none | none |
| r1-rep1d | 21 | none | none |
| r1-rep1e | 22 | none | none |
| r1-rep1f | 13 | none | none |
| r1-rep1g | 13 | none | none |
| r1-rep1h | 42 | none | none |
| r3-rep1i | 46 | none | none |
| r6-rep1j | 48 | K37 | G57 from K37, born C5.2 |
| r6-rep1k | 63 | none | none |
| r6-rep1l | 36 | none | none |
| r6-rep1m | 33 | none | none |

## r6-rep1j: each cycle's program, the withdrawn checks as now read

| cycle | message | built | K37 now | recorded: guard born here | recorded: reverted, breaking guards |
|---|---|---|---|---|---|
| C5.1 | work | no | — |  |  |
| C5.2 | trial | yes | fail: exit=0, old_sidecar_removed=true (no) | G57 |  |
| C5.3 | repair | yes | pass: exit=0, old_sidecar_removed=false |  | G57 |
| C5.4 | repair | yes | pass: exit=0, old_sidecar_removed=false |  | G57 |
| C5.5 | repair | yes | pass: exit=0, old_sidecar_removed=false |  | G57 |
| C6.1 | work | yes | pass: exit=0, old_sidecar_removed=false |  |  |
| C6.2 | repair | yes | pass: exit=0, old_sidecar_removed=false |  |  |
| C6.3 | repair | yes | pass: exit=0, old_sidecar_removed=false |  |  |
