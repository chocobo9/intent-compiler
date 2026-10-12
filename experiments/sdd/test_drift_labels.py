import json

import drift_labels as dl


def run_dir(tmp_path, monkeypatch, prd='', change='', summary='', report='', verdict=''):
    run = tmp_path / 'runs/r3'
    for rel, text in [(dl.PRD, prd), (dl.CHANGE, change), (dl.SUMMARY, summary), (dl.SDD_REPORT, report), ('repos/main/.verdict.md', verdict)]:
        (run / rel).parent.mkdir(parents=True, exist_ok=True)
        (run / rel).write_text(text, encoding='utf-8')
    (tmp_path / 'completion.json').write_text(json.dumps({'results': {'official': {'requested_build_exit_code': 0}}}))
    monkeypatch.setattr(dl.run_r1, 'run_directory', lambda t: run)
    return tmp_path


def test_each_label_names_the_stage_that_lost_the_unit(tmp_path, monkeypatch):
    t = run_dir(tmp_path, monkeypatch,
                prd='`resample` groups rows; `watermark` hashes; `sort` orders.\n| 安全 | 【假设】watermark key 可省略 |',
                change='Adds watermark.', summary='ops: sort, rename, drop, resample and watermark\nwatermark: hmac', report='GAP-001 watermark missing',
                verdict='SPEC_GAP\n<!--VERDICT:{"skill":"coding","pass":false}-->')
    units = {('op', 'resample'): 3, ('op', 'watermark'): 3, ('op', 'sort'): 1, ('op', 'tag'): 4}
    acc = {'failing_before': ['unit:op:resample', 'unit:op:watermark']}
    got = dl.labels(t, 3, units, acc, previous_failing=set())
    assert got['op:resample'] == ['C1', 'S1', 'K1', 'G1']
    assert got['op:watermark'] == ['K1']
    assert 'op:sort' not in got and 'op:tag' not in got, 'a passing old unit and a future unit get no label'
    assert got['round'] == ['V1']


def test_p2_candidates_are_failures_whose_unit_has_prd_assumptions(tmp_path, monkeypatch):
    t = run_dir(tmp_path, monkeypatch, prd='verify 【假设】非十六进制摘要报 ERROR: invalid checksum\n')
    failures = {'probe:verify:missing-file': {'kind': 'probe', 'probe': {'id': 'verify:missing-file', 'rule': 'Missing input files: ERROR: file not found'}},
                'unit:op:clip': {'kind': 'unit', 'unit': ('op', 'clip')}}
    got = dl.p2_candidates(t, failures)
    assert list(got) == ['probe:verify:missing-file'] and got['probe:verify:missing-file']['assumptions']


def test_a_shortened_case_id_still_maps_to_its_unique_candidate(tmp_path, monkeypatch):
    t = run_dir(tmp_path, monkeypatch)
    answer = '{"type":"text","part":{"text":"{\\"cases\\":[{\\"id\\":\\"op:crossjoin\\",\\"contradicts\\":true,\\"reason\\":\\"r\\"}]}"}}\n'
    monkeypatch.setattr(dl.subprocess, 'call', lambda *a, **k: (open(k['stdout'].name, 'w', encoding='utf-8').write(answer), 0)[1])
    got = dl.judge_p2(t, {'OPENCODE_BIN': 'x'}, {'unit:op:crossjoin': {'unit': 'crossjoin', 'assumptions': ['a'], 'rule': 'r'}}, [''], tmp_path / 'j.stream')
    assert got == {'unit:op:crossjoin': {'contradicts': True, 'reason': 'r'}}


def test_the_p2_excerpt_is_the_unit_s_own_section():
    texts = ['# T\n### `sort`\nsorts\n### `resample`\nStratified.\n#### Rules\n- groups\n### `clip`\nclips\n']
    got = dl.unit_section(texts, 'resample')
    assert got.startswith('### `resample`') and '- groups' in got and 'clip' not in got
