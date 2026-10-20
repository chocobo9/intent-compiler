# Changelog command and scale transform

## Extension: New `changelog` command

Add a new top-level command `changelog` that compares two CSV files and produces a JSON summary of what changed between them.

### Usage

```
dpipe changelog --before before.csv --after after.csv --output changelog.json
```

### Output format (JSON)

```json
{
  "rows_before": 3,
  "rows_after": 4,
  "columns_before": ["id", "name"],
  "columns_after": ["id", "name", "score"],
  "columns_added": ["score"],
  "columns_removed": [],
  "row_count_change": 1
}
```

### Fields

| Field              | Type     | Description                                         |
|--------------------|----------|-----------------------------------------------------|
| `rows_before`      | int      | Number of data rows in the before file (excl header)|
| `rows_after`       | int      | Number of data rows in the after file (excl header) |
| `columns_before`   | []string | Column names from the before file header            |
| `columns_after`    | []string | Column names from the after file header             |
| `columns_added`    | []string | Columns present in after but not in before          |
| `columns_removed`  | []string | Columns present in before but not in after          |
| `row_count_change` | int      | `rows_after - rows_before`                          |

### Behaviour

- Parse both CSV files using `encoding/csv` with headers.
- Count data rows (excluding header) for each file.
- `columns_before` = header of the before file (as JSON array).
- `columns_after` = header of the after file (as JSON array).
- `columns_added` = columns present in the after header but not in the before header.
- `columns_removed` = columns present in the before header but not in the after header.
- `row_count_change` = `rows_after - rows_before`.
- `columns_added` and `columns_removed` must be JSON arrays (empty `[]`, never `null`).

### Errors

- If the before file does not exist: print `"ERROR: file not found: <path>"` and exit with a non-zero status.
- If the after file does not exist: print `"ERROR: file not found: <path>"` and exit with a non-zero status.

### Pipeline support

The `changelog` command must be available as a pipeline step:

```json
{"type": "changelog", "input": "before.csv", "right": "after.csv", "output": "changelog.json"}
```

For pipeline execution, `input` is the `--before` file and `right` is the `--after` file. Lineage reports must represent a `"changelog"` step with two inputs, `input` and `right`, and one output, `output`.

---

## Extension: New `scale` transform

Add a new transform operation `scale` that multiplies numeric values in a column by a factor and stores the result in a new column.

### Recipe format

```json
{"op": "scale", "column": "price", "factor": 1.1, "as": "price_adjusted"}
```

### Fields

| Field    | Type    | Description                                            |
|----------|---------|--------------------------------------------------------|
| `column` | string  | Source column containing numeric values                |
| `factor` | float64 | Multiplication factor                                  |
| `as`     | string  | Name of the new column to append with scaled values    |

### Behaviour

- For each row, parse the source column value as a float.
- Multiply by the factor.
- Format the result using `strconv.FormatFloat(result, 'f', -1, 64)`.
- Append the result as a new column named by the `as` field.
- If the source cell is empty, the output cell is empty.
- If the source cell is non-numeric (cannot be parsed as float), the output cell is empty.

### Errors

- If the source column is not found: `"ERROR: invalid recipe: column <name> not found"`
