import assert from "node:assert/strict";
import test from "node:test";
import { layoutGraph } from "../../src/layout/simpleLayered.js";
import { buildSchematicGraph } from "../../src/netlist/graph.js";
import { parseVerilog } from "../../src/parser/verilogParser.js";

test("simple layout is invariant to node and edge array order", () => {
  const source = `
    module ordered (output y, input a, b, c, s);
      wire n0, n1;
      AND2X2 u_and (.A(a), .B(b), .Y(n0));
      MUX2X1 u_mux (.A(n0), .B(c), .S(s), .Y(n1));
      BUFX2 u_buf (.A(n1), .Y(y));
    endmodule
  `;
  const graph = buildSchematicGraph(parseVerilog(source).modules[0]);
  const permuted = {
    ...graph,
    nodes: graph.nodes.toReversed(),
    edges: [...graph.edges.slice(2), ...graph.edges.slice(0, 2)].toReversed()
  };

  assert.deepEqual(normalizeLayout(layoutGraph(permuted)), normalizeLayout(layoutGraph(graph)));
});

test("feedback cycle breaking is invariant to node array order", () => {
  const nodes = ["a", "b", "c"].map((id) => ({
    id,
    kind: "cell",
    label: id,
    gateKind: "buffer",
    pinDirections: { A: { direction: "input" }, Y: { direction: "output" } },
    portDescriptors: [
      { pin: "A", rawPin: "A", direction: "input", side: "left" },
      { pin: "Y", rawPin: "Y", direction: "output", side: "right" }
    ],
    ref: { pins: [{ pin: "A", net: `in-${id}` }, { pin: "Y", net: `out-${id}` }] }
  }));
  const edges = [
    { id: "ab", source: "a", target: "b", sourcePin: "Y", targetPin: "A", net: "ab", label: "ab" },
    { id: "bc", source: "b", target: "c", sourcePin: "Y", targetPin: "A", net: "bc", label: "bc" },
    { id: "ca", source: "c", target: "a", sourcePin: "Y", targetPin: "A", net: "ca", label: "ca" }
  ];
  const graph = { moduleName: "cycle", nodes, edges };
  const reversed = { ...graph, nodes: nodes.toReversed(), edges: edges.toReversed() };

  assert.deepEqual(normalizeLayout(layoutGraph(reversed)), normalizeLayout(layoutGraph(graph)));
});

test("Whole layout reports bounded proper-layering metrics and stage timings", () => {
  const source = `
    module whole_metrics (output y, input a, b);
      wire n0, n1;
      AND2X1 u0 (.A(a), .B(b), .Y(n0));
      BUFX1 u1 (.A(n0), .Y(n1));
      XOR2X1 u2 (.A(n0), .B(n1), .Y(y));
    endmodule
  `;
  const graph = buildSchematicGraph(parseVerilog(source).modules[0]);
  const callbacks = [];
  const positioned = layoutGraph(graph, {
    layoutPolicy: {
      features: { wholeProperLayering: true },
      layering: { wholeProperLayeringMinimumNodes: 0 }
    },
    onLayoutStage: (stage, detail, timing) => callbacks.push({ stage, detail, timing })
  });

  assert.equal(positioned.layoutMetrics.layered.enabled, true);
  assert.ok(positioned.layoutMetrics.layered.dummyCount >= 1);
  assert.ok(positioned.layoutMetrics.layered.splitEdgeCount >= 1);
  assert.deepEqual(
    positioned.layoutMetrics.stages.map((entry) => entry.stage),
    callbacks.map((entry) => entry.stage)
  );
  assert.equal(positioned.layoutMetrics.stages.at(-1).stage, "validation-complete");
  assert.ok(positioned.layoutMetrics.stages.every((entry) =>
    Number.isFinite(entry.elapsedMs) && entry.elapsedMs >= 0 &&
    Number.isFinite(entry.deltaMs) && entry.deltaMs >= 0));
});

function normalizeLayout(graph) {
  return {
    width: graph.width,
    height: graph.height,
    nodes: graph.nodes.map((node) => ({
      id: node.id,
      level: node.level,
      x: node.x,
      y: node.y
    })).toSorted(compareById),
    edges: graph.edges.map((edge) => ({
      id: edge.id,
      routeKind: edge.routeKind,
      routeStrategy: edge.routeStrategy,
      points: edge.points,
      labelPoint: edge.labelPoint,
      labelAnchor: edge.labelAnchor,
      showLabel: edge.showLabel
    })).toSorted(compareById)
  };
}

function compareById(left, right) {
  return String(left.id).localeCompare(String(right.id));
}
