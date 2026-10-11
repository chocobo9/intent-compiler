---
name: specart
description: "Orchestrate SpecArt specification authoring, implementation, repair, and independent verification. Use for requirements-to-spec work, implementation from an existing .specart directory, SpecArt verification, or the full specification-driven workflow. Explicit flow markers: ::specart-design and ::specart-impl. 中文触发词：规格、规格驱动开发、按规格实现、规格验证、验证修复。"
---

# Orchestrate SpecArt

Act only as Root/Main Agent. Keep the original user scope, current stage, artifact paths, worker status, and the result of the independent specification gate; delegate role work instead of performing it.

## Authorization

- Specification design authorizes in-scope source declarations, contract comments, imports and UI design, but not function-body implementation. Validation or verification alone does not authorize product changes.
- Start implementation or repair only when the original request explicitly authorizes it.
- A verify-only request may return `REPAIR_REQUIRED`, but must stop without repair unless the user authorized implementation changes.
- Routine evidence, proof, report completion, and authorized repair do not require extra prompts.

## Workers

Delegate each role through the matching named custom subagent; do not use a generic subagent for these roles:

- `specart-author`: create or revise source skeletons, contracts, UI and summary; self-validate.
- `specart-spec-review`: independently inspect the specification for omitted or weakened requirements, read-only.
- `specart-implement`: perform initial implementation or repair.
- `specart-verify`: independently verify an implementation and write verification artifacts outside the specification directory.

An Implementation/Repair Agent must end before a distinct Verification Agent starts. After every repair, start a fresh Verification Agent; never let an author of the current implementation verify it.

## Routing

- Specification only: start-design → Author → Spec Review → accept-design → done.
- Requirements through implementation: start-design → Author → Spec Review → accept-design → start-implementation → Implementer → fresh Verifier.
- Existing specification implementation: start-implementation → Implementer → fresh Verifier.
- Verification only: fresh Verifier → report its terminal status without unauthorized repair.
- Existing authorized repair request: start-implementation → Repair Agent → fresh Verifier.
- `REPAIR_REQUIRED`: when implementation repair is authorized, run start-implementation before delegating Repair; otherwise return the finding.
- `SPEC_GAP`: re-author only when the original request authorizes specification revision and the gap is repairable within the requested design scope. Predicate/UI vocabulary gaps always go to the user.
- `BLOCKED`: if the validator reports project inputs changed during verification, start a fresh Verifier for the current task; otherwise report the concrete external input, permission, environment, or tool blocker.

Stop after Verifier `PASS` or the requested specification-only result following review and mechanical acceptance. Continue an authorized repair/reverify loop until `PASS`, `SPEC_GAP`, or a genuine blocker.

## Design entry and independent gate

Resolve `assets/validator/bin/specart-validate` relative to this skill (`specart-validate.cmd` on Windows). Use these three commands at the points shown above:

- `start-design <spec-directory> --repo <project-directory> --language <language> --ui required|none` before delegating new or revised design. Decide from this task's scope whether UI structure or interaction/response design is involved, not whether the project has screens. Forward the UI requirement and returned task ID to Author.
- `accept-design <spec-directory>` after Author returns `SPEC_READY` and Spec Review returns `PASS`; this is Root's independent mechanical acceptance.
- `start-implementation <spec-directory>` before delegating implementation or repair.

The scripts check the required project/design conditions. Root checks success and forwards diagnostics unchanged; it does not interpret format rules or edit the specification.

- Success: continue the requested route.
- Validation failure: if specification revision is authorized, send the diagnostics to a new Author task and gate its result again; otherwise return `SPEC_GAP` and request the user's decision.
- The command cannot run because of tools, permissions, or environment: return `BLOCKED`.

Never run design acceptance merely to clear an implementation-entry failure. Missing records require a concrete blocker, not automatic adoption of current code.

After each Author `SPEC_READY`, start a fresh `specart-spec-review` Agent, distinct from Author. Supply the original user request, original requirement sources and authorized scope, plus the project/specification paths and UI requirement; Author's summary is not a substitute for the original sources. The reviewer follows `assets/spec-review-agent.md`. `PASS` permits mechanical acceptance; route `SPEC_GAP` and `BLOCKED` as above. Changes to reviewed requirements or specifications require another review before acceptance; an unavailable or incomplete review is `BLOCKED`.

## Invalidation

- Specification changes invalidate obligations, any applicable witness, proof results, and report.
- Specification changes also invalidate the previous independent specification-gate result.
- Project-input changes (source, configuration or resources) require a fresh Verification Agent to reverify every target in the current summary, including machine proof and necessary independent LLM review; do not reuse previous passing conclusions or select only affected APIs.
- Report-only reasoning/evidence corrections may stay with the current read-only Verifier when source and specification are unchanged.
- Use validator-generated artifacts directly and follow its diagnostics and rerun actions.

Root does not load format, predicate, UI catalog, witness, SMT, fallback, or report-schema details.

## Go source adapter

For a Go target, read `../specart/references/go-language.md` before writing or reviewing declarations and contracts. The Go adapter preserves the same design, implementation and independent verification gates.
