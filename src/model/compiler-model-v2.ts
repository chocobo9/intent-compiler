import {
  validateCandidate,
  type Candidate,
  type AtomStateRecord,
  type CapabilityCatalog,
  type CompiledIntent,
  type CompilerEvent,
  type ExecutionView,
  type Ref,
  type SourceRef,
  type SourceSegment,
  type TaskIntent,
} from "../core/intent-contract.js"
import { validateCandidateSchema } from "./candidate-schema.js"
import { validateCandidateCheckSchema } from "./candidate-check-schema.js"
import { CANDIDATE_EXAMPLE, CANDIDATE_EXAMPLE_INPUT } from "./candidate-example.js"
import type { CandidateRepairContext } from "../core/candidate-repair.js"
import type { AssessmentRecord, ExecutionOutcomeRecord } from "../core/compiler-store-v2.js"

export interface CompilerModelV2Input {
  run_id: string
  events: CompilerEvent[]
  /** Prior user text relevant to this task, for checking retained requirements. It is not a new delegation. */
  source_events?: CompilerEvent[]
  /** Addressable original text; paragraph boundaries do not determine semantic role. */
  source_segments?: SourceSegment[]
  /** Management-computed identities for the current events; digest values are not model-authored. */
  event_source_refs?: SourceRef[]
  ir: Record<string, TaskIntent>
  compiled: Record<string, CompiledIntent>
  /** Compact management-built index of the exact existing identities available to a revision. */
  existing_objects?: ExistingObjectDirectory
  atom_refs: Record<string, Ref[]>
  executions: ExecutionView[]
  /** Existing management records, supplied together so retained work and returns can be interpreted. */
  atom_states?: AtomStateRecord[]
  execution_outcomes?: ExecutionOutcomeRecord[]
  assessments?: AssessmentRecord[]
  /** Host facts; the compiler always supplies them, callers may omit in tests. */
  capabilities?: CapabilityCatalog
  budget: {
    requests_used: number
    max_requests: number
  }
  contract: Readonly<{
    schema_version: 2
    candidate_shape: string
    reference_contract: string
    compilation_contract: string
    ir_change_contract: string
    atom_contract: string
    atom_input_contract: string
    atom_output_contract: string
    judgment_contract: string
    coverage_contract: string
    checks_contract: string
    example_input: string
    example_candidate: string
    rules: readonly string[]
  }>
  validation_errors?: readonly string[]
  /** Exact rejected draft plus input provenance; never reuses acceptance or Authority. */
  repair_context?: CandidateRepairContext
  /** Prior JSON that failed the Candidate schema, retained only as revision context. */
  schema_rejected_draft?: { text: string; errors: readonly string[] }
  /**
   * Why the previous batch for these same events was rejected, when there was
   * one.  Without it a re-proposal is a re-roll: r10's second batch never saw
   * the reasons the first was rejected and simply produced a new candidate.
   * `evidence_resolved` says whether that reason cited something this input
   * contains — a reason that cited nothing did not block the batch.
   */
  previous_rejection?: {
    request_id: string
    status: string
    message: string
    findings: Array<{
      dimension: string
      claim: string
      expected: string
      observed: string
      evidence_resolved: boolean
    }>
  }
}

export interface ExistingObjectDirectory {
  tasks: Array<{
    task_id: string
    task_revision: number
    task_digest: string
    summary: string
    compiled_intent_ref?: Ref
    atoms: Array<{ ref: Ref; summary: string }>
  }>
}

export interface CompilerModelV2FailureDiagnostic {
  phase: string
  /** OpenCode response metadata only; excludes reasoning and tool input/output bodies. */
  opencode_response?: {
    session_id?: string
    message_id?: string
    info_error?: { name: string; message: string }
    sdk_error?: { name: string; message: string }
    finish_reason?: string
    completed_at?: string | number
    structured_result_present?: boolean
    tool_statuses?: Array<{
      tool: string
      call_id?: string
      status: string
      error?: { name: string; message: string }
    }>
    provider?: string
    model?: string
    usage?: CompilerModelV2Usage
  }
  response_received?: boolean
  /** A non-empty response-stream chunk was received; this does not prove that it contained model data. */
  stream_started?: boolean
  stream_completed?: boolean
  /** True only when the reader observed the body reach EOF. A [DONE] marker may complete the protocol first. */
  stream_eof_observed?: boolean
  /** Milliseconds from the start of body reading to the first valid SSE data payload. */
  stream_first_data_ms?: number
  /** Milliseconds from the start of body reading to the most recent non-empty network chunk. */
  stream_last_progress_ms?: number
  stream_content_chars?: number
  stream_reasoning_chars?: number
  completion_marker_seen?: boolean
  http_status?: number
  exception_chain?: Array<{ name: string; message: string }>
}

/**
 * The independent check of one batch.  It reads the original input, the
 * candidate, and the current IR, and may only report inconsistencies — never
 * supply the business answer, widen authority, or rewrite the candidate.
 */
export interface CompilerModelV2CheckInput {
  run_id: string
  events: readonly CompilerEvent[]
  source_events?: readonly CompilerEvent[]
  /** Management-computed identities for the current events; digest values are not model-authored. */
  event_source_refs?: SourceRef[]
  ir: Record<string, TaskIntent>
  compiled: Record<string, CompiledIntent>
  capabilities: CapabilityCatalog
  candidate: Candidate
  /** Exact prepared facts needed by the check; the full commit object remains private to management. */
  prepared?: {
    ir: Record<string, TaskIntent>
    compiled: Record<string, CompiledIntent>
    atom_states: AtomStateRecord[]
    dispatchable_atoms: import("../core/intent-contract.js").Atom[]
    eligible_task_ids: string[]
    eligible_execution_ids: string[]
  }
  budget: {
    requests_used: number
    max_requests: number
  }
  contract: Readonly<{
    schema_version: 2
    check_contract: string
    rules: readonly string[]
  }>
}

export interface CompilerModelV2CheckResult {
  verdict?: {
    verdict: "consistent" | "inconsistent"
    findings: Array<{
      dimension: string
      claim: string
      expected: string
      observed: string
      refs: Array<Ref | SourceRef>
    }>
  }
  call?: CompilerModelV2Call
  error?: {
    code: "transport" | "json" | "schema"
    message: string
    diagnostic?: CompilerModelV2FailureDiagnostic
  }
  schema_errors?: string[]
}

export interface CompilerModelV2Usage {
  input_tokens?: number
  output_tokens?: number
  reasoning_tokens?: number
  cache_read_tokens?: number
  cache_write_tokens?: number
  cost?: number
}

export interface CompilerModelV2Call {
  text: string
  text_source?: "text" | "reasoning" | "structured"
  raw?: unknown
  provider?: string
  model?: string
  agent?: string
  started_at?: string
  completed_at?: string
  usage?: CompilerModelV2Usage
  /** Exact submitted generation-schema violations, before optional-null removal. */
  structured_schema_errors?: string[]
}

export interface CompilerModelV2Result {
  ok: boolean
  candidate?: Candidate
  /** Returned JSON that failed the Candidate schema; never treated as a Candidate. */
  schema_rejected_draft?: { text: string; errors: string[] }
  call?: CompilerModelV2Call
  error?: {
    code: "transport" | "json" | "schema"
    message: string
    diagnostic?: CompilerModelV2FailureDiagnostic
  }
  schema_errors?: string[]
}

export const V2_COMPILER_CONTRACT = Object.freeze({
  schema_version: 2 as const,
  candidate_shape: [
    "Return exactly one JSON object:",
    "{",
    '  "schema_version": 2,',
    '  "basis": { "event_ids": ["<triggered event ids>"], "refs": [] },',
    '  "source_coverage": [{"source":SourceRef,"disposition":"context|material|management|unresolved|superseded","requirements":[],"reason":"role of unselected text or reason for withdrawal","basis":[]}],',
    '  "groups": [ { "local_ref": "g1", "task_refs": ["<task_id>"], "depends_on": [],',
    '    "ir_changes": [...], "compilation": {...}, "execution_decisions": [],',
    '    "assessments": [], "coverage": [...], "checks": [...], "questions": [...] } ]',
    "}",
    "Understand the whole current user task and fill the existing fields directly. One maintained TaskIntent IR holds its goal, scope, sources and content requirements. Its Compiled Intent is the whole execution plan, containing executable Atoms and their Relations. Several content items are still one IR; one item may govern several Atoms. One group is the atomic commit boundary. Do not split shared conditions across groups.",
  ].join("\n"),
  reference_contract: [
    "Ref = { id: string, revision: integer>=0, digest: string }.",
    "SourceRef = { source_id: string, digest: string, segment_id?: string, quote?: string, span?: { unit:\"utf16\", start: integer, end: integer } }. For content create/revise select source_segments by segment_id, or supply a contiguous exact unique quote for a sub-segment. Never supply both selectors. Management computes spans; do not calculate them yourself. Segment IDs are local to their source event, never semantic task IDs.",
    "A valid SourceRef.source_id is an event id in events or source_events. events are the current triggers; source_events are prior user text for checking retained meaning, not new instructions. A contract field name, file path, or role name is not a source.",
    "event_source_refs contains code-computed digests for events and source_events. Copy those values for source citations; do not calculate or invent a digest.",
    "Choose local_ref and new atom_id/binding_id/output_id values for new objects. For existing objects copy their supplied identities and expected revisions; raise an Atom revision when changing its content. Management assigns compiled identities and computes digests. Never fabricate a Ref to an object that is not supplied.",
  ].join("\n"),
  compilation_contract: [
    'compilation must be exactly one of:',
    '  reuse: { "decision":"reuse", "current": [Ref], "reason": "..." }',
    '  replace: { "decision":"replace", "drafts": [ { "local_ref":"ci-local", "task_id":"...", "intent_basis":[Ref], "atoms":[Atom], "relations":[], "attachments":[] } ] }',
    "Use replace when the execution plan changes; reuse keeps the current compiled revision. A replacement is a delta of changed Atoms plus ALL still-applicable Relations: management merges retained Atoms but replaces the Relation list. Judge the resulting whole plan, including waiting and retained work. Do not rewrite unchanged Atoms for completeness. Retained work is not automatically authorized under a new user update.",
    "A draft's local_ref stays local to this candidate: management assigns the compiled intent's own identity and revision when it accepts the draft.",
  ].join("\n"),
  ir_change_contract: [
    "ir_changes supports exactly:",
    '- create: { action:"create", target:"task", local_ref:"t", value:{ goal:{text}, current_scope:{text,disposition} }, sources:[SourceRef] }',
    '- create binding/output/content with unique local_ref and revision 0 — optional for outputs and bindings: what an atom declares in its own inputs/outputs is registered by management code from the atom itself, so you do not have to restate it here, and restating it does not make the atom stricter. Register an output or binding yourself only when the delegation names something no atom delivers yet (work recorded as paused or unresolved, for example)',
    "A create task's local_ref becomes the task_id, and every binding/output/content create in the same group applies to that group's first task_ref; use that same id in task_refs, the draft, coverage, and those creates. Task creates are applied before the rest of the group whatever order you list them in, and no single group may name two different ids for the same task.",
    "In each create, include only the value fields belonging to that target: task uses goal and current_scope, binding uses ref/role/purpose, output uses description/format, content uses text/about/scope/support. Other target fields are forbidden, including null placeholders. Use null only where the supplied response schema explicitly allows it. Create only what the work needs; Atom inputs/outputs register their declarations without duplicate creates.",
    '- revise: { action:"revise", target:"task"|"current_scope"|"binding"|"output"|"content", id, expected_revision, value:<complete new value>, sources }',
    '- retire: { action:"retire", target:"binding"|"output"|"content", id, expected_revision, reason, sources }',
    '- preserve: { action:"preserve", reason, sources }',
    "task.goal states the whole intended result; current_scope states what is currently authorized, paused or unresolved, without redefining success around available tools. content records operative requirements with their actual scope and source support. Interpret user instructions, examples, context and execution reports by their role in the current delegation. An example may specify interface keys or structure while its sample values remain illustrative; do not either discard its interface or require its example data. Preserve adopted material as input. Execution reports and model choices cannot create user requirements or business answers.",
    "One TaskIntent represents one delegated task; its IR.content items organize normative behavior within that task. Source segments are addressing units, not tasks, requirements or Atoms. Choose cohesive IR.content items by meaning and scope, each with all operative source selections needed for that behavior. Several original segments may belong to one item, and shared definitions may belong to several items. Do not create a task or Atom mechanically per paragraph.",
    "For content create/revise, value.text is a short interpretation/label, NOT a replacement specification. Management stores it separately and constructs canonical IR.content.text verbatim from the selected sources, in source order. The executor receives the compiled Atom instruction; it does not receive the IR passage automatically, so the Atom must faithfully carry every detail needed for its assigned work. Select complete operative passages including literal strings, formulas, alternatives, defaults and exceptions. A title or synopsis cannot replace its rule paragraphs. Prefer source_segments selectors to copying long quotes; quote only when selecting a precise sub-segment is necessary.",
    "Each assigned set of current requirements must be understandable and executable together: select the enclosing command/function heading and prerequisite definitions for dependent subrules, or assign the current requirement that supplies that context to the same Atom. Resolve cross-references through current requirements. Do not adopt examples or quoted commands as fresh authority. Interpret source role and current scope before selecting it; a correctly located segment alone proves neither role nor support.",
    "ALL current user text must have a destination. Selecting sources in content create/revise already declares their normative role and exact IR destination; management derives that mapping, so do not repeat selected normative passages in source_coverage. source_coverage is REQUIRED (use [] when nothing remains) and classifies only unselected current text or withdrawn old text: source, disposition (context/material/management/unresolved/superseded), requirements:[], reason, basis. Classify every remaining passage explicitly; a heading required to understand a rule belongs with its IR sources. Non-normative entries must not overlap active normative text. Do not label operative details context merely to omit them. Neither absent nor null source_coverage is valid. Group fields such as assessments, checks, coverage, execution_decisions and questions belong inside their group, never at the root.",
    "On updates retain unchanged content, revise changed items, create new requirements, retire withdrawn ones, and replace compilation before dispatch. Do not reactivate historical instructions. If an old normative passage is withdrawn or replaced, add a superseded source_coverage entry selecting exactly the dropped old text, empty requirements, and basis selecting the current user's change. Retained parts of a mixed paragraph can use exact quotes. A directive describing how to revise a rule is management text; the active rule text it supplies is normative. Explicitly preserve unchanged subrules instead of treating a whole old paragraph as withdrawn without cause. Coverage accounting proves preservation and declared roles, not semantic correctness.",
  ].join("\n"),
  atom_contract: [
    "An Atom is a concrete work unit that can be started, returned and accepted. Choose boundaries from the whole task and the usable results it needs. A CI must cover the whole current task, including known work that cannot start yet; its first dispatch is only a subset of the plan.",
    "Split work where the resulting units can be meaningfully accepted or consumed separately. Keep investigation, implementation and necessary validation of a unit together. Do not force one Atom per requirement, a fixed Atom count, reading-only preparation, or an empty integration shell. intent_judgments records consequential assumptions or boundary decisions, not a self-certification checklist.",
    "Shared code does not erase behavioral boundaries. If multiple Atoms modify a shared workspace, express a real producer/consumer or safe serial handoff using Relation and its requires text; state what usable implementation/result must be returned. Do not assume concurrent writes are safe or invent a dependency just from list order. Keep shared invariants assigned to every affected Atom, including integration work when that work has its own user-required behavior.",
    "Each Atom needs atom_id, revision, goal_refs, task, inputs, outputs, constraints, optional_tools, authority, preconditions, completion, return_when, intent_judgments.",
    "Each atom.constraints entry must be exactly: { \"text\": \"<full condition>\", \"basis\": [<Ref|SourceRef>], \"scope\": [{ \"target_id\": \"<task|binding|output id>\", \"path\": \"<optional JSON pointer>\" }] }. Plain strings are not allowed.",
    "Write atom.task as the actual instruction the executor receives. Preserve both the assigned behavior and its public interface: supplied command or operation names, arguments, configuration fields and structure, value meanings, results and error behavior. Keep conditions, alternatives, defaults, exceptions, ordering, formulas and applicable shared rules intact. These are required behavior when specified by the user, not implementation choices. Copy relevant operative passages when this is clearer than paraphrasing; do not replace them with feature names, 'as specified', or IR references. The executor does not receive IR automatically. Unspecified internal design remains the executor's choice. The instruction may be long or multiline; there is no summary length target. Default constraints to []; this optional field only duplicates an entire assigned IR rule verbatim with its exact scope, not a paraphrase or a second specification. Its absence never permits dropping behavior from task. goal_refs and coverage record provenance and assignment, not instructions.",
    "Start eligibility requires satisfied preconditions AND accepted incoming Relation results. Preview and later confirmed write-back are separate atoms. Future work whose behavior is known may already be a dependent Atom; record genuinely unknown later work as unresolved coverage instead of an empty Atom.",
    'A Relation is { predecessor: Ref|{local_ref:"new-atom-id"}, successor: Ref|{local_ref:"new-atom-id"}, requires:"exact usable result/ordering reason", conditions:[], basis:[Ref|SourceRef] }. For new Atoms use local_ref; management resolves final content digests after requirement assignment. For existing Atoms copy their exact supplied Ref. Relations are operational dependencies: the successor waits for the exact predecessor version to complete and receive management acceptance. No self/cyclic dependencies. A replacement draft states all still-applicable relations, including retained work; dropping an edge changes execution order.',
    "authority.lifetime must be \"this_execution\" and delegation must be \"not_supported\".",
    "An Atom carries content only: never send status, created_at, updated_at, or result_ref. Lifecycle transitions (ready, executing, completed, legacy, failed) are committed by management code in a separate ledger.",
    "atom_id plus revision identifies one content: changing any content field, including completion, return_when or preconditions, requires a new revision and its own lifecycle record. Use atom_states to distinguish retained current work from completed, failed or superseded history; historical Atoms in compiled are not automatically remaining work.",
    "To replace a failed atom, propose a new atom and set its previous_atom_ref to the exact ref supplied in atom_refs; management records the supersession and keeps the failed record.",
    "Management chooses work boundaries and usable handoffs; the executor investigates and implements within them. Do not pre-compute the business answer. Leave internal algorithms, file organization and other unspecified implementation choices open unless a concrete coordination need requires an arrangement consistent with the delegation; record consequential inferred arrangements in intent_judgments, with their reason and limits. Never present them as user requirements or make success depend on an unsupported preference. Preserve user-fixed public interfaces, locations and behavior regardless of the chosen arrangement. Ordinary compliant implementation choices are allowed, not semantic defects by themselves.",
    "Use the exact refs supplied in atom_refs for assessments.target_ref and previous_atom_ref; never invent ids, revisions, or digests.",
    "Atom.goal_refs for IR content are filled by management code from coverage. You may leave them empty or include the known task Ref; do not invent content digests. One Atom may implement many content requirements.",
    "On a user update, determine what meaning changed and its consequences across the whole remaining plan, not just the referenced or dispatchable Atom. Revise the affected IR items and every affected task, input/output, completion condition, Relation and assignment together. Retain unchanged Atoms and applicable Relations; use the exact previous_atom_ref for supersession. Preserve earlier requirements unless changed or withdrawn, and do not reactivate completed work without a current need. A plan adjustment must not alter IR's user requirements merely to match the new plan or absorb unrelated work into a catch-all Atom.",
  ].join("\n"),
  atom_input_contract: [
    "Each atom.inputs entry must be exactly:",
    '{ "binding_id": "<existing binding id or local binding id>", "ref": <Ref|SourceRef>, "role": "task_data"|"context"|"example", "use": "<why this input is needed>" }',
    "inputs identifies supplied material and how it may be used, not a copy of requirement refs. Do not use { kind, ref, path } shapes. If there is no bound material, use inputs: [].",
  ].join("\n"),
  atom_output_contract: [
    "Each atom.outputs entry must be exactly:",
    '{ "output_id": "<existing output id or local output id>", "description": "<what will be delivered>", "format": "text"|"json"|"artifact" }',
    "outputs names usable products and their required form, not actions or an invented file location. completion states the successful behavior those products must establish and the evidence needed to judge it; it must cover the assigned requirements, not merely artifact existence or a general success claim. return_when states when to hand control back on success, failure or a blocker. Returning a blocker or documenting an unavailable check does not satisfy a success criterion. Keep the original success condition when host limitations prevent proving it; return the limitation for management to resolve. Only a task explicitly asking for a diagnosis or limitation report is completed by that report itself. Do not use { kind, path, description } shapes for outputs.",
  ].join("\n"),
  judgment_contract: [
    "Each atom.intent_judgments entry must be exactly:",
    '{ "claim": "<what is being judged>", "basis": [<Ref|SourceRef>], "status": "supported"|"inferred"|"unresolved", "consequence": "<what the status means for execution>" }',
    "Use supported for a conclusion backed by the supplied evidence, inferred for a consequential planning assumption, and unresolved for a decision the supplied information cannot settle. State the execution consequence without silently turning an assumption into a mandatory user rule. Leave ordinary implementation freedom open; ask a question or record unresolved coverage only when missing meaning or material actually prevents authorized work. Do not use confidence numbers or { judgment, confidence } shapes.",
  ].join("\n"),
  coverage_contract: [
    "coverage entries must be:",
    '{ "requirement": <Ref|{local_ref}>, "disposition": "assigned"|"supported"|"paused"|"unresolved", "refs": [<Ref|{local_ref}>], "explanation": "<why>" }',
    "Use it to record where every current goal and requirement goes; do not use { atom_ref, requirement, status } shapes.",
    "Whenever a group compiles atoms for a task, coverage must contain an entry for that work whose requirement or refs names the task (its task_id, or the create local_ref that becomes it) or one of the atoms that carry it. A compiled task with no such entry is rejected and returned to you with the reason.",
    "Disposition must state the truth: assigned or supported when an atom delivers it, paused when the user paused it, unresolved when it still needs a decision or a missing input.",
    "Record one coverage entry for every current IR.content item in a replaced task, using its item id as requirement and receiving Atom id(s) in refs. Assigned/supported items need an Atom; paused/unresolved items name none. An Atom with no assigned requirement cannot start, and pausing a requirement still carried by active work requires replacement. A compiled task with no source-backed IR.content or an item without a destination is rejected. Coverage explanation is not requirement text.",
  ].join("\n"),
  checks_contract: [
    "Default checks to an empty array: do not generate a self-certification report for every requirement. Preserve actionable uncertainty in the task, constraints, preconditions or questions; never delete it merely to shorten output. When a concrete additional check is needed, entries must be objects:",
    '{ "scenario": "<behavior being checked>", "expected": "<expected behavior>", "observed_in_candidate": "<what the candidate does>", "sources": [<SourceRef>], "unresolved": false }',
    "Do not put plain strings in checks.",
  ].join("\n"),
  example_input: CANDIDATE_EXAMPLE_INPUT,
  example_candidate: JSON.stringify(CANDIDATE_EXAMPLE, null, 2),
  rules: Object.freeze([
    "Determine each passage's role from who supplied it, why it is present and what the current user asks. Wording or headings alone do not make text either normative or non-normative. example_input and example_candidate are a paired illustration of field use, never requirements for the current task.",
    "Keep every requirement's field scope: a 30-word limit on one field does not truncate the whole JSON; shared/new clue limits are separate fields.",
    "Do not invent predecessor/successor causal chains or search for generated answers. Generating a question is not answering it.",
    "Do not start a compiled atom with missing required bindings; if the task is to analyze a template, placeholders are legal material and must not be guessed.",
    "Use reuse when no new compiled content is needed; use replace only when the compiled work actually changes.",
    "A first batch for a new delegation starts from an empty IR: that is the normal starting state, not a missing decision to wait for. Create the task (ir_change create, target task) and compile its work in the same candidate. Never answer a delegation that asks for work with an empty basis, an empty group, or a question asking whether to proceed — asking for permission to do the delegated work is not a legitimate reservation.",
    "An empty basis.event_ids claims this batch has nothing to act on. That is true only when the batch carries no user delegation; a batch that carries one must name it.",
    "If a group cannot be justified as independent, keep it in one group and do not partially commit shared conditions.",
    "group.task_refs must name only tasks that exist after this group's ir_changes; a create task's local_ref is the task_id, and every replace draft.task_id must equal one of those task_ids. Do not reuse the event's task_ids as a separate task identity.",
    "When existing_objects contains the work being updated, use that exact task_id and task_revision for task_refs, draft.task_id, and expected_revision fields. Use only atom Refs listed under that task when setting previous_atom_ref; management binds and checks these against the current stored objects.",
    "intent_basis and atom.goal_refs accept only supplied exact Refs; new requirements are assigned through coverage local_refs and management fills their canonical references. For brand-new work use empty arrays for intent_basis and goal_refs. References establish provenance, not semantic correctness.",
    "On execution_return, compare actual products and evidence with the exact Atom completion criteria, assigned current requirements and outgoing Relation.requires. Fill assessments.target_ref, criteria_refs, evidence_refs, result and explanation from that comparison. An executor's completed claim, blocker report or missing-check explanation is not success evidence. Use unknown for insufficient evidence and not_satisfied for an unmet criterion; never weaken completion or rewrite IR to make a return pass. Read execution_outcomes, assessments and atom_states with current events. Reuse the CI when remaining work is unchanged; replace affected work when failure or new evidence requires replanning, preserving the required result and all unaffected work. Execution progress alone does not change user requirements. Revise IR understanding only with delegation support. Never recreate a closed execution or redispatch the same Atom version.",
    "authority.rules use operation_id values available in capabilities.operations. Grant only operations and resources needed by the authorized work. When the host resolves the exact invocation, leave input_refs and output_refs empty; the host records the tool and raw-args digest for audit.",
    "An Atom must grant the available operations its implementation, build or verification needs and list them in optional_tools. Use host capabilities to choose them; do not require every possible editing tool. Operations and objects the delegated goal itself needs are authorized by that delegation. Never invent operations, paths, or objects outside the delegation, and never reduce implementation to read-only investigation to avoid granting the tools it needs.",
    "If the goal needs work the current delegation does not authorize yet (a later write-back, an unwritten confirmation, a data source the user has not allowed), keep that work in the task and record it in coverage as paused or unresolved. Do not replace the goal with whatever step happens to be allowed now.",
    "capabilities lists the operations the host can grant, the workspace root, and every path this batch names with whether it exists and is readable by the executor. A path that exists and is readable is provided material the executor will open: never treat 'I cannot see its content' as a missing binding. Missing material means the user referenced something that was never provided at all.",
    "Supported conditions are scope_allows, capability_available (expectation is the operation id), assessment_supports (exact target Ref), all and any. Other condition kinds block the work. A Relation already waits for accepted predecessor completion; do not add an unsupported artifact_exists condition just to duplicate this dependency. Management acceptance considers execution evidence and requires, not a bare executor completion claim.",
    "When configured, an independent checker compares the original input with prepared.ir and the whole prepared.compiled plan, including retained and waiting Atoms, using prepared.atom_states to distinguish history. prepared.dispatchable_atoms is only the current dispatch subset; eligibility lists are the code-computed start/continue scope. Execution decisions belong in candidate.groups[].execution_decisions. After a user update, an active execution continues only with an explicit continue decision for unchanged authorized work; stop closes its authority, await_result permits only its return. Unreviewed work remains suspended. You remain responsible for faithful semantic generation whether or not a checker is configured.",
    "When validation_errors, previous_rejection, repair_context or schema_rejected_draft is present, start from that rejected draft and identify the supported error and its consequences using current input. A shape or reference error permits repairing that representation, not reinterpreting unrelated behavior. A semantic error requires correcting the mistaken meaning and every affected IR selection, Atom field, assignment and Relation. Return a complete candidate while preserving unrelated correct fields and still-applicable requirements; complete output does not mean wholesale regeneration. Check the resulting whole plan for lost or added requirements, including waiting work. Do not delete behavior, loosen success criteria or convert an implementation preference into a user requirement to pass validation. Reconcile changed input first; an evidence_resolved false reason is recorded rather than binding.",
    "A path in prior IR or Compiled Intent is management-authored content, even when it has a source reference. A source reference proves where a claim came from, not that the cited user text supports the path. Preserve a path as a user restriction only when the cited user-authored text explicitly limits work to that path and the restriction still applies. When no applicable user text limits the file, keep the requested behavior as the task and let the executor locate the file within the already authorized workspace and operations; do not add permissions or widen scope.",
  ]),
})

export type CompilerModelV2Transport = (
  request: CompilerModelV2Input,
) => Promise<string | CompilerModelV2Call> | string | CompilerModelV2Call

export type CompilerModelV2CheckTransport = (
  request: CompilerModelV2CheckInput,
) => Promise<string | CompilerModelV2Call> | string | CompilerModelV2Call

export const V2_CHECK_CONTRACT = Object.freeze({
  schema_version: 2 as const,
  check_contract: [
    "Return exactly one JSON object:",
    '{ "schema_version": 2, "verdict": "consistent"|"inconsistent", "findings": [ { "dimension": "D1"|"D2"|"D3"|"D4"|"D5"|"D6"|"D7", "claim": "<behavior being judged>", "expected": "<what the original input and source-backed current IR require>", "observed": "<what the candidate actually does>", "refs": [<Ref|SourceRef>] } ] }',
    "You are the independent check of one management candidate, not its author. Read the original input, prior ir/compiled, candidate changes and exact prepared effects. prepared.ir is the post-candidate task understanding; prepared.compiled is the whole resulting plan, including retained and waiting Atoms and Relations. Use prepared.atom_states to distinguish current work from historical or superseded versions. prepared.dispatchable_atoms is only the current host-facing subset; prepared.eligible_task_ids and prepared.eligible_execution_ids are the code-computed start/continue scope. Decisions are in candidate.groups[].execution_decisions. Judge the whole resulting plan against the current delegation, not only the first dispatch. Preparation supplies no new business facts. Do not design an alternative implementation or demand repository answers the executor is authorized to investigate.",
    "verdict must be \"consistent\" only when you found no inconsistency; findings must be empty then. List only real inconsistencies, each with what was required and what the candidate does instead.",
    "Name the dimension each finding judges: D1 source/material roles; D2 required outputs and field scope; D3 authority operations and objects against host facts; D4 the destination of each current requirement, new or retained; D5 citation support; D6 behavior or restrictions added without user support; D7 whether the plan faithfully performs the requested work, including required conditions, alternatives and exceptions. A plan that only investigates or summarizes required implementation is incomplete.",
    "For D7 cite the user requirement whose behavior or public interface is missing or changed and identify the affected Atom or missing work. Interface names, configuration structure, value meanings and boundary behavior specified through prose or adopted examples are not unspecified implementation details; example values need not be mandatory. For D6 distinguish an allowed implementation or coordination choice from an unsupported user restriction: report a concrete incompatibility, authority expansion or success condition imposed without support, not the mere presence of a chosen compliant approach. Do not demand your preferred implementation, convert an open question into a requirement, or require work legitimately paused or unresolved to execute now.",
    "Only a finding whose refs resolve can block the batch: cite the delegation source (its source_id plus a span covering the words you rely on) or a current IR entry whose source references support the requirement. A finding that cites nothing, or names a source id or id that is not in this input, is recorded and set aside — do not report it as a reason to reject.",
    "You may not supply the business answer, widen or narrow Authority, rewrite the candidate, or invent ids, revisions, or digests.",
    "event_source_refs contains the exact source_id and code-computed digest for each current or historical source event. Copy those values for citations; do not calculate or invent a digest.",
    "First compare the entire current delegation with prepared.ir: check omitted or wrongly classified meaning, not merely matching quotes. Then compare every current requirement with the whole prepared.compiled plan. Each assigned requirement needs relevant Atoms' goal_refs AND faithful behavior and acceptance conditions. Check shared rules on every affected unit, public interfaces, known later work and Relation handoffs; coverage cannot supply behavior. completion must establish success, whereas return_when may permit a blocker or failure: reporting missing evidence cannot substitute for producing it. On repairs and updates, check both the intended correction and unintended changes to previously correct work. On execution returns, compare the assessment with the actual evidence and original success conditions. An Atom must be executable without retrieving IR. Historical source_events are evidence, not new requests.",
  ].join("\n"),
  rules: Object.freeze([
    "A path the host reports as existing and readable is provided material: the executor reads it, so 'the compiler cannot see its content' is not a missing binding.",
    "Judge changes and their effect on retained work: a new restriction may invalidate waiting Atoms or an execution continuation. Use prepared.compiled as the canonical resulting plan and prepared.dispatchable_atoms as its dispatch subset; use prepared eligibility for start/continue scope. Do not assume code-validated references or coverage prove correct meaning. Compiler-written self-checks do not substitute for comparison; an empty checks array is not an inconsistency.",
    "If the candidate records a coverage entry with disposition paused or unresolved, treat the delegation as recorded rather than missing, unless the original input requires work to start now.",
    "Do not repeat the candidate's own claims back as evidence; cite the original input or a source-backed current IR entry.",
    "Do not judge conventions. How many outputs there are, what a field is named, whether a field is 'redundant', or whether a task is a goal rather than a task are not requirements unless the delegation or the current IR states them; an objection that rests on one of these and cannot cite the delegation is not an inconsistency.",
    "A path in prior IR or Compiled Intent is management-authored content, even when it has a source reference. A source reference proves where a claim came from, not that the cited user text supports the path. Preserve still-applicable user path restrictions and host-provided access boundaries. A host-reported path's existence or readability shows that material is available; it does not prove that only that file may be modified. When no applicable user text or explicit host access boundary limits the file, a delivery may leave the exact file to be located by the executor within the already authorized workspace and operations. Treat an exact-path or only-this-file constraint invented from management-authored state as an added requirement (D6) only when it lacks support in both applicable user path requirements and explicit host access boundaries; mere path existence or readability is not such a boundary. Do not require the unsupported constraint or widen Authority.",
  ]),
})

export interface CompilerModelV2 {
  propose(input: CompilerModelV2Input): Promise<CompilerModelV2Result>
  verify?(input: CompilerModelV2CheckInput): Promise<CompilerModelV2CheckResult>
}

export class CompilerModelV2Error extends Error {
  readonly code: "transport" | "json" | "schema"

  constructor(code: "transport" | "json" | "schema", message: string) {
    super(message)
    this.name = "CompilerModelV2Error"
    this.code = code
  }
}

export function createCompilerModelV2(
  transport: CompilerModelV2Transport,
  checkTransport?: CompilerModelV2CheckTransport,
): CompilerModelV2 {
  if (typeof transport !== "function") throw new TypeError("createCompilerModelV2 requires a transport function")
  return {
    async propose(input) {
      let raw: string | CompilerModelV2Call
      try {
        raw = await transport(input)
      } catch (error) {
        return { ok: false, error: { code: "transport", message: errorMessage(error), diagnostic: diagnosticOf(error, "transport") } }
      }
      const call = typeof raw === "string" ? { text: raw, text_source: "text" as const } : raw
      if (call.structured_schema_errors?.length) {
        const errors = call.structured_schema_errors
        return { ok: false, call, error: { code: "schema", message: errors.join("; ") }, schema_errors: errors, schema_rejected_draft: { text: call.text, errors } }
      }
      if (typeof call.text !== "string" || call.text.length === 0) {
        return { ok: false, call, error: { code: "transport", message: "model transport must return non-empty text" } }
      }
      let decoded: unknown
      try {
        decoded = stripNullValues(parseCandidateJson(call.text))
      } catch (error) {
        return { ok: false, call, error: { code: "json", message: errorMessage(error), diagnostic: diagnosticOf(error, "candidate_json_parse", true) } }
      }
      try {
        const schema = validateCandidateSchema(decoded)
        if (!schema.ok) {
          return {
            ok: false,
            call,
            error: { code: "schema", message: schema.errors.join("; ") },
            schema_errors: schema.errors,
            schema_rejected_draft: { text: call.text, errors: schema.errors },
          }
        }
        return { ok: true, candidate: validateCandidate(decoded), call }
      } catch (error) {
        const message = errorMessage(error)
        return {
          ok: false,
          call,
          error: { code: "schema", message },
          schema_errors: [message],
          schema_rejected_draft: { text: call.text, errors: [message] },
        }
      }
    },
    ...(checkTransport === undefined
      ? {}
      : {
          async verify(input: CompilerModelV2CheckInput): Promise<CompilerModelV2CheckResult> {
            let raw: string | CompilerModelV2Call
            try {
              raw = await checkTransport(input)
            } catch (error) {
              return { error: { code: "transport", message: errorMessage(error), diagnostic: diagnosticOf(error, "check_transport") } }
            }
            const call = typeof raw === "string" ? { text: raw, text_source: "text" as const } : raw
            if (call.structured_schema_errors?.length) return { call, error: { code: "schema", message: call.structured_schema_errors.join("; ") }, schema_errors: call.structured_schema_errors }
            if (typeof call.text !== "string" || call.text.length === 0) {
              return { call, error: { code: "transport", message: "model transport must return non-empty text" } }
            }
            let decoded: unknown
            try {
              decoded = stripNullValues(parseCandidateJson(call.text))
            } catch (error) {
              return { call, error: { code: "json", message: errorMessage(error), diagnostic: diagnosticOf(error, "check_json_parse", true) } }
            }
            const schema = validateCandidateCheckSchema(decoded)
            if (!schema.ok) {
              return { call, error: { code: "schema", message: schema.errors.join("; ") }, schema_errors: schema.errors }
            }
            if (!isRecord(decoded) || (decoded.verdict !== "consistent" && decoded.verdict !== "inconsistent") || !Array.isArray(decoded.findings)) {
              return { call, error: { code: "schema", message: "check output must carry a verdict and findings" } }
            }
            return {
              verdict: {
                verdict: decoded.verdict,
                findings: (decoded.findings as unknown[]).map((finding) => {
                  const record = isRecord(finding) ? finding : {}
                  return {
                    dimension: String(record.dimension),
                    claim: String(record.claim),
                    expected: String(record.expected),
                    observed: String(record.observed),
                    refs: Array.isArray(record.refs) ? (record.refs as Array<Ref | SourceRef>) : [],
                  }
                }),
              },
              call,
            }
          },
        }),
  }
}

function parseCandidateJson(text: string): unknown {
  if (text.includes("<｜｜DSML｜｜") || text.includes("<||DSML||") || text.includes("<|DSML|>")) return decodeDsml(text)
  try {
    return JSON.parse(text)
  } catch {
    // Reasoning providers sometimes wrap the JSON in markdown fences or emit
    // a short preamble.  Accept only the first balanced top-level object.
    const withoutFence = text.replace(/^```(?:json)?\s*/iu, "").replace(/\s*```$/u, "").trim()
    const start = withoutFence.indexOf("{")
    const end = withoutFence.lastIndexOf("}")
    if (start < 0 || end <= start) throw new Error("model response contains no JSON object")
    return JSON.parse(withoutFence.slice(start, end + 1))
  }
}

function decodeDsml(text: string): unknown {
  const root: Record<string, unknown> = {}
  // OpenCode renders StructuredOutput with fullwidth or halfwidth bars and
  // with one or two bars around DSML.  Normalize every variant to single
  // halfwidth delimiters before extracting parameters.
  const normalized = text
    .replaceAll("｜", "|")
    .replaceAll("||DSML||", "|DSML|")
  // The opening/closing tag may or may not carry the trailing `>` directly
  // after DSML| (OpenCode has emitted both `<|DSML|> parameter` and
  // `<|DSML| parameter` shapes).
  const parameter = /<\|DSML\|>?\s*parameter name="([^"]+)" string="(true|false)">([\s\S]*?)<\/\|DSML\|>?\s*parameter>/gu
  let match: RegExpExecArray | null
  while ((match = parameter.exec(normalized)) !== null) {
    const name = match[1] as string
    const raw = (match[3] as string).trim()
    const value = match[2] === "true"
      ? parseJsonOrRaw(raw)
      : parseJsonOrRaw(raw)
    root[name] = value
  }
  if (isRecord(root.schema_version) || root.schema_version !== 2 || !isRecord(root.basis) || !Array.isArray(root.groups)) {
    // OpenCode has also wrapped the whole candidate in a single envelope
    // parameter (e.g. name="candidate").  Unwrap it when the top-level keys
    // are not spread across individual parameters.
    for (const value of Object.values(root)) {
      if (
        isRecord(value) &&
        value.schema_version === 2 &&
        isRecord(value.basis) &&
        Array.isArray(value.groups)
      ) {
        return value
      }
    }
  }
  return root
}

function parseJsonOrRaw(value: string): unknown {
  try {
    return JSON.parse(value)
  } catch {
    return value
  }
}

/**
 * Strict-mode providers render optional fields as explicit null.  Canonical
 * validation treats absence as optional, so nulls are stripped here; a null
 * where a value is required then fails validation as a missing field.
 */
function stripNullValues(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((item) => stripNullValues(item))
  if (value === null || typeof value !== "object") return value
  const output: Record<string, unknown> = {}
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (child === null) continue
    output[key] = stripNullValues(child)
  }
  return output
}

function isRecord(value: unknown): value is Record<string, any> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function diagnosticOf(error: unknown, fallbackPhase: string, responseReceived?: boolean): CompilerModelV2FailureDiagnostic {
  if (isRecord(error) && isRecord(error.diagnostic) && typeof error.diagnostic.phase === "string") {
    return error.diagnostic as unknown as CompilerModelV2FailureDiagnostic
  }
  const exception_chain: NonNullable<CompilerModelV2FailureDiagnostic["exception_chain"]> = []
  const seen = new Set<unknown>()
  let current: unknown = error
  while (current !== undefined && current !== null && !seen.has(current) && exception_chain.length < 8) {
    seen.add(current)
    if (current instanceof Error) {
      exception_chain.push({ name: current.name || "Error", message: current.message.replace(/(Bearer\s+)[^\s"']+/giu, "$1[redacted]") })
      current = current.cause
    } else {
      exception_chain.push({ name: typeof current, message: String(current) })
      current = typeof current === "object" && "cause" in current ? (current as { cause?: unknown }).cause : undefined
    }
  }
  return { phase: fallbackPhase, ...(responseReceived === undefined ? {} : { response_received: responseReceived }), exception_chain }
}
