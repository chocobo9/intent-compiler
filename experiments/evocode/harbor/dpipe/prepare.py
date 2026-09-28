import json, shutil, tomllib
from pathlib import Path
from datetime import datetime, timezone
src=Path(r"D:\huawei\intent-contract-experiment\tasks\pilot-control-3")
run=Path(r"D:\huawei\EvoCodeBench\harbor_runs\intent-sol-dpipe-20260927-002")
task=run/"task"
data=Path(r"D:\huawei\EvoCodeBench\harbor_intent_data\intent-sol-dpipe-20260927-002")
results=Path(r"D:\huawei\EvoCodeBench\harbor_results\intent-sol-dpipe-20260927-002")
host=run/"host-agent"
previous=Path(r"D:\huawei\EvoCodeBench\harbor_runs\paired-deepseek-d3w9-20260925-006")
runtime=Path(r"D:\huawei\EvoCodeBench\harbor_runs\intent-compiler-d3w9-r1-gpt6-luna-fast-20260925-001")
run_id="intent-sol-dpipe-20260927-002"
for p in (task/"environment",data/"model",data/"compiler-store",data/"observer-store",data/"audit",results,host): p.mkdir(parents=True,exist_ok=True)
shutil.copy2(src/"environment"/"Dockerfile",task/"environment"/"Dockerfile")
shutil.copy2(src/"steps"/"round-1"/"instruction.md",task/"instruction.md")
for i in range(1,16): shutil.copytree(src/"steps"/f"round-{i}",task/f"round_{i}",dirs_exist_ok=True)
original=(src/"task.toml").read_text(encoding="utf-8")
meta=tomllib.loads(original)["metadata"]["requirement_chain"]["steps"]
blocks=["\n[metadata.multiround]\nnum_rounds = 15\n"]
for i,entry in enumerate(meta,1):
    types=", ".join(json.dumps(t) for t in entry["change_types"])
    blocks.append(f"\n[[metadata.multiround.rounds]]\nround = {i}\nchange_types = [{types}]\n")
(task/"task.toml").write_text(original+"".join(blocks),encoding="utf-8")
model={"$schema":"https://opencode.ai/config.json","model":"openai/gpt-5.6-sol","plugin":["file:///opt/intent-compiler/.opencode/plugins/experiment-runtime.js"],"provider":{"openai":{"models":{"gpt-5.6-sol":{"options":{"reasoningEffort":"medium"}}}}}}
(data/"model"/"opencode.json").write_text(json.dumps(model,indent=2)+"\n",encoding="utf-8")
auth=Path(r"C:\Users\HuaWeiClient\.local\share\opencode\auth.json")
if not auth.is_file(): raise FileNotFoundError(auth)
compose=f'''services:
  main:
    volumes:
      - type: bind
        source: '{runtime.as_posix()}/intent-compiler-runtime'
        target: /opt/intent-compiler
        read_only: true
      - type: bind
        source: '{runtime.as_posix()}/opencode-v1.18.31-strict'
        target: /opt/opencode-runtime
        read_only: true
      - type: bind
        source: '{runtime.as_posix()}/bun'
        target: /opt/opencode-bun
        read_only: true
      - type: bind
        source: '{data.as_posix()}'
        target: /opt/intent-data
      - type: bind
        source: '{auth.as_posix()}'
        target: /run/secrets/opencode-auth.json
        read_only: true
    environment:
      INTENT_COMPILER_TRANSPORT: opencode
      INTENT_COMPILER_PROVIDER_ID: openai
      INTENT_COMPILER_MODEL_ID: gpt-6-luna-fast
      INTENT_COMPILER_MODEL_VARIANT: high
      INTENT_COMPILER_AGENT: build
      INTENT_COMPILER_STORE: /opt/intent-data/compiler-store
      INTENT_COMPILER_MODEL_DIRECTORY: /opt/intent-data/model
      INTENT_COMPILER_OPERATIONS: read,write,edit,bash,glob,grep
      EXPERIMENT_ARM_MODE: compiler
      EXPERIMENT_OBSERVER_STORE: /opt/intent-data/observer-store
      EXPERIMENT_OBSERVER_AUTO_REGISTER: "1"
      EXPERIMENT_RUN_ID: {run_id}
      EXPERIMENT_ARM_ID: compiler-v2
      EXPERIMENT_TASK_ID: evocodebench-d5-w9-dpipe
      EXPERIMENT_TURN_ID: "1"
      EXPERIMENT_INPUT_IDENTITY: {run_id}:round-1
      EXPERIMENT_INPUT_SOURCE_CATEGORY: initial_requirement
      EXPERIMENT_STAGE_ID: d5_w9
      EXPERIMENT_PATH_ID: dpipe
      EXPERIMENT_ROUND: "1"
      EXPERIMENT_TASK_OCCURRENCE_ID: d5_w9-dpipe-round-1
      EXPERIMENT_WORKSPACE_SNAPSHOT_ID: d5_w9-r1-empty-workspace
      EXPERIMENT_INPUT_PRODUCED_AT: "{datetime.now(timezone.utc).isoformat()}"
      OPENCODE_STRICT_TOOL_EVIDENCE_PATH: /opt/intent-data/audit/host-prepared-tools.jsonl
'''
(task/"environment"/"docker-compose.yaml").write_text(compose,encoding="utf-8")
agent=(previous/"host-agent"/"intent_opencode_agent.py").read_text(encoding="utf-8")
for a,b in [('variant: str = "max"','variant: str = "medium"'),('if variant != "max":','if variant != "medium":'),('requires executor variant=max','requires executor variant=medium'),('deepseek/deepseek-flash','openai/gpt-5.6-sol'),('d3_w9-repro-verify-engine','d5_w9-dpipe'),('d3_w9-r','d5_w9-r')]: agent=agent.replace(a,b)
(host/"intent_opencode_agent.py").write_text(agent,encoding="utf-8")
template=(previous/"host-agent"/"install-opencode-patched.sh.j2").read_text(encoding="utf-8")
template=template.replace('test -n "'+'$'+'{DEEPSEEK_API_KEY:-}"','')
template=template.replace('.model == "deepseek/deepseek-flash" and .provider.deepseek.models["deepseek-flash"].options.reasoningEffort == "max"','.model == "openai/gpt-5.6-sol" and .provider.openai.models["gpt-5.6-sol"].options.reasoningEffort == "medium"')
template=template.replace('executor=deepseek/deepseek-flash@max','executor=openai/gpt-5.6-sol@medium')
(host/"install-opencode-patched.sh.j2").write_text(template,encoding="utf-8")
config=json.loads((previous/"intent.json").read_text(encoding="utf-8"))
config["job_name"]=run_id
config["jobs_dir"]=str(results)
config["verifier"]["multiround_max_round"]=15
config["agents"][0]["import_path"]="intent_opencode_agent:OpenCodePatched"
config["agents"][0]["model_name"]="openai/gpt-5.6-sol"
config["agents"][0]["kwargs"]={"dispatch_snapshot_path":str(data/"compiler-store"/"v2-runs"/run_id/"snapshot.json"),"variant":"medium","experiment_run_id":run_id}
config["tasks"][0]["path"]=str(task)
(run/"intent.json").write_text(json.dumps(config,indent=2)+"\n",encoding="utf-8")
print(run)
print("Prepared 15 original instruction/test/solution rounds.")

