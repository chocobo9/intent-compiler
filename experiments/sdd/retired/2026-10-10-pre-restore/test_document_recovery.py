from pathlib import Path
import shutil
import pytest
from budget import Budget, BudgetExceeded, load_policy
import recover_document as recovery
import run_r1


def test_prd_recovery_charges_remaining_revision_and_preserves_parent(tmp_path, monkeypatch):
    parent = tmp_path / 'parent'
    run = parent / 'runs/r3'
    (run / 'repos/main').mkdir(parents=True)
    (run / 'output').mkdir()
    (parent / 'baseline').mkdir()
    for folder in [run / 'repos/main', parent / 'baseline']:
        (folder / 'main.go').write_text('package main\n')
    (parent / 'requirement.md').write_text('current requirements')
    run_r1.write_json(parent / 'round.json', {'round': 3})
    policy = load_policy()
    run_r1.write_json(parent / 'budget-policy.json', policy)
    old = Budget(parent / 'budget.sqlite', policy)
    old.initialize(now=10); old.start_stage('design', now=11)
    old.admit_external('design', 'first', 'prd', now=12)
    old.admit_document_revision('prd', now=13)
    old._change(lambda s: s.update(stop_reason='document_output_interrupted'))
    before = old.snapshot()
    run_r1.write_json(parent / 'completion.json', {'round': 3, 'model': run_r1.MODEL,
        'variant': run_r1.VARIANT, 'budget': before, 'phases': [{'cleanup_confirmed': True}], 'results': {}})
    def freeze(number, baseline, requirement, runtime):
        root = tmp_path / 'new'
        destination = root / 'runs/r3'
        (destination / 'output').mkdir(parents=True)
        shutil.copytree(baseline, destination / 'repos/main')
        run_r1.write_json(root / 'round.json', {'round': number})
        run_r1.write_json(root / 'budget-policy.json', policy)
        run_r1.write_json(root / 'provenance.json', {'runtime_files': {}})
        return root
    monkeypatch.setattr(run_r1, 'freeze', freeze)
    root = recovery.prepare_document_recovery(parent)
    new = Budget(root / 'budget.sqlite', policy)
    assert new.snapshot()['started'] == before['started']
    assert new.snapshot()['counts']['document_revisions'] == 2
    assert old.snapshot() == before
    new.admit_external('design', 'recovery', 'prd', now=99)
    assert new.snapshot()['counts']['document_revisions'] == 2
    with pytest.raises(BudgetExceeded, match='document_revision_limit'):
        new.admit_external('design', 'extra-retry', 'prd', now=100)
