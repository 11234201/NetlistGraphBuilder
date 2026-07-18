import assert from "node:assert/strict";
import test from "node:test";
import { analyzeGraphCone, createConeGraph } from "../../src/analysis/graphCone.js";
import { normalizeGraphAliases } from "../../src/analysis/aliasNormalizer.js";
import { inspectGraphNet, inspectGraphNode } from "../../src/analysis/graphInspector.js";
import { buildSchematicGraph } from "../../src/netlist/graph.js";
import { parseVerilog } from "../../src/parser/verilogParser.js";
import { renderObjectDetails } from "../../src/ui/objectDetailsPanel.js";

const source = `module m(a, y1, y2);
input a; output y1; output y2; wire n;
BUF u0 (.A(a), .Z(n));
BUF u1 (.A(n), .Z(y1));
BUF u2 (.A(n), .Z(y2));
endmodule`;

test("graph inspector reports cell pin nets and connected endpoints", () => {
  const graph = buildSchematicGraph(parseVerilog(source).modules[0]);
  const node = graph.nodes.find((item) => item.id === "cell:u0");
  const inspection = inspectGraphNode(graph, node);
  const input = inspection.connections.find((connection) => connection.pin === "A");
  const output = inspection.connections.find((connection) => connection.pin === "Z");

  assert.equal(input.net, "a");
  assert.equal(input.peers, "a.a");
  assert.deepEqual(input.netTarget, { kind: "net", name: "a", label: "a" });
  assert.deepEqual(input.peerTargets, [{ kind: "node", id: "input:a", label: "a.a" }]);
  assert.equal(output.net, "n");
  assert.match(output.peers, /u1\.A/);
  assert.match(output.peers, /u2\.A/);
  assert.deepEqual(inspection.traversal[0].immediate, ["a"]);
  assert.deepEqual(inspection.traversal[0].immediateTargets, [
    { kind: "node", id: "input:a", label: "a" }
  ]);
  assert.equal(inspection.traversal[1].transitiveCount, 4);
});

test("graph inspector reports net driver, loads, and escaped HTML", () => {
  const graph = buildSchematicGraph(parseVerilog(source).modules[0]);
  const inspection = inspectGraphNet(graph, "n");
  const html = renderObjectDetails({
    ...inspection,
    connections: [...inspection.connections, { pin: "<P>", direction: "input", net: "a&b", peers: "u<0>" }]
  });

  assert.deepEqual(inspection.summary.at(-1), ["Fanout", 2]);
  assert.match(inspection.summary[2][1], /u0\.Z/);
  assert.match(inspection.summary[3][1], /u1\.A/);
  assert.match(html, /Connections/);
  assert.match(html, /data-selection-target-kind="net"/);
  assert.match(html, /data-selection-target-id="cell:u0"/);
  assert.match(html, /&lt;P&gt;/);
  assert.match(html, /a&amp;b/);
});

test("graph cone supports immediate, depth-limited, and transitive traversal", () => {
  const graph = buildSchematicGraph(parseVerilog(source).modules[0]);
  const immediate = analyzeGraphCone(graph, "input:a", { direction: "fanout", maxDepth: 1 });
  const limited = analyzeGraphCone(graph, "input:a", { direction: "fanout", maxDepth: 2 });
  const transitive = analyzeGraphCone(graph, "output:y1", { direction: "fanin" });

  assert.deepEqual(immediate.immediateNodeIds, ["cell:u0"]);
  assert.equal(immediate.nodeIds.length, 2);
  assert.equal(limited.nodeIds.length, 4);
  assert.deepEqual(new Set(transitive.nodeIds), new Set(["input:a", "cell:u0", "cell:u1", "output:y1"]));
  assert.equal(transitive.maxDepthReached, 3);
});

test("graph cone terminates on cycles and keeps shortest node depth", () => {
  const graph = {
    nodes: ["a", "b", "c"].map((id) => ({ id })),
    edges: [
      { id: "ab", source: "a", target: "b" },
      { id: "bc", source: "b", target: "c" },
      { id: "ca", source: "c", target: "a" }
    ]
  };
  const cone = analyzeGraphCone(graph, "a", { direction: "fanout" });

  assert.deepEqual(cone.nodeIds, ["a", "b", "c"]);
  assert.equal(cone.depthByNode.get("a"), 0);
  assert.equal(cone.depthByNode.get("c"), 2);
});

test("cone graph keeps graph metadata while filtering nodes and edges", () => {
  const graph = buildSchematicGraph(parseVerilog(source).modules[0]);
  const cone = createConeGraph(graph, "output:y1", { direction: "fanin", maxDepth: 2 });

  assert.equal(cone.moduleName, "m");
  assert.deepEqual(new Set(cone.nodes.map((node) => node.id)), new Set(["cell:u0", "cell:u1", "output:y1"]));
  assert.ok(cone.edges.every((edge) => cone.nodes.some((node) => node.id === edge.source)));
  assert.deepEqual(cone.view, { mode: "fanin", rootNodeId: "output:y1", maxDepth: 2 });
});

test("alias normalization collapses assign chains without changing parser IR", () => {
  const aliasSource = `module aliases(a, y); input a; output y; wire n1; wire n2;
assign n1 = a; assign n2 = n1; assign y = n2; endmodule`;
  const module = parseVerilog(aliasSource).modules[0];
  const graph = buildSchematicGraph(module);
  const normalized = normalizeGraphAliases(graph, { showAliases: false });

  assert.equal(module.assigns.length, 3);
  assert.equal(normalized.nodes.some((node) => node.kind === "assign"), false);
  assert.equal(normalized.aliases.length, 3);
  assert.equal(normalized.edges.length, 1);
  assert.equal(normalized.edges[0].source, "input:a");
  assert.equal(normalized.edges[0].target, "output:y");
  assert.equal(normalized.edges[0].net, "y");
  assert.equal(normalized.edges[0].collapsedAliasNodeIds.length, 3);
});

test("alias normalization can preserve explicit assign nodes", () => {
  const graph = buildSchematicGraph(parseVerilog("module m(a,y); input a; output y; assign y=a; endmodule").modules[0]);
  const aliasNode = graph.nodes.find((node) => node.kind === "assign");

  assert.equal(aliasNode.gateKind, "alias");
  assert.equal(aliasNode.title, "ALIAS");
  assert.equal(normalizeGraphAliases(graph, { showAliases: true }), graph);
});

test("alias normalization never removes instantiated buffer cells", () => {
  const sourceWithBuffer = "module m(a,y); input a; output y; wire n; BUF u0 (.A(a), .Z(n)); assign y=n; endmodule";
  const graph = buildSchematicGraph(parseVerilog(sourceWithBuffer).modules[0]);
  const normalized = normalizeGraphAliases(graph, { showAliases: false });

  assert.ok(normalized.nodes.some((node) => node.id === "cell:u0" && node.gateKind === "buf"));
  assert.equal(normalized.nodes.some((node) => node.kind === "assign"), false);
});

test("alias normalization preserves unresolved cyclic aliases", () => {
  const graph = {
    nodes: [
      { id: "assign:a", kind: "assign", ref: { lhs: "a", rhs: "b" } },
      { id: "assign:b", kind: "assign", ref: { lhs: "b", rhs: "a" } }
    ],
    edges: [
      { id: "ab", source: "assign:a", target: "assign:b" },
      { id: "ba", source: "assign:b", target: "assign:a" }
    ]
  };
  const normalized = normalizeGraphAliases(graph, { showAliases: false });

  assert.equal(normalized.aliasNormalizationSkipped, true);
  assert.equal(normalized.nodes.length, 2);
  assert.equal(normalized.edges.length, 2);
});
