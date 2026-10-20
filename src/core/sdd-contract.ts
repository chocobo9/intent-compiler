import type { Candidate, CompilerEvent, Ref, TaskIntent } from "./intent-contract.js"
import type { CompilerModelV2Call } from "../model/compiler-model-v2.js"
import type { ContextReport } from "./sdd-context.js"
import type { RunObservation } from "./sdd-landing.js"

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
  /** Examples select original passages; code delivers their text verbatim. */
  acceptance: DraftAcceptance[]
  /**
   * This round's change list, from the IR change: each behaviour correction of
   * an existing command or operation (old rule → new rule) and each new command
   * or operation (with its parameter names), every one resting on items new or
   * revised in this round. Not carried: each round writes its own.
   */
  changes?: ChangeEntry[]
  /**
   * Written by CI answers before rulings moved to the IR stage (v7 R10 fix); read for old stores only.
   * Rulings are the IR's (RulingEntry), and the CI no longer writes its own.
   */
  conflicts?: ConflictEntry[]
}
/** One inconsistency in the original requirements as the model reads it. */
export interface ConflictEntry { subject: string; items: string[]; passages: SegmentRef[]; ruling: string; basis: string }
/**
 * How the original requirements are read where their text alone does not settle it, as the IR answer gives it
 * (v7 R10 fix): two passages that disagree (conflict); an update naming something of the earlier requirements by
 * a name or description the earlier passages do not write (identity); an update changing part of a passage whose
 * rest stands (partial); or, answering a ruling question, the earlier state an update describes not being written
 * in the original (unstated). Code quotes the passages and keeps the ruling as management state across rounds.
 */
export interface RulingEntry {
  kind: "conflict" | "identity" | "partial" | "unstated"
  subject: string
  item_ids: string[]
  passages: SegmentRef[]
  /** What now holds, in the model's words. */
  holds: string
  basis: string
  /** identity: said is the name as the later update writes it, written as an earlier passage writes it (unstated: empty). */
  values: Array<{ said: string; written: string }>
  /** The ruling question (an open revision's id) this answers; empty otherwise. */
  question: string
  /** The id of a current ruling this one replaces; empty otherwise. */
  replaces: string
}
/** An original passage, by the segment ids the request lists. */
export interface SegmentRef { source_id: string; segment_id: string }
/** An original passage as delivered: the segment's verbatim text and the user input (1-based) it comes from. */
export interface Quote extends SegmentRef { input: number; text: string }
export interface DraftAcceptance { subject: string; items: string[]; examples: Array<{ given: SegmentRef[]; expect: SegmentRef[] }> }
/** One change of this update as the model gives it: which passages state it, and which values it replaces. */
export interface ChangeEntry {
  kind: "revised" | "added"
  subject: string
  items: string[]
  /** The command and operation names the change concerns, as written. */
  subjects: string[]
  /** For revised: segments of earlier inputs stating the rule it replaces. */
  before: SegmentRef[]
  /** Segments of this update stating the change. */
  now: SegmentRef[]
  /** Values or names the change replaces, as written in before; and those replacing them, as written in now. */
  old_values: string[]
  new_values: string[]
  parameters: string[]
  /**
   * For revised: the words of this update, copied exactly, that say an existing rule is replaced, changed or
   * removed. The kind is the model's judgment from the update's wording, never from a difference between old
   * and new names (an update that adds fields alongside existing ones is added).
   */
  wording?: string
}
/** A change entry as delivered: references resolved to verbatim quotes, values and subjects code found written. */
export interface SettledChange {
  kind: "revised" | "added"
  subject: string
  items: string[]
  subjects: string[]
  before: Quote[]
  now: Quote[]
  old_values: string[]
  new_values: string[]
  parameters: string[]
  filled_by_code?: boolean
  /** For a revision: the update's own words it rests on (verbatim in now). */
  wording?: string
  /** before taken by code from the previous versions of the items (the answer cited none). */
  before_by_code?: boolean
  /** What a revision lacks (before, subjects): recorded for tracing. Missing old values are asked of the IR as a ruling question. */
  missing?: string[]
  /** The ruling a revision's old values rest on: stated (identity, the earlier name as written) or not stated in the original. */
  ruled?: { ruling: string; stated: boolean }
}
/**
 * A revision carried with every delivery until code confirms the code meets it
 * (every executable example written for its items at or after it passes on the
 * code a run returned, and there is at least one) or a later input replaces it.
 */
export interface RevisionEntry extends SettledChange {
  id: string
  /** The user update that made the change, and its 1-based input number. */
  event_id: string
  input: number
  revisions: ItemRevisions
  /** review: it rests on no words of its update; the revision itself is to be checked, and it is no longer delivered. */
  state: "open" | "confirmed" | "superseded" | "review"
  closed?: { event_id: string; reason: string }
}
/** verbatim: every expected value written by the requirements; derived: worked out from their rules; runs: the requirement's own sample input runs. */
export type ExampleTier = "verbatim" | "derived" | "runs"
export type EffectiveStatement = DeliveryDraft["tasks"][number]["effective"][number]
export interface FieldObject {
  object: string
  /** IR content items this object describes; code carries it to later rounds while they stay unchanged. */
  items: string[]
  /** required_wording: for yes or no, the requirements' own words saying so (code checks they are written). */
  fields: Array<{ field: string; type: string; required: string; required_wording?: string; meaning: string }>
  /** Set by code: the facts (names, values) the entry states, normalized; a revision of one of them drops it. */
  facts?: string[]
  /**
   * In a CI answer: the object of fields_to_revise this entry edits (its rows are the ones added or changed) and
   * the field names it removes; code merges the edit onto that object, keeping every other row.
   */
  revises?: string
  removed?: string[]
}
export interface AcceptanceSubject {
  subject: string
  items: string[]
  examples: AcceptanceExample[]
  facts?: string[]
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
  /** The original passages given and expect deliver verbatim (acceptance examples). */
  given_quotes?: Quote[]
  expect_quotes?: Quote[]
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
  dropped: Array<{ kind: "field" | "acceptance" | "effective" | "executable" | "change" | "conflict"; name: string; reason: string }>
  /**
   * Executable examples written by the separate examples call: tier "verbatim"
   * (every expected value written by the requirements) and tier "derived"
   * (values worked out from the requirement's rules, kept only when an
   * independent derivation gave the same check). Carried while their items are unchanged.
   */
  executable?: Array<ExecutableExample & { revisions: ItemRevisions; carried: boolean }>
  /** The revision ledger as of this delivery: open entries are delivered, closed ones stay recorded. */
  revisions?: RevisionEntry[]
  /** Items whose entries code dropped because a revision replaced a fact they state: written again next round. */
  rewrite_next?: string[]
  /**
   * Management's rulings on the original requirements (made at the IR stage), kept as state: delivered every round
   * until a later IR replaces or withdraws one, or every item it rules on is withdrawn, so a ruling does not depend
   * on SDD's PRD to reach later rounds.
   */
  conflicts?: Array<SettledConflict & { revisions: ItemRevisions; carried: boolean }>
}
/**
 * A ruling as delivered: the IR's reading and basis, its passages quoted by code. Entries written by a CI answer
 * before the R10 fix have no id or kind (read as conflicts).
 */
export interface SettledConflict {
  subject: string
  items: string[]
  quotes: Quote[]
  ruling: string
  basis: string
  id?: string
  kind?: RulingEntry["kind"]
  /** identity: the update's name and the earlier name as written; unstated: said only. */
  values?: Array<{ said: string; written: string }>
  /** The open revision this ruling answers. */
  question?: string
  /** The earlier ruling this one replaces. */
  replaces?: string
  /** A′: said/written values code did not find as written in the passages (recorded, not rejected). */
  unverified?: string[]
  event_id?: string
}
export interface ExecutableExample extends AcceptanceExample {
  id: string
  subject: string
  items: string[]
  tier: ExampleTier
  facts?: string[]
  /** Set by code: whether every input it gives is the requirement's own (only those are delivered to SDD). */
  original_inputs?: boolean
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
  /** Fields written or carried as required yes/no without the requirements' own words saying so: delivered as not stated. */
  required_not_stated?: Array<{ object: string; field: string; was: string }>
  /** Carried and newly written contract entries; the next round carries from here. */
  contract: DeliveryContract
  /** This round's change list as delivered: the model's entries that rest on this round's IR change, and entries code filled for changed items none covered. */
  changes?: SettledChange[]
  /**
   * Incremental delivery (from the second update): the PRD SDD wrote for an
   * earlier update stands for the inputs up to it; only later inputs follow
   * verbatim. Absent: every input is delivered (the first update, or no PRD yet).
   */
  baseline_prd?: { run_id: string; event_id: string; input: number; digest: string; chars: number }
  /** Every input as SDD alone would receive it, minus cuts: what names and examples are checked against. */
  reference_text?: string
  /**
   * v8 zoning, recorded: this update's change entries, earlier changes put back in the change zone with their
   * evidence, earlier open revisions in the status zone, and how many earlier changes are of unknown landing.
   */
  zones?: { changes: number; not_landed: Array<{ input: number; subject: string; evidence: string }>; status: Array<{ input: number; subject: string }>; unknown: number }
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
  kind: "example" | "prd_gap" | "acceptance" | "recorded"
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
  /** Whether every fact the example states still holds (no open revision replaced one); recorded, not fed back. */
  facts_valid?: boolean
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
  /** IC's in-round acceptance of the returned code (static unit check, code-built error probes): checks still failing. */
  /** recorded: findings IC records but never feeds back (P1/P2 of classes the V2 gate keeps closed, P3 suspected regressions, P4 summary gaps). */
  acceptance?: { outcome: string; checks: number; open: Array<{ id: string; subject: string; observed: string }>; recorded?: Array<{ id: string; subject: string; observed: string }>;
    /** C2: P1/P2 checks of classes the V2 gate opens that pass on this run's code (P2 with the key names its output holds). */
    verified?: Array<{ class: string; name: string; output_keys: string[] }> }
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
  /** rulings: this update's rulings as settled from the IR answer; withdrawn: ids of current rulings the IR withdrew. */
  parent?: { ir: Record<string, TaskIntent>; candidate: Candidate; digest: string; rulings?: SettledConflict[]; withdrawn_rulings?: Array<{ id: string; reason: string }> }
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
  /** v8: what the host read back from the earlier runs (repairs, passing checks), recorded with the batch; zoning reads it. */
  observations?: RunObservation[]
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
