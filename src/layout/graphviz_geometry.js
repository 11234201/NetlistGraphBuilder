/** Convert Graphviz JSON drawing commands into controlled, domain-neutral curve geometry.
 * Graphviz uses points (72/inch), bottom-left origin. Output uses SVG units, top-left origin.
 * Only geometry and literal text survive; URLs, images, HTML, colors and arbitrary SVG do not.
 */
export function graphvizJsonToGeometry(json, { padding = 24, nodeLabels = null } = {}) {
  if (!json || typeof json !== "object") throw new Error("Expected Graphviz layout JSON");
  if (!Number.isFinite(padding) || padding < 0) throw new Error("Invalid curve geometry padding");
  const box = String(json.bb || "").split(",").map(Number);
  if (box.length !== 4 || !box.every(Number.isFinite) || box[2] < box[0] || box[3] < box[1]) {
    throw new Error("Graphviz result has invalid bounds");
  }
  const point = (value) => {
    if (!Array.isArray(value) || value.length < 2 || !value.slice(0, 2).every(Number.isFinite)) {
      throw new Error("Graphviz result has invalid coordinates");
    }
    return { x: value[0] - box[0] + padding, y: box[3] - value[1] + padding };
  };
  const names = new Map();
  const nodes = [];
  const ids = new Set();
  for (const item of json.objects || []) {
    if (item.pos === undefined) continue; // Rank subgraphs are not diagram nodes.
    const id = String(item.id || item.name);
    if (ids.has(id)) throw new Error(`Duplicate Graphviz node id: ${id}`);
    ids.add(id);
    names.set(item._gvid, id);
    const center = point(String(item.pos).split(",").map(Number));
    const width = Number(item.width) * 72, height = Number(item.height) * 72;
    if (![width, height].every((value) => Number.isFinite(value) && value >= 0)) throw new Error("Invalid Graphviz node size");
    nodes.push({ id, x: center.x - width / 2, y: center.y - height / 2, width, height, center,
      shapes: readShapes(item._draw_, point), labels: readLabels(item._ldraw_, point, nodeLabels?.get(id)) });
  }
  const edges = [];
  ids.clear();
  for (const item of json.edges || []) {
    if (item.style === "invis") continue; // A rank constraint has no drawable curve or hit target.
    const id = String(item.id || `edge:${item._gvid}`);
    if (ids.has(id)) throw new Error(`Duplicate Graphviz edge id: ${id}`);
    ids.add(id);
    const source = names.get(item.tail), target = names.get(item.head);
    if (source === undefined || target === undefined) throw new Error("Graphviz edge references missing node");
    const shapes = readShapes(item._draw_, point);
    const paths = shapes.filter((shape) => shape.type === "path").map((shape) => shape.d);
    if (!paths.length) throw new Error(`Graphviz edge has no curve: ${id}`);
    edges.push({ id, source, target, paths,
      arrows: [...readShapes(item._hdraw_, point), ...readShapes(item._tdraw_, point)],
      labels: [...readLabels(item._ldraw_, point), ...readLabels(item._hldraw_, point), ...readLabels(item._tldraw_, point)] });
  }
  return { kind: "curve-geometry.v1", bounds: { width: box[2] - box[0] + 2 * padding, height: box[3] - box[1] + 2 * padding }, nodes, edges };
}

function readShapes(commands = [], point) {
  const shapes = [];
  for (const command of commands) {
    if (["e", "E"].includes(command.op)) {
      if (!Array.isArray(command.rect) || command.rect.length !== 4 || !command.rect.every(Number.isFinite) || command.rect[2] < 0 || command.rect[3] < 0) {
        throw new Error("Invalid Graphviz ellipse");
      }
      const center = point(command.rect);
      shapes.push({ type: "ellipse", cx: center.x, cy: center.y, rx: command.rect[2], ry: command.rect[3] });
    } else if (["p", "P"].includes(command.op)) {
      shapes.push({ type: "polygon", points: command.points.map(point) });
    } else if (["b", "B", "L"].includes(command.op)) {
      const points = command.points.map(point);
      if (!points.length || (command.op !== "L" && (points.length - 1) % 3 !== 0)) throw new Error("Invalid Graphviz curve control points");
      const coordinate = ({ x, y }) => `${number(x)},${number(y)}`;
      let d = `M${coordinate(points[0])}`;
      if (command.op === "L") d += points.slice(1).map((value) => ` L${coordinate(value)}`).join("");
      else for (let index = 1; index < points.length; index += 3) d += ` C${points.slice(index, index + 3).map(coordinate).join(" ")}`;
      shapes.push({ type: "path", d });
    }
  }
  return shapes;
}

function readLabels(commands = [], point, literalText) {
  const labels = [];
  // Graphviz 16.1 JSON can truncate drawing text after consecutive backslashes.
  // A plain-label projection may supply its complete text; keep the engine's
  // positions/alignment, including the vertical space left by empty lines.
  const lines = literalText === undefined ? null : String(literalText).split(/[\r\n]/).filter((line) => line.length);
  let fontSize = 14, fontFamily = "Arial";
  for (const command of commands) {
    if (command.op === "F") {
      if (!Number.isFinite(command.size) || command.size <= 0) throw new Error("Invalid Graphviz font size");
      fontSize = command.size;
      fontFamily = String(command.face || "Arial");
    } else if (command.op === "T") {
      // JSON drawing text still escapes literal backslashes after JSON.parse.
      // Decode pairs only: literal \n, \N, etc. are already laid-out text.
      labels.push({ ...point(command.pt), text: lines ? lines[labels.length] : String(command.text).replaceAll("\\\\", "\\"), fontSize, fontFamily,
        textAnchor: command.align === "l" ? "start" : command.align === "r" ? "end" : "middle" });
    }
  }
  if (lines && lines.length !== labels.length) throw new Error("Graphviz plain label does not match its drawing lines");
  return labels;
}

function number(value) { return Number(value.toFixed(4)); }
