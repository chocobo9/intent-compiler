import { test } from "node:test"
import assert from "node:assert/strict"
import { digestText, type AtomStateRecord, type CompiledIntent, type ContentItem, type TaskIntent } from "../src/core/intent-contract.js"
import { atomExpansion, buildManifest, resolveNeeds, selectView, VIEW_LIMITS } from "../src/core/view.js"

const item = (id: string, text: string, revision = 0): ContentItem => ({
  item_id: id, revision, text, about: [], scope: [{ target_id: "t" }], support: [],
  sources: [{ source_id: "turn-1", digest: digestText(text), span: { unit: "utf16", start: 0, end: text.length } }],
})

const task = (...content: ContentItem[]): TaskIntent => ({
  task_id: "t", revision: 0,
  goal: { text: "Maintain dpipe.", sources: [] },
  current_scope: { text: "Proceed.", disposition: "proceed", sources: [] },
  content, bindings: [], outputs: [], unresolved: [],
})

const atom = (id: string, taskText: string, revision = 0) => ({
  atom_id: id, revision, goal_refs: [], task: taskText, inputs: [], outputs: [], constraints: [],
  optional_tools: [], authority: { basis: [], rules: [], lifetime: "this_execution" as const, delegation: "not_supported" as const },
  preconditions: [], completion: [{ text: "builds", evidence_required: "exit 0" }], return_when: ["success"], intent_judgments: [],
})

const plan = (...atoms: ReturnType<typeof atom>[]): CompiledIntent => ({
  schema_version: 2, artifact_type: "compiled_intent", compiled_intent_id: "compiled-1", task_id: "t",
  compiled_revision: 0, intent_basis: [], atoms, relations: [], attachments: [],
})

const state = (id: string, revision: number, status: AtomStateRecord["status"]): AtomStateRecord => ({
  task_id: "t", atom_id: id, atom_revision: revision, compiled_intent_id: "compiled-1", status, updated_at: "2026-09-30T00:00:00.000Z",
})

test("the manifest lists every object once with a bounded summary and its source pointers", () => {
  const long = `Requirement ${"x".repeat(200)}`
  const [manifest] = buildManifest({ t: task(item("r-1", long), item("r-2", "Short rule.")) }, { t: plan(atom("a-1", long)) })
  assert.equal(manifest!.items.length, 2)
  assert.equal(manifest!.atoms.length, 1)
  assert.equal(manifest!.atoms[0]!.status, "not_found")
  for (const entry of [...manifest!.items, ...manifest!.atoms]) {
    assert.ok(entry.summary.length <= VIEW_LIMITS.manifestSummary, entry.summary)
  }
  assert.deepEqual(manifest!.items[0]!.source_events, ["turn-1"])
})

test("every expanded object is traceable to exactly one rule; an IR operation does not read Atom text", () => {
  const ir = { t: task(item("r-touched", "Touched rule."), item("r-quiet", "Quiet rule.")) }
  const view = selectView({
    operation: "update_ir",
    turn: { event_id: "turn-2", text: "Please revise r-touched only." },
    ir, compiled: { t: plan(atom("a-1", "Implement.")) },
    atom_states: [state("a-1", 0, "ready")],
    recently_changed: ["r-quiet"],
    last_requested: ["a-1"],
  })
  const rules = new Map(view.expanded.map((entry) => [entry.ref, entry.rule]))
  assert.equal(rules.get("r-touched"), "referenced")
  assert.equal(rules.get("r-quiet"), "recent")
  assert.equal(rules.has("a-1"), false, "the ready Atom stays visible in the manifest but is not read")
  assert.equal(view.manifest[0]!.items.length, 2, "unexpanded objects stay in the manifest")
  assert.equal(view.manifest[0]!.atoms.length, 1)
  assert.ok(view.expanded.every((entry) => entry.bytes === entry.text.length))
  const planView = selectView({
    operation: "compile_plan",
    turn: { event_id: "turn-2", text: "Any text." },
    ir, compiled: { t: plan(atom("a-1", "Implement.")) },
    last_requested: ["r-quiet"],
  })
  assert.equal(planView.expanded.find((entry) => entry.ref === "r-quiet")?.rule, "requested")
})

test("operation type narrows the rules: assess_return expands only what it is pointed at", () => {
  const ir = { t: task(item("r-1", "Rule one.")) }
  const compiled = { t: plan(atom("a-1", "Implement one."), atom("a-2", "Implement two.")) }
  const view = selectView({
    operation: "assess_return", targets: ["a-2"], ir, compiled,
    atom_states: [state("a-1", 0, "executing")], recently_changed: ["r-1"],
  })
  assert.deepEqual(view.expanded.map((entry) => entry.ref), ["a-2"])
  assert.equal(view.manifest[0]!.atoms.length, 2)
})

test("the expanded budget caps one view and records what it truncated", () => {
  const items = Array.from({ length: 60 }, (_, index) => item(`r-${index}`, `Rule ${index}. ${"y".repeat(1000)}`))
  const view = selectView({
    operation: "update_ir",
    turn: { event_id: "turn-9", text: items.map((entry) => entry.item_id).join(" ") },
    ir: { t: task(...items) }, compiled: {},
  })
  assert.ok(view.bytes.expanded <= VIEW_LIMITS.expandedBytes)
  assert.ok(view.truncated.length > 0)
  assert.equal(view.truncated[0]!.reason, "over-budget")
  const manifestItems = new Set(view.manifest[0]!.items.map((entry) => entry.item_id))
  for (const entry of view.truncated) assert.ok(manifestItems.has(entry.ref), "a truncated object is still visible")
})

test("view size does not grow with the number of untouched objects", () => {
  const small = { t: task(item("r-1", "Rule.")) }
  const large = { t: task(...Array.from({ length: 200 }, (_, index) => item(`r-${index}`, `Rule ${index} body.`))) }
  const measure = (ir: Record<string, TaskIntent>) => selectView({ operation: "update_ir", turn: { event_id: "turn-1", text: "Only r-0." }, ir, compiled: {} })
  const smallView = measure(small)
  const largeView = measure(large)
  assert.equal(smallView.expanded.length, 0)
  assert.equal(largeView.expanded.length, 1)
  assert.ok(largeView.bytes.expanded <= VIEW_LIMITS.expandedBytes)
  assert.ok(largeView.bytes.total - largeView.bytes.manifest <= smallView.bytes.total - smallView.bytes.manifest + VIEW_LIMITS.manifestSummary,
    "only the manifest grows, one line per object")
})

test("need resolution honours ranges, item and atom refs, and reports what it cannot serve", () => {
  const index = {
    items: new Map([["r-1@0", "0123456789"]]),
    atoms: new Map([["a-1@0", atomExpansion(atom("a-1", "Implement."))]]),
    turns: new Map([["7", "Earlier turn text."]]),
    artifacts: new Map([["a3", { path: "/app/out.csv", digest: "sha256:aa" }]]),
  }
  const resolved = resolveNeeds([
    { ref: "r-1@0" }, { ref: "item:r-1@0@2-6" }, { ref: "turn:7" }, { ref: "artifact:a3" }, { ref: "r-missing@0" },
  ], index)
  assert.deepEqual(resolved.retrieved.map((entry) => entry.ref), ["r-1@0", "item:r-1@0@2-6", "turn:7", "artifact:a3"])
  assert.equal(resolved.retrieved[1]!.text, "2345")
  assert.match(resolved.retrieved[3]!.text, /\/app\/out\.csv/)
  assert.deepEqual(resolved.unresolved, [{ ref: "r-missing@0", reason: "unknown-ref" }])
})

test("need resolution enforces its own caps instead of growing the request", () => {
  const big = "z".repeat(10_000)
  const index = {
    items: new Map([["r-big@0", big], ["r-2@0", "small"]]),
    atoms: new Map(), turns: new Map(), artifacts: new Map(),
  }
  const tight = { ...VIEW_LIMITS, retrievalItemBytes: 10_000, retrievalBytes: 10_000 }
  const resolved = resolveNeeds([
    { ref: "r-big@0" },
    ...Array.from({ length: 9 }, () => ({ ref: "r-2@0" })),
  ], index, tight)
  assert.equal(resolved.retrieved.length, 1)
  assert.equal(resolved.retrieved[0]!.text.length, 10_000)
  assert.equal(resolved.unresolved.length, 9)
  assert.ok(resolved.unresolved.every((entry) => entry.reason === "over-budget"))
  const capped = resolveNeeds([{ ref: "r-big@0" }], index)
  assert.equal(capped.retrieved[0]!.truncated, true)
  assert.ok(capped.retrieved[0]!.bytes <= VIEW_LIMITS.retrievalItemBytes)
})
