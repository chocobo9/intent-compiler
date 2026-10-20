Add the following capabilities to `dpipe`.

## New global flag: `--audit`

Any `dpipe` command can accept an optional `--audit <path>` flag. When present, after the command completes (successfully or with error), an execution metadata entry is appended to a JSON audit log file at the given path.

### Audit log format

The audit log file is a JSON array of entry objects. If the file does not exist, create it with a single-element array. If the file exists and contains a valid JSON array, append the new entry to the array and write it back. If the file exists but is not a valid JSON array, overwrite it with a single-element array containing just the new entry.

Each entry has these fields:

- `command` (string): the command name (e.g., `"ingest"`, `"transform"`, `"manifest"`).
- `args` (array of strings): the command arguments (excluding the command name itself and the `--audit` flag and its value).
- `timestamp` (string): UTC ISO 8601 timestamp when execution started, format `"2006-01-02T15:04:05Z"`.
- `duration_ms` (int): execution duration in milliseconds.
- `success` (bool): true if the command completed without error, false otherwise.
- `error` (string or null): the error message if `success` is false, null otherwise.
- `input_size` (int or null): byte size of the primary input file, null if not applicable. Primary input is: `--input` for transform/profile/validate, `--file` for verify, `--input` for ingest, `--left` for compare, `--baseline` for drift, `--config` for pipeline/lineage. Null for manifest and any command without an identifiable input.
- `output_size` (int or null): byte size of the primary output file after execution, null if not applicable or if execution failed. Primary output is `--output` for most commands. Null for verify (no output file) and pipeline.

### Output format

2-space indented JSON array with trailing newline.

### Example

```json
[
  {
    "command": "transform",
    "args": ["--input", "data.csv", "--recipe", "recipe.json", "--output", "out.csv", "--seed", "42"],
    "timestamp": "2024-01-15T10:30:00Z",
    "duration_ms": 45,
    "success": true,
    "error": null,
    "input_size": 1024,
    "output_size": 512
  }
]
```

## New transform: `impute`

Fills missing (empty) values in a column using a statistical method computed from non-empty values in that column.

```json
{"op": "impute", "column": "age", "method": "mean"}
```

### Parameters

- `column` (string): the column to impute.
- `method` (string): one of `"mean"`, `"median"`, `"mode"`.

### Behavior

1. Collect all non-empty values in the column. Parse them as float64.
2. Compute the fill value:
   - `"mean"`: arithmetic mean of numeric values.
   - `"median"`: median using the same percentile calculation as the profile command (linear interpolation at p=50).
   - `"mode"`: most frequent value. If tie, pick the smallest numeric value.
3. Replace every empty cell in the column with `formatFloat(fillValue)`.
4. If no non-empty numeric values exist, leave empty cells unchanged.

### Errors

- Column not found: `ERROR: invalid recipe: column <name> not found`.

## Pipeline extension

The `pipeline` command now supports the `"audit"` behavior: when the pipeline itself is invoked with `--audit`, the audit log records the pipeline execution, not individual steps within it.
