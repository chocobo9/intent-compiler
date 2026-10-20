"""One SDD-only round: the upstream SDD workflow, run once, adapted only for a Go CLI task.

The runner prepares inputs, invokes the upstream speclang-flow.sh a single time
for the complete main path (PRD, System Design, change, SpecArt, Coding, PRD
check/fix) and then evaluates the final code with the official tests. It adds no
gates, stages, retries or repair limits to the upstream workflow.
"""
import argparse
import datetime as dt
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import time
import uuid

from prepare import prepare, baseline_files
from process_scope import ProcessScope
from run_results import stage_result, official_result

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
    path.write_text('import sys\nfrom guard_runtime import main\n'
                    f'sys.exit(main({str(native)!r},sys.argv[1:],{MODEL!r},{VARIANT!r}))\n', encoding='utf-8')


def go_settings(go=GO):
    return {'SPECART_GO': go.as_posix(), 'SPECLANG_TOOLCHAIN_DIR': go.parent.as_posix(),
            'SPECLANG_BUILD_COMMAND': BUILD_COMMAND, 'MSYS_NO_PATHCONV': '1'}


def posix_cp_settings(root):
    # Git Bash sources BASH_ENV before the upstream script: cp -r keeps NAME and NAME.exe apart.
    return {'BASH_ENV': (root / 'bin/posix_cp.sh').as_posix(), 'SDD_POSIX_CP_PYTHON': PYTHON.as_posix()}


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
    """Freeze a Go-expression parser in place of the Cangjie expression helper."""
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


def run_directory(root):
    meta = root / 'round.json'
    number = json.loads(meta.read_text(encoding='utf-8'))['round'] if meta.exists() else 1
    return root / 'runs' / f'r{number}'


# Upstream subagent definitions (D:/sdd/sdd-loop-skeleton/.claude/agents), with
# the skill paths made absolute for this run's frozen skills.
AGENTS = {
    'specart-author': ('specart-author/SKILL.md',
        'Execute only the delegated SpecArt author role and return its fixed status with a short summary.'),
    'specart-spec-review': ('specart/assets/spec-review-agent.md',
        'Review the delegated specification against the original requirements and return its status and evidence to Root.'),
    'specart-implement': ('specart-implement/SKILL.md',
        'Execute only the delegated SpecArt implementation or repair role and return its fixed status with a short summary.'),
    'specart-verify': ('specart-verify/SKILL.md',
        'Execute only the delegated independent verification role. Use the native Agent tool for the optional internal '
        'roles named by that skill, and return the fixed verification status with a short summary.'),
    'specart-slice': ('specart-verify/assets/slice-agent.md',
        'Execute only the delegated analysis task and return its evidence to the Verification Agent.'),
    'specart-fallback-review': ('specart-verify/assets/fallback-review-agent.md',
        'Execute only the delegated review task and return its evidence to the Verification Agent.'),
}


def agent_profiles(run):
    profiles = {}
    for role, (resource, duty) in AGENTS.items():
        skill = (run / '.agents/skills' / resource).as_posix()
        # A subagent reads its skill file directly, without the skill tool's base-directory
        # notice, so relative paths in it (assets/, references/, ../specart/...) need their base.
        base = (run / '.agents/skills' / resource).parent.as_posix()
        profiles[role] = {'mode': 'subagent', 'model': MODEL, 'variant': VARIANT, 'description': role,
                          'prompt': f'Read and follow `{skill}` completely before acting. Relative paths in that file are relative to `{base}`. {duty}'}
    return profiles


def freeze(round_number=1, baseline=None, requirement=None, sdd_source=None):
    if round_number not in range(1, 16):
        raise ValueError('Round must be 1..15')
    # The IC+SDD arm names its trials differently so the two arms never mix.
    prefix = os.environ.get('SDD_TRIAL_PREFIX', 'sdd-luna-dpipe')
    name = f'{prefix}-r{round_number}-' + dt.datetime.now(dt.timezone.utc).strftime('%Y%m%d-%H%M%Sz-') + uuid.uuid4().hex[:8]
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
    for filename in ['process_scope.py', 'run_results.py', 'prepare.py', 'model_guard.py']:
        shutil.copy2(Path(__file__).with_name(filename), root / filename)
    config = json.loads((run / 'workflow-cli.json').read_text(encoding='utf-8'))
    # The Go CLI design skill reuses the upstream template, which lives under the
    # HarmonyOS skill directory; state where it is so the change stage finds it.
    design_template = (run / '.agents/skills/generate-harmonyos-system-design/assets/system-design-template').as_posix()
    config['skills']['change']['prompt_template'] += (
        '\n本轮 system-design-template 目录=' + design_template + '（Go CLI 设计沿用的同版模板）。')
    runtime_note = ('\n运行环境：Go 1.22 兼容。工作区是 Windows，路径使用 D:/ 形式；OpenCode bash 工具使用 PowerShell，'
                    '可直接调用 python3；需要 Bash 时显式调用 Git Bash。')
    for skill in config['skills'].values():
        for key in ['prompt_template', 'prompt_retry_template']:
            if key in skill:
                skill[key] += runtime_note
        if 'model' in skill:
            skill['model'] = MODEL
    write_json(run / 'workflow-cli.json', config)
    model_config = {'$schema': 'https://opencode.ai/config.json', 'model': MODEL, 'small_model': MODEL,
                    'plugin': [], 'instructions': [], 'mcp': {}, 'share': 'disabled', 'agent': agent_profiles(run),
                    'provider': {'openai': {'models': {'gpt-6-luna-fast': {
                        'options': {'reasoningEffort': 'high', 'serviceTier': 'priority'},
                        'variants': {VARIANT: {'reasoningEffort': 'high', 'serviceTier': 'priority'}}}}}}}
    write_json(root / 'opencode.json', model_config)
    (root / 'bin').mkdir()
    shutil.copy2(Path(__file__).with_name('build_go_cli.sh'), root / 'bin/build_go_cli.sh')
    shutil.copy2(Path(__file__).with_name('posix_cp.sh'), root / 'bin/posix_cp.sh')
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
               PYTHONUTF8='1', **go_settings(), **posix_cp_settings(root))
    env.setdefault('SPECART_GO_HELPER', '')
    env.setdefault('SPECART_GO_HELPER_MANIFEST', '')
    path_prefix = [str(python_scripts), str(root / 'bin'), str(PYTHON.parent), str(Path(env['SPECART_GO']).parent)]
    env['PATH'] = os.pathsep.join(path_prefix) + os.pathsep + env['PATH']
    # Save only explicit non-secret environment overrides.
    frozen_keys = ['SPECLANG_RUNS_DIR', 'SPECLANG_WORKFLOW_JSON', 'SPECLANG_MODEL', 'SPECLANG_VARIANT',
                   'SPECLANG_FAST_MODE', 'SPECLANG_AGENT', 'SPECLANG_MAX_JOBS', 'OPENCODE_CONFIG', 'OPENCODE_BIN',
                   'OPENCODE_DISABLE_PROJECT_CONFIG', 'OPENCODE_DISABLE_CLAUDE_CODE', 'OPENCODE_DISABLE_AUTOUPDATE',
                   'SPECART_AST_HELPER', 'SPECART_AST_HELPER_FALLBACK', 'OPENCODE_NATIVE', *go_settings(), *posix_cp_settings(root)]
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
    assert effective['model'] == MODEL and not effective.get('plugin') and not effective.get('instructions')
    shutil.copy2(__file__, root / 'run_r1.py')
    frozen = {p.relative_to(root).as_posix(): sha(p) for directory in [runtime, run / '.agents', root / 'bin', root / 'python']
              for p in directory.rglob('*') if p.is_file()}
    frozen.update({p.name: sha(p) for p in root.iterdir() if p.is_file() and p.name != 'provenance.json'})
    frozen.update({p.relative_to(root).as_posix(): sha(p) for p in [run / 'ADAPTER-CONTEXT.md', run / 'workflow-cli.json']})
    write_json(root / 'provenance.json', {'runtime_files': frozen, 'requirement_sha256': sha(root / 'requirement.md'),
                                        'workflow_sha256': sha(run / 'workflow-cli.json'),
                                        'external_runtime_files': external_runtime_files,
                                        'official_source': str(OFFICIAL), 'model': MODEL, 'variant': VARIANT,
                                        'model_started': False,
                                        'baseline': str(baseline) if baseline else 'Empty /app from official Dockerfile; no historical product code.'})
    print(root, flush=True)
    return root


def run_phase(root, label, args, env, records):
    """Contain descendants from birth and always publish the terminal state."""
    run = run_directory(root)
    started = time.monotonic()
    entry = {'phase': label, 'status': 'running', 'started': dt.datetime.now(dt.timezone.utc).isoformat()}
    records.append(entry)
    write_json(root / 'progress.json', records)
    def log(message):
        with (root / 'sdd-flow.log').open('a', encoding='utf-8') as out:
            out.write(f"[{dt.datetime.now().astimezone().isoformat(timespec='seconds')}] {message}\n")
    log(f'{label} started')
    scope = None
    try:
        scope = ProcessScope()
        with (root / f'{label}.log').open('wb') as output:
            proc = scope.start(args, cwd=run, env=env, stdout=output, stderr=subprocess.STDOUT)
            proc.wait()
            entry.update(status='exited', exit_code=proc.returncode)
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


GATES = ('design', 'coding', 'prd')


def execute(root):
    root = Path(root).resolve()
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
    develop_and_evaluate(root, execution_env(settings), 'sdd-flow')


def official_phase(root, env, records):
    """Score the final code with the unchanged official tests in a fresh container."""
    run = run_directory(root)
    round_number = int(run.name[1:])
    app = root / 'official-app'
    main = (run / 'repos/main').resolve()
    tools = shutil.ignore_patterns('.git', '.specart*', '.system-design', '.verdict.md', '.coding-done')

    def ignore(directory, names):
        # A program left at the root by an earlier build is not copied: the official tests run whatever /app/dpipe
        # is there, so a failed build would otherwise be scored with the old program (user, 2026-10-17).
        stale = [n for n in names if Path(directory).resolve() == main and n in ('dpipe', 'dpipe.exe') and (Path(directory) / n).is_file()]
        return set(tools(directory, names)) | set(stale)
    shutil.copytree(main, app, ignore=ignore)
    logs = root / 'official-verifier'
    logs.mkdir()
    args = ['docker', 'run', '--rm', '--name', root.name.lower(), '--network', 'none',
            '--mount', f'type=bind,source={app},target=/app',
            '--mount', f'type=bind,source={OFFICIAL / f"steps/round-{round_number}/tests"},target=/tests,readonly',
            '--mount', f'type=bind,source={logs},target=/logs/verifier',
            '--mount', f'type=bind,source={root / "bin/build_go_cli.sh"},target=/runner/build_go_cli.sh,readonly',
            '--entrypoint', '/bin/bash', 'sdd-unattended-preflight:latest', '-c',
            'cd /app; SDD_BUILD_EVIDENCE_DIR=/logs/verifier bash /runner/build_go_cli.sh > /logs/verifier/build.log 2>&1; '
            'rc=$?; echo "$rc" > /logs/verifier/build-exit-code.txt; '
            'bash /tests/test.sh']
    phase = run_phase(root, 'official-verifier', args, env, records)
    build_file = logs / 'build-exit-code.txt'
    build_rc = int(build_file.read_text().strip()) if build_file.exists() else None
    official = official_result(root / 'official-verifier.log', build_rc)
    requested = logs / 'requested-command-exit-code.txt'
    mode = logs / 'packaging-mode.txt'
    official['requested_build_exit_code'] = int(requested.read_text().strip()) if requested.exists() else None
    official['packaging_mode'] = mode.read_text().strip() if mode.exists() else None
    if phase['status'] != 'exited' or phase.get('exit_code') != 0:
        official['execution_status'] = phase['status']
    return official


def rescore(root, reason):
    """Run only the official scoring again when it never executed (no build result).

    Development records are untouched; the failed scoring attempt and any
    container left from it are kept under new names.
    """
    root = Path(root).resolve()
    complete = json.loads((root / 'completion.json').read_text(encoding='utf-8'))
    if complete['results'].get('official', {}).get('build_exit_code') is not None:
        raise ValueError('Official scoring already produced a build result; it is not re-run')
    if not all(p.get('cleanup_confirmed') for p in complete['phases']):
        raise ValueError('Process cleanup unconfirmed')
    archive = root / 'rescore-attempt'
    archive.mkdir()
    for name in ['official-app', 'official-verifier', 'official-verifier.log', 'completion.json']:
        if (root / name).exists():
            shutil.move(root / name, archive / name)
    renamed = subprocess.run(['docker', 'rename', root.name.lower(), root.name.lower() + '-attempt1'], capture_output=True, text=True)
    env = execution_env(json.loads((root / 'environment.json').read_text(encoding='utf-8')) | (
        posix_cp_settings(root) if (root / 'bin/posix_cp.sh').exists() else {}))
    records = list(complete['phases'])
    official = official_phase(root, env, records)
    complete['phases'] = records
    complete['results']['official'] = official
    complete['rescored'] = {'reason': reason, 'previous': (archive / 'completion.json').as_posix(),
                            'old_container_renamed': renamed.returncode == 0}
    write_json(root / 'completion.json', complete)
    print(json.dumps(official, ensure_ascii=False), flush=True)


CHANGE_DOCUMENT = 'output/05-变更说明书.md'
SYSTEM_DESIGN = 'output/04-SystemDesign'
DESIGN_NEXT = 'output/.system-design-next'


def change_stage_retry(root, run, flow):
    """v8 item 8: when the flow stopped at the change stage with its own verdict not passed (PRD and SD passed, the change
    document written, no change state recorded), archive that document and say so; the caller runs the flow once more.
    Only once per trial, only after a confirmed cleanup."""
    from run_results import state
    if (root / 'change-retry.json').exists() or flow.get('exit_code') == 0 or not flow.get('cleanup_confirmed'):
        return None
    if state(run, 'prd') != 'passed' or state(run, 'sd') != 'passed' or state(run, 'change') == 'passed' or not (run / CHANGE_DOCUMENT).is_file():
        return None
    archive = root / 'change-retry'
    archive.mkdir()
    # The change stage reads the system design SD wrote this round from the baseline code; when that design breaks the
    # template (v8 R10: a 7-column API catalog), redoing the change alone repeats the stop. So the system design, its
    # stage state and any target design the change stage left go too: the retry writes SD and the change again from
    # the same code, PRD and requirement (the passed PRD stage is skipped by the upstream).
    archived = []
    for relative in [CHANGE_DOCUMENT, SYSTEM_DESIGN, DESIGN_NEXT, 'logs/sd.state.json']:
        if (run / relative).exists():
            shutil.move(run / relative, archive / Path(relative).name)
            archived.append((archive / Path(relative).name).as_posix())
    record = {'reason': 'change stage stopped with its verdict not passed; one retry of system design and change with the same inputs (v8 item 8, harness)',
              'first_flow_exit_code': flow.get('exit_code'), 'archived': archived,
              'at': dt.datetime.now(dt.timezone.utc).isoformat()}
    write_json(root / 'change-retry.json', record)
    return record


def develop_and_evaluate(root, env, label, extra=None):
    started = time.monotonic()
    run = run_directory(root)
    round_number = int(run.name[1:])
    records = []
    results = {}
    container = root.name.lower()
    try:
        # The whole upstream workflow in one invocation, exactly as SDD runs it.
        command = [BASH, (root / 'runtime/workflow/speclang-flow.sh').as_posix(),
                   (root / 'baseline').as_posix(), (root / 'requirement.md').as_posix(),
                   '--prdid', run.name, '--paths', 'main', '--jobs', '1']
        flow = run_phase(root, label, command, env, records)
        retry = change_stage_retry(root, run, flow)
        if retry:
            # v8 item 8 (harness, reported apart): the change stage stopped with pass false; the same flow runs once more in
            # the same run directory, where the upstream skips the passed PRD stage and writes the system design and the
            # change again from the same inputs. The first ones are archived.
            flow = run_phase(root, label + '-change-retry', command, env, records)
            from run_results import state
            write_json(root / 'change-retry.json', {**retry, 'retry_exit_code': flow.get('exit_code'),
                                                     'change_state_after': state(run, 'change')})
        for stage in GATES:
            results[stage] = stage_result(run, stage)
        # No evaluation until every model process scope is confirmed empty.
        if flow['cleanup_confirmed']:
            results['official'] = official_phase(root, env, records)
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
        # The last run of the flow decides (a change-stage retry is the second).
        flows = [r for r in records if str(r.get('phase', '')).startswith(label)]
        flow_ok = bool(flows) and flows[-1].get('status') == 'exited' and flows[-1].get('exit_code') == 0
        passed = flow_ok and all(results.get(stage, {}).get('status') == 'pass' for stage in GATES)
        complete = {'phases': records, 'results': results,
                    'elapsed_seconds': time.monotonic() - started, 'round': round_number, 'automatic_relaunch': False,
                    'model': MODEL, 'variant': VARIANT, 'sdd_status': 'pass' if passed else 'not_passed', **(extra or {})}
        write_json(root / 'completion.json', complete)
        with (root / 'sdd-flow.log').open('a', encoding='utf-8') as out:
            out.write('SDD RUN FINISHED: ' + complete['sdd_status'] + '; results=completion.json\n')
        print(json.dumps(complete, ensure_ascii=False), flush=True)


def resume(root, reason):
    """Continue one trial whose upstream flow failed, through the upstream's own resume.

    speclang-flow.sh skips every stage whose state is passed and whose artifact
    exists, so only the unfinished stages run again in the same run directory.
    Allowed once, only after a failed flow with confirmed cleanup; earlier
    results are archived, never overwritten. The environment may gain the
    current POSIX cp shim; that addition is recorded.
    """
    root = Path(root).resolve()
    attempt = root / 'attempt-1'
    if attempt.exists():
        raise FileExistsError('This trial was already resumed once: ' + str(attempt))
    previous = json.loads((root / 'completion.json').read_text(encoding='utf-8'))
    flow = previous['phases'][0]
    if flow.get('phase') != 'sdd-flow' or flow.get('exit_code') == 0 or not all(p.get('cleanup_confirmed') for p in previous['phases']):
        raise ValueError('Resume needs a failed upstream flow whose processes were all cleaned up')
    provenance = json.loads((root / 'provenance.json').read_text(encoding='utf-8'))
    for relative, expected in provenance['runtime_files'].items():
        if sha(root / relative) != expected:
            raise ValueError('Frozen runtime changed: ' + relative)
    attempt.mkdir()  # Fails if this trial was already resumed.
    run = run_directory(root)
    moved = {}
    for name in ['completion.json', 'progress.json', 'official-app', 'official-verifier', 'official-verifier.log']:
        if (root / name).exists():
            shutil.move(root / name, attempt / name)
            moved[name] = (attempt / name).as_posix()
    # A backup the failed upstream copy left incomplete would stand in for coding's output.
    backup = run / 'repos/main.bak'
    if previous['results'].get('prd', {}).get('status') == 'not_reached' and backup.exists():
        shutil.move(backup, attempt / 'main.bak')
        moved['repos/main.bak'] = (attempt / 'main.bak').as_posix()
    settings = json.loads((root / 'environment.json').read_text(encoding='utf-8'))
    added = {}
    if 'BASH_ENV' not in settings:
        shutil.copy2(Path(__file__).with_name('posix_cp.sh'), root / 'bin/posix_cp.sh')
        added = posix_cp_settings(root)
    record = {'reason': reason, 'resumed_at': dt.datetime.now(dt.timezone.utc).isoformat(), 'archived': moved,
              'environment_added': added, 'added_files': {'bin/posix_cp.sh': sha(root / 'bin/posix_cp.sh')} if added else {},
              'previous_completion': (attempt / 'completion.json').as_posix()}
    write_json(root / 'resume.json', record)
    develop_and_evaluate(root, execution_env({**settings, **added}), 'sdd-flow-resume',
                         {'resumed': {'record': (root / 'resume.json').as_posix(), 'previous_completion': record['previous_completion']}})


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--launch')
    parser.add_argument('--resume')
    parser.add_argument('--rescore')
    parser.add_argument('--reason')
    options = parser.parse_args()
    if options.resume:
        resume(options.resume, options.reason or 'unspecified')
    elif options.rescore:
        rescore(options.rescore, options.reason or 'unspecified')
    elif not options.launch:
        freeze()
    else:
        frozen_runner = Path(options.launch).resolve() / 'run_r1.py'
        if frozen_runner != Path(__file__).resolve():
            # Launch frozen modules, not whatever happens to be in the current
            # workspace when a prepared run is started later.
            raise SystemExit(subprocess.call([sys.executable, str(frozen_runner), '--launch', str(Path(options.launch).resolve())]))
        execute(options.launch)
