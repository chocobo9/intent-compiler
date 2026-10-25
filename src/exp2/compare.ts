import { checkAnswer, type Issue } from "./attribution.js"
import { materialize, type AttributionAnswer, type Registry } from "./registry.js"
import { contentHash } from "./source.js"

/**
 * Comparison of two attributions of the same rounds (DESIGN §12b item 11): the system's and an independent one.
 * Objects are matched by the clauses they share; then ownership is compared clause by clause and block by block,
 * and so are partial revisions. The tool lists the disagreements; deciding them is the
 * design session's work.
 */

/**
 * An independent attribution, round by round, in the system's answer schema (whole answers, not patches). Each
 * round is checked by the same code as the system's answers; a round that does not pass is reported, not compared.
 */
export interface IndependentAttribution { label: string; rounds: { round: number; answer: AttributionAnswer }[] }

/** Builds the registry of an independent attribution, stopping at the first round that does not pass the check. */
export function registryOf(texts: readonly string[], a: IndependentAttribution): { registry: Registry; rounds: number; failed: { round: number; issues: Issue[] } | null } {
  const sources = texts.map((text, i) => ({ round: i + 1, text, hash: contentHash(text) }))
  const registry = materialize(sources, [])
  let rounds = 0
  for (const { round, answer } of [...a.rounds].sort((x, y) => x.round - y.round)) {
    const checked = checkAnswer(registry, round, answer)
    if (!checked.acceptance) return { registry, rounds, failed: { round, issues: checked.issues } }
    registry.apply(checked.acceptance)
    rounds = round
  }
  return { registry, rounds, failed: null }
}

const NONE = "none"

interface Side { id: string; name: string }
const side = (r: Registry, id: string | undefined): Side => !id ? { id: "-", name: "(unassigned)" } : id === NONE ? { id: NONE, name: NONE } : { id, name: r.objects.get(id)?.name ?? id }

export interface Comparison {
  rounds: number[]
  /** A's objects with the B object they share most clauses with (null: none in common). */
  matching: { a: Side; b: Side | null; shared: number; a_only: number; b_only: number }[]
  clauses: { total: number; agree: number }
  blocks: { total: number; agree: number }
  /** Units owned differently, at the coarsest block whose clauses all disagree the same way. */
  ownership: { block: string; a: Side; b: Side }[]
  /** Units one side marks as revised (partly, wholly or withdrawn) and the other does not, or differently. */
  modifications: { block: string; a: string | null; b: string | null }[]
}

/** Finest units of the given rounds: blocks with no children. */
function leaves(r: Registry, rounds: readonly number[]): string[] {
  return rounds.flatMap(n => r.sources.get(n)?.blocks.filter(b => !b.children.length).map(b => b.id) ?? [])
}

function modifiedKind(r: Registry): Map<string, string> {
  const out = new Map<string, string>()
  for (const o of r.objects.values()) for (const own of o.blocks) for (const m of own.modifications) {
    for (const part of m.parts) for (const l of leavesUnder(r, part)) out.set(l, `${m.kind} R${m.round}`)
  }
  return out
}

function leavesUnder(r: Registry, id: string): string[] {
  const b = r.block(id)
  if (!b) return []
  return b.children.length ? b.children.flatMap(c => leavesUnder(r, c)) : [b.id]
}

export function compareAttributions(a: Registry, b: Registry, rounds: readonly number[]): Comparison {
  // A heading unit left without an owner by one side (it needs none of its own) is not compared.
  const units = leaves(a, rounds).filter(u => a.block(u)!.kind !== "heading" || (a.coverOf(u) && b.coverOf(u)))
  const ownerA = new Map(units.map(u => [u, a.coverOf(u)?.owner]))
  const ownerB = new Map(units.map(u => [u, b.coverOf(u)?.owner]))
  const compared = new Set(units)
  /** The coarsest blocks whose compared clauses all differ with the same key, each clause in one block. */
  const group = (differs: (u: string) => boolean, key: (u: string) => string): { block: string; first: string }[] => {
    const out: { block: string; first: string }[] = [], done = new Set<string>()
    for (const u of units.filter(differs)) {
      if (done.has(u)) continue
      let top = u
      for (const anc of a.lineage(u).slice(1)) {
        const under = leavesUnder(a, anc.id).filter(l => compared.has(l))
        if (under.every(l => differs(l) && key(l) === key(u))) top = anc.id
        else break
      }
      for (const l of leavesUnder(a, top)) done.add(l)
      out.push({ block: top, first: u })
    }
    return out
  }
  // Match objects: each A object to the B object it shares most clauses with ("none" to "none").
  const overlap = new Map<string, Map<string, number>>()
  for (const u of units) {
    const x = ownerA.get(u), y = ownerB.get(u)
    if (!x || !y) continue
    const row = overlap.get(x) ?? new Map<string, number>()
    row.set(y, (row.get(y) ?? 0) + 1)
    overlap.set(x, row)
  }
  const pairs = [...overlap.entries()].flatMap(([x, row]) => [...row.entries()].map(([y, n]) => ({ x, y, n }))).sort((p, q) => q.n - p.n)
  const toB = new Map<string, string>(), takenB = new Set<string>()
  for (const p of pairs) {
    if (toB.has(p.x) || takenB.has(p.y) || (p.x === NONE) !== (p.y === NONE)) continue
    toB.set(p.x, p.y)
    takenB.add(p.y)
  }
  const toA = new Map([...toB.entries()].map(([x, y]) => [y, x]))
  const count = (m: Map<string, string | undefined>, id: string) => [...m.values()].filter(v => v === id).length
  const matching = [...a.objects.keys(), NONE].filter(x => count(ownerA, x)).map(x => {
    const y = toB.get(x)
    const shared = y ? units.filter(u => ownerA.get(u) === x && ownerB.get(u) === y).length : 0
    return { a: side(a, x), b: y ? side(b, y) : null, shared, a_only: count(ownerA, x) - shared, b_only: y ? count(ownerB, y) - shared : 0 }
  })
  const same = (u: string) => { const x = ownerA.get(u), y = ownerB.get(u); return x === undefined && y === undefined ? true : x !== undefined && y !== undefined && toB.get(x) === y }

  // Clause level, and the coarsest block whose clauses all disagree the same way.
  const differing = units.filter(u => !same(u))
  const ownership = group(u => !same(u), u => `${ownerA.get(u)}|${ownerB.get(u)}`).map(g => ({ block: g.block, a: side(a, ownerA.get(g.first)), b: side(b, ownerB.get(g.first)) }))
  // Block level: a paragraph (or a section with no paragraphs) agrees when all its clauses do.
  const blockUnits = rounds.flatMap(n => a.sources.get(n)?.blocks.filter(x => x.level === "paragraph" || (x.level === "section" && !x.children.length)).map(x => x.id) ?? [])
  const blocksAgree = blockUnits.filter(x => leavesUnder(a, x).every(same)).length

  // Revisions, clause by clause.
  const modA = modifiedKind(a), modB = modifiedKind(b)
  const modifications = group(u => (modA.get(u) ?? null) !== (modB.get(u) ?? null), u => `${modA.get(u)}|${modB.get(u)}`).map(g => ({ block: g.block, a: modA.get(g.first) ?? null, b: modB.get(g.first) ?? null }))

  return { rounds: [...rounds], matching, clauses: { total: units.length, agree: units.length - differing.length }, blocks: { total: blockUnits.length, agree: blocksAgree }, ownership, modifications }
}

export function renderComparison(c: Comparison, labels: { a: string; b: string }): string {
  const s = (x: Side | null) => x ? `${x.id} ${x.name}` : "—"
  return [
    `# Attribution comparison: ${labels.a} (A) and ${labels.b} (B), rounds ${c.rounds[0]}–${c.rounds.at(-1)}`,
    "",
    `Clauses agreeing: ${c.clauses.agree}/${c.clauses.total}. Blocks (paragraphs) agreeing: ${c.blocks.agree}/${c.blocks.total}.`,
    "",
    "## Object matching", "", "| A | B | shared clauses | A only | B only |", "|---|---|---|---|---|",
    ...c.matching.map(m => `| ${s(m.a)} | ${s(m.b)} | ${m.shared} | ${m.a_only} | ${m.b_only} |`),
    "", `## Ownership disagreements (${c.ownership.length})`, "", "| block | A | B |", "|---|---|---|",
    ...c.ownership.map(o => `| ${o.block} | ${s(o.a)} | ${s(o.b)} |`),
    "", `## Revision disagreements (${c.modifications.length})`, "", "| block | A | B |", "|---|---|---|",
    ...c.modifications.map(m => `| ${m.block} | ${m.a ?? "—"} | ${m.b ?? "—"} |`),
    "",
  ].join("\n")
}
