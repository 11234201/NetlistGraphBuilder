import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  applyWorkspaceGraphTransforms,
  selectWorkspaceGraphView
} from "../../src/app/graphWorkspace.js";
import { buildSchematicGraph } from "../../src/netlist/graph.js";
import { layoutGraph } from "../../src/layout/simpleLayered.js";
import { analyzeLayoutQuality } from "../../src/layout/layoutQuality.js";
import { validateLayoutGraph } from "../../src/layout/layoutValidator.js";
import { DEFAULT_ROUTING_GEOMETRY } from "../../src/layout/channelCapacity.js";
import { getConnectionPoint } from "../../src/layout/nodeGeometry.js";
import { parseVerilog } from "../../src/parser/verilogParser.js";
import {
  collinearSegmentsOverlap,
  getRouteSegments,
  parallelSegmentsOverlap
} from "../../src/layout/orthogonalRouting.js";

const fixtureUrl = new URL("../fixtures/mapped/equal/eq_012_mapped.v", import.meta.url);
const spacingMatrix = [4, 8, 16, 32, 64, 84, 88, 160, 320];

test("eq012 terminal DFF outputs stay on local direct rows at spacing 88", async () => {
  const source = await readFile(fixtureUrl, "utf8");
  const design = parseVerilog(source);
  const module = design.modules.find((item) => item.name === "tc") || design.modules[0];
  const graph = applyWorkspaceGraphTransforms(selectWorkspaceGraphView(buildSchematicGraph(module), {
    viewMode: "focused",
    rootNodeIds: ["cell:_1471_", "cell:_1746_"],
    faninDepth: 3,
    fanoutDepth: 3
  }), { collapseLargeGroups: false });
  const fanoutByPhysicalNet = new Map();
  for (const edge of graph.edges) {
    const key = `${edge.source}\u0000${edge.net}`;
    fanoutByPhysicalNet.set(key, (fanoutByPhysicalNet.get(key) || 0) + 1);
  }
  const nodeById = new Map(graph.nodes.map((node) => [node.id, node]));
  const terminalEdgeIds = new Set(graph.edges.filter((edge) =>
    nodeById.get(edge.source)?.kind === "cell" &&
    nodeById.get(edge.target)?.kind === "focus-output" &&
    fanoutByPhysicalNet.get(`${edge.source}\u0000${edge.net}`) === 1
  ).map((edge) => edge.id));
  assert.ok(terminalEdgeIds.size > 100);

  const laidOut = layoutGraph(graph, {
    layoutPolicy: {
      spacing: { cellSpacing: 88 },
      features: {
        longEdgeDummies: false,
        physicalCarrierRouting: false,
        routingDrivenLayerSpacing: false
      }
    }
  });
  const laidOutNodes = new Map(laidOut.nodes.map((node) => [node.id, node]));
  for (const edge of laidOut.edges.filter((item) => terminalEdgeIds.has(item.id))) {
    const sourcePoint = getConnectionPoint(laidOutNodes.get(edge.source), edge.sourcePin, "source");
    const targetPoint = getConnectionPoint(laidOutNodes.get(edge.target), edge.targetPin, "target");
    assert.equal(sourcePoint.y, targetPoint.y, `${edge.id} terminal row`);
    assert.notEqual(edge.routeKind, "obstacle-lane", `${edge.id} outer route`);
    assert.notEqual(edge.routeKind, "unroutable", `${edge.id} missing route`);
  }
});

test("eq012 focused dual-root routing stays locally valid across spacing", async () => {
  const source = await readFile(fixtureUrl, "utf8");
  const design = parseVerilog(source);
  const module = design.modules.find((item) => item.name === "tc") || design.modules[0];
  const focused = selectWorkspaceGraphView(buildSchematicGraph(module), {
    viewMode: "focused",
    rootNodeIds: ["cell:_2021_", "cell:_2406_"],
    faninDepth: 3,
    fanoutDepth: 3
  });
  const graph = applyWorkspaceGraphTransforms(focused, { collapseLargeGroups: true });

  for (const cellSpacing of spacingMatrix) {
    const laidOut = layoutGraph(graph, { layoutPolicy: { spacing: { cellSpacing } } });
    assert.deepEqual(validateLayoutGraph(laidOut, { checkBounds: true }), [], `spacing=${cellSpacing}`);

    const clockTo2406 = laidOut.edges.find((edge) =>
      edge.net === "clk" && edge.target === "cell:_2406_"
    );
    assert.ok(clockTo2406, `clock edge missing at spacing=${cellSpacing}`);
    assert.notEqual(clockTo2406.routeKind, "obstacle-lane", `unexpected outer lane at spacing=${cellSpacing}`);

    const clockSegments = laidOut.edges
      .filter((edge) => edge.net === "clk")
      .flatMap((edge) => getRouteSegments(edge.points, edge.net, edge.netGroupKey));
    const resetSegments = laidOut.edges
      .filter((edge) => edge.net === "rst_n")
      .flatMap((edge) => getRouteSegments(edge.points, edge.net, edge.netGroupKey));
    assert.equal(
      clockSegments.some((clock) =>
        Math.abs(clock.start.x - clock.end.x) < 0.5 &&
        resetSegments.some((reset) =>
          Math.abs(reset.start.x - reset.end.x) < 0.5 &&
          (collinearSegmentsOverlap(clock, reset) || parallelSegmentsOverlap(clock, reset))
        )
      ),
      false,
      `clk/rst_n vertical overlap at spacing=${cellSpacing}`
    );

    const clockEntrySegments = getVerticalSegments(clockTo2406.points);
    const resetTo2406 = laidOut.edges.find((edge) =>
      edge.net === "rst_n" && edge.target === "cell:_2406_"
    );
    assert.ok(resetTo2406, `reset edge missing at spacing=${cellSpacing}`);
    const resetEntrySegments = getVerticalSegments(resetTo2406.points);
    for (const clockEntry of clockEntrySegments) {
      for (const resetEntry of resetEntrySegments) {
        if (!rangesOverlap(clockEntry, resetEntry)) continue;
        assert.ok(
          Math.abs(clockEntry.x - resetEntry.x) >=
            DEFAULT_ROUTING_GEOMETRY.minimumTargetEntrySeparation,
          `target entry lanes too close at spacing=${cellSpacing}`
        );
      }
    }

    const net0179 = laidOut.edges.find((edge) => edge.net === "_0179_");
    const net0198 = laidOut.edges.find((edge) => edge.net === "_0198_");
    assert.ok(net0179 && net0198, `focused boundary nets missing at spacing=${cellSpacing}`);
    const segments0179 = getRouteSegments(net0179.points, net0179.net, net0179.netGroupKey);
    const segments0198 = getRouteSegments(net0198.points, net0198.net, net0198.netGroupKey);
    assert.equal(
      segments0179.some((left) => segments0198.some((right) => collinearSegmentsOverlap(left, right))),
      false,
      `foreign overlap at spacing=${cellSpacing}`
    );
  }
});

function getVerticalSegments(points) {
  return (points || []).slice(0, -1).flatMap((start, index) => {
    const end = points[index + 1];
    if (Math.abs(start.x - end.x) >= 0.5 || Math.abs(start.y - end.y) < 0.5) return [];
    return [{
      x: start.x,
      minimum: Math.min(start.y, end.y),
      maximum: Math.max(start.y, end.y)
    }];
  });
}

function rangesOverlap(left, right) {
  return Math.min(left.maximum, right.maximum) > Math.max(left.minimum, right.minimum) + 0.01;
}

test("eq012 clock fanout reserves each physical trunk geometry once", async () => {
  const source = await readFile(fixtureUrl, "utf8");
  const design = parseVerilog(source);
  const module = design.modules.find((item) => item.name === "tc") || design.modules[0];
  const focused = selectWorkspaceGraphView(buildSchematicGraph(module), {
    viewMode: "focused",
    rootNodeIds: ["cell:_2021_", "cell:_2406_"],
    faninDepth: 3,
    fanoutDepth: 3
  });
  const laidOut = layoutGraph(applyWorkspaceGraphTransforms(focused, { collapseLargeGroups: true }), {
    layoutPolicy: { spacing: { cellSpacing: 4 } }
  });
  const clockEdges = laidOut.edges.filter((edge) => edge.net === "clk");
  const clockRoute = laidOut.wireRoutes.find((route) => route.netGroupKey === "input:clk\u0000clk");
  assert.ok(clockEdges.length > 1);
  assert.ok(clockRoute);
  const keys = new Set((clockRoute.segments || []).map((segment) =>
    `${segment.start.x},${segment.start.y}|${segment.end.x},${segment.end.y}`
  ));
  assert.equal(keys.size, clockRoute.segments.length);
  assert.equal(clockRoute.treeFallback, false);
});

test("eq012 focused _1471_ depth 3/3 is compact and fully routable by default", async () => {
  const graph = await buildEq012FocusedGraph({
    rootNodeIds: ["cell:_1471_"],
    faninDepth: 3,
    fanoutDepth: 3
  });
  assertFocusedAcceptance(graph, { maximumWidth: 6600 });
});

async function buildEq012FocusedGraph(options) {
  const source = await readFile(fixtureUrl, "utf8");
  const design = parseVerilog(source);
  const module = design.modules.find((item) => item.name === "tc") || design.modules[0];
  const focused = selectWorkspaceGraphView(buildSchematicGraph(module), {
    viewMode: "focused",
    ...options
  });
  return layoutGraph(applyWorkspaceGraphTransforms(focused, { collapseLargeGroups: false }));
}

function assertFocusedAcceptance(graph, { maximumWidth }) {
  assert.deepEqual(validateLayoutGraph(graph, { checkBounds: true }), []);
  assert.ok(graph.width <= maximumWidth, `width ${graph.width} exceeds ${maximumWidth}`);
  assert.equal(graph.edges.some((edge) =>
    edge.routeKind === "unroutable" ||
    edge.routeStatus === "unroutable" ||
    !Array.isArray(edge.points) ||
    edge.points.length < 2
  ), false);
  const quality = analyzeLayoutQuality(graph);
  assert.equal(quality.physicalOverlapCount, 0);
}
