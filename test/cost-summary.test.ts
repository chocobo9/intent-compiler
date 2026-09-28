import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { compareCostSummaries, readCostSummary } from "../src/runtime/cost-summary.js"

test("cost summary combines v2 management and observer executor metrics", () => {
  const root = mkdtempSync(join(tmpdir(), "intent-cost-summary-"))
  const observerRun = join(root, "observer-store", "runs", "run-1")
  const v2Run = join(root, "compiler-store", "v2-runs", "run-1")
  mkdirSync(observerRun, { recursive: true })
  mkdirSync(v2Run, { recursive: true })

  writeFileSync(join(observerRun, "summary.json"), JSON.stringify({
    run_id: "run-1",
    arm_id: "compiler-v2",
    models: {
      requests: 2,
      usage_bearing_completions: 2,
      unmetered_requests_lower_bound: 0,
      input_tokens: 100,
      output_tokens: 20,
      reasoning_tokens: 5,
      cache_read_tokens: 10,
      cost: 0.5,
      cost_kinds: ["computed"],
    },
    tools: { total: 1, completed: 1, error: 0, unresolved: 0 },
  }))
  writeFileSync(join(observerRun, "events.jsonl"), [
    JSON.stringify({ event_type: "model.completed", metrics: { duration_ms: 120, tokens: { cache: { write: 2 } } } }),
    JSON.stringify({ event_type: "model.retried" }),
    JSON.stringify({ event_type: "user_input.observed" }),
  ].join("\n"))
  writeFileSync(join(v2Run, "snapshot.json"), JSON.stringify({
    run_id: "run-1",
    budget: {
      total_management_requests: 1,
      management_input_tokens: 50,
      management_output_tokens: 10,
      management_reasoning_tokens: 2,
      management_cache_read_tokens: 3,
      management_cache_write_tokens: 0,
      management_cost: 0.25,
    },
    management_log: [{ status: "accepted", duration_ms: 300 }],
    ir: { t1: { revision: 1 } },
    compiled: { t1: { compiled_revision: 2 } },
    assessments: [{ result: "satisfied" }],
    checks: [{ unresolved: false }, { unresolved: true }],
    questions: [{ text: "q" }],
    pending_event_ids: [],
  }))
  writeFileSync(join(v2Run, "events.jsonl"), [
    JSON.stringify({ event: { kind: "user_input" } }),
    JSON.stringify({ event: { kind: "delivery_ack" } }),
    JSON.stringify({ event: { kind: "execution_return" } }),
  ].join("\n"))

  const summary = readCostSummary({
    observerStoreDir: join(root, "observer-store"),
    runId: "run-1",
    v2StoreDir: join(root, "compiler-store"),
  })

  assert.equal(summary.management.requests, 1)
  assert.equal(summary.management.input_tokens, 50)
  assert.equal(summary.management.cost, 0.25)
  assert.equal(summary.management.duration_ms, 300)
  assert.equal(summary.executor.input_tokens, 100)
  assert.equal(summary.executor.cache_write_tokens, 2)
  assert.equal(summary.executor.retries, 1)
  assert.equal(summary.executor.duration_ms, 120)
  assert.equal(summary.intent.assessments, 1)
  assert.equal(summary.intent.unresolved_checks, 1)
  assert.equal(summary.intent.delivery_ack_events, 1)

  const comparison = compareCostSummaries(summary, {
    ...summary,
    management: { ...summary.management, cost: 0 },
    executor: { ...summary.executor, cost: 0 },
  })
  assert.equal(comparison.deltas["management.cost"]?.difference, 0.25)
})
