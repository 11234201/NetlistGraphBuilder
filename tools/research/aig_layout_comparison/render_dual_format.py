"""Run the two real import paths, compare SVG bytes, and render named AIG panels.

Usage: python render_dual_format.py FIXTURE_DIRECTORY OUTPUT_DIRECTORY
The input directory contains abc_input.dot, abc_input.blif and shared_cone.aag.
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

from aig_input import analyze, display_dot, normalize, parse_abc_dot, parse_blif, run_dot


NS = "{http://www.w3.org/2000/svg}"
ET.register_namespace("", NS[1:-1])


def hash_bytes(data):
    return hashlib.sha256(data).hexdigest()


def geometry(root):
    ignored = {"fill", "stroke", "stroke-width", "data-node-id", "data-edge-id",
               "data-inverted", "data-critical", "data-fanout"}
    return [(item.tag, sorted((key, value) for key, value in item.attrib.items() if key not in ignored),
             item.text if item.tag == NS + "text" else None)
            for item in root.iter() if item.tag != NS + "title"]


def highlight(svg, model, analysis):
    original = ET.fromstring(svg)
    root = copy.deepcopy(original)
    nodes = {node["id"]: node for node in model["nodes"]}
    edges = {edge["id"]: edge for edge in model["edges"]}
    seen_nodes, seen_edges, seen_inversions = set(), set(), set()
    for group in root.iter(NS + "g"):
        title = group.find(NS + "title")
        if group.get("class") == "node":
            key = title.text
            seen_nodes.add(key)
            node = nodes[key]
            critical = key in analysis["critical_nodes"]
            count = analysis["fanout"][key]
            title.text = f'{node["label"]} | id={key} | depth={node["level"]} | fanout={count}'
            group.set("data-node-id", key)
            group.set("data-critical", str(critical).lower())
            group.set("data-fanout", str(count))
            for shape in group:
                if shape.tag in (NS + "ellipse", NS + "polygon"):
                    if critical:
                        shape.set("fill", "#ffe4e6")
                        shape.set("stroke", "#be123c")
                        shape.set("stroke-width", "1.8")
                    if count >= 2:
                        shape.set("stroke", "#b45309")
                        shape.set("stroke-width", "2.2")
        elif group.get("class") == "edge":
            key = group.get("id")
            seen_edges.add(key)
            edge = edges[key]
            path = group.find(NS + "path")
            inverted = path.get("stroke-dasharray") is not None
            assert inverted == edge["inverted"]
            if inverted:
                seen_inversions.add(key)
            critical = key in analysis["critical_edges"]
            group.set("data-edge-id", key)
            group.set("data-inverted", str(inverted).lower())
            group.set("data-critical", str(critical).lower())
            title.text = f'{key} | {title.text} | inverted={inverted} | critical={critical}'
            if critical:
                path.set("stroke", "#be123c")
                path.set("stroke-width", "1.8")
                for arrow in group.findall(NS + "polygon"):
                    arrow.set("stroke", "#be123c")
                    arrow.set("fill", "#be123c")
    assert seen_nodes == set(nodes) and seen_edges == set(edges)
    assert len(seen_inversions) == 10
    assert geometry(original) == geometry(root)
    return ET.tostring(root, encoding="utf-8", xml_declaration=True)


def compose(images, output):
    assert images[0].size == images[1].size
    height = images[0].height
    canvas = Image.new("RGB", (1352, height + 223), "#f8fafc")
    draw = ImageDraw.Draw(canvas)
    fonts = Path("/usr/share/fonts/truetype/dejavu")
    heading = ImageFont.truetype(str(fonts / "DejaVuSans-Bold.ttf"), 25)
    panel = ImageFont.truetype(str(fonts / "DejaVuSans-Bold.ttf"), 19)
    body = ImageFont.truetype(str(fonts / "DejaVuSans.ttf"), 16)
    draw.text((28, 18), "Same named AIG from ABC DOT and BLIF", font=heading, fill="#0f172a")
    draw.text((28, 55), "Independent imports; identical canonical model, display DOT and SVG.",
              font=body, fill="#475569")
    for index, image in enumerate(images):
        x = 24 + index * 664
        draw.rounded_rectangle((x, 94, x + 640, height + 150), radius=10,
                               fill="white", outline="#cbd5e1")
        draw.text((x + 16, 106), ["ABC DOT input", "AND/NOT BLIF input"][index],
                  font=panel, fill="#0f172a")
        canvas.paste(image, (x + 15, 140))
    draw.text((28, height + 166),
              "Dashed = inverted   |   Red = critical paths   |   Orange outline = fanout >= 2",
              font=body, fill="#334155")
    draw.text((28, height + 191), "Input/output names preserved. Internal numbers are canonical display IDs.",
              font=body, fill="#475569")
    canvas.save(output)


def main():
    fixtures, output = map(Path, sys.argv[1:3])
    output.mkdir(parents=True, exist_ok=True)
    records, images = [], []
    for format_name, parser, filename in [
        ("dot", parse_abc_dot, "abc_input.dot"),
        ("blif", parse_blif, "abc_input.blif"),
    ]:
        raw = parser((fixtures / filename).read_text())
        snapshot = copy.deepcopy(raw)
        model, provenance = normalize(raw)
        assert raw == snapshot
        analysis = analyze(model)
        canonical_dot = display_dot(model)
        svg = run_dot(canonical_dot, "svg").encode()
        highlighted = highlight(svg, model, analysis)
        png = cairosvg.svg2png(bytestring=highlighted, output_width=610)
        images.append(Image.open(io.BytesIO(png)).convert("RGB"))
        records.append(dict(model=model, analysis=analysis, dot=canonical_dot, svg=svg,
                            highlighted=highlighted, png=png))
        (output / f"from_{format_name}.svg").write_bytes(highlighted)
        (output / f"from_{format_name}_provenance.json").write_text(json.dumps(provenance, indent=2) + "\n")
        (output / filename).write_bytes((fixtures / filename).read_bytes())
    left, right = records
    for field in ("model", "analysis", "dot", "svg", "highlighted", "png"):
        assert left[field] == right[field], f"Format difference in {field}"
    (output / "named_plain.svg").write_bytes(left["svg"])
    (output / "canonical.dot").write_text(left["dot"])
    (output / "canonical.json").write_text(json.dumps(left["model"], indent=2) + "\n")
    (output / "analysis.json").write_text(json.dumps(left["analysis"], indent=2) + "\n")
    compose(images, output / "named_comparison.png")
    checks = dict(
        graphviz=subprocess.run(["dot", "-V"], capture_output=True, text=True, check=True).stderr.strip(),
        source_sha256={name: hash_bytes((fixtures / name).read_bytes())
                       for name in ("abc_input.dot", "abc_input.blif", "shared_cone.aag")},
        canonical_model_equal=True, analysis_equal=True, display_dot_equal=True,
        svg_bytes_equal=True, highlight_svg_bytes_equal=True, png_bytes_equal=True,
        highlight_geometry_unchanged=True,
        display_dot_sha256=hash_bytes(left["dot"].encode()),
        svg_sha256=hash_bytes(left["svg"]),
        highlighted_svg_sha256=hash_bytes(left["highlighted"]),
        names={kind: [node["label"] for node in left["model"]["nodes"] if node["kind"] == kind]
               for kind in ("pi", "po")},
        nodes=len(left["model"]["nodes"]), edges=len(left["model"]["edges"]),
        inverted_edges=sum(edge["inverted"] for edge in left["model"]["edges"]),
        critical_edges=len(left["analysis"]["critical_edges"]),
        high_fanout_nodes=sum(count >= 2 for count in left["analysis"]["fanout"].values()),
        scope="Research CLI for ABC AIG DOT and flat AND/NOT BLIF; not production UI",
    )
    (output / "checks.json").write_text(json.dumps(checks, indent=2) + "\n")
    print(json.dumps(checks, indent=2))


if __name__ == "__main__":
    main()
