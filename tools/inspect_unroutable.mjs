import { readFile } from "node:fs/promises";
import { buildModuleWorkspace } from "../src/app/moduleWorkspace.js";
import { SimpleLayeredLayoutProvider } from "../src/layout/layoutProvider.js";
import { assignSimpleLevels } from "../src/layout/simpleLayering.js";
import { parseVerilog } from "../src/parser/verilogParser.js";

const source = await readFile(
  new URL("../tests/fixtures/mapped/equal/eq_012_mapped.v", import.meta.url),
  "utf8"
);
const design = parseVerilog(source);
const module = design.modules.find((item) => item.name === "tc") || design.modules[0];
const focusCell = process.argv[2] || "_1471_";
const depth = Number(process.argv[3] || 3);

const workspace = await buildModuleWorkspace({
  module,
  viewMode: "focused",
  focusedRootNodeIds: [`cell:${focusCell}`],
  faninDepth: depth,
  fanoutDepth: depth,
  useFanoutHubs: true,
  collapseLargeGroups: false,
  layoutProvider: new SimpleLayeredLayoutProvider()
});

const sourceGraph = workspace.sourceGraph || workspace.graph;
const levels = assignSimpleLevels(sourceGraph);
const kindById = new Map(sourceGraph.nodes.map((node) => [node.id, node.kind || "unknown"]));
const laidGraph = workspace.graph;
const nodeById = new Map(laidGraph.nodes.map((node) => [node.id, node]));

const bad = laidGraph.edges.filter((edge) =>
  edge.routeKind === "unroutable" ||
  edge.routeStatus === "unroutable" ||
  !Array.isArray(edge.points) ||
  edge.points.length < 2
);

const detail = bad.map((edge) => {
  const from = levels.get(edge.source);
  const to = levels.get(edge.target);
  const sourceNode = nodeById.get(edge.source);
  const targetNode = nodeById.get(edge.target);
  return {
    id: edge.id,
    net: edge.net || null,
    sourceKind: kindById.get(edge.source) || null,
    targetKind: kindById.get(edge.target) || null,
    levelSpan: from === undefined || to === undefined ? null : to - from,
    sourceLevel: from ?? null,
    targetLevel: to ?? null,
    sourcePoint: sourceNode ? { x: Math.round(sourceNode.x), y: Math.round(sourceNode.y) } : null,
    targetPoint: targetNode ? { x: Math.round(targetNode.x), y: Math.round(targetNode.y) } : null,
    diagnostics: edge.routeDiagnostics || null
  };
});

// How many physical nets are long (span > 1) and how many of those are unroutable.
const spanOf = new Map();
for (const edge of sourceGraph.edges) {
  const from = levels.get(edge.source);
  const to = levels.get(edge.target);
  if (from === undefined || to === undefined) continue;
  spanOf.set(edge.id, to - from);
}
const longEdges = [...spanOf.values()].filter((span) => span > 1).length;

console.log(JSON.stringify({
  focus: `cell:${focusCell}`,
  depth,
  unroutableCount: bad.length,
  unroutable: detail,
  longEdgeCount: longEdges,
  longEdgeRatio: Number((longEdges / Math.max(1, spanOf.size)).toFixed(4)),
  unroutableLongEdgeCount: detail.filter((item) => (item.levelSpan ?? 0) > 1).length
}, null, 2));
