# 诊断：真实 R1 第 4 次（rep1d）与第 5 次（rep1e）

批次 C 第一阶段，只诊断，不改代码，不提修法。

材料：`origin/exp2-pure-ic` 2250130 的 `exp2/evidence/real-runs-2026-10-23/`。rep1d 的代码是 `exp2-block1` 29158c1，rep1e 的代码是本分支 abb6f71。rep1e/RESULT.txt 在本文写完之前没有读。

标记：
- **【观察】**：状态文件、报告、official、会话导出里直接可见，或者对它们做确定性的计算（例如把 rep1e 的参考脚本在本机原样运行）得到；
- **【推断】**：由观察推出，没有直接证据；
- **【代码】**：abb6f71 的代码路径。

## 结论

1. **rep1e 的 20 条发现没有在 IC 内部丢失。** 三次审查的回复都整段送到了执行方。分数不动，直接的原因在执行方：三次修补都没有实现 derive、aggregate、window、pivot，而这四项每次审查都报了。official 在首次交付和最终提交上的逐条结果完全相同（0 条修好，0 条改坏）。
2. **IC 自己在这一轮失效的，是"核验和积累"那一半。**
   - 库检查 22 条里 21 条的参数以程序名开头，在任何程序上都不成立；19 条因参考脚本输出的是 Python 字典而不是 JSON，从未准入。剩下 3 条运行过的检查里，唯一通过的 K12 成了守卫 G1，而它通过的原因是参数错误导致程序报错退出。
   - formalizer 对 20 条全部写不出输入。这些条目所需的输入文件，在审查会话的 `apply_patch` 调用里全部都有。
   - 所以本轮没有一条审查条目能变成检查或守卫。台账以 3 条 `unverified` 收尾，下一轮不会带入。
3. **rep1d 的 16 条 `no_input`**：审查员在 10 条里有 6 条用 IC 给它的线索编号（"the K8 aggregate recipe/input"、"K9 join case"）代替了输入。这些输入完整地存在 IC 的库检查里，formalizer 的请求里却没有库检查和线索。其余 10 条（第 1 次审查 3 条、第 2 次 7 条）是审查员概述或省略了输入；rep1d 的审查会话没有导出，这些输入是否存在于会话记录里，无法判断。
4. **写检查的三次调用都没有被告知 19 条失效的原因。** 准入在三次调用全部结束之后才做；参数带程序名也没有任何代码规则检查。

## 第 1 题：rep1e 从编码到轮末的整条链

### 时间线

墙钟按 `checkpoints/measures.jsonl` 的 `stages_ms` 和 report.md 的 "Wall time" 一行；各阶段只有起止的汇总（首次开始、最后结束），没有逐次的时间戳。

| 时刻（s） | 环节 | 发生了什么 | 证据【观察】 |
|---|---|---|---|
| 0–24 | 归属 | 16 个对象（rep1d 是 21 个） | report.md "Scope: 16 objects"；`calls` 1 条 |
| 24–185 | 写库检查（后台，与编码并行） | 3 次调用 M2、M3、M4。首答 26 个问题，修补后 18 个，第三次 20 个；第三次之后不再调用，有问题的 7 条逐条丢弃，22 条入库。22 条里 21 条 `input.args` 以 `"dpipe"` 开头；19 条 `admission: "unknown"`，原因都是 "reference script did not print JSON"；准入的只有 K11、K12、K14 | `check_calls[].issues`；`check_rounds[0].dropped`（7 条：`expect_invalid` 5、`verbatim_mismatch` 2、`computed_by_hand` 1，有一条同时有两种问题）；`checks[].admission`、`admission_reason`、`input.args` |
| 24–161 | 编码 C1.1 | 执行方回复："Included: Ingest, transform, verify, manifest, and pipeline commands … Sampling, sorting, renaming, dropping, fill, join, and unpivot transforms"。没有 derive、aggregate、window、pivot | `executions[0].cycles[0].note`；usage 输出 8355 token |
| 161–185 | 构建、试跑、等待库检查 | 构建、试跑通过；等待库检查 10 s | `cycles[0].build.ok`、`trial.ok`；`stages_ms` "waiting for checks" 10138 |
| ~185 | 守卫运行（C1.1） | 3 条已准入的库检查运行：K12 通过，当场成为 G1；K11、K14 失败（`not_landed/missing_name`），成为给审查员的 2 条线索。三条检查程序都只回了 `ERROR: unknown command` | `cycles[0].runs`、`guards.born: ["G1"]`；`check_runs[].stderr_head` 都是 "ERROR: unknown command"；`accept.leads.library` 2 |
| 187–451 | 审查 1（V1.1.1，在 C1.1 上） | 报 6 条：derive、aggregate、window、pivot 未实现；主键按字面排序；非法正则未拒绝。会话里识别出 16 次运行 | `review_calls[0]`：`program_runs` 16，`response_text` |
| 451–469 | formalizer F1，前提核验 | 6 条全部 `input: null`，0 个问题（没有退回）。6 条都是 `no_input`，按退化处理，整段回复作为 V1.1.0 送出 | `formalize_calls[0]`；`cycles[0].items` = `[V1.1.0 unverified send "fallback, the whole reply: no_input 6"]`；`review_items` V1.1.1–6 `disposition: fallback` |
| 469– | 修补 C1.2 | 执行方："Added expression evaluation support internally. Added eager validation for invalid regex patterns … The existing transform implementation remains limited for derive, aggregate, window, and pivot; those require broader restructuring of the current compressed implementation." | `cycles[1].note`；usage 输出 2993、推理 386 |
| | 守卫运行（C1.2） | G1 通过，K11、K14 仍失败（同一输出，不再作为线索） | `cycles[1].runs`；第 2 次审查 `leads` 0 |
| | 审查 2（V1.2.1，在 C1.2 上） | 报 7 条：主键排序、derive/aggregate/window/pivot 仍未实现、verify 不匹配时 stderr 多出一行、verify 缺文件时缺少 `ERROR:` 前缀。12 次运行 | `review_calls[1]` |
| | formalizer F2 | 7 条全部 `no_input`，整段作为 V1.2.0 送出 | `formalize_calls[1]`；`cycles[1].items` |
| | 修补 C1.3 | "Verify missing files now use `ERROR: file not found: <path>` … Added numeric-aware key comparison support." | `cycles[2].note`；输出 1598 |
| | 审查 3（V1.3.1，在 C1.3 上） | 报 7 条：主键排序仍按字面（输入 10、2、1，输出 1、10、2）、校验阶段顺序、derive/aggregate/window/pivot 仍未实现、pipeline 未实现（"ERROR: unknown command"）。17 次运行 | `review_calls[2]` |
| ~963 | formalizer F3 | 7 条全部 `no_input`，整段作为 V1.3.0 送出 | `formalize_calls[2]`；`cycles[2].items` |
| –985 | 修补 C1.4 | "Implemented the missing `pipeline` command … The reported derive, aggregate, window, pivot, type-aware sorting, and validation-order issues remain unresolved in the current implementation." | `cycles[3].note`；输出 1017 |
| –990 | 守卫运行（C1.4），轮末 | G1 通过；审查次数已满 3，不再审查。终判只有 3 条运行（K12 通过，K11、K14 失败）。台账 V1.1.0、V1.2.0、V1.3.0 以 `unverified` 结束 | `cycles[3].review` 为 null；report.md "Checks: 22 entered … 3 run, 1 passed, 2 failed"；ledger.md |
| — | 计分 | 首次交付 bc871edb 108/219，最终 16d8e1c8 108/219；逐条比对两份 cases.json：0 条由失败变通过，0 条由通过变失败 | `scores.jsonl`；`official/round-01/*/cases.json` |

### 发现在哪些环节丢失或失效

| 环节 | 丢失或失效 | 证据【观察】 | 后果 |
|---|---|---|---|
| A. 写库检查：参数 | 22 条里 21 条 `input.args[0] == "dpipe"`，程序收到的第一个参数是自己的名字 | `checks[].input.args`；3 条运行过的 `stderr_head` 都是 "ERROR: unknown command" | 库检查在任何程序上都测不到它声称测的行为 |
| B. 写库检查：准入 | 19/22 `admission: unknown`。21 条参考脚本的最后一行都是 `print({...})`（Python 字典的 repr），0 条用 `json.dumps`。在本机原样运行这 21 个脚本，退出码都是 0，输出都不是 JSON | `checks[].admission_reason`；`reference_script.code`；运行结果见附录 | 19 条不运行、不当守卫、不当线索、不进终判；14 个对象的状态是 `derived_disagreement`（report.md 的对象表） |
| C. 写库检查：丢弃 | 7 条草稿在第三次调用后丢弃：5 条 `expect_json` 不是 JSON（未加引号的字符串），2 条 `verbatim_mismatch`（期望 exit 1，原文写的是 "exit with error"），1 条手写摘要 | `check_rounds[0].dropped` | 这 7 条（pivot、unpivot、verify、pipeline 失败、缺文件、坏 JSON、坏正则）不入库 |
| D. 守卫 | 唯一的守卫 G1 来自 K12。K12 的 args 是 `["dpipe","transform",…]`，期望 exit 1：它通过，是因为程序把 `dpipe` 当作未知命令、以 1 退出 | `guards[0]`；`check_runs` K12 `exit_code` 1，`stderr_head` "ERROR: unknown command" | 守卫存在，但守的不是 K12 描述的行为 |
| E. 线索 | 给审查员的 2 条线索 K11、K14 失败的原因是参数错误，不是程序的行为 | `cycles[0].runs`；`accept.leads.library` 2 | 第 1 次审查读到 2 条无意义的线索（审查员的回复里没有提到它们） |
| F. formalizer | 20/20 `input: null`，`why_no_input` 都是"没有给出文件的完整内容"。所需的输入都在审查会话的 `apply_patch` 里（第 2 题） | `formalize_calls[].response_text` | 没有一条审查条目建成检查，也就不复现、不固化为守卫，修补之后无法判断是否修好 |
| G. 送修 | 没有丢失：三次修补消息都是 `REPAIR_INTRO` 加审查员整段回复，与对照组相同。执行方会话没有导出，消息全文按代码和 `review_calls[].response_text` 重建【代码】 | `cycles[*].items`；执行方 note 逐条回应了回复里的条目【观察】 | — |
| H. 执行方 | 三次修补都没有实现 derive、aggregate、window、pivot，回复里自己说明了不做；C1.3 说加了按类型比较主键，第 3 次审查仍看到按字面排序；C1.1 说包含 pipeline，第 3 次审查看到 "unknown command"，C1.4 才说实现了 | `cycles[1..3].note`；`review_calls[1..2].response_text` | official 逐条结果不变 |
| I. 台账 | 3 条 `unverified` 在轮末结束（`report_only`），不进入下一轮的带入（只有有检查的条目会被带入）【代码】 | ledger.md | 若有第 2 轮，这些发现只能等审查员再报一次 |
| J. 报告 | "reported 20, entered a repair list 3"：整段送出算 1 条，所以 20 条里只显示 3 条 | report.md "Reviewer items" | 读报告时容易读成 17 条没送 |

【推断】执行方声称的修补（正则、verify 文字、主键比较、pipeline）都没有让任何 official 用例改变结果。可能的原因有两种：这些修补没有真正生效（主键排序有第 3 次审查为证），或者 official 用例覆盖的组合里，这些行为还依赖未实现的操作。最终程序不在材料里，无法区分。

【推断】与对照组 L 的差别：对照组用同一档位的执行方、同样的修补消息格式，R1 从首次交付 41.1%/46.1% 提到 64.4%/90.4%（OBSERVATIONS §17）。rep1e 的首次交付（108，49.3%）高于对照组的两次，修补却没有效果。材料里能看到的差别在执行方的上下文：IC 的首条消息是工单，不是原文；执行方写出的 main.go 只有约 21–23 行（审查员读到的长度，单行极长，执行方自称 "compressed implementation"）。这是否就是三次修补不做大功能的原因，材料不足以判断。

## 第 2 题：两次的 `no_input` 由什么造成，输入是否本来就在 IC 手里

### 共同的代码事实【代码】

formalizer 的请求（`buildFormalizeRequest`）只有注释原文、审查员回复全文、程序名。审查会话的工具调用、给审查员的线索、库检查的输入都不在请求里。审查副本在 formalizer 调用之前就被删除（`discardCopy`）。审查请求是对照组的原文，只要审查员写出"the command and input you used"，不要求贴文件全文。

### rep1d（16 条）【观察】

| 审查 | 条目 | 审查员怎么写的输入 | 所需输入在 IC 的哪里 |
|---|---|---|---|
| 1 | 1–5 | "with the K8 aggregate recipe/input"、"K9 join case"、"K10 window case"、"K11 pivot case"、"K12 unpivot case" | 库检查 K8–K12 的 `input`（args 和文件全文）就在 `state.checks` 里。这 5 条检查当时作为线索，带着 args 和文件内容（每个文件截到 400 字符）写在审查请求里（本次审查 `leads` 13，请求 26644 字符，第 2 次 19330 字符） |
| 1 | 7 | "Command: K16 case" | 库检查 K16（缺文件） |
| 1 | 6 | 给了 input.csv（`x\n\na\n\n`），recipe 只说 "forward-fill recipe" | 审查员自己的文件；rep1d 的审查会话没有导出，无法判断 |
| 1 | 9、10 | 给了主键输入 `id\n10\n2\n`，没给 schema；pipeline 只描述了现象 | 同上 |
| 2 | 1–7 | 文件路径都在 `review-fixtures/` 下，内容没给，有的命令用省略号（"…"） | 同上 |

第 1 次审查的第 8 条（derive 比较运算）写出了完整输入，是唯一建成检查并送修的一条；修补后成为 G9，分数从 107 到 142。

原因：审查员把 IC 给的线索当作已知上下文引用，formalizer 看不到线索（6 条）；审查员用摘要代替文件内容（10 条）。

### rep1e（20 条）【观察】

三次审查的回复都只给命令，并对输入作概述（例如 "Input IDs: `10`, `2`, `1`"），只有 2 条写了 recipe 的 JSON。三个会话导出里，审查员都通过 `apply_patch` 写了输入文件，`input.patchText` 里有全文：

| 审查 | 写入的文件 | 回复里引用的输入是否都在其中 |
|---|---|---|
| V1.1.1 | 16 个（left.csv、base.csv、derive-recipe.json、aggregate-recipe.json、window-recipe.json、pivot-recipe.json、sort-input.csv、sort-schema.json、bad-pattern-schema.json、empty-label.csv 等） | 6/6 条都在 |
| V1.2.1 | 9 个（review.csv、review-schema.json、review-recipe.json、review-aggregate.json、review-window.json、review-pivot.json、review-bad.sha256 等） | 7/7 条的输入文件都在；第 6、7 条（verify）还要 review-out.csv，它是同一会话里前一条 ingest 命令的输出，命令在会话记录里 |
| V1.3.1 | 13 个（review-input.csv、review-schema.json、review-recipe-*.json、review-order.csv、review-order-schema.json、review-pipeline.json 等） | 7/7 条都在 |

（核对方法：用正则从回复中取出文件名，去掉输出文件和有意不存在的文件 does-not-exist.csv，逐个与 `apply_patch` 写入的文件名比对。）

同名文件在一个会话里没有被写成不同的内容：V1.1.1、V1.2.1 中每个文件都写了两次，两次内容相同。审查员在会话结束前用 `Delete File` 删除了自己写的文件（V1.1.1 24 次，V1.2.1 16 次），所以即使不删除审查副本，磁盘上也已经没有这些文件。

原因：审查员按对照组请求的格式写摘要，不贴文件；formalizer 只拿到回复文字。所需的输入 20/20 都在 IC 持有的审查会话记录里，IC 运行时读取过这份记录（`programRunsIn` 统计运行次数），但只取了命令计数。

## 第 3 题：22 条库检查只有 3 条运行过

### 原因【观察】

- 19 条 `admission: "unknown"`，`admission_reason` 都是 "reference script did not print JSON"（K9 是 "no computed value for input sha (reference script did not print JSON)"）。21 个参考脚本的输出语句都是 `print({...})`，没有一个用 `json.dumps`。把这些脚本连同各自的输入文件在本机用 `python3 -I` 原样运行：21 个退出码都是 0，输出都是 `{'exit': 0, …}` 这样的 Python repr，`JSON.parse`/`json.loads` 都不接受。
- K11、K12 也是这样的脚本，但它们各有一条 verbatim 断言（exit code），不需要脚本，所以准入；K14 没有脚本，两条都是 verbatim。准入的只有这 3 条，也就只有它们在各周期和终判里运行。
- 对照：rep1d 的 20 个参考脚本里 12 个用 `json.dumps`，0 个 `print({`，21 条全部准入。两次用的是同一个提示词和同一个模型。
- 另外：即使准入，22 条里 21 条也因为参数以 `dpipe` 开头而不成立（见第 1 题 A）。rep1d 里这样的检查是 0 条。

### 模型有没有被告知【观察 + 代码】

| 调用 | 发给模型的问题 | 回复后代码发现的问题 |
|---|---|---|
| M2（首答） | 无 | 26：uncovered 13、verbatim_mismatch 9、script_missing 4 |
| M3（修补 1） | M2 的 26 个 | 18：uncovered 13、verbatim_mismatch 5 |
| M4（修补 2） | M3 的 18 个 | 20：uncovered 12、expect_invalid 5、verbatim_mismatch 2、computed_by_hand 1；没有下一次调用，有问题的草稿丢弃 |

三次请求里都没有出现 "did not print JSON"，也没有任何关于参数带程序名的问题。【代码】准入（`methodB`）发生在 `deriveChecks` 返回之后，结果只写进 `admission_reason`；`checkChecks` 没有检查 args 开头的规则。模型拿到的相关说明只有两处：schema 写 args 是 "Arguments after the program name"，参考脚本"prints one JSON object"；系统提示里写的是 "prints {assertion id: value}"。【推断】后者的花括号写法与 Python 字典字面量一致，但 rep1d 在同一提示下用了 `json.dumps`，不能把 rep1e 的写法归因于提示词。

## 第 4 题：C0 清点

见下节（从 abb6f71 的代码读出）。读 rep1e 的数据时发现一处原表漏列的接口，补为第 32 行：库检查的 `input.args`。

### C0 清点——模型输出进入代码判定的接口

（全部从 abb6f71 的代码读出，不依赖运行数据。）

列的含义：
- **认不出 / 失败时**：代码实际做什么。
- **告知模型**：失败的原因有没有写进下一次给这个模型（或下游模型）的请求。
- **默认**：挡（发现或产物被丢、被作废、流程停止）还是放（照常往下走）。

默认配置：review 模式，`fallback: items`，`premise_block` 为 unit_not_in_force、not_reproduced、input_claim_false，`void_without_runs: false`，`checks_once`、`checks_in_background` 开，probes 关。

### 4.1 理解与库检查

| # | 接口 | 认不出 / 失败时 | 告知模型 | 默认 |
|---|---|---|---|---|
| 1 | 归属回复（`attribution.ts` `attributeRound`：JSON、`shapeProblems`、`checkAnswer`） | 每次的问题写进下一次请求，直到 `attributionRepairs` 用完；仍不通过则 `status: failed`，`serial.runRound` 返回 `stopped`，整个串行停止 | 是（修补请求带 issues） | 挡（整轮停） |
| 2 | 库检查回复的 JSON 与形状（`checks.ts` `deriveChecks`：`unparseable`、`checksShapeProblems`） | 写进下一次请求；从未解析成功则 `status: failed`。review 模式下检查在后台写，`serial.reviewRound` 的 `checksReady` 只对 `interrupted` 抛出，`failed` 时本轮没有新检查，流程照常继续，状态里只有一条 `check_rounds[].status: "failed"` | 是（修补请求） | 挡（本轮没有新检查），流程本身不停 |
| 3 | 库检查的确定性规则（`checkChecks`：对象作用域、块存在、依据归属、名字出现在原文代码片段、手写摘要、`unit_unchanged` 等，加覆盖缺口 `coverageIssues`） | 写进下一次请求；修补次数用完后，仍有问题的检查**逐条丢弃**（`outcome.dropped`），其余入库 | 是（修补请求）；最后一轮丢弃时不再告知 | 挡（逐条丢） |
| 4 | 库检查的准入（`store.writeRoundChecks` 里的 `methodB`：参考脚本运行、输出解析、与 A 类值比对、`{{computed:…}}` 填充） | 有一条断言能解析就是 `admitted`，否则 `admission: "unknown"`，`admission_reason` 写原因。`activeChecks` 只收 `admitted`，所以 unknown 的检查**从不运行**：不进守卫，不当线索，不进终判，不进覆盖 | **否**：准入发生在 `deriveChecks` 返回之后，原因不回到写检查的模型 | 挡（整条检查静默失效） |
| 5 | 已准入但有部分断言不能解析（同上，`unknown[]`） | 这些断言丢掉，其余断言照常运行 | 否 | 挡（逐条断言） |
| 6 | 库检查在程序上运行（`verdict.ts` `runChecks`/`classify`） | 比对由代码做。review 模式下，从未通过过的失败只作为线索交审查员，从不送修；超时不当线索 | 线索给审查员（`# Leads to verify`），不给执行方 | 放（只作线索） |
| 32 | 库检查的 `input.args`（schema 写明"Arguments after the program name"） | 代码不核 args 是否以程序名开头；程序名出现在原文代码片段里，`name_unknown` 不拦。以程序名开头的检查照常入库，运行时程序收到的第一个参数是自己的名字；失败被 `classify` 归为 `not_landed/missing_name`（"no string literal in the program names dpipe"） | 只有 schema 描述 | 放（入库，但检查本身不成立） |

### 4.2 执行方

| # | 接口 | 认不出 / 失败时 | 告知模型 | 默认 |
|---|---|---|---|---|
| 7 | 执行方交付的程序：主机构建（`goBuilder`）加目标环境试跑（`dockerTrial`/`goTrial`） | 失败就发对照组的试跑消息，最多 `trial_fixes` 次（默认 2）；用完之后 `status: trial_spent`，本轮结束。如果没有一个周期通过，`good` 为空：没有审查，`kept` 为空，任务对象全部带到下一轮 | 是（试跑输出） | 挡（不审查） |
| 8 | 执行方会话出错（`SessionBroken`、调用超时） | 回到最后一个提交，重开会话，次数不超过 `maxSessions`；用完则 `sessions_spent` | 是（新会话收到最后一次修补清单） | 放，次数用完后挡 |
| 9 | 执行方回复里的 `CONTEST` 行（`contestsIn`） | review 模式下不读 | — | 不适用 |
| 10 | 主机构建输出被识别为环境拦截（`isEnvironmentBlock`） | 抛 `EnvironmentBlocked`，串行停止，写 `stopped-round-NN.json` | — | 挡（整个运行停） |

### 4.3 审查员

| # | 接口 | 认不出 / 失败时 | 告知模型 | 默认 |
|---|---|---|---|---|
| 11 | 审查会话的传输或会话错误（`OpenCodeReviewer.review`：`SessionBroken`，或 `callTimeoutMs` 超时） | 记一条无回复的 `review_calls`，同一槽位重做一次；第二次仍失败，这次审查 `out: null`，`survivors` 为 0，`lastReviewFound = false`，**本轮后面的审查全部不做**（`accept.ts` 的 `canReview`） | 否 | 挡（本轮停止审查） |
| 12 | 会话里是否运行过程序（`programRunsIn`/`invokesProgram`） | 只计数（`program_runs`、`program_runs_zero`），审查照常有效（A2） | 否 | 放 |
| 13 | `NO ISSUES` 判定（`isNoIssues`：整段只有 NO ISSUES，允许强调符号和句号） | 其他写法（如 "No issues found."）不算无发现：交 formalizer。`reviewEntries` 把整段当一条；formalizer 不写条目时它成为 `not_formalized`，按退化**送给执行方** | 否 | 放（无发现的回复可能被当发现送修） |
| 14 | `SUPERSEDED Gn: …` 行（`supersededIn`：行首可有 `-`/`*`，编号可加反引号） | 其他写法（加粗、写成句中的一部分、没有冒号）认不出：被问到的守卫按退化送修，之后不再问 | 请求里写明了格式 | 挡（守卫的"被取代"判断丢失，按退化处理） |
| 15 | 审查回复的列表切分（`reviewEntries`：行首不缩进的数字或 `-`/`*`/`•`） | 缩进的顶层列表、标题式条目（`### 1.`）不算条目；没有任何条目时整段算一条。条目数决定 `reported` 和 `not_formalized` 的位置对应 | 否 | 放（整段送出），但位置对应可能错 |
| 16 | 审查员 token（`sessionTokens(messages)`） | 拉取会话消息失败时，用回复 `info.tokens`；那里也没有就是 **0**，记录上不标 `usage_unknown` | — | 成本按 0 记 |

### 4.4 formalizer 与前提核验

| # | 接口 | 认不出 / 失败时 | 告知模型 | 默认 |
|---|---|---|---|---|
| 17 | formalizer 调用失败（传输重试 `TRANSPORT_RETRIES` 次后） | `formalize_failed`：审查回复的每一条都退化送修（A1） | — | 放 |
| 18 | 回复不是 JSON，或没有 `items` | 退回一次；仍然如此：每一条都算 `malformed`，退化送修 | 是（退回一次） | 放 |
| 19 | 条目的形状问题（`formalizeProblems`：text、units 全不认得、input 结构、csv/json 的 claims、断言的 target/id/kind、derived 缺脚本） | 退回一次；仍有问题的条目 `malformed`，退化送修 | 是（退回一次，含编号语法） | 放 |
| 20 | 单位编号的书写（`canonicalUnit`；部分不认得） | 去掉 hash、合并 `:`；认得的保留，不认得的丢掉，不报问题 | 只有全部不认得时才告知 | 放 |
| 21 | `expect_json` 不是 JSON；verbatim 断言的单位缺失或不存在 | 当字符串读；单位置空，由前提核验在条目自己的单位里找 | 否 | 放 |
| 22 | formalizer 漏写了审查回复里的某条（按位置） | `not_formalized`，按审查员原话退化送修 | 否 | 放 |
| 23 | `input: null`（formalizer 写不出输入） | 不退回、不再问；前提核验为 `no_input`，退化送修（A1）。没有检查，所以修补之后代码无法判断是否修好：台账以 `unverified` 结束，不进守卫，不带到下一轮 | **否**：不退回，formalizer 也没有拿到审查员写过的输入文件（见 4.5） | 放（送出，但不可核验） |
| 24 | 前提：单位不在效力内（`notInForce`） | 拦截档：挡下，台账记 `premise_failed`，结局 `blocked` | 否（审查员和 formalizer 都不知道） | 挡 |
| 25 | 前提：输入的声明与解析器不符（`claimProblems`） | 拦截档：挡下 | 否 | 挡 |
| 26 | 前提：期望值没有写在原文里、数值没有脚本算 | 记日志档：照送，记 `logged` | 否 | 放 |
| 27 | 前提：参考脚本失败或与给的值不一致（`methodB`） | 记日志档：能解析的断言照建检查；一条都解析不了时没有检查，以 `unverified` 送出 | 否 | 放（无检查） |
| 28 | 复现（`reproduces`） | 检查在当前程序上通过：`not_reproduced`，拦截档挡下。**检查超时也算没有复现**（`reproduced` 要求 `failure.reason !== "timeout"`），同样挡下 | 否 | 挡（超时也挡） |
| 29 | 送出后各周期重跑条目检查（`accept.ts` 第 4 步） | 超时：这个周期不记 sighting；通过：固化为守卫 | — | 放 |

### 4.5 守卫

| # | 接口 | 认不出 / 失败时 | 告知模型 | 默认 |
|---|---|---|---|---|
| 30 | 守卫运行超时（`runGuards`） | `unknown`：不翻转、不触发回退 | — | 放 |
| 31 | 守卫翻转后"原文是否在它背后改动"（`changedTextBehind`，代码规则） | 有改动：问审查员（见 14）；没有改动：判退化送修 | 送修消息给执行方 | 挡（按退化送修） |

### 4.6 不在默认路径上

探针写作、判断、裁决（`probes.ts`、`judge.ts`、`adjudication.ts`）在 review 模式下默认关，没有列入。

### 4.7 计数

32 个接口中（第 9 行不适用；第 32 行是读了 rep1e 的数据之后补的，代码事实与其他行同样从 abb6f71 读出）：
- 挡 13 处：1、2、3、4、5、7、10、11、14、24、25、28、31；
- 放 16 处：6、12、13、15、17–23、26、27、29、30、32；
- 先放、次数用完后挡 1 处：8；
- 成本按 0 记 1 处：16。

挡的接口里，失败原因**不**写回给产生输出的模型的有 4、5、11、24、25、28（28 包括超时）。


## 第 5 题：哪些是 IC 自己的问题，哪些是执行方或环境的问题

| 问题 | 归属 | 依据 |
|---|---|---|
| 21/22 库检查的参数以程序名开头 | IC | 写检查是 IC 的管理角色（`roles.checks`）；schema 写明了 args 不含程序名，代码没有规则核它（第 4 题第 32 行）【观察 + 代码】 |
| 19/22 库检查因参考脚本输出 Python repr 而不准入 | IC | 同一角色的输出；准入失败不回告模型（第 4 题第 4 行）；rep1d 同提示下没有出现，属于模型输出的随机性，但"失败后不告知、静默失效"是 IC 代码的行为【观察 + 代码】 |
| 7 条草稿丢弃（`expect_json` 未加引号 5 条等） | IC | 同一角色；formalizer 侧对同样的未加引号字符串按字符串读（A6），库检查侧没有【代码】 |
| 唯一守卫 G1 守的不是它描述的行为 | IC | 由上面第一条直接导致：K12 因为 "unknown command" 退出 1 而通过【观察】 |
| rep1e 20/20、rep1d 16/17 `no_input` | IC | 输入在 IC 持有的材料里（rep1e：会话的 `apply_patch`，20/20；rep1d：库检查 K8–K12、K16，6 条），formalizer 的请求里没有【观察 + 代码】。审查员按对照组的格式写摘要，这是对照组请求本来的写法，不是审查员的错误 |
| rep1d 另外 10 条 `no_input` | 不能判定 | rep1d 的审查会话没有导出 |
| 报告把整段送出计为 1 条 | IC | `summary.sent = survivors.length`，整段只有一个 sighting【代码】 |
| 修补三次不实现 derive、aggregate、window、pivot；声称的修补未生效（主键排序）或与审查结果不符（pipeline） | 执行方 | 修补消息与对照组相同，执行方在回复里自述不做（"require broader restructuring"），输出 token 2993、1598、1017【观察】。IC 有没有间接影响（工单作为首条消息、执行方写出的压缩代码），材料不足以判断【推断】 |
| 环境 | 本次没有观察到 | 试跑 4/4 通过；3 次审查都有效，识别出 16、12、17 次运行；审查员第 1、2 次用 `go run .`，第 3 次用 `dpipe-review.exe`，都被识别；没有中断或重跑【观察】 |
| 构建产物 `dpipe` 在仓库里 | 执行方与 IC 各一半，没有影响分数 | 审查副本（按提交 clone）根目录有 `dpipe` 文件，第 1 次审查用 `Delete File` 删掉了它：执行方在工作树里 `go build -o dpipe`，`commitStep` 把它一起提交了【观察 + 代码】 |

## 附录：核对方法

- rep1e 参考脚本：对 `checks[]` 中每条有 `reference_script` 的检查，把 `input.files` 写进空目录，脚本存为 `__reference__.py`，`python3 -I` 运行，再用 `json.loads` 读 stdout。21 条都是退出码 0、不是 JSON；K14 没有脚本。
- official 对比：两份 `cases.json` 的 `cases` 逐键比较。
- 会话中的文件：解析每个 `apply_patch` 的 `input.patchText`，按 `*** Add File:`、`*** Update File:`、`*** Delete File:` 切分，取 `+` 行作为文件内容。
