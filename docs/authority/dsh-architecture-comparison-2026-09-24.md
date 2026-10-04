> **历史/专题材料，非现行指令。** 保留当时的观察、方案或取舍；实现与状态须从 [模块地图](../../development/README.md) 核对，不执行本文旧“下一步”。原 CURRENT-DESIGN 节号均指历史设计。

# DeepSeek Harness 架构横向对比与可借鉴项（2026-09-24）

本文件回答一个问题：**DeepSeek Harness（DSH）的架构逻辑，对我们 Intent Compiler 有什么可借的**。按用户限定，**Cordis 本身不进入讨论**——凡属于 Cordis 的机制（服务注册、fiber/effect 生命周期、waterfall/serial/emit 分发、HMR、profile + patch 组装）在本文件中一律排除；需要提到时只用"框架无关"的等价说法重述，并标注它依赖 Cordis、因此不进采纳清单。

**阅读来源（只读）：**`deepseek-ai/deepseek-harness`，MIT 许可，HEAD = `477b4f420553e8a52c2fbccc464d7561b239c443`（2026-09-24，`dsh-0.1.7-rc.2`）。以浅克隆 + sparse checkout 方式只读浏览，读了 `docs/architecture.zh.md`、`docs/subsystems/*.zh.md`（core/session/tools/llm-streaming/goal/sandbox/invariants/token-meter/session-projection 等）、以及 `packages/core/{agent,agent-loop,session,tools}`、`packages/llm/{llm,llm-retry,token-meter}`、`packages/session/{session-format,session-projection}`、`packages/sandbox`、`packages/interaction/user-approval`、`packages/guard/*`、`packages/experimental/auto-review`、`packages/runtime-diagnostics/invariants`、`packages/subagent`、`packages/sdk/protocol` 的 README 与源码。**没有运行它的任何命令、测试或安装步骤**；本文件中的所有 DSH 事实都来自静态阅读，并给出文件路径（少数给出行号）。

**对照对象：**本仓库 `project/development/DESIGN-HISTORY.md` 的四项公开调用（acceptEvent / advance / authorize / inspect）、持续 IR、Compiled Intent、Atom 台账、Gate / Check / Acceptance / Evaluation 四词分工、dispatch / execution 生命周期、budget、audit-report，以及 wayfinder 票据 T01–T11。

**追加（2026-09-24）：**文末新增**附录 A**，单独记录 DSH 的 `dsh-sandbox` 与本项目已有机制之间的对照与可借鉴项。

> **用词说明（其他 session 请按这个读）：**本文件只用三类名字——① `CONTEXT.md` 的四个词（机械门槛 / 独立核对 / 验收 / 评测）；② `CURRENT-DESIGN` 里已有的名字（authority、条件、coverage、dispatch、execution、`denied_calls`、`audit-report` 等）；③ DSH 自己的名字（只在描述 DSH 时使用，例如 `ToolGuard`、`ConfinedArgv`、`enforcement`）。
>
> **本文件不定义新术语。** 下面这些是白话描述，不是名字，请不要照抄进设计或代码：
> "只能拒绝、不能放行"（说 `ToolGuard` 的返回值）／"这次隔离实际管住了多少"（说 `enforcement: full | partial`）／"只读的现状视图"（说 DSH 的投影与快照）／"把记录一条条重放算出来的值"（说 fold／回放）／"对照值"（说 DSH 的 measurement anchor，即上一次成功调用报告的用量）／"调用开始时把值固定下来"（说策略与请求头在调用时被固定）／"截止到第几条事件"（说 `asOfSeq`）／"运行时自检规则"（说 `./invariant`）。
>
> 需要采纳任何一条时，请用①或②里的名字落到 `CURRENT-DESIGN` 的具体段落，并由对应票据（T04/T06/T08 等）先定归属。

> **现状复核说明（2026-09-24 10:45 本地时间，只读）：**读 DSH 期间，本仓库有**另一个 session 在并发改动**（`src/core/intent-contract.ts` 09:52、`src/core/compiler-store-v2.ts` 09:43、`src/core/intent-compiler-v2.ts` 与 `src/model/compiler-model-v2.ts` 10:30、`src/runtime/audit-report.ts` 09:43，并新增了 r11b/r11c 两次运行）。这些改动**不是本 session 做的**。受影响的"我们的现状"已按这一时刻修正，其余部分保留原始阅读结论：
> - `audit-report` 现在有 `cost.per_call`（逐调用 `duration_ms`）与 `cost.by_kind`（`propose`/`check` 的调用数、时长、输出与 reasoning token）——T02 的①已落地；
> - 核对 findings 现在带 `dimension`（`compiler-model-v2.ts` 的 check 契约已定义为 **D1–D6**）与 `evidence_resolved`（引用不可解析的 finding 仍记录但**不阻止**放行）；
> - 下一次提议会把上一批的拒绝理由作为 `previous_rejection`（含 dimension/claim/expected/observed/evidence_resolved）带进模型输入；
> - `management_log` 新增 `source_refs`；`SemanticCheckRecord` 仍**无时长**（时长在 `management_calls` 与批记录上）。

---

## 1. DSH 的架构逻辑（框架无关重述）

### 1.1 六个部件

| 部件 | DSH 的职责（白话） | 关键事实（含出处） |
| --- | --- | --- |
| 会话日志 | 只追加的一条条记录，**所有内容以它为准**；给模型看的对话历史不单独存，每次用 `deriveMessages()` 从记录里算出来 | `packages/core/session/src/types.ts:89`（`SESSION_FORMAT_VERSION = 4`）、`:281`（`SessionEventMap`）；`docs/subsystems/session.zh.md` |
| 循环 | `agent-loop` 是默认驱动器：开轮次、领输入、拼提示词与工具、发流式请求、跑工具、关轮次；**没有单独的一层"管理层"**，要加行为就挂生命周期钩子 | `packages/core/agent-loop/src/{agent,inbox,tool-calls,runtime-context}.ts`；`packages/core/agent-loop/README.zh.md` |
| 工具 | 按作用域注册的工具表 + 固定顺序的一条流水线：前置策略（允许/拒绝/询问）→ 只能拒绝、不能放行的检查（`ToolGuard`）→ 环绕分派（超时/重试/计时，包在真正执行外面）→ 工具自己准备好的结果内容 → 后置策略（可以检查或替换结果）→ 不可变的结果 | `docs/subsystems/tools.zh.md`；`packages/core/tools/src/index.ts:731`（`ToolGuard` 只返回拒绝理由）、`packages/core/tools/src/invariant.ts`（校验流水线各阶段的先后顺序） |
| 模型接入 | 消息与流式输出的公共类型 + 适配器接口；失败统一成一种可以序列化的 payload；重试策略在路由注册前就解析好，并在这次调用上固定下来 | `docs/subsystems/llm-streaming.zh.md`；`packages/llm/llm/src/retry-policy.ts:79`；`packages/llm/llm/src/types.ts:170`（`TokenUsage` 的计数口径） |
| 策略 | 审批（一次一决；拿不到答复就当拒绝）、沙箱（每次调用现算一次限制，并在结果里说明这次隔离实际管住了多少）、权限预设、超时（只能请求停止，不能强杀）、重复调用提醒、Auto review（同一个模型在每次工具调用前审一次） | `packages/interaction/user-approval/README.zh.md`；`docs/subsystems/sandbox.zh.md`；`packages/guard/timeout-policy/README.zh.md`；`packages/guard/repeat-tool-reminder/README.zh.md`；`packages/experimental/auto-review/README.zh.md` |
| 只读的现状视图（DSH 叫"投影"） | 领域注册"把记录一条条重放、算出当前状态"的小单元；读取方拿 `snapshot()`（同时给出"截止到第几条事件"`asOfSeq`）和变更通知；只给宿主看的与给客户端看的分开 | `docs/subsystems/session-projection.zh.md`；`packages/session/session-projection/README.zh.md` |

另外两块与上面并列：**持久化**（JSONL + 格式版本链 + 单写者句柄）与**运行时自检**（每个包一个 `./invariant` 伴生插件，包自己声明"哪些规则必须一直成立"；规则只能检查记录和可变数据，不能检查"某个服务或方法在不在"）。见 §1.2 的第 4、5 条。

### 1.2 十条关键规则（这是 DSH 最值得读的部分）

1. **模型能看到什么，就必须在记录里。** 每次真正发请求前，运行时都会重算一遍并逐字段比对：请求里的 `messages` 必须等于 `session.deriveMessages()`；`model/temperature/maxTokens/stop/tools` 必须等于从记录里算出来的 `request/header`；请求必须已经不可修改、并且带着一个还在跑着的 session id。对不上就直接判 `log-reconstruction desync` 并失败。见 `packages/core/agent-loop/src/invariant.ts`。
2. **失败的那次调用也单独记一条，但不进对话历史。** 每次模型调用要么写成 `assistant/message`（成功，里面嵌着完整的流），要么写成 `assistant/attempt`（失败、重试、取消、流出错）。attempt 里保留 token 用量和失败原因，但**不会**出现在下一次请求的对话里。见 `docs/subsystems/session.zh.md` 的"持久性约定"。
3. **一轮的边界就是"提交/回放"的边界。** 审批请求只在"还没结束的一轮"里有效，DSH 给的理由是：轮次之间的裸事件和"崩溃留下的尾巴"从记录上分不出来。进程崩溃留下的没收尾轮次，由 agent 层在恢复时补写一条 `interrupted` 结束事件，而不是让存储层去猜。见 `packages/interaction/user-approval/README.zh.md`、`docs/subsystems/session.zh.md`。
4. **记录带版本号，而且只允许一步一步升级。** 当前写入版本是代码里的常量（v4）；迁移只接受相邻一步（`vN -> vN+1`），链条必须从 0 连续到当前版本，否则启动就报错；读到比本构建更新的格式直接拒绝（原文："stored Session uses newer format vN; this build writes vM"）；每一步迁移的输出头都要重新校验一遍。见 `packages/session/session-format/src/chain.ts`。
5. **每个包自己声明"必须一直成立的规则"，并且这些规则可以被机械校验。** 包用完整 npm 包名注册检查；名字先占位、失败就整体回滚；没有可检查项的包必须写明 `No runtime invariant:`（`verify-package-invariants` 会拒绝空的占位）。规则只能检查权威记录或可变数据之间的关系，不能检查"某个服务或方法在不在"。见 `packages/runtime-diagnostics/invariants/src/index.ts`、`packages/AGENTS.md` 的约定段。
6. **检查只能拒绝，不能放行。** 工具流水线里的 `ToolGuard` 类型故意**没有"允许"这个返回值**：返回 `undefined` 表示交给下游，返回一个理由就表示拒绝，后面的监听器撤不掉；要放宽只能走另一条路（显式审批或权限预设）。见 `packages/core/tools/src/index.ts:731` 与 `docs/subsystems/tools.zh.md`。
7. **限制是每次调用现算的，不固定在实现里。** 沙箱策略每次操作都解析一次（会话 cwd 决定工作区根，显式批准的更宽模式优先），实现把它当成"已经完全指定"的输入；同一时刻两个调用方可以用不同的边界。后端还会报告这次隔离**实际管住了多少**（`full` 或 `partial`），并明确要求：需要绝对边界的调用方不得把 `partial` 当成 `full`。见 `docs/subsystems/sandbox.zh.md`。
8. **"沙箱自己坏了"和"策略拒绝了"必须分开判；拿不到保证就不执行。** 消费方先判 runner 是不是自己失败（命令根本没跑），再判是不是被拒绝（隔离生效）。没有后端时抛 `SANDBOX_UNAVAILABLE`；审批没有应答者时返回 `unavailable` 并当作拒绝；`never` 策略在分发之前就确定性地拒绝。见 `docs/subsystems/sandbox.zh.md`、`packages/interaction/user-approval/README.zh.md`。
9. **用量是把记录重放算出来的，不是内存里的计数器。** token 计量不发模型请求、只重放记录，结果可复现；提供方的用量只在"这次请求的内容和上次成功调用完全一致、而且不低于按路由算出来的对照值"时才复用；一次尝试的流式用量会被它最终的 assistant 记录替换，`llm/retry-started` 结束这段替换，所以同一步骤里的重试各算一次；证据不够时就**不给结果**，而不是给一个错的数。见 `docs/subsystems/token-meter.zh.md`、`packages/llm/token-meter/README.zh.md`。
10. **重试先写记录，再等待。** 安排一次重试时，先把 `llm/retry` 事件写进日志（含 retryId、第几次、策略 key、等待时长、失败内容），**然后在可取消的等待里等**；醒来再写 `llm/retry-started`，并让循环重试。重试次数是从记录里算出来的（按 provider + 策略分组、按 step 归零），不是内存变量。见 `packages/llm/llm-retry/src/index.ts`（文件头："Each scheduled retry is durable before its cancellable wait."）。

### 1.3 一次请求的完整生命周期（用我们的话重述）

```
轮次开始（turn/start，不带触发字段）
  一次性取走：待处理的"下一步输入" + 一条排队消息
  拼提示词片段与工具 schema，把运行时上下文放进请求
  → 前置钩子（可以拒绝，也可以改写要进入这一轮的消息）
      拒绝 / 第一个批次为空 ⇒ 这一轮不花步骤就结束
  步骤开始（step/start）
  请求配置钩子 → 补上适配器默认值 → 把系统提示词与用户消息"准入"
      （在准入完成之前取消：这两者都不会被提交）
  记录 request/header（配置与工具顺序）与 request/context（容量等）
  从记录算出这次请求并固定下来（不再改）→ 流式调用 → 实时分片广播
      成功 ⇒ assistant/message（里面嵌着完整的流）
      失败/取消 ⇒ assistant/attempt（保留用量，不进对话历史）
  工具调用：tool/call* → 前置策略 → 只能拒绝的检查 → 环绕分派 → 后置策略 → tool/result*
  如果还有工具结果没送回模型、或又有新的下一步输入 ⇒ 继续下一步
  → 收尾钩子 → 一轮结束（turn/end，带结束原因）
```

结束原因是一组固定取值：`completed` / `aborted`（带取消原因）/ `blocked` / `error`（结构化失败）/ `max-tokens` / `interrupted`（崩溃后由恢复补写）/ `forked`（fork 边界由种子构造补写）。**`max-tokens` 优先于 `completed`**：只要这一轮里有任何一步是被截断的，整轮就标 `max-tokens`，让人能区分"正常收尾"与"被截断"。

---

## 2. 逐项对照：DSH ↔ Intent Compiler

| 维度 | DSH 的做法 | 我们的现状（含文件/票据） | 差异性质 |
| --- | --- | --- | --- |
| **事实来源** | 只追加的记录是唯一来源，对话历史每次算出来 | `snapshot.json` + `events.jsonl` + 内容寻址产物；`compiled`/`ir`/`budget` 等字段是**直接存下来的状态**，不是从记录算出来的 | 近但不同：我们有"算出来"的空间，但没把这件事写成契约 |
| **"模型看到了什么"** | 运行时重算比对，不一致就失败 | 请求由 `src/model/compiler-model-v2.ts` 拼装，载荷进 `management_log.request`，但**没有"请求能从记录重建"的检查** | **DSH 更严**（可直接借） |
| **失败的尝试** | 单独记一条（`assistant/attempt`），不进对话历史，保留用量 | 整批的失败只体现在 `management_log` 的状态里；`audit-report` 现在有 `per_call`/`by_kind`（T02①已落地）；`previous_rejection` 会把上一批理由带回下一次提议 | 还缺"失败尝试自成一条"和"要不要进上下文"的明确规则 |
| **轮次/步骤** | 一轮=把已接纳的输入做空；一步=一次请求+它触发的工具；只要还有没还完的工作就继续 | `advance()` 处理"一批事件"，`management_log` 记批次，事件由宿主注入 | 可以对上：批次≈轮次，管理调用≈步骤 |
| **结束原因** | 固定一组取值 + 被截断时优先标 `max-tokens` + 崩溃后补 `interrupted` | `status` 是字符串枚举（`accepted`/`transport_failed`/`json_failed`/`schema_failed`/`validation_failed`），失败原因在 `error_code` | 可借"被截断优先"和"恢复时补写"这两条 |
| **谁能拒绝、谁能放行** | 工具前置检查只能拒绝；放宽只能走审批/预设那条路 | Gate（代码判定）+ Check（模型判定）+ Acceptance | 同方向；我们缺的是把"哪些规则只能拒绝、放宽只能从哪来"写下来（T04/T07） |
| **放宽权限的路径** | 只能走显式审批/预设；`never` 在分发前就确定性拒绝，后注册的监听器绕不过去 | `authorize()` 按条件求值；未知条件 unsupported 并拒绝 | 同方向；可借"确定性拒绝先于可扩展钩子"这条顺序 |
| **拿不到保证怎么办** | 没有应答者、没有后端都当作拒绝，不静默照常执行 | 未知条件 ⇒ unsupported ⇒ 拒绝（已经这样） | 一致，可以对外引用 |
| **限制算出来的时机** | 每次调用算一次、随调用带着；实现把它当作完全指定 | 批次开始时取 budget/契约；`capabilities` 由宿主在请求里给 | 可借"调用开始时把值固定下来"（T06） |
| **隔离管住了多少** | 后端在结果里报 `full` 或 `partial`，并说明只覆盖文件效果 | 我们的路径检查靠字符串前缀/宿主解析，没把"能保证多少"记成字段 | **可直接借**（安全边界的表述） |
| **成本归因** | 从记录重放算出来：用上一次成功调用的用量作对照值，之后按增量记；不发模型请求 | `budget` 是累加器；`audit-report` 现在有逐调用切分，但仍是一次扫描，没有对照值和增量 | 可借"重放算出，而不是累加"（T03/T10） |
| **用量口径** | 三项互不相交：未缓存输入 / 缓存读 / 缓存写；适配器负责把 provider 混在一起的值减出来；reasoning 算在 output 里、只作附注 | 现在 `usage{input,output,reasoning,cache_read,cache_write}` 是按 provider 原语义抄的（OTel 口径下 cache 与 reasoning 都是子集） | **必须二选一并写死**（T10 §3） |
| **重试** | 先写记录再等待；次数从记录里算；一次重试序列有稳定 id；策略在这次调用上固定 | 重发在 `structured-provider-transport.ts`；`retry` 只有一个布尔 | **可直接借**（T02/T06） |
| **审批记录** | `approval/asked` + `approval/decided` 成对写、同一轮内、由自检规则校验 | `denied_calls` 记拒绝（start/operation），没有"申请-决定"配对，也没有"没有应答者怎么办"；findings 的 `evidence_resolved` 是第一步 | 可借配对与"没有应答者就拒绝"（T08） |
| **只读视图** | 注册"把记录重放、算出当前状态"的小单元 + `snapshot(asOfSeq)` + 版本号 + 检查点 | `inspect()` 返回 RunView；`audit-report` 每次全量扫（有逐调用切分，但没有"截止到第几条事件"和版本号） | 可借 `asOfSeq`/版本号/检查点（T02/T03） |
| **格式兼容** | 相邻迁移 + 连续链 + 拒绝更新的版本 + 已发布的代不可改名/替换/删除 | v1 只读兼容、v2 新 run；没有显式迁移链规则 | 可借（接入另一个项目时尤其重要） |
| **运行时自检** | 包自己声明规则 + 机械校验（`verify-package-invariants`） | `audit-report` 是**事后**审计（D1–D9），没有在线检查 | 可借"在线自检 + 离线审计"两层（T03） |
| **意图放在哪** | 意图在对话历史里；另有 `goal`（持久目标）与 `plan`/`todo` 工具 | 显式 Compiled Intent（可执行蓝图）+ 持续 IR | **我们的差异点，保留**；但可借 goal 的"阶段 vs 激活"分开 |
| **谁驱动** | 常驻服务自己跑；宿主只 `session/prompt` + 订阅 `session.event`/`session.status` | 宿主显式调 `advance()`，按事件推进 | 我们的模式更适合"被另一个项目调用" |

---

## 3. 值得借鉴的 12 条（A 类 = 建议采纳；B 类 = 可选）

每条给出：DSH 怎么做 → 我们怎么落 → 风险与代价。

### A1. 把"模型能看到什么就必须在记录里"变成一条每次都要跑的检查（而不只是设计愿望）

- **DSH：** `agent-loop` 每次真正发请求（`llm/stream`）前都重算一遍并比对：`JSON.stringify(request.messages) === JSON.stringify(session.deriveMessages())`，再逐字段比对从记录里算出来的 `request/header`；对不上就判 `log-reconstruction desync` 并失败（`packages/core/agent-loop/src/invariant.ts`）。
- **我们：** 在 `src/model/compiler-model-v2.ts` 组装请求之后加一条检查：`request` 必须能由图上的记录（触发事件、IR 快照、候选、契约文本、预算）唯一重建；重建不出来就整批失败并记录原因。这正是 T02 想要的"能计量、能重建"前提，也让"r10 的候选与核对引用了什么"这类问题变得可判。
- **当前进度（10:45）：**`evidence_resolved`（引用不可解析就不阻止放行）与 `previous_rejection` 已落地，但"请求能从记录重建"这条检查还没实现。
- **风险：** 这条检查本身要稳定（否则会因为无关格式差异误报）；需要先把候选和引用的序列化规范化（T10 的 digest 规范）。

### A2. 失败的那次调用也单独记一条，而且不进对话历史

- **DSH：** `assistant/attempt` 保留失败、重试、取消和用量；`deriveMessages()` 不把它算进对话历史。
- **我们：** 把"被拒绝或被放弃的候选批次"也记成单独一条（独立 id、用量、失败码、当时的引用），并明确它**不进**下一次请求的上下文。现在"重掷时不带理由"就是反例：既没进历史，也没被利用。属 T08：理由要能挂到批次或原子上，但"进不进模型上下文"必须显式定。
- **当前进度（10:45）：**"把上一批理由带进下一次提议"已实现（`previous_rejection`）。剩下的就是本条要解决的事：失败现在只是批次记录里的一个状态，不是单独一条记录，也没有"进不进历史"的规则。
- **风险：** 如果完全不让模型看到，它会重复同一个错误（DSH 另外用 `repeat-tool-reminder` 补这一点，见 A9）。

### A3. 重试先把这次重试写进记录，再去等待；重试次数从记录里算

- **DSH：** `llm/retry` 事件在 delay 之前写入；重试次数放在一个从记录算出来的小状态里（DSH 叫 `llmRetry` 投影），按 (provider, policyKey) 记账、在 `step/start`/`turn/end` 重置；一次重试序列有稳定的 `retryId`；provider 给的 `retryAfterMs` 只有不超过上限才采用。
- **我们：** 在 `structured-provider-transport.ts` 的重发路径上，先写"重发意图"记录（含原因、序号、上一轮摘要），再等待；重发次数与"拒绝后再推进"的批次计数都从 store 派生，而不是内存变量。对接 T02/T06。
- **风险：** 记录量上升；需要与 budget 的"未配置不启动"约定协调（记录不等于放行）。

### A4. 调用开始时把这一批实际用的配置和上限固定下来，并写进记录

- **DSH：** `ResolvedRetryPolicy` 在路由注册前就解析成一个不可变的值，这次调用把它抓住（`llmRetryPolicyOf(stream)`）；之后再换路由，也不会影响这次失败的重试策略。
- **我们：** 批次开始时把实际生效的配置（模型、provider、预算上限、契约版本、能力目录）固定下来，写进批次记录；后面的归因都用这份值，而不是"现在的配置"。这和已有的"配置与实际返回必须区分"是同一条原则。
- **风险：** 固定下来的这份值要能读、能对比；否则审计时说不清"当时用的是哪个契约"。

### A5. 把"只能拒绝、不能放行"写成规则，把放行留给单独的一条路

- **DSH：** `ToolGuard = (execution) => string | undefined`——返回值里没有"允许"，所以它只能拒绝；要放宽只能走审批或权限预设那条路。
- **我们：** 明确机械门槛（Gate）只能拒绝（缺引用、缺 coverage、摘要不符……），它不是放行的来源；放行只能来自用户或委托（T04 的"决策归属"）。这样 T07 的"核对范围"和"权限"就不会混在一起。
- **风险：** 需要列出"哪些规则属于这一类"，否则有人会把策略写进这类检查里，又指望它能放行。

### A6. 把"这次检查到底管住了多少"和"沙箱坏了 vs 被拒绝"都记成事实

- **DSH：** 沙箱在结果里返回 `enforcement: 'full' | 'partial'`；并且用两套 stderr 规则把"runner 自己失败（命令没跑）"和"被拒绝（隔离生效）"分开，要求消费方先判前者。
- **我们：** 路径和对象范围的检查现在只有"通过/拒绝"。建议在结果里也记下"能保证到什么程度"（例如"只能做字符串前缀匹配"就记 `partial`），并在审计里写明"`partial` 不能当成绝对边界"；同时把"宿主/工具不可用"与"候选/语义被拒"在报告里分开。对接 T04/T06 与安全相关的验收。
- **风险：** `partial` 该怎么处置（拒绝，还是记录并继续）是决策归属问题，不能由实现者私自决定。

### A7. 同一时刻只有一个写入者；先拿到写入权，再对外发布

- **DSH：** `persistence.create(header)` 在发布前存储持久身份并取得写所有权；`resume` 用 `open(id, 'write')` 排除同 id 并发恢复；teardown 在提交收尾事件后关闭句柄，**可证明地**释放写所有权（`packages/core/agent-loop/README.zh.md` 的"持久化集成"）。
- **我们：** `CURRENT-DESIGN` 已要求"每个 run 同时只允许一个存储写入者"，但恢复路径目前靠约定。建议把"取得写所有权"作为打开 run 的第一步（返回句柄式对象），并在 inspect 中暴露所有权状态。对接未来接入另一个项目时的并发/多进程场景。
- **风险：** 若宿主每次都新建进程，需要定义所有权超时/接管规则（DSH 明确把"跨进程共享一个存储"列为延期工作）。

### A8. 只读视图要带上"截止到第几条事件"和版本号

- **DSH：** 每个小单元注册一个 `apply(state, event)`（同步执行；状态引用没变就什么都不做）；快照带 `asOfSeq`（"这些值共同反映到的最后一条事件"）；`stateVersion` 变了就作废缓存；持久检查点用来加快冷启动时的读取。
- **我们：** `audit-report`/`cost-summary` 现在是每次全量扫描。建议把 D1–D9 定义成"从记录算出来的只读视图"，带上"截止到第几条事件"（我们已有 `event_sequence`）和版本号，并允许缓存；`inspect()` 复用同一套。对接 T02/T03。
- **当前进度（10:45）：**`per_call` + `by_kind` 是第一步（逐调用切分已经可读），但仍然是一次扫描、没有"截止到第几条事件"、没有版本号，所以 A8 剩下的部分仍然成立。
- **风险：** 只读视图不能变成第二个事实来源；必须保证"重算出来的结果 == 视图里的结果"（可以用 A1 的检查来测）。

### A9. 防止"反复做同一件事却不推进"：把被拒绝的调用也算进重复，只提醒不阻止

- **DSH：** `repeat-tool-reminder` 在 `post-execute` 上按 (工具, 规范化参数) 计数，阈值 `[3, 5, 8]` 时给模型一条提醒；**被拒绝的调用同样计数**（"模型反复尝试被拒绝的调用，恰恰是需要打破的循环"）；只提醒、不阻止；新用户消息清零计数；仅驻留内存。
- **我们：** `CURRENT-DESIGN §3.10` 要求"停止只有内部产物变化的空转"。可借它的形态：对"(同一目标、同一被拒理由、同一字段)"的重复计数，超过阈值后**给下一次候选项一条短提醒**（而不是直接拒绝），并把提醒记进批次。对接 T08/T05。
- **风险：** 提醒会占用上下文与 KV cache 前缀；阈值只能当启发式（DSH 明说"仅精确匹配、近似变体会绕过"）。

### A10. 成本/用量：从记录重放算出来，而不是在内存里累加

- **DSH：** ①测量＝重放记录（结果确定，不发模型请求）；②只有"这次请求的内容和上次成功调用完全一致、而且不低于按路由算出的对照值"时才复用提供方的用量；③`inputTokens` 是**未缓存**输入，缓存读、缓存写单列（计费＝三项之和），reasoning 算在 output 里、只作附注；④`llm/retry-started` 结束一段尝试的替换范围，重试各算一次；⑤证据不够时**省略**，不填 0。
- **我们：** 采纳其中三条就能明显改善 T03/T10：给 `budget` 加一份"从记录算出来"的视图（带对照值）；把用量口径写死（见 A11）；失败或未知一律记 `unavailable` 而不是 0（我们已经这样）。
- **风险：** 重放要花时间，会话越长越贵（DSH 用检查点缓解）；我们的 run 规模小，可以先不做检查点。

### A11. 用量的计数口径必须选定一种并写死

- **DSH：** 选"互不相交"：未缓存输入、缓存读、缓存写三项分开，适配器负责把 provider 混在一起的值减出来——好处是计费可以直接相加。
- **OTel（我们现在字段名的来源）：** 选"子集"：cache 属于 input，reasoning 属于 output——好处是尽量保留 provider 原本的语义。
- **我们：** 两种都行，但**不能混**。建议在记录里写死一种（若跟 DSH 一样，就是"三项互不相交、由适配器归一化"），因为 `audit-report` 与 `cost-summary` 要做加法；同时在字段注释里写明"provider 只给总量时，cache/reasoning 记 `unavailable`，不记 0"。这是 T10 §3 的直接输入。
- **风险：** 归一化算错会低估或高估成本；要有对照探针（我们已有 dashscope 的实测）。

### A12. 把格式兼容写成明文规则：相邻迁移 + 拒绝更新的版本 + 已发布的代不可改

- **DSH：** 见 §1.2 第 4 条；另有"已提交 generation 路径绝不重命名、替换或删除"（`docs/architecture.zh.md`）。
- **我们：** 目前只有"v1 只读、v2 新 run"。建议写出：①只允许相邻迁移；②读到更高版本必须拒绝而不是尽力解析；③迁移每一阶段都要校验输出并区分"不支持（refusal）"与"代码缺陷"；④已发布格式不可原地改写。
- **风险：** 我们还没有 v3；这条主要是"未来接入另一个项目"时的契约，先写清楚即可。

### B1. 目标（goal）的"持久阶段 vs 进程本地激活"分离

- **DSH：** `GoalPhase = active | paused | blocked | complete` 是持久的；`activation (armed/disarmed)` **从不持久化**——恢复或 fork 之后，自动续行必须由人再授权一次才可能开始；每次变更都是比较并设置（`GoalRef{id, revision}`），`blocked` 带一个策略拥有的稳定 lower-kebab-case code（`docs/subsystems/goal.zh.md`）。
- **我们：** 与"完成后收回权限、恢复不复活旧凭证"同源，但 DSH 多给了一条干净的表达：**"自动推进的资格"不进持久状态**。建议把这条写进 IR：`current_scope.disposition` 保留意图，另有一个"本次是否允许自动续行"的运行时资格，恢复后默认关。
- **风险：** 需要区分"用户要求的暂停"与"运行时资格"，否则会出现两种 pause 语义混用。

### B2. 审批的配对记录与"无应答者 = 拒绝"

- **DSH：** `approval/asked` + `approval/decided` 成对写日志（同一轮内，由运行时自检规则校验），结果只有固定的几种（allowed-once / rejected / cancelled / unavailable）；模型**只看**最终工具结果与当前策略，看不到审批界面和审计事件。
- **我们：** `denied_calls` 记的是"拒绝"，没有"谁申请的、谁决定的、为什么"。建议把 authorize 的拒绝升级成配对记录（申请 → 决定 → 结果），并把"没有应答者 ⇒ 拒绝"写成显式规则，而不是靠超时。对接 T04/T08。
- **风险：** 会引入新的记录面；需要 T04 先定"谁有权决定"。

### B3. 委派/子级的形态（若我们将来支持派生执行）

- **DSH：** 一次性子级 vs 可继续子级；"发布即边界（提供方回滚未发布资源）"；`maxDepth` 默认 1；可继续子级有容量上限与"冷恢复"；子级的权限在启动时**固定**，且子级收到固定声明："你的权限范围在启动时确定，不能从本会话内部放宽；需要更多访问时不要重试被拒操作，把限制说出来让委派方处理"（`packages/subagent/subagent/README.zh.md`）。
- **我们：** 首轮实现明确"不支持委派/后台派生"，并保留目标与能力缺口。若将来要做，DSH 的这几条（发布边界、深度默认、权限固定 + 明确告知子级、容量与冷恢复）是最省事的一套现成约定。
- **风险：** 我们强调"派生执行受相同收回约束"，DSH 的"固定权限 + 不可内部放宽"正好一致，但收回的在途语义仍需我们自己定。

---

## 4. 明确不采纳 / 不适用（C 类）

1. **Cordis 全家桶**（服务注册、fiber/effect、waterfall 分发、HMR、profile+patch 组装、`dsh plugin`）。理由：用户明确排除；且我们后续要接入另一个项目，绑定一个插件容器会把宿主契约变复杂。
   - 注意：DSH 的"钩子链可以拒绝/改写"本身**不依赖 Cordis**，所以 A5/A12 里的契约可以借；借的是**顺序与返回值语义**，不是框架。
2. **"没有内置轮次预算"**（`packages/core/agent-loop/README.zh.md` 的已知限制）。理由：我们的默认用户约束就是"在预算内推进、失败要显式"；DSH 把这个留给策略插件，我们不能。
3. **把意图完全隐式化进对话历史。** DSH 的"计划"体现在历史 + 工具调用（goal/todo/plan 只是辅助）。我们的目的是"把管理层的理解做成可交付的蓝图（Compiled Intent）"，这是我们的差异点，不放弃。
4. **一次性授权、没有 allow-always、审批不带参数** 的简化。我们的 authority 有生命周期与条件，不采用它的简化；但"把申请与决定成对记下来""拿不到保证就拒绝"这两条照借。
5. **启发式近似作为结论。** DSH 反复标注"每 token 四字符是近似、构成数字不能当总量"。我们的文档与报告同样必须区分 estimated / measured。
6. **采样与滚动池的细节**（`maxParallelToolCalls`、独占屏障、PTC 子分派）——与我们的规模无关，暂不引入；但"独占调用构成排序屏障"这条调度原则值得记住（对应我们的"共同条件必须同组提交"）。

---

## 5. 对"后续接入另一个项目"的启示

DSH 把自己的边界做得非常清楚，这一点最值得学：

1. **宿主看到的是"注入 + 观察"，不是内部结构。** SDK 协议只有 3 个客户端请求（`initialize`、`session/prompt`、`shutdown`）与 4 个服务端通知（`session.event`、`session.status`、`subagent.started/finished`）；`session/prompt` 的返回值是**持久入队回执**（`messageId`），明确**不是**助手回答或轮次结束。见 `packages/sdk/protocol/README.zh.md`。
   - 我们的对应物是四项公开调用；建议在对外说明里也写清：`acceptEvent` 的回执只说明"事件已经存下来了"，不代表事情做完；`advance` 的结果才说明"发生了什么"；`inspect` 是给读取方看的现状视图。
2. **驱动模式可选。** DSH 是"服务自驱 + 宿主观察"；我们是"宿主驱动 advance"。两种都成立，且可以共存：把 `advance` 保留为显式驱动（便于测试与预算控制），同时允许"宿主只调 acceptEvent，由 runtime 排程 advance"——这正好对应 CURRENT-DESIGN 里"每个事件接纳后，runtime 安排一次 advance；advance 返回仍有待办时再安排下一次"的表述。
3. **接入方不需要理解内部记录。** DSH 的客户端只认 `session/event` 与 `session.status`；我们应把 `RunView`/`audit-report` 定义成**稳定的只读视图**（带上"截止到第几条事件"和版本号），而不是把 `snapshot.json` 的内部结构当接口（见 A8）。
4. **谁拥有这个 run 要写清。** DSH 同一时刻只有一个写入者，恢复时会先把同一 id 的并发恢复挡掉；我们接入的项目如果是多进程或多实例，必须先把"谁拥有这个 run"写进契约（A7）。
5. **协议是纯库、类型即契约。** DSH 把协议定义与运行时分开（`sdk/protocol` 是纯库，没有插件和配置）。我们的 `src/core/intent-contract.ts` 已经走在同一条路上——建议把"契约版本"也一起固定进批次记录（A4）。

---

## 6. 与现有票据的接口

| 票据 | DSH 给的输入 |
| --- | --- |
| T01（结构性成本边界） | A1/A10：成本和请求都应该能从记录重放出来，所以"可核验引用"是判据的前置；DSH 的"模型能看到什么就必须在记录里"就是"证据可重建"的现成写法 |
| T02（每次调用的独立计量） | A2/A3/A4：失败的那次调用单独记一条、重试先写记录、调用开始时把配置固定下来；`tokenUsage`/`contextPressure`/`contextBreakdown` 这三个从记录算出来的量是"该记什么"的参考 |
| T03（成本基线分解） | A8/A10：只读视图要带"截止到第几条事件"和版本号；估计值与实测值必须分开 |
| T04（决策归属） | A5/B1：只能拒绝的检查不能当作放行来源；"自动继续的资格"可以只存在运行时、不写进持久状态 |
| T05（增量形状） | B1/A9：goal 的"目标 vs 激活"、重复提醒的"只提醒不阻止" |
| T06（调用拓扑与预算） | A3/A4：重试次数从记录里算；调用开始时把这一批实际用的值固定下来 |
| T07（核对范围与上界） | A5/A6 + §3 的 auto-review 对照（见下） |
| T08（失败信息归属与反驳） | A2/B2：申请与决定成对记录、拒绝可以被反驳并留痕、没有应答者就拒绝 |
| T09（结构性成本方法） | A10：成本可以用"重放算出 + 对照值 + 增量"表达，所以"随什么量增长"这件事可以被重放验证，而不是只靠一次采样 |
| T10（最小计量集合） | A3/A10/A11：用量口径（三项互不相交）、重试序号、什么时候可以复用上次的用量 |
| T11（核对可靠性） | auto-review 的形态（见下） |

> 补充（10:45）：T11 §4 的 **D1–D6 维度 + `evidence_resolved`** 已由并发 session 落地到 `compiler-model-v2.ts` / `intent-contract.ts`；本表剩余的价值在于 DSH 的"三种结果（放行 / 拒绝 / 交给人）"与"被拒之后升级给人"这两条还没采纳。

**T07/T11 的专门对照：DSH 的 Auto review 与我们的独立核对几乎是同类机制**（`packages/experimental/auto-review/src/index.ts` + README）：

- 相同的部分：**同一个模型**在动作执行前审查；严格 JSON 输出；拒绝后模型只看到最终结果；明说"模型分类可能出错"；**不缓存、不重试 reviewer**；每次受支持调用额外一次模型请求（成本结构与 r10 的"核对占 58.4%"同类）。
- 不同的部分（可借）：①**固定判据**：Auto 把输入固定切成五块（固定策略、只给 cwd 的环境、带来源的项目约束、过滤后带来源的历史、完整待审动作），而不是"找出任何不一致"；②**三种结果**：`low+allow` / `medium+allow|deny` / `high+deny`，只在合法组合里取值；③**被拒之后交给人**（`ask` 策略 → 审批），而不是整批报废；④**明确排除**：主 agent 的 system 节点、assistant 正文与 reasoning、工具结果都不进入 reviewer 输入；⑤**卸载与迁移**：把存活会话迁到另一套权限、等在途审查结清，再撤监听器。
- 对我们 T11 §4 的映射：D1–D6 维度 ≈ Auto 的"五块输入 + 风险表"；`severity: blocks_dispatch | records_only` ≈ 它的三种结果；"不让同一次核对自裁" ≈ 它把最终放行交给审批而不是 reviewer。

---

## 7. 开放问题

1. **要不要给"失败的那次调用"单独一条记录？** 如果要，`management_log`、`semantic_checks`、`audit-report` 都要区分"失败的尝试"和"成功的那条"；不要的话，就永远说不清"哪些成本是失败尝试的"（T02/T03 的前置）。
2. **"这次检查到底管住了多少"在我们场景里怎么写？** 路径解析能保证到什么程度？`partial` 时是拒绝还是只记录？属决策归属（T04）。
3. **把值固定下来的粒度**：按批固定，还是按调用固定？DSH 固定到"路由注册"这一层；我们的契约、预算、能力目录分别按哪一层固定？
4. **"模型能看到什么就必须在记录里"这条检查要花多少**：每次组装请求都要重算一遍对话历史（DSH 用缓存缓解）。我们规模小，是否直接全量重算？
5. **只读视图的缓存与一致性**：DSH 的 `asOfSeq` 在我们这里对应 `event_sequence` 吗？审计报告要不要写"截止到第几条事件"？
6. **接入另一个项目时谁拥有这个 run**：单进程假设是否成立？不成立就需要 DSH 列为"延期工作"的那套（持久邮箱 + 跨进程租约）。
7. **用量口径选哪一种**：跟 DSH 一样"三项互不相交"，还是跟 OTel 一样"子集"？需要一次明确决定并写进 T10。

---

## 附录 A：sandbox 与我们项目的对比与启示（2026-09-24 追加）

**先读这一段（写给其他开发 session）：**本附录出现的所有名字——`dsh-sandbox`、`sandbox-policy`、`sandbox-local`、`SandboxMode`、`ConfinedArgv`、`enforcement`、`denied`、`sandbox_permissions`、`justification`、`SANDBOX_UNAVAILABLE`——**只用于指代 DSH 的实现**，不是本项目的术语。本附录**不提出任何新的说法或名字**，也不改变任何票据的既有结论；凡涉及归属的决定仍由 T04 / T06 / T08 出。文中对 DSH 机制的白话描述（如"只能拒绝、不能放行""这次隔离实际管住了多少""只读的现状视图"）同样只是中文转述，不是本项目词汇；本项目术语以 `CONTEXT.md` 的四个词（机械门槛 / 独立核对 / 验收 / 评测）和 `CURRENT-DESIGN` 里已有的名字为准。

### B.1 DSH 的 sandbox 是哪些包、做什么（事实，均为只读核对）

| 角色 | 位置 | 事实 |
| --- | --- | --- |
| 服务定义 | `packages/sandbox/sandbox` | `ctx.sandbox`；`confine(argv, policy, signal)` 返回 `ConfinedArgv{ argv, enforcement, denialSignatures, runnerFailureRules }`；没有可用后端时以 `SandboxUnavailableError`（`SANDBOX_UNAVAILABLE`）拒绝 |
| 策略 | `packages/sandbox/sandbox-policy` | `ctx.sandboxPolicy.resolve()`；优先级为"获批的显式模式 > 会话最后一次 `sandbox/mode` 事件 > 部署默认"；会话 cwd 是 `workspace-write` 的边界 |
| 平台后端 | `packages/sandbox/sandbox-local`（Linux: bwrap → Landlock；macOS: Seatbelt；Windows: ACL 受限令牌）、`packages/sandbox/sandbox-windows-acl` | runner 按平台链选择，竞争候选各做一次功能探测；探测结果在 provider 生命周期内缓存 |
| 消费方 | `packages/shell/bash-sandbox`、`packages/shell/pwsh-sandbox`（另有 `packages/fs/fs-sandbox`、`packages/ssh/sandbox-ssh`） | 消费方把整条 `['bash','-c',command]` 交给 `confine()`，再 spawn 返回的 argv；`danger-full-access` 下消费方直接 spawn 原始 argv，不咨询 provider |
| 模式 | `SandboxMode` | `read-only`（默认；只留 `/dev/null` 一类必需 sink）／`workspace-write`（工作区根 + 后端临时区）／`danger-full-access`（不限制） |
| 拒绝与升权 | `packages/sandbox/sandbox/src/escalation.ts`、`packages/shell/tool-bash` | 结果带 `sandbox: { mode, denied }`；模型看到 `[sandbox: file access denied under <mode> mode]`，可用升权时再追加提示；`bash` schema 增加 `sandbox_permissions`（`workspace-write` \| `danger-full-access`）与 `justification`；批准只对那一次调用有效，"重复指定调用的生效模式无需审批即可成功；更窄的目标仍然无效" |
| 边界 | `docs/subsystems/sandbox.zh.md`、`packages/shell/bash-sandbox/README.zh.md` | 只约束文件效果；网络与进程可见性不在保证范围内；需要真正隔离环境时改用容器、microVM 或远程执行器（替换整个 shell/fs 能力） |

另有一条与沙箱配套的既有设定：权限预设把"沙箱模式 + 审批策略"捆绑成具名预设（默认 `workspace-write`，另有 `danger-full-access`；Auto review 使用 Full access 的沙箱值配 `ask` 审批策略），见 `packages/interaction/permission-presets/README.zh.md`。

### B.2 逐项对照（一律用我们已有的名字）

| 维度 | DSH 的做法（事实） | 我们项目里对应的东西 | 差别 |
| --- | --- | --- | --- |
| 谁可以做什么 | 审批策略 + 权限预设决定"能否执行"，沙箱执行器只负责强制 | `authority.rules`（operation_id × resource_ref × 条件）+ `authorize(start/operation)` | 我们这一层是**决定**；DSH 那一层是**强制**，两者互补而非重复 |
| 拒绝的记录 | 结果里的 `denied` 事实；审批另有 `approval/asked` + `approval/decided` 成对事件 | `denied_calls`（`kind`/`code`/`message`/`execution_id`/`host_call_id`/`operation_id`/`tool`/`args_digest`） | 我们记了"被拒绝"，但没有"谁申请、谁决定"的配对，也没有"没有应答者时怎么办"的规则 |
| 强制的发生位置 | 内核层（bwrap / Landlock / Seatbelt / ACL），在 spawn 之前替换 argv | Docker 容器 + 最小只读挂载（`.opencode/`、`dist/`、`node_modules/`、`package.json`）+ `/opt/intent-data` 可写 | 我们靠"不把东西挂进去"，容器内部没有文件效果限制 |
| 路径/对象解析 | 后端按真实文件系统解析（Seatbelt 匹配解析后的路径、根目录要规范化） | `CURRENT-DESIGN` §3.8 已要求"路径范围必须通过具体工具 Adapter 解析实际目标（含别名/链接），不能只做字符串前缀匹配；不能宣称模型看到的权限文字已强制执行" | 方向一致；差别是我们没有把"解析/强制到什么程度"写进记录 |
| 能力事实的来源 | provider 探测 runner 能力并缓存 | 管理请求里的 `capabilities`（operations / workspace_root / material[path, exists, readable_by_executor]）与 `capability_available` 条件 | 我们的目录只说"存在/可读/可用"，不说"这个边界能保证到什么程度" |
| 失败分类 | 先判 runner 失败（命令没执行），再判拒绝（隔离生效） | 失败码里有 `capability_unsupported`、`effect_unknown`、`delivery_mismatch`、`budget_exhausted` 等；`denied_calls` 记拒绝 | 我们缺的是**报告上的分类呈现**：现在不容易一眼分辨"宿主/工具不可用"与"候选/语义被拒" |
| 被拒之后 | 同一条命令 + 最窄的充分更宽模式 + 一次性人工批准 | 整批失败后重掷；`previous_rejection` 已把上一批拒绝理由带回下一次提议 | 我们没有"定向重试一次 + 一次性确认"的通路（对接 T08，以及 `CURRENT-DESIGN` §3.12 的"确认绑定具体产物"与 §5.3/§5.4 的"F2 确认不能用于 F3 或变更基准"） |

### B.3 可借鉴的四条（每条写明落点；不引入新名字）

1. **把"这次检查能保证到什么程度"写进记录。** DSH 用 `enforcement: 'full' | 'partial'` 报告后端"只管辖子集"的情形，并明确"要求绝对边界的消费方必须拒绝或向上暴露这一区别"。我们的落点是 `authorize(operation)` 的结果与 `audit-report` 的 `permissions` 段：`CURRENT-DESIGN` §3.8 已经承认"若通用工具能绕开拦截访问其他位置，标明 unsupported"，把这种判断从"当时的一次性结论"变成记录里可读的字段即可。**`partial` 时是拒绝还是只记录，属于决策归属，先由 T04 定。**
2. **把"基础设施问题"与"策略拒绝"在报告里分开。** DSH 要求消费方先判 runner 失败、再判拒绝，否则会把沙箱故障当成任务失败。落点是 `audit-report.failures` 与人工汇报的措辞：我们已有 `capability_unsupported`、`effect_unknown` 这类失败码，需要的是分类呈现，并写明"该操作根本没有执行"。归属：T08 的失败信息归属。
3. **拒绝之后给一条"更精确范围 + 一次性确认"的通路。** DSH 的形态是"同一条命令、最窄的充分更宽模式、一次批准"。落点是我们已经有的规则——`CURRENT-DESIGN` §3.12 的"确认绑定具体产物"，以及 §5.3/§5.4 已写明的"F2 确认不能用于 F3 或变更后的基准"；把它延伸到"操作被拒 → 用更精确的对象/范围重试一次 → 需要时取一次确认"。归属：T08（理由归属与反驳）+ T04（谁有权放宽）。
4. **把"不允许静默放行"写成一致性声明。** DSH：受限策略拿不到 runner 时以 `SANDBOX_UNAVAILABLE` 拒绝，"静默的无隔离透传永远不合法"。我们现在是"未知条件返回 unsupported 并拒绝"，方向相同；建议在 `CURRENT-DESIGN` 相应段落把这句话显式写出来，让"不静默放行"不只出现在条件求值处。这是措辞对齐，不是新机制。

### B.4 不借鉴 / 不适用

- **不引入 DSH 的包结构**（服务定义 / 提供方 / 消费方三角、runner 探测链）：那是 Cordis 之上的组织方式，且我们后续要接入另一个项目。
- **不引入 `danger-full-access` 这类"绕过"档位**：我们没有等价的完全访问模式，也不应该有。
- **不把"沙箱"当成网络或进程隔离的保证**：DSH 自己写明只覆盖文件效果；我们现在的隔离来自"容器 + 只挂必须的文件"。两者不能互相替代，也不能互相冒充。
- **不把 DSH 的名字写进 `CONTEXT.md` 或术语表**。若采纳 B.3 的任一条，请用我们已有的名字（authority / 机械门槛 / `denied_calls` / `audit-report` / 确认绑定具体产物）落到相应文件，并由对应票据先做归属决定。

## 附录 B：本次只读阅读的 DSH 文件（节选）

架构与子系统文档：`docs/architecture.zh.md`、`docs/cordis-primer.zh.md`、`docs/glossary.zh.md`、`docs/agent-lifecycle.zh.md`、`docs/tool-execution-pipeline.zh.md`、`docs/testing.zh.md`、`docs/defensive-patterns.zh.md`、`docs/session-format-status.zh.md`、`docs/subsystems/{core,session,tools,llm-streaming,goal,sandbox,permission-presets,session-projection,invariants,token-meter,subagent,deliverables}.zh.md`。

源码与包 README：`packages/core/{agent-loop,session,tools}/src/*`（含各自的 `invariant.ts`）、`packages/runtime-diagnostics/invariants/src/index.ts`、`packages/llm/{llm,llm-retry,token-meter}/src/*`、`packages/session/{session-format,session-projection}/src/*`、`packages/sandbox/sandbox/src/index.ts`、`packages/interaction/user-approval/src/index.ts`、`packages/guard/{timeout-policy,repeat-tool-reminder}/src/index.ts`、`packages/experimental/auto-review/src/index.ts`、`packages/subagent/subagent/src/*`、`packages/sdk/protocol/src/*`，以及上述包各自的 `README.zh.md`。

未读/未验证：Cordis vendor 源码（按用户要求排除）、`apps/*`（Web/Desktop 渲染层）、`client/*`（UI 包）、`packages/api/*`（远端控制器）、持久化目录中的历史 schema（只读了格式版本与迁移规则，没有逐版本比对）。
