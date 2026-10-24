# Configurable Session Policy

Add `--session-policy <gap|fixed-window|hybrid>` and
`--fixed-window-seconds <int>` to control how `summary.sessions.total` is
computed.

The default `gap` policy preserves the existing inactivity-based rule: start a
new session whenever the gap between consecutive surviving events for a user is
strictly greater than `--session-gap`, with open-session carry-over across
runs. `fixed-window` replaces that rule for `summary.sessions.total` by
bucketting each user's surviving events into fixed-duration windows anchored at
the user's first surviving event's floored timestamp. `hybrid` combines both
rules: either an excessive inactivity gap or a fixed-window boundary starts a
new session.

The policy affects only `summary.sessions.total`. It does not change
`state.open_sessions[].session_index` or audit-log `session_index`; those fields
continue to use the existing gap-based numbering. Every other output remains
byte-for-byte identical for a fixed input and flag set, aside from downstream
manifest/signature propagation when the summary session count changes.

## 1. Flag syntax

```
eventq ingest ... [--session-policy <gap|fixed-window|hybrid>] \
              [--fixed-window-seconds <int>]
```

- `--session-policy` is **optional**. Omitting it is exactly equivalent
  to supplying `--session-policy gap`. The default is `gap`.
- The flag value MUST be one of the three string literals `gap`,
  `fixed-window`, or `hybrid`. Any other value (including the empty
  string, prefixes like `fixed`, case variants like `Gap`, or any other
  token) is a usage error: exit code `2`, no output files created
  (neither `--output` nor `--rejects` nor any sidecar), and this exact
  stderr line:

  ```
  ingest: --session-policy: must be one of {gap, fixed-window, hybrid}
  ```

- `--session-policy` with no argument value (e.g. `--session-policy` as
  the final token) is also a usage error and must exit `2`; Go's flag
  parser emits its own usage error in that case. The exact stderr line
  for that empty/missing-value case is not part of the portable contract.
- `--fixed-window-seconds` is **optional** in general but **required**
  whenever `--session-policy` is `fixed-window` or `hybrid`:
  - Supplying `--session-policy fixed-window` without
    `--fixed-window-seconds` → exit code `2`, no output files created,
    and this exact stderr line:

    ```
    ingest: --session-policy fixed-window requires --fixed-window-seconds
    ```

  - Supplying `--session-policy hybrid` without `--fixed-window-seconds`
    → exit code `2`, no output files created, and this exact stderr
    line:

    ```
    ingest: --session-policy hybrid requires --fixed-window-seconds
    ```

- `--fixed-window-seconds` value must be a **positive** integer (`>= 1`).
  Zero or negative values supplied together with `--session-policy
  fixed-window` or `--session-policy hybrid` are a usage error: exit
  code `2`, no output files created, and this exact stderr line:

  ```
  ingest: --fixed-window-seconds: must be a positive integer
  ```

  (Go's flag parser naturally rejects non-integer tokens with its own
  usage error before this check fires; the fixed stderr above is for
  the case where the value parses as `0` or a negative integer.)
- Supplying `--fixed-window-seconds` together with `--session-policy gap`
  (or when `--session-policy` is omitted entirely) is a usage error:
  exit code `2`, no output files created, and this exact stderr line:

  ```
  ingest: --fixed-window-seconds requires --session-policy fixed-window or hybrid
  ```

- Validation order: the enum-value check on `--session-policy` runs at
  argument-parse time; the dependency checks between `--session-policy`
  and `--fixed-window-seconds` both run **before** any output file is
  written (including any `--output.tmp` or `--rejects.tmp`).
- `--session-policy` and `--fixed-window-seconds` compose freely with
  every existing flag.

## 2. `gap` policy (default; byte-identical with existing session behavior)

Under `--session-policy gap` (or when the flag is omitted), the
sessionization rule is the existing inactivity-based rule with cross-run
carry-over layered on top. For existing inputs and flag combinations, the
following outputs are byte-for-byte identical to the default behavior:

- `--output` (including `summary.sessions.total` and
  `summary.sessions.by_user[]`).
- `--rejects` (under any `--rejects-format`).
- `--state-out` (including `state.open_sessions[].session_index`).
- `--audit-log` (including per-record `session_index`).
- `--audit-log-digest`.
- `--out-parquet-manifest`, `--manifest-signature`.
- `--summary-schema-out`, `--summary-schema-digest`,
  `--summary-schema-index`.

The session-policy flag does NOT change a single byte of any existing output under
default `gap` policy on any existing input.

## 3. `fixed-window` policy (CONFLICT path)

Under `--session-policy fixed-window`, the original sole-gap session rule
is **replaced** — for the sole purpose of computing
`summary.sessions.total` — by a fixed-window bucketing rule.

Let `W = --fixed-window-seconds` (positive integer). For each user `u`
present in the current run's surviving events, consider `u`'s surviving
events sorted by `(ts ascending, arrival order for ties)` — the same
ordering used by the existing gap-session contract. Let `anchor_u` be the epoch-second
value of `u`'s first surviving event's `ts` floored to a multiple of
`W`: `anchor_u = floor(first_ts_epoch / W) * W`. Each subsequent event
is assigned to window `window_k(u, W) = anchor_u + k*W` where `k` is
the largest non-negative integer such that the event's `ts` epoch is
`>= anchor_u + k*W`. A new session begins whenever two consecutive
events for `u` fall into different windows (i.e. their `k` indices
differ). The first event for `u` always starts session 1.

`summary.sessions.total` under `fixed-window` is the sum across all
users of the number of distinct windows spanned by `u`'s surviving
events.

### 3.1 Fields that change under `fixed-window`

- `summary.sessions.total` — recomputed as above. This is the sole
  field in `--output` whose value differs from the default policy for
  any input that contains at least one user whose surviving events
  span more than one window.

### 3.2 Fields that do NOT change under `fixed-window`

- `summary.sessions.by_user[]` entries are byte-identical to the
  default-policy output (the per-user aggregate is over events, not
  sessions).
- `state.open_sessions[].session_index` retains the existing
  gap-based numbering. The fixed-window rule does NOT renumber
  open-session carry-over.
- Audit-log `session_index` (the audit-log feature §Record shape) retains the
  existing gap-based numbering. The fixed-window rule does NOT renumber
  audit records.
- Every sidecar (`--audit-log-digest`, `--summary-schema-out`,
  `--summary-schema-digest`, `--summary-schema-index`) is
  byte-identical to the default-policy output.
- `--out-parquet-manifest`'s `outputs.summary.sha256` and `.bytes`
  naturally reflect the new `--output` bytes when `summary.sessions.total`
  changed; `--manifest-signature` reflects the new manifest bytes. When
  `summary.sessions.total` happens to be the same under both policies
  (e.g. inputs where no user's events span a window boundary), the
  manifest and signature are byte-identical to the default-policy
  output as well.

### 3.3 Worked example

Fixture: one user `u1` with three surviving events in the same run:

```
t=100  type=purchase  amount=1 USD
t=160  type=login
t=300  type=purchase  amount=2 USD
```

- Under `--session-gap 120` (default `gap` policy):
  - gap(100→160) = 60, not greater than 120 → same session.
  - gap(160→300) = 140, greater than 120 → new session.
  - `summary.sessions.total = 2`.
- Under `--session-policy fixed-window --fixed-window-seconds 180`:
  - `anchor_u1 = floor(100 / 180) * 180 = 0`.
  - t=100 → k=0 (window [0, 180)), session 1.
  - t=160 → k=0 (window [0, 180)), same session.
  - t=300 → k=1 (window [180, 360)), new session.
  - `summary.sessions.total = 2`.
- Under `--session-policy fixed-window --fixed-window-seconds 120`:
  - `anchor_u1 = floor(100 / 120) * 120 = 0`.
  - t=100 → k=0 (window [0, 120)), session 1.
  - t=160 → k=1 (window [120, 240)), new session.
  - t=300 → k=2 (window [240, 360)), new session.
  - `summary.sessions.total = 3`.
- Under `--session-policy hybrid --session-gap 120 --fixed-window-seconds 180`:
  - gap rule splits at 160→300 (new session).
  - fixed-window rule splits at 160→300 (k=0→k=1, new session).
  - union of boundaries → 2 sessions.
  - `summary.sessions.total = 2`.
- Under `--session-policy hybrid --session-gap 120 --fixed-window-seconds 120`:
  - gap rule splits at 160→300.
  - fixed-window rule splits at 100→160 (k=0→k=1) AND 160→300 (k=1→k=2).
  - union of boundaries → 3 sessions.
  - `summary.sessions.total = 3`.

## 4. `hybrid` policy (CONFLICT path)

Under `--session-policy hybrid --fixed-window-seconds W`, a new session
begins whenever EITHER of the following conditions holds for two
consecutive surviving events `e_prev` and `e_cur` of a single user:

- `e_cur.ts_epoch - e_prev.ts_epoch > --session-gap` (default base behavior gap rule), OR
- the fixed-window index of `e_cur` differs from the fixed-window index
  of `e_prev` (the window rule, with `anchor_u` and `W` as in §3).

Equivalently, the per-user session count under `hybrid` is one more
than the number of indices `i` in the sorted event sequence where
either boundary condition fires.

Other than `summary.sessions.total`, `hybrid` preserves the same field
invariants as `fixed-window`: `by_user[]`, state, audit-log, and all
sidecars are byte-identical to the default-policy output, modulo the
manifest/signature propagation of a changed `summary.sessions.total`
integer.

## 5. Determinism

Given identical `--input-dir`, `--rates`, `--session-gap`,
`--watermark-lag`, any `--state-in`, any existing flag combination,
any `--session-policy` value, and any `--fixed-window-seconds` value,
`--output` is byte-identical across repeated runs. The fixed-window
bucketing is a pure arithmetic function of the user's first surviving
event's `ts` and the subsequent events' `ts` values, all of which are
deterministic under default base behavior.

## 6. Back-compat invariants (strict)

For every existing pre-policy input:

- Omitting `--session-policy` OR passing `--session-policy gap` →
  byte-identical `--output`, `--rejects`, `--state-out`, `--audit-log`,
  `--audit-log-digest`, `--out-parquet-manifest`, `--manifest-signature`,
  `--summary-schema-out`, `--summary-schema-digest`,
  `--summary-schema-index` vs. the rejects-format feature CLI.
- Passing `--session-policy fixed-window --fixed-window-seconds W` (for
  any valid `W`) → byte-identical `--rejects`, `--state-out`,
  `--audit-log`, `--audit-log-digest`, `--summary-schema-out`,
  `--summary-schema-digest`, `--summary-schema-index` vs. the
  default-policy invocation. `--output` may differ (only the
  `summary.sessions.total` integer changes when the input contains a
  user whose events span a window boundary). `--out-parquet-manifest`
  and `--manifest-signature` track any change in `--output` bytes.
- Passing `--session-policy hybrid --fixed-window-seconds W` → same as
  `fixed-window` with respect to back-compat invariants.

The session-policy flags do NOT add any new key to any `--output`, `--rejects`,
`--state-out`, `--audit-log`, `--audit-log-digest`,
`--out-parquet-manifest`, `--manifest-signature`, or any of the
summary-schema sidecars under any policy value. The only field whose
VALUE can change between policies is the integer
`summary.sessions.total` (and the manifest/signature bytes that track
`--output`).

## 7. Multi-field invariants (always, under every policy)

- `summary.sessions.total` is a non-negative integer for every policy.
- `summary.sessions.total >= (number of users with at least one
  surviving event)` under every policy (each surviving user contributes
  at least one session).
- `summary.sessions.by_user[].count` equals the number of surviving
  events for that user, under every policy (unchanged from default base behavior).
- Under `hybrid`: for any input and any `W`,
  `summary.sessions.total >= max(gap_policy_total, fixed_window_policy_total)`.

## 8. Usage-error rules (summary)

| Condition | Exit | Stderr (exact) |
|---|---|---|
| `--session-policy <unknown>` | 2 | `ingest: --session-policy: must be one of {gap, fixed-window, hybrid}` |
| `--session-policy fixed-window` without `--fixed-window-seconds` | 2 | `ingest: --session-policy fixed-window requires --fixed-window-seconds` |
| `--session-policy hybrid` without `--fixed-window-seconds` | 2 | `ingest: --session-policy hybrid requires --fixed-window-seconds` |
| `--fixed-window-seconds` supplied with `--session-policy gap` or omitted | 2 | `ingest: --fixed-window-seconds requires --session-policy fixed-window or hybrid` |
| `--fixed-window-seconds 0` or negative with `fixed-window` or `hybrid` | 2 | `ingest: --fixed-window-seconds: must be a positive integer` |

Every other existing usage-error rule is preserved.

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
              [--fixed-window-seconds <int>]
```
