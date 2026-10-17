import type { TaskIntent } from "./intent-contract.js"
import type { DeliveryContract, ItemRevisions, SddBatch, SddSnapshot } from "./sdd-contract.js"

/**
 * What this round's CI must write and what code carries from the previous
 * accepted delivery. A contract entry (field object, acceptance subject,
 * effective statement) is carried while every item it was written for still
 * exists in the current IR at the same revision; an entry with a withdrawn
 * item is dropped; an entry with a revised item is not carried, and its still
 * existing items are written again. to_write holds the items this update added
 * or revised and the items of entries that were not carried.
 */
export interface CarryPlan {
  fields: DeliveryContract["fields"]
  acceptance: DeliveryContract["acceptance"]
  effective: DeliveryContract["effective"]
  dropped: DeliveryContract["dropped"]
  toWrite: string[]
}

export function currentRevisions(ir: Record<string, TaskIntent>): Map<string, number> {
  return new Map(Object.values(ir).flatMap(t => t.content.map(c => [c.item_id, c.revision] as const)))
}

/** The latest accepted delivery before batch b (the contract code carries from), if any. */
export function previousContract(s: SddSnapshot, b: SddBatch): DeliveryContract | undefined {
  return [...s.batches].reverse().find(x => x !== b && x.event_id !== b.event_id && x.state === "accepted" && x.delivery?.contract)?.delivery!.contract
}

/**
 * Items at the same revision as in the accepted IR whose source passages differ:
 * a later update cut or moved part of what they deliver without revising them.
 * For carrying they count as revised.
 */
export function narrowedItems(accepted: Record<string, TaskIntent>, current: Record<string, TaskIntent>): Set<string> {
  const spans = (ir: Record<string, TaskIntent>) => new Map(Object.values(ir ?? {}).flatMap(t => t.content.map(c => [c.item_id, { revision: c.revision, key: JSON.stringify((c.sources ?? []).map(x => [x.source_id, x.span?.start ?? null, x.span?.end ?? null]).sort()) }] as const)))
  const before = spans(accepted)
  return new Set([...spans(current)].filter(([id, now]) => { const was = before.get(id); return was !== undefined && was.revision === now.revision && was.key !== now.key }).map(([id]) => id))
}

/** Later updates an open revision is carried by, unconfirmed, before it goes to review. */
export const REVISION_REVIEW_AFTER = 2
/** An open revision goes to review at this input when it rests on no words of its update, or REVISION_REVIEW_AFTER later updates carried it. */
export const dueForReview = (r: { wording?: string; input: number }, input: number): boolean => !r.wording || input - r.input > REVISION_REVIEW_AFTER
/** A user update's input number, from 1. */
export const inputOf = (s: SddSnapshot, eventId: string): number => s.events.filter(e => e.kind === "user_input").findIndex(e => e.event_id === eventId) + 1

export function planCarry(previous: DeliveryContract | undefined, accepted: Record<string, TaskIntent>, current: Record<string, TaskIntent>, excluded: ReadonlySet<string> = new Set(), input?: number): CarryPlan {
  const now = currentRevisions(current), before = currentRevisions(accepted)
  const narrowed = narrowedItems(accepted, current)
  const toWrite = new Set([...now].filter(([id, revision]) => before.get(id) !== revision || narrowed.has(id)).map(([id]) => id))
  // Entries code dropped last round because a revision replaced a fact they stated are written again.
  for (const id of previous?.rewrite_next ?? []) toWrite.add(id)
  // A revision going to review at this input no longer stands: its items are written again from the original,
  // so entries it cut facts from (as replaced) are whole again.
  if (input !== undefined) for (const r of previous?.revisions ?? []) if (r.state === "open" && dueForReview(r, input)) r.items.forEach(id => toWrite.add(id))
  const plan: CarryPlan = { fields: [], acceptance: [], effective: [], dropped: [], toWrite: [] }
  const judge = (revisions: ItemRevisions): { carry: true } | { carry: false; reason: string; rewrite: string[] } => {
    const ids = Object.keys(revisions)
    const gone = ids.filter(id => !now.has(id))
    if (gone.length) return { carry: false, reason: `item ${gone.join(", ")} withdrawn`, rewrite: ids.filter(id => now.has(id)) }
    const changed = ids.filter(id => now.get(id) !== revisions[id])
    if (changed.length) return { carry: false, reason: `item ${changed.map(id => `${id}@${revisions[id]}→${now.get(id)}`).join(", ")} revised`, rewrite: ids }
    const cut = ids.filter(id => narrowed.has(id))
    if (cut.length) return { carry: false, reason: `item ${cut.join(", ")} delivers other passages now (a later update cut or moved part of it)`, rewrite: ids }
    const held = ids.filter(id => excluded.has(id))
    if (held.length) return { carry: false, reason: `item ${held.join(", ")} not delivered now`, rewrite: ids.filter(id => !excluded.has(id)) }
    return { carry: true }
  }
  for (const entry of previous?.fields ?? []) {
    const verdict = judge(entry.revisions)
    if (verdict.carry) plan.fields.push({ ...entry, carried: true })
    else { plan.dropped.push({ kind: "field", name: entry.object, reason: verdict.reason }); verdict.rewrite.forEach(id => toWrite.add(id)) }
  }
  for (const entry of previous?.acceptance ?? []) {
    const verdict = judge(entry.revisions)
    if (verdict.carry) plan.acceptance.push({ ...entry, carried: true })
    else { plan.dropped.push({ kind: "acceptance", name: entry.subject, reason: verdict.reason }); verdict.rewrite.forEach(id => toWrite.add(id)) }
  }
  for (const entry of previous?.effective ?? []) {
    const verdict = judge({ [entry.entry.item_id]: entry.revision })
    if (verdict.carry) plan.effective.push({ ...entry, carried: true })
    else plan.dropped.push({ kind: "effective", name: entry.entry.item_id, reason: verdict.reason })
  }
  plan.toWrite = [...toWrite].filter(id => now.has(id))
  return plan
}
