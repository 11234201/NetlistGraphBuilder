"""Dependency-free localhost launcher for Netlist Graph Builder."""

from __future__ import print_function

import argparse
import json
import os
import signal
import sys
import time
import uuid
import webbrowser
from http.server import HTTPServer, SimpleHTTPRequestHandler

if os.name == "nt":
    import ctypes


ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), os.pardir))
HOST = "127.0.0.1"
STARTUP_ENDPOINT = "/__ngb_startup__.json"
GATE_KINDS = set(["AND", "OR", "MUX", "INV", "NAND", "NOR", "XOR", "XNOR", "BUF", "REGISTER", "BLACKBOX"])
PIN_DIRECTIONS = set(["input", "output", "inout", "unknown"])
RUNNING = True


class PreviewHandler(SimpleHTTPRequestHandler):
    startup_json = "{}"
    extensions_map = dict(SimpleHTTPRequestHandler.extensions_map)
    extensions_map.update({
        ".css": "text/css; charset=utf-8", ".html": "text/html; charset=utf-8",
        ".js": "text/javascript; charset=utf-8", ".json": "application/json; charset=utf-8",
        ".sv": "text/plain; charset=utf-8", ".v": "text/plain; charset=utf-8",
    })

    def do_GET(self):
        if self.path.split("?", 1)[0] == STARTUP_ENDPOINT:
            payload = self.startup_json.encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Cache-Control", "no-store")
            self.send_header("Content-Length", str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)
            return
        SimpleHTTPRequestHandler.do_GET(self)


def bounded_integer(minimum, maximum):
    def parse(value):
        try:
            number = int(value)
        except ValueError:
            raise argparse.ArgumentTypeError("must be an integer")
        if number < minimum or number > maximum:
            raise argparse.ArgumentTypeError("must be from {} to {}".format(minimum, maximum))
        return number
    return parse


def parse_args(argv):
    arguments = list(argv)
    command = "start"
    if arguments and arguments[0] in ("start", "stop", "status"):
        command = arguments.pop(0)
    parser = argparse.ArgumentParser(description="Launch Netlist Graph Builder on localhost")
    parser.add_argument("--netlist")
    parser.add_argument("--timing")
    parser.add_argument("--cell-config", dest="cell_config")
    parser.add_argument("--module")
    parser.add_argument("--focus")
    parser.add_argument("--fanin-depth", type=bounded_integer(0, 99), dest="fanin_depth")
    parser.add_argument("--fanout-depth", type=bounded_integer(0, 99), dest="fanout_depth")
    parser.add_argument("--port", type=bounded_integer(0, 65535), default=os.environ.get("PORT", "4173"))
    parser.add_argument("--no-open", "--no-browser", action="store_true", dest="no_open")
    parser.add_argument("--state-file", dest="state_file")
    parser.add_argument("--replace", action="store_true", dest="replace_existing")
    parser.add_argument("--force", action="store_true")
    parser.add_argument("--parent-death", action="store_true", dest="parent_death")
    args = parser.parse_args(arguments)
    args.command = command
    if args.state_file:
        args.state_file = os.path.abspath(args.state_file)
    if args.replace_existing and not args.state_file:
        raise ValueError("--replace requires --state-file")
    return args


def process_exists(pid):
    if os.name == "nt":
        kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
        kernel32.OpenProcess.argtypes = [ctypes.c_ulong, ctypes.c_int, ctypes.c_ulong]
        kernel32.OpenProcess.restype = ctypes.c_void_p
        kernel32.GetExitCodeProcess.argtypes = [ctypes.c_void_p, ctypes.POINTER(ctypes.c_ulong)]
        kernel32.GetExitCodeProcess.restype = ctypes.c_int
        kernel32.CloseHandle.argtypes = [ctypes.c_void_p]
        kernel32.CloseHandle.restype = ctypes.c_int
        handle = kernel32.OpenProcess(0x1000, False, pid)  # PROCESS_QUERY_LIMITED_INFORMATION
        if not handle:
            return False
        exit_code = ctypes.c_ulong()
        try:
            return bool(kernel32.GetExitCodeProcess(handle, ctypes.byref(exit_code)) and exit_code.value == 259)
        finally:
            kernel32.CloseHandle(handle)
    try:
        os.kill(pid, 0)
        return True
    except OSError as error:
        return error.errno == 1  # EPERM: alive but not inspectable


def process_matches_state(state):
    if os.name == "nt":
        return True
    try:
        with open("/proc/{}/cmdline".format(state["pid"]), "rb") as stream:
            command_line = stream.read().replace(b"\0", b" ").decode("utf-8", "replace")
        return ("serve.py" in command_line and "--state-file" in command_line and
                os.path.basename(state["stateFile"]) in command_line)
    except (IOError, OSError):
        return False


def read_state(path):
    with open(path, "r", encoding="utf-8") as stream:
        state = json.load(stream)
    if (not isinstance(state, dict) or state.get("version") != 1 or
            not isinstance(state.get("pid"), int) or state["pid"] <= 0 or
            not isinstance(state.get("port"), int) or state["port"] <= 0 or
            state.get("stateFile") != os.path.abspath(path)):
        raise ValueError("Invalid Netlist Graph Builder state file: {}".format(path))
    return state


def write_state(state):
    directory = os.path.dirname(state["stateFile"])
    if directory and not os.path.isdir(directory):
        os.makedirs(directory)
    temporary = state["stateFile"] + ".tmp.{}".format(os.getpid())
    with open(temporary, "w", encoding="utf-8") as stream:
        json.dump(state, stream, ensure_ascii=False, separators=(",", ":"))
        stream.write("\n")
    try:
        os.replace(temporary, state["stateFile"])
    except Exception:
        try:
            os.remove(temporary)
        except OSError:
            pass
        raise


def remove_state(path):
    try:
        os.remove(path)
    except OSError as error:
        if error.errno != 2:
            raise


def stop_state(path, force=False):
    try:
        state = read_state(path)
    except IOError as error:
        if getattr(error, "errno", None) == 2:
            return None, "stopped"
        raise
    if not process_exists(state["pid"]):
        remove_state(path)
        return state, "stopped"
    if not process_matches_state(state):
        raise ValueError("Refusing to stop PID {}: it does not match the Netlist Graph Builder state file".format(state["pid"]))
    try:
        if os.name == "nt" and force:
            kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
            kernel32.OpenProcess.argtypes = [ctypes.c_ulong, ctypes.c_int, ctypes.c_ulong]
            kernel32.OpenProcess.restype = ctypes.c_void_p
            kernel32.TerminateProcess.argtypes = [ctypes.c_void_p, ctypes.c_uint]
            kernel32.TerminateProcess.restype = ctypes.c_int
            kernel32.CloseHandle.argtypes = [ctypes.c_void_p]
            kernel32.CloseHandle.restype = ctypes.c_int
            handle = kernel32.OpenProcess(0x0001, False, state["pid"])  # PROCESS_TERMINATE
            if handle:
                try:
                    kernel32.TerminateProcess(handle, 1)
                finally:
                    kernel32.CloseHandle(handle)
        else:
            os.kill(state["pid"], signal.SIGKILL if force else signal.SIGTERM)
    except OSError as error:
        if error.errno != 3:  # ESRCH
            raise
    deadline = time.time() + (1.0 if force else 3.0)
    while process_exists(state["pid"]) and time.time() < deadline:
        time.sleep(0.05)
    if process_exists(state["pid"]):
        if not force:
            return state, "running"
        try:
            os.kill(state["pid"], signal.SIGKILL)
        except OSError as error:
            if error.errno != 3:
                raise
    remove_state(path)
    return state, "stopped"


def print_status(path):
    try:
        state = read_state(path)
    except IOError as error:
        if getattr(error, "errno", None) == 2:
            print("status=stopped")
            return 0
        raise
    running = process_exists(state["pid"]) and process_matches_state(state)
    print(json.dumps(state, ensure_ascii=False, separators=(",", ":")))
    print("status={}".format("running" if running else "stale"))
    return 0


def read_input(path, option):
    absolute = os.path.abspath(path)
    try:
        with open(absolute, "r", encoding="utf-8") as stream:
            return {"name": os.path.basename(absolute), "text": stream.read()}
    except (IOError, OSError, UnicodeError) as error:
        raise ValueError("Cannot read {} file {}: {}".format(option, absolute, error))


def validate_cell_config(text):
    try:
        value = json.loads(text)
    except ValueError as error:
        raise ValueError("Invalid --cell-config JSON: {}".format(error))
    if not isinstance(value, dict) or value.get("kind") != "netlist-cell-config" or value.get("version") != 1:
        raise ValueError("Invalid --cell-config schema: expected netlist-cell-config version 1")
    if set(value.keys()) - set(["kind", "version", "cells"]) or not isinstance(value.get("cells"), dict):
        raise ValueError("Invalid --cell-config schema: unexpected fields or cells value")
    for cell_type, definition in value["cells"].items():
        if (not isinstance(definition, dict) or
                set(definition.keys()) - set(["displayName", "gateKind", "pins"]) or
                str(definition.get("gateKind", "")).upper() not in GATE_KINDS):
            raise ValueError("Invalid --cell-config gate kind for {}".format(cell_type))
        pins = definition.get("pins")
        if not isinstance(pins, dict) or any(direction not in PIN_DIRECTIONS for direction in pins.values()):
            raise ValueError("Invalid --cell-config pin direction for {}".format(cell_type))


def create_manifest(args):
    inputs = {}
    if args.cell_config:
        inputs["cellConfig"] = read_input(args.cell_config, "--cell-config")
        validate_cell_config(inputs["cellConfig"]["text"])
    if args.netlist:
        inputs["netlist"] = read_input(args.netlist, "--netlist")
    if args.timing:
        inputs["timing"] = read_input(args.timing, "--timing")
    target = {}
    for key in ["module", "focus", "fanin_depth", "fanout_depth"]:
        value = getattr(args, key)
        if value is not None:
            target[{"fanin_depth": "faninDepth", "fanout_depth": "fanoutDepth"}.get(key, key)] = value
    return {"version": 1, "inputs": inputs, "target": target}


def main(argv=None):
    try:
        args = parse_args(sys.argv[1:] if argv is None else argv)
        if args.command in ("stop", "status"):
            if not args.state_file:
                print("--state-file is required for {}".format(args.command), file=sys.stderr)
                return 2
            if args.command == "status":
                return print_status(args.state_file)
            state, status = stop_state(args.state_file, args.force)
            if state:
                print(json.dumps(state, ensure_ascii=False, separators=(",", ":")))
            print("status={}".format(status))
            return 1 if status == "running" else 0
        if args.state_file and os.path.exists(args.state_file):
            if args.replace_existing:
                stop_state(args.state_file)
            else:
                state = read_state(args.state_file)
                if process_exists(state["pid"]) and process_matches_state(state):
                    raise ValueError("A Netlist Graph Builder session is already running for state file: {}".format(args.state_file))
                remove_state(args.state_file)
        manifest = create_manifest(args)
    except ValueError as error:
        print(str(error), file=sys.stderr)
        return 2
    os.chdir(ROOT)
    PreviewHandler.startup_json = json.dumps(manifest, ensure_ascii=False, separators=(",", ":"))
    print("Starting Netlist Graph Builder preview server...", flush=True)
    try:
        server = HTTPServer((HOST, args.port), PreviewHandler)
    except OSError as error:
        print("Failed to start preview server: {}".format(error), file=sys.stderr)
        return 1
    has_startup = bool(manifest["inputs"] or manifest["target"])
    actual_port = server.server_address[1]
    url = "http://{}:{}/{}".format(HOST, actual_port, "?startup=1" if has_startup else "")
    ready = {
        "event": "ready", "host": HOST, "port": actual_port, "url": url,
        "startup": {
            "netlist": inputs_name(manifest, "netlist"), "timing": inputs_name(manifest, "timing"),
            "cellConfig": inputs_name(manifest, "cellConfig"), "module": manifest["target"].get("module"),
            "focus": manifest["target"].get("focus"), "faninDepth": manifest["target"].get("faninDepth"),
            "fanoutDepth": manifest["target"].get("fanoutDepth")
        }
    }
    state = None
    if args.state_file:
        state = {
            "version": 1, "pid": os.getpid(), "port": actual_port, "url": url,
            "stateFile": args.state_file, "owner": "{}-{}".format(os.getpid(), uuid.uuid4())
        }
        try:
            write_state(state)
        except (IOError, OSError) as error:
            print("Could not write state file: {}".format(error), file=sys.stderr)
            server.server_close()
            return 1
    print(json.dumps(ready, ensure_ascii=False, separators=(",", ":")), flush=True)
    if not args.no_open:
        webbrowser.open(url)
    global RUNNING
    parent_pid = os.getppid()
    def request_stop(signum, frame):
        global RUNNING
        RUNNING = False
    signal.signal(signal.SIGTERM, request_stop)
    signal.signal(signal.SIGINT, request_stop)
    server.timeout = 0.5
    try:
        while RUNNING:
            server.handle_request()
            if args.parent_death and (os.getppid() != parent_pid or not process_exists(parent_pid)):
                RUNNING = False
    except KeyboardInterrupt:
        RUNNING = False
    finally:
        server.server_close()
        if state:
            try:
                current = read_state(state["stateFile"])
                if current.get("pid") == state["pid"] and current.get("owner") == state["owner"]:
                    remove_state(state["stateFile"])
            except (IOError, OSError, ValueError):
                pass
    return 0


def inputs_name(manifest, kind):
    return manifest["inputs"].get(kind, {}).get("name")


if __name__ == "__main__":
    raise SystemExit(main())
