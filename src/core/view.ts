/**
 * Per-operation views for the management layer.
 *
 * The IR, the plan and the ledger stay complete in the store; this module
 * decides what one management call actually reads.  A view is a manifest
 * (every object, one line each: id, revision, status, short summary) plus a
 * bounded set of expanded objects, each traceable to exactly one rule.  What
 * is not expanded stays visible in the manifest and can be retrieved with a
 * `need` request, so trimming never hides an object.
 *
 * Pure functions only: the caller supplies the state, this module never reads
 * the store and never calls a model.
 */
import type { AtomStateRecord, AtomStatus, CompiledIntent, TaskIntent } from "./intent-contract.js"

export type ManagementOperation = "update_ir" | "compile_plan" | "assess_return"

/**
 * Why an object was expanded into the request:
 * - referenced: named by this turn (an id in its text, or an operation target)
 * - recent: its revision changed within the caller's recent window
 * - status: ready/executing/failed work, or an item recorded as unresolved
 * - requested: the previous call asked for it with `need`
 */
export type ExpansionRule = "referenced" | "recent" | "status" | "requested"

export interface ViewLimits {
  /** Characters kept per manifest summary. */
  manifestSummary: number
  /** Total characters of expanded object text in one view. */
  expandedBytes: number
  /** Characters reserved for the operation's protocol slice. */
  protocolBytes: number
  /** Retrieval bounds for one `need` round. */
  retrievalRefs: number
  retrievalItemBytes: number
  retrievalBytes: number
}

export const VIEW_LIMITS: ViewLimits = {
  manifestSummary: 80,
  expandedBytes: 20_480,
  protocolBytes: 2_048,
  retrievalRefs: 8,
  retrievalItemBytes: 4_096,
  retrievalBytes: 12_288,
}

export interface ManifestItem {
  item_id: string
  revision: number
  summary: string
  source_events: string[]
}

export interface ManifestAtom {
  atom_id: string
  revision: number
  status: AtomStatus | "not_found"
  summary: string
}

export interface ViewManifest {
  task_id: string
  goal: string
  current_scope: string
  items: ManifestItem[]
  atoms: ManifestAtom[]
}

export interface ExpandedEntry {
  ref: string
  kind: "item" | "atom"
  rule: ExpansionRule
  bytes: number
  text: string
}

export interface TruncatedEntry {
  ref: string
  kind: "item" | "atom"
  rule: ExpansionRule
  bytes: number
  reason: "over-budget"
}

export interface ViewPlan {
  operation: ManagementOperation
  /** One entry per task; single-task runs have exactly one (multi-task routing is out of scope). */
  manifest: ViewManifest[]
  expanded: ExpandedEntry[]
  truncated: TruncatedEntry[]
  bytes: { manifest: number; turn: number; expanded: number; protocol: number; total: number }
}

export interface SelectViewInput {
  operation: ManagementOperation
  /** This turn's event; `task_ids` is taken as a reference signal when present. */
  turn?: { event_id: string; text: string; task_ids?: string[] }
  /**
   * Objects this operation must see regardless of the scanning rules: the atom
   * under assessment, or the item the caller already knows is touched.
   */
  targets?: string[]
  ir: Record<string, TaskIntent>
  compiled: Record<string, CompiledIntent>
  atom_states?: AtomStateRecord[]
  /** Item ids recorded as unresolved (from the IR's `unresolved` entries). */
  unresolved_item_ids?: string[]
  /** Refs whose revision changed within the caller's recent window. */
  recently_changed?: string[]
  /** Refs the previous call asked for with `need`. */
  last_requested?: string[]
  limits?: Partial<ViewLimits>
}

export interface NeedRequest {
  ref: string
  why?: string
}

export interface NeedIndex {
  /** Keyed "<item_id>@<revision>". */
  items: Map<string, string>
  /** Keyed "<atom_id>@<revision>". */
  atoms: Map<string, string>
  /** Keyed by turn index (the event's sequence as a string). */
  turns: Map<string, string>
  artifacts: Map<string, { path: string; digest: string; bytes?: number }>
}

export interface RetrievedEntry {
  ref: string
  kind: "item" | "atom" | "turn" | "artifact"
  bytes: number
  text: string
  truncated?: true
}

export interface ResolvedNeeds {
  retrieved: RetrievedEntry[]
  unresolved: Array<{ ref: string; reason: "unknown-ref" | "over-budget" }>
}

function summarize(text: string, limit: number): string {
  const firstLine = text.split(/\r?\n/u).find((line) => line.trim().length > 0) ?? text
  const collapsed = firstLine.replace(/\s+/gu, " ").trim()
  return collapsed.length <= limit ? collapsed : `${collapsed.slice(0, Math.max(0, limit - 1))}…`
}

function clip(text: string, limit: number): string {
  const trimmed = text.trim()
  return trimmed.length <= limit ? trimmed : `${trimmed.slice(0, Math.max(0, limit - 1))}…`
}

function goalText(task: TaskIntent, limit: number): string {
  const text = (task.goal?.text ?? "").trim()
  return text.length <= limit ? text : `${text.slice(0, Math.max(0, limit - 1))}…`
}

/** Item text is canonical (materialized from user sources); interpretation only names it. */
function itemBody(item: TaskIntent["content"][number]): string {
  return item.text.trim().length > 0 ? item.text : (item.interpretation ?? "")
}

export function atomExpansion(atom: CompiledIntent["atoms"][number]): string {
  const completion = atom.completion.map((entry) => entry.text).join("\n")
  return [atom.task, "", "Completion:", completion, "", "Return when:", ...atom.return_when].join("\n")
}

export function buildManifest(
  ir: Record<string, TaskIntent>,
  compiled: Record<string, CompiledIntent>,
  atomStates: readonly AtomStateRecord[] = [],
  limits: ViewLimits = VIEW_LIMITS,
): ViewManifest[] {
  const statusOf = new Map(atomStates.map((state) => [`${state.atom_id}@${state.atom_revision}`, state.status]))
  return Object.values(ir).map((task) => ({
    task_id: task.task_id,
    goal: goalText(task, 200),
    current_scope: clip(task.current_scope?.text ?? "", 200),
    items: task.content.map((item) => ({
      item_id: item.item_id,
      revision: item.revision,
      summary: summarize(item.interpretation ?? itemBody(item), limits.manifestSummary),
      source_events: [...new Set(item.sources.map((source) => source.source_id))],
    })),
    atoms: (compiled[task.task_id]?.atoms ?? []).map((atom) => ({
      atom_id: atom.atom_id,
      revision: atom.revision,
      status: statusOf.get(`${atom.atom_id}@${atom.revision}`) ?? "not_found",
      summary: summarize(atom.task, limits.manifestSummary),
    })),
  }))
}

function knownRefs(ir: Record<string, TaskIntent>, compiled: Record<string, CompiledIntent>): Map<string, "item" | "atom"> {
  const refs = new Map<string, "item" | "atom">()
  for (const task of Object.values(ir)) {
    for (const item of task.content) refs.set(item.item_id, "item")
  }
  for (const intent of Object.values(compiled)) {
    for (const atom of intent.atoms ?? []) refs.set(atom.atom_id, "atom")
  }
  return refs
}

function textRefs(text: string, known: Map<string, "item" | "atom">): string[] {
  const found: string[] = []
  for (const ref of known.keys()) {
    if (text.includes(ref) && !found.includes(ref)) found.push(ref)
  }
  return found
}

const RULE_ORDER: Record<ExpansionRule, number> = { referenced: 0, recent: 1, status: 2, requested: 3 }

/**
 * How each operation narrows the candidate set, per object kind.  An IR
 * operation never drags in the text of an executable Atom (the manifest still
 * shows it), and assessing a return expands the Atom under assessment rather
 * than the whole requirement set; the caller can always retrieve more.
 */
const OPERATION_RULES: Record<ManagementOperation, Record<"item" | "atom", ReadonlySet<ExpansionRule>>> = {
  update_ir: {
    item: new Set(["referenced", "recent", "status", "requested"]),
    atom: new Set(),
  },
  compile_plan: {
    item: new Set(["referenced", "recent", "requested"]),
    atom: new Set(["recent", "requested"]),
  },
  assess_return: {
    item: new Set(),
    atom: new Set(["referenced", "requested"]),
  },
}

export function selectView(input: SelectViewInput): ViewPlan {
  const limits = { ...VIEW_LIMITS, ...input.limits }
  const known = knownRefs(input.ir, input.compiled)
  const allowedFor = OPERATION_RULES[input.operation]
  const candidates = new Map<string, ExpansionRule>()
  const add = (ref: string, rule: ExpansionRule): void => {
    const kind = known.get(ref)
    if (kind === undefined || !allowedFor[kind].has(rule)) return
    const current = candidates.get(ref)
    if (current === undefined || RULE_ORDER[rule] < RULE_ORDER[current]) candidates.set(ref, rule)
  }
  for (const ref of textRefs(input.turn?.text ?? "", known)) add(ref, "referenced")
  for (const ref of input.targets ?? []) add(ref, "referenced")
  for (const ref of input.recently_changed ?? []) add(ref, "recent")
  for (const ref of input.last_requested ?? []) add(ref, "requested")
  for (const ref of input.unresolved_item_ids ?? []) add(ref, "status")
  // Atom status is manifest-only by design: a ready Atom's body is the largest
  // object in the state and reading it by default is what this module exists to
  // avoid.  Atoms enter the slice through referenced/recent/requested refs.
  const itemById = new Map<string, { text: string; revision: number }>()
  for (const task of Object.values(input.ir)) for (const item of task.content) itemById.set(item.item_id, { text: itemBody(item), revision: item.revision })
  const atomById = new Map<string, { text: string; revision: number }>()
  for (const intent of Object.values(input.compiled)) {
    for (const atom of intent.atoms ?? []) atomById.set(atom.atom_id, { text: atomExpansion(atom), revision: atom.revision })
  }
  const ordered = [...candidates.entries()].sort((a, b) =>
    RULE_ORDER[a[1]] - RULE_ORDER[b[1]] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
  const expanded: ExpandedEntry[] = []
  const truncated: TruncatedEntry[] = []
  let used = 0
  for (const [ref, rule] of ordered) {
    const kind = known.get(ref) as "item" | "atom"
    const body = kind === "item" ? itemById.get(ref)?.text : atomById.get(ref)?.text
    if (body === undefined) continue
    if (used + body.length > limits.expandedBytes) {
      truncated.push({ ref, kind, rule, bytes: body.length, reason: "over-budget" })
      continue
    }
    used += body.length
    expanded.push({ ref, kind, rule, bytes: body.length, text: body })
  }
  const manifest = buildManifest(input.ir, input.compiled, input.atom_states, limits)
  const manifestBytes = JSON.stringify(manifest).length
  const turnBytes = input.turn?.text.length ?? 0
  return {
    operation: input.operation,
    manifest,
    expanded,
    truncated,
    bytes: {
      manifest: manifestBytes,
      turn: turnBytes,
      expanded: used,
      protocol: limits.protocolBytes,
      total: manifestBytes + turnBytes + used + limits.protocolBytes,
    },
  }
}

function parseNeedRef(ref: string): { kind: "item" | "atom" | "turn" | "artifact"; key: string; range?: { start: number; end: number } } | undefined {
  const ranged = /^(turn|item|atom):(.+)@(\d+)-(\d+)$/u.exec(ref)
  if (ranged !== null) {
    const kind = ranged[1] as "turn" | "item" | "atom"
    const start = Number(ranged[3])
    const end = Number(ranged[4])
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end <= start) return undefined
    return { kind, key: ranged[2]!, range: { start, end } }
  }
  const tagged = /^(item|atom|turn|artifact):(.+)$/u.exec(ref)
  if (tagged !== null) return { kind: tagged[1] as "item" | "atom" | "turn" | "artifact", key: tagged[2]! }
  // A bare known id selects an item when it exists, otherwise an atom.
  return { kind: "item", key: ref }
}

export function resolveNeeds(needs: readonly NeedRequest[], index: NeedIndex, limits: ViewLimits = VIEW_LIMITS): ResolvedNeeds {
  const retrieved: RetrievedEntry[] = []
  const unresolved: ResolvedNeeds["unresolved"] = []
  let used = 0
  const lookup = (kind: "item" | "atom" | "turn" | "artifact", key: string): string | undefined => {
    if (kind === "item") return index.items.get(key)
    if (kind === "atom") return index.atoms.get(key)
    if (kind === "turn") return index.turns.get(key)
    const artifact = index.artifacts.get(key)
    return artifact === undefined ? undefined : `artifact ${artifact.path} ${artifact.digest}`
  }
  for (const [position, need] of needs.entries()) {
    if (position >= limits.retrievalRefs) {
      unresolved.push({ ref: need.ref, reason: "over-budget" })
      continue
    }
    const parsed = parseNeedRef(need.ref)
    if (parsed === undefined) {
      unresolved.push({ ref: need.ref, reason: "unknown-ref" })
      continue
    }
    let body = lookup(parsed.kind, parsed.key)
    let kind: RetrievedEntry["kind"] = parsed.kind
    // A bare id selects an item when it exists, otherwise an atom.
    if (body === undefined && parsed.kind === "item" && !need.ref.includes(":") && index.atoms.has(parsed.key)) {
      body = index.atoms.get(parsed.key)
      kind = "atom"
    }
    if (body === undefined) {
      unresolved.push({ ref: need.ref, reason: "unknown-ref" })
      continue
    }
    const slice = parsed.range === undefined ? body : body.slice(parsed.range.start, parsed.range.end)
    const truncated = slice.length > limits.retrievalItemBytes
    const text = truncated ? slice.slice(0, limits.retrievalItemBytes) : slice
    if (used + text.length > limits.retrievalBytes) {
      unresolved.push({ ref: need.ref, reason: "over-budget" })
      continue
    }
    used += text.length
    retrieved.push({ ref: need.ref, kind, bytes: text.length, text, ...(truncated ? { truncated: true as const } : {}) })
  }
  return { retrieved, unresolved }
}
