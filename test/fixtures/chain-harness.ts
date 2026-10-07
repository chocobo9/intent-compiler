import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createOpenCodeAdapter, deliveredAtoms, HOST_DISPATCH_SOURCE_CATEGORY, type OpenCodeObserver } from "../../src/adapters/opencode.js"
import { IntentStoreV2, type V2RunSnapshot } from "../../src/core/compiler-store-v2.js"
import { createIntentCompilerV2 } from "../../src/core/intent-compiler-v2.js"
import { compiledIntentRef } from "../../src/core/compiled-intent.js"
import type { Candidate, CompilerEvent, Ref, SourceRef } from "../../src/core/intent-contract.js"
import {
  createCompilerModelV2,
  type CompilerModelV2CheckTransport,
  type CompilerModelV2Input,
  type CompilerModelV2Transport,
} from "../../src/model/compiler-model-v2.js"
import { CANDIDATE_EXAMPLE } from "../../src/model/candidate-example.js"

/**
 * Offline chain simulation: the real compiler, the real OpenCode adapter and a
 * host turn loop that behaves like `_run_pending_dispatches` in
 * experiments/evocode/harbor/dpipe/intent_opencode_agent.py.  Management and
 * executor answers are scripted; nothing calls a model, an executor or a verifier.
 *
 * Every turn is one `opencode run` process: a fresh store handle, compiler and
 * adapter over the same store directory, ended by the CLI's drain.
 */

export const HOST_DISPATCH_INSTRUCTION = "Run the work the Intent Compiler has pending for this task."
/** EXECUTIONS_PER_ATOM_VERSION in the Python host. */
const EXECUTIONS_PER_ATOM_VERSION = 2

/**
 * completed: tool work and a final report.  stopped: the session ends mid tool
 * call.  tool_error_then_completed: a failed tool call the executor works past.
 * timeout: the turn could not be reconciled (the Observer gives up).
 */
export type ExecutorScript = "completed" | "stopped" | "tool_error_then_completed" | "timeout"

export interface ChainHarnessOptions {
  runId?: string
  propose: CompilerModelV2Transport
  check?: CompilerModelV2CheckTransport
  /** The script for a turn, given the Atom versions (`atom_id@revision`) it delivered. */
  executor?: (offered: readonly string[]) => ExecutorScript
  /** The dpipe runs' budget: 12 requests per batch, 180 per run. */
  budget?: { perBatch: number; total: number }
  /** The harbor task id the host registers each user turn under. */
  hostTaskId?: string
}

export interface TurnRecord {
  kind: "user" | "host"
  session: string
  /** Atom versions the turn delivered to the executor. */
  offered: string[]
  /** The delivered message text: the Atom JSON and any retry findings after it. */
  text?: string
  executions: string[]
  script?: ExecutorScript
  /** The command's failure, as the CLI would exit 1 with it. */
  error?: { code?: string; message: string }
}

export interface HostLoopRecord {
  turns: TurnRecord[]
  cap: number
  stopped: "nothing pending" | "turn cap reached" | "host turn started no execution"
}

export interface RoundRecord {
  user: TurnRecord
  host: HostLoopRecord
  /** Events still queued for management when the round ended. */
  pendingEventIds: string[]
  /** Dispatches with no execution whose Atom version is ready, as the host sees them. */
  pendingDispatches: string[]
}

interface SdkMessage {
  info: { id: string; role: string; finish?: string }
  parts: Array<Record<string, unknown>>
}

export const consistentCheck: CompilerModelV2CheckTransport = async () =>
  JSON.stringify({ schema_version: 2, verdict: "consistent", findings: [] })

export class ChainHost {
  readonly runId: string
  readonly storeDir: string
  readonly turns: TurnRecord[] = []
  private readonly sessions = new Map<string, SdkMessage[]>()
  private counter = 0
  private readonly options: ChainHarnessOptions

  constructor(options: ChainHarnessOptions) {
    this.options = options
    this.runId = options.runId ?? "chain-run"
    this.storeDir = mkdtempSync(join(tmpdir(), "chain-sim-"))
    const store = this.store()
    const budget = options.budget ?? { perBatch: 12, total: 180 }
    store.applyDeltas({ max_management_requests: budget.perBatch })
    // applyDeltas has no field for the run-wide limit.
    ;(store as unknown as { snapshot: V2RunSnapshot }).snapshot.budget.max_total_management_requests = budget.total
    ;(store as unknown as { writeSnapshot(): void }).writeSnapshot()
  }

  store(): IntentStoreV2 {
    return new IntentStoreV2({ storeDir: this.storeDir, runId: this.runId })
  }

  snapshot(): V2RunSnapshot {
    return this.store().current()
  }

  events(): CompilerEvent[] {
    return this.store().readEvents().map(row => row.event)
  }

  /** One host round: the user's turn, then host turns while dispatches are pending. */
  async round(text: string, source: Record<string, unknown> = { source_category: "initial_requirement" }): Promise<RoundRecord> {
    const user = await this.turn("user", text, source)
    const host = await this.runPendingDispatches()
    const snapshot = this.snapshot()
    return { user, host, pendingEventIds: [...snapshot.pending_event_ids], pendingDispatches: pendingDispatches(snapshot).map(d => d.dispatch_id) }
  }

  /**
   * `_run_pending_dispatches`: keep adding host turns while offered work has not
   * started or events wait for management.
   */
  async runPendingDispatches(): Promise<HostLoopRecord> {
    const record: HostLoopRecord = { turns: [], cap: 0, stopped: "nothing pending" }
    let snapshot = this.snapshot()
    for (;;) {
      const pending = pendingDispatches(snapshot)
      const cap = EXECUTIONS_PER_ATOM_VERSION * Math.max(1, currentAtomCount(snapshot))
      record.cap = Math.max(record.cap, cap)
      if (pending.length === 0 && snapshot.pending_event_ids.length === 0) { record.stopped = "nothing pending"; break }
      if (record.turns.length >= record.cap) { record.stopped = "turn cap reached"; break }
      const before = executionIds(snapshot)
      const turn = await this.turn("host", HOST_DISPATCH_INSTRUCTION, { source_category: HOST_DISPATCH_SOURCE_CATEGORY })
      snapshot = this.snapshot()
      const started = [...executionIds(snapshot)].filter(id => !before.has(id))
      record.turns.push(turn)
      if (started.length === 0) { record.stopped = "host turn started no execution"; break }
    }
    return record
  }

  /** One `opencode run` process carrying a user text or a host-dispatch instruction. */
  async turn(kind: "user" | "host", text: string, source: Record<string, unknown>): Promise<TurnRecord> {
    const n = ++this.counter
    const sessionID = `ses_${n}`
    const messageID = `msg_${n}`
    const record: TurnRecord = { kind, session: sessionID, offered: [], executions: [] }
    this.turns.push(record)
    const store = this.store()
    const compiler = createIntentCompilerV2({ store, model: createCompilerModelV2(this.options.propose, this.options.check ?? consistentCheck) })
    let script: ExecutorScript = "completed"
    const observer: OpenCodeObserver = {
      captureRawInput: () => true,
      expectDelivery: () => true,
      observeEvent: () => true,
      modelRequested: () => true,
      scheduleReconciliation: async () => script !== "timeout",
    }
    const messages: SdkMessage[] = []
    this.sessions.set(sessionID, messages)
    const output = { message: { id: messageID }, parts: [{ id: `prt_${n}`, type: "text" as const, text }] }
    messages.push({ info: { id: messageID, role: "user" }, parts: output.parts })
    const hooks = createOpenCodeAdapter({
      arm: "compiler", compiler, observer,
      client: { session: { messages: async ({ path }) => ({ data: this.sessions.get(path.id) ?? [] }) } },
      resolveTurn: async () => ({ runId: this.runId, inputIdentity: messageID, taskIds: [this.options.hostTaskId ?? "harbor-task"], source }),
    }).hooks()
    try {
      await hooks["chat.message"]({ sessionID, messageID }, output)
      record.text = output.parts[0]!.text
      const delivered = deliveredAtoms(record.text) as Array<{ atom_id: string; revision: number }>
      record.offered = delivered.map(atom => `${atom.atom_id}@${atom.revision}`)
      await hooks["chat.params"]({ sessionID, message: { id: messageID } }, {})
      script = this.options.executor?.(record.offered) ?? "completed"
      record.script = script
      messages.push(...executorMessages(n, script))
      // The host bus publishes idle without awaiting; the CLI then drains.
      void hooks.event({ event: { type: "session.idle", properties: { sessionID } } }).catch(() => {})
      await hooks["experimental.execution.drain"]({ sessionID })
    } catch (error) {
      record.error = errorRecord(error)
    } finally {
      const snapshot = this.snapshot()
      record.executions = snapshot.executions.filter(e => e.host_identity === sessionID).map(e => e.execution_id)
    }
    return record
  }
}

function errorRecord(error: unknown): { code?: string; message: string } {
  if (error instanceof AggregateError) {
    const inner = error.errors.map(errorRecord)
    return { ...(inner[0]?.code === undefined ? {} : { code: inner[0].code }), message: inner.map(item => item.message).join(" | ") }
  }
  const code = (error as { code?: unknown })?.code
  return { ...(typeof code === "string" ? { code } : {}), message: error instanceof Error ? error.message : String(error) }
}

function executorMessages(n: number, script: ExecutorScript): SdkMessage[] {
  const work = { type: "tool", tool: "bash", state: { status: "completed", input: { command: "make check" }, output: "all checks pass\n" } }
  const failed = { type: "tool", tool: "apply_patch", state: { status: "error", error: "invalid patch format" } }
  const assistant = (k: number, finish: string, parts: Array<Record<string, unknown>>): SdkMessage =>
    ({ info: { id: `msg_${n}_a${k}`, role: "assistant", finish }, parts })
  switch (script) {
    case "completed":
    case "timeout":
      return [assistant(1, "tool-calls", [work]), assistant(2, "stop", [{ type: "text", text: "Implemented the assigned work; checks pass." }])]
    case "tool_error_then_completed":
      return [assistant(1, "tool-calls", [failed, work]), assistant(2, "stop", [{ type: "text", text: "Implemented the assigned work after a failed patch; checks pass." }])]
    case "stopped":
      return [assistant(1, "tool-calls", [{ type: "text", text: "Blocked before finishing." }, work, failed])]
  }
}

export function executionIds(snapshot: V2RunSnapshot): Set<string> {
  return new Set(snapshot.executions.map(e => e.execution_id))
}

function atomStatus(snapshot: V2RunSnapshot): Map<string, string> {
  const status = new Map<string, string>()
  for (const item of snapshot.atom_states) status.set(`${item.task_id}\0${item.atom_id}\0${item.atom_revision}`, item.status)
  return status
}

function currentAtomCount(snapshot: V2RunSnapshot): number {
  return [...atomStatus(snapshot).values()].filter(status => status !== "legacy" && status !== "superseded").length
}

/** `_pending_dispatches`: no execution started and the Atom version is ready; admission is the compiler's. */
export function pendingDispatches(snapshot: V2RunSnapshot): V2RunSnapshot["dispatches"] {
  const started = new Set(snapshot.executions.map(e => e.dispatch_id))
  const status = atomStatus(snapshot)
  return snapshot.dispatches.filter(d => !started.has(d.dispatch_id) && status.get(`${d.task_id}\0${d.atom_id}\0${d.atom_revision}`) === "ready")
}

/**
 * The example plan as a serial chain of `count` Atoms: a-bundle → a-inspect →
 * a-step3 → … .  Added Atoms are copies of a-inspect assigned the task and the
 * shared requirement, so each carries real IR content.
 */
export function chainCandidate(count: number, userEventId: string): Candidate {
  const candidate = JSON.parse(JSON.stringify(CANDIDATE_EXAMPLE).replaceAll("input-event-id", userEventId)) as Candidate
  const group = candidate.groups[0]!
  if (group.compilation.decision !== "replace") throw Error("fixture")
  const draft = group.compilation.drafts[0]!
  const inspect = draft.atoms.find(atom => atom.atom_id === "a-inspect")!
  const template = draft.relations[0]!
  for (let index = 3; index <= count; index += 1) {
    const id = `a-step${index}`
    const previous = draft.atoms.at(-1)!.atom_id
    draft.atoms.push({ ...structuredClone(inspect), atom_id: id, task: `${inspect.task}\n\nStep ${index} of the chain.` })
    draft.relations.push({ ...structuredClone(template), predecessor: { local_ref: previous }, successor: { local_ref: id } })
    for (const entry of group.coverage) {
      if ("local_ref" in entry.requirement && ["t1", "r-common"].includes(entry.requirement.local_ref)) entry.refs.push({ local_ref: id })
    }
  }
  return candidate
}

export type AssessmentResult = "satisfied" | "not_satisfied" | "unknown"

export interface ReturnJudgement {
  result: AssessmentResult
  decision?: "stop" | "retry"
  /** Replace the assessed Atom reference, as a model that copied it wrong would. */
  targetRef?: (ref: Ref) => Ref
  /** Replace the criteria references, likewise. */
  criteriaRefs?: (refs: Array<Ref | SourceRef>) => Array<Ref | SourceRef>
}

/**
 * A return-batch answer in the shape the strict transport asks for: one group
 * per task, the plan reused, one decision and one assessment per returned
 * execution.  Evidence references are code-bound and left out.
 */
export function assessmentAnswer(input: CompilerModelV2Input, judge: (atomId: string, executionId: string) => ReturnJudgement): string {
  const taskId = Object.keys(input.compiled ?? {})[0]!
  const intent = input.compiled![taskId]!
  const returns = input.events.filter(event => event.kind === "execution_return")
  const judged = returns.map(event => {
    const outcome = (event.payload as { outcome: { atom_ref: Ref } }).outcome
    const atom = intent.atoms.find(candidate => candidate.atom_id === outcome.atom_ref.id && candidate.revision === outcome.atom_ref.revision)
    const judgement = judge(outcome.atom_ref.id, event.execution_id!)
    return { event, ref: outcome.atom_ref, atom, judgement }
  })
  return JSON.stringify({
    schema_version: 2, basis: { event_ids: input.events.map(event => event.event_id), refs: [] }, parent_issues: [],
    groups: [{
      local_ref: taskId, task_refs: [taskId], depends_on: [],
      compilation: { decision: "reuse", current: [compiledIntentRef(intent)], reason: "the plan is unchanged" },
      execution_decisions: judged.map(({ event, ref, judgement }) => ({
        execution_id: event.execution_id, decision: judgement.decision ?? "stop", reason: `${judgement.decision ?? "stop"} after ${judgement.result}`, basis: [ref],
      })),
      assessments: judged.map(({ ref, atom, judgement }) => ({
        target_ref: judgement.targetRef ? judgement.targetRef(ref) : ref,
        criteria_refs: judgement.criteriaRefs ? judgement.criteriaRefs(atom?.goal_refs ?? []) : atom?.goal_refs ?? [],
        result: judgement.result, explanation: `the returned work is ${judgement.result}`, method: "model",
      })),
      coverage: [], checks: [], questions: [],
    }],
  })
}
