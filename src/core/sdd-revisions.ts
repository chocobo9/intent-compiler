import type { TaskIntent } from "./intent-contract.js"
import type { AcceptanceSubject, DeliveryContract, ExecutableExample, FieldObject, ItemRevisions, LedgerEntry, RevisionEntry, SettledChange, SddSnapshot } from "./sdd-contract.js"
import { currentRevisions } from "./sdd-increment.js"
import { factsOf, holdsValue, normValue } from "./sdd-quotes.js"

/**
 * The revision ledger for this delivery, by code from what the store records:
 * the previous delivery's entries, this update's revised changes as new open
 * entries, and each older open entry closed when a later input replaces it
 * (all its subjects and a value it set) or withdraws its items, or when code
 * confirms the returned code meets it.
 */
export function ledgerRevisions(previous: RevisionEntry[] | undefined, settled: SettledChange[], s: SddSnapshot, current: Record<string, TaskIntent>, eventId: string, input: number): RevisionEntry[] {
  const now = currentRevisions(current)
  const fresh: RevisionEntry[] = settled.filter(c => c.kind === "revised").map((c, k) => ({ ...c, id: `${eventId}#${k + 1}`, event_id: eventId, input,
    revisions: Object.fromEntries(c.items.filter(id => now.has(id)).map(id => [id, now.get(id)!])), state: "open" as const }))
  const out = (previous ?? []).filter(r => r.event_id !== eventId).map(r => structuredClone(r))
  for (const r of out) {
    if (r.state !== "open") continue
    if (Object.keys(r.revisions).length && Object.keys(r.revisions).every(id => !now.has(id))) { r.state = "superseded"; r.closed = { event_id: eventId, reason: "its items are withdrawn" }; continue }
    const by = fresh.find(f => r.subjects.length > 0 && r.subjects.every(x => f.subjects.some(y => normValue(y) === normValue(x)))
      && f.old_values.some(v => r.new_values.some(w => normValue(v) === normValue(w))))
    if (by) { r.state = "superseded"; r.closed = { event_id: eventId, reason: `replaced by ${by.id} (${by.subject})` }; continue }
    const confirmed = confirmation(r, s)
    if (confirmed) { r.state = "confirmed"; r.closed = { event_id: eventId, reason: confirmed } }
  }
  return [...out, ...fresh]
}

/**
 * Code's confirmation: the latest run whose code counts returned results for
 * executable examples written for this revision's items at or after it, at
 * least one, and every one passed. Undefined otherwise.
 */
function confirmation(r: RevisionEntry, s: SddSnapshot): string | undefined {
  const run = s.runs.filter(x => x.result && !x.superseded && !x.voided).at(-1)
  if (!run) return undefined
  const delivery = s.batches.find(b => b.delivery?.ref.id === run.ci_ref.id)?.delivery
  // Written for its items at or after it; where it states new values, only examples stating one exercise the change.
  const examples = (delivery?.contract.executable ?? []).filter(e => Object.entries(r.revisions).some(([id, rev]) => (e.revisions[id] ?? -1) >= rev)
    && (!r.new_values.length || r.new_values.some(v => holdsValue(exampleText(e), v))))
  if (!examples.length) return undefined
  const results = new Map((run.result!.example_results ?? []).map(x => [x.id, x.passed]))
  if (!examples.every(e => results.get(e.id) === true)) return undefined
  return `all ${examples.length} executable example(s) written for its items passed on the code of ${run.run_id}`
}

/** The open revision a piece of an entry breaks: the entry names one of its subjects and the piece holds a value it replaced, unless the piece quotes that update or a later one. */
export function hitBy(revisions: readonly RevisionEntry[], facts: readonly string[], piece: string, quotedInput = -1): RevisionEntry | undefined {
  return revisions.find(r => r.state === "open" && r.subjects.some(x => facts.includes(normValue(x))) && r.old_values.some(v => holdsValue(piece, v)) && quotedInput < r.input)
}

const fieldText = (o: FieldObject) => [o.object, ...o.fields.map(f => `${f.field} ${f.type} ${f.meaning}`)].join("\n")
const subjectText = (a: AcceptanceSubject) => [a.subject, ...a.examples.flatMap(e => [e.given, e.expect])].join("\n")
export const exampleText = (e: ExecutableExample) => [e.subject, e.given, e.expect, ...(e.run?.args ?? []), ...(e.run?.files ?? []).flatMap(f => [f.path, f.content])].join("\n")

type Fields = DeliveryContract["fields"]
type Subjects = DeliveryContract["acceptance"]
type Executable = NonNullable<DeliveryContract["executable"]>

/**
 * Every entry with its facts, minus what an open revision replaced: a field row
 * holding a replaced value, an example quoting it from an update before the
 * revision, an executable example stating it anywhere. An entry left empty is
 * dropped. Items of carried entries that lost something are written again.
 */
export function purge(revisions: readonly RevisionEntry[], fields: Fields, acceptance: Subjects, executable: Executable = []): { fields: Fields; acceptance: Subjects; executable: Executable; dropped: DeliveryContract["dropped"]; rewrite: string[] } {
  const dropped: DeliveryContract["dropped"] = [], rewrite = new Set<string>()
  const lost = (carried: boolean, items: string[]) => { if (carried) items.forEach(id => rewrite.add(id)) }
  const keptFields = fields.flatMap(o => {
    const facts = factsOf(fieldText(o))
    const rows = o.fields.filter(f => {
      const r = hitBy(revisions, facts, `${f.field} ${f.type} ${f.meaning}`)
      if (r) dropped.push({ kind: "field", name: `${o.object}: ${f.field}`, reason: `states ${r.old_values.join(", ")}, which ${r.id} replaced` })
      return !r
    })
    if (rows.length < o.fields.length) lost(o.carried, o.items)
    // An object that never had a field is code's to leave out and record later; one emptied here is dropped.
    return rows.length || !o.fields.length ? [{ ...o, fields: rows, facts }] : []
  })
  const keptSubjects = acceptance.flatMap(a => {
    const facts = factsOf(subjectText(a))
    const examples = a.examples.filter(e => {
      const quotes = [...(e.given_quotes ?? []), ...(e.expect_quotes ?? [])]
      const r = quotes.length ? quotes.map(q => hitBy(revisions, facts, q.text, q.input)).find(Boolean) : hitBy(revisions, facts, `${e.given}\n${e.expect}`)
      if (r) dropped.push({ kind: "acceptance", name: a.subject, reason: `an example quotes ${r.old_values.join(", ")} from before ${r.id}` })
      return !r
    })
    if (examples.length < a.examples.length) lost(a.carried, a.items)
    return examples.length ? [{ ...a, examples, facts }] : []
  })
  const keptExecutable = executable.flatMap(e => {
    const facts = factsOf(exampleText(e))
    const r = hitBy(revisions, facts, exampleText(e))
    if (r) { dropped.push({ kind: "executable", name: e.id, reason: `states ${r.old_values.join(", ")}, which ${r.id} replaced` }); lost(e.carried, e.items); return [] }
    return [{ ...e, facts }]
  })
  return { fields: keptFields, acceptance: keptSubjects, executable: keptExecutable, dropped, rewrite: [...rewrite] }
}

/** M7: an example entry's facts still hold when no open revision replaced a value it states. */
export function markFactsValid(entries: LedgerEntry[], revisions: readonly RevisionEntry[]): LedgerEntry[] {
  return entries.map(e => {
    if (e.kind !== "example" || !e.example) return e
    const text = `${e.subject}\n${e.example.given}\n${e.example.expect}\n${(e.example.run?.args ?? []).join(" ")}\n${(e.example.run?.files ?? []).map(f => f.content).join("\n")}`
    return { ...e, facts_valid: e.state !== "removed" && !hitBy(revisions, factsOf(text), text) }
  })
}

export type { ItemRevisions }
