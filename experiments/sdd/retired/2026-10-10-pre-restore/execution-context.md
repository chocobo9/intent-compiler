# Shared unattended execution context

This is the host's execution authorization for this run, applicable to Root,
specification authors, independent reviewers, implementers and verifiers.
It does not replace the original requirement sources or SDD acceptance gates.

## Decisions in unattended development

The user authorized unattended development. For details genuinely unspecified by
the original requirements, select a reasonable, minimal, deterministic convention
and record its rationale as an assumption. These recorded assumptions are operative
development decisions for this run, not a request to wait for human confirmation.
Do not mark the entire PRD pending human approval solely because it contains such
assumptions. An assumption must never contradict an explicit requirement or erase
a required behavior. An actual contradiction, omitted explicit requirement or
unresolvable ambiguity remains a valid SPEC_GAP; cite the conflicting source.

Independent reviewers receive this same authorization. Judge whether a recorded
decision is compatible with the original requirements, not whether a human replied
to every question. Do not introduce stricter product requirements during review.
An unspecified implementation choice is not by itself a conflicting requirement.
For example, when independent invalid inputs occur together and the sources do not
prescribe error precedence, do not require an exhaustive precedence table merely
to make the design pass. Report a blocking ambiguity only with the affected required
behavior and why a compatible deterministic implementation cannot be selected.

## Stage responsibilities

Specification design produces source declarations and behavior contracts. Missing
function bodies are expected at this stage. Review whether the intended executable
entry, build configuration and required command/output behavior are represented
in the design. A design-stage declaration skeleton is not yet required to build
or satisfy functional tests. Do not add implementation bodies to pass design review.
Actual compilation, executable production, tests and independent implementation
verification belong to coding. Do not waive a missing entry/build contract itself.
In incremental development, existing function bodies may still implement the old
baseline. For declarations marked @pendingUpdate, review the new contract against
the requirements; a mismatch with the inherited body is coding work, not by itself
a specification defect. A contradiction between new contracts remains a valid gap.
Do not ask the Author to reconcile contracts to obsolete implementation behavior.
Choose a source/package layout compatible with the exact requested build command;
do not silently substitute a different command or rely on packaging fallbacks to
claim that the original build requirement is satisfied.

Use the original sources for exact command lines, flags, output streams and errors.
Specific command behavior takes precedence over a general error-handling convention.
Preserve explicit exceptions and distinguish them in the contracts.

For successive user updates, read the accumulated original inputs in chronological
order. A later explicit revision changes the affected requirement; the remaining
earlier requirements continue to apply. Use only this run's supplied code baseline
and requirement files, never future rounds, official tests or reference solutions.

## Complete authoring and review scope

For long documents, persist a small outline first, then fill sections through
bounded file edits. Do not buffer the entire PRD or design document into one huge
tool argument. Keep each edit to a manageable section (roughly 4,000 characters),
read back the saved content, and continue until all required sections are complete.
A partially written document is work in progress, not a PASS; run the usual final
checks only after the full document is on disk.

Before the first handoff, the Author checks the complete supplied requirements
against the actual source contracts: input/field mappings, outputs, exact text
where specified, errors, ordering, defaults, path interpretation and boundary cases.
Keep real unspecified choices explicitly recorded under the unattended authority.
Do not replace an explicit behavior with an unqualified "follow the PRD" statement.
This is a coverage check within the existing author task, not another document or gate.

The independent reviewer examines the whole authorized scope on the first review
and returns all discovered blocking findings together, with source and contract
locations. Distinguish explicit-source omissions, unresolved choices and actual
format violations. Assess composed contracts and explicit mappings together;
equivalent organization does not require repeating a rule in every function.
On revision, recheck earlier findings and regressions while retaining full coverage.
Never defer known findings to an additional review round or suppress a real new gap.

## Count limits and evidence

The host enforces finite repair counts without a round or stage time deadline.
Continue in-scope work through its normal completion checks. On a denial or real blocker,
return the actual status and unresolved findings. Do not manufacture a PASS or
modify acceptance evidence to fit an implementation. Each new repair requires fresh
independent verification under the normal SDD rules. Keep documentation focused on
required behavior and traceability; do not expand optional UI/device sections for a CLI.
