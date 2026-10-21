import { createHash } from "node:crypto"
import { requestJson } from "../model/opencode-transport.js"
import { annotate, parseRef, roundOf, type RoundSource, type SourceBlock } from "./source.js"
import { isWithin, LIVE_STATES, nameKey, type Assignment, type AttributionAnswer, type Override, type Reference, type Registry, type RoundAcceptance } from "./registry.js"

/**
 * Exp2 attribution step (DESIGN §4.2–§4.4): the model reads the full source and gives each block of the new round
 * an object and a change type; the code checks only what is certain (ids exist, each block covered once, ranges
 * valid, new names free) and sends the concrete problems back for a patch of the same answer, a bounded number of
 * times. Which object a block belongs to, and whether it revises or adds, is never second-guessed here.
 */

export interface ObjectBrief {
  id: string
  name: string
  version: number
  /** Blocks the object currently holds (active or partially modified). */
  blocks: string[]
  /** Parts of those blocks already replaced or overridden by later text; cite the newer text instead. */
  modified?: string[]
  /** Code blocks and tables amended by later text: still in force, the newer text winning where they differ. */
  amended?: string[]
}

/**
 * One request shape for the first answer and every repair (DESIGN §4.6): the first answer is a patch on an empty
 * draft. Serialised with `requestJson`, the source comes first, then the stable parts, and the per-attempt fields
 * (`issues`, `previous_draft`) last, so a repair repeats the first call's opening byte for byte.
 */
export interface AttributionRequest {
  round: number
  /** All rounds so far, annotated with block ids; the new round is last. */
  sources: string
  /** The new round's sections and paragraphs, with unit counts, to cover. */
  outline: string[]
  objects: ObjectBrief[]
  /** Existing objects whose name the new round's text mentions, and where (found by name only). */
  candidates: { object: string; name: string; mentioned_in: string[] }[]
  /** What the code found wrong with the draft; empty on the first call. */
  issues: Issue[]
  /** The answer so far; empty on the first call. */
  previous_draft: AttributionAnswer
}

/** Kept as an alias: every call is the same request. */
export type ModelRequest = AttributionRequest

export interface AnswerPatch {
  /** Replace the assignment of the same block, or add it. */
  upsert: Assignment[]
  /** Blocks whose assignment is removed. */
  remove: string[]
  edges_add: Reference[]
  edges_remove: Reference[]
  interpretations_add: AttributionAnswer["interpretations"]
}

export const EMPTY_DRAFT: AttributionAnswer = { assignments: [], references: [], interpretations: [] }

export interface TokenUsage {
  input_tokens: number
  cache_read_tokens: number
  cache_write_tokens: number
  output_tokens: number
  reasoning_tokens: number
}

export interface ModelReply {
  text: string
  usage?: Partial<TokenUsage>
  /** True for a fixed offline answer; its usage is zero and not a measurement. */
  stub?: boolean
  model?: string
  provider?: string
  started_at?: string
  completed_at?: string
  schema_errors?: string[]
}

export type AttributionTransport = (request: ModelRequest) => Promise<ModelReply>

/**
 * The provider's quota is spent (DESIGN §14): not a failed answer. The step stops, records what it spent, and the
 * serial resumes from the round's checkpoint later. Any other transport failure (a watchdog stop included) counts
 * as one attempt within the step's repair limit.
 */
export class QuotaExhausted extends Error {}

/** The provider no longer accepts the login (an invalidated OAuth token, a revoked key): the serial stops and reports. */
export class AuthInvalid extends Error {}

/** A replayed run asked something the recording does not hold: the run stops; it never falls back to a stand-in. */
export class ReplayMiss extends Error {}

export type IssueCode =
  | "unparseable" | "shape" | "unknown_block" | "not_this_round" | "hash_mismatch" | "duplicate" | "overlap" | "uncovered"
  | "object_choice" | "unknown_object" | "name_taken" | "change_shape" | "range_invalid" | "target_unknown"
  | "target_not_earlier" | "target_unowned" | "target_replaced" | "by_outside_block" | "reference_invalid" | "transport" | "quota" | "auth"

/** One problem; when one root cause affects several blocks, a single issue names them all in `blocks`. */
export interface Issue { code: IssueCode; block?: string; blocks?: string[]; message: string }

export interface ModelCallRecord {
  id: string
  round: number
  stage: "understand"
  step: "attribution"
  /** The first call (a patch on the empty draft) or a repair. */
  kind: "attribute" | "repair"
  attempt: number
  request: ModelRequest
  request_chars: number
  request_sha256: string
  response_text: string
  issues: Issue[]
  usage: TokenUsage
  stub: boolean
  /** A real call whose usage was not reported (a recording without usage): its zeros are not a measurement. */
  usage_unknown?: boolean
  model?: string
  provider?: string
  started_at?: string
  completed_at?: string
  schema_errors?: string[]
  /** The transport failed; nothing was answered. */
  error?: string
}

export interface AttributionOutcome {
  status: "accepted" | "failed" | "interrupted"
  acceptance?: RoundAcceptance
  calls: ModelCallRecord[]
  issues: Issue[]
}

const CHANGES = ["add", "revise", "withdraw", "partial", "none"] as const

// ---------------------------------------------------------------- request

export function buildRequest(registry: Registry, round: number, previous: AttributionAnswer = EMPTY_DRAFT, issues: Issue[] = []): AttributionRequest {
  const source = registry.sources.get(round)
  if (!source) throw new Error(`Round ${round} has no source`)
  const rounds = [...registry.sources.values()].filter(s => s.round <= round).sort((a, b) => a.round - b.round)
  const sources = rounds.map(s => `===== R${s.round} =====\n${annotate(s)}`).join("\n")
  const objects = [...registry.objects.values()].map((o): ObjectBrief => {
    const live = o.blocks.filter(b => LIVE_STATES.has(b.state))
    const amended = [...new Set(live.flatMap(b => b.modifications.flatMap(m => m.amended ?? [])))]
    const modified = live.flatMap(b => b.modifications.flatMap(m => m.parts.filter(p => !(m.amended ?? []).includes(p))))
    return { id: o.id, name: o.name, version: o.version, blocks: live.map(b => b.block), ...(modified.length ? { modified } : {}), ...(amended.length ? { amended } : {}) }
  })
  // The model reads an issue's message, which names its blocks; the `blocks` list is for code and is not sent twice.
  const sent = issues.map(({ blocks: _, ...i }) => i)
  return { round, sources, outline: outline(source), objects, candidates: candidates(registry, source), issues: sent, previous_draft: previous }
}

function outline(source: RoundSource): string[] {
  const byId = new Map(source.blocks.map(b => [b.id, b]))
  return source.blocks.filter(b => b.level === "section").map(s => {
    const paras = s.children.map(id => byId.get(id)!).filter(b => b.level === "paragraph" && b.kind !== "heading")
    const head = s.heading ?? "(text before the first heading)"
    return `${s.id} ${head}${paras.length ? ": " + paras.map(p => `${p.id.slice(s.id.length + 1)}(${p.children.length})`).join(" ") : ""}`
  })
}

/** Existing objects whose name occurs as a word in a paragraph of the new round. Matching is by name only. */
export function candidates(registry: Registry, source: RoundSource): AttributionRequest["candidates"] {
  const paragraphs = source.blocks.filter(b => b.level === "paragraph" || (b.level === "section" && b.heading))
  return [...registry.objects.values()].flatMap(o => {
    const pattern = namePattern(o.name)
    if (!pattern) return []
    const hits = paragraphs.filter(b => pattern.test(b.level === "section" ? b.heading! : b.text)).map(b => b.id)
    return hits.length ? [{ object: o.id, name: o.name, mentioned_in: hits }] : []
  })
}

function namePattern(name: string): RegExp | null {
  const words = name.trim().split(/\s+/u).filter(Boolean).map(w => w.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"))
  if (!words.length) return null
  return new RegExp(`(?<![\\p{L}\\p{N}_-])${words.join("[\\s`\"']+")}(?![\\p{L}\\p{N}_])`, "iu")
}

// ---------------------------------------------------------------- check

/**
 * Checks an answer against the registry before this round. Returns the issues and, if there are none, the answer
 * with refs normalised (hash suffixes dropped, ranges expanded) and the new objects' ids allocated.
 */
export function checkAnswer(registry: Registry, round: number, answer: AttributionAnswer): { issues: Issue[]; acceptance?: RoundAcceptance } {
  const issues: Issue[] = []
  const source = registry.sources.get(round)!
  const add = (code: IssueCode, message: string, block?: string) => issues.push({ code, message, ...(block ? { block } : {}) })
  const resolve = (ref: string, where: string): string[] | null => {
    const range = /^(.*\.)([sc])(\d+)\.\.(?:\2)?(\d+)$/u.exec(ref.trim())
    if (range) {
      const [, base, letter, a, b] = range
      const from = Number(a), to = Number(b)
      const ids = Array.from({ length: Math.max(0, to - from + 1) }, (_, k) => `${base}${letter}${from + k}`)
      const missing = ids.filter(id => !registry.block(id))
      if (from > to || !ids.length) { add("range_invalid", `${where}: range ${ref} is empty or reversed`); return null }
      if (missing.length) {
        const parent = registry.block(base.slice(0, -1))
        const count = parent ? parent.children.length : 0
        add("range_invalid", `${where}: range ${ref} runs past the last unit (${parent ? `${parent.id} has ${letter}1..${letter}${count}` : `${base.slice(0, -1)} does not exist`})`)
        return null
      }
      return ids
    }
    const { id, hash } = parseRef(ref)
    const block = registry.block(id)
    if (!block) { add("unknown_block", `${where}: ${id} does not exist${nearest(registry, id)}`); return null }
    if (hash !== undefined && hash !== block.hash) { add("hash_mismatch", `${where}: ${id} has hash ${block.hash}, not ${hash}`); return null }
    return [id]
  }

  // A new object has no id until the answer is accepted. An id that does not exist is one root, however many
  // assignments and edges use it (BLOCK9 §2.7): one message, naming the new objects this answer does create.
  const created = [...new Map(answer.assignments.filter(a => a.new_object?.trim()).map(a => [nameKey(a.new_object!), `"${a.new_object!.trim()}" (${a.block})`])).values()]
  const unknownUses = new Map<string, string[]>()
  const noSuchObject = (id: string, where: string) => { unknownUses.set(id, [...(unknownUses.get(id) ?? []), where]) }
  const createdNames = new Set(answer.assignments.filter(a => a.new_object?.trim()).map(a => nameKey(a.new_object!)))

  // Assignments: ids, duplicates, objects, change shape.
  const assignments: Assignment[] = []
  const seen = new Map<string, number>()
  const newNames = new Map<string, string>()
  for (const [i, raw] of answer.assignments.entries()) {
    const a = { ...raw }
    const where = `assignment ${i + 1} (${a.block})`
    const ids = resolve(a.block, where)
    if (!ids) continue
    if (ids.length !== 1) { add("shape", `${where}: an assignment names one block, not a range`, a.block); continue }
    const id = ids[0]
    if (roundOf(id) !== round) { add("not_this_round", `${where}: ${id} is not a block of round ${round}; assign only this round's blocks`, id); continue }
    if (seen.has(id)) { add("duplicate", `${id} is assigned twice (assignments ${seen.get(id)! + 1} and ${i + 1}); keep one`, id); continue }
    seen.set(id, i)
    if (!CHANGES.includes(a.change)) { add("change_shape", `${where}: change must be one of ${CHANGES.join(", ")}`, id); continue }
    if (a.change === "none") {
      if (a.object_id || a.new_object || a.replaces.length || a.overrides.length) add("change_shape", `${where}: change "none" takes no object and no targets`, id)
    } else if (!!a.object_id === !!a.new_object) {
      add("object_choice", `${where}: give exactly one of object_id or new_object`, id)
    } else if (a.object_id && !registry.objects.has(a.object_id) && createdNames.has(nameKey(a.object_id))) {
      // The name of a new object of this answer, given where an id goes: it names that object.
      a.new_object = a.object_id; a.object_id = null
      if (!newNames.has(nameKey(a.new_object))) newNames.set(nameKey(a.new_object), a.new_object.trim())
    } else if (a.object_id && !registry.objects.has(a.object_id)) {
      noSuchObject(a.object_id, where)
    } else if (a.new_object) {
      const taken = registry.objectByName(a.new_object)
      if (!a.new_object.trim()) add("object_choice", `${where}: new_object needs a name`, id)
      else if (taken) add("name_taken", `${where}: an object named "${taken.name}" already exists (${taken.id}); use object_id ${taken.id} or a different name`, id)
      else if (!newNames.has(nameKey(a.new_object))) newNames.set(nameKey(a.new_object), a.new_object.trim())
    }
    const targets = a.replaces.length + a.overrides.length
    if (a.change === "add" && targets) add("change_shape", `${where}: change "add" replaces nothing; use revise, withdraw or partial, or remove the targets`, id)
    if ((a.change === "revise" || a.change === "withdraw") && !targets) add("change_shape", `${where}: change "${a.change}" must name the earlier units it replaces`, id)
    if (a.change === "partial" && !a.overrides.length) add("change_shape", `${where}: change "partial" must give overrides (old units → new units)`, id)
    const replaces = a.replaces.flatMap(r => resolve(r, `${where} replaces`) ?? [])
    const overrides: Override[] = a.overrides.map((o, k) => {
      const w = `${where} override ${k + 1}`
      if (!o.old.length || !o.by.length) add("change_shape", `${w}: old and by must both be non-empty`, id)
      const by = o.by.flatMap(r => resolve(r, `${w} by`) ?? [])
      for (const b of by) if (!isWithin(registry, b, id)) add("by_outside_block", `${w}: ${b} is not inside ${id}; by must cite units of this assignment's block`, id)
      return { old: o.old.flatMap(r => resolve(r, `${w} old`) ?? []), by }
    })
    for (const t of [...replaces, ...overrides.flatMap(o => o.old)]) targetProblems(registry, round, t, where, add, id)
    assignments.push({ ...a, block: id, object_id: a.object_id || null, new_object: a.new_object?.trim() || null, replaces, overrides })
  }

  // Nested assignments with the same owner and the same plain change are one assignment (DESIGN §12d item 2): the
  // inner ones are dropped. Only different owners (or an inner one with its own targets) are an overlap.
  const ownerKey = (a: Assignment) => a.change === "none" ? "none" : a.object_id ?? `new:${nameKey(a.new_object ?? "")}`
  const byBlock = new Map(assignments.map(a => [a.block, a]))
  const redundant = new Set(assignments.filter(a => {
    const outer = registry.lineage(a.block).slice(1).map(b => byBlock.get(b.id)).find(Boolean)
    return outer && ownerKey(outer) === ownerKey(a) && outer.change === a.change && !a.replaces.length && !a.overrides.length
  }).map(a => a.block))
  for (let i = assignments.length - 1; i >= 0; i--) if (redundant.has(assignments[i].block)) assignments.splice(i, 1)

  // The most specific assignment wins (BLOCK9 §2.7): a block given to another owner inside an assigned block takes
  // that owner, and the outer assignment keeps the rest: it is replaced by its parts that hold no inner assignment.
  // An outer assignment that replaces or overrides earlier text cannot be split that way; it stays an overlap.
  const inner = new Set(assignments.map(a => a.block))
  const partsLeft = (id: string): string[] => {
    const b = registry.block(id)!
    const holds = (x: SourceBlock): boolean => x.children.some(c => inner.has(c) || holds(registry.block(c)!))
    if (!holds(b)) return [id]
    return b.children.filter(c => !inner.has(c)).flatMap(partsLeft)
  }
  for (let i = assignments.length - 1; i >= 0; i--) {
    const a = assignments[i]
    const holdsInner = assignments.some(x => x !== a && registry.lineage(x.block).slice(1).some(b => b.id === a.block))
    if (!holdsInner || a.replaces.length || a.overrides.length) continue
    assignments.splice(i, 1, ...partsLeft(a.block).map(block => ({ ...a, block })))
  }

  // Coverage: every block of the round exactly once.
  const assigned = new Set(assignments.map(a => a.block))
  const byId = new Map(source.blocks.map(b => [b.id, b]))
  // One issue per root cause (DESIGN §12b item 8): an assigned block with assigned blocks inside it is one overlap.
  const inside = new Map<string, string[]>()
  for (const id of assigned) {
    const above = registry.lineage(id).slice(1).find(b => assigned.has(b.id))
    if (above) inside.set(above.id, [...(inside.get(above.id) ?? []), id])
  }
  for (const [outer, ids] of inside) {
    const owner = (id: string) => { const a = byBlock.get(id)!; return a.change === "none" ? "none" : a.object_id ?? a.new_object! }
    const owners = [...new Set(ids.map(owner))]
    const rest = partsLeft(outer)
    add("overlap", `${outer} replaces or overrides earlier text, so it cannot be divided around the ${ids.length === 1 ? "block" : `${ids.length} blocks`} inside it given to ${owners.length > 4 ? `${owners.slice(0, 4).join(", ")} and ${owners.length - 4} more` : owners.join(", ")} (${ids.join(", ")}). Either give its targets to the parts that hold them and assign its own parts ${rest.join(", ")} instead of ${outer}, or drop ${ids.length === 1 ? "that block" : "those"} so ${outer} covers ${ids.length === 1 ? "it" : "them"}`, outer)
    issues[issues.length - 1].blocks = [outer, ...ids]
  }
  // A heading unit needs no owner of its own when its section has other content.
  const optional = (b: SourceBlock) => b.kind === "heading" && (byId.get(b.parent!)?.children.length ?? 0) > 1
  const hasAssigned = (b: SourceBlock): boolean => assigned.has(b.id) || b.children.some(c => hasAssigned(byId.get(c)!))
  const missing = new Map<string | null, string[]>()
  const uncovered = (b: SourceBlock): void => {
    if (assigned.has(b.id) || optional(b)) return
    if (!b.children.length || !hasAssigned(b)) { missing.set(b.parent, [...(missing.get(b.parent) ?? []), b.id]); return }
    for (const c of b.children) uncovered(byId.get(c)!)
  }
  for (const b of source.blocks.filter(x => x.parent === null)) uncovered(b)
  // Uncovered siblings are one issue under their parent.
  for (const [parent, ids] of missing) {
    const label = (id: string) => { const h = byId.get(id)?.heading; return h ? `${id} (${h.trim()})` : id }
    add("uncovered", ids.length === 1 ? `${label(ids[0])} is not covered: assign it or the units inside it` : `${ids.length} blocks${parent ? ` in ${parent}` : ""} are not covered: ${ids.map(label).join(", ")}; assign them or the units inside them`, ids[0])
    issues[issues.length - 1].blocks = ids
  }

  // Edges: both ends exist; the citing end is in this round; applies_to lands on another object.
  const references: Reference[] = []
  const ownerNow = (id: string): string | undefined => {
    if (id.startsWith("new:")) return id
    if (/^O\d+$/u.test(id)) return registry.objects.has(id) ? id : undefined
    const here = registry.lineage(id).map(b => assignments.find(x => x.block === b.id)).find(Boolean)
    if (here) return here.change === "none" ? "none" : here.object_id ?? `new:${nameKey(here.new_object!)}`
    return registry.appliesTo(id)
  }
  for (const [i, r] of answer.references.entries()) {
    const w = `edge ${i + 1} (${r.kind} ${r.from} -> ${r.to})`
    if (r.kind !== "refers_to" && r.kind !== "applies_to") { add("reference_invalid", `${w}: kind must be refers_to or applies_to`); continue }
    // Either kind may point at an object by id (DESIGN §12d item 1): refers_to then means that object's current text.
    const objectTarget = /^O\d+$/u.test(r.to.trim())
    if (objectTarget && !registry.objects.has(r.to.trim())) { noSuchObject(r.to.trim(), w); continue }
    // A new object of this answer is pointed at by its name.
    const newTarget = !objectTarget && newNames.has(nameKey(r.to)) ? `new:${nameKey(r.to)}` : null
    const from = resolve(r.from, `${w} from`), to = objectTarget ? [r.to.trim()] : newTarget ? [newTarget] : resolve(r.to, `${w} to`)
    if (!from || !to) continue
    if (from.length !== 1 || to.length !== 1) { add("reference_invalid", `${w}: each end names one block`); continue }
    if (roundOf(from[0]) !== round) { add("reference_invalid", `${w}: ${from[0]} is not in round ${round}; the citing block is this round's`); continue }
    if (!objectTarget && !newTarget && roundOf(to[0]) > round) { add("reference_invalid", `${w}: ${to[0]} is in a later round`); continue }
    if (r.kind === "applies_to") {
      const by = ownerNow(from[0]), target = ownerNow(to[0])
      if (!by || by === "none") { add("reference_invalid", `${w}: ${from[0]} belongs to no object, so its requirement cannot apply elsewhere`); continue }
      if (!target || target === "none") { add("reference_invalid", `${w}: ${to[0]} belongs to no object; point applies_to at a block of the object, or at its id`); continue }
      // The citing block is already that object's own text: the edge says nothing more, and is left out.
      if (target === by) continue
    }
    if (!references.some(x => x.from === from[0] && x.to === to[0] && x.kind === r.kind)) references.push({ from: from[0], to: to[0], kind: r.kind })
  }
  const interpretations = answer.interpretations.map((n, i) => ({ blocks: n.blocks.flatMap(b => resolve(b, `interpretation ${i + 1}`) ?? []), text: n.text }))
  // Ids that do not exist are one root however many places use them (BLOCK9 §2.7): one issue.
  if (unknownUses.size) {
    const ids = [...unknownUses.keys()]
    add("unknown_object", `${ids.map(id => `${id} is used by ${unknownUses.get(id)!.join(", ")}`).join("; ")}. There ${ids.length === 1 ? `is no object ${ids[0]}` : `are no objects ${ids.join(", ")}`} yet (objects so far: O1–O${registry.allocatedCount}): a new object has no id until this answer is accepted. Wherever you refer to a new object, give its name, as new_object in an assignment or as the \`to\` of an edge${created.length ? `; this answer creates ${created.join(", ")}` : ""}`)
  }

  if (issues.length) return { issues: byCause(issues) }
  // Ids for new objects: next free numbers, in document order of their first block.
  const order = source.blocks.map(b => b.id)
  const firsts = [...newNames.entries()].map(([key, name]) => ({ key, name, at: Math.min(...assignments.filter(a => a.new_object && nameKey(a.new_object) === key).map(a => order.indexOf(a.block))) }))
  firsts.sort((a, b) => a.at - b.at)
  const allocated = firsts.map((f, k) => ({ name: f.name, id: `O${registry.allocatedCount + k + 1}` }))
  // Edges that named a new object now get its id.
  for (const r of references) if (r.to.startsWith("new:")) r.to = allocated.find(x => nameKey(x.name) === r.to.slice(4))!.id
  assignments.sort((a, b) => order.indexOf(a.block) - order.indexOf(b.block))
  return { issues, acceptance: { round, answer: { assignments, references, interpretations }, allocated } }
}

/**
 * One issue per root cause (DESIGN §12d item 3): issues of the same code whose cause (the text after the place it
 * was found) is the same become one, naming every place.
 */
export function byCause(issues: Issue[]): Issue[] {
  const out: Issue[] = []
  const groups = new Map<string, { issue: Issue; cause: string; places: string[]; blocks: string[] }>()
  for (const i of issues) {
    const m = /^((?:assignment|edge|interpretation) \d+(?: \([^)]*\))?(?: [a-z]+(?: \d+)?)*): (.*)$/su.exec(i.message)
    if (!m) { out.push(i); continue }
    const key = `${i.code}|${m[2]}`
    const g = groups.get(key)
    if (g) { g.places.push(m[1]); if (i.block) g.blocks.push(i.block); continue }
    const entry = { issue: { ...i }, cause: m[2], places: [m[1]], blocks: i.block ? [i.block] : [] }
    groups.set(key, entry)
    out.push(entry.issue)
  }
  for (const g of groups.values()) if (g.places.length > 1) {
    g.issue.message = `${g.places.join("; ")}: ${g.cause}`
    g.issue.blocks = [...new Set(g.blocks)]
  }
  return out
}

function targetProblems(registry: Registry, round: number, target: string, where: string, add: (c: IssueCode, m: string, b?: string) => void, block: string): void {
  if (roundOf(target) >= round) { add("target_not_earlier", `${where}: ${target} is not from an earlier round; only earlier text can be replaced`, block); return }
  const own = registry.ownership(target)
  if (!own) { add("target_unowned", `${where}: ${target} belongs to no object, so there is nothing to replace`, block); return }
  if (own.state === "superseded" || own.state === "withdrawn") {
    const last = [...own.modifications].reverse().find(m => m.parts.includes(own.block))!
    const now = own.state === "superseded" ? `the text in force is ${last.by.join(", ")} (round ${last.round})` : `nothing replaced it`
    add("target_replaced", `${where}: ${target} lies in ${own.block}, ${own.state} in round ${last.round} by ${last.by.join(", ")}; ${now}${own.state === "superseded" ? ", cite that instead" : ""}`, block)
    return
  }
  // An amended code block or table is still in force, so it may be revised again.
  const clash = own.modifications.find(m => m.parts.some(p => !(m.amended ?? []).includes(p) && (isWithin(registry, target, p) || isWithin(registry, p, target))))
  if (clash) {
    const now = clash.kind === "withdraw" ? "it was withdrawn and nothing replaced it" : `the text in force is ${clash.by.join(", ")} (round ${clash.round}), cite that instead`
    add("target_replaced", `${where}: ${target} overlaps ${clash.parts.join(", ")}, already replaced in round ${clash.round} by ${clash.by.join(", ")}; ${now}`, block)
  }
}

function nearest(registry: Registry, id: string): string {
  const parent = id.slice(0, id.lastIndexOf("."))
  const block = registry.block(parent)
  if (!block) return ""
  return `; ${parent} has ${block.children.length} part(s): ${block.children.map(c => c.slice(parent.length + 1)).join(", ")}`
}

// ---------------------------------------------------------------- shape and patch

/** Structural shape only (the schema's job); content problems are left to checkAnswer. */
export function shapeProblems(value: unknown): string[] {
  const problems: string[] = []
  const obj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v)
  const strs = (v: unknown) => Array.isArray(v) && v.every(x => typeof x === "string")
  const assignment = (a: unknown, at: string) => {
    if (!obj(a)) return problems.push(`${at}: not an object`)
    if (typeof a.block !== "string") problems.push(`${at}.block: not a string`)
    for (const k of ["object_id", "new_object", "note"]) if (a[k] !== null && typeof a[k] !== "string") problems.push(`${at}.${k}: not a string or null`)
    if (typeof a.change !== "string") problems.push(`${at}.change: not a string`)
    if (!strs(a.replaces)) problems.push(`${at}.replaces: not a string array`)
    if (!Array.isArray(a.overrides) || !a.overrides.every(o => obj(o) && strs(o.old) && strs(o.by))) problems.push(`${at}.overrides: not an array of {old, by}`)
  }
  const edges = (v: unknown, at: string) => {
    if (!Array.isArray(v) || !v.every(r => obj(r) && typeof r.from === "string" && typeof r.to === "string" && typeof r.kind === "string")) problems.push(`${at}: not an array of {from, to, kind}`)
  }
  if (!obj(value)) return ["answer: not an object"]
  if (!Array.isArray(value.upsert)) problems.push("upsert: not an array"); else value.upsert.forEach((a, i) => assignment(a, `upsert[${i}]`))
  if (!strs(value.remove)) problems.push("remove: not a string array")
  edges(value.edges_add, "edges_add")
  edges(value.edges_remove, "edges_remove")
  if (!Array.isArray(value.interpretations_add) || !value.interpretations_add.every(n => obj(n) && strs(n.blocks) && typeof n.text === "string")) problems.push("interpretations_add: not an array of {blocks, text}")
  return problems
}

/** Applies a patch to the draft; everything the patch does not name stays as it was. */
export function applyPatch(previous: AttributionAnswer, patch: AnswerPatch): AttributionAnswer {
  const key = (block: string) => parseRef(block).id
  const removed = new Set(patch.remove.map(key))
  const upserts = new Map(patch.upsert.map(a => [key(a.block), a]))
  const assignments: Assignment[] = []
  const placed = new Set<string>()
  for (const a of previous.assignments) {
    const k = key(a.block)
    if (removed.has(k) && !upserts.has(k)) continue
    if (upserts.has(k)) { if (!placed.has(k)) assignments.push(upserts.get(k)!); placed.add(k); continue }
    assignments.push(a)
  }
  for (const [k, a] of upserts) if (!placed.has(k)) assignments.push(a)
  const same = (a: Reference, b: Reference) => key(a.from) === key(b.from) && key(a.to) === key(b.to) && a.kind === b.kind
  const references = [...previous.references.filter(r => !patch.edges_remove.some(x => same(x, r))), ...patch.edges_add]
  return { assignments, references, interpretations: [...previous.interpretations, ...patch.interpretations_add] }
}

// ---------------------------------------------------------------- loop

export interface AttributionOptions {
  /** Repairs after the first answer; each repair is one more model call. */
  maxRepairs: number
  callId: (n: number) => string
}

export async function attributeRound(registry: Registry, round: number, transport: AttributionTransport, options: AttributionOptions): Promise<AttributionOutcome> {
  if (!Number.isSafeInteger(options.maxRepairs) || options.maxRepairs < 0) throw new Error("maxRepairs must be a non-negative integer")
  const calls: ModelCallRecord[] = []
  let draft: AttributionAnswer = EMPTY_DRAFT
  let issues: Issue[] = []
  for (let attempt = 1; attempt <= options.maxRepairs + 1; attempt++) {
    const request = buildRequest(registry, round, draft, issues)
    const kind = attempt === 1 ? "attribute" : "repair"
    const text = requestJson(request)
    const sha = createHash("sha256").update(text).digest("hex")
    let reply: ModelReply
    try { reply = await transport(request) } catch (e) {
      if (e instanceof ReplayMiss) throw e
      // Keep the record of a failed call. A spent quota stops here; anything else uses up this attempt.
      const stop = e instanceof QuotaExhausted ? "quota" as const : e instanceof AuthInvalid ? "auth" as const : null
      const failed: Issue[] = [{ code: stop ?? "transport", message: `The model call failed: ${(e as Error).message}` }]
      calls.push({ id: options.callId(calls.length + 1), round, stage: "understand", step: "attribution", kind, attempt,
        request, request_chars: text.length, request_sha256: sha, response_text: "", issues: failed, usage: usageOf({ text: "" }), stub: false, error: (e as Error).message })
      if (stop) return { status: "interrupted", calls, issues: failed }
      // The draft stays as it was; with no problems of its own yet, the next request says why it is asked again.
      if (!issues.length) issues = failed
      continue
    }
    const record: ModelCallRecord = {
      id: options.callId(calls.length + 1), round, stage: "understand", step: "attribution", kind, attempt,
      request, request_chars: text.length, request_sha256: sha,
      response_text: reply.text, issues: [], usage: usageOf(reply), stub: reply.stub === true,
      ...(reply.usage === undefined && reply.stub !== true ? { usage_unknown: true } : {}),
      ...(reply.model ? { model: reply.model } : {}), ...(reply.provider ? { provider: reply.provider } : {}),
      ...(reply.started_at ? { started_at: reply.started_at } : {}), ...(reply.completed_at ? { completed_at: reply.completed_at } : {}),
      ...(reply.schema_errors?.length ? { schema_errors: reply.schema_errors } : {}),
    }
    calls.push(record)
    // An unreadable reply leaves the draft as it was; the next call patches the same draft again.
    let parsed: unknown
    try { parsed = JSON.parse(reply.text) } catch (e) {
      issues = [{ code: "unparseable", message: `The reply is not JSON: ${(e as Error).message}` }]
      record.issues = issues
      continue
    }
    const shape = shapeProblems(parsed)
    if (shape.length) {
      issues = shape.map(message => ({ code: "shape" as const, message }))
      record.issues = issues
      continue
    }
    draft = applyPatch(draft, parsed as AnswerPatch)
    const checked = checkAnswer(registry, round, draft)
    issues = checked.issues
    record.issues = issues
    if (checked.acceptance) return { status: "accepted", acceptance: checked.acceptance, calls, issues: [] }
  }
  return { status: "failed", calls, issues }
}

function usageOf(reply: ModelReply): TokenUsage {
  const u = reply.usage ?? {}
  return {
    input_tokens: u.input_tokens ?? 0, cache_read_tokens: u.cache_read_tokens ?? 0, cache_write_tokens: u.cache_write_tokens ?? 0,
    output_tokens: u.output_tokens ?? 0, reasoning_tokens: u.reasoning_tokens ?? 0,
  }
}

// ---------------------------------------------------------------- schema and prompt

const nullableString = { type: ["string", "null"] }
const stringArray = { type: "array", items: { type: "string" } }
const assignmentSchema = {
  type: "object",
  additionalProperties: false,
  required: ["block", "object_id", "new_object", "change", "replaces", "overrides", "note"],
  properties: {
    block: { type: "string", description: "A block of the new round, at the coarsest level that belongs to one object." },
    object_id: { ...nullableString, description: "An existing object's id, or null." },
    new_object: { ...nullableString, description: "A new object's name (the code assigns its id), or null. Exactly one of object_id and new_object, unless change is none." },
    change: {
      type: "string",
      enum: [...CHANGES],
      description: [
        "What this block does to earlier text. add: no earlier text stops holding because of it.",
        "revise: an earlier block as a whole is taken over by this text (list it in replaces).",
        "withdraw: an earlier block as a whole no longer holds and nothing takes its place (list it in replaces).",
        "partial: part of an earlier block no longer holds and the rest stands (give overrides).",
        "none: the block states no requirement (a preface, a rule line); no object.",
      ].join(" "),
    },
    replaces: { ...stringArray, description: "Earlier units that no longer hold as a whole (revise, withdraw)." },
    overrides: {
      type: "array",
      description: "Partial revision: old = earlier units or clauses that no longer hold; by = units of this block that state what holds now. Ids only.",
      items: { type: "object", additionalProperties: false, required: ["old", "by"], properties: { old: stringArray, by: stringArray } },
    },
    note: nullableString,
  },
}
const edgeSchema = {
  type: "object",
  additionalProperties: false,
  required: ["from", "to", "kind"],
  description: "Only for an object the block's own wording names; to = a block or an object id. refers_to: this block depends on that text or object, so its checks are derived again when that changes; the object referred to gets no change. applies_to: this block changes that object's behaviour, so that object gets a change record and is worked on this round. The block keeps its one owner.",
  properties: { from: { type: "string" }, to: { type: "string" }, kind: { type: "string", enum: ["refers_to", "applies_to"] } },
}

/** First answer and repairs alike: a patch on `previous_draft` (empty on the first call). */
export const ATTRIBUTION_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["upsert", "remove", "edges_add", "edges_remove", "interpretations_add"],
  properties: {
    upsert: { type: "array", items: assignmentSchema, description: "Assignments to add, or to replace the draft's assignment of the same block." },
    remove: { ...stringArray, description: "Blocks whose assignment in the draft is dropped." },
    edges_add: { type: "array", items: edgeSchema },
    edges_remove: { type: "array", items: edgeSchema },
    interpretations_add: { type: "array", items: { type: "object", additionalProperties: false, required: ["blocks", "text"], properties: { blocks: stringArray, text: { type: "string" } } } },
  },
}

export const ATTRIBUTION_SYSTEM_PROMPT = [
  "You register requirement text into objects. The request holds every round of the original requirements so far (`sources`, the new round last); the original text is the only authority, and newer text overrides older text.",
  "Block ids: ⟦R3.S2⟧ marks a section (a heading and everything under it, subsections included), ⟦R3.S2.P1⟧ a paragraph, ‹s2› a unit inside the paragraph (a sentence, a list item, a code block or a table) and ‹s2.c1› a clause of a sentence or list item; the full id of a unit is R3.S2.P1.s2, of a clause R3.S2.P1.s2.c1. Ids may carry the shown suffix (R3.S2.P1#ab12cd34). Units are marked only where a paragraph has more than one, clauses only where a unit has more than one.",
  "An object is a unit of requirement that the text names with a stable name and whose parts are revised together: a command, an operation, a stage of processing, a shared convention. Parameters, fields and options are never objects; a change to them is a change to their object.",
  "A section's heading line alone, without anything under it, is the unit R3.S2.H (no marker of its own); give it an owner only when the heading itself needs one apart from its content (for example none for a heading over subsections that belong elsewhere). For every block of the new round, choose the coarsest level that belongs to one object (usually a whole section; paragraphs only where a section talks about several objects, units only where a paragraph does) and give it to an existing object (object_id) or a new one (new_object: a name only). Every block of the new round has one owner: a block assigned inside an assigned block takes its own owner, and the outer block keeps the rest of its text (the most specific assignment wins). A new object has no id until the answer is accepted: refer to it by the same new_object name wherever you refer to it, and by that name as the `to` of an edge. Clauses serve to say which part of earlier text a partial revision changes.",
  "The change field's values are defined by their effect on earlier text, as its description says. Cite ids only; never copy text. Earlier units may belong to another object; cite them anyway. Ranges like R2.S9.P4.s2..s4 are allowed. Cite only text still in force: what a later round replaced is cited through its replacement.",
  "Edges: when a block's own wording names another object, add an edge. refers_to: this block depends on that text or object (so its checks are derived again when that changes). applies_to: this block changes that object's behaviour (so that object gets a change record and is worked on this round). Either may point at a block or at an object's id. `candidates` lists objects whose name the new text mentions; for each, decide only whether the wording itself names it, not whether it ought to. Never infer edges from patterns across rounds.",
  "interpretations: only when two blocks of the same round disagree, or the extent of a partial revision is unclear, write a short reading citing the blocks; it is marked as interpretation, not source.",
  "Answer as a patch on `previous_draft` (empty on the first call): upsert adds or replaces a block's assignment, remove drops one, edges_add/edges_remove and interpretations_add edit the rest. When `issues` is not empty, the code found these problems in the draft: fix exactly these, and do not restate what needs no change.",
].join("\n")
