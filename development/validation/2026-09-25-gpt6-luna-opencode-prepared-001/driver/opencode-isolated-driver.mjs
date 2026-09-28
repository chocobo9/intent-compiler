import { createHash } from "node:crypto"
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { performance } from "node:perf_hooks"
import { runBudgetedBatch } from "./batch-controller.mjs"
import { createBudgetedOpenCodeClient } from "./budgeted-opencode-client.mjs"
import { createOpenCodeHttpClient, startRetryEventMonitor } from "./opencode-http-client.mjs"
import { startDedicatedOpenCodeServer, waitForOpenCodeHealth } from "./opencode-server.mjs"

const HERE = dirname(fileURLToPath(import.meta.url))
const PREP_ROOT = resolve(HERE, "..")
const PROJECT_ROOT = resolve(PREP_ROOT, "..", "..", "..")
const FROZEN_ROOT = join(PREP_ROOT, "..", "2026-09-25-path-inheritance-live-001")
const RUN_CONFIG_PATH = join(PREP_ROOT, "RUN-CONFIG.json")
const DIST_MANIFEST_PATH = join(PREP_ROOT, "DIST-MANIFEST.json")
const DIST_ROOT = join(PROJECT_ROOT, "dist")
const RUN_ID = "intent-case-django11163-001"
const DEADLINE_MS = 900_000
const LOGICAL_PROMPT_LIMIT = 3
const PROVIDER_ID = "openai"
const MODEL_ID = "gpt-6-luna-fast"
const MODEL_NAME = `${PROVIDER_ID}/${MODEL_ID}`
const VARIANT = "max"

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

function hashFile(path) {
  return sha256(readFileSync(path))
}

function clone(value) {
  return JSON.parse(JSON.stringify(value))
}

function errorRecord(error) {
  return {
    name: error?.name ?? "Error",
    code: error?.code ?? "driver_error",
    message: error?.message ?? String(error),
    stack: typeof error?.stack === "string" ? error.stack : null,
  }
}

function validateLabel(label) {
  if (!/^[a-z0-9][a-z0-9-]{0,47}$/u.test(label ?? "")) throw new Error("run label must be a lowercase slug")
}

function verifyFrozenAndDist() {
  const config = readJson(RUN_CONFIG_PATH)
  const freezePath = join(FROZEN_ROOT, "FREEZE.json")
  const inputsPath = join(FROZEN_ROOT, "shared", "inputs", "frozen-inputs.json")
  const updatePath = join(FROZEN_ROOT, "shared", "inputs", "user-update.txt")
  const historyPath = join(FROZEN_ROOT, "shared", "state", "common-history.json")
  const priorResultsPath = join(FROZEN_ROOT, "RESULTS.md")
  const frozenInputs = readJson(inputsPath)
  const commonHistory = readJson(historyPath)
  const frozenUpdateText = readFileSync(updatePath, "utf8")
  if (commonHistory.events.user_update.payload.text !== frozenUpdateText) throw new Error("common-history update event differs from the separately frozen update input")
  if (commonHistory.events.first_delegation.payload.text !== frozenInputs.task.problem_statement) throw new Error("common-history first event differs from the frozen task problem statement")
  if (frozenInputs.input_hashes?.user_update !== config.frozen_scenario.user_update_sha256) throw new Error("frozen input JSON records a different user-update hash")
  const fixed = config.frozen_scenario
  const observed = {
    freeze_sha256: hashFile(freezePath),
    frozen_inputs_sha256: hashFile(inputsPath),
    user_update_sha256: hashFile(updatePath),
    common_history_sha256: hashFile(historyPath),
    previous_real_failure_results_sha256: hashFile(priorResultsPath),
    dist_manifest_sha256: hashFile(DIST_MANIFEST_PATH),
  }
  const expected = {
    freeze_sha256: fixed.freeze_sha256,
    frozen_inputs_sha256: fixed.frozen_inputs_sha256,
    user_update_sha256: fixed.user_update_sha256,
    common_history_sha256: fixed.common_history_sha256,
    previous_real_failure_results_sha256: fixed.previous_real_failure_results_sha256,
    dist_manifest_sha256: config.dist.manifest_sha256,
  }
  for (const [key, value] of Object.entries(expected)) {
    if (value !== observed[key]) throw new Error(`${key} differs from the prepared frozen-run config`)
  }

  const manifest = readJson(DIST_MANIFEST_PATH)
  const actualFiles = new Set()
  for (const entry of manifest.files) {
    const filePath = join(DIST_ROOT, ...entry.path.split("/"))
    if (!existsSync(filePath) || hashFile(filePath) !== entry.sha256) throw new Error(`current dist differs from its frozen manifest: ${entry.path}`)
    actualFiles.add(entry.path)
  }
  if (actualFiles.size !== manifest.file_count) throw new Error("dist manifest file_count does not match its entries")
  return { config, observed, dist_file_count: actualFiles.size, frozen_event_texts_match: true }
}

function oldAcceptedMarker(row, eventId, ir, compiled) {
  return {
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

function seedCommonState({ store, history, digestOf }) {
  const firstEvent = clone(history.events.first_delegation)
  const accepted = store.acceptEvent(firstEvent)
  return Promise.resolve(accepted).then((receipt) => {
    if (!receipt.ok) throw new Error(`common-state event seed rejected: ${receipt.code ?? "unknown"}`)
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
  })
}

function summarizeExecutionView(view, snapshot) {
  const stored = Array.isArray(snapshot?.executions) ? snapshot.executions : []
  return (view?.executions ?? []).map((row) => {
    const persisted = stored.find((item) => item.execution_id === row.execution_id)
    return {
      execution_id: row.execution_id,
      status: row.status,
      closed_reason: row.closed_reason,
      allowed_calls: Array.isArray(persisted?.allowed_calls) ? persisted.allowed_calls.length : "unknown",
    }
  })
}

async function runUserUpdateBatch(label, retryExposureAcknowledged) {
  validateLabel(label)
  if (!retryExposureAcknowledged) {
    throw new Error("real run blocked before startup: OpenCode internal retries mean the three-provider-attempt cap cannot be guaranteed; inspect the report and explicitly pass --accept-provider-retry-exposure to allow up to three logical prompts")
  }
  const deadlineStartedAt = new Date().toISOString()
  const deadlineStartedAtMs = performance.now()
  const prep = verifyFrozenAndDist()
  const config = prep.config
  const history = readJson(join(FROZEN_ROOT, "shared", "state", "common-history.json"))
  const frozen = readJson(join(FROZEN_ROOT, "shared", "inputs", "frozen-inputs.json"))
  const frozenUpdateText = readFileSync(join(FROZEN_ROOT, "shared", "inputs", "user-update.txt"), "utf8")
  if (history.events.user_update.payload.text !== frozenUpdateText) throw new Error("common-history update event differs from the separately frozen update input")
  if (history.events.first_delegation.payload.text !== frozen.task.problem_statement) throw new Error("common-history first event differs from the frozen task problem statement")
  if (frozen.input_hashes?.user_update !== config.frozen_scenario.user_update_sha256) throw new Error("frozen input JSON records a different user-update hash")
  const runRoot = join(PREP_ROOT, "raw", label)
  const runDir = join(runRoot, "update-user-update")
  if (existsSync(runDir)) throw new Error(`run output already exists; refusing to rerun: ${runDir}`)
  mkdirSync(runDir, { recursive: true })

  const storeDir = join(runDir, "compiler-store")
  const modelDir = join(runDir, "compiler-model")
  const observerDir = join(runDir, "observer-store")
  const executorWorkspace = history.prior_history.rejected_turn_2.request.capabilities.workspace_root
  const operations = history.prior_history.rejected_turn_2.request.capabilities.operations
  const modelConfigDir = join(modelDir, "opencode-config")
  for (const path of [storeDir, modelDir, observerDir, modelConfigDir]) mkdirSync(path, { recursive: true })

  const { createIntentCompilerRuntime, IntentStoreV2, digestOf } = await import(pathToFileURL(join(DIST_ROOT, "index.js")).href)
  const store = new IntentStoreV2({ storeDir, runId: RUN_ID })
  await seedCommonState({ store, history, digestOf })
  const initialManagementLogSize = 2
  const initialManagementCallCount = 0
  const hostOperations = []
  const modelSessions = []
  const lifecycle = {
    authorization_probes: [],
    start_authorizations: [],
    advance_results: [],
    stage: "prepared",
  }
  const requestLogPath = join(runDir, "opencode-host-operations.jsonl")
  const appendOperation = (row) => {
    hostOperations.push(row)
    appendJsonl(requestLogPath, row)
  }

  let server
  let serverTerminationPromise
  let serverExitConfirmed = false
  let serverTerminationRequested = false
  let restClient
  let eventMonitor
  let compiler
  let runtimeResult
  let updateAcceptedAt = null
  let managementResultAt = null
  let operationAuthorizationAfterAt = null
  let deliveryStartAuthorizationAt = null
  let preUpdateStartAuthorization
  let operationAuthorizationWhilePending
  let operationAuthorizationAfterUpdate
  let deliveryStartAuthorization
  let eventReceipt
  let controlledExecutionId
  let updateAtom
  const batchResult = await runBudgetedBatch({
    deadlineMs: DEADLINE_MS,
    maxLogicalRequests: LOGICAL_PROMPT_LIMIT,
    deadlineStartedAt,
    deadlineStartedAtMs,
    cancelGraceMs: 2_000,
    retryEventsHealthy: () => eventMonitor?.state.healthy === true,
    abortSession: async (sessionId) => {
      if (!restClient) return false
      try {
        const response = await restClient.session.abort(sessionId, modelDir, { signal: AbortSignal.timeout(1_800) })
        appendOperation({ operation: "session.abort", status: "completed", session_id: sessionId, at: new Date().toISOString() })
        return response === true
      } catch (error) {
        appendOperation({ operation: "session.abort", status: "failed", session_id: sessionId, error: errorRecord(error), at: new Date().toISOString() })
        throw error
      }
    },
    terminateServer: async () => {
      if (!server) return { exited: true, no_server_started: true }
      serverTerminationRequested = true
      serverTerminationPromise ??= server.terminate()
      const result = await serverTerminationPromise
      serverExitConfirmed = result.exited === true
      return result
    },
    run: async (batch) => {
      let cleanupError
      try {
        lifecycle.stage = "starting_dedicated_opencode_server"
        server = await startDedicatedOpenCodeServer({ cwd: modelDir, configDir: modelConfigDir, batch })
        appendOperation({ operation: "opencode.serve", status: "started", pid: server.pid, at: new Date().toISOString() })
        restClient = createOpenCodeHttpClient({ baseUrl: server.baseUrl })
        const health = await waitForOpenCodeHealth({ client: restClient, batch, maxWaitMs: 30_000 })
        appendOperation({ operation: "global.health", status: "healthy", version: health.version ?? null, at: new Date().toISOString() })
        eventMonitor = startRetryEventMonitor({ client: restClient, onRetry: (event) => batch.observeRetryEvent(event) })
        await batch.hostOperation({ name: "global.event.ready", invoke: () => eventMonitor.ready })
        if (!eventMonitor.state.healthy) throw new Error("OpenCode retry event stream was not healthy before model requests")

        const budgetedClient = createBudgetedOpenCodeClient({
          batch,
          client: restClient,
          onOperation: appendOperation,
          retryEventsAvailable: () => eventMonitor?.state.healthy === true,
        })
        compiler = createIntentCompilerRuntime({
          client: budgetedClient,
          config: {
            transport: "opencode",
            model: { providerId: PROVIDER_ID, modelId: MODEL_ID, variant: VARIANT, agent: "build" },
            paths: { compilerStoreDir: storeDir, compilerModelDir: modelDir, observerStoreDir: observerDir, executorWorkspaceDir: executorWorkspace },
            capabilities: { operations, workspaceRoot: executorWorkspace },
          },
          onModelSessionCreated: (sessionId) => {
            batch.sessionCreated(sessionId)
            modelSessions.push({ session_id: sessionId, created_at: new Date().toISOString() })
          },
        })
        lifecycle.stage = "runtime_factory_initialized"

        const dispatch = history.state.dispatches[0]
        const start = compiler.authorize({ kind: "start", run_id: RUN_ID, dispatch_id: dispatch.dispatch_id, host_identity: "opencode-isolated-experiment-before-update" })
        preUpdateStartAuthorization = start
        lifecycle.start_authorizations.push({ phase: "before_update", result: start })
        if (!start.ok || !start.execution_id) throw new Error(`could not establish the frozen pre-update execution state: ${start.code ?? "no execution id"}`)
        controlledExecutionId = start.execution_id
        updateAtom = history.state.compiled.t1?.atoms?.find((item) => item.atom_id === dispatch.atom_id)

        lifecycle.stage = "user_update_accepted"
        const updateEvent = clone(history.events.user_update)
        eventReceipt = await compiler.acceptEvent(updateEvent)
        if (!eventReceipt.ok && eventReceipt.status !== "duplicate") throw new Error(`frozen user update rejected: ${eventReceipt.code ?? "unknown"}`)
        updateAcceptedAt = new Date().toISOString()
        const pendingOperation = operationProbeRequest(updateAtom, operations, RUN_ID, controlledExecutionId, "opencode-isolated-experiment-host", "opencode-update-probe-pending")
        operationAuthorizationWhilePending = pendingOperation ? compiler.authorize(pendingOperation) : { ok: false, code: "no_existing_operation_rule" }
        if (pendingOperation) lifecycle.authorization_probes.push({ phase: "while_update_pending", request: pendingOperation, result: operationAuthorizationWhilePending })

        lifecycle.stage = "user_update_advance"
        const advance = await compiler.advance({ runId: RUN_ID })
        lifecycle.advance_results.push({ ok: advance.ok, code: advance.code ?? null, disposition: advance.disposition ?? null, delivery_count: advance.deliveries?.length ?? 0 })
        managementResultAt = new Date().toISOString()
        const currentOperation = operationProbeRequest(updateAtom, operations, RUN_ID, controlledExecutionId, "opencode-isolated-experiment-host", "opencode-update-probe-after")
        if (currentOperation) {
          operationAuthorizationAfterUpdate = compiler.authorize(currentOperation)
          lifecycle.authorization_probes.push({ phase: "after_update_advance", request: currentOperation, result: operationAuthorizationAfterUpdate })
          operationAuthorizationAfterAt = new Date().toISOString()
        }
        const delivery = advance.ok ? advance.deliveries?.[0] : undefined
        if (delivery) {
          deliveryStartAuthorization = compiler.authorize({
            kind: "start",
            run_id: RUN_ID,
            dispatch_id: delivery.dispatch_id,
            host_identity: "opencode-isolated-experiment-host-after-update",
          })
          deliveryStartAuthorizationAt = new Date().toISOString()
          lifecycle.start_authorizations.push({ phase: "after_update_delivery", result: deliveryStartAuthorization })
        }
        runtimeResult = { advance, delivery }
      } finally {
        if (eventMonitor) {
          try { await eventMonitor.stop() }
          catch (error) { cleanupError = errorRecord(error) }
        }
        if (restClient && server && !serverTerminationRequested && !serverExitConfirmed) {
          for (const session of modelSessions) {
            try {
              const deleted = await restClient.session.delete(session.session_id, modelDir, { signal: AbortSignal.timeout(1_800) })
              appendOperation({ operation: "session.delete", status: deleted ? "completed" : "unknown", session_id: session.session_id, at: new Date().toISOString() })
            } catch (error) {
              appendOperation({ operation: "session.delete", status: "failed", session_id: session.session_id, error: errorRecord(error), at: new Date().toISOString() })
              cleanupError ??= errorRecord(error)
            }
          }
        }
        if (server) {
          try {
            serverTerminationRequested = true
            serverTerminationPromise ??= server.terminate()
            const stopped = await serverTerminationPromise
            serverExitConfirmed = stopped.exited === true
            appendOperation({ operation: "opencode.serve", status: stopped.exited ? "terminated" : "termination_unconfirmed", pid: server.pid, exit: stopped, at: new Date().toISOString() })
            if (!stopped.exited) cleanupError = { code: "server_termination_unconfirmed", ...stopped }
          } catch (error) {
            cleanupError = errorRecord(error)
          }
        }
        if (cleanupError) lifecycle.cleanup_error = cleanupError
      }
    },
  })

  const snapshotPath = join(storeDir, "v2-runs", RUN_ID, "snapshot.json")
  const eventLogPath = join(storeDir, "v2-runs", RUN_ID, "events.jsonl")
  const snapshot = existsSync(snapshotPath) ? readJson(snapshotPath) : undefined
  const view = compiler ? await compiler.inspect({ runId: RUN_ID }) : undefined
  // Inspection is local to the compiler store; no execution or business tool
  // is invoked by the isolated management driver.
  const deliveries = runtimeResult?.advance?.ok ? (runtimeResult.advance.deliveries ?? []).map((row) => ({
    dispatch_id: row.dispatch_id,
    task_id: row.task_id,
    atom_id: row.atom_id,
    digest: row.digest,
    compiled_revision: row.compiled_revision,
    atom: row.atom,
    execution_task: row.execution_task,
  })) : []
  const managementRows = (snapshot?.management_log ?? []).slice(initialManagementLogSize)
  const managementCalls = (snapshot?.management_calls ?? []).slice(initialManagementCallCount)
  const semanticChecks = (snapshot?.semantic_checks ?? []).filter((row) => row.sequence > initialManagementLogSize)
  const pauseRecovery = [
    operationAuthorizationAfterUpdate?.ok ? { at: operationAuthorizationAfterAt, source: "existing_operation_authorized" } : undefined,
    deliveryStartAuthorization?.ok ? { at: deliveryStartAuthorizationAt, source: "new_delivery_start_authorized" } : undefined,
  ].filter(Boolean).sort((left, right) => Date.parse(left.at) - Date.parse(right.at))[0]
  const finalSummary = {
    schema_version: 1,
    batch: label,
    arm: "update",
    scenario: "user-update",
    driver: "OpenCode isolated HTTP driver",
    model: MODEL_NAME,
    variant: VARIANT,
    transport: "opencode",
    runtime_dist: DIST_ROOT,
    frozen_hashes: prep.observed,
    actual_wall_elapsed_ms: batchResult.elapsed_ms,
    configured_deadline_ms: DEADLINE_MS,
    batch_controller: {
      status: batchResult.status,
      logical_prompt_count: batchResult.logical_request_count,
      logical_prompt_limit: batchResult.max_logical_requests,
      provider_attempt_count: batchResult.provider_attempt_count,
      provider_attempt_count_exact: batchResult.provider_attempt_count_exact,
      retry_events: batchResult.retry_events,
      requests: batchResult.requests,
      provider_attempt_tokens_scope: "OpenCode response usage metadata; failed or interrupted retry attempt usage may be unknown",
      pending_prompt_count_at_return: batchResult.pending_prompt_count_at_return,
      pending_host_operation_count_at_return: batchResult.pending_host_operation_count_at_return,
      cleanup_confirmed: (batchResult.cleanup_confirmed || serverExitConfirmed)
        && batchResult.pending_prompt_count_at_return === 0
        && batchResult.pending_host_operation_count_at_return === 0,
      controller_cleanup_confirmed_before_run_finally: batchResult.cleanup_confirmed,
      session_aborts_confirmed: batchResult.session_aborts_confirmed,
      dedicated_server_terminated: serverExitConfirmed || !server,
      no_new_prompts_after_deadline: batchResult.no_new_prompts_after_deadline,
      error: batchResult.run_error,
    },
    deadline_semantics: {
      logical_prompt_cutoff_ms: DEADLINE_MS,
      no_new_session_create_or_prompt_after_cutoff: batchResult.no_new_prompts_after_deadline,
      post_deadline_control_calls: "session.abort and dedicated server termination only; no provider prompt is submitted after the cutoff",
      elapsed_includes_cleanup: true,
      elapsed_may_exceed_900000_ms_for_cancellation_and_process_exit: true,
      provider_may_finish_an_already_transmitted_attempt_after_local_cancel: "not observable or guaranteed",
    },
    open_code_host_operations: hostOperations,
    model_sessions: modelSessions,
    open_code_session_cleanup: hostOperations.filter((row) => row.operation === "session.delete").map((row) => ({ session_id: row.session_id, status: row.status })),
    open_code_storage_isolation: {
      server_is_dedicated_and_loopback_only: true,
      per_run_model_directory: modelDir,
      session_delete_attempted_before_normal_shutdown: true,
      timeout_fallback_may_leave_saved_session_metadata: true,
      note: "No supported per-run data-store override was verified for the installed CLI; auth and profile storage remain the existing OpenCode profile.",
    },
    event_receipt: eventReceipt ?? null,
    starting_advance_results: lifecycle.advance_results,
    candidate_records: managementRows.map((row) => ({
      sequence: row.sequence,
      status: row.status,
      error_code: row.error_code ?? null,
      error_message: row.error_message ?? null,
      candidate: row.candidate ?? null,
      attempts: row.attempts ?? [],
    })),
    independent_check_results: semanticChecks.map((row) => ({ sequence: row.sequence, verdict: row.verdict, findings: row.findings, usage: row.usage ?? "unknown" })),
    management_call_usage: managementCalls.map((row) => ({ kind: row.kind, status: row.status, duration_ms: row.duration_ms, usage: row.usage ?? "unknown" })),
    deliveries,
    operation_authorization_while_update_pending: operationAuthorizationWhilePending ?? null,
    operation_authorization_after_update: operationAuthorizationAfterUpdate ?? null,
    delivery_start_authorization: deliveryStartAuthorization ?? null,
    update_lifecycle: {
      pause_started_at: updateAcceptedAt,
      management_result_at: managementResultAt,
      recovery_eligibility_at: pauseRecovery?.at ?? null,
      recovery_eligibility_source: pauseRecovery?.source ?? null,
      pause_duration_until_recovery_eligibility_ms: updateAcceptedAt && pauseRecovery ? Math.max(0, Date.parse(pauseRecovery.at) - Date.parse(updateAcceptedAt)) : null,
      observation_ended_at: new Date().toISOString(),
      resume_eligibility_as_of_observation_end: pauseRecovery ? "authorized" : "not_recovered_as_of_observation_end",
      actual_recovery_observed: false,
      controlled_execution_id: controlledExecutionId ?? null,
      injected_execution_return: false,
      note: "No business tool was invoked. A successful authorization means eligible to start, not actual execution or recovery.",
    },
    pending_event_ids_after: snapshot?.pending_event_ids ?? "unknown",
    unresolved_user_event_ids_after: snapshot?.unresolved_user_event_ids ?? "unknown",
    final_view: view ?? "unknown",
    dispatches_added: deliveries.length,
    business_tool_calls: 0,
    execution_layer_started: false,
    claims: { qualified_management_delivery: false, m2: false },
  }
  if (snapshot) writeJson(join(runDir, "compiler-store-snapshot.json"), snapshot)
  if (view) writeJson(join(runDir, "final-view.json"), view)
  if (existsSync(eventLogPath)) writeFileSync(join(runDir, "compiler-events.jsonl"), readFileSync(eventLogPath))
  writeJson(join(runDir, "summary.json"), finalSummary)
  writeJson(join(runDir, "failure-or-completion.json"), {
    status: batchResult.status,
    stage: lifecycle.stage,
    error: batchResult.run_error,
    cleanup_error: lifecycle.cleanup_error ?? null,
    candidate_statuses: finalSummary.candidate_records.map((row) => row.status),
    authorization_evidence: lifecycle.authorization_probes.map((row) => ({ phase: row.phase, ok: row.result.ok, code: row.result.code ?? null })),
  })
  process.stdout.write(`${JSON.stringify({ batch: label, status: batchResult.status, logical_prompts: batchResult.logical_request_count, provider_attempts: batchResult.provider_attempt_count ?? "unknown", elapsed_ms: batchResult.elapsed_ms, output: runDir })}\n`)
  return finalSummary
}

function main() {
  const args = process.argv.slice(2)
  if (args[0] === "--live") {
    const label = args[1]
    const ack = args.includes("--accept-provider-retry-exposure")
    return runUserUpdateBatch(label, ack)
  }
  if (args[0] === "--verify-frozen-dist") {
    const result = verifyFrozenAndDist()
    process.stdout.write(`${JSON.stringify({ status: "verified", hashes: result.observed, dist_file_count: result.dist_file_count })}\n`)
    return Promise.resolve(result)
  }
  throw new Error("usage: node opencode-isolated-driver.mjs --verify-frozen-dist | --live <label> [--accept-provider-retry-exposure]")
}

main().catch((error) => {
  const details = errorRecord(error)
  process.stderr.write(`${JSON.stringify({ status: "blocked", error: details })}\n`)
  process.exitCode = 2
})
