# Sharding Report Sidecars

The manifest's `input_shards` array gives only a coarse per-shard summary.
Add a standalone sharding-report family for consumers that need per-shard
bytes, hashes, bucket counts, and observed timestamp ranges without
re-parsing `--audit-log` or cross-referencing `--rejects`.

`eventq ingest` now accepts exactly six new optional flags:
`--sharding-report`, `--sharding-report-digest`,
`--sharding-report-index`, `--sharding-report-histogram`,
`--sharding-report-sort`, and `--sharding-report-strict`. When all six flags
are absent, existing outputs are byte-for-byte unchanged. When any of these
flags are supplied, existing outputs remain identical to a run without them;
only the requested sidecars appear.

The report can be sorted by basename, byte size, or sha256. The default
`basename` sort preserves the existing basename-ascending behavior. The
`bytes` and `sha256` modes reorder the `shards[]` array, and dependent sidecar
fields such as JSONPath indices and report digests naturally reflect that
chosen order.

## 1. Flag syntax

```
eventq ingest ... [--sharding-report <path>]
                   [--sharding-report-digest <path>]
                   [--sharding-report-index <path>]
                   [--sharding-report-histogram <path>]
                   [--sharding-report-sort <basename|bytes|sha256>]
                   [--sharding-report-strict]
```

### 1.1 `--sharding-report <path>`

- `--sharding-report` is **optional** and takes a **single string value**
  (a filesystem path). It is absent by default.
- When `--sharding-report` is absent, the CLI does NOT create the
  file at any path; no `--sharding-report` byte stream exists on disk,
  and every existing output remains byte-identical to the default run.
- When `--sharding-report` is supplied, the value MUST be a non-empty
  string. An empty value (`--sharding-report=` or `--sharding-report ""`)
  is a usage error: exit code `2`, no output files created (neither
  `--output` nor `--rejects` nor any sidecar), and this exact stderr
  line:

  ```
  ingest: --sharding-report: value must be non-empty
  ```

- The parent directory of the supplied `--sharding-report` path MUST
  already exist. If it does not exist, exit `2`, no output files created,
  stderr (exact):

  ```
  ingest --sharding-report parent directory does not exist
  ```

- `--sharding-report` composes freely with every existing flag. In
  particular it is NOT gated on `--out-parquet-manifest`,
  `--audit-log`, `--summary-schema-out`, `--session-policy`, or
  `--rejects-format`. A run that passes only
  `--input-dir/--rates/--output/--rejects/--session-gap/--watermark-lag/--sharding-report`
  is valid.
- Validation order: the empty-value check runs at argument-parse time;
  the parent-directory-exists check runs **before** any output file is
  written (including any `--output.tmp` or `--rejects.tmp`).

### 1.2 `--sharding-report-digest <path>`

- `--sharding-report-digest` is **optional** and takes a **single string
  value** (a filesystem path). It is absent by default.
- When absent, the CLI does NOT create the digest file at any path.
- When supplied, the value MUST be a non-empty string. An empty value
  is a usage error: exit code `2`, no output files created, exact
  stderr line:

  ```
  ingest: --sharding-report-digest: value must be non-empty
  ```

- `--sharding-report-digest` REQUIRES `--sharding-report`. Supplying
  `--sharding-report-digest` without `--sharding-report` is a usage
  error: exit code `2`, no output files created, exact stderr line:

  ```
  ingest: --sharding-report-digest requires --sharding-report
  ```

- The parent directory of the supplied path MUST already exist. If it
  does not, exit `2`, no output files created, exact stderr line:

  ```
  ingest --sharding-report-digest parent directory does not exist
  ```

- Validation order: empty-value check → requires-sharding-report check
  → parent-directory-exists check. All three run BEFORE any output
  file is written.

### 1.3 `--sharding-report-index <path>`

- `--sharding-report-index` is **optional** and takes a **single string
  value** (a filesystem path). It is absent by default.
- When absent, the CLI does NOT create the index file at any path.
- When supplied, the value MUST be a non-empty string. An empty value
  is a usage error: exit code `2`, no output files created, exact
  stderr line:

  ```
  ingest: --sharding-report-index: value must be non-empty
  ```

- `--sharding-report-index` REQUIRES BOTH `--sharding-report` AND
  `--sharding-report-digest`. Supplying `--sharding-report-index`
  without either is a usage error: exit code `2`, no output files
  created, exact stderr line:

  ```
  ingest: --sharding-report-index requires --sharding-report and --sharding-report-digest
  ```

- The parent directory of the supplied path MUST already exist. If it
  does not, exit `2`, no output files created, exact stderr line:

  ```
  ingest --sharding-report-index parent directory does not exist
  ```

- Validation order: empty-value check → requires-both check →
  parent-directory-exists check.

### 1.4 `--sharding-report-histogram <path>`

- `--sharding-report-histogram` is **optional** and takes a **single
  string value** (a filesystem path). It is absent by default.
- When absent, the CLI does NOT create the histogram file at any
  path.
- When supplied, the value MUST be a non-empty string. An empty value
  is a usage error: exit code `2`, no output files created, exact
  stderr line:

  ```
  ingest: --sharding-report-histogram: value must be non-empty
  ```

- `--sharding-report-histogram` REQUIRES `--sharding-report` (it does
  NOT require `--sharding-report-digest` or `--sharding-report-index`,
  and composes independently with them). Supplying
  `--sharding-report-histogram` without `--sharding-report` is a
  usage error: exit code `2`, no output files created, exact stderr
  line:

  ```
  ingest: --sharding-report-histogram requires --sharding-report
  ```

- The parent directory of the supplied path MUST already exist. If it
  does not, exit `2`, no output files created, exact stderr line:

  ```
  ingest --sharding-report-histogram parent directory does not exist
  ```

- Validation order: empty-value check → requires-sharding-report
  check → parent-directory-exists check. All three run BEFORE any
  output file is written.

### 1.5 `--sharding-report-sort <basename|bytes|sha256>`

- `--sharding-report-sort` is **optional** and takes a **single string
  value**. Default `basename` (applied when the flag is absent or
  explicitly set to `basename`).
- When supplied, the value MUST be a non-empty string. An empty value
  (`--sharding-report-sort=` or `--sharding-report-sort ""`) is a
  usage error: exit code `2`, no output files created, exact stderr
  line:

  ```
  ingest: --sharding-report-sort: value must be non-empty
  ```

- `--sharding-report-sort` REQUIRES `--sharding-report`. Supplying it
  without `--sharding-report` is a usage error: exit `2`, exact stderr:

  ```
  ingest: --sharding-report-sort requires --sharding-report
  ```

- The value MUST be one of `basename`, `bytes`, or `sha256`. Any other
  value (e.g. `ts`, `size`, uppercase `BYTES`) is a usage error: exit
  `2`, no output files created, exact stderr:

  ```
  ingest: --sharding-report-sort: value must be one of basename|bytes|sha256
  ```

- Under `basename` (default), the sharding-report's `shards[]` array
  is sorted by the shard's basename in ASCII-ascending order — exactly
  the default basename-sorted behavior. When the flag is absent OR when its value is
  explicitly `basename`, every sidecar (`--sharding-report`,
  `--sharding-report-digest`, `--sharding-report-index`,
  `--sharding-report-histogram`) is byte-identical to the default
  basename-sorted state.
- Under `bytes`, `shards[]` is sorted ascending by the shard's `bytes`
  field, with `shard` (basename) as a deterministic tiebreaker when
  two shards have equal `bytes`.
- Under `sha256`, `shards[]` is sorted ascending by the lowercase-hex
  `sha256` string, with `shard` (basename) as tiebreaker.
- When `bytes` or `sha256` is chosen, the sharding-report's `shards[]`
  array is reordered. As downstream consequences:
  - `--sharding-report-index` emits `$.shards[<i>]` paths that reflect
    the new order (the 0-based position `<i>` is the shard's position
    in the reordered `shards[]` array).
  - `--sharding-report-digest`'s `report_sha256` and `report_bytes`
    reflect the new report bytes (because the report bytes change
    when `shards[]` is reordered).
  - `--sharding-report-histogram` values are computed over the per-shard
    vector in the new order; however, the histogram's buckets (counts,
    upper_bound sequence) do NOT depend on the enumeration order (the
    bucket is a count of how many shards fall into each range), so
    the histogram bytes are byte-identical across sort choices given
    identical shards contents.
- The `totals` object is computed over the same multiset of shards
  and is byte-identical across sort choices.
- Validation order: empty-value check → requires-sharding-report
  check → enum-value check.

### 1.6 `--sharding-report-strict`

- `--sharding-report-strict` is **optional** and is a **boolean flag**
  (no value; pass `--sharding-report-strict` to enable).
- When absent, strict mode is off; every sidecar is byte-identical to
  the default report state given the same sort key.
- `--sharding-report-strict` REQUIRES `--sharding-report`. Supplying
  it without `--sharding-report` is a usage error: exit `2`, exact
  stderr:

  ```
  ingest: --sharding-report-strict requires --sharding-report
  ```

- When enabled, the digest sidecar gains two extra fields,
  `sort_key` and `shards_sorted_invariant`, inserted between
  `shard_count` and `tool_version` (see §3). These two fields are the
  ONLY observable effect of `--sharding-report-strict`:
  - Report bytes are unchanged.
  - Index bytes are unchanged (index reads from the report and the
    report is strict-independent).
  - Histogram bytes are unchanged.
- Strict mode composes freely with `--sharding-report-sort`,
  `--sharding-report-digest`, `--sharding-report-index`, and
  `--sharding-report-histogram`.

## 2. `--sharding-report` file shape

The sharding-report file is pretty-printed JSON with **2-space
indentation** and a **trailing newline**. It is written via `.tmp` +
rename after all other outputs have been finalized. The top-level keys
appear in exactly this order:

```
schema_version, ingest_id, shards, totals
```

No other top-level keys are permitted.

- **`schema_version`**: a fixed string literal whose exact value is
  `"eventq.sharding-report/v1"`. Always the very first key; never
  `null`.
- **`ingest_id`**: when `--ingest-id <string>` was supplied to the
  current run, the JSON string of that value; otherwise JSON `null`.
  This mirrors the manifest feature's manifest `ingest_id` semantics exactly.
- **`shards`**: an array of per-shard records. By default (absent
  `--sharding-report-sort` or `--sharding-report-sort basename`) the
  order is **by basename in ASCII-ascending order** (the same order
  used by `--out-parquet-manifest`). Under `--sharding-report-sort
  bytes` the order is ascending by `bytes` with `shard` (basename) as
  tiebreaker. Under `--sharding-report-sort sha256` the order is
  ascending by `sha256` hex with `shard` as tiebreaker. The array MAY
  be empty (when `--input-dir` contains zero conforming shards).
  Every conforming shard contributes one entry, including shards with
  zero events (see §2.2).
- **`totals`**: an aggregate object over all shards (see §2.3).

### 2.1 Per-shard record keys

Each element of `shards` is a JSON object with exactly these keys in
this exact order:

```
shard, bytes, sha256,
events_total, events_accepted, events_invalid, events_late,
events_duplicate, events_unresolved_chargeback,
first_ts, last_ts
```

Semantics:

- `shard`: the bare basename of the shard file (e.g. `"a.ndjson"`).
- `bytes`: integer byte size of the shard file on disk (`wc -c`). Same
  as the manifest feature's manifest `input_shards[].bytes`.
- `sha256`: 64-char lowercase hex of the shard file's raw bytes on disk.
  Same as the manifest feature's manifest `input_shards[].sha256`. When the manifest is
  also emitted in the same run, these two sha256 values MUST match for
  every shard.
- `events_total`: number of non-blank lines in the shard (same
  definition as the manifest feature's manifest `input_shards[].events_total`). Blank /
  whitespace-only lines do NOT contribute.
- `events_accepted`: number of lines from this shard whose final
  audit-bucket is `accepted`. Same as the manifest feature's manifest
  `input_shards[].events_accepted`.
- `events_invalid`: number of lines from this shard whose final
  audit-bucket is `invalid` (schema-invalid, FX-invalid, amount-invalid,
  etc. — anything default base behavior counts toward the `invalid` reject bucket).
- `events_late`: number of lines from this shard whose final
  audit-bucket is `late` (dropped by the `--watermark-lag` rule).
- `events_duplicate`: number of lines from this shard whose final
  audit-bucket is `duplicate` under the dedup-policy dedup policy
  (either `first-arrival` or `lex-largest-ts`).
- `events_unresolved_chargeback`: number of lines from this shard whose
  final audit-bucket is `unresolved_chargeback` (chargeback with a
  `ref_id` that never resolved to a surviving purchase at end-of-run,
  per default base behavior).
- `first_ts`, `last_ts`: see §2.2.

### 2.2 `first_ts` / `last_ts` semantics (tricky)

For each shard, consider the lines that **parsed as JSON and have a
`ts` field whose value is an RFC 3339 UTC timestamp string** (of the
exact required UTC form `YYYY-MM-DDTHH:MM:SSZ`) — regardless of whether the
event is ultimately `accepted`, `invalid`, `late`, `duplicate`, or
`unresolved_chargeback`. This is deliberately broader than
`--output.time_range` (which covers only accepted events) and broader
than `events_accepted` (which covers only the `accepted` bucket).

- A line that fails JSON parsing (e.g. `not a json object`) does NOT
  contribute to `first_ts` / `last_ts`.
- A line that parses as JSON but whose `ts` field is missing, empty, or
  not an RFC 3339 UTC string of the above exact form does NOT
  contribute.
- A line whose `ts` is well-formed but whose event is schema-invalid
  for another reason (e.g. missing `id`, bad `type`, negative `amount`)
  DOES contribute to `first_ts` / `last_ts`.

`first_ts` is the lexicographically smallest such `ts` string; `last_ts`
is the lexicographically largest. Because the fixed RFC 3339 format is
fixed-width and UTC-only, lexicographic order equals chronological
order. If no line in the shard contributes (either because
`events_total` is 0 or because every line fails parsing / lacks a valid
`ts`), BOTH `first_ts` and `last_ts` are JSON `null`.

A shard with `events_total == 0` therefore emits a record like:

```json
{
  "shard": "empty.ndjson",
  "bytes": 0,
  "sha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
  "events_total": 0,
  "events_accepted": 0,
  "events_invalid": 0,
  "events_late": 0,
  "events_duplicate": 0,
  "events_unresolved_chargeback": 0,
  "first_ts": null,
  "last_ts": null
}
```

(empty-file sha256 is fixed because it is the SHA-256 of the empty
byte string.)

### 2.3 Totals object

`totals` is a JSON object with exactly these keys in this exact order:

```
shards, bytes_total, events_total, events_accepted, events_invalid,
events_late, events_duplicate, events_unresolved_chargeback
```

- `shards`: integer count of entries in the `shards` array.
- `bytes_total`: sum of `bytes` across all shards.
- `events_total` through `events_unresolved_chargeback`: the
  element-wise sum across all shards' per-shard counts.

## 3. `--sharding-report-digest` file shape

The digest sidecar is pretty-printed JSON with **2-space indentation**
and a **trailing newline**. Written via `.tmp` + rename after the
sharding-report file has been written and renamed into place (so the
sha256 is computed on the finalized bytes). Top-level keys appear in
exactly this order:

```
schema_version, report_path, report_sha256, report_bytes, shard_count, tool_version
```

When `--sharding-report-strict` is supplied, the digest instead has
these keys in exactly this order (two extra fields inserted between
`shard_count` and `tool_version`):

```
schema_version, report_path, report_sha256, report_bytes, shard_count,
sort_key, shards_sorted_invariant, tool_version
```

No other top-level keys are permitted in either mode.

- `schema_version`: fixed string literal
  `"eventq.sharding-report-digest/v1"`.
- `report_path`: the bare basename of the sharding-report file (e.g.
  `"shards.json"`) — NOT the full path supplied to `--sharding-report`.
- `report_sha256`: 64-char lowercase hex sha256 of the sharding-report
  file's on-disk bytes (the `.json` file the digest describes).
- `report_bytes`: integer byte size of the sharding-report file on disk.
- `shard_count`: integer count of entries in the sharding-report's
  `shards` array (equal to `totals.shards`).
- `sort_key` (strict only): JSON string echoing the
  `--sharding-report-sort` value actually used. One of `"basename"`,
  `"bytes"`, or `"sha256"`. When `--sharding-report-sort` is absent
  but `--sharding-report-strict` is supplied, the value is the
  default `"basename"`.
- `shards_sorted_invariant` (strict only): JSON boolean. `true` when
  the sharding-report's `shards[]` array is in the order required by
  `sort_key` (including the basename tiebreaker for `bytes`/`sha256`);
  `false` otherwise. A conforming producer always emits `true`.
- `tool_version`: fixed string literal `"eventq/0.5.0"`.

The digest is deterministic: identical inputs and identical flag values
produce byte-identical digest files. When `--sharding-report-strict`
is absent AND `--sharding-report-sort` is absent or explicitly
`basename`, the digest bytes are byte-identical to the default
basename-sorted state. Under `--sharding-report-sort bytes` or `sha256`,
the digest remains deterministic but its bytes differ because
`report_sha256` (and therefore the serialized digest payload) changes
with the reordered report bytes.

## 4. `--sharding-report-index` file shape

The index sidecar is pretty-printed JSON with **2-space indentation**
and a **trailing newline**. Written via `.tmp` + rename after the
digest has been written (so it observes the finalized report + digest
bytes). Top-level keys appear in exactly this order:

```
entries, entry_count, shard_count, generated_from, tool_version
```

No other top-level keys are permitted.

- `entries`: an ordered JSON array. For each shard in the
  sharding-report's `shards` array (in the same order as that report's
  `shards[]` array, whether basename-sorted or reordered by
  `--sharding-report-sort`), the index emits ONE `{name, type, path}`
  entry per per-shard scalar field, in exactly this key order within
  each shard:

  ```
  shard, bytes, sha256,
  events_total, events_accepted, events_invalid, events_late,
  events_duplicate, events_unresolved_chargeback,
  first_ts, last_ts
  ```

  Each entry has exactly these keys in this exact order:

  ```
  name, type, path
  ```

  - `name`: the per-shard field name (e.g. `"bytes"`, `"first_ts"`).
  - `type`: one of `"string"`, `"integer"`, or `"null"`, classified
    from the actual value in the sharding-report for that shard:
    - JSON strings → `"string"`.
    - JSON integers → `"integer"`.
    - JSON null → `"null"` (applies to `first_ts` / `last_ts` when
      they are null for that shard).
  - `path`: JSONPath of the form `$.shards[<i>].<name>`, where `<i>` is
    the 0-based position of the shard in the sharding-report's
    `shards` array. Example: `"$.shards[0].bytes"`.

  When the sharding-report's `shards` array is empty, `entries` is
  the empty array `[]`.
- `entry_count`: integer count of entries in the `entries` array.
  Equal to `11 * shard_count` (exactly 11 per-shard fields per shard).
- `shard_count`: integer count of shards covered (equal to
  sharding-report's `totals.shards`).
- `generated_from`: the bare basename of the sharding-report file
  (e.g. `"shards.json"`) — same value as the digest's `report_path`.
- `tool_version`: fixed string literal `"eventq/0.5.0"`.

The index is deterministic.

## 4.5 `--sharding-report-histogram` file shape

The histogram sidecar is pretty-printed JSON with **2-space
indentation** and a **trailing newline**. Written via `.tmp` + rename
after the sharding-report has been written. (The digest and index
sidecars are NOT required; the histogram is independent of them.)
Top-level keys appear in exactly this order:

```
schema_version, report_path, shard_count, buckets, tool_version
```

No other top-level keys are permitted.

- `schema_version`: fixed string literal
  `"eventq.sharding-report-histogram/v1"`.
- `report_path`: the bare basename of the sharding-report file (e.g.
  `"shards.json"`) — NOT the full path supplied to `--sharding-report`.
- `shard_count`: integer count of shards covered (equal to
  sharding-report's `totals.shards`).
- `buckets`: a JSON object with exactly these keys in exactly this
  order, where each value is a histogram array over the named
  per-shard scalar metric computed across all shards in the
  sharding-report:

  ```
  bytes, events_total, events_accepted, events_invalid,
  events_late, events_duplicate, events_unresolved_chargeback
  ```

- `tool_version`: fixed string literal `"eventq/0.5.0"`.

### 4.5.1 Histogram array semantics (deterministic)

For a given metric M (e.g. `bytes` or `events_accepted`), let
`values[]` be the non-negative integer vector consisting of one entry
per shard in the sharding-report's `shards` array, in whatever order
that report currently uses (default `basename`, or the reordered
`bytes` / `sha256` order selected by `--sharding-report-sort`). Entry
`i` is `shards[i].<M>` for the per-shard scalar fields `bytes`,
`events_total`, `events_accepted`, `events_invalid`, `events_late`,
`events_duplicate`, `events_unresolved_chargeback`. Because the
histogram reduces `values[]` to bucket counts, its output depends only
on the multiset of metric values, not on the enumeration order.

The histogram array for metric M is constructed deterministically:

1. If the `shards` array is empty, the histogram array is the empty
   array `[]`.
2. Otherwise let `vmax = max(values[])`.
3. If `vmax == 0`, the histogram array is exactly one bucket:
   `[{"upper_bound": 0, "count": len(values)}]`. Every shard
   contributes to the single zero-bucket.
4. If `vmax >= 1`, the histogram is a sequence of power-of-two
   buckets starting at upper_bound `1` and doubling until
   `upper_bound >= vmax`. Concretely the upper-bounds are
   `1, 2, 4, 8, 16, ...` truncated at the smallest power of two
   greater than or equal to `vmax`. A separate leading zero-bucket
   `{"upper_bound": 0, "count": N0}` is emitted **only if** at least
   one shard has `values[i] == 0`, where `N0` is the count of shards
   with `values[i] == 0`. When emitted, the zero-bucket is the first
   element of the histogram array; the power-of-two buckets follow.
5. For each power-of-two bucket with upper_bound `u`, the `count`
   field is the number of shards whose `values[i]` satisfies
   `prev < values[i] <= u`, where `prev` is the previous bucket's
   upper_bound (treat `prev = 0` for the first power-of-two bucket,
   regardless of whether the zero-bucket was emitted).
6. Each bucket is a JSON object with exactly these keys in exactly
   this order:

   ```
   upper_bound, count
   ```

   Both are non-negative integers.

### 4.5.2 Worked example

If the sharding-report has two shards with
`events_accepted = [1, 3]`, then `vmax = 3`, power-of-two
upper_bounds are `1, 2, 4`. Counts: `prev=0, u=1 → count=1` (value 1);
`prev=1, u=2 → count=0`; `prev=2, u=4 → count=1` (value 3). No shard
has value 0, so no leading zero-bucket. Histogram:

```json
[
  {"upper_bound": 1, "count": 1},
  {"upper_bound": 2, "count": 0},
  {"upper_bound": 4, "count": 1}
]
```

If `events_late = [0, 0]` for every shard, histogram is exactly
`[{"upper_bound": 0, "count": 2}]`.

If `events_invalid = [3, 0]`, then `vmax = 3`, zero-bucket is
emitted (N0=1), and power-of-two buckets run 1, 2, 4. Counts:
zero-bucket 1; `u=1 → 0`; `u=2 → 0`; `u=4 → 1`. Histogram:

```json
[
  {"upper_bound": 0, "count": 1},
  {"upper_bound": 1, "count": 0},
  {"upper_bound": 2, "count": 0},
  {"upper_bound": 4, "count": 1}
]
```

### 4.5.3 Invariants

For every histogram array `H` emitted by `--sharding-report-histogram`
(one per named metric in `buckets`):

- If `shard_count == 0`, `H == []`.
- Otherwise `sum(bucket.count for bucket in H) == shard_count`
  (every shard contributes to exactly one bucket).
- `bucket.upper_bound` values are strictly increasing along `H`.
- `bucket.upper_bound >= 0` and `bucket.count >= 0`.
- When a zero-bucket is present, it is the first element and has
  `upper_bound == 0`.
- All non-zero buckets have `upper_bound` equal to a power of two
  (`1, 2, 4, 8, ...`).

The histogram sidecar is deterministic: identical inputs and
identical flag values produce byte-identical histogram files. The
presence or absence of `--sharding-report-digest` and
`--sharding-report-index` does NOT affect the histogram bytes.
Likewise, the histogram does NOT affect the sharding-report, digest,
or index bytes.

## 5. Per-shard invariants (strict)

For every shard record in the sharding-report:

1. `events_total >= 0`, `bytes >= 0`, every `events_*` count `>= 0`.
2. `events_accepted + events_invalid + events_late + events_duplicate + events_unresolved_chargeback == events_total`.
3. `first_ts == null` iff `last_ts == null`. Either both are null or
   both are non-null.
4. When both are non-null, `first_ts <= last_ts` (string comparison).
5. When the run also emits `--out-parquet-manifest`, for every shard
   that appears in both files:
   - `bytes` matches the manifest's `input_shards[].bytes`.
   - `sha256` matches the manifest's `input_shards[].sha256`.
   - `events_total` matches the manifest's
     `input_shards[].events_total`.
   - `events_accepted` matches the manifest's
     `input_shards[].events_accepted`.

## 6. Top-level invariants (strict)

1. `totals.shards == len(shards)`.
2. `totals.bytes_total == sum(s.bytes for s in shards)`.
3. `totals.events_total == sum(s.events_total for s in shards)`.
4. For each bucket in `{accepted, invalid, late, duplicate,
   unresolved_chargeback}`:
   `totals.events_<bucket> == sum(s.events_<bucket> for s in shards)`.
5. When the run also emits `--out-parquet-manifest` and
   `manifest.totals.events_accepted_total` / `.events_rejected_total`
   exist:
   - `totals.events_accepted == manifest.totals.events_accepted_total`.
   - `totals.events_invalid + totals.events_late +
      totals.events_duplicate + totals.events_unresolved_chargeback
      == manifest.totals.events_rejected_total`.
6. The sharding-report, digest, and index are produced
   **deterministically**: repeated runs with identical inputs and
   identical flag values produce byte-identical sidecar files.

## 7. Composition with other flags

- The six new flags do NOT change any existing output on any
  input. `--output`, `--rejects`, `--state-out`, `--audit-log`,
  `--audit-log-digest`, `--out-parquet-manifest`,
  `--manifest-signature`, `--summary-schema-out`,
  `--summary-schema-digest`, `--summary-schema-index` are byte-identical
  to a run with all six new flags omitted (everything else equal).
- `--sharding-report-sort basename` (explicit) and `--sharding-report-sort`
  absent produce byte-identical report, digest, index, and histogram
  bytes (when `--sharding-report-strict` is absent). Strict is purely
  additive to the digest.
- Under `--sharding-report-sort bytes` or `sha256`, only the
  sharding-report bytes and the digest's `report_sha256`/`report_bytes`
  change (plus `--sharding-report-index` JSONPath indices reflect the
  new order). Histogram bytes do NOT depend on sort key.
- Supplying `--sharding-report-digest`, `--sharding-report-index`,
  and/or `--sharding-report-histogram` does NOT change the
  sharding-report bytes either. The sharding-report is byte-identical
  whether or not the digest/index/histogram flags are present.
- `--sharding-report-histogram` is independent of
  `--sharding-report-digest` and `--sharding-report-index`: histogram
  bytes do not depend on either, and neither of those sidecars is
  affected by the histogram flag. Any subset of
  `{digest, index, histogram}` may be emitted, provided the
  `--sharding-report-index` requires-both rule is satisfied.
- Under `--session-policy fixed-window` or `--session-policy hybrid`,
  the sharding-report's per-shard and total event counts are
  **byte-identical** to a `--session-policy gap` run on the same
  input, because the session-policy feature's policy flag affects only
  `summary.sessions.total` (a summary-scoped integer) and does not
  reclassify any event's audit-bucket.
- Under `--dedup-policy lex-largest-ts` (the dedup-policy feature), a line's winner/loser
  status under the lex rule determines whether the shard containing
  that line contributes to `events_accepted` vs `events_duplicate`.
  Winning and losing lines from different shards are attributed to
  their own shards independently.
- Under `--rejects-format tagged` (the rejects-format feature), the sharding-report is
  unchanged — it is not a rejects projection; the per-bucket counts
  are derived from audit outcomes, not from `--rejects` bytes.

## 8. Determinism

Given identical `--input-dir`, `--rates`, `--session-gap`,
`--watermark-lag`, any existing flag combination, and any
`--sharding-report <path>` / `--sharding-report-digest <path>` /
`--sharding-report-index <path>` / `--sharding-report-histogram <path>` /
`--sharding-report-sort <key>` / `--sharding-report-strict` values,
the on-disk bytes of each produced sidecar are byte-identical across
repeated runs. No wall clock, no hostname, no environment variable
contributes.

## 9. Usage

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
              [--strict-late-audit] \
              [--summary-schema-out <path>] \
              [--summary-schema-digest <path>] \
              [--summary-schema-strict] \
              [--summary-schema-index <path>] \
              [--rejects-format <legacy|tagged|tagged-sorted>] \
              [--rejects-format-header] \
              [--session-policy <gap|fixed-window|hybrid>] \
              [--fixed-window-seconds <int>] \
              [--sharding-report <path>] \
              [--sharding-report-digest <path>] \
              [--sharding-report-index <path>] \
              [--sharding-report-histogram <path>] \
              [--sharding-report-sort <basename|bytes|sha256>] \
              [--sharding-report-strict]
```
