"""Prepare R5 from sealed R4 management state; never invent an execution return."""
import difflib, hashlib, json, shutil, subprocess, uuid
from datetime import datetime, timezone
from pathlib import Path

PROJECT = Path(__file__).resolve().parents[4]
BASE = Path(r'D:\huawei\EvoCodeBench')
R4 = BASE / 'management_runs/intent-luna-dpipe-offline-r4-20261002-192524z-bf65e1'
BASE_SHA = '751c4d10aceb0597ef52b247d69696db1ae5685c'  # historical R4 runtime build

def read(p): return json.loads(p.read_text(encoding='utf-8'))
def save(p, x): p.write_text(json.dumps(x, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
def sha(p):
    with p.open('rb') as f: return hashlib.file_digest(f, 'sha256').hexdigest()

def git(*a): return subprocess.check_output(['git', *a], cwd=PROJECT, text=True)
HEAD = git('rev-parse', 'HEAD').strip()
DIRTY = git('status', '--porcelain', '--', 'src', 'test').strip().splitlines()
# Verify all three frozen R4 artifacts before copying their supporting state.
manifest = {line.split('  ', 1)[1]: line.split('  ', 1)[0]
            for line in (R4 / 'SHA256SUMS.txt').read_text(encoding='utf-8').splitlines()}
for name in ['artifacts/ir.json', 'artifacts/compiled.json', 'artifacts/atoms.json']:
    assert sha(R4 / name) == manifest[name]
cfg = read(R4 / 'run.json')
parent = cfg['parent_run_id']
source = R4 / 'compiler-store/v2-runs' / parent
baseline = read(source / 'snapshot.json')
assert baseline['ir'] == read(R4 / 'artifacts/ir.json')
assert baseline['compiled'] == read(R4 / 'artifacts/compiled.json')
assert baseline['budget']['total_management_requests'] == len(baseline['management_calls']) == 19
assert len(baseline['executions']) == 2
assert baseline['execution_outcomes'] == read(R4 / 'provenance/R3-original-snapshot.json')['execution_outcomes']
assert not baseline['pending_event_ids'] and not baseline['unresolved_user_event_ids']
assert read(R4 / 'artifacts/status.json')['actually_delivered'] is False
rid = f'intent-luna-dpipe-offline-r5-{datetime.now(timezone.utc):%Y%m%d-%H%M%S}z-{uuid.uuid4().hex[:6]}'
run = BASE / 'management_runs' / rid
run.mkdir(parents=True, exist_ok=False)
for name in ['provenance', 'model', 'host-config', 'host-data', 'host-cache', 'calls']:
    (run / name).mkdir()
store = run / 'compiler-store/v2-runs' / parent
shutil.copytree(source, store)
save(run / 'provenance/R4-store-original-hashes.json', {p.name: sha(p) for p in source.iterdir() if p.is_file()})
shutil.copyfile(source / 'snapshot.json', run / 'provenance/R4-original-snapshot.json')
shutil.copytree(R4 / 'artifacts', run / 'provenance/R4-frozen-artifacts')
baseline['budget']['max_management_requests'] = 8
baseline['budget']['max_total_management_requests'] = 27
save(store / 'snapshot.json', baseline)
save(run / 'provenance/budget-only-change.json', {'F2_history_calls': 10, 'R3_history_calls': 6, 'R4_history_calls': 3,
    'new_R5_limit': 8, 'old_absolute_limit': 24, 'new_absolute_limit': 27,
    'note': 'Only the independent copy changes. R4 proposed dispatch is retained; no R4 execution or outcome exists.'})
for name in ['F2-record.json', 'host-budget-guard.diff']:
    shutil.copyfile(R4 / 'provenance' / name, run / 'provenance' / name)
shutil.copytree(R4 / 'intent-compiler-runtime', run / 'intent-compiler-runtime')
# Rebuild the runtime from the actual working-tree src (HEAD + dirty edits); the R4 dist is kept as dist-base-751.
rt = run / 'intent-compiler-runtime'
(rt / 'dist').rename(rt / 'dist-base-751')
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
save(run / 'provenance/source-identity.json', {'head': HEAD, 'base_runtime_commit': BASE_SHA, 'dirty_src_test': DIRTY,
    'diff_src_test_sha256': hashlib.sha256(git('diff', 'HEAD', '--', 'src', 'test').encode()).hexdigest(),
    'src_hashes': src_hashes, 'runtime_dist_sha256': {f.relative_to(rt / 'dist').as_posix(): sha(f) for f in sorted((rt / 'dist').rglob('*.js'))}})
shutil.copytree(R4 / 'host-session-overlay', run / 'host-session-overlay')
for name in ['offline-management-r3.mjs', 'offline-review-guard.mjs', 'prepare-offline-r5.py']:
    shutil.copyfile(Path(__file__).parent / name, run / name)
shutil.copyfile(R4 / 'model/opencode.json', run / 'model/opencode.json')
shutil.copyfile(R4 / 'start-management-host.sh', run / 'start-management-host.sh')
instruction = PROJECT / 'experiments/evocode/harbor/dpipe/records/2026-10-02-prepared-r3-r15/sources/round-05.txt'
shutil.copyfile(instruction, run / 'r5-original.txt')
event = {'schema_version': 2, 'run_id': parent, 'event_id': parent + ':preparation:r5:' + sha(instruction)[:16],
    'kind': 'user_input', 'source': {'producer_id': 'offline-preparation', 'channel': 'user'},
    'payload': {'text': instruction.read_text(encoding='utf-8'), 'source': {'round': 5,
        'source_category': 'incremental_change', 'source_file': str(instruction), 'preparation_only': True,
        'prior_management_round': 4, 'latest_executed_round': 2, 'round_3_executed': False, 'round_4_executed': False}}}
save(run / 'initial-r5-event.json', event)
cfg.update(run_id=rid, source_identity={'head': HEAD, 'dirty': bool(DIRTY), 'dirty_files': DIRTY, 'frozen_source_directory': '/opt/offline/intent-compiler-runtime/src', 'note': 'Runtime dist rebuilt from working-tree src; not committed.'}, scope='R5 management preparation only; R4 unexecuted; no executor or verifier',
           history_management_calls=19, initial_event_file='initial-r5-event.json')
save(run / 'run.json', cfg)
launch = read(R4 / 'provenance/host-launch-command.json')
container = 'offline-r5-' + rid.rsplit('-', 1)[-1]
launch['argv'] = [v.replace(str(R4), str(run)).replace('offline-r4-bf65e1', container) for v in launch['argv']]
launch['container'] = container
save(run / 'provenance/host-launch-command.json', launch)
generation = {'argv': ['docker', 'exec', '--detach', container, '/bin/sh', '-c',
    '/opt/opencode-bun/bun /opt/offline/offline-management-r3.mjs > /opt/offline/generation.log 2>&1'],
    'one_batch': True, 'max_new_calls': 8, 'human_review_pause': False}
save(run / 'provenance/generation-launch-command.json', generation)
diff = ''.join(difflib.unified_diff((R4 / 'offline-management-r3.mjs').read_text(encoding='utf-8').splitlines(True),
    (run / 'offline-management-r3.mjs').read_text(encoding='utf-8').splitlines(True),
    fromfile='R4/offline-management-r3.mjs', tofile='R5/offline-management-r3.mjs'))
(run / 'provenance/driver-vs-R4.diff').write_text(diff, encoding='utf-8')
save(run / 'provenance/launch-file-hashes.json', {name: sha(run / name) for name in
    ['offline-management-r3.mjs', 'offline-review-guard.mjs', 'prepare-offline-r5.py',
     'initial-r5-event.json', 'model/opencode.json', 'host-session-overlay/llm.ts']})
save(run / 'progress.json', {'status': 'prepared', 'new_calls_reserved': 0, 'round': 5})
save(PROJECT / '.scratch/offline-r5-current.json', {'run': str(run), 'container': container})
save(PROJECT / '.scratch/r5-generation-status.json', {'status': 'prepared',
    'updated_at': datetime.now(timezone.utc).isoformat(), 'run_directory': str(run),
    'progress_file': str(run / 'progress.json'), 'new_calls_used': 0, 'max_new_calls': 8,
    'note': 'Read progress_file for live stage. R4 is prepared but unexecuted; no success fabricated.'})
print(json.dumps({'prepared': str(run), 'container': container, 'paid_calls': 0}))
