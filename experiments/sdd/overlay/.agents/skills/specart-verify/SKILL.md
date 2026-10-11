---
name: specart-verify
description: "Execute Root-delegated independent verification of implementation code against a accepted source-skeleton design. Produce API evidence, capability-aware machine results, bug-seeking fallback review, and the final report without modifying product code or specifications. 中文触发词：委派规格验证、代码一致性、证明义务、验证报告。"
---

# Verify SpecArt against code

Execute only a delegated Verification Agent task. Be independent of the implementation author and read-only for the specification and product code. Write obligations, any required witness, proof results, and report only in `.specart-verify/` or outside the project directory, never inside the specification directory.

Use the validator-generated obligation manifest as the complete authoritative list; never choose or omit obligations. The deterministic validator owns capability routing and any machine judgment.

Each verification after project-input changes is a new full round for the current summary, including machine proof and necessary bug-seeking LLM review. Do not reuse previous passing conclusions. If inputs change during verification, return the diagnostic to Root for a fresh verification round; a witness-only retry is permitted only while project inputs remain unchanged.

## Optional internal analysis

When the workflow needs proof-slice analysis, delegate the current task to `specart-slice` when the platform's native Agent tool is available. When it needs bug-seeking fallback review, delegate to `specart-fallback-review`. Build either task from the current obligation, source scope, diagnostics, and the applicable requirements in `assets/verification-reference.md`.

If the native tool is absent or rejects creation before the child Agent is established, perform that same analysis yourself. Once a child Agent is established, wait for it and return its result or execution error to this workflow; do not repeat its task yourself or create a replacement merely because its analysis is negative. In either path, independently check cited source before writing verification artifacts or deciding the final status.

## Workflow

1. Run `../specart/assets/validator/bin/specart-validate check <spec-directory>`. Changed design or missing design context is `SPEC_GAP`/`BLOCKED`; confirmed unfinished implementation (missing body or pending marker) requires repair. These are not formal-capability failures.
2. Generate current obligations and a Markdown report skeleton with `specart-validate obligations <spec-directory> --output <obligations.json> --report <report.md>`.
3. Use the generated API entries, inspect their real implementations and necessary helper calls, and supplement UI correspondence and exact source evidence. Check that helpers do not extend the agreed API or change project-internal package dependencies outside the mechanically checked files.
4. Read `assets/verification-reference.md` and `assets/report-schema.yaml`. Obtain any needed proof-slice analysis through the optional route above. Create a witness only when the effective manifest capability has an implementation proof adapter: currently this requires `language: cangjie` and `formal_proof: true`. Use only obligation ID, real file/symbol, optional complete-statement ranges, and explicit bindings; never add assumptions or contracts. When `formal_proof` is false or no language adapter exists, do not create a witness.
5. Run `prove` from the implementation repository root. Pass `--witness` only when step 4 created one; otherwise `prove` emits capability results directly without witness or Z3.
6. Only when a result says `REVISE_WITNESS_ONCE`, make one combined witness revision and rerun with `--previous-results`. There is no revision on the no-adapter path and no third attempt.
7. For every `CAPABILITY_BLOCKED` goal, obtain bug-seeking review through the optional route above, inspect the smallest relevant source slice, and seek a violating path first. Never turn fallback into `PROVED`.
8. Fill the report using file and line evidence; machine-result association and evidence digests are automatic. Run `specart-validate report <spec-directory> <obligations.json> <report.md> --proof-results <proof-results.json>`.

Use `specart-predicates` read-only for effects/concurrency and `ui-component-registry` read-only for UI mappings. Use `ui-prototype-explorer` only when runtime UI evidence is needed. A vocabulary gap is `SPEC_GAP`; do not extend skill assets.

## Classification

- `SLICE_PROVED`: continue to the report gate.
- `SLICE_COUNTEREXAMPLE`: inspect real source; return `REPAIR_REQUIRED` only after confirming an implementation violation, otherwise `BLOCKED`.
- `CAPABILITY_BLOCKED`: confirmed defect → `REPAIR_REQUIRED`; unresolved risk → `BLOCKED`; no violation and risk excluded → retain `CAPABILITY_BLOCKED` and continue the gate.
- Invalid context after the allowed revision, invalid slice, solver/tool failure, or insufficient evidence → `BLOCKED` unless the cause is a confirmed specification gap (`SPEC_GAP`).
- Entry/evidence failure: specification defect → `SPEC_GAP`; confirmed missing/wrong implementation → `REPAIR_REQUIRED`; insufficient evidence → `BLOCKED`.

## Result

Return exactly one status and stop:

- `PASS`: verification artifact paths and any visible `CAPABILITY_BLOCKED` summary.
- `REPAIR_REQUIRED`: confirmed failing obligation, reason/counterexample, and exact source evidence.
- `SPEC_GAP`: confirmed missing or contradictory design or source declaration.
- `BLOCKED`: unresolved counterexample/risk or concrete evidence, environment, solver, or tool blocker.

Do not create a Repair Agent or continue a repair loop. Do not falsify evidence or review toward PASS. `SLICE_PROVED` proves only the selected slice; every machine result remains `COMPLETENESS_NOT_CHECKED`.

## Go source adapter

For a Go target, read `../specart/references/go-language.md` before writing or reviewing declarations and contracts. The Go adapter preserves the same design, implementation and independent verification gates.
