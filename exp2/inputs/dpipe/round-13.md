# Snapshot command and clip transform

## Extension: New `snapshot` command

Add a new top-level command `snapshot` that captures a dataset snapshot for reproducibility tracking.

### Usage

```
dpipe snapshot --input data.csv --output snapshot.json
```

### Output format (JSON)

```json
{
  "row_count": 3,
  "column_count": 2,
  "columns": [
    {"name": "id", "non_empty": 3, "distinct": 3},
    {"name": "value", "non_empty": 3, "distinct": 2}
  ],
  "row_hash": "<md5 hex of sorted row content>"
}
```

### Fields

| Field          | Type   | Description                                               |
|----------------|--------|-----------------------------------------------------------|
| `row_count`    | int    | Number of data rows (excluding header)                    |
| `column_count` | int    | Number of columns                                         |
| `columns`      | array  | Array of column stats objects, ordered by header position |
| `row_hash`     | string | MD5 hex digest of sorted row content                      |

### Column stats object

Each element in the `columns` array has:

| Field      | Type   | Description                              |
|------------|--------|------------------------------------------|
| `name`     | string | Column name from header                  |
| `non_empty`| int    | Count of non-empty values in the column  |
| `distinct` | int    | Count of distinct values in the column   |

### Behaviour

- Parse the input CSV file with a header row.
- For each column, count the number of non-empty values and the number of distinct non-empty values.
- The `columns` array preserves the header order.
- `row_hash` is computed as follows:
  1. For each data row, join all cell values with commas to form a single string.
  2. Sort these row strings lexicographically.
  3. Join sorted rows with newline characters.
  4. Compute the MD5 hex digest of the resulting string.
- `row_hash` is the lowercase 32-character MD5 hex digest of that sorted row-content string.

### Errors

- If the input file does not exist: print `"ERROR: file not found: <path>"` and exit with a non-zero status.

### Pipeline support

The `snapshot` command must be available as a pipeline step:

```json
{"type": "snapshot", "input": "data.csv", "output": "snapshot.json"}
```

Lineage reports must recognize `"snapshot"` steps with `input` as the input file and `output` as the output file.

---

## Extension: New `clip` transform

Add a new transform operation `clip` that clips numeric values to a specified range.

### Recipe format

```json
{"op": "clip", "column": "value", "from": "0", "to": "100", "as": "value_clipped"}
```

### Fields

| Field    | Type   | Description                                            |
|----------|--------|--------------------------------------------------------|
| `column` | string | Source column containing numeric values                |
| `from`   | string | Minimum bound (parsed as float at runtime)             |
| `to`     | string | Maximum bound (parsed as float at runtime)             |
| `as`     | string | Name of the new column to append with clipped values   |

### Behaviour

- For each row, parse the source column value as a float.
- If the value is less than `from` (parsed as float), output the `from` value.
- If the value is greater than `to` (parsed as float), output the `to` value.
- Otherwise, output the original value.
- Format the output using `strconv.FormatFloat(val, 'f', -1, 64)`.
- If the source cell is empty, the output cell is empty.
- If the source cell is non-numeric (cannot be parsed as float), the output cell is empty.

### Errors

- If the source column is not found: `"ERROR: invalid recipe: column <name> not found"`
