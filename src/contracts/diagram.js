function requireId(value, label) {
  if (typeof value !== "string" || value.length === 0) throw new Error(`${label} is required`);
  return value;
}

function freezeRecord(value) {
  return Object.freeze({ ...value });
}

export function createDiagramGraph(value) {
  if (!value || typeof value !== "object") throw new Error("Diagram graph is required");
  const nodeIds = new Set();
  const nodes = (value.nodes || []).map((node) => {
    const id = requireId(node?.id, "Diagram node id");
    if (nodeIds.has(id)) throw new Error(`Duplicate diagram node: ${id}`);
    nodeIds.add(id);
    const portIds = new Set();
    const ports = (node.ports || []).map((port) => {
      const portId = requireId(port?.id, "Diagram port id");
      if (portIds.has(portId)) throw new Error(`Duplicate diagram port on ${id}: ${portId}`);
      portIds.add(portId);
      return freezeRecord(port);
    });
    return Object.freeze({ ...node, id, ports: Object.freeze(ports) });
  });
  const edgeIds = new Set();
  const edges = (value.edges || []).map((edge) => {
    const id = requireId(edge?.id, "Diagram edge id");
    if (edgeIds.has(id)) throw new Error(`Duplicate diagram edge: ${id}`);
    edgeIds.add(id);
    return freezeRecord(edge);
  });
  return Object.freeze({
    ...value,
    id: requireId(value.id, "Diagram graph id"),
    domainId: requireId(value.domainId, "Diagram domain id"),
    unitId: requireId(value.unitId, "Diagram unit id"),
    nodes: Object.freeze(nodes),
    edges: Object.freeze(edges)
  });
}

export function createMeasuredGraph(diagram, measurements) {
  if (!diagram?.id) throw new Error("Measured graph requires a diagram");
  if (!measurements || typeof measurements !== "object") throw new Error("Measured graph requires measurements");
  return Object.freeze({ diagram, measurements: freezeRecord(measurements) });
}

export function createScene(value) {
  if (!value?.diagramId) throw new Error("Scene diagramId is required");
  return Object.freeze({
    ...value,
    nodes: Object.freeze([...(value.nodes || [])].map(freezeRecord)),
    edges: Object.freeze([...(value.edges || [])].map(freezeRecord)),
    bounds: freezeRecord(value.bounds || {})
  });
}
