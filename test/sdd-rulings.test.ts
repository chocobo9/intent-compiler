import { test } from "node:test"
import assert from "node:assert/strict"
import { answerRevisions, carryRulings, rulingQuestions, rulingSection, settleRulings } from "../src/core/sdd-rulings.js"
import { mergeFieldEdits } from "../src/core/sdd-compiler.js"
import { planCarry } from "../src/core/sdd-increment.js"
import { splitIrExtension, SDD_IR_EXTENSION } from "../src/model/sdd-model.js"
import type { DeliveryContract, RevisionEntry, RulingEntry } from "../src/core/sdd-contract.js"

// v7 R10: R1's manifest sample writes the checksum key as "sha256"; R10 says "The `blake2b` JSON field is replaced".
const at = (source_id: string, segment_id: string, input: number, text: string, start: number) =>
  [`${source_id}|${segment_id}`, { source_id, segment_id, input, text, start, end: start + text.length }] as const
const index = new Map([
  at("r1", "s40", 1, 'Writes a manifest; each entry: {"path": "a.csv", "sha256": "abcdef...", "rows": 42, "size_bytes": 1234}', 0),
  at("r5", "s3", 5, "The `manifest` command must also produce BLAKE2b-256 checksums (not SHA256).", 0),
  at("r10", "s2", 10, "The `blake2b` JSON field is replaced with two new fields: `checksum` and `algorithm`.", 0),
  at("r10", "s5", 10, '{"path": "file.csv", "size_bytes": 100, "blake2b": "abc123..."}', 100),
])
const ir = (revision: number) => ({ t: { task_id: "t", content: [{ item_id: "r-manifest", revision, text: "manifest" }, { item_id: "r-verify", revision: 0, text: "verify" }] } }) as never
const ruling = (over: Partial<RulingEntry> = {}): RulingEntry => ({ kind: "identity", subject: "manifest checksum key", item_ids: ["r-manifest"],
  passages: [{ source_id: "r1", segment_id: "s40" }, { source_id: "r10", segment_id: "s2" }], holds: "the R1 sha256 key becomes checksum + algorithm; path, rows, size_bytes stay",
  basis: "a later update governs the part it changes", values: [{ said: "blake2b", written: "sha256" }], question: "", replaces: "", ...over })
const revision = (over: Partial<RevisionEntry> = {}): RevisionEntry => ({ id: "r5-user-input#4", event_id: "r5-user-input", input: 5, kind: "revised", subject: "manifest digest algorithm",
  items: ["r-manifest"], subjects: ["manifest"], before: [], now: [{ source_id: "r5", segment_id: "s3", input: 5, text: "The `manifest` command must also produce BLAKE2b-256 checksums (not SHA256)." }],
  old_values: [], new_values: ["BLAKE2b-256"], parameters: [], wording: "must also produce BLAKE2b-256 checksums (not SHA256)", revisions: { "r-manifest": 1 }, state: "open", missing: ["before", "old_values"], ...over })

test("an identity ruling is settled with its passages quoted and each name where it says", () => {
  const { rulings } = settleRulings([ruling()], [], { eventId: "r10", index, ir: ir(2), questions: [], current: [] })
  assert.equal(rulings.length, 1)
  assert.deepEqual([rulings[0]!.id, rulings[0]!.kind, rulings[0]!.quotes.map(q => q.input), rulings[0]!.values], ["r10#R1", "identity", [1, 10], [{ said: "blake2b", written: "sha256" }]])
  const text = rulingSection(rulings)
  assert.match(text, /^# Management rulings on the original requirements/u)
  assert.ok(text.includes("`blake2b` in the later update is what earlier passages write as `sha256`") && text.includes("- Holds now: the R1 sha256 key") && text.includes("(user update 1)\n> Writes a manifest"))
})

test("a ruling on no current item, with too few passages or a wrong question is rejected; names its passages do not write are recorded", () => {
  const settle = (r: RulingEntry, questions = [] as ReturnType<typeof rulingQuestions>) => settleRulings([r], [], { eventId: "r10", index, ir: ir(2), questions, current: [] })
  // A′: a said or written value not found as written is recorded on the ruling, not rejected.
  assert.deepEqual(settle(ruling({ values: [{ said: "blake2b", written: "md5" }] })).rulings[0]!.unverified, ['written "md5" is not written in a passage of an update before the one that says "blake2b"'])
  assert.deepEqual(settle(ruling({ values: [{ said: "sha256", written: "blake2b" }] })).rulings[0]!.unverified, ['written "blake2b" is not written in a passage of an update before the one that says "sha256"'])
  assert.equal(settle(ruling()).rulings[0]!.unverified, undefined)
  assert.throws(() => settle(ruling({ item_ids: ["r-gone"] })), /not current: r-gone/u)
  assert.throws(() => settle(ruling({ passages: [{ source_id: "r10", segment_id: "s2" }] })), /at least two passages/u)
  assert.throws(() => settle(ruling({ kind: "unstated", values: [{ said: "SHA256", written: "SHA-256" }] })), /give said only, written empty/u)
  assert.throws(() => settle(ruling({ question: "nope" })), /question nope is not one this request asked/u)
})

test("every ruling question is answered: an open revision without old values gets them from an identity, or is ruled unstated", () => {
  const open = [revision(), revision({ id: "r3#1", subject: "fill", items: ["r-verify"], missing: ["old_values"] }), revision({ id: "r5#9", state: "confirmed" }), revision({ id: "r5#8", old_values: ["SHA256"], missing: undefined })]
  const questions = rulingQuestions(open, ir(2))
  assert.deepEqual(questions.map(q => q.question), ["r5-user-input#4", "r3#1"])
  const context = { eventId: "r10", index, ir: ir(2), questions, current: [] }
  assert.throws(() => settleRulings([], [], context), /ruling questions not answered: r5-user-input#4 \("manifest digest algorithm"\), r3#1/u)
  const answers = [ruling({ subject: "manifest digest", passages: [{ source_id: "r1", segment_id: "s40" }, { source_id: "r5", segment_id: "s3" }], values: [{ said: "SHA256", written: "sha256" }], question: "r5-user-input#4" }),
    ruling({ kind: "unstated", subject: "fill one anchor", item_ids: ["r-verify"], passages: [{ source_id: "r10", segment_id: "s2" }], values: [{ said: "one anchor", written: "" }], question: "r3#1" })]
  const { rulings } = settleRulings(answers, [], context)
  const answered = answerRevisions(open, rulings)
  assert.deepEqual([answered[0]!.old_values, answered[0]!.ruled, answered[0]!.missing, answered[0]!.before.map(q => q.source_id)], [["sha256"], { ruling: "r10#R1", stated: true }, undefined, ["r1"]])
  assert.deepEqual([answered[1]!.old_values, answered[1]!.ruled, answered[1]!.missing], [[], { ruling: "r10#R2", stated: false }, undefined])
  // A question answered once is not asked again.
  assert.deepEqual(rulingQuestions(answered, ir(2)).map(q => q.question), [])
})

test("a ruling is kept across rounds, through revisions of its items, until replaced, withdrawn or its items are gone", () => {
  const { rulings } = settleRulings([ruling()], [], { eventId: "r10", index, ir: ir(2), questions: [], current: [] })
  const first = carryRulings([], rulings, [], ir(2), [])
  assert.deepEqual(first.map(r => [r.id, r.carried, r.revisions]), [["r10#R1", false, { "r-manifest": 2 }]])
  const dropped: DeliveryContract["dropped"] = []
  assert.deepEqual(carryRulings(first, [], [], ir(3), dropped).map(r => [r.id, r.carried, r.revisions]), [["r10#R1", true, { "r-manifest": 3 }]], "an item revised later keeps the ruling")
  const replacing = settleRulings([ruling({ replaces: "r10#R1", holds: "x" })], [], { eventId: "r11", index, ir: ir(3), questions: [], current: first }).rulings
  assert.deepEqual(carryRulings(first, replacing, [], ir(3), dropped).map(r => r.id), ["r11#R1"])
  assert.deepEqual(carryRulings(first, [], [{ id: "r10#R1", reason: "no longer applies" }], ir(3), dropped), [])
  assert.deepEqual(carryRulings(first, [], [], { t: { task_id: "t", content: [] } } as never, dropped), [])
  assert.deepEqual(dropped.map(d => d.reason), ["replaced by r11#R1", "withdrawn by this update's IR: no longer applies", "every item it rules on is withdrawn"])
  assert.throws(() => settleRulings([], [{ ruling_id: "r9#R1", reason: "x" }], { eventId: "r11", index, ir: ir(3), questions: [], current: first }), /withdraw_rulings names r9#R1/u)
})

test("a field object whose items changed is given to the CI as the base of an edit; rows the edit does not touch stay", () => {
  const manifest = { object: "manifest JSON output", items: ["r-manifest"], revisions: { "r-manifest": 1 }, carried: false,
    fields: ["path", "sha256", "rows", "size_bytes"].map(field => ({ field, type: "string", required: "not stated", meaning: field })) }
  const previous = { fields: [manifest], acceptance: [], effective: [], dropped: [] } as DeliveryContract
  const plan = planCarry(previous, ir(1), ir(2))
  assert.deepEqual([plan.fields, plan.revisedFields.map(o => o.object), plan.toWrite.includes("r-manifest")], [[], ["manifest JSON output"], true])
  const dropped: DeliveryContract["dropped"] = []
  const edit = { object: "manifest JSON output", items: ["r-manifest"], revises: "manifest JSON output", removed: ["sha256"],
    fields: [{ field: "checksum", type: "string", required: "not stated", meaning: "hex digest" }, { field: "algorithm", type: "string", required: "not stated", meaning: "blake2b-256" }] }
  const merged = mergeFieldEdits([edit], plan.revisedFields, dropped)
  assert.deepEqual(merged.fields[0]!.fields.map(f => f.field), ["path", "rows", "size_bytes", "checksum", "algorithm"])
  assert.deepEqual([...merged.base], ["manifest JSON output|path", "manifest JSON output|rows", "manifest JSON output|size_bytes"])
  assert.deepEqual(merged.written[0]!.fields.map(f => f.field), ["checksum", "algorithm"])
  // An object no entry edits stands as it was; an edit naming an object not offered is rejected.
  assert.deepEqual(mergeFieldEdits([], plan.revisedFields, dropped).fields[0]!.fields.map(f => f.field), ["path", "sha256", "rows", "size_bytes"])
  assert.throws(() => mergeFieldEdits([{ ...edit, revises: "manifest" }], plan.revisedFields, dropped), /revises names one of "manifest JSON output"/u)
})

test("the IR answer's rulings are split from the text the generic IR validation reads, and the schema offers them", async () => {
  const answer = { schema_version: 2, basis: { event_ids: ["e"], refs: [] }, source_coverage: [], groups: [], rulings: [ruling()], withdraw_rulings: [] }
  const transport = splitIrExtension(async () => ({ text: JSON.stringify(answer) }), Object.keys(SDD_IR_EXTENSION.properties))
  const call = await transport({ generation_stage: "ir" } as never)
  assert.deepEqual(Object.keys(JSON.parse(call.text)), ["schema_version", "basis", "source_coverage", "groups"])
  assert.deepEqual((call.ir_extension as { rulings: unknown[] }).rulings.length, 1)
  assert.equal(call.text_returned, JSON.stringify(answer))
  const ci = await transport({ generation_stage: "ci" } as never)
  assert.equal(ci.ir_extension, undefined)
})

test("the delivered text shows only rulings written this round on an item this update changed, not answers about earlier revisions", async () => {
  const { deliveredRulings } = await import("../src/core/sdd-compiler.js")
  const r = (id: string, items: string[], over = {}) => ({ id, kind: "identity" as const, subject: id, items, quotes: [], ruling: "h", basis: "b", revisions: {}, carried: false, ...over })
  const rulings = [r("new-manifest", ["r-manifest"]), r("old-revision", ["r-manifest"], { question: "r5-user-input#4" }), r("carried", ["r-manifest"], { carried: true }), r("untouched", ["r-transform"])]
  const shown = deliveredRulings(rulings, new Map([["r-manifest", {}]]), [{ id: "r5-user-input#4" }])
  assert.deepEqual(shown.map(x => x.id), ["new-manifest"])
})
