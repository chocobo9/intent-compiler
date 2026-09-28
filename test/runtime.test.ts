import assert from "node:assert/strict"
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import test from "node:test"
import { ObserverRuntime, SessionRegistry } from "../src/index.js"

function setupObserver() {
  const root = mkdtempSync(join(tmpdir(), "experiment-observer-test-"))
  const client = {
    session: {
      messages: async () => ({ data: [] }),
    },
  }
  const runtime = new ObserverRuntime({ storeDir: resolve(root), client })
  const registration = runtime.registry.register({
    run_id: "run-observer",
    arm_id: "raw",
    task_id: "task-001",
    turn_id: "1",
    session_id: "session-observer",
  })
  return {
    root,
    runtime,
    registration,
    cleanup() {
      assert.ok(root.startsWith(tmpdir()))
      rmSync(root, { recursive: true, force: true })
    },
  }
}

test("observer preserves input and records a matching part update without calling it SDK readback", async (t) => {
  const setup = setupObserver()
  t.after(setup.cleanup)
  const output = {
    message: {},
    parts: [
      {
        id: "part-1",
        sessionID: setup.registration.session_id,
        messageID: "message-1",
        type: "text",
        text: "Fix the parser.",
      },
    ],
  }

  assert.equal(
    await setup.runtime.observeInput(
      { sessionID: setup.registration.session_id, messageID: "message-1" },
      output,
    ),
    true,
  )
  assert.equal(output.parts[0].text, "Fix the parser.")
  setup.runtime.observeEvent({ type: "message.part.updated", properties: { part: output.parts[0] } })

  const run = setup.runtime.events.openRun(setup.registration)
  const events = run.readEvents()
  assert.equal(events.filter((event) => event.event_type === "user_input.observed").length, 1)
  assert.equal(events.filter((event) => event.event_type === "executor_message.part_update_observed").length, 1)
  assert.equal(events.filter((event) => event.event_type === "executor_message.sdk_readback_confirmed").length, 0)
  const summary = JSON.parse(readFileSync(join(run.dir, "summary.json"), "utf8"))
  assert.equal(summary.status, "part_update_observed")
  assert.equal(summary.instrumentation_failures.length, 0)
})

test("raw capture and delivery expectation observe the text before and after mutation", (t) => {
  const setup = setupObserver()
  t.after(setup.cleanup)
  const input = { sessionID: setup.registration.session_id, messageID: "message-split" }
  const output = {
    message: {},
    parts: [
      {
        id: "part-split",
        sessionID: setup.registration.session_id,
        messageID: "message-split",
        type: "text",
        text: "Raw user text",
      },
    ],
  }

  assert.equal(setup.runtime.captureRawInput(input, output), true)
  output.parts[0].text = "Rendered artifact text"
  assert.equal(setup.runtime.expectDelivery(input, output), true)

  const run = setup.runtime.events.openRun(setup.registration)
  const events = run.readEvents()
  const rawEvent = events.find((event) => event.event_type === "user_input.observed")!
  const expectedEvent = events.find((event) => event.event_type === "executor_message.readback_expected")!
  const rawArtifact = JSON.parse(readFileSync(join(run.dir, rawEvent.artifact_refs![0].path), "utf8"))
  const expectedArtifact = JSON.parse(readFileSync(join(run.dir, expectedEvent.artifact_refs![0].path), "utf8"))

  assert.equal(rawArtifact[0].text, "Raw user text")
  assert.equal(expectedArtifact[0].text, "Rendered artifact text")
  assert.notEqual(rawEvent.data?.digest, expectedEvent.data?.digest)
})

test("persisted delivery mismatch is reported as an instrumentation failure", async (t) => {
  const setup = setupObserver()
  t.after(setup.cleanup)
  const part = {
    id: "part-mismatch",
    sessionID: setup.registration.session_id,
    messageID: "message-mismatch",
    type: "text",
    text: "Expected",
  }
  await setup.runtime.observeInput(
    { sessionID: setup.registration.session_id, messageID: part.messageID },
    { message: {}, parts: [part] },
  )
  setup.runtime.observeEvent({
    type: "message.part.updated",
    properties: { part: { ...part, text: "Changed after observation" } },
  })

  const run = setup.runtime.events.openRun(setup.registration)
  const summary = JSON.parse(readFileSync(join(run.dir, "summary.json"), "utf8"))
  assert.equal(summary.status, "instrumentation_failed")
  assert.equal(summary.instrumentation_failures.length, 1)
})

test("persisted tool result records a failed call even when the after hook is absent", (t) => {
  const setup = setupObserver()
  t.after(setup.cleanup)
  setup.runtime.toolBefore(
    { sessionID: setup.registration.session_id, callID: "call-1", tool: "bash" },
    { args: { command: "false" } },
  )
  setup.runtime.observeEvent({
    type: "message.part.updated",
    properties: {
      part: {
        id: "tool-part-1",
        sessionID: setup.registration.session_id,
        messageID: "assistant-1",
        type: "tool",
        callID: "call-1",
        tool: "bash",
        state: { status: "error", error: "exit 1", time: { start: 100, end: 125 } },
      },
    },
  })

  const summary = setup.runtime.project(setup.runtime.events.openRun(setup.registration))
  assert.equal(summary.tools.total, 1)
  assert.equal(summary.tools.error, 1)
  assert.equal(summary.tools.calls[0].duration_ms, 25)
})

test("SDK readback records assistant metrics and restart continues the event sequence", async (t) => {
  const setup = setupObserver()
  t.after(setup.cleanup)
  const part = {
    id: "part-readback",
    sessionID: setup.registration.session_id,
    messageID: "message-readback",
    type: "text",
    text: "Read me back",
  }
  await setup.runtime.observeInput(
    { sessionID: setup.registration.session_id, messageID: part.messageID },
    { message: {}, parts: [part] },
  )
  setup.runtime.client.session!.messages = async () => ({
    data: [
      { info: { id: part.messageID, sessionID: setup.registration.session_id, role: "user" }, parts: [part] },
      {
        info: {
          id: "assistant-readback",
          sessionID: setup.registration.session_id,
          role: "assistant",
          time: { created: 1_000, completed: 1_200 },
          modelID: "model-a",
          providerID: "provider-a",
          cost: 0,
          tokens: { input: 10, output: 4, reasoning: 2, cache: { read: 3, write: 0 } },
          finish: "stop",
        },
        parts: [],
      },
    ],
  })
  setup.runtime.modelRequested(
    {
      sessionID: setup.registration.session_id,
      agent: "build",
      model: { id: "model-a", providerID: "provider-a" },
      message: { id: part.messageID },
    },
    { temperature: 0, topP: 1, topK: 0, maxOutputTokens: 100 },
  )
  assert.equal(await setup.runtime.reconcileSession(setup.registration.session_id), true)

  const firstRun = setup.runtime.events.openRun(setup.registration)
  assert.equal(
    firstRun.readEvents().filter((event) => event.event_type === "executor_message.sdk_readback_confirmed").length,
    1,
  )
  const previousLast = firstRun.readEvents().at(-1)!.sequence
  const restarted = new ObserverRuntime({ storeDir: resolve(setup.root), client: setup.runtime.client })
  const restartedRun = restarted.events.openRun(setup.registration)
  const record = restartedRun.append({ component: "observer", event_type: "restart.checked", status: "completed" })
  assert.equal(record.sequence, previousLast + 1)

  const summary = restarted.project(restartedRun)
  assert.equal(summary.models.requests, 1)
  assert.equal(summary.models.usage_bearing_completions, 1)
  assert.equal(summary.models.input_tokens, 10)
  assert.equal(summary.models.cost, 0)
  assert.deepEqual(summary.models.cost_kinds, ["computed_zero"])
})

test("SDK readback rejects a missing target even after a matching part update", async (t) => {
  const setup = setupObserver()
  t.after(setup.cleanup)
  const part = {
    id: "part-sdk-missing",
    sessionID: setup.registration.session_id,
    messageID: "message-sdk-missing",
    type: "text",
    text: "Expected persisted text",
  }
  await setup.runtime.observeInput(
    { sessionID: setup.registration.session_id, messageID: part.messageID },
    { message: {}, parts: [part] },
  )
  setup.runtime.observeEvent({ type: "message.part.updated", properties: { part } })
  setup.runtime.client.session!.messages = async () => ({ data: [] })

  assert.equal(await setup.runtime.reconcileSession(setup.registration.session_id), false)
  const run = setup.runtime.events.openRun(setup.registration)
  const events = run.readEvents()
  assert.equal(events.filter((event) => event.event_type === "executor_message.part_update_observed").length, 1)
  assert.equal(events.filter((event) => event.event_type === "executor_message.sdk_readback_rejected").length, 1)
  assert.equal(events.filter((event) => event.event_type === "turn.completed").length, 0)
  const summary = setup.runtime.project(run)
  assert.equal(summary.status, "instrumentation_failed")
  assert.ok(summary.instrumentation_failures.some((event) => event.event_type === "executor_message.sdk_readback_rejected"))
})

test("SDK readback rejects an unexpected text part", async (t) => {
  const setup = setupObserver()
  t.after(setup.cleanup)
  const part = {
    id: "part-sdk-extra",
    sessionID: setup.registration.session_id,
    messageID: "message-sdk-extra",
    type: "text",
    text: "Expected text",
  }
  await setup.runtime.observeInput(
    { sessionID: setup.registration.session_id, messageID: part.messageID },
    { message: {}, parts: [part] },
  )
  setup.runtime.client.session!.messages = async () => ({
    data: [
      {
        info: { id: part.messageID, sessionID: setup.registration.session_id, role: "user" },
        parts: [part, { ...part, id: "unexpected-text-part", text: "Unexpected" }],
      },
    ],
  })

  assert.equal(await setup.runtime.reconcileSession(setup.registration.session_id), false)
  const events = setup.runtime.events.openRun(setup.registration).readEvents()
  const rejection = events.find((event) => event.event_type === "executor_message.sdk_readback_rejected")
  assert.equal(rejection?.data?.target_present, true)
  assert.equal(rejection?.data?.matches_expected, false)
})

test("SDK read failure is recorded without a completed turn", async (t) => {
  const setup = setupObserver()
  t.after(setup.cleanup)
  const part = {
    id: "part-sdk-error",
    sessionID: setup.registration.session_id,
    messageID: "message-sdk-error",
    type: "text",
    text: "Expected text",
  }
  await setup.runtime.observeInput(
    { sessionID: setup.registration.session_id, messageID: part.messageID },
    { message: {}, parts: [part] },
  )
  setup.runtime.client.session!.messages = async () => {
    throw new Error("readback unavailable")
  }

  assert.equal(await setup.runtime.reconcileSession(setup.registration.session_id), false)
  const events = setup.runtime.events.openRun(setup.registration).readEvents()
  assert.equal(events.filter((event) => event.event_type === "reconciliation.failed").length, 1)
  assert.equal(events.filter((event) => event.event_type === "turn.completed").length, 0)
})

test("one run preserves turn identity across registrations", async (t) => {
  const setup = setupObserver()
  t.after(setup.cleanup)

  for (const turn of ["1", "2"]) {
    setup.runtime.registry.register({ ...setup.registration, turn_id: turn })
    const part = {
      id: `part-turn-${turn}`,
      sessionID: setup.registration.session_id,
      messageID: `message-turn-${turn}`,
      type: "text",
      text: `Instruction ${turn}`,
    }
    await setup.runtime.observeInput(
      { sessionID: setup.registration.session_id, messageID: part.messageID },
      { message: {}, parts: [part] },
    )
    setup.runtime.observeEvent({ type: "message.part.updated", properties: { part } })
  }

  const events = setup.runtime.events
    .openRun({ ...setup.registration, turn_id: "2" })
    .readEvents()
    .filter((event) => event.event_type === "user_input.observed")
  assert.deepEqual(events.map((event) => event.turn_id), ["1", "2"])
})

test("unregistered sessions remain unobserved", async (t) => {
  const setup = setupObserver()
  t.after(setup.cleanup)
  const result = await setup.runtime.observeInput(
    { sessionID: "unregistered", messageID: "message-unknown" },
    { message: {}, parts: [{ id: "part-unknown", type: "text", text: "Ignore me" }] },
  )
  assert.equal(result, false)
})

test("session registration materializes paired external UTF-8 files without persisting source paths", () => {
  const store = mkdtempSync(join(tmpdir(), "experiment-observer-registration-store-"))
  const workspace = mkdtempSync(join(tmpdir(), "experiment-observer-executor-"))
  const source = mkdtempSync(join(tmpdir(), "experiment-observer-input-"))
  const userInputFile = join(source, "user-input.txt")
  const harnessSystemFile = join(source, "harness-system.txt")
  writeFileSync(userInputFile, "用户要求：修复解析器。\n", "utf8")
  writeFileSync(harnessSystemFile, "Generated harness instructions.\n", "utf8")

  try {
    const registry = new SessionRegistry(store)
    const registration = registry.register({
      run_id: "run-file-registration",
      arm_id: "compiler",
      task_id: "task-file-registration",
      turn_id: "1",
      session_id: "session-file-registration",
      input_identity: "user-turn-001",
      user_input_file: userInputFile,
      harness_system_file: harnessSystemFile,
      executor_workspace: workspace,
    })

    assert.equal(registration.user_input_text, "用户要求：修复解析器。\n")
    assert.equal(registration.harness_system_text, "Generated harness instructions.\n")
    assert.equal(registration.input_identity, "user-turn-001")
    const persisted = JSON.parse(readFileSync(registry.path(registration.session_id), "utf8")) as Record<string, unknown>
    assert.equal(persisted.user_input_text, registration.user_input_text)
    assert.equal(persisted.harness_system_text, registration.harness_system_text)
    assert.equal("user_input_file" in persisted, false)
    assert.equal("harness_system_file" in persisted, false)
    assert.equal("executor_workspace" in persisted, false)
  } finally {
    rmSync(store, { recursive: true, force: true })
    rmSync(workspace, { recursive: true, force: true })
    rmSync(source, { recursive: true, force: true })
  }
})

test("auto-registration reads external files on the first session lookup and rejects unsafe files", () => {
  const store = mkdtempSync(join(tmpdir(), "experiment-observer-auto-store-"))
  const workspace = mkdtempSync(join(tmpdir(), "experiment-observer-auto-workspace-"))
  const source = mkdtempSync(join(tmpdir(), "experiment-observer-auto-source-"))
  const userInputFile = join(source, "user.txt")
  const harnessSystemFile = join(source, "harness.txt")
  writeFileSync(userInputFile, "user from file", "utf8")
  writeFileSync(harnessSystemFile, "harness from file", "utf8")

  try {
    const registry = new SessionRegistry(store, {
      EXPERIMENT_OBSERVER_AUTO_REGISTER: "1",
      EXPERIMENT_RUN_ID: "run-auto-file",
      EXPERIMENT_ARM_ID: "compiler",
      EXPERIMENT_TASK_ID: "task-auto-file",
      EXPERIMENT_TURN_ID: "1",
      EXPERIMENT_INPUT_IDENTITY: "user-turn-auto",
      EXPERIMENT_INPUT_SOURCE_CATEGORY: "initial_requirement",
      EXPERIMENT_STAGE_ID: "prd",
      EXPERIMENT_PATH_ID: "main",
      EXPERIMENT_ROUND: "0",
      EXPERIMENT_TASK_OCCURRENCE_ID: "task-occurrence-1",
      EXPERIMENT_WORKSPACE_SNAPSHOT_ID: "snapshot-1",
      EXPERIMENT_INPUT_PRODUCED_AT: "2026-09-17T00:00:00.000Z",
      EXPERIMENT_EXECUTOR_WORKSPACE: workspace,
      EXPERIMENT_USER_INPUT_FILE: userInputFile,
      EXPERIMENT_HARNESS_SYSTEM_FILE: harnessSystemFile,
    })
    const registration = registry.resolve("session-auto-file")
    assert.equal(registration?.user_input_text, "user from file")
    assert.equal(registration?.harness_system_text, "harness from file")
    assert.equal(registration?.input_identity, "user-turn-auto")
    assert.equal(registration?.source_category, "initial_requirement")
    assert.equal(registration?.stage_id, "prd")
    assert.equal(registration?.path_id, "main")
    assert.equal(registration?.round, 0)
    assert.equal(registration?.task_occurrence_id, "task-occurrence-1")
    assert.equal(registration?.workspace_snapshot_id, "snapshot-1")
    assert.equal(registration?.produced_at, "2026-09-17T00:00:00.000Z")

    assert.throws(
      () =>
        new SessionRegistry(store, {
          EXPERIMENT_OBSERVER_AUTO_REGISTER: "1",
          EXPERIMENT_ROUND: "not-a-round",
        }).resolve("session-invalid-round"),
      /EXPERIMENT_ROUND must be a non-negative integer/,
    )

    const unsafe = join(workspace, "user.txt")
    const unsafeHarness = join(source, "unsafe-harness.txt")
    writeFileSync(unsafe, "must not be visible to executor", "utf8")
    writeFileSync(unsafeHarness, "unsafe harness", "utf8")
    assert.throws(
      () =>
        new SessionRegistry(store, {
          EXPERIMENT_OBSERVER_AUTO_REGISTER: "1",
          EXPERIMENT_EXECUTOR_WORKSPACE: workspace,
          EXPERIMENT_USER_INPUT_FILE: unsafe,
          EXPERIMENT_HARNESS_SYSTEM_FILE: unsafeHarness,
        }).resolve("session-unsafe-file"),
      /outside the executor workspace/,
    )

    const invalid = join(source, "invalid.txt")
    writeFileSync(invalid, Buffer.from([0xff, 0xfe, 0xfd]))
    assert.throws(
      () =>
        new SessionRegistry(store, {
          EXPERIMENT_OBSERVER_AUTO_REGISTER: "1",
          EXPERIMENT_EXECUTOR_WORKSPACE: workspace,
          EXPERIMENT_USER_INPUT_FILE: invalid,
          EXPERIMENT_HARNESS_SYSTEM_FILE: harnessSystemFile,
        }).resolve("session-invalid-utf8"),
      /valid UTF-8/,
    )
  } finally {
    rmSync(store, { recursive: true, force: true })
    rmSync(workspace, { recursive: true, force: true })
    rmSync(source, { recursive: true, force: true })
  }
})

test("observer events cannot auto-register an unrelated session", () => {
  const store = mkdtempSync(join(tmpdir(), "experiment-observer-event-store-"))
  try {
    const runtime = new ObserverRuntime({
      storeDir: store,
      client: {},
      env: {
        EXPERIMENT_OBSERVER_AUTO_REGISTER: "1",
        EXPERIMENT_RUN_ID: "run-executor-only",
        EXPERIMENT_ARM_ID: "compiler",
        EXPERIMENT_TASK_ID: "task-executor-only",
        EXPERIMENT_TURN_ID: "1",
      },
    })

    assert.equal(
      runtime.observeEvent({ type: "session.status", properties: { sessionID: "compiler-model-session", status: { type: "busy" } } }),
      false,
    )
    assert.equal(existsSync(runtime.registry.path("compiler-model-session")), false)
    assert.equal(runtime.observeEvent({ type: "server.changed", properties: { id: "server:http://127.0.0.1" } }), false)
  } finally {
    rmSync(store, { recursive: true, force: true })
  }
})
