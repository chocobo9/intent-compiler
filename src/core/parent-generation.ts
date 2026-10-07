import { RETRY_IN_DELEGATION_BATCH } from "../model/generation-schema.js"
import { projectAssessments, projectCompiled } from "./request-projection.js"
import { atomRef, compiledIntentRef } from "./compiled-intent.js"
import { digestOf, type Candidate, type CompiledIntent, type LocalSourceEditRecord, type Ref, type SourceRef, type TaskIntent } from "./intent-contract.js"
import { IntentStateManager } from "./intent-state-v2.js"
import { aliasDisplay, decodeIRProposal, expressIRRequest, type SourceAliasEntry, type SourceAliasIndex } from "./source-aliases.js"
import { materializeSourceContent, recordEditedRemovals, sourceSegments, validateSourceCoverage } from "./source-payload.js"
import type { CompilerModelV2Input, CompilerModelV2Result } from "../model/compiler-model-v2.js"
import type { IRProposal, CIProposal, CIProposalGroup } from "../model/generation-schema.js"

/** The CI parent_basis comparison was removed; runs saved before then still name its rejection. */
export const RETIRED_PARENT_BASIS_REJECTION = "CI names a different parent basis"

/** A recorded rejection message without that retired reason; undefined when nothing else remains. */
export function withoutRetiredRejection(message: string): string | undefined {
  const prefix = "candidate rejected: "
  if (!message.startsWith(prefix)) return message
  const reasons = message.slice(prefix.length).split("; ")
  const kept = reasons.filter(reason => reason !== RETIRED_PARENT_BASIS_REJECTION)
  if (kept.length === reasons.length) return message
  return kept.length === 0 ? undefined : `${prefix}${kept.join("; ")}`
}

/** Temporary generation state, never accepted intent or an authorization. */
export interface ParentGenerationState {
  source_basis: string
  phase: "ir" | "ci"
  ir_proposal?: IRProposal
  /** Code-derived repair draft; ir_proposal and call.text retain the raw decoded answer. */
  ir_repair_draft?: IRProposal
  ci_proposal?: CIProposal
  parent?: { ir: Record<string, TaskIntent>; candidate: Candidate; digest: string }
  /**
   * True when this batch carries no user delegation, so the parent is the
   * stored IR: management may assess a returned execution and change the plan,
   * but a user requirement is revised only by user input.
   */
  derived?: true
  issues: string[]
  rejected_response?: { stage: "ir" | "ci"; text: string; errors: string[] }
}

interface Options {
  input: CompilerModelV2Input
  sourceBasis: string
  restored?: ParentGenerationState
  checkRequired: boolean
  remaining(): number
  currentBasis(): string
  /**
   * The wire copy of one stage request, with the alias table it presented.
   * The table travels beside the request, never inside it: the model reads
   * aliases, the call record keeps what they stood for.
   */
  call(input: CompilerModelV2Input, meta?: {
    source_aliases?: SourceAliasEntry[]
    /** Why this run presents no aliases, when the mechanism is unsafe for it. */
    source_aliases_disabled?: string
  }): Promise<CompilerModelV2Result>
  aliases: SourceAliasIndex
  resolve(candidate: Candidate): SourceRefReport
  validateBasis(candidate: Candidate, display: (eventId: string) => string): { ok: boolean; message?: string }
  directory(ir: Record<string, TaskIntent>): CompilerModelV2Input["existing_objects"]
  /** The Atom version an execution was dispatched with, as the plan lists it; undefined when no such execution is known. */
  executionAtom?(executionId: string): Ref | undefined
}

/** What the mechanical source gate found, bounded by the resolver. */
interface SourceRefReport {
  unresolved: number
  unresolvedRefs?: Array<{
    source_id: string
    path?: string
    diagnostic?: string
    segment_id?: string
    quote?: string
    span?: { unit: string; start: number; end: number }
    reason?: string
  }>
}

/**
 * Name every rejected reference and why.  The count is exact and the list says
 * when it is capped: 39 failed IR attempts across six recorded runs were told
 * only "IR sources do not resolve" while the reasons sat unused in the
 * statistics, so the batch spent its budget re-sending the same defect.  A
 * passage a repair cannot locate is not a reason it can fix.
 */
function unresolvedSources(report: SourceRefReport, display: (eventId: string) => string): string {
  const refs = report.unresolvedRefs ?? []
  const shown = refs.map((ref) => {
    const selector = ref.segment_id !== undefined ? `segment_id=${ref.segment_id}`
      : ref.quote !== undefined ? `quote=${JSON.stringify(ref.quote)}`
      : ref.span === undefined ? "no selector"
      : `span=${ref.span.unit}:${ref.span.start}-${ref.span.end}`
    const edge = (character: string): string => `${JSON.stringify(character)} U+${character.charCodeAt(0).toString(16).toUpperCase().padStart(4, "0")}`
    const quoteEdges = ref.quote ? `; quote UTF-16 length=${ref.quote.length}, first=${edge(ref.quote[0]!)}, last=${edge(ref.quote.at(-1)!)}` : ""
    return `${ref.path ?? "unknown field"}: ${display(ref.source_id)} (${selector}): ${ref.reason ?? "unresolved"}${quoteEdges}${ref.diagnostic ? `; ${ref.diagnostic}` : ""}`
  })
  const hidden = Math.max(0, report.unresolved - refs.length)
  const list = shown.length === 0 ? ""
    : hidden > 0
      ? ` Showing the first ${refs.length} of ${report.unresolved} (${hidden} more are not listed): ${shown.join("; ")}.`
      : ` Showing all ${refs.length}: ${shown.join("; ")}.`
  return `IR sources do not resolve; ${report.unresolved} reference(s) failed the source gate for this batch.${list} Each selection needs one source_id from the supplied source_segments and exactly one selector that exists in that source: a segment_id from its list, an exact unique quote, or a span inside its text.`
}

/** Keep raw and derived drafts in the same existing IR-stage shape. */
function irProposalGroups(groups: Candidate["groups"]): IRProposal["groups"] {
  return groups.map(({
    compilation: _compilation, coverage: _coverage,
    execution_decisions: _executionDecisions, assessments: _assessments, checks: _checks, ...group
  }) => group)
}

/**
 * The digest of every stored version a Ref can name, keyed `id@revision`: IR
 * tasks with their content, bindings and outputs, every Atom version a plan
 * lists, and each compiled intent.  A digest is a function of the version it
 * names, so code writes it; the answer chooses only the id and revision.
 */
function versionDigests(irs: ReadonlyArray<Record<string, TaskIntent>>, compiled: Record<string, CompiledIntent>): Map<string, Set<string>> {
  const index = new Map<string, Set<string>>()
  const add = (ref: Ref): void => {
    const key = `${ref.id}@${ref.revision}`
    if (!index.has(key)) index.set(key, new Set())
    index.get(key)!.add(ref.digest)
  }
  for (const ir of irs) for (const task of Object.values(ir)) {
    add({ id: task.task_id, revision: task.revision, digest: digestOf(task) })
    for (const item of task.content) add({ id: item.item_id, revision: item.revision, digest: digestOf(item) })
    for (const item of task.bindings) add({ id: item.binding_id, revision: item.revision, digest: digestOf(item) })
    for (const item of task.outputs) add({ id: item.output_id, revision: item.revision, digest: digestOf(item) })
  }
  for (const intent of Object.values(compiled)) {
    add(compiledIntentRef(intent))
    for (const atom of intent.atoms) add(atomRef(atom))
  }
  return index
}

/**
 * Write the stored digest into every Ref of an answer whose id and revision
 * name exactly one stored version.  A Ref naming no stored version keeps what
 * the answer wrote, so the gate that reads it still reports it.
 */
function bindRefDigests(value: unknown, index: ReadonlyMap<string, ReadonlySet<string>>): void {
  if (Array.isArray(value)) { for (const entry of value) bindRefDigests(entry, index); return }
  if (value === null || typeof value !== "object") return
  const record = value as Record<string, unknown>
  if (typeof record.id === "string" && Number.isInteger(record.revision) && typeof record.digest === "string" && !("source_id" in record)) {
    const digests = index.get(`${record.id}@${String(record.revision)}`)
    if (digests?.size === 1) record.digest = [...digests][0]!
  }
  for (const child of Object.values(record)) bindRefDigests(child, index)
}

/**
 * The revision a revise, retire or edit expects is the supplied IR's current
 * one.  A second change to the same object in one batch then fails as such,
 * with the reason, instead of on a copied number.
 */
export function bindExpectedRevisions(group: Candidate["groups"][number], stored: Record<string, TaskIntent>): void {
  const task = stored[group.task_refs[0] ?? ""]
  if (task === undefined) return
  for (const change of group.ir_changes as Array<Record<string, unknown>>) {
    if (change.action !== "revise" && change.action !== "retire" && change.action !== "edit") continue
    const current = change.target === "task" || change.target === "current_scope" ? task.revision
      : change.target === "content" ? task.content.find(item => item.item_id === change.id)?.revision
        : change.target === "binding" ? task.bindings.find(item => item.binding_id === change.id)?.revision
          : change.target === "output" ? task.outputs.find(item => item.output_id === change.id)?.revision
            : undefined
    if (current !== undefined) change.expected_revision = current
  }
}

/**
 * A content value's about and support refs name objects by id.  An object of
 * the supplied IR is bound to the version that IR holds; one created in this
 * batch has no digest yet, so it is bound to revision 0 and settled once the
 * batch's changes are applied (settleContentRefs).  An id naming neither is
 * rejected: the answer would otherwise cite nothing.
 */
export function bindContentRefs(candidate: Candidate, supplied: Record<string, TaskIntent>): void {
  const created = new Set<string>()
  for (const group of candidate.groups) for (const change of group.ir_changes) {
    if (change.action === "create") created.add(change.local_ref)
  }
  const bind = (value: unknown, where: string): unknown => {
    const id = namedId(value)
    if (id === undefined) return value
    for (const task of Object.values(supplied)) {
      const version = irVersion(task, id)
      if (version !== undefined) return version
    }
    if (created.has(id)) return { id, revision: 0, digest: "pending" }
    throw new Error(`${where} names ${id}, which is neither an object of the supplied IR nor created in this batch; name an existing object by its id`)
  }
  for (const group of candidate.groups) for (const change of group.ir_changes) {
    if (change.action !== "create" && change.action !== "revise") continue
    if (change.target !== "content" || change.value === null || typeof change.value !== "object") continue
    const value = change.value as { about?: unknown; support?: unknown }
    const label = `content ${change.action === "create" ? change.local_ref : change.id}`
    if (Array.isArray(value.about)) value.about = value.about.map(ref => bind(ref, `${label} about`))
    if (Array.isArray(value.support)) for (const item of value.support) {
      if (item !== null && typeof item === "object" && Array.isArray((item as { refs?: unknown }).refs)) {
        (item as { refs: unknown[] }).refs = (item as { refs: unknown[] }).refs.map(ref => bind(ref, `${label} support`))
      }
    }
  }
}

/** Write the digests of objects this batch created into the refs that named them; a few passes settle refs between requirements. */
function settleContentRefs(ir: Record<string, TaskIntent>): void {
  for (let pass = 0; pass < 4; pass += 1) {
    let changed = false
    for (const task of Object.values(ir)) for (const item of task.content) {
      for (const ref of [...item.about, ...item.support.flatMap(support => support.refs)]) {
        const version = Object.values(ir).map(owner => irVersion(owner, ref.id)).find(found => found !== undefined)
        if (version !== undefined && version.revision === ref.revision && version.digest !== ref.digest) { ref.digest = version.digest; changed = true }
      }
    }
    if (!changed) return
  }
}

function unboundMessage(targets: readonly string[]): string {
  return `assessments.target_ref names no Atom version of this plan: ${targets.join(", ")}; name the assessed Atom by an id and revision listed in atom_refs`
}

/** The id an answer's Ref or {local_ref} names; a SourceRef or anything else names none. */
function namedId(value: unknown): string | undefined {
  if (value === null || typeof value !== "object" || "source_id" in value) return undefined
  const named = value as { local_ref?: unknown; id?: unknown }
  return typeof named.local_ref === "string" ? named.local_ref : typeof named.id === "string" ? named.id : undefined
}

/** Every IR object of a task an answer may name by id, with its current version. */
function irVersion(task: TaskIntent, id: string): Ref | undefined {
  if (id === task.task_id) return { id, revision: task.revision, digest: digestOf(task) }
  const entry = task.content.find(item => item.item_id === id) ?? task.bindings.find(item => item.binding_id === id) ?? task.outputs.find(item => item.output_id === id)
  if (entry === undefined) return undefined
  return { id, revision: entry.revision, digest: digestOf(entry) }
}

const SOURCE_REPAIR_DRAFT_NOTICE = "generation_repair.ir_proposal is a code-derived repair draft, not raw model output: successfully resolved selectors reuse their exact UTF-16 spans and code-computed digests; failed references retain their original values. You may still revise the proposal's meaning and selections."

/** Owns parent preparation, child admission and restoration at one generation seam. */
export class ParentGeneration {
  readonly state: ParentGenerationState
  /**
   * The alias table of the last IR-stage request: the wire form of the events
   * that request displayed.  Feedback written for that request renders event
   * ids through this table, so the model is never asked to fix an id it has
   * not seen.
   */
  private stageAliases: readonly SourceAliasEntry[] = []
  constructor(private readonly options: Options) {
    const restored = options.restored
    // A batch that carries no user delegation assesses recorded execution: its
    // parent is the stored IR, never a proposal of its own.
    const carriesUserInput = options.input.events.some(event => event.kind === "user_input")
    this.state = restored?.source_basis === options.sourceBasis
      ? structuredClone(restored) : { source_basis: options.sourceBasis, phase: carriesUserInput ? "ir" : "ci", issues: [] }
    // State saved under the earlier contract echoes the parent digest and the
    // rejection it caused; the repair request carries both back, and the
    // parent is code's.
    delete (this.state.ci_proposal as { parent_basis?: unknown } | undefined)?.parent_basis
    this.state.issues = this.state.issues.filter(issue => issue !== RETIRED_PARENT_BASIS_REJECTION)
    if (!carriesUserInput) {
      this.state.derived = true
      delete this.state.ir_proposal
      delete this.state.ir_repair_draft
      this.state.phase = "ci"
      this.state.parent = this.derivedParent()
      return
    }
    delete this.state.derived
    // Reconstruct from the original baseline, not by applying changes to the temporary parent again.
    if (this.state.parent && this.state.ir_proposal) {
      try {
        const parent = this.prepare(this.state.ir_proposal)
        if (parent.digest !== this.state.parent.digest) throw Error("restored parent differs from its recorded basis")
        this.state.parent = parent
      } catch { this.invalidate(["Saved parent no longer resolves against the current basis; maintain IR again."]) }
    } else if (this.state.phase === "ci") this.invalidate(["Missing prepared parent; maintain IR first."])
  }

  requiredCalls(): number { return (this.state.phase === "ir" ? 2 : 1) + Number(this.options.checkRequired) }

  /** How the current IR-stage request wrote these events; full ids when it did not. */
  display(eventId: string): string { return aliasDisplay(this.stageAliases)(eventId) }

  feedback(issues: string[]): void { if (issues.length) this.state.issues = [...issues] }

  invalidate(issues: string[]): void {
    delete this.state.ci_proposal
    delete this.state.rejected_response
    this.state.issues = issues
    // The IR belongs to the whole task, so only a user delegation revises it:
    // an assessment batch keeps the stored IR as its fixed parent.
    if (this.state.derived) return
    this.state.phase = "ir"
    delete this.state.parent
  }

  /**
   * The parent of an assessment batch: the stored IR itself. It carries no
   * earlier proposal, so the child owes it the batch it answers, the stored IR
   * identity and each stored task's identity — not a byte-copy of decisions
   * some other stage authored moments ago.
   */
  private derivedParent(): NonNullable<ParentGenerationState["parent"]> {
    const ir = structuredClone(this.options.input.ir)
    // Give the child the stored task identities it owes an answer for. Their
    // decisions are empty: this batch has no earlier stage that authored any.
    return {
      ir,
      candidate: {
        schema_version: 2,
        basis: { event_ids: this.options.input.events.map(event => event.event_id), refs: [] },
        source_coverage: [],
        groups: this.skeletonGroups(ir),
      },
      digest: digestOf(ir),
    }
  }

  /** One group per stored task, with no decisions of its own. */
  private skeletonGroups(ir: Record<string, TaskIntent>): Candidate["groups"] {
    return Object.keys(ir).map(taskId => ({
      local_ref: taskId,
      task_refs: [taskId],
      depends_on: [],
      ir_changes: [],
      compilation: { decision: "reuse", current: [], reason: "Assessment parent: the stored plan stands until the child compiles it." },
      execution_decisions: [],
      assessments: [],
      coverage: [],
      checks: [],
      questions: [],
    }))
  }

  private prepare(proposal: IRProposal): NonNullable<ParentGenerationState["parent"]> {
    const candidate: Candidate = {
      ...structuredClone(proposal),
      groups: proposal.groups.map(group => ({ ...structuredClone(group), coverage: [],
        compilation: { decision: "reuse", current: [], reason: "Temporary parent; compilation has not run." },
        // The IR stage does not author these; the CI stage does.  Fill the
        // internal CandidateGroup shape so downstream code sees one type.
        execution_decisions: [], assessments: [], checks: [] })),
    }
    // Identities code knows: the revision each change expects, and Ref digests.
    for (const group of candidate.groups) bindExpectedRevisions(group, this.options.input.ir)
    bindContentRefs(candidate, this.options.input.ir)
    bindRefDigests(candidate, versionDigests([this.options.input.ir], this.options.input.compiled ?? {}))
    const basis = this.options.validateBasis(candidate, (eventId) => this.display(eventId))
    if (!basis.ok) throw Error(basis.message ?? "IR names the wrong input events")
    if (this.options.input.events.some(event => event.kind === "user_input") && candidate.groups.length === 0) {
      throw Error("User input needs an IR task and explicit handling of its requirements or uncertainty")
    }
    const sourceReport = this.options.resolve(candidate)
    if (sourceReport.unresolved > 0) {
      this.state.ir_repair_draft = { ...candidate, groups: irProposalGroups(candidate.groups) }
      throw Error(unresolvedSources(sourceReport, (eventId) => this.display(eventId)))
    }
    const sources = [...(this.options.input.source_events ?? []), ...this.options.input.events]
    const state = new IntentStateManager(this.options.input.ir)
    let ir = state.snapshot()
    const groups = new Set<string>(), tasks = new Set<string>()
    // Recorded once the whole proposal is applied, so a fragment a later group
    // re-selects in the same proposal is not called withdrawn.
    const editedRemovals: LocalSourceEditRecord[] = []
    for (const group of candidate.groups) {
      if (groups.has(group.local_ref) || group.task_refs.length !== 1 || tasks.has(group.task_refs[0]!)) {
        throw Error("Each IR group must have one distinct task and a distinct group identity")
      }
      groups.add(group.local_ref); tasks.add(group.task_refs[0]!)
      const result = new IntentStateManager(ir).apply(group.ir_changes, group.task_refs)
      if (!result.ok) throw Error(result.errors.map(e => e.message).join("; "))
      ir = result.tasks
      editedRemovals.push(...result.edits)
      const task = ir[group.task_refs[0]!]
      if (!task) throw Error("IR group names an unknown task")
      materializeSourceContent(task, group.ir_changes, sources, (eventId) => this.display(eventId))
      const targets = new Set([task.task_id, ...task.outputs.map(o => o.output_id), ...task.bindings.map(b => b.binding_id)])
      for (const item of task.content) {
        if (!item.text.trim() || !item.sources.length || !item.scope.length || item.scope.some(s => !targets.has(s.target_id))) {
          throw Error(`IR content ${item.item_id} needs actual selected text and an already declared scope target; declare its material/output in IR without widening its scope`)
        }
      }
    }
    recordEditedRemovals(candidate, ir, editedRemovals)
    settleContentRefs(ir)
    const carriedEventIds = new Set((this.options.input.carried_delegations ?? []).map((delegation) => delegation.event_id))
    const ownEventIds = new Set(this.options.input.events.filter(event => event.kind === "user_input" && !carriedEventIds.has(event.event_id)).map(event => event.event_id))
    validateSourceCoverage(candidate, this.options.input.events, sources, this.options.input.ir, ir,
      { carriedEventIds, ownEventIds, display: (eventId) => this.display(eventId) })
    return { ir, candidate, digest: digestOf(ir) }
  }

  async propose(request: CompilerModelV2Input): Promise<CompilerModelV2Result> {
    if (this.options.remaining() < this.requiredCalls()) return {
      ok: false, budget_exhausted: true, error: { code: "schema", message: "Insufficient request budget to generate the remaining parent/child stages and required check" },
    }
    const stageInput = (stage: "ir" | "ci"): { request: CompilerModelV2Input; aliases: SourceAliasEntry[] } => {
      // Request trimming (v1, semantics-preserving): each stage keeps the whole
      // current IR and every schema/validation/commit rule; it only stops
      // re-sending bodies the operation cannot use.  An IR edit carries the
      // source text of this batch plus the events the current IR already cites
      // (so retained spans stay addressable), and no compiled plan or execution
      // evidence; a CI compile re-sends neither raw source history nor anything
      // the plan does not consume.
      const {
        repair_context: _repairContext, schema_rejected_draft: _schemaRejected,
        source_events: priorSources, source_segments: _allSegments,
        compiled: plan, atom_refs: atomRefs, executions: executionView,
        execution_outcomes: outcomes, assessments: assessmentRecords, ...shared
      } = request
      const cited = new Set<string>()
      for (const task of Object.values(this.options.input.ir)) {
        for (const ref of [...task.goal.sources, ...task.current_scope.sources, ...task.content.flatMap(item => item.sources)]) {
          cited.add(ref.source_id)
        }
      }
      // An uncompiled delegation is exactly what an IR update may need to
      // adopt, so every outstanding one keeps its text here, not only the
      // three this batch carries (their ids travel in gap_event_ids).
      const gaps = new Set(this.options.input.gap_event_ids ?? [])
      // An IR proposal keeps one stage shape whether it is freshly generated,
      // re-sent after a rejection or restored from an older draft: the three
      // execution-facing fields never travel in it.
      const irGroups = irProposalGroups
      const base: CompilerModelV2Input = stage === "ir"
        ? {
          ...shared,
          source_segments: sourceSegments([
            ...(priorSources ?? []).filter(event => cited.has(event.event_id) || gaps.has(event.event_id)),
            ...this.options.input.events,
          ]),
        }
        // The plan shows each current Atom once and each historical version by
        // identity; a requirement block that repeats a parent IR item verbatim
        // points at it.
        : { ...shared, compiled: plan === undefined ? plan : projectCompiled(plan, this.options.input.atom_states ?? [], [this.state.parent!.ir]),
          atom_refs: atomRefs, executions: executionView, execution_outcomes: outcomes,
          ...(assessmentRecords === undefined ? {} : { assessments: projectAssessments(assessmentRecords, plan ?? {}, this.options.input.atom_states ?? []) }) }
      const ir = stage === "ci" ? this.state.parent!.ir : this.options.input.ir
      // An assessment batch repairs the stored IR from the user's own text: do
      // not offer the execution return as a citable source for that stage.
      const userTextIds = new Set([...(this.options.input.source_events ?? []), ...this.options.input.events]
        .filter(event => event.source?.channel === "user")
        .map(event => event.event_id))
      const offeredRefs = this.state.derived === true && stage === "ir" && base.event_source_refs !== undefined
        ? base.event_source_refs.filter(ref => userTextIds.has(ref.source_id))
        : base.event_source_refs
      const repairIssues = [...this.state.issues,
        ...(stage === "ir" && this.state.ir_repair_draft ? [SOURCE_REPAIR_DRAFT_NOTICE] : [])]
      const assembled: CompilerModelV2Input = { ...base, ...(offeredRefs === undefined ? {} : { event_source_refs: offeredRefs }),
        generation_stage: stage, ir: structuredClone(ir),
        existing_objects: this.options.directory(ir),
        validation_errors: repairIssues,
        generation_repair: { ir_proposal: stage === "ci" ? {
          ...this.state.parent!.candidate,
          // An assessment batch's parent is the stored IR as it stands now: give
          // the child current task identities, not the revisions the repair
          // proposal was written against.
          groups: irGroups((this.state.derived === true
            ? this.skeletonGroups(this.state.parent!.ir)
            : this.state.parent!.candidate.groups
          )),
        } : (this.state.ir_proposal === undefined ? undefined : {
          ...(this.state.ir_repair_draft ?? this.state.ir_proposal),
          groups: irGroups((this.state.ir_repair_draft ?? this.state.ir_proposal).groups as Candidate["groups"]),
        }), ci_proposal: this.state.ci_proposal,
          issues: repairIssues },
        ...(this.state.rejected_response?.stage === stage ? { schema_rejected_draft: {
          text: this.state.rejected_response.text, errors: this.state.rejected_response.errors,
        } } : {}),
      }
      // Only the IR stage presents aliases: the CI stage keeps the full
      // identities the plan, the check and the store use.  The table is built
      // from what this assembled request actually shows, so an event the
      // request does not display is never decodable by its alias.
      if (stage === "ci") return { request: assembled, aliases: [] }
      const expressed = expressIRRequest(assembled, this.options.aliases)
      this.stageAliases = expressed.aliases
      return expressed
    }
    if (this.state.phase === "ir") {
      const stage = stageInput("ir")
      const disabled = this.options.aliases.disabled
      const result = await this.options.call(stage.request, {
        source_aliases: stage.aliases,
        ...(disabled === undefined ? {} : { source_aliases_disabled: disabled }),
      })
      if (!result.ok || !result.ir_proposal) return result.ok ? this.reject("IR stage returned no IR proposal") : this.failed(result, "ir")
      const decoded = decodeIRProposal(result.ir_proposal, stage.aliases, (eventId) => this.options.aliases.records(eventId))
      if (!decoded.ok) {
        // The answer that failed stays the repair starting point: the next
        // request carries it back with the reason, so a repair targets the
        // draft that actually named the wrong alias.
        this.state.rejected_response = {
          stage: "ir",
          text: result.call?.text ?? JSON.stringify(result.ir_proposal, null, 2),
          errors: [decoded.message],
        }
        return this.reject(decoded.message, result)
      }
      delete this.state.rejected_response
      this.state.ir_proposal = structuredClone(decoded.proposal)
      delete this.state.ir_repair_draft
      try { this.state.parent = this.prepare(decoded.proposal) }
      catch (error) { return this.reject(error instanceof Error ? error.message : String(error), result) }
      this.state.phase = "ci"
      this.state.issues = []
    }
    if (this.options.currentBasis() !== this.options.sourceBasis) return this.reject("Input changed before CI generation; the parent is stale")
    const result = await this.options.call(stageInput("ci").request)
    if (!result.ok || !result.ci_proposal) return result.ok ? this.reject("CI stage returned no compiled proposal") : this.failed(result, "ci")
    delete this.state.rejected_response
    const child = result.ci_proposal
    this.state.ci_proposal = structuredClone(child)
    const parent = this.state.parent!
    const derived = this.state.derived === true
    const reviewsParent = derived || !this.options.checkRequired
    if (!reviewsParent && child.parent_issues !== undefined) {
      return this.reject("Ordinary CI with an independent check must not return parent_issues", result)
    }
    if (reviewsParent && child.parent_issues?.length) {
      if (derived) {
        // The stored IR is the whole task's blueprint: a returned execution
        // cannot revise it. Record the defect for the next user delegation
        // instead of repairing the IR or failing the run.
        return {
          ok: false,
          call: result.call,
          deferredAssessment: [...child.parent_issues],
          error: { code: "schema", message: `assessment deferred: ${child.parent_issues.join("; ")}` },
        }
      }
      this.invalidate(child.parent_issues)
      return this.reject(`IR needs correction: ${child.parent_issues.join("; ")}`, result)
    }
    if (!derived) {
      // The ordinary CI answer has one group per parent group, in the parent's
      // order; the basis and each group's task identity and dependencies come
      // from that parent group.
      if (child.groups.length !== parent.candidate.groups.length) {
        return this.reject(`CI groups must preserve the parent's task groups: return one group for each of the ${parent.candidate.groups.length} group(s) in generation_repair.ir_proposal.groups, in that order; received ${child.groups.length}`, result)
      }
    }
    const seen = new Set<string>()
    const groups: Candidate["groups"] = []
    for (const group of child.groups) {
      if (derived) {
        // An assessment batch binds by task: the parent skeleton's local_refs
        // are the compiler's own labels, so they are not the child's to copy.
        const taskRefs = group.task_refs ?? []
        if (taskRefs.length !== 1) return this.reject("an execution assessment needs one existing task per group: task_refs must name exactly one task", result)
        const taskId = taskRefs[0] as string
        if (parent.ir[taskId] === undefined) return this.reject(`assessment group names unknown task ${taskId}`, result)
        if (seen.has(taskId)) return this.reject(`assessment names task ${taskId} more than once`, result)
        seen.add(taskId)
        const skeleton = parent.candidate.groups.find(candidate => candidate.task_refs[0] === taskId)
        let judged: CIProposalGroup
        try { judged = this.bindCodeIdentities(group, taskId) } catch (error) { return this.reject(error instanceof Error ? error.message : String(error), result) }
        const unbound = this.unboundTargets(judged)
        if (unbound.length > 0) return this.reject(unboundMessage(unbound), result)
        const requirements = this.bindRequirements(judged.coverage, parent.ir[taskId]!)
        if ("message" in requirements) return this.reject(requirements.message, result)
        groups.push({ ...judged, coverage: requirements.bound, depends_on: skeleton === undefined ? [] : [...skeleton.depends_on], ir_changes: [] } as Candidate["groups"][number])
        continue
      }
      // A delegation batch binds each group to the parent group at its position;
      // everything structural (group and task identity, dependencies, retained
      // IR changes) is filled by this code, so the child never reproduces it.
      const original = parent.candidate.groups[groups.length]!
      if ((group.execution_decisions ?? []).some(decision => decision.decision === "retry")) {
        return this.reject(RETRY_IN_DELEGATION_BATCH, result)
      }
      const boundTask = original.task_refs[0]
      if (boundTask === undefined || parent.ir[boundTask] === undefined) {
        return this.reject(`group ${original.local_ref} is not bound to a stored task`, result)
      }
      const task = parent.ir[boundTask]!
      const requirements = this.bindRequirements(group.coverage, task)
      if ("message" in requirements) return this.reject(requirements.message.replace("CI coverage.requirement", "Ordinary CI coverage.requirement"), result)
      const coverage = requirements.bound
      if (group.compilation.decision === "replace") for (const draft of group.compilation.drafts) {
        for (const atom of draft.atoms) {
          for (const output of atom.outputs) {
            const existing = task.outputs.find(o => o.output_id === output.output_id)
            if (existing && existing.format !== output.format) return this.reject(`CI changes parent output ${output.output_id}; ${reviewsParent ? "report parent_issues" : "keep the fixed parent declaration"}`, result)
          }
          for (const input of atom.inputs) {
            const existing = task.bindings.find(b => b.binding_id === input.binding_id)
            if (existing && (digestOf(existing.ref ?? null) !== digestOf(input.ref) || existing.role !== input.role)) {
              return this.reject(`CI changes parent material ${input.binding_id}; ${reviewsParent ? "report parent_issues" : "keep the fixed parent declaration"}`, result)
            }
          }
        }
      }
      let bound: CIProposalGroup
      try { bound = this.bindCodeIdentities(group, boundTask) } catch (error) { return this.reject(error instanceof Error ? error.message : String(error), result) }
      const unbound = this.unboundTargets(bound)
      if (unbound.length > 0) return this.reject(unboundMessage(unbound), result)
      const compilation = bound.compilation.decision === "replace"
        ? { ...bound.compilation, drafts: bound.compilation.drafts.map(draft => ({ ...draft, task_id: boundTask })) }
        : bound.compilation
      groups.push({
        ...bound,
        local_ref: original.local_ref,
        // A delegation batch assesses nothing, whatever a restored draft still carries.
        ...(derived ? {} : { assessments: [] }),
        coverage,
        compilation,
        task_refs: [...original.task_refs],
        depends_on: [...original.depends_on],
        ir_changes: derived ? [] : structuredClone(original.ir_changes),
        ...(derived
          ? {}
          : { questions: [...original.questions, ...group.questions.filter(q => !original.questions.some(p => digestOf(p) === digestOf(q)))] }),
      } as Candidate["groups"][number])
    }
    this.state.issues = []
    // An assessment answers exactly this batch's events, which code knows; its
    // refs may cite what it assessed.
    const basis = derived
      ? { event_ids: this.options.input.events.map(event => event.event_id), refs: structuredClone(child.basis?.refs ?? []) }
      : parent.candidate.basis
    if (derived) bindRefDigests(basis, this.versions())
    return { ...result, candidate: { schema_version: 2, basis,
      source_coverage: derived ? [] : parent.candidate.source_coverage, groups } }
  }

  /**
   * The identities a CI answer leaves to code: each Atom's authority basis and
   * rule resource_ref, and each Relation's basis, all bound to the task's IR
   * entry - the authorization the plan compiles.  An Atom resubmitted at a
   * version the plan already holds keeps that version's bound identities, so
   * an unchanged Atom keeps its content.  Relation endpoints are bound to plan
   * versions when the plan is built.
   */
  private bindCodeIdentities<G extends CIProposalGroup>(group: G, taskId: string): G {
    const copy = structuredClone(group)
    const task = this.state.parent!.ir[taskId]!
    // A delegation batch's answer carries no assessments (the assessment batch's does).
    const assessments = copy.assessments ?? []
    for (const assessment of assessments) assessment.target_ref = this.returnedVersion(assessment.target_ref)
    // An answer names criteria by IR id; the version is the parent IR's.
    for (const assessment of assessments) {
      assessment.criteria_refs = (assessment.criteria_refs as unknown[]).map(criterion => {
        const id = namedId(criterion)
        const bound = id === undefined ? undefined : irVersion(task, id)
        if (bound === undefined) throw new Error(`assessments.criteria_refs names ${id ?? "no id"}, which is no IR item of task ${taskId}; name an IR requirement by its id`)
        return bound
      })
    }
    // A decision's basis is the Atom version its execution ran.
    for (const decision of copy.execution_decisions ?? []) {
      const ran = this.ranAtom(decision.execution_id)
      ;(decision as { basis: Ref[] }).basis = ran === undefined ? [] : [ran]
    }
    bindRefDigests(copy, this.versions())
    const judged = { ...copy, execution_decisions: copy.execution_decisions ?? [], assessments: assessments.map(assessment => ({ ...assessment, evidence_refs: this.returnEvidence(assessment.target_ref) })) }
    const compilation = judged.compilation
    // The group's current Compiled Intent is code's to name.
    if (compilation.decision !== "replace") {
      const current = this.options.input.compiled?.[taskId]
      return { ...judged, compilation: { ...compilation, current: current === undefined ? [] : [compiledIntentRef(current)] } }
    }
    const taskRef = { id: task.task_id, revision: task.revision, digest: digestOf(task) }
    const held = this.options.input.compiled?.[taskId]?.atoms ?? []
    const latest = (atomId: string) => held.filter(atom => atom.atom_id === atomId).sort((a, b) => b.revision - a.revision)[0]
    const drafts = compilation.drafts.map(draft => ({
      ...draft,
      intent_basis: this.intentBasis(draft.intent_basis as unknown[], task),
      atoms: draft.atoms.map(atom => {
        const prior = latest(atom.atom_id)
        const replaced = namedId((atom as { previous_atom_ref?: unknown }).previous_atom_ref)
        const target = replaced === undefined ? undefined : latest(replaced)
        if (replaced !== undefined && target === undefined) throw new Error(`previous_atom_ref names ${replaced}, which is no Atom of task ${taskId}'s plan; name the replaced Atom by an atom_id the plan lists`)
        const authority = atom.authority as Partial<typeof atom.authority>
        // The revision is provisional: whether the content changed is known only
        // once the requirement texts are attached, and the preparation settles it.
        return { ...atom, revision: prior === undefined ? 0 : prior.revision + 1,
          ...(target === undefined ? {} : { previous_atom_ref: atomRef(target) }),
          authority: {
            ...authority,
            basis: [structuredClone(taskRef)],
            rules: (authority.rules ?? []).map(rule => ({ ...rule, resource_ref: structuredClone(taskRef) })),
          } } as typeof atom
      }),
      relations: draft.relations.map(relation => ({ ...relation, basis: [structuredClone(taskRef)] })),
    }))
    return { ...judged, compilation: { ...compilation, drafts } }
  }

  /** The Atom version an execution ran: the dispatch's version in the plan, else the version its return named. */
  private ranAtom(executionId: string): Ref | undefined {
    const dispatched = this.options.executionAtom?.(executionId)
    if (dispatched !== undefined) return dispatched
    return this.options.input.execution_outcomes?.find(outcome => outcome.execution_id === executionId)?.outcome.atom_ref
  }

  /** The plan's basis names the task or content it uses by id; the version is the parent's. */
  private intentBasis(entries: unknown[], task: TaskIntent): Ref[] {
    const bound = new Map<string, Ref>()
    for (const entry of entries) {
      const id = namedId(entry)
      const isContent = id !== undefined && task.content.some(item => item.item_id === id)
      const version = id !== undefined && (id === task.task_id || isContent) ? irVersion(task, id) : undefined
      if (id === undefined || version === undefined) throw new Error(`compilation.intent_basis names ${id ?? "no id"}, which is no task or content item of parent task ${task.task_id}; name one by task_id or content item_id`)
      bound.set(id, version)
    }
    return [...bound.values()]
  }

  /** Coverage requirements select the fixed parent by id; the version is the parent's. */
  private bindRequirements(coverage: CIProposalGroup["coverage"], task: TaskIntent): { bound: Candidate["groups"][number]["coverage"] } | { message: string } {
    const bound: Candidate["groups"][number]["coverage"] = []
    for (const entry of coverage) {
      if (!("local_ref" in entry.requirement)) return { message: "CI coverage.requirement must select the fixed parent by local_ref, without revision or digest" }
      const id = entry.requirement.local_ref
      const matches = [
        ...(id === task.task_id ? [{ id, revision: task.revision, digest: digestOf(task) }] : []),
        ...task.content.filter(item => item.item_id === id).map(item => ({ id, revision: item.revision, digest: digestOf(item) })),
      ]
      if (matches.length !== 1) return { message: `CI coverage requirement ${id} is unknown or ambiguous in parent task ${task.task_id}` }
      bound.push({ ...entry, requirement: matches[0]! } as Candidate["groups"][number]["coverage"][number])
    }
    return { bound }
  }

  /** Stored versions an answer's Refs may name: the supplied and the parent IR, and every plan version. */
  private versions(): Map<string, Set<string>> {
    return versionDigests([this.options.input.ir, ...(this.state.parent === undefined ? [] : [this.state.parent.ir])], this.options.input.compiled ?? {})
  }

  /**
   * An assessment that names an Atom this batch returned judges the version
   * that execution ran; when the batch returned more than one version of that
   * Atom, the answer's revision chooses and only its digest is bound.
   */
  private returnedVersion(target: Ref): Ref {
    const versions = new Map<string, Ref>()
    for (const event of this.options.input.events) {
      if (event.kind !== "execution_return") continue
      const ran = (event.payload as { outcome?: { atom_ref?: Ref } } | undefined)?.outcome?.atom_ref
      if (ran !== undefined && ran.id === target?.id) versions.set(`${ran.revision}`, ran)
    }
    return versions.size === 1 ? structuredClone([...versions.values()][0]!) : target
  }

  /** Assessment targets that name no Atom version of the plan: such a judgement would bind nothing. */
  private unboundTargets(group: CIProposalGroup): string[] {
    const atoms = new Set(Object.values(this.options.input.compiled ?? {}).flatMap(intent => intent.atoms).map(atom => {
      const ref = atomRef(atom)
      return `${ref.id}@${ref.revision}:${ref.digest}`
    }))
    return (group.assessments ?? []).map(assessment => assessment.target_ref)
      .filter(ref => !atoms.has(`${ref?.id}@${ref?.revision}:${ref?.digest}`))
      .map(ref => `${ref?.id}@${ref?.revision}`)
  }

  /**
   * The return events of this batch that an assessment of the target judges:
   * the returns of that exact Atom version, or every return of the batch when
   * none names it.  Each is a whole-event reference.
   */
  private returnEvidence(target: unknown): SourceRef[] {
    const returns = this.options.input.events.filter(event => event.kind === "execution_return")
    const ref = target !== null && typeof target === "object" ? target as { id?: unknown; revision?: unknown } : {}
    const own = returns.filter(event => {
      const atom = (event.payload as { outcome?: { atom_ref?: { id?: unknown; revision?: unknown } } } | undefined)?.outcome?.atom_ref
      return atom?.id === ref.id && atom?.revision === ref.revision
    })
    const chosen = own.length > 0 ? own : returns
    const known = this.options.input.event_source_refs ?? []
    return chosen.flatMap(event => known.filter(source => source.source_id === event.event_id).map(source => ({ source_id: source.source_id, digest: source.digest })))
  }

  private reject(message: string, result?: CompilerModelV2Result): CompilerModelV2Result {
    this.state.issues = [message]
    return { ...result, ok: false, candidate: undefined, validation_failed: true, schema_errors: [message], error: { code: "schema", message } }
  }

  private failed(result: CompilerModelV2Result, stage: "ir" | "ci"): CompilerModelV2Result {
    this.state.issues = result.schema_errors ?? [result.error?.message ?? "Generation failed"]
    if (result.schema_rejected_draft) this.state.rejected_response = { stage, ...structuredClone(result.schema_rejected_draft) }
    return result
  }
}
