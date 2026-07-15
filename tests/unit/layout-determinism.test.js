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
