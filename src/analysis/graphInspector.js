import { analyzeGraphCone } from "./graphCone.js";

export function inspectGraphNode(graph, node, options = {}) {
  if (!node) {
    return null;
  }
  const hierarchyContext = createHierarchyInspectionContext(options.hierarchyContext);
  const connections = getNodeConnections(graph, node);

  return {
    kind: node.kind,
    summary: [
      ["Kind", node.kind],
      ["Label", node.label],
      ["Gate", node.gateKind || node.title || "-"],
      ["Cell type", node.subtitle || "-"],
      ["Inference", node.inferenceSource || "-"]
    ],
    connections,
    hierarchyConnections: inspectParentHierarchyConnections(connections, hierarchyContext),
    traversal: inspectTraversal(graph, node)
  };
}

function createHierarchyInspectionContext(context) {
  if (!context?.design?.modules || !context.currentModule) return null;
  const occurrencePath = [...(context.occurrencePath || [])];
  const moduleByName = new Map(context.design.modules.map((module) => [module.name, module]));
  return {
    currentModule: context.currentModule,
    rootModuleName: context.rootModuleName || context.currentModule.name,
    occurrencePath,
    parent: occurrencePath.length
      ? resolveParentOccurrence(moduleByName, context.rootModuleName || context.currentModule.name, occurrencePath)
      : null,
    portByName: new Map((context.currentModule.ports || []).map((port) => [port.name, port]))
  };
}

function inspectParentHierarchyConnections(connections, context) {
  if (!context?.parent) return [];
  const result = [];
  const seen = new Set();
  for (const connection of connections) {
    const netName = connection.netTarget?.name;
    const port = findBoundaryPort(context, netName);
    if (!port) continue;
    const parentPin = context.parent.cell.pins?.find((pin) =>
      pin.pin === port.name || pin.pinDisplayName === port.displayName
    );
    if (!parentPin?.net) continue;
    const target = createNetTarget(
      parentPin.net,
      `${context.parent.module.displayName || context.parent.module.name}.${parentPin.netDisplayName || parentPin.net}`
    );
    Object.assign(target, {
      moduleName: context.parent.module.name,
      rootModuleName: context.rootModuleName,
      occurrencePath: context.occurrencePath.slice(0, -1)
    });
    const boundaryNetLabel = connection.net || netName;
    const item = {
      scope: "Parent",
      boundary: `${context.currentModule.displayName || context.currentModule.name}.${boundaryNetLabel}`,
      portDirection: port.direction || "unknown",
      flow: hierarchyFlow(port.direction),
      target
    };
    const key = `${item.boundary}:${target.moduleName}:${target.occurrencePath.join("/")}:${target.name}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(item);
  }
  return result;
}

function findBoundaryPort(context, netName) {
  if (!netName) return null;
  const direct = context.portByName.get(netName);
  if (direct) return direct;
  for (const port of context.currentModule.ports || []) {
    if (!port.range || !netName.startsWith(`${port.name}[`) || !netName.endsWith("]")) continue;
    const bit = Number(netName.slice(port.name.length + 1, -1));
    const minimum = Math.min(Number(port.range.msb), Number(port.range.lsb));
    const maximum = Math.max(Number(port.range.msb), Number(port.range.lsb));
    if (Number.isInteger(bit) && bit >= minimum && bit <= maximum) return port;
  }
  return null;
}

function hierarchyFlow(direction) {
  if (direction === "input") return "Fanin";
  if (direction === "output") return "Fanout";
  return "Both";
}

function resolveParentOccurrence(moduleByName, rootModuleName, occurrencePath) {
  let module = moduleByName.get(rootModuleName);
  if (!module) return null;
  for (let index = 0; index < occurrencePath.length; index += 1) {
    const cell = module.cells?.find((item) => item.instance === occurrencePath[index]);
    if (!cell) return null;
    if (index === occurrencePath.length - 1) return { module, cell };
    module = moduleByName.get(cell.type);
    if (!module) return null;
  }
  return null;
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
  const immediateTargets = cone.immediateNodeIds
    .map((id) => createNodeTarget(nodeById.get(id)))
    .filter(Boolean);
  return {
    label,
    immediate: cone.immediateNodeIds.map((id) => nodeById.get(id)?.label || id),
    immediateTargets,
    transitiveCount: Math.max(0, cone.nodeIds.length - 1),
    maxDepth: cone.maxDepthReached
  };
}

export function inspectGraphNet(graph, netName, options = {}) {
  const edges = graph?.edges.filter((edge) => edge.net === netName) || [];
  const nodeById = new Map(graph?.nodes.map((node) => [node.id, node]) || []);
  const driverEndpoints = uniqueNetEndpoints(edges.map((edge) => ({
    node: nodeById.get(edge.source),
    pin: edge.sourcePin
  })));
  const loadEndpoints = uniqueNetEndpoints(edges.map((edge) => ({
    node: nodeById.get(edge.target),
    pin: edge.targetPin
  })));
  const driverTargets = driverEndpoints.map((endpoint) => endpoint.target);
  const loadTargets = loadEndpoints.map((endpoint) => endpoint.target);
  const drivers = driverTargets.map((target) => target.label);
  const loads = loadTargets.map((target) => target.label);
  const netTarget = createNetTarget(netName, edges[0]?.label || netName);
  const hierarchyContext = createHierarchyInspectionContext(options.hierarchyContext);
  const connections = [
    ...driverEndpoints.map((endpoint) => ({
      pin: "driver",
      direction: "output",
      net: edges[0]?.label || netName,
      netTarget,
      peers: endpoint.target.label,
      peerTargets: [endpoint.target]
    })),
    ...loadEndpoints.map((endpoint) => ({
      pin: "load",
      direction: "input",
      net: edges[0]?.label || netName,
      netTarget,
      peers: endpoint.target.label,
      peerTargets: [endpoint.target]
    }))
  ];

  return {
    kind: "net",
    summary: [
      ["Kind", "net"],
      ["Name", edges[0]?.label || netName],
      ["Driver", drivers.join(", ") || "-"],
      ["Loads", loads.join(", ") || "-"],
      ["Fanout", edges.length]
    ],
    connections,
    hierarchyConnections: inspectParentHierarchyConnections([
      { net: edges[0]?.label || netName, netTarget }
    ], hierarchyContext)
  };
}

function uniqueNetEndpoints(endpoints) {
  const seen = new Set();
  const unique = [];
  const ordered = [...endpoints].sort((left, right) => {
    const leftKey = `${left.node?.id || ""}:${left.pin || ""}`;
    const rightKey = `${right.node?.id || ""}:${right.pin || ""}`;
    return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
  });
  for (const endpoint of ordered) {
    const target = createNodeTarget(endpoint.node, endpoint.pin);
    if (!target) continue;
    const key = `${target.kind}:${target.id}:${target.label}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push({ ...endpoint, target });
  }
  return unique;
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

  if (node.kind === "input" || node.kind === "focus-input" || node.kind === "implicit" || node.kind === "constant") {
    const netName = node.ref?.name || node.ports?.[0]?.pin || node.label;
    return [inspectPin(graph, node, node.label, node.label, netName, "output")];
  }

  if (node.kind === "output" || node.kind === "focus-output") {
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
    ? edges.map((edge) => createNodeTarget(nodeById.get(edge.target), edge.targetPin))
    : edges.map((edge) => createNodeTarget(nodeById.get(edge.source), edge.sourcePin));
  const peerTargets = uniqueTargets(peers);
  const targetNetName = edges[0]?.net || netName;

  return {
    pin: pinName,
    direction: direction || "unknown",
    net: netLabel || edges[0]?.label || netName || "-",
    netTarget: createNetTarget(targetNetName, netLabel || edges[0]?.label || targetNetName),
    peers: peerTargets.map((target) => target.label).join(", ") || "-",
    peerTargets
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

function createNodeTarget(node, pin = null) {
  if (!node) return null;
  return {
    kind: "node",
    id: node.id,
    label: describeEndpoint(node, pin)
  };
}

function createNetTarget(name, label) {
  if (!name || name === "-") return null;
  return {
    kind: "net",
    name,
    label: label || name
  };
}

function uniqueTargets(targets) {
  const seen = new Set();
  return targets.filter((target) => {
    if (!target) return false;
    const key = `${target.moduleName || ""}:${(target.occurrencePath || []).join("/")}:${target.kind}:${target.id || target.name}:${target.label}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
