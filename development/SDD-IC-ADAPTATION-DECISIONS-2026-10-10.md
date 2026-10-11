# IC 适配 SDD：2026-10-10 决策记录

目的（用户确认）：把冻结的初版 IC 适配进 SDD，跑 15 轮对比实验拿结果。所有改动只服务于这个目的，不以下一版设计为目标；下一版的很多内容还没有落地，也没有形成闭环。

## 背景事实

- SDD 是别人的代码，不能改。IC 拆成几部分，挂在 SDD 已有的接口上：PRD 之上（节点 1 输入）、PRD 之后、人工决定点。方向已认可。
- 初版 CI 正文主体是按条目重新分组的原文。装配时会把 IR 已经切掉的撤销片段原样加回来，被修改的条目则新旧原文并列，所以 PRD 仍然要自己消化跨轮修改，同一件事被判断了两次。证据：`experiments/sdd/records/2026-10-10-ci-assembly-withdrawn-passages.md`。
- 运行后的需求评估与 SDD 的 PRD Check 重复。已改为读取 PRD Check（同日完成）。

## 本轮决策

用户说明自己没有很明确的方向，按我的推荐先试。

1. **SDD 模式下，IC 只做跨轮语义**：跨轮有效要求（取代判断）、每轮变化、本轮交付范围。验收标准、方案设计、证据规划、单个需求内部的模糊澄清都交给 SDD。落地：CI 不再写用户验收条件（`completion`），这部分由 PRD 负责。
2. **有效要求的表达方式**：仍然有效的原文由代码逐字附上；被完全取代的原文不再交给 SDD（IC 存储里保留）；被部分取代的地方，由模型写一句修改后的有效表述，并注明依据的原文段落。模型只引用请求中提供的段落编号，不抄写原文。
3. **CI 正文开头附“本轮变化清单”**：用平实的话说明这次用户输入新增、修改、撤销了什么，由模型写，独立核对检查。

## 实验分组（当前计划）

1. SDD-only 原流程：15 轮串行，正在运行。
2. IC+SDD：使用本次适配后的 IC，同一 SDD 原流程、同一晋级规则。
3. 对照组（只换节点 1 输入）：待第 2 组跑通后再定是否需要。

## 实现（同日，`integration/sdd` 工作区，未提交）

- `DeliveryDraft`：删除 `completion`，新增 `change_summary`（本轮变化，模型写）和每个任务的 `effective`（`item_id`、有效表述 `text`、依据 `basis`，均为请求中列出的输入段落编号）。schema 和 CI、核对两段指令同步更新。
- 装配（`sdd-compiler.ts`）：新增 `currentPassages`，只附 IR 当前引用的原文，不再加回已撤销的片段。被修改的条目在原文之后附 `[requirement as it now holds, per user input N]` 加有效表述。正文以 `# Changes in this update` 开头；不再输出 `User acceptance`；hold 不产生正文。
- 校验：有效表述必须对应本轮交付的条目，必须有文字和依据，依据的段落必须存在，否则该批次不接受，不会交给 SDD。
- **与决策 2 的偏差**：原计划“被部分取代的原文不交给 SDD”。实际上输入段落按段（空行分隔）编号，被改的一句话往往和仍然有效的其他条目在同一段里，删整段会丢掉有效要求。所以部分取代的原文仍然附上，后面紧跟模型写的有效表述，明确告诉 PRD 以哪个为准。被完全撤销的句子由 IR 按句切掉，装配不再加回。
- 证据：同一份真实 R5 IR，`r-ingest` 正文从 2885 字符降到 2638 字符，R1 那句 `.sha256` 不再出现（`project/.scratch/ci-assembly-check/r-ingest.sdd-mode.txt`）。
- 测试：IC 中与 SDD 相关的 Node 测试 25 项全部通过（新增“正文以变化清单开头、附有效表述”“依据段落不存在时拒绝”两项）；全部 582 项中 573 项通过，其余 8 项是测试输出目录层级不同导致的路径问题，与本改动无关。

## 第 2 组启动（同日 17:35 UTC，用户确认两组同时跑）

- 串行器 `experiments/sdd/run_ic_series.py`：每轮把这一轮的原始需求作为新的用户输入交给 IC（不拼接前几轮，跨轮由 IR 维护）→ IC 编译（管理调用上限 12 次/轮）→ 启动 SDD（同一个原流程适配器，摘要锁定）→ 回收结果（含 PRD Check 摘要）→ 按与 SDD-only 相同的晋级规则判断。每轮目录前缀为 `ic-sdd-dpipe-`。
- 运行目录：`D:/huawei/EvoCodeBench/harbor_runs/ic-sdd-dpipe-15round-20261010-173448z-deb3b414`。IC 构建在 `project/.scratch/ic-sdd-dpipe-15round-20261010-173448z-deb3b414/dist`，基于 HEAD `ccf37ec` 加上未提交的工作区改动（清单见 series.json）。

## 两组阻断后的决策与改动（同日 21:04 UTC，用户确认）

- SDD-only R5：SpecArt 返回 `SPEC_GAP`（PRD 要求根级 seed 必填，系统设计和变更说明书仍写可选，源头是 R1 遗留的 GAP-004）。**决策：SPEC_GAP 算作人工决定点**，固定规则为“本轮作废，用上一轮通过的代码进入下一轮”（`auto_spec_gap_skip`；`run_results` 识别 specart/coding verdict 中的 SPEC_GAP，`run_series.next_baseline` 取该轮的 baseline）。两组同样适用。SDD-only 新串行 `sdd-luna-dpipe-15round-20261010-210414z-49507b09` 从 R6 开始。
- IC+SDD R3：管理调用用完（IR 格式错误 6 次，均出现在第一轮带修改的输入上；CI 因 IR 未登记输入而把用户输入编号填进 `input_ids`，并被报错信息误导而 hold）。**决策：放宽 CI 的输入严格性，而不是单纯追加预算**。`input_ids`/`output_ids` 中未登记或非字符串的项被丢弃，并记录在 `ignored_ids`，不再导致整批失败；指令说明 IR 未登记时留空，且不能作为 hold 的理由。
- 修复我的 bug：回传给 IC 的 PRD Check 未关闭 GAP 只包括 `PRD_ONLY`/`MISMATCH`，不再包括 `CODE_ONLY`（R2 多出的 4 次管理调用由此引起）。
- 续跑：新增 `SddCompiler.reopen`（只能用于最新的、被拒绝且未启动的批次；从 IR 已到达的阶段继续，记录原因、追加的次数和之前的错误）和 `run_ic_series.py --resume`（重新构建 IC，同步适配器中的规则文件，改动前后的摘要写入 `series.json.resumes`）。R3 批次重新打开，追加 6 次调用，从 CI 阶段继续。

## IC+SDD R3 的 coding BLOCKED（同日 22:16 UTC，用户选 A）

- 原因：SDD 内部验证器在报告里手抄证据摘要时抄错了（`extended.go`、`main_test.go` 的证据写成 `ff1c3b…`，与两个文件的实际摘要都不符；validator 在摘要留空时本会自动填写），报告检查 SA225 两次都没通过，coding 判为 BLOCKED。构建和测试都通过了，官方 425/535。这是 SDD 自身的失败，不是适配问题。
- **决策 A**：SpecArt 的 `BLOCKED` 和 `SPEC_GAP` 一样算作人工决定点（`auto_specart_handoff_skip`）：本轮作废，下一轮从该轮的 baseline 开始，两组同样适用。识别时排除 `CAPABILITY_BLOCKED`（证明能力结果）。coding 阶段写了失败 verdict 时标为 `fail`，不再标为 `not_reached`。
- IC：`claim` 新增显式的 `previous_voided`（原因必填），这时下一轮基线必须等于作废那一轮自己的基线，并在该轮记录 `voided`。串行器续跑时会用当前规则重新判断已有轮次。IC+SDD 于 22:16 UTC 续跑，R3 作废，R4（6 次管理调用）从 R2 的代码开始。
- SDD-only 正在运行的串行用的是冻结的旧规则（只认 SPEC_GAP）。如果它遇到 BLOCKED，会先停下，再用新规则接续。

## IC 组分数低的原因与调整（同日 23:36 UTC，用户确认：只改 IC 组，SDD-only 组不动）

- **失分第一原因**：外部接口的精确名称写错。R1：filter 读 `operator`（需求为 `condition`），fill 读 `method`/`direction`（需求为 `strategy`），sort 没按 `order` 取方向。R2：profile/compare 输出键名、rollup 列布局不对，另有 R1 fill bug 的延续。CI 正文完整包含这些名称。两组的 PRD 和 SpecArt summary 都没有这些名称，原因是 SDD PRD skill 铁律 7“终稿禁止代码标识符”（为鸿蒙 App 写的，在 CLI 场景会误删可观察的接口名）。两组实现者都回头读了原文：SDD-only 那次碰巧用对，IC 组那次猜错。
- **IR 修改轮反复失败的原因**：之前独立运行 7 轮的初版 IC，IR 共 12 次调用全部格式正确；接入 SDD 后，IR 请求被改成指针压缩视图（`{from,to,text_in}`），模型照着输出缺 span/quote、带 id 的结构（R3 7 次中 6 次失败，R5 12 次全部失败）。属于推断，两边唯一的差别和报错形态都与之吻合。
- **CI 体积**：R4 CI 61370 字符，前 4 轮原文直接拼接为 57608 字符；附加信息约占 5%。SDD 每轮都重新生成 PRD，不继承上一轮，所以每轮必须提供全部有效需求。在不改 SDD 的前提下，IC 能省的只有被撤销和被取代的原文，这部分已经去掉。本次不再调整附加信息。
- **改动（只作用于 IC 组）**：
  1. IR 改回发送完整的 IR 输入（`sdd-compiler.ts`；压缩视图只保留在调用记录里，并注明未发送）。
  2. 对 IC 组冻结的 SDD 副本做最小改动（`experiments/sdd/ic_arm_sdd_patch.py`）：prd-clarify SKILL 铁律 7、prd_template 检查项、prd-fix SKILL 各追加一句例外：“命令行、数据处理等非 UI 产品的外部接口（命令与参数、输入输出文件格式、JSON 字段名与取值、输出与错误文本、退出码）属于可观察行为，原始需求写明的必须原样保留，不得改写或删除。”改动前后的摘要记录在 `series.json.sdd_patch`。`D:\sdd` 与 SDD-only 组不受影响。
- **对比口径**：PRD 规则只在 IC 组修改，两组分数差同时包含 IC 和这条规则的影响，报告中须分开说明；如需单独衡量，后续可让 SDD-only 组带同一补丁再跑。
- **新 IC 串行**：`ic-sdd-dpipe-15round-20261010-233647z-8edae855`，从 R1 开始。旧 IC 串行 `173448z-deb3b414` 停在 R5，保留作记录。

## 更正与“上一轮 PRD 作基线”交付（同日 23:57 UTC，用户确认：新 IC 跑完 R1 即切换）

- **更正**：IR 格式失败不是压缩视图造成的。改回完整请求后，新 IC 的 R1 中 IR 仍失败 6 次（用满 12 次才被接受），而旧 IC 用压缩视图的 R1 一次通过。失败主要是修改操作的结构写错（用 `id` 代替 `local_ref`、`target` 取值不对、缺 `source_coverage` 等）。属于初版 IR 格式本身的难度，每次成败有随机性，写入报告。结构化输出重试从第一版起就是 0，两边相同。处理：每轮管理调用上限 12 → 20。完整 IR 请求的改动保留（它没有变差，也没有证据显示变好）。
- **SDD 如何跨轮衔接（事实）**：PRD 只读本轮节点 1，不读上一轮 PRD；跨轮只靠代码（SD 读上一轮代码 → change → PRD check 比对 diff）。R4 只新增 4.8k 原文，SDD 却把累积的 59k 原文重新澄清成 4.7 万字的 PRD。
- **新交付方式**（IC 组，从 R2 起）：节点 1 = 变化清单 + 上一轮已接受的 PRD（取最近一次 coding 通过、且未作废的运行，去掉 VERDICT 标记行；附说明“未被下面改动的需求全部保留，应用改动后输出完整 PRD”）+ 只附本轮新增或修改的需求（按 IR revision 判断）及其有效表述 + 撤销需求清单。没有可用的 PRD 时（R1）仍交付全部原文。桥接回传 `02-澄清后PRD.md`；CI 和核对指令已同步说明。
- **续跑**：串行器在某一轮已登记 SDD 运行时不再重新启动，直接等待并回收；`--resume` 允许续跑未完成的串行。新 IC 串行在 R1 的 SDD 运行期间停下（SDD 运行是独立进程，不受影响），再用新构建续跑：R1 复用原运行，R2 起使用新交付方式。

## SDD-only 组失败归因与两处适配修复（2026-10-11 00:41 UTC，用户确认：修适配问题，从最早受影响的一轮重跑；SDD 自身问题不处理）

SDD-only R1–R10：R1 自动决定放行，R2–R4 通过，R5–R10 全部作废（各轮从 R4 代码开始，官方分数停在 600 出头）。归因：
- 适配问题（已修）：
  1. 子 agent 直接读取 skill 文件，没有 skill 工具附带的“基础目录”提示，相对路径解析错误（验证器到 `skills/specart/assets/` 下找 `verification-reference.md`、`report-schema.yaml`）。R3、R4、R6 和 IC R3 都有找不到的情况，R6 因此判为 BLOCKED。修复：`run_r1.agent_profiles` 给每个子 agent 的 prompt 补上“文件中的相对路径以 `<该文件所在目录>` 为准”。
  2. 我写的无人值守说明（“真正的矛盾……按正常状态报告”）让 PRD 把需求冲突挂起不决，R9 判失败；R10 的变更说明书直接引用 ADAPTER-CONTEXT，拒绝处理“澄清中”的 PRD。可能也影响了 R5、R7 的 SPEC_GAP。修复：改为“需求看似冲突时像认真的读者那样裁决：后来的更新覆盖它修改的部分，具体规则是一般规则的例外；记为假设并继续，只有任何解读下都没有合理实现时才报告阻塞”。
- SDD 自身问题（不处理，如实记录）：PRD 检查收敛判断只比较数量（R1）；变更说明书第 3 步“目标设计落盘”模型时做时不做、自判标准不一（R8，IC R4）；验证器手抄证据摘要出错（IC R3）；增量轮次规格作者没把旧行为约定改干净（R7）；跨轮文档矛盾（R5）；每轮从头重新澄清全部需求。
- 重跑：`run_series.py --retry-from 5 --reason ...`，R5–R10 记入 `superseded_attempts`（证据保留）。新串行 `sdd-luna-dpipe-15round-20261011-004124z-b428d7bd` 从 R5 开始（基线为 R4 代码）；仅冻结了一半、没有任何模型调用的 R11 目录已删除。
- IC 组同样采用这两处修复（`--resume` 同步 `run_r1.py` 与 `execution-context.md`）：R1 复用旧适配下的运行，R2 起生效。

## IC→SDD 交付形态收缩（2026-10-11，用户确认，另一 session 核对同意）

依据：逐轮失分对比显示 IC 组多失的分全部是接口字段名错误。字段名在 CI 里存在，是在 SDD 的 PRD 这一步被删掉的（两组都一样）。R4 的 408 分评测的是 R2 的代码。IC 交付对 SDD 唯一的系统性改变是按条目重组原文（R1 原文 8 个小节标题，CI 里只剩 1 个），没有证据表明它带来任何好处。
- 节点 1 = 累积原文，按原顺序、原结构逐字交付，与 SDD-only 组的形式相同（`sdd-compiler.ts` 中的 `accumulatedText`）。代码只删除已被接受的 IR 或当前 IR 选中过、而本次不交付的原文（撤销、取代、暂停），没被任何 IR 选中过的文字（标题、示例、衔接说明）一律保留。删除后只剩列表符号的行一并删除；整段被删时连带删掉一行空行。有效表述放在该条目第一处删除点所在段落之后，没有删除时放在其第一段原文所在段落之后。
- 每次删除都记录到 `CIDelivery.removed`（原文、早先选中它的条目、当前 IR 对它的处理），不发给 SDD；串行器另外写出 `delivered-ci-rN.removed.json`。check 请求不再重复原文，改为说明正文的构成方式，并附上 `removed`。
- 删除：按条目重组、`instruction`、`input_ids`/`output_ids`/`ignored_ids`、`change_summary`、上一轮 PRD 作基线、`ic_arm_sdd_patch`（移到 `experiments/sdd/retired/2026-10-11-ic-arm-prd-patch/`）、check 中的块指针视图。保留：`effective` 及其依据校验、`reopen`、`previous_voided`。
- 真实回放（`.scratch/ic-sdd-shrink-test/replay.mjs`，五个 IC 串行的 store）：所有已接受的 R1、R2 与 SDD-only 的输入逐字节一致；173448z 的 R3、R4 只删了 2 句（zscore 改为样本标准差、linear fill 缺锚点规则），有效表述紧跟在原段落之后。
- 口径：字段名丢失两组都有，本方案不解决，SDD 也不能改。IC 组能拉开的差距只来自删除已撤销的原文和原位附有效表述，主要体现在需求反复修改的轮次。新的 CI/check 指令还没有经过真实模型调用。
- 改动文件（相对接手前工作区）：`src/core/sdd-compiler.ts`（+104 −84）、`src/core/sdd-contract.ts`（+20 −9）、`src/core/sdd-context.ts`（+6 −38）、`src/model/sdd-model.ts`（+8 −8）、`test/sdd-compiler.test.ts`（+8 −40）、`test/sdd-context.test.ts`（+49 −42）、`experiments/sdd/run_ic_series.py`（+3 −4）；`experiments/sdd/ic_arm_sdd_patch.py` 移到 `experiments/sdd/retired/2026-10-11-ic-arm-prd-patch/`，内容未改。IR、`reopen`、`previous_voided`、`prd_check` 回传和 SDD 适配器都没改，`D:\sdd` 和 SDD-only 串行也没碰。
- 验证：SDD 相关 Node 测试 30/30 通过；全量 577 通过，9 项失败都是测试从 `.scratch` 目录运行导致的路径问题；`experiments/sdd` 的 Python 测试 61 项通过（`PYTHONPATH=../../.scratch/sdd-phase1-deps PYTHONUTF8=1 python -m pytest -q -p no:cacheprovider test_*.py`）。R4 两处删除与当前 assigned 条目原文范围的重叠，只有行首的 `- ` 和行尾换行，没有删到有效原文。
- 审阅结论（另一 session）：可以按此方案跑。IR 格式失败的三个办法（补全 quote/span、受约束解码、改进重试）本实验都不做，靠调用上限 20 和 reopen 追加 6 次兜底，报告里要记录每轮 IR 的调用次数和失败次数。旧 IC 串行 `010247z` 由另一 session 在 R2 结束后停掉；确认它已停止后，用新代码从 R1 新起一条 IC 串行，trial 前缀不变。

## 用户原则与夜间授权（2026-10-11 约 00:30 UTC-4，用户确认）

- **原则**：SDD 核心逻辑不动，由 IC 去适配 SDD。遇到问题只能优化 IC，不得删除、绕过或弱化 IC 功能，也不问用户"要不要删"。现有的 IR、CI（删作废句 + 原位附有效表述）、check、reopen、previous_voided 都必须保留。回头看，此前为适配而删减 IC 功能的做法不对。
- **实验目的**：看理想情况下系统的正确性上限，所以作废的轮次允许重跑。
- **IC 串行 `025821z` 停止，新起 `035602z`**：`025821z` 的 R1 因 coding SPEC_GAP 作废（127/219），R2 只能从空目录开始。而 SDD-only 组的 R1 是从多次尝试中选出的 140810z（217/219）。用户决定 IC 组 R1 重跑：`025821z` 在 R2 运行中被停止，未评测；用同一份代码新起 `ic-sdd-dpipe-15round-20261011-035602z-6814730c`。

## 作废重跑与 CI 报错改进（同日 00:38，未删减任何 IC 功能）

- **作废重跑**（`run_ic_series.py`）：某一轮被判 `auto_void_round` 时，用同一份 CI、同一个基线重跑，含首次最多 3 次（`MAX_ATTEMPTS`）。重跑不发生 IC 管理调用。仍作废时，按原晋级规则进入下一轮。每次被取代的尝试都记入该轮 `attempts`：trial、execution_id、晋级方式、规则、停止阶段、SDD 状态、官方分、耗时，以及被哪次运行取代。续跑由 `split_resumed` 处理：会重新进入还没用满次数的作废轮次。
- **IC 存储新增"作废后重跑"**：`SddCompiler.claim` 增加 `retryVoided` 参数。重跑的前提是：同一条用户输入的最新一次运行已经返回，并且基线与上次相同。新运行的 id 为 `<原 id>-attemptN`，记录 `retry_of`，上一次运行标为 `voided`。CLI 的 `start` 命令接受 `retry_voided`；`historyView` 取同一份 CI 的最新一次运行。这是为了让作废的轮次能重跑才新增的，不是新的功能概念。
- **CI 报错更具体**：disposition 检查仍保留，遗漏仍然拒绝。报错里现在会列出漏掉或多出的 `item_id`，以及完整的条目清单；任务不全时列出期望和实际的 `task_id`。这些报错会经 `issues` 回传给下一次 CI 调用（R1 新代码首次真实运行时，CI 连续 2 次漏给 disposition）。
- **测试**：SDD 相关 Node 测试 32/32 通过（新增 2 项：重跑、报错列出 id）；全量 579 通过，9 项失败与之前相同，都是路径问题；`experiments/sdd` 的 Python 测试 66 项通过（新增 `test_ic_series.py` 5 项）。
- **续跑**：`run_ic_series.py --resume …035602z…`（resume1），复用正在运行的 R1（`ic-sdd-dpipe-r1-20261011-035733z-5a0d0e5d`），IC 使用新构建 `.scratch/…035602z…-resume1/dist`。

## R1 失分的全局分析与 CI 验收示例（2026-10-11 约 01:00–01:45 UTC-4，新增 IC 功能，未删减任何 IC 功能）

- **全局分析**（同一份 R1 需求，16 次运行：SDD-only 10 次、IC 6 次；运行目录在 `harbor_runs/`，逐次看 `official-verifier.log` 和代码）：
  - **A 接口参数键没按原文实现（主因，两组都有）**：IC 173551 的 filter 读 `operator`、fill 读 `method`；IC 030147 的 derive 读 `as`（原文用 `name`）；IC 035733 的 `primary_key` 没写 JSON 标签，ingest 26 项 + pipeline 4 项全挂；IC 044344 从 `type` 读操作名（原文用 `op`），整个 transform 失效，66/219；SDD-only 050 的 window 读 `name`（原文用 `as`）。
  - **B 整块功能写成"未实现"**：IC 234229。
  - **C PRD 自加的假设与原文冲突**：约 10 次运行把 `MISMATCH expected=<> actual=<>` 改成 `ERROR: invalid checksum`，每次挂 verify 2 项。
  - **D 构建失败**：0 分的那两次。
- **SDD 的通道**（已核实）：只有 prd-clarify 读节点 1；下游各阶段都只看 PRD。PRD 按功能粒度写，单个操作的参数键不在这个粒度内（`condition`、`strategy`、`expression` 在所有 PRD 里几乎都是 0 次），下游代理只能自己翻原文，碰运气。ic_arm_sdd_patch 的规则 7 例外已确认无效，不恢复。
- **新增**：`DeliveryDraft.acceptance`，即每个命令和每个操作的验收示例（`subject`，以及 `examples[{given, expect}]`）。
  - 由模型从原文提取，代码组装为节点 1 开头的 `# Acceptance examples` 一节，原文仍逐字保留在后面。
  - 示例的输入要写出命令行和所读文件的完整内容，用原文的键；期望要给具体值，以及原文写明的固定文本和退出码。
  - 代码从示例输入里读出每个 `"key":`，要求它以 `"key"` 或 `` `key` `` 的形式出现在当前交付的原文里；不在原文的、或只出现在被删作废原文里的，拒绝并逐项报错。
  - check 核对：有无遗漏的命令或操作、有无已作废内容、期望是否违背原文或编造行为。
- **设计迭代**（真实 R1 IR 副本，`.scratch/ic-acceptance-probe/`）：
  - 起初让模型自己标出每个字面量在哪一段原文，7 次 CI 全被拒，原因是段落标错、把示例自编的值当成原文、把带占位符的命令格式当字面量。
  - 改为由代码定位字面量后，仍有 7 次被拒，原因是模型维护的字面量清单不可靠。
  - 改为由代码从示例输入读取 JSON 键之后，5 次调用通过（CI 被拒 1 次：任务 id 写进了 coverage；check 拦下 1 条编造的行为：要求没有拒收行时也生成 `.rejected` 文件）。
  - 结果：24 个主题，示例一节约 1.2 万字符，`primary_key`、`columns`、`condition`、`strategy`、`as`、`name`、`order`、`MISMATCH expected=` 都在。
- **低成本验证进行中**：用新的节点 1 只跑 prd-clarify，3 次（`harbor_runs/ic-prdprobe-dpipe-r1-20261011-0532*`），与旧 PRD 的参数键保留情况对比。保留率明显提高，才从 R1 起新串行。

## 停止旧串行 `035602z` 与新的重跑规则（同日，用户经配对 session 要求）

- **停止**：`035602z` 在 R1 第 3 次尝试（`050748z`）运行中被停，未评测；旧 CI 前两次尝试是 188 和 66。停止原因已写入它的 `series.log`。
- **重跑规则**（`run_ic_series.py`，取代"最多 3 次"）：
  - 每轮最多 2 次尝试（`MAX_ATTEMPTS = 2`）。
  - 官方通过率 ≥90% 且本轮作废：同一份 CI、同一基线重跑 1 次，报告其中较好的一次（`keep_better`）。
  - 通过率 <90%（不论是否作废）：串行暂停（状态 `paused_low_score`），诊断根因。修好后用 `--resume … --retry-paused` 重跑该轮一次；属于 SDD 自身、IC 无从影响的，用 `--resume` 保留该轮结果、继续下一轮。同一轮修过一次仍 <90%，按晋级规则继续。
  - 已知限制：`--retry-paused` 复用该轮已接受的 CI。如果修复需要改该轮的 CI，要另行处理，届时记录。
- **测试**：SDD 相关 Node 测试 34/34 通过；全量 581 通过、9 项失败与之前相同；`experiments/sdd` 的 Python 测试 66 项通过。

## prd-clarify 探针第 1 批与字段字典（同日约 05:30–05:50 UTC，新增 IC 功能，未删减任何 IC 功能）

- **第 1 批**（仅含验收示例的节点 1，`harbor_runs/ic-prdprobe-dpipe-r1-20261011-0532*`，3 次）：参数键在 PRD 中的保留情况**没有改善**。`condition`、`strategy`、`order`、`name`、`expression` 仍是 0 次，与旧 PRD（234229z、005453z、035733z）相同；3 份里有 2 份仍有 `invalid checksum`。
  - 变化：示例的语义和具体值进了 PRD 的验收要点（15～19 处"验收示例"引用，有的注明原文行号，旧 PRD 一处都没有），但 JSON 键在转写成业务语言时被去掉了。
  - 按约定没有起串行。
- **原因**：PRD 模板只在第 7 节"接口与数据"（请求关键字段、数据对象 / 字段字典）留了写标识符的位置。新 PRD 的第 7 节确实保留了 schema 的 `columns`、`primary_key` 和 manifest 字段，但 recipe 各操作的参数统一被写成"recipe 操作数组"。
- **新增 `DeliveryDraft.fields`**：按 PRD 第 7 节的格式（字段、类型、必填、含义）写字段字典，每个命令（含命令行选项）、每种文件或配置、每个参数不同的操作各一个对象。组装成节点 1 开头的 `# Interface and data: field dictionary`，放在验收示例之前。代码核对每个字段名在当前原文里以 `"字段"`、`` `字段` `` 或 `--选项` 的形式出现；不在原文的、只在作废原文里出现的，都拒绝。check 核对有无遗漏、有无作废内容。
- **区分对错的示例**：指令要求，凡是原文规则已经覆盖、但容易被"假设"改写的边界输入（意外、无效、空或不匹配的输入），都给出按原文规则得出的示例。针对 C 类。
- **迭代**：第一版模型给 CSV 数据、摘要文本这类没有具名字段的东西也建对象，被拒到预算用完。指令写明"原文没给名字的不是字段"之后，一次通过（CI、check 各 1 次）：23 个对象、14 个示例主题，契约部分约 1.9 万字符。
- **测试**：SDD 相关 Node 测试 35/35 通过；全量 582 通过，9 项失败与之前相同。
- **第 2 批探针**：`ic-prdprobe-dpipe-r1-20261011-0549*`，3 次，进行中。
- **第 2 批结果**（字段字典 + 验收示例，`ic-prdprobe-dpipe-r1-20261011-0549*`）：**3/3 明显改善**。
  - PRD 中 `condition` 2/2/2、`strategy` 1/1/1、`order` 2/2/2、`name` 3/2/4、`as` 4/2/2、`expression` 1/1/1、`primary_key` 4/2/3 次；旧 PRD 的前五个几乎都是 0。第 7 节表格行数分别为 7、58、55。
  - C 类只部分解决：3 份中有 2 份仍自加"checksum 格式不合法报 `ERROR: invalid checksum`"的【假设】。CI 的 verify 不一致示例用的是格式合法、值不同的摘要，没有覆盖非法内容这种边界。不参照测试专门补 verify，保留通用指令，如实记录。
- **新串行**：`ic-sdd-dpipe-15round-20261011-055445z-f491349c`，01:54（UTC-4）从 R1 开始，用当前全部改动（验收示例、字段字典、新重跑规则）。R1 的 IC 用 5 次调用，CI 41775 字符。旧串行 `035602z` 已停止并保留作记录。

## 官方结果解析缺陷（同日 04:45 UTC-4，适配问题，未删减任何 IC 功能）

- **观察**：新串行 R2 第 1 次尝试（`ic-sdd-dpipe-r2-20261011-072129z-0c4b3753`）SDD 判 pass，验证器汇总 481 项、通过 462；但我们的解析器只读到 480 条，判为 `incomplete_results`，整轮作废，并按 ≥90% 规则自动启动了第 2 次尝试（`…084533z-12be328d`）。
- **原因**：dpipe 输出 `PIPELINE OK: 1 steps completed` 时没有换行，验证器的 c403 结果行（通过）接在同一行；`run_results.official_result` 只认行首的 `CASE_RESULT`，漏掉了它。
- **修复**：正则不再锚定行首；新增测试 `test_official_case_after_output_without_newline_is_counted`；Python 测试 67 项通过。用修复后的解析器重读第 1 次尝试：`evaluated`，462/481。
- **续跑**：resume1 只停了控制器，接上正在跑的第 2 次尝试，计分用新解析器。第 1 次尝试实际是正常通过的；如果第 2 次被判作废，需要处理"采用第 1 次结果"，并保持 IC 存储里运行记录的一致。届时再定，写在这里。
- **SDD-only 组**：它用的是自己冻结的旧解析器，可能有同类误判。按约定不碰它的串行；写报告时，两组的分数都用修复后的解析器从 `official-verifier.log` 重新读取，并注明。
- **后续（05:06–05:10）**：第 2 次尝试 228/481（47.4%），串行按规则暂停。诊断如下：
  - 这次重跑完全是解析缺陷误触发的：第 1 次尝试用修复后的解析器重读，是 SDD pass、462/481（96%），本该直接晋级。
  - 第 2 次尝试的 SDD 只跑了约 20 分钟，失分集中在 R2 新增的功能：profile 是"unknown command"，deduplicate、split、normalize、hash 等新操作都没实现，属于 B 类。这是 SDD 自身的问题，与本轮晋级无关。
  - **处理**：采用第 1 次尝试作为 R2 的结果。
    - IC 存储新增 `SddCompiler.adopt(runId, reason)`，CLI 命令为 `adopt`：同一条用户输入下，指定一次较早的、已返回的运行作为本轮结果，清除它的作废标记，后面的尝试标记为 `superseded`。下一轮登记时，"上一次运行"按未被取代的最新一次算；`historyView`、`feedbackView` 都排除被取代的尝试。新增测试 1 项，SDD 相关 Node 测试 36/36，全量 583 通过、9 项失败与之前相同。
    - `series-results.json` 的 R2 记录改为采用第 1 次：官方分用修复后的解析器重读，记录 `official_reread`；第 2 次放入 `attempts`，注明 `superseded_reason`。改动前已备份为 `series-results.before-adopt.json`、`store/ci-sdd.before-adopt.json`。
  - **续跑**：resume2，从 R3 开始，R3 以 R2 第 1 次尝试的代码为起点。

## R3 的 CI 预算耗尽与修复（同日 05:31 UTC-4，改进 IC，未删减任何 IC 功能）

- **观察**：R3 用完了 20 次管理调用。IR 5 次（前 4 次格式错，第 5 次通过）。CI 和 check 共 14 次：
  - 4 次因字段字典里出现空对象（CSV 数据、摘要文本）被拒；
  - 4 次因重复被拒（"Duplicate effective statement" 3 次、"Duplicate field of …" 1 次），报错没说是哪一项，模型原样再错；
  - 1 次 schema 缺字段；
  - check 3 次给出真实问题（字段字典漏了 drift 命令、示例数值算错）。
  串行中断（BLOCKED）。
- **修复**：
  - 没有字段的字典对象由代码略去，记入 `CIDelivery.field_objects_left_out`，不再拒绝；
  - `unique` 的报错写明重复的值，并提示合并为一条；
  - 每轮管理调用上限 20 → 30，续跑时重新打开的预算 6 → 10（CI 增加了字段字典和验收示例，调用更多）。
- **测试**：新增 1 项，SDD 相关 Node 测试 37/37；全量 584 通过，9 项失败与之前相同；Python 67 项通过。
- **续跑**：resume3，重新打开 R3 批次，追加 10 次调用，从 CI 阶段继续。
- **resume3 后仍失败**（05:48）：追加的 10 次又用完了。
  - 每次 CI 漏的命令和字段都不同（drift、resample、watermark、having 内部的 `column`……），check 每次都抓到新的遗漏；
  - 模型反复编造配置键 `tolerance`、`ignore`，原文只写了命令行选项 `--tolerance`、`--ignore`；
  - 合法的嵌套重名（aggregate 外层与 having 内的 `column`）被当成重复拒绝。
- **根因**：要求模型一次写出完整的大字典，再由 check 逐项查完整性，随着需求累积，这条路走不通。
- **修复**（"确定性的部分由代码补"）：
  - `completeFields`：代码读出交付原文里所有 JSON 键（`"key":`）和命令行选项（`--opt`），模型字典没列的，追加到 `Other names the requirements write (listed by code)` 一节，记入 `CIDelivery.field_names_added`；同一对象内的重名行合并；没有字段的对象略去。
  - check 指令：名字是否完整由代码负责，check 不再因遗漏退回，只核对描述、归属和是否作废。
  - 编造字段的报错，在原文有对应 `--选项` 时写明该选项。
  - 新增测试 2 项，SDD 相关 Node 测试 39/39，全量 586 通过、9 项失败与之前相同。
- **续跑**：resume4，R3 重新打开，追加 10 次。
- **resume4 后仍失败**（06:02）：追加的 10 次又用完了。名字遗漏已不再阻断，但 check 每次都指出不同的问题：字段放错了对象（`rejection_reason`）、linear fill 示例期望值算错、pipeline 的 `type` 漏了 `drift`；另外模型把一串名字塞进一个字段。
- **根因**：CI 每次返修都从头重写整份交付，修好被指出的地方，又在别处引入新错，无法收敛。
- **修复**：
  - 每次 CI 回答解码成功后存为 `SddBatch.last_draft`；
  - 返修时，`DeliveryRequest.previous_draft` 带上这版草稿，`issues` 带上问题，指令要求只改被指出的地方，其余保持不变；
  - `reopen` 保留最后一次被拒的原因作为问题，不再清空（只清掉"预算用完"这条）；
  - 修复 IR 时一并清掉 `last_draft`。
  - 新增测试 1 项，SDD 相关 Node 测试 40/40，全量 587 通过、9 项失败与之前相同。
- **续跑**：resume5，R3 第一次 CI 仍是全新生成，因为旧批次里还没有 `last_draft`；之后的返修都基于上一版草稿。
- **resume5 收敛**：R3 的 CI 基于上一版草稿返修，4 次返修各修一处 check 指出的问题（pipeline 示例前提、drift 数值、linear fill 数值），没有引入新错误，第 5 次 check 通过。R3 累计用了 48 次管理调用，CI 正文 112964 字符。06:14 交给 SDD。

## R3 暂停（07:04，86.9%）：判为 SDD 自身问题，按规则继续

- **结果**：465/535，SDD not_passed。design 判 `fail_or_missing_design_gate`，coding 和 prd 都没有执行。官方状态 `build_failed`，来自我们要求的构建命令 `go build && go test`（SDD 写的单元测试没过）；验证器自己的构建检查 c001 是通过的，465 项都实际运行了。
- **根因**：SpecArt 判 `SPEC_GAP`："compareFiles 函数体内局部 change.Key 的 JSON object 声明需修改既有函数体，触发 SA183"，即 Go 适配禁止修改已有函数体，coding 没有执行。官方测的是 R2 的代码。
- **失分对比**：
  - 两组相同的约 36 项：sample 13、rollup 10、fill 6、normalize 4、watermark 3，与 SDD-only R3 完全一致；
  - IC 组多出的：drift 21 + pipeline drift 2（R3 新功能没写）、compare 7（对应的改动没做）、verify 2（C 类）。
- **归类**：SDD 自身问题。SDD-only 组同一轮用同一个校验器，设计顺利通过；IC 无从影响。不重跑，按晋级规则作废 R3，R4 从 R3 的起点（R2 代码）继续（resume6）。
- **待报告说明**：如果改校验器，就是改 SDD 侧的东西，而且两组会不对称，所以不改。

## 有效表述被误用（07:10，改进 IC，未删减任何 IC 功能）

- **观察**：R4 的 CI 正文（93203 字符）中，原文部分 78722 字符，而 4 轮原文累积只有 57726 字符。查明原因是 CI 模型把有效表述当成了"复述整段需求"：R2/R3/R4 分别有 11/14/7 条，共约 4.3 万/4.4 万/2.1 万字符，基本都写在只来自一轮输入、从未被修改的需求上（R2 11/11、R3 14/15、R4 7/7）。R3 还在有效表述里重新写出了已被删除的 zscore "总体标准差"那句，等于抵消了删除。R3 本身因 SDD 自身原因作废，未受影响；R4 的有效表述没有带回作废句，仅仅是重复，所以 R4 照常运行。
- **修复**（代码执行原有定义）：
  - 有效表述只允许写在原文来自不止一轮输入的需求上，否则拒绝，报错写明是哪条需求、只来自哪一轮输入；
  - 有效表述里不得出现本次交付已删除的原文（长度 ≥20 的删除段），否则拒绝，报错写明是哪一句。
  - 两条现有测试按新规则改写；SDD 相关 Node 测试 40/40，全量 587 通过、9 项失败与之前相同。第二条规则没有专门的单元测试。
- **续跑**：resume7 只重启控制器，接上正在跑的 R4（不受影响），新规则从 R5 起生效。

## 停止串行 055445z 与整体修改（2026-10-11 07:14 起，用户经配对 session 确认，全部是新增或加强，未删减任何 IC 功能）

- **停止**：07:14 按用户要求停掉 IC 串行 `055445z`（R4 运行中停，未评测），用于做整体分析。夜里是撞上一个问题就修一处、再追加预算续跑（R3 续跑 4 次、48 次调用），违反了"先整体分析、定方向，再改"的原则。
- **整体修改**：
  1. **CI 增量化**（`src/core/sdd-increment.ts`）：
     - 字段对象和示例主题都带 `items`（IR 条目 id）；代码校验 id 存在，并记录对应的修订号（`CIDelivery.contract`）。
     - 下一轮，条目未变的对象、主题和有效表述由代码原样沿用；条目被撤销的去掉并记录；条目被修改或不再交付的不沿用，由模型重写。
     - `DeliveryRequest` 增加 `to_write` 和 `carried`（只给名称）。模型只为 `to_write` 写；新写的条目必须至少涉及一个 `to_write` 条目，且不得与沿用的条目重名。
  2. **请求瘦身**：CI 和 check 只附本轮新输入全文，以及 `to_write` 条目、被删段落、新写有效表述所涉及的原文；其余需求只给 id，正文用占位符代替。history 不再带上一轮有效表述的正文和运行产物的正文；check 中沿用的条目只给名称。IR 阶段不变。
  3. **有效表述由代码把关**：
     - 只能用于 `to_write` 中、原文来自多次输入的需求，且 `basis` 要包含比最早出处更晚的输入；
     - 与原文重复达 60% 以上的拒收，报错写明不需要有效表述；
     - 不得带回已删除的原文；
     - 未变需求的有效表述由代码沿用。
  4. **示例期望值**：只写原文明确给出的值、固定文本和退出码；原文没给的，用文字写规则，不自行计算。
  5. **check 分轻重**：finding 增加 `severity`，取值 blocking 或 note。只有四类算 blocking：编造原文没有的名字或行为、混入作废或暂停的内容、与原文矛盾、删错原文。只有证据可核实的 blocking 才退回，note 只记录。
  6. **调用上限**：每轮 15 次，用完即停（BLOCKED）。续跑不再自动追加，只有显式 `--reopen N` 才追加。
  7. **重跑规则**：上游校验器的 SPEC_GAP（SpecArt 阶段）即使低于 90%，也用同一份 CI 重跑 1 次（`upstream_spec_gap`）。
- **测试**：SDD 相关 Node 测试 42/42（新增"沿用、撤销、修订、暂停"和"note 不退回"两项）；全量 589 通过，9 项失败与之前相同；Python 68/68。

## 回放结果（`.scratch/ic-replay-incr/`，用 R1–R4 的输入在新存储上只跑 IC，不跑 SDD；对照为串行 055445z 的同轮数据）

| 轮 | 调用（旧） | IR 调用/失败 | CI 调用/失败 | check 调用/失败 | CI 请求字符（旧） | check 请求字符（旧） | 交付体（旧） | 其中原文 / 原文累计 | 字段+示例 | 沿用/新写 对象、主题 |
|---|---|---|---|---|---|---|---|---|---|---|
| R1 | 7（5） | 2/1 | 4/3 | 1/0 | 26–50k（25–27k） | 85k（64–66k） | 37178（41775） | 18805 / 18805 | 18348 | 0/20、0/18 |
| R2 | 3（11） | 1/0 | 1/0 | 1/0 | 45k（96k） | 107k（157–207k） | 79260（118169） | 43435 / 43435 | 35800 | 20/16、18/14 |
| R3 | 11（48） | 9/8 | 1/0 | 1/0 | 90k（174k） | 146k（206–240k） | 88238（112964） | 53206 / 52901 | 35007 | 28/13、25/1 |
| R4 | 9（4） | 7/6 | 1/0 | 1/0 | 124k（164k） | 175k（214k） | 100236（93203） | 58006 / 57701 | 42205 | 41/6、26/4 |

- **有效表述**：R3 2 段，R4 沿用这 2 段，共 405 字符，都是新写的话，没有照抄原文：
  - zscore 改用样本标准差（n−1）；
  - linear fill 在只有一个锚点时用该锚点填充。

  原文部分只比原文累计多出这 405 字符，没有整段重复（旧版 R2/R3 有 4.3 万字符的照抄）。
- **删除**：R3、R4 都是 2 处（zscore 总体标准差、linear fill 缺锚点留空），与 IR 判断一致。
- **关键参数键**：契约部分各轮都齐全，`condition` 4、`strategy` 3–6、`order` 4、`name` 9–11、`as` 4–20、`expression` 4–7、`primary_key` 2，`MISMATCH expected=` 1。
- **check**：每轮 1 次通过，blocking 都是 0；note 共 2 条（R1：aggregate 中 `column` 的说明没提 having 里的同名键；R3：删除第 4 步后编号从 3 跳到 5）。
- **R1 的 CI 失败 3 次**：模型把子命令名 `pipeline`、`dpipe pipeline` 当作字段写进字段字典，被代码拒收。
- **达标情况**：
  - 交付体没有整段重复 ✓（但字段和示例约 3.5–4.2 万字符，交付体约为原文累计的 1.7 倍）；
  - CI 和 check 请求字符明显下降 ✓（R1 例外：返修时带上一版草稿，请求变大）；
  - 关键参数键齐全 ✓；
  - check 通过 ✓；
  - **R2–R4 每轮调用 ≤8：未达标**。R3 是 11 次、R4 是 9 次，超出部分都来自 IR 的格式失败：R3 中 IR 9 次调用失败 8 次，R4 中 7 次失败 6 次，错误仍是修改操作写成 `id` 而非 `local_ref`、`action` 取值不对等初版格式问题。CI 和 check 在 R2–R4 每轮各 1 次。按约定 IR 阶段维持现状，未修改；回放数据交另一 session 审阅。

## 审阅后的两项（同日，离线完成，不花 SDD 成本，未删减任何 IC 功能）

### 1. IR 形状的确定性规范化（`src/core/sdd-ir-normalize.ts`，接入 `SddCompiler.advance` 的 IR 阶段）

- **先拆清真实缺陷**：58 次失败的 IR 答案，按 `action` 和 `target` 对准各自的 schema 分支后发现，"缺 local_ref / 多 id / action 只能是 create"这类报错，大多是 anyOf 各分支的噪声。真实的形状问题主要是以下几种：
  - 用可空 `source_ref` 的位置漏写可空的定位键（`quote`、`segment_id`、`span`），即 task、binding、output、current_scope 的 create 和 revise，以及 retire、preserve、`source_coverage`；
  - `source_coverage` 写在了 group 里；
  - `questions` 写在了顶层，或者 group 缺 `questions`；
  - revise 操作在 `id` 之外多写了 `local_ref`；
  - edit 操作多写了 `sources`。
- **规范化规则**（只处理有唯一映射的情况）：
  - 漏写的可空定位键补 null。只作用于可空的 `source_ref`；content 的 create、revise 和 edit 用的是"引文或段落"形式，保持原样。
  - 答案顶层没有 `source_coverage` 时，把 group 里的挪上来。
  - 只有一个 group 时，顶层的 `questions` 挪进该 group。
  - group 缺 `questions` 时补 `[]`。
  - revise、retire、edit 操作有 `id` 时，去掉多余的 `local_ref`。
  - edit 已有 `basis` 时去掉 `sources`；没有 `basis` 时把 `sources` 当作 `basis`。
  - 其余情况（多 group 时顶层的 `questions`、修改操作被写成 group、缺 `action`、类型错误等）照旧拒收。
- **重新校验**：规范化后的答案走原有的完整路径重新校验（`reproposeNormalized`：strict schema → `createCompilerModelV2` 的代码校验 → `prepareIntentIR` 的来源与语义检查）。每处改动都记入 `calls[].normalized`（路径、原值、新值、依据），原始文本保留在 `call.normalized_from`。
- **离线验证**（`.scratch/ic-replay-incr/ir_normalize_check.mjs`，回放存储和 5 个旧串行，共 56 个有原始输出的失败答案）：
  - 18 个变为通过；
  - 27 个仍失败，主要是语义问题："本轮输入有段落没有去处"9 次、来源解析不上 3 次、group 身份重复 2 次等，另有少数有歧义的形状问题；
  - 11 个没有可规范化之处。
  - 通过的答案中，规范化共涉及：补 null 62 处、去掉 `local_ref` 2 处、挪动 `source_coverage` 2 处。
- **抽查**（`ir_spot.mjs`）：补 null 的引用里，模型本来就给了 `quote` 或 `segment_id`；规范化只是把可空键写全，通过的答案都经过了来源解析，没有发现语义错误。
- **单元测试 1 项**：规范化范围，以及歧义情况保持原样。

### 2. check 请求瘦身

- **R4 check 请求组成**（瘦身前 175172 字符）：`referenced_objects` 87325（IR 条目通过 about、support 引用的历史对象，全文都附上了）；`delivery.contract` 19776 与 `delivery.draft` 11487 中，新写的条目重复了一份；IR 29508；`ir_update` 9361。
- **改法**：
  - `referenced_objects` 按同样的瘦身规则处理，不在显示范围内的条目正文用占位符代替，CI 和 check 都适用；
  - check 中的 `delivery.contract` 只给名称和 carried 标记，新写条目的全文只在 `delivery.draft` 里出现。
- **重建请求后的字符数**（`check_size.mjs`，不调用模型）：

  | 轮 | check 请求 | CI 请求 |
  |---|---|---|
  | R1 | 84872 → 65389 | 不变 |
  | R2 | 106733 → 86905 | 不变 |
  | R3 | 145842 → 115324 | 90136 → 70800 |
  | R4 | 175172 → 102684 | 123606 → 52508 |

### 3. 新串行保留 R1 的实现

- 串行器新增 `--adopt-r1 <试跑目录>`。R1 照常用新代码编译 IC（得到新格式的契约，供 R2 沿用），SDD 不重跑，采用该试跑：
  - CLI 新增 `claim-adopted`：登记运行，绑定到已有目录，不准备、不启动；
  - CLI 新增 `receive`：交回结果；
  - 桥接层新增 `ic_bridge.adopted_result`：按 collect 的同一套逻辑读取结果，不修改旧试跑目录。
- 记录写明：所采用运行当时拿到的是旧版 CI，记录其节点 1 的 sha256，以及本串行 R1 的 CI 字符数。
- 在回放存储的副本上离线演练通过（`.scratch/ic-adopt-dry`）：运行状态为 returned，SDD pass，design、coding、prd 三个阶段均为 pass。
- **测试**：SDD 相关 Node 测试 43/43，全量 590 通过、9 项失败与之前相同；Python 68/68。

## 抓手 2、3：可执行示例与失败账本（同日 11:00 起，离线设计与验证，没有接入正在跑的串行 121044z，未删减任何 IC 功能）

- **实现**（均为新增）：
  - **可执行示例**：`AcceptanceExample` 增加 `run`（args、files、stdin）和 `check`（exit_code、stdout_exact、stdout_contains、stderr_contains、files）。
  - **可判定性与断言**（`src/core/sdd-examples.ts`，代码负责）：期望里的每个值都必须出自当前交付原文——要么逐字出现，要么符合原文里带 `<占位符>` 或独立 `N` 的固定文本模板（占位符作通配，模板去掉占位符后至少保留 8 个固定字符，优先用最具体的模板）。退出码必须是原文写明的。
    - 断言里的输出流以原文所在那一行为准：写了 stderr 就查 stderr，写了 stdout 就查 stdout，没写就两者都接受，不采用模型的选择。
    - 不满足的示例标为不可判定，只保留文字形式。
  - **执行器**（`experiments/sdd/example_runner.py`）：在 docker 里断网（--network none），用同一镜像编译，逐条运行，不修改原代码目录。
  - **桥接层**：`ic_bridge` 在 SDD 返回时，以及采用已有运行时，都执行该交付中可判定的示例，结果写入 `SddResult.example_results`。
  - **失败账本**（`src/core/sdd-ledger.ts`，由代码从存储计算，不计入作废和被取代的运行）：示例失败则打开，通过则关闭；PRD 检查遗留的差异也计入；条目被撤销或修订则移除。结果记入 `CIDelivery.ledger`；仍打开的条目由代码追加为 CI 中的一节"Existing requirements the current code does not yet meet"。
  - **测试**：SDD 相关 Node 测试 46/46（新增可判定性、无效模板、账本三项）；Python 68/68。
- **CI 写可执行示例的回放**（`.scratch/ic-replay-exec`，只调用 IC）：
  - 调用次数：R1 7、R2 4、R3 4、R4 4；
  - 示例数与可判定数：R1 11/3、R2 32/8、R3 38/7、R4 50/18。
  - 指令前后改过两次：第一次模型全部给 null；第二次 R1 有 28 个示例，其中 6 个可判定。生成结果不稳定，数量偏少。
- **离线验证**（`validate.py`，在 docker 里执行，不调用模型；R4 之后各轮都用 R4 的契约）：

  | 代码 | 可判定示例 | 失败 |
  |---|---|---|
  | SDD-only R1–R3 | 3 / 8 / 7 | 0 |
  | SDD-only R4–R13 | 每轮 18 | 0 |
  | IC R1（采用的 055743z） | 3 | 0 |
  | IC R2 第 1、2 次尝试 | 8 | 各 1 |

  - 唯一的失败是 compare 缺 `--key`：原文要求 `ERROR: --key is required`，代码输出 `ERROR: invalid arguments: compare: missing --key`，是真缺陷。
- **误报核对**：
  - 修正前共有 8 条失败，其中 6 条是误报：示例把输出流放错 4 条（原文写的是 stderr，或没有指定）；占位符里填了模型推算的行号 1 条（validate unique）；示例输入写错 1 条（用空行冒充空值）。
  - 前两类已由代码按原文纠正（输出流以原文为准，占位符作通配）；第三类的期望值不是原文逐字给出的，现在判为不可判定。
  - 另外发现并修复了一个空洞模板的问题：只含占位符的片段（如 `<path>`）生成的模式能匹配任何内容，现在要求至少 8 个固定字符。
  - 目前误报 0/2。由于失败样本只有 2 条，达不到"至少抽查 15 条"的要求。
- **检出能力不足**：
  - SDD-only 各轮持续失分的类别（sample、rollup、fill、normalize、watermark、drift、compare 等）一条都没抓到。原文对这些行为没有写出确切的输出，而 CI 写出的可判定示例又集中在报错文本和退出码上。
  - verify 的缺陷（R2 第 2 次尝试把非法内容的 checksum 报成 `ERROR: invalid checksum`）也没抓到，缺少"内容不是合法摘要"这样的区分性示例。
- **追加章节的开销估计**：每条打开的条目约 1–1.5k 字符（主题、原文最多 400 字符、示例、实际表现）；章节由代码生成，不增加 IC 调用。每次 SDD 返回时，示例执行约 1–2 分钟。
- **抓手 1**（IC 依据 SDD 自身产出判断是否重跑）：尚未实施，优先级低于抓手 2。harness 层按官方分的重跑规则保留不变。

## 下一版 IC 改进批次（2026-10-11 下午，来自 R2/R3 逐环归因；离线完成，串行 121044z 不切换、不动）

- **工作方式**（用户经配对 session 确认）：121044z 不切换版本，一直跑到 R15，作为证据来源。IC 的改进只来自逐轮归因，攒成一批统一做；离线回放验证后单独起新串行（保留 R1，从 R2 起）。`run_ic_series.py` 的 resume 复制清单已加入 `ic_bridge.py`、`example_runner.py`，但没有用于 121044z。
- **改动**（全部是新增或加强，未删减任何 IC 功能）：
  - **示例阶段独立预算**：examples 与 derive 两次调用不计入管理预算 15。
  - **示例请求带只读上下文**：示例与推算调用都附上其余现行条目的原文。旧版只给本轮新增或修订的条目，导致 R2 起的 transform 示例漏写 `--seed`、recipe 写成 `{"steps":…}`。
  - **独立推算判定调用是否合法**：derive 对所有档的示例都判 `invocation_valid`，不合法的丢弃。另外，代码把数据中间含空行的 CSV 输入判为不确定输入（CSV 读取器会跳过空行）。
  - **第二档"规则推算"**：按断言内容比对两次推算。exact 视为整行且有序，contains 视为行内片段且不计顺序。只保留两次推算都给出的部分，作为 "lines" 断言。条目编号按前缀归一。执行器在比对 CSV 输出时，也按解析后的记录比对。
  - **第一档的多行 exact**：只有推算得出同样的行才断言，因为原文中的样例可能只是示意。
  - **可运行性（tier runs）**：原文为命令或操作给出示例输入时，示例必须原样使用该样例。代码核对 JSON 深度相等；原文没有 JSON 样例的，按命令行概要核对。代码断言：退出码 0、任何流都不出现 ERROR、示例与推算都列出的输出文件存在。结果只进账本，不发给 SDD。
  - **CI"本轮变更清单"**（`src/core/sdd-changes.ts`）：模型按 ir_change 写出每项行为修正（旧规则 → 新规则）和每个新增的命令或操作（列出参数名）。代码丢弃不对应本轮新增或修订条目的项，引文不是原文时替换为原文摘录，没有覆盖到的变更条目由代码补项。账本中仍打开的条目在清单中单列为 "Not yet met"。这一节放在正文开头、契约之前；首轮不生成。
- **回放**（`.scratch/ic-replay-batch`，只跑 IC）：
  - 管理调用 R1–R4 依次为 3、3、3、7。R4 中模型连续 4 次漏写必填的 `changes` 字段（schema 错误）。建议改为可选字段，缺失时由代码为每个变更条目补项。
  - 每轮另有示例与推算 2 次调用，耗时 64–114 秒，输入 2–4 万 token。
  - 追加给 SDD 的字符：变更清单 R2 3866、R3 2732、R4 1697；逐字示例节 1.1k–4.3k。
  - 示例执行每份代码 4–6 秒（docker，含编译）。
  - R3 的变更清单正好列出 fill 单侧锚点、zscore 样本标准差、resample、watermark 四项。
- **离线检出**（只计契约轮次与代码轮次一致的组合：SDD-only R1–R4、IC R1/R2×2/R3；R5 起 verify 改为 BLAKE2b 等，用 R4 契约去测已不是有效组合）：
  - 修正前：真检出 16，误报 10。误报来自：示例断言输出文件 `.rejected` 必然存在（原文没有写明）6 条；单列 CSV 中的空行 3 条；drift 的 contains 片段被要求有序 1 条。
  - 上述三项改为通用规则后，用存储中的示例与推算原样重新结算（`resettle.mjs`，不调用模型）：**真检出 16，误报 0**。真检出没有减少。
  - 真缺陷：verify 收到非十六进制 checksum 时无输出（SDD R1、IC R1、IC R2 第 2 次尝试）；compare `--key`（IC R2×2）；rollup 未实现（SDD R2–R4）；zscore 未改用样本标准差（SDD R3/R4、IC R3）；resample（SDD R3/R4、IC R3）；watermark（SDD R3、IC R3）。
  - 按档统计：第一档 5/0；runs 8/0；第二档 3/0。
  - 未检出：fill 单侧锚点（推算两次不一致，被丢弃）、sample。
- **待办**：`changes` 改为可选，然后回放验证；审阅通过后单独起新串行。

### 审阅后两项与留出验证（同日 13:30–14:40；未达标，未起 v3）

- **审阅后的改动**：
  - `changes` 改为可选字段；缺失时代码为每个变更条目补项，注明 "Old rule → new rule: not given by management"，并记录 `changes_not_given`。
  - 示例阶段单设上限：每轮 4 次调用（`EXAMPLES_CALL_LIMIT`），用完即跳过并记录。
  - 串行器新增 `--trial-prefix`（v3 用 `ic3-sdd-dpipe`）和 `--ledger-from-round`（采用的 R1 不执行示例）。
  - 测试：Node 651 通过（1 个原有失败，与本批无关），Python 68/68。
- **留出回放**（`.scratch/ic-replay-holdout`，新代码跑 R1–R6，只跑 IC）：
  - 管理调用依次为 9、12、6、11、9、6。
  - R3、R4 模型没有给出 changes，6 项和 4 项全部由代码补出。R4 的独立核对还把代码补项的措辞判为 D4，多花了一轮 CI。
  - R3 的 13 条示例全部不可判定：模型在 items 里写的是标签，不是条目编号。
  - R5 示例调用的输出不符合 schema，示例阶段失败。
- **留出检出**（R5、R6 契约在 SDD-only R5、R6 代码上执行，按原文逐条人工核对，按"示例 × 目标"计数）：**真检出 3，误报 34**，未达标。没有据此改判定规则，也没有起 v3。
  - 第一档（示例调用产生的）：0 失败。
  - 第一档（CI 验收示例）：
    - 真检出 1：lineage 的非法 JSON 应报 `ERROR: invalid pipeline config: <path>`，实际报 malformed JSON；
    - 误报 4：从 R1 沿用的错误处理示例 schema 本身不合法，2 条；drift 示例断言原文示意输出中的数值，这些数值不由该示例的输入决定，2 条。
  - runs：
    - 真检出 2：rollup 仍未实现；
    - 误报 24：R5 删除了 `.sha256` 旁路文件，但 R1–R4 的 runs 示例仍在沿用并断言该文件存在，22 条；drop 删光所有列的退化输入，2 条。
  - 第二档：误报 6。整文件 exact 的 JSON（compare、profile、validate 报告）按键顺序比对，程序按字母序输出键。
- **根因**（供下一批处理，本次不改）：
  1. 后续轮次改变了早先条目的行为却没有修订这些条目。R5 的 IR 试图把 R1 的旁路文件句判为 superseded，被来源门槛拒绝（该句仍在现行条目中），于是沿用的示例、以及账本条目都会过期。若进入账本，还会误导 SDD 把旁路文件加回去。
  2. JSON 输出按文本比对，键顺序不应算作要求。
  3. 第一档只核对数值是否原文逐字出现，没有核对这些数值是否由该示例的输入决定。
  4. 退化输入（删光所有列）。
  5. 示例的 items 写成标签。
  6. changes 改为可选后，模型在关键的 R3 也不给。

### v3 串行启动（同日 14:09，与 121044z 并行）

- 目录 `D:\huawei\EvoCodeBench\harbor_runs\ic3-sdd-dpipe-15round-20261011-180907z-4027e499`，trial 前缀 `ic3-sdd-dpipe`，管理预算 15。采用 R1（`ic-sdd-dpipe-r1-20261011-055743z-1142d795`，217/219），从 R2 起，以 R1 的代码为基线；重跑与暂停规则照旧。
- 范围按审阅收窄：
  - 包含"本轮变更清单"。代码补项的措辞改为中性："Listed by code from this update's IR change; quotes the original."。
  - 账本只记录、不反馈：`LEDGER_FEEDBACK = false`。示例照常生成和执行，结果写进 SddResult 和 `delivery.ledger`，但 CI 中不出现 "Not yet met" 和账本一节；`--ledger-from-round 2`。
  - 逐字示例一节照常发给 SDD；示例阶段每轮上限 4 次调用。
- 每轮记录用 `.scratch/ic3-round-record.py <串行目录>` 生成：变更清单项数（模型写 / 代码补）、账本开启与关闭的条目、示例阶段调用次数。

## 规则变更：只看最终 verifier 评分（2026-10-11 16:10 UTC-4，用户经配对 session，两条 IC 串行都适用）

- **新规则**：SpecArt 和 PRD 检查的结论不再决定代码去留。
  - 新增 `auto_keep_build_pass`（`run_series.promotion_decision`，配对 session 修改）：SDD 未全部通过，但要求的构建命令 `go build && go test` 成功（`requested_build_exit_code == 0` 且 `build_exit_code == 0`），并且官方已评测，就保留本轮代码作为下一轮起点，照常记录 SDD 停在哪一步、为什么停。只有构建失败才判 VOID。
  - 重跑：只有 VOID 的回合重跑一次。低于 90% 暂停诊断的规则保留。两次尝试保留官方分较高的一次。
- **原因**：SpecArt 记录类作废很频繁，而被作废的代码官方分往往更高。例如 121044z 的 R2 第 1 次尝试 479/481 被作废；R5 第 1 次尝试 646/680 被作废，第 2 次只有 614/680。
- **串行器配套改动**（`run_ic_series.py`，Python 68/68）：
  - `--resume --keep-ic`：沿用该串行冻结的 IC 构建、桥接层和示例执行器，只替换 harness 文件（`run_series.py`、`run_results.py`、`run_ic_series.py`、`run_r1.py`、`execution-context.md`），不会带入正在离线开发的下一批改动。
  - 两次尝试中保留较早的一次时，串行器调用 IC 存储的 `adopt`，让存储计入被保留那次的运行。否则下一轮 CI 的反馈说的是另一份代码。
  - 续跑时，已完成的各次尝试都按现行规则重新判定，以便同口径比较。
- **v3（180907z）**：16:14 停止控制器（R2 第 2 次尝试的 SDD 不受影响），用 `--resume --keep-ic` 续跑（resume 1），正在等待 R2 第 2 次尝试。返回后按新规则在两次尝试中保留较好的一次（第 1 次 435/481）。
- **v2（121044z）**：受影响的回合是 R5（第 1 次 646 被作废、第 2 次 614）和 R6。R6 按旧规则以 R4 的代码为基线启动；而且它的 CI 是按存储计入第 2 次尝试的状态编译的，存储里 R5 的两次运行都被标为作废。
  - 计划：停止 R6；把 IC 存储回退到 R5 结束时的状态（删除 R6 的事件、批次和运行，IR 恢复为 R5 的 IR，撤销 R6 认领对 R5 第 2 次运行的作废标记，先备份）；用 `adopt` 让存储计入 R5 第 1 次运行；在 series-results 中去掉 R6；然后 `--resume --keep-ic`，以 R5 第 1 次的代码为基线重新编译、运行 R6。
  - 状态：停止 v2 控制器和正在运行的 R6 SDD 进程的操作被权限检查拒绝，需要用户确认。v2 尚未改动，R6 仍按旧规则在跑。
- SDD-only 不改动、不重跑；配对 session 冻结的续跑目录 `sdd-luna-dpipe-15round-20261011-201100z-271841ea` 标记为 NOT-LAUNCHED，不使用。
- **v2 执行**（用户在本 session 确认后，16:22–16:36）：
  - R6 已于 16:20 自行结束（583/716，81.4%，以 R4 代码为基线），串行按 <90% 暂停；核实没有残留进程。
  - 备份放在 `121044z/rollback-r6-20261011/`：存储、series-results、series.json、报告、旧 R6 的 CI 与 start/reconcile 请求、旧 R6 的 host 请求文件、被丢弃的 R6 记录 `r6-record-discarded.json`。
  - IC 存储回退：删除 R6 的事件、批次和运行，IR 恢复为 R5 的，撤销旧 R6 认领对 R5 第 2 次运行的作废标记。然后用 v2 自己的 IC 构建执行 `adopt`：计入 R5 第 1 次运行（646/680），第 2 次标为被取代。series-results 中去掉 R6。
  - 第一次 `--resume --keep-ic` 重新编译了 R6 的 CI（7 次管理调用），但启动失败：CI 编号和运行编号由串行名和事件确定，新 R6 与旧 R6 相同，旧 R6 的 host 请求文件仍在，造成 EEXIST。处理：把这些文件移入备份，删除未完成准备的认领（没有目录、没有产物），再次续跑。
  - 16:36 R6 启动：`ic-sdd-dpipe-r6-20261011-203621z-ea7b1f62`，基线是 R5 第 1 次的代码（digest 3bb63143…），CI 109314 字符。
  - 下次处理：回退时，同一事件的 host 请求文件应一并移走。

### v3 逐轮记录

- **R1**（采用）：管理调用 5；示例阶段 2 次；没有变更清单（首轮）；可执行示例 11；按 `--ledger-from-round 2`，R1 的代码不执行示例。
- **R2**：
  - 管理调用 3；示例阶段 2 次；变更清单 14 项，全部由模型写出，代码补 0；可执行示例 33。
  - 账本：编译时打开 3 条，都是 R1 PRD 检查遗留的差异；只记录，不写进 CI。
  - 第 1 次尝试 435/481，SDD 停在 coding，按旧规则作废；第 2 次 461/481，SDD 通过，保留第 2 次。
  - 示例执行（共 39 条，含 CI 验收示例）：第 1 次失败 10 条，第 2 次失败 5 条。第 2 次的 5 条初步判断如下（未作人工终审）：
    - assert 报错多了前缀 `ERROR: invalid recipe: `，原文要求 `ERROR: assertion failed on row N: <message>`：真缺陷。
    - compare 整文件 JSON 按键顺序比对：误报，下一批第 2 项处理。
    - ingest runs 断言 `.rejected` 必然存在：误报，下一批处理。
    - verify 的 2 条 CI 验收示例（匹配时退出码 1 且无输出）：待核对。
