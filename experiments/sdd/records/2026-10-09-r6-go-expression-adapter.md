# R6 Go expression helper adapter verification

## Scope

Added an experiment-side adapter at `experiments/sdd/specart_go_expr_helper.go`. It implements SpecArt's existing `--expr` JSON protocol using Go's standard AST parser for the Go-shaped Dpipe contract expressions. It extracts normalized source, calls and argument counts, references, member accesses, and the proof-expression tree. It recognizes SpecArt's top-level `~>` implication operator and reports malformed input as `SA121`.

The adapter does not execute Dpipe code and does not modify SpecArt validator logic, gate rules, or R6 artifacts. Non-expression invocations are delegated to `SPECART_AST_HELPER_FALLBACK`; this preserves the installed Cangjie helper path when configured. The adapter must be selected only for a Go/Dpipe run because it interprets `--expr` inputs as Go expressions.

## Verification

Ran `experiments/sdd/verify_specart_go_expr.py` against the read-only R6 bundle and the exact frozen R6 SpecArt client/validator. Both the adapter and R6's existing Go declaration helper were built for Linux amd64 with the run's recorded Go toolchain (`go1.27.2 windows/amd64`); the existing helper was built from R6's frozen `validator/go/main.go`.

The verification exercised the exact `CangjieHelperClient.parse_expression()` call path for every `@requires`, `@ensures`, `@effects`, and `@invariants` expression in R6, checked malformed syntax rejection, and checked delegation of non-expression invocations. It then ran the frozen SpecArt CLI on the unchanged R6 bundle with the adapter selected.

Results:

- 57 real R6 contract expressions parsed successfully: 34 calls, 1 member access, and 11 `~>` operators.
- Malformed Go expression returned `SA121`; it was not treated as an empty successful parse.
- Non-expression invocation was passed through to the configured fallback helper.
- Frozen full CLI completed with 10 diagnostics, all `SA180`. There were no helper/parser diagnostics (`SA101`, `SA102`, `SA121`) and the 10 existing source/summary behavior mismatches remained.
- R6 input hashes still match the earlier replay: `summary.yaml` `33C14D705B5F1EA81E54C4555BC67D87B16A19F7F0F954B022BA7C43F0BB88DA`; `drift.go` `0E59813C3E72FA85461DFA0B8FE24163952AD5AAC83A3AAA9E3C5A909F82F666`.
- Adapter source SHA-256: `D0678CDD78D6588DD191C2B452F6AA4C3FE1575505575D9E4B98CB53376264FC`.
- Adapter binary SHA-256: `12F5EF22A739280C8E0D1062DA55E3D6CA849D40F74DA9C5DD6D29AE370D46B7`.
- Frozen R6 Go declaration helper binary SHA-256: `2373B82115E6C4874481A5073582FD9887A5D82189B2F608A74064CBAFECECAD`.

This was a cross-environment replay in the existing Linux preflight container, with `runs/r6` mounted read-only. It verifies the adapter at the frozen helper-client and validator interfaces; it is not a Windows execution result. The generated Windows Go helper remains subject to the host's code-integrity policy. The R6 SDD result remains incomplete because its 10 SA180 mismatches are independent of helper parsing.

## Reproduction

From the experiment repository, with the R6 run at the path recorded above:

1. Cross-build both helper binaries with `.scratch/sdd-phase1/go/bin/go.exe` using `GOOS=linux` and `GOARCH=amd64`.
2. Run the verifier in `sdd-unattended-preflight:latest`, mounting the experiment repository at `/work` and R6 at `/r6` read-only:

```powershell
docker run --rm --mount type=bind,source=D:\huawei\intent_compiler\project,target=/work --mount type=bind,source=D:\huawei\EvoCodeBench\harbor_runs\sdd-luna-dpipe-r6-20261009-195733z-1b07b120\runs\r6,target=/r6,readonly -e SPECART_GO_HELPER=/work/.scratch/specart-go-expr/r6-go-parser-linux-amd64 sdd-unattended-preflight:latest python3 /work/experiments/sdd/verify_specart_go_expr.py --validator-root /r6/.agents/skills/specart/assets/validator --bundle '/r6/output/06-Spec骨架/.specart' --helper /work/.scratch/specart-go-expr/helper-linux-amd64 --round r6
```
