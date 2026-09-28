import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { IntentStoreV2 } from "../src/core/compiler-store-v2.js"
import { createIntentCompilerV2 } from "../src/core/intent-compiler-v2.js"
import { createCompilerModelV2 } from "../src/model/compiler-model-v2.js"
import type { CompilerModelV2Result } from "../src/model/compiler-model-v2.js"
import { atomRef } from "../src/core/compiled-intent.js"
import {
  validateExecutionOutcome,
  validateEvent,
  type Atom,
  type Candidate,
  type CompilerEvent,
  type Ref,
  type RunView,
  type SourceRef,
} from "../src/core/intent-contract.js"

const SOURCE: SourceRef = { source_id: "s-u1", digest: "sha256:0000000000000000000000000000000000000000000000000000000000000001" }
const TASK_REF: Ref = { id: "t-fix", revision: 0, digest: "sha256:1111111111111111111111111111111111111111111111111111111111111111" }

function userEvent(runId: string, id: string, text: string): CompilerEvent {
  return {
    schema_version: 2,
    run_id: runId,
    event_id: id,
    kind: "user_input",
    source: { producer_id: "host", channel: "user" },
    task_ids: ["t-fix"],
    payload: { text },
  }
}

function taskCandidate(eventId: string): Candidate {
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
        value: { goal: { text: "fix CSV preview" }, current_scope: { text: "proceed", disposition: "proceed" } },
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
              rules: [],
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
      coverage: [{
        requirement: { local_ref: "t-fix" },
        disposition: "assigned",
        refs: [{ local_ref: "a-preview" }],
        explanation: "a-preview is the deliverable for t-fix.",
      }],
      checks: [],
      questions: [],
    }],
  }
}

/** A recompile that adds one atom and records where the work goes. */
function replaceCandidate(eventId: string, atomId: string): Candidate {
  return {
    schema_version: 2,
    basis: { event_ids: [eventId], refs: [] },
    groups: [{
      local_ref: "g-replace",
      task_refs: ["t-fix"],
      depends_on: [],
      ir_changes: [],
      compilation: {
        decision: "replace",
        drafts: [{
          local_ref: "ci-replace",
          task_id: "t-fix",
          intent_basis: [],
          atoms: [{
            atom_id: atomId,
            revision: 0,
            goal_refs: [],
            task: `deliver ${atomId}`,
            inputs: [],
            outputs: [],
            constraints: [],
            optional_tools: [],
            authority: { basis: [SOURCE], rules: [], lifetime: "this_execution", delegation: "not_supported" },
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
      coverage: [{ requirement: { local_ref: "t-fix" }, disposition: "assigned", refs: [{ local_ref: atomId }], explanation: "delivery" }],
      checks: [],
      questions: [],
    }],
  }
}

function acceptanceCandidate(eventId: string, atomRefValue: Ref, result: "satisfied" | "not_satisfied"): Candidate {
  return {
    schema_version: 2,
    basis: { event_ids: [eventId], refs: [] },
    groups: [{
      local_ref: "g2",
      task_refs: ["t-fix"],
      depends_on: [],
      ir_changes: [],
      compilation: { decision: "reuse", current: [], reason: "no new compiled work" },
      execution_decisions: [],
      assessments: [{
        target_ref: atomRefValue,
        criteria_refs: [],
        evidence_refs: [],
        result,
        explanation: "accepted by management",
        method: "deterministic",
      }],
      coverage: [],
      checks: [],
      questions: [],
    }],
  }
}

/** Lifecycle state lives in the ledger; the atom itself is content only. */
function atomStatus(view: RunView, atomId: string, revision: number, taskId = "t-fix"): string {
  return view.atom_states.find((state) => state.task_id === taskId && state.atom_id === atomId && state.atom_revision === revision)?.status ?? "ready"
}

test("authorize start marks executing and an accepted completed outcome then a satisfied assessment marks legacy", async () => {
  const store = new IntentStoreV2({ storeDir: mkdtempSync(join(tmpdir(), "lifecycle-v2-")), runId: "run-1" })
  const replies = new Map<string, Candidate>([
    ["e1", taskCandidate("e1")],
  ])
  const compiler = createIntentCompilerV2({
    store,
    model: createCompilerModelV2(async (input) => {
      const id = input.events[0]?.event_id ?? ""
      const known = replies.get(id)
      if (known) return JSON.stringify(known)
      const dispatch = store.current().dispatches[0]
      assert.ok(dispatch)
      return JSON.stringify(acceptanceCandidate(id, { id: dispatch.atom_id, revision: dispatch.atom_revision, digest: dispatch.digest }, "satisfied"))
    }),
  })

  await compiler.acceptEvent(userEvent("run-1", "e1", "fix CSV preview"))
  const first = await compiler.advance({ runId: "run-1" })
  assert.equal(first.disposition, "dispatched")
  const delivery = first.deliveries?.[0]
  assert.ok(delivery)
  assert.ok(delivery.execution_task)
  assert.equal("authority" in (delivery.execution_task as unknown as Record<string, unknown>), false)

  const start = await compiler.authorize({
    kind: "start",
    run_id: "run-1",
    dispatch_id: delivery.dispatch_id,
    host_identity: "host-1",
  })
  assert.equal(start.ok, true)
  const executionId = start.execution_id as string

  let view = await compiler.inspect({ runId: "run-1" })
  assert.equal(atomStatus(view, "a-preview", 0), "executing")

  const outcome = {
    schema_version: 2,
    execution_id: executionId,
    atom_ref: { id: delivery.atom_id, revision: delivery.atom.revision, digest: delivery.digest },
    suggested_status: "completed",
    product_refs: [],
    file_changes: [{ path: "preview.csv", digest: "sha256:abc" }],
    evidence_refs: [],
  }
  validateExecutionOutcome(outcome)
  const returned = await compiler.acceptEvent({
    schema_version: 2,
    run_id: "run-1",
    event_id: `return-${executionId}`,
    kind: "execution_return",
    source: { producer_id: "host", channel: "executor" },
    execution_id: executionId,
    payload: { state_claim: "completed", outcome },
  })
  assert.equal(returned.status, "saved")

  view = await compiler.inspect({ runId: "run-1" })
  assert.equal(atomStatus(view, "a-preview", 0), "completed")
  assert.equal(view.executions[0]?.status, "closed")
  assert.equal(store.current().execution_outcomes.length, 1)
  assert.equal(store.current().execution_outcomes[0]?.atom_status_before, "executing")
  assert.equal(store.current().execution_outcomes[0]?.atom_status_after, "completed")

  const second = await compiler.advance({ runId: "run-1" })
  assert.equal(second.ok, true)
  view = await compiler.inspect({ runId: "run-1" })
  assert.equal(atomStatus(view, "a-preview", 0), "legacy")
})

test("a failed outcome keeps the failed record and a replacement atom supersedes without rewriting it", async () => {
  const store = new IntentStoreV2({ storeDir: mkdtempSync(join(tmpdir(), "lifecycle-v2-")), runId: "run-1" })
  const compiler = createIntentCompilerV2({
    store,
    model: createCompilerModelV2(async (input) => {
      const id = input.events[0]?.event_id ?? ""
      if (id === "e1") return JSON.stringify(taskCandidate("e1"))
      const dispatch = store.current().dispatches[0]
      assert.ok(dispatch)
      const oldRef: Ref = { id: dispatch.atom_id, revision: dispatch.atom_revision, digest: dispatch.digest }
      const candidate: Candidate = {
        schema_version: 2,
        basis: { event_ids: [id], refs: [] },
        groups: [{
          local_ref: "g2",
          task_refs: ["t-fix"],
          depends_on: [],
          ir_changes: [],
          compilation: {
            decision: "replace",
            drafts: [{
              local_ref: "ci-2",
              task_id: "t-fix",
              intent_basis: [],
              atoms: [{
                atom_id: "a-retry",
                revision: 0,
                previous_atom_ref: oldRef,
                goal_refs: [TASK_REF],
                task: "retry preview fix",
                inputs: [],
                outputs: [],
                constraints: [],
                optional_tools: [],
                authority: { basis: [SOURCE], rules: [], lifetime: "this_execution", delegation: "not_supported" },
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
          coverage: [{
            requirement: { local_ref: "t-fix" },
            disposition: "assigned",
            refs: [{ local_ref: "a-retry" }],
            explanation: "a-retry is the replacement deliverable for t-fix.",
          }],
          checks: [],
          questions: [],
        }],
      }
      return JSON.stringify(candidate)
    }),
  })

  await compiler.acceptEvent(userEvent("run-1", "e1", "fix CSV preview"))
  const first = await compiler.advance({ runId: "run-1" })
  const delivery = first.deliveries?.[0]
  assert.ok(delivery)
  const start = await compiler.authorize({
    kind: "start",
    run_id: "run-1",
    dispatch_id: delivery.dispatch_id,
    host_identity: "host-1",
  })
  const executionId = start.execution_id as string

  await compiler.acceptEvent({
    schema_version: 2,
    run_id: "run-1",
    event_id: `return-${executionId}`,
    kind: "execution_return",
    source: { producer_id: "host", channel: "executor" },
    execution_id: executionId,
    payload: {
      state_claim: "failed",
      outcome: {
        schema_version: 2,
        execution_id: executionId,
        atom_ref: { id: delivery.atom_id, revision: delivery.atom.revision, digest: delivery.digest },
        suggested_status: "failed",
        product_refs: [],
        file_changes: [],
        evidence_refs: [],
        failure_reason: "missing required column",
      },
    },
  })
  let view = await compiler.inspect({ runId: "run-1" })
  assert.equal(atomStatus(view, "a-preview", 0), "failed")

  const second = await compiler.advance({ runId: "run-1" })
  assert.equal(second.ok, true)
  view = await compiler.inspect({ runId: "run-1" })
  const atoms = view.current_compiled["t-fix"]?.atoms ?? []
  assert.equal(atoms.length, 2)
  assert.equal(atomStatus(view, "a-preview", 0), "failed")
  assert.equal(atomStatus(view, "a-retry", 0), "ready")
})

test("an execution_return whose atom_ref does not match the dispatch is rejected before saving", async () => {
  const store = new IntentStoreV2({ storeDir: mkdtempSync(join(tmpdir(), "lifecycle-v2-")), runId: "run-1" })
  const compiler = createIntentCompilerV2({
    store,
    model: createCompilerModelV2(async () => JSON.stringify(taskCandidate("e1"))),
  })
  await compiler.acceptEvent(userEvent("run-1", "e1", "fix CSV preview"))
  const first = await compiler.advance({ runId: "run-1" })
  const delivery = first.deliveries?.[0]
  assert.ok(delivery)
  const start = await compiler.authorize({
    kind: "start",
    run_id: "run-1",
    dispatch_id: delivery.dispatch_id,
    host_identity: "host-1",
  })
  const executionId = start.execution_id as string

  const receipt = await compiler.acceptEvent({
    schema_version: 2,
    run_id: "run-1",
    event_id: `return-${executionId}`,
    kind: "execution_return",
    source: { producer_id: "host", channel: "executor" },
    execution_id: executionId,
    payload: {
      state_claim: "completed",
      outcome: {
        schema_version: 2,
        execution_id: executionId,
        atom_ref: { id: "different-atom", revision: 0, digest: "sha256:bad" },
        suggested_status: "completed",
        product_refs: [],
        file_changes: [],
        evidence_refs: [],
      },
    },
  })
  assert.equal(receipt.status, "rejected")
  assert.equal(receipt.code, "identity_conflict")
  const view = await compiler.inspect({ runId: "run-1" })
  assert.equal(view.executions[0]?.status, "active")
  assert.equal(store.current().execution_outcomes.length, 0)
})

test("the same execution_return replayed later is a duplicate, not a closed-execution rejection", async () => {
  const store = new IntentStoreV2({ storeDir: mkdtempSync(join(tmpdir(), "lifecycle-v2-")), runId: "run-1" })
  const compiler = createIntentCompilerV2({
    store,
    model: createCompilerModelV2(async (input) => {
      const id = input.events[0]?.event_id ?? ""
      if (id === "e1") return JSON.stringify(taskCandidate("e1"))
      return JSON.stringify(acceptanceCandidate(id, {
        id: store.current().dispatches[0]?.atom_id ?? "",
        revision: store.current().dispatches[0]?.atom_revision ?? 0,
        digest: store.current().dispatches[0]?.digest ?? "",
      }, "satisfied"))
    }),
  })
  await compiler.acceptEvent(userEvent("run-1", "e1", "fix CSV preview"))
  const first = await compiler.advance({ runId: "run-1" })
  const delivery = first.deliveries?.[0]
  assert.ok(delivery)
  const start = await compiler.authorize({
    kind: "start",
    run_id: "run-1",
    dispatch_id: delivery.dispatch_id,
    host_identity: "host-1",
  })
  const executionId = start.execution_id as string
  const returnEvent: CompilerEvent = {
    schema_version: 2,
    run_id: "run-1",
    event_id: `return-${executionId}`,
    kind: "execution_return",
    source: { producer_id: "host", channel: "executor" },
    execution_id: executionId,
    payload: {
      state_claim: "completed",
      outcome: {
        schema_version: 2,
        execution_id: executionId,
        atom_ref: { id: delivery.atom_id, revision: delivery.atom.revision, digest: delivery.digest },
        suggested_status: "completed",
        product_refs: [],
        file_changes: [],
        evidence_refs: [],
      },
    },
  }
  const firstReturn = await compiler.acceptEvent(returnEvent)
  assert.equal(firstReturn.status, "saved")
  const replayed = await compiler.acceptEvent(returnEvent)
  assert.equal(replayed.status, "duplicate")
  assert.equal(store.current().execution_outcomes.length, 1)
})

test("execution_return payload validation enforces state_claim/outcome consistency", () => {
  assert.throws(
    () => validateEvent({
      schema_version: 2,
      run_id: "run-1",
      event_id: "r1",
      kind: "execution_return",
      source: { producer_id: "host", channel: "executor" },
      execution_id: "execution-1",
      payload: {
        state_claim: "completed",
        outcome: {
          schema_version: 2,
          execution_id: "execution-1",
          atom_ref: { id: "a", revision: 0, digest: "sha256:x" },
          suggested_status: "failed",
          product_refs: [],
          file_changes: [],
          evidence_refs: [],
        },
      },
    }),
    /requires outcome.suggested_status completed/,
  )
})

test("atom identity digest is stable across lifecycle status transitions", () => {
  const base: Atom = {
    atom_id: "a",
    revision: 0,
    goal_refs: [],
    task: "do the thing",
    inputs: [],
    outputs: [],
    constraints: [],
    optional_tools: [],
    authority: { basis: [], rules: [], lifetime: "this_execution", delegation: "not_supported" },
    preconditions: [],
    completion: [],
    return_when: [],
    intent_judgments: [],
  }
  // Legacy records carried lifecycle fields inside the atom; the digest must
  // not change when those fields appear or disappear.
  const ready = atomRef(base)
  const completed = atomRef({ ...base, status: "completed", updated_at: "2026-09-22T00:00:00Z" } as unknown as Atom)
  const legacy = atomRef({ ...base, status: "legacy", updated_at: "2026-09-22T00:00:01Z" } as unknown as Atom)
  assert.equal(ready.digest, completed.digest)
  assert.equal(ready.digest, legacy.digest)
})

test("a blocked return closes the execution and returns the atom to ready", async () => {
  const store = new IntentStoreV2({ storeDir: mkdtempSync(join(tmpdir(), "lifecycle-v2-")), runId: "run-1" })
  const compiler = createIntentCompilerV2({
    store,
    model: createCompilerModelV2(async (input) => {
      const id = input.events[0]?.event_id ?? ""
      if (id === "e1") return JSON.stringify(taskCandidate("e1"))
      return JSON.stringify({ schema_version: 2, basis: { event_ids: [id], refs: [] }, groups: [] })
    }),
  })
  await compiler.acceptEvent(userEvent("run-1", "e1", "fix CSV preview"))
  const first = await compiler.advance({ runId: "run-1" })
  const delivery = first.deliveries?.[0]
  assert.ok(delivery)
  const start = await compiler.authorize({ kind: "start", run_id: "run-1", dispatch_id: delivery.dispatch_id, host_identity: "host-1" })
  assert.equal(start.ok, true)
  const executionId = start.execution_id as string
  let view = await compiler.inspect({ runId: "run-1" })
  assert.equal(atomStatus(view, "a-preview", 0), "executing")

  const outcome = {
    schema_version: 2,
    execution_id: executionId,
    atom_ref: { id: delivery.atom_id, revision: delivery.atom.revision, digest: delivery.digest },
    suggested_status: "ready",
    product_refs: [],
    file_changes: [],
    evidence_refs: [],
    failure_reason: "blocked on missing input",
  }
  const returned = await compiler.acceptEvent({
    schema_version: 2,
    run_id: "run-1",
    event_id: `return-${executionId}`,
    kind: "execution_return",
    source: { producer_id: "host", channel: "executor" },
    execution_id: executionId,
    payload: { state_claim: "blocked", outcome },
  })
  assert.equal(returned.status, "saved")

  view = await compiler.inspect({ runId: "run-1" })
  assert.equal(atomStatus(view, "a-preview", 0), "ready", "a blocked atom stays dispatchable")
  assert.equal(view.executions[0]?.status, "closed")
  assert.equal(store.current().execution_outcomes[0]?.atom_status_after, "ready")
})

test("replacing a ready atom marks it legacy and links the replacement in the ledger", async () => {
  const store = new IntentStoreV2({ storeDir: mkdtempSync(join(tmpdir(), "lifecycle-v2-")), runId: "run-1" })
  const compiler = createIntentCompilerV2({
    store,
    model: createCompilerModelV2(async (input) => {
      const id = input.events[0]?.event_id ?? ""
      if (id === "e1") return JSON.stringify(taskCandidate("e1"))
      const current = store.current().compiled["t-fix"]?.atoms.find((atom) => atom.atom_id === "a-preview")
      assert.ok(current)
      const priorRef = atomRef(current)
      const replacement: Candidate = {
        schema_version: 2,
        basis: { event_ids: [id], refs: [] },
        groups: [{
          local_ref: "g2",
          task_refs: ["t-fix"],
          depends_on: [],
          ir_changes: [],
          compilation: {
            decision: "replace",
            drafts: [{
              local_ref: "ci-2",
              task_id: "t-fix",
              intent_basis: [],
              atoms: [{
                atom_id: "a-replacement",
                revision: 0,
                previous_atom_ref: priorRef,
                goal_refs: [],
                task: "deliver the preview a different way",
                inputs: [],
                outputs: [],
                constraints: [],
                optional_tools: [],
                authority: { basis: [SOURCE], rules: [], lifetime: "this_execution", delegation: "not_supported" },
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
          coverage: [{ requirement: { local_ref: "t-fix" }, disposition: "assigned", refs: [{ local_ref: "a-replacement" }], explanation: "replacement delivery" }],
          checks: [],
          questions: [],
        }],
      }
      return JSON.stringify(replacement)
    }),
  })
  await compiler.acceptEvent(userEvent("run-1", "e1", "fix CSV preview"))
  await compiler.advance({ runId: "run-1" })
  await compiler.acceptEvent(userEvent("run-1", "e2", "deliver it another way"))
  const second = await compiler.advance({ runId: "run-1" })
  assert.equal(second.ok, true, second.message ?? "")

  const view = await compiler.inspect({ runId: "run-1" })
  assert.equal(atomStatus(view, "a-preview", 0), "legacy")
  assert.equal(atomStatus(view, "a-replacement", 0), "ready")
  const replacementState = view.atom_states.find((state) => state.atom_id === "a-replacement")
  assert.equal(replacementState?.previous_atom_ref?.id, "a-preview")
  assert.equal(replacementState?.previous_atom_ref?.digest, atomRef(store.current().compiled["t-fix"]?.atoms.find((atom) => atom.atom_id === "a-preview") as Atom).digest)
  // The artifact keeps the replaced atom as history next to its replacement.
  assert.deepEqual(view.current_compiled["t-fix"]?.atoms.map((atom) => atom.atom_id).sort(), ["a-preview", "a-replacement"])
})

test("an executing atom whose execution is closed by a recompile returns to ready", async () => {
  const store = new IntentStoreV2({ storeDir: mkdtempSync(join(tmpdir(), "lifecycle-v2-")), runId: "run-1" })
  const compiler = createIntentCompilerV2({
    store,
    model: createCompilerModelV2(async (input) => JSON.stringify(
      (input.events[0]?.event_id ?? "") === "e1" ? taskCandidate("e1") : replaceCandidate("e2", "a-second"),
    )),
  })
  await compiler.acceptEvent(userEvent("run-1", "e1", "fix CSV preview"))
  const first = await compiler.advance({ runId: "run-1" })
  const delivery = first.deliveries?.[0]
  assert.ok(delivery)
  const start = await compiler.authorize({ kind: "start", run_id: "run-1", dispatch_id: delivery.dispatch_id, host_identity: "host-1" })
  assert.equal(start.ok, true)
  let view = await compiler.inspect({ runId: "run-1" })
  assert.equal(atomStatus(view, "a-preview", 0), "executing")

  await compiler.acceptEvent(userEvent("run-1", "e2", "rework the preview"))
  const second = await compiler.advance({ runId: "run-1" })
  assert.equal(second.ok, true, second.message ?? "")

  view = await compiler.inspect({ runId: "run-1" })
  assert.equal(atomStatus(view, "a-preview", 0), "ready", "a closed execution must not leave the atom stuck at executing")
  assert.equal(view.executions[0]?.status, "closed")
  assert.equal(view.executions[0]?.closed_reason, "compiled_revision_advanced")
})

test("a legacy snapshot seeds the ledger so completed atoms are not dispatched again", async () => {
  const dir = mkdtempSync(join(tmpdir(), "lifecycle-v2-"))
  const runId = "run-1"
  const runDir = join(dir, "v2-runs", runId)
  mkdirSync(runDir, { recursive: true })
  const legacyAtom = {
    atom_id: "a-done",
    revision: 0,
    status: "completed",
    updated_at: "2026-09-22T00:00:00.000Z",
    goal_refs: [],
    task: "already delivered",
    inputs: [],
    outputs: [],
    constraints: [],
    optional_tools: [],
    authority: { basis: [], rules: [], lifetime: "this_execution", delegation: "not_supported" },
    preconditions: [],
    completion: [],
    return_when: [],
    intent_judgments: [],
  }
  writeFileSync(join(runDir, "snapshot.json"), JSON.stringify({
    schema: "intent-store-v2/0.1",
    run_id: runId,
    ir: { "t-fix": { task_id: "t-fix", revision: 0, goal: { text: "fix CSV", sources: [] }, bindings: [], outputs: [], content: [], current_scope: { text: "proceed", disposition: "proceed", sources: [] }, unresolved: [] } },
    compiled: {
      "t-fix": {
        schema_version: 2,
        artifact_type: "compiled_intent",
        task_id: "t-fix",
        compiled_revision: 0,
        intent_basis: [],
        atoms: [legacyAtom],
        relations: [],
        attachments: [],
      },
    },
    pending_event_ids: [],
    dispatches: [],
    executions: [],
    execution_outcomes: [],
    management_log: [],
    assessments: [],
    checks: [],
    questions: [],
    coverage: [],
    budget: { management_requests: 0, total_management_requests: 0, management_input_tokens: 0, management_output_tokens: 0, management_reasoning_tokens: 0, management_cache_read_tokens: 0, management_cache_write_tokens: 0, management_cost: 0, max_management_requests: 3, max_total_management_requests: 30, max_management_input_tokens: 64000, max_management_output_tokens: 6000 },
  }))

  const store = new IntentStoreV2({ storeDir: dir, runId })
  assert.equal(store.current().atom_states.length, 1, "the legacy status is migrated into the ledger")
  assert.equal(store.current().atom_states[0]?.status, "completed")
  assert.equal(store.current().atom_states[0]?.atom_id, "a-done")

  const compiler = createIntentCompilerV2({
    store,
    model: createCompilerModelV2(async () => JSON.stringify(replaceCandidate("e1", "a-fresh"))),
  })
  await compiler.acceptEvent(userEvent(runId, "e1", "deliver a fresh preview"))
  const result = await compiler.advance({ runId })
  assert.equal(result.ok, true, result.message ?? "")

  const dispatched = store.current().dispatches.map((dispatch) => dispatch.atom_id)
  assert.deepEqual(dispatched, ["a-fresh"], "the migrated completed atom must not be dispatched again")
  const view = await compiler.inspect({ runId })
  assert.equal(atomStatus(view, "a-done", 0), "completed")
})

test("a recompile re-offers the same dispatch instead of creating a duplicate", async () => {
  const store = new IntentStoreV2({ storeDir: mkdtempSync(join(tmpdir(), "lifecycle-v2-")), runId: "run-1" })
  const compiler = createIntentCompilerV2({
    store,
    model: createCompilerModelV2(async (input) => JSON.stringify(
      (input.events[0]?.event_id ?? "") === "e1" ? taskCandidate("e1") : replaceCandidate("e2", "a-second"),
    )),
  })
  await compiler.acceptEvent(userEvent("run-1", "e1", "fix CSV preview"))
  const first = await compiler.advance({ runId: "run-1" })
  const firstDelivery = first.deliveries?.find((delivery) => delivery.atom_id === "a-preview")
  assert.ok(firstDelivery)

  await compiler.acceptEvent(userEvent("run-1", "e2", "rework the preview"))
  const second = await compiler.advance({ runId: "run-1" })
  const reoffered = second.deliveries?.find((delivery) => delivery.atom_id === "a-preview")
  assert.ok(reoffered, "a still-ready atom is offered again so the host can pick it up")
  assert.equal(reoffered.dispatch_id, firstDelivery.dispatch_id, "the offer is the same dispatch, not a new one")
  assert.equal(store.current().dispatches.filter((dispatch) => dispatch.atom_id === "a-preview").length, 1)

  // The re-offered dispatch is usable: the host can start the work it missed.
  const start = await compiler.authorize({ kind: "start", run_id: "run-1", dispatch_id: firstDelivery.dispatch_id, host_identity: "host-1" })
  assert.equal(start.ok, true)

  // A second execution after a closed one reuses the same dispatch as well.
  const outcome = {
    schema_version: 2,
    execution_id: start.execution_id as string,
    atom_ref: { id: firstDelivery.atom_id, revision: firstDelivery.atom.revision, digest: firstDelivery.digest },
    suggested_status: "ready",
    product_refs: [],
    file_changes: [],
    evidence_refs: [],
    failure_reason: "blocked on missing input",
  }
  await compiler.acceptEvent({
    schema_version: 2,
    run_id: "run-1",
    event_id: "return-1",
    kind: "execution_return",
    source: { producer_id: "host", channel: "executor" },
    execution_id: start.execution_id as string,
    payload: { state_claim: "blocked", outcome },
  })
  const restart = await compiler.authorize({ kind: "start", run_id: "run-1", dispatch_id: firstDelivery.dispatch_id, host_identity: "host-1" })
  assert.equal(restart.ok, true, "a dispatch stays reusable after its execution closed without success")
  assert.notEqual(restart.execution_id, start.execution_id)
  assert.equal(store.current().dispatches.filter((dispatch) => dispatch.atom_id === "a-preview").length, 1)
})

test("changed atom content gets a new dispatch", async () => {
  const store = new IntentStoreV2({ storeDir: mkdtempSync(join(tmpdir(), "lifecycle-v2-")), runId: "run-1" })
  const compiler = createIntentCompilerV2({
    store,
    model: createCompilerModelV2(async (input) => {
      if ((input.events[0]?.event_id ?? "") === "e1") return JSON.stringify(taskCandidate("e1"))
      // Same atom id, raised revision: new content identity, so a new dispatch.
      const reworked = replaceCandidate("e2", "a-preview")
      const compilation = (reworked.groups[0] as unknown as { compilation: { drafts: Array<{ atoms: Array<Record<string, unknown>> }> } }).compilation
      compilation.drafts[0].atoms[0].revision = 1
      return JSON.stringify(reworked)
    }),
  })
  await compiler.acceptEvent(userEvent("run-1", "e1", "fix CSV preview"))
  const first = await compiler.advance({ runId: "run-1" })
  const firstDispatchId = first.deliveries?.[0]?.dispatch_id
  assert.ok(firstDispatchId)

  // Same atom id with a raised revision -> different content identity.
  await compiler.acceptEvent(userEvent("run-1", "e2", "deliver something else entirely"))
  const second = await compiler.advance({ runId: "run-1" })
  const atomDelivery = second.deliveries?.find((delivery) => delivery.atom_id === "a-preview")
  assert.ok(atomDelivery)
  assert.notEqual(atomDelivery.dispatch_id, firstDispatchId)
  assert.equal(store.current().dispatches.filter((dispatch) => dispatch.atom_id === "a-preview").length, 2)
})

test("changing atom content without a revision bump is rejected", async () => {
  const store = new IntentStoreV2({ storeDir: mkdtempSync(join(tmpdir(), "lifecycle-v2-")), runId: "run-1" })
  const seen: string[][] = []
  const compiler = createIntentCompilerV2({
    store,
    model: {
      propose: async (input): Promise<CompilerModelV2Result> => {
        seen.push([...(input.validation_errors ?? [])])
        const candidate = (input.events[0]?.event_id ?? "") === "e1"
          ? taskCandidate("e1")
          : replaceCandidate("e2", "a-preview")
        return { ok: true, candidate, call: { text: "{}", text_source: "text" } }
      },
    },
  })
  await compiler.acceptEvent(userEvent("run-1", "e1", "fix CSV preview"))
  const first = await compiler.advance({ runId: "run-1" })
  assert.equal(first.ok, true, first.message ?? "")

  // Same atom_id@revision, different task text: without a revision bump the
  // lifecycle record would be inherited, so the candidate is rejected.
  await compiler.acceptEvent(userEvent("run-1", "e2", "reword the same atom"))
  const second = await compiler.advance({ runId: "run-1" })
  assert.equal(second.ok, false)
  assert.equal(second.code, "invalid_candidate")
  assert.match(seen.at(-1)?.[0] ?? "", /atom a-preview@0 already exists with different content/)
  assert.equal(store.current().dispatches.length, 1)
})

/** Drive one dispatch + start so a return can be sent for it. */
async function dispatchedAndStarted(store: IntentStoreV2, compiler: ReturnType<typeof createIntentCompilerV2>) {
  await compiler.acceptEvent(userEvent("run-1", "e1", "fix CSV preview"))
  const first = await compiler.advance({ runId: "run-1" })
  const delivery = first.deliveries?.[0]
  assert.ok(delivery)
  const start = await compiler.authorize({ kind: "start", run_id: "run-1", dispatch_id: delivery.dispatch_id, host_identity: "host-1" })
  assert.equal(start.ok, true)
  return { delivery, executionId: start.execution_id as string }
}

function returnEvent(executionId: string, delivery: Awaited<ReturnType<typeof dispatchedAndStarted>>["delivery"], fileChanges: Array<{ path: string; digest: string }>, index = 1) {
  return {
    schema_version: 2 as const,
    run_id: "run-1",
    event_id: `return-${index}`,
    kind: "execution_return" as const,
    source: { producer_id: "host", channel: "executor" as const },
    execution_id: executionId,
    payload: {
      state_claim: "completed" as const,
      outcome: {
        schema_version: 2 as const,
        execution_id: executionId,
        atom_ref: { id: delivery.atom_id, revision: delivery.atom.revision, digest: delivery.digest },
        suggested_status: "completed" as const,
        product_refs: [],
        file_changes: fileChanges,
        evidence_refs: [],
      },
    },
  }
}

test("a declared artifact whose digest the host cannot confirm is rejected", async () => {
  const store = new IntentStoreV2({ storeDir: mkdtempSync(join(tmpdir(), "lifecycle-v2-")), runId: "run-1" })
  const compiler = createIntentCompilerV2({
    store,
    model: createCompilerModelV2(async (input) => JSON.stringify(
      (input.events[0]?.event_id ?? "") === "e1"
        ? taskCandidate("e1")
        : { schema_version: 2, basis: { event_ids: [input.events[0]?.event_id ?? ""], refs: [] }, groups: [] },
    )),
    capabilities: {
      operations: ["read"],
      describeArtifacts: (paths) => paths.map((path) => (path === "preview.csv"
        ? { path, digest: "sha256:1111111111111111111111111111111111111111111111111111111111111111" }
        : { path, reason: "missing" })),
    },
  })
  const { delivery, executionId } = await dispatchedAndStarted(store, compiler)

  const mismatch = await compiler.acceptEvent(returnEvent(executionId, delivery, [{ path: "preview.csv", digest: "sha256:0000000000000000000000000000000000000000000000000000000000000000" }]))
  assert.equal(mismatch.ok, false)
  assert.equal(mismatch.code, "artifact_mismatch")
  assert.match(mismatch.message ?? "", /executor declared sha256:0+/, "the rejection names both digests")

  const missing = await compiler.acceptEvent(returnEvent(executionId, delivery, [{ path: "gone.csv", digest: "sha256:0000000000000000000000000000000000000000000000000000000000000000" }], 2))
  assert.equal(missing.ok, false)
  assert.equal(missing.code, "artifact_unverifiable")
  assert.match(missing.message ?? "", /could not be verified: missing/)

  // Neither rejection was saved, so the execution is still live and can return again.
  assert.equal(store.current().execution_outcomes.length, 0)
  assert.equal(store.current().executions[0]?.status, "active")
  const accepted = await compiler.acceptEvent(returnEvent(executionId, delivery, [{ path: "preview.csv", digest: "sha256:1111111111111111111111111111111111111111111111111111111111111111" }], 3))
  assert.equal(accepted.status, "saved")
  assert.deepEqual(store.current().execution_outcomes[0]?.verified_artifacts, [
    { path: "preview.csv", digest: "sha256:1111111111111111111111111111111111111111111111111111111111111111" },
  ])
})

test("declaring no artifact skips verification entirely", async () => {
  const store = new IntentStoreV2({ storeDir: mkdtempSync(join(tmpdir(), "lifecycle-v2-")), runId: "run-1" })
  let calls = 0
  const compiler = createIntentCompilerV2({
    store,
    model: createCompilerModelV2(async (input) => JSON.stringify(
      (input.events[0]?.event_id ?? "") === "e1"
        ? taskCandidate("e1")
        : { schema_version: 2, basis: { event_ids: [input.events[0]?.event_id ?? ""], refs: [] }, groups: [] },
    )),
    capabilities: {
      operations: ["read"],
      describeArtifacts: (paths) => {
        calls += 1
        return paths.map((path) => ({ path, reason: "missing" }))
      },
    },
  })
  const { delivery, executionId } = await dispatchedAndStarted(store, compiler)
  const returned = await compiler.acceptEvent(returnEvent(executionId, delivery, []))

  assert.equal(returned.status, "saved")
  assert.equal(calls, 0, "no declared artifact means no host hashing")
  assert.equal(store.current().execution_outcomes[0]?.verified_artifacts, undefined)
})
