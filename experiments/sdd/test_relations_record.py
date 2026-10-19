"""The relation record (v7 0.2): slot check, revision landing, the two invariants. Synthetic units; no Docker."""
from relations import relations_record as rr


def unit(id, strings, src='', func=None):
    return {'id': id, 'kind': id.split(':')[0], 'func': func or id.split(':')[1], 'file': 'lineage.go', 'line': 67, 'end': 67, 'hash': 'h', 'strings': strings, 'src': src}


LINEAGE = "## New command: `lineage`\n\n### Behavior\n\n- `\"ingest\"`: input = `file`, output = `output`\n- `\"verify\"`: inputs = `file` + `checksum`, output = none\n\nThe `lineage` command recognizes `\"reconcile\"` steps:\n"


def test_a_slot_whose_values_share_nothing_with_the_original_line_for_its_key_is_reported():
    units = [unit('lit:generateLineage:inputFields["ingest"]', ['ingest', 'input']), unit('lit:generateLineage:inputFields["verify"]', ['verify', 'file', 'checksum']),
             unit('lit:generateLineage:inputFields["reconcile"]', ['reconcile', 'left', 'right']), unit('case:lineageMapping:ingest', ['ingest', 'input'])]
    got = rr.slot_mismatches(units, [LINEAGE], ['lineage', 'pipeline'])
    assert [(m['slot'], m['code'], m['original']) for m in got] == [('lit:generateLineage:inputFields["ingest"]', ['input'], ['file', 'output']),
                                                                   ('case:lineageMapping:ingest', ['input'], ['file', 'output'])]


def test_landing_needs_values_the_original_writes_as_literals():
    rev = {'subjects': ['normalize'], 'old_values': [], 'new_values': ['minmax'], 'now': [{'text': 'behave exactly like `"minmax"`'}], 'before': []}
    assert rr.landing(rev, [unit('case:applyOp:normalize', ['normalize', 'minmax'])])['state'] == 'landed'
    assert rr.landing(rev, [unit('case:applyOp:normalize', ['normalize', 'zscore'])])['state'] == 'not landed'
    prose = {'subjects': ['verify'], 'old_values': [], 'new_values': ['BLAKE2b-256'], 'now': [{'text': 'It now uses **BLAKE2b-256** instead.'}], 'before': []}
    assert rr.landing(prose, [unit('case:main:verify', ['verify'])]) == {'state': 'unknown', 'why': 'the original writes its values as prose, not literals'}
    replaced = {'subjects': ['manifest'], 'old_values': ['sha256'], 'new_values': ['checksum'], 'now': [{'text': '`checksum`'}], 'before': [{'text': '`"sha256"`'}]}
    assert rr.landing(replaced, [unit('type:manifestEntry', ['path', 'checksum', 'sha256'], func='manifestEntry')])['state'] == 'not landed', 'the old literal is still there'


def test_a_name_counts_as_written_only_quoted_or_as_an_option():
    assert rr.writes('the `rows` key', 'rows') and rr.writes('{"rows": 1}', 'rows') and rr.writes('use --baseline <path>', '--baseline')
    assert not rr.writes('counts the rows of each file', 'rows')
    assert not rr.writes('use --baseline-file', '--baseline')


def test_i1_lists_what_ic_drops_and_names_only_the_cut_passages_write():
    texts = ['manifest sample: {"path": "a", "rows": 42}\nErrors: `ERROR: empty CSV`', 'compare: `--key` is required']
    delivery = {'text': '# Changes\ncompare: `--key`\n# Requirement baseline: the PRD SDD clarified for user update 1\nPRD with `rows`\n## Original user update 2\ncompare: `--key` is required',
                'removed': [{'text': 'manifest sample: {"path": "a", "rows": 42}'}]}
    got = rr.i1(texts, delivery)
    assert got['errors_missing'] == ['ERROR: empty CSV'], 'the PRD baseline is not IC-owned text'
    assert got['names_only_in_cut'] == ['path', 'rows']


def test_i2_lists_delivered_names_and_error_texts_the_prd_does_not_write():
    got = rr.i2({'text': 'option `--baseline`; `ERROR: empty CSV`; `ERROR: file not found: <path>`'}, 'PRD: file not found: <path> is reported')
    assert got['names_missing'] == ['--baseline'] and got['errors_missing'] == ['ERROR: empty CSV']
