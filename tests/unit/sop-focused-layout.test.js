import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  buildWorkspaceGraph,
  selectWorkspaceGraphView
} from "../../src/app/graphWorkspace.js";
import { getConnectionPoint } from "../../src/layout/nodeGeometry.js";
import { layoutGraph } from "../../src/layout/simpleLayered.js";
import { validateLayoutGraph } from "../../src/layout/layoutValidator.js";
import { parseVerilog } from "../../src/parser/verilogParser.js";

const sop015Url = new URL("../fixtures/mapped/sop/sop_015_mapped.v", import.meta.url);
let focusedGraphPromise;

test("sop015 Focused reset input remains visibly connected to both reset DFFs", async () => {
  const laidOut = layoutGraph(await loadFocusedGraph());
  const nodeById = new Map(laidOut.nodes.map((node) => [node.id, node]));
  const resetEdges = laidOut.edges.filter((edge) => edge.net === "rst_n");

  assert.equal(resetEdges.length, 3);
  assert.deepEqual(
    resetEdges
      .filter((edge) => nodeById.get(edge.target)?.kind === "cell")
      .map((edge) => edge.target)
      .toSorted(),
    ["cell:_7049_", "cell:_7433_"]
  );
  assert.equal(
    resetEdges.filter((edge) => nodeById.get(edge.target)?.kind === "focus-output").length,
    1
  );
  for (const edge of resetEdges) {
    const source = nodeById.get(edge.source);
    const target = nodeById.get(edge.target);
    assert.deepEqual(edge.points[0], getConnectionPoint(source, edge.sourcePin, "source"));
    assert.deepEqual(edge.points.at(-1), getConnectionPoint(target, edge.targetPin, "target"));
  }
  const resetSourceY = resetEdges[0].points[0].y;
  const resetTargetYs = resetEdges.map((edge) => edge.points.at(-1).y);
  assert.ok(resetSourceY >= Math.min(...resetTargetYs));
  assert.ok(resetSourceY <= Math.max(...resetTargetYs));
  assert.deepEqual(validateLayoutGraph(laidOut), []);
});

test("sop015 cell spacing 84 keeps the secondary fanout inside its local corridor", async () => {
  const laidOut = layoutGraph(await loadFocusedGraph(), { cellSpacing: 84 });
  const edge = laidOut.edges.find((candidate) =>
    candidate.net === "_1212_" && candidate.target === "cell:_4569_");
  const endpointYs = [edge.points[0].y, edge.points.at(-1).y];
  const corridorTop = Math.min(...endpointYs);
  const corridorBottom = Math.max(...endpointYs);

  assert.equal(edge.routeKind, "obstacle-local");
  assert.ok(edge.points.every((point) =>
    point.y >= corridorTop && point.y <= corridorBottom));
  assert.deepEqual(validateLayoutGraph(laidOut), []);
});

test("sop015 Focused spacing repair is invariant to graph array order", async () => {
  const graph = await loadFocusedGraph();
  const forward = layoutGraph(graph, { cellSpacing: 84 });
  const reversed = layoutGraph({
    ...graph,
    nodes: graph.nodes.toReversed(),
    edges: graph.edges.toReversed()
  }, { cellSpacing: 84 });
  const routeFor = (layout) => layout.edges.find((edge) =>
    edge.net === "_1212_" && edge.target === "cell:_4569_");

  assert.deepEqual(routeFor(reversed).points, routeFor(forward).points);
});

async function loadFocusedGraph() {
  focusedGraphPromise ??= readFile(sop015Url, "utf8").then((source) => {
    const design = parseVerilog(source);
    const module = design.modules.find((candidate) => candidate.name === "tc");
    const fullGraph = buildWorkspaceGraph(module);
    return selectWorkspaceGraphView(fullGraph, {
      viewMode: "focused",
      rootNodeIds: ["cell:_4558_"],
      faninDepth: 3,
      fanoutDepth: 3
    });
  });
  return focusedGraphPromise;
}
