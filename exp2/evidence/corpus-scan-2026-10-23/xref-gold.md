# Cross-reference gold set (corpus scan 2026-10-23)

Source: `D:/huawei/EvoCodeBench/docs/data/tasks/*.json` (26 tasks). Machine-readable data: `xref-gold.json` (717 entries).

## Summary

| task | rounds>=2 | total | same_rules | same_format | uses_output_of | extends | depends_on | low-confidence | read status |
|---|---|---|---|---|---|---|---|---|---|
| buildctl-pipeline-orchestrator | 7 | 14 | 1 | 0 | 0 | 1 | 12 | 0 | rounds 2-8 read in full |
| deterministic-data-pipeline-go | 14 | 28 | 7 | 2 | 1 | 16 | 2 | 1 | rounds 2-15 read in full |
| eventq-pipeline | 12 | 137 | 69 | 1 | 0 | 9 | 58 | 0 | rounds 2-13 read in full |
| flowctl-pipeline-wiring | 8 | 72 | 30 | 3 | 0 | 0 | 39 | 0 | rounds 2-9 read in full |
| flowr-workflow-orchestrator | 6 | 133 | 40 | 6 | 0 | 10 | 77 | 0 | rounds 2-7 read in full |
| forgekit-monorepo-build-pipeline | 7 | 14 | 0 | 2 | 0 | 2 | 10 | 1 | rounds 2-8 read in full |
| gomlops-platform-modernization | 6 | 29 | 5 | 5 | 0 | 4 | 15 | 0 | rounds 2-7 read in full |
| hermetic-build-artifact-verifier | 6 | 26 | 12 | 3 | 0 | 3 | 8 | 0 | rounds 2-7 read in full |
| jobforge-dag-runner | 8 | 35 | 27 | 2 | 1 | 0 | 5 | 0 | rounds 2-9 read in full |
| lsm-kvstore-engine | 7 | 8 | 3 | 0 | 0 | 2 | 3 | 0 | rounds 2-8 read in full |
| minicc-compiler-evolution | 7 | 10 | 3 | 0 | 0 | 2 | 5 | 0 | rounds 2-8 read in full |
| ml-checkpoint-forensics-engine | 8 | 3 | 1 | 0 | 0 | 0 | 2 | 0 | rounds 2-9 read in full |
| ml-checkpoint-reproducibility-engine | 7 | 6 | 2 | 1 | 0 | 0 | 3 | 0 | rounds 2-8 read in full |
| ml-eval-report-engine | 6 | 2 | 0 | 0 | 1 | 0 | 1 | 0 | rounds 2-7 read in full |
| mlops-inference-gateway | 7 | 3 | 0 | 0 | 0 | 0 | 3 | 1 | rounds 2-8 read in full |
| mlpipe-dag-orchestrator | 6 | 16 | 8 | 0 | 0 | 0 | 8 | 0 | rounds 2-7 read in full |
| mlpipe-inference-pipeline-migration | 12 | 8 | 1 | 2 | 0 | 0 | 5 | 0 | rounds 2-13 read in full |
| mlpipe-orchestrator | 6 | 19 | 3 | 2 | 0 | 3 | 11 | 0 | rounds 2-7 read in full |
| multiservice-deploy-pipeline | 10 | 55 | 5 | 5 | 0 | 10 | 35 | 0 | rounds 2-11 read in full |
| nexus-ml-pipeline-system | 7 | 11 | 2 | 0 | 0 | 1 | 8 | 0 | rounds 2-8 read in full |
| numeriforge-reproducibility-migration | 7 | 11 | 1 | 1 | 0 | 3 | 6 | 0 | rounds 2-8 read in full |
| repro-verify-engine | 6 | 5 | 0 | 0 | 4 | 0 | 1 | 0 | rounds 2-7 read in full |
| secaudit-log-sentinel | 14 | 26 | 7 | 4 | 14 | 0 | 1 | 1 | rounds 2-15 read in full |
| service-mesh-health-router | 7 | 18 | 0 | 0 | 0 | 5 | 13 | 0 | rounds 2-8 read in full |
| sparse-iterative-pde-solver | 6 | 23 | 14 | 6 | 0 | 0 | 3 | 0 | rounds 2-7 read in full |
| sparse-iterative-solver-review | 4 | 5 | 2 | 0 | 0 | 0 | 3 | 0 | rounds 2-5 read in full |
| **all** | 201 | 717 | 243 | 45 | 21 | 71 | 337 | 4 | |

Confidence totals: high 527, medium 186, low 4.

## Method and limits

**Process.** For each of the 26 tasks I read every round n >= 2 in full (as plain text dumped from the JSON), plus round 1 where it defines the earlier feature. Each label was written by hand into a per-task file as (round, sentence, referenced_feature, earlier_round, earlier_quote, kind, confidence, note). A script (`python -I`) then checked that the sentence is a whitespace-normalised substring of that round's `md`, that `earlier_quote` is a substring of the cited earlier round, that the earlier round is strictly smaller than the round, and that length limits hold (sentence <= 400, quote <= 200). Entries failing any check were fixed or dropped; the final set has zero failures. The JSON and this file are written by script from the checked list.

**Completeness.** No task is marked incomplete: every round >= 2 of all 26 tasks was read. This is a judgement-based gold set, not an exhaustive one. Recall is probably highest for explicit pointers ("same as", "as in", "identical to", "unchanged") and lower for implicit ones (a new sentence that silently reuses an earlier rule). Round-1-only tasks defer to external docs (forensics, eval-report, repro-verify): their rounds >= 2 carry few pointers, so counts are low.

**Rules for ambiguous cases.**
1. Same-round references are excluded. Example: in dpipe round 2, `detect iqr` using "the same percentile method as the `profile` command" is not labelled because `profile` is introduced in that round.
2. Sentences that revise, replace, tighten or withdraw an earlier rule are excluded (fixes, conflicts, corrections, breaking changes). When a revision section contains a separate sentence that only points back without changing anything (for example "the existing X rule is unchanged"), that sentence is kept, with a note and usually medium confidence.
3. Generic restatements are excluded ("all existing behaviour continues", "everything from base behaviour still holds", "unchanged behaviors" lists, "all prior usage-error rules hold").
4. A sentence that only adds a flag or field to a host command without pointing back is excluded. It is kept as `extends` when it names the earlier mechanism as the extension point (for example "The `pipeline` command now supports the `drift` step type", "`flowr diff` now compares the new fields", "gains a new top-level key") or integrates with a named earlier output or report.
5. `kind` choice. same_rules: reuses an earlier rule or algorithm. same_format: reuses an earlier output or input format, message, or field layout. uses_output_of: consumes an earlier command's output (for example "as output by `secsentinel enrich`", "reads a report.json generated by evaluate"). extends: adds to a named earlier feature without changing its rules. depends_on: relies on, composes with, or states a non-change of an earlier feature.
6. Several sentences that say the same thing in one round (the same sentence repeated for different subsections) are listed once; where a sentence occurs twice verbatim in a round, the note says so.
7. `earlier_round` is the round that defines the referenced feature; `earlier_quote` is a verbatim fragment from that round that defines or best matches it. When the text points to an implied base feature that the earlier round never spells out (for example out-of-bounds array reads in minicc), `earlier_round` and `earlier_quote` are null or the closest defining sentence, and the note says so. Where one sentence points at features from two earlier rounds (for example --profile from R3 and --targets from R5), the later one is cited and the note names both.
8. Confidence: high = explicit pointer plus clear earlier definition; medium = pointer is explicit but the earlier definition is partly implied, or the sentence lives in a revision section; low = contrast references or weak implicit ties.

**Known limits.** The sentence granularity follows Markdown bullets or sentences; a few entries are a clause or a bullet text rather than a full sentence (verbatim substrings, as required). Some sentences cite "rounds" or feature names in the benchmark's own vocabulary (for example "the audit-log feature"), which I treated as explicit pointers. Task texts contain internal inconsistencies (for example eventq round 9 still lists `fx_lookup` after round 4 retired it; flowr round 6 names exit codes inconsistently); these were not corrected. Counts per task depend on how pointer-dense the task text is, not on task size.

## Per-task tables

### buildctl-pipeline-orchestrator

| round | kind | referenced_feature | sentence (first 120 chars) | earlier_round |
|---|---|---|---|---|
| 2 | same_rules | working directory rule (CWD rule from Round 1) | In particular, every target's command — whether local or imported, at any import depth — executes with the **root (entry | 1 |
| 2 | extends | graph, status, clean commands | The `graph`, `status`, and `clean` commands must also respect imports. | 1 |
| 2 | depends_on | cache-key computation | Any `${VAR_NAME}` in a target's `command`, `inputs`, or `outputs` is expanded before execution and before cache-key comp | 1 |
| 3 | depends_on | target timeout | All hooks and the main command share the target timeout as one deadline. | 1 |
| 7 | depends_on | pipeline variable expansion (R2 variables) | Matrix substitution happens before pipeline variable expansion, so `${key}` in a matrix target always resolves to the ma | 2 |
| 8 | depends_on | pre_build/post_build hooks | When a target's execution fails (any step in the pre_build hooks, the main command, or the post_build hooks exits non-ze | 3 |
| 8 | depends_on | BUILDCTL_ENV hook exports | Each retry attempt begins with a fresh hook environment -- `BUILDCTL_ENV` exports from a previous attempt's hooks do not | 3 |
| 8 | depends_on | target timeout / hook shared deadline | The target's timeout covers all attempts combined: the deadline is set once before the first attempt and is never reset  | 3 |
| 8 | depends_on | cached status | Cached targets report `attempts` 1. | 1 |
| 8 | depends_on | fail-fast mode | In fail-fast mode (the default), a target is only declared failed after all retries are exhausted -- other independent t | 5 |
| 8 | depends_on | cancelled status | If the pipeline halts due to another target's failure while a target is between retry attempts, that target receives sta | 5 |
| 8 | depends_on | matrix expansion | Matrix-expanded targets inherit the `retry` value (it is an integer, not subject to `${key}` substitution). | 7 |
| 8 | depends_on | cache key | The cache key does not include the retry count -- changing `retry` alone does not invalidate the cache. | 3 |
| 8 | depends_on | deps command | The `deps` command is unaffected by retry. | 4 |

### deterministic-data-pipeline-go

| round | kind | referenced_feature | sentence (first 120 chars) | earlier_round |
|---|---|---|---|---|
| 2 | same_rules | aggregate transform semantics | Supported functions: `sum`, `avg`, `count`, `min`, `max` (same semantics as the `aggregate` transform — non-numeric valu | 1 |
| 2 | same_rules | derive expression evaluator | `expression`: a boolean expression using the same syntax as the `derive` operation's expression evaluator (same operator | 1 |
| 2 | extends | fill transform | The existing `fill` transform now supports an additional strategy: `"linear"`. | 1 |
| 2 | extends | pipeline step types | The `pipeline` command now supports the `"profile"` step type: | 1 |
| 2 | extends | pipeline step types | The `pipeline` command now additionally supports the `"compare"` step type: | 1 |
| 3 | depends_on | profile stddev | The `profile` command's `stddev` field is unaffected — it continues to use population standard deviation. | 2 |
| 3 | extends | profile output (numeric columns) | Numeric column profiles (`int` and `float`) now include two additional percentile fields: | 2 |
| 3 | same_rules | percentile interpolation (p25, median, p75) | Both use the same interpolation method as `p25`, `median`, and `p75`: compute `idx = p / 100 * (n - 1)`, interpolate bet | 2 |
| 3 | same_rules | profile command type inference and numeric statistics | Build a column-level statistical profile for each CSV file internally (using the same type inference rules and numeric s | 2 |
| 3 | extends | pipeline step types | The `pipeline` command now supports the `"drift"` step type: | 1 |
| 5 | same_format | pipeline config format | `--config`: path to a pipeline JSON configuration file (same format as the `pipeline` command). | 1 |
| 5 | extends | pipeline step types | The `pipeline` command now supports the `"lineage"` step type: | 1 |
| 6 | depends_on | command input flags (transform, profile, validate, verify, ingest, compare, drift, pipeline, lineage) | Primary input is: `--input` for transform/profile/validate, `--file` for verify, `--input` for ingest, `--left` for comp | 2 |
| 6 | same_rules | profile percentile calculation | `"median"`: median using the same percentile calculation as the profile command (linear interpolation at p=50). | 2 |
| 6 | extends | pipeline command | The `pipeline` command now supports the `"audit"` behavior: when the pipeline itself is invoked with `--audit`, the audi | 1 |
| 8 | extends | lineage command | The `lineage` command recognizes `"quality"` steps: | 5 |
| 9 | same_rules | quality command type detection | **Type detection**: same logic as quality command. | 8 |
| 9 | extends | lineage command | The `lineage` command recognizes `"schema"` steps: | 5 |
| 10 | uses_output_of | manifest command output | Compares two manifest files (as produced by the `manifest` command) and reports differences. | 1 |
| 10 | extends | lineage command | The `lineage` command recognizes `"reconcile"` steps: | 5 |
| 11 | same_rules | manifest checksum algorithm | **file_hash**: BLAKE2b-256 hex digest of the raw file bytes (same algorithm as manifest). | 5 |
| 11 | extends | lineage command | The `lineage` command recognizes `"fingerprint"` steps: | 5 |
| 12 | same_format | normalize numeric formatting | Otherwise, output `(value - min) / (max - min)` using the same numeric formatting already used by normalize. | 2 |
| 13 | extends | pipeline step types | The `snapshot` command must be available as a pipeline step: | 1 |
| 13 | extends | lineage report | Lineage reports must recognize `"snapshot"` steps with `input` as the input file and `output` as the output file. | 5 |
| 14 | extends | pipeline step types | The `changelog` command must be available as a pipeline step: | 1 |
| 14 | extends | lineage report | Lineage reports must represent a `"changelog"` step with two inputs, `input` and `right`, and one output, `output`. | 5 |
| 15 | extends | derive transform (contrast) | This differs from `derive` (which evaluates expressions) -- `tag` simply assigns a literal value to every row. | 1 |

### eventq-pipeline

| round | kind | referenced_feature | sentence (first 120 chars) | earlier_round |
|---|---|---|---|---|
| 2 | same_rules | R1 usage-error rules | Usage-error rules (exit `2`) are unchanged from default base behavior for the mandatory flags. | 1 |
| 2 | same_rules | R1 usage-error string | Negative values exit `2` with the existing usage-error string. | 1 |
| 2 | same_rules | R1 usage-error string | Invalid `--pending-ttl` values (negative, non-integer) exit `2` with the existing usage-error string. | 1 |
| 2 | same_rules | base money rounding | `usd` is formatted with the same two-decimal half-away-from-zero rule as base money. | 1 |
| 2 | extends | R1 watermark late rule | `late` (bucket 2) — passes validation, but `ts < seeded_max_ts - watermark_lag`. | 1 |
| 2 | same_rules | R1 chargeback ordering rule | A chargeback cannot be resolved by a purchase that appears later in the current run (base rule) or by a purchase that wa | 1 |
| 2 | extends | R1 watermark | **Watermark seed**: at the start of the run, the watermark's `max_ts` is seeded from `state.watermark.max_ts` (if `has_m | 1 |
| 2 | extends | R1 sessionization | the original sessionization groups a single run's surviving events per user with a new session boundary whenever consecu | 1 |
| 2 | same_rules | R1 sessions.total | `--output.sessions.total` continues to count distinct current-run sessions as in default base behavior. | 1 |
| 2 | same_rules | R1 sessions.by_user | `--output.sessions.by_user[u]` continues to aggregate across all of `u`'s current-run events (its shape is unchanged fro | 1 |
| 2 | same_rules | R1 sessionization | If a user has no carried entry, default base behavior sessionization applies as-is, starting at `session_index = 1`. | 1 |
| 2 | same_rules | R1 sessions output | `--output.sessions.total` and `--output.sessions.by_user[u]` continue to describe the current run's events only (as in d | 1 |
| 2 | depends_on | R1 --output and --rejects | `--output` and `--rejects` continue to describe **only events that arrived in the current run's `--input-dir`**. | 1 |
| 2 | same_rules | R1 chargeback aggregation | IS counted in the current run's `total_events` and `by_type.chargeback` (+1 count, +0.00 to `total_usd` and `avg_usd` —  | 1 |
| 2 | extends | R1 anomalies.duplicate | `--output.anomalies.duplicate` includes both same-run duplicates (base rule) and cross-run duplicates (matches against ` | 1 |
| 3 | depends_on | state-in/state-out | `--audit-log` is independent of `--state-in`/`--state-out`. It may be used on a pure default base behavior run (no state | 2 |
| 3 | same_rules | --state-out atomicity rule | Writing `--audit-log` uses the same atomicity rule as `--state-out`: build the payload in memory, write to `<audit-log>. | 2 |
| 3 | same_rules | arrival stream order and --rejects order | Objects are emitted in the **current run's arrival stream order** (default base behavior `(shard_name, line_index)` orde | 1 |
| 3 | same_rules | base money rounding | `usd`: the USD amount that contributed to aggregates — for purchases and refunds, the FX-converted value (same two-decim | 1 |
| 3 | depends_on | open-session carry-over rules | `session_index`: the 1-based session index assigned to this event within its user's current-run session sequence (honori | 2 |
| 3 | same_rules | base valid event types | `"missing_type"` or `"bad_type"` — `type` missing / not a string / not one of `purchase`, `refund`, `chargeback`, `login | 1 |
| 3 | same_rules | base amount validation rules | This follows the default base behavior numeric rules: v1 `amount` is invalid if it is not a finite JSON number or is neg | 1 |
| 3 | same_rules | FX date/currency lookup rule | `"fx_lookup"` — amount+currency valid at JSON level but no day-rate entry exists for the (date, currency) pair (same bas | 1 |
| 3 | depends_on | seeded watermark cutoff | `cutoff` is the effective `seeded_max_ts - watermark_lag` threshold (ISO `YYYY-MM-DDTHH:MM:SSZ`) used when classifying t | 2 |
| 3 | same_rules | base dedup tie-break | `"same_run"` means another event with the same `id` arrived earlier in the current run and won the tie-break (base rule) | 1 |
| 3 | depends_on | state.seen_ids | `"cross_run"` means `id` was present in `state.seen_ids` from a prior run. | 2 |
| 3 | same_rules | base handling of non-JSON-object lines | (This matches the original treatment of such lines.) | 1 |
| 3 | same_rules | base money rounding | `usd` uses exactly two decimal places with half-away-from-zero rounding (same as base money). | 1 |
| 3 | depends_on | state_stats block | `state_stats` in `--output` is unchanged — no new keys are added in the audit-log feature. | 2 |
| 3 | same_rules | usage-error string | `--audit-log` with no argument value, or pointing to a path whose parent directory does not exist, exits `2` with the ex | 1 |
| 3 | same_rules | --state-out atomicity rule | The digest is written using the same `.tmp` + rename atomicity as `--audit-log` and `--state-out`. | 2 |
| 4 | depends_on | rejects ordering and format | `--rejects` bytes are UNCHANGED vs. the audit-log feature. The rejects file format never included reason codes, so the s | 1 |
| 4 | depends_on | --audit-log | It may be used with or without `--audit-log`. | 3 |
| 4 | same_rules | usage-error string | `--rates-strict` has no argument value. Passing it a value (e.g. `--rates-strict=foo`) is a usage error: exit `2` with t | 1 |
| 4 | same_rules | base FX file errors | An empty `days` map or a file that fails to parse as JSON still yields the default base behavior errors (`fx days invali | 1 |
| 5 | same_rules | state_stats.run_index | This matches the stateful ingest `state_stats.run_index` semantics exactly. | 2 |
| 5 | same_format | audit digest rates_digest | **`rates_digest`**: the 64-character lowercase-hex canonical digest of `rates.json`, identical to the `rates_digest` fie | 4 |
| 5 | same_rules | audit digest bucket_counts | Each value is a non-negative integer counting this run's per-bucket classification totals (current-run only, mirroring t | 3 |
| 5 | depends_on | anomalies buckets | `events_rejected_total`: total count of non-accepted outcomes across all shards = `invalid + late + duplicate + unresolv | 1 |
| 5 | same_rules | atomic .tmp+rename write | It is pretty-printed with **2-space indentation** and a **trailing newline**, and is written via `.tmp`+rename. | 2 |
| 5 | same_rules | atomic .tmp+rename write | The manifest is written as `<path>.tmp` and then atomically renamed to `<path>`. | 2 |
| 5 | depends_on | audit log atomic write | The manifest is written **after all other outputs have been finalized**, so the `sha256` / `bytes` fields reflect the fi | 3 |
| 6 | same_rules | R1 dedup winner rule | The default keeps the existing winner rule: the lexicographically largest `ts` wins, with arrival order used as the tie- | 1 |
| 6 | same_rules | R1 dedup tie-break | If two events tie on `ts`, the earlier in the run's arrival order (`(shard_basename ascending, line_index ascending)`) w | 1 |
| 6 | depends_on | rejects and audit-log duplicate bucket | Losers are appended to the `--rejects` file in arrival order (duplicate bucket), and appear with `bucket=duplicate` in t | 1 |
| 6 | same_rules | R1 rejects-file contract | The rejects-file contract from default base behavior is unchanged. | 1 |
| 6 | depends_on | cross-run dedup against state.seen_ids | The cross-run dedup check (against `state.seen_ids`) is **unchanged**: any current-run event whose `id` is present in `s | 2 |
| 6 | depends_on | audit-log record order and vocabulary | Audit-log records are still emitted in arrival order, one per current-run input event, with the same bucket vocabulary. | 3 |
| 6 | extends | audit-log duplicate record shape | each such record MUST carry a new key `winner_arrival` positioned **immediately after** the existing `reason` key. | 3 |
| 6 | depends_on | audit digest duplicate_reasons | The `duplicate_reasons` object is unchanged: exactly two keys `same_run` and `cross_run`, always present, integer counts | 3 |
| 6 | depends_on | audit digest sha256 | As a consequence, the digest's `sha256` still equals the SHA-256 of the audit log's on-disk bytes | 3 |
| 6 | extends | audit digest key order | the digest JSON gains a new sub-object keyed `dedup_policy_stats`, positioned **after** `resolved_against` and **before* | 4 |
| 6 | depends_on | state.seen_ids | `state.seen_ids` is still the union of all ids that passed validation + watermark admission in the current run (winners  | 2 |
| 6 | depends_on | state.pending_purchases | `state.pending_purchases` is rebuilt from the *surviving* purchases only. | 2 |
| 6 | depends_on | state.open_sessions rebuild rule | `state.open_sessions` is rebuilt from surviving events per stateful ingest §4; its contents can differ if the winner eve | 2 |
| 6 | same_rules | R1 rejects format | the existing rejects-ordering contract writes each rejected entry as the original raw input line followed by exactly one | 1 |
| 6 | same_rules | R1 rejects ordering | The reject ordering across the four buckets (invalid → late → duplicate → unresolved_chargeback, arrival order within ea | 1 |
| 6 | depends_on | manifest input_shards | Per-shard `events_accepted` reflects whichever events survived under the active policy; `events_total` is unchanged. | 5 |
| 7 | same_rules | audit-log late cutoff computation | The cutoff itself is computed exactly as in the audit-log feature: it is `seeded_max_ts - watermark_lag_seconds` evaluat | 3 |
| 7 | same_rules | usage-error string | Passing it a value (e.g. `--strict-late-audit=true`) is a usage error: exit `2` with the existing usage-error string. | 1 |
| 7 | depends_on | audit digest bucket_counts.late | `count` — number of `late` audit records in this run (same integer as `bucket_counts.late`). | 3 |
| 7 | depends_on | rejects file format | `--rejects` bytes are UNCHANGED vs. the dedup-policy feature. The rejects file never carried `cutoff` / `watermark_lag_s | 6 |
| 7 | depends_on | manifest outputs.audit_log | When audit rotation is active, `outputs.audit_log` continues to describe the main `--audit-log` path only (the newest se | 5 |
| 7 | depends_on | manifest signature signed_at_utc | `--manifest-signature` recomputes over the new manifest bytes; its `signed_at_utc` is still derived deterministically fr | 5 |
| 7 | depends_on | audit digest blocks | Every other digest block retains its the existing audit-digest shape and position. | 3 |
| 7 | depends_on | manifest and signature outputs | `--out-parquet-manifest` / `--manifest-signature` may change under rotation only because they reflect the main `--audit- | 5 |
| 7 | depends_on | state file format | Legacy state files written by prior rounds (without the key) remain loadable by default — the key is back-filled on writ | 2 |
| 7 | depends_on | state file fields | All other state fields (`version`, `watermark`, `seen_ids`, `open_sessions`, `run_index`) are unchanged. | 2 |
| 8 | depends_on | --output summary JSON | The new `--summary-schema-out <path>` flag writes a sidecar describing the actual current-run shape of the `--output` su | 1 |
| 8 | same_rules | manifest atomic .tmp+rename write | atomically via `.tmp`+rename (same discipline as `--out-parquet-manifest`). | 5 |
| 8 | same_rules | --ingest-id validation | If `--ingest-id <id>` was supplied on this run, `ingest_id` is the JSON string with that exact value (same validation as | 5 |
| 8 | depends_on | state.run_index and manifest.run_index | A JSON integer equal to the run index that would be written to `state.run_index` / `manifest.run_index` for this run: | 5 |
| 8 | depends_on | summary top-level key order | For the existing summary shape this yields the following key order exactly: | 1 |
| 8 | same_rules | --manifest-signature tool_version | `tool_version` — fixed string literal `"eventq/0.5.0"` (the same literal used by `--manifest-signature`'s `tool_version` | 5 |
| 8 | depends_on | manifest outputs enumeration | Neither new sidecar appears in `--out-parquet-manifest.outputs.*` (the manifest still enumerates exactly `summary`, `rej | 5 |
| 9 | depends_on | existing --rejects bytes | `legacy` is the default and preserves the existing on-disk reject bytes. | 1 |
| 9 | depends_on | audit log reject records | For reject rows that came from current-run JSON-object records, the tagged rejects file is a projection of the audit log | 3 |
| 9 | depends_on | winner_shard/winner_line trailing columns | When first-arrival deduplication is active, the existing `winner_shard`/`winner_line` columns remain trailing columns af | 6 |
| 9 | same_rules | first-arrival rejects trailing columns | With `--dedup-policy first-arrival`: the dedup-policy feature §3.6 applies verbatim — each line is `<raw_input_line>\t<w | 6 |
| 9 | same_rules | audit-log bucket values | Identical to the four non-`accepted` audit-log `bucket` values from the audit-log feature. | 3 |
| 9 | same_rules | audit-log shard field | This matches the `shard` field of the audit-log record for the same event. | 3 |
| 9 | same_rules | audit-log line field | This matches the `line` field of the audit-log record for the same event (bare integer, no leading zeros). | 3 |
| 9 | same_rules | legacy rejects raw line | This is the **same** raw string that legacy-format uses as the sole column. | 1 |
| 9 | same_rules | first-arrival rejects trailing columns | The populating rules for the two trailing columns are identical to the dedup-policy feature §3.6 — with the trailing-col | 6 |
| 9 | same_rules | audit-log winner_arrival | These match the `winner_arrival.shard` / `winner_arrival.line` values in the audit log for the same record. | 6 |
| 9 | same_rules | audit-log reason codes | The reason-code vocabulary is identical to the audit-log feature §Record shape per bucket (audit log) and reuses the sam | 3 |
| 9 | same_rules | rejects four-bucket ordering | The four-bucket ordering from default base behavior is preserved exactly: all `invalid` rows first (in arrival order), t | 1 |
| 9 | same_rules | empty rejects file | If no rejects of any bucket were produced, the tagged rejects file is **zero bytes** (same as legacy). | 1 |
| 9 | same_rules | empty rejects file | This preserves the "empty file is literally zero bytes" contract from default base behavior even under `--rejects-format | 1 |
| 9 | extends | audit-log-digest | When BOTH `--rejects-format` is `tagged` or `tagged-sorted` AND `--audit-log-digest` is supplied, the audit-log-digest s | 3 |
| 9 | depends_on | audit-log bucket field | `audit_reject_record_count` — the number of audit-log records with `bucket != "accepted"`. | 3 |
| 9 | extends | --summary-schema-out sidecar | The `--summary-schema-out` sidecar gains an OPTIONAL new top-level key: `rejects_format`. | 8 |
| 9 | depends_on | summary-schema digest and index sidecars | Because the summary-schema-digest (`--summary-schema-digest`) and summary-schema-index (`--summary-schema-index`) both d | 8 |
| 9 | same_rules | blank-line handling | Under `--rejects-format legacy`: behavior is unchanged — blank-only lines are SKIPPED, never reach a bucket, and never a | 1 |
| 10 | same_rules | gap-based sessionization | The default `gap` policy preserves the existing inactivity-based rule: start a new session whenever the gap between cons | 1 |
| 10 | depends_on | state.open_sessions and audit-log session_index | It does not change `state.open_sessions[].session_index` or audit-log `session_index`; those fields continue to use the  | 2 |
| 10 | same_rules | gap-based sessionization with carry-over | Under `--session-policy gap` (or when the flag is omitted), the sessionization rule is the existing inactivity-based rul | 2 |
| 10 | same_rules | session event ordering | For each user `u` present in the current run's surviving events, consider `u`'s surviving events sorted by `(ts ascendin | 1 |
| 10 | depends_on | sessions.by_user aggregate | `summary.sessions.by_user[]` entries are byte-identical to the default-policy output (the per-user aggregate is over eve | 1 |
| 10 | depends_on | state.open_sessions session_index | `state.open_sessions[].session_index` retains the existing gap-based numbering. The fixed-window rule does NOT renumber  | 2 |
| 10 | depends_on | audit-log session_index | Audit-log `session_index` (the audit-log feature §Record shape) retains the existing gap-based numbering. | 3 |
| 10 | depends_on | manifest outputs.summary and signature | `--out-parquet-manifest`'s `outputs.summary.sha256` and `.bytes` naturally reflect the new `--output` bytes when `summar | 5 |
| 10 | same_rules | gap session rule | `e_cur.ts_epoch - e_prev.ts_epoch > --session-gap` (default base behavior gap rule), OR | 1 |
| 10 | depends_on | sessions.by_user count | `summary.sessions.by_user[].count` equals the number of surviving events for that user, under every policy (unchanged fr | 1 |
| 11 | depends_on | manifest input_shards | The manifest's `input_shards` array gives only a coarse per-shard summary. | 5 |
| 11 | same_rules | manifest input_shards basename ordering | The default `basename` sort preserves the existing basename-ascending behavior. | 5 |
| 11 | same_rules | atomic .tmp+rename write | It is written via `.tmp` + rename after all other outputs have been finalized. | 2 |
| 11 | same_rules | manifest ingest_id | This mirrors the manifest feature's manifest `ingest_id` semantics exactly. | 5 |
| 11 | same_rules | manifest shard ordering | By default (absent `--sharding-report-sort` or `--sharding-report-sort basename`) the order is **by basename in ASCII-as | 5 |
| 11 | same_rules | manifest input_shards[].bytes | Same as the manifest feature's manifest `input_shards[].bytes`. | 5 |
| 11 | same_rules | manifest input_shards[].sha256 | Same as the manifest feature's manifest `input_shards[].sha256`. | 5 |
| 11 | same_rules | manifest input_shards[].events_total | `events_total`: number of non-blank lines in the shard (same definition as the manifest feature's manifest `input_shards | 5 |
| 11 | same_rules | manifest input_shards[].events_accepted | Same as the manifest feature's manifest `input_shards[].events_accepted`. | 5 |
| 11 | depends_on | --dedup-policy | `events_duplicate`: number of lines from this shard whose final audit-bucket is `duplicate` under the dedup-policy dedup | 6 |
| 11 | same_rules | manifest input_shards[].bytes | `bytes` matches the manifest's `input_shards[].bytes`. | 5 |
| 11 | same_rules | manifest input_shards[].events_accepted | `events_accepted` matches the manifest's `input_shards[].events_accepted`. | 5 |
| 11 | depends_on | --session-policy | Under `--session-policy fixed-window` or `--session-policy hybrid`, the sharding-report's per-shard and total event coun | 10 |
| 11 | depends_on | --dedup-policy lex-largest-ts | Under `--dedup-policy lex-largest-ts` (the dedup-policy feature), a line's winner/loser status under the lex rule determ | 6 |
| 11 | depends_on | --rejects-format tagged | Under `--rejects-format tagged` (the rejects-format feature), the sharding-report is unchanged — it is not a rejects pro | 9 |
| 12 | same_rules | tool_version in existing sidecars | **`tool_version`**: fixed string literal `"eventq/0.5.0"`. Identical to the `tool_version` field emitted by existing dig | 5 |
| 12 | same_rules | manifest input_shards length and sharding-report totals.shards | Same value as `--out-parquet-manifest.input_shards[]` length and `--sharding-report.totals.shards` on the same inputs. | 11 |
| 12 | same_rules | boolean strict flags convention | It takes no value; bare `--run-provenance-strict` records as `true`, `--run-provenance-strict=false` records as `false`  | 11 |
| 12 | same_rules | manifest and sharding-report shard ordering | Let `shards` be the list of conforming shard files under `--input-dir` in **ASCII-ascending basename order** (same order | 5 |
| 12 | depends_on | --sharding-report-sort | `inputs_fingerprint` is independent of `--sharding-report-sort`: even when the sharding-report's `shards[]` is reordered | 11 |
| 12 | depends_on | --sharding-report-sort | Under `--sharding-report-sort bytes` / `sha256`, the `--run-provenance` `inputs_fingerprint` is UNCHANGED — it always us | 11 |
| 12 | depends_on | --session-policy | Under `--session-policy fixed-window` / `hybrid` the provenance file records `flags["session-policy"]` (and `flags["fixe | 10 |
| 12 | depends_on | --dedup-policy | Under `--dedup-policy lex-largest-ts` the provenance file records `flags["dedup-policy"]`, but `inputs_fingerprint` and  | 6 |
| 13 | depends_on | sharding report first_ts/last_ts | `summary.time_range` currently reflects accepted events only, while the sharding report's `first_ts` and `last_ts` field | 11 |
| 13 | same_rules | sharding report first_ts/last_ts corpus | Under `observed`, `time_range.min` and `time_range.max` in `--output` are recomputed over the same timestamp corpus used | 11 |
| 13 | same_rules | sharding report first_ts/last_ts corpus | The corpus is **exactly** the same as the union of every `--sharding-report.shards[i].first_ts` / `shards[i].last_ts` co | 11 |
| 13 | extends | run-provenance flags enumeration order | The fixed enumeration order of §2.3 of the run-provenance feature is extended by appending `summary-time-range-policy` i | 12 |
| 13 | depends_on | run-provenance flags object | Under `strict-observed`, the provenance `flags` object records the argv token `"strict-observed"` under key `summary-tim | 12 |
| 13 | depends_on | --sharding-report | `--summary-time-range-policy observed` does NOT change any `--sharding-report` bytes. | 11 |
| 13 | depends_on | manifest outputs.summary sha256 | `--out-parquet-manifest` and `--manifest-signature` retain their existing schemas, but when `observed` rewrites the two  | 5 |
| 13 | depends_on | --summary-schema-out | `--summary-schema-out` describes the schema shape of `--output`, not its value bytes. | 8 |
| 13 | depends_on | --run-provenance | `--run-provenance` and `--run-provenance-digest` are unchanged only when the explicit `summary-time-range-policy` value  | 12 |
| 13 | depends_on | --session-policy | `--session-policy` affects the `sessions` block in `--output` but not `time_range`; this time-range policy is orthogonal | 10 |

### flowctl-pipeline-wiring

| round | kind | referenced_feature | sentence (first 120 chars) | earlier_round |
|---|---|---|---|---|
| 2 | same_rules | summary processed counter | Records produced by `sqlite` count toward `processed` in the summary line exactly like CSV / NDJSON records do. | 1 |
| 2 | depends_on | input record numbering for diagnostics | The input record numbering (used for `flowctl: filter: drop non-numeric row <n>` and the new `flowctl: group: non-numeri | 1 |
| 2 | same_rules | --strict filter-drop behaviour | But filter-drop behaviour under `--strict` continues exactly as in the existing CSV and NDJSON sources. | 1 |
| 2 | depends_on | summary dropped counters | `D1`, `D2` still count filter-stage drops only. | 1 |
| 2 | depends_on | filter, project, sort, limit stages | `filter`, `project`, `sort`, `limit` continue to work on whatever record stream they see. | 1 |
| 3 | same_format | top-level input block | `right.input` has exactly the same shape as the top-level `input` from the existing source contract: required `path` and | 2 |
| 3 | same_rules | top-level input path resolution | `path` is resolved relative to the pipeline config file's directory — identical resolution rules to the top-level `input | 1 |
| 3 | same_format | top-level input error prefix | **Error prefix for the right source is `flowctl: input:`**, exactly the same prefix as the top-level input. | 2 |
| 3 | same_rules | SQLite input rendering rules | Right-side values are rendered to strings **identically** to the top-level input of the same format (the existing SQLite | 2 |
| 3 | same_rules | top-level NDJSON and CSV input rules | NDJSON and CSV on the right side follow the same rules as on the top-level input. | 1 |
| 3 | same_rules | top-level input rendering | You may not reimplement rendering for the right source — it must produce exactly the same string a top-level input would | 2 |
| 3 | depends_on | summary processed counter | `processed` in the summary still counts **top-level input records** (left side). | 1 |
| 3 | depends_on | summary dropped counters | `dropped_nonnumeric` and `dropped_missing` are still driven only by filter stages. | 1 |
| 3 | depends_on | filter drop row numbering | The per-input row numbering (used for `flowctl: filter: drop non-numeric row <n>`) still refers to the **top-level input | 1 |
| 3 | depends_on | existing stage types | A `join` stage can appear before or after any other stage, including another `join`, `group`, `sort`, `limit`, `filter`, | 2 |
| 4 | depends_on | filter and group numeric parsing | The correction does **not** affect `filter` (which still drops non-numeric rows under numeric operators), nor `group` ag | 2 |
| 4 | depends_on | sort number-key parsing rule | The existing rule for non-parseable (but *present*) numeric values is unchanged: a non-numeric, non-empty value in a `nu | 1 |
| 4 | same_rules | join.on string equality | Comparison of `by` values is plain string equality (no trimming, no case folding, no numeric coercion), just like `join. | 3 |
| 4 | same_format | filter.where clause | `when` is an optional predicate with the same shape as the existing `filter.where` clause (required `column`, `op`, `val | 1 |
| 4 | same_rules | filter numeric operator rules | Numeric operators (`>`, `>=`, `<`, `<=`) on `when` follow the existing `filter` rules verbatim: | 1 |
| 4 | depends_on | summary processed counter | `processed` still counts top-level input records (pre-dedup count). | 1 |
| 4 | depends_on | existing stage types | `dedup` can appear before or after any existing stage (`filter`, `project`, `sort`, `limit`, `group`, `join`, another `d | 3 |
| 4 | depends_on | filter drop row numbering | The existing filter rule still stands for `filter`: if a later `filter` reports `drop non-numeric row <n>`, `<n>` is the | 1 |
| 4 | depends_on | project stage | When `keep: min`/`max` and `on` names a column that a later stage then drops via `project`, the comparison has already h | 1 |
| 5 | same_rules | dedup.by behaviour | Comparison rules follow the existing `dedup.by` behavior (plain string equality; empty-string value does NOT suppress gr | 4 |
| 5 | same_rules | dedup per-row absence convention | "Per-row absence" has the same NDJSON-vs-CSV meaning as in the existing per-row absence convention. | 4 |
| 5 | same_rules | sort.keys behaviour | Perform a **stable** sort using `order_by`: the same total-order semantics as the current `sort.keys` behavior. | 1 |
| 5 | depends_on | summary dropped counters | `dropped_nonnumeric` and `dropped_missing` are **not touched** by `rank`. | 1 |
| 5 | depends_on | existing stage types | `rank` can appear anywhere a stage can appear (before or after `filter`, `project`, `sort`, `limit`, `group`, `join`, `d | 4 |
| 5 | depends_on | project stage | If a later `project` drops the column named by `into`, the rank computation has still happened — projection applies afte | 1 |
| 5 | depends_on | sort stage | If a later `sort` sorts by the `into` column, the sort key is the string value of that column ("10" < "2" as strings unl | 1 |
| 6 | depends_on | group non-numeric aggregate rule | The existing "non-parseable aggregate numeric value" rule is unchanged | 2 |
| 6 | depends_on | group semantics | All other existing `group` semantics (emission order, output row schema, barrier behaviour, row numbering for diagnostic | 2 |
| 6 | same_rules | dedup.by behaviour | Comparison rules for the index tuple follow the current `dedup.by` behavior (plain string equality; empty-string value d | 4 |
| 6 | same_rules | numeric parsing rules | `number`: the value of `values` is parsed per the current numeric parsing rules. | 1 |
| 6 | same_rules | group numeric-rendering rules | `sum`: numeric only — sum of contributing values, rendered per the existing group numeric-rendering rules (integer value | 2 |
| 6 | same_rules | group barrier behaviour | `pivot` is a **full barrier**, same as `group`: it consumes all records before producing any output record. | 2 |
| 6 | depends_on | summary processed counter | `processed` still counts top-level input records (records scanned during step 1 above). | 1 |
| 6 | depends_on | summary dropped counters | `dropped_nonnumeric` and `dropped_missing` are **not touched** by `pivot`. | 1 |
| 6 | depends_on | rank stage into column | A `rank` stage followed by a `pivot` is allowed; the `rank`-written `into` column can be used as `values` (under `as: st | 5 |
| 7 | same_rules | dedup.by behaviour | Comparison rules and per-record-absence handling follow `dedup.by` from the existing `dedup.by` behavior (a record missi | 4 |
| 7 | depends_on | existing YAML parser | The existing YAML parser must accept both forms. | 1 |
| 7 | depends_on | NDJSON key order | the unpivot stage must observe the per-record key order (the existing NDJSON parser preserves key order). | 1 |
| 7 | same_rules | numeric parsing rules | `number`: the value is parsed per the current numeric parsing rules. | 1 |
| 7 | same_rules | numeric-blank convention | An empty-string value (CSV blank cell) is rendered as `""` (no parse attempt; no abort) — same as the existing numeric-b | 6 |
| 7 | same_rules | group/pivot numeric-rendering rules | A successfully parsed numeric value is rendered using the same group/pivot numeric-rendering rules: integer values drop  | 6 |
| 7 | same_rules | input row numbering convention | `<n>` follows the existing input row numbering convention (top-level input record number, starting from 1, header row no | 1 |
| 7 | depends_on | summary processed counter | `processed` still counts top-level input records (one count per input record, regardless of how many long-form rows it p | 1 |
| 7 | depends_on | summary dropped counters | `dropped_nonnumeric` and `dropped_missing` are **not touched** by `unpivot`. | 1 |
| 7 | depends_on | pivot stage | `pivot` followed by `unpivot` reverses the wide-to-long shape. | 6 |
| 7 | depends_on | group stage | `unpivot` followed by `group` lets you aggregate across periods that were originally laid out as columns. | 2 |
| 7 | depends_on | sort as: number | A downstream `sort as: number` re-parses it as a number per the usual rules. | 1 |
| 8 | depends_on | sort number-key hard error | The `sort` hard-error on non-numeric values under `as: number` is also unchanged. | 1 |
| 8 | same_rules | input row numbering convention | Collision with any other pre-existing column on an input record is a **runtime** error at the moment that record is proc | 7 |
| 8 | same_rules | numeric parsing rules | `edges` is a list of at least two strictly-increasing numeric values (integers or floats — same parsing rules as the cur | 1 |
| 8 | same_rules | numeric-rendering rule | where `a` and `b` are the edge values rendered by the existing numeric-rendering rule (integers drop `.0`; otherwise Go  | 2 |
| 8 | depends_on | --strict flag | Under `--strict`, a dropped missing row aborts with `strict: missing column <name>`. | 1 |
| 8 | same_rules | numeric-blank convention in group/unpivot | This matches the existing numeric-blank convention used by `group`/`unpivot`. | 7 |
| 8 | same_rules | numeric parsing rules | Else attempt to parse the value via the current numeric parsing rule (finite float; `NaN`/`Inf` counts as non-parseable) | 1 |
| 8 | depends_on | summary processed counter | `processed` still counts top-level input records. | 1 |
| 8 | depends_on | group stage | A common pattern is `bucket` → `group by: [tier]` to bucket rows by a numeric value and then aggregate per bucket. | 2 |
| 9 | same_rules | dedup.by behaviour | Missing `partition_by` column on a participating record is treated as empty string (same rule as `dedup.by` from the exi | 4 |
| 9 | same_rules | bucket empty-string convention | Empty-string event-time is treated as missing (same convention as `bucket`). | 8 |
| 9 | same_rules | group stage | All other input columns are **dropped** — `window` is an aggregating stage (like existing `group`), not a row-preserving | 2 |
| 9 | same_rules | numeric-rendering rule | a float with fractional seconds is rendered via the existing numeric-rendering rule (Go `%g` with integer-drops-`.0` eli | 2 |
| 9 | same_rules | numeric parsing rules | `sum`: Numeric sum over present, parseable records (per the current numeric parsing rule). | 1 |
| 9 | depends_on | sort as: string null-last rule | The the current `as: string` null-last rule does NOT apply here — `window` compares partition keys as plain strings (emp | 8 |
| 9 | depends_on | join stage | `window` after `join`: both stages are barriers; `window` sees the fully joined stream. | 3 |
| 9 | depends_on | sort as: string null-last rule | `window` before `sort`: the current `as: string` null-last rule applies normally on non-aggregate string keys. | 8 |
| 9 | depends_on | bucket stage | `window` before `bucket`: `bucket` can tag the aggregate columns since they are numeric strings. | 8 |
| 9 | depends_on | summary processed counter | `processed` counts top-level input records (unchanged). | 1 |
| 9 | depends_on | --strict flag | Under `--strict`, abort with `strict: late row <n>`. | 1 |

### flowr-workflow-orchestrator

| round | kind | referenced_feature | sentence (first 120 chars) | earlier_round |
|---|---|---|---|---|
| 2 | depends_on | invocation directory | `inputs` is a list of file globs relative to the directory from which `flowr run` was invoked. | 1 |
| 2 | depends_on | variable interpolation | `cmd` is the final command after variable interpolation; for a pipelined step (see below) it is the JSON array of pipe s | 1 |
| 2 | depends_on | halt/continue and global run status | That failure is classified as a cache-key failure, not an execution failure: the step never launches a shell, but it sti | 1 |
| 2 | extends | per-step status set | The step's status in the report is `"cached"`, a new status in addition to `ok`, `failed`, `skipped`, `cancelled`. | 1 |
| 2 | depends_on | order_attempted | `order_attempted` in the report includes cached steps, placed in the order they were observed (i.e., the point at which  | 1 |
| 2 | extends | events.ndjson record kinds | The events log gains a new record for cache hits: | 1 |
| 2 | depends_on | lexicographic ready-step ordering | From the set of ready pending steps, picks the lexicographically smallest one whose `uses` values are all `<= free`. | 1 |
| 2 | depends_on | --max-parallel | The step can only be launched if `--max-parallel` has a free slot as well. | 1 |
| 2 | same_rules | ${VAR} interpolation rules for cmd | Each element is subject to the same `${VAR}` interpolation rules as `cmd`, individually. | 1 |
| 2 | same_rules | interpolation failure handling for cmd | Interpolation failures in any stage are reported before the step starts, exactly as they would be for a `cmd`. | 1 |
| 2 | same_rules | flowr run defaults | executes with the same default `--max-parallel` and resource pool as a fresh `flowr run` invocation would. | 1 |
| 2 | same_rules | flowr run flag parsing | Additional flags may be passed after the run id, following the same parsing rules as `flowr run`. | 1 |
| 3 | depends_on | retries: N | Round 1's `retries: N` is preserved exactly. | 1 |
| 3 | same_rules | scalar retries | It plays the same role as the scalar `retries:` used to: it is the number of additional attempts after the first try. | 1 |
| 3 | same_rules | R1 retry delay | For steps that still use the scalar `retries:` form, the effective delay is `fixed` with `initial_ms = 100` — exactly ma | 1 |
| 3 | same_rules | step_started / step_finished pairing | Each retried attempt still appears in `events.ndjson` as a matching `step_started` / `step_finished` pair (R1 contract). | 1 |
| 3 | depends_on | on_failure halt/continue | Its dependents still run — a conditional skip is not a failure and does not trigger `on_failure: halt` nor `on_failure:  | 1 |
| 3 | depends_on | cache misses | A conditional skip is not treated as a cache miss; caching is bypassed entirely for a conditionally-skipped step. | 2 |
| 3 | depends_on | ${VAR} interpolation | `when` is a string expression evaluated after `${VAR}` interpolation but before the step launches. | 1 |
| 3 | depends_on | order_attempted | `order_attempted` does *not* include conditionally-skipped steps — they were never started. | 1 |
| 3 | depends_on | cache_hits and cache_misses | `cache_hits`/`cache_misses` do not include them either. | 2 |
| 3 | same_rules | interpolation resolution tiers | The `when` string is also subject to `${VAR}` interpolation exactly like `cmd`, with the same resolution priority tiers: | 1 |
| 3 | depends_on | ${VAR} interpolation | Hook commands are subject to `${VAR}` interpolation at parse time with only the workflow `env:`, parent process env, and | 1 |
| 3 | same_rules | bash -lc shell invocation | Each hook is executed through `bash -lc "<cmd>"` exactly once per run. | 1 |
| 3 | depends_on | workflow snapshot and run_started event | `on_start` runs after the run directory and snapshot have been created, after `run_started` has been written to `events. | 2 |
| 3 | same_format | cancelled zero/null shape | Every step in the graph is marked `cancelled` (zero/null shape). | 1 |
| 3 | same_rules | FLOWR_MATRIX_* builtins | These behave exactly like `FLOWR_MATRIX_*` for interpolation into `cmd`, `pipe`, step `env:`, and `when:`. | 1 |
| 3 | same_rules | matrix cell scheduling semantics | After expansion, all normal scheduling semantics apply: cells run in lexicographic order subject to `--max-parallel` and | 1 |
| 3 | extends | --only-step and --skip-step | `--only-step` and `--skip-step` accept both the base name (shorthand for all resolved cells, resolved at run time when t | 1 |
| 3 | depends_on | outputs: caching | This is a post-hoc mechanism layered on top of the existing file `outputs:` caching. | 2 |
| 3 | depends_on | ${VAR} interpolation pass | During the first interpolation pass (the existing one used for plain `${VAR}` substitution), `step.` references are **de | 1 |
| 3 | depends_on | cache key | Cache keys include every `${step.NAME.output.KEY}` reference's **resolved string** — the same value the process sees — s | 2 |
| 3 | same_rules | flowr replay | The orchestrator parses and runs the snapshot from the prior run exactly as `flowr replay` does — the prior snapshot is  | 2 |
| 3 | same_rules | flowr run flags | All `--max-parallel`, `--only-step`, `--skip-step`, `--no-cache`, and `--slots` flags are accepted alongside `--resume`  | 1 |
| 3 | depends_on | dependent readiness | Treated the same as `ok` / `cached` / `conditionally_skipped` when evaluating dependent readiness: a dependent whose `ne | 1 |
| 3 | depends_on | order_attempted | Not included in `order_attempted` (the step was not started this run). | 1 |
| 3 | depends_on | cache lookup | Cache lookup continues to work for re-run steps; a step that was `failed` in the prior run may legitimately become `cach | 2 |
| 3 | extends | --only-step and --skip-step cell names | Every name that appears in the *expanded* graph — whether it is the original non-matrix step name, the base name of a ma | 1 |
| 3 | same_rules | retries: 0 | A step with `retry: {count: 0}` is legal; it means one attempt with no retry. It is equivalent to `retries: 0`. | 1 |
| 3 | depends_on | FLOWR_MATRIX_* builtins | `when` evaluated on a matrix-expanded step uses *that cell's* `FLOWR_MATRIX_*` builtins, so `when: "${FLOWR_MATRIX_os} = | 1 |
| 3 | same_format | timestamp format | Hooks obey the same timestamp format (RFC-3339 UTC, three fractional digits) for their event records. | 1 |
| 4 | depends_on | four-tier ${NAME} resolution chain | The four-tier `${NAME}` resolution chain from R1 does not fall through to secrets. | 1 |
| 4 | depends_on | first interpolation pass | `${secret.NAME}` tokens are part of the first interpolation pass (alongside `${VAR}`). | 3 |
| 4 | depends_on | cache key | Cache-key computation uses the *redacted* form of secret values so that cache keys do not depend on the current runtime  | 2 |
| 4 | depends_on | inherited steps (--resume) | Redaction applies equally to freshly-executed steps and to the `inherited` steps carried forward by `--resume` (F17): | 3 |
| 4 | depends_on | invocation directory | It is interpreted relative to the directory `flowr run` was invoked from. | 1 |
| 4 | depends_on | missing_output and missing_step_output errors | The F19 downgrade takes priority over every other error condition except `missing_output` from R2 and `missing_step_outp | 2 |
| 4 | depends_on | step_finished and step_started events | The event is emitted after `step_finished` for that step and before any subsequent step's `step_started`. | 1 |
| 4 | depends_on | --resume inherited steps | On a `--resume` run the counters reflect only live-run collections in this resumed run — inherited steps contribute `0`  | 3 |
| 4 | same_rules | validation and exit codes | The orchestrator parses and validates the workflow exactly as if `--dry-run` were absent (all validation and structural  | 1 |
| 4 | same_format | inspect.steps ordering | `steps` is in the same order as `inspect.steps`: base step positions, cells in lex order within each base. | 1 |
| 4 | same_format | inspect.order layers | `layers` is the Kahn-style layered execution order over the expanded graph, exactly as `inspect.order` would report it. | 1 |
| 4 | same_rules | when expression validation | An invalid `when` (after interpolation) still raises the same validation error as normal runs and aborts `--dry-run` wit | 3 |
| 4 | same_rules | exit codes | Cycles still exit `2`; unknown `--only-step`/`--skip-step` still exit `3`; every other validation error still exits `4`. | 1 |
| 4 | same_rules | --only-step/--skip-step closure | `--dry-run` combined with `--only-step`/`--skip-step` narrows the `steps` list in the plan to the surviving expanded ste | 1 |
| 4 | depends_on | cache hit | `cache_hit_projected` is `true` iff a current cache entry for this key exists AND every declared output's sha256 matches | 2 |
| 5 | depends_on | retry policies | `timeout_ms` and `retry` compose: the deadline applies to **each attempt independently**, starting at that attempt's spa | 3 |
| 5 | depends_on | pipe: steps | When applied to a `pipe:` step, the deadline spans the entire pipeline (from spawn of the first stage to exit of the las | 2 |
| 5 | depends_on | when: conditions | `timeout_ms` interacts with `when:` exactly like `cmd` does: a conditionally-skipped step never spawns, so its deadline  | 3 |
| 5 | same_rules | R1 graceful cancellation | When the wall-clock duration of a running attempt reaches `timeout_ms` (while the step process, or its pipeline, is stil | 1 |
| 5 | same_rules | retry on timeout | Retries consume attempts normally: a timeout counts as a failure of that attempt. | 1 |
| 5 | depends_on | secret redaction | Timeouts are subject to secret redaction like any other sink: nothing new is exempt. | 4 |
| 5 | depends_on | --resume inherited steps | On a `--resume` run, `timeouts_summary` counts only live-run timeouts — `inherited` steps contribute nothing. | 3 |
| 5 | depends_on | --dry-run and --resume | The flag composes with `--dry-run` (F20) and `--resume` (F17). | 4 |
| 5 | extends | four-tier ${VAR} resolution | Params slot into the existing four-tier `${VAR}` resolution. | 1 |
| 5 | depends_on | cache key | They are, however, included in every applicable cache key exactly like any other resolved `${VAR}` | 2 |
| 5 | extends | --dry-run plan.json | In `--dry-run`, `plan.json` gains a top-level `"params": {...}` field with identical contents. | 4 |
| 5 | same_rules | flowr run flags | `--only-step`, `--skip-step`, and `--param` accept the same forms as `flowr run` and apply the same validation and closu | 1 |
| 5 | same_format | matrix cell naming | Matrix steps are fully expanded: one node per cell with the same naming convention used in `report.steps` (`base[axis=va | 1 |
| 5 | same_rules | exit codes | `2` on a graph cycle (same as `flowr run`). | 1 |
| 5 | depends_on | F19 artifacts | C2 does not change the rest of F19: `required`, `name`, presence, `size`, `sha256`, the `artifacts_summary` counters, an | 4 |
| 5 | same_rules | artifact destination path | The destination of the copied artifact bytes is `.flowr/runs/<id>/artifacts/<step_name>/<artifact_name>` exactly as befo | 4 |
| 6 | depends_on | matrix and foreach expansion | `lock:`/`locks:` compose unchanged with matrix and `foreach:` expansion: every expanded cell independently participates  | 3 |
| 6 | depends_on | F16 second-pass interpolation | When the scheduler is about to launch a step attempt (after its `needs:` are terminal and after the F16 second-pass inte | 3 |
| 6 | depends_on | --max-parallel and resource reservations | If the request set is empty the step launches immediately (subject only to `--max-parallel` and resource reservations). | 2 |
| 6 | depends_on | scheduler ordering and resource reservations | The scheduler picks the next step that *is* launchable under current holdings (still respecting `--max-parallel`, resour | 2 |
| 6 | depends_on | pipelines, timeouts and cancellation | Locks are released the instant the step process exits (or the pipeline's last stage exits, or the attempt is reaped by F | 5 |
| 6 | depends_on | retry attempts and backoff | Each *retry* attempt re-acquires locks from scratch: the attempt's locks are released between the attempt's `step_finish | 3 |
| 6 | depends_on | conditionally_skipped, inherited, cached, skipped statuses | A `conditionally_skipped` step never attempts acquisition; neither do `inherited` (F17), `cached`, or `skipped` steps. | 3 |
| 6 | depends_on | foreach cells | A `foreach:` cell acquires locks per-cell. | 3 |
| 6 | extends | error-precedence chain | The error-precedence chain now reads: | 5 |
| 6 | depends_on | on_failure hook | Every currently-running step is left to finish normally. The `on_failure` hook runs as usual after the live set drains. | 3 |
| 6 | depends_on | --resume inherited steps | On a `--resume` run, the counters reflect live-run activity only; `inherited` steps contribute `0`. | 3 |
| 6 | extends | --dry-run plan.json | In `--dry-run` (F20), each `plan.steps[*]` entry gains `locks_requested`, with the same shape as the report field. | 4 |
| 6 | depends_on | flowr graph needs: edges | When two steps already have a direct `needs:` edge in either direction, no additional dotted edge is drawn for the same  | 5 |
| 6 | same_rules | flowr graph edge ordering | Implicit edges are emitted after the `needs:`-derived edges, sorted lexicographically by `(from, to)`. | 5 |
| 6 | depends_on | run directory artifacts | Each id must correspond to an existing directory `.flowr/runs/<id>/` that contains both `report.json` and `workflow.yaml | 2 |
| 6 | same_rules | --only-step/--skip-step validation | `--only-step` / `--skip-step` use the same validation rules as `flowr run`: an unknown expanded/base-name value → exit 3 | 1 |
| 6 | depends_on | per-step artifacts list | `artifacts.common` is keyed by the composite string `"<step>::<artifact_name>"` covering every artifact entry that exist | 4 |
| 6 | depends_on | secrets.declared in report | `secrets.declared` reports each run's sorted declared set; no value comparison happens (values are not persisted in repo | 4 |
| 6 | depends_on | older report top-level fields | When the corresponding R-feature's top-level field is absent from an older report (a report produced by a workflow that  | 3 |
| 6 | same_rules | flowr run validation errors | Every validation error that `flowr run` would raise at exit `2`/`3`/`4` is *also* raised by `flowr lint` with the same e | 1 |
| 6 | same_rules | --param validation | `--param KEY=VAL` is accepted with the same validation rules as `flowr run` / `flowr graph`. | 5 |
| 6 | depends_on | scalar retries and structured retry | A step declares `retries: N` (scalar form from R1) with `N >= 1`. Suggests migrating to structured `retry:` (F12). | 3 |
| 6 | same_rules | flowr run validator | A workflow that fails `flowr lint` with an exit-4 validation error is guaranteed to fail `flowr run` with the same exit  | 1 |
| 7 | same_rules | R1 default run-id shape | All other R1 rules on `--run-id` are preserved: the implementation-generated default id still has the shape `run-YYYYmmd | 1 |
| 7 | depends_on | FLOWR_RUN_ID builtin | `FLOWR_RUN_ID` (the builtin variable injected into every step's environment — R1) echoes the final run id verbatim. | 1 |
| 7 | same_rules | --resume requires distinct --run-id | A resumed run (F17) requires `--run-id <new>` to differ from the prior run id (R3 rule preserved). | 3 |
| 7 | depends_on | cache key | **Cache**: unchanged. Cache keys never incorporated `--run-id` and still do not. | 2 |
| 7 | depends_on | flowr diff distinct run ids | `flowr diff requires two distinct run ids` still fires only on exact byte-equality. | 6 |
| 7 | depends_on | --only-step and --skip-step | `--tag` composes with `--only-step` and `--skip-step`: the three filters are applied in the order **`--tag` closure firs | 1 |
| 7 | same_rules | unknown --only-step/--skip-step names | Exit `3` is deliberate: it parallels the R1 treatment of unknown `--only-step`/`--skip-step` names. | 1 |
| 7 | same_rules | --dry-run narrowing | `--tag` composes with `--dry-run` (F20): the plan's `plan.steps[*]` list is narrowed to the tag-closure-surviving set in | 4 |
| 7 | depends_on | --resume and inherited steps | `--tag` composes with `--resume` (F17): tag filtering applies to the new run's executable closure; `inherited` steps tha | 3 |
| 7 | same_rules | --only-step closure | This is the same closure semantics `--only-step` uses in R1. | 1 |
| 7 | depends_on | when: and conditionally_skipped | Tag filtering does NOT interact with `when:`: a step whose `when:` evaluates to false is `conditionally_skipped` (F13) * | 3 |
| 7 | depends_on | on_failure: halt | Tag filtering is *orthogonal* to `on_failure: halt`: a `filter_skipped` step does not cause halting. | 1 |
| 7 | same_rules | --only-step/--skip-step skip treatment | A step excluded purely by `--only-step` or `--skip-step` (with no `--tag` involvement) retains its existing R1 treatment | 1 |
| 7 | depends_on | order_attempted | `order_attempted` does NOT include `filter_skipped` steps. | 1 |
| 7 | depends_on | cache_hits and cache_misses | `cache_hits`/`cache_misses` do NOT include them. | 2 |
| 7 | depends_on | inherited steps | It is NOT emitted for inherited steps (those carry their prior `inherited` status). | 3 |
| 7 | depends_on | flowr diff neutral values | Older reports (R1–R6) that did not carry these fields are treated by `flowr diff` (F25) with neutral values: | 6 |
| 7 | depends_on | --dry-run with --resume | `--dry-run --resume` is still exit `4` (F20 unchanged); adding `--tag` on top does not salvage it. | 4 |
| 7 | same_rules | --only-step dry-run narrowing | This mirrors the `--only-step` narrowing rule from F20. | 4 |
| 7 | same_rules | flowr graph empty-graph rule | Empty `--tag` closure (every step is outside the closure) renders an empty graph body per F23's empty-graph rule: only t | 5 |
| 7 | depends_on | dotted lock-conflict edges | `--tag` and the F24 dotted-lock-edge rule compose: dotted conflict edges are drawn only between pairs of steps that *bot | 6 |
| 7 | depends_on | named locks and locks_summary | A `filter_skipped` step does not acquire any lock. It contributes `0` to `locks_summary.acquisitions` and `locks_summary | 6 |
| 7 | extends | flowr diff | `flowr diff` now compares the new `tags_filter` and `tags_summary` fields. | 6 |
| 7 | same_rules | flowr lint ordering and output shapes | Both rules adopt the existing F26 severity, deterministic ordering (by rule id, then by step name within a rule, with `s | 6 |
| 7 | depends_on | on_start hook | Time spent inside `on_start` counts toward the budget. | 3 |
| 7 | same_rules | R1 halting protocol | If true, the scheduler stops launching new steps and initiates the existing R1 halting protocol: SIGTERM to every runnin | 1 |
| 7 | same_rules | R1 halting failure | Every *running* step is allowed to be reaped by the graceful-cancellation protocol; each reaped step's `step_finished.st | 1 |
| 7 | same_format | R1 cancelled shape | Every *pending* step (a step in the tag closure that has not yet started, i.e. not `filter_skipped`, not `inherited`) be | 1 |
| 7 | depends_on | on_failure hook | `on_failure` fires (if declared) once the live set drains — `budget_exceeded` is a global `status: "failed"`. | 3 |
| 7 | depends_on | retry attempts and step statuses | Filter-skipped, conditionally-skipped, cached, inherited, and `--only-step`-excluded steps never touch the counter (they | 3 |
| 7 | extends | error-precedence chain | Its position in the precedence chain **extends** the R6 chain at the low-priority end: | 6 |
| 7 | same_rules | R1 cancellation | A pending step that was cancelled because the wall-clock budget fired records `status: "cancelled"` with no `error` fiel | 1 |
| 7 | depends_on | total_duration_ms | It is the same integer as the existing `total_duration_ms` top-level field | 1 |
| 7 | depends_on | retry_attempts | Matches the length of `retry_attempts` (F12), and so is equal to `len(retry_attempts)`. | 3 |
| 7 | depends_on | flowr diff neutral values | Older reports without `budget_summary` are treated with neutral values: | 6 |
| 7 | depends_on | flowr replay snapshot | `flowr replay <run_id>`: budgets are re-applied on the replay run (the snapshot carries the `budget:` block). | 2 |
| 7 | depends_on | lock acquisition blocking | A step that was blocked on lock acquisition when the wall-clock budget fires is `cancelled` (pending) — not `failed`. | 6 |
| 7 | depends_on | lock_deadlock error | Precedence chain for the *error* field on a specific step remains `lock_deadlock > budget_exceeded > <none>`. | 6 |

### forgekit-monorepo-build-pipeline

| round | kind | referenced_feature | sentence (first 120 chars) | earlier_round |
|---|---|---|---|---|
| 2 | depends_on | FORGE_CFLAGS dependency include paths | The build system must pass profile-specific flags through the `FORGE_CFLAGS` environment variable (in addition to existi | 1 |
| 2 | extends | forge build --package | `forge build --package NAME -j N` still builds in dependency order but should also use parallelism for the dependency ch | 1 |
| 4 | depends_on | cache invalidation (sources, Makefile, manifest) | Identifies every package whose source files, Makefile, or manifest have changed since its last successful build (i.e., c | 3 |
| 4 | depends_on | -j and --profile flags | Add `forge build --changed` (works with `-j N` and `--profile`). | 2 |
| 4 | depends_on | -j and --profile flags | `--changed` must compose with `--profile` and `-j`: | 2 |
| 5 | depends_on | build profiles | `forge cache status` respects `--profile` (default: release). | 2 |
| 5 | same_format | forge build cached message | When `forge build` skips an unchanged package it must still print the established line `[<pkg>:<profile>] Up to date (ca | 3 |
| 6 | depends_on | forge clean --all | `forge clean --all` does NOT clear the journal (it's an audit trail). | 2 |
| 6 | depends_on | parallel builds | Parallel builds must not corrupt the journal -- use file locking (`flock`) when appending events. | 2 |
| 6 | extends | forge report | Update `forge report` to include a "Last Build" column showing the duration of the most recent build for each package (r | 1 |
| 8 | depends_on | standard build environment variables | The script is executed in the package directory with the standard build environment variables set (`FORGE_ROOT`, `FORGE_ | 2 |
| 8 | depends_on | build/test environment | Hooks run with the same environment as the build/test step. | 2 |
| 8 | same_format | labeled per-package output headers | Output is labeled per-package: `=== [libbase:lint] ===` followed by the script's stdout/stderr. | 2 |
| 8 | depends_on | build event journal | Target and hook executions should be recorded in the journal with event types: | 6 |

### gomlops-platform-modernization

| round | kind | referenced_feature | sentence (first 120 chars) | earlier_round |
|---|---|---|---|---|
| 2 | same_format | pipeline execution endpoint structure | Request body: `{"name": "...", "description": "...", "pipeline": {...}}` where the `pipeline` object has the same struct | 1 |
| 2 | same_format | pipeline engine and execution result format | Uses the standard pipeline engine and returns the same result format as the direct pipeline execution endpoint. | 1 |
| 2 | same_format | inference response fields | Successful results include `model_name`, `version` (integer version number), `predictions`, and `latency_ms`. | 1 |
| 2 | same_rules | aggregation count field | These are the runs that contained the specified metric (consistent with the existing `count` field). | 1 |
| 2 | same_format | aggregate step operations | This operation uses the same step interface as existing aggregation operations (`sum`, `mean`, `count`, `min`, `max`), a | 1 |
| 2 | extends | experiment metric aggregation | Extend the existing experiment metric aggregation endpoint to support filtering runs by their tags before computing the  | 1 |
| 2 | depends_on | transform and filter step types | Output transforms only apply to steps that produce a `data` array in their output (i.e., `transform` and `filter` step t | 1 |
| 2 | depends_on | experiment aggregation (value, count, run_ids) | After deletion, subsequent aggregation queries must reflect the reduced set of runs: `value`, `count`, and `run_ids` all | 1 |
| 3 | same_rules | skipping runs lacking the metric | Runs that lack the weight metric are skipped (consistent with how runs lacking the target metric are already skipped). | 1 |
| 3 | extends | template execute endpoint result | When a pipeline is executed through a template (`POST /api/v1/pipelines/templates/{name}/execute`), the response now inc | 2 |
| 3 | extends | GET model details | The `GET /api/v1/models/{name}` response now includes a `"stage_summary"` field that counts how many versions are in eac | 1 |
| 3 | depends_on | pipeline variable context / set_vars | If the referenced variable exists in the pipeline variable context (set by a prior step's `set_vars`) and the condition  | 2 |
| 3 | depends_on | set_vars and output_transform | `set_vars` and `output_transform` are NOT applied on skipped steps. | 2 |
| 3 | same_rules | dependency output merge | Downstream steps that depend on a skipped step receive its output through the normal dependency merge mechanism. | 1 |
| 3 | depends_on | experiment aggregation | After updating, subsequent aggregation queries reflect the updated metric values. | 1 |
| 4 | extends | version object | Annotations must be included in the version object returned by the get-version endpoint, under an `"annotations"` field  | 1 |
| 4 | same_format | pipeline execute endpoint | Request body has the same format as the execute endpoint: `{"pipeline": {...}, "input": {...}}`. | 1 |
| 4 | same_rules | cycle detection | Dependency cycles (same cycle detection as the execute endpoint). | 1 |
| 4 | depends_on | batch inference and stop_on_error skipped results | Batch inference (`POST /api/v1/serving/batch`): each request in the batch counts individually toward its respective mode | 2 |
| 4 | depends_on | single inference | Single inference (`POST /api/v1/serving/infer`): counts as one request toward the inferred model. | 1 |
| 4 | depends_on | per-request latency_ms | Latency for statistics is taken from the per-request `latency_ms` value. | 1 |
| 5 | depends_on | auto-demotion on production promotion | **Auto-demotion lineage**: When promoting version N to production causes version M to be automatically demoted from prod | 3 |
| 5 | depends_on | step skip condition | The retry mechanism applies after skip condition checks (if a step is skipped, no retry is needed). | 3 |
| 6 | same_rules | initial development stage | Restores the version's stage to `"development"` (the stage at creation time). | 1 |
| 6 | depends_on | annotations and lineage | Preserves annotations but removes all lineage records for that version (sets lineage to empty array). | 5 |
| 6 | depends_on | model loading by stage | `status` is `"healthy"` when the loaded version's stage in the registry matches the stage that was recorded when the mod | 1 |
| 6 | depends_on | pipeline execute endpoint | Normal `POST /api/v1/pipelines/execute` requests do not automatically add entries to the history. | 1 |
| 7 | depends_on | loaded model serving | Add an endpoint to reload a currently-loaded model from the registry, picking up any version/stage changes: | 1 |
| 7 | depends_on | pipeline validation checks (empty name, cycle) | The check runs alongside other dependency checks (after the empty name check but before the cycle check). | 5 |

### hermetic-build-artifact-verifier

| round | kind | referenced_feature | sentence (first 120 chars) | earlier_round |
|---|---|---|---|---|
| 2 | same_rules | build command | Build all targets (using cache if available, same behavior as `build`), then output a lockfile JSON to stdout. | 1 |
| 2 | same_rules | input fingerprint computation | `fingerprint`: the input fingerprint (same as computed during build). | 1 |
| 2 | same_format | build progress messages | The `lock` command prints the same stderr progress messages as `build` (`[cache hit]`, `[building]`, `[stored]`). | 1 |
| 2 | same_rules | build failure handling | On build failure, behavior is the same as `build`: print `[failed] <name>: <detail>` and exit 1. | 1 |
| 2 | same_rules | manifest error handling | All other manifest-related errors (invalid JSON, missing file, duplicate names, cycles, etc.) behave identically to exis | 1 |
| 3 | depends_on | lock-diff command | The `lock-diff` command compares lockfiles as-is and is unaffected by this change (it already compares stored fingerprin | 2 |
| 3 | depends_on | check change_reasons | If the lockfile was created with a different profile (or no profile), mismatches are expected and reported normally thro | 2 |
| 3 | depends_on | check change_reasons | The `check` command does not add any new `change_reasons` values for profile differences. | 2 |
| 4 | same_rules | build command | Build all targets normally (using cache if available, same as `build`). | 1 |
| 4 | same_format | build progress messages | The first pass prints `[building]`/`[cache hit]`/`[stored]` as usual. | 1 |
| 4 | same_rules | --profile flag | The `--profile` flag is accepted (same behavior as `build` — applies the profile to both build passes). | 3 |
| 4 | same_rules | build failure handling | On build failure in either pass, behavior is the same as `build`: print `[failed]` and exit 1. | 1 |
| 4 | same_rules | --profile flag | The `--profile` flag is accepted (same behavior as `build`). | 3 |
| 5 | same_rules | input fingerprint computation | `fingerprint`: the current input fingerprint (computed same as for `build`). | 1 |
| 5 | depends_on | check impacted_by | The `impacted_by` field still reflects transitive dependencies within the build set. | 2 |
| 5 | depends_on | --profile flag | The `--targets` and `--profile` flags can be combined. | 3 |
| 5 | depends_on | --profile flag | The `status` command accepts `--profile` (computes fingerprints with profile applied). | 3 |
| 5 | depends_on | profile application | Constraint checks happen after profile application but before building. | 3 |
| 6 | depends_on | cache hits | Hooks run only when a target is actually compiled (not on cache hits). | 1 |
| 6 | extends | lockfile entry | Hooks in lockfile: The lockfile entry for each target gains two new fields: | 2 |
| 6 | extends | check change_reasons | The `check` command's `change_reasons` gains a new possible value: | 2 |
| 6 | extends | lock-diff command | The `lock-diff` command also recognizes `hooks_changed` when comparing entries between two lockfiles. | 2 |
| 6 | same_format | audit chain hash | `chain_hash`: same chain hash as computed by `audit`. | 4 |
| 6 | same_rules | --profile and --targets flags | The `export` command accepts `--profile` and `--targets` (same semantics as `build`). | 5 |
| 6 | same_rules | build failure handling | On build failure, behavior is the same as `build`. | 1 |
| 7 | same_rules | --profile and --targets flags | The `plan` command accepts `--profile` and `--targets` (same semantics as `build`). | 5 |

### jobforge-dag-runner

| round | kind | referenced_feature | sentence (first 120 chars) | earlier_round |
|---|---|---|---|---|
| 2 | same_rules | plan/run validation pipeline | Runs the exact same validation pipeline as `plan` and `run` but prints nothing on success. | 1 |
| 2 | same_rules | validation contract and precedence table | The code, message format, and precedence are identical to the existing validation contract. | 1 |
| 2 | same_rules | plan error contract and plan/run walk order | Validates the spec (same error contract as `plan`: exit `2`, stderr-only error, empty stdout on failure) and then lists  | 1 |
| 2 | same_rules | plan level numbering | This is the same level that `plan` would assign to this job. | 1 |
| 2 | depends_on | workdir default /app | `<workdir>` is the resolved workdir (with the existing default `/app` applied if the spec omitted it). | 1 |
| 2 | depends_on | JOBFORGE_JOB_NAME and JOBFORGE_JOB_WORKDIR | The two built-in env vars `JOBFORGE_JOB_NAME` and `JOBFORGE_JOB_WORKDIR` are **not** included (they are synthesized at r | 1 |
| 2 | same_format | results file JSON escaping | String escaping inside the JSON follows the same rules as the results file (minimum RFC-8259 escapes: `"`, `\`, C0 contr | 1 |
| 2 | same_format | unknown_dep error code | If any name in `--only` is not a declared job, `list` exits `2` with `error: unknown_dep: unknown dep in --only: <name>\ | 1 |
| 2 | depends_on | validation error contract | The `--only` filter is applied **after** validation, so an invalid spec still produces the normal validation error — nev | 1 |
| 2 | same_rules | plan/run validation path | Both new subcommands must use the **same** validation function/path as `plan` and `run`, so that any valid/invalid spec  | 1 |
| 3 | same_rules | plan/list error contract | Validates the spec (same error contract as `plan`/`list`: exit `2`, stderr-only error, empty stdout on failure) and emit | 2 |
| 3 | same_rules | list walk order | In both formats, **nodes** are emitted in the same deterministic walk order as `list`: level-major, then byte-wise lexic | 2 |
| 3 | same_rules | list deps column order | **Edges** for a given node are emitted in the job's spec-declared `deps` order (same as `list`'s `deps` column), grouped | 2 |
| 3 | same_rules | list --only filter | `graph` also accepts an optional `--only <names>` flag with the same semantics as `list --only`: comma-separated names,  | 2 |
| 3 | same_rules | validation contract | Codes and messages are identical to the existing validation contract. | 1 |
| 3 | same_rules | shared validation path | `graph` must use the **same** validation path as `plan`, `run`, `validate`, and `list`. | 2 |
| 4 | same_rules | plan/list error contract | Validates the spec (same error contract as `plan`/`list`: exit `2`, stderr-only error, empty stdout on failure) and then | 2 |
| 4 | same_rules | list walk order | For each job, in the same deterministic walk order used by `list` (level-major, then byte-wise within level), emit a lin | 2 |
| 4 | same_rules | list deps column order | `<deps>` entries preserve spec-declared order (as in `list`'s `deps` column). | 2 |
| 4 | same_rules | list text env rendering | Keys and values are written verbatim (same "no escaping" rule as `list` text). | 2 |
| 4 | same_rules | shared validation path | `hash` must use the same validation path as `plan`/`run`/`validate`/ `list`/`graph`. | 2 |
| 5 | same_rules | shared validation path and error codes | Validates both specs with the existing validation path (same error codes as `plan`/`list`/`hash`). | 2 |
| 5 | uses_output_of | hash canonical form | Two specs are equivalent iff their `hash` canonical forms (the SHA-256 input string, before hashing) are byte-identical. | 4 |
| 5 | same_rules | list/hash walk order | Walk order for both specs is the same level-major-then-byte-wise order used by `list`/`hash`. | 2 |
| 6 | same_rules | plan/list/hash/diff error contract | Validates the spec (same error contract as `plan`/`list`/`hash`/ `diff`). | 2 |
| 6 | same_rules | list level numbering | The schedule is computed level-by-level in Kahn level order (the same level numbering used by `list`). | 2 |
| 6 | same_rules | shared validation path | `schedule` uses the same validation path as the other subcommands. | 2 |
| 7 | same_rules | existing error contract | Validates the spec (same error contract as existing subcommands). | 2 |
| 7 | same_rules | shared validation path | `critical` uses the same validation path as the other subcommands. | 2 |
| 8 | same_rules | existing error contract | Validates the spec (same error contract). | 2 |
| 8 | same_rules | list walk order | Emit ancestors in level-major byte-wise order (same walk order as `list`), one per line, each `\n`-terminated. | 2 |
| 9 | same_rules | existing error contract | Validates the spec (same error contract as the other subcommands). | 2 |
| 9 | depends_on | ancestors subcommand | Equivalently, `D(j)` is the set of jobs whose transitive ancestors include `j`. | 8 |
| 9 | same_rules | list and ancestors walk order | Emit descendants in level-major byte-wise order (same walk order as `list` and `ancestors`), one per line, each `\n`-ter | 8 |
| 9 | depends_on | plan text format | `plan --format text` still uses the `L<N> [...]` format. | 8 |

### lsm-kvstore-engine

| round | kind | referenced_feature | sentence (first 120 chars) | earlier_round |
|---|---|---|---|---|
| 2 | same_rules | deleted-key behaviour and MVCC snapshot visibility | Expired keys behave exactly like deleted keys: `GET` returns `NOT_FOUND`, `SCAN` excludes them, and compaction can GC th | 1 |
| 2 | extends | TX_PUT and BATCH PUT | `TX_PUT` and `BATCH PUT` also accept `--ttl <seconds>`. | 1 |
| 4 | extends | GET, SCAN, snapshot and transaction reads | This folding happens in GET, SCAN, snapshot reads, transaction reads, and anywhere else values are returned. | 1 |
| 5 | depends_on | per-block CRC-32 checksum | The per-block CRC-32 checksum covers the compressed block bytes as written. | 3 |
| 6 | same_rules | TTL expiry, tombstones, MERGE folding (R4) | Cursors see a consistent snapshot view — expired, deleted, and range-tombstoned keys are invisible. Merged keys (from R4 | 4 |
| 6 | depends_on | snapshot IDs | Cursor IDs and snapshot IDs use separate ID spaces. | 1 |
| 7 | same_rules | WAL CRC replay rules | On startup, replay all segment files in numerical order, applying the same CRC rules per segment — a corrupted entry sto | 1 |
| 8 | depends_on | snapshot/transaction/cursor error messages | All open snapshots, transactions, and cursors are invalidated by RESTORE (operations on them return their respective err | 1 |

### minicc-compiler-evolution

| round | kind | referenced_feature | sentence (first 120 chars) | earlier_round |
|---|---|---|---|---|
| 2 | same_rules | out-of-bounds array read | If `i` is out of bounds, it is a runtime error (same as out-of-bounds read). | null |
| 3 | same_rules | for..in loop | `for..of` has the same scoping, `break`, and `continue` behavior as `for..in` — the loop variable is local to the body a | 1 |
| 4 | extends | for..in loop (indices) | `for..in` on a hash map iterates over its keys (strings), consistent with the semantic that `for..in` returns indices/ke | 3 |
| 4 | same_rules | array reference semantics | Hash maps, like arrays, are reference types. | 2 |
| 5 | depends_on | arrays and hashmaps as reference types | Since arrays and hashmaps are already reference types (shared storage), capture-by-reference doesn't change their behavi | 4 |
| 6 | depends_on | hash-map dot access | Hash-map dot access must continue to work exactly as before. | 4 |
| 6 | extends | dot access on hash maps | Extend it so that when the left-hand side is a string, a set of built-in string methods are available. | 4 |
| 8 | depends_on | push, len, for..of | Spread and rest work with all array operations (push, len, for..of iteration). | 2 |
| 8 | depends_on | closures and compound assignment | Destructured variables are regular locals: they can be captured by closures, used with compound assignment, etc. | 1 |
| 8 | depends_on | hash maps | Object destructuring works with hash maps created via literal syntax or built up with dot/bracket assignment. | 4 |

### ml-checkpoint-forensics-engine

| round | kind | referenced_feature | sentence (first 120 chars) | earlier_round |
|---|---|---|---|---|
| 7 | depends_on | detect --filter-severity flag | The `detect --filter-severity LEVEL` flag from the previous round must use the new 5-level severity order. | 6 |
| 8 | same_rules | evidence.window_values | Keep the round 6 `evidence.window_values` behavior for timeline anomalies. | 6 |
| 9 | depends_on | detect --format csv | `detect --format csv` remains CSV-only: do not add a JSON metadata object to CSV output, and keep the CSV header as the  | 6 |

### ml-checkpoint-reproducibility-engine

| round | kind | referenced_feature | sentence (first 120 chars) | earlier_round |
|---|---|---|---|---|
| 2 | depends_on | verify-checkpoint and validate-manifest failure payloads | `verify-checkpoint` and `validate-manifest` already have command-specific JSON failure payloads for invalid checkpoint o | 1 |
| 3 | same_rules | compare-outputs missing_in_file1/missing_in_file2 | Fix `generate-report` to match: any missing tensor should make the comparison fail, and the summary should mention it (e | 1 |
| 3 | same_rules | audit-lineage validation logic | Rewrite the lineage handling in `generate-report` to use the same validation logic as `audit-lineage` so the report incl | 1 |
| 3 | same_format | audit-lineage error strings | The report's lineage section should have `"valid": false, "errors": [...]` with the same error strings that `audit-linea | 1 |
| 6 | depends_on | drift-analysis --top-k | When combined with `--top-k`, the `"num_drifting_tensors"` count must reflect all analyzed tensors, not just those retur | 5 |
| 8 | depends_on | overall_convergence | The `"stable"` classification should not count toward either `converging_count` or `diverging_count` when computing `"ov | 1 |

### ml-eval-report-engine

| round | kind | referenced_feature | sentence (first 120 chars) | earlier_round |
|---|---|---|---|---|
| 4 | uses_output_of | evaluate command report.json | It reads an existing `report.json` (generated by the `evaluate` command) and outputs a concise single-line summary to st | 1 |
| 5 | depends_on | compare performance delta table and regression analysis | Excluded metrics still appear in the performance delta table (both Markdown and JSON), but they are not checked for regr | 3 |

### mlops-inference-gateway

| round | kind | referenced_feature | sentence (first 120 chars) | earlier_round |
|---|---|---|---|---|
| 2 | depends_on | login flow | The login flow must recompute the hash from the provided password and stored salt, and compare the result to the stored  | 1 |
| 3 | depends_on | model version upload endpoint, max_model_size_mb config | The model version upload endpoint (`/api/v1/models/{id}/versions`) should use the configured `max_model_size_mb` value i | 1 |
| 8 | depends_on | audit entries for config updates | In particular, the `config.updated` audit entry must continue to record the submitted configuration update payload in it | 1 |

### mlpipe-dag-orchestrator

| round | kind | referenced_feature | sentence (first 120 chars) | earlier_round |
|---|---|---|---|---|
| 2 | same_rules | experiment ID generation (plan and run) | For each pipeline, generate its expected experiment IDs from its parameter grid (same logic used by `plan` and `run`). | 1 |
| 2 | depends_on | state directories | Look up corresponding state directories under `.mlpipe/state/`. | 1 |
| 2 | depends_on | metric objectives | Identify shared objective metrics: metrics with `minimize` or `maximize` objective that are declared in ALL provided pip | 1 |
| 2 | depends_on | stage state files | For each experiment, collect metric values from its stage state files. | 1 |
| 3 | depends_on | experiment state files | For each group, collect the specified metric's value from the experiment's state files. | 1 |
| 4 | depends_on | report metric_rankings | Note: `metric_rankings` behavior is unchanged — it still ranks experiments per-metric for `minimize` and `maximize` obje | 1 |
| 5 | same_rules | report min-max normalization | The `<metric>_norm` columns use the same min-max normalization as the report (inverted for minimize objectives, 0.5 for  | 4 |
| 5 | same_rules | report composite_score | The `composite_score` column uses the same 4-decimal-place value from the report computation; empty when there are no ob | 4 |
| 5 | depends_on | experiment ID format | Parameter values are extracted from the experiment ID using the pipeline's parameter definitions. | 1 |
| 6 | same_rules | experiment ID generation (plan and run) | Generate the expected experiment IDs using the same parameter expansion logic used by `plan` and `run` (sorted parameter | 1 |
| 6 | depends_on | experiment IDs and state directories | It generates expected experiment IDs from the parameter grid, then checks `.mlpipe/state/` for each experiment's stage r | 1 |
| 6 | depends_on | stage state file start_time/end_time | `duration_seconds` for each stage is computed from the `start_time` and `end_time` fields in the stage's state JSON file | 1 |
| 6 | same_rules | export parameter extraction | `parameters` in each experiment entry maps parameter names to their values, extracted from the experiment ID using the p | 5 |
| 7 | same_rules | status command duration computation | Compute each stage's mean duration across completed experiments using the same duration computation as the status comman | 6 |
| 7 | same_rules | export parameter extraction | Group completed experiments by the parameter's value (extract parameter values from experiment IDs using the same logic  | 5 |
| 7 | same_rules | pipeline parameter grid scoping | Experiments are scoped to the pipeline's parameter grid (same scoping as report, export, status). | 6 |

### mlpipe-inference-pipeline-migration

| round | kind | referenced_feature | sentence (first 120 chars) | earlier_round |
|---|---|---|---|---|
| 2 | same_format | v1 binary weight format | Format v1 is the same as today (no activation field between num_outputs and weights). | 1 |
| 3 | depends_on | weight format versions v1/v2 | Write `weights.bin` in the format indicated by `format_version` (v1 or v2) | 2 |
| 3 | depends_on | activation types and v1 default | `activation`: activation name string ("none", "sigmoid", "relu", "tanh") — for v1 models, always "none" | 2 |
| 5 | depends_on | export command | `mlpipe export` exports the current state only (not checkpoints) | 3 |
| 7 | same_format | mlpipe run output format | Output format same as regular `mlpipe run` (csv or json) | 1 |
| 10 | depends_on | checkpoint command | Before pruning (when not dry-run), automatically create a checkpoint named `pre-prune` | 5 |
| 13 | depends_on | loadWeights v1/v2 support | Still handle v1 and v2 files (no checksum) | 2 |
| 13 | same_rules | migrate backup convention | Create backup as `weights.bin.v2bak` (or v1bak) | 2 |

### mlpipe-orchestrator

| round | kind | referenced_feature | sentence (first 120 chars) | earlier_round |
|---|---|---|---|---|
| 2 | same_rules | split stage seed (standard mode) | The dataset arriving at the `split` stage (from its input) is partitioned into K folds using the `seed` param from the ` | 1 |
| 2 | depends_on | split stratify param | If `stratify` is specified in the split params, stratified K-fold partitioning is used. | 1 |
| 2 | depends_on | global-param substitution | The canonical JSON encoding of the stage's resolved `params` (i.e., after global-param substitution), with object keys s | 1 |
| 2 | same_format | artifacts map and summary object | One file per output port: `<port_name>.json` — the serialized output artifact data (the same data that would be in the ` | 1 |
| 2 | same_rules | artifact ID format | The artifact IDs for the stage's outputs are generated identically to a normal run (using the current run timestamp), bu | 1 |
| 2 | extends | mlpipe run output | The `mlpipe run` output gains one new top-level field: | 1 |
| 2 | extends | artifact ID format | Artifact IDs for fold-specific stages use the format `<pipeline_name>-<stage_name>-<port_name>-<unix_timestamp>-fold<i>` | 1 |
| 2 | extends | register stage model_name | The model names for each fold append `-fold<i>` to the configured `model_name`. | 1 |
| 2 | depends_on | validation (mlpipe validate) | It validates the config first; if invalid, it exits with the validation errors: | 1 |
| 2 | depends_on | stage inputs map | Only edges that correspond to actual input connections (explicit `inputs` map entries, or the implicit wiring resolved b | 1 |
| 4 | depends_on | cache_stats | Skipped stages are not cached and do not count toward `cache_stats`. | 2 |
| 4 | same_format | train stage predictions output | `predictions`: A dataset containing the ensemble predictions (same format as train stage predictions output). | 1 |
| 4 | depends_on | plan command | Unlike `plan`, the `validate` command: | 2 |
| 4 | depends_on | --param substitution | Accepts `--param key=value` flags for parameter substitution before validation. | 1 |
| 4 | same_rules | stage cache key | Ensemble stages participate in caching like any other stage (cache key includes type + params + input cache keys). | 2 |
| 4 | depends_on | plan command output | Ensemble stages are included in plan command output with output ports `predictions` and `model`. | 2 |
| 6 | depends_on | --skip-stage flag | `skipped_stages`: Array of explicitly skipped stage names (from `--skip-stage`). | 4 |
| 6 | depends_on | --no-cache flag | `no_cache`: Boolean indicating whether `--no-cache` was used. | 2 |
| 6 | depends_on | cache_stats | `cache_stats`: Cache hit/miss counts (`null` if `--no-cache`). | 2 |

### multiservice-deploy-pipeline

| round | kind | referenced_feature | sentence (first 120 chars) | earlier_round |
|---|---|---|---|---|
| 2 | same_rules | --service NAME transitive dependencies | With `--service NAME`, only promote that service plus its transitive dependencies. | 1 |
| 2 | depends_on | deploy test requirement | Promote does not require tests to pass — it reuses already-deployed artifacts. | 1 |
| 2 | depends_on | artifact version string format | `DIFFERS: <service> <env1_version> vs <env2_version> (<envX> newer)` — if the service is deployed in both but at differe | 1 |
| 2 | extends | deploy command | The `deploy` command must now record a `DEPLOY` event for each successfully deployed service. | 1 |
| 2 | extends | rollback command | The `rollback` command must record a `ROLLBACK` event for each successfully rolled-back service. | 1 |
| 3 | extends | validate command | Additionally validate that every service has a `version` field matching the pattern `N.N.N` (three dot-separated non-neg | 1 |
| 3 | same_format | diff DIFFERS output format | The output format remains: `DIFFERS: <service> <v1> vs <v2> (<envX> newer)`. | 2 |
| 3 | depends_on | promote event log entries | Conflict-blocked services do NOT generate event log entries. Forced promotions DO generate PROMOTE events. | 2 |
| 3 | extends | history PROMOTE event format | Forced promotion events include a `(forced)` suffix: `<timestamp> PROMOTE <service> <version> from <source-env> (forced) | 2 |
| 3 | depends_on | build command | The version change is written back to the manifest and affects subsequent `build` commands. | 1 |
| 4 | same_rules | rollback not-deployed failure | Rollback should fail if the service is not currently deployed (same as before). | 1 |
| 4 | depends_on | event log | Restore generates RESTORE event log entries for each service. | 2 |
| 4 | extends | history command | The history command should now also show RESTORE events: `<timestamp> RESTORE <service> <version> from snapshot #<id>`. | 2 |
| 5 | depends_on | environment event log | Lock and unlock operations must write events to the environment's event log (the same JSONL file used by deploy, rollbac | 2 |
| 5 | extends | status detail view | The `status <environment>` detail view (when an environment argument is given) must include lock status. | 1 |
| 6 | depends_on | lock enforcement | Lock enforcement applies (mutates state). | 5 |
| 6 | depends_on | lock checks | This validation is applied before any other checks (including lock checks). | 5 |
| 6 | same_format | lock error format | The error must match the standard lock format: `ERROR: <env> is locked (<reason>)`. | 5 |
| 6 | depends_on | environment event log | Each `config set` operation writes a CONFIG_SET event, and each `config delete` operation writes a CONFIG_DELETE event t | 2 |
| 6 | extends | status detail view and lock status | The `status <environment>` detail view must show config count after lock status (if any) and before service listings: `C | 5 |
| 7 | depends_on | environment max_replicas | Error if count exceeds the environment's `max_replicas` from the manifest: `ERROR: <count> exceeds max_replicas (<max>)  | 1 |
| 7 | depends_on | deploy command | A service must be deployed to the environment before scaling — error if not deployed: `ERROR: <service> is not deployed  | 1 |
| 7 | depends_on | environment event log | A SCALE event is written for each service. | 2 |
| 7 | depends_on | lock enforcement | Lock enforcement applies. | 5 |
| 7 | extends | status detail view | The `status <environment>` detail view must show replica count after the version for each service: | 1 |
| 7 | depends_on | deploy, rollback and promote | When a service is deployed (or redeployed), its replica count resets to 1. When a service is rolled back, its replica co | 2 |
| 8 | depends_on | lock enforcement | Lock enforcement applies (mutation). | 5 |
| 8 | depends_on | deploy, rollback and promote | Default is `healthy` if never explicitly set or after deploy/rollback/promote. | 7 |
| 8 | extends | status detail view (replica count) | The `status <environment>` detail view must show health state after the replica count for each service: | 7 |
| 8 | depends_on | deploy, rollback and promote | When a service is deployed (or redeployed), its health state resets to `healthy`. When a service is rolled back, its hea | 7 |
| 8 | depends_on | scale command | Cannot scale UP (increase replica count) an unhealthy service. | 7 |
| 8 | depends_on | scale --all bounds pre-check | The `--all` health pre-check happens after the bounds pre-check. | 7 |
| 8 | depends_on | promote command | Cannot promote an unhealthy service from the source environment. | 2 |
| 8 | depends_on | promote same-version skip | The health check happens before version comparison — even if the version would be skipped, an unhealthy source service s | 2 |
| 9 | depends_on | lock enforcement | Lock enforcement applies (mutation). | 5 |
| 9 | depends_on | replica counts | Usage for `max_total_replicas` is the sum of all service replica counts (default 1 per service if not explicitly scaled) | 7 |
| 9 | depends_on | lock check on deploy | This check happens AFTER the lock check but BEFORE the actual deployment. | 5 |
| 9 | depends_on | deploy with dependencies | The check applies per service in the deploy loop — if deploying with dependencies, each new service is checked individua | 1 |
| 9 | depends_on | scale health check | This check happens AFTER the health check but BEFORE the replica update. | 8 |
| 9 | depends_on | scale --all health pre-check | The --all check happens AFTER the health check in the pre-check phase. | 8 |
| 9 | extends | status config line | The `status <environment>` overview must show quota info after the config line (if quotas are set). | 6 |
| 10 | depends_on | environment locking | The source environment must not be locked. | 5 |
| 10 | same_format | lock error format | Error if source environment is locked: `ERROR: <source_env> is locked (<reason>)`. | 5 |
| 10 | depends_on | deployments, replicas, bounds, health, config, quotas | The clone copies the following state from the source environment to the target: | 9 |
| 10 | depends_on | manifest environments section | The new environment must be added to the `environments` section of `pipeline.yaml` so it persists across invocations. | 1 |
| 10 | depends_on | environment event log | A single CLONE event is written to the TARGET environment's event log (the source environment's event log is not modifie | 2 |
| 10 | depends_on | status without arguments | After cloning, `status` (without arguments) must include the new environment in its summary. | 1 |
| 10 | depends_on | all existing environment commands | All existing commands (deploy, rollback, promote, scale, health, config, quota, lock, unlock, snapshot, restore, diff, h | 1 |
| 11 | depends_on | environment locking and event log | The report is entirely read-only: it works on locked environments and does NOT generate any events. | 5 |
| 11 | same_rules | replica count default | The count is the explicit replica setting if one exists, otherwise 1 (the default for any deployed service). | 7 |
| 11 | same_rules | health state default | If a service has no explicit health state set (or its health state has been reset by a deploy/rollback/promote), the def | 8 |
| 11 | same_rules | quota usage | Usage for `max_services` is the number of currently deployed services. Usage for `max_total_replicas` is the sum of all  | 9 |
| 11 | same_format | history display format | Each line is indented with 2 spaces. Format: ` <iso_timestamp> <ACTION> <details>` — the same display format used by the | 2 |
| 11 | same_format | history display text | The `details` field contains the remaining display text after the action (the same text shown in `history` output after  | 2 |
| 11 | depends_on | environment locking | The audit command works on locked environments without restriction. | 5 |

### nexus-ml-pipeline-system

| round | kind | referenced_feature | sentence (first 120 chars) | earlier_round |
|---|---|---|---|---|
| 2 | same_rules | skipped step behaviour | If the regex doesn't match, the variable is **not set** (same as if the step were skipped). | 1 |
| 2 | depends_on | ${var} substitution in commands and conditions | The `:-` syntax works anywhere a regular `${var}` reference works — in step commands, conditions, and captured variable  | 1 |
| 2 | depends_on | pipeline validate, conditions, parameters | `nexus pipeline run --dry-run <config.json> [--param key=value ...]` validates the config, resolves all static variables | 1 |
| 2 | depends_on | ${var} substitution | The env values themselves also support `${var}` substitution from the effective variables (parameters + captures). | 1 |
| 3 | same_rules | capture_output regex no-match | Captured output from a failed allow_failure step is not set (same behavior as regex no-match). | 2 |
| 4 | depends_on | ${...} substitution contexts | These references work anywhere `${...}` substitution already works: in commands, conditions, environment variable values | 2 |
| 4 | depends_on | capture_output | The existing `capture_output` mechanism continues to work independently — it captures into a named variable, while `.out | 2 |
| 5 | extends | condition evaluation | Enhance the condition evaluation to support: | 1 |
| 6 | depends_on | history --status filter | The `--tag` filter can be combined with the existing `--status` filter (both must match). | 2 |
| 7 | depends_on | skipped and dependency-failed steps | If a step does not execute at all, for example because it is skipped by a condition or marked dependency-failed before r | 1 |
| 8 | depends_on | pipeline list, history, status | If the run exists, delete it from storage so it no longer appears in `pipeline list`, `pipeline history`, or `pipeline s | 1 |

### numeriforge-reproducibility-migration

| round | kind | referenced_feature | sentence (first 120 chars) | earlier_round |
|---|---|---|---|---|
| 2 | extends | JSON export | The JSON export (`export --format json`) must include a top-level `environment` object that aggregates these fields with | 1 |
| 3 | depends_on | verify / SHA-256 checksums | First verify checksum integrity of the stored result. | 1 |
| 3 | depends_on | seed-based determinism | Re-execute the experiment using the stored parameters and seed | 1 |
| 4 | same_rules | single-result audit | The batch mode must audit every stored result in the store directory by re-executing each experiment with its stored par | 3 |
| 4 | same_format | audit output format | For each result, print `AUDIT_PASS: <id>` or `AUDIT_FAIL: <id>` with details. | 3 |
| 4 | depends_on | environment fingerprint fields | Compare all four environment fields: `env_go_version`, `env_os`, `env_arch`, `env_hostname`. | 2 |
| 6 | extends | JSON export | The JSON export must include a top-level `tags` object that aggregates all tag metadata (without the `tag_` prefix). | 2 |
| 7 | extends | export command | Add `--format markdown` to the export command: | 2 |
| 7 | depends_on | seed and environment metadata | A metadata section showing timestamp, seed, and environment info | 2 |
| 8 | depends_on | verify command | Print an integrity summary: run `verify` on each result and report the count of OK, FAIL, and NO_CHECKSUM results | 5 |
| 8 | depends_on | environment fingerprint | Print an environment summary showing the unique environments (OS + arch combinations) across all results | 2 |

### repro-verify-engine

| round | kind | referenced_feature | sentence (first 120 chars) | earlier_round |
|---|---|---|---|---|
| 3 | uses_output_of | verification report | Add a new `repro-verify summary <report1.json> [report2.json ...]` subcommand that reads verification report files and p | 1 |
| 4 | uses_output_of | verification reports | Add a `repro-verify trend <report1.json> <report2.json> [...]` subcommand that analyzes how verification results change  | 1 |
| 5 | depends_on | diff subcommand | The diff subcommand ranks are NOT changed — only the trend subcommand ranks. | 2 |
| 5 | uses_output_of | verification report | Add a `repro-verify slice <report.json> --status <STATUS> [--status <STATUS> ...]` subcommand that filters steps from a  | 1 |
| 6 | uses_output_of | verification report | Add a `repro-verify export <report.json>` subcommand that exports step-level data from a verification report to CSV form | 1 |

### secaudit-log-sentinel

| round | kind | referenced_feature | sentence (first 120 chars) | earlier_round |
|---|---|---|---|---|
| 2 | uses_output_of | analyze output | Read threat JSON objects from stdin (one per line, as output by `secsentinel analyze`) and an IOC database file. | 1 |
| 2 | same_rules | severity ordering | `ioc_severity`: the highest `severity` among matching IOCs, using ordering low < medium < high < critical. | 1 |
| 3 | same_rules | enrich reference timestamp convention | Reference timestamp: `first_seen` for most threat types; `timestamp` for `privilege_escalation` threats (same convention | 2 |
| 3 | uses_output_of | enrich output | Read enriched threat JSON objects from stdin (one per line, as output by `secsentinel enrich`) and group them into attac | 2 |
| 3 | uses_output_of | enriched_risk_score | `combined_risk`: float, sum of `enriched_risk_score` across all threats in the campaign. | 2 |
| 3 | uses_output_of | ioc_severity | `max_severity`: the highest `ioc_severity` among all threats in the campaign, using ordering `none` < `low` < `medium` < | 2 |
| 3 | depends_on | threat_actors array | Threats with an empty `threat_actors` array (`[]`) can never be linked to another threat (since no shared actors exist). | 2 |
| 4 | uses_output_of | enrich output | Read enriched threat JSON objects from stdin (one per line, as output by `secsentinel enrich`) and group them into fixed | 2 |
| 4 | same_rules | enrich and correlate reference timestamp convention | Reference timestamp: `first_seen` for most threat types; `timestamp` for `privilege_escalation` threats (same convention | 3 |
| 5 | same_rules | correlate --time-window | `--campaign-window <int>`: Optional, default `60`. Time window in minutes for campaign detection (same semantics as `cor | 3 |
| 5 | same_rules | correlate campaign formation | `active_campaigns`: integer, number of campaigns detected using the same algorithm as `correlate` with the given `--camp | 3 |
| 5 | uses_output_of | timeline buckets and avg_risk | `peak_bucket_avg`: float, the highest `avg_risk` among all timeline buckets (using the given `--bucket-minutes`). | 4 |
| 5 | same_rules | correlate campaign formation | **Campaign detection**: Uses the same union-find algorithm as `correlate`: two threats belong to the same campaign if th | 3 |
| 7 | uses_output_of | snapshot output | Read multiple snapshot JSON objects from stdin (one per line, as output by `secsentinel snapshot`) and produce a single  | 5 |
| 7 | uses_output_of | snapshot active_campaigns | `total_campaigns`: integer, sum of all `active_campaigns` values across snapshots. | 5 |
| 7 | same_rules | snapshot risk_category thresholds | `global_risk_category`: string, based on `global_mean_risk` using the same thresholds as snapshot: `"low"` if < 100, `"m | 5 |
| 7 | uses_output_of | snapshot actor_threat_counts | `combined_actor_counts`: object, merge of all `actor_threat_counts` from all snapshots. | 5 |
| 8 | uses_output_of | enrich max_ioc_confidence | `confidence_component` = `max_ioc_confidence` | 2 |
| 8 | uses_output_of | enriched_risk_score | `risk_component` = `min(enriched_risk_score / 500.0, 1.0)` | 2 |
| 9 | uses_output_of | aggregate output | Read exactly **two** aggregate JSON objects from stdin (one per line, as output by `secsentinel aggregate`). | 7 |
| 9 | uses_output_of | aggregate global_risk_category | `risk_category_change`: object with `"from"` and `"to"` keys, showing the baseline and current `global_risk_category` va | 7 |
| 11 | uses_output_of | aggregate output | Read aggregate JSON objects from stdin (one per line, in chronological order as output by `secsentinel aggregate`). | 7 |
| 12 | same_format | anomaly input format | Read aggregate JSON objects from stdin (one per line, same format as `secsentinel anomaly` input: objects with `global_m | 11 |
| 13 | same_format | prioritize input format | Read enriched threat events from stdin (one JSON object per line, same format as `secsentinel prioritize` input). | 8 |
| 14 | same_format | anomaly and forecast input format | Read aggregate JSON objects from stdin (one per line, same format as `secsentinel anomaly`/`forecast` input: objects wit | 11 |
| 15 | same_format | forecast input format | Read aggregate JSON objects from stdin (one per line, same format as `secsentinel forecast` input: objects with `global_ | 12 |

### service-mesh-health-router

| round | kind | referenced_feature | sentence (first 120 chars) | earlier_round |
|---|---|---|---|---|
| 2 | depends_on | circuit breaker failure tracking | A connection rejected by rate limiting must NOT count as a failure toward any endpoint's circuit breaker. | 1 |
| 2 | depends_on | circuit breaker | Each failed dial attempt counts toward that endpoint's circuit breaker failure tracking. | 1 |
| 2 | depends_on | live configuration reload (SIGHUP / reload_config) | Rate limit configuration must be reloadable via SIGHUP and the `reload_config` IPC command, updating token bucket parame | 1 |
| 3 | depends_on | live configuration reload | This field must be reloadable via SIGHUP / `reload_config`. | 1 |
| 3 | extends | get_service IPC response | The `get_service` IPC response should include the current `idle_timeout_ms` value for the service. | 1 |
| 4 | depends_on | SIGHUP reload; get_service IPC response | `connection_limit_mode` must be reloadable via SIGHUP. The `get_service` IPC response should include the current `connec | 1 |
| 4 | depends_on | health state transitions / reset_circuit_breaker | When an endpoint transitions from unhealthy or unknown state to healthy — either via health check recovery or via `reset | 1 |
| 4 | depends_on | routing eligibility | During warm-up the endpoint remains eligible for routing; only its weight is reduced. | 1 |
| 4 | depends_on | live configuration reload | `warmup_duration_ms` is reloadable via SIGHUP. | 1 |
| 5 | depends_on | graceful shutdown (SIGTERM) | The access log buffer must be fully flushed before the graceful shutdown sequence completes. | 1 |
| 6 | extends | get_access_log (access log entries) | The `get_access_log` IPC response must also include them. | 5 |
| 6 | extends | rejected_rate_limit access log result | When a connection is rejected with result `rejected_rate_limit`, the access log entry must include: | 5 |
| 7 | depends_on | rate limiting; healthy endpoints and circuit breaker closed | Before accepting any new connection (prior to rate limiting), check that every service listed in `depends_on` has at lea | 2 |
| 7 | extends | access log result field | If any dependency fails this check, reject the connection immediately with a new access log result `"rejected_dependency | 5 |
| 7 | depends_on | live configuration reload | The `depends_on` field must be reloadable via SIGHUP. | 1 |
| 8 | depends_on | live configuration reload | `half_open_max_probes` should be reloadable via SIGHUP. | 1 |
| 8 | extends | access log entries | Access log entries for mirrored connections should include a `mirrored: true` field (omit or set false for non-mirrored) | 5 |
| 8 | depends_on | live configuration reload | `mirror_endpoint` and `mirror_sample_pct` are reloadable via SIGHUP. | 1 |

### sparse-iterative-pde-solver

| round | kind | referenced_feature | sentence (first 120 chars) | earlier_round |
|---|---|---|---|---|
| 2 | same_rules | Poisson stiffness matrix K | `(I + alpha*dt*K) * u^{n+1} = u^n + dt * f^{n+1}` where `K` is the stiffness matrix (the same discrete negative Laplacia | 1 |
| 2 | same_rules | iterative solvers and preconditioners | At each time step, a sparse linear system must be solved. Use the same iterative solvers and preconditioners from the ex | 1 |
| 2 | same_rules | Poisson boundary conditions | **Boundary conditions**: Same types as the Poisson solver (Dirichlet and Neumann on each side, independently configurabl | 1 |
| 2 | same_format | Poisson source file format | Each file has the same format as the Poisson source file (header `nx ny` followed by `nx*ny` values). | 1 |
| 2 | same_format | Poisson source file format | Given as a text file with header `nx ny` followed by `nx*ny` values in row-major order (same as source file format). | 1 |
| 2 | same_rules | Poisson grid indexing and stencil | Use the same `i*ny + j` row-major indexing and the same 5-point stencil as the Poisson solver (with proper `hx`/`hy` sca | 1 |
| 2 | same_rules | Poisson system matrix | The stiffness matrix `K` is identical to the Poisson system matrix (without the boundary condition modifications). | 1 |
| 3 | same_rules | Poisson grid indexing | Grid point `(i,j)` maps to linear index `i*ny + j` (row-major, i is the x-index, j is the y-index), identical to the Poi | 1 |
| 3 | same_rules | Poisson 5-point stencil | **Diffusion term**: standard 5-point stencil with `1/hx^2` and `1/hy^2` coefficients, same as the Poisson solver. | 1 |
| 3 | same_rules | Poisson boundary conditions | **Boundary conditions**: Same types and enforcement as the Poisson solver (Dirichlet: set row to identity, RHS to bounda | 1 |
| 3 | same_format | Poisson source file format | **Source term file**: Same format as the Poisson source file (header `nx ny` followed by `nx*ny` values in row-major ord | 1 |
| 3 | depends_on | preconditioners | All existing preconditioners (`none`, `jacobi`, `ilu0`, `ssor`) apply unchanged. | 1 |
| 3 | same_format | convergence reporting (rounds 1-2) | Print to stdout (same convergence reporting as rounds 1-2, plus one new line): | 2 |
| 4 | depends_on | sparse solver and preconditioner | At each step, solve `A * w = v_k` using the configured sparse solver and preconditioner, then set `v_{k+1} = w / \|\|w\|\|`. | 1 |
| 4 | same_rules | SSOR omega validation | `--ssor-omega` must be in `(0,2)` (same validation as other commands). | 2 |
| 4 | same_format | solver --output Matrix Market array format | When specified, the converged (or best-estimate) eigenvector is written to the file in Matrix Market array format (same  | 1 |
| 6 | same_rules | Matrix Market symmetric qualifier | If the Matrix Market header declares `symmetric`, off-diagonal stored entries are interpreted as entries in both directi | 1 |
| 6 | same_format | Matrix Market array vector format | `--vec`: Input vector in Matrix Market array format | 1 |
| 7 | depends_on | matvec command (round 6) | The `matvec` command added in round 6 must continue to interpret Matrix Market files declared as `symmetric` as full sym | 6 |
| 7 | same_rules | eigenvalue --method power | `lambda_max` is estimated using power iteration (same algorithm as `eigenvalue --method power`) | 4 |
| 7 | same_rules | eigenvalue --method inverse | `lambda_min` is estimated using inverse iteration (same algorithm as `eigenvalue --method inverse`) | 4 |
| 7 | same_rules | eigenvalue random initialization | Both use the same random initialization: `srand(42)` followed by `v[i] = (double)rand() / RAND_MAX` for `i = 0..n-1`, th | 4 |
| 7 | same_rules | SSOR omega validation | `--ssor-omega` must be in `(0,2)` (same validation as other commands). | 2 |

### sparse-iterative-solver-review

| round | kind | referenced_feature | sentence (first 120 chars) | earlier_round |
|---|---|---|---|---|
| 3 | depends_on | --history output | The per-iteration `--history` lines should continue using the iterative residual. | 1 |
| 4 | same_rules | RCM reordering for connected matrices | Within each component, choose the same kind of pseudo-peripheral start and degree-ordered traversal used for connected m | 1 |
| 4 | depends_on | --history flag | `--history` prints one line per inner iteration across all restart cycles, with globally sequential iteration numbering  | 1 |
| 4 | same_rules | true residual reporting | True residual reporting and the `converged` field work identically to CG and BiCGSTAB (true residual recomputed after th | 3 |
| 4 | depends_on | preconditioners | All existing preconditioners (none, jacobi, ssor, ic0) must be accepted and applied for GMRES. | 1 |

## Spot-checks (10 random entries re-verified against the source JSON)

Re-verification uses a separate whitespace normalisation (`" ".join(s.split())`) applied to both sides, reading the JSON afresh.

| # | task | round | sentence found in round | earlier_quote found in earlier round | sentence (first 80 chars) |
|---|---|---|---|---|---|
| 1 | flowr-workflow-orchestrator | 2 | yes | yes (R1) | Each element is subject to the same `${VAR}` interpolation rules as `cmd`, indiv |
| 2 | flowr-workflow-orchestrator | 3 | yes | yes (R1) | `order_attempted` does *not* include conditionally-skipped steps — they were nev |
| 3 | flowctl-pipeline-wiring | 5 | yes | yes (R1) | `dropped_nonnumeric` and `dropped_missing` are **not touched** by `rank`. |
| 4 | mlpipe-orchestrator | 2 | yes | yes (R1) | The canonical JSON encoding of the stage's resolved `params` (i.e., after global |
| 5 | flowr-workflow-orchestrator | 7 | yes | yes (R3) | It is NOT emitted for inherited steps (those carry their prior `inherited` statu |
| 6 | flowctl-pipeline-wiring | 9 | yes | yes (R3) | `window` after `join`: both stages are barriers; `window` sees the fully joined  |
| 7 | multiservice-deploy-pipeline | 7 | yes | yes (R5) | Lock enforcement applies. |
| 8 | flowr-workflow-orchestrator | 7 | yes | yes (R3) | Filter-skipped, conditionally-skipped, cached, inherited, and `--only-step`-excl |
| 9 | deterministic-data-pipeline-go | 3 | yes | yes (R1) | The `pipeline` command now supports the `"drift"` step type: |
| 10 | gomlops-platform-modernization | 4 | yes | yes (R2) | Batch inference (`POST /api/v1/serving/batch`): each request in the batch counts |

All 10 spot-checks pass: yes.
Full re-verification of all 717 entries with the second normaliser: 0 failures.
