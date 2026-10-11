---
name: specart-implement
description: "Execute a Root-delegated implementation or repair task against a specified validated SpecArt directory. Modify only in-scope product code, tests, and necessary project configuration. 中文触发词：委派实现、按规格开发、实现修复。"
---

# Implement SpecArt

Execute only the implementation or repair role delegated by Root. Do not switch roles or perform the final SpecArt verification.

## Inputs

Require the specification directory accepted by Root's independent gate and the original user request. In repair mode, also require the `REPAIR_REQUIRED` reason and source evidence. The Implementer does not own or repeat the authoritative specification-format gate.

## Implementation

1. Read `summary.yaml`, its source contracts and UI design. Fill or update the real function bodies within the original request. Necessary auxiliary declarations and ordinary comments are allowed. Do not change accepted declarations, contracts, `@changedBy`, UI, summary or extend the agreed external API. Remove an API's `@pendingUpdate` after implementing it.
2. Use the relevant target-language/framework skills. Interpret effects or concurrency through `specart-predicates` without modifying its assets.
3. For UI work, treat the specification as the logic source, an available explored prototype as the styling source, and `ui-component-registry` as the read-only framework translation source.
4. Imports and necessary configuration may change only while preserving project-internal package dependencies; this principle also applies to new helper files. In initial mode, implement the requested behavior. In repair mode, use the original request and confirmed failure evidence to choose the necessary product changes.
5. If the project already has tests relevant to the change, run them after implementation or repair and report the result.

You may modify only in-scope product code, corresponding product tests, and necessary project configuration. Do not modify machine design records, the `.specart/` directory, obligations, witness, proof results, verification report, validator, solver rules, predicate assets, or UI registry assets.

If the specification is missing, contradictory, cannot express the requirement with the existing vocabularies, or implementation requires changing the accepted design or project-internal package dependencies, do not repair the specification or make the out-of-scope change. Return `SPEC_GAP`.

## Result

Return exactly one status with a short summary:

- `IMPLEMENTED`: changed files and relevant existing tests run, if any.
- `SPEC_GAP`: affected clause/identity, concrete implementation constraint, and confirmation that the specification was not changed.
- `BLOCKED`: unavailable permission, input, environment, dependency, or tool plus attempted remediation.

## Go source adapter

For a Go target, read `../specart/references/go-language.md` before writing or reviewing declarations and contracts. The Go adapter preserves the same design, implementation and independent verification gates.
