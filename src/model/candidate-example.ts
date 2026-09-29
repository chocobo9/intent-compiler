import { digestText, type Atom, type Candidate, type SourceRef } from "../core/intent-contract.js"

const goal = "Implement bundle and inspect commands in the provided workspace."
const common = "For either command, when a required input file is missing, print INPUT_MISSING followed by a newline to stderr, exit 2 and do not create an output file. Successful commands exit 0."
const bundleInput = 'bundle accepts a config file path and an output file path. The config is an object with an items array of objects containing string fields source and label: source names a UTF-8 input file and label names the entry. For example {"items":[{"source":"sample.txt","label":"demo"}]}; sample.txt and demo are replaceable example values.'
const format = 'The bundle file is a JSON array of objects with string fields label and body: label is the entry name and body is the complete UTF-8 file text.'
const bundleBehavior = "bundle reads the input files and writes entries in items order using the bundle file format. An empty input file has body \"\"; an empty items array produces []."
const inspect = "inspect accepts a bundle file path and writes each label to stdout in array order, followed by a newline per label. An empty array writes no characters. Validate inspect using an actual output file from the accepted bundle implementation."

export const CANDIDATE_EXAMPLE_INPUT = [goal, common, bundleInput, format, bundleBehavior, inspect].join("\n\n")
const source = { source_id: "input-event-id", digest: digestText(CANDIDATE_EXAMPLE_INPUT) }
const span = (text: string): SourceRef => {
  const start = CANDIDATE_EXAMPLE_INPUT.indexOf(text)
  if (start < 0) throw new Error(`example passage is not in the example input: ${text.slice(0, 40)}`)
  return { ...source, span: { unit: "utf16", start, end: start + text.length } }
}
const ref = (local_ref: string) => ({ local_ref })

function atom(atom_id: string, task: string, outputs: Atom["outputs"], completion: Atom["completion"]): Atom {
  return {
    atom_id, revision: 0, goal_refs: [], task, inputs: [], outputs, constraints: [],
    optional_tools: ["read", "edit", "bash"],
    authority: {
      basis: [span(goal)],
      rules: ["read", "edit", "bash"].map(operation_id => ({
        operation_id, resource_ref: source, input_refs: [], output_refs: [], conditions: [],
        allowed_use: `${operation_id} for this command's implementation and validation within the provided workspace.`,
      })),
      lifetime: "this_execution", delegation: "not_supported",
    },
    preconditions: [], completion,
    return_when: ["Return the implementation, actual products and completion evidence on success. On failure or a blocker, return the facts and unmet completion conditions for management; that report does not satisfy completion."],
    intent_judgments: [],
  }
}

export const CANDIDATE_EXAMPLE: Candidate = {
  schema_version: 2,
  basis: { event_ids: [source.source_id], refs: [] },
  source_coverage: [],
  groups: [{
    local_ref: "g1", task_refs: ["t1"], depends_on: [],
    ir_changes: [{
      action: "create", target: "task", local_ref: "t1",
      value: { goal: { text: goal }, current_scope: { text: "Implement and validate both commands in the provided workspace.", disposition: "proceed" } },
      sources: [span(goal)],
    }, ...[
      { id: "r-common", label: "Authorized commands and their shared missing-input and success behavior.", passages: [goal, common] },
      { id: "r-format", label: "The format produced by bundle and consumed by inspect.", passages: [format] },
      { id: "r-bundle", label: "Bundle configuration, ordered reading and empty-input behavior.", passages: [bundleInput, bundleBehavior] },
      { id: "r-inspect", label: "Inspect output and validation using the predecessor's real product.", passages: [inspect] },
    ].map(({ id, label, passages }) => ({
      action: "create" as const, target: "content" as const, local_ref: id,
      value: { text: label, about: [], scope: [{ target_id: "t1" }], support: [] },
      sources: passages.map(span),
    }))],
    compilation: {
      decision: "replace",
      drafts: [{
        local_ref: "ci-1", task_id: "t1", intent_basis: [],
        atoms: [
          atom("a-bundle", [
            "Implement and validate bundle in the provided workspace. Keep unspecified internal design open.",
            bundleInput, format, bundleBehavior, common,
            "Return the implementation, actual generated bundle files and evidence for the rules above so inspect can consume an accepted output.",
          ].join("\n\n"), [
            { output_id: "bundle-code", description: "Bundle implementation and validation evidence.", format: "artifact" },
            { output_id: "bundle-files", description: "Actual bundle output files used in validation, with their locations and input cases for the consumer.", format: "artifact" },
          ], [
            { text: "The items array and source/label fields select the files and names; the output follows the specified label/body format and items order, including both empty cases.", evidence_required: "Config and input files, invocation, actual JSON output and comparison with input text/order, including empty file and empty items cases; sample values remain replaceable" },
            { text: "Missing required input prints INPUT_MISSING plus newline to stderr, exits 2 and creates no output file; successful cases exit 0.", evidence_required: "Missing config/input and success invocations with stdout/stderr, exit codes and output-file observations" },
          ]),
          atom("a-inspect", [
            "Implement and validate inspect in the provided workspace after management accepts bundle's required products. Keep unspecified internal design open.",
            format, inspect, common,
            "Consume the actual predecessor bundle file; do not claim it exists before its accepted return. Return implementation and evidence for the rules above.",
          ].join("\n\n"), [
            { output_id: "inspect-code", description: "Inspect implementation and evidence consuming the actual accepted bundle output.", format: "artifact" },
          ], [
            { text: "For the specified bundle format, stdout contains labels in array order, each with a newline; the empty array produces no characters.", evidence_required: "Actual accepted predecessor file and inspect invocation/output, including an empty-array case" },
            { text: "Missing input prints INPUT_MISSING plus newline to stderr and exits 2 without creating an output file; successful cases exit 0.", evidence_required: "Missing-input and success invocations with stderr, exit codes and output observations" },
          ]),
        ],
        relations: [{
          predecessor: ref("a-bundle"), successor: ref("a-inspect"),
          requires: "Accepted bundle implementation, actual generated bundle files with their locations and input cases, and validation evidence; inspect consumes these products for its validation.",
          conditions: [], basis: [span(inspect)],
        }],
        attachments: [],
      }],
    },
    execution_decisions: [], assessments: [],
    coverage: [
      { requirement: ref("t1"), disposition: "assigned", refs: [ref("a-bundle"), ref("a-inspect")], explanation: "Both commands deliver the whole task." },
      { requirement: ref("r-common"), disposition: "assigned", refs: [ref("a-bundle"), ref("a-inspect")], explanation: "The shared behavior applies to both commands; neither unit alone is assigned the whole implementation." },
      { requirement: ref("r-format"), disposition: "assigned", refs: [ref("a-bundle"), ref("a-inspect")], explanation: "Bundle produces this format and inspect consumes it." },
      { requirement: ref("r-bundle"), disposition: "assigned", refs: [ref("a-bundle")], explanation: "Only bundle implements the configuration and production behavior." },
      { requirement: ref("r-inspect"), disposition: "assigned", refs: [ref("a-inspect")], explanation: "Inspect implements consumption and its evidence depends on bundle's accepted product." },
    ],
    checks: [], questions: [],
  }],
}
