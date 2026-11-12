"""Bounded per-process JSONL diagnostics; stdout remains a machine protocol."""
import datetime
import json
import os
import sys
import tempfile
import threading
import time
import traceback
from log_retention import cleanup_terminal_logs


class TerminalLog:
    def __init__(self, runtime):
        self.runtime = runtime
        base = (os.environ.get("LOCALAPPDATA") or tempfile.gettempdir()) if os.name == "nt" else (
            os.environ.get("XDG_STATE_HOME") or os.path.expanduser("~/.local/state"))
        self.directory = os.path.abspath(os.environ.get("NGB_LOG_DIR") or os.path.join(base, "netlist_graph_builder", "logs"))
        prefix = "{}-{}-{}".format(runtime, int(time.time() * 1000), os.getpid())
        self.files = {kind: os.path.join(self.directory, prefix + "." + kind + ".jsonl") for kind in ("run", "error")}
        self.sizes = {"run": 0, "error": 0}
        try:
            limit = int(os.environ.get("NGB_LOG_MAX_BYTES", "2097152"))
        except ValueError:
            limit = 2097152
        self.limit = limit if 1024 <= limit <= 67108864 else 2097152
        self.enabled = True
        self.lock = threading.Lock()
        try:
            os.makedirs(self.directory, mode=0o700, exist_ok=True)
            for path in self.files.values():
                os.close(os.open(path, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600))
        except OSError as error:
            self.disable(error)
        self.write("info", "log.ready", "Terminal logging initialized", files=self.files)
        if self.enabled:
            result = cleanup_terminal_logs(self.directory, os.environ.get("NGB_LOG_RETENTION_DAYS"))
            failed = bool(result["failedFiles"])
            self.write("error" if failed else "info", "log.cleanup_failed" if failed else "log.cleanup",
                       "Old terminal log cleanup completed", console=failed, **result)

    def record(self, level, event, message, details):
        return dict(time=datetime.datetime.now(datetime.timezone.utc).isoformat(), level=level,
                    runtime=self.runtime, pid=os.getpid(), event=event, message=str(message)[:4096], details=details)

    def terminal(self, item):
        try:
            sys.stderr.write(json.dumps(item, ensure_ascii=True) + "\n")
            sys.stderr.flush()
        except (OSError, ValueError):
            pass

    def disable(self, error):
        if not self.enabled:
            return
        self.enabled = False
        self.terminal(self.record("error", "log.write_failed", "File logging unavailable; continuing on stderr",
                                  dict(error=str(error)[:4096], directory=self.directory)))

    def write(self, level, event, message, error=None, console=True, **details):
        details = {key: value[:4096] if isinstance(value, str) else value for key, value in details.items()}
        if error is not None:
            details["error"] = dict(name=type(error).__name__, message=str(error)[:4096],
                                    stack="".join(traceback.format_exception(type(error), error, error.__traceback__))[:8192])
            if getattr(error, "errno", None) is not None:
                details["error"]["code"] = error.errno
        item = self.record(level, event, message, details)
        encoded = (json.dumps(item, ensure_ascii=True) + "\n").encode("utf8")
        with self.lock:
            if self.enabled:
                try:
                    for kind in (("run", "error") if level == "error" else ("run",)):
                        path = self.files[kind]
                        if self.sizes[kind] and self.sizes[kind] + len(encoded) > self.limit:
                            os.replace(path, path + ".1")
                            self.sizes[kind] = 0
                        fd = os.open(path, os.O_WRONLY | os.O_APPEND | os.O_CREAT | getattr(os, "O_NOFOLLOW", 0), 0o600)
                        with os.fdopen(fd, "ab") as output:
                            output.write(encoded)
                        self.sizes[kind] += len(encoded)
                except OSError as failure:
                    self.disable(failure)
            if console or not self.enabled:
                self.terminal(item)

    def request(self, method, path, status):
        self.write("error" if status >= 500 else "warning" if status >= 400 else "info",
                   "http.response", "HTTP response", console=False, method=method,
                   path=path.split("?", 1)[0].split("#", 1)[0], status=status)

    def contains(self, path):
        try:
            return os.path.commonpath([self.directory, os.path.abspath(path)]) == self.directory
        except ValueError:
            return False
