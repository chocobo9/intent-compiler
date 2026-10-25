# rep1o's regressions as repair items (batch 5 B)

| cycle | guard | id | requirement | command and input | output vs expected |
|---|---|---|---|---|---|
| C1.4 | G1 | yes | yes | yes | yes |
| C1.4 | G2 | yes | yes | yes | yes |
| C1.4 | G3 | yes | yes | yes | yes |
| C1.4 | G6 | yes | yes | yes | yes |
| C1.4 | G7 | yes | yes | yes | yes |
| C1.4 | G8 | yes | yes | yes | yes |
| C1.4 | G9 | yes | yes | yes | yes |
| C1.4 | G10 | yes | yes | yes | yes |
| C2.3 | G27 | yes | yes | yes | yes |
| C2.3 | G33 | yes | yes | yes | yes |
| C2.4 | G27 | yes | yes | yes | yes |
| C2.4 | G33 | yes | yes | yes | yes |
| C2.4 | G36 | yes | yes | yes | yes |
| C3.2 | G41 | yes | yes | yes | yes |
| C3.3 | G41 | yes | yes | yes | yes |
| C3.4 | G41 | yes | yes | yes | yes |
| C4.2 | G40 | yes | yes | yes | yes |
| C4.2 | G50 | yes | yes | yes | yes |
| C4.3 | G40 | yes | yes | yes | yes |
| C4.3 | G50 | yes | yes | yes | yes |
| C4.4 | G40 | yes | yes | yes | yes |
| C5.3 | G85 | yes | yes | yes | yes |
| C5.3 | G99 | yes | yes | yes | yes |
| C5.4 | G85 | yes | yes | yes | yes |
| C5.4 | G99 | yes | yes | yes | yes |
| C6.2 | G130 | yes | yes | yes | yes |
| C6.3 | G105 | yes | yes | yes | yes |
| C6.3 | G120 | yes | yes | yes | yes |
| C6.3 | G121 | yes | yes | yes | yes |
| C6.3 | G130 | yes | yes | yes | yes |
| C6.4 | G105 | yes | yes | yes | yes |
| C6.4 | G109 | yes | yes | yes | yes |
| C6.4 | G119 | yes | yes | yes | yes |
| C6.4 | G120 | yes | yes | yes | yes |
| C6.4 | G121 | yes | yes | yes | yes |
| C6.4 | G130 | yes | yes | yes | yes |

Regressions rendered: 36; with all four parts: 36.

Three of them as the executor would read them:

## C2.3 G27

```
A check that passed on the previous version of the program fails now (G27).
Requirement: "### `split`\n\nSplit a column by a delimiter into multiple new columns, replacing the original column at its position.\n\n```json\n{\"op\": \"split\", \"column\": \"full_name\", \"delimiter\": \" \", \"names\": [\"first\", \"last\"]}\n```\n\n- `column`: the source column to split.\n- `delimiter`: the string to split on.\n- `names`: array of new column names for the resulting parts.\n- The original column is removed and the ne…" "Split a column by a delimiter into multiple new columns, replacing the original column at its position." "```json\n{\"op\": \"split\", \"column\": \"full_name\", \"delimiter\": \" \", \"names\": [\"first\", \"last\"]}\n```" "- `column`: the source column to split.\n- `delimiter`: the string to split on.\n- `names`: array of new column names for the resulting parts.\n- The original column is removed and the new columns are inserted at the position where the original column was.\n- For each row, split the cell value using the delimiter:\n  - If the split produces exactly `len(names)` parts, map each part to the corresponding…"
Command: ["transform","--input","in.csv","--recipe","recipe.json","--output","out.csv","--seed","1"]; input files: in.csv = "id,full_name,city\n1,Alice Smith,Paris\n2,Bob,London\n3,Carol Ann Jones,Rome\n", recipe.json = "[{\"op\":\"split\",\"column\":\"full_name\",\"delimiter\":\" \",\"names\":[\"first\",\"last\"]}]".
What the program did: exit 0; file out.csv: expected "id,first,last,city\n1,Alice,Smith,Paris\n2,Bob,,London\n3,Carol,Ann Jones,Rome\n", got "id,first,last,city\n1,Alice,Smith,Paris\n2,Bob,,London\n3,Carol,Ann,Rome\n".
```

## C3.2 G41

```
A check that passed on the previous version of the program fails now (G41).
Requirement: "## New command: `drift`\n\n`dpipe drift --baseline <path> --current <path> --output <path> [--threshold <number>]`\n\nCompares two CSV data files by computing statistical profiles internally and detecting schema and distribution drift between a baseline and a current dataset.\n\n### Parameters\n\n- `--baseline`: path to the baseline CSV data file.\n- `--current`: path to the current CSV data file.\n- `--out…" "Build a column-level statistical profile for each CSV file internally (using the same type inference rules and numeric statistics as the `profile` command: type inference, count, null_count, unique, and for numeric columns: min, max, mean, population stddev). Then compare the two profiles column by column." "- `\"column_added\"`: column exists in current but not in baseline.\n- `\"column_removed\"`: column exists in baseline but not in current.\n- `\"type_changed\"`: column exists in both profiles but the `type` field differs." "- `\"mean_shift\"`: `|current_mean - baseline_mean| / max(baseline_stddev, 1e-10) > threshold`.\n- `\"null_rate_change\"`: `|current_null_rate - baseline_null_rate| > threshold`, where `null_rate = null_count / row_count`. If `row_count` is 0, null_rate is 0.\n- `\"range_expansion\"`: `(current_max - current_min) > (baseline_max - baseline_min) * (1 + threshold)`.\n- `\"unique_ratio_change\"`: `|current_uniq…" "- `column` (string): the column name.\n- `drift_type` (string): one of the drift types listed above.\n- `baseline_value`: the relevant baseline metric value. For `\"column_added\"`, this is `null`. For `\"column_removed\"`, this is the baseline column's type as a string. For `\"type_changed\"`, this is the baseline type as a string. For distribution drifts, this is the baseline numeric value of the metric…" "1. Column name ascending (lexicographic).\n2. Within the same column, drift type in this fixed order: `\"column_added\"`, `\"column_removed\"`, `\"type_changed\"`, `\"mean_shift\"`, `\"null_rate_change\"`, `\"range_expansion\"`, `\"unique_ratio_change\"`."
Command: ["drift","--baseline","baseline.csv","--current","current.csv","--output","drift.json","--threshold","0.1"]; input files: baseline.csv = "id,age\n1,1\n2,2\n", current.csv = "id,age,city\n1,3,A\n2,4,B\n".
What the program did: exit 0; json drift.json /summary/total_drifts: expected 2, got 1; json drift.json /drifts/1/drift_type: expected "column_added", got "(missing)"; json drift.json /drifts/0/detail: expected "normalized shift = 4", got "new column of type string".
```

## C4.2 G40

```
A check that passed on the previous version of the program fails now (G40).
Requirement: "The `normalize` transform with `\"method\": \"zscore\"` now uses **sample standard deviation** (Bessel's correction) instead of population standard deviation:" "`stddev = sqrt(sum((xi - mean)^2) / (n - 1))`" "where `n` is the number of valid numeric values. If `n < 2`, all output values are `\"0\"`. If sample stddev is 0, all output values are `\"0\"`." "Previously, population standard deviation (`n` denominator) was used. The `profile` command's `stddev` field is unaffected — it continues to use population standard deviation."
Command: ["transform","--input","data.csv","--recipe","recipe.json","--output","out.csv","--seed","1"]; input files: data.csv = "id,value\n1,0\n2,2\n3,4\n", recipe.json = "[{\"op\":\"normalize\",\"column\":\"value\",\"method\":\"zscore\",\"as\":\"norm\"}]".
What the program did: exit 0; csv_cell out.csv line 1 norm: expected "-1", got "-1.224744871391589"; csv_cell out.csv line 3 norm: expected "1", got "1.224744871391589".
```

