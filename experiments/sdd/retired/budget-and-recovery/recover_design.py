"""Explicit, one-time review recovery; never grants new author revisions."""
import argparse
import copy
import hashlib
import json
from pathlib import Path
import shutil
import sqlite3

from budget import Budget, load_policy
import run_r1
from run_results import stage_result, source_hash


def read(path):
    return json.loads(path.read_text(encoding='utf-8'))


def inspect_parent(parent, repair_relocation=False, review_correction=False, design_amendment=False):
    parent = Path(parent).resolve()
    recovery = read(parent / 'design-recovery.json') if (parent / 'design-recovery.json').exists() else None
    if repair_relocation or review_correction or (design_amendment and recovery):
        if not recovery or (repair_relocation and recovery.get('lifecycle_relocation')) or (review_correction and recovery.get('review_correction')) or (design_amendment and recovery.get('design_amendment')):
            raise ValueError('Not an unmigrated lifecycle recovery')
        verify_review_only(parent)
        for name, digest in recovery['parent_evidence'].items():
            if run_r1.sha(Path(name)) != digest:
                raise ValueError('Original recovery evidence changed')
    elif recovery:
        raise ValueError('Recovery cannot be chained')
    completion = read(parent / 'completion.json')
    policy = load_policy(parent / 'budget-policy.json')
    with sqlite3.connect(f'file:{(parent / "budget.sqlite").as_posix()}?mode=ro', uri=True) as db:
        state = json.loads(db.execute('SELECT body FROM ledger WHERE id=1').fetchone()[0])
    if state != completion['budget']:
        raise ValueError('Completion and ledger differ')
    if completion['model'] != run_r1.MODEL or completion['variant'] != run_r1.VARIANT:
        raise ValueError('Model profile differs')
    if state['stop_reason'] != (None if recovery and (repair_relocation or review_correction or design_amendment) else 'design_revision_limit_reached'):
        raise ValueError('Only exhausted author / remaining review recovery is supported')
    maximum = 1 + policy['max_design_revisions']
    counts = state['counts']
    if counts.get('role:design:specart-author') != maximum or not 0 < counts.get('role:design:specart-spec-review', 0) < maximum:
        raise ValueError('No exhausted-author / remaining-review boundary')
    if any(k.startswith(('role:coding:', 'role:prd:', 'repairs:')) for k in counts):
        raise ValueError('Development already started')
    if not completion['phases'] or not all(p.get('cleanup_confirmed') for p in completion['phases']):
        raise ValueError('Parent process cleanup unconfirmed')
    if completion['results'].get('container_cleanup', {}).get('status') == 'unconfirmed':
        raise ValueError('Parent container cleanup unconfirmed')
    run = run_r1.run_directory(parent)
    states = stage_result(run, 'design')['states']
    if any(states[k] != 'passed' for k in ['prd', 'sd', 'change']) or states['specart'] == 'passed':
        raise ValueError('Expected completed documents and unaccepted specification')
    # This recovery handles a pre-acceptance design, not relocation of accepted identities.
    spec = run / 'output/06-Spec骨架/.specart'
    if {p.name for p in spec.iterdir()} != {'specart.yaml', 'summary.yaml'}:
        raise ValueError('Unexpected lifecycle state; cannot relocate safely')
    config = (spec / 'specart.yaml').read_text(encoding='utf-8')
    if 'project_root: ../../../repos/main' not in config:
        raise ValueError('Unsupported specification project binding')
    return state, policy


def evidence_files(parent):
    run = run_r1.run_directory(parent)
    files = [parent / name for name in ['completion.json', 'budget.sqlite', 'budget-policy.json', 'requirement.md']]
    for folder in [run / 'output', run / 'repos', run / 'logs']:
        files.extend(p for p in folder.rglob('*') if p.is_file())
    return {str(p): run_r1.sha(p) for p in files}


def relocate_open_design(old_run, new_run):
    """Rebind only an unaccepted task's locations, preserving its real baseline."""
    suffix = 'output/06-Spec骨架/.specart'
    old_spec, new_spec = (old_run / suffix).resolve(), (new_run / suffix).resolve()
    old_project, new_project = (old_run / 'repos/main').resolve(), (new_run / 'repos/main').resolve()
    # Same canonical JSON encoding as upstream canonical.hash_object.
    def key(spec):
        return hashlib.sha256(json.dumps(str(spec), ensure_ascii=False, sort_keys=True,
                                         separators=(',', ':')).encode()).hexdigest()[:16]
    original = old_project / '.specart-verify' / key(old_spec) / 'before.json'
    state = read(original)
    if state.get('project') != str(old_project) or state.get('spec') != str(old_spec):
        raise ValueError('Original lifecycle identity mismatch')
    if not state.get('design_open') or original.with_name('accepted.json').exists():
        raise ValueError('Only unaccepted open design may be relocated')
    if state.get('language') != 'go' or state.get('ui') != 'none' or not state.get('task_id') or not isinstance(state.get('sources'), dict):
        raise ValueError('Incomplete original lifecycle evidence')
    target = new_project / '.specart-verify' / key(new_spec) / 'before.json'
    if target.exists():
        raise ValueError('Destination lifecycle identity already exists')
    rebound = {**state, 'project': str(new_project), 'spec': str(new_spec)}
    target.parent.mkdir(parents=True, exist_ok=True)
    run_r1.write_json(target, rebound)
    return {'original': str(original), 'original_sha256': run_r1.sha(original),
            'target': str(target), 'target_sha256': run_r1.sha(target),
            'changed_fields': ['project', 'spec'], 'task_id': state['task_id']}


def amendment_policy(policy):
    result = copy.deepcopy(policy)
    result['policy_version'] = policy['policy_version'] + '-amendment-1'
    result['max_design_revisions'] += 1
    return result


def import_ledger(path, state, policy, parent, parent_policy=None):
    if path.exists():
        raise ValueError('Refusing to overwrite a ledger')
    derived = copy.deepcopy(state)
    if parent_policy is not None:
        if policy != amendment_policy(parent_policy):
            raise ValueError('Only one additional design revision is allowed')
        before_hash = hashlib.sha256(json.dumps(parent_policy, sort_keys=True).encode()).hexdigest()
        if before_hash != state['policy_hash']:
            raise ValueError('Parent policy identity differs')
        derived['policy_hash'] = hashlib.sha256(json.dumps(policy, sort_keys=True).encode()).hexdigest()
        derived['events'].append({'kind': 'explicit_single_design_amendment',
                                  'previous_policy_hash': before_hash, 'policy_hash': derived['policy_hash']})
    # The parent's terminal reason remains immutable. The derived ledger records
    # this explicit transition; all counts, admissions and original times survive.
    derived['recovery'] = {'parent': str(parent), 'prior_stop_reason': state['stop_reason'],
                           'mode': 'remaining_reviews_only'}
    derived['events'].append({'kind': 'explicit_design_review_recovery', **derived['recovery']})
    derived['stop_reason'] = None
    ledger = Budget(path, policy)
    ledger._change(lambda s: s.update(derived))
    ledger.initialize()  # Validates the preserved policy identity; does not reset.
    return derived


def prepare_recovery(parent, repair_relocation=False, review_correction=None, design_amendment=None):
    if sum(map(bool, [repair_relocation, review_correction, design_amendment])) > 1:
        raise ValueError('Select one explicit recovery mode')
    parent = Path(parent).resolve()
    state, policy = inspect_parent(parent, repair_relocation, bool(review_correction), bool(design_amendment))
    if policy != load_policy():
        raise ValueError('Recovery must preserve the exact count policy')
    evidence = evidence_files(parent)
    # A sibling claim is deliberately outside the immutable parent evidence.
    claim = parent.with_name(parent.name + '.design-review-recovery.json')
    with claim.open('x', encoding='utf-8') as out:
        json.dump({'parent': str(parent), 'status': 'preparing'}, out)
    number = read(parent / 'round.json')['round']
    root = run_r1.freeze(number, parent / 'baseline', parent / 'requirement.md', parent / 'runtime')
    old, run = run_r1.run_directory(parent), run_r1.run_directory(root)
    for name in ['output', 'repos']:
        shutil.copytree(old / name, run / name, dirs_exist_ok=True)
    lifecycle_source = run_r1.run_directory(Path(read(parent / 'design-recovery.json')['parent'])) if repair_relocation else old
    lifecycle = relocate_open_design(lifecycle_source, run)
    (run / 'logs').mkdir(exist_ok=True)
    for role in ['prd', 'sd', 'change']:
        shutil.copy2(old / 'logs' / f'{role}.state.json', run / 'logs' / f'{role}.state.json')
    config = read(run / 'workflow-cli.json')
    config['skills']['specart']['prompt_template'] += (
        '\n显式设计复审恢复：PRD/SD/change 与源码/summary 原样继承，作者初稿及5次修订已耗尽。'
        '先读取 DESIGN-RECOVERY.md，然后委派独立 specart-spec-review 全范围审查当前规格。'
        '不得重新生成文档、修改产品源码或summary或调用Author。可以执行原生命周期命令绑定并验收现有设计。'
        '若复审通过，执行原有机械验证和accept-design，写实际verdict；若发现真实规格缺口则停止并报告。'
        '纠正执行说明不会自动使规格通过。')
    if review_correction:
        (run / 'REVIEW-CORRECTION.md').write_text(Path(review_correction).read_text(encoding='utf-8'), encoding='utf-8')
        config['skills']['specart']['prompt_template'] += '\n先读取 REVIEW-CORRECTION.md，并将其中已定位的审查分类问题完整传给独立Reviewer核对；这不是PASS指令，仍须全范围独立审查。'
    if design_amendment:
        # Replace the recovery-only restriction: this explicit, recorded policy
        # transition authorizes exactly one more Author task, not a new budget.
        config['skills']['specart']['prompt_template'] = config['skills']['specart']['prompt_template'].split('\n显式设计复审恢复：')[0]
        (run / 'DESIGN-AMENDMENT.md').write_text(Path(design_amendment).read_text(encoding='utf-8'), encoding='utf-8')
        config['skills']['specart']['prompt_template'] += '\n读取 DESIGN-AMENDMENT.md。当前恢复保留全部计数，显式增加一次Author修订；按该审查反馈补齐契约，之后调用独立Reviewer并执行原机械验收。不得重新生成PRD/SD/change或实现函数体。'
    run_r1.write_json(run / 'workflow-cli.json', config)
    note = ('# Explicit pre-acceptance design review recovery\n\n'
            f'Parent evidence: {parent.as_posix()}\n\n'
            'All document and specification artifacts are inherited unchanged. Original author '
            f'calls: {state["counts"]["role:design:specart-author"]}; original independent review calls: '
            f'{state["counts"]["role:design:specart-spec-review"]}. Counts and limits are inherited. '
            'No additional author repair is authorized. This is a new orchestration session with '
            'recorded runtime lineage, not restoration of the old model conversation. Read '
            'ADAPTER-CONTEXT.md and independently review the complete current specification. '
            'An existing pending-update body is implemented later; any actual contract gap still blocks.\n')
    (run / 'DESIGN-RECOVERY.md').write_text(note, encoding='utf-8')
    parent_policy = policy if design_amendment else None
    if design_amendment:
        policy = amendment_policy(policy)
        for target in [root / 'budget-policy.json', run / 'budget-policy.json']:
            run_r1.write_json(target, policy)
        (run / 'DESIGN-RECOVERY.md').write_text(
            '# Explicit bounded design amendment\n\nPrior artifacts and all counters are inherited. '
            'Read DESIGN-AMENDMENT.md. Exactly one additional Author revision is authorized; '
            'the actual admission ledger enforces it. Normal independent review and acceptance remain required.\n', encoding='utf-8')
    inherited = import_ledger(root / 'budget.sqlite', state, policy, parent, parent_policy)
    metadata = {'parent': str(parent), 'parent_evidence': evidence,
                'infrastructure_repair': 'lifecycle_path_relocation' if repair_relocation else None,
                'review_correction': bool(review_correction),
                'design_amendment': bool(design_amendment),
                'policy_adjustment': {'before': parent_policy, 'after': policy} if design_amendment else None,
                'lifecycle_relocation': lifecycle,
                'source_hash': source_hash(run / 'repos/main'),
                'inherited_budget': inherited, 'mode': 'remaining_reviews_only',
                'artifact_hashes': {p.relative_to(run).as_posix(): run_r1.sha(p)
                    for folder in [run / 'output', run / 'repos'] for p in folder.rglob('*') if p.is_file()}}
    run_r1.write_json(root / 'design-recovery.json', metadata)
    provenance = read(root / 'provenance.json')
    for p in [root / 'design-recovery.json', run / 'workflow-cli.json', run / 'DESIGN-RECOVERY.md']:
        provenance['runtime_files'][p.relative_to(root).as_posix()] = run_r1.sha(p)
    if review_correction:
        provenance['runtime_files'][(run / 'REVIEW-CORRECTION.md').relative_to(root).as_posix()] = run_r1.sha(run / 'REVIEW-CORRECTION.md')
    if design_amendment:
        for p in [run / 'DESIGN-AMENDMENT.md', run / 'budget-policy.json', root / 'budget-policy.json']:
            provenance['runtime_files'][p.relative_to(root).as_posix()] = run_r1.sha(p)
        provenance['budget_policy_sha256'] = run_r1.sha(root / 'budget-policy.json')
    provenance['workflow_sha256'] = run_r1.sha(run / 'workflow-cli.json')
    provenance['recovery_parent'] = str(parent)
    run_r1.write_json(root / 'provenance.json', provenance)
    verify_prelaunch(root)
    run_r1.write_json(claim, {'parent': str(parent), 'root': str(root), 'status': 'prepared'})
    return root


def verify_prelaunch(root, filename='design-recovery.json'):
    metadata = read(root / filename)
    for name, digest in metadata['parent_evidence'].items():
        if run_r1.sha(Path(name)) != digest:
            raise ValueError('Recovery parent evidence changed: ' + name)
    run = run_r1.run_directory(root)
    for name, digest in metadata['artifact_hashes'].items():
        if run_r1.sha(run / name) != digest:
            raise ValueError('Recovery artifact changed: ' + name)
    ledger = Budget(root / 'budget.sqlite', load_policy(root / 'budget-policy.json'))
    if ledger.snapshot() != metadata['inherited_budget']:
        raise ValueError('Recovery budget changed before launch')


def verify_review_only(root):
    metadata = read(root / 'design-recovery.json')
    run = run_r1.run_directory(root)
    if not metadata.get('design_amendment') and source_hash(run / 'repos/main') != metadata['source_hash']:
        raise ValueError('Review recovery changed product source')
    for name, digest in metadata['artifact_hashes'].items():
        if metadata.get('design_amendment') and '/.specart/' in name:
            continue  # Original SDD design gates validate the authorized change.
        if name.startswith('output/') and name != 'output/06-Spec骨架/verdict.md' and not name.endswith('.verdict.md'):
            if run_r1.sha(run / name) != digest:
                raise ValueError('Review recovery changed inherited specification/document: ' + name)


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('parent')
    parser.add_argument('--repair-relocation', action='store_true')
    parser.add_argument('--review-correction')
    parser.add_argument('--design-amendment')
    args = parser.parse_args()
    print(prepare_recovery(args.parent, args.repair_relocation, args.review_correction, args.design_amendment))
