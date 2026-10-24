# Configurable Dedup Policy

Same-run duplicate handling now has an explicit policy selector:
`--dedup-policy <first-arrival|lex-largest-ts>`. The default keeps the existing
winner rule: the lexicographically largest `ts` wins, with arrival order used
as the tie-breaker. The `first-arrival` policy deliberately chooses the event
with the smallest `(shard_basename, line_index)` in the duplicate group,
ignoring `ts` for winner selection.

This means a duplicate group with increasing timestamps across arrival order
can produce different surviving events under the two policies, while runs that
omit the flag keep the existing on-disk behavior.

`eventq ingest` accepts a single new flag, `--dedup-policy`, whose
two legal values select two mutually-exclusive duplicate-winner rules. All
other existing invariants still hold when the flag is absent or set to
`lex-largest-ts`.

## 1. Flag syntax

```
eventq ingest ... [--dedup-policy <first-arrival|lex-largest-ts>]
```

- The flag is **optional**. When omitted, the effective value is
  `lex-largest-ts`, the default base behavior default.
- The flag value is a single string chosen from the closed set
  `{first-arrival, lex-largest-ts}`. No other syntax is accepted.
- Unknown values (including the empty string, prefixes like `first`, or
  otherwise valid-looking tokens like `FirstArrival`) are a usage error:
  exit code `2`, no output files created, and the following exact line
  written to stderr:

  ```
  ingest: --dedup-policy: must be one of {first-arrival, lex-largest-ts}
  ```

- `--dedup-policy` with no argument value (e.g. `--dedup-policy` as the final
  token) is also a usage error and must exit `2`; Go's flag parser will naturally
  emit its own usage error in that case. The exact stderr line for the empty/
  missing value case is not part of the portable contract.
- `--dedup-policy` composes freely with every existing flag; it is
  independent of state, audit log, manifest, rates strictness, FX staleness,
  etc.

## 2. Semantic rule under `--dedup-policy lex-largest-ts` (default, backwards-compat)

the existing dedup contract is preserved **verbatim**:

- Within a duplicate group (events sharing the same `id` after schema+FX
  validation and watermark admission), the winner is the event with the
  **lexicographically largest `ts`**.
- If two events tie on `ts`, the earlier in the run's arrival order
  (`(shard_basename ascending, line_index ascending)`) wins.
- Losers are appended to the `--rejects` file in arrival order (duplicate
  bucket), and appear with `bucket=duplicate` in the audit log.

This means: **for every pre-existing existing input, omitting `--dedup-policy`
or passing `--dedup-policy lex-largest-ts` must produce byte-for-byte identical
`--output`, `--rejects`, `--state-out`, `--audit-log`, `--audit-log-digest`, and
`--out-parquet-manifest` vs. the manifest feature default behavior.** This is a *strict*
invariant and existing inputs must remain byte-for-byte compatible.

## 3. Semantic rule under `--dedup-policy first-arrival` (CONFLICT path)

When `--dedup-policy first-arrival` is supplied, the winner-selection rule is
replaced in full:

- Within a duplicate group, the winner is the event with the **smallest
  `(shard_basename, line_index)`** tuple in the current run's arrival stream.
  Equivalently, the winner is the earliest arrival (by the same ordering
  already used everywhere else in the pipeline).
- `ts` is **not consulted at all** for winner selection under first-arrival.
- If two duplicates somehow share the same `(shard_basename, line_index)` —
  which is impossible for distinct lines in the same shard, and impossible
  across shards because shard names are unique — this cannot occur; tie-break
  is a total order.
- All losers are appended to `--rejects` in arrival order (duplicate bucket),
  exactly as before. The rejects-file contract from default base behavior is unchanged.
- The cross-run dedup check (against `state.seen_ids`) is **unchanged**: any
  current-run event whose `id` is present in `state.seen_ids` is still
  rejected as `duplicate` with `reason: "cross_run"` regardless of the
  `--dedup-policy` value. The policy flag affects ONLY the same-run
  tie-breaker between multiple current-run events that share an `id`.

### 3.1 Effect on `--output`

Aggregate totals (`total_events`, `by_type.*`, `by_hour.*`, `sessions.*`,
`time_range`, `anomalies.duplicate`) are computed from the new survivor set. In
particular:

- `anomalies.duplicate` counts the number of same-run and cross-run duplicate
  losers, as before — the **count is unchanged** between the two policies for
  the same input (the size of each duplicate group is the same; only which
  member is the winner differs). Cross-run duplicates (matched against
  `state.seen_ids`) are unaffected by the policy flag.
- If the winner chosen by `first-arrival` differs from the winner chosen by
  `lex-largest-ts`, then `total_events`, `unique_users` and the per-type /
  per-hour monetary sums may differ (because the surviving event's `ts`,
  hour, and USD amount can differ across members of a duplicate group).

### 3.2 Effect on `--rejects`

The reject file still has the default base behavior four-bucket layout (invalid, late,
duplicate, unresolved_chargeback) in arrival order within each bucket. Under
`first-arrival`, the raw lines that end up in the duplicate bucket are the
**non-winners** of each duplicate group under the new rule — typically the
opposite set from the lex-largest-ts rule.

### 3.3 Effect on `--audit-log`

- Audit-log records are still emitted in arrival order, one per current-run
  input event, with the same bucket vocabulary.
- For records that end up in `bucket: "duplicate"` with `reason: "same_run"`
  **AND** the run was executed with `--dedup-policy first-arrival`, each such
  record MUST carry a new key `winner_arrival` positioned **immediately after**
  the existing `reason` key. The value is a JSON object with exactly two keys
  in this order: `shard` (string, the winning record's shard basename) and
  `line` (1-based integer, the winning record's line number within that shard).
  The winner for each `reason: "same_run"` record is the duplicate-group
  survivor under the first-arrival rule.
- Under `--dedup-policy lex-largest-ts` (and under the default), the
  `winner_arrival` key MUST NOT appear on any audit record, for any bucket.
  This preserves byte-for-byte compatibility with the manifest feature audit-log output on
  any existing input.
- `winner_arrival` is NOT emitted on `reason: "cross_run"` duplicates (those
  have no current-run winner to report).
- `winner_arrival` is NOT emitted on any non-duplicate bucket.

Updated duplicate-record shape (under `first-arrival`, for same-run dupes):

```
{"id": "...", "ts": "...", "type": "...", "shard": "...", "line": N, "bucket": "duplicate",
 "reason": "same_run", "winner_arrival": {"shard": "<shard>", "line": <int>}}
```

Cross-run duplicate-record shape (always, regardless of policy):

```
{"id": "...", "ts": "...", "type": "...", "shard": "...", "line": N, "bucket": "duplicate",
 "reason": "cross_run"}
```

### 3.4 Effect on `--audit-log-digest`

The `duplicate_reasons` object is unchanged: exactly two keys `same_run` and
`cross_run`, always present, integer counts. Any new data visible only on
duplicate records (`winner_arrival`) is intentionally NOT surfaced in the
digest — the digest remains a histogram, not a replay of per-record content.
As a consequence, the digest's `sha256` still equals the SHA-256 of the audit
log's on-disk bytes, which IS different between the two policies when the
audit log contains any first-arrival `winner_arrival` keys.

#### 3.4.1 New block: `dedup_policy_stats`

When the run is invoked with `--audit-log-digest`, `--audit-log`, AND
`--dedup-policy` (either value), the digest JSON gains a new sub-object keyed
`dedup_policy_stats`, positioned **after** `resolved_against` and **before**
`sha256`. The block is ALWAYS emitted (all four sub-keys present) regardless
of whether any duplicates occurred in the run. Shape:

```
"dedup_policy_stats": {
  "policy": "first-arrival" | "lex-largest-ts",
  "duplicate_winners_same_shard": <int>,
  "duplicate_winners_cross_shard": <int>,
  "duplicate_winners_line_tiebreak": <int>
}
```

Semantics per sub-key:

- `policy`: literal string echo of the active `--dedup-policy` value.
- `duplicate_winners_same_shard`: number of duplicate groups (same-run groups
  of size >= 2) whose members all share a single shard basename.
- `duplicate_winners_cross_shard`: number of duplicate groups whose members
  span two or more distinct shard basenames.
- `duplicate_winners_line_tiebreak`: number of duplicate groups whose winner
  was resolved by line-number tie-break within a single shard. Under
  `first-arrival`, this equals `duplicate_winners_same_shard` (every
  same-shard group of size >= 2 necessarily uses line number to pick the
  winner). Under `lex-largest-ts`, this counts only groups where the winning
  `ts` was tied and the surviving member was therefore chosen by the existing
  arrival-order tie-break; groups whose winner was decided by a strictly
  larger `ts` contribute `0`.

Key ordering of the digest becomes:

```
audit_log, total_records, bucket_counts, invalid_reasons, duplicate_reasons,
resolved_against, dedup_policy_stats, fx_fallback_stats, rates_digest, sha256
```

When `--dedup-policy` is omitted, the digest is byte-identical to the manifest feature
default behavior (no `dedup_policy_stats` key, preserving the manifest feature key order).

### 3.5 Effect on `--state-out`

- `state.seen_ids` is still the union of all ids that passed validation +
  watermark admission in the current run (winners AND same-run losers), sorted
  ascending. The policy does not change which ids reach the dedup gate, only
  which event in a duplicate group is the winner, so `seen_ids` is **identical**
  between the two policies for the same input.
- `state.pending_purchases` is rebuilt from the *surviving* purchases only.
  Because the surviving purchase in a duplicate group can differ between the
  two policies (different `ts`, different USD), `pending_purchases` entries
  CAN differ (by `ts`, `usd`, and `origin_run` for new rows). This is
  expected and part of the explicit policy divergence.
- `state.watermark.max_ts` is the maximum `ts` admitted past the watermark
  in the current run. Because losers still advance the watermark (they pass
  validation before dedup runs), `max_ts` is unchanged between the two
  policies for the same input.
- `state.open_sessions` is rebuilt from surviving events per stateful ingest §4; its
  contents can differ if the winner event has a different `ts` or `user`.
- `state.run_index` is unchanged in semantics (monotonic per run).

### 3.6 Effect on `--rejects` extended trailing columns (first-arrival only)

the existing rejects-ordering contract writes each rejected entry as the original raw input
line followed by exactly one `\n`. That contract is preserved verbatim under
`--dedup-policy lex-largest-ts` (and when `--dedup-policy` is omitted): each
line in `--rejects` remains the unmodified raw input bytes plus a single
trailing `\n`, and the file is byte-for-byte identical to the manifest feature default behavior.

Under `--dedup-policy first-arrival`, every line written to `--rejects` gains
exactly **two new tab-separated trailing columns**, appended after the raw line
and before the trailing `\n`. The on-disk shape of one rejects entry becomes:

```
<raw_input_line>\t<winner_shard>\t<winner_line>\n
```

where:

- `<raw_input_line>` is the original input bytes for the rejected event,
  unchanged.
- `<winner_shard>` and `<winner_line>` are populated as follows, depending on
  which of the four buckets the reject belongs to:

  - **Duplicate bucket (same-run loser):** `<winner_shard>` is the bare shard
    basename of the duplicate-group winner under the first-arrival rule;
    `<winner_line>` is the **1-based** line number of that winner inside its
    shard. These match the `winner_arrival.shard` / `winner_arrival.line`
    values written in the audit log for the same record (§3.3).
  - **Duplicate bucket (cross-run loser, `reason: "cross_run"`):** there is no
    current-run winner to point at, so both columns are the literal single
    dash `-`. The line ends `\t-\t-\n`.
  - **Invalid, late, and unresolved-chargeback buckets:** there is no winner
    concept at all; both columns are the literal single dash `-`. The line
    ends `\t-\t-\n`.

The two trailing columns are always present on every line of `--rejects` when
the run was invoked with `--dedup-policy first-arrival`, even on runs that
contain no duplicates at all (in which case every line ends `\t-\t-\n`). When
`--rejects` is empty (no rejects of any bucket), the file remains empty zero
bytes regardless of policy.

The raw input line is emitted verbatim and is not escaped; in normal NDJSON
input it contains no embedded tab characters, so consumers can split on `\t`
to recover three fields: the raw JSON, the winner shard (or `-`), the winner
line number (or `-`).

The reject ordering across the four buckets (invalid → late → duplicate →
unresolved_chargeback, arrival order within each bucket) is unchanged. This
section adds two trailing columns per line; it does not reorder anything.

Determinism still holds: under any fixed input + flag set, repeated runs
produce byte-identical `--rejects` (§4).

### 3.7 Effect on `--out-parquet-manifest`

- Per-shard `events_accepted` reflects whichever events survived under the
  active policy; `events_total` is unchanged.
- `window.min_ts` / `window.max_ts` reflect the surviving set, so they can
  differ between policies.
- `window.bucket_counts.duplicate` is unchanged between policies (same
  duplicate-group sizes); `bucket_counts.accepted` is unchanged in count;
  only the identity of accepted vs. rejected events inside a duplicate group
  shifts.
- `rates_digest` is unchanged.
- `outputs.*.sha256` and `outputs.*.bytes` reflect the final bytes of each
  downstream output, which CAN differ between the two policies.

## 4. Determinism

Given identical `--input-dir`, `--rates`, `--session-gap`, `--watermark-lag`,
any `--state-in`, and any `--dedup-policy` value, every output file
(`--output`, `--rejects`, `--state-out`, `--audit-log`, `--audit-log-digest`,
`--out-parquet-manifest`, `--manifest-signature`) is byte-identical across
repeated runs. Shard iteration, duplicate-group traversal, and audit-record
emission are all totally-ordered by (shard, line_index). No map iteration is
exposed in any output.

## 5. Back-compat invariants (strict)

For every existing pre-policy input:

- Omitting `--dedup-policy` → byte-identical `--output`, `--rejects`,
  `--state-out`, `--audit-log`, `--audit-log-digest`,
  `--out-parquet-manifest`, and `--manifest-signature` vs. the manifest feature
  CLI.
- Passing `--dedup-policy lex-largest-ts` → **identical** to omitting it.
- Passing `--dedup-policy first-arrival` → a possibly-different result. The
  exact divergence is observable only on inputs that contain at least one
  same-run duplicate group whose `lex-largest-ts` winner and `first-arrival`
  winner differ.

the dedup-policy feature does NOT add any new key to `--output`, `--state-out` top-level, or
`--out-parquet-manifest` top-level. The output
surfaces that change shape under `--dedup-policy first-arrival` are:

- `--audit-log` — each same-run-duplicate record gains a `winner_arrival`
  sub-object (§3.3).
- `--audit-log-digest` — when the run is invoked with `--audit-log`,
  `--audit-log-digest`, and an explicit `--dedup-policy` value, the digest
  gains the top-level `dedup_policy_stats` block (§3.4.1).
- `--rejects` — every line gains two trailing tab-separated columns
  `\t<winner_shard>\t<winner_line>` (§3.6). The two columns are populated
  with the duplicate-group winner's shard + 1-based line for same-run
  duplicate losers, and the literal `\t-\t-` for every other bucket
  (invalid, late, cross-run duplicate, unresolved chargeback).

Both surfaces remain byte-identical to the manifest feature default behavior whenever
`--dedup-policy` is omitted or set to `lex-largest-ts`.

## 6. Tie-break examples

### 6.1 Cross-shard tie-break (shard basename wins)

Shard `a.ndjson` line 1 and shard `b.ndjson` line 1 share the same `id`.
`first-arrival` winner = `a.ndjson:1` (smaller shard basename).

### 6.2 Within-shard tie-break (line number wins)

Shard `a.ndjson` has the same `id` on lines 1 and 5. `first-arrival` winner =
`a.ndjson:1` (smaller line).

### 6.3 Policy-divergent example

Shard `a.ndjson` line 1: `{"id":"X","ts":"2026-03-01T10:00:00Z", ...}`
Shard `a.ndjson` line 2: `{"id":"X","ts":"2026-03-01T11:00:00Z", ...}`

- `lex-largest-ts` winner = line 2 (ts `11:00:00` > `10:00:00`). Line 1 is a
  duplicate loser.
- `first-arrival` winner = line 1 (line 1 < line 2). Line 2 is a duplicate
  loser.

The `anomalies.duplicate` count is `1` in both cases; the survivor identity
differs.

## 7. Usage

```
eventq ingest --input-dir <dir> --rates <path> --output <path> --rejects <path> \
              --session-gap <seconds> --watermark-lag <seconds> \
              [--state-in <path>] [--state-out <path>] [--pending-ttl <seconds>] \
              [--max-open-sessions <int>] \
              [--audit-log <path>] [--audit-log-digest <path>] \
              [--rates-strict] [--rates-max-staleness <seconds>] \
              [--ingest-id <string>] [--out-parquet-manifest <path>] \
              [--manifest-signature <path>] \
              [--dedup-policy <first-arrival|lex-largest-ts>]
```
