# Shared unattended execution context

This run is unattended: no human is available to answer questions. It does not
replace the original requirement sources, the SDD workflow or any SpecArt gate.

For details the original requirements leave unspecified, choose a reasonable,
minimal, deterministic convention and record it as an assumption. Recorded
assumptions are this run's operative decisions, not requests awaiting human
confirmation. An assumption must never contradict an explicit requirement.

Where explicit requirements appear to conflict, nobody can be asked: decide as a
careful reader would. A later update governs what it changes, and a specific rule
is an exception to a general one (for example, time fields a command is required to
record are an exception to a general determinism rule, as `generated_at` is). Record
the decision and its reason as an assumption and continue; do not leave it open or
stop for it. Report a blocker only when no reasonable implementation satisfies the
requirements under any reading.

The target is a Go command-line program. Sections about UI, HarmonyOS, Ability or
device capabilities are not applicable; do not add them.

Use only this run's supplied code baseline and requirement files. Do not read
other runs, later rounds, official tests or reference solutions.
