import { readFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import { buildModuleWorkspace } from "../src/app/moduleWorkspace.js";
import { ElkLayoutProvider } from "../src/layout/elkLayoutProvider.js";
import { SimpleLayeredLayoutProvider } from "../src/layout/layoutProvider.js";
import { analyzeLayoutQuality } from "../src/layout/layoutQuality.js";
import { validateLayoutGraph } from "../src/layout/layoutValidator.js";
import { getNetGroupKey } from "../src/layout/layoutTopology.js";
import { parseVerilog } from "../src/parser/verilogParser.js";
import Elk from "../vendor/elkjs-0.11.1/lib/elk.bundled.js";

const fixtureUrl = new URL("../tests/fixtures/mapped/equal/eq_012_mapped.v", import.meta.url);
const source = await readFile(fixtureUrl, "utf8");
const design = parseVerilog(source);
const module = design.modules.find((item) => item.name === "tc") || design.modules[0];
const argumentsList = process.argv.slice(2);
const layoutPolicy = parseLayoutPolicy(argumentsList);
const scenario = parseScenario(argumentsList, layoutPolicy);
const providers = [
  new SimpleLayeredLayoutProvider(),
  new ElkLayoutProvider({ elkFactory: () => new Elk() })
];
const reports = [];
const positionedGraphs = [];

for (const provider of providers) {
  const startedAt = performance.now();
  const workspace = await buildModuleWorkspace({
    module,
    viewMode: "focused",
    ...scenario.focusOptions,
    faninDepth: scenario.faninDepth,
    fanoutDepth: scenario.fanoutDepth,
    useFanoutHubs: true,
    collapseLargeGroups: false,
    layoutProvider: provider,
    layoutPolicy
  });
  positionedGraphs.push(workspace.graph);
  reports.push(summarizeWorkspace(provider, workspace, performance.now() - startedAt));
}

const report = {
  scenario: {
    fixture: "tests/fixtures/mapped/equal/eq_012_mapped.v",
    module: module?.name || null,
    ...scenario.reportFocus,
    faninDepth: scenario.faninDepth,
    fanoutDepth: scenario.fanoutDepth,
    useFanoutHubs: true,
    collapseLargeGroups: false,
    layoutPolicy
  },
  providers: reports,
  placementComparison: compareProviderPlacements(positionedGraphs[0], positionedGraphs[1])
};
console.log(JSON.stringify(
  argumentsList.includes("--compact") ? compactReport(report) : report,
  null,
  2
));

function compactReport(reportValue) {
  return {
    scenario: reportValue.scenario,
    providers: reportValue.providers.map((provider) => ({
      providerId: provider.providerId,
      elapsedMs: provider.elapsedMs,
      sourceGraph: provider.sourceGraph,
      positionedGraph: provider.positionedGraph,
      routingMetrics: provider.routing.metrics,
      placement: {
        nodeBounds: provider.placement.nodeBounds,
        columnCount: provider.placement.columnCount,
        verticalCenterSpread: provider.placement.verticalCenterSpread,
        meanAbsoluteColumnCenterOffset: provider.placement.meanAbsoluteColumnCenterOffset
      },
      quality: provider.quality
    })),
    placementComparison: reportValue.placementComparison
  };
}

function summarizeWorkspace(provider, workspace, elapsedMs) {
  const graph = workspace.graph;
  const violations = validateLayoutGraph(graph, { checkBounds: true });
  const missingEdges = (graph.edges || []).filter((edge) =>
    edge.routeKind === "unroutable" ||
    edge.routeStatus === "unroutable" ||
    !Array.isArray(edge.points) ||
    edge.points.length < 2
  );
  return {
    providerId: provider.id,
    providerLabel: provider.label,
    elapsedMs: round(elapsedMs),
    sourceGraph: {
      nodes: workspace.sourceGraph.nodes.length,
      edges: workspace.sourceGraph.edges.length,
      nodeKinds: countValues(workspace.sourceGraph.nodes, (node) => node.kind || "unknown"),
      largestNets: largestCounts(workspace.sourceGraph.edges, (edge) => edge.net || "unknown", 12)
    },
    positionedGraph: {
      nodes: graph.nodes.length,
      edges: graph.edges.length,
      width: round(graph.width),
      height: round(graph.height),
      layoutStatus: graph.layoutStatus || null,
      missingEdgeCount: missingEdges.length,
      missingEdgeIds: missingEdges.slice(0, 24).map((edge) => edge.id),
      missingEdgeSamples: missingEdges.slice(0, 8).map((edge) => ({
        id: edge.id,
        physicalNetKey: getNetGroupKey(edge),
        physicalNetEdges: graph.edges
          .filter((candidate) => getNetGroupKey(candidate) === getNetGroupKey(edge))
          .map((candidate) => ({
            id: candidate.id,
            source: candidate.source,
            target: candidate.target,
            routeKind: candidate.routeKind,
            routeStatus: candidate.routeStatus
          })),
        source: summarizeNode(graph.nodes.find((node) => node.id === edge.source)),
        target: summarizeNode(graph.nodes.find((node) => node.id === edge.target)),
        diagnostics: edge.routeDiagnostics || []
      })),
      providerDiagnosticCounts: countCodes(graph.providerDiagnostics || []),
      validationViolationCount: violations.length,
      validationViolationCounts: countCodes(violations),
      validationViolationSamples: violations.slice(0, 24).map((violation) => ({
        ...summarizeViolation(violation),
        edgePoints: graph.edges.find((edge) => edge.id === violation.edgeId)?.points,
        edgeRouteKind: graph.edges.find((edge) => edge.id === violation.edgeId)?.routeKind,
        nodeBox: summarizeNode(graph.nodes.find((node) => node.id === violation.nodeId))
      }))
    },
    routing: {
      metrics: graph.routingMetrics || null,
      capacity: graph.routingCapacity?.metrics || null,
      channels: summarizeCapacityChannels(graph.routingCapacity?.channels || [])
    },
    placement: summarizePlacement(graph.nodes || []),
    quality: analyzeLayoutQuality(graph)
  };
}

function summarizeNode(node) {
  if (!node) return null;
  return {
    id: node.id,
    kind: node.kind,
    level: node.level,
    x: round(node.x),
    y: round(node.y),
    width: round(node.width),
    height: round(node.height)
  };
}

function summarizeCapacityChannels(channels) {
  return channels.map((channel) => ({
    id: channel.id,
    kind: channel.kind,
    currentSpan: round(channel.currentSpan),
    requiredSpan: round(channel.requiredSpan),
    expansion: round(channel.expansion),
    demandCount: channel.demandKeys?.length || channel.demands?.length || 0,
    laneCount: channel.laneCount || 0,
    placementLaneCount: channel.placementLaneCount ?? null,
    overflowCount: channel.overflowCount || 0,
    placementOverflowCount: channel.placementOverflowCount || 0
  }));
}

function summarizePlacement(nodes) {
  if (nodes.length === 0) return {
    nodeBounds: null,
    columnCount: 0,
    verticalCenterSpread: 0,
    meanAbsoluteColumnCenterOffset: 0,
    columns: []
  };
  const top = Math.min(...nodes.map((node) => node.y));
  const bottom = Math.max(...nodes.map((node) => node.y + node.height));
  const center = (top + bottom) / 2;
  const columnNodes = new Map();
  for (const node of nodes) {
    const key = round(node.x).toFixed(3);
    if (!columnNodes.has(key)) columnNodes.set(key, []);
    columnNodes.get(key).push(node);
  }
  const columns = [...columnNodes.entries()].map(([x, members]) => {
    const columnTop = Math.min(...members.map((node) => node.y));
    const columnBottom = Math.max(...members.map((node) => node.y + node.height));
    const columnCenter = (columnTop + columnBottom) / 2;
    return {
      x: Number(x),
      nodeCount: members.length,
      top: round(columnTop),
      bottom: round(columnBottom),
      height: round(columnBottom - columnTop),
      center: round(columnCenter),
      centerOffset: round(columnCenter - center),
      nodeIdSamples: members.map((node) => node.id).sort(compareIds).slice(0, 8),
      omittedNodeIdCount: Math.max(0, members.length - 8)
    };
  }).sort((left, right) =>
    left.x - right.x || compareIds(left.nodeIdSamples[0], right.nodeIdSamples[0])
  );
  const centers = columns.map((column) => column.center);
  return {
    nodeBounds: { top: round(top), bottom: round(bottom), center: round(center) },
    columnCount: columns.length,
    verticalCenterSpread: round(Math.max(...centers) - Math.min(...centers)),
    meanAbsoluteColumnCenterOffset: round(
      columns.reduce((sum, column) => sum + Math.abs(column.centerOffset), 0) / columns.length
    ),
    columns
  };
}

function compareProviderPlacements(leftGraph, rightGraph) {
  if (!leftGraph || !rightGraph) return null;
  const leftById = new Map(leftGraph.nodes.map((node) => [node.id, node]));
  const rightById = new Map(rightGraph.nodes.map((node) => [node.id, node]));
  const kinds = [...new Set(leftGraph.nodes.map((node) => node.kind || "unknown"))].sort(compareIds);
  return Object.fromEntries(kinds.map((kind) => {
    const ids = leftGraph.nodes
      .filter((node) => (node.kind || "unknown") === kind && rightById.has(node.id))
      .map((node) => node.id);
    const leftOrder = ids.toSorted((leftId, rightId) => compareNodeCenters(
      leftById.get(leftId),
      leftById.get(rightId)
    ));
    const rightOrder = ids.toSorted((leftId, rightId) => compareNodeCenters(
      rightById.get(leftId),
      rightById.get(rightId)
    ));
    const leftRank = new Map(leftOrder.map((id, index) => [id, index]));
    const rightRank = new Map(rightOrder.map((id, index) => [id, index]));
    const rankDifferences = ids.map((id) => Math.abs(leftRank.get(id) - rightRank.get(id)));
    const squaredDifference = ids.reduce((sum, id) => {
      const difference = leftRank.get(id) - rightRank.get(id);
      return sum + difference * difference;
    }, 0);
    const count = ids.length;
    return [kind, {
      nodeCount: count,
      sameRankCount: rankDifferences.filter((difference) => difference === 0).length,
      meanAbsoluteRankDifference: round(
        rankDifferences.reduce((sum, difference) => sum + difference, 0) / Math.max(1, count)
      ),
      maximumRankDifference: Math.max(0, ...rankDifferences),
      spearmanRankCorrelation: count > 1
        ? round(1 - (6 * squaredDifference) / (count * (count * count - 1)))
        : 1
    }];
  }));
}

function compareNodeCenters(left, right) {
  const centerDifference = (left.y + left.height / 2) - (right.y + right.height / 2);
  return centerDifference || compareIds(left.id, right.id);
}

function parseLayoutPolicy(argumentsList) {
  const spacingArgument = argumentsList.find((argument) => argument.startsWith("--cell-spacing="));
  const fanoutXArgument = argumentsList.find((argument) => argument.startsWith("--fanout-x="));
  const carrierMinimumFanoutArgument = argumentsList.find((argument) =>
    argument.startsWith("--carrier-min-fanout="));
  const features = {
    ...(argumentsList.includes("--minimal-span") ? { minimalSpanLayering: true } : {}),
    ...(argumentsList.includes("--long-edge-dummies") ? { longEdgeDummies: true } : {}),
    ...(argumentsList.includes("--physical-carriers") ? { physicalCarrierRouting: true } : {}),
    ...(argumentsList.includes("--routing-driven-spacing") ? { routingDrivenLayerSpacing: true } : {})
  };
  if (!spacingArgument && !fanoutXArgument && !carrierMinimumFanoutArgument &&
    Object.keys(features).length === 0) return undefined;
  const spacing = {};
  const layering = {};
  if (spacingArgument) {
    const cellSpacing = Number(spacingArgument.slice("--cell-spacing=".length));
    if (!Number.isFinite(cellSpacing)) throw new Error("--cell-spacing must be a finite number");
    spacing.cellSpacing = cellSpacing;
  }
  if (fanoutXArgument) {
    const fanoutX = Number(fanoutXArgument.slice("--fanout-x=".length));
    if (!Number.isFinite(fanoutX)) throw new Error("--fanout-x must be a finite number");
    spacing.fanoutX = fanoutX;
  }
  if (carrierMinimumFanoutArgument) {
    const carrierMinimumFanout = Number(
      carrierMinimumFanoutArgument.slice("--carrier-min-fanout=".length)
    );
    if (!Number.isFinite(carrierMinimumFanout)) {
      throw new Error("--carrier-min-fanout must be a finite number");
    }
    layering.carrierMinimumFanout = carrierMinimumFanout;
  }
  return {
    ...(Object.keys(spacing).length > 0 ? { spacing } : {}),
    ...(Object.keys(features).length > 0 ? { features } : {}),
    ...(Object.keys(layering).length > 0 ? { layering } : {})
  };
}

function parseScenario(argumentsList, layoutPolicy) {
  const cell = parseStringArgument(argumentsList, "--focus-cell=");
  const net = parseStringArgument(argumentsList, "--focus-net=");
  if (cell && net) throw new Error("Specify only one of --focus-cell or --focus-net");
  const faninDepth = parseDepthArgument(argumentsList, "--fanin-depth=", cell ? 3 : 1);
  const fanoutDepth = parseDepthArgument(argumentsList, "--fanout-depth=", cell ? 3 : 1);
  if (cell) return {
    focusOptions: { focusedRootNodeIds: [`cell:${cell}`] },
    reportFocus: { focusedRootNodeIds: [`cell:${cell}`] },
    faninDepth,
    fanoutDepth,
    layoutPolicy
  };
  const focusedNet = net || "clk";
  return {
    focusOptions: { focusedRootNetIds: [focusedNet] },
    reportFocus: { focusedRootNetIds: [focusedNet] },
    faninDepth,
    fanoutDepth,
    layoutPolicy
  };
}

function parseStringArgument(argumentsList, prefix) {
  const argument = argumentsList.find((item) => item.startsWith(prefix));
  const value = argument?.slice(prefix.length).trim();
  return value || null;
}

function parseDepthArgument(argumentsList, prefix, fallback) {
  const argument = argumentsList.find((item) => item.startsWith(prefix));
  if (!argument) return fallback;
  const value = Number(argument.slice(prefix.length));
  if (!Number.isInteger(value) || value < 0 || value > 99) {
    throw new Error(`${prefix.slice(0, -1)} must be an integer from 0 to 99`);
  }
  return value;
}

function countCodes(items) {
  const counts = {};
  for (const item of items) {
    const code = item?.code || "unknown";
    counts[code] = (counts[code] || 0) + 1;
  }
  return counts;
}

function countValues(items, selectValue) {
  const counts = {};
  for (const item of items) {
    const value = String(selectValue(item));
    counts[value] = (counts[value] || 0) + 1;
  }
  return Object.fromEntries(Object.entries(counts).sort(([left], [right]) => compareIds(left, right)));
}

function largestCounts(items, selectValue, limit) {
  return Object.entries(countValues(items, selectValue))
    .map(([value, count]) => ({ value, count }))
    .sort((left, right) => right.count - left.count || compareIds(left.value, right.value))
    .slice(0, limit);
}

function summarizeViolation(violation) {
  return {
    code: violation?.code || "unknown",
    edgeId: violation?.edgeId || null,
    otherEdgeId: violation?.otherEdgeId || null,
    nodeId: violation?.nodeId || null,
    wireRouteId: violation?.wireRouteId || null
  };
}

function compareIds(left, right) {
  return String(left || "").localeCompare(String(right || ""));
}

function round(value) {
  return Math.round((Number(value) || 0) * 1000) / 1000;
}
