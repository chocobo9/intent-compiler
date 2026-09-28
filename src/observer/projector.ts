import type { Manifest, ObserverEvent, RunSummary } from "./types.js"

export function projectRun(events: ObserverEvent[], manifest: Manifest): RunSummary {
  const tools = new Map<string | undefined, Record<string, any>>()
  const models = new Map<string, Record<string, any>>()
  const modelRequests: Array<Record<string, any>> = []
  const inputs: RunSummary["inputs"] = []
  const failures: RunSummary["instrumentation_failures"] = []
  const workspace: unknown[] = []
  let status = "registered"

  for (const event of events) {
    if (event.event_type === "tool.started") {
      tools.set(event.call_id, { call_id: event.call_id, tool: event.data?.tool, status: "started" })
    }
    if (event.event_type === "tool.completed" || event.event_type === "tool.error") {
      tools.set(event.call_id, {
        ...(tools.get(event.call_id) ?? { call_id: event.call_id }),
        tool: event.data?.tool ?? tools.get(event.call_id)?.tool,
        status: event.event_type === "tool.completed" ? "completed" : "error",
        duration_ms: event.metrics?.duration_ms,
      })
    }
    if (event.event_type === "model.completed" && event.message_id) {
      models.set(event.message_id, {
        message_id: event.message_id,
        role: event.data?.role ?? event.component,
        model: event.data?.model,
        provider: event.data?.provider,
        tokens: event.metrics?.tokens,
        cost: event.metrics?.cost,
        cost_kind: event.metrics?.cost_kind,
        duration_ms: event.metrics?.duration_ms,
      })
    }
    if (event.event_type === "model.requested") {
      modelRequests.push({
        event_id: event.event_id,
        message_id: event.message_id,
        role: event.data?.role ?? event.component,
        agent: event.data?.agent,
        model: event.data?.model,
        provider: event.data?.provider,
        parameters: event.data?.parameters,
      })
    }
    if (
      event.event_type === "user_input.observed" ||
      event.event_type === "executor_message.part_update_observed" ||
      event.event_type === "executor_message.sdk_readback_confirmed"
    ) {
      inputs.push({
        event_type: event.event_type,
        message_id: event.message_id,
        digest: event.data?.digest,
        matches_expected: event.data?.matches_expected,
      })
    }
    if (event.event_type === "workspace.diff") workspace.push(event.artifact_refs?.[0])
    if (event.status === "failed" || event.event_type.endsWith(".rejected") || event.event_type.endsWith(".failed")) {
      failures.push({ event_id: event.event_id, event_type: event.event_type, error: event.error })
    }
    status = projectedStatus(event, status)
  }

  const toolValues = [...tools.values()]
  const modelValues = [...models.values()]
  return {
    schema_version: "0.1",
    run_id: manifest.run_id,
    arm_id: manifest.arm_id,
    task_id: manifest.task_id,
    turn_id: manifest.turn_id,
    session_id: manifest.session_id,
    status,
    event_count: events.length,
    inputs,
    tools: {
      total: toolValues.length,
      completed: toolValues.filter((item) => item.status === "completed").length,
      error: toolValues.filter((item) => item.status === "error").length,
      unresolved: toolValues.filter((item) => item.status === "started").length,
      calls: toolValues,
    },
    models: {
      requests: modelRequests.length,
      usage_bearing_completions: modelValues.length,
      unmetered_requests_lower_bound: Math.max(0, modelRequests.length - modelValues.length),
      input_tokens: sum(modelValues, (item) => item.tokens?.input),
      output_tokens: sum(modelValues, (item) => item.tokens?.output),
      reasoning_tokens: sum(modelValues, (item) => item.tokens?.reasoning),
      cache_read_tokens: sum(modelValues, (item) => item.tokens?.cache?.read),
      cost: sum(modelValues, (item) => item.cost),
      cost_kinds: [...new Set(modelValues.map((item) => item.cost_kind).filter(Boolean))] as string[],
      messages: modelValues,
      request_events: modelRequests,
    },
    workspace_changes: deduplicateArtifacts(workspace),
    instrumentation_failures: failures,
  }
}

export function renderReport(summary: RunSummary, events: ObserverEvent[]): string {
  const rows = events
    .map(
      (event) => `<tr><td>${event.sequence}</td><td>${escapeHtml(event.timestamp)}</td><td>${escapeHtml(
        event.component,
      )}</td><td>${escapeHtml(event.event_type)}</td><td>${escapeHtml(event.status ?? "")}</td></tr>`,
    )
    .join("\n")
  return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>Experiment observer run ${escapeHtml(summary.run_id)}</title>
<style>body{font:14px system-ui;margin:2rem;max-width:1200px}table{border-collapse:collapse;width:100%}td,th{border:1px solid #ccc;padding:.35rem;text-align:left}pre{background:#f5f5f5;padding:1rem;overflow:auto}</style></head>
<body><h1>Run ${escapeHtml(summary.run_id)}</h1><h2>Summary</h2><pre>${escapeHtml(
    JSON.stringify(summary, null, 2),
  )}</pre><h2>Timeline</h2><table><thead><tr><th>#</th><th>time</th><th>module</th><th>event</th><th>status</th></tr></thead><tbody>${rows}</tbody></table></body></html>\n`
}

function projectedStatus(event: ObserverEvent, previous: string): string {
  if (event.event_type === "run.failed" || event.event_type === "session.error") return "failed"
  if (
    event.event_type.endsWith(".rejected") ||
    event.event_type.endsWith("_rejected") ||
    event.event_type === "reconciliation.failed"
  ) {
    return "instrumentation_failed"
  }
  if (event.event_type === "run.finished") return "completed"
  if (event.event_type === "turn.completed") return "turn_completed"
  if (event.event_type === "reconciliation.completed") return "observed"
  if (event.event_type === "session.busy") return "executing"
  if (event.event_type === "executor_message.sdk_readback_confirmed") return "delivery_observed"
  if (event.event_type === "executor_message.part_update_observed") return "part_update_observed"
  if (event.event_type === "user_input.observed") return "input_observed"
  return previous
}

function sum(values: Array<Record<string, any>>, getter: (value: Record<string, any>) => unknown): number | "unavailable" {
  const numbers = values.map(getter).filter((value): value is number => Number.isFinite(value))
  return numbers.length === 0 ? "unavailable" : numbers.reduce((total, value) => total + value, 0)
}

function deduplicateArtifacts(values: unknown[]): unknown[] {
  const seen = new Set<string>()
  return values.filter((value) => {
    const record = value && typeof value === "object" ? (value as Record<string, any>) : undefined
    const key = record?.digest ?? JSON.stringify(value)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function escapeHtml(value: unknown): string {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;")
}
