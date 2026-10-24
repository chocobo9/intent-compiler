# eventq 13 轮原文

`round-01.md` 到 `round-13.md` 逐字节复制自 EvoCodeBench 任务 `theme_d5_w1_data_engineering_greenfield_implementation` 的 `steps/round-N/instruction.md`（2026-10-24，先导题）。只有题面；官方测试和参考答案没有放进来，也不得以任何方式获取或反推。真实运行时第 N 轮只能看到第 1 到第 N 轮的原文。

程序：`/app/eventq`，离线构建（标准库或 vendor），Go 1.22。基准表：最强模型 95%，其余约 41%；13 轮、原文共约 245k 字符、22 个官方用例。
