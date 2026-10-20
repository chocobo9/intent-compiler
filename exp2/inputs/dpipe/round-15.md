# Snapshot SHA-256 migration and tag transform

## Conflict: Snapshot row_hash must use SHA-256

The `snapshot` command currently reports `row_hash` as an MD5 digest. It should now report `row_hash` as the SHA-256 digest of the same sorted row-content string defined for `snapshot`.

The `row_hash` field in the JSON output is now a 64-character lowercase hexadecimal string instead of 32 characters. No other `snapshot` output fields or sorting rules change.

---

## Extension: New `tag` transform

Add a new transform operation `tag` that stamps a constant string value as a new column on every row.

This differs from `derive` (which evaluates expressions) -- `tag` simply assigns a literal value to every row.

### Recipe format

```json
{"op": "tag", "value": "production", "as": "env"}
```

### Fields

| Field   | Type   | Description                                      |
|---------|--------|--------------------------------------------------|
| `value` | string | The constant string to stamp on every row        |
| `as`    | string | Name of the new column to append                 |

### Behaviour

- Appends a new column named by the `as` field to the header.
- Every data row receives the same value from the `value` field.
- If `as` is empty, return the error: `"ERROR: invalid recipe: missing 'as' field"`.

### Errors

- Missing `as` field: `"ERROR: invalid recipe: missing 'as' field"`
