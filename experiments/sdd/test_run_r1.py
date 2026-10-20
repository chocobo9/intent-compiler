"""Offline native argument transport and configuration tests; never call a model."""
import json
import hashlib
import os
from pathlib import Path
import subprocess
import sys

import pytest

from run_r1 import (BASH, GO, MODEL, VARIANT, BUILD_COMMAND, execution_env, go_settings,
                    prepare_python3, resolve_opencode, write_guard, agent_profiles)


def test_agent_profiles_are_the_upstream_role_definitions(tmp_path):
    profiles = agent_profiles(tmp_path)
    expected = {'specart-author': 'specart-author/SKILL.md', 'specart-spec-review': 'specart/assets/spec-review-agent.md',
                'specart-implement': 'specart-implement/SKILL.md', 'specart-verify': 'specart-verify/SKILL.md',
                'specart-slice': 'specart-verify/assets/slice-agent.md',
                'specart-fallback-review': 'specart-verify/assets/fallback-review-agent.md'}
    assert set(profiles) == set(expected)
    for role, resource in expected.items():
        prompt = profiles[role]['prompt']
        assert prompt.startswith('Read and follow `' + (tmp_path / '.agents/skills' / resource).as_posix() + '` completely before acting.')
        assert 'ADAPTER-CONTEXT' not in prompt
        assert 'Relative paths in that file are relative to `' + (tmp_path / '.agents/skills' / resource).parent.as_posix() + '`' in prompt


@pytest.fixture(scope='module')
def native_probe():
    # Use an installed native runtime: Windows application control can reject
    # newly compiled executables in temporary directories.
    return Path(sys.executable)


def test_bash_guard_native_preserves_complete_prompt(tmp_path, native_probe):
    guard = tmp_path / 'model_guard.py'
    write_guard(guard, native_probe)
    prompt = '首行 "quoted"\nGo CLI 说明\n末行：%PATH% & | $HOME `literal` \\'
    args = ['run', '--model', MODEL, '--variant', VARIANT, '--', prompt]
    probe_args = ['-c', 'import json,sys; print(json.dumps(sys.argv[1:]))', *args]
    # The same Bash -> Python guard -> native process boundary as the runner.
    proc = subprocess.run([BASH, '-c', 'exec "$@"', 'probe', Path(sys.executable).as_posix(),
                           guard.as_posix(), *probe_args], capture_output=True, text=True,
                          encoding='utf-8', timeout=30)
    assert proc.returncode == 0, proc.stderr
    assert json.loads(proc.stdout) == args


@pytest.mark.parametrize('options', [
    ['--model', 'wrong', '--variant', VARIANT],
    ['--model', MODEL, '--variant', 'wrong'],
    ['--model', MODEL, '--model', 'wrong', '--variant', VARIANT],
    ['--', '--model', MODEL, '--variant', VARIANT],
])
def test_guard_refuses_wrong_or_ambiguous_profile(tmp_path, native_probe, options):
    guard = tmp_path / 'guard.py'
    write_guard(guard, native_probe)
    proc = subprocess.run([sys.executable, str(guard), 'run', *options], capture_output=True, text=True)
    assert proc.returncode != 0
    assert 'MODEL_PROFILE_MISMATCH' in proc.stderr
    assert not proc.stdout  # Native target was not invoked.


def test_environment_overrides_host_and_retains_frozen_settings():
    settings = {'SPECLANG_MODEL': MODEL, 'SPECLANG_VARIANT': VARIANT,
                'OPENCODE_NATIVE': 'C:/native/opencode.exe', 'PATH_PREFIX': ['C:/go/bin'],
                'SPECART_GO_HELPER': 'C:/approved/specart-go.exe',
                'SPECART_GO_HELPER_MANIFEST': 'C:/approved/specart-go.json', **go_settings()}
    before = dict(settings)
    inherited = {k: 'conflicting host value' for k in settings if k != 'PATH_PREFIX'}
    inherited['PATH'] = 'C:/host/bin'
    env = execution_env(settings, inherited)
    assert all(env[k] == v for k, v in settings.items() if k != 'PATH_PREFIX')
    assert env['PATH'] == 'C:/go/bin' + os.pathsep + 'C:/host/bin'
    assert settings == before
    del settings['SPECLANG_BUILD_COMMAND']
    with pytest.raises(ValueError, match='Missing frozen runtime setting'):
        execution_env(settings, inherited)


def test_approved_go_helper_manifest_binds_exact_source_builder_and_binary(tmp_path):
    from run_r1 import sha, validate_approved_go_helper
    source = tmp_path / 'go/main.go'; source.parent.mkdir(); source.write_text('package main')
    helper = tmp_path / 'helper.exe'; helper.write_bytes(b'approved helper')
    toolchain = tmp_path / 'go.exe'; toolchain.write_bytes(b'go toolchain')
    manifest = tmp_path / 'helper.json'
    manifest.write_text(json.dumps({'schema_version': 1,
        'source': {'path': str(source.resolve()), 'sha256': sha(source)},
        'binary': {'path': str(helper.resolve()), 'sha256': sha(helper)},
        'build': {'command': 'go build -o helper.exe main.go', 'version': 'go1.27.2 windows/amd64',
                  'toolchain_path': str(toolchain.resolve()), 'toolchain_sha256': sha(toolchain)}}))
    result = validate_approved_go_helper(helper, manifest, source)
    assert set(result) == {str(source.resolve()), str(helper.resolve()), str(manifest.resolve()), str(toolchain.resolve())}
    source.write_text('package main\n// changed')
    with pytest.raises(ValueError, match='not built from this frozen validator source'):
        validate_approved_go_helper(helper, manifest, source)


def test_resolve_native_from_npm_wrapper(tmp_path):
    wrapper = tmp_path / 'opencode.cmd'
    wrapper.write_text('must never execute this wrapper')
    with pytest.raises(RuntimeError):
        resolve_opencode(wrapper)
    native = tmp_path / 'node_modules/opencode-ai/bin/opencode.exe'
    native.parent.mkdir(parents=True)
    native.write_bytes(b'fixture')
    assert resolve_opencode(wrapper) == native


def test_python3_is_native_in_powershell_and_bash(tmp_path):
    scripts = prepare_python3(tmp_path)
    env = {**os.environ, 'PATH': str(scripts) + os.pathsep + os.environ['PATH']}
    for command in [
        ['powershell.exe', '-NoProfile', '-NonInteractive', '-Command',
         '(Get-Command python3).Source; python3 -c "print(123)"'],
        [BASH, '-c', 'command -v python3; python3 -c "print(123)"'],
    ]:
        result = subprocess.run(command, env=env, capture_output=True, text=True, timeout=30)
        assert result.returncode == 0, result.stderr
        assert '123' in result.stdout
        assert 'python3' in result.stdout and 'WindowsApps' not in result.stdout


@pytest.mark.parametrize('layout', ['.', 'cmd/tool'])
def test_cli_packaging_locates_main_package(tmp_path, layout):
    (tmp_path / 'go.mod').write_text('module example.org/tool\ngo 1.22\n')
    entry = tmp_path / layout
    entry.mkdir(parents=True, exist_ok=True)
    lib = tmp_path / 'internal/value'
    lib.mkdir(parents=True)
    (lib / 'value.go').write_text('package value\nconst Value = 42\n')
    (entry / 'main.go').write_text('package main\nimport "example.org/tool/internal/value"\nfunc main() { println(value.Value) }\n')
    script = Path(__file__).with_name('build_go_cli.sh')
    env = {**os.environ, 'PATH': str(GO.parent) + os.pathsep + os.environ['PATH']}
    result = subprocess.run([BASH, script.as_posix()], cwd=tmp_path, env=env,
                            capture_output=True, text=True, timeout=60)
    assert result.returncode == 0, result.stderr
    assert (tmp_path / 'dpipe').is_file()
    assert (tmp_path / '.sdd-build/requested-command-exit-code.txt').read_text().strip() != '0'
    assert (tmp_path / '.sdd-build/packaging-mode.txt').read_text().strip() == 'unique-main-adapter'


def test_packaging_rejects_multiple_main_packages(tmp_path):
    (tmp_path / 'go.mod').write_text('module example.org/tool\ngo 1.22\n')
    for name in ['a', 'b']:
        directory = tmp_path / name
        directory.mkdir()
        (directory / 'main.go').write_text('package main\nfunc main() {}\n')
    result = subprocess.run([BASH, Path(__file__).with_name('build_go_cli.sh').as_posix()], cwd=tmp_path,
        env={**os.environ, 'PATH': str(GO.parent) + os.pathsep + os.environ['PATH']}, capture_output=True, text=True)
    assert result.returncode != 0
    assert not (tmp_path / 'dpipe').exists()


def test_development_build_enforces_requested_executable_command(tmp_path):
    (tmp_path / 'go.mod').write_text('module example.org/tool\ngo 1.22\n')
    (tmp_path / 'main.go').write_text('package main\nfunc main() {}\n')
    env = {**os.environ, 'MSYS_NO_PATHCONV': '1', 'PATH': str(GO.parent) + os.pathsep + os.environ['PATH']}
    result = subprocess.run([BASH, '-c', BUILD_COMMAND], cwd=tmp_path, env=env, capture_output=True)
    assert result.returncode == 0 and (tmp_path / 'dpipe').exists()
    (tmp_path / 'lib').mkdir()
    (tmp_path / 'lib/value.go').write_text('package lib\nconst Value = 1\n')
    result = subprocess.run([BASH, '-c', BUILD_COMMAND], cwd=tmp_path, env=env, capture_output=True)
    assert result.returncode != 0  # Same package-layout failure as the delivery build.


def test_change_stage_retry_only_after_a_change_verdict_that_did_not_pass(tmp_path):
    from run_r1 import CHANGE_DOCUMENT, change_stage_retry
    root = tmp_path / 'trial'
    run = root / 'runs/r10'
    (run / 'logs').mkdir(parents=True)
    (run / 'output').mkdir()
    for stage in ('prd', 'sd'):
        (run / 'logs' / f'{stage}.state.json').write_text('{"status": "passed"}', encoding='utf-8')
    (run / CHANGE_DOCUMENT).write_text('verdict: FAIL', encoding='utf-8')
    failed = {'exit_code': 1, 'cleanup_confirmed': True}
    assert change_stage_retry(root, run, {'exit_code': 0, 'cleanup_confirmed': True}) is None
    assert change_stage_retry(root, run, {'exit_code': 1, 'cleanup_confirmed': False}) is None
    record = change_stage_retry(root, run, failed)
    assert record and not (run / CHANGE_DOCUMENT).exists() and (root / 'change-retry' / '05-变更说明书.md').read_text(encoding='utf-8') == 'verdict: FAIL'
    # Once per trial.
    (run / CHANGE_DOCUMENT).write_text('verdict: FAIL', encoding='utf-8')
    assert change_stage_retry(root, run, failed) is None
    # A stop before the change stage (SD not passed) is not this retry.
    other = tmp_path / 'other'
    (other / 'runs/r10/logs').mkdir(parents=True); (other / 'runs/r10/output').mkdir()
    (other / 'runs/r10/logs/prd.state.json').write_text('{"status": "passed"}', encoding='utf-8')
    (other / 'runs/r10' / CHANGE_DOCUMENT).write_text('x', encoding='utf-8')
    assert change_stage_retry(other, other / 'runs/r10', failed) is None
