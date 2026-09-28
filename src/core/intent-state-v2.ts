import {
  canonicalJson,
  isRefOrSource,
  isRecord,
  requireNonEmptyString,
  requireNonNegativeInteger,
  type Binding,
  type ContentItem,
  type IrChange,
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
}

const EMPTY_STATE: Record<string, TaskIntent> = {}

export class IntentStateManager {
  private tasks: Map<string, TaskIntent>

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
    const working = new Map([...this.tasks.entries()].map(([id, task]) => [id, cloneTask(task)]))

    for (const { change, index } of orderChanges(changes)) {
      const path = `ir_changes[${index}]`
      try {
        applyChange(working, change, taskRefs, path)
      } catch (error) {
        errors.push({
          code: errorCode(error),
          message: errorMessage(error),
          path,
        })
      }
    }

    if (errors.length > 0) return { ok: false, tasks: this.snapshot(), errors }
    this.tasks = working
    return { ok: true, tasks: this.snapshot(), errors: [] }
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
): void {
  if (!isRecord(change)) throw new TypeError("each IR change must be an object")
  if (change.action === "preserve") return

  const sources = normalizeSources(change.sources)
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
        throw new TypeError(`expected_revision ${change.expected_revision} does not match current ${updated.revision}`)
      }
      if (change.target === "task") {
        if (!isRecord(change.value)) throw new TypeError("revise task value must be an object")
        updated.goal = {
          text: requireNonEmptyString(change.value.goal?.text, "goal.text"),
          sources: sources,
        }
      } else {
        if (!isRecord(change.value)) throw new TypeError("revise current_scope value must be an object")
        updated.current_scope = {
          text: requireNonEmptyString(change.value.text, "current_scope.text"),
          disposition: change.value.disposition,
          sources,
        }
      }
      updated.revision += 1
      tasks.set(taskId, updated)
      return
    }

    const existing = findInTask(updated, change.target, change.id)
    if (!existing) throw new TypeError(`unknown ${change.target} ${change.id}`)
    if (existing.revision !== change.expected_revision) {
      throw new TypeError(`expected_revision ${change.expected_revision} does not match current ${existing.revision}`)
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
      throw new TypeError(`expected_revision ${change.expected_revision} does not match current ${existing.revision}`)
    }
    if (change.target === "binding") updated.bindings = updated.bindings.filter((item) => item.binding_id !== change.id)
    else if (change.target === "output") updated.outputs = updated.outputs.filter((item) => item.output_id !== change.id)
    else updated.content = updated.content.filter((item) => item.item_id !== change.id)
    tasks.set(taskId, updated)
    return
  }

  throw new TypeError(`unsupported IR change action ${String((change as unknown as { action: unknown }).action)}`)
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
