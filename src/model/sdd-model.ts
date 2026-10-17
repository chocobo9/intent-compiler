import { Ajv } from "ajv"
import type { SddCheckFinding } from "../core/sdd-contract.js"
import type { CheckRequest, DeliveryRequest } from "../core/sdd-context.js"
import type { CompilerModelV2, CompilerModelV2Call } from "./compiler-model-v2.js"
import { createCompilerModelV2 } from "./compiler-model-v2.js"
import { createOpenCodeModelTransportV2, createOpenCodeStructuredTransport, narrowEnums, requestIds, type OpenCodeModelTransportOptions } from "./opencode-transport.js"

const text = { type: "string" }
const list = (items: unknown) => ({ type: "array", items })
const object = (properties: Record<string, unknown>) => ({ type: "object", properties, required: Object.keys(properties), additionalProperties: false })
/** The schema with the named properties optional. */
const optional = (schema: { required: string[] }, keys: string[]) => ({ ...schema, required: schema.required.filter(k => !keys.includes(k)) })
// changes is optional: a draft without it gets an entry from code for every changed item.
/** An original passage by the ids sources lists. */
const SEGMENT = object({ source_id: text, segment_id: text })
export const SDD_DELIVERY_SCHEMA = optional(object({
  decision: { enum: ["deliver", "hold"] }, reason: text,
  tasks: list(object({ task_id: text,
    effective: list(object({ item_id: text, text, basis: list(object({ source_id: text, segment_id: text })) })),
    coverage: list(object({ item_id: text, disposition: { enum: ["assigned", "supported", "paused", "unresolved"] }, explanation: text })),
  })),
  fields: list(object({ object: text, items: list(text), fields: list(object({ field: text, type: text, required: text, meaning: text })) })),
  acceptance: list(object({ subject: text, items: list(text), examples: list(object({ given: list(SEGMENT), expect: list(SEGMENT) })) })),
  changes: list(object({ kind: { enum: ["revised", "added"] }, subject: text, items: list(text), subjects: list(text), before: list(SEGMENT), now: list(SEGMENT),
    old_values: list(text), new_values: list(text), parameters: list(text) })),
}), ["changes"])
export const SDD_CHECK_SCHEMA = object({ verdict: { enum: ["consistent", "inconsistent"] }, repair_stage: { enum: ["none", "ir", "ci"] }, findings: list(object({
  dimension: { enum: ["D1", "D2", "D3", "D4", "D5", "D6", "D7"] }, severity: { enum: ["blocking", "note"] }, claim: text, expected: text, observed: text,
  refs: list(object({ id: text, revision: { type: "integer", minimum: 0 }, quote: text })),
})) })
export type DeliveryInput = DeliveryRequest
export interface SddModel {
  ir: CompilerModelV2
  deliver(input: DeliveryInput): Promise<CompilerModelV2Call>
  check(input: CheckRequest): Promise<CompilerModelV2Call>
  /** Optional: a model without them never writes executable examples. */
  examples?(input: ExamplesRequest): Promise<CompilerModelV2Call>
  derive?(input: DeriveRequest): Promise<CompilerModelV2Call>
}
/** The requirements this round writes for (verbatim text), and what is carried. */
export interface ExamplesRequest { request_view: string; requirements: Array<{ item_id: string; revision: number; text: string }>; context: Array<{ item_id: string; text: string }>; carried: string[]; field_dictionary: unknown; issues: string[] }
/** Every example's input only: whether it is a valid invocation, and its result, are worked out again from the requirements. */
export interface DeriveRequest { request_view: string; requirements: Array<{ item_id: string; revision: number; text: string }>; context: Array<{ item_id: string; text: string }>; examples: Array<{ index: number; given: string; run: unknown }> }
const nullable = (schema: unknown) => ({ anyOf: [{ type: "null" }, schema] })
export const SDD_CHECK_SHAPE = object({ exit_code: nullable({ type: "integer" }), stdout_exact: nullable(text), stdout_contains: list(text), stderr_contains: list(text),
  files: list(object({ path: text, exact: nullable(text), contains: list(text) })) })
const RUN_SHAPE = object({ args: list(text), files: list(object({ path: text, content: text })), stdin: nullable(text) })
export const SDD_EXAMPLES_SCHEMA = object({ examples: list(object({ subject: text, items: list(text), tier: { enum: ["verbatim", "derived", "runs"] }, given: text, run: RUN_SHAPE, check: SDD_CHECK_SHAPE })) })
export const SDD_DERIVE_SCHEMA = object({ results: list(object({ index: { type: "integer" }, invocation_valid: { type: "boolean" }, invalid_reason: nullable(text), check: SDD_CHECK_SHAPE })) })
export const SDD_EXAMPLES_INSTRUCTION = `Write executable acceptance examples for the requirements given (their original text, verbatim). Code runs every example against the code SDD delivers and records what fails; the examples are evidence of whether the requirement is met, so each must follow from the requirement alone.
Cover every exact text, exit code and output format these requirements state (each message, including the fixed part of a message with placeholders; each stated exit code; each stated output line, column layout or file), and give inputs for the boundaries their rules already decide: a mismatching or malformed input, a missing file or option, an empty input, a tie, whatever the text decides. Prefer the requirement's own sample inputs.
run.args are the arguments after the program name; run.files every file the command reads (path relative to the working directory, full content), using exactly the requirement's keys and option names; stdin null unless the command reads it. Each run must be a complete, valid invocation under all the requirements: context holds the other current requirements (original text, read only; write no examples for them) that define the command line, required options and input file formats an example uses. Give every required option and write every input file in the format they define, valid in every respect except the one the example is about.
tier verbatim: every expected value in check is written by the requirement (a fixed text verbatim, a template with its placeholders filled from the example's own inputs, an exit code it states, output content it shows). Code verifies this and drops what it cannot find.
tier derived: the requirement's rules determine the exact result for your input but do not write it out (e.g. the rows a filter keeps, a computed column, a sort order); give the exact result. Code asks for the same result again independently from the inputs and keeps the example only when both agree, so give only results that follow unambiguously from the stated rules; leave out anything that depends on an unstated detail (formatting, ordering or rounding the text does not fix).
tier runs: for every command or operation these requirements give a sample input for (a JSON object of a configuration or operation, or a command line), one example that runs that sample as written (the JSON object exactly as the requirement writes it, inside a complete valid invocation and input files that give it what it reads; or the command line with its options) on a minimal valid input. Its check states only the output files the run must write (files with path, exact null, contains empty); code asserts exit code 0, no ERROR on any stream, and those files written. It shows whether the command or operation is implemented at all. Code keeps it only when an input file holds a JSON object the requirement writes, or the arguments follow a command line it writes.
given describes the input in words; code writes the expected result in words from check. check holds only what you assert: exit_code, stdout_exact (whole output) or stdout_contains/stderr_contains (parts; put a message on the stream the requirement names), files (exact for a whole file, contains for parts). items name the content items an example rests on. carried names examples code already carries for unchanged requirements; do not repeat them.`
export const SDD_DERIVE_INSTRUCTION = `For each example, first judge from the requirements given and context (the other current requirements; all original text) whether run is a valid invocation: every required option given, every input file in the format the requirements define, and nothing else wrong with it except what given says the example is about. invocation_valid false with invalid_reason naming what is wrong otherwise.
Then work out from the requirements exactly what the program must produce for run: exit code, stdout, stderr and output files, as check states them (exit_code, stdout_exact or stdout_contains, stderr_contains, files with exact or contains). Use only what the requirements determine; where they leave a detail open, leave it out of check (null or empty). Answer every index.`

export function decodeSdd<T>(call: CompilerModelV2Call, schema: object): T {
  if (call.structured_schema_errors?.length) throw Error(call.structured_schema_errors.join("; "))
  const data: unknown = JSON.parse(call.text)
  const validate = new Ajv({ strict: false, allErrors: true }).compile(schema)
  if (!validate(data)) throw Error(JSON.stringify(validate.errors))
  return data as T
}
export type SddCheck = { verdict: "consistent" | "inconsistent"; findings: Array<Omit<SddCheckFinding, "evidence_resolved">>; repair_stage: "none" | "ir" | "ci" }

export const SDD_DELIVERY_INSTRUCTION = `Compile CI directly from the supplied IR. There are no Atoms or executor permissions in this profile.
SDD receives this CI as its original requirement: its PRD stage clarifies it and writes acceptance criteria, and SDD designs, implements, verifies and checks the code against that PRD. Management's part is the requirement across user updates. Code builds the delivered text: every user input verbatim and in order, in the same form SDD would receive them without management, minus the original passages that an accepted or the current IR selected and this delivery does not deliver (withdrawn, superseded, paused or unresolved); text no IR ever selected stays. You do not write or paraphrase that text.
This CI is incremental. to_write lists the content items this round writes for: those this update added or revised, and those whose earlier entries code could not carry. carried names the field-dictionary objects, acceptance subjects and effective statements code carries unchanged from the accepted delivery (their items are unchanged); do not write them again, do not reuse their names, and keep what you write consistent with them. Items outside to_write are shown by id only; their text is in the delivered requirements and needs nothing from you except a disposition.
For every current task and content item, give its disposition: assigned/supported delivers it; paused/unresolved records why it is not delivered, and code then cuts its passages.
effective: only for a requirement in to_write whose passages come from several inputs where a later input changes part of what an earlier one states: write, in your own words, what now holds for the changed part only, precisely and without adding anything, with basis naming the later input's segments it rests on (source_id and segment_id as listed in sources). Never copy the original text into an effective statement: the original is delivered verbatim, and code rejects an effective statement that repeats it or that is given for a requirement from a single input. Leave effective empty otherwise.
fields: field-dictionary objects in the form of the PRD template's section "接口与数据" (interface and data) for the requirements in to_write: one object for a command (its command-line options) or for a file, configuration, or operation of a configuration with its own parameters, each with items naming the content items it describes; each field is a name the requirement itself gives (an option with its leading dashes, a key, an output field), with type, whether required, and meaning. A file whose content has no named fields (plain CSV data, a digest text) is not an object, and a description is never a field. Code checks every field name is written by the delivered requirements, merges repeated rows, and adds every JSON key and command-line option the delivered text writes that no object lists.
acceptance: SDD's PRD stage is the only stage that reads this CI; design, implementation and SDD's own PRD check work from the PRD, so the exact names and values a command or operation takes are lost unless they are acceptance criteria. For the requirements in to_write give acceptance subjects (a command, an operation, or another unit the requirement defines with its own parameters), each with items naming the content items it covers and examples. An example selects original passages by their segments as listed in sources (source_id, segment_id): given the passages that show an input in the requirement's own form (a command line, a configuration or file sample), expect the passages that state the result for it (output, message, exit code, rule). Code delivers the cited passages verbatim. Where the requirement states a result without giving an input, cite expect only. Cite only passages that state what currently holds.
changes: this update's change list, placed first in the delivered text, so that SDD carries every change into its PRD as its own item. From ir_change (what this update added or revised, and the previous versions of exactly those items) give one entry per change: kind revised for a behaviour correction of an existing command or operation, kind added for each new command or operation. subject names it; subjects lists the command and operation names it concerns, as written; items the content items this update added or revised that it rests on; now the segments of this update that state it; for revised, before the segments of earlier inputs that state the rule it replaces, old_values the values or names it replaces as written in before, and new_values those replacing them as written in now; parameters the parameter or option names of an added command or operation. Code delivers the cited passages verbatim and adds an entry for every changed item no entry covers. Leave changes empty for the first update.
previous_draft, when present, is your earlier answer that issues rejected: return it revised only where the issues point (and where a fix there requires a consistent change elsewhere), keeping every other part as it was; do not rewrite or re-derive the rest.
A deliver decision needs delivered requirements and allowed task scope. Use hold with a concrete reason when there is nothing approved to deliver. Read prior statements and their updates together. SDD owns design, implementation and internal repair.
ir_change states what this update changed and the previous versions of exactly those objects. history gives the latest delivery's decisions, each current requirement's latest delivery record and those deliveries' runs. feedback gives SDD's own PRD consistency check of delivered code. Feedback is SDD's judgment, not a user requirement: never turn it into a new requirement or an extra development run.`

/** A structured transport whose schema enumerates the ids each request lists. */
function perRequest<Request>(options: OpenCodeModelTransportOptions, instruction: string, schema: object): (request: Request) => Promise<CompilerModelV2Call> {
  return request => createOpenCodeStructuredTransport<Request>(options, instruction, narrowEnums(schema, requestIds(request)))(request)
}

export function createSddModel(options: OpenCodeModelTransportOptions): SddModel {
  return {
    ir: createCompilerModelV2(createOpenCodeModelTransportV2({ ...options, narrowIds: true })),
    // M1 (v6): ids in an answer are the ones this request lists (strict output enforces the enum).
    deliver: perRequest<DeliveryInput>(options, SDD_DELIVERY_INSTRUCTION, SDD_DELIVERY_SCHEMA),
    examples: perRequest<ExamplesRequest>(options, SDD_EXAMPLES_INSTRUCTION, SDD_EXAMPLES_SCHEMA),
    derive: createOpenCodeStructuredTransport<DeriveRequest>(options, SDD_DERIVE_INSTRUCTION, SDD_DERIVE_SCHEMA),
    check: createOpenCodeStructuredTransport(options,
      `Independently check what this round's CI wrote and decided. The delivered text is built by code: every user input verbatim in order (delivery.text says so instead of repeating the inputs), minus delivery.removed (each cut passage with the earlier IR items that selected it and what the current IR does with it), plus the contract: entries code carried unchanged from the accepted delivery (delivery.contract entries with carried true, already checked when written; their items are unchanged) and the entries delivery.draft wrote this round for to_write. Sources show the new input, the passages of the requirements written this round and of the cuts; other requirements are shown by id only. Judge: each cut (truly withdrawn, superseded or not delivered now; nothing still required cut), whether something withdrawn or replaced still stands uncut, the dispositions, every effective statement written this round (it states in new words exactly what the later input makes hold and adds nothing), and the field-dictionary objects and acceptance examples written this round (exact names of their own command or operation, expectations as the requirement states them, nothing withdrawn). Completeness of names is code's: never report an omitted object, field, subject or example. Give every finding a severity. blocking only for: (1) a name, key, value or behaviour the requirement does not give, (2) withdrawn, superseded or paused content presented as current, (3) a statement that contradicts the requirement, (4) a wrong cut (required text cut, or withdrawn text left standing). Everything else (wording, precision, placement, a missing but not contradicted detail) is a note. Only resolved blocking findings send the CI back; notes are recorded. Return consistent when there is no blocking finding, with repair_stage none; otherwise name whether the prepared ir or just ci needs repair. Give each finding refs to the material it rests on: a listed input's source_id with revision 0 and an exact quote of that input, or an IR object (task, content, binding, output) or the CI with its id and revision (quote may be empty or an exact excerpt).`, SDD_CHECK_SCHEMA),
  }
}
