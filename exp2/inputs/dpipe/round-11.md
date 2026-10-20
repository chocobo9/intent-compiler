Add the following capabilities to `dpipe`.

## New command: `fingerprint`

`dpipe fingerprint --input <path> --output <path>`

Computes a deterministic fingerprint of a CSV dataset for reproducibility verification.

### Output format

```json
{
  "file_hash": "<blake2b-256 hex of raw file bytes>",
  "row_count": 3,
  "column_count": 2,
  "columns": ["col1", "col2"],
  "content_hash": "<blake2b-256 hex of normalized content>"
}
```

Field details:

- **file_hash**: BLAKE2b-256 hex digest of the raw file bytes (same algorithm as manifest).
- **row_count**: number of data rows (excluding header).
- **column_count**: number of columns in the header.
- **columns**: list of column names, sorted alphabetically.
- **content_hash**: BLAKE2b-256 hex digest of "normalized content". Normalized content is constructed by: taking the header line as-is, then sorting all data rows lexicographically, joining everything with `\n`, and appending a trailing `\n`. This ensures the same logical data produces the same hash regardless of original row order.

### Error handling

- Missing input file: exit 1, `ERROR: file not found: <path>`.
- Empty CSV (no header): exit 1, `ERROR: empty CSV`.

Output: 2-space indented JSON with trailing newline.

## New transform: `coalesce`

Combines multiple columns into one by taking the first non-empty value.

```json
{"op": "coalesce", "columns": ["col1", "col2", "col3"], "as": "result"}
```

### Parameters

- `columns`: list of source columns to check (in order).
- `as`: name of the new column (appended after existing columns).

### Behavior

- For each row, iterates through the listed columns in order.
- Takes the first non-empty value found.
- If all listed columns are empty for a row, the result is an empty string.

### Errors

- Any listed column not found: `ERROR: invalid recipe: column <name> not found`.

## Pipeline extension

New step type `"fingerprint"`:
```json
{"type": "fingerprint", "input": "data.csv", "output": "fingerprint.json"}
```

## Lineage extension

The `lineage` command recognizes `"fingerprint"` steps:
- Input: `input` field.
- Output: `output` field.
