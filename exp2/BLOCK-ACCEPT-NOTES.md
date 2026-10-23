# 验收重构块：审查员发现、代码守住

依据：exp2/DESIGN.md §12i（8ce444a）和本块的消息。与 §12g/§12h 冲突处以 §12i 为准；第 12 块的台账、停送、有效期规则保留，裁决会话不在送修路径上。基础是 `exp2-block1` 2adf64c（第 12 块）合并 `origin/exp2-pure-ic` 8ce444a。

每一项先写做法，再写回应 §12i 起因里的哪条证据（证据编号见下），新增的东西单独说明现有机制为什么不够。范围只有验收和它在每轮流程中的位置；归属、改动分类、工单生成、原文交付没有改。

**证据编号**（§12i 起因）
- 证据 A（VERIFY-2026-10-22）：44 条"程序错"真假各半，两份满分产物上 10 条全假；误报的前提：输入退化 11、过期 6、位置假定 3、推导 1、矛盾 1；22 条误报里 21 条在某个产物上通过过；4 条是同一探针、输出未变、判断翻转。
- 证据 B（MIDDLE-LAYER-CHECK-2026-10-22）：54 个过期条目 31 个不该过期；K8、P86 该过期没过期。
- 证据 C（对照组）：滞留失败都是审查员没发现，报了的当轮修好；同一审查员 45 次漏 log(0)，探针 R1 抓到；审查员也会误报；审查员占非执行方成本约 79%，上下文随原文线性增长；无发现的审查照样花 3–5 分钟。
- 证据 D（OBSERVATIONS §17）：审查员降为 gpt-5.6-luna-fast medium 后，对照组 L 99.0%、M 100%：准确率已无空间，能比的是成本。

## 0. 一轮的流程（新的默认，`acceptance.mode: "review"`）

归属、库检查推导、基线上的库检查运行、工单，都不变。工单之后：

1. 执行方会话收到工单（和台账仍开着的条目），回复后代码构建，并在目标环境试跑（`go build ./...` 加 `go test ./...`，docker 下在无网络容器里）。失败就把输出发回修复，最多 2 次（`acceptance.trial_fixes`）。第一次通过试跑的提交记为**首次交付**。
2. 全部守卫在这个程序上成批重跑（不花 token），还没成为守卫的库检查也跑一批：通过的当场成为守卫。
3. 审查：在程序的一份副本里（`git clone` 到本轮提交），新开带工具的会话，请求是对照组的原文加 §12i 的附加段落。回复里没有一次成功运行程序的，作废重做。`NO ISSUES` 结束本轮审查。
4. 回复不是 `NO ISSUES` 时，一次结构化模型调用（formalizer）把清单写成检查；代码逐条核验前提，再在当前程序上运行：仍失败的才送修。过不去的记入台账，写明哪条前提。
5. 修补消息：对照组原文加存活条目的原话（审查员的字句）；守卫退化用同样的三段式写出。
6. 修补后回到第 2 步：守卫重跑。任何一个由通过变失败，`git reset` 回修补前的提交，这次修补送的线索丢弃，台账记录。送修过的条目现在通过的，固化为守卫。
7. 没有新发现（没有条目存活到送修）或审查次数用完（`acceptance.reviews`，默认 3），本轮结束。轮末跑库检查的终判，算守卫覆盖，写台账、报告、检查点。

模型角色：执行方（`coding`，默认文档建议 gpt-5.6-luna-fast low）、审查员（`roles.review`，默认 gpt-5.6-luna-fast medium，跑在 coding 服务上，agent 默认 build）、formalizer（`roles.formalize`，默认与审查员同模型，跑在 management 服务上，结构化输出）。写探针、判断、裁决三个角色保留，默认不在这条路径上。

## 1. 审查员是主要发现者

**做法**（`review.ts`、`accept.ts`）
- `REVIEW_INTRO`、`REVIEW_REPLY`、`REPAIR_INTRO` 是消息里给的对照组原文，逐字不变；`requirementsText` 把 R1 到本轮的全部原文按 `# Round N requirements` 拼接。附加内容作为单独段落放在原文之后（`reviewAppendix`）：
  - `# Focus of this review`：R1 写"全部是新的"；之后写"`# Round N requirements` 下的文字是本轮新增或修订的，重点核查"，并把本轮修订或撤回的早轮原文逐条引出（来自归属的 modification 记录，不是模型推断）。原文本身不重复给，审查员拿到的全文和对照组相同。
  - `# Checks that passed on an earlier version of the program and fail now`：原文有改动的单位上翻转的守卫（见第 6 节），请求里写明 `SUPERSEDED <id>: <why>` 这一行的格式。
  - `# Leads to verify`：待核实线索（从未通过过的库检查失败、打开探针时的判断"错"），说明都未经确认，只报其中确实是偏离的。
- 每次审查新开会话、新的程序副本（`copyProgram`：clone 到本轮提交；审完删除）；OpenCode 实现 `OpenCodeReviewer` 不加系统提示，agent 可配置。
- 无新发现即停：一次审查没有任何条目存活到送修（`NO ISSUES`、全部被前提挡下、或都不能复现），本轮不再跑后续审查。没有修补周期可用时也不再审查。
- 审查会话中有没有运行程序，由代码从会话的工具调用判断（`programRunsIn`：bash 类工具里命令以程序名或 `go run` 起头的调用，退出码不是 126/127）。没有的那次作废，同一槽位重做一次；每轮审查会话总数不超过 2 倍审查上限。

**回应**：证据 C（滞留失败都是审查员没发现；报了的当轮修好）、证据 D（准确率已无空间，审查员的设置要和对照组一致才能比成本）。上下文线性增长和无发现的审查仍花 3–5 分钟，是"没有新发现就不再审查"和"重点核查段落"的依据；原文本身没有收窄，因为用户要求审查员拿全部原文。

**新加的**：reviewer 角色和 `Reviewer` 接口、请求的附加段落、`SUPERSEDED` 行、作废判定。现有机制里没有带工具自己运行程序的验收方；判断只读探针输出，不能自己构造输入。

## 2. 送修前的前提核验由代码完成

**做法**（`formalize.ts`）
- 一次结构化调用把审查清单写成条目（`FormalizeRequest` → `FormalItem`）：引用的单位编号、重建的输入（args 和每个文件的完整内容；写不出就 `input: null` 加原因）、每个 CSV/JSON 输入文件的**声明**（是否可解析、数据记录数、空单元格数、列名）、断言（目标、期望值、来源 verbatim/derived/computed）和参考脚本。代码先核形状：单位存在、目标合法、expect_json 可解析、每个 CSV/JSON 文件都有声明、derived/computed 有脚本；有问题的退回一次，仍有问题的记为 `malformed`。
- 前提由代码核验（`checkPremises`），不花 token，按顺序：
  1. `unit_not_in_force`：引用的单位被分到对象、所在块仍是 live 状态、且没有被后续轮次的 modification 整体替换或撤回（`replacedBasis` 里 parts 包含该单位或其祖先）。
  2. `input_claim_false`：按格式的标准解析器解析输入文件，和声明比对。CSV 用 Go `encoding/csv` 默认语义写的解析器（`parseCsvGo`：RFC 4180 引号，空行跳过，首记录定字段数，字段数不符或裸引号为错）；JSON 用 `JSON.parse`。单列 CSV 里的"空单元格"按 Go 读法是空行，解析出的空单元格数为 0，声明 1 就挡下。
  3. `value_not_stated` / `value_not_computed`：verbatim 断言的期望值必须出现在引用单位的原文里（`statedIn`）；不在原文里的数值期望挡下为 `value_not_computed`，文字期望挡下为 `value_not_stated`。
  4. `reference_failed`：derived/computed 断言由代码运行参考脚本（复用第 9 块的 `methodB`），脚本失败或与模型给的值不一致就挡下。
  5. `not_reproduced`（`reproduces`）：建成的检查在当前程序上运行，全部断言通过的说明偏离不存在，不送。
- 挡下的条目在该周期记一条 `action: "blocked"` 的 sighting，`why` 是前提名和细节；台账里以 `premise_failed` 为原因、`blocked` 结束，只列在报告里。

**回应**：证据 A 的误报前提分类。输入退化 11 条对应前提 2；过期 6 条（K8 ×5、K85）对应前提 1 和第 6 节；推导 1 条（P204 按十进制算）对应前提 3、4：数值不能由文字陈述，脚本由代码运行；矛盾 1 条（P36）对应判断不再在送修路径上。位置假定 3 条（K1、K10 的 `.rejected` 行序）不在 §12i 第 2 条列出的前提里，代码没有核验；审查员自己运行程序时能看到行序，但一个把行序写进断言的条目仍会送修。这是已知边界。

**新加的**：formalizer 角色、`InputClaim`、`parseCsvGo`、`checkPremises`。现有机制里探针和判断没有"声明输入表达了什么情形"的字段，库检查的入库规则核的是值在原文里（前提 3）却不核输入，过期只按引用走（第 6 节）。§12i 第 3 条允许用一次模型调用写断言、判定由代码做，formalizer 就是这一次调用。

## 3. 守卫只收代码比对、且在本运行程序上通过过的检查

**做法**（`guards.ts`、`store.ts`）
- `GuardRecord`（G1、G2…不复用）两种来源：`library`（库检查 K 在本运行的某个程序上通过的那一刻）、`review`（审查员报的、执行方修好的条目，代码把前提核验后的检查固化下来，含填好的输入和解析后的期望值，`origin` 保留审查员原话）。`GuardEvent` 只在身份变化时追加：born/passing、failing（带 `changed_text`）、retired。两者都存进 state（append-only），`recordGuards` 校验编号顺序。
- 守卫的运行走库检查现成的 `runChecks`（`guardCheck` 把守卫映射为 CheckRecord），一批一个容器，不花 token；超时记 unknown，不翻转也不触发回退。
- 模型判断（探针的 C 类结论）永远不成为守卫；打开探针时，判断"错"只作为线索交审查员（第 1 节）。从未通过过的库检查失败同样只是线索。

**回应**：证据 A 里 4 条同一探针、输出未变、判断翻转：判断不是确定性检查，不能守。证据 A 里 22 条误报有 21 条在某个产物上通过过：通过过不等于对，所以守卫翻转时还要看原文有没有改（第 6 节），而不是直接当退化。

**新加的**：`guards`、`guard_events` 两个 state 列表和 `guards.ts`。现有的库检查有通过记录（`check_runs`）但没有"从此由代码守住"的身份；探针条目修好后只在台账里以 fixed 结束，没有东西防止它再坏。

## 4. 修补不能改坏守卫

**做法**（`accept.ts`）
- 每个修补后的周期先重跑全部当前守卫（live，含本轮新生的）。任何一个由通过变失败：`resetTo` 回到修补前的提交（上一个构建并通过试跑的周期的 commit，就是已有的 git 检查点），`cycle.reverted = { to, guards, discarded }`，这次修补消息送出的条目全部记为 `discarded`，从本轮的待修列表里删除；下一条消息（如有）加一段说明回退了什么。守卫的身份不变（程序回到了它通过的状态，不记 failing 事件）。
- 工作消息（第一个周期）改坏守卫不算回退：那时没有"修补前"的程序；翻转按第 6 节处理。

**回应**：§12i 的定位（确认一次后由代码免费守住）和第 12 块的证据 2（修补在别处改坏东西要能发现）。对照组没有这一层：审查员要再发现一次。

**新加的**：`reverted` 记录和 `discarded` 这个 sighting 动作。第 12 块的"回退到失败最少的周期"只在轮末选一次，周期内改坏的东西要等审查员再报。

## 5. 探针每个单位只写一次；每轮写探针、判断默认关闭

**做法**（`store.ts`、`probes.ts`、`serial.ts`）
- `beginRoundProbes(round, { byReference, gaps })`：`gaps: false` 不把早轮未覆盖的单位带回来；`byReference: false` 只有探针自己的单位被替换才过期（第 6 节）。于是一轮要写的单位只有本轮新增/修订的单位，加上因自己的单位被修订而过期的探针的 live 单位。review 模式下两者都关。
- `acceptance.probes`（默认 false）：关闭时不写探针、不判断；打开时探针写在编码旁边（不变），每个周期的程序上跑一遍并判断（缓存不变），"错"的结论作为线索进审查请求，从不直接送修。代码都保留，`mode: "probes"` 仍是第 10–12 块的完整流程。

**回应**：§12h 起因里"未缓存 token 主要花在写探针和判断上"，以及证据 B 里 31 个不该过期的条目导致的重写。证据 C 里探针在 R1 抓到 log(0) 而审查员 45 次漏掉，是保留这条路径（可配置打开）的理由。

**新加的**：两个开关。`openGaps` 和按引用过期是第 10、11 块的规则，没有开关就不能按 §12i 关掉。

## 6. 过期用确定性触发

**做法**（`guards.ts` 的 `changedTextBehind`、`accept.ts`）
- 库检查和探针按引用（refers_to）、按未写明的 reading、按 convention 推断过期的规则，加了 `byReference` 开关，默认关（`acceptance.stale_by_reference`）。自己的 basis 被替换的过期（第 9 块的确定性规则）保留，它来自归属的 modification 记录。
- 守卫不因原文改动而自动退役。触发是翻转：守卫由通过变失败时，代码判断本轮原文是否"在它背后改动"：
  1. 本轮的 modification 与它依据的单位重叠（`replacedBasis(units, round-1, round)`）；
  2. 本轮改动的对象拥有它依据的某个单位；
  3. 本轮改动的对象的名字出现在它输入的词里（命令名、step type、字段名等）。
  有改动：守卫记 failing 事件带 `changed_text`，下一次审查请求里附上命令、输入、期望与实际、改动说明、改动前后的原文引文；审查员写 `SUPERSEDED <id>: <why>` 则退役（台账 superseded）；没写则按退化送修（再记一条不带 changed_text 的 failing 事件，之后不再问）。
  没有改动：直接判退化，当周期进修补列表（`not_landed` sighting），停送规则同第 12 块。
- 第 3 条规则比 §12i 字面的"原文有改动的单位"宽。它是为 K8 加的：K8 只引用 pipeline 的块，输入里的 config.json 却让 ingest 生成 sidecar、让 verify 消费它，R5 撤回 sidecar 后 K8 在正确的程序上失败。按字面规则 K8 会被判退化送修（复现证据 A 的 5 条误报）；按第 3 条，ingest 和 verify 都是 R5 的改动对象、名字都在输入里，守卫交审查员判断。规则是代码从输入文本和对象名算出来的，不是推断引用。

**回应**：证据 B（31 个不该过期的来自引用推断；K8、P86 该过期没过期的恰恰没有引用）、证据 A 的过期 6 条。

**新加的**：`changedTextBehind`、`changeQuotes`、`SUPERSEDED` 行。现有的过期是静态的（看引用图），对 K8 这种通过输入间接依赖的检查无能为力，对 31 个只是引用了被改块的检查又过于积极。

## 7. 覆盖由代码保证

**做法**（`guards.ts` 的 `guardCoverage`、`serial.ts`）
- 轮末：有效单位 = R1 到本轮每轮 `coverage().units`（有具体值或规则的单位）里仍 live、未被整体替换的；覆盖 = 某个在本轮最终程序上运行过的守卫依据它（`restsOn`，到单位或更细）。守卫都在每个周期成批运行，所以"运行过"就是 live 守卫集合；探针和判断不计。
- 未覆盖的单位列进报告（`review.coverage.uncovered`，渲染时最多列 25 个，全表在 report.json）。本块不为未覆盖单位写新检查：§12i 只要求进报告。
- 审查会话没有一次成功运行程序的作废重做（第 1 节）。

**回应**：证据 C（审查员 45 次漏 log(0)）：审查员不是覆盖的保证；报告里写明哪些单位没有任何确定性检查执行到。

**新加的**：`guardCoverage`。第 11 块的 `gapState` 算的是探针写了没写，不是有没有确定性检查运行到；§12i 要求"执行到与否从实际运行取，不由模型自报"。

## 8. 台账、停送、有效期

- 条目身份：审查条目 `V<轮>.<审查序号>.<条目号>`，守卫 `G<n>`；同一偏离（相同单位和相同输入）再次被报时沿用原条目号（`ReviewItemRecord.same_as`），不另开条目。
- `Sends` 不变：新条目或输出变了就送；送过一次且输出不变就停送（现在没有裁决，`why` 是"no progress, and no ruling possible"）。工单带入的条目带着基线上的输出摘要，算本轮的一次送修。
- 台账（`ledger.ts`）新增来源 `guard`、`review`，原因 `premise_failed`，结束方式 `blocked`、`discarded`；守卫的 retired 事件以 superseded 结束对应条目。两轮无进展到期的规则不变；因为没有裁决，`confirmed` 不会再被设置。一个到期的审查条目，审查员在同样输出上再报时沿用原条目、按"listed only"停送；输出一变就重开。
- 裁决会话不在送修路径上：`settle`、`ruling` 在 review 模式下不被调用。

## 9. 报告（每轮）

`RoundReport.review`（`report.ts`）和渲染出的四行：
- 首次交付的周期和 commit（`first-deliveries.jsonl` 另记一行；配置了 `scoring` 时首次交付也计分，写进 `scores.jsonl` 的 `kind: "first_delivery"` 和报告的 `first_delivery_score`）；
- 墙钟按阶段（`wall.stages`）：coding、build、trial、trial fix、guard rerun、review、formalize、premise checks、repair、revert、carry-over；
- 每个角色的未缓存输入、缓存读取、输出 token：审查员（会话数）、formalizer（调用数），加原有的执行方、归属、库检查、写探针、判断；
- 守卫数（轮初、轮末）、本轮新增、翻转（按原文有改动 / 无改动分开）、退役为 superseded 的、被回退的修补数；
- 前提核验挡下的条目数（按前提）、审查员报的条目数（formalizer 读出的条目数；清单项数作为后备）和进纠错单的数目、每次审查的结果（有效、`NO ISSUES`、报出、挡下、送出、superseded、给的线索数）、作废的审查次数、试跑次数和失败数；
- 覆盖率和未覆盖单位；给审查员的线索数（库检查 / 判断）。

## 10. 回放工具

`intent-exp2-replay --mode review`（配置里有 reviewer 时的默认）：对每份冻结产物，跑其轮次的库检查（失败的作为线索），在产物的副本里做 `--reviews` 次审查（默认 1；比较时整个工具跑 3 次），formalizer 写条目，代码核前提、在产物上复现。输出 `replay.md` 一张表：审查员原始条目数、按前提挡下的数、会被送修的数、两角色的 token；`--defects` 时缺陷表分别对"审查员原话"和"过了前提的条目"匹配，两列并列。每份产物 `products/<name>/review.md` 有审查全文和逐条判定。`--mode probes` 是第 12 块的回放。

## 11. 配置

`roles.review`、`roles.formalize`（默认都是 gpt-5.6-luna-fast medium）；`acceptance: { mode, probes, stale_by_reference, reviews, trial_fixes, review_agent }`，见 `local-config.example.json`。`mode: "probes"` 时一切如第 12 块（但 `stale_by_reference` 仍默认关）。审查员跑在 coding 服务上（需要工具），formalizer 跑在 management 服务上（结构化输出）；formalizer 的调用进录音（cassette 新步骤 `formalize`），审查员的会话不进录音（自由文本、带工具），其回复全文在 state 的 `review_calls` 里。

## 12. 假定和已知边界

- 对照组脚本不在仓库里。两句指令之间用一个换行连接、原文之前空一行、`# Round N requirements` 每轮一行，这是对消息描述的读法；附加段落放在全部原文之后。要改只需改 `review.ts` 的常量和 `reviewRequest`。
- 试跑失败时发回执行方的消息文字（`trialMessage`）消息里没有给，是自拟的；修补消息的基础文本和审查请求是原文。
- 审查员是否运行过程序，从 OpenCode 会话消息的 tool parts 读（命令和退出码）。服务端不给退出码时，命令里有程序名的完成了的调用都算运行；只有 126/127 或根本没有调用才作废。真实服务端的 parts 形状如果不同，`programRunsIn` 要对着实际消息调。
- `SUPERSEDED` 必须显式：被问到的守卫翻转，审查员没有写这一行就按退化送修。这是偏保护旧行为的一侧，代价是一次可能白费的修补。
- 第 6 节第 3 条规则（输入里出现本轮改动对象的名字）比 §12i 字面宽，原因写在那里。
- 位置假定（K1、K10 类）不在前提核验里。
- 已到期的审查条目在同样输出上再报不重开，这是第 12 块有效期规则在没有裁决确认时的后果。
- 守卫覆盖只计守卫，不计探针；report.json 里有全部未覆盖单位。
- 线索每轮每个条目在同一输出上只给审查员一次；没有上限。
- 没有在本地跑真实模型：审查员和 formalizer 的真实 token、墙钟、作废率，以及 18 份冻结产物 ×3 的比较和 §12i 的预先登记判定，都要本地做（第 14 节）。

## 13. 离线验证

`npm test`：903 项，896 通过，6 项跳过，失败 1 项仍是原有的 `repair-batch`（"R3 original counterexample…"）。新增 16 项都在 `block-accept.test.ts`，替身在 `review-stubs.ts`：审查员替身真的构建并运行拿到的程序副本，按它看到的输出写条目或答 `NO ISSUES`；formalizer 替身从清单文字写出条目（输入重建、声明计数、断言和参考脚本）。所有模型调用都是替身。

| 验收要求 | 测试 |
|---|---|
| 审查请求和修补消息与对照组逐字一致 | 第 1 组：基础文本、轮标题、`NO ISSUES` 判定、`SUPERSEDED` 解析、从会话工具调用识别程序运行 |
| 审查员报的偏离：前提核验通过才送修 | §2 第 2 项：filter 条目的前提全部通过，建成的检查在错的程序上复现、在对的程序上不复现 |
| 依据的单位已被取代时挡下 | §2 第 3 项：R5 撤回的 sidecar 子句，在 R5 挡下为 `unit_not_in_force`（细节写明被 R5.S1.P2.s4 撤回），在 R4 仍通过 |
| 单列 CSV 空单元格这类"解析结果与声称不符"的输入挡下 | §2 第 1、4 项：`v\n10\n20\n30\n\n` 按 Go 读法 3 条记录、0 个空单元格；声明 4 条、1 个空单元格被挡下为 `input_claim_false` |
| 数值期望是文字陈述而非脚本算出时挡下 | §2 第 5 项：期望 42 引用 filter 句，原文没有：`value_not_computed`；原文写明的 exit code 1 通过；脚本与模型值不一致：`reference_failed` |
| 修补改坏当前通过的守卫：回退、线索丢弃、程序回到修补前 | §1/3/4 第 2 项：sort 库检查第一个周期通过成为 G1；审查员报 filter；修补修好 filter 但在 transform 里反转 sort；G1 翻转，回退到 C1.1 的提交，HEAD 的 filter.go 仍是错的版本，V1.1.1 记为 discarded，台账以 discarded 结束 |
| 模型判断从 ok 翻成 wrong、输出未变：不成为守卫、不直接送修 | §1/3/4 第 3 项：作为线索出现在审查请求的 `# Leads to verify` 段，执行方只收到工单，没有守卫产生 |
| 守卫在原文改动的单位上翻转：交审查员，请求里有本轮原文改动 | §6 第 1 项：R5 上 sidecar 守卫翻转，`changedTextBehind` 给出撤回记录和对象改动，请求里有命令、改动前后原文；`SUPERSEDED G1` 使其退役，没有东西送修 |
| 原文未改动的单位上翻转：直接判退化送修 | §6 第 2 项：R2 上 sort 守卫翻转，`changedTextBehind` 为空，当周期以 `not_landed` 送修，修补消息以对照组原文开头、条目是三段式；修好后台账见 pass，轮末无开放条目 |
| 一个单位第二轮起没有改动：不再写探针；被修订时重写 | §5：R2 的单位不含 filter、sort、也不含 R1 未覆盖的 rename 单位；含 R2 新单位和因 R1.S3.P22.s3 被修订而过期的探针的 live 单位；`gaps: true` 时 rename 单位会回来 |
| 一次审查里没有成功运行程序：作废重做，不算 NO ISSUES | §1/3/4 第 4 项：第一次无运行记录的 `NO ISSUES` 记为 valid=false、no_issues=false，重做一次有效；voided 1、attempts 2 |
| 替身串行 R1–R3：报告各项都有、格式正确 | 最后一组：三轮报告都有 review 块（首次交付、各次审查、角色 token、守卫、翻转、回退、前提、覆盖、作废），墙钟含 coding/build/trial/guard rerun/review，渲染出的四行匹配；`first-deliveries.jsonl`、`ledger.md`、state 里的 `review_calls`、`formalize_calls`（F 编号）、`guards` |
| 回放工具在冻结产物上跑新验收 | 同组第 2 项：`replayReview` 对错的和对的两份产物，前者 V1.1.1 过了前提会送修，后者 `NO ISSUES`；库检查在产物上跑过；两角色 token 分开 |
| 覆盖由代码取 | §6 第 3 项：运行过的守卫依据的单位算覆盖，没运行的不算；未覆盖单位列出 |

改动的旧测试：`attribution.test.ts` 的 state 字面量加了四个新列表。其余旧测试不变；`stale_by_reference` 的默认只在 Serial 配置层面为关，直接调用 `staleChecks`、`staleProbes` 的测试仍是旧行为（函数默认 `byReference: true`）。

## 14. 本地运行（我们做）

（修正块第一批起按本节；旧版的四步并入下面。）

1. **构建与离线测试**：拉取本分支到新工作树，`npm ci && npm test`。预期 922 项、915 通过、6 跳过、1 失败（原有的 `repair-batch`）。
2. **配置**：照 `exp2/local-config.example.json`。`coding.variant` 按比较口径设 low；`roles.review`、`roles.formalize` 为 gpt-5.6-luna-fast medium；`acceptance` 新增三项，默认即修正块的行为，不写也一样：
   - `premise_block: ["unit_not_in_force", "not_reproduced", "input_claim_false"]`
   - `fallback: "items"`（`off` 是 29158c1 的行为，`review` 是 A1 字面）
   - `void_without_runs: false`
   镜像要有 `go`、`timeout`、支持 `%N` 的 `date`，试跑会在容器里用 `/app`（复制源码进去，不需要可写挂载）。
3. **真实 R1**：`intent-exp2-serial --config <配置> --to 1`。先看 `checkpoints/round-01/report.md` 的这几行：
   - `Review acceptance: … #1 on C1.1: reported N, blocked b, malformed m, sent s (fallback f, …: no_input …), …, program runs seen k`
   - `Reviewer items: … premise checks blocked …, logged and sent …; fallback in … review(s), … item(s), whole reply …; reviews with no program run seen …`
   - `scores.jsonl` 里 `kind: "first_delivery"` 的分和最终分。达标看最终分高于首次交付。
   出问题时对照：`exp2-state.json` 的 `review_calls`（`program_runs`、`valid`）、`formalize_calls`（`problems`）、`executions[].review_items`（`disposition`、`logged`、`premise`）。
4. **冻结产物的离线回放（A3 验收）**：
   ```
   intent-exp2-replay --config <配置> --products <list.tsv> --out <目录-k> --mode review --defects <缺陷表>
   ```
   `replay.md` 的总表并列 strict（每个前提都挡，第 12 块）和 tiers（档位加退化）；缺陷表一节有 raw / strict / tiers 三列命中数，以及干净产物上三列的条目数。判定：tiers 命中数等于 raw，干净产物条目数 tiers < raw。每份产物 `products/<name>/review.md` 有逐条的 tiers 结局、strict 前提、挡下或记日志的原因。
5. **15 轮 ×2**：`intent-exp2-serial --config <配置>`，按 §12i 的预先登记判定与对照组 L 比。各角色 token 在每轮报告的 "Reviewer … Formalizer" 行和阶段表；首次交付分在 `scores.jsonl`。

---

# 修正块：失败即开放，接口按真实回复校准（2026-10-23）

依据：本块消息（效果 A1–A6、B1–B4）、`exp2/evidence/real-replies-2026-10-23/` 的真实回复、上文第 0–14 节。基础是 `exp2-block1` 29158c1（含三处本地机械修复）。下面先是开发前审查（单独推送），之后每批一节。

## 15. 开发前审查

### 15.1 先核对证据：真实回复里实际是什么

对 fixture 直接跑了现有代码（29158c1 的 `programRunsIn`、`canonicalUnit`、`listEntries`），结果：

| 事实 | 观察 | 对效果的影响 |
|---|---|---|
| rep1b 审查员报的条数 | 回复是 **8 条**（顶层列表项 8）；formalizer 也只写了 8 条。"14"是报告的计数错误：`summary.reported = f.items.length + f.malformed.length`，malformed 是**问题条数**（F2 有 14 个问题），不是条目数 | A1 的验收"14 条进入退化送修"按实际改为"8 条，即审查员的全部原话"；计数错误在第一批修 |
| rep1b 8 条的 input | 8 条全部 `input: null`（why_no_input：recipe/csv 内容没给）。canonicalUnit 修好之后，这 8 条仍然全部过不了前提，原因是 `no_input` | 和第 4 次 R1 的 16/17 `no_input` 是同一个现象：对照组的审查请求只要"the command and input you used"，审查员写摘要，不贴完整文件。A1 必须覆盖 `no_input`，而且必须按**条目**退化（见 15.2 冲突 1） |
| rep1b F1 的其他问题 | `expect_json` 写成未加引号的字符串（`ERROR: invalid recipe: …`）；verbatim 断言的 `source.block` 带 hash 或为 null；input 为 null 的条目仍被要求 derived 断言有脚本 | 都是机械问题：非 JSON 的 `expect_json` 按字符串读；verbatim 缺单位时在条目自己的单位里找；input 为 null 时不再核断言（反正建不成检查）。后一条还省掉一次退回调用 |
| canonicalUnit | 28 个真实编号全部归一为合法形状（`R1.S3.P12.s10.c1` 等），是否命中注册表由 A4 的测试对 R1 原文核 | A6 仍要做：退回消息里"不存在"和"格式不对"要分开说 |
| programRunsIn（三处修复后） | rep1b V1.1.1：30 次运行；rep1c V1.1.1：16 次（`& .\dpipe-review.exe`）；rep1c V1.1.2：19 次（`.\dpipe.exe`） | 三处修复已经让识别命中。A2 仍要做：识别规则下一次再漏，不能再整轮作废 |
| exit code | PowerShell 下工具给的 `metadata.exit` 是**外壳**的退出码（命令末尾 `Write-Output "EXIT=$LASTEXITCODE"`，外壳总是 0），不是程序的 | 退出码在 Windows 上判定不了"程序是否真的跑起来"。A2 降为软信号是对的，`program_runs` 只当报告字段 |
| rep1c 的审查回复 | 17 条、15 条，两次都被作废，formalizer 没被调用 | A2 的回放没有真实 formalizer 回复，用和真实回复同形状的替身（全部 `input: null`）回放 |

### 15.2 会失效或互相冲突的效果

1. **A1 的"0 条送修"条件覆盖不了第 4 次 R1。** 第 4 次是 1 条送修、16 条 `no_input`：按 A1 字面，有 1 条送修就不退化，16 条真发现照样被吞。按"失败即开放"的本意，改成**按条目退化**：凡是因 IC 自身原因（formalizer 写不成、`no_input`、formalizer 调用失败）没能核验的条目，各自用审查员原话送修；被真核验挡下的（`not_reproduced` 等拦截档）照样挡。全部条目都退化、0 条存活时，修补消息就是 `REPAIR_INTRO` 加审查员整段原话，和 A1 字面相同。配置 `acceptance.fallback: "items" | "review" | "off"`，默认 `items`；`review` 是 A1 字面（只在 0 条送修且挡下的全是 IC 自身原因时整段退化），`off` 是第 12 块以来的行为。
2. **A1 与 A3 对 `input_claim_false` 的归类不同。** A1 把"`unit_not_in_force` 以外的前提失败"都算 IC 自身原因（会触发退化）；A3 把 `input_claim_false` 放在拦截档，称为"解析器结论"。我按 A3：是否退化看档位，拦截档里的原因（默认 `unit_not_in_force`、`not_reproduced`、`input_claim_false`）都不退化，其余都放行（值的前提记日志，formalizer 的问题走退化）。依据：`input_claim_false` 和 `not_reproduced` 一样是代码对条目前提的确定性结论；证据 A 里输入退化是误报的最大一类（11/22），按 A1 字面会把这一类原样转给执行方。要改只需改 `acceptance.premise_block`。
3. **A3 的"只记日志档"和现有 `checkPremises` 的结构冲突。** 现在它返回第一个失败就停，后面的前提不再核，也不建检查。记日志档放行时，条目还要继续：能建成检查的照样建、照样复现（`not_reproduced` 仍拦）；`reference_failed` 建不成检查的，带原话送修、不进守卫。要改成"逐条核完，按档位汇总"。
4. **A2 与 §12i 第 7 条直接冲突。** §12i 写"没有一次成功运行程序的，该次审查作废重做"。A2 是用户当前授权，按 A2 做，作废重做留作配置（`acceptance.void_without_runs`，默认关）。
5. **A5 改变审查请求的原文拼接，会让既有测试和录音的请求前缀变化。** 审查员不进录音（第 11 节），formalizer 的请求不受影响（它用 annotate 的全文），只需改测试。
6. **A5 的试跑消息写的是 `go build -o dpipe ./... && go test ./...` in /app。** 现在 docker 试跑在 `/src`（只读挂载）里 `go build -o /tmp/trial-bin`，输出前还 echo 了命令名。消息要逐字一致，试跑本身也改成在容器里把源码复制到 `/app`、跑同一条命令、输出原样，消息才不说假话。本机无 docker 的 `goTrial` 只用于测试，同样改成单条命令语义。
7. **B1 与第 12 块的有效期规则冲突**（"两轮无进展到期"）。B1 只对"复现过"的条目（有检查且在程序上失败过的审查条目、守卫退化）取消到期；探针和库检查条目的到期规则不变（它们只在 probes 模式出现）。配置 `acceptance.expire_reproduced`，默认 false。"被原文取代"目前对审查条目没有触发：库检查有 stale 事件、守卫有 retired 事件，审查条目没有。要在轮初的带入处用前提 1（单位是否仍有效）判一次，取代的记 superseded。
8. **B3 把库检查移出关键路径，会改变工单内容。** 工单的"未落地证据"来自本轮新检查在基线上的运行。移到后台后，工单只含开轮时已有检查的状态；新检查在第一次守卫重跑时加入（那时编码已完成）。R1 的基线是空程序，证据只是"没有实现"，影响为零；后续轮次少了新检查在旧程序上的失败证据。这和"模型写的期望不直接驱动修补"（§12i 第 3 条）方向一致，也和对照组（只给原文）一致。配置 `acceptance.checks_in_background`，默认开。
9. **B2 与现有 coverage 规则的关系。** 现在的覆盖义务已经只针对本轮改动的单位；但模型可以给本轮改动对象的**未改动单位**再写检查（作用域按对象给）。B2 只需在代码里加一条确定的规则：一条检查依据的单位里至少有一个是本轮新增/修订的单位或过期检查的单位，否则退回（与 `object_not_in_scope` 同一层次）。真实运行里这类检查有多少，我手上没有状态文件，第二批的 NOTES 会写明这是未经真实数据核对的。

### 15.3 可复用的现有部件

| 效果 | 复用 | 新增（为什么现有的不够） |
|---|---|---|
| A1 | `renderReviewList`、`repairFromReview`、`Sends`（送一次、无进展停送）、`ItemSighting` 的 `action`、台账 `premise_failed` | 条目的"放行方式"（`fallback`/`logged`）和每次审查的退化原因分布：现有 sighting 只有 send/hold/blocked 三种结局，没有"未核验但送出" |
| A2 | `programRunsIn`、`ReviewCallRecord.program_runs` | 只加报告汇总（`program_runs_zero`）和开关 |
| A3 | `checkPremises` 的五个前提、`methodB`、`reproduces` | 档位配置；`checkPremises` 改为逐条核完 |
| A4 | fixture 本身、`Exp2Store.ingestRound`（R1 原文切出的编号与真实运行相同：切分是确定性的，不依赖模型） | 测试文件，不加生产代码 |
| A5 | `REVIEW_INTRO`/`REVIEW_REPLY`/`REPAIR_INTRO` 常量、`dockerTrial` | 试跑消息常量 |
| A6 | `FORMALIZE_SCHEMA`、`canonicalUnit`、source.ts 的编号语法 | schema 的 pattern、提示里一句编号语法 |
| B1 | 台账 `confirmed`（"确认过的条目不到期、每轮送一次"已有实现）、轮初带入（`carried`） | 把"复现过"当作确认的一种；审查条目的取代判定 |
| B2 | `checkChecks` 的作用域规则 | 单位级的同一规则 |
| B3 | `writeRoundProbes` 的"模型调用在锁外、一次提交"模式；`ready()` 的等待写法 | `deriveRoundChecks` 拆成同样的两段 |
| B4 | `RoundReport.review`、`wall.stages`、`scores.jsonl` 的 `first_delivery` | 缺的字段：退化次数（按条/整段、原因）、`program_runs=0` 次数、前提按档位、守卫退化次数（通过→失败） |

replay 工具（`intent-exp2-replay --mode review`）复用到 A3 的离线回放：它已经对冻结产物跑审查、formalizer、前提核验和缺陷表匹配，只需让输出按档位分列。

### 15.4 会改变优先级的证据

- **`no_input` 是现在最大的一类挡下原因**（rep1b 8/8，第 4 次 16/17）。A1 的按条目退化能保住分数，但 IC 的资产（审查条目修好后固化为守卫）在 `no_input` 下一条也攒不起来：没有输入就没有检查。这直接影响 §12i 判定里的成本比（守卫替代后续审查是省成本的来源）。可行的确定性做法：审查副本里审查员自己写的输入文件（rep1b 的 `apply_patch` 写了 left.csv、recipe-join.json 等）在 formalizer 调用之前还在磁盘上，代码可以把副本里未跟踪的小文本文件交给 formalizer。风险：审查员可能先后用同名文件做不同的调用，留在磁盘上的是最后的内容，重建出的检查可能不复现，被 `not_reproduced` 挡下（又一处失败即闭合）。本块不做，列为下一步的候选；要做需要先看一次真实会话里 `apply_patch`/`write` 工具的 input 形状（fixture 导出时把非 bash 工具的 input 去掉了），由本地补导出。
- **B3 的 138 秒**是 R1 的库检查推导；R1 的编码是 1.5 分钟（对照组 L）。放到后台后关键路径上大概只剩等待两者中较长的一个。墙钟线性增长的其他来源（审查请求随原文增长）与对照组相同，不在本块范围。
- 第 4 次 R1 的最终 142/219 说明流程跑通后分数受送修条数限制（1/17）；第一批完成后，预期送修数接近对照组（同一审查员的原话），R1 分数应回到对照组 L 的区间（64.4%/90.4%），这是本地第一项验证。

### 15.5 开发顺序

第一批：A5、A6、A4（先有真实回复的测试），再 A2、A3、A1（A1 依赖 A3 的档位）。第二批：B1、B4、B2、B3。每批 `npm test` 通过后推送。

## 16. 第一批：保住分数（A1–A6）

### A5 与对照组逐字一致

**做法**：`requirementsText` 改为每轮 `# Round N requirements\n\n` 加原文、轮间 `\n\n`（`review.ts`）；附加段落与原文之间空一行。试跑失败消息 `trialMessage` 换成消息里给的原文，`dpipe` 处填程序名，`<输出>` 是试跑输出去掉末尾空白（超过 2 万字符才截断）。为了让消息不说假话，试跑本身也改成那条命令：`dockerTrial` 把只读挂载的源码复制到 `/app`，在那里 `go build -o <binary> ./... && go test ./...`，不再 echo 命令名；本机的 `goTrial` 同样是一条 build 加一条 test。主机构建失败时也跑试跑，执行方拿到的是目标环境的输出，和对照组一样。
**证据**：消息给的原文。
**新增**：无新部件，只换常量和命令。

### A6 formalizer 接口自身

**做法**（`formalize.ts`）：`UNIT_ID_PATTERN`（`R<n>(.S<n>)+(.H|.P<n>(.s<n>(.c<n>)?)?)?`，与 source.ts 的编号一致）写进 schema 的 `units[]` 和 `source.block`；系统提示里加一句编号语法和例子（`⟦R1.S3.P12#f683eb75⟧` 是 R1.S3.P12，hash 不是编号的一部分，`‹s10.c1›` 是 R1.S3.P12.s10.c1）。退回消息分两种：形状不对说"not in the unit id format"并给语法，形状对但不存在才说"does not exist"。一个条目里有认得的单位时，认不得的单位丢掉，不算问题。

真实回复暴露的其他机械问题，按唯一可能的读法在代码里处理，不退回：未 JSON 编码的 `expect_json` 当字符串；verbatim 断言的单位缺失或不存在时置空，由前提核验在条目自己的单位里找这个值；`input: null` 的条目不再核断言和脚本（建不成检查，核了只会多一次退回调用）。
**证据**：rep1b F1 的 25 个问题、F2 的 14 个问题全部属于这三类加编号格式。
**新增**：pattern 常量。现有的 canonicalUnit 只在代码侧容错，模型侧没有任何地方告诉它编号长什么样。

### A4 真实回复回归（`test/exp2/block-accept-fix.test.ts`）

| 验收 | 结果 |
|---|---|
| canonicalUnit 对真实编号全部命中注册表 | 28 个编号（units 和 source.block），归一后全部符合 pattern、全部在 R1 原文切出的注册表里（切分是确定性的，编号与真实运行相同） |
| programRunsIn 在真实 tool parts 上计出 ≥1 次运行 | rep1b V1.1.1：30；rep1c V1.1.1：16（全是 `dpipe-review.exe`）；rep1c V1.1.2：19 |
| formalizeProblems 对真实回复 0 条 malformed | F1、F2 都是 0 个问题，各 8 条，全部 `input: null` |
| `no_input` 不能静默丢弃 | 8 条进入前提核验时都是 `no_input`、没有一条被拦截档挡下；回放整轮时 8 条全部送修（见 A1） |

替身测试保留；接口测试以真实回复为准。rep1b 的 F1/F2 以"回放的 formalizer"原样喂回，审查员用 rep1b 的真实回复和真实 tool parts。

### A2 "审查未运行程序"降为软信号

**做法**：会话返回了就是有效审查；`program_runs`（识别出的运行次数）照写进 `review_calls`，每次审查的 summary 有 `program_runs`，每轮 `program_runs_zero` 汇总进报告。作废重做留作 `acceptance.void_without_runs: true`（默认 false）。回放工具同样。
**证据**：rep1c 两次真审查被作废；15.1 里 PowerShell 的退出码是外壳的，判定本来就不可靠。
**验收**：rep1c 的两份真实回复、识别不到任何运行（`runs: []`，模拟识别规则再漏一次）：两次审查都有效，`program_runs` 0，两次各自整段送修；`void_without_runs` 打开时仍作废重做一次。

### A3 前提核验分两档

**做法**：`assessPremises` 逐条核完所有前提（不再在第一个失败处停），并用能解析的断言建检查；`checkPremises` 保留为它的包装（旧顺序、第一个失败），只供回放的 strict 列和旧测试用。档位：`acceptance.premise_block`，默认 `unit_not_in_force`、`not_reproduced`、`input_claim_false`。拦截档里有一条失败就挡下；其余前提失败记入 `ReviewItemRecord.logged`、条目照送：
- 能建成检查的照常复现，仍失败才送（`not_reproduced` 默认在拦截档），修好后照常固化为守卫；
- 建不成检查的（例如 `reference_failed` 没有一条断言能解析）带审查员原话送出，台账记 `unverified`。

台账条目带 `disposition` 和 `logged`（`ledger.md` 不变，`ledger.json` 有）；报告分列 `premise_blocked`（拦截）和 `premise_logged`（记日志后送出）。
**顺序/位置断言**：现有前提里本来就没有"位置由原文写明"这一条（第 12 节已知边界），所以它们既不挡也不额外记日志；记成日志需要新判定，不在本批。
**证据**：证据 A 的误报分类；前提 3、4（值的陈述、参考脚本）挡下的是"formalizer 自己写的期望值"，挡下它等于用 IC 自己的产物否定审查员的发现。
**验收（离线）**：替身测试里，原文没写的期望值：默认记日志并送修，检查保留并在修好后成为 G1；放进拦截档后挡下。冻结产物上的回放由本地做（第 14 节第 2 步）：`replay.md` 现在并列 strict（第 12 块：每个前提都挡）和档位两套"挡下/送出"，缺陷表也分 raw / strict / tiers 三列，干净产物上的条目（全是误报）三列各自计数。"只少送误报、不少送缺陷表命中的真缺陷"就是看 tiers 列命中数等于 raw 列、干净产物条目数小于 raw。

### A1 失败即开放

**做法**（`accept.ts`）：一次审查的条目按来源分四种结局：
- `sent`：前提全部通过，检查在当前程序上失败；
- `logged`：拦截档之外的前提失败，送出（A3）；
- `fallback`：代码因为自己的原因没能核验，原因包括 formalizer 写坏（`malformed`，退回一次后仍坏）、`no_input`、formalizer 漏写了某条（`not_formalized`：审查回复的顶层列表项按位置没有对应条目）、formalizer 调用失败（`formalize_failed`，以前会抛 RoleUnavailable 停整轮）。用审查员原话送修；
- `blocked`：拦截档里的前提失败。

退化按条目做（15.2 第 1 条）。所有条目都退化、没有任何条目被核验时，修补消息是 `REPAIR_INTRO` 加审查员整段回复（去掉 `SUPERSEDED` 行），与对照组完全相同，台账记一条 `V<r>.<n>.0`（`unverified`）；否则每条按编号列出，文字取审查回复里对应的那一项（`reviewEntries` 按顶层列表项切，formalizer 的引文与那一项一致时用审查员的原文）。每次审查的 summary 有 `fallback`（条数）、`fallback_whole`、`fallback_reasons`；每轮汇总 `fallback: { reviews, whole, items, reasons }`。`acceptance.fallback`：`items`（默认）、`review`（A1 字面：仅当该次审查没有任何条目送出或被核验挡下）、`off`（第 12 块行为）。

另外修了 15.1 里的计数错误：`reported` 是条目数（审查回复的列表项数与 formalizer 条目数取大），`malformed` 是写坏的条目数，不再是问题条数。
**证据**：rep1b 8/8 `no_input`；第 4 次 R1 16/17 `no_input`、1 条送出（字面 A1 不触发）；29158c1 之前 rep1b 8/8 `malformed`。
**验收**：
- rep1b 的真实审查加两份真实 formalizer 回复重放：formalizer 只被调用一次（第一份回复已无问题），8 条 `no_input` 全部退化，执行方收到的第二条消息逐字等于 `REPAIR_INTRO + "\n\n" + 审查员回复`；`fallback: { reviews: 1, whole: 1, items: 8, reasons: { no_input: 8 } }`；台账 `V1.1.0` 为 review/unverified，sent C1.1。
- 同一份 F1 回复把编号改成认不出的形状（复现 29158c1 之前的失败）：8 条 `malformed`，同样整段送修，`malformed` 计 8 而不是问题数。
- formalizer 调用失败：整段送修（`formalize_failed` 8）；`fallback: off` 时仍抛 RoleUnavailable。
- 第 4 次 R1 的形状（1 条能复现、1 条 `no_input`）：两条都送，编号列出，原话；`off` 和 `review` 时只送能复现的那条，`no_input` 挡下。
- 全部 `not_reproduced`：不退化，什么都不送。

### 本批新增部件为什么现有机制不够

- `assessPremises`：`checkPremises` 在第一个失败处返回，分档需要知道全部失败，还要在记日志时照样建检查。
- `reviewEntries` / `replyAsList`：退化送修要审查员原话，formalizer 的引文不保证逐字（它可能把两项合成一条），只有代码按列表项切才是审查员的原文。
- 条目结局 `disposition` 和 `unverified` 台账结局：没有检查的条目，代码不能判断"修好"，原来的结局里没有"送出但不可核验"，会被轮末规则误记为 fixed。

### 离线验证

`npm test`：922 项，915 通过，6 项跳过，失败 1 项仍是原有的 `repair-batch`（"R3 original counterexample…"），与 29158c1 相同。新增 19 项在 `block-accept-fix.test.ts`；`block-accept.test.ts` 改了 3 处：审查请求的拼接（A5）、作废重做的测试显式打开 `voidWithoutRuns`（A2）。所有模型调用都是替身或真实回复的重放；没有运行真实模型。
