"""Cross-runtime terminal protocol, diagnostics and file logging regressions."""
import argparse
import json
import os
from pathlib import Path
import queue
import shutil
import socket
import subprocess
import tempfile
import threading
import time
import urllib.error
import urllib.request

ROOT = Path(__file__).resolve().parents[2]


def records(directory, kind="run"):
    return [json.loads(line) for path in directory.glob("*." + kind + ".jsonl*")
            for line in path.read_text(encoding="utf8").splitlines() if line]


def request(port, path="/"):
    try:
        with urllib.request.urlopen("http://127.0.0.1:{}{}".format(port, path), timeout=5) as response:
            return response.status, response.read()
    except urllib.error.HTTPError as error:
        return error.code, error.read()


class Server:
    def __init__(self, command, logs, extra=(), env=None, open_browser=False):
        self.logs = logs
        self.env = dict(os.environ, NGB_LOG_DIR=str(logs), **(env or {}))
        self.stderr = tempfile.TemporaryFile(mode="w+b")
        self.child = subprocess.Popen(command + ["--port", "0"] + ([] if open_browser else ["--no-open"]) + list(extra), cwd=str(ROOT),
                                      env=self.env, stdout=subprocess.PIPE, stderr=self.stderr)
        self.lines = []
        arrived = queue.Queue()

        def read():
            for line in self.child.stdout:
                self.lines.append(line)
                arrived.put(line)
            arrived.put(b"")

        self.reader = threading.Thread(target=read, daemon=True)
        self.reader.start()
        try:
            line = arrived.get(timeout=10)
            self.ready = json.loads(line)
            assert self.ready["event"] == "ready"
        except Exception:
            self.close()
            raise AssertionError("No valid ready JSON: " + self.errors())

    def errors(self):
        self.stderr.seek(0)
        return self.stderr.read().decode("utf8", errors="replace")

    def close(self):
        if self.child.poll() is None:
            self.child.terminate()
            try:
                self.child.wait(timeout=5)
            except subprocess.TimeoutExpired:
                self.child.kill()
                self.child.wait(timeout=5)
                raise AssertionError("Launcher did not stop")
        self.reader.join(timeout=2)
        self.child.stdout.close()


def verify(command, label, root):
    logs = root / (label + "-日志")
    server = Server(command, logs)
    try:
        port = server.ready["port"]
        assert request(port)[0] == 200
        assert request(port, "/missing?token=must-not-log")[0] == 404
        assert request(port, "/styles.css")[0] == 200
        if label == "python":
            with urllib.request.urlopen("http://127.0.0.1:{}/index.html".format(port), timeout=5) as response:
                modified = response.headers["Last-Modified"]
            conditional = urllib.request.Request("http://127.0.0.1:{}/index.html".format(port),
                                                headers={"If-Modified-Since": modified})
            try:
                urllib.request.urlopen(conditional, timeout=5)
                raise AssertionError("conditional GET must retain its 304 response")
            except urllib.error.HTTPError as error:
                assert error.code == 304
    finally:
        server.close()
    assert len(server.lines) == 1, (label, "stdout contains diagnostics", server.lines)
    run = records(logs)
    assert "日志" in json.dumps(run, ensure_ascii=False), label
    assert any(item["event"] == "server.ready" for item in run), label
    assert any(item["event"] == "http.response" and item["details"]["status"] == 404 for item in run), label
    assert "must-not-log" not in json.dumps(run) + server.errors()
    assert all({"time", "level", "pid", "event", "runtime", "message"}.issubset(item) for item in run)
    if os.name != "nt":
        assert any(item["event"] == "process.exit" and item["details"]["exitCode"] == 0 for item in run)
        assert all(path.stat().st_mode & 0o077 == 0 for path in logs.glob("*.jsonl*"))
    server.stderr.close()

    if label == "windows":
        import ctypes
        from ctypes import wintypes
        kernel = ctypes.WinDLL("kernel32", use_last_error=True)
        kernel.CreateFileW.argtypes = [wintypes.LPCWSTR, wintypes.DWORD, wintypes.DWORD, wintypes.LPVOID,
                                      wintypes.DWORD, wintypes.DWORD, wintypes.HANDLE]
        kernel.CreateFileW.restype = wintypes.HANDLE
        kernel.CloseHandle.argtypes = [wintypes.HANDLE]
        locked = Path(command[0]).parent / "app" / ("terminal_read_failure_" + str(os.getpid()) + ".txt")
        with locked.open("x", encoding="utf8") as output:
            output.write("must-not-log-source")
        handle = kernel.CreateFileW(str(locked), 0x80000000, 0, None, 3, 128, None)
        assert handle != wintypes.HANDLE(-1).value
        server = None
        try:
            locked_logs = root / "windows-locked"
            server = Server(command, locked_logs)
            assert request(server.ready["port"], "/" + locked.name)[0] == 500
            assert request(server.ready["port"])[0] == 200
        finally:
            if server:
                server.close()
                server.stderr.close()
            kernel.CloseHandle(handle)
            locked.unlink()
        failures = records(locked_logs, "error")
        assert any(item["event"] == "http.failed" and item["details"]["error"]["stack"] for item in failures)
        assert "must-not-log-source" not in json.dumps(failures)

    if label in ("node", "python", "native"):
        helpers = root / (label + "-helpers")
        helpers.mkdir()
        opener = helpers / "xdg-open"
        opener.write_text("#!/bin/sh\necho must-not-be-on-stdout\nexit 7\n", encoding="utf8")
        opener.chmod(0o700)
        browser_logs = root / (label + "-browser")
        server = Server(command, browser_logs, open_browser=True,
                        env={"PATH": str(helpers) + os.pathsep + os.environ["PATH"], "BROWSER": str(opener)})
        try:
            deadline = time.monotonic() + 4
            while time.monotonic() < deadline:
                if any(item["event"] == "browser.open_failed" for item in records(browser_logs, "error")):
                    break
                time.sleep(0.05)
            else:
                raise AssertionError(label + ": browser opener failure missing")
            assert request(server.ready["port"])[0] == 200
        finally:
            server.close()
        assert len(server.lines) == 1, (label, server.lines)
        server.stderr.close()

    if label in ("node", "python"):
        unreadable = ROOT / "dc_runs" / ("terminal_unreadable_" + str(os.getpid()))
        unreadable.parent.mkdir(exist_ok=True)
        unreadable.write_text("must-not-log-source", encoding="utf8")
        unreadable.chmod(0)
        io_logs = root / (label + "-io")
        server = Server(command, io_logs)
        try:
            assert request(server.ready["port"], "/dc_runs/" + unreadable.name)[0] == 500
            assert request(server.ready["port"])[0] == 200
        finally:
            server.close()
            unreadable.chmod(0o600)
            unreadable.unlink()
        io_errors = records(io_logs, "error")
        assert any(item["event"] in ("http.failed", "http.read_failed") and item["details"]["error"]["stack"] for item in io_errors)
        assert "must-not-log-source" not in json.dumps(io_errors)
        server.stderr.close()

    if label in ("node", "python", "native"):
        state = root / (label + "-session.json")
        cleanup_logs = root / (label + "-cleanup")
        server = Server(command, cleanup_logs, extra=["--state-file", str(state)])
        # Corruption must be diagnosed, preserved, and never treated as our state.
        state.write_text("{bad", encoding="utf8")
        server.close()
        assert state.read_text(encoding="utf8") == "{bad"
        assert any(item["event"] == "session.cleanup_failed" for item in records(cleanup_logs, "error")), label
        server.stderr.close()

    bad_logs = root / (label + "-invalid")
    invalid = subprocess.run(command + ["--port", "invalid", "--no-open"], cwd=str(ROOT),
                             env=dict(os.environ, NGB_LOG_DIR=str(bad_logs)), stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=10)
    assert invalid.returncode != 0 and not invalid.stdout, (label, invalid.stdout)
    errors = records(bad_logs, "error")
    assert any(item["event"] == "process.exit" and item["details"]["exitCode"] != 0 for item in errors), label
    assert len(errors) >= 2, (label, errors)
    assert all(item["level"] == "error" for item in errors)

    occupied = socket.socket()
    occupied.bind(("127.0.0.1", 0))
    occupied.listen(1)
    try:
        port_logs = root / (label + "-port")
        result = subprocess.run(command + ["--port", str(occupied.getsockname()[1]), "--no-open"], cwd=str(ROOT),
                                env=dict(os.environ, NGB_LOG_DIR=str(port_logs)), stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=10)
        assert result.returncode != 0 and not result.stdout, label
        assert records(port_logs, "error"), label
    finally:
        occupied.close()

    blocked = root / (label + "-blocked")
    blocked.write_text("not a directory", encoding="utf8")
    server = Server(command, blocked)
    try:
        assert request(server.ready["port"])[0] == 200
    finally:
        server.close()
    diagnostic = server.errors()
    assert "log.write_failed" in diagnostic and "server.ready" in diagnostic
    assert len(server.lines) == 1
    server.stderr.close()

    rolling = root / (label + "-rolling")
    server = Server(command, rolling, env={"NGB_LOG_MAX_BYTES": "1024"})
    try:
        for index in range(24):
            assert request(server.ready["port"], "/absent-" + str(index))[0] == 404
    finally:
        server.close()
    assert list(rolling.glob("*.run.jsonl.1")), label
    assert all(path.stat().st_size <= 2048 for path in rolling.glob("*.jsonl*")), label
    assert any(item["event"] == "http.response" and item["details"].get("path") == "/absent-23" for item in records(rolling))
    server.stderr.close()
    print(label + ": ready-only stdout, request/error logs, exit status, unavailable storage, rotation passed")


def verify_stream_failure(root):
    preload = root / "fail_stream.cjs"
    preload.write_text(
        "const fs = require('node:fs'); const { Readable } = require('node:stream');\n"
        "fs.createReadStream = () => new Readable({ read() { this.destroy(Object.assign(new Error('injected stream failure'), { code: 'EIO' })); } });\n"
        "require('node:module').syncBuiltinESMExports();\n", encoding="utf8")
    logs = root / "node-stream"
    server = Server(["node", "--require", str(preload), "tools/serve.mjs"], logs)
    try:
        assert request(server.ready["port"])[0] == 500
        assert request(server.ready["port"], "/__ngb_startup__.json")[0] == 200
    finally:
        server.close()
    assert any(item["event"] == "http.failed" and item["details"]["error"]["code"] == "EIO" for item in records(logs, "error"))
    server.stderr.close()


def verify_bootstrap(root):
    path = root / "bootstrap-path"
    path.mkdir()
    os.symlink(shutil.which("mkdir"), str(path / "mkdir"))
    logs = root / "bash-missing"
    result = subprocess.run([shutil.which("bash"), str(ROOT / "tools/start-preview.sh")],
                            env=dict(os.environ, PATH=str(path), NGB_LOG_DIR=str(logs)),
                            stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=5)
    assert result.returncode == 1 and not result.stdout
    assert any(item["event"] == "bootstrap.failed" for item in records(logs, "error"))


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--native")
    parser.add_argument("--windows")
    args = parser.parse_args()
    with tempfile.TemporaryDirectory(prefix="ngb-terminal-") as temporary:
        root = Path(temporary)
        if args.windows:
            verify([str(Path(args.windows).resolve())], "windows", root)
        else:
            verify(["node", "tools/serve.mjs"], "node", root)
            verify(["python3", "-u", "tools/serve.py"], "python", root)
            verify(["bash", "tools/start-preview.sh"], "bash", root)
            verify_bootstrap(root)
            verify_stream_failure(root)
            if args.native:
                verify([str(Path(args.native).resolve()), "start"], "native", root)
