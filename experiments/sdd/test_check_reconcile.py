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
