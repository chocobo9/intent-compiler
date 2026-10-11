"""Prepare the shared Go CLI workflow. This module never launches a workflow/model.

Inputs must be the arm's approved delivery and its own previous code baseline.
No IC store or cumulative user transcript is discovered or read here.
"""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import re
import shutil
from budget import load_policy

ROOT = Path(__file__).resolve().parent
EXCLUDED = {'.git', '.opencode', '.specart', '.specart-verify', '.system-design',
            '.coding-done', '.verdict.md', 'opencode.json', 'opencode.jsonc'}
STAGES = {'prd', 'sd', 'change', 'specart', 'main-coding', 'main-prdcheck'}


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def workflow(base, build_command, policy=None):
    policy = policy or load_policy()
    config = json.loads(json.dumps(base))
    config['nodes']['3']['path'] = 'repos/origin'
    config['nodes']['7']['path'] = 'repos/main'
    config['toolchain'].update(build_command=build_command, dir='', auto_discover=False)
    config['stages'] = [stage for stage in config['stages'] if stage['id'] in STAGES]
    config['skills']['coding']['paths'] = {'main': config['skills']['coding']['paths']['main']}
    config['skills']['sd']['skill'] = 'generate-go-cli-system-design'
    config['skills']['sd']['prompt_template'] = config['skills']['sd']['prompt_template'].replace(
        '::generate-harmonyos-system-design', '::generate-go-cli-system-design')
    coding = config['skills']['coding']
    if 'prompt_template' in coding:
        coding['prompt_template'] = coding['prompt_template'].replace(
            '不修改 ${n7_path}/ 以外的文件',
            '业务源码只修改 ${n7_path}/；允许原 SpecArt 命令维护 ${n6_path}/.specart/ 中的生命周期记录，'
            '验证证据写入 ${n7_path}/.specart-verify/；不得改写已验收规格或只读输入')
    spec = config['skills']['specart']
    spec['inputs'] = ['2', '7', '4', '5']
    spec['step'] = '2+7+4+5->6'
    spec['prompt_template'] = spec['prompt_template'].replace('${n3_path}', '${n7_path}').replace('语言 arkts', '语言 go')
    # node6 is the artifact parent; the validator consumes its .specart child.
    for key in ['specart', 'coding']:
        if 'prompt_template' in config['skills'][key]:
            config['skills'][key]['prompt_template'] = re.sub(
                r'规格目录（SPEC）= \$\{n6_path\}/(?!\.specart/)',
                '规格目录（SPEC）= ${n6_path}/.specart/',
                config['skills'][key]['prompt_template'])
    language_note = '\n目标是 Go CLI；无 UI 的章节标为不适用。不得为适应鸿蒙模板添加页面、Ability 或设备要求。'
    stage_notes = {
        'prd': '本阶段只澄清需求并生成 PRD，保留原文中的命令、参数、文件格式和退出行为。',
        'change': ('本阶段只生成架构变更文档。按 generate-system-design-change 的第3步，从基线复制独立目标设计，'
                   '根据 PRD 更新目标设计表格，标明待实现；空代码基线同样适用。'
                   '目标设计是需求驱动的提案，不调用代码证据刷新技能，不创建规格或产品代码；'
                   '后续 specart 和 coding 阶段由工作流分别启动。'),
        'specart': ('读取 .agents/skills/specart/references/go-language.md；源码骨架位于 repos/main。'
                    '本阶段只做规格设计、独立审查和机械验收，不实现函数体。'
                    '起草每个源码规约前，先对照原始需求与 PRD 做完整覆盖盘点：逐一检查命令及其嵌套输入的字段映射、类型/必填/默认值/约束、处理顺序与并列规则、输出列布局和序列化、边界行为、精确错误与退出码、文件路径及写入语义；只记录来源明确支持的行为，不自行补造。'
                    '独立审查若返回 SPEC_GAP，Root 必须把该次报告中的全部缺口原样成组交给同一次下一轮 specart-author；Author 按整组修订，并再对照需求做上述覆盖盘点，避免逐条修订造成新一轮遗漏。新审查若发现此前未列出的真实缺口，仍按原流程修订，不得压制或绕过审查。'
                    '每个 Go 源码行为规约块都要完整同步到 summary.yaml 对应 behavior；更新后逐项比较两处完整正文，保留相同内容与段落边界，不做摘要、改写或合并，以满足 SpecArt 的源码/summary 一致性校验。'
                    '验收前逐一核对每个 @ensures 与该函数规约描述的所有成功及失败路径是否同时成立。返回 error 的函数若规约允许输入、I/O 或执行错误，就不得无条件写 @ensures result == nil；错误路径必须保留非 nil error 语义。只有 SpecArt 支持的条件表达式能准确区分成功/失败时才写条件后置条件；否则用行为正文完整描述返回规则并省略无法准确表达的 @ensures，不得加恒真子句、假设无错误、隐藏错误或改函数签名。'
                    '若本次原始 SpecArt validate --format json 返回 SA180，Root 按运行器附加的只读诊断命令执行一次，保留完整原始诊断；'
                    '只有诊断状态为 diagnosed 且报告通过 verify-report 新鲜度核对时，才把报告交给同一设计阶段下一次正常 specart-author 调用。'
                    '诊断失败、输出损坏或解析器环境阻断时，不得解释为没有 SA180；诊断不改变验收状态，也不增加 Author 次数。'
                    '设计的包布局和入口必须兼容本次交付构建命令：' + build_command),
        'coding': ('读取 .agents/skills/specart/references/go-language.md。原始需求=${n1_path}，PRD=${n2_path}。'
                   '实现已验收规格时只填充既有函数体；不得整文件重写、删除或改写任何已验收源码声明、'
                   '紧邻行为规约注释、@changedBy 标记或类型结构。保持 summary.yaml 中每个声明的文件、作用域和完整签名一致；'
                   '如发现实现需要不同签名，停止并报告规格差距，不得自行改签名或 summary。'
                   '本阶段执行已验收规格的实现、独立验证及授权范围内修复。实现造成声明或行为注释偏离时，'
                   '先按已验收规格修复实现，不为迁就实现而改写 summary 或验收记录。'
                    '必要 Go 项目配置和入口由实现阶段补齐，实际构建命令为：' + build_command),
        'prd-fix': ('PRD/MISMATCH 代码修复必须通过已配置的 `specart-implement` 子 Agent 派发，禁止使用通用 `general` 子角色；'
                    '将检查报告中的全部可按 PRD 修复项成组传给该次修复任务，并要求其读取 ADAPTER-CONTEXT.md、原始需求和对应 PRD 条目，'
                    '只修改 repos/main/，不得改 PRD 或已验收 SpecArt 声明/规约。修复后由新的 `specart-verify` 子 Agent 独立复验，再运行指定 Go 构建命令；'
                    '验证有任何差距则如实标失败，不得改通过标记。通用角色被账本拒绝是授权边界，不能换成无预算调用、重置账本或绕过 SpecArt。'),
    }
    for key in ['prd', 'change', 'specart', 'coding', 'prd-check-fix', 'prd-fix', 'code-fix']:
        if key not in config['skills']:
            continue
        for field in ['prompt_template', 'prompt_retry_template']:
            if field in config['skills'][key]:
                text = config['skills'][key][field].replace('你是资深鸿蒙(ArkTS)开发。', '目标为 Go CLI。')
                note = stage_notes.get(key, '系统设计增量刷新使用 generate-go-cli-system-design，保留原有 PRD diff 与验证流程。')
                config['skills'][key][field] = text + language_note + note
    # Retain upstream loops, with shared admission enforcing the true repair
    # count. PRD's last check can still request a fix: the guard refuses it.
    config['skills']['coding']['max_compile_rounds'] = 1 + policy['stage_repair_limits']['coding']
    config['skills']['prd-check-fix']['max_rounds'] = 1 + policy['stage_repair_limits']['prd']
    if 'prd-fix' in config['skills']:
        config['skills']['prd-fix']['max_compile_rounds'] = 1 + policy['stage_repair_limits']['prd']
    for key in ['prd', 'sd', 'change', 'prd-check-fix', 'prd-fix']:
        for field in ['prompt_template', 'prompt_retry_template']:
            if field in config['skills'].get(key, {}):
                marker = f'[SDD_ROLE:{key}]'
                if marker not in config['skills'][key][field]:
                    config['skills'][key][field] += '\n' + marker
    for skill in config['skills'].values():
        for field in ['prompt_template', 'prompt_retry_template']:
            if field in skill:
                skill[field] += '\n执行授权及阶段边界：先读取 ADAPTER-CONTEXT.md；委派时要求每个角色同样读取。'
                skill[field] += ('\n运行预算由宿主强制执行：coding 最多修复 '
                    f"{policy['stage_repair_limits']['coding']} 次，PRD 最多修复 {policy['stage_repair_limits']['prd']} 次，"
                    '编译修复也计入；每次修复后必须独立复验。预算拒绝时停止并如实报告，不改通过标记，不自行绕过角色派发。')
    return config


def baseline_files(baseline):
    files = {}
    for path in baseline.rglob('*'):
        relative = path.relative_to(baseline)
        if any(part in EXCLUDED for part in relative.parts):
            continue
        if path.is_symlink() or getattr(path, 'is_junction', lambda: False)():
            raise ValueError(f'baseline link requires explicit materialization: {relative}')
        if path.is_file():
            files[relative.as_posix()] = digest(path)
    return files


def prepare(sdd_root, baseline, requirement, runs_dir, prd_id, build_command):
    sdd_root, baseline, requirement, runs_dir = [Path(p).resolve() for p in (sdd_root, baseline, requirement, runs_dir)]
    if not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9_-]{0,95}', prd_id):
        raise ValueError('PRD ID must be a simple new directory name')
    if not baseline.is_dir() or not requirement.is_file() or not build_command.strip():
        raise ValueError('baseline, approved requirement and explicit build command are required')
    run = runs_dir / prd_id
    if run.is_relative_to(baseline) or baseline.is_relative_to(run):
        raise ValueError('baseline and run must not overlap')
    source_config = sdd_root / 'workflow/workflow.json'
    config = workflow(json.loads(source_config.read_text(encoding='utf-8')), build_command)
    files = baseline_files(baseline)
    run.mkdir(parents=True, exist_ok=False)  # Existing IDs are never reset or resumed.
    for destination in [run / 'repos/origin', run / 'repos/main']:
        destination.mkdir(parents=True)
        for relative, expected in files.items():
            source = baseline / relative
            target = destination / relative
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(source, target)
            if digest(target) != expected:
                raise ValueError(f'baseline changed during preparation: {relative}')
    (run / 'output').mkdir()
    approved = run / 'output/01-原始需求.md'
    shutil.copy2(requirement, approved)
    config_path = run / 'workflow-cli.json'
    config_path.write_text(json.dumps(config, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    (run / 'budget-policy.json').write_text(json.dumps(load_policy(), indent=2) + '\n', encoding='utf-8')
    shutil.copy2(ROOT / 'execution-context.md', run / 'ADAPTER-CONTEXT.md')
    # Runtime skills are explicit shared inputs, outside both business code copies.
    shutil.copytree(sdd_root / '.agents/skills', run / '.agents/skills',
                    ignore=shutil.ignore_patterns('node_modules', '__pycache__'))
    extension = ROOT / 'skills/generate-go-cli-system-design'
    shutil.copytree(extension, run / '.agents/skills/generate-go-cli-system-design')
    # Reuse the upstream algorithm/templates, changing only domain discovery rules.
    original = (sdd_root / '.agents/skills/generate-harmonyos-system-design/SKILL.md').read_text(encoding='utf-8')
    go_skill = original.replace('generate-harmonyos-system-design', 'generate-go-cli-system-design')
    go_skill = go_skill.replace('HarmonyOS 或 OpenHarmony', 'Go CLI').replace('HarmonyOS/OpenHarmony', 'Go CLI').replace('鸿蒙', 'Go CLI')
    go_skill = go_skill.replace('references/harmonyos-code-analysis.md', 'references/go-cli-code-analysis.md')
    go_skill = go_skill.replace('references/document-generation-rules.md', '../generate-harmonyos-system-design/references/document-generation-rules.md')
    go_skill = go_skill.replace('assets/system-design-template/', '../generate-harmonyos-system-design/assets/system-design-template/')
    go_skill = go_skill.replace('`system-design-template.md`', '`../generate-harmonyos-system-design/system-design-template.md`')
    go_skill = go_skill.replace('检查 `build-profile.json5`、`AppScope/app.json5`、`module.json5`、ArkTS/ETS 源码或 Hvigor 配置等 Go CLI 工程证据。',
                              '检查 Go 源码、go.mod、构建入口和 CLI 入口。空基线如实记录尚无实现。')
    go_skill = go_skill.replace('工程模块、应用/模块类型、Ability、ExtensionAbility、页面和导航入口',
                               'Go module、package、命令与子命令、参数、标准输入输出及退出码')
    go_skill = go_skill.replace('表/集合/Preferences', '表、集合或配置文件')
    go_skill = go_skill.replace('第三方 SDK、系统 Kit、设备能力', '第三方包、操作系统接口、进程与文件交互')
    go_skill = go_skill.replace('entry/src/main/ets/entryability/EntryAbility.ets#onCreate', 'cmd/app/main.go#main')
    # The source wording may change. The appended profile explicitly replaces domain discovery only.
    go_skill += '\n\n## Go CLI 域适配\n\n代码发现以 references/go-cli-code-analysis.md 为准，替代上述鸿蒙工程、Ability、页面、Kit 等领域对象。模板、编号、生成顺序和完成校验保持原规则。\n'
    (run / '.agents/skills/generate-go-cli-system-design/SKILL.md').write_text(go_skill, encoding='utf-8')
    metadata = {'status': 'prepared_not_started', 'prd_id': prd_id, 'baseline_files': files,
                'excluded_execution_metadata': sorted(EXCLUDED), 'requirement_sha256': digest(approved),
                'workflow_sha256': digest(config_path), 'upstream_workflow_sha256': digest(source_config),
                'budget_policy_sha256': digest(run / 'budget-policy.json'),
                'paths': {'baseline': 'repos/origin', 'project': 'repos/main', 'spec': config['nodes']['6']['path']},
                'flags': {'paths': 'main', 'force': False}, 'run_authorized': False}
    (run / 'preparation.json').write_text(json.dumps(metadata, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    return metadata


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ['sdd-root', 'baseline', 'requirement', 'runs-dir', 'prd-id', 'build-command']:
        parser.add_argument('--' + name, required=True)
    options = vars(parser.parse_args())
    print(json.dumps(prepare(**options), ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
