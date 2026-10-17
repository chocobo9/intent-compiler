import acceptance_repair as ar


def trial(tmp_path):
    run = tmp_path / 'runs/r2'
    (run / 'repos/main').mkdir(parents=True)
    (run / 'repos/origin').mkdir(parents=True)
    (run / 'output').mkdir()
    (run / 'logs').mkdir()
    (run / 'logs/coding-main.stream').write_text('')
    (run / 'repos/main/main.go').write_text('package main\n')
    (run / 'repos/main/main_test.go').write_text('package main\n')
    (run / ar.PRD).write_text('# PRD\n')
    (run / ar.REPORT).write_text('SDD report\n')
    return tmp_path, run


def wire(monkeypatch, run, results, edits):
    """results: failing sets accept() returns in order; edits: what each prd-fix pass does to the code."""
    calls = iter(results)
    monkeypatch.setattr(ar.run_r1, 'run_directory', lambda t: run)
    monkeypatch.setattr(ar, 'texts_upto', lambda n: ['text'])
    kinds = lambda k: {'kind': 'build', 'output': 'main.go:3: undefined: x'} if k == ar.BUILD else {'kind': 'probe', 'probe': {'id': k[6:], 'rule': 'r', 'run': {'args': [], 'files': []}}, 'observed': {}} if k.startswith('probe:') else {'kind': 'unit', 'unit': ('op', k)}
    monkeypatch.setattr(ar, 'accept', lambda main, texts: ({k: kinds(k) for k in next(calls)}, {'checks': 5, 'build_exit': '0'}))
    monkeypatch.setattr(ar, 'report', lambda failures, texts, prd: 'IC report ' + ','.join(sorted(failures)))
    passes = iter(edits)
    def fix(t, env, log):
        next(passes)(run / 'repos/main')
        return 0, 'prompt', None
    monkeypatch.setattr(ar, 'prdfix', fix)
    monkeypatch.setattr(ar, 'build_and_test', lambda main: (0, 'ok'))


def test_a_fix_that_clears_failures_without_regression_is_adopted_and_sdd_records_are_kept(tmp_path, monkeypatch):
    t, run = trial(tmp_path)
    wire(monkeypatch, run, [{'clip'}, set()], [lambda m: (m / 'clip.go').write_text('package main\n')])
    r = ar.repair_trial(t, 2, {})
    assert r['outcome'] == 'adopted' and r['passes'][0]['fixed'] == ['clip'] and r['passes'][0]['changed_files'] == ['clip.go']
    assert (run / ar.REPORT).read_text() == 'SDD report\n', "SDD's own report is restored"
    assert (t / 'acceptance/sdd-main/main.go').exists() and (t / 'acceptance/report-pass1.md').read_text() == 'IC report clip'


def test_deleted_tests_and_prd_edits_are_undone_but_code_fixes_stay(tmp_path, monkeypatch):
    t, run = trial(tmp_path)
    def edit(m):
        (m / 'main_test.go').unlink()
        (m / 'clip.go').write_text('package main\n')
        (run / ar.PRD).write_text('# PRD edited\n')
    wire(monkeypatch, run, [{'clip'}, set()], [edit])
    r = ar.repair_trial(t, 2, {})
    assert r['outcome'] == 'adopted' and r['passes'][0]['tests_restored'] == ['main_test.go'] and r['passes'][0]['prd_restored']
    assert (run / 'repos/main/main_test.go').exists() and (run / ar.PRD).read_text() == '# PRD\n' and (run / 'repos/main/clip.go').exists()


def test_a_regression_gets_a_second_pass_and_without_net_gain_the_code_sdd_returned_comes_back(tmp_path, monkeypatch):
    t, run = trial(tmp_path)
    broke = lambda m: (m / 'main.go').write_text('package main // changed\n')
    wire(monkeypatch, run, [{'clip'}, {'tag'}, {'tag', 'scale'}], [broke, broke])
    r = ar.repair_trial(t, 2, {})
    assert [p['regressed'] for p in r['passes']] == [['tag'], ['scale', 'tag']]
    assert r['outcome'] == 'reverted' and (run / 'repos/main/main.go').read_text() == 'package main\n'


def test_after_a_partial_fix_is_adopted_the_remaining_failures_get_a_second_pass(tmp_path, monkeypatch):
    t, run = trial(tmp_path)
    fix = lambda name: lambda m: (m / f'{name}.go').write_text('package main\n')
    wire(monkeypatch, run, [{'clip', 'tag'}, {'tag'}, set()], [fix('clip'), fix('tag')])
    r = ar.repair_trial(t, 2, {})
    assert r['outcome'] == 'adopted' and [p['gaps'] for p in r['passes']] == [['clip', 'tag'], ['tag']]
    assert [p['fixed'] for p in r['passes']] == [['clip'], ['tag']] and r['failing_final'] == []
    assert (run / 'repos/main/clip.go').exists() and (run / 'repos/main/tag.go').exists()


def test_a_second_pass_that_regresses_goes_back_to_the_adopted_first_pass(tmp_path, monkeypatch):
    t, run = trial(tmp_path)
    def broke(m):
        (m / 'main.go').write_text('package main // broken\n')
    wire(monkeypatch, run, [{'clip', 'tag'}, {'tag'}, {'tag', 'scale'}], [lambda m: (m / 'clip.go').write_text('package main\n'), broke])
    r = ar.repair_trial(t, 2, {})
    assert r['outcome'] == 'adopted' and r['passes'][1]['regressed'] == ['scale'] and r['passes'][1]['reverted_to'] == 'adopted-pass1'
    assert r['failing_final'] == ['tag'] and (run / 'repos/main/clip.go').exists()
    assert r['fixed'] == ['clip'], 'the adopted first pass, not the reverted second'
    assert (run / 'repos/main/main.go').read_text() == 'package main\n'


def test_before_coding_acceptance_starts_from_the_baseline_not_the_spec_skeleton(tmp_path, monkeypatch):
    t, run = trial(tmp_path)
    (run / 'logs/coding-main.stream').unlink()
    (run / 'repos/origin/main.go').write_text('package main // baseline\n')
    (run / 'repos/main/main.go').write_text('package main\n// @pendingUpdate x\n')
    wire(monkeypatch, run, [set()], [])
    r = ar.repair_trial(t, 2, {})
    assert r['start'] == 'origin' and r['precoding_pending_updates'] == 1 and r['origin_pending_updates'] == 0
    assert (run / 'repos/main/main.go').read_text() == 'package main // baseline\n'
    assert not (run / 'repos/main/main_test.go').exists() and (t / 'acceptance/sdd-main-precoding/main_test.go').exists()


def test_without_a_prd_the_checks_are_recorded_and_nothing_is_repaired(tmp_path, monkeypatch):
    t, run = trial(tmp_path)
    (run / ar.PRD).unlink()
    wire(monkeypatch, run, [{'clip'}], [])
    r = ar.repair_trial(t, 2, {})
    assert r['outcome'] == 'not_repaired_no_prd' and r['failing_final'] == ['clip'] and r['passes'] == []
    assert not (t / 'acceptance/sdd-main').exists()


def test_nothing_failing_means_no_repair(tmp_path, monkeypatch):
    t, run = trial(tmp_path)
    wire(monkeypatch, run, [set()], [])
    assert ar.repair_trial(t, 2, {})['outcome'] == 'nothing_to_repair'


def test_an_interrupted_attempt_is_undone_before_starting_over(tmp_path, monkeypatch):
    t, run = trial(tmp_path)
    (t / 'acceptance/sdd-main').mkdir(parents=True)
    (t / 'acceptance/sdd-main/main.go').write_text('package main\n')
    (t / 'acceptance/08-sdd-report.md').write_text('SDD report\n')
    (run / 'repos/main/main.go').write_text('package main // half-repaired\n')
    (run / ar.REPORT).write_text('IC report\n')
    wire(monkeypatch, run, [set()], [])
    assert ar.repair_trial(t, 2, {})['outcome'] == 'nothing_to_repair'
    assert (run / 'repos/main/main.go').read_text() == 'package main\n' and (run / ar.REPORT).read_text() == 'SDD report\n'
    assert list(t.glob('acceptance-interrupted-*'))


def test_a_call_that_writes_nothing_in_time_is_killed(tmp_path):
    import sys
    log = tmp_path / 'log'
    assert ar._call_watched([sys.executable, '-c', 'import time; time.sleep(30)'], log, None, tmp_path, first_output_seconds=1) is None
    assert ar._call_watched([sys.executable, '-c', 'print("step")'], log, None, tmp_path, first_output_seconds=1) == 0


def test_code_that_does_not_build_is_repaired_and_the_probes_it_then_reveals_are_not_regressions(tmp_path, monkeypatch):
    t, run = trial(tmp_path)
    wire(monkeypatch, run, [{ar.BUILD}, {'probe:compare:missing-flag-key'}, set()],
         [lambda m: (m / 'main.go').write_text('package main // fixed\n'), lambda m: (m / 'compare.go').write_text('package main\n')])
    r = ar.repair_trial(t, 2, {})
    assert r['outcome'] == 'adopted' and r['passes'][0]['fixed'] == [ar.BUILD] and r['passes'][0]['regressed'] == []
    assert 'compare:missing-flag-key' in str(r['passes'][0]['failing_after'])
    # The probe the build fix revealed gets the second pass.
    assert r['passes'][1]['gaps'] == ['probe:compare:missing-flag-key'] and r['failing_final'] == []


def test_a_fix_that_breaks_the_build_is_a_regression_and_without_recovery_is_reverted(tmp_path, monkeypatch):
    t, run = trial(tmp_path)
    broke = lambda m: (m / 'main.go').write_text('package main // broken\n')
    wire(monkeypatch, run, [{'clip'}, {ar.BUILD}, {ar.BUILD}], [broke, broke])
    r = ar.repair_trial(t, 2, {})
    assert r['passes'][0]['regressed'] == [ar.BUILD] and r['passes'][1]['gaps'] == [ar.BUILD]
    assert r['outcome'] == 'reverted' and (run / 'repos/main/main.go').read_text() == 'package main\n'


def test_accept_does_not_probe_code_that_fails_to_build(tmp_path, monkeypatch):
    monkeypatch.setattr(ar, 'build_and_test', lambda main: (1, 'undefined: x'))
    monkeypatch.setattr(ar, 'run_examples', lambda *a, **k: (_ for _ in ()).throw(AssertionError('probes ran')))
    failures, info = ar.accept(tmp_path, ['### `clip`\n```json\n{"op": "clip"}\n```\n'])
    assert list(failures) == [ar.BUILD] and info['build_exit'] == '1'
