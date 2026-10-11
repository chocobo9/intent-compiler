from run_ic_series import MANAGEMENT_BUDGET, MAX_ATTEMPTS, PASS_FLOOR, attempt_summary, keep_better, publish, round_action, split_resumed, upstream_spec_gap


def completion(passed, total=10):
    ok = passed == total
    gate = {'status': 'pass' if ok else 'fail'}
    return {'sdd_status': 'pass' if ok else 'not_passed', 'elapsed_seconds': 10,
            'phases': [{'phase': 'sdd-flow', 'exit_code': 0, 'cleanup_confirmed': True}],
            'results': {'design': {'status': 'pass'}, 'coding': gate, 'prd': gate,
                        'official': {'status': 'evaluated', 'passed': passed, 'total': total, 'build_exit_code': 0, 'requested_build_exit_code': 0 if ok else 1}}}


def returned(number, passed, attempts=(), **extra):
    mode = 'sdd_pass' if passed == 10 else 'auto_void_round'
    return {'round': number, 'stage': 'returned', 'root': f'trial-{number}-{len(attempts) + 1}', 'execution_id': f'run-{number}-{len(attempts) + 1}',
            'completion': completion(passed), 'attempts': list(attempts),
            'promotion': {'mode': mode, 'rule': f'{mode}: rule', 'failure': None if passed == 10 else {'stopped_stage': 'coding'}}, **extra}


def test_policy_retries_small_slips_once_and_pauses_on_large_failures():
    assert MAX_ATTEMPTS == 2 and PASS_FLOOR == 0.9
    assert round_action('auto_void_round', 0.95, 1) == 'retry'
    assert round_action('auto_void_round', 0.95, 2) == 'promote'
    assert round_action('sdd_pass', 1.0, 1) == 'promote'
    assert round_action('auto_void_round', 0.5, 1) == 'pause'
    assert round_action('sdd_pass', 0.5, 1) == 'pause', 'a large loss pauses even when SDD passed'
    assert round_action('auto_void_round', 0.5, 2, fix_retried=True) == 'promote', 'a round fixed once is not looped'


def test_the_better_attempt_is_reported():
    first = returned(1, 9)
    record = returned(1, 8, [attempt_summary(first)])
    keep_better(record)
    assert record['root'] == 'trial-1-1' and record['kept_attempt'] == 1
    assert [a['trial'] for a in record['attempts']] == ['trial-1-2']


def test_resume_reenters_a_voided_small_slip_and_keeps_a_paused_round_unless_retried():
    kept, reentered = split_resumed([returned(1, 10), returned(2, 9)])
    assert [r['round'] for r in kept] == [1] and reentered['round'] == 2 and len(reentered['attempts']) == 1
    paused = returned(2, 5, paused={'pass_rate': 0.5})
    kept, reentered = split_resumed([returned(1, 10), paused])
    assert [r['round'] for r in kept] == [1, 2] and reentered is None
    kept, reentered = split_resumed([returned(1, 10), paused], retry_paused=True)
    assert reentered['fix_retried'] and reentered['paused'] is None and len(reentered['attempts']) == 1


def test_resume_reenters_a_round_still_running_without_inventing_attempts():
    running = {'round': 1, 'stage': 'sdd_running', 'root': 'trial-1-1', 'execution_id': 'run-1-1'}
    kept, reentered = split_resumed([running])
    assert kept == [] and reentered is running and reentered.get('attempts', []) == []


def test_report_counts_attempts(tmp_path):
    record = returned(1, 10, [attempt_summary(returned(1, 9))])
    publish(tmp_path, [record], 'running')
    assert '| 1 | 2 |' in (tmp_path / 'series-report.md').read_text(encoding='utf-8')


def test_an_upstream_validator_gap_is_rerun_once_whatever_the_score_and_budget_is_fifteen():
    assert MANAGEMENT_BUDGET == 15
    gap = {'mode': 'auto_void_round', 'failure': {'stopped_stage': 'specart', 'stage_conclusion': 'SPEC_GAP: SA183 would modify an existing function body'}}
    assert upstream_spec_gap(gap) and not upstream_spec_gap({'failure': {'stopped_stage': 'coding', 'stage_conclusion': 'SPEC_GAP'}})
    assert round_action('auto_void_round', 0.5, 1, upstream_gap=True) == 'retry'
    assert round_action('auto_void_round', 0.5, 2, upstream_gap=True) == 'pause'
    assert round_action('auto_void_round', 0.5, 1) == 'pause'


def test_rounds_below_floor_go_on_when_pausing_is_off():
    from run_ic_series import round_action, VOID
    from run_series import KEEP
    assert round_action(KEEP, 0.8, 1) == 'pause'
    assert round_action(KEEP, 0.8, 1, pause_below_floor=False) == 'promote'
    assert round_action(VOID, 0.0, 1, pause_below_floor=False) == 'retry'
    assert round_action(VOID, 0.0, 2, pause_below_floor=False) == 'promote'
    assert round_action(KEEP, 0.95, 1, pause_below_floor=False) == 'promote'
