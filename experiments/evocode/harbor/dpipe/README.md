# dpipe 产物与实验入口

2026-10-04 只读核验。当前任务是整理；不运行模型、执行器、官方 verifier，不继续 R5。后续授权与预算须明确，以下脚本/历史计划不构成授权。

## 版本与状态

整理时的代码核验基线为 `main / 751c4d10aceb0597ef52b247d69696db1ae5685c`。当前 HEAD 用 `git rev-parse HEAD` 查看。接手时已有未提交修改：`src/core/intent-compiler-v2.ts`、`src/core/parent-generation.ts`、`test/parent-generation.test.ts`、`test/source-ref-contract.test.ts`。它们增加 quote 诊断和代码派生返修草稿；本轮未修改。两份源码字节与下表 R5-B 冻结副本相同；不能把 dirty 工作区称为纯 HEAD 版本。

| 材料 | 核验状态 | 调用/执行边界 | 精确入口 |
| --- | --- | --- | --- |
| F2 / 原运行 R2 | 历史官方结果 481/481，回传/评估已完成 | c6e1f64 历史实现；2 次真实执行；本准备序列的执行起点 | [断点索引](records/2026-10-02-checkpoint-inventory/INDEX.txt)，使用其中 F2 配套 store 和镜像 |
| 离线 R3 | 接受的 IR、CI、最终 Atom；有既有 session 审阅记录 | 6 次新增管理调用；未执行 | [索引](records/2026-10-02-offline-r3-luna/INDEX.txt)、[报告](records/2026-10-02-offline-r3-luna/REPORT.txt) |
| 离线 R4 | 接受的 IR、CI、最终 Atom；有既有 session 审阅记录 | 3 次新增管理调用；未执行 | [索引](records/2026-10-02-offline-r4-luna/INDEX.txt)、[报告](records/2026-10-02-offline-r4-luna/REPORT.txt) |
| R5-A | 失败，6 份 IR 提案因 quote 被拒，未进入 CI/check | 6/8；剩余额度不足完成必要阶段；纯 HEAD + 实验接线 | [索引](records/2026-10-02-offline-r5-luna/INDEX.txt)、[报告](records/2026-10-02-offline-r5-luna/REPORT.txt) |
| R5-B / quote-repair | 失败，semantic_unresolved；transform 最终 CSV 输出条款仍从最终正文遗漏 | 8/8；HEAD + dirty 补丁；两次模型 consistent，两次 session 审阅拒绝；未执行 | 下方 R5-B 运行目录，`advance-result.json`、`calls/08-session-review.json`、`review/08-prepared-*.rejected-draft.json` |
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
| [offline-management-r3.mjs](offline-management-r3.mjs) + [offline-review-guard.mjs](offline-review-guard.mjs) | 名称含 r3，实际 R3/R4/R5 共用；读取 run.json、冻结 runtime、调用管理模型，独立核对后等待 session 审阅；不是离线无模型测试 |
| [prepare-offline-r3.py](prepare-offline-r3.py)、[r4](prepare-offline-r4.py)、[r5](prepare-offline-r5.py) | 为特定前态复制 store/runtime、设置预算并写启动配置；不是通用恢复命令。要求指定 HEAD 且 src 无 dirty，不能直接用于当前工作区 |
| [prepare.py](prepare.py)、[run-full.ps1](run-full.ps1)、[intent_opencode_agent.py](intent_opencode_agent.py) | 完整 Harbor 实验准备/启动/逐轮宿主接入，会触及执行和官方评测；本轮不调用 |
| [patch-management-stream.py](patch-management-stream.py)、[management-stream-observer.ts](management-stream-observer.ts) | 修改隔离宿主副本、记录管理长流；与 compiler 主体分开 |
| [watch-run.ps1](watch-run.ps1)、[summarize-run.ps1](summarize-run.ps1) | 读取已有运行并汇总；摘要不覆盖原始记录 |

上述新增离线接线仍未提交，本轮保留原样。`records/` 管本地索引及少量封存证据，外部目录保存完整正式产物、首次请求、返修和冻结环境；不为整理把它们复制一遍。源码入口见 [模块地图](../../../../development/README.md)。
