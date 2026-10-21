import { LEVEL_RANK, splitRound, type Level, type RoundSource, type SourceBlock, type SplitOptions } from "./source.js"

/**
 * Exp2 object registry (DESIGN §4.4, §5). The model decides which object each block belongs to and what kind of
 * change it is; this module only replays those accepted decisions. Objects, versions, block states and change
 * records are all derived from the source log and the accepted answers, so they are never stored twice.
 */

export type ChangeType = "add" | "revise" | "withdraw" | "partial"

export interface Override {
  /** Earlier-round units whose content the new text overrides, in part. */
  old: string[]
  /** Units of this round's block that do the overriding. */
  by: string[]
}

export interface Assignment {
  block: string
  /** An existing object, or null with `new_object` set, or both null with change "none" (text that is no requirement). */
  object_id: string | null
  new_object: string | null
  change: ChangeType | "none"
  /** Earlier-round units this block wholly replaces (revise) or removes (withdraw). */
  replaces: string[]
  overrides: Override[]
  note: string | null
}

/**
 * An edge from a block of this round to what its wording names (DESIGN §4.3). refers_to: the block uses something
 * another block defines (later: checks go stale when that block is revised); the named object gets no change.
 * applies_to: the block's requirement also lands on another object, which gets a change record from this block.
 * `to` is a block id or an object id (DESIGN §12d item 1). The block keeps its one owner either way.
 */
export interface Reference { from: string; to: string; kind: "refers_to" | "applies_to" }
export interface Interpretation { blocks: string[]; text: string }

export interface AttributionAnswer {
  assignments: Assignment[]
  references: Reference[]
  interpretations: Interpretation[]
}

/**
 * amended (DESIGN §12d item 6): a block that cannot be cut (a code block, a table, a JSON sample) revised by newer
 * text. It stays in the object's current text, next to the text that amends it; where they differ, the newer wins.
 */
export type BlockState = "active" | "partially_modified" | "amended" | "superseded" | "withdrawn"

/** Blocks that have no smaller units for a revision to name. */
export const UNCUTTABLE_KINDS = new Set(["code", "table"])

/** States whose text is still part of the object's current text. */
export const LIVE_STATES = new Set<BlockState>(["active", "partially_modified", "amended"])

export interface Modification {
  round: number
  change: string
  kind: "revise" | "withdraw" | "partial"
  /** The owned block itself or units inside it. */
  parts: string[]
  /** The new units, and the object that owns them (which may be another object). */
  by: string[]
  by_object: string
  /**
   * Parts that cannot be cut (code blocks, tables) and were revised, not withdrawn: amended, not replaced. They stay
   * in force next to `by`; where the two differ, `by` wins (DESIGN §12d item 6).
   */
  amended?: string[]
}

export interface Ownership {
  block: string
  round: number
  level: Level
  object: string
  state: BlockState
  modifications: Modification[]
}

export interface ObjectRecord {
  id: string
  name: string
  created_round: number
  version: number
  blocks: Ownership[]
  history: { round: number; version: number; change: string }[]
}

export interface ChangeEntry {
  block: string
  type: ChangeType
  replaces: string[]
  overrides: Override[]
}

export interface ChangeRecord {
  id: string
  round: number
  object: string
  from_version: number
  to_version: number
  types: (ChangeType | "applies_to")[]
  /** Blocks of this round given to the object. */
  entries: ChangeEntry[]
  /** Earlier blocks of this object that this round replaced, removed or overrode, whoever owns the new text. */
  received: Modification[]
  /** Blocks of this round, owned by another object, whose requirement also applies to this one. */
  applied: { from: string; by_object: string }[]
}

export interface RoundAcceptance {
  round: number
  answer: AttributionAnswer
  /** New-object names of this round mapped to the ids the code allocated, in allocation order. */
  allocated: { name: string; id: string }[]
}

/** Reserved (DESIGN §4.2): split/merge suspicion signals are recorded only; nothing computes or acts on them yet. */
export interface Signal {
  kind: "split_suspect" | "merge_suspect"
  round: number
  objects: string[]
  basis: string
}

export class Registry {
  readonly sources = new Map<number, RoundSource>()
  readonly blocks = new Map<string, SourceBlock>()
  readonly objects = new Map<string, ObjectRecord>()
  readonly changes: ChangeRecord[] = []
  readonly references: (Reference & { round: number })[] = []
  readonly interpretations: (Interpretation & { round: number })[] = []
  /** Every assigned block, to its object id or "none". */
  readonly assigned = new Map<string, string>()
  allocatedCount = 0

  addSource(source: RoundSource): void {
    if (this.sources.has(source.round)) throw new Error(`Round ${source.round} source is already registered`)
    this.sources.set(source.round, source)
    for (const b of source.blocks) this.blocks.set(b.id, b)
  }

  block(id: string): SourceBlock | undefined { return this.blocks.get(id) }

  /** The block itself and its ancestors, nearest first. */
  lineage(id: string): SourceBlock[] {
    const out: SourceBlock[] = []
    for (let b = this.blocks.get(id); b; b = b.parent ? this.blocks.get(b.parent) : undefined) out.push(b)
    return out
  }

  /** The assigned block that covers `id` (itself or an ancestor), with its owner. */
  coverOf(id: string): { block: string; owner: string } | undefined {
    for (const b of this.lineage(id)) {
      const owner = this.assigned.get(b.id)
      if (owner !== undefined) return { block: b.id, owner }
    }
    return undefined
  }

  ownership(id: string): Ownership | undefined {
    const cover = this.coverOf(id)
    if (!cover || cover.owner === "none") return undefined
    return this.objects.get(cover.owner)!.blocks.find(o => o.block === cover.block)
  }

  /**
   * The text an edge points at: the block itself, or for an object id the object's text as it stood in the edge's
   * round (its blocks from that round or earlier). A revision of any of it later is a revision of what is referred to.
   */
  referredText(edge: Reference & { round: number }): string[] {
    if (!/^O\d+$/u.test(edge.to)) return [edge.to]
    return (this.objects.get(edge.to)?.blocks ?? []).filter(b => b.round <= edge.round).map(b => b.block)
  }

  /** The object an applies_to edge lands on: an object id, or the owner of the named block. */
  appliesTo(to: string): string | undefined {
    if (/^O\d+$/u.test(to)) return this.objects.has(to) ? to : undefined
    const owner = this.coverOf(to)?.owner
    return owner && owner !== "none" ? owner : undefined
  }

  objectByName(name: string): ObjectRecord | undefined {
    const key = nameKey(name)
    return [...this.objects.values()].find(o => nameKey(o.name) === key)
  }

  roundScope(round: number): ChangeRecord[] {
    return this.changes.filter(c => c.round === round)
  }

  /** Replays one accepted round. Callers must have checked the answer against the registry as it was before. */
  apply(acceptance: RoundAcceptance): void {
    const { round, answer, allocated } = acceptance
    const ids = new Map(allocated.map(a => [nameKey(a.name), a.id]))
    const objectOf = (a: Assignment) => a.object_id ?? ids.get(nameKey(a.new_object!))!
    for (const { name, id } of allocated) {
      if (this.objects.has(id) || Number(id.slice(1)) !== this.allocatedCount + 1) throw new Error(`Object id ${id} is out of sequence`)
      this.allocatedCount++
      this.objects.set(id, { id, name: name.trim(), created_round: round, version: 0, blocks: [], history: [] })
    }
    const entries = new Map<string, ChangeEntry[]>()
    const received = new Map<string, Modification[]>()
    const pending: { target: string; mod: Omit<Modification, "change" | "parts"> }[] = []
    for (const a of answer.assignments) {
      if (a.change === "none") { this.assigned.set(a.block, "none"); continue }
      const object = objectOf(a)
      const record = this.objects.get(object)
      if (!record) throw new Error(`Unknown object ${object}`)
      this.assigned.set(a.block, object)
      record.blocks.push({ block: a.block, round, level: this.blocks.get(a.block)!.level, object, state: "active", modifications: [] })
      entries.set(object, [...(entries.get(object) ?? []), { block: a.block, type: a.change, replaces: a.replaces, overrides: a.overrides }])
      const kind = a.change === "withdraw" ? "withdraw" : "revise"
      for (const target of a.replaces) pending.push({ target, mod: { round, kind, by: [a.block], by_object: object } })
      for (const o of a.overrides) for (const target of o.old) pending.push({ target, mod: { round, kind: "partial", by: o.by, by_object: object } })
    }
    // Group the targets by the earlier ownership they fall in; one modification per (ownership, new text, kind).
    const grouped = new Map<string, { own: Ownership; mod: Omit<Modification, "change" | "parts">; parts: string[] }>()
    for (const { target, mod } of pending) {
      const own = this.ownership(target)
      if (!own || own.round >= round) throw new Error(`Target ${target} is not owned by an earlier object block`)
      const key = `${own.block}|${mod.kind}|${mod.by.join(",")}`
      const g = grouped.get(key) ?? { own, mod, parts: [] }
      if (!g.parts.includes(target)) g.parts.push(target)
      grouped.set(key, g)
    }
    const applied = new Map<string, { from: string; by_object: string }[]>()
    for (const e of answer.references.filter(r => r.kind === "applies_to")) {
      const target = this.appliesTo(e.to)
      const by = this.coverOf(e.from)?.owner
      if (!target || !by || by === "none" || target === by) throw new Error(`applies_to ${e.from} -> ${e.to} does not name another object`)
      applied.set(target, [...(applied.get(target) ?? []), { from: e.from, by_object: by }])
    }
    const touched = new Set([...entries.keys(), ...[...grouped.values()].map(g => g.own.object), ...applied.keys()])
    const order = [...touched].sort((a, b) => Number(a.slice(1)) - Number(b.slice(1)))
    order.forEach((object, i) => {
      const record = this.objects.get(object)!
      const id = `C${round}.${i + 1}`
      const mods = [...grouped.values()].filter(g => g.own.object === object).map(g => {
        const amended = g.mod.kind === "withdraw" ? [] : g.parts.filter(p => UNCUTTABLE_KINDS.has(this.blocks.get(p)!.kind))
        const m: Modification = { ...g.mod, change: id, parts: g.parts, ...(amended.length ? { amended } : {}) }
        g.own.modifications.push(m)
        const whole = g.parts.includes(g.own.block)
        const uncuttable = UNCUTTABLE_KINDS.has(this.blocks.get(g.own.block)!.kind)
        g.own.state = whole && m.kind === "withdraw" ? "withdrawn"
          : whole && uncuttable && g.own.state !== "superseded" ? "amended"
          : whole && m.kind === "revise" ? "superseded"
          : g.own.state === "active" ? "partially_modified" : g.own.state
        return m
      })
      received.set(object, mods)
      const own = entries.get(object) ?? []
      const types = [...new Set<ChangeType | "applies_to">([...own.map(e => e.type), ...mods.map(m => m.kind), ...(applied.has(object) ? ["applies_to" as const] : [])])].sort()
      const from = record.version
      record.version++
      record.history.push({ round, version: record.version, change: id })
      this.changes.push({ id, round, object, from_version: from, to_version: record.version, types, entries: own, received: mods, applied: applied.get(object) ?? [] })
    })
    for (const r of answer.references) this.references.push({ ...r, round })
    for (const n of answer.interpretations) this.interpretations.push({ ...n, round })
  }

  /** Assigned leaves and their parents must cover every block of a round exactly once. */
  coverageProblems(round: number): string[] {
    const source = this.sources.get(round)
    if (!source) return [`Round ${round} has no source`]
    const problems: string[] = []
    for (const b of source.blocks) {
      const covers = this.lineage(b.id).filter(x => this.assigned.has(x.id))
      if (covers.length > 1) problems.push(`${b.id} is covered ${covers.length} times`)
      // A heading unit with other content in its section goes with that content when it has no owner.
      const optional = b.kind === "heading" && (this.blocks.get(b.parent!)?.children.length ?? 0) > 1
      if (!b.children.length && covers.length === 0 && !optional) problems.push(`${b.id} is not covered`)
    }
    return problems
  }
}

export function nameKey(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/gu, " ")
}

export function isWithin(registry: Registry, inner: string, outer: string): boolean {
  return registry.lineage(inner).some(b => b.id === outer)
}

export function finer(a: Level, b: Level): boolean { return LEVEL_RANK[a] > LEVEL_RANK[b] }

/** Rebuilds the registry from the source log and the accepted rounds, in round order. */
export function materialize(sources: readonly { round: number; text: string; hash: string }[], accepted: readonly RoundAcceptance[], options: SplitOptions = {}): Registry {
  const registry = new Registry()
  for (const s of [...sources].sort((a, b) => a.round - b.round)) {
    const split = splitRound(s.round, s.text, options)
    if (split.hash !== s.hash) throw new Error(`Round ${s.round} source hash mismatch`)
    registry.addSource(split)
  }
  for (const a of [...accepted].sort((x, y) => x.round - y.round)) registry.apply(a)
  return registry
}
