"""Build a content-addressed standard-library helper; never execute target code."""
from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path
import subprocess
import tempfile

from .cangjie import HelperError, _locked_file
from ..diagnostics import Diagnostic


class GoHelperClient:
    def __init__(self, validator_root):
        self.source = Path(validator_root) / 'go/main.go'

    def parse_file(self, path, *, declaration=False):
        try:
            override = os.environ.get('SPECART_GO_HELPER')
            if override:
                binary = Path(override)
            else:
                go = os.environ.get('SPECART_GO', 'go')
                key = hashlib.sha256(self.source.read_bytes() + go.encode()).hexdigest()[:20]
                directory = Path(tempfile.gettempdir()) / 'specart' / ('go-' + key)
                binary = directory / ('helper.exe' if os.name == 'nt' else 'helper')
                with _locked_file(directory / 'build.lock'):
                    if not binary.exists():
                        target = binary.with_suffix('.building.exe' if os.name == 'nt' else '.building')
                        result = subprocess.run([go, 'build', '-o', str(target), str(self.source)],
                                                capture_output=True, text=True, encoding='utf-8',
                                                env={**os.environ, 'GOPROXY': 'off', 'GOSUMDB': 'off'}, timeout=120)
                        if result.returncode:
                            raise ValueError(result.stderr)
                        target.replace(binary)
            result = subprocess.run([str(binary), *(['--declaration'] if declaration else []), str(path)],
                                    capture_output=True, text=True, encoding='utf-8', timeout=30)
            data = json.loads(result.stdout)
            if result.returncode or data.get('diagnostics'):
                raise ValueError(str(data.get('diagnostics') or result.stderr))
            if data.get('schema_version') != 1 or not isinstance(data.get('declarations'), list):
                raise ValueError('invalid Go helper protocol')
            return data
        except (OSError, ValueError, subprocess.SubprocessError) as error:
            raise HelperError(Diagnostic(code='SA103', title='Go 声明解析失败', file=str(path),
                                        found=str(error), reason='Go parser 必须成功返回完整声明。',
                                        suggestion='检查 Go 工具链与源码；不回退到其他语言。')) from error
