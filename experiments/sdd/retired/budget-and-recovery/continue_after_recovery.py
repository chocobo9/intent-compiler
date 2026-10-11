"""Wait for one already-running recovery, then launch the remaining series once."""
import argparse
import json
import os
from pathlib import Path
import subprocess
import time

import run_r1
import run_series


def continue_when_complete(parent, recovered):
    parent, recovered = Path(parent).resolve(), Path(recovered).resolve()
    claim = recovered.with_name(recovered.name + '.series-continuation.json')
    with claim.open('x', encoding='utf-8') as out:
        json.dump({'status': 'waiting', 'parent': str(parent), 'recovered': str(recovered)}, out)
    while not (recovered / 'completion.json').exists():
        time.sleep(10)
    try:
        series = run_series.freeze_series(parent, recovered)
        run_r1.write_json(claim, {'status': 'running', 'series': str(series),
                                 'parent': str(parent), 'recovered': str(recovered)})
        with (series / 'launcher.log').open('wb') as log:
            result = subprocess.run([str(run_r1.PYTHON), str(series / 'adapter/run_series.py'),
                                     '--launch', str(series)], stdout=log, stderr=subprocess.STDOUT,
                                    env={**os.environ, 'PYTHONUTF8': '1'})
        status = json.loads((series / 'series-results.json').read_text(encoding='utf-8'))['status']
        run_r1.write_json(claim, {'status': status, 'series': str(series), 'exit_code': result.returncode,
                                 'parent': str(parent), 'recovered': str(recovered)})
    except Exception as error:
        run_r1.write_json(claim, {'status': 'blocked', 'error': str(error),
                                 'parent': str(parent), 'recovered': str(recovered)})
        raise


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('parent')
    parser.add_argument('recovered')
    args = parser.parse_args()
    continue_when_complete(args.parent, args.recovered)
