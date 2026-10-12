"""In-round acceptance and targeted repair (IC arm), run between SDD's return and IC's reconcile.

1. Accept: units the requirements name that the code never dispatches on (static_units),
   and code-built error-path probes (error_probes). No model, no invented data.
2. Report: each failure as a GAP in SDD's own prd-check report format.
3. Repair: SDD's own prd-fix skill, with the prompt template of the prepared workflow.
4. Re-check by code, per unit: scope, PRD unchanged, no deleted tests, build and tests,
   failures fixed, no regression. Adopt, or one more pass, or revert to the code SDD returned.
5. Re-score the adopted code with the official verifier; the score SDD's code got is kept.

Original records are never overwritten: SDD's report, its code and its official result
are archived under acceptance/ in the trial.
"""
import datetime as dt
import hashlib
import json
import re
import shutil
import subprocess
from pathlib import Path

import run_r1
from error_probes import probes
from example_runner import run_examples
from static_units import missing, units
import drift_labels

PRD = 'output/02-澄清后PRD.md'
REPORT = 'output/08-验证结果.md'
MAX_PASSES = 2
BUILD = 'build:requested'
SKIP = ('.specart', '.specart-verify', '.system-design', '.verdict.md', '.coding-done', '.sdd-build', '.git')


def texts_upto(n):
    return [(run_r1.OFFICIAL / f'steps/round-{k}/instruction.md').read_text(encoding='utf-8') for k in range(1, n + 1)]


def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def code_files(main):
    return {str(p.relative_to(main)).replace('\\', '/'): sha(p) for p in Path(main).rglob('*')
            if p.is_file() and not any(part.startswith(SKIP) for part in p.relative_to(main).parts) and p.name not in ('dpipe', 'dpipe.exe')}


def details(failures):
    """What IC tells SDD about each failing check: subject and the observed behaviour."""
    out = {}
    for cid, f in failures.items():
        if f['kind'] == 'unit':
            kind, name = f['unit']
            out[cid] = {'subject': f'`{name}` ({kind}) is not implemented', 'unit': name, 'round': f.get('round'),
                        'observed': f'No non-test source dispatches on "{name}" (case, map key or comparison).'}
        elif f['kind'] == 'build':
            out[cid] = {'subject': 'the code does not pass the required build and tests (`go build -o dpipe ./... && go test ./...`)',
                        'observed': f['output'][-600:]}
        else:
            p, obs = f['probe'], f['observed'] or {}
            out[cid] = {'subject': f"error rule not met: {p['id']}", 'rule': p['rule'], 'args': p['run']['args'],
                        'observed': f"dpipe {' '.join(p['run']['args'])} -> exit {obs.get('exit_code')}, stderr {(obs.get('stderr') or '').strip()[:200]!r}"}
    return out


def accept(main, texts):
    """Failing checks on the code at main: {check id: detail}."""
    named = units(texts)
    failures = {}
    for kind, name in missing(main, list(named)):
        failures[f'unit:{kind}:{name}'] = {'kind': 'unit', 'unit': (kind, name), 'round': named[(kind, name)] + 1}
    rc, output = build_and_test(main)
    if rc != 0:
        # Code that does not build and pass its tests cannot be probed; the build failure itself is the finding.
        failures[BUILD] = {'kind': 'build', 'output': output}
        return failures, {'build_exit': str(rc), 'checks': len(named) + 1}
    ps = probes(texts, len(texts))
    res = run_examples(main, ps)
    for p, r in zip(ps, res['results']):
        bad = list(r['failures'])
        if p.get('nonzero') and r['observed'] and r['observed']['exit_code'] == 0:
            bad.append('exit code 0 (expected non-zero)')
        if bad:
            failures[f"probe:{p['id']}"] = {'kind': 'probe', 'probe': p, 'failures': bad, 'observed': r['observed']}
    return failures, {'build_exit': res['build_exit'], 'checks': len(named) + len(ps)}


def _section(texts, name):
    for n, t in enumerate(texts, 1):
        lines = t.splitlines()
        for i, line in enumerate(lines):
            h = re.match(r'^(#{2,4})\s', line)
            if h and f'`{name}`' in line:
                level = len(h.group(1))
                end = next((j for j in range(i + 1, len(lines)) if re.match(r'^#{1,%d}\s' % level, lines[j])), len(lines))
                return n, '\n'.join(lines[i:end]).strip()
    return None, ''


def _prd_lines(prd, name):
    return [(i, line.strip()[:400]) for i, line in enumerate(prd.splitlines(), 1) if f'`{name}`' in line or re.search(r'\b' + re.escape(name) + r'\b', line)][:2]


def judge(before, after):
    """(fixed, regressed). Probes never ran on code that did not build, so after a build failure is fixed
    the probes it reveals are not regressions; a build that breaks is."""
    fixed = sorted(set(before) - set(after))
    comparable = {k for k in after if not (BUILD in before and k.startswith('probe:'))}
    return fixed, sorted(comparable - set(before))


def report(failures, texts, prd_text):
    gaps = []
    for k, (cid, f) in enumerate(sorted(failures.items()), 1):
        if f['kind'] == 'unit':
            kind, name = f['unit']
            rn, sec = _section(texts, name)
            lines = _prd_lines(prd_text, name)
            gaps.append(f"""#### GAP-{k:03d} `{name}`（{kind}）未实现

- PRD 坐标：{'；'.join(f'`{PRD}#第{i}行`' for i, _ in lines) or f'`{PRD}`（未检索到）'}
- 代码证据：`repos/main/**/*.go`（不含测试）中没有在任何分派位置（case、映射键、比较）出现 `"{name}"`。
- 差异类型：`PRD_ONLY`
- 差异说明：需求定义了 `{name}`，更新后代码没有实现。
- PRD 原描述：{' / '.join(t for _, t in lines) or '（PRD 中未检索到）'}
- 原始需求（第 {rn} 轮，逐字）：

{sec}

- PRD_ONLY 二次核验：检索 `"{name}"` 的分派位置，范围 `repos/main/**/*.go`（排除测试），无命中。
- 评审建议方向：建议改代码（仅建议，不执行）。
""")
        elif f['kind'] == 'build':
            gaps.append(f"""#### GAP-{k:03d} 代码不能通过要求的构建与测试命令

- PRD 坐标：`{PRD}`（交付要求）
- 差异类型：`MISMATCH`
- 差异说明：任务要求的构建命令 `go build -o dpipe ./... && go test ./...`（在本任务的 docker 构建环境中执行）失败；修复使其通过，不得删除或削弱已有测试的断言来规避失败。
- 输出末尾：

```
{f['output'][-1500:]}
```

- 评审建议方向：建议改代码（仅建议，不执行）。
""")
        else:
            p = f['probe']
            obs = f['observed'] or {}
            gaps.append(f"""#### GAP-{k:03d} 报错行为与需求不符：`{p['id']}`

- PRD 坐标：`{PRD}`（报错规则）
- 原始需求（逐字）：{p['rule']}
- 差异类型：`MISMATCH`
- 差异说明：按需求触发该报错规则时，程序输出与需求写明的文本或退出码不符。
- 复现命令：`dpipe {' '.join(p['run']['args'])}`（输入文件：{', '.join(x['path'] for x in p['run']['files']) or '无，全部输入路径不存在'}）
- 代码实际行为：退出码 {obs.get('exit_code')}；stderr `{(obs.get('stderr') or '').strip()[:200]}`
- 评审建议方向：建议改代码（仅建议，不执行）。
""")
    n = len(gaps)
    return f"""# PRD 一致性检查报告

> 本报告由管理层（IC）当轮验收生成：依据原始需求与 PRD，对更新后代码做静态检索和按需求报错规则的实际调用。只列出确认的差异。

## 1. 输入基线

- PRD：`{PRD}`
- 更新后代码仓：`repos/main/`
- 生成日期：{dt.date.today().isoformat()}

## 3. 差异统计

- 差异总数：{n}
- 按类型：`CODE_ONLY` 0 / `PRD_ONLY` {sum(f['kind'] == 'unit' for f in failures.values())} / `MISMATCH` {sum(f['kind'] in ('probe', 'build') for f in failures.values())}

## 4. 板块差异明细

{chr(10).join(gaps)}

<!--VERDICT:{{"skill":"prd-check","pass":true,"unresolved":{n},"blocked":0,"manual_review":0}}-->
"""


CONTINUE_CODING_SESSION = True
# A continued session that writes nothing for this long is given up (smoke 2026-10-11: one produced
# no output in 10 minutes); prd-fix then runs in a new session.
CONTINUE_FIRST_OUTPUT_SECONDS = 300


def _call_watched(args, log, env, cwd, first_output_seconds, timeout=3600):
    """Run args with output to log; None when nothing is written within first_output_seconds (process killed)."""
    import time
    with open(log, 'w', encoding='utf-8') as out:
        proc = subprocess.Popen(args, stdout=out, stderr=subprocess.STDOUT, env=env, cwd=str(cwd))
        started = time.monotonic()
        while proc.poll() is None:
            elapsed = time.monotonic() - started
            if elapsed > first_output_seconds and Path(log).stat().st_size == 0 or elapsed > timeout:
                subprocess.run(['taskkill', '/PID', str(proc.pid), '/T', '/F'], capture_output=True)
                proc.wait()
                return None
            time.sleep(5)
        return proc.returncode


def coding_session(run):
    """The session id of this round's coding stage, from its stream (None when absent)."""
    stream = Path(run) / 'logs/coding-main.stream'
    if not stream.exists():
        return None
    m = re.search(r'"sessionID":"(ses_[A-Za-z0-9]+)"', stream.read_text(encoding='utf-8', errors='replace'))
    return m.group(1) if m else None


def _stream_ok(log):
    """The run produced model steps (a continued session that cannot be found produces none)."""
    text = Path(log).read_text(encoding='utf-8', errors='replace') if Path(log).exists() else ''
    return '"type":"step_finish"' in text


def prdfix(trial, env, log):
    """SDD's prd-fix; like SDD's original code-fix stage, it continues the coding session when it can, else starts a new one."""
    run = run_r1.run_directory(trial)
    w = json.loads((run / 'workflow-cli.json').read_text(encoding='utf-8'))
    s = w['skills']['prd-fix']
    mode = s.get('prompt_modes', {}).get('unattended', {})
    nodes = {k: v['path'].replace('${path_suffix}', '') for k, v in w['nodes'].items()}
    prompt = s['prompt_template'].replace('${prompt_mode_prefix}', mode.get('mode_prefix', '')).replace('${prompt_mode_suffix}', mode.get('mode_suffix', ''))
    for k in ('2', '3', '4', '7', '8'):
        prompt = prompt.replace('${n%s_path}' % k, nodes[k])
    base = ['C:/Program Files/Git/usr/bin/sh.exe', env['OPENCODE_BIN'], 'run', '--agent', 'build', '--dir', str(run).replace('\\', '/'),
            '--format', 'json', '--auto', '--model', run_r1.MODEL, '--variant', run_r1.VARIANT]
    session = coding_session(run) if CONTINUE_CODING_SESSION else None
    if session:
        rc = _call_watched(base + ['--session', session, '--', prompt], log, env, run, first_output_seconds=CONTINUE_FIRST_OUTPUT_SECONDS)
        if rc is not None and _stream_ok(log):
            return rc, prompt, session
        Path(log).rename(Path(log).with_suffix('.continue-failed'))
    with open(log, 'w', encoding='utf-8') as out:
        return subprocess.call(base + ['--', prompt], stdout=out, stderr=subprocess.STDOUT, env=env, cwd=str(run), timeout=3600), prompt, None


def build_and_test(main):
    done = subprocess.run(['docker', 'run', '--rm', '--network', 'none', '--mount', f'type=bind,source={main},target=/app', '--workdir', '/app',
                           '--entrypoint', '/bin/bash', 'sdd-unattended-preflight:latest', '-lc', 'go build -o dpipe ./... && go test ./...'],
                          capture_output=True, text=True, encoding='utf-8', errors='replace')
    return done.returncode, (done.stdout + done.stderr)[-2000:]


def restore(src, dst):
    for p in list(Path(dst).iterdir()):
        if p.name in ('.git',):
            continue
        shutil.rmtree(p) if p.is_dir() else p.unlink()
    for p in Path(src).iterdir():
        (shutil.copytree(p, Path(dst) / p.name) if p.is_dir() else shutil.copy2(p, Path(dst) / p.name))


def repair_trial(trial, round_number, env, previous_failing=None):
    """Run acceptance and repair on a returned trial; return the record written into completion.json."""
    trial = Path(trial)
    run = run_r1.run_directory(trial)
    main = run / 'repos/main'
    work = trial / 'acceptance'
    if work.exists():
        # An interrupted earlier attempt: put back the code SDD returned and SDD's report, then start over.
        if (work / 'sdd-main').exists():
            restore(work / 'sdd-main', main)
        if (work / '08-sdd-report.md').exists():
            shutil.copy2(work / '08-sdd-report.md', run / REPORT)
        if (work / 'prd-sdd.md').exists():
            shutil.copy2(work / 'prd-sdd.md', run / PRD)
        shutil.move(work, trial / ('acceptance-interrupted-' + dt.datetime.now().strftime('%H%M%S')))
    work.mkdir()
    texts = texts_upto(round_number)
    record = {'started': dt.datetime.now(dt.timezone.utc).isoformat(), 'passes': []}
    before, info = accept(main, texts)
    record.update(checks=info['checks'], failing_before=sorted(before), details=details(before))
    # P2: a failure whose unit carries PRD assumptions contradicting the requirement is not given to
    # prd-fix (it repairs toward the PRD); it stays open and goes to the next round's CI.
    candidates = drift_labels.p2_candidates(trial, before)
    record['p2'] = drift_labels.judge_p2(trial, env, candidates, texts, work / 'p2-judge.stream') if candidates else {}
    p2 = {cid for cid, v in record['p2'].items() if v['contradicts']}
    record['excluded_p2'] = sorted(p2)
    if not set(before) - p2:
        record['outcome'] = 'nothing_to_repair' if not before else 'not_repaired_p2'
        record['labels'] = label(trial, round_number, texts, record, previous_failing)
        return record
    shutil.copytree(main, work / 'sdd-main', dirs_exist_ok=False)
    if (run / REPORT).exists():
        shutil.copy2(run / REPORT, work / '08-sdd-report.md')
    prd_sha = sha(run / PRD)
    shutil.copy2(run / PRD, work / 'prd-sdd.md')
    origin_before = code_files(run / 'repos/origin')
    tests_before = {f for f in code_files(main) if f.endswith('_test.go')}
    passing_before = None  # every check that passed on SDD's code
    current = {k: v for k, v in before.items() if k not in p2}
    for n in range(1, MAX_PASSES + 1):
        text = report(current, texts, (run / PRD).read_text(encoding='utf-8'))
        (work / f'report-pass{n}.md').write_text(text, encoding='utf-8')
        (run / REPORT).write_text(text, encoding='utf-8')
        snapshot = code_files(main)
        rc, prompt, session = prdfix(trial, env, work / f'prdfix-pass{n}.stream')
        (work / 'prdfix-prompt.txt').write_text(prompt, encoding='utf-8')
        p = {'pass': n, 'gaps': sorted(current), 'prdfix_exit': rc, 'continued_session': session}
        after_files = code_files(main)
        p['changed_files'] = sorted(f for f in set(after_files) | set(snapshot) if after_files.get(f) != snapshot.get(f))
        if sha(run / PRD) != prd_sha:
            shutil.copy2(work / 'prd-sdd.md', run / PRD)  # the PRD stays SDD's; code changes are kept
            p['prd_restored'] = True
        if code_files(run / 'repos/origin') != origin_before:
            p['baseline_changed'] = True
            restore(work / 'sdd-main', main)
            record['passes'].append(p)
            record['outcome'] = 'reverted_baseline_touched'
            break
        deleted = sorted(tests_before - set(after_files))
        for f in deleted:
            shutil.copy2(work / 'sdd-main' / f, main / f)
        p['tests_restored'] = deleted
        after, _ = accept(main, texts)  # builds and tests first; probes only when that passes
        record['details'].update(details(after))
        p['build_test_exit'] = 1 if BUILD in after else 0
        if BUILD in after:
            p['build_tail'] = after[BUILD]['output'][-1500:]
        p['failing_after'] = sorted(after)
        p['fixed'], p['regressed'] = judge(before, after)
        record['passes'].append(p)
        if BUILD not in after and p['fixed'] and not p['regressed']:
            record['outcome'] = 'adopted'
            break
        current = dict(after)
        if n == MAX_PASSES:
            ok = BUILD not in after and len(p['fixed']) > len(p['regressed'])
            if not ok:
                restore(work / 'sdd-main', main)
            record['outcome'] = 'adopted_with_regressions' if ok else 'reverted'
    shutil.copy2(work / f"report-pass{len(record['passes'])}.md", work / 'last-ic-report.md')
    if (work / '08-sdd-report.md').exists():
        shutil.copy2(work / '08-sdd-report.md', run / REPORT)
    record['labels'] = label(trial, round_number, texts, record, previous_failing)
    record['finished'] = dt.datetime.now(dt.timezone.utc).isoformat()
    return record


def label(trial, round_number, texts, record, previous_failing):
    named = units(texts)
    out = drift_labels.labels(trial, round_number, {k: i + 1 for k, i in named.items()}, record, previous_failing)
    for cid in record.get('excluded_p2', []):
        f = record['details'].get(cid, {})
        key = next((k for k in out if k.endswith(':' + (f.get('unit') or cid.split(':')[1]))), None)
        if key and 'P2' not in out[key]:
            out[key].append('P2')
    (Path(trial) / 'acceptance' / 'labels.json').write_text(json.dumps(out, ensure_ascii=False, indent=2), encoding='utf-8')
    return out


def apply(trial, round_number, previous_failing=None):
    """Acceptance + repair on a returned trial, then re-score; updates completion.json in place, archiving the old one."""
    trial = Path(trial)
    settings = json.loads((trial / 'environment.json').read_text(encoding='utf-8'))
    env = run_r1.execution_env(settings | (run_r1.posix_cp_settings(trial) if (trial / 'bin/posix_cp.sh').exists() else {}))
    complete = json.loads((trial / 'completion.json').read_text(encoding='utf-8'))
    record = repair_trial(trial, round_number, env, previous_failing)
    if record['outcome'] in ('adopted', 'adopted_with_regressions'):
        archive = trial / 'acceptance' / 'sdd-official'
        archive.mkdir(parents=True, exist_ok=True)
        for name in ['official-app', 'official-verifier', 'official-verifier.log', 'completion.json']:
            if (trial / name).exists():
                shutil.move(trial / name, archive / name)
        records = list(complete['phases'])
        record['sdd_official'] = complete['results'].get('official')
        complete['results']['official'] = run_r1.official_phase(trial, env, records)
        complete['phases'] = records
    complete['acceptance_repair'] = record
    run_r1.write_json(trial / 'completion.json', complete)
    return record
