import {
  canonicalJson,
  digestOf,
  isRefOrSource,
  isRecord,
  requireNonEmptyString,
  requireNonNegativeInteger,
  refKey,
  validateCompiledIntent,
  type Atom,
  type AtomDraft,
  type AtomStateRecord,
  type AtomStatus,
  type CompiledIntent,
  type CompiledIntentDraft,
  type Condition,
  type Ref,
  type Scope,
  type SourceRef,
} from "./intent-contract.js"

export interface CompiledIntentBuildResult {
  ok: boolean
  intents: Record<string, CompiledIntent>
  atom_states: AtomStateRecord[]
  errors: string[]
}

export interface BuildCompiledIntentOptions {
  /** Code-generated identity for the compiled intent; the model proposes none. */
  nextCompiledIntentId: () => string
  now?: () => string
}

/**
 * Convert validated model drafts into immutable Compiled Intent records.
 * Revision assignment, the compiled intent identity, and the atom state
 * ledger are produced by code; the model may propose only local_refs and
 * content.  Atoms are content only: lifecycle state for each atom content
 * identity is written to `atom_states`, and a supersession the model proposes
 * through `previous_atom_ref` is recorded there rather than on the atom.
 */
export function buildCompiledIntents(
  current: Record<string, CompiledIntent | undefined>,
  drafts: readonly CompiledIntentDraft[],
  options: BuildCompiledIntentOptions,
): CompiledIntentBuildResult {
  const intents: Record<string, CompiledIntent> = {}
  const atomStates: AtomStateRecord[] = []
  const errors: string[] = []
  const now = options.now ?? (() => new Date().toISOString())
  // Resolve new endpoints only after requirement binding has produced final
  // Atom content. The model cannot compute these digests in its proposal.
  let proposedAtoms: Atom[]
  try {
    proposedAtoms = drafts.flatMap(draft => draft.atoms).map(normalizeAtomDraft).map(contentOf)
  } catch (error) {
    return { ok: false, intents, atom_states: atomStates, errors: [errorMessage(error)] }
  }
  const availableAtoms = [...proposedAtoms, ...Object.values(current).flatMap(intent => intent?.atoms ?? [])]
  const resolveEndpoint = (value: unknown): Ref => {
    if (isRecord(value) && typeof value.local_ref === "string") {
      const matches = proposedAtoms.filter(atom => atom.atom_id === value.local_ref)
      if (matches.length !== 1) throw new Error(`relation local endpoint ${value.local_ref} must resolve to exactly one new Atom`)
      return atomRef(matches[0]!)
    }
    const ref = normalizeRef(value)
    if (!availableAtoms.some(atom => atom.atom_id === ref.id && atom.revision === ref.revision && atomRef(atom).digest === ref.digest)) {
      throw new Error(`relation endpoint ${ref.id}@${ref.revision} has an unknown identity or digest`)
    }
    return ref
  }

  for (const draft of drafts) {
    try {
      if (!isRecord(draft)) throw new Error("draft must be an object")
      const taskId = requireNonEmptyString(draft.task_id, "draft.task_id")
      const revision = (current[taskId]?.compiled_revision ?? -1) + 1
      const compiledIntentId = options.nextCompiledIntentId()
      const previousAtoms = current[taskId]?.atoms ?? []
      const newAtoms = (Array.isArray(draft.atoms) ? draft.atoms : []).map(normalizeAtomDraft).map(atom => {
        const previous = previousAtoms.filter(prior => prior.atom_id === atom.atom_id).sort((a, b) => b.revision - a.revision)[0]
        return atom.previous_atom_ref === undefined && previous && atom.revision > previous.revision
          ? { ...atom, previous_atom_ref: atomRef(previous) }
          : atom
      })
      for (const atom of newAtoms) {
        const previous = atom.previous_atom_ref
        if (!previous) continue
        const prior = previousAtoms.find((candidate) => candidate.atom_id === previous.id && candidate.revision === previous.revision)
        if (!prior) throw new Error(`previous_atom_ref references unknown atom ${previous.id}@${previous.revision}`)
        if (prior.atom_id === previous.id && atomRef(prior).digest !== previous.digest) {
          throw new Error(`previous_atom_ref digest does not match atom ${previous.id}@${previous.revision}`)
        }
      }
      const intent: CompiledIntent = {
        schema_version: 2,
        artifact_type: "compiled_intent",
        compiled_intent_id: compiledIntentId,
        task_id: taskId,
        compiled_revision: revision,
        intent_basis: normalizeRefArray(draft.intent_basis),
        atoms: [
          ...newAtoms.map(contentOf),
          // Earlier atoms stay listed so the artifact keeps its own history
          // (a superseded atom is visible next to the atom that replaces it);
          // dispatchability comes from the state ledger, not from this list.
          ...previousAtoms.filter((atom) => !newAtoms.some((proposed) => proposed.atom_id === atom.atom_id && proposed.revision === atom.revision)),
        ],
        relations: (Array.isArray(draft.relations) ? draft.relations : []).map(value => normalizeRelation(value, resolveEndpoint)),
        attachments: (Array.isArray(draft.attachments) ? draft.attachments : []).filter(isRefOrSource),
      }
      validateCompiledIntent(intent)
      intents[taskId] = intent
      for (const atom of newAtoms) {
        atomStates.push({
          task_id: taskId,
          atom_id: atom.atom_id,
          atom_revision: atom.revision,
          compiled_intent_id: compiledIntentId,
          status: "ready",
          created_at: now(),
          updated_at: now(),
          ...(atom.previous_atom_ref === undefined ? {} : { previous_atom_ref: atom.previous_atom_ref }),
        })
      }
    } catch (error) {
      errors.push(errorMessage(error))
    }
  }

  // Cycles and self-dependencies have no valid start order; reject them rather
  // than accepting a permanently stalled compilation.
  const graph = new Map<string, string[]>()
  for (const intent of Object.values({ ...current, ...intents })) for (const relation of intent?.relations ?? []) {
    const from = refKey(relation.predecessor)
    const to = refKey(relation.successor)
    graph.set(from, [...(graph.get(from) ?? []), to])
  }
  const visiting = new Set<string>(), visited = new Set<string>()
  function visit(node: string): boolean {
    if (visiting.has(node)) return false
    if (visited.has(node)) return true
    visiting.add(node)
    for (const next of graph.get(node) ?? []) if (!visit(next)) return false
    visiting.delete(node)
    visited.add(node)
    return true
  }
  if ([...graph.keys()].some(node => !visit(node))) errors.push("relation dependency cycle has no valid execution order")

  return { ok: errors.length === 0, intents, atom_states: atomStates, errors }
}

export function summarizeCompiledIntent(intent: CompiledIntent): { digest: string; canonical: string } {
  validateCompiledIntent(intent)
  const canonical = canonicalJson(intent)
  return { digest: digestOf(intent), canonical }
}

export function atomRef(atom: Atom): Ref {
  return { id: atom.atom_id, revision: atom.revision, digest: digestOf(atomContent(atom)) }
}

export function compiledIntentRef(intent: CompiledIntent): Ref {
  return { id: intent.compiled_intent_id, revision: intent.compiled_revision, digest: digestOf(intent) }
}

/** Ledger key for one atom content identity; state never changes this key. */
export function atomStateKey(taskId: string, atomId: string, atomRevision: number): string {
  return `${taskId}\u0000${atomId}@${atomRevision}`
}

/**
 * Management-owned lifecycle ledger.  The atom holds content only; whether it
 * is ready, executing, completed, failed, or legacy is recorded here, keyed by
 * the atom's content identity so a reference stays valid across transitions.
 */
export class AtomStateLedger {
  private readonly records: Map<string, AtomStateRecord>

  constructor(initial: readonly AtomStateRecord[] = []) {
    this.records = new Map(initial.map((record) => [atomStateKey(record.task_id, record.atom_id, record.atom_revision), { ...record }]))
  }

  status(taskId: string, atom: Atom): AtomStatus {
    return this.records.get(atomStateKey(taskId, atom.atom_id, atom.revision))?.status ?? "ready"
  }

  record(
    taskId: string,
    atom: Atom,
    compiledIntentId: string,
    status: AtomStatus,
    patch: { previous_atom_ref?: Ref; result_ref?: Ref; now?: string } = {},
  ): void {
    const key = atomStateKey(taskId, atom.atom_id, atom.revision)
    const existing = this.records.get(key)
    const timestamp = patch.now ?? new Date().toISOString()
    const previous = patch.previous_atom_ref ?? existing?.previous_atom_ref
    const result = patch.result_ref ?? existing?.result_ref
    this.records.set(key, {
      task_id: taskId,
      atom_id: atom.atom_id,
      atom_revision: atom.revision,
      compiled_intent_id: existing?.compiled_intent_id ?? compiledIntentId,
      status,
      created_at: existing?.created_at ?? timestamp,
      updated_at: timestamp,
      ...(previous === undefined ? {} : { previous_atom_ref: previous }),
      ...(result === undefined ? {} : { result_ref: result }),
    })
  }

  apply(records: readonly AtomStateRecord[]): void {
    for (const record of records) {
      const key = atomStateKey(record.task_id, record.atom_id, record.atom_revision)
      const existing = this.records.get(key)
      // A later record for the same atom identity wins, but creation time and
      // supersession links already known are preserved.
      this.records.set(key, { ...existing, ...record, created_at: record.created_at ?? existing?.created_at })
    }
  }

  snapshot(): AtomStateRecord[] {
    return [...this.records.values()].map((record) => ({ ...record }))
  }
}

const LEGACY_ATOM_STATE_KEYS: readonly string[] = [
  "status",
  "updated_at",
  "created_at",
  "result_ref",
  "parent_compiled_intent_ref",
  "previous_atom_ref",
]

/**
 * The identity digest of an Atom covers its content only.  Lifecycle fields
 * live in the atom state ledger; they are also stripped here when reading
 * records written before the ledger existed, so old digests stay valid.
 */
function atomContent(atom: Atom): Record<string, unknown> {
  const content: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(atom as Atom & Record<string, unknown>)) {
    if (LEGACY_ATOM_STATE_KEYS.includes(key)) continue
    content[key] = value
  }
  return content
}

function contentOf(atom: AtomDraft): Atom {
  const content: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(atom as AtomDraft & Record<string, unknown>)) {
    if (LEGACY_ATOM_STATE_KEYS.includes(key)) continue
    content[key] = value
  }
  return content as unknown as Atom
}

function normalizeAtomDraft(value: unknown): AtomDraft {
  const atom = normalizeAtom(value)
  if (!isRecord(value) || value.previous_atom_ref === undefined) return atom
  return { ...atom, previous_atom_ref: normalizeRef(value.previous_atom_ref) }
}

function normalizeAtom(value: unknown): Atom {
  if (!isRecord(value)) throw new Error("atom must be an object")
  const atom: Atom = {
    atom_id: requireNonEmptyString(value.atom_id, "atom_id"),
    revision: requireNonNegativeInteger(value.revision, "atom revision"),
    goal_refs: normalizeRefArray(value.goal_refs),
    task: typeof value.task === "string" ? value.task : "",
    inputs: Array.isArray(value.inputs) ? value.inputs.filter(isRecord).map((input) => ({
      binding_id: requireNonEmptyString(input.binding_id, "input.binding_id"),
      // Never fabricate a placeholder reference: an input whose ref is not a
      // real Ref/SourceRef is a candidate defect the model has to fix, not a
      // silently empty binding the executor would receive.
      ref: (() => {
        if (!isRefOrSource(input.ref)) throw new Error(`input ${String(input.binding_id)} must carry a Ref or SourceRef`)
        return input.ref
      })(),
      role: input.role === "context" || input.role === "example" ? input.role : "task_data",
      use: typeof input.use === "string" ? input.use : "",
    })) : [],
    outputs: Array.isArray(value.outputs) ? value.outputs.filter(isRecord).map((output) => ({
      output_id: requireNonEmptyString(output.output_id, "output.output_id"),
      description: typeof output.description === "string" ? output.description : "",
      format: output.format === "json" || output.format === "artifact" ? output.format : "text",
    })) : [],
    constraints: Array.isArray(value.constraints) ? value.constraints.filter(isRecord).map((constraint) => ({
      text: typeof constraint.text === "string" ? constraint.text : "",
      basis: (Array.isArray(constraint.basis) ? constraint.basis : []).filter(isRefOrSource),
      scope: (Array.isArray(constraint.scope) ? constraint.scope.filter(isRecord) : []) as Scope[],
    })) : [],
    optional_tools: Array.isArray(value.optional_tools) ? value.optional_tools.filter((tool): tool is string => typeof tool === "string") : [],
    authority: {
      basis: (Array.isArray(value.authority?.basis) ? value.authority.basis : []).filter(isRefOrSource),
      rules: Array.isArray(value.authority?.rules) ? value.authority.rules.filter(isRecord) : [],
      lifetime: "this_execution",
      delegation: "not_supported",
    },
    preconditions: (Array.isArray(value.preconditions) ? value.preconditions.filter(isRecord) : []) as Condition[],
    completion: Array.isArray(value.completion) ? value.completion.filter(isRecord).map((item) => ({
      text: typeof item.text === "string" ? item.text : "",
      evidence_required: typeof item.evidence_required === "string" ? item.evidence_required : "",
    })) : [],
    return_when: Array.isArray(value.return_when) ? value.return_when.filter((item): item is string => typeof item === "string") : [],
    intent_judgments: Array.isArray(value.intent_judgments) ? value.intent_judgments.filter(isRecord).map((judgment) => ({
      claim: typeof judgment.claim === "string" ? judgment.claim : "",
      basis: (Array.isArray(judgment.basis) ? judgment.basis : []).filter(isRefOrSource),
      status: judgment.status === "inferred" || judgment.status === "unresolved" ? judgment.status : "supported",
      consequence: typeof judgment.consequence === "string" ? judgment.consequence : "",
    })) : [],
  }
  return atom
}

function normalizeRelation(value: unknown, resolve: (value: unknown) => Ref): CompiledIntent["relations"][number] {
  if (!isRecord(value)) throw new Error("relation must be an object")
  return {
    predecessor: resolve(value.predecessor),
    successor: resolve(value.successor),
    requires: typeof value.requires === "string" ? value.requires : "",
    conditions: (Array.isArray(value.conditions) ? value.conditions.filter(isRecord) : []) as Condition[],
    basis: (Array.isArray(value.basis) ? value.basis : []).filter(isRefOrSource),
  }
}

function normalizeRefArray(value: unknown): Ref[] {
  return Array.isArray(value) ? value.filter((item): item is Ref => isRefOrSource(item) && "id" in item).map((item) => item as Ref) : []
}

function normalizeRef(value: unknown): Ref {
  if (isRefOrSource(value) && "id" in value) return value as Ref
  throw new Error("relation predecessor/successor must be a Ref")
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
