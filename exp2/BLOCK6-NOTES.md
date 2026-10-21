# 实验 2 第 6 块：同轮重推导、Windows、本地接入的代码部分

分支 `exp2-block1`，已合并 `exp2-pure-ic` 的 1d35c7b（DESIGN 第 12a 节）。没有改 `src/core/`，没有调用模型，没有运行容器。

## 1. 做了什么

| 内容 | 文件 |
|---|---|
| 一轮里新变为过期的检查，同一轮重新推导；所属对象不在本轮范围也可以；不进任务区 | `checks.ts`（第 4 块已有机制）；测试在 `checks.test.ts`、`propagation.test.ts` |
| 平台差异集中在一处：`.exe` 后缀、Python 和 Go 的命令、脚本的命令行（总是写明解释器，不靠 shebang）、子进程环境 | `src/exp2/platform.ts`，`runner.ts`、`anchors.ts`、`build.ts` 都改用它 |
| 第 1 轮的空基线改为一种程序类型（`kind: "null"`）：所有运行器直接给出 exit 1、无输出，不再真的启动一个程序 | `runner.ts` |
| 额度用完和登录失效的识别；登录失效让串行停下并报告 | `src/exp2/provider-errors.ts`，`attribution.ts`、`checks.ts`、`transport.ts`、`opencode-executor.ts`、`serial.ts` |
| docker 版的运行器、参考脚本沙箱、编译 | `src/exp2/docker.ts` |
| 命令行入口、配置文件、连接前检查 | `src/cli/exp2-serial.ts`、`src/exp2/local-config.ts`、`exp2/local-config.example.json`；`package.json` 新增 bin `intent-exp2-serial` |
| 轮后计分钩子 | `SerialConfig.score`（`serial.ts`），配置项 `scoring.command` |
| 测试用的 BLAKE2b-256 | `test/exp2/blake2b.ts`：替身程序和替身检查要用，Node 的 crypto 只提供 64 字节摘要的 BLAKE2b |

## 2. 关键做法

- **同轮重推导**：
  - R5 部分修订了 `R1.S4.P2.s1`，R1 的 verify 检查依据的是整节 `R1.S4`，于是在 R5 被代码标为过期（原因：依据被修改）。它列在 R5 推导请求的 `stale` 里。
  - 替身据此为 verify 写了一条按 BLAKE2b-256 校验的新检查：对照 R3 基线（仍用 SHA-256）是强检查。
  - R5 程序上 verify 已落地，依据就是这条新检查；旧检查不再运行。
  - 另有一个测试：一条检查的依据被修改，而它的对象本轮没有改动。这条检查列入重推导名单，入库核对接受它，但它的对象不进任务区。
- **Windows**：
  - 编译出的 `dpipe`、锚点辅助程序在 win32 上都带 `.exe`。
  - Python 依次取配置、`EXP2_PYTHON`、平台默认值（Windows 上是 `python`，其他平台是 `python3`）。
  - 脚本的命令行总是"解释器 + 脚本"，Node 程序用 `process.execPath` 运行。
  - 子进程环境在 Windows 上带上 `SystemRoot`、`TEMP`、`LOCALAPPDATA` 等，缺了这些 Go 之类的程序会起不来；不再把整个父进程环境传下去。
  - 路径一律用 path 模块拼接。
  - 单元测试分别模拟 win32 和 linux 两种情况，断言这些结果。
- **额度和登录**：
  - 按错误文本识别，包括传输层附带的诊断信息。登录失效优先判断，因为 401 的页面里也可能提到额度。
  - 管理调用遇到这两种情况时，这一步记下已花掉的调用后中止，问题代码记为 `quota` 或 `auth`；编码执行方抛出同样的错误，而不是 `SessionBroken`。OpenCode 的编码回复里如果带着 `info.error`，也按同样的规则识别。
  - 串行遇到额度用完：等待后从检查点续跑。遇到登录失效：保存这次尝试花掉的内容，恢复检查点，写停止记录，不等待。
- **docker**：
  - 每次运行 `docker run --rm --name <唯一名> --network none`，只挂这次运行的临时目录（读写）。被测程序所在的目录以只读方式挂到 `/prog`。
  - 超时后执行 `docker rm -f <名>` 清掉容器。
  - 参考脚本在容器里用镜像自带的解释器（默认 `python3 -I`）运行。
  - 编译时，工作树以只读方式挂进容器，只有输出目录可写，`GOFLAGS=-mod=readonly`。
  - 空基线不启动容器。
- **计分**：钩子在检查点写完以后运行，结果只写进检查点的报告文件和 `scores.jsonl`，状态文件里的得分始终为 null。钩子出错只记一行，串行继续。

## 3. 离线验证结果

`npm test`：全量 799 项，792 通过，失败的 1 项仍是原有的 `repair-batch`；exp2 共 111 项，全部通过。本块新增 17 项。

- BLAKE2b-256 实现与 Python 的 `hashlib.blake2b(digest_size=32)` 在空串、短串、CSV 样例、300 字节（跨块）上的结果完全一致。
- 平台：`.exe` 后缀、Python 和 Go 的默认值与覆盖、脚本命令行、Windows 和 Linux 的子进程环境，都按预期构造。空基线在模拟的 win32 上也直接返回 exit 1、无输出。
- 错误识别：3 条登录失效文本、3 条额度文本、4 条普通错误，各自分对；藏在诊断信息里的文本也能识别。
- 两个管理传输层分别抛出 `AuthInvalid` 和 `QuotaExhausted`。编码执行方遇到回复里带 `insufficient_quota` 时抛 `QuotaExhausted`，遇到 socket 断开时抛 `SessionBroken`，遇到 401 加 invalidated oauth token 时抛 `AuthInvalid`。
- 登录失效：R2 时串行立即停下，没有等待，最后一个检查点是 R1。这次尝试花掉的内容被保存，状态恢复到 R1 的检查点，停止原因里写明 "invalidated oauth token"。R1 的得分 201/219 写进了检查点的 `report.json`、`report.md` 和 `scores.jsonl`；状态里的得分仍为 null。
- docker（用一个记录参数的假 docker）：
  - 命令行包含 `--network none`，只挂运行目录，程序目录只读；
  - 容器里写出的文件能收回；
  - 超时后紧接着执行 `rm -f <名>`；
  - 参考脚本用 `python3 -I __reference__.py`；
  - 编译时工作树只读，只有输出目录可写；
  - 编译得到的程序带着 `/prog` 的挂载，`source_dir` 仍指向工作树。
- 配置：示例配置通过校验，能组装出 docker 版的串行（不运行）。错误的配置会被逐条指出：轮数、非本地服务器、相对路径、缺镜像名、检查点目录放在了代码仓库里。连接前检查会拒绝继承了插件或指令的管理服务器。计分命令的输出能被正确读取。

## 4. 需要设计会话决定的问题

**4.1 因约定修订而过期的检查，所属对象仍进任务区。** 补充一说重推导的对象"不进任务区"；第 4.5 节又说用到被修订约定的对象要出现在任务区的"受约定修订影响"小节里。我的做法：依据被修改、refers_to 引起的过期，对象不进任务区；约定修订引起的过期，按第 4.5 节进任务区。请确认。

**4.2 摘要算法错了与输入构造错了，代码分不清。** R5 的新 verify 检查放到 R3 程序上跑，输出 `MISMATCH expected=… actual=…`，这和模型手算错摘要时的输出一模一样。按"输出匹配了原文另一条规则即输入可疑"，两种情况都判为未知。这是保守的结果，代价是"实现没改算法"这种未落地在这里看不出来，要靠别的检查。

**4.3 限流（429）按额度用完处理**，即等待后从检查点续跑。限流往往是暂时的，等 30 分钟偏长。如果要区分，可以在 `provider-errors.ts` 里把它单列成一类，用更短的等待。

**4.4 报错文本只有一条是真实记录的**（invalidated oauth token），其余是常见提供方的典型写法。本地遇到的真实文本应补进测试。

**4.5 docker 镜像里不一定有 Python。** `sdd-unattended-preflight:latest` 里有 Go 和 bash，Python 是否在里面不确定。没有的话，方法 B 的参考脚本会失败，推导出的断言全部判为未知，覆盖面会明显变小。可以给参考脚本配一个单独的镜像；现在可以用 `runner.python` 指定解释器，但镜像只能配一个。

**4.6 容器里编译没有持久的 Go 缓存**，每次编译都从标准库开始，可能很慢。加缓存卷要用 `runner.extra`，而 `extra` 对检查运行也生效，与"只挂载这次运行的临时目录"相抵触。如果需要，编译可以单独配置。

**4.7 Windows 只靠结构保证。** 我在 Linux 上测不到 Windows。平台差异集中在 `platform.ts`，并分别模拟两个平台做了单元测试。仍可能有问题的地方：锁文件的进程存活检查、杀毒软件对临时目录的占用、Docker Desktop 的挂载路径写法。这些需要在本地跑一次全量测试确认。

## 5. 自查（对照本次要求）

| 要求 | 结果 |
|---|---|
| 新过期的检查同一轮重推导，对象不在范围内也加入名单，但不进任务区 | 成立：R5 的 verify 场景，以及一个对象不在范围内的场景；约定修订引起的过期例外见 4.1 |
| 用 R5 让 R1 的 verify 检查过期，同一轮重新推导、入库，verify 的状态按新检查计算 | 成立：旧检查在 R5 过期、不再运行；新检查是强检查；verify 已落地，依据是新检查 |
| 编译出的程序在 win32 上带 .exe | 成立：`exeName` 被编译器和锚点辅助程序共用，有单元测试 |
| Python 解释器可配置，Windows 上默认 python | 成立：选项、环境变量、平台默认值，有单元测试 |
| 不依赖 shebang 直接执行脚本 | 成立：脚本总是由解释器运行，Node 程序用 `process.execPath` |
| 路径拼接一律用 path 模块 | 成立：检查过 `src/exp2` 和 `test/exp2`，没有手工拼接的路径 |
| 平台相关的构造集中在一处，并模拟 win32 和 linux 写单元测试 | 成立：`platform.ts` 和 `platform.test.ts` |
| 额度用完抛 QuotaExhausted；登录失效抛 AuthInvalid，串行停下并报告 | 成立：两个管理传输层和编码执行方都接上了；登录失效的串行测试通过 |
| docker 版 CheckRunner 和 ScriptSandbox：镜像可配置、无网络、只挂运行目录、有超时、超时后清理容器；用假 docker 断言命令行 | 成立；真正运行容器留到本地 |
| 命令行入口和配置文件，支持续跑；`exp2/local-config.example.json` | 成立；续跑由 `Serial.run` 从最近的检查点开始 |
| 轮后计分钩子，结果写进报告的得分一栏，绝不回送系统 | 成立：只写检查点的报告文件和 `scores.jsonl`，状态文件里的得分始终为 null |
