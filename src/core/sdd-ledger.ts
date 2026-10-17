import type { TaskIntent } from "./intent-contract.js"
import type { AcceptanceExample, ExampleTier, ItemRevisions, LedgerEntry, SddSnapshot } from "./sdd-contract.js"
import { currentRevisions, narrowedItems } from "./sdd-increment.js"

/**
 * The failure ledger, derived by code from what the store records: for every
 * returned run whose code counts (not superseded, not voided), the results of
 * running its delivery's checkable examples, and its PRD check's open GAPs.
 * An entry opens when it first fails, closes when it passes; an entry whose
 * requirement items were withdrawn or revised since is removed.
 */
export function computeLedger(s: SddSnapshot, current: Record<string, TaskIntent>): LedgerEntry[] {
  const now = currentRevisions(current)
  const entries = new Map<string, LedgerEntry>()
  const runs = s.runs.filter(r => r.result && !r.superseded && !r.voided)
  // The examples of the latest returned delivery: an example it no longer carries no longer states what holds.
  let latest = new Set<string>()
  for (const run of runs) {
    const delivery = s.batches.find(b => b.delivery?.ref.id === run.ci_ref.id)?.delivery
    const examples = new Map<string, { subject: string; items: string[]; revisions: ItemRevisions; example: AcceptanceExample; tier?: ExampleTier }>()
    for (const a of delivery?.contract?.acceptance ?? []) a.examples.forEach((e, i) => examples.set(`${a.subject}#${i + 1}`, { subject: a.subject, items: a.items, revisions: a.revisions, example: e, tier: "verbatim" }))
    for (const e of delivery?.contract?.executable ?? []) examples.set(e.id, { subject: e.subject, items: e.items, revisions: e.revisions, example: e, tier: e.tier })
    latest = new Set(examples.keys())
    for (const r of run.result!.example_results ?? []) {
      const known = examples.get(r.id)
      if (!known) continue
      const last = { event_id: run.event_id, run_id: run.run_id, passed: r.passed, observed: r.failures.join("; ").slice(0, 600) }
      const entry = entries.get(r.id)
      if (entry) { entry.last = last; entry.state = r.passed ? "closed" : "open"; entry.example = known.example; entry.revisions = known.revisions; if (!r.passed && entry.state === "open" && !entry.first_failed) entry.first_failed = run.event_id }
      else if (!r.passed) entries.set(r.id, { id: r.id, kind: "example", ...(known.tier ? { tier: known.tier } : {}), subject: known.subject, items: known.items, revisions: known.revisions, example: known.example, first_failed: run.event_id, last, state: "open" })
    }
    // SDD's own PRD check: GAPs still open after this run.
    const open = new Set((run.result!.prd_check?.open_gaps ?? []).map(g => g.title))
    for (const g of run.result!.prd_check?.open_gaps ?? []) {
      const id = `gap:${g.title}`
      const entry = entries.get(id)
      const last = { event_id: run.event_id, run_id: run.run_id, passed: false, observed: g.text.slice(0, 600) }
      if (entry) { entry.last = last; entry.state = "open" } else entries.set(id, { id, kind: "prd_gap", subject: g.title, items: [], revisions: {}, first_failed: run.event_id, last, state: "open" })
    }
    if (run.result!.prd_check) for (const entry of entries.values()) if (entry.kind === "prd_gap" && entry.state === "open" && !open.has(entry.subject)) { entry.state = "closed"; entry.last = { ...entry.last, event_id: run.event_id, run_id: run.run_id, passed: true } }
    // IC's in-round acceptance: checks still failing in the code this run returns; the rest of what was open now passes.
    const acceptance = run.result!.acceptance
    if (acceptance) {
      const failing = new Set(acceptance.open.map(o => `acceptance:${o.id}`))
      for (const o of acceptance.open) {
        const id = `acceptance:${o.id}`
        const last = { event_id: run.event_id, run_id: run.run_id, passed: false, observed: o.observed.slice(0, 600) }
        const entry = entries.get(id)
        if (entry) { entry.last = last; entry.state = "open" } else entries.set(id, { id, kind: "acceptance", subject: o.subject, items: [], revisions: {}, first_failed: run.event_id, last, state: "open" })
      }
      for (const entry of entries.values()) if (entry.kind === "acceptance" && entry.state === "open" && !failing.has(entry.id)) { entry.state = "closed"; entry.last = { ...entry.last, event_id: run.event_id, run_id: run.run_id, passed: true } }
    }
    // Findings IC records but never feeds back: opened and closed the same way, kept apart from what is sent.
    if (acceptance) {
      const recorded = new Set((acceptance.recorded ?? []).map(o => `recorded:${o.id}`))
      for (const o of acceptance.recorded ?? []) {
        const id = `recorded:${o.id}`
        const last = { event_id: run.event_id, run_id: run.run_id, passed: false, observed: o.observed.slice(0, 600) }
        const entry = entries.get(id)
        if (entry) { entry.last = last; entry.state = "open" } else entries.set(id, { id, kind: "recorded", subject: o.subject, items: [], revisions: {}, first_failed: run.event_id, last, state: "open" })
      }
      for (const entry of entries.values()) if (entry.kind === "recorded" && entry.state === "open" && !recorded.has(entry.id)) { entry.state = "closed"; entry.last = { ...entry.last, event_id: run.event_id, run_id: run.run_id, passed: true } }
    }
  }
  // An item a later update cut part of without revising it counts as revised: its entries no longer state what holds.
  const narrowed = narrowedItems(s.ir, current)
  for (const entry of entries.values()) {
    const changed = Object.entries(entry.revisions).filter(([id, rev]) => now.get(id) !== rev || narrowed.has(id)).map(([id]) => id)
    if (changed.length) { entry.state = "removed"; entry.removed_reason = `item ${changed.join(", ")} withdrawn, revised or cut since` }
    else if (entry.kind === "example" && !latest.has(entry.id)) { entry.state = "removed"; entry.removed_reason = "no longer among the examples of the latest returned delivery" }
  }
  return [...entries.values()]
}

/** The section code appends for open entries: existing requirements the current code does not yet meet. */
export function ledgerSection(entries: LedgerEntry[], current: Record<string, TaskIntent>): string {
  const open = entries.filter(e => e.state === "open")
  if (!open.length) return ""
  const items = new Map(Object.values(current).flatMap(t => t.content.map(c => [c.item_id, c.text] as const)))
  const body = open.map((e, i) => {
    const quote = e.items.map(id => items.get(id)).filter(Boolean).map(t => t!.length > 400 ? `${t!.slice(0, 400)}…` : t!).join("\n")
    return [`## ${i + 1}. ${e.subject}${e.kind === "prd_gap" ? " (left open by SDD's own PRD check)" : e.kind === "acceptance" ? " (found by management's acceptance of the code)" : e.tier === "derived" ? " (expected result worked out from the requirement's rules, not written in it)" : e.tier === "runs" ? " (the requirement's own sample input does not run)" : ""}`,
      `Failing since user update ${e.first_failed.replace(/^r(\d+)-user-input$/u, "$1")}; last result in update ${e.last.event_id.replace(/^r(\d+)-user-input$/u, "$1")}.`,
      ...(quote ? [`Requirement (original text):\n${quote}`] : []),
      ...(e.example ? [`Example:\nGiven:\n${e.example.given.trim()}\nExpect:\n${e.example.expect.trim()}`] : []),
      `Observed in the current code: ${e.last.observed || "(no detail)"}`].join("\n")
  }).join("\n\n")
  return `# Existing requirements the current code does not yet meet\n${LEDGER_NOTE}\n\n${body}\n\n`
}

/**
 * Whether open ledger entries go into the delivered text (the change list's
 * "Not yet met" entries and their own section). Off until a held-out check
 * shows the ledger's judgements precise enough; the ledger is computed and
 * recorded in every delivery either way.
 */
export const LEDGER_FEEDBACK = false

/**
 * The open entries the delivered text carries. Acceptance entries (static unit
 * check, code-built error probes: no model-built input, no false positive on the
 * held-out code) always; example and PRD-check entries only with LEDGER_FEEDBACK.
 */
export function fedBack(entries: LedgerEntry[]): LedgerEntry[] {
  // Recorded findings are never fed back, whatever LEDGER_FEEDBACK says.
  return entries.filter(e => e.kind !== "recorded" && (e.kind === "acceptance" || LEDGER_FEEDBACK))
}

export const LEDGER_NOTE = "Management checked the code this update starts from against the requirements (static checks and calls built from the requirement's own error rules). These earlier requirements are not met by that code. They are not new requirements: the original text below already states them, unchanged. Meeting them is part of this update."
