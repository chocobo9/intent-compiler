Add the following capabilities to `dpipe` and apply the specified behavior correction.

## Behavior Correction: lineage manifest step

The `lineage` command previously treated the `"manifest"` step's `dir` field as a single input node, creating an edge from `dir` to the manifest output file.

This is incorrect. The `manifest` command scans a directory, not a specific input file. The corrected behavior:

- `"manifest"` step has **no input nodes** (empty inputs array `[]`).
- `"manifest"` step still has an output node (the `output` field).
- No edges are created for a manifest step (since there are no inputs to draw edges from).
- The `dir` value is **not** included as a node in the lineage graph.

### Example

For a pipeline with just a manifest step:
```json
{"type": "manifest", "dir": "output_dir", "output": "manifest.json"}
```

The lineage should show:
- Nodes: only `manifest.json` (produced_by step 1)
- Edges: none
- Steps: `[{"index": 1, "type": "manifest", "inputs": [], "output": "manifest.json"}]`

## New transform: `temporal`

Handles time-series operations on a numeric column, computing values based on sequential position.

```json
{"op": "temporal", "column": "price", "function": "diff", "as": "price_diff"}
```

### Parameters

- `column` (string): the source numeric column.
- `function` (string): one of `"diff"`, `"cumsum"`, `"pct_change"`.
- `as` (string): name of the new output column (appended after all existing columns).

### Behavior

Process rows in their current order. For each row:

- `"diff"`: new value = current value - previous value. First row gets empty string.
- `"cumsum"`: new value = cumulative sum of all values from first row to current row.
- `"pct_change"`: new value = (current - previous) / previous. First row gets empty string. If previous value is 0, result is empty string.

Values are formatted using `formatFloat`. Empty source cells produce empty output cells (and do not affect the running state for cumsum, but reset the sequence for diff and pct_change -- i.e., the row after an empty cell also gets empty string for diff/pct_change).

### Errors

- Column not found: `ERROR: invalid recipe: column <name> not found`.
