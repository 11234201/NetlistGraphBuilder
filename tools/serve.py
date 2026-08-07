"""Dependency-free localhost launcher for Netlist Graph Builder."""

from __future__ import print_function

import argparse
import json
import os
import sys
import webbrowser
from http.server import HTTPServer, SimpleHTTPRequestHandler


ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), os.pardir))
HOST = "127.0.0.1"
STARTUP_ENDPOINT = "/__ngb_startup__.json"
GATE_KINDS = set(["AND", "OR", "MUX", "INV", "NAND", "NOR", "XOR", "XNOR", "BUF", "REGISTER", "BLACKBOX"])
PIN_DIRECTIONS = set(["input", "output", "inout", "unknown"])


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
    parser = argparse.ArgumentParser(description="Launch Netlist Graph Builder on localhost")
    parser.add_argument("--netlist")
    parser.add_argument("--timing")
    parser.add_argument("--cell-config", dest="cell_config")
    parser.add_argument("--module")
    parser.add_argument("--focus")
    parser.add_argument("--fanin-depth", type=bounded_integer(0, 99), dest="fanin_depth")
    parser.add_argument("--fanout-depth", type=bounded_integer(0, 99), dest="fanout_depth")
    parser.add_argument("--port", type=bounded_integer(1, 65535), default=os.environ.get("PORT", "4173"))
    parser.add_argument("--no-open", "--no-browser", action="store_true", dest="no_open")
    return parser.parse_args(argv)


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
    url = "http://{}:{}/{}".format(HOST, args.port, "?startup=1" if has_startup else "")
    ready = {
        "event": "ready", "host": HOST, "port": args.port, "url": url,
        "startup": {
            "netlist": inputs_name(manifest, "netlist"), "timing": inputs_name(manifest, "timing"),
            "cellConfig": inputs_name(manifest, "cellConfig"), "module": manifest["target"].get("module"),
            "focus": manifest["target"].get("focus"), "faninDepth": manifest["target"].get("faninDepth"),
            "fanoutDepth": manifest["target"].get("fanoutDepth")
        }
    }
    print(json.dumps(ready, ensure_ascii=False, separators=(",", ":")), flush=True)
    if not args.no_open:
        webbrowser.open(url)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
    return 0


def inputs_name(manifest, kind):
    return manifest["inputs"].get(kind, {}).get("name")


if __name__ == "__main__":
    raise SystemExit(main())
