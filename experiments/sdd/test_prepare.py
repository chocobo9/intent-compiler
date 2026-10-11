import copy
import json
from pathlib import Path

import pytest

from prepare import prepare, workflow


@pytest.fixture
def inputs(tmp_path):
    sdd, baseline = tmp_path / 'sdd', tmp_path / 'baseline'
    (sdd / 'workflow').mkdir(parents=True)
    base = {'nodes': {str(i): {'path': f'output/{i}'} for i in range(1, 10)},
            'toolchain': {'required_for_code_changes': True},
            'stages': [{'id': name} for name in ['prd', 'sd', 'change', 'specart', 'main-coding', 'main-prdcheck', 'cmp1-coding']],
            'skills': {'coding': {'paths': {'main': {'inputs': ['3', '4', '6']}, 'cmp1': {}}, 'max_compile_rounds': 5},
                       'sd': {'prompt_template': '::generate-harmonyos-system-design ${n3_path}'},
                       'specart': {'prompt_template': '--repo ${n3_path} 语言 arkts'},
                       'prd-check-fix': {'prompt_template': '${n3_path} -> ${n7_path}', 'max_rounds': 5}}}
    (sdd / 'workflow/workflow.json').write_text(json.dumps(base), encoding='utf-8')
    skill = sdd / '.agents/skills/generate-harmonyos-system-design'
    skill.mkdir(parents=True)
    (skill / 'SKILL.md').write_text('generate-harmonyos-system-design\nreferences/harmonyos-code-analysis.md\n'
                                   'references/document-generation-rules.md\nassets/system-design-template/', encoding='utf-8')
    baseline.mkdir()
    (baseline / 'main.go').write_text('package main\nfunc main() {}\n')
    (baseline / '.specart').mkdir()
    (baseline / '.specart/old.json').write_text('{}')
    requirement = tmp_path / 'approved.md'
    requirement.write_text('Only the approved delivery.', encoding='utf-8')
    return dict(sdd_root=sdd, baseline=baseline, requirement=requirement, runs_dir=tmp_path / 'runs',
                prd_id='delivery-1', build_command='go test ./...'), base


def test_prepared_paths_preserve_baseline_and_real_diff(inputs):
    args, base = inputs
    original = copy.deepcopy(base)
    assert workflow(base, 'go test ./...')['skills']['specart']['inputs'] == ['2', '7', '4', '5']
    assert base == original
    result = prepare(**args)
    run = args['runs_dir'] / args['prd_id']
    config = json.loads((run / 'workflow-cli.json').read_text(encoding='utf-8'))
    assert config['nodes']['3']['path'] == 'repos/origin'
    assert config['nodes']['7']['path'] == 'repos/main'
    assert '${n3_path}' not in config['skills']['specart']['prompt_template']
    assert config['skills']['prd-check-fix']['prompt_template'].startswith('${n3_path} -> ${n7_path}')
    # Upstream loop limits are kept unchanged.
    assert config['skills']['prd-check-fix']['max_rounds'] == 5
    assert config['skills']['coding']['max_compile_rounds'] == 5
    assert config['stages'] == [{'id': s} for s in ['prd', 'sd', 'change', 'specart', 'main-coding', 'main-prdcheck']]
    assert not (run / 'repos/main/.specart').exists()
    assert result['status'] == 'prepared_not_started'
    assert result['flags'] == {'paths': 'main', 'force': False}
    origin, main = run / 'repos/origin/main.go', run / 'repos/main/main.go'
    assert origin.read_bytes() == main.read_bytes()
    main.write_text('package main\nfunc main() { println("changed") }\n')
    assert origin.read_bytes() == (args['baseline'] / 'main.go').read_bytes()
    assert main.read_bytes() != origin.read_bytes()
    assert (run / 'output/01-原始需求.md').read_bytes() == args['requirement'].read_bytes()
    with pytest.raises(FileExistsError):
        prepare(**args)
    assert 'changed' in main.read_text()


@pytest.mark.parametrize('prd_id', ['../escape', 'a/b', ''])
def test_rejects_nonlocal_run_id(inputs, prd_id):
    args, _ = inputs
    with pytest.raises(ValueError):
        prepare(**{**args, 'prd_id': prd_id})
    assert not args['runs_dir'].exists()


def test_rejects_baseline_output_overlap(inputs):
    args, _ = inputs
    with pytest.raises(ValueError):
        prepare(**{**args, 'runs_dir': args['baseline']})


def test_spec_directory_is_shared_and_not_double_nested(inputs):
    _, base = inputs
    for key in ['specart', 'coding']:
        base['skills'][key]['prompt_template'] = '规格目录（SPEC）= ${n6_path}/，项目目录=${n7_path}'
    config = workflow(base, 'go build ./...')
    for key in ['specart', 'coding']:
        assert '规格目录（SPEC）= ${n6_path}/.specart/，' in config['skills'][key]['prompt_template']
    repeated = workflow(config, 'go build ./...')
    assert '.specart/.specart' not in json.dumps(repeated)


def test_stage_prompts_keep_upstream_text_and_only_append_environment(inputs):
    _, base = inputs
    for key in ['prd', 'change', 'coding', 'prd-fix']:
        base['skills'].setdefault(key, {})['prompt_template'] = f'Upstream {key} request.'
    config = workflow(base, 'go build ./...')
    for key in ['prd', 'change', 'coding', 'prd-fix']:
        text = config['skills'][key]['prompt_template']
        assert text.startswith(f'Upstream {key} request.' + chr(10))
        assert '无人值守运行：先读取 ADAPTER-CONTEXT.md' in text
    for key in ['coding', 'prd-fix']:
        assert 'go build ./...' in config['skills'][key]['prompt_template']
    for key in ['prd', 'change']:
        assert 'go build' not in config['skills'][key]['prompt_template']


def test_real_workflow_keeps_upstream_gates_and_prompts():
    source = Path('D:/sdd/prdcheck/workflow/workflow.json')
    upstream = json.loads(source.read_text(encoding='utf-8'))
    config = workflow(upstream, 'go build ./...')
    for key, skill in config['skills'].items():
        for field in ['prompt_template', 'prompt_retry_template']:
            if field in skill and key not in {'sd', 'specart'}:
                original = upstream['skills'][key][field].replace('你是资深鸿蒙(ArkTS)开发。', '目标为 Go CLI。')
                original = original.replace('规格目录（SPEC）= ${n6_path}/', '规格目录（SPEC）= ${n6_path}/.specart/')
                assert skill[field].startswith(original), key
        for field in ['max_rounds', 'max_compile_rounds']:
            assert skill.get(field) == upstream['skills'][key].get(field), (key, field)
    assert '不修改 ${n7_path}/ 以外的文件' in config['skills']['coding']['prompt_template']
    assert 'SDD_ROLE' not in json.dumps(config, ensure_ascii=False)
    specart = config['skills']['specart']['prompt_template']
    assert '--repo）= ${n7_path}' in specart and '语言 go' in specart and '${n3_path}' not in specart
    assert 'start-design' in specart and 'accept-design' in specart
