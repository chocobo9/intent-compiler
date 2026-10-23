# Real replies from local R1 runs (2026-10-23)

Exported by the design session from the local state of two real R1 runs of the acceptance block (executor gpt-5.6-luna-fast low; reviewer and formalizer gpt-5.6-luna-fast medium; Windows host, PowerShell):

- `exp2-icacc-r1-luna56-low-rep1b-20261023`: the reviewer reported 14 items; all were dropped as malformed because the formalizer wrote unit ids like `R1.S3.P12#f683eb75:s10.c1`.
- `exp2-icacc-r1-luna56-low-rep1c-20261023`: both reviews were voided as "program never run" although the reviewer built `dpipe-review.exe` and ran it with `& .\dpipe-review.exe ...`.

Files:
- `review_calls.jsonl`: the state's `review_calls` records (with `run`), including `response_text`, `program_runs`, `valid`.
- `formalize_calls.jsonl`: the state's `formalize_calls` records (with `run`), including `response_text` and `problems`.
- `session_messages/<run>-<review id>.json`: the reviewer sessions' messages from OpenCode, reduced to text parts and tool parts (tool, status, command, exit code, output cut to 2000 characters). Shape as `programRunsIn` reads it.

Use them as regression inputs for the interfaces between model output and code checks (unit ids, program-run detection, formalizer answers).
