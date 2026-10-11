import hashlib
import json

import pytest

from sync import sync


def test_sync_preflights_all_files_and_is_idempotent(tmp_path):
    package, target = tmp_path / 'package', tmp_path / 'target'
    (package / 'overlay').mkdir(parents=True)
    target.mkdir()
    files = []
    for name in ['a.txt', 'b.txt']:
        (target / name).write_bytes(b'before')
        (package / 'overlay' / name).write_bytes(b'after')
        files.append({'path': name, 'before_sha256': hashlib.sha256(b'before').hexdigest(),
                      'sha256': hashlib.sha256(b'after').hexdigest()})
    (package / 'overlay-manifest.json').write_text(json.dumps({'files': files}))
    (target / 'b.txt').write_bytes(b'unrelated edits')
    with pytest.raises(ValueError, match='upstream drift'):
        sync(target, apply=True, package=package)
    assert (target / 'a.txt').read_bytes() == b'before'
    (target / 'b.txt').write_bytes(b'before')
    assert sync(target, package=package)['changed_files'] == 2
    assert (target / 'a.txt').read_bytes() == b'before'
    assert sync(target, apply=True, package=package)['changed_files'] == 2
    assert sync(target, apply=True, package=package)['changed_files'] == 0

    # A reviewed prior overlay may be upgraded; unrelated edits still fail.
    for item in files:
        item['previous_sha256'] = [item['sha256']]
        item['sha256'] = hashlib.sha256(b'fixed').hexdigest()
        (package / 'overlay' / item['path']).write_bytes(b'fixed')
    (package / 'overlay-manifest.json').write_text(json.dumps({'files': files}))
    (target / 'b.txt').write_bytes(b'unknown')
    with pytest.raises(ValueError, match='upstream drift'):
        sync(target, apply=True, package=package)
    assert (target / 'a.txt').read_bytes() == b'after'
    (target / 'b.txt').write_bytes(b'after')
    assert sync(target, apply=True, package=package)['changed_files'] == 2
    assert sync(target, apply=True, package=package)['changed_files'] == 0
