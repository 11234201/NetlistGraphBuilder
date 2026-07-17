import { analyzeLayoutQuality, compareLayoutQuality } from "./layoutQuality.js";
import { normalizeLayoutPolicy } from "./layoutPolicy.js";

export function createLayoutGolden(graph, options = {}) {
  return {
    kind: "netlist-layout-golden",
    version: 2,
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
    })).toSorted(compareIds),
    edges: graph.edges.map((edge) => ({
      id: edge.id,
      net: edge.net,
      source: edge.source,
      target: edge.target,
      sourcePin: edge.sourcePin,
      targetPin: edge.targetPin,
      routeKind: edge.routeKind,
      routeStrategy: edge.routeStrategy,
      points: (edge.points || []).map(roundPoint),
      labelPoint: edge.labelPoint ? roundPoint(edge.labelPoint) : null,
      labelAnchor: edge.labelAnchor,
      showLabel: edge.showLabel !== false
    })).toSorted(compareIds),
    quality: analyzeLayoutQuality(graph),
    svgSnapshot: options.svgSnapshot || null
  };
}

export function parseLayoutGolden(value) {
  let golden = value;
  if (typeof value === "string") {
    try {
      golden = JSON.parse(value);
    } catch (error) {
      throw new Error(`Invalid Golden JSON: ${error.message}`);
    }
  }

  if (!isRecord(golden) || golden.kind !== "netlist-layout-golden") {
    throw new Error("Not a Netlist Graph Builder layout Golden");
  }
  const version = Number(golden.version);
  if (!Number.isInteger(version) || version < 1 || version > 2) {
    throw new Error(`Unsupported Golden version: ${golden.version ?? "missing"}`);
  }
  if (typeof golden.moduleName !== "string" || golden.moduleName.length === 0) {
    throw new Error("Golden moduleName is missing");
  }
  if (!Array.isArray(golden.nodes) || golden.nodes.length === 0) {
    throw new Error("Golden does not contain layout nodes");
  }
  return golden;
}

export function getLayoutGoldenState(value) {
  const golden = parseLayoutGolden(value);
  const nodePositions = new Map();
  const nodeSizes = new Map();

  for (const node of golden.nodes) {
    if (!isRecord(node) || typeof node.id !== "string" || node.id.length === 0) continue;
    const x = finiteNumber(node.x);
    const y = finiteNumber(node.y);
    if (x !== null && y !== null) nodePositions.set(node.id, { x, y });
    const width = finiteNumber(node.width);
    const height = finiteNumber(node.height);
    if (width !== null && height !== null) nodeSizes.set(node.id, { width, height });
  }
  if (nodePositions.size === 0) {
    throw new Error("Golden does not contain valid node positions");
  }

  const layoutOptions = isRecord(golden.layoutOptions) ? golden.layoutOptions : {};
  const display = isRecord(layoutOptions.display) ? layoutOptions.display : {};
  const graphOverrides = isRecord(layoutOptions.graphOverrides)
    ? layoutOptions.graphOverrides
    : {};

  return {
    golden,
    moduleName: golden.moduleName,
    nodePositions,
    nodeSizes,
    layoutPolicy: isRecord(layoutOptions.layoutPolicy)
      ? normalizeLayoutPolicy(layoutOptions.layoutPolicy)
      : null,
    graphOverrides: {
      nodeProperties: cloneJsonRecord(graphOverrides.nodeProperties),
      cellPinDirections: cloneJsonRecord(graphOverrides.cellPinDirections)
    },
    timingBadgeChoices: cloneJsonRecord(layoutOptions.timingBadgeChoices),
    timingBadgePositions: cloneStringRecord(layoutOptions.timingBadgePositions),
    display: {
      viewMode: normalizeViewMode(display.viewMode),
      coneRootNodeId: typeof display.coneRootNodeId === "string" ? display.coneRootNodeId : null,
      coneDepth: positiveInteger(display.coneDepth),
      useFanoutHubs: optionalBoolean(display.useFanoutHubs),
      collapseLargeGroups: optionalBoolean(display.collapseLargeGroups),
      expandedGroupIds: Array.isArray(display.expandedGroupIds)
        ? new Set(display.expandedGroupIds.filter((id) => typeof id === "string"))
        : null
    }
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
  const changedEdges = compareRoutes(baseGraph?.edges || [], adjustedGraph?.edges || []);

  return {
    movedNodeCount: movedNodes.length,
    maxMove: movedNodes[0]?.distance || 0,
    averageMove: round(
      movedNodes.reduce((sum, item) => sum + item.distance, 0) / Math.max(1, movedNodes.length)
    ),
    sameLevelOrderChanges: compareSameLevelOrder(baseGraph, adjustedGraph),
    changedEdgeCount: changedEdges.length,
    changedEdges,
    quality: compareLayoutQuality(baseGraph, adjustedGraph),
    movedNodes
  };
}

function compareRoutes(baseEdges, adjustedEdges) {
  const baseById = new Map(baseEdges.map((edge) => [edge.id, edge]));
  const changes = [];
  for (const edge of adjustedEdges) {
    const base = baseById.get(edge.id);
    if (!base) continue;
    const before = routeSignature(base);
    const after = routeSignature(edge);
    if (before === after) continue;
    changes.push({
      id: edge.id,
      net: edge.net,
      before: routeSummary(base),
      after: routeSummary(edge)
    });
  }
  return changes.toSorted(compareIds);
}

function routeSignature(edge) {
  return JSON.stringify({
    kind: edge.routeKind,
    strategy: edge.routeStrategy,
    points: (edge.points || []).map(roundPoint),
    labelPoint: edge.labelPoint ? roundPoint(edge.labelPoint) : null,
    labelAnchor: edge.labelAnchor,
    showLabel: edge.showLabel !== false
  });
}

function routeSummary(edge) {
  return {
    routeKind: edge.routeKind,
    routeStrategy: edge.routeStrategy,
    bends: Math.max(0, (edge.points?.length || 0) - 2),
    points: (edge.points || []).map(roundPoint),
    showLabel: edge.showLabel !== false
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

function compareIds(left, right) {
  return String(left.id || "").localeCompare(String(right.id || ""));
}

function roundPoint(point) {
  return { x: round(point.x), y: round(point.y) };
}

function round(value) {
  return Math.round(value * 10) / 10;
}

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function finiteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function positiveInteger(value) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
}

function optionalBoolean(value) {
  return typeof value === "boolean" ? value : null;
}

function normalizeViewMode(value) {
  return ["whole", "fanin", "fanout"].includes(value) ? value : null;
}

function cloneJsonRecord(value) {
  if (!isRecord(value)) return {};
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, cloneJsonValue(item)]));
}

function cloneJsonValue(value) {
  if (Array.isArray(value)) return value.map(cloneJsonValue);
  if (isRecord(value)) return cloneJsonRecord(value);
  return value;
}

function cloneStringRecord(value) {
  if (!isRecord(value)) return {};
  return Object.fromEntries(
    Object.entries(value).filter(([, item]) => typeof item === "string")
  );
}
