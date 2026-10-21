import type { Anchor } from "./anchors.js"
import { activeChecks, type CheckEvent, type CheckRecord } from "./checks.js"
import { LIVE_STATES, type Registry } from "./registry.js"
import type { CheckRun, ObjectStatus } from "./verdict.js"
import { contextOf } from "./view.js"

/**
 * The round's work order (DESIGN §6): five zones computed by code. Zones other than the source zone cite ids only;
 * the source text appears once, grouped by object. "Unknown" never becomes a task: only a change this round, a
 * failure judged not landed, or work a previous round left undone puts an object in the task zone.
 */

/**
 * name: the anchor's name is the object's (code); step: the executor reported it for the object and the step did
 * change it; shared: a step changed it and it is neither named for nor reported by one of the step's objects, so
 * it belongs to all of them together (DESIGN §12d item 9).
 */
export interface AnchorLink { object: string; anchor: string; round: number; via: "name" | "step" | "shared"; step?: string }

export interface TaskEntry {
  object: string
  name: string
  version: number
  why: ("changed" | "not_landed" | "carried" | "convention")[]
  /** This round's change record, when changed. */
  change: string | null
  /** Failing checks judged not landed: the input and what the program did, against what was expected. */
  evidence: { check: string; reason: string; args: string[]; files: string[]; mismatches: { assertion: string; expected: unknown; actual: unknown; reading?: string }[] }[]
  /** The step of a previous round that did not finish this object. */
  carried_from: string | null
  /** "Affected by a convention revision" (DESIGN §4.5): the revised conventions and this object's checks they staled. */
  conventions: { convention: string; checks: string[] }[]
}

export interface WorkOrder {
  round: number
  task: TaskEntry[]
  protect: { object: string; name: string; checks: string[]; shared_anchors: string[] }[]
  /** readings: failures resting on a reading the text does not state, with that reading (DESIGN §12d item 10). */
  status: { object: string; name: string; reasons: string[]; unknown_checks: string[]; readings?: { check: string; assertion: string; reading: string; expected: unknown; actual: unknown }[] }[]
  /** The whole source, each assigned block once, grouped by object (null: text that is no requirement). */
  source: { object: string | null; name: string; blocks: { id: string; state: string; heading_path: string[]; text: string }[] }[]
  anchors: { object: string; anchors: { id: string; file: string; lines: string }[]; last_steps: { step: string; round: number; status: string; anchors: string[] }[] }[]
  /** Edges of task objects, for reference only (never an order constraint). */
  edges: { from: string; to: string; kind: string }[]
}

export interface PreviousStep { id: string; round: number; status: string; objects: { object: string; coverage: "full" | "partial" }[]; anchors: string[] }

export interface WorkOrderInput {
  registry: Registry
  round: number
  library: readonly CheckRecord[]
  events: readonly CheckEvent[]
  /** The statuses and runs of the program as it stands at the start of this round (last round's verdict). */
  statuses: readonly ObjectStatus[]
  runs: readonly CheckRun[]
  anchors: readonly Anchor[]
  links: readonly AnchorLink[]
  /** Execution steps of earlier rounds; the previous round's unfinished objects are carried into the task zone. */
  steps: readonly PreviousStep[]
  /** Objects in the previous round's task zone. */
  previous_task: readonly string[]
  /**
   * Ablation switch for zoning (DESIGN §12b item 14, §6): false puts every live object in the task zone, so nothing
   * is protection or status. Default true.
   */
  zoning?: boolean
}

/**
 * An object's anchors now: dispatch points named like the object, and anchors linked to it by name or by a verified
 * step report. With `shared`, also anchors a step changed for it together with other objects: those count when
 * code is shared (protection, whether a step touched the object), not as the object's own.
 */
export function objectAnchors(registry: Registry, anchors: readonly Anchor[], links: readonly AnchorLink[], object: string, shared = false): Anchor[] {
  const name = registry.objects.get(object)?.name.toLowerCase()
  const linked = new Set(links.filter(l => l.object === object && (shared || l.via !== "shared")).map(l => l.anchor))
  return anchors.filter(a => a.kind !== "file" && (linked.has(a.id) || (a.kind === "dispatch" && a.name.toLowerCase() === name)))
}

export function nameLinks(registry: Registry, anchors: readonly Anchor[], round: number): AnchorLink[] {
  const byName = new Map([...registry.objects.values()].map(o => [o.name.toLowerCase(), o.id]))
  return anchors.filter(a => a.kind === "dispatch" && byName.has(a.name.toLowerCase())).map(a => ({ object: byName.get(a.name.toLowerCase())!, anchor: a.id, round, via: "name" as const }))
}

export function buildWorkOrder(input: WorkOrderInput): WorkOrder {
  const { registry, round } = input
  const name = (id: string) => registry.objects.get(id)!.name
  const status = new Map(input.statuses.map(s => [s.object, s]))
  const checks = new Map(input.library.map(c => [c.id, c]))
  const tasks = new Map<string, TaskEntry>()
  const entry = (object: string): TaskEntry => {
    const o = registry.objects.get(object)!
    const t = tasks.get(object) ?? { object, name: o.name, version: o.version, why: [], change: null, evidence: [], carried_from: null, conventions: [] }
    tasks.set(object, t)
    return t
  }
  for (const c of registry.roundScope(round)) { const t = entry(c.object); t.why.push("changed"); t.change = c.id }
  for (const s of input.statuses) {
    if (s.status !== "not_landed" || !registry.objects.has(s.object)) continue
    const t = entry(s.object)
    t.why.push("not_landed")
    for (const id of s.not_landed) {
      const run = input.runs.find(r => r.check === id && r.failure?.class === "not_landed")
      const k = checks.get(id)
      if (!run || !k) continue
      t.evidence.push({
        check: id, reason: run.failure!.reason, args: k.input.args, files: k.input.files.map(f => f.path),
        mismatches: run.assertions.filter(a => !a.ok).map(a => { const x = k.assertions.find(y => y.id === a.id); return { assertion: a.id, expected: x?.expect, actual: a.actual, ...(x?.reading ? { reading: x.reading } : {}) } }),
      })
    }
  }
  // Objects whose checks went stale because a convention they use was revised this round.
  for (const e of input.events.filter(x => x.round === round && x.status === "stale" && x.cause?.kind === "convention")) {
    const k = checks.get(e.check)
    if (!k || !registry.objects.has(k.object)) continue
    const t = entry(k.object)
    if (!t.why.includes("convention")) t.why.push("convention")
    const c = t.conventions.find(x => x.convention === e.cause!.source) ?? (t.conventions.push({ convention: e.cause!.source, checks: [] }), t.conventions.at(-1)!)
    c.checks.push(e.check)
  }
  // Work a previous round left undone: in its task zone, no committed step covered it fully, and not landed.
  const done = new Set(input.steps.filter(s => s.round === round - 1 && s.status === "committed").flatMap(s => s.objects.filter(o => o.coverage === "full").map(o => o.object)))
  for (const object of input.previous_task) {
    // Landed by its checks is done, whatever the steps were.
    if (done.has(object) || !registry.objects.has(object) || status.get(object)?.status === "landed") continue
    const t = entry(object)
    if (!t.why.includes("carried")) t.why.push("carried")
    t.carried_from = input.steps.filter(s => s.round === round - 1 && s.objects.some(o => o.object === object)).at(-1)?.id ?? `R${round - 1} task zone`
  }
  if (input.zoning === false) for (const o of registry.objects.values()) if (o.blocks.some(b => LIVE_STATES.has(b.state))) entry(o.id)
  // Failures that rest on an unstated reading go next to the evidence of objects that are tasks anyway, marked as
  // such; they make nothing a task (DESIGN §12d item 10).
  for (const run of input.runs.filter(r => r.failure?.reason === "reading")) {
    const k = checks.get(run.check), t = k && tasks.get(k.object)
    if (!k || !t) continue
    t.evidence.push({
      check: run.check, reason: "reading", args: k.input.args, files: k.input.files.map(f => f.path),
      mismatches: run.assertions.filter(a => !a.ok).map(a => { const x = k.assertions.find(y => y.id === a.id); return { assertion: a.id, expected: x?.expect, actual: a.actual, ...(x?.reading ? { reading: x.reading } : {}) } }),
    })
  }
  const task = [...tasks.values()].sort((a, b) => Number(a.object.slice(1)) - Number(b.object.slice(1)))
  const inTask = new Set(task.map(t => t.object))

  // Protection: landed objects whose anchors the task objects share, with their passing checks.
  const taskAnchors = new Set(task.flatMap(t => objectAnchors(registry, input.anchors, input.links, t.object, true).map(a => a.id)))
  const active = activeChecks(input.library, input.events)
  const protect = input.statuses.filter(s => s.status === "landed" && !inTask.has(s.object)).flatMap(s => {
    const shared = objectAnchors(registry, input.anchors, input.links, s.object, true).map(a => a.id).filter(a => taskAnchors.has(a))
    if (!shared.length) return []
    const passing = input.runs.filter(r => r.outcome === "pass" && active.some(c => c.id === r.check && (c.object === s.object || c.uses.includes(s.object)))).map(r => r.check)
    return [{ object: s.object, name: name(s.object), checks: [...new Set(passing)], shared_anchors: shared }]
  })

  const statusZone = input.statuses.filter(s => s.status === "unknown" && !inTask.has(s.object) && registry.objects.has(s.object))
    .map(s => {
      const readings = s.unknown.flatMap(id => {
        const run = input.runs.find(r => r.check === id && r.failure?.reason === "reading"), k = checks.get(id)
        return run && k ? run.assertions.filter(a => !a.ok).map(a => { const x = k.assertions.find(y => y.id === a.id)!; return { check: id, assertion: a.id, reading: x.reading ?? "", expected: x.expect, actual: a.actual } }) : []
      })
      return { object: s.object, name: name(s.object), reasons: s.reasons, unknown_checks: s.unknown, ...(readings.length ? { readings } : {}) }
    })

  // Source zone: every assigned block once, in its object's group, in round and document order.
  const groups = new Map<string | null, { id: string; state: string; heading_path: string[]; text: string }[]>()
  // An amended block names the newer text that amends it; both stay in the source zone, and the newer wins.
  const amendedBy = (b: (typeof registry.objects extends Map<string, infer O> ? O : never)["blocks"][number]) => b.modifications.filter(m => m.amended?.length).map(m => `${m.amended!.join(", ")} amended by ${m.by.join(", ")}`)
  const states = new Map([...registry.objects.values()].flatMap(o => o.blocks.map(b => {
    const notes = b.state === "amended" ? [`amended by ${[...new Set(b.modifications.flatMap(m => m.by))].join(", ")}`] : amendedBy(b)
    return [b.block, notes.length ? `${b.state === "amended" ? "" : `${b.state}; `}${notes.join("; ")}; where they differ, the newer text wins` : b.state] as const
  })))
  for (const source of [...registry.sources.values()].filter(s => s.round <= round).sort((a, b) => a.round - b.round)) {
    for (const b of source.blocks) {
      const owner = registry.assigned.get(b.id)
      if (owner === undefined) continue
      const key = owner === "none" ? null : owner
      const ctx = contextOf(registry, b.id)
      const path = registry.lineage(ctx.id).slice(ctx.level === "section" ? 1 : 0).filter(x => x.level === "section" && x.heading).map(x => x.heading!.trim()).reverse()
      groups.set(key, [...(groups.get(key) ?? []), { id: b.id, state: states.get(b.id) ?? "none", heading_path: path, text: markRevisions(registry, b.id, round) }])
    }
  }
  const order = [...groups.keys()].sort((a, b) => a === null ? 1 : b === null ? -1 : Number(a.slice(1)) - Number(b.slice(1)))
  const source = order.map(k => ({ object: k, name: k === null ? "(no requirement)" : name(k), blocks: groups.get(k)! }))

  const anchorZone = [...task.map(t => t.object), ...protect.map(p => p.object)].map(object => ({
    object,
    anchors: objectAnchors(registry, input.anchors, input.links, object).map(a => ({ id: a.id, file: a.file, lines: `${a.start_line}-${a.end_line}` })),
    last_steps: input.steps.filter(s => s.objects.some(o => o.object === object)).slice(-3).map(s => ({ step: s.id, round: s.round, status: s.status, anchors: s.anchors })),
  }))
  const edges = registry.references.filter(e => e.round <= round).filter(e => {
    const from = registry.coverOf(e.from)?.owner
    const to = /^O\d+$/u.test(e.to) ? e.to : registry.coverOf(e.to)?.owner
    return (from && inTask.has(from)) || (to && inTask.has(to))
  }).map(e => ({ from: e.from, to: e.to, kind: e.kind }))
  return { round, task, protect, status: statusZone, source, anchors: anchorZone, edges }
}

/**
 * The block's text with a marker where later text revised it (DESIGN §12d item 8), up to `round`: at the revised
 * sentence, clause, code block or table, `⟦<id> → revised by <ids>⟧` (or amended, withdrawn). The text itself is
 * neither copied nor rewritten; the revising text is in the source zone under its own id.
 */
export function markRevisions(registry: Registry, block: string, round: number): string {
  const b = registry.block(block)!
  const own = registry.objects.get(registry.assigned.get(block) ?? "")?.blocks.find(x => x.block === block)
  const marks = new Map<number, string[]>()
  for (const m of own?.modifications.filter(x => x.round <= round) ?? []) for (const p of m.parts) {
    const part = registry.block(p)
    if (!part || part.start < b.start || part.end > b.end) continue
    const how = (m.amended ?? []).includes(p) ? "amended" : m.kind === "withdraw" ? "withdrawn" : "revised"
    const at = part.start - b.start
    marks.set(at, [...(marks.get(at) ?? []), `⟦${p} → ${how} by ${m.by.join(", ")}⟧`])
  }
  let text = b.text
  for (const at of [...marks.keys()].sort((x, y) => y - x)) text = `${text.slice(0, at)}${marks.get(at)!.join("")} ${text.slice(at)}`
  return text
}

/** The work order as the executor reads it. Only the source zone carries source text. */
export function renderWorkOrder(w: WorkOrder): string {
  const out: string[] = [`# Work order, round ${w.round}`, ""]
  out.push("## Task zone (must do)", "")
  for (const t of w.task) {
    out.push(`- ${t.object} ${t.name} @v${t.version}: ${t.why.join(", ")}${t.change ? ` (${t.change})` : ""}${t.carried_from ? ` (left undone by ${t.carried_from})` : ""}`)
    for (const c of t.conventions) out.push(`  - affected by the revision of convention ${c.convention} (checks ${c.checks.join(", ")} to be derived again)`)
    for (const e of t.evidence) out.push(`  - ${e.reason === "reading" ? "failing, not counted against the program" : "failing"} ${e.check} (${e.reason}): args ${JSON.stringify(e.args)}; ${e.mismatches.map(m => `${m.assertion} expected ${JSON.stringify(m.expected)}, got ${JSON.stringify(m.actual)}${m.reading ? ` (this expectation rests on a reading the text does not state: ${m.reading})` : ""}`).join("; ")}`)
  }
  out.push("", "## Protection zone (must not break; these checks are rerun)", "")
  for (const p of w.protect) out.push(`- ${p.object} ${p.name}: checks ${p.checks.join(", ") || "(none)"}; shared anchors ${p.shared_anchors.join(", ")}`)
  out.push("", "## Status zone (for information, not tasks)", "")
  for (const s of w.status) {
    out.push(`- ${s.object} ${s.name}: unknown (${s.reasons.join(", ") || "no reason recorded"})`)
    for (const r of s.readings ?? []) out.push(`  - ${r.check} ${r.assertion} expected ${JSON.stringify(r.expected)}, got ${JSON.stringify(r.actual)}; the expectation rests on a reading the text does not state: ${r.reading}`)
  }
  out.push("", "## Anchor zone", "")
  for (const a of w.anchors) out.push(`- ${a.object}: ${a.anchors.map(x => `${x.id} (${x.file}:${x.lines})`).join(", ") || "(no anchors yet)"}${a.last_steps.length ? `; last steps ${a.last_steps.map(s => `${s.step} ${s.status}`).join(", ")}` : ""}`)
  if (w.edges.length) out.push("", "Edges (reference only): " + w.edges.map(e => `${e.from} ${e.kind} ${e.to}`).join("; "))
  out.push("", "## Source zone (the requirements; the only authority)", "")
  for (const g of w.source) {
    out.push(`### ${g.object ?? "—"} ${g.name}`, "")
    for (const b of g.blocks) out.push(`[${b.id}${b.state !== "active" && b.state !== "none" ? ` · ${b.state}` : ""}${b.heading_path.length ? ` · ${b.heading_path.join(" › ")}` : ""}]`, b.text.trimEnd(), "")
  }
  return out.join("\n") + "\n"
}
