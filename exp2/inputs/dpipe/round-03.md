Add the following capabilities to `dpipe` and apply the specified behavior corrections.

## Behavior Corrections

### Fill linear: boundary extrapolation

The `fill` transform with `"strategy": "linear"` now handles boundary cells differently:

- If only a **lower anchor** exists (no float-parseable non-empty cell found below the current empty cell), the empty cell is filled with the lower anchor's value.
- If only an **upper anchor** exists (no float-parseable non-empty cell found above the current empty cell), the empty cell is filled with the upper anchor's value.
- If **both** anchors exist, interpolation works as before: `result = v_lo + (v_hi - v_lo) * (i - lo) / (hi - lo)`.
- If **neither** anchor exists, the cell remains empty.

Previously, cells with only one anchor remained empty. This is now corrected to use constant extrapolation from the nearest available anchor.

### Normalize zscore: sample standard deviation

The `normalize` transform with `"method": "zscore"` now uses **sample standard deviation** (Bessel's correction) instead of population standard deviation:

`stddev = sqrt(sum((xi - mean)^2) / (n - 1))`

where `n` is the number of valid numeric values. If `n < 2`, all output values are `"0"`. If sample stddev is 0, all output values are `"0"`.

Previously, population standard deviation (`n` denominator) was used. The `profile` command's `stddev` field is unaffected — it continues to use population standard deviation.

## Extended profile output

### p05 and p95 percentiles

Numeric column profiles (`int` and `float`) now include two additional percentile fields:

- `p05` (number): 5th percentile.
- `p95` (number): 95th percentile.

Both use the same interpolation method as `p25`, `median`, and `p75`: compute `idx = p / 100 * (n - 1)`, interpolate between neighboring sorted values if the index is non-integer.

## New command: `drift`

`dpipe drift --baseline <path> --current <path> --output <path> [--threshold <number>]`

Compares two CSV data files by computing statistical profiles internally and detecting schema and distribution drift between a baseline and a current dataset.

### Parameters

- `--baseline`: path to the baseline CSV data file.
- `--current`: path to the current CSV data file.
- `--output`: path for the drift report JSON file.
- `--threshold` (optional, default `0.1`): numeric threshold for distribution drift metrics.

### Drift detection

Build a column-level statistical profile for each CSV file internally (using the same type inference rules and numeric statistics as the `profile` command: type inference, count, null_count, unique, and for numeric columns: min, max, mean, population stddev). Then compare the two profiles column by column.

**Schema drift** (checked for every column in either profile):

- `"column_added"`: column exists in current but not in baseline.
- `"column_removed"`: column exists in baseline but not in current.
- `"type_changed"`: column exists in both profiles but the `type` field differs.

**Distribution drift** (checked only for columns present in both profiles with the same numeric type — `"int"` or `"float"` — and both having `count > 0`):

- `"mean_shift"`: `|current_mean - baseline_mean| / max(baseline_stddev, 1e-10) > threshold`.
- `"null_rate_change"`: `|current_null_rate - baseline_null_rate| > threshold`, where `null_rate = null_count / row_count`. If `row_count` is 0, null_rate is 0.
- `"range_expansion"`: `(current_max - current_min) > (baseline_max - baseline_min) * (1 + threshold)`.
- `"unique_ratio_change"`: `|current_unique_ratio - baseline_unique_ratio| > threshold`, where `unique_ratio = unique / count`. If `count` is 0, unique_ratio is 0.

### Output format

```json
{
  "drifts": [
    {
      "column": "age",
      "drift_type": "mean_shift",
      "baseline_value": 25.5,
      "current_value": 45.0,
      "detail": "normalized shift = 1.95"
    }
  ],
  "summary": {
    "total_drifts": 3,
    "schema_drifts": 1,
    "distribution_drifts": 2
  }
}
```

Each entry in the `drifts` array has:

- `column` (string): the column name.
- `drift_type` (string): one of the drift types listed above.
- `baseline_value`: the relevant baseline metric value. For `"column_added"`, this is `null`. For `"column_removed"`, this is the baseline column's type as a string. For `"type_changed"`, this is the baseline type as a string. For distribution drifts, this is the baseline numeric value of the metric being compared (mean, null_rate, range, or unique_ratio).
- `current_value`: the relevant current metric value. For `"column_removed"`, this is `null`. For `"column_added"`, this is the current column's type as a string. For `"type_changed"`, this is the current type as a string. For distribution drifts, this is the current numeric value.
- `detail` (string): human-readable explanation, formatted as follows:
  - `"column_added"`: `"new column of type <type>"`
  - `"column_removed"`: `"column of type <type> removed"`
  - `"type_changed"`: `"type changed from <baseline_type> to <current_type>"`
  - `"mean_shift"`: `"normalized shift = <value>"` where value is `|current_mean - baseline_mean| / max(baseline_stddev, 1e-10)`, formatted using Go's `fmt.Sprintf("%v", value)`.
  - `"null_rate_change"`: `"null rate changed from <baseline_rate> to <current_rate>"` using `%v` formatting.
  - `"range_expansion"`: `"range expanded from <baseline_range> to <current_range>"` where range = max - min, using `%v` formatting.
  - `"unique_ratio_change"`: `"unique ratio changed from <baseline_ratio> to <current_ratio>"` using `%v` formatting.

### Ordering

The `drifts` array is sorted by:

1. Column name ascending (lexicographic).
2. Within the same column, drift type in this fixed order: `"column_added"`, `"column_removed"`, `"type_changed"`, `"mean_shift"`, `"null_rate_change"`, `"range_expansion"`, `"unique_ratio_change"`.

### Error handling

- Missing baseline file: exit code 1, stderr `ERROR: file not found: <path>`.
- Missing current file: exit code 1, stderr `ERROR: file not found: <path>`.
- Cannot parse baseline CSV: exit code 1, stderr `ERROR: cannot parse CSV: <path>`.
- Cannot parse current CSV: exit code 1, stderr `ERROR: cannot parse CSV: <path>`.

### Formatting

Output uses JSON with 2-space indentation and a trailing newline.

## New transforms

### `resample`

Stratified resampling to balance class distribution.

```json
{"op": "resample", "column": "label", "strategy": "oversample", "seed": 42}
```

- `column`: the grouping column. Must exist, otherwise: `ERROR: invalid recipe: column <name> not found`.
- `strategy`: `"oversample"` or `"undersample"`.
- `seed` (integer): deterministic random seed for the `undersample` strategy. Ignored by `oversample`.

**`oversample`** strategy:

1. Group rows by the value in `column`. Sort group keys ascending (lexicographic).
2. Find the maximum group size (`target`).
3. For each group with fewer than `target` rows, repeat the group's rows cyclically (in their original order within the group) until the group has exactly `target` rows.
4. Output all rows: groups in sorted key order. Within each group, original rows come first, then oversampled copies.

**`undersample`** strategy:

1. Group rows by the value in `column`. Sort group keys ascending (lexicographic).
2. Find the minimum group size (`target`).
3. For each group with more than `target` rows:
   a. Let `groupIndex` be the 0-based index of this group in the sorted group key list.
   b. Create an integer array of indices `[0, 1, ..., groupSize-1]`.
   c. Initialize a deterministic pseudo-random number generator with seed = `seed + groupIndex` (use Go's `math/rand` with `rand.New(rand.NewSource(int64(seed + groupIndex)))`).
   d. Fisher-Yates shuffle: for `i` from `groupSize - 1` down to `1`, swap `indices[i]` with `indices[rng.Intn(i + 1)]`.
   e. Take the first `target` elements from the shuffled indices array, sort them ascending.
   f. Select the rows at those sorted indices from the group.
4. For groups with exactly `target` rows, keep all rows.
5. Output: groups in sorted key order, each group contributing its selected rows in their original relative order.

### `watermark`

Compute an HMAC-SHA256 watermark for each row, appending a new column.

```json
{"op": "watermark", "columns": ["id", "value"], "key": "secret123", "as": "wmark"}
```

- `columns` (array of strings): columns to include in the HMAC input. If omitted or empty, all columns are used (in header order).
- `key` (string): the HMAC secret key.
- `as` (string): name for the new column, appended as the last column.

**Computation:**

For each row, concatenate the values of the specified columns separated by a null byte (`\x00`), compute HMAC-SHA256 using `key` as the secret, and format the **first 8 bytes** of the resulting 32-byte digest as 16 lowercase hexadecimal characters.

- Empty cell values are included as empty strings (contributing the separator).
- If any column in `columns` does not exist: `ERROR: invalid recipe: column <name> not found`.

## Pipeline extension

The `pipeline` command now supports the `"drift"` step type:

```json
{"type": "drift", "baseline": "baseline.csv", "current": "current.csv", "output": "drift.json", "threshold": 0.2}
```

- `baseline`, `current`, `output`: file paths.
- `threshold` (optional): if not specified or 0, defaults to `0.1`.

This runs the `drift` command with the corresponding arguments.
