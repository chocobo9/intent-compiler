# R2 一次有界契约补齐

用户再次明确授权必要修复并要求完成15轮，不再停等常规修复授权。

最新独立审查确认assert失败的返回错误文本已有定义，但ReportCommandError列出的stderr通用分类没有明确包含合法assert失败。请Author按原始需求更新2的assert章节及PRD对应条目补齐：合法assert失败在CLI最终写stderr `ERROR: assertion failed on row N: <message>`，退出1，不添加invalid recipe。Transform返回的错误和CLI最终输出需要明确衔接。仅补这处跨函数错误传播契约并同步summary，保留其它现有行为，不修改任何函数体或需求文档。

本次显式将本轮规格修订上限从5增加至6，仅允许一次额外Author修订；原作者6次与review5次照常继承，未清零。新策略版本为sdd-count-bounded-v4-amendment-1。其它文档/coding/PRD次数、无时间截止、所有机械门禁不变。后续独立审查和accept-design必须真实通过，不能以本说明替代PASS。未来轮次仍使用默认v4的5次规格修订。

此为有记录的实验介入，最终报告必须保留原失败、额外修订、审查与版本沿革。
