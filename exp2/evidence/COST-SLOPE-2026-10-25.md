# Non-executor cost vs accumulated requirement text (2026-10-25 night)

Cost per round = uncached input + 0.1 × cache read + output over non-executor roles (control: reviewer only). x = cumulative text chars of rounds 1..n. Slope in tokens per 1k chars.

| run | rounds | intercept (k tokens) | slope (tokens / 1k chars) | per-round costs (k) |
|---|---|---|---|---|
| exp2-review15-luna56-low-revmed-rep1 | 15 | 215 | 7969.5 | 243, 578, 531, 819, 756, 824, 879, 860, 777, 994, 799, 758, 682, 789, 949 |
| exp2-review15-luna56-low-revmed-rep2 | 15 | 496 | 1881.7 | 380, 569, 552, 598, 693, 789, 794, 446, 815, 565, 751, 1030, 729, 284, 337 |
| IC all-scope (ic15, fe6562d) | 3 | 379 | 5626.6 | 491, 603, 691 |
| IC delta (rep1h, 00a0a7f) | 3 | 278 | 10203.2 | 487, 658, 862 |
| control eventq (exec medium, so far) | 4 | 226 | 3892.6 | 288, 333, 494, 467 |

Reading: a positive slope means cost grows with accumulated text. The pre-registered claim is that IC (delta) has a lower slope than the control; three rounds are too few for the IC lines, so their slopes are indicative only.