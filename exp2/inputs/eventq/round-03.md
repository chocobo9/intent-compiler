# Deterministic Audit Log

Extend `eventq ingest` with an optional per-event **audit log** that records the classification decision for every current-run event in arrival order. This is a new output file that enables forensic replay without re-running the pipeline. Everything from existing base and stateful behavior still holds: same input formats, same validation/watermark/dedup/chargeback pipeline, same arrival-stream ordering, same state file semantics, same byte-for-byte `--output`/`--rejects`/`--state-out` invariants when `--audit-log` is absent.

## New flag

```
eventq ingest --input-dir <dir> --rates <path> --output <path> --rejects <path> \
              --session-gap <seconds> --watermark-lag <seconds> \
              [--state-in <path>] [--state-out <path>] [--pending-ttl <seconds>] \
              [--max-open-sessions <int>] [--audit-log <path>]
```

- `--audit-log <path>` is optional. When supplied, the pipeline writes an NDJSON file at that path containing exactly one JSON object per current-run event (carry-over entries from `state.pending_purchases` are NEVER recorded — they belong to prior runs).
- When omitted, no audit file is created, and none of the other outputs changes in any way. Behavior is byte-for-byte identical to stateful ingest without `--audit-log`.
- `--audit-log` is independent of `--state-in`/`--state-out`. It may be used on a pure default base behavior run (no state) or on any stateful configuration.
- Writing `--audit-log` uses the same atomicity rule as `--state-out`: build the payload in memory, write to `<audit-log>.tmp`, then rename. If the run exits non-zero for any reason, `<audit-log>.tmp` must not exist afterward and `<audit-log>` must be unchanged.
- `--audit-log` and `--state-out` may point to different directories; neither is implied by the other.

## File format

The audit log is **newline-delimited JSON (NDJSON)**: one JSON object per line, no leading/trailing blank lines, file terminated by exactly one `\n`. Each object's keys appear in a fixed order (see below). Objects are emitted in the **current run's arrival stream order** (default base behavior `(shard_name, line_index)` order) — the same order used by `--rejects`. This is true regardless of bucket: accepted and rejected events interleave by their original arrival position.

### Record shape per bucket

Every record has these base keys, in this exact order:

1. `id` — the event's `id` string. Present even for schema-invalid events when the `id` field is a string; if the event lacks `id` or it is not a string, emit `null`.
2. `ts` — the event's `ts` string as it appeared in the input (no normalization), or `null` if missing/non-string.
3. `type` — the event's `type` string, or `null` if missing/non-string.
4. `shard` — the shard (file) name without directory prefix, e.g. `"a.ndjson"`.
5. `line` — the 1-based line number within that shard.
6. `bucket` — exactly one of the strings `"accepted"`, `"invalid"`, `"late"`, `"duplicate"`, `"unresolved_chargeback"`.

After `bucket`, bucket-specific keys appear in the orders shown below:

#### `bucket: "accepted"`

```
{"id": "...", "ts": "...", "type": "...", "shard": "...", "line": N, "bucket": "accepted",
 "usd": <number>, "session_index": <int>, "resolved_against": <"current_run"|"carry_over"|null>}
```

- `usd`: the USD amount that contributed to aggregates — for purchases and refunds, the FX-converted value (same two-decimal half-away-from-zero rule as default base behavior); for chargebacks (whether resolved same-run or carry-over), exactly `0.00`; for non-monetary events (login/signup), `0.00`.
- `session_index`: the 1-based session index assigned to this event within its user's current-run session sequence (honoring open-session carry-over rules from stateful ingest — so if the user's FIRST current-run surviving event extended a carried session, its `session_index` is the carried `C.session_index`). Non-monetary events DO participate in sessionization and therefore have a `session_index`. Events whose `user_id` is missing or empty exit as `invalid` (bucket 1), so `session_index` is not applicable there.
- `resolved_against`:
  - `"current_run"` if this is a chargeback that was resolved against an earlier-in-arrival surviving purchase from the same run.
  - `"carry_over"` if this is a chargeback that was resolved against an entry in `state.pending_purchases[]`.
  - `null` for any non-chargeback accepted event.

#### `bucket: "invalid"`

```
{"id": ..., "ts": ..., "type": ..., "shard": "...", "line": N, "bucket": "invalid",
 "reason": "<code>"}
```

`reason` is a short fixed-vocabulary code drawn from this closed set (pick the FIRST matching check in this order):

1. `"schema_version"` — missing `v`, `v` not an integer, or `v` not in `{1, 2}`.
2. `"missing_id"` — `id` missing or not a non-empty string.
3. `"missing_ts"` or `"bad_ts"` — `ts` missing / not string / not parseable as `YYYY-MM-DDTHH:MM:SSZ`.
4. `"missing_type"` or `"bad_type"` — `type` missing / not a string / not one of `purchase`, `refund`, `chargeback`, `login`, `signup` (the base valid-type set).
5. `"missing_user"` — `user_id` missing or empty.
6. `"missing_amount"` or `"bad_amount"` — purchase/refund whose amount field (v1 `amount`, v2 `amount_cents`) is missing or numerically invalid. This follows the default base behavior numeric rules: v1 `amount` is invalid if it is not a finite JSON number or is negative; v2 `amount_cents` is invalid if it is not a non-negative integer JSON number.
7. `"missing_currency"` or `"bad_currency"` — purchase/refund with missing currency, or currency present but not a non-empty string.
8. `"missing_ref_id"` — chargeback with missing or non-string (or empty-string) `ref_id`.
9. `"fx_lookup"` — amount+currency valid at JSON level but no day-rate entry exists for the (date, currency) pair (same base rule that sends the event to `invalid`).

Use the first failing check in the order above. If multiple issues exist, the earlier one wins.

#### `bucket: "late"`

```
{"id": "...", "ts": "...", "type": "...", "shard": "...", "line": N, "bucket": "late",
 "cutoff": "<ts>"}
```

`cutoff` is the effective `seeded_max_ts - watermark_lag` threshold (ISO `YYYY-MM-DDTHH:MM:SSZ`) used when classifying this event. Note: the cutoff is a moving target — it equals `state.watermark.max_ts - watermark_lag` if loaded, otherwise `max_ts_seen_so_far - watermark_lag` updated as events are processed. For each late event, emit the cutoff that was in force **at the moment the late decision was made**.

#### `bucket: "duplicate"`

```
{"id": "...", "ts": "...", "type": "...", "shard": "...", "line": N, "bucket": "duplicate",
 "reason": <"same_run"|"cross_run">}
```

- `"same_run"` means another event with the same `id` arrived earlier in the current run and won the tie-break (base rule).
- `"cross_run"` means `id` was present in `state.seen_ids` from a prior run.

If both apply (id is in `state.seen_ids` AND there is a same-run duplicate loser), emit `"cross_run"` for EVERY occurrence in the current run — the `state.seen_ids` check supersedes the same-run tie-break. (Rationale: once an id is cross-run-known, there is no "winner" in the current run at all; every instance is rejected for the same reason.)

#### `bucket: "unresolved_chargeback"`

```
{"id": "...", "ts": "...", "type": "...", "shard": "...", "line": N, "bucket": "unresolved_chargeback",
 "ref_id": "<string>"}
```

`ref_id` is the chargeback's `ref_id` verbatim from the input.

## Ordering within the file

- Lines appear in the current run's arrival stream order (`(shard_name lex asc, line_index asc)`).
- Within a single shard, order is strictly by input line number.
- Across shards, shard names are sorted lexicographically ascending.
- Accepted and rejected events interleave naturally — no grouping by bucket.
- If a current-run event is rejected as schema-invalid **after the line has been parsed as a JSON object** (for example, it has object syntax but fails field validation), it still appears in the audit log with `bucket: "invalid"` and the appropriate `reason` code. The fields `id`, `ts`, `type` fall back to `null` if they are missing or cannot be read as strings.
- If an input line is not a parseable JSON object at all (for example, malformed JSON text or a non-object top-level JSON value), skip it — do NOT emit an audit record for it. (This matches the original treatment of such lines.)

## Formatting rules

- Each line is a single JSON object with no embedded newlines. Keys appear in the exact order described per bucket above.
- Number formatting:
  - `usd` uses exactly two decimal places with half-away-from-zero rounding (same as base money). Positive amounts include no leading sign; `0.00` is `0.00` (not `-0.00`).
  - `line` is emitted as a bare integer.
- String escaping is standard JSON (`\"`, `\\`, `\n` etc.). `ts`, `cutoff`, and user-supplied `ref_id` values pass through without transformation.
- No trailing whitespace on any line. Exactly one `\n` terminates each line including the last.
- Keys not listed above must NOT appear. Optional keys are not omitted when applicable — e.g., a non-chargeback accepted event still emits `resolved_against: null` (not absent).

## Interaction with state and stats

- The audit log's content depends only on the current-run events and the loaded state (for dedup/carry-over/watermark seeding decisions). It does NOT reference the post-run state.
- `state_stats` in `--output` is unchanged — no new keys are added in the audit-log feature.
- The audit log does NOT affect `--output`, `--rejects`, or `--state-out` bytes. Running with and without `--audit-log` must produce identical bytes for those three files.
- Determinism: with identical inputs (input-dir, rates, state-in) and flags, the audit log is byte-identical across runs.

## Empty-file edge case

If the current run's `--input-dir` contains no parseable events whatsoever (e.g., empty shard files, or shards containing only blank lines), the audit file is created as an **empty file** (zero bytes, no trailing `\n`). The `.tmp`/rename atomicity still applies.

If `--input-dir` has events but every single one is skipped because it isn't a JSON object at all, the audit file is also zero bytes. If at least one event is a valid JSON object, the file has at least one line terminated by `\n`.

## Usage-error rules

- `--audit-log` with no argument value, or pointing to a path whose parent directory does not exist, exits `2` with the existing usage-error string.
- If `<audit-log>.tmp` exists from a prior crashed run, it may be overwritten — no special guard is required.

## Consistency with existing behavior

- Without `--audit-log`, `eventq ingest` behaves identically to stateful ingest for every input, including byte-for-byte `--output`/`--rejects`/`--state-out`.
- With `--audit-log` and no state flags, the audit log is the only new output; `--output` is byte-identical to default base behavior (no `state_stats`); `--rejects` is byte-identical to default base behavior.

These are invariants — violating any means the implementation is wrong.

## Audit digest (the audit-log feature extension)

`--audit-log-digest <path>` is a new optional flag that emits a **sidecar JSON summary** of the audit log. It is strictly additive: when absent, behavior is byte-for-byte identical to the audit-log feature default behavior (everything above still holds). When present, a single summary file is produced alongside `--audit-log`.

### Flag rules

- `--audit-log-digest <path>` is optional.
- `--audit-log-digest` REQUIRES `--audit-log` to also be supplied. Using `--audit-log-digest` without `--audit-log` is a usage error: exit code `2` with the existing usage-error string, and no output files (including the digest) are created.
- `--audit-log` without `--audit-log-digest` is unchanged the audit-log feature behavior — no digest file is produced.
- `--audit-log-digest` with no argument value, or pointing to a path whose parent directory does not exist, exits `2` with the existing usage-error string.

### File format

When both flags are supplied, the digest file contains a single pretty-printed JSON object with **2-space indentation**, terminated by exactly one `\n`. The keys appear in this exact order:

```
{
  "audit_log": "<basename of --audit-log path>",
  "total_records": <int>,
  "bucket_counts": {
    "accepted": <int>,
    "invalid": <int>,
    "late": <int>,
    "duplicate": <int>,
    "unresolved_chargeback": <int>
  },
  "invalid_reasons": { <code>: <int>, ... },
  "duplicate_reasons": {
    "same_run": <int>,
    "cross_run": <int>
  },
  "resolved_against": {
    "current_run": <int>,
    "carry_over": <int>,
    "null": <int>
  },
  "sha256": "<lowercase hex sha256 of the audit file bytes>"
}
```

The top-level key order is:

1. `audit_log`
2. `total_records`
3. `bucket_counts`
4. `invalid_reasons`
5. `duplicate_reasons`
6. `resolved_against`
7. `sha256`

- `audit_log`: the basename (no directory prefix) of the `--audit-log` path.
- `total_records`: the number of NDJSON records actually written to the audit file (zero if the audit file is zero bytes).
- `bucket_counts`: exactly these five keys in THIS ORDER (`accepted`, `invalid`, `late`, `duplicate`, `unresolved_chargeback`), each a non-negative integer. A bucket with zero records still has its key present with value `0`.
- `invalid_reasons`: one key per invalid `reason` code that actually occurred in the audit log, sorted by key ascending. Codes that did not occur MUST NOT appear. If there are no invalid records, this object is `{}`.
- `duplicate_reasons`: exactly two keys, always present in this order (`same_run`, `cross_run`). Zero values are kept.
- `resolved_against`: exactly three keys, always present in this order (`current_run`, `carry_over`, `null`). The `null` key counts accepted records whose `resolved_against` was JSON null (i.e., non-chargebacks). Zero values are kept.
- `sha256`: lowercase 64-hex-char SHA-256 of the FINAL bytes written to `--audit-log` (i.e. the post-rename file). If the audit log is zero bytes, this is `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` (sha256 of the empty byte string).

### Atomicity & independence

- The digest is written using the same `.tmp` + rename atomicity as `--audit-log` and `--state-out`. If the run exits non-zero, neither `<digest>` nor `<digest>.tmp` exists afterward.
- The digest file is written AFTER `--audit-log` has been fully renamed into place, so its `sha256` matches the final on-disk audit file.
- The digest is strictly additive: `--output`, `--rejects`, `--state-out`, and `--audit-log` bytes are UNCHANGED whether or not `--audit-log-digest` is supplied.
- Determinism: byte-identical across runs with the same inputs and flags.

### Empty-file edge case

- If the audit log is zero bytes (empty input, or no parseable JSON objects), the digest is still emitted. All bucket counts are zero, `invalid_reasons` is `{}`, `duplicate_reasons` has both keys zero, `resolved_against` has all three keys zero, `total_records` is `0`, and `sha256` is the sha256 of empty bytes.
