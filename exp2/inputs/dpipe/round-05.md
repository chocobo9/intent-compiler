Add the following capabilities to `dpipe` and apply the specified behavior change.

## Behavior Change: verify command checksum algorithm

The `verify` command previously used SHA256 for computing file checksums. It now uses **BLAKE2b-256** instead.

- The `verify` command still reads the checksum file passed with `--checksum` and compares it against the digest of the file passed with `--file`.
- Checksums in manifest files must now be BLAKE2b-256 hex digests (64 lowercase hex characters).
- The `manifest` command must also produce BLAKE2b-256 checksums (not SHA256).
- The `.sha256` sidecar files produced during `ingest` and `transform` are **removed** — these commands no longer produce sidecar hash files.
- If `<output>.sha256` exists from a previous run, `ingest` and `transform` must remove it.
- BLAKE2b-256 means the standard 256-bit BLAKE2b digest, encoded as 64 lowercase hexadecimal characters.

This change affects:
1. `manifest` command: produces BLAKE2b-256 checksums instead of SHA256.
2. `verify` command: validates against BLAKE2b-256 checksums.
3. `ingest` command: no longer writes `.sha256` sidecar files.
4. `transform` command: no longer writes `.sha256` sidecar files.

## New command: `lineage`

`dpipe lineage --config <path> --output <path>`

Traces data lineage through a pipeline configuration, producing a directed acyclic graph (DAG) of file dependencies.

### Parameters

- `--config`: path to a pipeline JSON configuration file (same format as the `pipeline` command).
- `--output`: path for the lineage report JSON file.

### Behavior

Read the pipeline configuration and analyze each step to determine which files are inputs and which are outputs. Build a dependency graph without executing the pipeline.

For each step type, determine inputs and outputs:

- `"ingest"`: input = `file`, output = `output`
- `"transform"`: inputs = `input` + `recipe`, output = `output`
- `"profile"`: input = `input`, output = `output`
- `"compare"`: inputs = `left` + `right`, output = `output`
- `"manifest"`: input = `dir` (treated as a single node), output = `output`
- `"verify"`: inputs = `file` + `checksum`, output = none (terminal step)
- `"validate"`: inputs = `input` + `schema`, output = `output`
- `"drift"`: inputs = `baseline` + `current`, output = `output`

### Output format

```json
{
  "nodes": [
    {"id": "data.csv", "type": "file", "produced_by": null},
    {"id": "clean.csv", "type": "file", "produced_by": 1},
    {"id": "report.json", "type": "file", "produced_by": 2}
  ],
  "edges": [
    {"from": "data.csv", "to": "clean.csv", "step": 1},
    {"from": "clean.csv", "to": "report.json", "step": 2}
  ],
  "steps": [
    {"index": 1, "type": "transform", "inputs": ["data.csv", "recipe.json"], "output": "clean.csv"},
    {"index": 2, "type": "profile", "inputs": ["clean.csv"], "output": "report.json"}
  ]
}
```

**Nodes**: Every unique file path mentioned as input or output across all steps. Each node has:
- `id` (string): the file path.
- `type` (string): always `"file"`.
- `produced_by` (int or null): the 1-based step index that produces this file, or null if not produced by any step (external input).

**Edges**: For each step, one edge from each input file to the output file. Each edge has:
- `from` (string): input file path.
- `to` (string): output file path.
- `step` (int): 1-based step index.

Steps with no output (e.g., `"verify"`) produce no edges and no output node.

**Steps**: Each step summarized with:
- `index` (int): 1-based step index.
- `type` (string): step type.
- `inputs` (array of strings): input file paths.
- `output` (string or null): output file path, null if step has no output.

### Ordering

- Nodes sorted by `id` lexicographically.
- Edges sorted by `step` ascending, then by `from` lexicographically.
- Steps sorted by `index` ascending.

### Error handling

- Missing config file: exit 1, `ERROR: file not found: <path>`.
- Invalid JSON: exit 1, `ERROR: invalid pipeline config: <path>`.

Output: 2-space indented JSON with trailing newline.

## Pipeline extension

The `pipeline` command now supports the `"lineage"` step type:

```json
{"type": "lineage", "config": "pipeline.json", "output": "lineage.json"}
```

- `config`: path to pipeline config to analyze.
- `output`: output path for lineage report.
