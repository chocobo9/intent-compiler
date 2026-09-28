import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, it } from "node:test"
import assert from "node:assert/strict"
import { sha256 } from "../src/observer/codec.js"
import { createCompilerModel, type CompilerModelRequest } from "../src/model/compiler-model.js"
import { CompilerStore } from "../src/core/compiler-store.js"
import { createIntentCompiler, type IntentCompiler, type PrepareTurnSuccess } from "../src/core/intent-compiler.js"

const temporaryDirectories: string[] = []

function temporaryDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), "intent-compiler-"))
  temporaryDirectories.push(directory)
  return directory
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

function source(request: CompilerModelRequest) {
  return {
    channel: "user" as const,
    input_identity: request.input_identity,
    input_digest: request.input_digest,
    start: 0,
    end: request.input_text.length,
  }
}

function createTaskResponse(
  request: CompilerModelRequest,
  description = `[LLM-PROTOTYPE] ${request.input_text}`,
): string {
  return JSON.stringify({
    base_state_version: request.base_state_version,
    input_identity: request.input_identity,
    input_digest: request.input_digest,
    operations: [
      { operation: "create_task", local_ref: "task-local", description, source: source(request) },
      { operation: "select_task", task_id: "task-local", source: source(request) },
    ],
  })
}

function noChangeResponse(request: CompilerModelRequest): string {
  return JSON.stringify({
    base_state_version: request.base_state_version,
    input_identity: request.input_identity,
    input_digest: request.input_digest,
    operations: [{ operation: "no_change" }],
  })
}

function evidenceProducedAt(): string {
  return new Date().toISOString()
}

function makeCompiler(responder: (request: CompilerModelRequest, call: number) => unknown, options: { projection?: { max_artifact_bytes?: number; max_rendered_bytes?: number } } = {}): { compiler: IntentCompiler; calls: () => number; store: CompilerStore } {
  const store = new CompilerStore({ storeDir: temporaryDirectory() })
  let calls = 0
  const model = createCompilerModel(async (request) => {
    calls += 1
    return responder(request, calls)
  })
  return { compiler: createIntentCompiler({ store, model, projection: options.projection }), calls: () => calls, store }
}

async function prepare(compiler: IntentCompiler, runId: string, inputIdentity: string, text: string): Promise<PrepareTurnSuccess> {
  const result = await compiler.prepareTurn({ runId, input: { inputIdentity, raw: text } })
  if (!result.ok) throw new Error(result.message)
  return result
}

async function prepareWithSnapshot(compiler: IntentCompiler, runId: string, inputIdentity: string, text: string, currentWorkspaceSnapshotId: string): Promise<PrepareTurnSuccess> {
  const result = await compiler.prepareTurn({ runId, input: { inputIdentity, raw: text }, currentWorkspaceSnapshotId })
  if (!result.ok) throw new Error(result.message)
  return result
}

function finish(compiler: IntentCompiler, result: PrepareTurnSuccess): string {
  const delivery = compiler.recordDelivery({
    runId: result.runId,
    inputIdentity: result.inputIdentity,
    artifactVersion: result.artifactVersion,
    expectedDigest: result.commit.compiledIntent.digest,
    expectedRenderedDigest: result.commit.renderedText.digest,
    readbackDigest: result.commit.compiledIntent.digest,
    readbackRenderedDigest: result.commit.renderedText.digest,
    status: "confirmed",
  })
  assert.equal(delivery.ok, true)
  assert.ok(delivery.attempt)
  const reconciled = compiler.recordDelivery({
    runId: result.runId,
    inputIdentity: result.inputIdentity,
    attemptId: delivery.attempt.attemptId,
    reconciliation: { terminal: true },
  })
  assert.equal(reconciled.ok, true)
  assert.equal(reconciled.recovery.action, "complete")
  return delivery.attempt.attemptId
}

describe("IntentCompiler", () => {
  it("does not commit an unselected new active task as an empty delivery (semantic-002)", async () => {
    // Minimal replay of the real proposal: creating a task
    // without select_task must not silently produce an empty executor input.
    const { compiler, store, calls } = makeCompiler((request) => {
      const envelope = JSON.parse(createTaskResponse(request))
      envelope.operations.pop()
      return JSON.stringify(envelope)
    })
    const result = await compiler.prepareTurn({ runId: "missing-selection", input: { inputIdentity: "input-1", raw: "Build a timer initially showing 25:00." } })
    assert.equal(result.ok, false, "new active task was committed without selection, yielding empty Compiled Intent")
    assert.equal(calls(), 2)
    assert.equal(store.openRun("missing-selection").history().some((event) => event.type.startsWith("commit.")), false)
  })

  it("retries missing selection before committing and projects the corrected requirement", async () => {
    const { compiler, store } = makeCompiler((request, call) => {
      const envelope = JSON.parse(createTaskResponse(request))
      if (call === 1) envelope.operations.pop()
      else assert.equal(request.validation_errors?.[0]?.code, "new_active_task_not_selected")
      envelope.operations.push({ operation: "add_requirement", task_id: "task-local", local_ref: "initial-time", text: "[LLM-PROTOTYPE] Initially display 25:00.", source: source(request) })
      return JSON.stringify(envelope)
    })
    const result = await prepare(compiler, "selection-retry", "input-1", "Build a timer initially showing 25:00.")
    assert.equal(result.retried, true)
    assert.equal(result.modelCalls, 2)
    assert.equal(result.stateVersion, 1)
    assert.equal(result.artifact.selected_task?.id, "task-0001")
    assert.equal(result.artifact.active_requirements[0]?.text, "[LLM-PROTOTYPE] Initially display 25:00.")
    assert.equal(store.openRun("selection-retry").history().filter((event) => event.type === "commit.complete").length, 1)
  })

  it("allows an explicitly deferred new task without forcing selection", async () => {
    const { compiler } = makeCompiler((request) => {
      const envelope = JSON.parse(createTaskResponse(request))
      envelope.operations[1].operation = "suspend_task"
      return JSON.stringify(envelope)
    })
    const result = await prepare(compiler, "deferred", "input-1", "Save a timer task, but suspend it for now.")
    assert.equal(result.artifact.selected_task, null)
    assert.equal(result.retried, false)
  })

  it("allows a genuine non-task no_change to keep the initial state empty", async () => {
    const { compiler } = makeCompiler((request) => noChangeResponse(request))
    const result = await prepare(compiler, "greeting", "input-1", "Hello.")
    assert.equal(result.stateVersion, 0)
    assert.equal(result.artifact.selected_task, null)
    assert.equal(result.retried, false)
  })

  it("keeps an existing selection when creating another task", async () => {
    const { compiler } = makeCompiler((request, call) => {
      const envelope = JSON.parse(createTaskResponse(request))
      if (call === 2) envelope.operations.pop()
      return JSON.stringify(envelope)
    })
    const first = await prepare(compiler, "keep-selected", "input-1", "Work on the parser.")
    finish(compiler, first)
    const second = await prepare(compiler, "keep-selected", "input-2", "Also record a timer task; keep working on the parser.")
    assert.equal(second.artifact.selected_task?.id, first.artifact.selected_task?.id)
    assert.equal(second.retried, false)
  })

  it("runs the strict input → model → validation → projection → commit order", async () => {
    const { compiler, calls, store } = makeCompiler((request) => createTaskResponse(request))
    const result = await prepare(compiler, "run-order", "input-1", "Build the parser.")
    assert.equal(calls(), 1)
    assert.equal(result.status, "committed")
    assert.equal(result.stateVersion, 1)
    assert.equal(result.artifact.artifact_type, "compiled_intent")
    assert.match(result.renderedText, /compiled_intent/u)
    assert.equal(result.compiledIntentDigest, result.artifact.artifact_digest)
    assert.equal(result.renderedTextDigest, sha256(result.renderedText))
    assert.equal(result.commit.compiledIntent.digest, `sha256:${sha256(result.canonicalArtifact)}`)
    assert.equal(result.commit.renderedText.digest, `sha256:${sha256(result.renderedText)}`)
    assert.notEqual(result.compiledIntentDigest, result.commit.compiledIntent.digest)
    assert.notEqual(result.renderedTextDigest, result.commit.renderedText.digest)
    const history = [...store.openRun("run-order").history()]
    const types = history.map((event) => event.type)
    assert.ok(types.indexOf("input.admitted") < types.indexOf("proposal.saved"))
    assert.ok(types.indexOf("proposal.saved") < types.indexOf("validation.recorded"))
    assert.ok(types.indexOf("validation.recorded") < types.indexOf("commit.complete"))
    assert.equal(types.includes("delivery.attempt"), false)
})

  it("allows exactly one deterministic retry after an invalid proposal", async () => {
    const { compiler, calls, store } = makeCompiler((request, call) => {
      if (call === 1) return JSON.stringify({ base_state_version: request.base_state_version, input_identity: request.input_identity, input_digest: request.input_digest, operations: [{ operation: "unknown_operation" }] })
      return createTaskResponse(request)
    })
    const result = await prepare(compiler, "retry", "input-1", "Build the parser.")
    assert.equal(result.status, "committed")
    assert.equal(result.retried, true)
    assert.equal(result.modelCalls, 2)
    assert.equal(calls(), 2)
    assert.equal(store.openRun("retry").history().filter((event) => event.type === "commit.complete").length, 1)
    assert.equal(store.openRun("retry").history().filter((event) => event.type === "delivery.attempt").length, 0)
  })

  it("stops after a second failure without commit or delivery", async () => {
    const { compiler, calls, store } = makeCompiler(() => "not-json")
    const result = await compiler.prepareTurn({ runId: "retry-stop", input: { inputIdentity: "input-1", raw: "Build the parser." } })
    assert.equal(result.ok, false)
    if (result.ok) return
    assert.equal(result.modelCalls, 2)
    assert.equal(result.retried, true)
    assert.equal(calls(), 2)
    const run = store.openRun("retry-stop")
    assert.equal(run.history().some((event) => event.type === "commit.complete"), false)
    assert.equal(run.history().some((event) => event.type === "delivery.attempt"), false)
    assert.equal(run.recover().action, "blocked")
  })

  it("reuses a duplicate identity and digest without another model call", async () => {
    const { compiler, calls } = makeCompiler((request) => createTaskResponse(request))
    const first = await prepare(compiler, "duplicate", "input-1", "Build the parser.")
    finish(compiler, first)
    const duplicate = await compiler.prepareTurn({ runId: "duplicate", input: { inputIdentity: "input-1", raw: "Build the parser." } })
    assert.equal(duplicate.ok, true)
    if (!duplicate.ok) return
    assert.equal(duplicate.status, "reused")
    assert.equal(duplicate.modelCalls, 0)
    assert.equal(calls(), 1)
    assert.equal(duplicate.compiledIntentDigest, first.compiledIntentDigest)
    assert.equal(duplicate.renderedTextDigest, first.renderedTextDigest)
})

  it("returns an identity/content conflict without calling the model", async () => {
    const { compiler, calls } = makeCompiler((request) => createTaskResponse(request))
    const first = await prepare(compiler, "conflict", "input-1", "Build the parser.")
    finish(compiler, first)
    const conflict = await compiler.prepareTurn({ runId: "conflict", input: { inputIdentity: "input-1", raw: "Change the parser." } })
    assert.equal(conflict.ok, false)
    if (conflict.ok) return
    assert.equal(conflict.status, "conflict")
    assert.equal(conflict.modelCalls, 0)
    assert.equal(calls(), 1)
})

  it("records a semantic no-op without increasing state or artifact version", async () => {
    const { compiler, calls } = makeCompiler((request) => request.input_identity === "input-2" ? noChangeResponse(request) : createTaskResponse(request))
    const first = await prepare(compiler, "no-op", "input-1", "Build the parser.")
    finish(compiler, first)
    const second = await prepare(compiler, "no-op", "input-2", "No semantic change.")
    assert.equal(second.status, "noop")
    assert.equal(second.stateVersion, first.stateVersion)
    assert.equal(second.artifactVersion, first.artifactVersion)
    assert.equal(second.compiledIntentDigest, first.compiledIntentDigest)
    assert.equal(second.renderedTextDigest, first.renderedTextDigest)
    assert.equal(calls(), 2)
})

  it("keeps a committed change after delivery rejection and blocks the next turn", async () => {
    const { compiler, store } = makeCompiler((request) => createTaskResponse(request))
    const first = await prepare(compiler, "delivery-reject", "input-1", "Build the parser.")
    const rejected = compiler.recordDelivery({
      runId: first.runId,
      inputIdentity: first.inputIdentity,
      artifactVersion: first.artifactVersion,
      expectedDigest: first.commit.compiledIntent.digest,
      expectedRenderedDigest: first.commit.renderedText.digest,
      readbackDigest: "sha256:wrong",
      readbackRenderedDigest: first.commit.renderedText.digest,
      status: "confirmed",
    })
    assert.equal(rejected.ok, true)
    assert.equal(rejected.recovery.action, "retry_delivery")
    assert.equal(store.openRun("delivery-reject").replay().current.version, first.stateVersion)
    const blocked = await compiler.prepareTurn({ runId: "delivery-reject", input: { inputIdentity: "input-2", raw: "Next" } })
    assert.equal(blocked.ok, false)
    if (!blocked.ok) assert.equal(blocked.status, "blocked")
})

  it("admits evidence only before the next input and preserves an evidence conflict", async () => {
    let seenEvidence: readonly unknown[] = []
    const { compiler } = makeCompiler((request) => {
      seenEvidence = request.admitted_evidence
      return createTaskResponse(request)
    })
    const first = await prepare(compiler, "evidence", "input-1", "Build the parser.")
    const parent = finish(compiler, first)
    const invalidTimestamp = compiler.admitEvidence({
      runId: "evidence",
      evidence: {
        evidenceId: "ev-invalid-time",
        boundaryInputIdentity: "input-2",
        payload: { kind: "tool_result", complete: true, run_id: "evidence", task_id: "task-0001", turn_id: "turn-1", session_id: "session-1", message_id: "message-1", call_id: "call-invalid-time", input_workspace_snapshot_id: "ws-before", workspace_snapshot_id: "ws-after", causal_parent_id: parent, produced_at: "not-a-timestamp" },
      },
    })
    assert.equal(invalidTimestamp.ok, false)
    if (!invalidTimestamp.ok) assert.equal(invalidTimestamp.code, "EVIDENCE_TIMESTAMP_INVALID")
    const beforeDelivery = compiler.admitEvidence({
      runId: "evidence",
      evidence: {
        evidenceId: "ev-before-delivery",
        boundaryInputIdentity: "input-2",
        payload: { kind: "tool_result", complete: true, run_id: "evidence", task_id: "task-0001", turn_id: "turn-1", session_id: "session-1", message_id: "message-1", call_id: "call-before-delivery", input_workspace_snapshot_id: "ws-before", workspace_snapshot_id: "ws-after", causal_parent_id: parent, produced_at: "1970-01-01T00:00:00.000Z" },
      },
    })
    assert.equal(beforeDelivery.ok, false)
    if (!beforeDelivery.ok) assert.equal(beforeDelivery.code, "EVIDENCE_BEFORE_DELIVERY")
    const stale = compiler.admitEvidence({
      runId: "evidence",
      evidence: {
        evidenceId: "ev-stale",
        boundaryInputIdentity: "input-2",
        payload: { kind: "tool_result", complete: true, run_id: "evidence", task_id: "task-0001", turn_id: "turn-1", session_id: "session-1", message_id: "message-1", call_id: "call-1", input_workspace_snapshot_id: "ws-before", workspace_snapshot_id: "ws-after", causal_parent_id: "evidence:1", produced_at: evidenceProducedAt() },
      },
    })
    assert.equal(stale.ok, false)
    if (!stale.ok) assert.equal(stale.code, "EVIDENCE_CAUSAL_PARENT_STALE")
    const crossTask = compiler.admitEvidence({
      runId: "evidence",
      evidence: {
        evidenceId: "ev-cross-task",
        boundaryInputIdentity: "input-2",
        payload: { kind: "tool_result", complete: true, run_id: "evidence", task_id: "task-other", turn_id: "turn-1", session_id: "session-1", message_id: "message-1", call_id: "call-1", input_workspace_snapshot_id: "ws-before", workspace_snapshot_id: "ws-after", causal_parent_id: parent, produced_at: evidenceProducedAt() },
      },
    })
    assert.equal(crossTask.ok, false)
    if (!crossTask.ok) assert.equal(crossTask.code, "EVIDENCE_TASK_MISMATCH")
    const unknownKind = compiler.admitEvidence({
      runId: "evidence",
      evidence: {
        evidenceId: "ev-unknown",
        boundaryInputIdentity: "input-2",
        payload: { kind: "unknown_source", complete: true, run_id: "evidence", task_id: "task-0001", turn_id: "turn-1", input_workspace_snapshot_id: "ws-before", workspace_snapshot_id: "ws-after", causal_parent_id: parent, produced_at: evidenceProducedAt() },
      },
    })
    assert.equal(unknownKind.ok, false)
    if (!unknownKind.ok) assert.equal(unknownKind.code, "EVIDENCE_KIND_FORBIDDEN")
    const admitted = compiler.admitEvidence({
      runId: "evidence",
      evidence: {
        evidenceId: "ev-1",
        boundaryInputIdentity: "input-2",
        payload: {
          kind: "tool_result",
          complete: true,
          run_id: "evidence",
          task_id: "task-0001",
          turn_id: "turn-1",
          session_id: "session-1",
          message_id: "message-1",
          call_id: "call-1",
          input_workspace_snapshot_id: "ws-before",
          workspace_snapshot_id: "ws-after",
          causal_parent_id: parent,
          produced_at: evidenceProducedAt(),
        },
      },
    })
    assert.equal(admitted.ok, true)
    const second = await prepare(compiler, "evidence", "input-2", "Check the parser.")
    assert.ok(seenEvidence.some((item) => (item as { id?: string }).id === "ev-1"))
    finish(compiler, second)
    const conflict = compiler.admitEvidence({
      runId: "evidence",
      evidence: {
        evidenceId: "ev-1",
        boundaryInputIdentity: "input-3",
        payload: {
          kind: "tool_result",
          complete: true,
          result: "different",
          run_id: "evidence",
          task_id: "task-0001",
          turn_id: "turn-1",
          session_id: "session-1",
          message_id: "message-1",
          call_id: "call-1",
          input_workspace_snapshot_id: "ws-before",
          workspace_snapshot_id: "ws-after",
          causal_parent_id: parent,
          produced_at: evidenceProducedAt(),
        },
      },
    })
    assert.equal(conflict.ok, false)
    if (!conflict.ok) assert.equal(conflict.code, "EVIDENCE_IDENTITY_CONTENT_CONFLICT")
  })

  it("requires complete exact readback data and matching reconciliation identity", async () => {
    const { compiler } = makeCompiler((request) => createTaskResponse(request))
    const prepared = await prepare(compiler, "strict-delivery", "input-1", "Build the parser.")
    const missingReadback = compiler.recordDelivery({
      runId: prepared.runId,
      inputIdentity: prepared.inputIdentity,
      artifactVersion: prepared.artifactVersion,
      expectedDigest: prepared.commit.compiledIntent.digest,
      readbackDigest: prepared.commit.compiledIntent.digest,
      status: "confirmed",
    })
    assert.equal(missingReadback.ok, false)
    assert.equal(missingReadback.code, "DELIVERY_READBACK_REQUIRED")

    const attemptId = finish(compiler, prepared)
    const wrongIdentity = compiler.recordDelivery({
      runId: prepared.runId,
      inputIdentity: "other-input",
      attemptId,
      reconciliation: { terminal: true },
    })
    assert.equal(wrongIdentity.ok, false)
    assert.equal(wrongIdentity.code, "DELIVERY_INPUT_MISMATCH")
  })

  it("rejects a source payload digest that does not match the raw input", async () => {
    const { compiler, calls } = makeCompiler((request) => createTaskResponse(request))
    const result = await compiler.prepareTurn({
      runId: "source-digest",
      input: {
        inputIdentity: "input-1",
        raw: "Build the parser.",
        source: { payload_digest: `sha256:${"0".repeat(64)}` },
      },
    })
    assert.equal(result.ok, false)
    if (!result.ok) assert.equal(result.code, "INPUT_SOURCE_DIGEST_INVALID")
    assert.equal(calls(), 0)
  })

  it("checks execution evidence against the latest delivery source when one user input is reused across sessions", async () => {
    const { compiler } = makeCompiler((request) => createTaskResponse(request))
    const sourceA = {
      run_id: "evidence-multi-session",
      turn_id: "user-turn-1",
      session_id: "session-a",
      message_id: "message-a",
      stage_id: "coding",
      path_id: "main",
      round: 1,
      workspace_snapshot_id: "snapshot-a-before",
    }
    const first = await compiler.prepareTurn({
      runId: "evidence-multi-session",
      input: { inputIdentity: "input-shared", raw: "Build the parser.", source: sourceA },
    })
    assert.equal(first.ok, true)
    if (!first.ok) return
    const firstDelivery = compiler.recordDelivery({
      runId: first.runId,
      inputIdentity: first.inputIdentity,
      artifactVersion: first.artifactVersion,
      expectedDigest: first.commit.compiledIntent.digest,
      expectedRenderedDigest: first.commit.renderedText.digest,
      readbackDigest: first.commit.compiledIntent.digest,
      readbackRenderedDigest: first.commit.renderedText.digest,
      status: "confirmed",
      metadata: { source: sourceA },
    })
    assert.equal(firstDelivery.ok, true)
    assert.ok(firstDelivery.attempt)
    compiler.recordDelivery({
      runId: first.runId,
      inputIdentity: first.inputIdentity,
      attemptId: firstDelivery.attempt.attemptId,
      reconciliation: { terminal: true },
    })

    const sourceB = {
      run_id: "evidence-multi-session",
      turn_id: "user-turn-1",
      session_id: "session-b",
      message_id: "message-b",
      stage_id: "coding",
      path_id: "main",
      round: 2,
      workspace_snapshot_id: "snapshot-b-before",
    }
    const reused = await compiler.prepareTurn({
      runId: "evidence-multi-session",
      input: { inputIdentity: "input-shared", raw: "Build the parser.", source: sourceB },
    })
    assert.equal(reused.ok, true)
    if (!reused.ok) return
    assert.equal(reused.status, "reused")
    const latestDelivery = compiler.recordDelivery({
      runId: reused.runId,
      inputIdentity: reused.inputIdentity,
      artifactVersion: reused.artifactVersion,
      expectedDigest: reused.commit.compiledIntent.digest,
      expectedRenderedDigest: reused.commit.renderedText.digest,
      readbackDigest: reused.commit.compiledIntent.digest,
      readbackRenderedDigest: reused.commit.renderedText.digest,
      status: "confirmed",
      metadata: { source: sourceB },
    })
    assert.equal(latestDelivery.ok, true)
    assert.ok(latestDelivery.attempt)
    compiler.recordDelivery({
      runId: reused.runId,
      inputIdentity: reused.inputIdentity,
      attemptId: latestDelivery.attempt.attemptId,
      reconciliation: { terminal: true },
    })

    const selectedTaskId = reused.artifact.selected_task?.id
    assert.ok(selectedTaskId)
    for (const [evidenceId, override] of [
      ["wrong-stage", { stage_id: "other-stage" }],
      ["wrong-round", { round: 99 }],
      ["wrong-input-snapshot", { input_workspace_snapshot_id: "other-snapshot" }],
    ] as const) {
      const rejected = compiler.admitEvidence({
        runId: reused.runId,
        evidence: {
          evidenceId,
          boundaryInputIdentity: "input-2",
          payload: Object.assign({
            kind: "tool_result",
            complete: true,
            run_id: reused.runId,
            task_id: selectedTaskId,
            turn_id: sourceB.turn_id,
            session_id: sourceB.session_id,
            message_id: sourceB.message_id,
            call_id: `call-${evidenceId}`,
            stage_id: sourceB.stage_id,
            path_id: sourceB.path_id,
            round: sourceB.round,
            input_workspace_snapshot_id: sourceB.workspace_snapshot_id,
            workspace_snapshot_id: "snapshot-b-after",
            causal_parent_id: latestDelivery.attempt.attemptId,
            produced_at: evidenceProducedAt(),
          }, override),
        },
      })
      assert.equal(rejected.ok, false)
      if (!rejected.ok) assert.equal(rejected.code, "EVIDENCE_SOURCE_MISMATCH")
    }
    const admitted = compiler.admitEvidence({
      runId: reused.runId,
      evidence: {
        evidenceId: "evidence-session-b",
        boundaryInputIdentity: "input-2",
        payload: {
          kind: "tool_result",
          complete: true,
          run_id: reused.runId,
          task_id: selectedTaskId,
          turn_id: sourceB.turn_id,
          session_id: sourceB.session_id,
          message_id: sourceB.message_id,
          call_id: "call-b",
          stage_id: sourceB.stage_id,
          path_id: sourceB.path_id,
          round: sourceB.round,
          input_workspace_snapshot_id: sourceB.workspace_snapshot_id,
          workspace_snapshot_id: "snapshot-b-after",
          causal_parent_id: latestDelivery.attempt.attemptId,
          produced_at: evidenceProducedAt(),
        },
      },
    })
    assert.equal(admitted.ok, true)
  })

  it("rejects undeclared evidence before it can enter the next model input", async () => {
    const { compiler } = makeCompiler((request) => createTaskResponse(request))
    const first = await prepare(compiler, "evidence-reject", "input-1", "Build the parser.")
    finish(compiler, first)
    const rejected = compiler.admitEvidence({
      runId: "evidence-reject",
      evidence: { evidenceId: "ev-missing", boundaryInputIdentity: "input-2", payload: { run_id: "evidence-reject" } },
    })
    assert.equal(rejected.ok, false)
    if (!rejected.ok) assert.equal(rejected.code, "EVIDENCE_KIND_REQUIRED")
    const next = await prepare(compiler, "evidence-reject", "input-2", "Continue.")
    assert.equal(next.ok, true)
})

  it("passes the current workspace snapshot into deterministic status validation", async () => {
    const { compiler } = makeCompiler((request) => {
      if (request.input_identity === "input-2") {
        const state = request.current_state as { selected_task_id: string }
        return JSON.stringify({
          base_state_version: request.base_state_version,
          input_identity: request.input_identity,
          input_digest: request.input_digest,
          operations: [{ operation: "record_execution_status", task_id: state.selected_task_id, status: "verified_complete", evidence_ids: ["ev-pass"], workspace_snapshot_id: "ws-1" }],
        })
      }
      return createTaskResponse(request)
    })
    const first = await prepare(compiler, "snapshot", "input-1", "Build the parser.")
    const parent = finish(compiler, first)
    const admitted = compiler.admitEvidence({
      runId: "snapshot",
      evidence: {
        evidenceId: "ev-pass",
        boundaryInputIdentity: "input-2",
        payload: {
          kind: "verifier_pass",
          complete: true,
          compiler_visible: true,
          predeclared: true,
          exact_workspace_snapshot: true,
          input_workspace_snapshot_id: "ws-0",
          workspace_snapshot_id: "ws-1",
          run_id: "snapshot",
          task_id: "task-0001",
          turn_id: "turn-1",
          causal_parent_id: parent,
          produced_at: evidenceProducedAt(),
        },
      },
    })
    assert.equal(admitted.ok, true)
    const second = await prepareWithSnapshot(compiler, "snapshot", "input-2", "Check the parser.", "ws-1")
    assert.equal(second.ok, true)
})

  it("exposes recovery actions without allowing delivery or executor data to mutate intent", async () => {
    const { compiler, store } = makeCompiler((request) => createTaskResponse(request))
    const first = await prepare(compiler, "recover", "input-1", "Build the parser.")
    assert.equal(compiler.recover({ runId: "recover" }).action, "delivery")
    const before = store.openRun("recover").replay().current.state
    const delivery = compiler.recordDelivery({
      runId: "recover",
      inputIdentity: first.inputIdentity,
      artifactVersion: first.artifactVersion,
      expectedDigest: first.commit.compiledIntent.digest,
      expectedRenderedDigest: first.commit.renderedText.digest,
      readbackDigest: first.commit.compiledIntent.digest,
      readbackRenderedDigest: first.commit.renderedText.digest,
      status: "confirmed",
      metadata: { executorResult: { next_private_state: { shouldNotBeApplied: true } } },
    })
    assert.equal(delivery.recovery.action, "reconcile")
    const after = store.openRun("recover").replay().current.state
    assert.deepEqual(after, before)
    assert.equal(compiler.recover({ runId: "recover" }).action, "reconcile")
    assert.ok(delivery.attempt)
    const reconciled = compiler.recordDelivery({ runId: "recover", inputIdentity: first.inputIdentity, attemptId: delivery.attempt!.attemptId, reconciliation: { terminal: true, result: { executor: "reported" } } })
    assert.equal(reconciled.recovery.action, "complete")
})

  it("reports a raw-input recovery point before model work", async () => {
    let fail = true
    const { compiler, calls } = makeCompiler((request) => {
      if (fail) throw new Error("temporary transport outage")
      return createTaskResponse(request)
    })
    const stopped = await compiler.prepareTurn({ runId: "raw-recovery", input: { inputIdentity: "input-1", raw: "Build the parser." } })
    assert.equal(stopped.ok, false)
    assert.equal(compiler.recover({ runId: "raw-recovery" }).action, "model")
    fail = false
    const retried = await prepare(compiler, "raw-recovery", "input-1", "Build the parser.")
    assert.equal(retried.ok, true)
    assert.equal(calls(), 2)
  })

  it("fixes projection size limits in the run manifest", async () => {
    const storeDirectory = temporaryDirectory()
    const store = new CompilerStore({ storeDir: storeDirectory })
    let calls = 0
    const model = createCompilerModel(async (request) => {
      calls += 1
      return createTaskResponse(request)
    })
    const firstCompiler = createIntentCompiler({
      store,
      model,
      projection: { max_artifact_bytes: 1_000_000, max_rendered_bytes: 1_000_000 },
    })
    const first = await firstCompiler.prepareTurn({
      runId: "fixed-limits",
      input: { inputIdentity: "input-1", raw: "Build the parser." },
    })
    assert.equal(first.ok, true)
    const manifest = JSON.parse(readFileSync(join(storeDirectory, "runs", "fixed-limits", "manifest.json"), "utf8")) as Record<string, unknown>
    assert.deepEqual(manifest, {
      schema: "compiler-run/0.1",
      runId: "fixed-limits",
      maxArtifactBytes: 1_000_000,
      maxRenderedBytes: 1_000_000,
    })

    const changedCompiler = createIntentCompiler({
      store,
      model,
      projection: { max_artifact_bytes: 2_000_000, max_rendered_bytes: 1_000_000 },
    })
    const rejected = await changedCompiler.prepareTurn({
      runId: "fixed-limits",
      input: { inputIdentity: "input-2", raw: "Continue." },
    })
    assert.equal(rejected.ok, false)
    if (!rejected.ok) assert.equal(rejected.code, "RUN_CONFIGURATION_CONFLICT")
    assert.equal(calls, 1)
  })
})
