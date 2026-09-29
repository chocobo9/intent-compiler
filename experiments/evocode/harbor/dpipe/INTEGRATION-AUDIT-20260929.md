# 2026-09-29 接入链路检查

> 后续纠正：run `intent-sol-dpipe-full-20260929-102950-f691792d` 仍失败。直接错误是本文上一版补丁将宿主的InstanceStore.use代理对象作为函数调用；此前模拟测试定义错误，未发现这个接入缺陷。不能再引用下文的局部检查作为该版接入正确的证明。

## 最新修复：真实宿主API调用

- 改为宿主自身调用方式`InstanceStore.Service.use(store => store.provide(...))`，保持执行cwd选择。
- 将真实插件获取和drain钩子检查放到CLI请求之前；finally收尾复用同一个executionHooks函数，缺失或API异常提前失败，不先消耗模型调用。
- 安装检查同步更新；测试将模块级use恢复为不可调用对象，覆盖缺失钩子时请求数为0。
- 用固定宿主InstanceStore源码、service-use源码及其Effect 4.0.0-beta.83真实类型检查：旧调用产生TS2349“无调用签名”，新调用无诊断。整个宿主补丁辅助检查遇到宿主args.attach类型的依赖解析诊断，未宣称完整宿主类型检查通过。
- 测试源码编译、CLI与adapter共8项回归、Python语法及diff检查通过。无付费请求，无新官方评分；未修改核心语义逻辑及历史运行目录。

范围：直接核对当前脚本、冻结宿主源码、Compiler adapter/transport/store及失败产物。没有搭建重放环境、调用模型或启动Harbor。历史run未修改。

## 已修问题

1. CLI收尾原来用启动目录的localInstance取插件，执行会话实际在/app。现在InstanceStore按执行cwd取插件；compiler模式缺失drain直接报错。
2. CLI请求返回error或抛异常时跳过finish。现在非交互请求在finally中等待drain，错误分支不等待可能永不出现的terminal订阅事件。成功分支仍先等待执行结束，再等待管理回传。
3. 上游OpenCode命令经tee掩盖退出码，Harbor基类记录return-code.txt却不拒绝失败。驱动以bash pipefail运行原命令并读取本轮每个命令的退出码；非零或缺失都阻止verifier。
4. Harbor任务异常可能伴随CLI退出码0。run-full现在同时检查trial exception_info、verifier_result及15轮结果文件；失败或缺失明确报错，不自动重启。Windows PowerShell原生stderr转成文本保留，避免普通进度显示为NativeCommandError。

## 核对范围和证据

| 环节 | 检查结果 |
| --- | --- |
| prepare / install | 新目录存在即拒绝；build后冻结当前runtime；实际cmd/session覆盖挂载；安装检查新drain补丁与模型具体工具配置。 |
| 工具执行 | GPT能力含apply_patch，不含write/edit；Atom仍逐个精确授权，未授权工具继续拒绝。 |
| terminal / return | 宿主event是void调用；adapter追踪完整pendingWork，合并重复terminal，drain等待管理advance；回传stopped/ready和真实报告，不把日志对账当completed。 |
| 管理调用 | 隔离目录明确传给create/prompt/abort；超时先确认取消再允许重试；store恢复未accepted的return，driver不把pending空当处理完成。 |
| 跨轮和证据 | 每轮记录新execution集合；要求所有新execution有outcome和accepted return记录；finally保存分轮日志及选定三表；不导出认证数据库。 |

## 本次实际执行检查

- `npx tsc -p tsconfig.test.json`、`npm run build`通过。
- 16项TS回归通过：CLI收尾、adapter、runtime、模型transport、return恢复。
- `test_return_gate.py` 8项通过：退出码、回传接纳门槛、命令引用保持。
- 对真实固定宿主run.ts在内存应用补丁，锚点及TypeScript语法检查通过；未修改固定宿主。
- 实际Bash执行`false | tee /dev/null`配合pipefail返回1。
- 用旧失败run的result.json运行当前脚本的报告分支，模拟Harbor退出码0，仍正确抛出原trial失败；只读取历史证据。
- PowerShell语法检查通过。临时源码检查命令遇到Python输出编码/CRLF断言问题，修正检查命令后通过，未修改运行语义。

真实失败目录：`D:/huawei/EvoCodeBench/harbor_runs/intent-sol-dpipe-full-20260929-095622-86aa257d`。该run所有官方轮次无结果。此次检查证明上述具体代码路径和错误传递；没有新增完整模型运行结果。


最新接入收尾：prepare在创建run和调用模型前运行check-host-patch.mjs，直接用固定宿主及Effect真实类型检查生成的CLI辅助函数，并验证已知错误调用确实会被拒绝。检查已通过。adapter在terminal失败时仍等待其余pendingWork；驱动证据采集异常不覆盖原始执行异常。17项TS和9项Python检查、生产构建通过。仅接入层变更，无核心语义改动，无付费运行。



实际宿主接入检查已完成：复用现有镜像和固定宿主，当前项目只读挂载；网络禁用，认证目录与/app使用空tmpfs，未调用模型。直接抽取生成补丁的executionHooks/drainExecution函数，真实AppRuntime、InstanceStore、Plugin加载Compiler插件，调用drain并dispose。输出REAL_PLUGIN_LOADED 1、REAL_DRAIN_COMPLETE、REAL_RUNTIME_DISPOSED，进程退出0。证据：project/.scratch/host-connectivity-d2567239/result.log及overlay内intent-probe.ts。此检查覆盖真实插件加载和无执行请求的收尾；不代表执行后的管理模型回传或官方15轮已完成。

