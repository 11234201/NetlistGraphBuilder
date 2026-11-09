import assert from "node:assert/strict";
import test from "node:test";
import { parseVerilog } from "../../src/parser/verilogParser.js";
import { buildSchematicGraph } from "../../src/netlist/graph.js";
import { buildNodePorts, getPort } from "../../src/layout/nodeGeometry.js";
import { analyzeFocusedNeighborhood } from "../../src/analysis/graphCone.js";
import { simplifyFanoutWithHubs } from "../../src/analysis/fanoutHub.js";
import { alignModulePorts, analyzeGraphStats } from "../../src/analysis/moduleCompare.js";
import { createCanonicalGraph } from "../../src/layout/elk_native/ir.js";
import { layoutGraph as layoutAnchor } from "../../src/layout/elk_native/anchor.js";

test("parser rejects expression assigns instead of converting them to false aliases", () => {
  const module = parseVerilog("module m(input a,b,output y); assign y = a & b; endmodule").modules[0];
  assert.deepEqual(module.assigns, []);
  assert.match(module.diagnostics[0].message, /unsupported assign/i);
});

test("parser accepts whitespace around bit selects, adjacent comments, and repeated instances", () => {
  const module = parseVerilog(`module m(input [3:0] a,output y,z);
    BUF u(.A(a /* comment */ [2]),.Y(y)), v(.A(a[1]),.Y(z)); endmodule`).modules[0];
  assert.deepEqual(module.cells.map((cell) => cell.instance), ["u", "v"]);
  assert.deepEqual(module.cells.map((cell) => cell.pins[0].net), ["a[2]", "a[1]"]);
  assert.deepEqual(module.diagnostics, []);
});

test("graph identities are collision-free and feedback plus all drivers are retained", () => {
  const module = parseVerilog(`module m(input a,b,output y,z);
    BUF \\u/a (.A(y),.Y(y)); BUF u_a(.A(a),.Y(z)); BUF v(.A(b),.Y(y)); endmodule`).modules[0];
  const graph = buildSchematicGraph(module);
  assert.ok(graph.nodes.some((node) => node.id === "cell:u_a~u%2Fa"));
  assert.ok(graph.nodes.some((node) => node.id === "cell:u_a"));
  assert.ok(graph.edges.some((edge) => edge.source === "cell:u_a~u%2Fa" && edge.target === "cell:u_a~u%2Fa"));
  assert.equal(graph.edges.filter((edge) => edge.target === "output:y").length, 2);
  assert.ok(graph.diagnostics.some((item) => /multiple drivers/.test(item.message)));
});

test("vector slices expand and literal metadata distinguishes constants from identifier-like text", () => {
  const module = parseVerilog("module m(input [3:0] a,output x,z,y); BUF u(.A(a[2:1]),.Y(y)); endmodule").modules[0];
  const graph = buildSchematicGraph(module);
  assert.deepEqual(graph.edges.filter((edge) => edge.target === "cell:u").map((edge) => edge.net), ["a[2]", "a[1]"]);
  assert.ok(graph.nodes.some((node) => node.id === "implicit:x"));
  assert.ok(graph.nodes.some((node) => node.id === "implicit:z"));

  const literalGraph = buildSchematicGraph(parseVerilog("module c(output y); BUF u(.A('0),.Y(y)); endmodule").modules[0]);
  assert.ok(literalGraph.nodes.some((node) => node.id === "constant:_0"));

  const escapedGraph = buildSchematicGraph(parseVerilog(String.raw`module e(output y,z);
    BUF u(.A(8'shff),.Y(y)); BUF v(.A(\123 ),.Y(z)); endmodule`).modules[0]);
  assert.ok(escapedGraph.nodes.some((node) => node.id === "constant:8_shff"));
  assert.ok(escapedGraph.nodes.some((node) => node.id === "implicit:123"));
  assert.ok(!escapedGraph.nodes.some((node) => node.id === "constant:123"));
});

test("layout ports respect side groups and inout is compatible with source and target roles", () => {
  const node = { kind: "cell", portDescriptors: [
    { pin: "A", direction: "input", side: "left" },
    { pin: "IO", direction: "inout", side: "left" },
    { pin: "Y", direction: "output", side: "left" }
  ] };
  node.ports = buildNodePorts(node, { width: 128, height: 144 });
  assert.equal(new Set(node.ports.map((port) => port.y)).size, 3);
  assert.equal(getPort(node, "IO", "source").pin, "IO");
  assert.equal(getPort(node, "IO", "target").pin, "IO");
});

test("focused node budgets preserve root-connected paths", () => {
  const graph = {
    nodes: ["a", "z", "r", "b", "c"].map((id) => ({ id })),
    edges: [
      { id: "az", source: "a", target: "z" }, { id: "zr", source: "z", target: "r" },
      { id: "rb", source: "r", target: "b" }, { id: "bc", source: "b", target: "c" }
    ]
  };
  const focused = analyzeFocusedNeighborhood(graph, "r", { faninDepth: 2, fanoutDepth: 2, maximumVisibleNodes: 3 });
  assert.deepEqual(focused.nodeIds, ["z", "r", "b"]);
  assert.deepEqual(focused.edgeIds, ["zr", "rb"]);
});

test("fanout hub identity is invariant to edge order", () => {
  const graph = {
    nodes: ["s", "t", "a", "b"].map((id) => ({ id })),
    edges: [
      { id: "1", source: "s", target: "a", net: "n" }, { id: "2", source: "s", target: "b", net: "n" },
      { id: "3", source: "t", target: "a", net: "m" }, { id: "4", source: "t", target: "b", net: "m" }
    ]
  };
  const ids = (edges) => simplifyFanoutWithHubs({ ...graph, edges }, { threshold: 2 }).nodes
    .filter((node) => node.kind === "hub").map((node) => node.id);
  assert.deepEqual(ids(graph.edges), ids(graph.edges.toReversed()));
});

test("module compare checks ranges and computes deep logic iteratively", () => {
  const modules = parseVerilog("module a(input [3:0] x); endmodule module b(input [7:0] x); endmodule").modules;
  assert.equal(alignModulePorts(...modules)[0].matched, false);
  const graph = {
    nodes: Array.from({ length: 5000 }, (_, index) => ({ id: String(index), kind: "cell" })),
    edges: Array.from({ length: 4999 }, (_, index) => ({ source: String(index + 1), target: String(index) }))
  };
  assert.equal(analyzeGraphStats(graph).logicDepth, 5000);
});

test("FIXED_ORDER canonicalization is a total order for mixed declared orders", () => {
  const ports = [
    { id: "a", side: "EAST", x: 60, y: 30, order: 0 },
    { id: "b", side: "EAST", x: 60, y: 20 },
    { id: "c", side: "EAST", x: 60, y: 10, order: 1 }
  ];
  const canonical = (items) => createCanonicalGraph({
    nodes: [{ id: "n", width: 60, height: 50, ports: items, portConstraints: "FIXED_ORDER" }], edges: []
  });
  assert.deepEqual(canonical(ports), canonical([ports[1], ports[0], ports[2]]));
});

test("AnchorLayered preserves subpixel orthogonal bends through P5 and logical-edge restoration", async () => {
  for (const delta of [0.0005, 0.25]) {
    const result = await layoutAnchor({
      nodes: [
        { id: "a", width: 40, height: 30, ports: [{ id: "ao", side: "EAST", x: 40, y: 15 }] },
        { id: "b", width: 40, height: 30, ports: [
          { id: "bi", side: "WEST", x: 0, y: 15 }, { id: "bj", side: "WEST", x: 0, y: 15 + delta }
        ] }
      ],
      edges: [
        { id: "e1", physicalNetId: "n", sourcePortId: "ao", targetPortId: "bi" },
        { id: "e2", physicalNetId: "n", sourcePortId: "ao", targetPortId: "bj" }
      ]
    });
    const points = result.edges.find((edge) => edge.id === "e2").points;
    assert.ok(points.length >= 4);
    for (let index = 1; index < points.length; index += 1) {
      assert.ok(points[index - 1].x === points[index].x || points[index - 1].y === points[index].y);
    }
  }
});
