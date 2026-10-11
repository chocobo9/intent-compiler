import json
from types import SimpleNamespace

import specart_go_diagnose as diagnose


def normalize(value):
    return [line.removeprefix("//").strip() for line in value.splitlines() if line.removeprefix("//").strip()]


def test_behavior_sa180_reports_only_normalized_contract_mismatch():
    record = {'source_path': 'main.go', 'short_identity': 'Run', 'identity': 'main.go::Run',
        'behavior': {'raw': '// accepts an input\n// returns an error'},
        'summary_entry': {'behavior': 'accepts an input\nreturns a result'}}
    diagnostic = {'code': 'SA180', 'title': 'summary 规约与源码不一致',
        'location': {'file': 'main.go'}, 'found': 'Run'}
    result = diagnose.classify_sa180(SimpleNamespace(selected=[record]), [diagnostic], normalize)
    assert result['behavior_mismatches'][0]['classification'] == 'behavior_mismatch'
    assert 'returns an error' in result['behavior_mismatches'][0]['normalized_mismatch_records'][0]['raw_diff']


def test_type_member_sa180_is_preserved_as_its_own_subtype():
    diagnostic = {'code': 'SA180', 'title': 'summary 未完整记录类型成员',
        'found': {'declaration': 'main.go::Config', 'missing_members': [{'name': 'Timeout'}]}}
    result = diagnose.classify_sa180(SimpleNamespace(selected=[]), [diagnostic], normalize)
    assert result['type_member_incompleteness'] == [
        {'validator_diagnostic': diagnostic, 'classification': 'type_member_completeness'}]
    assert result['behavior_mismatches'] == []


def test_comment_and_whitespace_only_differences_are_not_behavior_mismatches():
    record = {'source_path': 'main.go', 'short_identity': 'Run', 'identity': 'main.go::Run',
        'behavior': {'raw': '// accepts input\n// returns an error'},
        'summary_entry': {'behavior': '  accepts input  \n\n returns an error '}}
    diagnostic = {'code': 'SA180', 'title': 'summary 规约与源码不一致',
        'location': {'file': 'main.go'}, 'found': 'Run'}
    result = diagnose.classify_sa180(SimpleNamespace(selected=[record]), [diagnostic], normalize)
    item = result['behavior_mismatches'][0]
    assert item['classification'] == 'unmatched_or_normalized_equal'
    assert item['normalized_mismatch_records'] == []


def test_json_diagnostic_exit_with_helper_startup_failure_is_not_reported_as_no_sa180(tmp_path, monkeypatch):
    spec = tmp_path / 'sample.specart'; spec.mkdir()
    project = tmp_path / 'project'; project.mkdir()
    validator = tmp_path / 'validator'; validator.mkdir()
    diagnostic = {'code': 'SA103', 'title': 'Go 声明解析失败',
        'found': '[WinError 4551] 应用程序控制策略已阻止此文件'}
    monkeypatch.setattr(diagnose, '_validator_diagnostics', lambda *_: {
        'execution_status': 'completed', 'exit_code': 1,
        'validator_output': {'valid': False, 'error_count': 1, 'diagnostics': [diagnostic]},
        'stderr': '', 'bundle': SimpleNamespace(selected=[]), 'base_validator_success': False})
    monkeypatch.setattr(diagnose, '_load_validator', lambda *_: (None, normalize))
    result = diagnose.diagnose('r6', spec, project, validator)
    assert result['status'] == 'helper_environment_blocked'
    assert result['validator']['diagnostics'] == [diagnostic]
    assert result['validator']['type_member_sa180_may_be_deferred'] is True
    assert result['sa180']['behavior_mismatches'] == []


def test_malformed_validator_output_is_an_execution_error(tmp_path, monkeypatch):
    spec = tmp_path / 'sample.specart'; spec.mkdir()
    project = tmp_path / 'project'; project.mkdir()
    validator = tmp_path / 'validator'; validator.mkdir()
    monkeypatch.setattr(diagnose, '_validator_diagnostics', lambda *_: {
        'execution_status': 'invalid_validator_output', 'exit_code': 2,
        'stdout': 'not json', 'stderr': 'startup failure'})
    result = diagnose.diagnose('r6', spec, project, validator)
    assert result['status'] == 'invalid_validator_output'
    assert result['validator']['exit_code'] == 2


def test_report_freshness_binds_round_bundle_project_and_validator(tmp_path, monkeypatch):
    bundle = tmp_path / 'spec'; bundle.mkdir(); (bundle / 'summary.yaml').write_text('summary')
    project = tmp_path / 'project'; project.mkdir(); (project / 'main.go').write_text('package main')
    validator = tmp_path / 'validator'; validator.mkdir(); (validator / 'version.txt').write_text('frozen')
    monkeypatch.setattr(diagnose, '_validator_diagnostics', lambda *_: {
        'execution_status': 'completed', 'exit_code': 0,
        'validator_output': {'valid': True, 'error_count': 0, 'diagnostics': []},
        'stderr': '', 'bundle': SimpleNamespace(selected=[]), 'base_validator_success': True})
    monkeypatch.setattr(diagnose, '_load_validator', lambda *_: (None, normalize))
    report = diagnose.diagnose('r4', bundle, project, validator)
    path = tmp_path / 'report.json'
    path.write_text(json.dumps(report))
    fresh = diagnose.verify_report(path, 'r4', bundle, project, validator)
    assert fresh['status'] == 'fresh'
    assert path.with_suffix('.json.verified.json').exists()
    (project / 'main.go').write_text('package changed')
    stale = diagnose.verify_report(path, 'r4', bundle, project, validator)
    assert stale['status'] == 'stale'
    assert 'project_sha256' in stale['mismatched_binding_fields']
