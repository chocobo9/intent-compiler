# R3 PRD 超长工具参数截断

运行 `sdd-luna-dpipe-r3-20261009-104635z-14642088`，会话 `ses_edfba51acffeCIOiR6hdcQMNqV`。

首次PRD调用在11:00:16 UTC返回。OpenCode记录最后assistant finish=length，output=127884 token，apply_patch为error、Tool execution aborted、无完整input。目标PRD文件不存在。文档guard保存attempt-0.json（exit_code0、result missing）并已同会话计入第1次续做。

这次没有完成文件写入，不能报为PRD正常完成。根因证据指向单个超大写文件参数在模型输出上限处截断，未交给工具执行；没有证据说明文件权限或中文路径解码失败。

共同execution-context及model_guard后续续做指令补充：先落小框架，再以约4000字符的小段补齐并读回，最后执行原有完成检查。未修改SDD核心、验收标准或时间/次数政策。此改动仅用于后续冻结版本，当前R3及其冻结series不热更，不能宣称当前调用已应用修复。

11:02检查时原会话仍在第1次续做的apply_patch生成中；需根据其真实完成/截断事件判断是否再次发生，而不是仅按经过时间终止。若重复截断或最终文档仍缺失，保留原预算和会话证据，处理具体文档续做适配，不传播空基线到R4。

## 11:12 UTC 后处理

第1次续做仍在未完成的apply_patch参数生成中，没有落盘文件。宿主中断该OpenCode调用；上游随后重新调用同一PRD步骤，暴露了外层重试不计document_revisions的缺口。继而在原共享账本写入operator_stop事件及document_output_interrupted停止原因，运行器按原ProcessScope清理全部子进程，11:15:34确认cleanup，11:15:55结束并保留失败评测。这里是有证据的人工中断，不是新设时间上限，也不声称第二次已经返回length。

共同budget.admit_external现记录prd/sd/change各自调用次数：同一文档的外层重新调用与内部同会话续做共享document_revisions，不能借上游重启绕过2次上限。新恢复已预扣续做额度时使用一次性的角色绑定预付标记，防止重复扣款；用后立即消费。

新增recover_document.py仅处理PRD尚未落盘、其它文档/规格未开始、代码基线未变、原进程已清理且还有文档续做额度的情况。原要求、基线及策略相同；新编排会话使用新的分段写入指令，保留旧账本起点和全部计数，明确记录旧model session未恢复。恢复预扣最后1次文档续做，累计2/2；不能链式重复恢复。

新R3：`D:/huawei/EvoCodeBench/harbor_runs/sdd-luna-dpipe-r3-20261009-111701z-d36eb1bc`。已启动。新控制器`.scratch/sdd-continuation-controller-111701`等待其完成后从R4继续；状态指针为该R3根目录同级`.series-continuation.json`。父series9d65df3d保留blocked及失败R3，不重启。

文档恢复、续做、预算、串行沿革相关测试29 passed，包含外层/内部共用限额、一次性预付不重扣、旧账本不变及超额拒绝。未修改模型、官方测试、SDD核心或原验收规则。
