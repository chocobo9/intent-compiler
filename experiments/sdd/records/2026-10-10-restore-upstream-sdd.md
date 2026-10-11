# 2026-10-10 适配器恢复为 SDD 原流程

目标：用传统 SDD 流程（`D:\sdd\prdcheck`）运行通用 Go CLI 任务（当前为 dpipe）。SDD 原有机制全部保留，只关闭针对原仓颉/鸿蒙仓库的检测和产物。本记录取代同日的 [门禁修复记录](2026-10-10-sdd-gate-fixes.md)：那次修的 final 复验复用和角色拒绝，随 final 阶段和预算账本一起移除了。

## 现在的运行方式

`run_r1.py --launch <run>` 调用一次上游 `speclang-flow.sh`，参数为 `--paths main --jobs 1`，跑完整主路径。跑完后读取各阶段记录，再用官方测试评测最终代码。不再拆成 design/coding/prd 三次调用，也没有 final 阶段、预算账本、续跑或诊断。

## 保留的适配（每项的理由）

| 适配 | 理由 |
|---|---|
| validator Go 支持（overlay，已同步到 `D:\sdd`） | 原版只支持仓颉和 ArkTS |
| Go 表达式 helper 替代仓颉 helper | 行为规约里的 `@ensures` 是 Go 表达式 |
| `generate-go-cli-system-design` | 原 SD skill 只识别鸿蒙工程 |
| `toolchain.build_command` 设为任务指定的构建命令，关闭 auto_discover | 原版自动探测鸿蒙/Hvigor 工具链 |
| 只运行 main 路径的 6 个 stage | testgen/testfix 是鸿蒙真机测试（该版本脚本本来就跳过），cmp1–3 是对比路径 |
| SpecArt 写入 `repos/main` 而非 origin；main 由 prepare 预先从同一基线建好 | SpecArt 把设计记录绑定到 `specart.yaml` 的 `project_root`。在 origin 设计、再复制到 main 实现，`start-implementation` 和验证器检查的会一直是 origin，函数体永远是空的 |
| SpecArt/coding 提示中的 `SPEC = ${n6_path}/.specart/` | validator 命令需要的是 `.specart` 目录本身 |
| 提示末尾追加：构建命令（specart/coding/prd-fix）、无人值守读取 `ADAPTER-CONTEXT.md`、Windows/Go 1.22 运行环境、change 阶段的模板目录 | 都是环境事实，不改变阶段职责 |
| `ADAPTER-CONTEXT.md` 只保留：无人值守下自行做合理假设并记录、目标是 Go CLI（鸿蒙章节不适用）、不读其他运行和官方测试 | 无人可问，原流程需要这项授权 |
| 子 agent 定义 | 采用上游 `.claude/agents/*.md` 原文，只把 skill 路径改为绝对路径 |
| 模型守卫 | 只校验每次 `opencode run` 使用冻结的模型和 variant |

## 撤回的改动

- 预算账本和插件：coding 修复 2 次、PRD 1 次、设计修订 5 次、委派角色拦截。轮数恢复为上游的编译 5 轮、PRD Check/Fix 5 轮，SpecArt 内部修复不设限。
- final-verification 阶段（上游没有这一步）。
- specart/coding/prd/change/prd-fix 的 stage_notes：覆盖盘点、SPEC_GAP 成组修订、@ensures 写法、实现约束、prd-fix 委派规定等。
- coding 提示中“允许维护 `.specart` 生命周期记录”的替换，恢复为上游原文“不修改 node7 以外的文件”。
- `ADAPTER-CONTEXT.md` 中的审查员指导、阶段职责、完整性审查和计数说明。
- SA180 诊断、design/document 续跑、文档分段续写、`[SDD_ROLE]` 标记、PRD 报告源码绑定检查。
- 撤回的模块和测试移到 [retired/budget-and-recovery](../retired/budget-and-recovery)。今天改动前的全部文件快照在 [retired/2026-10-10-pre-restore](../retired/2026-10-10-pre-restore)。恢复方法：把对应文件拷回本目录。

## 结果判定（只读，不改变流程）

- design：prd/sd/change/specart 的 state 都为 passed，且 `output/06-Spec骨架/verdict.md` 中 specart pass=true，且 `repos/main/.specart-verify/*/accepted.json` 存在。上游在缺少 verdict 时会按“产物目录存在”记为 passed；这里把这种情况如实标为 `specart_verdict_missing` 或 `specart_design_not_accepted`，流程本身照常继续。
- coding：`main-coding` state，`.coding-done`，`.verdict.md` 中 coding pass=true。
- prd：`main-prdcheck` state，`08-验证结果.md` 的 verdict（unresolved=0、blocked=0），`result-prdcheck.tsv` 为 PASS。
- `sdd_status=pass` 需要上游脚本退出码为 0，且以上三项都通过。15 轮串行器的晋级门禁为 design/coding/prd。

## 验证

- 离线测试：适配器测试 50 项全部通过，按新契约重写了 prepare/runner/result 相关测试。
- 冻结了一个未启动的运行：`D:\huawei\EvoCodeBench\harbor_runs\sdd-luna-dpipe-r1-20261010-140810z-6bce928b`（`opencode debug config` 通过，无插件）。
- 在它的副本 `project/.scratch/sdd-dryrun-20261010` 上用上游 `--dry-run` 走完 5 个波次和 PRD 5 轮循环，退出码 0。
- 尚未运行真实模型。

## 已知影响

- `ic_bridge.py`（IC+SDD 实验）仍按 `budget-policy.json` 的摘要固定配置；该文件已撤回，恢复 IC+SDD 实验时需要改为固定新的配置。
- 撤回文档续写之后，如果模型输出被截断导致 PRD/SD/change 文档不完整，会按上游规则直接失败。

## 首次真实运行：`sdd-luna-dpipe-r1-20261010-140810z-6bce928b`（3506 秒）

- 上游脚本退出码 0。design 通过（specart verdict 为 pass，有 accepted.json）；coding 通过（独立 Verifier PASS，编译和测试通过）。
- PRD Check/Fix：第 1 轮 7 项 MISMATCH；第 2 轮剩 1 项；第 3 轮仍是 1 项。上游的收敛判断只比较 `unresolved:blocked:manual_review` 三个计数，连续两轮都是 `1:0:0`，于是判为不可收敛，结果 NEED_MANUAL_DECISION。实际上这两轮报的是 GAP-004 下两个不同的新问题：第 2 轮是步骤级 `seed: null` 被接受，第 3 轮是顶层必填 seed 缺失也能成功。上一轮的问题都已修好。
- 官方测试 217/219。
- 适配器的结果读取有一个 bug：prd-fix 会改写 `.verdict.md`，导致 coding 被误标为 missing_verdict。已改为优先读取上游备份 `repos/main.bak/.verdict.md`。重读后：design pass，coding pass，prd 未通过。原 completion.json 保持不动。

## 晋级规则与 15 轮串行（用户 2026-10-10 选定）

上游 PRD Check/Fix 以 `NEED_MANUAL_DECISION` 结束（交给人工）时，串行器按一条事先固定的无人值守规则代替人工：保留当前代码，进入下一轮。

前提条件：design 和 coding 真实通过；上游脚本退出码为 0；官方评测时用任务指定命令构建成功；进程和容器都已确认清理。design、coding 或构建失败照旧阻断，不放行。

每一轮记录 `promotion.mode`（`sdd_pass` 或 `auto_manual_decision`），以及最后一轮检查中仍未解决的 GAP 和报告路径。`series-report.md` 中分列显示。

- R1 采纳上面那次独立运行，用当前版本的结果读取重新读了一遍：自动决定放行，遗留 `GAP-004 F-PIPE-001`（顶层必填 seed 缺失时仍能成功）。
- 串行目录：`D:/huawei/EvoCodeBench/harbor_runs/sdd-luna-dpipe-15round-20261010-155020z-6e10062e`，R2 于 2026-10-10 15:50 UTC 开始。
- 首次启动时串行打包漏了 `*.go`（Go 表达式 helper 源码），R2 在冻结阶段失败，没有调用模型；已修正打包规则，并删除了那次空的串行和 R2 目录。

## R2 阻断与续跑（环境问题，不是 SDD 逻辑）

- 现象：R2（`sdd-luna-dpipe-r2-20261010-155026z-13aea79e`）design 和 coding 都已通过。进入 PRD 阶段时，上游 `backup_coding_artifact` 执行 `cp -r main main.bak`，报 `cannot create regular file .../main.bak/dpipe: File exists`，波次失败，流程以退出码 1 结束。官方测试 464/481。
- 原因：模型在 Windows 上编译出 `dpipe.exe`，脚本的编译检查在 Docker 里生成 Linux 版 `dpipe`，两个文件同时存在。Git Bash（MSYS）把 `NAME` 和 `NAME.exe` 视为同一个文件。已离线复现。上游脚本按 Linux/macOS 编写，在那里这是两个文件。
- 修复：`posix_cp.sh` 通过 `BASH_ENV` 在上游脚本启动前定义 `cp` 函数。只有 `cp -r 目录 新目标` 这一种情况改用 Python `shutil.copytree`，其余照常调用系统 cp。Git Bash 会把 `/usr/bin` 放在 PATH 最前面，所以不能用 PATH shim。新冻结的运行通过 `environment.json` 中的 `BASH_ENV`、`SDD_POSIX_CP_PYTHON` 启用；上游脚本不变。
- 续跑：`run_r1.py --resume <trial>` 只允许在上游流程失败退出、进程已确认清理时使用一次。旧的 completion、官方评测和不完整的 `main.bak` 移到 `attempt-1/`，记录写入 `resume.json`（含新增的环境项和文件摘要）。然后再调用一次上游脚本，依靠它自带的“已通过且产物存在的阶段跳过”只执行未完成的阶段，最后重新做官方评测。
- 串行续接：`run_series.py --continue-from` 现在会用当前版本的结果读取重新读取每个继承轮次的门禁，并重新计算晋级记录。R2 续跑后，新串行从被阻断的那条串行接续。
- R2 续跑结果：上游自带的续跑跳过了已通过的阶段，只执行了 PRD Check/Fix，退出码 0，design/coding/prd 全部通过（SDD 完整通过）。随后的官方评测因为第一次尝试留下的同名容器（运行器原来没有加 `--rm`）冲突，没有执行（docker 125）。已为官方评测加上 `--rm`，并抽出 `official_phase`；新增 `run_r1.py --rescore`，只在官方评测从未产生构建结果时重新评测一次，不碰开发记录，旧容器改名保留为 `-attempt1`。R2 重评结果 467/481。
- 新串行：`D:/huawei/EvoCodeBench/harbor_runs/sdd-luna-dpipe-15round-20261010-172025z-8c811e09`，继承 R1（自动决定放行）和 R2（SDD 完整通过），R3 于 17:20 UTC 开始。原串行 `155020z-6e10062e` 停在 runner_blocked，保留不动。

## R3 阻断与重跑

- R3（`sdd-luna-dpipe-r3-20261010-172036z-e24cca4b`）在变更说明书阶段自判 FAIL。原因：Go CLI 版 SD skill 生成外部接口表时自创了表头（“编号｜命令｜输入｜…”），和模板表头（“编号｜名称｜提供方｜调用方｜…｜协议｜精确定义…”）不一致，变更阶段无法逐行比对。模板列名面向网络服务，适配资料没有说明 CLI 怎么填。官方 469/535。
- 修复：`skills/generate-go-cli-system-design/references/go-cli-code-analysis.md` 增加“逐字沿用模板表头和列序”，并给出 CLI 在外部 API 目录各列的填法。
- SD 产物已按错误表头生成并记为 passed，续跑会跳过它，所以 R3 需要重新跑。`run_series.py --retry-last <原因>` 会把父串行最后一轮未通过的尝试记入 `superseded_attempts`（保留证据），从同一基线重跑这一轮。
- 新串行：`sdd-luna-dpipe-15round-20261010-173448z-4bcf08cf`（R1、R2 继承，R3 于 17:35 UTC 重新开始）。旧串行 `172025z-8c811e09` 保留。
