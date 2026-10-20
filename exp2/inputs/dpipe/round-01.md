Build a deterministic data pipeline tool in Go called `dpipe`. The tool operates as a CLI that reads structured data from CSV files, applies a chain of transformations, and writes results to output files — with every step producing bit-identical output across repeated runs given the same input and configuration.

## Core behaviors

### Ingestion

`dpipe ingest --input <path> --schema <path> --output <path>`

- Reads a CSV file at `<path>`. The first row is a header.
- Validates every row against a JSON schema file. The schema has this structure:
  ```json
  {
    "columns": [
      {"name": "id", "type": "int", "required": true, "unique": true},
      {"name": "value", "type": "float", "required": true, "min": 0, "max": 1000},
      {"name": "label", "type": "string", "required": false, "pattern": "^[A-Z]"},
      {"name": "timestamp", "type": "datetime", "required": true}
    ],
    "primary_key": ["id"]
  }
  ```
  Supported types: `int`, `float`, `string`, `datetime` (RFC 3339 format).

  Column constraints (all optional):
  - `unique` (boolean): No two valid rows may have the same value in this column. When a duplicate is encountered (checked in input file order after all other validations pass), the later row is rejected with reason `duplicate value for unique column: <name>`.
  - `min`, `max` (number): For `int` and `float` columns only. Value must be within `[min, max]` inclusive. Rejected rows get reason `value out of range for column <name>: <value>`.
  - `pattern` (string): For `string` columns only. Value must match the Go regular expression. Rejected rows get reason `value does not match pattern for column <name>: <value>`.

  Validation order for each row: (1) required/type checks, (2) range checks, (3) pattern checks. After all rows pass steps 1-3, uniqueness is checked across valid rows in input file order — the first occurrence is kept, subsequent duplicates are rejected.

  `primary_key` is always an array of one or more column names (composite key support).

- Rows that fail validation are written to `<output>.rejected` (same CSV format, with an appended `rejection_reason` column). Valid rows are written to `<output>` in CSV format.
- Output rows are sorted by the primary key columns in declaration order: first by the first primary key column, then by the second, etc. Each column is sorted in ascending order using its declared type (numeric sort for int/float, lexicographic for string, chronological for datetime).
- A SHA-256 checksum of the output file (computed on the raw bytes) is written to `<output>.sha256` as a single hex string followed by a newline.

### Transformation

`dpipe transform --input <path> --recipe <path> --output <path> --seed <uint64>`

- Reads a CSV file with a header row. In typical usage this will be a previously ingested (valid) CSV file, but any headered CSV input is allowed.
- Applies transformations defined in a JSON recipe file, in order. Each transformation is an object in an array:
  ```json
  [
    {"op": "filter", "column": "value", "condition": "gt", "threshold": 10.0},
    {"op": "derive", "name": "score", "expression": "value * 2 + 1"},
    {"op": "sample", "fraction": 0.5},
    {"op": "sort", "column": "score", "order": "desc"},
    {"op": "rename", "from": "label", "to": "category"},
    {"op": "drop", "columns": ["timestamp"]},
    {"op": "aggregate", "group_by": ["label"], "aggregations": [
      {"column": "value", "function": "sum", "as": "total_value"},
      {"column": "value", "function": "avg", "as": "avg_value"},
      {"column": "id", "function": "count", "as": "num_items"}
    ]},
    {"op": "join", "right": "other.csv", "on": "id", "type": "left"},
    {"op": "window", "function": "rank", "partition_by": ["label"], "order_by": [{"column": "value", "order": "desc"}], "as": "value_rank"},
    {"op": "pivot", "index": ["id"], "column": "label", "value": "value"},
    {"op": "unpivot", "index": ["id"], "columns": ["q1", "q2", "q3"], "name_to": "quarter", "value_to": "amount"},
    {"op": "fill", "columns": ["value"], "strategy": "forward"}
  ]
  ```
- Supported operations:
  - `filter`: Keep rows where `column` satisfies `condition` against `threshold`. Conditions: `gt`, `gte`, `lt`, `lte`, `eq`, `neq`.
  - `derive`: Add a new column computed from an expression over existing numeric columns.

    **Operator precedence** (lowest to highest):
    1. `||` (logical OR): returns `1` if either operand is > 0, otherwise `0`
    2. `&&` (logical AND): returns `1` if both operands are > 0, otherwise `0`
    3. `==`, `!=` (equality): numeric comparison, returns `1` (true) or `0` (false)
    4. `>`, `>=`, `<`, `<=` (relational): numeric comparison, returns `1` or `0`
    5. `+`, `-` (addition, subtraction)
    6. `*`, `/`, `%` (multiplication, division, modulo)
    7. Unary `-` (negation)
    8. Function calls, parentheses, column references, numeric literals

    Division by zero produces `NaN`. Modulo by zero produces `NaN`. Any comparison involving `NaN` (on either side) produces `0`.

    The expression evaluator also supports function calls with parenthesized, comma-separated arguments:
    - `abs(x)` — absolute value
    - `sqrt(x)` — square root; returns `NaN` for negative input
    - `ceil(x)` — smallest integer >= x
    - `floor(x)` — largest integer <= x
    - `round(x, n)` — round x to n decimal places (n is a non-negative integer; half-values round away from zero)
    - `pow(x, y)` — x raised to the power y
    - `log(x)` — natural logarithm; returns `NaN` for non-positive input
    - `min(x, y)` — minimum of two values
    - `max(x, y)` — maximum of two values
    - `if(cond, x, y)` — returns x if cond > 0, otherwise returns y
    - `clamp(x, lo, hi)` — returns lo if x < lo, hi if x > hi, otherwise x
    - `coalesce(x, y)` — returns x if x is not NaN, otherwise returns y

    Functions can be nested: `round(sqrt(abs(value)), 2)`.

    Comparison and logical operators enable inline conditions without `if`: e.g., `(value > 10 && value < 100) * value` yields `value` when in range, `0` otherwise.

    Formatting: derive results are written using the shortest decimal representation that preserves the computed value, without unnecessary trailing zeros or a trailing decimal point (e.g., `11` not `11.0`, `2.5` not `2.50`). `NaN` is written as the literal string `NaN`.

  - `sample`: Retain the given fraction of rows. The selection must be deterministic given `--seed`. Use the seed to initialize a deterministic PRNG (use Go's `math/rand` with the given seed). Rows are selected by generating a random float for each row in input order; keep the row if the float is < fraction.
  - `sort`: Sort rows by the given column. `asc` or `desc`. Ties are broken by the original row order (stable sort).
  - `rename`: Rename a column.
  - `drop`: Remove the listed columns.
  - `aggregate`: Group rows by the `group_by` columns and compute aggregations on each group.
    Supported aggregation functions:
    - `sum`: sum of numeric values in the column for this group. Empty/non-numeric values are skipped. Result is `0` if no numeric values exist.
    - `avg`: arithmetic mean of numeric values. Empty/non-numeric values are skipped. Result is `NaN` if no numeric values exist.
    - `count`: number of non-empty values in the specified column for this group.
    - `min`: minimum numeric value. Empty/non-numeric values are skipped. Result is `NaN` if no numeric values exist.
    - `max`: maximum numeric value. Empty/non-numeric values are skipped. Result is `NaN` if no numeric values exist.

    Output columns: the group_by columns (in declaration order), followed by the aggregation result columns (in declaration order, using the `as` name). Output rows are sorted by the group_by columns in ascending lexicographic order, comparing left to right. Numeric aggregation results are formatted without unnecessary trailing zeros (e.g., `10` not `10.0`, `2.5` not `2.50`).

    Optional `having` clause: after aggregation results are computed and formatted, filter output rows based on an aggregated column. Example:
    ```json
    {"op": "aggregate", "group_by": ["label"], "aggregations": [
      {"column": "value", "function": "sum", "as": "total"}
    ], "having": {"column": "total", "condition": "gt", "threshold": 100}}
    ```
    The `having` object uses the same condition operators as `filter` (`gt`, `gte`, `lt`, `lte`, `eq`, `neq`). The `column` must reference one of the `as` names from the aggregations. The threshold comparison is numeric (the aggregated result string is parsed as a float). Groups whose aggregated value does not satisfy the condition are excluded from output. The `having` clause is applied after sorting — it only removes rows, it does not change the relative order of remaining rows.

  - `join`: Join current dataset with another CSV file.
    - `right`: path to the other CSV file
    - `on`: column name that must exist in both datasets (the join key)
    - `type`: `"inner"` or `"left"`
      - `inner`: output only rows where the join key value exists in both datasets
      - `left`: output all rows from the current (left) dataset; for rows where the join key has no match in the right dataset, all right-side columns are filled with empty strings
    - Output columns: all columns from the left dataset, followed by all columns from the right dataset *except* the join key column (to avoid duplication).
    - If multiple rows in the right dataset share the same join key, only the first one (by file order) is used.
    - Output rows preserve the order of the left (current) dataset.
    - If the join key column does not exist in either dataset, exit with error: `ERROR: invalid recipe: join key <name> not found in <left|right> dataset`.

  - `window`: Add a new column computed by a window function over partitions of the data.
    - `partition_by` (optional): array of column names to partition by. If omitted or empty, all rows are in one partition.
    - `order_by`: array of ordering specifications, each an object with `"column"` (string) and `"order"` (`"asc"` or `"desc"`). Rows within each partition are ordered by these columns (first column is primary, etc.). Ties in all order_by columns are broken by input row order.
    - `as`: name of the new column to create.

    Supported window functions (specified in the `"function"` field):
    - `rank`: 1-based rank within the partition. Rows with equal values in all `order_by` columns receive the same rank. The next rank after a group of ties skips ahead by the group size (e.g., two rows tied at rank 1 → next rank is 3).
    - `dense_rank`: Like `rank` but without gaps (e.g., two rows tied at rank 1 → next rank is 2).
    - `row_number`: Unique sequential number starting from 1 within the partition. Ties are broken by input row order.
    - `lag`: Value of a source column from a preceding row in partition order. Additional operation fields: `"source_column"` (string), `"offset"` (positive integer, number of rows back), `"default"` (string, value to use when no preceding row exists at that offset). Example:
      ```json
      {"op": "window", "function": "lag", "source_column": "value", "offset": 1, "default": "0", "partition_by": ["cat"], "order_by": [{"column": "id", "order": "asc"}], "as": "prev_value"}
      ```
    - `lead`: Like `lag` but looks forward (rows ahead in partition order). Same additional fields as `lag`.
    - `running_sum`: Cumulative sum of a source column's values up to and including the current row within the partition (in partition order). Additional field: `"source_column"`. Non-numeric values are treated as 0. Example:
      ```json
      {"op": "window", "function": "running_sum", "source_column": "value", "partition_by": ["cat"], "order_by": [{"column": "id", "order": "asc"}], "as": "cum_value"}
      ```
    - `running_avg`: Cumulative average of a source column's numeric values up to and including the current row. Additional field: `"source_column"`. Non-numeric values are skipped from both numerator and denominator. If no numeric values exist up to the current row, the result is `NaN`.
    - `ntile`: Divide the partition into `n` roughly equal groups numbered 1 through `n`. Additional field: `"n"` (positive integer). If the partition has `k` rows, the first `k mod n` groups have `ceil(k/n)` rows each, and the remaining groups have `floor(k/n)` rows each. Example:
      ```json
      {"op": "window", "function": "ntile", "n": 4, "partition_by": [], "order_by": [{"column": "id", "order": "asc"}], "as": "quartile"}
      ```

    Output: all original columns in their original order, plus the new column appended. Output rows preserve the original input row order (not the partition order).

    Formatting: `rank`, `dense_rank`, `row_number`, and `ntile` results are formatted as integers (no decimal point). `running_sum`, `running_avg`, `lag`, and `lead` results are formatted without unnecessary trailing zeros.

    If any referenced column (in `partition_by`, `order_by`, or `source_column`) does not exist, exit with error: `ERROR: invalid recipe: column <name> not found`.

  - `pivot`: Reshape data from long format to wide format.
    - `index`: array of column names that identify each output row (the row keys).
    - `column`: the column whose unique values become new column headers.
    - `value`: the column whose values fill the cells.

    Behavior:
    - Output rows are identified by the unique combinations of `index` column values.
    - For each unique value found in `column`, a new output column is created with that value as its header.
    - The cell at a given (index combination, column value) is filled with the `value` from the first matching input row (by input order) that has that index combination and that column value.
    - Missing combinations (an index combination that has no row with a particular column value) are filled with empty string.
    - Output columns: `index` columns (in declaration order), followed by the new pivot columns sorted in ascending lexicographic order.
    - Output rows are sorted by the `index` columns in ascending lexicographic order, comparing left to right.
    - If any referenced column (`index`, `column`, or `value`) does not exist, exit with error: `ERROR: invalid recipe: column <name> not found`.

  - `unpivot`: Reshape data from wide format to long format (reverse of pivot).
    - `index`: array of column names to keep as-is (the row identifiers).
    - `columns`: array of column names to "melt" into rows.
    - `name_to`: name of the new column that will contain the original column names.
    - `value_to`: name of the new column that will contain the values.

    Behavior:
    - For each input row, produces one output row per column listed in `columns`.
    - Output columns: `index` columns (in declaration order), then `name_to`, then `value_to`.
    - Output rows: for each input row (in original input order), one output row per melted column (in `columns` declaration order).
    - Empty values are preserved (not skipped).
    - If any referenced column (in `index` or `columns`) does not exist, exit with error: `ERROR: invalid recipe: column <name> not found`.

  - `fill`: Fill empty values in specified columns.
    - `columns`: array of column names whose empty values should be filled.
    - `strategy`: one of `"forward"`, `"backward"`, `"constant"`.
    - `value` (required only for `"constant"` strategy): the replacement value string.

    Behavior:
    - `"forward"`: scan rows top to bottom. For each specified column, replace each empty value with the most recent non-empty value seen above it in the same column. Leading empty values (no non-empty value above) remain empty.
    - `"backward"`: scan rows bottom to top. For each specified column, replace each empty value with the nearest non-empty value below it in the same column. Trailing empty values (no non-empty value below) remain empty.
    - `"constant"`: replace all empty values in the specified columns with the given `value` string.
    - Non-empty values are never modified.
    - Output preserves the original row order and all columns.
    - If any referenced column does not exist, exit with error: `ERROR: invalid recipe: column <name> not found`.

- After all transformations, write the result CSV to `<output>`, its SHA-256 to `<output>.sha256`.

### Verification

`dpipe verify --file <path> --checksum <path>`

- Reads `<path>`, computes SHA-256, compares against the hex string in `<checksum>`.
- Exit code 0 and prints `VERIFIED` to stdout if they match; exit code 1 and prints `MISMATCH expected=<expected> actual=<actual>` if they differ.

### Manifest

`dpipe manifest --dir <path> --output <path>`

- Recursively scans `<dir>` for all `.csv` files.
- For each file, computes its SHA-256.
- Writes a JSON manifest to `<output>`:
  ```json
  {
    "generated_at": "<RFC 3339 UTC timestamp>",
    "files": [
      {"path": "relative/to/dir/file.csv", "sha256": "abcdef...", "rows": 42, "size_bytes": 1234}
    ]
  }
  ```
- The `files` array is sorted by `path` lexicographically.
- The `generated_at` timestamp must reflect the actual time of generation.

### Pipeline

`dpipe pipeline --config <path>`

- Reads a pipeline config (JSON):
  ```json
  {
    "seed": 12345,
    "steps": [
      {"type": "ingest", "input": "raw.csv", "schema": "schema.json", "output": "clean.csv"},
      {"type": "transform", "input": "clean.csv", "recipe": "recipe.json", "output": "final.csv"},
      {"type": "verify", "file": "final.csv", "checksum": "final.csv.sha256"},
      {"type": "manifest", "dir": ".", "output": "manifest.json"}
    ]
  }
  ```
- Executes each step sequentially. If any step fails, the pipeline stops and exits with code 1, printing `PIPELINE FAILED at step N: <error>` (N is 1-indexed).
- On success, exits with code 0 and prints `PIPELINE OK: N steps completed`.

### Determinism contract

Running the same command with the same inputs and seed must always produce byte-identical output files. This applies to all commands. The only exception is `generated_at` in manifest output, which reflects wall-clock time.

### Error handling

- Missing input files: exit code 1, stderr message `ERROR: file not found: <path>`.
- Schema validation failures during ingest: do not exit with error; write rejected rows to `.rejected` file.
- Invalid recipe operations (unknown op, referencing non-existent column in filter/sort/aggregate/join): exit code 1, stderr `ERROR: invalid recipe: <detail>`.
- Malformed JSON config/schema/recipe: exit code 1, stderr `ERROR: malformed JSON: <path>`.
- Invalid regex pattern in schema: exit code 1, stderr `ERROR: invalid pattern: <pattern>`.

The tool must be buildable with `go build -o dpipe ./...` from `/app/`.
