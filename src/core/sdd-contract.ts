import type { Candidate, CompilerEvent, Ref, TaskIntent } from "./intent-contract.js"
import type { CompilerModelV2Call } from "../model/compiler-model-v2.js"
import type { ContextReport } from "./sdd-context.js"

/** Separate persisted profile: v2 Atom stores are never interpreted as CI deliveries. */
export const SDD_PROFILE = "ci-sdd-v1" as const
export interface DeliveryDraft {
  decision: "deliver" | "hold"
  reason: string
  tasks: Array<{
    task_id: string
    /**
     * Where a later input changes part of a delivered requirement whose
     * original passages stay in the text: the requirement as it now holds, with
     * the input segments it rests on. Acceptance criteria are SDD's (PRD).
     */
    effective: Array<{ item_id: string; text: string; basis: Array<{ source_id: string; segment_id: string }> }>
    coverage: Array<{
      item_id: string
      disposition: "assigned" | "supported" | "paused" | "unresolved"
      explanation: string
    }>
  }>
  /**
   * The external interface the delivered requirements define, as acceptance
   * examples: every command and operation, each with at least one example whose
   * input uses the requirement's exact names and whose expected result states
   * the behaviour, fixed texts and exit codes the requirement fixes. Only
   * prd-clarify reads SDD's node 1; examples are what its acceptance criteria
   * carry downstream to design, coding and PRD check.
   */
  /**
   * The same interface as a field dictionary in the form of the PRD template's
   * "interface and data" section: for every command and every file or object it
   * reads or writes (each operation of a configuration included), its fields.
   */
  /** Only for the requirements this round writes (DeliveryRequest.to_write); unchanged ones are carried by code. */
  fields: FieldObject[]
  acceptance: AcceptanceSubject[]
  /**
   * This round's change list, from the IR change: each behaviour correction of
   * an existing command or operation (old rule → new rule) and each new command
   * or operation (with its parameter names), every one resting on items new or
   * revised in this round. Not carried: each round writes its own.
   */
  changes?: ChangeEntry[]
}
export interface ChangeEntry {
  kind: "revised" | "added"
  subject: string
  items: string[]
  old_rule: string | null
  new_rule: string
  parameters: string[]
  /** Verbatim from the original text of the items. */
  quote: string
}
/** verbatim: every expected value written by the requirements; derived: worked out from their rules; runs: the requirement's own sample input runs. */
export type ExampleTier = "verbatim" | "derived" | "runs"
export type EffectiveStatement = DeliveryDraft["tasks"][number]["effective"][number]
export interface FieldObject {
  object: string
  /** IR content items this object describes; code carries it to later rounds while they stay unchanged. */
  items: string[]
  fields: Array<{ field: string; type: string; required: string; meaning: string }>
}
export interface AcceptanceSubject {
  subject: string
  items: string[]
  examples: AcceptanceExample[]
}
/**
 * An acceptance example in words (given/expect, read by SDD) and, where the
 * requirement fixes the outcome, in a runnable form: run is the invocation
 * (arguments after the program name, input files, stdin) and check what must
 * hold. Code marks it checkable only when every expected value is written
 * verbatim by the delivered requirements; others stay words only.
 */
export interface AcceptanceExample {
  given: string
  expect: string
  run?: { args: string[]; files: Array<{ path: string; content: string }>; stdin: string | null } | null
  check?: {
    exit_code: number | null
    stdout_exact: string | null
    stdout_contains: string[]
    stderr_contains: string[]
    files: Array<{ path: string; exact: string | null; contains: string[] }>
  } | null
  /** Set by code, not by the model: whether it runs, why not, and the assertions built from the requirement text. */
  checkable?: boolean
  not_checkable?: string[]
  exit_code?: number | null
  asserts?: Array<{ where: string; mode: "exact" | "contains" | "pattern" | "lines" | "exists" | "absent"; value: string; source: string }>
}
/** An item_id → revision map: the item versions an entry was written for. */
export type ItemRevisions = Record<string, number>
/**
 * The delivery's whole interface contract: entries carried unchanged from the
 * previous accepted delivery plus those this round's CI wrote, each bound to
 * the item versions it describes; what was dropped and why.
 */
export interface DeliveryContract {
  fields: Array<FieldObject & { revisions: ItemRevisions; carried: boolean }>
  acceptance: Array<AcceptanceSubject & { revisions: ItemRevisions; carried: boolean }>
  effective: Array<{ task_id: string; revision: number; entry: EffectiveStatement; carried: boolean }>
  dropped: Array<{ kind: "field" | "acceptance" | "effective" | "executable" | "change"; name: string; reason: string }>
  /**
   * Executable examples written by the separate examples call: tier "verbatim"
   * (every expected value written by the requirements) and tier "derived"
   * (values worked out from the requirement's rules, kept only when an
   * independent derivation gave the same check). Carried while their items are unchanged.
   */
  executable?: Array<ExecutableExample & { revisions: ItemRevisions; carried: boolean }>
}
export interface ExecutableExample extends AcceptanceExample {
  id: string
  subject: string
  items: string[]
  tier: ExampleTier
}
export interface CIDelivery {
  profile: typeof SDD_PROFILE
  ref: Ref
  event_id: string
  ir_digest: string
  draft: DeliveryDraft
  /**
   * Exactly what SDD receives: every user input verbatim, in order and in the
   * SDD-only arm's form, minus `removed`, with effective statements placed after
   * the passage they change. Frozen before checking.
   */
  text: string
  /** Original text cut from the delivery, with the IR judgement behind each cut. Recorded, not sent to SDD. */
  removed: RemovedPassage[]
  /** Field-dictionary objects the model listed without any named field; left out of the text. */
  field_objects_left_out?: string[]
  /** Interface names the delivered text writes that no dictionary object listed; code added them under one object. */
  field_names_added?: string[]
  /** Carried and newly written contract entries; the next round carries from here. */
  contract: DeliveryContract
  /** This round's change list as delivered: the model's entries that rest on this round's IR change, and entries code filled for changed items none covered. */
  changes?: Array<ChangeEntry & { filled_by_code?: boolean; quote_replaced?: boolean }>
  /** The draft gave no change list: every entry is code's. */
  changes_not_given?: boolean
  /** The failure ledger as code computed it for this delivery; open entries are in the text's own section. */
  ledger?: LedgerEntry[]
  /** What the separate examples call did; it never holds back the delivery. */
  examples_call?: { state: "written" | "failed" | "skipped"; reason?: string; verbatim: number; derived_kept: number; derived_dropped: number; not_checkable: number; invalid_input?: number; runs_kept?: number; runs_dropped?: number }
}
/** One failing example or open PRD gap of the code a delivery starts from. */
export interface LedgerEntry {
  id: string
  kind: "example" | "prd_gap"
  /** For an example: verbatim (expected values written by the requirements) or derived (worked out from their rules). */
  tier?: ExampleTier
  subject: string
  items: string[]
  revisions: ItemRevisions
  example?: AcceptanceExample
  /** The user update whose run first failed it. */
  first_failed: string
  last: { event_id: string; run_id: string; passed: boolean; observed: string }
  state: "open" | "closed" | "removed"
  removed_reason?: string
}
/** A passage an accepted or the current IR selected that this delivery does not deliver. */
export interface RemovedPassage {
  input: number
  source_id: string
  start: number
  end: number
  text: string
  /** Items of earlier accepted IRs that selected it, as item_id@revision. */
  selected_before: string[]
  /** Items of the current IR that still select it with their disposition; empty when none does. */
  now: Array<{ item: string; disposition: string }>
}
/** SDD's own PRD consistency check of the delivered code (prd-check), read deterministically. */
export interface PrdCheckSummary {
  /** Upstream main-prdcheck state, e.g. PASS, FAIL, NEED_MANUAL_DECISION; null when not reached. */
  state: string | null
  status: string
  unresolved: number | null
  blocked: number | null
  manual_review: number | null
  /** GAPs still open after the last check round, with the report's own text. */
  open_gaps: Array<{ title: string; text: string }>
  report: string
}
export interface SddResult {
  event_id: string
  run_id: string
  ci_ref: Ref
  status: "finished" | "blocked" | "interrupted"
  sdd_status: "pass" | "not_passed" | "unknown"
  stages: Record<string, string>
  artifacts: Array<{ path: string; digest: string; text?: string }>
  source_digest: string
  /** Requirement-level feedback comes from SDD's PRD check; IC makes no separate assessment. */
  prd_check?: PrdCheckSummary
  /** The delivery's checkable examples run by the host against this run's code. */
  example_results?: Array<{ id: string; passed: boolean; failures: string[] }>
  reason: string
}
export interface SddRun {
  run_id: string
  ci_ref: Ref
  event_id: string
  baseline: { path: string; digest: string }
  config_digest: string
  state: "preparing" | "prepared" | "launching" | "running" | "returned"
  directory?: string
  result?: SddResult
  /** Set when the experiment's fixed rule voided this round; the next round, or a retry of it, started from this round's baseline. */
  voided?: { reason: string }
  /** A rerun of the same delivery from the same baseline after this earlier run of it was voided. */
  retry_of?: string
  /** Set when the operator adopted an earlier returned run of the same update as that update's result; this later attempt no longer counts. */
  superseded?: { by: string; reason: string }
}
export interface SddBatch {
  event_id: string
  requests_used: number
  max_requests: number
  state: "ir" | "ci" | "check" | "examples" | "accepted" | "rejected"
  parent?: { ir: Record<string, TaskIntent>; candidate: Candidate; digest: string }
  delivery?: CIDelivery
  /** The latest CI answer that decoded, kept for a repair to revise (see DeliveryRequest.previous_draft). */
  last_draft?: DeliveryDraft
  error?: string
  /** context: what the request showed of the store, recorded before the call. */
  calls: Array<{ stage: string; call?: CompilerModelV2Call; error?: string; context?: ContextReport; normalized?: Array<{ path: string; from: unknown; to: unknown; reason: string }> }>
  /** Every check verdict, with which findings resolved against the request and so could block. */
  checks?: SddCheckRecord[]
  /** Explicit resumptions of this batch after rejection: why, how many extra calls, and the state left behind. */
  reopened?: Array<{ reason: string; extra_requests: number; requests_used: number; previous_error: string }>
}
export interface SddCheckFinding {
  dimension: string
  claim: string
  expected: string
  observed: string
  refs: Array<{ id: string; revision: number; quote: string }>
  /** blocking: invents a name or behaviour, carries withdrawn or paused content, contradicts the requirement, or cuts wrongly. note: anything else; recorded only. */
  severity: "blocking" | "note"
  /** True when at least one ref names material this check request showed. Only resolved blocking findings send the batch back. */
  evidence_resolved: boolean
}
export interface SddCheckRecord {
  verdict: "consistent" | "inconsistent"
  repair_stage: "none" | "ir" | "ci"
  findings: SddCheckFinding[]
}
export interface SddSnapshot {
  profile: typeof SDD_PROFILE
  run_id: string
  events: CompilerEvent[]
  ir: Record<string, TaskIntent>
  batches: SddBatch[]
  runs: SddRun[]
}
