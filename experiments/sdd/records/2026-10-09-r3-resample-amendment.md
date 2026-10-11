# R3 oversample 精确数量契约补齐

R3 `111701z-d36eb1bc` 于 12:15:05 UTC 因 design_revision_limit_reached 停止，cleanup 已确认。PRD、SD、change 已通过；作者初稿加五次修订共6次，独立审查4次。最终审查只剩 oversample 精确输出数量未明确，尚未进入 coding。旧 completion、账本、源码和诊断评测全部保留。

依据本轮原始需求 output/01-原始需求.md:907–912，oversample 对少数组循环复制直到每组恰好 target 行，target 为最大原始组大小。当前 main.go:43,477 仅写最大组大小为 target、原始行先于复制行，没有明确数量等式和停止条件。该项属于模型规格遗漏，而非 Go 解析器错误；不使用官方测试反馈补齐。

用户已授权必要修复和继续交付15轮结果。本次记录一次有界人工编排介入：仅本R3将规格修订5→6，保留旧起点和全部计数，允许一次额外Author补齐下列契约。默认v4及后续轮次仍5次，文档续做保持2/2，coding和PRD额度不变。必须重新独立审查和原accept-design，不能据本说明自动PASS。

## 交给 Author 的具体工作

读取当前全部原始需求、PRD与现有源码规约。仅补齐 Operation、Transform 及对应summary中的 resample oversample 数量定义：每组最终恰好 target 行；不足者按原组内顺序循环复制，达到 target 立即停止；本来为最大组的组不增加行。保留已写明的组键字典序、原始行先于复制行。核对 undersample 的结果也恰好为最小组大小，避免同一数量约束遗漏。

仅修改规格契约与对应summary，不重新生成PRD/SD/change，不实现函数体。使用小段编辑。先做原自检，再委派独立Reviewer全范围核查，最后执行原机械验收。不得读取官方测试或其它运行产品。

## 运行适配变化与验证

recover_design.inspect_parent 允许对已耗尽、尚未进行design恢复的设计直接使用既有一次amendment入口，避免先制造无意义的review-only恢复。已有amendment链仍拒绝重复增加，原计数、policy身份、清理、文档状态、未进入coding和生命周期约束均保留。补充实际入口回归测试：改前拒绝合法直接amendment，改后通过并拒绝重复amendment。恢复/串行沿革/文档恢复/预算套件以PYTHONUTF8=1运行22 passed。

## 实际启动

新R3：`D:/huawei/EvoCodeBench/harbor_runs/sdd-luna-dpipe-r3-20261009-122450z-6f306db4`，12:25:02 UTC启动，12:25:49进入额外一次Author修订。新控制器`.scratch/sdd-continuation-controller-122450`等待本轮真实完成后验证并承接R4，指针为新R3同级`.series-continuation.json`。旧控制器保留blocked，未重复启动旧系列。模型和原门禁未变。
