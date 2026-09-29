"""Save per-round evidence before Harbor starts another round or deletes the container."""
import argparse
import json
import shutil
import sqlite3
from pathlib import Path

parser = argparse.ArgumentParser()
parser.add_argument("--round", type=int, required=True)
args = parser.parse_args()
if args.round < 1 or args.round > 15:
    raise ValueError("round must be in 1..15")
root = Path("/opt/intent-data/audit") / f"round-{args.round:02d}"
root.mkdir(parents=True, exist_ok=True)
logs = Path("/logs/agent")
if logs.is_dir():
    shutil.copytree(logs, root / "executor", dirs_exist_ok=True)
host_log = Path("/root/.local/share/opencode/log/opencode.log")
if host_log.is_file():
    shutil.copy2(host_log, root / "opencode.log")
database = Path("/root/.local/share/opencode/opencode-local.db")
if database.is_file():
    with sqlite3.connect(f"file:{database}?mode=ro", uri=True) as connection:
        connection.row_factory = sqlite3.Row
        # Do not export the entire database: it also contains authentication tables.
        for table in ("message", "part", "session"):
            rows = [dict(row) for row in connection.execute("select * from " + table)]
            (root / f"host-{table}.json").write_text(json.dumps(rows, ensure_ascii=False), encoding="utf-8")
print(f"Saved round {args.round} executor and selected host records to {root}")
