import type { TaskIntent } from "./intent-contract.js"
import type { DeliveryContract, Quote, RevisionEntry, RulingEntry, SettledConflict } from "./sdd-contract.js"
import { itemOf } from "./sdd-executable.js"
import { currentRevisions } from "./sdd-increment.js"
import { holdsValue, normValue, quoteBlock, resolveQuotes, type segmentIndex } from "./sdd-quotes.js"

type Index = ReturnType<typeof segmentIndex>
type Rulings = NonNullable<DeliveryContract["conflicts"]>

/**
 * Management's rulings are IR state (v7 R10 fix): the IR answer gives them, code quotes their passages and keeps
 * them across rounds in the delivery contract (conflicts). A ruling stands until a later IR replaces or withdraws
 * it, or every item it rules on is withdrawn; a revision of its items does not drop it.
 */

/** A ruling's id; entries a CI answer wrote before the fix have none and are named by their subject. */
export const rulingId = (c: SettledConflict): string => c.id ?? `conflict:${c.subject}`

/**
 * The ruling questions of an update: each open revision whose old values code could not find written in its
 * earlier passages. Asked of the IR, which answers each with an identity ruling (the earlier name as written)
 * or an unstated one (the original does not write the earlier state the update describes).
 */
export interface RulingQuestion { question: string; input: number; subject: string; wording: string; items: string[]; before: Quote[]; now: Quote[] }
export function rulingQuestions(revisions: readonly RevisionEntry[] | undefined, ir: Record<string, TaskIntent>): RulingQuestion[] {
  const now = currentRevisions(ir)
  return (revisions ?? []).filter(r => r.state === "open" && !r.ruled && (r.missing ?? []).includes("old_values") && r.items.some(id => now.has(id)))
    .map(r => ({ question: r.id, input: r.input, subject: r.subject, wording: r.wording ?? "", items: r.items.filter(id => now.has(id)), before: r.before, now: r.now }))
}

/** What the IR request shows of the current rulings. */
export function rulingView(rulings: Rulings | undefined): Array<{ id: string; kind: string; subject: string; items: string[]; passages: Array<{ source_id: string; segment_id: string }>; holds: string; basis: string; values: Array<{ said: string; written: string }> }> {
  return (rulings ?? []).map(c => ({ id: rulingId(c), kind: c.kind ?? "conflict", subject: c.subject, items: c.items,
    passages: c.quotes.map(q => ({ source_id: q.source_id, segment_id: q.segment_id })), holds: c.ruling, basis: c.basis, values: c.values ?? [] }))
}

/**
 * The IR answer's rulings, settled by code: items are current content items, passages resolve and are quoted
 * (at least two; one for an unstated answer), an identity writes each name where it says (the update's name in a
 * later passage than the earlier name), a question or replaced ruling is one the request listed, and every ruling
 * question is answered. A defect rejects the answer; the IR answers again.
 */
export function settleRulings(entries: readonly RulingEntry[], withdraw: ReadonlyArray<{ ruling_id: string; reason: string }>, context: {
  eventId: string; index: Index; ir: Record<string, TaskIntent>; questions: readonly RulingQuestion[]; current: Rulings }): { rulings: SettledConflict[]; withdrawn: Array<{ id: string; reason: string }> } {
  const now = currentRevisions(context.ir)
  const known = new Set(context.current.map(rulingId)), asked = new Set(context.questions.map(q => q.question))
  const problems: string[] = []
  const rulings = entries.flatMap((e, k): SettledConflict[] => {
    const name = `ruling ${k + 1} (${JSON.stringify(e.subject)})`
    const wrong = (why: string) => { problems.push(`${name}: ${why}`); return [] }
    if (!e.subject.trim() || !e.holds.trim() || !e.basis.trim()) return wrong("give subject, holds and basis (a later update governs the part it changes; a specific rule takes precedence over a general one)")
    const items = [...new Set(e.item_ids.map(id => itemOf(id, now)).filter((id): id is string => id !== undefined))]
    const unknown = e.item_ids.filter(id => itemOf(id, now) === undefined)
    if (unknown.length || !items.length) return wrong(`item_ids must name current content items${unknown.length ? `; not current: ${unknown.join(", ")}` : ""}`)
    const resolved = resolveQuotes(e.passages, context.index, () => false)
    if (resolved.dropped.length) return wrong(`passages do not resolve: ${resolved.dropped.join("; ")}`)
    const quotes = resolved.quotes.sort((a, b) => a.input - b.input || Number(a.segment_id.slice(1)) - Number(b.segment_id.slice(1)))
    if (quotes.length < (e.kind === "unstated" ? 1 : 2)) return wrong(e.kind === "unstated" ? "cite the passage of the update that describes the earlier state" : "cite at least two passages: those that disagree, or the update's words and the earlier passage they refer to")
    if (e.question && !asked.has(e.question)) return wrong(`question ${e.question} is not one this request asked`)
    if (e.replaces && !known.has(e.replaces)) return wrong(`replaces ${e.replaces}, which is not a current ruling`)
    const values = e.values.filter(v => v.said.trim() || v.written.trim())
    if (e.kind === "identity") {
      if (!values.length) return wrong("an identity gives values: said (the name as the later update writes it) and written (as the earlier passage writes it)")
      for (const v of values) {
        const saidAt = quotes.filter(q => holdsValue(q.text, v.said)).map(q => q.input)
        const writtenAt = quotes.filter(q => holdsValue(q.text, v.written)).map(q => q.input)
        if (!saidAt.length) problems.push(`${name}: said ${JSON.stringify(v.said)} is not written in its passages`)
        else if (!writtenAt.some(i => i < Math.max(...saidAt))) problems.push(`${name}: written ${JSON.stringify(v.written)} is not written in a passage of an update before the one that says ${JSON.stringify(v.said)}`)
      }
    }
    if (e.kind === "unstated" && values.some(v => v.written.trim())) return wrong("an unstated ruling says the earlier passages do not write the earlier state: give said only, written empty")
    return [{ id: `${context.eventId}#R${k + 1}`, kind: e.kind, subject: e.subject.trim(), items, quotes, ruling: e.holds.trim(), basis: e.basis.trim(),
      ...(values.length ? { values: values.map(v => ({ said: v.said.trim(), written: v.written.trim() })) } : {}),
      ...(e.question ? { question: e.question } : {}), ...(e.replaces ? { replaces: e.replaces } : {}), event_id: context.eventId }]
  })
  const answered = new Set(rulings.filter(r => r.kind === "identity" || r.kind === "unstated").flatMap(r => r.question ? [r.question] : []))
  const open = context.questions.filter(q => !answered.has(q.question))
  if (open.length) problems.push(`ruling questions not answered: ${open.map(q => `${q.question} (${JSON.stringify(q.subject)})`).join(", ")}; answer each with an identity ruling (values: said as the update writes the earlier state, written as an earlier passage writes it) or an unstated ruling (the original does not write the earlier state)`)
  const withdrawn = withdraw.map(w => ({ id: w.ruling_id, reason: w.reason.trim() }))
  for (const w of withdrawn) if (!known.has(w.id)) problems.push(`withdraw_rulings names ${w.id}, which is not a current ruling`)
  if (problems.length) throw new Error(`Rulings do not hold: ${problems.join("; ")}`)
  return { rulings, withdrawn }
}

/**
 * The rulings this delivery holds: every earlier one not replaced or withdrawn by this update's IR and with an
 * item still current, then this update's own.
 */
export function carryRulings(previous: Rulings, written: readonly SettledConflict[], withdrawn: ReadonlyArray<{ id: string; reason: string }>,
  ir: Record<string, TaskIntent>, dropped: DeliveryContract["dropped"]): Rulings {
  const now = currentRevisions(ir)
  const revisionsOf = (items: string[]) => Object.fromEntries(items.map(id => [id, now.get(id)!]))
  const carried = previous.flatMap(c => {
    const id = rulingId(c), out = withdrawn.find(w => w.id === id), by = written.find(w => w.replaces === id)
    const items = c.items.filter(x => now.has(x))
    const why = out ? `withdrawn by this update's IR: ${out.reason}` : by ? `replaced by ${by.id}` : !items.length ? "every item it rules on is withdrawn" : undefined
    if (why) { dropped.push({ kind: "conflict", name: c.subject, reason: why }); return [] }
    return [{ ...c, items, revisions: revisionsOf(items), carried: true }]
  })
  return [...carried, ...written.map(c => ({ ...c, revisions: revisionsOf(c.items), carried: false }))]
}

/** The identity or unstated ruling that reads a revision's old value: the update's name for something earlier. */
export function rulingFor(value: string, items: readonly string[], rulings: readonly SettledConflict[]): { ruling: SettledConflict; written: string } | undefined {
  for (const r of rulings) {
    if ((r.kind !== "identity" && r.kind !== "unstated") || !r.items.some(id => items.includes(id))) continue
    const v = (r.values ?? []).find(x => normValue(x.said) === normValue(value))
    if (v) return { ruling: r, written: v.written }
  }
  return undefined
}

/**
 * The open revisions a ruling question was asked for, answered: an identity gives their old values (the earlier
 * names as written, with the earlier passages it quotes added to before); an unstated ruling records that the
 * original does not write them. The landing check and the purge of carried entries then work from those values.
 */
export function answerRevisions(revisions: RevisionEntry[], rulings: readonly SettledConflict[]): RevisionEntry[] {
  return revisions.map(r => {
    const ruling = rulings.find(x => x.question === r.id && (x.kind === "identity" || x.kind === "unstated"))
    if (!ruling || r.state !== "open") return r
    const missing = (r.missing ?? []).filter(m => m !== "old_values")
    if (ruling.kind === "unstated") return { ...r, ruled: { ruling: ruling.id!, stated: false }, ...(missing.length ? { missing } : { missing: undefined }) }
    const seen = new Set(r.before.map(q => `${q.source_id}|${q.segment_id}`))
    const before = [...r.before, ...ruling.quotes.filter(q => q.input < r.input && !seen.has(`${q.source_id}|${q.segment_id}`))]
    const old = [...new Set((ruling.values ?? []).map(v => v.written).filter(Boolean))]
    const rest = missing.filter(m => m !== "before" || !before.length)
    return { ...r, before, old_values: [...new Set([...r.old_values, ...old])], ruled: { ruling: ruling.id!, stated: true }, ...(rest.length ? { missing: rest } : { missing: undefined }) }
  }).map(r => { if (r.missing === undefined) delete r.missing; return r })
}

const KIND_LABEL: Record<string, string> = { conflict: "the passages disagree", identity: "an update's name for an earlier one", partial: "part of a passage changed, the rest stands", unstated: "earlier state not written in the original" }

/** The rulings section of the delivered text, after the change list. */
export function rulingSection(rulings: readonly SettledConflict[]): string {
  if (!rulings.length) return ""
  const body = rulings.map(c => {
    const code = (t: string) => `\`${t.replace(/`/gu, "")}\``
    const names = (c.values ?? []).filter(v => v.said).map(v => v.written ? `${code(v.said)} in the later update is what earlier passages write as ${code(v.written)}` : `${code(v.said)}: the earlier state is not written in the original requirements`)
    return [`## ${c.subject} (${KIND_LABEL[c.kind ?? "conflict"]})`, quoteBlock(c.quotes), "", ...(names.length ? [`- Names: ${names.join("; ")}`] : []), `- Holds now: ${c.ruling}`, `- Basis: ${c.basis}`].join("\n")
  }).join("\n\n")
  return `# Management rulings on the original requirements\n${RULING_NOTE}\n\n${body}\n\n`
}

export const RULING_NOTE = "Where the original requirements do not settle something by their text alone (passages that disagree, an update naming an earlier field or rule by another name, an update changing only part of a passage), management rules what holds. Each passage is quoted verbatim with the user update it comes from; the ruling and its basis follow. Carry each ruling into the PRD and implement it; a passage a ruling reads as renamed or partly changed stays in the original text below as written."
