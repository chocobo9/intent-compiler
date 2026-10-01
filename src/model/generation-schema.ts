import { Ajv } from "ajv"
import type { Candidate, CandidateGroup } from "../core/intent-contract.js"
import { CANDIDATE_JSON_SCHEMA, LOCAL_SOURCE_EDIT_IR_CHANGE, type CandidateSchemaResult } from "./candidate-schema.js"
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

/**
 * Strict two-stage requests only (the flow that assembles the assigned
 * requirement texts into the delivered Atom task after preparation).  Legacy
 * full-candidate requests keep the base contract and the full-instruction
 * example, because nothing attaches text for them.
 */
const BASE_ATOM_TASK_SENTENCE = "For a supplied specification, copy its applicable current rule blocks verbatim into task, including interface-defining examples and explanations; do not replace them with a shorter paraphrase. Within this same string, put the unit's action first, its applicable specification next, and handoff instructions last. These are text sections, not extra schema fields."
const ASSEMBLED_ATOM_TASK_SENTENCE = "Management code attaches the assigned current requirement texts verbatim to the delivered task after preparation, each labeled with its IR identity, revision and digest; write atom.task as the unit's action, boundaries and handoff and keep rule blocks, examples and paraphrases of the specification out of the candidate task, because the attached blocks carry the operative specification."
const ASSEMBLED_TASK_DESCRIPTION = "This unit's work instruction: its action, boundaries and handoff, written after determining current meaning and scope (omit superseded rules, unrelated material and other units' exclusive work). Management code attaches the assigned current requirement texts verbatim to the delivered task, so this field must not copy or paraphrase rule blocks, examples or the specification; the executor receives the instruction plus those attached blocks. Leave unspecified internal implementation choices open. Keep illustrative values illustrative. This field may be long and multiline."

function assembledAtomContract(atomContract: string): string {
  return atomContract.replace(BASE_ATOM_TASK_SENTENCE, ASSEMBLED_ATOM_TASK_SENTENCE)
}

/**
 * The local source edit is an IR-stage action: the strict IR stage is the only
 * request that authors ir_changes, and only the strict flow materializes IR
 * content from its sources.  The wording is projected there instead of living
 * in the shared contract, so the legacy full-candidate flow (which has no
 * materialization step) is not told to use an action it cannot use.
 */
const BASE_REVISE_CLAUSE = '- revise: { action:"revise", target:"task"|"current_scope"|"binding"|"output"|"content", id, expected_revision, value:<complete new value>, sources }'
const LOCAL_EDIT_CLAUSE = `${BASE_REVISE_CLAUSE} For a local content source edit that keeps the item's other sources, use edit instead of re-declaring the whole item: { action:"edit", target:"content", id, expected_revision, remove:[SourceRef], add:[SourceRef], basis:[SourceRef], reason }. remove addresses fragments inside this item's current sources; code keeps everything else, merges add, materializes the new text and writes the withdrawal record from this operation itself, so do not also send a superseded entry for the same removal. basis may cite any source still available to this batch, including earlier delegations, not only this batch's events.`
const BASE_SUPERSEDED_BASIS = "empty requirements, and basis selecting the current user's change."
const LOCAL_EDIT_SUPERSEDED_BASIS = "empty requirements, and basis selecting the text available to this batch that mandates the change; an edit change records its own removal, so do not duplicate that one as a superseded entry."

/**
 * Both strict stages have to read the same rule for a withdrawal's basis: the
 * CI stage authors no IR changes, but it judges the parent IR, so it must not be
 * left with the older "current user's change" wording.  Only the IR stage gets
 * the local-edit action itself.
 */
function strictSupersededBasis(irChangeContract: string): string {
  const withBasis = irChangeContract.replace(BASE_SUPERSEDED_BASIS, LOCAL_EDIT_SUPERSEDED_BASIS)
  if (withBasis === irChangeContract) throw new Error("IR change contract no longer carries the superseded-basis clause; the strict basis rule cannot be projected")
  return withBasis
}

function strictLocalSourceEdit(irChangeContract: string): string {
  const withEdit = irChangeContract.replace(BASE_REVISE_CLAUSE, LOCAL_EDIT_CLAUSE)
  if (withEdit === irChangeContract) throw new Error("IR change contract no longer carries the revise clause; the local source edit wording has nowhere to project")
  return withEdit
}

/** The strict CI example shows the division: instruction plus handoff, no rule blocks. */
function instructionOnlyTask(task: string): string {
  const paragraphs = task.split("\n\n")
  return paragraphs.length <= 2 ? task : `${paragraphs[0]!}\n\n${paragraphs[paragraphs.length - 1]!}`
}

/** Generation projections only; the committed domain object remains Candidate. */
export function buildGenerationSchema(stage: GenerationStage, profile?: StrictSchemaProfile): Record<string, unknown> {
  const schema = structuredClone(profile === undefined
    ? withLocalSourceEditBranch(stage === "ir")
    : buildStrictCandidateSchema(profile, { localSourceEdit: stage === "ir" })) as SchemaNode
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
  // The strict flow's Atom task is the work instruction; code attaches the
  // assigned requirement texts.  The legacy schema keeps the base wording.
  const atomTask = (schema.definitions.atom as SchemaNode | undefined)?.properties?.task
  if (atomTask !== undefined) atomTask.description = ASSEMBLED_TASK_DESCRIPTION
  const draftTask = (schema.definitions.atom_draft as SchemaNode | undefined)?.properties?.task
  if (draftTask !== undefined) draftTask.description = ASSEMBLED_TASK_DESCRIPTION
  return schema
}

/**
 * The shared canonical schema stays the legacy shape; the IR-stage projection
 * adds the local-edit branch for both constrained generation and the canonical
 * validation of an IR-stage answer.
 */
function withLocalSourceEditBranch(include: boolean): Record<string, unknown> {
  const schema = structuredClone(CANDIDATE_JSON_SCHEMA) as SchemaNode
  if (include) {
    const change = (schema.definitions as Record<string, SchemaNode>).ir_change!
    ;(change.oneOf as unknown[]).push(structuredClone(LOCAL_SOURCE_EDIT_IR_CHANGE))
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
  // The example keeps its fixture ids in every stage.  A live alias here would
  // be copyable and would resolve to a real event — the one silent
  // mis-attribution this whole change exists to prevent — so an answer that
  // copies the example is left to fail loudly on the source gate instead.
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
    groups: example.groups.map(({ ir_changes: _irChanges, ...group }) => ({
      ...group,
      compilation: group.compilation.decision === "replace"
        ? {
          ...group.compilation,
          drafts: group.compilation.drafts.map(draft => ({
            ...draft,
            atoms: draft.atoms.map(atom => ({ ...atom, task: instructionOnlyTask(atom.task) })),
          })),
        }
        : group.compilation,
    })),
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
    : "CI stage: request.ir is the actual temporary parent IR to compile, identified by parent_basis; copy parent_basis exactly. It is fixed for this response. Copy generation_repair.ir_proposal.basis exactly, both event_ids and refs, even when refs is empty. basis records the original proposal input; do not add newly materialized IR references there. parent_basis identifies the temporary IR, and compilation.intent_basis identifies the task/content used by the plan. generation_repair.ir_proposal identifies the parent groups and their open questions, not a substitute for the actual IR text. Keep the group local_ref that generation_repair.ir_proposal supplied: it binds the group to its parent, while the compiler fills its task identity, dependencies and retained IR changes. Compile each group compilation and coverage, author the execution_decisions, assessments and checks the executions require, and add questions only for concrete compilation uncertainty. If the parent IR itself needs correction, report parent_issues instead of changing it. Return no ir_changes or source_coverage. Write each Atom's work instruction — action, boundaries, ordering and handoff — from the complete applicable IR requirements, including definitions, public interfaces, shared rules, conditions and exceptions; management code attaches the assigned requirement texts verbatim to the delivered task after preparation, so do not copy or paraphrase rule blocks into the candidate task. Coverage selects what the attached text will contain; references and coverage cannot replace executable behavior. Preserve retained work and real dependencies. Original input may reveal an IR omission or wrong role/scope: report concrete parent_issues and groups: [] so management returns to the IR stage; never silently repair the parent or add an unsupported requirement in the plan. Otherwise parent_issues is []."}`
}

/** Retain field semantics while replacing the joint-response shape and example. */
export function generationContract<T extends { ir_change_contract: string; atom_contract: string; candidate_shape: string; example_candidate: string }>(
  contract: T, stage: GenerationStage, profile?: StrictSchemaProfile, parentBasis?: string, assessment = false,
): T {
  return {
    ...contract,
    ir_change_contract: stage === "ir"
      ? strictLocalSourceEdit(strictSupersededBasis(contract.ir_change_contract))
      : strictSupersededBasis(contract.ir_change_contract),
    atom_contract: assembledAtomContract(contract.atom_contract),
    candidate_shape: stage === "ir"
      ? "IR stage response = {schema_version:2,basis,source_coverage,groups}. Each group uses the existing CandidateGroup fields except compilation, coverage, execution_decisions, assessments and checks, which are forbidden in this response. The final Candidate is assembled only after CI generation."
      : assessment
        ? "CI stage (execution assessment) response = {schema_version:2,basis,parent_basis,parent_issues,groups}. Each group uses the existing CandidateGroup fields except ir_changes. source_coverage is forbidden. basis.event_ids must name exactly this batch's trigger events; its refs may cite existing objects you assessed. Copy parent_basis from the request. Keep each group's task_refs and depends_on, and write assessments and execution_decisions from this batch's evidence. Assess the returned work against the Atom's completion criteria and the user's own words; a reservation about the IR's wording, redundancy or evidence phrasing belongs in the assessment explanation, and parent_issues is only for a stored-IR defect that makes the judgement impossible. If parent_issues is nonempty, groups must be empty."
        : "CI stage response = {schema_version:2,basis,parent_basis,parent_issues,groups}. Each group uses the existing CandidateGroup fields except ir_changes. source_coverage is forbidden. Copy basis exactly from generation_repair.ir_proposal.basis, preserving empty refs; it is not recomputed from the temporary IR. Copy parent_basis from the request. If parent_issues is nonempty, groups must be empty; otherwise preserve the parent groups (local_ref, task_refs, depends_on) and any parent questions while supplying compilation and coverage.",
    example_candidate: JSON.stringify(buildGenerationExample(stage, profile, parentBasis), null, 2),
  }
}
