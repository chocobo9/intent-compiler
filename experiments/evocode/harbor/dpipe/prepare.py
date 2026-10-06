import argparse, hashlib, json, os, shutil, subprocess, sys, tomllib
from pathlib import Path
from datetime import datetime, timezone
parser=argparse.ArgumentParser()
parser.add_argument("--run-id", required=True, help="Unique job name and data directory for a new run")
parser.add_argument("--model", choices=["deepseek/deepseek-flash", "openai/gpt-5.6-sol", "openai/gpt-6-luna-fast"], default="deepseek/deepseek-flash")
parser.add_argument("--rounds", type=int, default=15, help="Run rounds 1..N of the 15-round task (default 15)")
args=parser.parse_args()
if not 1 <= args.rounds <= 15:
    raise ValueError("--rounds must be between 1 and 15")
run_id=args.run_id
if not run_id.startswith(("intent-sol-dpipe-", "intent-luna-dpipe-", "intent-deepseek-dpipe-")) or not all(c.isalnum() or c in "-_" for c in run_id):
    raise ValueError("Invalid unique dpipe run-id")
provider, executor_model = args.model.split("/", 1)
manager_variant = "low" if provider == "deepseek" else "high-fast" if executor_model == "gpt-6-luna-fast" else "medium-fast"
executor_variant = "max" if provider == "deepseek" else "high-fast" if executor_model == "gpt-6-luna-fast" else "medium"
src=Path(r"D:\huawei\EvoCodeBench\data\evocodebench_wotraj\theme_d5_w9_data_engineering_reproducibility_verification")
run=Path(r"D:\huawei\EvoCodeBench\harbor_runs")/run_id
task=run/"task"
data=Path(r"D:\huawei\EvoCodeBench\harbor_intent_data")/run_id
results=Path(r"D:\huawei\EvoCodeBench\harbor_results")/run_id
host=run/"host-agent"
host_assets=Path(r"D:\huawei\EvoCodeBench\harbor_runs\intent-compiler-d3w9-r1-gpt6-luna-fast-20260925-001")
runtime=run
project=Path(__file__).resolve().parents[4]
for p in (run,data,results):
    if p.exists(): raise FileExistsError(f"Refusing to overwrite existing run: {p}")
auth=Path(r"C:\Users\HuaWeiClient\.local\share\opencode\auth.json")
if provider == "deepseek":
    key=os.environ.get("DEEPSEEK_API_KEY", "")
    env_file=project/".env"
    if not key and env_file.is_file():
        for line in env_file.read_text(encoding="utf-8").splitlines():
            name, sep, value=line.partition("=")
            if sep and name.strip() == "DEEPSEEK_API_KEY": key=value.strip().strip("\"'")
    if not key: raise ValueError("DEEPSEEK_API_KEY is not configured")
    auth=auth.with_name("intent-deepseek-auth.json")
    auth.write_text(json.dumps({"deepseek":{"type":"api","key":key}}),encoding="utf-8")
if not auth.is_file(): raise FileNotFoundError(auth)
subprocess.run(["node", str(Path(__file__).with_name("check-host-patch.mjs")),
                str(host_assets/"opencode-v1.18.31-strict")], cwd=project, check=True)
for p in (task/"environment",data/"model",data/"compiler-store",data/"observer-store",data/"audit",results,host): p.mkdir(parents=True,exist_ok=True)
shutil.copy2(Path(__file__).with_name("capture-host.py"), data/"audit"/"capture-host.py")
# A future authorized run builds and freezes the current compiler, never an old run's compiler.
subprocess.run(["npm.cmd" if os.name == "nt" else "npm", "run", "build"], cwd=project, check=True)
operations=json.loads(subprocess.check_output([
    "node", "--input-type=module", "-e",
    "import { openCodeOperationsForModel } from " + json.dumps((project/"dist/runtime/opencode-operations.js").as_uri())
    + "; console.log(JSON.stringify(openCodeOperationsForModel(" + json.dumps(executor_model) + ")));",
], text=True, encoding="utf-8"))
compiler_runtime=runtime/"intent-compiler-runtime"
for name in ("dist", ".opencode", "node_modules"):
    shutil.copytree(project/name, compiler_runtime/name)
shutil.copy2(project/"package.json", compiler_runtime/"package.json")
subprocess.run([sys.executable, str(Path(__file__).with_name("patch-management-stream.py")),
                "--source", str(host_assets/"opencode-v1.18.31-strict"),
                "--target", str(runtime/"opencode-stream-overlay"), "--overlay-only"], check=True)
initializer=run/"initialize-store.mjs"
initializer.write_text(
    "import { IntentStoreV2 } from " + json.dumps((compiler_runtime/"dist/core/compiler-store-v2.js").as_uri()) + ";\n"
    + "new IntentStoreV2({storeDir:" + json.dumps(str(data/"compiler-store")) + ",runId:" + json.dumps(run_id) + "});\n",
    encoding="utf-8")
subprocess.run(["node", str(initializer)], check=True)
snapshot_path=data/"compiler-store"/"v2-runs"/run_id/"snapshot.json"
snapshot=json.loads(snapshot_path.read_text(encoding="utf-8"))
# One batch has to afford a legitimate IR<->CI round trip, not just three
# stages plus one repair: IR + CI + check is already 3, a CI rejection that
# returns to the IR stage costs 2 more, and a mechanical defect costs another.
# Fresh R1 batches in runs 856312ae and cb04de9f needed 7 and more than 8
# calls (transport timeout, source selector repairs, check rework), so a
# batch gets 12.
snapshot["budget"].update(max_management_requests=12, max_total_management_requests=180)
snapshot_path.write_text(json.dumps(snapshot, indent=2), encoding="utf-8")
provenance=run/"provenance"
provenance.mkdir()
shutil.copytree(project/"src", provenance/"src")
shutil.copytree(Path(__file__).parent, provenance/"driver", ignore=shutil.ignore_patterns("__pycache__"))
for command, name in ((["rev-parse", "HEAD"], "compiler-head.txt"), (["status", "--short"], "compiler-status.txt"), (["diff", "--binary"], "compiler.patch")):
    (provenance/name).write_bytes(subprocess.check_output(["git", "-C", str(project), *command]))
(provenance/"executor-capabilities.json").write_text(json.dumps({"model": executor_model, "operations": operations}, indent=2), encoding="utf-8")
(provenance/"runtime-hashes.json").write_text(json.dumps({
    p.relative_to(compiler_runtime).as_posix(): hashlib.sha256(p.read_bytes()).hexdigest()
    for name in ("dist", ".opencode") for p in (compiler_runtime/name).rglob("*") if p.is_file()
}, indent=2), encoding="utf-8")
(provenance/"management-policy.json").write_text(json.dumps({
    "prompt_timeout_ms": 300000, "cancellation_timeout_ms": 10000,
    "max_deadline_failures_per_batch": 2, "max_management_requests_per_batch": 12,
    "max_total_management_requests": 180, "rounds": args.rounds,
    "budget_basis": "15 rounds with user and return batches; per batch three stages, IR<->CI round trips, mechanical repairs, check rework and a transport timeout (12; fresh R1 batches needed 7 and more than 8)",
}, indent=2), encoding="utf-8")
shutil.copy2(src/"environment"/"Dockerfile",task/"environment"/"Dockerfile")
shutil.copy2(src/"steps"/"round-1"/"instruction.md",task/"instruction.md")
for i in range(1,16): shutil.copytree(src/"steps"/f"round-{i}",task/f"round_{i}",dirs_exist_ok=True)
(provenance/"official-task-hashes.json").write_text(json.dumps([
    {"source": str(src/"steps"/f"round-{i}"/name),
     "copied": str(task/f"round_{i}"/name),
     "sha256": hashlib.sha256((task/f"round_{i}"/name).read_bytes()).hexdigest()}
    for i in range(1,16) for name in ("instruction.md", "tests/test.sh", "solution/solve.sh")
], indent=2), encoding="utf-8")
original=(src/"task.toml").read_text(encoding="utf-8")
meta=tomllib.loads(original)["metadata"]["requirement_chain"]["steps"]
blocks=["\n[metadata.multiround]\nnum_rounds = 15\n"]
for i,entry in enumerate(meta,1):
    types=", ".join(json.dumps(t) for t in entry["change_types"])
    blocks.append(f"\n[[metadata.multiround.rounds]]\nround = {i}\nchange_types = [{types}]\n")
(task/"task.toml").write_text(original+"".join(blocks),encoding="utf-8")
model={"$schema":"https://opencode.ai/config.json","model":"openai/gpt-5.6-sol","plugin":["file:///opt/intent-compiler/.opencode/plugins/experiment-runtime.js"],"provider":{"openai":{"models":{"gpt-5.6-sol":{"options":{"reasoningEffort":"medium"},"variants":{"medium-fast":{"reasoningEffort":"medium","serviceTier":"priority"}}}}}}}
if executor_model == "gpt-6-luna-fast":
    model={"$schema":"https://opencode.ai/config.json","model":args.model,"plugin":model["plugin"],
           "provider":{"openai":{"models":{"gpt-6-luna-fast":{"options":{"reasoningEffort":"high"},
                       "variants":{"high":{"reasoningEffort":"high"},"high-fast":{"reasoningEffort":"high","serviceTier":"priority"}}}}}}}
elif provider == "deepseek":
    model={"$schema":"https://opencode.ai/config.json","model":args.model,"plugin":model["plugin"],
           "provider":{"deepseek":{"models":{"deepseek-flash":{"options":{"reasoningEffort":"max"},
                       "variants":{"low":{"reasoningEffort":"low"},"max":{"reasoningEffort":"max"}}}}}}}
(data/"model"/"opencode.json").write_text(json.dumps(model,indent=2)+"\n",encoding="utf-8")
compose=f'''services:
  main:
    volumes:
      - type: bind
        source: '{runtime.as_posix()}/intent-compiler-runtime'
        target: /opt/intent-compiler
        read_only: true
      - type: bind
        source: '{host_assets.as_posix()}/opencode-v1.18.31-strict'
        target: /opt/opencode-runtime
        read_only: true
      - type: bind
        source: '{runtime.as_posix()}/opencode-stream-overlay/packages/opencode/src/session'
        target: /opt/opencode-runtime/packages/opencode/src/session
        read_only: true
      - type: bind
        source: '{runtime.as_posix()}/opencode-stream-overlay/packages/opencode/src/cli/cmd'
        target: /opt/opencode-runtime/packages/opencode/src/cli/cmd
        read_only: true
      - type: bind
        source: '{host_assets.as_posix()}/bun'
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
      INTENT_COMPILER_PROVIDER_ID: {provider}
      INTENT_COMPILER_MODEL_ID: {executor_model}
      INTENT_COMPILER_EXECUTOR_MODEL_ID: {executor_model}
      INTENT_COMPILER_MODEL_VARIANT: {manager_variant}
      INTENT_COMPILER_EXECUTOR_VARIANT: {executor_variant}
      INTENT_COMPILER_AGENT: build
      INTENT_COMPILER_STORE: /opt/intent-data/compiler-store
      INTENT_COMPILER_MODEL_DIRECTORY: /opt/intent-data/model
      INTENT_COMPILER_OPERATIONS: {','.join(operations)}
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
      OPENCODE_MANAGEMENT_STREAM_LOG: /opt/intent-data/audit/management-stream.jsonl
'''
(task/"environment"/"docker-compose.yaml").write_text(compose,encoding="utf-8")
shutil.copy2(Path(__file__).with_name("intent_opencode_agent.py"), host/"intent_opencode_agent.py")
shutil.copy2(Path(__file__).with_name("install-opencode-patched.sh.j2"), host/"install-opencode-patched.sh.j2")
config=json.loads(Path(__file__).with_name("intent.example.json").read_text(encoding="utf-8"))
config["job_name"]=run_id
config["jobs_dir"]=str(results)
config["verifier"]["multiround_max_round"]=args.rounds
config["agents"][0]["import_path"]="intent_opencode_agent:OpenCodePatched"
config["agents"][0]["model_name"]=args.model
config["agents"][0]["kwargs"]={"dispatch_snapshot_path":str(data/"compiler-store"/"v2-runs"/run_id/"snapshot.json"),"variant":executor_variant,"experiment_run_id":run_id}
config["tasks"][0]["path"]=str(task)
(run/"intent.json").write_text(json.dumps(config,indent=2)+"\n",encoding="utf-8")
print(run)
print(f"Prepared 15 original instruction/test/solution rounds; this run stops after round {args.rounds}.")

