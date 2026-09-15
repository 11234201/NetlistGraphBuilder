import { assignSimpleLevels, orderSimpleLayers } from "../simpleLayering.js";
import { orientCyclesForLayering } from "./cycle_breaking.js";
import { addDummyNodesToBuckets, buildLongEdgeChains } from "./longEdgeDummies.js";
import { relaxToMinimalSpan } from "./minSpanLayering.js";
import { buildPhysicalNetCarriers } from "./physical_net_carriers.js";
import { orderPhysicalNetCarriers } from "./carrier_ordering.js";

export function buildLayeredGraph(graph = {}, options = {}) {
  const oriented = orientCyclesForLayering(graph);
  const constrainedEdges = oriented.edges.filter((edge) => !edge.ignoredForLayering);
  const orientedGraph = { ...graph, nodes: [...(graph.nodes || [])], edges: constrainedEdges };
  const initialLevels = assignSimpleLevels(orientedGraph);
  const levels = options.minimalSpanLayering
    ? relaxToMinimalSpan(orientedGraph, initialLevels, options.layering)
    : initialLevels;
  const buckets = bucketNodes(graph.nodes || [], levels);
  const logicalChains = buildLongEdgeChains(orientedGraph, levels, options.layering);
  addDummyNodesToBuckets(buckets, logicalChains);
  const levelKeys = [...buckets.keys()].toSorted((left, right) => left - right);
  orderSimpleLayers(buckets, levelKeys, logicalChains.orderingEdges);
  const carrierView = buildPhysicalNetCarriers(orientedGraph, levels);

  const result = {
    layers: levelKeys.map((level) => ({ level, nodes: [...(buckets.get(level) || [])] })),
    levels,
    realEdges: [...(graph.edges || [])],
    orientedEdges: oriented.edges,
    logicalChains,
    carriers: carrierView.carriers,
    diagnostics: [
      ...logicalChains.diagnostics,
      ...carrierView.diagnostics,
      ...oriented.selfLoopEdgeIds.map((edgeId) => ({ code: "layered-self-loop", edgeId }))
    ]
  };
  const carrierOrder = orderPhysicalNetCarriers(result);
  result.carrierBoundaries = carrierOrder.boundaries;
  result.diagnostics.push(...carrierOrder.diagnostics);
  return result;
}

function bucketNodes(nodes, levels) {
  const buckets = new Map();
  for (const node of nodes) {
    const level = levels.get(node.id);
    if (!buckets.has(level)) buckets.set(level, []);
    buckets.get(level).push(node);
  }
  return buckets;
}
