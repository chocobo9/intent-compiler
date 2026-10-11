"""Minimal SDD adaptation used only by the IC+SDD arm (user decision, 2026-10-10).

The upstream PRD skills forbid "code identifiers" in the PRD. That rule was
written for HarmonyOS apps, whose observable behaviour is UI. For a command-line
data tool the user-visible interface *is* identifiers: commands and flags, file
formats, JSON field names and values, output and error text, exit codes. The
rule removed those names from the PRD, so SpecArt specs lacked them and the
implementation had to guess (e.g. `operator` instead of `condition`).

Each edit appends one exception sentence to an existing rule; nothing else in
SDD changes. Applied to the arm's frozen copy only, never to D:/sdd.
"""
import hashlib
from pathlib import Path

EXCEPTION = ('例外：命令行、数据处理等非 UI 产品的外部接口（命令与参数、输入输出文件格式、JSON 字段名与取值、'
             '输出与错误文本、退出码）属于可观察行为，原始需求写明的必须原样保留，不得改写或删除。')

EDITS = [
    ('.agents/skills/prd-clarify/SKILL.md',
     '7. **不读源码、不谈实现方案**：只澄清规格与可观察行为；终稿禁止代码标识符，工程代码形态的设计稿只抽取可观察行为并业务语言转写（如「点击遮罩不关闭弹窗」，而非引用代码属性）。',
     '7. **不读源码、不谈实现方案**：只澄清规格与可观察行为；终稿禁止代码标识符，工程代码形态的设计稿只抽取可观察行为并业务语言转写（如「点击遮罩不关闭弹窗」，而非引用代码属性）。' + EXCEPTION),
    ('.agents/skills/prd-clarify/references/prd_template.md',
     '- [ ] 无代码标识符（属性名、类名、API 名等实现细节）残留',
     '- [ ] 无代码标识符（属性名、类名、API 名等实现细节）残留；' + EXCEPTION),
    ('.agents/skills/prd-fix/SKILL.md',
     '- 不得引入代码标识符（类名、方法名、变量名等实现细节）到 PRD 正文。',
     '- 不得引入代码标识符（类名、方法名、变量名等实现细节）到 PRD 正文。' + EXCEPTION),
]


def apply(sdd_source):
    """Apply every edit to a copied SDD tree; returns the before/after record."""
    root = Path(sdd_source)
    record = []
    for relative, old, new in EDITS:
        path = root / relative
        text = path.read_text(encoding='utf-8')
        if text.count(old) != 1:
            raise ValueError(f'Upstream text changed; refusing to patch {relative}')
        before = hashlib.sha256(path.read_bytes()).hexdigest()
        path.write_text(text.replace(old, new), encoding='utf-8')
        record.append({'file': relative, 'before_sha256': before, 'after_sha256': hashlib.sha256(path.read_bytes()).hexdigest(),
                       'appended': EXCEPTION})
    return record
