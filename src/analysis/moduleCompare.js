const PAIR_SUFFIX = /(?:_Flex|_orig|_new)$/i;

export function normalizePairName(name) {
  return String(name || "").replace(PAIR_SUFFIX, "");
}

export function recommendModulePair(modules, moduleName) {
  const source = modules.find((item) => item.name === moduleName);
  if (!source) {
    return null;
  }
  const base = normalizePairName(source.name);
  return modules.find((item) => item !== source && normalizePairName(item.name) === base) || null;
}

export function alignModulePorts(leftModule, rightModule) {
  const left = new Map(leftModule.ports.map((port) => [port.name, port]));
  const right = new Map(rightModule.ports.map((port) => [port.name, port]));
  const names = [...new Set([...leftModule.portOrder, ...rightModule.portOrder])];
  return names.map((name) => {
    const leftPort = left.get(name) || null;
    const rightPort = right.get(name) || null;
    const matched = Boolean(leftPort && rightPort && leftPort.direction === rightPort.direction);
    return {
      name,
      left: leftPort,
      right: rightPort,
      direction: leftPort?.direction || rightPort?.direction || "unknown",
      matched
    };
  }).sort(compareAlignedPorts);
}

export function compareModules(leftModule, rightModule, leftGraph, rightGraph) {
  const ports = alignModulePorts(leftModule, rightModule);
  const leftNets = new Set(leftModule.nets.map((net) => net.name));
  const rightNets = new Set(rightModule.nets.map((net) => net.name));
  const commonNets = [...leftNets].filter((name) => rightNets.has(name));
  const leftStats = analyzeGraphStats(leftGraph);
  const rightStats = analyzeGraphStats(rightGraph);
  return {
    ports,
    matchedPorts: ports.filter((port) => port.matched).map((port) => port.name),
    unmatchedPorts: ports.filter((port) => !port.matched).map((port) => port.name),
    commonNets,
    unmatchedNets: {
      left: [...leftNets].filter((name) => !rightNets.has(name)),
      right: [...rightNets].filter((name) => !leftNets.has(name))
    },
    commonGateKinds: [...new Set(leftGraph.nodes.filter(isCell).map(gateKind))]
      .filter((kind) => rightGraph.nodes.filter(isCell).some((node) => gateKind(node) === kind)),
    left: leftStats,
    right: rightStats,
    delta: {
      cells: rightStats.cells - leftStats.cells,
      logicDepth: rightStats.logicDepth - leftStats.logicDepth,
      maxFanout: rightStats.maxFanout - leftStats.maxFanout
    }
  };
}

export function analyzeGraphStats(graph) {
  const cells = graph.nodes.filter(isCell);
  const gateKinds = {};
  const fanoutByNode = new Map();
  for (const node of cells) {
    gateKinds[gateKind(node)] = (gateKinds[gateKind(node)] || 0) + 1;
  }
  for (const edge of graph.edges) {
    fanoutByNode.set(edge.source, (fanoutByNode.get(edge.source) || 0) + 1);
  }
  return {
    cells: cells.length,
    gateKinds,
    logicDepth: estimateLogicDepth(graph),
    maxFanout: Math.max(0, ...fanoutByNode.values()),
    ports: graph.nodes.filter((node) => node.kind === "input" || node.kind === "output").length,
    nets: new Set(graph.edges.map((edge) => edge.net)).size
  };
}

function estimateLogicDepth(graph) {
  const incoming = new Map(graph.nodes.map((node) => [node.id, []]));
  const nodeById = new Map(graph.nodes.map((node) => [node.id, node]));
  for (const edge of graph.edges) {
    incoming.get(edge.target)?.push(edge.source);
  }
  const memo = new Map();
  const visiting = new Set();
  const depth = (id) => {
    if (memo.has(id)) {
      return memo.get(id);
    }
    if (visiting.has(id)) {
      return 0;
    }
    visiting.add(id);
    const node = nodeById.get(id);
    const value = (node?.kind === "cell" ? 1 : 0) + Math.max(0, ...(incoming.get(id) || []).map(depth));
    visiting.delete(id);
    memo.set(id, value);
    return value;
  };
  return Math.max(0, ...graph.nodes.map((node) => depth(node.id)));
}

function compareAlignedPorts(a, b) {
  const rank = (direction) => direction === "input" ? 0 : direction === "output" ? 1 : 2;
  return rank(a.direction) - rank(b.direction) || a.name.localeCompare(b.name);
}

function isCell(node) {
  return node.kind === "cell";
}

function gateKind(node) {
  return node.gateKind || "blackbox";
}
