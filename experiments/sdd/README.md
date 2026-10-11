# IC 接入 SDD：第一阶段共同底座

**当前状态（2026-10-10）**：适配器已恢复为 SDD 原流程。`run_r1.py` 只调用一次上游 `speclang-flow.sh` 跑完整 main 路径，只保留 Go/通用 CLI 所需的适配，预算账本、final 复验、续跑和诊断都已撤回。保留与撤回的逐项理由见 [恢复记录](records/2026-10-10-restore-upstream-sdd.md)。15 轮串行运行中：`D:/huawei/EvoCodeBench/harbor_runs/sdd-luna-dpipe-15round-20261010-173448z-4bcf08cf`（接续 `172025z-8c811e09`，R3 因 SD 表头适配缺陷重跑；IC+SDD 组同时运行：`ic-sdd-dpipe-15round-20261010-173448z-deb3b414`；R1 采纳 `140810z-6bce928b`，R2 经续跑通过，PRD 停在 NEED_MANUAL_DECISION 时按固定规则保留代码继续）。查看 `series.log`、`active-round.json`、`series-report.md`，不要重复启动。下文 2026-10-08/09 的描述是历史，其中预算、final 和续跑部分已不再适用。

2026-10-08，用户已授权 Go/CLI 适配、共同配置和离线验证。本目录在 `integration/sdd` 上维护；SDD 源目录本身没有 Git，故以 [overlay](overlay)、[基线及目标哈希](overlay-manifest.json)、[审阅补丁](upstream.patch) 保存完整改动。已同步到 `D:/sdd/sdd-loop-skeleton` 和 `D:/sdd/prdcheck` 的对应位置。

本阶段不包含 IC 的 CI 字段迁移、模型运行、实际 SDD 开发运行或 dpipe 官方评测。SDD 的设计/验收/实现/独立验证/修复机制保持原流程。

后续真实试跑（2026-10-08）：经单独授权，SDD-only dpipe R1 使用 `openai/gpt-6-luna-fast / high-fast` 完成一次纠正模型配置后的启动，耗时 1811 秒。SpecArt 设计已接受，但 coding 判定失败，未进入 PRD 复核和最终验证；容器内直接执行未修改的官方测试脚本，结果 **23/219，reward 0.0**。主要发现为 CLI 参数契约丢失、功能实现缺口，以及 Go 标准库 import 触发 SA187 阻断修复。此前错误模型启动已终止并单独保留，不计入本次统计。详见 [真实运行记录](records/2026-10-08-r1-result.json)；未据官方失败项改代码或自动重跑。

第二次试跑 `183929z-875153d4` 在变更说明阶段越界执行规格/实现，并在声明及验收基线冲突中阻塞，后按用户直接修复要求停止。阶段职责与 Go 合并参数签名匹配修正后，当时离线验收 112 项通过；第二次试跑没有官方评测结果。

第三次试跑 `191917z-7d7fec79` 在 coding 返修期间达到 50 分钟上限，未进入 PRD，官方打包失败。随后用户授权运行适配修复：现增加共享返修次数、阶段时限、完整进程树收尾、PRD/最终报告校验及可追溯的多包打包。**本次运行适配离线套件 30 项通过，未启动新的真实开发轮次**。当前配置与证据见 [实施记录](records/2026-10-08-bounded-runtime-implementation.md)，实施前分析见 [预算设计](records/2026-10-08-budget-constraints-design.md)。

## 文件与字段

| 文件（overlay 内路径相对 SDD 根目录） | 变化 |
| --- | --- |
| `.agents/skills/specart/assets/validator/go/main.go` | 用 Go 标准库 AST 解析声明、方法 receiver、结构/接口成员、import、位置和函数体；不执行目标项目 |
| `…/python/specart/helpers/go.py` | 编译并缓存 helper；失败返回 SA103，不回退到其他语言 |
| `…/python/specart/languages.py`、`adapters/spec.py` | 注册 go / go-ast，`.go` 扩展，无形式证明适配器；保留旧语言分派 |
| `…/python/specart/bundle.py` | summary 声明片段经专用入口解析；完整源码仍必须有 package |
| `…/python/specart/source_model.py` | 保留 Go 顶层方法 owner，继续使用既有声明保护与身份逻辑 |
| `…/python/specart/validator.py` | receiver 进入规约可见参数；检查多返回值位置及可解析成员；同名类型按包目录区分 |
| `…/python/specart/dependencies.py` | go.mod 解析项目内部 import，按相对目录确定稳定包身份；标准库和第三方包不进入内部依赖保护；不能解析的映射保留 unresolved |
| 四个 SpecArt `SKILL.md`、`references/go-language.md` | 增加 Go 入口、声明示例、返回值约定及验证边界 |
| `tests/specart-validator/test_go_adapter.py` | Go 源码设计、验收、实现检查、验证报告与失效测试 |
| [prepare.py](prepare.py) | 在新运行目录物化两份同源基线，生成共同 workflow 和 Go CLI 域资料；不启动 runner |
| [sync.py](sync.py) | 先检查全部目标哈希，再同步；上游有其他修改时整体拒绝；可重复运行 |
| [run_r1.py](run_r1.py) | 冻结 Go 工具链与构建配置；模型 guard 直接调用原生 OpenCode，保留完整多行参数；一次启动及总预算约束 |

保留现有 summary 的 `file/signature/owner/behavior/previous_signature`，不增加交付 schema。解析 IR 增加 `receiver: {name,type}` 与 `return_values: [{name,type}]`；原 `parameters` 不混入 receiver，原 `return_type` 保留显示字符串。无返回值不提供 result，单值用 result，多值用 result.item1/item2…；命名返回值不产生别名。Go 使用 `formal_proof: false`，能力不足仍是 UNKNOWN/CAPABILITY_BLOCKED，不能写成 PROVED。

类型与 import 检查范围是 summary 涉及的文件。Go AST 不做类型检查、依赖下载或构建标签选择；真实编译和独立验证仍需执行。仓颉 helper 继续负责既有行为表达式解析。

## 同轮路径与共同配置

`prepare.py` 接收调用方明确给出的 baseline 和已批准需求，不发现 IC store 或读取累计聊天。SDD only 与 IC+SDD 使用同一入口、同一构建命令及同一域资料，各自传入自己的上一轮代码基线和本轮交付。

1. 新目录中建立 `repos/origin` 和 `repos/main`，逐文件核对同一份基线哈希；去掉旧 `.specart`、验证记录、执行标记和会话配置。
2. node3 固定为 `repos/origin`，node7 固定为 `repos/main`。SpecArt inputs 改成 `2,7,4,5`，prompt 中所有项目/源码位置使用 node7。
3. 原 SDD `prepare_workdir` 复用已经存在的 main；不得使用 `--force` 删除后重拷。设计记录绑定的绝对项目路径因此与实现一致。
   node6 保留为规格产物父目录；共同配置中设计与实现的 SPEC 都指向 `${n6_path}/.specart/`。
4. system-design 从 origin 生成基线文档；PRD 检查保留 origin→main 的实际 diff。Go CLI 只替换代码发现规则，模板、稳定编号和增量核验不变。
5. 共同配置只选择 main 路径及 PRD、SD、change、SpecArt、coding、PRD-check 阶段。原 testgen/testfix 是鸿蒙真机路径，当前 runner 本身跳过它们；这里不将其伪装成 Go 测试。Go 项目构建/测试通过显式 `--build-command` 和 SpecArt 原独立验证承担；正式试跑前还需核对实际命令与预算执行情况。

共同预算由 `budget-policy.json` 冻结：coding 最多修复 2 次、PRD 最多修复 1 次，全局最多 3 次，含编译修复。内部 task 与外层 fix 共用账本。保留上游循环及门禁，通过阶段配置和运行适配限制次数/时间；输入、工作流及预算哈希写入 preparation/provenance。

## 状态与再次启动

| 场景 | 行为 |
| --- | --- |
| 新交付准备 | 只接受新 PRD ID，输出 `prepared_not_started`；没有模型会话 |
| 同一次 SDD 运行内 | 原 start-design → accept-design → start-implementation → check/独立验证；实现或证据再次变化后按原规则重新验证 |
| 同一次运行中断后恢复 | 本入口不恢复。仅复用 PRD ID 不会恢复 SDD 内存中的会话 ID、轮数等，不宣称是完整断点恢复 |
| 再次启动开发 | 新 ID、新需求、上一轮本方业务代码作为 baseline；旧运行保留，重新开始本轮设计。不是沿用旧 accepted.json |
| 重复调用准备 | 已存在目录立即失败，不覆盖、不清空、不视为恢复 |

PRD 修复、`.coding-done`、`.verdict.md` 等后续写入可能使先前验证证据失效。正式执行接入还需在所有写入完成后做最终验证；本阶段没有实现最终回传/恢复编排。

## 同步与验收

先运行 `python experiments/sdd/sync.py --target <SDD目录>` 检查，再加 `--apply` 同步。源项目同步测试时加 `--include-tests`；prdcheck 不复制源项目测试。工具只接受记录的原始、已审阅历史版本或目标哈希，避免覆盖后续上游修改。`upstream.patch` 保存第一阶段补丁，[adaptation-fix.patch](adaptation-fix.patch) 保存本次适配修复增量，overlay 为最终文件。

离线验收记录见 [VALIDATION.md](VALIDATION.md)。清单：

- [x] Go 声明、receiver、具名多返回值、跨文件成员和非法返回值引用。
- [x] 新/已有函数的设计保护、实现后检查、签名漂移与函数体越权修改。
- [x] 无证明适配器报告、禁止伪造 PROVED、源码变化导致报告失效。
- [x] origin/main 同源且相互独立、SpecArt 指向 main、PRD diff 路径保留。
- [x] 重复运行 ID、路径越界与覆盖拒绝；同步先全量预检、幂等。
- [x] 使用真实 prdcheck 配置与技能做离线准备，没有调用 runner。
- [ ] 真实模型完成 Go 开发及最终验证：已授权试跑在 coding 失败，未完成全流程；本次耗时在 60 分钟预算内。
- [ ] IC 的 CI 消费者迁移与回传合同：后续实施范围。
- [x] SDD-only dpipe R1 官方脚本评测已执行，结果失败并保留证据。
- [ ] 两组长链路对比：另行运行授权。
