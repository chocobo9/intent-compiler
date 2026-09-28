import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { IntentStoreV2 } from "../src/core/compiler-store-v2.js"
import { createIntentCompilerV2 } from "../src/core/intent-compiler-v2.js"
import { atomRef } from "../src/core/compiled-intent.js"
import { createCompilerModelV2 } from "../src/model/compiler-model-v2.js"
import type { CompilerModelV2Input, CompilerModelV2Result } from "../src/model/compiler-model-v2.js"
import { CANDIDATE_EXAMPLE } from "../src/model/candidate-example.js"
import { digestText } from "../src/core/intent-contract.js"
import type {
  Atom,
  Candidate,
  CompilerEvent,
  Ref,
  SourceRef,
} from "../src/core/intent-contract.js"

const SOURCE: SourceRef = { source_id: "s-u1", digest: "sha256:0000000000000000000000000000000000000000000000000000000000000001" }
const TASK_REF: Ref = { id: "t-fix", revision: 0, digest: "sha256:1111111111111111111111111111111111111111111111111111111111111111" }

function event(runId: string, id: string, text: string, kind: CompilerEvent["kind"] = "user_input"): CompilerEvent {
  return {
    schema_version: 2,
    run_id: runId,
    event_id: id,
    kind,
    source: { producer_id: "host", channel: "user" },
    task_ids: ["t-fix"],
    payload: { text },
  }
}

function candidateAtom(atomId: string, task = "preview fix"): Atom {
  return {
    atom_id: atomId,
    revision: 0,
    goal_refs: [],
    task,
    inputs: [],
    outputs: [],
    constraints: [],
    optional_tools: [],
    authority: { basis: [SOURCE], rules: [], lifetime: "this_execution", delegation: "not_supported" },
    preconditions: [],
    completion: [],
    return_when: [],
    intent_judgments: [],
  }
}

function replaceCompiledCandidate(eventId: string, atomId: string): Candidate {
  return {
    schema_version: 2,
    basis: { event_ids: [eventId], refs: [] },
    groups: [{
      local_ref: "g1",
      task_refs: ["t-fix"],
      depends_on: [],
      ir_changes: [],
      compilation: {
        decision: "replace",
        drafts: [{
          local_ref: "ci-local-1",
          task_id: "t-fix",
          intent_basis: [],
          atoms: [candidateAtom(atomId, `deliver ${atomId}`)],
          relations: [],
          attachments: [],
        }],
      },
      execution_decisions: [],
      assessments: [],
      coverage: [{ requirement: { local_ref: "t-fix" }, disposition: "assigned", refs: [{ local_ref: atomId }], explanation: "delivery" }],
      checks: [],
      questions: [],
    }],
  }
}

function createTaskCandidate(
  eventId: string,
  text: string,
  options: { coverage?: "task" | "atom" | "none" } = {},
): Candidate {
  const coverage = options.coverage ?? "task"
  return {
    schema_version: 2,
    basis: { event_ids: [eventId], refs: [] },
    groups: [{
      local_ref: "g1",
      task_refs: ["t-fix"],
      depends_on: [],
      ir_changes: [{
        action: "create",
        target: "task",
        local_ref: "t-fix",
        value: { goal: { text }, current_scope: { text: "proceed", disposition: "proceed" } },
        sources: [SOURCE],
      }],
      compilation: {
        decision: "replace",
        drafts: [{
          local_ref: "ci-1",
          task_id: "t-fix",
          intent_basis: [],
          atoms: [{
            atom_id: "a-preview",
            revision: 0,
            goal_refs: [TASK_REF],
            task: "preview fix",
            inputs: [],
            outputs: [],
            constraints: [],
            optional_tools: [],
            authority: {
              basis: [SOURCE],
              rules: [{
                operation_id: "op.read",
                resource_ref: { source_id: "s-s", digest: "sha256:2222222222222222222222222222222222222222222222222222222222222222" },
                input_refs: [],
                output_refs: [],
                conditions: [],
                allowed_use: "read sandbox copy",
              }],
              lifetime: "this_execution",
              delegation: "not_supported",
            },
            preconditions: [],
            completion: [],
            return_when: [],
            intent_judgments: [],
          }],
          relations: [],
          attachments: [],
        }],
      },
      execution_decisions: [],
      assessments: [],
      coverage: coverage === "none"
        ? []
        : [{
            requirement: coverage === "task" ? { local_ref: "t-fix" } : { local_ref: "a-preview" },
            disposition: "assigned" as const,
            refs: coverage === "task" ? [{ local_ref: "a-preview" }] : [],
            explanation: "a-preview is the deliverable for t-fix.",
          }],
      checks: [],
      questions: [],
    }],
  }
}

test("v2 accepts, deduplicates, and rejects identity conflicts", async () => {
  const store = new IntentStoreV2({ storeDir: mkdtempSync(join(tmpdir(), "intent-v2-")), runId: "run-1" })
  const compiler = createIntentCompilerV2({ store, model: createCompilerModelV2(async () => JSON.stringify({ schema_version: 2, basis: { event_ids: [], refs: [] }, groups: [] })) })
  const first = event("run-1", "e1", "hello")
  const firstReceipt = await compiler.acceptEvent(first)
  assert.equal(firstReceipt.status, "saved")
  const duplicate = await compiler.acceptEvent(first)
  assert.equal(duplicate.status, "duplicate")
  const conflict = await compiler.acceptEvent(event("run-1", "e1", "different"))
  assert.equal(conflict.status, "rejected")
  assert.equal(conflict.code, "identity_conflict")
})

test("v2 advances a first task, dispatches a ready atom, and authorizes operations", async () => {
  const store = new IntentStoreV2({ storeDir: mkdtempSync(join(tmpdir(), "intent-v2-")), runId: "run-1" })
  const inputEvent = event("run-1", "e1", "fix CSV preview")
  const compiler = createIntentCompilerV2({
    store,
    model: createCompilerModelV2(async () => JSON.stringify(createTaskCandidate("e1", "fix CSV preview"))),
  })
  await compiler.acceptEvent(inputEvent)
  const advanced = await compiler.advance({ runId: "run-1" })
  assert.equal(advanced.ok, true)
  assert.equal(advanced.disposition, "dispatched")
  assert.equal(advanced.deliveries?.length, 1)
  const managementLog = store.current().management_log
  assert.equal(managementLog.length, 1)
  assert.equal(managementLog[0]?.status, "accepted")
  assert.equal(managementLog[0]?.trigger_event_ids[0], "e1")
  assert.equal(managementLog[0]?.raw_response_digest?.startsWith("sha256:"), true)
  assert.equal(store.current().budget.management_input_tokens, "unavailable")
  const dispatchId = advanced.deliveries?.[0]?.dispatch_id
  assert.ok(dispatchId)

  const start = await compiler.authorize({ kind: "start", run_id: "run-1", dispatch_id: dispatchId as string, host_identity: "host-1" })
  assert.equal(start.ok, true)
  const executionId = start.execution_id
  assert.ok(executionId)

  const op = await compiler.authorize({
    kind: "operation",
    run_id: "run-1",
    execution_id: executionId as string,
    host_identity: "host-1",
    host_call_id: "call-1",
    operation_id: "op.read",
    resource_ref: { source_id: "s-s", digest: "sha256:2222222222222222222222222222222222222222222222222222222222222222" },
    input_refs: [],
    output_refs: [],
  })
  assert.equal(op.ok, true)
  assert.ok(op.allowed_call_id)

  const denied = await compiler.authorize({
    kind: "operation",
    run_id: "run-1",
    execution_id: executionId as string,
    host_identity: "host-1",
    host_call_id: "call-2",
    operation_id: "op.write-r",
    resource_ref: { source_id: "s-s", digest: "sha256:2222222222222222222222222222222222222222222222222222222222222222" },
    input_refs: [],
    output_refs: [],
  })
  assert.equal(denied.ok, false)
  assert.equal(denied.code, "capability_unsupported")
})

test("v2 preserves a later constraint when pause and resume revise only scope", async () => {
  const store = new IntentStoreV2({ storeDir: mkdtempSync(join(tmpdir(), "intent-v2-")), runId: "run-1" })
  const replies: Record<string, Candidate> = {
    e1: createTaskCandidate("e1", "fix CSV preview"),
    e2: {
      schema_version: 2,
      basis: { event_ids: ["e2"], refs: [] },
      groups: [{
        local_ref: "g2",
        task_refs: ["t-fix"],
        depends_on: [],
        ir_changes: [{
          action: "revise",
          target: "current_scope",
          id: "t-fix",
          expected_revision: 0,
          value: { text: "paused", disposition: "paused" },
          sources: [SOURCE],
        }],
        compilation: { decision: "reuse", current: [], reason: "no change" },
        execution_decisions: [],
        assessments: [],
        coverage: [],
        checks: [],
        questions: [],
      }],
    },
    e3: {
      schema_version: 2,
      basis: { event_ids: ["e3"], refs: [] },
      groups: [{
        local_ref: "g3",
        task_refs: ["t-fix"],
        depends_on: [],
        ir_changes: [{
          action: "create",
          target: "content",
          local_ref: "c-null",
          value: { text: "null name exports empty", scope: [{ target_id: "t-fix" }] },
          sources: [SOURCE],
        }],
        compilation: { decision: "reuse", current: [], reason: "paused" },
        execution_decisions: [],
        assessments: [],
        coverage: [],
        checks: [],
        questions: [],
      }],
    },
    e4: {
      schema_version: 2,
      basis: { event_ids: ["e4"], refs: [] },
      groups: [{
        local_ref: "g4",
        task_refs: ["t-fix"],
        depends_on: [],
        ir_changes: [{
          action: "revise",
          target: "current_scope",
          id: "t-fix",
          expected_revision: 1,
          value: { text: "proceed preview only", disposition: "proceed" },
          sources: [SOURCE],
        }],
        compilation: { decision: "reuse", current: [], reason: "resume only" },
        execution_decisions: [],
        assessments: [],
        coverage: [],
        checks: [],
        questions: [],
      }],
    },
  }
  const compiler = createIntentCompilerV2({
    store,
    model: createCompilerModelV2(async (input) => {
      const id = input.events[0]?.event_id ?? ""
      return JSON.stringify(replies[id] ?? { schema_version: 2, basis: { event_ids: input.events.map((item) => item.event_id), refs: [] }, groups: [] })
    }),
  })

  await compiler.acceptEvent(event("run-1", "e1", "fix CSV preview"))
  await compiler.advance({ runId: "run-1" })
  await compiler.acceptEvent(event("run-1", "e2", "pause fix"))
  await compiler.advance({ runId: "run-1" })
  await compiler.acceptEvent(event("run-1", "e3", "add null constraint"))
  await compiler.advance({ runId: "run-1" })
  await compiler.acceptEvent(event("run-1", "e4", "resume preview"))
  const result = await compiler.advance({ runId: "run-1" })

  assert.equal(result.ok, true)
  const view = await compiler.inspect({ runId: "run-1" })
  const task = view.current_ir["t-fix"]
  assert.ok(task)
  assert.equal(task.current_scope.disposition, "proceed")
  assert.equal(task.content.some((item) => item.item_id === "c-null"), true)
})

test("v2 requeues pending events when a candidate is invalid", async () => {
  const store = new IntentStoreV2({ storeDir: mkdtempSync(join(tmpdir(), "intent-v2-")), runId: "run-1" })
  const compiler = createIntentCompilerV2({
    store,
    model: createCompilerModelV2(async () => JSON.stringify({ schema_version: 2, basis: { event_ids: ["missing"], refs: [] }, groups: [] })),
  })
  await compiler.acceptEvent(event("run-1", "e1", "hello"))
  const result = await compiler.advance({ runId: "run-1" })
  assert.equal(result.ok, false)
  assert.equal(result.code, "invalid_candidate")
  const view = await compiler.inspect({ runId: "run-1" })
  assert.deepEqual(view.pending_event_ids, ["e1"])
})

test("v2 retries a schema-invalid candidate once with field errors", async () => {
  const store = new IntentStoreV2({ storeDir: mkdtempSync(join(tmpdir(), "intent-v2-")), runId: "run-1" })
  let calls = 0
  const compiler = createIntentCompilerV2({
    store,
    model: {
      propose: async (input): Promise<CompilerModelV2Result> => {
        calls += 1
        if (calls === 1) {
          return {
            ok: false,
            error: { code: "schema", message: "invalid" },
            schema_errors: ["/groups/0/atoms/0/inputs: must not be the wrong shape"],
          }
        }
        assert.equal(input.validation_errors?.[0], "/groups/0/atoms/0/inputs: must not be the wrong shape")
        return { ok: true, candidate: createTaskCandidate("e1", "fix CSV preview"), call: { text: "{}", text_source: "text" } }
      },
    },
  })
  await compiler.acceptEvent(event("run-1", "e1", "fix CSV preview"))
  const result = await compiler.advance({ runId: "run-1" })
  assert.equal(result.ok, true)
  assert.equal(calls, 2)
  assert.equal(store.current().management_log[0]?.retry, true)
  assert.equal(store.current().budget.management_requests, 2)
})

test("v2 format retry preserves the actual rejected-candidate revision context", async () => {
  const store = new IntentStoreV2({ storeDir: mkdtempSync(join(tmpdir(), "intent-v2-")), runId: "run-1" })
  // This deterministic fixture allows the third proposal plus its required
  // independent check; production budget defaults remain unchanged.
  store.applyDeltas({ max_management_requests: 4 })
  const seen: CompilerModelV2Input[] = []
  const rejected = createTaskCandidate("e1", "fix CSV preview", { coverage: "none" })
  let calls = 0
  const compiler = createIntentCompilerV2({
    store,
    model: {
      propose: async (input): Promise<CompilerModelV2Result> => {
        seen.push(structuredClone(input))
        calls += 1
        if (calls === 1) return { ok: true, candidate: structuredClone(rejected), call: { text: JSON.stringify(rejected), text_source: "text" } }
        if (calls === 2) return {
          ok: false,
          call: { text: "I could not finish the JSON object.", text_source: "reasoning" },
          error: { code: "json", message: "model response contains no JSON object" },
        }
        return { ok: true, candidate: createTaskCandidate("e1", "fix CSV preview"), call: { text: "{}", text_source: "text" } }
      },
    },
  })
  await compiler.acceptEvent(event("run-1", "e1", "fix CSV preview"))
  const result = await compiler.advance({ runId: "run-1" })

  assert.equal(result.ok, true, result.message ?? "")
  assert.equal(calls, 3)
  assert.ok((seen[1]?.validation_errors?.length ?? 0) > 0)
  assert.deepEqual(seen[2]?.validation_errors, seen[1]?.validation_errors)
  assert.deepEqual(seen[2]?.repair_context, seen[1]?.repair_context)
  assert.deepEqual(seen[2]?.repair_context?.candidate, rejected)
})

test("v2 passes a schema-invalid returned draft into its revision request", async () => {
  const store = new IntentStoreV2({ storeDir: mkdtempSync(join(tmpdir(), "intent-v2-")), runId: "run-1" })
  const seen: CompilerModelV2Input[] = []
  const rejectedDraft = { schema_version: 2, basis: { event_ids: ["e1"], refs: [] }, groups: [{}] }
  const rejectedText = JSON.stringify(rejectedDraft)
  let calls = 0
  const model = createCompilerModelV2(async (input) => {
    seen.push(structuredClone(input))
    calls += 1
    return calls === 1
      ? { text: rejectedText, text_source: "text" }
      : { text: JSON.stringify(createTaskCandidate("e1", "fix CSV preview")), text_source: "text" }
  })
  const compiler = createIntentCompilerV2({ store, model })
  await compiler.acceptEvent(event("run-1", "e1", "fix CSV preview"))
  const result = await compiler.advance({ runId: "run-1" })

  assert.equal(result.ok, true, result.message ?? "")
  assert.equal(calls, 2)
  assert.ok((seen[1]?.validation_errors?.length ?? 0) > 0)
  assert.deepEqual((seen[1] as CompilerModelV2Input & { schema_rejected_draft?: unknown }).schema_rejected_draft, {
    text: rejectedText,
    errors: seen[1]?.validation_errors,
  })
})

test("v2 uses at most the per-batch request budget when schema revisions keep failing", async () => {
  const store = new IntentStoreV2({ storeDir: mkdtempSync(join(tmpdir(), "intent-v2-")), runId: "run-1" })
  let calls = 0
  const compiler = createIntentCompilerV2({
    store,
    model: {
      propose: async (): Promise<CompilerModelV2Result> => {
        calls += 1
        return { ok: false, error: { code: "schema", message: "still invalid" }, schema_errors: [`attempt ${calls} schema error`] }
      },
    },
  })
  await compiler.acceptEvent(event("run-1", "e1", "fix CSV preview"))
  const result = await compiler.advance({ runId: "run-1" })
  assert.equal(result.ok, false)
  assert.equal(calls, store.current().budget.max_management_requests)
  const view = await compiler.inspect({ runId: "run-1" })
  assert.deepEqual(view.pending_event_ids, ["e1"])
})

test("v2 advance stops without calling the model when the run total budget is exhausted", async () => {
  const store = new IntentStoreV2({ storeDir: mkdtempSync(join(tmpdir(), "intent-v2-")), runId: "run-1" })
  let calls = 0
  const compiler = createIntentCompilerV2({
    store,
    model: {
      propose: async (): Promise<CompilerModelV2Result> => {
        calls += 1
        return { ok: true, candidate: createTaskCandidate("e1", "fix CSV preview"), call: { text: "{}", text_source: "text" } }
      },
    },
  })
  store.applyDeltas({ management_requests: store.current().budget.max_total_management_requests })
  await compiler.acceptEvent(event("run-1", "e1", "fix CSV preview"))
  const result = await compiler.advance({ runId: "run-1" })
  assert.equal(result.ok, false)
  assert.equal(result.code, "budget_exhausted")
  assert.equal(calls, 0)
  const view = await compiler.inspect({ runId: "run-1" })
  assert.deepEqual(view.pending_event_ids, ["e1"])
})

test("v2 rejects compiled work with no coverage entry and accepts the revision", async () => {
  const store = new IntentStoreV2({ storeDir: mkdtempSync(join(tmpdir(), "intent-v2-")), runId: "run-1" })
  const seen: string[][] = []
  const compiler = createIntentCompilerV2({
    store,
    model: {
      propose: async (input): Promise<CompilerModelV2Result> => {
        seen.push([...(input.validation_errors ?? [])])
        const candidate = seen.length === 1
          ? createTaskCandidate("e1", "fix CSV preview", { coverage: "none" })
          : createTaskCandidate("e1", "fix CSV preview")
        return { ok: true, candidate, call: { text: "{}", text_source: "text" } }
      },
    },
  })
  await compiler.acceptEvent(event("run-1", "e1", "fix CSV preview"))
  const result = await compiler.advance({ runId: "run-1" })

  assert.equal(result.ok, true)
  assert.equal(result.disposition, "dispatched")
  assert.equal(seen[0]?.length, 0)
  assert.match(seen[1]?.[0] ?? "", /coverage must record where the compiled work for task t-fix goes/)
  assert.equal(store.current().budget.management_requests, 2)
  assert.equal(store.current().management_log[0]?.retry, true)
  const coverage = store.current().coverage
  assert.equal(coverage.length, 1)
  assert.deepEqual(coverage[0]?.basis_event_ids, ["e1"])
  assert.equal(coverage[0]?.task_id, "t-fix")
  assert.equal(coverage[0]?.disposition, "assigned")
})

test("v2 accepts a coverage entry that names the atom carrying the work", async () => {
  const store = new IntentStoreV2({ storeDir: mkdtempSync(join(tmpdir(), "intent-v2-")), runId: "run-1" })
  let calls = 0
  const compiler = createIntentCompilerV2({
    store,
    model: {
      propose: async (): Promise<CompilerModelV2Result> => {
        calls += 1
        return { ok: true, candidate: createTaskCandidate("e1", "fix CSV preview", { coverage: "atom" }), call: { text: "{}", text_source: "text" } }
      },
    },
  })
  await compiler.acceptEvent(event("run-1", "e1", "fix CSV preview"))
  const result = await compiler.advance({ runId: "run-1" })

  assert.equal(result.ok, true)
  assert.equal(result.deliveries?.length, 1)
  assert.equal(calls, 1)
})

test("v2 rejects a candidate that never records where the compiled work goes", async () => {
  const store = new IntentStoreV2({ storeDir: mkdtempSync(join(tmpdir(), "intent-v2-")), runId: "run-1" })
  const compiler = createIntentCompilerV2({
    store,
    model: {
      propose: async (): Promise<CompilerModelV2Result> => ({
        ok: true,
        candidate: createTaskCandidate("e1", "fix CSV preview", { coverage: "none" }),
        call: { text: "{}", text_source: "text" },
      }),
    },
  })
  await compiler.acceptEvent(event("run-1", "e1", "fix CSV preview"))
  const result = await compiler.advance({ runId: "run-1" })

  assert.equal(result.ok, false)
  assert.equal(result.code, "invalid_candidate")
  assert.match(result.message ?? "", /coverage must record where the compiled work for task t-fix goes/)
  assert.equal(store.current().budget.management_requests, store.current().budget.max_management_requests)
  assert.equal(store.current().management_log[0]?.status, "validation_failed")
  assert.equal(store.current().management_log[0]?.error_code, "invalid_candidate")
  assert.equal(store.current().coverage.length, 0)
  const view = await compiler.inspect({ runId: "run-1" })
  assert.deepEqual(view.pending_event_ids, ["e1"])
})

test("the shipped candidate example is accepted, dispatched, and records its coverage", async () => {
  const store = new IntentStoreV2({ storeDir: mkdtempSync(join(tmpdir(), "intent-v2-")), runId: "run-1" })
  const example = JSON.parse(JSON.stringify(CANDIDATE_EXAMPLE)) as Candidate
  example.basis.event_ids = ["e1"]
  const compiler = createIntentCompilerV2({
    store,
    model: createCompilerModelV2(async () => JSON.stringify(example)),
  })
  await compiler.acceptEvent(event("run-1", "e1", "example delegation"))
  const result = await compiler.advance({ runId: "run-1" })

  assert.equal(result.ok, true, result.message ?? "")
  assert.equal(result.disposition, "dispatched")
  const delivery = result.deliveries?.[0]
  assert.ok(delivery?.execution_task)
  assert.equal(delivery.execution_task.instruction, "Deliver the example user goal as o1.")
  assert.deepEqual(delivery.execution_task.tool_candidates, ["read", "edit", "bash"])
  assert.deepEqual(delivery.execution_task.permissions.map((rule) => rule.operation_id), ["read", "edit", "bash"])
  assert.deepEqual(store.current().coverage.map((record) => record.requirement), [{ local_ref: "t1" }])
})

test("v2 retries a candidate with an empty basis instead of dropping the user input", async () => {
  const store = new IntentStoreV2({ storeDir: mkdtempSync(join(tmpdir(), "intent-v2-")), runId: "run-1" })
  const seen: string[][] = []
  const compiler = createIntentCompilerV2({
    store,
    model: {
      propose: async (input): Promise<CompilerModelV2Result> => {
        seen.push([...(input.validation_errors ?? [])])
        const candidate = seen.length === 1
          ? { schema_version: 2, basis: { event_ids: [], refs: [] }, groups: [] } as Candidate
          : createTaskCandidate("e1", "fix CSV preview")
        return { ok: true, candidate, call: { text: "{}", text_source: "text" } }
      },
    },
  })
  await compiler.acceptEvent(event("run-1", "e1", "fix CSV preview"))
  const result = await compiler.advance({ runId: "run-1" })

  assert.equal(result.ok, true, result.message ?? "")
  assert.equal(result.disposition, "dispatched")
  assert.equal(seen[0]?.length, 0)
  assert.match(seen[1]?.[0] ?? "", /candidate basis is empty, which claims this batch has nothing to act on, but this batch carries the user delegation/)
  assert.match(seen[1]?.[0] ?? "", /pending event ids for this batch: e1/)
  assert.match(seen[1]?.[1] ?? "", /this batch carries user input but no group names a task/)
  assert.equal(store.current().budget.management_requests, 2)
})

test("v2 re-sends a management call that failed at the transport level", async () => {
  const store = new IntentStoreV2({ storeDir: mkdtempSync(join(tmpdir(), "intent-v2-")), runId: "run-1" })
  const seen: Array<string[] | undefined> = []
  const compiler = createIntentCompilerV2({
    store,
    model: {
      propose: async (input): Promise<CompilerModelV2Result> => {
        seen.push(input.validation_errors === undefined ? undefined : [...input.validation_errors])
        if (seen.length === 1) {
          return { ok: false, error: { code: "transport", message: "structured provider request failed: The operation timed out." } }
        }
        return { ok: true, candidate: createTaskCandidate("e1", "fix CSV preview"), call: { text: "{}", text_source: "text" } }
      },
    },
  })
  await compiler.acceptEvent(event("run-1", "e1", "fix CSV preview"))
  const result = await compiler.advance({ runId: "run-1" })

  assert.equal(result.ok, true, result.message ?? "")
  assert.equal(result.disposition, "dispatched")
  assert.equal(seen.length, 2)
  assert.equal(seen[1], undefined, "a transport retry re-sends the same request without revision reasons")
  assert.equal(store.current().management_log[0]?.status, "accepted")
  assert.equal(store.current().management_log[0]?.retry, true)
  assert.equal(store.current().budget.management_requests, 2)
})

test("v2 does not re-send a provider rejection of the request itself", async () => {
  const store = new IntentStoreV2({ storeDir: mkdtempSync(join(tmpdir(), "intent-v2-")), runId: "run-1" })
  let calls = 0
  const compiler = createIntentCompilerV2({
    store,
    model: {
      propose: async (): Promise<CompilerModelV2Result> => {
        calls += 1
        return { ok: false, error: { code: "transport", message: "structured provider returned HTTP 400: response_format json_schema is unavailable" } }
      },
    },
  })
  await compiler.acceptEvent(event("run-1", "e1", "fix CSV preview"))
  const result = await compiler.advance({ runId: "run-1" })

  assert.equal(result.ok, false)
  assert.equal(calls, 1)
  assert.equal(store.current().management_log[0]?.status, "transport_failed")
})

test("v2 applies a group's task create before the changes that reference it", async () => {
  const store = new IntentStoreV2({ storeDir: mkdtempSync(join(tmpdir(), "intent-v2-")), runId: "run-1" })
  const candidate = createTaskCandidate("e1", "fix CSV preview")
  const group = candidate.groups[0] as Candidate["groups"][number]
  const taskCreate = group.ir_changes[0] as Candidate["groups"][number]["ir_changes"][number]
  const outputCreate = {
    action: "create" as const,
    target: "output" as const,
    local_ref: "o1",
    value: { description: "patched file", format: "artifact" as const },
    sources: [SOURCE],
  }
  group.ir_changes = [outputCreate, taskCreate]
  const compiler = createIntentCompilerV2({
    store,
    model: createCompilerModelV2(async () => JSON.stringify(candidate)),
  })
  await compiler.acceptEvent(event("run-1", "e1", "fix CSV preview"))
  const result = await compiler.advance({ runId: "run-1" })

  assert.equal(result.ok, true, result.message ?? "")
  assert.equal(result.disposition, "dispatched")
  const view = await compiler.inspect({ runId: "run-1" })
  assert.deepEqual(view.current_ir["t-fix"]?.outputs.map((output) => output.output_id), ["o1"])
})

test("v2 retries a group whose task create id disagrees with task_refs", async () => {
  const store = new IntentStoreV2({ storeDir: mkdtempSync(join(tmpdir(), "intent-v2-")), runId: "run-1" })
  const seen: string[][] = []
  const compiler = createIntentCompilerV2({
    store,
    model: {
      propose: async (input): Promise<CompilerModelV2Result> => {
        seen.push([...(input.validation_errors ?? [])])
        const candidate = createTaskCandidate("e1", "fix CSV preview")
        if (seen.length === 1) {
          const group = candidate.groups[0] as Candidate["groups"][number]
          group.ir_changes[0] = { ...group.ir_changes[0], local_ref: "b1" } as Candidate["groups"][number]["ir_changes"][number]
        }
        return { ok: true, candidate, call: { text: "{}", text_source: "text" } }
      },
    },
  })
  await compiler.acceptEvent(event("run-1", "e1", "fix CSV preview"))
  const result = await compiler.advance({ runId: "run-1" })

  assert.equal(result.ok, true, result.message ?? "")
  assert.equal(seen.length, 2)
  assert.match(seen[1]?.[0] ?? "", /task_refs names unknown task t-fix/)
  assert.match(seen[1]?.[0] ?? "", /a create task's local_ref is the task_id/)
})

test("v2 retries a draft that names a task the group does not declare", async () => {
  const store = new IntentStoreV2({ storeDir: mkdtempSync(join(tmpdir(), "intent-v2-")), runId: "run-1" })
  const seen: string[][] = []
  const compiler = createIntentCompilerV2({
    store,
    model: {
      propose: async (input): Promise<CompilerModelV2Result> => {
        seen.push([...(input.validation_errors ?? [])])
        const candidate = createTaskCandidate("e1", "fix CSV preview")
        if (seen.length === 1) {
          const group = candidate.groups[0] as Candidate["groups"][number]
          const compilation = group.compilation as { decision: "replace"; drafts: Array<{ task_id: string }> }
          compilation.drafts[0] = { ...compilation.drafts[0], task_id: "t-other" }
        }
        return { ok: true, candidate, call: { text: "{}", text_source: "text" } }
      },
    },
  })
  await compiler.acceptEvent(event("run-1", "e1", "fix CSV preview"))
  const result = await compiler.advance({ runId: "run-1" })

  assert.equal(result.ok, true, result.message ?? "")
  assert.match(seen[1]?.[0] ?? "", /compilation\.drafts names unknown task t-other/)
  assert.equal(seen.length, 2)
})

test("v2 retries a replacement atom whose previous_atom_ref cannot be resolved", async () => {
  const store = new IntentStoreV2({ storeDir: mkdtempSync(join(tmpdir(), "intent-v2-")), runId: "run-1" })
  const seen: string[][] = []
  const compiler = createIntentCompilerV2({
    store,
    model: {
      propose: async (input): Promise<CompilerModelV2Result> => {
        seen.push([...(input.validation_errors ?? [])])
        const candidate = createTaskCandidate("e1", "fix CSV preview")
        if (seen.length === 1) {
          const group = candidate.groups[0] as Candidate["groups"][number]
          const compilation = group.compilation as unknown as { decision: "replace"; drafts: Array<{ atoms: Array<Record<string, unknown>> }> }
          compilation.drafts[0].atoms[0].previous_atom_ref = {
            id: "a-missing",
            revision: 0,
            digest: "sha256:2222222222222222222222222222222222222222222222222222222222222222",
          }
        }
        return { ok: true, candidate, call: { text: "{}", text_source: "text" } }
      },
    },
  })
  await compiler.acceptEvent(event("run-1", "e1", "fix CSV preview"))
  const result = await compiler.advance({ runId: "run-1" })

  assert.equal(result.ok, true, result.message ?? "")
  assert.match(seen[1]?.[0] ?? "", /previous_atom_ref references unknown atom a-missing/)
  assert.equal(seen.length, 2)
})

test("v2 rejects a user-input batch that records no destination for the delegation", async () => {
  const store = new IntentStoreV2({ storeDir: mkdtempSync(join(tmpdir(), "intent-v2-")), runId: "run-1" })
  const seen: string[][] = []
  const compiler = createIntentCompilerV2({
    store,
    model: {
      propose: async (input): Promise<CompilerModelV2Result> => {
        seen.push([...(input.validation_errors ?? [])])
        if (input.events[0]?.event_id === "e2") {
          return {
            ok: true,
            candidate: {
              schema_version: 2,
              basis: { event_ids: ["e2"], refs: [] },
              groups: [{
                local_ref: "g2",
                task_refs: ["t-fix"],
                depends_on: [],
                ir_changes: [{ action: "preserve", reason: "nothing to do", sources: [SOURCE] }],
                compilation: { decision: "reuse", current: [], reason: "nothing to compile" },
                execution_decisions: [],
                assessments: [],
                coverage: [],
                checks: [],
                questions: [],
              }],
            },
            call: { text: "{}", text_source: "text" },
          }
        }
        const candidate = createTaskCandidate("e1", "fix CSV preview")
        return { ok: true, candidate, call: { text: "{}", text_source: "text" } }
      },
    },
  })
  await compiler.acceptEvent(event("run-1", "e1", "fix CSV preview"))
  const first = await compiler.advance({ runId: "run-1" })
  assert.equal(first.ok, true, first.message ?? "")
  await compiler.acceptEvent(event("run-1", "e2", "carry on"))
  const result = await compiler.advance({ runId: "run-1" })

  assert.equal(result.ok, false)
  assert.equal(result.code, "invalid_candidate")
  assert.match(seen.at(-1)?.[0] ?? "", /carries user input for t-fix but records no destination/)
  const view = await compiler.inspect({ runId: "run-1" })
  assert.deepEqual(view.pending_event_ids, ["e2"])
})

test("v2 rejects the no-op candidate shape observed in the real runs", async () => {
  const store = new IntentStoreV2({ storeDir: mkdtempSync(join(tmpdir(), "intent-v2-")), runId: "run-1" })
  const seen: string[][] = []
  const compiler = createIntentCompilerV2({
    store,
    model: {
      propose: async (input): Promise<CompilerModelV2Result> => {
        seen.push([...(input.validation_errors ?? [])])
        return {
          ok: true,
          candidate: {
            schema_version: 2,
            basis: { event_ids: [], refs: [] },
            groups: [{
              local_ref: "g1",
              task_refs: [],
              depends_on: [],
              ir_changes: [],
              compilation: {
                decision: "reuse",
                current: [],
                reason: "No executable work is permitted: required spec material /app/docs/spec_v1.md is missing, so no atom can be started.",
              },
              execution_decisions: [],
              assessments: [],
              coverage: [],
              checks: [],
              questions: [],
            }],
          },
          call: { text: "{}", text_source: "text" },
        }
      },
    },
  })
  await compiler.acceptEvent(event("run-1", "e1", "implement repro-verify"))
  const result = await compiler.advance({ runId: "run-1" })

  assert.equal(result.ok, false)
  assert.equal(result.code, "invalid_candidate")
  assert.match(seen.at(-1)?.[0] ?? "", /candidate basis is empty, which claims this batch has nothing to act on/)
  assert.match(seen.at(-1)?.[1] ?? "", /carries user input but no group names a task/)
  const view = await compiler.inspect({ runId: "run-1" })
  assert.deepEqual(view.pending_event_ids, ["e1"])
  assert.deepEqual(view.coverage, [])
})

test("v2 hands the model host material facts without file content", async () => {
  const store = new IntentStoreV2({ storeDir: mkdtempSync(join(tmpdir(), "intent-v2-")), runId: "run-1" })
  const seen: Array<{ operations: string[]; root?: string; material: unknown }> = []
  const compiler = createIntentCompilerV2({
    store,
    model: {
      propose: async (input): Promise<CompilerModelV2Result> => {
        seen.push({
          operations: [...(input.capabilities?.operations ?? [])],
          root: input.capabilities?.workspace_root,
          material: input.capabilities?.material ?? [],
        })
        return { ok: true, candidate: createTaskCandidate("e1", "fix CSV preview"), call: { text: "{}", text_source: "text" } }
      },
    },
    capabilities: {
      operations: ["read", "edit", "bash"],
      workspace_root: "/app",
      describeMaterial: (paths) => paths.map((path) => ({ path, exists: path === "/app/docs/spec_v1.md", readable_by_executor: path === "/app/docs/spec_v1.md" })),
    },
  })
  await compiler.acceptEvent(event("run-1", "e1", "follow /app/docs/spec_v1.md and ignore /app/docs/spec_v9.md"))
  await compiler.advance({ runId: "run-1" })

  assert.deepEqual(seen[0]?.operations, ["read", "edit", "bash"])
  assert.equal(seen[0]?.root, "/app")
  assert.deepEqual(seen[0]?.material, [
    { path: "/app/docs/spec_v1.md", exists: true, readable_by_executor: true },
    { path: "/app/docs/spec_v9.md", exists: false, readable_by_executor: false },
  ])
})

test("v2 reports an empty material list when the batch names no path", async () => {
  const store = new IntentStoreV2({ storeDir: mkdtempSync(join(tmpdir(), "intent-v2-")), runId: "run-1" })
  let material: unknown
  let operations: string[] = []
  const compiler = createIntentCompilerV2({
    store,
    model: {
      propose: async (input): Promise<CompilerModelV2Result> => {
        material = input.capabilities?.material
        operations = [...(input.capabilities?.operations ?? [])]
        return { ok: true, candidate: createTaskCandidate("e1", "fix CSV preview"), call: { text: "{}", text_source: "text" } }
      },
    },
    capabilities: {
      operations: ["read"],
      describeMaterial: (paths) => paths.map((path) => ({ path, exists: true, readable_by_executor: true })),
    },
  })
  await compiler.acceptEvent(event("run-1", "e1", "fix the CSV export"))
  await compiler.advance({ runId: "run-1" })

  assert.deepEqual(material, [], "no named path means no material probe, not a probe of everything")
  assert.deepEqual(operations, ["read"])
})

test("v2 works without a capability source", async () => {
  const store = new IntentStoreV2({ storeDir: mkdtempSync(join(tmpdir(), "intent-v2-")), runId: "run-1" })
  let catalog: unknown
  const compiler = createIntentCompilerV2({
    store,
    model: {
      propose: async (input): Promise<CompilerModelV2Result> => {
        catalog = input.capabilities
        return { ok: true, candidate: createTaskCandidate("e1", "fix CSV preview"), call: { text: "{}", text_source: "text" } }
      },
    },
  })
  await compiler.acceptEvent(event("run-1", "e1", "fix the CSV export"))
  const result = await compiler.advance({ runId: "run-1" })

  assert.equal(result.ok, true, result.message ?? "")
  assert.deepEqual(catalog, { operations: [], material: [] })
})

test("v2 accepts without an independent check when no checker is configured", async () => {
  const store = new IntentStoreV2({ storeDir: mkdtempSync(join(tmpdir(), "intent-v2-")), runId: "run-1" })
  const compiler = createIntentCompilerV2({
    store,
    model: createCompilerModelV2(async () => JSON.stringify(createTaskCandidate("e1", "fix CSV preview"))),
  })
  await compiler.acceptEvent(event("run-1", "e1", "fix CSV preview"))
  const result = await compiler.advance({ runId: "run-1" })

  assert.equal(result.ok, true, result.message ?? "")
  assert.equal(result.disposition, "dispatched")
  assert.deepEqual(store.current().semantic_checks, [])
})

test("v2 checks a user pause even when it compiles no new atom", async () => {
  const store = new IntentStoreV2({ storeDir: mkdtempSync(join(tmpdir(), "intent-v2-")), runId: "run-1" })
  let checked = 0
  const compiler = createIntentCompilerV2({
    store,
    model: {
      propose: async (): Promise<CompilerModelV2Result> => ({
        ok: true,
        candidate: {
          schema_version: 2,
          basis: { event_ids: ["e1"], refs: [] },
          groups: [{
            local_ref: "g1",
            task_refs: ["t-fix"],
            depends_on: [],
            ir_changes: [{
              action: "create",
              target: "task",
              local_ref: "t-fix",
              value: { goal: { text: "fix CSV preview" }, current_scope: { text: "paused", disposition: "paused" } },
              sources: [SOURCE],
            }],
            compilation: { decision: "reuse", current: [], reason: "paused before compiling" },
            execution_decisions: [],
            assessments: [],
            coverage: [{ requirement: { local_ref: "t-fix" }, disposition: "paused", refs: [], explanation: "user paused it" }],
            checks: [],
            questions: [],
          }],
        },
        call: { text: "{}", text_source: "text" },
      }),
      verify: async () => {
        checked += 1
        return { verdict: { verdict: "consistent", findings: [] } }
      },
    },
  })
  await compiler.acceptEvent(event("run-1", "e1", "pause the CSV work"))
  const result = await compiler.advance({ runId: "run-1" })

  assert.equal(result.ok, true, result.message ?? "")
  assert.equal(checked, 1, "the approved update-batch scope checks user intent changes even with reuse")
})

test("v2 records a consistent check and accepts the batch", async () => {
  const store = new IntentStoreV2({ storeDir: mkdtempSync(join(tmpdir(), "intent-v2-")), runId: "run-1" })
  const checked: string[] = []
  const compiler = createIntentCompilerV2({
    store,
    model: {
      propose: async (): Promise<CompilerModelV2Result> => ({ ok: true, candidate: createTaskCandidate("e1", "fix CSV preview"), call: { text: "{}", text_source: "text" } }),
      verify: async (input) => {
        checked.push(input.candidate.groups[0]?.local_ref ?? "")
        return { verdict: { verdict: "consistent", findings: [] }, call: { text: "{}", text_source: "text", provider: "test", model: "checker" } }
      },
    },
  })
  await compiler.acceptEvent(event("run-1", "e1", "fix CSV preview"))
  const result = await compiler.advance({ runId: "run-1" })

  assert.equal(result.ok, true, result.message ?? "")
  assert.equal(result.disposition, "dispatched")
  assert.deepEqual(checked, ["g1"])
  const checks = store.current().semantic_checks
  assert.equal(checks.length, 1)
  assert.equal(checks[0]?.verdict, "consistent")
  assert.deepEqual(checks[0]?.task_ids, ["t-fix"])
  assert.deepEqual(checks[0]?.basis_event_ids, ["e1"])
})

test("v2 fails the whole batch when the check reports an inconsistency", async () => {
  const store = new IntentStoreV2({ storeDir: mkdtempSync(join(tmpdir(), "intent-v2-")), runId: "run-1" })
  let proposeCalls = 0
  let checkCalls = 0
  const compiler = createIntentCompilerV2({
    store,
    model: {
      propose: async (): Promise<CompilerModelV2Result> => {
        proposeCalls += 1
        return { ok: true, candidate: createTaskCandidate("e1", "fix CSV preview"), call: { text: "{}", text_source: "text" } }
      },
      verify: async () => {
        checkCalls += 1
        return {
          verdict: {
            verdict: "inconsistent",
            findings: [{
              dimension: "D2",
              claim: "the atom only prepares later work",
              expected: "the delegation is delivered",
              observed: "coverage names a preparation step",
              refs: [{ source_id: "e1", digest: "sha256:guessed-by-the-checker", span: { unit: "utf16" as const, start: 0, end: 4 } }],
            }],
          },
        }
      },
    },
  })
  await compiler.acceptEvent(event("run-1", "e1", "fix CSV preview"))
  const result = await compiler.advance({ runId: "run-1" })

  assert.equal(result.ok, false)
  assert.equal(result.code, "semantic_unresolved")
  assert.match(result.message ?? "", /independent check D2: the atom only prepares later work/)
  assert.equal(store.current().dispatches.length, 0, "unchecked work must not reach the executor")
  assert.equal(store.current().semantic_checks[0]?.verdict, "inconsistent")
  // Budget boundary: propose + check is two requests; a revision that could not
  // be checked again is not proposed, so the batch stops inside the budget.
  assert.equal(proposeCalls, 1)
  assert.equal(checkCalls, 1)
  assert.ok(store.current().budget.management_requests <= store.current().budget.max_management_requests)
  const view = await compiler.inspect({ runId: "run-1" })
  assert.deepEqual(view.pending_event_ids, ["e1"])
})

test("v2 fails the batch when the checker cannot run", async () => {
  const store = new IntentStoreV2({ storeDir: mkdtempSync(join(tmpdir(), "intent-v2-")), runId: "run-1" })
  const compiler = createIntentCompilerV2({
    store,
    model: {
      propose: async (): Promise<CompilerModelV2Result> => ({ ok: true, candidate: createTaskCandidate("e1", "fix CSV preview"), call: { text: "{}", text_source: "text" } }),
      verify: async () => {
        throw new Error("checker transport down")
      },
    },
  })
  await compiler.acceptEvent(event("run-1", "e1", "fix CSV preview"))
  const result = await compiler.advance({ runId: "run-1" })

  assert.equal(result.ok, false)
  assert.equal(result.code, "check_unavailable")
  assert.equal(result.retryable, true)
  assert.match(result.message ?? "", /independent check failed: checker transport down/)
  assert.equal(store.current().dispatches.length, 0)
  assert.equal(store.current().semantic_checks[0]?.verdict, "unavailable")
  assert.equal(store.current().management_log[0]?.status, "transport_failed")
  assert.equal(store.current().management_log[0]?.error_code, "check_unavailable")
})

test("v2 treats a verdict-less check answer as a failure, not a pass", async () => {
  const store = new IntentStoreV2({ storeDir: mkdtempSync(join(tmpdir(), "intent-v2-")), runId: "run-1" })
  const compiler = createIntentCompilerV2({
    store,
    model: {
      propose: async (): Promise<CompilerModelV2Result> => ({ ok: true, candidate: createTaskCandidate("e1", "fix CSV preview"), call: { text: "{}", text_source: "text" } }),
      verify: async () => ({ error: { code: "schema", message: "findings must be an array" } }),
    },
  })
  await compiler.acceptEvent(event("run-1", "e1", "fix CSV preview"))
  const result = await compiler.advance({ runId: "run-1" })

  assert.equal(result.ok, false)
  assert.equal(result.code, "check_unavailable")
  assert.equal(result.retryable, false)
  assert.match(result.message ?? "", /returned no verdict: findings must be an array/)
  assert.equal(store.current().dispatches.length, 0)
  assert.equal(store.current().semantic_checks[0]?.verdict, "unavailable")
})

test("v2 spends one revision round on an inconsistency when the budget allows it", async () => {
  const store = new IntentStoreV2({ storeDir: mkdtempSync(join(tmpdir(), "intent-v2-")), runId: "run-1" })
  store.applyDeltas({ max_management_requests: 5 })
  const seen: string[][] = []
  let checkCalls = 0
  const compiler = createIntentCompilerV2({
    store,
    model: {
      propose: async (input): Promise<CompilerModelV2Result> => {
        seen.push([...(input.validation_errors ?? [])])
        return { ok: true, candidate: createTaskCandidate("e1", "fix CSV preview"), call: { text: "{}", text_source: "text" } }
      },
      verify: async () => {
        checkCalls += 1
        return checkCalls === 1
          ? {
              verdict: {
                verdict: "inconsistent",
                findings: [{
                  dimension: "D4",
                  claim: "coverage names the wrong atom",
                  expected: "coverage names the delivering atom",
                  observed: "coverage names a-previous",
                  refs: [{ source_id: "e1", digest: "sha256:guessed-by-the-checker", span: { unit: "utf16" as const, start: 0, end: 3 } }],
                }],
              },
            }
          : { verdict: { verdict: "consistent", findings: [] } }
      },
    },
  })
  await compiler.acceptEvent(event("run-1", "e1", "fix CSV preview"))
  const result = await compiler.advance({ runId: "run-1" })

  assert.equal(result.ok, true, result.message ?? "")
  assert.equal(result.disposition, "dispatched")
  assert.equal(checkCalls, 2)
  assert.equal(seen.length, 2)
  assert.match(seen[1]?.[0] ?? "", /independent check D4: coverage names the wrong atom/)
  assert.equal(store.current().semantic_checks.length, 2)
  assert.ok(store.current().budget.management_requests <= 5)
})

test("a check finding that cites nothing is recorded but does not block the batch", async () => {
  const store = new IntentStoreV2({ storeDir: mkdtempSync(join(tmpdir(), "intent-v2-")), runId: "run-1" })
  let checkCalls = 0
  const compiler = createIntentCompilerV2({
    store,
    model: {
      propose: async (): Promise<CompilerModelV2Result> => ({
        ok: true,
        candidate: createTaskCandidate("e1", "fix CSV preview"),
        call: { text: "{}", text_source: "text" },
      }),
      verify: async () => {
        checkCalls += 1
        return {
          verdict: {
            verdict: "inconsistent",
            // The r10 shape: an objection about convention, citing a source id
            // that this batch never contained.
            findings: [{
              dimension: "D6",
              claim: "the candidate adds a second deliverable",
              expected: "one deliverable",
              observed: "two outputs",
              refs: [{ source_id: "s-not-in-this-batch", digest: "sha256:0000000000000000000000000000000000000000000000000000000000000001" }],
            }],
          },
        }
      },
    },
  })
  await compiler.acceptEvent(event("run-1", "e1", "fix CSV preview"))
  const result = await compiler.advance({ runId: "run-1" })

  assert.equal(result.ok, true, result.message ?? "")
  assert.equal(result.disposition, "dispatched")
  // One check was enough: nothing it found could be cited, so nothing was revised.
  assert.equal(checkCalls, 1)
  const check = store.current().semantic_checks[0]
  assert.equal(check?.verdict, "inconsistent", "the verdict is kept as the checker gave it")
  assert.equal(check?.findings[0]?.evidence_resolved, false)
  assert.equal(check?.findings[0]?.dimension, "D6")
})

test("v2 gives every accepted compilation its own identity, distinct from the draft label", async () => {
  const dir = mkdtempSync(join(tmpdir(), "intent-v2-"))
  const store = new IntentStoreV2({ storeDir: dir, runId: "run-1" })
  const compiler = createIntentCompilerV2({
    store,
    model: createCompilerModelV2(async (input) => {
      const id = input.events[0]?.event_id ?? ""
      return JSON.stringify(id === "e1" ? createTaskCandidate("e1", "fix CSV preview") : replaceCompiledCandidate(id, "a-second"))
    }),
  })
  await compiler.acceptEvent(event("run-1", "e1", "fix CSV preview"))
  await compiler.advance({ runId: "run-1" })
  const first = store.current().compiled["t-fix"]?.compiled_intent_id
  assert.equal(first, "compiled-1")
  assert.notEqual(first, "ci-1", "a generated identity never reuses the draft-local label")

  await compiler.acceptEvent(event("run-1", "e2", "also deliver a second file"))
  await compiler.advance({ runId: "run-1" })
  const second = store.current().compiled["t-fix"]?.compiled_intent_id
  assert.equal(second, "compiled-2")
  assert.notEqual(second, first, "each accepted compilation is a new identity")
  assert.equal(store.current().compiled["t-fix"]?.compiled_revision, 1)

  // The dispatch names the artifact it came from, so an execution can be traced
  // back to the exact compiled intent that authorised it.
  const dispatch = store.current().dispatches.find((record) => record.atom_id === "a-second")
  assert.equal(dispatch?.compiled_intent_id, second)
  // A carried atom that was never started is offered again by the new artifact,
  // but dispatch is idempotent per atom content: the host keeps the first
  // dispatch id instead of accumulating one offer per compilation.
  assert.equal(store.current().dispatches.filter((record) => record.atom_id === "a-preview").length, 1)
  const reoffered = store.current().dispatches.find((record) => record.atom_id === "a-preview")
  assert.equal(reoffered?.compiled_intent_id, first, "the dispatch keeps the artifact that first offered this content")
})

test("v2 keeps issuing new compilation identities after the store is reopened", async () => {
  const dir = mkdtempSync(join(tmpdir(), "intent-v2-"))
  const store = new IntentStoreV2({ storeDir: dir, runId: "run-1" })
  let compiler = createIntentCompilerV2({
    store,
    model: createCompilerModelV2(async (input) => JSON.stringify(
      (input.events[0]?.event_id ?? "") === "e1" ? createTaskCandidate("e1", "fix CSV preview") : replaceCompiledCandidate("e2", "a-second"),
    )),
  })
  await compiler.acceptEvent(event("run-1", "e1", "fix CSV preview"))
  await compiler.advance({ runId: "run-1" })
  assert.equal(store.current().compiled["t-fix"]?.compiled_intent_id, "compiled-1")

  const reopened = new IntentStoreV2({ storeDir: dir, runId: "run-1" })
  compiler = createIntentCompilerV2({
    store: reopened,
    model: createCompilerModelV2(async () => JSON.stringify(replaceCompiledCandidate("e2", "a-third"))),
  })
  await compiler.acceptEvent(event("run-1", "e2", "deliver a third thing"))
  await compiler.advance({ runId: "run-1" })

  assert.equal(reopened.current().compiled["t-fix"]?.compiled_intent_id, "compiled-2", "the sequence is persisted, not restarted")
})

test("v2 counts the independent check in the batch request and token budget", async () => {
  const store = new IntentStoreV2({ storeDir: mkdtempSync(join(tmpdir(), "intent-v2-")), runId: "run-1" })
  const compiler = createIntentCompilerV2({
    store,
    model: {
      propose: async (): Promise<CompilerModelV2Result> => ({
        ok: true,
        candidate: createTaskCandidate("e1", "fix CSV preview"),
        call: { text: "{}", text_source: "text", usage: { input_tokens: 100, output_tokens: 20 } },
      }),
      verify: async () => ({
        verdict: { verdict: "consistent", findings: [] },
        call: { text: "{\"verdict\":\"consistent\"}", text_source: "text", usage: { input_tokens: 7, output_tokens: 3 } },
      }),
    },
  })
  await compiler.acceptEvent(event("run-1", "e1", "fix CSV preview"))
  const result = await compiler.advance({ runId: "run-1" })

  assert.equal(result.ok, true, result.message ?? "")
  assert.equal(store.current().budget.management_requests, 2, "the check is a management request")
  assert.equal(store.current().budget.management_input_tokens, 107)
  assert.equal(store.current().budget.management_output_tokens, 23)
  const check = store.current().semantic_checks[0]
  assert.equal(check?.response_digest?.startsWith("sha256:"), true, "the checker's answer stays auditable")
  assert.deepEqual(check?.usage, { input_tokens: 7, output_tokens: 3 })
})

test("v2 reports the batch token total as unavailable when a call does not report usage", async () => {
  const store = new IntentStoreV2({ storeDir: mkdtempSync(join(tmpdir(), "intent-v2-")), runId: "run-1" })
  const compiler = createIntentCompilerV2({
    store,
    model: {
      propose: async (): Promise<CompilerModelV2Result> => ({
        ok: true,
        candidate: createTaskCandidate("e1", "fix CSV preview"),
        call: { text: "{}", text_source: "text", usage: { input_tokens: 100 } },
      }),
      verify: async () => ({ verdict: { verdict: "consistent", findings: [] }, call: { text: "{}", text_source: "text" } }),
    },
  })
  await compiler.acceptEvent(event("run-1", "e1", "fix CSV preview"))
  await compiler.advance({ runId: "run-1" })

  assert.equal(store.current().budget.management_input_tokens, "unavailable", "a partial total must not understate cost")
  assert.equal(store.current().budget.management_output_tokens, "unavailable")
})

test("v2 evaluates capability_available conditions against the host catalog", async () => {
  async function authorizeBuild(operations: string[] | undefined): Promise<{ ok: boolean; code?: string }> {
    const store = new IntentStoreV2({ storeDir: mkdtempSync(join(tmpdir(), "intent-v2-")), runId: "run-1" })
    const candidate = createTaskCandidate("e1", "build the preview")
    const atom = (candidate.groups[0] as Candidate["groups"][number]).compilation as unknown as { drafts: Array<{ atoms: Array<Record<string, unknown>> }> }
    atom.drafts[0].atoms[0].optional_tools = ["bash"]
    atom.drafts[0].atoms[0].authority = {
      basis: [SOURCE],
      rules: [{
        operation_id: "bash",
        resource_ref: SOURCE,
        input_refs: [],
        output_refs: [],
        conditions: [{ kind: "capability_available", refs: [], expectation: "bash" }],
        allowed_use: "build the preview",
      }],
      lifetime: "this_execution",
      delegation: "not_supported",
    }
    const compiler = createIntentCompilerV2({
      store,
      model: createCompilerModelV2(async () => JSON.stringify(candidate)),
      ...(operations === undefined ? {} : { capabilities: { operations } }),
    })
    await compiler.acceptEvent(event("run-1", "e1", "build the preview"))
    const advanced = await compiler.advance({ runId: "run-1" })
    const dispatchId = advanced.deliveries?.[0]?.dispatch_id
    assert.ok(dispatchId)
    const start = await compiler.authorize({ kind: "start", run_id: "run-1", dispatch_id: dispatchId, host_identity: "host-1" })
    assert.equal(start.ok, true)
    const op = await compiler.authorize({
      kind: "operation",
      run_id: "run-1",
      execution_id: start.execution_id as string,
      host_identity: "host-1",
      host_call_id: "call-1",
      operation_id: "bash",
      resource_ref: SOURCE,
      input_refs: [],
      output_refs: [],
    })
    return { ok: op.ok, ...(op.code === undefined ? {} : { code: op.code }) }
  }

  assert.deepEqual(await authorizeBuild(["read", "bash"]), { ok: true }, "the host declares bash, so the condition holds")
  assert.deepEqual(await authorizeBuild(["read"]), { ok: false, code: "execution_inactive" }, "a listed-missing capability is unsatisfied")
  assert.deepEqual(await authorizeBuild(undefined), { ok: false, code: "capability_unsupported" }, "no catalog means unsupported, never silently allowed")
})

test("v2 rejects an atom input whose ref is not a real reference instead of fabricating one", async () => {
  const store = new IntentStoreV2({ storeDir: mkdtempSync(join(tmpdir(), "intent-v2-")), runId: "run-1" })
  const seen: string[][] = []
  const compiler = createIntentCompilerV2({
    store,
    model: {
      propose: async (input): Promise<CompilerModelV2Result> => {
        seen.push([...(input.validation_errors ?? [])])
        const candidate = createTaskCandidate("e1", "fix CSV preview")
        const atom = (candidate.groups[0] as Candidate["groups"][number]).compilation as unknown as { drafts: Array<{ atoms: Array<Record<string, unknown>> }> }
        atom.drafts[0].atoms[0].inputs = [{ binding_id: "b-broken", ref: { source_id: "", digest: "" }, role: "task_data", use: "material" }]
        return { ok: true, candidate, call: { text: "{}", text_source: "text" } }
      },
    },
  })
  await compiler.acceptEvent(event("run-1", "e1", "fix CSV preview"))
  const result = await compiler.advance({ runId: "run-1" })

  assert.equal(result.ok, false)
  assert.match(seen[1]?.[0] ?? "", /input b-broken must carry a Ref or SourceRef/)
  assert.equal(store.current().dispatches.length, 0)
  const view = await compiler.inspect({ runId: "run-1" })
  assert.deepEqual(view.pending_event_ids, ["e1"])
})

test("v2 evaluates assessment_supports conditions against recorded assessments", async () => {
  /** Gate a second atom on the assessment of the first, then authorize it. */
  async function authorizeGatedAtom(conditionRef: (firstRef: Ref) => Record<string, unknown>): Promise<{ ok: boolean; code?: string }> {
    const store = new IntentStoreV2({ storeDir: mkdtempSync(join(tmpdir(), "intent-v2-")), runId: "run-1" })
    const compiler = createIntentCompilerV2({
      store,
      model: createCompilerModelV2(async (input) => {
          const id = input.events[0]?.event_id ?? ""
          if (id === "e1") return JSON.stringify(createTaskCandidate("e1", "build the first deliverable"))
          const first = store.current().compiled["t-fix"]?.atoms.find((atom) => atom.atom_id === "a-preview")
          assert.ok(first)
          if (id === "e2") {
            const target = atomRef(first)
            return JSON.stringify({
              schema_version: 2,
              basis: { event_ids: ["e2"], refs: [] },
              groups: [{
                local_ref: "g-assess",
                task_refs: ["t-fix"],
                depends_on: [],
                ir_changes: [],
                compilation: { decision: "reuse", current: [], reason: "assessment only" },
                execution_decisions: [],
                assessments: [{
                  target_ref: target,
                  criteria_refs: [],
                  evidence_refs: [],
                  result: "satisfied",
                  explanation: "the first deliverable was verified",
                  method: "deterministic",
                }],
                coverage: [{ requirement: { local_ref: "t-fix" }, disposition: "supported", refs: [], explanation: "assessment recorded" }],
                checks: [],
                questions: [],
              }],
            })
          }
          const gated = replaceCompiledCandidate("e3", "a-gated")
          const compilation = (gated.groups[0] as unknown as { compilation: { drafts: Array<{ atoms: Array<Record<string, unknown>> }> } }).compilation
          compilation.drafts[0].atoms[0].authority = {
            basis: [SOURCE],
            rules: [{
              operation_id: "bash",
              resource_ref: SOURCE,
              input_refs: [],
              output_refs: [],
              conditions: [conditionRef(atomRef(first))],
              allowed_use: "build the second deliverable",
            }],
            lifetime: "this_execution",
            delegation: "not_supported",
          }
          return JSON.stringify(gated)
      }),
    })
    await compiler.acceptEvent(event("run-1", "e1", "build the first deliverable"))
    const first = await compiler.advance({ runId: "run-1" })
    const dispatchId = first.deliveries?.[0]?.dispatch_id
    assert.ok(dispatchId)
    const start = await compiler.authorize({ kind: "start", run_id: "run-1", dispatch_id: dispatchId, host_identity: "host-1" })
    assert.equal(start.ok, true)
    await compiler.acceptEvent(event("run-1", "e2", "the first deliverable was verified"))
    await compiler.advance({ runId: "run-1" })
    assert.equal(store.current().assessments.length, 1)

    await compiler.acceptEvent(event("run-1", "e3", "build the second deliverable"))
    const third = await compiler.advance({ runId: "run-1" })
    const gatedDispatch = third.deliveries?.find((delivery) => delivery.atom_id === "a-gated")?.dispatch_id
    assert.ok(gatedDispatch)
    const gatedStart = await compiler.authorize({ kind: "start", run_id: "run-1", dispatch_id: gatedDispatch, host_identity: "host-2" })
    assert.equal(gatedStart.ok, true)
    const op = await compiler.authorize({
      kind: "operation",
      run_id: "run-1",
      execution_id: gatedStart.execution_id as string,
      host_identity: "host-2",
      host_call_id: "call-1",
      operation_id: "bash",
      resource_ref: SOURCE,
      input_refs: [],
      output_refs: [],
    })
    return { ok: op.ok, ...(op.code === undefined ? {} : { code: op.code }) }
  }

  // A matching satisfied assessment lets the guarded operation through.
  assert.deepEqual(
    await authorizeGatedAtom((firstRef) => ({ kind: "assessment_supports", refs: [firstRef] })),
    { ok: true },
  )
  // An assessment recorded for a different atom does not.
  assert.deepEqual(
    await authorizeGatedAtom((firstRef) => ({ kind: "assessment_supports", refs: [{ ...firstRef, id: "a-other" }] })),
    { ok: false, code: "execution_inactive" },
  )
  // A condition with no Ref at all cannot be evaluated and must not pass.
  assert.deepEqual(
    await authorizeGatedAtom(() => ({ kind: "assessment_supports", refs: [SOURCE] })),
    { ok: false, code: "capability_unsupported" },
  )
})

/** A candidate whose first atom declares one deliverable and one material. */
function declaringCandidate(
  eventId: string,
  output: { output_id: string; description: string; format: string },
  binding: { binding_id: string; ref: Ref | SourceRef; role: string; use: string },
): Candidate {
  const candidate = createTaskCandidate(eventId, "deliver the patch")
  const compilation = (candidate.groups[0] as unknown as { compilation: { drafts: Array<{ atoms: Array<Record<string, unknown>> }> } }).compilation
  compilation.drafts[0].atoms[0].outputs = [output]
  compilation.drafts[0].atoms[0].inputs = [{ ...binding, role: binding.role }]
  return candidate
}

/** A recompile of the same task that re-declares the same deliverable/material. */
function redeclaringCandidate(
  eventId: string,
  output: { output_id: string; description: string; format: string },
  binding: { binding_id: string; ref: Ref | SourceRef; role: string; use: string },
): Candidate {
  const candidate = replaceCompiledCandidate(eventId, "a-second")
  const compilation = (candidate.groups[0] as unknown as { compilation: { drafts: Array<{ atoms: Array<Record<string, unknown>> }> } }).compilation
  compilation.drafts[0].atoms[0].outputs = [output]
  compilation.drafts[0].atoms[0].inputs = [{ ...binding, role: binding.role }]
  return candidate
}

test("v2 registers the deliverable and material an atom declares", async () => {
  const store = new IntentStoreV2({ storeDir: mkdtempSync(join(tmpdir(), "intent-v2-")), runId: "run-1" })
  const compiler = createIntentCompilerV2({
    store,
    model: createCompilerModelV2(async () => JSON.stringify(declaringCandidate(
      "e1",
      { output_id: "o-patch", description: "the patched export", format: "artifact" },
      { binding_id: "b-spec", ref: SOURCE, role: "task_data", use: "the export spec" },
    ))),
  })
  await compiler.acceptEvent(event("run-1", "e1", "deliver the patch"))
  const result = await compiler.advance({ runId: "run-1" })

  assert.equal(result.ok, true, result.message ?? "")
  const view = await compiler.inspect({ runId: "run-1" })
  const task = view.current_ir["t-fix"]
  assert.deepEqual(task?.outputs.map((output) => output.output_id), ["o-patch"])
  assert.equal(task?.outputs[0]?.description, "the patched export")
  assert.deepEqual(task?.bindings.map((entry) => entry.binding_id), ["b-spec"])
  assert.equal(task?.revision, 0, "registering a declaration is not a task revision")

  // The registered material reaches the executor as a resolvable reference.
  const executionTask = result.deliveries?.[0]?.execution_task
  assert.deepEqual(executionTask?.inputs, [{ id: "b-spec", ref: SOURCE, role: "task_data", description: "the export spec" }])
  assert.deepEqual(executionTask?.outputs.map((output) => output.id), ["o-patch"])
})

test("v2 accepts an atom that restates a registered deliverable and material identically", async () => {
  const store = new IntentStoreV2({ storeDir: mkdtempSync(join(tmpdir(), "intent-v2-")), runId: "run-1" })
  const output = { output_id: "o-patch", description: "the patched export", format: "artifact" }
  const binding = { binding_id: "b-spec", ref: SOURCE, role: "task_data", use: "the export spec" }
  const compiler = createIntentCompilerV2({
    store,
    model: createCompilerModelV2(async (input) => JSON.stringify(
      (input.events[0]?.event_id ?? "") === "e1"
        ? declaringCandidate("e1", output, binding)
        : redeclaringCandidate("e2", output, { ...binding, use: "the same spec, read again" }),
    )),
  })
  await compiler.acceptEvent(event("run-1", "e1", "deliver the patch"))
  await compiler.advance({ runId: "run-1" })
  await compiler.acceptEvent(event("run-1", "e2", "deliver a second file from the same spec"))
  const second = await compiler.advance({ runId: "run-1" })

  assert.equal(second.ok, true, second.message ?? "")
  const task = (await compiler.inspect({ runId: "run-1" })).current_ir["t-fix"]
  assert.equal(task?.outputs.length, 1, "a restated deliverable is not registered twice")
  assert.equal(task?.bindings.length, 1, "a restated material is not registered twice")
  assert.equal(task?.bindings[0]?.purpose, "the export spec", "purpose prose stays with the first declaration")
})

test("v2 records a changed deliverable shape and follows the atom instead of rejecting the batch", async () => {
  const store = new IntentStoreV2({ storeDir: mkdtempSync(join(tmpdir(), "intent-v2-")), runId: "run-1" })
  const output = { output_id: "o-patch", description: "the patched export", format: "artifact" }
  const binding = { binding_id: "b-spec", ref: SOURCE, role: "task_data", use: "the export spec" }
  const compiler = createIntentCompilerV2({
    store,
    model: {
      propose: async (input): Promise<CompilerModelV2Result> => {
        if ((input.events[0]?.event_id ?? "") === "e1") {
          return { ok: true, candidate: declaringCandidate("e1", output, binding), call: { text: "{}", text_source: "text" } }
        }
        return {
          ok: true,
          candidate: redeclaringCandidate("e2", { ...output, format: "text" }, { ...binding, role: "context" }),
          call: { text: "{}", text_source: "text" },
        }
      },
    },
  })
  await compiler.acceptEvent(event("run-1", "e1", "deliver the patch"))
  assert.equal((await compiler.advance({ runId: "run-1" })).ok, true)
  await compiler.acceptEvent(event("run-1", "e2", "deliver a second file"))
  const second = await compiler.advance({ runId: "run-1" })

  // The atom is the single place a shape is declared, so the derived entries
  // follow it; the change is recorded for the audit and the check judges it
  // against the delegation (D2), not the mechanical layer.
  assert.equal(second.ok, true, second.message ?? "")
  const task = (await compiler.inspect({ runId: "run-1" })).current_ir["t-fix"]
  assert.equal(task?.outputs[0]?.format, "text", "the derived entry follows the atom's declaration")
  assert.equal(task?.bindings[0]?.role, "context")
  const batch = store.current().management_log.at(-1)
  const changes = batch?.declaration_changes ?? []
  assert.equal(changes.length, 2, "both changed shapes are recorded on the batch")
  assert.deepEqual(changes[0], { target: "output", id: "o-patch", from: "artifact", to: "text" })
  assert.equal(changes[1]?.target, "binding")
  assert.equal(changes[1]?.id, "b-spec")
  assert.equal(changes[1]?.from.startsWith("task_data"), true)
  assert.equal(changes[1]?.to.startsWith("context"), true)
})

test("v2 treats a paraphrased deliverable description as the same deliverable, not a second declaration", async () => {
  const store = new IntentStoreV2({ storeDir: mkdtempSync(join(tmpdir(), "intent-v2-")), runId: "run-1" })
  const output = { output_id: "o-patch", description: "the patched export", format: "artifact" }
  const binding = { binding_id: "b-spec", ref: SOURCE, role: "task_data", use: "the export spec" }
  const compiler = createIntentCompilerV2({
    store,
    model: {
      propose: async (input): Promise<CompilerModelV2Result> => (input.events[0]?.event_id ?? "") === "e1"
        ? { ok: true, candidate: declaringCandidate("e1", output, binding), call: { text: "{}", text_source: "text" } }
        // The r11d shape: the atom says the same thing in its own words.
        : { ok: true, candidate: redeclaringCandidate("e2", { ...output, description: "The compiled repro-verify binary." }, binding), call: { text: "{}", text_source: "text" } },
    },
  })
  await compiler.acceptEvent(event("run-1", "e1", "deliver the patch"))
  assert.equal((await compiler.advance({ runId: "run-1" })).ok, true)
  await compiler.acceptEvent(event("run-1", "e2", "deliver a second file"))
  const second = await compiler.advance({ runId: "run-1" })

  assert.equal(second.ok, true, second.message ?? "")
  const task = (await compiler.inspect({ runId: "run-1" })).current_ir["t-fix"]
  assert.equal(task?.outputs[0]?.description, "the patched export", "the registered deliverable keeps the task's wording")
})

test("v2 rejects one deliverable declared two ways in the same batch", async () => {
  const store = new IntentStoreV2({ storeDir: mkdtempSync(join(tmpdir(), "intent-v2-")), runId: "run-1" })
  const seen: string[][] = []
  const compiler = createIntentCompilerV2({
    store,
    model: {
      propose: async (input): Promise<CompilerModelV2Result> => {
        seen.push([...(input.validation_errors ?? [])])
        const candidate = createTaskCandidate("e1", "deliver the patch")
        const compilation = (candidate.groups[0] as unknown as { compilation: { drafts: Array<{ atoms: Array<Record<string, unknown>> }> } }).compilation
        compilation.drafts[0].atoms = [
          { ...compilation.drafts[0].atoms[0], atom_id: "a-first", outputs: [{ output_id: "o-patch", description: "the patch", format: "artifact" }] },
          { ...compilation.drafts[0].atoms[0], atom_id: "a-second", outputs: [{ output_id: "o-patch", description: "something else", format: "text" }] },
        ]
        const group = candidate.groups[0] as unknown as { coverage: Array<{ refs: Array<{ local_ref: string }> }> }
        group.coverage[0].refs = [{ local_ref: "a-first" }]
        return { ok: true, candidate, call: { text: "{}", text_source: "text" } }
      },
    },
  })
  await compiler.acceptEvent(event("run-1", "e1", "deliver the patch"))
  const result = await compiler.advance({ runId: "run-1" })

  assert.equal(result.ok, false)
  assert.match((seen.at(-1) ?? []).join(" | "), /declares output o-patch as format text while another atom in the same batch declares it as artifact/)
  const view = await compiler.inspect({ runId: "run-1" })
  assert.equal(view.current_ir["t-fix"], undefined, "a rejected batch commits nothing at all")
  assert.deepEqual(view.pending_event_ids, ["e1"])
})

test("v2 records refused operations and refused starts next to allowed calls", async () => {
  const store = new IntentStoreV2({ storeDir: mkdtempSync(join(tmpdir(), "intent-v2-")), runId: "run-1" })
  const compiler = createIntentCompilerV2({
    store,
    model: createCompilerModelV2(async () => JSON.stringify(createTaskCandidate("e1", "fix CSV preview"))),
  })
  await compiler.acceptEvent(event("run-1", "e1", "fix CSV preview"))
  const advanced = await compiler.advance({ runId: "run-1" })
  const dispatchId = advanced.deliveries?.[0]?.dispatch_id
  assert.ok(dispatchId)

  // A start for a dispatch that does not exist.
  const badStart = await compiler.authorize({ kind: "start", run_id: "run-1", dispatch_id: "dispatch-404", host_identity: "host-1" })
  assert.equal(badStart.ok, false)
  // An operation outside the granted authority, on a live execution.
  const start = await compiler.authorize({ kind: "start", run_id: "run-1", dispatch_id: dispatchId as string, host_identity: "host-1" })
  assert.equal(start.ok, true)
  const denied = await compiler.authorize({
    kind: "operation",
    run_id: "run-1",
    execution_id: start.execution_id as string,
    host_identity: "host-1",
    host_call_id: "call-9",
    operation_id: "op.write-r",
    resource_ref: SOURCE,
    input_refs: [],
    output_refs: [],
  })
  assert.equal(denied.ok, false)
  // The granted operation is still allowed and is not recorded as a denial.
  const allowed = await compiler.authorize({
    kind: "operation",
    run_id: "run-1",
    execution_id: start.execution_id as string,
    host_identity: "host-1",
    host_call_id: "call-10",
    operation_id: "op.read",
    resource_ref: SOURCE,
    input_refs: [],
    output_refs: [],
  })
  assert.equal(allowed.ok, true)

  const refusals = store.current().denied_calls
  assert.equal(refusals.length, 2, "only the two refusals are recorded")
  assert.deepEqual(refusals.map((entry) => entry.kind).sort(), ["operation", "start"])
  const operationRefusal = refusals.find((entry) => entry.kind === "operation")
  assert.equal(operationRefusal?.operation_id, "op.write-r")
  assert.equal(operationRefusal?.host_call_id, "call-9")
  assert.equal(operationRefusal?.code, "capability_unsupported")
  const startRefusal = refusals.find((entry) => entry.kind === "start")
  assert.equal(startRefusal?.dispatch_id, "dispatch-404")
  assert.equal(startRefusal?.code, "execution_inactive")
  const view = await compiler.inspect({ runId: "run-1" })
  assert.equal(view.denied_calls.length, 2, "refusals are visible to inspection")
})

/** Every `{source_id, digest}` pair a candidate carries, in document order. */
function candidateSourceDigests(candidate: Candidate | undefined): string[] {
  const digests: string[] = []
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) {
      for (const entry of value) visit(entry)
      return
    }
    if (typeof value !== "object" || value === null) return
    const record = value as Record<string, unknown>
    if (typeof record.source_id === "string" && typeof record.digest === "string") digests.push(record.digest)
    for (const key of Object.keys(record)) visit(record[key])
  }
  visit(candidate)
  return digests
}

test("v2 writes source-ref digests itself because the model cannot hash", async () => {
  const store = new IntentStoreV2({ storeDir: mkdtempSync(join(tmpdir(), "intent-v2-")), runId: "run-1" })
  // The model copies the batch's source id but guesses the digest: the r10 store
  // carries exactly this shape ("sha256:0000…0001", "sha256:placeholder_…").
  const candidate = JSON.parse(
    JSON.stringify(createTaskCandidate("e1", "fix CSV preview"))
      .replaceAll("\"s-u1\"", "\"e1\"")
      .replaceAll("\"s-s\"", "\"e1\""),
  ) as Candidate
  const compiler = createIntentCompilerV2({
    store,
    model: {
      propose: async (): Promise<CompilerModelV2Result> => ({
        ok: true,
        candidate,
        call: { text: "{}", text_source: "text" },
      }),
    },
  })
  await compiler.acceptEvent(event("run-1", "e1", "fix CSV preview"))
  const result = await compiler.advance({ runId: "run-1" })
  assert.equal(result.ok, true)

  const record = store.current().management_log[0]
  const stats = record?.source_refs
  assert.ok(stats !== undefined, "the batch records what happened to its source references")
  assert.equal(stats.total > 0, true)
  assert.equal(stats.unresolved, 0)
  assert.equal(stats.resolved, stats.total)
  assert.equal(stats.normalized, stats.total, "every guessed digest is replaced by the real one")
  const digests = candidateSourceDigests(record?.candidate)
  assert.equal(digests.length, stats.total)
  assert.deepEqual([...new Set(digests)], [digestText("fix CSV preview")])
})

test("v2 counts a source reference that resolves nowhere instead of pretending it does", async () => {
  const store = new IntentStoreV2({ storeDir: mkdtempSync(join(tmpdir(), "intent-v2-")), runId: "run-1" })
  // `s-u1` is not an event of this batch, so the reference cannot be verified.
  const candidate = createTaskCandidate("e1", "fix CSV preview")
  const compiler = createIntentCompilerV2({
    store,
    model: {
      propose: async (): Promise<CompilerModelV2Result> => ({
        ok: true,
        candidate,
        call: { text: "{}", text_source: "text" },
      }),
    },
  })
  await compiler.acceptEvent(event("run-1", "e1", "fix CSV preview"))
  const result = await compiler.advance({ runId: "run-1" })
  assert.equal(result.ok, true)

  const stats = store.current().management_log[0]?.source_refs
  assert.ok(stats !== undefined)
  assert.equal(stats.total > 0, true)
  assert.equal(stats.resolved, 0)
  assert.equal(stats.normalized, 0)
  assert.equal(stats.unresolved, stats.total)
})

test("the next batch for the same events carries why the previous one was rejected", async () => {
  const store = new IntentStoreV2({ storeDir: mkdtempSync(join(tmpdir(), "intent-v2-")), runId: "run-1" })
  const inputs: CompilerModelV2Input[] = []
  const compiler = createIntentCompilerV2({
    store,
    model: {
      propose: async (input): Promise<CompilerModelV2Result> => {
        inputs.push(input)
        if (inputs.length === 2) return { ok: false, error: { code: "schema", message: "stop after the first rejection" } }
        return { ok: true, candidate: createTaskCandidate("e1", "fix CSV preview"), call: { text: "{}", text_source: "text" } }
      },
      verify: async () => ({
        verdict: {
          verdict: "inconsistent",
          findings: [{
            dimension: "D2",
            claim: "the plan never builds the tool",
            expected: "the delegation asks for a built binary",
            observed: "no build step",
            refs: [{ source_id: "e1", digest: "sha256:guessed-by-the-checker", span: { unit: "utf16" as const, start: 0, end: 4 } }],
          }],
        },
      }),
    },
  })
  await compiler.acceptEvent(event("run-1", "e1", "fix CSV preview"))
  const first = await compiler.advance({ runId: "run-1" })
  assert.equal(first.ok, false)
  assert.equal(inputs[0]?.previous_rejection, undefined, "the first attempt has nothing to repair")

  const second = await compiler.advance({ runId: "run-1" })
  assert.equal(second.ok, false)
  const carried = inputs[inputs.length - 1]?.previous_rejection
  assert.equal(carried?.request_id, "mgmt-1")
  assert.equal(carried?.status, "validation_failed")
  assert.equal(carried?.findings[0]?.dimension, "D2")
  assert.equal(carried?.findings[0]?.evidence_resolved, true, "a reason that cited this batch is carried as binding")
  assert.match(carried?.findings[0]?.claim ?? "", /never builds the tool/)
})
