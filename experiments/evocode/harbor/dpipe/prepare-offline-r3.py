"""Prepare one isolated management-only run; never starts generation itself."""
import difflib, hashlib, json, shutil, stat, subprocess, uuid
from datetime import datetime, timezone
from pathlib import Path

PROJECT=Path(__file__).resolve().parents[4]
BASE=Path(r'D:\huawei\EvoCodeBench')
PARENT='intent-luna-dpipe-full-r1r5-20261002-053740-e6308341'
PREVIOUS='intent-luna-dpipe-quote-r3r5-20261002-135746z-81964e85'
SHA='751c4d10aceb0597ef52b247d69696db1ae5685c'
def read(p): return json.loads(p.read_text(encoding='utf-8'))
def save(p,x): p.write_text(json.dumps(x,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
def sha(p):
    with p.open('rb') as f:return hashlib.file_digest(f,'sha256').hexdigest()
assert subprocess.check_output(['git','rev-parse','HEAD'],cwd=PROJECT,text=True).strip()==SHA
assert not subprocess.check_output(['git','diff','HEAD','--','src'],cwd=PROJECT,text=True).strip()
record=read(BASE/'harbor_checkpoints'/PARENT/'round-02/record.json')
source=Path(record['sealed_compiler_store'])
for name,digest in record['hashes'].items():assert sha(source/name)==digest
assert sha(Path(record['sealed_archive']['path']))==record['sealed_archive']['sha256']
rid=f'intent-luna-dpipe-offline-r3-{datetime.now(timezone.utc):%Y%m%d-%H%M%S}z-{uuid.uuid4().hex[:6]}'
run=BASE/'management_runs'/rid;run.mkdir(parents=True,exist_ok=False)
for name in ['provenance','model','host-config','host-data','host-cache','calls']:(run/name).mkdir()
store=run/'compiler-store/v2-runs'/PARENT
shutil.copytree(source,store)
for p in store.iterdir():p.chmod(p.stat().st_mode|stat.S_IWRITE)
baseline=read(store/'snapshot.json');assert len(baseline['management_calls'])==10
assert not baseline['pending_event_ids'] and not baseline['unresolved_user_event_ids']
save(run/'provenance/F2-record.json',record)
shutil.copyfile(store/'snapshot.json',run/'provenance/F2-original-snapshot.json')
baseline['budget']['max_management_requests']=8
baseline['budget']['max_total_management_requests']=18
save(store/'snapshot.json',baseline)
save(run/'provenance/budget-only-change.json',{'history_calls':10,'new_limit':8,'old_total_limit':48,'new_absolute_total_limit':18,'note':'Independent preparation copy only; no historical usage reset'})
shutil.copyfile(record['sealed_archive']['path'],run/'F2-workspace-session-image.tar')
runtime=run/'intent-compiler-runtime'
shutil.copytree(BASE/'harbor_runs'/PREVIOUS/'intent-compiler-runtime',runtime)
# Reuse the independently byte-audited frozen build; verify its relevant bytes.
audit=read(BASE/'harbor_runs'/PREVIOUS/'identity-audit-20261002/module-byte-audit.json')
assert audit['commit']==SHA
for module in audit['modules']:
    assert module['offline_emit_bytes_equal']
    assert sha(runtime/'dist'/f"{module['name']}.js")==module['runtime_js_sha256']
save(run/'provenance/runtime-byte-audit.json',audit)
overlay=run/'host-session-overlay'
shutil.copytree(BASE/'harbor_runs'/PREVIOUS/'opencode-stream-overlay/packages/opencode/src/session',overlay)
llm=overlay/'llm.ts';before=llm.read_text(encoding='utf-8')
needle='maxRetries: input.retries ?? 0,';assert before.count(needle)==1
guard='''import * as offlineBudgetFs from "node:fs";
// Experiment-local hard limit, before SDK submission; no business tools here.
function offlineManagementBudget(retries: number, model: string): number {
  const file = process.env.OPENCODE_OFFLINE_BUDGET_FILE;
  if (!file) return retries;
  if (model !== "gpt-6-luna-fast") throw new Error("OFFLINE_MODEL_NOT_AUTHORIZED");
  const prior = offlineBudgetFs.existsSync(file) ? JSON.parse(offlineBudgetFs.readFileSync(file, "utf8")) : [];
  if (prior.length >= 8) throw new Error("OFFLINE_MANAGEMENT_BUDGET_EXHAUSTED");
  prior.push({sequence:prior.length+1,model,started_at:new Date().toISOString()});
  offlineBudgetFs.writeFileSync(file,JSON.stringify(prior,null,2));
  return 0; // No SDK retry may hide an additional provider request.
}
'''
after=guard+before.replace(needle,'maxRetries: offlineManagementBudget(input.retries ?? 0, input.model.id),')
llm.write_text(after,encoding='utf-8')
(run/'provenance/host-budget-guard.diff').write_text(''.join(difflib.unified_diff(before.splitlines(True),after.splitlines(True),fromfile='existing/llm.ts',tofile='experiment-overlay/llm.ts')),encoding='utf-8')
for name in ['offline-management-r3.mjs','offline-review-guard.mjs','offline-review-guard.test.mjs','prepare-offline-r3.py']:shutil.copyfile(Path(__file__).parent/name,run/name)
config=read(BASE/'harbor_intent_data'/PARENT/'model/opencode.json');config['plugin']=[]
save(run/'model/opencode.json',config)
instruction=PROJECT/'experiments/evocode/harbor/dpipe/records/2026-10-02-prepared-r3-r15/sources/round-03.txt'
assert sha(instruction)=='106c83b0c04fd28b1ad8956248cf22745cda7bcf3b1562412fac0990b3e2647e'
shutil.copyfile(instruction,run/'r3-original.txt')
event={'schema_version':2,'run_id':PARENT,'event_id':PARENT+':preparation:r3:'+sha(instruction)[:16], 'kind':'user_input','source':{'producer_id':'offline-preparation','channel':'user'},'payload':{'text':instruction.read_text(encoding='utf-8'),'source':{'round':3,'source_category':'incremental_change','source_file':str(instruction),'preparation_only':True}}}
save(run/'initial-r3-event.json',event)
save(run/'run.json',{'run_id':rid,'parent_run_id':PARENT,'source_commit':SHA,'runtime':'/opt/offline/intent-compiler-runtime','sdk_client':'/opt/opencode-runtime/packages/sdk/js/src/client.ts','server':'http://127.0.0.1:4099','operations':['read','apply_patch','bash','glob','grep','todowrite'],'scope':'R3 management preparation only; one batch; no execution or verifier','new_management_limit':8})
bootstrap='''#!/bin/sh
set -eu
mkdir -p /opt/offline/host-data/opencode
cp /run/secrets/opencode-auth.json /opt/offline/host-data/opencode/auth.json
chmod 600 /opt/offline/host-data/opencode/auth.json
exec /opt/opencode-bun/bun run --cwd /opt/opencode-runtime/packages/opencode src/index.ts serve --hostname 0.0.0.0 --port 4099
'''
(run/'start-management-host.sh').write_bytes(bootstrap.encode('utf-8'))
engine=BASE/'harbor_runs/intent-compiler-d3w9-r1-gpt6-luna-fast-20260925-001/opencode-v1.18.31-strict';bun=engine.parent/'bun'
container='offline-r3-'+rid.rsplit('-',1)[-1]
cmd=['docker','run','--detach','--name',container,'--entrypoint','/bin/sh','--workdir','/opt/offline/model']
for source_path,target,readonly in [(run,'/opt/offline',False),(engine,'/opt/opencode-runtime',True),(overlay,'/opt/opencode-runtime/packages/opencode/src/session',True),(bun,'/opt/opencode-bun',True),(Path(r'C:\Users\HuaWeiClient\.local\share\opencode\auth.json'),'/run/secrets/opencode-auth.json',True)]:
    cmd+=['--mount',f'type=bind,source={source_path},target={target}'+(',readonly' if readonly else '')]
for k,v in {'XDG_CONFIG_HOME':'/opt/offline/host-config','XDG_DATA_HOME':'/opt/offline/host-data','XDG_CACHE_HOME':'/opt/offline/host-cache','OPENCODE_CONFIG':'/opt/offline/model/opencode.json','OPENCODE_DISABLE_PROJECT_CONFIG':'true','OPENCODE_STRICT_TOOL_EVIDENCE_PATH':'/opt/offline/host-prepared-tools.jsonl','OPENCODE_MANAGEMENT_STREAM_LOG':'/opt/offline/management-stream.jsonl','OPENCODE_OFFLINE_BUDGET_FILE':'/opt/offline/provider-request-reservations.json'}.items():cmd+=['--env',k+'='+v]
cmd += [read(Path(record['sealed_metadata']['path']))['image_ref'],'/opt/offline/start-management-host.sh']
save(run/'provenance/host-launch-command.json',{'argv':cmd,'container':container,'paid_generation_started':False})
save(PROJECT/'.scratch/offline-r3-current.json',{'run':str(run),'container':container})
print(json.dumps({'prepared':str(run),'container':container,'paid_calls':0},ensure_ascii=False))
