# Summary Schema Sidecars

Add optional schema-sidecar support to `eventq ingest`. The new
`--summary-schema-out <path>` flag writes a sidecar describing the actual
current-run shape of the `--output` summary JSON. The companion
`--summary-schema-digest <path>` flag writes a content-addressed digest for
that schema sidecar. `--summary-schema-strict` tightens only the schema
sidecar derivation rules, and `--summary-schema-index <path>` writes a
separate index over the derived schema.

These sidecars are produced only when their flags are supplied. When all four
flags are absent, every existing output (`--output`, `--rejects`,
`--state-out`, `--audit-log`, `--audit-log-digest`,
`--out-parquet-manifest`, `--manifest-signature`) remains byte-for-byte
unchanged. No runtime-derived field is added to any existing output; the
schema files are deterministic read-only derivations of the summary JSON just
written to `--output`.

## 1. Flag syntax

```
eventq ingest ... [--summary-schema-out <path>] [--summary-schema-digest <path>] \
                 [--summary-schema-strict] [--summary-schema-index <path>]
```

- The path-valued flags are **optional** and take a **single string value** each
  (a filesystem path). Both flags are absent by default.
- When `--summary-schema-out` is absent, the CLI does NOT create the
  file at any path; no `--summary-schema-out` byte stream exists on
  disk.
- When `--summary-schema-out` is supplied, the value MUST be a
  non-empty string. An empty value (`--summary-schema-out=` or
  `--summary-schema-out ""`) is a usage error: exit code `2`, no
  output files created, and this exact stderr line:

  ```
  ingest: --summary-schema-out: value must be non-empty
  ```

- The parent directory of the supplied `--summary-schema-out` path
  MUST already exist. If it does not exist, exit `2`, no output files
  created, stderr (exact):

  ```
  ingest --summary-schema-out parent directory does not exist
  ```

- `--summary-schema-digest` has a hard dependency on
  `--summary-schema-out`: it only makes sense when the schema sidecar
  is being written. Supplying `--summary-schema-digest` without
  `--summary-schema-out` → exit code `2`, no output files created, and
  this exact stderr line:

  ```
  ingest: --summary-schema-digest requires --summary-schema-out
  ```

- The parent directory of the supplied `--summary-schema-digest` path
  MUST already exist. If it does not exist, exit `2`, no output files
  created, stderr (exact):

  ```
  ingest --summary-schema-digest parent directory does not exist
  ```

- The new flags compose freely with every existing flag.
- Validation order: the empty-value check runs at argument-parse time;
  the parent-directory-exists checks run before any output file is
  written; the cross-flag dependency check
  (`--summary-schema-digest` requires `--summary-schema-out`) also
  runs before any output file is written.

## 2. Sidecar file: `--summary-schema-out <path>` content and format

When `--summary-schema-out <path>` is supplied, the CLI writes a
single pretty-printed JSON file at `<path>` with **2-space indentation**
and a **trailing newline**, atomically via `.tmp`+rename (same
discipline as `--out-parquet-manifest`).

The sidecar is written **after** every other output (except the
optional digest sidecar, see §3) has been finalized, including after
`--output`. The content is derived deterministically from the bytes
the CLI just wrote to `--output` in the current run.

The top-level keys appear in exactly this order:

```
schema_version, summary_schema, ingest_id, run_index, field_summary, strict_mode
```

### 2.1 `schema_version`

Fixed string literal, always the first key:

```
"schema_version": "eventq.summary-schema/v1"
```

### 2.2 `summary_schema` — derived from the emitted `--output`

`summary_schema` is a JSON object whose keys and values are derived from
the summary JSON that was just written to `--output` in the current
run. The derivation walks the top-level object of the summary and, in
**emission order** (not ASCII-sorted, not any fixed literal), produces
one entry per top-level key.

For the existing summary shape this yields the following key order
exactly:

```
total_events, unique_users, by_type, by_hour, sessions, time_range, anomalies
```

#### Type descriptor per value

Each descriptor is a JSON object whose first key is always `type`. The
`type` value is one of the strings:

- `"integer"` — JSON number with no fractional part (no `.`, `e`, or
  `E` in the number's raw token).
- `"number"` — JSON number with a fractional part (has `.`, `e`, or
  `E` in the raw token).
- `"string"` — JSON string.
- `"boolean"` — JSON `true` / `false`.
- `"null"` — JSON `null`.
- `"array"` — JSON array.
- `"object"` — JSON object.

##### Additional keys per descriptor

After `type`, the descriptor optionally carries shape keys, then a
`constraints` object. The full key order within each descriptor is:

1. `type` (always first).
2. For arrays only: `element_type`.
3. For objects only: `fields`.
4. `constraints` (always last).

- For arrays: `element_type` is derived from the **first** element of
  the array:
  - If the array is non-empty, `element_type` is the `type` string of
    the first element using the same classification above.
  - If the array is empty, `element_type` is JSON `null`.
- For objects: `fields` is a JSON array of strings — the object's keys
  in **ASCII-sorted ascending order**.

#### 2.2.1 `constraints` — input-deterministic derived facts

Every descriptor carries a `constraints` object as its last key. The
object MAY be empty (`{}`); empty constraints are still emitted
literally. The keys inside `constraints` are always in ASCII-sorted
ascending order.

Per `type`, the constraints are derived as follows:

- `"integer"` **top-level** descriptor: `{"non_negative": true}` when
  the observed value is ≥ 0, otherwise `{}`. (All top-level integer
  fields in the existing summary are non-negative counts, so this
  key is always present for `total_events` and `unique_users`.)
- `"number"` descriptor: `{}` (no constraint keys; the summary's
  money fields are left unconstrained here).
- `"string"` descriptor: `{"format": "rfc3339-utc-z"}` when the
  string value matches the regex
  `^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$`, otherwise `{}`.
- `"boolean"` / `"null"` descriptor: `{}`.
- `"object"` descriptor: in ASCII order:
  - `field_count` — integer number of keys.
  - `subfields` — OPTIONAL. When the object is non-empty, `subfields`
    is an object mapping each sub-key (in ASCII-sorted ascending
    order) to its own descriptor computed by the same rules (with
    `type` first, then optional `element_type` / `fields`, then
    `constraints`). When the object is empty, `subfields` is omitted.
- `"array"` descriptor: in ASCII order:
  - `element_subfields` — OPTIONAL. When the array is non-empty AND
    the first element is an object, `element_subfields` is an object
    mapping each sub-key of that first element (ASCII-sorted) to its
    descriptor, same recursion as `object.subfields`. Otherwise
    omitted.
  - `homogeneous` — boolean. `true` iff all elements of the array
    have the same derived element_type (i.e. `classify(arr[i])` is
    constant across `i`); `false` otherwise. Empty arrays are
    `homogeneous: true` (vacuously homogeneous).
  - `length` — integer number of elements.

The constraints recursion is applied once per descriptor. It descends
one level into `object.subfields` (so `time_range.min` / `time_range.max`
acquire their own `constraints.format = "rfc3339-utc-z"` facts) and
one level into `array.element_subfields` for object-valued array
elements (so `by_hour[0].hour` acquires the same `format` fact, and
`by_hour[0].count` acquires `non_negative: true`). Recursion does NOT
descend further than one object-in-array level or one object-in-object
level; beyond that depth, constraints are still computed for the
immediate value's type but without further subfield recursion.

Formally: the recursion depth is bounded at 2 levels from
`summary_schema.<top>`. Level 0 = the top-level descriptor (always
emitted). Level 1 = `object.subfields.<k>` or `array.element_subfields.<k>`
(always emitted when applicable). Level 2 constraints only include
the shape facts (`field_count`, `length`, `homogeneous`) without
further `subfields`/`element_subfields` keys. This bounded recursion
is sufficient for the existing summary shape (the deepest nested
scalar is `sessions.by_user[0].user`, at depth 2).

##### Descriptor key order summary

| descriptor type | key order |
|---|---|
| integer / number / string / boolean / null | `type`, `constraints` |
| array | `type`, `element_type`, `constraints` |
| object | `type`, `fields`, `constraints` |

Inside `constraints`:

| type | constraint keys (ASCII-sorted) |
|---|---|
| integer (top-level, value ≥ 0) | `non_negative` |
| integer (top-level, value < 0) | (empty) |
| integer (nested) | `non_negative` (if value ≥ 0) |
| number | (empty) |
| string (ISO-Z match) | `format` |
| string (other) | (empty) |
| boolean / null | (empty) |
| object | `field_count`, optional `subfields` |
| array | optional `element_subfields`, `homogeneous`, `length` |

### 2.3 `ingest_id`

- If `--ingest-id <id>` was supplied on this run, `ingest_id` is the
  JSON string with that exact value (same validation as the manifest feature).
- If `--ingest-id` was not supplied, `ingest_id` is JSON `null`.

### 2.4 `run_index`

- A JSON integer equal to the run index that would be written to
  `state.run_index` / `manifest.run_index` for this run:
  - `1` when `--state-in` is absent or when the loaded prior state
    has no `run_index` field.
  - `prior_state.run_index + 1` when `--state-in` resolves to a
    valid prior state.

### 2.5 `field_summary` — cross-cutting aggregate over top-level descriptors

`field_summary` is the penultimate top-level key. It is a JSON object with
exactly three keys in ASCII-sorted ascending order:

```
"field_summary": {
  "array_fields": <int>,
  "object_fields": <int>,
  "scalar_fields": <int>
}
```

Each value is the count of top-level `summary_schema.*` descriptors
whose `type` falls into the corresponding category:

- `scalar_fields` — `type` ∈ {`integer`, `number`, `string`, `boolean`,
  `null`}.
- `object_fields` — `type` == `object`.
- `array_fields` — `type` == `array`.

For the existing summary shape this yields
`{"array_fields": 1, "object_fields": 4, "scalar_fields": 2}` (by_hour
is the sole array; by_type, sessions, time_range, anomalies are the
four objects; total_events, unique_users are the two integer scalars).

### 2.6 Concrete example (default base behavior input, no `--state-in`, no `--ingest-id`, 2 distinct hours)

```json
{
  "schema_version": "eventq.summary-schema/v1",
  "summary_schema": {
    "total_events": {
      "type": "integer",
      "constraints": {"non_negative": true}
    },
    "unique_users": {
      "type": "integer",
      "constraints": {"non_negative": true}
    },
    "by_type": {
      "type": "object",
      "fields": ["chargeback", "login", "purchase", "refund", "signup"],
      "constraints": {
        "field_count": 5,
        "subfields": {
          "chargeback": {"type": "object", "fields": ["avg_usd", "count", "total_usd"], "constraints": {"field_count": 3}},
          "login":      {"type": "object", "fields": ["avg_usd", "count", "total_usd"], "constraints": {"field_count": 3}},
          "purchase":   {"type": "object", "fields": ["avg_usd", "count", "total_usd"], "constraints": {"field_count": 3}},
          "refund":     {"type": "object", "fields": ["avg_usd", "count", "total_usd"], "constraints": {"field_count": 3}},
          "signup":     {"type": "object", "fields": ["avg_usd", "count", "total_usd"], "constraints": {"field_count": 3}}
        }
      }
    },
    "by_hour": {
      "type": "array",
      "element_type": "object",
      "constraints": {
        "element_subfields": {
          "count":     {"type": "integer", "constraints": {"non_negative": true}},
          "hour":      {"type": "string",  "constraints": {"format": "rfc3339-utc-z"}},
          "total_usd": {"type": "number",  "constraints": {}}
        },
        "homogeneous": true,
        "length": 2
      }
    },
    "sessions": {
      "type": "object",
      "fields": ["by_user", "total"],
      "constraints": {
        "field_count": 2,
        "subfields": {
          "by_user": {"type": "array", "element_type": "object", "constraints": {"homogeneous": true, "length": 2}},
          "total":   {"type": "integer", "constraints": {"non_negative": true}}
        }
      }
    },
    "time_range": {
      "type": "object",
      "fields": ["max", "min"],
      "constraints": {
        "field_count": 2,
        "subfields": {
          "max": {"type": "string", "constraints": {"format": "rfc3339-utc-z"}},
          "min": {"type": "string", "constraints": {"format": "rfc3339-utc-z"}}
        }
      }
    },
    "anomalies": {
      "type": "object",
      "fields": ["duplicate", "invalid", "late", "unresolved_chargeback"],
      "constraints": {
        "field_count": 4,
        "subfields": {
          "duplicate":             {"type": "integer", "constraints": {"non_negative": true}},
          "invalid":               {"type": "integer", "constraints": {"non_negative": true}},
          "late":                  {"type": "integer", "constraints": {"non_negative": true}},
          "unresolved_chargeback": {"type": "integer", "constraints": {"non_negative": true}}
        }
      }
    }
  },
  "ingest_id": null,
  "run_index": 1,
  "field_summary": {
    "array_fields": 1,
    "object_fields": 4,
    "scalar_fields": 2
  }
}
```

(The exact indentation/quoting rules are those of Go's
`encoding/json.MarshalIndent(..., "", "  ")` — **but** with all
object-level key orderings preserved by the implementation as
specified: top-level `summary_schema` keys in **emission order**, and
the `constraints.subfields` / `constraints.element_subfields` keys in
**ASCII-sorted order**, and the field-level `fields` arrays in
**ASCII-sorted order**. Because `encoding/json.Marshal` always sorts
map keys, the implementation must serialize the sidecar with explicit
key ordering via `bytes.Buffer` or equivalent.)

## 3. Secondary sidecar: `--summary-schema-digest <path>`

When `--summary-schema-digest <path>` is supplied (and hence
`--summary-schema-out` is also supplied, per §1), the CLI writes a
second pretty-printed JSON sidecar at `<path>` with 2-space
indentation and a trailing newline, atomically via `.tmp`+rename.

The digest sidecar is written **after** the schema sidecar has been
atomically renamed into place, so the sha256 is computed over the
final on-disk bytes of the schema sidecar.

The top-level keys appear in exactly this order:

1. `schema_path` — JSON string. The `filepath.Base` of the schema
   sidecar path (just the filename component, not the full path).
2. `schema_sha256` — JSON string. 64 lowercase hex characters. The
   SHA-256 of the schema sidecar's on-disk bytes after the atomic
   rename.
3. `schema_bytes` — JSON integer. The byte length of the schema
   sidecar on disk.
4. `field_count` — JSON integer. The total number of top-level keys
   inside `summary_schema` in the schema sidecar (i.e. 7 for the
   existing summary shape).
5. `tool_version` — fixed string literal `"eventq/0.5.0"` (the same
   literal used by `--manifest-signature`'s `tool_version` field).

### 3.1 Concrete example

```json
{
  "schema_path": "schema.json",
  "schema_sha256": "<64-hex>",
  "schema_bytes": 1234,
  "field_count": 7,
  "tool_version": "eventq/0.5.0"
}
```

## 4. Atomicity and ordering

- Emission order is deterministic:
  1. `--output` (+ all stateful ingest-7 outputs) finalize first.
  2. `--summary-schema-out` sidecar is written (atomic `.tmp`+rename).
  3. `--summary-schema-digest` sidecar is written AFTER (2) completes,
     reading the just-finalized on-disk bytes for its sha256.
- Write discipline for both new sidecars: `<path>.tmp` first, then
  `os.Rename` to `<path>`. On any write error after `.tmp` has been
  created, the `.tmp` file must not persist.
- Neither new sidecar appears in `--out-parquet-manifest.outputs.*`
  (the manifest still enumerates exactly `summary`, `rejects`,
  `state`, `audit_log`, `audit_digest`). the manifest bytes
  remain byte-identical to the late-audit feature.

## 5. Determinism

- Given identical inputs and flags, two runs produce byte-identical
  schema and digest sidecars.
- The digest's `schema_sha256` is a pure function of the schema
  sidecar bytes, which are a pure function of the summary JSON
  bytes, which are a pure function of the ingest inputs — so the
  digest chain is deterministic.

## 6. Back-compat invariants (strict)

For every existing pre-schema input:

- Omitting all four new flags → byte-identical `--output`, `--rejects`,
  `--state-out`, `--audit-log`, `--audit-log-digest`,
  `--out-parquet-manifest`, and `--manifest-signature` vs. the
  the late-audit feature default behavior. No sidecar file is created on disk.
- Supplying any combination of `--summary-schema-out <path>`,
  `--summary-schema-digest <path2>`, `--summary-schema-strict`, and
  `--summary-schema-index <path3>` → every existing output listed above
  is ALSO byte-identical to the no-flag run; only the new sidecar
  file(s) are additionally produced.

the summary-schema feature does NOT add any new key to `--output`, `--audit-log`,
`--audit-log-digest`, `--state-out`, `--out-parquet-manifest`, or
`--manifest-signature`. the summary-schema feature does NOT change any existing byte of
any existing output under any flag combination.

## 7. Usage errors (summary)

- `--summary-schema-out` with an empty string value → exit `2`,
  stderr (exact):

  ```
  ingest: --summary-schema-out: value must be non-empty
  ```

- `--summary-schema-out <path>` whose parent directory does not exist
  → exit `2`, stderr (exact):

  ```
  ingest --summary-schema-out parent directory does not exist
  ```

- `--summary-schema-digest` supplied without `--summary-schema-out`
  → exit `2`, stderr (exact):

  ```
  ingest: --summary-schema-digest requires --summary-schema-out
  ```

- `--summary-schema-digest <path>` whose parent directory does not
  exist → exit `2`, stderr (exact):

  ```
  ingest --summary-schema-digest parent directory does not exist
  ```

- All prior round usage-error rules continue to hold unchanged.

## 8. Inner descriptor key order (always, under all flag combos)

Inside every `summary_schema.<field>` object value, the key order MUST be
emitted exactly (this is the full list — no extra keys at this level):

| descriptor type | key order |
|---|---|
| scalar (integer / number / string / boolean / null) | `type`, `constraints` |
| array | `type`, `element_type`, `constraints` |
| object | `type`, `fields`, `constraints` |

Inside `constraints`, sub-keys are ASCII-sorted ascending. Inside
`constraints.subfields` (objects) and `constraints.element_subfields`
(arrays of objects), the same descriptor key-order rule applies recursively
with the same level-2 recursion bound. Because `encoding/json.Marshal`
always sorts map keys, the implementation must serialize the sidecar with
an explicit byte-buffer emitter that preserves these orderings.

## 9. `--summary-schema-strict` flag

`--summary-schema-strict` is a new boolean flag (default `false`) that
requires `--summary-schema-out` to also be supplied. Passing
`--summary-schema-strict` without `--summary-schema-out` → exit `2`,
no output files created, stderr (exact):

```
ingest: --summary-schema-strict requires --summary-schema-out
```

### 9.1 `strict_mode` top-level key (always emitted)

The schema sidecar gains a NEW top-level key `strict_mode` emitted AFTER
`field_summary`. It is **always** emitted (regardless of whether the flag
is supplied). Top-level key order becomes exactly:

```
schema_version, summary_schema, ingest_id, run_index, field_summary, strict_mode
```

- `strict_mode: true`  when `--summary-schema-strict` is supplied.
- `strict_mode: false` otherwise.

### 9.2 Three behavior changes under `--summary-schema-strict`

Under `--summary-schema-strict`, the derivation differs from the default
in three places (and ONLY these three):

1. **Empty arrays** — `element_type` becomes the object
   `{"type": "unknown"}` instead of JSON `null`.
2. **Empty arrays** — `constraints.homogeneous` is `false` instead of
   the default vacuous `true`.
3. **Zero integer scalars at the top level** — any top-level
   `summary_schema.<k>` whose type is `integer` and whose observed value
   is exactly `0` gains an additional constraints key
   `zero_observed: true`. This key is emitted in ASCII-sorted order
   alongside `non_negative` (so the emitted key order is
   `non_negative, zero_observed`). Applies only to top-level scalar
   integers (depth 0), not to nested integer subfields.

All other aspects of the sidecar (descriptor key ordering,
`field_summary`, `ingest_id`, `run_index`) are unaffected.

## 10. `--summary-schema-index` flag

`--summary-schema-index <path>` is a third, optional sidecar. It requires
BOTH `--summary-schema-out` AND `--summary-schema-digest` to also be
supplied. Missing either prerequisite → exit `2`, no output files
created, stderr (exact):

```
ingest: --summary-schema-index requires --summary-schema-out and --summary-schema-digest
```

Missing parent directory of the supplied index path → exit `2`, no output
files created, stderr (exact):

```
ingest --summary-schema-index parent directory does not exist
```

### 10.1 Content and format

The index sidecar is a pretty-printed JSON file with **2-space
indentation** and a **trailing newline**, written atomically via
`.tmp`+rename. Its top-level keys appear in this exact order:

1. `entries` — JSON array of objects, one per indexed leaf/top-level
   field.
2. `entry_count` — JSON integer equal to `len(entries)`.
3. `generated_from` — JSON string equal to `filepath.Base` of the
   `--summary-schema-out` path.
4. `tool_version` — fixed string literal `"eventq/0.5.0"`.

### 10.2 Entries derivation

For each top-level `summary` field in emission order, emit one entry:

```json
{"name": "<field>", "type": "<type>", "path": "$.<field>"}
```

For array-of-object top-level fields, add one additional entry for each
sub-key of the first element, in **ASCII-sorted ascending order**, with
path `"$.<field>[*].<subfield>"`. Object-valued top-level fields do NOT
contribute additional entries; their single top-level entry with path
`"$.<field>"` is the only entry for that field. Scalar top-level fields
likewise contribute exactly one entry.

For the existing summary shape (`by_hour` is the sole array-of-objects
with sub-keys `count`, `hour`, `total_usd`), the ordered `entries` are:

```
$.total_events, $.unique_users, $.by_type, $.by_hour,
$.by_hour[*].count, $.by_hour[*].hour, $.by_hour[*].total_usd,
$.sessions, $.time_range, $.anomalies
```

## 11. Atomicity and emission order (updated)

1. `--output` and all stateful ingest-7 outputs finalize first.
2. `--summary-schema-out` sidecar is written next (atomic `.tmp`+rename).
3. `--summary-schema-digest` sidecar is written next, reading the
   just-finalized schema sidecar bytes for its sha256.
4. `--summary-schema-index` sidecar is written last.

None of the new sidecars appear in
`--out-parquet-manifest.outputs.*`; the manifest's output enumeration is
unchanged.

## 12. Usage

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
              [--summary-schema-index <path>]
```
