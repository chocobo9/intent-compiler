# SDD 返修次数与时间预算约束：适配设计及实验记录

日期：2026-10-08（America/Toronto）。状态：**只读分析完成，方案未实施，参数未定稿**。

后续：用户随后授权实施，实际改动与最终参数见 [运行适配实施记录](2026-10-08-bounded-runtime-implementation.md)。本文保留授权前的分析快照，下文“未实施”描述的是分析时点。

本次唯一新增产物是本文。未修改实现、上游 SDD、冻结运行或官方 verifier，未启动模型和评测。后续报告必须把“拟议变化”与“实际生效变化”分开。

## 1. 范围与结论

用户决定：保留 PRD 一致性检查，限制返修次数和时间；IC 接入 SDD，不改 SDD 核心架构、验证语义和角色职责。

推荐将预算放在 **SDD-only 与 IC+SDD 共用的运行适配层**：准备时冻结一份共同策略，执行时在角色派发前和阶段调用前强制执行，运行器负责截止、取消和结果归档。SDD 继续决定修什么、如何验证及是否通过。

只改 prompt 或工作流现有 max_rounds 不足以限制 SpecArt 内部返修。只限制 IC 派发次数也无效：一次 SDD 启动内部仍能反复创建 Repair/Verifier。

不采用 IC 旧 Atom 的“失败后再派发一次”规则作为新的 SDD 重启机制。当前融合合同要求每次用户更新最多启动一个新 SDD workflow；预算约束应在同一次运行内部生效。

## 2. 可复核基线

- IC 仓库：`D:/huawei/intent_compiler/project`，分支 `integration/sdd`，HEAD `ccf37ecb946d4214c96fed9bcac96ea0b0eb0189`。仓库有既存未提交修改；HEAD 不代表全部实验实现。
- 共同适配：`experiments/sdd/prepare.py`、`run_r1.py`、`test_prepare.py`、`test_run_r1.py`。
- 当前 SDD workflow 来源：`D:/sdd/prdcheck/workflow/speclang-flow.sh` 与 `workflow.json`。`D:/sdd/sdd-loop-skeleton/workflow/speclang-flow.sh` 不存在，不应据此路径定位。
- 证据运行：`D:/huawei/EvoCodeBench/harbor_runs/sdd-luna-dpipe-r1-20261008-191917z-7d7fec79`，下文称 R3。实际冻结脚本以 R3 内文件为准，不能用后来修改的工作区 runner 代替。
- 模型配置：`openai/gpt-6-luna-fast`、`high-fast`。R3 的 `completion.json` 记录 SDD 流程 3000.265 秒、退出码 124；总体 3008.109 秒。
- R3 最后代码构建/单测通过，最后修复尚未完成独立复验；PRD 检查未进入。官方测试缺少可执行文件，没有得到有效功能测评。评测打包问题与返修预算问题分别记录。
- 超时后仍有本轮 sh/python/opencode 残留，已清理，证据 `timeout-orphan-cleanup.json`。因此历史运行器的“模型已结束才开放官方测试”注释没有被进程控制可靠保证。

## 3. IC 现有约束：借鉴什么

| 位置 | 现状 | 本次借鉴 |
| --- | --- | --- |
| `src/core/intent-compiler-v2.ts`，`ATOM_VERSION_EXECUTION_LIMIT` 与派发检查 | 两次用户输入之间同一 Atom 版本最多执行 2 次，含首次；到限记录 limit_reached | 派发之前做确定性计数，不能靠模型自报 |
| `src/core/compiler-store-v2.ts`，默认 budget | 每批 3 次、run 总计 30 次管理请求，实验可覆盖 | 多入口共享总账；局部上限不能相乘 |
| `src/core/parent-generation.ts`，`requiredCalls()` | 给后续生成及必要核对保留调用额度 | 启动修复前保留复验及后续 PRD 的时间 |
| `src/model/opencode-transport.ts` | 默认请求超时 300000ms，取消未确认会阻止自动重试 | 超时必须确认旧任务停止，不能重叠执行 |
| `src/adapters/opencode.ts`，`advanceForTurn()` | 最多 2 次尝试；超过 10 分钟不再启动重试 | 重试准入时间窗与执行中硬截止分开 |

这些是不同单位的上限：管理请求不等于执行次数，角色委派也不等于底层模型请求。不能把“2 次执行”直接描述为“2 次返修”。

## 4. SDD 实际调用链与控制缺口

`run_r1.execute()` → `speclang-flow.sh` → 阶段函数 → `run_skill/run_skill_continue` → `OPENCODE_BIN` → `model_guard.py` → 原生 OpenCode。

coding 的一次 OpenCode 调用内部：Root → task(specart-implement) → task(specart-verify) → REPAIR_REQUIRED → 新的 implement → 新的 verify。内部 task 不会为每次委派重新经过外部 `model_guard.py`。

| 循环/门禁 | 当前控制 | 缺口 |
| --- | --- | --- |
| 规格 Author/Review | skill 要求审查通过再接受 | 同一阶段内可反复委派，无独立次数硬上限 |
| coding 内 Repair/Verifier | skill 要求每次修复后使用新 Verifier | 没有次数上限；占用整个 workflow 时间 |
| coding 外层编译修复 | `max_compile_rounds=5`，检查最多 5 次，修复最多 4 次 | 与内部修复另计，可能叠加 |
| PRD Check/Fix | `max_rounds=5`，另有编译门禁 | 最后一轮 check 后仍可能 fix，不能把 5 轮等同于 4 次修复后完整复验 |
| PRD 无进展 | 比较 unresolved/blocked/manual_review 三个数量 | 数量相同不一定是同一批问题；本次不改上游语义，不另称其为准确缺陷指纹 |
| runner 最终复验 | flow_rc=0 且存在 SPEC 后，单独最多 300 秒，只验证 | 必须核对报告及源版本，不能把进程退出码当验收结果 |
| 全流程 | SDD 3000 秒、最终复验 300 秒、官方评测 300 秒，总计 3600 秒 | SDD 内没有 PRD 时间预留；取消、日志收尾不可靠 |

源码入口：`prepare.workflow()` 当前明确保留上游预算；`test_prepare.py` 断言 max_rounds/max_compile_rounds 为 5。修改预算后这些消费者需要同步，不能只改 runner 提示词。

## 5. 加在哪里：推荐分工

### 5.1 共同配置：唯一策略来源

在 `experiments/sdd/` 新增共同预算配置及加载模块（拟议文件 `budget-policy.json`、`budget.py`）。由 `prepare.py` 读取、校验、冻结，并记录摘要；runner、guard、插件读取同一冻结副本，不各自重复默认值。

建议字段（全为拟议，不是现有接口）：

- `policy_version`：报告中的策略身份。
- `round_deadline_seconds`：整个实验轮次截止。
- `stage_max_seconds`：设计、coding、PRD、最终验证、官方评测各段上限。
- `stage_repair_limits`：coding 与 PRD 的修复启动次数，均不含首次实现。
- `max_total_repairs`：整个 SDD 运行的修复启动总数，含编译失败触发的修复。
- `max_design_revisions`：规格初次 author 后的修订次数，单独统计。
- `verification_reserve_seconds`、`cleanup_reserve_seconds`：修复后的复验及停止收尾预留。

复用原 workflow 的 max_compile_rounds/max_rounds 作为外层第二道限制。不要删除这些字段，也不要将其数值直接当作语义返修次数。上游字段与共同策略的映射写入 provenance。

### 5.2 角色派发前：真正的次数硬限制

建议新增独立的运行预算插件（拟议 `budget-plugin.ts`），仅装入两组共同的 OpenCode runtime；不要直接启用整个 IC 插件作为 SDD-only 的依赖。

本仓库已有 `tool.execute.before/after` hook 接口及授权使用例，见 `src/adapters/opencode.ts`。拟在 task 委派之前按明确角色与当前阶段原子预占额度，完成后写状态。用 `(run_id, session_id, call_id)` 去重，父子会话共享总账。

初次 implement 不算 repair，之后同阶段 implement 算 repair；PRD 的独立 `prd-fix` 启动由外层 guard 计费。一个 PRD fix 下若有嵌套 implement，必须关联同一 repair_id，避免重复收费。并发申请不能突破总额。

仅凭 description 中是否含“repair”计数不可靠。也不能靠事后解析 stream 拦截，因为那时子任务已经启动。

**待验证能力边界：** 当前安装的 OpenCode 1.18.31 是否在子会话 task 启动前执行该 hook、拒绝如何向 Root 返回、是否有替代派发入口、如何获取可靠父子关联，尚未实测。仓库的接口只能证明已有集成方式，不能证明本运行时覆盖完整。若缺少前置拦截能力，不把 prompt 约束宣称为硬上限；先报告能力缺口，再选择执行器适配扩展，不能偷偷改 SDD 核心循环。

插件还需限制到限后的继续工具执行，并由 runner 取消活动会话。否则 Root 可能不断重试被拒绝的 task 或自行写代码。保留原 SDD 的“Root 不实现、角色分工”约束，新增部分只负责运行授权和预算。

### 5.3 外层 guard 与 runner：阶段时间及生命周期

- `model_guard.py` 保留模型/variant 校验、原生 argv 传递；增加对明确阶段身份、PRD fix 和编译修复入口的预算准入。阶段识别必须来自结构化上下文或稳定工作流调用标签，不能用自然语言猜测。
- 具体阶段身份如何从现有调用传入 guard 尚需验证；优先共同配置中的可识别入口。若无法无歧义传递，不通过静默修改上游 shell 解决。
- `run_r1.py` 负责整轮截止、分阶段截止和给必做后续阶段保留额度。一次黑盒 `proc.wait(3000)` 不足以完成这项工作。
- 每次修复准入同时检查次数和剩余时间：必须能保留本次修复后的独立验证，以及尚未执行的 PRD/最终验证预算。预留只能保证资源不被抢占，不能保证模型在时限内完成。
- 超时先请求会话取消，再停止本次运行的进程容器/Job Object（Windows 的具体可行性待验证），确认所有子进程退出后才能冻结产物和运行官方测试。取消未确认时状态为 cleanup_unconfirmed，禁止新开发及官方评测。
- 主日志写阶段开始、修复编号、阶段截止、停止原因和最终路径，UTF-8；progress 在状态变化时原子更新。无需靠高频轮询制造“进度”。

## 6. 候选参数与时间分配

以下是用于讨论的首个候选，不是已批准或已验证的运行参数：

| 参数 | 候选值 | 理由 |
| --- | --- | --- |
| coding 修复 | 最多 2 次，含其编译修复 | 给独立验证发现的问题两次处理机会，避免无限追加 |
| PRD 修复 | 最多 1 次，之后必须重新检查 | 保留需求核对和一次纠偏 |
| 全局产品修复 | 最多 3 次 | coding/PRD/compile 共享，不让多个局部循环放大预算 |
| 规格修订 | 初次 Author 后最多 2 次 | 阻止更早的设计审查耗尽预算 |
| 总时间 | 60 分钟 | 暂沿用 R3 外层额度，保持可比性 |

候选固定分配：前置 PRD/SD/change/规格设计 24 分钟，coding 14 分钟，PRD Check/Fix 10 分钟，最终独立验证 5 分钟，官方评测 5 分钟，取消/归档 2 分钟，共 60 分钟。coding 的 14 分钟应包含末次独立验证，不能全部用于修复。

R3 设计阶段约用了 28.5 分钟，因此该 60 分钟分配可能更早在设计阶段结束。不能承诺仅加次数限制就能完成 r1。实施前应依据同配置阶段耗时确定是否调整总时长或分配，并为两组统一冻结；不得只给其中一组临时延长。

先不新增 token 上限和独立的“缺陷语义相同”判定器。次数+时间足以实现本次目标，避免额外模型调用。源码摘要未变且再次请求同一修复的情况可作为确定性审计信息；不据自然语言相似度宣布无进展。

## 7. 到限后的状态与 PRD 保留语义

正常状态：`prepared → running/design → running/coding → running/prd_check → running/final_verify → stopped → official_evaluation → completed`。

修复子状态：`verification_required → repair_admission → repairing → verification_required`；每次修复使此前验证证据失效，最终 PASS 必须绑定当前源码/配置摘要。

异常状态：

- 次数到限：`repair_limit_reached`，记录阶段、计数、最后报告和未解决项。
- 时间不足以启动修复：`insufficient_reverification_budget`，不再修改代码。
- 执行中截止：`stage_timeout` 或 `round_timeout`，取消并进入收尾。
- 取消不能确认：`cleanup_unconfirmed`，禁止冻结为稳定结果或开始官方测试。
- 前置门禁未过：后继阶段标为 `not_reached_due_to_gate`，不可记为 skipped_by_policy 或 PASS。

**保留 PRD 检查不等于允许绕过 coding 门禁。** 现有 shell 在 coding 通过前不会进入 PRD，PRD 自身还要求 coding 完成标记。若 SpecArt 到限仍不通过，保持上游终止行为，并记录 PRD 未进入。不能制造 `.coding-done` 或 pass=true。

如果未来要求“即使 coding 未通过，也必须拿到 PRD 检查报告”，只能另行设计只读诊断路径，并明确其不属于已通过门禁的正式 PRD 阶段；这不包含在本推荐方案内。

PRD 修复后必须留出 PRD 复查；如果最后一次修复没有复查，状态为 verification_pending。PRD 改动也使之前 SpecArt 验证失效，因此保留最终独立复验，不因之前 PASS 而删除。

官方评测可评价已停止的失败/部分产物，但与 SDD 内部通过状态分开记录。官方结果不回流模型修复。调用成功和退出码 0 不等于功能通过。

## 8. 恢复与重新开发

- 恢复同次运行：run_id、原截止、策略摘要和累计次数不变；已启动的修复算已消费。先确认旧会话停止，读持久账本，不能清零计数或重设时钟。
- 等待/重连同一个仍运行的会话不算新修复；重新发起模型开发调用算新尝试，不能以“恢复”绕过上限。
- 到限运行是终态，不能自动创建新 run 来继续。再次启动开发需要新的明确授权，并独立记录与旧 run 的关系。
- 不允许修改冻结 R3 策略后称其为同一无人介入运行；本策略只适用于以后新冻结的实验。

## 9. 拟改文件与验收

| 文件 | 拟议变化 |
| --- | --- |
| `experiments/sdd/budget-policy.json`、`budget.py`（新增） | 策略与共享持久计数、截止计算；字段校验与去重 |
| `experiments/sdd/budget-plugin.ts`（新增，能力验证后决定） | 内部 task 前置准入；角色/父子会话计数、到限拒绝 |
| `experiments/sdd/prepare.py` | 冻结共同策略、保留 PRD、映射现有外层预算、生成角色预算说明 |
| `experiments/sdd/run_r1.py` 及其生成 guard | 加载同一策略、阶段准入、取消确认、最终结果和 UTF-8 日志收尾 |
| `experiments/sdd/test_prepare.py`、`test_run_r1.py`，新增预算测试 | 更新旧保留 5 轮的断言，验证前置拦截及状态 |
| `experiments/sdd/README.md`、`VALIDATION.md` | 实施后记录真实策略和验证结果；本次不改 |

不改 SDD validator、accept-design、验证判定、PRD 对照逻辑、官方 tests，也不迁移 IC 的 CI/Atom 合同。

验收清单（尚未执行）：

- [ ] 首次实现不计返修；第 N+1 次修复在产生子任务/文件副作用前被拒绝。
- [ ] 同 call 重放不重复扣费；不同子会话、并发请求、compile/PRD 入口不能绕过共享总额。
- [ ] PRD 最后一次允许修复后仍执行复查；预算不足时拒绝修复而非留下伪通过。
- [ ] 未到 coding 门禁的运行不伪造 PRD 完成；保留 PRD 未进入原因。
- [ ] 修复后旧验证自动视为过期，最后报告绑定最终输入摘要。
- [ ] 阶段截止可中断内部 task；无进展/模型反复请求被拒绝的 task 也会受截止控制。
- [ ] 父进程退出但子进程仍活着的场景被检测；清理失败时官方测试不可见、不可启动。
- [ ] 同次恢复不重置截止或额度；再次启动被 launch-once 和 run 身份约束阻止。
- [ ] 日志明确写预算耗尽及终态，UTF-8 监控可见；退出 0 但报告失败时不标成功。
- [ ] 两组使用完全相同的预算策略、模型、构建和评测配置；策略摘要可核对。

先做离线假执行器与 hook 兼容验证，再申请有预算的真实冒烟试跑；文档分析不自动启动付费模型实验。

## 10. 后续实验报告应保存的数据

每次运行保存：组别、用户轮次、run_id/恢复关系、代码基线和输入摘要、完整共同配置及哈希、模型/variant、上游与适配版本、各阶段开始/结束/时长、首次实现次数、各类修复和验证次数、消耗与拒绝记录、停止原因、取消确认、最终源码摘要、SpecArt/PRD 状态、官方 build 状态/通过数/总数、模型 usage 和未知费用项。

预算策略调整属于实验处理因素。R3 是“旧策略超时且存在运行器问题”的历史观察，不是新策略的对照成功率基线。新旧策略若输入、模型或适配修复不同，必须列出差异，不能把成绩变化全部归因于返修限额。A/B 的共同底座更改应同步生效，并单独区分 IC 管理开销与 SDD 开发开销。

本次记录的变更：**新增本文，0 项预算实现变更，0 次新运行**。实际实施日期、最终参数、commit/补丁哈希、离线验收和真实运行证据待后续授权后填写。
