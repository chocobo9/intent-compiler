Add the following capabilities to `dpipe`.

## New command: `profile`

`dpipe profile --input <path> --output <path>`

Reads a CSV file (first row is header), infers column types from data, and writes a JSON statistical profile to the output path.

### Type inference

Since `profile` operates without a schema, column types are inferred from non-empty values:

1. If **all** non-empty values parse as integers (Go's `strconv.ParseInt` with base 10, bit size 64): type is `int`.
2. Else if all non-empty values parse as floats (Go's `strconv.ParseFloat` with bit size 64): type is `float`.
3. Else if all non-empty values parse as RFC 3339 datetimes: type is `datetime`.
4. Otherwise: type is `string`.
5. A column with zero non-empty values has type `string`.

Note: every valid integer string also parses as a float, so the order matters — try integer first.

### Output format

```json
{
  "row_count": 100,
  "columns": [
    {
      "name": "id",
      "type": "int",
      "count": 100,
      "null_count": 0,
      "unique": 100,
      "min": 1,
      "max": 100,
      "mean": 50.5,
      "stddev": 28.86607004772212,
      "median": 50.5,
      "p25": 25.75,
      "p75": 75.25
    }
  ],
  "correlations": [
    {"column_a": "id", "column_b": "score", "correlation": 0.95},
    {"column_a": "id", "column_b": "value", "correlation": null}
  ]
}
```

The `columns` array contains one object per CSV column, in column declaration order (left to right in the header).

Each column object always contains:
- `name` (string): the column header name.
- `type` (string): the inferred type (`"int"`, `"float"`, `"string"`, or `"datetime"`).
- `count` (integer): number of non-empty values.
- `null_count` (integer): number of empty values (`row_count - count`).
- `unique` (integer): number of distinct non-empty values.

Additional fields depend on the inferred type:

**`int` and `float` columns** additionally contain:
- `min`: minimum value. JSON integer for `int` columns, JSON number for `float` columns.
- `max`: maximum value. Same formatting as `min`.
- `mean` (number): arithmetic mean.
- `stddev` (number): population standard deviation = `sqrt(sum((xi - mean)^2) / n)`. For a single value, `stddev` is `0`.
- `median` (number): 50th percentile.
- `p25` (number): 25th percentile.
- `p75` (number): 75th percentile.

**Percentile calculation** (for `median`, `p25`, `p75`): sort the `n` non-empty numeric values in ascending order. Compute the index: `idx = p / 100 * (n - 1)` where `p` is the percentile (25, 50, or 75). If `idx` is an integer, the result is `values[idx]`. Otherwise, interpolate: `lower = floor(idx)`, `upper = ceil(idx)`, `frac = idx - lower`, `result = values[lower] + frac * (values[upper] - values[lower])`.

**Additional numeric statistics** (for `int` and `float` columns):

- `skewness` (number or null): Adjusted Fisher-Pearson standardized moment coefficient.
  1. Compute sample standard deviation: `s = sqrt(sum((xi - mean)^2) / (n - 1))`. Note: this uses `n - 1` (Bessel's correction), distinct from the population `stddev` field above which uses `n`.
  2. Compute: `skewness = (n / ((n - 1) * (n - 2))) * sum(((xi - mean) / s)^3)`
  3. Returns `null` if `n < 3` or `s == 0`.

- `kurtosis` (number or null): Sample excess kurtosis.
  1. Using the same sample standard deviation `s` as skewness.
  2. Compute: `kurtosis = ((n * (n + 1)) / ((n - 1) * (n - 2) * (n - 3))) * sum(((xi - mean) / s)^4) - (3 * (n - 1)^2) / ((n - 2) * (n - 3))`
  3. Returns `null` if `n < 4` or `s == 0`.

- `mode` (number or null): The most frequently occurring value. If multiple values share the highest frequency, the smallest value wins. Returns `null` if count is `0` or if every non-empty value appears exactly once. For `int` columns, `mode` is a JSON integer; for `float` columns, a JSON number.

- `histogram` (array of objects): 10 equal-width bins spanning the range of values.
  - Compute `width = (max - min) / 10`.
  - Bin `i` (0-indexed, 0 to 9): `low = min + i * width`, `high = min + (i + 1) * width`.
  - Assignment: a value `v` goes into bin `floor((v - min) / width)`, clamped to `[0, 9]`. This means bins 0–8 are `[low, high)` (left-inclusive, right-exclusive) and bin 9 is `[low, max]` (inclusive on both ends).
  - Each object: `{"low": <number>, "high": <number>, "count": <integer>}`. `low` and `high` use the same JSON number formatting as other profile statistics.
  - If all values are identical (`max == min`): return a single-element array `[{"low": <value>, "high": <value>, "count": n}]`.
  - Empty array `[]` if count is `0`.

**`string` columns** additionally contain:
- `min_length` (integer): minimum byte length among non-empty values. `0` if count is `0`.
- `max_length` (integer): maximum byte length among non-empty values. `0` if count is `0`.
- `most_common` (array): top 5 most frequent non-empty values, sorted by count descending; ties broken by value ascending (lexicographic). Each entry: `{"value": "...", "count": N}`. If fewer than 5 unique values exist, include all. Empty array if count is `0`.
- `avg_length` (number): average byte length among non-empty values. `0` if count is `0`.

**`datetime` columns** additionally contain:
- `earliest` (string): the earliest datetime value formatted as RFC 3339.
- `latest` (string): the latest datetime value formatted as RFC 3339.

### Correlation matrix

The profile output additionally contains a top-level `correlations` array: the Pearson correlation coefficient for every pair of numeric columns (those with inferred type `int` or `float`).

For each pair of numeric columns (A, B) where A appears before B in the header:

1. Collect **paired observations**: rows where both A and B have non-empty values.
2. Let `n` be the number of paired observations.
3. If `n < 2`, correlation is `null`.
4. Compute paired means: `mean_a = sum(ai) / n`, `mean_b = sum(bi) / n`.
5. Compute `numerator = sum((ai - mean_a) * (bi - mean_b))`.
6. Compute `denom = sqrt(sum((ai - mean_a)^2) * sum((bi - mean_b)^2))`.
7. If `denom == 0` (either column has zero variance in the paired set), correlation is `null`.
8. Otherwise, `correlation = numerator / denom`.

Each entry in the `correlations` array is:
```json
{"column_a": "col1", "column_b": "col2", "correlation": 0.95}
```

- `column_a`: the name of the first column (earlier in header order).
- `column_b`: the name of the second column (later in header order).
- `correlation`: the Pearson coefficient as a JSON number, or `null` if undefined.
- The array is sorted by `column_a` position in the header, then by `column_b` position.
- If there are fewer than 2 numeric columns, `correlations` is an empty array.

### Formatting

Output uses JSON with 2-space indentation and a trailing newline. Integer statistics appear as JSON integers (no decimal point). Floating-point statistics appear as JSON numbers formatted by Go's default float64 JSON encoding (no unnecessary trailing zeros).

### Error handling

- Missing input file: exit code 1, stderr `ERROR: file not found: <path>`.

## New transforms

### `deduplicate`

Remove duplicate rows based on a set of key columns.

```json
{"op": "deduplicate", "columns": ["id", "name"], "keep": "first"}
```

- `columns` (optional array of strings): column names to use for duplicate detection. If omitted or empty, all columns are used.
- `keep` (string): `"first"` or `"last"`.
  - `"first"`: keep the first occurrence of each key combination (in input order), discard subsequent duplicates.
  - `"last"`: keep the last occurrence of each key combination.
- Output preserves the relative order of retained rows as they appeared in the input.
- If any column in `columns` does not exist, exit with error: `ERROR: invalid recipe: column <name> not found`.

### `split`

Split a column by a delimiter into multiple new columns, replacing the original column at its position.

```json
{"op": "split", "column": "full_name", "delimiter": " ", "names": ["first", "last"]}
```

- `column`: the source column to split.
- `delimiter`: the string to split on.
- `names`: array of new column names for the resulting parts.
- The original column is removed and the new columns are inserted at the position where the original column was.
- For each row, split the cell value using the delimiter:
  - If the split produces exactly `len(names)` parts, map each part to the corresponding name.
  - If fewer parts than `len(names)`: remaining columns are filled with empty strings.
  - If more parts than `len(names)`: the last named column receives all remaining parts joined back with the delimiter.
- If `column` does not exist, exit with error: `ERROR: invalid recipe: column <name> not found`.

### `assert`

Assert a condition on every row. If any row fails, the pipeline stops with an error.

```json
{"op": "assert", "expression": "value > 0 && value < 1000", "message": "value out of expected range"}
```

- `expression`: a boolean expression using the same syntax as the `derive` operation's expression evaluator (same operators, functions, and column references).
- `message`: the error message string.
- If the expression evaluates to `> 0` for every row, data passes through unchanged (same header and rows, no modification).
- If the expression evaluates to `<= 0` (or `NaN`) for any row, exit immediately with error: `ERROR: assertion failed on row N: <message>` where `N` is the 1-indexed position of the failing row in the current dataset.

### `normalize`

Normalize a numeric column using z-score or min-max scaling, appending a new column with the result.

```json
{"op": "normalize", "column": "value", "method": "zscore", "as": "value_norm"}
```

- `column`: source column name. If it does not exist, exit with error: `ERROR: invalid recipe: column <name> not found`.
- `method`: `"zscore"` or `"minmax"`.
- `as`: name for the new column, appended as the last column in the header.

**Computation:**

First, collect all non-empty values from `column` that parse as floats (Go's `strconv.ParseFloat` with bit size 64). Compute statistics from these values:
- For `zscore`: compute `mean` and population `stddev` (`sqrt(sum((xi - mean)^2) / n)`).
- For `minmax`: compute `min` and `max`.

Then, for each row:
- If the cell in `column` is empty: new column value is empty string.
- If the cell does not parse as a float: new column value is empty string.
- For `zscore`: if `stddev == 0`, result is `0`. Otherwise, result is `(x - mean) / stddev`.
- For `minmax`: if `max == min`, result is `0`. Otherwise, result is `(x - min) / (max - min)`.

**Output format:** numeric results are formatted using Go's `strconv.FormatFloat(val, 'f', -1, 64)`. The special value `0` is output as the string `"0"` (not `"0.0"`).

## Extended transforms

### Fill `linear` strategy

The existing `fill` transform now supports an additional strategy: `"linear"`.

```json
{"op": "fill", "columns": ["temperature"], "strategy": "linear"}
```

For each empty cell in the specified columns:

1. Search upward (decreasing row index) for the nearest non-empty cell whose value parses as a float. Call this the **lower anchor** at index `lo` with value `v_lo`.
2. Search downward (increasing row index) for the nearest non-empty cell whose value parses as a float. Call this the **upper anchor** at index `hi` with value `v_hi`.
3. If **both** anchors are found, interpolate: `result = v_lo + (v_hi - v_lo) * (i - lo) / (hi - lo)` where `i` is the current row index.
4. If either anchor is **missing** (no non-empty numeric value exists above or below), the cell remains empty.
5. Non-empty cells that do not parse as float are skipped during anchor search (treated as if the cell were empty for interpolation purposes, but they are **not** themselves filled).

**Output format:** interpolated values are formatted using Go's `strconv.FormatFloat(val, 'f', -1, 64)`.

### `encode`

Encode categorical column values into numeric representations.

```json
{"op": "encode", "column": "category", "method": "onehot", "drop": true}
```

- `column`: source column. If it does not exist, exit with error: `ERROR: invalid recipe: column <name> not found`.
- `method`: `"onehot"` or `"ordinal"`.
- `drop` (boolean, optional, default `false`): only used for `onehot`.
- `as` (string): only used for `ordinal`.

**`onehot`** method:

1. Collect all unique non-empty values from `column`, sorted ascending (lexicographic).
2. For each unique value, create a new column named `{column}_{value}`.
3. For each row: if the cell in `column` equals the value, the new column's cell is `"1"`; otherwise `"0"`. Empty cells get `"0"` in all new columns.
4. If `drop` is `true`, remove the original column and insert the new columns at its position (maintaining the same index in the header). If `drop` is `false` or omitted, keep the original column and append the new columns at the end of the header.

**`ordinal`** method:

```json
{"op": "encode", "column": "status", "method": "ordinal", "as": "status_code"}
```

1. Collect all unique non-empty values from `column`, sorted ascending (lexicographic).
2. Assign ranks: first value gets `"0"`, second gets `"1"`, etc.
3. For each row: if the cell matches a ranked value, the new column's cell is the rank string. Empty cells get empty string.
4. The new column named `as` is appended as the last column.

### `rollup`

Compute aggregations at multiple levels of a column hierarchy, producing detail rows, subtotals, and a grand total.

```json
{"op": "rollup", "columns": ["region", "city"], "aggregations": [{"column": "sales", "function": "sum", "as": "total_sales"}]}
```

- `columns`: array of grouping columns forming a hierarchy (left to right = coarsest to finest).
- `aggregations`: array of aggregation specs, each with `column`, `function`, and `as`. Supported functions: `sum`, `avg`, `count`, `min`, `max` (same semantics as the `aggregate` transform — non-numeric values skipped for `sum`/`avg`/`min`/`max`; `count` counts non-empty values; `avg` with zero numeric values yields `NaN`; `sum` with zero yields `0`; `min`/`max` with zero yield `NaN`).
- If any column in `columns` or `aggregations[].column` does not exist: `ERROR: invalid recipe: column <name> not found`.

**Output:** The output header is the `columns` array followed by the `as` names from `aggregations`.

Output rows are produced at multiple hierarchy levels:

1. **Detail level** (all grouping columns): group by all columns in `columns`. Each unique combination produces one row with the actual group values and aggregation results.
2. **Subtotal levels** (from finest to coarsest): for each level `k` from `len(columns)-1` down to `1`, group by the first `k` columns. In each subtotal row, columns at positions `k` through `len(columns)-1` have the value `"*"`.
3. **Grand total** (level 0): a single row where all grouping columns have the value `"*"` and aggregations are computed over all rows.

Row ordering:

1. Detail rows first, sorted by the group column values in ascending lexicographic order (left to right).
2. Then subtotal rows for each level, from the finest subtotal level (grouping by all but the last column) to the coarsest (grouping by just the first column). Within each subtotal level, rows are sorted by the included group column values ascending.
3. Grand total row last.

Numeric results are formatted without unnecessary trailing zeros.

### `detect`

Detect outliers in a numeric column, appending a new boolean column.

```json
{"op": "detect", "column": "value", "method": "iqr", "as": "is_outlier", "factor": 1.5}
```

- `column`: source column. Must exist, otherwise: `ERROR: invalid recipe: column <name> not found`.
- `method`: detection algorithm (see below).
- `as`: new column name, appended as the last column.
- `factor`: numeric threshold multiplier.

First, collect all non-empty values from `column` that parse as floats (Go's `strconv.ParseFloat` with bit size 64). Compute detection thresholds from these values. Then, for each row:

- If the cell is empty or does not parse as float: new column is `"0"`.
- Otherwise, apply the method's test. Result: `"1"` (outlier) or `"0"` (not outlier).

**Methods:**

- **`iqr`**: Compute Q1, Q3 using the same percentile method as the `profile` command. IQR = Q3 - Q1. A value is an outlier if `value < Q1 - factor * IQR` or `value > Q3 + factor * IQR`. If fewer than 2 numeric values exist, all get `"0"`.

- **`zscore`**: Compute population mean and population standard deviation (same formulas as profile's `mean` and `stddev`). A value is an outlier if `|value - mean| / stddev > factor`. If stddev is 0, all values get `"0"`.

- **`mad`**: Compute median of all numeric values. Compute MAD = median of `|xi - median|` for all numeric values. Compute modified Z-score for each value: `modified_z = 0.6745 * (value - median) / MAD`. A value is an outlier if `|modified_z| > factor`. If MAD is 0: values equal to the median get `"0"`, values not equal to the median get `"1"`.

### `bin`

Assign numeric column values to bins, appending a new column with the bin label.

```json
{"op": "bin", "column": "value", "method": "width", "bins": 5, "as": "value_bin"}
```

- `column`: source column. Must exist, otherwise: `ERROR: invalid recipe: column <name> not found`.
- `method`: `"width"` or `"quantile"`.
- `bins`: number of bins (positive integer).
- `as`: new column name, appended as the last column.

First, collect all non-empty values from `column` that parse as floats. Then for each row:

- If the cell is empty or does not parse as float: new column is empty string.
- Otherwise, assign to a bin using the method.

**Methods:**

- **`width`**: Equal-width bins.
  1. Compute `w = (max - min) / bins`.
  2. Bin index for value `v`: `i = floor((v - min) / w)`, clamped to `[0, bins - 1]`.
  3. Bin boundaries: `low = min + i * w`, `high = min + (i + 1) * w`. For the last bin (i = bins - 1), `high = max`.
  4. Label: `"[low,high)"` for bins 0 to `bins - 2`; `"[low,high]"` for the last bin.
  5. If `max == min`: all values get label `"[val,val]"`.
  6. `low` and `high` in labels are formatted using Go's `strconv.FormatFloat(val, 'f', -1, 64)`.

- **`quantile`**: Equal-frequency bins using percentile boundaries.
  1. Compute bin boundaries using percentiles: boundary `j` = percentile at `(j * 100 / bins)` for j = 0 to bins, using the same percentile interpolation method as the `profile` command.
  2. Bin index for value `v`: the highest `i` in `[0, bins-1]` such that `v >= boundary[i]`.
  3. Labels: same format as `width`, using `boundary[i]` as `low` and `boundary[i+1]` as `high`. The last bin's `high` is `max`.
  4. If `max == min`: all values get label `"[val,val]"`.
  5. Same float formatting as `width`.

## Pipeline extension

The `pipeline` command now supports the `"profile"` step type:

```json
{"type": "profile", "input": "data.csv", "output": "profile.json"}
```

This step runs the `profile` command with the given input and output paths.


## New command: `compare`

`dpipe compare --left <path> --right <path> --key <col1,col2,...> --output <path>`

Reads two CSV files and compares them row-by-row using the specified key columns, producing a JSON diff report.

### Comparison logic

1. Read both CSV files (first row is header).
2. Both files must have identical headers (same column names in the same order). If not, exit with error: `ERROR: schema mismatch: headers differ`.
3. The `--key` flag specifies a comma-separated list of column names that form the composite key.
4. If any key column does not exist in the header, exit with error: `ERROR: invalid key: column <name> not found`.
5. Build a composite key for each row by joining the values of the key columns with a null byte (`\x00`) separator.
6. Classify rows:
   - **added**: key exists in right but not in left.
   - **removed**: key exists in left but not in right.
   - **modified**: key exists in both, but at least one non-key column differs.
   - Rows with matching keys and identical values in all columns are **unchanged** (not included in changes).
7. If the left file has duplicate keys, only the first occurrence is used. Same for the right file.

### Output format

```json
{
  "summary": {
    "left_rows": 100,
    "right_rows": 105,
    "added": 10,
    "removed": 5,
    "modified": 3,
    "unchanged": 87
  },
  "changes": [
    {
      "type": "added",
      "key": {"id": "101"},
      "row": {"id": "101", "name": "Alice", "value": "50"}
    },
    {
      "type": "removed",
      "key": {"id": "5"},
      "row": {"id": "5", "name": "Bob", "value": "30"}
    },
    {
      "type": "modified",
      "key": {"id": "10"},
      "left": {"id": "10", "name": "Charlie", "value": "20"},
      "right": {"id": "10", "name": "Charlie", "value": "25"},
      "diff": ["value"]
    }
  ]
}
```

### Changes array detail

Each entry in the `changes` array has:
- `type` (string): `"added"`, `"removed"`, or `"modified"`.
- `key` (object): an object with the key column names and their values.

For `"added"` entries:
- `row` (object): an object mapping each column name to its value from the right file.

For `"removed"` entries:
- `row` (object): an object mapping each column name to its value from the left file.

For `"modified"` entries:
- `left` (object): full row from the left file.
- `right` (object): full row from the right file.
- `diff` (array of strings): names of non-key columns that differ, in header order.

### Changes ordering

The `changes` array is sorted by:
1. Type order: `"added"` first, then `"removed"`, then `"modified"`.
2. Within each type: sorted ascending by composite key (lexicographic comparison of the joined key string).

### Error handling

- Missing left file: exit code 1, stderr `ERROR: file not found: <path>`.
- Missing right file: exit code 1, stderr `ERROR: file not found: <path>`.
- Missing `--key` flag: exit code 1, stderr `ERROR: --key is required`.
- Invalid key column: exit code 1, stderr `ERROR: invalid key: column <name> not found`.
- Schema mismatch: exit code 1, stderr `ERROR: schema mismatch: headers differ`.
- Missing `--output` flag: exit code 1, stderr `ERROR: --output is required`.

### Extended compare flags

The `compare` command accepts two additional optional flags:

**`--tolerance <number>`** (default: `0`):

When comparing values between left and right rows for "modified" detection, if both values parse as floats (Go's `strconv.ParseFloat` with bit size 64) and the absolute difference `|left_float - right_float| <= tolerance`, the values are treated as equal. Non-numeric values or values where only one side parses as float use exact string comparison.

**`--ignore <col1,col2,...>`** (optional):

Comma-separated list of column names to exclude from change detection. These columns are still included in output row objects, but differences in ignored columns do not cause a row to be classified as "modified". If all non-key, non-ignored columns are equal, the row is "unchanged". The `diff` array in "modified" entries does not include ignored columns.

- If any column in `--ignore` does not exist in the header: exit code 1, stderr `ERROR: invalid ignore: column <name> not found`.

### Formatting

Output uses JSON with 2-space indentation and a trailing newline.

## New transforms (continued)

### `hash`

Compute a SHA-256 hash of specified columns for each row, appending a new column with the hex digest.

```json
{"op": "hash", "columns": ["id", "name", "value"], "as": "row_hash"}
```

- `columns` (array of strings): column names whose values are included in the hash. If omitted or empty, all columns are used (in header order).
- `as` (string): name for the new column, appended as the last column in the header.

**Computation:**

For each row, concatenate the values of the specified columns separated by a null byte (`\x00`), compute the SHA-256 digest, and format as a 64-character lowercase hexadecimal string.

Example: for columns `["id", "name"]` and values `["1", "Alice"]`, the hash input is the byte string `1\x00Alice` (5 bytes with `\x00` as the separator byte).

- Empty cell values are included as empty strings (contributing only the separator).
- If any column in `columns` does not exist, exit with error: `ERROR: invalid recipe: column <name> not found`.

## Pipeline extension (continued)

The `pipeline` command now additionally supports the `"compare"` step type:

```json
{"type": "compare", "left": "left.csv", "right": "right.csv", "key": "id,name", "output": "diff.json"}
```

This step runs the `compare` command with the given left, right, key, and output arguments.
