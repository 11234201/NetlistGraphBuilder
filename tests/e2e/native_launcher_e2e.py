"""Linux-only, standard-library integration tests against a copied single file."""
import json
import os
from pathlib import Path
import selectors
import shutil
import socket
import stat
import subprocess
import sys
import tempfile
import time
import unittest
from urllib.request import urlopen

BINARY = Path(sys.argv.pop(1)).resolve()
SOURCE = Path(sys.argv.pop(1)).resolve()


class NativeLauncherTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="ngb 空格 ", dir=os.getcwd())
        self.root = Path(self.temp.name)
        self.binary = self.root / "single ngb"
        shutil.copy2(str(BINARY), str(self.binary))
        self.state = self.root / "session.json"
        self.children = []

    def tearDown(self):
        if self.state.exists():
            self.command("stop", "--state-file", str(self.state))
        for child in self.children:
            if child.poll() is None:
                child.terminate()
            try:
                child.wait(timeout=4)
            except subprocess.TimeoutExpired:
                child.kill()
                child.wait()
            for stream in (child.stdout, child.stderr, child.stdin):
                if stream:
                    stream.close()
        self.temp.cleanup()

    def command(self, *args):
        return subprocess.run([str(self.binary)] + list(args), cwd=str(self.root),
                              stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=8)

    def start(self, *args):
        env = dict(os.environ, PATH="/nonexistent")  # runtime needs no node/python/xdg-open
        child = subprocess.Popen([str(self.binary), "start", "--port", "0", "--no-open",
                                  "--state-file", str(self.state)] + list(args),
                                 cwd=str(self.root), env=env, stdout=subprocess.PIPE,
                                 stderr=subprocess.PIPE)
        self.children.append(child)
        with selectors.DefaultSelector() as selector:
            selector.register(child.stdout, selectors.EVENT_READ)
            self.assertTrue(selector.select(5), "no ready output")
        line = child.stdout.readline()
        self.assertTrue(line, child.stderr.read().decode() if child.poll() is not None else "no ready")
        ready = json.loads(line)
        self.assertEqual(ready["event"], "ready")
        self.assertGreater(ready["port"], 0)
        return child, ready

    def test_single_file_assets_manifest_http_and_stop(self):
        netlist = self.root / "net list.v"
        netlist.write_text("module top(input a, output z); assign z=a; endmodule", encoding="utf8")
        child, ready = self.start("--netlist", str(netlist), "--module", "top", "--fanin-depth", "0")
        base = "http://127.0.0.1:%s" % ready["port"]
        assets = ["index.html", "styles.css", "vendor/elkjs-0.11.1/lib/elk.bundled.js"]
        assets += [path.relative_to(SOURCE).as_posix() for path in sorted((SOURCE / "src").rglob("*.js"))]
        for source in assets:
            route = "/" if source == "index.html" else "/" + source
            with urlopen(base + route, timeout=3) as response:
                self.assertEqual(response.read(), (SOURCE / source).read_bytes())
                if route.endswith(".js"):
                    self.assertIn("javascript", response.headers["Content-Type"])
        with urlopen(base + "/__ngb_startup__.json", timeout=3) as response:
            manifest = json.load(response)
            self.assertEqual(manifest["inputs"]["netlist"]["text"], netlist.read_text())
            self.assertEqual(manifest["target"]["faninDepth"], 0)
            self.assertEqual(response.headers["Cache-Control"], "no-store")
        self.assertNotIn("assign", json.dumps(ready))
        self.assertEqual(stat.S_IMODE(self.state.stat().st_mode), 0o600)
        for path, expected in [("/%2e%2e/CMakeLists.txt", 403), ("/%00", 400), ("/absent", 404)]:
            self.assertEqual(self.raw(ready["port"], "GET %s HTTP/1.1\r\nHost: localhost\r\n\r\n" % path)[0], expected)
        self.assertEqual(self.raw(ready["port"], "POST / HTTP/1.1\r\nHost: localhost\r\n\r\n")[0], 405)
        self.assertEqual(self.raw(ready["port"], "GET / HTTP/1.1\r\nHost: localhost\r\n\r\n", fragment=True)[0], 200)
        self.assertEqual(self.raw(ready["port"], "HEAD / HTTP/1.1\r\nHost: localhost\r\n\r\n")[1], b"")
        status = self.command("status", "--state-file", str(self.state))
        self.assertEqual(status.returncode, 0, status.stderr)
        self.assertIn(b"status=running", status.stdout)
        stopped = self.command("stop", "--state-file", str(self.state))
        self.assertEqual(stopped.returncode, 0, stopped.stderr)
        child.wait(timeout=4)
        self.assertFalse(self.state.exists())
        self.assertEqual(self.command("stop", "--state-file", str(self.state)).returncode, 0)

    def raw(self, port, request, fragment=False):
        with socket.create_connection(("127.0.0.1", port), timeout=4) as connection:
            data = request.encode("ascii")
            if fragment:
                connection.sendall(data[:5])
                time.sleep(0.03)
                data = data[5:]
            connection.sendall(data)
            response = b""
            while True:
                part = connection.recv(65536)
                if not part:
                    break
                response += part
        header, body = response.split(b"\r\n\r\n", 1)
        return int(header.split()[1]), body

    def test_duplicate_replace_and_invalid_input_preserve_running_session(self):
        child, ready = self.start()
        original = self.state.read_bytes()
        duplicate = self.command("start", "--state-file", str(self.state), "--no-open")
        self.assertNotEqual(duplicate.returncode, 0)
        self.assertEqual(self.state.read_bytes(), original)
        invalid = self.command("start", "--state-file", str(self.state), "--replace", "--netlist", str(self.root / "missing.v"))
        self.assertNotEqual(invalid.returncode, 0)
        self.assertIsNone(child.poll())
        replacement, new_ready = self.start("--replace")
        child.wait(timeout=4)
        self.assertIsNone(replacement.poll())
        self.assertNotEqual(json.loads(original)["pid"], json.loads(self.state.read_bytes())["pid"])

    def test_forged_state_never_signals_another_process(self):
        sentinel = subprocess.Popen([sys.executable, "-c", "import time; time.sleep(20)",
                                     "start", "--state-file", str(self.state)])
        self.children.append(sentinel)
        self.state.write_text(json.dumps(dict(version=1, pid=sentinel.pid, port=12345,
            url="http://127.0.0.1:12345/", stateFile=str(self.state), owner="fake"), separators=(",", ":")))
        self.assertNotEqual(self.command("stop", "--state-file", str(self.state), "--force").returncode, 0)
        self.assertIsNone(sentinel.poll())
        self.assertNotEqual(self.command("start", "--state-file", str(self.state), "--no-open").returncode, 0)

    def test_process_start_identity_and_state_path_are_verified(self):
        child, ready = self.start()
        original = self.state.read_text()
        record = json.loads(original)
        record["processStartTicks"] = "0"
        self.state.write_text(json.dumps(record, separators=(",", ":")))
        self.assertNotEqual(self.command("stop", "--state-file", str(self.state), "--force").returncode, 0)
        self.assertIsNone(child.poll())
        record["stateFile"] = str(self.root / "different" / "session.json")
        self.state.write_text(json.dumps(record, separators=(",", ":")))
        self.assertNotEqual(self.command("stop", "--state-file", str(self.state)).returncode, 0)
        self.state.write_text(original)

    def test_invalid_cli_and_license(self):
        for args in [("--port", "65536"), ("--fanin-depth", "100"), ("--replace",), ("--unknown",)]:
            self.assertNotEqual(self.command(*args).returncode, 0)
        license_output = self.command("--licenses")
        self.assertEqual(license_output.returncode, 0)
        self.assertIn(b"Eclipse Public License", license_output.stdout)

    def test_invalid_state_and_symlink_lock_fail_closed(self):
        self.state.write_text('{"version":1,"pid":0}')
        self.assertNotEqual(self.command("stop", "--state-file", str(self.state)).returncode, 0)
        self.state.unlink()
        protected = self.root / "protected.txt"
        protected.write_text("unchanged")
        Path(str(self.state) + ".lock").symlink_to(protected)
        self.assertNotEqual(self.command("start", "--no-open", "--state-file", str(self.state)).returncode, 0)
        self.assertEqual(protected.read_text(), "unchanged")

    def test_formatted_state_unicode_and_default_start(self):
        child, ready = self.start()
        self.state.write_text(json.dumps(json.loads(self.state.read_text()), indent=2))
        self.assertIn(b"status=running", self.command("status", "--state-file", str(self.state)).stdout)
        self.assertEqual(self.command("stop", "--state-file", str(self.state)).returncode, 0)
        child.wait(timeout=4)
        # Optional subcommand must still be recognized as the same owner.
        child = subprocess.Popen([str(self.binary), "--state-file", str(self.state), "--port", "0", "--no-open"],
                                 stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        self.children.append(child)
        with selectors.DefaultSelector() as selector:
            selector.register(child.stdout, selectors.EVENT_READ)
            self.assertTrue(selector.select(4))
        self.assertEqual(json.loads(child.stdout.readline())["event"], "ready")
        self.assertEqual(self.command("stop", "--state-file", str(self.state)).returncode, 0)

    def test_concurrent_start_has_exactly_one_owner(self):
        command = [str(self.binary), "start", "--state-file", str(self.state), "--port", "0", "--no-open"]
        contenders = [subprocess.Popen(command, stdout=subprocess.PIPE, stderr=subprocess.PIPE) for _ in range(2)]
        self.children.extend(contenders)
        deadline = time.monotonic() + 4
        while all(p.poll() is None for p in contenders) and time.monotonic() < deadline:
            time.sleep(0.02)
        self.assertEqual(sum(p.poll() is None for p in contenders), 1)
        owner = json.loads(self.state.read_text())["pid"]
        self.assertIn(owner, [p.pid for p in contenders if p.poll() is None])
        self.assertEqual(self.command("stop", "--state-file", str(self.state)).returncode, 0)

    def test_parent_death_removes_state_and_closes_listener(self):
        script = '''import subprocess, sys
p = subprocess.Popen(sys.argv[1:], stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
print(p.stdout.readline().decode().strip(), flush=True)
sys.stdin.read(1)
'''
        parent = subprocess.Popen([sys.executable, "-c", script, str(self.binary), "start", "--no-open",
                                   "--parent-death", "--state-file", str(self.state)],
                                  stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        self.children.append(parent)
        with selectors.DefaultSelector() as selector:
            selector.register(parent.stdout, selectors.EVENT_READ)
            self.assertTrue(selector.select(4))
        ready = json.loads(parent.stdout.readline())
        parent.communicate(b"x", timeout=4)
        deadline = time.monotonic() + 4
        while self.state.exists() and time.monotonic() < deadline:
            time.sleep(0.02)
        self.assertFalse(self.state.exists())
        with self.assertRaises(OSError):
            socket.create_connection(("127.0.0.1", ready["port"]), timeout=1)


if __name__ == "__main__":
    unittest.main(verbosity=2)
