"""Launch a prepared R10 online continuation exactly once, hidden. Usage: launch-resume-r3r6.py <run_dir>"""
import hashlib, json, os, shutil, subprocess, sys
from datetime import datetime, timezone
from pathlib import Path

run = Path(sys.argv[1])
info = json.loads((run / "provenance/prepared.json").read_text(encoding="utf-8"))
assert Path(info["run_dir"]) == run
config = json.loads((run / "intent.json").read_text(encoding="utf-8"))
preflight = json.loads((run / "provenance/preflight.json").read_text(encoding="utf-8"))
assert preflight["status"] == "PASS" and not preflight["paid_started"]
assert config["n_attempts"] == 1 and config["orchestrator"]["retry"]["max_retries"] == 0
assert (config["verifier"]["multiround_start_round"], config["verifier"]["multiround_max_round"]) == (10, 10)
manifest = json.loads((run / "provenance/runtime-hashes.json").read_text(encoding="utf-8"))
for name, expected in manifest.items():
    assert hashlib.sha256((run / "intent-compiler-runtime" / name).read_bytes()).hexdigest() == expected, name
snapshot = json.loads(Path(config["agents"][0]["kwargs"]["dispatch_snapshot_path"]).read_text(encoding="utf-8"))
assert snapshot["budget"]["total_management_requests"] == preflight["history"]
assert snapshot["budget"]["max_total_management_requests"] == preflight["total"]
assert snapshot["budget"]["max_management_requests"] == preflight["per_batch"]
assert not snapshot["pending_event_ids"] and not snapshot["unresolved_user_event_ids"]
(run / "launch-once.lock").touch(exist_ok=False)
shutil.copy2(Path(__file__), run / "provenance/launch-once.py")
command = [r"D:\huawei\harbor_multiturn\.venv\Scripts\harbor.exe", "run", "-c", str(run / "intent.json")]
env = dict(os.environ, PYTHONUTF8="1", PYTHONIOENCODING="utf-8", PYTHONPATH=str(run / "host-agent"))
with (run / "harbor-launch.log").open("x", encoding="utf-8") as output:
    process = subprocess.Popen(command, cwd=r"D:\huawei\intent_compiler\project", env=env,
        stdin=subprocess.DEVNULL, stdout=output, stderr=subprocess.STDOUT,
        creationflags=subprocess.CREATE_NO_WINDOW | subprocess.CREATE_NEW_PROCESS_GROUP, close_fds=True)
record = {**info, "pid": process.pid, "started_at": datetime.now(timezone.utc).isoformat(), "command": command}
(run / "provenance/launch.json").write_text(json.dumps(record, indent=2) + "\n", encoding="utf-8")
print(json.dumps(record, indent=2), flush=True)
