# Structured Late Audit Cutoffs and Audit Log Rotation

Late audit records need to carry enough information for downstream tools to
reconstruct the watermark decision without guessing how a timestamp string was
formatted. The `cutoff` value in every `late` audit record is now a structured
JSON object with exactly two keys in this order:
`{"value": "<RFC3339-UTC-Z>", "epoch_seconds": <int>}`. The `value` field is
the canonical UTC string matching the event timestamp format, and
`epoch_seconds` is the same threshold as a Unix-second integer.

The optional `--strict-late-audit` flag adds two sibling keys to every `late`
audit record: `watermark_lag_seconds` and `late_by_seconds`. This makes the
watermark lag and exact tardiness visible from the audit record alone.

`eventq ingest` has three related changes: the
`--strict-late-audit` flag, the `--audit-log-rotate-bytes` flag, and the
state-file schema correction in §9 (with optional `--state-strict` load
enforcement). All other existing invariants still hold except where those
three changes explicitly say otherwise.

## 1. Flag syntax

```
eventq ingest ... [--strict-late-audit]
```

- The flag is **optional** and takes **no value** (presence = on). Passing it
  a value (e.g. `--strict-late-audit=true`) is a usage error: exit `2` with
  the existing usage-error string.
- `--strict-late-audit` has a hard dependency on `--audit-log`: it only makes
  sense when an audit log is being written. Supplying `--strict-late-audit`
  without `--audit-log` → exit code `2`, no output files created, and the
  following exact line on stderr:

  ```
  ingest: --strict-late-audit requires --audit-log
  ```

- `--strict-late-audit` composes freely with every existing flag; it is
  independent of `--dedup-policy`, `--state-in`/`--state-out`,
  `--rates-strict`, `--rates-max-staleness`, `--ingest-id`,
  `--out-parquet-manifest`, and `--manifest-signature`.

## 2. `cutoff` structured-object correction (applies ALWAYS, independent of the flag)

Every `late` audit record MUST carry a `cutoff` value that is a JSON object
with exactly two keys in the listed order:

```
"cutoff": {"value": "<YYYY-MM-DDTHH:MM:SSZ>", "epoch_seconds": <int>}
```

- `value` — the effective watermark threshold rendered as strict RFC3339 UTC
  with the `Z` suffix, 20 characters exactly, matching the regex
  `^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$`. Same form as
  the event's `ts` field.
- `epoch_seconds` — the same cutoff timestamp as a bare JSON integer
  (no quotes, no decimal point) equal to the Unix seconds since the epoch
  corresponding to `value`.
- The two keys MUST appear in the order listed above (`value` first,
  `epoch_seconds` second). No additional keys.

The cutoff itself is computed exactly as in the audit-log feature: it is
`seeded_max_ts - watermark_lag_seconds` evaluated at the moment the lateness
decision was made for that event. the late-audit feature does not change WHAT value is
computed — only HOW it is rendered.

If the computed cutoff epoch is negative (theoretically possible with an
unseeded watermark and very large lag, though the pipeline never reaches the
late-check unless `haveMaxTS` is true), the implementation clamps to epoch
`0` — `{"value": "1970-01-01T00:00:00Z", "epoch_seconds": 0}`.

## 3. `--strict-late-audit`: added audit-record keys

When `--strict-late-audit` is supplied along with `--audit-log`, every `late`
audit record gains two new keys appended immediately after `cutoff`, in this
exact order:

1. `watermark_lag_seconds` — integer, equal to the `--watermark-lag` value in
   effect for the run. Same number across every `late` record in the run
   (the flag does not change mid-run).
2. `late_by_seconds` — integer, equal to `cutoff_epoch - event_ts_epoch`,
   always a positive integer (the event is late only if its epoch is strictly
   less than the cutoff epoch). Computed per-record at the moment of
   classification.

### 3.1 Updated `late`-record key order under `--strict-late-audit`

```
{"id": "...", "ts": "...", "type": "...", "shard": "...", "line": N,
 "bucket": "late",
 "cutoff": {"value": "<YYYY-MM-DDTHH:MM:SSZ>", "epoch_seconds": <int>},
 "watermark_lag_seconds": <int>, "late_by_seconds": <int>}
```

i.e. nine keys in the listed order. The two new keys are always both present
together on every `late` record (never one without the other). They are emitted
as bare JSON integers (no quotes, no decimal point).

### 3.2 Without `--strict-late-audit` — no new keys (cutoff still structured)

When `--strict-late-audit` is absent, the `late` record shape is seven keys
in this order, with the structured `cutoff` object:

```
{"id": "...", "ts": "...", "type": "...", "shard": "...", "line": N,
 "bucket": "late",
 "cutoff": {"value": "<YYYY-MM-DDTHH:MM:SSZ>", "epoch_seconds": <int>}}
```

The `watermark_lag_seconds` / `late_by_seconds` keys are NOT emitted when the
flag is absent.

## 4. `--audit-log-digest`: new `late_cutoff_stats` block

the late-audit feature adds a new top-level digest block, `late_cutoff_stats`, positioned
immediately **after** `duplicate_reasons` and immediately **before**
`resolved_against`. The block is always emitted (independent of
`--strict-late-audit` and of whether any `late` records exist):

```
"late_cutoff_stats": {
  "count": <int>,
  "min_cutoff_epoch": <int>,
  "max_cutoff_epoch": <int>
}
```

- `count` — number of `late` audit records in this run (same integer as
  `bucket_counts.late`).
- `min_cutoff_epoch` — minimum `epoch_seconds` across every `late` record's
  `cutoff` object. When `count` is 0, this is `0`.
- `max_cutoff_epoch` — maximum `epoch_seconds` across every `late` record's
  `cutoff` object. When `count` is 0, this is `0`.
- All three values are emitted as bare JSON integers.

The insertion is purely additive — every other digest block (`audit_log`,
`total_records`, `bucket_counts`, `invalid_reasons`, `duplicate_reasons`,
`resolved_against`, `dedup_policy_stats`, `fx_fallback_stats`,
`rates_digest`, `sha256`) retains its the existing audit-digest shape and contents, only its
position shifts by one block where applicable. `sha256` is recomputed over
the new audit-log-on-disk bytes (which differ from the dedup-policy feature because `cutoff`
is now an object).

## 5. Scope: what the late-audit feature does NOT change

- `--output` bytes are UNCHANGED vs. the dedup-policy feature for every input, regardless of
  `--strict-late-audit`. `anomalies.late` still counts the same events the
  same way.
- `--rejects` bytes are UNCHANGED vs. the dedup-policy feature. The rejects file never carried
  `cutoff` / `watermark_lag_seconds` / `late_by_seconds` and still does not.
- `--state-out` bytes differ from the dedup-policy feature only where `pending_purchases`
  entries now carry `first_seen_epoch` per §9; all other state sections keep
  their prior semantics and ordering.
- `--audit-log` bytes differ from the dedup-policy feature ONLY in two ways:
  1. Every `late` record's `cutoff` is now an object (`{value, epoch_seconds}`)
     instead of a bare string — regardless of `--strict-late-audit`.
  2. If `--strict-late-audit` is supplied, every `late` record gains the two
     sibling keys.
- `--audit-log-digest` bytes differ from the dedup-policy feature in two ways:
  1. A new `late_cutoff_stats` block is inserted between `duplicate_reasons`
     and `resolved_against`.
  2. `sha256` reflects the new audit-log bytes.
- `--out-parquet-manifest` bytes change only to the extent that the
  `state.sha256` / `state.bytes`, `audit_log.sha256` / `audit_log.bytes`, and
  `audit_digest.sha256` / `audit_digest.bytes` entries reflect the new
  on-disk bytes. When audit rotation is active, `outputs.audit_log` continues
  to describe the main `--audit-log` path only (the newest segment), not the
  older rotated side segments.
- `--manifest-signature` recomputes over the new manifest bytes; its
  `signed_at_utc` is still derived deterministically from `window.max_ts` per
  the manifest feature.

## 6. Usage-error rules

- `--strict-late-audit` without `--audit-log` → exit `2`, stderr (exact):

  ```
  ingest: --strict-late-audit requires --audit-log
  ```

  No output files (including `--output`, `--rejects`, `--state-out`,
  `--audit-log-digest`) may be created when this usage error fires — the
  check runs at argument-parse time, before any I/O.

- `--strict-late-audit` passed with an explicit value (e.g.
  `--strict-late-audit=foo`) → exit `2`; Go's flag parser naturally reports
  the usage error.

- Every other existing usage-error rule is preserved.

## 7. Determinism

Given identical `--input-dir`, `--rates`, `--session-gap`, `--watermark-lag`,
any `--state-in`, any existing flag combination, and any `--strict-late-audit`
setting, every output file is byte-identical across repeated runs. The
integer formatting (`epoch_seconds`, `watermark_lag_seconds`,
`late_by_seconds`, `min_cutoff_epoch`, `max_cutoff_epoch`) is locale-free and
uses Go's default base-10 `%d` rendering.

## 8. `--audit-log-rotate-bytes <int>`: segment-rotated audit log

the late-audit feature adds one more optional flag that governs *how the audit log is laid
out on disk*. It does not change the per-record shape produced by
§2 / §3 — it only changes which files the NDJSON records land in.

### 8.1 Syntax and validation

```
eventq ingest ... --audit-log <path> [--audit-log-rotate-bytes <int>]
```

- The value MUST be a positive integer `>= 4096`. Any value `< 4096`
  (including `0` when the flag is explicitly supplied; a negative integer;
  etc.) is a usage error: exit `2`, no output files created, and this exact
  stderr line:

  ```
  ingest: --audit-log-rotate-bytes: must be a positive integer >= 4096
  ```

- The flag has a hard dependency on `--audit-log`. Supplying
  `--audit-log-rotate-bytes` without `--audit-log` → exit `2`, no output
  files created, and this exact stderr line:

  ```
  ingest: --audit-log-rotate-bytes requires --audit-log
  ```

- Absence of the flag (the default) is equivalent to rotation disabled; the
  audit-log file is written as a single NDJSON file exactly as in §1-7, and
  the digest shape (single-string `audit_log` + single `sha256`) is
  **byte-for-byte identical** to the non-rotated the late-audit feature output.

### 8.2 Rotation semantics

When rotation is active (`rotate_bytes > 0`), the audit records are
partitioned into sequential *segments* of NDJSON. A new segment begins
whenever adding the *next* record would make the current segment's size
strictly exceed `rotate_bytes` bytes. The current segment is flushed in
place before the new segment is started; within a segment the per-record
NDJSON rendering is identical to the non-rotated output.

On-disk layout after `N` segments have been produced (oldest to newest):

```
<basename>.1          # oldest segment
<basename>.2
...
<basename>.(N-1)
<basename>             # newest segment (the main --audit-log path)
```

i.e. the main `--audit-log` path always contains the *most recent* segment
only (not the concatenation of all segments). Older segments stay at the
rotated paths `<basename>.1`, `<basename>.2`, …, in creation order. A
single record that is itself larger than `rotate_bytes` is placed alone in
its own segment (no record is ever split across segments).

### 8.3 Digest correction under rotation (`--audit-log-digest`)

When rotation is active AND more than one segment was produced AND
`--audit-log-digest` is supplied, two fields in the digest change shape:

1. `audit_log` becomes a **JSON array of basenames** in this exact order: the
   main path basename first (the newest segment), followed by
   `<basename>.1`, `<basename>.2`, … in ascending numeric order of the older
   side segments. This replaces the single-string form.
2. `sha256` is **removed**; in its place an array key `sha256_segments` is
   emitted that lists the per-segment SHA-256 hex digests in the same order
   as `audit_log` (main-path sha first, then `.1`, `.2`, …). Every other
   digest block retains its the existing audit-digest shape and position.

When rotation is not active OR produced only a single segment (no overflow
occurred), `audit_log` remains a single string and `sha256` remains a
single hex string — the digest is byte-for-byte equal to the non-rotated
the late-audit feature output.

### 8.4 Determinism, composition, scope

- Rotation is deterministic: the segment boundaries depend only on the
  rendered NDJSON bytes and the numeric `rotate_bytes` threshold.
- `--audit-log-rotate-bytes` composes freely with `--strict-late-audit`,
  `--dedup-policy`, and every existing flag. Strict-late-audit affects
  per-record bytes (and therefore can change segment boundaries); it does
  not change the rotation rule itself.
- `--output`, `--rejects`, and `--state-out` are byte-for-byte unchanged by
  the presence or value of `--audit-log-rotate-bytes`.
- `--out-parquet-manifest` / `--manifest-signature` may change under rotation
  only because they reflect the main `--audit-log` file and digest bytes
  produced by the rotated run; rotated side segments are not enumerated as
  separate manifest outputs.

## 9. State-file schema correction: `first_seen_epoch` on `pending_purchases`

Every entry of `pending_purchases` in the emitted `--state-out` JSON MUST
carry a new integer key, `first_seen_epoch`, whose value is the Unix seconds
parsed from the entry's RFC3339-UTC `ts` string (same semantics as
`late_cutoff_stats.{min,max}_cutoff_epoch` and the `epoch_seconds` field of
a `late` audit record's `cutoff` object). The key appears in emission order
**immediately after `ts` and immediately before `user`**. Resulting per-entry
key order is:

```
{"id": "...", "ts": "...", "first_seen_epoch": <int>, "user": "...", "usd": ..., "origin_run": N}
```

Legacy state files written by prior rounds (without the key) remain
loadable by default — the key is back-filled on write. Under a new
`--state-strict` flag, loading a legacy state file (any pending entry
missing the key) is a usage error: exit `2`, no output files created, and
this exact stderr line:

```
ingest: --state-strict: state pending entry missing first_seen_epoch
```

All other state fields (`version`, `watermark`, `seen_ids`, `open_sessions`,
`run_index`) are unchanged. The open-sessions / seen-ids / watermark
sections remain byte-for-byte compatible with stateful ingest-5 emission rules; only
`pending_purchases` entries gain the new key.

## 10. Usage

```
eventq ingest --input-dir <dir> --rates <path> --output <path> --rejects <path> \
              --session-gap <seconds> --watermark-lag <seconds> \
              [--state-in <path>] [--state-out <path>] [--pending-ttl <seconds>] \
              [--max-open-sessions <int>] [--state-strict] \
              [--audit-log <path>] [--audit-log-digest <path>] \
              [--audit-log-rotate-bytes <int>] \
              [--rates-strict] [--rates-max-staleness <seconds>] \
              [--ingest-id <string>] [--out-parquet-manifest <path>] \
              [--manifest-signature <path>] \
              [--dedup-policy <first-arrival|lex-largest-ts>] \
              [--strict-late-audit]
```
