import { analyzeGraphCone } from "./graphCone.js";

export function inspectGraphNode(graph, node, options = {}) {
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
    connections: addAdjacentHierarchyConnections(getNodeConnections(graph, node), node, options.hierarchyContext),
    traversal: inspectTraversal(graph, node)
  };
}

function addAdjacentHierarchyConnections(connections, node, context) {
  if (!context?.design?.modules || !context.currentModule) return connections;
  const modules = context.design.modules;
  const occurrencePath = [...(context.occurrencePath || [])];
  const rootModuleName = context.rootModuleName || context.currentModule.name;
  const sourceCell = context.currentModule.cells?.find((cell) =>
    cell.instance === (node.ref?.instance || node.ref?.localId || node.id?.replace(/^cell:/, ""))
  );
  const childModule = sourceCell && modules.find((module) => module.name === sourceCell.type);
  if (childModule) {
    return connections.map((connection) => {
      const port = childModule.ports?.find((item) => item.name === connection.pin);
      if (!port) return connection;
      const target = createNetTarget(port.name, `${childModule.displayName || childModule.name}.${port.displayName || port.name}`);
      Object.assign(target, {
        moduleName: childModule.name,
        rootModuleName,
        occurrencePath: [...occurrencePath, sourceCell.instance]
      });
      return {
        ...connection,
        peers: [connection.peers, target.label].filter((value) => value && value !== "-").join(", ") || "-",
        peerTargets: uniqueTargets([...(connection.peerTargets || []), target])
      };
    });
  }

  if (!node.ref?.direction || occurrencePath.length === 0) return connections;
  const parent = resolveParentOccurrence(modules, rootModuleName, occurrencePath);
  if (!parent) return connections;
  const localPort = node.ref?.localId || node.ref?.name || node.label;
  const parentPin = parent.cell.pins?.find((pin) => pin.pin === localPort);
  if (!parentPin?.net) return connections;
  const target = createNetTarget(parentPin.net, `${parent.module.displayName || parent.module.name}.${parentPin.netDisplayName || parentPin.net}`);
  Object.assign(target, {
    moduleName: parent.module.name,
    rootModuleName,
    occurrencePath: occurrencePath.slice(0, -1)
  });
  return connections.map((connection) => ({
    ...connection,
    peers: [connection.peers, target.label].filter((value) => value && value !== "-").join(", ") || "-",
    peerTargets: uniqueTargets([...(connection.peerTargets || []), target])
  }));
}

function resolveParentOccurrence(modules, rootModuleName, occurrencePath) {
  let module = modules.find((item) => item.name === rootModuleName);
  if (!module) return null;
  for (let index = 0; index < occurrencePath.length; index += 1) {
    const cell = module.cells?.find((item) => item.instance === occurrencePath[index]);
    if (!cell) return null;
    if (index === occurrencePath.length - 1) return { module, cell };
    module = modules.find((item) => item.name === cell.type);
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

export function inspectGraphNet(graph, netName) {
  const edges = graph?.edges.filter((edge) => edge.net === netName) || [];
  const nodeById = new Map(graph?.nodes.map((node) => [node.id, node]) || []);
  const driverTargets = uniqueTargets(edges.map((edge) => createNodeTarget(nodeById.get(edge.source), edge.sourcePin)));
  const loadTargets = uniqueTargets(edges.map((edge) => createNodeTarget(nodeById.get(edge.target), edge.targetPin)));
  const drivers = driverTargets.map((target) => target.label);
  const loads = loadTargets.map((target) => target.label);
  const netTarget = createNetTarget(netName, edges[0]?.label || netName);

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
      ...driverTargets.map((target) => ({
        pin: "driver",
        direction: "output",
        net: edges[0]?.label || netName,
        netTarget,
        peers: target.label,
        peerTargets: [target]
      })),
      ...loadTargets.map((target) => ({
        pin: "load",
        direction: "input",
        net: edges[0]?.label || netName,
        netTarget,
        peers: target.label,
        peerTargets: [target]
      }))
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
