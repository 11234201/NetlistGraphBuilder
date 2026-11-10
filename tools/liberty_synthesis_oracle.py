"""Independent used-cell interface and truth tables via liberty-parser + SymPy.

Run with the remote development-only oracle venv; no dependencies enter the app.
Usage: python tools/liberty_synthesis_oracle.py manifest.json oracle.json
"""
import importlib.metadata
import json
from pathlib import Path
import sys
from liberty.parser import parse_liberty
from liberty.boolean_functions import parse_boolean_function


def value(group, key):
    item = group.get_attribute(key)
    return None if item is None else str(getattr(item, "value", item))


manifest = json.loads(Path(sys.argv[1]).read_text())
output = dict(oracle="liberty-parser+sympy", versions={name: importlib.metadata.version(name)
              for name in ["liberty-parser", "sympy"]}, libraries={})
for item in manifest["libraries"]:
    used = set()
    for case in manifest["cases"]:
        if case["library"] == item["name"] and case["status"] == "passed":
            module = json.loads(Path(case["design"]).read_text())["modules"][manifest["top"]]
            used.update(cell["type"] for cell in module["cells"].values())
    library = parse_liberty(Path(item["path"]).read_text())
    cells = {}
    for cell in library.get_groups("cell"):
        name = str(cell.args[0])
        if name not in used:
            continue
        sequential = [kind for kind in ["ff", "latch", "ff_bank", "latch_bank"] if cell.get_groups(kind)]
        pins = {str(pin_name): dict(direction=value(pin, "direction"), function=value(pin, "function"),
                                   threeState=value(pin, "three_state"))
                for pin in cell.get_groups("pin") for pin_name in pin.args}
        functions = {}
        inputs = {name for name, pin in pins.items() if pin["direction"] == "input"}
        if not sequential and not any(pin["threeState"] is not None for pin in pins.values()):
            for pin_name, pin in pins.items():
                if pin["direction"] != "output" or pin["function"] is None:
                    continue
                expression = parse_boolean_function(pin["function"])
                symbols = sorted(expression.free_symbols, key=str)
                names = list(map(str, symbols))
                if len(names) > 8 or not set(names).issubset(inputs):
                    functions[pin_name] = dict(skipped="variables outside bounded combinational interface")
                    continue
                truth = [bool(expression.subs({symbol: bool(mask & (1 << index)) for index, symbol in enumerate(symbols)}))
                         for mask in range(2 ** len(symbols))]
                functions[pin_name] = dict(variables=names, truth=truth)
        cells[name] = dict(pins=pins, sequential=sequential, functions=functions)
    if set(cells) != used:
        raise ValueError(f"{item['name']}: missing used cells {used - set(cells)}")
    output["libraries"][item["name"]] = dict(cells=cells)
Path(sys.argv[2]).write_text(json.dumps(output, indent=2) + "\n")
print(json.dumps(dict(versions=output["versions"], usedTypes={name: len(lib["cells"]) for name, lib in output["libraries"].items()})))
