export function simplifyFanoutWithHubs(graph, options = {}) {
  const threshold = Math.max(2, options.threshold || 8);
  const edgesBySourceAndNet = new Map();
  for (const edge of graph.edges) {
    const key = `${edge.source}\u0000${edge.net}`;
    if (!edgesBySourceAndNet.has(key)) edgesBySourceAndNet.set(key, []);
    edgesBySourceAndNet.get(key).push(edge);
  }
  const hubGroups = [...edgesBySourceAndNet.values()].filter((edges) => edges.length >= threshold);
  if (hubGroups.length === 0) return graph;

  const replacedEdgeIds = new Set(hubGroups.flatMap((edges) => edges.map((edge) => edge.id)));
  const nodes = [...graph.nodes];
  const edges = graph.edges.filter((edge) => !replacedEdgeIds.has(edge.id));
  for (const [index, fanoutEdges] of hubGroups.entries()) {
    const first = fanoutEdges[0];
    const hubId = `hub:${safeId(first.net)}:${index}`;
    nodes.push({
      id: hubId,
      kind: "hub",
      label: first.label || first.net,
      title: "FANOUT",
      ref: { name: first.net, fanout: fanoutEdges.length }
    });
    edges.push({
      ...first,
      id: `${first.id}:hub-in`,
      target: hubId,
      targetPin: "H"
    });
    for (const edge of fanoutEdges) {
      edges.push({
        ...edge,
        id: `${edge.id}:hub-out`,
        source: hubId,
        sourcePin: "H"
      });
    }
  }
  return { ...graph, nodes, edges, fanoutHubCount: hubGroups.length };
}

function safeId(value) {
  return String(value).replace(/[^A-Za-z0-9_.:-]+/g, "_");
}
