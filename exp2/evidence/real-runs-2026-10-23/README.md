# Real R1 runs of the acceptance block, 2026-10-23 (exported from the Windows host)

Five runs of `intent-exp2-serial --to 1` on dpipe, executor gpt-5.6-luna-fast low, reviewer/formalizer/checks medium.
rep1, rep1b, rep1c are void (VOID.txt says why); rep1d (code 29158c1) and rep1e (code abb6f71, fix batches 1+2) are valid.

Per run: `exp2-state.json` (full state), `checkpoints/round-01/{report,ledger}.{md,json}`, `checkpoints/*.jsonl`
(scores incl. first delivery, measures for rep1e), `official/round-01/<commit>/cases.json` (per-case official results),
`local-config.json`. rep1e/RESULT.txt is the design session's diagnosis; read it only after forming your own.

`rep1e/review-sessions/`: the three reviewer sessions of rep1e as exported from the OpenCode server: every message with
its text parts and tool calls (tool name, full input, output truncated to 3000 chars). The reviewer's own input files
are in the `apply_patch` inputs. The executor session of rep1e was not exported before the host rebooted; the repair
messages it received are reconstructible from `review_calls[].response_text` (fallback whole reply) and
`executions[].cycles`.

## ic15-all-scope (added 2026-10-23 evening)

The 15-round run on fe6562d with the cumulative-text (all/full) scope, executor low, stopped during R4 (STOPPED.txt).
R1–R3 complete: state, reports, ledgers, scores, measures, official per-case results. Use R3 to replay the G77 case:
a guard born in R2 from a reviewer item (zscore, population stddev), superseded by R3's text (R3.S3 partial → R2.S11.P5,
P6 in the attribution record), flipped in all three repair cycles and reverted them (35 fixed items discarded). The
expected behaviour after DESIGN §12j.7 item 11: classified as "text changed behind it", sent to the reviewer, no revert.
