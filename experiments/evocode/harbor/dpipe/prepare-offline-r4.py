"""Prepare R4 from sealed R3 management state; never invent an execution return."""
import difflib, hashlib, json, shutil, subprocess, uuid
from datetime import datetime, timezone
from pathlib import Path

PROJECT = Path(__file__).resolve().parents[4]
BASE = Path(r'D:\huawei\EvoCodeBench')
R3 = BASE / 'management_runs/intent-luna-dpipe-offline-r3-20261002-164739z-5d90df'
SHA = '751c4d10aceb0597ef52b247d69696db1ae5685c'

def read(p): return json.loads(p.read_text(encoding='utf-8'))
def save(p, x): p.write_text(json.dumps(x, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
def sha(p):
    with p.open('rb') as f: return hashlib.file_digest(f, 'sha256').hexdigest()

assert subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=PROJECT, text=True).strip() == SHA
assert not subprocess.check_output(['git', 'diff', 'HEAD', '--', 'src'], cwd=PROJECT, text=True).strip()
# Verify all three frozen R3 artifacts before copying their supporting state.
manifest = {line.split('  ', 1)[1]: line.split('  ', 1)[0]
            for line in (R3 / 'SHA256SUMS.txt').read_text(encoding='utf-8').splitlines()}
for name in ['artifacts/ir.json', 'artifacts/compiled.json', 'artifacts/atoms.json']:
    assert sha(R3 / name) == manifest[name]
cfg = read(R3 / 'run.json')
parent = cfg['parent_run_id']
source = R3 / 'compiler-store/v2-runs' / parent
baseline = read(source / 'snapshot.json')
assert baseline['ir'] == read(R3 / 'artifacts/ir.json')
assert baseline['compiled'] == read(R3 / 'artifacts/compiled.json')
assert baseline['budget']['total_management_requests'] == len(baseline['management_calls']) == 16
assert len(baseline['executions']) == 2
assert baseline['execution_outcomes'] == read(R3 / 'provenance/F2-original-snapshot.json')['execution_outcomes']
assert not baseline['pending_event_ids'] and not baseline['unresolved_user_event_ids']
assert read(R3 / 'artifacts/status.json')['actually_delivered'] is False
rid = f'intent-luna-dpipe-offline-r4-{datetime.now(timezone.utc):%Y%m%d-%H%M%S}z-{uuid.uuid4().hex[:6]}'
run = BASE / 'management_runs' / rid
run.mkdir(parents=True, exist_ok=False)
for name in ['provenance', 'model', 'host-config', 'host-data', 'host-cache', 'calls']:
    (run / name).mkdir()
store = run / 'compiler-store/v2-runs' / parent
shutil.copytree(source, store)
save(run / 'provenance/R3-store-original-hashes.json', {p.name: sha(p) for p in source.iterdir() if p.is_file()})
shutil.copyfile(source / 'snapshot.json', run / 'provenance/R3-original-snapshot.json')
shutil.copytree(R3 / 'artifacts', run / 'provenance/R3-frozen-artifacts')
baseline['budget']['max_management_requests'] = 8
baseline['budget']['max_total_management_requests'] = 24
save(store / 'snapshot.json', baseline)
save(run / 'provenance/budget-only-change.json', {'F2_history_calls': 10, 'R3_history_calls': 6,
    'new_R4_limit': 8, 'old_absolute_limit': 18, 'new_absolute_limit': 24,
    'note': 'Only the independent copy changes. R3 proposed dispatch is retained; no R3 execution or outcome exists.'})
for name in ['runtime-byte-audit.json', 'F2-record.json', 'host-budget-guard.diff']:
    shutil.copyfile(R3 / 'provenance' / name, run / 'provenance' / name)
shutil.copytree(R3 / 'intent-compiler-runtime', run / 'intent-compiler-runtime')
audit = read(run / 'provenance/runtime-byte-audit.json')
assert audit['commit'] == SHA
for m in audit['modules']:
    assert m['offline_emit_bytes_equal']
    assert sha(run / 'intent-compiler-runtime/dist' / (m['name'] + '.js')) == m['runtime_js_sha256']
shutil.copytree(R3 / 'host-session-overlay', run / 'host-session-overlay')
for name in ['offline-management-r3.mjs', 'offline-review-guard.mjs', 'prepare-offline-r4.py']:
    shutil.copyfile(Path(__file__).parent / name, run / name)
shutil.copyfile(R3 / 'model/opencode.json', run / 'model/opencode.json')
shutil.copyfile(R3 / 'start-management-host.sh', run / 'start-management-host.sh')
instruction = PROJECT / 'experiments/evocode/harbor/dpipe/records/2026-10-02-prepared-r3-r15/sources/round-04.txt'
shutil.copyfile(instruction, run / 'r4-original.txt')
event = {'schema_version': 2, 'run_id': parent, 'event_id': parent + ':preparation:r4:' + sha(instruction)[:16],
    'kind': 'user_input', 'source': {'producer_id': 'offline-preparation', 'channel': 'user'},
    'payload': {'text': instruction.read_text(encoding='utf-8'), 'source': {'round': 4,
        'source_category': 'incremental_change', 'source_file': str(instruction), 'preparation_only': True,
        'prior_management_round': 3, 'latest_executed_round': 2, 'round_3_executed': False}}}
save(run / 'initial-r4-event.json', event)
cfg.update(run_id=rid, scope='R4 management preparation only; R3 unexecuted; no executor or verifier',
           history_management_calls=16, initial_event_file='initial-r4-event.json')
save(run / 'run.json', cfg)
launch = read(R3 / 'provenance/host-launch-command.json')
container = 'offline-r4-' + rid.rsplit('-', 1)[-1]
launch['argv'] = [v.replace(str(R3), str(run)).replace('offline-r3-5d90df', container) for v in launch['argv']]
launch['container'] = container
save(run / 'provenance/host-launch-command.json', launch)
generation = {'argv': ['docker', 'exec', '--detach', container, '/bin/sh', '-c',
    '/opt/opencode-bun/bun /opt/offline/offline-management-r3.mjs > /opt/offline/generation.log 2>&1'],
    'one_batch': True, 'max_new_calls': 8, 'human_review_pause': False}
save(run / 'provenance/generation-launch-command.json', generation)
diff = ''.join(difflib.unified_diff((R3 / 'offline-management-r3.mjs').read_text(encoding='utf-8').splitlines(True),
    (run / 'offline-management-r3.mjs').read_text(encoding='utf-8').splitlines(True),
    fromfile='R3/offline-management-r3.mjs', tofile='R4/offline-management-r3.mjs'))
(run / 'provenance/driver-vs-R3.diff').write_text(diff, encoding='utf-8')
save(run / 'provenance/launch-file-hashes.json', {name: sha(run / name) for name in
    ['offline-management-r3.mjs', 'offline-review-guard.mjs', 'prepare-offline-r4.py',
     'initial-r4-event.json', 'model/opencode.json', 'host-session-overlay/llm.ts']})
save(run / 'progress.json', {'status': 'prepared', 'new_calls_reserved': 0, 'round': 4})
save(PROJECT / '.scratch/offline-r4-current.json', {'run': str(run), 'container': container})
save(PROJECT / '.scratch/r4-generation-status.json', {'status': 'prepared',
    'updated_at': datetime.now(timezone.utc).isoformat(), 'run_directory': str(run),
    'progress_file': str(run / 'progress.json'), 'new_calls_used': 0, 'max_new_calls': 8,
    'note': 'Read progress_file for live stage. R3 is prepared but unexecuted; no success fabricated.'})
print(json.dumps({'prepared': str(run), 'container': container, 'paid_calls': 0}))
