import { canonicalJson, digestOf, digestText, isRecord, type CompilerEvent, type TaskIntent } from "./intent-contract.js"
import type { V2EventRecord } from "./compiler-store-v2.js"
import type { CompilerModelV2Input } from "../model/compiler-model-v2.js"
import type { IRProposal } from "../model/generation-schema.js"

/**
 * Event identities as one request presents them.  The model copies ~120-character
 * event ids today, and the recorded runs show the copy failing (spliced,
 * fabricated, truncated ids): 158 unresolved references in 39 failed IR
 * attempts.  A per-request alias removes that copying without touching what a
 * reference *means* — the code still resolves the full identity, and the
 * stored IR, the CI stage, the independent check and the execution layer keep
 * the full ids they use today.
 *
 * The alias is derived from the event's position in the run journal
 * (`e{sequence}`), not from its position in this request: a request-scoped
 * numbering would let a retried draft's `e2` silently mean a different event
 * after the source list changes.  The journal's sequence is unique per run and
 * append-only (see REVIEW-20260930 §10).
 */
export interface SourceAliasEntry {
  alias: string
  event_id: string
  digest: string
}

/** The run's verified alias domain: which alias belongs to which stored event. */
export interface SourceAliasIndex {
  lookup(eventId: string): SourceAliasEntry | undefined
  /**
   * True when the run's journal records this id as an event.  A stored id is
   * always that event, never an alias: a run whose ids could be mistaken for
   * aliases presents full ids instead (see `disabled`).
   */
  records(eventId: string): boolean
  /** Why this run presents no aliases, when the mechanism is unsafe for it. */
  disabled?: string
}

/** The shape this module mints.  A value of this shape must come from a request. */
export function isSourceAlias(value: string): boolean {
  return /^e\d+$/u.test(value)
}

/** The digest a `SourceRef` for this event carries, the same one `event_source_refs` shows. */
function sourceDigest(event: CompilerEvent): string {
  const payload = isRecord(event.payload) ? event.payload : {}
  return digestText(typeof payload.text === "string" ? payload.text : canonicalJson(event.payload ?? null))
}

/**
 * Derive the alias domain from the run journal, refusing to guess from a
 * journal that cannot be trusted: a line that does not parse, a duplicate
 * sequence or event id, or a record whose digest does not match its event all
 * mean the alias behind one id could point at another event later.  A wrong
 * alias is accepted silently, so this is a stop, not a repair the model can
 * make.
 */
export function buildSourceAliasIndex(
  journal: { records: readonly V2EventRecord[]; malformed: number },
): { ok: true; index: SourceAliasIndex } | { ok: false; message: string } {
  const problem = (detail: string): { ok: false; message: string } => ({
    ok: false,
    message: `the event journal cannot be used to derive source aliases: ${detail}. Source aliases stay disabled until the store is repaired; this is a storage integrity problem, not something a model retry can fix.`,
  })
  if (journal.malformed > 0) return problem(`${journal.malformed} line(s) cannot be read as event records`)
  const byEventId = new Map<string, SourceAliasEntry>()
  const byAlias = new Set<string>()
  const storedIds = new Set<string>()
  // An event id is any non-empty string, so it may itself read like an alias
  // (`e2`).  Then one draft's full id and another event's alias are the same
  // text, and decode could silently pick the wrong one.  Such a run keeps the
  // full-id form it had before aliases existed: nothing is guessed, and every
  // id it shows is still accepted exactly as written.
  const aliasShaped: string[] = []
  for (const record of journal.records) {
    if (!Number.isInteger(record.sequence) || record.sequence <= 0) {
      return problem(`event ${record.event?.event_id ?? "(unknown)"} carries an invalid sequence ${String(record.sequence)}`)
    }
    const alias = `e${record.sequence}`
    if (byAlias.has(alias)) return problem(`two records claim ${alias}`)
    if (byEventId.has(record.event.event_id)) return problem(`event ${record.event.event_id} appears twice`)
    // The recorded digest is the event's identity check: a mismatch means the
    // record no longer describes the event it is filed under.
    if (digestOf(record.event) !== record.digest) return problem(`the recorded digest of event ${record.event.event_id} does not match its content`)
    byAlias.add(alias)
    storedIds.add(record.event.event_id)
    if (isSourceAlias(record.event.event_id)) aliasShaped.push(record.event.event_id)
    byEventId.set(record.event.event_id, { alias, event_id: record.event.event_id, digest: sourceDigest(record.event) })
  }
  if (aliasShaped.length > 0) return {
    ok: true,
    index: {
      lookup: () => undefined,
      records: (eventId) => storedIds.has(eventId),
      disabled: `an event id in this run reads like an alias (${aliasShaped.slice(0, 3).join(", ")}); this run keeps full event ids`,
    },
  }
  return { ok: true, index: { lookup: (eventId) => byEventId.get(eventId), records: (eventId) => storedIds.has(eventId) } }
}

/** Render an event id the way the request that offered it wrote it. */
export function aliasDisplay(aliases: readonly SourceAliasEntry[]): (eventId: string) => string {
  const byEventId = new Map(aliases.map((entry) => [entry.event_id, entry.alias]))
  return (eventId) => byEventId.get(eventId) ?? eventId
}

/** Rewrite one `SourceRef`'s event identity when it carries one. */
function mapRef(value: unknown, path: string, resolve: (id: string, path: string) => string): void {
  if (!isRecord(value) || typeof value.source_id !== "string") return
  value.source_id = resolve(value.source_id, path)
}

function mapRefList(value: unknown, path: string, resolve: (id: string, path: string) => string): void {
  if (!Array.isArray(value)) return
  value.forEach((ref, index) => mapRef(ref, `${path}[${index}]`, resolve))
}

/**
 * Visit only the fields that are known to carry an event identity.  A generic
 * string replacement would also rewrite a passage that happens to contain an
 * id, so every position is named here.
 */
function mapIRProposalSourceIds(proposal: unknown, resolve: (id: string, path: string) => string): void {
  if (!isRecord(proposal)) return
  const basis = proposal.basis
  if (isRecord(basis) && Array.isArray(basis.event_ids)) {
    basis.event_ids = basis.event_ids.map((id, index) =>
      typeof id === "string" ? resolve(id, `basis.event_ids[${index}]`) : id)
  }
  if (Array.isArray(proposal.source_coverage)) {
    proposal.source_coverage.forEach((entry, index) => {
      if (!isRecord(entry)) return
      mapRef(entry.source, `source_coverage[${index}].source`, resolve)
      mapRefList(entry.basis, `source_coverage[${index}].basis`, resolve)
    })
  }
  if (Array.isArray(proposal.groups)) {
    proposal.groups.forEach((group, groupIndex) => {
      if (!isRecord(group) || !Array.isArray(group.ir_changes)) return
      group.ir_changes.forEach((change, changeIndex) => {
        if (!isRecord(change)) return
        const path = `groups[${groupIndex}].ir_changes[${changeIndex}]`
        mapRefList(change.sources, `${path}.sources`, resolve)
        // A local content edit states its addresses as remove/add/basis instead
        // of `sources`; the same alias handling has to reach all three, or an
        // edit written with this request's aliases cannot be decoded back.
        if (change.action === "edit") {
          mapRefList(change.remove, `${path}.remove`, resolve)
          mapRefList(change.add, `${path}.add`, resolve)
          mapRefList(change.basis, `${path}.basis`, resolve)
        }
        // A binding create/revise names its material in value.ref, which the
        // schema allows to be a SourceRef; it carries an event identity exactly
        // like change.sources does.
        if (isRecord(change.value)) mapRef(change.value.ref, `${path}.value.ref`, resolve)
      })
    })
  }
}

/** Every source position of one stored task (goal, scope, bindings, outputs, content). */
function mapTaskIntentSourceIds(task: TaskIntent, resolve: (id: string, path: string) => string): void {
  mapRefList(task.goal?.sources, "goal.sources", resolve)
  mapRefList(task.current_scope?.sources, "current_scope.sources", resolve)
  for (const binding of task.bindings ?? []) {
    mapRefList(binding.sources, `bindings[${binding.binding_id}].sources`, resolve)
    mapRef(binding.ref, `bindings[${binding.binding_id}].ref`, resolve)
  }
  for (const output of task.outputs ?? []) mapRefList(output.sources, `outputs[${output.output_id}].sources`, resolve)
  for (const item of task.content ?? []) mapRefList(item.sources, `content[${item.item_id}].sources`, resolve)
}

/**
 * Present one IR-stage request with aliases: only the returned copy is
 * rewritten.  The stored IR, the internal parent proposal and every digest
 * keep the full identity, so nothing downstream depends on the wire form.
 */
export function expressIRRequest(
  input: CompilerModelV2Input,
  index: SourceAliasIndex,
): { request: CompilerModelV2Input; aliases: SourceAliasEntry[] } {
  const request = structuredClone(input)
  const aliases: SourceAliasEntry[] = []
  const seen = new Map<string, SourceAliasEntry>()
  const aliasOf = (eventId: string): string => {
    const known = seen.get(eventId)
    if (known !== undefined) return known.alias
    const entry = index.lookup(eventId)
    // An id the journal does not record is left alone: the existing source
    // validation owns that defect, and inventing an alias for it would hide it.
    if (entry === undefined) return eventId
    seen.set(eventId, entry)
    aliases.push(entry)
    return entry.alias
  }
  for (const event of request.events) event.event_id = aliasOf(event.event_id)
  for (const segment of request.source_segments ?? []) segment.source_id = aliasOf(segment.source_id)
  for (const ref of request.event_source_refs ?? []) ref.source_id = aliasOf(ref.source_id)
  for (const gap of request.carried_delegations ?? []) gap.event_id = aliasOf(gap.event_id)
  if (request.gap_event_ids !== undefined) request.gap_event_ids = request.gap_event_ids.map(aliasOf)
  for (const task of Object.values(request.ir)) mapTaskIntentSourceIds(task, (id) => aliasOf(id))
  if (request.generation_repair?.ir_proposal !== undefined) mapIRProposalSourceIds(request.generation_repair.ir_proposal, (id) => aliasOf(id))
  return { request, aliases }
}

/**
 * Restore full identities in an IR answer before any existing check runs.
 * Only this request's aliases are accepted; an alias this request did not
 * offer is named as such instead of being looked up in the journal (that is
 * how a stale draft could otherwise start pointing at a different event).  A
 * full event id keeps exactly its current handling — it is left for the
 * existing validation to accept or reject.
 */
export function decodeIRProposal(
  proposal: IRProposal,
  aliases: readonly SourceAliasEntry[],
  isStoredEventId: (eventId: string) => boolean = () => false,
): { ok: true; proposal: IRProposal } | { ok: false; message: string } {
  const table = new Map(aliases.map((entry) => [entry.alias, entry.event_id]))
  const unoffered: Array<{ path: string; alias: string }> = []
  const decoded = structuredClone(proposal)
  mapIRProposalSourceIds(decoded, (id, path) => {
    // An id the run records is that event, never an alias.  A run whose ids
    // could be read as aliases presents no aliases at all, so this rule and the
    // table can never disagree about the same text.
    if (isStoredEventId(id)) return id
    const eventId = table.get(id)
    if (eventId !== undefined) return eventId
    if (isSourceAlias(id)) unoffered.push({ path, alias: id })
    return id
  })
  if (unoffered.length === 0) return { ok: true, proposal: decoded }
  const shown = unoffered.slice(0, MAX_UNOFFERED_ALIASES)
  const hidden = unoffered.length - shown.length
  const list = shown.map((item) => `${item.path} names ${item.alias}: alias_not_offered`).join("; ")
  const offered = aliases.length === 0 ? "no source aliases" : aliases.map((entry) => entry.alias).join(", ")
  return {
    ok: false,
    message: `IR sources do not resolve; ${unoffered.length} reference(s) name an alias this request did not offer.`
      + (hidden > 0 ? ` Showing the first ${shown.length} of ${unoffered.length} (${hidden} more are not listed): ${list}.` : ` Showing all ${shown.length}: ${list}.`)
      + ` This request offered ${offered}; a reference must name one of them, or a full event id this run records.`,
  }
}

/** Keep the unoffered-alias list bounded, like the source gate's own list. */
const MAX_UNOFFERED_ALIASES = 20
