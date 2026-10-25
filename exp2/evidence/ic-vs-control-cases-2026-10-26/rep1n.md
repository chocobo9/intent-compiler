# rep1n: IC against the control group, case by case at each round's end

Control: exp2-review15-luna56-low-revmed-rep1-dpipe-20261022, exp2-review15-luna56-low-revmed-rep2-dpipe-20261022.

## R1: A 15, B 1, C 19

- A by origin and requirement_ref: R1 transform.fill 10; R1 pipeline 2; R1 transform.join 1; R1 transform.pivot 1; R1 transform.derive 1.
- A failing at first delivery, by kind: i 0, ii 0, iii 0, iv 11, other 0; A passing at first delivery (broken during the round): 4.
  - iv: c198, c206, c207, c208, c209, c210, c211, c212, c213, c214, c215
  - passing at first delivery: c064, c079, c100, c169
- A: c064, c079, c100, c169, c198, c206, c207, c208, c209, c210, c211, c212, c213, c214, c215
- B: c157
- C: c129, c130, c131, c132, c133, c134, c135, c136, c146, c147, c148, c149, c150, c151, c166, c171, c172, c173, c174

## R2: A 11, B 0, C 4

- A by origin and requirement_ref: R1 transform.window 7; R1 transform.join 2; R1 transform.pivot 2.
- A failing at first delivery, by kind: i 4, ii 0, iii 0, iv 0, other 7; A passing at first delivery (broken during the round): 0.
  - i: c079, c080, c169, c170
  - other: c137, c138, c139, c140, c141, c144, c145
- A: c079, c080, c137, c138, c139, c140, c141, c144, c145, c169, c170
- B: none
- C: c133, c134, c171, c174

## R3: A 15, B 0, C 0

- A by origin and requirement_ref: R1 transform.window 11; R1 transform.join 2; R1 transform.pivot 2.
- A failing at first delivery, by kind: i 15, ii 0, iii 0, iv 0, other 0; A passing at first delivery (broken during the round): 0.
  - i: c079, c080, c133, c134, c137, c138, c139, c140, c141, c144, c145, c169, c170, c171, c174
- A: c079, c080, c133, c134, c137, c138, c139, c140, c141, c144, c145, c169, c170, c171, c174
- B: none
- C: none

## R4: A 15, B 8, C 0

- A by origin and requirement_ref: R1 transform.window 11; R1 transform.join 2; R1 transform.pivot 2.
- A failing at first delivery, by kind: i 15, ii 0, iii 0, iv 0, other 0; A passing at first delivery (broken during the round): 0.
  - i: c079, c080, c133, c134, c137, c138, c139, c140, c141, c144, c145, c169, c170, c171, c174
- A: c079, c080, c133, c134, c137, c138, c139, c140, c141, c144, c145, c169, c170, c171, c174
- B: c541, c547, c552, c555, c561, c568, c574, c637
- C: none

## R5: A 15, B 8, C 5

- A by origin and requirement_ref: R1 transform.window 11; R1 transform.join 2; R1 transform.pivot 2.
- A failing at first delivery, by kind: i 15, ii 0, iii 0, iv 0, other 0; A passing at first delivery (broken during the round): 0.
  - i: c078, c079, c132, c133, c136, c137, c138, c139, c140, c143, c144, c168, c169, c170, c173
- A: c078, c079, c132, c133, c136, c137, c138, c139, c140, c143, c144, c168, c169, c170, c173
- B: c540, c546, c551, c554, c560, c566, c572, c635
- C: c092, c659, c660, c661, c662

## R6: A 18, B 8, C 5

- A by origin and requirement_ref: R1 transform.window 11; R1 transform.join 2; R1 determinism 2; R1 transform.pivot 2; R1 ingest 1.
- A failing at first delivery, by kind: i 18, ii 0, iii 0, iv 0, other 0; A passing at first delivery (broken during the round): 0.
  - i: c005, c078, c079, c111, c132, c133, c136, c137, c138, c139, c140, c143, c144, c168, c169, c170, c173, c668
- A: c005, c078, c079, c111, c132, c133, c136, c137, c138, c139, c140, c143, c144, c168, c169, c170, c173, c668
- B: c540, c546, c551, c554, c560, c566, c572, c635
- C: c092, c659, c660, c661, c662

