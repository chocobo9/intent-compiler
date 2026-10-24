# Summary Time Range Policy

`summary.time_range` currently reflects accepted events only, while the
sharding report's `first_ts` and `last_ts` fields reflect every JSON-parseable
line with a conforming UTC timestamp, even if the event is later rejected. Add
`--summary-time-range-policy <accepted|observed|strict-observed>` so operators
can keep the accepted-only behavior, opt into the broader observed range, or
enforce that the accepted and observed ranges coincide.

The default `accepted` policy preserves the existing `summary.time_range`
bytes. Under `observed`, `time_range.min` and `time_range.max` in `--output`
are recomputed over the same timestamp corpus used by the sharding report.
Under `strict-observed`, the run succeeds only when the accepted-only and
observed ranges are identical. No new output files, top-level keys, or renamed
keys are introduced.

## 1. Flag syntax

```
eventq ingest ... [--summary-time-range-policy <accepted|observed|strict-observed>]
```

### 1.1 `--summary-time-range-policy <value>`

- `--summary-time-range-policy` is **optional** and takes a **single
  string value**. It is absent by default.
- When `--summary-time-range-policy` is absent, it behaves exactly as
  `--summary-time-range-policy accepted`: the emitted
  `summary.time_range` in `--output` is byte-identical to the existing
  accepted-only behavior, and the observation that the flag
  was not passed is NOT reflected in any sidecar.
- When `--summary-time-range-policy` is supplied, the value MUST be a
  non-empty string. An empty value (`--summary-time-range-policy=` or
  `--summary-time-range-policy ""`) is a usage error: exit code `2`,
  no output files created (neither `--output` nor `--rejects` nor any
  sidecar), and this exact stderr line:

  ```
  ingest: --summary-time-range-policy: value must be non-empty
  ```

- When `--summary-time-range-policy` is supplied, the value MUST be
  one of the exact ASCII literals `accepted`, `observed`, or
  `strict-observed` (lower-case, no surrounding whitespace). Any other
  value is a usage error: exit code `2`, no output files created,
  exact stderr line:

  ```
  ingest: --summary-time-range-policy: value must be one of accepted|observed|strict-observed
  ```

- Validation order: the empty-value check runs at argument-parse time;
  the enumeration-membership check runs immediately after. Both run
  BEFORE any output file is written (including any `--output.tmp` or
  `--rejects.tmp`).

- `--summary-time-range-policy` composes freely with every existing
  flag. In particular it is NOT gated on `--sharding-report`,
  `--summary-schema-out`, `--run-provenance`, etc. It applies purely
  to the `time_range` block of `--output`.

## 2. `accepted` semantics (default; byte-identity preservation)

When `--summary-time-range-policy` is absent or `accepted`:

- The `time_range` block emitted inside `--output` is byte-identical
  to the existing accepted-only behavior. The `time_range.min` field is the
  lexicographically smallest `ts` among the **surviving / accepted**
  events that end up in `summary.count_by_type` (i.e. the events
  written to the accepted corpus by base ingest semantics). The
  `time_range.max` field is the lexicographically largest such `ts`.
- When zero events are accepted, both `time_range.min` and
  `time_range.max` are JSON `null` (unchanged from default base behavior).

## 3. `observed` semantics (opt-in correction)

When `--summary-time-range-policy observed` is supplied:

- The corpus for `time_range.min` / `time_range.max` is **broader**:
  it covers every input line that (a) parsed as a JSON object, AND
  (b) contains a `ts` field whose value is an RFC 3339 UTC timestamp
  of the exact required UTC form `YYYY-MM-DDTHH:MM:SSZ` — regardless of
  which audit bucket the line ultimately landed in (`accepted`,
  `invalid`, `late`, `duplicate`, or `unresolved_chargeback`).
- A line that fails JSON parsing (e.g. `not a json object`) does NOT
  contribute.
- A line that parses as JSON but whose `ts` field is missing, empty,
  or not an RFC 3339 UTC string of the exact form does NOT
  contribute.
- A line whose `ts` is well-formed but whose event is schema-invalid
  for another reason (e.g. missing `id`, bad `type`, negative
  `amount`) DOES contribute.
- `time_range.min` is the lexicographically smallest such `ts` across
  every shard's contributing lines in `--input-dir`; `time_range.max`
  is the lexicographically largest. Because the fixed RFC 3339 form
  is fixed-width and UTC-only, lexicographic order equals chronological
  order.
- When zero lines across the entire input directory contribute to the
  broader corpus (either because every shard is empty, every line
  fails JSON parsing, or every parsed line lacks a conforming `ts`),
  BOTH `time_range.min` and `time_range.max` are JSON `null` — same
  encoding as default base behavior on an all-empty run.
- The corpus is **exactly** the same as the union of every
  `--sharding-report.shards[i].first_ts` / `shards[i].last_ts`
  contribution described in the sharding-report semantics. Consequently, when
  `--sharding-report` is ALSO emitted on the same run, the following
  closed-form invariants hold (see §4).

## 3b. `strict-observed` semantics (enforcement)

When `--summary-time-range-policy strict-observed` is supplied:

- Ingest runs the full existing pipeline (so `accepted` corpus and every
  existing sidecar are produced exactly as under the default policy).
- After every sidecar is finalized, the broader `observed` corpus is
  computed over the same input directory using the rules of §3.
- If the `observed` range and the `accepted` range COINCIDE (both
  min values string-equal and both max values string-equal, including
  the null/null case), the run succeeds with exit code 0. Every
  produced file is byte-identical to a run under
  `--summary-time-range-policy accepted`. `strict-observed` is purely
  a guard in this case.
- If the `observed` range and the `accepted` range DIVERGE (either the
  min differs or the max differs), the run FAILS with exit code `2`.
  All emitted output files are removed before the process exits — no
  `--output`, no `--rejects`, no `--state-out`, no `--audit-log`, no
  `--audit-log-digest`, no `--out-parquet-manifest`, no
  `--manifest-signature`, no `--summary-schema-out`, no
  `--summary-schema-digest`, no `--summary-schema-index`, no
  `--sharding-report`, no `--sharding-report-digest`, no
  `--sharding-report-index`, no `--sharding-report-histogram`, no
  `--run-provenance`, no `--run-provenance-digest`, and no `.tmp`
  companion of any of those. Stderr carries the exact line:

  ```
  ingest: --summary-time-range-policy: strict-observed divergence: accepted=[<a_min>,<a_max>] observed=[<o_min>,<o_max>]
  ```

  where each of `<a_min>`, `<a_max>`, `<o_min>`, `<o_max>` is either
  the literal RFC 3339 UTC string of the corresponding endpoint (no
  surrounding quotes) or the literal ASCII string `null` when that
  endpoint is JSON null on the corresponding side.

- `strict-observed` is equivalent to `accepted` (byte-identity) on any
  input where no invalid/late/duplicate/unresolved-chargeback line
  contributes a conforming `ts` outside the accepted window — i.e.
  exactly the inputs where `observed` would emit the same bytes as
  `accepted`.

- Under `strict-observed`, the provenance `flags` object records the
  argv token `"strict-observed"` under key `summary-time-range-policy`
  (verbatim) — same fixed enumeration position as the other values.

## 4. Invariants (strict)

1. **Default byte-identity**: when `--summary-time-range-policy` is
   absent, every existing output byte is identical to a run with
   the flag omitted. In particular `--output` is byte-identical to
   the default behavior on every input.
2. **`accepted` byte-identity**: when `--summary-time-range-policy
   accepted` is explicitly supplied, `--output` is byte-identical to
   the same run with the flag omitted. The observation that the flag
   was passed is NOT reflected in `--output`.
3. **`observed` scope**: when `--summary-time-range-policy observed`
   is supplied, only the two `time_range` value lines of `--output`
   can differ from the `accepted` variant. The key order
   (`schema_version`, `ingest_id`, `count_by_type`, `totals`,
   `accepted_by_day`, `rejected_by_reason`, `sessions`, `time_range`,
   `anomalies`), the indentation (2 spaces), and the trailing newline
   are unchanged.
4. **`observed` agrees with sharding-report when both are emitted**:
   when `--summary-time-range-policy observed` AND `--sharding-report
   <path>` are BOTH supplied on the same run with a non-empty input
   directory, let `reportMin` be the lexicographic min of
   `shards[i].first_ts` over all shards whose `first_ts` is non-null,
   and `reportMax` be the lexicographic max of `shards[i].last_ts`
   over all shards whose `last_ts` is non-null. Then:
   - If at least one shard has a non-null `first_ts`,
     `time_range.min == reportMin`.
   - If at least one shard has a non-null `last_ts`,
     `time_range.max == reportMax`.
   - If every shard has `first_ts == null` (and therefore `last_ts ==
     null`), both `time_range.min` and `time_range.max` are JSON
     `null`.
5. **Sidecar independence**: the presence or value of
   `--summary-time-range-policy` does NOT change `--rejects`,
   `--state-out`, `--audit-log`, `--audit-log-digest`,
   `--summary-schema-out`, `--summary-schema-digest`,
   `--summary-schema-index`, `--sharding-report`,
   `--sharding-report-digest`, `--sharding-report-index`, or
   `--sharding-report-histogram` bytes. These remain byte-identical to
   a run with `--summary-time-range-policy` omitted (everything else
   equal). If `--out-parquet-manifest` / `--manifest-signature` are
   emitted, their schemas are unchanged, but their bytes MAY differ
   under `observed` because they content-address the emitted
   `--output` summary bytes. If `--run-provenance` is emitted, its
   `flags` object records the explicit policy value, so
   `--run-provenance` bytes differ whenever the explicit policy value
   differs; `--run-provenance-digest` naturally follows the
   provenance bytes.
6. **Provenance recording**: when `--summary-time-range-policy
   <value>` is explicitly set AND `--run-provenance <path>` is
   supplied on the same run, the `flags` object inside the
   provenance sidecar includes the observed value under key
   `"summary-time-range-policy"` (string-valued; the argv token
   verbatim). The fixed enumeration order of §2.3 of the run-provenance feature is
   extended by appending `summary-time-range-policy` immediately
   after `run-provenance-strict` (see §7). When
   `--summary-time-range-policy` is NOT explicitly set, the key is
   OMITTED from the `flags` object (unchanged observed-only
   semantics via `fs.Visit`).
7. **`observed` broader than `accepted`** (implication, not a new
   axiom): on any input, the `observed` `time_range` span covers
   the `accepted` span. Concretely, if the `accepted` variant has
   `min == a_min` and `max == a_max` (both non-null), then the
   `observed` variant has `min <= a_min` and `max >= a_max`
   lexicographically. When the two spans coincide (no invalid / late
   / duplicate / unresolved-chargeback line contributes a
   conforming `ts` outside the accepted window), the `observed`
   `time_range` bytes equal the `accepted` bytes exactly.
8. **Schema version unchanged**: `--output`'s `schema_version` value
   is the same literal on both `accepted` and `observed`. This is a
   semantic correction, not a schema change.
9. **Determinism**: given identical `--input-dir` contents, identical
   `--rates` bytes, identical explicit flag set + values, and
   identical `--summary-time-range-policy` value, the on-disk bytes
   of `--output` are byte-identical across repeated runs. No wall
   clock, no hostname, no environment variable contributes.
10. **Atomicity**: the policy is applied to the in-memory summary
    buffer before `--output` is written via `.tmp` + rename. An
    errored run (any usage error, any I/O failure) leaves no
    `--output`, no `--output.tmp`, no `--rejects`, and no `.tmp`
    file on disk.

## 5. Composition with other flags

- `--summary-time-range-policy observed` does NOT change any
  `--sharding-report` bytes. The sharding-report's first_ts / last_ts
  semantics remain identical to the sharding-report behavior.
- `--summary-time-range-policy observed` does NOT change any existing digest
  sidecar that hashes a non-summary output. If an `--output-digest` sidecar is
  added later, it should naturally follow the `--output` bytes; this policy
  takes no position on that future behavior.
- `--out-parquet-manifest` and `--manifest-signature` retain
  their existing schemas, but when
  `observed` rewrites the two `time_range` values of `--output`, these
  two sidecars MAY change bytes because they chain through the summary
  file's content-addressed metadata.
- `--summary-schema-out` describes the schema shape of `--output`,
  not its value bytes. It is byte-identical across `accepted` and
  `observed`.
- `--run-provenance` and `--run-provenance-digest` are unchanged only
  when the explicit `summary-time-range-policy` value is unchanged
  across the compared runs. When the flag is omitted in both runs,
  the run-provenance feature byte-identity is preserved; when the flag value differs,
  provenance records that differing value and its digest follows.
- Under `--dedup-policy lex-largest-ts`, the `accepted` corpus may
  differ from `--dedup-policy first-arrival`, but the `observed`
  corpus (which covers every parsed-JSON line with a valid `ts`, not
  just accepted events) is independent of `--dedup-policy`.
- `--session-policy` affects the `sessions` block in `--output` but
  not `time_range`; this time-range policy is orthogonal.

## 6. Determinism

Given identical `--input-dir` contents, identical `--rates` bytes,
identical explicit flag set + values, and identical
`--summary-time-range-policy` value, the on-disk bytes of each
produced sidecar are byte-identical across repeated runs. No wall
clock, no hostname, no environment variable contributes.

## 7. Provenance `flags` enumeration order (fixed)

When both `--run-provenance <path>` and
`--summary-time-range-policy <value>` are explicitly set on the same
argv, the provenance sidecar's `flags` object lists the explicitly-
set keys in this fixed order (observed-only; keys not explicitly
set are omitted):

```
input-dir, rates, output, rejects, session-gap, watermark-lag,
state-in, state-out, pending-ttl, max-open-sessions, state-strict,
audit-log, audit-log-digest, audit-log-rotate-bytes,
rates-strict, rates-max-staleness,
ingest-id, out-parquet-manifest, manifest-signature,
dedup-policy, strict-late-audit,
summary-schema-out, summary-schema-digest, summary-schema-strict, summary-schema-index,
rejects-format, rejects-format-header,
session-policy, fixed-window-seconds,
sharding-report, sharding-report-digest, sharding-report-index,
sharding-report-histogram, sharding-report-sort, sharding-report-strict,
run-provenance, run-provenance-digest, run-provenance-strict,
summary-time-range-policy
```

The new `summary-time-range-policy` key appears last, after
`run-provenance-strict`. Its value is the raw argv token — one of the
strings `"accepted"`, `"observed"`, or `"strict-observed"`. When the
flag is not set, the key is omitted (unchanged `fs.Visit` semantics).

## 8. Usage

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
              [--sharding-report-strict] \
              [--run-provenance <path>] \
              [--run-provenance-digest <path>] \
              [--run-provenance-strict] \
              [--summary-time-range-policy <accepted|observed|strict-observed>]
```
