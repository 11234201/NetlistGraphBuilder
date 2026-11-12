"""Startup retention for recognized, inactive terminal log sessions only."""
import os
import re
import stat
import time

LOG_NAME = re.compile(r"(bash|node|python|native|windows)-[0-9]{1,20}-([1-9][0-9]{0,9})\.(run|error)\.jsonl(?:\.1)?")


def is_inactive(pid):
    if os.name == "nt":
        # os.kill(pid, 0) can terminate a Windows process. Probe a handle instead.
        import ctypes
        from ctypes import wintypes
        kernel = ctypes.WinDLL("kernel32", use_last_error=True)
        kernel.OpenProcess.argtypes = [wintypes.DWORD, wintypes.BOOL, wintypes.DWORD]
        kernel.OpenProcess.restype = wintypes.HANDLE
        kernel.WaitForSingleObject.argtypes = [wintypes.HANDLE, wintypes.DWORD]
        kernel.WaitForSingleObject.restype = wintypes.DWORD
        kernel.CloseHandle.argtypes = [wintypes.HANDLE]
        handle = kernel.OpenProcess(0x00100000, False, pid)  # SYNCHRONIZE
        if not handle:
            return ctypes.get_last_error() == 87  # ERROR_INVALID_PARAMETER: no such PID
        try:
            return kernel.WaitForSingleObject(handle, 0) == 0  # Signaled: exited
        finally:
            kernel.CloseHandle(handle)
    try:
        os.kill(pid, 0)
        return False
    except ProcessLookupError:
        return True
    except OSError:
        return False  # Access denied / unknown: retain logs conservatively.


def cleanup_terminal_logs(directory, configured):
    value = str(configured or "")
    days = int(value) if re.fullmatch(r"[0-9]{1,4}", value) and int(value) <= 3650 else 14
    result = dict(retentionDays=days, deletedFiles=0, deletedBytes=0, failedFiles=0)
    if not days:
        return result
    cutoff = time.time() - days * 86400
    groups = {}

    def failed(error):
        if isinstance(error, FileNotFoundError):
            return
        result["failedFiles"] += 1
        result.setdefault("error", error)

    try:
        for name in os.listdir(directory):
            match = LOG_NAME.fullmatch(name)
            if not match or int(match[2]) > 2147483647:
                continue
            key = name.split(".", 1)[0]
            group = groups.setdefault(key, dict(pid=int(match[2]), paths=[]))
            group["paths"].append(os.path.join(directory, name))
        for group in groups.values():
            if not is_inactive(group["pid"]):
                continue
            candidates = []
            preserve = False
            for path in group["paths"]:
                try:
                    info = os.lstat(path)
                    if not stat.S_ISREG(info.st_mode) or info.st_mtime >= cutoff:
                        preserve = True
                    candidates.append((path, info.st_size))
                except OSError as error:
                    failed(error)
                    preserve = True
            if preserve or not is_inactive(group["pid"]):
                continue
            for path, size in candidates:
                try:
                    os.unlink(path)
                    result["deletedFiles"] += 1
                    result["deletedBytes"] += size
                except OSError as error:
                    failed(error)
    except OSError as error:
        failed(error)
    return result
