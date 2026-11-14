import argparse
import json
from pathlib import Path
import math
import cairosvg
from PIL import Image, ImageDraw, ImageFont

root = Path(argparse.ArgumentParser().parse_known_args()[1][0]).resolve()
data = json.loads((root / "results.json").read_text())
titles = {
    "anchor": "AnchorLayered | current measured provider",
    "elk": "ELK 0.11.1 | current measured provider",
    "graphviz": "Graphviz 2.43.0 | dot with splines",
}
font_dir = Path("/usr/share/fonts/truetype/dejavu")
font = lambda size, bold=False: ImageFont.truetype(str(font_dir / ("DejaVuSans-Bold.ttf" if bold else "DejaVuSans.ttf")), size)
scale = 1.5
for mode in ["", "_plain"]:
    images = []
    for result in data["results"]:
        name = result["name"]
        if "error" in result:
            raise RuntimeError(result["error"])
        cairosvg.svg2png(url=str(root / (name + mode + ".svg")), write_to=str(root / (name + mode + ".png")), scale=scale)
        images.append(Image.open(root / (name + mode + ".png")).convert("RGB"))
    canvas_width = max(im.width for im in images) + 48
    header_height = 152
    heights = [im.height + 88 for im in images]
    canvas = Image.new("RGB", (canvas_width, header_height + sum(heights) + 20), "#f1f4f8")
    draw = ImageDraw.Draw(canvas)
    draw.text((24, 18), "Same AIG | same compact geometry | three layout providers", font=font(24, True), fill="#142841")
    draw.text((24, 57), "15 nodes, 19 edges, 10 inversions | 72 x 48 node frames | left to right | common scale", font=font(17), fill="#43536b")
    if not mode:
        draw.line((26, 101, 66, 101), fill="#c73932", width=4)
        draw.text((76, 90), "critical path", font=font(17), fill="#43536b")
        draw.ellipse((251, 94, 264, 107), fill="white", outline="#172b4d", width=2)
        draw.text((275, 90), "inversion", font=font(17), fill="#43536b")
        draw.rounded_rectangle((430, 91, 470, 112), radius=3, fill="#ffdaa3")
        draw.text((481, 90), "fanout >= 2", font=font(17), fill="#43536b")
        draw.text((685, 90), "L: logic depth   fo: fanout references", font=font(17), fill="#43536b")
    else:
        draw.text((24, 90), "Plain view: inversion markers retained; analytical colors disabled", font=font(17), fill="#43536b")
    y = header_height
    for result, im, row_height in zip(data["results"], images, heights):
        draw.rectangle((12, y, canvas_width-12, y+row_height-12), fill="white", outline="#d6dee8", width=2)
        draw.text((30, y+13), titles[result["name"]], font=font(22, True), fill="#142841")
        canvas.paste(im, (24, y+49))
        metrics = result["metrics"]
        turns = str(metrics["bends"])+" direction changes" if metrics["bends"] is not None else "cubic splines"
        validation = "0 native route violations" if result["nativeValidation"] and result["nativeValidation"]["total"]==0 else "exact port checks passed"
        caption = f'{metrics["width"]:g} x {metrics["height"]:g} | {turns} | {metrics["properCrossingsApprox"]} crossings* | {validation}'
        draw.text((30,y+row_height-34),caption,font=font(17),fill="#43536b")
        y += row_height
    canvas.save(root / ("comparison"+mode+".png"))

def counters(points):
    lengths=[math.dist((a["x"],a["y"]),(b["x"],b["y"])) for a,b in zip(points,points[1:])]
    corners=reversals=0
    for a,b,c in zip(points,points[1:],points[2:]):
        u=(b["x"]-a["x"],b["y"]-a["y"])
        v=(c["x"]-b["x"],c["y"]-b["y"])
        if abs(u[0]*v[1]-u[1]*v[0])>1e-6: corners+=1
        elif u[0]*v[0]+u[1]*v[1]<0: reversals+=1
    return dict(corners=corners,reversals=reversals,shortSegmentsAtMostOneUnit=sum(1e-6<x<=1 for x in lengths))
raw=json.loads((root/"elk_engine_raw.json").read_text())
final=json.loads((root/"elk_geometry.json").read_text())
rows=[]
for edge in raw["edges"]:
    section=edge["sections"][0]
    points=[section["startPoint"],*section.get("bendPoints",[]),section["endPoint"]]
    after=next(e for e in final["edges"] if e["id"]==edge["id"])
    rows.append(dict(edgeId=edge["id"],raw=counters(points),adapted=counters(after["points"])))
diagnostic={"rawTotals":{key:sum(row["raw"][key] for row in rows) for key in rows[0]["raw"]},
            "adaptedTotals":{key:sum(row["adapted"][key] for row in rows) for key in rows[0]["adapted"]},"edges":rows,
            "note":"Same actual ELK call; raw section geometry versus measured_elk_layout.js output. No correction was applied."}
(root/"elk_adapter_diagnostic.json").write_text(json.dumps(diagnostic,indent=2))
print(json.dumps({k:v for k,v in diagnostic.items() if k!="edges"},indent=2))
print("Rendered comparison.png and comparison_plain.png")
