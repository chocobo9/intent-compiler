import {
  canonicalJson,
  isRefOrSource,
  isRecord,
  isSourceRef,
  requireNonEmptyString,
  requireNonNegativeInteger,
  type Binding,
  type ContentItem,
  type IrChange,
  type LocalSourceEditRecord,
  type OutputSpec,
  type Ref,
  type Scope,
  type SourceRef,
  type TaskIntent,
} from "./intent-contract.js"

export interface IntentStateError {
  code: string
  message: string
  path?: string
}

export interface IntentStateResult {
  ok: boolean
  tasks: Record<string, TaskIntent>
  errors: IntentStateError[]
  /** Source removals an `edit` change performed, in model order. */
  edits: LocalSourceEditRecord[]
}

const EMPTY_STATE: Record<string, TaskIntent> = {}

export class IntentStateManager {
  private tasks: Map<string, TaskIntent>
  /** The change that last advanced each object since this manager was created, so a stale expected_revision can name it. */
  private changed = new Map<string, EarlierChange>()
  private applyCount = 0

  constructor(initial: Record<string, TaskIntent> = EMPTY_STATE) {
    this.tasks = new Map(Object.entries(initial).map(([id, task]) => [id, cloneTask(task)]))
  }

  snapshot(): Record<string, TaskIntent> {
    return Object.fromEntries([...this.tasks.entries()].map(([id, task]) => [id, cloneTask(task)]))
  }

  get(taskId: string): TaskIntent | undefined {
    const task = this.tasks.get(taskId)
    return task ? cloneTask(task) : undefined
  }

  apply(changes: readonly IrChange[], taskRefs: readonly string[]): IntentStateResult {
    const errors: IntentStateError[] = []
    const edits: LocalSourceEditRecord[] = []
    const working = new Map([...this.tasks.entries()].map(([id, task]) => [id, cloneTask(task)]))
    const changed = new Map(this.changed)
    const call = ++this.applyCount

    for (const { change, index } of orderChanges(changes)) {
      const path = `ir_changes[${index}]`
      const object = changedObject(change, taskRefs)
      try {
        const edit = applyChange(working, change, taskRefs, path)
        if (edit !== undefined) edits.push(edit)
        if (object !== undefined) changed.set(object.key, { call, path, change: object.change })
      } catch (error) {
        const earlier = object === undefined ? undefined : changed.get(object.key)
        errors.push({
          code: errorCode(error),
          message: error instanceof RevisionMismatch && earlier !== undefined && object !== undefined
            ? `${error.message}: ${earlier.path} (${earlier.change}) ${earlier.call === call ? "earlier in this group" : "in an earlier group of this batch"} already changed ${object.label} to revision ${error.current} before this ${object.change}`
            : errorMessage(error),
          path,
        })
      }
    }

    if (errors.length > 0) return { ok: false, tasks: this.snapshot(), errors, edits: [] }
    this.tasks = working
    this.changed = changed
    return { ok: true, tasks: this.snapshot(), errors: [], edits }
  }
}

export function applyIrChanges(
  current: Record<string, TaskIntent>,
  changes: readonly IrChange[],
  taskRefs: readonly string[],
): IntentStateResult {
  return new IntentStateManager(current).apply(changes, taskRefs)
}

/**
 * One group is one atomic commit, so the result must not depend on where the
 * model happened to place a task create in the list: its bindings, outputs,
 * content items and the drafts all name that task.  Task creates are applied
 * first; every other change keeps the model's order, and error paths keep the
 * model's original indices.
 */
function orderChanges(changes: readonly IrChange[]): Array<{ change: IrChange; index: number }> {
  const creates: Array<{ change: IrChange; index: number }> = []
  const rest: Array<{ change: IrChange; index: number }> = []
  changes.forEach((change, index) => {
    if (isRecord(change) && change.action === "create" && change.target === "task") creates.push({ change, index })
    else rest.push({ change, index })
  })
  return creates.length === 0 ? rest : [...creates, ...rest]
}

export function validateTaskIntent(value: unknown): TaskIntent {
  if (!isRecord(value)) throw new TypeError("TaskIntent must be an object")
  const taskId = requireNonEmptyString(value.task_id, "task_id", "$.task_id")
  requireNonNegativeInteger(value.revision, "revision", "$.revision")
  if (!isRecord(value.goal)) throw new TypeError("goal must be an object")
  requireNonEmptyString(value.goal.text, "goal.text", "$.goal.text")
  if (!Array.isArray(value.bindings) || !Array.isArray(value.outputs) || !Array.isArray(value.content)) {
    throw new TypeError("bindings, outputs, and content must be arrays")
  }
  if (!isRecord(value.current_scope)) throw new TypeError("current_scope must be an object")
  return {
    task_id: taskId,
    revision: value.revision,
    goal: { text: value.goal.text, sources: normalizeSources(value.goal.sources) },
    bindings: value.bindings.map(normalizeBinding),
    outputs: value.outputs.map(normalizeOutput),
    content: value.content.map(normalizeContent),
    current_scope: {
      text: requireNonEmptyString(value.current_scope.text, "current_scope.text", "$.current_scope.text"),
      disposition: value.current_scope.disposition,
      sources: normalizeSources(value.current_scope.sources),
    },
    unresolved: Array.isArray(value.unresolved) ? value.unresolved : [],
  }
}

function applyChange(
  tasks: Map<string, TaskIntent>,
  change: IrChange,
  taskRefs: readonly string[],
  path: string,
): LocalSourceEditRecord | undefined {
  if (!isRecord(change)) throw new TypeError("each IR change must be an object")
  if (change.action === "preserve") return

  const sources = change.action === "edit" ? [] : normalizeSources(change.sources)
  const taskId = taskRefs[0]
  if (!taskId) throw new TypeError("IR change requires a resolved task_ref")

    if (change.action === "create") {
      if (!isRecord(change.value)) throw new TypeError("create value must be an object")
      const value = change.value as Record<string, any>
      if (change.target === "task") {
        const taskId = change.local_ref
        if (!taskId) throw new TypeError("create task requires local_ref")
        if (tasks.has(taskId)) throw new TypeError(`task ${taskId} already exists`)
        const task: TaskIntent = {
          task_id: taskId,
          revision: 0,
          goal: {
            text: requireNonEmptyString(value.goal?.text, "goal.text"),
            sources: sources,
          },
          bindings: [],
          outputs: [],
          content: [],
          current_scope: {
            text: typeof value.current_scope?.text === "string" ? value.current_scope.text : "proceed",
            disposition: value.current_scope?.disposition === "paused" || value.current_scope?.disposition === "withdrawn" || value.current_scope?.disposition === "conditional"
              ? value.current_scope.disposition
              : "proceed",
            sources,
          },
          unresolved: [],
        }
        tasks.set(taskId, task)
        return
      }
      const task = tasks.get(taskId)
    if (!task) throw new TypeError(`unknown task ${taskId}`)
    const updated = cloneTask(task)
    const id = change.local_ref
    if (!id) throw new TypeError("create requires local_ref")

    if (change.target === "binding") {
      updated.bindings = [...updated.bindings, normalizeBinding({ ...value, binding_id: id, revision: 0, sources })]
    } else if (change.target === "output") {
      updated.outputs = [...updated.outputs, normalizeOutput({ ...value, output_id: id, revision: 0, sources })]
    } else if (change.target === "content") {
      updated.content = [...updated.content, normalizeContent({ ...value, item_id: id, revision: 0, sources })]
    } else {
      throw new TypeError(`unsupported create target ${String(change.target)}`)
    }
    tasks.set(taskId, updated)
    return
  }

  if (change.action === "revise") {
    const task = tasks.get(taskId)
    if (!task) throw new TypeError(`unknown task ${taskId}`)
    const updated = cloneTask(task)
    if (change.target === "task" || change.target === "current_scope") {
      if (change.expected_revision !== updated.revision) {
        throw new RevisionMismatch(change.expected_revision, updated.revision)
      }
      if (change.target === "task") {
        if (!isRecord(change.value)) throw new TypeError("revise task value must be an object")
        updated.goal = {
          text: requireNonEmptyString(change.value.goal?.text, "goal.text"),
          sources: sources,
        }
        if (change.value.current_scope !== undefined) updated.current_scope = reviseScope(change.value.current_scope, sources)
      } else {
        updated.current_scope = reviseScope(change.value, sources)
      }
      updated.revision += 1
      tasks.set(taskId, updated)
      return
    }

    const existing = findInTask(updated, change.target, change.id)
    if (!existing) throw new TypeError(`unknown ${change.target} ${change.id}`)
    if (existing.revision !== change.expected_revision) {
      throw new RevisionMismatch(change.expected_revision, existing.revision)
    }
    if (!isRecord(change.value)) throw new TypeError("revise value must be an object")
    const value = change.value as Record<string, any>
    if (change.target === "binding") {
      updated.bindings = updated.bindings.map((item) => item.binding_id === change.id ? normalizeBinding({ ...value, binding_id: item.binding_id, revision: item.revision + 1, sources }) : item)
    } else if (change.target === "output") {
      updated.outputs = updated.outputs.map((item) => item.output_id === change.id ? normalizeOutput({ ...value, output_id: item.output_id, revision: item.revision + 1, sources }) : item)
    } else {
      updated.content = updated.content.map((item) => item.item_id === change.id ? normalizeContent({ ...value, item_id: item.item_id, revision: item.revision + 1, sources }) : item)
    }
    tasks.set(taskId, updated)
    return
  }

  if (change.action === "retire") {
    const task = tasks.get(taskId)
    if (!task) throw new TypeError(`unknown task ${taskId}`)
    const updated = cloneTask(task)
    const existing = findInTask(updated, change.target, change.id)
    if (!existing) throw new TypeError(`unknown ${change.target} ${change.id}`)
    if (existing.revision !== change.expected_revision) {
      throw new RevisionMismatch(change.expected_revision, existing.revision)
    }
    if (change.target === "binding") updated.bindings = updated.bindings.filter((item) => item.binding_id !== change.id)
    else if (change.target === "output") updated.outputs = updated.outputs.filter((item) => item.output_id !== change.id)
    else updated.content = updated.content.filter((item) => item.item_id !== change.id)
    tasks.set(taskId, updated)
    return
  }

  if (change.action === "edit") {
    if (change.target !== "content") throw new TypeError("edit supports content sources only")
    const task = tasks.get(taskId)
    if (!task) throw new TypeError(`unknown task ${taskId}`)
    const updated = cloneTask(task)
    const item = updated.content.find((entry) => entry.item_id === change.id)
    if (!item) throw new TypeError(`unknown content ${change.id}`)
    if (item.revision !== change.expected_revision) {
      throw new RevisionMismatch(change.expected_revision, item.revision)
    }
    const removals = editSourceRefs(change.remove, "remove")
    const additions = editSourceRefs(change.add, "add")
    const basis = editSourceRefs(change.basis, "basis")
    if (removals.length === 0 && additions.length === 0) throw new TypeError("edit requires at least one remove or add selector")
    if (basis.length === 0) throw new TypeError("edit requires at least one source as the change's basis")
    if (typeof change.reason !== "string" || !change.reason.trim()) throw new TypeError("edit requires a reason explaining the source change")
    const plan = subtractRemovals(item, removals)
    item.revision += 1
    item.sources = [...plan.retained, ...additions]
    tasks.set(taskId, updated)
    return { task_id: taskId, item_id: item.item_id, removed: plan.removed, basis, reason: change.reason }
  }

  throw new TypeError(`unsupported IR change action ${String((change as unknown as { action: unknown }).action)}`)
}

/**
 * Execute a local edit's removals against one item's stored sources.  The edit
 * names fragments inside what this item already selected: a cut has to lie
 * inside the union of the item's intervals of that event, and every interval it
 * touches loses exactly its intersection.  Overlapping intervals therefore
 * cannot hide a fragment - the cut is subtracted from each of them - and a cut
 * that would include text the item never selected is refused.  Everything not
 * named is kept, and the new text is materialized from the resulting sources.
 */
function subtractRemovals(item: ContentItem, removals: readonly SourceRef[]): { retained: SourceRef[]; removed: SourceRef[] } {
  const cuts = removals.map((cut) => ({ cut, span: requireCutSpan(cut) }))
  rejectOverlappingCuts(cuts)
  // The declared cut is the removal: the model states it once, and code writes
  // one disposal record for it, whatever number of stored intervals it touches.
  const removed = cuts.map(({ cut, span }) => ({ source_id: cut.source_id, digest: cut.digest, span: { unit: "utf16" as const, start: span.start, end: span.end } }))
  for (const { cut, span } of cuts) {
    const touched = item.sources
      .filter(source => source.source_id === cut.source_id && source.span !== undefined)
      .filter(source => source.span!.start < span.end && span.start < source.span!.end)
    for (const host of touched) {
      if (host.digest !== cut.digest) throw new TypeError(`edit remove selector ${cut.source_id} digest does not match the current source`)
    }
    if (touched.length === 0 || !coveredByUnion(span, touched.map(source => source.span!))) {
      throw new TypeError(`edit remove selector ${cut.source_id} ${span.start}-${span.end} is outside the item's current sources`)
    }
  }
  const retained: SourceRef[] = []
  for (const source of item.sources) {
    const host = source.span
    if (host === undefined) {
      retained.push({ ...source })
      continue
    }
    const parts = subtractCuts(host, cuts.filter(entry => entry.cut.source_id === source.source_id).map(entry => entry.span))
    for (const part of parts) retained.push({ source_id: source.source_id, digest: source.digest, span: { unit: "utf16", start: part.start, end: part.end } })
  }
  return { retained, removed }
}

/** Two cuts of one event may not overlap: each removal is declared once. */
function rejectOverlappingCuts(cuts: ReadonlyArray<{ cut: SourceRef; span: { start: number; end: number } }>): void {
  const bySource = new Map<string, Array<{ start: number; end: number }>>()
  for (const { cut, span } of cuts) {
    const spans = bySource.get(cut.source_id)
    if (spans === undefined) bySource.set(cut.source_id, [span])
    else spans.push(span)
  }
  for (const [sourceId, spans] of bySource) {
    spans.sort((a, b) => a.start - b.start)
    for (let index = 1; index < spans.length; index += 1) {
      if (spans[index]!.start < spans[index - 1]!.end) throw new TypeError(`edit remove selectors overlap inside ${sourceId}`)
    }
  }
}

/** Is the whole target inside the union of these intervals? */
function coveredByUnion(target: { start: number; end: number }, spans: readonly { start: number; end: number }[]): boolean {
  let cursor = target.start
  for (const span of [...spans].sort((a, b) => a.start - b.start)) {
    if (span.end <= cursor) continue
    if (span.start > cursor) return false
    cursor = Math.max(cursor, span.end)
    if (cursor >= target.end) return true
  }
  return false
}

/** The parts of one host interval that remain after every cut is subtracted. */
function subtractCuts(host: { start: number; end: number }, cuts: readonly { start: number; end: number }[]): Array<{ start: number; end: number }> {
  const parts: Array<{ start: number; end: number }> = []
  let cursor = host.start
  for (const cut of [...cuts].sort((a, b) => a.start - b.start)) {
    const start = Math.max(cut.start, host.start)
    const end = Math.min(cut.end, host.end)
    if (start >= end) continue
    if (start > cursor) parts.push({ start: cursor, end: start })
    cursor = Math.max(cursor, end)
  }
  if (cursor < host.end) parts.push({ start: cursor, end: host.end })
  return parts
}

function requireCutSpan(cut: SourceRef): { start: number; end: number } {
  const span = cut.span
  if (!span || span.unit !== "utf16" || !Number.isInteger(span.start) || !Number.isInteger(span.end) || span.start >= span.end) {
    throw new TypeError(`edit remove selector for ${cut.source_id} needs one resolved utf16 span`)
  }
  return { start: span.start, end: span.end }
}

function findInTask(
  task: TaskIntent,
  target: "binding" | "output" | "content",
  id: string,
): { revision: number } | undefined {
  if (target === "binding") return task.bindings.find((item) => item.binding_id === id)
  if (target === "output") return task.outputs.find((item) => item.output_id === id)
  return task.content.find((item) => item.item_id === id)
}

function normalizeBinding(value: Record<string, any>): Binding {
  return {
    binding_id: requireNonEmptyString(value.binding_id, "binding_id"),
    revision: requireNonNegativeInteger(value.revision, "binding revision"),
    ...(value.ref === undefined ? {} : { ref: isRefOrSource(value.ref) ? value.ref : undefined }),
    role: value.role === "task_data" || value.role === "context" || value.role === "example" ? value.role : "task_data",
    purpose: typeof value.purpose === "string" ? value.purpose : "",
    sources: normalizeSources(value.sources),
  }
}

function normalizeOutput(value: Record<string, any>): OutputSpec {
  return {
    output_id: requireNonEmptyString(value.output_id, "output_id"),
    revision: requireNonNegativeInteger(value.revision, "output revision"),
    description: typeof value.description === "string" ? value.description : "",
    format: value.format === "json" || value.format === "artifact" ? value.format : "text",
    sources: normalizeSources(value.sources),
  }
}

function normalizeContent(value: Record<string, any>): ContentItem {
  return {
    item_id: requireNonEmptyString(value.item_id, "item_id"),
    revision: requireNonNegativeInteger(value.revision, "content revision"),
    text: typeof value.text === "string" ? value.text : "",
    ...(typeof value.interpretation === "string" ? { interpretation: value.interpretation } : {}),
    ...(value.text_origin === "source" ? { text_origin: "source" as const } : {}),
    sources: normalizeSources(value.sources),
    about: (Array.isArray(value.about) ? value.about.filter((item): item is Ref => isRefOrSource(item) && "id" in item) : []) as Ref[],
    scope: (Array.isArray(value.scope) ? value.scope.filter(isRecord) : []) as Scope[],
    support: Array.isArray(value.support) ? value.support : [],
  }
}

function normalizeSources(value: unknown): SourceRef[] {
  if (!Array.isArray(value)) return []
  return value.filter((item) => isRefOrSource(item) && !("id" in item)).map((item) => item as SourceRef)
}

/**
 * The edit's remove/add/basis lists are SourceRef[] by contract.  A plain Ref
 * in a mixed list is a different shape, not a member to drop, so one illegal
 * member rejects the whole edit before any filtering.  The other actions keep
 * their existing normalization.
 */
function editSourceRefs(value: unknown, field: "remove" | "add" | "basis"): SourceRef[] {
  if (!Array.isArray(value)) return []
  value.forEach((entry, index) => {
    if (!isSourceRef(entry)) {
      throw new TypeError(`edit ${field}[${index}] must be a SourceRef with source_id and digest; a plain Ref is not a valid ${field} entry`)
    }
  })
  return value as SourceRef[]
}

interface EarlierChange {
  call: number
  path: string
  change: string
}

class RevisionMismatch extends TypeError {
  constructor(expected: number, readonly current: number) {
    super(`expected_revision ${expected} does not match current ${current}`)
  }
}

/** The object whose revision a change checks or advances: task and current_scope share the task revision. */
function changedObject(change: IrChange, taskRefs: readonly string[]): { key: string; label: string; change: string } | undefined {
  if (!isRecord(change) || change.action === "preserve") return undefined
  const record = change as Record<string, unknown>
  const description = `${change.action} ${String(change.target)}`
  if (change.target === "task" || change.target === "current_scope") {
    const taskId = change.action === "create" ? record.local_ref : taskRefs[0]
    return typeof taskId === "string" ? { key: `task:${taskId}`, label: `task ${taskId}`, change: description } : undefined
  }
  const id = change.action === "create" ? record.local_ref : record.id
  if (typeof id !== "string" || taskRefs[0] === undefined) return undefined
  return { key: `${taskRefs[0]}:${String(change.target)}:${id}`, label: `${String(change.target)} ${id}`, change: description }
}

function reviseScope(value: unknown, sources: SourceRef[]): TaskIntent["current_scope"] {
  if (!isRecord(value)) throw new TypeError("revise current_scope value must be an object")
  return {
    text: requireNonEmptyString(value.text, "current_scope.text"),
    disposition: value.disposition,
    sources,
  }
}

function cloneTask(task: TaskIntent): TaskIntent {
  return JSON.parse(canonicalJson(task)) as TaskIntent
}

function errorCode(error: unknown): string {
  return error instanceof Error && "code" in error && typeof (error as { code?: unknown }).code === "string"
    ? (error as { code: string }).code
    : "IR_CHANGE_INVALID"
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
