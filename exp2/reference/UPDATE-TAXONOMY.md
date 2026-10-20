# dpipe R1–R15 更新行为分类

> **本文件是设计与审阅用的分析材料，不是任何一轮生成模型的输入，不得加入 input-allowlist。** 文中含 R1–R15 全部轮次的原文引文和跨轮判断，给早期轮次会泄露未来输入。

- 日期：2026-10-04。
- 依据：只读 `EvoCodeBench/data/evocodebench_wotraj/theme_d5_w9_data_engineering_reproducibility_verification/steps/round-N/instruction.md`（N=1..15），按轮次顺序。R3–R15 与本目录 `sources/round-NN.txt` 逐字节相同；R1、R2 与 `history/round-0N-received.txt` 内容相同。没有读测试、solution 或运行记录。
- 用途：把多轮输入中的更新行为整理成有定义、有实例、有数量的类别，供判断管理层在每类更新下应得到什么样的当前要求。本文只做归类和判别，不评价现有系统产物，也不规定实现。

## 判断原则

1. 每轮输入都按原文为准。后一轮针对某件事的明确陈述，以及更具体的明确陈述，就是这件事的当前要求。R2→R3 把 zscore 的分母从 n 改为 n−1 是这条原则的典型例子。
2. 新文对旧状态的描述与旧原文不符时，记 **T1** 观察标签。T1 不附处理规则。
3. 原文本身没有规定、无法据原文确定的事项，列为**规格未定**（U4–U8），不计入更新类别。
4. 原文中存在、但不替原文裁决的张力，列入**疑难项**。

字段说明：a（位置与引文）、d（受影响原文）、g（残留提及）记录原文观察；b（类型）、h（冲突判断）、i（原生读法）是判断。i 指读完截至本轮的原文后，这一处的当前有效要求，用于审阅对照，不是系统规则。

---

## 1. R1 结构（定位用，不标注更新）

| 位置 | 内容 |
|---|---|
| 开头 | 用 Go 写 `dpipe`；每一步对相同输入产生逐位相同的输出 |
| Ingestion | 命令行；schema 结构（`columns` 是数组、`primary_key`）；列约束 unique/min/max/pattern 及各自的拒绝原因；校验顺序；`<output>.rejected`；按主键排序；`<output>.sha256` sidecar |
| Transformation | 命令行；recipe 示例（12 个 op）；各 op 的规则：filter、derive（运算符优先级、函数、输出格式）、sample、sort、rename、drop、aggregate（含 having）、join、window（7 个函数）、pivot、unpivot、fill（strategy 写作 "one of forward/backward/constant"）；结尾句 "write the result CSV to `<output>`, its SHA-256 to `<output>.sha256`" |
| Verification | 计算 SHA-256 后比较；输出 `VERIFIED` 或 `MISMATCH expected=… actual=…` |
| Manifest | 递归扫描 .csv；计算 SHA-256；示例条目 `{"path","sha256","rows","size_bytes"}`；按 path 排序；`generated_at` |
| Pipeline | 配置示例含 ingest、transform、verify、manifest 四种步骤，其中 verify 的 checksum 写作 `final.csv.sha256`；按顺序执行；失败和成功各有一条输出格式 |
| Determinism contract | 适用于所有命令；"The only exception is `generated_at`" |
| Error handling | 5 条共享规则：文件缺失；ingest 校验失败不退出；无效 recipe；"Malformed JSON config/schema/recipe → `ERROR: malformed JSON`"；无效正则 |
| 结尾 | `go build -o dpipe ./...` |

---

## 2. 类别定义

| 代码 | 类别 | 判别标准 |
|---|---|---|
| A | 新增独立对象 | 新文定义一个之前没有的对象（命令、操作、步骤等），自带完整规格；先前原文中没有一句因此变假 |
| B1 | 给已有集合加成员 | 旧对象是一组可选种类（取值集合、步骤类型、映射表），新文往里加一个成员并给出规格。旧句仍然为真；旧句如果写成封闭列表，就不再完整 |
| B2 | 给已有对象加字段、选项或行为 | 旧对象自身的输出、参数或副作用增加，原有部分不变 |
| C | 改值或算法，接口不变 | 同一对象在所有输入下的某个取值、公式或算法被替换；命令行、键名、输出结构不变。变化不按输入情形区分 |
| D | 分情形修正 | 只改某些输入情形下的结果；同一规则的其他情形和同一句的其他部分照旧 |
| E | 删除输出或功能 | 原文明说某个行为或产物不再存在（removed、no longer） |
| F | 改名或改接口 | 接口中的名称（键、参数）被替换，或一个字段拆成多个；表达的内容不变 |
| G | 补未定义情形或默认值 | 先前原文没有规定的情形，由新文首次规定 |
| H | 例外与限定 | 让某条共享规则或某条新规则在特定对象上不适用，或改由别的规则替代。分明说的限定和隐含的例外（新对象的专属规则与旧共享规则直接冲突，但没有声明是例外） |

**作废粒度分三级：** 小节或条目 / 句子或列表项 / 句中片段。"不作废"表示没有任何先前原文变假。

---

## 3. 逐轮表（R2–R15）

列定义：ID｜a 位置 · 引文｜b 类型｜c 作用对象｜d 受影响原文 · 粒度｜e 是否重述 / f 作废方式｜g 残留提及｜h 冲突｜i 原生读法。

### R2（"Add the following capabilities to `dpipe`."）

| ID | a | b | c | d | e / f | g | h | i |
|---|---|---|---|---|---|---|---|---|
| 2.1 | New command: `profile` · "`dpipe profile --input <path> --output <path>`" | A | 命令、JSON 输出、统计算法 | 不作废 | — | 同轮 JSON 示例只列基础字段，没有同轮后文的 skewness/kurtosis/mode/histogram | 无 | 按本节原文；同轮示例不是完整字段表 |
| 2.2 | New transforms / `deduplicate` · "Remove duplicate rows based on a set of key columns." | A | 新 op | 不作废 | — | — | 无 | 按本节原文 |
| 2.3 | `split` · "Split a column by a delimiter into multiple new columns" | A | 新 op | 不作废 | — | — | 无 | 按本节原文 |
| 2.4 | `assert` · "`ERROR: assertion failed on row N: <message>`" | A | 新 op、错误信息 | 不作废 | — | — | 无 | 按本节原文 |
| 2.5 | `normalize` · "Normalize a numeric column using z-score or min-max scaling" | A | 新 op（R3、R12 再更新） | 不作废 | — | — | 无 | 按本节原文 |
| 2.6 | Extended transforms / Fill `linear` · "The existing `fill` transform now supports an additional strategy" | B1 | fill 的 strategy 取值集合 | 不作废；R1 "`strategy`: one of `\"forward\"`, `\"backward\"`, `\"constant\"`" 是封闭列表 | 旧三项未重述 / 明说追加 | R1 的 "one of" 句 | 无 | strategy 取值为 R1 三项加 linear，旧三项不变 |
| 2.7 | `encode`（标题为 Extended transforms，内容是新 op）· "Encode categorical column values into numeric representations." | A | 新 op | 不作废 | — | — | 无 | 按本节原文 |
| 2.8 | `rollup` · "same semantics as the `aggregate` transform" | A | 新 op，引用 aggregate 的语义 | 不作废 | 简述了 aggregate 的函数语义 | — | 无 | 按本节原文 |
| 2.9 | `detect` · "same percentile method as the `profile` command" | A | 新 op | 不作废 | — | — | 无 | zscore 方法引用 profile 的总体 mean/stddev |
| 2.10 | `bin` · "Assign numeric column values to bins" | A | 新 op | 不作废 | — | — | 无 | 按本节原文 |
| 2.11 | Pipeline extension · "now supports the `\"profile\"` step type" | B1 | pipeline 步骤类型 | 不作废；R1 pipeline 只有示例，不是封闭列表 | — / 明说 | — | 无 | pipeline 接受 profile 步骤 |
| 2.12 | New command: `compare`（含同轮 Extended compare flags）· "`dpipe compare --left <path> --right <path> --key <col1,col2,...> --output <path>`" | A | 命令、选项、错误信息 | 不作废 | — | — | 无 | 按本节原文 |
| 2.13 | New transforms (continued) / `hash` · "Compute a SHA-256 hash of specified columns for each row" | A | 新 op | 不作废 | — | — | 无 | 按本节原文 |
| 2.14 | Pipeline extension (continued) · "additionally supports the `\"compare\"` step type" | B1 | pipeline 步骤类型 | 不作废 | — / 明说 | — | 无 | pipeline 接受 compare 步骤 |

### R3（"…and apply the specified behavior corrections."）

| ID | a | b | c | d | e / f | g | h | i |
|---|---|---|---|---|---|---|---|---|
| 3.1 | Behavior Corrections / Fill linear · "Previously, cells with only one anchor remained empty. This is now corrected" | D | fill linear 缺锚点时的结果 | **句中片段**：R2 第 4 条 "If either anchor is missing …, the cell remains empty." 中"只缺一侧"的子情形（语义子集，不是连续文字） | 四种情形完整重述 / 明说 | R2 第 1、2、5 条（锚点搜索、跳过非数值）；R2 "interpolated values are formatted using …" 没有提外推值 | 无（外推值格式见 U5） | 单侧锚点时用该锚点的值常数外推，双锚点插值，两侧都缺时留空；锚点搜索规则沿用 R2 |
| 3.2 | Normalize zscore · "now uses **sample standard deviation** (Bessel's correction) instead of population" | C | zscore 的 stddev 公式；新增 n<2 情形 | **句中片段**：R2 "For `zscore`: compute `mean` and population `stddev` (…/ n)" 中的 population stddev 定义 | 部分重述 / 明说（instead of、Previously），并明说 profile 的 stddev 不受影响 | R2 detect 的 zscore 写 "same formulas as profile's … stddev" | 无（n<2 时的输出范围见 U4） | zscore 用 n−1 分母；n<2 或 stddev 为 0 时输出 "0"；minmax 不变；profile、detect、drift 使用的总体 stddev 不变 |
| 3.3 | Extended profile output · "now include two additional percentile fields" | B2 | profile 数值列字段 | 不作废 | 重述插值法 / 明说 | R2 profile 的 JSON 示例；R2 "Percentile calculation (for `median`, `p25`, `p75`)" | 无 | int/float 列在原有字段外增加 p05、p95 |
| 3.4 | New command: `drift` · "`dpipe drift --baseline <path> --current <path> --output <path> [--threshold <number>]`" | A | 命令 | 不作废 | — | — | 无 | 按本节原文；内部 profile 用总体 stddev |
| 3.5 | New transforms / `resample` · "Stratified resampling to balance class distribution." | A | 新 op | 不作废 | — | — | 无 | 按本节原文 |
| 3.6 | `watermark` · "Compute an HMAC-SHA256 watermark for each row" | A | 新 op | 不作废 | — | — | 无 | 按本节原文 |
| 3.7 | Pipeline extension · "now supports the `\"drift\"` step type" | B1 | pipeline 步骤类型 | 不作废 | — / 明说 | — | 无 | 按本节原文，含 threshold 缺省规则 |

### R4（"Add the following capabilities to `dpipe`."）

| ID | a | b | c | d | e / f | g | h | i |
|---|---|---|---|---|---|---|---|---|
| 4.1 | New command: `validate` · "Validates a CSV data file against a JSON schema definition" | A | 命令；另一种 schema 格式（`columns` 是对象） | 不作废 | — | 与 R1 ingest 的 schema 同名但结构不同，是不同对象 | 无 | validate 用本节的 schema 格式；ingest 的 schema 不变 |
| 4.2 | validate / Errors · "Invalid JSON schema: exit 1, `ERROR: invalid schema: <path>`." | H（隐含） | 错误信息 | 不作废；R1 "Malformed JSON config/schema/recipe" 的作用范围收窄 | — / 隐含 | R1 共享错误规则 | 有：validate 的 schema 也落在 R1 规则的字面范围内；本轮针对 validate 的明确陈述为当前要求 | validate 用本节的错误信息；其他命令仍按 R1 |
| 4.3 | New transform: `crossjoin` · "Cartesian product with another CSV file." | A | 新 op | 不作废 | — | — | 无 | 按本节原文 |
| 4.4 | New transform: `checkpoint` · "Appends a content fingerprint column." | A | 新 op | 不作废 | — | — | 无 | 按本节原文 |
| 4.5 | Pipeline extension · "New step type `\"validate\"`" | B1 | pipeline 步骤类型 | 不作废 | — / 明说 | — | 无 | pipeline 接受 validate 步骤 |

### R5（"…and apply the specified behavior change."）

| ID | a | b | c | d | e / f | g | h | i |
|---|---|---|---|---|---|---|---|---|
| 5.1 | Behavior Change · "It now uses **BLAKE2b-256** instead." | C | verify 的摘要算法 | **句中片段**：R1 "Reads `<path>`, computes SHA-256, compares against the hex string in `<checksum>`." 中的 "SHA-256" | 部分重述 / 明说（previously、instead） | R1 pipeline 示例 `"checksum": "final.csv.sha256"` | 无 | verify 改用 BLAKE2b-256；读取、比较方式和 R1 的输出与退出码不变 |
| 5.2 | 同节 · "The `manifest` command must also produce BLAKE2b-256 checksums (not SHA256)." | C | manifest 的摘要值 | **句中片段**：R1 "For each file, computes its SHA-256." 中的 "SHA-256" | 部分重述 / 明说 | R1 manifest 示例的键 `"sha256"`（R5 未提改名） | 无 | 摘要值改为 BLAKE2b-256；R5–R9 期间关于键名最新的明确陈述仍是 R1 示例；manifest 其他规则不变 |
| 5.3 | 同节 · "The `.sha256` sidecar files produced during `ingest` and `transform` are **removed**" | E | ingest 输出 | **句子或列表项**：R1 ingest "A SHA-256 checksum of the output file … is written to `<output>.sha256` …" | — / 明说（removed、no longer） | — | 无 | ingest 不再写 sidecar |
| 5.4 | 同上，及 "`transform` command: no longer writes `.sha256` sidecar files." | E | transform 输出 | **句中片段**：R1 "After all transformations, write the result CSV to `<output>`, its SHA-256 to `<output>.sha256`." 的后半句 | 保留的前半句未重述 / 明说 | R1 pipeline 示例 `final.csv.sha256` | 无 | transform 仍把结果 CSV 写到 `<output>`，不写 sidecar |
| 5.5 | 同节 · "If `<output>.sha256` exists from a previous run, `ingest` and `transform` must remove it." | B2 | ingest/transform 的文件副作用 | 不作废 | — | — | 无 | 按本句原文 |
| 5.6 | New command: `lineage` · "`\"ingest\"`: input = `file`, output = `output`" | A | 命令；各步骤类型的输入输出映射 | 不作废 | — | 映射表里没有 `lineage` 步骤类型本身（U8） | 有张力，按本轮原文：同轮 "same format as the `pipeline` command" 和 R1 pipeline ingest 步骤用的 `input` 与此不一致，记 T1。原文没有规定 ingest 步骤不含 `file` 键时怎么处理 | 映射按本节原文所列，包括 ingest 对应 `file`、不把 schema 算作输入；pipeline 命令执行 ingest 步骤的方式不受影响 |
| 5.7 | lineage / Error handling · "Invalid JSON: exit 1, `ERROR: invalid pipeline config: <path>`." | H（隐含） | 错误信息 | 不作废；R1 "Malformed JSON config…" 的作用范围收窄 | — / 隐含 | R1 共享错误规则 | 有：本轮针对 lineage 的明确陈述为当前要求 | lineage 用本节的错误信息；pipeline 命令仍按 R1 |
| 5.8 | Pipeline extension · "now supports the `\"lineage\"` step type" | B1 | pipeline 步骤类型 | 不作废 | — / 明说 | — | 无 | pipeline 接受 lineage 步骤 |

### R6（"Add the following capabilities to `dpipe`."）

| ID | a | b | c | d | e / f | g | h | i |
|---|---|---|---|---|---|---|---|---|
| 6.1 | New global flag: `--audit` · "Any `dpipe` command can accept an optional `--audit <path>` flag." | B2（横切到所有命令） | 所有命令的 CLI 参数，以及一个新文件 | 不作废 | — | input_size 的命令列表只覆盖到 R5（U7） | 无 | 所有命令接受 --audit，按本节格式追加条目 |
| 6.2 | 同节 · "`timestamp` (string): UTC ISO 8601 timestamp when execution started" | — | 确定性要求 | 移入规格未定 U6，不计数 | — | — | 见 U6 | 见 U6 |
| 6.3 | New transform: `impute` · "Fills missing (empty) values in a column using a statistical method" | A | 新 op | 不作废 | — | — | 无 | 按本节原文 |
| 6.4 | Pipeline extension · "the audit log records the pipeline execution, not individual steps within it." | H（明说） | pipeline 与 --audit | 不作废；限定的是同轮 6.1 | — / 明说 | — | 无 | pipeline 带 --audit 时只记 pipeline 本身 |

### R7（"…and apply the specified behavior correction."）

| ID | a | b | c | d | e / f | g | h | i |
|---|---|---|---|---|---|---|---|---|
| 7.1 | Behavior Correction: lineage manifest step · "`\"manifest\"` step has **no input nodes** (empty inputs array `[]`)." | D | lineage 中 manifest 步骤的映射 | **句中片段**：R5 "`\"manifest\"`: input = `dir` (treated as a single node), output = `output`" 的输入部分 | 部分重述（"still has an output node"），附示例 / 明说（previously、This is incorrect） | R5 的 Nodes、Edges 通则仍成立 | 无 | manifest 步骤没有输入节点、没有边，dir 不作节点；输出节点保留 |
| 7.2 | New transform: `temporal` · "Handles time-series operations on a numeric column" | A | 新 op | 不作废 | — | — | 无 | 按本节原文 |

### R8–R11

| ID | a | b | c | d | e / f | g | h | i |
|---|---|---|---|---|---|---|---|---|
| 8.1 | New command: `quality` · "Computes a data quality score for a CSV file" | A | 命令 | 不作废 | — | R6 input_size 列表里没有 quality（U7） | 无 | 按本节原文 |
| 8.2 | Pipeline extension · "New step type `\"quality\"`" | B1 | pipeline 步骤类型 | 不作废 | — / 明说 | — | 无 | 接受该步骤 |
| 8.3 | Lineage extension · "The `lineage` command recognizes `\"quality\"` steps" | B1 | lineage 映射表 | 不作废；R5 映射表是逐项列出的列表 | — / 明说 | R5 映射表 | 无 | 按本节映射 |
| 9.1 | New command: `schema` · "Auto-infers a JSON schema from CSV data." | A | 命令；输出与 R4 validate 的 schema 格式相同 | 不作废 | — | R6 input_size 列表（U7） | 无 | 按本节原文 |
| 9.2 | New transform: `mask` · "Masks sensitive data in a column, producing a new column." | A | 新 op | 不作废 | — | — | 无 | 按本节原文 |
| 9.3 | Pipeline extension · "New step type `\"schema\"`" | B1 | pipeline 步骤类型 | 不作废 | — / 明说 | — | 无 | 接受该步骤 |
| 9.4 | Lineage extension · "recognizes `\"schema\"` steps" | B1 | lineage 映射表 | 不作废 | — / 明说 | R5 映射表 | 无 | 按本节映射 |
| 10.1 | Manifest format change (conflict) · "The `blake2b` JSON field is replaced with two new fields" | F | manifest 的 JSON 接口 | **句中片段**：R1 示例 `{"path": …, "sha256": "abcdef...", "rows": 42, "size_bytes": 1234}` 中的摘要键值对。若把新示例读作完整格式，则 R1 整行示例条目都被取代（D1） | 部分重述（"same BLAKE2b-256 computation as before"、"Only the JSON field names change"）/ 明说 replaced | R1 示例的 `sha256`、`rows` | 有张力，按本轮原文：R10 所说的旧字段 `blake2b` 和旧格式与 R1 示例不符，记 T1。R10 内部 "Only the JSON field names change" 与新示例缺少 `rows` 的张力见 D1，不裁决 | 条目按 R10 新格式；R10 的任何读法都不保留第二个摘要字段；`rows` 的去留见 D1；顶层结构和排序 R10 没有涉及 |
| 10.2 | New command: `reconcile` · "Compares two manifest files (as produced by the `manifest` command)" | A | 命令 | 不作废 | — | R6 input_size 列表（U7） | 无 | 按本节原文 |
| 10.3 | Pipeline extension · "New step type `\"reconcile\"`" | B1 | pipeline 步骤类型 | 不作废 | — / 明说 | — | 无 | 接受该步骤 |
| 10.4 | Lineage extension · "recognizes `\"reconcile\"` steps" | B1 | lineage 映射表 | 不作废 | — / 明说 | R5 映射表 | 无 | 按本节映射 |
| 11.1 | New command: `fingerprint` · "BLAKE2b-256 hex digest of the raw file bytes (same algorithm as manifest)" | A | 命令 | 不作废 | — | R6 input_size 列表（U7） | 无 | 按本节原文 |
| 11.2 | New transform: `coalesce` · "Combines multiple columns into one by taking the first non-empty value." | A | 新 op（与 derive 的 `coalesce()` 函数同名，是不同对象） | 不作废 | — | — | 无 | 按本节原文 |
| 11.3 | Pipeline extension · "New step type `\"fingerprint\"`" | B1 | pipeline 步骤类型 | 不作废 | — / 明说 | — | 无 | 接受该步骤 |
| 11.4 | Lineage extension · "recognizes `\"fingerprint\"` steps" | B1 | lineage 映射表 | 不作废 | — / 明说 | R5 映射表 | 无 | 按本节映射 |

### R12–R15

| ID | a | b | c | d | e / f | g | h | i |
|---|---|---|---|---|---|---|---|---|
| 12.1 | Correction: Normalize transform default method · "When the `method` field is omitted or empty, normalize should now behave exactly like `\"minmax\"`" | G | normalize 的默认值 | 不作废；R2 "`method`: `\"zscore\"` or `\"minmax\"`" 没有规定缺省情形 | 重述了 minmax 公式和值全相同的情形 / 文中用 "instead of producing empty values" | — | 无。"instead of producing empty values" 所说的旧行为在先前原文中找不到，记 T1 | method 缺省或为空时按 minmax；显式 zscore（R3 版）和 minmax 不变 |
| 12.2 | Extension: New `round` transform · "write exactly `n` digits after the decimal point" | A | 新 op（与 derive 的 `round()` 函数是不同对象） | 不作废 | — | — | 无 | 按本节原文 |
| 13.1 | Extension: New `snapshot` command · "captures a dataset snapshot for reproducibility tracking" | A | 命令 | 不作废 | — | R6 input_size 列表（U7） | 无 | 按本节原文（同轮内部不一致见 D5） |
| 13.2 | Pipeline support · "The `snapshot` command must be available as a pipeline step" | B1 | pipeline 步骤类型 | 不作废 | — / 明说 | — | 无 | 接受该步骤 |
| 13.3 | 同节 · "Lineage reports must recognize `\"snapshot\"` steps" | B1 | lineage 映射表 | 不作废 | — / 明说 | R5 映射表 | 无 | 按本节映射 |
| 13.4 | Extension: New `clip` transform · "clips numeric values to a specified range" | A | 新 op | 不作废 | — | — | 无 | 按本节原文 |
| 14.1 | Extension: New `changelog` command · "compares two CSV files and produces a JSON summary" | A | 命令 | 不作废 | — | R6 input_size 列表（U7） | 无 | 按本节原文 |
| 14.2 | Pipeline support · "`input` is the `--before` file and `right` is the `--after` file" | B1 | pipeline 步骤类型 | 不作废 | — / 明说 | — | 无 | 步骤键名按本节原文 |
| 14.3 | 同节 · "Lineage reports must represent a `\"changelog\"` step with two inputs" | B1 | lineage 映射表 | 不作废 | — / 明说 | R5 映射表 | 无 | 按本节映射 |
| 14.4 | Extension: New `scale` transform · "multiplies numeric values in a column by a factor" | A | 新 op | 不作废 | — | — | 无 | 按本节原文 |
| 15.1 | Conflict: Snapshot row_hash must use SHA-256 · "It should now report `row_hash` as the SHA-256 digest" | C | snapshot 的 row_hash 算法与长度 | **句中片段 ×4**（R13）：示例 `"<md5 hex of sorted row content>"`、字段表 "MD5 hex digest of sorted row content"、第 4 步 "Compute the MD5 hex digest"、"lowercase 32-character MD5 hex digest" | 部分重述（同一个排序串、64 字符、"No other `snapshot` output fields or sorting rules change"）/ 明说（now、instead of） | 上述 R13 四处 | 无 | row_hash 改为对 R13 第 1–3 步所得的串取 SHA-256；其余字段不变 |
| 15.2 | Extension: New `tag` transform · "`ERROR: invalid recipe: missing 'as' field`" | A | 新 op、新错误信息 | 不作废 | — | — | 无 | 按本节原文 |

---

## 4. 作废单元

9 个单元。6.2 已移入 U6，不在此列。

**b1、b2 的判断前提：** 旧原文和新原文都作为当前要求原样并存。

- **b1**：不附轮次顺序。
- **b2**：每段原文附来源轮次，并按轮次先后排列。
- **是**：并存时能得到原生读法。
- **否**：并存时可能得到与原生读法不同的结果。

| ID | 粒度 | 剩余有效部分是否被新文重述 | 最小安全删除单位 | b1 | b2 |
|---|---|---|---|---|---|
| 3.1 | 句中片段 | 已重述。剩下的"两侧都缺则留空"由 R3 重述："If **neither** anchor exists, the cell remains empty." | 句子或列表项（R2 第 4 条）。R2 第 1、2、5 条和格式句没有重述 | 是 | 是 |
| 3.2 | 句中片段 | 部分重述。剩下的 "compute `mean`"：R3 公式用到 mean，但没有重述它的计算 | 句中片段 | 是 | 是 |
| 5.1 | 句中片段 | 已重述："still reads the checksum file passed with `--checksum` and compares it against the digest" | 句子或列表项（Verification 第一条）。第二条（输出与退出码）没有重述 | 是 | 是 |
| 5.2 | 句中片段 | 已重述："The `manifest` command must also produce BLAKE2b-256 checksums" | 句子或列表项。manifest 其余条目和示例没有重述 | 是 | 是 |
| 5.3 | 句子或列表项 | 没有剩余部分 | 句子或列表项 | 是 | 是 |
| 5.4 | 句中片段 | 未重述。"write the result CSV to `<output>`" 在 R5 及之后都没有重述，R1 transform 其他条目里也没有 | 句中片段 | 是 | 是 |
| 7.1 | 句中片段 | 已重述："still has an output node (the `output` field)" | 句子或列表项（R5 的这一项映射） | 是 | 是 |
| 10.1 | 句中片段（或整行示例条目，取决于 D1） | 部分重述：R10 新示例重述了 path、size_bytes；`rows` 只出现在 R1 示例中，R10 的新旧两个示例都没有 | 句中片段（摘要键值对）。在 D1 的任何一种读法下，删这一片段都不丢有效内容 | **否** | 是 |
| 15.1 | 句中片段 ×4 | 已重述：四处剩余的内容都由 R15 重述；R13 第 1–3 步不在作废范围内 | 句子或列表项，四处都要处理 | 是 | 是 |

**b1 与 b2 为什么不同：**

- b2 下读者可以直接套用"后一轮的明确陈述为当前要求"，这和原生 agent 依次读原文时的条件相同，所以 9 个单元都等同原生读法。10.1 的 D1 张力在 b2 下仍然存在，但原生读者面对的是同一处张力。
- b1 下读者只能靠新文的覆盖声明排出先后。8 个单元的覆盖声明点名了被替换的旧对象和旧值，而且与先前原文一致（previously、instead、removed、no longer、currently reports），所以并存时能自动排出先后。
- 10.1 的覆盖声明指向 `blake2b` 和一个先前原文中不存在的旧格式（T1）。不附顺序时，读者无法确定 R1 那条含 `sha256`、`rows` 的示例就是被取代的旧格式。

**分布：**

- 粒度：句子或列表项 1 个，句中片段 8 个，小节或条目 0 个。
- 最小安全删除单位：句子或列表项 6 个，句中片段 3 个（3.2、5.4、10.1）。9 个单元都不能删到小节或条目，否则会丢掉没有被重述的同节内容。
- 并存：b1 下 8 个"是"、1 个"否"；b2 下 9 个"是"。

---

## 5. 类别表

| 代码 | 实例 | 数 | 最终当前要求：包含 / 去掉 | 删除上限 · 并存 |
|---|---|---|---|---|
| A | 2.1–2.5、2.7–2.10、2.12、2.13；3.4–3.6；4.1、4.3、4.4；5.6；6.3；7.2；8.1；9.1、9.2；10.2；11.1、11.2；12.2；13.1、13.4；14.1、14.4；15.2 | 32 | **包含：** 新对象的完整原文；共享规则自动适用，不需复制。**去掉：** 无 | 不涉及删除 |
| B1 | 2.6、2.11、2.14、3.7、4.5、5.8、8.2、8.3、9.3、9.4、10.3、10.4、11.3、11.4、13.2、13.3、14.2、14.3 | 18 | **包含：** 旧集合原文和新成员原文；旧句是封闭列表时，要让它读作已扩展（补入新成员，或标明新句是对它的追加）。**去掉：** 无 | 不涉及删除。新文都写了追加声明，b1、b2 下都能读出扩展 |
| B2 | 3.3、5.5、6.1 | 3 | **包含：** 旧对象原文和新增部分；旧示例只当作部分示例。**去掉：** 无 | 不涉及删除 |
| C | 3.2、5.1、5.2、15.1 | 4 | **包含：** 旧句中除被换值以外的部分，以及新值。**去掉：** 被换值在规格、示例、字段表中的每一处。原文明说不受影响的对象保持原样 | 能删到句子或列表项，或只能删片段，取决于剩余部分是否已被重述（见第 4 节）；都不能删到小节。b1、b2 均为"是" |
| D | 3.1、7.1 | 2 | **包含：** 未改情形的规则和新情形的规则。**去掉：** 被改情形的那部分 | 剩余部分已重述，可删到句子或列表项。b1、b2 均为"是" |
| E | 5.3、5.4 | 2 | **包含：** 与被删部分同句但没被删除的行为，以及伴随的清理要求。**去掉：** 被删产物所在的列表项或片段 | 5.3 可删到列表项，5.4 只能删片段。b1、b2 均为"是" |
| F | 10.1 | 1 | **包含：** 新名称，以及新文给出的接口其他部分；新文没提到的旧字段是否保留按原文判断，原文自身有张力时列为疑难。**去掉：** 被替换的旧名称在规格和示例中的每一处 | 只能删片段。**b1 否，b2 是** |
| G | 12.1 | 1 | **包含：** 新规定，以及各显式选项的最新版本。**去掉：** 无，先前原文中没有对应的句子 | 不涉及删除 |
| H | 4.2、5.7（隐含）；6.4（明说） | 3 | **包含：** 共享规则原文，加上限定到具体对象的例外。**去掉：** 无；共享规则只是作用范围收窄 | 不作废。按"针对该对象的具体陈述"在 b1、b2 下都能化解 |
| **合计** | | **66** | | |

---

## 6. 跨类标签（不计数）

**T1：新文对旧状态的描述与旧原文不符。** 只作观察，不附处理规则。

| 实例 | 新文的描述 | 旧原文 |
|---|---|---|
| 5.6 | "`\"ingest\"`: input = `file`" 认为 ingest 步骤有 `file` 字段；同轮又写 "same format as the `pipeline` command" | R1 pipeline 的 ingest 步骤：`{"type": "ingest", "input": "raw.csv", …}` |
| 10.1 | "The `blake2b` JSON field is replaced"；"Old format per entry: `{…\"blake2b\": …}`"，其中没有 `rows` | R1 示例的键是 `sha256`，且含 `rows`；R5 没有提改名 |
| 12.1 | "instead of producing empty values" | R2 没有规定 method 缺省时的行为 |

**T2：残留的旧提及。** 旧句本身没有作废，但可能把人引向旧理解。

| 残留位置 | 相关单元 |
|---|---|
| R1 pipeline 示例 `"checksum": "final.csv.sha256"` | 5.1、5.4 |
| R1 manifest 示例的键 `"sha256"` | 5.2、10.1 |
| R1 fill "`strategy`: one of …" 三项 | 2.6 |
| R2 profile 的 JSON 示例；R2 "Percentile calculation (for `median`, `p25`, `p75`)" | 3.3 |
| R2 detect 的 zscore 引用 "profile's … stddev" | 3.2（不受影响的对象） |
| R5 lineage 映射表 | 7.1、8.3、9.4、10.4、11.4、13.3、14.3 |
| R13 中 MD5 的四处 | 15.1 |

---

## 7. 规格未定（不计入更新类别）

| 编号 | 位置 | 内容 |
|---|---|---|
| U4 | 3.2 · "If `n < 2`, all output values are `\"0\"`." | 空值行和非数值行（R2 规定输出空串）是否也输出 "0"，原文没有说明 |
| U5 | 3.1 · "the empty cell is filled with the lower anchor's value" | 外推值是原样复制锚点字符串，还是按 R2 对 "interpolated values" 的格式化处理，原文没有说明 |
| U6（原 6.2） | R6 · "`timestamp` … when execution started"；R1 · "The only exception is `generated_at`" | 审计日志必然随运行变化，R6 没有声明它是确定性要求的例外。参考列：粒度为句中片段（"only"）；剩余的"generated_at 是例外"没有重述；无可删单位；b1、b2 下按具体陈述都可化解 |
| U7 | R6 · "Primary input is: `--input` for transform/profile/validate, …" | 列表只覆盖到 R5 的命令；quality、schema、reconcile、fingerprint、snapshot、changelog 的 input_size 只能依据 "any command without an identifiable input" 这句兜底推断 |
| U8 | R5 · lineage 映射表 | 没有规定 `lineage` 步骤本身的映射；后续轮次也没有补上 |

---

## 8. 疑难项

| 编号 | 位置 | 内容 |
|---|---|---|
| D1 | 10.1 · "Only the JSON field names change" | R10 内部有张力：这句话意味着摘要字段以外的字段不变；但新格式示例 `{"path", "size_bytes", "checksum", "algorithm"}` 没有 `rows`，旧格式示例也没有。不替原文裁决。10.1 的作废粒度随之变化：句中片段，或整行示例条目 |
| D2 | 5.6 | 按本轮原文，lineage 的 ingest 映射是 `file`（T1）。原文没有规定 pipeline 配置中的 ingest 步骤只有 `input`、没有 `file` 时 lineage 怎么处理 |
| D3 | 12.1 | 标题写的是 "Correction"，但先前原文没有可修正的规定，所以归 G，不归 C 或 D。"Existing explicit `\"zscore\"` … must remain unchanged" 指 R3 修正后的版本 |
| D4 | 4.2、5.7 | 例外只写在 validate、lineage 各自的小节里。pipeline 命令遇到无效配置时仍落在 R1 共享规则的范围内，原文没有反向说明 |
| D5 | R13 snapshot | 同轮内部不一致：字段表写 "Count of distinct values in the column"，Behaviour 写 "the number of distinct non-empty values"。另外 R13、R14 的 "exit with a non-zero status" 与 R1 的 "exit code 1" 相容 |
| D6 | R2 小节标题 | "Extended transforms" 下的 encode、rollup、detect、bin 都是新 op，按内容归为 A；只看标题容易归成扩展旧对象 |

已了结的历史疑难：
- R5–R9 期间 manifest 的键名：这几轮时，关于键名最新的明确陈述是 R1 示例，见 5.2 的 i 列。
- lineage 的 ingest 字段名：按 R5 原文，见 5.6 与 D2。

---

## 9. 小结

- **构成：** 66 个更新单元中，纯新增 53 个（A 32、B1 18、B2 3）；作废单元 9 个（C 4、D 2、E 2、F 1）；G 1 个；H 3 个。规格未定 5 项，不计入。
- **作废粒度：** 9 个作废单元里，8 个只作废句中片段，1 个作废列表项；没有作废整个小节或条目的。
- **删除方面：** 6 个单元可以删到句子或列表项；3.2、5.4、10.1 只能删片段。5.4 若删整句，会丢掉 transform 写出结果 CSV 的唯一明文。
- **并存方面：** 附轮次并按先后排列时，9 个单元都等同原生读法。不附顺序时，能否等同取决于新文的覆盖声明是否点中先前原文；10.1 点不中（T1），所以不等同。
- **可推广的判别：** 判断一处更新会不会出错，关键看两点：剩余部分有没有被新文重述（决定能删到多大），以及覆盖声明有没有点中先前原文（决定不附顺序时并存是否安全）。"是否只作废了一部分"本身不决定风险。
