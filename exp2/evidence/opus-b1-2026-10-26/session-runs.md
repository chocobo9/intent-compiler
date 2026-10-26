# Batch 1, commit 8: the reviewer's runs in recorded sessions, and whether they run again the same

Per run: reviews with a session in the store; runs of the program code takes out of them; of those, the ones whose program build is at hand; run again twice on it: both the same as the session's output (stable), the first the same and the second not (unstable), the first not the same (not reproduced), the host refusing the program (blocked). The programs run in the run's docker image.

| run | reviews | with session | runs taken | run again | stable | unstable | not reproduced | blocked | compound command | empty session output | two reruns alike |
|---|---|---|---|---|---|---|---|---|---|---|---|
| rep1j3 | 14 | 14 | 180 | 180 | 2 (1%) | 0 | 178 | 0 | 180 | 0 | 171 |
| rep1n | 16 | 16 | 200 | 200 | 2 (1%) | 0 | 198 | 0 | 200 | 0 | 187 |
| rep1p | 18 | 18 | 453 | 453 | 0 (0%) | 0 | 453 | 0 | 453 | 1 | 443 |
