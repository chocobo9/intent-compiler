# Normalize default-method fix and round transform

## Correction: Normalize transform default method

The `normalize` transform supports two explicit methods: `"zscore"` and `"minmax"`. When the `method` field is omitted or empty, normalize should now behave exactly like `"minmax"` instead of producing empty values.

Additionally, when all values in the column are identical (min == max), the default path must output `0` for every row instead of attempting `(value - min) / (max - min)` which would divide by zero.

Required behavior:
- When all numeric values are identical, output `"0"` for every numeric row.
- Otherwise, output `(value - min) / (max - min)` using the same numeric formatting already used by normalize.
- Existing explicit `"zscore"` and `"minmax"` behavior must remain unchanged.

## Extension: New `round` transform

Add a new transform operation called `round` that rounds numeric values in a column to N decimal places.

### Recipe format

```json
{"op": "round", "column": "price", "n": 2, "as": "price_rounded"}
```

### Fields

| Field    | Type   | Description                                  |
|----------|--------|----------------------------------------------|
| `column` | string | Source column containing numeric values       |
| `n`      | int    | Number of decimal places (0 or more)          |
| `as`     | string | Name of the new column to append              |

### Behaviour

- For each row, parse the source column value as a float.
- Round it to `n` decimal places and write exactly `n` digits after the decimal point.
- Append the result as a new column with the name given by `as`.
- If the source cell is empty, the output cell is empty.
- If the source cell is non-numeric (cannot be parsed as float), the output cell is empty.

### Errors

- If the source column is not found: `"ERROR: invalid recipe: column <name> not found"`

Rounding uses the usual half-away-from-zero behavior for decimal places.
