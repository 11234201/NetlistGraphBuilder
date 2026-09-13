import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  applyWorkspaceGraphTransforms,
  selectWorkspaceGraphView
} from "../../src/app/graphWorkspace.js";
import { buildSchematicGraph } from "../../src/netlist/graph.js";
import { layoutGraph } from "../../src/layout/simpleLayered.js";
import { validateLayoutGraph } from "../../src/layout/layoutValidator.js";
import { parseVerilog } from "../../src/parser/verilogParser.js";
import {
  collinearSegmentsOverlap,
  getRouteSegments,
  parallelSegmentsOverlap
} from "../../src/layout/orthogonalRouting.js";

const fixtureUrl = new URL("../fixtures/mapped/equal/eq_012_mapped.v", import.meta.url);
const spacingMatrix = [4, 8, 16, 32, 64, 84, 88, 160, 320];

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
