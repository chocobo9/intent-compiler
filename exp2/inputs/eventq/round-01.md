# Event Ingestion CLI — `eventq`

We are building a data-engineering command-line tool that turns raw event logs into clean, currency-normalized summaries. Please implement it from scratch in Go under `/app`. The tool must build into a single executable at `/app/eventq`. The build must be offline (the container has no network at solve time); either vendor your modules or use only the Go standard library. The environment already has Go 1.22.

The overall shape is an `ingest` subcommand that reads a directory of NDJSON event log shards plus a day-partitioned JSON foreign-exchange table, applies ordering/session/watermark rules, and produces a JSON summary plus a rejects file. There is also a `query` subcommand that reads a summary and prints a single line. Everything is deterministic — the same inputs must always yield byte-identical outputs.

## Input: event log shards

The `--input-dir` flag points at a directory. A file in that directory counts as a shard only if **all** of the following hold: it is a regular file (not a directory, and not any kind of symbolic link, regardless of the symlink target); its name ends with `.ndjson`; and its name does **not** begin with a `.` (so `.hidden.ndjson` is ignored even though its name ends in `.ndjson`). Every other entry (subdirectories, symbolic links, files not ending in `.ndjson`, dotfiles regardless of suffix) must be ignored. Each shard is UTF-8 NDJSON (one JSON object per line). Blank lines and lines that contain only whitespace must be ignored (not rejected).

Shards are merged in a single global stream called the **arrival stream**, ordered by `(shard_name ascending, line_index ascending)` where `shard_name` is the bare filename and `line_index` is the 0-based position of the line within its shard. This arrival order drives validation, watermark, dedup tie-breaks, chargeback resolution, and reject ordering throughout this spec.

### Schema v1

```json
{"v": 1, "id": "e-1001", "ts": "2026-03-01T10:15:30Z", "type": "purchase", "user_id": "u-42", "amount": 19.99, "currency": "USD"}
```

### Schema v2

```json
{"v": 2, "id": "e-1002", "ts": "2026-03-01T10:15:30Z", "event_type": "purchase", "actor": "u-42", "amount_cents": 1999, "currency": "USD"}
```

Fields:

- `v` — integer, `1` or `2`. Any other value is invalid.
- `id` — non-empty string (same name in both schemas).
- `ts` — RFC 3339 timestamp in UTC with the trailing `Z`, exactly the form `YYYY-MM-DDTHH:MM:SSZ`. No offsets, no fractional seconds.
- Event-type field — `type` on v1, `event_type` on v2. Valid values are `"purchase"`, `"refund"`, `"chargeback"`, `"signup"`, `"login"`. Anything else is invalid.
- User field — `user_id` on v1, `actor` on v2. Non-empty string.
- Amount field:
  - On v1: `amount` is a JSON number (may be fractional); required for `purchase` / `refund`; must be absent for `signup` / `login` / `chargeback`.
  - On v2: `amount_cents` is a non-negative integer expressed as a JSON number with no fractional part; required for `purchase` / `refund`; must be absent for `signup` / `login` / `chargeback`.
- `currency` — required on `purchase` / `refund`, must be absent on `signup` / `login` / `chargeback`. Must be a currency code present in the rate table for the event's UTC date (see FX section); otherwise the event is invalid.
- `ref_id` — required on `chargeback`, must be absent otherwise. Non-empty string referencing the `id` of a surviving `purchase` event.

Unknown JSON fields on otherwise-valid events must be silently dropped. Mixing v1 and v2 fields in a single record (e.g. both `type` and `event_type`, `amount` plus `amount_cents`, or `user_id` on a v2 event) is invalid.

Negative `amount_cents` (v2) or negative / non-finite `amount` (v1) is invalid. Because input lines are JSON objects, tokens such as `NaN` / `Infinity` are invalid input lines and therefore rejected during validation.

All monetary values in the summary are expressed in **USD with two decimals**.

## Input: day-partitioned FX rates

The `--rates` file is a JSON object mapping an inclusive date range to per-day rates. USD is always 1.0 per day, and rates can differ across days:

```json
{
  "base": "USD",
  "days": {
    "2026-03-01": {"USD": 1.0, "EUR": 1.10, "GBP": 1.27, "JPY": 0.0067},
    "2026-03-02": {"USD": 1.0, "EUR": 1.12, "GBP": 1.28, "JPY": 0.0068}
  }
}
```

Rules (validated before any event is read; on failure exit `2` with the exact message below to stderr and do not create or overwrite `--output` or `--rejects`):

- `base` must be the literal `"USD"`. Otherwise: `error: fx base must be USD`.
- `days` must be a non-empty object; each key must match `YYYY-MM-DD`. Otherwise: `error: fx days invalid`.
- Every day's table must contain `"USD": 1.0`. Otherwise: `error: fx rates must include USD=1.0`.
- Every rate must be a finite positive JSON number. Otherwise: `error: fx rates must be positive finite`.

For a `purchase` / `refund` event whose `ts` has UTC date `D`, the applicable rate map is the `days[D]` entry. If the event's UTC date is not present in `days`, or its `currency` is not in that day's rate map, the event is **invalid** (rejected like any other invalid event — this is not a fatal error).

## `eventq ingest`

```
eventq ingest --input-dir <dir> --rates <path> --output <path> --rejects <path> --session-gap <seconds> --watermark-lag <seconds>
```

- `--input-dir` — directory of `.ndjson` shards.
- `--rates` — day-partitioned FX JSON.
- `--output` — summary JSON path.
- `--rejects` — rejected raw lines path.
- `--session-gap` — positive integer number of seconds; used to segment per-user sessions.
- `--watermark-lag` — non-negative integer number of seconds; see "Watermark" below.

All flags are required. Missing, empty, or out-of-range values (`--session-gap <= 0`, `--watermark-lag < 0`) → exit `2` with `error: ingest requires --input-dir, --rates, --output, --rejects, --session-gap, --watermark-lag` on stderr.

Behavior:

1. Load and validate the FX file. On failure exit `2` with the appropriate message; do not create/overwrite `--output` or `--rejects`.
2. Enumerate `.ndjson` shards in `--input-dir`, sort them by filename ascending, and build the arrival stream: concatenate each shard's non-blank lines in their original order. Each line carries `(shard_name, line_index)` identifying its arrival position.
3. Walk the arrival stream in order, applying **validation + watermark + dedup + chargeback** (see below), then compute aggregates.
4. Write the summary to `--output` and rejects to `--rejects`.

### Watermark

As each line is consumed from the arrival stream, first attempt validation (schema, field, FX date lookup). If validation fails, the line is rejected and **does not** advance the watermark. If validation succeeds, compute the event's UTC-seconds epoch `E`. Let `M` be the largest epoch seen among watermark-passing events so far (undefined if none). If `M` is defined and `E < M - watermark-lag`, the event is **late** — rejected, and does not advance `M`. Otherwise the event is accepted (for dedup/chargeback phases) and `M = max(M, E)`. `watermark-lag=0` means any event strictly earlier than `M` (the current watermark) is late.

Invalid lines that fail earlier checks (bad JSON, wrong schema, etc.) do **not** advance the watermark.

### Dedup

Deduplicate by `id` across both schemas (the same `id` in v1 and v2 still collides) over the watermark-passing events. Keep the record with the lexicographically largest `ts`. If two duplicates share a `ts`, keep the one that appeared **first** in arrival order. Losers are appended to rejects in arrival order.

### Chargebacks

A `chargeback` is a valid event that references a surviving `purchase` by `ref_id`. After dedup, process dedup survivors in arrival order. A chargeback is kept only if, at processing time, a dedup-surviving `purchase` with `id == ref_id` exists whose arrival position is strictly earlier than this chargeback's arrival position, and that purchase has not already been charged back by an earlier-in-arrival chargeback. Otherwise the chargeback is invalid (rejected with the original raw line, in the chargeback bucket of the rejects file — see order below).

When a chargeback is valid, its effect on aggregation is: it remains a surviving event (contributes to `total_events`, `unique_users`, `by_hour.count`) but it also negates the referenced purchase's USD amount from `by_type.purchase.total_usd` and from the referenced purchase's `by_hour` bucket's `total_usd`. The chargeback itself contributes `0` USD. The referenced purchase remains a surviving event (it is not removed from counts or from `unique_users`). Successfully charged-back purchases are still counted in `by_type.purchase.count`.

### Sessions

Group surviving events by user (treat v1 `user_id` and v2 `actor` as the same namespace). Within a user, sort by `ts` ascending, then by arrival order for ties. Start a new session whenever the gap between consecutive events exceeds `--session-gap` seconds (strictly greater than, not greater-or-equal). The resulting `sessions` block aggregates per user in the summary.

### Rejects ordering

The `--rejects` file contains, **in this exact order**:

1. Lines rejected during validation, in arrival order.
2. Late events (watermark) in arrival order.
3. Duplicate losers (dedup), in arrival order.
4. Unresolved chargebacks (no match or already charged back), in arrival order.

Each rejected line is followed by exactly one `\n`. If there are no rejects, write an empty file.

### Summary format

Top-level key order is exact:

```json
{
  "total_events": <int>,
  "unique_users": <int>,
  "by_type": {
    "chargeback": {"count": <int>, "total_usd": <number>, "avg_usd": <number>},
    "login":      {"count": <int>, "total_usd": <number>, "avg_usd": <number>},
    "purchase":   {"count": <int>, "total_usd": <number>, "avg_usd": <number>},
    "refund":     {"count": <int>, "total_usd": <number>, "avg_usd": <number>},
    "signup":     {"count": <int>, "total_usd": <number>, "avg_usd": <number>}
  },
  "by_hour": [
    {"hour": "<YYYY-MM-DDTHH:00:00Z>", "count": <int>, "total_usd": <number>}
  ],
  "sessions": {
    "total": <int>,
    "by_user": [
      {"user": "<id>", "count": <int>, "first_ts": "<ts>", "last_ts": "<ts>", "total_usd": <number>}
    ]
  },
  "time_range": {"min": "<ts or null>", "max": "<ts or null>"},
  "anomalies": {
    "invalid": <int>,
    "late": <int>,
    "duplicate": <int>,
    "unresolved_chargeback": <int>
  }
}
```

Rules:

- `total_events` is the count of surviving events (including surviving chargebacks; excluding all rejects).
- `unique_users` is the number of distinct user identifiers among surviving events.
- `by_type` has exactly five keys in alphabetical order: `chargeback`, `login`, `purchase`, `refund`, `signup`. Inside each entry, keys appear as `count`, `total_usd`, `avg_usd`.
  - `count` is the number of surviving events of that type (chargeback included).
  - For `login`, `signup`, `chargeback`: `total_usd` and `avg_usd` are always `0.00` (chargebacks contribute their negation to `purchase.total_usd`, not to their own row).
  - For `purchase`: `total_usd` is the sum of USD amounts of surviving purchases, minus the USD amounts of purchases that were successfully charged back. `avg_usd` is `total_usd / count` when `count > 0`, else `0.00`. `count` is the number of surviving purchase events (not adjusted by chargebacks).
  - For `refund`: `total_usd` is the sum of surviving refund USD amounts; `avg_usd = total_usd / count` when `count > 0`, else `0.00`.
  - All rounding is half-away-from-zero, applied once at the very end per displayed number.
- `by_hour` is one bucket per UTC hour that contains at least one surviving event. `count` is surviving event count in the bucket (includes surviving chargebacks). `total_usd` is the sum of USD amounts of `purchase` and `refund` in the bucket, minus the USD of any purchase in the bucket that was successfully charged back (the negation lands in the purchase's own bucket, not the chargeback's). Sorted ascending by `hour`. Inner key order `hour`, `count`, `total_usd`.
- `sessions.total` is the total number of sessions across all users.
- `sessions.by_user` is one entry per user present in surviving events, sorted by `user` ascending (lexicographic). For each user, aggregate across **all** their sessions: `count` = total surviving events for that user; `first_ts` / `last_ts` = min / max `ts` among that user's surviving events; `total_usd` = sum of USD amounts of that user's surviving purchases minus successfully-charged-back amounts plus surviving refunds (refunds are positive, chargebacks again reduce purchase totals only). Inner key order `user`, `count`, `first_ts`, `last_ts`, `total_usd`.
- `time_range.min` / `.max` are the smallest and largest `ts` among surviving events. Empty survivors → both `null`, `by_hour` = `[]`, `sessions.total` = `0`, `sessions.by_user` = `[]`.
- `anomalies` reports exactly how many raw lines landed in each rejects bucket. Keys appear in this exact order: `invalid`, `late`, `duplicate`, `unresolved_chargeback`. `invalid` is the count of bucket 1 (validation rejects); `late` is bucket 2 (watermark rejects); `duplicate` is bucket 3 (dedup losers); `unresolved_chargeback` is bucket 4 (chargeback rejects). All values are non-negative integers. If there are no rejects at all, every count is `0` (do not omit the block).
- The file must end with exactly one trailing `\n`, use two-space indentation, no trailing whitespace on lines, and emit money as `X.YZ` (two decimals).

## `eventq query`

```
eventq query --summary <path> --type <type>
```

Reads a summary file produced by `ingest` and prints a single line to stdout:

```
<type> count=<int> total=<total_usd> avg=<avg_usd>
```

`<type>` must be one of the five valid event types; otherwise exit `2` with `error: unknown type: <value>` on stderr. `total` and `avg` are printed as `X.YZ` with exactly two decimals (with a leading `-` if negative), matching the summary file's money format.

## Exit codes

- `0` — success.
- `2` — invalid CLI usage, FX validation failure, unknown `--type`, or a required file not readable.
- `1` — any other runtime error.

Always deterministic: the same inputs must always produce byte-identical `--output` and `--rejects`.
