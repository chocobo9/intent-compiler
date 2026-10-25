# rep1k: IC against the control group, case by case at each round's end

Control: exp2-review15-luna56-low-revmed-rep1-dpipe-20261022, exp2-review15-luna56-low-revmed-rep2-dpipe-20261022.

## R1: A 0, B 7, C 13

- A by origin and requirement_ref: none.
- A failing at first delivery, by kind: i 0, ii 0, iii 0, iv 0, other 0; A passing at first delivery (broken during the round): 0.
- A: none
- B: c129, c130, c131, c133, c157, c166, c174
- C: c132, c134, c135, c136, c146, c147, c148, c149, c150, c151, c171, c172, c173

## R2: A 5, B 4, C 0

- A by origin and requirement_ref: R2 transform.bin 5.
- A failing at first delivery, by kind: i 0, ii 5, iii 0, iv 0, other 0; A passing at first delivery (broken during the round): 0.
  - ii: c457, c458, c459, c460, c461
- A: c457, c458, c459, c460, c461
- B: c133, c134, c171, c174
- C: none

## R3: A 0, B 0, C 0

- A by origin and requirement_ref: none.
- A failing at first delivery, by kind: i 0, ii 0, iii 0, iv 0, other 0; A passing at first delivery (broken during the round): 0.
- A: none
- B: none
- C: none

## R4: A 0, B 0, C 8

- A by origin and requirement_ref: none.
- A failing at first delivery, by kind: i 0, ii 0, iii 0, iv 0, other 0; A passing at first delivery (broken during the round): 0.
- A: none
- B: none
- C: c541, c547, c552, c555, c561, c568, c574, c637

## R5: A 0, B 0, C 13

- A by origin and requirement_ref: none.
- A failing at first delivery, by kind: i 0, ii 0, iii 0, iv 0, other 0; A passing at first delivery (broken during the round): 0.
- A: none
- B: none
- C: c092, c540, c546, c551, c554, c560, c566, c572, c635, c659, c660, c661, c662

## R6: A 4, B 0, C 13

- A by origin and requirement_ref: R1 ingest 2; R1 determinism 2.
- A failing at first delivery, by kind: i 2, ii 1, iii 0, iv 0, other 0; A passing at first delivery (broken during the round): 1.
  - i: c111, c668
  - ii: c005
  - passing at first delivery: c008
- A: c005, c008, c111, c668
- B: none
- C: c092, c540, c546, c551, c554, c560, c566, c572, c635, c659, c660, c661, c662

