Add the following capabilities to `dpipe`.

## Manifest format change (conflict)

The manifest output format changes. The `blake2b` JSON field is replaced with two new fields:

- `checksum`: contains the hex-encoded hash (same BLAKE2b-256 computation as before).
- `algorithm`: always `"blake2b-256"`.

Old format per entry:
```json
{"path": "file.csv", "size_bytes": 100, "blake2b": "abc123..."}
```

New format per entry:
```json
{"path": "file.csv", "size_bytes": 100, "checksum": "abc123...", "algorithm": "blake2b-256"}
```

The hash computation itself does not change (still BLAKE2b-256). Only the JSON field names change.

## New command: `reconcile`

`dpipe reconcile --left <path> --right <path> --output <path>`

Compares two manifest files (as produced by the `manifest` command) and reports differences.

### Parameters

- `--left`: path to the first (baseline) manifest JSON file.
- `--right`: path to the second (current) manifest JSON file.
- `--output`: path for the reconciliation report JSON file.

### Behavior

1. Read both manifest JSON files (JSON with `files` array of entries).
2. Compare entries by `path` field.
3. Classify each file as:
   - `added`: present in right but not in left.
   - `removed`: present in left but not in right.
   - `modified`: present in both but different `checksum` value.
   - `unchanged`: present in both with same `checksum` value.

### Output format

```json
{
  "added": ["new_file.csv"],
  "removed": ["old_file.csv"],
  "modified": ["changed_file.csv"],
  "unchanged": ["same_file.csv"],
  "summary": {
    "total_left": 3,
    "total_right": 3,
    "added": 1,
    "removed": 1,
    "modified": 1,
    "unchanged": 1
  }
}
```

All arrays (`added`, `removed`, `modified`, `unchanged`) are sorted alphabetically. Output is 2-space indented JSON with trailing newline.

### Error handling

- Missing file: exit 1, `ERROR: file not found: <path>`.
- Invalid JSON: exit 1, `ERROR: invalid manifest: <path>`.

## Pipeline extension

New step type `"reconcile"`:
```json
{"type": "reconcile", "left": "old_manifest.json", "right": "new_manifest.json", "output": "reconcile.json"}
```

## Lineage extension

The `lineage` command recognizes `"reconcile"` steps:
- Inputs: `left` and `right` fields.
- Output: `output` field.
