from __future__ import annotations

import copy
import os
import subprocess
from pathlib import Path

import pytest
import yaml

from conftest import validate_bundle, VALIDATOR_ROOT
from specart.adapters.spec import GoSpecAdapter
from specart.helpers.cangjie import HelperError
from specart.source_model import declarations
from specart.dependencies import extract, changes
from specart.design import Design
from specart.obligations import Obligations, ReportValidator
from specart.proof import Engine


def write(path, text):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding='utf-8')


def make_spec(root, helper, signature='func Echo(value int) (int, bool)', clause='result.item1 == value', existing=False):
    root.mkdir(parents=True, exist_ok=True)
    source, spec = root / 'main.go', root / '.specart'
    if existing:
        write(source, 'package example\n' + signature + ' { return value, true }\n')
    design = Design(spec, root)
    task_id = design.begin('go', ui='none')
    behavior = f'''/* 行为规约:
返回输入及成功标记。
@behavior
@src requirements.md#echo
@changedBy {task_id}
''' + ('@pendingUpdate\n' if existing else '') + f'@ensures {clause}\n*/'
    write(source, 'package example\n' + behavior + '\n' + signature + (' { return value, true }' if existing else '') + '\n')
    manifest = {'version': '2.0', 'language': 'go', 'formal_proof': False,
                'feature_context': {'sources': ['requirements.md'], 'goal': 'echo', 'success_signals': [], 'out_of_scope': []},
                'traceability_and_validation': {key: [] for key in ('pm_to_spec_trace', 'nl_to_intent_trace', 'architecture_to_code_trace', 'spec_to_test_trace')}}
    write(spec / 'specart.yaml', yaml.safe_dump(manifest))
    write(spec / 'summary.yaml', yaml.safe_dump({'task_id': task_id, 'declarations': [
        {'file': 'main.go', 'signature': signature, 'behavior': behavior}]}))
    bundle, validation = validate_bundle(spec, helper)
    return spec, source, design, bundle, validation


def test_real_go_parser_receiver_and_fragments(tmp_path):
    adapter = GoSpecAdapter(str(VALIDATOR_ROOT))
    source = tmp_path / 'model.go'
    write(source, '''package model
type Reader struct { Count int `json:"count"` }
func (r *Reader) Read(value int) (count int, ok bool) { return value, true }
type Source interface { Read(int) (int, bool) }
const ( Zero = iota; One )
''')
    records = list(declarations(adapter.parse_file(str(source), relative_path='model.go')))
    method = next(r for r in records if r.get('receiver'))
    assert method['owner'] == 'Reader'
    assert method['receiver'] == {'name': 'r', 'type': '*Reader'}
    assert method['return_values'] == [{'name': 'count', 'type': 'int'}, {'name': 'ok', 'type': 'bool'}]
    assert method['parameters'] == [{'name': 'value', 'type': 'int'}]
    assert '*Reader' in method['signature']
    fragment = tmp_path / 'fragment.go'
    write(fragment, 'type Reader struct { Count int `json:"count"` }')
    assert adapter.parse_declaration(str(fragment), relative_path='model.go')['declarations'][0]['kind'] == 'struct'
    with pytest.raises(HelperError):
        adapter.parse_file(str(fragment), relative_path='model.go')


@pytest.mark.parametrize('signature,clause,expected', [
    ('func Echo(value int) (int, bool)', 'result.item3 == value', 'SA145'),
    ('func Echo(value int) (int, bool)', 'result.error == value', 'SA145'),
    ('func Echo(value int)', 'result == value', 'SA141'),
    ('func Echo(value int) (int, bool)', 'OLD(result.item1) == value', 'SA144'),
])
def test_invalid_return_references(helper, tmp_path, signature, clause, expected):
    *_, validation = make_spec(tmp_path, helper, signature, clause)
    assert expected in {d.code for d in validation.diagnostics}


@pytest.mark.parametrize('existing', [False, True])
def test_go_design_implementation_fallback_and_freshness(helper, tmp_path, existing):
    spec, source, design, bundle, validation = make_spec(tmp_path, helper, existing=existing)
    assert validation.success, [d.to_text() for d in validation.diagnostics]
    assert not design.accept(bundle)
    text = source.read_text(encoding='utf-8').replace('@pendingUpdate\n', '')
    if not existing:
        text = text.rstrip() + ' { return value, true }\n'
    write(source, text)
    bundle, validation = validate_bundle(spec, helper)
    assert validation.success
    assert not design.check(bundle)
    manifest = Obligations(bundle).manifest()
    proof = Engine(bundle=bundle, manifest=manifest, witness=None, helper=helper, repo_root=str(tmp_path), solver=None).run()
    assert proof['verifier']['adapter'] == 'none/go'
    assert proof['spec_adapter'] == 'go-ast'
    report = Obligations(bundle).report_skeleton(manifest)
    for result in report['results']:
        result.update(conclusion='CAPABILITY_BLOCKED', reasoning='Offline fixture: return values match the clause.',
                      evidence=copy.deepcopy(report['apis'][0]['evidence']))
    report['overall'] = 'PASS'
    def codes(r=report):
        return {d.code for d in ReportValidator(bundle=bundle, obligation_manifest=manifest, proof_results=proof,
                                               report=r, enforce_machine_results=True).run().diagnostics}
    assert not codes()
    forged = copy.deepcopy(report)
    forged['results'][0]['conclusion'] = 'PROVED'
    assert codes(forged)
    write(source, text + '// later change\n')
    assert 'SA247' in codes()
    write(source, text.replace('value int', 'value int64'))
    changed, _ = validate_bundle(spec, helper)
    assert design.check(changed)


def test_design_rejects_body_edits(helper, tmp_path):
    spec, source, design, _, _ = make_spec(tmp_path, helper, existing=True)
    write(source, source.read_text(encoding='utf-8').replace('return value, true', 'return 0, false'))
    bundle, _ = validate_bundle(spec, helper)
    assert 'SA183' in {d.code for d in design.accept(bundle)}


def test_go_import_edges_protect_only_internal_packages(tmp_path):
    write(tmp_path / 'go.mod', 'module example.org/app\n')
    file = {'relative_path': 'pkg/work.go', 'package': 'pkg', 'imports': [{'package': 'example.org/app/data'}, {'package': 'io'}]}
    before = extract(tmp_path, 'go', {'pkg/work.go': file})
    assert {(r['from'], r['to']) for r in before} == {('project/pkg', 'project/data')}
    imports = [{'package': 'example.org/app/data'}, {'package': 'os'}, {'package': 'example.org/app-extra/client'}]
    after = extract(tmp_path, 'go', {'pkg/work.go': {**file, 'imports': imports}})
    assert changes(before, after) == {'added': [], 'removed': []}
    after = extract(tmp_path, 'go', {'pkg/work.go': {**file, 'imports': [{'package': 'example.org/app/other'}]}})
    assert changes(before, after) == {'added': [('project/pkg', 'project/other')],
                                      'removed': [('project/pkg', 'project/data')]}


def test_go_dependency_identity_survives_module_rename(tmp_path):
    write(tmp_path / 'go.mod', 'module example.org/old\n')
    file = {'relative_path': 'main.go', 'package': 'main', 'imports': [{'package': 'example.org/old/data'}]}
    before = extract(tmp_path, 'go', {'main.go': file})
    write(tmp_path / 'go.mod', 'module example.org/new\n')
    file['imports'] = [{'package': 'example.org/new/data'}]
    assert changes(before, extract(tmp_path, 'go', {'main.go': file})) == {'added': [], 'removed': []}


def test_go_nested_module_and_unknown_replacement(tmp_path):
    write(tmp_path / 'go.mod', 'module example.org/app\n')
    write(tmp_path / 'lib/go.mod', 'module example.org/lib\n')
    file = {'relative_path': 'main.go', 'package': 'main', 'imports': [{'package': 'example.org/lib/data'}]}
    assert extract(tmp_path, 'go', {'main.go': file})[0]['to'] == 'project/lib/data'
    write(tmp_path / 'go.mod', 'module example.org/app\nreplace example.org/lib => ./lib\n')
    assert 'unresolved' in extract(tmp_path, 'go', {'main.go': file})[0]


def test_go_implementation_imports_allow_check_and_repair(helper, tmp_path):
    spec, source, design, bundle, validation = make_spec(tmp_path, helper)
    assert validation.success
    assert not design.accept(bundle)
    # Empty design -> ordinary implementation imports + necessary project config.
    write(tmp_path / 'go.mod', 'module example.org/echo\ngo 1.22\n')
    text = source.read_text(encoding='utf-8').replace('package example', 'package example\nimport "fmt"')
    write(source, text.rstrip() + ' { _ = fmt.Sprint(value); return value, true }\n')
    bundle, checked = validate_bundle(spec, helper)
    assert checked.success
    assert not design.check(bundle)
    assert not design.check(bundle, complete=False)  # start-implementation repair gate
    assert Obligations(bundle).manifest()
    built = subprocess.run([os.environ.get('SPECART_GO', 'go'), 'build', './...'], cwd=tmp_path,
                           capture_output=True, text=True, timeout=60)
    assert built.returncode == 0, built.stderr
    # Internal architecture changes must still be rejected by the same gate.
    write(source, source.read_text(encoding='utf-8').replace('import "fmt"', 'import ("fmt"; _ "example.org/echo/data")'))
    bundle, _ = validate_bundle(spec, helper)
    assert 'SA187' in {d.code for d in design.check(bundle, complete=False)}


def test_go_grouped_parameters_survive_implementation_and_repair(helper, tmp_path):
    signature = 'func Echo(a int, b int) (left int, right int)'
    spec, source, design, bundle, validation = make_spec(tmp_path, helper, signature, 'result.item1 == a')
    assert validation.success
    assert not design.accept(bundle)
    accepted = design.accepted.read_bytes()
    body = source.read_text(encoding='utf-8').replace(signature, 'func Echo(a, b int) (left, right int)')
    write(source, body.rstrip() + ' { return a, b }\n')
    # Real lifecycle entry points, using the same helper and adapter as the runner.
    cli = VALIDATOR_ROOT / 'bin/specart-validate'
    for command in ['start-implementation', 'check', 'obligations']:
        args = [os.sys.executable, str(cli), command, str(spec)]
        if command == 'obligations':
            args += ['--output', str(tmp_path / '.specart-verify/obligations.json')]
        result = subprocess.run(args,
                                capture_output=True, text=True, encoding='utf-8', timeout=60)
        assert result.returncode == 0, result.stdout + result.stderr
    write(source, source.read_text(encoding='utf-8').replace('return a, b', 'return a, b + 0'))
    bundle, checked = validate_bundle(spec, helper)
    assert checked.success
    assert not design.check(bundle, complete=False)
    assert design.accepted.read_bytes() == accepted
    # A changed type or a changed behavioral contract must not be normalized away.
    write(source, source.read_text(encoding='utf-8').replace('a, b int', 'a int, b string'))
    _, checked = validate_bundle(spec, helper)
    assert not checked.success
    write(source, (body.rstrip() + ' { return a, b }\n').replace('返回输入及成功标记。', '返回不同结果。'))
    _, checked = validate_bundle(spec, helper)
    assert 'SA180' in {d.code for d in checked.diagnostics}


def test_go_grouped_signature_preserves_receiver_generics_and_variadic(tmp_path):
    adapter = GoSpecAdapter(str(VALIDATOR_ROOT))
    source = tmp_path / 'types.go'
    write(source, 'package p\ntype Box[T any] struct{}\n'
                  'func (b *Box[T]) Mix(a, c int, rest ...T) (x, y T) { panic("stub") }\n')
    grouped = list(declarations(adapter.parse_file(str(source), relative_path='types.go')))[1]
    write(source, source.read_text().replace('a, c int', 'a int, c int').replace('x, y T', 'x T, y T'))
    expanded = list(declarations(adapter.parse_file(str(source), relative_path='types.go')))[1]
    assert grouped['signature'] == expanded['signature']
    assert '(b *Box[T])' in grouped['signature']
    assert '...T' in grouped['signature']


@pytest.mark.parametrize('member,expected', [('Left', None), ('Right', None), ('Missing', 'SA145')])
def test_cross_file_return_members(helper, tmp_path, member, expected):
    spec, _, _, _, _ = make_spec(tmp_path, helper, 'func Echo(value int) (*Pair, bool)',
                                f'result.item1.{member} == value')
    write(tmp_path / 'types.go', 'package example\ntype Pair struct { Left, Right int }\n')
    include_pair(spec)
    _, validation = validate_bundle(spec, helper)
    codes = {d.code for d in validation.diagnostics}
    if expected:
        assert expected in codes
    else:
        assert 'SA145' not in codes


def test_receiver_member_validation(helper, tmp_path):
    spec, source, _, _, _ = make_spec(tmp_path, helper, 'func (r *Pair) Echo(value int) int', 'result == r.Left')
    write(tmp_path / 'types.go', 'package example\ntype Pair struct { Left, Right int }\n')
    include_pair(spec, owner='Pair')
    _, validation = validate_bundle(spec, helper)
    assert 'SA142' not in {d.code for d in validation.diagnostics}
    write(source, source.read_text(encoding='utf-8').replace('r.Left', 'r.Missing'))
    _, validation = validate_bundle(spec, helper)
    assert 'SA142' in {d.code for d in validation.diagnostics}


def include_pair(spec, owner=None):
    path = spec / 'summary.yaml'
    summary = yaml.safe_load(path.read_text(encoding='utf-8'))
    if owner:
        summary['declarations'][0]['owner'] = owner
    summary['declarations'].append({'file': 'types.go', 'signature': 'type Pair struct { Left, Right int }'})
    write(path, yaml.safe_dump(summary))
