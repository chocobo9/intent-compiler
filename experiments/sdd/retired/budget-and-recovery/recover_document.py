"""Resume an unmaterialized PRD using remaining document continuation budget."""
import argparse
import copy
from pathlib import Path

from budget import Budget, load_policy
from recover_design import read, evidence_files, verify_prelaunch
from run_results import source_hash, stage_result
import run_r1


def prepare_document_recovery(parent):
    parent = Path(parent).resolve()
    if (parent / 'document-recovery.json').exists():
        raise ValueError('Document recovery cannot be chained')
    completion = read(parent / 'completion.json')
    state = completion['budget']
    policy = load_policy(parent / 'budget-policy.json')
    if policy != load_policy() or state['stop_reason'] not in {None, 'document_output_interrupted'}:
        raise ValueError('Recovery requires unchanged policy and available budget')
    if Budget(parent / 'budget.sqlite', policy).snapshot() != state:
        raise ValueError('Parent ledger differs from completion')
    if completion['model'] != run_r1.MODEL or completion['variant'] != run_r1.VARIANT:
        raise ValueError('Model profile changed')
    if not all(p.get('cleanup_confirmed') for p in completion['phases']) or completion['results'].get('container_cleanup', {}).get('status') == 'unconfirmed':
        raise ValueError('Parent cleanup unconfirmed')
    old = run_r1.run_directory(parent)
    if any(stage_result(old, 'design')['states'].values()) or (old / 'output/02-澄清后PRD.md').exists():
        raise ValueError('This recovery only handles an unmaterialized initial PRD')
    if source_hash(old / 'repos/main') != source_hash(parent / 'baseline'):
        raise ValueError('Product baseline changed during document generation')
    if any(k.startswith('role:') for k in state['counts']):
        raise ValueError('Specification/development already started')
    if state['counts'].get('document_revisions', 0) >= policy['max_document_revisions']:
        raise ValueError('No document continuation budget remains')
    evidence = evidence_files(parent)
    claim = parent.with_name(parent.name + '.document-recovery.json')
    with claim.open('x', encoding='utf-8') as out:
        out.write('{"status":"preparing"}')
    root = run_r1.freeze(completion['round'], parent / 'baseline', parent / 'requirement.md', parent / 'runtime')
    run = run_r1.run_directory(root)
    ledger = Budget(root / 'budget.sqlite', policy)
    derived = copy.deepcopy(state)
    derived['events'].append({'kind': 'explicit_document_runtime_recovery', 'parent': str(parent),
                               'prior_stop_reason': state['stop_reason'],
                               'reason': 'unmaterialized oversized tool argument; bounded section writes'})
    derived['stop_reason'] = None
    ledger._change(lambda s: s.update(derived))
    ledger.initialize()
    ledger.admit_document_revision('prd')
    ledger._change(lambda s: s.update(document_recovery_admission={'role': 'prd', 'prepaid': True}))
    metadata = {'parent': str(parent), 'parent_evidence': evidence,
        'inherited_budget': ledger.snapshot(), 'artifact_hashes': {
            p.relative_to(run).as_posix(): run_r1.sha(p)
            for folder in [run / 'repos', run / 'output'] for p in folder.rglob('*') if p.is_file()},
        'mode': 'unmaterialized_prd_bounded_writes', 'old_model_session_restored': False}
    run_r1.write_json(root / 'document-recovery.json', metadata)
    provenance = read(root / 'provenance.json')
    provenance['runtime_files']['document-recovery.json'] = run_r1.sha(root / 'document-recovery.json')
    provenance['recovery_parent'] = str(parent)
    run_r1.write_json(root / 'provenance.json', provenance)
    verify_prelaunch(root, 'document-recovery.json')
    run_r1.write_json(claim, {'status': 'prepared', 'root': str(root), 'parent': str(parent)})
    return root


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('parent')
    print(prepare_document_recovery(parser.parse_args().parent))
