# The same-as cue (batch 5 C)

## Four tasks: counts by kind (as in batch 4) and the same-as hits

- theme_d5_w9_data_engineering_reproducibility_verification: changes_to 0, cross_list 2, prev_new 15, scope_unchanged 1, author_id 0, cmd_in_revision 18, same_as 12
- theme_d10_w4_ml_ai_mlops_migration_upgrade: changes_to 0, cross_list 0, prev_new 12, scope_unchanged 12, author_id 0, cmd_in_revision 9, same_as 0
- theme_d12_w1_automation_productivity_greenfield_implementation: changes_to 0, cross_list 0, prev_new 13, scope_unchanged 6, author_id 121, cmd_in_revision 19, same_as 4
- theme_d8_w5_cloud_devops_integration_e2e_wiring: changes_to 5, cross_list 4, prev_new 10, scope_unchanged 0, author_id 0, cmd_in_revision 4, same_as 0

Same-as hits: 16.

| task | round | sentence | names | the sentence |
|---|---|---|---|---|
| d5_w9 | 1 | R1.S3.P11.s4 | filter | The `having` object uses the same condition operators as `filter` (`gt`, `gte`, `lt`, `lte`, `eq`, `neq`). |
| d5_w9 | 1 | R1.S3.P14.s6 | lag | - `lead`: Like `lag` but looks forward (rows ahead in partition order). Same additional fields as `lag`. |
| d5_w9 | 2 | R2.S3.P5.s3 | min | - `max`: maximum value. Same formatting as `min`. |
| d5_w9 | 2 | R2.S10.P3.s1 | derive | - `expression`: a boolean expression using the same syntax as the `derive` operation's expression evaluator (same operators, functions, and column references). |
| d5_w9 | 2 | R2.S15.P3.s2 | aggregate | - `aggregations`: array of aggregation specs, each with `column`, `function`, and `as`. Supported functions: `sum`, `avg`, `count`, `min`, `max` (same semantics as the `aggregate` transform — non-numeric values skipped for `sum`/`avg`/`min`/`max`; `count` counts non-empty values; `avg` with zero num |
| d5_w9 | 2 | R2.S16.P7.s1 | profile | - **`iqr`**: Compute Q1, Q3 using the same percentile method as the `profile` command. IQR = Q3 - Q1. A value is an outlier if `value < Q1 - factor * IQR` or `value > Q3 + factor * IQR`. If fewer than 2 numeric values exist, all get `"0"`. |
| d5_w9 | 2 | R2.S17.P8.s2 | profile | 1. Compute bin boundaries using percentiles: boundary `j` = percentile at `(j * 100 / bins)` for j = 0 to bins, using the same percentile interpolation method as the `profile` command. |
| d5_w9 | 2 | R2.S17.P8.s4 | width | 3. Labels: same format as `width`, using `boundary[i]` as `low` and `boundary[i+1]` as `high`. The last bin's `high` is `max`. |
| d5_w9 | 2 | R2.S17.P8.s6 | width | 5. Same float formatting as `width`. |
| d5_w9 | 3 | R3.S5.P3.s1 | p25 | Both use the same interpolation method as `p25`, `median`, and `p75`: compute `idx = p / 100 * (n - 1)`, interpolate between neighboring sorted values if the index is non-integer. |
| d5_w9 | 3 | R3.S8.P1.s1 | profile | Build a column-level statistical profile for each CSV file internally (using the same type inference rules and numeric statistics as the `profile` command: type inference, count, null_count, unique, and for numeric columns: min, max, mean, population stddev). |
| d5_w9 | 5 | R5.S3.P1.s1 | pipeline | - `--config`: path to a pipeline JSON configuration file (same format as the `pipeline` command). |
| d12_w1 | 2 | R2.S12.P4.s3 | cmd | * Each element is subject to the same `${VAR}` interpolation rules as `cmd`, individually. |
| d12_w1 | 4 | R4.S9.P6.s1 | inspect.steps | * `steps` is in the same order as `inspect.steps`: base step positions, cells in lex order within each base. Every expanded matrix cell has exactly one entry. `foreach:` steps that have not yet been resolved (no prior run dir seeding them) appear as a single entry under their base name with `cmd` le |
| d12_w1 | 7 | R7.S13.P3.s2 | skipped | `error` remains absent on `filter_skipped` entries (same rule as `skipped` / `cancelled` / `conditionally_skipped`). |
| d12_w1 | 7 | R7.S27.P4.s4 | budget_exceeded | 4. `retries_used` is the integer count of retry attempts (attempts with `attempt >= 2`) across every step in the run that actually launched. If the retry budget fires, `retries_used` reports the same clamped visibility value as the `budget_exceeded` event: `retries_limit + 1`. The pre-empted retry i |

## rep1o (dpipe), with its attribution

- R1 R1.S3.P11.s4 (filter): no unit (the name is no command of the attribution other than the sentence's own) — "The `having` object uses the same condition operators as `filter` (`gt`, `gte`, `lt`, `lte`, `eq`, `neq`)."
- R1 R1.S3.P14.s6 (lag): no unit (the name is no command of the attribution other than the sentence's own) — "- `lead`: Like `lag` but looks forward (rows ahead in partition order). Same additional fields as `lag`."
- R2 R2.S3.P5.s3 (min): no unit (the name is no command of the attribution other than the sentence's own) — "- `max`: maximum value. Same formatting as `min`."
- R2 R2.S10.P3.s1 (derive): no unit (the name is no command of the attribution other than the sentence's own) — "- `expression`: a boolean expression using the same syntax as the `derive` operation's expression evaluator (same operators, functions, and column references)."
- R2 R2.S15.P3.s2 (aggregate): unit U2.c2 over O23 rollup transformation + O6 aggregate transformation — "- `aggregations`: array of aggregation specs, each with `column`, `function`, and `as`. Supported functions: `sum`, `avg`, `count`, `min`, `max` (same semantics as the `aggregate` transform — non-nume"
- R2 R2.S16.P7.s1 (profile): unit U2.c3 over O24 detect transformation + O17 profile command — "- **`iqr`**: Compute Q1, Q3 using the same percentile method as the `profile` command. IQR = Q3 - Q1. A value is an outlier if `value < Q1 - factor * IQR` or `value > Q3 + factor * IQR`. If fewer than"
- R2 R2.S17.P8.s2 (profile): unit U2.c4 over O25 bin transformation + O17 profile command — "1. Compute bin boundaries using percentiles: boundary `j` = percentile at `(j * 100 / bins)` for j = 0 to bins, using the same percentile interpolation method as the `profile` command."
- R2 R2.S17.P8.s4 (width): no unit (the name is no command of the attribution other than the sentence's own) — "3. Labels: same format as `width`, using `boundary[i]` as `low` and `boundary[i+1]` as `high`. The last bin's `high` is `max`."
- R2 R2.S17.P8.s6 (width): no unit (the name is no command of the attribution other than the sentence's own) — "5. Same float formatting as `width`."
- R3 R3.S5.P3.s1 (p25): no unit (the name is no command of the attribution other than the sentence's own) — "Both use the same interpolation method as `p25`, `median`, and `p75`: compute `idx = p / 100 * (n - 1)`, interpolate between neighboring sorted values if the index is non-integer."
- R3 R3.S8.P1.s1 (profile): unit U3.c2 over O28 drift command + O17 profile command — "Build a column-level statistical profile for each CSV file internally (using the same type inference rules and numeric statistics as the `profile` command: type inference, count, null_count, unique, a"
- R5 R5.S3.P1.s1 (pipeline): unit U5.c2 over O34 lineage command + O14 pipeline command — "- `--config`: path to a pipeline JSON configuration file (same format as the `pipeline` command)."

R3 package, units across commands: U3.c1 Behavior Corrections: O11+O21, delivered 2/2; U3.c2 same as profile: O28+O17, delivered 2/2.
R3 review lists, changes across commands: U3.c1 Behavior Corrections: fill transformation, normalize transformation; U3.c2 same as profile: drift command, profile command.
