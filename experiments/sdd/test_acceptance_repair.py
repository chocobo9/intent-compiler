import acceptance_repair as ar


def trial(tmp_path):
    run = tmp_path / 'runs/r2'
    (run / 'repos/main').mkdir(parents=True)
    (run / 'repos/origin').mkdir(parents=True)
    (run / 'output').mkdir()
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
    monkeypatch.setattr(ar, 'accept', lambda main, texts: ({k: {'kind': 'unit', 'unit': ('op', k)} for k in next(calls)}, {'checks': 5, 'build_exit': '0'}))
    monkeypatch.setattr(ar, 'report', lambda failures, texts, prd: 'IC report ' + ','.join(sorted(failures)))
    passes = iter(edits)
    def fix(t, env, log):
        next(passes)(run / 'repos/main')
        return 0, 'prompt'
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


def test_nothing_failing_means_no_repair(tmp_path, monkeypatch):
    t, run = trial(tmp_path)
    wire(monkeypatch, run, [set()], [])
    assert ar.repair_trial(t, 2, {})['outcome'] == 'nothing_to_repair'
