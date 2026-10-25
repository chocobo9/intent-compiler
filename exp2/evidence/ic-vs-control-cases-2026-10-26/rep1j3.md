# rep1j3: IC against the control group, case by case at each round's end

Control: exp2-review15-luna56-low-revmed-rep1-dpipe-20261022, exp2-review15-luna56-low-revmed-rep2-dpipe-20261022.

## R1: A 2, B 20, C 0

- A by origin and requirement_ref: R1 transform.fill 2.
- A failing at first delivery, by kind: i 0, ii 0, iii 0, iv 0, other 0; A passing at first delivery (broken during the round): 2.
  - passing at first delivery: c212, c213
- A: c212, c213
- B: c129, c130, c131, c132, c133, c134, c135, c136, c146, c147, c148, c149, c150, c151, c157, c166, c171, c172, c173, c174
- C: none

## R2: A 3, B 4, C 0

- A by origin and requirement_ref: R1 transform.fill 2; R2 transform.detect 1.
- A failing at first delivery, by kind: i 2, ii 0, iii 0, iv 0, other 1; A passing at first delivery (broken during the round): 0.
  - i: c212, c213
  - other: c453
- A: c212, c213, c453
- B: c133, c134, c171, c174
- C: none

## R3: A 4, B 0, C 0

- A by origin and requirement_ref: R1 transform.fill 2; R1 pipeline 1; R2 transform.detect 1.
- A failing at first delivery, by kind: i 3, ii 0, iii 0, iv 0, other 0; A passing at first delivery (broken during the round): 1.
  - i: c212, c213, c453
  - passing at first delivery: c065
- A: c065, c212, c213, c453
- B: none
- C: none

## R4: A 4, B 0, C 8

- A by origin and requirement_ref: R1 transform.fill 2; R1 pipeline 1; R2 transform.detect 1.
- A failing at first delivery, by kind: i 4, ii 0, iii 0, iv 0, other 0; A passing at first delivery (broken during the round): 0.
  - i: c065, c212, c213, c453
- A: c065, c212, c213, c453
- B: none
- C: c541, c547, c552, c555, c561, c568, c574, c637

## R5: A 4, B 0, C 13

- A by origin and requirement_ref: R1 transform.fill 2; R1 pipeline 1; R2 transform.detect 1.
- A failing at first delivery, by kind: i 4, ii 0, iii 0, iv 0, other 0; A passing at first delivery (broken during the round): 0.
  - i: c065, c211, c212, c452
- A: c065, c211, c212, c452
- B: none
- C: c092, c540, c546, c551, c554, c560, c566, c572, c635, c659, c660, c661, c662

## R6: A 4, B 0, C 13

- A by origin and requirement_ref: R1 transform.fill 2; R1 pipeline 1; R2 transform.detect 1.
- A failing at first delivery, by kind: i 4, ii 0, iii 0, iv 0, other 0; A passing at first delivery (broken during the round): 0.
  - i: c065, c211, c212, c452
- A: c065, c211, c212, c452
- B: none
- C: c092, c540, c546, c551, c554, c560, c566, c572, c635, c659, c660, c661, c662

