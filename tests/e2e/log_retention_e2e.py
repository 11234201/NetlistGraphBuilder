"""Retention contract shared by every launcher; run beside terminal_logging_e2e.py."""
import argparse
from concurrent.futures import ThreadPoolExecutor
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import time

from terminal_logging_e2e import ROOT, Server, request

DAY = 86400
DEAD_PID = 2147483647


def seed(directory, name, age=30):
    path = directory / name
    path.write_bytes(b"{}\n")
    stamp = time.time() - age * DAY
    os.utime(str(path), (stamp, stamp))
    return path


def diagnostics(logs, pid):
    return [json.loads(line) for path in logs.glob("*-{}.*.jsonl*".format(pid))
            for line in path.read_text(encoding="utf8").splitlines() if line]


def verify(command, label, root):
    for configured, days in ((None, 14), ("2", 2), ("0", 0), ("3651", 14), ("0\n", 14)):
        logs = root / (label + "-" + str(days) + "-" + str(len(list(root.iterdir()))))
        logs.mkdir()
        expired = [seed(logs, "{}-1-{}.{}".format(runtime, DEAD_PID, suffix))
                   for runtime in ("bash", "node", "python", "native", "windows")
                   for suffix in ("run.jsonl", "error.jsonl", "run.jsonl.1", "error.jsonl.1")]
        intermediate = seed(logs, "node-2-{}.run.jsonl".format(DEAD_PID), 3)
        preserved = [
            seed(logs, "node-3-{}.run.jsonl".format(DEAD_PID), 1),
            seed(logs, "node-3-{}.error.jsonl.1".format(DEAD_PID)),
            seed(logs, "node-4-{}.run.jsonl".format(os.getpid())),
            seed(logs, "node-4-{}.error.jsonl.1".format(os.getpid())),
            seed(logs, "notes.txt"),
            seed(logs, "unknown-1-{}.run.jsonl".format(DEAD_PID)),
            seed(logs, "node-1-9999999999.run.jsonl"),
            seed(logs, "node-5-{}.run.jsonl.2".format(DEAD_PID)),
            seed(logs, "node-6-{}.error.jsonl".format(DEAD_PID)),
        ]
        nested = logs / "node-6-{}.run.jsonl".format(DEAD_PID)
        nested.mkdir()
        preserved.append(seed(nested, "native-1-{}.run.jsonl".format(DEAD_PID)))
        if os.name != "nt":
            target = seed(root, label + "-target.txt")
            link = logs / "python-7-{}.run.jsonl".format(DEAD_PID)
            link.symlink_to(target)
            preserved.extend([target, link, seed(logs, "python-7-{}.error.jsonl".format(DEAD_PID))])
        server = Server(command, logs, env={"NGB_LOG_RETENTION_DAYS": "" if configured is None else configured})
        try:
            assert request(server.ready["port"])[0] == 200
        finally:
            server.close()
            server.stderr.close()
        assert len(server.lines) == 1, (label, server.lines)
        assert all(path.exists() == (days == 0) for path in expired), (label, days)
        assert intermediate.exists() == (days != 2), (label, days)
        assert all(path.exists() for path in preserved), (label, days, preserved)
        cleanup = [item for item in diagnostics(logs, server.child.pid) if item["event"] == "log.cleanup"]
        assert len(cleanup) == 1, (label, cleanup)
        result = cleanup[0]["details"]
        count = 0 if days == 0 else 21 if days == 2 else 20
        assert result["retentionDays"] == days and result["deletedFiles"] == count, (label, result)
        assert result["deletedBytes"] == count * 3 and result["failedFiles"] == 0, (label, result)
    verify_concurrent(command, label, root)
    print(label + ": expired sessions, active PIDs, backups, configuration, concurrent cleanup and ready protocol passed")


def verify_concurrent(command, label, root):
    logs = root / (label + "-concurrent")
    logs.mkdir()
    old = [seed(logs, "node-{}-{}.{}".format(index, DEAD_PID, suffix))
           for index in range(100) for suffix in ("run.jsonl", "error.jsonl", "run.jsonl.1", "error.jsonl.1")]

    def launch(_):
        try:
            return Server(command, logs, env={"NGB_LOG_RETENTION_DAYS": "14"})
        except Exception as error:
            return error

    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(launch, range(2)))
    servers = [result for result in results if isinstance(result, Server)]
    try:
        assert len(servers) == 2, results
        assert all(request(server.ready["port"])[0] == 200 for server in servers)
    finally:
        for server in servers:
            server.close()
            server.stderr.close()
    cleanup = [item for server in servers for item in diagnostics(logs, server.child.pid)
               if item["event"] in ("log.cleanup", "log.cleanup_failed")]
    assert len(cleanup) == 2 and all(item["details"]["failedFiles"] == 0 for item in cleanup), cleanup
    assert sum(item["details"]["deletedFiles"] for item in cleanup) == len(old), cleanup
    assert sum(item["details"]["deletedBytes"] for item in cleanup) == len(old) * 3, cleanup
    assert all(not path.exists() for path in old)
    assert all(len(server.lines) == 1 for server in servers)


def verify_failure(root, windows=None):
    logs = root / "failed-cleanup"
    logs.mkdir()
    old = seed(logs, "node-1-{}.run.jsonl".format(DEAD_PID))
    if windows:
        old.chmod(0o400)  # File.Delete must report a read-only file.
        command = [windows]
    else:
        preload = root / "cleanup_failure.cjs"
        preload.write_text(
            "require('node:fs').unlinkSync = () => { throw Object.assign(new Error('injected cleanup failure'), {code:'EACCES'}); };\n"
            "require('node:module').syncBuiltinESMExports();\n", encoding="utf8")
        command = ["node", "--require", str(preload), "tools/serve.mjs"]
    server = Server(command, logs, env={"NGB_LOG_RETENTION_DAYS": "14"})
    try:
        assert request(server.ready["port"])[0] == 200
    finally:
        server.close()
        server.stderr.close()
        old.chmod(0o600)
    assert old.exists() and len(server.lines) == 1
    entries = diagnostics(logs, server.child.pid)
    failures = [item for item in entries if item["event"] == "log.cleanup_failed"]
    assert failures and all(item["details"]["failedFiles"] == 1 and item["details"]["error"] for item in failures)
    assert not any(item["event"] == "log.write_failed" for item in entries)
    assert any(item["event"] == "http.response" for item in entries)
    print("cleanup failure: diagnosed without disabling logging or interrupting service")


def verify_python_probe(root):
    # Also runs on Windows: probing a live PID must never terminate it.
    sys.path.insert(0, str(ROOT / "tools"))
    from log_retention import is_inactive
    from terminal_log import TerminalLog
    from unittest.mock import patch
    child = subprocess.Popen([sys.executable, "-c", "import time; time.sleep(30)"])
    try:
        assert not is_inactive(child.pid)
        assert child.poll() is None
    finally:
        child.terminate()
        child.wait(timeout=5)
    assert is_inactive(child.pid)
    logs = root / "python-failure"
    logs.mkdir()
    old = seed(logs, "node-1-{}.run.jsonl".format(DEAD_PID))
    with patch.dict(os.environ, NGB_LOG_DIR=str(logs), NGB_LOG_RETENTION_DAYS="14"):
        with patch("log_retention.os.unlink", side_effect=PermissionError(13, "injected cleanup failure")):
            logger = TerminalLog("python")
            logger.request("GET", "/", 200)
    assert old.exists() and logger.enabled
    entries = diagnostics(logs, os.getpid())
    assert any(item["event"] == "log.cleanup_failed" and item["details"]["error"]["code"] == 13 for item in entries)
    assert any(item["event"] == "http.response" for item in entries)
    print("python: non-destructive process probe and cleanup failure diagnostics passed")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--native")
    parser.add_argument("--windows")
    args = parser.parse_args()
    with tempfile.TemporaryDirectory(prefix="ngb-retention-") as temporary:
        root = Path(temporary)
        verify_python_probe(root)
        if args.windows:
            windows = str(Path(args.windows).resolve())
            verify([windows], "windows", root)
            verify_failure(root, windows)
        else:
            verify(["node", "tools/serve.mjs"], "node", root)
            verify(["python3", "-u", "tools/serve.py"], "python", root)
            verify(["bash", "tools/start-preview.sh"], "bash", root)
            verify_failure(root)
            if args.native:
                verify([str(Path(args.native).resolve()), "start"], "native", root)
