import assert from "node:assert/strict"
import type { Candidate } from "../../src/core/intent-contract.js"
import type { CompilerModelV2Input } from "../../src/model/compiler-model-v2.js"
import type { IRProposal, CIProposal } from "../../src/model/generation-schema.js"

/** Encoding adapter for fixed lifecycle fixtures; it does not generate or repair meaning. */
export function stageCandidate(input: CompilerModelV2Input, candidate: Candidate): IRProposal | CIProposal {
  assert.ok(input.generation_stage, "strict lifecycle tests must use parent/child generation")
  const copy = structuredClone(candidate)
  if (input.generation_stage === "ir") return {
    ...copy, groups: copy.groups.map(({
      compilation: _compilation, coverage: _coverage,
      execution_decisions: _decisions, assessments: _assessments, checks: _checks, ...group
    }) => group),
  }
  assert.ok(input.parent_basis, "CI must receive its actual parent identity")
  if (input.assessment_batch === true) {
    // An assessment batch carries no user delegation, so no IR stage authored
    // these decisions: this answer authors the ones the plan is committed from,
    // and owes the stored IR only its task identities and this batch's events.
    assert.ok(input.generation_repair?.ir_proposal, "an assessment batch still receives the stored task groups")
    return {
      schema_version: 2, basis: copy.basis, parent_basis: input.parent_basis, parent_issues: [],
      groups: copy.groups.map(({ ir_changes: _changes, ...group }) => group),
    }
  }
  return {
    schema_version: 2, basis: copy.basis, parent_basis: input.parent_basis, parent_issues: [],
    groups: copy.groups.map(({ ir_changes: _changes, ...group }) => {
      const parent = input.generation_repair?.ir_proposal?.groups.find(item => item.local_ref === group.local_ref)
      assert.ok(parent, "CI must receive the parent groups it must preserve")
      return { ...group, task_refs: structuredClone(parent.task_refs), depends_on: structuredClone(parent.depends_on),
        execution_decisions: [], assessments: [], checks: [] }
    }),
  }
}

/** Reassemble only the supplied drafts so an existing behavior test can edit its child. */
export function repairCandidate(input: CompilerModelV2Input): Candidate {
  assert.equal(input.generation_stage, "ci")
  assert.equal(input.repair_context, undefined, "stage repairs must use generation_repair")
  const parent = input.generation_repair?.ir_proposal
  const child = input.generation_repair?.ci_proposal
  assert.ok(parent)
  assert.ok(child)
  assert.equal(child.parent_basis, input.parent_basis)
  return {
    schema_version: 2, basis: structuredClone(parent.basis), source_coverage: structuredClone(parent.source_coverage),
    groups: child.groups.map(group => {
      const original = parent.groups.find(item => item.local_ref === group.local_ref)
      assert.ok(original)
      return { ...structuredClone(group), ir_changes: structuredClone(original.ir_changes) }
    }),
  }
}
