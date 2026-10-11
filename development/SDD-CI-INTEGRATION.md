# CI → SDD 接入合同与离线实施

> 2026-10-10 变更：IC 不再单独做运行后评估（`assess` 模型调用、schema、CLI 命令和 `assessment` 存储都已删除）。需求层面的反馈改为直接读取 SDD 自己的 PRD Check：桥接在回传时附上 `prd_check`（上游状态、计数、最后一轮仍未关闭的 GAP 及报告原文）；下一轮 CI 请求的 `feedback.runs` 包含最新回传运行的检查，以及更早运行中仍有 GAP 未关闭的检查，并注明 `code_state`。共同适配器已恢复为 SDD 原流程（见 `experiments/sdd/records/2026-10-10-restore-upstream-sdd.md`）；`config_digest` 改为固定 `python experiments/sdd/ic_bridge.py digest <adapter>` 的结果，不再使用已撤回的 `budget-policy.json`。下文涉及 assess/assessment 的段落均为历史描述。接入的整体分工（IC 拆成 PRD 之上、PRD 之后、人工决定点三个挂点）正在重新设计。

状态：2026-10-09，`integration/sdd`。已实现独立的`ci-sdd-v1`入口并完成离线验证。用户随后授权真实IC+SDD R1，13:39 UTC开始独立管理编译，见[试跑记录](../experiments/sdd/records/2026-10-09-ic-sdd-r1-live.md)。SDD-only系列及冻结目录没有修改。

## 实际调用链与改动边界

`cli/sdd.ts → SddCompiler.accept/advance → 原IR模型与prepareIntentIR → 新CI模型 → 原文装配 → 独立核对 → SddAdapter → SddProcessHost → ic_bridge.py → 指定冻结共同adapter的run_r1.freeze/execute`。

运行回传走`SddProcessHost.inspect → SddCompiler.receive → assess`。`assess`只更新对应运行的需求层评估。新入口不加载旧OpenCode IC插件，不调用`authorize`、AtomStateLedger、`pendingDeliveries`或Python宿主的`_run_pending_dispatches`，因此SDD内部子角色不会被IC再次当成用户轮次。旧v2入口、存储、观察器及历史实验保留；二者显式选择，不能混用同一store。

| 文件 | 职责 |
|---|---|
| `src/core/sdd-contract.ts` | CI交付、运行、结果、管理批次与新store合同 |
| `src/core/sdd-compiler.ts` | IR/CI/核对管理循环、交付装配、一次启动声明、回传去重、需求评估；核对 finding 的证据解析 |
| `src/core/sdd-context.ts` | 各阶段模型请求的构造：来源视图与去重指针、变更视图、交付历史、评估反馈、引用补齐、筛选记录 |
| `src/core/parent-generation.ts` | 提取原prepare逻辑为共享prepareIntentIR；旧入口也调用同一函数 |
| `src/core/requirement-flow.ts` | 导出原attachAssignedRequirements，继续复用来源顺序、原文与历史撤回片段规则 |
| `src/model/sdd-model.ts` | 原IR模型加CI/check/assessment独立schema和请求；没有Atom→CI翻译调用 |
| `src/model/opencode-transport.ts` | 将原结构化传输泛型化，共用工具禁用、超时、原始响应、usage和schema校验 |
| `src/adapters/sdd.ts` | claim/prepare/launch/reconcile的宿主边界 |
| `src/runtime/sdd-host.ts`、`sdd-runtime.ts` | Python共享适配桥接、独立模型服务、进程启动、结果采集 |
| `src/cli/sdd.ts` | compile/start/reconcile/launch-prepared/assess/inspect入口 |
| `experiments/sdd/ic_bridge.py` | 按指定冻结adapter物化CI正文、核对基线与policy、运行身份及结果绑定 |

## 字段去留

| 原信息 | 新路径 |
|---|---|
| IR任务、要求、sources、scope、bindings、outputs、unresolved | 保留原类型、原IR生成及机械准备 |
| Atom.task中的动作与业务边界 | CI `draft.tasks[].instruction`；模型负责去掉旧执行编排含义，核对最终正文 |
| coverage的requirement与处置 | `tasks[].coverage`按`item_id`明确assigned/supported/paused/unresolved；代码绑定当前IR版本 |
| coverage的目标Atom refs | 删除；选中内容进入本CI，paused/unresolved留在管理记录 |
| 原输入/产物声明 | `input_ids`/`output_ids`引用IR登记，不丢失绑定与产物；新产物必须在IR阶段登记，CI不得凭空创建 |
| 用户完成标准 | `completion`保留text/evidence_required；属于用户的业务前置条件仍写在需求正文 |
| Atom authority/optional_tools/delegation/preconditions/return_when及关系调度 | 新schema无这些执行字段；SDD负责开发编排 |
| Atom版本和台账 | 新路径无虚拟Atom；CI ref以用户事件确定id，内容摘要覆盖实际交付，接受后不可变 |
| outcome.atom_ref | 改为`run_id + ci_ref`，明确绑定执行版本 |
| 执行状态与满足程度 | `result.status`、`result.sdd_status`、逐要求`assessment`分别记录 |

`CIDelivery.text`是实际SDD输入：选中的要求按原装配逻辑随行，附选中的输入、产物和用户验收条件。它不含未选中的全部历史原文，也不读取旧Atom正文。模型schema拒绝额外Atom字段。新配置标识`ci-sdd-v1`，拒绝旁边有旧`snapshot.json`的store；本轮不迁移历史数据。

## 请求构造

store 完整保存事件、IR 各版本、交付、结果和评估，筛选只发生在构造模型请求时（`sdd-context.ts`）。同一份 store 会构造出逐字节相同的请求，每次调用前把筛选记录写入 `calls[].context`，包括字符数、各类计数、省略对象及原因、警告。

- **来源视图（IR、CI、check 共用）**：
  - 每条用户输入的每一段只出现一次。若一个 IR 条目已原样承载某段，并且该条目的 span 覆盖该段，则连续这样的段合并为 `{from, to, text_in}` 指针。
  - 部分采纳、撤回、上下文、未去向段落，以及批次未被接受的输入，保留原文。
  - 未去向段落和未处理的输入列出并报告，不因 IR 未引用而裁掉。
- **IR**：模型收到当前 IR、来源视图和 `source_ledger`。准备阶段仍使用全部事件。
- **CI**：
  - 已准备的 IR，以及 `ir_change`（增删改条目和被改对象的旧版本）。
  - `history`：最近一次交付的决定；每条当前要求最近的覆盖记录，最近一轮没交付时补最近一次交付它的记录；这些交付对应的运行。
  - `feedback`：每条当前要求最近一次 IC 评估，标明 `requirement_version`（same/earlier）和 `code_state`（是否有后续运行改动了代码），不把旧 satisfied 当成已完成。
- **check**：CI 的全部内容，加上冻结的交付原文和本次 IR 更新（`ir_changes`、来源处置）。IR 条目正文若等于其交付块去掉标签后的原文，改为指向该块。
- **assess**：本次运行冻结的 CI、当时批次的 IR，以及本次结果。
- **引用补齐**：IR 引用的来源必须在请求中列出；scope 必须指向本任务已声明的对象；about/support/affects 缺失时，从历史批次补回对应版本。仍无法解析时，本批次以“request cannot be built”拒绝，不消耗模型次数。
- **check finding**：每条 finding 带 `refs`。只有能在本次请求中解析的 finding 才能阻断：已列出的输入加确切 quote、本请求中的 IR 对象版本、或被核对的 CI。其余记录在 `checks[]` 中，不生效。

离线验证见 [context-selection 报告](../experiments/sdd/context-selection/REPORT.md)。

## 状态转换与异常恢复

管理：`ir → ci → check → accepted`；核对失败回到指定的ir/ci，消耗同一显式预算。模型调用前先保存计数，崩溃不会退还次数；预算不足以完成剩余链路时终止为rejected。IR与CI在核对通过前只在临时parent内，不提前提交。hold记录原因，不启动SDD。

运行：`preparing → prepared → launching → running → returned`。创建preparing记录发生在调用外部宿主之前；一个用户事件只能有一个claim。prepared写入确切目录和CI身份；launching先持久化，再创建进程。新用户更新可以编译，但上一运行未回传时不能并行启动，已有新用户更新时也不能启动已过时的旧交付。

后续交付的baseline摘要必须等于本IC store上一运行回传的源码摘要，防止串入SDD-only或其它组的代码。宿主再用同一个共同source_hash核对磁盘源码，复制后的输入与CI正文另行冻结。

| 情形 | 行为 |
|---|---|
| 重复用户event、相同正文 | 原事件与预算不变；同id异正文拒绝 |
| prepare后宿主回写前崩溃 | reconcile读取已存在的prepared manifest并绑定原目录；不再prepare |
| 确知已prepared但未claim launch | launch-prepared可启动该目录一次 |
| launching后结果不明 | 不再次启动，只读取同目录结果；原runner的一次启动锁也保留 |
| 重复回传 | 完全相同不重复记录；相同运行的冲突结果拒绝 |
| 旧CI迟到回传 | 只写该运行及该CI的评估，不覆盖新CI |
| SDD failed/blocked/interrupted或无代码变化 | 如实保留结果；不会回到ready或触发后继派发 |
| 管理评估失败 | 只重试assessment，计数独立保存；不重新开发、不修订IR |
| 进程无completion且缺少可核对的身份凭据 | 保留原claim为未决运行，按其进程/目录证据排查，不能将新启动称为恢复 |

## 实验运行方式

管理OpenCode服务必须独立配置，`plugin: []`、`instructions: []`，管理目录与项目目录互不包含。连接入口读取实际`/config`拒绝继承插件/指令；每次模型请求工具禁用，结构化输出额外重试为0。共同SDD adapter已有`OPENCODE_DISABLE_PROJECT_CONFIG=1`并检查有效配置只含自己的预算插件。

离线构建可使用`node node_modules/typescript/bin/tsc -p tsconfig.build.json --outDir .scratch/ic-sdd-dist`，无需清理或覆盖现有dist。入口`node .scratch/ic-sdd-dist/cli/sdd.js <command.json>`读取完整JSON，避免命令行中文/换行转义。

command公共字段：`store`、`run_id`。compile另含`event`（原CompilerEvent user_input合同）、`max_requests`、`management`（server_url/directory/provider_id/model_id/variant/request_timeout_ms）。start另含`event_id`、baseline `{path,digest}`（共同run_results.source_hash）、`config_digest`（共同budget-policy.json的SHA256裸hex）、host `{python,bridge,adapter,sddSource,round,directory}`。adapter必须指向选定对比版本的冻结共同代码；bridge指向本仓库ic_bridge.py；directory专用于保存启动请求与manifest。

运行快照不能直接当作可复用adapter包：其中execution-context、Go设计扩展及构建脚本已移动到运行位置。先用`experiments/sdd/package_adapter.py <冻结运行目录> <新适配包目录>`按原文件摘要还原完整资源布局，再把host.adapter指向该新包；sddSource仍指向同一冻结runtime。真实R1已验证完整prepare和SDD启动。

reconcile/launch-prepared含`execution_id`及同一host配置。assess含execution_id、max_assessment_calls与management。inspect不连接模型，直接返回新store中的CI、运行、完整管理调用及usage；未知usage保留缺失，不按0计算。SDD调用成本仍在其冻结运行记录，与管理调用分开。旧Atom audit/cost工具不用于解读新profile。

此CLI不会自动选择模型、预算、冻结版本或启动B组15轮；这些参数由实验配置明确给出。已授权B组单独R1，控制器负责编译、启动、回传和评估；A组实际状态另见实验README。

## 验收

- [x] 新CI schema无Atom执行字段，直接生成CI；实际交付原文保留，paused来源不附送。
- [x] 复用原IR来源定位、物化、版本绑定和核对前准备，原ParentGeneration回归通过。
- [x] IR级核对失败回到IR，管理预算保存，接受前不提交。
- [x] 重复/迟到/冲突回传、启动结果不明、prepared恢复、无代码变化与失败评估覆盖。
- [x] 输入基线/policy/CI摘要变化拒绝；真实桥接代码通过独立进程假宿主验证，未调用模型/官方verifier。
- [x] 管理端继承IC插件被拒绝，结构化模型调用禁止业务工具。
- [x] 官方结果不进入管理评估；SDD内部证据随回传并绑定摘要。
- [ ] IC+SDD真实模型完整单轮与15轮对比：尚未执行，不能用离线测试代替。

验证记录：独立outDir完成TypeScript构建；新接入与原IR/来源/装配/OpenCode传输相关136项Node离线测试通过，实际Python桥接的2项独立进程测试通过。没有覆盖现有dist，没有执行模型、SDD开发或官方verifier。
