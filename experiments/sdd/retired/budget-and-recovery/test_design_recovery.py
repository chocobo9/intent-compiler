import copy
import json
from pathlib import Path

import pytest

from budget import Budget, BudgetExceeded, load_policy
from recover_design import import_ledger, verify_prelaunch, verify_review_only
from recover_design import relocate_open_design
from recover_design import amendment_policy
from recover_design import inspect_parent
from run_results import source_hash
from run_r1 import sha, stage_configs, write_json
from prepare import workflow


def exhausted(tmp_path):
    policy = load_policy()
    b = Budget(tmp_path / 'old.sqlite', policy)
    b.initialize(now=100)
    b.start_stage('design', now=101)
    b.admit_external('design', 'old-external', now=102)
    for i in range(6):
        b.admit_task('design', str(i), 'specart-author', 'old-external', now=103+i)
    for i in range(2):
        b.admit_task('design', 'review'+str(i), 'specart-spec-review', 'old-external', now=110+i)
    with pytest.raises(BudgetExceeded):
        b.admit_task('design', 'exceeded', 'specart-author', 'old-external', now=112)
    return b, policy


def test_direct_bounded_amendment_accepts_exhausted_original_design(tmp_path):
    import run_r1
    old, policy = exhausted(tmp_path)
    import shutil
    shutil.copy2(old.path, tmp_path / 'budget.sqlite')
    write_json(tmp_path / 'budget-policy.json', policy)
    write_json(tmp_path / 'round.json', {'round': 3})
    write_json(tmp_path / 'completion.json', {
        'budget': old.snapshot(), 'model': run_r1.MODEL, 'variant': run_r1.VARIANT,
        'phases': [{'cleanup_confirmed': True}], 'results': {}})
    run = run_r1.run_directory(tmp_path)
    (run / 'logs').mkdir(parents=True)
    for role in ['prd', 'sd', 'change']:
        write_json(run / 'logs' / (role + '.state.json'), {'status': 'passed'})
    spec = run / 'output/06-Spec骨架/.specart'
    spec.mkdir(parents=True)
    (spec / 'specart.yaml').write_text('project_root: ../../../repos/main\n')
    (spec / 'summary.yaml').write_text('declarations: []\n')
    state, actual = inspect_parent(tmp_path, design_amendment=True)
    assert state == old.snapshot() and actual == policy
    write_json(tmp_path / 'design-recovery.json', {'design_amendment': True})
    with pytest.raises(ValueError):
        inspect_parent(tmp_path, design_amendment=True)


def test_recovery_preserves_original_evidence_and_all_counts(tmp_path):
    old, policy = exhausted(tmp_path)
    before = old.snapshot()
    digest = sha(old.path)
    state = import_ledger(tmp_path / 'new.sqlite', before, policy, tmp_path / 'parent')
    assert old.snapshot() == before and sha(old.path) == digest
    for key in ['counts', 'started', 'deadline', 'stages', 'admitted', 'policy_hash']:
        assert state[key] == before[key]
    assert state['events'][:-1] == before['events']
    assert state['recovery']['prior_stop_reason'] == before['stop_reason']
    recovered = Budget(tmp_path / 'new.sqlite', policy)
    recovered.admit_external('design', 'new-external', now=120)
    recovered.admit_task('design', 'new-review', 'specart-spec-review', 'new-external', now=121)
    assert recovered.snapshot()['counts']['role:design:specart-spec-review'] == 3
    with pytest.raises(BudgetExceeded, match='design_revision_limit_reached'):
        recovered.admit_task('design', 'new-author', 'specart-author', 'new-external', now=122)
    with pytest.raises(ValueError, match='overwrite'):
        import_ledger(tmp_path / 'new.sqlite', before, policy, tmp_path)


def test_recovery_does_not_grant_extra_reviews(tmp_path):
    old, policy = exhausted(tmp_path)
    state = old.snapshot()
    state['counts']['role:design:specart-spec-review'] = 6
    import_ledger(tmp_path / 'new.sqlite', state, policy, tmp_path)
    b = Budget(tmp_path / 'new.sqlite', policy)
    with pytest.raises(BudgetExceeded, match='design_review_limit_reached'):
        b.admit_task('design', 'extra', 'specart-spec-review', 'old-external', now=150)


def test_explicit_amendment_retains_counts_and_allows_only_one_more_author(tmp_path):
    old, policy = exhausted(tmp_path)
    changed = amendment_policy(policy)
    before = old.snapshot()
    import_ledger(tmp_path / 'amended.sqlite', before, changed, policy, parent_policy=policy)
    b = Budget(tmp_path / 'amended.sqlite', changed)
    assert b.snapshot()['counts'] == before['counts']
    assert b.snapshot()['started'] == before['started']
    b.admit_task('design', 'extra-author', 'specart-author', 'old-external', now=140)
    with pytest.raises(BudgetExceeded, match='design_revision_limit'):
        b.admit_task('design', 'too-many', 'specart-author', 'old-external', now=141)
    assert old.snapshot() == before


def test_stage_recovery_skips_only_completed_document_calls(tmp_path):
    run = tmp_path / 'runs/r2'
    run.mkdir(parents=True)
    base = json.loads(Path('D:/sdd/prdcheck/workflow/workflow.json').read_text(encoding='utf-8'))
    write_json(run / 'workflow-cli.json', workflow(base, 'go build -o dpipe ./... && go test ./...'))
    write_json(tmp_path / 'design-recovery.json', {})
    configs = stage_configs(run)
    assert [s['id'] for s in json.loads(configs['design'].read_text())['stages']] == ['specart']
    assert [s['id'] for s in json.loads(configs['coding'].read_text())['stages']] == ['main-coding']


def test_recovery_prelaunch_rejects_artifact_and_budget_drift(tmp_path):
    old, policy = exhausted(tmp_path)
    root = tmp_path / 'new'
    run = root / 'runs/r2'
    run.mkdir(parents=True)
    write_json(root / 'round.json', {'round': 2})
    write_json(root / 'budget-policy.json', policy)
    artifact = run / 'main.go'
    artifact.write_text('package main\n')
    state = import_ledger(root / 'budget.sqlite', old.snapshot(), policy, tmp_path)
    metadata = {'parent_evidence': {str(old.path): sha(old.path)},
        'artifact_hashes': {'main.go': sha(artifact)}, 'inherited_budget': state}
    write_json(root / 'design-recovery.json', metadata)
    verify_prelaunch(root)
    artifact.write_text('changed')
    with pytest.raises(ValueError, match='artifact changed'):
        verify_prelaunch(root)
    artifact.write_text('package main\n')
    Budget(root / 'budget.sqlite', policy).admit_external('design', 'unexpected', now=120)
    with pytest.raises(ValueError, match='budget changed'):
        verify_prelaunch(root)


def test_review_recovery_cannot_rewrite_contracts_before_coding(tmp_path):
    run = tmp_path / 'runs/r2'
    project = run / 'repos/main'
    project.mkdir(parents=True)
    (project / 'main.go').write_text('package main\n')
    write_json(tmp_path / 'round.json', {'round': 2})
    write_json(tmp_path / 'design-recovery.json', {
        'source_hash': source_hash(project), 'artifact_hashes': {}})
    verify_review_only(tmp_path)
    (project / 'extra.go').write_text('package main\n')
    with pytest.raises(ValueError, match='changed product source'):
        verify_review_only(tmp_path)


def test_native_lifecycle_reopens_relocated_task_without_replacing_baseline(tmp_path, monkeypatch):
    import shutil
    monkeypatch.syspath_prepend('D:/sdd/prdcheck/.agents/skills/specart/assets/validator/python')
    from specart.design import Design
    old = tmp_path / 'old'
    project = old / 'repos/main'
    spec = old / 'output/06-Spec骨架/.specart'
    project.mkdir(parents=True)
    spec.mkdir(parents=True)
    (project / 'main.go').write_text('package main\nfunc main() {}\n')
    original = Design(spec, project)
    task = original.begin('go', ui='none')
    before = json.loads(original.before.read_text(encoding='utf-8'))
    (spec / 'summary.yaml').write_text('declarations: []\n')
    new = tmp_path / 'new'
    shutil.copytree(old, new)
    new_design = Design(new / 'output/06-Spec骨架/.specart', new / 'repos/main')
    with pytest.raises(ValueError, match='existing summary has no task record'):
        new_design.begin('go', ui='none')
    relocation = relocate_open_design(old, new)
    assert new_design.begin('go', ui='none') == task
    restored = json.loads(new_design.before.read_text(encoding='utf-8'))
    assert {k:v for k,v in restored.items() if k not in {'spec','project'}} == {
        k:v for k,v in before.items() if k not in {'spec','project'}}
    assert json.loads(original.before.read_text(encoding='utf-8')) == before
    assert relocation['target'] == str(new_design.before)
    assert not new_design.accepted.exists()
    with pytest.raises(ValueError, match='already exists'):
        relocate_open_design(old, new)


def test_direct_exhausted_parent_allows_one_recorded_amendment(tmp_path, monkeypatch):
    import recover_design as recovery
    import run_r1
    old, policy = exhausted(tmp_path)
    parent = tmp_path / 'parent'
    parent.mkdir()
    import shutil
    shutil.copy2(old.path, parent / 'budget.sqlite')
    write_json(parent / 'budget-policy.json', policy)
    write_json(parent / 'completion.json', {
        'budget': old.snapshot(), 'model': run_r1.MODEL, 'variant': run_r1.VARIANT,
        'phases': [{'cleanup_confirmed': True}], 'results': {}})
    run = parent / 'runs/r3'
    spec = run / 'output/06-Spec骨架/.specart'
    spec.mkdir(parents=True)
    (spec / 'summary.yaml').write_text('declarations: []')
    (spec / 'specart.yaml').write_text('project_root: ../../../repos/main')
    monkeypatch.setattr(run_r1, 'run_directory', lambda root: run)
    monkeypatch.setattr(recovery, 'stage_result', lambda *a: {
        'states': {'prd': 'passed', 'sd': 'passed', 'change': 'passed', 'specart': None}})
    state, actual = recovery.inspect_parent(parent, design_amendment=True)
    assert state == old.snapshot() and actual == policy
    write_json(parent / 'design-recovery.json', {'design_amendment': True})
    with pytest.raises(ValueError, match='unmigrated'):
        recovery.inspect_parent(parent, design_amendment=True)
