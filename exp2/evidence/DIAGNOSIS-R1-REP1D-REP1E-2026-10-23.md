# 诊断：真实 R1 第 4 次（rep1d）与第 5 次（rep1e）

批次 C 第一阶段，只诊断，不改代码。代码基准：第 4 次是 `exp2-block1` 29158c1，第 5 次是本分支 abb6f71。

**状态（本文是第一稿）**：两次运行的目录（`exp2-state.json`、`checkpoints/round-01/report.md`、official、`evidence/review-session-*.json`）只在本地机器上（`D:/huawei/EvoCodeBench/harbor_runs/`），云端会话读不到，任何分支上也没有。所以本稿只有不依赖运行数据的部分：第 4 题（C0 清点，从 abb6f71 的代码读出），以及第 2、3 题里"代码给了模型什么、没给什么"的那一半。第 1 题、第 2 题和第 3 题的数据部分、第 5 题，要等材料推到分支上之后补。

下文"代码"指 abb6f71 中实际执行的路径，标了文件和函数；没有写"观察到"的地方都不是从运行数据得来的。

## 第 4 题：C0 清点——模型输出进入代码判定的接口

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

31 个接口中（9 不适用）：
- 挡 13 处：1、2、3、4、5、7、10、11、14、24、25、28、31；
- 放 15 处：6、12、13、15、17–23、26、27、29、30；
- 先放、次数用完后挡 1 处：8；
- 成本按 0 记 1 处：16。

挡的接口里，失败原因**不**写回给产生输出的模型的有 4、5、11、24、25、28（28 包括超时）。

## 第 2、3 题：代码给了模型什么（与运行数据无关的部分）

### formalizer 的请求里有什么（第 2 题）

`buildFormalizeRequest`（`formalize.ts`）只给四样：R1 到本轮的注释原文、审查员回复全文、程序名、（退回时）上一次回答和问题清单。下面这些 IC 持有的材料，formalizer 都**看不到**：
- 审查会话的工具调用：审查员运行的命令、`apply_patch` 写的文件、`read` 读到的输出。导出的会话（rep1b、rep1c）里有这些调用；IC 运行时用 `programRunsIn` 读过同一份消息，只取命令计数。
- 审查副本目录：审查员写的输入文件留在副本里，`discardCopy` 在审查结束后、formalizer 调用之前就删除了它（`accept.ts` 的 `review`）。
- 线索与库检查：给审查员的线索（`# Leads to verify`）里有库检查的命令和输入；库检查本身（`state.checks[].input`）是完整的可运行输入。

第 4 次和第 5 次那些条目要的输入，是否就在这些材料里，要看运行数据（待补）。

### 写库检查的模型被告知了什么（第 3 题）

- 写检查的三次调用（首答加两次修补，`checkRepairs` 默认 2）之间，模型收到的只有 `checkChecks` 和 `coverageIssues` 的问题（4.1 第 3 行）。
- 准入（4.1 第 4 行）发生在三次调用都结束之后：参考脚本跑不通、算出的值与 A 类值不一致、`{{computed}}` 没有值。这些原因只写进 `admission_reason`，模型一次也没收到。
- 一条 `admission: "unknown"` 的检查不运行：不进守卫，不当线索，也不进终判。

"22 条只有 3 条运行过"是否就是这个原因，原因又是什么（例如参考脚本在本机没跑通，还是与 A 类值不一致），要看 `checks[].admission`、`admission_reason` 和 `check_runs`（待补）。

## 第 1、5 题

待运行目录。需要的文件：
- 两次各自的 `exp2-state.json`、`checkpoints/round-01/report.md`（及 `report.json`）、official 结果、`scores.jsonl`、`first-deliveries.jsonl`；
- 第 5 次的 `evidence/review-session-*.json`。

可以推到任意分支下的 `exp2/evidence/rep1d-rep1e-2026-10-23/`。如果 state 里有不便提交的内容（密钥、`.env`），提交前去掉，或只导出 state 的这些列表：`checks`、`check_events`、`check_runs`、`check_calls`、`check_rounds`、`executions`、`reports`、`guards`、`guard_events`、`review_calls`、`formalize_calls`。
