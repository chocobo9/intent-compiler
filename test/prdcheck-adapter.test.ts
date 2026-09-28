import assert from "node:assert/strict"
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import test from "node:test"
import {
  createPrdcheckAdapter,
  PrdcheckAdapterError,
  type PrdcheckAuditInput,
  type PrdcheckEvidenceSource,
  type PrdcheckHostEvidence,
  type PrdcheckHostInput,
  type PrdcheckTurnIdentity,
} from "../src/adapters/prdcheck.js"

const adapter = createPrdcheckAdapter()
const temporaryDirectories: string[] = []

function temporaryDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), "prdcheck-adapter-"))
  temporaryDirectories.push(directory)
  return directory
}

test.after(() => {
  for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

function turnIdentity(overrides: Partial<PrdcheckTurnIdentity> = {}): PrdcheckTurnIdentity {
  return {
    runId: "run-1",
    stageId: "main-coding",
    pathId: "main",
    round: 1,
    turnId: "turn-1",
    sessionId: "session-1",
    messageId: "message-1",
    taskOccurrenceId: "task-0001",
    workspaceSnapshotId: "snapshot-1",
    producedAt: "2026-09-17T12:00:00.000Z",
    ...overrides,
  }
}

function hostInput(overrides: Partial<PrdcheckHostInput> = {}): PrdcheckHostInput {
  return {
    source: "initial_requirement",
    inputIdentity: "input-1",
    text: "Build the parser.",
    identity: turnIdentity(),
    ...overrides,
  }
}

function hostEvidence(source: PrdcheckEvidenceSource, overrides: Partial<PrdcheckHostEvidence> = {}): PrdcheckHostEvidence {
  const verifier = source === "build_result" || source === "test_result" || source === "hidden_verifier_result"
  return {
    source,
    evidenceId: `evidence-${source}`,
    boundaryInputIdentity: "input-next",
    identity: {
      ...turnIdentity(),
      pathId: "main",
      compilerTaskId: "task-0001",
      resultWorkspaceSnapshotId: "snapshot-2",
      causalParentId: "delivery:run-1:12",
      ...(source === "tool_result" ? { callId: "call-1" } : {}),
    },
    payload: { status: "ok", source },
    outcome: source === "tool_result" ? "result" : verifier ? "pass" : undefined,
    complete: true,
    ...(verifier ? { predeclared: true, compilerVisible: true, exactWorkspaceSnapshot: true } : {}),
    ...overrides,
  }
}

function expectCode(action: () => unknown, code: string): void {
  assert.throws(action, (error: unknown) => error instanceof PrdcheckAdapterError && error.code === code)
}

test("only initial requirements and explicit user updates create prepare-turn input", () => {
  for (const source of ["initial_requirement", "explicit_user_update"] as const) {
    const request = adapter.toPrepareTurnRequest(hostInput({ source }))
    assert.ok(request)
    assert.equal(request.runId, "run-1")
    assert.equal(request.input.inputIdentity, "input-1")
    assert.equal(request.input.raw, "Build the parser.")
    assert.deepEqual(request.input.parts, [{ type: "text", text: "Build the parser." }])
    assert.match(request.input.digest ?? "", /^sha256:[0-9a-f]{64}$/u)
    assert.equal(request.currentWorkspaceSnapshotId, "snapshot-1")
    const sourceRecord = request.input.source as Record<string, unknown>
    assert.equal(sourceRecord.source_category, source)
    assert.equal(sourceRecord.run_id, "run-1")
    assert.equal(sourceRecord.stage_id, "main-coding")
    assert.equal(sourceRecord.path_id, "main")
    assert.equal(sourceRecord.session_id, "session-1")
    assert.equal(sourceRecord.message_id, "message-1")
    assert.equal(sourceRecord.task_occurrence_id, "task-0001")
    assert.equal(sourceRecord.workspace_snapshot_id, "snapshot-1")
    assert.equal(sourceRecord.payload_digest, request.input.digest)
  }
})

test("generated harness, default skip, workflow, and session state never become user intent", () => {
  for (const source of [
    "generated_harness_instruction",
    "default_skip_instruction",
    "workflow_state",
    "session_state",
  ] as const) {
    assert.equal(adapter.toPrepareTurnRequest(hostInput({ source })), undefined)
  }
})

test("tool, build, test, diff, and executor statement sources produce candidate evidence only", () => {
  const cases: Array<[PrdcheckEvidenceSource, string]> = [
    ["tool_result", "tool_result"],
    ["build_result", "check_pass"],
    ["test_result", "test_pass"],
    ["workspace_diff", "workspace_diff"],
    ["executor_statement", "executor_statement"],
  ]
  for (const [source, expectedKind] of cases) {
    const candidate = adapter.toEvidenceCandidate(hostEvidence(source))
    assert.equal(candidate.status, "candidate")
    assert.equal(candidate.request.runId, "run-1")
    assert.equal(candidate.request.evidence.boundaryInputIdentity, "input-next")
    assert.match(candidate.request.evidence.digest ?? "", /^sha256:[0-9a-f]{64}$/u)
    const payload = candidate.request.evidence.payload as Record<string, unknown>
    assert.equal(payload.kind, expectedKind)
    assert.equal(payload.run_id, "run-1")
    assert.equal(payload.stage_id, "main-coding")
    assert.equal(payload.path_id, "main")
    assert.equal(payload.round, 1)
    assert.equal(payload.session_id, "session-1")
    assert.equal(payload.message_id, "message-1")
    assert.equal(payload.task_id, "task-0001")
    assert.equal(payload.task_occurrence_id, "task-0001")
    assert.equal(payload.turn_id, "turn-1")
    assert.equal(payload.input_workspace_snapshot_id, "snapshot-1")
    assert.equal(payload.workspace_snapshot_id, "snapshot-2")
    assert.equal(payload.causal_parent_id, "delivery:run-1:12")
    assert.equal(payload.produced_at, "2026-09-17T12:00:00.000Z")
    assert.match(String(payload.payload_digest), /^sha256:[0-9a-f]{64}$/u)
    if (source === "tool_result") assert.equal(payload.call_id, "call-1")
  }
})

test("hidden verifier data is rejected unless it was predeclared and Compiler-visible", () => {
  expectCode(
    () => adapter.toEvidenceCandidate(hostEvidence("hidden_verifier_result", { predeclared: false })),
    "EVIDENCE_VERIFIER_NOT_PREDECLARED",
  )
  expectCode(
    () => adapter.toEvidenceCandidate(hostEvidence("hidden_verifier_result", { compilerVisible: false })),
    "EVIDENCE_VERIFIER_NOT_VISIBLE",
  )
  const admittedCandidate = adapter.toEvidenceCandidate(hostEvidence("hidden_verifier_result"))
  assert.equal((admittedCandidate.request.evidence.payload as Record<string, unknown>).kind, "verifier_pass")
})

test("missing snapshot, causal, or source-specific call identity rejects candidate evidence", () => {
  expectCode(
    () => adapter.toEvidenceCandidate(hostEvidence("workspace_diff", { identity: { ...hostEvidence("workspace_diff").identity, workspaceSnapshotId: "" } })),
    "IDENTITY_REQUIRED",
  )
  expectCode(
    () => adapter.toEvidenceCandidate(hostEvidence("workspace_diff", { identity: { ...hostEvidence("workspace_diff").identity, resultWorkspaceSnapshotId: "" } })),
    "IDENTITY_REQUIRED",
  )
  expectCode(
    () => adapter.toEvidenceCandidate(hostEvidence("executor_statement", { identity: { ...hostEvidence("executor_statement").identity, causalParentId: "" } })),
    "IDENTITY_REQUIRED",
  )
  expectCode(
    () => adapter.toEvidenceCandidate(hostEvidence("tool_result", { identity: { ...hostEvidence("tool_result").identity, callId: undefined } })),
    "EVIDENCE_CALL_ID_REQUIRED",
  )
  expectCode(
    () => adapter.toEvidenceCandidate(hostEvidence("executor_statement", { identity: { ...hostEvidence("executor_statement").identity, pathId: "" } })),
    "IDENTITY_REQUIRED",
  )
  expectCode(
    () => adapter.toEvidenceCandidate(hostEvidence("executor_statement", { identity: { ...hostEvidence("executor_statement").identity, producedAt: "not-a-timestamp" } })),
    "TIMESTAMP_INVALID",
  )
})

test("parallel stage, path, session, turn, and task occurrence identities remain distinct", () => {
  const first = adapter.toPrepareTurnRequest(hostInput())
  const second = adapter.toPrepareTurnRequest(hostInput({
    inputIdentity: "input-2",
    identity: turnIdentity({
      stageId: "cmp1-coding",
      pathId: "cmp1",
      turnId: "turn-2",
      sessionId: "session-2",
      messageId: "message-2",
      taskOccurrenceId: "task-0002",
      workspaceSnapshotId: "snapshot-2",
    }),
  }))
  assert.ok(first && second)
  assert.notEqual(first.input.inputIdentity, second.input.inputIdentity)
  const firstSource = first.input.source as Record<string, unknown>
  const secondSource = second.input.source as Record<string, unknown>
  assert.deepEqual(
    [firstSource.stage_id, firstSource.path_id, firstSource.session_id, firstSource.turn_id, firstSource.task_occurrence_id],
    ["main-coding", "main", "session-1", "turn-1", "task-0001"],
  )
  assert.deepEqual(
    [secondSource.stage_id, secondSource.path_id, secondSource.session_id, secondSource.turn_id, secondSource.task_occurrence_id],
    ["cmp1-coding", "cmp1", "session-2", "turn-2", "task-0002"],
  )
})

test("task occurrence provenance is preserved without transferring task-scoped Authority", () => {
  const taskOne = adapter.toPrepareTurnRequest(hostInput({ identity: turnIdentity({ taskOccurrenceId: "task-0001" }) }))
  const taskTwo = adapter.toPrepareTurnRequest(hostInput({
    inputIdentity: "input-task-2",
    identity: turnIdentity({ taskOccurrenceId: "task-0002", turnId: "turn-2", messageId: "message-2" }),
  }))
  assert.ok(taskOne && taskTwo)
  assert.equal((taskOne.input.source as Record<string, unknown>).task_occurrence_id, "task-0001")
  assert.equal((taskTwo.input.source as Record<string, unknown>).task_occurrence_id, "task-0002")
  assert.equal("authority" in (taskOne.input.source as Record<string, unknown>), false)
  assert.equal("authority" in (taskTwo.input.source as Record<string, unknown>), false)
})

test("isolated arm rejects raw input inside the executor workspace", () => {
  const root = temporaryDirectory()
  const executor = join(root, "executor")
  const rawInside = join(executor, "raw", "requirement.md")
  const rawOutside = join(root, "compiler-input", "requirement.md")
  expectCode(
    () => adapter.assertIsolatedArm({ rawInputPath: rawInside, executorWorkspacePath: executor }),
    "RAW_INPUT_VISIBLE_TO_EXECUTOR",
  )
  assert.doesNotThrow(() => adapter.assertIsolatedArm({ rawInputPath: rawOutside, executorWorkspacePath: executor }))
})

test("audit envelope is opaque and contains only the allowed harness fields", () => {
  const input = {
    arm: "compiler",
    artifactType: "compiled-intent",
    turnIdentity: "turn-1",
    version: 4,
    provenanceDigest: `sha256:${"a".repeat(64)}`,
    size: 128,
    deliveryStatus: "confirmed" as const,
    reference: "delivery:run-1:12",
    compiledIntent: { requirements: ["must-not-leak"] },
    renderedText: "must-not-leak",
  } as PrdcheckAuditInput & { compiledIntent: unknown; renderedText: string }
  const envelope = adapter.auditEnvelope(input)
  assert.deepEqual(Object.keys(envelope), [
    "arm",
    "artifactType",
    "turnIdentity",
    "version",
    "provenanceDigest",
    "size",
    "deliveryStatus",
    "reference",
  ])
  assert.equal("compiledIntent" in envelope, false)
  assert.equal("renderedText" in envelope, false)
  assert.equal(Object.isFrozen(envelope), true)
})

test("Compiler core has no prdcheck import, path, or type dependency", () => {
  const coreDir = resolve("src/core")
  for (const name of readdirSync(coreDir).filter((item) => item.endsWith(".ts"))) {
    const source = readFileSync(join(coreDir, name), "utf8")
    assert.doesNotMatch(source, /adapters[\\/]prdcheck|sdd-loop-prdcheck|Prdcheck/u, name)
  }
})
