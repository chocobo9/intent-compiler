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
    if ("revision" in entry.requirement && (
      entry.requirement.revision !== item.revision || entry.requirement.digest !== digestOf(item)
    )) throw new Error(`IR content ${id} coverage names a stale revision`)
    if (entry.disposition === "assigned" || entry.disposition === "supported") {
      if (entry.refs.length === 0) throw new Error(`IR content ${id} has no assigned Atom`)
      for (const destination of entry.refs) {
        const atomId = "local_ref" in destination ? destination.local_ref : destination.id
        const target = atoms.get(atomId) ?? retained.get(atomId)
        if (!target) throw new Error(`IR content ${id} points to unknown Atom ${atomId}`)
        if ("revision" in destination) {
          if (atoms.has(atomId) || destination.revision !== target.revision || destination.digest !== atomRef(target).digest) {
            throw new Error(`IR content ${id} points to a stale or unbound Atom revision ${atomId}; use local_ref for new Atoms`)
          }
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
