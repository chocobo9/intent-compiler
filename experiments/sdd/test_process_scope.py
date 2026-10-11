import subprocess
import sys
import time

from process_scope import ProcessScope


def test_reparented_child_cannot_outlive_scope(tmp_path):
    marker = tmp_path / 'escaped.txt'
    child = 'import time,pathlib; time.sleep(2); pathlib.Path(' + repr(str(marker)) + ').write_text("escaped")'
    parent = 'import subprocess,sys; subprocess.Popen([sys.executable,"-c",' + repr(child) + '])'
    scope = ProcessScope()
    try:
        proc = scope.start([sys.executable, '-c', parent], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        assert proc.wait(timeout=10) == 0
    finally:
        assert scope.close()
    time.sleep(2.2)
    assert not marker.exists()
