# rep1o: IC against the control group, case by case at each round's end

Control: exp2-review15-luna56-low-revmed-rep1-dpipe-20261022, exp2-review15-luna56-low-revmed-rep2-dpipe-20261022.

## R1: A 2, B 5, C 15

- A by origin and requirement_ref: R1 transform.derive 1; R1 transform.window 1.
- A failing at first delivery, by kind: i 0, ii 0, iii 0, iv 0, other 1; A passing at first delivery (broken during the round): 1.
  - other: c034
  - passing at first delivery: c165
- A: c034, c165
- B: c129, c130, c131, c133, c174
- C: c132, c134, c135, c136, c146, c147, c148, c149, c150, c151, c157, c166, c171, c172, c173

## R2: A 71, B 4, C 0

- A by origin and requirement_ref: R2 profile 30; R2 compare 19; R1 transform.fill 4; R2 transform.encode 4; R2 transform.normalize 3; R2 transform.deduplicate 2; R2 transform.split 2; R2 transform.assert 2; R1 transform.rename-drop 2; R1 transform.pivot 1; R1 error-handling 1; R1 transform.derive 1.
- A failing at first delivery, by kind: i 6, ii 0, iii 52, iv 0, other 13; A passing at first delivery (broken during the round): 0.
  - i: c157, c293, c362, c363, c364, c365
  - iii: c244, c245, c246, c247, c248, c249, c250, c251, c252, c257, c266, c267, c268, c318, c328, c329, c330, c367, c374, c375, c379, c380, c381, c383, c384, c385, c389, c391, c397, c400, c406, c409, c410, c412, c417, c418, c420, c421, c422, c423, c424, c425, c426, c427, c464, c465, c467, c471, c472, c473, c474, c475
  - other: c276, c279, c286, c287, c297, c298, c358, c431, c432, c434, c435, c436, c476
- A: c157, c244, c245, c246, c247, c248, c249, c250, c251, c252, c257, c266, c267, c268, c276, c279, c286, c287, c293, c297, c298, c318, c328, c329, c330, c358, c362, c363, c364, c365, c367, c374, c375, c379, c380, c381, c383, c384, c385, c389, c391, c397, c400, c406, c409, c410, c412, c417, c418, c420, c421, c422, c423, c424, c425, c426, c427, c431, c432, c434, c435, c436, c464, c465, c467, c471, c472, c473, c474, c475, c476
- B: c133, c134, c171, c174
- C: none

## R3: A 126, B 0, C 0

- A by origin and requirement_ref: R2 profile 89; R1 transform.sample 13; R3 drift 9; R1 pipeline 4; R1 transform.rename-drop 3; R2 transform.encode 3; R2 transform.normalize 2; R1 transform.pivot 1; R1 error-handling 1; R2 transform.assert 1.
- A failing at first delivery, by kind: i 5, ii 0, iii 118, iv 0, other 3; A passing at first delivery (broken during the round): 0.
  - i: c157, c293, c428, c429, c430
  - iii: c220, c221, c222, c223, c224, c225, c226, c227, c228, c229, c230, c231, c232, c233, c234, c235, c236, c237, c238, c239, c240, c241, c242, c243, c244, c245, c246, c247, c248, c249, c250, c251, c252, c253, c254, c255, c256, c257, c258, c259, c260, c261, c262, c263, c264, c298, c300, c301, c302, c303, c312, c313, c314, c315, c316, c317, c318, c320, c321, c322, c323, c324, c331, c332, c351, c352, c353, c354, c355, c366, c367, c411, c412, c413, c414, c415, c416, c417, c418, c419, c420, c421, c422, c423, c424, c425, c426, c427, c472, c473, c474, c475, c487, c488, c489, c490, c493, c498, c499, c501, c506, c507, c508, c509, c510, c511, c512, c513, c521, c522, c523, c524, c525, c526, c527, c528, c529, c532
  - other: c434, c435, c436
- A: c157, c220, c221, c222, c223, c224, c225, c226, c227, c228, c229, c230, c231, c232, c233, c234, c235, c236, c237, c238, c239, c240, c241, c242, c243, c244, c245, c246, c247, c248, c249, c250, c251, c252, c253, c254, c255, c256, c257, c258, c259, c260, c261, c262, c263, c264, c293, c298, c300, c301, c302, c303, c312, c313, c314, c315, c316, c317, c318, c320, c321, c322, c323, c324, c331, c332, c351, c352, c353, c354, c355, c366, c367, c411, c412, c413, c414, c415, c416, c417, c418, c419, c420, c421, c422, c423, c424, c425, c426, c427, c428, c429, c430, c434, c435, c436, c472, c473, c474, c475, c487, c488, c489, c490, c493, c498, c499, c501, c506, c507, c508, c509, c510, c511, c512, c513, c521, c522, c523, c524, c525, c526, c527, c528, c529, c532
- B: none
- C: none

## R4: A 34, B 8, C 0

- A by origin and requirement_ref: R1 transform.sample 13; R3 drift 9; R1 transform.window 3; R1 transform.rename-drop 3; R2 transform.encode 3; R1 transform.pivot 1; R1 error-handling 1; R4 validate 1.
- A failing at first delivery, by kind: i 15, ii 0, iii 16, iv 0, other 3; A passing at first delivery (broken during the round): 0.
  - i: c157, c293, c506, c507, c508, c509, c510, c511, c512, c513, c525, c526, c527, c528, c529
  - iii: c146, c147, c148, c434, c435, c436, c493, c498, c499, c501, c521, c522, c523, c524, c532, c580
  - other: c428, c429, c430
- A: c146, c147, c148, c157, c293, c428, c429, c430, c434, c435, c436, c493, c498, c499, c501, c506, c507, c508, c509, c510, c511, c512, c513, c521, c522, c523, c524, c525, c526, c527, c528, c529, c532, c580
- B: c541, c547, c552, c555, c561, c568, c574, c637
- C: none

## R5: A 6, B 8, C 5

- A by origin and requirement_ref: R2 transform.bin 2; R2 profile 2; R1 transform.pivot 1; R3 drift 1.
- A failing at first delivery, by kind: i 3, ii 0, iii 1, iv 0, other 0; A passing at first delivery (broken during the round): 2.
  - i: c156, c486, c487
  - iii: c532
  - passing at first delivery: c459, c460
- A: c156, c459, c460, c486, c487, c532
- B: c540, c546, c551, c554, c560, c566, c572, c635
- C: c092, c659, c660, c661, c662

## R6: A 6, B 8, C 5

- A by origin and requirement_ref: R2 transform.bin 2; R2 profile 2; R1 transform.pivot 1; R3 drift 1.
- A failing at first delivery, by kind: i 1, ii 0, iii 2, iv 0, other 3; A passing at first delivery (broken during the round): 0.
  - i: c156
  - iii: c486, c487
  - other: c459, c460, c532
- A: c156, c459, c460, c486, c487, c532
- B: c540, c546, c551, c554, c560, c566, c572, c635
- C: c092, c659, c660, c661, c662

