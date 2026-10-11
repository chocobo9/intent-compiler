import type { TaskIntent } from "./intent-contract.js"
import type { CIDelivery, ChangeEntry, DeliveryContract, LedgerEntry } from "./sdd-contract.js"
import { itemOf } from "./sdd-executable.js"
import { currentRevisions } from "./sdd-increment.js"

type Delivered = NonNullable<CIDelivery["changes"]>
const squash = (t: string) => t.replace(/\s+/gu, " ").trim()

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

/** A short verbatim excerpt of an item: its first lines, up to about 300 characters. */
function excerpt(text: string): string {
  const lines = text.trim().split("\n")
  let out = ""
  for (const line of lines) { if (out && out.length + line.length > 300) break; out += (out ? "\n" : "") + line }
  return out.length > 600 ? `${out.slice(0, 600)}…` : out
}

/** The heading an item's text gives itself (its first line, without markdown marks). */
function heading(text: string): string {
  const first = text.trim().split("\n").find(l => l.trim()) ?? ""
  return first.replace(/^#+\s*/u, "").replace(/`/gu, "").trim().slice(0, 120)
}

/**
 * This round's change list as delivered. Entries keep only items this update
 * added or revised; an entry with none is dropped. A quote the items' original
 * text does not contain is replaced by an excerpt of it. Every changed item no
 * entry covers gets an entry from code, quoting its original text.
 */
export function settleChanges(entries: ChangeEntry[], changed: Map<string, { existed: boolean; text: string }>): { changes: Delivered; dropped: DeliveryContract["dropped"] } {
  const ids = new Map([...changed.keys()].map(id => [id, 0]))
  const changes: Delivered = [], dropped: DeliveryContract["dropped"] = []
  for (const e of entries) {
    const items = [...new Set(e.items.map(id => itemOf(id, ids)).filter((id): id is string => id !== undefined))]
    if (!items.length) { dropped.push({ kind: "change", name: e.subject, reason: `names no item this update added or revised (${e.items.join(", ") || "none"})` }); continue }
    const texts = items.map(id => squash(changed.get(id)!.text))
    const quoted = e.quote.trim() && texts.some(t => t.includes(squash(e.quote)))
    changes.push({ ...e, items, ...(quoted ? {} : { quote: excerpt(changed.get(items[0]!)!.text), quote_replaced: true }) })
  }
  const covered = new Set(changes.flatMap(c => c.items))
  for (const [id, { existed, text }] of changed) {
    if (covered.has(id)) continue
    changes.push({ kind: existed ? "revised" : "added", subject: heading(text) || id, items: [id], old_rule: null,
      new_rule: "listed by code from this update's IR change; quotes the original", parameters: [], quote: excerpt(text), filled_by_code: true })
  }
  return { changes, dropped }
}

/** The change-list section placed first in the delivered text: this update's changes, then earlier requirements the starting code does not meet. */
export function changeSection(changes: Delivered, ledger: LedgerEntry[], current: Record<string, TaskIntent>): string {
  const open = ledger.filter(e => e.state === "open")
  if (!changes.length && !open.length) return ""
  const items = new Map(Object.values(current).flatMap(t => t.content.map(c => [c.item_id, c.text] as const)))
  const quote = (t: string) => t.trim().split("\n").map(l => `> ${l}`).join("\n")
  const body = [
    ...changes.map(c => [`## ${c.kind === "revised" ? "Changed" : "New"}: ${c.subject}`,
      ...(c.filled_by_code ? [`Listed by code from this update's IR change; quotes the original.`] : c.kind === "revised" ? [`Before: ${c.old_rule ?? "as the earlier update states it"}`, `Now: ${c.new_rule}`] : [`What it does: ${c.new_rule}`, ...(c.parameters.length ? [`Parameters: ${c.parameters.join(", ")}`] : [])]),
      `Original text:\n${quote(c.quote)}`].join("\n")),
    ...open.map(e => {
      const text = e.items.map(id => items.get(id)).find(Boolean)
      return [`## Not yet met: ${e.subject}`, ...(text ? [`Original text:\n${quote(excerpt(text))}`] : []), `Observed in the current code: ${(e.last.observed || "(no detail)").slice(0, 300)}`].join("\n")
    }),
  ]
  return `# Changes in this update\n${CHANGES_NOTE}\n\n${body.join("\n\n")}\n\n`
}
export const CHANGES_NOTE = "Management lists here, one by one, what this update changes in the requirements below (corrections of existing commands or operations, and new ones) and the earlier requirements the current code does not yet meet. Each entry is a separate requirement of this update: carry each into the PRD as its own item and change the code for each. The original text below is the authority; this list only points to it."
