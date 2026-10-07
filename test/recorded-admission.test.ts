import test from "node:test"
import assert from "node:assert/strict"
import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { resolveSourceRefs } from "../src/core/intent-compiler-v2.js"
import { IntentStateManager } from "../src/core/intent-state-v2.js"
import { bindContentRefs, bindExpectedRevisions, settleContentRefs } from "../src/core/parent-generation.js"
import { bindCurrentRequirements, userInputOrder } from "../src/core/requirement-flow.js"
import { materializeSourceContent, recordedDispositions, selectedSourceHistory, SourceLedger, userText, validateSourceCoverage } from "../src/core/source-payload.js"
import type { Atom, Candidate, CompilerEvent, TaskIntent } from "../src/core/intent-contract.js"

// Recorded user batches of the 2026-10-06 run 53ca6c06.  Offline, read-only;
// skipped without the data.
const run = "intent-luna-dpipe-full-20261006-114022-53ca6c06"
const store = join(process.env.EVOCODEBENCH_ROOT ?? "D:/huawei/EvoCodeBench", "harbor_intent_data", run, "compiler-store", "v2-runs", run)
const recorded = existsSync(join(store, "snapshot.json"))

/** The decoder drops the nulls strict providers write for absent optional fields. */
function withoutNulls<T>(value: T): T {
  if (Array.isArray(value)) return value.map(withoutNulls) as T
  if (value === null || typeof value !== "object") return value
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== null).map(([key, entry]) => [key, withoutNulls(entry)])) as T
}

/** Replace every source_id that is an alias of the request with the event id it stands for. */
function unalias<T>(value: T, table: Map<string, string>): T {
  if (Array.isArray(value)) return value.map(entry => unalias(entry, table)) as T
  if (value === null || typeof value !== "object") return value
  return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key,
    key === "source_id" && typeof entry === "string" ? table.get(entry) ?? entry : unalias(entry, table)])) as T
}

interface Attempt { text: string; generation_stage?: string; issues?: string[]; request: { ir: Record<string, TaskIntent> }; source_aliases: Array<{ alias: string; event_id: string }> }
interface Snapshot {
  management_log: Array<{ status: string; trigger_event_ids: string[]; attempts: Attempt[]; candidate: Candidate }>
  compiled: Record<string, { atoms: Atom[] }>
}

function load() {
  const snapshot = JSON.parse(readFileSync(join(store, "snapshot.json"), "utf8")) as Snapshot
  const journal = readFileSync(join(store, "events.jsonl"), "utf8").split("\n").filter(Boolean).map(line => JSON.parse(line) as { sequence: number; event: CompilerEvent })
  return { snapshot, journal, events: journal.map(row => row.event).filter(event => userText(event) !== undefined) }
}

/**
 * The IR stage of one recorded answer, from the IR that batch's request showed:
 * bind, resolve, apply, materialize, then the source-coverage gate.  Returns the
 * IR and the gate's message ("" when accepted).
 */
function irStage(data: ReturnType<typeof load>, batch: number, index: number) {
  const attempt = data.snapshot.management_log[batch]!.attempts[index]!
  const table = new Map(attempt.source_aliases.map(entry => [entry.alias, entry.event_id]))
  const previous = unalias(attempt.request.ir, table)
  const answer = unalias(withoutNulls(JSON.parse(attempt.text.slice(attempt.text.indexOf("{"), attempt.text.lastIndexOf("}") + 1)) as Candidate), table)
  const trigger = data.snapshot.management_log[batch]!.trigger_event_ids[0]!
  const ir = structuredClone(previous)
  bindContentRefs(answer, previous)
  resolveSourceRefs(answer, data.events)
  for (const group of answer.groups) {
    bindExpectedRevisions(group, previous)
    const applied = new IntentStateManager(ir).apply(group.ir_changes, group.task_refs)
    assert.equal(applied.ok, true, applied.errors.map(error => error.message).join("; "))
    Object.assign(ir, applied.tasks)
    materializeSourceContent(ir[group.task_refs[0]!]!, group.ir_changes, data.events)
  }
  settleContentRefs(ir)
  let message = ""
  try { validateSourceCoverage(answer, data.events.filter(event => event.event_id === trigger), data.events, previous, ir, { ownEventIds: new Set([trigger]) }) } catch (error) { message = (error as Error).message }
  return { answer, previous, ir, message }
}

/**
 * The batch's recorded CI answer, as its accepted candidate stores it, bound to
 * an IR: the delivered task text of each Atom, with the requirement passages
 * code attaches from that IR and the ledger of the batches before it.
 */
function delivered(data: ReturnType<typeof load>, batch: number, previous: Record<string, TaskIntent>, ir: Record<string, TaskIntent>): Map<string, string> {
  const log = data.snapshot.management_log.slice(0, batch)
  const texts = new Map(data.journal.flatMap(row => { const text = userText(row.event); return text === undefined ? [] : [[row.event.event_id, text] as const] }))
  const assembly = { inputOrder: userInputOrder(data.journal), texts, ledger: new SourceLedger({ texts, selected: selectedSourceHistory(log, previous), dispositions: recordedDispositions(log) }) }
  const tasks = new Map<string, string>()
  for (const group of structuredClone(data.snapshot.management_log[batch]!.candidate).groups) {
    const taskId = group.task_refs[0]!
    for (const draft of bindCurrentRequirements(group, ir[taskId]!, previous[taskId], data.events, [], assembly)) {
      for (const atom of draft.atoms) tasks.set(`${atom.atom_id}@${atom.revision}`, atom.task)
    }
  }
  return tasks
}

test("the recorded round-10 user batch's first answer is accepted: its heading-only context entries are dropped", { skip: !recorded }, () => {
  const data = load()
  const { answer, message } = irStage(data, 18, 0)
  assert.equal(message, "")
  assert.equal(answer.source_coverage!.filter(entry => entry.disposition === "context").length, 1, "three of the four context entries named only headings")
})

/** A delivered task split at its requirement block headers: the instruction, then each block by item version. */
function blocks(task: string): Array<{ version: string; digest: string; body: string }> {
  const parts = task.split(/^\[assigned requirement (\S+) (sha256:[0-9a-f]+)\]\n/mu)
  const found = [{ version: "instruction", digest: "", body: parts[0]! }]
  for (let index = 1; index < parts.length; index += 3) found.push({ version: parts[index]!, digest: parts[index + 1]!, body: parts[index + 2]! })
  return found
}

// mgmt-19 (R10), mgmt-30 (R14) and mgmt-32 (R15) each refused their first IR
// answer for headings alone: context entries for headings an item adopts, or a
// first line `"# …` with no destination.  With that year's recorded CI answer the
// first answer delivers the same passages.  mgmt-19's first answer also adopts
// the heading between two passages of input 10, so they join into one passage:
// the heading takes the place of the second passage's label.
for (const { batch, accepted, joined } of [
  { batch: 18, accepted: 4, joined: { "dpipe-reconcile@0": { then: "\n\n\n\n[user input 10]\n", now: "\n\n## Pipeline extension\n\n" } } as Record<string, { then: string; now: string }> },
  { batch: 29, accepted: 2, joined: {} },
  { batch: 31, accepted: 1, joined: {} },
]) test(`mgmt-${batch + 1}: the first IR answer is accepted and, with the recorded CI answer, delivers the passages that year's run delivered${Object.keys(joined).length > 0 ? " joined by the heading it adopts" : ""}`, { skip: !recorded }, () => {
  const data = load()
  const first = irStage(data, batch, 0)
  assert.equal(first.message, "", "the first answer passes the source-coverage gate")
  const then = irStage(data, batch, accepted)
  assert.equal(then.message, "")
  const now = delivered(data, batch, first.previous, first.ir)
  const control = delivered(data, batch, then.previous, then.ir)
  // The harness reproduces what was delivered from the answer that year's code accepted.
  for (const [version, text] of control) {
    const [atomId, revision] = version.split("@")
    const stored = Object.values(data.snapshot.compiled).flatMap(intent => intent.atoms).find(atom => atom.atom_id === atomId && atom.revision === Number(revision))
    assert.equal(text, stored?.task, `${version} as delivered then`)
  }
  assert.deepEqual([...now.keys()], [...control.keys()])
  const items = (ir: Record<string, TaskIntent>) => new Map(Object.values(ir).flatMap(task => task.content).map(item => [`${item.item_id}@${item.revision}`, item]))
  const itemsNow = items(first.ir), itemsThen = items(then.ir)
  for (const [version, text] of now) {
    const before = blocks(control.get(version)!), after = blocks(text)
    assert.deepEqual(after.map(block => block.version), before.map(block => block.version), `${version}: the same requirement blocks in the same order`)
    for (const [index, block] of after.entries()) {
      const was = before[index]!
      const join = joined[block.version]
      if (join === undefined) assert.equal(block.body, was.body, `${version} ${block.version}: the passages are delivered verbatim`)
      else {
        assert.equal(was.body.split(join.then).length, 2, `${version} ${block.version}: one passage boundary`)
        assert.equal(block.body, was.body.replace(join.then, join.now), `${version} ${block.version}: only that boundary changes`)
      }
      // A block header carries the item digest; it differs exactly where the answers' items differ (sources, or the model's own label).
      if (block.version !== "instruction") assert.equal(block.digest === was.digest, JSON.stringify(itemsNow.get(block.version)) === JSON.stringify(itemsThen.get(block.version)), `${version} ${block.version}: digest follows the item`)
    }
  }
})
