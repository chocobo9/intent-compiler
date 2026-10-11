"""Own an entire process tree, including reparented Git Bash children."""
import ctypes
from ctypes import wintypes
import os
import signal
import subprocess
import time


class ProcessScope:
    def __init__(self):
        self.proc = None
        self.job = None
        if os.name != 'nt':
            return
        self.kernel = ctypes.WinDLL('kernel32', use_last_error=True)
        self.kernel.CreateJobObjectW.argtypes = [ctypes.c_void_p, wintypes.LPCWSTR]
        self.kernel.CreateJobObjectW.restype = wintypes.HANDLE
        for name, args in {
            'SetInformationJobObject': [wintypes.HANDLE, ctypes.c_int, ctypes.c_void_p, wintypes.DWORD],
            'AssignProcessToJobObject': [wintypes.HANDLE, wintypes.HANDLE],
            'TerminateJobObject': [wintypes.HANDLE, wintypes.UINT],
            'QueryInformationJobObject': [wintypes.HANDLE, ctypes.c_int, ctypes.c_void_p, wintypes.DWORD, ctypes.c_void_p],
            'CloseHandle': [wintypes.HANDLE],
        }.items():
            getattr(self.kernel, name).argtypes = args
            getattr(self.kernel, name).restype = wintypes.BOOL

        class Basic(ctypes.Structure):
            _fields_ = [('process_time', ctypes.c_longlong), ('job_time', ctypes.c_longlong),
                        ('flags', wintypes.DWORD), ('min_working', ctypes.c_size_t), ('max_working', ctypes.c_size_t),
                        ('active_limit', wintypes.DWORD), ('affinity', ctypes.c_size_t),
                        ('priority', wintypes.DWORD), ('scheduling', wintypes.DWORD)]

        class Extended(ctypes.Structure):
            _fields_ = [('basic', Basic), ('io', ctypes.c_ulonglong * 6),
                        ('process_memory', ctypes.c_size_t), ('job_memory', ctypes.c_size_t),
                        ('peak_process', ctypes.c_size_t), ('peak_job', ctypes.c_size_t)]

        self.job = self.kernel.CreateJobObjectW(None, None)
        if not self.job:
            raise ctypes.WinError(ctypes.get_last_error())
        limits = Extended()
        limits.basic.flags = 0x2000  # JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
        if not self.kernel.SetInformationJobObject(self.job, 9, ctypes.byref(limits), ctypes.sizeof(limits)):
            self.kernel.CloseHandle(self.job)
            self.job = None
            raise ctypes.WinError(ctypes.get_last_error())

    def start(self, args, **kwargs):
        if os.name != 'nt':
            self.proc = subprocess.Popen(args, start_new_session=True, **kwargs)
            return self.proc
        # Assign while suspended: no child can escape between spawn and assign.
        self.proc = subprocess.Popen(args, creationflags=0x4 | 0x08000000, **kwargs)
        if not self.kernel.AssignProcessToJobObject(self.job, wintypes.HANDLE(int(self.proc._handle))):
            self.proc.kill(); self.proc.wait()
            self.kernel.CloseHandle(self.job); self.job = None
            raise RuntimeError('Cannot contain process tree in Windows Job Object')
        resume = ctypes.WinDLL('ntdll').NtResumeProcess
        resume.argtypes = [wintypes.HANDLE]
        resume.restype = ctypes.c_long
        if resume(wintypes.HANDLE(int(self.proc._handle))) != 0:
            self.close()
            raise RuntimeError('Cannot resume contained process')
        return self.proc

    def close(self, timeout=10):
        if os.name != 'nt':
            if self.proc:
                try:
                    os.killpg(self.proc.pid, signal.SIGKILL)
                except ProcessLookupError:
                    pass
                self.proc.wait(timeout=timeout)
            return True
        if not self.job:
            return True
        self.kernel.TerminateJobObject(self.job, 124)

        class Accounting(ctypes.Structure):
            _fields_ = [('times', ctypes.c_longlong * 4), ('faults', wintypes.DWORD),
                        ('total', wintypes.DWORD), ('active', wintypes.DWORD), ('terminated', wintypes.DWORD)]

        end = time.monotonic() + timeout
        confirmed = False
        while time.monotonic() < end:
            info = Accounting()
            if not self.kernel.QueryInformationJobObject(self.job, 1, ctypes.byref(info), ctypes.sizeof(info), None):
                break
            if info.active == 0:
                confirmed = True
                break
            time.sleep(.05)
        self.kernel.CloseHandle(self.job)
        self.job = None
        if self.proc:
            self.proc.wait(timeout=timeout)
        return confirmed
