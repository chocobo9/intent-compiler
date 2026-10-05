"""One authorized online R3..R6 continuation from the sealed F2 (round-02) boundary.

Same continuation recipe as the earlier quote-r3r5 run: sealed store, workspace/session
image and record are copied independently; nothing in the sealed checkpoint is modified.
Differences are recorded in provenance/run-scope.json: current frozen commit, R6 as the
end round, cumulative management cap sized for four rounds, and a host agent whose
no-dispatch stop rule fires after one round (a failed management batch must stop the run).
"""
import hashlib, importlib, json, os, shutil, sqlite3, stat, subprocess, sys, tarfile, uuid
from datetime import datetime, timezone
from pathlib import Path

PROJECT = Path(__file__).resolve().parents[4]
BASE = Path(r"D:\huawei\EvoCodeBench")
PARENT = "intent-luna-dpipe-full-r1r5-20261002-053740-e6308341"
SHA = "555a8ef5126619b297f9523e114627a7c9cb8174"
SEALED = BASE / "harbor_checkpoints" / PARENT
R2 = SEALED / "round-02"
TEMPLATE = BASE / "harbor_runs" / PARENT
RECORDS = Path(__file__).parent / "records/2026-10-02-prepared-r3-r15"
ROUNDS = (3, 4, 5, 6)
HISTORY_CALLS = 10
PER_BATCH = 8
TOTAL_MAX = HISTORY_CALLS + len(ROUNDS) * 2 * PER_BATCH  # user-input and executor-return batch per round
RUN_ID = f"intent-luna-dpipe-online-r3r6-{datetime.now(timezone.utc):%Y%m%d-%H%M%S}z-{uuid.uuid4().hex[:8]}"
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

# Frozen source identity: exact commit, clean src/test and build inputs.
assert git("rev-parse", "HEAD") == SHA
assert git("branch", "--show-current") == "intent-delivery-projection"
assert not git("status", "--porcelain", "--", "src", "test", "package.json", "package-lock.json", "tsconfig.json", "tsconfig.build.json")

# Round input integrity: official bytes == sources/round-0N.txt == allowlist hash.
official_src = Path(r"D:\huawei\EvoCodeBench\data\evocodebench_wotraj\theme_d5_w9_data_engineering_reproducibility_verification")
inputs = {}
for n in ROUNDS:
    prepared = RECORDS / f"sources/round-{n:02d}.txt"
    official = official_src / "steps" / f"round-{n}" / "instruction.md"
    allow = read(RECORDS / f"round-{n:02d}/input-allowlist.json")
    expected = next(s["sha256"] for s in allow["sources"] if s["round"] == n)
    assert prepared.read_bytes() == official.read_bytes(), f"round {n}: official bytes differ from prepared source"
    assert sha(official) == expected, f"round {n}: sha256 differs from allowlist"
    inputs[n] = {"official": str(official), "prepared": str(prepared), "sha256": expected, "bytes": official.stat().st_size}

# F2 boundary: sealed store, archive and metadata hashes, queue and execution state.
record = read(R2 / "record.json")
parent_store = Path(record["sealed_compiler_store"])
snapshot = read(parent_store / "snapshot.json")
for name, expected in record["hashes"].items(): assert sha(parent_store / name) == expected, name
assert sha(Path(record["sealed_archive"]["path"])) == record["sealed_archive"]["sha256"]
assert sha(Path(record["sealed_metadata"]["path"])) == record["sealed_metadata"]["sha256"]
rows = [json.loads(line) for line in (parent_store / "events.jsonl").read_text().splitlines() if line.strip()]
users = [row for row in rows if row["event"]["kind"] == "user_input"]
assert [row["sequence"] for row in users] == [1, 57]
assert len(snapshot["management_calls"]) == snapshot["budget"]["total_management_requests"] == HISTORY_CALLS
assert snapshot["budget"]["max_management_requests"] == PER_BATCH
assert not snapshot["pending_event_ids"] and not snapshot["unresolved_user_event_ids"]
assert len(snapshot["dispatches"]) == len(snapshot["executions"]) == 2
returns = {o["execution_id"] for o in snapshot["execution_outcomes"]}
accepted = {e for b in snapshot["management_log"] if b["status"] == "accepted" for e in b["trigger_event_ids"]}
assert all(e["status"] == "closed" and e["execution_id"] in returns and e["execution_id"]+":return" in accepted for e in snapshot["executions"])

for p in (RUN, DATA, RESULTS): p.mkdir(parents=True, exist_ok=False)
prov = RUN / "provenance"; prov.mkdir()
copy_tree(R2 / "resume-trial", RUN / "resume-trial")
trial = RUN / "resume-trial" / "task__JrtYABZ"
archive = trial / "state/round_2/snapshot-image.tar"
meta = read(trial / "state/round_2/snapshot.json")
assert sha(archive) == record["sealed_archive"]["sha256"]

app_expected = read(R2 / "original-app-files.json")
db_expected = {e["path"]: e["sha256"] for e in record["session_image_entries"] if "sha256" in e}
found = {}; db_dir = prov / "session-check"; db_dir.mkdir()
with tarfile.open(archive) as outer:
    manifest = json.load(outer.extractfile("manifest.json"))[0]
    for layer in manifest["Layers"]:
        with tarfile.open(fileobj=outer.extractfile(layer)) as inner:
            for member in inner:
                name = member.name.removeprefix("./")
                if not member.isfile() or name not in {*app_expected, *db_expected}: continue
                content = inner.extractfile(member).read()
                found[name] = hashlib.sha256(content).hexdigest()
                if name in db_expected: (db_dir / Path(name).name).write_bytes(content)
assert all(found.get(name) == entry["sha256"] for name, entry in app_expected.items())
assert all(found.get(name) == expected for name, expected in db_expected.items())
with sqlite3.connect(db_dir / "opencode-local.db") as db:
    assert db.execute("pragma integrity_check").fetchone()[0] == "ok"
    sessions = {row[0] for row in db.execute("select id from session")}
assert all(e["host_identity"] in sessions for e in snapshot["executions"])
write(prov / "recovery-source-audit.json", {
    "sealed_record": str(R2 / "record.json"), "archive_sha256": sha(archive),
    "store_hashes": record["hashes"], "image_app_and_session_hashes": found,
    "sqlite_integrity": "ok", "execution_sessions_present": True,
    "historical_calls": HISTORY_CALLS, "closed_executions_with_accepted_returns": 2,
    "user_event_sequences": [1, 57], "pending": 0, "unresolved": 0, "R3_not_enqueued": True,
})
print("R2_BOUNDARY_VERIFIED", flush=True)

# Run directory: task and overlay from the F template, compiler runtime built from the frozen commit.
for name in ("task", "opencode-stream-overlay"): copy_tree(TEMPLATE / name, RUN / name)
copy_tree(TEMPLATE / "host-agent", RUN / "host-agent")
agent_path = RUN / "host-agent/intent_opencode_agent.py"
agent_before = agent_path.read_text(encoding="utf-8")
old_stop = "            if all(record[\"new_dispatches\"] == 0 for record in recent):\n                raise RuntimeError(\"STOP_RULE: two consecutive completed rounds without dispatch; next round not injected\")"
new_stop = "            if recent[-1][\"new_dispatches\"] == 0:\n                raise RuntimeError(\"STOP_RULE: previous round produced no dispatch; next round not injected\")"
assert old_stop in agent_before
agent_path.write_text(agent_before.replace(old_stop, new_stop), encoding="utf-8")

subprocess.run(["npm.cmd" if os.name == "nt" else "npm", "run", "build"], cwd=PROJECT, check=True)
assert git("rev-parse", "HEAD") == SHA and not git("status", "--porcelain", "--", "src", "test")
runtime = RUN / "intent-compiler-runtime"; runtime.mkdir()
for name in ("dist", ".opencode", "node_modules"): copy_tree(PROJECT / name, runtime / name)
shutil.copy2(PROJECT / "package.json", runtime / "package.json")

compose_path = RUN / "task/environment/docker-compose.yaml"
compose = compose_path.read_text().replace((BASE / "harbor_runs" / PARENT).as_posix(), RUN.as_posix()).replace((BASE / "harbor_intent_data" / PARENT).as_posix(), DATA.as_posix())
assert f"EXPERIMENT_RUN_ID: {PARENT}" in compose
compose_path.write_text(compose, encoding="utf-8")

store = DATA / "compiler-store/v2-runs" / PARENT
copy_tree(parent_store, store)
for name, expected in record["hashes"].items(): assert sha(store / name) == expected
# Only the copied snapshot's budget changes: per-batch cap stays 8, cumulative cap covers four rounds.
copied = read(store / "snapshot.json")
copied["budget"]["max_management_requests"] = PER_BATCH
copied["budget"]["max_total_management_requests"] = TOTAL_MAX
write(store / "snapshot.json", copied)
for name in ("model", "observer-store", "audit"): (DATA / name).mkdir()
shutil.copy2(BASE / "harbor_intent_data" / PARENT / "model/opencode.json", DATA / "model/opencode.json")
shutil.copy2(TEMPLATE / "provenance/driver/capture-host.py", DATA / "audit/capture-host.py")
assert "ROUND-CHECKPOINT" in (DATA / "audit/capture-host.py").read_text()
for i in (1, 2):
    target = DATA / "audit" / f"round-{i:02d}" / "checkpoint"
    target.mkdir(parents=True)
    shutil.copy2(SEALED / f"round-{i:02d}" / "original-checkpoint-record.json", target / "record.json")
for name in ("host-prepared-tools.jsonl", "management-stream.jsonl"): (DATA / "audit" / name).touch()

config = read(TEMPLATE / "intent.json")
config["job_name"] = RUN_ID; config["jobs_dir"] = str(RESULTS)
config["verifier"].update(multiround_start_round=3, multiround_max_round=6,
    multiround_aggregate_start_round=1, multiround_aggregate_end_round=6,
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
official = []
for entry in read(TEMPLATE / "provenance/official-task-hashes.json"):
    copied_file = RUN / Path(entry["copied"]).relative_to(TEMPLATE)
    assert sha(Path(entry["source"])) == sha(copied_file) == entry["sha256"]
    official.append({**entry, "copied": str(copied_file)})
write(prov / "official-task-hashes.json", official)
write(prov / "host-agent-change.json", {
    "base": str(TEMPLATE / "host-agent/intent_opencode_agent.py"),
    "change": "no-dispatch stop rule: two consecutive rounds -> one round (a failed management batch stops the run)",
    "before_sha256": hashlib.sha256(agent_before.encode()).hexdigest(), "after_sha256": sha(agent_path)})
write(prov / "run-scope.json", {
    "run_id": RUN_ID, "compiler_run_id": PARENT, "frozen_commit": SHA, "branch": "intent-delivery-projection",
    "resume": "sealed F2 (round-02) store, workspace/session image and record copied independently",
    "rounds": [3, 6], "inputs": inputs,
    "management_budget": {"historical": HISTORY_CALLS, "per_batch": PER_BATCH, "cumulative_max": TOTAL_MAX,
                          "basis": "4 rounds x (user-input batch + executor-return batch) x 8"},
    "models": {"manager": "openai/gpt-6-luna-fast@high-fast", "executor": "openai/gpt-6-luna-fast@high-fast"},
    "stop_rules": ["R6 hard end", "previous round without dispatch, before next input", "existing timeouts and budgets"],
    "attempts": 1, "automatic_relaunch": False, "force_quote": False, "candidate_or_verifier_edits": False,
    "offline_r3_r6_artifacts_used": False,
    "observer": "independent empty ledger; original post-R2 observer not imported",
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
for name, expected in record["hashes"].items(): assert sha(parent_store / name) == expected
assert sha(Path(record["sealed_archive"]["path"])) == record["sealed_archive"]["sha256"]
write(prov / "preflight.json", {"status": "PASS", "frozen_commit": SHA, "R2_boundary": "verified from bytes/store/session DB",
    "history": HISTORY_CALLS, "per_batch": PER_BATCH, "total": TOTAL_MAX, "rounds": [3, 6], "paid_started": False})
summary = {"run_id": RUN_ID, "run_dir": str(RUN), "data_dir": str(DATA), "results_dir": str(RESULTS), "store": str(store), "preflight": "PASS"}
write(prov / "prepared.json", summary)
print(json.dumps(summary, indent=2), flush=True)
