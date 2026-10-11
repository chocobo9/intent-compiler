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

ROOT = Path(__file__).resolve().parent
EXCLUDED = {'.git', '.opencode', '.specart', '.specart-verify', '.system-design',
            '.coding-done', '.verdict.md', 'opencode.json', 'opencode.jsonc'}
STAGES = {'prd', 'sd', 'change', 'specart', 'main-coding', 'main-prdcheck'}


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def workflow(base, build_command):
    """Upstream workflow with only the adaptations a Go CLI task needs.

    Everything else (prompts, loop limits, gates, stage order) stays upstream.
    """
    config = json.loads(json.dumps(base))
    config['nodes']['3']['path'] = 'repos/origin'
    config['nodes']['7']['path'] = 'repos/main'
    # Go has no HarmonyOS toolchain discovery; the task names its build command.
    config['toolchain'].update(build_command=build_command, dir='', auto_discover=False)
    # Only the complete SDD main path; testgen/testfix are HarmonyOS device testing.
    config['stages'] = [stage for stage in config['stages'] if stage['id'] in STAGES]
    config['skills']['coding']['paths'] = {'main': config['skills']['coding']['paths']['main']}
    config['skills']['sd']['skill'] = 'generate-go-cli-system-design'
    config['skills']['sd']['prompt_template'] = config['skills']['sd']['prompt_template'].replace(
        '::generate-harmonyos-system-design', '::generate-go-cli-system-design')
    # SpecArt binds its design record to specart.yaml project_root. Coding,
    # start-implementation and verification run in node 7, so the skeleton is
    # designed there; designing in origin and copying would leave the accepted
    # record pointing at origin, where bodies are never implemented.
    spec = config['skills']['specart']
    spec['inputs'] = ['2', '7', '4', '5']
    spec['step'] = '2+7+4+5->6'
    spec['prompt_template'] = spec['prompt_template'].replace('${n3_path}', '${n7_path}').replace('语言 arkts', '语言 go')
    # node6 is the artifact parent; the validator consumes its .specart child.
    for key in ['specart', 'coding']:
        if 'prompt_template' in config['skills'].get(key, {}):
            config['skills'][key]['prompt_template'] = re.sub(
                r'规格目录（SPEC）= \$\{n6_path\}/(?!\.specart/)',
                '规格目录（SPEC）= ${n6_path}/.specart/',
                config['skills'][key]['prompt_template'])
    build_note = '\n本任务的构建命令（包布局和入口须与之兼容）：' + build_command
    for key in ['specart', 'coding', 'prd-fix']:
        if 'prompt_template' in config['skills'].get(key, {}):
            config['skills'][key]['prompt_template'] += build_note
    for skill in config['skills'].values():
        for field in ['prompt_template', 'prompt_retry_template']:
            if field in skill:
                skill[field] = skill[field].replace('你是资深鸿蒙(ArkTS)开发。', '目标为 Go CLI。')
                skill[field] += '\n无人值守运行：先读取 ADAPTER-CONTEXT.md；委派时要求每个角色同样读取。'
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
