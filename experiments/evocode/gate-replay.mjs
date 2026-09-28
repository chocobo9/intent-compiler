#!/usr/bin/env node
/**
 * Offline gate replay: feed the candidates already stored in run snapshots
 * through the CURRENT mechanical gates, so "which gate would this candidate
 * hit" is a measurement instead of a guess.  No model calls, no keys.
 *
 * It imports the same functions the runtime calls (dist/core/intent-compiler-v2.js),
 * so the offline answer cannot drift from the live one: whatever this script
 * reports is exactly what advance() would have reported for that candidate.
 *
 * Usage:
 *   node experiments/evocode/gate-replay.mjs
 *   node experiments/evocode/gate-replay.mjs --runs r10,r11b,r11c,r11d
 *   node experiments/evocode/gate-replay.mjs --out results/evocodebench/intent-on/gate-replay-2026-09-24
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { candidateIssues, resolveCheckEvidence, resolveSourceRefs } from "../../dist/core/intent-compiler-v2.js"

const ROOT = new URL("../../", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/u, "$1")
const INTENT_ON = join(ROOT, "results", "evocodebench", "intent-on")
/**
 * Which clause of the project each gate belongs to, so a rejected batch is
 * reported as "hit T04's rule" and not just "hit some gate".  The map lives in
 * development/contract-enforcement.json and is checked against the code by
 * experiments/evocode/contract-check.mjs.
 */
const ENFORCEMENT = JSON.parse(readFileSync(join(ROOT, "development", "contract-enforcement.json"), "utf8"))
const clauseOf = (gateId) => ENFORCEMENT.gate_index.find((gate) => gate.id === gateId)?.clause

const argOf = (name) => {
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] : undefined
}
const RUN_FILTER = argOf("--runs")?.split(",").map((entry) => entry.trim()).filter((entry) => entry.length > 0)
const OUT_DIR = argOf("--out") ?? join(INTENT_ON, "gate-replay-2026-09-24")
/** The pre-structured-output era (`runtime-r4…r12`) is out of scope by default. */
const INCLUDE_LEGACY = process.argv.includes("--all")

/** Gate table: id, class, and the patterns that recognise its issues, in first-match order. */
const GATES = [
  { id: "basis", class: "A", name: "basis 未命中本批事件", re: /candidate basis/i },
  { id: "delegation-not-recorded", class: "A", name: "带用户输入但没有任何组命名 task", re: /carries user input but no group names a task/i },
  { id: "task-refs-unknown", class: "B", name: "task_refs 指向不存在的任务", re: /task_refs names unknown task/i },
  { id: "draft-task-unknown", class: "B", name: "draft 的 task_id 与组不一致或不存在", re: /drafts names unknown task|while this group's first task_ref/i },
  { id: "atom-revision", class: "B", name: "原子 id+revision 复用但内容变了", re: /already exists with different content/i },
  { id: "registration-output", class: "A", name: "同一 output 两种声明（format）", re: /one deliverable has one format|declares output .* as format/i },
  { id: "registration-binding", class: "A", name: "同一 binding 两种声明（ref/role）", re: /declares binding .* differently|binds .* to a different material or role/i },
  { id: "coverage-missing", class: "A", name: "replace 出原子但没有 coverage 去向", re: /must record where the compiled work for task/i },
  { id: "no-destination", class: "A", name: "整组没有目的地（无编译/无 coverage/无提问）", re: /records no destination/i },
  { id: "ir-dry-run", class: "B", name: "IR 变更干跑失败（未知对象/过期 revision/…）", re: /^groups\[\d+\]/i },
]
const classify = (issue) => GATES.find((gate) => gate.re.test(issue))?.id ?? "unclassified"
const classOf = (gateId) => GATES.find((gate) => gate.id === gateId)?.class ?? "?"

function snapshots() {
  if (!existsSync(INTENT_ON)) return []
  const found = []
  for (const entry of readdirSync(INTENT_ON, { withFileTypes: true })) {
    if (!entry.isDirectory() || !entry.name.startsWith("runtime-")) continue
    if (!INCLUDE_LEGACY && !entry.name.startsWith("runtime-d3w9-")) continue
    const runsDir = join(INTENT_ON, entry.name, "store", "v2-runs")
    if (!existsSync(runsDir)) continue
    for (const run of readdirSync(runsDir, { withFileTypes: true })) {
      if (!run.isDirectory()) continue
      const file = join(runsDir, run.name, "snapshot.json")
      if (existsSync(file)) found.push({ label: entry.name, file })
    }
  }
  return found.sort((left, right) => left.label.localeCompare(right.label))
}

const short = (value, width) => {
  const text = typeof value === "string" ? value : JSON.stringify(value)
  return text.length > width ? `${text.slice(0, width - 1)}…` : text
}

const INFRA = /could not be completed|returned no verdict|must have required property|no verdict|invalid_response|schema|timeout|fetch failed|ECONN|429|5\d\d/iu
const gateTotals = new Map()
const gateAll = new Map()
const replay = { generated_at: new Date().toISOString(), runs: [], note: "candidates are the stored ones (a conditional sample): this measures first-hit distribution, not per-gate pass rates." }

for (const { label, file } of snapshots()) {
  if (RUN_FILTER !== undefined && !RUN_FILTER.some((suffix) => label.endsWith(suffix) || label.includes(suffix))) continue
  const snapshot = JSON.parse(readFileSync(file, "utf8"))
  const batches = []
  for (const record of snapshot.management_log ?? []) {
    if (record.candidate === undefined) continue
    const request = record.request ?? {}
    const events = Array.isArray(request.events) ? request.events : []
    const ir = request.ir ?? {}
    const compiled = request.compiled ?? {}
    const candidate = JSON.parse(JSON.stringify(record.candidate))
    let refs = { total: 0, resolved: 0, normalized: 0, unresolved: 0 }
    let issues = []
    let crashed
    try {
      refs = resolveSourceRefs(candidate, events)
      issues = candidateIssues(candidate, events, ir, compiled, { nextCompiledIntentId: () => "compiled-dry-run" })
    } catch (error) {
      crashed = String(error?.message ?? error)
    }
    const gates = issues.map((issue) => {
      const gate = classify(issue)
      return { gate, clause: clauseOf(gate), text: issue }
    })
    const first = gates[0]
    if (first) gateTotals.set(first.gate, (gateTotals.get(first.gate) ?? 0) + 1)
    for (const gate of gates) gateAll.set(gate.gate, (gateAll.get(gate.gate) ?? 0) + 1)
    batches.push({
      request_id: record.request_id,
      old_status: record.status,
      old_error_code: record.error_code,
      candidate_chars: JSON.stringify(record.candidate).length,
      source_refs: refs,
      issues,
      gates,
      first_gate: first?.gate,
      first_gate_class: first ? classOf(first.gate) : undefined,
      ...(crashed === undefined ? {} : { replay_crashed: crashed }),
    })
  }

  const checks = []
  for (const check of snapshot.semantic_checks ?? []) {
    const events = (snapshot.management_log?.[0]?.request?.events) ?? []
    const ir = snapshot.management_log?.[0]?.request?.ir ?? {}
    const compiled = snapshot.management_log?.[0]?.request?.compiled ?? {}
    let resolved = []
    try {
      resolved = resolveCheckEvidence(check.findings ?? [], events, ir, compiled)
    } catch {
      resolved = []
    }
    const infra = (check.findings ?? []).filter((finding) => (finding.refs ?? []).length === 0
      && INFRA.test(`${finding.claim ?? ""} ${finding.expected ?? ""} ${finding.observed ?? ""}`))
    checks.push({
      sequence: check.sequence,
      verdict: check.verdict,
      findings: (check.findings ?? []).length,
      evidence_resolved: resolved.filter((finding) => finding.evidence_resolved === true).length,
      infra_shaped: infra.length,
      infra_excerpt: infra.length === 0 ? undefined : short(infra[0].observed ?? infra[0].claim, 160),
    })
  }

  // How many management calls one user event actually cost (the budget unit).
  const callsByRequest = new Map()
  for (const call of snapshot.management_calls ?? []) {
    const entry = callsByRequest.get(call.request_id) ?? { propose: 0, check: 0 }
    entry[call.kind] = (entry[call.kind] ?? 0) + 1
    callsByRequest.set(call.request_id, entry)
  }
  // Runs from before 2026-09-24 have no `management_calls`: estimate proposals
  // and checks from the two records that do exist there.
  const hasCallRecords = (snapshot.management_calls ?? []).length > 0
  const estimated = { propose: (snapshot.management_log ?? []).length, check: (snapshot.semantic_checks ?? []).length }
  const byEvent = new Map()
  for (const record of snapshot.management_log ?? []) {
    const key = [...(record.trigger_event_ids ?? [])].sort().join("+") || "(no trigger)"
    const entry = byEvent.get(key) ?? { event_ids: record.trigger_event_ids ?? [], batches: 0, calls: 0, propose: 0, check: 0 }
    entry.batches += 1
    const calls = callsByRequest.get(record.request_id)
    if (calls) {
      entry.calls += calls.propose + calls.check
      entry.propose += calls.propose
      entry.check += calls.check
    } else {
      entry.calls += 1
      if (!hasCallRecords) entry.estimated = true
    }
    byEvent.set(key, entry)
  }

  replay.runs.push({
    run: label,
    snapshot: file,
    batches,
    checks,
    total_management_requests: snapshot.budget?.total_management_requests,
    estimated_calls: hasCallRecords ? undefined : estimated,
    requests_by_user_event: [...byEvent.values()].map((entry) => ({
      ...entry,
      event_ids: entry.event_ids.map((id) => short(id, 60)),
    })),
  })
}

// ---------------------------------------------------------------- console report
console.log(`# 离线门禁回放（候选来自存档快照，判定来自 runtime 同一份函数）\n`)
for (const run of replay.runs) {
  const totals = `总请求=${run.total_management_requests ?? "?"}`
  const estimate = run.estimated_calls === undefined
    ? ""
    : `（旧记录无 management_calls，按 propose ${run.estimated_calls.propose} + check ${run.estimated_calls.check} 估算）`
  console.log(`## ${run.run}  ${totals} ${estimate}`)
  for (const batch of run.batches) {
    const refs = `${batch.source_refs.resolved}/${batch.source_refs.total}`
    const first = batch.first_gate === undefined
      ? "(无 issues)"
      : `${batch.first_gate}[${batch.first_gate_class}] → ${clauseOf(batch.first_gate) ?? "?"}`
    console.log(`  ${batch.request_id} old=${batch.old_status} chars=${batch.candidate_chars} refs=${refs} issues=${batch.issues.length} first=${first}`)
    if (batch.replay_crashed) console.log(`    replay crashed: ${short(batch.replay_crashed, 120)}`)
    for (const gate of batch.gates) console.log(`    - ${gate.gate}[${classOf(gate.gate)}]→${gate.clause ?? "?"} ${short(gate.text, 150)}`)
  }
  for (const check of run.checks) {
    const flag = check.infra_shaped > 0 ? "  ← 核对跑不起来，却记成了 verdict" : ""
    console.log(`  check#${check.sequence} verdict=${check.verdict} findings=${check.findings} evidence_resolved=${check.evidence_resolved}${flag}`)
    if (check.infra_excerpt) console.log(`    ${short(check.infra_excerpt, 150)}`)
  }
  for (const group of run.requests_by_user_event) {
    const mark = group.estimated ? "（估算）" : ""
    console.log(`  user-event 批次数=${group.batches} 调用数=${group.calls}${mark} (propose ${group.propose}, check ${group.check})`)
  }
  console.log("")
}

console.log("## 关卡统计")
for (const gate of GATES) {
  const first = gateTotals.get(gate.id) ?? 0
  const all = gateAll.get(gate.id) ?? 0
  console.log(`  ${gate.id.padEnd(24)} class=${gate.class} clause=${(clauseOf(gate.id) ?? "?").padEnd(24)} 首次命中=${first} 全部命中=${all}  ${gate.name}`)
}
console.log("\n分类口径：A=模型记账/措辞，代码可从自己的记录补出来；B=真矛盾（未知对象、内容变了没升 revision 等）；C 类不在这张表里（见核对记录与预算计数两节）。")
console.log(`\nJSON: ${join(OUT_DIR, "gate-replay.json")}`)

mkdirSync(OUT_DIR, { recursive: true })
writeFileSync(join(OUT_DIR, "gate-replay.json"), `${JSON.stringify(replay, null, 2)}\n`, "utf8")
