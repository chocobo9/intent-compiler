import { test } from "node:test"
import assert from "node:assert/strict"
import { createOpenCodeAdapter, type OpenCodeObserver } from "../src/adapters/opencode.js"
import type { IntentCompilerV2, IntentCompilerV2Options } from "../src/core/intent-compiler-v2.js"
import type {
  AdvanceResult,
  AuthorizationResult,
  Atom,
  CompilerEvent,
  EventReceipt,
  ExecutionTask,
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

const EXECUTION_TASK: ExecutionTask = {
  schema_version: 2,
  dispatch_id: "dispatch-1",
  task_id: "t-fix",
  compiled_revision: 0,
  atom_id: "a-preview",
  instruction: "preview fix",
  inputs: [],
  outputs: [],
  tool_candidates: [],
  permissions: [],
  completion_rules: [],
}

const DELIVERY: {
  dispatch_id: string
  task_id: string
  atom_id: string
  digest: string
  compiled_revision: number
  execution_task?: ExecutionTask
  atom: Atom
} = {
  dispatch_id: "dispatch-1",
  task_id: "t-fix",
  atom_id: "a-preview",
  digest: "sha256:0000000000000000000000000000000000000000000000000000000000000001",
  compiled_revision: 0,
  execution_task: EXECUTION_TASK,
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
} {
  const events: CompilerEvent[] = []
  const started: string[] = []
  const operations: string[] = []
  return {
    events,
    started,
    operations,
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
  assert.deepEqual(JSON.parse(output.parts[0]?.text ?? "[]"), [EXECUTION_TASK])
  const injected = JSON.parse(output.parts[0]?.text ?? "[]") as unknown[]
  assert.equal("authority" in (injected[0] as Record<string, unknown>), false)
  assert.equal("intent_judgments" in (injected[0] as Record<string, unknown>), false)

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
  assert.deepEqual(JSON.parse(output.parts[0]?.text ?? "[]"), [EXECUTION_TASK])
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
