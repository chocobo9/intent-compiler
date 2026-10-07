import test from "node:test"
import assert from "node:assert/strict"
import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { createOpenCodeAdapter, deliveredAtoms, HOST_DISPATCH_SOURCE_CATEGORY, renderDeliveryText } from "../src/adapters/opencode.js"
import { atomRef } from "../src/core/compiled-intent.js"
import type { V2RunSnapshot } from "../src/core/compiler-store-v2.js"
import { ExecutionStateManager } from "../src/core/execution-state.js"
import { ATOM_VERSION_EXECUTION_LIMIT, storedRetryFindings, type IntentCompilerV2 } from "../src/core/intent-compiler-v2.js"
import type { CompilerEvent } from "../src/core/intent-contract.js"
import { stableJson } from "../src/observer/codec.js"

// Run 53ca6c06, round 11: mgmt-22 assessed dpipe-implementation@10 not_satisfied
// (assessments[44], the CRLF header line) and retried execution-355; the retry
// ran as execution-384 under dispatch-383 and received the same Atom with
// nothing else.  Offline, read-only; skipped without the data.
const run = "intent-luna-dpipe-full-20261006-114022-53ca6c06"
const store = join(process.env.EVOCODEBENCH_ROOT ?? "D:/huawei/EvoCodeBench", "harbor_intent_data", run, "compiler-store", "v2-runs", run)
const recorded = existsSync(join(store, "snapshot.json"))

test("the recorded R11 retry is delivered with mgmt-22's finding and retry reason after the unchanged Atom", { skip: !recorded }, async () => {
  const snapshot = JSON.parse(readFileSync(join(store, "snapshot.json"), "utf8")) as V2RunSnapshot
  const retry = snapshot.dispatches.find(dispatch => dispatch.dispatch_id === "dispatch-383")!
  const first = snapshot.dispatches.find(dispatch => dispatch.dispatch_id === "dispatch-354")!
  assert.equal(retry.retry_of, "execution-355")
  const atom = Object.values(snapshot.compiled).flatMap(intent => intent.atoms).find(candidate => candidate.atom_id === retry.atom_id && candidate.revision === retry.atom_revision)!
  assert.equal(atomRef(atom).digest, retry.digest, "the retry offers the Atom version as stored")
  assert.equal(retry.digest, first.digest, "the same Atom digest as the first dispatch")

  const findings = storedRetryFindings(snapshot, retry, atom)
  const decision = snapshot.management_log.find(record => record.request_id === "mgmt-22")!.candidate!.groups.flatMap(group => group.execution_decisions).find(entry => entry.execution_id === "execution-355")!
  assert.deepEqual(findings, { execution_id: "execution-355", not_satisfied: [snapshot.assessments[44]!.explanation], reason: decision.reason })
  assert.equal(snapshot.assessments[44]!.result, "not_satisfied")
  assert.equal(storedRetryFindings(snapshot, first, atom), undefined, "a first dispatch carries nothing")

  // Delivered through the adapter's host-dispatch turn and read back.
  const delivery = { dispatch_id: retry.dispatch_id, task_id: retry.task_id, atom_id: retry.atom_id, digest: retry.digest, compiled_revision: retry.compiled_revision, atom, retry_findings: findings! }
  const events: CompilerEvent[] = []
  const started: string[] = []
  const compiler = {
    pendingDeliveries: async () => [delivery],
    acceptEvent: async (event: CompilerEvent) => { events.push(event); return { ok: true, run_id: run, event_id: event.event_id, status: "saved", sequence: events.length } },
    advance: async () => { throw new Error("a host-dispatch turn with an offer does not advance") },
    authorize: (request: { kind: string; dispatch_id?: string }) => { if (request.kind === "start") started.push(request.dispatch_id ?? ""); return { ok: true, run_id: run, execution_id: "execution-384" } },
    inspect: async () => { throw new Error("unused") },
  } as unknown as IntentCompilerV2
  const output = { message: { id: "message-1" }, parts: [{ id: "part-1", type: "text" as const, text: "Run the work the Intent Compiler has pending for this task." }] }
  const hooks = createOpenCodeAdapter({
    arm: "compiler", compiler,
    client: { session: { messages: async () => ({ data: [{ info: { id: "message-1" }, parts: output.parts }] }) } },
    observer: { captureRawInput: () => true, expectDelivery: () => true, observeEvent: () => true, modelRequested: () => true, toolBefore: () => true, toolAfter: () => true, scheduleReconciliation: async () => true },
    resolveTurn: async () => ({ runId: run, inputIdentity: "input-1", taskIds: [retry.task_id], source: { source_category: HOST_DISPATCH_SOURCE_CATEGORY } }),
  }).hooks()
  await hooks["chat.message"]({ sessionID: "session-1", messageID: "message-1" }, output)
  const text = output.parts[0]!.text
  assert.equal(text, renderDeliveryText([delivery]))
  assert.ok(text.startsWith(`${stableJson([atom])}\n\n[management findings for this retry] dpipe-implementation@10\nExecution execution-355 of this same Atom version was assessed not_satisfied:\n- ${snapshot.assessments[44]!.explanation}\nReason for running it again: ${decision.reason}`))
  assert.deepEqual(deliveredAtoms(text), [atom])
  await hooks["chat.params"]({ sessionID: "session-1", message: { id: "message-1" } }, {})
  assert.deepEqual(started, ["dispatch-383"], "the readback check passed and the retry started")
  assert.equal(events[0]?.kind, "delivery_ack")

  // That second execution of @10 in this user-input window reaches the limit.
  const executions = new ExecutionStateManager(snapshot.dispatches, snapshot.executions)
  const window = snapshot.executions.find(record => record.execution_id === "execution-355")!.user_input_window
  const ran = executions.executionsInWindow(retry.task_id, atom.atom_id, atom.revision, retry.digest, window)
  assert.deepEqual(ran.map(record => record.execution_id), ["execution-355", "execution-384"])
  assert.equal(ran.length, ATOM_VERSION_EXECUTION_LIMIT, "no third run of this version without a user input")
})
