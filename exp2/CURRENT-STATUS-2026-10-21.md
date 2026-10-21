# 实验 2 现状总览（2026-10-21 晚，交接用）

读这一份就能接上工作。细节都在下面列出的文件里。分支：`exp2-pure-ic`（设计与文档，本地 worktree 是 `D:/huawei/intent_compiler/project-exp2`）；`exp2-block1`（云端写的代码）。

## 1. 用户定下的方向与准则（长期有效）

**比较什么**
- 实验 2 比的是**长任务稳定性**，一共三组：
  - SDD 单独执行：冻结，luna high，R15 883，不重跑；
  - 裸模型；
  - IC。
- 前几轮领先多少不重要。
- **主比较是同一个模型下的 IC 对裸模型**，模型用 `gpt-5.6-luna-fast` medium（降级模型，留有缺口）。`gpt-6-luna-fast` high 和 medium 的裸模型作为参照。
- 上头只看成功率和 token。分数低不等于坏，分数高就必须大幅胜出。

**设计原则**
- 原文是唯一权威，新原文优先于旧原文。
- 确定性的事交给代码，需要理解的事交给模型。
- 不加"看到 X 就怎样"的规则，不针对某一个现象打补丁。
- 一处不过不能让整批作废。
- 模型负责理解语义，不负责抄写原文：需要引用原文时给编号，由代码去核对。
- luna 在 OpenCode 里遵循指令的能力弱，而且倾向于"做到最少"：
  - 给它的任务要拆小，并写成填表的形式；
  - schema 的每个字段都要写清说明；
  - 完整度由代码度量，不靠它自觉。
- 可以多模型分工，和 SDD 的 SpecArt 一样：独立的验收子 agent 可以用更强、不同来源的模型。

**交给云端时**
- **只写现象、要达到的效果和验收标准，不写修法**，避免局部修补；修法由开发统筹设计，并在 NOTES 里说明每处修改回应了哪个观察。
- 发消息的方式：我用 SendMessage 发给 "exp2 block 1: original split, objects, change log"，云端回不了消息，由用户把它的结果转贴过来。

**分析方法**
- 用 expert-lens skill（`~/.claude/skills/expert-lens/SKILL.md`）。核心是四问：专家会做什么、原始材料在哪里、用什么方法、还有什么能独立证明对错。要的是更深，不是更大。
- 先检查度量工具本身是否可靠。例如官方用例的编号每轮会重排，跨轮跟踪要按（意图、场景）对齐。

**其他约定**
- Haiku 用 medium 推理等级，暴露短板。
- 不要把新的设计弱化回旧版 IC+SDD 的 prd-check/fix（`acceptance_repair.py`：只检查名称、错误路径和示例）。

## 2. 关键数据（全部在 `exp2/*.md` 里）

| 结论 | 出处 |
|---|---|
| 裸 luna high 诊断分 R15 958/960；从 R5 起官方分为 0，原因是引入外部库、评分环境不能联网 | OBSERVATIONS §2、§9 |
| 5.6 medium 裸模型 15 轮：官方分 R5 起为 0；诊断分 947；新增的错一直不修；真正的退化只有 1 次 | OBSERVATIONS §9（跨轮按稳定键跟踪） |
| R1 重复：luna high 裸模型 219、218、218、218、191；5.6 medium 201、208、219；6 medium 91、84、122（每次都做到一半就停，自己承认） | ANALYSIS-MEDIUM-AND-ACCEPTANCE §1–3 |
| IC 第一轮（v3e21ed0，luna high）215：检查整批作废，零验证；分步协议成本高 4–9 倍 | OBSERVATIONS §4 |
| 反事实：IC 工单本身不拖后腿；协议拖后腿 | OBSERVATIONS §2.2 |
| 事先算好期望值的检查：22 处缺陷只发现 10 处；差分测试发现的完全相同，上限取决于输入覆盖 | DETECTION-STUDY-R1 |
| 实验 1：探针 + 判断；决定发现率的是写探针的模型；判断要有"原文歧义"这一结论 | JUDGE-STUDY-R1 |
| 实验 2：拿纠错单修复，191/208/215 → 218；改坏的都来自同一个歧义条目；sort 因探针数据没有区分力而漏掉 | REPAIR-STUDY-R1 |
| 探针模型对比：sol low 13/19 命中，满分产物上 0 误报，token 最少；短板是规则里的边界分句（log(0)）和数据区分力 | PROBE-MODELS-R1 |

## 3. 已定的设计与进行中的工作

- **第 9 块**（exp2-block1 a1567fa）：已验收。
  - 归属可以收敛，5.6 的录音 R8 已能通过；
  - 检查逐条入库，依据改为编号；
  - 执行方一个会话完成，事后检查并修补；
  - 无人值守的基础设施问题已处理。
  - 剩余问题：错误的 pipeline_fail 检查，要等执行方提出异议才会撤掉。
- **第 10 块（回修）**：已在 2026-10-21 发给云端，**正在等结果**。
  - 正文：`exp2/REPAIR-BLOCK-2026-10-21.md` §1–4；DESIGN §12f 指向它；
  - 分工：写探针用 sol-fast low，判断用 luna 5.6 medium（独立会话），修复用执行方的模型，官方测试只作留出度量；
  - 事先算好期望值的检查不再是主要手段；
  - 验收：离线检出 ≥13/19，满分产物上不出纠错条目；离线修复 3 份 ≥218，不改坏任何用例；之后真实运行 R1 ×3 和 15 轮，对比同模型的裸模型。
- **后续，不在第 10 块里**（REPAIR-BLOCK §5）：
  - 边界分句的覆盖；
  - 区分力用变异度量；
  - 把判断换成不同来源的模型，检验同源误读。

## 4. 云端交回第 10 块之后

1. 拉取 exp2-block1，在 Windows 上跑测试。智能应用控制拦截新编译的 exe 会导致一部分测试失败，那是环境问题，以 Linux 结果为准。
2. 跑离线验收，产物都在本地（见第 5 节）。
3. 真实运行：先 R1 ×3，再 15 轮。
   - OpenCode 配置里要给 `gpt-5.6-luna-fast` 和 `gpt-6-sol-fast` 设置 promptCacheKey；
   - 要设置 `permission.external_directory: deny`、`GIT_PAGER=cat`；
   - 计分沿用 score.mjs；诊断计分用 score-diag.mjs，会挂载主机的 Go 模块缓存。
4. 统计用 `exp2/tools/paired_mcnemar.py`（逐题配对）和 `case_tracking.py`（跨轮按稳定键跟踪）。

## 5. 本地资源

**运行目录**：`D:/huawei/EvoCodeBench/harbor_runs/`

| 目录 | 内容 |
|---|---|
| `exp2-ic-luna-dpipe-20261021-c83d99b7` | IC 第一轮。管理服务端口 45961（所有判断调用也走它）；编码服务端口 45962；`bin/run.mjs`、`score.mjs` 等脚本 |
| `exp2-bare-luna-dpipe-20261021-b8b33675` | 裸 luna high 15 轮。服务端口 45963 |
| `exp2-bare15b-luna56-medium-dpipe-20261021` | 5.6 medium 裸模型 15 轮（基线）。端口 45966 |
| `exp2-shell-*` | 最小外壳。端口 45965 |
| `exp2-cf-*` | 反事实。端口 45964 |
| `exp2-bare-r1*`、`exp2-single-*` | 各种重复运行 |
| `exp2-rec-luna56-medium-attr-20261021` | 归属录音 |
| `exp2-repair-20261021` | 实验 2 |

**其他**
- OpenCode 服务：每个运行目录下 `bin/start-server*.ps1`。数据库：`~/.local/share/opencode/opencode-local.db`。按会话汇总 token 用 scratchpad 的 `sess_tokens.py`，因为一次回复只带最后一条消息的 token。
- 原型：`exp2/prototypes/judge`、`exp2/prototypes/repair`。scratchpad `b5/` 是 exp2-block1 的 LF 克隆，里面有 hk2/（Haiku 录音、检出测试、judge 目录）。
- 检出测试集：16 份 R1 产物的源码树在 scratchpad `b5/hk2/detect/trees`，官方结果在各运行目录的 `official/`。
- 一个裸模型 15 轮基线停在半路：`exp2-bare15-luna56-medium-dpipe-20261021`，有 STOPPED.txt，已作废。
