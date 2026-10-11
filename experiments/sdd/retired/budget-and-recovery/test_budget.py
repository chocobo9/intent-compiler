import json
from pathlib import Path
import pytest

from budget import Budget, BudgetExceeded, load_policy


def ready(tmp_path, stage='coding', now=100, timed=False):
    policy = load_policy()
    if timed:
        policy['stage_max_seconds'][stage] = 780
    b = Budget(tmp_path / 'budget.sqlite', policy)
    b.initialize(now)
    b.start_stage(stage, now)
    return b


def test_nested_repairs_cannot_exceed_limit_or_reset_on_reopen(tmp_path):
    b = ready(tmp_path)
    b.admit_external('coding', 'initial', now=100)
    for n in range(3):  # Initial implement + two repairs.
        b.admit_task('coding', f'child-{n}', 'specart-implement', 'initial', now=101)
    again = Budget(b.path, load_policy())
    with pytest.raises(BudgetExceeded, match='repair_limit'):
        again.admit_task('coding', 'fourth', 'specart-implement', 'initial', now=102)
    assert again.snapshot()['counts']['repairs:coding'] == 2


def test_repair_cannot_spend_last_verification_reserve(tmp_path):
    b = ready(tmp_path, timed=True)
    b.admit_external('coding', 'first', now=100)
    b.admit_task('coding', 'initial', 'specart-implement', 'first', now=101)
    deadline = b.snapshot()['stages']['coding']['deadline']
    with pytest.raises(BudgetExceeded, match='reverification_budget'):
        b.admit_task('coding', 'repair', 'specart-implement', 'first', now=deadline - 1)


def test_prd_fix_and_nested_implement_count_once(tmp_path):
    b = ready(tmp_path, 'prd')
    b.admit_external('prd', 'check', role='prd-check-fix', now=100)
    b.admit_external('prd', 'fix', role='prd-fix', now=101)
    b.admit_task('prd', 'implementation', 'specart-implement', 'fix', now=102)
    b.admit_task('prd', 'implementation', 'specart-implement', 'fix', now=102)
    b.admit_external('prd', 'recheck', role='prd-check-fix', now=103)
    assert b.snapshot()['counts']['repairs:prd'] == 1
    with pytest.raises(BudgetExceeded):
        b.admit_external('prd', 'second-fix', role='prd-fix', now=104)


def test_stage_deadline_does_not_reset(tmp_path):
    b = ready(tmp_path, timed=True)
    first = b.snapshot()['stages']['coding']['deadline']
    b.start_stage('coding', 150)
    assert b.snapshot()['stages']['coding']['deadline'] == first


def test_concurrent_admission_uses_one_shared_limit(tmp_path):
    from concurrent.futures import ThreadPoolExecutor
    b = ready(tmp_path)
    b.admit_external('coding', 'root', now=100)
    b.admit_task('coding', 'initial', 'specart-implement', 'root', now=101)
    def attempt(i):
        try:
            Budget(b.path, load_policy()).admit_task('coding', str(i), 'specart-implement', 'root', now=102)
            return True
        except BudgetExceeded:
            return False
    with ThreadPoolExecutor(max_workers=4) as pool:
        assert sum(pool.map(attempt, range(4))) == 2
    assert b.snapshot()['counts']['repairs:total'] == 2


def test_no_deadline_after_long_elapsed_time_but_repairs_still_bounded(tmp_path):
    b = ready(tmp_path)
    assert b.snapshot()['deadline'] is None
    assert b.snapshot()['stages']['coding']['deadline'] is None
    later = 100 + 30 * 86400
    b.check('coding', now=later)
    b.admit_external('coding', 'initial', now=later)
    for n in range(3):
        b.admit_task('coding', str(n), 'specart-implement', 'initial', now=later)
    with pytest.raises(BudgetExceeded, match='repair_limit'):
        b.admit_task('coding', 'extra', 'specart-implement', 'initial', now=later)


def test_document_revisions_have_no_elapsed_time_rejection(tmp_path):
    b = ready(tmp_path, 'design')
    for _ in range(2):
        b.admit_document_revision('change', now=99999999)


def test_external_document_retry_shares_internal_continuation_limit(tmp_path):
    b = ready(tmp_path, 'design')
    b.admit_external('design', 'first-prd', 'prd', now=101)
    b.admit_document_revision('prd', now=102)
    b.admit_external('design', 'second-prd', 'prd', now=103)
    assert b.snapshot()['counts']['document_revisions'] == 2
    b.admit_external('design', 'first-sd', 'sd', now=104)
    assert b.snapshot()['counts']['document_revisions'] == 2
    with pytest.raises(BudgetExceeded, match='document_revision_limit'):
        b.admit_external('design', 'third-prd', 'prd', now=105)
    with pytest.raises(BudgetExceeded, match='document_revision_limit'):
        b.admit_document_revision('change', now=99999999)


@pytest.mark.parametrize('role,reason', [
    ('specart-author', 'design_revision_limit'),
    ('specart-spec-review', 'design_review_limit'),
])
def test_five_design_revisions_allow_six_author_review_cycles(tmp_path, role, reason):
    b = ready(tmp_path, 'design')
    b.admit_external('design', 'root', now=100)
    assert b.policy['max_design_revisions'] == 5
    for n in range(6):
        b.admit_task('design', f'{role}-{n}', role, 'root', now=101+n)
    reopened = Budget(b.path, load_policy())
    with pytest.raises(BudgetExceeded, match=reason):
        reopened.admit_task('design', 'seventh', role, 'root', now=200)
