import { test } from "node:test"
import assert from "node:assert/strict"
import type { CompilerEvent } from "../src/core/intent-contract.js"
import type { RevisionEntry, SettledChange } from "../src/core/sdd-contract.js"
import { ledgerRevisions, purge, markFactsValid } from "../src/core/sdd-revisions.js"
import { accumulatedText, prdBaseline } from "../src/core/sdd-compiler.js"
import { originalInputs } from "../src/core/sdd-executable.js"
import { factsOf } from "../src/core/sdd-quotes.js"

const ev = (id: string, text: string) => ({ schema_version: 2, run_id: "r", event_id: id, kind: "user_input", source: { channel: "user", producer_id: "t" }, payload: { text } }) as CompilerEvent
const quote = (input: number, text: string) => ({ source_id: `r${input}`, segment_id: "s1", input, text })
const change = (over: Partial<SettledChange> = {}): SettledChange => ({ kind: "revised", subject: "verify digest", items: ["r-verify"], subjects: ["verify"], before: [quote(1, "verify computes SHA-256")],
  now: [quote(5, "verify now uses BLAKE2b-256 (previously SHA256)")], old_values: ["SHA256"], new_values: ["BLAKE2b-256"], parameters: [], ...over })
const ir = (items: Record<string, number>) => ({ t: { task_id: "t", content: Object.entries(items).map(([item_id, revision]) => ({ item_id, revision, text: item_id })) } }) as never

test("a revision opens, is carried, and closes when every example written for its items passes on returned code", () => {
  const empty = { runs: [], batches: [] } as never
  const opened = ledgerRevisions(undefined, [change()], empty, ir({ "r-verify": 1 }), "r5-user-input", 5)
  assert.deepEqual(opened.map(r => [r.id, r.state, r.revisions]), [["r5-user-input#1", "open", { "r-verify": 1 }]])
  // R6: no example ran yet — still open, carried.
  assert.equal(ledgerRevisions(opened, [], empty, ir({ "r-verify": 1 }), "r6-user-input", 6)[0]!.state, "open")
  const example = (id: string, revision: number, expect = "VERIFIED with a BLAKE2b-256 checksum") => ({ id, subject: "verify", items: ["r-verify"], revisions: { "r-verify": revision }, tier: "verbatim", given: "", expect, carried: false })
  // An example for its items that does not state the new value does not exercise the change.
  const unrelated = { batches: [{ delivery: { ref: { id: "c5" }, contract: { executable: [example("r5:2", 1, "ERROR: file not found")] } } }],
    runs: [{ run_id: "run5", event_id: "r5-user-input", ci_ref: { id: "c5" }, result: { example_results: [{ id: "r5:2", passed: true, failures: [] }] } }] } as never
  assert.equal(ledgerRevisions(opened, [], unrelated, ir({ "r-verify": 1 }), "r6-user-input", 6)[0]!.state, "open")
  const store = (passed: boolean) => ({ batches: [{ delivery: { ref: { id: "c5" }, contract: { executable: [example("r5:1", 1), example("r1:3", 0)] } } }],
    runs: [{ run_id: "run5", event_id: "r5-user-input", ci_ref: { id: "c5" }, result: { example_results: [{ id: "r5:1", passed, failures: [] }, { id: "r1:3", passed: false, failures: [] }] } }] }) as never
  assert.equal(ledgerRevisions(opened, [], store(false), ir({ "r-verify": 1 }), "r6-user-input", 6)[0]!.state, "open")
  const closed = ledgerRevisions(opened, [], store(true), ir({ "r-verify": 1 }), "r6-user-input", 6)[0]!
  assert.equal(closed.state, "confirmed"); assert.match(closed.closed!.reason, /1 executable example/u)
})

test("a later revision of the same subjects replacing a value it set supersedes it; withdrawn items close it too", () => {
  const empty = { runs: [], batches: [] } as never
  const r5 = ledgerRevisions(undefined, [change({ subjects: ["manifest"], new_values: ["blake2b"] })], empty, ir({ "r-m": 0 }), "r5-user-input", 5).map(r => ({ ...r, items: ["r-m"], revisions: { "r-m": 0 } }))
  const r10 = ledgerRevisions(r5, [change({ subjects: ["manifest"], old_values: ["blake2b"], new_values: ["checksum"], items: ["r-m"] })], empty, ir({ "r-m": 1 }), "r10-user-input", 10)
  assert.deepEqual(r10.map(r => [r.id, r.state]), [["r5-user-input#1", "superseded"], ["r10-user-input#1", "open"]])
  assert.equal(ledgerRevisions(r5, [], empty, ir({ other: 0 }), "r6-user-input", 6)[0]!.state, "superseded")
})

test("an open revision drops field rows, quoted examples and executable examples that state a value it replaced", () => {
  const open = [{ ...change(), id: "r5#1", event_id: "r5", input: 5, revisions: {}, state: "open" }] as RevisionEntry[]
  const fields = [{ object: "verify command", items: ["r-verify"], revisions: {}, carried: true, fields: [
    { field: "--file", type: "path", required: "yes", meaning: "File whose SHA-256 is computed" }, { field: "--checksum", type: "path", required: "yes", meaning: "Checksum file" }] },
    { object: "snapshot", items: ["r-snap"], revisions: {}, carried: true, fields: [{ field: "row_hash", type: "string", required: "yes", meaning: "SHA-256 of the row" }] }]
  const acceptance = [{ subject: "verify", items: ["r-verify"], revisions: {}, carried: true, examples: [
    { given: "", expect: "", given_quotes: [quote(1, "`dpipe verify` computes the SHA-256")], expect_quotes: [] },
    { given: "", expect: "", given_quotes: [quote(5, "verify now uses BLAKE2b-256 instead of SHA256")], expect_quotes: [] }] }]
  const executable = [{ id: "r1:3", subject: "verify", items: ["r-verify"], revisions: {}, tier: "verbatim", given: "a SHA-256 checksum file", expect: "VERIFIED", carried: true, run: { args: ["verify"], files: [], stdin: null } }] as never
  const out = purge(open, fields as never, acceptance as never, executable)
  assert.deepEqual(out.fields.map(o => [o.object, o.fields.map(f => f.field)]), [["verify command", ["--checksum"]], ["snapshot", ["row_hash"]]], "another subject keeps its value")
  assert.equal(out.acceptance[0]!.examples.length, 1, "a quote from the revising update itself stays")
  assert.deepEqual(out.executable, [])
  assert.deepEqual(out.rewrite, ["r-verify"])
  assert.ok(out.fields[0]!.facts!.includes("verify"))
})

test("an example ledger entry records whether its facts still hold", () => {
  const open = [{ ...change(), id: "r5#1", event_id: "r5", input: 5, revisions: {}, state: "open" }] as RevisionEntry[]
  const entry = (given: string) => ({ id: "x", kind: "example", subject: "verify", items: [], revisions: {}, example: { given, expect: "VERIFIED" }, first_failed: "r1", last: { event_id: "r1", run_id: "run", passed: false, observed: "" }, state: "open" })
  assert.deepEqual(markFactsValid([entry("a SHA-256 file"), entry("a BLAKE2b-256 file")] as never, open).map(e => e.facts_valid), [false, true])
})

test("the PRD baseline is the latest counted run's PRD; a voided run's is skipped", () => {
  const prd = (text: string) => ({ path: "D:\\run\\output\\02-澄清后PRD.md", digest: "d", text })
  const s = { events: [ev("r1-user-input", "a"), ev("r2-user-input", "b"), ev("r3-user-input", "c")],
    runs: [{ run_id: "a", event_id: "r1-user-input", result: { artifacts: [prd("PRD 1")] } }, { run_id: "b", event_id: "r2-user-input", voided: { reason: "x" }, result: { artifacts: [prd("PRD 2")] } }] } as never
  assert.deepEqual(prdBaseline(s, "r3-user-input"), { run_id: "a", event_id: "r1-user-input", input: 1, text: "PRD 1", digest: "d" })
  assert.equal(prdBaseline({ events: [], runs: [] } as never, "r1-user-input"), undefined)
})

test("an incremental text delivers only the inputs after the baseline; cuts are the same as in the full text", () => {
  const events = [ev("r1", "One.\n\nTwo old."), ev("r2", "Three.")]
  const item = (id: string, source: string, start: number, end: number) => ({ item_id: id, revision: 0, text: "", sources: [{ source_id: source, span: { unit: "utf16", start, end } }] })
  const earlier = [{ t: { task_id: "t", content: [item("a", "r1", 0, 4), item("b", "r1", 6, 14)] } }] as never
  const current = { t: { task_id: "t", content: [item("a", "r1", 0, 4), item("c", "r2", 0, 6)] } } as never
  const delivered = [(current as { t: { content: unknown[] } }).t.content[0], (current as { t: { content: unknown[] } }).t.content[1]] as never
  const full = accumulatedText(events, earlier, current, delivered, new Map(), [])
  const part = accumulatedText(events, earlier, current, delivered, new Map(), [], 2)
  assert.ok(full.text.includes("## Original user update 1") && !full.text.includes("Two old."))
  assert.ok(!part.text.includes("## Original user update 1") && part.text.includes("## Original user update 2\n\nThree."))
  assert.deepEqual(part.removed, full.removed)
})

test("an example's inputs are the requirement's own only when each is written in the text or is one of its samples", () => {
  const text = "Recipe:\n```json\n{\"op\": \"clip\", \"min\": 0}\n```\nInput file:\n```\nname,age\nann,3\n```"
  assert.ok(originalInputs({ args: ["x"], files: [{ path: "r.json", content: "[{\"min\": 0, \"op\": \"clip\"}]" }, { path: "d.csv", content: "name,age\nann,3\n" }], stdin: null }, text))
  assert.ok(!originalInputs({ args: ["x"], files: [{ path: "d.csv", content: "name,age\nbob,abc\n" }], stdin: null }, text), "a made-up CSV")
  assert.ok(!originalInputs(null, text))
})

test("a value is held word by word, normalized, never as part of a longer word", async () => {
  const { holdsValue } = await import("../src/core/sdd-quotes.js")
  assert.ok(holdsValue("computes its SHA-256", "SHA256"))
  assert.ok(holdsValue("writes `<output>.sha256` too", ".sha256"))
  assert.ok(holdsValue("input = `dir` (treated as a single node)", "treated as a single node"))
  assert.ok(!holdsValue("the same BLAKE2b-256 computation", "blake2b"))
  assert.ok(holdsValue('{"path": "f", "blake2b": "abc"}', "blake2b"))
})

test("facts are normalized names and values a text states", () => {
  const facts = factsOf("`verify --file` computes SHA-256; \"row_hash\" is 32-character MD5")
  for (const f of ["verify", "file", "sha256", "rowhash", "32character", "md5"]) assert.ok(facts.includes(f), f)
})

test("findings IC records are tracked in the ledger and never fed back", async () => {
  const { computeLedger, fedBack } = await import("../src/core/sdd-ledger.js")
  const run = (id: string, recorded: string[]) => ({ run_id: id, event_id: `${id}-input`, ci_ref: { id: "c" }, result: { acceptance: { outcome: "adopted", checks: 3, open: [], recorded: recorded.map(r => ({ id: r, subject: `p3_regression: ${r}`, observed: "out.json differs" })) } } })
  const open = computeLedger({ batches: [], runs: [run("r1", ["p3:command:validate"])] } as never, {} as never)
  assert.deepEqual(open.map(e => [e.id, e.kind, e.state]), [["recorded:p3:command:validate", "recorded", "open"]])
  assert.deepEqual(fedBack(open), [])
  assert.equal(computeLedger({ batches: [], runs: [run("r1", ["p3:command:validate"]), run("r2", [])] } as never, {} as never)[0]!.state, "closed")
})
