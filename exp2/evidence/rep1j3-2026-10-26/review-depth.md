# rep1j3 beside rep1j: tokens by role, review depth, review ends, failing cases

## (1) Tokens by role: calls / uncached input / cache read / output (uncached + 0.1 × cache read + output)

| run | round | reviewer | formalizer | attribution | checks |
|---|---|---|---|---|---|
| rep1j3 | R1 | 3 / 137,110 / 2,720,384 / 16,869 (426,017) | 3 / 41,720 / 11,008 / 9,687 (52,508) | 1 / 14,200 / 0 / 1,868 (16,068) | 3 / 32,091 / 29,696 / 14,703 (49,764) |
| rep1j3 | R2 | 3 / 171,989 / 2,135,040 / 10,635 (396,128) | 5 / 113,695 / 22,016 / 15,008 (130,905) | 1 / 28,843 / 0 / 1,149 (29,992) | 3 / 41,005 / 61,312 / 19,425 (66,561) |
| rep1j3 | R3 | 3 / 172,662 / 2,467,072 / 13,865 (433,234) | 4 / 67,404 / 22,016 / 12,180 (81,786) | 2 / 34,970 / 33,280 / 1,192 (39,490) | 2 / 65,867 / 5,248 / 6,791 (73,183) |
| rep1j3 | R4 | 3 / 137,769 / 1,487,744 / 9,108 (295,651) | 4 / 25,931 / 22,016 / 4,777 (32,910) | 1 / 31,512 / 5,120 / 438 (32,462) | 3 / 37,557 / 76,672 / 7,487 (52,711) |
| rep1j3 | R5 | 1 / 62,293 / 1,004,160 / 5,165 (167,874) | 1 / 6,951 / 5,504 / 20 (7,521) | 3 / 37,502 / 83,200 / 1,726 (47,548) | 3 / 43,744 / 83,072 / 9,538 (61,589) |
| rep1j3 | R6 | 1 / 36,870 / 671,744 / 4,581 (108,625) | 1 / 5,015 / 5,504 / 637 (6,202) | 1 / 36,090 / 5,120 / 418 (37,020) | 3 / 40,457 / 85,376 / 5,287 (54,282) |
| rep1j | R1 | 3 / 143,446 / 1,556,096 / 13,244 (312,300) | 4 / 55,800 / 16,512 / 13,791 (71,242) | 1 / 14,199 / 0 / 518 (14,717) | 3 / 25,822 / 28,160 / 9,355 (37,993) |
| rep1j | R2 | 3 / 247,696 / 3,197,568 / 12,726 (580,179) | 4 / 70,993 / 44,928 / 9,901 (85,387) | 2 / 24,951 / 33,280 / 1,292 (29,571) | 3 / 39,460 / 56,064 / 9,621 (54,687) |
| rep1j | R3 | 3 / 202,299 / 3,326,720 / 12,823 (547,794) | 3 / 82,117 / 11,008 / 2,280 (85,498) | 1 / 27,985 / 5,120 / 767 (29,264) | 3 / 39,549 / 71,808 / 9,875 (56,605) |
| rep1j | R4 | 3 / 182,027 / 2,890,496 / 8,287 (479,364) | 5 / 112,195 / 27,520 / 6,354 (121,301) | 1 / 36,048 / 0 / 377 (36,425) | 3 / 82,129 / 36,096 / 10,610 (96,349) |
| rep1j | R5 | 3 / 212,816 / 3,772,160 / 12,901 (602,933) | 4 / 94,805 / 22,016 / 6,750 (103,757) | 2 / 35,200 / 43,520 / 1,479 (41,031) | 3 / 45,570 / 84,096 / 10,366 (64,346) |
| rep1j | R6 | 2 / 118,543 / 1,707,264 / 7,467 (296,736) | 2 / 52,582 / 11,008 / 3,112 (56,795) | 1 / 35,513 / 5,120 / 491 (36,516) | 3 / 45,197 / 86,912 / 9,734 (63,622) |

## (2) Review depth

| run | round | reviews | review calls | reviewer turns: messages / tool calls | program runs | findings reported / sent | repair cycles | how each review ended |
|---|---|---|---|---|---|---|---|---|
| rep1j3 | R1 | 3 | 3 | 83 / 153 | 51 | 20 / 20 | 3 | V1.1 on C1.1: 9 found, 9 sent, V1.2 on C1.2: 6 found, 6 sent, V1.3 on C1.3: 5 found, 5 sent |
| rep1j3 | R2 | 3 | 3 | 51 / 90 | 34 | 14 / 13 | 3 | V2.1 on C2.1: 8 found, 8 sent, V2.2 on C2.2: 3 found, 3 sent, V2.3 on C2.3: 3 found, 2 sent |
| rep1j3 | R3 | 3 | 3 | 60 / 122 | 46 | 15 / 15 | 3 | V3.1 on C3.1: 6 found, 6 sent, V3.2 on C3.1: 6 found, 6 sent, V3.3 on C3.3: 3 found, 3 sent |
| rep1j3 | R4 | 3 | 3 | 52 / 86 | 21 | 4 / 4 | 3 | V4.1 on C4.1: 1 found, 1 sent, V4.2 on C4.2: 2 found, 2 sent, V4.3 on C4.3: 1 found, 1 sent |
| rep1j3 | R5 | 1 | 1 | 23 / 37 | 10 | 0 / 0 | 1 | V5.1 on C5.2: empty list |
| rep1j3 | R6 | 1 | 1 | 25 / 49 | 18 | 1 / 0 | 0 | V6.1 on C6.1: 1 found, 0 sent |
| rep1j | R1 | 3 | 3 | 58 / 103 | 50 | 21 / 21 | 3 | V1.1 on C1.1: 9 found, 9 sent, V1.2 on C1.2: 4 found, 4 sent, V1.3 on C1.2: 8 found, 8 sent |
| rep1j | R2 | 3 | 3 | 68 / 101 | 34 | 17 / 16 | 3 | V2.1 on C2.1: 7 found, 6 sent, V2.2 on C2.2: 8 found, 8 sent, V2.3 on C2.3: 2 found, 2 sent |
| rep1j | R3 | 3 | 3 | 66 / 110 | 37 | 4 / 4 | 3 | V3.1 on C3.1: 1 found, 1 sent, V3.2 on C3.2: 1 found, 1 sent, V3.3 on C3.3: 2 found, 2 sent |
| rep1j | R4 | 3 | 3 | 63 / 81 | 10 | 6 / 4 | 3 | V4.1 on C4.1: 3 found, 1 sent, V4.2 on C4.2: 2 found, 2 sent, V4.3 on C4.3: 1 found, 1 sent |
| rep1j | R5 | 3 | 3 | 74 / 118 | 32 | 9 / 6 | 4 | V5.1 on C5.2: 3 found, 2 sent, V5.2 on C5.2: 3 found, 2 sent, V5.3 on C5.2: 3 found, 2 sent |
| rep1j | R6 | 2 | 2 | 40 / 68 | 17 | 3 / 3 | 2 | V6.1 on C6.1: 3 found, 3 sent, V6.2 on C6.2: NO ISSUES |

## (3) and (4) Reviews voided or cut short; official cases failing at the round's end

| run | round | voided | attempts beyond the first | review calls not valid | review calls with an error | round status | official cases failing at the end |
|---|---|---|---|---|---|---|---|
| rep1j3 | R1 | 0 | 0 | 0 | 0 | cycles_spent | 10 |
| rep1j3 | R2 | 0 | 0 | 0 | 0 | done | 4 |
| rep1j3 | R3 | 0 | 0 | 0 | 0 | done | 5 |
| rep1j3 | R4 | 0 | 0 | 0 | 0 | done | 13 |
| rep1j3 | R5 | 0 | 0 | 0 | 0 | done | 18 |
| rep1j3 | R6 | 0 | 0 | 0 | 0 | done | 18 |
| rep1j | R1 | 0 | 0 | 0 | 0 | cycles_spent | 42 |
| rep1j | R2 | 0 | 0 | 0 | 0 | done | 1 |
| rep1j | R3 | 0 | 0 | 0 | 0 | done | 1 |
| rep1j | R4 | 0 | 0 | 0 | 0 | done | 1 |
| rep1j | R5 | 0 | 0 | 0 | 0 | cycles_spent | 7 |
| rep1j | R6 | 0 | 0 | 0 | 0 | done | 6 |

