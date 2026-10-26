# opusb3: the pre-registered table

## 1. Code

16 src commits from 2acfdba to d47ba26; behavioural batches: 1 (batch 1); untagged: 1.

- d47ba26 [untagged] —: Revert f0ccc81: the owed list keeps its grouped display tonight (Opus: the fixed parser reads all four forms; a display change adds a variable)
- 30ac888 [mech] batch 1: exp2 batch 1: the check writer's note on normalised unit ids says no 'hash' (neutral word list; abea6aa)
- f0ccc81 [mech] batch 1: exp2 batch 1: the review request lists the sentences owed by full id, one a line, and asks for full ids
- ea404cd [mech] batch 1: exp2 batch 1: COVERED ids as reviewers write them after the request's list (paragraph and part apart, bare parts)
- abea6aa [mech] batch 1: exp2 batch 1: a unit id with its paragraph's hash inside reads as the unit it names (opusb1 R1)
- 5f732a5 [behav] batch 1: exp2 batch 1, commit 2 supplements: regressions held as no progress counted apart; the reverted cycles replayed; 222 vs 131
- b5eb821 [behav] batch 1: exp2 batch 1: a COVERED guard needs two runs again alike (rule A); a run both covered and quoted in a deviation is a conflict
- a7badb5 [behav] batch 1: exp2 batch 1: a later review of the round reads only the scope sentences owed and those the last repair touched (DESIGN-OPUS 12)
- 318cfc7 [behav] batch 1: exp2 batch 1: another review on the same program only when the last reported no deviation (follows 2cf838f)
- 2cf838f [behav] batch 1: exp2 batch 1: COVERED lines become snapshot guards; reviews go on while scope sentences are owed (DESIGN-OPUS 11 item 1, effect 8)
- 4df94bb [behav] batch 1: exp2 batch 1: the reviewer's debt slice, its rotation, NOT BEHAVIOUR declarations (DESIGN-OPUS 3, 11 item 3)
- f4a5707 [behav] batch 1: exp2 batch 1: the delivery ledger; the package by recipient (DESIGN-OPUS 0a, decisions 3 and 4)
- 0f086d7 [mech] batch 1: exp2 batch 1: the verification state per sentence, pass-only coverage, the roles' wall time (reported only)
- 3129f3d [behav] batch 1: exp2 batch 1 (5A(a) + 5B test): no repair is reverted; a regression is an item with its material, counted
- 24b4409 [mech] batch 1: exp2 batch 1 (DESIGN-OPUS 11, decision B): units coarser than a sentence are admitted, counted, cover no sentence
- 529d983 [mech] —: exp2: 4202df4 on the rep1k line (2acfdba): an input path a runner cannot write is a format problem; one check's admission throwing fails that check only (NOTES change left out)

## 2. Closure in R1 and R2

| round | first delivery → end / cases | closure | line | |
|---|---|---|---|---|
| R1 | 106 → 180 / 219 | 65% | ≥ 52% | 过 |
| R2 | 233 → 274 / 481 | 17% | ≥ 81% | 不过 |

## 3. Ledger: cases failing at first delivery and at the round's end

| round | failing first and at the end | (i) op not named | (ii) untouched | (iii) fixed and lost | (iv) touched, not fixed | named, otherwise | largest |
|---|---|---|---|---|---|---|---|
| R1 | 34 | 0 | 0 | 3 | 31 | 0 | (iv) 31 |
| R2 | 205 | 15 | 137 | 0 | 44 | 9 | (ii) 137 |
| R3 | 66 | 18 | 19 | 0 | 19 | 10 | (ii) 19 |
| R4 | 43 | 12 | 20 | 7 | 0 | 4 | (ii) 20 |
| R5 | 40 | 17 | 3 | 0 | 8 | 12 | (i) 17 |
| R6 | 42 | 38 | 3 | 0 | 0 | 1 | (i) 38 |

## 4–6. Late scores, cost, interfaces

- 4. R5 640 (line ≥ 656): 不过; R6 663 (line ≥ 688): 不过.
- 5. R3–R6 review request characters 645,127 (line ≤ 598,799, rep1j): 不过.
- 6. Conservation errors 0; no_input by round 0, 1, 9, 6, 0, 0 (line 0 and ≤ 2 a round): 不过.

## 7. The batch's lines (none)

| line | value | |
|---|---|---|

## 8. The run

不过（见第 3 项）

<!-- prereg-data {"run":"opusb3","code":"d47ba26","closure":{"1":{"first":106,"end":180,"total":219,"rate":0.6548672566371682},"2":{"first":233,"end":274,"total":481,"rate":0.16532258064516128}},"ledger":{"1":{"i":0,"ii":0,"iii":3,"iv":31,"other":0},"2":{"i":15,"ii":137,"iii":0,"iv":44,"other":9},"3":{"i":18,"ii":19,"iii":0,"iv":19,"other":10},"4":{"i":12,"ii":20,"iii":7,"iv":0,"other":4},"5":{"i":17,"ii":3,"iii":0,"iv":8,"other":12},"6":{"i":38,"ii":3,"iii":0,"iv":0,"other":1}},"late":{"5":640,"6":663},"chars":645127,"lines":[]} -->
