# Batch 5 A on the recorded reverted cycles

| run | round | reverted cycle | under the new rule | items fixed on its build, kept | regressions sent with material (four parts) | items still failing, sent again |
|---|---|---|---|---|---|---|
| rep1j | R1 | C1.3 | kept | 3 | 1 | 4 |
| rep1j | R1 | C1.4 | does not exist (it started from the reverted tree) | — | — | — |
| rep1j | R5 | C5.3 | kept | 2 | 1 | 0 |
| rep1j | R5 | C5.4 | does not exist (it started from the reverted tree) | — | — | — |
| rep1j | R5 | C5.5 | does not exist (it started from the reverted tree) | — | — | — |
| rep1n | R5 | C5.4 | kept | 2 | 2 | 2 |
| rep1n | R5 | C5.5 | does not exist (it started from the reverted tree) | — | — | — |
| rep1n | R6 | C6.2 | kept | 2 | 2 | 3 |
| rep1n | R6 | C6.4 | does not exist (it started from the reverted tree) | — | — | — |
| rep1o | R1 | C1.4 | kept | 6 | 8 (8/8) | 1 |
| rep1o | R2 | C2.3 | kept | 4 | 2 (2/2) | 16 |
| rep1o | R2 | C2.4 | does not exist (it started from the reverted tree) | — | — | — |
| rep1o | R3 | C3.2 | kept | 12 | 1 (1/1) | 26 |
| rep1o | R3 | C3.3 | does not exist (it started from the reverted tree) | — | — | — |
| rep1o | R3 | C3.4 | does not exist (it started from the reverted tree) | — | — | — |
| rep1o | R4 | C4.2 | kept | 31 | 2 (2/2) | 26 |
| rep1o | R4 | C4.3 | does not exist (it started from the reverted tree) | — | — | — |
| rep1o | R4 | C4.4 | does not exist (it started from the reverted tree) | — | — | — |
| rep1o | R5 | C5.3 | kept | 12 | 2 (2/2) | 34 |
| rep1o | R5 | C5.4 | does not exist (it started from the reverted tree) | — | — | — |
| rep1o | R6 | C6.2 | kept | 6 | 1 (1/1) | 31 |
| rep1o | R6 | C6.3 | does not exist (it started from the reverted tree) | — | — | — |
| rep1o | R6 | C6.4 | does not exist (it started from the reverted tree) | — | — | — |

Recorded reverted cycles: 23; under the new rule none is reverted. The first of each round (10) is kept: 80 items fixed on its build stay fixed. Of the 131 items the reverts threw away (distinct within a round), the other 51 were fixed on later reverted cycles, which under the new rule do not exist: what happens there needs a real run.

## rep1o R1: the message after C1.4 under the new rule

Regressions G1, G2, G3, G6, G7, G8, G9, G10; items still failing 1; items fixed on C1.4 named in it: 0.

```
An independent review of the program against the requirements reported the following. Follow the requirements where an item seems to contradict them, and do not change behaviour the items do not concern.

1. A check that passed on the previous version of the program fails now (G1).
Requirement: "- Reads a CSV file with a header row. In typical usage this will be a previously ingested (valid) CSV file, but any headered CSV input is allowed.\n- Applies transformations defined in a JSON recipe file, in order. Each transformation is an object in an array:\n  ```json\n  [\n    {\"op\": \"filter\", \"column\": \"value\", \"condition\": \"gt\", \"threshold\": 10.0},\n    {\"op\": \"derive\", \"name\": \"score\", \"expressi…"
Command: ["transform","--input","input.csv","--recipe","recipe.json","--output","output.csv","--seed","1"]; input files: input.csv = "id,label,value,q1,q2\n1,A,10,1,2\n2,B,20,3,4\n", recipe.json = "[{\"op\":\"filter\",\"column\":\"value\",\"condition\":\"gte\",\"threshold\":10},{\"op\":\"rename\",\"from\":\"label\",\"to\":\"category\"},{\"op\":\"drop\",\"columns\":[\"q2\"]},{\"op\":\"sort\",\"column\":\"value\",\"order\":\"desc\"},{\"op\":\"fill\",\"columns\":[\"value\"],\"strategy\":\"forward\"}]".
What the program did: exit 1; exit_code: expected 0, got 1; file output.csv: expected "id,category,value,q1\n2,B,20,3\n1,A,10,1\n", got "(missing)"; stderr: "ERROR: invalid recipe: unknown operation: filter".

2. A check that passed on the previous version of the program fails now (G2).
Requirement: "- `fill`: Fill empty values in specified columns.\n    - `columns`: array of column names whose empty values should be filled.\n    - `strategy`: one of `\"forward\"`, `\"backward\"`, `\"constant\"`.\n    - `value` (required only for `\"constant\"` strategy): the replacement value string." "Behavior:\n    - `\"forward\"`: scan rows top to bottom. For each specified column, replace each empty value with the most recent non-empty value seen above it in the same column. Leading empty values (no non-empty value above) remain empty.\n    - `\"backward\"`: scan rows bottom to top. For each specified column, replace each empty value with the nearest non-empty value below it in the same column. Tr…"
Command: ["transform","--input","input.csv","--recipe","recipe.json","--output","output.csv","--seed","1"]; input files: input.csv = "id,value\n1,\n2,A\n3,\n4,B\n5,\n", recipe.json = "[{\"op\":\"fill\",\"columns\":[\"value\"],\"strategy\":\"forward\"}]".
What the program did: exit 1; exit_code: expected 0, got 1; file output.csv: expected "id,value\n1,\n2,A\n3,A\n4,B\n5,B\n", got "(missing)"; stderr: "ERROR: invalid recipe: unknown operation: fill".

3. A check that passed on the previous version of the program fails now (G3).
Requirement: "### Pipeline\n\n`dpipe pipeline --config <path>`\n\n- Reads a pipeline config (JSON):\n  ```json\n  {\n    \"seed\": 12345,\n    \"steps\": [\n      {\"type\": \"ingest\", \"input\": \"raw.csv\", \"schema\": \"schema.json\", \"output\": \"clean.csv\"},\n      {\"type\": \"transform\", \"input\": \"clean.csv\", \"recipe\": \"recipe.json\", \"output\": \"final.csv\"},\n      {\"type\": \"verify\", \"file\": \"final.csv\", \"checksum\": \"final.csv.sha256\"}…"
Command: ["pipeline","--config","config.json"]; input files: config.json = "{\"seed\":12345,\"steps\":[{\"type\":\"verify\",\"file\":\"data.csv\",\"checksum\":\"data.sha256\"}]}".
What the program did: exit 1; exit_code: expected 0, got 1; stdout: expected "PIPELINE OK: 1 steps completed\n", got ""; stderr: "ERROR: unknown command: pipeline".

4. A check that passed on the previous version of the program fails now (G6).
Requirement: "- `unpivot`: Reshape data from wide format to long format (reverse of pivot).\n    - `index`: array of column names to keep as-is (the row identifiers).\n    - `columns`: array of column names to \"melt\" into rows.\n    - `name_to`: name of the new column that will contain the original column names.\n    - `value_to`: name of the new column that will contain the values." "Behavior:\n    - For each input row, produces one output row per column listed in `columns`.\n    - Output columns: `index` columns (in declaration order), then `name_to`, then `value_to`.\n    - Output rows: for each input row (in original input order), one output row per melted column (in `columns` declaration order).\n    - Empty values are preserved (not skipped).\n    - If any referenced column (i…"
Command: ["transform","--input","input.csv","--recipe","recipe.json","--output","output.csv","--seed","1"]; input files: input.csv = "id,q1,q2\n1,10,\n2,,20\n", recipe.json = "[{\"op\":\"unpivot\",\"index\":[\"id\"],\"columns\":[\"q1\",\"q2\"],\"name_to\":\"quarter\",\"value_to\":\"amount\"}]".
What the program did: exit 1; exit_code: expected 0, got 1; file output.csv: expected "id,quarter,amount\n1,q1,10\n1,q2,\n2,q1,\n2,q2,20\n", got "(missing)"; stderr: "ERROR: invalid recipe: unknown operation: unpivot".

5. A check that passed on the previous version of the program fails now (G7).
Requirement: "- `join`: Join current dataset with another CSV file." "- `right`: path to the other CSV file" "- `on`: column name that must exist in both datasets" "(the join key)" "- `type`: `\"inner\"` or `\"left\"`" "- `left`: output all rows from the current" "(left)" "dataset;" "for rows where the join key has no match in the right dataset," "all right-side columns are filled with empty strings" "- Output columns: all columns from the left dataset," "followed by all columns from the right dataset *except* the join key column" "- If multiple rows in the right dataset share the same join key," "only the first one" "(by file order)" "is used." "- Output rows preserve the order of the left" "(current)" "dataset."
Command: ["transform","--input","left.csv","--recipe","recipe.json","--output","output.csv","--seed","1"]; input files: left.csv = "id,name\n2,b\n1,a\n3,c\n", other.csv = "id,score\n1,10\n1,11\n", recipe.json = "[{\
… (8913 characters)
```

## rep1o R2: the message after C2.3 under the new rule

Regressions G27, G33; items still failing 16; items fixed on C2.3 named in it: 0.

```
An independent review of the program against the requirements reported the following. Follow the requirements where an item seems to contradict them, and do not change behaviour the items do not concern.

1. A check that passed on the previous version of the program fails now (G27).
Requirement: "### `split`\n\nSplit a column by a delimiter into multiple new columns, replacing the original column at its position.\n\n```json\n{\"op\": \"split\", \"column\": \"full_name\", \"delimiter\": \" \", \"names\": [\"first\", \"last\"]}\n```\n\n- `column`: the source column to split.\n- `delimiter`: the string to split on.\n- `names`: array of new column names for the resulting parts.\n- The original column is removed and the ne…" "Split a column by a delimiter into multiple new columns, replacing the original column at its position." "```json\n{\"op\": \"split\", \"column\": \"full_name\", \"delimiter\": \" \", \"names\": [\"first\", \"last\"]}\n```" "- `column`: the source column to split.\n- `delimiter`: the string to split on.\n- `names`: array of new column names for the resulting parts.\n- The original column is removed and the new columns are inserted at the position where the original column was.\n- For each row, split the cell value using the delimiter:\n  - If the split produces exactly `len(names)` parts, map each part to the corresponding…"
Command: ["transform","--input","in.csv","--recipe","recipe.json","--output","out.csv","--seed","1"]; input files: in.csv = "id,full_name,city\n1,Alice Smith,Paris\n2,Bob,London\n3,Carol Ann Jones,Rome\n", recipe.json = "[{\"op\":\"split\",\"column\":\"full_name\",\"delimiter\":\" \",\"names\":[\"first\",\"last\"]}]".
What the program did: exit 0; file out.csv: expected "id,first,last,city\n1,Alice,Smith,Paris\n2,Bob,,London\n3,Carol,Ann Jones,Rome\n", got "id,first,last,city\n1,Alice,Smith,Paris\n2,Bob,,London\n3,Carol,Ann,Rome\n".

2. A check that passed on the previous version of the program fails now (G33).
Requirement: "Split a column by a delimiter into multiple new columns," "- The original column is removed and the new columns are inserted at the position where the original column was." "- If the split produces exactly `len(names)` parts," "- If fewer parts than `len(names)`: remaining columns are filled with empty strings."
Command: ["transform","--input","review_split.csv","--recipe","review_split.json","--output","review_split_out.csv","--seed","1"]; input files: review_split.csv = "id,full_name,city\n1,Alice Smith,Paris\n2,Bob,London\n3,Carol Ann Jones,Rome\n", review_split.json = "[{\"op\":\"split\",\"column\":\"full_name\",\"delimiter\":\" \",\"names\":[\"first\",\"last\"]}]\n".
What the program did: exit 0; file review_split_out.csv: expected "id,first,last,city\n1,Alice,Smith,Paris\n2,Bob,,London\n3,Carol,Ann Jones,Rome\n", got "id,first,last,city\n1,Alice,Smith,Paris\n2,Bob,,London\n3,Carol,Ann,Rome\n".

3. **Composite compare keys are unsupported.**  
   Requirement: `--key id,name` forms a composite key using both columns.  
   Command/input: `dpipe compare --left review_compare_composite_left.csv --right review_compare_composite_right.csv --key id,name --output review_composite_diff.json`  
   Program: exited with `ERROR: invalid key: column id,name not found`.

4. **Invalid `--ignore` columns are not rejected.**  
   Requirement: exit with `ERROR: invalid ignore: column <name> not found`.  
   Command/input: `dpipe compare --left review_compare_left.csv --right review_compare_right.csv --key id --output x.json --ignore does_not_exist`  
   Program: exited successfully and produced a report.

5. **`running_avg` window function is not implemented.**  
   Requirement: calculate cumulative average, yielding `NaN` when no numeric values exist.  
   Command/input: `dpipe transform --input review_transform.csv --recipe review_window.json --output review_window_out.csv --seed 1`  
   Program: output `avg` values `1,2,3,4,5`, i.e. the fallback sequential-number behavior rather than running averages.

6. **`bin` is not implemented.**  
    Requirement: support width and quantile binning.  
    Command: `dpipe transform --input review_transform.csv --recipe review_bin.json --output review_bin_out.csv --seed 1`  
    Program: exited with `ERROR: invalid recipe: unknown operation: bin`.

7. **`--help` is unsupported.**  
    Requirement: the `dpipe` CLI must provide the CLI entry point/help behavior.  
    Command: `dpipe --help`  
    Program: exited 1 with `ERROR: unknown command: --help`.

8. **Profile numeric statistics are incomplete.** Requirement: numeric columns must include `skewness`, `kurtosis`, `mode`, and `histogram`. Command: `dpipe-test.exe profile --input review-profile.csv --output review-profile2.json`, input contained numeric columns `a` and `b`. Program omitted all four fields.

9. **Profile does not infer datetimes.** Requirement: all RFC 3339 values infer type `datetime` with `earliest` and `latest`. Command: `dpipe-test.exe profile --input review-datetime.csv --output review-datetime.json`, input:
  ```
  when
  2020-01-01T00:00:00Z
  2021-01-01T00:00:00Z
  ```
  Program reported `"type": "string"` and omitted datetime statistics.

10. **Compare output format is incorrect.** Requirement: summary must include `left_rows`, `right_rows`, and `unchanged`; keys must be objects; row objects must be objects; modified entries must include `left` and `right`. Command: `dpipe-test.exe compare --left review-in.csv --right review-right.csv --key id --tolerance 0.1 --ignore note --output review-diff.json`. Program omitted the required summary fields, emitted string keys and array rows, and omitted modified `left`/`right`.

11. **Compare missing-key error is incorrect.** Requirement: `ERROR: --key is required`. Command: `dpipe-test.exe compare --left review-in.csv --right review-right.csv --output review-no-key.json`. Program reported `ERROR: invalid key: column  not found`.

12. **Deduplicate with omitted columns does not use all co
… (7786 characters)
```

## rep1o R3: the message after C3.2 under the new rule

Regressions G41; items still failing 26; items fixed on C3.2 named in it: 0.

```
An independent review of the program against the requirements reported the following. Follow the requirements where an item seems to contradict them, and do not change behaviour the items do not concern.

1. A check that passed on the previous version of the program fails now (G41).
Requirement: "## New command: `drift`\n\n`dpipe drift --baseline <path> --current <path> --output <path> [--threshold <number>]`\n\nCompares two CSV data files by computing statistical profiles internally and detecting schema and distribution drift between a baseline and a current dataset.\n\n### Parameters\n\n- `--baseline`: path to the baseline CSV data file.\n- `--current`: path to the current CSV data file.\n- `--out…" "Build a column-level statistical profile for each CSV file internally (using the same type inference rules and numeric statistics as the `profile` command: type inference, count, null_count, unique, and for numeric columns: min, max, mean, population stddev). Then compare the two profiles column by column." "- `\"column_added\"`: column exists in current but not in baseline.\n- `\"column_removed\"`: column exists in baseline but not in current.\n- `\"type_changed\"`: column exists in both profiles but the `type` field differs." "- `\"mean_shift\"`: `|current_mean - baseline_mean| / max(baseline_stddev, 1e-10) > threshold`.\n- `\"null_rate_change\"`: `|current_null_rate - baseline_null_rate| > threshold`, where `null_rate = null_count / row_count`. If `row_count` is 0, null_rate is 0.\n- `\"range_expansion\"`: `(current_max - current_min) > (baseline_max - baseline_min) * (1 + threshold)`.\n- `\"unique_ratio_change\"`: `|current_uniq…" "- `column` (string): the column name.\n- `drift_type` (string): one of the drift types listed above.\n- `baseline_value`: the relevant baseline metric value. For `\"column_added\"`, this is `null`. For `\"column_removed\"`, this is the baseline column's type as a string. For `\"type_changed\"`, this is the baseline type as a string. For distribution drifts, this is the baseline numeric value of the metric…" "1. Column name ascending (lexicographic).\n2. Within the same column, drift type in this fixed order: `\"column_added\"`, `\"column_removed\"`, `\"type_changed\"`, `\"mean_shift\"`, `\"null_rate_change\"`, `\"range_expansion\"`, `\"unique_ratio_change\"`."
Command: ["drift","--baseline","baseline.csv","--current","current.csv","--output","drift.json","--threshold","0.1"]; input files: baseline.csv = "id,age\n1,1\n2,2\n", current.csv = "id,age,city\n1,3,A\n2,4,B\n".
What the program did: exit 0; json drift.json /summary/total_drifts: expected 2, got 1; json drift.json /drifts/1/drift_type: expected "column_added", got "(missing)"; json drift.json /drifts/0/detail: expected "normalized shift = 4", got "new column of type string".

2. **Invalid `--ignore` columns are not rejected.**  
   Requirement: exit with `ERROR: invalid ignore: column <name> not found`.  
   Command/input: `dpipe compare --left review_compare_left.csv --right review_compare_right.csv --key id --output x.json --ignore does_not_exist`  
   Program: exited successfully and produced a report.

3. **`rollup` is not implemented.**  
    Requirement: emit detail, subtotal, and grand-total rows.  
    Command/input: `dpipe transform --input review_aggregate.csv --recipe review_rollup.json --output review_rollup_out.csv --seed 1`  
    Program: exited with `ERROR: invalid recipe: unknown operation: rollup`.

4. **Compare output format is incorrect.** Requirement: summary must include `left_rows`, `right_rows`, and `unchanged`; keys must be objects; row objects must be objects; modified entries must include `left` and `right`. Command: `dpipe-test.exe compare --left review-in.csv --right review-right.csv --key id --tolerance 0.1 --ignore note --output review-diff.json`. Program omitted the required summary fields, emitted string keys and array rows, and omitted modified `left`/`right`.

5. **Compare missing-key error is incorrect.** Requirement: `ERROR: --key is required`. Command: `dpipe-test.exe compare --left review-in.csv --right review-right.csv --output review-no-key.json`. Program reported `ERROR: invalid key: column  not found`.

6. **Assert error handling is incorrect.** Requirement: failing row 2 must produce `ERROR: assertion failed on row 2: bad`. Command: transform with `review-assert-recipe.json` on `review-assert.csv`. Program produced only `ERROR: `.

7. **Encode one-hot is not implemented.** Requirement: create one column per category and honor `drop`. Command: transform with `review-onehot-recipe.json` on `review-encode.csv`. Program appended an unnamed ordinal-style column.

8. **Rollup does not accept the specified recipe shape.** Requirement: use `columns` and `aggregations`. Command: transform with `review-rollup-recipe.json` on `review-rollup.csv`. Program failed with `ERROR: invalid recipe: rollup requires group_by`.

9. **Profile statistics and type inference**  
  Requirement: R2.S2, R2.S3.  
  Command/input: `dpipe profile --input profile.csv --output profile-out.json`, with numeric, string, datetime, and empty columns.  
  Program did: Classified RFC3339 `when` as `"string"`; omitted required fields such as `skewness`, `kurtosis`, `mode`, `histogram`, string length/common-value fields, and datetime `earliest`/`latest`.

10. **Compare JSON format**  
  Requirement: R2.S21–S23.  
  Command/input: `dpipe compare --left left.csv --right right.csv --key id --output compare-out.json`.  
  Program did: `key` was a null-separated string instead of an object; added/removed `row` values were arrays instead of objects; modified entries lacked `left` and `right`; summary omitted `left_rows`, `right_rows`, and `unchanged`.

11. **Compare duplicate-key handling**  
  Requirement: R2.S20.P1.7.  
  Command/input: Same compare command, where `left.csv` contains duplicate key `id=3`.  
  Program did: Used the last duplicate, classified `id=3` as modified; the requirement says to use t
… (10983 characters)
```

## rep1o R4: the message after C4.2 under the new rule

Regressions G40, G50; items still failing 26; items fixed on C4.2 named in it: 0.

```
An independent review of the program against the requirements reported the following. Follow the requirements where an item seems to contradict them, and do not change behaviour the items do not concern.

1. A check that passed on the previous version of the program fails now (G40).
Requirement: "The `normalize` transform with `\"method\": \"zscore\"` now uses **sample standard deviation** (Bessel's correction) instead of population standard deviation:" "`stddev = sqrt(sum((xi - mean)^2) / (n - 1))`" "where `n` is the number of valid numeric values. If `n < 2`, all output values are `\"0\"`. If sample stddev is 0, all output values are `\"0\"`." "Previously, population standard deviation (`n` denominator) was used. The `profile` command's `stddev` field is unaffected — it continues to use population standard deviation."
Command: ["transform","--input","data.csv","--recipe","recipe.json","--output","out.csv","--seed","1"]; input files: data.csv = "id,value\n1,0\n2,2\n3,4\n", recipe.json = "[{\"op\":\"normalize\",\"column\":\"value\",\"method\":\"zscore\",\"as\":\"norm\"}]".
What the program did: exit 0; csv_cell out.csv line 1 norm: expected "-1", got "-1.224744871391589"; csv_cell out.csv line 3 norm: expected "1", got "1.224744871391589".

2. A check that passed on the previous version of the program fails now (G50).
Requirement: "Numeric column profiles (`int` and `float`) now include two additional percentile fields:" "- `p05` (number): 5th percentile.\n- `p95` (number): 95th percentile." "Both use the same interpolation method as `p25`, `median`, and `p75`: compute `idx = p / 100 * (n - 1)`, interpolate between neighboring sorted values if the index is non-integer."
Command: ["profile","--input","data.csv","--output","profile.json"]; input files: data.csv = "id\n1\n2\n3\n4\n5\n".
What the program did: exit 0; json profile.json /columns/0/p05: expected 1.2, got "(missing)"; json profile.json /columns/0/p95: expected 4.8, got "(missing)".

3. **Assert error handling is incorrect.** Requirement: failing row 2 must produce `ERROR: assertion failed on row 2: bad`. Command: transform with `review-assert-recipe.json` on `review-assert.csv`. Program produced only `ERROR: `.

4. **Profile statistics and type inference**  
  Requirement: R2.S2, R2.S3.  
  Command/input: `dpipe profile --input profile.csv --output profile-out.json`, with numeric, string, datetime, and empty columns.  
  Program did: Classified RFC3339 `when` as `"string"`; omitted required fields such as `skewness`, `kurtosis`, `mode`, `histogram`, string length/common-value fields, and datetime `earliest`/`latest`.

5. **Assert failure reporting**  
  Requirement: R2.S10.P4.  
  Command/input: `dpipe transform --input bad.csv --recipe bad-assert.json --output bad-out.csv`, where row 2 has `value=-1`.  
  Program did: Exited with `ERROR: `, omitting the required `assertion failed on row 2: value out of expected range`.

6. Profile numeric null statistics: The requirement says `skewness` and `kurtosis` are `null` when standard deviation is zero, and `mode` is `null` when all values are unique. Command: `dpipe profile --input profile.csv --output profile-out.json` with the supplied 3-row profile input. Program exited 1 with `ERROR: json: unsupported value: NaN`.

7. Normalize z-score with fewer than two values: The requirement says all outputs must be `"0"` when `n < 2`. Command: `dpipe transform --input one.csv --recipe one-normalize.json --output one-out.csv --seed 1`. Program produced blank normalized cells.

8. **Assert error message:** The recipe’s `message` must be included. Command: `transform --input review.csv --recipe assert.json --output assert-out.csv --seed 1`, message `must be greater than two`. Program exited with `ERROR: assertion failed on row 1:`.

9. **Profile:** Numeric profiles include undocumented `p05` and `p95` fields. Command: `dpipe profile --input review-profile.csv --output review-profile.json`; each numeric column contained both fields although the required output specifies only `p25`, `median`, and `p75`.

10. **Cross-command pipeline failure output:** Requirement requires `PIPELINE FAILED at step N: <error>`. Command: `dpipe pipeline --config review-pipeline-fail.json`, with step 1 reading missing `missing.csv`. Program printed `ERROR: PIPELINE FAILED at step 1: file not found: missing.csv`, adding the forbidden `ERROR: ` prefix.

11. **Rollup grand total:** Grand-total grouping columns must contain `"*"`. Command: rollup over `region,city`. Program output `,,35` instead of `*,*,35`.

12. **Rollup ordering:** Subtotal rows must be lexicographically sorted. Program output `B,*,5` before `A,*,30`.

13. **Compare summary:** Command: `dpipe compare --left review-compare-left.csv --right review-compare-right.csv --key id --tolerance 0.1 --ignore note --output out.json`. Program reported `"unchanged": 1`; the required result reports `"unchanged": 0`.

14. **Invalid `--ignore` columns are not rejected.**  
   Requirement: exit with `ERROR: invalid ignore: column <name> not found`.  
   Command/input: `dpipe compare --left review_compare_left.csv --right review_compare_right.csv --key id --output x.json --ignore does_not_exist`  
   Program: exited successfully and produced a report.

15. **`running_avg` window function is not implemented.**  
   Requirement: calculate cumulative average, yielding `NaN` when no numeric values exist.  
   Command/input: `dpipe transform --input review_transform.csv --recipe review_window.json --output review_window_out.csv --seed 1`  
   Program: output `avg` values `1,2,3,4,5`, i.e. the fallback sequential-number behavior rather than running averages.

16. **`bin` is not implemented.**  
    Requirement: support width and quantile binning.  
    Command: `dpipe transform --input review_transform.csv --recipe review_bin.json --output review_bin_out.csv --seed 1`  
    Program: exited with `ERROR: invalid recipe: unknown operation: bin`.

17. **`--help` is unsupported.**  
  
… (9917 characters)
```

## rep1o R5: the message after C5.3 under the new rule

Regressions G85, G99; items still failing 34; items fixed on C5.3 named in it: 0.

```
An independent review of the program against the requirements reported the following. Follow the requirements where an item seems to contradict them, and do not change behaviour the items do not concern.

1. A check that passed on the previous version of the program fails now (G85).
Requirement: "- `\"column_added\"`: column exists in current but not in baseline." "**Distribution drift** (checked only for columns present in both profiles with the same numeric type — `\"int\"` or `\"float\"` — and both having `count > 0`):" "2. Within the same column," "`\"null_rate_change\"`," "`\"range_expansion\"`,"
Command: ["drift","--baseline","base.csv","--current","curr.csv","--output","drift.json"]; input files: base.csv = "id,x,cat\n1,1,A\n2,2,A\n3,3,B\n4,,B\n", curr.csv = "id,x,cat,newcol\n1,10,A,z\n2,20,A,z\n3,30,B,z\n4,40,B,z\n".
What the program did: exit 0; json drift.json /drifts/1/drift_type: expected "null_rate_change", got "mean_shift"; json drift.json /drifts/2/drift_type: expected "range_expansion", got "null_rate_change".

2. A check that passed on the previous version of the program fails now (G99).
Requirement: "- Executes each step sequentially. If any step fails, the pipeline stops and exits with code 1, printing `PIPELINE FAILED at step N: <error>` (N is 1-indexed)." "- On success, exits with code 0 and prints `PIPELINE OK: N steps completed`."
Command: ["pipeline","--config","review-pipeline-fail.json"]; input files: review-pipeline-fail.json = "{\"steps\":[{\"type\":\"profile\",\"input\":\"missing.csv\",\"output\":\"x.json\"}]}\n".
What the program did: exit 1; stderr_line line 1: expected "PIPELINE FAILED at step 1: file not found: missing.csv", got "".

3. G14

4. **Rollup schema and aggregation support**  
  Requirement: R2.S15.  
  Command/input: `dpipe transform --input review.csv --recipe roll-recipe.json --output roll-out.csv`, using `columns` and `aggregations` as specified.  
  Program did: Failed with `ERROR: invalid recipe: rollup requires group_by`; it expects the older `group_by`/single-aggregation shape and does not implement the required rollup interface.

5. **Drift summary:** `schema_drifts` and `distribution_drifts` are incorrectly reported. Command: `dpipe drift --baseline review-drift-base.csv --current review-drift-current.csv --output out.json --threshold 0.1`, with one mean shift, one added column, and one removed column. Program reported `schema_drifts: 0` and `distribution_drifts: 3`; expected `schema_drifts: 2`, `distribution_drifts: 1`.

6. **Manifest:** The manifest output does not match the required manifest result from the supplied check. Command: `dpipe manifest --dir . --output review-manifest.json`, with CSV files in the directory. Program wrote an object containing `generated_at`, hashes, row counts, and sizes instead of the expected CSV path list.

7. **Validate summary and violation ordering:** R4.S4.P6 requires `columns_checked` to count schema columns present in the CSV, and R4.S5 requires `column_missing` before `strict`.  
  Command/input: `dpipe validate --input review-data.csv --schema review-schema.json --output validate.json`  
  The program reported `columns_checked: 4` instead of `2`, and emitted `strict` violations for `id` and `name` before the `column_missing` violation for `missing`.

8. **Rollup aggregations:** R2.S15.P3/P4 requires all aggregation specifications and their functions, with the output header containing all `as` names.  
  Command/input: `dpipe transform --input review-data.csv --recipe review-recipe-rollup.json --output rollup.csv`, with `count` and `max` aggregations  
  The program output only `status,n`, omitted `mx`, and calculated `n` using numeric sums rather than the requested `count`.

9. **Drift metrics and summary:** R3.S8.P4 and R3.S9 require null-rate, range, and unique-ratio drift checks, with schema and distribution summary counts.  
  Command/input: `dpipe drift --baseline review-drift-base.csv --current review-drift-current.csv --output drift.json`  
  The program reported only a mean shift and column addition, omitted the required other distribution checks, and returned `schema_drifts: 0` and `distribution_drifts: 2` despite one schema drift.

10. **Window `ntile`** — Breaks R1.S3.P14. Command: transform with four ordered rows and `{"function":"ntile","n":2}`. Output tiles were `1,2,3,4`, not `1,1,2,2`.

11. **Rollup** — Breaks R2.S15. Command: rollup using `columns` and two aggregations. Only one aggregation was emitted; detail rows were input-ordered; grand total was `,10` instead of `*,10`.

12. **Profile extra fields** — Breaks R2.S3. Command: `profile --input review-profile.csv --output review-profile.json`. Numeric columns contained undocumented `p05` and `p95` fields.

13. **Validate violation ordering places strict violations before missing columns.** Requirement: present CSV columns first, then `column_missing`, then `strict`. Command/input: `dpipe validate --input review_validate.csv --schema review_validate_schema.json --output validate_out.json`. Program order was `b`, `a`, `extra` (`strict`), `missing1` (`column_missing`), `missing2` (`column_missing`).

14. **Invalid `--ignore` columns are not rejected.**  
   Requirement: exit with `ERROR: invalid ignore: column <name> not found`.  
   Command/input: `dpipe compare --left review_compare_left.csv --right review_compare_right.csv --key id --output x.json --ignore does_not_exist`  
   Program: exited successfully and produced a report.

15. **`running_avg` window function is not implemented.**  
   Requirement: calculate cumulative average, yielding `NaN` when no numeric values exist.  
   Command/input: `dpipe transform --input review_transform.csv --recipe review_window.json --output review_window_out.csv --seed 1`  
   Program: output `avg` values `1,2,3,4,5`, i.e. the fallback sequential-number behavior rather than running averages.

16. **`bin` is not implemented.**  
    Requirement: support width and quantile binning.  
    Co
… (11333 characters)
```

## rep1o R6: the message after C6.2 under the new rule

Regressions G130; items still failing 31; items fixed on C6.2 named in it: 0.

```
An independent review of the program against the requirements reported the following. Follow the requirements where an item seems to contradict them, and do not change behaviour the items do not concern.

1. A check that passed on the previous version of the program fails now (G130).
Requirement: "7. If the left file has duplicate keys," "only the first occurrence is used. Same for the right file."
Command: ["compare","--left","review-left.csv","--right","review-right-dup.csv","--key","id","--output","out-compare-dup.json"]; input files: review-left.csv = "id,name,value,note\n1,A,10,x\n2,B,20,y\n3,C,30,z\n", review-right-dup.csv = "id,name,value,note\n1,A,10,x\n1,A,99,x\n2,B,20,y\n3,C,30,z\n".
What the program did: exit 0; json out-compare-dup.json /summary/right_rows: expected 3, got 4.

2. **Drift distribution and summary detection:** For `dpipe-test.exe drift --baseline base.csv --current curr.csv --output drift.json`, the required `null_rate_change` and `range_expansion` drifts for `x` were absent. The summary reported `schema_drifts: 0` and `distribution_drifts: 2`, although the added column is a schema drift and three distribution drifts should be reported.

3. **Pipeline verify loses the underlying file error.** Requirement: pipeline reports the failing step and its error. Command: `dpipe pipeline --config review-pipeline-verify-missing.json`, referencing missing `missing.csv`. Program reported `PIPELINE FAILED at step 1: verification mismatch` instead of the file-not-found error.

4. G3

5. **Invalid `--ignore` columns are not rejected.**  
   Requirement: exit with `ERROR: invalid ignore: column <name> not found`.  
   Command/input: `dpipe compare --left review_compare_left.csv --right review_compare_right.csv --key id --output x.json --ignore does_not_exist`  
   Program: exited successfully and produced a report.

6. **`running_avg` window function is not implemented.**  
   Requirement: calculate cumulative average, yielding `NaN` when no numeric values exist.  
   Command/input: `dpipe transform --input review_transform.csv --recipe review_window.json --output review_window_out.csv --seed 1`  
   Program: output `avg` values `1,2,3,4,5`, i.e. the fallback sequential-number behavior rather than running averages.

7. **`bin` is not implemented.**  
    Requirement: support width and quantile binning.  
    Command: `dpipe transform --input review_transform.csv --recipe review_bin.json --output review_bin_out.csv --seed 1`  
    Program: exited with `ERROR: invalid recipe: unknown operation: bin`.

8. **Compare output format is incorrect.** Requirement: summary must include `left_rows`, `right_rows`, and `unchanged`; keys must be objects; row objects must be objects; modified entries must include `left` and `right`. Command: `dpipe-test.exe compare --left review-in.csv --right review-right.csv --key id --tolerance 0.1 --ignore note --output review-diff.json`. Program omitted the required summary fields, emitted string keys and array rows, and omitted modified `left`/`right`.

9. **Compare missing-key error is incorrect.** Requirement: `ERROR: --key is required`. Command: `dpipe-test.exe compare --left review-in.csv --right review-right.csv --output review-no-key.json`. Program reported `ERROR: invalid key: column  not found`.

10. **Assert error handling is incorrect.** Requirement: failing row 2 must produce `ERROR: assertion failed on row 2: bad`. Command: transform with `review-assert-recipe.json` on `review-assert.csv`. Program produced only `ERROR: `.

11. **Compare required-flag errors**  
  Requirement: R2.S24.  
  Command/input: `dpipe compare --left left.csv --right right.csv --output x.json`.  
  Program did: `ERROR: invalid key: column  not found` instead of `ERROR: --key is required`.

12. **Compare missing output error**  
  Requirement: R2.S24.  
  Command/input: `dpipe compare --left left.csv --right right.csv --key id`.  
  Program did: `ERROR: open : The system cannot find the file specified.` instead of `ERROR: --output is required`.

13. **Compare invalid ignore error**  
  Requirement: R2.S25.P6.  
  Command/input: `dpipe compare --left left.csv --right right.csv --key id --output x.json --ignore nope`.  
  Program did: `ERROR: invalid ignore column: nope` instead of `ERROR: invalid ignore: column nope not found`.

14. **Deduplicate `keep` and default columns**  
  Requirement: R2.S8.P3.  
  Commands/inputs:  
  `dpipe transform --input dup.csv --recipe dup-recipe.json --output dup-out.csv`, with `keep:"last"`; and `dedup-all.json` omitting `columns`.  
  Program did: Kept the first duplicate despite `keep:"last"`; when `columns` was omitted, treated every row as the same key and retained only the first row instead of using all columns.

15. **Assert failure reporting**  
  Requirement: R2.S10.P4.  
  Command/input: `dpipe transform --input bad.csv --recipe bad-assert.json --output bad-out.csv`, where row 2 has `value=-1`.  
  Program did: Exited with `ERROR: `, omitting the required `assertion failed on row 2: value out of expected range`.

16. **Rollup schema and aggregation support**  
  Requirement: R2.S15.  
  Command/input: `dpipe transform --input review.csv --recipe roll-recipe.json --output roll-out.csv`, using `columns` and `aggregations` as specified.  
  Program did: Failed with `ERROR: invalid recipe: rollup requires group_by`; it expects the older `group_by`/single-aggregation shape and does not implement the required rollup interface.

17. Normalize z-score with fewer than two values: The requirement says all outputs must be `"0"` when `n < 2`. Command: `dpipe transform --input one.csv --recipe one-normalize.json --output one-out.csv --seed 1`. Program produced blank normalized cells.

18. **Assert error message:** The recipe’s `message` must be included. Command: `transform --input review.csv --recipe assert.json --output assert-out.csv --seed 1`, message `must be greater than two`. Program exited with `ERROR: assertion failed on row 1:`.

1
… (9594 characters)
```

