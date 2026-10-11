import json
from pathlib import Path
import subprocess
import sys

import pytest

from budget import Budget, BudgetExceeded, load_policy
from run_results import stage_result
import run_r1 as runner


def design_states(run, specart_verdict=None, exit_warning=False):
    logs = run / 'logs'
    logs.mkdir(parents=True)
    for name in ['prd', 'sd', 'change', 'specart']:
        (logs / f'{name}.state.json').write_text('{"status": "passed"}')
    if exit_warning:
        (logs / 'specart.log').write_text('[08:27:08] WARN: specart 退出码非 0（继续，由产物断言判定）\n', encoding='utf-8')
    output = run / 'output/06-Spec骨架'
    output.mkdir(parents=True)
    if specart_verdict is not None:
        (output / 'verdict.md').write_text(specart_verdict, encoding='utf-8')


def test_upstream_passed_state_without_specart_verdict_is_not_design_pass(tmp_path):
    # Upstream marks specart "passed" when only the artifact directory exists.
    design_states(tmp_path, exit_warning=True)
    result = stage_result(tmp_path, 'design')
    assert result['status'] == 'specart_verdict_missing'
    assert result['specart_process_exit_nonzero'] is True


def test_failed_specart_verdict_is_not_design_pass(tmp_path):
    design_states(tmp_path, '<!--VERDICT:{"skill":"specart","pass":false}-->')
    assert stage_result(tmp_path, 'design')['status'] == 'specart_verdict_fail'


def test_specart_pass_verdict_keeps_design_pass(tmp_path):
    design_states(tmp_path, '<!--VERDICT:{"skill":"specart","pass":true}-->')
    result = stage_result(tmp_path, 'design')
    assert result['status'] == 'pass' and 'specart_process_exit_nonzero' not in result


def runner_root(tmp_path, monkeypatch):
    run = tmp_path / 'runs/r1'
    (run / 'repos/main').mkdir(parents=True)
    (run / 'repos/main/main.go').write_text('package main\nfunc main(){}')
    (run / 'output/06-Spec骨架/.specart').mkdir(parents=True)
    (tmp_path / 'environment.json').write_text('{}')
    (tmp_path / 'provenance.json').write_text('{"runtime_files":{}}')
    (tmp_path / 'budget-policy.json').write_text(json.dumps(load_policy()))
    monkeypatch.setattr(runner, 'execution_env', lambda settings: {})
    monkeypatch.setattr(runner, 'stage_configs', lambda _: {s: Path(s) for s in ['design', 'coding', 'prd']})
    monkeypatch.setattr(runner, 'stage_result', lambda *args: {'status': 'pass'})
    monkeypatch.setattr(runner.subprocess, 'run', lambda *a, **k: type('Stopped', (), {'returncode': 0, 'stderr': b''})())
    calls = []
    def phase(root, stage, label, args, env, budget, records):
        calls.append(label)
        if stage == 'prd':
            from run_results import source_hash
            digest = source_hash(run / 'repos/main')
            (root / 'prd-check-source.json').write_text(json.dumps({'before': digest, 'after': digest, 'exit_code': 0}))
        if stage == 'official':
            (root / 'official-verifier/build-exit-code.txt').write_text('0')
            (root / 'official-verifier.log').write_text('CASE_RESULT case_id=c001 status=pass\n')
        entry = {'phase': label, 'status': 'exited', 'cleanup_confirmed': True, 'exit_code': 0}
        records.append(entry)
        return entry
    monkeypatch.setattr(runner, 'run_phase', phase)
    return calls


def test_design_without_accepted_record_stops_before_coding(tmp_path, monkeypatch):
    calls = runner_root(tmp_path, monkeypatch)
    seen = []
    def gate(run, env, command, *args):
        seen.append(command)
        return {'exit_code': 1, 'output': '[SA185] design record missing: accepted.json'}
    monkeypatch.setattr(runner, 'validate_specart', gate)
    runner.execute(tmp_path)
    result = json.loads((tmp_path / 'completion.json').read_text(encoding='utf-8'))
    assert seen == ['start-implementation']
    assert result['results']['design']['status'] == 'specart_design_not_accepted'
    assert 'SA185' in result['results']['design']['implementation_entry']['output']
    assert calls == ['sdd-design', 'official-verifier']
    assert result['sdd_status'] == 'not_passed'


def test_fresh_last_verification_is_reused_without_new_verifier(tmp_path, monkeypatch):
    calls = runner_root(tmp_path, monkeypatch)
    monkeypatch.setattr(runner, 'validate_specart', lambda *a: {'exit_code': 0, 'output': ''})
    reused = {'report': 'r.md', 'obligations': 'o.json', 'proof_results': 'p.json',
              'set_aside_derived': ['.verdict.md'], 'output': 'SpecArt validation passed'}
    monkeypatch.setattr(runner, 'reusable_verification', lambda run, env, spec: (reused, []))
    runner.execute(tmp_path)
    result = json.loads((tmp_path / 'completion.json').read_text(encoding='utf-8'))
    assert calls == ['sdd-design', 'sdd-coding', 'sdd-prd', 'official-verifier']
    assert result['results']['final']['status'] == 'pass'
    assert result['results']['final']['mode'] == 'reused_fresh_verification'
    assert result['sdd_status'] == 'pass'


def test_stale_verification_still_runs_fresh_verifier(tmp_path, monkeypatch):
    calls = runner_root(tmp_path, monkeypatch)
    monkeypatch.setattr(runner, 'validate_specart', lambda *a: {'exit_code': 0, 'output': ''})
    attempts = [{'report': 'r.md', 'set_aside': [], 'exit_code': 1}]
    monkeypatch.setattr(runner, 'reusable_verification', lambda run, env, spec: (None, attempts))
    runner.execute(tmp_path)
    result = json.loads((tmp_path / 'completion.json').read_text(encoding='utf-8'))
    assert calls == ['sdd-design', 'sdd-coding', 'sdd-prd', 'final-verification', 'final-report-check', 'official-verifier']
    assert result['results']['final']['mode'] == 'fresh_verification'
    assert result['results']['final']['reuse_attempts'] == attempts


def test_derived_outputs_come_from_build_command():
    assert runner.derived_outputs('docker run x -lc "go build -o dpipe ./... && go test ./..."') == [
        '.coding-done', '.verdict.md', 'dpipe', 'dpipe.exe']
    assert runner.derived_outputs('make all') == ['.coding-done', '.verdict.md']


def verification_tree(run):
    project = run / 'repos/main'
    verify = project / '.specart-verify/independent'
    verify.mkdir(parents=True)
    for name in ['report.md', 'obligations.json', 'proof-results.json']:
        (verify / name).write_text(name)
    (project / 'main.go').write_text('package main')
    (project / '.verdict.md').write_text('verdict written after verification')
    (project / '.coding-done').write_text('')
    (project / 'dpipe').write_bytes(b'binary present while verifying')
    (project / 'dpipe.exe').write_bytes(b'binary built after verification')
    return project


def test_reuse_sets_aside_only_derived_files_and_restores_them(tmp_path, monkeypatch):
    project = verification_tree(tmp_path)
    before = {p.name: p.read_bytes() for p in project.iterdir() if p.is_file()}
    # Stands in for SpecArt's hash: it matches only the tree as it was when verified.
    verified = {'main.go', 'dpipe'}
    def gate(run, env, command, *args):
        current = {p.name for p in (run / 'repos/main').iterdir() if p.is_file()}
        fresh = current == verified
        return {'exit_code': 0 if fresh else 1, 'output': '' if fresh else '[SA247] 项目输入已变化'}
    monkeypatch.setattr(runner, 'validate_specart', gate)
    reused, attempts = runner.reusable_verification(tmp_path, {}, tmp_path / 'spec')
    assert reused['set_aside_derived'] == ['.coding-done', '.verdict.md', 'dpipe.exe']
    assert reused['report'].endswith('report.md')
    assert {p.name: p.read_bytes() for p in project.iterdir() if p.is_file()} == before
    assert not [p for p in tmp_path.iterdir() if p.name.startswith('sdd-derived-')]
    assert len(attempts) >= 2


def test_source_change_after_verification_is_never_reused(tmp_path, monkeypatch):
    project = verification_tree(tmp_path)
    def gate(run, env, command, *args):
        return {'exit_code': 1, 'output': '[SA247] 项目输入已变化'}  # main.go changed
    monkeypatch.setattr(runner, 'validate_specart', gate)
    reused, attempts = runner.reusable_verification(tmp_path, {}, tmp_path / 'spec')
    assert reused is None and len(attempts) == 16
    assert (project / '.verdict.md').is_file() and (project / 'dpipe.exe').is_file()


def test_non_freshness_failure_is_not_retried_with_derived_files(tmp_path, monkeypatch):
    verification_tree(tmp_path)
    monkeypatch.setattr(runner, 'validate_specart',
                        lambda *a: {'exit_code': 1, 'output': '[SA230] 总体结论不是 PASS'})
    reused, attempts = runner.reusable_verification(tmp_path, {}, tmp_path / 'spec')
    assert reused is None and len(attempts) == 1


def test_unknown_delegation_role_is_refused_without_stopping_stage(tmp_path):
    policy = load_policy()
    policy_file = tmp_path / 'policy.json'
    policy_file.write_text(json.dumps(policy))
    ledger = tmp_path / 'budget.sqlite'
    b = Budget(ledger, policy)
    b.initialize(); b.start_stage('prd'); b.admit_external('prd', 'fix', 'prd-fix')
    request = json.dumps({'tool': 'task', 'call': 's:general', 'role': 'general', 'external': 'fix'})
    denied = subprocess.run([sys.executable, str(Path(runner.__file__).with_name('budget.py')),
                             str(ledger), str(policy_file), 'prd', request], capture_output=True, text=True)
    assert denied.returncode != 0 and 'unknown_delegation_role:general' in denied.stderr
    state = b.snapshot()
    assert state['stop_reason'] is None and 'task:s:general' not in state['admitted']
    b.check('prd')  # The stage continues; later tools are admitted normally.
    b.admit_task('prd', 's:verify', 'specart-verify', 'fix')


def test_background_delegation_still_stops_stage(tmp_path):
    policy = load_policy()
    policy_file = tmp_path / 'policy.json'
    policy_file.write_text(json.dumps(policy))
    ledger = tmp_path / 'budget.sqlite'
    b = Budget(ledger, policy)
    b.initialize(); b.start_stage('coding'); b.admit_external('coding', 'initial')
    request = json.dumps({'tool': 'task', 'call': 's:bg', 'role': 'specart-verify', 'external': 'initial', 'background': True})
    subprocess.run([sys.executable, str(Path(runner.__file__).with_name('budget.py')),
                    str(ledger), str(policy_file), 'coding', request], capture_output=True, text=True)
    assert b.snapshot()['stop_reason'] == 'background_delegation_disabled'
    with pytest.raises(BudgetExceeded):
        b.check('coding')
