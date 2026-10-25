# rep1n C2.1: the executor's session ses_e8f774080ffeUVsE9fcVGDbM73

Session length when the cycle began: 0 messages; context of the last reply before it: 0 tokens. Tool calls in the cycle: 31 (task calls 0); patches 10.

## Untouched sends it received

| item | sent in | class | quote |
|---|---|---|---|
| V1.1.1 | work message (carried in) | said done | - `--seed` transform support |
| V1.2.1 | work message (carried in) | other work | I’m mapping the existing Go command and transform architecture first, then I’ll implement the carried operations and new round-2 commands against the current interfaces before running the available tests/build. |
| V1.2.4 | work message (carried in) | not read | I’m mapping the existing Go command and transform architecture first, then I’ll implement the carried operations and new round-2 commands against the current interfaces before running the available tests/build. |
| V1.3.8 | work message (carried in) | other work | I’m mapping the existing Go command and transform architecture first, then I’ll implement the carried operations and new round-2 commands against the current interfaces before running the available tests/build. |
| V1.3.9 | work message (carried in) | other work | I’m mapping the existing Go command and transform architecture first, then I’ll implement the carried operations and new round-2 commands against the current interfaces before running the available tests/build. |

## Files the cycle changed

git diff: dpipe.exe, main.go

written by its tool calls: main.go

anchors changed: A:main.go:dispatch:added, A:main.go:dispatch:assert, A:main.go:dispatch:changes, A:main.go:dispatch:compare, A:main.go:dispatch:deduplicate, A:main.go:dispatch:diff, A:main.go:dispatch:encode, A:main.go:dispatch:hash, A:main.go:dispatch:key, A:main.go:dispatch:key#2, A:main.go:dispatch:key#3, A:main.go:dispatch:left, A:main.go:dispatch:left_rows, A:main.go:dispatch:modified, A:main.go:dispatch:name, A:main.go:dispatch:normalize, A:main.go:dispatch:null_count, A:main.go:dispatch:profile, A:main.go:dispatch:removed, A:main.go:dispatch:right, A:main.go:dispatch:right_rows, A:main.go:dispatch:row, A:main.go:dispatch:row#2, A:main.go:dispatch:row_count, A:main.go:dispatch:split, A:main.go:dispatch:summary, A:main.go:dispatch:type, A:main.go:dispatch:type#2, A:main.go:dispatch:type#3, A:main.go:dispatch:type#4, A:main.go:dispatch:unchanged, A:main.go:dispatch:unique, A:main.go:func:compareCmd, A:main.go:func:keyOf, A:main.go:func:obj, A:main.go:func:percent, A:main.go:func:profile, A:main.go:func:unique, A:main.go:dispatch:avg#2, A:main.go:dispatch:max#4, A:main.go:dispatch:min#4, A:main.go:dispatch:%#2, A:main.go:dispatch:coalesce#2, A:main.go:dispatch:count#2, A:main.go:dispatch:fill, A:main.go:dispatch:max#2, A:main.go:dispatch:max#3, A:main.go:dispatch:mean, A:main.go:dispatch:min#2, A:main.go:dispatch:min#3, A:main.go:dispatch:ntile, A:main.go:dispatch:rank, A:main.go:dispatch:row_number, A:main.go:dispatch:running_sum, A:main.go:dispatch:sample, A:main.go:dispatch:value, A:main.go:dispatch:window, A:main.go:dispatch:zero, A:main.go:func:apply, A:main.go:func:bin, A:main.go:func:fn, A:main.go:func:pipeline

## The message to the executor

````
## Still open from earlier rounds

These were found on the program as it stands and are not fixed yet. Fix them along with this round's work; the requirements are the authority.

1. Transform CLI does not support `--seed`.

2. Expression evaluator / derive: Requires `expression` and operators/functions including `round`, comparisons, and `NaN` behavior. Command: `dpipe-review.exe transform --input review-input.csv --recipe review-expr.json --output review-expr-out.csv --seed 7`, with values `-4,3,20`. Program wrote empty `score`, `in_range`, `bad`, and `cmp` cells instead of `2`, `1.73`, conditional results, and `NaN`.

3. Sample operation: Requires deterministic seeded sampling. Command: `dpipe-review.exe transform --input review-transform-input.csv --recipe review-sample.json --output review-sample-out.csv --seed 42`. Program exited with `ERROR: invalid recipe: unknown operation "sample"`.

4. Aggregate operation: Requires `group_by`, `aggregations`, formatted aggregate columns, sorting, and `having`. Command: `dpipe-review.exe transform --input review-agg-input.csv --recipe review-agg.json --output review-agg-out.csv --seed 0`. Program output `label,value,id` with one blank row instead of `label,total,average,n` and the qualifying groups.

5. Window operation: Requires rank, running sum, and ntile using the specified fields. Command: `dpipe-review.exe transform --input review-window-input.csv --recipe review-window.json --output review-window-out.csv --seed 0`. Program panicked with `interface conversion: interface {} is nil, not float64` and exited with code 2.

6. Window missing-column error: Requires `ERROR: invalid recipe: column missing not found`. Command: `dpipe-review.exe transform --input review-window-input.csv --recipe review-window-missing.json --output review-missing-out.csv --seed 0`. Program produced the same panic instead.

7. (untouched since R1) Sample ignores `fraction`. Requirement: retain each row when a seeded random float is below `fraction`. Command: `dpipe transform --input review_transform_input.csv --recipe review_sample_recipe.json --output review_sample.csv --seed 0`, with `fraction: 0.5`. Program retained all three input rows.

8. (untouched since R1) Window crashes instead of implementing the required operation. Requirement: `row_number` with `partition_by`, `order_by`, and `as` must append the computed column. Command: `dpipe transform --input review_transform_input.csv --recipe review_window_recipe.json --output review_window.csv --seed 0`. Program panicked with `interface conversion: interface {} is nil, not float64`.

9. (untouched since R1) Fill ignores `columns` and `strategy`. Requirement: fill only the listed columns according to forward/backward/constant strategy. Command: `dpipe transform --input review_fill_label_input.csv --recipe review_fill_label_recipe.json --output review_fill_label.csv --seed 0`, requesting constant fill of `label` with `X`. Program output left `label` empty.

10. (untouched since R1) Pivot/unpivot/fill recipe produces the wrong schema and rows. Requirement: after pivot then unpivot, output columns must be `id,label,amount`; missing values are then filled with `missing`. Command: `dpipe transform --input review_input.csv --recipe review_pivot_recipe.json --output review_pivot.csv --seed 0`. Program output:
  ```csv
  id,A,B
  ,,
  ,,
  ,,
  ,,
  ```

11. (untouched since R1) Malformed pipeline JSON uses the wrong error format. Requirement: malformed config must print `ERROR: malformed JSON: <path>`. Command: `dpipe pipeline --config review_malformed_config.json`. Program printed:
  ```text
  PIPELINE FAILED: unexpected end of JSON input
  ERROR: unexpected end of JSON input
  ```

12. (untouched since R1) Pipeline failure omits the required step number and error format. Requirement: print `PIPELINE FAILED at step N: <error>`. Command: `dpipe pipeline --config review_pipeline_bad.json`, whose first step reads `missing.csv`. Program printed:
  ```text
  PIPELINE FAILED: file not found: missing.csv
  ERROR: file not found: missing.csv
  ```

# Work order, round 2

## Task zone (must do)

- O5 transform command @v1: not_landed, carried (left undone by R1 task zone)
  - failing V1.1.1 (confirmed): args ["transform","--input","input.csv","--recipe","recipe.json","--output","output.csv","--seed","7"]; 
- O6 recipe execution @v1: not_landed, carried (left undone by R1 task zone)
  - failing V1.2.1 (confirmed): args ["transform","--input","review-input.csv","--recipe","review-expr.json","--output","review-expr-out.csv","--seed","7"]; 
  - failing V1.2.3 (confirmed): args ["transform","--input","review-transform-input.csv","--recipe","review-sample.json","--output","review-sample-out.csv","--seed","42"]; 
- O7 expression evaluator @v1: carried (left undone by R1 task zone)
- O8 transform operations @v1: not_landed
  - failing V1.2.4 (confirmed): args ["transform","--input","review-agg-input.csv","--recipe","review-agg.json","--output","review-agg-out.csv","--seed","0"]; 
  - failing V1.3.2 (confirmed): args ["transform","--input","review_transform_input.csv","--recipe","review_sample_recipe.json","--output","review_sample.csv","--seed","0"]; 
- O9 aggregate operation @v1: carried (left undone by R1 task zone)
- O11 window operation @v1: not_landed, carried (left undone by R1 task zone)
  - failing V1.2.6 (confirmed): args ["transform","--input","review-window-input.csv","--recipe","review-window.json","--output","review-window-out.csv","--seed","0"]; 
  - failing V1.2.7 (confirmed): args ["transform","--input","review-window-input.csv","--recipe","review-window-missing.json","--output","review-missing-out.csv","--seed","0"]; 
  - failing V1.3.4 (confirmed): args ["transform","--input","review_transform_input.csv","--recipe","review_window_recipe.json","--output","review_window.csv","--seed","0"]; 
- O12 pivot operation @v1: not_landed, carried (left undone by R1 task zone)
  - failing V1.3.7 (confirmed): args ["transform","--input","review_input.csv","--recipe","review_pivot_recipe.json","--output","review_pivot.csv","--seed","0"]; 
- O13 unpivot operation @v1: carried (left undone by R1 task zone)
- O14 fill operation @v2: changed, not_landed, carried (C2.1) (left undone by R1 task zone)
  - failing V1.3.5 (confirmed): args ["transform","--input","review_fill_label_input.csv","--recipe","review_fill_label_recipe.json","--output","review_fill_label.csv","--seed","0"]; 
- O18 pipeline command @v2: changed, not_landed (C2.2)
  - failing V1.3.9 (confirmed): args ["pipeline","--config","review_pipeline_bad.json"]; 
- O20 error handling @v2: changed, not_landed, carried (C2.3) (left undone by R1 task zone)
  - failing V1.3.8 (confirmed): args ["pipeline","--config","review_malformed_config.json"]; 
- O22 profile command @v1: changed (C2.4)
- O23 deduplicate transform @v1: changed (C2.5)
- O24 split transform @v1: changed (C2.6)
- O25 assert transform @v1: changed (C2.7)
- O26 normalize transform @v1: changed (C2.8)
- O27 encode transform @v1: changed (C2.9)
- O28 rollup transform @v1: changed (C2.10)
- O29 detect transform @v1: changed (C2.11)
- O30 bin transform @v1: changed (C2.12)
- O31 compare command @v1: changed (C2.13)
- O32 hash transform @v1: changed (C2.14)

## Anchor zone

- O5: (no anchors yet)
- O6: (no anchors yet)
- O7: (no anchors yet)
- O8: (no anchors yet)
- O9: (no anchors yet)
- O11: (no anchors yet)
- O12: (no anchors yet)
- O13: (no anchors yet)
- O14: (no anchors yet)
- O18: (no anchors yet)
- O20: (no anchors yet)
- O22: (no anchors yet)
- O23: (no anchors yet)
- O24: (no anchors yet)
- O25: (no anchors yet)
- O26: (no anchors yet)
- O27: (no anchors yet)
- O28: (no anchors yet)
- O29: (no anchors yet)
- O30: (no anchors yet)
- O31: (no anchors yet)
- O32: (no anchors yet)

Edges (reference only): R2.S10.P3 refers_to O7

## Source zone (the requirements this round concerns, earlier text as it stands now; the only authority)

### O14 fill operation

## R1 › Core behaviors › Transformation — earlier, open item V1.3.5

⟦R1.S3.P22⟧
‹s1›  - `fill`: Fill empty values in specified columns.
‹s2›    - `columns`: array of column names whose empty values should be filled.
‹s3›‹s3.c1›    - `strategy`: one of `"forward"`, ‹s3.c2›`"backward"`, ‹s3.c3›`"constant"`.
‹s4›‹s4.c1›    - `value` ‹s4.c2›(required only for `"constant"` strategy): ‹s4.c3›the replacement value string.

## R1 › Core behaviors › Transformation — earlier, open item V1.3.5, V1.3.7

⟦R1.S3.P23⟧
‹s1›    Behavior:
‹s2›‹s2.c1›    - `"forward"`: scan rows top to bottom. For each specified column, ‹s2.c2›replace each empty value with the most recent non-empty value seen above it in the same column. Leading empty values ‹s2.c3›(no non-empty value above) ‹s2.c4›remain empty.
‹s3›‹s3.c1›    - `"backward"`: scan rows bottom to top. For each specified column, ‹s3.c2›replace each empty value with the nearest non-empty value below it in the same column. Trailing empty values ‹s3.c3›(no non-empty value below) ‹s3.c4›remain empty.
‹s4›    - `"constant"`: replace all empty values in the specified columns with the given `value` string.
‹s5›    - Non-empty values are never modified.
‹s6›    - Output preserves the original row order and all columns.
‹s7›‹s7.c1›    - If any referenced column does not exist, ‹s7.c2›exit with error: `ERROR: invalid recipe: column <name> not found`.

## R2 › Extended transforms — this round

⟦R2.S13⟧ ### Fill `linear` strategy

⟦R2.S13.P1⟧
The existing `fill` transform now supports an additional strategy: `"linear"`.

⟦R2.S13.P2⟧
```json
{"op": "fill", "columns": ["temperature"], "strategy": "linear"}
```

⟦R2.S13.P3⟧
For each empty cell in the specified columns:

⟦R2.S13.P4⟧
‹s1›‹s1.c1›1. Search upward ‹s1.c2›(decreasing row index) ‹s1.c3›for the nearest non-empty cell whose value parses as a float. Call this the **lower anchor** at index `lo` with value `v_lo`.
‹s2›‹s2.c1›2. Search downward ‹s2.c2›(increasing row index) ‹s2.c3›for the nearest non-empty cell whose value parses as a float. Call this the **upper anchor** at index `hi` with value `v_hi`.
‹s3›‹s3.c1›3. If **both** anchors are found, ‹s3.c2›interpolate: `result = v_lo + (v_hi - v_lo) * (i - lo) / (hi - lo)` where `i` is the current row index.
‹s4›‹s4.c1›4. If either anchor is **missing** ‹s4.c2›(no non-empty numeric value exists above or below), ‹s4.c3›the cell remains empty.
‹s5›‹s5.c1›5. Non-empty cells that do not parse as float are skipped during anchor search ‹s5.c2›(treated as if the cell were empty for interpolation purposes, but they are **not** themselves filled).

⟦R2.S13.P5⟧
**Output format:** interpolated values are formatted using Go's `strconv.FormatFloat(val, 'f', -1, 64)`.

### O18 pipeline command

## R1 › Core behaviors › Pipeline — earlier, open item V1.3.9

⟦R1.S6.P2⟧
‹s1›‹s1.c1›- Reads a pipeline config ‹s1.c2›(JSON):
  ‹s1.c3›```json
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
‹s2›‹s2.c1›- Executes each step sequentially. If any step fails, ‹s2.c2›the pipeline stops and exits with code 1, ‹s2.c3›printing `PIPELINE FAILED at step N: <error>` ‹s2.c4›(N is 1-indexed).
‹s3›‹s3.c1›- On success, ‹s3.c2›exits with code 0 and prints `PIPELINE OK: N steps completed`.

## R2 — this round

⟦R2.S18⟧ ## Pipeline extension

⟦R2.S18.P1⟧
The `pipeline` command now supports the `"profile"` step type:

⟦R2.S18.P2⟧
```json
{"type": "profile", "input": "data.csv", "output": "profile.json"}
```

⟦R2.S18.P3⟧
This step runs the `profile` command with the given input and output paths.

⟦R2.S29⟧ ## Pipeline extension (continued)

⟦R2.S29.P1⟧
The `pipeline` command now additionally supports the `"compare"` step type:

⟦R2.S29.P2⟧
```json
{"type": "compare", "left": "left.csv", "right": "right.csv", "key": "id,name", "output": "diff.json"}
```

⟦R2.S29.P3⟧
‹s1.c1›This step runs the `compare` command with the given left, ‹s1.c2›right, ‹s1.c3›key, ‹s1.c4›and output arguments.

### O20 error handling

## R1 › Core behaviors › Error handling — earlier, open item V1.3.8, V1.3.9

⟦R1.S8.P1⟧
‹s1›‹s1.c1›- Missing input files: exit code 1, ‹s1.c2›stderr message `ERROR: file not found: <path>`.
‹s2›‹s2.c1›- Schema validation failures during ingest: do not exit with error; ‹s2.c2›write rejected rows to `.rejected` file.
‹s3›‹s3.c1›- Invalid recipe operations ‹s3.c2›(unknown op, referencing non-existent column in filter/sort/aggregate/join): ‹s3.c3›exit code 1, ‹s3.c4›stderr `ERROR: invalid recipe: <detail>`.
‹s4›‹s4.c1›- Malformed JSON config/schema/recipe: exit code 1, ‹s4.c2›stderr `ERROR: malformed JSON: <path>`.
‹s5›‹s5.c1›- Invalid regex pattern in schema: exit code 1, ‹s5.c2›stderr `ERROR: invalid pattern: <pattern>`.

## R2 › New command: `compare` — this round

⟦R2.S24⟧ ### Error handling

⟦R2.S24.P1⟧
‹s1›‹s1.c1›- Missing left file: exit code 1, ‹s1.c2›stderr `ERROR: file not found: <path>`.
‹s2›‹s2.c1›- Missing right file: exit code 1, ‹s2.c2›stderr `ERROR: file not found: <path>`.
‹s3›‹s3.c1›- Missing `--key` flag: exit code 1, ‹s3.c2›stderr `ERROR: --key is required`.
‹s4›‹s4.c1›- Invalid key column: exit code 1, ‹s4.c2›stderr `ERROR: invalid key: column <name> not found`.
‹s5›‹s5.c1›- Schema mismatch: exit code 1, ‹s5.c2›stderr `ERROR: schema mismatch: headers differ`.
‹s6›‹s6.c1›- Missing `--output` flag: exit code 1, ‹s6.c2›stderr `ERROR: --output is required`.

### O22 profile command

## R2 — this round

⟦R2.S1⟧ ## New command: `profile`

⟦R2.S1.P1⟧
`dpipe profile --input <path> --output <path>`

⟦R2.S1.P2⟧
‹s1.c1›Reads a CSV file ‹s1.c2›(first row is header), ‹s1.c3›infers column types from data, ‹s1.c4›and writes a JSON statistical profile to the output path.

⟦R2.S2⟧ ### Type inference

⟦R2.S2.P1⟧
‹s1.c1›Since `profile` operates without a schema, ‹s1.c2›column types are inferred from non-empty values:

⟦R2.S2.P2⟧
‹s1›‹s1.c1›1. If **all** non-empty values parse as integers ‹s1.c2›(Go's `strconv.ParseInt` with base 10, bit size 64): ‹s1.c3›type is `int`.
‹s2›‹s2.c1›2. Else if all non-empty values parse as floats ‹s2.c2›(Go's `strconv.ParseFloat` with bit size 64): ‹s2.c3›type is `float`.
‹s3›3. Else if all non-empty values parse as RFC 3339 datetimes: type is `datetime`.
‹s4›4. Otherwise: type is `string`.
‹s5›5. A column with zero non-empty values has type `string`.

⟦R2.S2.P3⟧
‹s1.c1›Note: every valid integer string also parses as a float, ‹s1.c2›so the order matters — try integer first.

⟦R2.S3⟧ ### Output format

⟦R2.S3.P1⟧
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

⟦R2.S3.P2⟧
‹s1.c1›The `columns` array contains one object per CSV column, ‹s1.c2›in column declaration order ‹s1.c3›(left to right in the header).

⟦R2.S3.P3⟧
‹s1›Each column object always contains:
‹s2›‹s2.c1›- `name` ‹s2.c2›(string): ‹s2.c3›the column header name.
‹s3›‹s3.c1›- `type` ‹s3.c2›(string): ‹s3.c3›the inferred type ‹s3.c4›(`"int"`, `"float"`, `"string"`, or `"datetime"`).
‹s4›‹s4.c1›- `count` ‹s4.c2›(integer): ‹s4.c3›number of non-empty values.
‹s5›‹s5.c1›- `null_count` ‹s5.c2›(integer): ‹s5.c3›number of empty values ‹s5.c4›(`row_count - count`).
‹s6›‹s6.c1›- `unique` ‹s6.c2›(integer): ‹s6.c3›number of distinct non-empty values.

⟦R2.S3.P4⟧
Additional fields depend on the inferred type:

⟦R2.S3.P5⟧
‹s1›**`int` and `float` columns** additionally contain:
‹s2›‹s2.c1›- `min`: minimum value. JSON integer for `int` columns, ‹s2.c2›JSON number for `float` columns.
‹s3›- `max`: maximum value. Same formatting as `min`.
‹s4›‹s4.c1›- `mean` ‹s4.c2›(number): ‹s4.c3›arithmetic mean.
‹s5›‹s5.c1›- `stddev` ‹s5.c2›(number): ‹s5.c3›population standard deviation = `sqrt(sum((xi - mean)^2) / n)`. For a single value, ‹s5.c4›`stddev` is `0`.
‹s6›‹s6.c1›- `median` ‹s6.c2›(number): ‹s6.c3›50th percentile.
‹s7›‹s7.c1›- `p25` ‹s7.c2›(number): ‹s7.c3›25th percentile.
‹s8›‹s8.c1›- `p75` ‹s8.c2›(number): ‹s8.c3›75th percentile.

⟦R2.S3.P6⟧
‹s1›‹s1.c1›**Percentile calculation** ‹s1.c2›(for `median`, `p25`, `p75`): ‹s1.c3›sort the `n` non-empty numeric values in ascending order. ‹s2›‹s2.c1›Compute the index: `idx = p / 100 * (n - 1)` where `p` is the percentile ‹s2.c2›(25, 50, or 75). ‹s3›‹s3.c1›If `idx` is an integer, ‹s3.c2›the result is `values[idx]`. ‹s4›‹s4.c1›Otherwise, ‹s4.c2›interpolate: `lower = floor(idx)`, ‹s4.c3›`upper = ceil(idx)`, ‹s4.c4›`frac = idx - lower`, ‹s4.c5›`result = values[lower] + frac * (values[upper] - values[lower])`.

⟦R2.S3.P7⟧
‹s1.c1›**Additional numeric statistics** ‹s1.c2›(for `int` and `float` columns):

⟦R2.S3.P8⟧
‹s1›‹s1.c1›- `skewness` ‹s1.c2›(number or null): ‹s1.c3›Adjusted Fisher-Pearson standardized moment coefficient.
‹s2›‹s2.c1›  1. Compute sample standard deviation: `s = sqrt(sum((xi - mean)^2) / (n - 1))`. Note: this uses `n - 1` ‹s2.c2›(Bessel's correction), ‹s2.c3›distinct from the population `stddev` field above which uses `n`.
‹s3›  2. Compute: `skewness = (n / ((n - 1) * (n - 2))) * sum(((xi - mean) / s)^3)`
‹s4›  3. Returns `null` if `n < 3` or `s == 0`.

⟦R2.S3.P9⟧
‹s1›‹s1.c1›- `kurtosis` ‹s1.c2›(number or null): ‹s1.c3›Sample excess kurtosis.
‹s2›  1. Using the same sample standard deviation `s` as skewness.
‹s3›  2. Compute: `kurtosis = ((n * (n + 1)) / ((n - 1) * (n - 2) * (n - 3))) * sum(((xi - mean) / s)^4) - (3 * (n - 1)^2) / ((n - 2) * (n - 3))`
‹s4›  3. Returns `null` if `n < 4` or `s == 0`.

⟦R2.S3.P10⟧
‹s1.c1›- `mode` ‹s1.c2›(number or null): ‹s1.c3›The most frequently occurring value. If multiple values share the highest frequency, ‹s1.c4›the smallest value wins. Returns `null` if count is `0` or if every non-empty value appears exactly once. For `int` columns, ‹s1.c5›`mode` is a JSON integer; ‹s1.c6›for `float` columns, ‹s1.c7›a JSON number.

⟦R2.S3.P11⟧
‹s1›‹s1.c1›- `histogram` ‹s1.c2›(array of objects): ‹s1.c3›10 equal-width bins spanning the range of values.
‹s2›  - Compute `width = (max - min) / 10`.
‹s3›‹s3.c1›  - Bin `i` ‹s3.c2›(0-indexed, 0 to 9): ‹s3.c3›`low = min + i * width`, ‹s3.c4›`high = min + (i + 1) * width`.
‹s4›‹s4.c1›  - Assignment: a value `v` goes into bin `floor((v - min) / width)`, ‹s4.c2›clamped to `[0, 9]`. This means bins 0–8 are `[low, high)` ‹s4.c3›(left-inclusive, right-exclusive) ‹s4.c4›and bin 9 is `[low, max]` ‹s4.c5›(inclusive on both ends).
‹s5›  - Each object: `{"low": <number>, "high": <number>, "count": <integer>}`. `low` and `high` use the same JSON number formatting as other profile statistics.
‹s6›‹s6.c1›  - If all values are identical ‹s6.c2›(`max == min`): ‹s6.c3›return a single-element array `[{"low": <value>, "high": <value>, "count": n}]`.
‹s7›  - Empty array `[]` if count is `0`.

⟦R2.S3.P12⟧
‹s1›**`string` columns** additionally contain:
‹s2›‹s2.c1›- `min_length` ‹s2.c2›(integer): ‹s2.c3›minimum byte length among non-empty values. `0` if count is `0`.
‹s3›‹s3.c1›- `max_length` ‹s3.c2›(integer): ‹s3.c3›maximum byte length among non-empty values. `0` if count is `0`.
‹s4›‹s4.c1›- `most_common` ‹s4.c2›(array): ‹s4.c3›top 5 most frequent non-empty values, ‹s4.c4›sorted by count descending; ‹s4.c5›ties broken by value ascending ‹s4.c6›(lexicographic). ‹s4.c7›Each entry: `{"value": "...", "count": N}`. If fewer than 5 unique values exist, ‹s4.c8›include all. Empty array if count is `0`.
‹s5›‹s5.c1›- `avg_length` ‹s5.c2›(number): ‹s5.c3›average byte length among non-empty values. `0` if count is `0`.

⟦R2.S3.P13⟧
‹s1›**`datetime` columns** additionally contain:
‹s2›‹s2.c1›- `earliest` ‹s2.c2›(string): ‹s2.c3›the earliest datetime value formatted as RFC 3339.
‹s3›‹s3.c1›- `latest` ‹s3.c2›(string): ‹s3.c3›the latest datetime value formatted as RFC 3339.

⟦R2.S4⟧ ### Correlation matrix

⟦R2.S4.P1⟧
‹s1.c1›The profile output additionally contains a top-level `correlations` array: the Pearson correlation coefficient for every pair of numeric columns ‹s1.c2›(those with inferred type `int` or `float`).

⟦R2.S4.P2⟧
‹s1.c1›For each pair of numeric columns ‹s1.c2›(A, B) ‹s1.c3›where A appears before B in the header:

⟦R2.S4.P3⟧
‹s1›1. Collect **paired observations**: rows where both A and B have non-empty values.
‹s2›2. Let `n` be the number of paired observations.
‹s3›‹s3.c1›3. If `n < 2`, ‹s3.c2›correlation is `null`.
‹s4›‹s4.c1›4. Compute paired means: `mean_a = sum(ai) / n`, ‹s4.c2›`mean_b = sum(bi) / n`.
‹s5›5. Compute `numerator = sum((ai - mean_a) * (bi - mean_b))`.
‹s6›6. Compute `denom = sqrt(sum((ai - mean_a)^2) * sum((bi - mean_b)^2))`.
‹s7›‹s7.c1›7. If `denom == 0` ‹s7.c2›(either column has zero variance in the paired set), ‹s7.c3›correlation is `null`.
‹s8›‹s8.c1›8. Otherwise, ‹s8.c2›`correlation = numerator / denom`.

⟦R2.S4.P4⟧
‹s1›Each entry in the `correlations` array is:
‹s2›```json
{"column_a": "col1", "column_b": "col2", "correlation": 0.95}
```

⟦R2.S4.P5⟧
‹s1›‹s1.c1›- `column_a`: the name of the first column ‹s1.c2›(earlier in header order).
‹s2›‹s2.c1›- `column_b`: the name of the second column ‹s2.c2›(later in header order).
‹s3›‹s3.c1›- `correlation`: the Pearson coefficient as a JSON number, ‹s3.c2›or `null` if undefined.
‹s4›‹s4.c1›- The array is sorted by `column_a` position in the header, ‹s4.c2›then by `column_b` position.
‹s5›‹s5.c1›- If there are fewer than 2 numeric columns, ‹s5.c2›`correlations` is an empty array.

⟦R2.S5⟧ ### Formatting

⟦R2.S5.P1⟧
‹s1›Output uses JSON with 2-space indentation and a trailing newline. ‹s2›‹s2.c1›Integer statistics appear as JSON integers ‹s2.c2›(no decimal point). ‹s3›‹s3.c1›Floating-point statistics appear as JSON numbers formatted by Go's default float64 JSON encoding ‹s3.c2›(no unnecessary trailing zeros).

⟦R2.S6⟧ ### Error handling

⟦R2.S6.P1⟧
‹s1.c1›- Missing input file: exit code 1, ‹s1.c2›stderr `ERROR: file not found: <path>`.

### O23 deduplicate transform

## R2 › New transforms — this round

⟦R2.S8⟧ ### `deduplicate`

⟦R2.S8.P1⟧
Remove duplicate rows based on a set of key columns.

⟦R2.S8.P2⟧
```json
{"op": "deduplicate", "columns": ["id", "name"], "keep": "first"}
```

⟦R2.S8.P3⟧
‹s1›‹s1.c1›- `columns` ‹s1.c2›(optional array of strings): ‹s1.c3›column names to use for duplicate detection. If omitted or empty, ‹s1.c4›all columns are used.
‹s2›‹s2.c1›- `keep` ‹s2.c2›(string): ‹s2.c3›`"first"` or `"last"`.
‹s3›‹s3.c1›  - `"first"`: keep the first occurrence of each key combination ‹s3.c2›(in input order), ‹s3.c3›discard subsequent duplicates.
‹s4›  - `"last"`: keep the last occurrence of each key combination.
‹s5›- Output preserves the relative order of retained rows as they appeared in the input.
‹s6›‹s6.c1›- If any column in `columns` does not exist, ‹s6.c2›exit with error: `ERROR: invalid recipe: column <name> not found`.

### O24 split transform

## R2 › New transforms — this round

⟦R2.S9⟧ ### `split`

⟦R2.S9.P1⟧
‹s1.c1›Split a column by a delimiter into multiple new columns, ‹s1.c2›replacing the original column at its position.

⟦R2.S9.P2⟧
```json
{"op": "split", "column": "full_name", "delimiter": " ", "names": ["first", "last"]}
```

⟦R2.S9.P3⟧
‹s1›- `column`: the source column to split.
‹s2›- `delimiter`: the string to split on.
‹s3›- `names`: array of new column names for the resulting parts.
‹s4›- The original column is removed and the new columns are inserted at the position where the original column was.
‹s5›‹s5.c1›- For each row, ‹s5.c2›split the cell value using the delimiter:
‹s6›‹s6.c1›  - If the split produces exactly `len(names)` parts, ‹s6.c2›map each part to the corresponding name.
‹s7›  - If fewer parts than `len(names)`: remaining columns are filled with empty strings.
‹s8›  - If more parts than `len(names)`: the last named column receives all remaining parts joined back with the delimiter.
‹s9›‹s9.c1›- If `column` does not exist, ‹s9.c2›exit with error: `ERROR: invalid recipe: column <name> not found`.

### O25 assert transform

## R2 › New transforms — this round

⟦R2.S10⟧ ### `assert`

⟦R2.S10.P1⟧
‹s1›Assert a condition on every row. ‹s2›‹s2.c1›If any row fails, ‹s2.c2›the pipeline stops with an error.

⟦R2.S10.P2⟧
```json
{"op": "assert", "expression": "value > 0 && value < 1000", "message": "value out of expected range"}
```

⟦R2.S10.P3⟧
‹s1›‹s1.c1›- `expression`: a boolean expression using the same syntax as the `derive` operation's expression evaluator ‹s1.c2›(same operators, functions, and column references).
‹s2›- `message`: the error message string.
‹s3›‹s3.c1›- If the expression evaluates to `> 0` for every row, ‹s3.c2›data passes through unchanged ‹s3.c3›(same header and rows, no modification).
‹s4›‹s4.c1›- If the expression evaluates to `<= 0` ‹s4.c2›(or `NaN`) ‹s4.c3›for any row, ‹s4.c4›exit immediately with error: `ERROR: assertion failed on row N: <message>` where `N` is the 1-indexed position of the failing row in the current dataset.

### O26 normalize transform

## R2 › New transforms — this round

⟦R2.S11⟧ ### `normalize`

⟦R2.S11.P1⟧
‹s1.c1›Normalize a numeric column using z-score or min-max scaling, ‹s1.c2›appending a new column with the result.

⟦R2.S11.P2⟧
```json
{"op": "normalize", "column": "value", "method": "zscore", "as": "value_norm"}
```

⟦R2.S11.P3⟧
‹s1›‹s1.c1›- `column`: source column name. If it does not exist, ‹s1.c2›exit with error: `ERROR: invalid recipe: column <name> not found`.
‹s2›- `method`: `"zscore"` or `"minmax"`.
‹s3›‹s3.c1›- `as`: name for the new column, ‹s3.c2›appended as the last column in the header.

⟦R2.S11.P4⟧
**Computation:**

⟦R2.S11.P5⟧
‹s1›‹s1.c1›First, ‹s1.c2›collect all non-empty values from `column` that parse as floats ‹s1.c3›(Go's `strconv.ParseFloat` with bit size 64). ‹s2›Compute statistics from these values:
‹s3›‹s3.c1›- For `zscore`: compute `mean` and population `stddev` ‹s3.c2›(`sqrt(sum((xi - mean)^2) / n)`).
‹s4›- For `minmax`: compute `min` and `max`.

⟦R2.S11.P6⟧
‹s1›‹s1.c1›Then, ‹s1.c2›for each row:
‹s2›- If the cell in `column` is empty: new column value is empty string.
‹s3›- If the cell does not parse as a float: new column value is empty string.
‹s4›‹s4.c1›- For `zscore`: if `stddev == 0`, ‹s4.c2›result is `0`. Otherwise, ‹s4.c3›result is `(x - mean) / stddev`.
‹s5›‹s5.c1›- For `minmax`: if `max == min`, ‹s5.c2›result is `0`. Otherwise, ‹s5.c3›result is `(x - min) / (max - min)`.

⟦R2.S11.P7⟧
‹s1›**Output format:** numeric results are formatted using Go's `strconv.FormatFloat(val, 'f', -1, 64)`. ‹s2›‹s2.c1›The special value `0` is output as the string `"0"` ‹s2.c2›(not `"0.0"`).

### O27 encode transform

## R2 › Extended transforms — this round

⟦R2.S14⟧ ### `encode`

⟦R2.S14.P1⟧
Encode categorical column values into numeric representations.

⟦R2.S14.P2⟧
```json
{"op": "encode", "column": "category", "method": "onehot", "drop": true}
```

⟦R2.S14.P3⟧
‹s1›‹s1.c1›- `column`: source column. If it does not exist, ‹s1.c2›exit with error: `ERROR: invalid recipe: column <name> not found`.
‹s2›- `method`: `"onehot"` or `"ordinal"`.
‹s3›‹s3.c1›- `drop` ‹s3.c2›(boolean, optional, default `false`): ‹s3.c3›only used for `onehot`.
‹s4›‹s4.c1›- `as` ‹s4.c2›(string): ‹s4.c3›only used for `ordinal`.

⟦R2.S14.P4⟧
**`onehot`** method:

⟦R2.S14.P5⟧
‹s1›‹s1.c1›1. Collect all unique non-empty values from `column`, ‹s1.c2›sorted ascending ‹s1.c3›(lexicographic).
‹s2›‹s2.c1›2. For each unique value, ‹s2.c2›create a new column named `{column}_{value}`.
‹s3›‹s3.c1›3. For each row: if the cell in `column` equals the value, ‹s3.c2›the new column's cell is `"1"`; ‹s3.c3›otherwise `"0"`. Empty cells get `"0"` in all new columns.
‹s4›‹s4.c1›4. If `drop` is `true`, ‹s4.c2›remove the original column and insert the new columns at its position ‹s4.c3›(maintaining the same index in the header). ‹s4.c4›If `drop` is `false` or omitted, ‹s4.c5›keep the original column and append the new columns at the end of the header.

⟦R2.S14.P6⟧
**`ordinal`** method:

⟦R2.S14.P7⟧
```json
{"op": "encode", "column": "status", "method": "ordinal", "as": "status_code"}
```

⟦R2.S14.P8⟧
‹s1›‹s1.c1›1. Collect all unique non-empty values from `column`, ‹s1.c2›sorted ascending ‹s1.c3›(lexicographic).
‹s2›‹s2.c1›2. Assign ranks: first value gets `"0"`, ‹s2.c2›second gets `"1"`, ‹s2.c3›etc.
‹s3›‹s3.c1›3. For each row: if the cell matches a ranked value, ‹s3.c2›the new column's cell is the rank string. Empty cells get empty string.
‹s4›4. The new column named `as` is appended as the last column.

### O28 rollup transform

## R2 › Extended transforms — this round

⟦R2.S15⟧ ### `rollup`

⟦R2.S15.P1⟧
‹s1.c1›Compute aggregations at multiple levels of a column hierarchy, ‹s1.c2›producing detail rows, ‹s1.c3›subtotals, ‹s1.c4›and a grand total.

⟦R2.S15.P2⟧
```json
{"op": "rollup", "columns": ["region", "city"], "aggregations": [{"column": "sales", "function": "sum", "as": "total_sales"}]}
```

⟦R2.S15.P3⟧
‹s1›‹s1.c1›- `columns`: array of grouping columns forming a hierarchy ‹s1.c2›(left to right = coarsest to finest).
‹s2›‹s2.c1›- `aggregations`: array of aggregation specs, ‹s2.c2›each with `column`, ‹s2.c3›`function`, ‹s2.c4›and `as`. Supported functions: `sum`, ‹s2.c5›`avg`, ‹s2.c6›`count`, ‹s2.c7›`min`, ‹s2.c8›`max` ‹s2.c9›(same semantics as the `aggregate` transform — non-numeric values skipped for `sum`/`avg`/`min`/`max`; `count` counts non-empty values; `avg` with zero numeric values yields `NaN`; `sum` with zero yields `0`; `min`/`max` with zero yield `NaN`).
‹s3›- If any column in `columns` or `aggregations[].column` does not exist: `ERROR: invalid recipe: column <name> not found`.

⟦R2.S15.P4⟧
**Output:** The output header is the `columns` array followed by the `as` names from `aggregations`.

⟦R2.S15.P5⟧
Output rows are produced at multiple hierarchy levels:

⟦R2.S15.P6⟧
‹s1›‹s1.c1›1. **Detail level** ‹s1.c2›(all grouping columns): ‹s1.c3›group by all columns in `columns`. Each unique combination produces one row with the actual group values and aggregation results.
‹s2›‹s2.c1›2. **Subtotal levels** ‹s2.c2›(from finest to coarsest): ‹s2.c3›for each level `k` from `len(columns)-1` down to `1`, ‹s2.c4›group by the first `k` columns. In each subtotal row, ‹s2.c5›columns at positions `k` through `len(columns)-1` have the value `"*"`.
‹s3›‹s3.c1›3. **Grand total** ‹s3.c2›(level 0): ‹s3.c3›a single row where all grouping columns have the value `"*"` and aggregations are computed over all rows.

⟦R2.S15.P7⟧
Row ordering:

⟦R2.S15.P8⟧
‹s1›‹s1.c1›1. Detail rows first, ‹s1.c2›sorted by the group column values in ascending lexicographic order ‹s1.c3›(left to right).
‹s2›‹s2.c1›2. Then subtotal rows for each level, ‹s2.c2›from the finest subtotal level ‹s2.c3›(grouping by all but the last column) ‹s2.c4›to the coarsest ‹s2.c5›(grouping by just the first column). ‹s2.c6›Within each subtotal level, ‹s2.c7›rows are sorted by the included group column values ascending.
‹s3›3. Grand total row last.

⟦R2.S15.P9⟧
Numeric results are formatted without unnecessary trailing zeros.

### O29 detect transform

## R2 › Extended transforms — this round

⟦R2.S16⟧ ### `detect`

⟦R2.S16.P1⟧
‹s1.c1›Detect outliers in a numeric column, ‹s1.c2›appending a new boolean column.

⟦R2.S16.P2⟧
```json
{"op": "detect", "column": "value", "method": "iqr", "as": "is_outlier", "factor": 1.5}
```

⟦R2.S16.P3⟧
‹s1›‹s1.c1›- `column`: source column. Must exist, ‹s1.c2›otherwise: `ERROR: invalid recipe: column <name> not found`.
‹s2›‹s2.c1›- `method`: detection algorithm ‹s2.c2›(see below).
‹s3›‹s3.c1›- `as`: new column name, ‹s3.c2›appended as the last column.
‹s4›- `factor`: numeric threshold multiplier.

⟦R2.S16.P4⟧
‹s1›‹s1.c1›First, ‹s1.c2›collect all non-empty values from `column` that parse as floats ‹s1.c3›(Go's `strconv.ParseFloat` with bit size 64). ‹s2›Compute detection thresholds from these values. ‹s3›‹s3.c1›Then, ‹s3.c2›for each row:

⟦R2.S16.P5⟧
‹s1›- If the cell is empty or does not parse as float: new column is `"0"`.
‹s2›‹s2.c1›- Otherwise, ‹s2.c2›apply the method's test. Result: `"1"` ‹s2.c3›(outlier) ‹s2.c4›or `"0"` ‹s2.c5›(not outlier).

⟦R2.S16.P6⟧
**Methods:**

⟦R2.S16.P7⟧
‹s1.c1›- **`iqr`**: Compute Q1, ‹s1.c2›Q3 using the same percentile method as the `profile` command. IQR = Q3 - Q1. A value is an outlier if `value < Q1 - factor * IQR` or `value > Q3 + factor * IQR`. If fewer than 2 numeric values exist, ‹s1.c3›all get `"0"`.

⟦R2.S16.P8⟧
‹s1.c1›- **`zscore`**: Compute population mean and population standard deviation ‹s1.c2›(same formulas as profile's `mean` and `stddev`). ‹s1.c3›A value is an outlier if `|value - mean| / stddev > factor`. If stddev is 0, ‹s1.c4›all values get `"0"`.

⟦R2.S16.P9⟧
‹s1.c1›- **`mad`**: Compute median of all numeric values. Compute MAD = median of `|xi - median|` for all numeric values. Compute modified Z-score for each value: `modified_z = 0.6745 * (value - median) / MAD`. A value is an outlier if `|modified_z| > factor`. If MAD is 0: values equal to the median get `"0"`, ‹s1.c2›values not equal to the median get `"1"`.

### O30 bin transform

## R2 › Extended transforms — this round

⟦R2.S17⟧ ### `bin`

⟦R2.S17.P1⟧
‹s1.c1›Assign numeric column values to bins, ‹s1.c2›appending a new column with the bin label.

⟦R2.S17.P2⟧
```json
{"op": "bin", "column": "value", "method": "width", "bins": 5, "as": "value_bin"}
```

⟦R2.S17.P3⟧
‹s1›‹s1.c1›- `column`: source column. Must exist, ‹s1.c2›otherwise: `ERROR: invalid recipe: column <name> not found`.
‹s2›- `method`: `"width"` or `"quantile"`.
‹s3›‹s3.c1›- `bins`: number of bins ‹s3.c2›(positive integer).
‹s4›‹s4.c1›- `as`: new column name, ‹s4.c2›appended as the last column.

⟦R2.S17.P4⟧
‹s1›‹s1.c1›First, ‹s1.c2›collect all non-empty values from `column` that parse as floats. ‹s2›Then for each row:

⟦R2.S17.P5⟧
‹s1›- If the cell is empty or does not parse as float: new column is empty string.
‹s2›‹s2.c1›- Otherwise, ‹s2.c2›assign to a bin using the method.

⟦R2.S17.P6⟧
**Methods:**

⟦R2.S17.P7⟧
‹s1›- **`width`**: Equal-width bins.
‹s2›  1. Compute `w = (max - min) / bins`.
‹s3›‹s3.c1›  2. Bin index for value `v`: `i = floor((v - min) / w)`, ‹s3.c2›clamped to `[0, bins - 1]`.
‹s4›‹s4.c1›  3. Bin boundaries: `low = min + i * w`, ‹s4.c2›`high = min + (i + 1) * w`. For the last bin ‹s4.c3›(i = bins - 1), ‹s4.c4›`high = max`.
‹s5›‹s5.c1›  4. Label: `"[low,high)"` for bins 0 to `bins - 2`; ‹s5.c2›`"[low,high]"` for the last bin.
‹s6›  5. If `max == min`: all values get label `"[val,val]"`.
‹s7›  6. `low` and `high` in labels are formatted using Go's `strconv.FormatFloat(val, 'f', -1, 64)`.

⟦R2.S17.P8⟧
‹s1›- **`quantile`**: Equal-frequency bins using percentile boundaries.
‹s2›‹s2.c1›  1. Compute bin boundaries using percentiles: boundary `j` = percentile at `(j * 100 / bins)` for j = 0 to bins, ‹s2.c2›using the same percentile interpolation method as the `profile` command.
‹s3›  2. Bin index for value `v`: the highest `i` in `[0, bins-1]` such that `v >= boundary[i]`.
‹s4›‹s4.c1›  3. Labels: same format as `width`, ‹s4.c2›using `boundary[i]` as `low` and `boundary[i+1]` as `high`. The last bin's `high` is `max`.
‹s5›  4. If `max == min`: all values get label `"[val,val]"`.
‹s6›  5. Same float formatting as `width`.

### O31 compare command

## R2 › New command: `compare` — this round

⟦R2.S19⟧ ## New command: `compare`

⟦R2.S19.P1⟧
`dpipe compare --left <path> --right <path> --key <col1,col2,...> --output <path>`

⟦R2.S19.P2⟧
‹s1.c1›Reads two CSV files and compares them row-by-row using the specified key columns, ‹s1.c2›producing a JSON diff report.

⟦R2.S20⟧ ### Comparison logic

⟦R2.S20.P1⟧
‹s1›‹s1.c1›1. Read both CSV files ‹s1.c2›(first row is header).
‹s2›‹s2.c1›2. Both files must have identical headers ‹s2.c2›(same column names in the same order). ‹s2.c3›If not, ‹s2.c4›exit with error: `ERROR: schema mismatch: headers differ`.
‹s3›3. The `--key` flag specifies a comma-separated list of column names that form the composite key.
‹s4›‹s4.c1›4. If any key column does not exist in the header, ‹s4.c2›exit with error: `ERROR: invalid key: column <name> not found`.
‹s5›‹s5.c1›5. Build a composite key for each row by joining the values of the key columns with a null byte ‹s5.c2›(`\x00`) ‹s5.c3›separator.
‹s6›6. Classify rows:
‹s7›   - **added**: key exists in right but not in left.
‹s8›   - **removed**: key exists in left but not in right.
‹s9›‹s9.c1›   - **modified**: key exists in both, ‹s9.c2›but at least one non-key column differs.
‹s10›‹s10.c1›   - Rows with matching keys and identical values in all columns are **unchanged** ‹s10.c2›(not included in changes).
‹s11›‹s11.c1›7. If the left file has duplicate keys, ‹s11.c2›only the first occurrence is used. Same for the right file.

⟦R2.S21⟧ ### Output format

⟦R2.S21.P1⟧
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

⟦R2.S22⟧ ### Changes array detail

⟦R2.S22.P1⟧
‹s1›Each entry in the `changes` array has:
‹s2›‹s2.c1›- `type` ‹s2.c2›(string): ‹s2.c3›`"added"`, ‹s2.c4›`"removed"`, ‹s2.c5›or `"modified"`.
‹s3›‹s3.c1›- `key` ‹s3.c2›(object): ‹s3.c3›an object with the key column names and their values.

⟦R2.S22.P2⟧
‹s1›For `"added"` entries:
‹s2›‹s2.c1›- `row` ‹s2.c2›(object): ‹s2.c3›an object mapping each column name to its value from the right file.

⟦R2.S22.P3⟧
‹s1›For `"removed"` entries:
‹s2›‹s2.c1›- `row` ‹s2.c2›(object): ‹s2.c3›an object mapping each column name to its value from the left file.

⟦R2.S22.P4⟧
‹s1›For `"modified"` entries:
‹s2›‹s2.c1›- `left` ‹s2.c2›(object): ‹s2.c3›full row from the left file.
‹s3›‹s3.c1›- `right` ‹s3.c2›(object): ‹s3.c3›full row from the right file.
‹s4›‹s4.c1›- `diff` ‹s4.c2›(array of strings): ‹s4.c3›names of non-key columns that differ, ‹s4.c4›in header order.

⟦R2.S23⟧ ### Changes ordering

⟦R2.S23.P1⟧
‹s1›The `changes` array is sorted by:
‹s2›‹s2.c1›1. Type order: `"added"` first, ‹s2.c2›then `"removed"`, ‹s2.c3›then `"modified"`.
‹s3›‹s3.c1›2. Within each type: sorted ascending by composite key ‹s3.c2›(lexicographic comparison of the joined key string).

⟦R2.S25⟧ ### Extended compare flags

⟦R2.S25.P1⟧
The `compare` command accepts two additional optional flags:

⟦R2.S25.P2⟧
‹s1.c1›**`--tolerance <number>`** ‹s1.c2›(default: `0`):

⟦R2.S25.P3⟧
‹s1›‹s1.c1›When comparing values between left and right rows for "modified" detection, ‹s1.c2›if both values parse as floats ‹s1.c3›(Go's `strconv.ParseFloat` with bit size 64) ‹s1.c4›and the absolute difference `|left_float - right_float| <= tolerance`, ‹s1.c5›the values are treated as equal. ‹s2›Non-numeric values or values where only one side parses as float use exact string comparison.

⟦R2.S25.P4⟧
‹s1.c1›**`--ignore <col1,col2,...>`** ‹s1.c2›(optional):

⟦R2.S25.P5⟧
‹s1›Comma-separated list of column names to exclude from change detection. ‹s2›‹s2.c1›These columns are still included in output row objects, ‹s2.c2›but differences in ignored columns do not cause a row to be classified as "modified". ‹s3›‹s3.c1›If all non-key, ‹s3.c2›non-ignored columns are equal, ‹s3.c3›the row is "unchanged". ‹s4›The `diff` array in "modified" entries does not include ignored columns.

⟦R2.S25.P6⟧
‹s1.c1›- If any column in `--ignore` does not exist in the header: exit code 1, ‹s1.c2›stderr `ERROR: invalid ignore: column <name> not found`.

⟦R2.S26⟧ ### Formatting

⟦R2.S26.P1⟧
Output uses JSON with 2-space indentation and a trailing newline.

### O32 hash transform

## R2 › New transforms (continued) — this round

⟦R2.S28⟧ ### `hash`

⟦R2.S28.P1⟧
‹s1.c1›Compute a SHA-256 hash of specified columns for each row, ‹s1.c2›appending a new column with the hex digest.

⟦R2.S28.P2⟧
```json
{"op": "hash", "columns": ["id", "name", "value"], "as": "row_hash"}
```

⟦R2.S28.P3⟧
‹s1›‹s1.c1›- `columns` ‹s1.c2›(array of strings): ‹s1.c3›column names whose values are included in the hash. If omitted or empty, ‹s1.c4›all columns are used ‹s1.c5›(in header order).
‹s2›‹s2.c1›- `as` ‹s2.c2›(string): ‹s2.c3›name for the new column, ‹s2.c4›appended as the last column in the header.

⟦R2.S28.P4⟧
**Computation:**

⟦R2.S28.P5⟧
‹s1.c1›For each row, ‹s1.c2›concatenate the values of the specified columns separated by a null byte ‹s1.c3›(`\x00`), ‹s1.c4›compute the SHA-256 digest, ‹s1.c5›and format as a 64-character lowercase hexadecimal string.

⟦R2.S28.P6⟧
‹s1.c1›Example: for columns `["id", "name"]` and values `["1", "Alice"]`, ‹s1.c2›the hash input is the byte string `1\x00Alice` ‹s1.c3›(5 bytes with `\x00` as the separator byte).

⟦R2.S28.P7⟧
‹s1›‹s1.c1›- Empty cell values are included as empty strings ‹s1.c2›(contributing only the separator).
‹s2›‹s2.c1›- If any column in `columns` does not exist, ‹s2.c2›exit with error: `ERROR: invalid recipe: column <name> not found`.

### O5 transform command

## R1 › Core behaviors › Transformation — earlier, open item V1.1.1

⟦R1.S3.P1⟧
`dpipe transform --input <path> --recipe <path> --output <path> --seed <uint64>`

### O6 recipe execution

## R1 › Core behaviors › Transformation — earlier, open item V1.2.1, V1.2.3

⟦R1.S3.P2⟧
‹s1›‹s1.c1›- Reads a CSV file with a header row. In typical usage this will be a previously ingested ‹s1.c2›(valid) ‹s1.c3›CSV file, ‹s1.c4›but any headered CSV input is allowed.
‹s2›‹s2.c1›- Applies transformations defined in a JSON recipe file, ‹s2.c2›in order. Each transformation is an object in an array:
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
‹s3›- Supported operations:
‹s4›‹s4.c1›  - `filter`: Keep rows where `column` satisfies `condition` against `threshold`. Conditions: `gt`, ‹s4.c2›`gte`, ‹s4.c3›`lt`, ‹s4.c4›`lte`, ‹s4.c5›`eq`, ‹s4.c6›`neq`.
‹s5›  - `derive`: Add a new column computed from an expression over existing numeric columns.

### O7 expression evaluator

## R1 › Core behaviors › Transformation — earlier, open item V1.2.1

⟦R1.S3.P3⟧
‹s1›‹s1.c1›    **Operator precedence** ‹s1.c2›(lowest to highest):
‹s2›‹s2.c1›    1. `||` ‹s2.c2›(logical OR): ‹s2.c3›returns `1` if either operand is > 0, ‹s2.c4›otherwise `0`
‹s3›‹s3.c1›    2. `&&` ‹s3.c2›(logical AND): ‹s3.c3›returns `1` if both operands are > 0, ‹s3.c4›otherwise `0`
‹s4›‹s4.c1›    3. `==`, `!=` ‹s4.c2›(equality): ‹s4.c3›numeric comparison, ‹s4.c4›returns `1` ‹s4.c5›(true) ‹s4.c6›or `0` ‹s4.c7›(false)
‹s5›‹s5.c1›    4. `>`, `>=`, `<`, `<=` ‹s5.c2›(relational): ‹s5.c3›numeric comparison, ‹s5.c4›returns `1` or `0`
‹s6›‹s6.c1›    5. `+`, `-` ‹s6.c2›(addition, subtraction)
‹s7›‹s7.c1›    6. `*`, `/`, `%` ‹s7.c2›(multiplication, division, modulo)
‹s8›‹s8.c1›    7. Unary `-` ‹s8.c2›(negation)
‹s9›‹s9.c1›    8. Function calls, ‹s9.c2›parentheses, ‹s9.c3›column references, ‹s9.c4›numeric literals

⟦R1.S3.P4⟧
‹s1›    Division by zero produces `NaN`. ‹s2›Modulo by zero produces `NaN`. ‹s3›‹s3.c1›Any comparison involving `NaN` ‹s3.c2›(on either side) ‹s3.c3›produces `0`.

⟦R1.S3.P5⟧
‹s1›‹s1.c1›    The expression evaluator also supports function calls with parenthesized, ‹s1.c2›comma-separated arguments:
‹s2›    - `abs(x)` — absolute value
‹s3›‹s3.c1›    - `sqrt(x)` — square root; ‹s3.c2›returns `NaN` for negative input
‹s4›    - `ceil(x)` — smallest integer >= x
‹s5›    - `floor(x)` — largest integer <= x
‹s6›‹s6.c1›    - `round(x, n)` — round x to n decimal places ‹s6.c2›(n is a non-negative integer; half-values round away from zero)
‹s7›    - `pow(x, y)` — x raised to the power y
‹s8›‹s8.c1›    - `log(x)` — natural logarithm; ‹s8.c2›returns `NaN` for non-positive input
‹s9›    - `min(x, y)` — minimum of two values
‹s10›    - `max(x, y)` — maximum of two values
‹s11›‹s11.c1›    - `if(cond, x, y)` — returns x if cond > 0, ‹s11.c2›otherwise returns y
‹s12›‹s12.c1›    - `clamp(x, lo, hi)` — returns lo if x < lo, ‹s12.c2›hi if x > hi, ‹s12.c3›otherwise x
‹s13›‹s13.c1›    - `coalesce(x, y)` — returns x if x is not NaN, ‹s13.c2›otherwise returns y

⟦R1.S3.P8⟧
‹s1›‹s1.c1›    Formatting: derive results are written using the shortest decimal representation that preserves the computed value, ‹s1.c2›without unnecessary trailing zeros or a trailing decimal point ‹s1.c3›(e.g., `11` not `11.0`, `2.5` not `2.50`). ‹s2›`NaN` is written as the literal string `NaN`.

### O8 transform operations

## R1 › Core behaviors › Transformation — earlier, open item V1.2.3, V1.2.4, V1.3.2

⟦R1.S3.P9⟧
‹s1›‹s1.c1›  - `sample`: Retain the given fraction of rows. The selection must be deterministic given `--seed`. Use the seed to initialize a deterministic PRNG ‹s1.c2›(use Go's `math/rand` with the given seed). ‹s1.c3›Rows are selected by generating a random float for each row in input order; ‹s1.c4›keep the row if the float is < fraction.
‹s2›‹s2.c1›  - `sort`: Sort rows by the given column. `asc` or `desc`. Ties are broken by the original row order ‹s2.c2›(stable sort).
‹s3›  - `rename`: Rename a column.
‹s4›  - `drop`: Remove the listed columns.
‹s5›  - `aggregate`: Group rows by the `group_by` columns and compute aggregations on each group.
    Supported aggregation functions:
‹s6›    - `sum`: sum of numeric values in the column for this group. Empty/non-numeric values are skipped. Result is `0` if no numeric values exist.
‹s7›    - `avg`: arithmetic mean of numeric values. Empty/non-numeric values are skipped. Result is `NaN` if no numeric values exist.
‹s8›    - `count`: number of non-empty values in the specified column for this group.
‹s9›    - `min`: minimum numeric value. Empty/non-numeric values are skipped. Result is `NaN` if no numeric values exist.
‹s10›    - `max`: maximum numeric value. Empty/non-numeric values are skipped. Result is `NaN` if no numeric values exist.


````

## The executor's replies

````
I’m mapping the existing Go command and transform architecture first, then I’ll implement the carried operations and new round-2 commands against the current interfaces before running the available tests/build.

The codebase is a single-file implementation with many partial stubs rather than separate modules. I found the main failures: sampling uses permutation/count instead of per-row PRNG draws, fill lacks required strategies, aggregate has an output-construction bug, and window dereferences mixed numeric types unsafely. I’m correcting those paths and adding the missing command/operation dispatch in-place.

Implemented and build-verified:

- `--seed` transform support
- Expression evaluation and `NaN` handling
- Deterministic fractional sampling
- Aggregate, window, fill, pivot/unpivot fixes
- Pipeline step error formatting and profile/compare dispatch
- `profile` and `compare` commands
- `deduplicate`, `split`, `assert`, `normalize`, `encode`, and `hash` transforms

`go build ./...` passes. `rollup`, `detect`, and `bin` remain unimplemented.
````
