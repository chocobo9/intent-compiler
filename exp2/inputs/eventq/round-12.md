# Run Provenance Sidecars

Add a standalone run-provenance sidecar so operators can see which
`eventq ingest` flag values were observed on the command line and how the set
of input shards was fingerprinted. The new sidecar avoids reconstructing that
information from logs, state files, manifests, and other sidecars.

`eventq ingest` now accepts exactly three new optional flags:
`--run-provenance`, `--run-provenance-digest`, and
`--run-provenance-strict`. When all three flags are absent, every existing
output remains byte-for-byte unchanged. When any of the three flags are
supplied, existing outputs remain identical to a run without them; only the
new provenance sidecar, its digest, or the strict-mode provenance keys appear.

## 1. Flag syntax

```
eventq ingest ... [--run-provenance <path>]
                   [--run-provenance-digest <path>]
                   [--run-provenance-strict]
```

### 1.1 `--run-provenance <path>`

- `--run-provenance` is **optional** and takes a **single string value**
  (a filesystem path). It is absent by default.
- When `--run-provenance` is absent, the CLI does NOT create the
  file at any path; no `--run-provenance` byte stream exists on disk,
  and every existing output remains byte-identical to the default run.
- When `--run-provenance` is supplied, the value MUST be a non-empty
  string. An empty value (`--run-provenance=` or
  `--run-provenance ""`) is a usage error: exit code `2`, no output
  files created (neither `--output` nor `--rejects` nor any sidecar),
  and this exact stderr line:

  ```
  ingest: --run-provenance: value must be non-empty
  ```

- The parent directory of the supplied `--run-provenance` path MUST
  already exist. If it does not exist, exit `2`, no output files
  created, stderr (exact):

  ```
  ingest --run-provenance parent directory does not exist
  ```

- `--run-provenance` composes freely with every existing flag. In
  particular it is NOT gated on `--out-parquet-manifest`,
  `--audit-log`, `--summary-schema-out`, `--sharding-report`, etc.
  A run that passes only
  `--input-dir/--rates/--output/--rejects/--session-gap/--watermark-lag/--run-provenance`
  is valid.
- Validation order: the empty-value check runs at argument-parse time;
  the parent-directory-exists check runs **before** any output file is
  written (including any `--output.tmp` or `--rejects.tmp`).

### 1.2 `--run-provenance-digest <path>`

- `--run-provenance-digest` is **optional** and takes a **single string
  value** (a filesystem path). It is absent by default.
- When absent, the CLI does NOT create the digest file at any path.
- When supplied, the value MUST be a non-empty string. An empty value
  is a usage error: exit code `2`, no output files created, exact
  stderr line:

  ```
  ingest: --run-provenance-digest: value must be non-empty
  ```

- `--run-provenance-digest` REQUIRES `--run-provenance`. Supplying
  `--run-provenance-digest` without `--run-provenance` is a usage
  error: exit code `2`, no output files created, exact stderr line:

  ```
  ingest: --run-provenance-digest requires --run-provenance
  ```

- The parent directory of the supplied path MUST already exist. If it
  does not, exit `2`, no output files created, exact stderr line:

  ```
  ingest --run-provenance-digest parent directory does not exist
  ```

- Validation order: empty-value check → requires-run-provenance check
  → parent-directory-exists check. All three run BEFORE any output
  file is written.

### 1.3 `--run-provenance-strict`

- `--run-provenance-strict` is a **boolean** flag and is absent by
  default. It takes no value; bare `--run-provenance-strict` records
  as `true`, `--run-provenance-strict=false` records as `false`
  (identical convention to `--state-strict`, `--rates-strict`,
  `--sharding-report-strict`).
- `--run-provenance-strict` REQUIRES `--run-provenance`. Supplying
  `--run-provenance-strict` without `--run-provenance` is a usage
  error: exit code `2`, no output files created (neither `--output`
  nor `--rejects` nor any sidecar), this exact stderr line:

  ```
  ingest: --run-provenance-strict requires --run-provenance
  ```

- Under `--run-provenance-strict`, an empty input directory (zero
  conforming shards) is a usage error: exit code `2`, no output files
  created, this exact stderr line:

  ```
  ingest --run-provenance-strict: input-dir has no conforming shards
  ```

  Without `--run-provenance-strict` an empty input directory continues
  to be accepted (`shard_count == 0` with the fixed empty-fingerprint
  literal), unchanged from the default non-strict provenance output.
- Validation order: requires-run-provenance check (fires at argument-
  parse time) → empty-input-dir check (fires right after the
  provenance parent-directory check and BEFORE any output file is
  written).
- `--run-provenance-strict=false` (explicitly disabled) behaves
  identically to `--run-provenance-strict` being absent: no extra
  keys, no empty-input-dir rejection. The flag is recorded in
  `flags["run-provenance-strict"]` either way (observed via
  `fs.Visit`).

## 2. `--run-provenance` file shape

The run-provenance file is pretty-printed JSON with **2-space
indentation** and a **trailing newline**. It is written via `.tmp` +
rename after all other outputs (including every existing sidecar) have
been finalized. Top-level keys appear in exactly this order:

```
schema_version, tool_version, flags, inputs_fingerprint, shard_count
```

When `--run-provenance-strict` is explicitly set to `true` (bare
`--run-provenance-strict` or `--run-provenance-strict=true`), the
top-level key list is extended IN ORDER by two additional keys
immediately after `shard_count`:

```
schema_version, tool_version, flags, inputs_fingerprint, shard_count,
argv_sha256, env_fingerprint
```

The `argv_sha256` and `env_fingerprint` keys are present ONLY when
strict mode is explicitly enabled (true). In every other case —
`--run-provenance-strict` absent, or explicitly `false` — the
top-level key list is the 5-key default. No other top-level keys are
permitted.

- **`schema_version`**: a fixed string literal whose exact value is
  `"eventq.run-provenance/v1"`. Always the very first key; never
  `null`.
- **`tool_version`**: fixed string literal `"eventq/0.5.0"`. Identical
  to the `tool_version` field emitted by existing digests/sidecars.
- **`flags`**: a JSON object; see §2.1.
- **`inputs_fingerprint`**: a 64-char lowercase-hex sha256 string; see
  §2.2. When `shard_count == 0`, the value is the sha256 of the
  empty byte string
  (`"e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"`).
- **`shard_count`**: integer count of conforming shards observed in
  `--input-dir`. Same value as
  `--out-parquet-manifest.input_shards[]` length and
  `--sharding-report.totals.shards` on the same inputs. `>= 0`.

### 2.1 `flags` object

The `flags` object enumerates each `eventq ingest` flag observed via
`fs.Visit` (i.e. **explicitly set on the command line**, not merely
holding a default). Keys are the flag names **without the leading
`--`**, in a fixed enumeration order (see §2.3). Values are JSON
encodings of the observed values.

Value encoding rules (deterministic):

- **String-valued flags** (e.g. `--input-dir`, `--rates`, `--output`,
  `--rejects`, `--state-in`, `--state-out`, `--audit-log`,
  `--audit-log-digest`, `--ingest-id`, `--out-parquet-manifest`,
  `--manifest-signature`, `--dedup-policy`, `--summary-schema-out`,
  `--summary-schema-digest`, `--summary-schema-index`,
  `--rejects-format`, `--session-policy`, `--sharding-report`,
  `--sharding-report-digest`, `--sharding-report-index`,
  `--sharding-report-histogram`, `--sharding-report-sort`,
  `--run-provenance`, `--run-provenance-digest`) →
  JSON strings. File-path-valued flags record the value **as observed**
  on the command line (i.e. the raw argv token). No resolution /
  canonicalization.
- **Integer-valued flags** (e.g. `--session-gap`, `--watermark-lag`,
  `--pending-ttl`, `--max-open-sessions`,
  `--audit-log-rotate-bytes`, `--rates-max-staleness`,
  `--fixed-window-seconds`) → JSON integers.
- **Boolean-valued flags** (e.g. `--state-strict`, `--rates-strict`,
  `--strict-late-audit`, `--summary-schema-strict`,
  `--rejects-format-header`, `--sharding-report-strict`,
  `--run-provenance-strict`) → JSON booleans. A boolean flag passed
  without a value (the standard Go `flag` package convention for bare
  `--state-strict`) records as `true`. `--state-strict=false` records
  as `false`.

Flags that are NOT explicitly set are OMITTED from the `flags`
object — they do NOT appear with `null`, and they do NOT appear with
their default. The object has exactly one key per observed flag.

### 2.2 `inputs_fingerprint` semantics (fixed)

Let `shards` be the list of conforming shard files under
`--input-dir` in **ASCII-ascending basename order** (same order as
the manifest feature's manifest `input_shards` and the sharding-report feature's default sharding-report
ordering). For each shard compute `sha256_hex(shard_bytes)` as a
64-char lowercase hex string. Let `concat` be the byte string formed
by concatenating those hex strings in order (no separator; no
newline). `inputs_fingerprint` is `sha256_hex(concat)`.

When `shards == []`, `concat` is the empty byte string and
`inputs_fingerprint ==
"e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"`.

`inputs_fingerprint` is independent of `--sharding-report-sort`: even
when the sharding-report's `shards[]` is reordered by bytes/sha256,
`inputs_fingerprint` uses the basename-ascending order of the input
directory.

### 2.3 `flags` enumeration order (fixed)

When multiple flags are explicitly set, the `flags` object MUST list
them in exactly this sequence (only the keys that were actually
explicitly set appear; all others are omitted):

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
run-provenance, run-provenance-digest, run-provenance-strict
```

The order does NOT depend on the order the flags were typed on the
command line; it is a fixed enumeration so the sidecar bytes are
reproducible across harness invocations.

### 2.4 `argv_sha256` (strict mode only)

`argv_sha256` is a 64-char lowercase-hex sha256 string binding the
run-provenance file to the argv that produced it, while remaining
independent of absolute filesystem path values.

- Input tokens: `os.Args[1:]` (every argv token except the program
  name).
- Filter: drop every token whose raw bytes contain a forward slash
  (`/`). This removes path-valued flag values (e.g. `--input-dir
  /tmp/in_multi` collapses to just `--input-dir`) and any argv token
  that looks like a filesystem path. Flag names themselves (which
  start with `--` but contain no `/`) are retained.
- Join: remaining tokens joined by a single ASCII space with no
  leading/trailing separators and no trailing newline.
- Hash: `sha256_hex(joined)` where `joined` is the UTF-8 bytes of the
  joined string.

When every argv token is filtered out (pathological case — no non-
path tokens at all), `joined` is the empty string and `argv_sha256`
is the fixed sha256-of-empty literal
`"e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"`.

`argv_sha256` is stable across changes to path values (e.g. moving
the input-dir from `/tmp/a` to `/tmp/b`) and across different working
directories, provided the non-path tokens and their order are
unchanged. Reordering argv DOES change `argv_sha256`.

### 2.5 `env_fingerprint` (strict mode only)

`env_fingerprint` is a 64-char lowercase-hex sha256 string binding
the run to the set of `EVENTQ_*` environment variable **names**
present in the process environment, with values redacted.

- Input: the process environment at the moment the ingest invocation
  begins. Iterate `os.Environ()`; retain every entry whose `NAME=...`
  prefix begins with `EVENTQ_` (ASCII-literal prefix, case-
  sensitive).
- Redact: strip values entirely. Only the variable **name** is used.
- Sort: ASCII-ascending by name.
- Join: each retained name followed by a single LF (`\n`), in sorted
  order. No leading LF. The final byte is always LF when at least one
  name is retained; when zero names are retained, the joined byte
  string is empty.
- Hash: `sha256_hex(joined)`.

When no `EVENTQ_*` variable is set (the common case), `env_fingerprint`
is the fixed sha256-of-empty literal
`"e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"`.

`env_fingerprint` is deliberately redacted: secret values that might
leak via `EVENTQ_API_KEY=...` do NOT contribute to the hash; only the
name-set does. Two runs with identical `EVENTQ_*` name-sets and
different values produce identical `env_fingerprint` bytes.

## 3. `--run-provenance-digest` file shape

The digest sidecar is pretty-printed JSON with **2-space indentation**
and a **trailing newline**. Written via `.tmp` + rename after the
run-provenance file has been written and renamed into place (so the
sha256 is computed on the finalized bytes). Top-level keys appear in
exactly this order:

```
schema_version, provenance_path, provenance_sha256, provenance_bytes, tool_version
```

No other top-level keys are permitted.

- `schema_version`: fixed string literal
  `"eventq.run-provenance-digest/v1"`.
- `provenance_path`: the **bare basename** of the run-provenance file
  (e.g. `"provenance.json"`) — NOT the full path supplied to
  `--run-provenance`.
- `provenance_sha256`: 64-char lowercase hex sha256 of the
  run-provenance file's on-disk bytes (the `.json` file the digest
  describes).
- `provenance_bytes`: integer byte size of the run-provenance file on
  disk.
- `tool_version`: fixed string literal `"eventq/0.5.0"`.

The digest is deterministic: identical inputs and identical flag
values produce byte-identical digest files.

## 4. Invariants (strict)

1. Given identical `--input-dir` contents, identical `--rates` file
   bytes, and identical explicit flag set + values, the
   `--run-provenance` file bytes are byte-identical across repeated
   runs. No wall clock, no hostname, no environment variable
   contributes.
2. `inputs_fingerprint` is a pure function of the input-dir shards
   (their names and bytes); it does NOT depend on any flag value,
   including `--sharding-report-sort`.
3. When `--run-provenance-digest` is supplied, its
   `provenance_sha256` equals `sha256(provenance_file_bytes)` and
   `provenance_bytes` equals `wc -c provenance_file`.
4. The presence or absence of `--run-provenance-digest` does NOT
   change any derived run facts in `--run-provenance`
   (`inputs_fingerprint`, `shard_count`, and, when strict is enabled,
   `argv_sha256` / `env_fingerprint`). Its only effect on the
   `--run-provenance` payload is that `flags["run-provenance-digest"]`
   appears when that flag was explicitly set.
5. The presence of `--run-provenance` / `--run-provenance-digest`
   does NOT change any existing output bytes. All existing sidecars are
   byte-identical to a run with both new flags omitted (everything
   else equal).
6. The `flags` object's key set equals the set of flags observed via
   `fs.Visit` on the current `ingest` invocation. Flags holding
   their default value but NOT passed on argv do NOT appear.
7. `flags["run-provenance"]` IS included whenever
   `--run-provenance` was explicitly set (and it always is when the
   sidecar is emitted); its value is the observed argv token.
   Likewise `flags["run-provenance-digest"]` is included when that
   flag is set.
8. The `flags` object's key iteration order equals the fixed
   enumeration order of §2.3, independent of argv ordering.
9. When `--run-provenance-strict` is NOT explicitly set (absent), the
   on-disk bytes of the `--run-provenance` file are byte-identical to
   the default non-strict provenance output (no `argv_sha256`, no `env_fingerprint`;
   no `"run-provenance-strict"` key inside `flags`). Adding
   `--run-provenance-strict=false` appears inside `flags` but does
   NOT add the two extra top-level keys.
10. `argv_sha256` is invariant under changes to path-valued flag
    values (tokens containing `/`): two runs with identical non-path
    argv tokens but differing `--input-dir` / `--output` / `--rejects`
    path values produce the same `argv_sha256`.
11. `env_fingerprint` is invariant under changes to `EVENTQ_*`
    environment variable **values**: only the name-set contributes.
    Two runs with identical `EVENTQ_*` name-sets and different values
    produce the same `env_fingerprint`.
12. Under `--run-provenance-strict`, an input directory containing
    zero conforming shards is a usage error (exit 2, no output
    files). Without `--run-provenance-strict` the same input
    directory continues to produce `shard_count == 0` and the fixed
    empty-fingerprint literal, unchanged from the default non-strict output.

## 5. Composition with other flags

- The three new flags do NOT change any existing output on any
  input. `--output`, `--rejects`, `--state-out`, `--audit-log`,
  `--audit-log-digest`, `--out-parquet-manifest`,
  `--manifest-signature`, `--summary-schema-out`,
  `--summary-schema-digest`, `--summary-schema-index`,
  `--sharding-report`, `--sharding-report-digest`,
  `--sharding-report-index`, `--sharding-report-histogram` are
  byte-identical to a run with all three new flags omitted.
- Under `--sharding-report-sort bytes` / `sha256`, the
  `--run-provenance` `inputs_fingerprint` is UNCHANGED — it always
  uses basename-ascending order of `--input-dir` shards.
- Under `--session-policy fixed-window` / `hybrid` the provenance
  file records `flags["session-policy"]` (and
  `flags["fixed-window-seconds"]` if set), but `inputs_fingerprint`
  and `shard_count` are unaffected by the policy.
- Under `--dedup-policy lex-largest-ts` the provenance file records
  `flags["dedup-policy"]`, but `inputs_fingerprint` and
  `shard_count` are unaffected.

## 6. Determinism

Given identical `--input-dir` contents, identical `--rates` bytes,
and identical explicit flag set + values, the on-disk bytes of each
produced sidecar are byte-identical across repeated runs. No wall
clock or hostname contributes. Environment only contributes when
`--run-provenance-strict=true`, and then only through the
`EVENTQ_*` name-set encoded into `env_fingerprint` per §2.5; variable
values themselves do not contribute.

## 7. Usage

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
              [--run-provenance-strict]
```
