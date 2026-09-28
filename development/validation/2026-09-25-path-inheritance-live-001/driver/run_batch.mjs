import { createHash } from "node:crypto"
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { pathToFileURL } from "node:url"
import { performance } from "node:perf_hooks"

const SELF_TEST = process.argv[2] === "--self-test" || process.argv[2] === "--runtime-preflight"
const FAILURE_PREFLIGHT = process.argv[2] === "--failure-path-preflight"
const ROOT = resolve(SELF_TEST || FAILURE_PREFLIGHT ? (process.argv[3] ?? "") : (process.argv[2] ?? ""))
const PREFLIGHT_LABEL = process.argv[4] ?? "driver-fix-001"
const ARM = process.argv[3]
const SCENARIO = process.argv[4]
const RUN_LABEL = process.argv[5] ?? "driver-fix-001"
const DIST_ROOT_OVERRIDE = process.argv[6] ? resolve(process.argv[6]) : undefined
const MAX_REQUESTS_PER_BATCH = 3
const MAX_REQUESTS_TOTAL = 12
const BATCH_DEADLINE_MS = 900_000
const RUN_ID = "intent-case-django11163-001"
const ENDPOINT = "https://dashscope-intl.aliyuncs.com/compatible-mode/v1/chat/completions"
let activeBatchContext
let newlyCreatedFailurePreflightOutput

function fail(message) {
  process.stderr.write(`${message}\n`)
  process.exitCode = 2
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"))
}

function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8")
}

function appendJsonl(path, value) {
  mkdirSync(dirname(path), { recursive: true })
  appendFileSync(path, `${JSON.stringify(value)}\n`, "utf8")
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex")
}

function clone(value) {
  return JSON.parse(JSON.stringify(value))
}

function parseEnvFile(path, env) {
  for (const raw of readFileSync(path, "utf8").split(/\r?\n/u)) {
    const line = raw.trim()
    if (!line || line.startsWith("#") || !line.includes("=")) continue
    const index = line.indexOf("=")
    const key = line.slice(0, index).trim()
    const value = line.slice(index + 1).trim()
    if (key && value && !env[key]) env[key] = value
  }
}

function extractUserJson(body) {
  const message = body?.messages?.find((item) => item.role === "user")
  if (!message || typeof message.content !== "string") return undefined
  try { return JSON.parse(message.content) } catch { return undefined }
}

function classifyCall(body) {
  const system = String(body?.messages?.find((item) => item.role === "system")?.content ?? "")
  return /independent check/iu.test(system) ? "check" : "propose"
}

function loadRequestLedger(path) {
  if (!existsSync(path)) return []
  return readFileSync(path, "utf8").split(/\r?\n/u).filter(Boolean).map((line) => JSON.parse(line))
}

function newGate({ batchName, batchStart, requestsDir, ledgerPath }) {
  const attempts = []
  let reservedInBatch = 0
  const elapsedMs = () => performance.now() - batchStart

  async function instrumentedFetch(url, init = {}) {
    const target = String(url)
    if (!target.startsWith(ENDPOINT)) throw new Error("driver blocked a non-DashScope model endpoint")
    const elapsed = elapsedMs()
    const remaining = BATCH_DEADLINE_MS - elapsed
    if (elapsed >= BATCH_DEADLINE_MS) throw new Error("batch_deadline_exceeded_before_transmission")
    if (reservedInBatch >= MAX_REQUESTS_PER_BATCH) throw new Error("batch_request_limit_blocked_before_transmission")
    const ledger = loadRequestLedger(ledgerPath)
    if (ledger.filter((row) => row.kind === "reserved").length >= MAX_REQUESTS_TOTAL) {
      throw new Error("total_request_limit_blocked_before_transmission")
    }

    const sequence = reservedInBatch + 1
    const requestId = `${batchName}-${String(sequence).padStart(2, "0")}`
    let requestBody
    try { requestBody = JSON.parse(String(init.body ?? "{}")) } catch { requestBody = { body_parse_error: true } }
    const kind = classifyCall(requestBody)
    const input = extractUserJson(requestBody)
    const requestPath = join(requestsDir, `${String(sequence).padStart(2, "0")}-${kind}.json`)
    writeJson(requestPath, requestBody)
    reservedInBatch += 1
    const reservation = {
      kind: "reserved",
      request_id: requestId,
      batch: batchName,
      sequence_total: ledger.filter((row) => row.kind === "reserved").length + 1,
      call_kind: kind,
      model: requestBody.model ?? "unknown",
      started_at: new Date().toISOString(),
      request_sha256: sha256(JSON.stringify(requestBody)),
      request_file: requestPath,
    }
    appendJsonl(ledgerPath, reservation)
    const record = {
      request_id: requestId,
      batch: batchName,
      kind,
      model: requestBody.model ?? "unknown",
      request_file: requestPath,
      request_sha256: reservation.request_sha256,
      input_chars: typeof requestBody?.messages?.find((item) => item.role === "user")?.content === "string"
        ? requestBody.messages.find((item) => item.role === "user").content.length : null,
      prepared: kind === "check" && input?.prepared !== undefined,
      prepared_digest: input?.prepared?.digest,
      prepared_fields: input?.prepared && typeof input.prepared === "object" ? Object.keys(input.prepared) : [],
      prepared_execution_task_count: Array.isArray(input?.prepared?.execution_tasks) ? input.prepared.execution_tasks.length : null,
      prepared_json_chars: input?.prepared === undefined ? 0 : JSON.stringify(input.prepared).length,
      started_at: reservation.started_at,
      status: "in_flight",
    }
    attempts.push(record)
    appendJsonl(join(dirname(ledgerPath), `${batchName}.calls.jsonl`), record)

    const timeout = AbortSignal.timeout(Math.max(1, Math.floor(remaining)))
    const signal = init.signal ? AbortSignal.any([init.signal, timeout]) : timeout
    const started = performance.now()
    let response
    try {
      response = await globalThis.__nativeFetch(target, { ...init, signal })
    } catch (error) {
      record.status = "fetch_error"
      record.elapsed_ms = Math.round(performance.now() - started)
      record.error_name = error?.name ?? "Error"
      record.error_code = /deadline/u.test(String(error?.message)) ? "deadline" : "fetch_error"
      record.completed_at = new Date().toISOString()
      appendJsonl(join(dirname(ledgerPath), `${batchName}.calls.jsonl`), record)
      appendJsonl(ledgerPath, { kind: "completed", request_id: requestId, status: record.status, elapsed_ms: record.elapsed_ms })
      throw error
    }
    record.http_status = response.status
    record.status = response.ok ? "http_ok_stream_pending" : "http_error"
    record.response_headers_received_at = new Date().toISOString()
    appendJsonl(join(dirname(ledgerPath), `${batchName}.calls.jsonl`), record)
    appendJsonl(ledgerPath, { kind: "completed", request_id: requestId, status: record.status, http_status: response.status })

    return response
  }

  return { fetch: instrumentedFetch, attempts, get reservedInBatch() { return reservedInBatch }, elapsedMs }
}

function oldAcceptedMarker(row, eventId, ir, compiled) {
  const marker = {
    sequence: row.sequence,
    request_id: row.request_id,
    started_at: "2026-09-24T00:00:00.000Z",
    completed_at: "2026-09-24T00:00:00.000Z",
    duration_ms: 0,
    trigger_event_ids: [eventId],
    request: {},
    request_digest: "historical-accepted-marker",
    candidate: { schema_version: 2, basis: { event_ids: [eventId], refs: [] }, groups: [] },
    candidate_digest: "historical-accepted-marker",
    source_refs: {},
    attempts: [],
    status: "accepted",
    ir,
    compiled,
    retry: false,
  }
  return marker
}

function failedHistoryRecord(row, ir, compiled, digestOf) {
  return {
    sequence: row.sequence,
    request_id: row.request_id,
    started_at: "2026-09-24T00:00:00.000Z",
    completed_at: "2026-09-24T00:00:00.000Z",
    duration_ms: 0,
    trigger_event_ids: row.trigger_event_ids,
    request: row.request,
    request_digest: row.request_digest ?? digestOf(row.request),
    candidate: row.candidate,
    candidate_digest: row.candidate_digest ?? digestOf(row.candidate),
    prepared_digest: row.prepared_digest,
    source_refs: row.source_refs ?? {},
    attempts: [],
    status: row.status,
    error_code: row.error_code,
    error_message: row.error_message,
    ir,
    compiled,
    retry: false,
  }
}

function operationProbeRequest(atom, operations, runId, executionId, hostIdentity, hostCallId) {
  const rules = atom?.authority?.rules ?? []
  const rule = rules.find((row) => operations.includes(row.operation_id) && row.conditions?.length === 0)
    ?? rules.find((row) => operations.includes(row.operation_id))
  if (!rule) return undefined
  const argsDigest = `sha256:${sha256(JSON.stringify({ probe_only: true, tool_not_invoked: true }))}`
  return {
    kind: "operation",
    run_id: runId,
    execution_id: executionId,
    host_identity: hostIdentity,
    host_call_id: hostCallId,
    operation_id: rule.operation_id,
    resource_ref: rule.resource_ref,
    input_refs: rule.input_refs ?? [],
    output_refs: rule.output_refs ?? [],
    invocation: { tool: rule.operation_id, args_digest: argsDigest, raw_args: { probe_only: true } },
  }
}

function errorRecord(error) {
  return {
    name: error?.name ?? "Error",
    code: error?.code ?? "driver_error",
    message: error?.message ?? String(error),
    stack: typeof error?.stack === "string" ? error.stack : null,
  }
}

function readSnapshotForContext(context) {
  const path = join(context.runStoreDir, "v2-runs", context.runId, "snapshot.json")
  try { return existsSync(path) ? readJson(path) : undefined } catch { return undefined }
}

function summarizeExecutionView(view, snapshot) {
  const storedExecutions = Array.isArray(snapshot?.executions) ? snapshot.executions : []
  return (Array.isArray(view?.executions) ? view.executions : []).map((row) => {
    const storedExecution = storedExecutions.find((stored) => stored.execution_id === row.execution_id)
    return {
      execution_id: row.execution_id,
      status: row.status,
      closed_reason: row.closed_reason,
      allowed_calls: Array.isArray(storedExecution?.allowed_calls) ? storedExecution.allowed_calls.length : "unknown",
    }
  })
}

function writeFailureEvidence(context, error, { synthetic = false } = {}) {
  if (!context?.runDir) return undefined
  const snapshot = readSnapshotForContext(context)
  const managementRows = Array.isArray(snapshot?.management_log)
    ? snapshot.management_log.slice(context.initialManagementLogSize ?? 0)
    : []
  const calls = Array.isArray(snapshot?.management_calls) ? snapshot.management_calls : []
  const gateAttempts = context.gate?.attempts ?? []
  const newDispatches = Array.isArray(snapshot?.dispatches)
    ? snapshot.dispatches.slice(context.initialDispatchCount ?? 0)
    : []
  const driverFailure = errorRecord(error)
  const summary = {
    batch: context.batchName,
    arm: context.arm,
    scenario: context.scenario,
    stage: context.stage ?? "unknown",
    synthetic_failure_summary_probe: synthetic,
    recorded_at: new Date().toISOString(),
    driver_failure: driverFailure,
    candidate_outcomes: managementRows.map((row) => ({
      sequence: row.sequence,
      request_id: row.request_id,
      status: row.status ?? "unknown",
      rejection_cause: row.error_message ?? row.error_code ?? null,
      error_code: row.error_code ?? null,
      attempts: row.attempts ?? [],
    })),
    authorization_probe_outcomes: context.authorizationProbes ?? [],
    start_authorization_outcomes: context.startAuthorizations ?? [],
    management_requests: gateAttempts.map((attempt, index) => {
      const call = calls[(context.initialCallCount ?? 0) + index] ?? calls[index]
      return {
        request_id: attempt.request_id,
        kind: attempt.kind,
        model: attempt.model ?? "unknown",
        request_file: attempt.request_file ?? "unknown",
        request_sha256: attempt.request_sha256 ?? "unknown",
        started_at: attempt.started_at ?? null,
        completed_at: attempt.completed_at ?? call?.completed_at ?? null,
        status: attempt.status ?? "unknown",
        elapsed_ms: attempt.elapsed_ms ?? null,
        duration_ms: call?.duration_ms ?? attempt.elapsed_ms ?? null,
        http_status: attempt.http_status ?? null,
        usage: call?.usage ?? "unknown",
        management_call_status: call?.status ?? "unknown",
      }
    }),
    request_count: context.gate?.reservedInBatch ?? "unknown",
    advance_results: context.advanceResults ?? [],
    new_dispatches: newDispatches.map((row) => ({ dispatch_id: row.dispatch_id, task_id: row.task_id, atom_id: row.atom_id })),
    pending_event_ids: snapshot?.pending_event_ids ?? "unknown",
    denied_calls: snapshot?.denied_calls ?? "unknown",
  }
  try {
    writeJson(join(context.runDir, "driver-failure.json"), {
      at: summary.recorded_at,
      error_name: driverFailure.name,
      error_code: driverFailure.code,
      message: driverFailure.message,
      stack: driverFailure.stack,
      synthetic_failure_summary_probe: synthetic,
    })
    writeJson(join(context.runDir, "failure-summary.json"), summary)
    return summary
  } catch {
    return undefined
  }
}

async function runFixedOutputSelfTest() {
  if (!/^[a-z0-9-]{1,48}$/u.test(PREFLIGHT_LABEL)) throw new Error("preflight label must be a lowercase slug")
  const out = join(ROOT, "offline", `runtime-factory-${PREFLIGHT_LABEL}`)
  if (existsSync(out)) throw new Error(`runtime-factory preflight output already exists; refusing to overwrite: ${out}`)
  mkdirSync(out, { recursive: true })
  const history = readJson(join(ROOT, "shared/state/common-history.json"))
  const frozen = readJson(join(ROOT, "shared/inputs/frozen-inputs.json"))
  const fixedCheck = { schema_version: 2, verdict: "consistent", findings: [] }
  const armReports = []

  for (const arm of ["baseline", "update"]) {
    const armOut = join(out, arm)
    const storeDir = join(armOut, "compiler-store")
    const modelDir = join(armOut, "compiler-model")
    const observerDir = join(armOut, "observer-store")
    const workspace = join(armOut, "executor-workspace")
    const requestsDir = join(armOut, "requests")
    const ledgerPath = join(armOut, "request-ledger.jsonl")
    for (const directory of [storeDir, modelDir, observerDir, workspace, requestsDir]) mkdirSync(directory, { recursive: true })

    const runId = `${RUN_ID}-runtime-preflight-${arm}`
    const event = clone(history.events.first_delegation)
    event.run_id = runId
    event.event_id = `${runId}-input`
    const { createIntentCompilerRuntime, digestText: runtimeDigestText } = await import(pathToFileURL(join(ROOT, "arms", arm, "dist/index.js")).href)
    const { CANDIDATE_EXAMPLE } = await import(pathToFileURL(join(ROOT, "arms", arm, "dist/model/candidate-example.js")).href)
    const fixedCandidate = clone(CANDIDATE_EXAMPLE)
    fixedCandidate.basis.event_ids = [event.event_id]
    const eventText = String(event.payload?.text ?? "")
    const expectedSourceDigest = runtimeDigestText(eventText)
    const bindSources = (value) => {
      if (Array.isArray(value)) {
        for (const child of value) bindSources(child)
        return
      }
      if (value === null || typeof value !== "object") return
      if (typeof value.source_id === "string") {
        value.source_id = event.event_id
        value.digest = expectedSourceDigest
      }
      for (const child of Object.values(value)) bindSources(child)
    }
    bindSources(fixedCandidate)
    const fixedCandidateText = JSON.stringify(fixedCandidate)
    let fixedFetchCalls = 0
    let openCodeCalls = 0
    const fixedFetch = async (url, init) => {
      fixedFetchCalls += 1
      if (String(url) !== ENDPOINT) throw new Error("runtime preflight blocked a non-DashScope endpoint")
      const requestBody = JSON.parse(String(init?.body ?? "{}"))
      const system = String(requestBody.messages?.find((row) => row.role === "system")?.content ?? "")
      const content = /independent check/iu.test(system) ? JSON.stringify(fixedCheck) : fixedCandidateText
      const chunk = {
        choices: [{ delta: { content } }],
        usage: {
          prompt_tokens: 25,
          completion_tokens: 18,
          completion_tokens_details: { reasoning_tokens: 7 },
        },
      }
      return new Response(`data: ${JSON.stringify(chunk)}\n\ndata: [DONE]\n\n`, {
        status: 200,
        headers: { "content-type": "text/event-stream" },
      })
    }
    const gate = newGate({
      batchName: `runtime-preflight-${PREFLIGHT_LABEL}-${arm}`,
      batchStart: performance.now(),
      requestsDir,
      ledgerPath,
    })
    const priorFetch = globalThis.fetch
    const forbiddenOpenCodeCall = async () => {
      openCodeCalls += 1
      throw new Error("OpenCode client must not be called during DashScope runtime preflight")
    }
    globalThis.__nativeFetch = fixedFetch
    globalThis.fetch = gate.fetch
    try {
      const client = { session: { create: forbiddenOpenCodeCall, prompt: forbiddenOpenCodeCall } }
      const compiler = createIntentCompilerRuntime({
        client,
        config: {
          transport: "dashscope",
          model: { providerId: frozen.compiler_config_from_frozen_case.provider, modelId: frozen.compiler_config_from_frozen_case.model },
          paths: { compilerStoreDir: storeDir, compilerModelDir: modelDir, observerStoreDir: observerDir, executorWorkspaceDir: workspace },
          capabilities: { operations: ["read", "write", "edit", "bash", "glob", "grep"], workspaceRoot: workspace },
          env: { DASHSCOPE_API_KEY: "runtime-preflight-fixed-placeholder" },
        },
      })
      const receipt = await compiler.acceptEvent(event)
      if (!receipt.ok && receipt.status !== "duplicate") throw new Error(`runtime preflight event rejected: ${receipt.code ?? "unknown"}`)
      const advance = await compiler.advance({ runId })
      const view = await compiler.inspect({ runId })
      const snapshot = readJson(join(storeDir, "v2-runs", runId, "snapshot.json"))
      const managementRecord = snapshot.management_log.at(-1)
      const semanticCheck = snapshot.semantic_checks.at(-1)
      const checkAttempt = gate.attempts.find((attempt) => attempt.kind === "check")
      const checkBody = checkAttempt ? readJson(checkAttempt.request_file) : undefined
      const checkInput = checkBody ? extractUserJson(checkBody) : undefined
      const delivery = advance?.deliveries?.[0]
      const deliveryTask = delivery?.execution_task
      const deliveryHasConstraints = Array.isArray(deliveryTask?.constraints)
      const deliveryHasReturnWhen = Array.isArray(deliveryTask?.return_when)
      const modelCalls = snapshot.management_calls ?? []
      const requestBodies = gate.attempts.map((attempt) => readJson(attempt.request_file))
      if (!advance.ok) throw new Error(`runtime preflight management advance failed: ${advance.code ?? "unknown"}`)
      if (managementRecord?.status !== "accepted") throw new Error("runtime preflight result was not recorded as an accepted candidate")
      if (semanticCheck?.verdict !== "consistent") throw new Error("runtime preflight fixed check was not recorded")
      if (gate.reservedInBatch !== 2 || gate.attempts.length !== 2 || fixedFetchCalls !== 2 || modelCalls.length !== 2) {
        throw new Error("runtime preflight did not make exactly one proposal and one check through the fixed network boundary")
      }
      const expectsUpdateBatchFields = arm === "update"
      if (Boolean(checkInput?.prepared) !== expectsUpdateBatchFields) {
        throw new Error(`runtime preflight check input prepared presence differs from the frozen arm contract (${arm})`)
      }
      if (checkInput?.prepared && !Array.isArray(checkInput.prepared.execution_tasks)) {
        throw new Error("runtime preflight prepared check input is missing execution tasks")
      }
      if (!deliveryTask || deliveryHasConstraints !== expectsUpdateBatchFields || deliveryHasReturnWhen !== expectsUpdateBatchFields) {
        throw new Error(`runtime preflight delivery fields differ from the frozen arm contract (${arm})`)
      }
      if (openCodeCalls !== 0) throw new Error("runtime preflight called the forbidden OpenCode client")
      if (requestBodies.some((body) => JSON.stringify(body).includes("runtime-preflight-fixed-placeholder"))) {
        throw new Error("runtime preflight request-body logging exposed the placeholder API key")
      }
      const report = {
        arm,
        status: "passed",
        external_network_calls: 0,
        fixed_network_boundary_calls: fixedFetchCalls,
        opencode_method_calls: openCodeCalls,
        event_accepted: receipt.ok || receipt.status === "duplicate",
        advance_ok: advance.ok,
        candidate_recorded_status: managementRecord.status,
        semantic_check_recorded_verdict: semanticCheck.verdict,
        management_requests: modelCalls.map((call) => ({ kind: call.kind, status: call.status, duration_ms: call.duration_ms, usage: call.usage ?? "unknown" })),
        check_input_top_level_fields: Object.keys(checkInput),
        prepared_check_present: Boolean(checkInput.prepared),
        prepared_check_fields: checkInput.prepared ? Object.keys(checkInput.prepared) : [],
        prepared_check_json_chars: checkInput.prepared ? JSON.stringify(checkInput.prepared).length : 0,
        delivery_formed: Boolean(delivery),
        delivery_constraints_present: deliveryHasConstraints,
        delivery_constraints_count: deliveryHasConstraints ? deliveryTask.constraints.length : null,
        delivery_return_when_present: deliveryHasReturnWhen,
        delivery_return_when_count: deliveryHasReturnWhen ? deliveryTask.return_when.length : null,
        pending_event_ids_after: view.pending_event_ids,
        unresolved_user_event_ids_after: view.unresolved_user_event_ids,
        output_dir: armOut,
      }
      writeJson(join(armOut, "preflight-report.json"), report)
      writeJson(join(armOut, "compiler-store-snapshot.json"), snapshot)
      writeJson(join(armOut, "final-view.json"), view)
      armReports.push(report)
    } finally {
      globalThis.fetch = priorFetch
      delete globalThis.__nativeFetch
    }
  }

  let boundaryFetchCalls = 0
  const boundaryFetch = async () => {
    boundaryFetchCalls += 1
    return new Response("fixed boundary response", { status: 200 })
  }
  const boundaryRequest = { model: "fixed", messages: [{ role: "user", content: "fixed boundary probe" }] }
  const requestBoundary = newGate({
    batchName: `runtime-preflight-${PREFLIGHT_LABEL}-request-boundary`,
    batchStart: performance.now(),
    requestsDir: join(out, "request-boundary"),
    ledgerPath: join(out, "request-boundary-ledger.jsonl"),
  })
  const priorFetch = globalThis.fetch
  globalThis.__nativeFetch = boundaryFetch
  globalThis.fetch = requestBoundary.fetch
  let perBatchBlocked = false
  try {
    await requestBoundary.fetch(ENDPOINT, { method: "POST", body: JSON.stringify(boundaryRequest) })
    await requestBoundary.fetch(ENDPOINT, { method: "POST", body: JSON.stringify(boundaryRequest) })
    await requestBoundary.fetch(ENDPOINT, { method: "POST", body: JSON.stringify(boundaryRequest) })
    try { await requestBoundary.fetch(ENDPOINT, { method: "POST", body: JSON.stringify(boundaryRequest) }) }
    catch (error) { perBatchBlocked = /request_limit_blocked/u.test(String(error?.message)) }
  } finally {
    globalThis.fetch = priorFetch
    delete globalThis.__nativeFetch
  }
  if (!perBatchBlocked || requestBoundary.reservedInBatch !== 3 || boundaryFetchCalls !== 3) {
    throw new Error("runtime preflight did not enforce the three-request boundary")
  }

  const beforeDeadlineCalls = boundaryFetchCalls
  const deadlineBoundary = newGate({
    batchName: `runtime-preflight-${PREFLIGHT_LABEL}-deadline-boundary`,
    batchStart: performance.now() - BATCH_DEADLINE_MS,
    requestsDir: join(out, "deadline-boundary"),
    ledgerPath: join(out, "deadline-boundary-ledger.jsonl"),
  })
  let deadlineBlocked = false
  try { await deadlineBoundary.fetch(ENDPOINT, { method: "POST", body: JSON.stringify(boundaryRequest) }) }
  catch (error) { deadlineBlocked = /deadline_exceeded/u.test(String(error?.message)) }
  if (!deadlineBlocked || boundaryFetchCalls !== beforeDeadlineCalls) throw new Error("runtime preflight did not enforce the 900-second deadline boundary")

  const totalLedger = join(out, "total-boundary-ledger.jsonl")
  for (let index = 0; index < MAX_REQUESTS_TOTAL; index++) appendJsonl(totalLedger, { kind: "reserved", request_id: `seed-${index}` })
  const totalBoundary = newGate({
    batchName: `runtime-preflight-${PREFLIGHT_LABEL}-total-boundary`,
    batchStart: performance.now(),
    requestsDir: join(out, "total-boundary"),
    ledgerPath: totalLedger,
  })
  let totalBlocked = false
  try { await totalBoundary.fetch(ENDPOINT, { method: "POST", body: JSON.stringify(boundaryRequest) }) }
  catch (error) { totalBlocked = /total_request_limit_blocked/u.test(String(error?.message)) }
  if (!totalBlocked || boundaryFetchCalls !== beforeDeadlineCalls) throw new Error("runtime preflight did not enforce the twelve-request total boundary")

  const report = {
    status: "passed",
    external_network_calls: 0,
    fixed_network_boundary_calls: armReports.reduce((sum, item) => sum + item.fixed_network_boundary_calls, 0),
    opencode_method_calls: armReports.reduce((sum, item) => sum + item.opencode_method_calls, 0),
    arms: armReports,
    request_limit: "three transmissions allowed; fourth blocked before the network stub",
    total_limit: "twelve seeded reservations block request thirteen before the network stub",
    deadline: "a request at 900000 ms elapsed is blocked before the network stub",
    offline_output_dir: out,
  }
  writeJson(join(out, "preflight-report.json"), report)
  process.stdout.write(`${JSON.stringify(report)}\n`)
}

async function runFailurePathPreflight() {
  if (!/^[a-z0-9-]{1,48}$/u.test(PREFLIGHT_LABEL)) throw new Error("preflight label must be a lowercase slug")
  const out = join(ROOT, "offline", `failure-path-${PREFLIGHT_LABEL}`)
  if (existsSync(out)) throw new Error(`failure-path preflight output already exists; refusing to overwrite: ${out}`)
  mkdirSync(out, { recursive: true })
  newlyCreatedFailurePreflightOutput = out
  const history = readJson(join(ROOT, "shared/state/common-history.json"))
  const frozen = readJson(join(ROOT, "shared/inputs/frozen-inputs.json"))
  const armReports = []

  for (const arm of ["baseline", "update"]) {
    const armOut = join(out, arm)
    const storeDir = join(armOut, "compiler-store")
    const modelDir = join(armOut, "compiler-model")
    const observerDir = join(armOut, "observer-store")
    const workspace = join(armOut, "executor-workspace")
    const requestsDir = join(armOut, "requests")
    const ledgerPath = join(armOut, "request-ledger.jsonl")
    for (const directory of [storeDir, modelDir, observerDir, workspace, requestsDir]) mkdirSync(directory, { recursive: true })

    const runId = `${RUN_ID}-failure-preflight-${arm}`
    const firstEvent = clone(history.events.first_delegation)
    firstEvent.run_id = runId
    firstEvent.event_id = `${runId}-first`
    const updateEvent = clone(history.events.user_update)
    updateEvent.run_id = runId
    updateEvent.event_id = `${runId}-update`
    const { createIntentCompilerRuntime, IntentStoreV2, digestOf, digestText: runtimeDigestText } = await import(pathToFileURL(join(ROOT, "arms", arm, "dist/index.js")).href)
    const { CANDIDATE_EXAMPLE } = await import(pathToFileURL(join(ROOT, "arms", arm, "dist/model/candidate-example.js")).href)

    const store = new IntentStoreV2({ storeDir, runId })
    const accepted = await store.acceptEvent(firstEvent)
    if (!accepted.ok) throw new Error(`failure-path preflight common-state event rejected: ${accepted.code ?? "unknown"}`)
    const original = history.state
    const readyAtoms = original.atom_states.map((row) => ({ ...row, status: "ready" }))
    store.applyDeltas({
      ir: original.ir,
      compiled: original.compiled,
      pending_event_ids: [],
      unresolved_user_event_ids: [],
      dispatches: original.dispatches,
      executions: [],
      atom_states: readyAtoms,
      compiled_intent_sequence: original.compiled_intent_sequence,
      management_log_record: oldAcceptedMarker(history.prior_history.accepted_turn_1, firstEvent.event_id, original.ir, original.compiled),
    })
    store.applyDeltas({
      management_log_record: failedHistoryRecord(history.prior_history.rejected_turn_2, original.ir, original.compiled, digestOf),
      semantic_checks: [history.prior_history.semantic_check],
    })

    const updateAtom = original.compiled.t1?.atoms?.find((item) => item.atom_id === "a1")
    const fixedCandidate = clone(CANDIDATE_EXAMPLE)
    fixedCandidate.basis.event_ids = [updateEvent.event_id]
    fixedCandidate.groups[0].task_refs = ["offline-missing-task"]
    const expectedSourceDigest = runtimeDigestText(String(updateEvent.payload?.text ?? ""))
    const bindSources = (value) => {
      if (Array.isArray(value)) {
        for (const child of value) bindSources(child)
        return
      }
      if (value === null || typeof value !== "object") return
      if (typeof value.source_id === "string") {
        value.source_id = updateEvent.event_id
        value.digest = expectedSourceDigest
      }
      for (const child of Object.values(value)) bindSources(child)
    }
    bindSources(fixedCandidate)
    const fixedCandidateText = JSON.stringify(fixedCandidate)
    const fixedCheck = JSON.stringify({ schema_version: 2, verdict: "consistent", findings: [] })
    let fixedFetchCalls = 0
    let openCodeCalls = 0
    const fixedFetch = async (url, init) => {
      fixedFetchCalls += 1
      if (String(url) !== ENDPOINT) throw new Error("failure-path preflight blocked a non-DashScope endpoint")
      const requestBody = JSON.parse(String(init?.body ?? "{}"))
      const kind = classifyCall(requestBody)
      const content = kind === "check" ? fixedCheck : fixedCandidateText
      const chunk = {
        choices: [{ delta: { content } }],
        usage: { prompt_tokens: 31, completion_tokens: 27, completion_tokens_details: { reasoning_tokens: 11 } },
      }
      return new Response(`data: ${JSON.stringify(chunk)}\n\ndata: [DONE]\n\n`, {
        status: 200,
        headers: { "content-type": "text/event-stream" },
      })
    }
    const batchStart = performance.now()
    const gate = newGate({
      batchName: `failure-preflight-${PREFLIGHT_LABEL}-${arm}`,
      batchStart,
      requestsDir,
      ledgerPath,
    })
    const priorFetch = globalThis.fetch
    const forbiddenOpenCodeCall = async () => {
      openCodeCalls += 1
      throw new Error("OpenCode client must not be called during failure-path preflight")
    }
    globalThis.__nativeFetch = fixedFetch
    globalThis.fetch = gate.fetch

    const context = {
      runDir: armOut,
      runStoreDir: storeDir,
      runId,
      arm,
      scenario: "user-update-failure-path-preflight",
      batchName: `failure-preflight-${PREFLIGHT_LABEL}-${arm}`,
      stage: "runtime_factory_initialized",
      gate,
      initialManagementLogSize: 2,
      initialCallCount: 0,
      initialDispatchCount: original.dispatches.length,
      authorizationProbes: [],
      startAuthorizations: [],
      advanceResults: [],
    }
    activeBatchContext = context
    try {
      const client = { session: { create: forbiddenOpenCodeCall, prompt: forbiddenOpenCodeCall } }
      const compiler = createIntentCompilerRuntime({
        client,
        config: {
          transport: "dashscope",
          model: { providerId: frozen.compiler_config_from_frozen_case.provider, modelId: frozen.compiler_config_from_frozen_case.model },
          paths: { compilerStoreDir: storeDir, compilerModelDir: modelDir, observerStoreDir: observerDir, executorWorkspaceDir: workspace },
          capabilities: { operations: ["read", "write", "edit", "bash", "glob", "grep"], workspaceRoot: workspace },
          env: { DASHSCOPE_API_KEY: "failure-path-preflight-fixed-placeholder" },
        },
      })

      const dispatch = original.dispatches[0]
      const hostIdentity = "failure-path-preflight-host"
      const startResult = compiler.authorize({ kind: "start", run_id: runId, dispatch_id: dispatch.dispatch_id, host_identity: hostIdentity })
      context.startAuthorizations.push({ phase: "before_update", result: startResult })
      if (!startResult.ok || !startResult.execution_id) throw new Error(`failure-path preflight could not establish active execution: ${startResult.code ?? "missing execution id"}`)
      const executionId = startResult.execution_id

      const beforeRequest = operationProbeRequest(updateAtom, ["read", "write", "edit", "bash", "glob", "grep"], runId, executionId, hostIdentity, "failure-path-probe-before-update")
      if (!beforeRequest) throw new Error("failure-path preflight found no operation authority rule")
      const beforeResult = compiler.authorize(beforeRequest)
      context.authorizationProbes.push({ phase: "before_update", request: beforeRequest, result: beforeResult })
      if (!beforeResult.ok) throw new Error(`failure-path preflight allow probe was denied: ${beforeResult.code ?? "unknown"}`)

      context.stage = "user_update_accepted"
      const eventReceipt = await compiler.acceptEvent(updateEvent)
      if (!eventReceipt.ok && eventReceipt.status !== "duplicate") throw new Error(`failure-path preflight update rejected: ${eventReceipt.code ?? "unknown"}`)
      const pendingRequest = operationProbeRequest(updateAtom, ["read", "write", "edit", "bash", "glob", "grep"], runId, executionId, hostIdentity, "failure-path-probe-update-pending")
      const pendingResult = compiler.authorize(pendingRequest)
      context.authorizationProbes.push({ phase: "while_update_pending", request: pendingRequest, result: pendingResult })

      const beforeDispatchCount = store.current().dispatches.length
      context.stage = "repeated_candidate_rejection"
      const advance = await compiler.advance({ runId })
      context.advanceResults.push({ ok: advance.ok, code: advance.code ?? null, disposition: advance.disposition ?? null, delivery_count: advance.deliveries?.length ?? 0 })
      const afterRequest = operationProbeRequest(updateAtom, ["read", "write", "edit", "bash", "glob", "grep"], runId, executionId, hostIdentity, "failure-path-probe-after-rejection")
      const afterResult = compiler.authorize(afterRequest)
      context.authorizationProbes.push({ phase: "after_candidate_rejection", request: afterRequest, result: afterResult })

      const snapshot = readJson(join(storeDir, "v2-runs", runId, "snapshot.json"))
      const view = await compiler.inspect({ runId })
      const executionSummary = summarizeExecutionView(view, snapshot)
      const newRows = snapshot.management_log.slice(context.initialManagementLogSize)
      const newCalls = snapshot.management_calls.slice(context.initialCallCount)
      const newDispatches = snapshot.dispatches.slice(beforeDispatchCount)
      const requestKinds = gate.attempts.map((attempt) => attempt.kind)
      const hostOperation = (probe) => ({
        run_id: probe.request.run_id,
        execution_id: probe.request.execution_id,
        host_identity: probe.request.host_identity,
        operation_id: probe.request.operation_id,
        resource_ref: probe.request.resource_ref,
      })
      const probeScopeMatches = context.authorizationProbes.every((probe) => JSON.stringify(hostOperation(probe)) === JSON.stringify(hostOperation(context.authorizationProbes[0])))
      const hostCallIds = context.authorizationProbes.map((probe) => probe.request.host_call_id)
      const allowedProbe = context.authorizationProbes.find((probe) => probe.phase === "before_update")
      const deniedProbe = arm === "update"
        ? context.authorizationProbes.find((probe) => probe.phase === "while_update_pending")
        : undefined
      const candidateRejected = newRows.some((row) => row.status === "validation_failed" || row.status === "rejected")
      const noDelivery = newDispatches.length === 0 && (advance.deliveries?.length ?? 0) === 0
      const repeatedProposals = requestKinds.length >= 2 && requestKinds.every((kind) => kind === "propose")
      const viewOmitsAllowedCalls = view.executions.length > 0 && !Object.hasOwn(view.executions[0], "allowed_calls")
      const storedAllowedCalls = snapshot.executions.find((row) => row.execution_id === executionId)?.allowed_calls
      const allowedCallCountReadFromStoredRecord = executionSummary.find((row) => row.execution_id === executionId)?.allowed_calls
      if (!candidateRejected || !noDelivery || !repeatedProposals || !allowedProbe?.result?.ok || !probeScopeMatches || new Set(hostCallIds).size !== hostCallIds.length) {
        throw new Error(`failure-path preflight did not reach its rejection, no-delivery, and authorization-probe assertions for ${arm}`)
      }
      if (!viewOmitsAllowedCalls || !Array.isArray(storedAllowedCalls) || allowedCallCountReadFromStoredRecord !== storedAllowedCalls.length) {
        throw new Error("failure-path preflight did not verify execution call counts come from persisted records when the view omits them")
      }
      if (arm === "update" && (!deniedProbe || deniedProbe.result.ok || deniedProbe.result.code !== "user_update_pending")) {
        throw new Error("update-arm deny probe did not record the expected pending-update authorization refusal")
      }
      const afterRejectionProbe = context.authorizationProbes.find((probe) => probe.phase === "after_candidate_rejection")
      if (arm === "update" && (!afterRejectionProbe || afterRejectionProbe.result.ok || afterRejectionProbe.result.code !== "user_update_pending")) {
        throw new Error("update-arm authorization probe after candidate rejection did not retain the pending-update refusal")
      }
      if (arm === "baseline" && context.authorizationProbes.find((probe) => probe.phase === "while_update_pending")?.result?.ok !== true) {
        throw new Error("baseline-arm allow probe did not remain allowed after the user update")
      }
      if (arm === "baseline" && afterRejectionProbe?.result?.ok !== true) {
        throw new Error("baseline-arm authorization after candidate rejection did not remain allowed")
      }
      if (fixedFetchCalls !== gate.reservedInBatch || fixedFetchCalls !== gate.attempts.length || openCodeCalls !== 0) {
        throw new Error("failure-path preflight did not stay within the fixed response boundary")
      }
      if (newCalls.length !== gate.attempts.length || newCalls.some((call) => call.status !== "ok")) {
        throw new Error("failure-path preflight management requests were not completely recorded")
      }

      context.stage = "failure_summary_probe"
      const sentinel = new Error("offline-only sentinel: validate failure summary preservation")
      sentinel.code = "offline_failure_summary_sentinel"
      let failureSummary
      try { throw sentinel } catch (error) { failureSummary = writeFailureEvidence(context, error, { synthetic: true }) }
      const persistedSummary = readJson(join(armOut, "failure-summary.json"))
      const failureRecord = readJson(join(armOut, "driver-failure.json"))
      if (!failureSummary || !failureRecord.stack || !persistedSummary.driver_failure.stack
        || persistedSummary.candidate_outcomes.length === 0
        || persistedSummary.authorization_probe_outcomes.length < 3
        || persistedSummary.management_requests.length !== gate.attempts.length
        || persistedSummary.management_requests.some((call) => !call.request_file || !call.request_sha256 || !Number.isFinite(call.duration_ms))
        || persistedSummary.synthetic_failure_summary_probe !== true) {
        throw new Error("failure-path preflight summary did not retain stack, requests, rejected candidates, and authorization evidence")
      }

      const report = {
        arm,
        status: "passed",
        external_network_calls: 0,
        fixed_network_boundary_calls: fixedFetchCalls,
        opencode_method_calls: openCodeCalls,
        event_accepted: eventReceipt.ok || eventReceipt.status === "duplicate",
        candidate_records: newRows.map((row) => ({ status: row.status, error_code: row.error_code ?? null, error_message: row.error_message ?? null, attempts: row.attempts?.length ?? 0 })),
        management_requests: newCalls.map((call) => ({ kind: call.kind, status: call.status, duration_ms: call.duration_ms, usage: call.usage ?? "unknown" })),
        dispatches_added_after_candidate: newDispatches.length,
        authorization_probes: context.authorizationProbes.map((probe) => ({
          phase: probe.phase,
          host_identity: probe.request.host_identity,
          host_call_id: probe.request.host_call_id,
          operation_id: probe.request.operation_id,
          ok: probe.result.ok,
          code: probe.result.code ?? null,
        })),
        same_execution_host_operation_scope: probeScopeMatches,
        distinct_host_call_ids: new Set(hostCallIds).size === hostCallIds.length,
        view_omits_allowed_calls: viewOmitsAllowedCalls,
        allowed_call_count_from_persisted_execution: allowedCallCountReadFromStoredRecord,
        failure_summary_preserved: {
          stack: Boolean(persistedSummary.driver_failure.stack),
          request_count: persistedSummary.management_requests.length,
          candidate_outcome_count: persistedSummary.candidate_outcomes.length,
          authorization_probe_count: persistedSummary.authorization_probe_outcomes.length,
          synthetic_driver_failure_marked: persistedSummary.synthetic_failure_summary_probe,
        },
        external_calls: 0,
        output_dir: armOut,
      }
      writeJson(join(armOut, "failure-path-preflight-report.json"), report)
      writeJson(join(armOut, "compiler-store-snapshot.json"), snapshot)
      armReports.push(report)
    } finally {
      globalThis.fetch = priorFetch
      delete globalThis.__nativeFetch
    }
    activeBatchContext = undefined
  }

  const report = {
    status: "passed",
    external_network_calls: 0,
    opencode_method_calls: armReports.reduce((sum, row) => sum + row.opencode_method_calls, 0),
    fixed_network_boundary_calls: armReports.reduce((sum, row) => sum + row.fixed_network_boundary_calls, 0),
    arms: armReports,
    purpose: "Offline-only verification of repeated mechanical candidate rejection, no new dispatch, same-identity allow/deny probes, and failure-summary preservation. Synthetic usage is not a cost estimate.",
    offline_output_dir: out,
  }
  writeJson(join(out, "preflight-report.json"), report)
  process.stdout.write(`${JSON.stringify(report)}\n`)
}

async function main() {
  if (SELF_TEST) {
    await runFixedOutputSelfTest()
    return
  }
  if (FAILURE_PREFLIGHT) {
    await runFailurePathPreflight()
    return
  }
  if (!ROOT || !["baseline", "update"].includes(ARM) || !["first", "user-update"].includes(SCENARIO)) {
    throw new Error("usage: node run_batch.mjs <experiment-root> <baseline|update> <first|user-update> [run-label] [dist-root]")
  }
  if (!/^[a-z0-9-]{1,48}$/u.test(RUN_LABEL)) throw new Error("run label must be a lowercase slug")
  const freeze = readJson(join(ROOT, "FREEZE.json"))
  const inputs = readJson(join(ROOT, "shared/inputs/frozen-inputs.json"))
  const history = readJson(join(ROOT, "shared/state/common-history.json"))
  const runRoot = join(ROOT, "raw", RUN_LABEL)
  const runDir = join(runRoot, `${ARM}-${SCENARIO}`)
  if (existsSync(runDir)) throw new Error(`batch output already exists; refusing to rerun: ${runDir}`)
  mkdirSync(runDir, { recursive: true })
  const requestDir = join(runDir, "requests")
  mkdirSync(requestDir, { recursive: true })
  const ledgerPath = join(ROOT, "raw", "management-request-ledger.jsonl")
  const batchName = `${RUN_LABEL}-${ARM}-${SCENARIO}`
  const startedAt = new Date().toISOString()
  const batchStart = performance.now()
  const frozenCompiler = inputs.compiler_config_from_frozen_case
  const workspace = history.prior_history.rejected_turn_2.request.capabilities.workspace_root
  const env = { ...process.env }
  parseEnvFile(resolve(ROOT, "../../../.env"), env)
  if (!env.DASHSCOPE_API_KEY) throw new Error("required provider credential is unavailable in the process environment")

  const armRoot = join(ROOT, "arms", ARM)
  const distRoot = DIST_ROOT_OVERRIDE ?? join(armRoot, "dist")
  const distEntry = join(distRoot, "index.js")
  if (!existsSync(distEntry)) throw new Error(`runtime dist entry is missing: ${distEntry}`)
  const { createIntentCompilerRuntime, IntentStoreV2, digestOf } = await import(pathToFileURL(distEntry).href)
  const runStoreDir = join(runDir, "compiler-store")
  const modelDir = join(runDir, "compiler-model")
  const observerDir = join(runDir, "observer-store")
  mkdirSync(modelDir, { recursive: true })
  mkdirSync(observerDir, { recursive: true })
  activeBatchContext = {
    runDir,
    runStoreDir,
    runId: RUN_ID,
    arm: ARM,
    scenario: SCENARIO,
    batchName,
    stage: "run_directory_prepared",
    initialManagementLogSize: SCENARIO === "user-update" ? 2 : 0,
    initialCallCount: 0,
    initialDispatchCount: SCENARIO === "user-update" ? history.state.dispatches.length : 0,
    authorizationProbes: [],
    startAuthorizations: [],
    advanceResults: [],
  }

  if (SCENARIO === "user-update") {
    // Rebuild a minimal paired store from the selected historical state. The
    // old candidate/request/finding are exact; unrelated logs, raw model output
    // and historic budget accounting are not copied.
    const store = new IntentStoreV2({ storeDir: runStoreDir, runId: RUN_ID })
    const original = history.state
    const event1 = clone(history.events.first_delegation)
    const accepted = await store.acceptEvent(event1)
    if (!accepted.ok) throw new Error(`common-state event seed rejected: ${accepted.code ?? "unknown"}`)
    const readyAtoms = original.atom_states.map((row) => ({ ...row, status: "ready" }))
    store.applyDeltas({
      ir: original.ir,
      compiled: original.compiled,
      pending_event_ids: [],
      unresolved_user_event_ids: [],
      dispatches: original.dispatches,
      executions: [],
      atom_states: readyAtoms,
      compiled_intent_sequence: original.compiled_intent_sequence,
      management_log_record: oldAcceptedMarker(history.prior_history.accepted_turn_1, event1.event_id, original.ir, original.compiled),
    })
    store.applyDeltas({
      management_log_record: failedHistoryRecord(history.prior_history.rejected_turn_2, original.ir, original.compiled, digestOf),
      semantic_checks: [history.prior_history.semantic_check],
    })
  }

  const baseFetch = globalThis.fetch.bind(globalThis)
  let compiler
  const gate = newGate({
    batchName,
    batchStart,
    requestsDir: requestDir,
    ledgerPath,
  })
  activeBatchContext.gate = gate
  globalThis.__nativeFetch = baseFetch
  globalThis.fetch = gate.fetch

  let openCodeCalls = 0
  const forbiddenOpenCodeCall = async () => {
    openCodeCalls += 1
    throw new Error("OpenCode client must not be called by the DashScope experiment")
  }
  compiler = createIntentCompilerRuntime({
    client: { session: { create: forbiddenOpenCodeCall, prompt: forbiddenOpenCodeCall } },
    config: {
      transport: "dashscope",
      model: { providerId: frozenCompiler.provider, modelId: frozenCompiler.model },
      paths: {
        compilerStoreDir: runStoreDir,
        compilerModelDir: modelDir,
        observerStoreDir: observerDir,
        executorWorkspaceDir: workspace,
      },
      capabilities: { operations: ["read", "write", "edit", "bash", "glob", "grep"], workspaceRoot: workspace },
      env,
    },
  })
  activeBatchContext.stage = "runtime_factory_initialized"

  const advanceResults = []
  let authProbe
  let authAfterUpdate
  let startBeforeUpdate
  let updateAcceptedAt
  let managementResultAt
  let operationAuthorizationAfterAt
  let deliveryStartAuthorizationAt
  let deliveryStartAuthorization
  let eventReceipt
  let syntheticExecutionId
  let updateAtom

  if (SCENARIO === "first") {
    const event = clone(history.events.first_delegation)
    activeBatchContext.stage = "first_delegation_event_received"
    eventReceipt = await compiler.acceptEvent(event)
    if (!eventReceipt.ok && eventReceipt.status !== "duplicate") throw new Error(`first input rejected: ${eventReceipt.code ?? "unknown"}`)
    activeBatchContext.stage = "first_delegation_advance"
    advanceResults.push(await compiler.advance({ runId: RUN_ID }))
    activeBatchContext.advanceResults.push({ ok: advanceResults.at(-1).ok, code: advanceResults.at(-1).code ?? null, delivery_count: advanceResults.at(-1).deliveries?.length ?? 0 })
  } else {
    const dispatch = history.state.dispatches[0]
    const start = compiler.authorize({ kind: "start", run_id: RUN_ID, dispatch_id: dispatch.dispatch_id, host_identity: "paired-experiment-host" })
    startBeforeUpdate = start
    if (!start.ok || !start.execution_id) throw new Error(`failed to create controlled active state: ${start.code ?? "no execution id"}`)
    syntheticExecutionId = start.execution_id
    activeBatchContext.startAuthorizations.push({ phase: "before_update", result: start })
    updateAtom = history.state.compiled.t1?.atoms?.find((item) => item.atom_id === dispatch.atom_id)
    const event = clone(history.events.user_update)
    activeBatchContext.stage = "user_update_event_received"
    eventReceipt = await compiler.acceptEvent(event)
    if (!eventReceipt.ok && eventReceipt.status !== "duplicate") throw new Error(`update input rejected: ${eventReceipt.code ?? "unknown"}`)
    updateAcceptedAt = new Date().toISOString()

    const operation = operationProbeRequest(updateAtom, ["read", "write", "edit", "bash", "glob", "grep"], RUN_ID, syntheticExecutionId, "paired-experiment-host", "real-probe-while-update-pending")
    authProbe = operation ? compiler.authorize(operation) : { ok: false, code: "no_existing_operation_rule" }
    if (operation) activeBatchContext.authorizationProbes.push({ phase: "while_update_pending", request: operation, result: authProbe })
    activeBatchContext.stage = "user_update_advance"
    advanceResults.push(await compiler.advance({ runId: RUN_ID }))
    activeBatchContext.advanceResults.push({ ok: advanceResults.at(-1).ok, code: advanceResults.at(-1).code ?? null, delivery_count: advanceResults.at(-1).deliveries?.length ?? 0 })
    managementResultAt = new Date().toISOString()
    const finalResult = advanceResults.at(-1)
    const currentOperation = operationProbeRequest(updateAtom, ["read", "write", "edit", "bash", "glob", "grep"], RUN_ID, syntheticExecutionId, "paired-experiment-host", "real-probe-after-update")
    if (currentOperation) {
      authAfterUpdate = compiler.authorize(currentOperation)
      activeBatchContext.authorizationProbes.push({ phase: "after_update_advance", request: currentOperation, result: authAfterUpdate })
      operationAuthorizationAfterAt = new Date().toISOString()
    }
    const delivery = finalResult?.ok ? finalResult.deliveries?.[0] : undefined
    if (delivery) {
      deliveryStartAuthorization = compiler.authorize({
        kind: "start", run_id: RUN_ID, dispatch_id: delivery.dispatch_id, host_identity: "paired-experiment-host-after-update",
      })
      deliveryStartAuthorizationAt = new Date().toISOString()
    }
  }

  if (SCENARIO === "first") {
    const finalResult = advanceResults.at(-1)
    const delivery = finalResult?.ok ? finalResult.deliveries?.[0] : undefined
    if (delivery) {
      deliveryStartAuthorization = compiler.authorize({
        kind: "start", run_id: RUN_ID, dispatch_id: delivery.dispatch_id, host_identity: "paired-experiment-host-after-first-turn",
      })
      deliveryStartAuthorizationAt = new Date().toISOString()
    }
  }

  const view = await compiler.inspect({ runId: RUN_ID })
  const snapshotPath = join(runStoreDir, "v2-runs", RUN_ID, "snapshot.json")
  const eventLogPath = join(runStoreDir, "v2-runs", RUN_ID, "events.jsonl")
  const snapshot = readJson(snapshotPath)
  if (openCodeCalls !== 0) throw new Error(`OpenCode was called ${openCodeCalls} time(s) during a DashScope batch`)
  const initialManagementLogSize = SCENARIO === "user-update" ? 2 : 0
  const newManagementRows = snapshot.management_log.slice(initialManagementLogSize)
  const usageCalls = snapshot.management_calls
  const callAttempts = gate.attempts.map((attempt, index) => ({
    ...attempt,
    recorded_management_call: usageCalls[index] ? {
      call_id: usageCalls[index].call_id,
      request_id: usageCalls[index].request_id,
      kind: usageCalls[index].kind,
      status: usageCalls[index].status,
      duration_ms: usageCalls[index].duration_ms,
      usage: usageCalls[index].usage ?? "unknown",
    } : "unknown (request may have timed out or ended before store accounting)",
  }))
  const deliveries = advanceResults.flatMap((result) => result?.deliveries ?? []).map((row) => ({
    dispatch_id: row.dispatch_id,
    task_id: row.task_id,
    atom_id: row.atom_id,
    digest: row.digest,
    compiled_revision: row.compiled_revision,
    atom: row.atom,
    execution_task: row.execution_task,
  }))
  const observationEndedAt = new Date().toISOString()
  let updateLifecycle
  if (SCENARIO === "user-update") {
    const recoveryEvidence = [
      authAfterUpdate?.ok ? { at: operationAuthorizationAfterAt, source: "existing_operation_authorized", result: authAfterUpdate } : undefined,
      deliveryStartAuthorization?.ok ? { at: deliveryStartAuthorizationAt, source: "new_delivery_start_authorized", result: deliveryStartAuthorization } : undefined,
    ].filter(Boolean).sort((left, right) => Date.parse(left.at) - Date.parse(right.at))[0]
    updateLifecycle = {
      pause_started_at: updateAcceptedAt,
      user_update_accepted_at: updateAcceptedAt,
      management_result_at: managementResultAt ?? null,
      recovery_eligibility_at: recoveryEvidence?.at ?? null,
      recovery_eligibility_source: recoveryEvidence?.source ?? null,
      pause_duration_until_recovery_eligibility_ms: recoveryEvidence
        ? Math.max(0, Date.parse(recoveryEvidence.at) - Date.parse(updateAcceptedAt))
        : null,
      observation_ended_at: observationEndedAt,
      observation_window_ms: Math.max(0, Date.parse(observationEndedAt) - Date.parse(updateAcceptedAt)),
      resume_eligibility_as_of_observation_end: recoveryEvidence ? "authorized" : "not_recovered_as_of_observation_end",
      actual_recovery_at: null,
      actual_recovery_observed: false,
      start_before_update: startBeforeUpdate,
      operation_authorization_while_update_pending: authProbe ?? null,
      operation_authorization_after_update: authAfterUpdate ?? null,
      delivery_start_authorization: deliveryStartAuthorization ?? null,
      controlled_execution_id: syntheticExecutionId,
      injected_execution_return: false,
      stale_retry_advance_count: Math.max(0, advanceResults.length - 1),
      pending_event_ids_after: view.pending_event_ids,
      unresolved_user_event_ids_after: view.unresolved_user_event_ids,
      executions_after: summarizeExecutionView(view, snapshot),
      atom_states_after: view.atom_states.map((row) => ({ task_id: row.task_id, atom_id: row.atom_id, revision: row.atom_revision, status: row.status })),
      note: "An authorization result measures restart eligibility only. No execution tool was invoked, so actual recovery was not observed.",
    }
    writeJson(join(runDir, "update-lifecycle.json"), updateLifecycle)
  }
  const { stableJson } = await import(pathToFileURL(join(distRoot, "observer/codec.js")).href)
  const adapterPayloadPreview = deliveries.length > 0 ? stableJson(deliveries.map((row) => row.execution_task)) : null
  if (adapterPayloadPreview !== null) writeFileSync(join(runDir, "adapter-payload-preview.json"), adapterPayloadPreview, "utf8")
  const checkerInputs = callAttempts.filter((row) => row.kind === "check")
  const checkerSummaries = checkerInputs.map((row) => ({
    request_id: row.request_id,
    request_file: row.request_file,
    prepared: row.prepared,
    prepared_digest: row.prepared_digest,
    prepared_fields: row.prepared_fields,
    prepared_execution_task_count: row.prepared_execution_task_count,
    prepared_json_chars: row.prepared_json_chars,
    input_chars: row.input_chars,
  }))
  const summary = {
    batch: batchName,
    experiment_run_label: RUN_LABEL,
    arm: ARM,
    scenario: SCENARIO,
    runtime_dist_root: distRoot,
    started_at: startedAt,
    completed_at: new Date().toISOString(),
    elapsed_ms: Math.round(gate.elapsedMs()),
    configured: {
      provider: frozenCompiler.provider,
      model: frozenCompiler.model,
      transport: frozenCompiler.transport,
      batch_deadline_ms: BATCH_DEADLINE_MS,
      request_limit_per_batch: MAX_REQUESTS_PER_BATCH,
      request_limit_total: MAX_REQUESTS_TOTAL,
      credential_available: true,
      executor_model_called: false,
      business_tools_invoked: false,
      opencode_method_calls: openCodeCalls,
    },
    input_hashes: inputs.input_hashes,
    common_state_sha256: SCENARIO === "user-update" ? freeze.common_history_sha256 : null,
    event_receipt: eventReceipt,
    starting_advance_results: advanceResults.map((row) => ({
      ok: row.ok,
      disposition: row.disposition,
      code: row.code,
      retryable: row.retryable,
      message: row.message,
      pending_events: row.pending_events,
      compiled_revisions: row.compiled_revisions,
      ir_revisions: row.ir_revisions,
    })),
    management_requests_transmitted: gate.reservedInBatch,
    management_calls: callAttempts,
    candidate_records: newManagementRows.map((row) => ({
      sequence: row.sequence,
      request_id: row.request_id,
      status: row.status,
      error_code: row.error_code,
      error_message: row.error_message,
      candidate: row.candidate,
      prepared_digest: row.prepared_digest,
      read_basis_digest: row.read_basis_digest,
      attempts: row.attempts,
    })),
    new_semantic_checks: snapshot.semantic_checks.filter((row) => row.sequence > initialManagementLogSize).map((row) => ({
      sequence: row.sequence,
      verdict: row.verdict,
      findings: row.findings,
      usage: row.usage ?? "unknown",
    })),
    checker_inputs: checkerSummaries,
    deliveries,
    adapter_payload_preview: adapterPayloadPreview,
    adapter_transfer_performed: false,
    delivery_start_authorization: deliveryStartAuthorization,
    operation_authorization_while_update_pending: authProbe,
    operation_authorization_after_update: authAfterUpdate,
    update_lifecycle: updateLifecycle,
    stale_basis_count: newManagementRows.filter((row) => row.error_code === "stale_basis").length,
    pending_event_ids_after: view.pending_event_ids,
    unresolved_user_event_ids_after: view.unresolved_user_event_ids,
    atom_states_after: view.atom_states,
    executions_after: view.executions,
    note: "A delivery or successful authorization is not business execution evidence. No executor model or business tool was run.",
  }
  writeJson(join(runDir, "summary.json"), summary)
  writeJson(join(runDir, "compiler-store-snapshot.json"), snapshot)
  if (existsSync(eventLogPath)) writeFileSync(join(runDir, "compiler-events.jsonl"), readFileSync(eventLogPath))
  writeJson(join(runDir, "final-view.json"), view)
  globalThis.fetch = baseFetch
  delete globalThis.__nativeFetch
  activeBatchContext = undefined
  process.stdout.write(`${JSON.stringify({ batch: batchName, status: advanceResults.at(-1)?.ok ? "accepted" : advanceResults.at(-1)?.code ?? "failed", requests: gate.reservedInBatch, elapsed_ms: summary.elapsed_ms, output: runDir })}\n`)
}

main().catch((error) => {
  const details = errorRecord(error)
  if (activeBatchContext) {
    writeFailureEvidence(activeBatchContext, error)
  } else if (SELF_TEST && ROOT) {
    const output = join(ROOT, "offline", `runtime-factory-${PREFLIGHT_LABEL}`)
    if (existsSync(output)) {
      try { writeJson(join(output, "driver-failure.json"), { at: new Date().toISOString(), error_name: details.name, error_code: details.code, message: details.message, stack: details.stack }) } catch { /* keep original failure visible */ }
    }
  } else if (FAILURE_PREFLIGHT && newlyCreatedFailurePreflightOutput) {
    try { writeJson(join(newlyCreatedFailurePreflightOutput, "driver-failure.json"), { at: new Date().toISOString(), error_name: details.name, error_code: details.code, message: details.message, stack: details.stack }) } catch { /* keep original failure visible */ }
  } else if (ROOT && ARM && SCENARIO) {
    const runDir = join(ROOT, "raw", RUN_LABEL, `${ARM}-${SCENARIO}`)
    if (existsSync(runDir)) {
      try { writeJson(join(runDir, "driver-failure.json"), { at: new Date().toISOString(), error_name: details.name, error_code: details.code, message: details.message, stack: details.stack }) } catch { /* keep original failure visible */ }
    }
  }
  fail(`batch driver stopped: ${details.message}`)
})
