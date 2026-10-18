import type { CompilerEvent } from "./intent-contract.js"
import { sourceSegments } from "./source-payload.js"
import type { Quote, SegmentRef } from "./sdd-contract.js"

/** A value as compared: lower case, letters and digits only ("SHA-256" and "sha256" are the same value). */
export const normValue = (v: string) => v.toLowerCase().replace(/[^a-z0-9]/gu, "")

/**
 * Whether words a model copied are written in a text: compared with whitespace collapsed and markdown emphasis
 * and code marks (`*`, backtick) removed on both sides, since a copy drops them ("now uses sample standard
 * deviation" is written in "now uses **sample standard deviation**").
 */
export function writtenIn(text: string, words: string): boolean {
  const plain = (t: string) => t.replace(/[`*]/gu, "").replace(/\s+/gu, " ").trim()
  const w = plain(words)
  return w.length > 0 && plain(text).includes(w)
}

/** Every segment of the recorded inputs by "source_id|segment_id", with its 1-based input number. */
export function segmentIndex(events: readonly CompilerEvent[]): Map<string, Quote & { start: number; end: number }> {
  const order = new Map(events.filter(e => e.kind === "user_input").map((e, i) => [e.event_id, i + 1]))
  return new Map(sourceSegments(events).flatMap(x => order.has(x.source_id)
    ? [[`${x.source_id}|${x.segment_id}`, { source_id: x.source_id, segment_id: x.segment_id, input: order.get(x.source_id)!, text: x.text, start: x.span.start, end: x.span.end }] as const] : []))
}

/**
 * References resolved to verbatim quotes, in the order given, each once. A
 * reference no input has, or one whose passage this delivery cuts (withdrawn,
 * superseded, not delivered), is left out and named in dropped.
 */
export function resolveQuotes(refs: readonly SegmentRef[], index: ReturnType<typeof segmentIndex>, cut: (q: Quote & { start: number; end: number }) => boolean): { quotes: Quote[]; dropped: string[] } {
  const quotes: Quote[] = [], dropped: string[] = [], seen = new Set<string>()
  for (const ref of refs) {
    const key = `${ref.source_id}|${ref.segment_id}`
    if (seen.has(key)) continue
    seen.add(key)
    const found = index.get(key)
    if (!found) { dropped.push(`${key}: no such segment`); continue }
    if (cut(found)) { dropped.push(`${key}: this delivery cuts its text`); continue }
    quotes.push({ source_id: found.source_id, segment_id: found.segment_id, input: found.input, text: found.text })
  }
  return { quotes, dropped }
}

/**
 * C1 (v6): passages by reference, the original delivered once. A passage of an input this text delivers is
 * named by its update and its opening words (the reader finds it below); one of an input the PRD baseline
 * stands for is named by its update only (its text is not attached, D1).
 */
export function refList(quotes: readonly Quote[], deliveredFrom: number): string {
  const opening = (q: Quote) => { const t = q.text.trim().replace(/\s+/gu, " "); return `«${t.slice(0, 60)}${t.length > 60 ? "…" : ""}»` }
  // Consecutive paragraphs of one update are one range.
  const runs: Quote[][] = []
  for (const q of quotes) {
    const last = runs.at(-1)?.at(-1)
    if (last && last.source_id === q.source_id && Number(q.segment_id.slice(1)) === Number(last.segment_id.slice(1)) + 1) runs.at(-1)!.push(q)
    else runs.push([q])
  }
  return runs.map(run => {
    const first = run[0]!, last = run.at(-1)!
    if (first.input < deliveredFrom) return `- update ${first.input} (stands in the PRD baseline)`
    return run.length === 1 ? `- update ${first.input}, paragraph ${opening(first)}` : `- update ${first.input}, ${run.length} paragraphs from ${opening(first)} to ${opening(last)}`
  }).filter((line, i, all) => all.indexOf(line) === i).join("\n")
}

/** Quotes as delivered: each passage verbatim, as a block quote under the update it comes from. */
export function quoteBlock(quotes: readonly Quote[]): string {
  return quotes.map(q => `(user update ${q.input})\n${q.text.trim().split("\n").map(l => `> ${l}`).join("\n")}`).join("\n")
}

/**
 * The facts a text states, by the identifiers code can read: words (command,
 * operation, option and field names), backticked and quoted spans, and values
 * with digits, all normalized. A revision drops an entry whose facts name one
 * of its subjects and whose text holds a value it replaced.
 */
export function factsOf(text: string): string[] {
  const out = new Set<string>()
  for (const m of text.matchAll(/[A-Za-z_][A-Za-z0-9_-]*/gu)) { const v = normValue(m[0]); if (v.length >= 2) out.add(v) }
  for (const m of text.matchAll(/`([^`\n]+)`|"([^"\n]+)"/gu)) { const v = normValue(m[1] ?? m[2] ?? ""); if (v) out.add(v) }
  for (const m of text.matchAll(/[A-Za-z0-9]*\d[A-Za-z0-9.-]*/gu)) { const v = normValue(m[0]); if (v) out.add(v) }
  return [...out].sort()
}

/** A text's words, each normalized; a hyphenated or dotted word is one word ("BLAKE2b-256", ".sha256"). */
const words = (text: string) => text.split(/[\s`"'()[\]{},:;|<>=*/\\]+/u).map(normValue).filter(Boolean)

/**
 * Whether a text holds a value: its words appear in the text in order, each
 * compared normalized ("SHA-256" is "SHA256"), never as part of a longer word
 * ("blake2b" is not in "BLAKE2b-256").
 */
export function holdsValue(text: string, value: string): boolean {
  const v = words(value), t = words(text)
  if (!v.length) return false
  for (let i = 0; i + v.length <= t.length; i++) if (v.every((w, k) => t[i + k] === w)) return true
  return false
}
