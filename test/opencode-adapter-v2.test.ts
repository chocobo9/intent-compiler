import { test } from "node:test"
import assert from "node:assert/strict"
import { createOpenCodeAdapter, HOST_DISPATCH_SOURCE_CATEGORY, type OpenCodeObserver } from "../src/adapters/opencode.js"
import type { IntentCompilerV2, IntentCompilerV2Options } from "../src/core/intent-compiler-v2.js"
import type {
  AdvanceResult,
  AuthorizationResult,
  Atom,
  CompilerEvent,
  EventReceipt,
  RunView,
} from "../src/core/intent-contract.js"

const ATOM: Atom = {
  atom_id: "a-preview",
  revision: 0,
  goal_refs: [],
  task: "preview fix",
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

const DELIVERY: {
  dispatch_id: string
  task_id: string
  atom_id: string
  digest: string
  compiled_revision: number
  atom: Atom
} = {
  dispatch_id: "dispatch-1",
  task_id: "t-fix",
  atom_id: "a-preview",
  digest: "sha256:0000000000000000000000000000000000000000000000000000000000000001",
  compiled_revision: 0,
  atom: ATOM,
}

function observer(): OpenCodeObserver & { events: string[] } {
  const events: string[] = []
  return {
    events,
    captureRawInput: () => true,
    expectDelivery: () => true,
    observeEvent: (event) => {
      events.push(event.type ?? "unknown")
      return true
    },
    modelRequested: () => true,
    toolBefore: () => true,
    toolAfter: () => true,
    scheduleReconciliation: async () => true,
  }
}

function fakeCompiler(): IntentCompilerV2 & {
  events: CompilerEvent[]
  started: string[]
  operations: string[]
  retryLookups: string[]
} {
  const events: CompilerEvent[] = []
  const started: string[] = []
  const operations: string[] = []
  const retryLookups: string[] = []
  return {
    events,
    started,
    operations,
    retryLookups,
    pendingRetryDeliveries: async ({ runId }) => {
      retryLookups.push(runId)
      return [{ ...DELIVERY, dispatch_id: "dispatch-retry" }]
    },
    acceptEvent: async (event: CompilerEvent): Promise<EventReceipt> => {
      events.push(event)
      return { ok: true, run_id: event.run_id, event_id: event.event_id, status: "saved", sequence: events.length }
    },
    advance: async (): Promise<AdvanceResult> => ({
      ok: true,
      run_id: "run-1",
      disposition: "dispatched",
      pending_events: [],
      compiled_revisions: { "t-fix": 0 },
      ir_revisions: { "t-fix": 0 },
      deliveries: [DELIVERY],
    }),
    authorize: (request: { kind: string; dispatch_id?: string; operation_id?: string }): AuthorizationResult => {
      if (request.kind === "start") {
        started.push(request.dispatch_id ?? "")
        return { ok: true, run_id: "run-1", execution_id: "execution-1" }
      }
      operations.push(request.operation_id ?? "")
      return { ok: true, run_id: "run-1", execution_id: "execution-1", allowed_call_id: "call-1" }
    },
    inspect: async (): Promise<RunView> => ({
      run_id: "run-1",
      schema_version: 2,
      current_ir: {},
      current_compiled: {},
      pending_event_ids: [],
      executions: [],
      coverage: [],
      atom_states: [],
      semantic_checks: [],
      denied_calls: [],
    }),
  }
}

test("v2 compiler arm routes acceptEvent/advance, confirms readback, starts, and authorizes tools", async () => {
  const compiler = fakeCompiler()
  const output = { message: { id: "message-1" }, parts: [{ id: "part-1", type: "text" as const, text: "user request" }] }
  const hooks = createOpenCodeAdapter({
    arm: "compiler",
    client: {
      session: {
        messages: async () => ({
          data: [{ info: { id: "message-1" }, parts: output.parts }],
        }),
      },
    },
    observer: observer(),
    compiler,
    resolveTurn: async () => ({ runId: "run-1", inputIdentity: "input-1", taskIds: ["t-fix"] }),
    resolveV2Operation: (input, executionId) => ({
      kind: "operation",
      run_id: "run-1",
      execution_id: executionId,
      host_call_id: input.callID,
      operation_id: "op.read",
      resource_ref: { source_id: "s", digest: "sha256:0000000000000000000000000000000000000000000000000000000000000001" },
      input_refs: [],
      output_refs: [],
    }),
  }).hooks()

  await hooks["chat.message"]({ sessionID: "session-1", messageID: "message-1" }, output)
  assert.equal(compiler.events[0]?.kind, "user_input")
  assert.deepEqual(JSON.parse(output.parts[0]?.text ?? "[]"), [ATOM])
  const injected = JSON.parse(output.parts[0]?.text ?? "[]") as unknown[]
  assert.equal("authority" in (injected[0] as Record<string, unknown>), true)
  assert.equal("intent_judgments" in (injected[0] as Record<string, unknown>), true)

  await hooks["chat.params"]({ sessionID: "session-1", message: { id: "message-1" } }, {})
  assert.deepEqual(compiler.started, ["dispatch-1"])
  await hooks["chat.params"]({ sessionID: "session-1", message: { id: "title-message" } }, {})

  hooks["tool.execute.before"](
    { sessionID: "session-1", callID: "call-1", tool: "read" },
    {},
  )
  assert.deepEqual(compiler.operations, ["op.read"])

  hooks["tool.execute.after"](
    { sessionID: "session-1", callID: "call-1", tool: "read" },
    { title: "read", output: "ok" },
  )
  await hooks.event({ event: { type: "session.idle", properties: { sessionID: "session-1" } } })
  await new Promise((resolve) => setTimeout(resolve, 0))
  assert.equal(compiler.events.some((event) => event.kind === "operation_result"), true)
  assert.equal(compiler.events.some((event) => event.kind === "execution_return"), true)
})

for (const boundary of ["dispose", "cli-drain"] as const) test(`${boundary} waits for terminal assessment and returns the executor report without claiming completion`, async () => {
  const compiler = fakeCompiler()
  let advances = 0
  let assessmentFinished = false
  let releaseAssessment!: () => void
  const assessment = new Promise<void>(resolve => { releaseAssessment = resolve })
  compiler.advance = async () => {
    if (++advances > 1) { await assessment; assessmentFinished = true }
    return { ok: true, run_id: "run-1", disposition: "dispatched", pending_events: [],
      compiled_revisions: {}, ir_revisions: {}, deliveries: advances === 1 ? [DELIVERY] : [] }
  }
  const output = { message: { id: "message-1" }, parts: [{ id: "part-1", type: "text" as const, text: "user" }] }
  const hooks = createOpenCodeAdapter({
    arm: "compiler", compiler, observer: observer(),
    client: { session: { messages: async () => ({ data: [
      { info: { id: "message-1", role: "user" }, parts: output.parts },
      { info: { id: "answer-1", role: "assistant", finish: "stop" },
        parts: [
          { type: "text", text: "Blocked: file editing was denied; no implementation exists." },
          { type: "tool", tool: "bash", state: { status: "completed", input: { command: "od -An -tx1 -v /app/smoke.txt" }, output: " 6f 6b 0a\n" } },
          { type: "tool", tool: "apply_patch", state: { status: "error", error: "denied" } },
        ] },
    ] }) } },
    resolveTurn: async () => ({ runId: "run-1", inputIdentity: "input-1" }),
  }).hooks()
  await hooks["chat.message"]({ sessionID: "session-1", messageID: "message-1" }, output)
  await hooks["chat.params"]({ sessionID: "session-1", message: { id: "message-1" } }, {})
  const terminal = hooks.event({ event: { type: "session.idle", properties: { sessionID: "session-1" } } })
  let disposed = false
  const drain = (hooks as unknown as Record<string, (input: { sessionID: string }) => Promise<void>>)["experimental.execution.drain"]
  if (boundary === "cli-drain") assert.equal(typeof drain, "function", "CLI must have an explicit awaited return boundary")
  const disposal = (boundary === "dispose" ? hooks.dispose() : drain!({ sessionID: "session-1" })).then(() => { disposed = true })
  await new Promise(resolve => setTimeout(resolve, 0))
  assert.equal(disposed, false)
  const returned = compiler.events.find(event => event.kind === "execution_return")
  assert.ok(returned)
  const payload = returned.payload as { state_claim: string; text: string; outcome: { suggested_status: string }
    executor_report?: Array<{ tool_results?: Array<{ tool?: string; output?: unknown }>; tool_errors?: unknown[] }> }
  assert.equal(payload.state_claim, "stopped")
  assert.equal(payload.outcome.suggested_status, "ready")
  assert.match(payload.text, /no implementation exists/)
  const executorMessage = payload.executor_report?.at(-1)
  assert.equal(executorMessage?.tool_results?.[0]?.tool, "bash", "management judges against what the executor observed")
  assert.match(String(executorMessage?.tool_results?.[0]?.output), /6f 6b 0a/)
  assert.equal(executorMessage?.tool_errors?.length, 1)
  releaseAssessment()
  await Promise.all([terminal, disposal])
  assert.equal(assessmentFinished, true)
  assert.equal(disposed, true)
  assert.equal(compiler.events.filter(event => event.kind === "execution_return").length, 1)
})

test("a host-dispatch turn runs the pending retry without recording a user input", async () => {
  const compiler = fakeCompiler()
  const output = { message: { id: "message-2" }, parts: [{ id: "part-2", type: "text" as const, text: "Run the work the Intent Compiler has pending for this task." }] }
  const hooks = createOpenCodeAdapter({
    arm: "compiler",
    client: { session: { messages: async () => ({ data: [{ info: { id: "message-2" }, parts: output.parts }] }) } },
    observer: observer(),
    compiler,
    resolveTurn: async () => ({ runId: "run-1", inputIdentity: "input-2", taskIds: ["t-fix"], source: { source_category: HOST_DISPATCH_SOURCE_CATEGORY } }),
  }).hooks()

  await hooks["chat.message"]({ sessionID: "session-2", messageID: "message-2" }, output)
  assert.deepEqual(compiler.retryLookups, ["run-1"])
  assert.equal(compiler.events.length, 0, "no user_input event and no advance for a host turn")
  assert.deepEqual(JSON.parse(output.parts[0]?.text ?? "[]"), [ATOM])
  await hooks["chat.params"]({ sessionID: "session-2", message: { id: "message-2" } }, {})
  assert.deepEqual(compiler.started, ["dispatch-retry"], "the retry dispatch is started like any delivery")
  assert.equal(compiler.events[0]?.kind, "delivery_ack")
})

test("CLI drain waits for other in-flight hooks even when terminal processing fails", async () => {
  let release!: () => void
  const pending = new Promise<void>(resolve => { release = resolve })
  const hooks = createOpenCodeAdapter({
    arm: "raw", client: {}, observer: {
      ...observer(),
      observeEvent: async event => {
        if (event.type === "session.idle") throw new Error("terminal failed")
        if (event.type === "slow") await pending
        return true
      },
    },
  }).hooks()
  let ended = false
  const draining = hooks["experimental.execution.drain"]({ sessionID: "s" })
  const rejected = assert.rejects(draining, /return processing failed/).then(() => { ended = true })
  const other = hooks.event({ event: { type: "slow", properties: { sessionID: "s" } } })
  await new Promise(resolve => setTimeout(resolve, 0))
  assert.equal(ended, false)
  release()
  await Promise.all([other, rejected])
})

test("v2 compiler arm blocks a tool operation the compiler denies", async () => {
  const compiler = fakeCompiler()
  compiler.authorize = (request) => {
    if (request.kind === "start") return { ok: true, run_id: "run-1", execution_id: "execution-1" }
    return { ok: false, run_id: "run-1", code: "capability_unsupported", message: "denied" }
  }
  const output = { message: { id: "message-1" }, parts: [{ id: "part-1", type: "text" as const, text: "user" }] }
  const hooks = createOpenCodeAdapter({
    arm: "compiler",
    client: {
      session: {
        messages: async () => ({
          data: [{ info: { id: "message-1" }, parts: output.parts }],
        }),
      },
    },
    observer: observer(),
    compiler,
    resolveTurn: async () => ({ runId: "run-1", inputIdentity: "input-1" }),
    resolveV2Operation: (input, executionId) => ({
      kind: "operation",
      run_id: "run-1",
      execution_id: executionId,
      host_call_id: input.callID,
      operation_id: "op.write",
      resource_ref: { source_id: "r", digest: "sha256:0000000000000000000000000000000000000000000000000000000000000001" },
      input_refs: [],
      output_refs: [],
    }),
  }).hooks()

  await hooks["chat.message"]({ sessionID: "session-1", messageID: "message-1" }, output)
  await hooks["chat.params"]({ sessionID: "session-1", message: { id: "message-1" } }, {})
  assert.throws(
    () => hooks["tool.execute.before"](
      { sessionID: "session-1", callID: "call-1", tool: "write" },
      {},
    ),
    (error: unknown) => (error as { code?: string }).code === "TOOL_AUTHORIZATION_DENIED",
  )
})

test("v2 compiler arm reports missing host wait capability instead of executing a no-dispatch turn", async () => {
  const compiler = fakeCompiler()
  compiler.advance = async (): Promise<AdvanceResult> => ({
    ok: true,
    run_id: "run-1",
    disposition: "unchanged",
    pending_events: [],
    compiled_revisions: {},
    ir_revisions: {},
  })
  const output = { message: { id: "message-1" }, parts: [{ id: "part-1", type: "text" as const, text: "user request" }] }
  const hooks = createOpenCodeAdapter({
    arm: "compiler",
    client: { session: { messages: async () => ({ data: [{ info: { id: "message-1" }, parts: output.parts }] }) } },
    observer: observer(),
    compiler,
    resolveTurn: async () => ({ runId: "run-1", inputIdentity: "input-1", taskIds: ["t-fix"] }),
  }).hooks()

  await assert.rejects(
    () => hooks["chat.message"]({ sessionID: "session-1", messageID: "message-1" }, output),
    (error: unknown) => (error as { code?: string }).code === "COMPILER_HOST_WAIT_UNSUPPORTED",
  )
  assert.equal(output.parts[0]?.text, "user request", "the raw user text must not be replaced or blanked")
})

test("v2 compiler arm retries a transport-level advance failure once before rejecting the turn", async () => {
  const compiler = fakeCompiler()
  let calls = 0
  const real = compiler.advance
  compiler.advance = async (input): Promise<AdvanceResult> => {
    calls += 1
    if (calls === 1) {
      return {
        ok: false,
        run_id: "run-1",
        disposition: "failed",
        pending_events: [],
        compiled_revisions: {},
        ir_revisions: {},
        retryable: true,
        code: "invalid_candidate",
        message: "candidate rejected",
      }
    }
    return real(input)
  }
  const output = { message: { id: "message-1" }, parts: [{ id: "part-1", type: "text" as const, text: "user request" }] }
  const hooks = createOpenCodeAdapter({
    arm: "compiler",
    client: { session: { messages: async () => ({ data: [{ info: { id: "message-1" }, parts: output.parts }] }) } },
    observer: observer(),
    compiler,
    resolveTurn: async () => ({ runId: "run-1", inputIdentity: "input-1", taskIds: ["t-fix"] }),
  }).hooks()

  await hooks["chat.message"]({ sessionID: "session-1", messageID: "message-1" }, output)
  assert.equal(calls, 2)
  assert.deepEqual(JSON.parse(output.parts[0]?.text ?? "[]"), [ATOM])
})

test("v2 compiler arm reports the clarify outcome with its questions", async () => {
  const compiler = fakeCompiler()
  compiler.advance = async (): Promise<AdvanceResult> => ({
    ok: true,
    run_id: "run-1",
    disposition: "clarifying",
    pending_events: [],
    compiled_revisions: {},
    ir_revisions: {},
    questions: ["which output does the guide belong to?"],
  })
  const output = { message: { id: "message-1" }, parts: [{ id: "part-1", type: "text" as const, text: "user request" }] }
  const hooks = createOpenCodeAdapter({
    arm: "compiler",
    client: { session: { messages: async () => ({ data: [{ info: { id: "message-1" }, parts: output.parts }] }) } },
    observer: observer(),
    compiler,
    resolveTurn: async () => ({ runId: "run-1", inputIdentity: "input-1", taskIds: ["t-fix"] }),
  }).hooks()

  await assert.rejects(
    () => hooks["chat.message"]({ sessionID: "session-1", messageID: "message-1" }, output),
    (error: unknown) => {
      const typed = error as { code?: string; message?: string }
      return typed.code === "COMPILER_HOST_WAIT_UNSUPPORTED" && String(typed.message).includes("which output does the guide belong to?")
    },
  )
})
