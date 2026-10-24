| round | official (base) | unchanged-text flips (base) | reviews: survivors per review (base) | review request chars (base, change) | formalizer uncached (base, change) | reviewer uncached (base) | conservation errors / no_input | package chars (base) | dropped by the budget |
|---|---|---|---|---|---|---|---|---|---|
| R1 | 196 (177) | 0  (2 G3) | 3: 12,9,5 (3: 9,4,8) | 82442 (74956, 10%) | 47557 (55800, -15%) | 141438 (143446) | 0 / 0 | 23318 (22490) | none |
| R2 | 474 (480) | 0  (0 ) | 3: 10,4,5 (3: 6,8,2) | 125458 (163604, -23%) | 81976 (70993, 15%) | 171728 (247696) | 0 / 0 | 38779 (48781) | none |
| R3 | 534 (534) | 0  (0 ) | 3: 5,2,1 (3: 1,1,2) | 82806 (172470, -52%) | 47911 (82117, -42%) | 158146 (202299) | 0 / 0 | 24127 (54789) | none |
| R4 | 630 (638) | 0  (0 ) | 3: 6,3,1 (3: 1,2,1) | 49332 (147030, -66%) | 50094 (112195, -55%) | 180745 (182027) | 0 / 0 | 14219 (45653) | none |
| R5 | 666 (673) | 1 G5 (3 G57) | 2: 1,0 (3: 2,2,2) | 50319 (159307, -68%) | 10153 (94805, -89%) | 117391 (212816) | 0 / 0 | 19262 (50263) | none |
| R6 | 698 (710) | 0  (1 G57) | 3: 4,2,1 (2: 3,0) | 71927 (119992, -40%) | 52300 (52582, -1%) | 187756 (118543) | 0 / 0 | 20694 (55086) | none |
{
 "ingest": [
  {
   "round": 1,
   "items": [
    "V1.1.9 sent: Ingest validation order is wrong.",
    "V1.2.6 sent: Ingest primary-key sorting ignores the declared string type. Requirement: sort each primary-key column using its declare",
    "V1.3.5 logged: Datetime primary-key sorting is lexicographic, not chronological. Requirement: datetime keys must sort chronologically. "
   ]
  },
  {
   "round": 2,
   "items": []
  },
  {
   "round": 3,
   "items": []
  },
  {
   "round": 4,
   "items": []
  },
  {
   "round": 5,
   "items": []
  },
  {
   "round": 6,
   "items": [
    "V6.1.2 sent: **Ingest uniqueness:** R1.S2.P4 requires duplicate valid rows to be rejected during uniqueness checking. Command: `dpipe"
   ]
  }
 ],
 "base_ingest_r2": [
  "V2.2.7 sent: Rejected ingest rows incorrectly affect uniqueness tracking."
 ]
}
