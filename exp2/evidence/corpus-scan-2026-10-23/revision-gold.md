# Revision-sentence gold set (EvoCodeBench, 26 tasks)

Source: `D:/huawei/EvoCodeBench/docs/data/tasks/*.json`. Machine-readable records: `revision-gold.json` (193 records). Every `sentence` and `earlier_quote` was machine-verified as a verbatim (whitespace-normalised) substring of the stated round markdown.

## buildctl-pipeline-orchestrator

| round | kind | sentence (first 120 chars) | earlier_round | conf |
|---|---|---|---|---|
| 3 | partial | Fix cache keys: include sorted dependency names and sorted output paths alongside the existing inputs. | 1 | medium |
| 5 | revise | Change build to fail-fast by default. | 1 | high |
| 5 | revise | When any target fails, don't start additional targets -- unstarted targets get status `cancelled` (distinct from `skippe | 1 | high |

## deterministic-data-pipeline-go

| round | kind | sentence (first 120 chars) | earlier_round | conf |
|---|---|---|---|---|
| 3 | revise | If only a **lower anchor** exists (no float-parseable non-empty cell found below the current empty cell), the empty cell | 2 | high |
| 3 | revise | If only an **upper anchor** exists (no float-parseable non-empty cell found above the current empty cell), the empty cel | 2 | high |
| 3 | revise | Previously, cells with only one anchor remained empty. This is now corrected to use constant extrapolation from the near | 2 | high |
| 3 | revise | The `normalize` transform with `"method": "zscore"` now uses **sample standard deviation** (Bessel's correction) instead | 2 | high |
| 5 | revise | The `verify` command previously used SHA256 for computing file checksums. It now uses **BLAKE2b-256** instead. | 1 | high |
| 5 | revise | Checksums in manifest files must now be BLAKE2b-256 hex digests (64 lowercase hex characters). | 1 | high |
| 5 | revise | The `manifest` command must also produce BLAKE2b-256 checksums (not SHA256). | 1 | high |
| 5 | withdraw | The `.sha256` sidecar files produced during `ingest` and `transform` are **removed** — these commands no longer produce  | 1 | high |
| 5 | withdraw | If `<output>.sha256` exists from a previous run, `ingest` and `transform` must remove it. | 1 | medium |
| 5 | revise | `manifest` command: produces BLAKE2b-256 checksums instead of SHA256. | 1 | medium |
| 5 | withdraw | `ingest` command: no longer writes `.sha256` sidecar files. | 1 | medium |
| 5 | withdraw | `transform` command: no longer writes `.sha256` sidecar files. | 1 | medium |
| 7 | revise | The `lineage` command previously treated the `"manifest"` step's `dir` field as a single input node, creating an edge fr | 5 | high |
| 7 | revise | `"manifest"` step has **no input nodes** (empty inputs array `[]`). | 5 | high |
| 10 | revise | The manifest output format changes. The `blake2b` JSON field is replaced with two new fields: | 1 | medium |
| 12 | revise | When the `method` field is omitted or empty, normalize should now behave exactly like `"minmax"` instead of producing em | 2 | medium |
| 15 | revise | It should now report `row_hash` as the SHA-256 digest of the same sorted row-content string defined for `snapshot`. | 13 | high |
| 15 | revise | The `row_hash` field in the JSON output is now a 64-character lowercase hexadecimal string instead of 32 characters. | 13 | high |

## eventq-pipeline

| round | kind | sentence (first 120 chars) | earlier_round | conf |
|---|---|---|---|---|
| 4 | revise | The invalid-`reason` vocabulary's `fx_lookup` code is retired. | 3 | high |
| 4 | revise | Split `fx_lookup` into two distinct codes | 3 | high |
| 4 | revise | This is a user-visible correction to audit-log reason codes: `fx_lookup` is no longer emitted | 3 | high |
| 4 | revise | the strict-rates feature relaxes `rates.json` loading: rate values that are non-finite (NaN/Inf/-Inf), zero, or negative | 1 | high |
| 4 | partial | These checks replace/augment the pre-existing `fx rates must include USD=1.0`, `fx days invalid`, and `fx base must be U | 1 | medium |
| 4 | partial | Correction to the audit-log accepted-record key order: for `type in {purchase, refund}` accepted records (the "monetary" | 3 | medium |
| 6 | revise | When `--dedup-policy first-arrival` is supplied, the winner-selection rule is replaced in full: | 1 | low |
| 7 | revise | The `cutoff` value in every `late` audit record is now a structured JSON object with exactly two keys in this order: | 3 | high |
| 7 | revise | Every entry of `pending_purchases` in the emitted `--state-out` JSON MUST carry a new integer key, `first_seen_epoch` | 2 | high |
| 7 | partial | `audit_log` becomes a **JSON array of basenames** in this exact order | 3 | low |
| 7 | partial | `sha256` is **removed**; in its place an array key `sha256_segments` is emitted | 3 | low |
| 9 | revise | blank-only input lines (lines that are empty after whitespace-trim, but are still physically present in the shard) are R | 1 | medium |
| 10 | revise | Under `--session-policy fixed-window`, the original sole-gap session rule is **replaced** — for the sole purpose of comp | 1 | low |
| 13 | revise | Under `observed`, `time_range.min` and `time_range.max` in `--output` are recomputed over the same timestamp corpus used | 1 | low |

## flowctl-pipeline-wiring

| round | kind | sentence (first 120 chars) | earlier_round | conf |
|---|---|---|---|---|
| 4 | revise | `number`-typed key: **missing key columns are no longer a hard error.** A record that lacks the key column is sorted as  | 1 | high |
| 4 | revise | ## Correction to `sort` — missing key columns no longer abort | 1 | medium |
| 4 | partial | **Empty string** in a `number` key is treated like *missing* (sentinel below all finite numbers), not as a parsing error | 1 | medium |
| 6 | revise | A record that lacks a `by` column is **no longer a hard error**. | 2 | high |
| 6 | partial | for `sum` this overrides the previous "sum of empty group is 0" rule ONLY when every contributing record lacked the colu | 2 | high |
| 8 | revise | For an `as: string` sort key, an **empty-string value** (whether the record lacks the column entirely or the column is p | 4 | high |
| 8 | revise | In short: `""` is now the **largest** string under `asc` (and the smallest under `desc`), whereas before it was the smal | 4 | high |
| 9 | revise | The formula is now `p_i = (r_i - 1) / n_part` — the denominator is the partition size itself, not `n_part - 1`, and the  | 5 | high |
| 9 | revise | This is a **retroactive summary-line change**: any existing pipeline that asserted the exact summary line will now see a | 2 | high |

## flowr-workflow-orchestrator

| round | kind | sentence (first 120 chars) | earlier_round | conf |
|---|---|---|---|---|
| 5 | partial | Params slot into the existing four-tier `${VAR}` resolution. The full tier order, highest precedence first, becomes: | 3 | medium |
| 5 | partial | A leading `./` in `path` is **stripped** before normalization. | 4 | medium |
| 5 | partial | Any `path` that contains the literal substring `..` as a path segment (i.e. a segment whose bytes are exactly `..`) is a | 4 | high |
| 5 | partial | A **trailing `/`** in `path` is a validation error (exit 4): `invalid artifact path: <path>`. | 4 | high |
| 7 | revise | **C3 overrides the `--run-id` validator announced in R1.** | 1 | high |
| 7 | revise | The validator regex for `--run-id` becomes **`^[A-Za-z0-9_.\-]+$`**. | 1 | high |

## forgekit-monorepo-build-pipeline

| round | kind | sentence (first 120 chars) | earlier_round | conf |
|---|---|---|---|---|
| 3 | partial | `get_src_mtime` must also consider the `package.forge` file's modification time. | 1 | low |
| 5 | revise | Replace the timestamp-based freshness check with a content hash. | 3 | high |
| 5 | revise | **Key behavioral change**: `touch`ing a file without changing its content does **not** invalidate the cache, because the | 3 | high |
| 5 | partial | The cache stamp file (`.forge_cache/<pkg>-<profile>.hash`) stores the source hash at the time of the last successful bui | 2 | medium |
| 7 | revise | **Required fix:** Include the profile name in the source hash computation. | 5 | medium |

## gomlops-platform-modernization

| round | kind | sentence (first 120 chars) | earlier_round | conf |
|---|---|---|---|---|
| 2 | revise | the `normalize` transform must return **0.5** for each element instead of 0.0. | 1 | medium |
| 3 | revise | The normalize transform now maps values to the **[-1, 1]** range instead of [0, 1]: | 1 | high |
| 3 | revise | When all values are identical (zero range), return **0.0** (the midpoint of [-1, 1]). | 2 | high |
| 3 | revise | This replaces the previous [0, 1] normalization and the 0.5 zero-range behavior entirely. | 2 | high |
| 3 | revise | When a new version is promoted to production, the previously-production version is now demoted to **staging** instead of | 1 | high |
| 3 | revise | The `weighted_mean` experiment aggregation now reads weight values from the run's **metrics** map instead of the paramet | 1 | high |
| 5 | revise | Change the behavior to also handle a single experiment gracefully: | 4 | high |
| 6 | revise | The `mean` aggregation type for experiment metrics now computes a **trimmed mean** when there are 4 or more data points: | 1 | high |
| 6 | revise | The pipeline `export` step with `format: "csv"` now includes a header row in the output: | 1 | medium |
| 6 | revise | Previously, annotation keys were case-sensitive. Now, annotation keys are normalized to **lowercase** on both write and  | 4 | high |
| 6 | partial | The duplicate-key check is case-insensitive: if `"review_status"` exists and you try to add `"Review_Status"`, it should | 4 | high |
| 6 | revise | When creating a model version, tags are now automatically **deduplicated** and **sorted alphabetically**: | 1 | medium |
| 7 | revise | The existing `DELETE /api/v1/experiments/{name}/runs/{id}` endpoint currently returns only a status message. Modify it t | 2 | high |
| 7 | partial | Change the error from `duplicate step name: X` to `duplicate step name: "X"` (with the step name in double quotes). | 4 | medium |

## hermetic-build-artifact-verifier

| round | kind | sentence (first 120 chars) | earlier_round | conf |
|---|---|---|---|---|
| 3 | revise | This is now corrected: flags must be hashed in **manifest order** — the exact order they appear in the JSON `flags` arra | 1 | high |
| 3 | revise | 3. For each flag in `flags`, in manifest order (not sorted): the flag string as UTF-8 bytes, followed by one newline byt | 1 | high |
| 4 | revise | It no longer performs two independent full builds. | 1 | high |
| 4 | revise | `first_hash` is replaced by `cached_hash`: the SHA-256 hex digest of the output artifact from the cached/first build. | 1 | high |
| 4 | revise | `second_hash` is replaced by `fresh_hash`: the SHA-256 hex digest of the output artifact from the clean rebuild. | 1 | high |
| 4 | revise | The per-target `targets` array in the output contains ONLY targets that exist in BOTH the current manifest and the basel | 1 | medium |
| 7 | revise | This is now corrected: the chain hash must also include the **profile name** (if active) as the first element. | 4 | high |
| 7 | partial | when computing `freed_bytes`, count the file size only if the hard link count would drop to zero after removal | 1 | medium |
| 7 | partial | The `status` command's `store_size_bytes` counts each unique inode only once (not once per hard link). | 5 | medium |

## jobforge-dag-runner

| round | kind | sentence (first 120 chars) | earlier_round | conf |
|---|---|---|---|---|
| 4 | revise | The attribute list must now be written with a single **space** between the two attributes (but still with NO space aroun | 3 | high |
| 4 | revise | i.e. attributes are **space-separated** (not comma-separated). | 3 | medium |
| 8 | revise | The literal prefix changes from `level <N>: ` to `L<N> [`, with no space between `L` and the level number. | 1 | high |
| 8 | revise | The text output must now use the new format: | 1 | high |

## lsm-kvstore-engine

| round | kind | sentence (first 120 chars) | earlier_round | conf |
|---|---|---|---|---|
| 5 | revise | SCAN now uses an **exclusive** end key. | 1 | high |
| 5 | partial | The per-block CRC-32 checksum covers the compressed block bytes as written. | 3 | medium |
| 7 | revise | Instead of a single WAL file, use numbered segment files: `wal_000001.log`, `wal_000002.log`, etc. in the data directory | 1 | medium |
| 7 | revise | On memtable flush, delete all WAL segments whose highest seqnum is <= the flushed seqnum — don't truncate the active seg | 1 | high |

## minicc-compiler-evolution

| round | kind | sentence (first 120 chars) | earlier_round | conf |
|---|---|---|---|---|
| 2 | revise | Fix `&&` so that if the left operand is falsy, the right operand is never evaluated and the result is the left value (fa | 1 | low |
| 3 | revise | Change `for..in` so it iterates over *indices* instead: | 1 | high |
| 3 | revise | When either operand of `+` is a string, the other should be coerced to its string representation and the result should b | 1 | low |
| 3 | revise | `<`, `>`, `<=`, `>=` should perform lexicographic (byte-by-byte) comparison when both operands are strings. | 1 | low |
| 5 | revise | Change closures to capture by **reference**: a closure shares the same variable binding as its enclosing scope. | 2 | high |
| 5 | revise | Closures currently capture variables by value (snapshot at creation time). | 2 | medium |

## ml-checkpoint-forensics-engine

| round | kind | sentence (first 120 chars) | earlier_round | conf |
|---|---|---|---|---|
| 2 | partial | The gradient norm spike detector now uses a 30-step sliding window (was 50) with a Z-score threshold of 2.5 (was 3.0). | 1 | high |
| 2 | partial | The severity boundary for "high" is now Z > 4.0 (was 5.0). | 1 | high |
| 2 | partial | Training gap detection threshold has been reduced to 3600 seconds (was 7200). | 1 | high |
| 2 | partial | Timeline gap detection now flags gaps of more than 50 consecutive missing steps (was 100). | 1 | high |
| 3 | revise | The `verify` command's checkpoint `issues` field is now an array of objects `{"type": string, "detail": string}` instead | 1 | high |
| 4 | revise | the entry with the **earliest** timestamp now wins (previously it was the latest). | 1 | high |
| 7 | revise | The previous 4-level system (`critical`, `high`, `medium`, `low`) is replaced with a 5-level system that adds an `info`  | 1 | high |
| 7 | partial | Learning rate anomalies are now `info` severity (were `medium`) | 1 | high |
| 7 | partial | Provenance chain breaks are now `medium` (were `high`) | 1 | high |
| 7 | partial | Training time gaps are now `info` (were `low`) | 1 | high |
| 7 | revise | Anomaly sort order now uses severity, then type alphabetically, then epoch, then step. | 1 | medium |
| 8 | revise | **Gradient spike detection** now uses Exponential Weighted Moving Average (EWMA) instead of a simple sliding window mean | 2 | high |
| 8 | revise | **Loss divergence detection** now compares the current loss value against an Exponential Moving Average (EMA) rather tha | 1 | high |

## ml-checkpoint-reproducibility-engine

| round | kind | sentence (first 120 chars) | earlier_round | conf |
|---|---|---|---|---|
| 2 | revise | every command should output `{"error": "<message>"}` on stdout with exit code 1. | 1 | medium |
| 3 | revise | Fix `generate-report` to match: any missing tensor should make the comparison fail, and the summary should mention it | 1 | medium |
| 3 | revise | Rewrite the lineage handling in `generate-report` to use the same validation logic as `audit-lineage` so the report incl | 1 | medium |
| 5 | revise | Non-increasing step changes should count as "converging"; non-decreasing step changes (with at least one strict increase | 1 | high |
| 5 | revise | Use the maximum step change across all consecutive pairs as the denominator instead, so the score reflects the full drif | 1 | high |
| 7 | revise | Only flag timestamps where the child is strictly *before* the parent -- equal timestamps should be allowed. | 1 | high |
| 8 | revise | Use the mean step change as the denominator instead: `stability_score = 1 - (last_step_change / mean_change)`. | 5 | high |
| 8 | revise | When all consecutive step changes are exactly equal and non-zero, classify the tensor as `"stable"` instead of `"converg | 5 | high |

## ml-eval-report-engine

| round | kind | sentence (first 120 chars) | earlier_round | conf |
|---|---|---|---|---|
| 2 | revise | The regression metric previously named `mape` has been corrected to `smape` (Symmetric Mean Absolute Percentage Error) w | 1 | high |
| 2 | revise | The metric key changes from `mape` to `smape` in all outputs. | 1 | high |
| 3 | revise | Previously, all metrics used the same delta direction for regression checks (`delta < min_absolute_delta`). Now, higher- | 1 | high |
| 3 | partial | The regression config format changes from `min_absolute_delta`/`min_relative_delta` to `max_delta`/`max_relative_delta`  | 1 | high |
| 5 | revise | In previous versions, the `smape` metric was excluded from bootstrap confidence interval computation for regression task | 2 | medium |
| 6 | revise | The `--bootstrap` flag for the `evaluate` command now defaults to `0` instead of `1000`. | 2 | high |
| 7 | revise | The compare command's regression analysis table in Markdown output previously listed metrics in alphabetical order (usin | 3 | high |

## mlops-inference-gateway

| round | kind | sentence (first 120 chars) | earlier_round | conf |
|---|---|---|---|---|
| 2 | revise | All passwords must be hashed before storage using SHA-256 with a unique per-user random salt (minimum 16 bytes). | 1 | low |

## mlpipe-dag-orchestrator

| round | kind | sentence (first 120 chars) | earlier_round | conf |
|---|---|---|---|---|
| 3 | revise | The `metric_summary` in the report command currently uses population standard deviation (dividing by N). It should use s | 1 | high |
| 4 | revise | **Change `best_experiment` selection to composite scoring:** | 1 | high |
| 4 | revise | Only `best_experiment` selection changes from rank-based to composite-score-based. | 1 | medium |
| 6 | revise | Fix `report` so that it only includes experiments whose IDs match the expected parameter combinations from the given pip | 1 | high |
| 6 | revise | The same scoping fix must also apply to the `export` command and the `sweep` command: when given a pipeline YAML, they s | 3 | medium |
| 7 | revise | Change composite scoring to importance-weighted averaging: each shared metric's weight is the sample standard deviation  | 2 | high |

## mlpipe-inference-pipeline-migration

| round | kind | sentence (first 120 chars) | earlier_round | conf |
|---|---|---|---|---|
| 4 | revise | Change registry storage from `registry.idx` (pipe-delimited) to `registry.json` (JSON array) | 1 | medium |
| 8 | partial | The resolved `"weights"` array is always persisted in the config JSON, including the unweighted case (where it is `[1.0, | 7 | medium |
| 11 | revise | Only AFTER combining should postprocessing (round + clip) be applied, using the first model's postprocessing config. | 7 | medium |

## mlpipe-orchestrator

| round | kind | sentence (first 120 chars) | earlier_round | conf |
|---|---|---|---|---|
| 3 | revise | When **all** actual values are zero (no rows can be used for computation), MAPE should be reported as `null` in the outp | 1 | medium |
| 3 | revise | If SS_tot is zero and SS_res is also zero (predictions perfectly match the constant actuals), R2 should be `1.0` (perfec | 1 | high |
| 3 | revise | If SS_tot is zero but SS_res is non-zero (predictions differ from the constant actual value), R2 should be reported as ` | 1 | high |
| 3 | revise | When a metric is present in one version but absent in another, the missing version's value should be `null` (not `0.0`). | 1 | low |
| 3 | partial | The `delta` and `pct_change` fields should also be `null` when either version's value is `null`. | 1 | medium |
| 3 | revise | When `--no-cache` is used, the `cache_stats` field should be omitted entirely from the pipeline run output. | 2 | high |
| 3 | revise | In the plan output, register stages should have `"cache_status": "uncacheable"` instead of "hit", "miss", or "unknown". | 2 | high |
| 5 | revise | The confusion matrix metric output format is changing for ALL classification evaluations, including binary classificatio | 1 | high |
| 5 | revise | The `mlpipe registry list` command output format is changing. | 1 | high |
| 5 | revise | All validation errors (including file-not-found and parse errors) are reported through the standard validation output on | - | medium |
| 5 | revise | This means `mlpipe validate` NEVER writes to stderr — all output goes to stdout as structured JSON. | - | medium |
| 7 | partial | For CV runs, the `stage_summary` should include a `folds` key: | 6 | medium |
| 7 | revise | The `diff` command should apply parameter substitution (`--param` flags and `${...}` resolution) before comparing. | 6 | medium |

## multiservice-deploy-pipeline

| round | kind | sentence (first 120 chars) | earlier_round | conf |
|---|---|---|---|---|
| 3 | revise | Build artifact format changes from `<name>:<timestamp>:built` to `<name>:<version>+build.<timestamp>`, where `<version>` | 1 | high |
| 3 | revise | Version comparison now uses semver-first logic: | 2 | high |
| 3 | revise | The summary line changes to: `Promoted N, skipped M, conflicts C` | 2 | high |
| 4 | revise | The rollback behavior is wrong — rolling back a service should restore the previous version from event history, not just | 1 | high |
| 4 | revise | The rollback output changes to: `ROLLBACK <service> from <env>: <current_version> -> <previous_version>` | 1 | high |

## nexus-ml-pipeline-system

| round | kind | sentence (first 120 chars) | earlier_round | conf |
|---|---|---|---|---|
| 3 | revise | When such a step fails, its downstream dependents still execute normally instead of being marked as dependency-failed. | 1 | low |
| 3 | partial | if the only failures are allow_failure steps, the overall run status should be `succeeded_with_warnings` rather than `fa | 1 | low |
| 5 | revise | After variable substitution, if any unresolved `${...}` reference remains in the condition string, the condition evaluat | 2 | medium |

## numeriforge-reproducibility-migration

| round | kind | sentence (first 120 chars) | earlier_round | conf |
|---|---|---|---|---|
| 3 | revise | The CSV export format is incomplete. It currently outputs only `label,value` data rows. It should include comment lines  | 1 | medium |
| 5 | revise | The previous output tokens must be replaced: | 1 | high |
| 5 | revise | `VERIFIED:` must change to `INTEGRITY_OK:` | 1 | high |
| 5 | revise | `CORRUPTED:` must change to `INTEGRITY_FAIL:` | 1 | high |
| 5 | partial | The audit command's checksum verification should also use the updated terminology in its failure messages (e.g., "integr | 3 | medium |
| 7 | revise | The summary should show: `Audit Summary: <N> passed, <M> failed, <S> skipped out of <total> total` | 4 | high |

## repro-verify-engine

| round | kind | sentence (first 120 chars) | earlier_round | conf |
|---|---|---|---|---|
| 3 | revise | The policy engine incorrectly modifies the raw `overall_status` field in the verification report. The raw `overall_statu | 2 | high |
| 3 | revise | The diff subcommand does not correctly return exit code 1 when step regressions are detected. It must exit 1 whenever `s | 2 | low |
| 5 | revise | The previous ranks (PASS=4, FAIL=3, ERROR=2, TIMEOUT=1, SKIPPED=0) are corrected to (PASS=4, TIMEOUT=3, ERROR=2, FAIL=1, | 4 | high |
| 7 | revise | Previously it averaged ALL steps' stability values, including steps that appear in only 1 report (trivial stability=1.0) | 4 | high |

## secaudit-log-sentinel

| round | kind | sentence (first 120 chars) | earlier_round | conf |
|---|---|---|---|---|
| 3 | revise | Modify the `enrich` subcommand so that exact `ipv4` IOC matches take priority over `ipv4_cidr` matches when they target  | 2 | high |
| 3 | revise | During CIDR candidate collection, skip any (field_name, IP_address) pair that appears in the shadow set. | 2 | medium |
| 5 | revise | The `dominant_type` field in `timeline` output previously broke ties alphabetically. **This is now changed.** | 4 | high |
| 5 | revise | When multiple threat types share the highest count within a bucket, break the tie by the **highest mean `enriched_risk_s | 4 | high |
| 7 | revise | The `escalation_index` in `timeline` was previously defined to sum only **positive** severity deltas. This is corrected: | 4 | high |
| 10 | revise | The recency component half-life is **reduced from 60 minutes to 30 minutes**. | 8 | high |
| 12 | partial | `"critical"` if priority_score >= 0.80 (was 0.75) | 8 | high |
| 12 | partial | `"high"` if priority_score >= 0.55 (was 0.50) | 8 | high |
| 12 | partial | `"medium"` if priority_score >= 0.30 (was 0.25) | 8 | high |
| 15 | partial | `critical`: ratio >= **0.4** (was 0.5) | 12 | high |
| 15 | partial | `warning`: ratio >= **0.15** (was 0.2) | 12 | high |

## service-mesh-health-router

| round | kind | sentence (first 120 chars) | earlier_round | conf |
|---|---|---|---|---|
| 3 | revise | When multiple endpoints share the same active-connection count, they should be preferred by weight (higher weight wins), | 1 | high |
| 4 | revise | Update the `data-store` service config to use `connection_limit_mode = "per-service"`. | 1 | high |
| 4 | revise | Its `max_connections_per_endpoint` is 3, so data-store now allows at most 3 simultaneous connections in total (spread ac | 1 | high |
| 6 | partial | When a connection times out waiting in the rate limiter queue, it currently increments only `queue_timeouts`. It should  | 2 | high |
| 8 | revise | The half_open state currently allows exactly one probe connection at a time. Change it to allow a configurable batch of  | 1 | high |
| 8 | revise | This replaces the previous single-probe logic. | 1 | medium |

## sparse-iterative-pde-solver

| round | kind | sentence (first 120 chars) | earlier_round | conf |
|---|---|---|---|---|
| 2 | revise | **Both CG and GMRES must now report the true relative residual**, computed as `\|\|b - A*x_final\|\| / \|\|b\|\|`, not j | 1 | high |
| 2 | revise | Each line must now contain two tab-separated values: `<iteration_number>\t<true_relative_residual>`. | 1 | high |
| 4 | revise | The convergence history file format specified in round 2 (tab-separated `<iteration>\t<true_relative_residual>`) is now  | 2 | high |
| 6 | revise | The residual norms reported by all iterative solvers (`sparse-solve`, `poisson`, `convdiff`, `heat`) change from the 2-n | 2 | high |
| 6 | revise | `residual:` output line changes from `\|\|b - A*x\|\|_2 / \|\|b\|\|_2` to `\|\|b - A*x\|\|_inf / \|\|b\|\|_inf` | 2 | high |
| 7 | revise | The 3-column convergence history format specified in round 4 is replaced with a **4-column** format: | 4 | high |

## sparse-iterative-solver-review

| round | kind | sentence (first 120 chars) | earlier_round | conf |
|---|---|---|---|---|
| 3 | revise | After the solver loop finishes, explicitly recompute the true residual as `\|\|b - A * x\|\|_2 / \|\|b\|\|_2` using the  | 1 | high |
| 3 | revise | The `converged` field must also be based on the true residual (yes if and only if the true residual is below tolerance). | 1 | high |
| 3 | revise | Instead, detect `\|\|b\|\|_2 == 0` before calling the solver and immediately output the zero solution | 1 | low |
| 3 | revise | In both the forward and backward sweeps of SSOR, if the diagonal entry for a row is zero, set the corresponding output c | 1 | low |
| 4 | revise | RCM should handle disconnected graphs consistently: | 1 | low |
| 5 | revise | Numerical issues during solving (non-positive-definite detection, BiCGSTAB breakdown) should produce a partial result ra | 2 | high |
| 5 | revise | **CG non-positive-definite detection must produce partial output instead of exiting.** | 2 | high |
| 5 | revise | **BiCGSTAB breakdown must produce partial output instead of exiting.** | 2 | high |
| 5 | revise | **IC(0) non-positive pivot must fall back instead of exiting.** | 2 | high |

## Summary

| task | rounds>=2 | revise | withdraw | partial | low-confidence | total |
|---|---|---|---|---|---|---|
| buildctl-pipeline-orchestrator | 7 | 2 | 0 | 1 | 0 | 3 |
| deterministic-data-pipeline-go | 14 | 14 | 4 | 0 | 0 | 18 |
| eventq-pipeline | 12 | 10 | 0 | 4 | 5 | 14 |
| flowctl-pipeline-wiring | 8 | 7 | 0 | 2 | 0 | 9 |
| flowr-workflow-orchestrator | 6 | 2 | 0 | 4 | 0 | 6 |
| forgekit-monorepo-build-pipeline | 7 | 3 | 0 | 2 | 1 | 5 |
| gomlops-platform-modernization | 6 | 12 | 0 | 2 | 0 | 14 |
| hermetic-build-artifact-verifier | 6 | 7 | 0 | 2 | 0 | 9 |
| jobforge-dag-runner | 8 | 4 | 0 | 0 | 0 | 4 |
| lsm-kvstore-engine | 7 | 3 | 0 | 1 | 0 | 4 |
| minicc-compiler-evolution | 7 | 6 | 0 | 0 | 3 | 6 |
| ml-checkpoint-forensics-engine | 8 | 6 | 0 | 7 | 0 | 13 |
| ml-checkpoint-reproducibility-engine | 7 | 8 | 0 | 0 | 0 | 8 |
| ml-eval-report-engine | 6 | 6 | 0 | 1 | 0 | 7 |
| mlops-inference-gateway | 7 | 1 | 0 | 0 | 1 | 1 |
| mlpipe-dag-orchestrator | 6 | 6 | 0 | 0 | 0 | 6 |
| mlpipe-inference-pipeline-migration | 12 | 2 | 0 | 1 | 0 | 3 |
| mlpipe-orchestrator | 6 | 11 | 0 | 2 | 1 | 13 |
| multiservice-deploy-pipeline | 10 | 5 | 0 | 0 | 0 | 5 |
| nexus-ml-pipeline-system | 7 | 2 | 0 | 1 | 2 | 3 |
| numeriforge-reproducibility-migration | 7 | 5 | 0 | 1 | 0 | 6 |
| repro-verify-engine | 6 | 4 | 0 | 0 | 1 | 4 |
| secaudit-log-sentinel | 14 | 6 | 0 | 5 | 0 | 11 |
| service-mesh-health-router | 7 | 5 | 0 | 1 | 0 | 6 |
| sparse-iterative-pde-solver | 6 | 6 | 0 | 0 | 0 | 6 |
| sparse-iterative-solver-review | 4 | 9 | 0 | 0 | 3 | 9 |
| **TOTAL** | 201 | 152 | 4 | 37 | 17 | 193 |

## Method and limits

- Reading: all 26 files were read in full (every round >= 2 `md`, no truncation), by me directly (no regex-only labelling). The helper `revision-samples.json` was not used for labelling. After labelling, a cue-word scan (previously/instead of/no longer/replaced/now/was ...) was run per task to catch misses; the residue was reviewed and a few items added.
- Tasks incomplete: none. All 26 tasks (the 9 priority tasks first) were covered.
- Round 1 was consulted only to locate `earlier_quote` / `earlier_round`; round-1 sentences are never labelled.
- Rules used for ambiguity: (1) a sentence counts only if it changes a rule stated in an EARLIER round; self-corrections inside the same round (e.g. secaudit R2 "Freshness Tiers (replaces binary TTL)", eventq R9 section 7 vs 9.2) are not labelled. (2) Pure additions, new flags, new fields on new commands, and restatements are excluded. (3) kind=partial for a changed value/threshold/field/message/format detail with the rule kept; revise when the rule itself is replaced; withdraw only for removed behaviour (only dpipe R5 sidecars qualify). (4) When one change is stated several times in a round, the main statement is high confidence and repeats are kept at medium/low with a note. (5) Opt-in policy variants that say "replaced/override" but leave the default unchanged (eventq dedup-policy first-arrival, session-policy fixed-window, summary-time-range-policy observed; nexus allow_failure; digest rotation) are labelled low confidence. (6) Bug-fix rounds are labelled only when the text states the old rule and the new rule differs from it (e.g. ml-checkpoint-reproducibility R5/R7/R8); fixes that merely make code conform to an already-stated rule (forgekit R3 bugs 2-3, forgekit R7 bugs 2-3, mlpipe-orchestrator R7 ensemble sort) are excluded. (7) Where the earlier round points to an external doc (/app/docs, spec_vN.md) the old value is not in the source, so earlier_quote is null and earlier_round is the nearest round (usually 1); these are noted.
- Limits: earlier_round for rules defined only in an unseen external spec is a best guess; low-confidence rows are judgement calls; sentences with multiple clauses are copied whole (longest is 251 chars, none truncated); eventq/flowr/flowctl are dominated by additive features, so counts there are low by design, not by omission.

### 10 spot-checks re-verified against the source (random sample, seed 7)

| # | task | round | kind | check |
|---|---|---|---|---|
| 1 | lsm-kvstore-engine | 5 | revise | sentence found in R5 md: yes; quote ok in R1 |
| 2 | flowctl-pipeline-wiring | 6 | revise | sentence found in R6 md: yes; quote ok in R2 |
| 3 | ml-checkpoint-forensics-engine | 7 | partial | sentence found in R7 md: yes; no earlier quote |
| 4 | secaudit-log-sentinel | 10 | revise | sentence found in R10 md: yes; quote ok in R8 |
| 5 | deterministic-data-pipeline-go | 5 | revise | sentence found in R5 md: yes; quote ok in R1 |
| 6 | deterministic-data-pipeline-go | 12 | revise | sentence found in R12 md: yes; quote ok in R2 |
| 7 | mlpipe-orchestrator | 5 | revise | sentence found in R5 md: yes; quote ok in R1 |
| 8 | eventq-pipeline | 4 | revise | sentence found in R4 md: yes; quote ok in R1 |
| 9 | ml-checkpoint-forensics-engine | 2 | partial | sentence found in R2 md: yes; no earlier quote |
| 10 | nexus-ml-pipeline-system | 3 | partial | sentence found in R3 md: yes; quote ok in R1 |
