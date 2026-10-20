Add the following capabilities to `dpipe`.

## New command: `validate`

`dpipe validate --input <path> --schema <path> --output <path>`

Validates a CSV data file against a JSON schema definition and reports all violations.

### Schema format

```json
{
  "columns": {
    "age": {"type": "int", "min": 0, "max": 150, "required": true},
    "email": {"type": "string", "pattern": "^[^@]+@[^@]+$", "unique": true},
    "status": {"type": "string", "enum": ["active", "inactive"]}
  },
  "strict": false
}
```

Column constraint fields:

- `type` (required): `"int"`, `"float"`, or `"string"`. Non-empty values must parse as this type.
- `required` (bool, default false): empty values are violations.
- `min`/`max` (number): for numeric types, values must be within range.
- `pattern` (string): for string type, non-empty values must match this Go regex.
- `unique` (bool, default false): duplicate non-empty values are violations.
- `enum` (array of strings): non-empty values must be in this list (raw CSV string compared).

Top-level `"strict"` (bool, default false): CSV columns not defined in schema produce one violation each.

### Validation rules (per column, in CSV header order)

1. **Type**: non-empty values must parse (`strconv.ParseInt` for int, `strconv.ParseFloat` for float).
2. **Required**: empty cells are violations (one per cell).
3. **Min/Max**: after type check passes, range violations.
4. **Pattern**: string type only, non-matching non-empty values.
5. **Enum**: raw string not in list.
6. **Unique**: second+ occurrence of same non-empty value (row=null in output).

Schema columns missing from CSV: one `"column_missing"` violation each.

### Output format

```json
{
  "valid": false,
  "violations": [
    {"column": "age", "row": 3, "rule": "type", "value": "abc", "message": "expected int, got \"abc\""}
  ],
  "summary": {"total_violations": 1, "columns_checked": 2, "rows_checked": 10}
}
```

Violation fields: `column` (string), `row` (int or null), `rule` (string), `value` (string or null), `message` (string).

Rules: `"type"`, `"required"`, `"min"`, `"max"`, `"pattern"`, `"enum"`, `"unique"`, `"column_missing"`, `"strict"`.

Messages:
- type: `"expected <type>, got \"<value>\""`
- required: `"value is required"`
- min: `"value <value> is below minimum <min>"`
- max: `"value <value> exceeds maximum <max>"`
- pattern: `"value \"<value>\" does not match pattern <pattern>"`
- enum: `"value \"<value>\" is not in allowed values [<values>]"` where `<values>` is the allowed values joined with a comma AND a space (e.g. for allowed values `A`, `B`, `C` the message is `value "D" is not in allowed values [A, B, C]`)
- unique: `"duplicate value \"<value>\" (first at row <N>, repeated at row <M>)"`
- column_missing: `"column \"<name>\" defined in schema but missing from data"`
- strict: `"column \"<name>\" not defined in schema"`

Row is null for: unique, column_missing, strict. Value is null for: required, column_missing, strict.

Summary: `total_violations` (count), `columns_checked` (schema columns present in CSV), `rows_checked` (data row count). `valid` = true iff total_violations is 0.

### Violation ordering

1. CSV header order for present columns, then column_missing (schema key order), then strict (header order).
2. Within same column: type, required, min, max, pattern, enum, unique, column_missing, strict.
3. Within same column+rule: row ascending (null after numbered rows).

### Errors

- Missing input: exit 1, `ERROR: file not found: <path>`.
- Missing schema: exit 1, `ERROR: file not found: <path>`.
- Invalid JSON schema: exit 1, `ERROR: invalid schema: <path>`.

Output: 2-space indented JSON with trailing newline.

## New transform: `crossjoin`

Cartesian product with another CSV file.

```json
{"op": "crossjoin", "right": "other.csv", "columns": ["x", "y"]}
```

- `right`: path to right-side CSV.
- `columns` (optional): right-side columns to include. If omitted, all right columns used (in header order).

Output: left columns then selected right columns. Row count = left × right. Left is outer loop, right is inner loop.

Errors: right file not found → `ERROR: file not found: <path>`. Column not in right file → `ERROR: invalid recipe: column <name> not found`.

## New transform: `checkpoint`

Appends a content fingerprint column.

```json
{"op": "checkpoint", "as": "ckpt", "algorithm": "row_hash"}
```

- `as`: new column name (appended last).
- `algorithm`: `"row_hash"` or `"row_number"`.

`row_hash`: concatenate all cell values with `|` separator, SHA256, first 8 hex chars (lowercase).
`row_number`: 1-based position string.

## Pipeline extension

New step type `"validate"`:

```json
{"type": "validate", "input": "data.csv", "schema": "schema.json", "output": "report.json"}
```
