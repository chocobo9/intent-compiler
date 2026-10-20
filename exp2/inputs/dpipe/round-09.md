Add the following capabilities to `dpipe`.

## New command: `schema`

`dpipe schema --input <path> --output <path>`

Auto-infers a JSON schema from CSV data. For each column, analyze all data rows:

- **Type detection**: same logic as quality command. Try `strconv.ParseInt` (base 10, 64-bit) on all non-empty values. If all succeed, type is `"int"`. Else try `strconv.ParseFloat` (64-bit) on all. If all succeed, type is `"float"`. Else type is `"string"`.
- **required**: true if no empty values in the column (and total_rows > 0).
- **unique**: true if all non-empty values are distinct AND there is at least one non-empty value.
- **min/max**: for int and float types only. Actual min/max values as numbers. For int type, use integer values. For float type, use float values.
- **enum**: for string type with 10 or fewer unique non-empty values, list them sorted alphabetically. Omit if more than 10 unique values or type is not string.

### Output format

```json
{
  "columns": {
    "age": {"type": "int", "max": 95, "min": 0, "required": true, "unique": true},
    "name": {"type": "string", "required": true, "unique": true},
    "status": {"type": "string", "enum": ["active", "inactive"]}
  },
  "strict": false
}
```

Within each column's constraint object, only include fields that apply:
- Always include `type`.
- Include `required` only if true.
- Include `unique` only if true.
- Include `min` and `max` only for numeric types with non-empty values.
- Include `enum` only for string type with 10 or fewer unique values.

`strict` is always false.

Column keys in the `columns` map are sorted alphabetically (Go's `encoding/json` default for maps).

### Error handling

- Missing input file: exit 1, `ERROR: file not found: <path>`.
- Empty CSV (no header): exit 1, `ERROR: empty CSV`.

Output: 2-space indented JSON with trailing newline.

## New transform: `mask`

Masks sensitive data in a column, producing a new column.

```json
{"op": "mask", "column": "email", "method": "partial", "as": "email_masked"}
```

### Parameters

- `column`: source column.
- `method`: masking method. One of:
  - `"full"`: replace entire value with `"****"`.
  - `"partial"`: keep first 2 characters and last 2 characters, replace middle with `***`. If value has 4 or fewer characters, replace with `"****"`.
  - `"hash"`: SHA256 hex digest of the value, first 8 characters (lowercase).
- `as`: name of the new column (appended after existing columns).

### Behavior

- Empty cells produce empty output cells.
- Non-empty cells are masked according to the method.

### Errors

- Column not found: `ERROR: invalid recipe: column <name> not found`.

## Pipeline extension

New step type `"schema"`:
```json
{"type": "schema", "input": "data.csv", "output": "schema.json"}
```

## Lineage extension

The `lineage` command recognizes `"schema"` steps:
- Input: `input` field.
- Output: `output` field.
