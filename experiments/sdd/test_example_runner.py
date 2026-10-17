import json

from example_runner import evaluate_asserts, same_json


def out(stdout='', stderr='', files=None, code=0):
    return {'exit_code': code, 'stdout': stdout, 'stderr': stderr, 'files': files or {}}


def test_json_output_is_compared_as_a_value_not_as_text():
    assert same_json('{"a": 1, "b": [2]}', '{\n  "b": [2],\n  "a": 1.0\n}')
    assert same_json('not json', '{}') is None
    exact = [{'where': 'file:report.json', 'mode': 'exact', 'value': '{"a": 1, "b": 2}'}]
    assert evaluate_asserts(None, exact, out(files={'report.json': '{"b": 2, "a": 1}'})) == []
    assert evaluate_asserts(None, exact, out(files={'report.json': '{"b": 3, "a": 1}'}))


def test_whole_json_lines_compare_by_value_and_partial_lines_stay_textual():
    whole = [{'where': 'file:r.json', 'mode': 'lines', 'value': json.dumps(['={"x": 1,', '="y": 2}'])}]
    assert evaluate_asserts(None, whole, out(files={'r.json': '{"y": 2, "x": 1}'})) == []
    part = [{'where': 'stdout', 'mode': 'lines', 'value': json.dumps(['~MISMATCH'])}]
    assert evaluate_asserts(None, part, out(stdout='MISMATCH expected=a actual=b')) == []


def test_a_source_directory_named_like_the_program_is_copied_and_only_the_root_binary_is_skipped(tmp_path):
    import shutil
    from example_runner import copy_ignore
    (tmp_path / 'cmd' / 'dpipe').mkdir(parents=True)
    (tmp_path / 'cmd' / 'dpipe' / 'main.go').write_text('package main')
    (tmp_path / 'dpipe').write_text('binary')
    (tmp_path / '.specart').mkdir()
    (tmp_path / 'cmd' / '.git').mkdir()
    dst = tmp_path.parent / (tmp_path.name + '-copy')
    shutil.copytree(tmp_path, dst, ignore=copy_ignore(tmp_path))
    assert (dst / 'cmd' / 'dpipe' / 'main.go').exists()
    assert not (dst / 'dpipe').exists() and not (dst / '.specart').exists() and not (dst / 'cmd' / '.git').exists()
