"""Run with python3 tests/e2e/workbench_prompt.py [path/to/ngb] on Linux."""
import json
import os
from pathlib import Path
import pty
import select
import subprocess
import sys
import tempfile
import time


def check_prompt(launcher, scratch):
    state = scratch / "session.json"
    env = dict(os.environ, NGB_LOG_DIR=str(scratch / "logs"), TERM="xterm")
    master, slave = pty.openpty()
    process = subprocess.Popen([*launcher, "start", "--port", "0", "--no-open", "--interactive", "--state-file", state],
                               stdin=slave, stdout=slave, stderr=slave, cwd=scratch, env=env)
    os.close(slave)
    pending = b""

    def until(marker):
        nonlocal pending
        deadline = time.monotonic() + 8
        while marker not in pending:
            if not select.select([master], [], [], max(0, deadline - time.monotonic()))[0]:
                raise AssertionError("Expected %r, last output %r" % (marker, pending[-350:]))
            pending += os.read(master, 65536)
        output, pending = pending.split(marker, 1)
        return output

    def run(keys, marker):
        os.write(master, keys + b"\r")
        output = until(marker)
        until(b"ngb> ")
        return output

    try:
        startup = until(b"ngb> ")
        assert b"Open workbench: http://" in startup and b"\nState file: " in startup
        assert b'"event":"ready"' not in startup
        help_text = run(b"help fs", b"  fs complete ")
        assert b"\n  fs pwd\r\n" in help_text and b'"capability"' not in help_text
        path = ("Path: " + str(scratch)).encode()
        run(b"fs pwd", path)
        run(b"\x1b[A\x1b[A\x1b[B", path)
        run(b"\x1b[A\x1b[A", b"  fs complete ")
        run(b'text set "omit-inline-content"', b"Failed [")
        run(b"\x1b[A", b"  fs complete ")
        run(b"fs pwx", b"Failed [UNAVAILABLE]")
        run(b"\x1b[A\x7fd", path)
        run(b"fs ls --filter --json", b"0 entries")
        run(b"fs pwd --json", b'"status":"committed"')
        run(b"commands --available --side A", b"Failed [")
        run(b"quit extra", b"Failed [INVALID_ARGUMENT]")
        cli = [*launcher, "cmd", "--state-file", state]
        machine = subprocess.check_output([*cli, "help", "fs"], env=env, stderr=subprocess.DEVNULL)
        assert [row["name"] for row in json.loads(machine)["result"]][1] == "fs pwd"
        for flags in ([], ["--json"]):
            output, terminal = pty.openpty()
            try:
                subprocess.run([*cli, "fs", "pwd", *flags], cwd=scratch, env=env, stdout=terminal,
                               stderr=subprocess.DEVNULL, check=True, timeout=8)
                data = os.read(output, 8192)
                if flags:
                    assert json.loads(data)["result"]["path"] == str(scratch)
                else:
                    assert b"Done\r\n" + path in data
            finally:
                os.close(terminal)
                os.close(output)
        os.write(master, b"quit\r")
        assert process.wait(8) == 0
        failures = [json.loads(line) for file in (scratch / "logs").glob("*.error.jsonl")
                    for line in file.read_text().splitlines()]
        invalid = [item for item in failures if item["event"] == "workbench.prompt_failed"
                   and item["details"]["code"] == "INVALID_ARGUMENT"]
        assert len(invalid) == 1 and invalid[0]["details"]["error"]["message"]
        assert sum(item["details"].get("operation") == "commands" for item in failures) == 1
        assert "omit-inline-content" not in str(failures)
    finally:
        if process.poll() is None:
            process.terminate()
            process.wait(8)
        os.close(master)


if __name__ == "__main__":
    root = Path(__file__).resolve().parents[2]
    launchers = [["node", root / "tools/serve.mjs"], [sys.executable, root / "tools/serve.py"]]
    if len(sys.argv) > 1:
        launchers.append([Path(sys.argv[1]).resolve()])
    for launcher in launchers:
        with tempfile.TemporaryDirectory() as directory:
            check_prompt(launcher, Path(directory))
            print("Prompt output and arrow-key history passed for", launcher[-1])
