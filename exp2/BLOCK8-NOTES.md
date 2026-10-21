# 实验 2 第 8 块：Haiku 第二批录音后的修复（DESIGN §12d）

分支 `exp2-block1`，已合并 `exp2-pure-ic` 的 bc92c8e（`.gitattributes` 的冲突只是注释，保留了两行规则）。没有改 `src/core/`，没有调用模型，没有运行容器，没有读官方测试。

## 1. 做了什么（按 §12d 编号）

| 项 | 内容 | 文件 |
|---|---|---|
| 1 | refers_to 和 applies_to 都可以指向对象 id。refers_to 指向对象时，代码把它解析为该对象在这条边所在轮次的原文（`Registry.referredText`，即那一轮及以前归给它的块）；那些块后来被修订，以引用块为依据的检查就过期，原因记为 refers_to。系统提示和 schema 里写明两种边的含义：refers_to 表示"依赖那段原文或对象，那边改了这边的检查要重推"，applies_to 表示"改变那个对象的行为，它得到改动记录、本轮要做"。对象 id 不存在时，报错写"there is no object O999 yet (objects so far: O1–On)"，并说明本轮新建的对象还没有 id | `attribution.ts`、`registry.ts`、`checks.ts` |
| 2 | 嵌套的归属如果归给同一对象，改动类型相同，内层又没有自己的替换目标，代码就把内层去掉，不报 overlap。归给不同对象（或内层带着自己的目标）时照旧报 overlap，报错里写出两边各归给了谁 | `attribution.ts` |
| 3 | 所有问题都按根源合并。归属：同一种问题、原因文字相同的合成一条，列出所有出处。检查：同一检查的同一种问题合成一条，列出各断言 | `attribution.ts`（`byCause`）、`checks.ts`（`checkIssuesByCause`） |
| 4 | verbatim_mismatch 的报错写明：值不在引文里逐字出现；如果原文是用文字描述这个值（"an empty string" → `""`，"writes the file" → 文件存在），把来源改为 derived，由参考脚本计算。判定规则没有放宽 | `checks.ts` |
| 5 | 检查的依据可以是它在 uses 里列出的共享约定的原文。basis_not_object 的报错写出那些块属于哪个对象，并说明别的对象的原文只有作为 uses 里的共享约定才能当依据 | `checks.ts` |
| 6 | 不可切分的块（代码块、表格；JSON 示例是代码块）被修订时记为"被修正"（amended），不记为"被替换"。分两种情况：<br>- 被修订的是归属块的一部分：这次修订记下 `amended` 列表；<br>- 被修订的是整个归属块：块的状态记为 `amended`。<br>这些块仍留在对象的当前原文里：归属请求的对象简介里列在 `amended`，不进 `modified`；以后还可以再修订它们；对象视图里标 "R15 amended"；工单的原文区写"…amended by <新原文编号>; where they differ, the newer text wins"，新原文也在原文区。以它们为依据的检查照常过期。能切分的句子和子句照旧整句替换 | `registry.ts`、`attribution.ts`、`view.ts`、`workorder.ts` |

新增 `replayByRound`（`recording.ts`）：按步骤和轮次、按回答顺序回放。某一轮用新规则提前通过时，剩下的录音回答记为未使用，不会挪给下一轮。

## 2. 第二批录音的回放

`batch2/cassette.json` 共 28 条，请求在 e7c2929 生成，与现在的请求字节不同（提示词和报错改了），所以走"按回答顺序"的路径。

**归属 R1–R15**：15 轮全部通过。

| 轮 | 录音时 | 现在 |
|---|---|---|
| R1 | 修补 1 次 | 修补 1 次（R1.S1 标为 none，内层有其他对象，仍是 overlap；报错一条） |
| R6、R11、R12、R15 | 修补 1 次（refers_to 指向对象） | 首答通过 |
| R9、R10 | 修补 1 次（同一对象的嵌套归属） | 首答通过 |
| 其他 8 轮 | 首答通过 | 首答通过 |

未使用的录音回答：R6、R9、R10、R11、R12、R15 各自的第 2 个回答（修补）。R6 首答本来就用 refers_to 把 R6.S2.P3 指向各命令对象，现在原样接受；录音里的修补曾把这些边换成原文块，这个修补现在用不上。

**检查推导 R1–R3**：走完整串行，编码用替身执行方，构建、检查和参考脚本都在本地运行（录音时在 docker 里）。三轮都在修补 1 次后通过，录音回答全部用上。入库 26、17、12 条，合计 55 条，其中强检查 49 条，与录音时相同。首答的问题条数：

- R1：共 9 条，其中 verbatim_mismatch 7 条，分属 7 个检查（README 记的 9 条 verbatim_mismatch 里，同一检查的已合并）；verbatim_mismatch 的报错现在指出改走推导，basis_not_object 的报错指出 uses 的路径。
- R2：3 条 verbatim_mismatch（README 记 6 条，同一检查里的合并了）。
- R3：1 条。

**单元情形**（真实原文）：
- R6：首答通过；R6.S2.P3 refers_to O17 和 O40 被接受。以 R6.S2.P3 为依据的检查在 R6 不过期，在 R7 过期（O40 lineage 在 R7 被部分修订），原因记为 refers_to O40。
- R9：首答通过；R9.S2、R9.S3 与 R9.S1 同归 schema，被去掉；R9.S5 等与 R9.S4 同归 mask，也被去掉。
- R15：snapshot 在 R15 的修订里，R13.S4.P1（代码块）和 R13.S5.P1（表格）记为 amended，R13.S7.P1.s8、s9（列表项）照旧被替换；对象简介里两者分开；工单原文区写着 "R13.S4.P1, R13.S5.P1 amended by R15.S2.P1.s2, R15.S2.P2.s1; where they differ, the newer text wins"。

第一批的 `haiku-reference/cassette.json` 按当前请求已经对不上哈希，测试改用第二批（它包含第一批 R1–R3 的 4 条回答）。

## 3. 离线验证

`npm test`：全量 824 项，817 通过，6 项跳过，失败 1 项仍是原有的 `repair-batch`（缺夹具）。exp2 共 136 项，全部通过，本块新增 8 项。替身的两处调整：
- R10 的替身首答原来把 lineage 小节里的一项又单独归给 lineage（同一对象嵌套），现在这算合法，改为归给 pipeline，仍是一个需要修补的错误；
- 归属单元测试的 overlap 例子改为归给不同对象，另加一条：同一对象嵌套不报错。

## 4. 需要设计会话知道的

**4.1 嵌套去重只在"同一对象、同一改动类型、内层没有目标"时生效。** 例如上级是 add、子小节是 partial 并带着 overrides，仍报 overlap。这时归给同一对象也有歧义：子小节的改动类型和外层不同。

**4.2 amended 只按块的种类判断**（code、table）。一段散文里嵌的行内表格之类不算。整块被 withdraw 时仍是 withdrawn。

**4.3 refers_to 指向对象时，"那一轮的原文"取的是那一轮及以前归给这个对象的全部块**，包括当时已被替换的。已被替换的块后来不会再被修订，所以不会因此多判过期。

## 5. 自查

| 要求 | 结果 |
|---|---|
| 1 refers_to 可指向对象，解析为当前原文，被修订时检查过期；两种边写成词汇定义；报错说真实原因 | 成立：R6 单元情形；O999 的报错 |
| 2 同一对象的嵌套归属由代码接受，不同对象才报 overlap | 成立：R9、R10 首答通过；不同对象的例子仍报错 |
| 3 所有问题按根源合并 | 成立：归属和检查各有单元测试；R2 首答从 6 条变为 3 条 |
| 4 值不逐字出现时，报错指向推导；规则不放宽 | 成立：R1 回放里的报错带这句话；判定不变 |
| 5 依据可以是 uses 里约定的原文 | 成立；录音里那条检查没有列 uses，所以仍被退回，报错指出 uses 的路径 |
| 6 不可切分块被修正而不是被替换，留在当前原文里，工单两者都出现，新原文优先；以它为依据的检查照常过期；句子、子句照旧替换 | 成立：R15 单元情形 |
| 回放 batch2：按回答顺序；报告未使用的回答；15 轮归属、3 轮检查都通过 | 成立，见第 2 节 |
| R6、R9、R15 的单元情形用真实原文 | 成立 |

## 6. 补充：第 8、9 项（DESIGN §12d，已合并 `exp2-pure-ic` 的 13b9a24）

| 项 | 内容 | 文件 |
|---|---|---|
| 8 | 工单原文区里，被修订的句子、子句、被修正的代码块或表格前面插入标记：`⟦<编号> → revised by <新原文编号>⟧`，被修正的写 `amended by`，被撤回的写 `withdrawn by`。原文不复制、不改写，去掉标记后与原文逐字相同。执行方的系统提示里写明三种标记的含义 | `workorder.ts`（`markRevisions`）、`opencode-executor.ts` |
| 9 | 锚点按对象归属，不再把一步改过的全部锚点都记给这一步的每个对象（`linkStepAnchors`，`execution.ts`）：<br>- 锚点名或所在文件名按整词含有对象名的（`opFilter`、`dispatch:filter`、`op_filter.go` 里的函数），由代码直接归给该对象；<br>- 执行方在步骤报告里按对象报出的函数、类型、分派名，只有这一步确实改过的才归给该对象；报了但没改的，记在步骤记录的 notes 里，不归属；<br>- 其余记为这一步内各对象共享（`via: "shared"`）。<br>对象自己名下的锚点（锚点区）不含共享的。判断一步是否碰到了对象、判断保护区时，共享的也算，因为共享代码改了，确实可能破坏别的对象。OpenCode 执行方每一步都用结构化输出返回 `{note, objects: [{object, anchors}]}` | `execution.ts`、`workorder.ts`、`opencode-executor.ts` |

**验证**（exp2 共 138 项，全部通过；全量 826 项，819 通过，6 项跳过，失败 1 项仍是原有的 `repair-batch`）：
- 第 8 项用 Haiku 第二批 R1–R3 的真实归属：R3 工单里，fill 的标记正好在 "the cell remains empty" 之前（`⟦R2.S13.P4.s4.c3 → revised by R3.S2.P2.s1, R3.S2.P2.s2⟧`）；normalize 的标记在总体标准差的两个子句之前（c1、c2，revised by R3.S3.P1.s1, R3.S3.P2）；R2 的原文里只有这 3 处标记。R15 工单里，R13.S4.P1 标 amended，R13.S7.P1.s8 标 revised。
- 第 9 项：
  - 第 3 块的执行测试里，filter 名下只有 `opFilter` 和 `dispatch:filter`，不再有 `opSort`、`opDrop`、`opRename`、`runTransform`、`col`；
  - 替身执行方报了一个没改过的函数（`opNowhere`），没有被归属，记在 notes 里；
  - transform 不落地时，filter 进入保护区，依据只剩它们真正共用的 `dispatch:filter`（以前是 `runTransform` 等）；
  - 单元测试覆盖了按名、按报告、共享三种情况，以及整词匹配（`sorter.go` 不算 sort）。
- 第二批录音回放的结果不变：归属 15 轮、检查 3 轮都通过，入库 55 条，强检查 49 条。

**需要设计会话知道的**：
- 按文件名归属会把 `transform.go` 里的全部函数（包括 `dispatch:filter`）都归给 transform。`dispatch:filter` 同时按自身名字归给 filter，所以两者共有它。这正是保护区需要的那种共享。
- 执行方报告里的锚点可以写锚点编号，也可以写函数名或方法名的最后一段。
