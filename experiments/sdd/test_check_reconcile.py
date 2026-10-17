import check_reconcile

# The generic lines are the two error-handling cases of the v6 R1 official log
# (ic6-sdd-dpipe-r1-20261017-031812z-f7e05ce0), which name no command.
GENERIC = (
    'CASE_RESULT case_id=c068 origin_step=round-1 requirement_ref=error-handling case_type=error status={s} '
    'intent="Error handling" scenario="error: missing file exit code 1" input="n/a" expected="x" actual="x" failure_reason=""\n'
    'CASE_RESULT case_id=c069 origin_step=round-1 requirement_ref=error-handling case_type=error status={s} '
    'intent="Error handling" scenario="error: missing file message" input="n/a" expected="x" actual="x" failure_reason=""\n'
)
MANIFEST_OWN = (
    'CASE_RESULT case_id=c200 origin_step=round-1 requirement_ref=manifest case_type=error status={s} '
    'intent="manifest reports a missing file" scenario="manifest with nonexistent path" input="n/a" expected="x" actual="x" failure_reason=""\n'
)


def _log(tmp_path, text):
    path = tmp_path / 'official-verifier.log'
    path.write_text(text, encoding='utf-8')
    return path


def _probe(failed):
    return [{'class': 'probe', 'id': 'manifest:missing-file', 'failed': failed, 'match': 'probe'}]


def test_generic_only_match_is_not_a_false_positive(tmp_path):
    result = check_reconcile.reconcile(_probe(True), _log(tmp_path, GENERIC.format(s='success')))
    row = result['rows'][0]
    assert row['how'] == 'generic kind'
    assert row['official'] == ['c068:pass', 'c069:pass']
    assert row['verdict'] == 'unmatched'
    assert row['note'] == 'generic cases only (other command)'
    assert result['summary'] == {'probe': {'unmatched': 1}}
    assert result['gate'] == {'probe': 'open'}
    assert '| probe | 0 | 0 | 0 | 1 | 无可比项 |' in check_reconcile.table(result)


def test_table_conclusion_wording(tmp_path):
    log = _log(tmp_path, GENERIC.format(s='success') + MANIFEST_OWN.format(s='success'))
    items = [
        {'class': 'probe', 'id': 'manifest:missing-file', 'failed': False, 'match': 'probe'},   # consistent
        {'class': 'probe', 'id': 'ingest:missing-file', 'failed': True, 'match': 'probe'},      # generic only
        {'class': 'probe_fp', 'id': 'manifest:missing-file', 'failed': True, 'match': 'probe'},  # false positive
        {'class': 'none', 'id': 'transform:missing-file', 'failed': False, 'match': 'probe'},   # generic only
    ]
    result = check_reconcile.reconcile(items, log)
    table = check_reconcile.table(result)
    assert '| probe | 1 | 0 | 0 | 1 | 无误报 |' in table
    assert '| probe_fp | 0 | 1 | 0 | 0 | 有误报（不得回送） |' in table
    assert '| none | 0 | 0 | 0 | 1 | 无可比项 |' in table
    assert result['gate'] == {'probe': 'open', 'probe_fp': 'closed', 'none': 'open'}


def test_generic_only_match_is_not_a_miss(tmp_path):
    result = check_reconcile.reconcile(_probe(False), _log(tmp_path, GENERIC.format(s='failed')))
    assert result['rows'][0]['verdict'] == 'unmatched'


def test_command_and_kind_match_keeps_false_positive(tmp_path):
    log = _log(tmp_path, GENERIC.format(s='success') + MANIFEST_OWN.format(s='success'))
    result = check_reconcile.reconcile(_probe(True), log)
    row = result['rows'][0]
    assert row['how'] == 'command and kind'
    assert row['official'] == ['c200:pass']
    assert row['verdict'] == 'ic_false_positive'
    assert 'note' not in row
    assert result['gate'] == {'probe': 'closed'}


def test_command_and_kind_match_keeps_consistent_and_missed(tmp_path):
    log = _log(tmp_path, MANIFEST_OWN.format(s='failed'))
    assert check_reconcile.reconcile(_probe(True), log)['rows'][0]['verdict'] == 'consistent'
    assert check_reconcile.reconcile(_probe(False), log)['rows'][0]['verdict'] == 'ic_missed'


def test_official_build_failed_makes_every_row_not_comparable(tmp_path):
    # v6 R9: SDD returned a SpecArt skeleton that does not build; the official cases ran the previous
    # round's dpipe left in the directory, so they say nothing about this code.
    log = _log(tmp_path, MANIFEST_OWN.format(s='success'))
    items = _probe(True) + [{'class': 'unit', 'id': 'unit:command:manifest', 'failed': True, 'match': 'unit', 'name': 'manifest'}]
    result = check_reconcile.reconcile(items, log, official_build_exit=1)
    assert [r['verdict'] for r in result['rows']] == ['unmatched', 'unmatched']
    assert all(r['note'] == 'official build failed (exit 1): its cases did not run this code' for r in result['rows'])
    assert result['rows'][0]['how'] == 'command and kind' and result['rows'][0]['official'] == ['c200:pass']
    assert result['gate'] == {'probe': 'open', 'unit': 'open'}
    assert result['official_build_exit'] == 1
    assert '| probe | 0 | 0 | 0 | 1 | 无可比项 |' in check_reconcile.table(result)
    # A build that succeeded, or one not recorded, keeps the usual verdicts.
    for build in (0, None):
        assert check_reconcile.reconcile(_probe(True), log, official_build_exit=build)['rows'][0]['verdict'] == 'ic_false_positive'


def test_round_reconcile_reads_the_official_build_exit(tmp_path):
    import round_reconcile
    log = _log(tmp_path, '')
    assert round_reconcile.official_build_exit(log) is None
    (tmp_path / 'official-verifier').mkdir()
    (tmp_path / 'official-verifier' / 'build-exit-code.txt').write_text('1\n')
    assert round_reconcile.official_build_exit(log) == 1


def test_round_report_marks_a_score_without_a_build():
    import round_report
    assert round_report._sdd_score({'build_exit_code': 0, 'passed': 711, 'total': 816}) == '711/816'
    assert round_report._sdd_score({'build_exit_code': 1, 'passed': 671, 'total': 816}) == '构建失败（官方构建 exit 1；671/816 不是由该代码构建的程序得出）'
