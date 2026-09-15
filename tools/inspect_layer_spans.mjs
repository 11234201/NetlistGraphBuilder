import { readFile } from "node:fs/promises";
import { buildModuleWorkspace } from "../src/app/moduleWorkspace.js";
import { ElkLayoutProvider } from "../src/layout/elkLayoutProvider.js";
import { SimpleLayeredLayoutProvider } from "../src/layout/layoutProvider.js";
import { assignSimpleLevels } from "../src/layout/simpleLayering.js";
import { parseVerilog } from "../src/parser/verilogParser.js";
import Elk from "../vendor/elkjs-0.11.1/lib/elk.bundled.js";

const source = await readFile(
  new URL("../tests/fixtures/mapped/equal/eq_012_mapped.v", import.meta.url),
  "utf8"
);
const design = parseVerilog(source);
const module = design.modules.find((item) => item.name === "tc") || design.modules[0];
const focusCell = process.argv[2] || "_1471_";
const depth = Number(process.argv[3] || 3);
const clusterGap = Number(process.argv[4] || 20);

const build = (provider) => buildModuleWorkspace({
  module,
  viewMode: "focused",
  focusedRootNodeIds: [`cell:${focusCell}`],
  faninDepth: depth,
  fanoutDepth: depth,
  useFanoutHubs: true,
  collapseLargeGroups: false,
  layoutProvider: provider
});

const simpleWorkspace = await build(new SimpleLayeredLayoutProvider());
const elkWorkspace = await build(new ElkLayoutProvider({ elkFactory: () => new Elk() }));

const simpleGraph = simpleWorkspace.sourceGraph || simpleWorkspace.graph;
// Measure the levels the Simple provider actually used, not a re-run of the
// layering helper, so the numbers stay comparable with the laid-out graph.
const simpleLevels = new Map(
  simpleWorkspace.graph.nodes.map((node) => [node.id, Number(node.level) || 0])
);
const simpleReport = summarize(
  "simple-layered",
  graphEdgeSpans(simpleGraph, (id) => simpleLevels.get(id)),
  simpleLevels
);

const elkGraph = elkWorkspace.graph;
const elkX = new Map(elkGraph.nodes.map((node) => [node.id, node.x]));
const distinctX = [...new Set([...elkX.values()])].sort((a, b) => a - b);
const clusterIndex = new Map();
let clusterCount = 0;
for (const [index, x] of distinctX.entries()) {
  if (index > 0 && x - distinctX[index - 1] > clusterGap) clusterCount += 1;
  clusterIndex.set(x, clusterCount);
}
const elkLevels = new Map([...elkX].map(([id, x]) => [id, clusterIndex.get(x)]));
const elkReport = summarize(
  "elk-layered",
  graphEdgeSpans(elkGraph, (id) => elkLevels.get(id)),
  elkLevels
);

console.log(JSON.stringify({
  focus: `cell:${focusCell}`,
  depth,
  clusterGap,
  nodes: simpleGraph.nodes.length,
  edges: simpleGraph.edges.length,
  providers: [simpleReport, elkReport]
}, null, 2));

function graphEdgeSpans(graph, levelOf) {
  const histogram = new Map();
  let multi = 0;
  let counted = 0;
  let totalSpan = 0;
  for (const edge of graph.edges) {
    const from = levelOf(edge.source);
    const to = levelOf(edge.target);
    if (from === undefined || to === undefined) continue;
    counted += 1;
    const span = Math.abs(to - from);
    totalSpan += span;
    if (span > 1) multi += 1;
    histogram.set(span, (histogram.get(span) || 0) + 1);
  }
  return { histogram, multi, counted, totalSpan };
}

function summarize(label, spans, levels) {
  const levelCounts = new Map();
  for (const level of levels.values()) levelCounts.set(level, (levelCounts.get(level) || 0) + 1);
  return {
    provider: label,
    layerCount: levelCounts.size,
    nodesPerLayer: [...levelCounts.entries()].sort((a, b) => a[0] - b[0]).map(([, count]) => count),
    edgesConsidered: spans.counted,
    multiLayerEdgeCount: spans.multi,
    multiLayerEdgeRatio: Number((spans.multi / Math.max(1, spans.counted)).toFixed(4)),
    totalEdgeSpan: spans.totalSpan,
    averageEdgeSpan: Number((spans.totalSpan / Math.max(1, spans.counted)).toFixed(3)),
    spanHistogram: [...spans.histogram.entries()].sort((a, b) => a[0] - b[0])
  };
}
