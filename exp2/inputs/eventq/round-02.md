# Incremental Ingest with Durable State

Extend `eventq ingest` so that a sequence of ingest runs can process an event stream **incrementally** while preserving the same semantics that a single monolithic run over all inputs would have produced. This requires a durable state file that captures everything the pipeline needs to carry across runs: the dedup identity set, the advancing watermark, and the set of surviving purchases that remain eligible for a future chargeback. Everything from default base behavior still holds: same input formats, same validation/watermark/dedup/chargeback pipeline, same arrival stream within one run, same surviving-event semantics, same deterministic byte-identical outputs.

## New flags

```
eventq ingest --input-dir <dir> --rates <path> --output <path> --rejects <path> \
              --session-gap <seconds> --watermark-lag <seconds> \
              [--state-in <path>] [--state-out <path>] [--pending-ttl <seconds>] \
              [--max-open-sessions <int>]
```

`--state-in`, `--state-out`, and `--pending-ttl` are all **optional**; each may be omitted independently. `--users-out` / `--by-day-out` from any earlier draft are **not** part of this interface — only base outputs plus the new state file and the optional `state_stats` block in `--output` described below.

- If `--state-in` is supplied and the referenced file exists, the pipeline resumes from that state.
- If `--state-in` is supplied but the file does not exist, treat it as an empty state (cold start) — this is not an error.
- If `--state-out` is supplied, write the post-run state to that path atomically (see atomicity rule below).
- If `--pending-ttl <seconds>` is supplied with a non-negative integer, carry-over purchases older than the TTL are dropped at load time (see TTL rule below). If `--pending-ttl` is omitted or `0`, no TTL filtering occurs.
- If `--max-open-sessions <int>` is supplied with a positive integer, the post-run `state.open_sessions[]` is capped: after constructing the final list (per the rules below), if it has more than `N` entries, evict the entries with the **oldest** `last_ts` (ties broken by `user` lex ascending) until only `N` remain. If `--max-open-sessions` is omitted or `0`, no cap is applied. Negative values exit `2` with the existing usage-error string.
- If neither `--state-in` nor `--state-out` is supplied, the command behaves exactly like default base behavior (no persistence, no `state_stats` block, no TTL logic even if `--pending-ttl` is present).

Usage-error rules (exit `2`) are unchanged from default base behavior for the mandatory flags. Passing an unknown flag or malformed value still exits `2` with the default base behavior error string.

## State file format

The state file is a single JSON object. Keys appear in this exact top-level order: `version`, `watermark`, `seen_ids`, `pending_purchases`, `open_sessions`, `run_index`. The file uses two-space indentation (each nesting level adds two spaces). The file ends with exactly one `\n` and has no trailing whitespace on any line.

### Canonical empty-state example (cold start with no accepted events, byte-for-byte)

```
{
  "version": 1,
  "watermark": {
    "has_max": false,
    "max_ts": null
  },
  "seen_ids": [],
  "pending_purchases": [],
  "open_sessions": [],
  "run_index": 1
}
```

### Canonical populated-state example (byte-for-byte)

```
{
  "version": 1,
  "watermark": {
    "has_max": true,
    "max_ts": "2026-03-01T11:00:00Z"
  },
  "seen_ids": [
    "e1",
    "e2"
  ],
  "pending_purchases": [
    {
      "id": "e1",
      "ts": "2026-03-01T10:00:00Z",
      "user": "u1",
      "usd": 10.00,
      "origin_run": 1
    }
  ],
  "open_sessions": [
    {
      "user": "u1",
      "last_ts": "2026-03-01T11:00:00Z",
      "session_index": 1,
      "start_ts": "2026-03-01T10:00:00Z"
    }
  ],
  "run_index": 1
}
```

Rules:

- `version` is always `1`. If `--state-in` points to an existing file whose parsed `version != 1`, exit `2` with `error: state version unsupported` on stderr. Do not write `--state-out` in this case.
- `watermark.has_max` is `true` iff at least one event has ever been **admitted past the watermark** (i.e., passed schema/FX validation, was not late-rejected, and was not rejected as a cross-run duplicate) across all runs that contributed to this state. Inner key order inside `watermark` is exactly `has_max`, then `max_ts`.
- `watermark.max_ts` is the maximum such admitted `ts` observed across all runs. When `has_max == false`, the value is the literal JSON token `null` (no quotes), exactly as shown. When `has_max == true`, it is a JSON string in `YYYY-MM-DDTHH:MM:SSZ` form.
- `seen_ids[]` is a sorted, deduplicated array of event ids (v1 `id` and v2 `id` share one namespace) for every event that ever reached the cross-run dedup gate — i.e., passed schema/FX validation. This set therefore includes: (a) events that were admitted past the watermark, (b) events rejected as late (bucket 2), but NOT (c) events rejected as invalid (bucket 1) and NOT (d) events that were themselves rejected as cross-run duplicates against a prior run (those ids are already in the set — no duplicates are added). Intra-run same-run duplicate losers (bucket 3 from the original same-run dedup) DO contribute their id (they passed validation). Lexicographic ascending sort.
- `pending_purchases[]` lists every surviving purchase from any prior run that has **not yet been charged back**. Sorted by `ts` ascending, ties broken by `id` ascending. Inner key order inside each entry is exactly `id`, `ts`, `user`, `usd`, `origin_run`. `usd` is formatted with the same two-decimal half-away-from-zero rule as base money. `origin_run` is the 1-based run index that originally produced the purchase.
- `open_sessions[]` lists every user whose session from the most recent contributing run MAY extend into a future run (see "Open-session carry-over" below). Sorted by `user` ascending (user ids are unique in this array). Inner key order inside each entry is exactly `user`, `last_ts`, `session_index`, `start_ts`. `last_ts` is the `ts` of the user's last surviving event across all runs so far. `session_index` is the 1-based session index of that currently-open session as seen in the run where it was last extended. `start_ts` is the `ts` of the first event in that currently-open session (may come from an earlier run than `last_ts`).
- `run_index` is the 1-based counter of completed runs that contributed to this state. Cold start → `run_index: 1`. A state loaded with `run_index: N` and resumed produces a state with `run_index: N+1`.
- An empty array is emitted as `[]` on the same line as its key, e.g. `"seen_ids": [],`. A populated array opens with `[` then a newline, each element indented four spaces, and closes with `]` at the enclosing indentation.
- No keys beyond the above may appear.

### Bucket priority for current-run events

Each current-run event is classified into exactly one bucket in this strict order; the first matching check terminates:

1. `invalid` (bucket 1) — fails schema/FX validation.
2. `late` (bucket 2) — passes validation, but `ts < seeded_max_ts - watermark_lag`.
3. `duplicate` (bucket 3) — passes validation and watermark, but id is in `state.seen_ids` (cross-run) OR loses the intra-run same-id tie-break (base rule).
4. `unresolved_chargeback` (bucket 4) — passes validation/watermark/dedup, is a chargeback whose `ref_id` resolves neither against an earlier-in-arrival current-run surviving purchase that is not already charged back, nor against a non-retired entry in `pending_purchases`.

**Atomicity**: `--state-out` must be written by constructing the full payload in memory, writing to `<state-out>.tmp`, then `rename(<state-out>.tmp, <state-out>)`. If the ingest run exits non-zero for any reason (e.g., `--state-in` version mismatch, FX validation failure), `<state-out>.tmp` must not exist on disk afterward and `<state-out>` must be unchanged.

## Semantic changes to the ingest pipeline when state is supplied

When `--state-in` points to an existing valid state, the pipeline's logical input is the concatenation (in arrival order) of:

1. All events in the current run's `--input-dir` shards (default base behavior arrival-stream ordering: `(shard_name, line_index)`).

plus the **implicit carry-over** from state:

2. A virtual "pre-run" phase consisting of every entry in `pending_purchases[]`, treated as if those purchases had already survived in a prior run. They remain eligible as chargeback targets in the current run but do NOT appear in the current run's `--output` summary or `--rejects` file.

Processing rules:

- **Watermark seed**: at the start of the run, the watermark's `max_ts` is seeded from `state.watermark.max_ts` (if `has_max`). Late-event cutoff is computed against this seeded watermark from the very first event of the current run. As current-run events advance `max_ts`, the updated `max_ts` is what gets persisted to `--state-out`.
- **Dedup across runs**: any current-run event whose `id` is already in `state.seen_ids` is rejected into bucket 3 (duplicate) immediately after validation and watermark admission — placed in rejects in arrival order relative to the current run's other duplicates. These rejected-as-duplicate events do NOT add their id to any state (their id was already there).
- **Cross-run chargeback resolution**: when the current run produces a chargeback with `ref_id = X`, and X is not among the current run's surviving purchases, consult `pending_purchases[]`. If X is present, the chargeback succeeds; the purchase is retired from the carry-over (it will not appear in the next `--state-out.pending_purchases`), and the chargeback counts as a surviving event in the current run's outputs. If X is not found in either source, bucket 4 (unresolved chargeback).
- **Ordering invariant**: a chargeback in the current run can only resolve against a purchase from the current run's arrival-order-earlier position OR from any entry in `pending_purchases`. A chargeback cannot be resolved by a purchase that appears later in the current run (base rule) or by a purchase that was already charged back in a prior run (those aren't in `pending_purchases`).
- **Monetary amounts for cross-run chargebacks**: the USD amount used in summary aggregation and in the chargeback's negation of its referenced purchase uses the `usd` value stored in the `pending_purchases[]` entry (already converted at the purchase's own `ts` day-rate when the earlier run survived it). No FX lookup is performed on the stored `usd`.

## Open-session carry-over

the original sessionization groups a single run's surviving events per user with a new session boundary whenever consecutive events for that user are more than `session_gap` apart. stateful ingest extends this across runs.

Definitions (all evaluated in the current run's processing):
- A user's "surviving events" are those that were admitted past validation, watermark, and cross-run/intra-run dedup, AND were not themselves late-rejected. Chargebacks that resolve against carry-over purchases count as surviving events for their user; unresolved chargebacks do not.
- A "carried entry" is an element of `state.open_sessions[]` loaded from `--state-in`.

Processing rules:

1. **Session extension at run boundary.** For each user `u` with a carried entry `C` and a first current-run surviving event `e_first` for `u`, if `e_first.ts - C.last_ts <= session_gap` (as signed epoch-second difference; must be non-negative), the current run's FIRST session for `u` **extends** `C`. Internally, the session numbering `session_index` for `u`'s first current-run session remains `C.session_index` (NOT incremented). Subsequent sessions for `u` in the current run (triggered by gaps within the current run) increment from there: next is `C.session_index + 1`, then `+2`, and so on. The numbering is observable through `state.open_sessions[].session_index` at run end (see rule 4); `--output.sessions.total` continues to count distinct current-run sessions as in default base behavior. `--output.sessions.by_user[u]` continues to aggregate across all of `u`'s current-run events (its shape is unchanged from default base behavior).
2. **Session close at run boundary.** If a user has a carried entry `C` but EITHER no current-run surviving event arrives for `u`, OR the first current-run surviving event `e_first` satisfies `e_first.ts - C.last_ts > session_gap`, the carried session is considered closed. `u`'s first current-run session is numbered `session_index = C.session_index + 1`, i.e., as if the carried session had concluded at `C.last_ts`. The closed carried entry is not written back to `state.open_sessions` in the post-run state.
3. **No carry entry, fresh user.** If a user has no carried entry, default base behavior sessionization applies as-is, starting at `session_index = 1`.
4. **Writing `state.open_sessions` at run end.** After the current run's surviving events are sessionized (with the extension/close rule above applied to carried entries), the post-run `open_sessions[]` is rebuilt from scratch: for every user `u` that has any surviving event in the current run, emit exactly ONE entry summarizing `u`'s LAST session (the one containing the user's latest surviving event by `ts`):
    - `user` = `u`
    - `last_ts` = `u`'s last surviving event's `ts` in the current run
    - `session_index` = the `session_index` of `u`'s last session under the carry-over numbering rules in this section (which may equal `C.session_index` if the carried session was extended and never re-gapped, or a strictly larger number otherwise)
    - `start_ts` = for an extended session, the carried `C.start_ts`; for a fresh session, the `ts` of the first event in that last session within the current run
  Users that had a carried entry but no current-run surviving event have their entry **dropped** — it is NOT propagated unchanged. (Rationale: without a new event, we cannot confirm the session is still open; the invariant is that `open_sessions` describes sessions that are known-open as of the most recent contributing run.)
5. **Sort order.** `state.open_sessions[]` is sorted by `user` ascending. Users are unique keys in this array.
6. **Dedup interaction.** A current-run event that is rejected as cross-run duplicate (bucket 3) is NOT a surviving event, so it does not extend a carried session and does not appear in any `state.open_sessions` update.
7. **Chargeback interaction.** A current-run chargeback that resolves (same-run or carry-over) IS a surviving event for its `user_id` and DOES participate in session extension/closure like any other event.
8. **`--output.sessions` scope.** `--output.sessions.total` and `--output.sessions.by_user[u]` continue to describe the current run's events only (as in default base behavior) and their shape is unchanged — they do NOT expose `session_index`. Numbering is only observable via `state.open_sessions[].session_index`. This is deliberate: the original output contract is preserved byte-for-byte aside from the state_stats gating, and all of the carry-over numbering lives in the state file.

## What goes into the outputs for the current run

`--output` and `--rejects` continue to describe **only events that arrived in the current run's `--input-dir`**. Cross-run carry-over purchases are not in `--output.total_events`, `--output.by_type`, `--output.by_hour`, `--output.sessions`, `--output.time_range`, or `--output.anomalies`. A current-run chargeback that successfully retires a carry-over purchase:

- IS counted in the current run's `total_events` and `by_type.chargeback` (+1 count, +0.00 to `total_usd` and `avg_usd` — per default base behavior chargebacks have zero USD in aggregates).
- Its referenced purchase's USD is NOT subtracted from any current-run `by_type.purchase.total_usd` (because that purchase belongs to a prior run). Aggregates for purchases in the current run are computed solely from purchases arriving in this run, with same-run chargebacks still negating them exactly as in default base behavior.
- Appears in `sessions.by_user` for its user exactly like any other surviving event in the current run.

`--output.anomalies.duplicate` includes both same-run duplicates (base rule) and cross-run duplicates (matches against `state.seen_ids`). `--output.anomalies.unresolved_chargeback` includes chargebacks that could not be resolved against either current-run or carry-over purchases.

## What goes into `--state-out`

After a successful ingest run:

- `watermark.max_ts` = max of the seeded watermark and the max `ts` of all current-run events admitted past the watermark (the same `max_ts` used during the run).
- `watermark.has_max` = `true` iff at least one event across all runs so far has been admitted past the watermark.
- `seen_ids` = `state.seen_ids ∪ { id of every current-run event that passed validation }` (both accepted and late-rejected events contribute their ids; dedup-rejected events do NOT). Sorted lexicographically ascending. In other words, any event reaching the watermark check contributes its id.
- `pending_purchases` = (`state.pending_purchases` minus entries retired by current-run chargebacks) ∪ (every current-run surviving purchase that was not charged back within the current run). Each new entry uses `origin_run = state.run_index + 1` (or `1` if no state was loaded). Each carry-over entry keeps its existing `origin_run`. Sorted by `(ts asc, id asc)`.
- `open_sessions` = one entry per user who has at least one surviving event in the current run, as described in rule 4 of "Open-session carry-over". Users with a carried entry but no current-run surviving event are dropped. Sorted by `user` ascending.
- `run_index` = `state.run_index + 1` (or `1` for a cold start).

If `--state-out` is supplied but no `--state-in` was supplied (cold start), the produced state's `run_index` is `1` and `origin_run` on every pending purchase is `1`.

## Pending-purchase TTL (`--pending-ttl`)

When `--pending-ttl S` is supplied with `S > 0` AND a state is loaded (via `--state-in` pointing to an existing file), every entry in the loaded `pending_purchases[]` whose `ts` satisfies `ts < seeded_max_ts - S` is **TTL-dropped** during state load:

- TTL is evaluated immediately after the state is parsed and BEFORE any current-run event is processed, using `seeded_max_ts = state.watermark.max_ts` (if `has_max == true`; if `has_max == false`, no entry is dropped regardless of TTL).
- A TTL-dropped entry is not available as a chargeback target in the current run — a current-run chargeback referencing it goes to bucket 4.
- TTL-dropped entries do not appear in the next `--state-out.pending_purchases`. Their `id` was already part of `seen_ids` (they were surviving purchases once), and `seen_ids` retains them unchanged.
- TTL does not apply to cold starts (no `--state-in` or missing `--state-in` file), even if `--pending-ttl` is set.
- TTL drops happen BEFORE watermark seeding influences late-event classification for current-run events; the seeded watermark itself is unchanged by TTL drops.
- Invalid `--pending-ttl` values (negative, non-integer) exit `2` with the existing usage-error string.

## Stale `--state-out` guard

If `--state-out` is supplied and a file already exists at that path, the pipeline must read that existing file's `run_index` before writing:

- If the existing `--state-out` file parses as a valid state JSON with `run_index >= (loaded state.run_index + 1)` (or `>= 1` for a cold start), exit `2` with `error: state-out target is not older than input state` on stderr. Do not overwrite the file; do not leave a `.tmp` behind.
- If the existing `--state-out` file parses with `run_index` strictly less than that threshold, overwrite it normally (via the atomic `.tmp`/rename path).
- If the existing `--state-out` file is not a valid state JSON (corrupt, unreadable, wrong shape), treat it as "older than anything" and overwrite normally — corruption is not an obstruction.
- If `--state-out` does not exist yet, create it normally.

## `state_stats` block in `--output`

When EITHER `--state-in` OR `--state-out` is supplied, `--output` gains a top-level key `state_stats` placed **immediately after** `anomalies` in the JSON object (and therefore before any existing later keys — if your default base behavior summary has no keys after `anomalies`, `state_stats` is last). Its inner keys appear in this exact order:

```
"state_stats": {
  "carry_in_pending": <int>,
  "carry_out_pending": <int>,
  "retired_this_run": <int>,
  "ttl_dropped": <int>,
  "cross_run_duplicates": <int>,
  "open_sessions_carried": <int>,
  "open_sessions_extended": <int>,
  "open_sessions_evicted": <int>,
  "run_index": <int>
}
```

- `carry_in_pending`: size of `pending_purchases[]` loaded from `--state-in` (0 for cold start / missing file), BEFORE TTL drops.
- `carry_out_pending`: size of `pending_purchases[]` that will be persisted in the post-run state (after TTL drops, after retirements, after adding current-run survivors).
- `retired_this_run`: number of carry-over entries retired by current-run chargebacks this run.
- `ttl_dropped`: number of carry-over entries dropped by `--pending-ttl` at load time (0 if `--pending-ttl` is unset or if no state was loaded).
- `cross_run_duplicates`: number of current-run events rejected into bucket 3 specifically because their `id` matched `state.seen_ids` (NOT including same-run duplicate losers).
- `open_sessions_carried`: size of `open_sessions[]` loaded from `--state-in` (0 for cold start / missing file). Counts entries as they appeared in the input state, before extend/close decisions.
- `open_sessions_extended`: number of carried open-session entries whose user's first current-run surviving event satisfied the `<= session_gap` threshold and extended the session (i.e., kept `session_index` rather than incrementing it). Entries that were closed (no current-run event for the user, or gap exceeded) are NOT counted.
- `open_sessions_evicted`: number of open-session entries dropped by the `--max-open-sessions` cap at run end (after all extension/close/closure logic). `0` if `--max-open-sessions` is unset or if the post-run list size is already `<= N`.
- `run_index`: the 1-based run index of THIS run (i.e., `loaded state.run_index + 1`, or `1` for cold start). This equals `state_out.run_index`.

When neither `--state-in` nor `--state-out` is supplied, `state_stats` MUST NOT appear in `--output` — this preserves byte-for-byte base-output compatibility.

## Determinism

With identical `--input-dir`, `--rates`, `--session-gap`, `--watermark-lag`, and identical `--state-in` contents (byte-for-byte), all four output files — `--output`, `--rejects`, `--state-out` — must be byte-identical across runs. `seen_ids` and `pending_purchases` sort orders are total orderings so no ambiguity is possible.

## Consistency with default base behavior

- Without `--state-in` and without `--state-out`, `eventq ingest` behaves **identically** to default base behavior for every existing input. Byte-equivalence with base outputs is required. `state_stats` is NOT emitted.
- With `--state-out` only (no `--state-in`) — a cold start — `--rejects` is identical to the no-state run. `--output` gains the `state_stats` block (with `carry_in_pending=0`, `ttl_dropped=0`, `cross_run_duplicates=0`, `run_index=1`) and is therefore NOT byte-identical to the pure no-state run; this is expected.

These are invariants — violating any means the implementation is wrong.
