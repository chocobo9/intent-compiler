# 模块地图

按修改任务定位入口，字段形状以源码为准，行为要求见当前设计。[当前设计](CURRENT-DESIGN.md) 按委托、任务形状、来源、生成、执行、存储分主题说明要求和实现；[dpipe 状态](../experiments/evocode/harbor/dpipe/README.md) 定位产物、失败及版本。读对应行，不必遍历所有模块。

| 要做什么 | 主要入口与职责 | 依赖、常见修改点与相关测试 |
| --- | --- | --- |
| 改管理批次、返修或预算 | [intent-compiler-v2.ts](../src/core/intent-compiler-v2.ts) 组织 acceptEvent/advance/authorize/inspect、prepare、核对及提交；[parent-generation.ts](../src/core/parent-generation.ts) 管 IR→临时父 IR→CI 的生成状态 | 依赖 store、model、source-payload、requirement-flow；feedback/reject、requiredCalls 在 parent-generation；先核对 [生成路径与返修边界](CURRENT-DESIGN.md#generation)。先读 [parent-generation.test.ts](../test/parent-generation.test.ts)、[advance-retry-policy.test.ts](../test/advance-retry-policy.test.ts)；整链离线测试 intent-compiler-v2 |
| 改来源选择、引用或局部编辑 | [source-payload.ts](../src/core/source-payload.ts) 分段、物化、edit 撤回记录和来源去向；[source-aliases.ts](../src/core/source-aliases.ts) 请求别名投影；resolver 仍在 intent-compiler-v2.ts | 先读 [来源、局部编辑与正文装配](CURRENT-DESIGN.md#sources)；模型选含义和范围，代码解析精确定位；测试 source-payload、source-aliases、source-ref-contract、local-source-edit。解析成功不等于语义完整 |
| 改 IR/CI、登记或最终正文装配 | [intent-contract.ts](../src/core/intent-contract.ts) 类型与机械形状；[intent-state-v2.ts](../src/core/intent-state-v2.ts) 应用 IR 变化；[requirement-flow.ts](../src/core/requirement-flow.ts) 选择来源及绑定要求；[compiled-intent.ts](../src/core/compiled-intent.ts) 构建 CI 与 Atom 台账 | 先读 [Atom/Relation](CURRENT-DESIGN.md#work) 和 [登记/装配](CURRENT-DESIGN.md#sources)；prepareCandidate 在编译器内协调这些模块；检查最终 Atom.task，不只读模型候选。测试 requirement-flow、compiled-intent、semantic-compilation、generation-stages |
| 改模型输入、输出形状或核对合同 | [compiler-model-v2.ts](../src/model/compiler-model-v2.ts)、[management-instructions.ts](../src/model/management-instructions.ts)、[generation-schema.ts](../src/model/generation-schema.ts)；CI 与核对请求中计划和改动前状态的投影在 [request-projection.ts](../src/core/request-projection.ts) | candidate(-check)-schema、strict 变体、[opencode-transport.ts](../src/model/opencode-transport.ts) 和 structured-provider-transport 须对齐；测试 compiler-model-v2、candidate-schema-strict、opencode-model-transport-v2。这是模型接口变更，不是文档整理 |
| 改存储、恢复、事件队列 | [compiler-store-v2.ts](../src/core/compiler-store-v2.ts) 管 snapshot、events、check-inputs、管理/执行记录和派生队列 | 先读 [持久化与恢复范围](CURRENT-DESIGN.md#persistence)；保留原始调用与派生视图的区别；测试 batch-queue、compiler-return-recovery、check-unavailable、update-batch |
| 改执行资格、关系或回传 | [execution-state.ts](../src/core/execution-state.ts)、[atom-admission.ts](../src/core/atom-admission.ts) 判定授权、条件、前驱结果；编译器协调回传评估 | 先核对 [执行资格与宿主边界](CURRENT-DESIGN.md#execution)；下游使用确切 Atom 版本，准备/拟派发不等于实际执行；测试 atom-lifecycle-v2、execution-state-v2、requirement-flow |
| 改宿主接入 | [harness/runtime-factory.ts](../src/harness/runtime-factory.ts) 按配置构造 v2 store/model；[runtime/opencode-compiler-v2.ts](../src/runtime/opencode-compiler-v2.ts) 读环境；[adapters/opencode.ts](../src/adapters/opencode.ts) 对接插件、派发与工具授权 | host-contract.ts 是宿主边界；`.opencode/plugins` 加载 dist。dpipe Python agent 与宿主 patch 是另一层，见 dpipe 入口。测试 opencode-adapter-v2、opencode-compiler-runtime-v2、dpipe-cli-drain |
| 看日志、成本、报告 | [observer/](../src/observer/)、[runtime/audit-report.ts](../src/runtime/audit-report.ts)、[runtime/cost-summary.ts](../src/runtime/cost-summary.ts)、[cli/](../src/cli/) | Observer events/artifacts 是观测证据；summary/report 是派生视图，不是 compiler store。测试 audit-report、cost-summary、runtime |

## 需要保留的非显然依赖

- [contract-clauses.json](contract-clauses.json) 与 [contract-enforcement.json](contract-enforcement.json) 被 [gate-fixtures.test.ts](../test/gate-fixtures.test.ts) 读取；后者也被 [gate-replay.mjs](../experiments/evocode/gate-replay.mjs) 读取。它们包含历史注记，不是当前全系统规格，但不能作为旧报告删除。
- [contract-settlement.json](contract-settlement.json) 是职责取舍记录；暂无源码读取不等于无设计价值，本轮保留。
- [view.ts](../src/core/view.ts) 有独立测试，但当前 src 主链没有导入它。不要把候选 view 设计当成已接线行为。
- v1 的 compiler/state/store/model 和兼容 runtime 仍被导出、测试或适配器使用，本轮不删、不迁移。
- `experiments/typesafe`、`experiments/intent`、paired-d3w9 是独立/历史实验工具；不据旧 README 自动启动任务。

## 构建与局部验证

`tsconfig.build.json` 只编译 src 到 dist；`tsconfig.test.json` 编译 src/test 到 .test-dist。普通 coding session 先确认授权和 dirty diff，再选对应离线测试；`npm test` 会运行全套，本次整理不需要。实验脚本可能直接启动模型、容器或执行器，不能为“看帮助/验证”随手运行。

研究/历史按需进入 [spec](../docs/authority/spec.md)、[历史设计](DESIGN-HISTORY.md) 或指定日期的 validation。旧提案、wayfinder 票据和验证报告不授予实施/运行权限，也不要求新 session 依次读完。
