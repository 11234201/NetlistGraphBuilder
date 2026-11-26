"""Dependency-free localhost launcher for Netlist Graph Builder."""

from __future__ import print_function

import argparse
import datetime
import email.utils
import errno
import json
import os
import signal
import subprocess
import sys
import time
import tempfile
import threading
import uuid
import webbrowser
from http.server import SimpleHTTPRequestHandler
from urllib.parse import unquote, urlsplit
from terminal_log import TerminalLog
from workbench_client import cli, terminal
from workbench_display import format_prompt_startup
from workbench_protocol import CommandError, Grammar
from workbench_server_files import WorkbenchFiles, canonical, inside, opened_path
from workbench_service import WorkbenchService
from workbench_transport import BrowserServer, ControlEndpoint, control_call, handle_post

WINDOWS_PACKAGE = os.name == "nt" and os.environ.get("NGB_WINDOWS_PACKAGE_RUNTIME") == "1"
LOG = TerminalLog("windows" if WINDOWS_PACKAGE else "python")

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

    def do_POST(self):
        handle_post(self)

    def translate_path(self, path):
        name = unquote(urlsplit(path).path).lstrip("/") or "index.html"
        return os.path.join(ROOT, name)

    def send_head(self):
        path = self.translate_path(self.path)
        root = canonical(ROOT)
        if not inside(canonical(path),root):
            self.send_error(403, "Forbidden")
            return None
        try:
            with self.server.files.regular(path, False) as stream:
                actual = opened_path(stream.fileno()) or canonical(path)
                relative = os.path.relpath(actual, root).replace(os.sep, "/") if inside(actual,root) else ""
                if not (relative in ("index.html","styles.css") or relative.startswith(("src/","vendor/","examples/"))):
                    self.send_error(403, "Forbidden")
                    return None
                output = os.fdopen(os.dup(stream.fileno()),"rb")
        except CommandError:
            self.send_error(403, "Forbidden")
            return None
        except OSError as error:
            if error.errno in (2, 20):
                self.send_error(404, "Not found")
            else:
                LOG.write("error", "http.failed" if WINDOWS_PACKAGE else "http.read_failed", "Could not read requested file", error=error)
                self.send_error(500, "Internal server error")
            return None
        try:
            info = os.fstat(output.fileno())
            # Preserve SimpleHTTPRequestHandler's conditional GET/HEAD semantics.
            if "If-Modified-Since" in self.headers and "If-None-Match" not in self.headers:
                try:
                    modified_since = email.utils.parsedate_to_datetime(self.headers["If-Modified-Since"])
                    if modified_since.tzinfo is None:
                        modified_since = modified_since.replace(tzinfo=datetime.timezone.utc)
                    modified = datetime.datetime.fromtimestamp(info.st_mtime, datetime.timezone.utc).replace(microsecond=0)
                    if modified_since.tzinfo == datetime.timezone.utc and modified <= modified_since:
                        self.send_response(304)
                        self.end_headers()
                        output.close()
                        return None
                except (TypeError, ValueError, OverflowError):
                    pass
            self.send_response(200)
            self.send_header("Content-type", self.guess_type(path))
            self.send_header("Content-Length", str(info.st_size))
            self.send_header("Last-Modified", self.date_time_string(info.st_mtime))
            self.end_headers()
            return output
        except Exception:
            output.close()
            raise

    def log_request(self, code="-", size="-"):
        LOG.request(getattr(self, "command", ""), getattr(self, "path", "/"), int(code) if str(code).isdigit() else 0)

    def log_message(self, format, *args):
        # Request lines may contain query secrets; log only the sanitized path and status.
        pass

    def handle(self):
        try:
            SimpleHTTPRequestHandler.handle(self)
        except (BrokenPipeError, ConnectionResetError, TimeoutError) as error:
            LOG.write("warning", "http.disconnected", "Client disconnected", error=error)
        except Exception as error:
            LOG.write("error", "http.failed", "Request handling failed", error=error)


class LauncherArgumentParser(argparse.ArgumentParser):
    def error(self, message):
        LOG.write("error", "arguments.invalid", message)
        raise SystemExit(2)


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
    parser = LauncherArgumentParser(
        description="Launch Netlist Graph Builder on localhost",
        epilog="Use start to serve, status or stop with --state-file, and cmd --state-file FILE help for workbench commands.")
    parser.add_argument("--netlist")
    parser.add_argument("--timing")
    parser.add_argument("--cell-config", dest="cell_config")
    parser.add_argument("--module")
    parser.add_argument("--focus")
    parser.add_argument("--fanin-depth", type=bounded_integer(0, 99), dest="fanin_depth")
    parser.add_argument("--fanout-depth", type=bounded_integer(0, 99), dest="fanout_depth")
    parser.add_argument("--port", type=bounded_integer(0, 65535), default=os.environ.get("PORT", "4173"))
    parser.add_argument("--browse-root",dest="roots",action="append",default=[])
    interactive = parser.add_mutually_exclusive_group()
    interactive.add_argument("--interactive",action="store_true",dest="interactive")
    interactive.add_argument("--no-interactive",action="store_false",dest="interactive")
    parser.set_defaults(interactive=None)
    parser.add_argument("--no-open", "--no-browser", action="store_true", dest="no_open")
    parser.add_argument("--state-file", dest="state_file")
    parser.add_argument("--replace", action="store_true", dest="replace_existing")
    parser.add_argument("--force", action="store_true")
    parser.add_argument("--parent-death", action="store_true", dest="parent_death")
    args = parser.parse_args(arguments)
    args.command = command
    args.explicit_port = any(arg == "--port" or arg.startswith("--port=") for arg in arguments)
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
    if state.get("control"):
        try:
            result = control_call(state,{"version":1,"op":"identity"})
            return all(result.get(k) == state[k] for k in ("pid","owner","stateFile"))
        except (OSError, ValueError, KeyError, CommandError, EOFError):
            return False
    if os.name == "nt":
        return False
    try:
        with open("/proc/{}/cmdline".format(state["pid"]), "rb") as stream:
            args = [os.fsdecode(a) for a in stream.read().split(b"\0")]
        cwd = os.readlink("/proc/{}/cwd".format(state["pid"]))
        idx = args.index("--state-file")
        return (any(canonical(os.path.join(cwd,a)) == canonical(__file__) for a in args) and
                canonical(os.path.join(cwd,args[idx + 1])) == canonical(state["stateFile"]))
    except (IOError, OSError, ValueError, IndexError):
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
    fd, temporary = tempfile.mkstemp(prefix=os.path.basename(state["stateFile"])+".tmp.",dir=directory)
    try:
        with os.fdopen(fd,"w",encoding="utf8") as stream:
            json.dump(state, stream, ensure_ascii=False, separators=(",", ":"))
            stream.write("\n")
        os.link(temporary, state["stateFile"])
    finally:
        os.unlink(temporary)


def remove_state(path):
    try:
        os.remove(path)
    except OSError as error:
        if error.errno != 2:
            raise


def remove_owned_state(state):
    try:
        current = read_state(state["stateFile"])
        if (current.get("pid"), current.get("owner")) == (state["pid"], state.get("owner")):
            remove_state(state["stateFile"])
    except FileNotFoundError:
        pass


def stop_state(path, force=False):
    try:
        state = read_state(path)
    except IOError as error:
        if getattr(error, "errno", None) == 2:
            return None, "stopped"
        raise
    if not process_exists(state["pid"]):
        remove_owned_state(state)
        return state, "stopped"
    if not process_matches_state(state):
        raise ValueError("Refusing to stop PID {}: it does not match the Netlist Graph Builder state file".format(state["pid"]))
    try:
        if not force and state.get("workbenchHost") == "python":
            response = control_call(state,dict(version=1,op="stop",owner=state["owner"]))
            if response.get("error"):
                raise ValueError("Control channel refused stop")
        elif os.name == "nt" and force:
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
        return state, "running"
    remove_owned_state(state)
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
    global RUNNING
    arguments = sys.argv[1:] if argv is None else argv
    grammar = Grammar(ROOT)
    if arguments[:1] == ["cmd"]:
        return cli(arguments[1:], grammar, read_state, LOG)
    try:
        args = parse_args(arguments)
        if args.command in ("stop", "status"):
            if not args.state_file:
                LOG.write("error", "arguments.invalid", "--state-file is required for {}".format(args.command))
                return 2
            if args.command == "status":
                return print_status(args.state_file)
            state, status = stop_state(args.state_file, args.force)
            if state:
                print(json.dumps(state, ensure_ascii=False, separators=(",", ":")))
            print("status={}".format(status))
            return 1 if status == "running" else 0
        manifest = create_manifest(args)
        parent_pid = os.getppid()
        caller_pid = parent_pid
        if args.parent_death and os.name == "nt" and not WINDOWS_PACKAGE and os.environ.get("NGB_LAUNCHER_CMD") == "1":
            diagnostic = None
            try:
                shell = os.path.join(os.environ["SystemRoot"], "System32", "WindowsPowerShell", "v1.0", "powershell.exe")
                output = subprocess.check_output([shell, "-NoProfile", "-ExecutionPolicy", "Bypass", "-File",
                    os.path.join(ROOT, "tools", "launcher_parent.ps1"), str(parent_pid)], timeout=5,
                    creationflags=0x08000000, stderr=subprocess.PIPE)  # CREATE_NO_WINDOW; also available on Python 3.6.
                identity = json.loads(output.decode("utf8"))
                diagnostic = identity.get("error")
                if diagnostic:
                    raise RuntimeError("Could not identify the launching process")
                caller_pid = identity.get("pid")
                if not isinstance(caller_pid, int) or caller_pid < 0:
                    raise ValueError("Invalid launching process identity")
            except Exception as error:
                LOG.write("error", "parent.watch_failed", "Could not identify the launching process", error=error,
                          operation="start", code="PARENT_WATCH_FAILED", diagnostic=diagnostic)
                return 1
        if args.state_file and os.path.exists(args.state_file):
            if args.replace_existing:
                _, status = stop_state(args.state_file)
                if status != "stopped":
                    raise ValueError("The previous session is still running")
            else:
                state = read_state(args.state_file)
                if process_exists(state["pid"]):
                    raise ValueError("A Netlist Graph Builder session is already running for state file: {}".format(args.state_file))
                remove_owned_state(state)
    except ValueError as error:
        LOG.write("error", "startup.failed", str(error), error=error)
        return 2
    PreviewHandler.startup_json = json.dumps(manifest, ensure_ascii=False, separators=(",", ":"))
    LOG.write("info", "server.starting", "Starting Netlist Graph Builder preview server")
    try:
        attempts = 20 if WINDOWS_PACKAGE and not args.explicit_port else 1
        for offset in range(min(attempts,65536-args.port)):
            try:
                server = BrowserServer((HOST,args.port + offset),PreviewHandler)
                break
            except OSError as error:
                if error.errno != errno.EADDRINUSE or offset + 1 >= min(attempts,65536-args.port):
                    raise
    except OSError as error:
        LOG.write("error", "server.failed", "Failed to start preview server", error=error)
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
    temporary = tempfile.TemporaryDirectory(prefix="ngb-session-")
    state = {"version":1, "pid":os.getpid(), "port":actual_port, "url":url, "workbenchHost":"python",
             "stateFile":args.state_file or os.path.join(temporary.name,"state.json"), "owner":uuid.uuid4().hex}
    stop_event = threading.Event()
    endpoint = None
    service = None
    try:
        server.files = WorkbenchFiles(args.roots, state["stateFile"], temporary.name, LOG)
        service = WorkbenchService(grammar,server.files,LOG)
        def dispatch(body, admin):
            if admin and isinstance(body,dict) and body.get("version") == 1:
                if body.get("op") == "identity":
                    return {key:state[key] for key in ("version","pid","owner","stateFile")}
                if body.get("op") == "stop" and body.get("owner") == state["owner"]:
                    stop_event.set()
                    return {"version":1,"status":"stopped"}
            return service.handle(body,admin)
        endpoint = ControlEndpoint(temporary.name,dispatch,LOG)
        server.dispatch, server.log = dispatch, LOG
        state["control"] = endpoint.path
        write_state(state)
        ready["stateFile"] = state["stateFile"]
        ready["pairUrl"] = url + "#ngb=" + service.pair
    except Exception as error:
        LOG.write("error","session.write_failed","Could not initialize workbench session",error=error)
        server.server_close()
        if service:
            service.close()
        if endpoint:
            endpoint.close()
        temporary.cleanup()
        return 1
    interactive = args.interactive if args.interactive is not None else sys.stdin.isatty()
    print(format_prompt_startup(ready) if interactive and sys.stdout.isatty()
          else json.dumps(ready, ensure_ascii=False, separators=(",", ":")), flush=True)
    LOG.write("info", "server.ready", "Preview server ready", port=actual_port)
    if not args.no_open:
        try:
            # Browser helpers must not inherit the machine-protocol stdout pipe.
            saved_stdout = os.dup(sys.stdout.fileno())
            try:
                with open(os.devnull, "wb") as quiet:
                    os.dup2(quiet.fileno(), sys.stdout.fileno())
                    if not webbrowser.open(ready["pairUrl"]):
                        LOG.write("error", "browser.open_failed", "Default browser could not be opened", url=url)
            finally:
                os.dup2(saved_stdout, sys.stdout.fileno())
                os.close(saved_stdout)
        except Exception as error:
            LOG.write("error", "browser.open_failed", "Default browser could not be opened", error=error, url=url)
    stop_reason = ["shutdown"]
    def request_stop(signum, frame):
        global RUNNING
        RUNNING = False
        stop_reason[0] = signal.Signals(signum).name
    signal.signal(signal.SIGTERM, request_stop)
    signal.signal(signal.SIGINT, request_stop)
    server.timeout = 0.20
    if interactive:
        threading.Thread(target=terminal,args=(lambda body:dispatch(body,True),grammar,stop_event.set,LOG),daemon=True).start()
    try:
        while RUNNING and not stop_event.is_set():
            server.handle_request()
            if args.parent_death and (os.getppid() != parent_pid or not process_exists(parent_pid) or
                                      caller_pid == 0 or not process_exists(caller_pid)):
                RUNNING = False
                stop_reason[0] = "parent-exited"
    except KeyboardInterrupt:
        RUNNING = False
    finally:
        LOG.write("info", "server.stopping", "Stopping preview server", reason=stop_reason[0])
        service.close()
        server.server_close()
        endpoint.close()
        if state:
            try:
                remove_owned_state(state)
            except (IOError, OSError, ValueError) as error:
                if getattr(error, "errno", None) != 2:
                    LOG.write("error", "session.cleanup_failed", "Could not remove state file", error=error)
        temporary.cleanup()
    return 0


def inputs_name(manifest, kind):
    return manifest["inputs"].get(kind, {}).get("name")


if __name__ == "__main__":
    code = 1
    try:
        code = main()
    except SystemExit as error:
        code = error.code if isinstance(error.code, int) else 1
    except Exception as error:
        LOG.write("error", "process.uncaught", "Unhandled launcher exception", error=error)
    finally:
        LOG.write("error" if code else "info", "process.exit", "Launcher exiting", exitCode=code)
    raise SystemExit(code)
