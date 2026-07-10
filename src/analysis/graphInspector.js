import { analyzeGraphCone } from "./graphCone.js";

export function inspectGraphNode(graph, node) {
  if (!node) {
    return null;
  }

  return {
    kind: node.kind,
    summary: [
      ["Kind", node.kind],
      ["Label", node.label],
      ["Gate", node.gateKind || node.title || "-"],
      ["Cell type", node.subtitle || "-"],
      ["Inference", node.inferenceSource || "-"]
    ],
    connections: getNodeConnections(graph, node),
    traversal: inspectTraversal(graph, node)
  };
}

function inspectTraversal(graph, node) {
  const nodeById = new Map(graph?.nodes.map((item) => [item.id, item]) || []);
  const fanin = analyzeGraphCone(graph, node.id, { direction: "fanin" });
  const fanout = analyzeGraphCone(graph, node.id, { direction: "fanout" });
  return [
    describeTraversal("Fanin", fanin, nodeById),
    describeTraversal("Fanout", fanout, nodeById)
  ];
}

function describeTraversal(label, cone, nodeById) {
  return {
    label,
    immediate: cone.immediateNodeIds.map((id) => nodeById.get(id)?.label || id),
    transitiveCount: Math.max(0, cone.nodeIds.length - 1),
    maxDepth: cone.maxDepthReached
  };
}

export function inspectGraphNet(graph, netName) {
  const edges = graph?.edges.filter((edge) => edge.net === netName) || [];
  const nodeById = new Map(graph?.nodes.map((node) => [node.id, node]) || []);
  const drivers = uniqueValues(edges.map((edge) => describeEndpoint(nodeById.get(edge.source), edge.sourcePin)));
  const loads = uniqueValues(edges.map((edge) => describeEndpoint(nodeById.get(edge.target), edge.targetPin)));

  return {
    kind: "net",
    summary: [
      ["Kind", "net"],
      ["Name", edges[0]?.label || netName],
      ["Driver", drivers.join(", ") || "-"],
      ["Loads", loads.join(", ") || "-"],
      ["Fanout", edges.length]
    ],
    connections: [
      ...drivers.map((endpoint) => ({ pin: "driver", direction: "output", net: edges[0]?.label || netName, peers: endpoint })),
      ...loads.map((endpoint) => ({ pin: "load", direction: "input", net: edges[0]?.label || netName, peers: endpoint }))
    ]
  };
}

function getNodeConnections(graph, node) {
  if (node.kind === "cell") {
    return (node.ref?.pins || []).map((pin) => {
      const pinName = pin.pinDisplayName || pin.pin;
      const direction = node.pinDirections?.[pinName]?.direction ||
        node.pinDirections?.[pin.pin]?.direction ||
        inferDirectionFromEdges(graph, node.id, pinName);
      return inspectPin(graph, node, pinName, pin.netDisplayName || pin.net, pin.net, direction);
    });
  }

  if (node.kind === "assign") {
    return [
      inspectPin(graph, node, "I", node.ref?.rhsDisplayName || node.ref?.rhs, node.ref?.rhs, "input"),
      inspectPin(graph, node, "Z", node.ref?.lhsDisplayName || node.ref?.lhs, node.ref?.lhs, "output")
    ];
  }

  if (node.kind === "input" || node.kind === "implicit" || node.kind === "constant") {
    const netName = node.ref?.name || node.ports?.[0]?.pin || node.label;
    return [inspectPin(graph, node, node.label, node.label, netName, "output")];
  }

  if (node.kind === "output") {
    const netName = node.ref?.name || node.ports?.[0]?.pin || node.label;
    return [inspectPin(graph, node, node.label, node.label, netName, "input")];
  }

  return [];
}

function inspectPin(graph, node, pinName, netLabel, netName, direction) {
  const nodeById = new Map(graph?.nodes.map((item) => [item.id, item]) || []);
  const edges = graph?.edges.filter((edge) => {
    if (direction === "output") {
      return edge.source === node.id && edge.sourcePin === pinName && (!netName || edge.net === netName);
    }
    return edge.target === node.id && edge.targetPin === pinName && (!netName || edge.net === netName);
  }) || [];
  const peers = direction === "output"
    ? edges.map((edge) => describeEndpoint(nodeById.get(edge.target), edge.targetPin))
    : edges.map((edge) => describeEndpoint(nodeById.get(edge.source), edge.sourcePin));

  return {
    pin: pinName,
    direction: direction || "unknown",
    net: netLabel || edges[0]?.label || netName || "-",
    peers: uniqueValues(peers).join(", ") || "-"
  };
}

function inferDirectionFromEdges(graph, nodeId, pinName) {
  if (graph?.edges.some((edge) => edge.source === nodeId && edge.sourcePin === pinName)) {
    return "output";
  }
  return "input";
}

function describeEndpoint(node, pin) {
  if (!node) {
    return "-";
  }
  return pin ? `${node.label}.${pin}` : node.label;
}

function uniqueValues(values) {
  return [...new Set(values.filter(Boolean))];
}
