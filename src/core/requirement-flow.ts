import {
  digestOf,
  digestText,
  canonicalJson,
  type Atom,
  type CandidateGroup,
  type CompiledIntentDraft,
  type CompilerEvent,
  type ContentItem,
  type Ref,
  type SourceRef,
  type TaskIntent,
} from "./intent-contract.js"
import { atomRef } from "./compiled-intent.js"

function contentRef(item: ContentItem): Ref {
  return { id: item.item_id, revision: item.revision, digest: digestOf(item) }
}

function contentShape(items: readonly ContentItem[]): string {
  return JSON.stringify(items.map(item => [item.item_id, item.revision, digestOf(item)]).sort((a, b) =>
    String(a[0]).localeCompare(String(b[0])),
  ))
}

function textOf(event: CompilerEvent): string | undefined {
  const payload = event.payload
  if (payload === null || typeof payload !== "object" || Array.isArray(payload)) return undefined
  return typeof (payload as { text?: unknown }).text === "string" ? (payload as { text: string }).text : undefined
}

/**
 * The model writes the unit's work instruction; the assigned requirement texts
 * are attached here, verbatim, so the delivered task cannot drift from the IR
 * they were selected from.  Labels carry identity and input order only: no
 * dedup and no normalization.  Each passage names the user input it came from,
 * passages run in input order, and a block drawn from several inputs states
 * that the later input governs what it changes - the reading a person gets by
 * going through the inputs in turn.  A passage the item once adopted and a
 * later batch withdrew is attached the same way, unmarked: the withdrawal stays
 * a fact of the IR and its records, while the executor reads the inputs in turn
 * instead of receiving the IR's cut.
 */
export const LATER_INPUT_GOVERNS = "These passages are in the order the user gave them; where a later input changes what an earlier passage states, the later input governs."

/** What assembly reads besides the batch: the run's input order and every passage an item has selected. */
export interface RequirementAssembly {
  /** Each user input's 1-based position among the run's user inputs. */
  inputOrder: ReadonlyMap<string, number>
  /** The text of every recorded user input, so a passage outside this batch's sources still resolves. */
  texts: ReadonlyMap<string, string>
  /** Every source span each content item has selected in this run, keyed by `contentKey(task, item)`. */
  selected: ReadonlyMap<string, readonly SourceRef[]>
}

export const contentKey = (taskId: string, itemId: string): string => `${taskId}\u0000${itemId}`

function attachAssignedRequirements(
  instruction: string,
  task: TaskIntent,
  assigned: readonly { ref: Ref; item: ContentItem }[],
  texts: ReadonlyMap<string, string | undefined>,
  assembly: RequirementAssembly | undefined,
): string {
  return [
    instruction,
    ...assigned.map(({ ref, item }) => `[assigned requirement ${ref.id}@${ref.revision} ${ref.digest}]\n${orderedRequirementText(task, item, texts, assembly)}`),
  ].join("\n\n")
}

type Interval = { source_id: string; start: number; end: number }

/**
 * The item's current passages plus the passages it once selected that no
 * current item of the task still selects, merged per input where they touch,
 * each labelled with its ordinal among the run's user inputs.  An item whose
 * text is not exactly its source passages (or a run order that does not know a
 * source) is attached as stored.
 */
function orderedRequirementText(task: TaskIntent, item: ContentItem, texts: ReadonlyMap<string, string | undefined>, assembly: RequirementAssembly | undefined): string {
  if (assembly === undefined || item.text_origin !== "source") return item.text
  const textOf = (sourceId: string): string | undefined => texts.get(sourceId) ?? assembly.texts.get(sourceId)
  const current = item.sources.map(source => source.span === undefined ? undefined : { source_id: source.source_id, start: source.span.start, end: source.span.end })
  if (current.some(interval => interval === undefined || assembly.inputOrder.get(interval.source_id) === undefined || textOf(interval.source_id) === undefined)) return item.text
  if (current.map(interval => textOf(interval!.source_id)!.slice(interval!.start, interval!.end)).join("\n\n") !== item.text) return item.text

  const active = task.content.flatMap(entry => entry.sources)
  const withdrawn = (assembly.selected.get(contentKey(task.task_id, item.item_id)) ?? []).flatMap(source => {
    const text = textOf(source.source_id)
    if (source.span === undefined || text === undefined || source.digest !== digestText(text) || source.span.end > text.length || assembly.inputOrder.get(source.source_id) === undefined) return []
    const covering = active.filter(entry => entry.source_id === source.source_id && entry.span !== undefined).map(entry => entry.span!)
    return remainders(source.span.start, source.span.end, covering)
      .filter(range => text.slice(range.start, range.end).trim())
      .map(range => ({ source_id: source.source_id, ...range }))
  })

  const passages = merge([...current as Interval[], ...withdrawn])
    .map(interval => ({ input: assembly.inputOrder.get(interval.source_id)!, start: interval.start, text: textOf(interval.source_id)!.slice(interval.start, interval.end) }))
    .sort((a, b) => a.input - b.input || a.start - b.start)
  const labelled = passages.map(passage => `[user input ${passage.input}]\n${passage.text}`).join("\n\n")
  return new Set(passages.map(passage => passage.input)).size > 1 ? `${LATER_INPUT_GOVERNS}\n${labelled}` : labelled
}

/** Overlapping or touching intervals of one input become one passage, as materialization joins them. */
function merge(intervals: readonly Interval[]): Interval[] {
  const merged: Interval[] = []
  for (const interval of [...intervals].sort((a, b) => a.source_id.localeCompare(b.source_id) || a.start - b.start)) {
    const last = merged.at(-1)
    if (last?.source_id === interval.source_id && last.end >= interval.start) last.end = Math.max(last.end, interval.end)
    else merged.push({ ...interval })
  }
  return merged
}

/** The parts of [start, end) that no covering span reaches. */
function remainders(start: number, end: number, covering: readonly { start: number; end: number }[]): Array<{ start: number; end: number }> {
  const found: Array<{ start: number; end: number }> = []
  let cursor = start
  for (const span of [...covering].sort((a, b) => a.start - b.start)) {
    if (span.end <= cursor || span.start >= end) continue
    if (span.start > cursor) found.push({ start: cursor, end: Math.min(span.start, end) })
    cursor = Math.max(cursor, span.end)
    if (cursor >= end) return found
  }
  if (cursor < end) found.push({ start: cursor, end })
  return found
}

/** Each user input's 1-based position among the run's user inputs, from the event journal. */
export function userInputOrder(records: readonly { sequence: number; event: CompilerEvent }[]): Map<string, number> {
  return new Map([...records]
    .filter(record => record.event.kind === "user_input")
    .sort((a, b) => a.sequence - b.sequence)
    .map((record, index) => [record.event.event_id, index + 1]))
}

/**
 * Every span each content item has selected in this run, read from records the
 * store already keeps: the content changes of every accepted batch (create and
 * revise sources, edit additions) and the sources of the prior IR.  A retire
 * ends the item's history, so a later item reusing the id starts fresh.
 */
export function selectedSourceHistory(
  log: readonly { status: string; candidate?: { groups: readonly CandidateGroup[] } }[],
  ir: Record<string, TaskIntent>,
): Map<string, SourceRef[]> {
  const selected = new Map<string, SourceRef[]>()
  const add = (key: string, sources: readonly SourceRef[] | undefined) => {
    if (!Array.isArray(sources)) return
    selected.set(key, [...(selected.get(key) ?? []), ...sources.filter(source => source.span !== undefined)])
  }
  for (const record of log) {
    if (record.status !== "accepted" || record.candidate === undefined) continue
    for (const group of record.candidate.groups) {
      const taskId = group.task_refs[0]
      if (taskId === undefined) continue
      for (const change of group.ir_changes) {
        if (change.action === "create" && change.target === "content") add(contentKey(taskId, change.local_ref), change.sources)
        else if (change.action === "revise" && change.target === "content") add(contentKey(taskId, change.id), change.sources)
        else if (change.action === "edit" && change.target === "content") add(contentKey(taskId, change.id), change.add as SourceRef[])
        else if (change.action === "retire" && change.target === "content") selected.delete(contentKey(taskId, change.id))
      }
    }
  }
  for (const task of Object.values(ir)) for (const item of task.content) add(contentKey(task.task_id, item.item_id), item.sources)
  return selected
}

/** Relevant old user input is evidence for retained meaning, never a fresh delegation. */
export function selectSourceEvents(
  records: readonly { event: CompilerEvent }[],
  current: readonly CompilerEvent[],
  ir: Record<string, TaskIntent>,
): CompilerEvent[] {
  const currentIds = new Set(current.map(event => event.event_id))
  const hostTaskIds = new Set(current.flatMap(event => event.task_ids ?? []))
  const singleTask = Object.keys(ir).length <= 1
  // Unscoped updates need historical context to route their meaning. Dropping
  // every source when multiple tasks exist makes retained requirements fail
  // resolution before the model can select the affected tasks.
  const needsRoutingContext = hostTaskIds.size === 0
  const citedIds = new Set<string>()
  for (const task of Object.values(ir)) {
    if (!singleTask && !needsRoutingContext && !hostTaskIds.has(task.task_id)) continue
    for (const ref of [...task.goal.sources, ...task.current_scope.sources, ...task.content.flatMap(item => item.sources)]) {
      citedIds.add(ref.source_id)
    }
  }
  return records.map(row => row.event).filter(event =>
    event.kind === "user_input" && !currentIds.has(event.event_id) && (
      citedIds.has(event.event_id) ||
      (event.task_ids ?? []).some(id => hostTaskIds.has(id)) ||
      singleTask || needsRoutingContext
    ),
  )
}

/** Bind coverage to current IR revisions before the Compiled Intent is built. */
export function bindCurrentRequirements(
  group: CandidateGroup,
  task: TaskIntent,
  previous: TaskIntent | undefined,
  sources: readonly CompilerEvent[],
  retainedAtoms: readonly Atom[] = [],
  assembly?: RequirementAssembly,
): CompiledIntentDraft[] {
  const currentShape = contentShape(task.content)
  const previousShape = contentShape(previous?.content ?? [])
  if (group.compilation.decision !== "replace") {
    if (currentShape !== previousShape) throw new Error(`task ${task.task_id}: IR requirements changed without replacing the compiled work`)
    for (const entry of group.coverage) {
      const id = "local_ref" in entry.requirement ? entry.requirement.local_ref : entry.requirement.id
      if (!task.content.some(item => item.item_id === id)) continue
      if ((entry.disposition === "paused" || entry.disposition === "unresolved") &&
        retainedAtoms.some(atom => atom.goal_refs.some(ref => ref.id === id))) {
        throw new Error(`IR content ${id} is ${entry.disposition} but an active Atom still carries it; replace or stop that work`)
      }
    }
    return []
  }
  if (task.content.length === 0) throw new Error(`task ${task.task_id}: compiled work needs source-backed IR.content requirements`)

  const texts = new Map(sources.filter(event => event.source.channel === "user").map(event => [event.event_id, textOf(event)]))
  const scopeTargets = new Set<string>([
    task.task_id,
    ...task.bindings.map(binding => binding.binding_id),
    ...task.outputs.map(output => output.output_id),
    ...group.compilation.drafts.filter(draft => draft.task_id === task.task_id).flatMap(draft => draft.atoms.flatMap(atom => [
      ...atom.inputs.map(input => input.binding_id), ...atom.outputs.map(output => output.output_id),
    ])),
  ])
  const items = new Map<string, ContentItem>()
  for (const item of task.content) {
    if (items.has(item.item_id)) throw new Error(`task ${task.task_id}: duplicate IR content id ${item.item_id}`)
    items.set(item.item_id, item)
    if (!item.text.trim()) throw new Error(`IR content ${item.item_id} has empty requirement text`)
    if (item.scope.length === 0 || item.scope.some(scope => !scopeTargets.has(scope.target_id))) {
      throw new Error(`IR content ${item.item_id} needs a resolvable task, input or output scope`)
    }
    if (item.sources.length === 0) throw new Error(`IR content ${item.item_id} has no user source span`)
    for (const source of item.sources) {
      const raw = texts.get(source.source_id)
      if (raw === undefined || source.span === undefined || source.span.end > raw.length || source.digest !== digestText(raw)) {
        throw new Error(`IR content ${item.item_id} must cite a resolvable user text span`)
      }
    }
  }

  const drafts = group.compilation.drafts.filter(draft => draft.task_id === task.task_id)
  const atoms = new Map<string, Atom>()
  for (const draft of drafts) for (const atom of draft.atoms) {
    if (atoms.has(atom.atom_id)) throw new Error(`task ${task.task_id}: duplicate atom id ${atom.atom_id}`)
    atoms.set(atom.atom_id, atom)
  }
  const retained = new Map(retainedAtoms.map(atom => [atom.atom_id, atom]))
  const assigned = new Map<string, Ref[]>()
  const covered = new Set<string>()
  for (const entry of group.coverage) {
    const id = "local_ref" in entry.requirement ? entry.requirement.local_ref : entry.requirement.id
    const item = items.get(id)
    if (!item) continue // A task-level coverage entry remains legal, but cannot cover an IR requirement.
    if (covered.has(id)) throw new Error(`IR content ${id} has duplicate coverage entries`)
    covered.add(id)
    if ("revision" in entry.requirement) {
      // The revision is the model's own claim and must be current.  The digest
      // is code-owned: a model cannot hash an item it just created in this same
      // batch, so a placeholder digest is written back instead of rejected.
      if (entry.requirement.revision !== item.revision) throw new Error(`IR content ${id} coverage names a stale revision`)
      entry.requirement.digest = digestOf(item)
    }
    if (entry.disposition === "assigned" || entry.disposition === "supported") {
      if (entry.refs.length === 0) throw new Error(`IR content ${id} has no assigned Atom`)
      for (const destination of entry.refs) {
        const atomId = "local_ref" in destination ? destination.local_ref : destination.id
        const target = atoms.get(atomId) ?? retained.get(atomId)
        if (!target) throw new Error(`IR content ${id} points to unknown Atom ${atomId}`)
        if ("revision" in destination) {
          if (destination.revision !== target.revision) {
            throw new Error(`IR content ${id} points to an Atom revision ${atomId} that is not the current one`)
          }
          // Same principle: the destination digest is written by code, so an
          // Atom created in this batch never needs the model to hash it.
          destination.digest = atomRef(target).digest
        }
        assigned.set(atomId, [...(assigned.get(atomId) ?? []), contentRef(item)])
      }
    } else if (entry.refs.length > 0) {
      throw new Error(`IR content ${id} is ${entry.disposition} but also names an Atom`)
    }
  }
  for (const item of task.content) {
    if (!covered.has(item.item_id)) throw new Error(`IR content ${item.item_id} has no coverage destination`)
  }
  for (const atom of atoms.values()) {
    if ((assigned.get(atom.atom_id) ?? []).length === 0) {
      throw new Error(`Atom ${atom.atom_id} has no assigned current IR requirement`)
    }
    for (const constraint of atom.constraints) {
      const matching = task.content.find(item => (assigned.get(atom.atom_id) ?? []).some(ref => ref.id === item.item_id) && item.text === constraint.text && canonicalJson(item.scope) === canonicalJson(constraint.scope))
      if (!matching) throw new Error(`Atom ${atom.atom_id} constraints must repeat an assigned IR requirement verbatim with the same scope; put behavioral rules in IR.content and leave constraints empty`)
    }
  }
  for (const prior of retainedAtoms) {
    const same = atoms.get(prior.atom_id)
    if (same && same.revision === prior.revision) continue
    const superseded = (same !== undefined && same.revision > prior.revision) || drafts.some(draft => draft.atoms.some(atom =>
      atom.previous_atom_ref?.id === prior.atom_id && atom.previous_atom_ref.revision === prior.revision,
    ))
    if (superseded) {
      if (assigned.has(prior.atom_id) && !same) throw new Error(`superseded Atom ${prior.atom_id} still receives requirements`)
      continue
    }
    const expected = prior.goal_refs.filter(ref => ref.id !== task.task_id).map(ref => `${ref.id}@${ref.revision}:${ref.digest}`).sort()
    const actual = (assigned.get(prior.atom_id) ?? []).map(ref => `${ref.id}@${ref.revision}:${ref.digest}`).sort()
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
      throw new Error(`retained Atom ${prior.atom_id} has changed requirement assignments; replace or supersede it`)
    }
  }
  const contentIds = new Set([...(previous?.content ?? []), ...task.content].map(item => item.item_id))
  return drafts.map(draft => ({
    ...draft,
    intent_basis: [
      ...draft.intent_basis.filter(ref => !contentIds.has(ref.id)),
      ...task.content.map(contentRef),
    ],
    atoms: draft.atoms.map(atom => ({
      ...atom,
      task: attachAssignedRequirements(atom.task, task, task.content
        .filter(item => (assigned.get(atom.atom_id) ?? []).some(ref => ref.id === item.item_id))
        .map(item => ({ ref: contentRef(item), item })), texts, assembly),
      // Coverage owns requirement assignment. Keep only a task-level goal ref
      // supplied by the model; content refs are always code-computed.
      goal_refs: [
        ...atom.goal_refs.filter(ref => ref.id === task.task_id),
        ...task.content.filter(item => (assigned.get(atom.atom_id) ?? []).some(ref => ref.id === item.item_id)).map(contentRef),
      ],
      constraints: atom.constraints.map(constraint => {
        const item = task.content.find(item => (assigned.get(atom.atom_id) ?? []).some(ref => ref.id === item.item_id) && item.text === constraint.text && canonicalJson(item.scope) === canonicalJson(constraint.scope))!
        return { text: item.text, basis: [contentRef(item)], scope: item.scope }
      }),
    })),
  }))
}
