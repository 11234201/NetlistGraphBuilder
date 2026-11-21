"""Pinned file reads, bounded directory listings and atomic output publication."""
import os
import stat
import tempfile
from contextlib import contextmanager

from workbench_protocol import CommandError


def canonical(path):
    return os.path.normcase(os.path.realpath(os.path.abspath(path)))


def inside(path, root):
    try:
        return os.path.commonpath([root, path]) == root
    except ValueError:  # Different Windows drives
        return False


def opened_path(fd):
    if os.name != "nt":
        if os.path.isdir("/proc/self/fd"):
            return canonical("/proc/self/fd/%d" % fd)
        return None
    import msvcrt
    return windows_handle_path(msvcrt.get_osfhandle(fd))


def windows_handle_path(handle):
    import ctypes
    from ctypes import wintypes
    resolve = ctypes.WinDLL("kernel32", use_last_error=True).GetFinalPathNameByHandleW
    resolve.argtypes = (wintypes.HANDLE, wintypes.LPWSTR, wintypes.DWORD, wintypes.DWORD)
    resolve.restype = wintypes.DWORD
    size = resolve(handle, None, 0, 0)
    if not size:
        raise ctypes.WinError(ctypes.get_last_error())
    result = ctypes.create_unicode_buffer(size + 1)
    if not resolve(handle, result, len(result), 0):
        raise ctypes.WinError(ctypes.get_last_error())
    path = result.value
    if path.startswith("\\\\?\\UNC\\"):
        path = "\\\\" + path[8:]
    elif path.startswith("\\\\?\\"):
        path = path[4:]
    return path


@contextmanager
def directory_paths(path):
    if os.name == "nt":
        import ctypes
        from ctypes import wintypes
        kernel = ctypes.WinDLL("kernel32", use_last_error=True)
        kernel.CreateFileW.argtypes = (wintypes.LPCWSTR, wintypes.DWORD, wintypes.DWORD, wintypes.LPVOID,
                                       wintypes.DWORD, wintypes.DWORD, wintypes.HANDLE)
        kernel.CreateFileW.restype = wintypes.HANDLE
        kernel.CloseHandle.argtypes = (wintypes.HANDLE,)
        # Keep the opened directory in place for the entire enumeration.
        handle = kernel.CreateFileW(path, 0x80, 3, None, 3, 0x02000000, None)
        if handle == wintypes.HANDLE(-1).value:
            raise ctypes.WinError(ctypes.get_last_error())
        try:
            pinned = windows_handle_path(handle)
            yield pinned, pinned
        finally:
            kernel.CloseHandle(handle)
    elif os.path.isdir("/proc/self/fd"):
        fd = os.open(path, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
        try:
            yield opened_path(fd), "/proc/self/fd/%d" % fd
        finally:
            os.close(fd)
    else:
        yield path, path


class WorkbenchFiles:
    def __init__(self, roots, state_path, private_dir, log):
        self.roots = [os.path.realpath(os.path.abspath(path)) for path in roots or [os.getcwd()]]
        if any(not os.path.isdir(path) for path in self.roots):
            raise CommandError("NOT_DIRECTORY", "Expected a browse root directory")
        self._roots = [canonical(path) for path in self.roots]
        self.private = canonical(private_dir)
        self.state = canonical(state_path)
        self.log = log

    def protected(self, path):
        path = canonical(path)
        return path == self.state or path.startswith(self.state + ".tmp.") or inside(path, self.private) or self.log.contains(path)

    def check(self, path, browser):
        path = os.path.realpath(os.path.abspath(path))
        if self.protected(path) or (browser and not any(inside(canonical(path), root) for root in self._roots)):
            raise CommandError("ACCESS_DENIED", "Path is outside the available files")
        return path

    @contextmanager
    def regular(self, path, browser):
        actual = self.check(path, browser)
        flags = os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0) | getattr(os, "O_NONBLOCK", 0) | getattr(os, "O_BINARY", 0)
        fd = os.open(actual, flags)
        with os.fdopen(fd, "rb", buffering=0) as stream:
            pinned = opened_path(fd)
            if pinned:
                self.check(pinned, browser)
            elif not os.path.samestat(os.stat(actual), os.fstat(fd)):
                raise CommandError("FILE_CHANGED", "File changed while opening")
            if not stat.S_ISREG(os.fstat(fd).st_mode):
                raise CommandError("FILE_LIMIT", "Expected a regular file")
            yield stream

    def read(self, path, browser):
        with self.regular(path, browser) as stream:
            before = os.fstat(stream.fileno())
            if before.st_size > 16 * 1024 * 1024:
                raise CommandError("FILE_LIMIT", "Expected a regular file under 16 MiB")
            content = bytearray()
            while len(content) <= before.st_size:
                chunk = stream.read(min(65536,before.st_size + 1 - len(content)))
                if not chunk:
                    break
                content.extend(chunk)
            after = os.fstat(stream.fileno())
            if (len(content), after.st_size, after.st_mtime_ns, after.st_ctime_ns) != (
                    before.st_size, before.st_size, before.st_mtime_ns, before.st_ctime_ns):
                raise CommandError("FILE_CHANGED", "File changed while reading")
        return {"name": os.path.basename(path), "text": content.decode("utf-8", "replace")}

    def list(self, path, query="", number=1, browser=True, prefix=False):
        path = self.check(path or self.roots[0], browser)
        if not isinstance(number, int) or number < 1 or not isinstance(query, str):
            raise CommandError("INVALID_ARGUMENT", "Invalid directory query")
        entries = []
        with directory_paths(path) as (actual, directory):
            path = self.check(actual, browser)
            with os.scandir(directory) as listing:
                for entry in listing:
                    is_dir = entry.is_dir(follow_symlinks=False)
                    matches = entry.name.startswith(query) if prefix else query.casefold() in entry.name.casefold()
                    if matches and (is_dir or entry.is_file(follow_symlinks=False)) and not self.protected(os.path.join(path, entry.name)):
                        entries.append({"name": entry.name, "directory": is_dir})
                        if len(entries) > 50000:
                            raise CommandError("DIRECTORY_LIMIT", "Narrow the directory filter")
        entries.sort(key=lambda entry: (not entry["directory"], entry["name"]))
        return {"path": path, "roots": self.roots, "entries": entries[(number - 1)*100:number*100],
                "number": number, "total": len(entries)}

    def output(self, path, text, overwrite):
        parent = os.path.realpath(os.path.dirname(path))
        path = os.path.join(parent, os.path.basename(path))
        self.check(path, False)
        if not isinstance(text, str):
            raise CommandError("INVALID_ARGUMENT", "Expected export text")
        contents = text.encode("utf8")
        fd, filename = tempfile.mkstemp(prefix=".ngb-export-",dir=parent)
        try:
            with os.fdopen(fd, "wb") as stream:
                stream.write(contents)
                stream.flush()
                os.fsync(stream.fileno())
            if overwrite:
                os.replace(filename, path)
            else:
                os.link(filename, path)
            return {"path": path, "bytes": len(contents)}
        finally:
            if os.path.exists(filename):
                os.unlink(filename)
