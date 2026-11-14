import { MEASURED_GRAPH_CONTRACT } from "../contracts/measured_graph.js";

export function materializeMeasuredGraph(measured) {
  if (measured?.contract !== MEASURED_GRAPH_CONTRACT) throw new Error("Layout requires a complete MeasuredGraph");
  const { diagram, measurements } = measured;
  return { ...diagram, nodes: diagram.nodes.map((node) => {
    const geometry = measurements.nodes.get(node.id);
    // Coordinates live on the new node. Ports are immutable local geometry;
    // resizeMeasuredPorts creates writable copies only when reflow is needed.
    return { ...node, ...geometry };
  }) };
}

/** Reflow an explicit geometric policy after resize; no domain kind is consulted. */
export function resizeMeasuredPorts(node) {
  const ports = node.ports.map((port) => ({ ...port }));
  if (node.portLayout.mode === "fixed") return ports;
  for (const side of ["left", "right", "top", "bottom"]) {
    const group = ports.filter((port) => port.side === side);
    const vertical = side === "left" || side === "right";
    const extent = vertical ? node.height : node.width;
    const pitch = node.portLayout.pitch || extent / (group.length + 1);
    const span = pitch * (group.length - 1);
    const gap = extent / (group.length + 1);
    for (let index = 0; index < group.length; index += 1) {
      const position = vertical && span <= extent - pitch
        ? (extent - span) / 2 + pitch * index
        : gap * (index + 1);
      if (vertical) { group[index].x = side === "right" ? node.width : 0; group[index].y = position; }
      else { group[index].x = position; group[index].y = side === "bottom" ? node.height : 0; }
    }
  }
  return ports;
}
