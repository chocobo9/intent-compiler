# rep1p: IC against the control group, case by case at each round's end

Control: exp2-review15-luna56-low-revmed-rep1-dpipe-20261022, exp2-review15-luna56-low-revmed-rep2-dpipe-20261022.

## R1: A 17, B 19, C 1

- A by origin and requirement_ref: R1 pipeline 6; R1 transform.filter 4; R1 transform.sort 3; R1 transform.fill 2; R1 determinism 1; R1 transform.derive 1.
- A failing at first delivery, by kind: i 1, ii 14, iii 0, iv 0, other 2; A passing at first delivery (broken during the round): 0.
  - i: c112
  - ii: c020, c040, c041, c042, c062, c063, c081, c082, c083, c087, c088, c089, c099, c192
  - other: c212, c213
- A: c020, c040, c041, c042, c062, c063, c081, c082, c083, c087, c088, c089, c099, c112, c192, c212, c213
- B: c129, c130, c131, c132, c133, c134, c135, c136, c146, c147, c148, c149, c150, c151, c166, c171, c172, c173, c174
- C: c157

## R2: A 95, B 4, C 0

- A by origin and requirement_ref: R2 profile 37; R2 compare 26; R2 transform.split 9; R2 transform.bin 5; R2 transform.deduplicate 4; R1 transform.derive 3; R2 transform.detect 3; R2 transform.normalize 2; R1 pipeline 2; R1 transform.rename-drop 2; R2 transform.hash 1; R2 transform.encode 1.
- A failing at first delivery, by kind: i 3, ii 9, iii 27, iv 51, other 4; A passing at first delivery (broken during the round): 1.
  - i: c192, c308, c309
  - ii: c272, c273, c274, c306, c326, c335, c431, c432, c476
  - iii: c376, c377, c378, c379, c380, c381, c382, c384, c385, c386, c387, c388, c389, c397, c399, c400, c401, c402, c403, c404, c407, c463, c464, c466, c467, c469, c471
  - iv: c238, c239, c246, c247, c248, c249, c257, c261, c262, c264, c266, c267, c268, c283, c284, c285, c286, c287, c288, c289, c290, c291, c317, c318, c322, c323, c324, c351, c353, c355, c367, c416, c417, c418, c419, c420, c421, c422, c423, c424, c425, c426, c457, c458, c459, c460, c461, c472, c473, c474, c475
  - other: c371, c451, c453, c455
  - passing at first delivery: c470
- A: c192, c238, c239, c246, c247, c248, c249, c257, c261, c262, c264, c266, c267, c268, c272, c273, c274, c283, c284, c285, c286, c287, c288, c289, c290, c291, c306, c308, c309, c317, c318, c322, c323, c324, c326, c335, c351, c353, c355, c367, c371, c376, c377, c378, c379, c380, c381, c382, c384, c385, c386, c387, c388, c389, c397, c399, c400, c401, c402, c403, c404, c407, c416, c417, c418, c419, c420, c421, c422, c423, c424, c425, c426, c431, c432, c451, c453, c455, c457, c458, c459, c460, c461, c463, c464, c466, c467, c469, c470, c471, c472, c473, c474, c475, c476
- B: c133, c134, c171, c174
- C: none

## R3: A 25, B 0, C 0

- A by origin and requirement_ref: R2 profile 16; R2 transform.detect 3; R2 transform.bin 2; R2 compare 2; R1 transform.derive 1; R2 transform.hash 1.
- A failing at first delivery, by kind: i 7, ii 2, iii 0, iv 12, other 0; A passing at first delivery (broken during the round): 4.
  - i: c192, c371, c451, c453, c455, c460, c461
  - ii: c470, c471
  - iv: c257, c420, c421, c422, c423, c424, c425, c426, c472, c473, c474, c475
  - passing at first delivery: c254, c255, c256, c258
- A: c192, c254, c255, c256, c257, c258, c371, c420, c421, c422, c423, c424, c425, c426, c451, c453, c455, c460, c461, c470, c471, c472, c473, c474, c475
- B: none
- C: none

## R4: A 18, B 0, C 8

- A by origin and requirement_ref: R2 profile 11; R2 transform.detect 3; R2 compare 2; R1 transform.derive 1; R2 transform.hash 1.
- A failing at first delivery, by kind: i 5, ii 11, iii 0, iv 0, other 2; A passing at first delivery (broken during the round): 0.
  - i: c192, c371, c451, c453, c455
  - ii: c420, c421, c422, c423, c424, c425, c426, c472, c473, c474, c475
  - other: c470, c471
- A: c192, c371, c420, c421, c422, c423, c424, c425, c426, c451, c453, c455, c470, c471, c472, c473, c474, c475
- B: none
- C: c541, c547, c552, c555, c561, c568, c574, c637

## R5: A 19, B 0, C 13

- A by origin and requirement_ref: R2 profile 11; R2 transform.detect 3; R2 compare 2; R1 transform.derive 1; R2 transform.hash 1; R2 transform.bin 1.
- A failing at first delivery, by kind: i 18, ii 0, iii 0, iv 0, other 0; A passing at first delivery (broken during the round): 1.
  - i: c191, c370, c419, c420, c421, c422, c423, c424, c425, c450, c452, c454, c469, c470, c471, c472, c473, c474
  - passing at first delivery: c457
- A: c191, c370, c419, c420, c421, c422, c423, c424, c425, c450, c452, c454, c457, c469, c470, c471, c472, c473, c474
- B: none
- C: c092, c540, c546, c551, c554, c560, c566, c572, c635, c659, c660, c661, c662

## R6: A 27, B 0, C 13

- A by origin and requirement_ref: R2 profile 11; R1 ingest 8; R2 transform.detect 3; R2 compare 2; R1 transform.derive 1; R2 transform.hash 1; R2 transform.bin 1.
- A failing at first delivery, by kind: i 16, ii 0, iii 0, iv 0, other 3; A passing at first delivery (broken during the round): 8.
  - i: c191, c370, c419, c420, c421, c422, c423, c424, c425, c457, c469, c470, c471, c472, c473, c474
  - other: c450, c452, c454
  - passing at first delivery: c006, c012, c013, c015, c016, c018, c019, c118
- A: c006, c012, c013, c015, c016, c018, c019, c118, c191, c370, c419, c420, c421, c422, c423, c424, c425, c450, c452, c454, c457, c469, c470, c471, c472, c473, c474
- B: none
- C: c092, c540, c546, c551, c554, c560, c566, c572, c635, c659, c660, c661, c662

