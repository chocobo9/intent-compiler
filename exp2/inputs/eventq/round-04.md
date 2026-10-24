## Strict Rates and FX Reason Corrections

The audit log currently classifies FX-lookup failures under a single reason
code, `fx_lookup`. That is too coarse: two operationally different failure
modes (unknown currency vs. missing rate entry for a specific date-day) are
lumped together. Split `fx_lookup` into two distinct codes, add an optional
`--rates-strict` flag that additionally distinguishes unusable rate entries,
and extend the audit artifacts with fallback/digest metadata described below.
The non-audit outputs (`--output`, `--rejects`, `--state-out`) keep the
byte-identity guarantees stated here; the audit log and audit digest evolve
according to the detailed rules below.

## What changed from the audit-log feature

### 1. `fx_lookup` split (correction; user-visible in audit log)

The invalid-`reason` vocabulary's `fx_lookup` code is retired. Every audit-log record that would previously have carried `"reason": "fx_lookup"` now carries exactly one of:

- `"fx_unknown_currency"` — the event's `currency` string does NOT appear as a key in ANY day's rates map in `rates.json`. The currency is globally unknown to the FX table.
- `"fx_no_rate_for_date"` — the event's `currency` string DOES appear in at least one day's rates map (it is a known currency), but the specific `(date, currency)` pair — where `date` is derived from the first 10 characters of the event's `ts` — has no entry in that day's rates map.

These two codes replace `fx_lookup` wherever it appeared in the audit-log feature vocabulary and precedence table. The precedence table's slot for the FX lookup check (position 9 in the ordered first-failing-check list from the audit-log feature) is now:

```
9a. fx_unknown_currency
9b. fx_no_rate_for_date
9c. fx_bad_rate            (only fires when --rates-strict is on; see below)
```

All other precedence slots (1–8) are unchanged: earlier checks (`schema_version`, `missing_id`, `missing_ts`/`bad_ts`, `missing_type`/`bad_type`, `missing_user`, `missing_amount`/`bad_amount`, `missing_currency`/`bad_currency`, `missing_ref_id`) still win over any FX-related code when applicable.

This is a user-visible correction to audit-log reason codes: `fx_lookup` is no
longer emitted, and consumers should use `fx_unknown_currency`,
`fx_no_rate_for_date`, or `fx_bad_rate` as applicable.

### 2. `--rates-strict` flag (extension; off by default)

A new optional boolean flag `--rates-strict` is added to `eventq ingest`. It takes no value (presence = on). When the flag is absent (the default), the default mode preserves the corrected audit-log behavior default behavior, with one exception: an event whose currency is known and has a rate entry for its date-day but whose rate value is unusable (NaN, +Inf, -Inf, `0` including `-0`, or any negative finite number) is REJECTED as invalid with reason `"fx_no_rate_for_date"` (the rate entry exists structurally but is semantically absent — "no usable rate for this date"). The only FX-related reason codes emitted without the flag are `fx_unknown_currency` and `fx_no_rate_for_date`.

When `--rates-strict` is present:

- An event whose currency is known and whose `(date, currency)` entry exists, but whose rate is any of: NaN, +Inf, -Inf, `0` (including `-0`), or a negative finite number, is rejected as invalid with reason `"fx_bad_rate"`.
- All other FX outcomes (unknown currency, missing rate for date, valid positive finite rate) are unchanged.

`fx_bad_rate` is therefore only emitted when `--rates-strict` is on. Without the flag, the same event is still rejected — but under the reason `fx_no_rate_for_date` (treating the bad rate as semantically absent).

### 3. `fx_bad_rate` new code

`fx_bad_rate` is the third new invalid-reason code. It is only produced under `--rates-strict`. It appears in the audit log's invalid-bucket `reason` field and may appear as a key of the audit digest's `invalid_reasons` histogram. Its position in the precedence ordering is 9c: it cannot fire unless slots 1–8 pass AND the currency is known AND a rate entry exists for the event's date-day. If any earlier check fails, that code wins.

## Byte-identity invariants (explicit)

The correction is confined to the audit log (and, transitively, the audit digest's `invalid_reasons` histogram when it is requested). Specifically:

- `--output` bytes are UNCHANGED vs. the audit-log feature for every input — `state_stats` keys and values are unchanged, `anomalies.invalid` is unchanged (an event that would have been invalid under the audit-log feature is still invalid under the strict-rates feature; only the audit-log `reason` text differs).
- `--rejects` bytes are UNCHANGED vs. the audit-log feature. The rejects file format never included reason codes, so the split is invisible there.
- `--state-out` bytes are UNCHANGED vs. the audit-log feature.
- `--audit-log` bytes CHANGE for events whose reason used to be `fx_lookup`: they now carry `fx_unknown_currency` or `fx_no_rate_for_date` (and, under `--rates-strict`, events with an unusable rate entry carry `fx_bad_rate` instead of `fx_no_rate_for_date`).
- `--audit-log-digest` bytes may change correspondingly because its `sha256` reflects the new audit bytes and its `invalid_reasons` histogram contains the new codes instead of `fx_lookup`.

### `--rates-strict` is always a no-op on non-audit outputs

Flipping `--rates-strict` on or off never changes `--output`, `--rejects`, or `--state-out` bytes, because events with an unusable rate entry are rejected either way — only the audit-log `reason` field (and, transitively, the digest's `invalid_reasons` histogram and `sha256`) differ between the two modes (`fx_no_rate_for_date` vs `fx_bad_rate`). The rejects file never included reason codes, and `--output`'s `anomalies.invalid` counts all invalid events regardless of reason sub-classification.

### `--rates-strict` and no-event cases

On an empty input directory, or when no event reaches the FX-lookup step (e.g., all are schema-invalid earlier), `--rates-strict` is a pure no-op across all four output streams.

## Usage

```
eventq ingest --input-dir <dir> --rates <path> --output <path> --rejects <path> \
              --session-gap <seconds> --watermark-lag <seconds> \
              [--state-in <path>] [--state-out <path>] [--pending-ttl <seconds>] \
              [--max-open-sessions <int>] \
              [--audit-log <path>] [--audit-log-digest <path>] \
              [--rates-strict] [--rates-max-staleness <seconds>]
```

- `--rates-strict` is optional, valueless, default off.
- It is independent of `--audit-log`. It may be used with or without `--audit-log`. Its only observable effect is on the audit-log `reason` field (and therefore on the digest) for events that hit an unusable rate entry; non-audit outputs (`--output`, `--rejects`, `--state-out`) are byte-identical between the two modes.
- `--rates-strict` has no argument value. Passing it a value (e.g. `--rates-strict=foo`) is a usage error: exit `2` with the existing usage-error string.
- `--rates-max-staleness` is optional, integer seconds, default `0` (off). A negative value is a usage error (exit `2`).

## Rates staleness fallback

the strict-rates feature additionally introduces `--rates-max-staleness <seconds>` (correction to the accepted record shape plus extension of resolution behavior). The default value is `0`, which preserves all strict-rates semantics above; the rest of this section describes what changes when the value is `> 0`.

### Resolution rules (`N = --rates-max-staleness`)

For a monetary event (`purchase`/`refund`) with a known currency that passes schema checks:

1. If the `(date, currency)` pair HAS a rate for the event's exact `YYYY-MM-DD` day, that rate is used (unchanged). `fx_fallback_days = 0`.
2. If the exact-day rate is MISSING and `N == 0`, the event is rejected with `fx_no_rate_for_date` (unchanged).
3. If the exact-day rate is MISSING and `N > 0`, scan every day where the currency has a rate entry. For each such day `d`, compute `abs(day_epoch(d) - day_epoch(event_date))` in seconds (where `day_epoch` treats the date as UTC `00:00Z`). Choose the day with the smallest absolute distance that is `<= N` seconds. On ties (e.g. +1 day and -1 day both present and both within `N`), choose the EARLIER day.
4. If such a day is found, its rate is substituted for the conversion and `fx_fallback_days` is set to the SIGNED calendar-day difference `rate_day - event_day` (negative when the fallback day is earlier).
5. If no fallback day is within `N` seconds, the event is still rejected with `fx_no_rate_for_date`.
6. If the chosen exact-day or fallback rate entry exists but is numerically unusable (NaN/Inf/0/negative), the bad-rate precedence from the strict-rates feature applies: `fx_bad_rate` under `--rates-strict`, `fx_no_rate_for_date` otherwise.

`--rates-max-staleness` never affects `--output`, `--rejects`, or `--state-out` for inputs where resolution would have succeeded or failed identically without it; its only observable effect is that some events that would otherwise have been `fx_no_rate_for_date` are instead accepted (and therefore move from anomalies.invalid to a normal `by_type` bucket — `--output` bytes CAN change when fallback resolution rescues events).

### `fx_fallback_days` on accepted records

Correction to the audit-log accepted-record key order: for `type in {purchase, refund}` accepted records (the "monetary" bucket), `--audit-log` records gain a new key `fx_fallback_days` positioned AFTER `resolved_against`. It is ALWAYS emitted (even when `--rates-max-staleness` is unset and the value is therefore always `0`), so the audit-log bytes for monetary accepted events change relative to the pre-staleness accepted-record shape. This is a correction-style change to the accepted record shape.

- For `purchase`/`refund` accepted events: `fx_fallback_days` is an integer. `0` means the exact-day rate was used; a negative integer means a fallback day earlier than the event was chosen; a positive integer means a fallback day later than the event was chosen.
- For `chargeback`, `signup`, and `login` accepted events: `fx_fallback_days` is NOT emitted (these events do not involve FX).

Updated accepted-record key order:

```
id, ts, type, shard, line, bucket, usd, session_index, resolved_against
    (, fx_fallback_days)   # only when type in {purchase, refund}
```

### `fx_fallback_stats` in the digest

The audit digest gains a new object key `fx_fallback_stats` between `resolved_against` and `sha256`. It is ALWAYS present (all zeros when there are no monetary accepted events). Key order and contents:

```
"fx_fallback_stats": {
  "total_monetary": <int>,        # count of accepted purchase+refund records
  "exact_day": <int>,             # count with fx_fallback_days == 0
  "fallback": <int>,              # count with fx_fallback_days != 0
  "max_fallback_abs_days": <int>  # max(abs(fx_fallback_days)); 0 when fallback==0
}
```

Updated digest top-level key order (9 keys):

```
audit_log, total_records, bucket_counts, invalid_reasons, duplicate_reasons,
resolved_against, fx_fallback_stats, rates_digest, sha256
```

## Rates validation

Add a deterministic pre-flight validation of `rates.json` that runs BEFORE classification (before any event is inspected). Failures are usage-style errors: the CLI exits with code `2` and the message is written to stderr. The four checks, in order:

1. Every key of the `days` map must be a strict ISO date `YYYY-MM-DD`: exactly 10 characters, digits and dashes only (`^[0-9]{4}-[0-9]{2}-[0-9]{2}$`). Any key that fails this pattern → exit `2` with:

   ```
   ingest: rates.json: invalid day key <key>
   ```

2. Every value inside each day's rates map must be a JSON number literal. A JSON string, object, array, bool, or null is rejected → exit `2` with:

   ```
   ingest: rates.json: non-numeric rate for <day>/<currency>
   ```

3. The `base` field is REQUIRED and must be a non-empty JSON string. Missing `base` (or present but non-string / empty string) → exit `2` with:

   ```
   ingest: rates.json: base required
   ```

4. The base currency must have rate `1.0` on EVERY day that has any rates. If any day's rates map omits the base key or has a base value that is not exactly `1.0` → exit `2` with:

   ```
   ingest: rates.json: base currency <base> must have rate 1.0 on day <day>
   ```

These checks replace/augment the pre-existing `fx rates must include USD=1.0`, `fx days invalid`, and `fx base must be USD` errors; they run first, so their messages take precedence for files that violate the new invariants. An empty `days` map or a file that fails to parse as JSON still yields the default base behavior errors (`fx days invalid` / `rates file is not valid json: ...`).

## Rates canonical digest

The audit digest gains a new string field `rates_digest`, positioned between `fx_fallback_stats` and `sha256`. Its value is the SHA-256 (lowercase hex, 64 chars) of a canonical byte serialization of `rates.json`, built as:

```
base=<base>\n
<day1>:<cur1>=<rate_as_canonical_number>\n
<day1>:<cur2>=<rate_as_canonical_number>\n
...
<day2>:<cur1>=<rate_as_canonical_number>\n
...
```

- Days are emitted in ISO-sorted ascending order.
- Within each day, currencies are emitted in ASCII-ascending order.
- `<rate_as_canonical_number>` is the result of Go's `strconv.FormatFloat(v, 'f', -1, 64)` applied to the rate value: no trailing zeros, no leading `+` on positive numbers, `1.0` becomes `1`, `1.10` becomes `1.1`, etc.
- A single trailing newline terminates each line, including the last one.

The digest is computed from the normalized bytes above, not from the input file's bytes. Consequence (the canonicalization invariant): two runs whose `rates.json` files differ only in key ordering (day order, or currency order within a day) or formatting of numeric rates (e.g. `1.10` vs `1.1`) produce byte-identical `rates_digest` values.

`rates_digest` is always present in the digest when `--audit-log-digest` is used — including for empty input (zero-record audit log).

## Interaction with `rates.json` validation

To support the new `fx_bad_rate` code under `--rates-strict`, the strict-rates feature relaxes `rates.json` loading: rate values that are non-finite (NaN/Inf/-Inf), zero, or negative no longer cause the whole file to be rejected at load time. The existing invariants are retained:

- `base` must equal `"USD"`.
- `days` must be present, non-empty, and every key must match `YYYY-MM-DD`.
- Every day's rates map must contain `"USD"` with value exactly `1.0`.

Non-positive, non-finite rates for currencies OTHER than USD are silently accepted at load time. Whether they cause event rejection depends on `--rates-strict`:

- Without `--rates-strict`: events hitting such rates are rejected with `fx_no_rate_for_date` (the rate entry is treated as semantically absent even though it is present in the JSON). (Historically, the original loader would have rejected the whole file; the strict-rates feature widens this so strict and non-strict behavior remain distinguishable.)
- With `--rates-strict`: events hitting such rates are rejected with `fx_bad_rate` instead.

If the base currency rate is missing or not exactly `1.0`, the pre-flight validation above takes precedence and exits `2` with `ingest: rates.json: base currency <base> must have rate 1.0 on day <day>`.

## Determinism

Given identical inputs (input-dir, rates, state-in) and flags (including `--rates-strict`), all outputs — including the audit log and its digest — are byte-identical across runs.
