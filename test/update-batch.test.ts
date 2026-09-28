import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { IntentStoreV2 } from "../src/core/compiler-store-v2.js"
import { createIntentCompilerV2 } from "../src/core/intent-compiler-v2.js"
import { createCompilerModelV2 } from "../src/model/compiler-model-v2.js"
import { createStructuredProviderTransport } from "../src/model/structured-provider-transport.js"
import { CANDIDATE_EXAMPLE } from "../src/model/candidate-example.js"
import { atomRef, compiledIntentRef } from "../src/core/compiled-intent.js"
import type { CompilerModelV2, CompilerModelV2CheckInput, CompilerModelV2Input } from "../src/model/compiler-model-v2.js"
import { digestText, type Candidate, type CompilerEvent, type ExecutionTask } from "../src/core/intent-contract.js"
import { createOpenCodeAdapter } from "../src/adapters/opencode.js"

// Authority and exact limits: development/validation/2026-09-24-update-batch/SCOPE.md.
// No timers, network, business execution, or assertions about model intelligence.
const RUN = "update-batch"
const TEXT = "Fix model_to_dict for empty fields. Preserve None. Do not read the linked PR."
function event(id = "e1", text = TEXT): CompilerEvent {
  return { schema_version: 2, run_id: RUN, event_id: id, kind: "user_input", source: { producer_id: "host", channel: "user" }, payload: { text } }
}
function candidate(): Candidate {
  const c = JSON.parse(JSON.stringify(CANDIDATE_EXAMPLE).replaceAll("<triggered-event-id>", "e1").replaceAll("input-event-id", "e1")) as Candidate
  const a = c.groups[0]!.compilation
  if (a.decision !== "replace") throw Error("fixture")
  a.drafts[0]!.atoms[0]!.task = "Locate model_to_dict in the authorized workspace and implement the requested behavior."
  a.drafts[0]!.atoms[0]!.constraints = [{ text: "Preserve None; do not read the linked PR.", basis: [{ source_id: "e1", digest: digestText(TEXT) }], scope: [{ target_id: "t1" }] }]
  a.drafts[0]!.atoms[0]!.return_when = ["Return the change and evidence, or report a blocking missing input."]
  c.groups[0]!.checks = []
  return c
}
function explicitPathCandidate(userText: string): Candidate {
  const c = candidate()
  const source = { source_id: "e-path", digest: digestText(userText) }
  c.basis.event_ids = [source.source_id]
  const group = c.groups[0]!
  const irChange = group.ir_changes[0]
  if (irChange?.action !== "create" || irChange.target !== "task") throw Error("fixture")
  irChange.value = { goal: { text: userText }, current_scope: { text: userText, disposition: "proceed" } }
  irChange.sources = [source]
  const compilation = group.compilation
  if (compilation.decision !== "replace") throw Error("fixture")
  const atom = compilation.drafts[0]!.atoms[0]!
  atom.task = "Only edit django/models/serialization.py to implement the requested behavior and return the change with evidence."
  atom.constraints = [{
    text: "Only edit django/models/serialization.py.",
    basis: [source],
    scope: [{ target_id: "t1" }],
  }]
  atom.authority.basis = [source]
  for (const rule of atom.authority.rules) {
    rule.resource_ref = source
    if (rule.operation_id === "read") rule.allowed_use = "Read django/models/serialization.py to locate the requested behavior."
    if (rule.operation_id === "edit") rule.allowed_use = "Edit only django/models/serialization.py."
  }
  atom.return_when = ["Return the requested change and evidence."]
  return c
}
function reuse(input: CompilerModelV2Input): Candidate {
  return { schema_version: 2, basis: { event_ids: input.events.map(e => e.event_id), refs: [] }, groups: [{
    local_ref: "g1", task_refs: ["t1"], depends_on: [], ir_changes: [],
    compilation: { decision: "reuse", current: [compiledIntentRef(input.compiled.t1!)], reason: "Work content remains applicable." },
    execution_decisions: input.executions.filter(e => e.status === "active").map(e => ({ execution_id: e.execution_id, decision: "continue", reason: "Unchanged work remains authorized.", basis: [] })),
    assessments: [], coverage: [{ requirement: { local_ref: "t1" }, disposition: "assigned", refs: [], explanation: "The existing work still carries the request." }], checks: [], questions: [],
  }] }
}
const UPDATE_TEXT = "Keep the existing fix goal. Preserve None. Defer tests until the implementation is ready. Do not access the linked PR."
function updatedCandidate(input: CompilerModelV2Input, selectedTaskId = "t1"): Candidate {
  const source = { source_id: input.events[0]!.event_id, digest: digestText(UPDATE_TEXT) }
  const existing = input.compiled.t1!
  const priorAtom = existing.atoms[0]!
  const exactPriorRef = input.existing_objects!.tasks.find(task => task.task_id === "t1")!.atoms[0]!.ref
  const c = candidate()
  c.basis.event_ids = input.events.map(e => e.event_id)
  const group = c.groups[0]!
  group.local_ref = "g-update"
  group.task_refs = [selectedTaskId]
  group.ir_changes = [{
    action: "revise",
    target: "current_scope",
    id: selectedTaskId,
    expected_revision: input.ir.t1!.revision,
    value: { text: UPDATE_TEXT, disposition: "proceed" },
    sources: [source],
  }]
  group.execution_decisions = input.executions.filter(e => e.status === "active").map(e => ({
    execution_id: e.execution_id,
    decision: "stop" as const,
    reason: "The updated work supersedes the active execution.",
    basis: [compiledIntentRef(existing)],
  }))
  const compilation = group.compilation
  if (compilation.decision !== "replace") throw Error("fixture")
  const draft = compilation.drafts[0]!
  draft.task_id = selectedTaskId
  draft.intent_basis = [compiledIntentRef(existing)]
  draft.atoms = [{
    ...structuredClone(priorAtom),
    atom_id: priorAtom.atom_id,
    revision: priorAtom.revision + 1,
    goal_refs: [compiledIntentRef(existing)],
    task: "Update the existing implementation to preserve None for empty fields. Keep tests deferred until the implementation is ready, do not access the linked PR, and return the change with evidence.",
    constraints: [
      { text: "Preserve None behavior for empty fields.", basis: [source], scope: [{ target_id: selectedTaskId }] },
      { text: "Defer tests until the implementation is ready; do not run them during this update.", basis: [source], scope: [{ target_id: selectedTaskId }] },
      { text: "Do not access or use the linked PR content.", basis: [source], scope: [{ target_id: selectedTaskId }] },
    ],
    authority: { ...structuredClone(priorAtom.authority), basis: [source] },
    return_when: ["Return the implementation and evidence; report that tests were deferred and the linked PR was not accessed."],
    previous_atom_ref: exactPriorRef,
  }]
  group.coverage = [{ requirement: { local_ref: selectedTaskId }, disposition: "assigned", refs: [{ local_ref: draft.atoms[0]!.atom_id }], explanation: "The existing task and revised atom carry the updated work." }]
  return c
}
function proposed(c: Candidate) { return { ok: true, candidate: c, call: { text: JSON.stringify(c), text_source: "text" as const } } }
const pass: NonNullable<CompilerModelV2["verify"]> = async () => ({ verdict: { verdict: "consistent", findings: [] } })
function deferred<T>() { let resolve!: (v: T) => void; const promise = new Promise<T>(r => { resolve = r }); return { promise, resolve } }
async function setup() {
  const dir = mkdtempSync(join(tmpdir(), "intent-update-"))
  const store = new IntentStoreV2({ storeDir: dir, runId: RUN })
  let propose: CompilerModelV2["propose"] = async () => proposed(candidate())
  let verify: NonNullable<CompilerModelV2["verify"]> = pass
  const compiler = createIntentCompilerV2({ store, model: { propose: i => propose(i), verify: i => verify(i) } })
  await compiler.acceptEvent(event())
  const first = await compiler.advance({ runId: RUN })
  assert.equal(first.ok, true)
  const dispatch = first.deliveries![0]!
  const start = () => compiler.authorize({ kind: "start", run_id: RUN, dispatch_id: dispatch.dispatch_id, host_identity: "host" })
  return { dir, store, compiler, first, dispatch, start, setPropose: (p: typeof propose) => { propose = p }, setVerify: (v: typeof verify) => { verify = v } }
}
function operation(executionId: string) {
  return { kind: "operation" as const, run_id: RUN, execution_id: executionId, host_identity: "host", host_call_id: "read-1", operation_id: "read", resource_ref: { source_id: "e1", digest: digestText(TEXT) }, input_refs: [], output_refs: [] }
}

test("U1/U2 work without a guessed path or self-checks carries constraints and return conditions", async () => {
  const h = await setup()
  const task = h.dispatch.execution_task as ExecutionTask & { constraints?: unknown; return_when?: unknown }
  assert.deepEqual(task.constraints, h.dispatch.atom.constraints)
  assert.deepEqual(task.return_when, h.dispatch.atom.return_when)
  assert.equal(h.store.current().management_calls.length, 2)
  assert.equal(h.start().ok, true)
})

test("an explicit user path limit reaches the proposal and check requests and stays in the exact delivery", async () => {
  const userText = "Only edit django/models/serialization.py to fix the empty-fields behavior."
  const submitted = explicitPathCandidate(userText)
  const store = new IntentStoreV2({ storeDir: mkdtempSync(join(tmpdir(), "intent-update-path-")), runId: RUN })
  let proposalInput: CompilerModelV2Input | undefined
  let checkInput: CompilerModelV2CheckInput | undefined
  const compiler = createIntentCompilerV2({
    store,
    model: {
      propose: async input => { proposalInput = structuredClone(input); return proposed(submitted) },
      // This fixed verdict only drives the existing handoff path; it does not
      // test whether a checker recognizes an unsupported inherited path.
      verify: async input => { checkInput = structuredClone(input); return pass(input) },
    },
  })
  await compiler.acceptEvent(event("e-path", userText))
  const advanced = await compiler.advance({ runId: RUN })

  assert.equal(advanced.ok, true)
  assert.ok(proposalInput)
  assert.ok(checkInput)
  const proposalPrompt = JSON.stringify(proposalInput.contract)
  const checkPrompt = JSON.stringify(checkInput.contract)
  assert.match(proposalPrompt, /source reference proves where a claim came from, not that the cited user text supports the path/i)
  assert.match(checkPrompt, /source reference proves where a claim came from, not that the cited user text supports the path/i)
  assert.match(proposalPrompt, /preserve a path as a user restriction only when/i)
  assert.match(checkPrompt, /preserve still-applicable user path restrictions and host-provided access boundaries/i)
  assert.match(checkPrompt, /does not prove that only that file may be modified/i)

  const delivery = advanced.deliveries?.[0]?.execution_task as ExecutionTask | undefined
  assert.ok(delivery)
  assert.match(delivery.instruction, /Only edit django\/models\/serialization\.py/)
  assert.deepEqual(delivery.constraints?.map(constraint => constraint.text), ["Only edit django/models/serialization.py."])
  assert.equal(delivery.permissions.find(rule => rule.operation_id === "edit")?.allowed_use, "Edit only django/models/serialization.py.")
  assert.deepEqual(delivery.tool_candidates, ["read", "edit", "bash"])
  assert.deepEqual(delivery.permissions.map(rule => rule.operation_id), ["read", "edit", "bash"])
  assert.deepEqual(checkInput.prepared?.execution_tasks[0]?.constraints, delivery.constraints)
  assert.equal(checkInput.prepared?.execution_tasks[0]?.instruction, delivery.instruction)
})

test("U2 a user update with reuse is checked against the prepared IR and work without rewriting atoms", async () => {
  const h = await setup()
  const old = h.store.current().compiled.t1
  let checked: CompilerModelV2CheckInput | undefined
  h.setPropose(async i => proposed(reuse(i)))
  h.setVerify(async i => { checked = structuredClone(i); return pass(i) })
  await h.compiler.acceptEvent(event("e2", "Keep the current implementation scope."))
  assert.equal((await h.compiler.advance({ runId: RUN })).ok, true)
  assert.ok(checked, "reuse must not bypass user-update checking")
  const prepared = checked.prepared
  assert.ok(prepared)
  assert.deepEqual(Object.keys(prepared).sort(), ["eligible_execution_ids", "eligible_task_ids", "execution_tasks", "ir"])
  assert.deepEqual(prepared.ir, h.store.current().ir)
  assert.ok(prepared.execution_tasks.some(t => t.instruction === h.dispatch.atom.task))
  assert.deepEqual(prepared.eligible_task_ids, ["t1"])
  assert.deepEqual(prepared.eligible_execution_ids, [])
  assert.ok(Array.isArray(checked.candidate.groups[0]?.execution_decisions))
  assert.equal("compiled" in prepared, false, "the candidate and prior compiled state already carry the source plans; prepared contains the exact dispatch projection")
  assert.deepEqual(h.store.current().compiled.t1, old)
  assert.equal(h.start().ok, true)
})

test("U3 new input blocks old start across popPending and store reopen", async () => {
  const h = await setup()
  await h.compiler.acceptEvent(event("e2", "Pause the fix."))
  assert.equal(h.start().code, "user_update_pending")
  h.store.popPending()
  const reopened = new IntentStoreV2({ storeDir: h.dir, runId: RUN })
  const compiler = createIntentCompilerV2({ store: reopened, model: { propose: async () => proposed(candidate()) } })
  assert.equal(compiler.authorize({ kind: "start", run_id: RUN, dispatch_id: h.dispatch.dispatch_id, host_identity: "host" }).code, "user_update_pending")
})

test("U3 a failed update keeps the old content and denies subsequent operations", async () => {
  const h = await setup()
  const started = h.start()
  assert.ok(started.execution_id)
  const old = h.store.current().compiled
  await h.compiler.acceptEvent(event("e2", "Pause the fix."))
  h.setPropose(async () => ({ ok: false, error: { code: "schema", message: "fixed failure" } }))
  assert.equal((await h.compiler.advance({ runId: RUN })).code, "schema")
  assert.deepEqual(h.store.current().compiled, old)
  assert.equal(h.compiler.authorize(operation(started.execution_id)).code, "user_update_pending")
})

test("U3 a later user event during check retains the draft but prevents stale commit and extra calls", async () => {
  const h = await setup()
  const entered = deferred<void>(); const release = deferred<void>()
  h.setPropose(async i => proposed(reuse(i)))
  h.setVerify(async i => { entered.resolve(); await release.promise; return pass(i) })
  await h.compiler.acceptEvent(event("e2", "Keep working."))
  const old = h.store.current().ir
  const pending = h.compiler.advance({ runId: RUN })
  assert.equal(await Promise.race([entered.promise.then(() => true), pending.then(() => false)]), true, "the update must reach its check before returning")
  await h.compiler.acceptEvent(event("e3", "Stop; do not read more files."))
  release.resolve()
  const result = await pending
  assert.equal(result.code, "stale_basis")
  assert.deepEqual(h.store.current().ir, old)
  assert.equal(h.start().code, "user_update_pending")
  assert.equal(h.store.current().management_calls.length, 4)
  assert.ok(h.store.current().management_log.at(-1)?.candidate)
  assert.equal(h.store.current().management_log.at(-1)?.error_code, "stale_basis")
})

test("U3 changed execution state during check is not overwritten by the old prepared snapshot", async () => {
  const h = await setup()
  const started = h.start(); assert.ok(started.execution_id)
  const entered = deferred<void>(); const release = deferred<void>()
  h.setPropose(async i => proposed(reuse(i)))
  h.setVerify(async i => { entered.resolve(); await release.promise; return pass(i) })
  await h.compiler.acceptEvent(event("e2", "Keep working."))
  const pending = h.compiler.advance({ runId: RUN })
  assert.equal(await Promise.race([entered.promise.then(() => true), pending.then(() => false)]), true, "the update must reach its check before returning")
  const receipt = await h.compiler.acceptEvent({ schema_version: 2, run_id: RUN, event_id: "return-1", kind: "execution_return", execution_id: started.execution_id, source: { producer_id: "host", channel: "executor" }, payload: { state_claim: "completed", outcome: { schema_version: 2, execution_id: started.execution_id, atom_ref: atomRef(h.dispatch.atom), suggested_status: "completed", product_refs: [], file_changes: [], evidence_refs: [] } } })
  assert.equal(receipt.ok, true, receipt.message)
  release.resolve()
  assert.equal((await pending).code, "stale_basis")
  assert.equal(h.store.current().executions[0]?.status, "closed")
  assert.equal(h.store.current().atom_states[0]?.status, "completed")
})

test("U2 preparing a replacement must not close an active execution before a rejected check", async () => {
  const h = await setup()
  const started = h.start(); assert.ok(started.execution_id)
  h.setPropose(async i => {
    const c = candidate(); c.basis.event_ids = ["e2"]; c.groups[0]!.ir_changes = []
    c.groups[0]!.execution_decisions = [{ execution_id: started.execution_id!, decision: "stop", reason: "replaced", basis: [] }]
    return proposed(c)
  })
  h.setVerify(async () => {
    assert.equal(h.store.current().executions[0]?.status, "active")
    return { verdict: { verdict: "inconsistent", findings: [{ dimension: "D6", claim: "fixed objection", expected: "retain scope", observed: "changed scope", refs: [{ source_id: "e2", digest: digestText(TEXT) }] }] } }
  })
  await h.compiler.acceptEvent(event("e2"))
  assert.equal((await h.compiler.advance({ runId: RUN })).ok, false)
  assert.equal(h.store.current().executions[0]?.status, "active")
  assert.equal(h.compiler.authorize(operation(started.execution_id)).ok, false)
})

test("U3 accepted pause and resume preserve constraints and never reactivate stopped credentials", async () => {
  const h = await setup()
  const started = h.start(); assert.ok(started.execution_id)
  h.setPropose(async i => {
    const c = reuse(i)
    c.groups[0]!.ir_changes = [{ action: "revise", target: "current_scope", id: "t1", expected_revision: i.ir.t1!.revision, value: { text: "Paused; preserve None and do not read PR.", disposition: "paused" }, sources: [{ source_id: "e2", digest: digestText(TEXT) }] }]
    c.groups[0]!.execution_decisions = [{ execution_id: started.execution_id!, decision: "stop", reason: "user paused", basis: [] }]
    c.groups[0]!.coverage[0]!.disposition = "paused"
    return proposed(c)
  })
  await h.compiler.acceptEvent(event("e2", "Pause the fix."))
  const paused = await h.compiler.advance({ runId: RUN })
  assert.equal(paused.ok, true)
  assert.equal(paused.disposition, "waiting")
  assert.equal(h.compiler.authorize(operation(started.execution_id)).ok, false)
  assert.deepEqual(h.store.current().compiled.t1!.atoms[0]!.constraints, h.dispatch.atom.constraints)
  h.setPropose(async i => {
    const c = reuse(i)
    c.groups[0]!.ir_changes = [{ action: "revise", target: "current_scope", id: "t1", expected_revision: i.ir.t1!.revision, value: { text: "Proceed; preserve None and do not read PR.", disposition: "proceed" }, sources: [{ source_id: "e3", digest: digestText(TEXT) }] }]
    return proposed(c)
  })
  await h.compiler.acceptEvent(event("e3", "Resume; retain the other restrictions."))
  assert.equal((await h.compiler.advance({ runId: RUN })).ok, true)
  assert.equal(h.compiler.authorize(operation(started.execution_id)).ok, false)
  assert.deepEqual(h.store.current().compiled.t1!.atoms[0]!.constraints, h.dispatch.atom.constraints)
})

test("a rejected update keeps the old draft, then a revision selected from the object directory restores new-work eligibility", async () => {
  const h = await setup()
  const started = h.start()
  assert.ok(started.execution_id)
  const oldIr = structuredClone(h.store.current().ir)
  const oldCompiled = structuredClone(h.store.current().compiled)
  await h.compiler.acceptEvent(event("e2", UPDATE_TEXT))
  assert.equal(h.start().code, "user_update_pending")

  let invalidCalls = 0
  h.setPropose(async input => {
    assert.equal(input.existing_objects?.tasks[0]?.task_id, "t1")
    assert.deepEqual(input.existing_objects?.tasks[0]?.atoms[0]?.ref, atomRef(oldCompiled.t1!.atoms[0]!))
    invalidCalls++
    if (invalidCalls === 1) return proposed({ schema_version: 2, basis: { event_ids: [], refs: [] }, groups: [] })
    return proposed(updatedCandidate(input, "django__django-11163"))
  })
  const rejected = await h.compiler.advance({ runId: RUN })
  assert.equal(rejected.code, "invalid_candidate")
  assert.equal(invalidCalls, 2, "the unchanged three-request batch budget must preserve a request for an independent check")
  assert.deepEqual(h.store.current().ir, oldIr)
  assert.deepEqual(h.store.current().compiled, oldCompiled)
  const failedRecord = h.store.current().management_log.at(-1)!
  assert.equal(failedRecord.status, "validation_failed")
  assert.ok(failedRecord.attempts?.[0]?.issues?.some(issue => issue.includes("candidate basis is empty")))
  assert.ok(failedRecord.attempts?.[1]?.issues?.some(issue => issue.includes("unknown task django__django-11163")))
  assert.ok(failedRecord.attempts?.[1]?.issues?.some(issue => issue.includes("previous_atom_ref references unknown atom a1@0")))
  assert.deepEqual(failedRecord.attempts?.map(attempt => attempt.kind), ["propose", "propose"])
  assert.deepEqual(failedRecord.candidate?.groups[0]?.task_refs, ["django__django-11163"])
  assert.equal(h.compiler.authorize(operation(started.execution_id)).code, "user_update_pending")

  let repairInput: CompilerModelV2Input | undefined
  h.setPropose(async input => {
    repairInput = structuredClone(input)
    return proposed(updatedCandidate(input))
  })
  const recovered = await h.compiler.advance({ runId: RUN })
  assert.equal(recovered.ok, true, recovered.message ?? "")
  assert.ok(repairInput?.repair_context, "the rejected draft remains the explicit revision starting point")
  assert.equal(repairInput?.repair_context?.basis_status, "unchanged")
  assert.equal(repairInput?.existing_objects?.tasks[0]?.task_id, "t1")
  assert.deepEqual(h.store.current().atom_states.find(state => state.task_id === "t1" && state.atom_id === "a1" && state.atom_revision === 1)?.previous_atom_ref, atomRef(oldCompiled.t1!.atoms[0]!))
  const delivery = recovered.deliveries?.[0]
  assert.ok(delivery)
  assert.deepEqual(delivery.atom.constraints.map(item => item.text), [
    "Preserve None behavior for empty fields.",
    "Defer tests until the implementation is ready; do not run them during this update.",
    "Do not access or use the linked PR content.",
  ])
  assert.deepEqual(h.store.current().executions.find(e => e.execution_id === started.execution_id)?.status, "closed")
  const eligible = await h.compiler.authorize({ kind: "start", run_id: RUN, dispatch_id: delivery.dispatch_id, host_identity: "host" })
  assert.equal(eligible.ok, true)
  assert.equal(h.store.current().executions.at(-1)?.status, "active")
})

test("a per-call candidate parse failure keeps its stage and exception chain in the management record", async () => {
  const dir = mkdtempSync(join(tmpdir(), "intent-transport-diagnostic-"))
  const store = new IntentStoreV2({ storeDir: dir, runId: RUN })
  store.applyDeltas({ max_management_requests: 1 })
  const compiler = createIntentCompilerV2({ store, model: createCompilerModelV2(async () => "not-json") })
  await compiler.acceptEvent(event())
  const result = await compiler.advance({ runId: RUN })
  assert.equal(result.code, "json")
  const call = store.current().management_calls[0]!
  assert.equal(call.failure_diagnostic?.phase, "candidate_json_parse")
  assert.equal(call.failure_diagnostic?.response_received, true)
  assert.equal(call.failure_diagnostic?.exception_chain?.[0]?.name, "Error")
  const attempt = store.current().management_log[0]?.attempts?.[0]
  assert.equal(attempt?.failure_diagnostic?.phase, "candidate_json_parse")
  assert.equal(attempt?.failure_diagnostic?.exception_chain?.[0]?.message, "model response contains no JSON object")
})

test("a provider connection failure reaches each persisted call and candidate record", async () => {
  const dir = mkdtempSync(join(tmpdir(), "intent-provider-diagnostic-"))
  const store = new IntentStoreV2({ storeDir: dir, runId: RUN })
  store.applyDeltas({ max_management_requests: 1 })
  const transport = createStructuredProviderTransport({
    endpoint: "https://api.example.invalid/v1/chat/completions",
    modelId: "qwen3.8-flash",
    apiKey: "test-key",
    fetch: async () => { throw new TypeError("fetch failed", { cause: new Error("connect ECONNRESET") }) },
  })
  const compiler = createIntentCompilerV2({ store, model: createCompilerModelV2(transport) })
  await compiler.acceptEvent(event())
  const result = await compiler.advance({ runId: RUN })
  assert.equal(result.code, "transport")
  const call = store.current().management_calls[0]!
  assert.equal(call.failure_diagnostic?.phase, "request")
  assert.deepEqual(call.failure_diagnostic?.exception_chain?.map(item => item.message), ["fetch failed", "connect ECONNRESET"])
  const attempt = store.current().management_log[0]?.attempts?.[0]
  assert.equal(attempt?.failure_diagnostic?.response_received, false)
  assert.equal(attempt?.failure_diagnostic?.phase, "request")
})

test("U4 a valid waiting outcome reports host capability rather than candidate failure", async () => {
  const h = await setup()
  h.setPropose(async i => { const c = reuse(i); c.groups[0]!.questions = [{ text: "Which unavailable input should be supplied?", affects: ["t1"] }]; return proposed(c) })
  const hooks = createOpenCodeAdapter({ arm: "compiler", client: {}, compiler: h.compiler,
    resolveTurn: () => ({ runId: RUN, inputIdentity: "input-2" }),
    observer: { captureRawInput: () => true, expectDelivery: () => true, observeEvent: () => true },
  }).hooks()
  const output = { message: { id: "m2" }, parts: [{ id: "p2", type: "text" as const, text: "Clarify the missing input." }] }
  await assert.rejects(hooks["chat.message"]({ sessionID: "s2", messageID: "m2" }, output), (error: unknown) => {
    assert.equal((error as { code: string }).code, "COMPILER_HOST_WAIT_UNSUPPORTED")
    assert.equal((error as { retryable: boolean }).retryable, false)
    return true
  })
})

test("U2 the checker receives isolated input and cannot rewrite the object to commit", async () => {
  const h = await setup()
  const original = h.store.current().ir
  h.setPropose(async i => proposed(reuse(i)))
  h.setVerify(async i => {
    i.ir.t1!.goal.text = "checker mutation"
    const prepared = (i as CompilerModelV2CheckInput & { prepared?: { ir: typeof original } }).prepared
    if (prepared) prepared.ir.t1!.goal.text = "prepared view mutation"
    return pass(i)
  })
  await h.compiler.acceptEvent(event("e2", "Keep the current work."))
  assert.equal((await h.compiler.advance({ runId: RUN })).ok, true)
  assert.deepEqual(h.store.current().ir, original)
})

test("U3 explicit continuation of an unchanged atom preserves its active lifecycle", async () => {
  const h = await setup()
  let checked: CompilerModelV2CheckInput | undefined
  const started = h.start(); assert.ok(started.execution_id)
  h.setVerify(async input => { checked = structuredClone(input); return pass(input) })
  h.setPropose(async i => {
    const c = candidate(); c.basis.event_ids = ["e2"]; c.groups[0]!.ir_changes = []
    const compilation = c.groups[0]!.compilation
    if (compilation.decision === "replace") compilation.drafts[0]!.atoms = [structuredClone(h.dispatch.atom)]
    c.groups[0]!.execution_decisions = [{ execution_id: started.execution_id!, decision: "continue", reason: "same work", basis: [] }]
    return proposed(c)
  })
  await h.compiler.acceptEvent(event("e2", "Keep the current work."))
  assert.equal((await h.compiler.advance({ runId: RUN })).ok, true)
  assert.equal(checked?.candidate.groups[0]?.execution_decisions[0]?.decision, "continue")
  assert.deepEqual(checked?.prepared?.eligible_execution_ids, [started.execution_id])
  assert.equal(h.store.current().executions[0]?.status, "active")
  assert.equal(h.store.current().atom_states[0]?.status, "executing")
  assert.equal(h.compiler.authorize(operation(started.execution_id)).ok, true)
})

test("U3 a stopped execution can return historical evidence without restoring authority or current atom status", async () => {
  const h = await setup()
  const started = h.start(); assert.ok(started.execution_id)
  h.setPropose(async i => {
    const c = reuse(i)
    c.groups[0]!.execution_decisions = [{ execution_id: started.execution_id!, decision: "stop", reason: "user stopped", basis: [] }]
    return proposed(c)
  })
  await h.compiler.acceptEvent(event("e2", "Stop this execution."))
  assert.equal((await h.compiler.advance({ runId: RUN })).ok, true)
  const oldStates = h.store.current().atom_states
  const receipt = await h.compiler.acceptEvent({ schema_version: 2, run_id: RUN, event_id: "late-return", kind: "execution_return", execution_id: started.execution_id, source: { producer_id: "host", channel: "executor" }, payload: { state_claim: "completed", outcome: { schema_version: 2, execution_id: started.execution_id, atom_ref: atomRef(h.dispatch.atom), suggested_status: "completed", product_refs: [], file_changes: [], evidence_refs: [] } } })
  assert.equal(receipt.ok, true, receipt.message)
  assert.deepEqual(h.store.current().atom_states, oldStates)
  assert.equal(h.store.current().execution_outcomes.at(-1)?.atom_status_after, "unchanged")
  assert.equal(h.compiler.authorize(operation(started.execution_id)).ok, false)
})
