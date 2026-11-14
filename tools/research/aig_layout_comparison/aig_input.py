"""Research-only ABC AIG DOT / flat AND-NOT BLIF normalization.

The CLI emits canonical JSON, provenance and mockturtle-style display DOT.
Graphviz parses DOT syntax; this module interprets only the ABC AIG dialect.
No logic optimization, gate merging or production browser integration.
"""

import argparse
import hashlib
import itertools
import json
from pathlib import Path
import subprocess


def require(condition, message):
    if not condition:
        raise ValueError(message)


def run_dot(text, output_format):
    result = subprocess.run(["dot", f"-T{output_format}"], input=text, text=True,
                            capture_output=True, timeout=30)
    require(result.returncode == 0, f"Graphviz: {result.stderr.strip()}")
    return result.stdout


def parse_abc_dot(text):
    graph = json.loads(run_dot(text, "dot_json"))
    require(graph.get("directed"), "Expected a directed ABC AIG DOT graph")
    # Subgraph objects carry _gvid too. Skip them before interpreting node shapes.
    subgraph_count = graph.get("_subgraph_cnt", 0)
    objects = {obj["_gvid"]: obj for obj in graph.get("objects", [])
               if obj["_gvid"] >= subgraph_count}
    nodes, outputs, ignored = {}, {}, set()
    kinds = {"triangle": "pi", "invtriangle": "po", "ellipse": "and"}
    for key, obj in objects.items():
        shape, label = obj.get("shape", "ellipse"), obj.get("label", obj["name"])
        if label == r"\N":
            label = obj["name"]
        if shape == "plaintext":
            ignored.add(key)
            continue
        if shape == "box" and label.strip() in ("0", "1", "Const0", "Const1"):
            kind = "constant"
        else:
            require(shape in kinds, f"Unsupported ABC AIG node shape: {shape}")
            kind = kinds[shape]
        nodes[obj["name"]] = dict(kind=kind, label=label, fanins=[],
                                 source_id=obj["name"])
        if kind == "constant":
            nodes[obj["name"]]["value"] = int(label.strip()[-1])
    for edge in graph.get("edges", []):
        style = edge.get("style", "solid")
        styles = set(style.split(","))
        if "invis" in styles:
            continue
        require(edge["tail"] not in ignored and edge["head"] not in ignored,
                "Visible edge touches an ABC layout helper")
        require(edge.get("dir") == "back", "Expected ABC AIG edge dir=back")
        require(styles <= {"solid", "dotted"} and len(styles) == 1,
                f"Unsupported ABC AIG edge style: {style}")
        # ABC writes consumer -> fanin with dir=back. Signal flow is the reverse.
        target = objects[edge["tail"]]["name"]
        source = objects[edge["head"]]["name"]
        require(source in nodes and target in nodes, "Missing DOT endpoint")
        nodes[target]["fanins"].append((source, style == "dotted"))
    for node_id, node in nodes.items():
        expected = {"pi": 0, "constant": 0, "and": 2, "po": 1}[node["kind"]]
        require(len(node["fanins"]) == expected, f"{node_id}: expected {expected} fanins")
        if node["kind"] == "po":
            require(node["label"] not in outputs, "Duplicate output name")
            outputs[node["label"]] = node["fanins"][0]
    return dict(nodes=nodes, outputs=outputs, source_format="abc-dot")


def parse_blif(text):
    # Parse source syntax first. Boolean classification happens in normalize().
    lines, pending = [], ""
    for number, raw in enumerate(text.splitlines(), 1):
        part = raw.split("#", 1)[0].rstrip()
        if part.endswith("\\"):
            pending += part[:-1] + " "
        else:
            line = (pending + part).strip()
            pending = ""
            if line:
                lines.append((number, line))
    require(not pending, "Unfinished BLIF continuation")
    nodes, inputs, outputs = {}, [], []
    current = None
    model_seen = ended = False
    for number, line in lines:
        fields = line.split()
        if line.startswith("."):
            current = None
            command, *args = fields
            require(not ended, f"BLIF line {number}: content after .end")
            if command == ".model":
                require(not model_seen and len(args) == 1, "Expected one flat BLIF model")
                model_seen = True
            elif command == ".inputs":
                inputs.extend(args)
            elif command == ".outputs":
                outputs.extend(args)
            elif command == ".names":
                require(1 <= len(args) <= 3, f"BLIF line {number}: require 0..2 fanins")
                *fanin, target = args
                require(target not in nodes, f"BLIF line {number}: multiple drivers: {target}")
                current = dict(kind="table", label=target, inputs=fanin, rows=[],
                               line=number, source_id=target)
                nodes[target] = current
            elif command == ".end":
                require(not args, f"BLIF line {number}: invalid .end")
                ended = True
            else:
                raise ValueError(f"BLIF line {number}: unsupported directive {command}")
        else:
            require(current is not None, f"BLIF line {number}: cover outside .names")
            current["rows"].append(fields)
    require(inputs and outputs, "Explicit nonempty .inputs and .outputs required")
    require(len(set(inputs)) == len(inputs), "Duplicate BLIF input name")
    require(len(set(outputs)) == len(outputs), "Duplicate BLIF output name")
    for name in inputs:
        require(name not in nodes, f"BLIF input also has a driver: {name}")
        nodes[name] = dict(kind="pi", label=name, fanins=[], source_id=name)
    return dict(nodes=nodes, outputs={name: (name, False) for name in outputs},
                source_format="blif")


def classify_table(node):
    """Reduce a <=2 input table to constant, literal, or one AND plus output phase."""
    size = len(node["inputs"])
    cubes, phases = [], set()
    for row in node["rows"]:
        require(len(row) == (2 if size else 1), f"Invalid cover at {node['label']}")
        cube, phase = (row[0], row[1]) if size else ("", row[0])
        require(len(cube) == size and set(cube) <= {"0", "1", "-"} and phase in ("0", "1"),
                f"Invalid cube at {node['label']}")
        cubes.append(cube)
        phases.add(int(phase))
    require(len(phases) <= 1, f"Mixed ON/OFF covers unsupported: {node['label']}")
    assignments = list(itertools.product((0, 1), repeat=size))
    phase = next(iter(phases), 1)
    values = []
    for bits in assignments:
        matched = any(all(char == "-" or int(char) == bit for char, bit in zip(cube, bits))
                      for cube in cubes)
        values.append(phase if matched else 1 - phase)
    if all(value == values[0] for value in values):
        return dict(kind="constant", value=values[0])
    for slot in range(size):
        for inverted in (False, True):
            if values == [bits[slot] ^ inverted for bits in assignments]:
                return dict(kind="alias", fanins=[(node["inputs"][slot], inverted)])
    for output_phase in (False, True):
        for polarities in itertools.product((False, True), repeat=size):
            candidate = [int(all(bit ^ inv for bit, inv in zip(bits, polarities))) ^ output_phase
                         for bits in assignments]
            if size == 2 and values == candidate:
                return dict(kind="and", fanins=list(zip(node["inputs"], polarities)),
                            output_phase=output_phase)
    raise ValueError(f"{node['label']}: truth table is outside the AND/NOT AIG subset")


def normalize(raw):
    # All objects below are derived; raw source records remain unchanged.
    source = {}
    for key, item in raw["nodes"].items():
        source[key] = dict(item)
        if item["kind"] == "table":
            source[key].update(classify_table(item))
    input_items = [(key, node["label"]) for key, node in source.items() if node["kind"] == "pi"]
    require(input_items and raw["outputs"], "AIG must have inputs and outputs")
    require(len({label for _, label in input_items}) == len(input_items), "Duplicate PI label")
    cache, active, topology, gates = {}, set(), {}, {}
    provenance = {}

    def visit(key):
        if key in cache:
            return cache[key]
        require(key in source, f"Undefined signal: {key}")
        require(key not in active, f"Combinational cycle at {key}")
        active.add(key)
        item = source[key]
        kind = item["kind"]
        if kind == "pi":
            structural = "pi:" + json.dumps(item["label"], ensure_ascii=True)
            signal = (structural, False)
            topology.setdefault(structural, dict(kind="pi", label=item["label"], level=0))
        elif kind == "constant":
            structural, signal = "const0", ("const0", bool(item["value"]))
            topology.setdefault(structural, dict(kind="constant", label="0", level=0))
        elif kind in ("alias", "po"):
            child, inverted = item["fanins"][0]
            target, phase = visit(child)
            signal = (target, phase ^ inverted)
        else:
            require(kind == "and" and len(item["fanins"]) == 2, f"Invalid AIG gate: {key}")
            fanins = []
            for child, inverted in item["fanins"]:
                target, phase = visit(child)
                fanins.append((target, bool(phase ^ inverted)))
            fanins.sort()
            structural = "and:" + hashlib.sha256(json.dumps(fanins).encode()).hexdigest()
            # Preserve node multiplicity: never silently strash duplicate ANDs.
            require(structural not in gates or gates[structural] == key,
                    "Duplicate structurally identical AND nodes need an explicit identity mapping; "
                    "this research adapter does not merge or arbitrarily order them")
            gates[structural] = key
            topology[structural] = dict(kind="and", fanins=fanins,
                                       level=1 + max(topology[target]["level"] for target, _ in fanins))
            signal = (structural, bool(item.get("output_phase", False)))
        active.remove(key)
        cache[key] = signal
        provenance[key] = signal
        return signal

    # Visit every logic record, including unused gates, to expose invalid references/cycles.
    for key in sorted(source):
        visit(key)
    outputs = {}
    for name, (source_id, inverted) in sorted(raw["outputs"].items()):
        target, phase = visit(source_id)
        outputs[name] = (target, bool(phase ^ inverted))
    used_constant = any(target == "const0" for item in topology.values()
                        for target, _ in item.get("fanins", []))
    used_constant |= any(target == "const0" for target, _ in outputs.values())
    if not used_constant:
        topology.pop("const0", None)
    ordered = sorted(topology, key=lambda key: (topology[key]["level"],
                     {"constant": 0, "pi": 1, "and": 2}[topology[key]["kind"]],
                     topology[key].get("label", "") if topology[key]["kind"] != "and" else key))
    identities = {key: f"n{index}" for index, key in enumerate(ordered, 1)}
    if "const0" in topology:
        identities["const0"] = "n0"
    nodes, edges = [], []
    for key in ordered:
        item, node_id = topology[key], identities[key]
        nodes.append(dict(id=node_id, kind=item["kind"], level=item["level"],
                          label=item.get("label", node_id[1:])))
        for slot, (target, inverted) in enumerate(item.get("fanins", [])):
            edges.append(dict(id=f"{node_id}:{slot}", source=identities[target],
                              target=node_id, slot=slot, inverted=inverted))
    for index, (name, (target, inverted)) in enumerate(outputs.items()):
        node_id = f"po{index}"
        nodes.append(dict(id=node_id, kind="po", label=name, level=topology[target]["level"]))
        edges.append(dict(id=f"{node_id}:0", source=identities[target],
                          target=node_id, slot=0, inverted=inverted))
    provenance = {key: dict(node_id=identities.get(target), inverted=bool(phase),
                            source_label=source[key]["label"])
                  for key, (target, phase) in sorted(provenance.items())}
    return dict(nodes=nodes, edges=edges), provenance


def analyze(model):
    by_id = {node["id"]: node for node in model["nodes"]}
    incoming = {node_id: [] for node_id in by_id}
    outgoing = {node_id: [] for node_id in by_id}
    for edge in model["edges"]:
        outgoing[edge["source"]].append(edge)
        incoming[edge["target"]].append(edge)
    depth = max(node["level"] for node in model["nodes"] if node["kind"] == "po")
    remaining = {node["id"]: 0 for node in model["nodes"] if node["kind"] == "po"}
    for node in sorted(model["nodes"], key=lambda node: node["level"], reverse=True):
        if node["kind"] == "po":
            continue
        candidates = [(1 if by_id[edge["target"]]["kind"] == "and" else 0)
                      + remaining[edge["target"]] for edge in outgoing[node["id"]]
                      if edge["target"] in remaining]
        if candidates:
            remaining[node["id"]] = max(candidates)
    return dict(
        depth=depth,
        fanout={key: len(edges) for key, edges in outgoing.items()},
        critical_nodes=sorted(node["id"] for node in model["nodes"]
                              if node["id"] in remaining and
                              node["level"] + remaining[node["id"]] == depth),
        critical_edges=sorted(edge["id"] for edge in model["edges"]
                              if edge["target"] in remaining and
                              by_id[edge["source"]]["level"]
                              + (1 if by_id[edge["target"]]["kind"] == "and" else 0)
                              + remaining[edge["target"]] == depth))


def display_dot(model):
    quote = lambda value: json.dumps(str(value), ensure_ascii=False)
    shapes = dict(pi="triangle", po="invtriangle", and_="ellipse", constant="box")
    lines = ["digraph aig {", "rankdir=BT;", "splines=spline;"]
    for node in model["nodes"]:
        shape = shapes["and_" if node["kind"] == "and" else node["kind"]]
        fill = "white" if node["kind"] == "and" else "snow2"
        lines.append(f'{node["id"]} [label={quote(node["label"])}, shape={shape}, '
                     f'style=filled, fillcolor={fill}];')
    for edge in model["edges"]:
        style = "dashed" if edge["inverted"] else "solid"
        lines.append(f'{edge["source"]} -> {edge["target"]} '
                     f'[id={quote(edge["id"])}, style={style}];')
    for depth in sorted({node["level"] for node in model["nodes"] if node["kind"] != "po"}):
        members = [node["id"] for node in model["nodes"] if node["kind"] != "po" and node["level"] == depth]
        lines.append("{rank=same; " + "; ".join(members) + ";}")
    lines.append("{rank=same; " + "; ".join(node["id"] for node in model["nodes"]
                                          if node["kind"] == "po") + ";}")
    lines.append("}")
    return "\n".join(lines) + "\n"


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--format", choices=("abc-dot", "blif"), required=True)
    parser.add_argument("input", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    raw = (parse_abc_dot if args.format == "abc-dot" else parse_blif)(args.input.read_text())
    model, provenance = normalize(raw)
    args.output.mkdir(parents=True, exist_ok=True)
    for name, value in [("source", raw), ("canonical", model), ("provenance", provenance),
                        ("analysis", analyze(model))]:
        (args.output / f"{name}.json").write_text(json.dumps(value, indent=2) + "\n")
    (args.output / "display.dot").write_text(display_dot(model))


if __name__ == "__main__":
    main()
