# SpecArt Go diagnostics and 15-round promotion rule

## Diagnostic adaptation

The read-only helper is `specart_go_diagnose.py`. Newly frozen experiment rounds include it in the run root and append a run-local instruction to the SpecArt prompt. The instruction requires the Root to call it only after the original validator reports SA180, verify the report immediately before reuse, and provide the report to the next already-budgeted Author task in the same round.

The helper calls the selected run's unchanged `specart-validate validate --format json` implementation through its Python CLI. Valid JSON with exit code 1 is retained as a normal validation failure. It classifies behavior SA180 and type-member SA180 separately, applies that validator copy's `contract_text()` before showing a behavior diff, and retains every unrelated diagnostic. It marks parser-startup blocks and malformed output as diagnostic failures rather than an empty SA180 result. When base validation fails, it records that `Design.validate` did not run and type-member SA180 may still be deferred.

Reports bind the round, SpecArt tree, project tree, validator tree, and Go toolchain/helper metadata. `verify-report` rejects changed bindings and writes a hash-bound verification sidecar. The runner inventories report and verification status in `completion.json`. This is an advisory path only; SpecArt validation, independent review, and `accept-design` remain required.

An external approved parser can be selected through `SPECART_GO_HELPER`. The runner requires `SPECART_GO_HELPER_MANIFEST`, checks the recorded source path/hash against the frozen validator, verifies helper and builder-toolchain hashes, and stores those files as external runtime evidence. It does not build, approve, or bypass execution controls for the helper.

## Promotion and evaluation

`run_series.py` now uses one `promotion_blockers()` rule for normal sequential execution and `continue-from` recovery. Promotion requires `sdd_status == pass`, each `design`, `coding`, `prd`, and `final` result to pass, confirmed process cleanup, no unconfirmed container cleanup, and a complete official result (`status == evaluated`). It does not require every official case to pass.

The single-round runner still evaluates the frozen code snapshot after process cleanup even when an SDD gate fails. That official result is retained in the failed round record, but it cannot promote the snapshot. Recovery and continuation use the same promotion rule.

## Offline checks

Focused command:

```powershell
uv run --no-project --with pytest -- python -m pytest -q test_specart_go_diagnose.py test_series.py test_recovery_series.py test_prepare.py test_run_r1.py
```

Result: `46 passed`.

The complete root-level offline adapter suite was also run with `PYTHONUTF8=1` (the runner's configured encoding): `80 passed`. The first attempt without that environment setting had one existing recovery test fail while reading UTF-8 workflow text under the shell's cp1252 default; the correctly configured rerun passed. After adding the manifest source-path check, the full suite passed again: `80 passed`.

No model session, Author task, SDD round, or official evaluation was started as part of this adapter work.
