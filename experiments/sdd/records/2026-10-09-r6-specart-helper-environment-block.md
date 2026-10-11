# R6 SpecArt Go parser replay: environment block

This records the read-only validator replay performed before the diagnostic-adapter change. It does not alter the original R6 completion or official evaluation.

## Evidence

- Run: `D:\huawei\EvoCodeBench\harbor_runs\sdd-luna-dpipe-r6-20261009-195733z-1b07b120`
- Validator source: `runs\r6\.agents\skills\specart\assets\validator\go\main.go`
  - SHA-256: `5DACDECA9D363D41E12C864AC47F0D02406D6B08AE761773BAF8EC2466B281BE`
- Go helper client in the frozen R6 validator:
  - SHA-256: `7555A0A313418D3C9DBAD35B8246CF31513E9C665E50FA3A710944516F230F76`
  - It is byte-identical to the current checkout and supports the `SPECART_GO_HELPER` override.
- Build toolchain from the run's `toolchain.txt`: `go1.27.2 windows/amd64`
- Configured Go executable: `D:\huawei\intent_compiler\project\.scratch\sdd-phase1\go\bin\go.exe`
  - SHA-256: `B8CD508A0A7AAC883CD750E9E75EB306D219E726BDF1CDE29009490729437FBF`
- Content-addressed parser generated for this replay: `C:\Users\HuaWeiClient\AppData\Local\Temp\specart\go-e1465b01a6abb4f11eb0\helper.exe`
  - SHA-256: `8FAD3E88F760F2CA387C71970CD8A8ED7D37CA42C4E1FA7E8D760F49FB746C04`
- Windows Code Integrity Operational events at `2026-10-09 20:23:29–20:23:31` local time:
  - Event 3077: the generated helper did not meet Enterprise signing requirements or violated the active code-integrity policy (`0283ac0f-fff1-49ae-ada1-8a933130cad6`).
  - Event 3033: the helper did not meet Enterprise signing requirements.
  - The blocked path in both events is the generated `helper.exe` above; the attempting process is the installed Python 3.12 interpreter.

## Replay result

The exact frozen R6 validator returned JSON with exit code 1, but Go parsing emitted SA103 because Windows blocked the generated parser. The resulting SA050 diagnostics are downstream of that parse failure. Treat this replay as an environment block; it does not establish whether the current R6 artifacts still have either SA180 subtype.

`summary.yaml` and `drift.go` SHA-256 values were identical before and after the replay. No SDD artifact or validator source was changed.

- `summary.yaml`: `33C14D705B5F1EA81E54C455BC67D87B16A19F7F0F954B022BA7C43F0BB88DA`
- `drift.go`: `0E59813C3E72FA85461DFA0B8FE24163952AD5AAC83A3AAA9E3C5A909F82F666`

## Approved-helper path

An administrator-approved `SPECART_GO_HELPER` can be supplied without changing validator logic. Before using one for R6, confirm it is built from this run's exact `go/main.go`, record the builder/toolchain and binary hashes, then parse `drift.go` alone before running full `validate --format json`. Preserve all original diagnostics; the adapter must not treat parser startup failure as an empty SA180 result.

## Follow-up near-real parse attempt

On 2026-10-09 at 20:37 local time, the read-only adapter was pointed at the exact frozen R6 validator, the same content-addressed helper, and the R6 `drift.go`. The standalone parse returned `parser_failed` (`HelperError: Go parser 必须成功返回完整声明`), exit code 2. `drift.go` SHA-256 remained `0E59813C3E72FA85461DFA0B8FE24163952AD5AAC83A3AAA9E3C5A909F82F666` before and after.

New Code Integrity Operational events at `2026-10-09 20:37:07` local time confirm the cause:

- Event 3077: the exact generated helper above was blocked by policy `0283ac0f-fff1-49ae-ada1-8a933130cad6` for not meeting Enterprise signing requirements or violating code-integrity policy.
- Event 3033: the same helper did not meet Enterprise signing requirements.
- The attempting process was the installed Python 3.12 interpreter.

Because the standalone parse did not succeed, the full `validate --format json` command was deliberately not run. This attempt produced no SDD diagnostic finding and did not consume an Author call. Continue only after the helper is allowed by the system policy; do not treat this as evidence for or against either SA180 subtype.

## Cross-environment replay

To continue without overriding Windows Code Integrity, the frozen R6 Go helper source was cross-built for Linux using the same recorded Go 1.27.2 Windows toolchain, then executed in the existing Linux `sdd-unattended-preflight:latest` container. The R6 `runs/r6` tree was mounted read-only. This is a cross-environment replay, not a Windows reproduction.

- Frozen Go source SHA-256: `5DACDECA9D363D41E12C864AC47F0D02406D6B08AE761773BAF8EC2466B281BE`.
- Linux helper SHA-256: `2373B82115E6C4874481A5073582FD9887A5D82189B2F608A74064CBAFECECAD`.
- `drift.go` parsed successfully with `schema_version: 1`, 0 parser diagnostics, and a complete declarations list.
- The first full CLI invocation used the wrong bundle directory and returned path/manifest diagnostics; it was discarded. The corrected invocation targeted `output/06-Spec骨架/.specart`.
- Corrected full `validate --format json` exited 1 with 67 diagnostics: 10 bundle-level SA180 diagnostics (`Drift` in `drift.go`; `Ingest`, `Transform`, `Verify`, `Manifest`, `Pipeline`, `Profile`, `Compare`, `Validate`, and `Lineage` in `main.go`) and 57 SA101 diagnostics because the container did not have the run's Windows Cangjie AST helper. The SA101 entries are cross-environment setup artifacts and must not be attributed to R6's Windows run.
- No SA091 or SA182 appeared in this response. The base SA180 failures stop the validator before the later design lifecycle checks, so this run does not determine whether a type-member SA180 is also present.
- The corrected JSON indicates the behavior/contract mismatch subtype of SA180, but this remains a cross-environment result. It is not a successful full SDD run or an official evaluation.

A read-only comparison using the frozen `Bundle` loader and the same Linux Go helper confirmed all 10 SA180s are source/summary behavior-block differences, not type-member SA180s. The affected declarations are the ten listed above. In each entry the summary paraphrases or shortens the source contract instead of preserving the complete normalized block. For example, the `Ingest` summary omits the exact required/type default messages that exist in the source contract; `Transform` shortens the special fill/normalize/watermark rules; and `Profile`, `Compare`, `Validate`, and `Lineage` similarly omit detailed behavior/error clauses. `Drift` also has a `@changedBy` value in summary (`ad6a9e03083057979cc90959`) that differs from source (`9670e0c9298bd820bb2c8b24`). This identifies the repair for a future budgeted Author pass: preserve each complete source behavior block verbatim in the matching summary entry and make metadata agree; do not change validator logic. R6 itself remains frozen and unchanged.

After the replay, the frozen `summary.yaml` and `drift.go` hashes still match the prior values above. No R6 artifact, validator source, or Author budget was changed or consumed. For an unqualified Windows result, the exact Go helper still needs an administrator-approved execution path and the original Windows Cangjie helper/environment must be preserved.
