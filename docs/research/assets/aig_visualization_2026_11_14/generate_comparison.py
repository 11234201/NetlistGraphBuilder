#!/usr/bin/env python3
"""Reproduce the same-AIG drawing comparison. Heavy work stays on mfs-remote."""
import argparse
import hashlib
import itertools
import json
import math
from pathlib import Path
import subprocess
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parent
ABC = ROOT / "abc_build" / "abc"
AIGER = ROOT.parent / "aigtodot"

def prepare():
    from aigverse.io import read_ascii_aiger_into_aig, write_aiger
    aig = read_ascii_aiger_into_aig(str(ROOT / "shared_cone.aag"))
    write_aiger(aig, str(ROOT / "shared_cone.aig"))
    # mockturtle's writer emits a bare trailing 'c'. AIGER requires c + newline.
    # Normalize only the comment delimiter before feeding this one file to all tools.
    path = ROOT / "shared_cone.aig"
    data = path.read_bytes()
    if data.endswith(b"\nc"):
        path.write_bytes(data + b"\n")
    print("Prepared fixture:", aig.num_pis, "PI,", aig.num_gates, "AND,", aig.num_pos, "PO")

def parse_aiger(path):
    data = path.read_bytes()
    offset = data.index(b"\n") + 1
    fields = data[:offset].split()
    kind = fields[0].decode()
    maximum, inputs_count, latch_count, output_count, and_count = map(int, fields[1:6])
    if latch_count:
        raise ValueError("This comparison parser only accepts combinational fixtures")
    def line():
        nonlocal offset
        end = data.index(b"\n", offset)
        value = data[offset:end]
        offset = end + 1
        return value
    def delta():
        nonlocal offset
        value = shift = 0
        while True:
            byte = data[offset]
            offset += 1
            value |= (byte & 127) << shift
            if not byte & 128:
                return value
            shift += 7
    if kind == "aag":
        inputs = [int(line()) for _ in range(inputs_count)]
        outputs = [int(line()) for _ in range(output_count)]
        gates = [tuple(map(int, line().split())) for _ in range(and_count)]
    elif kind == "aig":
        inputs = [2 * (i + 1) for i in range(inputs_count)]
        outputs = [int(line()) for _ in range(output_count)]
        gates = []
        for i in range(and_count):
            lhs = 2 * (inputs_count + i + 1)
            rhs0 = lhs - delta()
            rhs1 = rhs0 - delta()
            gates.append((lhs, rhs0, rhs1))
    else:
        raise ValueError(kind)
    return dict(inputs=inputs, outputs=outputs, gates=gates, maximum=maximum)

def describe(network):
    nodes = {0: "CONST0"}
    levels = {0: 0}
    for i, literal in enumerate(network["inputs"]):
        nodes[literal // 2] = "PI" + str(i)
        levels[literal // 2] = 0
    def signal(literal):
        return nodes[literal // 2] + (":NOT" if literal & 1 else ":POS")
    for lhs, left, right in network["gates"]:
        digest = hashlib.sha256("|".join(sorted([signal(left), signal(right)])).encode()).hexdigest()
        nodes[lhs // 2] = digest
        levels[lhs // 2] = 1 + max(levels[left // 2], levels[right // 2])
    truth = []
    for values in itertools.product([False, True], repeat=len(network["inputs"])):
        state = {0: False}
        state.update({literal // 2: value for literal, value in zip(network["inputs"], values)})
        def evaluate(literal):
            return state[literal // 2] ^ bool(literal & 1)
        for lhs, left, right in network["gates"]:
            state[lhs // 2] = evaluate(left) and evaluate(right)
        truth.append([int(evaluate(output)) for output in network["outputs"]])
    return dict(
        pi=len(network["inputs"]), and_nodes=len(network["gates"]), po=len(network["outputs"]),
        depth=max(levels.values()), outputs=[signal(x) for x in network["outputs"]],
        structure=sorted(nodes[lhs // 2] for lhs, _, _ in network["gates"]), truth_table=truth)

def run(command, log=None):
    result = subprocess.run(command, cwd=ROOT, text=True, capture_output=True, timeout=60, check=True)
    if log:
        (ROOT / log).write_text(result.stdout + result.stderr)
    return result.stdout + result.stderr

def draw():
    run([str(ABC), "-c",
         "read_aiger shared_cone.aig; print_stats; write_dot abc.dot; write_aiger abc_roundtrip.aig"],
        "abc_run.log")
    if not (ROOT / "abc.dot").is_file():
        raise RuntimeError("ABC did not write a DOT file; inspect abc_run.log")
    run([str(ROOT / "draw_aig"), "shared_cone.aig", "mockturtle.dot", "mockturtle_roundtrip.aig"],
        "mockturtle_run.log")
    run([str(AIGER), "shared_cone.aig", "aiger.dot"], "aiger_run.log")
    descriptions = {name: describe(parse_aiger(ROOT / name)) for name in [
        "shared_cone.aag", "shared_cone.aig", "abc_roundtrip.aig", "mockturtle_roundtrip.aig"]}
    reference = descriptions["shared_cone.aag"]
    for name, result in descriptions.items():
        if result != reference:
            raise AssertionError("Structure/truth mismatch: " + name)
    renderings = {}
    for name in ["abc", "mockturtle", "aiger"]:
        for fmt in ["svg", "png"]:
            run(["dot", "-Gdpi=144", "-T" + fmt, name + ".dot", "-o", name + "." + fmt])
        root = ET.parse(ROOT / (name + ".svg")).getroot()
        renderings[name] = {k: root.get(k) for k in ["width", "height", "viewBox"]}
    manifest = dict(
        sample_sha256=hashlib.sha256((ROOT / "shared_cone.aig").read_bytes()).hexdigest(),
        sample=dict(pi=reference["pi"], and_nodes=reference["and_nodes"], po=reference["po"],
                    depth=reference["depth"], input_names=["a", "b", "c", "d"],
                    output_names=["y", "shared", "masked"]),
        checks=dict(same_binary_input=True, no_optimization=True, structural_fingerprints_equal=True,
                    exhaustive_truth_tables_equal=True, input_assignments=16),
        fixture_note="A trailing newline was appended to the bare comment delimiter emitted by the aigverse/mockturtle writer, for AIGER compatibility; no graph data changed.",
        versions=dict(
            abc_source_commit="d527cfab4ad731b767ea0a2be2021d920d3afece",
            abc_build_compatibility="C-only -Dnullptr=NULL; upstream snapshot has nullptr in giaCut.c; no source edits.",
            abc=run([str(ABC), "-c", "version"]).strip(),
            mockturtle_source_commit="a3f817de4005ee6ae12b4dd1ffcf4a4f910691d7",
            graphviz=run(["dot", "-V"]).strip(),
            aiger_source_sha256={name: hashlib.sha256((Path("/home/wzh/open_source/aiger") / name).read_bytes()).hexdigest()
                                for name in ["aiger.c", "aiger.h", "aigtodot.c"]}),
        renderings=renderings, rendering_note="Native DOT unchanged; all rendered at 144 DPI. Composite uses one common scale.",
        truth_table=reference["truth_table"])
    (ROOT / "manifest.json").write_text(json.dumps(manifest, indent=2))
    compose()
    print(json.dumps(manifest, indent=2))

def compose():
    from PIL import Image, ImageDraw, ImageFont
    font_path = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"
    bold_path = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"
    names = ["abc", "mockturtle", "aiger"]
    titles = ["ABC / write_dot", "mockturtle / write_dot", "AIGER / aigtodot"]
    captions = ["Inversion: dotted edge", "Inversion: dashed edge", "Inversion: filled endpoint dot"]
    images = [Image.open(ROOT / (name + ".png")).convert("RGB") for name in names]
    scale = min(1.0, 720 / max(im.width for im in images))
    resampling = getattr(Image, "Resampling", Image)
    images = [im.resize((round(im.width * scale), round(im.height * scale)), resampling.LANCZOS) for im in images]
    panel_width = 760
    header_height = 116
    panel_top = header_height + 62
    image_height = max(im.height for im in images)
    total_height = panel_top + image_height + 78
    canvas = Image.new("RGB", (panel_width * 3 + 40, total_height), "#f3f5f8")
    painter = ImageDraw.Draw(canvas)
    title_font = ImageFont.truetype(bold_path, 30)
    label_font = ImageFont.truetype(bold_path, 24)
    small_font = ImageFont.truetype(font_path, 20)
    painter.text((28, 20), "Same AIG, three native drawing outputs", font=title_font, fill="#16263b")
    painter.text((28, 64), "4 inputs | 8 AND nodes | 3 outputs | 4 levels | no optimization | Graphviz 2.43.0", font=small_font, fill="#4c5c70")
    for i, (im, title, caption) in enumerate(zip(images, titles, captions)):
        x = 20 + i * panel_width
        painter.rectangle((x, header_height, x + panel_width - 12, total_height - 16), fill="white", outline="#d8e0ea", width=2)
        painter.text((x + 20, header_height + 18), title, font=label_font, fill="#172b4d")
        canvas.paste(im, (x + (panel_width - 12 - im.width) // 2, panel_top))
        painter.text((x + 20, total_height - 55), caption, font=small_font, fill="#48576a")
    canvas.save(ROOT / "aig_comparison.png")

def highlight():
    from aigverse.io import read_aiger_into_aig
    from aigverse.networks import DepthAig, FanoutAig
    aig = read_aiger_into_aig(str(ROOT / "shared_cone.aig"))
    depth = DepthAig(aig)
    fanout = FanoutAig(aig)
    lines = ['digraph {', 'rankdir=BT;', 'graph [bgcolor="white",label="aigverse: critical-path nodes + fanout",labelloc=t,fontsize=18];',
             'node [fontname="DejaVu Sans",fontsize=11,style=filled];']
    levels = {}
    metrics = []
    for node in aig.nodes():
        critical = bool(depth.is_on_critical_path(node))
        count = fanout.fanout_size(node)
        level = depth.level(node)
        levels.setdefault(level, []).append(str(node))
        color = "#f4b0a8" if critical else "#e8edf4"
        shape = "box" if aig.is_constant(node) else "triangle" if aig.is_pi(node) else "ellipse"
        label = str(node) + "\\nfo=" + str(count)
        lines.append(f'{node} [label="{label}",shape={shape},fillcolor="{color}",width={0.60+0.18*count:.2f}];')
        metrics.append(dict(node=node, level=level, fanout=count, critical=critical))
        for signal in aig.fanins(node):
            style = "dashed" if aig.is_complemented(signal) else "solid"
            lines.append(f'{aig.get_node(signal)} -> {node} [style={style}];')
    for rank in levels.values():
        lines.append("{rank=same;" + ";".join(rank) + ";}")
    for i, signal in enumerate(aig.pos()):
        name = ["y", "shared", "masked"][i]
        lines.append(f'po{i} [label="{name}",shape=invtriangle,fillcolor="#d9e8f7"];')
        style = "dashed" if aig.is_complemented(signal) else "solid"
        lines.append(f'{aig.get_node(signal)} -> po{i} [style={style}];')
    lines += ['{rank=same;po0;po1;po2;}', '}']
    (ROOT / "aigverse_highlight.dot").write_text("\n".join(lines))
    (ROOT / "aigverse_metrics.json").write_text(json.dumps(metrics, indent=2))
    for fmt in ["svg", "png"]:
        run(["dot", "-Gdpi=144", "-T" + fmt, "aigverse_highlight.dot", "-o", "aigverse_highlight." + fmt])
    print(json.dumps(metrics, indent=2))

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("action", choices=["prepare", "draw", "highlight"])
    action = parser.parse_args().action
    globals()[action]()

