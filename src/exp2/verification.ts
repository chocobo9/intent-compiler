import { activeChecks, type CheckEvent, type CheckRecord } from "./checks.js"
import { notInForce } from "./formalize.js"
import { guardStatuses, type GuardEvent, type GuardRecord } from "./guards.js"
import type { Registry } from "./registry.js"
import type { SourceBlock } from "./source.js"
import { paragraphInForce } from "./view.js"

/**
 * The verification state (DESIGN-OPUS-2026-10-26 §2, §10.2 G1–G3, §11 item 2): code's own account of which sentences
 * in force IC has evidence for, from its guards and checks alone; no model, no official test.
 *
 * - A sentence is a sentence-layer unit of the source (a prose sentence, a list item, a code block, a table) in force
 *   after the round: owned by an object and not replaced or withdrawn.
 * - A guard or check covers a sentence when one of its units is that sentence or a clause inside it. A paragraph or a
 *   section covers none of its sentences (decision B): such a citation counts only as nominal coverage.
 * - held: a live guard covering it passes on the program; failing: something covers it and nothing that does passes
 *   (never_passed: an active library check covers it and has never passed, so it is no guard); unverified: nothing
 *   covers it.
 * - Not behaviour by rule (code, §11 item 2): a fenced code block, what follows an "Example:" lead in its paragraph, a
 *   sentence that is a JSON value, a lead-in sentence ending in a colon. Such a sentence owes nothing; it is still
 *   delivered with its paragraph.
 * - Debt (G3): a sentence not held, with no open item covering it, not ruled out by rule or declaration. Kept per
 *   sentence, delivered per paragraph.
 */

export type VerificationState = "held" | "failing" | "unverified"

export interface SentenceState {
  id: string
  round: number
  paragraph: string
  /** The object the sentence belongs to (the command or operation whose behaviour it states). */
  object: string
  state: VerificationState
  never_passed: boolean
  /** Some live guard or active check cites it, its paragraph or its section (the old, nominal reading). */
  nominal: boolean
  /** An open item covers it: the repair loop has it, not the debt (G3). */
  open: boolean
  /** Why the sentence is not behaviour: the rule, or the reviewer's declaration; null when it is. */
  not_behaviour: string | null
  debt: boolean
}

export interface VerificationInput {
  guards: readonly GuardRecord[]
  guardEvents: readonly GuardEvent[]
  library: readonly CheckRecord[]
  checkEvents: readonly CheckEvent[]
  /** Open items (carried in, or still failing at the end), by the units they rest on. */
  open?: readonly { id: string; units: readonly string[] }[]
  /** Sentences the reviewer declared not behaviour, with the reason (batch 1, effect 5). */
  declared?: ReadonlyMap<string, string>
}

const within = (registry: Registry, inner: string, outer: string) => registry.lineage(inner).some(b => b.id === outer)
/** A unit covers a sentence when it is the sentence or a clause inside it (decision B: coarser units cover none). */
export const coversSentence = (registry: Registry, unit: string, sentence: string) => unit === sentence || (registry.block(unit)?.level === "clause" && within(registry, unit, sentence))

/** The sentences in force after `round`, in round and document order. */
export function sentencesInForce(registry: Registry, round: number): SourceBlock[] {
  const out: SourceBlock[] = []
  for (const s of [...registry.sources.values()].filter(x => x.round <= round).sort((a, b) => a.round - b.round)) {
    for (const b of s.blocks) if (b.level === "sentence" && !notInForce(registry, round, b.id)) out.push(b)
  }
  return out
}

const EXAMPLE_LEAD = /\b(?:for\s+)?examples?\b[^.]*:\s*$/iu
const stripMarks = (t: string) => t.trim().replace(/^(?:[-*+]|\d+[.)])\s+/u, "").replace(/^`+|`+$/gu, "").trim()
const isJson = (t: string) => { const x = stripMarks(t); if (!/^[[{]/u.test(x)) return false; try { JSON.parse(x); return true } catch { return false } }

/** Why a sentence is not behaviour by rule (§11 item 2), or null. */
export function ruleNotBehaviour(registry: Registry, s: SourceBlock): string | null {
  if (s.kind === "code") return "code block"
  if (isJson(s.text)) return "JSON example"
  const p = s.parent ? registry.block(s.parent) : undefined
  if (p) {
    const siblings = p.children.map(c => registry.block(c)!).filter(b => b.level === "sentence")
    const k = siblings.findIndex(b => b.id === s.id)
    if (siblings.slice(0, k).some(b => b.kind !== "code" && EXAMPLE_LEAD.test(b.text.trim()))) return "example"
  }
  if (s.kind === "sentence" && s.text.trim().endsWith(":")) return "lead-in"
  return null
}

export function verificationStates(registry: Registry, round: number, input: VerificationInput): SentenceState[] {
  const status = guardStatuses(input.guardEvents)
  const live = input.guards.filter(g => status.get(g.id) !== "retired")
  const guarded = new Set(input.guards.filter(g => g.source === "library" && g.check).map(g => g.check!))
  const active = activeChecks(input.library, input.checkEvents)
  const neverPassed = active.filter(k => !guarded.has(k.id))
  // By unit, once: a sentence looks up what names it or a clause in it.
  const strict = (units: readonly string[]) => units.map(u => u.split("#")[0])
  const byUnit = <T>(list: readonly T[], units: (x: T) => readonly string[]) => {
    const m = new Map<string, T[]>()
    for (const x of list) for (const u of strict(units(x))) m.set(u, [...(m.get(u) ?? []), x])
    return m
  }
  const guardsBy = byUnit(live, g => g.units), neverBy = byUnit(neverPassed, k => k.blocks), openBy = byUnit(input.open ?? [], o => o.units)
  const nominalUnits = new Set([...live.flatMap(g => strict(g.units)), ...active.flatMap(k => strict(k.blocks))])
  const covering = <T>(m: Map<string, T[]>, s: SourceBlock) => [...(m.get(s.id) ?? []), ...s.children.flatMap(c => m.get(c) ?? [])]
  return sentencesInForce(registry, round).map(s => {
    const gs = covering(guardsBy, s), ks = covering(neverBy, s)
    const held = gs.some(g => status.get(g.id) === "passing")
    const state: VerificationState = held ? "held" : gs.length || ks.length ? "failing" : "unverified"
    const open = covering(openBy, s).length > 0
    const not_behaviour = ruleNotBehaviour(registry, s) ?? (input.declared?.get(s.id) !== undefined ? `declared: ${input.declared.get(s.id)}` : null)
    return {
      id: s.id, round: s.round, paragraph: s.parent ?? s.id, object: registry.coverOf(s.id)?.owner ?? "none", state,
      never_passed: !held && ks.length > 0,
      nominal: registry.lineage(s.id).some(b => nominalUnits.has(b.id)) || s.children.some(c => nominalUnits.has(c)),
      open, not_behaviour, debt: !held && !open && !not_behaviour,
    }
  })
}

export interface VerificationSummary {
  round: number
  sentences: number
  held: number
  failing: number
  never_passed: number
  unverified: number
  open: number
  /** Not behaviour, by rule (rule name → count) and by the reviewer's declaration. */
  not_behaviour: { by_rule: Record<string, number>; declared: number }
  /** Coverage over the sentences that are behaviour: nominal (anything cites it or what holds it) and passing (held). */
  coverage: { behaviour: number; nominal: number; passing: number }
  /** Debt: sentences, the paragraphs holding them, and those paragraphs' characters in force. */
  debt: { sentences: number; paragraphs: number; chars: number }
  /** Against the state at the round's start: sentences that entered the debt, and that left it. */
  delta?: { entered: number; cleared: number }
}

/** The paragraph's characters as delivered: its text in force after `round`. */
export const paragraphChars = (registry: Registry, paragraph: string, round: number) => paragraphInForce(registry, paragraph, round).length

export function summarizeVerification(registry: Registry, round: number, states: readonly SentenceState[], before?: readonly SentenceState[]): VerificationSummary {
  const n = (f: (s: SentenceState) => boolean) => states.filter(f).length
  const byRule: Record<string, number> = {}
  for (const s of states) if (s.not_behaviour && !s.not_behaviour.startsWith("declared")) byRule[s.not_behaviour] = (byRule[s.not_behaviour] ?? 0) + 1
  const debt = states.filter(s => s.debt)
  const paragraphs = [...new Set(debt.map(s => s.paragraph))]
  const behaviour = states.filter(s => !s.not_behaviour)
  const out: VerificationSummary = {
    round, sentences: states.length, held: n(s => s.state === "held"), failing: n(s => s.state === "failing"), never_passed: n(s => s.never_passed), unverified: n(s => s.state === "unverified"), open: n(s => s.open),
    not_behaviour: { by_rule: byRule, declared: n(s => !!s.not_behaviour?.startsWith("declared")) },
    coverage: { behaviour: behaviour.length, nominal: behaviour.filter(s => s.nominal).length, passing: behaviour.filter(s => s.state === "held").length },
    debt: { sentences: debt.length, paragraphs: paragraphs.length, chars: paragraphs.reduce((c, p) => c + paragraphChars(registry, p, round), 0) },
  }
  if (before) {
    const was = new Set(before.filter(s => s.debt).map(s => s.id)), now = new Set(debt.map(s => s.id))
    out.delta = { entered: [...now].filter(x => !was.has(x)).length, cleared: [...was].filter(x => !now.has(x)).length }
  }
  return out
}

const pct = (a: number, b: number) => b ? `${Math.round(100 * a / b)}%` : "—"

export function renderVerification(v: VerificationSummary): string {
  const rules = Object.entries(v.not_behaviour.by_rule).map(([k, c]) => `${k} ${c}`).join(", ") || "none"
  return `- Verification state: ${v.sentences} sentences in force; held ${v.held}, failing ${v.failing} (never passed ${v.never_passed}), unverified ${v.unverified}; open items on ${v.open}; not behaviour by rule ${rules}, declared ${v.not_behaviour.declared}. Coverage of the ${v.coverage.behaviour} behaviour sentences: nominal ${v.coverage.nominal} (${pct(v.coverage.nominal, v.coverage.behaviour)}), passing ${v.coverage.passing} (${pct(v.coverage.passing, v.coverage.behaviour)}). Debt ${v.debt.sentences} sentences in ${v.debt.paragraphs} paragraphs, ${v.debt.chars} characters${v.delta ? `; this round entered ${v.delta.entered}, cleared ${v.delta.cleared}` : ""}.`
}

/**
 * The reviewer's NOT BEHAVIOUR declarations in force (batch 1, G2): each declared sentence once; a declaration ends
 * when a later review item rests on the sentence (a finding names it, so it states behaviour after all). A sentence
 * no longer in force drops out with it.
 */
export function declarations(registry: Registry, executions: readonly { round: number; accept?: { declared?: readonly { id: string; reason: string }[] }; review_items?: readonly { round: number; units: readonly string[] }[] }[]): Map<string, string> {
  const out = new Map<string, string>()
  const items = executions.flatMap(e => e.review_items ?? [])
  for (const e of [...executions].sort((a, b) => a.round - b.round)) for (const d of e.accept?.declared ?? []) {
    if (out.has(d.id)) continue
    // Cited by an item of the same or a later round: behaviour after all.
    if (items.some(i => i.round >= e.round && i.units.some(u => coversSentence(registry, u.split("#")[0], d.id)))) continue
    out.set(d.id, d.reason)
  }
  return out
}
