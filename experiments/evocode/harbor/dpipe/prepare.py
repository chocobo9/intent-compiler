import argparse, json, shutil, subprocess, tomllib
from pathlib import Path
from datetime import datetime, timezone
parser=argparse.ArgumentParser()
parser.add_argument("--run-id", required=True, help="Unique job name and data directory for a new run")
args=parser.parse_args()
run_id=args.run_id
if not run_id.startswith("intent-sol-dpipe-") or not all(c.isalnum() or c in "-_" for c in run_id):
    raise ValueError("run-id must start with intent-sol-dpipe- and contain only letters, digits, '-' or '_'")
src=Path(r"D:\huawei\intent-contract-experiment\tasks\pilot-control-3")
repo=Path(r"D:\huawei\intent-contract-experiment")
run=Path(r"D:\huawei\EvoCodeBench\harbor_runs")/run_id
task=run/"task"
data=Path(r"D:\huawei\EvoCodeBench\harbor_intent_data")/run_id
results=Path(r"D:\huawei\EvoCodeBench\harbor_results")/run_id
host=run/"host-agent"
runtime=Path(r"D:\huawei\EvoCodeBench\harbor_runs\intent-compiler-d3w9-r1-gpt6-luna-fast-20260925-001")
for p in (run,data,results):
    if p.exists(): raise FileExistsError(f"Refusing to overwrite existing run: {p}")
auth=Path(r"C:\Users\HuaWeiClient\.local\share\opencode\auth.json")
if not auth.is_file(): raise FileNotFoundError(auth)
for p in (task/"environment",data/"model",data/"compiler-store",data/"observer-store",data/"audit",results,host): p.mkdir(parents=True,exist_ok=True)
shutil.copy2(src/"environment"/"Dockerfile",task/"environment"/"Dockerfile")
shutil.copy2(src/"steps"/"round-1"/"instruction.md",task/"instruction.md")
for i in range(1,16): shutil.copytree(src/"steps"/f"round-{i}",task/f"round_{i}",dirs_exist_ok=True)
for i in range(1,16):
    for kind in ("tests/test.sh","solution/solve.sh"):
        rel=f"tasks/pilot-control-3/steps/round-{i}/{kind}"
        blob=subprocess.check_output(["git","-C",str(repo),"show",f"HEAD:{rel}"])
        (task/f"round_{i}"/kind).write_bytes(blob)
original=(src/"task.toml").read_text(encoding="utf-8")
meta=tomllib.loads(original)["metadata"]["requirement_chain"]["steps"]
blocks=["\n[metadata.multiround]\nnum_rounds = 15\n"]
for i,entry in enumerate(meta,1):
    types=", ".join(json.dumps(t) for t in entry["change_types"])
    blocks.append(f"\n[[metadata.multiround.rounds]]\nround = {i}\nchange_types = [{types}]\n")
(task/"task.toml").write_text(original+"".join(blocks),encoding="utf-8")
model={"$schema":"https://opencode.ai/config.json","model":"openai/gpt-5.6-sol","plugin":["file:///opt/intent-compiler/.opencode/plugins/experiment-runtime.js"],"provider":{"openai":{"models":{"gpt-5.6-sol":{"options":{"reasoningEffort":"medium"},"variants":{"medium-fast":{"reasoningEffort":"medium","serviceTier":"priority"}}}}}}}
(data/"model"/"opencode.json").write_text(json.dumps(model,indent=2)+"\n",encoding="utf-8")
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
      INTENT_COMPILER_MODEL_ID: gpt-5.6-sol
      INTENT_COMPILER_MODEL_VARIANT: medium-fast
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
shutil.copy2(Path(__file__).with_name("intent_opencode_agent.py"), host/"intent_opencode_agent.py")
shutil.copy2(Path(__file__).with_name("install-opencode-patched.sh.j2"), host/"install-opencode-patched.sh.j2")
config=json.loads(Path(__file__).with_name("intent.example.json").read_text(encoding="utf-8"))
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

