import assert from "node:assert/strict"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import { CompilerStore } from "../src/core/compiler-store.js"
import {
  createIntentCompiler,
  type PrepareTurnSuccess,
} from "../src/core/intent-compiler.js"
import {
  createCompilerModel,
  type CompilerModelRequest,
} from "../src/model/compiler-model.js"
import { admitPrdcheckEvidence } from "../src/runtime/prdcheck-evidence.js"
import {
  CurrentCompiledIntentError,
  readCurrentCompiledIntent,
} from "../src/runtime/current-compiled-intent.js"

const temporaryDirectories: string[] = []

function temporaryDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), "prdcheck-evidence-"))
  temporaryDirectories.push(directory)
  return directory
}

test.after(() => {
  for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

test("prdcheck evidence is validated and saved for the named next input without a model session", async () => {
  const root = temporaryDirectory()
  const compilerStoreDirectory = join(root, "compiler")
  const observerStoreDirectory = join(root, "observer")
  const executorWorkspaceDirectory = join(root, "workspace")
  const store = new CompilerStore({
    storeDir: compilerStoreDirectory,
    observerStoreDir: observerStoreDirectory,
    executorWorkspaceDir: executorWorkspaceDirectory,
  })
  let modelCalls = 0
  const model = createCompilerModel(async (request) => {
    modelCalls += 1
    return createTaskResponse(request)
  })
  const compiler = createIntentCompiler({ store, model })
  const prepared = await compiler.prepareTurn({
    runId: "run-evidence",
    input: {
      inputIdentity: "input-1",
      raw: "Build the parser.",
      source: {
        run_id: "run-evidence",
        turn_id: "turn-1",
        session_id: "session-1",
        message_id: "message-1",
      },
    },
  })
  assert.equal(prepared.ok, true)
  assert.equal(modelCalls, 1)
  if (!prepared.ok) return
  const attemptId = finish(compiler, prepared)
  const current = readCurrentCompiledIntent({
    compilerStoreDirectory,
    observerStoreDirectory,
    executorWorkspaceDirectory,
    runId: "run-evidence",
  })
  assert.equal(current.commit.inputIdentity, "input-1")
  assert.equal(current.artifact.artifact_digest, prepared.artifact.artifact_digest)
  const causalParentId = current.latestDeliveryAttemptId
  assert.equal(causalParentId, attemptId)
  assert.ok(causalParentId)
  const selectedTaskId = current.artifact.selected_task?.id
  assert.ok(selectedTaskId)

  const evidence = {
    source: "test_result" as const,
    evidenceId: "evidence-test-1",
    boundaryInputIdentity: "input-2",
    identity: {
      runId: "run-evidence",
      stageId: "testfix",
      pathId: "main",
      round: 1,
      turnId: "turn-1",
      sessionId: "session-1",
      messageId: "message-1",
      compilerTaskId: selectedTaskId,
      workspaceSnapshotId: "workspace-before-test",
      resultWorkspaceSnapshotId: "workspace-after-test",
      producedAt: new Date().toISOString(),
      causalParentId,
    },
    payload: { command: "npm test", exitCode: 0 },
    outcome: "pass" as const,
    complete: true,
    predeclared: true,
    compilerVisible: true,
    exactWorkspaceSnapshot: true,
  }

  const admitted = admitPrdcheckEvidence({
    compilerStoreDirectory,
    observerStoreDirectory,
    executorWorkspaceDirectory,
    evidence,
  })
  assert.equal(admitted.ok, true)
  assert.equal(modelCalls, 1)
  assert.equal(admitted.evidence?.boundaryInputIdentity, "input-2")
  assert.equal(admitted.evidence?.decision, "admitted")

  const duplicate = admitPrdcheckEvidence({
    compilerStoreDirectory,
    observerStoreDirectory,
    executorWorkspaceDirectory,
    evidence,
  })
  assert.equal(duplicate.ok, true)
  assert.equal(duplicate.evidence?.sequence, admitted.evidence?.sequence)
  assert.equal(
    store.openRun("run-evidence").history().filter((event) => event.type === "evidence.decision").length,
    1,
  )
})

test("current Compiled Intent read fails when the run has no commit", () => {
  const root = temporaryDirectory()
  const compilerStoreDirectory = join(root, "compiler")
  const observerStoreDirectory = join(root, "observer")
  const executorWorkspaceDirectory = join(root, "workspace")
  new CompilerStore({
    storeDir: compilerStoreDirectory,
    observerStoreDir: observerStoreDirectory,
    executorWorkspaceDir: executorWorkspaceDirectory,
  }).openRun("empty-run")

  assert.throws(
    () => readCurrentCompiledIntent({
      compilerStoreDirectory,
      observerStoreDirectory,
      executorWorkspaceDirectory,
      runId: "empty-run",
    }),
    (error: unknown) => error instanceof CurrentCompiledIntentError && error.code === "COMMIT_NOT_FOUND",
  )
})

function createTaskResponse(request: CompilerModelRequest): string {
  const source = {
    channel: "user" as const,
    input_identity: request.input_identity,
    input_digest: request.input_digest,
    start: 0,
    end: request.input_text.length,
  }
  return JSON.stringify({
    base_state_version: request.base_state_version,
    input_identity: request.input_identity,
    input_digest: request.input_digest,
    operations: [
      { operation: "create_task", local_ref: "task-local", description: `[LLM-PROTOTYPE] ${request.input_text}`, source },
      { operation: "select_task", task_id: "task-local", source },
    ],
  })
}

function finish(compiler: ReturnType<typeof createIntentCompiler>, prepared: PrepareTurnSuccess): string {
  const delivery = compiler.recordDelivery({
    runId: prepared.runId,
    inputIdentity: prepared.inputIdentity,
    artifactVersion: prepared.artifactVersion,
    expectedDigest: prepared.commit.compiledIntent.digest,
    expectedRenderedDigest: prepared.commit.renderedText.digest,
    readbackDigest: prepared.commit.compiledIntent.digest,
    readbackRenderedDigest: prepared.commit.renderedText.digest,
    status: "confirmed",
  })
  assert.equal(delivery.ok, true)
  assert.ok(delivery.attempt)
  const attemptId = delivery.attempt.attemptId
  const reconciled = compiler.recordDelivery({
    runId: prepared.runId,
    inputIdentity: prepared.inputIdentity,
    attemptId,
    reconciliation: { terminal: true },
  })
  assert.equal(reconciled.ok, true)
  return attemptId
}
