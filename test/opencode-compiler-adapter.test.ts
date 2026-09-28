import assert from "node:assert/strict"
import { mkdtempSync, readdirSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import test from "node:test"
import { sha256, stableJson } from "../src/observer/codec.js"
import { createCompilerModel, type CompilerModelRequest } from "../src/model/compiler-model.js"
import { CompilerStore } from "../src/core/compiler-store.js"
import { createIntentCompiler, type IntentCompiler } from "../src/core/intent-compiler.js"
import {
  createOpenCodeAdapter,
  ExperimentRuntimePlugin,
  OpenCodeAdapterError,
  type OpenCodeAdapterHooks,
  type OpenCodeObserver,
  type OpenCodeTurnIdentity,
} from "../src/adapters/opencode.js"

const temporaryDirectories: string[] = []

function temporaryDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), "opencode-adapter-"))
  temporaryDirectories.push(directory)
  return directory
}

test.after(() => {
  for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

function modelProposal(request: CompilerModelRequest): string {
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

function observerSpy(
  log: string[],
  scheduleResult = true,
  rawTexts?: string[],
  expectedTexts?: string[],
): OpenCodeObserver {
  return {
    captureRawInput: (_input, output) => {
      log.push("observer.raw")
      rawTexts?.push(output.parts.filter((part) => part.type === "text").map((part) => part.text ?? "").join("\n"))
      return true
    },
    expectDelivery: (_input, output) => {
      log.push("observer.expected")
      expectedTexts?.push(output.parts.filter((part) => part.type === "text").map((part) => part.text ?? "").join("\n"))
      return true
    },
    observeEvent: (event) => {
      log.push(`observer.event:${event.type ?? "unknown"}`)
      return true
    },
    modelRequested: () => {
      log.push("observer.model")
      return true
    },
    scheduleReconciliation: async () => {
      log.push("observer.reconcile")
      return scheduleResult
    },
  }
}

function compilerHarness(
  readback: () => unknown,
  resolveIdentity?: (input: { sessionID: string; messageID?: string }, output: { message?: { id?: string } }) => OpenCodeTurnIdentity,
  observedTexts?: { raw: string[]; expected: string[] },
  scheduleResult = true,
): {
  hooks: OpenCodeAdapterHooks
  compiler: IntentCompiler
  compilerStore: CompilerStore
  calls: Array<{ operation: string; request?: Record<string, unknown> }>
  log: string[]
  part: { id: string; type: "text"; text: string; sessionID: string; messageID: string }
  client: { session: { messages: () => Promise<unknown> } }
} {
  const root = temporaryDirectory()
  const compilerStore = new CompilerStore({ storeDir: join(root, "compiler") })
  const model = createCompilerModel(async (request) => modelProposal(request))
  const realCompiler = createIntentCompiler({ store: compilerStore, model })
  const calls: Array<{ operation: string; request?: Record<string, unknown> }> = []
  const compiler: IntentCompiler = {
    prepareTurn: async (request) => {
      calls.push({ operation: "prepareTurn", request: request as unknown as Record<string, unknown> })
      return realCompiler.prepareTurn(request)
    },
    recordDelivery: (request) => {
      calls.push({ operation: "recordDelivery", request: request as unknown as Record<string, unknown> })
      return realCompiler.recordDelivery(request)
    },
    admitEvidence: (request) => realCompiler.admitEvidence(request),
    recover: (request) => realCompiler.recover(request),
  }
  const log: string[] = []
  const part = { id: "part-1", type: "text" as const, text: "Build the parser.", sessionID: "session-1", messageID: "message-1" }
  const client = { session: { messages: async () => readback() } }
  const adapter = createOpenCodeAdapter({
    arm: "compiler",
    client,
    observer: observerSpy(log, scheduleResult, observedTexts?.raw, observedTexts?.expected),
    compiler,
    resolveTurn: (input, output) => {
      log.push("turn.resolve")
      if (resolveIdentity) return resolveIdentity(input, output)
      return {
        runId: "run-adapter",
        inputIdentity: input.messageID ?? output.message?.id ?? "message-1",
        source: { source: "test", session_id: input.sessionID, message_id: input.messageID },
      }
    },
  })
  return { hooks: adapter.hooks(), compiler, compilerStore, calls, log, part, client }
}

function messageReadback(part: { id: string; type: "text"; text: string; sessionID: string; messageID: string }): unknown {
  return { data: [{ info: { id: part.messageID, sessionID: part.sessionID, role: "user" }, parts: [{ ...part }] }] }
}

async function prepareCompilerDelivery(harness: ReturnType<typeof compilerHarness>): Promise<void> {
  await harness.hooks["chat.message"](
    { sessionID: harness.part.sessionID, messageID: harness.part.messageID },
    { message: { id: harness.part.messageID }, parts: [harness.part] },
  )
}

async function expectGuard(action: Promise<void>, code: string): Promise<void> {
  await assert.rejects(action, (error: unknown) => error instanceof OpenCodeAdapterError && error.code === code)
}

test("compiler arm performs raw → prepare → mutate → expectation, then readback → confirm", async () => {
  let currentPart: { id: string; type: "text"; text: string; sessionID: string; messageID: string } | undefined
  const harness = compilerHarness(() => messageReadback(currentPart as typeof harness.part))
  currentPart = harness.part
  const originalPart = harness.part
  await prepareCompilerDelivery(harness)

  assert.equal(harness.part, originalPart)
  assert.notEqual(harness.part.text, "Build the parser.")
  assert.deepEqual(harness.log, ["observer.raw", "turn.resolve", "observer.expected"])

  await harness.hooks["chat.params"](
    { sessionID: "session-1", message: { id: "message-1" } },
    {},
  )
  assert.deepEqual(harness.calls.map((call) => call.operation), ["prepareTurn", "recordDelivery"])
  assert.equal(harness.calls[1]?.request?.status, "confirmed")
  const expectedPartDigest = `sha256:${sha256(stableJson([{ id: harness.part.id, text: harness.part.text }]))}`
  const current = harness.compilerStore.openRun("run-adapter").replay().current
  const commit = current.commit
  assert.ok(commit)
  const compiledIntentFileDigest = commit.compiledIntent.digest
  const renderedTextFileDigest = commit.renderedText.digest
  const compiledIntentArtifactDigest = (current.compiledIntent as { artifact_digest?: string } | undefined)?.artifact_digest
  assert.ok(compiledIntentArtifactDigest)
  assert.equal(harness.calls[1]?.request?.expectedDigest, compiledIntentFileDigest)
  assert.equal(harness.calls[1]?.request?.readbackDigest, compiledIntentFileDigest)
  assert.equal(harness.calls[1]?.request?.expectedRenderedDigest, renderedTextFileDigest)
  assert.equal(harness.calls[1]?.request?.readbackRenderedDigest, renderedTextFileDigest)
  assert.equal(compiledIntentFileDigest, `sha256:${sha256(stableJson(current.compiledIntent))}`)
  assert.equal(renderedTextFileDigest, `sha256:${sha256(harness.part.text)}`)
  assert.notEqual(compiledIntentFileDigest, compiledIntentArtifactDigest)
  assert.deepEqual(harness.calls[1]?.request?.metadata, {
    expectedPartDigest,
    readbackPartDigest: expectedPartDigest,
    source: { source: "test", session_id: "session-1", message_id: "message-1" },
  })
  assert.notEqual(expectedPartDigest, harness.calls[1]?.request?.expectedDigest)
  assert.notEqual(expectedPartDigest, harness.calls[1]?.request?.expectedRenderedDigest)
  assert.deepEqual(harness.log, ["observer.raw", "turn.resolve", "observer.expected", "observer.model"])
})

test("compiler arm keeps harness and user channels separate across system and user hooks", async () => {
  const rawTexts: string[] = []
  const expectedTexts: string[] = []
  const harnessText = "Harness instructions for this turn."
  const userText = "User requirement for this turn."
  let currentPart: ReturnType<typeof compilerHarness>["part"] | undefined
  const harness = compilerHarness(
    () => messageReadback(currentPart as ReturnType<typeof compilerHarness>["part"]),
    (input) => ({
      runId: "run-harness",
      inputIdentity: input.messageID ?? "harness-message",
      userInputText: userText,
      harnessSystemText: harnessText,
      source: { source: "test", session_id: input.sessionID, message_id: input.messageID },
    }),
    { raw: rawTexts, expected: expectedTexts },
  )
  harness.part.text = harnessText
  currentPart = harness.part

  await prepareCompilerDelivery(harness)
  assert.equal(rawTexts[0], harnessText)
  assert.equal((harness.calls[0]?.request?.input as { raw?: string } | undefined)?.raw, userText)
  assert.deepEqual(
    (harness.calls[0]?.request?.input as { parts?: unknown[] } | undefined)?.parts,
    [{ type: "text", text: userText }],
  )
  assert.equal(harness.part.text === harnessText, false)
  assert.equal(expectedTexts[0] === harness.part.text, true)

  const systemOutput = { system: ["fixed OpenCode system prompt"] }
  await harness.hooks["experimental.chat.system.transform"]({ sessionID: "session-1" }, systemOutput)
  assert.deepEqual(systemOutput.system, ["fixed OpenCode system prompt", harnessText])

  await harness.hooks["chat.params"]({ sessionID: "session-1", message: { id: "message-1" } }, {})
  assert.equal(harness.calls[1]?.request?.status, "confirmed")
  assert.equal(expectedTexts[0] === harnessText, false)
})

test("default resolver reuses explicit input identity while delivery metadata stays target-specific", async () => {
  const fakeArtifact = {}
  const fakeRenderedText = `${JSON.stringify(fakeArtifact, null, 2)}\n`
  const fakeCompiledDigest = `sha256:${sha256(stableJson(fakeArtifact))}`
  const fakeRenderedDigest = `sha256:${sha256(fakeRenderedText)}`
  const registrations = new Map<string, Record<string, unknown>>([
    [
      "session-a",
      {
        run_id: "run-shared",
        arm_id: "compiler",
        task_id: "task-a",
        turn_id: "1",
        session_id: "session-a",
        input_identity: "user-turn-shared",
        source_category: "initial_requirement",
        stage_id: "coding",
        path_id: "main",
        round: 2,
        workspace_snapshot_id: "snapshot-a",
        produced_at: "2026-09-17T00:00:00.000Z",
      },
    ],
    [
      "session-b",
      {
        run_id: "run-shared",
        arm_id: "compiler",
        task_id: "task-b",
        turn_id: "1",
        session_id: "session-b",
        input_identity: "user-turn-shared",
        source_category: "initial_requirement",
        stage_id: "coding",
        path_id: "service",
        round: 2,
        task_occurrence_id: "occurrence-b",
        workspace_snapshot_id: "snapshot-b",
        produced_at: "2026-09-17T00:00:01.000Z",
      },
    ],
  ])
  const observer = Object.assign(observerSpy([]), {
    registry: { resolve: (sessionId: string) => registrations.get(sessionId) },
  })
  const preparedInputs: Array<Record<string, unknown>> = []
  const deliveryRecords: Array<Record<string, unknown>> = []
  const outputs = new Map<string, { messageId: string; part: { id: string; type: "text"; text: string } }>()
  const compiler = {
    prepareTurn: async (request: { runId: string; input: { inputIdentity: string; source?: unknown } }) => {
      preparedInputs.push(request as unknown as Record<string, unknown>)
      const identity = request.input.inputIdentity
      return {
        ok: true as const,
        status: "reused" as const,
        runId: request.runId,
        inputIdentity: identity,
        inputDigest: "sha256:input",
        stateVersion: 1,
        artifactVersion: 1,
        artifact: {},
        canonicalArtifact: "{}",
        renderedText: fakeRenderedText,
        compiledIntentDigest: fakeCompiledDigest,
        renderedTextDigest: fakeRenderedDigest,
        commit: {
          runId: request.runId,
          inputIdentity: identity,
          stateVersion: 1,
          stateDigest: "sha256:state",
          artifactVersion: 1,
          compiledIntent: {
            artifactType: "compiled_intent",
            mediaType: "application/json",
            digest: fakeCompiledDigest,
            size: 2,
            path: "compiled.json",
          },
          renderedText: {
            artifactType: "rendered_text",
            mediaType: "text/plain; charset=utf-8",
            digest: fakeRenderedDigest,
            size: 15,
            path: "rendered.txt",
          },
          operationIds: [],
          sourceDigests: [],
          commitSequence: 1,
        },
        modelCalls: 0,
        retried: false,
      }
    },
    recordDelivery: (request: Record<string, unknown>) => {
      deliveryRecords.push(request)
      return { ok: true, attempt: { status: "confirmed", attemptId: `attempt-${deliveryRecords.length}` } }
    },
  } as unknown as IntentCompiler
  const client = {
    session: {
      messages: async ({ path }: { path: { id: string } }) => {
        const current = outputs.get(path.id)
        return {
          data: current
            ? [{ info: { id: current.messageId, sessionID: path.id, role: "user" }, parts: [{ ...current.part }] }]
            : [],
        }
      },
    },
  }
  const hooks = await ExperimentRuntimePlugin({
    arm: "compiler",
    client,
    observer,
    compiler,
    directory: resolve("."),
  })

  for (const item of [
    { sessionID: "session-a", messageID: "message-a", partID: "part-a" },
    { sessionID: "session-b", messageID: "message-b", partID: "part-b" },
  ]) {
    const part = { id: item.partID, type: "text" as const, text: "same user turn" }
    const output = { message: { id: item.messageID }, parts: [part] }
    outputs.set(item.sessionID, { messageId: item.messageID, part })
    await hooks["chat.message"]({ sessionID: item.sessionID, messageID: item.messageID }, output)
    await hooks["chat.params"]({ sessionID: item.sessionID, message: { id: item.messageID } }, {})
  }

  assert.equal(preparedInputs.length, 2)
  assert.equal((preparedInputs[0]?.input as { inputIdentity: string }).inputIdentity, "user-turn-shared")
  assert.equal((preparedInputs[1]?.input as { inputIdentity: string }).inputIdentity, "user-turn-shared")
  assert.deepEqual(
    [
      (preparedInputs[0]?.input as { source: Record<string, unknown> }).source,
      (preparedInputs[1]?.input as { source: Record<string, unknown> }).source,
    ],
    [
      {
        source_category: "initial_requirement",
        run_id: "run-shared",
        stage_id: "coding",
        path_id: "main",
        round: 2,
        turn_id: "1",
        session_id: "session-a",
        message_id: "message-a",
        workspace_snapshot_id: "snapshot-a",
        produced_at: "2026-09-17T00:00:00.000Z",
      },
      {
        source_category: "initial_requirement",
        run_id: "run-shared",
        stage_id: "coding",
        path_id: "service",
        round: 2,
        task_occurrence_id: "occurrence-b",
        turn_id: "1",
        session_id: "session-b",
        message_id: "message-b",
        workspace_snapshot_id: "snapshot-b",
        produced_at: "2026-09-17T00:00:01.000Z",
      },
    ],
  )
  assert.equal(preparedInputs[0]?.currentWorkspaceSnapshotId, "snapshot-a")
  assert.equal(preparedInputs[1]?.currentWorkspaceSnapshotId, "snapshot-b")
  assert.equal(deliveryRecords.length, 2)
  assert.notEqual(
    (deliveryRecords[0]?.metadata as { expectedPartDigest: string }).expectedPartDigest,
    (deliveryRecords[1]?.metadata as { expectedPartDigest: string }).expectedPartDigest,
  )
})

test("raw arm uses the same delivery position without touching text or Compiler", async () => {
  const log: string[] = []
  const part = { id: "raw-part", type: "text" as const, text: "Keep this text", sessionID: "raw-session", messageID: "raw-message" }
  const client = { session: { messages: async () => messageReadback(part) } }
  const hooks = createOpenCodeAdapter({
    arm: "raw",
    client,
    observer: observerSpy(log),
  }).hooks()
  await hooks["chat.message"]({ sessionID: part.sessionID, messageID: part.messageID }, { message: { id: part.messageID }, parts: [part] })
  assert.equal(part.text, "Keep this text")
  assert.deepEqual(log, ["observer.raw", "observer.expected"])
  await hooks["chat.params"]({ sessionID: part.sessionID, message: { id: part.messageID } }, {})
  assert.deepEqual(log, ["observer.raw", "observer.expected", "observer.model"])
})

test("raw arm preserves non-text parts while still guarding text readback", async () => {
  const log: string[] = []
  const parts = [
    { id: "raw-text", type: "text" as const, text: "Keep this text" },
    { id: "raw-image", type: "image", url: "image://keep" },
  ]
  const client = {
    session: {
      messages: async () => ({
        data: [{ info: { id: "raw-message" }, parts: [{ ...parts[0] }] }],
      }),
    },
  }
  const hooks = createOpenCodeAdapter({
    arm: "raw",
    client,
    observer: observerSpy(log),
  }).hooks()
  await hooks["chat.message"]({ sessionID: "raw-session", messageID: "raw-message" }, { message: { id: "raw-message" }, parts })
  assert.deepEqual(parts, [
    { id: "raw-text", type: "text", text: "Keep this text" },
    { id: "raw-image", type: "image", url: "image://keep" },
  ])
  await hooks["chat.params"]({ sessionID: "raw-session", message: { id: "raw-message" } }, {})
  assert.deepEqual(log, ["observer.raw", "observer.expected", "observer.model"])
})

test("calls the real SDK messages method with its session object bound", async () => {
  const log: string[] = []
  const observer = observerSpy(log)
  const part = { id: "bound-part", type: "text" as const, text: "Bound readback", sessionID: "bound-session", messageID: "bound-message" }
  const sessionApi = {
    messages(this: unknown) {
      assert.equal(this, sessionApi)
      return Promise.resolve(messageReadback(part))
    },
  }
  const hooks = createOpenCodeAdapter({
    arm: "raw",
    client: { session: sessionApi },
    observer,
  }).hooks()

  await hooks["chat.message"](
    { sessionID: part.sessionID, messageID: part.messageID },
    { message: { id: part.messageID }, parts: [part] },
  )
  await hooks["chat.params"]({ sessionID: part.sessionID, message: { id: part.messageID } }, {})

  assert.deepEqual(log, ["observer.raw", "observer.expected", "observer.model"])
})

test("ignores chat.params for a session whose message was not captured", async () => {
  const log: string[] = []
  const observer = observerSpy(log)
  observer.captureRawInput = (input) => {
    log.push("observer.raw")
    return input.sessionID !== "compiler-model-session"
  }
  let readbackCalled = false
  const hooks = createOpenCodeAdapter({
    arm: "compiler",
    client: {
      session: {
        messages: async () => {
          readbackCalled = true
          throw new Error("unmanaged model session must not be read")
        },
      },
    },
    observer,
    compiler: {} as IntentCompiler,
    resolveTurn: () => {
      throw new Error("unmanaged model session must not resolve a Compiler turn")
    },
  }).hooks()

  await hooks["chat.message"](
    { sessionID: "compiler-model-session", messageID: "compiler-model-message" },
    { message: { id: "compiler-model-message" }, parts: [{ id: "compiler-model-part", type: "text", text: "internal" }] },
  )
  await hooks["chat.params"]({ sessionID: "compiler-model-session", message: { id: "compiler-model-message" } }, {})
  const systemOutput = { system: ["native"] }
  await hooks["experimental.chat.system.transform"]({ sessionID: "compiler-model-session" }, systemOutput)
  assert.equal(readbackCalled, false)
  assert.deepEqual(systemOutput.system, ["native"])
  assert.deepEqual(log, ["observer.raw"])
})

test("ignores every hook for a known Compiler model session", async () => {
  const log: string[] = []
  const observer = observerSpy(log)
  const hooks = createOpenCodeAdapter({
    arm: "compiler",
    client: {},
    observer,
    compiler: {} as IntentCompiler,
    resolveTurn: () => {
      throw new Error("ignored session must not resolve a turn")
    },
    ignoreSession: (sessionId) => sessionId === "compiler-model-session",
  }).hooks()
  const input = { sessionID: "compiler-model-session", messageID: "compiler-model-message" }
  await hooks["chat.message"](input, {
    message: { id: "compiler-model-message" },
    parts: [{ id: "compiler-model-part", type: "text", text: "internal" }],
  })
  await hooks["chat.params"]({ sessionID: input.sessionID, message: { id: input.messageID } }, {})
  await hooks["experimental.chat.system.transform"]({ sessionID: input.sessionID }, { system: [] })
  await hooks.event({ event: { type: "session.idle", properties: { sessionID: input.sessionID } } })
  hooks["tool.execute.before"]({ sessionID: input.sessionID, callID: "call", tool: "read" }, {})
  hooks["tool.execute.after"]({ sessionID: input.sessionID, callID: "call", tool: "read" }, {})

  assert.deepEqual(log, [])
})

test("a captured session still rejects chat.params when its pending delivery is missing", async () => {
  const log: string[] = []
  const observer = observerSpy(log)
  observer.expectDelivery = () => {
    log.push("observer.expected")
    return false
  }
  const hooks = createOpenCodeAdapter({
    arm: "raw",
    client: { session: { messages: async () => ({ data: [] }) } },
    observer,
  }).hooks()

  await assert.rejects(
    hooks["chat.message"](
      { sessionID: "managed-session", messageID: "managed-message" },
      { message: { id: "managed-message" }, parts: [{ id: "managed-part", type: "text", text: "managed" }] },
    ),
    (error: unknown) => error instanceof OpenCodeAdapterError && error.code === "OBSERVER_EXPECTATION_REJECTED",
  )
  await expectGuard(
    hooks["chat.params"]({ sessionID: "managed-session", message: { id: "managed-message" } }, {}),
    "DELIVERY_GUARD_PENDING_MISSING",
  )
  assert.deepEqual(log, ["observer.raw", "observer.expected"])
})

test("requires a paired harness identity and exact incoming harness text", async () => {
  const missingPair = compilerHarness(
    () => ({ data: [] }),
    (input) => ({ runId: "run-pair", inputIdentity: input.messageID ?? "message-1", userInputText: "user" }),
  )
  await assert.rejects(
    prepareCompilerDelivery(missingPair),
    (error: unknown) => error instanceof OpenCodeAdapterError && error.code === "HARNESS_TEXT_PAIR_REQUIRED",
  )
  assert.deepEqual(missingPair.calls.map((call) => call.operation), [])

  const mismatch = compilerHarness(
    () => ({ data: [] }),
    (input) => ({
      runId: "run-mismatch",
      inputIdentity: input.messageID ?? "message-1",
      userInputText: "user",
      harnessSystemText: "a different harness",
    }),
  )
  await assert.rejects(
    prepareCompilerDelivery(mismatch),
    (error: unknown) => error instanceof OpenCodeAdapterError && error.code === "HARNESS_SYSTEM_TEXT_MISMATCH",
  )
  assert.deepEqual(mismatch.calls.map((call) => call.operation), [])
})

test("accepts the exact text produced by OpenCode run for one harness argument", async () => {
  const userText = "User requirement for the compatibility check."
  const harnessText = "Compatibility-only run.\nDo not modify files."
  const harness = compilerHarness(
    () => ({ data: [] }),
    (input) => ({
      runId: "run-cli-harness",
      inputIdentity: input.messageID ?? "message-1",
      userInputText: userText,
      harnessSystemText: harnessText,
    }),
  )
  harness.part.text = `"${harnessText.replace(/"/gu, '\\"')}"`

  await prepareCompilerDelivery(harness)

  assert.equal((harness.calls[0]?.request?.input as { raw?: string } | undefined)?.raw, userText)
})

test("blocks chat.params until a declared harness system transform succeeds", async () => {
  let readbackCalled = false
  const harness = compilerHarness(
    () => {
      readbackCalled = true
      return { data: [] }
    },
    (input) => ({
      runId: "run-system-order",
      inputIdentity: input.messageID ?? "message-1",
      userInputText: "Build the parser.",
      harnessSystemText: "Build the parser.",
    }),
  )
  await prepareCompilerDelivery(harness)
  await expectGuard(
    harness.hooks["chat.params"]({ sessionID: "session-1", message: { id: "message-1" } }, {}),
    "DELIVERY_GUARD_SYSTEM_TRANSFORM_REQUIRED",
  )
  assert.equal(readbackCalled, false)
})

test("allows title and executor model requests to reuse one confirmed delivery", async () => {
  const harnessText = "Harness instructions for this turn."
  let currentPart: ReturnType<typeof compilerHarness>["part"] | undefined
  const harness = compilerHarness(
    () => messageReadback(currentPart as ReturnType<typeof compilerHarness>["part"]),
    (input) => ({
      runId: "run-multi-step",
      inputIdentity: input.messageID ?? "message-1",
      userInputText: "User requirement.",
      harnessSystemText: harnessText,
    }),
  )
  harness.part.text = harnessText
  currentPart = harness.part
  await prepareCompilerDelivery(harness)

  for (const agent of ["title", "build"]) {
    const systemOutput = { system: [] as string[] }
    await harness.hooks["experimental.chat.system.transform"]({ sessionID: harness.part.sessionID }, systemOutput)
    assert.deepEqual(systemOutput.system, [harnessText])
    await harness.hooks["chat.params"](
      { sessionID: harness.part.sessionID, message: { id: harness.part.messageID }, agent },
      {},
    )
  }

  assert.deepEqual(harness.calls.map((call) => call.operation), ["prepareTurn", "recordDelivery"])
  assert.equal(harness.log.filter((item) => item === "observer.model").length, 2)
})

test("rejects missing-session, duplicate-pending, and out-of-order system transforms", async () => {
  const missingSession = createOpenCodeAdapter({
    arm: "raw",
    client: {},
    observer: observerSpy([]),
  }).hooks()
  await assert.rejects(
    missingSession["experimental.chat.system.transform"]({ sessionID: "" }, { system: [] }),
    (error: unknown) => error instanceof OpenCodeAdapterError && error.code === "SYSTEM_TRANSFORM_SESSION_MISSING",
  )

  const multiple = compilerHarness(
    () => ({ data: [] }),
    (input) => ({
      runId: `run-${input.messageID ?? "unknown"}`,
      inputIdentity: input.messageID ?? "unknown",
      userInputText: "Build the parser.",
      harnessSystemText: "Build the parser.",
    }),
  )
  await prepareCompilerDelivery(multiple)
  const secondPart = { ...multiple.part, id: "part-2", messageID: "message-2", text: "Build the parser." }
  await multiple.hooks["chat.message"](
    { sessionID: "session-1", messageID: "message-2" },
    { message: { id: "message-2" }, parts: [secondPart] },
  )
  await assert.rejects(
    multiple.hooks["experimental.chat.system.transform"]({ sessionID: "session-1" }, { system: [] }),
    (error: unknown) => error instanceof OpenCodeAdapterError && error.code === "SYSTEM_TRANSFORM_MULTIPLE_PENDING",
  )

  const ordered = compilerHarness(
    () => ({ data: [] }),
    (input) => ({
      runId: "run-ordered",
      inputIdentity: input.messageID ?? "message-1",
      userInputText: "Build the parser.",
      harnessSystemText: "Build the parser.",
    }),
  )
  await prepareCompilerDelivery(ordered)
  await ordered.hooks["experimental.chat.system.transform"]({ sessionID: "session-1" }, { system: [] })
  await assert.rejects(
    ordered.hooks["experimental.chat.system.transform"]({ sessionID: "session-1" }, { system: [] }),
    (error: unknown) => error instanceof OpenCodeAdapterError && error.code === "SYSTEM_TRANSFORM_ORDER",
  )
})

test("compiler arm rejects non-text content before calling Compiler", async () => {
  const log: string[] = []
  let prepared = false
  const compiler = {
    prepareTurn: async () => {
      prepared = true
      throw new Error("must not be called")
    },
  } as unknown as IntentCompiler
  const hooks = createOpenCodeAdapter({
    arm: "compiler",
    client: { session: { messages: async () => ({ data: [] }) } },
    observer: observerSpy(log),
    compiler,
    resolveTurn: () => ({ runId: "run", inputIdentity: "input" }),
  }).hooks()
  const parts = [
    { id: "text", type: "text", text: "Keep" },
    { id: "image", type: "image", url: "image://not-model-input" },
  ]
  await assert.rejects(
    hooks["chat.message"]({ sessionID: "session", messageID: "message" }, { message: { id: "message" }, parts }),
    (error: unknown) => error instanceof OpenCodeAdapterError && error.code === "NON_TEXT_INPUT",
  )
  assert.equal(prepared, false)
  assert.deepEqual(log, ["observer.raw"])
})

test("missing target, extra/wrong parts, and read failure reject before provider dispatch", async () => {
  const cases: Array<{ name: string; response: (part: ReturnType<typeof compilerHarness>["part"]) => unknown; code: string }> = [
    { name: "missing target", response: () => ({ data: [] }), code: "DELIVERY_GUARD_TARGET_MISSING" },
    { name: "extra text part", response: (part) => ({ data: [{ info: { id: part.messageID }, parts: [{ ...part }, { ...part, id: "unexpected" }] }] }), code: "DELIVERY_GUARD_PART_MISMATCH" },
    { name: "wrong part id", response: (part) => ({ data: [{ info: { id: part.messageID }, parts: [{ ...part, id: "wrong-id" }] }] }), code: "DELIVERY_GUARD_PART_MISMATCH" },
    { name: "wrong text", response: (part) => ({ data: [{ info: { id: part.messageID }, parts: [{ ...part, text: "changed" }] }] }), code: "DELIVERY_GUARD_PART_MISMATCH" },
    { name: "read failure", response: () => { throw new Error("read failed") }, code: "DELIVERY_GUARD_READ_FAILURE" },
  ]

  for (const scenario of cases) {
    const harness = compilerHarness(() => scenario.response(harness.part))
    await prepareCompilerDelivery(harness)
    let providerCalled = false
    await expectGuard(
      harness.hooks["chat.params"]({ sessionID: "session-1", message: { id: "message-1" } }, {}).then(() => { providerCalled = true }),
      scenario.code,
    )
    assert.equal(providerCalled, false, scenario.name)
    assert.equal(harness.calls.at(-1)?.operation, "recordDelivery", scenario.name)
    assert.equal(harness.calls.at(-1)?.request?.status, "rejected", scenario.name)
    const current = harness.compilerStore.openRun("run-adapter").replay().current
    const commit = current.commit
    assert.ok(commit, scenario.name)
    assert.equal(harness.calls.at(-1)?.request?.expectedDigest, commit.compiledIntent.digest, scenario.name)
    assert.equal(harness.calls.at(-1)?.request?.readbackDigest, undefined, scenario.name)
    assert.equal(harness.calls.at(-1)?.request?.expectedRenderedDigest, commit.renderedText.digest, scenario.name)
    assert.equal(harness.calls.at(-1)?.request?.readbackRenderedDigest, undefined, scenario.name)
    const metadata = harness.calls.at(-1)?.request?.metadata as Record<string, unknown> | undefined
    assert.equal(
      metadata?.expectedPartDigest,
      `sha256:${sha256(stableJson([{ id: harness.part.id, text: harness.part.text }]))}`,
      scenario.name,
    )
  }
})

test("terminal reconciliation records delivery only and does not mutate Compiler state", async () => {
  let currentPart: ReturnType<typeof compilerHarness>["part"] | undefined
  const harness = compilerHarness(() => messageReadback(currentPart as ReturnType<typeof compilerHarness>["part"]))
  currentPart = harness.part
  await prepareCompilerDelivery(harness)
  await harness.hooks["chat.params"]({ sessionID: "session-1", message: { id: "message-1" } }, {})
  const before = harness.compilerStore.openRun("run-adapter").replay().current
  await harness.hooks.event({ event: { type: "session.idle", properties: { sessionID: "session-1" } } })
  const after = harness.compilerStore.openRun("run-adapter").replay().current
  assert.equal(after.version, before.version)
  assert.equal(after.artifactVersion, before.artifactVersion)
  assert.equal(harness.calls.at(-1)?.request?.attemptId !== undefined, true)
  assert.equal(harness.calls.at(-1)?.request?.reconciliation !== undefined, true)
  assert.equal(harness.compilerStore.openRun("run-adapter").history().filter((event) => event.type === "commit.complete").length, 1)
})

test("the same session reconciles two completed turns independently", async () => {
  const harness = compilerHarness(() => messageReadback(harness.part))

  await prepareCompilerDelivery(harness)
  await harness.hooks["chat.params"](
    { sessionID: harness.part.sessionID, message: { id: harness.part.messageID } },
    {},
  )
  await harness.hooks.event({
    event: { type: "session.idle", properties: { sessionID: harness.part.sessionID } },
  })

  harness.part.id = "part-2"
  harness.part.messageID = "message-2"
  harness.part.text = "Add parser diagnostics."
  await prepareCompilerDelivery(harness)
  await harness.hooks["chat.params"](
    { sessionID: harness.part.sessionID, message: { id: harness.part.messageID } },
    {},
  )
  await harness.hooks.event({
    event: { type: "session.idle", properties: { sessionID: harness.part.sessionID } },
  })

  const history = harness.compilerStore.openRun("run-adapter").history()
  assert.equal(history.filter((event) => event.type === "delivery.attempt").length, 2)
  assert.equal(history.filter((event) => event.type === "delivery.reconciliation").length, 2)
  assert.equal(harness.log.filter((entry) => entry === "observer.reconcile").length, 2)
})

test("a failed terminal reconciliation is not treated as a successful completed turn", async () => {
  const harness = compilerHarness(
    () => messageReadback(harness.part),
    undefined,
    undefined,
    false,
  )
  await prepareCompilerDelivery(harness)
  await harness.hooks["chat.params"](
    { sessionID: harness.part.sessionID, message: { id: harness.part.messageID } },
    {},
  )
  await harness.hooks.event({
    event: { type: "session.error", properties: { sessionID: harness.part.sessionID } },
  })
  const recovery = harness.compiler.recover({ runId: "run-adapter" })
  assert.equal(recovery.action, "contaminated")
  assert.equal(recovery.contaminated, true)
})

test("a real Compiler reuses one input across two reconciled sessions", async () => {
  const harness = compilerHarness(
    () => messageReadback(harness.part),
    (input) => ({
      runId: "run-reused-real",
      inputIdentity: "shared-user-input",
      source: {
        run_id: "run-reused-real",
        turn_id: "user-turn-1",
        session_id: input.sessionID,
        message_id: input.messageID,
      },
    }),
  )
  harness.part.text = "same user turn"

  await prepareCompilerDelivery(harness)
  await harness.hooks["chat.params"](
    { sessionID: harness.part.sessionID, message: { id: harness.part.messageID } },
    {},
  )
  await harness.hooks.event({
    event: { type: "session.idle", properties: { sessionID: harness.part.sessionID } },
  })

  harness.part.sessionID = "session-2"
  harness.part.messageID = "message-2"
  harness.part.id = "part-2"
  harness.part.text = "same user turn"
  await prepareCompilerDelivery(harness)
  await harness.hooks["chat.params"](
    { sessionID: harness.part.sessionID, message: { id: harness.part.messageID } },
    {},
  )
  await harness.hooks.event({
    event: { type: "session.idle", properties: { sessionID: harness.part.sessionID } },
  })

  const history = harness.compilerStore.openRun("run-reused-real").history()
  assert.equal(history.filter((event) => event.type === "proposal.saved").length, 1)
  assert.equal(history.filter((event) => event.type === "delivery.attempt").length, 2)
  assert.equal(history.filter((event) => event.type === "delivery.reconciliation").length, 2)
})

test("the project plugin directory has one runtime entry", async () => {
  assert.deepEqual(readdirSync(resolve(".opencode/plugins")).filter((name) => name.endsWith(".js")), ["experiment-runtime.js"])
})
