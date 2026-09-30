import { Ajv } from "ajv"
import type { Candidate, CandidateGroup } from "../core/intent-contract.js"
import { CANDIDATE_JSON_SCHEMA, type CandidateSchemaResult } from "./candidate-schema.js"
import { CANDIDATE_EXAMPLE } from "./candidate-example.js"
import { buildStrictCandidateExample, buildStrictCandidateSchema, type StrictSchemaProfile } from "./candidate-schema-strict.js"

export type GenerationStage = "ir" | "ci"
/**
 * The IR stage owns intent, source disposition and open questions.  Execution
 * decisions, assessments and checks belong to the stage that consumes them
 * (CI compile and return assessment), so they are not part of this shape.
 */
export type IRProposal = Omit<Candidate, "groups"> & {
  groups: Array<Omit<CandidateGroup, "compilation" | "coverage" | "execution_decisions" | "assessments" | "checks">>
}
export type CIProposal = Omit<Candidate, "groups" | "source_coverage"> & {
  parent_basis: string
  parent_issues: string[]
  groups: Array<Omit<CandidateGroup, "ir_changes">>
}

type SchemaNode = Record<string, any>

/** Generation projections only; the committed domain object remains Candidate. */
export function buildGenerationSchema(stage: GenerationStage, profile?: StrictSchemaProfile): Record<string, unknown> {
  const schema = structuredClone(profile === undefined ? CANDIDATE_JSON_SCHEMA : buildStrictCandidateSchema(profile)) as SchemaNode
  const group = schema.definitions.group as SchemaNode
  const remove = (object: SchemaNode, keys: string[]) => {
    for (const key of keys) delete object.properties[key]
    object.required = object.required.filter((key: string) => !keys.includes(key))
  }
  if (stage === "ir") remove(group, ["compilation", "coverage", "execution_decisions", "assessments", "checks"])
  else {
    remove(group, ["ir_changes"])
    remove(schema, ["source_coverage"])
    schema.properties.basis.description = "Copy generation_repair.ir_proposal.basis exactly, including event_ids and refs. This is the fixed input basis of the parent proposal, not references to the temporary IR. Keep refs empty when the parent basis has refs: []. Use parent_basis and compilation.intent_basis for the temporary IR relationship."
    schema.properties.parent_basis = { type: "string", minLength: 1, description: "Copy the supplied parent_basis exactly; this identifies the fixed IR being compiled." }
    schema.properties.parent_issues = { type: "array", items: { type: "string", minLength: 1 }, description: "Concrete defects in the supplied parent IR. If nonempty, return groups: [] instead of changing or compiling the parent." }
    schema.required.push("parent_basis", "parent_issues")
  }
  return schema
}

export function validateGenerationProposal(stage: GenerationStage, value: unknown): CandidateSchemaResult {
  const validate = new Ajv({ allErrors: true, strict: false, allowUnionTypes: true }).compile(buildGenerationSchema(stage))
  const ok = validate(value)
  const errors = (validate.errors ?? []).map(error => `${error.instancePath || "/"}: ${error.message ?? "invalid"}`)
  if (ok && stage === "ci") {
    const proposal = value as CIProposal
    if (proposal.parent_issues.length > 0 && proposal.groups.length > 0) errors.push("/groups: must be empty when parent_issues is nonempty")
  }
  return { ok: ok && errors.length === 0, errors }
}

/** Project the existing encoding example, without inventing another task. */
export function buildGenerationExample(stage: GenerationStage, profile?: StrictSchemaProfile, parentBasis = "example-parent-basis"): IRProposal | CIProposal {
  const example = structuredClone(profile === undefined ? CANDIDATE_EXAMPLE : buildStrictCandidateExample(profile)) as Candidate
  if (stage === "ir") return {
    ...example,
    groups: example.groups.map(({
      compilation: _compilation, coverage: _coverage,
      execution_decisions: _executionDecisions, assessments: _assessments, checks: _checks, ...group
    }) => group),
  }
  const { source_coverage: _sourceCoverage, ...rest } = example
  return {
    ...rest, parent_basis: parentBasis, parent_issues: [],
    groups: example.groups.map(({ ir_changes: _irChanges, ...group }) => group),
  }
}

/** CI wording when this batch carries no user delegation and assesses an execution. */
function assessmentStageInstruction(): string {
  return [
    "CI stage (execution assessment): request.ir is the stored IR and parent_basis identifies it; copy parent_basis exactly.",
    "This batch carries no user delegation, so the user requirements are not yours to revise: return no ir_changes and no source_coverage.",
    "Judge the returned execution on two things only: whether it satisfies the assigned Atom's completion criteria as written, and whether it violates the user's own words. Assess that work — satisfied, not_satisfied or unknown — and name the evidence you used.",
    "An objection to the stored IR's wording, redundancy, evidence phrasing or output description is not grounds to withhold that judgement: assess the work anyway and state the reservation in the assessment explanation.",
    "Report parent_issues only when a stored-IR defect makes the judgement impossible — for example a completion condition that cannot be observed in this host at all. The IR belongs to the whole task and is revised only by user input, so such a defect is recorded as a question for the next delegation, the IR is left unchanged, and this batch still completes.",
    "basis.event_ids must name exactly this batch's trigger events.",
    "generation_repair.ir_proposal carries the stored task groups; keep each group's task_refs and depends_on.",
    "Write the assessments and execution_decisions for this batch yourself from its evidence, with evidence refs to this batch's events: an execution return is never an IR source, only evidence for those fields.",
    "Compile only what the current IR and this evidence require: reuse the current Compiled Intent when the plan is unchanged, and replace it only where the plan must change. Preserve retained work and real dependencies.",
    "Otherwise parent_issues is [].",
  ].join(" ")
}

export function generationStageInstruction(stage: GenerationStage, assessment = false): string {
  if (assessment && stage === "ci") return assessmentStageInstruction()
  const shared = "You are the read-only management model for Intent Compiler v2. One Intent IR maintains the whole user task; its Compiled Intent is the complete plan containing Atoms and Relations. Do not execute business work, use business tools, inspect or modify files, invent execution facts, or answer the business task. Return only the current generation stage's schema-constrained projection. The field contracts describe the final Candidate; fields excluded by this stage belong to the other stage and must not be returned. Original sources remain evidence for understanding, never permission to bypass the supplied stage boundary. Preserve user requirements, their real role and scope, and distinguish success from a blocker."
  return `${shared}\n${stage === "ir"
    ? "IR stage: interpret current delegation and updates against prior state, select every effective requirement and its source, role and scope, and return the IR changes and remaining-source classifications. Return no compilation, coverage, execution decisions, assessments or checks. Do not write Atoms. Preserve existing identities and unchanged requirements. Declare required input/output identities when field scopes depend on them. The compiler will materialize this IR before asking for the execution plan."
    : "CI stage: request.ir is the actual temporary parent IR to compile, identified by parent_basis; copy parent_basis exactly. It is fixed for this response. Copy generation_repair.ir_proposal.basis exactly, both event_ids and refs, even when refs is empty. basis records the original proposal input; do not add newly materialized IR references there. parent_basis identifies the temporary IR, and compilation.intent_basis identifies the task/content used by the plan. generation_repair.ir_proposal identifies the parent groups and their open questions, not a substitute for the actual IR text. Keep the group local_ref that generation_repair.ir_proposal supplied: it binds the group to its parent, while the compiler fills its task identity, dependencies and retained IR changes. Compile each group compilation and coverage, author the execution_decisions, assessments and checks the executions require, and add questions only for concrete compilation uncertainty. If the parent IR itself needs correction, report parent_issues instead of changing it. Return no ir_changes or source_coverage. Write Atoms from the complete applicable IR requirements, including definitions, public interfaces, shared rules, conditions and exceptions; transfer supplied operative specifications without summarizing away behavior. References and coverage cannot replace executable behavior. Preserve retained work and real dependencies. Original input may reveal an IR omission or wrong role/scope: report concrete parent_issues and groups: [] so management returns to the IR stage; never silently repair the parent or add an unsupported requirement in the plan. Otherwise parent_issues is []."}`
}

/** Retain field semantics while replacing the joint-response shape and example. */
export function generationContract<T extends { candidate_shape: string; example_candidate: string }>(
  contract: T, stage: GenerationStage, profile?: StrictSchemaProfile, parentBasis?: string, assessment = false,
): T {
  return {
    ...contract,
    candidate_shape: stage === "ir"
      ? "IR stage response = {schema_version:2,basis,source_coverage,groups}. Each group uses the existing CandidateGroup fields except compilation, coverage, execution_decisions, assessments and checks, which are forbidden in this response. The final Candidate is assembled only after CI generation."
      : assessment
        ? "CI stage (execution assessment) response = {schema_version:2,basis,parent_basis,parent_issues,groups}. Each group uses the existing CandidateGroup fields except ir_changes. source_coverage is forbidden. basis.event_ids must name exactly this batch's trigger events; its refs may cite existing objects you assessed. Copy parent_basis from the request. Keep each group's task_refs and depends_on, and write assessments and execution_decisions from this batch's evidence. Assess the returned work against the Atom's completion criteria and the user's own words; a reservation about the IR's wording, redundancy or evidence phrasing belongs in the assessment explanation, and parent_issues is only for a stored-IR defect that makes the judgement impossible. If parent_issues is nonempty, groups must be empty."
        : "CI stage response = {schema_version:2,basis,parent_basis,parent_issues,groups}. Each group uses the existing CandidateGroup fields except ir_changes. source_coverage is forbidden. Copy basis exactly from generation_repair.ir_proposal.basis, preserving empty refs; it is not recomputed from the temporary IR. Copy parent_basis from the request. If parent_issues is nonempty, groups must be empty; otherwise preserve the parent groups (local_ref, task_refs, depends_on) and any parent questions while supplying compilation and coverage.",
    example_candidate: JSON.stringify(buildGenerationExample(stage, profile, parentBasis), null, 2),
  }
}
