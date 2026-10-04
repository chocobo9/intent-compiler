> **历史/专题材料，非现行指令。** 保留当时的观察、方案或取舍；实现与状态须从 [模块地图](README.md) 核对，不执行本文旧“下一步”。原 CURRENT-DESIGN 节号均指历史设计。

# 长时运行下的上下文预算：一手资料、我们的实测、复合方案（2026-09-30）

> 触发：20260929-203358 那次续跑 15 轮里只有第 1、2 轮真正干活，第 3–15 轮的 13 个管理批次全部失败，失败族集中在"IR 记账"。判断依据不是观感，而是下面第 1 节的实测数字和一手研究。本文只做调查与推论，不落实现。
>
> 修订 2（同日晚）：补第 7 节"来源新鲜度与 2026 新工作"。初稿的主结论来自 2023–2025 的资料，其中与我们场景最接近的一条量化证据（coding agent、29.9 万字符上下文）是 2026-07 的工作，初稿漏掉了。

## 0. 结论摘要

1. 我们让模型在 **13 万–17 万 input token** 的上下文里做几十个 token 的精确编辑。一手研究显示这已经远超多数模型的"有效上下文"区间（RULER：声明 32K 的模型里只有一半能在 32K 保持可用表现）。
2. 规则写在最前面、数据堆在中间、输出 schema 在最后，而我们要求模型做的事在"中间"。一手研究（Lost in the Middle）指出这类任务的信息位置影响最大。
3. 175 条条款里只有 58 条是机械强制的，26 条纯属"写给模型的话"、83 条只判一部分。**把语义记账写成散文，本身就是低命中率的做法。**
4. 我们给模型的标识符是 ~104 字符的事件 id，且同一份合同每次重发 50.5KB。一手研究明确说"把晦涩标识符换成语义化短名可显著降低幻觉"，以及"工具响应要有 token 预算"。
5. 复合方向：**瘦身稳定前缀（A）+ 句柄化与代码记账（B）** 先做，**子上下文/分角色（C）** 作为对照实验。三者都是"减少模型必须记住的东西"，而不是"把提示词写得更硬"。

## 1. 我们的实测（run `intent-luna-dpipe-full-20260929-203358-8c6aebaa`）

### 1.1 请求体与真实计费

| 指标 | 数值 |
| --- | --- |
| 请求体大小 | 第 1 轮 102KB → 第 15 轮 **477KB** |
| 其中 `contract` | **恒定 50.5KB**，每次调用整份重发 |
| 其中 `source_segments` | 30KB → **205KB**（全部历史用户文本每次都重发） |
| 其中 `ir` + `compiled` | 27+26KB → 57+40KB |
| 实际 input tokens | 最小 25,786 / 中位 **134,534** / 最大 **169,313**（86 次调用） |

合同自身的构成（`dist/model/compiler-model-v2.js`，50,514 字符 ≈ 12.6k tokens）：

| 字段 | 字符 | 备注 |
| --- | --- | --- |
| `example_candidate` | 18,146 | 一份 **454 行**的示例答案 |
| `rules` | 9,758 | 长段落 |
| `ir_change_contract` | 6,881 | |
| `atom_contract` | 6,355 | |
| 其余 | 9,374 | |

提示词形态（`src/model/opencode-transport.ts`）：整个请求被 `JSON.stringify` 成**单个 text part** 发出去；`budget.requests_used` 在每次尝试前被改写，而它出现在 `contract` 之前——即**每次重试都改动了前缀**，缓存前缀复用无从谈起。

### 1.2 约束强度

`node experiments/evocode/contract-check.mjs`（175 条）：

| 判定归属 | 条数 |
| --- | --- |
| code（机械判，违反会拒或改写） | **58** |
| both | 1 |
| checker（只有独立核对能判） | 3 |
| partial（只判一部分） | **83** |
| advice（只写给模型，没有任何环节检查） | **26** |
| none / superseded / deferred | 2 / 1 / 1 |

### 1.3 失败分布（用当前构建重算 77 份真实回答）

引用不可解析的原因：`source_unknown` **39**、`quote_unresolved` 5、`segment_unknown` 4、`span_invalid` 1 —— 假阳性已清零，剩下都是模型真实缺陷（多为 104 字符 id 被截断）。

失败族（13 个失败批次）：引用不可解析 20、条目与同批已采纳文本重叠 10、旧规范文本被丢弃未声明撤回 10、**CI 阶段正当打回 9**、引用不存在对象 id 7、basis 写错事件 5、revision 号错 4。

批次账：17 批只有 4 批 accepted，`dispatches: 2`，89/180 次调用，耗时 3h22m，成绩 480/481（第 2 轮）→ 520/960（第 15 轮，分母持续变大）。

## 2. 一手资料（带原句与出处）

### 2.1 长上下文不是"能放就能用"

**RULER**（arXiv:2404.06654）摘要：

> "Despite achieving nearly perfect accuracy in the vanilla NIAH test, almost all models exhibit large performance drops as the context length increases. While these models all claim context sizes of 32K tokens or greater, only half of them can maintain satisfactory performance at the length of 32K."

**Lost in the Middle**（arXiv:2307.03172，TACL 2023）摘要：

> "we observe that performance is often highest when relevant information occurs at the beginning or end of the input context, and significantly degrades when models must access relevant information in the middle of long contexts, even for explicitly long-context models."

**Anthropic, Effective context engineering for AI agents**：

> "as the number of tokens in the context window increases, the model's ability to accurately recall information from that context decreases"

> "LLMs have an 'attention budget' that they draw on when parsing large volumes of context. Every new token introduced depletes this budget by some amount"

> "good context engineering means finding the smallest possible set of high-signal tokens that maximize the likelihood of some desired outcome"

**Chroma, Context Rot**（2025-07-14，18 个模型）：

> "models do not use their context uniformly; instead, their performance grows increasingly unreliable as input length grows"

→ 我们的中位调用 134.5k tokens，是 RULER 研究里"只有一半模型还能用"的 32K 的 **4 倍**。

### 2.2 标识符与句柄

**Anthropic, Writing effective tools for agents**：

> "We've found that merely resolving arbitrary alphanumeric UUIDs to more semantically meaningful and interpretable language (or even a 0-indexed ID scheme) significantly improves Claude's precision in retrieval tasks by reducing hallucinations."

> "We suggest implementing some combination of pagination, range selection, filtering, and/or truncation with sensible default parameter values for any tool responses that could use up lots of context. For Claude Code, we restrict tool responses to 25,000 tokens by default."

**gitrevisions（Git 文档）**：

> "The full SHA-1 object name ... or a leading substring that is unique within the repository."

→ 业内先例：长标识符靠"唯一前缀"解析，而不是要求逐字复制。

**MCP Resources 规范**：

> "Resources allow servers to share data that provides context to language models, such as files, database schemas, or application-specific information."

资源以 URI 句柄寻址，并用 Resource Templates 参数化、支持分页与缓存。

→ 把"所有源文本一次性塞进请求"换成"句柄 + 按需取"，有标准可循。

### 2.3 编辑形态：增量而非整段重发

**Aider, Edit formats**：

> "asks the LLM to specify file edits as a series of search/replace blocks. This is an efficient format, because the model only needs to return parts of the file which have changes."

> "the 'udiff' edit format is based on the widely used unified diff format... It was mainly used to the GPT-4 Turbo family of models, because it reduced their 'lazy coding' tendencies."

→ 我们现在让模型在 `revise content` 时**重新列出该条目的完整 source 集**——等价于整文件重发；Aider 的实测经验是改成"锚点 + 局部替换"更省且更少偷懒。

### 2.4 结构化输出：硬约束在哪里

**OpenAI 官方文档（Structured Outputs）**：

> "All fields must be required ... it is possible to emulate an optional parameter by using a union type with null."

> "Structured Outputs is a feature that ensures the model will always generate responses that adhere to your supplied JSON Schema, so you don't need to worry about the model omitting a required key, or hallucinating an invalid enum value"

→ 两个后果：一是我们那个 `quote: null` 占位就是这条规则的产物（也解释了它为什么必然出现）；二是 schema 层能硬约束的东西（枚举、必填、句柄格式）**不要**写成散文。

### 2.5 长时运行的两个操作性手法

**Manus, Context Engineering for AI Agents**：

> "the KV-cache hit rate is the single most important metric for a production-stage AI agent. It directly affects both latency and cost."

> "By constantly rewriting the todo list, Manus is reciting its objectives into the end of the context. This pushes the global plan into the model's recent attention span, avoiding 'lost-in-the-middle' issues and reducing goal misalignment."

**Anthropic（同上）**：长时运行的三件套 —— compaction（压缩重开上下文）、structured note-taking（落到外部文件，只把必要部分带进上下文）、sub-agent architectures（用干净上下文的分角色子代理替代单一长跑主代理）。

→ 对应到我们：把"整份 IR 的每个字"长驻上下文，是反模式；应该是"计划/清单放末尾 + 细节按需取 + 必要时分层角色"。

## 3. 把证据映射到我们的失败族

| 我们观察到的失败 | 一手证据指向 | 可用的机制 |
| --- | --- | --- |
| 39 次引用不存在的事件 id（截断 104 字符 id） | 2.2 标识符 | 短别名 `e3` / `e3.s7`；唯一前缀解析 |
| 4 次 revision 号写错 | 2.4 硬约束 | revision/digest 归代码，模型只写 id |
| 10 次"旧文本被丢弃未声明撤回" + 10 次"条目与已采纳文本重叠" | 2.3 编辑形态 | 撤回由代码派生；重叠由代码裁剪 |
| 9 次 CI 正当打回（IR 没累积前几轮要求） | 2.1 长上下文 | 缩小在上下文里的 IR 体量；把"累计要求"做成显式清单而非隐含在 57KB IR 里 |
| 每批 6–8 次调用、平均 13–17 万 tokens、重试还改前缀 | 2.1 + 2.5 | 阶段裁剪合同、请求重排（不变体在前）、修稿只发增量、KV-cache 友好 |
| 175 条里 109 条软约束 | 2.4 | 能进 schema/代码的进 schema/代码；纯 advice 从请求里删掉 |

## 4. 复合方案（候选，不做具体实现）

### 方案 A：瘦身 + 稳定前缀（成本最低，先做）

- 合同按阶段裁剪：IR 阶段不送 `atom_contract`/`checks_contract`；`example_candidate` 换成最小骨架（保留字段名与形状，删掉 454 行样例）。
- 请求重排：不变体（合同、schema、stage 指令）置前，易变体（budget、validation_errors、repair_context）置尾；重试不触碰前缀。
- `source_segments` 改为"句柄 + 按需取"：默认只给本批事件与"本批可能触及的 IR 条目所引用的段"，其余出示 `event_source_refs`（id + 摘要 + 段数）。参考 Anthropic 的 25k 工具响应上限，给我们的段列表设一个上界。
- 预期：单次 input 从 13–17 万降到 3–5 万；重试不再整份重发。**不改变任何语义权威。**
- 风险：模型可能缺上下文而选错段 → 用"按需取"补偿（一次额外的取数调用比全量重发便宜）。

### 方案 B：句柄化 + 代码记账（收益最大，可离线验证）

- 短别名：请求里每个事件/段配 `e3`/`e3.s7` 形式别名，模型的引用只写别名；代码映射回真 id（记录 normalized）。
- revision/digest 归代码：模型只写 id；只有当它的读取基准陈旧时才拒绝（与现有 digest 处理一致）。
- 撤回与重叠由代码派生：修订丢掉旧文本 → 自动补 `superseded`（basis = 本批用户文本）；模型条目与已采纳文本重叠 → 裁剪而非整批拒绝。
- 唯一前缀解析：`source_unknown` 若是某事件的唯一前缀，解析并标注。
- 预期：直接覆盖 39+10+10+4 ≈ 63 次失败中的绝大部分；CI 的正当打回不受影响（那 9 次必须保留）。
- 风险：记账由代码派生后，"账"不再反映模型的意图 → 必须把这些派生条目在记录里标成 code-owned（我们已有 `source_defaults` 的先例）。

### 方案 C：分角色 / 子上下文（对照实验）

- 角色拆分：**检索者**（只看句柄索引，回答"哪几段与本次委托相关"）+ **修订者**（只看被选出的段、目标条目、阶段清单）。
- 主上下文中只保留：当前委托、受影响条目的摘要、句柄清单、上一轮结论（Manus 的 recitation）。
- 预期：单次上下文可压到 2 万 tokens 内；代价是每轮多 1–2 次调用与一次上下文切换，且需要"检索者错了怎么办"的兜底。

### 组合建议

**A + B 先做**（A 降体积，B 降必须记住的东西；两者都能用本 run 的 77 份真实回答离线回归），**C 作为后续对照**。判据放在第 5 节。

## 5. 验证计划（离线，先于任何付费 run）

回归集：本 run 记录的 77 份真实回答 + 第 2 轮那份 accepted 的回答。

指标（改前 vs 改后）：

1. 首次尝试 clean 率（现在是 4/17 批次首试即过）。
2. 每批平均调用数（现在 6–8）与首次通过所需的尝试数。
3. 单次 input tokens（中位 134.5k → 目标 ≤ 40k）。
4. 失败族分布（期望：记账类归零，仅剩真实的语义冲突与 CI 正当打回）。
5. 语义不打折：CI 阶段的正当打回次数不得下降（它是权威）。

## 6. 待确认 / 本文未解决的问题

1. 删减合同里 26 条 advice 之后，独立核对（D1–D7）是否需要新增维度来补位——`contract-check.mjs` 已标出"D.199 现有核对维度都不覆盖"。
2. 句柄化之后，审计与人工可读性如何保持（真 id 必须能从记录还原）。
3. 方案 C 的"检索者"如果漏段，错误会被下游放大——需要限定它的输出只能是"候选句柄集"，最终选择仍由修订者做。
4. 待补一手数据：Manus 原文（`manus.im/blog/...` 直链 404，本文用的是可访问的同名归档页）与 parse-dont-validate 原文（站点 404）——若需要引用，改从 arXiv/官方镜像取。

## 7. 来源新鲜度与 2026 新工作（修订 2）

### 7.1 初稿来源的日期

| 来源 | 日期 | 距今（2026-09-30） |
| --- | --- | --- |
| Lost in the Middle（arXiv:2307.03172） | 2023-07-06（v3 2023-11-20） | ~3 年 |
| RULER（arXiv:2404.06654） | 2024-04-09（v3 2024-08-06） | ~2.4 年 |
| Chroma, Context Rot | 2025-07-14 | ~14 个月 |
| Manus, Context Engineering | 2025-07-18 | ~14 个月 |
| Anthropic, Writing effective tools | 2025-09-11 | ~12 个月 |
| Anthropic, Effective context engineering | 2025-09-29 | ~12 个月 |
| MCP Resources 规范 | 2026-07-28 | ~2 个月 |
| Aider edit formats / gitrevisions / OpenAI Structured Outputs | 无日期（现行文档） | — |

初稿只覆盖到 2025 年。用 arXiv API 按提交日期倒排重查后，2026 年有一批**比初稿更贴近我们场景**的工作。

### 7.2 2026 新工作（按与我们问题的贴合度排序）

**① 编码 agent 的上下文腐坏，带同量级实验（arXiv:2607.17937，2026-07-20，v2 2026-08-01）**
*When and How Context Rot Appears in Coding Agents: A White-Box Study of Agent Skills in Code Auditing*

> "Codex with gpt-5.4-mini passes 8/10 runs in a 10,991-character clean context but only 3/10 in both a 299,140-character relevant context and an equal-length irrelevant context."

> "Requirement coverage nevertheless stays above 92% in both long conditions, showing that a few omissions"

→ 这是初稿缺的那条**直接同量级证据**：11k 字符 80% 成功 → 299k 字符 30% 成功，且"相关长上下文"和"无关长上下文"一样糟（说明拖累来自长度本身，而不是噪声）。它还把失败归成四类（丢失要求 / 编辑漂移 / 检查失效 / 评测与运行时故障）。我们第 15 轮的请求体是 **477KB**，比它的 299k 字符还大。而且"覆盖率仍 >92%、只是少数遗漏"与我们的形状一致（39 次 id 截断、10 次漏声明，而非整体崩坏）。

**② Grounding 与 reasoning 分离（arXiv:2609.33485，2026-09-27）**

> "While Large Language Models (LLMs) advertise million-token context windows, reasoning quality often collapses as inputs grow -- a phenomenon termed context rot. This failure stems from a structural entanglement in monolithic architectures, where the massive search burden of contextual grounding exhausts the representational capacity needed for complex reasoning."

方案是把长上下文分给一组 worker 做并行局部 grounding，由一个 driver 只负责规划与归并。

→ 初稿方案 C（检索者/修订者分角色）不是"新点子"，而是当前的主流方向之一；区别是论文用 RL 训练 driver，我们要做的是零训练版本。

**③ Just-In-Time Agent Memory（arXiv:2609.34385，2026-09-28）**

> "Many existing agent-memory systems follow an Ahead-of-Time (AOT) design... such request-agnostic memory construction can discard fine-grained information that later becomes important... a Memorizer preserves complete raw histories in a hierarchical page-store with compact navigational summaries, while a Researcher iteratively retrieves, inspects, and integrates evidence for each request."

→ 给方案 A 的"句柄 + 按需取"提供了具体形状：**分层页存 + 紧凑导航摘要 + 迭代取用**。注意我们现在既不是 AOT 也不是 JIT——我们是"全量倒进上下文"，比两者都差。

**④ Commit-on-Evidence Memory（arXiv:2609.36935，2026-09-29）**

> "premature information compression can discard critical details essential for subsequent reasoning... preserves potentially useful source excerpts verbatim in a pending set, allowing subsequent context to clarify their relevance before irreversible compression."

→ 与我们的不变量同源：**规范文本必须逐字保留**（pending set ≈ 我们的 content item"sources 逐字 + 解释另存），可以被压缩的只有索引和摘要。这为"哪些能摘要、哪些不能"划了线。

**⑤ 把上下文管理当生命周期（arXiv:2607.21503，2026-07-23）**

> "Production AI agents' failures are less often due to an inability to reason well and more often because they cannot manage what is in their reasoning context... Treating it as a lifecycle, not merely a store."

→ 支持"记账/生命周期归代码"这条主线，且主张"保留 provenance 的遗忘与合并"也是设计对象。

**⑥ 工具调用形态（arXiv:2608.06370，2026-08-06，"The Bitter Lesson of Tool Calling"）**

> "Programmatic tool calling matches or exceeds native JSON tool calling in 11 of 14 models on BFCL v4, with the GPT-5.6 family achieving a 10.6% improvement"

→ 对我们的启发不是"换工具"，而是**接口形态**：与其把 57KB IR 当数据倒进上下文，不如让模型用类型化查询去取它需要的片段（把"读整份 IR"变成"按查询取"）。

**⑦ 长时程评测方法论（arXiv:2607.27283，2026-07-29）**

> "to claim a 'long-horizon failure', benchmarks must compare actual full-task success against a baseline prediction built from short, individual stages. We call the log-ratio between this prediction and actual success the horizon residual."

→ 直接适用于我们的记分方式：现在"reward=0.0（全有全无）"无法区分"这一步本来就难"与"长时程累积造成的额外损失"。应当按阶段单独测一次，用 horizon residual 归因，否则 13 轮白跑这件事没有可比口径。

**⑧ 审计与执行前闸门（arXiv:2609.35659，2026-09-28，Tracekit）**
把 intent / 自述推理 / 实际动作三通道写进哈希链账本，并在**执行前**用策略闸门拦工具调用。

→ 与我们的"digest/revision/账目归代码 + 记录派生来源"同向；如果决定把句柄化（方案 B）做进去，这套做法可以回答"真 id 如何可还原/可审计"。

### 7.3 这些新工作改变了什么推论

1. **主结论不变，但证据升级**：从"2023/2024 的通用长上下文退化"升级为"2026 年在 coding agent 上、与我们同量级（29.9 万字符）的 8/10 → 3/10"。这条应替换初稿里的 RULER 引用作为首选证据。
2. **方案 C 从"可选对照"升级为"有主流先例"**：DISCO 的 grounding/reasoning 分离 + JAM 的 Researcher 检索，都是同一目标的成熟形态。零训练版可以先做。
3. **"按需取"要给出具体形状**：分层页存 + 导航摘要 + 迭代取用（JAM），并且区分"可摘要"（索引/摘要）与"必须逐字"（规范文本，CoEM 的 pending set）。
4. **要增加一项测量改动**：按 horizon residual 的口径，为每轮单独跑一次"只跑这一轮"的基线，才能说清 13 轮白跑里有多少是长时程代价、多少是单轮本来就难。
5. **不变的部分**：方案 B（句柄化 + 代码记账）仍然成立——2026 的工作讨论的是"把检索负担搬到哪里"，没有一篇主张"让模型维护长账本"。

## 8. 来源权重与适用边界（用户校准，2026-09-30）

用户的判断：论文的想法可用，但多在**较干净的环境**里做，对数据与任务形态限制较多；大公司的**工程实现**更接近真实约束、更可靠，但可能过时；**不要盲目追新**。

### 8.1 证据支持这条校准

初稿最倚重的那条 2026 证据（arXiv:2607.17937）在它自己的摘要里就写着：

> "This 50-percentage-point difference is large but remains trend-level under two-sided Fisher tests (**p = 0.0698**)."

即：10 次重复下的 80%→30% 差异**未达 0.05 显著**。它是一个方向性信号，不是可以直接拿来做设计阈值的数字。这是"论文数字不要直接搬到我们系统"的具体例证。

### 8.2 为什么他们的结果难以直接迁移到我们这里

| 维度 | 论文常见设定 | 我们的设定 |
| --- | --- | --- |
| 任务形态 | 单会话、单产物、边界清晰 | 一个产物被 15 轮持续改写，IR 长期存活 |
| 数据 | 合成 needle / 独立样本 | 真实用户指令，跨轮交叉引用（本轮修正要改上一轮的规则，且不能碰邻居） |
| 指标 | 检索/问答准确率（recall 型） | "这一笔改动是否落地 + 权威是否认可"（**事务型**） |
| 错误代价 | 答错一个点 | 引用错一个 id 就是语义归错人；漏声明撤回就是账实不符 |
| 约束 | 可自由重组上下文 | 规范文本必须逐字保留、账目字段单写者、digest/revision 归代码 |

### 8.3 权重顺序（本项目的取值规则）

1. **我们自己的记录**：run 的批次日志、77 份真实回答、离线 replay、条款↔强制点统计——**决定权最大**，因为它们就是我们的环境。
2. **厂商工程文**（Anthropic / Manus / Chroma / OpenAI 文档 / MCP 规范）：用来拿"真实约束下的机制清单"；**只取机制，不取数字**，并默认可能过时。
3. **论文**：只取机制与假设；量化结论必须同时满足"同量级 + 统计显著 + 环境接近"才可用，否则只作方向参考并标注边界。
4. **不做定期扫新**：只在"要落地的某个机制缺依据"时**定点查证**，不按季度扫关键词。（撤回初稿里"按季度跟踪"的建议。）

### 8.4 对复合方案的影响

- 三个方案的**机制**来自工程来源与我们的失败分布，不依赖上面那些论文数字，因此结论不变：
  - A 瘦身+稳定前缀 ← Anthropic 工具响应的 token 预算、Manus 的 KV-cache 稳定性；
  - B 句柄化+代码记账 ← Anthropic 的"UUID 换语义化短名可显著降低幻觉"、git 的唯一前缀、OpenAI 的 schema 硬约束；
  - C 分角色 ← Anthropic 的 sub-agent 上下文隔离、Manus 的 recitation。
- 唯一**只来自论文**的建议是"horizon residual 口径"的测量改动。降级为**可选测量提案**：值得做的前提是我们需要一个可归因的记分口径；若只为推进度，可不做。
- 论文提供的"上下文越长越不可靠"的**方向**与我们的实测一致（中位 13.4 万 tokens、单次请求 477KB、第 3 轮起 13 连败），这一点用我们自己的数据即可支撑，不必外借。

## 9. KV-cache 专项（用户指定，2026-09-30）

### 9.1 机制

Transformer 的因果注意力里，每个 token 的 K/V 只依赖它之前的 token，所以**已算过的前缀 KV 可以复用**。一次调用分两段：prefill（把 prompt 全部读入、算 KV）与 decode（逐 token 生成）。Agent 的输入远大于输出（Manus 实测其平均输入:输出 ≈ **100:1**），因此成本与首字延迟几乎全落在 prefill 上。前缀字节完全相同的调用可以命中 KV-cache。

### 9.2 官方口径（一手）

**OpenAI, Prompt caching**：

> "Prompt caching reuses work when requests share the same prompt prefix. This provides three main benefits: Compute-efficient … Cheaper input tokens: Pay the model's reduced cached-input rate for reused tokens, **discounted up to 95%**. Faster: Reduce the time spent processing input before the response starts. Prompt caching is enabled by default for supported OpenAI models."

（另有 Prompt Caching Dashboard 用于观察命中率。）

**Anthropic, Prompt caching**：

> "Cache prompt prefixes with `cache_control` to cut costs and latency, using automatic caching or explicit breakpoints with **5-minute or 1-hour TTLs**."

> "For explicit breakpoints, verify that `cache_control` markers are in the same locations; Check that calls are made within the cache lifetime (5 minutes by default); Verify that `tool_choice`, image usage, the thinking configuration, and `output_config.effort` remain consistent between calls; Validate that you are caching at least the minimum number of tokens for your model and platform"

**Manus, Context Engineering for AI Agents**（2025-07-18）：

> "contexts with identical prefixes can take advantage of KV-cache, which drastically reduces time-to-first-token (TTFT) and inference cost"

> "Keep your prompt prefix stable. Due to the autoregressive nature of LLMs, **even a single-token difference can invalidate the cache from that token onward**. A common mistake is including a timestamp—especially one precise to the second—at the beginning of the system prompt."

> "Make your context append-only. Avoid modifying previous actions or observations. Ensure your serialization is deterministic. Many programming languages and libraries don't guarantee stable key ordering when serializing JSON objects, which can silently break the cache."

> "with Claude Sonnet … cached input tokens cost 0.30 USD/MTok, while uncached ones cost 3 USD/MTok — a 10x difference"

### 9.3 我们的实测（run `…203358`，86 次调用的 usage 记录）

| 指标 | 数值 |
| --- | --- |
| 输入 tokens 合计 | **11,065,399** |
| cache read 合计 | **111,232**（= 输入的 **1.01%**） |
| cache write 合计 | **0** |
| cache read 的非零取值 | **恒为 1408**（第三方固定前缀，与我们的 payload 无关） |
| 输出 tokens 合计 | 607,993（输入:输出 ≈ 18:1） |

即：**约 99% 的输入每次都按全价重新 prefill**，而我们一批要 6–8 次调用、3 小时 22 分跑了 14 轮。原因不是序列化不确定（我们用 `stableJson`，键已排序），而是**排序后 `budget`（每次尝试都被改写）排在 `contract`/`ir`/`source_segments` 之前**——按 Manus 的说法，一个 token 不同就从那里开始全部失效。

### 9.4 除"瘦身"以外的收益

1. **把上下文长度从"体量"问题变成"速率"问题**：稳定前缀只付一次（cache write），之后按 5–10% 价格读。最优解因此从"尽量删"变成"把高信号的东西常驻在稳定前缀里"（合同、schema、要求清单、计划），而不是指望模型在十几万 token 里回忆。
2. **缓存纪律与注意力纪律是同一条**：缓存要"前缀稳定、尾部变化"；注意力要"目标靠近动手位置"（Manus 的 recitation 就是把目标重写到末尾）。两者合成同一个布局：**大而稳定的前缀 + 末尾的复述与增量**。
3. **重试经济学**：失败形状是"一批 6–8 次尝试"，命中缓存后第 2..8 次的输入成本降到 5–10%、prefill 近乎省掉，"多试一次"变便宜——直接对着 13/15 轮白跑这个病。
4. **让尝试之间可比**：字节稳定意味着第 2..N 次尝试只差"被拒草案 + 报错"这一段，才能判断是反馈起作用还是模型这次读到了不同的世界。

### 9.5 它治不了什么、以及硬约束

- 缓存**不减少模型必须注意的内容**，只降低携带代价；语义权威、IR 记账、id 幻觉仍需别的机制。
- **TTL**：我们一批内的调用间隔 76–88 秒（5 分钟档够），但有的批次跨 22 分钟、轮与轮间隔约 15 分钟——跨轮复用只有 1 小时档（或较长 TTL 的供应商）才成立。
- **一致性**：Anthropic 要求 `tool_choice`/thinking/effort 在调用间保持一致；我们 propose 与 check 用的是不同 agent/variant，断点会不匹配。
- **可测量**：`cache_read / input` 应做进运行面板（字段已有）。当前 1.01%；若布局修好，批内目标 ≥60%。这个指标不依赖任务成败，是"上下文工程改动是否真的生效"的独立判据。

## 10. 问题清单与研究映射（不硬套）

### 10.1 要解决的问题分四层

**A 流程层（放大器：把一次失败变成一整轮损失）**

| 编号 | 问题 | 我们的数字 |
| --- | --- | --- |
| A1 | 管理批次被拒 → 插件抛错 → 执行器命令退 1 → **整轮死**（不派发、reward 0） | 15 轮里 13 轮无派发；第 2 轮之后执行器再未启动 |
| A2 | 失败即丢委托：同一事件 3 次失败被搁置，那一轮的工作永久缺席，队列越拖越后 | 17 批只 4 批 accepted；4 个事件被搁置；第 4 轮在补第 3 轮的账 |
| A3 | 预算/时间算术与真实循环不匹配 | 一批 6–8 次调用 × 76–88 秒（最长一批 1314 秒）；一次正当 IR↔CI 往返就要 5 次 |

**B 接口/上下文层（我们要求模型做它做不好的事）**

| 编号 | 问题 | 我们的数字 |
| --- | --- | --- |
| B1 | 上下文体量与位置：规则在头、数据在中、要动的东西在中间 | 请求 102KB→477KB；中位 134.5k input tokens；合同 50.5KB 每次重发 |
| B2 | 前缀不稳定 → KV-cache 几乎不命中，每次重试全价重算 | 输入合计 11.07M tokens，cache read **1.01%**（且恒为 1408），cache write 0 |
| B3 | 要求模型逐字复制 ~104 字符事件 id | 39 次 `source_unknown`（失败族首位，20 次直接判死批次） |
| B4 | 要求模型维护账本（撤回声明、条目重叠、revision 号） | 10 + 10 + 4 次 |
| B5 | 要求模型"记得"前几轮累积的要求 | 9 次 CI 正当打回（判定本身没错，是 IR 没累积） |
| B6 | 约束强度错配：软约束靠自觉 | 175 条里 code 58 / partial 83 / advice 26 / checker 3 |

**C 语义层（真难点，机械手段消不掉）**

| 编号 | 问题 | 我们的数字 |
| --- | --- | --- |
| C1 | correction/conflict 类委托要求"改旧规则但不碰邻居" | 第 3、5、7、10、12、15 轮的 change_types 含 correction 或 conflict |
| C2 | 15 轮把规范叠成一个 IR，新规则与旧规则冲突时必须显式取代 | IR 内容条目 10 条、revision 至 2；第 15 轮仍报"缺多轮累积要求" |
| C3 | 执行器实现细节（`log(0)` 应为 NaN） | 唯一让第 2 轮从 480/481 掉到 0 分的用例 |
| C4 | 权威判定（CI 的 parent_issues、独立检查 D1–D7）是设计资产 | 9 次正当打回必须保留 |

**D 观测层**

| 编号 | 问题 |
| --- | --- |
| D1 | 全有全无计分无法归因"本来就难"vs"长时程累积损失" |
| D2 | 记录里还缺"我们的假阳性 vs 模型的真实缺陷"在错误码层面的区分 |
| D3 | 上下文工程指标（缓存命中率、体积、前缀稳定性）没进运行面板 |

### 10.2 依赖结构（这一层最关键）

- A1/A2 不是根因，是**放大器**：B/C 层任何一次失败，经它们放大成"整轮 0 分 + 委托永久丢失"。
- B1/B2 是**环境**：它同时抬高 B3/B4/B5 的发生率（长上下文下抄 id、维护账本更容易错）。
- C1/C2 是**领域真难点**，不会因为上下文工程而消失。
- D 层决定我们能否判断改动是否有效。

### 10.3 研究 → 问题（逐条标注适用度）

| 问题 | 直接可用（工程来源） | 只借形状（论文/公司文，数字不可搬） | 不适用 / 有反作用 |
| --- | --- | --- | --- |
| A1 整轮死 | 无外部依据，**这是我们自己的架构结论** | — | — |
| A2 失败丢委托 | 你先前提出的"失败出 contract 交下一轮"；2607.21503 的"生命周期而非存储"只作旁证 | — | — |
| A3 预算算术 | 我们自己的账（76–88 秒/次、最长 1314 秒） | — | — |
| B1 体量/位置 | Anthropic：注意力预算、25k 工具响应上限；Manus：recitation 把目标推到末尾 | 2607.17937 的 8/10→3/10（p=0.07）只作方向 | — |
| B2 缓存 | OpenAI/Anthropic 官方文档 + Manus 的"一个 token 失效"与 10× 差价；**我们有 1.01% 的实测** | — | 把时间戳或易变字段放前缀（我们正在犯） |
| B3 长 id | Anthropic：把 UUID 换语义化短名显著降幻觉；git 唯一前缀 | — | 靠"写清楚点"的提示词（已被证无效） |
| B4 账本 | 我们自己的失败直方图 + "记账归代码"不变式 | 2607.21503 只提供框架措辞 | 让模型继续声明撤回/版本号 |
| B5 累积要求 | Manus recitation：把全局计划重写到上下文末尾；Anthropic："最小高信号集合" | JAM 的"分层页存 + 导航摘要"只能借形状（它训练了 Memorizer/Researcher） | **compaction/摘要绝不能用在规范文本上**（CoEM 的 pending set 正是警告这点） |
| B6 软约束 | OpenAI：strict schema 的硬约束（必填/枚举/null 联合） | Aider：编辑形态影响模型行为（整文件重发 vs search/replace） | 继续把机制写成散文 |
| C1/C2 领域难点 | **无外部对应**：没人研究"改写持久规范的一处而不碰邻居" | — | 用上下文工程夸大收益 |
| C3 实现细节 | 与本研究无关 | — | 归因给编译器 |
| C4 权威 | 保持现状 | Tracekit 的三通道审计可借鉴记录方式 | 任何削弱 CI 打回的做法 |
| D1 归因 | — | 2607.27283 horizon residual 只作可选测量提案 | 用它替代官方计分 |
| D2 错误码区分 | 我们自己的记录规范 | — | — |
| D3 面板 | 供应商字段已有（`cache_read_tokens` 等） | — | — |

### 10.4 优先级（与研究给的顺序不同，理由在依赖结构）

1. **先拆放大器 A1/A2**：让一次失败不再等于整轮死 + 委托永久丢失（保留 IR 修订、把缺口出成下一轮的 contract）。这是唯一"不改语义权威就能把 13/15 变成个位数"的杠杆。
2. **再做 B3/B4/B6 的机械化**（句柄、revision/digest 归代码、撤回与重叠由代码派生、能进 schema 的进 schema）：覆盖 63 次中的大多数，且可离线回归。
3. **然后做 B2/B1 的布局**（稳定前缀 + 易变尾部 + 按需取；把要求清单做成末尾复述）：成本与延迟立刻可测（cache_read/input），对 B5 也有帮助。
4. **C1/C2 留给语义层**：这是模型能力与权威判定的事，不指望机械手段。
5. **D 层随手做**：缓存命中率进面板；错误码区分"我们的不变量"与"模型缺陷"。
