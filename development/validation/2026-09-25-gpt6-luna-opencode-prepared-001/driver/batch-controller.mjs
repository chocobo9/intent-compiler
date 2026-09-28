import { performance } from "node:perf_hooks"

export class BatchStoppedError extends Error {
  constructor(message = "batch stopped before another OpenCode request") {
    super(message)
    this.name = "BatchStoppedError"
    this.code = "BATCH_STOPPED"
  }
}

/**
 * Enforce one monotonic deadline and a logical-prompt ceiling around a run.
 * Provider attempts are only exact for completed prompts while the OpenCode
 * retry-event stream remained healthy; interrupted or unobserved attempts are
 * deliberately reported as unknown.
 */
export async function runBudgetedBatch({
  deadlineMs,
  maxLogicalRequests,
  run,
  deadlineStartedAt,
  deadlineStartedAtMs,
  abortSession = async () => false,
  terminateServer = async () => ({ exited: false }),
  cancelGraceMs = 2_000,
  retryEventsHealthy = () => true,
}) {
  if (!Number.isFinite(deadlineMs) || deadlineMs <= 0) throw new TypeError("deadlineMs must be positive")
  if (!Number.isInteger(maxLogicalRequests) || maxLogicalRequests <= 0) throw new TypeError("maxLogicalRequests must be a positive integer")
  if (typeof run !== "function") throw new TypeError("run must be a function")

  const startedAt = deadlineStartedAt ?? new Date().toISOString()
  const startedClock = deadlineStartedAtMs ?? performance.now()
  const promptRequests = new Map()
  const hostOperations = new Map()
  const requestRecords = []
  const promptBySession = new Map()
  const sessions = new Set()
  const retryEvents = []
  const hostTerminatedController = new AbortController()
  let halted = false
  let deadlineExceeded = false
  let requestLimitExceeded = false
  let hostTerminated = false
  let cleanupConfirmed = true
  let abortsConfirmed = true
  let logicalRequestCount = 0
  let runError
  let timeoutWork
  let resolveDeadline
  const deadlineSignal = new Promise((resolve) => { resolveDeadline = resolve })

  const elapsedMs = () => Math.max(0, performance.now() - startedClock)
  const hasTime = () => !halted && elapsedMs() < deadlineMs
  const assertCanStartRequest = () => {
    if (!hasTime()) throw new BatchStoppedError(deadlineExceeded ? "batch deadline exceeded" : undefined)
  }

  const batch = {
    elapsedMs,
    get logicalRequestCount() { return logicalRequestCount },
    get halted() { return halted },
    assertCanStartRequest,
    observeRetryEvent(event) {
      const active = promptBySession.get(event?.sessionId)
      if (!active) return false
      active.retryObserved(event)
      return true
    },
    async hostOperation({ name, invoke }) {
      assertCanStartRequest()
      if (typeof invoke !== "function") throw new TypeError("host operation invoke must be a function")
      const id = `${name ?? "host-op"}-${hostOperations.size + 1}`
      const controller = new AbortController()
      const promise = Promise.resolve().then(() => {
        assertCanStartRequest()
        return invoke({ signal: controller.signal, hostTerminated: hostTerminatedController.signal })
      })
      hostOperations.set(id, { controller, promise })
      try {
        return await promise
      } finally {
        hostOperations.delete(id)
      }
    },
    sessionCreated(sessionId) {
      if (typeof sessionId !== "string" || sessionId.length === 0) throw new TypeError("session id must be non-empty")
      sessions.add(sessionId)
      if (halted) throw new BatchStoppedError("session was created after the batch stopped")
    },
    async prompt({ sessionId, kind, model, variant, invoke }) {
      assertCanStartRequest()
      if (logicalRequestCount >= maxLogicalRequests) {
        halted = true
        requestLimitExceeded = true
        throw new BatchStoppedError("logical management prompt limit reached")
      }
      if (typeof invoke !== "function") throw new TypeError("prompt invoke must be a function")

      const requestId = `prompt-${String(logicalRequestCount + 1).padStart(2, "0")}`
      const controller = new AbortController()
      const record = {
        request_id: requestId,
        session_id: sessionId,
        kind: kind ?? "unknown",
        model: model ?? "unknown",
        variant: variant ?? null,
        status: "in_flight",
        started_at: new Date().toISOString(),
        elapsed_start_ms: Math.round(elapsedMs()),
        retry_attempts: [],
        provider_attempt_count: null,
        provider_attempt_count_exact: false,
        provider_attempts_observed_lower_bound: 0,
        usage: "unknown",
        usage_scope: "returned session.prompt response; usage from failed/retried attempts may not be exposed by OpenCode",
      }
      logicalRequestCount += 1
      requestRecords.push(record)
      promptRequests.set(requestId, { record, controller, promise: undefined })

      const retryObserved = (event) => {
        if (event?.sessionId !== sessionId || !Number.isInteger(event.attempt)) return
        record.retry_attempts.push(event.attempt)
        retryEvents.push({ request_id: requestId, session_id: sessionId, attempt: event.attempt, at: new Date().toISOString() })
        record.provider_attempts_observed_lower_bound = Math.max(1, record.retry_attempts.length + 1)
      }
      promptBySession.set(sessionId, { retryObserved })

      const promise = Promise.resolve().then(() => {
        if (elapsedMs() >= deadlineMs && !deadlineExceeded) triggerDeadlineStop()
        assertCanStartRequest()
        return invoke({
          signal: controller.signal,
          hostTerminated: hostTerminatedController.signal,
          retryObserved,
        })
      })
      promptRequests.get(requestId).promise = promise
      try {
        const response = await promise
        record.status = "completed"
        record.completed_at = new Date().toISOString()
        record.elapsed_ms = Math.round(elapsedMs() - record.elapsed_start_ms)
        const modelResponse = response?.data ?? response
        const info = modelResponse?.info
        if (info && typeof info === "object") {
          record.provider = typeof info.providerID === "string" ? info.providerID : null
          record.model_id = typeof info.modelID === "string" ? info.modelID : null
          if (info.tokens && typeof info.tokens === "object") record.usage = info.tokens
        }
        const monitorHealthy = retryEventsHealthy()
        if (monitorHealthy && record.status === "completed") {
          record.provider_attempt_count = record.retry_attempts.length + 1
          record.provider_attempt_count_exact = true
          record.provider_attempts_observed_lower_bound = record.provider_attempt_count
        }
        return response
      } catch (error) {
        record.status = halted ? (deadlineExceeded ? "interrupted_by_deadline" : "interrupted") : "failed"
        record.completed_at = new Date().toISOString()
        record.elapsed_ms = Math.round(elapsedMs() - record.elapsed_start_ms)
        record.error = errorRecord(error)
        record.provider_attempt_count = null
        record.provider_attempt_count_exact = false
        throw error
      } finally {
        promptRequests.delete(requestId)
        promptBySession.delete(sessionId)
      }
    },
  }

  const timer = setTimeout(() => {
    triggerDeadlineStop()
  }, Math.max(0, deadlineMs - elapsedMs()))

  function triggerDeadlineStop() {
    if (deadlineExceeded) return
    halted = true
    deadlineExceeded = true
    timeoutWork = stopAtDeadline()
    resolveDeadline({ type: "deadline" })
  }

  async function stopAtDeadline() {
    halted = true
    deadlineExceeded = true
    const active = [...promptRequests.values()]
    const activeHostOperations = [...hostOperations.values()]
    await Promise.all(active.map(async ({ record, controller }) => {
      if (!record.session_id) {
        abortsConfirmed = false
        return
      }
      try {
        const confirmed = await settleWithin(Promise.resolve(abortSession(record.session_id)), cancelGraceMs)
        if (confirmed !== true) {
          abortsConfirmed = false
          return
        }
        controller.abort(new BatchStoppedError("OpenCode session aborted at batch deadline"))
      } catch {
        abortsConfirmed = false
      }
    }))

    for (const operation of activeHostOperations) operation.controller.abort(new BatchStoppedError("batch deadline"))
    let settled = await waitForPrompts(active, cancelGraceMs)
    if (settled && activeHostOperations.length > 0) {
      settled = (await settleWithin(Promise.allSettled(activeHostOperations.map((operation) => operation.promise)), cancelGraceMs)) !== undefined
    }
    // Even after the HTTP abort endpoint acknowledges cancellation, stop the
    // dedicated server before returning. This closes the process that owns
    // OpenCode's retry loop, so a false-positive/session mismatch cannot leave
    // a detached local retry running after the batch deadline.
    let exitConfirmed = false
    try {
      const result = await settleWithin(Promise.resolve(terminateServer()), cancelGraceMs)
      exitConfirmed = result === true || result?.exited === true
    } catch {
      exitConfirmed = false
    }
    hostTerminated = exitConfirmed
    if (exitConfirmed) hostTerminatedController.abort(new BatchStoppedError("isolated OpenCode server terminated at batch deadline"))
    for (const { controller } of promptRequests.values()) controller.abort(new BatchStoppedError("batch deadline cleanup"))
    for (const { controller } of hostOperations.values()) controller.abort(new BatchStoppedError("batch deadline cleanup"))
    settled = await waitForPrompts([...active, ...promptRequests.values()], cancelGraceMs)
    const cleanupOperations = [...new Set([...activeHostOperations, ...hostOperations.values()])]
    if (settled && cleanupOperations.length > 0) {
      settled = (await settleWithin(Promise.allSettled(cleanupOperations.map((operation) => operation.promise)), cancelGraceMs)) !== undefined
    }
    cleanupConfirmed = exitConfirmed && settled
  }

  const runPromise = Promise.resolve().then(() => run(batch)).then(
    (value) => ({ type: "completed", value }),
    (error) => ({ type: "failed", error }),
  )
  const winner = await Promise.race([runPromise, deadlineSignal])
  let value
  if (winner.type === "deadline") {
    await timeoutWork
    const finished = await runPromise
    if (finished.type === "failed" && !(finished.error instanceof BatchStoppedError)) runError = finished.error
    value = finished.value
  } else {
    clearTimeout(timer)
    if (winner.type === "failed") runError = winner.error
    else value = winner.value
  }

  const pendingPromptCount = promptRequests.size
  const pendingHostOperationCount = hostOperations.size
  const allRequests = requestRecords
  const exactAttempts = allRequests.every((row) => row.provider_attempt_count_exact)
  const providerAttemptCount = exactAttempts
    ? allRequests.reduce((sum, row) => sum + row.provider_attempt_count, 0)
    : null
  const result = {
    status: deadlineExceeded ? "deadline_exceeded" : requestLimitExceeded ? "request_limit_exceeded" : runError ? "failed" : "completed",
    started_at: startedAt,
    completed_at: new Date().toISOString(),
    elapsed_ms: Math.round(elapsedMs()),
    deadline_ms: deadlineMs,
    max_logical_requests: maxLogicalRequests,
    request_limit_exceeded: requestLimitExceeded,
    logical_request_count: logicalRequestCount,
    provider_attempt_count: providerAttemptCount,
    provider_attempt_count_exact: exactAttempts && allRequests.length === logicalRequestCount,
    retry_events: retryEvents,
    requests: allRequests,
    pending_prompt_count_at_return: pendingPromptCount,
    pending_host_operation_count_at_return: pendingHostOperationCount,
    no_new_prompts_after_deadline: true,
    cleanup_confirmed: cleanupConfirmed && pendingPromptCount === 0 && pendingHostOperationCount === 0,
    host_terminated: hostTerminated,
    session_aborts_confirmed: abortsConfirmed,
    run_error: runError ? errorRecord(runError) : null,
    value: value ?? null,
  }
  return result

  async function waitForPrompts(rows, graceMs) {
    const activePromises = rows.map((row) => row.promise).filter(Boolean)
    if (activePromises.length === 0) return true
    const outcome = await settleWithin(Promise.allSettled(activePromises), graceMs)
    return outcome !== undefined
  }
}

function settleWithin(promise, timeoutMs) {
  let timer
  return Promise.race([
    promise,
    new Promise((resolve) => { timer = setTimeout(() => resolve(undefined), Math.max(1, timeoutMs)) }),
  ]).finally(() => clearTimeout(timer))
}

function errorRecord(error) {
  return {
    name: error?.name ?? "Error",
    message: error?.message ?? String(error),
    code: error?.code ?? null,
    stack: typeof error?.stack === "string" ? error.stack : null,
  }
}
