"""Watchdog for SDD runs whose model request hangs (v6 pilot, user 2026-10-16).

A stage's model stream can go silent and never return (v6 R1 SpecArt, SDD-only R14): neither OpenCode
nor SDD's flow has a timeout, so the round waits forever. Activity is read from what the run writes:
the stage streams under runs/<r>/logs and every OpenCode part of every session in the run directory
(SpecArt's sub-agents write only there). No activity for IDLE_MINUTES (RUNNING_TOOL_MINUTES while a
bash tool is still running) means a hang: the run's own OpenCode processes are stopped and the fact is
recorded in watchdog.json; the stop is then a T fault (D1 reruns it once before coding; D4 records it
in coding). Thresholds come from the silences of 126 recorded SDD runs: an open model stream recovered
after at most 25.4 minutes; the hangs were silent for 30+ and 110 minutes.
"""
import datetime as dt
import json
import os
import sqlite3
import subprocess
import time
from pathlib import Path

IDLE_MINUTES = 40
RUNNING_TOOL_MINUTES = 90
DB = Path(os.environ.get('OPENCODE_DB') or Path.home() / '.local/share/opencode/opencode.db')


def _norm(path):
    return str(path).replace('\\', '/').rstrip('/').lower()


def activity(run_dir, db=DB):
    """(last activity in epoch seconds, whether a bash tool is running at that point, where it came from)."""
    run_dir = Path(run_dir)
    last, where, running = 0.0, None, False
    logs = run_dir / 'logs'
    for p in (logs.glob('*.stream') if logs.exists() else []):
        m = p.stat().st_mtime
        if m > last:
            last, where = m, f'stream {p.name}'
    if Path(db).exists():
        try:
            c = sqlite3.connect(f'file:{Path(db).as_posix()}?mode=ro', uri=True, timeout=5)
            sids = [s for s, d in c.execute('select id, directory from session') if d and _norm(d) == _norm(run_dir)]
            for sid in sids:
                row = c.execute('select time_updated, data from part where session_id=? order by time_updated desc limit 1', (sid,)).fetchone()
                if row and row[0] / 1000 > last:
                    d = json.loads(row[1])
                    last, where = row[0] / 1000, f'session {sid} part {d.get("type")}'
                    running = d.get('type') == 'tool' and d.get('tool') == 'bash' and (d.get('state') or {}).get('status') == 'running'
            c.close()
        except sqlite3.Error as error:
            where = f'{where} (OpenCode store not readable: {error})'
    return last, running, where


def run_processes(run_dir):
    """PIDs of OpenCode processes working on this run directory."""
    target = _norm(run_dir)
    out = subprocess.run(['powershell', '-NoProfile', '-Command',
                          "Get-CimInstance Win32_Process | Where-Object { $_.Name -like 'opencode*' } | ForEach-Object { \"$($_.ProcessId)`t$($_.CommandLine)\" }"],
                         capture_output=True, text=True, encoding='utf-8', errors='replace')
    pids = []
    for line in out.stdout.splitlines():
        pid, _, cmd = line.partition('\t')
        if pid.strip().isdigit() and target in _norm(cmd):
            pids.append(int(pid))
    return pids


def check(trial, now=None, db=DB, kill=True):
    """None while the run is alive or already handled; the record written to watchdog.json when it fires."""
    trial = Path(trial)
    marker = trial / 'watchdog.json'
    if marker.exists() or (trial / 'completion.json').exists():
        return None
    import run_r1
    run = run_r1.run_directory(trial)
    if not run or not Path(run).exists():
        return None
    last, running, where = activity(run, db)
    if not last:
        return None
    now = now or time.time()
    limit = RUNNING_TOOL_MINUTES if running else IDLE_MINUTES
    idle = (now - last) / 60
    if idle < limit:
        return None
    pids = run_processes(run) if kill else []
    if kill and not pids:
        return None  # nothing of the run is working on a model call: not a hang this watchdog handles
    for pid in pids:
        subprocess.run(['taskkill', '/PID', str(pid), '/T', '/F'], capture_output=True)
    record = {'fired': dt.datetime.now(dt.timezone.utc).isoformat(), 'idle_minutes': round(idle, 1), 'limit_minutes': limit,
              'last_activity': dt.datetime.fromtimestamp(last, dt.timezone.utc).isoformat(), 'last_activity_at': where,
              'bash_tool_running': running, 'stopped_pids': pids,
              'reason': f'no model activity for {idle:.0f} minutes (limit {limit}): request hang'}
    marker.write_text(json.dumps(record, ensure_ascii=False, indent=2), encoding='utf-8')
    return record
