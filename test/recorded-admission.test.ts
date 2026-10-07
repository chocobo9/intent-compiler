import test from "node:test"
import assert from "node:assert/strict"
import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { resolveSourceRefs } from "../src/core/intent-compiler-v2.js"
import { IntentStateManager } from "../src/core/intent-state-v2.js"
import { bindContentRefs, bindExpectedRevisions } from "../src/core/parent-generation.js"
import { materializeSourceContent, userText, validateSourceCoverage } from "../src/core/source-payload.js"
import type { Candidate, CompilerEvent, TaskIntent } from "../src/core/intent-contract.js"

// A recorded user batch of the 2026-10-06 run 53ca6c06 (round 10, management_log[18],
// first attempt): the answer's source_coverage classes three section headings as
// context while IR items still adopt them.  Offline, read-only; skipped without the data.
const run = "intent-luna-dpipe-full-20261006-114022-53ca6c06"
const store = join(process.env.EVOCODEBENCH_ROOT ?? "D:/huawei/EvoCodeBench", "harbor_intent_data", run, "compiler-store", "v2-runs", run)
const recorded = existsSync(join(store, "snapshot.json"))

/** Replace every source_id that is an alias of the request with the event id it stands for. */
function unalias<T>(value: T, table: Map<string, string>): T {
  if (Array.isArray(value)) return value.map(entry => unalias(entry, table)) as T
  if (value === null || typeof value !== "object") return value
  return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key,
    key === "source_id" && typeof entry === "string" ? table.get(entry) ?? entry : unalias(entry, table)])) as T
}

test("the recorded round-10 user batch is refused once, naming all three heading conflicts", { skip: !recorded }, () => {
  const snapshot = JSON.parse(readFileSync(join(store, "snapshot.json"), "utf8")) as { management_log: Array<{ attempts: Array<{ text: string; request: { ir: Record<string, TaskIntent> }; source_aliases: Array<{ alias: string; event_id: string }> }> }> }
  const attempt = snapshot.management_log[18]!.attempts[0]!
  const table = new Map(attempt.source_aliases.map(entry => [entry.alias, entry.event_id]))
  const events: CompilerEvent[] = readFileSync(join(store, "events.jsonl"), "utf8").split("\n").filter(Boolean).map(line => (JSON.parse(line) as { event: CompilerEvent }).event)
    .filter(event => userText(event) !== undefined)
  const trigger = table.get("e318")!
  const previous = unalias(attempt.request.ir, table)
  const answer = unalias(JSON.parse(attempt.text.slice(attempt.text.indexOf("{"), attempt.text.lastIndexOf("}") + 1)) as Candidate, table)
  assert.equal(answer.source_coverage!.filter(entry => entry.disposition === "context").length, 4)
  const ir = structuredClone(previous)
  bindContentRefs(answer, previous)
  resolveSourceRefs(answer, events)
  for (const group of answer.groups) {
    bindExpectedRevisions(group, previous)
    const applied = new IntentStateManager(ir).apply(group.ir_changes, group.task_refs)
    assert.equal(applied.ok, true, applied.errors.map(error => error.message).join("; "))
    Object.assign(ir, applied.tasks)
    materializeSourceContent(ir[group.task_refs[0]!]!, group.ir_changes, events)
  }
  let message = ""
  try { validateSourceCoverage(answer, events.filter(event => event.event_id === trigger), events, previous, ir, { ownEventIds: new Set([trigger]) }) } catch (error) { message = (error as Error).message }
  const conflicts = message.split(" | ").filter(part => /classifies actively adopted text as context/.test(part))
  assert.equal(conflicts.length, 3, message)
  for (const heading of ["## Manifest format change (conflict)", "## Pipeline extension", "## Lineage extension"]) {
    assert.ok(conflicts.some(part => part.includes(heading)), `names ${heading}`)
  }
  assert.deepEqual(conflicts.map(part => /^source_coverage\[(\d+)\]/.exec(part)?.[1]), ["2", "3", "4"])
})
