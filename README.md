# Intent Compiler

持续维护大任务的 Intent IR，据此编译整体 Compiled Intent，再准备、绑定并装配执行层使用的最终 Atoms。模型负责语义，代码负责确定性的身份、来源、版本与投影。

下一阶段目标：先逐轮准备和审阅高质量管理产物，再按轮交给执行层连续运行，用原官方 verifier 观察长任务结果；管理质量、生成/审阅成本、执行成绩分别记录。现有实现与实验方案可以重新评估。

## 从这里开始

1. [AGENTS.md](AGENTS.md)：长期规则与授权边界。
2. [dpipe 当前状态](experiments/evocode/harbor/dpipe/README.md)：版本、正式产物、失败草稿、原始证据位置。
3. 按任务选择：**改代码**读 [模块地图](development/README.md) 对应一行；**讨论设计**先读 [当前设计](development/CURRENT-DESIGN.md) 开头，再选对应主题；每个主题分别说明设计要求与当前实现。遇到术语再查 [CONTEXT](CONTEXT.md)。

**2026-10-04 整理轮范围：暂停实验推进。** 没有新的模型、执行器、官方 verifier 或下一轮授权；不自动继续 R5。后续 session 以用户当时授权为准。

## 目录与验证

| 位置 | 用途 |
| --- | --- |
| `src/`、`test/` | 实现与离线测试；v2 是当前主链，v1 仍有导出和消费者 |
| `development/` | 模块地图、当前设计、必要合同夹具和按需历史 |
| `experiments/` | 独立实验接线；dpipe 入口区分准备与执行 |
| `docs/authority/` | 有日期的研究和历史实验协议，不是当前运行授权 |
| `results/`、`.scratch/` | 历史证据及临时材料；不自动作为事实入口，不整目录清空 |

Node 要求和依赖以 [package.json](package.json) 为准。`npm run build` 从源码生成 `dist/`；包导出、`.opencode` 插件和实验 prepare 均依赖它，使用前先构建。`npm run typecheck` 是离线类型检查；`npm test` 会构建并运行完整离线套件，按实际改动选择验证，本次整理未运行它们。

文档职责、清理明细和本轮验证见 [整理记录](development/cleanup-2026-10-04/README.md)。原始运行目录不随工作区清理重写。
