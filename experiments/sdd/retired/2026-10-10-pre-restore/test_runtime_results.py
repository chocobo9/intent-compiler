import json
from pathlib import Path
import sys

from budget import Budget, load_policy
from run_r1 import run_phase
from run_results import stage_result, official_result


def test_successful_shell_cannot_replace_prd_gate(tmp_path):
    out = tmp_path / 'output'
    out.mkdir()
    report = out / '08-验证结果.md'
    report.write_text('<!--VERDICT:{"skill":"prd-check","pass":true,"unresolved":2}-->', encoding='utf-8')
    (out / 'result-prdcheck.tsv').write_text('main\tMain\t0\t2\tFAIL\n')
    assert stage_result(tmp_path, 'prd')['status'] != 'pass'
    report.write_text('<!--VERDICT:{"skill":"prd-check","pass":true,"unresolved":0}-->', encoding='utf-8')
    (out / 'result-prdcheck.tsv').write_text('main\tMain\t1\t2\tPASS\n')
    assert stage_result(tmp_path, 'prd')['status'] == 'pass'


def test_build_failure_is_not_functional_test_score(tmp_path):
    log = tmp_path / 'official.log'
    log.write_text('CASE_RESULT case_id=c001 status=fail\n')
    assert official_result(log, 1)['status'] == 'build_failed'
    assert official_result(log, 0)['total'] == 1
    assert official_result(log, 0)['status'] == 'incomplete_results'
    with log.open('a') as output:
        output.write('CASE_SUMMARY total_cases=1 success_count=0 fail_count=1\n')
    assert official_result(log, 0)['status'] == 'evaluated'


def test_official_success_status_is_counted(tmp_path):
    log = tmp_path / 'official.log'
    log.write_text('CASE_RESULT case_id=c001 status=success\n'
                   'CASE_RESULT case_id=c002 status=fail\n'
                   'CASE_SUMMARY total_cases=2 success_count=1 fail_count=1\n')
    assert official_result(log, 0) == {'status': 'evaluated', 'build_exit_code': 0, 'passed': 1, 'total': 2}


def test_timeout_publishes_terminal_progress_and_utf8_log(tmp_path):
    (tmp_path / 'runs/r1').mkdir(parents=True)
    policy = load_policy()
    policy['stage_max_seconds']['coding'] = 1
    b = Budget(tmp_path / 'budget.sqlite', policy)
    b.initialize()
    records = []
    entry = run_phase(tmp_path, 'coding', '测试', [sys.executable, '-c', 'import time; time.sleep(60)'], {}, b, records)
    assert entry['status'] == 'stage_timeout'
    assert entry['cleanup_confirmed']
    assert json.loads((tmp_path / 'progress.json').read_text(encoding='utf-8'))[0]['status'] == 'stage_timeout'
    assert '测试 ended: stage_timeout' in (tmp_path / 'sdd-flow.log').read_text(encoding='utf-8')


def test_unlimited_phase_completes_and_cleans_up(tmp_path):
    (tmp_path / 'runs/r1').mkdir(parents=True)
    b = Budget(tmp_path / 'budget.sqlite', load_policy())
    b.initialize(now=1)
    b.start_stage('coding', now=1)
    entry = run_phase(tmp_path, 'coding', 'unlimited', [sys.executable, '-c', 'print(42)'], {}, b, [])
    assert entry['status'] == 'exited' and entry['exit_code'] == 0
    assert entry['cleanup_confirmed']
    assert 'deadline=none' in (tmp_path / 'sdd-flow.log').read_text()


def test_runner_keeps_prd_and_rejects_failed_final_gate(tmp_path, monkeypatch):
    import run_r1 as runner
    from run_results import source_hash
    run = tmp_path / 'runs/r1'
    project = run / 'repos/main'
    project.mkdir(parents=True)
    (project / 'main.go').write_text('package main\nfunc main(){}')
    (run / 'output/06-Spec骨架/.specart').mkdir(parents=True)
    (tmp_path / 'environment.json').write_text('{}')
    (tmp_path / 'provenance.json').write_text('{"runtime_files":{}}')
    (tmp_path / 'budget-policy.json').write_text(json.dumps(load_policy()))
    monkeypatch.setattr(runner, 'execution_env', lambda settings: {})
    monkeypatch.setattr(runner, 'stage_configs', lambda _: {s: Path(s) for s in ['design', 'coding', 'prd']})
    monkeypatch.setattr(runner, 'stage_result', lambda *args: {'status': 'pass'})
    monkeypatch.setattr(runner.subprocess, 'run', lambda *a, **k: type('Stopped', (), {'returncode': 0, 'stderr': b''})())
    monkeypatch.setattr(runner, 'validate_specart', lambda *a: {'exit_code': 0, 'output': ''})
    calls = []
    def phase(root, stage, label, args, env, budget, records):
        calls.append(label)
        if stage == 'prd':
            digest = source_hash(project)
            (root / 'prd-check-source.json').write_text(json.dumps({'before': digest, 'after': digest, 'exit_code': 0}))
        if stage == 'official':
            (root / 'official-verifier/build-exit-code.txt').write_text('0')
            (root / 'official-verifier.log').write_text('CASE_RESULT case_id=c001 status=pass\n')
        entry = {'phase': label, 'status': 'exited', 'cleanup_confirmed': True,
                 'exit_code': 1 if label == 'final-report-check' else 0}
        records.append(entry)
        return entry
    monkeypatch.setattr(runner, 'run_phase', phase)
    runner.execute(tmp_path)
    result = json.loads((tmp_path / 'completion.json').read_text(encoding='utf-8'))
    assert calls == ['sdd-design', 'sdd-coding', 'sdd-prd', 'final-verification', 'final-report-check', 'official-verifier']
    assert result['sdd_status'] == 'not_passed'
    assert result['results']['prd']['status'] == 'pass'
    assert result['results']['official']['passed'] == 1
    import pytest
    with pytest.raises(FileExistsError):
        runner.execute(tmp_path)
