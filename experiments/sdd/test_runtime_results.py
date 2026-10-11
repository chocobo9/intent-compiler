import json
from pathlib import Path
import sys

from run_r1 import run_phase
from run_results import stage_result, official_result


def write_state(run, stage_id, status):
    (run / 'logs').mkdir(parents=True, exist_ok=True)
    (run / 'logs' / f'{stage_id}.state.json').write_text(json.dumps({'status': status}))


def test_successful_shell_cannot_replace_prd_gate(tmp_path):
    out = tmp_path / 'output'
    out.mkdir()
    report = out / '08-验证结果.md'
    report.write_text('<!--VERDICT:{"skill":"prd-check","pass":true,"unresolved":2}-->', encoding='utf-8')
    (out / 'result-prdcheck.tsv').write_text('main\tMain\t0\t2\tFAIL\n')
    assert stage_result(tmp_path, 'prd')['status'] == 'not_reached'
    write_state(tmp_path, 'main-prdcheck', 'FAIL')
    assert stage_result(tmp_path, 'prd')['status'] != 'pass'
    report.write_text('<!--VERDICT:{"skill":"prd-check","pass":true,"unresolved":0}-->', encoding='utf-8')
    (out / 'result-prdcheck.tsv').write_text('main\tMain\t1\t2\tPASS\n')
    write_state(tmp_path, 'main-prdcheck', 'PASS')
    assert stage_result(tmp_path, 'prd')['status'] == 'pass'


def test_coding_requires_upstream_done_mark_and_verdict(tmp_path):
    assert stage_result(tmp_path, 'coding')['status'] == 'not_reached'
    project = tmp_path / 'repos/main'
    project.mkdir(parents=True)
    write_state(tmp_path, 'main-coding', 'passed')
    (project / '.verdict.md').write_text('<!--VERDICT:{"skill":"coding","pass":true}-->')
    assert stage_result(tmp_path, 'coding')['status'] == 'missing_coding_gate'
    (project / '.coding-done').write_text('')
    assert stage_result(tmp_path, 'coding')['status'] == 'pass'
    # PRD fix overwrites the verdict; coding's original is kept in main.bak.
    backup = tmp_path / 'repos/main.bak'
    backup.mkdir()
    (backup / '.verdict.md').write_text((project / '.verdict.md').read_text())
    (project / '.verdict.md').write_text('<!--VERDICT:{"skill":"prd-fix","pass":true,"fixed":1,"blocked":0}-->')
    assert stage_result(tmp_path, 'coding')['status'] == 'pass'


def design_run(run, specart_verdict=None, accepted=False, exit_warning=False):
    for name in ['prd', 'sd', 'change', 'specart']:
        write_state(run, name, 'passed')
    if exit_warning:
        (run / 'logs/specart.log').write_text('[08:27:08] WARN: specart 退出码非 0（继续，由产物断言判定）\n', encoding='utf-8')
    (run / 'output/06-Spec骨架').mkdir(parents=True)
    if specart_verdict is not None:
        (run / 'output/06-Spec骨架/verdict.md').write_text(specart_verdict, encoding='utf-8')
    if accepted:
        record = run / 'repos/main/.specart-verify/1238d7f137712261/accepted.json'
        record.parent.mkdir(parents=True)
        record.write_text('{}')


def test_upstream_artifact_fallback_is_not_reported_as_accepted_design(tmp_path):
    # Upstream marks specart "passed" when only the artifact directory exists.
    design_run(tmp_path, exit_warning=True)
    result = stage_result(tmp_path, 'design')
    assert result['states']['specart'] == 'passed'
    assert result['status'] == 'specart_verdict_missing'
    assert result['specart_process_exit_nonzero'] is True


def test_design_pass_requires_specart_verdict_and_accepted_record(tmp_path):
    design_run(tmp_path, '<!--VERDICT:{"skill":"specart","pass":true}-->')
    assert stage_result(tmp_path, 'design')['status'] == 'specart_design_not_accepted'
    other = tmp_path / 'other'
    design_run(other, '<!--VERDICT:{"skill":"specart","pass":false}-->', accepted=True)
    assert stage_result(other, 'design')['status'] == 'specart_verdict_fail'
    passed = tmp_path / 'passed'
    design_run(passed, '<!--VERDICT:{"skill":"specart","pass":true}-->', accepted=True)
    result = stage_result(passed, 'design')
    assert result['status'] == 'pass'
    assert result['accepted_design_records'] == ['repos/main/.specart-verify/1238d7f137712261/accepted.json']


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


def test_phase_completes_cleans_up_and_logs_utf8(tmp_path):
    (tmp_path / 'runs/r1').mkdir(parents=True)
    records = []
    entry = run_phase(tmp_path, '测试', [sys.executable, '-c', 'print(42)'], {}, records)
    assert entry['status'] == 'exited' and entry['exit_code'] == 0 and entry['cleanup_confirmed']
    assert json.loads((tmp_path / 'progress.json').read_text(encoding='utf-8'))[0]['status'] == 'exited'
    assert '测试 ended: exited' in (tmp_path / 'sdd-flow.log').read_text(encoding='utf-8')


def runner_root(tmp_path, monkeypatch, flow_exit=0):
    import run_r1 as runner
    run = tmp_path / 'runs/r1'
    (run / 'repos/main').mkdir(parents=True)
    (run / 'repos/main/main.go').write_text('package main\nfunc main(){}')
    (tmp_path / 'environment.json').write_text('{}')
    (tmp_path / 'provenance.json').write_text('{"runtime_files":{}}')
    monkeypatch.setattr(runner, 'execution_env', lambda settings: {})
    monkeypatch.setattr(runner, 'stage_result', lambda run, stage: {'status': 'pass'})
    monkeypatch.setattr(runner.subprocess, 'run', lambda *a, **k: type('Stopped', (), {'returncode': 0, 'stderr': b''})())
    calls = []
    def phase(root, label, args, env, records):
        calls.append((label, args))
        if label == 'official-verifier':
            (root / 'official-verifier/build-exit-code.txt').write_text('0')
            (root / 'official-verifier.log').write_text('CASE_RESULT case_id=c001 status=pass\n')
        entry = {'phase': label, 'status': 'exited', 'cleanup_confirmed': True,
                 'exit_code': flow_exit if label == 'sdd-flow' else 0}
        records.append(entry)
        return entry
    monkeypatch.setattr(runner, 'run_phase', phase)
    return runner, calls


def test_runner_invokes_upstream_flow_once_then_official_tests(tmp_path, monkeypatch):
    runner, calls = runner_root(tmp_path, monkeypatch)
    runner.execute(tmp_path)
    result = json.loads((tmp_path / 'completion.json').read_text(encoding='utf-8'))
    assert [label for label, _ in calls] == ['sdd-flow', 'official-verifier']
    flow_args = calls[0][1]
    assert flow_args[1].endswith('runtime/workflow/speclang-flow.sh')
    assert flow_args[-6:] == ['--prdid', 'r1', '--paths', 'main', '--jobs', '1']
    assert result['sdd_status'] == 'pass'
    assert set(result['results']) >= {'design', 'coding', 'prd', 'official'}
    assert 'final' not in result['results'] and 'budget' not in result
    assert result['results']['official']['passed'] == 1
    import pytest
    with pytest.raises(FileExistsError):
        runner.execute(tmp_path)


def test_failed_upstream_flow_is_not_a_pass_even_with_passing_records(tmp_path, monkeypatch):
    runner, _ = runner_root(tmp_path, monkeypatch, flow_exit=1)
    runner.execute(tmp_path)
    result = json.loads((tmp_path / 'completion.json').read_text(encoding='utf-8'))
    assert result['sdd_status'] == 'not_passed'
    assert result['results']['official']['passed'] == 1


def test_resume_only_after_failed_flow_and_archives_previous_attempt(tmp_path, monkeypatch):
    import pytest
    import run_r1 as runner
    run = tmp_path / 'runs/r1'
    (run / 'repos/main.bak').mkdir(parents=True)
    (tmp_path / 'bin').mkdir()
    (tmp_path / 'provenance.json').write_text('{"runtime_files":{}}')
    (tmp_path / 'environment.json').write_text('{}')
    (tmp_path / 'official-app').mkdir()
    completion = {'phases': [{'phase': 'sdd-flow', 'status': 'exited', 'exit_code': 0, 'cleanup_confirmed': True}],
                  'results': {'prd': {'status': 'not_reached'}}}
    (tmp_path / 'completion.json').write_text(json.dumps(completion))
    calls = []
    monkeypatch.setattr(runner, 'execution_env', lambda settings: settings)
    monkeypatch.setattr(runner, 'develop_and_evaluate', lambda root, env, label, extra: calls.append((label, env, extra)))
    with pytest.raises(ValueError, match='failed upstream flow'):
        runner.resume(tmp_path, 'test')
    completion['phases'][0]['exit_code'] = 1
    (tmp_path / 'completion.json').write_text(json.dumps(completion))
    runner.resume(tmp_path, 'cp collision')
    assert [c[0] for c in calls] == ['sdd-flow-resume']
    assert calls[0][1]['BASH_ENV'].endswith('bin/posix_cp.sh') and (tmp_path / 'bin/posix_cp.sh').is_file()
    assert (tmp_path / 'attempt-1/completion.json').is_file() and (tmp_path / 'attempt-1/official-app').is_dir()
    assert (tmp_path / 'attempt-1/main.bak').is_dir() and not (run / 'repos/main.bak').exists()
    assert json.loads((tmp_path / 'resume.json').read_text(encoding='utf-8'))['reason'] == 'cp collision'
    with pytest.raises(FileExistsError):
        runner.resume(tmp_path, 'again')


def test_spec_gap_and_code_only_are_read_from_reports(tmp_path):
    from run_results import open_prd_gaps
    design_run(tmp_path, '<!--VERDICT:{"skill":"specart","pass":false}-->\nSPEC_GAP: PRD and the target design disagree.')
    assert stage_result(tmp_path, 'design')['specart_spec_gap'] is True
    report = tmp_path / 'output/08-验证结果/round-1/验证结果.md'
    report.parent.mkdir(parents=True)
    report.write_text('## 4. 差异\n#### GAP-001 a\n- 差异类型：`MISMATCH`\n#### GAP-003 b\n- 差异类型：`CODE_ONLY`\n', encoding='utf-8')
    assert [g['title'] for g in open_prd_gaps(tmp_path)] == ['GAP-001 a']


def test_official_case_after_output_without_newline_is_counted(tmp_path):
    from run_results import official_result
    log = tmp_path / 'official-verifier.log'
    log.write_text('CASE_RESULT case_id=c1 origin_step=r1 status=success intent="a"\n'
                   'PIPELINE OK: 1 steps completedCASE_RESULT case_id=c2 origin_step=r1 status=success intent="b"\n'
                   'CASE_RESULT case_id=c3 origin_step=r1 status=fail intent="c"\n'
                   'CASE_SUMMARY total_cases=3 success_count=2 fail_count=1\n', encoding='utf-8')
    assert official_result(log, 0) == {'status': 'evaluated', 'build_exit_code': 0, 'passed': 2, 'total': 3}
