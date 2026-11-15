export function normalizeAigPresentation(value = {}) {
  return Object.freeze({ critical: value?.critical !== false, fanout: value?.fanout !== false,
    fanoutThreshold: Math.max(1, Math.min(1000000, Math.trunc(Number(value?.fanoutThreshold) || 2))) });
}

export function createAigPresentationIndex(model, analysis) {
  return { nodes: new Map(model.nodes.map((node) => [node.id, node])),
    edges: new Map(model.edges.map((edge) => [edge.id, edge])),
    criticalNodes: new Set(analysis.criticalNodes), criticalEdges: new Set(analysis.criticalEdges) };
}

export function aigNodeStyle(node, analysis, index, policy) {
  const critical = policy.critical && index.criticalNodes.has(node.id);
  const highFanout = policy.fanout && (analysis.fanout[node.id] || 0) >= policy.fanoutThreshold;
  return { fill: critical ? "#fee2e2" : node.kind === "pi" ? "#e0f2fe" : node.kind === "po" ? "#ecfdf5" : "#ffffff",
    stroke: highFanout ? "#ea580c" : "#334155", "stroke-width": highFanout ? 3 : critical ? 2 : 1.5 };
}

export function aigEdgeStyle(edge, index, policy) {
  const critical = policy.critical && index.criticalEdges.has(edge.id);
  return { stroke: critical ? "#dc2626" : "#64748b", "stroke-width": critical ? 2.8 : 1.5,
    "stroke-dasharray": edge.inverted ? "5 4" : null };
}
