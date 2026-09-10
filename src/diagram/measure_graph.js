import { buildNodePorts, measureNode } from "../layout/nodeGeometry.js";

export function measureDiagramGraph(graph, options = {}) {
  const cellPinPitch = options.cellPinPitch;
  return {
    ...graph,
    nodes: graph.nodes.map((node) => {
      const size = measureNode(node, cellPinPitch);
      const measured = { ...node, width: size.width, height: size.height };
      measured.ports = buildNodePorts(measured, size, cellPinPitch);
      return measured;
    })
  };
}
