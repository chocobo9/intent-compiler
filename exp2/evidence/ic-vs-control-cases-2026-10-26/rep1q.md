# rep1q: IC against the control group, case by case at each round's end

Control: exp2-review15-luna56-low-revmed-rep1-dpipe-20261022, exp2-review15-luna56-low-revmed-rep2-dpipe-20261022.

## R1: A 7, B 8, C 12

- A by origin and requirement_ref: R1 ingest 4; R1 transform.pivot 2; R1 transform.window 1.
- A failing at first delivery, by kind: i 0, ii 4, iii 0, iv 1, other 2; A passing at first delivery (broken during the round): 0.
  - ii: c004, c009, c010, c124
  - iv: c165
  - other: c167, c169
- A: c004, c009, c010, c124, c165, c167, c169
- B: c129, c130, c131, c132, c135, c136, c151, c157
- C: c133, c134, c146, c147, c148, c149, c150, c166, c171, c172, c173, c174

## R2: A 81, B 3, C 1

- A by origin and requirement_ref: R2 profile 62; R1 transform.window 6; R2 compare 5; R1 ingest 4; R1 transform.pivot 2; R2 transform.deduplicate 2.
- A failing at first delivery, by kind: i 6, ii 75, iii 0, iv 0, other 0; A passing at first delivery (broken during the round): 0.
  - i: c004, c009, c010, c124, c169, c170
  - ii: c142, c143, c144, c145, c165, c166, c226, c227, c228, c229, c230, c231, c232, c234, c235, c236, c237, c238, c239, c244, c245, c246, c247, c248, c249, c251, c252, c257, c259, c260, c261, c262, c263, c264, c265, c266, c267, c268, c275, c276, c314, c315, c316, c317, c318, c321, c322, c323, c324, c351, c352, c353, c354, c355, c367, c390, c391, c392, c406, c412, c417, c418, c420, c421, c422, c423, c424, c425, c426, c427, c471, c472, c473, c474, c475
- A: c004, c009, c010, c124, c142, c143, c144, c145, c165, c166, c169, c170, c226, c227, c228, c229, c230, c231, c232, c234, c235, c236, c237, c238, c239, c244, c245, c246, c247, c248, c249, c251, c252, c257, c259, c260, c261, c262, c263, c264, c265, c266, c267, c268, c275, c276, c314, c315, c316, c317, c318, c321, c322, c323, c324, c351, c352, c353, c354, c355, c367, c390, c391, c392, c406, c412, c417, c418, c420, c421, c422, c423, c424, c425, c426, c427, c471, c472, c473, c474, c475
- B: c133, c134, c174
- C: c171

## R3: A 37, B 0, C 0

- A by origin and requirement_ref: R2 profile 17; R2 compare 5; R1 ingest 4; R1 transform.pivot 4; R2 transform.deduplicate 4; R1 transform.window 3.
- A failing at first delivery, by kind: i 15, ii 5, iii 0, iv 0, other 17; A passing at first delivery (broken during the round): 0.
  - i: c004, c009, c010, c124, c165, c166, c167, c168, c169, c170, c171, c275, c276, c277, c278
  - ii: c390, c391, c392, c406, c471
  - other: c411, c412, c414, c415, c417, c418, c420, c421, c422, c423, c424, c425, c426, c472, c473, c474, c475
- A: c004, c009, c010, c124, c165, c166, c167, c168, c169, c170, c171, c275, c276, c277, c278, c390, c391, c392, c406, c411, c412, c414, c415, c417, c418, c420, c421, c422, c423, c424, c425, c426, c471, c472, c473, c474, c475
- B: none
- C: none

## R4: A 33, B 0, C 8

- A by origin and requirement_ref: R2 profile 17; R2 compare 5; R1 transform.pivot 4; R2 transform.deduplicate 4; R1 transform.window 3.
- A failing at first delivery, by kind: i 28, ii 5, iii 0, iv 0, other 0; A passing at first delivery (broken during the round): 0.
  - i: c165, c166, c167, c168, c169, c170, c171, c275, c276, c277, c278, c411, c412, c414, c415, c417, c418, c420, c421, c422, c423, c424, c425, c426, c472, c473, c474, c475
  - ii: c390, c391, c392, c406, c471
- A: c165, c166, c167, c168, c169, c170, c171, c275, c276, c277, c278, c390, c391, c392, c406, c411, c412, c414, c415, c417, c418, c420, c421, c422, c423, c424, c425, c426, c471, c472, c473, c474, c475
- B: none
- C: c541, c547, c552, c555, c561, c568, c574, c637

## R5: A 37, B 0, C 13

- A by origin and requirement_ref: R2 profile 17; R2 compare 5; R1 transform.pivot 4; R2 transform.deduplicate 4; R3 drift 4; R1 transform.window 3.
- A failing at first delivery, by kind: i 25, ii 8, iii 0, iv 0, other 0; A passing at first delivery (broken during the round): 4.
  - i: c166, c167, c168, c169, c274, c275, c276, c277, c410, c411, c413, c414, c416, c417, c419, c420, c421, c422, c423, c424, c425, c471, c472, c473, c474
  - ii: c164, c165, c170, c389, c390, c391, c405, c470
  - passing at first delivery: c493, c494, c495, c496
- A: c164, c165, c166, c167, c168, c169, c170, c274, c275, c276, c277, c389, c390, c391, c405, c410, c411, c413, c414, c416, c417, c419, c420, c421, c422, c423, c424, c425, c470, c471, c472, c473, c474, c493, c494, c495, c496
- B: none
- C: c092, c540, c546, c551, c554, c560, c566, c572, c635, c659, c660, c661, c662

