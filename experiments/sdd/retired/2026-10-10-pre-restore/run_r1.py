"""One authorized SDD-only R1 trial; no automatic relaunch or next round."""
import argparse
import datetime as dt
import hashlib
import itertools
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile
import time
import uuid

from prepare import prepare, baseline_files
from budget import Budget, load_policy
from process_scope import ProcessScope
from run_results import stage_result, official_result, source_hash

BASE = Path('D:/huawei/EvoCodeBench')
OFFICIAL = BASE / 'data/evocodebench_wotraj/theme_d5_w9_data_engineering_reproducibility_verification'
PYTHON = Path('C:/Users/HuaWeiClient/AppData/Local/Programs/Python/Python312/python.exe')
BASH = 'C:/Program Files/Git/bin/bash.exe'
MODEL = 'openai/gpt-6-luna-fast'
VARIANT = 'high-fast'
GO = Path('D:/huawei/intent_compiler/project/.scratch/sdd-phase1/go/bin/go.exe')
# Keep the required Go command unchanged while running it in the same Linux
# toolchain family used by the official evaluator. The frozen runtime exports
# MSYS_NO_PATHCONV=1 so Git Bash does not rewrite Linux paths such as /app when
# invoking docker.exe. $PWD expands to the current repo root in the workflow shell.
BUILD_COMMAND = ('docker run --rm --network none --mount '
                 '"type=bind,source=$PWD,target=/app" --workdir /app '
                 '--entrypoint /bin/bash sdd-unattended-preflight:latest '
                 '-lc "go build -o dpipe ./... && go test ./..."')


def resolve_opencode(entry=None):
    entry = entry or shutil.which('opencode.exe') or shutil.which('opencode.cmd')
    if not entry:
        raise RuntimeError('OpenCode native executable not found')
    native = Path(entry).resolve()
    if native.suffix.lower() == '.cmd':
        native = native.parent / 'node_modules/opencode-ai/bin/opencode.exe'
    if native.suffix.lower() != '.exe' or not native.is_file():
        raise RuntimeError(f'OpenCode native executable unavailable: {native}')
    return native


def write_guard(path, native):
    # Native CreateProcess argument handling preserves newlines and quotes.
    # Batch wrappers re-interpret these arguments and truncate multiline prompts.
    module = Path(__file__).with_name('model_guard.py')
    shutil.copy2(module, path.parent / 'guard_runtime.py')
    shutil.copy2(Path(__file__).with_name('budget.py'), path.parent / 'budget.py')
    shutil.copy2(Path(__file__).with_name('run_results.py'), path.parent / 'run_results.py')
    path.write_text('import sys\nfrom guard_runtime import main\n'
                    f'sys.exit(main({str(native)!r},sys.argv[1:],{MODEL!r},{VARIANT!r}))\n', encoding='utf-8')


def go_settings(go=GO):
    return {'SPECART_GO': go.as_posix(), 'SPECLANG_TOOLCHAIN_DIR': go.parent.as_posix(),
            'SPECLANG_BUILD_COMMAND': BUILD_COMMAND, 'MSYS_NO_PATHCONV': '1'}


def prepare_python3(root):
    """Native venv launcher works from both PowerShell and Git Bash."""
    directory = root / 'python'
    subprocess.run([str(PYTHON), '-m', 'venv', '--without-pip', '--system-site-packages',
                    str(directory)], check=True, capture_output=True, timeout=60)
    scripts = directory / 'Scripts'
    shutil.copy2(scripts / 'python.exe', scripts / 'python3.exe')
    return scripts


def execution_env(settings, inherited=None):
    for key in ['SPECLANG_MODEL', 'SPECLANG_VARIANT', *go_settings(), 'OPENCODE_NATIVE']:
        if not settings.get(key):
            raise ValueError(f'Missing frozen runtime setting: {key}')
    if settings['SPECLANG_MODEL'] != MODEL or settings['SPECLANG_VARIANT'] != VARIANT:
        raise ValueError('MODEL_PROFILE_MISMATCH')
    env = dict(os.environ if inherited is None else inherited)
    env.update({k: v for k, v in settings.items() if k != 'PATH_PREFIX'})
    # The experiment launcher and workflow runner are invoked through Git Bash.
    # MSYS otherwise rewrites Linux container arguments such as /app to a
    # Windows path (for example C:/Program Files/Git/app) before docker.exe sees them.
    env['MSYS_NO_PATHCONV'] = '1'
    env['PATH'] = os.pathsep.join(settings['PATH_PREFIX']) + os.pathsep + env.get('PATH', '')
    return env


def write_json(path, value):
    temporary = path.with_name(path.name + '.tmp')
    temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    os.replace(temporary, path)


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def build_specart_expr_helper(root):
    """Freeze a Dpipe Go-expression adapter in place of the Cangjie helper."""
    source = Path(__file__).with_name('specart_go_expr_helper.go')
    frozen_source = root / 'bin/specart_go_expr_helper.go'
    binary = root / 'bin/specart_go_expr_helper.exe'
    manifest = root / 'bin/specart_go_expr_helper.manifest.json'
    shutil.copy2(source, frozen_source)
    version = subprocess.run([str(GO), 'version'], check=True, capture_output=True,
                             text=True, timeout=30).stdout.strip()
    build_env = {**os.environ, 'GOOS': 'windows', 'GOARCH': 'amd64',
                 'CGO_ENABLED': '0', 'GOPROXY': 'off', 'GOSUMDB': 'off'}
    command = [str(GO), 'build', '-trimpath', '-o', str(binary), str(frozen_source)]
    built = subprocess.run(command, env=build_env, capture_output=True, text=True, timeout=120)
    if built.returncode:
        raise RuntimeError('Go expression helper build failed: ' + built.stderr[-4000:])
    valid = subprocess.run([str(binary), '--expr', 'result != nil && result.Code == 0'],
                           capture_output=True, text=True, timeout=15)
    data = json.loads(valid.stdout)
    if valid.returncode or data.get('schema_version') != 1 or data.get('diagnostics'):
        raise RuntimeError('Go expression helper smoke check failed: ' + valid.stdout[-2000:])
    malformed = subprocess.run([str(binary), '--expr', 'result =='],
                               capture_output=True, text=True, timeout=15)
    malformed_data = json.loads(malformed.stdout)
    if malformed.returncode != 1 or not any(d.get('code') == 'SA121'
                                             for d in malformed_data.get('diagnostics', [])):
        raise RuntimeError('Go expression helper malformed-input check failed')
    write_json(manifest, {
        'schema_version': 1,
        'source': {'path': str(frozen_source), 'sha256': sha(frozen_source)},
        'binary': {'path': str(binary), 'sha256': sha(binary)},
        'build': {'toolchain_path': str(GO), 'toolchain_sha256': sha(GO),
                  'version': version, 'command': command,
                  'goos': 'windows', 'goarch': 'amd64', 'cgo_enabled': False},
        'smoke_checks': {'valid_expression': 'passed', 'malformed_expression': 'SA121'},
    })
    return binary, manifest


def validate_approved_go_helper(helper, manifest, validator_source):
    helper, manifest, validator_source = [Path(p).resolve() for p in (helper, manifest, validator_source)]
    data = json.loads(manifest.read_text(encoding='utf-8'))
    source = data.get('source', {})
    binary = data.get('binary', {})
    build = data.get('build', {})
    if data.get('schema_version') != 1:
        raise ValueError('Unsupported SPECART_GO_HELPER manifest schema')
    source_path = Path(source.get('path', '')).resolve()
    if not source_path.is_file() or source.get('sha256') != sha(validator_source) or sha(source_path) != source.get('sha256'):
        raise ValueError('Approved Go helper was not built from this frozen validator source')
    if binary.get('path') != str(helper) or binary.get('sha256') != sha(helper):
        raise ValueError('Approved Go helper path or digest differs from its manifest')
    toolchain = Path(build.get('toolchain_path', '')).resolve()
    if not build.get('version') or not build.get('command') or not toolchain.is_file():
        raise ValueError('Approved Go helper manifest lacks its builder/toolchain evidence')
    if build.get('toolchain_sha256') != sha(toolchain):
        raise ValueError('Approved Go helper builder digest differs from its manifest')
    return {str(source_path): sha(source_path), str(helper): sha(helper),
            str(manifest): sha(manifest), str(toolchain): sha(toolchain)}


def specart_diagnostic_records(root, round_number):
    directory = Path(root) / 'diagnostics/specart'
    records = []
    if not directory.is_dir():
        return records
    for report in sorted(directory.glob('*.json')):
        if report.name.endswith('.verified.json'):
            continue
        try:
            data = json.loads(report.read_text(encoding='utf-8'))
            audit_path = report.with_suffix(report.suffix + '.verified.json')
            audit = json.loads(audit_path.read_text(encoding='utf-8')) if audit_path.exists() else None
            records.append({'path': str(report), 'report_sha256': sha(report),
                            'round_matches': data.get('binding', {}).get('round') == f'r{round_number}',
                            'status': data.get('status', 'invalid_report'),
                            'freshness_verified': bool(audit and audit.get('status') == 'fresh'
                                                       and audit.get('round') == f'r{round_number}'
                                                       and audit.get('report_sha256') == sha(report)),
                            'audit_path': str(audit_path) if audit_path.exists() else None})
        except (OSError, ValueError, TypeError) as error:
            records.append({'path': str(report), 'status': 'invalid_report', 'error': str(error),
                            'round_matches': False, 'freshness_verified': False})
    return records


def run_directory(root):
    meta = root / 'round.json'
    number = json.loads(meta.read_text(encoding='utf-8'))['round'] if meta.exists() else 1
    return root / 'runs' / f'r{number}'


def agent_profiles(run):
    profiles = {}
    resources = {
        'specart-author': 'specart-author/SKILL.md',
        'specart-implement': 'specart-implement/SKILL.md',
        'specart-verify': 'specart-verify/SKILL.md',
        'specart-spec-review': 'specart/assets/spec-review-agent.md',
        'specart-slice': 'specart-verify/assets/verification-reference.md',
        'specart-fallback-review': 'specart-verify/assets/verification-reference.md',
    }
    for role, resource in resources.items():
        prompt = (f'Read {(run / "ADAPTER-CONTEXT.md").as_posix()} for shared execution authorization and stage boundaries. '
                  f'Then read and follow {(run / ".agents/skills" / resource).as_posix()} for the delegated role. Respect the original scope.')
        if role in {'specart-slice', 'specart-fallback-review'}:
            prompt += (' You are an internal analysis worker delegated by the independent Verification Agent. '
                       'Return only the requested analysis and cited current source evidence. '
                       'Do not orchestrate the SpecArt lifecycle, delegate further tasks, modify files, '
                       'or write obligations/proof results/final reports. The calling Verifier owns machine commands and final classification.')
        profiles[role] = {'mode': 'subagent', 'model': MODEL, 'variant': VARIANT,
                          'description': role, 'prompt': prompt}
    return profiles


def freeze(round_number=1, baseline=None, requirement=None, sdd_source=None):
    if round_number not in range(1, 16):
        raise ValueError('Round must be 1..15')
    name = f'sdd-luna-dpipe-r{round_number}-' + dt.datetime.now(dt.timezone.utc).strftime('%Y%m%d-%H%M%Sz-') + uuid.uuid4().hex[:8]
    root = BASE / 'harbor_runs' / name
    root.mkdir(parents=True)
    (root / 'baseline').mkdir()
    if baseline:
        for relative in baseline_files(Path(baseline)):
            target = root / 'baseline' / relative
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(Path(baseline) / relative, target)
    if round_number != 1 and not baseline:
        raise ValueError('Later rounds require the previous round code baseline')
    write_json(root / 'round.json', {'round': round_number, 'baseline_source': str(baseline) if baseline else None})
    shutil.copy2(requirement or OFFICIAL / f'steps/round-{round_number}/instruction.md', root / 'requirement.md')
    runtime = root / 'runtime'
    (runtime / 'workflow').mkdir(parents=True)
    for filename in ['speclang-flow.sh', 'workflow.json']:
        shutil.copy2(Path(sdd_source or 'D:/sdd/prdcheck') / 'workflow' / filename, runtime / 'workflow' / filename)
    shutil.copytree(Path(sdd_source or 'D:/sdd/prdcheck') / '.agents/skills', runtime / '.agents/skills',
                    ignore=shutil.ignore_patterns('node_modules', '__pycache__'))
    prepare(runtime, root / 'baseline', root / 'requirement.md', root / 'runs', f'r{round_number}', BUILD_COMMAND)
    run = run_directory(root)
    for filename in ['budget.py', 'budget-policy.json', 'process_scope.py', 'run_results.py', 'prepare.py', 'model_guard.py', 'recover_design.py']:
        shutil.copy2(Path(__file__).with_name(filename), root / filename)
    shutil.copy2(Path(__file__).with_name('budget-plugin.mjs'), root / 'budget-plugin.mjs')
    config = json.loads((run / 'workflow-cli.json').read_text(encoding='utf-8'))
    design_template = (run / '.agents/skills/generate-harmonyos-system-design/assets/system-design-template').as_posix()
    change_template_note = (
        '\n本轮 system-design-template 输入目录=' + design_template + '。'
        '这是 generate-go-cli-system-design 明确指定、且用于生成本轮 Go CLI 基线设计的同版结构模板；'
        '按它读取对应表格表头并确认模板版本，不把目录名或模板中的平台示例当作 Dpipe 需求。'
        '目标保持通用 Go CLI；UI、HarmonyOS、Ability、设备章节均不适用，不新增相关架构内容。')
    for field in ['prompt_template', 'prompt_retry_template']:
        if field in config['skills']['change']:
            config['skills']['change'][field] += change_template_note
    diagnostic_tool = Path(__file__).with_name('specart_go_diagnose.py')
    shutil.copy2(diagnostic_tool, root / diagnostic_tool.name)
    specart_dir = run / config['nodes']['6']['path'] / '.specart'
    specart_prompt = config['skills']['specart']
    diagnostic_note = (
        '\nSA180 只读诊断命令（只在本轮原始 SpecArt validate --format json 返回 SA180 后调用一次）：'
        f'python3 "{(root / diagnostic_tool.name).as_posix()}" diagnose --round r{round_number} '
        f'--bundle "{specart_dir.as_posix()}" --project "{(run / "repos/main").as_posix()}" '
        f'--validator-root "{(run / ".agents/skills/specart/assets/validator").as_posix()}" '
        f'--report "{(root / f"diagnostics/specart/sa180-r{round_number}-UNIQUE-ID.json").as_posix()}"。'
        '将 UNIQUE-ID 替换成不含空格的 UTC 时间戳或 Author 调用序号；诊断报告和其验证 sidecar 位于实验记录区，不能写入项目或 .specart。'
        f'生成后、交给 Author 前，执行 python3 "{(root / diagnostic_tool.name).as_posix()}" verify-report --round r{round_number} '
        f'--bundle "{specart_dir.as_posix()}" --project "{(run / "repos/main").as_posix()}" '
        f'--validator-root "{(run / ".agents/skills/specart/assets/validator").as_posix()}" '
        f'--report "{(root / f"diagnostics/specart/sa180-r{round_number}-UNIQUE-ID.json").as_posix()}"。'
        'verify-report 必须返回 fresh；它会生成 hash-bound sidecar。'
        '新鲜度不是 fresh 就不得复用。Root 读取通过核验的 JSON 报告，并把诊断类别、具体差异和报告路径交给同轮下一次正常 specart-author task。'
        'Author 仍须对照原始需求自行判断、按正常流程修订，并经完整原门禁复验。若账本没有剩余 Author 次数，只记录诊断并按原失败状态结束。'
        '不得因诊断失败另开 Author、复位账本、追加调用或跳过独立审查/accept-design。')
    for field in ['prompt_template', 'prompt_retry_template']:
        if field in specart_prompt:
            specart_prompt[field] += diagnostic_note
    write_json(run / 'workflow-cli.json', config)
    runtime_note = ('\n运行环境：保持 Go 1.22 兼容。原始需求为 output/01-原始需求.md；不得读取其他运行、后续轮次或官方测试/参考解。'
                    '工作区是 Windows，路径使用 D:/ 形式；OpenCode bash 工具使用 PowerShell，'
                    '可直接调用原生 python3；需要 Bash 时显式调用 Git Bash。')
    for skill in config['skills'].values():
        for key in ['prompt_template', 'prompt_retry_template']:
            if key in skill:
                skill[key] += runtime_note
        if 'model' in skill:
            skill['model'] = MODEL
    write_json(run / 'workflow-cli.json', config)
    profiles = agent_profiles(run)
    model_config = {'$schema': 'https://opencode.ai/config.json', 'model': MODEL, 'small_model': MODEL,
                    'plugin': [(root / 'budget-plugin.mjs').as_uri()], 'instructions': [], 'mcp': {}, 'share': 'disabled', 'agent': profiles,
                    'provider': {'openai': {'models': {'gpt-6-luna-fast': {
                        'options': {'reasoningEffort': 'high', 'serviceTier': 'priority'},
                        'variants': {VARIANT: {'reasoningEffort': 'high', 'serviceTier': 'priority'}}}}}}}
    write_json(root / 'opencode.json', model_config)
    (root / 'bin').mkdir()
    shutil.copy2(Path(__file__).with_name('build_go_cli.sh'), root / 'bin/build_go_cli.sh')
    python_scripts = prepare_python3(root)
    guard = root / 'bin/model_guard.py'
    native = resolve_opencode()
    write_guard(guard, native)
    gate = root / 'bin/opencode-guard'
    gate.write_text(f'#!/bin/sh\nexec "{PYTHON.as_posix()}" "{guard.as_posix()}" "$@"\n', encoding='utf-8', newline='\n')
    expression_helper, expression_manifest = build_specart_expr_helper(root)
    env = dict(os.environ)
    env.update(SPECLANG_RUNS_DIR=(root / 'runs').as_posix(), SPECLANG_WORKFLOW_JSON=(run / 'workflow-cli.json').as_posix(),
               SPECLANG_MODEL=MODEL, SPECLANG_VARIANT=VARIANT, SPECLANG_FAST_MODE='0', SPECLANG_AGENT='build',
               SPECLANG_MAX_JOBS='1', OPENCODE_CONFIG=(root / 'opencode.json').as_posix(),
               OPENCODE_BIN=gate.as_posix(), OPENCODE_NATIVE=native.as_posix(),
               OPENCODE_DISABLE_PROJECT_CONFIG='1', OPENCODE_DISABLE_CLAUDE_CODE='1', OPENCODE_DISABLE_AUTOUPDATE='1',
               SPECART_AST_HELPER=expression_helper.as_posix(), SPECART_AST_HELPER_FALLBACK='',
               PYTHONUTF8='1', **go_settings())
    env.setdefault('SPECART_GO_HELPER', '')
    env.setdefault('SPECART_GO_HELPER_MANIFEST', '')
    env.update(SDD_BUDGET_DB=str(root / 'budget.sqlite'), SDD_BUDGET_POLICY=str(root / 'budget-policy.json'),
               SDD_BUDGET_SCRIPT=str(root / 'budget.py'), SDD_PYTHON=str(PYTHON), SDD_PROJECT=str(run / 'repos/main'))
    env['SDD_DOCUMENT_TARGETS'] = json.dumps({
        'prd': {'path': (run / config['nodes']['2']['path']).as_posix(), 'skill': 'prd-clarify'},
        'sd': {'path': (run / 'repos/origin/.system-design/MAP.md').as_posix(), 'skill': 'sd'},
        'change': {'path': (run / config['nodes']['5']['path']).as_posix(), 'skill': 'change'},
    })
    path_prefix = [str(python_scripts), str(root / 'bin'), str(PYTHON.parent), str(Path(env['SPECART_GO']).parent)]
    env['PATH'] = os.pathsep.join(path_prefix) + os.pathsep + env['PATH']
    # Save only explicit non-secret environment overrides.
    frozen_keys = ['SPECLANG_RUNS_DIR', 'SPECLANG_WORKFLOW_JSON', 'SPECLANG_MODEL', 'SPECLANG_VARIANT',
                   'SPECLANG_FAST_MODE', 'SPECLANG_AGENT', 'SPECLANG_MAX_JOBS', 'OPENCODE_CONFIG', 'OPENCODE_BIN',
                   'OPENCODE_DISABLE_PROJECT_CONFIG', 'OPENCODE_DISABLE_CLAUDE_CODE', 'OPENCODE_DISABLE_AUTOUPDATE',
                   'SPECART_AST_HELPER', 'SPECART_AST_HELPER_FALLBACK', 'OPENCODE_NATIVE', *go_settings(),
                   'SDD_BUDGET_DB', 'SDD_BUDGET_POLICY', 'SDD_BUDGET_SCRIPT', 'SDD_PYTHON', 'SDD_PROJECT', 'SDD_DOCUMENT_TARGETS']
    external_runtime_files = {
        str(expression_helper): sha(expression_helper),
        str(expression_manifest): sha(expression_manifest),
        str(GO): sha(GO),
    }
    approved_helper = env.get('SPECART_GO_HELPER')
    if approved_helper:
        helper_path = Path(approved_helper).resolve()
        if not helper_path.is_file():
            raise ValueError(f'SPECART_GO_HELPER is not a file: {helper_path}')
        manifest_value = env.get('SPECART_GO_HELPER_MANIFEST')
        if not manifest_value:
            raise ValueError('SPECART_GO_HELPER requires SPECART_GO_HELPER_MANIFEST')
        manifest_path = Path(manifest_value).resolve()
        validator_source = runtime / '.agents/skills/specart/assets/validator/go/main.go'
        external_runtime_files.update(validate_approved_go_helper(helper_path, manifest_path, validator_source))
        env['SPECART_GO_HELPER'] = str(helper_path)
        env['SPECART_GO_HELPER_MANIFEST'] = str(manifest_path)
    elif env.get('SPECART_GO_HELPER_MANIFEST'):
        raise ValueError('SPECART_GO_HELPER_MANIFEST requires SPECART_GO_HELPER')
    frozen_keys.extend(['SPECART_GO_HELPER', 'SPECART_GO_HELPER_MANIFEST'])
    write_json(root / 'environment.json', {key: env[key] for key in frozen_keys} | {
                                              'PATH_PREFIX': path_prefix,
                                              'OPENCODE_CONFIG': env['OPENCODE_CONFIG'], 'PYTHONUTF8': '1'})
    for command, output in [([str(native), 'debug', 'config'], 'effective-config.json'),
                            ([BASH, '-c', 'python3 --version && go version && node --version'], 'toolchain.txt')]:
        result = subprocess.run(command, cwd=run, env=env, capture_output=True, timeout=60)
        (root / output).write_bytes(result.stdout)
        if result.returncode:
            raise RuntimeError(f'preflight failed: {output}: {result.stderr.decode(errors="replace")}')
    effective = json.loads((root / 'effective-config.json').read_text(encoding='utf-8'))
    assert effective['model'] == MODEL and effective.get('plugin') == model_config['plugin'] and not effective.get('instructions')
    shutil.copy2(__file__, root / 'run_r1.py')
    frozen = {p.relative_to(root).as_posix(): sha(p) for directory in [runtime, run / '.agents', root / 'bin', root / 'python']
              for p in directory.rglob('*') if p.is_file()}
    frozen.update({p.name: sha(p) for p in root.iterdir() if p.is_file() and p.name != 'provenance.json'})
    frozen.update({p.relative_to(root).as_posix(): sha(p) for p in [run / 'ADAPTER-CONTEXT.md', run / 'workflow-cli.json', run / 'budget-policy.json']})
    write_json(root / 'provenance.json', {'runtime_files': frozen, 'requirement_sha256': sha(root / 'requirement.md'),
                                        'workflow_sha256': sha(run / 'workflow-cli.json'),
                                        'budget_policy_sha256': sha(root / 'budget-policy.json'),
                                        'external_runtime_files': external_runtime_files,
                                        'official_source': str(OFFICIAL), 'model': MODEL, 'variant': VARIANT,
                                        'deadline_seconds': load_policy(root / 'budget-policy.json')['round_deadline_seconds'], 'model_started': False,
                                        'baseline': str(baseline) if baseline else 'Empty /app from official Dockerfile; no historical product code.'})
    print(root, flush=True)
    return root


def run_phase(root, stage, label, args, env, budget, records):
    """Contain descendants from birth and always publish the terminal state."""
    run = run_directory(root)
    budget.start_stage(stage)
    started = time.monotonic()
    deadline = budget.snapshot()['stages'][stage]['deadline']
    entry = {'phase': label, 'stage': stage, 'status': 'running', 'started': dt.datetime.now(dt.timezone.utc).isoformat()}
    records.append(entry)
    write_json(root / 'progress.json', records)
    def log(message):
        with (root / 'sdd-flow.log').open('a', encoding='utf-8') as out:
            out.write(f"[{dt.datetime.now().astimezone().isoformat(timespec='seconds')}] {message}\n")
    deadline_label = dt.datetime.fromtimestamp(deadline).astimezone().isoformat() if deadline is not None else 'none (count limits retained)'
    log(f'{label} started; deadline={deadline_label}')
    seen = len(budget.snapshot()['events'])
    scope = None
    try:
        if deadline is not None and time.time() >= deadline:
            entry.update(status='stage_timeout', exit_code=124)
            return entry
        scope = ProcessScope()
        with (root / f'{label}.log').open('wb') as output:
            proc = scope.start(args, cwd=run, env={**env, 'SDD_STAGE': stage}, stdout=output, stderr=subprocess.STDOUT)
            while proc.poll() is None:
                snapshot = budget.snapshot()
                for event in snapshot['events'][seen:]:
                    log(f"{stage}: {event['kind']} {event.get('role', '')}; repairs={snapshot['counts'].get('repairs:total', 0)}/{budget.policy['max_total_repairs']}")
                seen = len(snapshot['events'])
                reason = snapshot.get('stop_reason') if stage != 'official' else None
                if reason or (deadline is not None and time.time() >= deadline):
                    entry.update(status=reason or 'stage_timeout', exit_code=124)
                    break
                time.sleep(.25)
            else:
                entry.update(status='exited', exit_code=proc.returncode)
                reason = budget.snapshot().get('stop_reason')
                if stage != 'official' and reason:
                    entry['status'] = reason
    except Exception as error:
        entry.update(status='runner_error', error=str(error), exit_code=-1)
    finally:
        try:
            entry['cleanup_confirmed'] = scope.close() if scope else True
        except Exception as error:
            entry['cleanup_confirmed'] = False
            entry['cleanup_error'] = str(error)
        if not entry['cleanup_confirmed']:
            entry['status'] = 'cleanup_unconfirmed'
        entry['seconds'] = time.monotonic() - started
        write_json(root / 'progress.json', records)
        log(f"{label} ended: {entry['status']}; exit={entry.get('exit_code')}; cleanup={entry['cleanup_confirmed']}")
    return entry


def validate_specart(run, env, *args):
    validator = run / '.agents/skills/specart/assets/validator/bin/specart-validate'
    done = subprocess.run([str(PYTHON), str(validator), *map(str, args)], cwd=run, env=env,
                          capture_output=True, text=True, encoding='utf-8', errors='replace', timeout=300)
    return {'command': [str(a) for a in args[:1]], 'exit_code': done.returncode,
            'output': (done.stdout + done.stderr)[-4000:]}


def derived_outputs(build_command=BUILD_COMMAND):
    """Files the workflow writes after independent verification, never source."""
    names = {'.verdict.md', '.coding-done'}
    for name in re.findall(r'-o\s+([^\s"\';&|]+)', build_command):
        names.update({name, name + '.exe'})
    return sorted(names)


def verification_candidates(project):
    """Report/obligation/proof triples the verifier wrote, newest first."""
    found = []
    for report in Path(project, '.specart-verify').rglob('*report.md'):
        prefix = report.name[:-len('report.md')]
        obligations = report.with_name(prefix + 'obligations.json')
        proofs = report.with_name(prefix + 'proof-results.json')
        if obligations.is_file() and proofs.is_file():
            found.append((report.stat().st_mtime, report, obligations, proofs))
    return [item[1:] for item in sorted(found, key=lambda item: item[0], reverse=True)]


def reusable_verification(run, env, spec):
    """Reuse the last verifier PASS when source is unchanged since it ran.

    The workflow writes .verdict.md, .coding-done and the build output after
    verification; SpecArt's task-wide freshness hash counts them. Each check
    temporarily sets aside a subset of only those derived files and runs the
    unchanged mechanical report gate, so any other change still needs a fresh
    verifier.
    """
    project = run / 'repos/main'
    present = [name for name in derived_outputs() if (project / name).is_file()]
    subsets = [c for r in range(len(present) + 1) for c in itertools.combinations(present, r)]
    attempts = []
    for report, obligations, proofs in verification_candidates(project):
        for subset in subsets:
            holding = Path(tempfile.mkdtemp(prefix='sdd-derived-', dir=run))
            moved = []
            try:
                for name in subset:
                    os.replace(project / name, holding / name)
                    moved.append(name)
                checked = validate_specart(run, env, 'report', spec, obligations, report, '--proof-results', proofs)
            finally:
                for name in moved:
                    os.replace(holding / name, project / name)
                holding.rmdir()
            attempts.append({'report': str(report), 'set_aside': list(subset), 'exit_code': checked['exit_code']})
            if checked['exit_code'] == 0:
                return {'report': str(report), 'obligations': str(obligations), 'proof_results': str(proofs),
                        'set_aside_derived': list(subset), 'output': checked['output']}, attempts
            if 'SA247' not in checked['output']:
                break  # Not a freshness failure; derived files cannot change it.
    return None, attempts


def stage_configs(run):
    original = json.loads((run / 'workflow-cli.json').read_text(encoding='utf-8'))
    groups = {'design': {'prd', 'sd', 'change', 'specart'}, 'coding': {'main-coding'}, 'prd': {'main-prdcheck'}}
    if (run.parent.parent / 'design-recovery.json').exists():
        groups['design'] = {'specart'}
    result = {}
    for name, ids in groups.items():
        config = {**original, 'stages': [s for s in original['stages'] if s['id'] in ids]}
        if {s['id'] for s in config['stages']} != ids:
            raise ValueError('Required stages missing: ' + name)
        target = run / f'workflow-{name}.json'
        write_json(target, config)
        result[name] = target
    return result


def execute(root):
    root = Path(root).resolve()
    if (root / 'design-recovery.json').exists():
        from recover_design import verify_prelaunch
        verify_prelaunch(root)
    if (root / 'document-recovery.json').exists():
        from recover_design import verify_prelaunch
        verify_prelaunch(root, 'document-recovery.json')
    provenance = json.loads((root / 'provenance.json').read_text(encoding='utf-8'))
    for path, expected in provenance.get('external_runtime_files', {}).items():
        if sha(Path(path)) != expected:
            raise ValueError('Frozen external runtime changed: ' + path)
    for relative, expected in provenance['runtime_files'].items():
        if sha(root / relative) != expected:
            raise ValueError('Frozen runtime changed: ' + relative)
    with (root / 'launch-once.lock').open('x') as lock:
        lock.write(dt.datetime.now(dt.timezone.utc).isoformat())
    settings = json.loads((root / 'environment.json').read_text(encoding='utf-8'))
    env = execution_env(settings)
    policy = load_policy(root / 'budget-policy.json')
    budget = Budget(root / 'budget.sqlite', policy)
    budget.initialize()
    started = time.monotonic()
    run = run_directory(root)
    round_number = int(run.name[1:])
    records = []
    results = {stage: {'status': 'not_reached_due_to_gate'} for stage in ['design', 'coding', 'prd', 'final', 'official']}
    container = root.name.lower()
    try:
        configs = stage_configs(run)
        for stage in ['design', 'coding', 'prd']:
            phase = run_phase(root, stage, f'sdd-{stage}', [BASH,
                (root / 'runtime/workflow/speclang-flow.sh').as_posix(),
                (root / 'baseline').as_posix(), (root / 'requirement.md').as_posix(),
                '--prdid', run.name, '--paths', 'main', '--jobs', '1'],
                {**env, 'SPECLANG_WORKFLOW_JSON': configs[stage].as_posix()}, budget, records)
            results[stage] = stage_result(run, stage)
            if stage == 'design' and results[stage]['status'] == 'pass':
                # SpecArt's own read-only entry gate requires the accepted design record.
                gate = validate_specart(run, env, 'start-implementation', run / 'output/06-Spec骨架/.specart')
                results[stage]['implementation_entry'] = gate
                if gate['exit_code'] != 0:
                    results[stage]['status'] = 'specart_design_not_accepted'
            if stage == 'design' and (root / 'design-recovery.json').exists():
                from recover_design import verify_review_only
                verify_review_only(root)
            if stage == 'prd' and results[stage]['status'] == 'pass':
                binding = root / 'prd-check-source.json'
                current = source_hash(run / 'repos/main')
                bound = json.loads(binding.read_text(encoding='utf-8')) if binding.exists() else {}
                if bound.get('before') != current or bound.get('after') != current or bound.get('exit_code') != 0:
                    results[stage]['status'] = 'prd_report_stale_or_missing_binding'
            if phase['exit_code'] != 0 or phase['status'] != 'exited' or not phase['cleanup_confirmed']:
                results[stage]['status'] = phase['status'] if phase['status'] != 'exited' else 'process_failed'
            if results[stage]['status'] != 'pass':
                break
        spec = run / 'output/06-Spec骨架/.specart'
        reused = None
        if all(results[s]['status'] == 'pass' for s in ['design', 'coding', 'prd']):
            reused, attempts = reusable_verification(run, env, spec)
            results['final'] = {'status': 'pass', 'mode': 'reused_fresh_verification', **reused} if reused else {
                'status': 'fail', 'reuse_attempts': attempts}
        if not reused and all(results[s]['status'] == 'pass' for s in ['design', 'coding', 'prd']):
            # Source changed after the last verifier PASS: run a fresh one.
            # Fixed fresh output paths ensure an old PASS cannot satisfy this run.
            proofdir = run / 'final-verification'
            proofdir.mkdir(exist_ok=False)
            prompt = (f'::specart-impl Verification only. PROJECT={(run / "repos/main").as_posix()}, SPEC={spec.as_posix()}. '
                      f'Original requirement: {(root / "requirement.md").as_posix()}. '
                      'Delegate one fresh independent specart-verify agent; no implementation, repair or product edits. '
                      f'Write current obligations to {(proofdir / "obligations.json").as_posix()}, '
                      f'proof results to {(proofdir / "proof-results.json").as_posix()}, '
                      f'report to {(proofdir / "report.md").as_posix()}. '
                      'Follow the full existing verification lifecycle and validate the report mechanically. Return its status.')
            before = source_hash(run / 'repos/main')
            phase = run_phase(root, 'final', 'final-verification', [str(PYTHON), str(root / 'bin/model_guard.py'),
                'run', '--dir', run.as_posix(), '--agent', 'build', '--model', MODEL, '--variant', VARIANT,
                '--format', 'json', '--auto', '--', prompt], env, budget, records)
            results['final'].update(status='fail', mode='fresh_verification', source_sha256=before)
            if phase.get('exit_code') == 0 and phase['cleanup_confirmed'] and before == source_hash(run / 'repos/main'):
                validator = run / '.agents/skills/specart/assets/validator/bin/specart-validate'
                command = [str(PYTHON), str(validator), 'report', str(spec), str(proofdir / 'obligations.json'),
                           str(proofdir / 'report.md'), '--proof-results', str(proofdir / 'proof-results.json')]
                checked = run_phase(root, 'final', 'final-report-check', command, env, budget, records)
                if checked.get('exit_code') == 0 and checked['cleanup_confirmed']:
                    results['final']['status'] = 'pass'
        # No evaluation until every model process scope is confirmed empty.
        if all(p.get('cleanup_confirmed') for p in records):
            app = root / 'official-app'
            shutil.copytree(run / 'repos/main', app, ignore=shutil.ignore_patterns(
                '.git', '.specart*', '.system-design', '.verdict.md', '.coding-done'))
            logs = root / 'official-verifier'
            logs.mkdir()
            args = ['docker', 'run', '--name', container, '--network', 'none',
                    '--mount', f'type=bind,source={app},target=/app',
                    '--mount', f'type=bind,source={OFFICIAL / f"steps/round-{round_number}/tests"},target=/tests,readonly',
                    '--mount', f'type=bind,source={logs},target=/logs/verifier',
                    '--mount', f'type=bind,source={root / "bin/build_go_cli.sh"},target=/runner/build_go_cli.sh,readonly',
                    '--entrypoint', '/bin/bash', 'sdd-unattended-preflight:latest', '-c',
                    'cd /app; SDD_BUILD_EVIDENCE_DIR=/logs/verifier bash /runner/build_go_cli.sh > /logs/verifier/build.log 2>&1; '
                    'rc=$?; echo "$rc" > /logs/verifier/build-exit-code.txt; '
                    'bash /tests/test.sh']
            phase = run_phase(root, 'official', 'official-verifier', args, env, budget, records)
            build_file = logs / 'build-exit-code.txt'
            build_rc = int(build_file.read_text().strip()) if build_file.exists() else None
            results['official'] = official_result(root / 'official-verifier.log', build_rc)
            requested = logs / 'requested-command-exit-code.txt'
            mode = logs / 'packaging-mode.txt'
            results['official']['requested_build_exit_code'] = int(requested.read_text().strip()) if requested.exists() else None
            results['official']['packaging_mode'] = mode.read_text().strip() if mode.exists() else None
            if phase['status'] != 'exited' or phase.get('exit_code') != 0:
                results['official']['execution_status'] = phase['status']
        else:
            results['official'] = {'status': 'blocked_cleanup_unconfirmed'}
    except Exception as error:
        results['runner'] = {'status': 'error', 'error': str(error)}
    finally:
        # Docker server owns containers independently of the client process job.
        try:
            stopped = subprocess.run(['docker', 'stop', '-t', '5', container], capture_output=True, timeout=15)
            if stopped.returncode and b'No such container' not in stopped.stderr:
                results['container_cleanup'] = {'status': 'unconfirmed'}
        except Exception as error:
            results['container_cleanup'] = {'status': 'unconfirmed', 'error': str(error)}
        complete = {'phases': records, 'results': results, 'budget': budget.snapshot(),
                    'elapsed_seconds': time.monotonic() - started, 'round': round_number, 'automatic_relaunch': False,
                    'model': MODEL, 'variant': VARIANT,
                    'sdd_status': 'pass' if all(results[s]['status'] == 'pass' for s in ['design', 'coding', 'prd', 'final']) else 'not_passed'}
        complete['specart_diagnostics'] = specart_diagnostic_records(root, round_number)
        write_json(root / 'completion.json', complete)
        with (root / 'sdd-flow.log').open('a', encoding='utf-8') as out:
            out.write('SDD RUN FINISHED: ' + complete['sdd_status'] + '; results=completion.json\n')
        print(json.dumps(complete, ensure_ascii=False), flush=True)


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--launch')
    options = parser.parse_args()
    if not options.launch:
        freeze()
    else:
        frozen_runner = Path(options.launch).resolve() / 'run_r1.py'
        if frozen_runner != Path(__file__).resolve():
            # Launch frozen modules, not whatever happens to be in the current
            # workspace when a prepared run is started later.
            raise SystemExit(subprocess.call([sys.executable, str(frozen_runner), '--launch', str(Path(options.launch).resolve())]))
        execute(options.launch)
