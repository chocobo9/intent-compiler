# lsm-kvstore 8 轮原文

`round-01.md` 到 `round-08.md` 逐字节复制自 EvoCodeBench 任务 `theme_d6_w1_database_storage_greenfield_implementation` 的 `steps/round-N/instruction.md`（2026-10-23，换题候选，尚未运行）。

只有题面。官方测试和参考答案没有放进来，也不得以任何方式获取或反推。

真实运行时，第 N 轮只能看到第 1 到第 N 轮的原文。离线验证也要按这个顺序一轮一轮地喂。

与 dpipe 的差异（换题时要改的运行配置，不是代码）：程序名 `kvstore`，构建命令 `go build -o kvstore ./cmd/kvstore`（原文写明）；计分脚本 score.mjs 里的 OFFICIAL 路径和 build_go_cli.sh 里的二进制名都写死为 dpipe，需按题参数化；487 个用例，最强模型 90%。
