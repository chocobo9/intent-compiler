import { digestOf, digestText, isRecord, type Candidate } from "./intent-contract.js"

/** A rejected draft is a starting point, never an accepted intent or permission. */
export interface CandidateRepairContext {
  source_request_id: string
  candidate: Candidate
  candidate_digest: string
  basis_event_ids: string[]
  basis_digest?: string
  current_basis_digest?: string
  basis_status: "unchanged" | "changed" | "unavailable"
  instruction: string
}

export interface CandidateChanges {
  from_digest: string
  to_digest: string
  path_count: number
  paths: string[]
  truncated: boolean
}

/** Fingerprint supplied facts, not budget counters or recursively nested repair history. */
function inputBasis(input: unknown): { digest: string; eventIds: string[] } | undefined {
  // Stage-scoped requests legitimately omit bodies their operation cannot use
  // (an IR-stage request carries no compiled plan); the fingerprint covers what
  // that request did supply, so a missing body is fingerprinted as absent.
  if (!isRecord(input) || !Array.isArray(input.events) || !isRecord(input.ir) || !isRecord(input.contract)) return undefined
  return {
    digest: digestOf({
      events: input.events,
      source_events: input.source_events ?? [],
      source_segments: input.source_segments ?? [],
      event_source_refs: input.event_source_refs ?? [],
      ir: input.ir,
      compiled: input.compiled ?? null,
      existing_objects: input.existing_objects ?? null,
      atom_refs: input.atom_refs ?? null,
      executions: input.executions ?? null,
      atom_states: input.atom_states ?? null,
      execution_outcomes: input.execution_outcomes ?? null,
      assessments: input.assessments ?? null,
      capabilities: input.capabilities ?? null,
      contract: input.contract,
    }),
    eventIds: input.events.filter(isRecord).map((event) => event.event_id).filter((id): id is string => typeof id === "string"),
  }
}

export function candidateRepairContext(
  sourceRequestId: string,
  candidate: Candidate,
  sourceInput: unknown,
  currentInput: unknown,
): CandidateRepairContext {
  const before = inputBasis(sourceInput)
  const current = inputBasis(currentInput)
  const draft = responseDraft(candidate, currentInput)
  return {
    source_request_id: sourceRequestId,
    candidate: draft,
    candidate_digest: digestOf(draft),
    basis_event_ids: before?.eventIds ?? [],
    ...(before === undefined ? {} : { basis_digest: before.digest }),
    ...(current === undefined ? {} : { current_basis_digest: current.digest }),
    basis_status: before === undefined || current === undefined ? "unavailable" : before.digest === current.digest ? "unchanged" : "changed",
    instruction: "This is a rejected draft, not accepted work or a complete inventory of the task. Determine what must remain from the current delegation, valid retained requirements and applicable updates; preserve unrelated correct fields and restore still-required content missing from this draft. Repair the supported error and its consequences throughout IR selections, Atom fields, coverage and Relations. If the rule is supported but its citation is wrong, correct the citation; if the rule itself lacks support, correct its meaning rather than inventing support. Valid normalized content selections are expressed here as response-compatible segment_id or span selectors for the same text. Copy these unchanged selectors exactly; do not paraphrase or recompute their ranges. A source left invalid or unavailable still needs correction against current input. Returning a complete candidate does not mean regenerating the plan or its identities. Reconcile changed or unavailable input basis, including historical sources, before retaining content. Equal basis fingerprints mean equal supplied values, not semantic correctness. No check result, permission or acceptance is inherited. Evaluate rejection reasons against the supplied sources; do not satisfy unsupported objections by changing correct work.",
  }
}

/** Change only addressing syntax, never the selected text or a rejected citation. */
function responseDraft(candidate: Candidate, input: unknown): Candidate {
  const draft = structuredClone(candidate)
  if (!isRecord(input)) return draft
  const texts = new Map<string, string>()
  for (const event of [...(Array.isArray(input.source_events) ? input.source_events : []), ...(Array.isArray(input.events) ? input.events : [])]) {
    if (isRecord(event) && typeof event.event_id === "string" && isRecord(event.source) && event.source.channel === "user"
      && isRecord(event.payload) && typeof event.payload.text === "string") texts.set(event.event_id, event.payload.text)
  }
  const segments = Array.isArray(input.source_segments) ? input.source_segments.filter(isRecord) : []
  for (const group of draft.groups) for (const change of group.ir_changes) {
    if ((change.action !== "create" && change.action !== "revise") || change.target !== "content") continue
    for (const source of change.sources) {
      if (source.quote !== undefined || source.segment_id !== undefined) continue
      const text = texts.get(source.source_id), span = source.span
      if (text === undefined || source.digest !== digestText(text) || !span || span.unit !== "utf16"
        || !Number.isInteger(span.start) || !Number.isInteger(span.end) || span.start < 0 || span.end <= span.start || span.end > text.length) continue
      const selected = text.slice(span.start, span.end)
      const segment = segments.find(item => item.source_id === source.source_id && typeof item.segment_id === "string"
        && isRecord(item.span) && item.span.unit === "utf16" && item.span.start === span.start && item.span.end === span.end && item.text === selected)
      // A whole segment keeps its concise id; anything smaller keeps the exact
      // code-computed span. Never rewrite a span into a hand-copied quote: that
      // is the addressing form a model is most likely to reproduce wrongly.
      if (segment) {
        source.segment_id = segment.segment_id as string
        delete source.span
      }
    }
  }
  return draft
}

/** Exact JSON differences for audit only; no path or count participates in admission. */
export function candidateChanges(before: Candidate, after: Candidate): CandidateChanges {
  const paths: string[] = []
  let pathCount = 0
  const record = (path: string): void => { pathCount++; if (paths.length < 100) paths.push(path) }
  const childPath = (path: string, key: string): string => `${path}/${key.replaceAll("~", "~0").replaceAll("/", "~1")}`
  const visit = (left: unknown, right: unknown, path: string): void => {
    if (Object.is(left, right)) return
    if (Array.isArray(left) && Array.isArray(right)) {
      for (let index = 0; index < Math.max(left.length, right.length); index++) {
        const child = childPath(path, String(index))
        if (index >= left.length || index >= right.length) record(child)
        else visit(left[index], right[index], child)
      }
    } else if (isRecord(left) && isRecord(right)) {
      for (const key of [...new Set([...Object.keys(left), ...Object.keys(right)])].sort()) {
        const child = childPath(path, key)
        if (!Object.hasOwn(left, key) || !Object.hasOwn(right, key)) record(child)
        else visit(left[key], right[key], child)
      }
    } else record(path)
  }
  visit(before, after, "")
  return { from_digest: digestOf(before), to_digest: digestOf(after), path_count: pathCount, paths, truncated: paths.length < pathCount }
}
