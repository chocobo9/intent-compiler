import type { Registry } from "./registry.js"
import type { SentenceState } from "./verification.js"
import { paragraphInForce } from "./view.js"

/**
 * The debt slice (DESIGN-OPUS-2026-10-26 §3, §10.2 G11, §11 item 3): the earlier paragraphs the reviewer gets this
 * round beside this round's text, chosen by code from the verification state at the round's start.
 *
 * Order: paragraphs holding last round's gaps (scope items the reviews left uncovered), then those cut from last
 * round's slice, then those a never-passed check cites, then by round from the earliest, taking one paragraph per
 * command in turn. A paragraph sent leaves the queue until every paragraph in debt has had its turn (the rotation);
 * the pointer moves only for paragraphs sent. At most `max` paragraphs (8) and `chars` characters (the reviewer's line
 * less A and B); a paragraph that does not fit is cut, recorded, and heads the next round's queue.
 */

export const SLICE_PARAGRAPHS = 8

export interface SliceRecord {
  /** Paragraphs sent this round, in order, with their debt sentences and characters. */
  sent: { paragraph: string; object: string; sentences: string[]; chars: number; why: SliceWhy }[]
  /** Paragraphs chosen but cut (the characters ran out). */
  cut: { paragraph: string; chars: number }[]
  /** The rotation after this round: paragraphs sent since the rotation last started over. */
  rotation: string[]
  /** The budget: the paragraph cap and the characters left for D. */
  budget: { paragraphs: number; chars: number }
  /** Debt at the start: sentences and paragraphs. */
  debt: { sentences: number; paragraphs: number }
}

export type SliceWhy = "gap" | "cut before" | "never passed" | "rotation"

export interface SliceHistory {
  /** The last round's slice record, if any. */
  last?: Pick<SliceRecord, "rotation" | "cut">
  /** Sentences last round's reviews left uncovered (scope items, batch 1 effect 8). */
  gaps?: readonly string[]
}

export function chooseSlice(registry: Registry, round: number, states: readonly SentenceState[], history: SliceHistory, budget: { paragraphs?: number; chars: number }): SliceRecord {
  const max = budget.paragraphs ?? SLICE_PARAGRAPHS
  const debt = states.filter(s => s.debt && s.round < round)
  const byParagraph = new Map<string, SentenceState[]>()
  for (const s of debt) byParagraph.set(s.paragraph, [...(byParagraph.get(s.paragraph) ?? []), s])
  const paragraphs = [...byParagraph.keys()]
  // The rotation: what was sent since it last started over, as far as it is still in debt; all sent → it starts over.
  let rotation = new Set((history.last?.rotation ?? []).filter(p => byParagraph.has(p)))
  if (paragraphs.every(p => rotation.has(p))) rotation = new Set()
  const gapParagraphs = new Set((history.gaps ?? []).map(id => registry.block(id)?.parent ?? id).filter(p => byParagraph.has(p)))
  const cutBefore = new Set((history.last?.cut ?? []).map(c => c.paragraph).filter(p => byParagraph.has(p)))
  const never = new Set(paragraphs.filter(p => byParagraph.get(p)!.some(s => s.never_passed)))
  const start = (p: string) => registry.block(p)!.start
  const roundOf = (p: string) => registry.block(p)!.round
  // By round from the earliest; within a round, one paragraph per command in turn, each command's in document order.
  const rotationOrder = (list: string[]) => {
    const out: string[] = []
    for (const r of [...new Set(list.map(roundOf))].sort((a, b) => a - b)) {
      const byObject = new Map<string, string[]>()
      for (const p of list.filter(x => roundOf(x) === r).sort((a, b) => start(a) - start(b))) { const o = byParagraph.get(p)![0].object; byObject.set(o, [...(byObject.get(o) ?? []), p]) }
      const queues = [...byObject.entries()].sort((a, b) => a[0].localeCompare(b[0], "en", { numeric: true })).map(([, q]) => [...q])
      while (queues.some(q => q.length)) for (const q of queues) { const p = q.shift(); if (p) out.push(p) }
    }
    return out
  }
  const open = paragraphs.filter(p => !rotation.has(p) || gapParagraphs.has(p) || cutBefore.has(p))
  const ordered: { p: string; why: SliceWhy }[] = []
  const seen = new Set<string>()
  const push = (list: string[], why: SliceWhy) => { for (const p of list) if (!seen.has(p)) { seen.add(p); ordered.push({ p, why }) } }
  push(rotationOrder(open.filter(p => gapParagraphs.has(p))), "gap")
  push(rotationOrder(open.filter(p => cutBefore.has(p))), "cut before")
  push(rotationOrder(open.filter(p => never.has(p))), "never passed")
  push(rotationOrder(open), "rotation")
  const sent: SliceRecord["sent"] = [], cut: SliceRecord["cut"] = []
  let left = Math.max(0, budget.chars)
  for (const { p, why } of ordered) {
    if (sent.length >= max) break
    const chars = paragraphInForce(registry, p, round).length
    if (chars > left) { cut.push({ paragraph: p, chars }); continue }
    left -= chars
    sent.push({ paragraph: p, object: byParagraph.get(p)![0].object, sentences: byParagraph.get(p)!.map(s => s.id), chars, why })
  }
  for (const s of sent) rotation.add(s.paragraph)
  return { sent, cut, rotation: [...rotation], budget: { paragraphs: max, chars: budget.chars }, debt: { sentences: debt.length, paragraphs: paragraphs.length } }
}

export function renderSlice(s: SliceRecord): string {
  const chars = s.sent.reduce((n, x) => n + x.chars, 0)
  const why = (["gap", "cut before", "never passed", "rotation"] as const).map(w => [w, s.sent.filter(x => x.why === w).length] as const).filter(([, n]) => n).map(([w, n]) => `${w} ${n}`).join(", ") || "none"
  return `- Debt slice: ${s.sent.length} paragraphs (${why}), ${chars} characters, of ${s.debt.paragraphs} paragraphs in debt (${s.debt.sentences} sentences); budget ${s.budget.paragraphs} paragraphs, ${s.budget.chars} characters; cut ${s.cut.length}; rotation ${s.rotation.length}/${s.debt.paragraphs}.`
}
