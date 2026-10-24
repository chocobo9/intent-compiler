## Ingest Manifest (`--out-parquet-manifest` + `--ingest-id`)

Add a new user-visible capability — a per-run **ingest manifest** — without changing any of the output bytes produced by existing flags. Two new flags are introduced and work in combination:

- `--ingest-id <string>`: an optional, user-supplied label for the run.
- `--out-parquet-manifest <path>`: an optional path; when set, the CLI writes a JSON manifest describing the run.

When neither new flag is passed, the CLI behaves byte-for-byte identically to the strict-rates feature (including `--output`, `--rejects`, `--state-out`, `--audit-log`, `--audit-log-digest`).

## What's new

### 1. `--ingest-id <string>` (extension; optional)

A free-form label attached to this run. Constraints (validated at argument-parse time, before any I/O):

- Must be a non-empty string, 1..128 characters long.
- Must match the regex `^[A-Za-z0-9][A-Za-z0-9_.:-]*$` — i.e. start with an ASCII letter or digit, followed by zero or more letters, digits, underscores, dots, colons, or dashes.
- An empty value, a value containing any disallowed character (spaces, slashes, etc.), or a leading `-`/`_`/`.`/`:`  → exit code `2` with the exact stderr message:

  ```
  ingest: --ingest-id: invalid (must match ^[A-Za-z0-9][A-Za-z0-9_.:-]*$, 1..128 chars)
  ```

- When `--ingest-id` is absent, the `ingest_id` value that appears in the manifest (see below) is JSON `null`, **not** an empty string.
- `--ingest-id` on its own — without `--out-parquet-manifest` — is a no-op for `--output`, `--rejects`, `--state-out`, `--audit-log`, and `--audit-log-digest`. Their bytes are byte-for-byte identical to a run that did not pass `--ingest-id`.

### 2. `--out-parquet-manifest <path>` (extension; optional)

When set, after all other outputs have been finalized the CLI emits a JSON manifest at the given path. The parent directory must exist (if it does not, exit `2` with a usage-style error).

### Manifest schema

The manifest is pretty-printed JSON with **2-space indentation** and a **trailing newline**. The top-level keys appear in exactly this order:

```
schema_version, ingest_id, run_index, rates_digest, input_shards, outputs, window
```

Example (newlines shown for readability):

```json
{
  "schema_version": "eventq.manifest/v1",
  "ingest_id": "run.2026-04-19_abc-123",
  "run_index": 1,
  "rates_digest": "<64-hex>",
  "input_shards": [
    {"shard": "a.ndjson", "sha256": "<64-hex>", "bytes": 123, "events_total": 4, "events_accepted": 3},
    {"shard": "b.ndjson", "sha256": "<64-hex>", "bytes": 45,  "events_total": 1, "events_accepted": 1}
  ],
  "outputs": {
    "summary":      {"path": "out.json",      "sha256": "<64-hex>", "sha256_short": "<12-hex>", "bytes": 456},
    "rejects":      {"path": "rej.txt",       "sha256": "<64-hex>", "sha256_short": "<12-hex>", "bytes": 0},
    "state":        {"path": "state.json",    "sha256": "<64-hex>", "sha256_short": "<12-hex>", "bytes": 789},
    "audit_log":    {"path": "au.ndjson",     "sha256": "<64-hex>", "sha256_short": "<12-hex>", "bytes": 234},
    "audit_digest": {"path": "digest.json",   "sha256": "<64-hex>", "sha256_short": "<12-hex>", "bytes": 345}
  },
  "window": {
    "min_ts": "2026-03-01T10:00:00Z",
    "max_ts": "2026-03-01T12:30:00Z",
    "events_accepted_total": 5,
    "events_rejected_total": 2,
    "bucket_counts": {
      "accepted": 5,
      "duplicate": 1,
      "invalid": 1,
      "late": 0,
      "unresolved_chargeback": 0
    }
  }
}
```

#### Field definitions

- **`schema_version`**: a fixed string literal whose exact value is `"eventq.manifest/v1"`. It is always the very first key in the manifest and is never `null`.
- **`ingest_id`**: the value passed via `--ingest-id`, as a JSON string. JSON `null` when the flag is absent.
- **`run_index`**: an integer. `priorState.run_index + 1` when `--state-in` points to an existing valid state; otherwise `1` (including cold start and the stateful ingest case where `--state-in` was supplied but the file does not exist). This matches the stateful ingest `state_stats.run_index` semantics exactly.
- **`rates_digest`**: the 64-character lowercase-hex canonical digest of `rates.json`, identical to the `rates_digest` field in the audit-log digest (the strict-rates feature). `--rates` is always required, so this is always a 64-hex string, never `null`.
- **`input_shards`**: an array of per-shard records, **sorted by basename in ASCII-ascending order**. Each record has exactly these keys in order:
  - `shard`: the basename of the shard file (e.g. `a.ndjson`).
  - `sha256`: 64-char lowercase hex of the shard file's raw bytes on disk.
  - `bytes`: integer byte size of the shard file (`wc -c`).
  - `events_total`: number of non-blank lines in the shard (i.e. lines counted toward the ingest run, regardless of whether they parsed as JSON).
  - `events_accepted`: number of lines from this shard whose final audit-bucket is `accepted`. `late`/`invalid`/`duplicate`/`unresolved_chargeback` events do NOT count. Each shard contributes even if 0 events.
- **`outputs`**: an object with exactly five keys in this order:
  - `summary`: always present (always a JSON object of `{path, sha256, sha256_short, bytes}`). `path` is the basename, `sha256`/`bytes` reflect the final on-disk file.
  - `rejects`: always present.
  - `state`: `{path, sha256, sha256_short, bytes}` if `--state-out` was set; otherwise JSON `null`.
  - `audit_log`: `{path, sha256, sha256_short, bytes}` if `--audit-log` was set; otherwise JSON `null`.
  - `audit_digest`: `{path, sha256, sha256_short, bytes}` if `--audit-log-digest` was set; otherwise JSON `null`.
  - Each inner object's keys appear in order: `path`, `sha256`, `sha256_short`, `bytes`.
  - `sha256_short` is the first 12 characters of `sha256` (lowercase hex).
- **`window`**: an object with exactly five keys in this order:
  - `min_ts`: ISO-8601 Z-timestamp of the accepted event with the smallest `ts`, or JSON `null` when no event was accepted.
  - `max_ts`: ISO-8601 Z-timestamp of the accepted event with the largest `ts`, or JSON `null` when no event was accepted.
  - `events_accepted_total`: sum of `events_accepted` across all shards (i.e. total accepted events from this run).
  - `events_rejected_total`: total count of non-accepted outcomes across all shards = `invalid + late + duplicate + unresolved_chargeback` (matches the four anomaly buckets in `--output.anomalies`).
  - `bucket_counts`: an object with **exactly these 5 keys in ASCII-sorted order**: `accepted`, `duplicate`, `invalid`, `late`, `unresolved_chargeback`. Each value is a non-negative integer counting this run's per-bucket classification totals (current-run only, mirroring the audit-log digest's `bucket_counts` semantics from the audit-log feature). All 5 keys are always emitted, even when the input is empty (values = 0). `accepted` equals `events_accepted_total`; `invalid + late + duplicate + unresolved_chargeback` equals `events_rejected_total`.

### 3. `--manifest-signature <path>` (extension; optional)

When set, and only in combination with `--out-parquet-manifest`, after the manifest has been finalized the CLI writes a small sidecar JSON file at the signature path describing the manifest. It is pretty-printed with **2-space indentation** and a **trailing newline**, and is written via `.tmp`+rename.

The top-level keys appear in exactly this order:

```
manifest_path, manifest_sha256, manifest_bytes, signed_at_utc, tool_version
```

- `manifest_path`: the basename of the manifest file (string).
- `manifest_sha256`: 64-char lowercase-hex SHA-256 of the manifest file's on-disk bytes (computed **after** the manifest has been atomically renamed into place).
- `manifest_bytes`: integer byte size of the manifest file on disk.
- `signed_at_utc`: fully **deterministic** — set to the manifest's `window.max_ts` string when present (a non-null ISO-8601 Z-timestamp). When `window.max_ts` is JSON `null` (no accepted events), `signed_at_utc` is the fixed fallback string `"1970-01-01T00:00:00Z"`. The CLI never reads the wall clock.
- `tool_version`: the fixed string literal `"eventq/0.5.0"`.

Example:

```json
{
  "manifest_path": "manifest.json",
  "manifest_sha256": "<64-hex>",
  "manifest_bytes": 987,
  "signed_at_utc": "2026-03-01T12:30:00Z",
  "tool_version": "eventq/0.5.0"
}
```

#### Usage errors for `--manifest-signature`

- `--manifest-signature` without `--out-parquet-manifest` → exit `2`, stderr (exact):
  ```
  ingest: --manifest-signature requires --out-parquet-manifest
  ```
- `--manifest-signature` whose parent directory does not exist → exit `2` with a usage-style error.

### 4. Outputs extended with `sha256_short`

Each output object inside the manifest's `outputs{}` block (`summary`, `rejects`, and — when the corresponding flag is set — `state`, `audit_log`, `audit_digest`) gains a new field `sha256_short`: the first 12 characters of the already-computed lowercase-hex `sha256`. Keys within each output object appear in exactly this order: `path`, `sha256`, `sha256_short`, `bytes`.

### Atomicity and determinism

- The manifest is written as `<path>.tmp` and then atomically renamed to `<path>`. On any error after writing `.tmp`, the `.tmp` file must not persist.
- The manifest is written **after all other outputs have been finalized**, so the `sha256` / `bytes` fields reflect the final on-disk bytes of those outputs (including the audit log after its own `.tmp+rename`).
- Given identical inputs (`--input-dir`, `--rates`, `--state-in`, all other flags including `--ingest-id`), two runs produce a byte-identical manifest. Shard ordering is deterministic (ASCII-sorted basenames). Map iteration is never exposed.

### Invariants (strict)

When the new flags are off, the strict-rates feature behavior is preserved bit-for-bit:

- Without `--ingest-id` and without `--out-parquet-manifest`: `--output`, `--rejects`, `--state-out`, `--audit-log`, `--audit-log-digest` bytes are identical to the strict-rates feature for any input.
- Adding `--ingest-id` alone (no manifest): `--output`, `--rejects`, `--state-out`, `--audit-log`, `--audit-log-digest` bytes unchanged.
- Adding `--out-parquet-manifest` alone (no ingest-id) or together with `--ingest-id`: `--output`, `--rejects`, `--state-out`, `--audit-log`, `--audit-log-digest` bytes still unchanged; the only new artifact is the manifest file at the specified path.
- On any manifest write error, the CLI exits non-zero and no `<manifest>.tmp` file remains on disk.

### Usage errors

- `--ingest-id` with an invalid value (empty, too long, bad characters) → exit `2`, stderr:
  ```
  ingest: --ingest-id: invalid (must match ^[A-Za-z0-9][A-Za-z0-9_.:-]*$, 1..128 chars)
  ```
- `--out-parquet-manifest` whose parent directory does not exist → exit `2`, stderr:
  ```
  ingest --out-parquet-manifest parent directory does not exist
  ```
- `--out-parquet-manifest` with an empty value → exit `2` (Go's flag parser already reports a usage error; the net effect is still a non-zero exit).

## Usage

```
eventq ingest --input-dir <dir> --rates <path> --output <path> --rejects <path> \
              --session-gap <seconds> --watermark-lag <seconds> \
              [--state-in <path>] [--state-out <path>] [--pending-ttl <seconds>] \
              [--max-open-sessions <int>] \
              [--audit-log <path>] [--audit-log-digest <path>] \
              [--rates-strict] [--rates-max-staleness <seconds>] \
              [--ingest-id <string>] [--out-parquet-manifest <path>] \
              [--manifest-signature <path>]
```

- `--ingest-id` is valueless-checked to be a 1..128-char string matching the documented regex; default unset.
- `--out-parquet-manifest` is optional; default unset. When unset, no manifest file is created.
- `--manifest-signature` is optional; default unset. Requires `--out-parquet-manifest` to be set; otherwise exits 2.
