"""Dependency-free preview server for older Linux hosts such as CentOS 7."""

from __future__ import print_function

import os
import sys
from http.server import HTTPServer, SimpleHTTPRequestHandler


ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), os.pardir))
HOST = os.environ.get("HOST", "127.0.0.1")

try:
    PORT = int(os.environ.get("PORT", "4173"))
except ValueError:
    print("PORT must be an integer", file=sys.stderr)
    raise SystemExit(2)


class PreviewHandler(SimpleHTTPRequestHandler):
    extensions_map = dict(SimpleHTTPRequestHandler.extensions_map)
    extensions_map.update({
        ".css": "text/css; charset=utf-8",
        ".html": "text/html; charset=utf-8",
        ".js": "text/javascript; charset=utf-8",
        ".json": "application/json; charset=utf-8",
        ".sv": "text/plain; charset=utf-8",
        ".v": "text/plain; charset=utf-8",
    })


def main():
    os.chdir(ROOT)
    print("Starting Netlist Graph Builder preview server...", flush=True)
    server = HTTPServer((HOST, PORT), PreviewHandler)
    print(
        "Netlist Graph Builder running at http://{}:{}/".format(HOST, PORT),
        flush=True,
    )
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
