# 设计会话交接（2026-10-23 中午）

下一个设计会话从这里接手。先读本文，再读 CURRENT-STATUS-2026-10-22.md 开头的"2026-10-23 收敛"和 DESIGN §12i。

## 1. 现在在哪

- **方向已定**（用户确认）：IC 的完整流程加同一个带工具的审查员，对上"裸模型 + 目标环境试跑 + 审查员"的对照组。验收的定位见 DESIGN §12i：验证是会累积的资产（审查员发现、代码核实、修好的变成守卫、改坏守卫就回退）。dpipe 上准确率已无空间，比的是成本和稳定；预先登记的判定在 §12i 末尾。
- **模型统一** gpt-5.6-luna-fast：主比较执行方 low，审查员、formalizer 和其余管理角色 medium。对照组同设置的 4 次数据在 OBSERVATIONS §17：L（执行 low）R15 950、951；M（执行 medium）960、953。
- **代码**：exp2-block1 @ 29158c1 = 验收重构块 f0e0079（按 §12i 实现，说明在 exp2/BLOCK-ACCEPT-NOTES.md）+ 设计会话的三处本地机械修复 + 真实回复 fixture（exp2/evidence/real-replies-2026-10-23/）。
- **下一轮开发**：已把提示词交给用户，发给新的云端开发会话（Opus high）。提示词由 Fable 起草，第一批为保住分数（失败即开放、作废改软信号、前提核验两档、真实回复回归、与对照组逐字一致、formalizer 编号语法），第二批为成本（确认缺陷不过期、库检查按单位只写一次、墙钟、报告字段）。

## 2. 今天学到的、下一轮必须守住的

- **连续出现"一点小改动造成大范围影响"**：真实 R1 四次里，三次被接口处的小问题整轮吞掉（删除目录 EPERM 中断；formalizer 编号格式不对，14/14 条被丢；审查员用 PowerShell 和另一个程序名运行，被判"没运行过"而作废）。Fable 的诊断：模型输出进入代码判定的每个接口，默认都是"不认识就作废或丢弃"（fail-closed），而接口格式只被替身测过，替身太听话。结果本该挡误报的一层，自己一失灵就比对照组还差。
- **因此下一轮设计会话的主要任务**（用户原话大意）：协助把结构性问题和实现时的小毛病一起修好，让开发会话能稳定开发交付。具体建议：
  1. 每个"模型输出 → 代码判定"的接口，都要有用真实回复做的回归测试，失灵时退回对照组的做法并告警，不能静默吞掉发现。
  2. 每块开发交付后，先在本地用真实模型跑一个 R1 的冒烟，再做更大的实验；冒烟出问题时，先判断是"接口/环境"还是"设计"，只在出问题的那个函数里修。
  3. 本地是 Windows/PowerShell：无扩展名的 `dpipe` 在主机上会弹"打开方式"对话框而不执行；目录可能被进程占用；审查员会自己起程序名、用 `&` 调用。
- **修复的原则**（用户定）：只修出问题的那一小块，确认它不影响其他内容，才可以修；修完写 VOID.txt 说明作废原因，重开新目录跑。
- **拆环节只用来诊断**：分析问题时始终看整条链，只改错得多、并且确实造成失分或耗掉周期的环节，按批改，不看到一处改一处。

## 3. 正在进行的

- **真实 R1 第 4 次（已完成，12:14）**：`D:/huawei/EvoCodeBench/harbor_runs/exp2-icacc-r1-luna56-low-rep1d-20261023/`。
  - 首次交付 107/219 → 最终 142/219（+35），流程第一次完整跑通：2 次审查都有效，1 次修补，守卫 9 个，无回退。
  - 审查员共报 17 条，只送修 1 条：**16 条被挡下，原因全是 `no_input`**（formalizer 没能重建输入）。这又是一个"认不出就丢"的接口，下一轮提示词的 A1（失败即开放）正好覆盖它。
  - 墙钟 1029 秒（约 17 分钟）：审查 528 秒、formalizer 78 秒、写库检查 150 秒串行在编码前。对照组 L 的 R1 约 15 分钟、64.4%/90.4%。
  - 服务端口 45985/45986 仍开着（pid 在 logs/*.pid），用完可停。
- 前三次（rep1、rep1b、rep1c）都有 VOID.txt，写明作废原因。

## 4. 资源

- 工作树：
  - exp2-pure-ic：D:/huawei/intent_compiler/project-exp2；
  - 验收块（含本地修复，已推送为 29158c1）：C:/Users/HUAWEI~1/AppData/Local/Temp/claude/D--huawei-intent-compiler/647d00bf-e7d0-408f-ab87-9614397038dd/scratchpad/bacc。
- Go：D:/huawei/intent_compiler/project/.scratch/sdd-phase1/go/bin；跑真实运行前把它和 Python 放进 PATH，设 MSYS_NO_PATHCONV=1、GIT_PAGER=cat。
- 第 12 块的离线回放和核实：D:/huawei/EvoCodeBench/harbor_runs/exp2-b12-accept-20261022/（VERIFY、MIDDLE-LAYER-CHECK 已复制进 exp2/evidence/）。
- 对照组脚本（不在 git 里）：D:/huawei/EvoCodeBench/harbor_runs/exp2-review-template/bin/review.mjs。
- 其他文档：ACCEPTANCE-REVIEW-2026-10-22.md、EXPERIMENTS-STATUS-2026-10-22.md（部分待办已被 §12i 取代）、DEEPSEEK-KV-CACHE-RESEARCH-2026-10-22.md（缓存，未决）。

## 5. 未决

- token 口径：§12i 的判定暂用"未缓存 + 0.1×缓存读 + 输出"，等用户最终确认。
- 第 13 块（改动分类的粒度、当前有效视图、按关系挑原文）：排在验收稳定之后。依据见 evidence/MIDDLE-LAYER-CHECK：改动分类 11 处对 3 处，主因是修改目标划得太粗。
- 缓存：DeepSeek 调研已完成，结论是工具、schema、档位都属于前缀，要"同一轮内固定开头、后面追加"；具体怎么用在本轮包上，未决。
