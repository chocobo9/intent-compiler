import { test } from "node:test"
import assert from "node:assert/strict"
import { blocks, cutMasks, groupedSection, groupOriginals } from "../src/core/sdd-grouped.js"
import { changeNames, checkUnit, earlierChanges } from "../src/core/sdd-landing.js"
import type { CompilerEvent, ContentItem, TaskIntent } from "../src/core/intent-contract.js"

const event = (n: number, text: string): CompilerEvent => ({ schema_version: 2, run_id: "run", event_id: `r${n}`, kind: "user_input", source: { channel: "user", producer_id: "t" }, payload: { text } })
const span = (source_id: string, text: string, part: string) => { const start = text.indexOf(part); assert.ok(start >= 0, part); return { source_id, digest: "d", span: { unit: "utf16" as const, start, end: start + part.length } } }
const item = (item_id: string, sources: ReturnType<typeof span>[]): ContentItem => ({ item_id, revision: 0, text: item_id, sources } as unknown as ContentItem)
const ir = (items: ContentItem[]): Record<string, TaskIntent> => ({ t: { task_id: "t", content: items } as unknown as TaskIntent })

const r1 = "Build `tool`.\n\n## Command: `fold`\n\nFolds rows.\n\n```json\n{\"op\": \"fold\",\n\n \"by\": \"k\"}\n```\n\n## Command: `scan`\n\nScans with `fold` output.\n"
const r2 = "Add the following.\n\n## Behavior change\n\nFold now keeps empty rows.\n\nThis change affects `fold`.\n\n## Command: `peek`\n\nPeeks.\n"
const events = [event(1, r1), event(2, r2)]
const fold = item("r-fold", [span("r1", r1, "## Command: `fold`\n\nFolds rows.\n\n```json\n{\"op\": \"fold\",\n\n \"by\": \"k\"}\n```"), span("r2", r2, "Fold now keeps empty rows.")])
const scan = item("r-scan", [span("r1", r1, "## Command: `scan`\n\nScans with `fold` output.")])
const peek = item("r-peek", [span("r2", r2, "## Command: `peek`\n\nPeeks.")])

test("v8: every current paragraph once, grouped by the item that selects it; fences stay whole; section text and headings go with their group", () => {
  const current = ir([fold, scan, peek])
  const masks = cutMasks(events, [], current, [fold, scan, peek])
  const kept = blocks(events, masks)
  assert.ok(kept.some(b => b.text.includes("{\"op\": \"fold\",\n\n \"by\": \"k\"}")), "a fence split by a blank line is one paragraph")
  const result = groupOriginals(events, masks, current, [fold, scan, peek], [])
  assert.deepEqual(result.groups.map(g => [g.number, g.items[0], g.label]), [[1, "r-fold", "user updates 1, 2"], [2, "r-scan", "user update 1"], [3, "r-peek", "user update 2"]])
  // The heading-only paragraph "## Behavior change" and the unselected "This change affects" go with fold's update-2 passage.
  assert.ok(result.groups[0]!.blocks.some(b => b.text.startsWith("## Behavior change")))
  assert.ok(result.groups[0]!.blocks.some(b => b.text.startsWith("This change affects")))
  assert.deepEqual(result.outside.map(b => b.text.trim()), ["Build `tool`.", "Add the following."])
  // scan writes `fold`, which group 1 defines in its heading: a pointer, not a copy.
  assert.deepEqual(result.groups[1]!.see_also, [{ group: 1, names: ["fold"] }])
  const text = groupedSection(result)
  for (const b of kept) assert.equal(text.split(b.text.replace(/\s+$/u, "")).length - 1, 1, b.text)
  assert.match(text, /## Group 1 \(user updates 1, 2\)\n\n\[from user update 1\]\n\n## Command: `fold`[\s\S]*\[from user update 2\]\n\n## Behavior change/u)
  assert.match(text, /See also: group 1 \(`fold`\)/u)
})

test("v8: text an earlier IR selected and this delivery does not deliver is cut from the grouped text", () => {
  const current = ir([fold, scan])
  const masks = cutMasks(events, [ir([fold, scan, peek])], current, [fold, scan])
  const text = groupedSection(groupOriginals(events, masks, current, [fold, scan], []))
  assert.ok(!text.includes("Peeks."))
  assert.ok(text.includes("Scans with"))
})

const change = (kind: "added" | "revised", subject: string, subjects: string[], new_values: string[] = []) =>
  ({ kind, subject, items: [], subjects, before: [], now: [], old_values: [], new_values, parameters: [] })
const store = (stages: Record<string, string>, changes: ReturnType<typeof change>[]) => ({
  events: [1, 2, 3].map(n => ({ event_id: `r${n}`, kind: "user_input" })),
  batches: [{ event_id: "r1", state: "accepted", delivery: {} }, { event_id: "r2", state: "accepted", delivery: { changes } }, { event_id: "r3", state: "ci" }],
  runs: [{ run_id: "a", event_id: "r1", result: { stages: { coding: "pass" } } }, { run_id: "b", event_id: "r2", result: { stages } }],
})

test("v8 zoning: an earlier change is put back as not landed only when SDD never coded it and no check covers it", () => {
  assert.equal(checkUnit("unit:type:schema"), "schema"); assert.equal(checkUnit("probe:schema:missing-file"), "schema"); assert.equal(checkUnit("p1:mask"), "mask")
  assert.ok(changeNames(change("added", "Reconcile pipeline step", ["pipeline"])).has("reconcile"))
  const changes = [change("added", "mask transform operation", ["mask"]), change("added", "step order", ["pipeline"]), change("revised", "Manifest checksum field", ["manifest"], ["checksum"])]
  const stopped = store({ coding: "not_reached" }, changes) as never
  const b = (observations: unknown) => ({ event_id: "r3", state: "ci", observations }) as never
  const observed = [{ run_id: "a", entered_coding: true, fixed_units: [], passed_units: [] }, { run_id: "b", entered_coding: false, fixed_units: ["mask"], passed_units: ["manifest", "pipeline"] }]
  const states = (s: never, o: unknown) => earlierChanges({ ...(s as object), batches: [...(s as { batches: unknown[] }).batches.slice(0, 2), b(o)] } as never, b(o)).map(x => [x.change.subject, x.state])
  // mask: fixed by the repair (it exists); step order: a passing check names pipeline; the manifest revision: a passing
  // run of the command does not show a renamed field, so with no structure check carrying `checksum` it is not landed.
  assert.deepEqual(states(stopped, observed), [["mask transform operation", "unknown"], ["step order", "unknown"], ["Manifest checksum field", "not_landed"]])
  const structure = [observed[0], { ...observed[1], passed_structures: [{ name: "manifest", output_keys: ["path", "checksum"] }] }]
  assert.equal(states(stopped, structure)[2]![1], "unknown", "an output structure check carrying the new key covers the revision")
  // SDD coded the round: nothing is evidence.
  assert.deepEqual(states(store({ coding: "pass" }, changes) as never, observed).map(x => x[1]), ["unknown", "unknown", "unknown"])
  // No observation of that run: unknown.
  assert.deepEqual(states(stopped, [observed[0]]).map(x => x[1]), ["unknown", "unknown", "unknown"])
})
