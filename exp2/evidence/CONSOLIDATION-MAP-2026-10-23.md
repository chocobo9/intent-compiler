# 收编映射表（DESIGN §12j，origin/exp2-pure-ic 5ca71a3）

只审不改代码。代码基准是本分支 fe6562d（批次 C 第二阶段）。数据来自 `origin/exp2-pure-ic` 的 `exp2/evidence/real-runs-2026-10-23/`：现在只有 rep1、rep1b–rep1e 五次，rep1f、rep1g（第 6、7 次）还没有推送。所以 §12j 里引第 6、7 次的依据，本文只能对着代码核，不能对着数据核。

标记：
- **【代码】**：fe6562d 里的实际路径；
- **【数据】**：五次真实运行的状态文件；
- **【推断】**：由上面两者推出，没有直接证据。

守卫翻转和回退两处只映射、不动，以 15 轮真实运行的数据为准（§12j.6 最后一条）。

## 先说结论

1. **六种条目里，四种能直接映射到 §12j.1 的一种记录**：K 映射到 hypothesis，V 映射到 confirmed，G 映射到 guard 身份，台账是这个列表加历史的投影。P 和 judgments 映射不上：探针没有代码可比的期望，judgments 是判断的缓存。
2. **映射不上的生命周期状态有七处**，其中三处需要设计上定下来：
   - 退化送出的条目（formalizer 写不出、没有检查），§12j.2 的图里没有这条路，但效果 4 的守恒要它；
   - 准入失败的检查（unknown）；
   - 被回退的修补送过的条目（`discarded`）。
3. **前提 3–5 在 fe6562d 的默认档位里已经是"记日志照送"**。真正改变送修行为的只有一处：`input_claim_false` 从拦截档移出，并去掉 formalizer 的 `claims` 义务。
4. **§12j.5 去留表有五行的依据与代码或数据不一致**（第 4 节）。最要紧的是裁决：它在 review 模式下默认开着，在库检查的轮初和终判里运行。rep1c 有 8 次调用，rep1d 有 2 次，各退役了 1 条检查；这些 token 不进报告，也不进 `measures.jsonl`。
5. **环境错误**：docker 连不上时，会被当作试跑失败发给执行方（最多 2 次），然后本轮在没有程序的情况下结束，串行继续下一轮。审查副本删不掉、clone 失败，会直接抛出未处理的错误，进程退出。只有主机拦截程序启动（智能应用控制）这一种会停轮。

## 1. 六个列表和五种生命周期

### 1.1 列表 → §12j.1 的记录

| 现在 | 在状态里的位置 | 映射到 | 怎么映射 | 映射不上的部分 |
|---|---|---|---|---|
| checks（K） | `checks`、`check_events`、`check_runs`、`check_calls`、`check_rounds` | origin = hypothesis | 命令 = `input.args`，输入 = `input.files`，期望 = `assertions`，依据 = `blocks` | 有 `admission: "unknown"`、没有已解析断言的检查，不是一条可运行的检查（见 1.2）；`strength`（强/弱）、`uses`（约定）、`direction: withdrawn` 在 §12j.1 里没有位置；`object` 字段用于工单任务区 |
| probes（P） | `probes`、`probe_events`、`probe_calls`、`probe_rounds`、`probe_measures` | **映射不上** | 探针只有命令和输入，期望由判断模型给，没有代码可比的期望，不符合"命令 + 输入 + 期望"的定义 | 整类；§12j.4 摘出路径，与此一致 |
| judgments | `judgments`、`judge_calls` | **映射不上** | 按（探针、单位、原文、输出摘要）缓存的判断结论，不是检查 | 整类；随探针摘出 |
| guards（G） | `guards`、`guard_events` | origin = guard（身份） | 库来源的守卫只存检查编号（`check: K…`），已经是"身份转换"；审查来源的守卫把输入和断言复制了一份（`GuardRecord.input/assertions`），与 V 的 `check` 重复 | 审查来源的守卫要改成指向它的 V 记录；G 编号与 K/V 编号是两套，§12j.1 说"编号可保留前缀作为显示"，但现在一条检查成了守卫后会同时有 K 和 G 两个编号 |
| review_items（V） | **不是顶层列表**，在 `executions[].review_items` 里，每轮一份 | origin = confirmed | 有 `check`（ItemCheck）的条目就是一条检查；`same_as` 指向同一偏离的早先条目 | 没有 `check` 的条目（`disposition: fallback`，或 `logged` 但建不成检查）没有命令或期望，不是检查（见 1.2）。**说明**：§12j 起因说"状态里并存六种条目"，实际上 V 和台账都不是独立列表 |
| ledger（台账） | **不在状态里**：`ledgerOf` 每次从 executions、各种事件、probe_rounds 折叠出来，写在 `checkpoints/round-NN/ledger.json` | 一个列表加历史的投影 | 条目的 id 就是 K/P/V/G；`sent`、`held`、`verdicts`、`end` 都能由事件流（ran、flipped、retired、superseded）重算 | `source: coverage`（探针未覆盖的单位，来自 `gapState`）随探针摘出；原因 `reference_pending`、`ambiguous` 以及 `confirmed`（裁决确认）随裁决和判断摘出 |

状态里其余的列表（`calls`、`rounds`、`sources`、`executions`、`reports`、`review_calls`、`formalize_calls`、`rulings`、`adjudication_calls`）不是条目，§12j.6 说的"一个列表加历史"不包括它们。

### 1.2 生命周期 → §12j.2 状态机的格子

状态机的格子编号：
- **H1** hypothesis 跑了失败 → 线索
- **H2** 通过且真执行了目标命令 → guard
- **H3** 通过但调用被拒绝 → 失败并告知写它的模型
- **C1** 审查员报偏离 → 从材料落成 confirmed
- **C2** 两条前提都过 → 送修
- **C3** 任一不过 → 记日志不送
- **C4** 修好后通过 → guard
- **G1** 翻转且原文改过 → 问审查员；SUPERSEDED 则退役，否则送修
- **G2** 翻转且原文没改 → 直接送修
- **G3** 修补改坏其他 guard → 回退

| 生命周期 | 现在的状态或事件（【代码】） | 格子 | 说明 |
|---|---|---|---|
| **K** | 写出并通过 `checkChecks` | written | |
| | `admission: admitted` | written | |
| | `admission: unknown`（已告知模型，`fed_back: true`） | **映射不上** | §12j.2 只有"在程序上跑"之后的格子；一条没有任何已解析期望的检查跑不了。批次 C 已经保证它告知过模型 |
| | 修补用完后丢弃（`check_rounds[].dropped`） | **映射不上** | 不入列表，只在报告里按原因计数 |
| | 在程序上失败、从未通过 → 线索 | H1 | `accept.ts` 中只对未成为守卫的库检查、非超时的失败、同一输出只给一次 |
| | 通过 → 守卫 G（`source: library`） | H2 | |
| | 通过但 `refused_call` | H3 的前半 | 判为失败、不成为守卫（批次 C 效果 2）。"告知写它的模型"**没有实现**：写检查只在轮初调用，没有运行后回告的通道 |
| | 过期：自己的依据被替换（basis） | superseded | 来自归属的 modification 记录，确定性 |
| | 过期：引用、约定、未写明的 reading（refers_to、convention） | 删 | review 模式下关闭（`stale_by_reference: false`）；§12j.5 删 |
| | 退役：模型提议且依据确被修订（proposal） | retired | |
| | 退役：裁决判错（adjudicated） | **映射不上** | 裁决不在 §12j.2 里，但 review 模式下仍在运行（第 4 节第 10 行） |
| | 退役：连续两轮输入可疑（suspect） | **映射不上** | 第 9 块的规则 |
| | 强度（strong/weak）、对象状态（landed/not_landed/unknown） | **映射不上** | 不是检查的生命周期；对象状态仍用于工单任务区（`not_landed` 的对象进入任务区） |
| **P** | written、stale、judged、strengthened、measured | 不映射 | 随探针摘出 |
| **V** | 回复的列表项 → formalizer 条目 → 用材料补输入 | C1 | 批次 C：线索、会话文件、前一条命令、formalizer |
| | 前提核验 → `sent`（复现了） | C2 | |
| | 被拦截档挡下：`blocked`（`unit_not_in_force`、`not_reproduced`；现在还有 `input_claim_false`） | C3 | §12j 写的是"记日志，不送"；现在台账记为 `report_only / blocked`，一致 |
| | `logged`：值或参考脚本的前提失败，照送 | C2 | §12j.3 降为记录字段后就是 C2 加字段，一致 |
| | `fallback`：formalizer 写坏、没写、没有输入、没有断言、调用失败；按审查员原话送出，台账 `unverified` | **映射不上** | §12j.2 只画了"落成 confirmed"一条路；§12j.5 保留"材料补输入"，但没说补不到的条目怎么办。效果 4 的守恒要求每一项都有结局，所以需要在状态机里加一格，或者明确它不是检查记录、只是审查条目 |
| | 修好后通过 → 守卫 G（`source: review`） | C4 | |
| | 同一偏离再报（`same_as`） | **映射不上** | 是去重，不是状态 |
| | 下一轮带入（复现过、不到期，B1） | C2（跨轮） | 与 §12j.5 第 7 行一致 |
| | 依据被后一轮替换，不带入（`superseded_in`，B1） | superseded | |
| | 送它的修补被回退（`discarded`） | **映射不上** | G3 只说"回退这次修补"，没说这次修补送出的条目怎么办。现在是丢弃，台账 `report_only`。以 15 轮数据为准 |
| **G** | `passing`（出生） | became_guard | |
| | `failing` 且带 `changed_text` | flipped → G1 | |
| | `failing` 且没有 `changed_text` | flipped → G2 | |
| | 修补后翻转 → `reset` 回修补前 | G3 | 现在只回退修补周期，工作周期改坏的不回退；以 15 轮数据为准 |
| | `retired`（审查员写了 SUPERSEDED） | superseded | §12j.1 的事件表里 retired 和 superseded 分成两种；现在守卫只有一种退役，原因写在 reason 里 |
| | 超时：`unknown`，不翻转 | **映射不上** | 事件表里没有"跑不出结果" |
| **台账** | open → closed：fixed、superseded、ruled_program_right | 投影 | ruled_program_right 来自裁决 |
| | open → report_only：expired、ruled_ambiguous、uncheckable、blocked、discarded、unverified | 投影 | expired 只对未复现的条目；ruled_ambiguous、uncheckable 随裁决和探针摘出 |
| | `reason: reference_pending` | **映射不上** | 来自裁决的 disputed/reference |

## 2. 五条前提

| 前提 | 函数（【代码】） | 调用处 | fe6562d 默认档位 | 降为记录字段后会变的代码路径 | 会变的测试 |
|---|---|---|---|---|---|
| 1 单位仍有效（`unit_not_in_force`） | `notInForce`（formalize.ts） | `assessPremises`（formalize.ts）→ `accept.ts`（送修前）、`acceptance.ts`（回放）；`serial.ts` 轮初带入（B1，判 superseded）。库检查的对应规则是 `staleChecks` 的 basis 分支（checks.ts） | 拦截 | 不降，§12j.3 保留 | — |
| 2 复现（`not_reproduced`） | `reproduces`（formalize.ts），用 `runCheck`，现在含拒绝指纹 | `accept.ts`、`acceptance.ts` | 拦截；超时也算没有复现 | 不降。注意：超时算"没有复现"会挡下真偏离，属于环境原因，见第 5 节 | — |
| 3 输入声明（`input_claim_false`） | `claimProblems`、`parsedFacts`、`parseCsvGo`（formalize.ts）；形状核对里"csv/json 文件必须有 claims"（`formalizeProblems`） | `assessPremises` | **拦截** | ① 从拦截档移出，记为字段；② `formalizeProblems` 不再因缺 claims 退回 formalizer（现在缺了会退回一次，再缺就算 malformed，走退化）；③ schema 的 `claims` 可以保留为可选；④ 回放的 strict/tiers 两列失去意义 | `block-accept.test.ts` §2 的"单列 CSV 空单元格被挡"（`checkPremises` 断言 `input_claim_false` 挡下），改为断言字段；`block-accept-fix.test.ts` A3 的拦截档配置测试 |
| 4 值在原文里（`value_not_stated`、`value_not_computed`） | `assessPremises` 里的 `statedIn` | `accept.ts`、`acceptance.ts` | 记日志、照送 | 行为不变，只去掉档位配置。**另有同名规则不属于前提**：库检查写作时的 `verbatim_mismatch`（checks.ts 的 `checkChecks`，两处 `statedIn`）退回模型、修补用完后丢弃（rep1e 的 2 条 pivot/unpivot exit 1）。§12j.3 没有提到它，要另行决定 | `block-accept.test.ts` §2"数值期望由文字陈述"；`block-accept-fix.test.ts` A3"记日志、照送" |
| 5 参考脚本一致（`reference_failed`） | `methodB`（checks.ts），在 `assessPremises` 中调用 | `accept.ts`、`acceptance.ts` | 记日志、照送；建不成检查时以 unverified 送出 | 行为不变。**同一函数也是库检查的准入**（效果 1），那里不是前提而是写作的退回循环，不受 §12j.3 影响 | `block-accept.test.ts` §2 的 `reference_failed` |

共通要改的地方（【代码】）：
- `accept.ts` 的档位逻辑：`block` 集合，以及 `logged`/`stop` 分支；
- `DEFAULT_PREMISE_BLOCK`、`OWN_FAILURES`（formalize.ts）；
- `local-config` 的 `premise_block` 及其校验；
- `ReviewItemRecord.premise`、`logged` 的含义；
- 报告的 `premise_blocked`/`premise_logged`，`measures` 的 `premise` 字段。

## 3. §12j.4 摘出路径：涉及的文件、行数量级、测试

行数是 fe6562d 的实际行数或区段的近似（【代码】）。§12j.4 说探针、判断、裁决的代码保留，所以下表只列从流程、报告和回放里摘出的部分。

| 项 | 涉及的文件（行数） | 摘出的量级 | 删掉后失效的测试 | 要改写而不是删的测试 |
|---|---|---|---|---|
| 探针、判断进每轮流程（probes 模式） | `serial.ts` 的 `runRound` probes 分支（约 125 行）、`measure`/`probe`/`runAndJudge`/`seenFrom`/`verdictCounts`/`mergeStatuses`（约 100 行）、`reviewRound` 的探针线索（约 25 行）；`execution.ts` 的 `executeRound`（约 260 行，第 9–12 块的周期循环）；`store.ts` 的探针、判断方法（约 75 行） | 约 600 行；`probes.ts`、`judge.ts`、`discrimination.ts`、`mutation.ts`（约 1200 行）保留不动 | `block10.test.ts`（20 项）、`block10c.test.ts`（4）、`block11.test.ts`（15）、`block12.test.ts`（20），绝大多数走完整的 probes 串行；`block-accept.test.ts` §5"探针每单位写一次"（1 项） | `serial.test.ts`（7）、`recording.test.ts`（15）、`infra.test.ts`、`local.test.ts`（2 处 Serial）、`ablation.test.ts`（3）：它们构造 Serial 时不给 reviewer，于是走 probes 模式（`executeRound`），测的却是检查点、续跑、中断、录音、消融这些通用行为，要改成 review 模式加替身审查员。`execution.test.ts`（9）测 `executeRound`：其中会话中断续做、步骤 trailer、锚点归属这几项要改写到 `acceptRound` 上，裁决和最少失败周期两项删除 |
| 裁决 | `serial.ts` 4 处 `adjudicate: this.c.adjudicate`（`runRoundChecks` 的轮初和终判）；`store.ts` 的 `settle`/`settleIn`（约 25 行）；`local-config` 默认就创建裁决的 transport | 约 40 行调用 | `checks.test.ts` 的裁决相关项（约 3 项）、`block11.test.ts` 部分 | 如果保留在终判里（第 4 节第 10 行），则要把 `adjudication_calls` 计入报告成本，现有测试改为断言计数 |
| 工单保护区、状态区 | `workorder.ts` 的 `protect`、`statusZone` 及其渲染（约 45 行）；`report.ts` 的 zones；`ablation` 的 zoning 开关 | 约 60 行 | `ablation.test.ts`"zoning off"（1 项）；`execution.test.ts`、`serial.test.ts`、`local.test.ts` 中断言 zones 的几行 | `execution.test.ts`"R1 工单"（只留任务区和原文区的断言） |
| 回放 probes 模式 | `acceptance.ts` 的 `replayAcceptance`、`probeDetect`、`repairProducts`、`compareCases`、`scoreDefects` 等（约 300 行）；`detect.ts`（121）；CLI：`exp2-detect`（38）、`exp2-probe-detect`（60）、`exp2-repair`（46），以及 `exp2-replay` 的 probes 分支（约 50） | 约 600 行 | `block9.test.ts`（4）、`block12.test.ts` 的回放项、`block-accept.test.ts`/`block10.test.ts` 中调用 `replayAcceptance` 的项 | 无 |
| 第 10–12 块专用的报告字段 | `report.ts` 的 `probes` 块（约 40 行类型和计算）、`selection`、`acceptance`（A/B/C 计数）、`loss`、对象表；`renderReport` 中相应的行（约 30 行）；`ledger.ts` 的探针、覆盖缺口、裁决部分（约 80 行） | 约 150 行 | `block10–12` 的报告断言 | `block-accept.test.ts` 串行 R1–R3 的报告正则（按 §12j.4 的两组数重写）；`batch-c.test.ts` 的报告正则不变 |
| 按引用过期 | `checks.ts` `staleChecks` 的 refers_to、convention、reading 分支（约 40 行）；`probes.ts` 的同类规则；`acceptance.stale_by_reference` 开关 | 约 60 行 | `propagation.test.ts` 的"refers_to 过期"和"约定修订只使相关检查过期"（2 项） | `propagation.test.ts` 的 basis 过期、applies_to 进入范围、部分修订精确到子句（3 项）保留不动 |

测试的量：
- 删掉：`block9–12` 加上零散几项，约 65 项（约 1400 行）；
- 改写：约 35 项（serial、recording、infra、local、ablation、execution）。

`neutral.test.ts` 检查模型可见文字的中立性，探针和判断的代码保留，它们的提示词仍要覆盖，这个测试不动。

## 4. §12j.5 去留表逐行核对

| 行 | 表中依据 | 代码或数据里看到的 | 一致？ |
|---|---|---|---|
| 审查员 + formalizer + 材料补输入：留 | 第 7 次 25/25、+131 | 代码在（fe6562d）；第 7 次的数据未推送 | 无法用数据核 |
| 前提 1、2：留 | 第 4 次 R5 撤回类；第 7 次复现 22 条 | 第 4 次（rep1d）只跑了 R1，R1 不可能有后轮撤回；五次运行里 `unit_not_in_force` 一次也没有触发（rep1d 挡下的 16 条全是 `no_input`，rep1e 0 挡）【数据】。R5 撤回的例子来自离线测试（`block-accept.test.ts` §2 的 sidecar），以及 VERIFY-2026-10-22 的 K8（第 12 块回放）。第 7 次的数据未推送 | **前提 1 的依据不一致**：应引用第 12 块回放和离线测试，不是第 4 次运行 |
| 前提 3–5：降为记录 | 判断链已下线；第 7 次只触发 1 次 | fe6562d 默认档位里，值和参考脚本两条已经是"记日志、照送"（A3），只有 `input_claim_false` 仍在拦截档【代码】。五次运行里三者都没有触发 | 方向一致；实际要改的只有 `input_claim_false` 和 formalizer 的 claims 义务 |
| 库检查写作：留为 hypothesis，成本单列 | 第 4 次 13 条线索确认 7 条；第 5 次 52k token 换 1 假守卫；第 7 次 11 守卫 | rep1d 给了 13 条线索；审查员**按编号**引用了 6 条（K8–K12、K16），另有第 6 条（fill 丢空行）与线索 K13 fill-strategies 话题相同但没有点编号，算上它是 7 条【数据】。rep1e 写检查的未缓存输入 52,543 ✓；假守卫 G1 ✓。"成本单列"：报告里有 checks 一行，`measures` 有 checks 一项 ✓ | 7 条是按话题算的；按编号确认是 6 条。其余一致 |
| 拒绝指纹：留 | 第 5 次 G1 | `verdict.ts` 的 `refusedCall`（批次 C）✓ | 一致。§12j.2 写的"告知写它的模型"没有实现（第 1.2 节） |
| 守卫、回退、原文改动分流：留，细节待 15 轮 | 第 7 次 30 守卫；翻转和回退还没出现 | rep1d、rep1e 的翻转都是 0，回退都是 0【数据】 | 一致 |
| 有效期两轮到期：并入状态机（复现过的不到期） | 第 12 块 54 条过期 31 条不该 | 复现过的不到期，B1 已经实现（`expire_reproduced: false`）。MIDDLE-LAYER-CHECK 里的"54 个过期条目 31 个不该过期"说的是**按引用过期**（stale），不是两轮无进展到期（expired）【数据】 | **依据不一致**：这一行的依据属于下一行（按引用过期） |
| 按引用过期：删（已默认关） | 同上 | 串行在 review 模式下传 `staleByReference: false` ✓。但 `staleChecks`、`staleProbes` 被直接调用时默认是开的：`store.runRoundChecks` 不传参数时就按引用过期，CLI detect、repair、probe-detect 经 `acceptance.ts` 的 `probeDetect`、`repairProducts`、`replayAcceptance` 调用时也不传，因而也是开的【代码】 | 对串行和 review 回放一致；"默认关"只在 Serial 的配置层成立 |
| 覆盖义务 unitsOnce：留（确定性） | 批次 B2 | 这一行把两个机制写成了一个：`unitsOnce`（B2）规定"检查只为本轮新增或修订的单位写"；覆盖义务（`coverageIssues` 的 `uncovered`）要求本轮每个带值的单位都有检查，否则退回。后者每次调用都在产生退回：rep1e 三次调用的 uncovered 是 13、13、12，rep1d 是 15、15、15【数据】 | **不一致**：需要分开决定。unitsOnce 是确定性的规则；覆盖义务是推动修补调用的主因之一，留不留会影响库检查写作的成本 |
| 探针、判断、裁决：摘出路径 | 10b R6–R10 都耗在误报上 | 探针、判断在 review 模式下默认关 ✓。**裁决默认开**：`local-config` 总会创建裁决的 transport，`reviewRound` 在轮初和终判调用 `runRoundChecks(…, { adjudicate })`，对 disputed 的库检查发起裁决【代码】。rep1c 8 次调用、退役 K4；rep1d 2 次、退役 K5【数据】。这些调用的 token（rep1c 未缓存约 7.8 万，rep1d 约 2.2 万）**不进报告的任何一行，也不进 `measures.jsonl`**：报告的 acceptance 一项只算 `check_calls` | **不一致**：§12j 起因说三个角色"默认关闭"，对裁决不成立；而且它的成本漏记，违反"未知成本不写成零" |
| 工单保护区、状态区：删 | 七次 R1 都为空 | 保护区在 R1 结构上必然为空（还没有已落地的对象）；状态区在 rep1d 是 **1**（Zones: status 1）【数据】。R2 起保护区才会有内容 | **不一致**：状态区不是七次都空；R1 的证据不足以支撑删除 R2 起的保护区，要看 15 轮数据 |
| 回放 probes 模式、第 10–12 块报告字段：删 | 路径已摘出 | 代码在，见第 3 节 | 一致 |
| 环境错误进试跑：改为停轮等待 | 第 6 次：docker 错误被当作试跑失败发给执行方两次 | 代码路径与这个描述相符（第 5 节）；第 6 次的数据未推送 | 代码一致，数据无法核 |

另外两处 §12j 没有写、却会受影响：
- **§13.1 第 4 块**的验收标准（"被引用的原文块修订后，引用它的检查被标为过期"）就是按引用过期。§12i 第 6 条已经在实质上取代了它，删除时要在 §13 里注明。
- **状态兼容**：§12j.6 要求"六个列表变为一个列表加历史"，这会改变 `exp2-state.json` 的结构。`appendOnly` 和 `EXP2_PROFILE` 意味着旧状态（包括正在 fe6562d 上跑的 15 轮）读不进新代码，除非写迁移，或者规定新代码只用于新运行。

## 5. 环境错误现在各走到哪里（【代码】）

| 错误 | 发生在 | 现在的去向 | 结果 |
|---|---|---|---|
| 主机拦截启动程序（智能应用控制，`spawn UNKNOWN`） | `runner.execute`、`guardedSync`（构建、anchors、docker CLI 的启动本身） | 重试 3 次后抛出 `EnvironmentBlocked` → `serial.run` 捕获：保存这次尝试的花费，回到检查点，写 `stopped-round-NN.json` | **停轮**，不等待、不自动续跑 |
| docker 守护进程连不上（docker CLI 退出码非 0，"Cannot connect…" / "error during connect"） | `dockerGoBuilder`（构建）、`dockerTrial`（试跑）、`runInContainer`（检查运行） | `isEnvironmentBlock` 只认智能应用控制，所以构建返回 `{ ok: false, output }`。`acceptRound` 接着跑试跑，同样失败，就把 docker 的报错当作对照组格式的试跑失败消息发给执行方，最多 `trial_fixes` 次（默认 2），然后 `trial_spent`。没有一个周期通过时，`kept` 为空，不审查，任务对象全部带到下一轮。本轮照常写报告和检查点，**串行继续下一轮** | 白白花掉执行方两次修复和整轮。与 §12j.5 引的第 6 次描述相符 |
| docker 在一轮中途断开（构建已通过，检查运行时） | `runInContainer` 返回 docker CLI 的退出码和报错 | 检查运行的结果被当作程序的输出来比较：所有检查失败（库检查成为线索；守卫判为由通过变失败）。修补周期里出现翻转会**触发回退**；工作周期里则判为退化送修【推断：代码路径如此，真实运行里没有出现过】 | 可能把环境故障判成退化，并回退一次好的修补 |
| docker 运行超时 | `runInContainer` 的 `timed_out` | 检查记为超时：守卫记 `unknown`，不翻转；条目检查超时算"没有复现"（`reproduces`），挡下 | 超时会挡下真偏离（前提 2 的边界） |
| 审查副本删不掉（EPERM、EBUSY） | `discardCopy` | 吞掉，副本留在原处（29158c1 的本地修复） | 不影响本轮 |
| 审查副本目录在新建前就存在且被锁（例如续跑同一轮，标签重复） | `copyProgram` 开头的 `rmSync` | 抛出 → `acceptRound` 的 `review` 不认它（只认 `SessionBroken` 和超时）→ `serial.run` 只处理 AuthInvalid、EnvironmentBlocked、RoleUnavailable、QuotaExhausted，其他错误继续抛 → CLI 以退出码 1 结束 | **进程退出**；再次运行会从检查点续跑（同一标签，可能再次 EPERM）【推断】 |
| `git clone` 审查副本失败 | `copyProgram` | 同上 | 进程退出 |
| 状态文件换名失败（Windows 上被占用） | `store.locked` 的写临时文件再换名 | 抛出 → 进程退出；锁文件按 pid 清理 | 进程退出，从检查点续跑 |
| 参考脚本的解释器不存在或启动失败 | `LocalScriptSandbox.run` → 脚本退出码非 0 | 库检查：作为准入问题**退回给写检查的模型**（批次 C 效果 1），模型改不了；条目：`reference_failed`，记日志 | 环境问题被当作模型的问题 |
| OpenCode 服务断开 | 执行方：`SessionBroken` → 回到最后提交，重开会话（`maxSessions`）；审查员：`SessionBroken` → 这次审查作废、重做一次，再失败则本轮停止审查；管理调用：传输重试，用完则 `RoleUnavailable` → 停轮 | 各角色不一致：执行方和管理调用会停或重试；审查员会**静默地停止本轮审查**（C0 清点第 11 行） | |
| 额度用完、限流 | 各 transport → `QuotaExhausted` | `serial.run`：保存花费，回到检查点，等 `resumeWaitMs`（默认 30 分钟）后续跑，最多 48 次 | **停轮等待**：这是 §12j.5 想要的行为，现在只有额度这一类走这条路 |

所以 §12j.5 最后一行要的"停轮等待"，现成的机制是 `QuotaExhausted` 那条路径（保存花费、回检查点、等待、续跑）。缺的是识别：docker 不可用、文件系统 EPERM/EBUSY、clone 失败、脚本解释器缺失，现在都没有归为环境错误。

## 6. 改动量估算和分批建议

验收以 §12j.6 为准：七次重放的接口计数逐项相同或更好，替身串行 R1–R3 的报告字段只少不多，状态是一个列表加历史，五种故障注入全部守恒，一次真实 R1 冒烟。

**先做的准备（不改行为）**：把批次 C 的重放测试（`batch-c.test.ts`）在 fe6562d 上得到的接口计数存成基线文件（每次运行：报、进、挡、no_input、准入/入库、守卫数）。之后每批都拿这份基线比，这样"相同或更好"就是一个机械的比较。rep1f、rep1g 推送后补进去。

| 批 | 内容 | 源码变动量级 | 测试 | 依赖 |
|---|---|---|---|---|
| 1 摘出路径 | Serial 去掉 probes 模式和探针线索；`executeRound` 不再被串行调用；回放只留 review；CLI detect、probe-detect、repair 移除或标为旧工具；按引用过期删除；报告按 §12j.4 只渲染两组数，其余进 report.json | 删约 1200–1500 行，改约 200 行 | 删约 65 项；改写约 35 项到 review 模式 | 无。**裁决怎么办要先定**（第 4 节第 10 行）：保留则把成本计入报告，摘出则从 `runRoundChecks` 的两处调用里拿掉 |
| 2 前提降为字段 | 去掉档位配置；`input_claim_false` 和值、参考脚本的结果都记为字段；去掉 formalizer 的 claims 义务；报告和 measures 改成计数 | 改约 150 行，删约 60 行 | 改约 8 项 | 批 1 之后（回放的 strict 列先在批 1 去掉） |
| 3 一种记录加历史 | 状态 schema：K 和 V 合为一个列表加 append-only 事件；守卫成为身份，审查来源的守卫指向它的 V；台账成为投影；轮初带入、线索、覆盖都从这个列表取。翻转和回退只换数据结构，不改规则 | 改约 800–1200 行（`store`、`accept`、`guards`、`ledger`、`serial`、`report`），新增迁移或版本切换约 100 行 | 改写 `block-accept`、`block-accept-fix`、`batch-c` 中断言状态形状的部分；重放基线必须完全一致 | 等 15 轮数据定翻转、回退、superseded 的细节；需要先决定第 1.2 节三处映射不上的状态（退化条目、unknown 检查、discarded）；旧状态不兼容 |
| 4 环境错误停轮等待 | 把 docker 不可用、EPERM/EBUSY、clone 失败、解释器缺失归为环境错误，走 `QuotaExhausted` 那条路径（保存、回检查点、等待、续跑）；试跑里的环境错误不再发给执行方；检查运行中途 docker 断开时不判翻转 | 改约 100–150 行 | 新增约 6 项（替身 docker 命令返回守护进程错误） | 用 rep1f 的真实输出校准识别规则；可以和批 1 并行 |

建议顺序：批 4 和批 1 先做（都不碰状态结构），各做一次真实 R1 冒烟；批 2 随后；批 3 等 15 轮数据和第 1.2 节的三个决定，最后做，做完再冒烟一次。整体是净删约 1500–2000 行源码、约 1400 行测试。

需要用户或设计会话先定的：
1. 裁决留在终判里，还是一起摘出；
2. 退化送出的条目在状态机里的位置；
3. 覆盖义务（`coverageIssues`）是否和 `unitsOnce` 一起保留；
4. 工单保护区是否等 15 轮数据再删；
5. 旧状态要迁移，还是新代码只用于新运行。
