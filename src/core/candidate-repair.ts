import { digestOf, isRecord, type Candidate } from "./intent-contract.js"

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
  if (!isRecord(input) || !Array.isArray(input.events) || !isRecord(input.ir) || !isRecord(input.compiled)
    || !isRecord(input.atom_refs) || !Array.isArray(input.executions) || !isRecord(input.contract)) return undefined
  return {
    digest: digestOf({
      events: input.events,
      source_events: input.source_events ?? [],
      source_segments: input.source_segments ?? [],
      event_source_refs: input.event_source_refs ?? [],
      ir: input.ir,
      compiled: input.compiled,
      existing_objects: input.existing_objects ?? null,
      atom_refs: input.atom_refs,
      executions: input.executions,
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
  return {
    source_request_id: sourceRequestId,
    candidate: structuredClone(candidate),
    candidate_digest: digestOf(candidate),
    basis_event_ids: before?.eventIds ?? [],
    ...(before === undefined ? {} : { basis_digest: before.digest }),
    ...(current === undefined ? {} : { current_basis_digest: current.digest }),
    basis_status: before === undefined || current === undefined ? "unavailable" : before.digest === current.digest ? "unchanged" : "changed",
    instruction: "This is a rejected draft, not accepted work. Start from it and repair the supported error and all its consequences under the current contract. Preserve unrelated correct fields; returning a complete candidate does not mean regenerating the plan. A representation error does not authorize changing user meaning, and a semantic correction must reach every affected IR item and Atom field, coverage entry and Relation. Reconcile changed or unavailable input basis, including historical sources, before retaining content. Equal basis fingerprints mean equal supplied values, not semantic correctness. No check result, permission or acceptance is inherited. Evaluate rejection reasons against the supplied sources; do not satisfy unsupported objections by changing correct work.",
  }
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
