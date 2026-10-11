"""Reconstruct a reusable adapter package from one immutable completed run."""
import argparse
import hashlib
import json
from pathlib import Path
import shutil


def package(frozen, destination):
    frozen, destination = Path(frozen).resolve(), Path(destination).resolve()
    number = json.loads((frozen / 'round.json').read_text(encoding='utf-8'))['round']
    run = frozen / 'runs' / f'r{number}'
    files = {name: frozen / name for name in (
        'run_r1.py', 'run_results.py', 'prepare.py', 'model_guard.py', 'process_scope.py')}
    files.update({'execution-context.md': run / 'ADAPTER-CONTEXT.md',
                  'build_go_cli.sh': frozen / 'bin/build_go_cli.sh'})
    extension = run / '.agents/skills/generate-go-cli-system-design'
    for item in extension.rglob('*'):
        if item.is_file() and '__pycache__' not in item.parts:
            files['skills/generate-go-cli-system-design/' + item.relative_to(extension).as_posix()] = item
    if not extension.is_dir() or not all(path.is_file() for path in files.values()):
        raise ValueError('Incomplete frozen adapter resources')
    destination.mkdir(parents=True, exist_ok=False)
    entries = {}
    for relative, source in files.items():
        target = destination / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source, target)
        digest = hashlib.sha256(source.read_bytes()).hexdigest()
        assert hashlib.sha256(target.read_bytes()).hexdigest() == digest
        entries[relative] = {'source': str(source), 'sha256': digest}
    (destination / 'package-manifest.json').write_text(json.dumps(entries, indent=2), encoding='utf-8')
    return destination


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('frozen')
    parser.add_argument('destination')
    args = parser.parse_args()
    print(package(args.frozen, args.destination))
