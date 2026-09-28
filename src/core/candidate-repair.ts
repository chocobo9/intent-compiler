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
      ir: input.ir,
      compiled: input.compiled,
      existing_objects: input.existing_objects ?? null,
      atom_refs: input.atom_refs,
      executions: input.executions,
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
    instruction: "This is a rejected draft, not accepted work. Return a complete candidate; use this draft as the explicit revision starting point. Reconcile changed or unavailable input basis with all current events and state before preserving any content. Equal basis fingerprints mean only equal supplied input values, not semantic correctness. No check result, execution permission, or acceptance is inherited. Rejection reasons can be mistaken; do not change correct content merely to satisfy an unsupported objection.",
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
