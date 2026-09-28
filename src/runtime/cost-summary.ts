import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"

export interface CostSummaryOptions {
  observerStoreDir: string
  runId: string
  v2StoreDir?: string
}

export interface NumericCosts {
  requests: number
  accepted: number
  failed: number
  input_tokens: number | "unavailable"
  output_tokens: number | "unavailable"
  reasoning_tokens: number | "unavailable"
  cache_read_tokens: number | "unavailable"
  cache_write_tokens: number | "unavailable"
  cost: number | "unavailable"
  duration_ms: number | "unavailable"
}

export interface CostSummary {
  run_id: string
  arm_id?: string
  management: NumericCosts
  executor: NumericCosts & {
    unmetered_requests_lower_bound: number
    retries: number
    tool_requests: number
    tool_completed: number
    tool_failed: number
    tool_unresolved: number
  }
  intent: {
    user_input_events: number
    delivery_ack_events: number
    execution_return_events: number
    ir_revisions: Record<string, number>
    compiled_revisions: Record<string, number>
    assessments: number
    checks: number
    questions: number
    unresolved_checks: number
    pending_event_ids: string[]
  }
}

export interface CostDelta {
  on: number | string
  off: number | string
  difference: number | "unavailable" | "incomparable"
}

export interface CostComparison {
  on: CostSummary
  off: CostSummary
  deltas: Record<string, CostDelta>
}

export class CostSummaryError extends Error {
  readonly code: "OBSERVER_RUN_MISSING" | "V2_RUN_MISSING"

  constructor(code: "OBSERVER_RUN_MISSING" | "V2_RUN_MISSING", message: string) {
    super(message)
    this.name = "CostSummaryError"
    this.code = code
  }
}

export function readCostSummary(options: CostSummaryOptions): CostSummary {
  const observerRunDir = join(options.observerStoreDir, "runs", options.runId)
  const summaryPath = join(observerRunDir, "summary.json")
  const eventsPath = join(observerRunDir, "events.jsonl")
  if (!existsSync(summaryPath)) {
    throw new CostSummaryError("OBSERVER_RUN_MISSING", `observer run ${options.runId} has no summary.json`)
  }
  const observer = JSON.parse(readFileSync(summaryPath, "utf8")) as Record<string, any>
  const events = readJsonLines(eventsPath)

  const executor = executorCosts(observer, events)
  const management = options.v2StoreDir === undefined
    ? emptyCosts()
    : managementCosts(options.v2StoreDir, options.runId)
  const intent = intentMetrics(options.v2StoreDir, options.runId, events)

  return {
    run_id: options.runId,
    ...(typeof observer.arm_id === "string" ? { arm_id: observer.arm_id } : {}),
    management,
    executor,
    intent,
  }
}

const COMPARED_FIELDS = [
  "management.requests",
  "management.accepted",
  "management.failed",
  "management.input_tokens",
  "management.output_tokens",
  "management.reasoning_tokens",
  "management.cache_read_tokens",
  "management.cache_write_tokens",
  "management.cost",
  "management.duration_ms",
  "executor.requests",
  "executor.accepted",
  "executor.unmetered_requests_lower_bound",
  "executor.retries",
  "executor.tool_requests",
  "executor.tool_completed",
  "executor.tool_failed",
  "executor.tool_unresolved",
  "executor.input_tokens",
  "executor.output_tokens",
  "executor.reasoning_tokens",
  "executor.cache_read_tokens",
  "executor.cache_write_tokens",
  "executor.cost",
  "executor.duration_ms",
  "intent.user_input_events",
  "intent.delivery_ack_events",
  "intent.execution_return_events",
  "intent.assessments",
  "intent.checks",
  "intent.questions",
  "intent.unresolved_checks",
] as const

export function compareCostSummaries(on: CostSummary, off: CostSummary): CostComparison {
  const deltas: Record<string, CostDelta> = {}
  for (const path of COMPARED_FIELDS) {
    const onValue = valueAt(on, path)
    const offValue = valueAt(off, path)
    deltas[path] = {
      on: onValue,
      off: offValue,
      difference: differenceOf(onValue, offValue),
    }
  }
  return { on, off, deltas }
}

function valueAt(value: unknown, path: string): number | string {
  const parts = path.split(".")
  let current: unknown = value
  for (const part of parts) {
    if (!isRecord(current)) return "incomparable"
    current = current[part]
  }
  return typeof current === "number" || typeof current === "string" ? current : "incomparable"
}

function differenceOf(on: number | string, off: number | string): number | "unavailable" | "incomparable" {
  if (on === "unavailable" && off === "unavailable") return "unavailable"
  if (typeof on !== "number" || typeof off !== "number") return "incomparable"
  return on - off
}

function managementCosts(storeDir: string, runId: string): NumericCosts {
  const snapshotPath = join(storeDir, "v2-runs", runId, "snapshot.json")
  if (!existsSync(snapshotPath)) {
    throw new CostSummaryError("V2_RUN_MISSING", `v2 run ${runId} has no snapshot.json`)
  }
  const snapshot = JSON.parse(readFileSync(snapshotPath, "utf8")) as Record<string, any>
  const budget = isRecord(snapshot.budget) ? snapshot.budget : {}
  const log = Array.isArray(snapshot.management_log) ? snapshot.management_log : []
  const duration = log.reduce((total, entry) => total + (finiteNumber(entry?.duration_ms) ? entry.duration_ms : 0), 0)
  const accepted = log.filter((entry) => entry?.status === "accepted").length
  const failed = log.length - accepted
  return {
    requests: finiteNumber(budget.total_management_requests) ? budget.total_management_requests : log.length,
    accepted,
    failed,
    input_tokens: numericOrUnavailable(budget.management_input_tokens),
    output_tokens: numericOrUnavailable(budget.management_output_tokens),
    reasoning_tokens: numericOrUnavailable(budget.management_reasoning_tokens),
    cache_read_tokens: numericOrUnavailable(budget.management_cache_read_tokens),
    cache_write_tokens: numericOrUnavailable(budget.management_cache_write_tokens),
    cost: numericOrUnavailable(budget.management_cost),
    duration_ms: log.length === 0 ? "unavailable" : duration,
  }
}

function executorCosts(summary: Record<string, any>, events: unknown[]): CostSummary["executor"] {
  const models = isRecord(summary.models) ? summary.models : {}
  const tools = isRecord(summary.tools) ? summary.tools : {}
  const durations = events
    .map((event) => isRecord(event) ? event.metrics : undefined)
    .filter(isRecord)
    .map((metrics) => metrics.duration_ms)
    .filter(finiteNumber)
  const duration = durations.length === 0 ? "unavailable" as const : durations.reduce((total, value) => total + value, 0)
  const cacheWrite = sumMetric(events, "cache", "write")
  return {
    requests: finiteNumber(models.requests) ? models.requests : 0,
    accepted: finiteNumber(models.usage_bearing_completions) ? models.usage_bearing_completions : 0,
    failed: events.filter((event) => isRecord(event) && (event.event_type === "model.failed" || event.event_type === "session.error")).length,
    unmetered_requests_lower_bound: finiteNumber(models.unmetered_requests_lower_bound) ? models.unmetered_requests_lower_bound : 0,
    retries: events.filter((event) => isRecord(event) && event.event_type === "model.retried").length,
    tool_requests: finiteNumber(tools.total) ? tools.total : 0,
    tool_completed: finiteNumber(tools.completed) ? tools.completed : 0,
    tool_failed: finiteNumber(tools.error) ? tools.error : 0,
    tool_unresolved: finiteNumber(tools.unresolved) ? tools.unresolved : 0,
    input_tokens: numericOrUnavailable(models.input_tokens),
    output_tokens: numericOrUnavailable(models.output_tokens),
    reasoning_tokens: numericOrUnavailable(models.reasoning_tokens),
    cache_read_tokens: numericOrUnavailable(models.cache_read_tokens),
    cache_write_tokens: cacheWrite,
    cost: numericOrUnavailable(models.cost),
    duration_ms: duration,
  }
}

function intentMetrics(
  storeDir: string | undefined,
  runId: string,
  observerEvents: unknown[],
): CostSummary["intent"] {
  if (storeDir === undefined) {
    return {
      user_input_events: observerEvents.filter((event) => isRecord(event) && event.event_type === "user_input.observed").length,
      delivery_ack_events: 0,
      execution_return_events: 0,
      ir_revisions: {},
      compiled_revisions: {},
      assessments: 0,
      checks: 0,
      questions: 0,
      unresolved_checks: 0,
      pending_event_ids: [],
    }
  }
  const eventsPath = join(storeDir, "v2-runs", runId, "events.jsonl")
  const snapshotPath = join(storeDir, "v2-runs", runId, "snapshot.json")
  const events = existsSync(eventsPath) ? readJsonLines(eventsPath) : []
  const snapshot = existsSync(snapshotPath)
    ? JSON.parse(readFileSync(snapshotPath, "utf8")) as Record<string, any>
    : {}
  const kindCount = (kind: string): number => events.filter((event) => isRecord(event) && event.event?.kind === kind).length
  const checks = Array.isArray(snapshot.checks) ? snapshot.checks : []
  return {
    user_input_events: kindCount("user_input"),
    delivery_ack_events: kindCount("delivery_ack"),
    execution_return_events: kindCount("execution_return"),
    ir_revisions: snapshot.ir === undefined ? {} : Object.fromEntries(Object.entries(snapshot.ir as Record<string, any>).map(([id, task]) => [id, task?.revision])),
    compiled_revisions: snapshot.compiled === undefined ? {} : Object.fromEntries(Object.entries(snapshot.compiled as Record<string, any>).map(([id, intent]) => [id, intent?.compiled_revision])),
    assessments: Array.isArray(snapshot.assessments) ? snapshot.assessments.length : 0,
    checks: checks.length,
    questions: Array.isArray(snapshot.questions) ? snapshot.questions.length : 0,
    unresolved_checks: checks.filter((check) => check?.unresolved === true).length,
    pending_event_ids: Array.isArray(snapshot.pending_event_ids) ? snapshot.pending_event_ids : [],
  }
}

function emptyCosts(): NumericCosts {
  return {
    requests: 0,
    accepted: 0,
    failed: 0,
    input_tokens: 0,
    output_tokens: 0,
    reasoning_tokens: 0,
    cache_read_tokens: 0,
    cache_write_tokens: 0,
    cost: 0,
    duration_ms: 0,
  }
}

function sumMetric(events: unknown[], containerKey: string, field: string): number | "unavailable" {
  const values: number[] = []
  for (const event of events) {
    if (!isRecord(event)) continue
    const container = event.metrics
    if (!isRecord(container)) continue
    const tokens = container.tokens
    if (!isRecord(tokens)) continue
    const nested = tokens[containerKey]
    if (isRecord(nested) && finiteNumber(nested[field])) values.push(nested[field] as number)
  }
  return values.length === 0 ? "unavailable" : values.reduce((total, value) => total + value, 0)
}

function numericOrUnavailable(value: unknown): number | "unavailable" {
  return finiteNumber(value) ? value : "unavailable"
}

function finiteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value)
}

function isRecord(value: unknown): value is Record<string, any> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

function readJsonLines(path: string): unknown[] {
  if (!existsSync(path)) return []
  return readFileSync(path, "utf8")
    .split(/\r?\n/u)
    .filter(Boolean)
    .map((line) => JSON.parse(line) as unknown)
}
