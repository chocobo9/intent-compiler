Add the following capability to `dpipe`.

## New command: `quality`

`dpipe quality --input <path> --output <path>`

Computes a data quality score for a CSV file based on three dimensions: completeness, consistency, and uniqueness.

### Parameters

- `--input`: path to the CSV file to analyze.
- `--output`: path for the quality report JSON file.

### Behavior

Read the CSV file. For each column, compute:

1. **Completeness**: the fraction of non-empty cells in the column. `completeness = non_empty_count / total_rows`. If total_rows is 0, completeness is 1.0.

2. **Consistency**: the fraction of non-empty values that match the detected column type. Type detection:
   - Try parsing all non-empty values as integers (`strconv.ParseInt`, base 10, 64-bit). If all succeed, type is `"int"`.
   - Otherwise, try parsing all as floats (`strconv.ParseFloat`, 64-bit). If all succeed, type is `"float"`.
   - Otherwise, type is `"string"` (all values are consistent for string type).
   
   `consistency = matching_count / non_empty_count`. If non_empty_count is 0, consistency is 1.0.
   
   For `"string"` type, consistency is always 1.0. For `"int"` and `"float"` types, consistency is the fraction of non-empty values that parse successfully as that type. Since type detection already ensures all values parse, consistency for detected int/float is also 1.0. However, if the column has mixed types (some int, some float-only like "1.5"), the detected type would be float, and consistency would reflect how many parse as float.

3. **Uniqueness**: the ratio of unique non-empty values to total non-empty values. `uniqueness = unique_count / non_empty_count`. If non_empty_count is 0, uniqueness is 1.0.

### Per-column output

For each column, output an object with:
- `name` (string): column name.
- `completeness` (float): completeness score.
- `consistency` (float): consistency score.
- `uniqueness` (float): uniqueness score.
- `quality_score` (float): average of completeness, consistency, and uniqueness.
- `detected_type` (string): `"int"`, `"float"`, or `"string"`.

### Overall scores

Compute overall scores as the average across all columns:
- `overall_completeness`: average of all columns' completeness.
- `overall_consistency`: average of all columns' consistency.
- `overall_uniqueness`: average of all columns' uniqueness.
- `overall_quality_score`: average of all columns' quality_score.

### Output format

```json
{
  "row_count": 100,
  "column_count": 5,
  "columns": [
    {
      "name": "id",
      "completeness": 1.0,
      "consistency": 1.0,
      "uniqueness": 1.0,
      "quality_score": 1.0,
      "detected_type": "int"
    }
  ],
  "overall_completeness": 0.95,
  "overall_consistency": 1.0,
  "overall_uniqueness": 0.8,
  "overall_quality_score": 0.9166666666666666
}
```

Columns array preserves CSV header order. 2-space indented JSON with trailing newline.

### Error handling

- Missing input file: exit 1, `ERROR: file not found: <path>`.
- Empty CSV (no header): exit 1, `ERROR: empty CSV`.

### Pipeline extension

New step type `"quality"`:

```json
{"type": "quality", "input": "data.csv", "output": "quality.json"}
```

### Lineage extension

The `lineage` command recognizes `"quality"` steps:
- Input: `input` field.
- Output: `output` field.
