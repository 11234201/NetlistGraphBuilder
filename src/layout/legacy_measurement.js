import { createMeasuredLayoutGraph } from "../contracts/measured_graph.js";
import { buildNodePorts, measureNode, DEFAULT_CELL_PIN_PITCH } from "./nodeGeometry.js";
import { buildFocusedFaninTreeBlocks } from "./layered/focusedTreeBlocks.js";

/** Explicit compatibility adapter for the original schematic provider API.
 * Simple continues using its original measurement path and never calls this adapter.
 */
export function measureLegacyLayoutGraph(graph, options = {}) {
  const cellPinPitch = options.cellPinPitch ?? DEFAULT_CELL_PIN_PITCH;
  const nodes = new Map();
  const portLayout = { mode: "side-distributed", pitch: Number(cellPinPitch) || null };
  const zeroOffset = { x: 0, y: 0 };
  for (const node of graph.nodes) {
    const size = options.respectExistingSize !== false && Number.isFinite(node.width) && Number.isFinite(node.height)
      ? node : measureNode(node, cellPinPitch);
    const override = options.nodeSizes?.get(node.id);
    const sized = { ...node, width: override?.width || size.width, height: override?.height || size.height };
    // buildNodePorts owns these fresh records; adding the contract ID needs no
    // intermediate port copy and never changes graph/descriptor input records.
    const ports = buildNodePorts(sized, sized, cellPinPitch);
    for (const port of ports) port.id = `${port.direction}:${encodeURIComponent(port.pin ?? port.rawPin)}`;
    nodes.set(node.id, { width: sized.width, height: sized.height, ports,
      connectionOffsets: { source: node.kind === "cell" && node.outputBubble === true ? { x: 10, y: 0 } : zeroOffset, target: zeroOffset },
      portLayout
    });
  }
  return createMeasuredLayoutGraph(graph, { nodes,
    orderGroups: options.focusedOrderGroups ? buildFocusedFaninTreeBlocks(graph.nodes, graph.edges).entries : [] });
}

export function restoreLegacyLayoutGraph(graph, sourceGraph) {
  const sourceNodes = new Map(sourceGraph.nodes.map((node) => [node.id, node]));
  return { ...graph, nodes: graph.nodes.map((node) => {
    const { connectionOffsets, portLayout, ...legacy } = node;
    const source = sourceNodes.get(node.id);
    if (Object.hasOwn(source, "connectionOffsets")) legacy.connectionOffsets = source.connectionOffsets;
    if (Object.hasOwn(source, "portLayout")) legacy.portLayout = source.portLayout;
    legacy.ports = node.ports.map(({ id, ...port }) => port);
    return legacy;
  }) };
}
