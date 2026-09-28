import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs"
import { randomBytes } from "node:crypto"
import { dirname, isAbsolute, join, resolve } from "node:path"
import {
  canonicalJson,
  digestOf,
  validateEvent,
  type AssessmentDraft,
  type AtomStatus,
  type AtomStateRecord,
  type Candidate,
  type CompiledIntent,
  type CompilerEvent,
  type CoverageRecord,
  type EventReceipt,
  type ExecutionOutcome,
  type Ref,
  type SemanticCheckRecord,
  type SourceRef,
  type TaskIntent,
} from "./intent-contract.js"
import type { DispatchRecord, ExecutionRecord } from "./execution-state.js"
import type { CandidateChanges, CandidateRepairContext } from "./candidate-repair.js"

export interface V2StoreOptions {
  storeDir: string
  runId: string
}

export interface V2EventRecord {
  sequence: number
  event: CompilerEvent
  digest: string
}

export interface ManagementRequestRecord {
  request_id: string
  sequence: number
  trigger_event_ids: string[]
  started_at: string
  completed_at: string
  duration_ms: number
  request: unknown
  request_digest: string
  /**
   * What every management call in this batch actually returned, in order, with
   * the issues that attempt triggered.  `raw_response` above keeps only the
   * last proposal for readers that predate this field; a failed batch is
   * diagnosed from `attempts`, without re-running it.
   */
  attempts?: ManagementAttemptRecord[]
  /**
   * Deliverable or material declarations this batch changed relative to the
   * derived IR entry: the atom is the single place a shape is declared, so the
   * entry follows it and the change is recorded here instead of rejecting the
   * batch.  The independent check judges whether the delegation allows it (D2).
   */
  declaration_changes?: DeclarationChangeRecord[]
  raw_response?: string
  raw_response_digest?: string
  response_text_source?: "text" | "reasoning" | "structured"
  candidate?: Candidate
  candidate_digest?: string
  prepared_digest?: string
  read_basis_digest?: string
  /**
   * What happened to the candidate's source references, counted per batch: how
   * many were claimed, how many resolved to a source in that batch, how many
   * digests the mechanical layer had to write, and how many stayed unresolvable
   * (which is a revision reason, not a silent repair).
   */
  source_refs?: {
    total: number
    resolved: number
    normalized: number
    unresolved: number
    /** The unresolved ones themselves, so the audit can point at them (bounded). */
    unresolvedRefs?: Array<{ source_id: string; span?: { unit: string; start: number; end: number } }>
  }
  provider?: string
  model?: string
  agent?: string
  usage?: {
    input_tokens?: number
    output_tokens?: number
    reasoning_tokens?: number
    cache_read_tokens?: number
    cache_write_tokens?: number
    cost?: number
  }
  status: "accepted" | "transport_failed" | "json_failed" | "schema_failed" | "validation_failed"
  error_code?: string
  error_message?: string
  retry: boolean
  ir_revisions: Record<string, number>
  compiled_revisions: Record<string, number>
}

/** One management call inside a batch: its raw answer and the issues it produced. */
export interface ManagementAttemptRecord {
  kind: "propose" | "check"
  failure_diagnostic?: {
    phase: string
    response_received?: boolean
    stream_started?: boolean
    stream_completed?: boolean
    http_status?: number
    exception_chain?: Array<{ name: string; message: string }>
  }
  /** The actual draft supplied to this proposal call, without nested request history. */
  repair_context?: CandidateRepairContext
  /** Observed JSON differences, not a claim that the revision repaired its errors. */
  candidate_changes?: CandidateChanges
  /** Exact code-prepared effects supplied to this check, not its verdict. */
  prepared_digest?: string
  /** Raw model answer for this attempt, bounded by the writer's text limit. */
  text?: string
  /** Present and true when `text` was cut at the limit. */
  text_truncated?: true
  /** Mechanical issues (propose) or check findings (check) this attempt produced. */
  issues?: string[]
}

/** One shape change a batch made to a derived IR declaration. */
export interface DeclarationChangeRecord {
  target: "output" | "binding"
  id: string
  from: string
  to: string
}

export interface AssessmentRecord extends AssessmentDraft {
  basis_event_ids: string[]
  sequence: number
  task_id?: string
}

export interface CheckRecord {
  scenario: string
  expected: string
  observed_in_candidate: string
  sources: SourceRef[]
  unresolved: boolean
  basis_event_ids: string[]
  sequence: number
  task_id?: string
}

export interface QuestionRecord {
  text: string
  affects: string[]
  basis_event_ids: string[]
  sequence: number
  task_id?: string
}

/**
 * A refused authorization.  Denials are part of the audit: an out-of-scope
 * tool call, an expired execution, or a refused start must be visible next to
 * the calls that were allowed.
 */
export interface DeniedCallRecord {
  kind: "start" | "operation"
  at: string
  code: string
  message: string
  execution_id?: string
  dispatch_id?: string
  host_call_id?: string
  operation_id?: string
  tool?: string
  args_digest?: string
}

/**
 * One management model call, measured on its own.  A batch totals its calls,
 * but cost attribution needs the per-call slice: which kind of call ran, for
 * how long, and with what usage.
 */
export interface ManagementCallRecord {
  call_id: string
  request_id: string
  kind: "propose" | "check"
  started_at: string
  completed_at: string
  duration_ms: number
  status: "ok" | "error"
  error_code?: string
  failure_diagnostic?: {
    phase: string
    response_received?: boolean
    stream_started?: boolean
    stream_completed?: boolean
    http_status?: number
    exception_chain?: Array<{ name: string; message: string }>
  }
  usage?: {
    input_tokens?: number
    output_tokens?: number
    reasoning_tokens?: number
    cache_read_tokens?: number
    cache_write_tokens?: number
    cost?: number
  }
}

export interface ExecutionOutcomeRecord {
  execution_id: string
  state_claim: "completed" | "failed" | "blocked" | "stopped"
  outcome: ExecutionOutcome
  accepted_at: string
  atom_status_before: AtomStatus | "not_found"
  atom_status_after: AtomStatus | "unchanged"
  /** Late evidence from closed authority; it cannot update the current atom. */
  historical?: true
  /** Digests the host computed for the declared file changes, once verified. */
  verified_artifacts?: Array<{ path: string; digest: string }>
}

export interface V2RunSnapshot {
  schema: "intent-store-v2/0.1"
  run_id: string
  ir: Record<string, TaskIntent>
  compiled: Record<string, CompiledIntent>
  pending_event_ids: string[]
  /** Receiving a user event suspends authority until its handling commits. */
  unresolved_user_event_ids?: string[]
  execution_eligibility?: { task_ids: string[]; execution_ids: string[] }
  dispatches: DispatchRecord[]
  executions: ExecutionRecord[]
  execution_outcomes: ExecutionOutcomeRecord[]
  management_log: ManagementRequestRecord[]
  assessments: AssessmentRecord[]
  checks: CheckRecord[]
  questions: QuestionRecord[]
  coverage: CoverageRecord[]
  atom_states: AtomStateRecord[]
  semantic_checks: SemanticCheckRecord[]
  denied_calls: DeniedCallRecord[]
  management_calls: ManagementCallRecord[]
  management_call_sequence: number
  compiled_intent_sequence: number
  budget: {
    management_requests: number
    total_management_requests: number
    management_input_tokens: number | "unavailable"
    management_output_tokens: number | "unavailable"
    management_reasoning_tokens: number | "unavailable"
    management_cache_read_tokens: number | "unavailable"
    management_cache_write_tokens: number | "unavailable"
    management_cost: number | "unavailable"
    max_management_requests: number
    max_total_management_requests: number
    max_management_input_tokens: number
    max_management_output_tokens: number
  }
}

export interface V2AdvanceDeltas {
  ir?: Record<string, TaskIntent>
  compiled?: Record<string, CompiledIntent>
  pending_event_ids?: string[]
  unresolved_user_event_ids?: string[]
  execution_eligibility?: { task_ids: string[]; execution_ids: string[] }
  dispatches?: DispatchRecord[]
  executions?: ExecutionRecord[]
  execution_outcome_record?: ExecutionOutcomeRecord
  management_requests?: number
  management_log_record?: ManagementRequestRecord
  assessments?: AssessmentRecord[]
  checks?: CheckRecord[]
  questions?: QuestionRecord[]
  coverage?: CoverageRecord[]
  atom_states?: AtomStateRecord[]
  semantic_checks?: SemanticCheckRecord[]
  denied_calls?: DeniedCallRecord[]
  management_calls?: ManagementCallRecord[]
  management_call_sequence?: number
  compiled_intent_sequence?: number
  max_management_requests?: number
  management_input_tokens?: number
  management_output_tokens?: number
  management_reasoning_tokens?: number
  management_cache_read_tokens?: number
  management_cache_write_tokens?: number
  management_cost?: number
}

export class IntentStoreV2 {
  private readonly dir: string
  private readonly eventsPath: string
  private readonly snapshotPath: string
  private snapshot: V2RunSnapshot

  constructor(options: V2StoreOptions) {
    if (typeof options.storeDir !== "string" || !isAbsolute(options.storeDir)) {
      throw new Error("storeDir must be absolute")
    }
    this.dir = join(resolve(options.storeDir), "v2-runs", options.runId)
    this.eventsPath = join(this.dir, "events.jsonl")
    this.snapshotPath = join(this.dir, "snapshot.json")
    mkdirSync(this.dir, { recursive: true })
    this.snapshot = this.readSnapshot()
  }

  acceptEvent(event: unknown): EventReceipt {
    let validated: CompilerEvent
    try {
      validated = validateEvent(event)
    } catch (error) {
      return { ok: false, run_id: (event as Record<string, unknown>)?.run_id as string ?? "", event_id: (event as Record<string, unknown>)?.event_id as string ?? "", status: "rejected", sequence: -1, code: "source_invalid", message: errorMessage(error) }
    }
    if (this.snapshot.run_id === "") {
      this.snapshot.run_id = validated.run_id
      this.writeSnapshot()
    }
    if (validated.run_id !== this.snapshot.run_id) {
      return { ok: false, run_id: validated.run_id, event_id: validated.event_id, status: "rejected", sequence: -1, code: "identity_conflict", message: "event run_id does not match this run" }
    }
    const digest = digestOf(validated)
    const existing = this.readEvents().find((record) => record.event.event_id === validated.event_id)
    if (existing) {
      if (existing.digest !== digest) {
        return { ok: false, run_id: validated.run_id, event_id: validated.event_id, status: "rejected", sequence: existing.sequence, code: "identity_conflict", message: `event_id ${validated.event_id} was already saved with different content` }
      }
      return { ok: true, run_id: validated.run_id, event_id: validated.event_id, status: "duplicate", sequence: existing.sequence }
    }
    const sequence = this.nextSequence()
    const record: V2EventRecord = { sequence, event: validated, digest }
    appendFileSync(this.eventsPath, `${canonicalJson(record)}\n`, "utf8")
    if (validated.kind === "user_input") {
      this.snapshot.unresolved_user_event_ids = [...(this.snapshot.unresolved_user_event_ids ?? []), validated.event_id]
    }
    if (this.shouldQueue(validated.kind)) {
      this.snapshot.pending_event_ids = [...this.snapshot.pending_event_ids, validated.event_id]
      this.writeSnapshot()
    }
    return { ok: true, run_id: validated.run_id, event_id: validated.event_id, status: "saved", sequence }
  }

  pendingEvents(): CompilerEvent[] {
    const events = this.readEvents()
    return [...new Set([...this.snapshot.pending_event_ids, ...(this.snapshot.unresolved_user_event_ids ?? [])])]
      .map((id) => events.find((record) => record.event.event_id === id)?.event)
      .filter((event): event is CompilerEvent => event !== undefined)
  }

  popPending(): CompilerEvent[] {
    const pending = this.pendingEvents()
    this.snapshot.pending_event_ids = []
    this.snapshot.budget.management_requests = 0
    this.writeSnapshot()
    return pending
  }

  requeuePending(eventIds: readonly string[]): void {
    this.snapshot.pending_event_ids = [...new Set([...this.snapshot.pending_event_ids, ...eventIds])]
    this.writeSnapshot()
  }

  readEvents(): V2EventRecord[] {
    if (!existsSync(this.eventsPath)) return []
    const records: V2EventRecord[] = []
    for (const line of readFileSync(this.eventsPath, "utf8").split(/\r?\n/)) {
      if (!line.trim()) continue
      try {
        records.push(JSON.parse(line) as V2EventRecord)
      } catch {
        // Corrupt lines are retained for inspection but do not poison in-memory state.
      }
    }
    return records.sort((a, b) => a.sequence - b.sequence)
  }

  current(): V2RunSnapshot {
    return cloneSnapshot(this.snapshot)
  }

  applyDeltas(deltas: V2AdvanceDeltas): void {
    if (deltas.ir !== undefined) this.snapshot.ir = cloneJson(deltas.ir)
    if (deltas.compiled !== undefined) this.snapshot.compiled = cloneJson(deltas.compiled)
    if (deltas.pending_event_ids !== undefined) this.snapshot.pending_event_ids = [...deltas.pending_event_ids]
    if (deltas.unresolved_user_event_ids !== undefined) this.snapshot.unresolved_user_event_ids = [...deltas.unresolved_user_event_ids]
    if (deltas.execution_eligibility !== undefined) this.snapshot.execution_eligibility = cloneJson(deltas.execution_eligibility)
    if (deltas.dispatches !== undefined) this.snapshot.dispatches = cloneJson(deltas.dispatches)
    if (deltas.executions !== undefined) this.snapshot.executions = cloneJson(deltas.executions)
    if (deltas.execution_outcome_record !== undefined) this.snapshot.execution_outcomes.push(cloneJson(deltas.execution_outcome_record))
    if (deltas.management_log_record !== undefined) this.snapshot.management_log.push(cloneJson(deltas.management_log_record))
    if (deltas.assessments !== undefined) this.snapshot.assessments.push(...cloneJson(deltas.assessments))
    if (deltas.checks !== undefined) this.snapshot.checks.push(...cloneJson(deltas.checks))
    if (deltas.questions !== undefined) this.snapshot.questions.push(...cloneJson(deltas.questions))
    if (deltas.coverage !== undefined) this.snapshot.coverage.push(...cloneJson(deltas.coverage))
    // The atom state ledger is replaced wholesale: the compiler owns it and
    // updates entries in place, so a partial merge would risk stale statuses.
    if (deltas.atom_states !== undefined) this.snapshot.atom_states = cloneJson(deltas.atom_states)
    if (deltas.semantic_checks !== undefined) this.snapshot.semantic_checks.push(...cloneJson(deltas.semantic_checks))
    if (deltas.denied_calls !== undefined) this.snapshot.denied_calls.push(...cloneJson(deltas.denied_calls))
    if (deltas.management_calls !== undefined) this.snapshot.management_calls.push(...cloneJson(deltas.management_calls))
    if (deltas.management_call_sequence !== undefined) this.snapshot.management_call_sequence = deltas.management_call_sequence
    if (deltas.compiled_intent_sequence !== undefined) this.snapshot.compiled_intent_sequence = deltas.compiled_intent_sequence
    // Run configuration, not progress: raising the per-batch request budget is
    // how a run trades cost for one more propose+check round.
    if (deltas.max_management_requests !== undefined) this.snapshot.budget.max_management_requests = deltas.max_management_requests
    if (deltas.management_requests !== undefined) this.snapshot.budget.management_requests += deltas.management_requests
    if (deltas.management_requests !== undefined) this.snapshot.budget.total_management_requests += deltas.management_requests
    if (deltas.management_input_tokens !== undefined) {
      if (typeof this.snapshot.budget.management_input_tokens === "number") {
        this.snapshot.budget.management_input_tokens += deltas.management_input_tokens
      } else {
        this.snapshot.budget.management_input_tokens = deltas.management_input_tokens
      }
    } else if (deltas.management_requests !== undefined) {
      this.snapshot.budget.management_input_tokens = "unavailable"
    }
    if (deltas.management_output_tokens !== undefined) {
      if (typeof this.snapshot.budget.management_output_tokens === "number") {
        this.snapshot.budget.management_output_tokens += deltas.management_output_tokens
      } else {
        this.snapshot.budget.management_output_tokens = deltas.management_output_tokens
      }
    } else if (deltas.management_requests !== undefined) {
      this.snapshot.budget.management_output_tokens = "unavailable"
    }
    if (deltas.management_reasoning_tokens !== undefined) {
      if (typeof this.snapshot.budget.management_reasoning_tokens === "number") {
        this.snapshot.budget.management_reasoning_tokens += deltas.management_reasoning_tokens
      } else {
        this.snapshot.budget.management_reasoning_tokens = deltas.management_reasoning_tokens
      }
    } else if (deltas.management_requests !== undefined) {
      this.snapshot.budget.management_reasoning_tokens = "unavailable"
    }
    if (deltas.management_cache_read_tokens !== undefined) {
      if (typeof this.snapshot.budget.management_cache_read_tokens === "number") {
        this.snapshot.budget.management_cache_read_tokens += deltas.management_cache_read_tokens
      } else {
        this.snapshot.budget.management_cache_read_tokens = deltas.management_cache_read_tokens
      }
    } else if (deltas.management_requests !== undefined) {
      this.snapshot.budget.management_cache_read_tokens = "unavailable"
    }
    if (deltas.management_cache_write_tokens !== undefined) {
      if (typeof this.snapshot.budget.management_cache_write_tokens === "number") {
        this.snapshot.budget.management_cache_write_tokens += deltas.management_cache_write_tokens
      } else {
        this.snapshot.budget.management_cache_write_tokens = deltas.management_cache_write_tokens
      }
    } else if (deltas.management_requests !== undefined) {
      this.snapshot.budget.management_cache_write_tokens = "unavailable"
    }
    if (deltas.management_cost !== undefined) {
      if (typeof this.snapshot.budget.management_cost === "number") {
        this.snapshot.budget.management_cost += deltas.management_cost
      } else {
        this.snapshot.budget.management_cost = deltas.management_cost
      }
    } else if (deltas.management_requests !== undefined) {
      this.snapshot.budget.management_cost = "unavailable"
    }
    this.writeSnapshot()
  }

  private shouldQueue(kind: CompilerEvent["kind"]): boolean {
    return kind === "user_input" || kind === "execution_return" || kind === "capability_change"
  }

  private nextSequence(): number {
    const events = this.readEvents()
    return events.reduce((max, record) => Math.max(max, record.sequence), 0) + 1
  }

  private readSnapshot(): V2RunSnapshot {
    if (!existsSync(this.snapshotPath)) {
      const snapshot: V2RunSnapshot = {
        schema: "intent-store-v2/0.1",
        run_id: "",
        ir: {},
        compiled: {},
        pending_event_ids: [],
        unresolved_user_event_ids: [],
        dispatches: [],
        executions: [],
        execution_outcomes: [],
        management_log: [],
        assessments: [],
        checks: [],
        questions: [],
        coverage: [],
        atom_states: [],
        semantic_checks: [],
        denied_calls: [],
        management_calls: [],
        management_call_sequence: 0,
        compiled_intent_sequence: 0,
        budget: {
          management_requests: 0,
          total_management_requests: 0,
          management_input_tokens: 0,
          management_output_tokens: 0,
          management_reasoning_tokens: 0,
          management_cache_read_tokens: 0,
          management_cache_write_tokens: 0,
          management_cost: 0,
          max_management_requests: 3,
          max_total_management_requests: 30,
          max_management_input_tokens: 64_000,
          max_management_output_tokens: 6_000,
        },
      }
      this.writeSnapshotObject(snapshot)
      return snapshot
    }
    const snapshot = JSON.parse(readFileSync(this.snapshotPath, "utf8")) as V2RunSnapshot
    if (snapshot.run_id === "") {
      // The run id is fixed on first event and is updated lazily in acceptEvent.
    }
    if (snapshot.budget.total_management_requests === undefined) snapshot.budget.total_management_requests = snapshot.budget.management_requests ?? 0
    if (snapshot.budget.max_total_management_requests === undefined) snapshot.budget.max_total_management_requests = 30
    if (snapshot.management_log === undefined) snapshot.management_log = []
    // Recover even if the process stopped after appending an event or after
    // taking the queue. Historical accepted records keep their original meaning.
    const handledUsers = new Set(snapshot.management_log.filter(row => row.status === "accepted").flatMap(row => row.trigger_event_ids))
    snapshot.unresolved_user_event_ids = this.readEvents().filter(row => row.event.kind === "user_input" && !handledUsers.has(row.event.event_id)).map(row => row.event.event_id)
    if (snapshot.assessments === undefined) snapshot.assessments = []
    if (snapshot.checks === undefined) snapshot.checks = []
    if (snapshot.questions === undefined) snapshot.questions = []
    if (snapshot.coverage === undefined) snapshot.coverage = []
    if (snapshot.atom_states === undefined) snapshot.atom_states = []
    if (snapshot.semantic_checks === undefined) snapshot.semantic_checks = []
    if (snapshot.denied_calls === undefined) snapshot.denied_calls = []
    if (snapshot.management_calls === undefined) snapshot.management_calls = []
    if (snapshot.management_call_sequence === undefined) snapshot.management_call_sequence = snapshot.management_calls.length
    if (snapshot.compiled_intent_sequence === undefined) snapshot.compiled_intent_sequence = 0
    // Records written before the atom state ledger carried status inside the
    // atom.  Seed the ledger from them so a resumed run cannot treat an
    // already completed atom as ready; the atom itself keeps content only.
    if (snapshot.atom_states.length === 0) {
      for (const [taskId, intent] of Object.entries(snapshot.compiled ?? {})) {
        for (const atom of intent.atoms ?? []) {
          const legacy = atom as unknown as Record<string, unknown>
          if (typeof legacy.status !== "string") continue
          snapshot.atom_states.push({
            task_id: taskId,
            atom_id: atom.atom_id,
            atom_revision: atom.revision,
            compiled_intent_id: typeof intent.compiled_intent_id === "string" ? intent.compiled_intent_id : `legacy:${taskId}:${intent.compiled_revision}`,
            status: legacy.status as AtomStateRecord["status"],
            updated_at: typeof legacy.updated_at === "string" ? legacy.updated_at : new Date(0).toISOString(),
          })
        }
      }
    }
    if (snapshot.execution_outcomes === undefined) snapshot.execution_outcomes = []
    if (snapshot.budget.management_reasoning_tokens === undefined) snapshot.budget.management_reasoning_tokens = 0
    if (snapshot.budget.management_cache_read_tokens === undefined) snapshot.budget.management_cache_read_tokens = 0
    if (snapshot.budget.management_cache_write_tokens === undefined) snapshot.budget.management_cache_write_tokens = 0
    if (snapshot.budget.management_cost === undefined) snapshot.budget.management_cost = 0
    return snapshot
  }

  private writeSnapshot(): void {
    this.writeSnapshotObject(this.snapshot)
  }

  private writeSnapshotObject(snapshot: V2RunSnapshot): void {
    const temporary = `${this.snapshotPath}.${process.pid}.${Date.now()}.${randomBytes(4).toString("hex")}.tmp`
    writeFileSync(temporary, `${canonicalJson(snapshot)}\n`, "utf8")
    renameSync(temporary, this.snapshotPath)
  }
}

function cloneJson<T>(value: T): T {
  return JSON.parse(canonicalJson(value)) as T
}

function cloneSnapshot(snapshot: V2RunSnapshot): V2RunSnapshot {
  return cloneJson(snapshot)
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
