> **历史/专题材料，非现行指令。** 保留当时的观察、方案或取舍；实现与状态须从 [模块地图](../../development/README.md) 核对，不执行本文旧“下一步”。原 CURRENT-DESIGN 节号均指历史设计。

# 语义核对的成本与可靠性方法（T11 研究结果，2026-09-23）

本文件是 wayfinder 研究票 **T11**（`project/development/wayfinder-cost-structure/issues/T11-judge-reliability-methods.md`）的产出：同一个模型既生成候选又做核对的已知代价与缓解方法，以及成熟的**声称级验证**方法。

**写入范围声明：**唯一写入的文件是本文件；仓库其余部分只读。**本轮没有实现任何条件、类型或接口**，没有改源码/测试/配置/官方任务数据，没有跑构建或模型调用。仓库内事实均来自只读读取。

**术语口径（`CONTEXT.md`）：**独立核对（Check）= 一次独立的模型调用，只给通过/不通过与具体理由，不能改写候选、不能给业务答案；机械门槛（Gate）= 代码可判定的拒绝条件；验收（Acceptance）= 管理层依据回传与证据的提交判断；评测（Evaluation）= 外部计分与我们的审计维度，只衡量、不放行。本文件讨论的是**独立核对**与**机械门槛的边界**，不把两者混称"闸门"。

---

## 0. 我们的现状（只读核对）

**现行核对契约**（`src/model/compiler-model-v2.ts` → `V2_CHECK_CONTRACT`，原文摘录）：

- 输出形状固定：`{ "schema_version": 2, "verdict": "consistent"|"inconsistent", "findings": [ { "claim", "expected", "observed", "refs" } ] }`。
- 角色约束："You are the independent check of one management candidate, **not its author**… judge **only whether the candidate's behavior follows the current delegation and conditions**."
- 禁止项："You may not supply the business answer, widen or narrow Authority, rewrite the candidate, or invent ids, revisions, or digests."
- 规则里已经写了："**Judge the fields the candidate actually changes; do not ask for work that the current delegation does not require.**" 以及 "Do not repeat the candidate's own claims back as evidence; cite the original input or the current IR."
- **没有任何"维度"结构**：只有自由文本的 `claim/expected/observed`。

**r10 实测（2026-09-23，`intent-on-d3w9-r1-qwen-r10`）**：

- 一次用户消息 → 2 批，每批 [提议 + 核对]；核对输出 **42,260** tokens = 该 run 全部输出（72,421）的 **58.4%**；两次核对**都判 inconsistent**。
- 第一批 1 条 finding；第二批 5 条 finding（详见 §3 的逐条对照）。0 派发。
- **候选与核对是同一 provider + 同一模型**（两处 `model: "qwen3.8-flash"`、`provider: "dashscope"`）。
- **引用不可核验**（这条同时属于 T10）：候选写占位摘要 `sha256:0000…0001` + span `[0,63)`；核对 findings 写 `sha256:77c16c00…` + span `[0,116)`；而原文是 362 个 UTF-16 码元、摘要 `sha256:2a1c9f89…`。第一批核对的 `refs[0].source_id` 甚至**直接抄了候选的占位摘要**（`source_id == digest == sha256:0000…0001`）。
- 现行实现里核对**不通过则整批不放行**（`semantic_unresolved`/`validation_failed`），因此"核对说自己不一致"会直接决定"这一批有没有成本价值"。

---

## 1. 结论

> 第 2–3 节引用的论文与实现，其精确链接（arXiv ID / 仓库文件）汇总在文末 **附录：来源链接**。

1. **"同模型评判"的偏差有一手证据，且不是玄学**：self-preference 与"自我识别能力"线性相关（Panickssery et al. 2024）；判定对**与内容无关的顺序**极敏感（Wang et al. 2023：Vicuna-13B 在 80 个查询里 66 个击败 ChatGPT）；对长度敏感（Dubois et al. 2024：控制长度后与 Chatbot Arena 的 Spearman 相关从 0.94 升到 0.98）。
2. **更致命的是"同源错误相关性"**：CoVe 的一手结论是"**attend to existing hallucinations in the context from their own generations tend to repeat the hallucinations**"，所以他们才把验证链**因式分解（factored）**、让子问题独立作答。这直接命中我们的形态：核对会同时看到"候选"与"原始输入"，与候选共享上下文与盲点。
3. **判据（rubric）结构比"评判者多强"更重要**：`Rubrics as Rewards`（2025）报告 rubric 反馈相对"直接 Likert 式 LLM-as-judge"在 HealthBench 上最高 **+31%**，并明确"using rubrics as structured reward signals yields **better alignment for smaller judges** and **reduces performance variance across judge scales**"。HealthBench 的做法是 262 位医生写 **48,562** 条 rubric 项，判定器只对**给定的一条** rubric 项输出 `criteria_met` 与解释。
4. **声称级（claim-level）验证能同时降本与提高可定位性**：FActScore 把长文本拆成原子事实、逐条对知识源验证（人类评测成本约 **$26K**，自动估计器误差 **<2%**）；Ragas 的 Faithfulness 用"句子→独立陈述（去掉代词）→逐条 NLI 判 0/1 + 理由"；DeepEval 同族（truths/claims/verdicts）。**逐条输出**意味着"哪条被判错"可被反驳，而开放式"找出任何不一致"不能。
5. **我们 r10 的第二批 findings 与文献里的三种机制部分同源**（判据发明、事后合理化、对无关改动敏感），但**不是全部**：第一批那条关于"授权对象应指向 `/app`"的 finding 指向的是候选的真实缺口（对象绑定没有可解析的宿主对象），它属于**决策归属**问题（T04），不是评判者偏差（§3）。
6. **对"生成者=评判者"的正确处置不是换模型**（用户已禁止把它当唯一出路），而是：①把判据**预先固定成维度**（D1–D6，§4.1）；②要求**证据引用可核验**（否则该 finding 不参与放行，§4.4）；③只复核**差异**（§4.3）；④把"被反驳的 finding"记成一等记录（§4.5）。换模型即便要做，也只能作为**同源程度**的一个因子，而不是判据结构的替代品。
7. **成本结构上，最贵不是"评判"，而是"重复评判"**：r10 两次核对 42.3k tokens、其中 reasoning 40.2k（17,971 + 22,230），而两次核对的结论都是不一致——也就是说**第二次核对的成本发生在"候选已经因第一次不一致而变化"的情况下，却没有携带第一次的理由**。这使核对既是最大单项成本，也是最大返工来源。

---

## 2. 证据表

### A. 同模型评判的偏差（一手研究）

| 方法/结论 | 能回答什么 | 一手来源（链接 + 关键数字/引文） | 成本结构 |
| --- | --- | --- | --- |
| **self-preference（自我偏好）** | "同源评判者会不会给自己的输出更高分" | Panickssery, Bowman, Feng, *LLM Evaluators Recognize and Favor Their Own Generations*（NeurIPS 2024；arXiv:2404.13076）："we discover a **linear correlation** between self-recognition capability and the strength of self-preference bias; using controlled experiments, we show that the causal explanation resists straightforward confounders." | 无额外调用（是既有评判的偏差）；但意味着"同源评判的可信度"需要证据而不是假设 |
| **位置偏差（position bias）** | "判定对与内容无关的顺序是否敏感" | Wang et al., *Large Language Models are not Fair Evaluators*（arXiv:2305.17926, 2023）："This manipulation allows us to skew the evaluation result… **Vicuna-13B could beat ChatGPT on 66 over 80 tested queries** with ChatGPT as an evaluator"；作者给出 Balanced Position Calibration（跨顺序聚合） | 缓解需要**至少两次调用**（交换顺序），成本 ×2 |
| **长度/冗长偏差** | "判定是否偏好更长的输出" | Dubois et al., *Length-Controlled AlpacaEval*（arXiv:2404.04475, 2024）："Even simple, known confounders such as preference for longer outputs remain"；控制长度后"increases the Spearman correlation with LMSYS Chatbot Arena from **0.94 to 0.98**" | 缓解不需要额外模型调用（回归校正），但需要记录长度 |
| **评判者自评能力/一致性的基线** | "LLM 判定与人类的一致性能到多少" | Zheng et al., *Judging LLM-as-a-Judge with MT-Bench and Chatbot Arena*（arXiv:2306.05685, 2023）："strong LLM judges like GPT-4 can match both controlled and crowdsourced human preferences well, achieving **over 80% agreement**"；同时列出 position / verbosity / self-enhancement 三类偏差 | 单次调用；对照人类标注的成本高得多 |
| **解释不可信（事后合理化）** | "findings 里的 expected/observed 文本能不能当作判定依据" | Turpin et al., *Language Models Don't Always Say What They Think*（arXiv:2305.04388, NeurIPS 2023）：加入偏置特征会让准确率"**drop by as much as 36%**"，而模型"**systematically fail to mention** in their explanations"；"CoT explanations can be plausible yet misleading" | 不加调用；直接影响"用自由文本 findings 当证据"的做法 |
| **同源→重复自己的错误** | "自查为什么抓不到自己的幻觉" | Dhuliawala et al., CoVe（arXiv:2309.11495, 2023）："models that attend to existing hallucinations in the context from their own generations **tend to repeat the hallucinations**"；因式分解（factored）变体让子问题独立作答后增益更大 | Factored 变体付出额外调用（每个验证问题独立一次），换取独立性 |

### B. 声称级验证与 rubric 判分（抓什么、漏什么、成本）

| 方法 | 抓什么 | 漏什么 | 一手来源与关键数字 | 成本结构 |
| --- | --- | --- | --- | --- |
| **FActScore** | 长文本中**原子事实**的支持比例；可定位到"哪条事实不被支持" | 不支持的价值判断/风格要求；依赖知识源质量 | Min et al.（arXiv:2305.14251, EMNLP 2023）："breaks a generation into a series of **atomic facts** and computes the percentage of atomic facts supported by a reliable knowledge source"；ChatGPT 人物传记得分 **58%**；自动估计器"with less than a **2% error rate**"；人类评测同等规模成本约 **$26K** | 分解 1 次 + 逐条验证（可批处理）；人类对照成本极高 |
| **Chain-of-Verification (CoVe)** | 生成者自己的事实错误（草稿→验证问题→独立作答→修订） | 不影响"要求本身是否被发明"这类问题；验证问题自身可能幻觉 | 同上一行来源：Wikidata 列表题精度"**more than doubles** … from **0.17 to 0.36**"；幻觉答案数 **2.95 → 0.68**（非幻觉 0.59 → 0.38）；factored / factor+revise 变体在所有任务上进一步增益 | 基础变体 +验证问题数（k）次独立调用；4 步流程 |
| **SelfCheckGPT** | 黑盒、无外部知识源的"采样一致性"（同一问题多次采样，看事实是否稳定） | 需要有采样能力；把"一致"当作"正确"会在系统性错误上失效 | Manakul et al.（arXiv:2303.08896, EMNLP 2023）：句子级 AUC-PR——随机基线 **72.96**，GPT-3 概率 **83.21**，SelfCheckGPT w/ NLI **92.50**、w/ Prompt **93.42**；passage 级 Spearman **78.30**（w/ Prompt） | **N 次采样**（论文用多次采样），成本与采样数成正比；零外部依赖 |
| **CheckList（行为测试）** | "按能力×测试类型系统地造测试"，而不是抽样通过率 | 不直接给"语义一致性"判定；是测试设计方法 | Ribeiro et al., *Beyond Accuracy: Behavioral Testing of NLP models with CheckList*（arXiv:2005.04118, ACL 2020）：用户研究中"with CheckList created **twice as many tests**, and found **almost three times as many bugs**" | 人力/调用用于造测试；一次造好可复用 |
| **Rubric 判分（HealthBench）** | 逐条 rubric 项的 binary 判定（`criteria_met`）+ 解释 | 判据是外部给定；judge 仍可能误判单条 | OpenAI *HealthBench*（arXiv:2505.08775, 2025）：5,000 段对话、**262** 位医生、**48,562** 条 rubric 项；另有 Consensus（34 个维度）；`o3` 60%、GPT-4o 32%、GPT-3.5 Turbo 16%。判定 prompt 原文："Your job is to look at a conversation and **a rubric item**, and score… Return a json object with the following fields: `explanation` and `criteria_met`." | 每 rubric 项一次判定（可批处理）；项目数决定成本 |
| **Rubric 作为奖励信号（RaR）** | 证明"用 rubric 结构"相对"直接 Likert 式 LLM-judge"的提升 | 训练方法本身不在我们范围 | *Rubrics as Rewards*（arXiv:2507.17746, 2025）：最佳变体相对"popular LLM-as-judge baselines that rely on **direct Likert-based rewards**"在 HealthBench 上最高 **+31%**、GPQA-Diamond **+7%**；"yields better alignment for **smaller judges** and **reduces performance variance across judge scales**" | 训练成本（我们不采用）；结论可借：**结构 > 规模** |

### C. 评判边界设计的实现证据

| 做法 | 原文/实现 | 对我们的含义 |
| --- | --- | --- |
| **只判给定的条目**（判据在 judge 之外） | HealthBench 判定 prompt："score the last turn … **on how well it follows a rubric item**"；`criteria_met` 为布尔；对 "such as / for example / including" 有显式例外规则 | 判据由外部 list 提供，judge 只做"命中/未命中"，**没有空间发明交付物数量之类的政策** |
| **把"源"写明** | Azure AI Evaluation 的 groundedness prompty："> **Context is the source of truth for evaluating the response.** > Evaluate the groundedness of the response message based on the provided context."；输出固定 JSON 键 `reason` / `score`(1–5) / `status`(`completed`/`skipped`) | 明确"判定依据来自哪一份材料"；我们的对应物是"委托原文 + 当前 IR"，必须写进 findings 的引用 |
| **逐条输出 + 理由** | Ragas `Faithfulness`：`StatementGenerator`（把句子拆成**不含代词**的独立陈述）→ `NLIStatementPrompt`（"return verdict as 1 if the statement can be **directly inferred** based on the context or 0 …"），逐条给 `statement`/`reason`/`verdict` | "判错哪一条"可被指认 → 可反驳、可缓存、可增量 |
| **正负双向判定** | DeepEval `FaithfulnessMetric`：先抽 `truths`（来自 retrieval context）与 `claims`（来自 actual output），再逐条 verdict，`include_reason` 默认开 | 与我们"候选 vs 当前委托"的双向核对同形（从原文推应变化 vs 从候选看实际允许什么） |
| **开放式判定的已知代价** | 我们的 `V2_CHECK_CONTRACT`：只有 `claim/expected/observed`，无维度、无"哪些维度必须被覆盖"；r10 的第二批 5 条 findings 就是这种开放简报的产物（§3） | 需要 §4 的维度集与输出形状 |

### D. 减少评判成本的结构

| 结构 | 实现证据 | 效果与前提 |
| --- | --- | --- |
| **按声称/按差异复核** | CoVe 的 factored 变体（子问题独立作答）；HealthBench 按 rubric 项判定；Ragas/Azure 逐条判定 | 成本与"声称数/条目数"成正比，而不是与"整份候选"成正比；前提是**条目可枚举**（所以要先有维度/声明结构） |
| **按内容摘要缓存已判定结论** | Langfuse `usageDetails`（`total` 由明细派生）、OpenInference 的 `llm.cost.*` 分项；`bazelbuild/bazel` 的 action cache（内容摘要→复用）；`golang/sync/singleflight`（相同 key 合并） | 只有"键"稳定（引用可核验 + 维度固定）时才安全；否则误命中会把旧结论套到新候选 |
| **重复前缀的缓存** | OpenAI Prompt Caching（"discounted up to **90%**"）；Anthropic Prompt Caching（默认 5 分钟 TTL；5 分钟写入 +25%、1 小时写入 2× 基线） | 我们的核对每次都重读"原文 + 当前 IR + 候选"，其前缀可以被缓存；代价是缓存写入与 TTL（跨批的间隔可能超过 TTL，r10 两批相隔 537.9s ≈ 9 分钟） |
| **先判"能不能判"再判"判什么"** | HealthBench 的 `status: "skipped"`（context/response 为空时不判，`score=null`）；Azure groundedness 同样有 `skipped` | 避免"信息不足时硬判"，把"不可判定"与"不一致"分开——我们目前两者都落在 `inconsistent` |

---

## 3. 错误模式对照：r10 的 findings 与文献里的错误模式

先列出原记录（只读摘录，`semantic_checks[]`）：

- **B1（第一批，1 条）**：`claim` = "The candidate grants authority scoped to the workspace."；`expected` = "…the implementation to be done in the directory '/app', so the authority rules should be scoped to '/app'. The current IR shows 'workspace_root': '/app'."；`observed` = "…use a 'resource_ref' pointing to a specific file '/app/docs/spec_v1.md' **via a 'source_id' that references the input text**, rather than a file system path or a reference to the root workspace."
- **B2-F1/F2（第二批）**：候选把 `o1`（CLI 二进制）与 `o2`（源码文件）作为两个独立 output → 被判定为"**introduces an undocumented, separate deliverable**"。
- **B2-F3**：goal `a1` 的 scope → "creates an IR graph with new outputs and links not present in the original input, representing a different scope"。
- **B2-F4**：`intent_judgments` 里的 `The pipeline can be built.` → "This adds an unsupported judgment to the IR… **redundant** to the main goal and introduces potential for error"。
- **B2-F5**：候选用 `ir_change: create task` → "This is a `goal` in the IR, **not a `task`**. The current IR schema uses `task` for specific, bounded work items…"。

| r10 错误模式 | 文献里最接近的机制 | 同源判断 | 依据 |
| --- | --- | --- | --- |
| **B2-F1/F2：发明"交付物数量"的约束**（委托没有任何关于 output 数量的要求；我们的合同反而要求原子声明 outputs 并被 coverage 覆盖） | ①"判据不在判据集内时，judge 用自己的先验补上"——rubric 文献正是为此而存在；②对无关特征的敏感性（判定可被与内容无关的改动操纵） | **部分同源** | RaR（2507.17746）：rubric 反馈相对直接 Likert 判分 +31%，且"better alignment for smaller judges"；Wang（2305.17926）：改顺序就能让结果反转（66/80）——说明判定依赖与内容无关的表征 |
| **B2-F5：用 schema 惯例判"task 还是 goal"** | 判据来自模型自己的内部惯例（"task 用于具体工作项"），而合同/IR 里没有这条 | **部分同源**（判据发明），但**不同源**于 self-preference | 现行 `V2_CHECK_CONTRACT` 明确要求"judge **only** whether the candidate's behavior follows the current delegation and conditions"，并禁止发明 id/修订/摘要——F5 的判据不在委托里；同时 IR schema 的 `create task` 正是合同允许的动作（`ir_change_contract`） |
| **B2-F4：把"冗余"当错误** | ①评判者的"风格/冗余"偏好（verbosity bias 的镜像）；②判据发明 | **不同源为主** | MT-Bench（2306.05685）把 verbosity bias 列为已知偏差；我们这边 `intent_judgments` 是设计允许的字段，"冗余"不是委托要求，也不属于任何可核验清单 |
| **B2 全部 findings 的文本形式**（`expected`/`observed` 是自由文本，没有任何一条指向可核验 span） | **解释不可信/事后合理化**：模型会理性化受无关特征影响的判断，且不提及真实原因 | **同源（有直接依据）** | Turpin（2305.04388）：准确率可下降 **36%** 而解释里"systematically fail to mention"；CoVe（2309.11495）：attend 自己的幻觉会重复幻觉 |
| **B2 整批的成本形态**（第二次核对在"不知道第一次为什么被拒"的情况下重掷） | **同源自评的共享盲点** + **重复验证**（缺少增量） | **同源** | CoVe 的 factored 变体就是这个问题的解：让子问题独立作答、不 attend 原草稿 |
| **B1：把授权对象判成"应指向 `/app`"** | 不是评判者偏差，而是**决策归属**问题：授权规则里的"操作对象"由谁决定 | **不同源** | `src/core/intent-contract.ts` 的 `PermissionRule.resource_ref: Ref \| SourceRef`——候选的写法**类型合法**；能力目录给了 `workspace_root: /app`，但没有任何规则规定"对象绑定必须由代码推导"。这正是 T04 的问题边界（谁决定对象、格式与默认值） |
| **共有的形态问题：核对与候选共享同一上下文** | 生成者与评判者同源 → 错误相关 | **同源（有直接依据）** | Panickssery（2404.13076）的 self-recognition↔self-preference 线性相关；CoVe 的"重复自己的幻觉" |

**小结**：r10 的 findings 里，**真正站得住的是 B1**（候选的对象绑定确实没有指向可解析的宿主对象），但它属于归属问题；**B2 的 5 条里至少有 3 条属于"判据不在委托内"**（F1/F2/F4/F5），它们的共同机制不是"模型太弱"，而是**核对简报没有维度、没有可核验证据要求**。

---

## 4. 特化提案（与 `semantic_checks` / `management_log` / `audit-report` 逐项对应）

> 以下都是**设计与记录提案**，用于 T07/T08/T04 的输入；本票不实现、不改契约。

### 4.1 核对该判的**维度**（不是措辞清单）

维度是"判什么类型的事"，措辞由每次输入决定——这样既不把现象写成清单，也不给 judge 自由发明判据的空间。

| 维度 | 判什么 | 依据（每条的 expected 必须能指向这里） | r10 中应命中的情形 |
| --- | --- | --- | --- |
| **D1 委托对象与材料角色** | 候选把哪些材料当"处理对象/上下文/示例" | 委托原文的 span + `bindings.role` | r10 委托是"按 `/app/docs/spec_v1.md` 实现工具"——材料角色应被保留 |
| **D2 输出与字段范围** | 每个要求的作用位置（task / output / 字段路径）是否被保留 | 委托原文 span + `content.scope` | 委托没有对 output 数量作要求 → **不得**以"多了一个交付物"判不一致；若委托明确了"只要二进制"，才落在本维度 |
| **D3 授权对象与范围** | `authority.rules` 的 `operation_id × resource_ref` 能否解析到宿主对象 | 能力目录（`capabilities.workspace_root`、`operations`） | **B1 应落在这一维度**（对象绑定不可解析） |
| **D4 未变要求的去向** | 现存 goal/条件/输出是否都有 coverage 去向，paused/unresolved 是否正当 | 当前 IR 的全部条目 | 委托只有一条目标；coverage 有去向即满足 |
| **D5 引用可核验** | 每个 `ref` 的 `source_id`/`digest`/`span` 是否与真实原文一致 | 原文（由代码计算） | r10 候选与核对**都不通过**这一维度 |
| **D6 是否引入委托外要求**（反向） | 候选是否新增了委托中不存在的要求/交付物/限制 | 委托原文 span（必须给出"没有依据"的定位） | B2-F1/F2/F4/F5 的正确处理方向：**要么指出委托中的依据，要么不判** |

**硬规则（建议写进契约）**：任何 finding 的 `expected` **必须**引用委托原文或当前 IR 的可核验 span；引用"通常做法/最佳实践/schema 惯例"的 finding **不接受**。这一条直接对应 `V2_CHECK_CONTRACT` 里已有的"cite the original input or the current IR"——只是把它从"建议"变成"可机械判定的门槛"。

### 4.2 输出形状（在现有 `semantic_checks` 上做加法）

```jsonc
{
  "schema_version": 2,
  "verdict": "consistent" | "inconsistent" | "undetermined",
  "dimensions_checked": ["D1", "D2", "D3", "D4", "D5", "D6"],
  "findings": [
    {
      "dimension": "D3",
      "claim": "…", "expected": "…", "observed": "…",
      "expected_refs": [ /* SourceRef：必须可核验 */ ],
      "observed_refs": [ /* SourceRef 或候选内定位 */ ],
      "severity": "blocks_dispatch" | "records_only"
    }
  ]
}
```

与现有 `SemanticCheckRecord` 的对应：新增 `dimensions_checked`、`findings[].dimension`、`findings[].expected_refs/observed_refs`、`verdict: "undetermined"`；保留 `claim/expected/observed/refs`（兼容既有记录）。`severity` 的作用是区分"阻止派发"与"仅记录"——**不是**预算参数：`records_only` 的条目仍然要留下，但按 CONTEXT 的口径不得单独阻止放行（放行与否由 T04/T07 定归属）。

### 4.3 何时可以只复核**差异**

三个条件同时成立时才允许"只复核差异"（这是**范围**问题，不是预算问题）：

1. 上一轮不一致的 findings 已被持久化，并且本轮提交的是**字段级 patch**（差异集明确、可枚举）；
2. 差异集之外的候选内容**摘要未变**（内容寻址可判：`candidate_digest` / `compiled_revision` 对应的内容块不变）；
3. 差异集落在**维度子集**内（例如只改了 outputs 的声明 → 只查 D2/D4/D6）。

依据：CoVe 的 factored 变体（独立回答子问题，避免 attend 自己的草稿）、Ragas/HealthBench 的逐条判定、内容寻址增量（Bazel action cache）、重复前缀缓存（OpenAI/Anthropic）。**反例条件也要写明**：一旦差异集触及授权对象（D3）或引用（D5），必须全量复核这两维——这两维的错会被"放行"直接放大到执行层。

### 4.4 误报如何被**反驳**与记录

| 步骤 | 做什么 | 记在哪里 | 谁判 |
| --- | --- | --- | --- |
| 1. 引用门槛 | finding 的 `expected_refs`/`observed_refs` 必须能在原文/当前 IR 上解析（source_id 存在、digest 匹配、span 在范围内）；否则该条按"不可核验"标注，**不参与放行** | `semantic_checks[].findings[].refs_valid` | 代码（机械门槛） |
| 2. 维度门槛 | finding 的 `dimension` 必须在允许集合内；`expected` 若引用惯例则拒收 | 同上 | 代码（机械门槛） |
| 3. 反驳通道 | 下一次 propose 可对具体 finding 提交 `counter_evidence`（指向委托/IR 的 span）；原 finding 与反驳**同时保留** | `management_log[]` 新增 `finding_challenges[]`（或独立记录） | 模型提出、代码保存 |
| 4. 裁决 | 只在反驳**可核验**且与 finding 直接冲突时，本批不再因该条不放行；冲突本身作为争议保留 | `semantic_checks[]` + `audit-report` D5 | 代码判"是否可核验/是否同维度"；**语义裁决不由同一次核对自裁**，冲突按 T08 的规则处理 |
| 5. 统计 | 按维度统计：findings 数、可核验比例、被反驳数、反驳结果、`undetermined` 数 | `audit-report` D5 扩展 | 审计（评测维度） |

**为什么不让核对自裁**：核对与候选同源（Panickssery 2024；CoVe 2023），让同一次核对自己撤销一条 finding，等于把"同源偏差"变成"自我确认"。可行的做法是"争议保留 + 不放行依赖该争议的行为"（这与 CONTEXT 里"若无法消解且会改变授权，只阻止依赖该差异的操作"一致）。

### 4.5 与三份记录的逐项对应

| 记录 | 现在 | 建议新增 | 解锁的判断 |
| --- | --- | --- | --- |
| `semantic_checks[]`（`SemanticCheckRecord`） | `verdict`、`findings{claim,expected,observed,refs}`、`usage`、`response_digest` | `dimensions_checked[]`、`findings[].dimension`、`findings[].refs_valid`、`duration_ms`（T10）、`verdict: "undetermined"` | 核对"判了什么"、"误报率"、"成本" |
| `management_log[]`（批次） | 批次时长、usage、状态 | `finding_challenges[]`、`shape{rejection_reason_present}`（T10）、`patch_vs_rebatch` 标记 | "重掷 vs 修订"的机制是否被观察、反驳是否真的被消费 |
| `audit-report.json` | D5：`self_reported_checks`/`independent[]{sequence,verdict,findings,task_ids}` | D5 扩展：按维度的 findings 数、可核验比例、被反驳数、`undetermined` 数；D8 增加 check 的时长与首包时间 | 用审计视角回答"核对的成本换来了什么" |

---

## 5. adopt-from（可借鉴的实现）

| 借用项 | 参考实现（仓库 + 文件 + 许可证） | 抄哪一段 | 改写哪一段 | 适配到我们哪个文件 | 风险与代价 |
| --- | --- | --- | --- | --- | --- |
| **逐条声称判定（拆句 + NLI + 理由）** | `explodinggradients/ragas` → `src/ragas/metrics/_faithfulness.py`（Apache-2.0）：`StatementGenerator`（"Break down each sentence into one or more fully understandable statements. Ensure that **no pronouns** are used"）+ `NLIStatementPrompt`（"return verdict as **1** if the statement can be directly inferred based on the context or **0**…"，逐条给 `statement`/`reason`/`verdict`） | 两个 prompt 的职责切分（先拆成自足陈述，再逐条判 0/1 + 理由）与输出模型（`StatementFaithfulnessAnswer`） | 把"context"换成"委托原文 + 当前 IR"；把"statements"换成"候选声明的行为/要求"；保留逐条 verdict + reason | `src/model/compiler-model-v2.ts`（check 契约与 strict schema）、`src/core/compiler-store-v2.ts`（`semantic_checks` 结构） | 拆分本身会引入误差（拆分错→判定错）；必须让拆分结果也可被引用/反驳；调用数增加（拆分 + 判定） |
| **claims/truths 双向判定** | `confident-ai/deepeval` → `deepeval/metrics/faithfulness/faithfulness.py`（Apache-2.0）：`_generate_truths` / `_generate_claims` / `_generate_verdicts` / `_generate_reason`，`include_reason=True` | "从源抽 truths、从产物抽 claims，再逐条比对"的三段式与可读理由 | 我们的"源"是委托与 IR，"产物"是候选；严格性（如 `penalize_ambiguous_claims`）由 T07 决定 | 同上 | 若把"未提及"直接算成错误，会制造大量误报；需要 D4 的"去向"语义 |
| **"只判给定条目"的判定契约** | `openai/simple-evals` → `healthbench_eval.py`（MIT）："Your job is to look at a conversation and **a rubric item**, and score the last turn … Return a json object with the following fields: `explanation` and `criteria_met`."；含 `such as/for example` 的例外规则与负分条目规则 | prompt 的"单条目、布尔输出、带例外规则"结构；以及 `RubricItem(criterion, points, tags)` 的数据形状 | 把 rubric 项换成我们的 D1–D6 维度下的**具体条件**（由代码/IR 生成，模型不生成判据） | `src/model/compiler-model-v2.ts`（check 契约） | 需要外部生成"条目"（我们还没有这一步）；条目生成错了会把错误固化 |
| **"源是唯一真值"与 `skipped`** | `Azure/azure-sdk-for-python` → `sdk/evaluation/azure-ai-evaluation/azure/ai/evaluation/_evaluators/_groundedness/groundedness_without_query.prompty`（MIT）："**Context is the source of truth** for evaluating the response."；输出固定 JSON `reason`/`score`(1–5)/`status`(`completed`\|`skipped`) | "信息不足时 skip 而不是硬判"的语义与固定 JSON 键 | 我们的 `undetermined` 对应 `skipped`；"source of truth"对应"委托原文 + 当前 IR" | `src/core/intent-contract.ts`（verdict 枚举）、`src/core/compiler-store-v2.ts` | 需要防止"动不动就 skip"变成逃避；应统计 `undetermined` 比例（审计维度） |
| **引用必须可核验（门槛）** | 无单一现成实现；相邻实现是 OTel 的 `SourceRef` 语义与我们自己的 `capabilities` 目录（T10 文档 §2） | — | — | `src/core/intent-contract.ts`（span/digest 校验）、`src/core/intent-compiler-v2.ts`（写入前校验） | **仅文献/自建**：没有找到可直接抄的"引用核验器"；实现成本低但必须先定 digest 口径（T10 §7 问题 1） |
| **按内容摘要缓存已判定结论** | `bazelbuild/bazel`（Apache-2.0）的 action cache 概念骨架；相邻：`zilliztech/GPTCache`（MIT，语义缓存） | "输入摘要 → 复用输出"的键设计 | 我们的键 = （委托内容摘要，候选差异集摘要，维度子集）；值是上一次的 finding 集合 | `src/core/compiler-store-v2.ts`（记录与查询） | 语义缓存的"近似命中"在判定场景是危险的；**只接受精确摘要命中**（不采用 GPTCache 的向量近似部分） |
| **重复前缀的成本降低** | OpenAI Prompt Caching 文档（"discounted up to 90%"）；Anthropic Prompt Caching 文档（5 分钟 TTL；写入 +25% / 2×） | "同一前缀重复读取更便宜"的事实与量化 | 我们只需把前缀稳定（原文 + IR + 契约文本顺序固定）以便命中 | `src/model/structured-provider-transport.ts`（请求组装）、`src/model/compiler-model-v2.ts`（prompt 顺序） | 我们用的是 dashscope，其缓存政策与 OpenAI/Anthropic 不同（r10 有 `cache_read: 3584`，说明确有缓存命中）；不能假设折扣比例 |
| **解释不可信的反制** | Turpin et al.（arXiv:2305.04388）**仅文献**：解释了为什么不能用自由文本作为唯一依据 | — | — | — | 结论：findings 必须带可核验引用，而不是只带文字 |

**仅文献（不进采纳清单）**：Panickssery 2024（self-preference）；Zheng 2023 MT-Bench；Wang 2023；Dubois 2024；FActScore；CoVe 的算法本体（无官方代码仓库）；SelfCheckGPT 的采样法（我们不做多采样，成本与收益需另算）；CheckList。

---

## 6. 开放问题

1. **D1–D6 是不是正确的维度切分**：它来自 r10 的失败形态 + 合同的既有职责（引用/授权/coverage），但**没有经过多形状验证**。需 T01 的判据成熟后复核；T07 负责"范围与上界"，本票只给输入。
2. **"条目"由谁生成**：HealthBench 的条目由医生写，我们不可能人工写。可行方向是用 IR 的结构（goal/outputs/content.scope/authority.rules/coverage）机械生成"待判条目"，模型只判命中——但这会把"条目生成"的错误引入判定（需要 spec 级设计）。
3. **`undetermined` 的处置**：按 CONTEXT，"无法消解且会改变授权时只阻止依赖该差异的操作"。那么 `undetermined` 是否等同于阻止？需要 T07/T08 定。
4. **同一模型的两条偏差（self-preference 与事后合理化）能否用"顺序/角色分离"缓解**：CoVe 的 factored 变体给了方向（独立作答），但未在我们这种"候选 vs 委托"场景验证过。若要验证，需要一次**形状可控**的实验（属于运行授权范围）。
5. **核对的成本能否与"发现数"建立关系**：如果 D1–D6 固定，核对成本主要由"条目数 × 上下文大小"决定；我们目前连"条目"都还没有，因此这个关系只能先算方向，不能给系数。
6. **是否需要跨模型核对**：用户禁止把它当唯一出路；RaR 的结论（结构 > judge 规模）提示它的优先级应低于"判据固定 + 引用可核验"。若将来要做，应作为**同源程度**的因子（同源/异源两水平）纳入实验设计，而不是作为默认路线。

---

## 附录：来源链接（精确 URL）

**偏差与判定一致性（一手论文）**

- Panickssery, Bowman, Feng, *LLM Evaluators Recognize and Favor Their Own Generations*（NeurIPS 2024）：<https://arxiv.org/abs/2404.13076>
- Zheng et al., *Judging LLM-as-a-Judge with MT-Bench and Chatbot Arena*（2023）：<https://arxiv.org/abs/2306.05685>
- Wang et al., *Large Language Models are not Fair Evaluators*（2023）：<https://arxiv.org/abs/2305.17926>
- Dubois et al., *Length-Controlled AlpacaEval*（2024）：<https://arxiv.org/abs/2404.04475>
- Turpin et al., *Language Models Don't Always Say What They Think*（NeurIPS 2023）：<https://arxiv.org/abs/2305.04388>

**声称级验证与 rubric 判分**

- Dhuliawala et al., *Chain-of-Verification Reduces Hallucination in LLMs*（2023）：<https://arxiv.org/abs/2309.11495>
- Manakul et al., *SelfCheckGPT*（EMNLP 2023）：<https://arxiv.org/abs/2303.08896> ；实现 <https://github.com/potsawee/selfcheckgpt>（MIT）
- Min et al., *FActScore*（EMNLP 2023）：<https://arxiv.org/abs/2305.14251> ；实现 <https://github.com/shmsw25/FActScore>（MIT）
- Ribeiro et al., *Beyond Accuracy: Behavioral Testing of NLP models with CheckList*（ACL 2020）：<https://arxiv.org/abs/2005.04118>
- OpenAI, *HealthBench*（2025）：<https://arxiv.org/abs/2505.08775> ；判定实现 <https://github.com/openai/simple-evals/blob/main/healthbench_eval.py>（MIT）
- *Rubrics as Rewards*（2025）：<https://arxiv.org/abs/2507.17746>

**可借鉴实现**

- Ragas `Faithfulness`（Apache-2.0）：<https://github.com/explodinggradients/ragas/blob/main/src/ragas/metrics/_faithfulness.py>
- DeepEval `FaithfulnessMetric`（Apache-2.0）：<https://github.com/confident-ai/deepeval/blob/main/deepeval/metrics/faithfulness/faithfulness.py>
- Azure AI Evaluation groundedness（MIT）：<https://github.com/Azure/azure-sdk-for-python/blob/main/sdk/evaluation/azure-ai-evaluation/azure/ai/evaluation/_evaluators/_groundedness/groundedness_without_query.prompty>
- 内容寻址增量（骨架借鉴）：<https://github.com/bazelbuild/bazel>（Apache-2.0）
- 语义缓存（仅对照）：<https://github.com/zilliztech/GPTCache>（MIT）
- OTel GenAI token/时间字段：<https://github.com/open-telemetry/semantic-conventions-genai>（详见 T10 文档的附录）
- 缓存与成本口径：<https://platform.openai.com/docs/guides/prompt-caching>、<https://docs.anthropic.com/en/docs/build-with-claude/prompt-caching>

**机制与恢复（与 T09 共用）**

- Metastable failures（HotOS '21）：<https://doi.org/10.1145/3458336.3465286> ；形式化后续 <https://arxiv.org/abs/2510.03551>
- Google SRE Book, *Handling Overload*：<https://sre.google/sre-book/handling-overload/>
