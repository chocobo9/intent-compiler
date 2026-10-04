> **历史/专题材料，非现行指令。** 保留当时的观察、方案或取舍；实现与状态须从 [模块地图](README.md) 核对，不执行本文旧“下一步”。原 CURRENT-DESIGN 节号均指历史设计。

# IR 容错边界说明（2026-09-29）

> 实验依据：run `intent-luna-dpipe-full-20260929-203358-8c6aebaa`。第 1–2 轮完整走通链条（派发→执行→回传→评估），第 3 轮起管理批次全部在编译前被拒。成因不是模型逐轮变差，而是：失败事件 requeue → 下一批携带更多事件（实测 1→3→5 个事件、48→285→336 段）→ 全有全无的源账目更难满足 → 再失败。本文定规则与边界；第 1 层已实现（见 §1.3 证据）。

## 0. 目标（一句话）

失败只做记录，不做回滚；进度不丢；缺口有主、有界。

## 1. 第一层：已实现（不引入新语义）

### 1.1 断开雪球

- 规则：`popPending` 按 FIFO 只取**一个**排队事件交给一批（`user_input` / `execution_return` / `capability_change` 各算一个事件）；同一批不再携带先前失败批次的事件。
- 顺序：**委托（user_input）优先**，同类内按事件日志 sequence 最早优先。委托优先是必须的——带着新委托的那一轮如果只拿到一批"评估/能力变更"事件，批次不会产生任何派发，那一轮就直接失败了（adapter 的 `COMPILER_HOST_WAIT_UNSUPPORTED`）；而执行回传会在执行器返回后的那次 advance 里被处理，不会被饿死。
- 谁写：代码（`IntentStoreV2.popPending`）。
- 谁判：代码。不依赖模型，因此这一条没有"违反"路径。
- 失败的批次：仍写 `management_log`（状态可为 `validation_failed`），事件照旧 requeue（第一次失败值得重试），但**一批只带它一个**。
- 有界重试：同一个事件连续失败的批次达到 `MAX_FAILED_BATCHES_PER_EVENT = 3` 时，该批在记录上写 `deferred_event_ids`，事件**从此不再进入队列**，也不再算作"未提交的用户更新"（`unresolved_user_event_ids` 由批次日志派生，见 §1.4）。同一失败会记一条 question，说明该委托未被编译。
- 旧数据：历史 run 的 journal、快照一律不重写；新规则只作用于新批次。
- 测试：`test/batch-queue.test.ts` —— 一批只含一个事件（最早的那个）；失败重试；第 3 次失败后事件被搁置，队列与"未提交用户更新"都不再被它卡住；重启后（从事件日志重建）结论不变。

### 1.2 未选定文本的机械默认

- 规则：`source_coverage` 由"必须逐段写"改为**可选覆盖**：
  - 代码对本批用户文本中"既没有被 content 选中、也没有被模型条目覆盖、也不是空白/宿主引号包装"的字节范围自动补一条记录：disposition `context`，requirements `[]`，reason = `DEFAULT_SOURCE_REASON`（"unselected by this batch (code default; not adopted as a requirement)"）；
  - 默认只补**残差**：模型自己写的条目照旧逐条校验（含"非规范条目不得覆盖已采纳文本"、"`superseded` 必须给出本轮用户文本作 basis、且必须是此前已采纳的文本"）；
  - 模型只在需要**覆盖默认**时写条目（`material` / `management` / `unresolved` / `superseded`）。
- 谁写：默认由代码补；例外由模型写。
- 谁判：机械校验（沿用 `validateSourceCoverage`，但"缺省"不再是错误）；模型写下的例外仍可能被拒。
- 违反会怎样：只校验模型写下的例外；缺省不会造成整批拒绝。
- 可见性：补出来的条目会写进该批记录里的 candidate（含 span 与 reason），记录另有 `source_defaults.count`，所以"这批跳过了多少段文本"不打开 candidate 也能看到。
- 旧数据：只读不改；新代码对缺失数组按以前的方式处理（仍然要求字段存在，`[]` 合法）。
- 测试：`test/source-payload.test.ts`（默认只补残差、不覆盖已采纳文本、错配仍拒）、`test/dpipe-structured-replay.test.ts`（-004 那 8 个未选 heading 现在作为默认提交，且没有进入任何 IR content）。

### 1.3 证据：离线回放（run `…203358-8c6aebaa`）

`node .tmp-replay-return-batch/replay-recorded-batch.mjs <runId> --batch <n>` 把该批**原本的组成与原本的回答**搬回当前代码跑一遍（不改证据目录）。结论：

| 批次 | 原状态 | 原错误 | 现在 |
| --- | --- | --- | --- |
| mgmt-3（3 事件） | validation_failed | `s25 has no complete disposition` | 第 1 次回答就通过 IR 阶段（回放因缺该批从未产生的 CI 回答而停在 CI） |
| mgmt-4（4 事件） | validation_failed | `s2 has no complete disposition` | 第 4 次回答通过 IR 阶段 |
| mgmt-5（5 事件） | validation_failed | `source_coverage[8] classifies actively adopted text as superseded` | 仍 RED：该回答自己把一段文本既留在 IR 里又声明撤回，是模型的自相矛盾，不放行 |
| mgmt-6（6 事件） | transport_failed（300s 超时） | — | 第 2 次回答通过 IR 阶段 |
| mgmt-7（7 事件） | transport_failed（300s 超时） | — | 第 1 次回答通过 IR 阶段 |

即：5 条卡死里 4 条由 1.2 直接解开；剩下 1 条是模型的实质矛盾，按"验证不放开"的原则保留拒绝，但把反馈改成可执行（见 §1.5）。

### 1.4 批次日志派生（不新增状态字段）

- `deferred_event_ids` 写在失败批次的记录里；`pendingEvents()` 与"未提交用户更新"都从批次日志派生（`handledUsers = accepted 批次的 trigger ∪ 各批的 deferred_event_ids`），所以重启、resume、复制 store 都得到同一结论，队列本身不需要新字段。

### 1.5 让反馈可执行

- `prepareCandidate` 抛出的校验错误现在也会附上 `applicationHint`：源账目类错误直接说清修法（"该段仍是某个 IR item 的 source：先改那个 item 的 sources 再撤回，或删掉这条条目让默认接管"），而不是只报"矛盾"。
- 理由：mgmt-5 的模型 4 次都在微调 span（5→6→7→8），说明它把"矛盾"读成了"位置错了"；不可执行的反馈会让一批原地烧完预算。

### 1.6 追加：`quote: null` 占位被当成第二选择器（2026-09-30 修复）

- 现象：续跑第 2、3、4 轮的管理批次反复报 `IR sources do not resolve`，一批里 4 次调用有 3 次死在这句话上，整轮没有派发。
- 证据：发给模型的 response schema 把 `source_id / digest / quote / segment_id / span` 全部设为必填、`quote/segment_id/span` 可空，所以模型每次引用都写成
  `{"segment_id":"s1","quote":null,"span":null,...}`。实测某批 139 个引用里 132 个是这样。
  解析器当时写的是 `if (!segment || value.quote !== undefined)`：`null !== undefined` 成立，于是**凡是按 segment_id 找的引用全部判为无法解析**。
- 这是校验层的假阳性，不是模型违规：解析层把占位 `null` 视为"没用这个选择器"，只有非空字符串才算写了 quote；落盘前把占位清掉。
- 回归测试：`test/source-payload.test.ts` —— 占位 null 必须解析成功且只剩一个选择器；segment_id 旁边真有 quote 仍算双选择器（`selector_conflict`）。
- 同时：`unresolvedRefs` 现在带 `reason`（`source_unknown` / `segment_unknown` / `selector_conflict` / `quote_unresolved` / `span_invalid`），修法提示也写清"source_id 要连尾部的 part id 一起原样复制"——模型偶尔会写残 id（例如丢掉 `:prt_…`）。
- 效果（run `…203358`，第 2 轮真实数据）：批次 6 次调用后 **accepted**，IR 新增 `r-profile`/`r-compare`、`r-transform`/`r-pipeline` 升到 revision 1；派发 `dispatch-34 → a-dpipe@2`；执行器跑完回传；官方验证 **480/481**（唯一失败是 `transform.derive` 的 `log(0)` 应为 `NaN` 而实测 `-Inf`；第 2 轮新增的 220 个 case 全绿）。

### 1.7 追加：本轮委托优先 + 缺口随批携带（2026-09-30 实施）

- 事实（同 run 批次账）：第 3–15 轮各只跑一个批次；第 4–15 轮处理的都是更早轮次的输入（第 4、5 轮重试第 3 轮，第 6–8 轮重试第 4 轮，……第 15 轮才轮到第 7 轮），4 个事件三次失败后被搁置、9 个事件从未被尝试。旧取材规则（最早优先 + 一批一个事件 + 三次失败搁置）把"一个难事件"放大成"连续多轮无派发 + 内容永久缺席"。
- 规则（与 §2.1–2.3 的缺口读模型一致，已实现）：一个批次仍是**一个提交边界**，其自身事件是**本轮最新**的用户委托；更早且尚未编译的用户委托作为携带缺口（carried delegation）随同一批进入，最多 3 个、按最早优先，批次必须逐个处置（把原文选入 IR 登记，或写明显式 `source_coverage` 去因 + 问题）；`basis.event_ids` 必须点名每个缺口。代码默认不能代替认领；缺口被 IR 引用后不再携带，被显式记为 `unresolved` 的继续携带。三次失败的"搁置"退役：失败只报告"仍未编译、继续携带"。
- 语义边界（用户确认）：跨轮补录允许——系统或 bench 自己发现"产物不合格"等同于用户要求重做，缺口就是未解决任务，继续完成；规范文本仍只来自用户原文。
- 证据：`npm test` 426 项（425 通过、1 环境跳过、0 失败）；条款清单重生成 176 条（新增条款归 code，带 where 锚点与夹具）；离线对照脚本 `.scratch/carry-plan.mjs` 在真实 journal 上显示：第 4 轮起本轮自己的输入都会被处理（第 4 轮 `f0f550b4 + f0f63e3d`，第 15 轮 `f0ebe821 + f0f63e3d + f0f550b4 + f0f4d71b`），而记录里第 15 轮仍在处理第 7 轮。
- 未做：批内失败不再抛错杀轮（有就绪工作时兜底派发）与 IR-only 提交（IR 过、CI 被 parent_issues 打回时落库）都没有实施；前者的评分影响取决于本轮能否编译出工作，后者的风险在于把 CI 判定不足的父 IR 直接落库。真实 run 前先汇报。

## 2. 第二层：还没有实现的"当前缺口"（读模型，不新增字段）

### 2.1 缺口住在哪

**决定：不加新字段，缺口做成读模型**——由代码按 task 聚合已有内容派生：

| 来源（已存在） | 派生成什么 |
| --- | --- |
| `coverage[]` 里 disposition = `unresolved`/`paused` | 该 task 尚未定位的文本/工作 |
| `questions[]` | 需要用户或下一轮输入的未决问题（含 §1.1 搁置的委托） |
| `atom_states` 里 `failed`，以及 `assessments` 里 `not_satisfied`/`unknown` | 已经执行过但没成的部分 |
| 批次日志里的 `deferred_event_ids` | 被搁置、未编译的委托 |

IR content 不承载执行失败（用户明确：IR 不需要这些）；也不新增 IR 字段。

### 2.2 归并（coalescing，防新雪球）

- 读模型是**算出来的**，不是攒出来的：同一 requirement/文本范围以**最新**一条为准；同 task 同类 question 只认最新一条；因此体积有上界，失败多少次都不累积（这正是 §1.1 搁置规则能成立的原因）。
- 缺口未清空时，该 task 的 coverage 不得宣称全部 `assigned` / `supported`。

### 2.3 谁负责清

- 下一轮的新委托到达时，管理层必须在同批中处理它：清掉、更新、或说明仍未决；
- benchmark 每轮本来就有新输入，天然提供处理时机。
- 目前缺口只出现在 store/记录里（`inspect`、审计报告），**还没有进模型请求**：要让模型主动去清，需要把读模型作为只读输入加进请求并写进合同文案（下一步）。

### 2.4 完成判据

- 缺口条目必须写清：影响的 requirement/文本范围、阻塞了什么、什么证据算清掉；
- 只有"清空"或"被显式 superseded"才算该 task 完成。

### 2.5 失败语义

- 缺口仍在时，批次**允许提交**（缺口被记录），但该 task 的完成与后继释放被阻断（沿用现有"未闭合前驱不放行"）。

### 2.6 测试

- 回放第 3、5 轮：断言能提交，且缺口条目**恰好一条**；
- 离线构造"连续两轮失败"：断言缺口条目恒为 1、体积有上界（不随失败次数增长）。

## 3. 明确不做（边界）

- 不做"文本欠账累积"（那只是换了马甲的雪球）；
- 不把缺口塞进 IR content（会变成新的要求文本）；
- 不由代码替模型判断"这段文本是要求还是上下文"——代码只做默认记账与显式例外；
- 不改变已成的不变式：一个批次一份提交、返回批次冻结 IR、字段级单写者、digest 归代码。

## 4. 验证顺序

1. ~~回放第 3、5 轮（红→绿）~~ → 已做，见 §1.3：4/5 绿，1 条为模型自相矛盾保留拒绝；
2. ~~全量 `npm test` + 条款清单重生成~~ → 414 项 / 413 通过 / 0 失败 / 1 环境跳过；条款 175 条已重生成；
3. luna high-fast 单轮真实 smoke（未做）；
4. 重启 15 轮（`state_cache_policy=all`，任一轮都可 resume）（未做）。
