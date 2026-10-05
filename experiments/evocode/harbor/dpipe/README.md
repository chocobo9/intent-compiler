# dpipe 产物与实验入口

2026-10-04 更新：管理产物准备驱动只负责真实模型生成 IR/CI、代码 prepare/绑定/装配及保存结果。独立模型语义核对和 session 审阅从生成流程移出，产物状态记为 `semantic_review: not_performed`。后续审阅单独进行；具体运行轮次与预算按用户授权执行。

## 版本与状态

整理时的代码核验基线为 `main / 751c4d10aceb0597ef52b247d69696db1ae5685c`。当前 HEAD 用 `git rev-parse HEAD` 查看。接手时已有未提交修改：`src/core/intent-compiler-v2.ts`、`src/core/parent-generation.ts`、`test/parent-generation.test.ts`、`test/source-ref-contract.test.ts`。它们增加 quote 诊断和代码派生返修草稿；本轮未修改。两份源码字节与下表 R5-B 冻结副本相同；不能把 dirty 工作区称为纯 HEAD 版本。

| 材料 | 核验状态 | 调用/执行边界 | 精确入口 |
| --- | --- | --- | --- |
| F2 / 原运行 R2 | 历史官方结果 481/481，回传/评估已完成 | c6e1f64 历史实现；2 次真实执行；本准备序列的执行起点 | [断点索引](records/2026-10-02-checkpoint-inventory/INDEX.txt)，使用其中 F2 配套 store 和镜像 |
| 离线 R3 | 接受的 IR、CI、最终 Atom；有既有 session 审阅记录 | 6 次新增管理调用；未执行 | [索引](records/2026-10-02-offline-r3-luna/INDEX.txt)、[报告](records/2026-10-02-offline-r3-luna/REPORT.txt) |
| 离线 R4 | 接受的 IR、CI、最终 Atom；有既有 session 审阅记录 | 3 次新增管理调用；未执行 | [索引](records/2026-10-02-offline-r4-luna/INDEX.txt)、[报告](records/2026-10-02-offline-r4-luna/REPORT.txt) |
| R5-A | 失败，6 份 IR 提案因 quote 被拒，未进入 CI/check | 6/8；剩余额度不足完成必要阶段；纯 HEAD + 实验接线 | [索引](records/2026-10-02-offline-r5-luna/INDEX.txt)、[报告](records/2026-10-02-offline-r5-luna/REPORT.txt) |
| R5-B / quote-repair | 失败，semantic_unresolved；transform 最终 CSV 输出条款仍从最终正文遗漏 | 8/8；HEAD + dirty 补丁；两次模型 consistent，两次 session 审阅拒绝；未执行 | 下方 R5-B 运行目录，`advance-result.json`、`calls/08-session-review.json`、`review/08-prepared-*.rejected-draft.json` |
| R5-C | 代码层 dispatched，模型核对 consistent；**2026-10-04 session 事后审阅拒绝**：transform 最终 CSV 输出条款再次被整句撤回（同 R5-B），verify 未接收 R5 的 BLAKE2b-256 切换句；实现缺陷：revise task 静默丢弃 strict schema 必填的 current_scope（交 Debug）；CI intent_basis 记为旧 t-dpipe@3，当前无代码读取，仅记录。manifest 条目结构已保留 | 3/8；HEAD 6a33462 + 同一组 dirty 补丁，重建 runtime；未执行 | 运行目录 `intent-luna-dpipe-offline-r5-20261004-204408z-a4becf`，`artifacts/{ir,compiled,atoms,status}.json`、`advance-result.json`、`calls/03-session-review.json`（放行标注） |
| R5-D | 失败，invalid_candidate，IR 阶段 7 次全拒，无产物。01–03 卡在 expected_revision：call01 同批对 t-dpipe 先 revise task 再 revise current_scope，反馈"does not match current 4"与提示"用 supplied IR 中的版本"(3) 矛盾，模型 3→4→3 往返；call03 来源全部可解析且含 transform 输出句，只因版本被拒。04–07 模型把 4 个 revise content 的来源写成占位 quote `. . .`，返修草稿原样携带，未恢复 | 7/8 均为 IR；HEAD 6a33462 + dirty（含 revise task/current_scope 修复，未经真实生成验证）；未执行 | 运行目录 `intent-luna-dpipe-offline-r5-20261004-213556z-df0173`，`advance-result.json`、`calls/NN-{transport-result,stage-input}.json` |
| R5-E | 代码层 dispatched，**未经模型核对**（R5-D 起驱动已移除核对步骤，checkRequired=false）；**2026-10-04 session 审阅拒绝**：transform 输出句 R1 s34 第四次被整段撤回（R5-B/C/D/E 均出现）。verify 切换句、manifest、ingest、current_scope 修复均已落地；lineage 的 ingest `file` 映射被记为未决问题，completion 依赖澄清，需用户决定 | 7/8（IR×3、CI、IR×2、CI）；HEAD 6a33462 + 6 dirty；未执行 | 运行目录 `intent-luna-dpipe-offline-r5-20261004-220116z-4dfaf8`，`artifacts/`、`calls/06-transport-result.json`（接纳的 IR） |
| R5-F | 代码层完成，模型核对 consistent（0 findings）；**2026-10-05 session 审阅拒绝**：transform 输出句第六次被整句撤回（IR 提案），核对收到该条撤回清单仍判 consistent；verify 未采纳 R5 BLAKE2b 切换句（同 R5-C）。来源先后标注正确、原文逐字不变、无疑问。另查实"后一次陈述为准"措辞写在 MANAGEMENT_SYSTEM_PROMPT，严格分阶段生成不发送它，未送达模型 | 3/8（IR、CI、核对）；HEAD 6a33462 + 当前全部 dirty；驱动恢复核对（无审阅等待）；未执行 | `management_runs/intent-luna-dpipe-offline-r5-20261005-000103z-96af44`，`artifacts/`、`calls/03-parsed-model-check.json`、`calls/03-stage-input.json` 的 `input.prepared.withdrawals`；同日先建的 `…20261004-235922z-00aa95` 因服务未就绪 5 次 session.create 连不上，无模型请求 |
| R5-G | 失败，semantic_unresolved：8 次调用用尽；独立核对 D7 inconsistent（lineage 的 ingest 取 `file` 还是 `input`）；无 artifacts。**2026-10-05 session 审阅**：D7 按"以输入为准"不成立（R5 已明确映射 `file`），核对请求未带"后一次陈述为准"措辞；5 次 IR 被 quote 拒（verify 句末多空格重复 4 次，同 R5-A）。方案 A 在未接纳装配中生效：被撤回原文按原序号交付；IR 记录层 ingest/manifest 片段撤回边界错误，仅影响跟踪 | 8/8（IR×6、CI、核对）；HEAD 6a33462 + 当前全部 dirty；未执行 | `management_runs/intent-luna-dpipe-offline-r5-20261005-002917z-9a89a4`，`advance-result.json`、`calls/08-parsed-model-check.json`、`calls/08-stage-input.json` 的 `input.prepared`（未接纳的装配结果） |
| R3–R15 预备输入 | 原文、allowlist、预算提案；不是一套已生成成功产物 | 不授予新运行，R6–R15 未在本准备序列生成 | [manifest](records/2026-10-02-prepared-r3-r15/manifest.json)、[PLAN](records/2026-10-02-prepared-r3-r15/PLAN.txt) |

R3/R4 的 `artifacts/status.json` 均为 actually_delivered=false、executor_started=false。两份 R5 正式 store 的 ir/compiled/execution_outcomes 均等于冻结 R4，pending/unresolved 各 1；不能当 R5 成功结果。这里复核身份、文件与状态，未重做全轮语义验收，也不把过去审阅通过当成执行保证。

## 按问题读取原始材料

外部根仅限仓库已引用的 `D:/huawei/EvoCodeBench/management_runs/`。下列名字与相对文件组成真实路径，不从 `.scratch/*current.json` 推断最终状态：

| 代号 | 根目录下的完整运行名 |
| --- | --- |
| R3 | `intent-luna-dpipe-offline-r3-20261002-164739z-5d90df` |
| R4 | `intent-luna-dpipe-offline-r4-20261002-192524z-bf65e1` |
| R5-A | `intent-luna-dpipe-offline-r5-20261002-195137z-50cfc4` |
| R5-B | `intent-luna-dpipe-offline-r5-quote-repair-20261002-202628z-c9f8db` |

- 正式材料：R3/R4 的 `artifacts/{ir,compiled,atoms,status}.json`；原文在 `initial-rN-event.json`、`rN-original.txt` 与 provenance 中的历史前态。必要时读原始 calls，不先展开整个日志。
- 失败：先读 R5-B `advance-result.json`，再对照 `calls/08-session-review.json`、`08-parsed-model-check.json` 和实际 prepared 草稿；`REPORT.txt` 前半是 call03 快照，末尾才是最终收口。没有最终成功 artifacts，也没有最终完整证据包；call03 zip 只是中途快照。
- 成本：各运行 `COST.json` 和 `calls/NN-timing.json`。历史调用、新增调用、模型传输耗时、审阅等待、人工工时分开；宿主 cost=0 不代表免费。session 自身 usage/人工工时未知。
- 当前未决证据：R5-B `calls/04/05/06` 对应 stage-input、transport-result 表明返修后语义 finding 被最新 quote 错误替换，已恢复的 transform add 在模型下一回答又消失。源码 feedback/reject 与这一观察相符；不能据单轨迹断言保留 finding 必然改善结果。
- 历史官方运行和恢复材料：只从断点索引进入 F2 等同点记录；历史 F3–F5 的运行存在，不是这条离线准备序列的执行成绩。不得混合不同 store/镜像/会话。

## 接线与副作用

| 入口 | 用途与边界 |
| --- | --- |
| [offline-management-r3.mjs](offline-management-r3.mjs) + [offline-review-guard.mjs](offline-review-guard.mjs) | 名称含 r3，实际 R3/R4/R5 共用；读取 run.json、冻结 runtime 并真实调用管理模型。复用未配置 checker 的生成路径，保留机械检查和批内返修；保存产物后结束，不等待 session 审阅。guard 当前仅用于调用预算 |
| [prepare-offline-r3.py](prepare-offline-r3.py)、[r4](prepare-offline-r4.py)、[r5](prepare-offline-r5.py) | 为特定前态复制 store/runtime、设置预算并写启动配置；不是通用恢复命令。r5 脚本已改为记录实际 HEAD 与 dirty 并用当前 src 重建 runtime（2026-10-04，R5-C 使用）；r3/r4 仍要求指定 HEAD 且 src 无 dirty |
| [prepare.py](prepare.py)、[run-full.ps1](run-full.ps1)、[intent_opencode_agent.py](intent_opencode_agent.py) | 完整 Harbor 实验准备/启动/逐轮宿主接入，会触及执行和官方评测；本轮不调用 |
| [patch-management-stream.py](patch-management-stream.py)、[management-stream-observer.ts](management-stream-observer.ts) | 修改隔离宿主副本、记录管理长流；与 compiler 主体分开 |
| [watch-run.ps1](watch-run.ps1)、[summarize-run.ps1](summarize-run.ps1) | 读取已有运行并汇总；摘要不覆盖原始记录 |

上述实验接线仍未提交。此次生成流程调整用于以后从仓库准备的新运行包；已有冻结运行保留原驱动和原始核对记录。`records/` 管本地索引及少量封存证据，外部目录保存完整正式产物、首次请求、返修和冻结环境。源码入口见 [模块地图](../../../../development/README.md)。
