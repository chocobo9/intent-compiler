import json
from pathlib import Path
import pytest

from prepare import workflow
from run_series import cumulative_requirement, publish, promotion_blockers
from run_r1 import run_directory


def test_cumulative_requirements_only_include_current_and_past(tmp_path):
    for n in range(1, 4):
        step = tmp_path / f'steps/round-{n}'
        step.mkdir(parents=True)
        (step / 'instruction.md').write_text(f'Unique requirement {n}', encoding='utf-8')
    text = cumulative_requirement(tmp_path, 2)
    assert text.index('Unique requirement 1') < text.index('Unique requirement 2')
    assert 'Unique requirement 3' not in text


def test_round_identity_is_not_hardcoded_to_r1(tmp_path):
    (tmp_path / 'round.json').write_text('{"round":15}')
    assert run_directory(tmp_path) == tmp_path / 'runs/r15'


def test_failure_is_retained_in_series_report(tmp_path):
    records = [{'round': 1, 'root': 'r1', 'completion': {'sdd_status': 'not_passed',
        'elapsed_seconds': 42, 'results': {'official': {'status': 'build_failed', 'passed': 0, 'total': 219}}}}]
    publish(tmp_path, records, 'running')
    saved = json.loads((tmp_path / 'series-results.json').read_text())
    assert saved['rounds'] == records
    assert '| 1 | not_passed | blocked | - | build_failed | 0 / 219 |' in (tmp_path / 'series-report.md').read_text()


def test_promotion_requires_all_sdd_gates_but_not_all_official_cases():
    completion = {'sdd_status': 'pass', 'phases': [{'cleanup_confirmed': True}], 'results': {
        'design': {'status': 'pass'}, 'coding': {'status': 'pass'}, 'prd': {'status': 'pass'},
        'official': {'status': 'evaluated', 'passed': 14, 'total': 15}}}
    assert promotion_blockers(completion) == []
    from run_series import promotion_decision
    assert promotion_decision(completion)[0] == 'sdd_pass'
    # A failed gate voids the round instead of stopping the series.
    completion['results']['coding']['status'] = 'process_failed'
    assert promotion_decision(completion) == ('auto_void_round', []), 'no build result: nothing to keep'
    completion['phases'][0]['cleanup_confirmed'] = False
    assert 'process_cleanup' in promotion_blockers(completion)


def human_decision_completion():
    return {'sdd_status': 'not_passed', 'phases': [
                {'phase': 'sdd-flow', 'status': 'exited', 'exit_code': 0, 'cleanup_confirmed': True},
                {'phase': 'official-verifier', 'status': 'exited', 'exit_code': 0, 'cleanup_confirmed': True}],
            'results': {'design': {'status': 'pass'}, 'coding': {'status': 'pass'},
                        'prd': {'status': 'fail_or_missing_prd_gate', 'state': 'NEED_MANUAL_DECISION',
                                'verdict': {'skill': 'prd-check', 'pass': True, 'unresolved': 1}},
                        'official': {'status': 'evaluated', 'build_exit_code': 0, 'requested_build_exit_code': 0,
                                     'passed': 217, 'total': 219}}}


def test_human_decision_point_is_answered_by_fixed_rule():
    from run_series import promotion_decision
    completion = human_decision_completion()
    assert promotion_decision(completion) == ('auto_manual_decision', [])
    # Code that does not build is not kept: the round is voided.
    completion['results']['official']['requested_build_exit_code'] = 1
    assert promotion_decision(completion) == ('auto_void_round', [])


@pytest.mark.parametrize('stage,state', [('coding', None), ('design', None), ('prd', 'FAIL')])
def test_a_failed_sdd_gate_keeps_code_that_builds_and_voids_code_that_does_not(stage, state):
    from run_series import promotion_decision
    completion = human_decision_completion()
    if state:
        completion['results']['prd']['state'] = state
    else:
        completion['results'][stage]['status'] = 'fail'
    assert promotion_decision(completion) == ('auto_keep_build_pass', [])
    completion['results']['official']['requested_build_exit_code'] = 1
    assert promotion_decision(completion) == ('auto_void_round', [])


def test_unresolved_gaps_come_from_last_check_round(tmp_path):
    from run_series import unresolved_gaps
    old = tmp_path / 'output/08-验证结果/round-2/验证结果.md'
    old.parent.mkdir(parents=True)
    old.write_text('## 4. 板块差异明细\n#### GAP-009 stale\n', encoding='utf-8')
    # Later rounds append re-check sections to the same report.
    report = tmp_path / 'output/08-验证结果/round-10/验证结果.md'
    report.parent.mkdir(parents=True)
    report.write_text('# 报告\n## 4. 板块差异明细\n#### GAP-001 first\n#### GAP-004 first\n## 8. 第 1 轮 Fix 记录\n'
                      '## 9. 第 2 轮复核\n#### 功能点\n##### GAP-004 F-PIPE-001 顺序执行数据管道（沿用编号）\n'
                      '## 10. 第 2 轮 Fix 记录\n- GAP-004：已修复\n', encoding='utf-8')
    assert unresolved_gaps(tmp_path) == ['GAP-004 F-PIPE-001 顺序执行数据管道（沿用编号）']


def test_shared_context_distinguishes_assumptions_and_implementation():
    text = Path(__file__).with_name('execution-context.md').read_text(encoding='utf-8')
    assert 'operative' in text and 'never contradict an explicit requirement' in text
    assert 'do not leave it open' in text and 'Report a blocker only when no reasonable implementation' in text
    # Unattended authorization only: no reviewer or stage guidance on top of SDD.
    for removed in ['Independent reviewers', 'Stage responsibilities', 'Count limits']:
        assert removed not in text


@pytest.mark.parametrize('design_failed', [False, True])
@pytest.mark.parametrize('round_limit', [3600, None])
@pytest.mark.parametrize('inherited', [False, True])
def test_controller_runs_all_15_in_order_with_own_previous_baseline(tmp_path, monkeypatch, design_failed, round_limit, inherited):
    import run_series as series
    source = tmp_path / 'official'
    for n in range(1, 16):
        step = source / f'steps/round-{n}'
        step.mkdir(parents=True)
        (step / 'instruction.md').write_text(f'input-{n}-end')
    root = tmp_path / 'series'
    root.mkdir()
    (root / 'series.json').write_text(json.dumps({'rounds': 15, 'max_seconds_per_round': round_limit,
        'adapter_files': {}, 'original_instructions': {}}))
    monkeypatch.setattr(series.run_r1, 'OFFICIAL', source)
    monkeypatch.setattr(series.run_r1, 'BASE', root)
    called = []
    def freeze(n, previous, requirement, upstream):
        if n == 1:
            assert previous is None
        elif design_failed:
            # A voided round hands on the code it started from.
            assert previous == root / f'trial-{n-1}/baseline'
        else:
            assert previous == root / f'trial-{n-1}/runs/r{n-1}/repos/main'
        text = requirement.read_text()
        assert f'input-{n}-end' in text
        assert f'input-{n+1}-end' not in text
        trial = root / f'trial-{n}'
        trial.mkdir()
        (trial / 'round.json').write_text(json.dumps({'round': n}))
        (trial / 'completion.json').write_text(json.dumps({'sdd_status': 'not_passed' if design_failed else 'pass',
            'phases': [{'cleanup_confirmed': True}], 'elapsed_seconds': 1,
            'results': {'design': {'status': 'process_failed' if design_failed else 'pass'},
                'coding': {'status': 'not_reached_due_to_gate' if design_failed else 'pass'},
                'prd': {'status': 'not_reached_due_to_gate' if design_failed else 'pass'},
                'final': {'status': 'not_reached_due_to_gate' if design_failed else 'pass'},
                'official': {'status': 'evaluated', 'passed': 1, 'total': 1}}}))
        called.append(n)
        return trial
    class Scope:
        def start(self, *args, **kwargs):
            return self
        def wait(self, timeout):
            assert timeout == (round_limit + 60 if round_limit is not None else None)
            self.returncode = 0
        def close(self):
            return True
    monkeypatch.setattr(series.run_r1, 'freeze', freeze)
    monkeypatch.setattr(series, 'ProcessScope', Scope)
    if inherited:
        requirement = root / 'seed.md'
        requirement.write_text('input-1-end')
        trial = freeze(1, None, requirement, None)
        completion = json.loads((trial / 'completion.json').read_text())
        record = {'round': 1, 'root': str(trial), 'completion': completion,
                  'baseline_sha256': series.source_hash(series.next_baseline(trial, completion)), 'inherited_from': 'previous-series'}
        cfg = json.loads((root / 'series.json').read_text())
        cfg['continuation'] = {'records': [record], 'evidence_sha256': {}}
        (root / 'series.json').write_text(json.dumps(cfg))
        called.clear()
    series.execute_series(root)
    result = json.loads((root / 'series-results.json').read_text())
    assert called == list(range(2 if inherited else 1, 16))
    assert result['completed_rounds'] == 15 and result['status'] == 'completed'
    if design_failed:
        # Every failed round is voided with its stop recorded; the series never blocks on it.
        last = result['rounds'][-1]['promotion']
        assert last['mode'] == 'auto_void_round' and last['failure']['stopped_stage'] == 'prd'


def _continuation_fixture(tmp_path, coding_status='pass'):
    import run_series as series
    parent = tmp_path / 'parent'; parent.mkdir()
    trial = tmp_path / 'trial'; trial.mkdir()
    for rel in ['runs/r1/repos/main', 'official-app', 'official-verifier']:
        (trial / rel).mkdir(parents=True)
    for rel in ['runs/r1/repos/main', 'official-app']:
        (trial / rel / 'main.go').write_text('package main\nfunc main(){}')
    # Minimal upstream records: gates are re-read from them, not from completion.json.
    run = trial / 'runs/r1'
    (run / 'logs').mkdir()
    for stage, status in [('prd', 'passed'), ('sd', 'passed'), ('change', 'passed'), ('specart', 'passed'),
                          ('main-coding', 'passed'), ('main-prdcheck', 'PASS')]:
        (run / 'logs' / f'{stage}.state.json').write_text(json.dumps({'status': status}))
    (run / 'output/06-Spec骨架').mkdir(parents=True)
    (run / 'output/06-Spec骨架/verdict.md').write_text('<!--VERDICT:{"skill":"specart","pass":true}-->', encoding='utf-8')
    (run / 'repos/main/.specart-verify/k').mkdir(parents=True)
    (run / 'repos/main/.specart-verify/k/accepted.json').write_text('{}')
    (run / 'repos/main/.coding-done').write_text('')
    coded = 'true' if coding_status == 'pass' else 'false'
    (run / 'repos/main/.verdict.md').write_text(f'<!--VERDICT:{{"skill":"coding","pass":{coded}}}-->')
    (run / 'output/08-验证结果.md').write_text('<!--VERDICT:{"skill":"prd-check","pass":true,"unresolved":0,"blocked":0}-->', encoding='utf-8')
    (run / 'output/result-prdcheck.tsv').write_text('main\tMain\t1\t1\tPASS\n')
    completion = {'model': series.run_r1.MODEL, 'variant': series.run_r1.VARIANT,
        'sdd_status': 'pass', 'phases': [{'cleanup_confirmed': True}],
        'results': {'design': {'status': 'pass'}, 'coding': {'status': coding_status},
                    'prd': {'status': 'pass'}, 'final': {'status': 'pass'},
                    'official': {'status': 'incomplete_results', 'passed': 0, 'total': 1}}}
    (trial / 'completion.json').write_text(json.dumps(completion))
    (trial / 'official-verifier/build-exit-code.txt').write_text('0')
    (trial / 'official-verifier.log').write_text('CASE_RESULT case_id=c1 status=success\nCASE_RESULT case_id=c2 status=fail\nCASE_SUMMARY total_cases=2 success_count=1 fail_count=1\n')
    (parent / 'series-results.json').write_text(json.dumps({'status': 'runner_blocked',
        'rounds': [{'round': 1, 'root': str(trial), 'completion': completion}]}))
    return series, parent, trial


def test_continue_from_voids_failed_coding_and_hands_on_its_baseline(tmp_path):
    series, parent, trial = _continuation_fixture(tmp_path, coding_status='process_failed')
    result = series.continuation_records(parent)
    record = result['records'][0]
    assert record['promotion']['mode'] == 'auto_void_round'
    assert record['promotion']['failure']['stopped_stage'] == 'coding'
    assert record['baseline_sha256'] == series.source_hash(trial / 'baseline')


def test_continue_from_reparses_eligible_round_without_rewriting_parent(tmp_path):
    series, parent, trial = _continuation_fixture(tmp_path)
    before = (trial / 'completion.json').read_bytes()
    result = series.continuation_records(parent)
    corrected = result['records'][0]['completion']
    assert corrected['results']['official']['status'] == 'evaluated'
    assert corrected['results']['official']['passed'] == 1
    assert corrected['sdd_status'] == 'pass'
    assert (trial / 'completion.json').read_bytes() == before
    (trial / 'runs/r1/repos/main/main.go').write_text('changed')
    with pytest.raises(ValueError, match='differs from evaluated'):
        series.continuation_records(parent)


def test_retry_last_drops_only_a_failed_final_round_and_records_it(tmp_path):
    series, parent, trial = _continuation_fixture(tmp_path)
    state = json.loads((parent / 'series-results.json').read_text())
    # Only a round the rule cannot classify (here: cleanup unconfirmed) still stops a series.
    failed = {'round': 2, 'root': str(tmp_path / 'failed-r2'), 'completion': {'sdd_status': 'not_passed', 'phases': [{'cleanup_confirmed': False}],
              'results': {'design': {'status': 'fail_or_missing_design_gate'}}}}
    state['rounds'].append(failed)
    (parent / 'series-results.json').write_text(json.dumps(state))
    failed_root = tmp_path / 'failed-r2'
    (failed_root / 'official-verifier').mkdir(parents=True)
    (failed_root / 'completion.json').write_text(json.dumps({**failed['completion'], 'model': series.run_r1.MODEL, 'variant': series.run_r1.VARIANT}))
    (failed_root / 'official-verifier/build-exit-code.txt').write_text('0')
    (failed_root / 'official-verifier.log').write_text('CASE_RESULT case_id=c1 status=success\nCASE_SUMMARY total_cases=1 success_count=1 fail_count=0\n')
    with pytest.raises(ValueError, match='not eligible'):
        series.continuation_records(parent)
    result = series.continuation_records(parent, 'change stage could not compare SD table headers')
    assert [r['round'] for r in result['records']] == [1]
    assert result['superseded_attempts'] == [{'round': 2, 'root': failed['root'], 'reason': 'change stage could not compare SD table headers'}]
    state['rounds'].pop()
    # A round the series promoted has an eligible stored record.
    state['rounds'][0]['completion']['results']['official'] = {'status': 'evaluated', 'passed': 1, 'total': 2}
    (parent / 'series-results.json').write_text(json.dumps(state))
    with pytest.raises(ValueError, match='nothing to retry'):
        series.continuation_records(parent, 'no reason')


def test_voided_round_hands_on_the_code_it_started_from(tmp_path):
    from run_series import next_baseline, promotion_decision
    completion = {'sdd_status': 'not_passed', 'phases': [{'phase': 'sdd-flow', 'status': 'exited', 'exit_code': 1, 'cleanup_confirmed': True}],
                  'results': {'design': {'status': 'specart_verdict_fail', 'specart_spec_gap': True}, 'coding': {'status': 'not_reached'},
                              'prd': {'status': 'not_reached'}, 'official': {'status': 'build_failed', 'build_exit_code': 1}}}
    assert promotion_decision(completion) == ('auto_void_round', [])
    assert next_baseline(tmp_path, completion) == tmp_path / 'baseline'
    completion['phases'][0]['cleanup_confirmed'] = False
    assert 'process_cleanup' in promotion_decision(completion)[1]


def test_retry_from_keeps_earlier_rounds_and_records_the_rest(tmp_path):
    series, parent, trial = _continuation_fixture(tmp_path)
    state = json.loads((parent / 'series-results.json').read_text())
    state['rounds'].append({'round': 2, 'root': str(tmp_path / 'later'), 'completion': state['rounds'][0]['completion']})
    (parent / 'series-results.json').write_text(json.dumps(state))
    result = series.continuation_records(parent, retry_from=2, reason='adapter fix')
    assert [r['round'] for r in result['records']] == [1]
    assert result['superseded_attempts'] == [{'round': 2, 'root': str(tmp_path / 'later'), 'reason': 'adapter fix'}]
    with pytest.raises(ValueError, match='reason'):
        series.continuation_records(parent, retry_from=2)
