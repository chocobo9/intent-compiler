import type { TaskIntent } from "./intent-contract.js"
import type { ChangeEntry, DeliveryContract, LedgerEntry, Quote, RevisionEntry, SettledChange } from "./sdd-contract.js"
import { itemOf } from "./sdd-executable.js"
import { currentRevisions } from "./sdd-increment.js"
import { holdsValue, normValue, refList, resolveQuotes, writtenIn, type segmentIndex } from "./sdd-quotes.js"

type Index = ReturnType<typeof segmentIndex>
/** Earlier passages code takes for a revision's before. */
export const BEFORE_LIMIT = 4
type Cut = Parameters<typeof resolveQuotes>[2]

/** The content items this update added or revised, delivered: id → whether an earlier accepted IR had the item, and its text. */
export function changedItems(previous: Record<string, TaskIntent>, current: Record<string, TaskIntent>, excluded: ReadonlySet<string>): Map<string, { existed: boolean; text: string }> {
  const before = currentRevisions(previous)
  const out = new Map<string, { existed: boolean; text: string }>()
  for (const c of Object.values(current).flatMap(t => t.content)) {
    if (excluded.has(c.item_id) || before.get(c.item_id) === c.revision) continue
    out.set(c.item_id, { existed: before.has(c.item_id), text: c.text })
  }
  return out
}

/** The heading an item's text gives itself (its first line, without markdown marks). */
function heading(text: string): string {
  const first = text.trim().split("\n").find(l => l.trim()) ?? ""
  return first.replace(/^#+\s*/u, "").replace(/`/gu, "").trim().slice(0, 120)
}

/** Segments of the given inputs that an item's passages overlap, in input order. */
function itemQuotes(ir: Record<string, TaskIntent>, itemId: string, inputs: (input: number) => boolean, index: Index, cut: Cut): Quote[] {
  const item = Object.values(ir).flatMap(t => t.content).find(c => c.item_id === itemId)
  const spans = (item?.sources ?? []).flatMap(x => x.span ? [{ source_id: x.source_id, ...x.span }] : [])
  const refs = [...index.values()].filter(q => inputs(q.input) && spans.some(x => x.source_id === q.source_id && x.start < q.end && q.start < x.end))
    .sort((a, b) => a.input - b.input || a.start - b.start)
  return resolveQuotes(refs, index, cut).quotes
}

/**
 * This round's change list as delivered. An entry keeps only items this update
 * added or revised (none left: dropped); its quotes are the cited segments, now
 * from this update and before from earlier ones (others left out); old and new
 * values stay only where the quotes write them, and subjects only where now
 * writes them as a word. Every changed item no entry covers gets an entry from
 * code quoting its passages. A revised entry rests on its wording: the update's
 * own words, written in its now quotes; one without them is rejected (the kind
 * is the model's judgment from those words, never code's from old and new names).
 */
export function settleChanges(entries: ChangeEntry[], changed: Map<string, { existed: boolean; text: string }>, context: {
  index: Index; cut: Cut; input: number; previous: Record<string, TaskIntent>; current: Record<string, TaskIntent> }): { changes: SettledChange[]; dropped: DeliveryContract["dropped"] } {
  const ids = new Map([...changed.keys()].map(id => [id, 0]))
  const changes: SettledChange[] = [], dropped: DeliveryContract["dropped"] = [], unworded: string[] = []
  for (const e of entries) {
    const items = [...new Set(e.items.map(id => itemOf(id, ids)).filter((id): id is string => id !== undefined))]
    if (!items.length) { dropped.push({ kind: "change", name: e.subject, reason: `names no item this update added or revised (${e.items.join(", ") || "none"})` }); continue }
    const now = resolveQuotes(e.now, context.index, context.cut), before = resolveQuotes(e.before, context.index, context.cut)
    const nowQuotes = now.quotes.filter(q => q.input === context.input), beforeQuotes = e.kind === "revised" ? before.quotes.filter(q => q.input < context.input) : []
    const notes = [...now.dropped, ...before.dropped,
      ...now.quotes.filter(q => q.input !== context.input).map(q => `now ${q.source_id}|${q.segment_id}: not from this update`),
      ...(e.kind === "revised" ? before.quotes.filter(q => q.input >= context.input).map(q => `before ${q.source_id}|${q.segment_id}: not from an earlier update`) : [])]
    const nowText = nowQuotes.map(q => q.text).join("\n"), beforeText = beforeQuotes.map(q => q.text).join("\n")
    // A value too short to name anything (a bare number, one letter) cannot be told apart from others: left out.
    const usable = (v: string) => normValue(v).length >= 3 && !/^\d+$/u.test(normValue(v))
    const oldValues = e.old_values.filter(v => usable(v) && holdsValue(beforeText, v)), newValues = e.new_values.filter(v => usable(v) && holdsValue(nowText, v))
    const words = new Set([...nowText.matchAll(/[A-Za-z_][A-Za-z0-9_-]*/gu)].map(m => normValue(m[0])))
    const subjects = e.subjects.filter(x => words.has(normValue(x)))
    notes.push(...e.old_values.filter(v => !oldValues.includes(v)).map(v => `old value ${JSON.stringify(v)} is not written in before`),
      ...e.new_values.filter(v => !newValues.includes(v)).map(v => `new value ${JSON.stringify(v)} is not written in now`),
      ...e.subjects.filter(x => !subjects.includes(x)).map(x => `subject ${JSON.stringify(x)} is not written in now`))
    if (!nowQuotes.length) nowQuotes.push(...items.flatMap(id => itemQuotes(context.current, id, n => n === context.input, context.index, context.cut)))
    const wording = e.wording?.trim() ?? ""
    if (e.kind === "revised") {
      if (!wording) { unworded.push(`${JSON.stringify(e.subject)}: kind revised gives no wording`); continue }
      if (!writtenIn(nowQuotes.map(q => q.text).join(" "), wording)) { unworded.push(`${JSON.stringify(e.subject)}: wording ${JSON.stringify(wording.slice(0, 160))} is not written in its now passages`); continue }
    }
    // M3 (v6): a revision whose answer cites no earlier passage gets it from code: the previous versions of its items,
    // only the passages that name its subjects (or the words of its title), at most BEFORE_LIMIT.
    let beforeByCode = false
    if (e.kind === "revised" && !beforeQuotes.length) {
      const names = (subjects.length ? subjects : [...e.subject.matchAll(/[A-Za-z_][A-Za-z0-9_-]{2,}/gu)].map(m => m[0])).map(normValue)
      const scored = items.flatMap(id => itemQuotes(context.previous, id, n => n < context.input, context.index, () => false))
        .map(q => ({ q, score: names.filter(n => holdsValue(q.text, n)).length })).filter(x => x.score > 0)
      const best = scored.sort((a, b) => b.score - a.score).slice(0, BEFORE_LIMIT).map(x => x.q).sort((a, b) => a.input - b.input || Number(a.segment_id.slice(1)) - Number(b.segment_id.slice(1)))
      beforeQuotes.push(...best)
      beforeByCode = best.length > 0
    }
    // What a revision still lacks is recorded, so it can be traced; no rule asks the model to fill it.
    const missing = e.kind !== "revised" ? [] : [...(beforeQuotes.length ? [] : ["before"]), ...(oldValues.length ? [] : ["old_values"]), ...(subjects.length ? [] : ["subjects"])]
    if (notes.length) dropped.push({ kind: "change", name: e.subject, reason: `kept with parts left out: ${notes.join("; ")}` })
    changes.push({ kind: e.kind, subject: e.subject, items, subjects, before: beforeQuotes, now: nowQuotes, old_values: oldValues, new_values: newValues, parameters: e.parameters,
      ...(e.kind === "revised" ? { wording } : {}), ...(beforeByCode ? { before_by_code: true } : {}), ...(missing.length ? { missing } : {}) })
  }
  // Rejected, not settled by code: the model judges again, from the update's words, whether each is a revision.
  if (unworded.length) throw new Error(`Change entries of kind revised must copy the words of this update that say an existing rule is replaced, changed or removed, as written in their now passages; an update that adds alongside what exists is added: ${unworded.join("; ")}`)
  const covered = new Set(changes.flatMap(c => c.items))
  for (const [id, { existed, text }] of changed) {
    if (covered.has(id)) continue
    changes.push({ kind: existed ? "revised" : "added", subject: heading(text) || id, items: [id], subjects: [], old_values: [], new_values: [], parameters: [],
      now: itemQuotes(context.current, id, n => n === context.input, context.index, context.cut),
      before: existed ? itemQuotes(context.previous, id, n => n < context.input, context.index, () => false).slice(0, BEFORE_LIMIT) : [], filled_by_code: true,
      ...(existed ? { missing: ["old_values", "subjects"] } : {}) })
  }
  return { changes, dropped }
}

/** The change-list section placed first in the delivered text: this update's changes, revisions still open, then earlier requirements the starting code does not meet. */
export function changeSection(changes: SettledChange[], revisions: RevisionEntry[], ledger: LedgerEntry[], current: Record<string, TaskIntent>, eventId: string, deliveredFrom = 1): string {
  const open = ledger.filter(e => e.state === "open")
  const carried = revisions.filter(r => r.state === "open" && r.event_id !== eventId)
  if (!changes.length && !carried.length && !open.length) return ""
  const items = new Map(Object.values(current).flatMap(t => t.content.map(c => [c.item_id, c.text] as const)))
  const excerpt = (t: string) => t.trim().split("\n").slice(0, 8).join("\n")
  const body = (c: SettledChange) => [
    ...(c.filled_by_code ? ["Listed by code from this update's IR change; quotes the original."] : []),
    ...(c.kind === "revised" && (c.old_values.length || c.new_values.length) ? [`Replaced: ${c.old_values.map(v => `\`${v}\``).join(", ") || "-"} → ${c.new_values.map(v => `\`${v}\``).join(", ") || "-"}`] : []),
    ...(c.wording ? [`As the update says: "${c.wording}"`] : []),
    ...(c.parameters.length ? [`Parameters: ${c.parameters.join(", ")}`] : []),
    ...(c.before.length ? [`Before (original passages):\n${refList(c.before, deliveredFrom)}`] : []),
    // A new command or operation is the update's own text, delivered below; a revision names where it now holds.
    ...(c.now.length && c.kind === "revised" ? [`Now:\n${refList(c.now, deliveredFrom)}`] : []),
  ]
  const sections = [
    ...changes.map(c => [`## ${c.kind === "revised" ? "Changed" : "New"}: ${c.subject}`, ...body(c)].join("\n")),
    ...carried.map(r => [`## Changed in update ${r.input}, not yet confirmed in the code: ${r.subject}`, ...body(r)].join("\n")),
    ...open.map(e => {
      const text = e.items.map(id => items.get(id)).find(Boolean)
      return [`## Not yet met: ${e.subject}`, ...(text ? [`Original text:\n${excerpt(text).split("\n").map(l => `> ${l}`).join("\n")}`] : []), `Observed in the current code: ${(e.last.observed || "(no detail)").slice(0, 300)}`].join("\n")
    }),
  ]
  return `# Changes in this update\n${CHANGES_NOTE}\n\n${sections.join("\n\n")}\n\n`
}
export const CHANGES_NOTE = "Management lists here, one by one, what this update changes in the requirements below (corrections of existing commands or operations, and new ones), changes of earlier updates it has not yet confirmed in the code, and earlier requirements the current code does not yet meet. Each entry is a separate requirement of this update: carry each into the PRD as its own item and make the code follow it. Passages are named by their user update and opening words; the user's original text below is the authority."
