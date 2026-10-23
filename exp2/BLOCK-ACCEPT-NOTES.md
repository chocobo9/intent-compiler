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

1. `npm run build`。配置照 `exp2/local-config.example.json`：`roles.review`、`roles.formalize`、`acceptance`；`coding.variant` 按比较口径设为 low。镜像需要 `go`（试跑和覆盖）、`timeout`、支持 `%N` 的 `date`。
2. 18 份冻结产物（`exp2-b12-accept-20261022`）的比较，各跑 3 次：
   ```
   intent-exp2-replay --config <配置> --products <list.tsv> --out <目录-k> --mode review --defects <缺陷表>
   ```
   每份产物看 `products/<name>/review.md`：审查员原话、逐条前提判定；`replay.md` 的表给出原始条目数、挡下数（按前提）、会送修的数，缺陷表对原话和对过了前提的条目分别命中。"对照组审查员原样"就是其中的原话一列，同一次运行给出两边，不需要另跑；要多次样本就多跑 `--out`。人工核实误报仍要像 VERIFY-2026-10-22 那样逐条做。
3. §12i 的预先登记判定：`intent-exp2-serial --config <配置>`，15 轮 ×2，对照组 L 已有数据。每轮报告的 "Review acceptance"、"Guards"、"Reviewer … Formalizer" 几行给出 §12i 要求同时报告的量；成本按 `未缓存输入 + 0.1×缓存读 + 输出` 从各角色的 token 行算（口径待确认）。首次交付的诊断分由 `scores.jsonl` 里 `kind: "first_delivery"` 的行给出（配置 `scoring` 后自动计）。
4. 真实运行先看：审查请求的大小（原文累积到 R15 约 30k token，与对照组相同）、作废率（`void sessions`，如果 OpenCode 的 tool parts 没有退出码，这个数应为 0，是检测失效的信号而不是审查质量）、formalizer 退回次数（`formalize_calls` 里 `problems` 非空的）、前提挡下的分布。
