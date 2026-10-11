> 已被 [2026-10-10 恢复记录](2026-10-10-restore-upstream-sdd.md) 取代：final 阶段和预算账本已整体撤回。

# 2026-10-10 SDD 适配门禁修复

## 依据：今天 9 次 R1（`sdd-luna-dpipe-r1-20261010-*`）

| 运行 | 官方 | 内部停点 | 归因 |
|---|---|---|---|
| 042344 / 050556 | 147 / 190 | coding | 早期适配问题 |
| 054420 | 0 | design 修订次数用完 | SDD 正常结果 |
| 062454 / 071134 / 100341 | 217 / 217 / 216 | coding 修复次数用完 | SDD 正常结果（验证器每轮报新缺陷） |
| 075613 | 217 | final-report-check SA230 | **适配**：多余的 final 复验 |
| 085500 | 214 | PRD 阶段 `unknown_delegation_role:general`，exit 124 | **适配**：账本因一次委派结束整个阶段 |
| 112946 | 23 | coding 入口 SA185 | **适配**：specart 未验收却被放行 |

从第 4 次起代码稳定在 214–217/219。另外三次失败不是模型能力问题，原因分别如下。

1. **specart 误放行（112946）**：spec review 子会话在 12:01:37 发出模型请求后再无输出，12:27:08 Root 进程非 0 退出。没有生成 verdict.md 和 accepted.json。上游 `assert_passed` 在没有 verdict 时退化为“产物目录存在即通过”，于是 `specart.state.json` 被写成 passed。
2. **final 复验重掷（075613）**：coding 的验证器 PASS 之后，流程又写入了 `.verdict.md`、`.coding-done` 和 `dpipe.exe`。SpecArt 的 `project_input_hash` 会把这些文件算进去，所以报告被判 SA247 失效，适配器因此开了一次新的验证。离线核对：移开这三个文件后，哈希与报告记录的 `implementation_hash` 一致，说明源码并没有变。新验证器在同一份代码上报了另一个缺陷，整轮判失败。
3. **角色拒绝结束整个阶段（085500）**：prd-fix Root 把代码修复委派给了 `general`。`budget.py` 抛出 BudgetExceeded 并写入 stop_reason，宿主随即 kill 了整个 PRD 阶段。

## 修复（只改适配器，不改 SDD 核心和 validator）

- `run_results.stage_result('design')`：除各阶段 state 外，还要求 `output/06-Spec骨架/verdict.md` 中 specart pass=true；并记录 specart 进程是否非 0 退出。
- `run_r1.execute`：design 通过后运行 SpecArt 原有的只读 `start-implementation` 门禁，非 0 时判 `specart_design_not_accepted`，不进入 coding。
- `run_r1.reusable_verification`：final 阶段先找验证器写下的 report/obligations/proof-results 三件套。只临时移开流程派生文件（`.verdict.md`、`.coding-done`、构建命令 `-o` 的产物及其 `.exe`）的子集，再运行原版 `specart-validate report`；通过就复用，文件随后放回原处。源码有任何其他变化，或者失败原因不是 SA247，都照旧启动新的验证器。
- `budget.py`：未配置的委派角色改为 `RoleDenied`，只拒绝那一次工具调用，不写 stop_reason，也不计数。后台委派和其他超限仍按原来的方式终止阶段。
- `prepare.py`：撤回 coding 提示里的 dpipe 专用条目（`columns:false`、1.005 舍入、pivot index、min/max/coalesce、having:null、`"a\x00b"` 拼接 key、字段矩阵），specart 提示中的“recipe 操作的 JSON 字段”改成“嵌套输入的字段”。

## 离线证据

- `test_gates.py` 新增 12 项，全部通过；适配器套件共 89 项通过。另有 3 项失败修改前就存在，原因是测试机环境：PATH 无 opencode、未设 PYTHONUTF8、未设 MSYS_NO_PATHCONV。
- 用新代码回放真实产物：112946 判 `specart_verdict_missing`，start-implementation 返回 SA185；075613 复用 coding 验证（移开 `.coding-done`、`.verdict.md`、`dpipe.exe`），final 判 pass，回放后文件原样保留。

## 未处理

- 模型请求挂起本身（112946 中 25 分钟无响应）没有重试机制，现在只会被正确地判失败。
- 验证器每轮只报一个新缺陷，导致 2 次修复不收敛。这属于 SDD 内部行为，本次没有改。
