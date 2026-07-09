export function createLayoutGolden(graph, options = {}) {
  return {
    kind: "netlist-layout-golden",
    version: 1,
    moduleName: graph.moduleName,
    moduleDisplayName: graph.moduleDisplayName,
    layoutOptions: { ...(options.layoutOptions || {}) },
    nodes: graph.nodes.map((node) => ({
      id: node.id,
      kind: node.kind,
      label: node.label,
      x: round(node.x),
      y: round(node.y),
      width: round(node.width),
      height: round(node.height)
    })),
    svgSnapshot: options.svgSnapshot || null
  };
}

export function compareLayoutGraphs(baseGraph, adjustedGraph) {
  const baseById = new Map((baseGraph?.nodes || []).map((node) => [node.id, node]));
  const movedNodes = [];

  for (const node of adjustedGraph?.nodes || []) {
    const base = baseById.get(node.id);
    if (!base) {
      continue;
    }
    const dx = round(node.x - base.x);
    const dy = round(node.y - base.y);
    const distance = round(Math.hypot(dx, dy));
    if (distance <= 0.5) {
      continue;
    }
    movedNodes.push({
      id: node.id,
      kind: node.kind,
      label: node.label,
      from: { x: round(base.x), y: round(base.y) },
      to: { x: round(node.x), y: round(node.y) },
      dx,
      dy,
      distance
    });
  }

  movedNodes.sort((left, right) => right.distance - left.distance);

  return {
    movedNodeCount: movedNodes.length,
    maxMove: movedNodes[0]?.distance || 0,
    averageMove: round(
      movedNodes.reduce((sum, item) => sum + item.distance, 0) / Math.max(1, movedNodes.length)
    ),
    sameLevelOrderChanges: compareSameLevelOrder(baseGraph, adjustedGraph),
    movedNodes
  };
}

function compareSameLevelOrder(baseGraph, adjustedGraph) {
  const adjustedById = new Map((adjustedGraph?.nodes || []).map((node) => [node.id, node]));
  const baseLevels = new Map();

  for (const node of baseGraph?.nodes || []) {
    const level = node.level ?? 0;
    if (!baseLevels.has(level)) {
      baseLevels.set(level, []);
    }
    baseLevels.get(level).push(node);
  }

  const changes = [];
  for (const [level, baseNodes] of baseLevels) {
    const adjustedNodes = baseNodes
      .map((node) => adjustedById.get(node.id))
      .filter(Boolean);
    if (adjustedNodes.length <= 1) {
      continue;
    }

    const baseOrder = baseNodes.toSorted(compareYThenX).map((node) => node.id);
    const adjustedOrder = adjustedNodes.toSorted(compareYThenX).map((node) => node.id);
    if (baseOrder.join("\n") === adjustedOrder.join("\n")) {
      continue;
    }
    changes.push({
      level,
      before: baseOrder,
      after: adjustedOrder
    });
  }

  return changes;
}

function compareYThenX(left, right) {
  if (left.y !== right.y) {
    return left.y - right.y;
  }
  return left.x - right.x;
}

function round(value) {
  return Math.round(value * 10) / 10;
}
