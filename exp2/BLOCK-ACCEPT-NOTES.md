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

（修正块起按本节；旧版的四步并入下面。）

1. **构建与离线测试**：拉取本分支到新工作树，`npm ci && npm test`。预期（批 1 收尾之后，22.9）：954 项、952 通过、1 跳过、1 失败（原有的 `repair-batch`，缺 `development/validation/2026-09-24-repair-batch/` 下的文件）。这是 Linux 上的预期，本地尚未在 Linux 上实测。Windows 本机不能当门禁：Go 要在 PATH 上（不在时 70 项失败），即使在，智能应用控制也会随机拦新建的 exe（TEMP 改到 D 盘也拦），另有写死 `python3`、`sh`、内存上限、CRLF 的环境失败，见 22.9。
2. **配置**：照 `exp2/local-config.example.json`。`coding.variant` 按比较口径设 low；`roles.review`、`roles.formalize` 为 gpt-5.6-luna-fast medium。`acceptance` 里修正块的项，默认即修正块的行为，不写也一样：
   - `premise_block: ["unit_not_in_force", "not_reproduced", "input_claim_false"]`（A3）
   - `fallback: "items"`（A1；`off` 是 29158c1 的行为，`review` 是 A1 字面）
   - `void_without_runs: false`（A2）
   - `expire_reproduced: false`（B1）
   - `checks_once: true`、`checks_in_background: true`（B2、B3）
   `scoring.command` 配上就会对每轮最终提交和首次交付各计一次分（`scores.jsonl`）。镜像要有 `go`、`timeout`、支持 `%N` 的 `date`；试跑在容器里把源码复制到 `/app` 再构建，不需要可写挂载。
3. **真实 R1 冒烟**（批次 C 起看接口计数，不看分数）：`intent-exp2-serial --config <配置> --to 1`，然后 `intent-exp2-measures --checkpoints <checkpoints_dir>`。
   - **`measures.md` 的检查列** "checks admitted/entered (unknown never told)"：准入应接近入库数；括号里的"从未告知模型"应为 0。
   - **同一张表的条目列** "items reported / entered (verified, logged, fallback) / blocked; no_input; conservation"：reported = entered + blocked；conservation 为 ok；no_input 只应在三处材料都找不到时出现。
   - **`report.md` 的 "Check writing" 一行**：修补后丢弃的条数按原因列出，各种读法（Python 字典输出、带程序名的参数、未加引号的字符串、重写的转义）的次数，以及被判为拒绝调用的运行数。
   - **`report.md` 的 "Reviewer items" 一行**：结尾应是 "every entry ended once: yes"；不成立时上面会多一行 "Conservation broken: …"，写明缺哪个位置。
   - **逐条查 no_input**：`exp2-state.json` 的 `executions[].review_items[]` 里，`input_from` 是代码取输入的来源（`lead K8`，或"the command the item quotes, with the files of the reviewer's session"）；`produced` 是由前一条命令重跑得到的文件；仍是 no_input 的，看 `detail`（formalizer 侧）或 `logged[].detail`，里面写了查过的线索、会话文件数和命令数。
   - **其他字段**：`checks[].normalized` 是代码对检查的读法，`checks[].fed_back` 记录 unknown 的原因是否告知过模型；`check_rounds[].dropped` 是修补后丢弃的检查和原因。
   - **对照材料**：本次的审查会话可以从 OpenCode 导出，与 `exp2/evidence/replay-2026-10-23/sessions/` 对照：`materials.files` 应能覆盖审查员写过的全部文件。
4. **冻结产物的离线回放（A3 验收）**：
   ```
   intent-exp2-replay --config <配置> --products <list.tsv> --out <目录-k> --defects <缺陷表>
   ```
   `replay.md` 的总表并列 strict（每个前提都挡，第 12 块）和 tiers（档位加退化）；缺陷表一节有 raw / strict / tiers 三列命中数，以及干净产物上三列的条目数。判定：tiers 命中数等于 raw，干净产物条目数 tiers < raw。每份产物 `products/<name>/review.md` 有逐条的 tiers 结局、strict 前提、挡下或记日志的原因。
5. **15 轮 ×2**：每次 `intent-exp2-serial --config <配置>`（各用自己的 state、checkpoints、OpenCode 服务和缓存键），跑完后
   ```
   intent-exp2-measures --checkpoints <checkpoints_dir> --control-cost <对照组 L 同次 R5–R15 的非执行方成本>
   ```
   对照组的成本按同一口径（未缓存输入 + 0.1 × 缓存读 + 输出，审查员即其全部非执行方）从 OBSERVATIONS §17 的逐轮 token 算。`measures.md` 末行给出 §12i 的判定；两次各算一次，口径待用户最终确认这一点不变。

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

## 17. 第二批：成本与稳定（B1–B4）

### B1 复现过的条目每轮送一次，直到修好或被原文取代

**做法**：台账的到期规则（同一输出连续两轮、送过）对"复现过"的条目不再适用：守卫退化（`source: guard`），和有检查的审查条目（检查在程序上失败过）。它们照旧由下一轮的工单带入（在基线上仍失败才带）、本轮送一次（同一输出不重送，`Sends` 不变），直到修好或被取代。`acceptance.expire_reproduced: true` 恢复第 12 块的规则。

被取代：轮初带入时，对每个打开的审查条目用前提 1（`notInForce`，与送修前的单位核验同一个函数）核它依据的单位；本轮有单位被整体替换或撤回的，不带入，记进 `ExecutionRecord.superseded_in`，台账以 superseded 结束。守卫的取代仍按第 6 节（翻转时交审查员）。
**证据**：第 12 块的到期规则是为裁决之前的"判断翻来覆去"设的；复现过的条目由代码在程序上确认，没有"无法裁决"的问题，到期等于放弃一个已确认的缺陷。没有检查的条目（退化送出的）不复现，不在此列：它们在送出那一轮以 `unverified` 结束（第 16 节）。
**新增**：`superseded_in` 和 `notInForce`（从前提核验里抽出）。现有的取代只有库检查的 stale 事件和守卫的 retired 事件，审查条目没有。

### B2 库检查按单位只写一次

**做法**：`checkChecks` 加一条确定的规则（`unitsOnce`，review 模式默认开，`acceptance.checks_once`）：一条检查依据的块里，至少一个是本轮新增、修订、适用的文字，或本轮过期检查的文字（`roundTextForChecks`，与覆盖义务取的是同一组块），否则退回为 `unit_unchanged`。原来作用域只按对象给：本轮改动了某个对象，模型可以给它没改动的旧单位再写检查，退回规则不拦。
**证据**：§12i 第 5 条对探针的同一要求；上文 15.2 第 9 条：真实状态里这类检查有多少，我没有数据，所以这一条的成本收益未经真实运行核对。
**新增**：一个退回码。

### B3 墙钟：库检查移出关键路径

**做法**：review 模式下（`acceptance.checks_in_background`，默认开）库检查的推导分两段，与探针写作同一种写法：
1. `beginRoundChecks`：标过期，在锁内，没有模型调用；
2. `writeRoundChecks`：模型调用和准入运行（参考脚本、基线上的强度）都在锁外，最后一次提交时给检查和调用编号。

它和编码并行。工单用开轮时已有的库；本轮的新检查在第一个周期的守卫运行之前加入（`AcceptDeps.libraryNow`，等待计入 `waiting for checks` 阶段），照旧在通过时成为守卫。轮末的终判之前也会等它。报告里写作 `check writing`（后台）和 `waiting for checks`（关键路径上真正等的时间）。工单内容的变化见 15.2 第 8 条。

**不随轮次线性增长**：关键路径上剩下的非模型时间是四次成批运行：轮初基线上的库、每个周期的守卫、带入条目、轮末终判。每次都是一个容器跑一批，随检查数增长，但单条检查是毫秒到秒级的进程。模型时间里随轮次增长的只有审查（审查员读全部原文，与对照组相同）和 formalizer（它的请求也带全部原文）。本块没有真实数据核对这四次批量运行的实际耗时，所以每轮报告按阶段分列，本地看 `measures.md` 的阶段表就能知道是否有阶段在线性增长。
**证据**：第 4 次 R1：写库检查 150 秒，串行排在编码之前；编码约 1.5 分钟（对照组 L 同档位）。
**新增**：`deriveRoundChecks` 拆成两段，`libraryNow`。`deriveRoundChecks` 保留（两段顺序调用），probes 模式和回放仍用它。

### B4 报告字段

**做法**：每轮报告新增 `measures`（`RoundMeasures`），并按轮追加到 `checkpoints/measures.jsonl`：

| §12i "同时报告"要的 | 字段 |
|---|---|
| 每轮墙钟、分阶段 | `wall_ms`、`stages_ms` |
| 首次交付诊断分 | `first_delivery`（周期、提交）；分数在 `scores.jsonl` 的 `kind: "first_delivery"`（由配置的 `scoring` 命令算，命令给官方分还是诊断分由本地决定） |
| 守卫数 | `guards.at_start / at_end / born` |
| 退化次数（守卫由通过变失败） | `regressions.changed_text / unchanged` |
| 回退修补数 | `reverted` |
| 前提挡下数（分档） | `premise.blocked`（拦截）、`premise.logged`（记日志后送出） |
| fallback 次数 | `fallback.reviews / whole / items / reasons` |
| program_runs=0 次数 | `program_runs_zero` |
| 各角色 token（未缓存/缓存读/输出） | `tokens.{executor, attribution, checks, reviewer, formalizer, probes, judge, interrupted_management}`，各有 `calls / uncached_input / cache_read / output / cache_write` |
| 预先登记的成本 | `non_executor_cost` = 执行方以外各角色（含被中断后重跑的管理调用）的 未缓存输入 + 0.1 × 缓存读 + 输出 |

`intent-exp2-measures --checkpoints <dir> [--control-cost <n>]` 把 `measures.jsonl` 和 `scores.jsonl` 并成一张表（每轮一行，外加分阶段墙钟表），算 R5–R15 的非执行方成本；给出对照组同口径的成本时，按 §12i 判：比值 ≤ 0.5 且 R15 ≥ 948 为胜，比值 ≥ 0.8 或不过门槛为失败，之间为未证明。写 `measures.md` 并打印。一轮被中断后重跑会再写一行，取每轮最后一行。
**中断时的后台写作**：一轮因额度、登录或会话问题中断时，代码先等后台的检查写作结束（它有管理调用的看门狗），再回到检查点。这样它的调用在恢复之前已经提交，算进被中断的那次尝试（`interrupted_management`），也不会在恢复之后再写进状态。探针的后台写作没有做同样的处理（probes 默认关）。
**新增**：`measures.ts` 和一个 CLI。现有报告的这些数分散在 report.json 的各处、报告行和 scores.jsonl 里，没有按轮可汇总的形式，也不算成本。

### 离线验证

`npm test`：927 项，920 通过，6 项跳过，失败 1 项仍是原有的 `repair-batch`。新增 5 项（共 24 项在 `block-accept-fix.test.ts`）：
- B1：同一输出连续三轮的复现条目：默认不到期、三轮都在带入；`expire_reproduced` 时到期。依据单位在 R5 被撤回：`notInForce` R4 为空、R5 写明撤回；台账以 superseded 结束。
- B2：R2 改动的对象，只依据其 R1 未改动文字的检查被退回为 `unit_unchanged`；依据 R2 新文字的不退回；开关关时不退回。
- B3/B4：替身串行 R1–R2（检查替身每次调用延迟 400 ms）：每轮 `check writing` 在编码结束之前开始；R1 的库检查在后台写成后照样成为守卫；检查调用在 state 里编号为 M<n>；`measures.jsonl` 每轮一行，各角色 token 字段齐全，`non_executor_cost` 等于按口径重算的值；报告有 `§12i measures` 一行；`summarizeMeasures` 的四种判定（胜、比值过高失败、未证明、不过门槛失败）。

---

# 批次 C 第二阶段：修（2026-10-23）

依据：`exp2/evidence/DIAGNOSIS-R1-REP1D-REP1E-2026-10-23.md`（下称"诊断"）和 `origin/exp2-pure-ic` 2250130 的 `exp2/evidence/real-runs-2026-10-23/`。不改审查请求和修补消息的原文、执行方的消息、前提档位。执行方拒做的问题不在本批。

## 18. 审查与方案摘要（动手之前推送）

### 18.1 审查：每个效果会碰到什么

**效果 1（检查输出认不出就退回）**
- 现状：准入（`methodB`）在三次写检查调用之后才做，失败只进 `admission_reason`（诊断第 3 题）；`expect_json` 未加引号的检查被退回，但修补用完后丢弃（rep1e 5 条）；参数以程序名开头没有任何规则（rep1e 21/22）。
- 验收要求用**真实回复重放**达到准入 ≥ 20/22。重放时模型的回复是录好的（rep1e 的 M2、M3、M4），不会因为新的退回而改写。所以要过线，只能靠代码对"能唯一读出含义"的形状直接读出，退回只用于读不出的情况：
  - 输出是 Python 字面量（`print({...})`，rep1e 21/21）：用 Python 的 `ast.literal_eval` 读，在同一个脚本沙箱里跑一个固定的转换脚本；多行时每行一个字典，合并。
  - `expect_json` 不是 JSON：与 formalizer 侧（A6）同一条规则，按字符串读。
  - 参数以程序名开头：去掉这一个参数。程序名由原文给出（`binaryFromSource`），不是 dpipe 专用规则。
  这三种读法都记进检查记录的 `normalized`，可以审计。
- 读不出的（脚本退出码非 0、输出既不是 JSON 也不是字面量、缺某个断言的值、计算占位符没有值、A/B 值不一致）变成问题，**在写检查的修补循环里**退回给模型，说明是哪条检查、哪个断言、脚本实际输出了什么。修补用完后仍有这类问题的：只要该检查的这类问题曾经退回过，就保留已解析的断言、记下未解析的；如果问题是最后一次调用才出现、从未退回过，就整条丢弃，在报告里按原因计数。这样状态里不会有"unknown 且无反馈"的检查。
- 冲突：准入要在循环里做，`deriveChecks` 需要沙箱，`writeRoundChecks` 的模型调用和准入要合并；已有的"先 `checkChecks`、后准入"的顺序不变。

**效果 2（守卫要求程序实际执行了要测的命令）**
- "程序拒绝了这次调用"必须由代码确定性地判断，不能按 dpipe 的报错文字判断。做法：每个程序记一份**拒绝指纹**：用一个不可能存在的子命令（`__ic_unknown_command__`）运行一次，记下退出码、stdout、stderr。检查运行时，把输出里检查自己的第一个参数换成同一个占位符后，如果与指纹完全相同，就说明程序把它当作未知命令拒绝了：这次运行不能判通过（改判失败，原因 `refused_call`），也就不会成为守卫。
  - 指纹本身退出码为 0 时（程序对未知命令不报错），这项判定不启用。
  - 指纹在每批运行里多跑一次，库检查、守卫、条目检查、复现、强度用同一个函数。
- rep1e 的程序不在材料里。验收用仓库里的 Go 替身程序做：rep1e 的 K12 原样（`dpipe transform …`）运行，指纹相同，不通过、不成为守卫；归一后（第一参数是 `transform`），实际执行了子命令。
- 已知边界：程序对"缺参数"和"未知命令"给出完全相同的输出时，测缺参数的检查也会判为拒绝。会在报告里计数，不会静默。

**效果 3（输入在 IC 手里就必须落成检查）**
- 三处材料：
  1. 给这次审查的线索：库检查的完整输入，不截断；
  2. 审查会话里审查员写过的文件：从 `apply_patch`（Add/Update，按顺序应用 V4A 补丁）和 `write`/`edit` 工具调用的 input 取内容，删除操作不理会，所以会话末删除文件不影响；
  3. 会话里前一条命令的输出：某个参数文件不在 1、2 里，但会话里有一条更早的程序调用产生了它，就在当前程序上重跑那条调用，取它产生的文件。
- 这三样交给 formalizer（请求里新增 `materials`；`input.files[].content` 可以为 null，并用 `from` 指明来源，由代码填入）。formalizer 仍然写 `input: null` 的条目，由代码确定性地补：
  - 条目文字点到的线索编号（rep1d 的 "K8 case"）：输入和断言都取那条库检查（已准入、已解析）；
  - 条目文字里反引号中、调用了程序的命令：去掉程序调用部分，余下的就是 args，文件取会话里写过的同名文件，并按文件内容里出现的文件名递归带上（例如 recipe 里的 right.csv）；
  - 断言用 formalizer 给的（真实回复里 input 为 null 的条目也都写了断言）。
  只有三处都找不到时才是 `no_input`，`detail` 写明查过什么、缺什么。
- 冲突：formalizer 的 schema 变了（`content` 可空、新增 `from`），要在 A6 的 pattern 之外再加一条描述；真实回复重放时这些字段不存在，按缺省处理。
- 验收：第 4 次重放（真实 formalizer 回复 + 真实线索），引用线索编号的 6 条 0 `no_input`；第 5 次重放（真实回复 + 三份会话导出），`no_input` ≤ 2，余下的逐条写明。verify 的两条要用前一条 ingest 的输出；重放里没有 rep1e 的程序可以重跑，如果它们剩下，原因就是这个。

**效果 4（发现守恒）**
- 现状：整段退化记为 1 条（诊断第 1 题 J）；formalizer 漏写的条目按位置补上了，但计数分散在 `reported`、`sent`、`fallback` 各处。
- 做法：以审查回复的列表项（`reviewEntries`）为单位，每一项恰好得到一个结局：送修、记日志送出、退化送出、挡下。整段退化时，每一项各记一条（台账按项列出，送出的消息仍是整段原话）。每次审查由代码核对"项数 = 四类之和"，不等就记 `conservation_error` 并在报告里写出。
- 验收：五次运行的真实回复（rep1b、rep1c ×2、rep1d ×2、rep1e ×3），每份各做五种故障注入（编号带 hash、PowerShell 调用、只叙述不给输入、脚本输出非 JSON、参数带程序名），全部守恒。第 5 次重放的报告显示 reported 20、entered 20。

### 18.2 复用

| 效果 | 复用 | 新增 |
|---|---|---|
| 1 | `deriveChecks` 的修补循环与 `CheckIssue`；`methodB`；`ScriptSandbox` | 准入问题码（`reference_output`、`reference_value_missing`、`methods_disagree`、`computed_missing`）；`normalized` 字段；Python 字面量读取 |
| 2 | `runChecks`/`runCheck`/`runBatch`；`classify` 的 `not_landed` 失败类 | 拒绝指纹与 `refused_call` 原因 |
| 3 | `programRunsIn` 读会话的同一份消息；`invokesProgram` 认程序调用的规则；`renderEvidence` 给线索时用的库检查 | `ReviewMaterials`（线索、文件、命令）；补丁应用；命令转 args；输入解析 |
| 4 | `reviewEntries`；`ReviewItemRecord.disposition` | 每项一条记录、守恒核对 |

### 18.3 顺序

效果 1 → 2 → 3 → 4，最后做真实回复重放和故障注入的测试。每项 `npm test` 通过后推送；NOTES 第 19 节逐项写做法、依据的运行和验收结果。

## 19. 批次 C 第二阶段：做法、依据、验收

测试全部在 `test/exp2/batch-c.test.ts`。测试材料是 `exp2/evidence/replay-2026-10-23/`：从 2250130 的 real-runs 抽出的五次运行的真实回复（抽取内容见该目录的 README），加上 rep1e 三份审查会话的原样导出。除被测程序（这里构建的 Go 替身）和 rep1c 缺的 formalizer 回复之外，所有模型输出都是真实回复的重放。

### 效果 1：检查的输出或参数形状认不出就退回，不静默作废

**做法**
- **准入移进写检查的循环**（`deriveChecks` 的 `admit`，review 模式下打开）。每次回复之后，没有其他问题的检查当场跑一遍 `methodB`；断言解析不出来的原因作为问题写进下一次请求：
  - 问题码有四个：`reference_output`、`reference_value_missing`、`methods_disagree`、`computed_missing`；
  - 消息里带上脚本实际打印的内容。
- **能唯一读出的形状，代码直接读**，记进 `CheckRecord.normalized`：
  - 脚本输出是 Python 字面量：同一个沙箱里用 `ast.literal_eval` 读，多行时每行一个字典再合并；多行 JSON 对象同样合并；
  - 脚本里字符串的转义写重了（源码里是 `\\n`），而去掉一层转义后正好等于 A 值；
  - `expect_json` 没加引号：按字符串读；
  - 参数以程序名开头：去掉。程序名取自原文，函数是 `normalizeDraft`；formalizer 的参数同样处理。
- **修补用完之后**，按问题有没有退回过分两种处理：
  - 只剩准入问题、并且这些问题退回过的检查，带着已解析的断言入库，记 `fed_back: true`；
  - 准入问题只在最后一次回答里出现过、从未退回过的检查，整条丢弃，在 `check_rounds[].dropped` 里按原因计数。
  这样状态里不会有"unknown 且无反馈"的检查。
- **报告**新增 "Check writing" 一行：准入数/入库数、未告知的 unknown 数、修补后丢弃数（按问题码）、各种读法的次数、被判为拒绝调用的运行数。

**依据**：诊断第 3 题。rep1e 有 19/22 不准入，原因是 21 个脚本都用 `print({...})` 输出；21/22 的参数带程序名；7 条草稿被丢弃。三次调用都没被告知这些。

**验收（真实回复重放：真实归属回复 + 写检查的三次真实回复）**

| 运行 | 原运行准入 | 重放：入库 / 准入 / unknown（是否告知过） / 修补后丢弃（原因） |
|---|---|---|
| rep1e | 3/22 | 23 / 22 / 1（告知过） / 6（`reference_value_missing` 3、`verbatim_mismatch` 2、`computed_by_hand` 1） |
| rep1d | 21/21 | 21 / 21 / 0 / 2（`verbatim_mismatch` 1、`reference_value_missing` 1） |

- 两次准入都 ≥ 20；两次的状态里都没有"unknown 且未告知"的检查。rep1e 入库 23 条，比原来多 1：原来 5 条因为 `expect_json` 不是 JSON 被丢，现在按字符串读后入库了其中 3 条（另外 2 条因其他问题仍被丢）。
- rep1e 原先以 `dpipe` 开头的 21 条检查，重放后按键对应的检查都从子命令开始（`ingest`、`transform`、`verify`、`manifest`、`pipeline`）。
- 第一次回答里的准入问题，出现在了第二次请求的 issues 里，消息写明了脚本打印的内容。
- 把脚本都改成打印 `'not a value'` 再重放：第二次请求收到 `reference_output`，并附上 `it printed "not a value\n"`；状态里每条 unknown 的检查都是 `fed_back: true`。

**边界**：重放时模型不会根据退回改写回答，所以"退回之后修好"这一步只在真实运行里发生。表里的数字是代码自己能读出的部分。

### 效果 2：被程序当作未知命令拒绝的调用，不能判通过，也不能成为守卫

**做法**（`verdict.ts`）
- 每个程序（按命令、挂载和二进制修改时间区分）记一份拒绝指纹：用子命令 `__ic_unknown_command__` 运行一次。第一次见到这个程序时，这次运行和同批检查一起跑。
- 一条检查的运行，把自己的第一个参数换成占位符之后，如果退出码、stdout、stderr 与指纹完全相同，又本来会判通过，就改判失败，原因 `refused_call`。原本就失败的运行保留原来的归类（`missing_name` 更具体）。
- 指纹退出码为 0 时不启用。
- 库检查、守卫、条目检查、复现、强度都经过 `runChecks`/`runCheck`，规则相同。

**依据**：诊断第 1 题 D。rep1e 的 K12 参数是 `dpipe transform …`，程序以 "ERROR: unknown command" 退出 1，正好满足"期望 exit 1"，于是成了守卫 G1。

**验收**
- rep1e 的 K12 原样在 Go 替身上运行：判为 `fail / refused_call`；去掉程序名后，它进入 transform，不再判为拒绝。
- 用 rep1e 原来准入的三条（K11、K12、K14）当库跑一轮：没有守卫产生（原运行有 G1），K12 每个周期都是 `not_landed/refused_call`。
- 重放后，原先带程序名的 21 条检查执行的是各自的子命令。其中 transform 和 verify 的检查（Go 替身只实现了这两个）在替身上运行，没有一条判为拒绝。

**边界**
- rep1e 的程序不在材料里，验收用的是替身程序。
- 程序对"缺参数"和"未知命令"给出完全相同的输出时，测缺参数的检查也会判为拒绝；报告里有计数（"runs refused as an unknown subcommand"）。
- rep1e 有一条检查的参数是 `go build …`（K1 cli_build），这是写检查的错误。它在任何程序上都判为拒绝，所以不会成为守卫。

### 效果 3：输入在 IC 手里，条目就要落成检查

**做法**（`materials.ts`；`formalize.ts` 的 `completeInput`；`accept.ts`）
- **审查结束时**，`OpenCodeReviewer` 从会话消息读出 `materials`：
  - 审查员写过的文件：`apply_patch` 的 Add/Update（按顺序套用 V4A 补丁），以及 `write`、`edit`。删除不理会。
  - 运行过的命令和输出。
  两种导出形状（`state.input`、part 上的 `input`）都能读。
- **给 formalizer 的请求**新增 `materials`：这次给的线索（库检查的完整输入）、文件、命令。schema 里 `files[].content` 可以为 null，用 `from` 指明来源（"session" 或线索编号），由代码填入。
- **formalizer 仍写不出输入时，代码确定性地补**：
  1. 条目文字点到的线索编号：线索的库检查就是条目的检查（已准入，期望值已解析）。
  2. 否则取条目里反引号中、调用了程序的那条命令：去掉 `&`、`go run .`、程序路径之后就是 args，文件取会话里同名的文件，并递归带上这些文件内容里点到的其他会话文件。
     - 审查员自己那次运行在会话里时：它当时没写过的文件，要么由更早的、以另一种角色（参数前的选项不同）提到它的命令产生（在当前程序上重跑那条命令取文件，`produced`），要么当时也不存在。
     - 命令不在会话里时：它点到的每个文件都必须找到，否则不补。
  3. 三处都没有：`no_input`，`detail` 写明查过哪些线索、多少会话文件和命令、缺哪个文件。
- **只补到输入、formalizer 一条断言也没写**：判 `no_assertion`，按审查员原话退化送出（属于代码自己的原因）。

**依据**：诊断第 2 题。rep1d 有 6 条用线索编号代替输入；rep1e 20/20 的输入都在会话的 `apply_patch` 里，verify 的两条还要用前一条命令的输出。

**验收**
- **第 4 次（rep1d）重放**：真实 formalizer 回复 + 原运行给的 13 条线索。引用线索编号的 6 条（第 1–5 条、第 7 条，对应 K8–K12、K16）都从线索取得检查，0 条 `no_input`。放进一轮里跑：这 6 条在程序上复现，作为已核验条目送修。其余条目仍是 `no_input`，原因都写成"leads given: K5, K8…; session files: 0"：rep1d 的审查会话没有导出，重放里没有审查员自己的文件。
- **第 5 次（rep1e）重放**：三份真实审查 + 三份会话导出 + 真实 formalizer 回复。`no_input` 从 20 降到 0。
  - 19 条由"条目引用的命令 + 会话文件"重建。
  - V1.2.6（verify）用的 `review-out.csv`，由会话里更早的 `ingest` 命令在当前程序上重跑产生。
  - V1.3.7（pipeline）formalizer 没写断言，按原话退化（`no_assertion`）。
- **会话末删除文件**：rep1e 第 1 次审查删掉了 base.csv 等 24 个文件，`materials` 里这些文件都还在。

**边界**
- 写文件和运行命令的先后顺序没有逐条对齐：一个在命令之后才写的文件也会被带上。
- 真实回复里的 formalizer 还没见过 `materials`，所以这次的重建都是代码完成的。新的请求会让 formalizer 自己引用材料。

### 效果 4：发现守恒，整段按条目数计

**做法**（`accept.ts`）
- 审查回复的每个列表项都有一条 `ReviewItemRecord`，结局恰好是送修、记日志送出、退化送出、挡下之一。formalizer 对同一位置写了两条时，只保留第一条，计入 `formalizer_duplicates`。
- 整段退化时每一项各记一条、各送一次（台账逐项列出），消息仍是审查员整段原话；原来的 `V<r>.<n>.0` 不再产生。
- 每次审查由代码核对：每个位置恰好一条记录、都有结局、项数等于四类之和。summary 里有 `entered` 和 `conservation`，不成立时 `conservation_errors` 写出缺哪个位置、哪个位置记了两次、哪条没有结局，报告里单独一行 "Conservation broken"。
- 报告的 "Reviewer items" 一行改为 "reported N, entered a repair list M (verified, logged, fallback), blocked K; every entry ended once: yes/no"。`measures.jsonl` 和 `measures.md` 也有这些数。

**依据**：诊断第 1 题 J（整段送出只算 1 条）。

**验收**
- **rep1e 重放**：reported 20、entered 20，报告逐字为 "Reviewer items: reported 20, entered a repair list 20 (verified …, logged …, fallback …), blocked 0; every entry ended once: yes"；台账 20 条。
- **rep1b**（真实回复 + 两份真实 formalizer 回复，8 条都没有输入）：8 条都进了修补，台账 8 条（V1.1.1–V1.1.8，unverified），修补消息仍是 `REPAIR_INTRO` 加审查员整段原话。
- **故障注入**：rep1b、rep1c ×2、rep1d ×2、rep1e ×3，共 8 份真实回复（rep1 在第一次审查前中止，没有回复）。每份都分别注入五种故障，全部守恒，且 reported 等于审查回复的列表项数：
  - 编号带 hash（`R1.S3.P12#deadbeef:s10`）；
  - 命令改成 PowerShell 下的 `& .\dpipe-review.exe`；
  - 只叙述：去掉反引号命令，formalizer 的输入全置 null；
  - 参考脚本改成打印 Python 字面量；
  - formalizer 的参数前加程序名。

### 不改的部分

审查请求和修补消息的原文、执行方的消息、前提档位都没有动。执行方拒做的问题不在本批。

### 离线验证

`npm test`：946 项，939 通过，6 项跳过，失败 1 项仍是原有的 `repair-batch`。新增 19 项，都在 `batch-c.test.ts`。改了 3 处旧测试，都是计数口径随效果 4 改变：整段退化的 sent 从 1 变为条目数；台账从 `V1.1.0` 变为逐项；报告的 "Reviewer items" 一行。没有运行真实模型。

## 20. 接口计数基线（fe6562d）

**做法**：`test/exp2/replay-baseline.test.ts` 用当前代码重放七次真实 R1，算出下面的接口计数，与 `exp2/evidence/replay-2026-10-23/baseline-fe6562d.json` 比较。
- 重放用到的真实输出：真实归属回复、写检查的真实回复、审查与 formalizer 的真实回复，加上 rep1e 导出的会话。
- 被测程序：一个对每次调用都报错的程序。
- 基线文件是在 fe6562d 的 src 上写出的（d5c31ce 的 src 与 fe6562d 相同）。
- 判定方向：准入、进入修补单、来自材料的输入，越多越好；从未告知的 unknown、no_input、blocked、守恒错误，越少越好。其余计数只报告，不判定。
- rep1f、rep1g 的固定材料取自 be04db7，重放共用的辅助函数挪到了 `test/exp2/replay-fixtures.ts`。

**基线**

| 运行 | 写检查：入库 / 准入 / 未告知的 unknown / 丢弃 | 审查：报告 / 进入 / 核实 / fallback / 来自材料的输入 / no_input |
|---|---|---|
| rep1 | 30 / 28 / 0 / 4 | —（第一次审查即作废） |
| rep1b | 20 / 20 / 0 / 1 | 8 / 8 / 0 / 8 / 0 / 8 |
| rep1c | 21 / 21 / 0 / 8 | 32 / 32 / 0 / 32 / 0 / 32（没有 formalizer 回复，用的是"全部无输入"的替身） |
| rep1d | 21 / 21 / 0 / 2 | 20 / 20 / 8 / 12 / 6 / 12（审查会话没有导出） |
| rep1e | 23 / 22 / 0 / 6 | 20 / 20 / 15 / 1 / 20 / 0 |
| rep1f | 14 / 14 / 0 / 2 | —（docker 停机，没有审查） |
| rep1g | 13 / 13 / 0 / 1 | 25 / 25 / 22 / 2 / 1 / 2（审查会话没有导出） |

rep1g 的核实数与真实运行相同（22）。来自材料的输入只有 1，比真实运行少 2，原因是那 2 条的输入在没有导出的会话文件里。

## 21. 批 4：环境错误停轮等待

**做法**
- **新增 `EnvironmentUnavailable`**（`platform.ts`），是 `EnvironmentBlocked` 的子类。原先各模型调用对 `EnvironmentBlocked` 的放行（不算传输失败）对它照样生效。
- **`serial.run` 先认它**，走 `QuotaExhausted` 那条路：
  - 保存这次尝试的花费，原因写成 `environment unavailable: …`；
  - 回到检查点，等待 `environmentWaitMs` 后重跑本轮。等待时间的配置项是 `resume.environment_wait_ms`，默认 5 分钟（配额等待是 30 分钟）；
  - 续跑次数与配额续跑共用 `max_resumes`。
  - 主机拦截程序启动（智能应用控制）仍按原样停轮，不等待：被拦截的是新构建的未签名程序，等待不会让它通过。
- **识别规则**，都在 docker 客户端或解释器的输出上判断，不看程序的输出：
  - **docker 不在**（`dockerDown`）：
    - 客户端退出码不为 0，并且输出里有守护进程连不上的原话。rep1f 的原话 "failed to connect to the docker API" 逐字收录；另收 "Cannot connect to the Docker daemon"（Linux）、"error during connect"、"docker daemon is not running"（较旧的 Windows 客户端）；
    - docker 客户端本身启动不了（spawn ENOENT）。
    - 守护进程有回应的容器错误（"Error response from daemon: No such image"）不算 docker 不在。
  - **生效位置**：`dockerGoBuilder`、`dockerGoBuilderAsync`（构建），`dockerTrial`（试跑），`runInContainer`（检查的批量与单次运行、参考脚本）。命中就抛出，不再返回 `{ ok: false, output }` 或运行结果。
  - **解释器缺失**（`interpreterMissing`）：
    - 本机 spawn ENOENT；
    - Windows 应用商店占位程序的 "Python was not found; run without arguments to install from the Microsoft Store"；
    - 镜像里没有解释器（退出 126/127，输出里有解释器路径和 "no such file or directory"）。
    - 生效位置是 `LocalScriptSandbox` 与 `DockerScriptSandbox`。脚本自己的失败照旧退回写检查的模型。
  - **审查副本**（`copyProgram`）：
    - 旧目录删不掉（EPERM/EBUSY，例如续跑同一轮时还被锁着）：副本建在旁边的 `<dir>-2`…`<dir>-5`；
    - 五个位置都删不掉，或者 clone/checkout 失败：抛出，消息带 git 的 stderr。
    - 原来这里会抛出未处理的错误，进程退出。
- **由此得到的效果**：
  - 试跑里的 docker 错误不再作为试跑失败消息发给执行方；
  - 写检查时参考脚本碰上 docker 错误，不再作为"reference script exited 1"退回模型（rep1f 的 13 条里，9 条的 unknown 原因是这句话，其中 7 条没有准入；第三次写检查的请求把它当作问题退回了模型）；
  - 一轮中途 docker 断开，检查运行抛出，本轮回到检查点，守卫不判翻转，也不触发回退。

**依据**
- rep1f（2026-10-23 15:39，Docker Desktop 未启动）：
  - 三个周期的构建和试跑输出都是上面那句原话，状态 `trial_spent`，执行方花掉两次试跑修复（VOID.txt：未缓存 29k）；
  - 13 条检查中 9 条的 unknown 原因里有这句原话，第三次写检查的请求带着它。
- CONSOLIDATION-MAP §5：各种环境错误现在各走到哪里。

**验收**（`test/exp2/batch-4.test.ts`，离线）
- 用一个假 docker 客户端，原样输出 rep1f 的那句话、退出 1：构建（同步和异步）、试跑、批量检查、单次检查、参考脚本，都抛出 `EnvironmentUnavailable`，消息以 "the docker daemon cannot be reached: failed to connect to the docker API" 开头。
- 其他客户端的两种说法、客户端不存在：都抛出。
- 以下情况照旧按结果处理，不抛出：程序自身的编译错误（`syntax error`，返回 `ok: false`）、守护进程回应的 "No such image"、退出 0 的运行、程序报 "unknown command"。
- 解释器缺失的三种形态都认出；脚本自己 `sys.exit('no such file or directory: data.csv')` 仍是退出 1 的结果。
- 审查副本：clone 失败、目录删不掉，都抛出并写明原因。
- review 模式的串行 R1–R2（替身执行方、替身审查方、本地 Go 试跑）：
  - **R1 第一次试跑 docker 不在**：结果 `{ status: done, last_checkpoint: 2, resumes: 1 }`，等待一次，等待时长取配置值；中断记录只有 `round-01-1.json`，原因以 "environment unavailable: the docker daemon cannot be reached" 开头；执行方收到的消息里没有一条提到 docker；两轮报告的守卫、回退、条目、试跑计数与不中断的一次完全相同。
  - **R1 第二个周期（C1.1 检查完之后的修补周期）跑检查时 docker 断开**：`resumes: 1`；中断记录里只有 C1.1；两轮报告的守卫（含两类翻转）、回退、条目与不中断的一次完全相同。
- 七次重放的接口计数与基线相同（第 20 节）。

**边界**
- 没有用真 docker 停机实测，规则按 rep1f 的原话和公开的客户端措辞校准。
- 一轮中途停下会丢掉这一轮执行方已经做的工作（回到检查点），和配额停轮一样。

## 22. 批 1：摘出路径、本轮包、翻转先分类

设计依据：origin/exp2-pure-ic 的 DESIGN §6a（原文的运行逻辑）和 §12j.7 第 1–12 条；§6a 取代 §2.3/§4.4/§6 里"全部原文交给模型"的写法。测试新增在 `test/exp2/batch-1.test.ts`，其余按下面各项改写或删除。

### 22.1 摘出路径（§12j.4）

**做法**
- **串行只剩 review 一种流程**：
  - `Serial.runRound` 去掉 probes 模式那一支（探针写作、带入、`executeRound`、终判探针、变异度量）；
  - `reviewRound` 去掉探针线索；
  - `SerialConfig` 去掉 `probes`、`judge`、`ruling`、`adjudicate`、`buildAsync`，`reviewer` 和 `formalize` 改为必填；
  - `SerialLimits` 去掉 `probeRepairs`、`mutants`、`probeConcurrency`；
  - `AcceptanceConfig` 去掉 `mode`、`probes`、`staleByReference`；
  - serial.ts 从 756 行减到 499 行。
- **代码保留**：`probes.ts`、`judge.ts`、`adjudication.ts`、`discrimination.ts`、`executeRound` 都保留。`runAndJudge`、`verdictCounts` 从 serial 挪到新文件 `probe-run.ts`，直接调用这些模块的测试照旧运行。
- **裁决（第 1 条）**：`runRoundChecks` 不再接受 `adjudicate`，终判不调用裁决。由此没有裁决 token，报告和 measures 里也就没有这一项。
- **按引用过期删除（§12j.5）**：`staleChecks` 只剩"自己的依据被改"一条，refers_to、读法、约定三条分支删除。work order 里"受约定修订影响"的任务入口因此不会再触发；代码留着，供 `executeRound` 的旧测试使用。
- **回放只留 review**：`intent-exp2-replay` 去掉 `--mode probes`，`acceptance.ts` 删掉 `probeDetect`、`repairProducts`、`replayAcceptance`、`scoreDefects`（从 492 行减到 251 行）。
- **配置**（`local-config.ts`）：
  - `acceptance.mode` 只接受 review，`probes` 和 `stale_by_reference` 只接受 false。旧配置文件（例如 rep1f、rep1g 的）写的正是这些值，可以照常加载；
  - `roles: null` 不再允许，因为一轮离不开 formalizer；
  - 示例配置删掉了不用的 roles 和 `probe_repairs`，加上 `workorder_scope`、`review_scope`。
- **报告只渲染两组数**（`renderReport`）：
  - 第一组：§12i 预先登记的一行（measures 去掉 probes、judge 两列 token）；
  - 第二组：接口计数，即审查条目（报、进、挡、no_input、守恒）、写检查（准入/入库、未告知、丢弃、拒绝调用、未覆盖单位）、守卫（数目、三类翻转、退役、回退）、给出的原文字符数、修订召回；
  - 其余（阶段、区、对象、台账、各阶段墙钟时间）只在 report.json 里；
  - `RoundReport.probes` 变为可选，只有旧报告里有。

**删除清单**（恢复方式：`git show 48de051:<路径>`）

| 路径 | 用途 | 引用 |
|---|---|---|
| `src/cli/exp2-detect.ts`（38 行） | 第 9 块：库检查跑冻结产物 | package.json bin `intent-exp2-detect`；BLOCK9/12-NOTES、READY-FOR-LOCAL（历史文档，未改） |
| `src/cli/exp2-probe-detect.ts`（60 行） | 第 10 块：探针检出 | bin `intent-exp2-probe-detect`；BLOCK10/12-NOTES、READY-FOR-LOCAL |
| `src/cli/exp2-repair.ts`（46 行） | 第 10 块：按纠错单修复 | bin `intent-exp2-repair`；BLOCK10/12-NOTES、READY-FOR-LOCAL |
| `detect.ts` 的 `detect`、`renderDetect`（97 行） | 上面 detect CLI 的实现 | 只有 block9 的一项测试 |
| `acceptance.ts` 的 `probeDetect`、`repairProducts`、`replayAcceptance`、`scoreDefects` 及其类型 | 探针检出、修复、probes 回放 | 上面的 CLI；block10、block12 的测试 |
| serial.ts 的 probes 流程、`measure`、`probe`、`mergeStatuses`、`programName`、`CARRIED_HEADER` | 第 10–12 块的串行 | serial、block10–12 的测试 |
| `checks.ts` `staleChecks` 的引用、读法、约定分支 | 第 4 块和 §12d 的过期规则 | propagation、recording 测试 |

**测试**
- 删除 13 项：block10 4 项（带探针的串行 2 项、检出和修复 harness 2 项）、block10c 2 项（编码不等探针写作）、block11 1 项（§6 报告）、block12 3 项（串行的报告和台账 2 项、E6 probes 回放 1 项）、block9 1 项（detect harness）、checks 1 项（裁决退役）、propagation 1 项（约定过期）。
- 改写到 review 流程：串行类测试（serial、recording、ablation、local、infra）加上替身审查员和 formalizer（`standInReview`）。infra 的五项改测写检查方、formalizer、录音和 replay CLI 的故障。
- 其余断言随行为一起改：
  - 过期断言改为不过期；
  - 第 1 轮计分同时记首次交付，`scored` 由 `[1]` 变为 `[1, 1]`；
  - 额度注入从 R5 第 2 条消息移到 R1 第 2 条，因为 review 流程里 R5 没有第二条消息。

### 22.2 本轮包（第 6、9 条，§6a 第 3 步）

**做法**
- **`view.ts`**：
  - `effectiveText`：块的当前有效文本。被整块取代或撤回的块返回 null；被部分修订的句子删去原文，原位置留 `⟦<id> replaced by <ids>⟧`；amended（代码、表格）保留，并注明以新的为准。
  - `roundPackage`：本轮的全部块；本轮新增或修订对象的早轮块（当前有效视图）；与这些对象有关系边相连的早轮对象的块（一跳，边的两个方向都算）；未结条目依据的块。每块一次，按轮次和文中顺序排列。
  - `packageSources`：把本轮包排成审查员读的格式。本轮原文整段给出，早轮的块按轮次标题排，相邻的块按原文接起来。
- **工单**（`buildWorkOrder` 的 `scope`）：delta 时原文区就是本轮包，all 时同旧版。工单另带 `scope.source_chars` 和 `source_chars_all`，后者是同一工单若给全部原文的字符数。
- **审查请求**：`review_scope` 默认为 delta，用 `packageSources`。full 同旧版，等同对照组。附录中"早轮原文已审过、作为上下文"和"本轮修订或撤回的早轮原文"两段保留。
- **配置**：`acceptance.workorder_scope: delta|all`、`review_scope: delta|full`，默认都是 delta；all/full 只作消融。
- **报告**：`zones.source_scope`、`source_chars`、`source_chars_all`、`source_blocks_all`，审查请求字符数 `review.request_chars`，measures 里的 `sources`；渲染为一行 "Requirements given"。

**验收**（替身串行 R1–R3，真实原文，同一组替身；字符数取自各轮 report.json）

| 轮 | 工单原文区 delta | 工单原文区 all | 审查请求合计 delta | 审查请求合计 full |
|---|---|---|---|---|
| R1 | 21,326 | 21,326 | 39,228 | 39,228 |
| R2 | 29,828 | 46,483 | 30,473 | 45,289 |
| R3 | 26,129 | 56,260 | 29,286 | 56,719 |

- R1 的本轮包就是 R1 全文，两档相同。
- R2 的 delta 是 all 的 64%，R3 是 46%。delta 档的大小取决于本轮涉及的对象，all 档随轮次累积增长。
- R2、R3 的包里，早轮块逐个都能归到这四类之一：本轮新增/修订对象的块、关系边连到的早轮对象的块、未结条目依据的块（测试逐块核对），本轮的块全部在内。工单没有状态区。

### 22.3 任务区只列确认过的失败（第 10 条），状态区删除（第 4 条）

**做法**：`buildWorkOrder` 新增 `confirmed`，取串行带入的条目，即复现过的审查条目和失败的守卫。给了 `confirmed` 时：
- 任务区的失败证据只来自这些条目（reason 为 confirmed 或 guard failing）；
- 库检查（假设）的失败和"读法"失败都不进工单；
- 状态区为空，渲染时不打印该节。

保护区保留，等 15 轮数据再定。

**条款冲突的处理**：第 10 条写"hypothesis 的失败进状态区并标未确认"，第 4 条和 §12j.4 写"状态区删"。按后者实现：假设检查的失败只作为线索交给审查员，不进工单。

### 22.4 翻转先分类、后回退；回退丢代码不丢发现（第 11、2 条）

**做法**（`accept.ts`）
- **修补周期里的翻转先分类**：
  - 本轮原文改过它背后的单位（`changedTextBehind`）的，交审查员；
  - 运行结果为 disputed（只有派生或计算的值不一致、位置不对、输入不全）的，记 `disputed`，作为线索交审查员，不当退化，不送修，也不随台账带入下一轮；
  - 只有原文未改、又不是 disputed 的翻转才算退化。
- **只有退化触发回退**：回退的代码改动丢弃，这次修补所针对的条目回到未修好状态：
  - 下一周期带着"上次修补被回退"的说明再送一次（`Sends.reopen`，每条每轮一次），之后按 Sends 的停送规则处理；
  - 台账里不再出现 `discarded`；
  - `cycle.reverted.resent` 记下重送的条目。
- **本轮出生的守卫没有"背后改动"**：`changedTextBehind` 对 `guard.round >= round` 返回空。
  - 这是在验收中发现的问题：R1 里每个守卫的对象都"本轮有改动"，分类放到回退之前后，R1 的真退化就永远不会回退。
  - block-accept 的回退测试（R1 守卫）在这条修好之前失败，修好后通过。

**验收**（R1–R3 真实原文；G77 用合成等价物：R2 的 zscore 句 R2.S11.P5.s3 用总体标准差，守卫按总体公式求值，派生值）
- **R3 记录了修订**（stub 归属 partial override）：
  - 修补引入样本标准差，G1 翻转，分类为 changed_text；
  - 下一次审查请求里有 G1 的问题，审查员替身答 SUPERSEDED，G1 退役；
  - reverted 0，过滤器的修补保留，最终保留的是最后一个周期。
- **R3 没有记录修订**（R3.S3 作为 add 归给 normalize，modification 0 条，同 15 轮 R3 的归属）：结果同上，由"守卫的对象本轮有改动"这一条判出。
- **原文未改、值是原文写明的（verbatim）**：修补把 sort 改坏，回退 1 次；过滤器条目带着说明重送；第三次修补修好；台账里没有 discarded。
- **原文未改、值是派生的**：sort 守卫翻转记为 disputed。reverted 0，没有送给执行方，下一次审查的线索里有它。
- **还缺的数据**：15 轮 R3 的真实状态没在分支上。拿到之后，用它重放 G77 那三次修补，确认走的是分类而不是回退。

**行为变化**：审查来源的守卫，期望值大多是 formalizer 派生的。按第 11 条，这类守卫在原文未改时翻转记为 disputed，交审查员确认，不直接送修、也不回退。block-accept 的 sort 守卫测试为此改用写明的值，保留"退化直接送修"那条路径的覆盖。

### 22.5 写检查：拒绝回告、覆盖义务降为报告项（第 7、3 条）

**做法**
- **拒绝回告**：`beginRoundChecks(round)` 把上一轮被程序当作未知子命令拒绝的库检查标为 stale，cause 为 `refused`。拒绝记录来自上一轮的 check_runs 和各周期运行。reason 写明程序怎么回答的，于是下一次写检查请求的 `stale` 里有它，模型重写这条调用。系统提示里 stale 的说明加了"或其调用被程序拒绝"。
  - 告知要到下一轮：拒绝只能在有程序之后才知道，而写检查在本轮开头。
- **覆盖义务**：`deriveChecks` 默认不再把 uncovered 当作问题退回，`acceptance.coverage_obligation: true` 可以恢复。本轮未覆盖的单位数进报告的 "Check writing" 一行（`checks.uncovered`）。`unitsOnce` 保留。

**依据**：第 5 次 R1 的 G1（rep1e K12）；rep1d、rep1e 每次写检查调用都被退回 13–15 条未覆盖（映射表第 4 节）。

**验收**：拒绝的 K1 在下一轮成为 stale/refused，reason 带程序的回答。七次重放的写检查计数与基线相同或更好（22.7）。

### 22.6 修订召回进报告（第 12 条）

**做法**：`revisionRecall(registry, round)` 统计三个数：本轮原文中像修订的段落（含 instead of、previously、no longer、now、formerly、rather than、replace、change），其中作为某条 modification 新文本被记录的段落，以及本轮 modification 的总数。没有被记录的提示段落列出 id。结果放在报告 `revisions`，渲染为 "Revisions recorded" 一行。

**验收**：
- R3 用 stub 归属时，R3.S3.P1 被记录为修订；
- 用"不记修订"的归属时，recorded 变少，R3.S3.P1 列在未记录里。

这个数是提示词的命中，不是判定：含 now 的段落未必是修订。

### 22.7 验收汇总

- **七次重放的接口计数**（第 20 节的基线）：`replay-baseline.test.ts` 通过，逐项相同或更好。
- **故障注入**：批次 C 的五种全部守恒（batch-c 测试通过）。
- **报告字段**：去掉 probes；新增的 `revisions`、`zones.source_*`、`checks.uncovered`、`measures.sources` 都是本批要求进报告的数。状态 schema 本批未改（批 3）。
- **离线测试**：见第 14 节第 1 步。

### 22.8 交接（会话额度用完时的状态，2026-10-23）

**已推送**：d5c31ce（重放基线）、48de051（批 4）。本节所在的提交是批 1，可以直接在本地接着做。

**本地还要做的**
1. 跑全量 `npm test`。会话里第二遍 exp2 测试：261 通过、1 失败，即 serial.test 的"interrupted by spent quotas and a crash…"。R1 第 2 条消息的额度注入在 review 流程里没有按预期停两次，需要换一个确实有第二条消息的轮次，或者调整等待次数的断言。全量预期是会话结果加上原有的 1 个失败（repair-batch "R3 original counterexample…"）。
2. 回写第 14 节第 1 步的预期数字；第 4 步的回放命令去掉 `--mode review`（该参数已删）。
3. G77 的真实重放：把 15 轮 R3 的真实状态（exp2-state.json 和 checkpoints）推到 origin/exp2-pure-ic。然后照 batch-1.test.ts 中 item 11 那组测试的写法，用真实的 guards、guard_events 和 R3 归属重放三次修补，确认翻转走的是分类而不是回退。
4. 冒烟：等 15 轮（all 档消融）跑完，本地排队跑真实 R1。看接口计数，加上 report.md 的 "Requirements given"、"Revisions recorded" 两行。
5. 未做、留给批 2：回放的 strict 列（前提降为记录）。

**新的配置项**：`acceptance.workorder_scope`（delta/all）、`review_scope`（delta/full）、`coverage_obligation`（默认 false）；`resume.environment_wait_ms`（批 4）。

### 22.9 批 1 收尾（本地，2026-10-24）

只动了测试、固定材料和本文件，`src` 未改。

**1. 全量 `npm test`（bcb3fbb，Windows 本机）**
- Go 不在 PATH：950 项，879 通过，1 跳过，70 失败。绝大多数是 `spawnSync go ENOENT`。
- Go 在 PATH：950 项，938 通过，1 跳过，11 失败。逐项归类：

| 失败 | 原因 | 类别 |
|---|---|---|
| block11 §4、block12 E1 两项 | 测试写死 `python3`，Windows 上是应用商店占位程序 | 环境 |
| block11 §1 批量脚本、block12 E4 docker 批量覆盖 | 测试用 `sh` 跑 batch.sh | 环境 |
| block10c 内存上限 | Windows 上没有常驻内存上限，20 秒超时先到 | 环境 |
| batch C effect 1 "the model hears what the script printed" | Windows 上 python 输出 `\r\n`，断言写的是 `\n` | 环境 |
| batch 4 "a review copy that cannot be made" | 路径的父级是文件：Linux 上 rmSync 报 ENOTDIR（"cannot be made"），Windows 上 rmSync 静默、mkdir 报 EEXIST（"cannot be cloned"）。两种都抛 `EnvironmentUnavailable`，只有消息不同 | 环境 |
| block12 E4 "selection omission" | 云端 Linux 上通过（会话结果 exp2 261/1）；本机与覆盖率构建有关 | 环境 |
| repair-batch "R3 original counterexample" | 缺 `development/validation/2026-09-24-repair-batch/turn-2-finding-counterexample.json` | 原有 |
| serial "interrupted by spent quotas and a crash" | 测试本身，见下 | 修了 |

- 另外，智能应用控制会随机拦截新建的 exe（`spawn UNKNOWN`），每次跑结果不同；把 TEMP 改到 D 盘也一样拦。所以本机的数只用来归类，门禁要看 Linux。

**2. serial 中断续跑测试**
- 现象：中断续跑的状态与不中断的状态比较时，有两处不同：
  - `reports[].measures` 的 tokens、`non_executor_cost`、`wall_ms`、`stages_ms`；
  - `review_calls[].session`。
- 原因：
  - 批 1 把额度注入挪到 R1 之后，R1 有了 measures。measures 按 §12i 计入被中断尝试的花费（`interrupted_management`、执行方多出的 1 次调用），时间本来就不同。这是设计如此。
  - 替身审查员的会话编号是每个进程的计数器，第二个进程从 1 重新数。
- 做法：`comparable` 把这些字段置空，其余逐字比较。中断花费的去向由同一测试后面的断言单独核对（R6、R12 的 `interrupted`）。
- 验证：dump 两份状态逐行 diff（4.8 MB JSON），除了上面两处没有别的差异。修好之后，本机重跑时出现第三种差异：R13 替身审查员报 2 条、而不是 1 条。原因是替身审查员在 Temp 里跑新建的 exe 被拦，退出 1，于是多报了一条，被 not_reproduced 挡下。这是环境问题，Linux 上应当不出现，**尚未在 Linux 上实测**。

**3. G77 的真实重放**（`test/exp2/g77-replay.test.ts`）
- 材料：`exp2/evidence/replay-2026-10-23/g77-ic15-r3/`，取自 origin/exp2-pure-ic 上 ic15-all-scope 的 R3（运行 exp2-ic15-luna56-low-rep1-20261023，代码 fe6562d）。包括：
  - R1–R3 的原文和归属（注册表由此重建）；
  - R1–R3 的检查和检查事件；
  - R1–R2 的 92 个守卫及其末状态；
  - R3 三次审查和四次 formalizer 的真实回复；
  - 四个真实程序：C3.1 work、C3.2–C3.4 三次修补的 main.go、go.mod，取自运行目录 app 仓库里的那些提交，被回退的提交也还在。
- 验收（本机 4/4 通过，用本地 Go 构建，在主机上跑）：
  - 材料就是那个案例：G77 在 R2 末尾是 passing；fe6562d 上三次修补都因 G77 回退。
  - `changedTextBehind` 给出修订记录：`R2.S11.P5.s1` 和 `R2.S11.P6.s4` 被 R3.S3.P1–P3 部分修订。
  - 在四个真实程序上跑 G77：pass、fail、fail、fail。
  - 整轮重放：执行方按顺序写入四个真实程序，审查和 formalizer 用真实回复。结果：
    - **reverted 0**，没有一个周期被回退；
    - G77 在 C3.2 翻转，记为 `flipped_changed_text`，事件里带着上面两条修订记录；
    - 执行方没有收到"reverted by the controller"；
    - 下一次审查请求里有 G77 的问题；
    - 本轮保留 C3.4，fe6562d 上保留的是 C3.1。
  - G77 在 C3.3、C3.4 上仍然失败。这时它已经处在"等审查员确认"的状态，不再算翻转。真实回复里没有 SUPERSEDED G77，因为原运行从没问过审查员，所以它没有退役。
- 同一次重放里的另一个观察：G84、G92 在首次交付 C3.1 翻转，记为 `flipped_disputed`。它们没有送修，也没有回退；原运行里是 `flipped_unchanged`。见 22.10。
- 边界：第 2、3 次审查的真实回复，原本是对 C3.1 写的（原运行回退了）。这里拿来用在 C3.2、C3.3 上，只作为条目的来源，不评价审查员。

**4. 第 14 节**：第 1 步的预期数字已回写；第 4 步的回放命令去掉了 `--mode review`。

### 22.10 与 DESIGN §6b（30724cd）的出入（待定，未改实现）

§6b 的权威表和守卫三条规则，对照批 1 现在的实现，有两处不一致：
1. **`changedTextBehind` 自己补判断**。除了修订记录，它还认两条：
   - 守卫依据的单位的对象本轮有改动（G77 的事件里第三条就是这个："O51 … changed this round"）；
   - 对象名出现在守卫的输入里。

   §6b 的权威表定了：句子有没有被取代，只读归属的修订记录。这两条属于"读的一方补判断"。G77 只靠修订记录就能分对。
2. **原文未改、只有派生值不符的翻转记为 disputed**：不送修，也不回退，只作线索交给审查员。§6b 守卫规则 1 写的是：句子没改、守卫翻了，就是退化，必须修回；派生值守卫的退役同样只走修订记录。按规则 1，ic15 R3 的 G84、G92 应当送修，在修补周期里翻转时应当回退。

## 22.11 小批 1b：翻转分类只读权威，派生值翻转按退化（DESIGN §6b，用户 2026-10-24 定）

**做法**
- **`changedTextBehind`（guards.ts）只读归属的三种记录**，每条结果带来源：
  - `revision`：本轮的修订记录与守卫依据的单位重叠，或者单位本轮起不再有效；
  - `object`：守卫单位所在的对象本轮有改动记录；
  - `edge`：一条关系边，一端在守卫上（与其单位重叠的块，或拥有其单位的对象），另一端是本轮被修订或撤回的原文。

  签名改为 `(registry, guard, round)`，不再需要检查库和守卫输入。
- **删除"对象名出现在输入里"这条推断**：`inputWords` 及其分支一起删掉。恢复方式：`git show 9abc73c:src/exp2/guards.ts`。
- **翻转分类（accept.ts）只剩两类**：有记录支持的，记为原文改过（`changed_text`），交审查员；没有记录支持的，一律算退化（规则 1），不看期望值是派生的、原文写明的还是算出来的。删掉的部分：
  - `how: "disputed"` 分支；
  - `flipped_disputed` 字段；
  - `GuardEvent.disputed`；
  - 审查请求里"翻转被 disputed 的守卫作为线索"那一段；
  - 已失败守卫"等审查员"判断里的 disputed 条件；
  - serial 带入时的 disputed 豁免；
  - `measures.regressions.disputed`；
  - 报告 Guards 行的 "disputed n"。

  恢复方式同上，取 9abc73c 的 accept.ts、serial.ts、report.ts、execution.ts。
- **每次翻转都记一条 `accept.guards.flips[]`**：`{ id, cycle, how, sources, expected }`。`sources` 为空即"无"；`expected` 是守卫断言的期望值来源（verbatim / derived / computed），照常记录。守卫事件另加 `behind_sources`。
- **报告新增一行**（`renderFlips`）：`Flip classification (source: revision record / object change / relation edge / none)`，先按来源计数（一次翻转被几种记录同时支持时，各计一次），再逐条列出：编号、周期、分类、来源、期望值来源。
- **未改**：
  - 回退分支照旧不往 `flipped_unchanged` 里记（原有行为）。被回退的翻转在 `flips[]` 和 `cycle.reverted.guards` 里能看到。
  - 有记录支持的翻转，审查员没答 SUPERSEDED 时仍送修（§12j.2）。

**依据**：DESIGN §6b（30724cd）的权威表第 1、2 行和守卫规则 1–3；22.10 列出的两处出入；ic15 R3 的 G84、G92（原运行判为原文未改的退化，批 1 改成了 disputed）。

**验收**（本机，Windows，Go 在 PATH 上）
- **G77 真实重放**（`g77-replay.test.ts`，5/5，连跑两次都通过）：
  - G77 在 C3.2 翻转，分类为 changed_text，来源是 `revision` 和 `object`（R2.S11.P5.s1、P6.s4 被 R3.S3.P1–P3 部分修订；O51 本轮有改动）；
  - reverted 0，保留 C3.4，与 22.9 的结果相同。
- **G84、G92**（同一次重放）：
  - `changedTextBehind` 对二者都返回空；
  - 在首次交付 C3.1 翻转，分类为 regression，来源为无，期望值来源分别是 computed、computed/verbatim；
  - 进入 C3.1 的修补单（`not_landed`，send），第一条修补消息里有二者。
- **K8 形状**（`block-accept.test.ts` 的 "batch 1b" 组，替身归属 R1–R5，真实原文）：
  - 守卫在 sort（R1.S3.P9.s2）上，R5 没有改 sort 的文字和对象；
  - 一份归属在 R1 记了一条边 `R1.S3.P9.s2 refers_to R1.S3.P24.s1`，R5 撤回了 sidecar 子句 `R1.S3.P24.s1.c3`；
  - **有边**：来源 `edge`；R5 sort 改坏后翻转，分类为 changed_text，审查请求里有 G1 的问题，SUPERSEDED 后不送修。报告行为 `edge 1, none 0; G1 C5.1 changed text (edge; expected verbatim)`；
  - **无边**：`changedTextBehind` 为空；分类为 regression，当周期送修，审查请求里不问 G1。报告行为 `edge 0, none 1; G1 C5.1 regression (none; expected verbatim)`。
- **派生值守卫**（`batch-1.test.ts` 的 "batch 1b (§6b rule 1)"）：
  - R3 修补把 sort 改坏，原文未改；
  - 翻转分类为 regression，来源为无，期望值来源 derived/verbatim；
  - 回退 1 次（`reverted.guards = [G1]`），原修补针对的条目带说明重送，第三个程序修好，保留 C3.3。不再作为线索交审查员。
- **block-accept §6**：两项（R5 撤回 sidecar 交审查员、R2 sort 退化直接送修）断言改成读来源，结果不变。
- 另：9abc73c 把 BLOCK-ACCEPT-NOTES.md、serial.test.ts、g77-replay.test.ts 误存成了 CRLF（编辑脚本在 Windows 上的换行转换），整文件都成了 diff。本批改回 LF，内容不变。
- **全量 `npm test`**（本机）：958 项，943 通过，1 跳过，12 失败，2 取消。
  - 9 项是 22.9 列过的环境失败。
  - 1 项原有：repair-batch。
  - 另 2 项（block11 §5、block9 "a hung or broken session"）的报错都是 `the host blocked … spawn UNKNOWN`。
  - block-accept 的 serial R1–R3（连带 2 项取消）在全量里 "stopped"，单独连跑两次都通过（2/2），同属主机拦截。
  - serial 中断续跑那项本次通过。

### 22.12 真实 R1 冒烟（rep1h，00a0a7f，delta 档）

运行目录 `D:\huawei\EvoCodeBench\harbor_runs\exp2-icacc-r1-luna56-low-rep1h-20261024`。配置照 rep1g，只改了运行编号、端口（46003/46004）、缓存键和 rounds（2，以便 R2 从 R1 检查点接着跑）。没有写 scope 项，delta 是代码的默认值。

| 达标项 | 结果 |
|---|---|
| 报 = 进 + 挡 | 32 = 31 + 1（挡下的 1 条是 input_claim_false）；核实 29，记日志 2，fallback 0 |
| 守恒 | yes |
| no_input | 0 |
| 准入 ≈ 入库 | 19/19；未告知 0；被拒调用 0 |
| 假守卫 | 无（被拒调用 0，没有靠被拒调用通过的守卫） |
| 守卫 | 0 → 28（库检查 10，审查 18）；翻转 0，回退 0 |
| 原文区 | delta，48 块 21,631 字符（R1 与 all 档相同）；审查请求 3 次，共 69,681 字符 |

- 状态 done，续跑 0 次，墙钟 1152 秒；3 次审查都有效；3 个修补周期用完，轮末 13 条未结。
- 分数只记录：首次交付 74，保留的 C1.4 为 146/219。rep1g（fe6562d，同一配置）是 56 → 187。
- R1 看不到的两项：
  - R2 工单原文区与 all 档的对比，要跑 R2；
  - "Flip classification" 一行，R1 没有翻转，所以没出现。

### 22.13 rep1h 续跑 R2–R3（00a0a7f，delta 档）

**做法**
- 从 R1 检查点续跑，`--to 3`，代码不变。只把配置的 rounds 改成 3。
- 第一次启动在读配置时就失败了：PowerShell 写文件带了 BOM。去掉 BOM 后重启，失败的那次没有调用模型。
- 设计会话 rep1g 留下的两个服务（45993/45994）已停。
- 结果：done，续跑 0 次。

**原文区字符数**
- "本运行 all" 是代码在同一工单上算出的全文字符数（`source_chars_all`）。
- 46,483 和 56,260 是 22.2 替身串行的 all 档；ic15 那次真实运行的报告里没有这个字段。

| 轮 | delta | 本运行 all | delta / all | 替身串行 all 档（22.2） | 审查请求合计 delta | ic15 all 档审查请求合计 |
|---|---|---|---|---|---|---|
| R1 | 21,631（48 块） | 21,631 | 100% | 21,326 | 69,681 | 72,838 |
| R2 | 42,836（157 块） | 54,212（188 块） | 79% | 46,483 | 123,563 | 148,677 |
| R3 | 29,516（73 块） | 64,934（206 块） | 45% | 56,260 | 86,692 | 169,113 |

- R2 的 delta 偏大，来源是未结条目依据的块。拿本运行的注册表重算本轮包、不带未结条目：R2 约 27k 字符（本轮 140 块 24.6k，对象有改动的 2 块，关系边相连的 6 块 2.0k）。工单里的 42.8k 多出的约 16k，是 R1 那 13 条未结条目依据的块。
  - `roundPackage` 按"包含该单位的已归属块"取，R1 的已归属块是整段，所以一条条目会带进整段原文。
  - 这里只记录，没改。

**R3 的翻转**（报告的 Flip classification 一行，原样）

`revision 2, object 3, edge 0, none 1; G42 C3.1 changed text (revision, object; expected derived), G51 C3.1 changed text (revision, object; expected derived), G59 C3.2 changed text (object; expected derived/verbatim), G72 C3.2 regression (none; expected derived)`

- 本运行没有 G77。zscore 那块的守卫是 G46（库检查，依据 R2.S11.P1–P7），R3 没有翻转。
- 与 G77 同型的是 G42、G51，都是 fill 的 linear 守卫：
  - R3.S2 部分修订了 R2.S13.P4.s4（边界外推）；
  - 首次交付 C3.1 上翻转，来源是修订记录 + 对象改动；
  - 审查员答 SUPERSEDED（"Round 3 now requires boundary extrapolation from the available lower anchor, so `6,40` is correct"），二者退役，没有送修，也没有回退。这是规则 2。
- G72 走的是规则 1：
  - 它是 R3 C3.1 刚产生的审查守卫（profile 统计量），本轮出生，背后没有改动；
  - C3.2 修补后翻转（disputed/reference，派生值），判为 regression；
  - C3.2 被回退，所针对的 6 条带说明重送。之后 C3.3、C3.4 没有翻转，保留 C3.4。
- G59 在同一个被回退的 C3.2 上翻转，来源只有对象改动（profile 本轮有改动，它依据的句子没改），分类为 changed text。
  - 这一周期整体回退了，所以它没有事件，也没被问到。
  - 回退分支不计入 `flipped_*`（原有行为），报告 Guards 行的 "flips on changed text 2" 不含 G59，Flip classification 行里有它。

**守恒**：三轮都是 "every entry ended once: yes"。

| 轮 | 报 | 进 | 挡 | no_input | 准入/入库 | 守卫 |
|---|---|---|---|---|---|---|
| R1 | 32 | 31 | 1 | 0 | 19/19 | 0 → 28 |
| R2 | 30 | 24 | 6（unit_not_in_force 5，input_claim_false 1） | 6 | 15/15 | 28 → 63 |
| R3 | 16 | 14 | 2（unit_not_in_force 1，not_reproduced 1） | 0 | 8/8 | 63 → 83 |

- R2 的 6 条 no_input，逐条看了 detail：线索、审查员会话的文件和命令、formalizer 三处都没有输入。它们都按原话退化送出（fallback 6）。
- 三轮被拒调用都是 0，未告知都是 0。

**非执行方成本**（§12i 口径：未缓存输入 + 0.1 × 缓存读 + 输出）

| 轮 | rep1h delta | ic15 all 档 | 其中审查员 delta / all | formalizer | 写检查 | 归属 |
|---|---|---|---|---|---|---|
| R1 | 0.487M | 0.491M | 0.338 / 0.286 | 0.081 / 0.099 | 0.051 / 0.080 | 0.016 / 0.025 |
| R2 | 0.658M | 0.603M | 0.451 / 0.334 | 0.099 / 0.144 | 0.070 / 0.095 | 0.038 / 0.031 |
| R3 | 0.862M | 0.691M | 0.578 / 0.447 | 0.188 / 0.148 | 0.053 / 0.066 | 0.043 / 0.030 |

- delta 没有省下非执行方成本。R2、R3 反而更高，差额基本都在审查员。
- 审查请求变小了（R3 86.7k 对 169.1k 字符），但审查员会话的缓存读更大。R3 第 1 次审查：delta 2.09M，all 0.91M；未缓存输入是 74k 对 51k。审查员的花费主要看它在会话里跑了多少轮工具，请求大小占得少。
- 两次运行的程序不同，会话长度也不同（rep1h R2 是 428/481，ic15 是 346/481），一次运行分不出因果。
- formalizer 和写检查在 R1、R2 低于 all 档。

**分数**（只记录）

| 轮 | rep1h：首次交付 → 保留 | ic15 all 档 |
|---|---|---|
| R1 | 74 → 146/219 | 112 → 149 |
| R2 | 207 → 428/481 | 191 → 346 |
| R3 | 505 → 507/535 | 389 → 389 |

## 22.14 批 1c：formalizer 读本轮包（带标注）

**做法**
- `buildFormalizeRequest` 多一个参数 `pkg`。给了它，`sources` 就是审查员读的那份本轮包，带上块编号：
  - 本轮原文整段，用 `annotate`；
  - 早轮的块用当前有效文本，被取代或撤回的句子换成 `⟦… replaced by …⟧`，块内标记与 `annotate` 相同；
  - 相邻块的拼接方式同 `packageSources`。

  不给（`review_scope: full`）时，照旧给全部轮次带标注的原文。材料照旧。
- 为此做了两处小拆分，行为不变：
  - `annotate` 拆成标记计算加区间渲染（`annotateRange`，source.ts）；
  - `effectiveText` 的切除计算拆成 `inForceCuts`（view.ts）。

  新增 `annotatedPackage`（view.ts）。
- 接线：serial 把审查用的本轮包（`roundPackage`，带入条目的单位）同时交给 accept（`deps.package`），accept 交给 `formalizeReview`。

**依据**：rep1h R3 的 formalizer 请求 75–102k 字符，其中 65,716 是全部轮次的带标注原文；同轮审查请求 25.6–35.6k（22.13）。

**验收**（重放 rep1h R3 的三次审查，材料与结果在 `exp2/evidence/replay-2026-10-23/formalize-1c-rep1h-r3/`）
- 重建核对：旧请求的三次首答逐字符重建，与记录相同（91,171 / 80,199 / 75,603）。材料取自审查员会话，R3.1 另有 11 条库检查线索。
- 程序：用审查时的程序（R3.1、R3.2 在 C3.1，R3.3 在 C3.3），docker 构建与运行，处置规则同 accept.ts。
- 旧版：记录下的 formalizer 回复，按同一脚本重放，结果与原运行一致（R3 合计进 14、挡 2）。
- 新版：新请求，真实调用 formalizer（gpt-5.6-luna-fast medium，4 次）。

**1. 请求字符数 ≤ 1.2 × 同轮审查请求：未达到。**

| 审查 | 审查请求 | 线（1.2×） | 旧请求（各次） | 新请求（各次） | 新 / 审查 |
|---|---|---|---|---|---|
| R3.1 | 35,564 | 42,676 | 91,171、102,171 | 48,580 | 1.37 |
| R3.2 | 25,564 | 30,676 | 80,199、91,939 | 37,608、51,542 | 1.47、2.02 |
| R3.3 | 25,564 | 30,676 | 75,603 | 33,012 | 1.29 |

- 新请求是旧请求的 41–53%，三次首答都超线。新版调用次数是 4，原运行是 5。
- 新请求的构成：
  - 带标注本轮包 24,634 字符：纯文本 19,353，标记约 5.3k，另有 JSON 转义；
  - 材料：R3.1 20,252（含线索）、R3.2 9,046、R3.3 6,465；
  - 审查回复 1–3k；
  - 第二次调用还加上一次的回答和问题，约 14k。

  只算本轮包和审查回复，R3.3 约 26.5k，在线以内。超线来自材料和第二次调用。审查请求里没有材料，所以这条线和本批做法放在一起，就只能靠压材料才达得到。本批没有动材料。

**2. no_input 和送修数：不变或更好。**

| 审查 | 旧：条目 / 送修（核实 + 原话） / 挡 / no_input | 新：条目 / 送修 / 挡 / no_input |
|---|---|---|
| R3.1 | 6 / 5（5 + 0）/ 1 unit_not_in_force / 0 | 7 / 7（7 + 0）/ 0 / 0 |
| R3.2 | 6 + 1 不成形 / 6（5 + 1）/ 1 not_reproduced / 0 | 7 / 6（6 + 0）/ 1 not_reproduced / 0 |
| R3.3 | 3 / 3（3 + 0）/ 0 / 0 | 3 / 3（2 + 1 原话）/ 0 / 0 |
| 合计 | 送修 14（核实 13），挡 2，no_input 0 | 送修 16（核实 15），挡 1，no_input 0 |

- R3.1：
  - 有一条审查条目被新回答拆成了两条，都复现了，所以新版是 7 条；
  - 旧版那条 unit_not_in_force，是因为旧请求给了已被取代的句子，formalizer 引了它。新版这条进了修补单，复现成立。
- R3.2：旧版有 1 条不成形（走原话），新版没有。
- R3.3：新版有 1 条没写出可解析的断言，按审查员原话送出，没有核实。旧版这 3 条都核实了。

**成本**：formalizer 在 R3 的非执行方成本，旧 187,839（5 次），新 83,666（4 次）。新的是一次重放，不是整轮运行。

**离线测试**：`batch-1.test.ts` 加了 "batch 1c" 一项（替身归属，真实原文 R1–R3）：
- 包里有 R3 全文；
- 早轮块带标记，被取代的句子不出现；
- 去掉标记后的文本与审查员拿到的逐字相同；
- 包外的块不出现；
- `pkg` 缺省时照旧给全部轮次。

**全量 `npm test`**（本机）：959 项，948 通过，1 跳过，10 失败。这 10 项正是 22.9 的 9 项环境失败加原有的 repair-batch，本次没有遇到主机拦截。

**用户决定（2026-10-24）**：1c 按现在的结果收，不压材料。
- 1.2× 那条线作废：它没算材料，而 no_input 为 0 靠的就是材料。
- 验收改为：formalizer 每轮的未缓存 token ≤ 同轮审查员的一半。R3 重放是 83.7k 对 191k，已过。
- "只给条目引用到的文件和命令"记为以后的优化候选；要做的话，须同时报 no_input 不变。

## 23. 串链块：审查与方案摘要（动手之前推送）

依据：DESIGN §6a 第 2、3、8 步，§6b 权威表，§6c（origin/exp2-pure-ic 2e40ce0）；CURRENT-STATUS-2026-10-24 §8 闭环清单；rep1h（22.12–22.14）。

### 23.1 现状对照 §6c（8708a37）

| §6c 要求 | 现在的代码 | 差距 |
|---|---|---|
| 视图：对象 × 轮次 → 一段原文，纯函数 | 没有对象视图。原文按块给：`effectiveText` 把被取代的句子换成 `⟦… replaced by …⟧`；amended 块（代码、表格）新旧都留，注 "where they differ, the newer text wins" | 要新写。§6c 第 5 条不许出现"新的为准"类标记，第 3 条要求被覆盖的句子原位换成新句、代码块和表格整块换 |
| 本轮包按对象组成：本轮对象 + 边一跳 + 未结条目所在对象 | 按块组成（`roundPackage`）：本轮对象的早轮块、一跳边连到的对象的块、"包含未结单位的已归属块" | 改为按对象，每个对象给视图；标注带入原因；加上限 |
| 保护区 = 包内对象上的守卫列表 | 工单的 protect 区仍是旧规则（"已落地对象 + 共享锚点"），review 流程下一直为空；守卫没进工单 | 改为守卫列表：命令、输入文件名、当前输出摘要、依据句编号 |
| 上限：本轮原文的 3 倍，超限按序取舍并计数 | 无上限 | 要新加 |
| 审查请求正文 = 包内对象视图，不含守卫列表 | 正文是 `packageSources`，按块拼接，带 replaced-by 标记 | 改用视图 |
| 附录：本轮新增/修订的单位编号；翻转守卫（新旧句）；线索 ≤ 20，按覆盖缺口优先 | 附录引的是被修订的旧句原文；翻转守卫一段已有；线索不限条数，按出现顺序 | 第 1、3 项要改 |
| "没有新发现" = 无条目存活到送修；去重按（依据句，输入） | `lastReviewFound = survivors.length > 0`；`keyOf = (blocks, input)` | 已符合，不动 |
| 报告：修订召回（对 revision-gold）、关系召回（对 xref-gold）、翻转来源 | 有翻转来源一行（1b）。"Revisions recorded" 只是提示词命中（22.6），不对标准答案。没有关系召回 | 两行要新写 |
| `intent-exp2-attribute` | 没有 | 要新写 |

### 23.2 方案

**效果 1：视图** `objectView(registry, object, round): string`（view.ts，纯函数，按注册表实例和对象版本缓存）
- 取该对象在 ≤ round 各轮归属到它的块，按轮次、原文顺序排列。另外，改它块的那些修订，其新块（`m.by`）即使属于别的对象，也在新块自己的位置出现（第 2、4 条：替换的新块、撤回带来的新义务）。
- superseded / withdrawn 的块不出现。
- partially_modified 的块：
  - 被覆盖的单位（句、列表项、子句）原位换成覆盖它的新单位。一条修订覆盖了几处，新文本放在第一处，其余几处删掉；
  - 原位用过的新单位，不在它自己的位置再出现一次。
- amended（代码块、表格）：旧块不出现，整块由新块替换（这是行为变化，见 23.4）。
- 每段连续同路径的块，前面一行标题路径，如 `## R2 › Transform operations › fill`。
- 编号：段落前一行 `⟦R2.S13.P4⟧`（不带 hash）；段落或句子有多个单位时，用 `‹s2›` / `‹s2.c1›`；原位换进来的新单位用全编号 `‹R3.S2.P1.s1›`。
- 不出现 replaced by、amended、"新的为准"之类的字样。
- 执行方、审查员、formalizer 读同一份渲染（§6b：对象现在要求什么，唯一主人是视图）。formalizer 改读视图，1c 的 `annotatedPackage` 由视图取代。

**效果 2：本轮包** `roundPackage(registry, round, open)` 改为按对象
- 对象集合：
  - 本轮有改动记录的对象；
  - 早轮对象：归属关系边（refers_to、applies_to，round ≤ n）与本轮对象一跳相连的；
  - 未结条目依据句所在的对象。
- 不走两跳，不补推断。
- 顺序：本轮对象在前；早轮对象在后，标注 `早轮，因 <边 from→to kind> 带入` 或 `早轮，因未结条目 <id>`。
- 守卫列表：依据句在包内对象上的活守卫。每条给编号、命令参数、输入文件名、当前输出摘要（退出码，加断言读的目标的前 200 字符）、依据句编号，不给期望值。
  - 当前输出取本轮开头在基线程序上跑一批这些守卫，代码运行，不花 token；
  - 现在只有未结守卫在轮初跑基线，这里扩大到包内的守卫。
- 上限：本轮原文的 3 倍。超限时按序去掉：先去 refers_to 带入的早轮对象（现有边种里只有它对应"depends_on 类"），再去守卫列表的输出摘要。本轮对象和未结条目的对象不去。超限次数和去掉了什么进报告。
- 工单：
  - 原文区 = 包内对象的视图；
  - protect 区 = 守卫列表，替换旧的"已落地对象 + 共享锚点"规则；
  - 锚点区只留任务对象；
  - 未结条目照旧附在工单后面（carried）。
  - 恢复方式：`git show 8708a37:src/exp2/workorder.ts`。

**效果 3：审查请求**
- 两句指令照旧（对照组原文）。
- 正文改为包内对象的视图，按"本轮 / 早轮"两组排列，不含守卫列表。
- 附录三段：
  1. 本轮新增/修订的单位编号列表，替换现在引旧句的那段；
  2. 翻转的守卫，同现在的写法（命令、输入、期望与实际、改动前后的句子）；
  3. 线索最多 20 条：依据单位没有守卫覆盖的排前，其余按编号；被截掉的条数进报告。
- 第 4 条（"没有新发现"、去重）现已符合，不动。
- `review_scope: full` 的消融路径不动。

**效果 4：报告三行**
- 标准答案文件：把 `revision-gold.json` 和 `xref-gold.json` 复制到开发分支 `exp2/evidence/corpus-scan-2026-10-23/`。
- 题目名由配置给出：`measure.gold_task`（dpipe = deterministic-data-pipeline-go，lsm = lsm-kvstore-engine）。没有配置时，这两行写"no gold set"。
- 定位：标准答案里的句子，按去掉 markdown 后的子串，在第 r 轮原文里找到所在的块；`earlier_quote` 同样在 `earlier_round` 里找。找不到的计为"无法定位"，单独列出，不算漏。
- **修订召回**：一条标准答案算命中，要求本轮有一条修订记录满足两点：`by` 与该句所在块的祖先或后代重叠；`parts` 与引文所在块的祖先或后代重叠。
  - 报告给段落级召回 n/m 和未命中的编号；
  - 句级精度 = 本轮修订记录里 `by` 落在某条标准答案句上的条数 / 本轮修订记录总数。
- **关系召回**：一条标准答案算命中，要求有一条归属边（round = r），一端是该句所在块的祖先或后代，另一端是引文所在块或其所属对象，方向不论，边的种类也不论。
  - 报告给 n/m，并按标准答案的种类（same_rules、same_format、uses_output_of、extends、depends_on）分列命中数。
  - 不量精度：标准答案集没有标负例。
- 替换现在的 "Revisions recorded" 提示词行，提示词计数移进 report.json。
- 翻转分类来源一行已有，不动。

**效果 5：** `intent-exp2-attribute --config <local-config> --inputs <dir> --to <round> --out <dir> [--gold-task <name>]`
- 只跑归属。用配置里的管理服务和模型，每轮最多 1 + 修补次数次调用；状态写在 out 目录的新 store 里。
- 输出 `attribute.md` / `attribute.json`：每轮的修订记录（单位 → 新单位、种类）、边（from、to、kind），以及修订召回、修订精度、关系召回三个数。
- `--config` 是我加的：没有它，CLI 不知道连哪个模型服务。

### 23.3 验收（照消息）

- **rep1h R1–R3 真实状态离线重放**：
  - 用 rep1h 的归属重建注册表；
  - 算出 R2、R3 的包，逐个核对包内对象符合规则（本轮对象 / 一跳边 / 未结条目）；
  - 工单原文区不出现 replaced by、amended 等标记；
  - G42、G51 的 `changedTextBehind` 仍为修订记录 + 对象改动。
- **一次真实 3 轮 delta 运行**（新目录 rep1i，新端口）：
  - R2、R3 原文区只含规则允许的对象；
  - G42/G51 同型的翻转判"原文改过"、不回退；
  - 三轮守恒；
  - 每轮非执行方成本低于 0.487 / 0.658 / 0.862M；
  - formalizer 未缓存 ≤ 审查员的一半（1c 的验收线）；
  - 报告有三行。
- **lsm-kvstore**：`intent-exp2-attribute --to 8` 跑出修订召回和关系召回两个数。约 8–24 次管理调用。
- **离线**：
  - 视图规则各写一个人造样例：部分修订原位替换、列表项、代码块、撤回带新义务、标题路径、无标记；
  - 包的上限和取舍顺序；
  - 线索截断；
  - 两个召回在 dpipe R1–R3 替身归属上的数。

### 23.4 待定（请用户定）

1. **边的种类**：现有只有 refers_to、applies_to；标准答案集有 5 种，§6c 提到第 13 块加的 same_rules 等。本块不改归属的边种（不改归属提示词和 schema）。
   - 关系召回不分种类地量，按标准答案的种类分列；
   - 包上限的"depends_on 类"暂对应 refers_to。

   加边种算归属的改动，放到第 13 块。
2. **amended 的行为变化**：代码块、表格被修订后，视图里只留新块，旧块不出现（§6c 第 3 条"整块换"）。现在是新旧都给，以新的为准。
3. **守卫当前输出**：轮初在基线上多跑一批包内守卫，取输出摘要，不花 token，有一次 docker 批量运行的时间。
4. **formalizer 改读视图**：1c 的带标注本轮包由视图取代，formalizer 的请求会随视图变化。真实运行里按 1c 的新线（未缓存 ≤ 审查员一半）再量一次。
5. **成本线的风险**：rep1h 的非执行方成本主要在审查员会话的工具活动（22.13）。视图让请求更短，但不一定能让审查员会话变短。3 轮运行里这条可能不成立，成不成立都照实报。

### 23.5 用户决定（2026-10-24）

1–4 按方案定：
- 边种不改，关系召回不分种类地量，新边种归第 13 块；
- 代码块和表格被修订后，视图只留新块；
- 轮初在基线上跑包内守卫，取当前输出摘要；
- formalizer 改读视图，按"未缓存 ≤ 审查员一半"再量。

第 5 点改成本口径。闭环验收 d 分两项报：
- (i) 审查请求字符数，以及 formalizer、写检查、归属三者的未缓存 token 之和：每轮低于 rep1h 同轮；
- (ii) 审查员的 token 照实报，不设线（审查员会话里的工具活动两组一样，不是 IC 能省的）。

整体非执行方成本仍进 §12i，但不在闭环验收里卡。

### 23.6 串链块：做法与离线验收

**做法**
- **视图**：`currentView(registry, object, round)`（view.ts）是纯函数，按（对象，轮次，注册表改动数）缓存。规则：
  - 对象在 ≤ round 各轮归属到它的块，按轮次、原文顺序排列；整块被取代或撤回的不出现；
  - 被修订的单位原位换成修订它的新单位，各带全编号 `‹R3.S2.P2›`，新单位不在自己的位置重复出现；一个单位被两条修订覆盖时，两条的新文本都放进去；新单位是列表项时一项一行；
  - 撤回的单位删去，代码块和表格被修订时旧块删去。撤回或修订它的新文本在自己那一轮的位置出现，不管它归哪个对象；
  - 路径变化处一行 `## R2 › Extended transforms › Fill …`（去掉 markdown 的 #）；
  - 段落编号 `⟦R2.S13.P4⟧`，不带 hash；单位标记同 `annotate`；
  - 块切完后没有自己的正文的，不出现；
  - 没有 replaced by、amended、"新的为准"这类字样。
- **本轮包**：`roundPackage(registry, round, open)` 改为按对象组成，即本轮有改动记录的对象、一跳边连到的早轮对象、未结条目单位所在的对象。每个对象给视图，标注带入原因（边或条目编号）。
- **守卫列表**：serial 在轮初把依据句落在包内对象上的活守卫在基线上跑一批。列表给编号、命令、输入文件名、当前输出（退出码加断言读的目标，各截 200 字符），不给期望值。
- **上限**：`fitPackage` 的上限是本轮原文的 3 倍。超了先去只由 refers_to 带入的早轮对象，从后往前；再去守卫输出；本轮对象和未结条目对象不去。超限的情况进报告。
- **工单**（delta）：原文区 = `renderPackage`；保护区 = 守卫列表；锚点区只留任务对象。all 档不变。
- **审查请求**（delta）：`reviewRequestOn`。两句指令照旧，正文是包内对象的视图，不含守卫列表。附录里本轮新增/修订单位的编号列表，替换原来引旧句的那段；翻转守卫一段照旧；线索最多 20 条（`pickLeads`：依据单位没有守卫覆盖的排前，其余按编号），截掉的数进报告。full 档不变。
- **formalizer**：`sources` 读审查员的同一份正文（`deps.body`）。1c 的 `annotatedPackage` 删掉。
- **报告**：
  - "Requirements given" 一行加上包的对象数（本轮 / 边 / 未结条目）、守卫数、超限与取舍、截掉的线索数；
  - 原来的提示词行 "Revisions recorded" 换成两行：Revision recall、Relation recall（`gold.ts`，配置 `measure.gold_task`，没有配置时写 "no gold set"）。提示词计数仍留在 report.json 的 `revisions` 字段；
  - 标准答案文件从设计分支复制到 `exp2/evidence/corpus-scan-2026-10-23/`。
- **召回的口径**：
  - 标准答案句按词（去掉 markdown 和列表符号后的子串）定位到最小单位，找不到的另计，不算漏；
  - 修订：同轮一条修订的新单位落在答案句的段落里，并且被改部分落在引文的段落里，就算命中。精度 = 本轮修订记录里新单位落在答案句段落上的条数 / 本轮修订记录总数；
  - 关系：同轮一条边连接答案句段落与引文段落（或引文所属对象），不论方向、不论种类，算命中；答案句被归给引文所属对象（扩展记为归属），也算命中。两种分开计数，按答案的种类分列。
- **`intent-exp2-attribute --config --inputs --to --out [--gold-task] [--gold-dir]`**：`attribute.ts` 加上 CLI。只跑归属，可以续跑；输出 attribute.json 和 attribute.md，每轮的修订、边、两个召回和精度，另有全部轮次的合计一行。

**删除**（恢复方式：`git show 621d48c:<路径>`）
- view.ts：`effectiveText`、`inForceCuts`、`annotatedPackage`、`PackageBlock`、`packageSources`，以及按块的 `roundPackage`；
- 工单 delta 档的旧 protect 规则（"已落地对象 + 共享锚点"）；delta 档原文区的按块渲染；
- formalizer 的 `pkg` 参数（改成 `body`）。

**离线验收**（`chain.test.ts` 11 项，batch-1 改写 3 项，替身归属，真实 dpipe 原文）
- 视图：
  - 列表项部分修订（fill，R3 对 R2.S13.P4.s4）：新段落在原处，各一行，只出现一次，R2 的视图里照原样；
  - 撤回子句（R5 对 R1 sidecar）：子句不见了，撤回它的 R5 句子在 R5 路径下；
  - 标题路径一行、不重复，纯函数；
  - 代码块被修订（人造修订记录，没有替身轮次修订代码块）：旧块不出现；
  - zscore（R3 部分修订 R2.S11.P5.s3）：样本标准差的句子原位替换。
- 包：每个对象的带入理由都对得上，本轮对象在前；上限取舍的顺序；守卫列表不含期望值。
- 审查请求：正文是视图；有本轮单位编号；没有引旧句的段落，也没有守卫列表。
- 线索：25 条留 20 条，未覆盖的在前。
- 召回（替身归属）：R3 修订召回 4/4，精度 2/3；R2 关系召回 4/5（边 1、同一对象 3），漏的是 aggregate 的 same_rules。
- `attributeOnly` 跑替身 R1–R3：三轮 accepted，有输出；续跑时不再调用模型。
- 替身串行 R1–R3：工单原文区 23.4k / 35.6k / 25.6k，all 档 21.3k / 46.5k / 56.3k。审查请求合计 48.4k / 37.4k / 29.0k，full 档 39.2k / 45.3k / 56.7k。

**rep1h R1–R3 真实状态离线重放**（真实归属重建的注册表、真实带入条目；守卫输出用 150 字符的占位）

| 轮 | 包内对象（本轮 / 边 / 未结条目） | 正文字符 | 守卫列表 | 上限（3×本轮原文） | 审查请求正文（不含线索） | rep1h 各次审查请求 | rep1h 工单原文区 |
|---|---|---|---|---|---|---|---|
| R1 | 17 / 0 / 0 | 23,086 | 0 | 56,406 | 23,591 | 27,354、20,858、21,469 | 21,631 |
| R2 | 14 / 1 / 5 | 42,307 | 9 条 3,560 | 73,800 | 44,101 | 47,573、39,289、36,701 | 42,836 |
| R3 | 8 / 0 / 5 | 34,847 | 21 条 5,497 | 28,308 | 35,631 | 35,564、25,564、25,564 | 29,516 |

- 包内每个对象都是本轮对象、一跳边连到的对象或未结条目所在的对象。R2 的 O6 同时由边 R2.S10.P3 refers_to O6 和两条未结条目带入。
- 三轮正文里都没有 replaced by / amended / 新的为准类字样。
- G42、G51 的 `changedTextBehind` 仍是修订记录 + 对象改动。
- **预计不达标的一项**：闭环验收 d(i) 里的"审查请求字符数每轮低于 rep1h"，R2、R3 大概率不成立。
  - R3 正文 34.8k，超过 3 倍上限 28.3k，裁不下来：超出的部分来自 5 个未结条目带入的整个对象（O7 transform operations 3.9k 等），§6c 第 5 条不许去它们；
  - R1 正文比原文多约 7%，是单位编号标记（§6c 第 5 条要求每句带编号）；
  - 按块组成时 R3 是 29.5k，因为未结条目只带依据的块。

  另一项 formalizer、写检查、归属三者的未缓存 token 之和预计会降，因为 formalizer 不再读累计全文。真实 3 轮运行里实测。

**全量 `npm test`**（本机）：970 项，955 通过，1 跳过，14 失败。其中 10 项是已知的（9 项环境 + repair-batch）；另 4 项是本块改了报告和工单格式后的旧断言，已改。改后单独跑全部通过：batch-1 2/2、block-accept 1/1、serial 6/6。

### 23.7 闭环验收：真实 3 轮 delta 运行（rep1i）与 lsm-kvstore 归属

**运行**：`D:\huawei\EvoCodeBench\harbor_runs\exp2-icacc-r3-luna56-low-rep1i-20261024`，代码 6fc2aea（串链块 b8059ee）。配置照 rep1h，改了端口 46005/46006、缓存键、rounds 3，加了 `measure.gold_task: deterministic-data-pipeline-go`。结果 done，续跑 0 次。报告、分数、measures 复制在 `exp2/evidence/chain-2026-10-24/rep1i/`。

| 项 | 结果 | 判定 |
|---|---|---|
| a 包内对象只含规则允许的 | R2 24 个对象（本轮 14、边 6、未结条目 4），R3 22 个（8、4、10），逐个核对带入理由，0 个不符；正文没有 replaced by / 新的为准类字样（离线重放核过） | 成立 |
| b G42/G51 型翻转 | R3 的 G22（fill linear，R3.S2 部分修订 R2.S13.P4.s4）在 C3.1 判为原文改过（修订记录 + 对象改动），审查员答 SUPERSEDED，退役，没有回退 | 成立 |
| c 三轮守恒 | R1 报 33 = 进 23 + 挡 10；R2 31 = 27 + 4；R3 23 = 20 + 3；三轮都是 "every entry ended once: yes" | 成立 |
| d(i) 审查请求字符数，每轮低于 rep1h | 79,519 / 159,593 / 182,915，rep1h 是 69,681 / 123,563 / 86,692 | **不成立**（三轮都更高） |
| d(i) formalizer + 写检查 + 归属的未缓存 token，每轮低于 rep1h | 117,786 / 189,606 / 242,340，rep1h 是 105,409 / 158,123 / 246,499 | **不成立**（R1、R2 更高，R3 低 1.7%） |
| 1c 线：formalizer 未缓存 ≤ 审查员的一半 | 67,382 ≤ 72,083；**110,308 > 82,350**；114,526 ≤ 117,237 | R2 不成立 |
| d(ii) 审查员 token（照实报） | 未缓存 144,166 / 164,700 / 234,474，缓存读 2.30M / 2.24M / 4.79M，输出 19k / 12k / 17k（rep1h 是 126k / 174k / 191k 未缓存） | 只报告 |
| e 报告三行 | 三轮都有 Revision recall、Relation recall 两行；Flip classification 在有翻转的 R2、R3 出现（R1 没有翻转） | 成立 |
| 效果 5：lsm-kvstore 归属 | 8 轮全部 accepted，14 次调用。修订召回 4/4，修订精度 7/16，关系召回 5/8（同类漏掉的是 depends_on 2 条、same_rules 1 条）。输出在 `exp2/evidence/chain-2026-10-24/lsm-kvstore-attribute/` | 两个召回数已跑出 |

- dpipe 的召回：R2 关系 4/5；R3 修订 2/4（漏掉 R3.S2.P3、R3.S3.P1 两段），关系 5/5。rep1h 的 R3 修订按同一口径是 3/4。
- 分数（只记录）：首次交付 → 保留，R1 103 → 125，R2 346 → 346，R3 438 → 485；rep1h 是 146 / 428 / 507。

**d 不成立的原因（按因果链）**

1. **R2 的三次修补全部被一个错误守卫回退。**
   - G29 是写检查模型写的库检查 K34（compare 命令），在首次交付 C2.1 上通过，自动成了守卫。
   - 它的断言 `compare-ignore-and-tolerance` 读的是 `/changes/1/diff`，即变更列表的第 2 项。首次交付的顺序是错的（added、modified、removed），第 2 项恰好是 modified，带 `["value"]`。原文 R2.S23.P1 要求 added、removed、modified，按这个顺序第 2 项是 removed，没有 diff。
   - 审查员三次报了这个顺序错误（V2.1.13、V2.2.6、V2.3.9）。每次修补把顺序改对，G29 就翻转；原文未改，按 §6b 规则 1 判退化，回退。
   - 结果：三次修补全部丢掉，R2 保留首次交付（346）。R3 首次交付 G29 又翻转，作为退化送给执行方；执行方没改回去，之后停送。
   - 这是 1b 采用规则 1 之后，"未经确认的库检查一通过就成守卫"的后果，不是串链块的改动带来的。
2. **R2 的回退留下大量未结条目，R3 的包因此变大。**
   - R3 带入 33 条未结条目，包里有 10 个"未结条目带入"的对象；正文 55.6k，超过 3 倍上限（28.3k）而且裁不下来，因为 §6c 第 5 条不许去未结条目的对象。
   - 三次审查请求合计 182.9k，rep1h 是 86.7k。
3. **按对象组成本身就比按块大。**
   - 未结条目带入的是整个对象，不只是依据的块（rep1h 状态离线重放时 R3 已经是 34.8k 对 29.5k，见 23.6）；
   - 每句带编号（约 +7%）；
   - R1 的两条 applies_to 边（R1.S6.P2、R1.S8.P1 → O2、O3、O18、O19），在 pipeline 每轮都有改动时，每轮都把这 4 个对象带进来。
4. **formalizer 的输入随审查请求一起变大**（它读的就是审查员的正文）。R2 比 rep1h 多 27k 未缓存，超过了审查员的一半。

**其他观察**
- R1 被 input_claim_false 挡下 9 条：都出自第 2 次审查，共用一个输入文件 review-data.csv，formalizer 声称 1 个空单元格，解析出来是 2 个。这条前提按 §12j.3 要在批 2 降为记录。
- 翻转来源（R2、R3）：G29 来源为无，判退化（4 次）；G22 来源为修订记录 + 对象改动。

**待用户定**
1. **G29 这类守卫**：库检查（hypothesis）一通过就成为守卫，期望值是派生的，而且依赖程序当时的输出形状（列表位置）。按规则 1，它会把错误的行为锁住，让正确的修补被回退。可选的做法有三种：
   - (a) 只有审查员确认过的条目修好后才成守卫，库检查不再自动成守卫，只当线索。这是 §12j.1 表里 guard 定义的收紧；
   - (b) 库检查成守卫要等审查员看过一次它所在对象；
   - (c) 规则不变，靠审查员在翻转时说明。现在原文未改的翻转不问审查员。
2. **闭环验收 d(i)**：按 §6c 的规则，包按对象组成、未结条目带入整个对象、每句带编号，审查请求不会比按块小。上限按 §6c 第 5 条也裁不掉未结条目的对象。这条验收是保留，还是改为同一运行内对比 all 档，还是 §6c 第 1、5 条对未结条目的范围再定？

## 24. 回退的周期不留守卫编号

**现象**：rep1h R4（设计会话续跑，代码 1c）停在 C4.4，`store.recordGuards` 抛出 "guard G100 is out of sequence (next is G90)"。现场在 origin/exp2-pure-ic 的 `exp2/evidence/real-runs-2026-10-23/rep1h-delta-r1-r3/exp2-state.crashed-R4.json`。

**原因**：accept.ts 的每个周期里，先给通过的库检查分配守卫编号（`nextGuard++`），再判是否回退。周期被回退时，这些守卫不记录，编号计数器却没有退回。C4.2、C4.3 两次回退共占掉 10 个编号，C4.4 出生的第一个守卫是 G100，而 store 里下一个是 G90。

**做法**（accept.ts，两行）：分配编号前记下计数器（`firstGuard`）；回退分支里把它退回（`nextGuard = firstGuard`）。回退分支本来就不记录、不发事件，所以回退的周期既不留守卫，也不留编号。审查条目修好后出生的守卫只在不回退的分支里，不受影响。

**验收**
- **崩溃现场重放**（`test/exp2/revert-ids-replay.test.ts`）：
  - 固定材料在 `exp2/evidence/replay-2026-10-23/revert-ids-rep1h-r4/`：R1–R4 归属、检查、R1–R3 的 85 个守卫、R4 三次真实审查和五次 formalizer 回复；四个真实程序 C4.1–C4.4（e671bf5、4be6dcc、bd5fe4a、23e4ab3），取自运行目录的 app 仓库，被回退的两个提交还在；
  - 守卫经真实 store 的 `recordGuards` 记录，与原运行相同。
  - 结果：C4.1 出生 G86–G89（与崩溃现场一致）；C4.2、C4.3 被回退，出生 0；C4.4 出生 G90–G97，紧接 G89。store 里的守卫编号 G1–G97 连续，整轮跑完。
  - 去掉这两行修复再跑，重放复现原错误 "guard G100 is out of sequence (next is G90)"。
- **替身测试**（`batch-1.test.ts`，"a reverted cycle leaves no guard id"）：
  - R3 的 sort 守卫 G1，加一条 filter 库检查 K1；
  - 第一个程序 filter 错，K1 失败；
  - 第二个程序修好 filter，但把 sort 改坏。K1 在这个程序上第一次通过，同一周期 G1 翻转（原文未改），周期被回退；
  - 第三个程序都对。
  - 结果：回退周期出生 0 个守卫，下一周期 K1 出生为 G2。记录回调逐个核对编号连续。去掉修复时，出生的是 G3。
- 乱路径文件的清理是单独一个提交（42eebfd）：删掉 36 个文件，`.gitignore` 加 `/C<U+F03A>*`。
- **全量 `npm test`**（本机）：972 项，959 通过，1 跳过，12 失败。其中 10 项是已知的（9 项环境 + repair-batch）；另 2 项（block11 §5 参考值裁决、变异测试）的报错都是 `the host blocked … spawn UNKNOWN`。

## 25. 本轮包改造批（DESIGN §6c "本轮包的修订"，设计分支 27239e1；用户 2026-10-25 晨定；设计会话答 Q1–Q4）

### 25.1 P1：包按段组成

**做法**（view.ts）
- 包的组成单位从对象改为段（`RoundPackage { segments, heads, comparisons, edges }`）。一段 = 一个段落或节，带对象、理由、来源、标题路径和当前文本，每段只出现一次。理由的优先序：本轮 > 本轮修订 > 边 > 未结条目。
  - **本轮**：本轮归属块所在的段（`contextOf`）。对象首次出现的那一轮，它的段就是它的全部文本。
  - **本轮修订**：本轮修订记录（`m.round = n`）里被改单元所在的早轮段，按当前有效文本给（新句原位，带编号）。段末另起一行 `earlier text of <id>: <旧句原文>`（Q1）。同对象的其余早轮段不给。
  - **边**：只取本轮记录的边（`e.round = n`）。指向块的，给那一段；指向对象（`O#`）的，只给一行对象头 `### O5 … — referred to by <来源块>, text not brought`（Q2，不退回对象视图，不做标识符匹配）。对象已有段的不再出对象头。早轮之间的常驻边不再带。
  - **未结条目**：只给条目单元所在的段。
  - applies_to 的目标对象本轮没有自己的块时，本轮段为空（Q4）。
- 渲染：按对象分组，对象头 `### O3 …`；连续几段的标题路径和理由相同时，只出一行 `## R2 › … — <理由>`。
- 预算：`fitPackage` 改为绝对 40,000 字符（`PACKAGE_BUDGET`）。超了先去边带入的段，从后往前；再去未结条目的段；本轮段和本轮修订段不去。
- 报告的 "Requirements given" 一行：段数和对象数、各理由的段数与字符数、对象头数、本轮边指向块和指向对象的条数（Q2 的计数）、预算超限情况。
- 本块保留了工单 Protection zone 的守卫清单，P2 删。

**删除**（恢复方式：`git show ab190b9:src/exp2/view.ts`）：按对象组成的 `roundPackage`、`PackageObject`、`packageHeader`；按 3 倍本轮原文裁对象和守卫输出的 `fitPackage`。

**rep1j 六轮重放**（`exp2/evidence/package-2026-10-25/replay-package.mjs`，P1 的代码；守卫交付列在 P2 一节）

| 轮 | 本轮原文 | 线（2×+10k） | 包字符（rep1j） | 本轮 / 修订 / 边 / 未结条目 | 段 | 对象（rep1j） | 对象头 | 边：块 / 对象 | 利用率·对象（rep1j，同口径） | 利用率·段 | 引用对象在包内 |
|---|---|---|---|---|---|---|---|---|---|---|---|
| R1 | 18,802 | 47,604 | 22,518（22,490） | 21,976 / 0 / 0 / 0 | 10 | 9（9） | 0 | 0 / 4 | 44%（44%） | 40% | 4/4 |
| R2 | 24,600 | 59,200 | 38,943（48,781） | 29,829 / 5,213 / 0 / 2,726 | 38 | 5（8） | 0 | 0 / 1 | 60%（50%） | 26% | **3/4** |
| R3 | 9,436 | 28,872 | 24,795（54,789） | 11,219 / 1,980 / 0 / 10,424 | 31 | 6（8） | 0 | 0 / 3 | 33%（25%） | 6% | 2/2 |
| R4 | 4,770 | 19,540 | 9,365（45,653） | 6,008 / 0 / 0 / 3,072 | 8 | 4（6） | 0 | 0 / 0 | 50%（33%） | 13% | 2/2 |
| R5 | 4,307 | 18,614 | 12,970（50,263） | 5,178 / 2,796 / 0 / 3,687 | 19 | 7（7） | 0 | 0 / 4 | 14%（14%） | 5% | 1/1 |
| R6 | 3,322 | 16,644 | 11,256（55,086） | 4,050 / 0 / 0 / 6,086 | 14 | 6（9） | 3 | 0 / 4 | 33%（22%） | 14% | 2/2 |

- R2 超过预算（45,553），按序去掉了 7 个未结条目段（R1.S3.P12–P19）。
- R2 不在包内的引用对象是 O2（ingest）。rep1j 里它是由 R1 的 applies_to 边 "R1.S6 applies_to O2" 带进来的，新规则不再带早轮的常驻边。
- rep1j 的边全部指向对象（每轮 0 条指向块），所以没有边带入的段，只有对象头。
- 基线利用率用的是同一脚本、同一口径（Q3）：分子是当轮所有审查中 disposition = sent 的条目，按单元归属得到的对象。算出来是 44 / 50 / 25 / 33 / 14 / 22%，设计会话手工算的是 44 / 50 / 25 / 17 / 29 / 11%，以脚本为准。
- 离线测试：`chain.test.ts` 11 项、batch-1 相关 4 项（R1 全是本轮段；R2、R3 每段理由对得上，本轮段全在，每段一次，边计数等于本轮边数，工单与预算后的包一致；预算的去段顺序）。

### 25.2 P2：守卫两用分开

**做法**
- 工单（delta）不再有 Protection zone 的守卫清单；all 档的旧保护区不变。"守住"照旧由代码完成：重跑、翻转分类、回退或送修。审查附录的"翻转守卫"段和工单后附的带入条目保留（设计会话确认）。
- **对照**：`packageComparisons(registry, round, guards, library, outputs)`（view.ts）只挑依据单元与本轮修订记录（`m.round = n`）的被改单元重叠的活守卫。每条给命令、输入文件名、轮初基线上的当前输出，以及每个被改单元的 `earlier text of <id>: …; now: …`（撤回的写 withdrawn；整段或整节截到前 400 字符）。对照段放在包的末尾，执行方、审查员、formalizer 读到的是同一份。
- serial 在轮初只把这些对照守卫在基线上跑一批，取当前输出；其余守卫不再为了包去跑。
- 报告里 "N guards listed" 改为 "N comparisons (guards on revised units)"。

**删除**（恢复方式：`git show 2774d55:<路径>`）：view.ts 的 `PackageGuard`、`renderGuardList`；serial 里给包内所有对象的守卫跑基线、拼清单的那段；工单 delta 档的守卫清单渲染。

**rep1j 重放**（同一脚本；守卫列：按 P1 规则"包内对象上的守卫"会列出的数 / 按 P2 交付的对照数）

| 轮 | 包字符 | 对照段字符 | 守卫：P1 会列 / P2 交付 |
|---|---|---|---|
| R1 | 22,518 | 0 | 0 / 0 |
| R2 | 39,965 | 2,039 | 7 / 2（G2 等，R1.S8.P1 错误处理段被 R2 修订） |
| R3 | 24,795 | 0 | 29 / 0 |
| R4 | 9,365 | 0 | 33 / 0 |
| R5 | 14,000 | 1,028 | 43 / 3（G1、G8：R1.S4.P2.s1 的 SHA-256 被 R5 改为 BLAKE2b；G53：R4.S9 被 R5 修订） |
| R6 | 11,256 | 0 | 46 / 0 |

- R5 的 G1 正是设计会话举的样例：只给"R1 这句被 R5 改了，绑在它上面的这条调用现在输出是什么"，其余守卫一条不给。（rep1j 的 G1 是 verify 的校验和守卫，不是 sidecar；sidecar 撤回在 rep1j 的 R5 没有绑定守卫。）
- 离线测试：`chain.test.ts` 加一项。R5 撤回 sidecar 子句时，依据在它上面的守卫交付（命令、输入、当前输出、旧文本、撤回），sort 守卫不交付，R4 一条都没有；渲染出的包里不出现其他守卫的编号。

### 25.3 P3：预算、各区字符、利用率进报告；验收 A

**做法**
- 预算（绝对 40k，去段顺序）在 P1 已改。本块把利用率接进每轮报告。
- 报告 `zones.package.utilization`（`packageUse`，report.ts），口径按设计会话 Q3：
  - 分子：当轮所有审查中 disposition = sent 的条目。其单元按 `coverOf` 得到的所属对象；以及包内与某个单元重叠的段；
  - 分母：包内对象 / 包内段；
  - 执行方的改动不算。
- 报告新增一行 "Package use (review items sent to a repair list)"：对象和段两种口径的利用率，被引用对象在包内的比例，不在包内的列出编号。
- 包各区字符（本轮 / 修订 / 边 / 未结条目 / 对照）在 P1 的 "Requirements given" 一行里。
- 重放脚本 `exp2/evidence/package-2026-10-25/replay-package.mjs` 改为调用报告的同一个 `packageUse`。rep1j 的基线（只有对象）用同一函数算。
  - 用法：先在开发工作树里 `npm run build`，再 `node exp2/evidence/package-2026-10-25/replay-package.mjs <rep1j exp2-state.json>`。

**验收 A**（rep1j 六轮真实状态重放；状态取自设计分支 `exp2/evidence/real-runs-2026-10-23/rep1j-delta-r1-r6/exp2-state.json`）

| 轮 | 本轮原文 | 线 2×+10k | 新包字符（rep1j） | 本轮 / 修订 / 边 / 未结 / 对照 | 段 | 对象（rep1j） | 对象头 | 本轮边：块 / 对象 | 守卫交付 | 利用率·对象（rep1j 同口径） | 利用率·段 | 引用对象在包内 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| R1 | 18,802 | 47,604 | 22,518（22,490） | 21,976 / 0 / 0 / 0 / 0 | 10 | 9（9） | 0 | 0 / 4 | 0 | 44%（44%） | 40% | 4/4 |
| R2 | 24,600 | 59,200 | 39,965（48,781） | 29,829 / 5,213 / 0 / 1,776 / 2,039 | 37 | 5（8） | 0 | 0 / 1 | 2 | 60%（50%） | 24% | **3/4，缺 O2** |
| R3 | 9,436 | 28,872 | 24,795（54,789） | 11,219 / 1,980 / 0 / 10,424 / 0 | 31 | 6（8） | 0 | 0 / 3 | 0 | **33%**（25%） | 6% | 2/2 |
| R4 | 4,770 | 19,540 | 9,365（45,653） | 6,008 / 0 / 0 / 3,072 / 0 | 8 | 4（6） | 0 | 0 / 0 | 0 | 50%（33%） | 13% | 2/2 |
| R5 | 4,307 | 18,614 | 14,000（50,263） | 5,178 / 2,796 / 0 / 3,687 / 1,028 | 19 | 7（7） | 0 | 0 / 4 | 3 | **14%**（14%） | 5% | 1/1 |
| R6 | 3,322 | 16,644 | 11,256（55,086） | 4,050 / 0 / 0 / 6,086 / 0 | 14 | 6（9） | 3 | 0 / 4 | 0 | **33%**（22%） | 14% | 2/2 |

| A 的条目 | 结果 |
|---|---|
| R3–R6 包字符 ≤ 本轮原文 2 倍 + 10k | 成立（24.8k / 9.4k / 14.0k / 11.3k，基线 54.8k / 45.7k / 50.3k / 55.1k） |
| 利用率 ≥ 50%（对象口径，基线同口径） | **不成立**：R1 44%、R3 33%、R5 14%、R6 33%（R2 60%、R4 50%） |
| rep1j 审查员引用过的对象 100% 仍在新包内 | **不成立**：R2 的 O2（ingest）不在 |
| 被修订句上的守卫出现、其余不出现 | 成立（R2 2 条、R5 3 条，其余轮 0；R5 的 G1 即样例） |

**不成立的原因**
- **利用率**：分子是每轮有条目送修的对象，只有 1–4 个（R5 只有 O14）。分母是包内对象，R5 有 7 个：本轮 2 个，修订带来 2 个（O3、O5），未结条目带来 O13 等。新包的对象数已经比 rep1j 少（R6 6 对 9），但只要包里有修订段和未结条目段，对象数就低不到分子的 2 倍。段口径的分母是段数（R3 31 段），更低。
  - 这条线管的是"审查员能用上的比例"。在当前口径下，它更多取决于审查员当轮报了多少条，而不是包的组成。
- **O2**：rep1j R2 里 O2 是由 R1 的 applies_to 边 "R1.S6 applies_to O2" 带进来的，审查员报了 ingest 的偏离（V2.x）。按修订第 1 条，早轮的常驻边不再带，所以新包里没有 O2。审查员下一轮仍可能从程序上发现 ingest 的问题，但这一轮包里没有它的原文。

**全量 `npm test`**（本机）：973 项，962 通过，1 跳过，10 失败，都是已知的（9 项环境 + repair-batch）。

### 25.4 设计会话的三个决定（2026-10-25）与 applies_to 规则

**决定**（设计会话已记入 NIGHT）
1. "利用率 ≥ 50%"作为验收线撤回，记为"预设时没算上限，不成立"，不改数字也不换口径。原因：分子是当轮有条目的对象，只有 1–4 个；分母里必带修订段和未结条目段，对象口径的上限本来就到不了 50%。利用率两种口径照常每轮报告，不作门槛。A 里这一项改为"每轮 ≥ 基线（同一脚本）"，六轮都成立（44/60/33/50/14/33 对 44/50/25/33/14/22）。
2. O2 这类既不接受无条件缺失，也不恢复常驻边。规则：早轮的 applies_to 边，只在它的来源段本轮被修订时，才带目标对象的视图；否则什么也不带。本轮指向对象的边仍只给一行对象头。
3. 本条提交后跑 B（rep1k）。

**做法**（view.ts `roundPackage`）
- 对每条 `e.round < n`、`kind = applies_to` 的边：本轮修订记录的被改单元与 `e.from` 重叠时，目标对象的每个仍有效的早轮块按其所在段带入，理由是 edge，来源写 `<from> applies_to <to> (its source revised this round)`。
- 预算裁剪时它和别的边段一样先去。

**在 rep1j R2 上的结果**
- R1.S6（pipeline，O6）在 R2 被修订了（R2.S18、R2.S29 整节 revise）。所以这条规则在 R2 把 "R1.S6 applies_to" 的四个目标 O2、O3、O4、O5 的视图都带了进来。
- 但 R2 的包因此从 47.6k 涨到 67.7k，超过 40k 预算。按裁剪顺序，边带入的段最先去，O2 的 R1.S2 被去掉，R2 仍是 3/4。
  - 换成"这类段最后才裁"也放不下：R2 的本轮段、修订段和对照段已经约 37.5k，剩下不到 3k，装不下 O2 的整节。
- 其余轮次没有 applies_to 的来源被修订，数字与 25.3 相同。

**离线测试**：`chain.test.ts` 加一项。R1 记一条 R1.S3.P24 applies_to verify 的边，R5 撤回 R1.S3.P24 里的一个子句：R5 的包里有 verify 的段，来源写明；R4 没有。

**全量 `npm test`**（本机）：974 项，963 通过，1 跳过，10 失败，都是已知的。

### 25.5 验收 B：真实 6 轮运行 rep1k

**运行**：`D:\huawei\EvoCodeBench\harbor_runs\exp2-icacc-r6-luna56-low-rep1k-20261025`，代码 b4f079d，端口 46011/46012，配置照 rep1j（只改了运行编号、端口、缓存键、label），6 轮，delta，执行方 low。结果 done，续跑 0 次。
- 取数脚本：`exp2/evidence/package-2026-10-25/report-b.mjs`，rep1j 用同一脚本算。
- 报告、分数、measures 和这张表复制在 `exp2/evidence/package-2026-10-25/rep1k/`。

| 轮 | 官方分（rep1j） | 原文未改的翻转（rep1j） | 审查：每次存活条目（rep1j） | 审查请求字符（rep1j，变化） | formalizer 未缓存（rep1j，变化） | 审查员未缓存（rep1j） | 守恒错 / no_input | 包字符（rep1j） |
|---|---|---|---|---|---|---|---|---|
| R1 | 196（177） | 0（2，G3） | 12, 9, 5（9, 4, 8） | 82,442（74,956，+10%） | 47,557（55,800，−15%） | 141k（143k） | 0 / 0 | 23,318（22,490） |
| R2 | 474（480） | 0（0） | 10, 4, 5（6, 8, 2） | 125,458（163,604，−23%） | 81,976（70,993，+15%） | 172k（248k） | 0 / 0 | 38,779（48,781） |
| R3 | 534（534） | 0（0） | 5, 2, 1（1, 1, 2） | 82,806（172,470，−52%） | 47,911（82,117，−42%） | 158k（202k） | 0 / 0 | 24,127（54,789） |
| R4 | 630（638） | 0（0） | 6, 3, 1（1, 2, 1） | 49,332（147,030，−66%） | 50,094（112,195，−55%） | 181k（182k） | 0 / 0 | 14,219（45,653） |
| R5 | 666（673） | 1，G5（3，G57） | 1, 0（2, 2, 2） | 50,319（159,307，−68%） | 10,153（94,805，−89%） | 117k（213k） | 0 / 0 | 19,262（50,263） |
| R6 | 698（710） | 0（1，G57） | 4, 2, 1（3, 0） | 71,927（119,992，−40%） | 52,300（52,582，−1%） | 188k（119k） | 0 / 0 | 20,694（55,086） |

| B 的条目 | 结果 |
|---|---|
| 每轮官方分与基线差 ≤ 2 个用例 | **不成立**：R1 +19，R3 持平；R2 −6、R4 −8、R5 −7、R6 −12 |
| 原文未改的翻转不高于基线（2 类 5 次） | 成立：1 类 1 次（G5，R5）。同一脚本数 rep1j 是 2 类 6 次（R6 的 G57 也算一次） |
| 存活条目 ≤ 1 的轮次审查 ≤ 2 次 | 成立：唯一合计 ≤ 1 的轮次是 R5（1、0），审查 2 次；其余轮次每轮存活 7–26 条，审查 3 次 |
| R3–R6 审查请求字符比基线低 ≥ 30% | 成立：−52%、−66%、−68%、−40% |
| R3–R6 formalizer 未缓存比基线低 ≥ 30% | **R6 不成立**（−1%）；R3 −42%、R4 −55%、R5 −89% 成立 |
| conservation、no_input 为 0 | 成立（六轮都是 0 / 0） |

**设计会话要的两项附加记录**
- **每轮被预算裁掉的段**：rep1k 六轮都没超预算（包 14k–39k），一段也没裁。R2 的包是 38.8k，O2 由未结条目带进来（rep1k 的归属和条目与 rep1j 不同）。
- **R2 是否再报 ingest 的偏离**：rep1k 的 R2 没有关于 ingest 的条目；R1 报了 3 条（V1.1.9、V1.2.6、V1.3.5）。rep1j R2 那条"被拒的行影响了唯一性检查"（V2.2.7），rep1k 到 R6 才以 V6.1.2（ingest 唯一性）报出来，已送修。

**准确率差在哪里**（只比较两次运行里失败用例的编号集合，没看测试内容）

| 轮 | rep1k 多失败的 | 其中：本轮新用例没做对 | 上一轮通过、这轮失败（退化） | 早先就失败、一直没修好 |
|---|---|---|---|---|
| R2 | 6 | 6 | 0 | 0 |
| R4 | 8 | 8 | 0 | 0 |
| R5 | 8 | 0 | 8 | 0 |
| R6 | 12 | 0 | 4 | 8 |

- R5 的 8 个退化都是 R4 引入的用例：R4 通过，R5 起失败，R6 仍失败。R5 只有 G5 一次翻转，说明守卫没有覆盖这几条行为。
- R6 新增 3 个 R1 用例和 1 个 R5 用例的退化。
- R2、R4 是本轮新用例没做对，rep1j 同轮做对了。
- 因果没有定：一次运行和一次基线比，程序和审查条目都不同。可以确定的是，这些丢分不是预算裁剪造成的（一段没裁），也不是原文未改的翻转回退造成的（只有 1 次）。

### 25.6 rep1k R5、R6 退化的因果（零成本核查）

**方法**
- 用例到行为：只用 verifier.log 里每个用例的 `requirement_ref` 和 `intent`（名字）。行为到句子：只用 R4 原文。
- 判断"程序变了"还是"检查变了"：用本地评分脚本（复制到暂存目录运行，不写运行目录），拿某一轮的测试去给上一轮保留的程序打分，不读测试内容。
- 另外：第一次 grep verifier.log 时，屏幕上带出过两行 c540、c546 的场景和期望值。下面的结论不依赖这两行。

**R5 的 8 个用例（c540、c546、c551、c554、c560、c566、c572、c635）：属于 (c)，不是程序在 R5 被改坏**
1. 用例 → 行为 → 句子：8 个都是 `requirement_ref=validate`，名字分别是 type check、required、min max（2 个）、pattern、enum、unique、float type check。对应 R4 的新命令 validate：O34，R4.S1 起各节的规则 1–6，以及输出格式中的 row 字段。R4 原文只有一个示例 `"row": 3`，没写 row 从哪里起算。
2. R4 轮末的守卫：O34 上有库守卫 G77（K44，R4.S1–S2.P1），以及审查守卫 G80–G86（R4.S2–S6 的单元）。R5 里它们都没翻转。
3. R5 保留周期的 diff（70b3fcf → 075efa23）：
   - validate 只改了 unique 规则的位置（规则列表加 "unique"，循环里 `continue`），行号写法 `ri+2` 没变；
   - readCSV、num、idx、writeCSV 逐字不变；main 里 validate 的调用、pipeline 里的 validate 步骤也不变；
   - 用我按 R4 原文构造的小输入，两版程序的 validate 输出逐字相同。
4. **决定性对照**：R4 保留程序 70b3fcf 用 **R5 的测试**打分，这 8 个同样全部失败（625/680）。所以是同一个程序，R4 那一轮的测试过、R5 那一轮的测试不过；R5 原文没有提到 validate 的 row。
   - rep1j 的 validate 写法不同，这 8 个在 rep1j 的 R4、R5、R6 都通过。
   - R5 的包里有 O34 的 6 个未结条目段和 O16 的 R4.S9.P1（修订段）。包没有拿掉 validate 的规则句。
- 结论：这 8 分与包的改造无关，也与守卫无关。R4 原文对 row 的起算没有写明，rep1k 的执行方取了"文件行号"（数据第 1 行记为 2），R5 的测试按另一种算法检查。

**R6 的 4 个用例（c005 Basic ingest、c008 Composite primary key、c111 Transform SHA-256、c668 No .sha256 sidecar）：属于 (a)，是包的改造直接造成的**
- 真退化：R5 保留程序 075efa23 用 **R6 的测试**打分，这 4 个全部通过（670/716）。是 R6 的改动把它们改坏了。
- R6 首次交付 C6.1 在 ingest 和 transform 里都加回了写 `<output>.sha256`。这与 R5 的撤回相反（R5.S1.P2.s4、P2.s5、P3.s4、P3.s5），之后 C6.2–C6.4 一直没改回。R6 原文里没有一处提到 sha256 或旁路文件。
- R6 的包里：
  - O2（ingest）只有一个未结条目段 R1.S2.P4，O3（transform）没有段。R5 的撤回句不在包里：它们是 R5 的本轮文本，按段规则 R6 不再带。
  - 有一个"修订"段 O16 的 R1.S6（pipeline 整节），被 R6.S9 整节修订。**`paragraphInForce` 没有处理"这一段本身被整体取代"的情况**：它只切块内部的单元，整节旧文因此以"当前有效文本"的身份交付，下面的 `earlier text of R1.S6:` 又重复一遍。旧文里有 pipeline 示例 `{"type": "verify", "file": "final.csv", "checksum": "final.csv.sha256"}`，暗示旁路文件存在。这是 P1 的一个机械缺陷。
- rep1j 的 R6 包是整对象视图：O2、O3 的视图里原位带着 R5 的撤回句（"sidecar … are **removed**"、"`transform` command: no longer writes `.sha256` sidecar files"）。整节被取代的 R1.S6 不在视图里。rep1j R6 没有这几个退化。
- 守卫：G87（库，R1.S2、R1.S2.P6、R5.S1.P2.s4）和 G88（库，R1.S3.P1、R1.S3.P2.s1、R1.S3.P24）在 C6.1 翻转。
  - 按边分类为原文改过（"R1.S6 refers_to O2/O3；R1.S6 replaced by R6.S9"）；
  - 审查员没有答 SUPERSEDED，判为退化送修；
  - 执行方三个修补周期都没有进展，停送。

  守卫覆盖到了、也发现了，但退化没有修回。
- 结论：包里没有 R5 的撤回句，却交付了已被取代的 R1.S6 旧文；执行方据此加回了旁路文件。守卫抓到了，但没修回。

**设计会话要的计数**（同一脚本，两次运行同口径）

| 轮 | rep1j：检查进入 / 准入；轮末守卫（本轮出生：库 / 审查） | rep1k：同 |
|---|---|---|
| R1 | 7 / 7；8（2 / 6） | 20 / 20；34（15 / 19） |
| R2 | 9 / 9；31（4 / 20） | 12 / 12；60（9 / 17） |
| R3 | 11 / 11；46（8 / 7） | 10 / 10；74（9 / 6） |
| R4 | 7 / 7；54（6 / 2） | 4 / 4；85（4 / 7） |
| R5 | 8 / 8；60（7 / 0） | 5 / 5；86（4 / 1） |
| R6 | 6 / 6；72（4 / 8） | 12 / 12；98（11 / 1） |

- R4 轮末活守卫覆盖的 R4 单元（`guardCoverage`，带具体规定、仍有效的单元）：rep1j 3/47（6%），rep1k 16/49（33%）。全部仍有效单元：rep1j 56/455（12%），rep1k 134/459（29%）。

**待定**（实现没动）
1. **`paragraphInForce` 的缺陷**：段本身被整体取代或撤回时，当前有效文本应为空，只留 `earlier text of <id>` 一行，新文本由本轮段给出。这是机械错误，在代码里修。
2. **按段带入时，早轮的撤回/修订文本到了下一轮就不再出现**：R5 的撤回句在 R6 不在包里。是否要求"执行方要改动的对象，带其当前有效视图里被修订过的段"，这是设计决定。

### 25.7 修 `paragraphInForce`（整段取代或撤回），以及设计会话的四个决定

**决定**（设计会话，2026-10-25）
1. `paragraphInForce` 的缺陷是机械错误，修。
2. 不加"执行方要改动的对象带其修订过的段"。理由：R6 的直接原因是 (1)；撤回句在守卫 G87、G88 的 units 里，翻转送修时执行方已经拿到。若重跑后同类退化再现（执行方在原文没提的地方加回已撤回的行为），再议。记为假设，不改设计。
3. 守卫覆盖的数字是这一批的正面结果之一，进 NOTES 和证据目录：`exp2/evidence/package-2026-10-25/guard-coverage.md`。R4 单元的覆盖率 rep1j 6%、rep1k 33%；全部有效单元 rep1j 12%、rep1k 29%。
4. R5 的 8 个 validate 用例：R4 原文没写 row 从哪里起算，执行方取了文件行号，rep1j 用了另一种写法并通过了。这是执行方的选择，不是 IC 的损失，也不加规则，只记录。

**做法**（view.ts）
- 段本身或它所在的上级块被本轮或更早的修订记录整体取代或撤回（修订的 `parts` 落在这一段的 lineage 上）时，`paragraphInForce` 返回空。
- 修订段只留一行 `earlier text of <id>: …`，新文本由本轮段给出。
- 边段、未结条目段遇到这种段，直接不出。

**验收**
- **替身测试**（`chain.test.ts`，两项）。在一个 R2 节级归属下挑一个段，人造一条 R3 的整段 revise 记录、一条整段 withdraw 记录：
  - `paragraphInForce` 在 R3 为空、在 R2 不为空；
  - 修订段的文本恰好是 "earlier text of <id>: <旧文>"，整个包里旧文只出现一次；
  - 改为 R2 就已撤回时，作为未结条目也不再带入。
  - 去掉修复时这两项失败（13/15），修复后 15/15。
- **重放 A**（`replay-package.mjs`）：

| 轮 | rep1j 状态：修后（修前） | rep1k 状态：修后（运行时实际） |
|---|---|---|
| R1 | 22,518（22,518） | 23,318（23,318） |
| R2 | 39,454（39,965） | 38,193（38,779） |
| R3 | 24,795（24,795） | 22,870（24,127） |
| R4 | 9,365（9,365） | 14,219（14,219） |
| R5 | 13,682（14,000） | 18,631（19,262） |
| R6 | 11,256（11,256） | 19,279（20,694） |

- **rep1k R6 的段清单**（修后，按重放；字符为段文本，不含标题行）：
  - **修订**：R1.S6（O16），743，当前文本 0，只有 1 行 earlier text。修前这一段把整节旧文作为当前文本交付了一遍，下面又以 earlier text 重复一遍。
  - **本轮**：R6.S9（O16）253，R6.S1（O38）2,644，R6.S5（O39）1,153。
  - **未结条目**：R1.S2.P4（O2）346，R1.S3.P4（O7）175，R1.S7 / R1.S7.P1（O17）295 / 261，R2.S3.P8–P13（O20）合计 3,107，R2.S17.P1–P7（O28）合计 1,318，R2.S24.P1（O29）590，R4.S2.P4 – R4.S5.P1（O34）合计 2,035。
  - **对象头**：O1、O3、O14、O15、O31、O37。
- **仍要看的一点**：R1.S6 的旧文里有 pipeline 示例 `{"type": "verify", "file": "final.csv", "checksum": "final.csv.sha256"}`。修后它在 R6 的包里仍出现一次，但只在 "earlier text of R1.S6" 那一行里，不再作为当前文本。这是 Q1 "新旧并列"的本来写法。整节被取代时，旧文是否截短，留给设计会话。
- rep1j 状态的 R6 包没有这一段（rep1j 的归属在 R2 就整节取代了 R1.S6），与修前相同。

**全量 `npm test`**（本机）：976 项，962 通过，1 跳过，13 失败。其中 10 项是已知的；另 3 项（block11 §5、serial 两项）的报错都是 `the host blocked … spawn UNKNOWN`，serial 单独跑 6/6 通过。
- **设计会话决定（2026-10-25）**：整节被取代时，earlier text 不截短。新旧并列的用途是让执行方知道被取代的是什么（要删什么），743 字符不贵。R6 退化的原因是旧文被当成了现行文本，现在已标为 earlier text，守卫 G87、G88 也盯着这条行为。记为 rep1l 的观察项：R6 执行方若再把 `.sha256` 加回去，再议截短。

### 25.8 rep1l：修复 `paragraphInForce` 后的真实 R1–R2

**运行**（用户 2026-10-25 定：先跑 2 轮）：`D:\huawei\EvoCodeBench\harbor_runs\exp2-icacc-r6-luna56-low-rep1l-20261025`，代码 6458a9e，端口 46013/46014，配置照 rep1k（只改了运行编号、端口、缓存键、label），rounds 6，`--to 2`，delta，执行方 low。结果 done，续跑 0 次。证据在 `exp2/evidence/package-2026-10-25/rep1l/`。

| 轮 | 官方分（rep1j）；首次交付 | 原文未改的翻转（rep1j） | 审查：每次存活（rep1j） | 审查请求字符（rep1j） | formalizer 未缓存（rep1j） | 审查员未缓存（rep1j） | 守恒错 / no_input |
|---|---|---|---|---|---|---|---|
| R1 | **190**（177）；140 | 0（2，G3） | 8, 6, 3（9, 4, 8） | 79,546（74,956，+6%） | 57,352（55,800，+3%） | 123k（143k） | 0 / 0 |
| R2 | **364**（480）；275 | 0（0） | 14, 6, 4（6, 8, 2） | 133,567（163,604，−18%） | 103,140（70,993，+45%） | 175k（248k） | 0 / **1** |

| B 的条目（R1–R2） | 结果 |
|---|---|
| 官方分与基线差 ≤ 2 个用例 | R1 +13；**R2 −116，不成立** |
| 原文未改的翻转不高于基线 | 成立（0 次） |
| 存活条目 ≤ 1 的轮次审查 ≤ 2 次 | 不适用：两轮每轮存活 17、24 条，审查 3 次 |
| 审查请求、formalizer 未缓存（这条线只管 R3–R6） | 只记录：R2 审查请求 −18%，formalizer +45% |
| conservation 0；no_input 0 | conservation 成立；**R2 no_input 1** |

- R2 的那条 no_input 是 V2.2.6：审查员说了五次调用和配方，材料里只有 bin 的配方。三处材料确实都没有，按原话退化送出（fallback）。

**包**
- R1：23,350 字符，40 段，全是本轮段，16 个对象，对象头 4 个，本轮边全指向对象（16 条）。
- R2：39,147 字符，41 段（本轮 31，未结条目 10，没有修订段、边段和对照段），19 个对象，对象头 1 个，本轮边 3 条指向对象；没超预算。
- 利用率（对象 / 段）：R1 8/16、18/40；R2 13/19、20/41。被引用的对象都在包内。

**R2 的 −116 在哪里**（只用用例名 `requirement_ref`）
- rep1l R2 失败的分布：profile 54、compare 19、rollup 16、R1 的 pivot 10、detect 8，其余 9。rep1j R2 只挂了 1 个（transform.derive）。
- 包没有漏 R2 的原文：R2 所有已归属的块都在包里，缺的 R2.S7、R2.S12、R2.S27 只是上级标题节，它们的子节都在。
- 审查员报了这些：profile 4 条、compare 4 条、rollup 1 条、detect 3 条、pivot 1 条，都送修了。三个修补周期用完时，仍有 13 条"无进展、停送"。
- pivot 的 10 个在 R1 就已失败，不是 R2 的退化。
- 结论：R2 的丢分是执行方在三个修补周期内没有做完 R2 的新命令（profile、compare）和新变换，与包的组成、预算、守卫回退无关。这一轮没有翻转，也没有回退。同一套包规则下，rep1k 的 R2 是 474。一次运行分不出这是执行方的波动还是别的原因。

### 25.9 rep1l R2：归属核对与 13 条停送条目（零成本核查）

**1. R2 的归属**（三次运行同一口径）
- 标准答案集里 R2 **没有一条修订**；5 条交叉引用，其中 3 条 extends、2 条 same_rules。

| | rep1j | rep1k | rep1l |
|---|---|---|---|
| R2 的修订记录 | 7 条：R1.S6 被 R2.S18、R2.S29 整节 revise；R1.S8.H / R1.S8.P1 被 R2.S6、R2.S24 revise；R1.S3.P22–P23 被 R2.S13 revise | 1 条：R1.S3.P22 被 R2.S13.P1 partial | 0 条 |
| 修订召回 / 精度 | 0/0 / 0/7 | 0/0 / 0/1 | 0/0 / 0/0 |
| 关系召回 | 5/5（边 0，同对象 5） | 4/5（边 1，同对象 3） | 4/5（边 1，同对象 3） |

- rep1l 的 R2 不记修订，与标准答案一致。R1.S6 的子段归 O18（pipeline），仍然有效。R2.S18、R2.S29 也归 O18，即作为扩展。所以包里没有修订段是对的，不是归属漏记。
- rep1j 把 R1.S6 记成被整节取代，是多记（精度 0/7）。rep1k 的 R1.S6 是在 R6 才被取代的。
- rep1k 和 rep1l 漏的同一条是 aggregate 的 same_rules（R2.S15.P3.s2 → R1.S3.P9.s5）。

**2. 三个修补周期后"无进展、停送"的 13 条**
- 13 条里 8 条是 R2 的：V2.1.1、V2.1.2、V2.2.4、V2.3.1（profile），V2.1.10（rollup），V2.1.11（detect），V2.1.14（pivot），V2.2.3（hash）。另外 5 条是 R1 带入的：V1.1.5（pivot），V1.2.1（主键排序），V1.2.2（having），V1.2.3（window），V1.3.3（pipeline 未知步骤）。
- **送修时执行方拿到的**：每条都有审查员原话，加上代码核实过的检查（输入文件 1–2 个，断言 1–14 条）。大多数只在 C2.1 后的那条修补消息里送过一次，同一条消息里共有 17 条。之后按停送规则，程序上的输出没变（digest 相同），就判"无进展、无裁决"，不再送。
- **执行方每周期的改动**：
  - C2.1（首次交付）：+1,276 行，有 profile、compare、pivot、window 等，profile 函数 73 行；
  - C2.2：assert、deduplicate、hash、split；
  - C2.3：bin、encode、normalize；
  - C2.4：bin 标签、hash 输出、compare 分类；
  - **profile 函数从 C2.1 之后再没改过；rollup、detect 始终没有实现**。
- **结论：材料到了，执行方没有动，不是动了做错**。它每个周期挑了别的条目做，没有轮到的条目在下一周期被停送。
- **任务区**：rep1l R2 工单的任务区列了 19 个对象，包括 profile、rollup、detect；rep1j 列 5 个（rep1j 的归属把 R2 的变换并进了 O3 Transformation）。

**3. 对照 rep1j 的 R2**
- rep1j 首次交付 C2.1 已经写了 assert、compare、deduplicate、encode、hash、normalize、profile、split（首次交付 395 分）。第一次修补 C2.2 补上 rollup、detect、bin，并补全了 profile 的统计量。
- rep1l 首次交付 C2.1 的收尾说明列的大多是 R1 带入条目的修复（主键排序、having、window、linear fill 等），输出 5.0k token。rep1j 是 7.9k，首次交付 275 分。R2 的新变换在 rep1l 里是靠修补才陆续补上的。
- 停送规则两次运行相同。rep1j 每个周期做得多，这条规则没有卡到 profile、rollup、detect；rep1l 每周期做得少，规则把没轮到的条目都停了。
- **观察**：一条修补消息里条目很多时，执行方只做其中一部分。剩下的条目输出没变，于是被停送。这是 Sends 的现行规则，没改。

**4. R2 的 no_input = 1**（V2.2.6）：审查员叙述了五次调用，但材料里只有配方，没有输入，按原话退化送出。设计会话确认这是现行规则，不改。

### 25.10 rep1m：R1–R2 的第二次重复（本实验最后一次重复）

**运行**（用户 2026-10-25 定）：`D:\huawei\EvoCodeBench\harbor_runs\exp2-icacc-r6-luna56-low-rep1m-20261025`，src 与 6458a9e 相同，端口 46015/46016，配置照 rep1l（只改了运行编号、端口、缓存键、label），rounds 6，`--to 2`，delta，执行方 low。结果 done，续跑 0 次。证据在 `exp2/evidence/package-2026-10-25/rep1m/`。三次运行并排的数据在 `side-by-side-r1r2.txt`（脚本 `side-by-side.mjs`）。

| | rep1j（基线，串链块） | rep1l（包批 + 修复） | rep1m（同 rep1l，第二次） |
|---|---|---|---|
| R1 官方分（首次交付） | 177（108） | 190（140） | **206（162）** |
| R2 官方分（首次交付） | 480（395） | 364（275） | **450（312）** |
| R1 / R2 翻转（其中退化）；回退 | 2（2）/ 1（0）；2 / 0 | 0 / 0；0 / 0 | 0 / 0；0 / 0 |
| R1 / R2 审查次数（每次存活） | 3（9,4,8）/ 3（6,8,2） | 3（8,6,3）/ 3（14,6,4） | 3（6,5,6）/ 3（7,12,7） |
| R1 / R2 审查请求字符 | 74,956 / 163,604 | 79,546 / 133,567 | 76,066 / 130,976 |
| R1 / R2 formalizer 未缓存 | 55,800 / 70,993 | 57,352 / 103,140 | 103,649 / 61,111 |
| R1 / R2 审查员未缓存 | 143k / 248k | 123k / 175k | 128k / 171k |
| conservation 错 / no_input | 0 / 0；0 / 0 | 0 / 0；0 / 1 | 0 / 0；0 / 0 |
| R1 / R2 包字符；段；对象 | 22,490 / 48,781；—；9 / 8 | 23,350 / 39,147；40 / 41；16 / 19 | 23,193 / 39,021；40 / 46；17 / 18 |
| 利用率 对象 / 段（R1；R2） | — | 8/16、18/40；13/19、20/41 | 7/17、10/40；9/18、16/46 |
| 被"输入声明不符"挡下的条目（R1；R2） | 0；1 | 2；0 | 1；**8** |
| R2 首次交付写了的 R2 命令和变换 | profile, compare, deduplicate, split, assert, normalize, encode, hash（缺 rollup, detect, bin） | profile, compare（缺其余 9 个） | profile, compare, deduplicate, split, assert, normalize, hash（缺 encode, rollup, detect, bin） |
| R2 失败分布（requirement_ref） | R1 derive 1 | profile 54、compare 19、rollup 16、R1 pivot 10、detect 8、其余 9 | rollup 16、R1 pivot 10、R1 fill 2、profile 2、R1 derive 1 |

**rep1m 的 R2 差 30 分在哪里**
- rollup 16 个：直到最后一次修补 C2.4 才写上，之后没有审查再看，16 个都没过。encode、detect、bin 在 C2.3 补上。
- R1 的 pivot 10 个：R1 遗留下来的，一直没修好。
- **IC 这边有一处原因**：R2 第一次审查报的 8 条全被前提 input_claim_false 挡下了，包括 V2.1.11 "rollup is not implemented"、V2.1.9 "pivot rejects a valid recipe"，以及 split、detect、bin、hash 等单元上的条目。
  - 8 条共用审查员会话里的一个输入文件 review-in.csv，formalizer 声称有 3 个空单元格，代码按 Go 的读法解析出 4 个，于是 8 条一起挡下；
  - rollup 到第二次审查（V2.2.9）才送出去，pivot 那条再没送过；
  - 这与 rep1i R1 的 9 条被挡（23.7）是同一种情况。§12j.3 定过这条前提要在批 2 降为只记录、不决定送修，批 2 还没做。
- 首次交付 R2 写了 7 个命令和变换（rep1j 8 个，rep1l 2 个），312 分。

**三次运行能看出的**
- R1：三次分别是 177、190、206，包批两次都高于基线。
- R2：480、364、450，同一份代码两次差 86 分，主要差在执行方首次交付做了多少（2 个对 7 个命令和变换）。rep1m 另有 8 条被输入声明前提挡下。
- 原文未改的翻转和回退：包批两次运行 R1–R2 都是 0；基线 R1 有 2 次，回退 2 次。

## 26. 批 2：前提只剩两条（DESIGN §12j.3）

用户放行（2026-10-25，经设计会话）：B2a → B2b → B2c 依次提交；验收全部离线，读会话只起运行自己的服务，不调模型。

### 26.1 B2a：默认挡送只剩"单元在效""能复现"

**做法**：`DEFAULT_PREMISE_BLOCK` 从 `unit_not_in_force, not_reproduced, input_claim_false` 改为 `unit_not_in_force, not_reproduced`（`src/exp2/formalize.ts`）。输入声明与解析不符（`input_claim_false`）不再挡送，记为 logged，进报告的 logged 计数；条目照常走复现。配置 `acceptance.premise_block` 保留，消融时可以把它加回去。

**依据的运行**：rep1m R2 第 1 次审查 8 条被 `input_claim_false` 挡下（共用的 review-in.csv 声称 3 个空格，解析出 4 个），其中有 rollup 未实现、pivot 拒收合法配方两条本轮要紧的；rep1i R1 第 2 次审查 9 条同样被挡。

**验收**（重放脚本 `exp2/evidence/batch2-2026-10-25/replay-premises.mjs`：运行的真实审查回复、记录下来的 formalizer 回复、从运行自己的编码服务读回的审查会话材料、被审的那次提交在 docker 里构建运行；旧挡送层与新挡送层逐条判）：

1. rep1m R2.1（C2.1，e374eb9e）：15 条，malformed 0。旧层重现运行记录（发 7、挡 8，V2.1.7–V2.1.14 全为 `input_claim_false`）；新层 15 条全部发出，8 条全部复现（reproduced=true，verified）。新修复消息第 9 条是 pivot 拒收合法配方，第 11 条是 rollup 未实现（按条目文字核对，消息里不带编号）。守恒：两层都是 15 = 发 + 挡（7+8，15+0）。复现不成立的条目：无。结果 `rep1m-R2.1.json`。
2. rep1i R1.2（C1.2，007d0169）：10 条。旧层重现运行（发 1、挡 9）；新层发 9、挡 1。
   - 8 条复现成立，发出（verified）。
   - V1.2.2（排序按字典序）：参考脚本与断言不符（`reference_failed`），没有可复现的检查，按审查员原话发出（words）——与批 A1 以来的规则一致。
   - V1.2.9（ingest 校验顺序）：**复现不成立，挡下**。原因：formalizer 给这条写的断言只看 ingest 输出文件的第 2、3 行（R1.S2.P4.s1、R1.S2.P6.s2 的行序），不涉及条目说的"先做全列必填/类型检查，再做范围、模式检查"的顺序；被审程序的输出满足这两条断言，所以检查在程序上通过。检查没有测到条目说的缺陷，挡下是"能复现"这条前提的正常结果，不是声明问题。
   结果 `rep1i-R1.2.json`。
3. 七个真实 R1 重放（replay-baseline.test）：与 fe6562d 基线逐项相同（rep1b/c/d/e/g 的 blocked 原本都是 0，发出数不变；rep1、rep1f 无审查）。未另存新基线。
4. 离线测试：block-accept §2"声明与解析不符"一条从"挡下"改为"记录、检查照建"（assessPremises 报 `input_claim_false`，检查仍建出）；block-accept-fix 新增"声明错、检查能复现：发出，logged 记 input_claim_false，premise_blocked 为空"。两文件 44 过 0 败。

### 26.2 B2b：formalizer 不再写输入声明

**做法**：B2a 之后输入声明（claims）只剩一个用处：报告里的 `input_claim_false` 记录，没有任何环节消费它。按设计会话"不留空壳"，整段去掉：

- 去掉的请求部分：formalizer 输出 schema 里每个条目的 `claims` 字段（及其 required）；系统提示里"claims: 对每个 .csv/.json 输入文件写出解析器眼里的记录数、空格数、列名，自己数"那一行；解析时"claims 必须说明文件是否能解析、CSV 必须给整数记录数和空格数"两条校验（原来不满足会让 formalizer 重答）。
- 随之去掉的代码：`FormalItem.claims`、`InputClaim`、`claimProblems`、只为它服务的 `parsedFacts` 和 Go 式 CSV 解析器 `parseCsvGo`；前提 `input_claim_false`（类型、`assessPremises`、严格顺序、配置可选项）。
- 旧运行记录下来的 formalizer 回复里仍带 `claims`，解析时忽略，不报错。
- 配置 `acceptance.premise_block` 不再接受 `input_claim_false`：这条前提已经没有数据来源，消融也无从做。

**验收**：
- rep1i R1.2、rep1m R2.1 用 B2b 代码再重放（同样起运行自己的服务读会话，不调模型）：逐条结果、修复消息全文与 B2a 新层逐字相同（rep1i 发 9、V1.2.9 不复现；rep1m 发 15）。
- 七个真实 R1 重放（replay-baseline.test，用的是带 claims 的旧回复）：与 fe6562d 基线相同。
- B2a 的遗漏：示例配置 `exp2/local-config.example.json` 显式写着旧的三条挡送，B2a 没改；这里改成 `unit_not_in_force, not_reproduced`。真实运行目录的配置都不写 `premise_block`（rep1f–rep1m 逐个查过），走的是代码默认值，所以 B2a 的重放结论不受影响。
- 测试：删去两条只测声明的用例（CSV 解析器、声明与解析不符）和 B2a 新加的"声明错照发"用例，测试桩不再写 claims。

### 26.3 B2c：重放工具去掉"严格"一栏

**做法**：重放（`replayReview`、`intent-exp2-replay` 的 review 模式）原来每条多算一个 `strict`（假定所有前提都挡送时，第一条不过的前提），表头有"strict: blocked / strict: sent"两栏、条目表有 strict 列、缺陷表有 strict 列。按设计会话"消融走 `acceptance.premise_block` 配置，不留第二条口径"，这些全部去掉；重放只按配置的挡送层判一次。随之去掉 `checkPremises`（"所有前提都挡送"的单一判决，只给严格一栏和测试用）；§2 的前提测试改为直接看 `assessPremises` 报出的每条不过的前提。

**依据**：B2a 之后默认挡送层与严格一栏的差别正是被记录、照发的那些前提；两条口径并存时，重放表上同一条目会有两个结论，读数要先说清用哪一栏。

**验收**：七个真实 R1 重放（replay-baseline.test）与 fe6562d 基线相同（基线不含 strict 计数）；重放工具的离线测试改为按挡送层断言（发出、记录、审查员原话），通过。

## 27. 送修条目的结局：fixed / touched / untouched（DESIGN-DEEP §4.1 的基线，离线）

**做法**：脚本 `exp2/evidence/repair-outcome-2026-10-25/outcome.mjs`，口径写在脚本头部；输出 `outcome.md`（汇总表、按消息大小分组、逐条表）和 `outcome.json`。只读运行状态和 app 仓库的 git 历史，不调模型、不跑程序、不碰官方测试。

- 送出：上一周期的条目记录里 action=send 的条目送进下一周期；本轮第一周期送进的是 `carried_in`。最后一个周期的 send 没有后续周期，不算。
- 结局（每次送出各一个，在送进的那个周期判）：该周期条目记录 verdict=pass → fixed；否则该周期 diff（`cycle.anchors`，与前一周期相比变了的锚点）碰到条目命令的锚点 → touched；否则 untouched。轮末结局 = 本轮最后一次送出的结局。
- 条目的命令：检查所属对象（`check.object`）。锚点：前后两个提交的程序里，按映射连到该对象的锚点（按运行时的方式从每个提交的源码树里抽锚点）。
- 没有检查的条目（按审查员原话发出）单列 no_check；映射不到命令的单列 unmapped，不猜。
- 停送：本轮有一次 hold 且原因含 "no progress"。带入下一轮：下一轮 `carried_in` 里有它。

**发现：设计稿说的"nameLinks 已有"在这四次运行里几乎不起作用。** nameLinks 要求派发锚点名与对象全名相同，而归属给对象起的名字是 "pivot operation""profile command""Transformation" 这类，派发锚点名是 `pivot`、`profile`。严格按 nameLinks，310 条里 160 条映射不到命令（rep1j–m 的执行记录 `links` 也是空的）。所以给两种映射：
- strict：按 nameLinks 原样；
- stem：把对象名末尾的 "operation" / "command" 去掉再比。对这类名字的对象，前后两个提交里都没有同名派发，说明命令根本没写，算 untouched，并单独计数（absent）；其他名字（"Transformation""Ingestion""window transformation"……）映射不到的仍算 unmapped。

**结果（stem 映射；strict 的表在 outcome.md）**。§28 起，程序没构建成功的周期单列 build_failed（rep1j C5.1、rep1k C5.1：没有程序，检查没跑，锚点口径在这里判的 touched/untouched 没有意义），下表已按此改过：

| 运行 | 送出条目（轮次合计）| fixed | touched | untouched | no check | unmapped | build failed | untouched 中被停送 |
|---|---|---|---|---|---|---|---|---|
| rep1j R1–R6 | 90 | 40 | 2 | 7 | 2 | 35 | 4 | 4 |
| rep1k R1–R6 | 121 | 50 | 10 | 38 | 4 | 8 | 11 | 38 |
| rep1l R1–R2 | 50 | 18 | 4 | 24 | 4 | 0 | 0 | 22 |
| rep1m R1–R2 | 49 | 21 | 0 | 10 | 5 | 13 | 0 | 8 |
| 合计 | 310 | 129（42%）| 16（5%）| 79（25%）| 15 | 56 | 15 | 72 |

- 有结局的 224 条（有检查、映射得到、程序构建成功）：fixed 58%、touched 7%、untouched 35%。§4.3 的线是 untouched ≤ 10%、fixed ≥ 70%。
- 更正（§30）：以守卫身份送回的回退条目（rep1j G57，rep1k G5×2、G87、G88）不在 review_items 里，之前被误算成 no_check；它们带着守卫的检查，现已按检查判。上表和 §28 的数字都已按此更正（no_check 20 → 15）。
- untouched 79 条里 72 条被"无进展"停送。命令根本没写（absent）的 4 条：rep1l R2 的 normalize、encode、rollup、detect。
- 按送出它的消息里有几条条目分组：1–5 条 68 次，untouched 占有结局的 43%；6–10 条 193 次，38%；11 条以上 109 次，32%。消息越大，untouched 的比例并没有更高（设计会话据此撤回了消息条目上限）。

## 28. 输出口径与 stem 口径逐条对照（DESIGN-DEEP §4 改版 f82c288）

**做法**：同一脚本（`outcome.mjs`）加了第三种判法 output：周期上该条目 verdict=pass → fixed；否则该周期检查输出的摘要等于送出时的摘要 → untouched；否则 touched。摘要用的是条目记录里的 `digest`，也就是停送规则比较的那个：结局、退出码、每条断言的实际值、失败类别和原因。没有检查的 15 条（按审查员原话发出）没有输出可比，单列；程序没构建成功的周期单列 build_failed（rep1j C5.1、rep1k C5.1，15 条）。对照表和不一致清单在 outcome.md 的"Output rule against stem"一节。

**输出口径的结果**：310 条里 fixed 129、touched 6、untouched 145、no_check 15、build_failed 15。有结局的 280 条：fixed 46%、touched 2%、untouched 52%。untouched 中被停送 124 条。按消息大小：1–5 条 49%，6–10 条 44%，11 条以上 52%。

**一致率**：
- 轮末两种口径都能判的 224 条（stem 映射得到、输出有记录）：205 条一致（92%）。fixed 两边完全一样（129 条）。
- 逐次送出比（339 次，不含 no_check、build_failed）：228 次一致（67%）。stem 判 unmapped 的也算进分母，所以比轮末低。
- stem 映射不到的 56 条，输出口径判 untouched 55、touched 1。
- 命令根本没写的 4 条（absent），输出口径也都是 untouched：输出每次都是同一个错误，和设计会话的预期一致。

**轮末不一致的 19 条，分两类**：
1. stem 判 touched、输出判 untouched（15 条）：命令的派发代码在 diff 里变了，但这条检查的输出逐字没变。其中 rep1k R6 的 7 条都在 C6.1（本轮第一次交付，一次改了很多派发）；rep1j R1 的 V1.1.9、V1.3.7 判在被回退的周期上；另外 6 条是 rep1k R1/R2 的 window、bin，rep1l R2 的 pivot、pipeline、compare。
2. stem 判 untouched、输出判 touched（4 条）：派发代码没变，但输出变了，靠的是共用函数的改动。分别是 rep1l R1 V1.3.3 pipeline、rep1l R2 V2.3.2 compare、rep1m R2 V2.3.6 和 V2.3.7 profile。

**两种口径在说什么**：stem 看的是"执行方改没改这个命令的代码"，输出看的是"改动有没有让这条检查的输出变"。第 1 类是改了但没起作用，按输出口径算 untouched，停送规则也是这么停的。第 2 类是共用代码的改动带动了输出，锚点名映射看不到。输出口径不需要名字映射，unmapped 为 0。

## 29. 批 3（c）（b）：文件存在性的"已陈述"、删掉检查的取反方向

用户放行 (c) 和 (b)（2026-10-25，经设计会话）；(a) 停送规则暂不做，范围留在 DESIGN-DEEP §4.2。

### 29.1（c）文件存在性的期望按"原文提到这个文件"算已陈述

**做法**：`checks.ts` 新增 `statesValue(text, target, expect)`。target 是 file_exists、期望是布尔值时，如果原文（去掉 Markdown 后，不分大小写）里出现该文件的名字或扩展名（如 `.sha256`），就算已陈述；其他情况照旧用 `statedIn`。两个调用点共用这个函数：库检查的 verbatim 校验（`checkChecks`），和条目前提（`assessPremises`）。库检查重答提示里"'writes the file' 表示文件存在，改用 derived"那半句一并去掉，因为现在代码直接认。

**依据**：rep1j R5 的 V5.1.1、V5.2.1、V5.3.1，三条都写成 file_exists=false、verbatim、引用 R5.S1.P3.s5（"no longer writes `.sha256` sidecar files"）。布尔值 false 永远不会逐字出现在原文里，所以三条都被记成 value_not_stated（§28 之后查明，它们并没有因此不送）。

**验收**：
- rep1j R5 三次审查用记录下来的回复重放（起运行自己的服务读会话，记录下来的程序在 docker 里跑；脚本沿用 `batch2-2026-10-25/replay-premises.mjs`，结果在 `exp2/evidence/batch3-2026-10-25/rep1j-R5.{1,2,3}-c.json`）：value_not_stated 3 → 0。三条仍然发出、仍然能复现；另外 6 条结果和运行记录相同（V5.x.2 发出，V5.x.3 不复现、挡下）。
- 测试：库检查一条（引用提到 `.sha256` 的单元算已陈述，引用不提这个文件的单元要重答），条目前提一条（引用 R5.S1.P3.s5 不报，引用过滤单元报 value_not_stated）。
- 全量测试：这次主机连续拦截新构建的程序（spawn UNKNOWN，每跑一次有二十多处，逐个文件重跑也拦），本地全量测试不能当闸门。逐个文件重跑后，凡是失败的都伴有 spawn UNKNOWN，或者属于已知的 10 条环境问题，没有一条是断言失败；recording.test 有一条没报 spawn 的失败，单独重跑通过。replay-baseline（七个 R1 重放）在本地构建 dpipe.exe，连跑三次都被拦，这次没跑成；做 (b) 时再跑全量测试，拦截少了，它跑通了，和基线相同（这时 (c) 和 (b) 都已在内）。

### 29.2（b）检查不再有取反方向

**做法**：检查只陈述当前文本要求的行为。
- 去掉 `CheckDraft.direction`：检查编写的输出 schema 里的这个字段及其 required、形状校验、store 记录检查时的拷贝，以及 formalize 和 guards 里写死的 `"holds"`。
- verdict：通过 = 全部断言满足（不再对 withdrawn 取反）；去掉失败原因 `still_present`；强度只按"在上一版程序上挂、且有关于数据的断言"判。
- 旧记录：`CheckRecord.direction` 留成可选字段，只为读旧状态，代码不再读它。写成 withdrawn 的旧检查，断言照原样当作当前要求读；每轮报告的 Check writing 一行列出这些检查（`checks.read_as_holds`）。设计会话同意不加出生校验。
- 测试桩：R5 的 transform-no-sidecar 原来写成 withdrawn（"写 sidecar 且内容是摘要"，取反后才对），现在改成直接陈述 R5 的要求：`out.csv.sha256` 不存在（verbatim，引用 R5.S1.P3.s5，靠 (c) 才算已陈述），另加一条输出首行的断言，让它仍然是强检查。checks.test 对应用例改为：在 R3（还写 sidecar）上挂，在 R5 上过。

**依据**：rep1j 的 K37 写成 withdrawn，断言却已经是新要求（sidecar 不存在），取反后在 sidecar 存在时通过，出生为 G57，把 C5.3–C5.5 三次正确的修补都判成回退（§28 之后查明）。

**验收**（`exp2/evidence/batch3-2026-10-25/replay-withdrawn.mjs`，输出 `withdrawn.md` / `withdrawn.json`；只读状态和 git 历史，程序按运行时的方式在 docker 里构建，不调模型）：
- 全部 13 次真实运行：写成 withdrawn 的检查只有 rep1j 的 K37，由它出生的守卫只有 G57（C5.2）。其他运行没有 withdrawn 检查，它们的守卫判定在新旧代码下相同，受影响的守卫只有 G57。
- rep1j R5–R6 每个周期的程序上按新读法跑 K37：C5.1 构建失败；C5.2 挂（sidecar 存在），所以不出生守卫（运行里 G57 就是在这里出生的）；C5.3、C5.4、C5.5 都过（sidecar 已经去掉）；C6.1–C6.3 都过。运行记录里 C5.3–C5.5 三次回退的"挂掉的守卫"都只有 G57，没有 G57 就没有这三次回退。
- 推断（未重放）：没有这三次回退，V5.1.1/V5.2.1/V5.3.1 这三条 sidecar 条目在 R5 就会按修补后的程序判；K37 在同样的程序上已经过了，说明 sidecar 在那几次修补里已经去掉。
- 测试：全量 976 条里 965 过；失败的只有已知的 10 条环境问题，replay-baseline 通过。checks.test 用 tsx 单独跑时还有两条失败（R10 的 JSON 比较、R5 的 verify-blake2b），在批 3 之前的提交 5c34df5 上同样失败（生成的 Node 替身程序里有一处语法错误），编译后的全量测试里它们是通过的。

## 30. 带入能不能解决 untouched；执行方回避的是哪类条目（零成本）

**做法**：`exp2/evidence/repair-outcome-2026-10-25/followups.mjs` 读 `outcome.json`，输出 `carry.md` 和 `form.md`。`outcome.mjs` 补了三样：
- 以守卫身份送回的回退条目（G 开头）按守卫的检查判，不再误算成 no_check（§27、§28 已按此更正）；
- 代码口径：stem 锚点映射用在每一条送出的条目上，包括只有原话的条目，对象取检查的，没有检查就取条目单元的归属；
- 每条条目的形态（带检查 / 只有原话）和命令新旧：对象最早的原文出自送出它的那一轮，算本轮新命令，否则算早轮命令。

**1. 轮末 untouched 并带入下一轮的条目，下一轮的结局（输出口径）**：
- 共 83 条（设计会话说的"48 条左右"是 stem 口径下的数）。下一轮 fixed 22（27%）、touched 0、untouched 46（55%）、build_failed 15（18%，下一轮第一周期构建失败：rep1j R5、rep1k R5）。带入的条目都随工作消息送出了，没有"未再送出"。
- fixed 集中在少数几轮：rep1j R1→R2 7/11、R5→R6 6/6，rep1l R1→R2 4/8，rep1k R1→R2 2/6、R5→R6 1/2。rep1k R2→R3、R3→R4 一共 18 条一条没修好，rep1m R1→R2 6 条也都没修好。
- 从第一次轮末 untouched 算起连续 untouched 的轮数：1 轮后修好 22 条；连续 2 轮及以上的 26 条，其中 11 条在之后某轮遇到构建失败，其余 15 条之后没有再被带入（运行到了最后一轮，或条目离开了账本）。
- 回答：只靠带入，大约四分之一能在下一轮修好，一半多下一轮仍然没碰；连续没碰的条目在 rep1k 上一直拖到 R4。

**2. 执行方回避的是哪类条目（轮末，每条条目在它被送出的每一轮各算一次）**：
- 按形态：带可执行检查的 295 条，代码口径 untouched 35%（224 条有结局），输出口径 52%（280 条有结局）；只有原话的 15 条里 13 条映射不到命令（没有对象，或对象名不是"X operation/command"这类），只有 2 条能判，这四次运行回答不了"原话条目是不是更容易被回避"。
- 按命令新旧（只看 R2 及以后；R1 里所有命令都是新的）：本轮新命令 84 条，代码口径 41%、输出口径 43%；早轮命令 140 条，代码口径 37%、输出口径 61%。两种口径不一致：代码口径下差不多，输出口径下早轮命令的条目更多是"输出没变"。
- 按运行（代码口径，早轮命令）：rep1k 44 条里 28 条 untouched（64%），rep1j 31 条里 1 条，rep1l 11 条里 4 条，rep1m 5 条里 1 条。早轮命令被回避主要集中在 rep1k。

## 31. 批 3（a）：修补结局按输出口径，untouched 不停送（DESIGN-DEEP §4.1、§4.2，d48d248 收口版）

用户放行（2026-10-25，经设计会话）。

**做法**：
- 新文件 `src/exp2/repairs.ts`：修补回路的决策写成一个纯类 `Repairs`，`accept.ts` 和离线重放都用它；旧的 `Sends` 只剩非审查模式（`executeRound`）在用。
- 结局：周期上检查通过 → fixed；输出 digest 等于送出时 → untouched；变了但没过 → touched；被回退的周期 → reverted，不算前两者，也不推进 touched 计数和送出次数。结局记在条目记录上（`ItemSighting.outcome`）。
- untouched 不停送：每周期把这些条目合成一条单独的消息（`untouchedMessage`），和修补清单分开，在同一周期里接在修补清单后面发（只有 untouched 时就单发这一条），所以周期上限不变。每条带检查的命令、输入文件、程序现在的输出和期望（`renderUntouchedItem`），要求执行方按编号逐条答 `done` / `not done: …` / `disagree: …`（`answersIn` 解析）。同一条目一轮内首发之后只单独重发一次（`UNTOUCHED_RESENDS = 1`；按修补清单重发的 touched 条目不占这个名额），仍 untouched 就留到轮末带入下一轮。
- 作答只用于路由：disagree，或答 done 但检查仍挂 → 停送，连检查送审查员。touched 连续两周期不过 → 停送，连检查送审查员。同一条目第二次被回退 → 停送，把挂掉的守卫和条目一起送审查员；第一次回退照旧重发一次。
- 审查员问题通道：沿用审查请求附录（accept.ts 原 :402 一带），新增"Items the repairs did not settle"一节（`ReviewFocus.itemQuestions`，每条带检查的命令、输入、期望、实际；二次回退的还带守卫）。审查员写 `SUPERSEDED <条目 id>` → 条目结束，账本记 superseded；写 `SUPERSEDED <守卫 id>` → 守卫退役，条目重新进入修补；都不写 → 维持（本轮不再送，带入下一轮）。`supersededIn` 和 `reviewEntries` 的 SUPERSEDED 行识别扩展到条目 id。有待问的条目时，即使上一次审查没找到新问题，也会再审一次（审查次数和周期上限照旧）；本轮没轮到审查的记为 unasked，带入下一轮。
- 轮结束：没有要送的就结束（全部 fixed，或剩下的都在审查员处、已维持、或 untouched 已用完重发次数），或者到周期上限。
- 跨轮：ledger 的 expired 改为"连续 EXPIRE_ROUNDS 轮，每轮末输出都和上一轮末不同且仍挂"（touched、没修好）；输出不变的条目不再过期，而是继续重发。expired 的条目输出再变也不重新打开。照旧只对没复现的条目生效，除非开了 `expire_reproduced`。
- 带入下一轮：放在工作消息最前面（原来放在工单后面），自上次送出后输出一直没变的标 `(untouched since R{n})`（`untouchedSince`）。
- 报告每轮加一行（`renderRepairs`）：untouched 消息条数和条目数、作答分布、单独消息后下一周期的结局（仍 untouched 的条数和比例，对照预注册线 26%）、送审查员的条目及审查员的回答。

**离线验收**（`exp2/evidence/batch3a-2026-10-25/replay-repairs.mjs` → `repairs.md` / `repairs.json`）：把新规则逐周期套在四次运行记录下来的条目记录上，和运行当时的决定对照。只是重放决策：输出用的是记录下来的，执行方对新消息会怎么做离线不知道，所以 fixed 只做一致性检查。
- 运行里因"无进展"停送、且这时是 untouched 的：条目×轮 139 次（设计稿的 124 是 outcome.json 里"轮末 untouched 且被停送"的口径；这里数的是轮内任一周期因无进展停送时为 untouched 的条目），新规则下 139 次全部进入 untouched 单独消息；新规则下因"无进展"停送的为 0。
- 新规则下 untouched 单独消息共 37 条，含 139 个条目；重发后仍 untouched、带入下一轮的条目记录 235 次（这是周期级的记录次数，不是条目数）。
- 送审查员：二次回退 11 次（rep1j R1 7、R5 4），touched 连续两周期 3 次（rep1k R1、R5，rep1l R2 各 1）。
- rep1j R5：V5.1.1 在 C5.4、V5.2.1 在 C5.5 第二次被回退，运行里是停送（"回退后已重发过一次"），新规则下送审查员、带守卫 G57；V5.3.1 只回退过一次，照旧重发。
- fixed：两边都是 140（一致性检查）。

**测试**：
- `test/exp2/repairs.test.ts`（8 条）：纯规则逐条测——untouched 的单独重发和名额、touched 两次、回退两次、作答路由、审查员的回答、带入条目和 quiet、作答解析和消息格式、untouched since。
- `block-accept-fix` 新增两条整轮测试：修补没改动 → 单独消息（带检查）→ 答 not done → 仍 untouched → 停送且不是"无进展"，报告行写"still untouched 1 (100%; the line is 26%)"；答 disagree → 下一次审查带"Items the repairs did not settle"→ 审查员 SUPERSEDED → 条目结束，账本 superseded。
- 两条旧测试按新规则改了：block-accept-fix 的过期测试改为"输出不变不过期、每轮都变才过期"；block12 的账本测试把 A 的输出改成每轮都变。
- 全量测试：986 条里 969 过；失败的除已知 10 条环境问题外，block12 的账本测试已按新规则改过并通过，其余（mutation、serial 几条、block10 的探针）逐个文件重跑都通过，原因是主机拦截新构建的程序（spawn UNKNOWN）。replay-baseline（七个 R1）通过，和基线相同。

## 32. rep1n：批 3 之后的一次 6 轮真实运行

用户决定（2026-10-25，经设计会话）。代码 aac0f01（批 3 的 c、b、a），配置从 rep1m 复制，只改运行编号、端口（46017/46018）、缓存键、label；delta，执行方 low，rounds 6，--to 6。全程 0 次续跑，没有崩溃或环境错误。表：`exp2/evidence/rep1n-2026-10-25/table.md`（脚本 `table.mjs`），R1、R3、R4 的失败分布在 `failures-r1-r3-r4.md`。

**官方分**（括号里是首次交付）：

| 轮 | rep1n | rep1j | rep1k |
|---|---|---|---|
| R1 | 167 (52) | 177 (108) | 196 (100) |
| R2 | 465 (287) | 480 (395) | 474 (410) |
| R3 | 519 (517) | 534 (534) | 534 (521) |
| R4 | 623 (623) | 638 (630) | 630 (623) |
| R5 | 659 (659) | 673 (673) | 666 (666) |
| R6 | 692 (691) | 710 (699) | 698 (696) |

每一轮都低于两个基线。

**差在哪**：R1 的残留。rep1n R1 末挂 52 个（window 28、fill 10、aggregate 6……）。R2 末起一直挂着同样 16 个 R1 用例，到 R6 都没修好：window 11、join 2、pivot 2、derive 1。rep1j 在 R2 末只剩 derive 1。审查员报过的 4 条 window 条目（V1.2.6、V1.2.7、V1.3.4、V2.3.1）按各自的检查都在 R2 修好了；剩下的 11 个 window 用例测的是这些检查没覆盖到的情形，R2 之后也没有审查员再报 window。所以这 16 个是"看见"（审查与检查覆盖）的缺口，不是修补回路扣着条目不送。R5、R6 新增的是 manifest 5、determinism 2、ingest 1，和 rep1j、rep1k 同类。

**修补回路（批 3a 的新度量）**：
- untouched 单独消息：R1 2 条（7 个条目），R2 3（10），R3 1（4），R4 1（1），R5 1（3），R6 2（4）。
- 作答：done 24、not done 0、disagree 5、none 0。执行方几乎总是答 done。
- 单独消息后仍 untouched：R1 0/7、R2 4/10（40%）、R3 4/4（100%）、R4 0/1；R5、R6 单独消息之后的那个周期被回退或已到周期上限，没有可判的。合计 8/22（36%），高于预注册线 26%。
- 送审查员 22 次。
  - 真正问到的只有两轮：R2 维持 2 条（V1.2.6 window、V1.3.2 sample，之后 V1.2.6 在 C2.4 修好）；R3 SUPERSEDED 4 条（V1.3.2 sample fraction、V2.1.2 profile 统计、V2.1.8 bin 未实现、V2.2.1 detect mad）。
  - 其余 16 次是 unasked：送审发生在本轮最后一个周期，后面没有审查了。
  - R3 被 SUPERSEDED 的 4 条，对应的官方用例在 R3 末都不在失败里（R3 末的 16 个失败全是 R1 的 window/join/pivot/derive），所以这 4 次裁决没有造成官方失分。
- 翻转与回退：R1–R4 都是 0。R5：原文改动 3 次（G6、G9、G14，审查员 SUPERSEDED 退役）、regression 6 次（G5、G7 在工作周期，G64、G65 两次），回退 2 次。R6：regression 6 次（G64、G65、G5、G7），回退 2 次。R5、R6 的二次回退（V4.1.3、V5.2.1 连守卫 G5/G7/G64/G65）都是 unasked。

**成本**：R3–R6 的审查请求字符（62k、22k、38k、38k）和 formalizer 未缓存 token（29k、7k、17k、25k）都明显低于 rep1j（147k–172k；82k–112k），包也小（6k–25k 字符）。R1、R2 与基线相当。conservation 错误全为 0；no_input 只有 R1 1 条。

## 33. R2 审查员回看 R1 命令的由头：rep1j、rep1k、rep1n（零成本）

**做法**：`exp2/evidence/rep1n-2026-10-25/r2-findings-on-r1.mjs` → `r2-findings-on-r1.md`。
- 条目所在的命令按它的检查所跑的配方 `op` 判，没有配方时按条目文字里的操作名判。不按对象名：rep1j 的归属把所有操作归成了一个 Transformation 对象。
- 条目引用的单元在 R2 包里以什么身份出现，读的是每轮报告里记录的包：rep1j 记的是整对象视图及其理由，rep1k、rep1n 记的是段及其理由。
- R2 末 R1 用例残留取自评分提交的 verifier 日志（只读用例名和 requirement_ref）。

**结果**：

| 运行 | R2 发现 | 落在 R1 window/aggregate/join/pivot | 这些发现引用的单元在 R2 包里的身份 | R2 包里的 R1 原文 | R2 末 R1 用例残留 |
|---|---|---|---|---|---|
| rep1j | 17 | 5（pivot 3、window 1、aggregate 1） | 本轮对象视图 15 | 整对象视图：本轮 3 个、边 3 个 | 1（derive） |
| rep1k | 19 | 3（window 3） | 开放项段 13 | 段：开放项 8、修订 1 | 1（derive） |
| rep1n | 19 | 3（aggregate 2、window 1） | 开放项段 7 | 段：开放项 11 | 16（window 11、join 2、pivot 2、derive 1） |

**读法**：
- rep1j 的 R2 包按对象交付。R2 修订了 Transformation 对象，它的整个视图（包括全部 R1 操作的原文）以"本轮"身份进了包，审查员在 R2 回头找到了 5 条 R1 操作的问题。
- rep1k、rep1n 按段交付。R1 操作的原文只在有开放项带着时才进包，落在 R1 命令上的发现引用的也全是开放项段。没有开放项指着的 R1 操作，R2 的审查员看不到它的原文。
- 这支持"按需交付去掉了审查员回看早轮命令的由头"的推断，但不是全部原因：rep1k 同样按段交付，R2 末残留也只有 1，因为它 R1 末只挂 23 个；rep1n R1 末挂 52 个（window 28、fill 10、aggregate 6……），开放项只覆盖到其中一部分，没覆盖到的就一直留着。

## 34. 批 4：原文状态层与审查范围（BATCH-4-2026-10-25，DESIGN-DEEP §1–§2）

设计会话 2026-10-25 定的六点：
1. 翻转分类的 edge 来源改为单元同属（cue、revision 单元；guard 单元不参与）。
2. 检查重新派生和任务区都改用单元。
3. 保留单一属主。
4. guard 单元不做传递合并。
5. "各至少一条检查"按审查员会话里对每个命令至少跑过一次程序算。
6. E2 只进报告；名单附的段放审查请求附录，不计入 40k 包预算，单独计字符，软上限 15k，超了先去轮巡命令的段。

### 34.1 E1a：变化单元与修订出处（纯代码，不调模型）

**做法**：新文件 `src/exp2/units.ts`。全部由原文、已接受的归属和检查推出，不另存。
- `cuesIn`：作者线索，在代码里提取，不进模型提示。规则从 cues-units.py 移植：changes_to、cross_list、prev_new、scope_unchanged、author_id、点名命令的修订句。
  - 作者编号只认 F12、Section 21、§3。`round-N`、`vN` 不算：d10_w4 原表里的 78 个全是 API 路径里的 v1、v2。
  - 标题行不算句子，但"Changes to `X`"从小节标题读。
- `cueUnits`：
  - 一个 Changes to 小节，它下面的全部句子；
  - 同一个顶层小节里点名命令的修订句（或 previously/instead/no longer 句），合成一个跨命令单元。命令按反引号里的名字对到对象：先认名字正好是 X、"X command"、"X operation"的对象，没有时才认以 X 开头的；
  - 同一个作者编号被多处引用，成一个单元；
  - "all commands"只列出，不展开。
- `revisionUnits`：每条修订记录，新旧句子一个单元。
- `guardUnits`：每条检查（和由审查条目出生的守卫）的单元自成一个，不做传递合并。
- `provenance`：修订的新文本（或它所在小节的标题）带修订线索，就标 cue 并附线索原文，否则 inferred。
- `scopeDeclarations`：给 E2 用。
- 测试 `test/exp2/units.test.ts`，5 条。

**数字**：
- 验收 1 的前一半：dpipe R5 "Behavior Change: verify command checksum algorithm"一节成一个 cue 单元，7 个句子。rep1n 的对象里它覆盖 verify、ingest、transform、manifest 四个命令；rep1j 的对象里是 Manifest、Verification、Ingestion、Transformation 四个。
- 验收 3（`exp2/evidence/batch4-2026-10-25/cues-tasks.md`，四个任务只读 instruction.md）：

  | 任务 | changes_to | cross | prev/new | 范围声明 | 作者编号 | 点名修订句 | cue 单元 |
  |---|---|---|---|---|---|---|---|
  | dpipe | 0 | 1 | 15 | 1 | 0 | 18 | 7 |
  | d10_w4 | 0 | 0 | 12 | 12 | 0 | 9 | 4 |
  | d12_w1 | 0 | 0 | 13 | 6 | 121 | 19 | 57 |
  | d8_w5 | 5 | 3 | 10 | 0 | 0 | 4 | 10 |

  和 change-unit-cues 的表同量级。差别：作者编号不再算 vN；标题行不再单独算；prev/new 多认了 "now produces" 和 "(not X)"。d10_w4 的范围声明出现在 R2–R7 每一轮，R1 是第一轮，没有。
- 验收 4（`provenance-r2.md`，另附 R3、R5）：
  - rep1j、rep1k、rep1l、rep1m 的 R2 修订记录重标：7/1/0/1 条，全部是 inferred，cue 类 0 条。R2 在 gold 里没有修订，这 9 条都是误记，没有一条被标成 cue。
  - R3–R6（rep1j、rep1k、rep1n）：cue 类 14 条，全部在 gold 上（100%）；inferred 类 18 条，其中 10 条在 gold 上。
  - "在 gold 上"的判法是新文本在 gold 句子所在段里或包含它（整节的修订包含那一段）。只按段相等比，会把 rep1n R3 那条整节修订误判成不在 gold 上。

### 34.2 E1b：归属确认变化单元，对象级边取消，消费者改用单元

**做法**：
- 归属请求：去掉"新文本提到了哪些对象"（candidates，原来给边用），换成 `unit_candidates`，即代码按作者线索找出的本轮单元：id、名字、线索原文、成员句子、点名的命令。
- 归属回答：去掉 edges_add/edges_remove，换成 `units_add`/`units_remove`。
  - 对候选：不提 → 按代码给的原样成立；给更少的成员 → 收窄；成员 [] → 去掉；不能加候选没有的成员。
  - 自己的单元（candidate null）：至少两句，至少一句是本轮的，不能有后面轮次的句子。
  - 提示里讲边的那一段换成讲单元的一段。
  - 旧回复（录制带、测试替身）里的 edges_* 读入时忽略，缺 units_* 当作空。
- registry：
  - `references` 不再产生，旧记录里的不读；没有 units 字段的旧回答，本轮的全部 cue 候选按代码原样成立。这样四次旧运行可以不调模型就按新代码重放。
  - `units()` 给出归属的单元（cue、model）和每条修订（revision）。
  - 变化记录里原来由 applies_to 带来的 `applied`，改由单元带来：本轮某个单元点名的命令，如果不拥有该单元本轮的任何一句，就把这些句子记到它的变化记录上，它因此进本轮范围和任务区。types 里的 "applies_to" 改名 "unit"。"all commands"类单元只列出，不带范围。
- 消费者：
  - 翻转分类（`changedTextBehind`）：edge 来源改为 unit 来源，即与守卫依赖的句子同在一个 cue/revision/model 单元的句子本轮被修订。guard 单元不参与。
  - 检查重新派生（`staleChecks`）：新增 cause "unit"，同在一个 cue/model 单元的句子本轮被修订。revision 单元就是原有的依据规则本身，不重复算。
  - 探针（`staleProbes`）同理。
  - 关系召回（gold.ts）：by_edge 改为 by_unit。
  - attribute 工具：输出单元。
  - 工单：原来的"Edges (reference only)"一行，换成"本轮触及任务对象的单元"一行。
  - 包（view.ts）：去掉边带入的段和对象头。第三类内容在 E3 改由单元带入，E1b 到 E3 之间没有运行。
  - compare 工具：去掉 applies_to 对照。
- 顺带修了一个已有的缺陷：checkAnswer 里，"最具体的指派优先"会把外层块拆成几部分，overlap 消息却去拆分前的表里找这些部分的属主，取到 undefined 就抛错。d12_w1 R2 的真实回答第一次触发了它（见下）。已改为在拆分后的指派里找，并加了一条复现测试：改前失败，改后通过。
- 测试：替身归属里的边全部去掉。按单元重写的有：attribution（单元校验）、batch 1b 的 K8 用例（R1 替身给一个"排序句与 sidecar 句"的 model 单元，R5 撤回 sidecar 句，排序守卫背后来源为 unit）、propagation（单元单独把 transform 带进范围）、rounds、recording、chain。chain 里"applies_to 边带来整个对象"那一条删掉，等 E3。中性检查测试（模型看到的文字不含 dpipe 的名字）抓到提示里的 "drop it"，改成 "remove it"。下面的归属调用是在改这个词之前跑的，只差这一个词。

**离线重放**（`exp2/evidence/batch4-2026-10-25/replay-e1b.mjs` → `replay-e1b.md`；rep1j–rep1n 五次运行，按新代码从各自已接受的回答重建 registry，不调模型）：
- 翻转：共 31 次，29 次分类与运行记录相同，审查员 superseded 退役的都仍是"背后原文变了"（rep1j R2 G3、R5 G1；rep1k R3 G40、R5 G2/G3/G4/G16；rep1n R5 G6/G9/G14）。原来带 edge 来源的 G3、G4 现在只剩 object 来源，分类不变。
  - 分歧 2 次：rep1k R6 的 G87、G88（R5 出生的 sidecar 守卫）。运行里靠"R1.S6 refers_to O2/O3；R1.S6 被 R6.S9 取代"判为原文变了，问了审查员；审查员没判 superseded，两条随即作为 regression 送修。现在直接判 regression，结局相同。R1.S6 是 pipeline 一节，和 sidecar 无关。
- 检查重新派生：五次运行每一轮都和记录相同（0 处差异）。没有哪个 cue 单元把检查依据和本轮修订句连在一起。
- 范围（经别的对象的文字进入本轮）：
  - rep1j R6、rep1k R6：dpipe CLI 原来靠"R6.S1 applies_to O1"进范围，现在不进。R6.S1 是新的全局标志 `--audit`（"Any `dpipe` command can accept…"）。"any … command"不在 cross_list 线索里，而且 all 类单元只列出、不带范围。这一点留给设计会话定：要不要把"any/every command"算作线索，以及 all 类单元是否带范围。
  - rep1n R5：ingest command 由 U5.c1（R5 的行为变更）进范围。运行里没有边带它，它在 R5 也没有自己的句子。这正是横切要的效果。

**归属调用**（模型只调归属一步，5.6 medium，rep1n 的管理服务，用完已停；`attribute-units.json`）：

| 作业 | 轮 | 调用 | 候选 | 模型怎么处理 | 结果单元 |
|---|---|---|---|---|---|
| dpipe R5（rep1j 的 R1–R4） | 5 | 2 | 1 | 不提（原样成立） | U5.c1：Manifest、Verification、Ingestion、Transformation |
| rep1j R2 | 2 | 1 | 1 | 原样列回 | U2.c1 Extended transforms：Transformation、Detect transform |
| rep1k R2 | 2 | 1 | 1 | 原样列回 | U2.c1：fill、detect |
| rep1l R2 | 2 | 1 | 1 | 不提 | U2.c1：fill、detect |
| rep1m R2 | 2 | 1 | 1 | 原样列回 | U2.c1：fill、detect |
| d10_w4 | 1–3 | 2/1/2 | 0/0/1 | R3 原样列回 | U3.c1 Behavioral Changes (Conflicts)：Pipeline Engine、Model Registry、Experiment Tracker |
| d12_w1 | 1–3 | 3/2/1 | 1/1/5 | R2、R3 列回 | R1 一个跨 5 个命令的单元；R3 五个 |
| d8_w5 | 1–3 | 1/2/2 | 0/2/7 | 列回，R3 另加 3 个自己的单元 | R3 Changes to validate/build/diff/promote/history 各一个，另有跨 diff/promote 的一个 |

- 全部 14 个作业都接受了。修补都是原有的归属问题（unknown_block、target_not_earlier、target_replaced 等），没有一条是单元问题。
- 这些单元落到的命令在本轮都有自己的句子，所以没有一个作业出现"仅由单元带进范围"的对象（rep1n R5 那种情况只在重放旧运行时出现）。
- token：留下的 22 次调用合计未缓存输入 235,126、缓存读 201,728、输出 16,916。另有 d12_w1 第一次尝试：R1 3 次调用（未缓存输入 13,541、输出 2,744），以及 R2 撞上上面那个缺陷时的调用（崩溃前没写盘，token 未知）。

**测试**：改动涉及的测试文件逐个跑都通过。修缺陷前跑过一次全量：990 条里 978 过，失败的除已知 10 条外只有中性检查那一条，已改。

### 34.3 E2：范围声明进报告

**做法**：每轮报告新增 `scope_declarations`，即 units.ts `scopeDeclarations` 找到的本轮"没提到的行为照旧 / 继续成立 / remains unchanged"类句子，记为"本轮全部守卫在力"，渲染成一行 "Scope declarations: …"。按设计会话第 6 点，只进报告，守卫重跑、翻转分类和请求都不受影响。

**数字**：见 §34.1 验收 3。d10_w4 R2–R7 每轮都有（12 句）；d12_w1 R2–R7 每轮各 1 句；dpipe 只有 R12 一句（"remain unchanged"）；d8_w5 没有。测试：units.test 加一条（dpipe R12 一句，R5 没有）。

### 34.4 全局单元（设计会话对 §34.2 遗留点的决定）

**决定**：
- "every/each command"和"any `X` command"算作 cross_list 线索，形成 all 类单元（全局单元）。
- 全局单元只把句子点名的对象和句子自己的属主带进范围（R6 的"Any `dpipe` command can accept --audit"→ dpipe CLI），恢复 rep1j、rep1k R6 的行为；不把全部命令拉进任务区，不把各命令的段带进包。
- 在审查请求里单列为"全局单元"，要求审查员至少在两个不同命令上跑过（E4 里做）；报告记全局单元数和覆盖到的命令数（E5 里做）。

**做法**（units.ts、registry.ts）：
- cross_list 正则加上 `every|each … command` 和 `any \`X\` command`。不带名字的"any command"不算：R6 里"Null for manifest and any command without an identifiable input"是误命中，已排除。
- 全局单元的 objects 改为句中反引号名字对到的对象（`dpipe` → dpipe CLI）加上句子属主。
- registry 不再跳过全局单元。由于它的 objects 只有这些，不会把全部命令带进范围。

**数字**：
- 重放（`replay-e1b.md` 重跑）：rep1j、rep1k R6 的范围差异消失，dpipe CLI 由 U6.c1 进范围；rep1n R6 同样带进 dpipe CLI；rep1n R5 的 ingest 不变。翻转、检查重新派生的结果不变。
- 线索计数：dpipe 的 cross_list 1 → 2（多了 R6 一句），d8_w5 3 → 4，cue 单元 dpipe 7 → 8、d8_w5 10 → 11。
- 测试：units.test 加一条（R6 一个全局单元，objects 只有 dpipe CLI）。

### 34.5 E4：审查范围由两张名单决定

**做法**：新文件 `src/exp2/lists.ts`；serial 在每轮开始时按手上的事实算出名单，经 `AcceptDeps.lists` 交给本轮每一次审查，写进审查请求附录（review.ts）。设计会话对口径的选择（2026-10-25）：
- 未结名单：
  - 带入条目（失败守卫、untouched、开放项）所在的命令，附条目单元所在段的当前原文，不附整视图；
  - 早轮库检查在基线上失败的，只给一行"检查 id：失败原因"，因为它们已经作为线索附输入和期望给审查员。
- 轮巡名单：曾有审查条目、已 ≥2 轮无条目的早轮命令，每轮 ≤2 个。按距上次有条目或上次被轮巡的轮数降序，被轮巡过就算回看过，所以会轮转。附该命令当前原文，每个命令上限 3k 字符，超出只给段标题路径加首段。
- 本轮跨两个以上命令的单元：逐个列出它的命令。
- 全局单元：要求至少在两个不同命令上试。
- 软上限 15k：先去轮巡段，再去带入条目段，从最早轮的条目开始；命令名和原因永不裁。
- 覆盖：从审查员会话里的程序调用认出跑过的命令（子命令；transform 按会话里配方文件的 op）。名单上没跑过的命令、跨命令单元缺的命令，都记为覆盖缺口。
  - 全局单元按严格口径：从句子里认出反引号的 `--flag`，统计带这个标志的调用覆盖了几个子命令，不足两个记缺口；认不出标志的记"无法判定"，既不算缺口也不算覆盖。
- 每轮记录在 `accept.lists`：名单内容、附录字符、裁掉的项、跑过的命令、缺口、全局单元覆盖、名单上命令的审查条目（"由名单带来的发现"）。报告行在 E5。

**验收 2**（`exp2/evidence/batch4-2026-10-25/replay-lists.mjs` → `replay-lists.md`；按每轮开始时的事实重建，不调模型）：
- rep1n R2：未结名单含 window operation（V1.2.6、V1.2.7、V1.3.4、K6），附录里有 window 的当前原文。rep1k R2 同样。rep1j R2 只有 Transformation 这一个粒度，见上。
- 轮巡名单从 R4 起非空：rep1n 是 ingest output、transform command；rep1j 是 Verification、Pipeline；rep1k 是 filter、aggregate。R2、R3 必空，规则使然；验收按设计会话的修正，从 R4 起看。
- 附录字符：按上述口径，所有轮都在 15k 以内（最大 rep1k R5 12,365），没有裁剪。按整视图附文的话，是 21k–58k。
- 跨命令单元：R5 的 U5.c1 在三次运行里都列出四个命令。全局单元：R1 一个（cross_list "all … commands"，认不出标志，记无法判定），R6 一个（`--audit`）。

**测试**：`test/exp2/lists.test.ts` 6 条，覆盖：
- 未结名单的两种写法；
- 轮巡规则和轮转；
- 轮巡文本上限；
- 软上限的裁剪顺序；
- `--audit` 的严格覆盖与"无法判定"；
- transform 按配方 op 认命令，以及附录的各节。

### 34.6 E3：包的第三类改为按单元

**做法**（view.ts）：
- 段的理由 "edge" 换成 "unit"。本轮触及的变化单元，即本轮的 cue/model 单元，或早轮单元里有句子本轮被修订的，把它早轮句子所在的段带进包，标"earlier, changing together with this round's text"。
- 全局单元不展开；guard 单元不算（检查每个周期都跑）；revision 单元的新旧句子本来就是本轮段和修订段，不重复。
- 对象头（heads）和边计数随边一起去掉，换成 `units`：触及的单元数，以及每个跨两个以上命令的单元涉及哪些命令、包里的文字覆盖到了哪些。覆盖指包里有该命令的段，或某段用反引号点名了它。
- 预算超限时：先裁只由 model 单元带来的段，再裁开放项段；本轮段、修订段和 cue 单元带来的段不裁。
- 报告的 Requirements given 一行改报"change units touched / across commands, delivered to x/y"；工单 scope 同样改。

**验收 1、5**（`replay-package.mjs` → `replay-package.md`；rep1j–rep1n 每轮按新代码重建包，带入条目作开放项，不调模型）：
- dpipe R5 的横切交付：U5.c1 在 rep1j、rep1k、rep1n 都是 4/4。验收 1 至此成立：cue 单元含四个命令的句子（§34.1）；审查请求列出四个命令（§34.5，跨命令单元一节）；交付 4/4。
- 包字符：R3+ 每一轮都 ≤ 本轮原文 × 2 + 10k。
- 单元带来的段：dpipe 上五次运行都是 0 字符。dpipe 的 cue 单元都只在同一轮内（作者编号单元为 0），带不来早轮句子；这一类在 d12_w1 这种靠 F 编号的文档上才会有内容。
- 审查员引用的句子在包内：rep1k、rep1l、rep1m、rep1n 全部 100%。rep1j 有 21 个引用单元不在包内；算上名单附文（E4）后仍有 9 个不在包内也不在名单里：
  - R2：V2.2.3（R1 filter）、V2.2.7（R1 ingest）、V2.2.8（R1 unpivot）；
  - R3：V3.2.1（R2.S11.P7）；R4：V4.2.2（R2.S17.P7.s6）；R5：V5.3.3（R4.S3.P2）。
  - rep1j 的审查员读的是整对象视图，这些正是它靠整视图回看找到的。新包不再给这些段，名单也没把这些命令列上。**验收 5 的"100% 在包内"对 rep1j 不成立**，已报设计会话。
- 测试：units.test 加一条（R2 的 model 单元把 R1 的 filter 段作为 unit 段带进包，来源 model）；chain.test 的预算用例改为"先 model 单元段，再开放项，cue 单元段不裁"。batch-1 的报告行正则随之改。batch-1 的 stand-in serial 用例一次报 stopped，重跑两次都通过，没能复现。

**验收 5 定 (a)**（设计会话 10-25）：口径改为"审查员引用的句子 100% 在包内或名单附文内"；rep1j 这 9 个单元记为已知代价，是整视图顺带回看的产物。代价换成用例数（`lost-findings.mjs` → `lost-findings.md`；只看用例名与 requirement_ref，取当轮首次交付和当轮最终提交的 verifier 日志）：

| 条目 | 轮 | requirement_ref | 送修 | 运行里修好 | 首次交付失败 | 当轮末失败 |
|---|---|---|---|---|---|---|
| V2.2.3 | R2 | R1 transform.filter | 是 | 是（G27） | 0 | 0 |
| V2.2.7 | R2 | R1 ingest | 是 | 否 | 0 | 0 |
| V2.2.8 | R2 | R1 transform.pivot（unpivot 没有自己的 requirement_ref） | 是 | 是（G30） | 0 | 0 |
| V3.2.1 | R3 | R2 transform.normalize | 是（logged） | 是 | 0 | 0 |
| V4.2.2 | R4 | R2 transform.bin | 是 | 是（G54） | 0 | 0 |
| V5.3.3 | R5 | R4 validate | 否（blocked） | 是 | 0 | 0 |

- 这六个 requirement_ref 在 rep1j 的官方日志里都存在（7–75 条用例），当轮首次交付和当轮末都没有失败用例。丢掉这 9 个单元的代价：**0 条官方用例**。这是上界的反面：这些条目修的是官方没测到的行为。

### 34.7 E5：报告

**做法**（report.ts）：
- 每轮报告加 `change_units`：本轮变化单元按来源计数（cue、model、revision；guard 记本轮写的检查数，一条一个），其中全局单元数，本轮修订按来源（cue 或 inferred）计数。报告行 "Change units: …"。
- 审查报告加 `lists`（E4 已记在 `accept.lists`），报告行 "Review lists: …"：未结和轮巡名单列出的命令、跨命令和全局单元数、全局单元的标志与覆盖（认不出标志写"无法判定"）、附录字符和裁掉的项、审查跑过的命令数、覆盖缺口、名单上命令的发现。
- 范围声明（E2）和包的单元行（E3）此前已进报告。
- 全量测试：1001 条，990 通过，10 条失败即已知 10 条，没有新失败。
- 测试：lists.test 加一条。用 dpipe 式的 R5（有 cue 单元和 "no longer / instead of" 修订）检查 `change_units` 的计数和单元行；名单行用一份带全局单元、缺口和发现的记录检查文字。

**回放**（`replay-e5.mjs` → `replay-e5.md`；rep1j–rep1n 每轮按新代码重建，不调模型）：
- 单元：每轮 cue 单元 0–2 个，model 单元全为 0（回放没有归属答案的新字段），revision 单元 0–9 个；全局单元 R1、R6 各一个。
- 修订来源：cue 修订只在 R3、R5 出现（rep1j R5 5/9，rep1k R5 3/5，rep1n R5 3/4），与 §34.2 的金标一致。
- 名单：未结名单从 R2 起 2–16 个命令，轮巡 R4 起每轮 2 个，跨命令单元 R5 一个（四个命令）。
- 名单上命令的审查条目：286 条里 48 条。这些运行的审查员没有名单，这个数只说名单会指向哪里，不说它会找到什么。
- 范围声明：dpipe 上全是 0（范围声明在 d10_w4 上，§34.3）。
- 包按类字符：单元带来的段在 dpipe 上全是 0，同 §34.6；跨命令交付在有跨命令单元的轮全是满的（2/2、4/4）。

## 35. rep1o：批 4 之后的一次 6 轮真实运行（R2/R3 整周期回退受损，分差不作准确率对比）

设计会话 2026-10-25 起。代码 23ef517（批 4 E1a–E5），配置从 rep1n 复制，只改运行编号、端口（46019/46020）、缓存键、label；delta，执行方 low，rounds 6，--to 6。全程 0 次续跑，没有崩溃或环境错误。R3 后设计会话决定跑完不停。表：`exp2/evidence/rep1o-2026-10-25/table.md`（脚本沿用 `rep1n-2026-10-25/table.mjs`），预注册四条：`prereg-superseded.mjs` → `prereg-superseded.md`（2026-10-26 起由 `exp2/evidence/prereg/prereg.mjs` 取代，输出 `<运行目录>/prereg.md`），整周期回退的代价：`revert-cost.mjs` → `revert-cost.md/.json`，回退时打破的守卫：`revert-guards.mjs` → `revert-guards.md`。后两个脚本在 docker 里用每个周期保存的构建重跑检查，不调模型；构建带覆盖率，重跑时同样给 GOCOVERDIR，否则 stderr 多一行警告，逐字断言会误判。

**官方分**（括号里是首次交付）：

| 轮 | rep1o | rep1j | rep1k | rep1n |
|---|---|---|---|---|
| R1 | 185 (127) | 177 (108) | 196 (100) | 167 (52) |
| R2 | 376 (290) | 480 (395) | 474 (410) | 465 (287) |
| R3 | 394 (394) | 534 (534) | 534 (521) | 519 (517) |
| R4 | 595 (595) | 638 (630) | 630 (623) | 623 (623) |
| R5 | 667 (648) | 673 (673) | 666 (666) | 659 (659) |
| R6 | 703 (703) | 710 (699) | 698 (696) | 692 (691) |

**差在哪：整周期回退**。R2–R6 每一轮都有修补周期因为打破守卫被整周期回退：R2 2 次、R3 3 次、R4 3 次、R5 2 次、R6 3 次，R1 还有 1 次，共 14 次。R3、R4、R6 首次交付就等于最终，修补一条也没留下。
- 打破的守卫都是对的（`revert-guards.md`，按原文核算）：
  - R2 的 split 守卫 G27、G33：C2.3、C2.4 把 "Carol Ann Jones" 拆成 Carol / Ann，原文要求 last 取剩余全部。
  - R3 的 drift 守卫 G41：C3.2–C3.4 三次都只报了 1 条漂移，丢了 age 的 mean_shift。期望值是 shift = 2/0.5 = 4，加上 city 的 column_added，共 2 条。
  - R4 的 normalize 守卫 G40：原文说 zscore 改用样本标准差，profile 不变，0,2,4 应得 −1/0/1；C4.2–C4.4 退回了总体标准差（−1.2247）。
  - R1 的 C1.4 把 manifest 命令整个弄没了（unknown command），一次打破 8 个守卫。
- 执行方拿到的回退说明只有守卫编号。消息原文取自编码服务的会话库："Your previous change was reverted by the controller: it made G41 fail, which passed before. The work tree is back at the state before that change. What it was meant to fix is listed above again." 没有命令、输入、所依据的句子，也没有现在输出与期望的对比。rep1o 的 14 次回退里，有 8 次下一个周期又打破同一个守卫。
- R3 的包和名单：drift 原文 R3.S6 作为本轮段进了包，含 "using the same type inference rules and numeric statistics as the `profile` command"；profile（O17）有 11 个开放项段加 R3.S5 本轮段，未结名单也列了 profile（4 条 untouched）。没有任何变化单元把 drift 和 profile 连起来：代码不把 "same … as the `profile` command" 认作线索，model 单元为 0。所以线索在文字里，没有成为关系。
- rep1n 同轮为什么没碰上：rep1n 的 R3 drift 检查 K27 在 C3.1、C3.2 都失败，从没成为守卫；R3 只跑了两个周期。rep1o 在 C3.1 就做对了 drift，K32 生成 G41，之后改 profile 时 drift 跟着坏，就被回退。

**整周期回退的累计代价**（`revert-cost.md`；rep1j/k/l/m/n/o，每个被回退的周期把送修条目的检查在该周期的构建和保留的构建上各跑一次）：
- 被回退的修补周期 23 个，分布在 10 轮：rep1j 5、rep1n 4、rep1o 14，rep1k/l/m 为 0。
- 这些周期里送修 565 条，有检查的 539 条。按输出口径，在被回退的构建上已通过、在保留的构建上仍失败的：216 条次；同一轮去重后 131 个条目（rep1j 18、rep1n 4、rep1o 109）。
- 换句话说，"一个守卫回归就整周期回退"在 rep1o 上丢掉了 109 个已修好的条目，换来的是 14 次守住正确的守卫。

**预注册四条**（`prereg-superseded.md`，已作废，见 §37）：
1. R2 末 R1 用例残留：16（线 ≤1，rep1j 为 1）。按 ref：rename-drop 5、fill 4、window 3、derive 2、pivot 1、error-handling 1。不过。
2. 横切单元交付命令比例：8/8（R1 U1.c1 2/2、R3 U3.c1 2/2、R5 U5.c1 4/4）。过。
3. 每轮分差（rep1o − rep1j）：+8、−104、−140、−43、−6、−7，不过。R3–R6 审查请求字符 957,215，比 rep1j 的 598,799 高 60%（线是低 ≥30%），不过。原因是回退让条目一直开着：R4–R6 的 untouched 单独消息每轮带 28–37 个条目，包每轮 38–39k，接近 40k 预算，名单附录每轮接近 15k，审查 3 个会话各带一份。
4. 名单带来的发现 88 条。其中 45 条所在的 ref 在当轮首次交付有早轮官方用例失败，落在 18 个（轮，ref）上，去重 150 个用例；当轮末转为通过的只有 5 个（R2 window 2、R5 encode 3）。名单把审查员引到了确实有失分的命令上，但这些发现送修后大多被整周期回退吃掉，所以这一条在 rep1o 上分不出名单本身有没有用。

**另报**：
- 单独消息后仍 untouched：1/2（R1，50%；对照 26%）；R2–R6 单独消息后的周期都被回退或到了周期上限，没有可判的。
- 附录字符：R1 88、R2 9,486、R3 14,428、R4 14,921、R5 14,960、R6 14,813；R3–R6 都在 15k 软上限上，裁掉了 13、44、35、7 段。
- 全局单元覆盖：R1 U1.c2 认不出标志，记无法判定；R6 U6.c1 `--audit` 覆盖 6 个命令。
- conservation 错误全为 0；no_input R4 5 条、R6 2 条。

**no_input 的原因**（零成本，读每个条目的 premise 记录和 formalizer 的回答）：R4 有 6 个 fallback 条目，其中 no_input 5、no_assertion 1；R6 有 2 个，都是 no_input。
- 审查员没跑程序，凭读代码写的发现：4 条，V4.1.3（validate min/max 只适用于数值类型）、V4.1.4（pattern 只适用于字符串）、V4.1.11（rollup 只用第一个聚合）、V4.1.13（drift 漏了 null-rate/range/unique 检查）。这 4 条都在 R4.1 的审查里，不引用命令也不点名 lead，没有调用可重建。no_input 是对的。
- 输入是整个目录：V4.3.15，`manifest --dir . --output review-manifest.json`。重建需要整个工作目录的内容，材料里只有 37 个会话文件，formalizer 判为无法完整重建。code 那一侧也没认出这条里的命令：引用的命令没有 `dpipe` 前缀，也不在会话命令里。即使认出来，`--dir .` 也一样重建不了。
- 审查员误读的 drift 发现：3 条，V4.2.7、V6.1.3、V6.2.3。审查员先用 `profile` 生成 JSON，再把它当作 drift 的 `--baseline`/`--current`，程序报 `ERROR: cannot parse CSV`，审查员据此报"drift 不能读 profile 输出"。
  - R3 原文写的是 `--baseline: path to the baseline CSV data file`，drift 在内部为两个 CSV 计算统计 profile。所以这三条的主张本身是错的，程序的行为符合原文。
  - V6.1.3、V6.2.3 是 no_input：它们的输入是程序在会话里生成的文件，不在材料里。V4.2.7 输入找到了，但 formalizer 没写断言，记为 no_assertion。
  - 三条都停在 fallback，没有变成检查，也没有送修。
- 读法：8 条里，4 条是凭读代码的发现，1 条是整目录输入，3 条是对原文的误读。没有一条是 code 漏掉了材料里本有的调用。

## 36. 批 5：回归不回退、带材料，same-as 线索（设计会话 2026-10-26）

设计会话定的点：
1. 修补周期不再有任何整周期回退。原文未改时守卫翻转（回归），就成为一条带材料的修补条目，和本周期其他条目一起进下一周期。
2. 持续回归也不回退：周期 n 回归、条目随 n+1 的消息送出后，到 n+1 仍失败，就连守卫一起送审查员问题通道裁决。SUPERSEDED 则守卫退役；维持则作为条目带入下一轮。
3. 轮末遗留的回归保留该周期，作为带入条目进下一轮。
4. 构建失败照旧走 trial 修复，不回退。
5. same-as 线索只由代码认出，单元成员只有这句话本身。
6. "之前通过时的输出"用期望值，不另存历史。

### 36.1 B：回归条目带材料

**做法**：
- 按决定 1、2，修补周期不再回退，回退说明（`voidedNote`）在 A 之后不会再出现。执行方实际拿到的是回归条目本身，它由 `renderGuardItem` 渲染。
- 这个渲染已经含四项：守卫 id；所依据句子的原文，每句截到 400 字；命令与全部输入文件，每个文件截到 600 字；现在输出 vs 期望，逐条失败断言列出，另加 stderr。
- 所以 B 不改代码，加一条测试把这四项固定下来（`test/exp2/batch5.test.ts`）。

**验收**（`exp2/evidence/batch5-2026-10-26/render-regressions.mjs` → `render-regressions.md`；在 docker 里用保存的构建重跑，不调模型）：
- rep1o 14 个被回退周期里打破的守卫共 36 个（周期 × 守卫），按回归条目渲染，四项俱全 36/36。
- 文件里附了 C2.3 G27、C3.2 G41、C4.2 G40 三条原文。G41 一条里带有 "same type inference rules and numeric statistics as the `profile` command" 这句，以及 "expected 2, got 1"、"expected \"normalized shift = 4\", got \"new column of type string\""。

### 36.2 A：修补周期不再回退

**做法**：
- accept.ts：整周期回退的分支删除，原来的 else 分支成为唯一路径。
  - 修补周期里，守卫在原文未改时翻转，和首次交付时一样成为回归条目，用 `renderGuardItem` 渲染（四项材料），与本周期其他条目一起进下一条修补消息。
  - 本周期已修好的条目照常成为守卫，本周期通过的库检查照常生成守卫。
  - 轮末保留最后一个能构建的周期。仍失败的回归进 `final`，作为带入条目进下一轮。
  - 构建失败照旧走 trial 修复。
- repairs.ts：
  - `regressed(id, digest)`：守卫回归时，给它一份新的条目状态，不论这一轮之前它经历过什么。它第一次总是进修补清单，不进 untouched 消息。
  - 回归条目送出后的下一个周期仍失败（不论 touched 还是 untouched），就 hold，ruling 为 `regression_persisted`，走现有的审查员问题通道。
  - 审查员 SUPERSEDED 该守卫：条目结束，守卫退役。审查员不提：维持，本轮 hold，带入下一轮。
  - 修好后再次回归，算一次新的回归。
- 问题通道里给审查员的问题措辞："this check passed before, a repair made it fail, and it still fails on the cycle after it was sent with its material: is the check superseded by the requirements, or is the program wrong?"。审查请求里原来解释"守卫随条目列出 = 回退"的那句，改为"id 以 G 开头的条目是之前通过、修补后失败的检查，同样处理"。
- 计数：`accept.repairs.regressions` 记 raised / fixed_next / persisted / adjudicated{superseded, upheld, unasked}。报告的 Repairs 行末尾加 "regressions n (no repair reverted): …"。`accept.reverted` 字段保留（旧记录要读），新运行恒为 0。
- 去掉的：回退说明（voidedNote）、`sentInRepair`、`revertGuards`、对已回退周期跳过 lead 的判断、"guard superseded"这个审查结论（它只在回退两次时出现）。类型里的 `reverted` / `reverted_twice` 保留，旧记录要读。

**测试**：
- 改写按旧规则写的回退测试：block-accept 1 条，batch-1 3 条，revert-ids-replay 1 条。
  - 现在验证：不回退；修好的条目留下；回归作为带材料的条目送出、下一周期修回；守卫编号连续。
  - rep1h R4 重放：C4.2 不再回退，在那里多生成 10 个守卫（G90–G99）。
- 新增：block-accept 2 条，覆盖持续回归送审查员后的两种结论：SUPERSEDED 退役；维持，带入下一轮。repairs.test 3 条（路由规则）。batch5.test 1 条（报告行）。
- 一个真 bug 在测试里抓到：新的回归状态 sends 为 0，原 `plan()` 按"输出没变"把它判成 untouched，送进了 untouched 消息。已改为回归第一次总进修补清单。
- block-accept-fix 有一个期望值加了 regressions 字段。

**离线验收**（`replay-a.mjs` → `replay-a.md`；以 `rep1o-2026-10-25/revert-cost.json` 为基础，rep1o 的消息在 docker 里用保存的构建重跑后渲染，不调模型）：
- 记录里 23 个被回退的周期，按新规则逐条判：每轮第一个被回退的周期（共 10 个）保留；其余 13 个是从回退后的树上开出来的，新规则下不存在。
- 保留的 10 个周期上，在该构建上已修好、在回退目标上仍失败的条目共 80 个，全部留下。131 个"修好又丢掉"里，另外 51 个出在那 13 个不存在的周期上，要真实运行才知道。
- rep1o 6 轮各自第一个被回退周期之后的下一条修补消息已渲染：回归 16 个，四项俱全 16/16；仍失败的条目 1、16、26、26、34、31 个照常再发；在保留构建上已修好的条目没有一个出现在消息里。
- 离线做不到的：新规则下，那个被保留的周期上本应跑一次审查，它会带来新条目，这次重放里没有；执行方拿到材料后修没修回、持续回归有多少，也只能等真实运行。

### 36.3 C：same-as 线索

**做法**（units.ts，代码侧，不进模型）：
- 新的线索类 `same_as`，匹配三种句式：
  - "(same|identical) … as (the) `X`"，中间不超过 160 字，不跨句；
  - "reuses (the) `X`"；
  - "as `X` does"。
- 句子里所有这样点名的 X 都记下。
- 成单元的条件：X 能解析成对象（`objectsNamed`），而且不是这句话自己所属的对象。
- 单元成员只有这句话本身，对象是句子所属对象加 X。它是跨命令单元，所以：
  - 进审查名单的"Changes across commands"一节；
  - 进包的跨命令交付计数；
  - 进工单的 units 行。
- 不是全局单元。原有六类线索的规则不变。
- 全量测试：1009 条，998 通过，10 条失败即已知 10 条，A 和 C 都在内，没有新失败。
- 测试：units.test 加一条。dpipe R3 的 drift 句是命中，形成 drift 所属对象 + profile 的单元，成员只有这一句；`p25` 是命中，但不成单元。

**验收**（`exp2/evidence/batch5-2026-10-26/cues-same-as.mjs` → `cues-same-as.md`；不调模型）：
- 四任务线索计数，用各轮 instruction，不读测试。原有六类的总数与批 4（`cues-tasks.md`）逐项相同：
  - d5_w9：0/2/15/1/0/18；
  - d10_w4：0/0/12/12/0/9；
  - d12_w1：0/0/13/6/121/19；
  - d8_w5：5/4/10/0/0/4。
- 新增 same_as 命中 16 条：d5_w9（dpipe）12 条，d12_w1 4 条，d10_w4、d8_w5 为 0。16 条我全部人工看过：
  - 真引用另一个命令或操作的 8 条：
    - having 用 `filter` 的条件操作符；
    - rollup 的 aggregations 同 `aggregate` 语义；
    - assert 的 expression 同 `derive` 的表达式求值；
    - detect 的 iqr 同 `profile` 的分位数方法；
    - bin 的分位边界同 `profile`；
    - drift 同 `profile` 的类型推断和统计；
    - lineage 的 `--config` 同 `pipeline` 格式；
    - d12 的 `steps` 与 `inspect.steps` 同序。
  - 指向字段、取值或同一操作内另一选项的 8 条：
    - `lead` 同 `lag`；
    - `max` 同 `min`；
    - bin 的两条同 `width`；
    - `p25`；
    - d12 的 `cmd`、`skipped`、`budget_exceeded`。
  - 这 8 条在有归属时不会成单元，因为 X 不是命令对象。
- rep1o（dpipe，用它记录的归属）：12 条命中形成 5 个单元，5 个都是真引用：
  - U2.c2 rollup + aggregate；
  - U2.c3 detect + profile；
  - U2.c4 bin + profile；
  - U3.c2 drift + profile；
  - U5.c2 lineage + pipeline。
- 漏掉的真引用 2 条：filter、derive。rep1o 的归属里没有这两个命令对象，它们都在 O4 transformation operation dispatch 下。
- rep1o R3：
  - drift–profile 单元 U3.c2（O28 drift command + O17 profile command）在包的跨命令交付里，交付 2/2；
  - 在审查名单的 Changes across commands 一节："U3.c2 same as profile: drift command, profile command"。

**批 5 预注册**（下一次真实运行，设计会话 2026-10-26）：
- 整周期回退次数 = 0；
- 因回退丢失的已修条目 = 0；
- 报告回归的一周期修回率（fixed_next / raised），以及持续回归的裁决结果（superseded / upheld / unasked）。

### 36.4 批 5 三块的固定三行（按 2026-10-26 的开发会话规则补）

- B
  - 离线成立：rep1o 的 36 个回归按回归条目渲染，四项俱全 36/36。
  - 离线做不到的：执行方拿到材料后会不会修回。
  - 真实运行要看的线：回归一周期修回率 fixed_next/raised ≥ 50%。
- A
  - 离线成立：23 次回退按新规则逐条判，每轮第一个被回退的周期（10 个）保留，上面的 80 个已修条目留下；rep1o 6 条下一周期的消息带回归材料 16/16，已修好的条目不再出现。
  - 离线做不到的：其余 51 个条目（出在新规则下不存在的周期上）；被保留周期上本应跑的审查；执行方的修回与审查员的裁决。
  - 真实运行要看的线：整周期回退 = 0；每轮轮末遗留回归数 ≤ rep1o 同轮回退次数（R2 2、R3 3、R4 3、R5 2、R6 3）；回归一周期修回率 ≥ 50%；R5 ≥ 656、R6 ≥ 688；R3–R6 审查请求 ≤ 599k。
- C
  - 离线成立：四任务原有六类线索计数与批 4 逐项相同；16 条新命中里 8 条真引用；rep1o 归属下成 5 个单元，5/5 是真引用；R3 drift–profile 单元交付 2/2、进名单。
  - 离线做不到的：这个单元会不会让执行方改 profile 时不再带坏 drift。
  - 真实运行要看的线：本批不单独设线，并入 A 的线。C 的 commit-kinds 记为 behav，因为它改变审查请求的名单内容；评审 1(b) 把它列为机械的。按批次计数，结果不变。

## 37. 预注册总表脚本与名单开关（独立评审第三轮，2026-10-26）

### 37.1 prereg.mjs

**做法**（`exp2/evidence/prereg/prereg.mjs`，输出 `<运行目录>/prereg.md`）：按评审第三轮第 1 节的 8 项出表。度量只此一个脚本、一个输出文件。旧的 `rep1o-2026-10-25/prereg.mjs` 与 `prereg.md` 改名 `-superseded`，§35 的引用随之改。
- 第 1 项，代码构成：`--base..--code` 之间改动 src 的提交。
  - 种类取提交信息首词的 [mech]/[behav]；首词规则之前的提交，查 `exp2/evidence/prereg/commit-kinds.json`。表里的标注按评审 1(b)，只有批 5 C 一处不同：C 记为 behav，原因见上面 §36.4。
  - 行为批次按批计。
- 第 2 项，闭合率：（轮末分 − 首次分）/（总用例 − 首次分）。线是 R1 ≥ 52%、R2 ≥ 81%。
- 第 3 项，分账：取首次交付挂、轮末仍挂的用例，每轮按四类计。
  - (i) op 未被本轮任一审查条目点名。口径同 `recall2.py`：requirement_ref 的末段作为单词出现在条目文字里；rename-drop 按 rename 或 drop。
  - (iii) 点名它的条目修好又丢掉：出现在 `revert-cost.json` 的丢失名单里（被回退的周期），或者它生成的守卫在轮末失败（回归）。
  - (iv) 点名它的条目 touched、未修好；(ii) 点名它的条目 untouched。这两类的口径同 `outcome.mjs` 的输出规则，取条目本轮最后一次被判的送出。
  - 其余记"点名、其他"：条目自己的检查修好了，或者没送出。
  - 一个用例只归一类，顺序 iii、iv、ii。
- 第 4 项：R5 ≥ 656、R6 ≥ 688。第 5 项：R3–R6 审查请求字符 ≤ 598,799。第 6 项：conservation 为 0，no_input 每轮 ≤ 2。
- 第 7 项：批次自己的线，用 `--lines batch3|batch4|batch5` 选；`--report` 只报不判。每条线只写过 / 不过 / 未证明。
- 第 8 项：全次一个词。行为批次不是 1 个就写"未证明（原因）"；否则第 2、4、7 项有不过就写"不过"；全过写"真实成立（一次）"。

**在 rep1o、rep1n 上跑的结果**（输出在两个运行目录的 `prereg.md`）：
- rep1o（base aac0f01 → 23ef517，行为批次 1，批 4）：
  - 闭合率 R1 63% 过，R2 45% 不过。
  - 分账最大的一类：R1–R3、R5 是 (iii)（28、60、124、6），R4、R6 是 (i)。
  - R5 667、R6 703 都过；审查请求 957,215 不过；no_input R4 5 条，不过。
  - 批 4 四条：R1 残留 16 不过，横切 8/8 过，分差与成本不过，名单发现 45/88 过。
  - 全次：不过。
- rep1n（base 6458a9e → aac0f01，行为批次 1，批 3）：
  - 闭合率 R1 69%、R2 92%，都过。
  - 分账：R1 最大是 (iv) 47；R2 起 (i) 最大。
  - R5 659、R6 692、成本 160,679、接口计数都过。
  - 批 3 的 26% 线：8/22 = 36%，不过。
  - 全次：不过。
- 与旧数对照：rep1o 的闭合率与评审 1(a) 表一致（63%、45%）；rep1n 的 26% 线与 §32 一致（8/22）。

### 37.2 名单开关

**做法**（6d7d2b5，[mech]）：
- 配置项 `acceptance.lists`，默认 true。为 false 时 serial 不构造名单，审查请求里没有名单各节，`accept.lists` 不记录。
- 配置校验：非布尔值报 "acceptance.lists must be true or false"。
- 测试：local.test 加一条，覆盖 false、缺省、非法值三种情况。
- rep1p 运行中我重建过一次 dist：serial 进程启动时已加载全部模块（代码里只有类型层面的 import()），不受影响，run.err 为空。

离线成立：prereg.mjs 在 rep1o、rep1n 上出表，与已有数一致（闭合率与评审 1(a) 表相同，26% 线与 §32 相同）；名单开关的三种配置在测试里按预期装配。
离线做不到的：分账 (iii) 只认"回退丢失名单"和"守卫轮末失败"两条路，修好后被别的条目改坏、但没有守卫的情形不在里面；名单关掉以后的真实效果。
真实运行要看的线：rep1p 的 prereg.md 只判批 5 四条；rep1r 关名单、与 rep1q 比 R2 末 R1 残留、闭合率、R3–R6 审查请求字符，关掉后名单带来的发现应为 0。

## 38. rep1p：批 4 + 批 5 的一次 6 轮真实运行（f582700，src 同 8f13def）

用户决定（2026-10-26，经设计会话）。配置从 rep1o 复制，只改运行编号、端口（46021/46022）、缓存键、label；delta，执行方 low，--to 6。全程 0 次续跑，无崩溃。
- 表：`<运行目录>/prereg.md`（`exp2/evidence/prereg/prereg.mjs`，base aac0f01，`--lines batch5 --report batch4,batch3`）。
- 代码构成：以 rep1n 的 aac0f01 为基，含 2 个行为批次（批 4、批 5），整次运行判未证明，只判批 5 四条。

**官方分**（括号里是首次交付）：R1 191 (69)、R2 357 (237)、R3 508 (442)、R4 611 (609)、R5 646 (645)、R6 674 (682)。

**批 5 四条**：
1. 轮末遗留回归 R2 2、R3 2、R4 2、R5 1、R6 0：过。
2. 一周期修回率 5/16 = 31%：不过。
3. R5 646、R6 674：不过。
4. R3–R6 审查请求 535,217：过。

整周期回退 0 次。回归分轮，每行依次是 raised、下周期修回、持续、以及持续者的裁决 superseded / upheld / unasked：
- R2：2、0、0（两个都出在最后一周期，带入 R3）；
- R3：3、1、2，裁决 0/0/2；
- R4：6、2、2，裁决 2/0/0；
- R5：4、1、3，裁决 2/1/0；
- R6：1、1、0。

**闭合率与分账**：
- 闭合率：R1 81% 过，R2 49% 不过。
- 分账最大的一类：R1 是 (ii) 15；R2 是 (iv) 56，(iii) 30 是 C2.4 的两个回归遗留到轮末；R5、R6 几乎全是 (i)，op 没有被点名。
- 分账之外：R6 轮末比首次交付少 8 分。C6.2–C6.4 改坏了 8 个 R1 ingest 用例，这三个周期里没有守卫翻转，即这些用例没有守卫覆盖；旧规则下同样不会回退。其他轮"首次过、轮末挂"的用例：R2 1、R3 4、R4 0、R5 1。

**只报不判**：
- 批 4：R1 残留 11；横切交付 20/20；分差 +14、−123、−26、−27、−27、−36；名单发现 22/39 有官方失分。
- 26% 线：46/73 = 63%。

离线成立：（本节是一次真实运行的记录，没有离线验收。）
离线做不到的：一次运行里，分不出执行方的方差和批 5 各自的作用。
真实运行要看的线：rep1q（同一代码第二次）的同四条。两次都过的线写真实成立，一过一不过写未证明，两次都不过写不过。

## 39. rep1q：同一代码（f582700）的第二次运行，R6 崩溃

用户决定（2026-10-26，经设计会话）。
- 代码：从独立工作树 `project-exp2-rep1q`（detached 在 f582700）构建，与 rep1p 完全相同；开发分支后来加的 6d7d2b5（名单开关）不在这次构建里。
- 配置：从 rep1p 复制，只改了运行编号、端口（46023/46024）、缓存键、label。
- 结果：R1–R5 跑完，R6 在写检查时崩溃，按规定没有续跑，服务已停。表在 `<运行目录>/prereg.md`（`--pair` rep1p）。

**崩溃**：
- R6 写库检查时，检查撰写模型的一条回答（cassette #50，upsert 4）把文件内容写进了文件名：`path: "age\n1\n"`、`content: "age\n1\n"`。
- `methodB` 跑参考脚本前要写输入文件。`writeInputs` 的 `safePath` 只拦路径穿越，不拦换行；Windows 不允许文件名里有换行，`writeFileSync` 报 ENOENT。这个异常没有在单条检查那一层被接住，整个 serial 就退出了。
- 16 次有记录的运行、约 11,000 个文件路径里，带换行的只有这一个；rep1d 有 4 个 `<output>` 占位路径，出现在 formalizer 回答里，没有导致崩溃。
- 这是机械缺陷，建议的修法（未做，等范围）：
  - 检查的输入文件路径含控制字符或 Windows 不允许的字符时，按格式问题退回撰写者，不准入；
  - 单条检查准入时抛出的异常只让那一条失败，不让整轮失败。

**官方分**（括号里是首次交付），rep1q 对 rep1p：
- R1：190 (93) 对 191 (69)
- R2：386 (208) 对 357 (237)
- R3：495 (460) 对 508 (442)
- R4：595 (589) 对 611 (609)
- R5：626 (630) 对 646 (645)
- R6：崩溃 对 674 (682)

**两次并排**（每次各自的数，不报均值）：
- 批 5 四条：
  - 轮末遗留回归：rep1p 过；rep1q R5 有 7 个，不过 → 未证明。
  - 一周期修回率：31% 对 47%，都不过 → 不过。
  - R5/R6：rep1p 646/674；rep1q R5 626，已不过 → 不过。
  - 成本：rep1p 535,217 过；rep1q 只有到 R5 的 414,446 → 未证明。
- 闭合率：R1 81% 对 77%，都过；R2 49% 对 65%，都不过。
- 分账：R2 两次最大的类不同，rep1p 是 (iv) 56，rep1q 是 (ii) 81；R3 起两次都以 (i) 为主。
- 回归：rep1q 共 19 个，R5 有 11 个，其中 4 个下周期修回、2 个持续（unasked），其余留到轮末。
- rep1p 的零成本补查已入 evidence（`rep1p-2026-10-26/unnamed-ops.md`、`ingest-cover.md`）：
  - R5、R6 的 (i) 类集中在 profile（在未结名单上、审查员跑过，仍没点名）和 validate（不在任何名单上）。
  - R6 改坏的 8 个 ingest 用例：R1 的 ingest 库检查 K1 每次都失败（R1–R4 disputed/reference，R5 起 value_mismatch），从没成为守卫；仅有的 3 个 ingest 守卫在 R6 各周期都通过，没有覆盖这些行为。
  - rep1p 非执行角色成本合计 4,553,277，rep1j 为 3,904,410。

离线成立：崩溃原因按记录确定（cassette #50 的路径、`writeInputs` 的调用栈）；路径缺陷在 16 次运行里穷举过，只此一处。
离线做不到的：rep1q 的 R6 和它的成本线；批 5 各线两次能否都判。
真实运行要看的线：修好路径缺陷之后，是否补跑 rep1q 的 R6 或整次重跑，由用户定；同一代码两次都过的线才写真实成立。

## 40. 机械修复：写不出来的输入路径，以及单条检查准入异常（rep1q R6 的崩溃）

**做法**（[mech]）：
- `safePath`（runner.ts）：在原来的规则（不能是绝对路径、不能有 `..`、不能有空的路径段）之外，再拒绝控制字符（含换行、制表）和 Windows 不允许的 `< > : " | ? *`。它有三个调用方，都把它当作格式问题退回模型，消息改为：路径必须是运行目录内的相对文件名，不能有换行、控制字符或 `< > : " | ? *`。三个调用方是：
  - checkChecks 的 `input_invalid`，退回检查撰写者；
  - 断言目标路径；
  - formalizer 的输入路径。
- 单条检查的准入在两处会出异常，现在都只影响那一条：
  - 写检查循环内的 `admit`（rep1q 走的就是这条路径）：异常变成该检查的 `admission_failed` 问题，退回撰写者，其余检查照常；
  - 检查入库时的 `methodB`：异常时该检查以 unknown 入库，`admission_reason` 写 "its admission could not run: …"，其余照常。

**测试**（`test/exp2/input-paths.test.ts`，4 条；夹具是 cassette #50 那条回答，`exp2/evidence/replay-2026-10-26/rep1q-r6-bad-path-check.json`）：
- safePath 拒绝换行、制表、`< > : " | ? *`，接受普通相对路径；`writeInputs` 在写任何文件前就拒绝这条路径。
- 真实回答里的那条检查（对象换成桩登记表里本轮在范围内的对象，路径、内容、配方和脚本原样）：报 `input_invalid`，消息点出换行。
- sandbox 第一次抛出与当时相同的 ENOENT：
  - 循环内准入：该检查得到 `admission_failed`，本轮不中断；
  - 入库准入：该检查以 unknown 入库并写明原因，其余检查照常入库。
- 这四条在旧代码上都不过：旧的 safePath 放行这条路径，两处准入的异常都会冒出去。
- 全量测试：1014 条，1003 通过，10 条失败即已知 10 条。

离线成立：rep1q R6 那条回答现在会作为格式问题退回撰写者，不会让 serial 退出；16 次运行、约 11,000 个路径里，按新规则被拒的只有这一个，另有 rep1d formalizer 回答里 4 个 `<output>` 占位路径（当时没有写盘，现在同样会退回）。
离线做不到的：撰写者收到这个格式问题后能否改对。
真实运行要看的线：本修复不设线。下一次运行里，"admission_failed" 和带新消息的 `input_invalid` 出现几次，照报。

## 41. rep1j3：交付版本（rep1j 的代码 + [mech] 路径修复）第二次运行

Opus 设计代理定（2026-10-26，经设计会话）。只回答一个问题：交付版本第二次运行，是否仍与对照持平。
- 代码：独立工作树 `project-exp2-rep1j3`，detached 在 de1e333，即 ab190b9 + 4202df4 的路径修复，行为批次 0。起跑前全量测试 976 条，965 通过，10 条失败即已知 10 条。
- 配置：从 rep1j 复制，只改 id、端口（46027/46028）、缓存键、label。
- 运行：6 轮，0 次续跑，无崩溃。
- rep1j2 目录作废（VOID.txt）：它只跑到 R1 开头就停了，换成了这次运行。
- 表在 `exp2/evidence/rep1j3-2026-10-26/table.md`（`table.mjs`）。

**官方分**，每格是 首次 → 轮末；依次为 rep1j3、rep1j、对照 L rep1、对照 L rep2、裸模型 rep1、裸模型 rep2：
- R1：137→209；108→177；90→141；101→198；206；127
- R2：418→477；395→480；354→457；395→449；426；466
- R3：523→530；534→534；513→529；503→514；482；526
- R4：613→626；630→638；625→627；610→614；578；621
- R5：662→662；673→673；663→664；650→650；0（diag 617）；659
- R6：698→698；699→710；670→700；684→686；0（diag 653）；695

裸模型每轮只交付一次，首次即轮末。裸模型 rep1 的 R5、R6 官方分是 0，diag（挂载宿主 Go 模块缓存）分别为 617、653。

**非执行 token**（未缓存输入 + 0.1 × 缓存读 + 输出）合计：rep1j3 2,700,032；rep1j 3,904,410；对照 L rep1 3,767,538；对照 L rep2 3,568,469；裸模型 0。
- rep1j3 逐轮：544,357、623,586、627,693、413,734、284,533、206,129。

**conservation / no_input**：rep1j3 与 rep1j 每轮都是 0 / 0。

离线成立：（本节是一次真实运行的记录，没有离线验收。）
离线做不到的：两次运行的差别里，有多少来自执行方方差，一对同代码的运行分不出来。
真实运行要看的线：本次运行没有预注册线；问题是"是否仍与对照持平"，由设计方按上表判。
