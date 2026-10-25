# rep1j review items outside the new package and lists: what dropping them could cost

| item | round | requirement_ref | sent | fixed in the run | its cases failing at first delivery | failing at the end | failing first, passing at the end |
|---|---|---|---|---|---|---|---|
| V2.2.3 | R2 | R1 transform.filter | yes (sent) | yes (G27) | 0 | 0 | 0 |
| V2.2.7 | R2 | R1 ingest | yes (sent) | no | 0 | 0 | 0 |
| V2.2.8 | R2 | R1 transform.pivot | yes (sent) | yes (G30) | 0 | 0 | 0 |
| V3.2.1 | R3 | R2 transform.normalize | yes (logged) | yes | 0 | 0 | 0 |
| V4.2.2 | R4 | R2 transform.bin | yes (sent) | yes (G54) | 0 | 0 | 0 |
| V5.3.3 | R5 | R4 validate | no (blocked) | yes | 0 | 0 | 0 |

Cases failing at first delivery and passing at the end, on these items' requirement_refs: 0 (an upper bound: other items and the executor's own work act on the same refs).
