> **历史/专题材料，非现行指令。** 保留当时的观察、方案或取舍；实现与状态须从 [模块地图](../../development/README.md) 核对，不执行本文旧“下一步”。原 CURRENT-DESIGN 节号均指历史设计。

# Intent Compiler：从开放主张到可证伪实验

> **资料职责更新（2026-09-21）：** 下一候选的当前设计、实现契约与实施顺序统一见 [DESIGN-HISTORY.md](../../development/DESIGN-HISTORY.md)；既有实现/实验事实和正式分阶段研究仍见 [spec](spec.md)。本文保留研究与可行性证据，不覆盖新方案；下文的“下一步”和进度是原记录的时间背景，不表示已启动或完成下一候选。

> **生成时间**：`2026-09-14T09:06:26-04:00`
> **研究问题**：在不预设 Atom、Relation、图或具体实现的情况下，怎样把通用意图管理层的“可用、可迁移和高效”逐级转化为可证伪的实验主张？

更新至 2026-09-17。本文汇总外部研究与本地可行性证据；当前项目决定、实现状态和下一步以 `.scratch/intent-compiler-experiment/spec.md` 为准。本文不预设 Atom、Relation、图、schema、存储或编译算法，也不因保留历史核查而恢复已退出范围的运行时选择。

> **语义与运行绑定校正（2026-09-16）**：本文中的实验边界以项目既有链路为准：Intent Compiler 管理 Intent IR，并向 Exec Loop 输出独立的 Compiled Intent。首版绑定已经更新为 **OpenCode 插件形态的管理层**；WorkSwarm/openJiuwen 不再属于本项目范围，具体接口与观测依据见第 15 节。管理层直接序列化并交付 Compiled Intent，不设独立 Compiled Intent Adapter；“完整上下文包”或任意上下文预处理不等于 Compiled Intent。Raw history、rolling summary、retrieval memory，以及具名的 RECAP / U-Fold / IDSS 对照默认是 comparison baselines；只有满足 Compiler 功能契约的实现才计为 Compiler treatment。EvoCode-Bench 等既有证据已经支持长程意图偏移问题的存在，本项目的 0a 不再把“问题是否存在”作为研究主张，而是在选定测试载体上取得可复现的 baseline failure profile，并确认它足以区分后续 Intent IR 机制。项目目标是主动设计、消融和验证 Intent IR 方案，不是建立一个对所有架构保持中立的排行榜。
>
> **机制命名修补（2026-09-16）**：文献机制必须保留原文对象、更新触发、控制流和评测量；项目用法另标为设计推论。项目雏形使用项目名，不把 TMS、ATMS、VoI、ORACLE-SWE 或 Adapter 的文献/工程身份借给未实现的子集。对照 arm 写 RECAP、U-Fold、IDSS、ContextCov 全名，不用 rewrite / folding / state 三词代替。摘要不足以还原的内部 API 标为来源不足，不补造。`verification-driven state transition` 与 `TMS-lite` 不再作为机制名称。

## 结论先行

下一步不应直接做“某版 IR 对 raw history”的单一 A/B。那最多证明一个实现，不足以形成 Intent IR 的设计知识。更有解释力的研究应固定 **Intent Compiler 的语义契约**：它持续接收新增交互和可访问证据，管理中间 Intent IR，并向固定的下游 executor 输出独立的 Compiled Intent；同时在这个契约下主动设计和比较不同表示、关系、更新、推断与编译机制。Intent IR 可以是显式、latent 或混合方法，但具名的 RECAP / U-Fold / IDSS 对照，以及 rolling summary 与 retrieval memory，默认仍是比较基线。

核心实验问题由此变为：在模型、信息、执行器和成本受控时，是否有多个内部机制不同、但满足同一 Intent IR → Compiled Intent 契约的 Compiler，能够减少渐进交互中的首次偏移、旧要求污染、错误任务合并和恢复失败？如果没有单一机制处处胜出，但该语义契约在多个领域稳定产生可预测收益，这本身就是“较通用管理层”成立的一种结果，而不是失败。

## 一、证据目前支持到哪一层

| 证据层 | 当前判断 | 直接依据 |
|---|---|---|
| 存在性 | 强：固定、一次性意图假设会高估长程表现 | Microsoft 将四类静态 benchmark 转成 reveal/revise/switch 轨迹后观察到跨模型下降；LHAW 在三类长程任务中验证了 outcome-critical、divergent、benign 缺口。[Evolving Intent](https://arxiv.org/abs/2607.20734) · [LHAW](https://arxiv.org/abs/2602.10525) CarryOnBench 另在看似有害、实为 benign 的请求上，于多轮澄清后测量信息效用恢复与安全，并报告 utility lock-in、unsafe recovery、repetitive recovery；这是安全澄清场景的 recovery 失败谱，不是 coding 中的 revise/retract/occurrence 维护证据。[CarryOnBench](https://arxiv.org/abs/2604.27093) |
| 机制 | 中等：若干管理机制在限定场景有效 | 下列机制不得合成一个“何时问”或“上下文管理”胜者。RECAP 把 user–agent 对话改写成简洁用户目标，用 LLM evaluator 比较规划效用（plan preference），并另有 prompt rewriter 与 DPO rewriter；全文改写算法本轮仅核到摘要，标为来源不足。[RECAP](https://aclanthology.org/2026.findings-eacl.105/) U-Fold 保留完整对话与 tool-call history，每轮另产 evolving dialogue summary 和 compact task-relevant tool log。[U-Fold](https://aclanthology.org/2026.findings-acl.897/) IDSS 把 tool return 解析为带 provenance 的实体/属性，跟踪 user intents、required variables、constraints 与 execution status，并把新事实传播到约束可执行性。[IDSS](https://arxiv.org/abs/2608.15755) SAGE-Agent 在工具参数及其定义域上计算 EVPI 以选择澄清问题，并区分 specification uncertainty 与 model uncertainty。[SAGE-Agent](https://aclanthology.org/2026.findings-acl.2028/) 独立的 VoI 框架比较提问带来的任务效用增益与用户认知成本，实验域为 20 Questions、医疗诊断、订票和电商，不是工具参数空间；它与 SAGE-Agent 不是同一机制。[VoI](https://arxiv.org/abs/2601.06407) |
| 迁移 | 弱到中等：现有结果各自跨若干数据集，但没有同一 treatment 跨开放长任务、代码、工具工作流与真实用户完成复现 | Evolving Intent 跨数学、SQL、搜索和 SWE，但只构造三种 transition；AcCoRD 只覆盖购物与旅行中的偏好动态；IDSS/U-Fold 主要依赖既有用户模拟环境。[Evolving Intent code](https://github.com/microsoft/evolving-intent) · [AcCoRD](https://arxiv.org/abs/2608.27818) · [IDSS](https://arxiv.org/abs/2608.15755) |
| 效率 | 初步而非充分：已有 token、turn、tool-call 或 feedback-cost 收益，但尚无共同预算下的统一比较 | IDSS 报告零额外 LLM 调用并减少 turn；U-Fold 报告更少重复 tool call，但更强 folder 会转移模型能力。ContextCov 把仓库指令编成静态 AST 查询、runtime shell shim 和架构校验三类可执行检查，在 SWE-bench Lite 上相对 prompt-only / LLM reflection 报告更高约束合规和更低 feedback cost（字符与时间）；它拦截的是开发者仓库规则，不是用户演进 Intent。[IDSS](https://arxiv.org/abs/2608.15755) · [U-Fold](https://aclanthology.org/2026.findings-acl.897/) · [ContextCov](https://arxiv.org/abs/2603.00822) |

## 二、证据与研究梯度

实验应逐级主张，不能从一次胜利跳到“通用”。

1. **C0：测试载体上的 baseline profile。** 在相同最终任务难度下，记录变化密度或任务交织对 turnwise reliability 的影响。它用于确认当前 testbed 能区分后续 Intent IR 方案，并为实验提供基线失败分布；不是重新证明长程意图问题普遍存在。若敏感性不足，只能说明该 testbed 不适合承担这一比较。
2. **C1：Intent IR 局部有用。** 至少一个管理独立 Intent IR 的 Compiler treatment 在预注册任务族上优于最强匹配 baseline，并改善独立的意图指标，而不只是 final success。
3. **C2：Intent IR 架构证据。** 至少两个内部机制不同、且都管理 Intent IR 并输出 Compiled Intent 的 Compiler 各自取得可重复收益，并通过适用的状态和组件消融形成“什么机制对什么变化有效”的设计知识；收益不能仅由多一次模型调用、更强模型或更长上下文解释。
4. **C3：较通用。** 相同接口和更新协议不经领域定制即可迁移到未见任务、变化组合和至少两个执行环境；内部机制可以存在异质性，不要求同一机制处处最优。
5. **C4：高效。** 相对最强 baseline，Compiler 位于 performance–cost Pareto frontier；或在等可靠性下显著降低 token、延迟、询问、工具调用与返工。

Intent formalization 研究也把 specification validation 视为核心瓶颈，并明确指出没有脱离用户的最终 specification oracle；因此本实验只能证明上述操作性主张，不能宣称恢复了用户不可观察的私人心理状态。[Intent Formalization](https://arxiv.org/abs/2603.17150)

## 三、实验对象：固定语义契约，不固定表示

对所有 treatment 只规定三件事：

- 输入资格相同：新增用户输入、同一可访问源历史、同一工具/环境证据；
- 下游契约相同：Compiler 输出独立的 Compiled Intent；System Prompt、memory、history 和工具上下文保持分离；Exec Loop 不修改 Intent IR 或 Compiled Intent；
- 记录义务相同：每轮记录输入/输出 token、调用次数、墙钟时间、询问、工具动作和状态变更。

不规定 Intent IR 是否以文件持久化、Compiled Intent 是否可读、内部是否显式分解。具名对照（raw history、rolling summary、retrieval memory、RECAP、U-Fold、IDSS）先作为 comparison baselines；只有当某个实现满足完整功能契约时，才额外作为 Compiler competitor 分析。

## 四、基线与控制变量

建议至少包含以下 arms：

| Arm | 作用 |
|---|---|
| Full raw history | 检验完整信息但无显式管理；在上下文未溢出和溢出前后分别报告 |
| Recent window | 建立最弱但低成本基线 |
| Rolling summary | 检验有损压缩；U-Fold 与 IDSS 均观察到静态/周期摘要丢失细粒度字段或滞后意图 |
| Retrieval memory | 检验“按相似度召回历史”是否足够处理失效和 occurrence identity |
| RECAP-style conversation rewrite | RECAP 原文把对话收成简洁用户目标，评的是 agentic planning 的 plan preference；本实验把它当作开放文本对照，不把它当成 Intent IR。全文改写算法与 DPO 训练细节本轮仅核到摘要，标为来源不足。[RECAP](https://aclanthology.org/2026.findings-eacl.105/) |
| U-Fold-style context folding | U-Fold 原文保留完整 user–agent 对话和 tool-call history；每轮另产 intent-aware evolving dialogue summary 和 compact task-relevant tool log。不是丢掉原文、只留 state+evidence。[U-Fold](https://aclanthology.org/2026.findings-acl.897/) |
| IDSS-style situation tracking | IDSS 原文维护与对话并行的显式 situation state：解析 tool 返回为 provenance-aware entities/attributes，跟踪 intents、required variables、constraints、execution status，并把新事实传播到 action executability。[IDSS](https://arxiv.org/abs/2608.15755) |
| Candidate Compiler(s) | 待研究方法；内部表示不受限制 |
| Extra-call sham | 使用相同模型调用和 token 预算，但只重排/复述等价上下文，用于排除“多想一次”的收益 |
| Guardrail-only（ContextCov-inspired） | 保留原理解链，仅强化下游可执行约束检查。ContextCov 的对象是 AGENTS.md 类仓库指令，机制是 AST 查询、shell shim 与架构校验，评测是约束合规及相对 LLM reflection 的 feedback cost；用来区分理解收益与执行拦截收益，不是意图理解基线。[ContextCov](https://arxiv.org/abs/2603.00822) |

每个 arm 使用同一 executor 模型、工具、温度/seed 集合、每轮 action budget 和初始环境。至少报告两种预算制度：**等总 token/调用预算**与**自然运行成本**。U-Fold 的更强 folder 能把能力转移给弱 executor，正说明不控制 compiler 模型会把“架构收益”和“额外模型能力”混在一起。[U-Fold](https://aclanthology.org/2026.findings-acl.897/)

## 五、任务轨迹怎样生成

### 5.1 从可验证任务反向构造

从有确定 verifier 的完整任务出发，作者先制作仅用于评测的 **current-intent ledger**：每轮哪些要求有效、失效、未决，哪些行为后果应改变。它不是候选 IR，而是实验 oracle。然后把完整任务转成多轮轨迹。Evolving Intent 证明该方法能复用原 benchmark verifier；LHAW 进一步表明，删去 Goal、Constraint、Input、Context 后必须通过实际 rollout 区分 benign、divergent 与 outcome-critical，而不能只靠模型判断“这似乎有歧义”。[Evolving Intent](https://github.com/microsoft/evolving-intent) · [LHAW dataset/code](https://github.com/scaleapi/lhaw)

数据切分应以 base task、最终语义目标和 twin group 为单位，保证同一任务的改写、反事实与相邻轨迹不会跨入 train/dev/test；所有 arm 使用相同的开发集调参预算。

代码域可直接复用 EvoCode-Bench 的持久 workspace 与逐轮 cumulative tests，但必须采用其 2026-06-20 之后的修复版。官方仓库曾因 agent 可读 grader、污染任务和 11 个 task/test 缺陷撤回旧结果，这说明 verifier 隔离、reference solution 全轮通过、测试—当前要求逐条追踪和 shortcut audit 都应成为硬性实验协议。[EvoCode-Bench official repository](https://github.com/UniPat-AI/EvoCodeBench)

### 5.2 不局限于 reveal / revise / switch

轨迹因素至少应覆盖：

- retract/relax：撤回或放宽旧要求；
- suspend/resume：切换后延迟恢复，期间插入相关或无关任务；
- interpretation repair：用户纠正系统理解，而不是改变自己的要求；
- evidence/world update：外部事实改变，但用户目标未变；
- triggered/formed preference：AcCoRD 在购物与旅行协作中区分 formed、revealed、adjusted、relaxed 四类偏好动态，并报告 frontier 模型更难处理中途出现或演化的偏好。这是现象分类和评测设置，不是 Intent IR 生命周期；摘要未给出每类的状态机、触发条件和满足判定，本项目不得把四个标签直接当 update primitive。
- infeasible/negotiated intent：当前偏好组合不可实现，需要协商，而非猜测；
- correct correction vs misleading pressure：系统既不能 stubborn，也不能凡是用户纠正就覆盖；SycoBench 的 paired protocol 可直接借鉴；
- chained ambiguity：后一处澄清是否成立依赖前一处解释；TIDE-Bench 用 counterfactual dependency 测这一点；
- occurrence identity：两个高度相似任务交织，测试错误合并与错误拆分；
- benign noise/paraphrase：不应改变当前意图的负控制。

来源：[AcCoRD](https://arxiv.org/abs/2608.27818) · [SycoBench-600](https://aclanthology.org/2026.findings-acl.1759/) · [TIDE-Bench](https://arxiv.org/abs/2608.29543) · [HiL-Bench](https://arxiv.org/abs/2604.09408)

### 5.3 关键反事实配对

每条主轨迹应有最小变化 twin：

- **同终点、不同路径**：最终要求相同，但披露/修订顺序不同，测历史路径污染；
- **同表面行为、不同 occurrence**：动作和参数高度相似，但来源、时间或任务身份不同，测 false merge；
- **同文本、不同旧承诺**：测同一句“改成 X”是否正确作用于目标；
- **同用户输入、不同环境事实**：测系统是否把 world update 错当 intent change；
- **一位差异的正/误纠正**：测 update selectivity；
- **变化发生在插入任务前/后**：测 suspend–resume 与跨任务污染。

TIDE-Bench 已展示 value-level drift 可做到结构指标完全相同，仅让对话状态不同；这种“只改变被研究因素”的配对比随机生成长对话更有因果解释力。[TIDE-Bench](https://arxiv.org/abs/2608.29543)

## 六、隔离意图误差与执行误差

应同时运行三种评测路径：

1. **Frozen intent probes（理解层）**：每轮冻结 Compiler 输出，不执行真实任务；用预先作者化的辨别问题测试当前有效要求、失效要求、未决点、指代对象以及哪些候选动作会违反当前意图。比较的是行为后果，不要求不同表示字段对齐。
2. **Oracle-current-intent substitution（项目评测上界，不是 ORACLE-SWE）**：给同一 executor 直接提供本项目 evaluator-only current-intent ledger 的当前视图。候选 Compiler 与该意图 oracle 的差距用来估计意图提取/维护/消费损失；若该 oracle 仍失败，主要瓶颈在执行。ORACLE-SWE 是相邻但不同的方法：它分别注入 Reproduction Test、Regression Test、Edit Location、Execution Context、API Usage 这些 SWE 执行中间信号，量化的是 coding agent 的执行信息贡献，不是 current-intent ledger，也不是 Compiled Intent。[ORACLE-SWE](https://arxiv.org/abs/2604.07789)
3. **End-to-end persistent execution（联合结果）**：在持续 workspace 中运行全部轮次，逐轮执行 cumulative verifier。Conv-to-Bench 说明真实多轮对话可以转成 consolidated instructions 与二元 criteria，但其 judge 一致性并非完美，因此核心行为尽量用程序 verifier，人评用于语义与可接受性。[Conv-to-Bench](https://arxiv.org/abs/2605.26440)

诊断规则：Compiler probe 失败而 oracle execution 成功，属于上游理解/维护；probe 成功但实际执行失败且 oracle execution 同样失败，偏向 executor；final success 但 probe 失败，应记为 lucky success 或 verifier blind spot，不能反向认定理解正确。

## 七、指标矩阵

主指标不应是单一 final pass，而是任务轨迹级组合：

- **Turnwise Active-Requirement Satisfaction**：每轮仍有效要求的满足率，并单独统计已失效要求被错误保留；
- **Reliability AUC**：整条轨迹各轮满足率均值，避免最后一轮掩盖中途破坏；
- **First-drift survival**：首次偏离 current-intent ledger 的轮次分布；
- **Recovery delay/rate**：修订或恢复信号后几轮回到正确轨迹。CarryOnBench 在安全澄清对话中显示 utility lock-in、unsafe recovery 与 repetitive recovery 只看首尾会遗漏，可借鉴“recovery 必须看中途轨迹”这一评测教训；不得把这三种失败模式直接定义成本项目 coding Intent 的 recovery 指标。
- **Change recognition / resolution gap**：识别到变化但没有正确落实的比例；TIDE-Bench 已观察到二者存在明显差距；
- **False merge / false split**：同一 occurrence 被拆开、不同 occurrence 被合并；
- **Premature commitment**：在 outcome-critical 缺口仍未解决时执行不可逆或高返工动作；
- **Correction selectivity**：接受正确修正同时抵抗误导修正；
- **Clarification utility**：Ask-F1、无效问题率、停止过晚/过早和相对参考策略的 regret；
- **Collateral damage / regression**：新要求满足但仍有效旧要求被破坏；
- **总成本**：输入/输出 token、模型调用、P50/P95 延迟、工具调用、询问轮次、失败后的返工动作与计算费用。

来源：[CarryOnBench](https://arxiv.org/abs/2604.27093) · [TIDE-Bench](https://arxiv.org/abs/2608.29543) · [HiL-Bench](https://arxiv.org/abs/2604.09408) · [RegretBench](https://arxiv.org/abs/2607.21143) · [AppWorld](https://arxiv.org/abs/2407.18901)

统计单位应是完整 task trajectory，而不是把同一轨迹的 turn 当独立样本；按 task、domain、change type、model 做分层 bootstrap 或混合效应分析，并报告均值、置信区间、失败分布及 treatment heterogeneity。样本量由 pilot 的轨迹级方差和预注册最小实际效应反推，不应先拍一个固定任务数。

## 八、分阶段路线

### Phase A：基线归因与早期 Intent IR 机制研究

在确定性较高的 SQL/小型代码任务上构造 minimal-pair 轨迹。先以 raw history、rolling summary、RECAP-style rewrite、IDSS-style situation tracking、sham 和项目意图 oracle 取得 testbed 的 baseline failure profile 并调通误差归因；该 calibration 不重新证明问题存在，也不证明 Compiler 有用。随后进入主动的 Intent IR 机制研究：在开发与非确认性 pilot 数据上设计、消融、比较并修改候选 Compiler，冻结候选和规则后再用未见数据检验 C1。

### Phase B：持久开发流程

在修复后的 EvoCode-Bench/Harbor 上加入上述扩展变化与 twin tasks，保留 5–15 轮、持久 workspace、每轮 cumulative verifier。主要看 first-drift、recovery、regression 和 task identity，而不是只报平均 pass。

### Phase C：迁移与机制异质性

冻结接口、提示与超参数，把同一组 Compiler arms 迁移到至少一个非代码工具环境。AppWorld-UL 有 516 个需要澄清、确认和不可行性反馈的任务；AcCoRD 覆盖购物与旅行中 formed/revealed/adjusted/relaxed 偏好动态，适合作为不同现象族参考，不能直接当作 coding Intent 生命周期。该阶段允许出现“机制 A 胜在修订、机制 B 胜在悬置恢复”，并验证这种异质性能否由预先声明的任务特征预测。[AppWorld-UL](https://arxiv.org/abs/2607.20536) · [AcCoRD](https://arxiv.org/abs/2608.27818)

### Phase D：真人校准

用小规模真人轨迹重跑代表性条件，比较 treatment 排名、绝对成功率、询问负担和错误类型是否与 simulator 一致。模拟用户适合规模化开发，但 2026 人类研究发现不同 simulator 可令成功率相差 9 个百分点，并出现系统性难度误校准与群体差异；Lost in Simulation 中的 SAGE user simulator（与 SAGE-Agent、VoI 论文不是同一机制）虽能发现更多错误，也不能替代 sim-to-real 检查。[Lost in Simulation](https://arxiv.org/abs/2601.17087) · [SAGE user simulator](https://aclanthology.org/2026.findings-eacl.147/)

## 九、判定门槛与否证条件

以下是建议预注册的项目判据，不是文献已经统一的标准：

**可以称“有用”**：相对预先选定的最强等预算 baseline，至少同时改善一个理解主指标（例如 Reliability AUC/false merge）和 end-to-end 指标；置信区间排除预注册的无实际意义区间；没有以更多 premature commitment、不可逆 collateral damage 或询问负担换分。

**可以称“较通用”**：同一 Intent IR → Compiled Intent 语义契约在未见 task 上保持收益；至少两个机制不同且满足契约的实现通过 C1；收益跨多个变化族、两类执行环境和多个模型家族，不由单一 benchmark 或单一模型承担。无需证明统一内部表示，也无需每个 implementation 处处胜出。

**可以称“高效”**：在包含 compiler 调用和返工的全成本下 Pareto 支配强 baseline，或在等性能下显著降本；不能只报 prompt 变短。

应明确否证或降级主张的结果包括：

- 只在比 baseline 获得更多源信息、更强模型或更多调用时有效；
- 只改善 final pass，不改善独立 intent probes，或改善来自 guardrail-only arm；
- 对一个 benchmark 有效但在 held-out change composition、任务身份 twin 或非代码环境中消失；
- 平均分上升但 false merge、过早执行或尾部严重失败上升；
- 相对已实现的最强具名对照（例如 RECAP-style rewrite、U-Fold-style folding、IDSS-style situation tracking）无增益；
- 自然运行看似便宜，但等性能后总调用、人工询问或返工更高；
- simulator 中成立而真人 treatment 排名反转。

## 最关键的研究判断

我们现在可以把“研究 Intent IR 方向”改写成一个可检验、同时保留机制探索空间的命题：

> 独立、持续维护的 Intent IR 与 Compiled Intent 是否比直接依赖历史、摘要、记忆和普通规划更有效；哪些表示、关系、更新、推断与编译机制，分别能在渐进需求的哪些子分布上，以可归因且成本合理的方式改善下游 long-horizon reliability？

这个命题允许最终结果是“不存在通用胜者”，同时仍可能证明 Intent IR 这一管理方向有价值，并产出条件化的设计规律。需要统一的是 Intent IR → Compiled Intent 的功能契约、oracle、对照和指标；内部表示则是本项目要主动探索和竞争的研究对象。

## 十、现成 benchmark 与最小自建资产（2026-09-14 审计）

### 结论

**可以不从零作者化大部分基础任务，但不能完全取消本项目自己的评测资产。** 当前没有一个公开 benchmark 同时提供：渐进意图的逐轮真值、持久可执行环境、Authority 生命周期、任务身份/悬置恢复、统一干预 seam，以及 paired sham、oracle 和独立 probe。因而没有 benchmark 能原样承担完整的 Intent Compiler 因果实验；最省作者成本的路线是复用多个现成任务 substrate，再增加一个统一 evaluator overlay。

这里的分类按“能否直接支持本项目主张”而不是按“代码能否下载”划分：

- **直接可复用为完整 Intent Compiler 测试**：目前为空。现成 benchmark 都缺少至少一个关键识别条件。
- **可复用，但必须加 evaluator overlay**：EvoCode-Bench、Evolving Intent、LHAW、EvolIF。
- **不能列为本项目 benchmark 候选**：UserIntentBench、CarryOnBench；前者缺少正式公开论文背书且 coding 验证不能支撑本项目的逐轮可执行归因，后者尚无经核实的作者官方任务与评测发布。

### 逐项适配判断

| Benchmark | 公开性与任务形态 | 渐进意图和逐轮真值 | 环境、验证器与干预 seam | 本项目用途与必要 overlay |
|---|---|---|---|---|
| **EvoCode-Bench（2026，勿与 2024 同名项目混淆）** | 官方 clean re-release 为 26 个任务、227 轮、每任务 5–15 轮；HF task archive 为 CC BY-NC 4.0，官方仓库代码 MIT。2026-06-20 前的结果已因 Harbor grader 泄漏等问题撤回，正式使用应固定 2026-06-25 数据快照、archive checksum 与 patched/separate verifier。[官方仓库与完整性说明](https://github.com/UniPat-AI/EvoCodeBench) · [官方数据卡](https://huggingface.co/datasets/UnipatAI/EvoCodeBench) | 原生覆盖 `extension / correction / conflict`，适合 requirement reveal/revise 与部分 function change；不显式覆盖 ambiguity、并行任务 occurrence、suspend/resume 或 Authority grant/revoke/expiry。它只有 change-type 元数据和累计测试，不提供独立的 per-turn current-intent ledger。 | 同一持久容器、连续 agent session、逐轮 cumulative executable tests；可复用真实编码任务和历史发布 baseline。原生 Harbor 调用路径没有本项目的 common variable-artifact seam，需要在管理层或 benchmark driver 中包装投递点并把 evaluator 资产隔离；这不是独立 Compiled Intent Adapter 模块。 | **Phase 1 的首选代码 substrate**。增加 ledger、requirement↔test 映射、probe、oracle、paired sham、static/progressive twins、fresh/history factor 与统一 seam。官方分数只有在完全复现其 task release、runner、scaffold、模型与 session 设定时才可数值对比；我们的 treatment 结果应主要做同实验内比较，公开 leaderboard 只作外部锚点。 |
| **Microsoft Evolving Intent** | MIT 官方仓库把 GSM8K、BIRD-SQL、BrowseComp+、SWE-bench Verified 转成多轮任务；固定 eval task IDs 已公开，但论文使用的 `final_dataset/*.json` 与结果被 gitignore，必须运行官方 pipeline 重新生成并冻结 derived release。[官方仓库](https://github.com/microsoft/evolving-intent) · [evaluation 说明](https://github.com/microsoft/evolving-intent/blob/main/evaluation/README.md) | 直接覆盖 argument reveal、argument revision、function switch 和 combined；`change_plan` 保存完整变化轨迹，SQL 另有 `per_turn_gold`，但其他域主要只有最终答案，不是通用逐轮 current-intent 标签。[simulation schema](https://github.com/microsoft/evolving-intent/blob/main/situated_simulation/README.md) | 复用源 benchmark 的 native verifier；SWE 有可执行环境，BrowseComp 工具结果跨轮保留，数学/SQL 不是持久工作区。runner 直接把对话交给模型，没有现成的统一 artifact seam。 | **Experiment 0/0b 的最佳现成生成框架**：可自动得到同一最终目标的 fully-specified/evolving 对比，而无需从零写语义任务。仍须把生成池按 commit、生成模型和 seed 冻结，隐藏 `change_plan/label/per_turn_gold`，并补 seam、ledger view、probe、oracle 与 sham。由于论文 exact generated pools 未发布，重新生成后的绝对分数不宜宣称直接复现论文。 |
| **LHAW** | 官方发布 285 个 CC BY 4.0 预计算 variants，来自 TheAgentCompany、SWE-Bench Pro 与 MCP-Atlas；可以跳过生成阶段。每行包含 original/underspecified prompt、被删片段、信息维度、expected questions、ambiguity class 与 terminal-state traces。[官方仓库](https://github.com/scaleapi/lhaw) · [官方数据卡](https://huggingface.co/datasets/ScaleAI/lhaw) | 覆盖 Goal、Constraint、Input、Context 的可控缺失，以及 clarification/no-clarification；核心 intent 固定，主要是 reveal/formation，不覆盖 revise、任务切换、suspend/resume 或 Authority。没有变化中的 per-turn ledger，gold 是完整 prompt 与 removed segments。 | 继承 TAC、SWE-Bench Pro、MCP-Atlas 的工具环境/验证；内置 ask-user simulator 与 cost-sensitive clarification 分析，但没有本项目 common seam。 | **Experiment 1 controlled-interactive 与 Phase 2 非代码迁移的补充集**。可直接复用 validated variants，但须隔离原始 prompt、removed segments、expected questions 和 terminal states，补 unified seam、逐轮 ledger/probe、oracle 与 sham。只有精确复现其 source benchmark、variant、simulator 和模型配置时才能直接对照论文表格。 |
| **EvolIF v0.1** | 官方 GitHub、HF `dialog_v0.1`（CC BY-NC 4.0）和 checker 已公开；仓库仍标注 under construction，正式使用需固定 HF commit。记录逐轮 `active_topic`、verified user query 与结构化 `instructions`。[官方仓库](https://github.com/JiaQiSJTU/EvolIF) · [官方数据版本](https://huggingface.co/datasets/KikiNLP/EvolIF/tree/main) | 多 topic 长对话中每轮给出当前 constraint stack，覆盖约束增加、修改、删除和 topic 演化，适合测试 stale constraint、恢复与 fine-grained tracking；不是 task-level Authority，也没有可执行任务状态。 | 输出由规则 checker 与部分 LLM judge 评分；没有工具/持久 workspace。model invocation 可以包 common seam，但只能测理解/指令跟随，不能证明 end-to-end agent reliability。 | **Experiment 0 的 probe/现象敏感性补充集**，不作为 Phase 1 端到端主集。必须只把 `user_query` 暴露给普通 arm，把 `instructions/active_topic` 留给 evaluator/oracle，并加 sham 与 static/progressive twin 定义。公开 leaderboard 仅在同 v0.1、checker、patience 和 prompt 设置下可比较。 |

### 污染与可比性规则

1. 所有公开任务、gold graph、change plan、removed segments、expected questions、hidden answer 和 verifier 文件都视为可能已进入模型训练；confirmatory split 应按 base task/source graph 成组隔离，并优先保留未用于 prompt/候选设计的 untouched subset。
2. evaluator-only 字段必须物理或权限隔离于 Compiler 和 Exec Loop，不能只依赖 prompt 说“不要读”。EvoCode 使用 patched 或 separate verifier；LHAW、Evolving Intent 和 EvolIF 必须从公开 task record 派生仅含当轮可见输入的 agent view。
3. 已发表 leaderboard 不能作为 treatment 的 control。只有任务版本、runner、executor scaffold、模型、预算、session/history 条件和评分器都一致时，才可称直接复现；否则只提供外部难度锚点。正式效应来自同一冻结协议内的 matched arms。

### 最小仍需原创的资产

不必再造一整套基础 coding benchmark；仍必须制作并冻结以下**薄 overlay**：

1. 一套跨 benchmark 的 Current-Intent Ledger 映射与 agent/evaluator 分离视图；尽可能由 Evolving Intent `change_plan`、LHAW removed segments 和 EvoCode requirement tests 派生，再人工审计而非从零标注。
2. common variable-artifact seam 与 arm manifest，使 raw history、RECAP-style rewrite、retrieval memory、Compiler、项目意图 oracle、sham 在同一位置、同一预算规则下进入 executor。
3. static/progressive twin、frozen behavioral probes、项目意图 oracle Compiled Intent renderer、每个 active arm 的 paired sham，以及 task/turn/change-family 分组键。
4. 一个很小的缺口补丁集，而不是新建大型 benchmark：Authority grant/revoke/expire/cross-task non-transfer、明确 suspend/resume、同名但不同 occurrence、完整 retract/relax 和 benign-noise twins。这些现象目前无法从上述公开集可靠推导。
5. dataset provenance manifest：固定 upstream commit/archive hash、许可、生成模型与 seed、已知污染修复、派生规则，以及所有 gold/evaluator 资产的访问边界。

因此推荐组合不是“选择一个 benchmark”，而是：**Evolving Intent/EvolIF 支撑 0a 的可控变化与理解 probes，clean EvoCode-Bench 支撑 Phase 1 的持久代码执行，LHAW 支撑 clarification 和非代码工具环境候选；原创工作集中在统一 overlay 与少量现象缺口。** 这能显著减少测试集作者成本，但不能把本项目特有的因果识别层外包给现有 leaderboard。

### 一手来源重筛（2026-09-15）

本轮把“论文方法”“公开任务数据”和“可运行、可复核的任务/评分资产”分开判定。只有后两者和本项目识别链适配，才进入 spec 的测试载体候选。

| 候选 | 一手来源核查 | 留用边界 |
|---|---|---|
| **Evolving Intent** | Microsoft 作者[论文](https://arxiv.org/abs/2607.20734)和[官方构造/评测仓库](https://github.com/microsoft/evolving-intent)公开了 reveal/revision/switch 方法、固定任务 ID 与四域 runner；[评测说明](https://github.com/microsoft/evolving-intent/blob/main/evaluation/README.md)明确完整生成池 `final_dataset` 被 gitignore、需重生，SWE-bench Verified 有单独 runner。 | 留作 0a/0b 可控变化生成与诊断；不能将重生成池的绝对成绩当论文原池直接复现，也不能把数学/SQL 最终答案当 coding 持久逐轮 verifier。首轮 coding 执行仍需审计过的可执行任务。 |
| **EvolIF** | [ACL 2026 正式论文](https://aclanthology.org/2026.acl-long.433/)提出多 topic、12 类约束的渐进指令跟随；[作者代码](https://github.com/JiaQiSJTU/EvolIF)与[公开数据](https://huggingface.co/datasets/KikiNLP/EvolIF)包含逐轮 constraint stack 与 checker，但仓库仍标 under construction。 | 留作理解/probe 诊断，不作 coding Agent 或持久环境结果；冻结代码、数据、checker 版本并隔离内部状态。 |
| **EvoCode-Bench** | [作者论文](https://arxiv.org/abs/2605.24110)与[官方仓库](https://github.com/UniPat-AI/EvoCodeBench)支撑长程 coding 问题；仓库公开 26 个持久任务、227 轮与逐轮 cumulative executable tests，且 2026-06-20 撤回旧结果、修复 grader 泄漏/污染任务/11 处缺陷；[任务发布](https://huggingface.co/datasets/UnipatAI/EvoCodeBench)可固定。论文原 runner 与当前 clean Harbor runner 不同。 | 留作 M1 长程 coding 主载体；0a 仅可取通过 provenance、future-leakage、reference-solution 与 verifier-isolation 审计的短切片，当前本地旧副本不合格。 |
| **LHAW** | Scale 作者[论文](https://arxiv.org/abs/2602.10525)、[官方仓库/运行说明](https://github.com/scaleapi/lhaw)和[285 个已发布 variants](https://huggingface.co/datasets/ScaleAI/lhaw)覆盖三类任务及 ask-user 模拟，variant 类型通过实际 agent 终态分歧校验。 | 留作澄清与非代码工具迁移候选；任务主要是信息缺失，不是持续修订，且执行依赖上游环境与 evaluator 隔离。 |
| **UserIntentBench** | [作者数据卡](https://huggingface.co/datasets/JingmingChen/UserIntentBench/blob/main/README.md)在 Citation 栏明确“论文仍在审稿，届时再补引用”；虽有[任务与 harness](https://github.com/jingmingjackchen/UserIntentBench)，coding 是 Vision2Web 需求转译后的静态网站任务、内存 `write_file/read_file/list_files` workspace，结果/意图匹配依靠 LLM judge panel 而非逐轮 executable verifier。 | 不作为权威 benchmark、coding 主/次载体或 coding→research 迁移依据；从 spec 候选表和 Matrix 所有对应分配直接删除。公开代码与数据不等于可信实验证据。 |
| **CarryOnBench** | [作者论文](https://arxiv.org/abs/2604.27093)提出安全敏感的 clarification/recovery 方法与结果，但本轮未核实作者官方固定任务数据、代码或可运行评分发布。 | 不进入 spec benchmark 候选表；无可复现发布就不能为目前的 coding/工具实验提供 substrate 或数值难度锚点。 |
| **公开 leaderboard** | [EvoCode 官方榜单及撤回说明](https://github.com/UniPat-AI/EvoCodeBench)本身证明同名 benchmark 也会因任务/runner/评分器更新而使旧数失效；Evolving Intent 的[评测说明](https://github.com/microsoft/evolving-intent/blob/main/evaluation/README.md)只公开任务 ID、未发布原生成池。 | 不列作测试载体或对照 arm；只有版本、任务、runner、scaffold、模型、预算、history 条件、评分器完全一致时才可称直接复现。 |

## 十一、2026-09-15：轻量首版 benchmark、Ollama 模型与框架核查

本节记录形成 coding-only 首版实验的研究依据：先用一个官方任务端到端检验 LLM 黑盒 Intent Compiler 管理层，再扩大任务和模型，之后才比较 Intent IR 结构与确定性机制。当前决定和实施顺序已归入正式 spec；若本节的历史建议与 spec 冲突，以 spec 为准。产品边界仍是：人持续给出 benchmark 的逐轮原始 coding input；Compiler 接收原始 input、管理形态未定的 Intent IR 并输出 Compiled Intent；Exec Loop 只接收 Compiled Intent 作为任务输入，不能回写 Intent IR。当前首版运行绑定以第 15 节的 OpenCode 插件为准；Harbor 只可作为外部 benchmark runner/任务环境。

### 11.1 已核实事实：coding benchmark / testbed 多维比较

| 候选 | 测量侧重与 intent 变化 | 多轮、workspace 与 verifier | 公开任务、runner、数据和许可 | 能支持的证据层 |
|---|---|---|---|---|
| **官方 clean EvoCode-Bench** | 直接测 coding agent 在持续迭代中保持项目可用的能力；26 个 stateful task、227 个 round、每任务 5–15 轮，变化元数据为 `extension / correction / conflict`。它能观察新要求落实、仍有效旧要求回归和中途失败，但没有独立 Current-Intent Ledger，也不覆盖完整的 reveal/retract/suspend/Authority 变化谱。[官方仓库](https://github.com/UniPat-AI/EvoCodeBench) · [论文](https://arxiv.org/abs/2605.24110) | 同一 Harbor container 和连续 agent session 跨轮保留；每轮运行累计 executable tests，既有二元 step reward，也有 test-case 级结果。官方明确要求把 2026-06-20 前结果视为失效；当前 clean 结果来自清除跨轮 grader/log 泄漏后的全量重跑，并同时修复 1 个污染任务和 11 个 task/test 缺陷。[完整性说明](https://github.com/UniPat-AI/EvoCodeBench#known-issues--responsible-disclosure) | 当前标准 runner 是 upstream Harbor official multi-step；论文旧 runner 与旧指标保留在 `legacy/`，不是首版应采用的路径。HF task-only archive 提供可执行环境、逐轮 instruction、reference delta 与 cumulative tests；数据为 **CC BY-NC 4.0**，仓库代码为 **MIT**。[官方数据卡](https://huggingface.co/datasets/UnipatAI/EvoCodeBench) · [运行说明](https://github.com/UniPat-AI/EvoCodeBench#quick-start) | 最强的是逐轮行为、workspace effect、回归和最终成功证据；加一层 Compiler/Exec 输入隔离与日志即可做轻量管理层 A/B。它不能仅凭 native score 证明上游 intent 理解正确。 |
| **Microsoft Evolving Intent — SWE 路线** | 把 SWE-bench Verified bug-fix 改成 `argument-reveal / argument-revision / function-switch / combined` 对话。SWE 的 function switch 不是任意第二个 bug，而是同仓库中只读的 implementation-planning precursor，随后再 pivot 到原 bug，以避免先前修改污染最终 patch。[SWE 官方说明](https://github.com/microsoft/evolving-intent/blob/main/evaluation/SWE_README.md) | 是多轮；同一 SWE instance 的 Docker workspace 被 agent 在整段对话中操作。它只在对话结束后把最终 patch 交给官方 SWE-bench `FAIL_TO_PASS + PASS_TO_PASS` harness；有 per-turn step cap 和 per-turn tool-step 统计，**没有逐轮 executable verifier**。[评分流程](https://github.com/microsoft/evolving-intent/blob/main/evaluation/SWE_README.md#how-scoring-works) | MIT 仓库公开 construction pipeline、mini-swe-agent v2 runner 和固定 50-task ID；完整 `final_dataset/swe_bench_verified_final.json`、实验输出和 logs 被 gitignore，必须用官方 pipeline 重生成。重生成池需要冻结生成模型、seed、commit 和派生数据许可；不能把新池绝对分数称为论文原池复现。[评测说明](https://github.com/microsoft/evolving-intent/blob/main/evaluation/README.md) | 强于受控 reveal/revise/switch 的因果压力和最终 patch 结果，弱于逐轮回归定位。适合 clean EvoCode 首跑之后的变化类型扩展，不适合作为最低接入成本的第一个任务。 |
| **LHAW — SWE-Bench Pro 条件** | 核心问题是“信息缺失时是否应澄清”，从完整 prompt 删除或模糊 `Goal / Constraint / Input / Context`，再按真实 rollout 的 terminal-state divergence 标为 outcome-critical、divergent 或 benign。它测试 underspecification、clarification policy 和 intent formation/reveal，不测试持续 revision、retraction 或 suspend/resume。[官方仓库](https://github.com/scaleapi/lhaw) · [论文](https://arxiv.org/abs/2602.10525) | release 中每个样本是 original/underspecified prompt 对；交互多轮由 `ask_user` tool 触发，不是预定的渐进 intent 轨迹。SWE-agent 在单个代码修复 workspace 中运行，最终 patch 由 SWE-Bench Pro Docker evaluation 验证；没有逐轮 cumulative verifier，checkpoint progress 是过程指标而非每轮全量验收。[SWE pipeline](https://github.com/scaleapi/lhaw/blob/main/experiments/swebench/README.md) | 官方公开 285 个已验证 variant，其中 SWE-Bench Pro 为 75 个源任务、100 个 variant；数据 **CC BY 4.0**，仓库代码 **MIT**。SWE 路线依赖项目 fork 的 SWE-agent、SWE-Bench Pro submodule 与 Modal container orchestration；官方 quick start 不是纯本地零外部服务路径。[数据卡](https://huggingface.co/datasets/ScaleAI/lhaw) · [SWE setup](https://github.com/scaleapi/lhaw/blob/main/experiments/swebench/README.md#setup) | 支持“何时问、问什么、回答是否被利用”与最终代码结果，不能单独支持 evolving-intent maintenance。适合后续 clarification factor，不进入首个轻量 E2E。 |
| **EvolIF v0.1** | 测多 topic 对话中的细粒度 instruction following、失败恢复和用户 patience；逐轮公开 `active_topic` 与结构化 constraint stack，约束类具有 initialization、modification、removal 权重和 checker。它是输出约束演化，不是 repository-level coding intent。[ACL 论文](https://aclanthology.org/2026.acl-long.433/) · [官方仓库](https://github.com/JiaQiSJTU/EvolIF) | 是多轮且有逐轮 checker；没有工具、代码 workspace 或环境状态。部分约束由规则检查，`emotion / reader_age / style` 等可使用 LLM judge。仓库仍明确标记 “under construction”，生成样本还要求人工检查空的 `user_query_verified`。[使用说明](https://github.com/JiaQiSJTU/EvolIF#usage) | HF `dialog_v0.1` 和逐轮字段公开，数据 **CC BY-NC 4.0**；GitHub 仓库未声明可由 GitHub 识别的代码许可证，因此代码再分发权不能从数据许可证推导。[数据卡](https://huggingface.co/datasets/KikiNLP/EvolIF) | 可作低执行噪声的 intent/constraint probe，但不能提供 coding agent 的 end-to-end 或 workspace 证据。coding-only 首版不纳入核心运行。 |

**直接结论。** 在已核查候选中，clean EvoCode-Bench 是唯一同时具备 **官方可下载 coding task、持续 workspace、逐轮可执行 verifier、公开标准 runner 和 clean-release 纠错记录** 的首跑载体。Evolving Intent SWE 提供更清晰的 reveal/revise/switch 操纵，但只做最终 patch 验证且原生成池未发布；LHAW SWE 主要测澄清并依赖更重的外部运行栈；EvolIF 只能做无 workspace 的理解诊断。UserIntentBench 与 CarryOnBench 继续排除，不因本节重新进入候选。

### 11.2 推论 / 轻量实验建议：benchmark 顺序

以下是由上述事实支持的候选顺序，不是替用户冻结产品决定：

1. **首个 E2E：clean EvoCode-Bench 的一个完整官方 task。** 从 HF task-only clean archive 固定 archive checksum、task identity、Harbor 版本和 patched/separate verifier 行为；先跑完整官方多轮链，不把本地旧副本当来源。Harbor 只负责逐轮 instruction、workspace 和 verifier；每轮原始 instruction 先进入 OpenCode 插件中的 Intent 管理层，Exec Loop 收到 Compiled Intent 而不是原始 instruction。
2. **同一 substrate 扩大。** wiring、行为日志和成本拆分通过后，再按不同 task family/change mix 扩大到少量 clean EvoCode tasks；不立即跑全 26 个。
3. **受控变化扩展：Evolving Intent SWE。** 重生成并冻结一个小型 pool 后，用 reveal → revision → combined/function-switch 的顺序增加变化控制；因为没有逐轮 verifier，必须保留 intent probe、tool/action trace 与最终 SWE verifier 三层证据。
4. **澄清扩展：LHAW SWE。** 只在需要检验 outcome-critical underspecification 和 `ask_user` 策略时加入，并把 Modal/SWE-agent fork 依赖计入工程与成本边界。
5. **EvolIF 只作旁路诊断。** 若 coding 实验需要先验证 Compiler 对约束增删改的纯语义敏感性，可冻结 v0.1 做 sibling probe；其结果不进入 coding E2E 主张。

首个任务仍应在 clean archive 上做一次 reference-solution、verifier isolation、未来轮泄漏和预计运行时审计后再选；目前一手资料支持“先选 EvoCode-Bench”，不支持在未审计任务间凭名称指定最终 task。

### 11.3 已核实事实：Ollama 开放权重模型候选

下列候选都能从 Ollama 官方 library 直接获得，不依赖付费 API。参数和原生 context 以模型作者卡为准，Ollama tag 的实际 context/quantization/digest 则应从本次安装的 `/api/show`、`/api/tags` 与 `/api/ps` 固定。

| 候选层级 | 准确模型 / 规模 / context | tool、结构化输出与 coding/agent 侧重 | 许可、Ollama 可用性与实验风险 |
|---|---|---|---|
| **小型 dense 能力基线** | `qwen2.5-coder:7b`；作者卡为 7.61B 参数。作者卡声明最高 131,072 token，但默认 config 为 32,768、超出需 YaRN；Ollama 官方 tag 也标为 **32K**。[模型卡](https://huggingface.co/Qwen/Qwen2.5-Coder-7B-Instruct) | 作者定位覆盖 code generation、reasoning、fixing 与 code agents；Ollama 官方页给该 family 标注 `tools`。结构化输出来自 Ollama `format` 约束，不是作者卡对该模型的专门保证。[Ollama 模型页](https://ollama.com/library/qwen2.5-coder) | **Apache 2.0**。优点是形成低容量 dense 对照；主要风险是 32K 低于 Ollama 对 coding/agent 建议的至少 64K，长 repo task 可能把“模型容量/上下文不足”误判为 Compiler 无效。 |
| **高效 MoE coding 主候选层** | `qwen3-coder:30b` / `Qwen3-Coder-30B-A3B-Instruct`；**30.5B total、3.3B active**，原生 **262,144 token**，仅 non-thinking mode。[模型卡](https://huggingface.co/Qwen/Qwen3-Coder-30B-A3B-Instruct) | 作者卡明确面向 agentic coding、repo-scale context 和 function calling；Ollama 官方 tag 标注 `tools` 与 256K。[Ollama 模型页](https://ollama.com/library/qwen3-coder) | **Apache 2.0**。它把较长 context、代码专训和低 active parameter 组合在同一候选中；风险是作者建议的采样参数为 `temperature=0.7/top_p=0.8/top_k=20`，而实验常用的 temperature 0 可能改变其最佳工作点，需把“可复现控制”和“自然推荐配置”分开报告。 |
| **dense agentic-SWE 对照层** | `devstral-small-2:24b` / `Devstral-Small-2-24B-Instruct-2512`；24B dense，作者卡声明 **256K** context。[模型卡](https://huggingface.co/mistralai/Devstral-Small-2-24B-Instruct-2512) | 作者明确把它用于代码库探索、多文件编辑和软件工程 agent，并提供 OpenAI-compatible tool calling 示例；Ollama 官方 tag 标注 `tools`。[Ollama 模型页](https://ollama.com/library/devstral-small-2) | **Apache 2.0**，模型卡另要求不得侵犯第三方权利。实验风险是 Ollama 本地 tag 页面显示 **384K**，与作者卡 256K 不一致；不能把 384K 当作上游保证，必须固定 Ollama digest、template、quantization 和实际 `context_length`。 |
| **通用 agentic reasoning 家族对照** | `gpt-oss:20b`；**21B total、3.6B active**，Ollama tag 为 **128K**。[OpenAI 模型卡](https://huggingface.co/openai/gpt-oss-20b) | 作者定位为 reasoning/agentic 模型，原生支持 function calling、Structured Outputs 和 low/medium/high reasoning effort；它不是 code-specialized family，因此能检验收益是否只存在于专门 coding 模型。[Ollama 模型页](https://ollama.com/library/gpt-oss) | **Apache 2.0**。模型只应按 OpenAI Harmony response format 使用；Ollama template 会承担该适配。风险包括 reasoning effort 带来的额外 token/latency、thinking 字段处理和不同 template 版本，必须与普通输出和成本分别记录。 |

这四个候选形成两条正交差异：`dense ↔ MoE`、`code-specialized ↔ general agentic reasoning`，同时包含 7B、20–24B 和 30B-total/低-active 的能力层。首版可以只选其中一个完成 wiring，但扩大时不应只在同一 Qwen family 内换参数规模；否则“Compiler 对模型家族是否稳健”无法判断。这里不选择硬件，也不依据非官方排行榜决定胜者。

### 11.4 已核实事实：Ollama API 能力与缺口

- **多模型调用。** `/api/chat` 和 `/api/generate` 每次显式给 `model`；`/api/tags` 可记录本地 tag、SHA256 digest、参数规模与 quantization，`/api/ps` 可记录当前 loaded model、实际 context 和显存占用。Ollama 在资源足够时可同时加载多个模型；不足时会卸载 idle model 并排队，新请求过载可返回 503。`keep_alive` 控制驻留时间。[Chat API](https://docs.ollama.com/api/chat) · [List models](https://docs.ollama.com/api/tags) · [Running models](https://docs.ollama.com/api/ps) · [并发与驻留](https://docs.ollama.com/faq#how-does-ollama-handle-concurrent-requests)
- **OpenAI 兼容。** 本地 `http://localhost:11434/v1` 支持 Chat Completions、Completions、Models、Embeddings 和非 stateful Responses API；兼容层只是 OpenAI API 的子集。Chat Completions 支持 `seed`、`temperature`、`top_p`、`max_tokens`、`response_format`、tools 与 streaming usage，但不支持 `tool_choice`、`n`、`logit_bias` 或 chat-completions logprobs；Responses 不支持 `previous_response_id`、`conversation` 或 `truncation`。[兼容矩阵](https://docs.ollama.com/api/openai-compatibility)
- **Structured Outputs。** 本地原生 API 的 `format` 接受 `"json"` 或 JSON Schema，OpenAI 兼容层通过 `response_format` 暴露；官方仍建议把 schema 也放进 prompt、降低 temperature 并在客户端再次验证。Ollama Cloud 当前不支持 structured outputs，但本项目使用本地 Ollama，不受该 cloud 缺口阻断。[官方文档](https://docs.ollama.com/capabilities/structured-outputs)
- **Tool calling。** 原生 chat API 支持 single、parallel、multi-turn 和 streaming tool calls；Ollama 只返回 function name/arguments，真正执行、权限控制、把 tool result 追加回 messages 和停止循环都由 OpenCode Exec Loop 负责。模型 library 的 `tools` badge 只表示模板/服务支持，不能替代逐模型的参数合法性、并行调用和停止行为 smoke。[官方文档](https://docs.ollama.com/capabilities/tool-calling)
- **context。** 原生 API 的 `options.num_ctx` 可逐请求控制；OpenAI 兼容请求没有设置 context size 的字段，官方要求通过 Modelfile `PARAMETER num_ctx` 创建模型别名。Ollama 的默认 context 会随运行环境变化，官方建议 coding/agent task 至少配置 64K，因此实验不能依赖默认值，必须记录 `/api/ps.context_length`。[Generate API](https://docs.ollama.com/api/generate) · [Context length](https://docs.ollama.com/context-length) · [OpenAI context 限制](https://docs.ollama.com/api/openai-compatibility#setting-the-local-context-size)
- **token 与耗时。** 原生响应提供 `total_duration / load_duration / prompt_eval_duration / eval_duration`（纳秒）和 `prompt_eval_count / prompt_eval_cached_count / eval_count`；streaming 时出现在最后一个 `done=true` chunk。它不自动给本地推理的货币成本，也不会替项目聚合一次 agent turn 内的多次模型调用、tool time、retry 和返工。[Usage](https://docs.ollama.com/api/usage)
- **seed / temperature。** 原生 `options` 明确支持 `seed`、`temperature`、`top_k`、`top_p`、`min_p`、`stop`、`num_ctx` 与 `num_predict`；OpenAI Chat 兼容层支持 `seed/temperature/top_p/max_tokens`。官方只提供同配置“reproducible outputs”能力，不承诺跨 Ollama 版本、模型 digest、quantization、template 或不同计算后端逐 token 一致；正式实验仍需固定这些身份并保留重复运行。[Generate options](https://docs.ollama.com/api/generate) · [OpenAI 兼容字段](https://docs.ollama.com/api/openai-compatibility#v1chatcompletions)

**实验接口建议。** OpenCode Exec 可使用其 provider 接入；插件中的 CompilerRuntime 可用 OpenAI-compatible `/v1/chat/completions` 完成最小模型调用。实验控制面应额外调用 Ollama 原生 `/api/tags`、`/api/show` 和 `/api/ps` 固定 digest、template/capabilities、quantization 与实际 context。Compiler call 和 executor call 应使用独立 role 标签累计 usage；不能只读取最终 agent 的 OpenAI `usage` 就宣称总成本已核算。

### 11.5 已退出范围：WorkSwarm / openJiuwen

> 这一路线已退出项目范围；第 15 节的 OpenCode 绑定取代它。

旧工程核查不再保留为当前研究上下文。

### 11.6 研究事实支持的候选集与必须保留的对比

**benchmark 候选顺序：**

- 首个：clean EvoCode-Bench，一个完整官方 task；
- 扩大：少量跨 task family 的 clean EvoCode tasks；
- 下一层受控变化：Evolving Intent SWE 的冻结重生成小池；
- 下一层澄清：LHAW SWE；
- EvolIF v0.1 仅作为可选的无 workspace probe，不进入 coding E2E 主结果。

**模型候选层：**

- 小型 dense 能力基线：`qwen2.5-coder:7b`；
- 高效 MoE coding：`qwen3-coder:30b`；
- dense agentic-SWE：`devstral-small-2:24b`；
- 通用 agentic reasoning 家族对照：`gpt-oss:20b`。

这些候选用于分阶段比较，不表示首轮同时改变 Compiler 和 Exec。首轮管理层价值实验应固定一个 Compiler 模型和一个 Exec 模型；价值信号成立后，先固定 Exec 比较 Compiler，再固定 Compiler 比较 Exec portability。

**首版仍要保留、但不必一次实现所有重型 phased arms 的最小对比：**

1. **强产品基线**：同一 OpenCode code Exec Loop 直接接收原始逐轮 instruction，不经过 Compiler；与 treatment 使用相同模型、工具、workspace、turn/action cap 和 verifier。
2. **Compiler treatment**：独立 LLM call 管理 opaque Intent IR；Exec Loop 只接收该轮 Compiled Intent，不接收原始 instruction，也不能写 Compiler state。
3. **项目意图 oracle Compiled Intent**：由 evaluator-only current-intent view 产生，只用来确认执行器能消费正确 intent 且存在 headroom，不参与产品成本排名。它不是 ORACLE-SWE 的执行中间信号注入。
4. **paired sham**：匹配 Compiler 的调用机会、模型层、输出长度带与交付位置，但不携带 current-intent 语义；用来排除“多一次调用/多一段文本/更强注意力”的收益。
5. **行为与成本证据**：逐轮 cumulative verifier/test-case、workspace diff、tool/action trace、stale/collateral failure，加上 Compiler 与 Exec 分开的 input/output/cache token、duration、retry 和 total turn latency。首版可暂不加入 rolling summary、retrieval、U-Fold、IDSS 等全部强基线，但扩大前至少加入一个具名强对照（RECAP-style rewrite 或 IDSS-style situation tracking）。

### 11.7 尚未核实，不能当成既定事实

- **首个具体 EvoCode task 尚未选定。** 需在官方 clean task-only archive 上做 reference-solution、verifier isolation、未来轮 leakage 和单任务运行成本审计；不能沿用本地旧副本的候选名称直接决定。
- **不能假设当前稳定版 Harbor 已包含跨轮 grader 清理修复。** 上游 [PR #1961](https://github.com/harbor-framework/harbor/pull/1961) 于 2026-09-14 合并（merge commit `4008e2df847e445b0b3c41cff852b5460a62bfb7`），晚于当前最新 GitHub release [`v0.23.0`](https://github.com/harbor-framework/harbor/releases/tag/v0.23.0) 的 2026-09-12 发布时间；因此首跑应固定到包含该提交的 Harbor revision，或使用 EvoCode 官方 patched harness / separate-verifier，而不能只写 `pip install harbor` 后默认安全。PyPI 后续构建何时包含该提交尚未核实。
- **Evolving Intent 论文原 SWE generated pool 未公开。** 固定 50-task IDs 和 runner 已公开，但重生成 pool 与论文 pool 的样本级等价性、派生数据许可文本和使用本地 Ollama 作为 generator/naturalizer 的官方支持均未核实。
- **LHAW SWE 的纯本地、零付费基础设施路径未核实。** 官方说明要求 Modal、项目 fork 的 SWE-agent 和 SWE-Bench Pro submodule；此外，根 README 指示从 `experiments/swebench/hf_variants` 复制预计算 YAML，但当前官方 `main` 上[该目录不存在](https://github.com/scaleapi/lhaw/tree/main/experiments/swebench)，所以 HF variant 到 runner 的直接映射仍需人工适配或等待官方修正。公开 variant 不等于本机可立即运行的完整环境。
- **四个模型在 Ollama 中同时使用 JSON Schema 与复杂 parallel/multi-turn tool calling 的可靠率未核实。** API 支持与 library `tools` badge 不是模型级合规率；需要固定 digest 后做 schema validation、非法参数、空 tool call、重复调用和停止条件 smoke。
- **默认 observability 不等于实验审计日志。** 当前 OpenCode 的接口边界与补采方法见第 15 节。

### 11.8 已确认的轻量 prototype reshape 决定

本节记录 2026-09-15 讨论中已经由用户确认的 prototype 设计决定。它们不是外部文献结论，也不选择最终 Intent IR schema。

1. **先证明管理层价值。** 首版只实现一个 LLM 黑盒 Intent Compiler。多种 Intent IR 结构、机制消融和确定性优化在正向信号之后展开。
2. **Intent IR 与 Compiled Intent 分离。** Intent IR 是管理层私有、跨轮维护的意图状态、任务关系、变化、Authority 和证据引用；Compiled Intent 是从当前 Intent IR 编译出来、实际交给 Exec Loop 的当前产物。Exec Loop 无权读取或修改 Intent IR。
3. **Compiled Intent 替代原始 prompt。** 用户或 benchmark 的当前原始输入只进入管理层。Compiler treatment 的 Exec Loop 只接收 Compiled Intent，不同时接收原始 prompt。Raw prompt 只在 Compiler-absent baseline 中直接进入 Exec Loop。
4. **首版不建立独立 Compiled Intent Adapter。** OpenCode 插件中的管理层直接完成 Compiled Intent 的序列化和交付。只要求实际交付内容与 Compiler 输出一致、可审计且不针对特定 Exec 改写语义。出现第二种运行时或第二种交付格式后，再决定是否抽出真正的 Adapter。
5. **管理层管理 Execution Evidence。** Exec Loop 返回动作、工具结果、错误、测试结果和 workspace 变化。管理层校验其来源、task/turn、权限、完整性和时效，保存为独立 Execution Evidence，再由 Intent Compiler 判断这些证据是否影响事实、可行性、不确定性和下一版 Intent IR。执行证据不能自行改变用户目标、有效约束或 Authority。
6. **首轮固定模型。** 第一轮管理层价值比较固定一个 Compiler 模型和一个 Exec 模型，只改变实验 arm 和 coding task。先在一个官方 clean EvoCode-Bench 完整任务上打通，再扩到少量任务。管理层价值成立后，先固定 Exec 横向比较 Compiler；之后固定 Compiler 更换 Exec，测试跨模型消费。完整 Compiler × Exec 交叉属于更后阶段。
7. **黑盒仍需可运行 V0 契约。** `[LLM-PROTOTYPE]` 可以在一次调用中解释新输入、更新私有 managed state 并输出 Compiled Intent；`[DETERMINISTIC-NOW]` 负责 schema 校验、版本、持久化、访问隔离和日志。Intent IR V0 至少能保存当前/暂停任务、任务关系、有效/失效要求、未决项、Authority 和证据引用；Compiled Intent V0 至少投影当前目标、有效要求、必须避免的失效行为、任务范围、未决项和当前 Authority。两者都是临时雏形，不是最终 ontology。

## 12. Claude Code 长任务机制：`/goal` 与 Dynamic workflows（2026-09-15）

以下只依据 Claude Code 官方文档；“未描述”指公开机制证据缺口，不断言产品内部绝无此能力。与 Intent Compiler 的比较以当前三份权威材料为准，不把竞品机制当成项目设计权威。

### 12.1 已核实机制与显式限制

- **`/goal` 是会话续轮控制，不是意图状态管理。** 用户设置一个完成条件后，每个执行 turn 结束时，独立的小型模型读取条件与迄今对话，返回 `not yet met / met / impossible`；未完成就自动开启下一 turn，已完成或判为不可能则清除 goal。该 evaluator **不自行运行命令或读取文件**，只判断执行 Agent 已在对话中呈现的证据；官方建议把可测终态、验证方式和约束写进条件。一个会话只能有一个 active goal，新条件直接替换旧条件，`/clear` 清除；恢复原会话时可恢复未解决的 goal，但计时、turn 数与 token 基线重置。[Claude Code `/goal` 文档](https://code.claude.com/docs/en/goal)
- **`/goal` 的反馈与中断是执行层的。** 其判定理由可供下一 turn 使用；背景 subagent 或 shell 尚在运行时推迟当轮判定，结束后再续；停滞时返回用户但保留 goal，若遇到特定不可恢复错误则清除 goal。用户可在任何时刻发消息促使下一 turn 立即开始，手动模式仍受工具许可约束。这些规则处理的是完成条件、证据呈现、运行状态和工具许可，不说明对多次人类输入如何形成、撤回或切换 Intent。[Claude Code `/goal` 文档](https://code.claude.com/docs/en/goal)
- **Dynamic workflows 将执行编排移到可复用脚本。** Claude 为任务编写 JavaScript 脚本，runtime 在后台协调多 subagent；循环、分支和中间结果留在脚本变量，主对话通常只接收最终结果。脚本及完成的 agent 结果可在同一会话内重放/恢复；恢复是按已保存结果和 agent prompt 顺序进行，变更上游 prompt 或中途失败会重跑后续 agent。此机制更接近可重复的执行工作流，而不是 Compiler-owned Intent IR。[Claude Code workflows 文档](https://code.claude.com/docs/en/workflows)
- **workflows 明确不支持运行中的用户输入。** 官方写明 run 自身仅因权限提示和使用限额等待而暂停；若要阶段间签字，须把各阶段拆为不同 workflow。退出会话与新开会话的恢复范围也不同：新会话没有前次 run 可以 relaunch，会作为新 run 从头开始。workflow 脚本本身不能直接访问文件系统或 shell，须交由 agent 执行；工作流越大，token/用量可能显著增长。[Claude Code workflows 文档](https://code.claude.com/docs/en/workflows)

### 12.2 对本项目探索方向的推论（不是 Claude Code 已知缺陷的实测结论）

- Claude 的 `/goal` 提供“完成条件 → 执行 → turn 末判定 → 继续”的自动续轮，workflow 提供“脚本 → 多 Agent 执行 → 结果复用”的执行编排；两者分别解决停机控制与规模化协调。项目的不同问题是上游人类输入循环在长任务中不断披露、修订、撤回、暂停或形成意图时，如何维持由 Compiler 所有的 Intent IR，并在执行状态返回后重新编译交给不可回写的 Exec Loop。[项目术语](../../CONTEXT.md) · [项目实验 spec](spec.md)
- 因 `/goal` evaluator 只能读取对话中已呈现证据，`goal` 又是单个可替换的会话条件，它不能单凭该机制证明多任务 occurrence、旧约束失效、未决分歧或 Authority 的保持与隔离；这些是本实验应比较的行为能力，而非从工具名称直接推定的实现缺失。workflows 的无中途输入限制则与“人在运行时持续改变意图”的上游循环直接不匹配；把每阶段拆成独立 run 可做人工检查点，但不是自动管理连续意图变化的证据。[Claude Code `/goal` 文档](https://code.claude.com/docs/en/goal) · [Claude Code workflows 文档](https://code.claude.com/docs/en/workflows) · [项目实验 spec](spec.md)
- Claude 文档没有给出 user/Agent 提案的 provenance、Authority 升级边界、独立 Compiled Intent 投递点或 Exec 不可回写的产品契约。故比较应将 `/goal`/workflows 视为强长任务运行与编排参考，而不直接归类为符合本项目语义契约的 Intent Compiler；如需验证竞品是否已在其他机制中实现这些性质，须另做源码或运行轨迹审计。[Claude Code `/goal` 文档](https://code.claude.com/docs/en/goal) · [Claude Code workflows 文档](https://code.claude.com/docs/en/workflows) · [项目术语](../../CONTEXT.md)

## 13. 2026-09-15：动态 Intent IR 雏形与 session state 区分

本节回答的不是“怎样给 session state 增加更多字段”，而是：什么管理机制能让 Intent IR 对未来行为产生可检验的、非单调的、带来源和 Authority 边界的更新，并通过独立 Compiled Intent 选择性地影响 Exec Loop。外部系统只作为机制证据和对照，不改变本项目既定边界；下文创新组合均明确标为**项目设计推论**。

### 13.1 已核实的一手机制：普通 state 保存什么，又没有替应用定义什么

“普通 state”不是单一类别。以下代表系统分别偏向会话上下文、图执行 checkpoint、耐久 workflow replay 和模型输入历史；比较只依据官方公开语义。“官方文档没有专门定义”不表示应用层不能自行实现。

| 代表系统 | 典型状态与更新触发 | 已定义的原生语义 | 未由该 state 机制专门定义的语义 |
|---|---|---|---|
| **Google ADK Session/State** | `Session` 记录会话身份、按时间排列的 events、任意键值 state 和更新时间；event 的 `state_delta` 在 append 时合并，另有 session、`user:`、`app:`、`temp:` 作用域。[Session](https://adk.dev/sessions/session/) · [State](https://adk.dev/sessions/state/) · [Events](https://adk.dev/events/) | 会话/用户/应用作用域、消息与工具事件、agent transfer/escalation 等运行事件 | 值何时是事实、何时失效，承诺如何形成/撤回，假设分支、Authority 来源和未来目标候选 |
| **LangGraph persistence** | 每个 super-step 后保存 `StateSnapshot`，含 channel values、下一批节点、tasks、config、metadata 和 parent checkpoint；`update_state` 形成新 checkpoint，从旧 checkpoint 恢复可 replay/fork。[Persistence](https://docs.langchain.com/oss/python/langgraph/persistence) · [Time travel](https://docs.langchain.com/oss/python/langgraph/use-time-travel) | graph reducer、执行 frontier、thread/checkpoint 身份、恢复和执行分支 | fork 本身不等于互斥意图假设；channel 值本身没有 AGM 修订、承诺、权限或目标生命周期语义 |
| **Temporal Workflow** | 服务持久化 append-only Event History；Workflow 局部状态由确定性 replay 重建，Workflow Task 产生 commands 并映射为事件；`Continue-As-New` 显式传递新 run 的起始状态。[Events](https://docs.temporal.io/workflow-execution/event) · [Event History/Replay](https://docs.temporal.io/encyclopedia/event-history) · [Continue-As-New](https://docs.temporal.io/workflow-execution/continue-as-new) | Workflow/Run identity、Activity/Timer/Signal/Update 等执行事件、耐久恢复与确定性约束 | 业务值究竟是用户目标、环境事实、证据、权限还是预测；历史顺序本身不决定何者应覆盖何者 |
| **OpenAI Agents SDK Sessions** | 运行前 `get_items()` 取回用户、assistant、tool call/result 等 items 并拼接输入，运行后追加新 items；支持 `add_items`、`pop_item`、`clear_session` 和压缩 session。[Sessions](https://openai.github.io/openai-agents-python/sessions/) | 会话身份、item 顺序和模型上下文续接 | `pop_item` 不是一般化 belief revision；session 本身不规定 occurrence、承诺、Authority、失效依赖或未决分支 |

**已核实的共同限制。** 这些 state 机制主要回答“哪些运行数据要保存、何时 checkpoint、怎样恢复”；它们通常允许应用保存任意业务对象，却不替应用规定事实、用户承诺、执行证据、权限、置信度、任务 occurrence 和未来候选目标之间的不同更新法则。因此，**持久化和可恢复是 Intent IR 的必要工程能力，不是足以区分 Intent IR 的概念机制**。

### 13.2 已核实的一手机制：可借用的动态 primitive

| 原始机制 | 一手来源中真正新增的 primitive | 对动态 Intent IR 有启发、但文献没有替本项目作出的决定 |
|---|---|---|
| **Event Sourcing** | 状态变化保存为事件序列，可重建过去状态、做 temporal query，并从某点形成替代时间线。[Fowler 原始模式说明](https://martinfowler.com/eaaDev/EventSourcing.html) | 事件流提供历史和 replay；事件类型、冲突优先级以及“谁有权改变意图”仍须本项目定义 |
| **AGM belief revision** | contraction 从信念集移除命题，revision 纳入新命题；partial-meet contraction 以最大保留为目标选择 remainder sets，并有对应公设和表示定理。[Alchourrón、Gärdenfors、Makinson 原论文](https://doi.org/10.2307/2274239) | 它证明“撤回不是覆盖一段摘要”，但经典封闭信念集不直接表示任务 occurrence、执行证据或权限 |
| **TMS / ATMS** | Doyle TMS 保存 belief 的 justification，依赖变化时维护 IN/OUT 并做 dependency-directed backtracking；de Kleer ATMS 给节点保存最小 assumption environments，并以 nogood 标记不一致环境，从而并存多个世界。[TMS 原论文](https://doi.org/10.1016/0004-3702%2879%2990008-0) · [ATMS 原论文](https://doi.org/10.1016/0004-3702%2886%2990080-9) | TMS 提供失效传播，ATMS 提供未决分支；自然语言命题抽取、置信和 Authority 不能由 justification 自动推出 |
| **BDI、commitment 与 reactive goal lifecycle** | Cohen–Levesque 把 intention 形式化为带放弃条件的 persistent goal；PRS 用 beliefs、goals、Knowledge Areas 和 intention structure 对环境事件反应；CAN goal lifecycle 显式处理目标成功、失败、挂起与恢复。[Intention is Choice with Commitment](https://doi.org/10.1016/0004-3702%2890%2990055-5) · [PRS 原论文](https://cdn.aaai.org/AAAI/1987/AAAI87-121.pdf) · [Goal lifecycle 原论文](https://doi.org/10.1007/s10458-013-9238-9) | 这些机制把“有一个目标值”升级为提议、承诺、挂起、完成、失败、放弃等生命周期；用户语言何时足以触发状态转换仍是 Compiler 推断问题 |
| **W3C PROV 与双时态数据** | PROV-DM 定义 Entity/Activity/Agent，以及 generation、usage、derivation、revision、invalidation、attribution、association、delegation；双时态模型区分事实在世界中的 valid time 与系统持有该记录的 transaction time。[W3C PROV-DM](https://www.w3.org/TR/prov-dm/) · [Snodgrass–Ahn 原论文](https://doi.org/10.1145/318898.318921) | 可区分“何时有效、何时知道、来自谁”；PROV 记录责任/委托但不自行决定来源可信度，也不是授权策略 |
| **Differential dataflow** | 对输入变化传播差分，并支持嵌套迭代的增量维护，而不是每次重算完整结果。[McSherry 等原论文页](https://www.microsoft.com/en-us/research/publication/differential-dataflow/) | 可将 IR 更新实现为局部影响传播；何种意图变化应产生何种 delta 仍需语义层 |
| **UMA** | 摘要核实：Unified Memory Agent 维护 compact core summary 与结构化 Memory Bank；Memory Bank 支持 create/update/delete/reorganize；记忆操作与问答在同一 policy 中端到端 RL。评测含 Ledger-QA 等动态状态跟踪。[UMA](https://arxiv.org/abs/2602.18493) | 目标是 long-context memory/QA utility，不是用户规范性 Intent。摘要未给出名为 `UpdateCore` 或 Retrieve/List 的原文 API；先前文档中的这些名字标为来源不足，不得当实现契约 |
| **Memory-R1** | 摘要核实：两个 specialized agents——Memory Manager 学习 ADD/UPDATE/DELETE/NOOP，Answer Agent 预选并推理相关条目；两者都用 outcome-driven RL（PPO/GRPO）微调。[Memory-R1](https://aclanthology.org/2026.acl-long.583/) | 学的是 memory bank 读写与 QA 效用。先前写成“冻结 Answer Agent 给奖励”不准确：冻结 task model 属于 MCMA，不是 Memory-R1 |
| **STITCH** | 摘要核实：STITCH（Structured Intent Tracking in Contextual History）给每个 trajectory step 索引 contextual intent：当前 latent goal（主题段）、action type、salient entity types；检索时按当前 step 的 intent 兼容性过滤，抑制语义相似但不兼容的历史。[STITCH](https://aclanthology.org/2026.findings-acl.584/) | contextual intent 是检索线索，不是 Compiler-owned 规范性 Intent IR |
| **MCMA** | 摘要核实：Meta-Cognitive Memory Abstraction 把记忆抽象当作可学习技能；冻结 task model + 用 DPO 训练的 memory copilot；记忆按抽象层级组织，无可迁移记忆时可迁移 copilot 本身。[MCMA](https://aclanthology.org/2026.findings-acl.1535/) | 先前把 MCMA 写成 episodic memory + 高层 script 是压缩；摘要只保证抽象层级与 copilot/task 分离，内部层级名称来源不足 |

**名称核对。** 当前一手来源中有两个不同的 FORGE：`Formal Policy Enforcement for Real-World Agentic Systems` 将自然语言 policy 编译为带 clause provenance 的 Datalog，在每个 action join point 由 reference monitor 依据角色、因果依赖和外部状态作 allow/deny；其系统名为 **FORGE（FOrmal Runtime Guarantee Enforcement）**。[policy FORGE](https://arxiv.org/abs/2602.16708) 另一个 **FORGE** 是通过失败轨迹生成 Rules/Examples/Mixed memory、以 population broadcast 替换活跃实例 memory 的自演化记忆方法。[memory FORGE](https://arxiv.org/abs/2605.16233) 两者不能混为同一机制。

同样有两个近期同名 ProvenanceGuard：一个在工具执行前检查 proposed tool、parameters 和 interpretation 是否可追溯到用户请求、工具文档与先前交互，属于 runtime guardrail；另一个对 MCP 回答做 atomic claim、source routing、NLI support 和 source-attribution 核验，属于生成后来源验证。[misalignment ProvenanceGuard](https://arxiv.org/abs/2607.01236) · [source-aware ProvenanceGuard](https://arxiv.org/abs/2606.18037) 二者都说明“来源关系比 pooled context 更强”，但前者不维护长期 Intent，后者也明确不证明来源本身正确。

### 13.3 对项目的设计推论：四个对象不能互相改名

以下是**项目设计推论**，不是上述文献的共同结论。

| 对象 | 最小职责 | 更新权与触发 | 删除它后，复杂性实际落到哪里 |
|---|---|---|---|
| **Intent IR** | 保存跨轮的当前/暂停/候选 intent、occurrence identity、有效与失效关系、未决解释、Authority 边界及其来源；允许非单调更新 | 只由 Intent Compiler 在新用户输入或已准入 Execution Evidence 到达时更新 | 落到 raw history 重读、rolling summary、executor scratchpad 或隐式 prompt 推理；每轮都要重新猜修订、任务身份和权限，无法做私有状态干预 |
| **Execution Evidence** | 独立保存动作、工具结果、错误、executor-visible tests 和环境变化及其 provenance；它支持或反驳事实/可行性判断，但不自动改写用户目标 | Exec Loop 只能返回；管理层校验来源、完整性、task/turn、时效后接纳 | 要么污染 Intent IR，把“测试失败”错当“用户撤回目标”；要么留在 executor 私有历史，使 Compiler 无法可靠判断完成、失败和世界变化 |
| **generic session/workflow state** | 提供消息、runtime variables、checkpoint、event history、恢复和调度所需的工程持久化 | runtime、workflow nodes、tools 或 session API 按各自生命周期更新 | persistence、replay、crash recovery、运行中间值和调度 frontier 必须由 Compiler 私建；但即使保留它，也不会自动获得意图语义 |
| **Compiled Intent** | 从私有 IR 为“这个 occurrence、这个 turn、这个 Authority 时点”选择性投影当前可执行语义；它是 Exec Loop 唯一收到的 treatment 任务输入 | 只由 Compiler 编译并版本化；Exec Loop 只读 | executor 必须读私有 IR、原始 prompt 或完整历史并自行选择当前语义，Compiler ownership、最小披露、投影消融和消费归因随之坍塌 |

Intent IR 真正超越 session state，至少应同时具备以下可观察性质：

1. **类型化的规范性差异。** 用户目标/约束、环境事实、Execution Evidence、未决假设、Authority 和未来候选不能只是同一 key-value/message 类型。
2. **非单调更新。** revise/retract/revoke/expire 产生可追踪的失效及依赖传播，不以删除历史或整段重写掩盖变化。
3. **occurrence 与 lifecycle。** “相似内容”不等于“同一任务”；active、suspended、resumed、completed、abandoned 和 candidate 是不同状态。
4. **来源受限的状态转换。** Evidence 可改变“是否完成/是否可行/世界事实”，不能自行形成目标或扩大 Authority；LLM 推测只能进入 hypothesis/candidate。
5. **面向未来但不冒充事实。** 系统可保存“若 X 出现则可能形成 Y”的 frontier，但只有满足明确 activation 条件后才进入 current intent。
6. **选择性编译。** Compiled Intent 不是 IR dump 或 session summary；无关/暂停 occurrence、内部置信、私有 evidence 细节和未获授权的候选不应默认下发。

### 13.4 候选雏形：六种机制上真正不同的路线

以下全部是**项目候选推论**，候选名称是项目造词。它们共用 Intent IR → Compiled Intent 契约，但主要因果管理机制不同；不应把后一个未消融的严格超集直接算成第二个独立机制。文献 TMS/ATMS/Event Sourcing 只提供可借用 primitive，不把本候选自动变成那些原文系统。

#### 候选 A：事件流 + 多投影视图（项目名：Event-projected Intent）

不是 Fowler Event Sourcing 的原文机制。Event Sourcing 提供 append-only 事件与 replay；本候选额外规定 intent event 类型、supersedes/tombstone、occurrence、Authority 和 Compiled Intent 投影。

- **核心状态与 update primitive：** append-only typed intent events，加由 reducer 物化的 `current / suspended / unresolved / authority / provenance` 多个 projection。最小事件可为 `open_occurrence`、`assert`、`revise`、`retract`、`suspend`、`resume`、`grant`、`revoke`、`expire`、`attach_evidence`、`no_op`；revision 通过 `supersedes` 指向旧 event，而不是覆盖文本。
- **时间、失效、关系、并行/暂停、不确定性、Authority：** event 同时带 event time、admission/transaction time、source、occurrence ID 和 causal parent；失效由 tombstone/supersedes 表示；任务以 occurrence 分区并可并行 materialize；暂停只改变 lifecycle，不删除内容；未决解释是显式 alternative events；grant 只能由授权 source 产生，reducer 对跨 task 继承采用 deny-by-default 和 expiry。
- **编译：** 选择一个当前 occurrence 的 active projection，加入仍有效约束、必须避免的 superseded behavior、未决项和当前有效 Authority；暂停任务及内部 event log 不下发。
- **比 session state 动态在哪里：** 不只保存“最新值”，而保存语义 delta、因果顺序和可重放的多视图；同一事件可局部更新 current view、Authority view 和 resume view。
- **主要风险：** LLM 可能选错 event type 或 occurrence；事件 schema 过早固化；projection bug 会稳定地产生错误状态。
- **首版/后续：** 首版由一个 LLM 在一次调用中提出 events 并生成 Compiled Intent，确定性代码只做 schema、版本、ACL、append、digest 和基本 reducer；后续把 lifecycle、Authority meet、tombstone 和 projection 迁移到确定性 reducer。
- **区分实验：** 长 update chain 后重放到任一版本；revision 后恢复旧 snapshot；no-op 只允许 event-log digest 变化而 current projection/Compiled Intent 语义 digest 不变。它应优于整段 summary，但在多重互斥假设上可能弱于候选 C。

#### 候选 B：支持关系图（项目名：Selective-support / temporal provenance graph）

- **核心状态与 update primitive：** proposition/goal/constraint 节点、typed support/attack/derivation 边、justification、IN/OUT/UNRESOLVED 状态，以及独立 Evidence 引用；更新为 `justify`、`undercut`、`invalidate_source`、`retract_assumption` 和局部 dependency propagation。
- **时间、失效、关系、并行/暂停、不确定性、Authority：** 节点带 valid/transaction interval；失效沿 justification 传播；occurrence、depends-on、conflicts-with、supersedes 是图关系；每个并行任务有 lifecycle 节点，暂停令其不可编译但保留支持图；多个仍成立的 justification 表达不确定性；Authority 节点只能由授权来源支持，普通 evidence/模型推断没有指向 grant 的合法边型。
- **编译：** 只投影当前 occurrence 中 IN 且有可审计支持的目标/约束；OUT 但行为上危险的旧约束转为“不得继续按旧版本行动”；矛盾或支持不足的节点输出 unresolved/clarify，而非取最高相似项。
- **比 session state 动态在哪里：** 新证据可使一条支持失效并局部撤回所有依赖结论，而不用重写全部 state；同一命题可以因另一条独立支持继续有效。
- **主要风险：** 自然语言 proposition 边界和 justification 正确性难；循环依赖、图膨胀和错误传播；“IN”易被误解为客观真理。
- **首版/后续：** 首版让 LLM 产出 graph patch 和支持说明，代码校验引用存在、边型和来源；后续以项目确定性 reachability 传播、双时态查询和 provenance consistency 替代 LLM 的状态传播。这借鉴 TMS 的 justification / IN-OUT，但不实现 Doyle TMS 的 dependency-directed backtracking 或完整 theorem prover。
- **区分实验：** 构造一个约束有两条支持、后续只撤回一条的 twin，以及“测试失败只反驳完成状态、不反驳用户目标”的 twin。候选 B 应表现出依赖选择性，候选 A 若 reducer 只做 last-write-wins 可能失败。

#### 候选 C：分支意图假设（项目名；借鉴 ATMS 的 environment/nogood 思想）

- **核心状态与 update primitive：** assumption、environment（兼容假设集合）、nogood、branch posterior/score 和每个 branch 的任务投影；更新为 `assume`、`fork`、`mark_nogood`、`strengthen/weaken`、`resolve`、`merge_equivalent`。
- **时间、失效、关系、并行/暂停、不确定性、Authority：** 每个 environment 有 born/expiry/resolved time 和 provenance；失效可只淘汰包含某 assumption 的 branches；occurrence 与暂停状态是 branch-local relation；不确定性由多个并存 environment 本身表达；Authority 取所有仍可行 branches 的安全交集，任何 branch 的模型推测都不能新增 grant。
- **编译：** 若 branches 在安全行为上有交集，编译该交集；若 action-relevant 分歧未解，编译 alternatives、禁止不可逆动作并建议澄清；只在显式用户证据或已声明规则排除其他 branches 后选择单一投影。
- **比 session state 动态在哪里：** 不强迫每轮生成一个唯一“当前摘要”，而维护可被后续证据选择性淘汰的 possible worlds。
- **主要风险：** branch explosion、分数伪精确、LLM 偷偷合并分支；过度保守导致反复澄清。
- **首版/后续：** 首版由 LLM 生成至多 `k` 个可行为区分的 hypotheses、共同安全部分和 disambiguator；代码强制 branch cap、nogood、Authority intersection 和 candidate 隔离。后续若要加强，可再考虑 ATMS 的 label 最小化、等价分支合并和确定性 dominance pruning；那些是文献 ATMS 能力，不是本候选首版已实现的机制。
- **区分实验：** 给出两个都合理但会导致不同不可逆操作的解释，再延迟三轮澄清。候选 C 应保持两支且不先行动；候选 B 倾向 UNRESOLVED 单节点，候选 A 倾向记录 alternatives 但没有环境组合语义。

#### 候选 D：constraint / commitment calculus + goal lifecycle

- **核心状态与 update primitive：** `desire/proposal → adopted goal → commitment → suspended/achieved/failed/dropped` 的显式状态机，配合 hard/soft constraints、deadline、dependency 和 scoped capability/Authority token；更新为 `propose`、`adopt`、`commit`、`relax`、`suspend`、`resume`、`achieve`、`drop`、`grant/revoke/expire`。
- **时间、失效、关系、并行/暂停、不确定性、Authority：** interval/deadline 和终止条件是一等对象；supersede/drop 关闭旧 commitment；parent/child、precondition、mutex、same/different occurrence 表达关系；多个 goal machine 可并行，暂停保留 continuation；未决 proposal 不升级为 commitment；Authority token 绑定 principal、scope、occurrence、动作类别和 expiry，组合只取交集或显式授权的并集。
- **编译：** 只输出当前 committed/adopted 且 lifecycle 可执行的 goals、hard constraints、blocking unresolved proposals 和有效 capability；desire、已完成/放弃 goal、其他 occurrence 与过期 token 不投影。
- **比 session state 动态在哪里：** 变化由规范性 lifecycle transition 驱动，而不是任意字段覆盖；“用户提到”“用户偏好”“用户已承诺”“可以执行”是不同状态。
- **主要风险：** 自然语言到 commitment 的门槛难标定；形式主义可能错过渐进形成的模糊意图；把计划状态误当用户承诺。
- **首版/后续：** 首版由 LLM 标注 lifecycle transition 和 trigger/termination reason，代码强制合法转移及 Authority scope；后续将状态机、deadline、capability checks、commitment conflict detection 代码化。
- **区分实验：** 交织两个同名任务，先 suspend 一个、完成另一个、再 resume，并在中途撤销一次权限。候选 D 应在 lifecycle 与 Authority 时点上最稳定；候选 B 更擅长支持依赖，候选 C 更擅长解释歧义。

#### 候选 E：multi-resolution latent-symbolic state

- **核心状态与 update primitive：** 保留原始 event anchors、symbolic current commitments、episodic summaries、高层 task scripts 和可选 latent memory；controller 可 `add/update/delete/noop`、split/merge occurrence、promote/demote abstraction、consolidate/deconsolidate。
- **时间、失效、关系、并行/暂停、不确定性、Authority：** 所有抽象必须回链 source event/evidence 与时间；tombstone 和 lifecycle 留在 symbolic 层；task hierarchy 支持并行/暂停；不确定性可在 symbolic hypotheses 和 latent score 中并存，但 score 不能替代状态；Authority 永远只在可审计 symbolic ledger 中，由确定性 gate 读取，禁止藏在 latent state。
- **编译：** 按当前风险、horizon 和 context budget 选择分辨率：高风险动作投影 source-grounded 细节，长期恢复投影 task script + active constraints，普通轮次投影紧凑 current view。
- **比 session state 动态在哪里：** 不仅压缩历史，而是可逆地改变管理粒度，并把未来可复用抽象与当前 occurrence 的精确信息分层。这对应三套不同记忆工作的部分启发，不能合成一种机制：UMA 的主动 CRUD、STITCH 的 contextual-intent 检索、MCMA 的可学习抽象层级。
- **主要风险：** latent 内容难审计，模型容量/训练数据成为强混淆；错误 consolidation 会同时污染多个任务；很容易退化为“更聪明的 summary”。
- **首版/后续：** 首版全部层由同一 LLM 黑盒生成，但必须保存 source anchors、symbolic tombstone 和 Authority ledger；后续可学习 controller/abstraction policy，确定性代码负责 validity、occurrence、Authority 和 provenance。
- **区分实验：** 在长轨迹中交替测试“只需高层恢复”和“必须找回一个已生效的细粒度约束”，并施加相同 context cap。候选 E 若真的多分辨率，应减少 token 而不牺牲细节；若只是 summary，会在 detail-sensitive twin 上失效。

#### 候选 F：predictive future-intent frontier

- **核心状态与 update primitive：** 在 current committed IR 之外维护隔离的 frontier：`(candidate intent transition, trigger, supporting source, confidence interval/ordinal, expiry, authority=none-by-default)`；更新为 `nominate`、`strengthen`、`weaken`、`dismiss`、`expire`、`activate`。
- **时间、失效、关系、并行/暂停、不确定性、Authority：** candidate 带 horizon/expiry 和产生时间；反证使其 weaken/dismiss；candidate 可关联某 occurrence、暂停任务和前置条件；多个候选并存表达不确定性；candidate 永远不能携带新增 Authority，activation 必须由明确用户输入或预先声明的外部规则触发。
- **编译：** 默认不把 candidate 当 current intent 下发；只有它影响“现在应避免不可逆锁定”时，Compiled Intent 才可表达“保留可逆性/存在未决方向”，或提出澄清。满足 activation 条件后才编译为 current goal。
- **比 session state 动态在哪里：** 它显式管理“可能发生、尚未发生”的状态转换，使系统能为未来保留选择权；它预测的是可验证的 transition hypothesis，不宣称知道用户未来心理。
- **主要风险：** confirmation bias、过度澄清、把 benchmark 规律泄漏成 future hint、候选静默升级为事实或权限。
- **首版/后续：** 首版由 LLM 生成少量候选、trigger 和反证，代码强制 quarantine、expiry、no-authority 和 activation provenance；后续以校准模型、survival/hazard 估计和 deterministic activation policy 替换候选排序。
- **区分实验：** 在一组轨迹中候选后来形成，在配对组中候选明确不形成；测 preparation/rework 收益与 false anticipation cost，并检查未触发 candidate 是否绝不改变不可逆 action 或 Authority。候选 F 是唯一直接面向 future frontier 的路线。

### 13.5 首版可运行推荐

#### 推荐 1：最小黑盒——Event-projected Black-box V0（项目名）

采用候选 A 的最小子集。一个 LLM call 同时读取新用户输入、旧 managed state 和已准入 Evidence，输出 `(proposed_event_ops, next_private_state, compiled_intent)`；确定性外壳立即实现 schema 校验、event sequence/version、occurrence ID、source/provenance、Intent IR 与 Evidence 分库存储、Exec 只读隔离、Authority deny-by-default、artifact digest 和 replay。LLM 可暂时负责 occurrence 判断、revision/retraction 解释、暂停/恢复和 projection 文本；后续把 reducer 与 Authority checks 代码化。

**这是首个 coding prototype 的推荐。** 原因不是它理论最强，而是它在一次 LLM 黑盒调用下已产生可测试的机制差异：typed delta、tombstone、occurrence、replay、单独 Evidence、Authority source 和 selective Compiled Intent。rolling session summary 没有“从旧版本 replay”“撤回只影响目标 occurrence”“no-op 保持 current projection”“swap stale/current Compiled Intent”这些操作性承诺，所以该 V0 不会仅因输出是自然语言就退化为 session summary。

#### 推荐 2：更动态但仍轻量——Selective-support Intent Graph（项目名）

不要称为 TMS-lite。它借鉴 TMS 的“支持变化则局部失效”，但首版只在推荐 1 的 event journal 上增加候选 B 的最小 proposition/support graph，不实现 justification 网络、dependency-directed backtracking 或 theorem prover。只支持 `supports`、`supersedes`、`conflicts`、`scoped_to_occurrence`、`derived_from_evidence` 和 IN/OUT/UNRESOLVED；用确定性 reachability 做失效传播，LLM 只提出 node/edge patch。它比 V0 更容易区分“证据改变完成事实”与“用户改变目标”，也能测试多支持 selective retraction；代价是 proposition identity 和 graph patch 正确性成为新故障面。

#### 推荐 3：后续研究型——Branching Commitment Frontier

组合候选 C、D、F：项目 branching environments 管解释分支（不是 ATMS 实现），commitment lifecycle 管当前规范状态，future frontier 管尚未形成的可触发候选；Authority 始终是单独的 scoped capability calculus。Compiled Intent 只取当前 commitments 与所有可行 branches 的安全交集。这个候选最能体现“面向未来的动态性”，但必须分别消融 branch、commitment 和 frontier，否则不能作为一个独立机制解释 C2。

### 13.6 最小可证伪行为与候选区分

| 行为 | 最小 twin / intervention | 通过条件 |
|---|---|---|
| **revision / retraction** | 同一旧约束分别被修订、彻底撤回；另做 stale-state swap | 当前 Compiled Intent 和动作只改变受影响后果；旧版本可审计但不继续约束行为 |
| **task occurrence** | 两个表面相同任务，分别是同一 occurrence 的延续和新 occurrence | 不 false merge Authority/约束，也不 false split 合法 continuity |
| **suspend / resume** | 任务 A 暂停，完成 B 后恢复 A；期间修改 A 的一个条件 | A 暂停时不执行，恢复后保留仍有效 continuity 并吸收合法更新 |
| **evidence vs intent** | executor-visible test 失败；配对用户明确撤回目标 | 前者只更新完成/可行性/事实，后者才更新目标；隐藏 verifier 永不进入 Compiler |
| **unresolved alternatives** | 两种解释都合理且动作后果不同，澄清延迟出现 | 澄清前不静默选定不可逆分支；澄清后只淘汰不兼容 branch |
| **Authority non-escalation** | tool result 建议更广权限、另一 task 曾有 grant、grant 已过期 | Evidence、模型建议、相似 task 和过期 token 都不能扩大当前 Authority |
| **no-op stability** | paraphrase/重复输入与真正 revision 最小配对 | no-op 可增加审计 event，但 current semantic projection、Compiled Intent 与行为保持等价 |
| **Compiled Intent projection selectivity** | 同一 IR 分别激活 occurrence A/B；再 swap stale/current artifact | 只投影目标 occurrence 的当前语义；artifact swap 只改变对应行为，不泄漏暂停/候选/private Evidence |

候选之间的主区分因素应预注册：A 看长事件链与 replay；B 看多支持与依赖失效；C 看并存解释组合；D 看 goal/Authority lifecycle；E 看 context pressure 下的细节与抽象切换；F 看未来候选形成与不形成的双向成本。若所有候选只由同一 prompt 生成一段“当前状态”且没有这些针对性 intervention，它们在实验上仍只是 prompt variants，不能支持机制差异主张。

### 13.7 尚未解决、需要用户决定的问题

1. **V0 最小 typed event 集是否现在冻结。** 冻结可立即编码和 replay；不冻结则保留开放性，但无法明确判断一个 update 是 revision、new occurrence 还是 no-op。建议只冻结操作语义和 envelope，不冻结 Atom/Relation ontology。
2. **Authority 是 IR 内的受保护子域，还是独立 capability ledger。** 为降低 silent escalation 风险，建议物理独立 ledger，Intent IR 只保存引用和当前投影；这仍需产品选择。
3. **首版是否允许 future frontier。** 建议首个 coding A/B 不启用，只记录接口占位；在 current-intent V0 通过 no-op、retraction 和 Authority 测试后，才以独立 factorial 加入候选 F。
4. **Compiled Intent 对 unresolved alternatives 的默认行为。** 可选择“只表达未决并禁止不可逆动作”或“主动要求澄清”；后者会引入 interaction policy，不应在 replay-only 首版中暗含。
5. **LLM 黑盒是否必须输出可审计 event ops。** 若完全 opaque，只能做 snapshot/reset 因果测试；若输出 provisional ops，可更早定位故障但会引入 schema 诱导。推荐“private state 可 opaque、操作 envelope 必须 typed”。
6. **首个 C2 对比选候选 A（Event-projected）vs 候选 B（Selective-support），还是 A vs D。** A/B 更容易共享 event substrate 并测试失效传播；A/D 的机制距离更大、但 commitment 标注更难。首个 coding prototype 只实现 A，不应提前声称 C2。候选 B 不是 TMS 实现。

## 14. 2026-09-16：AREX 原始机制与 Intent Compiler 候选映射

本节避免使用脱离来源后难以还原的简称。`verification-driven state transition` 不是 AREX 论文定义的正式术语，而是先前讨论对论文机制的压缩概括；后续不把它单独当作机制名称。AREX 的原始机制、实验证据和本项目推论必须分开记录。

一手来源：

- [AREX 论文：Towards a Recursively Self-Improving Agent for Deep Research](https://arxiv.org/abs/2607.21461)
- [AREX 官方主页](https://vectorspacelab.github.io/arex-model/)
- [BAAI/AREX-Turbo 模型卡](https://huggingface.co/BAAI/AREX-Turbo)
- [BAAI/AREX-Base 模型卡](https://huggingface.co/BAAI/AREX-Base)

### 14.1 已核实事实：AREX 是 Agent/模型，不是独立 benchmark

AREX 是 BAAI 发布的 recursively self-improving deep-research Agent 家族。AREX-Turbo 基于 Qwen3.5-4B，是 4B dense 模型；AREX-Base 基于 Qwen3.5-122B-A10B，是 122B total、10B active 的 MoE。两者模型卡均标记 262,144 context 和 Apache 2.0。

论文使用统一的 long-horizon search-agent interface，在 BrowseComp、GAIA、xbench-DeepSearch-2510、DeepSearchQA、WideSearch-en 和 HLE with tools 上评测。AREX 本身不是这些 benchmark 的合集，也没有名为“AREX benchmark”的独立任务发布。

论文中的 RSI 指运行时对**研究状态和当前答案**进行递归修正，不是在每个任务运行期间在线修改模型参数。模型能力来自任务前完成的 supervised capability acquisition、agentic mid-training 和 reinforcement learning。

### 14.2 已核实事实：AREX 的内层状态与 Autonomous Context Updating

给定固定原始问题 `x`，第 `k` 个 recursive round 有当前研究目标 `q^(k)`。内层 Research Loop 产生按时间累积的研究轨迹：

```text
h_t^(k) = [(analysis_i, action_i, observation_i)] from i=1..t
```

该轨迹是当前 recursive round 的 working research state。Agent 根据原问题、当前目标和轨迹决定下一次 search/visit 等研究动作。

AREX 可自主调用 `update_context`，由同一个模型把累积轨迹变成紧凑研究状态：

```text
z_t^(k) = f_theta(h_t^(k))
```

调用后，有效上下文不再是完整历史，而是：

```text
effective_context
  = most_recent z_tau^(k)
  + interactions after tau
```

论文明确描述 `z_t^(k)` 应保留：

- verified findings 及 source identifiers；
- current candidates；
- unresolved constraints；
- validity concerns；
- rejected candidates；
- next-step plan。

论文对这一点的原始定位是：context update 不只是按 token 阈值压缩，而是按研究语义进展刷新 research state。模型可在解决子问题、淘汰候选、协调冲突证据或改变研究计划时主动调用它。

在 BrowseComp 分析中，论文报告：

- 80.3% 的 cases 调用过 `update_context`；
- 调用时 active context 平均约 25,721 token、中位数约 25,386，通常远早于 128K 上限；
- 66.9% 的调用由 search-strategy revision 触发；
- 更新内容中 72.1% 保留 verified findings、81.5% 保留 rejected candidates、95.5% 保留 unresolved constraints、96.4% 保留 next-step plan。

这些数字描述 AREX 在 BrowseComp 上的行为，不证明相同触发分布会迁移到 coding 或 evolving user intent。

### 14.3 已核实事实：Structured Finish 与外层 Self-Improvement Loop

内层调用 `finish` 后产生结构化结果：

```text
r^(k) = (
  provisional answer y^(k),
  supporting evidence E^(k),
  answer-level confidence s^(k)
)
```

`finish` 只结束当前内层 round，不一定结束整个递归过程。外层 Self-Improvement Loop 同时读取原问题、结构化结果和有效终态上下文，产生：

```text
g^(k) = (
  recoverability v^(k),
  information to preserve P^(k),
  issues to investigate I^(k),
  next objective q^(k+1)
)
```

论文定义的控制规则是：

```text
Accept   when confidence reaches threshold
Refine   when confidence is low and trajectory is recoverable
Restart  when confidence is low and trajectory is not recoverable
```

`Refine` 保留 `P^(k)`，隔离 `I^(k)`，并把未解决问题转成更窄的下一轮目标 `q^(k+1)`。`Restart` 丢弃当前研究轨迹，仅从原始问题重新初始化。递归轮数有预设上限；若始终未达到 confidence threshold，返回已完成结果中 confidence 最高者。

论文原文说 verification “can also define the transition between research rounds”，并成为递归改进 research state 和 solution 的 active control signal。此前简称来源于这里，但 AREX 的实际实现必须用上述 `finish → assess → Accept/Refine/Restart` 对象和规则描述，不能只留下简称。

### 14.4 已核实事实：机制消融支持到什么程度

论文在 BrowseComp 上把 Autonomous Context Updating（ACU）和 outer loop 分开：

```text
without ACU, without outer loop: 59.6
without ACU, with outer loop:    69.8
with ACU, without outer loop:    71.4
with ACU, with outer loop:       82.5
```

在 matched single-round 条件下，ACU 相对完整未压缩轨迹提高 11.8 个绝对点；在有/无 ACU 的条件下，outer loop 分别提高 10.2 和 11.1 个点。完整系统比两者都没有的设置高 22.9 个点。

这些结果支持两个限定主张：

1. 对 AREX 模型和 BrowseComp，语义化 research-state refresh 比持续保留完整轨迹更有效；
2. 允许低 confidence 结果进入下一 recursive round，比直接返回第一次 `finish` 的结果更有效。

它们不单独证明：

- AREX state 是用户 Intent IR；
- constraint audit 在 coding task 上同样有效；
- confidence 能正确代表每项用户要求；
- Exec Loop 与管理层分离是收益原因；
- 在线参数自我改进已经发生。

### 14.5 重要限制：AREX 的“验证”主要仍由模型完成

AREX inference 时的 confidence、recoverability、preserved information、remaining issues 和 next objective 主要由模型产生。论文不是为每个约束配置确定性程序 verifier。

训练阶段更强地使用了外部可验证结构：

- synthetic task 要求约束联合唯一确定答案且能由可用证据验证；
- key-step detector 只在工具观察产生 answer-relevant evidence、支持 verified transition 或形成 actionable improvement state 时标记关键步骤；
- key-step 标注只保留在最终答案验证通过的训练轨迹中；
- reinforcement learning 仍以 final-answer outcome 为主，关键步骤只获得有界辅助 shaping。

因此，对 AREX inference 更准确的描述是**由模型执行、以证据为依据的 constraint assessment**，而不是形式化或确定性验证。错误 confidence、错误 evidence support、错误 recoverability 和错误 Restart 都仍是可能的故障。

### 14.6 与本项目对象的直接差异

AREX 原始问题在 recursive process 中固定；它把未解决 answer constraints 转成下一轮研究目标。它没有研究用户在运行期间新增、修订、撤回、暂停或形成 Intent 的情形。

AREX 的 research/improvement state 混合了：

- evidence；
- answer candidates；
- rejected candidates；
- unresolved answer constraints；
- validity concerns；
- confidence；
- next research plan。

本项目不能把该对象直接改名为 Intent IR：

- 用户来源的目标、约束、occurrence、未决选择和 Authority 属于 Intent IR；
- 动作、工具结果、executor-visible tests 和环境变化属于 Execution Evidence；
- candidate solution、coding strategy 和 next execution plan 属于 Exec Loop 的求解状态；
- Compiled Intent 是从 Intent IR 为当前 turn 产生的选择性投影。

AREX 允许执行 Agent 自主调用 `update_context` 并改变自己的 research state；本项目则要求 Exec Loop 不能修改 Intent IR。若借用 AREX 机制，constraint assessment 和 managed-state update 必须位于 Compiler-owned 管理层，而不能直接把 Exec 的 context update 当作 Intent IR 更新。

AREX 的 `Restart` 也不能原样映射。本项目不能因为一次低 confidence 执行轨迹就丢弃用户承诺、来源和 Authority；最多可以重置执行假设、候选方案或不可靠的 Evidence-derived assessment，并保留用户来源的 Intent event history。

### 14.7 项目设计推论：AREX-inspired Constraint-Audit Compiler

以下是项目候选设计，不是 AREX 已实现功能。

该候选把管理层状态分成至少三个逻辑对象：

```text
Intent IR
  = 用户当前要什么，以及用户输入造成的 revision/retraction/lifecycle

Execution Evidence
  = 实际发生了什么、来源是什么、何时有效

Constraint Assessment
  = 当前实现相对每项 active Intent constraint 的满足状态
```

`Constraint Assessment` 可使用以下临时状态：

```text
unattempted
in_progress
satisfied
violated
blocked
unknown
evidence_conflicted
```

该状态不能改变用户来源的规范性 Intent。两类输入采用不同 update 权限：

```text
new authorized user input
  → 可 open / revise / retract / suspend / resume Intent

admitted Execution Evidence
  → 只能更新 satisfaction、feasibility、world fact、blocker 和 uncertainty
```

若用户预先声明条件式 Intent，例如“测试失败就采用方案 B”，Execution Evidence 可以证明 activation condition 已满足；真正授权状态转换的仍是用户此前声明的规则，而不是测试失败自行创造新目标。

管理层随后借用 AREX 的保留/隔离思想，但不复制其研究计划：

```text
preserve:
  已满足且仍有效、后续不得回归的要求

isolate:
  violated / blocked / unresolved active requirements

reject:
  已失效的执行候选或被 Evidence 反驳的事实判断

compile:
  当前目标
  + 尚未满足或需要修复的要求
  + 必须保持的既有正确行为
  + 不可擅自决定的 unresolved 内容
  + 当前 Authority
```

该设计不把 next coding plan 放入 Intent IR。Exec Loop 仍自行选择实现方法，除非用户明确指定方法约束。

### 14.8 与 Event-projected Intent 的关系和正确实验定位

Event-projected Intent（项目候选名）与 AREX-inspired Constraint-Audit（项目候选名）目前首先是两个正交因素，不应仅凭名称计作 C2：

- Event-projected Intent 主要规定用户输入怎样形成 typed intent events、supersedes/tombstone、occurrence 和 lifecycle；
- Constraint-Audit 主要规定 Execution Evidence 怎样更新 constraint satisfaction、保留正确成果、隔离缺口并影响下一版 Compiled Intent。

首个合理实验是 factorial/ablation：

```text
typed event-based Intent update: on / off
×
constraint-level Evidence assessment: on / off
```

这可以回答两个模块是否分别贡献收益，但仍不自动证明两个完整、主要机制不同的 Intent Compiler。

只有构造两个都满足完整 Compiler contract 的替代实现时，才可作为未来 C2 候选：

1. **Source/Event-first Compiler**：事件和来源关系是主要状态机制；Evidence 作为 typed event/reference 进入 reducer，Compiled Intent 从 current projection 生成。
2. **Constraint/Audit-first Compiler**：以 active constraints、support/violation 状态和 recursive assessment 为主要状态机制；它也必须独立处理用户 revision、retraction、occurrence、unresolved 和 Authority，而不能只给 Event-first 增加一个 outer loop。

若 Constraint-Audit 只是 Event-first 的未消融严格超集，它应作为组件消融，而不是第二个 C2 机制。

### 14.9 候选价值与进入时机

AREX-inspired Constraint-Audit 值得保留为后续 Compiler 实现候选，因为它有直接消融证据支持“保存已验证进展、隔离未解决约束、再形成针对性下一轮状态”这一研究策略。

它不替代当前推荐的首版 Event-projected Black-box V0，原因是：

- 首版先要处理用户输入造成的 revision、retraction 和 occurrence；
- AREX 原机制没有 evolving user intent；
- constraint assessment 需要先定义 Intent constraint 与 Evidence 的独立边界；
- 额外 audit/recursive round 会增加调用和成本；
- 当前 coding prototype 尚未证明模型 confidence 在逐轮 requirements 上可靠。

建议顺序：

```text
Event-projected Black-box V0
→ 加入最小 constraint assessment 作为单独 factor
→ 验证 satisfaction/violation 状态能否改善 recovery 和 regression
→ 再决定是否实现 recursive Refine/Restart 或完整 Audit-first Compiler
```

若未来测试 AREX-Turbo 作为 Compiler-side 模型，应先验证其 OpenAI-compatible inference、structured output 和本项目无 search/visit 工具条件下的行为。模型权重公开不等于已经有官方 Ollama 集成，也不证明其 deep-research training 会迁移到 coding Intent 管理。

## 15. OpenCode 插件管理层与实验可观测性（绑定更新，2026-09-16）

本节取代本文及其他阶段文档中把 WorkSwarm/openJiuwen 当作首版运行时的表述：**它们不再属于本项目范围；首版是 OpenCode 插件形态的管理层。** 下表的“事实”只来自 OpenCode 官方文档和当前稳定版 `v1.18.31`（commit `014614d35b397775e5d397a490fc72368c894ec2`）源码；“原型决定”是据此作出的本项目设计推论，不冒充 OpenCode 已提供的保证。

### 15.1 能力边界

| 观察面 | OpenCode v1.18.31 的可用事实 | 缺口 | 首版原型决定（推论） |
|---|---|---|---|
| 插件装载与顺序 | 项目插件位于 `.opencode/plugins/`；配置也可加载 npm plugin。文档给出 global/project config 与 plugin 目录的装载顺序，并说明 hooks sequentially run。[Plugins](https://opencode.ai/docs/plugins/)；稳定版 dispatcher 对 typed hook 逐个 `await`。[source](https://github.com/anomalyco/opencode/blob/014614d35b397775e5d397a490fc72368c894ec2/packages/opencode/src/plugin/index.ts#L244-L297) | 通用 `event` 回调在该 dispatcher 中以 `void` 调用，不等待其异步工作。 | 编译、IR 提交、交付记录走 awaited typed hook；事件流用于观察，完成后再用 SDK 读回对账，不能把唯一 durable write 放在异步 `event` 回调里。 |
| 输入拦截与 Intent 交付 | `chat.message` 可原地修改 `UserMessage` 和 `Part[]`；调用点在 hook 返回后执行 `sessions.updateMessage`/`updatePart`，会话循环随后重新读取已持久化 messages，再经 experimental message transform 转成 model messages。[hook type](https://github.com/anomalyco/opencode/blob/014614d35b397775e5d397a490fc72368c894ec2/packages/plugin/src/index.ts#L222-L335)；[persist](https://github.com/anomalyco/opencode/blob/014614d35b397775e5d397a490fc72368c894ec2/packages/opencode/src/session/prompt.ts#L995-L1049)；[reload](https://github.com/anomalyco/opencode/blob/014614d35b397775e5d397a490fc72368c894ec2/packages/opencode/src/session/prompt.ts#L1081-L1094)；[model conversion](https://github.com/anomalyco/opencode/blob/014614d35b397775e5d397a490fc72368c894ec2/packages/opencode/src/session/prompt.ts#L1255-L1286) | 这能证明“修改已持久化并进入 OpenCode 的 pre-model 路径”，但不等于 provider 最终收到的逐字节 payload；后续 system/message/provider transforms 仍可改变请求。调用点也依赖原对象，不能假定用新数组替换 `output.parts` 一定生效。 | 在 `chat.message` 内等待 Compiler、提交版本化 IR 后**原地**改写 text part。用 `session.message(s)` 按 `sessionID/messageID` 读回，保存精确文本和 digest，产生 `executor_message.persisted`；若实验必须证明 provider wire payload，再增加受控 provider proxy/Ollama 请求捕获，而不是把 hook mutation 当证明。 |
| 会话、消息与状态 | SDK/Server 提供 session create/get/list/messages/message/status/diff/abort 等 API，以及 `/event` SSE；消息返回 `info + Part[]`。[SDK](https://opencode.ai/docs/sdk/)；[Server](https://opencode.ai/docs/server/) | 原生 session status 只有 `idle`、`busy`、`retry`，不是实验任务生命周期。[generated type](https://github.com/anomalyco/opencode/blob/014614d35b397775e5d397a490fc72368c894ec2/packages/sdk/js/src/gen/types.gen.ts#L406-L486) | 插件自行维护 `admitted → compiling → state_committed → intent_persisted → executing → verifying → passed/failed`，原生 status 只作为执行信号。每次 turn 在 idle/终态后读取 messages、parts、diff 做 reconciliation。 |
| 工具调用 | `tool.execute.before/after` 带 `tool`、`sessionID`、`callID`、args；after 还可见/修改 title、output、metadata。工具包装器在执行前后触发它们。[hook type](https://github.com/anomalyco/opencode/blob/014614d35b397775e5d397a490fc72368c894ec2/packages/plugin/src/index.ts#L277-L294)；[execution](https://github.com/anomalyco/opencode/blob/014614d35b397775e5d397a490fc72368c894ec2/packages/opencode/src/session/tools.ts#L92-L133) | 工具抛错时不会到达 after；只数 after 会漏记失败调用。 | before 产生 `tool.started`，after 产生成功结果；最终以 persisted `ToolPart` 按唯一 `callID` 对账 completed/error、output、metadata 与 start/end，避免双计数或漏错。 |
| token、cost、时间与重试 | `AssistantMessage` 有 model/provider、created/completed、cost，以及 input/output/reasoning/cache token；`StepFinishPart` 有 reason、cost、tokens；`ToolPart` 有 start/end、output/error/metadata；另有 `RetryPart`。[message](https://github.com/anomalyco/opencode/blob/014614d35b397775e5d397a490fc72368c894ec2/packages/sdk/js/src/gen/types.gen.ts#L112-L141)；[tool/step](https://github.com/anomalyco/opencode/blob/014614d35b397775e5d397a490fc72368c894ec2/packages/sdk/js/src/gen/types.gen.ts#L237-L349)；[retry/union](https://github.com/anomalyco/opencode/blob/014614d35b397775e5d397a490fc72368c894ec2/packages/sdk/js/src/gen/types.gen.ts#L364-L404) | cost 是 OpenCode 根据模型配置价格和 usage 计算的元数据；本地模型无价格配置时可为 0。类型没有 Ollama 原生 load/prompt-eval/eval duration、模型 digest、quantization 或 template。[usage calculation](https://github.com/anomalyco/opencode/blob/014614d35b397775e5d397a490fc72368c894ec2/packages/opencode/src/session/session.ts#L338-L404) | OpenCode parts 作为统一计数来源；Compiler 与 Exec 分开记账。需要 Ollama 原生指标时另接其原生 telemetry，不能从 OpenCode 的 `cost=0` 推断“无成本”或从 message wall time 推断推理时间。 |
| 权限与隔离 | 权限规则支持 `allow/ask/deny`、通配与逐工具匹配，custom/MCP tool 也按 tool name 匹配；`external_directory` 与 `.env` 有单独默认边界。[Permissions](https://opencode.ai/docs/permissions/) | 插件与 OpenCode 同进程；规则约束 agent 的工具访问，不是插件进程的 OS 隔离。 | Compiler 状态放在 benchmark worktree 外，Exec 的 `external_directory` 明确 deny；同时 IR mutation 只存在于管理层，不注册成可由 Exec 主动调用的 custom tool。首版将此陈述为逻辑隔离，不夸大为安全沙箱。 |
| 自定义工具 | `.opencode/tools/`/全局 tools 可定义 Zod 参数和 `execute`；context 提供 agent、session/message ID、directory/worktree、abort、metadata、ask。[Custom tools](https://opencode.ai/docs/custom-tools/)；[stable type](https://github.com/anomalyco/opencode/blob/014614d35b397775e5d397a490fc72368c894ec2/packages/plugin/src/tool.ts#L3-L54) | 同名 custom tool 可覆盖 built-in；暴露写状态工具会把管理权重新交给 Exec。 | 管理写路径不用 custom tool。若为调试增加工具，只允许只读、默认不给 benchmark agent。 |
| 存储与日志 | plugin input 提供 SDK client、project、directory、worktree、server URL、Bun shell；文档支持 `client.app.log()` 结构化日志。[plugin input](https://github.com/anomalyco/opencode/blob/014614d35b397775e5d397a490fc72368c894ec2/packages/plugin/src/index.ts#L53-L70)；[Plugins](https://opencode.ai/docs/plugins/) | 稳定 hook API 没有 plugin KV/durable-store contract，官方日志也没有文档化的实验查询/重放接口。closure 内存重启即失。 | 使用插件自有 append-only JSONL 或 SQLite，放在 worktree 外并按 run/task/arm 命名；OpenCode 历史是执行证据，不代替 Compiler-owned IR。日志只做诊断，不作为唯一事实源。 |

### 15.2 首版最小观测契约

每条记录至少包含：`event_id`、wall/monotonic time、`run_id`、`task_id`、arm、turn、phase、`sessionID`、`messageID`、`callID`（如有）、IR/artifact version、causal parent、model/provider、payload digest、duration、error。最小事件集为：

```text
run.started
turn.input_admitted
compiler.started | compiler.completed | compiler.failed
intent_state.committed
compiled_intent.emitted
executor_message.persisted
executor.session.status
llm.step.finished
tool.started | tool.completed | tool.error
workspace.diff
verifier.started | verifier.result
turn.completed
```

观测来源分四层，且不能混为同一种保证：

1. awaited hooks：输入接纳、Compiler、IR commit、消息原地改写、tool before/after；
2. SSE/event 与 persisted Parts：session、assistant step、retry、tool 终态；
3. idle 后 SDK readback：精确 delivered message、完整 parts、diff 与状态对账；
4. benchmark/verifier bridge：外部测试结果与通过/失败原因。

仪表盘首版只需回答实验迭代最关键的问题：当前任务/turn/phase，原始输入、Compiled Intent 与**已持久化交付文本**三者的精确内容和 digest，IR/artifact 版本，Compiler/Exec 各自模型与 token/cost/时长，工具调用总数及 completed/error 明细，retry/error，workspace diff，以及 verifier 结果。计数从不可变事件按 `callID`/message/step ID 聚合，不另维护容易漂移的可变 counter。

### 15.3 进入正式实验前的 OpenCode smoke gate

在固定 `v1.18.31`、固定 plugin lockfile 和固定 provider 配置下，先用一个最小任务验证以下条件，全部满足才跑 paired benchmark：

1. hook 原地改写后，SDK readback 的 persisted text 与预期 Compiled Intent 完全相同，digest 一致；原始用户文本未出现在该 Exec user message；
2. Exec 的一次成功工具调用和一次失败工具调用，都能由 `callID` 在最终 ToolPart 中唯一对账，统计不依赖 after hook；
3. Assistant/StepFinish 中的 model、provider、tokens、cost、timestamps 被保存；本地 provider 的缺失/零值被标为 `unavailable` 或 `computed-zero`，不伪装成实测值；
4. 插件重启后可从自有 durable store 恢复 IR version 与未完成 turn，并能与 OpenCode session history 对账；
5. Exec 通过工具无法读取或修改 worktree 外的 Compiler store；任何只读诊断工具在 benchmark agent 中不可用；
6. verifier 结果、workspace diff、Intent artifact 和事件日志能由同一 `run_id/task_id/turn` 关联并导出。

这个 gate 证明的是当前 OpenCode 稳定版上的插件闭环与可观测闭环；它不把 pre-model persisted delivery 误称为 provider-wire 捕获，也不把 OpenCode 权限误称为进程级隔离。

## 16. Harbor / EvoCode 本地可行性证据（2026-09-14 静态审计，2026-09-17 归并）

本节保留一次本地工程审计中仍有价值的事实，但不把当时的 Harbor wrapper 方案继续当作产品设计。当前边界是：**OpenCode 插件负责管理层与执行接线；Harbor 若被采用，只是产品外部的 benchmark 驱动和 verifier runner。** 本节数字来自当时的本地副本，只证明工程落点，正式实验仍需固定并审计官方 clean EvoCode-Bench release。

### 16.1 Harbor 能提供的外部实验能力

- Harbor multi-step 可让多个 step 共享同一环境，同时默认让每一步使用独立 conversation；这适合维持代码状态并显式控制每轮模型可见信息。
- `MultiStepTrial` 逐轮保存 instruction、agent artifact、step verifier 与 `StepResult`；separate verifier 可只接收声明的 artifacts，适合作为正式隔离方向。
- Agent 和 verifier 支持外置模块导入，无需修改 Harbor 源码；`AgentContext` 可保存 input/output/cache token、USD cost 和 metadata。
- Harbor 原生 `resume_trajectory` 会保留 executor 私有历史，因此不能被当作 Compiled Intent 的交付路径或首轮隔离条件。若研究 native history，它必须成为显式实验因子。
- Harbor 有 timeout，但 max-turn、temperature、seed 和 action budget 依赖具体 agent/backend；不可把未被后端执行或回报的参数写成已经匹配。
- 当时的 Harbor 不支持 multi-step 与 user-agent bridge 同时使用，因此它不能直接承担后续真人或外部交互驱动实验。

### 16.2 当时本地 EvoCode 副本的静态盘点

- 共发现 26 个 multi-step task、227 个 step；排除两个名称含 `__not_1234` 的可疑目录后为 24 task / 209 step，常规长度为 7–15 轮。
- 227/227 step 均含 `instruction.md`、`tests/test.sh` 和 `solution/solve.sh`。
- 227/227 verifier 均输出 `CASE_RESULT` 与按 `origin_step` 汇总的机器可读日志，但最终只写二元 `reward.txt`；正式分析必须另行保留 turnwise、多维诊断。
- `task.toml` 当时共标注 extension 198 次、correction 69 次、conflict 42 次。测试以 origin、requirement 和 type 编码旧要求，具备用于推导 stale retention 与 collateral regression 的原始信息。

这些数字不能证明任务质量、clean 状态或论文复现性，也不能直接决定样本。正式采用前仍需：固定官方 release/runner/verifier 版本；逐任务核验 provenance；运行 prior reference solutions；建立 current requirement 到 test case 的映射；将 verifier 与 agent 隔离；并把二元 reward 扩展为结构化的 active satisfaction、stale retention、change resolution、collateral damage、first drift 与 recovery 记录。

### 16.3 对当前实验的实际意义

EvoCode-Bench 适合后续 5–15 轮持久 coding 阶段，但不应直接用整个本地副本启动首个 vertical slice。首个任务应来自 clean official release，指令清楚、行为可验证，并包含至少一个会改变当前要求的事件。OpenCode 负责运行和记录管理层/Exec Loop；外部 runner 只负责按轮供给输入、保持任务快照并执行独立验证。如此保留 benchmark 资产的价值，同时不让 Harbor 的旧实现设想反向定义 Intent Compiler。

## 17. 2026-09-18：TypeSafe 博客与当前规范的对照

本节记录外部观点与项目推论，不代表新增实验结果。当前决定以 `spec.md` 为准；这些资料不改变 `CONTEXT.md` 的术语，也不把当前候选结构确认为最终设计。

### 17.1 原始资料及证据边界

- **作者观点：** [The Bitterest Lesson](https://typesafe.ai/blog/bitterest-lesson) 强调先选择适合外部系统的学习任务，再讨论数据、计算和算法。这是方法论主张，未证明一个普适排序，也未提供持续意图管理算法。
- **作者观点及承诺：** [Lies, Damned Lies, and Benchmarks](https://typesafe.ai/blog/antibenchmaxxing) 指出反复依据公开分数选择配置也会造成测试偏向；TypeSafe 声明发布带日期的评测快照和不利证据。本次未独立验证其执行情况，不据此否定公开 benchmark。
- **产品方向：** [官方 Manifesto](https://typesafe.ai/manifesto) 主张模型承担语义判断、代码承担精确计算，模块应可检查、测试和限制。它不是多模块组合可靠性的实验结果，也不证明我们的管理层有效。
- [视频文章](https://typesafe.ai/blog/ai-too-good-to-be-true-too-bad-to-be-useful-typesafe-ai) 本次未取得可核实的官方文字稿，不从标题或二手摘要引入技术结论。本次未运行 Jev 或独立复跑 TypeSafe 评测。

### 17.2 已有规定与此次澄清

| 研究启发 | 权威 spec 已有内容 | 此次澄清 |
| --- | --- | --- |
| 优化任务应对应实际需要 | 语义契约与内部表示分开；evaluator ledger 独立；共享评分不对齐候选私有字段 | 不用当前 proposal 的操作顺序或 requirement 数量定义所有方案的正确答案；独立判断仍需在整轮状态与交付中核对 |
| 数据处理会改变实际被测任务 | 各 arm 输入资格一致；预处理成本单独记录；禁止未来信息泄漏 | 保留原始输入；代码、引用、反驳和指代不得被未记录的人工整理替代；从给定候选开始的测试只支持对应小判断的结论 |
| 根据评测调试也属于方案选择 | 开发与保留样本分组隔离；各候选同等开发机会；pilot 不作确认依据 | 记录提示调整、候选构造和人工修补；修复用例保留回归价值，但不作为独立未见样本证据 |
| 模块应可检查和组合 | Compiler/Exec 所有权、来源与 Authority 分离；状态及组件消融 | 可审计不等于正确，单项判断正确不等于组合与跨轮行为正确；不因此预定拆分方式或增加模块 |

以上是结合本项目的推论，不是 TypeSafe 已替我们验证的结论。既有多 bench、逐类报告与不同方案可在不同任务分布胜出的安排继续有效，不新增大型 benchmark，也不照搬“公开即退休”。

当前番茄钟仅是最小流程用例。包括 unresolved 候选限制在内的实现选择，仍应先在选定 benchmark 的真实输入与变化中观察表现，再由具体失败决定是否修改；此处不确认缺陷或提前扩展表示。官方 adapter 用于比较、必要时有限修改的决定已记录在 spec；它不是 Jev 模型本身，其调用记录不能替代 Compiler 状态/交付历史或独立 Observer。后续同日已完成独立比较工具接入和一次真实 Luna 兼容检查，具体证据以 spec 的 Model-comparison adapter 小节为准；尚无 Intent 比较或 Jev 运行结果。
