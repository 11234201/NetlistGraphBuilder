import { readFile } from "node:fs/promises";
import { buildModuleWorkspace } from "../src/app/moduleWorkspace.js";
import { SimpleLayeredLayoutProvider } from "../src/layout/layoutProvider.js";
import { parseVerilog } from "../src/parser/verilogParser.js";

// Measures how far the current layering is from a *proper* layering, i.e. one
// where every edge connects nodes in adjacent columns. Columns are the levels
// that actually contain nodes, because `computeLevelXs` only allocates an x
// coordinate for those levels.

const source = await readFile(
  new URL("../tests/fixtures/mapped/equal/eq_012_mapped.v", import.meta.url),
  "utf8"
);
const design = parseVerilog(source);
const module = design.modules.find((item) => item.name === "tc") || design.modules[0];
const argumentsList = process.argv.slice(2);
const focusCell = readArgument(argumentsList, "--focus-cell=", null);
const focusNet = readArgument(argumentsList, "--focus-net=", null);
const fallbackDepth = focusCell ? 3 : 1;
const faninDepth = readNumber(argumentsList, "--fanin-depth=", fallbackDepth);
const fanoutDepth = readNumber(argumentsList, "--fanout-depth=", fallbackDepth);

const workspace = await buildModuleWorkspace({
  module,
  viewMode: "focused",
  ...(focusCell
    ? { focusedRootNodeIds: [`cell:${focusCell}`] }
    : { focusedRootNetIds: [focusNet || "clk"] }),
  faninDepth,
  fanoutDepth,
  useFanoutHubs: true,
  collapseLargeGroups: false,
  layoutProvider: new SimpleLayeredLayoutProvider()
});

const graph = workspace.graph;
const levels = new Map();
for (const node of graph.nodes) {
  if (Number.isFinite(node.level)) levels.set(node.id, node.level);
}
const levelsWithNodes = [...new Set(levels.values())].sort((left, right) => left - right);
const columnOf = new Map(levelsWithNodes.map((level, index) => [level, index]));

const spanHistogram = new Map();
const columnSpanHistogram = new Map();
let multiColumn = 0;
let multiLevel = 0;
let counted = 0;
for (const edge of graph.edges) {
  const from = levels.get(edge.source);
  const to = levels.get(edge.target);
  if (from === undefined || to === undefined) continue;
  counted += 1;
  const levelSpan = to - from;
  const columnSpan = (columnOf.get(to) ?? 0) - (columnOf.get(from) ?? 0);
  spanHistogram.set(levelSpan, (spanHistogram.get(levelSpan) || 0) + 1);
  columnSpanHistogram.set(columnSpan, (columnSpanHistogram.get(columnSpan) || 0) + 1);
  if (levelSpan > 1) multiLevel += 1;
  if (columnSpan > 1) multiColumn += 1;
}

const nodesPerColumn = levelsWithNodes.map((level) => {
  let count = 0;
  for (const value of levels.values()) if (value === level) count += 1;
  return count;
});

console.log(JSON.stringify({
  focus: focusCell ? `cell:${focusCell}` : `net:${focusNet || "clk"}`,
  faninDepth,
  fanoutDepth,
  nodes: graph.nodes.length,
  edges: graph.edges.length,
  countedEdges: counted,
  columnCount: levelsWithNodes.length,
  levelNumbers: levelsWithNodes,
  nodesPerColumn,
  levelSpanHistogram: sortEntries(spanHistogram),
  columnSpanHistogram: sortEntries(columnSpanHistogram),
  multiLevelEdgeCount: multiLevel,
  multiColumnEdgeCount: multiColumn,
  multiColumnEdgeRatio: counted > 0 ? Number((multiColumn / counted).toFixed(4)) : 0,
  requiredDummyNodes: totalDummyNodes(columnSpanHistogram)
}, null, 2));

function totalDummyNodes(histogram) {
  let total = 0;
  for (const [span, count] of histogram) {
    if (span > 1) total += (span - 1) * count;
  }
  return total;
}

function sortEntries(map) {
  return [...map.entries()].sort((left, right) => left[0] - right[0]);
}

function readArgument(list, prefix, fallback) {
  const value = list.find((item) => item.startsWith(prefix))?.slice(prefix.length).trim();
  return value || fallback;
}

function readNumber(list, prefix, fallback) {
  const value = Number(readArgument(list, prefix, ""));
  return Number.isFinite(value) ? value : fallback;
}
