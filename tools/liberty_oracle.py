"""Development-only scalar interface oracle using installed liberty-parser.

Usage: python3 tools/liberty_oracle.py input.lib output.json
No source libraries are embedded or redistributed by this helper.
"""
import importlib.metadata
import json
import sys
from pathlib import Path
from liberty.parser import parse_liberty


def value(group, key):
    item = group.get_attribute(key)
    return None if item is None else str(getattr(item, "value", item))


library = parse_liberty(Path(sys.argv[1]).read_text())
cells = {}
for cell in library.get_groups("cell"):
    pins = {}
    for pin in cell.get_groups("pin"):
        for name in pin.args:
            pins[str(name)] = {"direction": value(pin, "direction"), "function": value(pin, "function")}
    cells[str(cell.args[0])] = pins
result = {"oracle": "liberty-parser", "version": importlib.metadata.version("liberty-parser"), "cells": cells}
Path(sys.argv[2]).write_text(json.dumps(result, sort_keys=True, indent=2))
print(json.dumps({"version": result["version"], "cells": len(cells), "pins": sum(map(len, cells.values()))}))
