# Canonical Rejects Formats

The existing `--rejects` file records rejected raw lines, but it does not by
itself expose the reject bucket, reason code, shard, or line number for each
row. Add an explicit `--rejects-format <legacy|tagged|tagged-sorted>` selector
and a canonical tagged shape so downstream consumers can read that metadata
without replaying the pipeline or cross-referencing the audit log.

`legacy` is the default and preserves the existing on-disk reject bytes.
`tagged` emits bucket, reason code, shard, line number, and raw line columns.
When first-arrival deduplication is active, the existing
`winner_shard`/`winner_line` columns remain trailing columns after the new
metadata and raw-line columns. `tagged-sorted` uses the same row shape but
sorts rows by the deterministic order defined below.

Tagged formats require `--audit-log` to also be supplied. For reject rows that
came from current-run JSON-object records, the tagged rejects file is a
projection of the audit log's reject records. This file also has explicit
handling for textual non-object rejects and blank-only lines as described
below. Non-reject outputs remain unchanged except for deterministic digest,
schema, manifest, and signature fields that necessarily reflect the chosen
rejects bytes.

`eventq ingest` now accepts the `--rejects-format` selector, the dependent
`--rejects-format-header` flag, and the tagged-mode digest/schema amendments
described in §§9-12. Every other existing output contract is preserved except
where those sections explicitly say otherwise.

## 1. Flag syntax

```
eventq ingest ... [--rejects-format <legacy|tagged|tagged-sorted>] [--rejects-format-header]
```

- `--rejects-format` is **optional**. Omitting it is exactly equivalent to
  supplying `--rejects-format legacy`. The default is `legacy`.
- The flag value MUST be one of the three string literals `legacy`,
  `tagged`, or `tagged-sorted`. Any other value (including the empty string, prefixes like
  `tag`, case variants like `Legacy`, or any other token) is a usage
  error: exit code `2`, no output files created, and this exact stderr
  line:

  ```
  ingest: --rejects-format: must be one of {legacy, tagged, tagged-sorted}
  ```

- `--rejects-format` with no argument value (e.g. `--rejects-format` as
  the final token) is also a usage error and must exit `2`; Go's flag
  parser will emit its own usage error in that case. The exact stderr
  line for that empty/missing-value case is not part of the portable contract.
- `--rejects-format tagged` has a **hard dependency** on `--audit-log`.
  Supplying `--rejects-format tagged` without `--audit-log` → exit code
  `2`, no output files created, and this exact stderr line:

  ```
  ingest: --rejects-format tagged requires --audit-log
  ```

- `--rejects-format-header` is **optional** and takes no value. Supplying
  it a value (e.g. `--rejects-format-header=true`) is a usage error: exit
  code `2`; Go's flag parser naturally reports the usage error.
- `--rejects-format-header` has a hard dependency on
  `--rejects-format tagged` or `--rejects-format tagged-sorted`: the
  header only makes sense for the tagged formats. Supplying
  `--rejects-format-header` without one of those formats (i.e. omitted,
  or `legacy`) → exit code `2`,
  no output files created, and this exact stderr line:

  ```
  ingest: --rejects-format-header requires --rejects-format tagged
  ```

- Validation order: the enum-value check runs at argument-parse time;
  the `--rejects-format tagged requires --audit-log` check and the
  `--rejects-format-header requires --rejects-format tagged` check both
  run **before** any output file is written (including any `--output.tmp`
  or `--audit-log.tmp`).
- `--rejects-format` and `--rejects-format-header` compose freely with
  every existing flag.

## 2. `legacy` format (default; byte-identical with existing rejects)

Under `--rejects-format legacy` (or when the flag is omitted), `--rejects`
is written byte-for-byte identical to the default legacy behavior. This means:

- Without `--dedup-policy first-arrival`: each rejected line is the raw
  input bytes followed by exactly one `\n`, in the existing four-bucket
  order. If there are no rejects, the file is zero bytes.
- With `--dedup-policy first-arrival`: the dedup-policy feature §3.6 applies verbatim —
  each line is `<raw_input_line>\t<winner_shard>\t<winner_line>\n`, with
  `-\t-` for non-duplicate rows.

The new selector does NOT change a single byte of legacy-format rejects output on
any existing input.

## 3. `tagged` format (canonical structured shape)

Under `--rejects-format tagged`, every non-empty reject becomes a single
line in the output file. No leading or trailing blank lines. Each line is
terminated by exactly one `\n`.

### 3.1 Column layout (no `--dedup-policy first-arrival`)

Each reject line is exactly **5 tab-separated columns**:

```
<bucket>\t<reason_code>\t<shard>\t<line_no>\t<raw_line>\n
```

- `<bucket>` — one of the four string literals, in this fixed vocabulary:
  `invalid`, `late`, `duplicate`, `unresolved_chargeback`. Identical to
  the four non-`accepted` audit-log `bucket` values from the audit-log feature.
- `<reason_code>` — short fixed-vocabulary code describing why the event
  was rejected. Per-bucket value sets (see §3.3 below).
- `<shard>` — the bare shard basename (no directory prefix), e.g.
  `a.ndjson`. This matches the `shard` field of the audit-log record for
  the same event.
- `<line_no>` — the **1-based** line number within that shard. This
  matches the `line` field of the audit-log record for the same event
  (bare integer, no leading zeros).
- `<raw_line>` — the original raw input bytes for the rejected event,
  verbatim. Not escaped, not normalized. This is the **same** raw string
  that legacy-format uses as the sole column.

In normal NDJSON input, the raw line contains no embedded tab characters,
so consumers can reliably `split('\t', maxsplit=4)` to recover the five
fields. If an input line happens to contain literal tab characters (rare
but allowed by JSON), the first 4 tabs delimit the first 5 fields and
every subsequent tab is part of the `<raw_line>` column. Consumers should
use a 4-tab-limit split.

### 3.2 Column layout under `--dedup-policy first-arrival`

When `--dedup-policy first-arrival` is active alongside
`--rejects-format tagged`, each reject line gains exactly **two more
tab-separated trailing columns**, appended after `<raw_line>` and before
the trailing `\n`. The on-disk shape becomes:

```
<bucket>\t<reason_code>\t<shard>\t<line_no>\t<raw_line>\t<winner_shard>\t<winner_line>\n
```

(7 columns total.)

The populating rules for the two trailing columns are identical to
the dedup-policy feature §3.6 — with the trailing-column position shifted to accommodate
the new leading metadata:

- **Duplicate bucket, `reason_code: same_run`**: `<winner_shard>` and
  `<winner_line>` are the bare shard basename and 1-based line number of
  the duplicate-group winner under the first-arrival rule. These match
  the `winner_arrival.shard` / `winner_arrival.line` values in the audit
  log for the same record.
- **Duplicate bucket, `reason_code: cross_run`**: no current-run winner
  exists, so both trailing columns are the literal dash `-`. The line
  ends `\t-\t-\n`.
- **Invalid / late / unresolved_chargeback buckets**: no winner concept.
  Both trailing columns are the literal dash `-`. The line ends
  `\t-\t-\n`.

When `--dedup-policy first-arrival` is active but `--rejects-format` is
`legacy`, the dedup-policy feature §3.6 applies — trailing columns AFTER the raw line, no
leading metadata, no bucket/reason columns. Legacy bytes in that
configuration are byte-identical to the dedup-policy feature-8.

### 3.3 `<reason_code>` per bucket

The reason-code vocabulary is identical to the audit-log feature §Record shape per
bucket (audit log) and reuses the same closed string set:

| `<bucket>` | `<reason_code>` values (closed set) |
|---|---|
| `invalid` | `schema_version`, `missing_id`, `missing_ts`, `bad_ts`, `missing_type`, `bad_type`, `missing_user`, `missing_amount`, `bad_amount`, `missing_currency`, `bad_currency`, `missing_ref_id`, `fx_lookup` |
| `late` | `late` (always this literal — late-bucket audit records have no per-record reason code; `late` itself serves as the reason) |
| `duplicate` | `same_run`, `cross_run` |
| `unresolved_chargeback` | `unresolved_chargeback` (always this literal — audit records use the `ref_id` key, not a `reason`) |

For tagged rejects lines whose `raw_line` came from a current-run JSON
object, the emitted code MUST match the `reason` / `dup_reason` /
`bucket` values of the audit-log record for the same event
(`audit_rec.shard == reject.shard` and `audit_rec.line == reject.line`).
This is a **strict multi-field invariant** for those JSON-object rows:
for every such tagged-format rejects line, there exists exactly one
audit-log record with matching `shard`/`line`/`bucket` and, where
applicable, matching `reason` code. Tagged-only rescue rows introduced in
§12 (`not a json object` textual lines and blank-only lines emitted as
`raw_line="-"`) are exempt from this projection invariant.

### 3.4 Ordering within the tagged rejects file

The four-bucket ordering from default base behavior is preserved exactly: all `invalid`
rows first (in arrival order), then all `late` rows (in arrival order),
then all `duplicate` rows (in arrival order), then all
`unresolved_chargeback` rows (in arrival order). Inside each bucket,
arrival order is `(shard_basename ascending, line_no ascending)`. Under
`--dedup-policy first-arrival`, the duplicate-bucket order is over the
first-arrival losers (not the lex-largest-ts losers); this mirrors
the dedup-policy feature §3.6.

### 3.5 Empty-rejects edge case

If no rejects of any bucket were produced, the tagged rejects file is
**zero bytes** (same as legacy). A header line (§3.6) is written only if
the file would otherwise be non-empty AND `--rejects-format-header` was
supplied; an empty rejects file is zero bytes under either flag combo.

### 3.6 Optional `--rejects-format-header`

When `--rejects-format-header` is supplied alongside
`--rejects-format tagged`, a single header line is prepended to the
rejects file before any reject rows. The header starts with a literal `#`
character and uses the SAME tab-separated schema as the rows:

- Default (no `--dedup-policy first-arrival`):

  ```
  #bucket\treason_code\tshard\tline_no\traw_line\n
  ```

  (Five columns, leading `#`.)

- With `--dedup-policy first-arrival`:

  ```
  #bucket\treason_code\tshard\tline_no\traw_line\twinner_shard\twinner_line\n
  ```

  (Seven columns, leading `#`.)

Column names inside the header are emitted in ASCII-sorted-within-group
order: `bucket` comes before `reason_code` (they are in emission order
matching the row columns, NOT re-sorted — the leading `#` is the only
special character). The header bytes are part of the file contract.

If the rejects file would otherwise be zero bytes (no rejects of any
bucket), the header is STILL NOT written — the file remains zero bytes.
This preserves the "empty file is literally zero bytes" contract from
default base behavior even under `--rejects-format-header`.

## 4. Determinism

Given identical `--input-dir`, `--rates`, `--session-gap`,
`--watermark-lag`, any `--state-in`, any existing flag combination, and
any `--rejects-format` / `--rejects-format-header` setting, the rejects
file is byte-identical across repeated runs. The tagged-format columns
(`shard`, `line_no`, `reason_code`, optional `winner_shard`/`winner_line`)
are produced by a deterministic projection of the audit-log reject
records, which are themselves deterministic under the audit-log feature.

## 5. Back-compat invariants (strict)

For every existing pre-format input:

- Omitting `--rejects-format` OR passing `--rejects-format legacy` →
  byte-identical `--rejects` vs. the summary-schema feature CLI. No bytes differ on
  any existing reject file, including all first-arrival trailing-column
  inputs from the dedup-policy feature.
- Omitting `--rejects-format` (or setting it to `legacy`) → byte-identical
  `--output`, `--state-out`, `--audit-log`, `--audit-log-digest`,
  `--out-parquet-manifest`, `--manifest-signature`,
  `--summary-schema-out`, `--summary-schema-digest`,
  `--summary-schema-index` vs. the summary-schema feature default behavior. In particular the
  summary-schema sidecars retain their established summary-schema 6-key shape under legacy
  mode (see §11).
- Passing `--rejects-format tagged` or `--rejects-format tagged-sorted`
  → the following outputs are byte-identical vs. the same invocation
  with `--rejects-format` omitted: `--output`, `--state-out`,
  `--audit-log`. The `--rejects` file differs per §3. The
  `--audit-log-digest` may gain the `rejects_cross_check` block (see
  §10). The `--summary-schema-out`, `--summary-schema-digest`, and
  `--summary-schema-index` sidecars reflect the new `rejects_format`
  7th key (see §11). `--out-parquet-manifest` and `--manifest-signature`
  may differ because the parquet manifest embeds a content-addressed
  sha256/bytes record of the rejects file. All of these remain
  deterministic for any fixed `--rejects-format` value.

the rejects-format feature does NOT add any new key to `--output`, `--audit-log`,
`--state-out`, `--out-parquet-manifest`, or `--manifest-signature`.
the rejects-format feature may add the `rejects_cross_check` block to `--audit-log-digest`
and the conditional `rejects_format` key to the summary-schema sidecars
exactly as specified in §§10-11. the rejects-format feature does NOT change the audit-log on-disk bytes under any flag combination
(the audit log's shape is the source of truth for tagged-rejects column
values, but it is not itself modified).

## 6. Multi-field invariants (always, under either format)

The following cross-file invariants continue to hold under every flag
combination, and these keys are stable:

1. `len(rejects.txt rows with bucket == "invalid") == summary.anomalies.invalid`
2. `len(rejects.txt rows with bucket == "late") == summary.anomalies.late`
3. `len(rejects.txt rows with bucket == "duplicate") == summary.anomalies.duplicate`
4. `len(rejects.txt rows with bucket == "unresolved_chargeback") ==
   summary.anomalies.unresolved_chargeback`
5. Under `--rejects-format tagged --audit-log <path>`: for every tagged
   rejects line R, there is exactly one audit-log record A such that
   `A.shard == R.shard AND A.line == R.line AND A.bucket == R.bucket`,
   and (if A has a `reason`/`dup_reason` key) its value equals
   `R.reason_code`. For `late` records, `R.reason_code == "late"` (the
   audit record has no `reason` key, but the digest's `bucket_counts.late`
   must equal the count of `late` reject lines). For
   `unresolved_chargeback` records, `R.reason_code == "unresolved_chargeback"`.
6. Under `--dedup-policy first-arrival` with `--rejects-format tagged`:
   for every tagged rejects line R with `bucket == "duplicate"` and
   `reason_code == "same_run"`, the `<winner_shard>` / `<winner_line>`
   columns equal `A.winner_arrival.shard` / `A.winner_arrival.line` for
   the matching audit record A.

## 7. Usage-error rules (summary)

- `--rejects-format` with an unknown value → exit `2`, stderr (exact):

  ```
  ingest: --rejects-format: must be one of {legacy, tagged}
  ```

- `--rejects-format tagged` without `--audit-log` → exit `2`, stderr
  (exact):

  ```
  ingest: --rejects-format tagged requires --audit-log
  ```

- `--rejects-format-header` without `--rejects-format tagged` → exit `2`,
  stderr (exact):

  ```
  ingest: --rejects-format-header requires --rejects-format tagged
  ```

- Every other existing usage-error rule is preserved.

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
              [--rejects-format-header]
```

## 9. Extension — `tagged-sorted` (third enum value)

The `--rejects-format` flag accepts a **third** string literal:
`tagged-sorted`. It is a drop-in replacement for `tagged` with a single
behavioral change: the reject rows are DETERMINISTICALLY sorted by the
composite key

```
(bucket_rank, shard, line_no)
```

where `bucket_rank` is the index of the row's bucket in the fixed order

```
[ invalid = 0, late = 1, duplicate = 2, unresolved_chargeback = 3 ]
```

Note that the bucket order is IDENTICAL to the tagged/legacy bucket
order; the difference is that `tagged-sorted` imposes an additional
total ordering inside each bucket — by `(shard ASCII asc, line_no
numeric asc)` — even when a downstream consumer is free to re-sort the
arrival-order rows of `tagged`. This lets consumers diff two rejects
files from pipelines that merged differently-ordered shards.

`tagged-sorted` shares every other property of `tagged`:
- Same 5-column (or 7-column under `--dedup-policy first-arrival`)
  layout.
- Same hard dependency on `--audit-log` (exit 2, stderr
  `ingest: --rejects-format tagged-sorted requires --audit-log`).
- Same empty-rejects zero-byte rule.
- Same optional `--rejects-format-header` support.
- Same cross-file invariants (§6): row-count-per-bucket equals
  `summary.anomalies.<bucket>`.

### 9.1 Additional usage-error rule

Supplying `--rejects-format tagged-sorted` together with
`--rejects-format-header` but WITHOUT `--audit-log` → exit code `2`,
no output files created, and this exact stderr line:

```
ingest: --rejects-format tagged-sorted requires --audit-log
```

(The generic `tagged-sorted requires --audit-log` check fires even
without `--rejects-format-header`; the above fixed stderr explicitly
names the third enum value.)

### 9.2 Enum-value rejection update

The usage-error stderr for an unknown `--rejects-format` value now
reads:

```
ingest: --rejects-format: must be one of {legacy, tagged, tagged-sorted}
```

## 10. Extension — `rejects_cross_check` block in audit-log-digest

When BOTH `--rejects-format` is `tagged` or `tagged-sorted` AND
`--audit-log-digest` is supplied, the audit-log-digest sidecar gains a
new top-level key named `rejects_cross_check`. It is positioned
**between** the `dedup_policy_stats` block (or `resolved_against`, if
`dedup_policy_stats` is absent because `--dedup-policy` was not set)
and the final `sha256` key, i.e. immediately before `sha256` in the
emitted key sequence.

The block's shape:

```
"rejects_cross_check": {
  "rejects_row_count": <int>,
  "audit_reject_record_count": <int>,
  "agree": <bool>
}
```

- `rejects_row_count` — the number of non-header data rows in the
  tagged rejects file.
- `audit_reject_record_count` — the number of audit-log records with
  `bucket != "accepted"`.
- `agree` — `true` iff `rejects_row_count == audit_reject_record_count`;
  `false` otherwise. For well-formed inputs where every JSON-object
  reject round-trips into the audit log, the two counts match and
  `agree == true`; the `agree` flag is surfaced so downstream
  consumers have a one-byte signal of consistency without having to
  re-count.

The block is NOT emitted when `--rejects-format` is `legacy`
(default). This is intentional: downstream consumers who opted into
the canonical tagged shape also opt into the cross-check block.

## 11. Extension — conditional `rejects_format` key in `--summary-schema-out`

The `--summary-schema-out` sidecar gains an OPTIONAL new top-level
key: `rejects_format`. Emission is STRICTLY GATED on the
`--rejects-format` value:

- **`--rejects-format` omitted or `legacy` (default)**: the
  `--summary-schema-out` sidecar MUST be byte-for-byte identical to
  the summary-schema feature default behavior. No new key. Top-level key set remains the
  established summary-schema shape, exactly **6 keys**:

  ```
  schema_version, summary_schema, ingest_id, run_index,
  field_summary, strict_mode
  ```

  This preserves the summary-schema feature established contract: the summary-schema sidecar keeps its exact top-level key order and 6-key count when the rejects-format feature CLI is invoked in
  default/legacy mode.

- **`--rejects-format tagged` or `--rejects-format tagged-sorted`**:
  the sidecar gains a 7th top-level key, `rejects_format`, inserted
  immediately after `strict_mode`. Its value is the resolved
  rejects-format string — either `"tagged"` or `"tagged-sorted"`.
  Total top-level key order becomes:

  ```
  schema_version, summary_schema, ingest_id, run_index,
  field_summary, strict_mode, rejects_format
  ```

  That is **7 top-level keys**, emitted only when the user has
  explicitly opted into one of the canonical tagged formats.

Rationale: the summary-schema-out sidecar is a the summary-schema feature invariant for
legacy-mode runs; the rejects-format feature only amends it for runs that have opted
into a new rejects-format shape. Downstream consumers that never pass
`--rejects-format` observe no the rejects-format feature changes to this sidecar at all.

Because the summary-schema-digest (`--summary-schema-digest`) and
summary-schema-index (`--summary-schema-index`) both derive from the
summary-schema-out bytes, both sidecars reflect the conditional
emission deterministically: legacy-mode digests/indices are
byte-identical to the summary-schema feature; tagged/tagged-sorted digests/indices reflect
the 7-key shape.

## 12. Breaking change — tagged `raw_line` for blank-only input lines

default base behavior defined the NDJSON reader as "collect non-blank lines". Under
the rejects-format feature's tagged / tagged-sorted projections, blank-only input lines
(lines that are empty after whitespace-trim, but are still physically
present in the shard) are RESCUED into the invalid bucket with
`reason_code: schema_version` and `raw_line` emitted as the literal
3-character string `"-"` (a single ASCII hyphen, wrapped in no quotes
and no escaping).

Under `--rejects-format legacy`: behavior is unchanged — blank-only
lines are SKIPPED, never reach a bucket, and never appear in
`rejects.txt`. Existing inputs remain byte-identical.

Under `--rejects-format tagged` and `--rejects-format tagged-sorted`:
blank-only lines are EMITTED as tagged reject rows with
`bucket=invalid`, `reason_code=schema_version`, `shard=<basename>`,
`line_no=<1-based>`, `raw_line="-"`. The determinism contract (§4)
still holds because the 1-based line index is stable within the
shard.

## 13. Summary of the rejects-format feature exits

| Condition | Exit | Stderr (exact) |
|---|---|---|
| `--rejects-format <unknown>` | 2 | `ingest: --rejects-format: must be one of {legacy, tagged, tagged-sorted}` |
| `--rejects-format tagged` without `--audit-log` | 2 | `ingest: --rejects-format tagged requires --audit-log` |
| `--rejects-format tagged-sorted` without `--audit-log` | 2 | `ingest: --rejects-format tagged-sorted requires --audit-log` |
| `--rejects-format-header` without `--rejects-format tagged` or `--rejects-format tagged-sorted` | 2 | `ingest: --rejects-format-header requires --rejects-format tagged` |
