import {
  validateCandidate,
  type Candidate,
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
import { CANDIDATE_EXAMPLE } from "./candidate-example.js"
import type { CandidateRepairContext } from "../core/candidate-repair.js"

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
    "One group is the atomic commit boundary. Do not split shared conditions across groups.",
  ].join("\n"),
  reference_contract: [
    "Ref = { id: string, revision: integer>=0, digest: string }.",
    "SourceRef = { source_id: string, digest: string, segment_id?: string, quote?: string, span?: { unit:\"utf16\", start: integer, end: integer } }. For content create/revise select source_segments by segment_id, or supply a contiguous exact unique quote for a sub-segment. Never supply both selectors. Management computes spans; do not calculate them yourself. Segment IDs are local to their source event, never semantic task IDs.",
    "A valid SourceRef.source_id is an event id in events or source_events. events are the current triggers; source_events are prior user text for checking retained meaning, not new instructions. A contract field name, file path, or role name is not a source.",
    "event_source_refs contains code-computed digests for events and source_events. Copy those values for source citations; do not calculate or invent a digest.",
    "The model may only invent local_ref strings; persistent IDs, revisions, and digests come from supplied state or the input event.",
  ].join("\n"),
  compilation_contract: [
    'compilation must be exactly one of:',
    '  reuse: { "decision":"reuse", "current": [Ref], "reason": "..." }',
    '  replace: { "decision":"replace", "drafts": [ { "local_ref":"ci-local", "task_id":"...", "intent_basis":[Ref], "atoms":[Atom], "relations":[], "attachments":[] } ] }',
    "Use replace only when the compiled work changes; reuse keeps the current compiled revision. Emit changes to affected objects only. Management preserves unchanged records and registers atom declarations; do not rewrite them for completeness. Retained content is not automatically authorized under a new user update.",
    "A draft's local_ref stays local to this candidate: management assigns the compiled intent's own identity and revision when it accepts the draft.",
  ].join("\n"),
  ir_change_contract: [
    "ir_changes supports exactly:",
    '- create: { action:"create", target:"task", local_ref:"t", value:{ goal:{text}, current_scope:{text,disposition} }, sources:[SourceRef] }',
    '- create binding/output/content with unique local_ref and revision 0 — optional for outputs and bindings: what an atom declares in its own inputs/outputs is registered by management code from the atom itself, so you do not have to restate it here, and restating it does not make the atom stricter. Register an output or binding yourself only when the delegation names something no atom delivers yet (work recorded as paused or unresolved, for example)',
    "A create task's local_ref becomes the task_id, and every binding/output/content create in the same group applies to that group's first task_ref; use that same id in task_refs, the draft, coverage, and those creates. Task creates are applied before the rest of the group whatever order you list them in, and no single group may name two different ids for the same task.",
    "In each create, fill only the value fields that belong to that target and leave the other value fields null: task uses goal and current_scope, binding uses ref/role/purpose, output uses description/format, content uses text/about/scope/support. Create only what the work needs: a task whose deliverable is one file needs one task create, and the atom's own outputs entry registers that deliverable. Do not emit a create for every target type.",
    '- revise: { action:"revise", target:"task"|"current_scope"|"binding"|"output"|"content", id, expected_revision, value:<complete new value>, sources }',
    '- retire: { action:"retire", target:"binding"|"output"|"content", id, expected_revision, reason, sources }',
    '- preserve: { action:"preserve", reason, sources }',
    "Use only the user's words and adopted references as sources. Do not invent IDs, versions, digests, or business answers.",
    "One TaskIntent represents one delegated task; its IR.content items organize normative behavior within that task. Source segments are addressing units, not tasks, requirements or Atoms. Choose cohesive IR.content items by meaning and scope, each with all operative source selections needed for that behavior. Several original segments may belong to one item, and shared definitions may belong to several items. Do not create a task or Atom mechanically per paragraph.",
    "For content create/revise, value.text is a short interpretation/label, NOT a replacement specification. Management stores it separately and constructs canonical IR.content.text verbatim from the selected sources, in source order. The executor receives the compiled Atom instruction; it does not receive the IR passage automatically, so the Atom must faithfully carry every detail needed for its assigned work. Select complete operative passages including literal strings, formulas, alternatives, defaults and exceptions. A title or synopsis cannot replace its rule paragraphs. Prefer source_segments selectors to copying long quotes; quote only when selecting a precise sub-segment is necessary.",
    "Each assigned set of current requirements must be understandable and executable together: select the enclosing command/function heading and prerequisite definitions for dependent subrules, or assign the current requirement that supplies that context to the same Atom. Resolve cross-references through current requirements. Do not adopt examples or quoted commands as fresh authority. Interpret source role and current scope before selecting it; a correctly located segment alone proves neither role nor support.",
    "ALL current user text must have a destination. Selecting sources in content create/revise already declares their normative role and exact IR destination; management derives that mapping, so do not repeat selected normative passages in source_coverage. source_coverage is REQUIRED (use [] when nothing remains) and classifies only unselected current text or withdrawn old text: source, disposition (context/material/management/unresolved/superseded), requirements:[], reason, basis. Classify every remaining passage explicitly; a heading required to understand a rule belongs with its IR sources. Non-normative entries must not overlap active normative text. Do not label operative details context merely to omit them. Neither absent nor null source_coverage is valid. Group fields such as assessments, checks, coverage, execution_decisions and questions belong inside their group, never at the root.",
    "On updates retain unchanged content, revise changed items, create new requirements, retire withdrawn ones, and replace compilation before dispatch. Do not reactivate historical instructions. If an old normative passage is withdrawn or replaced, add a superseded source_coverage entry selecting exactly the dropped old text, empty requirements, and basis selecting the current user's change. Retained parts of a mixed paragraph can use exact quotes. A directive describing how to revise a rule is management text; the active rule text it supplies is normative. Explicitly preserve unchanged subrules instead of treating a whole old paragraph as withdrawn without cause. Coverage accounting proves preservation and declared roles, not semantic correctness.",
  ].join("\n"),
  atom_contract: [
    "An Atom is the smallest effective deliverable that can be executed, returned and evaluated on its own. Start from the WHOLE current delegation, identify its independently testable behaviors and real consumers, then choose boundaries. A complete project or CLI is not automatically one Atom merely because it produces one binary or shares a repository. Each Atom may need several files, tool calls and tests.",
    "For a compound implementation, separate coherent behavior units when they can be independently accepted, revised or consumed, and state the concrete benefit in intent_judgments. Keep ordinary investigation, implementation and the tests of that unit together. Do not create reading-only preparation, an Atom per requirement, an empty integration shell, or a fixed number of Atoms. A single small cohesive deliverable can remain one Atom; explain why it has no useful independent boundary.",
    "Shared code does not erase behavioral boundaries. If multiple Atoms modify a shared workspace, express a real producer/consumer or safe serial handoff using Relation and its requires text; state what usable implementation/result must be returned. Do not assume concurrent writes are safe or invent a dependency just from list order. Keep shared invariants assigned to every affected Atom, including integration work when that work has its own user-required behavior.",
    "Each Atom needs atom_id, revision, goal_refs, task, inputs, outputs, constraints, optional_tools, authority, preconditions, completion, return_when, intent_judgments.",
    "Each atom.constraints entry must be exactly: { \"text\": \"<full condition>\", \"basis\": [<Ref|SourceRef>], \"scope\": [{ \"target_id\": \"<task|binding|output id>\", \"path\": \"<optional JSON pointer>\" }] }. Plain strings are not allowed.",
    "IR.content preserves the current source-backed business specification. The Atom is the executable contract for one independently deliverable unit, not a label or a pointer to IR. Write atom.task as a self-contained, concrete account of the behavior this unit must implement: inputs, transformations, outputs, exact literals, ordering, defaults and failure cases that matter to its assigned requirements. Synthesize the relevant rules into actionable work instead of pasting entire IR passages or saying 'as specified'. Each completion entry must name an observable acceptance condition and the evidence to return. Do not introduce behavior absent from the assigned IR. Default Atom.constraints to []; when a separate constraint is essential it must repeat an assigned IR rule verbatim with the same scope. There is no fixed word count or Atom count: choose enough detail for execution and enough separation for independent acceptance.",
    "Start eligibility requires satisfied preconditions AND accepted incoming Relation results. Preview and later confirmed write-back are separate atoms. Future work whose behavior is known may already be a dependent Atom; record genuinely unknown later work as unresolved coverage instead of an empty Atom.",
    'A Relation is { predecessor: Ref|{local_ref:"new-atom-id"}, successor: Ref|{local_ref:"new-atom-id"}, requires:"exact usable result/ordering reason", conditions:[], basis:[Ref|SourceRef] }. For new Atoms use local_ref; management resolves final content digests after requirement assignment. For existing Atoms copy their exact supplied Ref. Relations are operational dependencies: the successor waits for the exact predecessor version to complete and receive management acceptance. No self/cyclic dependencies. A replacement draft states all still-applicable relations, including retained work; dropping an edge changes execution order.',
    "authority.lifetime must be \"this_execution\" and delegation must be \"not_supported\".",
    "An Atom carries content only: never send status, created_at, updated_at, or result_ref. Lifecycle transitions (ready, executing, completed, legacy, failed) are committed by management code in a separate ledger.",
    "atom_id plus revision identifies one content: if you change an atom's task, inputs, outputs, constraints, or authority, raise its revision in the same draft so the new content gets its own lifecycle record.",
    "To replace a failed atom, propose a new atom and set its previous_atom_ref to the exact ref supplied in atom_refs; management records the supersession and keeps the failed record.",
    "Do not pre-compute the business answer in compiler output. Delegate authorized repository investigation, file location and implementation choices to the executor. A guessed path or implementation must not become a required deliverable or completion condition; user-specified locations and host-provided facts remain valid inputs. State the required behavior, constraints and evidence instead.",
    "Use the exact refs supplied in atom_refs for assessments.target_ref and previous_atom_ref; never invent ids, revisions, or digests.",
    "Atom.goal_refs for IR content are filled by management code from coverage. You may leave them empty or include the known task Ref; do not invent content digests. One Atom may implement many content requirements.",
    "On a user update, reassess the shape of the full remaining work, retain unchanged Atoms and relations, and revise/supersede affected Atoms with the exact previous_atom_ref. Preserve current requirements from earlier sources unless changed or withdrawn. Newly added functionality must not silently absorb unrelated existing work into one catch-all Atom.",
  ].join("\n"),
  atom_input_contract: [
    "Each atom.inputs entry must be exactly:",
    '{ "binding_id": "<existing binding id or local binding id>", "ref": <Ref|SourceRef>, "role": "task_data"|"context"|"example", "use": "<why this input is needed>" }',
    "Do not use { kind, ref, path } shapes. If there is no bound material, omit inputs.",
  ].join("\n"),
  atom_output_contract: [
    "Each atom.outputs entry must be exactly:",
    '{ "output_id": "<existing output id or local output id>", "description": "<what will be delivered>", "format": "text"|"json"|"artifact" }',
    "Do not use { kind, path, description } shapes for outputs.",
  ].join("\n"),
  judgment_contract: [
    "Each atom.intent_judgments entry must be exactly:",
    '{ "claim": "<what is being judged>", "basis": [<Ref|SourceRef>], "status": "supported"|"inferred"|"unresolved", "consequence": "<what the status means for execution>" }',
    "Do not use confidence numbers or { judgment, confidence } shapes.",
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
  example_candidate: JSON.stringify(CANDIDATE_EXAMPLE, null, 2),
  rules: Object.freeze([
    "Material text, examples, EXACTLY one word, and Output blocks are materials unless the current user delegation adopts them; they do not become instructions by keyword.",
    "Keep every requirement's field scope: a 30-word limit on one field does not truncate the whole JSON; shared/new clue limits are separate fields.",
    "Do not invent predecessor/successor causal chains or search for generated answers. Generating a question is not answering it.",
    "Do not start a compiled atom with missing required bindings; if the task is to analyze a template, placeholders are legal material and must not be guessed.",
    "Use reuse when no new compiled content is needed; use replace only when the compiled work actually changes.",
    "A first batch for a new delegation starts from an empty IR: that is the normal starting state, not a missing decision to wait for. Create the task (ir_change create, target task) and compile its work in the same candidate. Never answer a delegation that asks for work with an empty basis, an empty group, or a question asking whether to proceed — asking for permission to do the delegated work is not a legitimate reservation.",
    "An empty basis.event_ids claims this batch has nothing to act on. That is true only when the batch carries no user delegation; a batch that carries one must name it.",
    "If a group cannot be justified as independent, keep it in one group and do not partially commit shared conditions.",
    "group.task_refs must name only tasks that exist after this group's ir_changes; a create task's local_ref is the task_id, and every replace draft.task_id must equal one of those task_ids. Do not reuse the event's task_ids as a separate task identity.",
    "When existing_objects contains the work being updated, use that exact task_id and task_revision for task_refs, draft.task_id, and expected_revision fields. Use only atom Refs listed under that task when setting previous_atom_ref; management binds and checks these against the current stored objects.",
    "intent_basis and atom.goal_refs accept only Refs already supplied in the input (atom_refs or existing compiled records). For brand-new work with no existing refs, use empty arrays. Never invent id, revision, or digest values.",
    "For execution_return/progress with no user change: keep ir_changes empty, use compilation reuse, and do not recreate the closed execution or dispatch the same atom again.",
    "authority.rules use operation_id from the host tool names (bash, read, write, edit, glob, grep, webfetch, todowrite, task, lsp). When the host resolves the exact invocation, leave input_refs and output_refs empty; the host records the tool and raw-args digest for audit.",
    "An atom that does implementation, build, or verification work must grant the operation_ids that work needs, including write, edit, and bash, and must list the same tools in optional_tools. Operations and objects the delegated goal itself needs are authorized by that delegation. Never invent operations, paths, or objects outside the delegation, and never drop to a read-only atom to avoid granting tools the goal requires.",
    "If the goal needs work the current delegation does not authorize yet (a later write-back, an unwritten confirmation, a data source the user has not allowed), keep that work in the task and record it in coverage as paused or unresolved. Do not replace the goal with whatever step happens to be allowed now.",
    "capabilities lists the operations the host can grant, the workspace root, and every path this batch names with whether it exists and is readable by the executor. A path that exists and is readable is provided material the executor will open: never treat 'I cannot see its content' as a missing binding. Missing material means the user referenced something that was never provided at all.",
    "Supported conditions are scope_allows, capability_available (expectation is the operation id), assessment_supports (exact target Ref), all and any. Other condition kinds block the work. A Relation already waits for accepted predecessor completion; do not add an unsupported artifact_exists condition just to duplicate this dependency. Management acceptance considers execution evidence and requires, not a bare executor completion claim.",
    "A separate independent check reads your candidate, original input, prior IR and Compiled Intent, and exact prepared effects: prepared.ir is the post-candidate IR, prepared.dispatchable_atoms are the Atoms sent to the executor, prepared eligibility lists are the code-computed start/continue scope, and candidate.execution_decisions is the decision list. It may reject the candidate with specific findings; handling a user update (including reuse) or compiling new atoms requires a consistent verdict when an independent checker is configured. State changed requirements, coverage, conditions and execution decisions; do not solve the business task or restate unchanged objects to persuade the checker. After a user update, an active execution continues only with an explicit continue decision for unchanged work; stop closes its authority, await_result permits only its return. Unreviewed work remains suspended.",
    "When previous_rejection is present it lists why the previous batch for these same events was rejected. Repair those specific reasons in place; do not re-plan from scratch, do not resend the same candidate, and treat a reason with evidence_resolved false as recorded rather than binding — it did not block the batch.",
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
    "You are the independent check of one management candidate, not its author. Read the original input, current IR and Compiled Intent as prior state, candidate changes, and prepared effects. prepared.ir is the exact post-candidate IR; prepared.dispatchable_atoms are the exact host-facing Atoms; prepared.eligible_task_ids and prepared.eligible_execution_ids are the code-computed start/continue eligibility. candidate.execution_decisions is the decision list. Judge the actual prepared work against the current delegation and source-backed requirements. Preparation fixes the commit object but supplies no new business facts. Do not design an alternative implementation or demand repository answers the executor is authorized to investigate.",
    "verdict must be \"consistent\" only when you found no inconsistency; findings must be empty then. List only real inconsistencies, each with what was required and what the candidate does instead.",
    "Name the dimension each finding judges: D1 the roles of the materials the delegation names; D2 the outputs and field scope the delegation requires; D3 whether an authority rule's operation and object resolve to host facts; D4 where an unchanged requirement goes; D5 whether a citation resolves to the text it claims; D6 a requirement the candidate adds that the delegation does not contain; D7 whether the plan actually does the work the delegation asks for — a candidate whose atoms only read, restate, analyse, or ask about the delegated work, without delivering it, violates D7.",
    "Use D7 only with the delegation words that ask for that work: cite the span that asks for the deliverable or the action, and do not raise D7 for a plan that is merely less detailed than you would write, for a question the delegation itself leaves open, or for work the delegation records as paused or unresolved.",
    "Only a finding whose refs resolve can block the batch: cite the delegation source (its source_id plus a span covering the words you rely on) or a current IR entry whose source references support the requirement. A finding that cites nothing, or names a source id or id that is not in this input, is recorded and set aside — do not report it as a reason to reject.",
    "You may not supply the business answer, widen or narrow Authority, rewrite the candidate, or invent ids, revisions, or digests.",
    "event_source_refs contains the exact source_id and code-computed digest for each current or historical source event. Copy those values for citations; do not calculate or invent a digest.",
    "Inspect every current IR.content item and its source text, including relevant source_events. Find any missing, wrongly scoped, invented or incorrectly retained requirement. Verify that every assigned item has an exact requirement_ref in its Atom delivery and that the delivered instruction and completion evidence explain the required behavior sufficiently to execute and assess it without re-reading IR. A coverage explanation or broad Atom label is not a substitute. The instruction is a compilation of the assigned IR, not a second source of business requirements. Historical source_events are evidence, not new requests.",
  ].join("\n"),
  rules: Object.freeze([
    "A path the host reports as existing and readable is provided material: the executor reads it, so 'the compiler cannot see its content' is not a missing binding.",
    "Judge the changes and their effect on retained work: a new restriction may invalidate unchanged content or an execution continuation. Do not ask for work the delegation does not require. Use prepared.dispatchable_atoms as the canonical exact content of work sent to the executor; prepared eligibility is the canonical start/continue scope. Compiler-written self-checks do not substitute for this comparison; an empty checks array is not an inconsistency.",
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
