# 实验 2 第 7 块：第 6 块的决定与同步（DESIGN §12b）

分支 `exp2-block1`，已合并 `exp2-pure-ic` 的 fa57442（DESIGN §12b、§13.3 和 Haiku 参考录音）。没有改 `src/core/`，没有调用模型，没有运行容器，没有读官方测试。

## 1. 做了什么（按 §12b 编号）

| 项 | 内容 | 文件 |
|---|---|---|
| 1 | 约定修订引起的过期，载体进任务区；依据或 refers_to 引起的过期只重推导。第 6 块已是这样，未改 | `workorder.ts` |
| 2 | 摘要、哈希这类算出来的值只由方法 B 给出。期望值的来源新增 `computed`：模型不写值，代码取参考脚本的输出。输入文件里写 `{{computed:NAME}}`，代码在任何运行之前用参考脚本输出的 `NAME` 填进去。手写的摘要（32 位以上十六进制，且原文里没有）退回，问题代码 `computed_by_hand`。输入是代码算的，程序却报出本对象自己的规则（如 `MISMATCH …`），判值不符、未落地 | `checks.ts`、`store.ts`、`verdict.ts` |
| 3 | 普通限流（429、rate limit）在同一次调用里短退避重试（默认 15 秒、45 秒、120 秒），不算步骤的尝试；只有明确的额度用完文本才走 30 分钟续跑；分不清的按限流；重试用尽按额度用完。管理调用和编码会话都接上了；退避可在配置的 `rate_limit.delays_ms` 里改 | `provider-errors.ts`、`transport.ts`、`opencode-executor.ts`、`local-config.ts` |
| 4 | docker 里的 Python 默认 `/opt/sdd-python/bin/python3`，可用 `runner.python` 改。镜像没有 node：node 参考脚本直接失败，报"the image has no node"，除非配置了 `runner.node` | `docker.ts`、示例配置 |
| 5 | `runner.buildCache`（docker 卷名或主机目录）只挂进编译容器的 `/gocache`；检查运行和参考脚本不挂 | `docker.ts`、示例配置 |
| 6 | 主机拒绝启动程序（spawn `UNKNOWN`、"Application Control policy"）：启动时重试 3 次，仍被拒就抛 `EnvironmentBlocked`，不作为运行结果。串行遇到它：保存这次尝试、恢复检查点、写停止记录，不算步骤失败，不消耗尝试 | `platform.ts`、`runner.ts`、`build.ts`、`serial.ts` |
| 7 | 录音和回放。录音原样保存请求全文、回答、usage 和模型标签。回放按请求哈希取回答；找不到就抛 `ReplayMiss`，归属和检查推导都不把它当作一次失败的调用，直接停下，不退回替身。Haiku 参考录音（R1–R3 归属）已接进测试 | `recording.ts`、`attribution.ts`、`checks.ts`；`exp2/recordings/haiku-reference/cassette.json`；`.gitattributes` |
| 7 | 录音里没有 usage 的调用记 `usage_unknown`，报告里写"+ n calls unknown"，不计为零 | `attribution.ts`、`checks.ts`、`report.ts` |
| 8 | 只指标题本身的单位 `R<n>.S<k>.H`；问题按根源合并（一处上级重叠一条，同一父块下的漏覆盖一条），并列出受影响的编号。修补请求里不再重复列出 `blocks`（消息里已经写了） | `source.ts`、`registry.ts`、`attribution.ts` |
| 9 | 程序名从原文的构建命令读出（`go build -o <name>`），读不到时为 `app`；本地构建和 docker 构建都用它。检查 schema 的示例改成中性写法 | `build.ts`、`docker.ts`、`local-config.ts`、`checks.ts` |
| 10 | 每轮检查点里写 `prediction.json`：每个对象的状态（已落地、未落地、未知）和 sha256，并追加到 `checkpoints/predictions.jsonl`；在计分之前写。计分记录里带上这个哈希。对账的数据格式和纯函数 `reconcile`：本地把官方逐条结果对回对象后调用 | `prediction.ts`、`serial.ts` |
| 11 | 归属比较工具：按共有的子句匹配两边的对象，在子句和块（段落）两级比较归属，另比较部分修订和"适用于"边，列出分歧（同一种分歧合并到最粗的整块） | `compare.ts`、`src/cli/exp2-compare.ts` |
| 13 | 变异测试：Go 辅助程序列出变异点（比较符换成相反的、整数常量加减一、清空 if 分支），驱动程序逐个在副本上编译、跑检查库。原程序上通过、变异后失败，算抓到 | `src/exp2/go/mutate/`、`mutation.ts`、`src/cli/exp2-mutate.ts` |
| 14 | 三个消融开关，只改输入或路径：`zoning: false` 让所有在用的对象都进任务区；`checks: false` 不推导检查；`clauses: false` 切分时不切子句（store 记下这个设置，换设置打开同一个状态会报错） | `workorder.ts`、`serial.ts`、`source.ts`、`registry.ts`、`store.ts`、`local-config.ts` |

新增命令行：`intent-exp2-rekey`（按回答顺序重新生成回放文件）、`intent-exp2-compare`、`intent-exp2-mutate`。

## 2. Haiku 参考录音

请求字节和 dfeb22e 不同（新的标题单位、按根源合并、修补请求不再重复列出 `blocks`），所以 `cassette.json` 是按回答顺序重新生成键的：当前代码逐轮构造请求，按录音顺序给出原回答，记下新请求。原请求仍在 `R<n>-prompt<k>.md`，录音目录的 README 写明了重新生成的命令。

| | dfeb22e | 现在 |
|---|---|---|
| R1 首答的问题 | 44 条 overlap | 1 条 overlap（R1.S1 与其中 44 个块），提示改用 `R1.S1.H` |
| R1 修补请求 | 42,958 字符 | 37,434 字符 |
| 结果 | 4 次回答，三轮通过 | 4 次回答全部用上，三轮通过 |

修补请求里大部分字符是 `previous_draft`，所以只少了 13%。

替身归属与 Haiku 的比较（R1–R3）：子句 1127/1136 一致，段落 244/247 一致。分歧：`R1.S0` 替身归 tool、Haiku 标 none；Haiku 把 derive 拆成 derive 和 expression，`R1.S3.P2.s5`、`R1.S3.P8` 因此不同；部分修订的范围有 4 处不同，都是替身标得更宽（如 fill 的 `R2.S13.P4.s4`，替身标 c1–c3，Haiku 只标 c3）。

## 3. 离线验证结果

`npm test`：全量 818 项，811 通过，6 项跳过，失败的 1 项仍是原有的 `repair-batch`（缺夹具文件）。exp2 共 130 项，全部通过，本块新增 19 项。

- 标题单位：15 轮都能逐字拼回，标题单位排在小节第一位；有其他内容的小节，标题单位可以不归属。
- 算出来的值：
  - R1 的 verify 检查用 `{{computed:digest}}`，入库时输入已被填成 64 位十六进制，`computed_inputs` 记为 `["digest"]`；
  - 首答里手写摘要的检查被退回（`computed_by_hand`），修补后改为代码计算；
  - 一个算错摘要的程序（对去掉末尾换行的内容求 SHA-256）上，这条检查判值不符、未落地，verify 未落地；
  - R5 撤回 sidecar 的检查，期望值改为 `computed`。
- 原来"手写错摘要"的可疑输入示例换成了"参数里写的校验文件没有给出"：程序报 `ERROR: file not found: other.sha256`，属于另一条规则，仍判未知、不阻止已落地，两轮后由代码退役。
- 限流：两次 429 后第三次成功，等待依次 1、2（测试用的毫秒数）；一直 429 时，三次重试后抛 `QuotaExhausted`；明确的额度文本不重试；编码会话被限流时在同一会话里重发同一请求。
- 环境拦截：spawn `UNKNOWN`、"Application Control policy" 识别为环境错误，ENOENT 不算。R2 第一步编译时抛 `EnvironmentBlocked`：串行停下，最后检查点是 R1，原因以 `environment:` 开头，R2 没有留下失败的步骤记录。
- 回放：Haiku 录音回放 R1–R3 全部通过，4 条录音各用一次，调用都标为 `usage_unknown`、非替身、模型为 Haiku。改动原文后回放抛 `ReplayMiss`。替身的录音回放后，三轮结果与录音时相同。
- docker：Python 默认 `/opt/sdd-python/bin/python3`；node 脚本不启动容器；编译容器挂 `exp2-gocache:/gocache`、`GOCACHE=/gocache`；检查运行不挂缓存。
- 程序名：从 R1 原文读出 `dpipe`；`go build -o ./bin/tool.exe ./cmd/tool` 读出 `tool`；没有构建命令时为 null。
- 预先登记：哈希与对象顺序无关，改动任何状态就不再相符；`reconcile` 分出 ic_wrong、too_strict、agree、unknown、no_cases 和未对上对象的用例；哈希不符时拒绝对账。串行里，R1 的 `prediction.json` 在计分之前写出，`scores.jsonl` 的那一行带着同一个哈希。
- 比较工具：同一份归属自比全部一致；改坏的独立标注在出错的那一轮停下，报告之前已比较的轮数。
- 变异测试：在 R1 的 Go 样例程序上，`filter` 的 `>` 改成 `<=` 被 filter 的检查抓到；也有没被抓到的变异（如检查库没覆盖的 `<`）。
- 消融：不切子句时，没有子句层，其他编号不变，拼回逐字一致；不分区时任务区是全部对象，保护区和状态区为空，原文区不变；不建检查库时串行跑完 R1，没有检查调用，所有状态为未知。

## 4. 需要设计会话决定或知道的

**4.1 执行方的命令没有放进镜像。** §12b 第 6 项要求"执行方编码会话里的命令也尽量在同一镜像里执行"。编码会话的工具命令由 OpenCode 在主机上执行，我这边改不了。已做的是：构建、检查运行、参考脚本在 docker 里；主机拦截按环境错误处理。若要让 OpenCode 的命令也进镜像，需要把 OpenCode 服务本身放进容器运行，这是本地部署的事。

**4.2 环境拦截时串行停下，而不是等待。** 我按登录失效的方式处理：停下、写停止记录、等人处理。理由是 Smart App Control 不会自己关掉。若希望像额度那样定时重试，改 `serial.ts` 一处即可。

**4.3 手写摘要的识别是 32 位以上的十六进制串，且不在原文中出现。** base64 形式的摘要识别不到；短于 32 位的十六进制（如截断的 8 位前缀）也识别不到。dpipe 原文里的摘要都是十六进制全长，所以先这样。

**4.4 输入里故意放错的摘要。** 例如"校验文件内容不符时报错"这类检查，需要一个错的摘要。现在的写法是参考脚本对别的内容求摘要，再经 `{{computed:NAME}}` 填入；模型手写一个十六进制串会被退回。系统提示里说了"不要自己算摘要"，但没有专门举这个例子。

**4.5 比较工具要求独立标注用同一个 schema 写整份回答**（每轮一份 `AttributionAnswer`，不是补丁），并且要能通过同一套核对。不通过的那一轮之后不再比较。若独立标注只标到段落，也可以：子句会继承段落的归属。

**4.6 消融的状态要另起。** `clauses: false` 写进状态文件，用不同设置打开同一状态会报错。另两个开关不写进状态，同一个 `run_id` 混用不会被拦下，`LocalConfig.ablation` 的说明和 READY-FOR-LOCAL 第 8 节写了要换 `run_id`。

## 5. 自查

### 5.1 §12b

| 项 | 要求 | 结果 |
|---|---|---|
| 1 | 约定修订让载体进任务区；依据或 refers_to 引起的过期只重推导 | 成立（第 6 块已有，测试仍通过） |
| 2 | 算出来的输入和期望值只由代码执行方法 B 得到；MISMATCH 判值不符；A、B 不一致仍为未知 | 成立；A、B 不一致的路径未改，原有测试通过 |
| 3 | 限流短退避重试，计入本次调用；只有明确的额度提示才走 30 分钟；分不清按限流；重试用尽按额度用完 | 成立 |
| 4 | 镜像 Python 路径可配置，真实运行填 `/opt/sdd-python/bin/python3`；镜像没有 node | 成立：默认就是这个路径；node 脚本明确失败 |
| 5 | 单独的构建缓存卷选项，不走 `runner.extra`；检查运行不挂 | 成立 |
| 6 | 被拦截的错误归为环境错误，不算步骤失败、不消耗尝试；构建、检查、参考脚本放进 docker | 成立；执行方命令进镜像见 4.1 |
| 7 | 录音：原样的请求、回答、usage，标明模型；回放：按哈希取，找不到报错，不退回替身；Haiku 录音接进测试；`.gitattributes` | 成立；请求字节已变，按回答顺序重新生成键，见第 2 节 |
| 8 | 标题单位；按根源合并问题并列出编号 | 成立：R1 首答从 44 条变为 1 条 |
| 9 | 程序名从构建命令读出；检查 schema 示例中性 | 成立 |
| 10 | 计分前冻结状态并记哈希；对账的数据格式 | 成立；对账只在本地调用 |
| 11 | 比较工具，块和子句两级，列出分歧 | 成立 |
| 13 | 变异工具，只在本地对已有产物运行，不进每轮流程 | 成立：串行里没有调用它 |
| 14 | 分区、检查库、子句级部分修订各一个开关，只改输入或路径 | 成立 |

### 5.2 §13.1（前 5 块的验收在本块改动后仍成立）

| 块 | 结果 |
|---|---|
| 1 | 成立：15 轮 LF、CRLF 逐字拼回（含标题单位）；覆盖恰好一次；编号、版本、归属跨轮不漂移；替身错误被指出并修好；首答与修补前缀逐字节相同（`issues` 和 `previous_draft` 仍在最后） |
| 2 | 成立：空壳不能落地；值不符判未落地；输入被拒判未知且不阻止落地（换了示例，见第 3 节）；过期标记、退回的各类错误、撤回方向都仍有测试 |
| 3 | 成立：测试未改动，全部通过 |
| 4 | 成立：测试未改动，全部通过 |
| 5 | 成立：R1–R15 串行、打断续跑与不打断一致、token 齐全且替身标明；本块另加环境拦截时的停止 |
