"""Process the pending R7 executor-return batch alone, on a copy of the R7 checkpoint store.

Management model calls only: no new input, executor or verifier. The R7 checkpoint and the
online R7 run are not modified. Budget changes are made only on the copy and recorded:
per-batch counter reset to 0 (cap 8) and cumulative cap = used + 3 batches x 8.
"""
import hashlib, json, shutil, subprocess, uuid
from datetime import datetime, timezone
from pathlib import Path

PROJECT = Path(__file__).resolve().parents[4]
BASE = Path(r'D:\huawei\EvoCodeBench')
PARENT = 'intent-luna-dpipe-full-r1r5-20261002-053740-e6308341'
R7 = 'intent-luna-dpipe-online-r7-20261005-113014z-b62ae6c0'
CKPT = BASE / 'harbor_checkpoints' / R7 / 'round-07'
TEMPLATE = BASE / 'management_runs/intent-luna-dpipe-offline-r6-20261005-022517z-26bb5f'  # host overlay, model config, launch recipe
PER_BATCH, BATCHES = 8, 3  # R7 return batch, R8 user batch, R8 return batch

def read(p): return json.loads(p.read_text(encoding='utf-8'))
def save(p, x): p.write_text(json.dumps(x, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
def sha(p):
    with p.open('rb') as f: return hashlib.file_digest(f, 'sha256').hexdigest()
def git(*a): return subprocess.check_output(['git', *a], cwd=PROJECT, text=True).strip()

HEAD = git('rev-parse', 'HEAD')
assert git('branch', '--show-current') == 'intent-delivery-projection'
assert not git('status', '--porcelain', '--', 'src', 'test', 'package.json', 'package-lock.json', 'tsconfig.json', 'tsconfig.build.json')

record = read(CKPT / 'record.json')
source = CKPT / 'compiler-store/v2-runs' / PARENT
for n, h in record['hashes'].items(): assert sha(source / n) == h, n
baseline = read(source / 'snapshot.json')
used = baseline['budget']['total_management_requests']
assert used == len(baseline['management_calls']) == 43
assert baseline['pending_event_ids'] == ['execution-292:return'] and not baseline['unresolved_user_event_ids']
assert len(baseline['executions']) == 7 and all(e['status'] == 'closed' for e in baseline['executions'])
assert len(baseline['dispatches']) == 8 and baseline['dispatches'][-1]['dispatch_id'] == 'dispatch-291'
total_cap = used + BATCHES * PER_BATCH

rid = f'intent-luna-dpipe-pending-r7return-{datetime.now(timezone.utc):%Y%m%d-%H%M%S}z-{uuid.uuid4().hex[:6]}'
run = BASE / 'management_runs' / rid
run.mkdir(parents=True, exist_ok=False)
for name in ['provenance', 'model', 'host-config', 'host-data', 'host-cache', 'calls']: (run / name).mkdir()
store = run / 'compiler-store/v2-runs' / PARENT
shutil.copytree(source, store)
save(run / 'provenance/checkpoint-store-hashes.json', {p.name: sha(p) for p in source.iterdir() if p.is_file()})
copied = read(store / 'snapshot.json')
copied['budget']['management_requests'] = 0
copied['budget']['max_management_requests'] = PER_BATCH
copied['budget']['max_total_management_requests'] = total_cap
save(store / 'snapshot.json', copied)
save(run / 'provenance/budget-only-change.json', {'used_calls': used, 'old_cumulative_cap': baseline['budget']['max_total_management_requests'],
    'new_cumulative_cap': total_cap, 'old_batch_counter': baseline['budget']['management_requests'], 'new_batch_counter': 0,
    'per_batch_cap': PER_BATCH, 'note': 'Only the copy changes; source checkpoint untouched.'})

rt = run / 'intent-compiler-runtime'; rt.mkdir()
shutil.copytree(TEMPLATE / 'intent-compiler-runtime/node_modules', rt / 'node_modules')
shutil.copyfile(TEMPLATE / 'intent-compiler-runtime/package.json', rt / 'package.json')
shutil.copytree(PROJECT / 'src', rt / 'src')
shutil.copyfile(PROJECT / 'tsconfig.json', rt / 'tsconfig.json')
shutil.copyfile(PROJECT / 'tsconfig.build.json', rt / 'tsconfig.build.json')
build = ['node', str(PROJECT / 'node_modules/typescript/bin/tsc'), '-p', str(rt / 'tsconfig.build.json')]
done = subprocess.run(build, capture_output=True, text=True)
(run / 'provenance/build.log').write_text(done.stdout + done.stderr, encoding='utf-8')
save(run / 'provenance/build-command.json', {'argv': build, 'exit_code': done.returncode})
assert done.returncode == 0, 'runtime build failed'
src_hashes = {f.relative_to(rt).as_posix(): sha(f) for f in sorted((rt / 'src').rglob('*.ts'))}
for f in sorted((PROJECT / 'src').rglob('*.ts')):
    assert sha(f) == src_hashes['src/' + f.relative_to(PROJECT / 'src').as_posix()]
save(run / 'provenance/source-identity.json', {'head': HEAD, 'dirty_src_test': [], 'src_hashes': src_hashes,
    'runtime_dist_sha256': {f.relative_to(rt / 'dist').as_posix(): sha(f) for f in sorted((rt / 'dist').rglob('*.js'))}})

shutil.copytree(TEMPLATE / 'host-session-overlay', run / 'host-session-overlay')
for name in ['advance-pending.mjs', 'offline-review-guard.mjs', 'prepare-pending-r7return.py']:
    shutil.copyfile(Path(__file__).parent / name, run / name)
shutil.copyfile(TEMPLATE / 'model/opencode.json', run / 'model/opencode.json')
shutil.copyfile(TEMPLATE / 'start-management-host.sh', run / 'start-management-host.sh')
cfg = read(TEMPLATE / 'run.json')
cfg.update(run_id=rid, scope='R7 pending return batch only; no new input, executor or verifier',
           history_management_calls=used, max_total_management_requests=total_cap, new_management_limit=PER_BATCH,
           pending_event_id='execution-292:return', source_identity={'head': HEAD, 'dirty': False, 'dirty_files': []})
cfg.pop('initial_event_file', None)
save(run / 'run.json', cfg)
launch = read(TEMPLATE / 'provenance/host-launch-command.json')
container = 'offline-pr7-' + rid.rsplit('-', 1)[-1]
launch['argv'] = [v.replace(str(TEMPLATE), str(run)).replace('offline-r6-26bb5f', container) for v in launch['argv']]
launch['container'] = container
save(run / 'provenance/host-launch-command.json', launch)
save(run / 'provenance/generation-launch-command.json', {'argv': ['docker', 'exec', '--detach', container, '/bin/sh', '-c',
    '/opt/opencode-bun/bun /opt/offline/advance-pending.mjs > /opt/offline/generation.log 2>&1'], 'one_batch': True})
save(run / 'progress.json', {'status': 'prepared', 'new_calls_reserved': 0})
print(json.dumps({'prepared': str(run), 'container': container, 'paid_calls': 0, 'cumulative_cap': total_cap}))
