# Repair decisions replayed (batch 3a)

The new rule on the sightings the runs recorded (decisions only; see the script's header).

| run | round | sightings | old: held for no progress (of them untouched) | items held so (untouched) | of them in an untouched message under the new rule | new: untouched messages (items) | new: held after the resend | new: held for no progress | new: to the reviewer | reverted sightings | fixed (old = new) |
|---|---|---|---|---|---|---|---|---|---|---|---|
| rep1j | 1 | 52 | 0 (0) | 0 | 0 | 0 (0) | 0 | 0 | reverted_twice 7 | 22 | 6 = 6 |
| rep1j | 2 | 60 | 17 (17) | 8 | 8 | 4 (8) | 9 | 0 | 0 | 0 | 20 = 20 |
| rep1j | 3 | 28 | 18 (18) | 5 | 5 | 1 (5) | 13 | 0 | 0 | 0 | 7 = 7 |
| rep1j | 4 | 20 | 14 (14) | 4 | 4 | 2 (4) | 10 | 0 | 0 | 0 | 2 = 2 |
| rep1j | 5 | 20 | 4 (4) | 4 | 4 | 1 (4) | 0 | 0 | reverted_twice 4 | 10 | 0 = 0 |
| rep1j | 6 | 28 | 15 (15) | 6 | 6 | 3 (6) | 9 | 0 | 0 | 0 | 8 = 8 |
| rep1k | 1 | 64 | 10 (9) | 6 | 6 | 3 (6) | 3 | 0 | touched_twice 1 | 0 | 19 = 19 |
| rep1k | 2 | 67 | 26 (26) | 9 | 9 | 3 (9) | 17 | 0 | 0 | 0 | 17 = 17 |
| rep1k | 3 | 53 | 36 (36) | 11 | 11 | 2 (11) | 25 | 0 | 0 | 0 | 6 = 6 |
| rep1k | 4 | 65 | 46 (46) | 13 | 13 | 2 (13) | 33 | 0 | 0 | 0 | 7 = 7 |
| rep1k | 5 | 41 | 36 (35) | 12 | 12 | 2 (12) | 23 | 0 | touched_twice 1 | 0 | 1 = 1 |
| rep1k | 6 | 61 | 52 (52) | 14 | 14 | 2 (14) | 38 | 0 | 0 | 0 | 2 = 2 |
| rep1l | 1 | 38 | 16 (16) | 8 | 8 | 3 (8) | 8 | 0 | 0 | 0 | 6 = 6 |
| rep1l | 2 | 90 | 42 (42) | 18 | 18 | 4 (18) | 24 | 0 | touched_twice 1 | 0 | 14 = 14 |
| rep1m | 1 | 37 | 12 (12) | 6 | 6 | 2 (6) | 6 | 0 | 0 | 0 | 8 = 8 |
| rep1m | 2 | 82 | 32 (32) | 15 | 15 | 3 (15) | 17 | 0 | 0 | 0 | 17 = 17 |
| all | — | 806 | 376 (374) | 139 | 139 | 37 (139) | 235 | 0 | reverted_twice 11, touched_twice 3 | 32 | 140 = 140 |

rep1j R5, the three sidecar items, decision by decision:

| cycle | item | the run did | outcome | the new rule |
|---|---|---|---|---|
| C5.2 | V5.1.1 | send | null | send/repair |
| C5.3 | V5.1.1 | send (the repair was reverted (it made G57 fail); sent again) | reverted | send/repair |
| C5.3 | V5.2.1 | send | null | send/repair |
| C5.4 | V5.1.1 | hold (sent again after an earlier revert already) | reverted | hold → reviewer (reverted_twice) |
| C5.4 | V5.2.1 | send (the repair was reverted (it made G57 fail); sent again) | reverted | send/repair |
| C5.4 | V5.3.1 | send | null | send/repair |
| C5.5 | V5.2.1 | hold (sent again after an earlier revert already) | reverted | hold → reviewer (reverted_twice) |
| C5.5 | V5.3.1 | send (the repair was reverted (it made G57 fail); sent again) | reverted | send/repair |
