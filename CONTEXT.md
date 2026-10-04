# Intent Compiler 术语

本文只维护共同语言，不规定实现字段、运行状态或授权。设计见 [CURRENT-DESIGN](development/CURRENT-DESIGN.md)，现状见 [dpipe 状态](experiments/evocode/harbor/dpipe/README.md)。

## Language

**Intent Compiler**:
一个面向系统内部的意图管理层。它从持续的用户输入中理解和整理意图，并把编译后的内容交给下游系统，以帮助提高长期任务中的行为可靠性。
_Avoid_: User-facing intent explainer, prompt summarizer, execution engine

**Intent IR**:
Intent Compiler 对一个大任务持续维护的整体意图蓝图，记录用户要什么、当前有效要求、适用范围和来源，随用户输入及任务理解的变化修订。Compiled Intent 是依据它形成的下属执行方案；保存原文不等于已正确理解原文的角色和含义。
_Avoid_: Chat history, System Prompt, long-term memory, execution state

**Atom**:
Compiled Intent 内经意图分析与拆解形成、可启动、可回传、可验收的具体工作单元，本身须说明行为和可观察的完成证据。一个 Atom 可以落实多项要求，共同要求可以影响多个 Atom；依据引用不能代替行为内容，执行状态由管理层另行维护。
_Avoid_: Intent IR management entry, sentence fragment, mandatory single tool call, fixed schema

**Goal**:
表达希望达到的结果，不自动包含方法、权限、依赖和执行步骤。Goal 与 Atom 的具体组织关系尚待设计，不再预设 Goal 是 Atom 的一种。
_Avoid_: Project, full task, plan

**Relation**:
Compiled Intent 内表达 Atom 之间依赖、联系或变化的关系，用来保留拆解后的整体语义。关系不等于执行状态，也不自行授予权限。
_Avoid_: Task Graph edge, fixed relation ontology

**Compiled Intent**:
Intent Compiler 根据当前 Intent IR 形成的整体执行方案，包含从 IR 分析拆解得到的多个 Atom、它们之间的 Relation 及指向 IR 的依据。运行时从方案中选择当前获准 Atom 交给 Exec Loop；执行循环不能直接修改该方案。
_Avoid_: User-facing explanation, full executor context, mutable agent scratchpad

**Exec Loop**:
使用 Compiled Intent 完成操作并向管理层返回操作状态的下游循环。它不能直接修改 Intent IR 或 Compiled Intent。
_Avoid_: Intent manager, Intent Compiler

**Authority**:
对 Agent 可以或不可以执行哪些操作的限制。Authority 与任务、风险和时间有关，不应因任务交叉或执行推进而自动永久扩大。
_Avoid_: Model confidence, capability discovery

**机械门槛 (Gate)**:
代码中可以判定的拒绝条件——引用可解析、声明登记匹配、覆盖率说明去向、修订规则、产物摘要一致。不通过即拒绝，与模型判断无关。
_Avoid_: 语义判断, 模型核对, 建议

**独立核对 (Check)**:
一次独立的模型调用，复核候选相对于当前委托的语义一致性。它只能给出通过或不通过与具体理由，不能改写候选，也不能给出业务答案。
_Avoid_: 验收, 评测, 门槛, 自评

**验收 (Acceptance)**:
管理层依据执行回传与证据对 Atom 与当前目标作出的提交判断（完成、失败、是否仍满足）。
_Avoid_: 模型核对, 官方评分, 自评

**评测 (Evaluation)**:
外部基准（官方测试与计分）以及本项目自己的审计维度。评测只用于衡量，不参与放行。
_Avoid_: 核对, 验收, 门槛
