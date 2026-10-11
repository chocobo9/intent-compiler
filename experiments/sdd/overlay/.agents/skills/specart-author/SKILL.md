---
name: specart-author
description: "Execute Root-delegated source-skeleton design: declarations, contracts, UI and summary for an existing Cangjie, ArkTS or Go project; preserve existing function bodies. 中文触发词：委派规格编写、规格修订、源码骨架。"
---

# Author SpecArt

Execute only the specification-author role delegated by Root. Do not switch roles.

## Boundaries

- Write in-scope source declarations, contract comments and imports, plus `.specart/` metadata, UI and `summary.yaml`. Require Root's project path and task ID.
- Do not implement new function bodies or change existing bodies/tests, machine design records, verification artifacts, validator code, predicate assets, or UI registry assets.
- If the predicate or UI vocabulary cannot express the requirement, return `SPEC_GAP` for user decision; do not extend those assets.

## Workflow

1. Read the complete requirements, relevant code, and available UI evidence. If a system overview or design is provided, reflect its system boundaries, modules, interfaces, and dependency direction; return `SPEC_GAP` if it conflicts with the requirements. Do not invent missing behavior.
2. Read `../specart/assets/format-reference.md`. Use the matching language example.
3. When an HTML prototype exists, use `ui-prototype-explorer` to inspect the rendered UI and required paths. Use `ui-component-registry` read-only for UI vocabulary and `specart-predicates` read-only for structured predicates.
4. Determine the real target implementation language from the user, established project configuration, or the single unambiguous design choice, and write it in `language`. Cangjie uses `.cj`; ArkTS uses `.ets` or project `.ts`; Go uses `.go`. Unsupported source languages return `SPEC_GAP`. If the implementation language cannot be determined, return `SPEC_GAP`.
5. Set `formal_proof: false` by default. Set it to `true` only when the user explicitly asks for strict verification, strict mode, formal proof, or an unambiguous equivalent. Ordinary requests to implement, check, validate, or verify do not enable strict formal proof. Only Cangjie supports `formal_proof: true`; return `SPEC_GAP` if strict formal proof is required for another language.
6. Write declarations in their final project files. New functions have signatures only; existing functions retain their bodies and gain `@pendingUpdate`. Function APIs require a complete contract block first among associated comments, including `@src`. Types/fields need contracts only when they have behavior to specify. Mark each listed declaration with `@changedBy <task-ID>` in an associated comment, independently of whether it has a contract. Top-level target functions are APIs.
7. Design the required project-internal package dependencies with real imports. Write `summary.yaml` with task ID, each changed/new declaration's file, complete signature, its contract if present and owner when needed. Include changes to contracts even when the signature is unchanged. Supply A2UI when Root requires UI. Use script-generated references when short API names are ambiguous.
8. Keep requirement coverage, exceptional API outcomes, and uncertainty explicit. Continue without a review pause unless the user requested one.
9. After any specification change, run `../specart/assets/validator/bin/specart-validate validate <spec-directory>`. Read every diagnostic, repair in-scope specification errors, and rerun until it exits zero. Preserve requirement meaning and constraint strength: do not delete requirements or clauses, or weaken conditions, merely to pass validation; return `SPEC_GAP` when the requirement cannot be expressed correctly.
10. If an external `@src` checker is provided, run it after generation and fix/rerun until it exits zero.

Do not hand off a failing specification or ask the user to run deterministic checks. This self-validation is the Author's repair loop; Root independently runs the authoritative acceptance gate after handoff. If the language, platform or design cannot be determined from available evidence, return `SPEC_GAP`. Stop only when required input, vocabulary, permissions, or tools are genuinely unavailable.

## Result

Return exactly one status with a short summary:

- `SPEC_READY`: specification path, Author self-validation success, evidence used, and explicit uncertainties.
- `SPEC_GAP`: missing/conflicting requirement or unsupported predicate/UI vocabulary and the affected identity.
- `BLOCKED`: unavailable permission, input, environment, or tool plus attempted remediation.

## Go source adapter

For a Go target, read `../specart/references/go-language.md` before writing or reviewing declarations and contracts. The Go adapter preserves the same design, implementation and independent verification gates.
