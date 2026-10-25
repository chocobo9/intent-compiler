# rep1p: the ingest command's checks and guards

Object: O2 ingest.

## Checks on O2: 2

| check | round | admission | args | rests on | guard | its last status |
|---|---|---|---|---|---|---|
| K1 | R1 | admitted | ingest --input input.csv | R1.S2.P1, R1.S2.P2, R1.S2.P3, R1.S2.P4, R1.S2.P5, R1.S2.P6 | — | — |
| K47 | R5 | admitted | ingest --input data.csv | R1.S2.P1, R1.S2.P6, R5.S1.P2.s4, R5.S1.P2.s5, R5.S1.P3.s4 | G118 | passing (R5 C5.2) |

Guards born from review items on O2: 2 (G14 R1, last passing; G19 R1, last passing).

K1 is no guard. Library runs: R1 R1-final fail (disputed/reference); R2 R1-final fail (disputed/reference); R2 R2-final fail (disputed/reference); R3 R2-final fail (disputed/reference); R3 R3-final fail (disputed/reference); R4 R3-final fail (disputed/reference); R4 R4-final fail (disputed/reference); R5 R4-final fail (disputed/reference); R5 R5-final fail (not_landed/value_mismatch); R6 R5-final fail (not_landed/value_mismatch); R6 R6-final fail (not_landed/value_mismatch). On cycles: C1.1 fail (disputed/reference); C1.2 fail (disputed/reference); C1.3 fail (disputed/reference); C1.4 fail (disputed/reference); C2.1 fail (disputed/reference); C2.2 fail (disputed/reference); C2.3 fail (disputed/reference); C2.4 fail (disputed/reference); C3.1 fail (disputed/reference); C3.2 fail (disputed/reference); C3.3 fail (disputed/reference); C3.4 fail (disputed/reference); C4.1 fail (disputed/reference); C4.2 fail (disputed/reference); C4.3 fail (disputed/reference); C4.4 fail (disputed/reference); C5.2 fail (not_landed/value_mismatch); C5.3 fail (not_landed/value_mismatch); C5.4 fail (not_landed/value_mismatch); C6.1 fail (not_landed/value_mismatch); C6.2 fail (not_landed/value_mismatch); C6.3 fail (not_landed/value_mismatch); C6.4 fail (not_landed/value_mismatch). Events: none.

## R6's cycles: the ingest guards' runs

- C6.1: G14 pass, G19 pass, G118 pass
- C6.2: G14 pass, G19 pass, G118 pass
- C6.3: G14 pass, G19 pass, G118 pass
- C6.4: G14 pass, G19 pass, G118 pass

## R1 ingest sentences: 13; resting on no check or review guard: 0


## R6: R1 ingest cases failing at the end and not at first delivery: c006, c012, c013, c015, c016, c018, c019, c118

