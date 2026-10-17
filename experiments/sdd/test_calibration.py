"""The 2026-10-17 calibration of IC's intent checks: a failure counts when it does not depend on the values (or on
the extra columns IC's own input carries); keys only some like entries show are value-dependent; per-command gates."""
import acceptance_repair
import post_prd


def test_a_failure_counts_only_when_every_placeholder_run_fails_the_same_way():
    assert post_prd.same_failure([{'exit_code': 1}, {'exit_code': 1}]) == 1
    assert post_prd.same_failure([{'exit_code': 1}, {'exit_code': 2}]) is None
    assert post_prd.same_failure([{'exit_code': 1}, {'exit_code': 0}]) is None
    assert post_prd.same_failure([{'exit_code': 0}, {'exit_code': 0}]) is None
    assert post_prd.same_failure([{'exit_code': 1}, {}]) is None, 'a run that did not run proves nothing'


def test_smaller_headers_end_with_one_holding_no_named_column():
    subsets = post_prd.column_subsets(['a', 'b', 'c'])
    assert subsets[:3] == [['a', 'b'], ['a', 'c'], ['b', 'c']] and subsets[-1] == []
    assert post_prd.column_subsets(['a']) == [[]]
    assert len(post_prd.column_subsets([f'c{i}' for i in range(10)])) == 64


def test_columns_an_expression_reads_are_columns_and_prose_is_not():
    sample = {'op': 'derive', 'name': 'score', 'expression': "value * 2 + qty", 'message': 'value out of range'}
    assert post_prd.identifiers(sample, skip={'derive'}) == ['score', 'value', 'qty']
    assert post_prd.identifiers({'op': 'filter', 'where': "status == 'active' and age > 3"}, skip={'filter'}) == ['status', 'age']


def test_keys_only_some_like_entries_show_are_not_required():
    schema = {'columns': {'id': {'type': 'int'}, 'status': {'type': 'string', 'enum': ['a', 'b']}}}
    assert post_prd.value_dependent(schema) == {'$.columns.status.enum'}
    assert post_prd.compare_shape(schema, {'columns': {'id': {'type': 'int'}, 'status': {'type': 'int'}}}) == []
    profile = {'columns': [{'name': 'id', 'median': 1.5}]}
    assert post_prd.compare_shape(profile, {'columns': [{'name': 'id'}]}) == ['missing $.columns[].median (number)'], 'one entry: every key it shows is required'


def test_no_output_from_both_runs_failing_the_same_way_is_a_failure():
    r = [{'files_content': {}}, {'files_content': {}}]
    item = post_prd.structure_item('profile', {'a': 1}, [{'exit_code': 1, 'stderr': 'x'}, {'exit_code': 1}], 'out.json', r, True)
    assert item['failed'] and item['state'].startswith('no output file under both placeholder sets')
    item = post_prd.structure_item('profile', {'a': 1}, [{'exit_code': 1}, {'exit_code': 2}], 'out.json', r, True)
    assert not item['failed']


def test_a_problem_counts_only_when_every_run_shows_it():
    runs = [{'files_content': {'o.json': '{"a": 1}'}}, {'files_content': {'o.json': '{"a": 1, "b": 2}'}}]
    item = post_prd.structure_item('c', {'a': 1, 'b': 2}, [{'exit_code': 0}, {'exit_code': 0}], 'o.json', runs, True)
    assert not item['failed'] and item['problems'] == []


def test_a_command_gate_overrides_its_class():
    gate = {**acceptance_repair.DEFAULT_GATE, 'p2_structure:profile': 'open'}
    assert acceptance_repair.gate_state(gate, 'p2:profile') == 'open'
    assert acceptance_repair.gate_state(gate, 'p2:schema') == 'closed'
    assert acceptance_repair.gate_state(gate, 'unit:op:round') == 'open'
