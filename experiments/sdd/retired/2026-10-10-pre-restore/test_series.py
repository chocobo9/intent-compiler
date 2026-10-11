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
    assert '| 1 | not_passed | build_failed | 0 / 219 |' in (tmp_path / 'series-report.md').read_text()


def test_promotion_requires_all_sdd_gates_but_not_all_official_cases():
    completion = {'sdd_status': 'pass', 'phases': [{'cleanup_confirmed': True}], 'results': {
        'design': {'status': 'pass'}, 'coding': {'status': 'pass'}, 'prd': {'status': 'pass'},
        'final': {'status': 'pass'}, 'official': {'status': 'evaluated', 'passed': 14, 'total': 15}}}
    assert promotion_blockers(completion) == []
    completion['results']['coding']['status'] = 'process_failed'
    assert 'coding' in promotion_blockers(completion)


def test_shared_context_distinguishes_assumptions_and_implementation():
    text = Path(__file__).with_name('execution-context.md').read_text(encoding='utf-8')
    assert 'operative' in text and 'never contradict an explicit requirement' in text
    assert 'Missing\nfunction bodies are expected' in text
    assert 'Do not waive a missing entry/build contract' in text


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
        record = {'round': 1, 'root': str(trial), 'completion': json.loads((trial / 'completion.json').read_text()),
                  'baseline_sha256': series.source_hash(trial / 'runs/r1/repos/main'), 'inherited_from': 'previous-series'}
        cfg = json.loads((root / 'series.json').read_text())
        cfg['continuation'] = {'records': [record], 'evidence_sha256': {}}
        (root / 'series.json').write_text(json.dumps(cfg))
        called.clear()
    if design_failed:
        import pytest
        with pytest.raises(RuntimeError, match='design'):
            series.execute_series(root)
        assert called == [2 if inherited else 1]
        saved = json.loads((root / 'series-results.json').read_text())
        assert saved['status'] == 'runner_blocked'
        assert saved['rounds'][-1]['completion']['results']['official']['status'] == 'evaluated'
        return
    series.execute_series(root)
    result = json.loads((root / 'series-results.json').read_text())
    assert called == list(range(2 if inherited else 1, 16))
    assert result['completed_rounds'] == 15 and result['status'] == 'completed'


def _continuation_fixture(tmp_path, coding_status='pass'):
    import run_series as series
    parent = tmp_path / 'parent'; parent.mkdir()
    trial = tmp_path / 'trial'; trial.mkdir()
    for rel in ['runs/r1/repos/main', 'official-app', 'official-verifier']:
        (trial / rel).mkdir(parents=True)
    for rel in ['runs/r1/repos/main', 'official-app']:
        (trial / rel / 'main.go').write_text('package main\nfunc main(){}')
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


def test_continue_from_rejects_failed_coding_even_with_complete_official_sample(tmp_path):
    series, parent, _ = _continuation_fixture(tmp_path, coding_status='process_failed')
    with pytest.raises(ValueError, match='not eligible for promotion.*coding'):
        series.continuation_records(parent)


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
