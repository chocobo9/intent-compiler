import json
from pathlib import Path
import pytest
import run_series
from run_r1 import write_json


def test_recovered_round_keeps_failed_attempt_and_rejects_reset(tmp_path):
    original, recovered = tmp_path / 'old', tmp_path / 'recovered'
    for root in [original, recovered]:
        root.mkdir()
        (root / 'requirement.md').write_text('same requirement')
        write_json(root / 'budget-policy.json', {'max_design_revisions': 5})
        write_json(root / 'completion.json', {'round': 2,
            'budget': {'started': 100, 'counts': {'author': 6, 'review': 2 if root == original else 3}}})
    write_json(recovered / 'design-recovery.json', {'parent': str(original),
        'parent_evidence': {str(original / 'completion.json'): run_series.run_r1.sha(original / 'completion.json')}})
    record = {'root': str(original), 'round': 2, 'completion': {'sdd_status': 'not_passed'}}
    evidence = {}
    result = run_series.recovered_record(record, recovered, evidence)
    assert result['superseded_attempt'] == record
    assert result['root'] == str(recovered.resolve())
    assert str(recovered / 'design-recovery.json') in evidence
    data = json.loads((recovered / 'completion.json').read_text())
    data['budget']['counts']['author'] = 0
    write_json(recovered / 'completion.json', data)
    with pytest.raises(ValueError, match='reset a counter'):
        run_series.recovered_record(record, recovered, {})


def test_recovered_round_rejects_requirement_drift(tmp_path):
    original, recovered = tmp_path / 'old', tmp_path / 'recovered'
    for root in [original, recovered]:
        root.mkdir()
        (root / 'requirement.md').write_text(str(root))
    write_json(recovered / 'design-recovery.json', {'parent': str(original), 'parent_evidence': {}})
    with pytest.raises(ValueError, match='changed requirement'):
        run_series.recovered_record({'root': str(original), 'round': 2}, recovered, {})
