"""Prepare R6 from the R5-I management state; never invent an execution return."""
import hashlib, json, shutil, subprocess, uuid
from datetime import datetime, timezone
from pathlib import Path

PROJECT = Path(__file__).resolve().parents[4]
BASE = Path(r'D:\huawei\EvoCodeBench')
R5 = BASE / 'management_runs/intent-luna-dpipe-offline-r5-20261005-020226z-444c88'
RECORDS = Path(__file__).parent / 'records/2026-10-02-prepared-r3-r15'
BASE_SHA = '751c4d10aceb0597ef52b247d69696db1ae5685c'  # historical R4 runtime build

def read(p): return json.loads(p.read_text(encoding='utf-8'))
def save(p, x): p.write_text(json.dumps(x, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
def sha(p):
    with p.open('rb') as f: return hashlib.file_digest(f, 'sha256').hexdigest()
def git(*a): return subprocess.check_output(['git', *a], cwd=PROJECT, text=True)

HEAD = git('rev-parse', 'HEAD').strip()
assert git('branch', '--show-current').strip() == 'intent-delivery-projection'
DIRTY = git('status', '--porcelain', '--', 'src', 'test').strip().splitlines()
assert not DIRTY, f'src/test must be clean: {DIRTY}'

allow = read(RECORDS / 'round-06/input-allowlist.json')
for s in allow['sources']:
    p = RECORDS / s['file']
    assert sha(p) == s['sha256'] and p.stat().st_size == s['utf8_bytes'], f"allowlist mismatch: {s['file']}"
instruction = RECORDS / 'sources/round-06.txt'

cfg = read(R5 / 'run.json')
parent = cfg['parent_run_id']
source = R5 / 'compiler-store/v2-runs' / parent
baseline = read(source / 'snapshot.json')
assert baseline['ir'] == read(R5 / 'artifacts/ir.json')
assert baseline['compiled'] == read(R5 / 'artifacts/compiled.json')
status = read(R5 / 'artifacts/status.json')
assert status['actually_delivered'] is False and status['executor_started'] is False
atoms5 = read(R5 / 'artifacts/atoms.json')
assert len(atoms5) == 1 and atoms5[0]['atom_id'] == 'a-dpipe' and atoms5[0]['revision'] == 4
assert baseline['budget']['total_management_requests'] == len(baseline['management_calls']) == 22
assert len(baseline['executions']) == 2 and len(baseline['execution_outcomes']) == 2
assert not baseline['pending_event_ids'] and not baseline['unresolved_user_event_ids']

rid = f'intent-luna-dpipe-offline-r6-{datetime.now(timezone.utc):%Y%m%d-%H%M%S}z-{uuid.uuid4().hex[:6]}'
run = BASE / 'management_runs' / rid
run.mkdir(parents=True, exist_ok=False)
for name in ['provenance', 'model', 'host-config', 'host-data', 'host-cache', 'calls']:
    (run / name).mkdir()
store = run / 'compiler-store/v2-runs' / parent
shutil.copytree(source, store)
save(run / 'provenance/R5-store-original-hashes.json', {p.name: sha(p) for p in source.iterdir() if p.is_file()})
shutil.copyfile(source / 'snapshot.json', run / 'provenance/R5-original-snapshot.json')
shutil.copytree(R5 / 'artifacts', run / 'provenance/R5-frozen-artifacts')
copied = read(store / 'snapshot.json')
assert copied['ir'] == read(run / 'provenance/R5-frozen-artifacts/ir.json')
assert copied['compiled'] == read(run / 'provenance/R5-frozen-artifacts/compiled.json')
baseline['budget']['max_management_requests'] = 8
baseline['budget']['max_total_management_requests'] = 30
save(store / 'snapshot.json', baseline)
save(run / 'provenance/budget-only-change.json', {'history_calls': 22, 'new_R6_limit': 8,
    'old_absolute_limit': 27, 'new_absolute_limit': 30,
    'note': 'Only the independent copy changes. R5-I proposed dispatch is retained; no R5/R6 execution or outcome exists.'})
for name in ['F2-record.json', 'host-budget-guard.diff']:
    shutil.copyfile(R5 / 'provenance' / name, run / 'provenance' / name)

# Runtime: R5-I node_modules/package.json; src and dist rebuilt from the clean working tree.
rt = run / 'intent-compiler-runtime'
rt.mkdir()
shutil.copytree(R5 / 'intent-compiler-runtime/node_modules', rt / 'node_modules')
shutil.copyfile(R5 / 'intent-compiler-runtime/package.json', rt / 'package.json')
shutil.copytree(PROJECT / 'src', rt / 'src')
shutil.copyfile(PROJECT / 'tsconfig.json', rt / 'tsconfig.json')
shutil.copyfile(PROJECT / 'tsconfig.build.json', rt / 'tsconfig.build.json')
build = ['node', str(PROJECT / 'node_modules/typescript/bin/tsc'), '-p', str(rt / 'tsconfig.build.json')]
done = subprocess.run(build, capture_output=True, text=True)
(run / 'provenance/build.log').write_text(done.stdout + done.stderr, encoding='utf-8')
save(run / 'provenance/build-command.json', {'argv': build, 'exit_code': done.returncode})
assert done.returncode == 0, 'runtime build failed; see provenance/build.log'
src_hashes = {f.relative_to(rt).as_posix(): sha(f) for f in sorted((rt / 'src').rglob('*.ts'))}
for f in sorted((PROJECT / 'src').rglob('*.ts')):
    assert sha(f) == src_hashes['src/' + f.relative_to(PROJECT / 'src').as_posix()]
save(run / 'provenance/source-identity.json', {'head': HEAD, 'branch': 'intent-delivery-projection',
    'base_runtime_commit': BASE_SHA, 'dirty_src_test': DIRTY, 'src_hashes': src_hashes,
    'runtime_dist_sha256': {f.relative_to(rt / 'dist').as_posix(): sha(f) for f in sorted((rt / 'dist').rglob('*.js'))}})

shutil.copytree(R5 / 'host-session-overlay', run / 'host-session-overlay')
for name in ['offline-management-r3.mjs', 'offline-review-guard.mjs', 'prepare-offline-r6.py']:
    shutil.copyfile(Path(__file__).parent / name, run / name)
shutil.copyfile(R5 / 'model/opencode.json', run / 'model/opencode.json')
shutil.copyfile(R5 / 'start-management-host.sh', run / 'start-management-host.sh')
shutil.copyfile(instruction, run / 'r6-original.txt')
event = {'schema_version': 2, 'run_id': parent, 'event_id': parent + ':preparation:r6:' + sha(instruction)[:16],
    'kind': 'user_input', 'source': {'producer_id': 'offline-preparation', 'channel': 'user'},
    'payload': {'text': instruction.read_text(encoding='utf-8'), 'source': {'round': 6,
        'source_category': 'incremental_change', 'source_file': str(instruction), 'preparation_only': True,
        'prior_management_round': 5, 'latest_executed_round': 2, 'round_3_executed': False,
        'round_4_executed': False, 'round_5_executed': False}}}
save(run / 'initial-r6-event.json', event)
cfg.update(run_id=rid, scope='R6 management preparation only; R3-R5 unexecuted; no executor or verifier',
           history_management_calls=22, initial_event_file='initial-r6-event.json',
           source_identity={'head': HEAD, 'dirty': False, 'dirty_files': [],
                            'frozen_source_directory': '/opt/offline/intent-compiler-runtime/src',
                            'note': 'Runtime dist rebuilt from the clean working tree.'})
cfg.pop('new_management_limit', None); cfg['new_management_limit'] = 8
save(run / 'run.json', cfg)
launch = read(R5 / 'provenance/host-launch-command.json')
container = 'offline-r6-' + rid.rsplit('-', 1)[-1]
launch['argv'] = [v.replace(str(R5), str(run)).replace('offline-r5-444c88', container) for v in launch['argv']]
launch['container'] = container
save(run / 'provenance/host-launch-command.json', launch)
save(run / 'provenance/generation-launch-command.json', {'argv': ['docker', 'exec', '--detach', container, '/bin/sh', '-c',
    '/opt/opencode-bun/bun /opt/offline/offline-management-r3.mjs > /opt/offline/generation.log 2>&1'],
    'one_batch': True, 'max_new_calls': 8, 'human_review_pause': False})
save(run / 'provenance/launch-file-hashes.json', {name: sha(run / name) for name in
    ['offline-management-r3.mjs', 'offline-review-guard.mjs', 'prepare-offline-r6.py',
     'initial-r6-event.json', 'model/opencode.json', 'host-session-overlay/llm.ts']})
save(run / 'progress.json', {'status': 'prepared', 'new_calls_reserved': 0, 'round': 6})
print(json.dumps({'prepared': str(run), 'container': container, 'paid_calls': 0}))
