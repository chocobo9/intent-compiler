import { digestOf, type Candidate, type LocalSourceEditRecord, type TaskIntent } from "./intent-contract.js"
import { IntentStateManager } from "./intent-state-v2.js"
import { aliasDisplay, decodeIRProposal, expressIRRequest, type SourceAliasEntry, type SourceAliasIndex } from "./source-aliases.js"
import { materializeSourceContent, recordEditedRemovals, sourceSegments, validateSourceCoverage } from "./source-payload.js"
import type { CompilerModelV2Input, CompilerModelV2Result } from "../model/compiler-model-v2.js"
import type { IRProposal, CIProposal } from "../model/generation-schema.js"

/** Temporary generation state, never accepted intent or an authorization. */
export interface ParentGenerationState {
  source_basis: string
  phase: "ir" | "ci"
  ir_proposal?: IRProposal
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
}

/** What the mechanical source gate found, bounded by the resolver. */
interface SourceRefReport {
  unresolved: number
  unresolvedRefs?: Array<{
    source_id: string
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
      : ref.quote !== undefined ? `quote=${JSON.stringify(ref.quote.length > 60 ? `${ref.quote.slice(0, 60)}…` : ref.quote)}`
      : ref.span === undefined ? "no selector"
      : `span=${ref.span.unit}:${ref.span.start}-${ref.span.end}`
    return `${display(ref.source_id)} (${selector}): ${ref.reason ?? "unresolved"}`
  })
  const hidden = Math.max(0, report.unresolved - refs.length)
  const list = shown.length === 0 ? ""
    : hidden > 0
      ? ` Showing the first ${refs.length} of ${report.unresolved} (${hidden} more are not listed): ${shown.join("; ")}.`
      : ` Showing all ${refs.length}: ${shown.join("; ")}.`
  return `IR sources do not resolve; ${report.unresolved} reference(s) failed the source gate for this batch.${list} Each selection needs one source_id from the supplied source_segments and exactly one selector that exists in that source: a segment_id from its list, or a span inside its text.`
}

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
    if (!carriesUserInput) {
      this.state.derived = true
      delete this.state.ir_proposal
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
    const basis = this.options.validateBasis(candidate, (eventId) => this.display(eventId))
    if (!basis.ok) throw Error(basis.message ?? "IR names the wrong input events")
    if (this.options.input.events.some(event => event.kind === "user_input") && candidate.groups.length === 0) {
      throw Error("User input needs an IR task and explicit handling of its requirements or uncertainty")
    }
    const sourceReport = this.options.resolve(candidate)
    if (sourceReport.unresolved > 0) throw Error(unresolvedSources(sourceReport, (eventId) => this.display(eventId)))
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
    const carriedEventIds = new Set((this.options.input.carried_delegations ?? []).map((delegation) => delegation.event_id))
    validateSourceCoverage(candidate, this.options.input.events, sources, this.options.input.ir, ir,
      { carriedEventIds, display: (eventId) => this.display(eventId) })
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
      const irGroups = (groups: Candidate["groups"]): IRProposal["groups"] => groups.map(({
        compilation: _compilation, coverage: _coverage,
        execution_decisions: _executionDecisions, assessments: _assessments, checks: _checks, ...group
      }) => group)
      const base: CompilerModelV2Input = stage === "ir"
        ? {
          ...shared,
          source_segments: sourceSegments([
            ...(priorSources ?? []).filter(event => cited.has(event.event_id) || gaps.has(event.event_id)),
            ...this.options.input.events,
          ]),
        }
        : { ...shared, compiled: plan, atom_refs: atomRefs, executions: executionView, execution_outcomes: outcomes, assessments: assessmentRecords }
      const ir = stage === "ci" ? this.state.parent!.ir : this.options.input.ir
      // An assessment batch repairs the stored IR from the user's own text: do
      // not offer the execution return as a citable source for that stage.
      const userTextIds = new Set([...(this.options.input.source_events ?? []), ...this.options.input.events]
        .filter(event => event.source?.channel === "user")
        .map(event => event.event_id))
      const offeredRefs = this.state.derived === true && stage === "ir" && base.event_source_refs !== undefined
        ? base.event_source_refs.filter(ref => userTextIds.has(ref.source_id))
        : base.event_source_refs
      const assembled: CompilerModelV2Input = { ...base, ...(offeredRefs === undefined ? {} : { event_source_refs: offeredRefs }),
        generation_stage: stage, ir: structuredClone(ir),
        existing_objects: this.options.directory(ir),
        ...(stage === "ci" ? { parent_basis: this.state.parent!.digest } : {}),
        validation_errors: [...this.state.issues],
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
          ...this.state.ir_proposal,
          groups: irGroups(this.state.ir_proposal.groups as Candidate["groups"]),
        }), ci_proposal: this.state.ci_proposal,
          issues: [...this.state.issues] },
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
    if (child.parent_basis !== parent.digest) return this.reject("CI names a different parent basis", result)
    if (child.parent_issues.length) {
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
    if (derived) {
      // An assessment answers this batch's events; its refs may cite what it assessed.
      const expected = this.options.input.events.map(event => event.event_id).sort()
      const received = [...child.basis.event_ids].sort()
      if (digestOf(received) !== digestOf(expected)) {
        return this.reject(`an execution assessment must name this batch's events in basis.event_ids; expected=${JSON.stringify(expected)}; received=${JSON.stringify(child.basis.event_ids)}`, result)
      }
    } else {
      for (const key of ["event_ids", "refs"] as const) {
        const expected = parent.candidate.basis[key], received = child.basis[key]
        if (digestOf(received) !== digestOf(expected)) {
          return this.reject(`CI basis.${key} must be copied unchanged from generation_repair.ir_proposal.basis.${key}; expected=${JSON.stringify(expected)}; received=${JSON.stringify(received)}. The temporary IR is identified by parent_basis; its object references belong in compilation.intent_basis and Atom fields, not in this input basis.`, result)
        }
      }
      if (child.groups.length !== parent.candidate.groups.length) {
        return this.reject(`CI groups must preserve the parent's task groups; expected local_ref=${JSON.stringify(parent.candidate.groups.map(g => g.local_ref))}; received local_ref=${JSON.stringify(child.groups.map(g => g.local_ref))}`, result)
      }
    }
    const seen = new Set<string>()
    const groups: Candidate["groups"] = []
    for (const group of child.groups) {
      if (derived) {
        // An assessment batch binds by task: the parent skeleton's local_refs
        // are the compiler's own labels, so they are not the child's to copy.
        if (group.task_refs.length !== 1) return this.reject("an execution assessment needs one existing task per group: task_refs must name exactly one task", result)
        const taskId = group.task_refs[0] as string
        if (parent.ir[taskId] === undefined) return this.reject(`assessment group names unknown task ${taskId}`, result)
        if (seen.has(taskId)) return this.reject(`assessment names task ${taskId} more than once`, result)
        seen.add(taskId)
        const skeleton = parent.candidate.groups.find(candidate => candidate.task_refs[0] === taskId)
        groups.push({ ...group, depends_on: skeleton === undefined ? [] : [...skeleton.depends_on], ir_changes: [] })
        continue
      }
      // A delegation batch binds by group identity; everything structural (task
      // identity, dependencies, retained IR changes) is filled by this code, so
      // the child never reproduces it.
      const original = parent.candidate.groups.find(candidate => candidate.local_ref === group.local_ref)
      if (!original || seen.has(group.local_ref)) return this.reject("CI group does not belong to this parent", result)
      seen.add(group.local_ref)
      const boundTask = original.task_refs[0]
      if (boundTask === undefined || parent.ir[boundTask] === undefined) {
        return this.reject(`group ${group.local_ref} is not bound to a stored task`, result)
      }
      if (group.compilation.decision === "replace") for (const draft of group.compilation.drafts) {
        if (draft.task_id !== (original ?? group).task_refs[0]) return this.reject("Compiled Intent belongs to another IR", result)
        const task = parent.ir[draft.task_id]!
        for (const atom of draft.atoms) {
          for (const output of atom.outputs) {
            const existing = task.outputs.find(o => o.output_id === output.output_id)
            if (existing && existing.format !== output.format) return this.reject(`CI changes parent output ${output.output_id}; report parent_issues`, result)
          }
          for (const input of atom.inputs) {
            const existing = task.bindings.find(b => b.binding_id === input.binding_id)
            if (existing && (digestOf(existing.ref ?? null) !== digestOf(input.ref) || existing.role !== input.role)) {
              return this.reject(`CI changes parent material ${input.binding_id}; report parent_issues`, result)
            }
          }
        }
      }
      groups.push({
        ...group,
        task_refs: [...original.task_refs],
        depends_on: [...original.depends_on],
        ir_changes: derived ? [] : structuredClone(original.ir_changes),
        ...(derived
          ? {}
          : { questions: [...original.questions, ...group.questions.filter(q => !original.questions.some(p => digestOf(p) === digestOf(q)))] }),
      } as Candidate["groups"][number])
    }
    this.state.issues = []
    return { ...result, candidate: { schema_version: 2,
      basis: derived ? structuredClone(child.basis) : parent.candidate.basis,
      source_coverage: derived ? [] : parent.candidate.source_coverage, groups } }
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
