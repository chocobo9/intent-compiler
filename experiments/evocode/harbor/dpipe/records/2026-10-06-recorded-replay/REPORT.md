# 录下回答的离线重放：R3–R15（2026-10-06）

**定位。** 把真实模型当年写的管理回答，按轮喂给当前代码（HEAD 的 dist），看新代码能否接住，以及确定性装配（来源账、撤回排序、交付投影）有没有变化。它是"新代码对真实输入"的回归测试，测不到新请求下模型会怎么写，不是真实运行前的准入门槛。执行回报对应的是当年的交付正文，所以回传批的重放检验机制，不检验语义。

**怎么跑。** `npm run replay:recorded`（先构建 dist，再运行 [replay-recorded.mjs](../../replay-recorded.mjs)）。录下的数据留在 EvoCodeBench 目录，不进仓库；找不到时命令直接跳过。不并入 `npm test`。不调用模型、执行层或 verifier。所有 store 先复制到临时目录再重放，原断点、management_runs 和运行目录都不改。

- `--then-path`：只喂当年被接受的回答，用于新代码提前接受某个回答、状态与当年分叉的轮次，沿当年实际走过的路径比较交付正文。它不会接受新代码拒绝的回答。
- 逐轮对照表：[rounds.json](rounds.json)。每轮从自己的轮前 store 独立起跑。断点是轮后状态，所以第 N 轮的起点是第 N−1 轮的断点。每个起点都核对过是录下 store 的精确前缀（events.jsonl 的行、management_log 的 request_id）。
- 分类表：[classification.json](classification.json)。在铺开前按录下的拒绝信息写定，规则按顺序匹配被拒回答的第一条 issue。铺开后只修订过一条，并在表内注明（见下文 R10）。

## 结论

1. **新代码能读通全部旧断点**，包括旧编译器 c6e1f64 生成的 F2。所有 store 都没有读不出的行。
2. **13 个主线轮次的 IR 与当年逐项相同，交付正文逐字相同**（a-dpipe@2…@15）。Atom 的差异只在两处，都是有意的：
   - `authority.basis` 和各 rule 的 `resource_ref`：每轮都不同。ae25731 把 Authority 依据从用户原文区间改为绑到任务的 IR 条目。Atom 摘要因此改变，重放时回传的 atom_ref 相应改写。
   - R7 的 `goal_refs` 里任务引用 `t-dpipe@5` 的摘要：当年交付的是 `1045b5…`，与 R7 起点时 `t-dpipe@5` 的实际摘要 `6e1cba…` 对不上；新代码由 86347f5 按 id 加 revision 写入实际摘要。
3. **单独重放每个录下回答，没有退化**：没有"当年接受、现在拒绝"的回答，也没有本该拒绝、现在被放过的。
4. **不可比的地方都来自有意的变化**，列在下文。

## 分类统计（逐个回答单独重放，共 91 个录下的调用）

| 结果 | 数量 | 说明 |
|---|---|---|
| 与当年相同（当年接受，现在也接受） | 43 | 含 R1-cb04de9f 的 CI（#3） |
| 翻转为接受（符合预期） | 12 | R7 mgmt-14 的 parent_basis ×7（327c394）；R14 mgmt-29 的 evidence_refs 定位 ×3（f867e9a）；R10 mgmt-20 #3 的 authority.basis 区间（ae25731）；R10 mgmt-20 #0 的 segment 加段内 quote（c65a94f） |
| 仍拒绝，原因相同（符合预期） | 16 | 原文没有去向 ×2，仍被采纳的原文被归为非规范或 superseded ×5，规范来源被丢弃却没有撤回处置 ×2（R10 重跑一），IR 来源选择器解析不了 ×6（含 R8 挂错事件、R1-cb04de9f 的占位 quote `. . .`），IR group 重复 ×1 |
| 原拒因已解决，被另一道门槛拦下 | 2 | R10 重跑一 #0、R1-cb04de9f #1：selector 冲突现在能解析（c65a94f），但同一回答被"原文没有去向"拦下。R1-cb04de9f 那段原文只被引用在 task 的 goal 里，按设计，goal 的来源不算去向 |
| 已知缺口，仍拒绝 | 1 | R7 mgmt-13 #3：coverage.refs 写了 `a-dpipe@6`，不是计划的当前版本。属于 A 类，尚未修复 |
| 退化 | 0 | — |
| 不在上述统计内 | 17 | 核对 16 次（15 次 consistent，1 次 inconsistent，照样喂入，标为不可比）；传输失败 1 次（R1-cb04de9f #0 超时） |


**分类表修订（铺开后唯一一处）。** R10 mgmt-20 #0 当年因 selector 冲突被拒：引用同时给了 segment s8 和 quote，而 e398 的 s8 原文正与 quote 相同。c65a94f 改为"quote 落在所指 segment 内时按 quote 取区间"，所以现在接受。分类表为此加了一条 A 类规则。它按录下回答本身判定：凡同时给出两种选择器的引用，quote 都在请求里该 segment 的文本中，且信息只报了 selector 冲突。不按新代码的结果判定。其余 selector 冲突仍归 B 类。

## 不可比，以及原因

| 轮 | 现象 | 原因 |
|---|---|---|
| R10 | 依次喂入时，IR #0 被接受，得到的 IR 与当年（#2）不同，录下的 CI 是针对另一份 IR 写的，于是整批失败 | 状态分叉，起因是 c65a94f 的有意放宽。沿当年路径时两批都被接受，IR、交付正文都与当年一致 |
| R14 回传批 | 当年第 4 次回答被接受（3 satisfied 加 1 unknown）；现在第 1 次就被接受（4 satisfied） | 前 3 次当年因 evidence_refs 定位被拒，f867e9a 之后由代码绑定。评估结论来自另一份回答 |
| R7 回传批 | 当年 7 次都被拒，事件留在队列；现在第 1 次就被接受。评估结论与当年另行补跑的 mgmt-15 相同（2 satisfied 加 2 unknown） | 327c394 |
| R7、R9、R13 的执行 | 完成声明当年是 stopped，现在是 completed | d21ecb4：正常结束的回合，即使中途有工具错误也算 completed。现在不会触发自动再执行 |
| R10、R14、R9-first 的执行 | 完成声明当年、现在都是 stopped；回传批之后，新代码对同一版本自动再派发一次 | 4da499b：stopped 的回传由代码再执行一次。这次执行没有录下的数据 |
| R7-return | 补跑之后，新代码对 a-dpipe@7 自动再派发 | 同上（4da499b）；起点 store 里 execution-292 的回传是 stopped |

**当年评估结果（按录下的回答统计，不代表新代码的判定）。**
- R3–R6 的回传批都有 not_satisfied，决定都是 stop：当时还没有重试路径，评估合同也还没区分出 unknown。
- R7 起出现 unknown。
- R9-first 是 4 个 not_satisfied，加上 reuse 和 stop。新代码的处理：执行声明是 stopped，所以代码自动再执行一次（4da499b）。若声明是 completed，not_satisfied 加 stop 不会再执行。

## 代码已知、但仍由模型写版本号的位置（留给下一批修复）

已登记的缺口：coverage.refs 指向 Atom 时写了版本号（R7 mgmt-13 #3）。

按审阅意见，同类位置一并列出。它们的版本都由计划或 IR 决定，代码知道：

- `coverage.refs` 指向 Atom：版本应是本计划中该 Atom 的版本，规则与 Relation 端点相同。
- `coverage.requirement`：执行评估批里仍是完整 Ref。普通 CI 已改为只写 local_ref。
- `previous_atom_ref`：被替代的应是该 atom_id 当前最新的版本。代码在省略时已会补，但写了就照用。
- `compilation.reuse.current`：就是该任务当前的 Compiled Intent。
- `draft.intent_basis`：指向父 IR 的任务或条目，即当前版本。
- `execution_decisions.basis`：指向该执行运行的 Atom 版本。
- `assessments.target_ref`：本批回传之外的评估目标（不在回传里的 Atom）。
- IR 内容 `value.about` 和 `support` 里的 Ref：指向所给 IR 的条目，即当前版本。
- `Atom.revision`：内容变了就是上一版本加 1，不变就沿用。代码可以判断，但是否算"同一个 Atom 的新版本"是语义选择。

最后两项需要审阅确认归哪一边。

## 局限

- 主线只有一个 Atom（a-dpipe），多 Atom 拆分和第二轮修订（A3、A4 的真实场景）只能靠真实运行。
- 重放时跳过了 operation_result 和 delivery_ack 事件，不重放工具授权，所以执行编号可能与当年不同。这次各轮恰好相同；驱动保留了映射逻辑。
- 核对是把录下的结论照样喂入，不检验新请求下的核对质量。
