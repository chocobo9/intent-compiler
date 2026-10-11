"""Apply the reviewed SpecArt overlay after validating every destination hash."""
import argparse
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent


def sha(data):
    return hashlib.sha256(data).hexdigest()


def sync(target, *, include_tests=False, apply=False, package=ROOT):
    target, package = Path(target).resolve(), Path(package).resolve()
    manifest = json.loads((package / 'overlay-manifest.json').read_text(encoding='utf-8'))
    pending = []
    for item in manifest['files']:
        relative = Path(item['path'])
        if relative.is_absolute() or '..' in relative.parts:
            raise ValueError('unsafe overlay path')
        if item['path'].startswith('tests/') and not include_tests:
            continue
        destination = target / relative
        if not destination.resolve().is_relative_to(target):
            raise ValueError(f'path escapes target: {relative}')
        data = (package / 'overlay' / relative).read_bytes()
        if sha(data) != item['sha256']:
            raise ValueError(f'overlay hash mismatch: {relative}')
        current = sha(destination.read_bytes()) if destination.exists() else None
        if current not in {item['before_sha256'], item['sha256'], *item.get('previous_sha256', [])}:
            raise ValueError(f'upstream drift; no files written: {relative}')
        if current != item['sha256']:
            pending.append((destination, data))
    if apply:
        for destination, data in pending:
            destination.parent.mkdir(parents=True, exist_ok=True)
            destination.write_bytes(data)
    return {'target': str(target), 'mode': 'apply' if apply else 'check', 'changed_files': len(pending)}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--target', required=True)
    parser.add_argument('--include-tests', action='store_true')
    parser.add_argument('--apply', action='store_true')
    print(json.dumps(sync(**vars(parser.parse_args())), indent=2))
