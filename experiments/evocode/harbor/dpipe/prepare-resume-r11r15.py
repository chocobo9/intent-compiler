"""Online R11..R15 (second segment) from the R10 checkpoint, 45a6388. Same recipe as prepare-resume-r10.py;
cumulative cap 181 = 61 used + 5 rounds x 3 batches x 8. The host agent adds a gate: before injecting the next round,
stop if the previous round has pending events or any official failure outside the accepted legacy cases."""
import hashlib, importlib, json, os, shutil, sqlite3, stat, subprocess, sys, tarfile, uuid
from datetime import datetime, timezone
from pathlib import Path

PROJECT = Path(__file__).resolve().parents[4]
BASE = Path(r"D:\huawei\EvoCodeBench")
PARENT = "intent-luna-dpipe-full-r1r5-20261002-053740-e6308341"
SRC_RUN = "intent-luna-dpipe-online-r10-20261005-172303z-d573b781"
SRC_RUN_DIR = BASE / "harbor_runs" / SRC_RUN
SRC_DATA = BASE / "harbor_intent_data" / SRC_RUN
CKPT = BASE / "harbor_checkpoints" / SRC_RUN / "round-10"
SRC_TRIAL = next((CKPT / "resume-trial").glob("task__*"))
RECORDS = Path(__file__).parent / "records/2026-10-02-prepared-r3-r15"
ROUNDS = (11, 12, 13, 14, 15)
HISTORY_CALLS = 61
PER_BATCH = 8
TOTAL_MAX = 181  # 61 used at the R10 checkpoint + 5 rounds x 3 batches x 8
RUN_ID = f"intent-luna-dpipe-online-r11r15-{datetime.now(timezone.utc):%Y%m%d-%H%M%S}z-{uuid.uuid4().hex[:8]}"
RUN = BASE / "harbor_runs" / RUN_ID
DATA = BASE / "harbor_intent_data" / RUN_ID
RESULTS = BASE / "harbor_results" / RUN_ID

def read(p): return json.loads(p.read_text(encoding="utf-8"))
def write(p, value): p.write_text(json.dumps(value, ensure_ascii=False, indent=2)+"\n", encoding="utf-8")
def sha(p):
    with p.open("rb") as f: return hashlib.file_digest(f, "sha256").hexdigest()
def git(*args): return subprocess.check_output(["git", *args], cwd=PROJECT, text=True).strip()
def copy_tree(source, target):
    shutil.copytree(source, target, ignore=shutil.ignore_patterns("__pycache__"))
    for p in target.rglob("*"):
        if p.is_file(): p.chmod(p.stat().st_mode | stat.S_IWRITE)

# Frozen source identity: exact HEAD (recorded, not pinned), clean src/test and build inputs.
HEAD = git("rev-parse", "HEAD")
assert git("branch", "--show-current") == "intent-delivery-projection"
assert not git("status", "--porcelain", "--", "src", "test", "package.json", "package-lock.json", "tsconfig.json", "tsconfig.build.json")

# R7 input integrity.
official_src = Path(r"D:\huawei\EvoCodeBench\data\evocodebench_wotraj\theme_d5_w9_data_engineering_reproducibility_verification")
inputs = {}
for ROUND in ROUNDS:
    prepared = RECORDS / f"sources/round-{ROUND:02d}.txt"
    official = official_src / "steps" / f"round-{ROUND}" / "instruction.md"
    allow = read(RECORDS / f"round-{ROUND:02d}/input-allowlist.json")
    expected = next(x["sha256"] for x in allow["sources"] if x["round"] == ROUND)
    assert prepared.read_bytes() == official.read_bytes(), f"round {ROUND}: official bytes differ from prepared source"
    assert sha(official) == expected, f"round {ROUND}: sha256 differs from allowlist"
    inputs[ROUND] = {"official": str(official), "prepared": str(prepared), "sha256": expected, "bytes": official.stat().st_size}

# R10 boundary: sealed checkpoint store, queue, executions, dispatches.
record = read(CKPT / "record.json")
assert record["round"] == 10 and record["run_id"] == PARENT
parent_store = CKPT / "compiler-store/v2-runs" / PARENT
for name, h in record["hashes"].items(): assert sha(parent_store / name) == h, name
snapshot = read(parent_store / "snapshot.json")
assert len(snapshot["management_calls"]) == snapshot["budget"]["total_management_requests"] == HISTORY_CALLS
assert not snapshot["pending_event_ids"] and not snapshot["unresolved_user_event_ids"]
assert len(snapshot["executions"]) == 10 and all(e["status"] == "closed" for e in snapshot["executions"])
returns = {o["execution_id"] for o in snapshot["execution_outcomes"]}
accepted = {e for b in snapshot["management_log"] if b["status"] == "accepted" for e in b["trigger_event_ids"]}
assert all(e["execution_id"] in returns and e["execution_id"] + ":return" in accepted for e in snapshot["executions"])
assert len(snapshot["dispatches"]) == 11 and snapshot["dispatches"][-1]["dispatch_id"] == "dispatch-394" and snapshot["executions"][-1]["dispatch_id"] == "dispatch-394"
rows = [json.loads(line) for line in (parent_store / "events.jsonl").read_text(encoding="utf-8").splitlines() if line.strip()]
users = [row for row in rows if row["event"]["kind"] == "user_input"]
assert len(users) == 10, "expected 10 user inputs"
assert users[-1]["event"]["payload"]["text"][1:-1].replace(chr(92) + '"', '"') == (RECORDS / "sources/round-10.txt").read_text(encoding="utf-8"), "last user input must be R10; R11 not enqueued"
assert record["pending"] == 0 and record["closed_executions"] == record["executions"] == 10 and not record["next_round_event_enqueued"]
store_hashes = dict(record["hashes"])

archive_src = SRC_TRIAL / "state/round_10/snapshot-image.tar"
meta = read(SRC_TRIAL / "state/round_10/snapshot.json")
assert meta["round"] == 10 and meta["status"] == "completed"

for p in (RUN, DATA, RESULTS): p.mkdir(parents=True, exist_ok=False)
prov = RUN / "provenance"; prov.mkdir()
trial = RUN / "resume-trial" / SRC_TRIAL.name
(trial / "state/round_10").mkdir(parents=True)
shutil.copy2(archive_src, trial / "state/round_10/snapshot-image.tar")
shutil.copy2(SRC_TRIAL / "state/round_10/snapshot.json", trial / "state/round_10/snapshot.json")
shutil.copy2(SRC_TRIAL / "config.json", trial / "config.json")
copy_tree(SRC_TRIAL / "verifier", trial / "verifier")
archive = trial / "state/round_10/snapshot-image.tar"
assert sha(archive) == sha(archive_src)

# Same time point: image workspace + session DB must match the R10 checkpoint/audit, extracted from the image bytes.
db_dir = prov / "session-check"; db_dir.mkdir()
found = {}
wanted_db = {"root/.local/share/opencode/opencode-local.db", "root/.local/share/opencode/opencode-local.db-wal", "root/.local/share/opencode/opencode-local.db-shm"}
with tarfile.open(archive) as outer:
    manifest = json.load(outer.extractfile("manifest.json"))[0]
    for layer in manifest["Layers"]:
        with tarfile.open(fileobj=outer.extractfile(layer)) as inner:
            for member in inner:
                name = member.name.removeprefix("./")
                if not member.isfile() or not (name.startswith("app/") or name in wanted_db): continue
                content = inner.extractfile(member).read()
                found[name] = hashlib.sha256(content).hexdigest()  # later layers override earlier ones
                if name in wanted_db: (db_dir / Path(name).name).write_bytes(content)
assert found["app/TASK_SPEC.md"] == sha(RECORDS / "sources/round-10.txt"), "workspace TASK_SPEC is not the R10 input"
host_identity = snapshot["executions"][-1]["host_identity"]
audit_messages = read(SRC_DATA / "audit/round-10/host-message.json")
with sqlite3.connect(db_dir / "opencode-local.db") as db:
    assert db.execute("pragma integrity_check").fetchone()[0] == "ok"
    sessions = {row[0] for row in db.execute("select id from session")}
    count, newest = db.execute("select count(*), max(time_created) from message").fetchone()  # audit host-message.json spans all host sessions
assert all(e["host_identity"] in sessions for e in snapshot["executions"])
assert count == len(audit_messages), (count, len(audit_messages))
captured = datetime.fromisoformat(record["captured_at"]).timestamp() * 1000
assert newest <= captured, "session DB has messages newer than the R10 checkpoint capture"
write(prov / "recovery-source-audit.json", {
    "source_run": SRC_RUN, "source_checkpoint": str(CKPT), "archive_sha256": sha(archive), "snapshot_id": meta["snapshot_id"],
    "store_hashes": record["hashes"], "image_app_and_session_hashes": found, "sqlite_integrity": "ok",
    "execution_sessions_present": True, "last_execution_session": host_identity, "session_messages_in_image_all_sessions": count,
    "session_messages_in_audit_all_sessions": len(audit_messages), "newest_message_ms": newest, "store_captured_ms": captured,
    "workspace_task_spec_is_round_10": True, "closed_executions": 10, "open_executions": 0,
    "executed_dispatch": "dispatch-394 (a-dpipe@10, execution-395)", "user_event_count": 10,
    "pending": 0, "unresolved": 0, "R11_not_enqueued": True, "historical_calls": HISTORY_CALLS,
})
print("R10_BOUNDARY_VERIFIED", flush=True)

for name in ("task", "opencode-stream-overlay", "host-agent"): copy_tree(SRC_RUN_DIR / name, RUN / name)
agent_path = RUN / "host-agent/intent_opencode_agent.py"
repo_agent = Path(__file__).with_name("intent_opencode_agent.py")
agent_before = repo_agent.read_text(encoding="utf-8")
assert "HOST_DISPATCH_CATEGORY" in agent_before and "_pending_retry_dispatches" in agent_before
anchor = "        self._active_round = round_num" + chr(10)
stop = """        # No-dispatch stop (wiring): do not inject the next round after a round without dispatch.
        if round_num > 2:
            audit = self._dispatch_snapshot_path.parents[3] / "audit"
            recent = [json.loads((audit / f"round-{i:02d}" / "checkpoint" / "record.json").read_text())
                      for i in (round_num - 2, round_num - 1)]
            if recent[-1]["new_dispatches"] == 0:
                raise RuntimeError("STOP_RULE: previous round produced no dispatch; next round not injected")
        # Segment gate: the previous round must end clean (no pending; only accepted legacy official failures).
        if round_num > 11:
            prev = json.loads((audit / f"round-{round_num - 1:02d}" / "checkpoint" / "record.json").read_text())
            if prev["pending"] != 0:
                raise RuntimeError(f"STOP_RULE: round {round_num - 1} ended with pending management events; next round not injected")
            data_root = self._dispatch_snapshot_path.parents[3]
            verifier = next((data_root.parents[1] / "harbor_results" / data_root.name / data_root.name).glob("task__*")) / "verifier"
            out = (verifier / f"round_{round_num - 1}_test-stdout.txt").read_text(encoding="utf-8", errors="replace")
            legacy = {"c090", "c092", "c659", "c660", "c661", "c662"}
            other = [l for l in out.splitlines() if l.startswith("CASE_RESULT") and "status=success" not in l
                     and l.split("case_id=")[1].split()[0] not in legacy]
            if other:
                raise RuntimeError(f"STOP_RULE: round {round_num - 1} has official failures outside the legacy cases ({len(other)}); next round not injected")
"""
assert anchor in agent_before
agent_path.write_text(agent_before.replace(anchor, stop + anchor, 1), encoding="utf-8")
compile(agent_path.read_text(encoding="utf-8"), "agent", "exec")

subprocess.run(["npm.cmd" if os.name == "nt" else "npm", "run", "build"], cwd=PROJECT, check=True)
assert git("rev-parse", "HEAD") == HEAD and not git("status", "--porcelain", "--", "src", "test")
runtime = RUN / "intent-compiler-runtime"; runtime.mkdir()
for name in ("dist", ".opencode", "node_modules"): copy_tree(PROJECT / name, runtime / name)
shutil.copy2(PROJECT / "package.json", runtime / "package.json")

compose_path = RUN / "task/environment/docker-compose.yaml"
compose = compose_path.read_text().replace(SRC_RUN_DIR.as_posix(), RUN.as_posix()).replace(SRC_DATA.as_posix(), DATA.as_posix())
assert f"EXPERIMENT_RUN_ID: {PARENT}" in compose and SRC_RUN not in compose
compose_path.write_text(compose, encoding="utf-8")

store = DATA / "compiler-store/v2-runs" / PARENT
copy_tree(parent_store, store)
for name, h in store_hashes.items(): assert sha(store / name) == h
copied = read(store / "snapshot.json")
copied["budget"]["max_management_requests"] = PER_BATCH
copied["budget"]["max_total_management_requests"] = TOTAL_MAX
write(store / "snapshot.json", copied)
for name in ("model", "observer-store", "audit"): (DATA / name).mkdir()
shutil.copy2(SRC_DATA / "model/opencode.json", DATA / "model/opencode.json")
shutil.copy2(SRC_DATA / "audit/capture-host.py", DATA / "audit/capture-host.py")
assert "ROUND-CHECKPOINT" in (DATA / "audit/capture-host.py").read_text()
for i in range(1, 11):
    target = DATA / "audit" / f"round-{i:02d}" / "checkpoint"
    target.mkdir(parents=True)
    shutil.copy2(SRC_DATA / "audit" / f"round-{i:02d}" / "checkpoint/record.json", target / "record.json")
for name in ("host-prepared-tools.jsonl", "management-stream.jsonl"): (DATA / "audit" / name).touch()

config = read(SRC_RUN_DIR / "intent.json")
config["job_name"] = RUN_ID; config["jobs_dir"] = str(RESULTS)
config["verifier"].update(multiround_start_round=ROUNDS[0], multiround_max_round=ROUNDS[-1],
    multiround_aggregate_start_round=1, multiround_aggregate_end_round=ROUNDS[-1],
    multiround_resume_source=str(trial), multiround_resume_state_image=meta["image_ref"],
    multiround_resume_state_archive=str(archive), multiround_resume_state_snapshot_id=meta["snapshot_id"])
config["agents"][0]["kwargs"].update(dispatch_snapshot_path=str(store / "snapshot.json"), experiment_run_id=PARENT)
config["tasks"][0]["path"] = str(RUN / "task")
assert config["n_attempts"] == 1 and config["orchestrator"]["retry"]["max_retries"] == 0
write(RUN / "intent.json", config)

copy_tree(PROJECT / "src", prov / "src")
copy_tree(Path(__file__).parent, prov / "driver")
shutil.copy2(Path(__file__), prov / "prepare.py")
for command, name in ((["rev-parse", "HEAD"], "compiler-head.txt"), (["status", "--short"], "compiler-status.txt"), (["diff", "--binary"], "compiler.patch")):
    (prov / name).write_bytes(subprocess.check_output(["git", "-C", str(PROJECT), *command]))
write(prov / "runtime-hashes.json", {p.relative_to(runtime).as_posix(): sha(p) for name in ("dist", ".opencode") for p in (runtime/name).rglob("*") if p.is_file()})
for p in sorted((PROJECT / "dist").rglob("*.js")):
    assert sha(p) == sha(runtime / "dist" / p.relative_to(PROJECT / "dist")), p
official_hashes = []
for entry in read(SRC_RUN_DIR / "provenance/official-task-hashes.json"):
    copied_file = RUN / Path(entry["copied"]).relative_to(SRC_RUN_DIR)
    assert sha(Path(entry["source"])) == sha(copied_file) == entry["sha256"]
    official_hashes.append({**entry, "copied": str(copied_file)})
write(prov / "official-task-hashes.json", official_hashes)
write(prov / "host-agent-change.json", {"base": "repository dpipe/intent_opencode_agent.py (retry host turns)", "change": "inserted the one-round no-dispatch stop rule before _active_round", "repo_sha256": hashlib.sha256(agent_before.encode()).hexdigest(), "after_sha256": sha(agent_path)})
write(prov / "run-scope.json", {
    "run_id": RUN_ID, "compiler_run_id": PARENT, "frozen_commit": HEAD, "branch": "intent-delivery-projection",
    "previous_frozen_commits": {"r3_r6": "555a8ef5126619b297f9523e114627a7c9cb8174", "r7": "4415e44ecda00fb9c9475d7fe0c3dbc8a4152636"},
    "resume": f"R10 end of {SRC_RUN}: store, workspace/session image and records from the sealed R10 checkpoint",
    "rounds": [ROUNDS[0], ROUNDS[-1]], "inputs": inputs,
    "management_budget": {"historical": HISTORY_CALLS, "per_batch": PER_BATCH, "cumulative_max": TOTAL_MAX,
                          "basis": "61 used at the R10 checkpoint + 5 rounds x 3 batches x 8"},
    "models": {"manager": "openai/gpt-6-luna-fast@high-fast", "executor": "openai/gpt-6-luna-fast@high-fast"},
    "stop_rules": ["R15 hard end", "gate before next round: pending events or non-legacy official failures", "previous round without dispatch, before next input", "existing timeouts and budgets"],
    "attempts": 1, "automatic_relaunch": False, "force_quote": False, "candidate_or_verifier_edits": False,
    "start_state": "R10 checkpoint: pending 0, 61 management calls, a-dpipe@10 executed as execution-395",
    "observer": "independent empty ledger",
    "checkpoint": "round-end capture of full compiler store, paired with Harbor per-round workspace/session image",
})
write(prov / "management-policy.json", {"prompt_timeout_ms": 300000, "cancellation_timeout_ms": 10000,
    "max_deadline_failures_per_batch": 2, "per_batch": PER_BATCH, "historical_calls": HISTORY_CALLS, "cumulative_max": TOTAL_MAX})
write(prov / "launch-authorization.json", {"source": "human authorized prepare then launch once", "paid_start_authorized": True, "automatic_retry_authorized": False})
sys.path.insert(0, str(RUN / "host-agent")); importlib.import_module("intent_opencode_agent")
from harbor.models.job.config import JobConfig
JobConfig.model_validate(config)
subprocess.run(["docker", "info", "--format", "{{.ServerVersion}}"], check=True)
probe = subprocess.run(["docker", "image", "inspect", meta["image_ref"], "--format", "{{.Id}}"], capture_output=True, text=True)
if probe.returncode:
    subprocess.run(["docker", "load", "-i", str(archive)], check=True)
    probe = subprocess.run(["docker", "image", "inspect", meta["image_ref"], "--format", "{{.Id}}"], capture_output=True, text=True, check=True)
assert probe.stdout.strip() == meta["image_ref"]
for name, h in store_hashes.items(): assert sha(parent_store / name) == h
write(prov / "preflight.json", {"status": "PASS", "frozen_commit": HEAD, "R7_boundary": "verified from bytes/store/session DB",
    "history": HISTORY_CALLS, "per_batch": PER_BATCH, "total": TOTAL_MAX, "rounds": [ROUNDS[0], ROUNDS[-1]], "paid_started": False})
summary = {"run_id": RUN_ID, "run_dir": str(RUN), "data_dir": str(DATA), "results_dir": str(RESULTS), "store": str(store), "preflight": "PASS"}
write(prov / "prepared.json", summary)
print(json.dumps(summary, indent=2), flush=True)
