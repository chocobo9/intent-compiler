import json
import time

import costs
import watchdog


def trial(tmp_path):
    (tmp_path / 'runs/r1/logs').mkdir(parents=True)
    (tmp_path / 'round.json').write_text(json.dumps({'round': 1}))
    return tmp_path


def test_a_run_silent_past_the_limit_is_stopped_once_and_recorded(tmp_path, monkeypatch):
    t = trial(tmp_path)
    now = time.time()
    killed = []
    monkeypatch.setattr(watchdog, 'activity', lambda run, db=None: (now - 41 * 60, False, 'session s part reasoning'))
    monkeypatch.setattr(watchdog, 'run_processes', lambda run: [4242])
    monkeypatch.setattr(watchdog.subprocess, 'run', lambda args, **k: killed.append(args))
    fired = watchdog.check(t, now)
    assert fired['stopped_pids'] == [4242] and fired['limit_minutes'] == 40 and 'request hang' in fired['reason']
    assert killed and killed[0][:3] == ['taskkill', '/PID', '4242']
    assert json.loads((t / 'watchdog.json').read_text())['idle_minutes'] >= 41
    assert watchdog.check(t, now) is None, 'fires once per trial'


def test_a_running_bash_tool_or_a_short_silence_is_left_alone(tmp_path, monkeypatch):
    t = trial(tmp_path)
    now = time.time()
    monkeypatch.setattr(watchdog, 'run_processes', lambda run: [1])
    monkeypatch.setattr(watchdog, 'activity', lambda run, db=None: (now - 39 * 60, False, 'x'))
    assert watchdog.check(t, now) is None
    monkeypatch.setattr(watchdog, 'activity', lambda run, db=None: (now - 60 * 60, True, 'tool bash running'))
    assert watchdog.check(t, now) is None, 'a long build or test is not a hang before RUNNING_TOOL_MINUTES'
    monkeypatch.setattr(watchdog, 'run_processes', lambda run: [])
    monkeypatch.setattr(watchdog, 'activity', lambda run, db=None: (now - 120 * 60, False, 'x'))
    assert watchdog.check(t, now) is None, 'no OpenCode process of the run: nothing to stop'


def test_a_watchdog_stop_is_a_tool_fault(tmp_path):
    t = trial(tmp_path)
    (t / 'watchdog.json').write_text(json.dumps({'reason': 'no model activity for 41 minutes (limit 40): request hang'}))
    stop = costs.stop_record(t, {'results': {'design': {}}}, {'failure': {'stopped_stage': 'specart', 'stage_conclusion': '<!--VERDICT:{"skill":"specart","pass":true}-->'}})
    assert stop['class'] == 'T' and any('watchdog' in f for f in stop['tool_fault'])
