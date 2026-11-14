"""Render the existing native mockturtle DOT and a geometry-preserving overlay.

Fixed shared_cone fixture experiment; not a production importer or SVG adapter.
Usage: python render_mockturtle_style.py SOURCE_ASSET_DIR OUTPUT_DIR
Requires Graphviz dot, CairoSVG and Pillow. Run in the remote research environment.
"""

import copy
import hashlib
import io
import json
from pathlib import Path
import subprocess
import sys
import xml.etree.ElementTree as ET

import cairosvg
from PIL import Image, ImageDraw, ImageFont


NS = "{http://www.w3.org/2000/svg}"
ET.register_namespace("", NS[1:-1])
RED = "#be123c"
ORANGE = "#b45309"


def analyze_fixture(path):
    lines = path.read_text().splitlines()
    assert lines[0] == "aag 12 4 0 3 8", "This driver only supports the shared fixture"
    edges = []
    level = {str(i): 0 for i in range(5)}
    fanout = {str(i): 0 for i in range(13)}
    for line in lines[8:16]:
        lhs, *fanins = map(int, line.split())
        target = str(lhs // 2)
        level[target] = max(level[str(literal // 2)] for literal in fanins) + 1
        for slot, literal in enumerate(fanins):
            source = str(literal // 2)
            edges.append(dict(source=source, target=target, slot=slot,
                              inverted=bool(literal & 1), weight=1))
            fanout[source] += 1
    for index, line in enumerate(lines[5:8]):
        literal = int(line)
        source, target = str(literal // 2), f"po{index}"
        level[target] = level[source]
        edges.append(dict(source=source, target=target, slot=0,
                          inverted=bool(literal & 1), weight=0))
        fanout[source] += 1
    depth = max(level[f"po{i}"] for i in range(3))
    remaining = {f"po{i}": 0 for i in range(3)}
    for node in sorted(level, key=lambda item: level[item], reverse=True):
        if node.startswith("po"):
            continue
        candidates = [edge["weight"] + remaining[edge["target"]]
                      for edge in edges if edge["source"] == node
                      and edge["target"] in remaining]
        if candidates:
            remaining[node] = max(candidates)
    critical_nodes = {node for node in level
                      if node in remaining and level[node] + remaining[node] == depth}
    for edge in edges:
        edge["critical"] = (level[edge["source"]] + edge["weight"]
                            + remaining[edge["target"]] == depth)
    assert len(edges) == 19 and sum(edge["inverted"] for edge in edges) == 10
    assert len(critical_nodes) == 9 and sum(edge["critical"] for edge in edges) == 9
    return level, fanout, critical_nodes, edges


def geometry_signature(root):
    # All geometry and label attributes are preserved, including Bezier controls,
    # arrowhead polygons, dash pattern and global coordinate transforms.
    styling = {"fill", "stroke", "stroke-width", "data-node-id", "data-edge-id",
               "data-inverted", "data-critical", "data-fanout"}
    return [(element.tag, sorted((key, value) for key, value in element.attrib.items()
                                if key not in styling),
             element.text if element.tag == NS + "text" else None)
            for element in root.iter() if element.tag != NS + "title"]


def main():
    source, output = map(Path, sys.argv[1:3])
    output.mkdir(parents=True, exist_ok=True)
    aag = source / "shared_cone.aag"
    dot = (source / "mockturtle.dot").read_bytes()
    svg = subprocess.run(["dot", "-Tsvg"], input=dot, check=True,
                         capture_output=True).stdout
    (output / "mockturtle_native.svg").write_bytes(svg)
    (output / "mockturtle.dot").write_bytes(dot)
    level, fanout, critical_nodes, edges = analyze_fixture(aag)
    reference = json.loads((source / "aigverse_metrics.json").read_text())
    for item in reference:
        node = str(item["node"])
        assert (level[node], fanout[node], node in critical_nodes) == (
            item["level"], item["fanout"], item["critical"])
    edge_map = {f"{edge['source']}->{edge['target']}": edge for edge in edges}
    assert len(edge_map) == len(edges), "This fixture has no duplicate source/target pairs"
    native = ET.fromstring(svg)
    enhanced = copy.deepcopy(native)
    node_count = edge_count = inverted_count = critical_edge_count = 0
    for group in enhanced.iter(NS + "g"):
        title = group.find(NS + "title")
        if group.get("class") == "node":
            node_count += 1
            node = title.text
            is_critical = node in critical_nodes
            count = fanout.get(node, 0)
            group.set("data-node-id", node)
            group.set("data-critical", str(is_critical).lower())
            group.set("data-fanout", str(count))
            title.text = f"{node}: depth={level[node]}, fanout={count}, critical={is_critical}"
            for shape in group:
                if shape.tag not in (NS + "ellipse", NS + "polygon"):
                    continue
                if is_critical:
                    shape.set("fill", "#ffe4e6")
                    shape.set("stroke", RED)
                    shape.set("stroke-width", "1.8")
                if count >= 2:
                    shape.set("stroke", ORANGE)
                    shape.set("stroke-width", "2.2")
        elif group.get("class") == "edge":
            edge_count += 1
            key = title.text
            edge = edge_map[key]
            path = group.find(NS + "path")
            assert (path.get("stroke-dasharray") is not None) == edge["inverted"]
            inverted_count += edge["inverted"]
            critical_edge_count += edge["critical"]
            group.set("data-edge-id", f"e{edge['target']}_{edge['slot']}")
            group.set("data-inverted", str(edge["inverted"]).lower())
            group.set("data-critical", str(edge["critical"]).lower())
            title.text = (f"{key}: slot={edge['slot']}, inverted={edge['inverted']}, "
                          f"critical={edge['critical']}")
            if edge["critical"]:
                path.set("stroke", RED)
                path.set("stroke-width", "1.8")
                for arrow in group.findall(NS + "polygon"):
                    arrow.set("fill", RED)
                    arrow.set("stroke", RED)
    assert (node_count, edge_count, inverted_count, critical_edge_count) == (16, 19, 10, 9)
    assert geometry_signature(native) == geometry_signature(enhanced)
    enhanced_svg = ET.tostring(enhanced, encoding="utf-8", xml_declaration=True)
    (output / "mockturtle_highlight.svg").write_bytes(enhanced_svg)

    # Identical scale, with figures kept at their native aspect ratio.
    figures = []
    for name, data in [("mockturtle_native", svg), ("mockturtle_highlight", enhanced_svg)]:
        png = cairosvg.svg2png(bytestring=data, output_width=610)
        (output / f"{name}.png").write_bytes(png)
        figures.append(Image.open(io.BytesIO(png)).convert("RGB"))
    figure_height = figures[0].height
    assert figures[0].size == figures[1].size
    canvas = Image.new("RGB", (1352, figure_height + 236), "#f8fafc")
    draw = ImageDraw.Draw(canvas)
    font_dir = Path("/usr/share/fonts/truetype/dejavu")
    heading = ImageFont.truetype(str(font_dir / "DejaVuSans-Bold.ttf"), 25)
    subheading = ImageFont.truetype(str(font_dir / "DejaVuSans-Bold.ttf"), 19)
    body = ImageFont.truetype(str(font_dir / "DejaVuSans.ttf"), 16)
    draw.text((28, 18), "AIG: mockturtle conventions + analysis overlays", font=heading, fill="#0f172a")
    draw.text((28, 55), "Same AIG, same native DOT layout. Only colors and stroke widths change.",
              font=body, fill="#475569")
    for index, figure in enumerate(figures):
        x = 24 + index * 664
        draw.rounded_rectangle((x, 94, x + 640, figure_height + 150), radius=10,
                               fill="white", outline="#cbd5e1")
        draw.text((x + 16, 106), ["Native mockturtle / Graphviz dot", "Same geometry + highlighting"][index],
                  font=subheading, fill="#0f172a")
        canvas.paste(figure, (x + 15, 140))
    y = figure_height + 164
    draw.text((28, y), "Dashed = inverted   |   Red = critical paths   |   Orange outline = fanout >= 2",
              font=body, fill="#334155")
    draw.text((28, y + 27), "PI 1/2/3/4 = a/b/c/d;  po0/po1/po2 = y/shared/masked.  Constant 0 kept as in native DOT.",
              font=body, fill="#475569")
    canvas.save(output / "mockturtle_style_comparison.png")
    result = dict(
        graphviz=subprocess.run(["dot", "-V"], capture_output=True, text=True, check=True).stderr.strip(),
        source_aag_sha256=hashlib.sha256(aag.read_bytes()).hexdigest(),
        source_dot_sha256=hashlib.sha256(dot).hexdigest(),
        geometry_identical=True, labels_identical=True, inversion_dash_patterns_identical=True,
        node_count=node_count, edge_count=edge_count, inverted_edge_count=inverted_count,
        critical_nodes=sorted(critical_nodes), critical_edge_count=critical_edge_count,
        highlighted_fanout={node: count for node, count in fanout.items() if count >= 2},
        critical_semantics="All longest PI-to-PO paths with unit AND delay; not timing STA",
        fanout_semantics="Signal reference count including PO references",
        overlay="Post-layout SVG attributes only; no node repositioning or edge rerouting",
        scope="Fixed combinational shared_cone fixture; no production UI integration",
    )
    (output / "checks.json").write_text(json.dumps(result, indent=2) + "\n")
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
