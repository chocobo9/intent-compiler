import { ASSESSMENT_RESULTS, LATER_STATEMENT_SETTLES } from "./management-instructions.js"
import { Ajv } from "ajv"
import type { Candidate, CandidateGroup, CompiledIntentDraft, Ref } from "../core/intent-contract.js"
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
/**
 * What the CI stage answers.  The parent proposal already fixes the input
 * basis and each parent group's task identity and dependencies, and the
 * compiler fills them at assembly; an ordinary CI answer therefore states none
 * of them.  An assessment batch (a batch with no user delegation) names its
 * own basis events and the task each group assesses, and keeps the fuller
 * shape.
 */
export type CIProposalGroup = Omit<CandidateGroup, "ir_changes" | "task_refs" | "depends_on" | "compilation" | "local_ref" | "assessments" | "execution_decisions"> & {
  /** Assessment groups only: a delegation batch assesses nothing. */
  assessments?: CandidateGroup["assessments"]
  /** Assessment groups, and delegation batches while an execution is active (never retry there). */
  execution_decisions?: CandidateGroup["execution_decisions"]
  /** Assessment groups only; an ordinary CI group binds to its parent group by position. */
  local_ref?: string
  task_refs?: string[]
  depends_on?: string[]
  compilation:
    | { decision: "reuse"; current: Ref[]; reason: string }
    | { decision: "replace"; drafts: Array<Omit<CompiledIntentDraft, "task_id"> & { task_id?: string }> }
}
export type CIProposal = {
  schema_version: 2
  /** An assessment's basis; code fills its event_ids with the batch's trigger events. */
  basis?: { event_ids?: string[]; refs: Candidate["basis"]["refs"] }
  parent_issues?: string[]
  groups: CIProposalGroup[]
}

type SchemaNode = Record<string, any>

/**
 * Strict two-stage requests only (the flow that assembles the assigned
 * requirement texts into the delivered Atom task after preparation).  Legacy
 * full-candidate requests keep the base contract and the full-instruction
 * example, because nothing attaches text for them.
 */
const BASE_ATOM_TASK_SENTENCE = "For a supplied specification, copy its applicable current rule blocks verbatim into task, including interface-defining examples and explanations; do not replace them with a shorter paraphrase. Within this same string, put the unit's action first, its applicable specification next, and handoff instructions last. These are text sections, not extra schema fields."
const ASSEMBLED_ATOM_TASK_SENTENCE = "Management code attaches the assigned current requirement texts verbatim to the delivered task after preparation, each block labeled with its IR identity, revision and digest and its passages labeled and ordered by user input, including passages the item once adopted and later withdrew; write atom.task as the unit's action, boundaries and handoff and keep rule blocks, examples and paraphrases of the specification out of the candidate task, because the attached blocks carry the operative specification."
const ASSEMBLED_TASK_DESCRIPTION = "This unit's work instruction: its action, boundaries and handoff, written after determining current meaning and scope (omit superseded rules, unrelated material and other units' exclusive work). Management code attaches the assigned current requirement texts verbatim to the delivered task, passages labeled and ordered by user input, so this field must not copy or paraphrase rule blocks, examples or the specification; the executor receives the instruction plus those attached blocks. Leave unspecified internal implementation choices open. Keep illustrative values illustrative. This field may be long and multiline."

const BASE_RELATION_SHAPE = 'A Relation is { predecessor: Ref|{local_ref:"new-atom-id"}, successor: Ref|{local_ref:"new-atom-id"}, requires:"exact usable result/ordering reason", conditions:[], basis:[Ref|SourceRef] }. For new Atoms use local_ref; management resolves final content digests after requirement assignment. For existing Atoms copy their exact supplied Ref.'
const CI_RELATION_SHAPE = 'A Relation is { predecessor:{local_ref:"atom-id"}, successor:{local_ref:"atom-id"}, requires:"exact usable result/ordering reason", conditions:[] }. Name each endpoint by its atom_id, for new and existing Atoms alike; management binds the Atom version in this plan and the Relation\'s basis.'
const BASE_AUTHORITY_SHAPE = 'authority.lifetime must be \"this_execution\" and delegation must be \"not_supported\".'
const CI_AUTHORITY_SHAPE = 'authority.lifetime must be \"this_execution\" and delegation must be \"not_supported\". Management fills authority.basis and each rule\'s resource_ref from the task\'s authorization; a rule states operation_id, input_refs, output_refs, conditions and allowed_use.'

const BASE_ASSESSMENT_FIELDS = "Fill assessments.target_ref, criteria_refs, evidence_refs, result and explanation from that comparison."
const CI_ASSESSMENT_FIELDS = "Fill assessments.target_ref, criteria_refs, result and explanation from that comparison; management binds evidence_refs to this batch's return event, so say in explanation which parts of the return the judgement relies on."

/** A CI answer leaves an assessment's evidence reference to code. */
function boundEvidence(rule: string): string {
  return rule.replace(BASE_ASSESSMENT_FIELDS, CI_ASSESSMENT_FIELDS)
}

const BASE_ATOM_REFS = "Use the exact refs supplied in atom_refs for assessments.target_ref and previous_atom_ref; never invent ids, revisions, or digests."
const CI_ATOM_REFS = "Name assessments.target_ref and previous_atom_ref by an Atom id and revision supplied in atom_refs; management binds each Ref's digest, and binds an assessment of this batch's return to the Atom version that execution ran. Never invent ids or revisions."

/** The CI stage names Atoms by id and leaves the identities code binds out of the answer. */
function codeBoundIdentities(atomContract: string): string {
  return atomContract.replace(BASE_RELATION_SHAPE, CI_RELATION_SHAPE).replace(BASE_AUTHORITY_SHAPE, CI_AUTHORITY_SHAPE).replace(BASE_ATOM_REFS, CI_ATOM_REFS)
}

const BASE_EXISTING_IDENTITIES = "For existing objects copy their supplied identities and expected revisions; raise an Atom revision when changing its content. Management assigns compiled identities and computes digests."
const BOUND_EXISTING_IDENTITIES = "For existing objects copy their supplied ids and revisions; raise an Atom revision when changing its content. Management assigns compiled identities, fills the revision an IR change expects and computes every Ref's digest from the stored object it names."
const BASE_EXISTING_OBJECTS_RULE = "When existing_objects contains the work being updated, use that exact task_id and task_revision for task_refs, draft.task_id, and expected_revision fields. Use only atom Refs listed under that task when setting previous_atom_ref; management binds and checks these against the current stored objects."
const BOUND_EXISTING_OBJECTS_RULE = "When existing_objects contains the work being updated, use that exact task_id for task_refs and draft.task_id. Use only Atoms listed under that task when setting previous_atom_ref; management binds the revision an IR change expects and each Ref's digest from the current stored objects."

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
const BASE_RETIRE_CLAUSE = '- retire: { action:"retire", target:"binding"|"output"|"content", id, expected_revision, reason, sources }'
const BOUND_REVISE_CLAUSE = BASE_REVISE_CLAUSE.replace("id, expected_revision, ", "id, ")
const BOUND_RETIRE_CLAUSE = BASE_RETIRE_CLAUSE.replace("id, expected_revision, ", "id, ")
const REVISION_BINDING = "Management fills the revision each revise, retire or edit expects from the supplied IR, so name the existing object by id. State each object's change once per batch: a second change to the same object is rejected."
const LOCAL_EDIT_CLAUSE = `${BOUND_REVISE_CLAUSE} For a local content source edit that keeps the item's other sources, use edit instead of re-declaring the whole item: { action:"edit", target:"content", id, remove:[SourceRef], add:[SourceRef], basis:[SourceRef], reason }. For pure addition use remove: [] and nonempty add; basis and reason remain required. At least one of remove or add must be nonempty. remove addresses fragments inside this item's current sources; code keeps everything else, merges add and materializes the new text. Code writes withdrawal records only for removed fragments, so do not also send a superseded entry for the same removal. basis may cite any source still available to this batch, including earlier delegations, not only this batch's events.`
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

/** Both strict stages read revise and retire without the revision code fills. */
function codeBoundRevisions(irChangeContract: string): string {
  const bound = irChangeContract.replace(BASE_REVISE_CLAUSE, BOUND_REVISE_CLAUSE).replace(BASE_RETIRE_CLAUSE, `${BOUND_RETIRE_CLAUSE}\n${REVISION_BINDING}`)
  if (!bound.includes(BOUND_REVISE_CLAUSE) || !bound.includes(REVISION_BINDING)) throw new Error("IR change contract no longer carries the revise/retire clauses; the code-bound revision wording cannot be projected")
  return bound
}

function strictLocalSourceEdit(irChangeContract: string): string {
  const withEdit = irChangeContract.replace(BOUND_REVISE_CLAUSE, LOCAL_EDIT_CLAUSE)
  if (withEdit === irChangeContract) throw new Error("IR change contract no longer carries the revise clause; the local source edit wording has nowhere to project")
  return withEdit
}

/** The strict CI example shows the division: instruction plus handoff, no rule blocks. */
function instructionOnlyTask(task: string): string {
  const paragraphs = task.split("\n\n")
  return paragraphs.length <= 2 ? task : `${paragraphs[0]!}\n\n${paragraphs[paragraphs.length - 1]!}`
}

/** Generation projections only; the committed domain object remains Candidate. */
export interface GenerationSchemaOptions {
  /** True for a CI batch that carries no user delegation: an execution assessment. */
  assessment?: boolean
  /** Existing checker configuration, passed within code rather than model input. */
  checkRequired?: boolean
  /**
   * An ordinary CI batch whose request shows an execution with status active:
   * only then does the answer carry execution decisions (continue, stop or
   * await_result).  Assessments and retry belong to the assessment batch.
   */
  activeExecutions?: boolean
}

/** Whether a request's executions include one that is running; the schema is built per request from this. */
export function hasActiveExecution(request: unknown): boolean {
  const executions = request !== null && typeof request === "object" ? (request as { executions?: unknown }).executions : undefined
  return Array.isArray(executions) && executions.some(entry => entry !== null && typeof entry === "object" && (entry as { status?: unknown }).status === "active")
}

export const RETRY_IN_DELEGATION_BATCH = "retry is decided only in the batch that carries the execution return, which assesses that Atom version not_satisfied; a delegation batch may continue, stop or await_result an active execution"

const ORDINARY_DECISION_DESCRIPTION = "continue keeps an active execution for unchanged authorized work; stop closes it; await_result permits only its return."

export function buildGenerationSchema(stage: GenerationStage, profile?: StrictSchemaProfile, options: GenerationSchemaOptions = {}): Record<string, unknown> {
  const schema = structuredClone(profile === undefined
    ? withLocalSourceEditBranch(stage === "ir")
    : buildStrictCandidateSchema(profile, { localSourceEdit: stage === "ir" })) as SchemaNode
  const group = schema.definitions.group as SchemaNode
  const remove = (object: SchemaNode, keys: string[]) => {
    for (const key of keys) delete object.properties[key]
    object.required = object.required.filter((key: string) => !keys.includes(key))
  }
  // The revision a revise, retire or edit expects is the supplied IR's
  // current one: code fills it, so the answer names the object by id only.
  const change = schema.definitions.ir_change as SchemaNode
  for (const variant of change.oneOf ?? change.anyOf ?? []) {
    if ((variant as SchemaNode).properties?.expected_revision !== undefined) remove(variant as SchemaNode, ["expected_revision"])
  }
  if (stage === "ir") remove(group, ["compilation", "coverage", "execution_decisions", "assessments", "checks"])
  else {
    remove(group, ["ir_changes"])
    remove(schema, ["source_coverage"])
    // Identities code already knows are bound by code: the Atom versions a
    // Relation joins, and the authorization basis of an Atom, its rules and its
    // Relations.  The answer names Atoms by id and states only the semantic
    // choices: which Atoms depend on which, and which operations are granted.
    for (const name of ["atom", "atom_draft"]) {
      const authority = (schema.definitions[name] as SchemaNode | undefined)?.properties?.authority as SchemaNode | undefined
      if (authority !== undefined) remove(authority, ["basis"])
    }
    remove(schema.definitions.permission_rule as SchemaNode, ["resource_ref"])
    // An assessment's evidence is this batch's return; code binds the event and
    // the explanation says which parts of it the judgement relied on.
    remove(group.properties.assessments.items as SchemaNode, ["evidence_refs"])
    const relation = schema.definitions.relation as SchemaNode
    remove(relation, ["basis"])
    const endpointRefs = schema.definitions.ref_or_local as SchemaNode
    const atomId = (endpointRefs.oneOf ?? endpointRefs.anyOf).find((branch: SchemaNode) => branch.properties?.local_ref)
    for (const end of ["predecessor", "successor"]) {
      relation.properties[end] = { ...structuredClone(atomId), description: "The Atom by its atom_id, new or existing. Code binds the version in this plan; give no revision or digest." }
    }
    if (options.assessment !== true) {
      // Assessments and retry belong to the return batch; a delegation batch
      // decides only what becomes of a running execution.
      remove(group, ["assessments"])
      if (options.activeExecutions === true) {
        const decision = (group.properties.execution_decisions.items as SchemaNode).properties.decision as SchemaNode
        decision.enum = decision.enum.filter((value: string) => value !== "retry")
        decision.description = ORDINARY_DECISION_DESCRIPTION
      } else remove(group, ["execution_decisions"])
      // The parent proposal already fixes these, and assembly takes the parent
      // values: an ordinary CI answer states the basis and each group's task
      // identity and dependencies only to have them checked and replaced.  An
      // assessment batch addresses its own task, so it keeps that shape.
      remove(schema, ["basis"])
      remove(group, ["task_refs", "depends_on", "local_ref"])
      remove(schema.definitions.draft as SchemaNode, ["task_id"])
      // Only this field selects current requirements from the fixed parent.
      // Keep the existing identity-only branch; shared and historical Refs,
      // coverage destinations and assessment responses retain their shape.
      const references = schema.definitions.ref_or_local as SchemaNode
      const local = (references.oneOf ?? references.anyOf).find((branch: SchemaNode) => branch.properties?.local_ref)
      schema.definitions.coverage.properties.requirement = {
        ...structuredClone(local),
        description: "Select a content item (or the task-level coverage entry) of this group's fixed parent task by local_ref. Code supplies its current revision and digest. Return no version or digest here.",
      }
    }
    if (options.assessment === true) {
      // An assessment answers exactly this batch's events; code fills them.
      const basis = schema.properties.basis as SchemaNode
      remove(basis, ["event_ids"])
      basis.description = "refs may cite existing objects you assessed; management fills this batch's trigger events."
    }
    if (options.assessment === true || options.checkRequired !== true) {
      schema.properties.parent_issues = { type: "array", items: { type: "string", minLength: 1 }, description: "Concrete defects in the supplied parent IR. If nonempty, return groups: [] instead of changing or compiling the parent." }
      schema.required.push("parent_issues")
    }
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

export function validateGenerationProposal(stage: GenerationStage, value: unknown, options: GenerationSchemaOptions = {}): CandidateSchemaResult {
  const validate = new Ajv({ allErrors: true, strict: false, allowUnionTypes: true }).compile(buildGenerationSchema(stage, undefined, options))
  const ok = validate(value)
  const errors = (validate.errors ?? []).map(error => `${error.instancePath || "/"}: ${error.message ?? "invalid"}`)
  if (stage === "ci" && options.assessment !== true && Array.isArray((value as CIProposal | undefined)?.groups)
    && (value as CIProposal).groups.some(group => Array.isArray(group?.execution_decisions) && group.execution_decisions.some(decision => decision?.decision === "retry"))) errors.push(`/groups: ${RETRY_IN_DELEGATION_BATCH}`)
  if (ok && stage === "ci") {
    const proposal = value as CIProposal
    if (proposal.parent_issues?.length && proposal.groups.length > 0) errors.push("/groups: must be empty when parent_issues is nonempty")
  }
  return { ok: ok && errors.length === 0, errors }
}

function atomIdOf(endpoint: unknown): { local_ref: string } {
  if (endpoint !== null && typeof endpoint === "object") {
    const value = endpoint as { local_ref?: unknown; id?: unknown }
    if (typeof value.local_ref === "string") return { local_ref: value.local_ref }
    if (typeof value.id === "string") return { local_ref: value.id }
  }
  return endpoint as { local_ref: string }
}

/**
 * An answer written to the earlier CI contract still carries identities code
 * now binds: authority.basis, each rule's resource_ref, each Relation's basis,
 * exact Relation endpoint versions, each assessment's evidence_refs, an
 * assessment's basis.event_ids and an ordinary group's local_ref, assessments
 * and (with no active execution) empty execution_decisions.  They are
 * dropped (an endpoint keeps its atom id) before the answer is validated; the
 * recorded text keeps them as returned.
 */
export function dropCodeBoundIdentities(answer: unknown, assessment: boolean, activeExecutions = false): void {
  if (answer === null || typeof answer !== "object" || !Array.isArray((answer as { groups?: unknown }).groups)) return
  const basis = (answer as { basis?: unknown }).basis
  if (assessment && basis !== null && typeof basis === "object") delete (basis as { event_ids?: unknown }).event_ids
  for (const group of (answer as { groups: unknown[] }).groups) {
    if (group === null || typeof group !== "object") continue
    const record = group as Record<string, any>
    if (!assessment) {
      delete record.local_ref
      // A delegation batch carries no assessments, and an empty decision list
      // is no decision when no execution is active.
      delete record.assessments
      if (!activeExecutions && Array.isArray(record.execution_decisions) && record.execution_decisions.length === 0) delete record.execution_decisions
    }
    for (const judged of Array.isArray(record.assessments) ? record.assessments : []) if (judged && typeof judged === "object") delete judged.evidence_refs
    const drafts = record.compilation?.decision === "replace" && Array.isArray(record.compilation.drafts) ? record.compilation.drafts : []
    for (const draft of drafts) {
      for (const atom of Array.isArray(draft?.atoms) ? draft.atoms : []) {
        if (atom?.authority && typeof atom.authority === "object") {
          delete atom.authority.basis
          for (const rule of Array.isArray(atom.authority.rules) ? atom.authority.rules : []) if (rule && typeof rule === "object") delete rule.resource_ref
        }
      }
      for (const relation of Array.isArray(draft?.relations) ? draft.relations : []) {
        if (!relation || typeof relation !== "object") continue
        delete relation.basis
        relation.predecessor = atomIdOf(relation.predecessor)
        relation.successor = atomIdOf(relation.successor)
      }
    }
  }
}

/** An IR answer written to the earlier contract may still state the expected revisions code now fills. */
export function dropCodeBoundIrIdentities(answer: unknown): void {
  if (answer === null || typeof answer !== "object" || !Array.isArray((answer as { groups?: unknown }).groups)) return
  for (const group of (answer as { groups: unknown[] }).groups) {
    const changes = group !== null && typeof group === "object" ? (group as { ir_changes?: unknown }).ir_changes : undefined
    for (const change of Array.isArray(changes) ? changes : []) if (change && typeof change === "object") delete (change as { expected_revision?: unknown }).expected_revision
  }
}

/** Project the existing encoding example, without inventing another task. */
export function buildGenerationExample(stage: GenerationStage, profile?: StrictSchemaProfile, assessment = false, checkRequired = false, activeExecutions = false): IRProposal | CIProposal {
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
  const { source_coverage: _sourceCoverage, basis, ...rest } = example
  const ordinary = assessment !== true
  // The CI answer leaves out the identities code binds, so it is narrower than the stored draft types.
  return <CIProposal><unknown>{
    ...rest, ...(ordinary ? {} : { basis: { refs: basis.refs } }),
    ...(ordinary && checkRequired ? {} : { parent_issues: [] }),
    groups: example.groups.map(({ ir_changes: _irChanges, task_refs, depends_on, local_ref, assessments, execution_decisions, ...group }) => ({
      ...(ordinary ? {} : { local_ref }),
      ...group,
      ...(ordinary ? {} : { assessments }),
      ...(ordinary && !activeExecutions ? {} : { execution_decisions: ordinary ? execution_decisions.filter(decision => decision.decision !== "retry") : execution_decisions }),
      coverage: ordinary ? group.coverage.map(entry => ({ ...entry, requirement: {
        local_ref: "local_ref" in entry.requirement ? entry.requirement.local_ref : entry.requirement.id,
      } })) : group.coverage,
      ...(ordinary ? {} : { task_refs, depends_on }),
      compilation: group.compilation.decision === "replace"
        ? {
          ...group.compilation,
          drafts: group.compilation.drafts.map(draft => {
            const { task_id, ...draftRest } = draft
            return {
              ...draftRest,
              ...(ordinary ? {} : { task_id }),
              atoms: draft.atoms.map(atom => {
                const { basis: _basis, ...authority } = atom.authority
                return { ...atom, task: instructionOnlyTask(atom.task),
                  authority: { ...authority, rules: authority.rules.map(({ resource_ref: _resource, ...rule }) => rule) } }
              }),
              relations: draft.relations.map(({ basis: _basis, predecessor, successor, ...relation }) => ({
                predecessor: atomIdOf(predecessor), successor: atomIdOf(successor), ...relation,
              })),
            }
          }),
        }
        : group.compilation,
    })),
  }
}

/** CI wording when this batch carries no user delegation and assesses an execution. */
function assessmentStageInstruction(): string {
  return [
    "CI stage (execution assessment): request.ir is the stored IR.",
    "This batch carries no user delegation, so the user requirements are not yours to revise: return no ir_changes and no source_coverage.",
    "Judge the returned execution on two things only: whether it satisfies the assigned Atom's completion criteria as written, and whether it violates the user's own words. The user's own words are the assigned requirement passages in the Atom task, labelled by user input and read together across inputs (a block that points to request.ir content stands for that text). Assess that work — satisfied, not_satisfied or unknown — and name the evidence you used; evidence_required says what to look at and is not itself a condition.",
    ASSESSMENT_RESULTS,
    "An objection to the stored IR's wording, redundancy, evidence phrasing or output description is not grounds to withhold that judgement: assess the work anyway and state the reservation in the assessment explanation.",
    "Report parent_issues only when a stored-IR defect makes the judgement impossible — for example a completion condition that cannot be observed in this host at all. The IR belongs to the whole task and is revised only by user input, so such a defect is recorded as a question for the next delegation, the IR is left unchanged, and this batch still completes.",
    "request.compiled shows each current Atom complete; superseded or legacy versions appear only in compiled[].historical_atoms by identity and lifecycle status. In an Atom task, a requirement block whose body reads (text identical to IR content <id>@<revision> <digest> supplied in this request) stands for the exact text of that IR content item in request.ir.",
    "Management fills basis.event_ids with this batch's trigger events; basis.refs may cite existing objects you assessed.",
    "generation_repair.ir_proposal carries the stored task groups; keep each group's task_refs and depends_on.",
    "Write the assessments and execution_decisions for this batch yourself from its evidence. Management binds each assessment's evidence_refs to this batch's return event, so say in explanation which parts of the return (report text, recorded tool results) the judgement relies on. An execution return is never an IR source, only evidence for those fields.",
    "Compile only what the current IR and this evidence require: reuse the current Compiled Intent when the plan is unchanged, and replace it only where the plan must change. Preserve retained work and real dependencies.",
    "For each returned execution, decide stop or retry. retry asks management to run the same Atom version once more as a new execution; it applies when this batch assesses that version not_satisfied and the plan is reused. A return without a completion claim is run once more by management when the plan stands. Each Atom version runs at most twice between two user inputs, however it is offered, so a retry past that limit closes the execution like stop. With reuse and stop the returned Atom version does not run again until a user update changes the plan.",
    "Otherwise parent_issues is [].",
  ].join(" ")
}

const CHECKED_PARENT_ROLE = "Compile the fixed parent IR into a plan and requirement assignments. The independent check compares original requirements and applicable updates with the parent IR and the final prepared candidate; deciding whether the original requirements were correctly represented belongs to that check. Do not add requirements absent from the parent IR or return the parent for semantic correction."

export function generationStageInstruction(stage: GenerationStage, assessment = false, checkRequired = false, activeExecutions = false): string {
  if (assessment && stage === "ci") return assessmentStageInstruction()
  const shared = `You are the read-only management model for Intent Compiler v2. One Intent IR maintains the whole user task; its Compiled Intent is the complete plan containing Atoms and Relations. Do not execute business work, use business tools, inspect or modify files, invent execution facts, or answer the business task. Return only the current generation stage's schema-constrained projection. The field contracts describe the final Candidate; fields excluded by this stage belong to the other stage and must not be returned. Original sources remain evidence for understanding, never permission to bypass the supplied stage boundary. Preserve user requirements, their real role and scope, and distinguish success from a blocker. ${LATER_STATEMENT_SETTLES}`
  return `${shared}\n${stage === "ir"
    ? "IR stage: interpret current delegation and updates against prior state, select every effective requirement and its source, role and scope, and return the IR changes and any explicit source dispositions. Return no compilation, coverage, execution decisions, assessments or checks. Do not write Atoms. Preserve existing identities and unchanged requirements. Declare required input/output identities when field scopes depend on them. The compiler will materialize this IR before asking for the execution plan."
    : `CI stage: request.ir is the actual temporary parent IR to compile. It is fixed for this response. The compiler already holds the parent proposal's basis and each parent group's task identity and dependencies, and fills them at assembly, so this response carries no basis, task_refs, depends_on or compilation.drafts[].task_id: bind to a parent group by its local_ref only. In coverage.requirement use only {local_ref: <content item_id or task_id in this group's parent task>}; code binds the current parent revision and digest. Coverage refs still express the actual destinations. compilation.intent_basis identifies the task/content used by the plan. generation_repair.ir_proposal identifies the parent groups and their open questions, not a substitute for the actual IR text. Compile each group's compilation and coverage, author the checks the plan requires${activeExecutions ? " and an execution decision (continue, stop or await_result) for each active execution" : ""}, and add questions only for concrete compilation uncertainty; the compiler keeps the parent's questions. ${checkRequired ? CHECKED_PARENT_ROLE : "If the parent IR itself needs correction, report parent_issues instead of changing it."} Return no ir_changes or source_coverage. Execution assessments and retry belong to the batches that carry an execution return, not to this one: write no assessments. Write each Atom's work instruction — action, boundaries, ordering and handoff — from the complete applicable IR requirements, including definitions, public interfaces, shared rules, conditions and exceptions; management code attaches the assigned requirement texts verbatim to the delivered task after preparation, including passages an assigned item once adopted and later withdrew, all labelled and ordered by user input, so do not copy or paraphrase rule blocks into the candidate task. request.compiled shows each current Atom complete; superseded or legacy versions appear only in compiled[].historical_atoms by identity and lifecycle status. In an existing Atom task, a requirement block whose body reads (text identical to IR content <id>@<revision> <digest> supplied in this request) stands for the exact text of that IR content item, which the same request supplies in request.ir. Coverage selects what the attached text will contain; references and coverage cannot replace executable behavior. Preserve retained work and real dependencies. ${checkRequired ? "" : "Original input may reveal an IR omission or wrong role/scope: report concrete parent_issues and groups: [] so management returns to the IR stage; never silently repair the parent or add an unsupported requirement in the plan. Otherwise parent_issues is []."}`}`
}

const RETURN_ASSESSMENT_RULE = "On execution_return, compare"
const BASE_DECISION_SENTENCE = "After a user update, an active execution continues only with an explicit continue decision for unchanged authorized work; stop closes its authority, await_result permits only its return, retry dispatches a returned Atom version once more."
const ORDINARY_DECISION_SENTENCE = "Execution decisions are offered only while an execution is active. After a user update, an active execution continues only with an explicit continue decision for unchanged authorized work; stop closes its authority, await_result permits only its return. Assessments and retry belong to the batches that carry an execution return."
const ORDINARY_RETURN_RULE = `Execution returns are assessed by their own batches, so this batch writes no assessments and no retry. Read execution_outcomes, assessments (the latest batch's assessment of each current Atom version, verbatim) and atom_states with current events. ${ASSESSMENT_RESULTS} Reuse the CI when remaining work is unchanged; replace affected work when the current delegation requires replanning, preserving the required result and all unaffected work. An executor's completed claim, blocker report or missing-check explanation is not success evidence. Never weaken completion or rewrite IR to make a return pass. A closed execution is never reopened.`
const BASE_ATOM_REFS_CI = "Name assessments.target_ref and previous_atom_ref by an Atom id and revision supplied in atom_refs; management binds each Ref's digest, and binds an assessment of this batch's return to the Atom version that execution ran."

/**
 * A delegation batch's CI answer carries no assessments: they, and retry,
 * belong to the batch that carries the return.  The rules say so, and name
 * execution decisions only for an active execution.  Replaced wording that is
 * absent throws, so a changed base contract cannot silently keep the old text.
 */
function ordinaryCIRules(rules: readonly string[]): string[] {
  let returnRule = false
  let decisions = false
  const out = rules.map(rule => {
    if (rule.startsWith(RETURN_ASSESSMENT_RULE)) { returnRule = true; return ORDINARY_RETURN_RULE }
    if (rule.includes(BASE_DECISION_SENTENCE)) { decisions = true; return rule.replace(BASE_DECISION_SENTENCE, ORDINARY_DECISION_SENTENCE) }
    return rule
  })
  if (!returnRule || !decisions) throw new Error("contract rules no longer carry the return-assessment or execution-decision clause; the delegation-batch wording cannot be projected")
  return out
}

/** The ordinary CI Atom contract names no assessment target. */
function withoutAssessmentRefs(atomContract: string): string {
  const next = atomContract.replace(BASE_ATOM_REFS_CI, "Name previous_atom_ref by an Atom id and revision supplied in atom_refs; management binds each Ref's digest.")
  if (next === atomContract) throw new Error("Atom contract no longer carries the assessment target wording; the delegation-batch wording cannot be projected")
  return next
}

/** Retain field semantics while replacing the joint-response shape and example. */
export function generationContract<T extends { ir_change_contract: string; atom_contract: string; candidate_shape: string; example_candidate: string }>(
  contract: T & { rules?: readonly string[]; reference_contract?: string }, stage: GenerationStage, profile?: StrictSchemaProfile, assessment = false, checkRequired = false, activeExecutions = false,
): T {
  const checkedCI = stage === "ci" && !assessment && checkRequired
  const ordinaryCI = stage === "ci" && !assessment
  // Every strict stage reads the identities code binds the same way.
  const rules = contract.rules?.map(rule => rule === BASE_EXISTING_OBJECTS_RULE ? BOUND_EXISTING_OBJECTS_RULE : rule)
  return {
    ...contract,
    ...(contract.reference_contract === undefined ? {} : { reference_contract: contract.reference_contract.replace(BASE_EXISTING_IDENTITIES, BOUND_EXISTING_IDENTITIES) }),
    ...(rules === undefined ? {} : { rules }),
    ir_change_contract: stage === "ir"
      ? strictLocalSourceEdit(codeBoundRevisions(strictSupersededBasis(contract.ir_change_contract)))
      : codeBoundRevisions(strictSupersededBasis(contract.ir_change_contract)),
    atom_contract: (ordinaryCI ? (text: string) => withoutAssessmentRefs(codeBoundIdentities(text)) : stage === "ci" ? codeBoundIdentities : (text: string) => text)(assembledAtomContract(contract.atom_contract)).replace(
      "Revise the affected IR items and every affected task, input/output, completion condition, Relation and assignment together.",
      checkedCI ? "Compile the affected task, input/output, completion condition, Relation and assignment from the fixed parent IR; the independent check judges whether the original update was correctly represented."
        : "Revise the affected IR items and every affected task, input/output, completion condition, Relation and assignment together.",
    ),
    ...(stage === "ci" && !checkedCI && rules !== undefined ? { rules: (ordinaryCI ? ordinaryCIRules : (all: readonly string[]) => [...all])(rules.map(boundEvidence)) } : {}),
    ...(checkedCI && rules !== undefined ? { rules: ordinaryCIRules(rules.map(boundEvidence)).map(rule => {
      if (rule.startsWith("When configured, an independent checker")) return `${CHECKED_PARENT_ROLE} Execution decisions belong in candidate.groups[].execution_decisions. ${ORDINARY_DECISION_SENTENCE} Unreviewed work remains suspended.`
      if (rule.startsWith("When validation_errors, previous_rejection")) return "On CI repairs, use the fixed parent IR and the reported plan defects to repair the complete plan. Preserve unrelated correct work, restore requirements present in that IR but missing from the plan, and correct assignments and Relations without changing IR or adding requirements absent from it. An independent IR finding returns to the IR stage through repair_target: ir."
      if (rule.startsWith("Before returning, compare the original delegation")) return "Before returning, compare every applicable fixed parent IR requirement with the whole plan's concrete tasks and completion. Fill missing plan behavior and remove unsupported plan restrictions while keeping the parent IR fixed."
      if (rule.startsWith("A first batch for a new delegation")) return "For initial compilation, compile the actual temporary parent IR supplied in request.ir and preserve the parent groups identified by generation_repair.ir_proposal."
      if (rule.startsWith("carried_delegations names earlier user delegations")) return "Compile this batch's delegations, including carried work, as represented in the fixed parent IR. The independent check judges whether that representation retains the original delegations."
      return rule
    }) } : {}),
    candidate_shape: stage === "ir"
      ? "IR stage response = {schema_version:2,basis,source_coverage,groups}. Each group uses the existing CandidateGroup fields except compilation, coverage, execution_decisions, assessments and checks, which are forbidden in this response. The final Candidate is assembled only after CI generation."
      : assessment
        ? "CI stage (execution assessment) response = {schema_version:2,basis:{refs},parent_issues,groups}. Each group uses the existing CandidateGroup fields except ir_changes. source_coverage is forbidden. Management fills basis.event_ids with this batch's trigger events; basis.refs may cite existing objects you assessed. Keep each group's task_refs and depends_on, and write assessments and execution_decisions from this batch's evidence. Assess the returned work against the Atom's completion criteria and the user's own words; a reservation about the IR's wording, redundancy or evidence phrasing belongs in the assessment explanation, and parent_issues is only for a stored-IR defect that makes the judgement impossible. If parent_issues is nonempty, groups must be empty."
        : `CI stage response = {schema_version:2,${checkedCI ? "" : "parent_issues,"}groups}. Each group uses the existing CandidateGroup fields except ir_changes, task_refs, depends_on and compilation.drafts[].task_id, which the compiler fills from the parent, and assessments, which belong to the batch that carries an execution return; source_coverage and basis are forbidden. execution_decisions is present only while an execution is active, and then offers continue, stop or await_result. coverage.requirement is {local_ref: <content item_id or task_id in this group's parent task>}, with no revision or digest; coverage refs keep their destination expression. Bind to a parent group by its local_ref. ${checkedCI ? CHECKED_PARENT_ROLE : "If parent_issues is nonempty, groups must be empty; otherwise"} Supply each parent group's compilation and coverage, and add questions only for concrete compilation uncertainty (the compiler keeps the parent's questions).`,
    example_candidate: JSON.stringify(buildGenerationExample(stage, profile, assessment, checkRequired, activeExecutions), null, 2),
  }
}
