"""Run checkable acceptance examples against delivered code, in docker without network.

The code directory is copied, never modified. The program is built with the
task's build command form (go build -o dpipe ./...) inside the same image SDD
uses; each example runs in its own working directory with its input files.
"""
import json
import os
from pathlib import Path
import shlex
import shutil
import subprocess
import tempfile

IMAGE = 'sdd-unattended-preflight:latest'
# Short local path (docker mounts it); temporary directories under it are removed after each run.
WORK_ROOT = Path(os.environ.get('IC_EXAMPLE_WORK') or Path(__file__).resolve().parent / '.example-runs')
SKIP = {'.git', '.specart', '.specart-verify', '.system-design', 'dpipe', 'dpipe.exe'}


def norm(text):
    return (text or '').replace('\r\n', '\n')


def lines_in_order(expected, text):
    """Every expected line appears in text: '=' lines as whole lines in this order, '~' parts anywhere in a line (a set, in any order)."""
    got = [l.rstrip() for l in text.replace('\r\n', '\n').split('\n')]
    whole = [e[1:] if e[:1] == '=' else e for e in expected if e[:1] != '~']
    parts = [e[1:] for e in expected if e[:1] == '~']
    if not all(any(p in line for line in got) for p in parts):
        return False
    j = 0
    for want in whole:
        while j < len(got) and got[j] != want.rstrip():
            j += 1
        if j == len(got):
            return False
        j += 1
    return True


def same_json(expected, got):
    """Whether two JSON texts hold the same value (object key order and number spelling aside); None when either is not JSON."""
    try:
        return json.loads(expected) == json.loads(got)
    except ValueError:
        return None


def csv_records(text):
    """A CSV text as its records, each field unquoted and joined by commas (how a requirement writes rows)."""
    import csv
    import io
    try:
        return '\n'.join(','.join(row) for row in csv.reader(io.StringIO(text)))
    except csv.Error:
        return text


def evaluate_asserts(exit_code, asserts, out):
    """Assertions built by IC from the requirement text: where (stdout, stderr, either, file:<path>), mode (exact, contains, pattern, lines, exists: the file was written, absent: the text appears nowhere)."""
    import re
    failures = []
    if exit_code is not None and out['exit_code'] != exit_code:
        failures.append(f"exit code {out['exit_code']} (expected {exit_code})")
    for a in asserts:
        where = a['where']
        if where.startswith('file:'):
            got = out['files'].get(where[5:])
            if got is None:
                failures.append(f"no output file {where[5:]}")
                continue
            texts = [norm(got)] + ([csv_records(norm(got))] if where.lower().endswith('.csv') else [])
        else:
            texts = [norm(out[s]) for s in (['stdout', 'stderr'] if where == 'either' else [where])]
        if a['mode'] == 'exists':
            continue
        if a['mode'] == 'absent':
            ok = not any(a['value'] in t for t in texts)
        elif a['mode'] == 'exact':
            whole = same_json(a['value'], texts[0]) if where.lower().endswith('.json') else None
            ok = whole if whole is not None else any(t.strip() == a['value'].strip() for t in texts)
        elif a['mode'] == 'contains':
            ok = any(a['value'] in t for t in texts)
        elif a['mode'] == 'lines':
            expected = json.loads(a['value'])
            whole = same_json('\n'.join(e[1:] for e in expected if e[:1] == '='), texts[0]) if where.lower().endswith('.json') else None
            ok = whole if whole is not None and all(e[:1] == '=' for e in expected) else any(lines_in_order(expected, t) for t in texts)
        else:
            ok = any(re.search(a['value'], t) for t in texts)
        if not ok:
            failures.append(f"{where} {a['mode']} {a['value'][:80]!r} not met (got {' | '.join(t.strip()[:100] for t in texts)!r})")
    return failures


def evaluate(check, out):
    """Each expectation against the observed run; a list of failure descriptions (empty: pass)."""
    failures = []
    if check.get('exit_code') is not None and out['exit_code'] != check['exit_code']:
        failures.append(f"exit code {out['exit_code']} (expected {check['exit_code']})")
    stdout, stderr = norm(out['stdout']), norm(out['stderr'])
    if check.get('stdout_exact') is not None and stdout.strip() != norm(check['stdout_exact']).strip():
        failures.append(f"stdout {stdout.strip()[:120]!r} (expected {norm(check['stdout_exact']).strip()[:120]!r})")
    for part in check.get('stdout_contains', []):
        if norm(part) not in stdout:
            failures.append(f"stdout lacks {part[:80]!r} (got {stdout.strip()[:120]!r})")
    for part in check.get('stderr_contains', []):
        if norm(part) not in stderr:
            failures.append(f"stderr lacks {part[:80]!r} (got {stderr.strip()[:120]!r})")
    for f in check.get('files', []):
        content = out['files'].get(f['path'])
        if content is None:
            failures.append(f"no output file {f['path']}")
            continue
        content = norm(content)
        if f.get('exact') is not None and content.rstrip('\n') != norm(f['exact']).rstrip('\n'):
            failures.append(f"{f['path']} content differs (got {content[:120]!r})")
        for part in f.get('contains', []):
            if norm(part) not in content:
                failures.append(f"{f['path']} lacks {part[:80]!r}")
    return failures


def run_examples(code_dir, examples, timeout=900):
    """examples: [{id, run, check}] -> [{id, passed, failures, observed}] (build failure: every example fails)."""
    WORK_ROOT.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='ic-examples-', dir=WORK_ROOT) as tmp:
        tmp = Path(tmp)
        shutil.copytree(code_dir, tmp / 'src', ignore=lambda d, names: [n for n in names if n in SKIP])
        lines = ['set -u', 'cd /app/src && go build -o /tmp/dpipe ./... > /app/build.log 2>&1; echo $? > /app/build.exit']
        for i, ex in enumerate(examples):
            work = tmp / 'ex' / str(i) / 'work'
            work.mkdir(parents=True)
            for f in ex['run']['files']:
                target = work / f['path']
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_text(f['content'], encoding='utf-8', newline='')
            (tmp / 'ex' / str(i) / 'before.json').write_text(json.dumps(sorted(str(p.relative_to(work)).replace('\\', '/') for p in work.rglob('*') if p.is_file())), encoding='utf-8')
            stdin = ex['run'].get('stdin')
            if stdin is not None:
                (tmp / 'ex' / str(i) / 'stdin').write_text(stdin, encoding='utf-8', newline='')
            redirect = f'< /app/ex/{i}/stdin' if stdin is not None else '< /dev/null'
            args = ' '.join(shlex.quote(a) for a in ex['run']['args'])
            lines.append(f'cd /app/ex/{i}/work && timeout 20 /tmp/dpipe {args} {redirect} > /app/ex/{i}/stdout 2> /app/ex/{i}/stderr; echo $? > /app/ex/{i}/exit')
        (tmp / 'run.sh').write_text('\n'.join(lines) + '\n', encoding='utf-8', newline='\n')
        done = subprocess.run(['docker', 'run', '--rm', '--network', 'none', '--mount', f'type=bind,source={tmp},target=/app',
                               '--workdir', '/app', '--entrypoint', '/bin/bash', IMAGE, '/app/run.sh'], capture_output=True, text=True, timeout=timeout)
        build_exit = (tmp / 'build.exit').read_text().strip() if (tmp / 'build.exit').exists() else 'missing'
        results = []
        for i, ex in enumerate(examples):
            base = tmp / 'ex' / str(i)
            if build_exit != '0' or not (base / 'exit').exists():
                results.append({'id': ex['id'], 'passed': False, 'failures': [f'build exit {build_exit}' if build_exit != '0' else 'did not run'], 'observed': None})
                continue
            work = base / 'work'
            before = set(json.loads((base / 'before.json').read_text(encoding='utf-8')))
            files = {str(p.relative_to(work)).replace('\\', '/'): p.read_text(encoding='utf-8', errors='replace') for p in work.rglob('*') if p.is_file()}
            out = {'exit_code': int((base / 'exit').read_text().strip() or -1), 'stdout': (base / 'stdout').read_text(encoding='utf-8', errors='replace'),
                   'stderr': (base / 'stderr').read_text(encoding='utf-8', errors='replace'), 'files': files}
            failures = evaluate_asserts(ex.get('exit_code'), ex['asserts'], out) if 'asserts' in ex else evaluate(ex['check'], out)
            results.append({'id': ex['id'], 'passed': not failures, 'failures': failures,
                            'observed': {'exit_code': out['exit_code'], 'stdout': out['stdout'][:300], 'stderr': out['stderr'][:300],
                                         'new_files': sorted(set(files) - before)}})
        return {'build_exit': build_exit, 'docker_exit': done.returncode, 'docker_stderr': done.stderr[-500:], 'results': results}
