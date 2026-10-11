# 第一阶段离线验收

## 当前运行适配验收（2026-10-08）

最新共同运行适配共 42 个用例通过：整套 41 passed，随后新增原生文档续做测试所在套件 3 passed（其中 2 项已有）。覆盖文档失败同 session 续做与总上限、设计失败阻止下一轮、辅助角色路由、外置 SPEC 写边界、原始交付构建命令及此前预算/进程/结果链路。本机 OpenCode hook 仅连接本地模拟服务。新版真实模型实跑已启动，尚在 R1，详见 [全链路审计记录](records/2026-10-08-full-chain-adapter-audit.md)。此前容器合成多包构建证据见 [实施记录](records/2026-10-08-bounded-runtime-implementation.md)。以下保留历史 validator 验收记录。

日期：2026-10-08。分支：`integration/sdd`，实施基点 `ccf37ecb946d4214c96fed9bcac96ea0b0eb0189`。没有提交或覆盖既有 dpipe 修改。

## R1 后适配修复验收（2026-10-08）

第二次试跑暴露阶段越界及 Go 合并参数匹配问题后，用户要求直接修复。已停止运行 `sdd-luna-dpipe-r1-20261008-183929z-875153d4`，原产物与会话保留，状态为 `aborted.json`，没有官方评测结果。

本次进一步修复：共同提示词按阶段划分职责，变更说明遵循原技能从 PRD 更新目标设计文档的流程，撤掉提前刷新实现证据及全阶段实施授权；Go AST 规范化函数参数和命名返回值的分组写法，summary 与源码均通过同一解析入口匹配。未改变验收记录或放宽行为契约检查。

最新验收：SDD 五组回归 **97 passed / 126.07 秒**；共同配置、同步与启动测试 **15 passed / 0.64 秒**。新增测试实际调用 `start-implementation → check → obligations`，验证分组合并及后续实现修复可通过且 accepted 记录字节不变；类型和行为契约变化仍拒绝。真实 prdcheck 配置离线准备也通过。增量补丁见 [stage-signature-fix.patch](stage-signature-fix.patch)。当前共 **112 项通过**；这些是离线结果。

用户授权修复后，在融合分支完成依赖边语义、Windows 参数传输、工具链冻结及共同 SPEC 路径修复。该节为当前适配验收；下方第一阶段结果保留为历史记录。

| 检查 | 结果 |
| --- | --- |
| Go 适配及旧源码设计、fallback、验证新鲜度五组回归 | **95 passed**，125.59 秒 |
| `test_prepare.py`、`test_sync.py`、`test_run_r1.py` | **14 passed**，2.90 秒 |
| 空设计 → 新增标准库及 go.mod → 真实 Go 构建 → check 与修复前检查 | PASS；新增内部包依赖仍返回 SA187 |
| Bash → Python model guard → 原生参数回显程序 | PASS；多行中文、引号、特殊字符和末尾内容逐字一致；错误/重复模型参数在调用目标前拒绝 |
| 注入冲突宿主模型、工具链和构建设置 | 冻结配置覆盖宿主值；缺少必需冻结字段时报错 |
| 真实 prdcheck workflow/skills 离线准备 | PASS，停留在 prepared_not_started；设计和实现 SPEC 同为 node6/.specart |
| 原生 OpenCode 定位及版本探针 | PASS，1.18.31；仅执行 --version |
| 源目录、prdcheck 同步后哈希检查 | 两处均 changed_files=0 |

测试命令沿用下方 SDD 五组回归命令；IC 命令增加 `experiments/sdd/test_run_r1.py`。所有输入均为合成离线用例，参数回显目标是本地编译的 Go 小程序。

依赖保护现在使用项目相对目录作为包身份，go.mod 用于解析内部 import；标准库及第三方包不进入内部包保护。缺少模块信息或未支持的 replace 映射保留 unresolved，不能作为完整图的证明。审阅增量见 [adaptation-fix.patch](adaptation-fix.patch)，同步清单保留原始及已审阅版本哈希。

本次没有启动新的模型工作流或官方评测；R1 的历史失败结果保持在 [运行记录](records/2026-10-08-r1-result.json)。

## 结果

| 检查 | 实际结果 |
| --- | --- |
| 源项目 `test_go_adapter.py`、`test_source_skeleton.py`、`test_design_self_check.py`、`test_fallback.py`、`test_verification_freshness.py` | **92 passed**，120.16 秒；含 13 项新增 Go 测试和 79 项旧测试 |
| IC `experiments/sdd/test_prepare.py`、`test_sync.py` | **6 passed**，0.21 秒 |
| 使用 prdcheck 实际 workflow.json 和 skills，在临时目录准备新运行 | PASS；检查固定 main 路径、Go helper 随技能分发、Go 系统设计入口/模板引用；未调用 runner |
| `sync.py --target D:/sdd/sdd-loop-skeleton --include-tests` | 目标哈希全部一致，待同步 0 |
| `sync.py --target D:/sdd/prdcheck` | 目标哈希全部一致，待同步 0 |
| Go helper | 由真实 Go 工具链编译，pytest 经其解析源码，不使用伪造 AST |

初次旧回归为 78 passed、1 failed，失败是形式证明用例需要 Z3 而本机当时缺少求解器。为本次离线验证安装独立 Z3 后，该用例通过；最终整组 92 项通过。未修改原测试、求解器协议或证明引擎来消除失败。

## 复现环境

- Python 3.12，pytest 9.1.1；pytest 及依赖放在 IC `.scratch/sdd-phase1-deps`。
- Go `go1.27.2.windows-amd64.zip`，官方包 SHA256：`1314008898bd40df77af4b014f777f08873dbdfbcd3d92308728ee03304fe04f`；位于 `.scratch/sdd-phase1/go`，下载后核对哈希。
- Z3 的 `z3-solver==5.1.0.0` 放在 `.scratch/sdd-z3`，通过 `SPECART_Z3` 指定其 bin/z3.exe。
- ArkTS 的既有 node/package-lock.json 经 `npm ci --ignore-scripts --no-audit --no-fund` 安装原锁定依赖。
- Windows 仓颉 helper 的默认二进制有既有启动问题。本次通过 `SPECART_AST_HELPER` 指向既有可运行隔离副本：`D:/sdd/prdcheck/workflow/runs/a-hma-standard-calc-20260928-01a0e921/diagnostics/runtime-probe/runtime-copy-probe/specart_ast_helper.exe`。只调用解析程序，没有修改历史目录或执行历史实验脚本。正式环境仍需提供可运行 helper。

在 SDD 源项目目录设置 `PYTHONPATH`、`SPECART_GO`、`SPECART_AST_HELPER`、`SPECART_Z3`、`PYTHONUTF8=1` 后运行：

```text
python -m pytest -q -c tests/specart-validator/pyproject.toml tests/specart-validator/test_go_adapter.py tests/specart-validator/test_source_skeleton.py tests/specart-validator/test_design_self_check.py tests/specart-validator/test_fallback.py tests/specart-validator/test_verification_freshness.py
```

在 IC project 目录运行：

```text
python -m pytest -q experiments/sdd/test_prepare.py experiments/sdd/test_sync.py
```

测试使用临时项目与合成需求，没有读取官方测试答案。报告测试仅验证结构、证据绑定和能力边界；未使用模型充当独立 Verifier。

## 未执行

没有调用真实模型、SDD 开发工作流或 dpipe 官方 verifier；未测真实模型 Go 规约质量、最终轮后回传、断点恢复、长链路成绩或成本。共同准备生成的目录停留在 `prepared_not_started`。下一阶段运行前需明确运行预算、构建命令，并解决最后一次修复及标记写入后的最终验证安排。
