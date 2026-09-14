import assert from "node:assert/strict";
import test from "node:test";
import {
  analyzeFocusedNeighborhood,
  analyzeGraphCone,
  createConeGraph,
  createFocusedNeighborhoodGraph
} from "../../src/analysis/graphCone.js";
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

test("top-level hierarchical instances keep child ports in current-module connections", () => {
  const design = parseVerilog(`module child(a,y); input a; output y; BUF u0(.A(a),.Y(y)); endmodule
module top(a,y); input a; output y; child u_child(.a(a),.y(y)); endmodule`);
  const top = design.modules.find((module) => module.name === "top");
  const graph = buildSchematicGraph(top, { moduleLibrary: design.modules });
  const node = graph.nodes.find((item) => item.id === "cell:u_child");
  const inspection = inspectGraphNode(graph, node, {
    hierarchyContext: { design, currentModule: top, rootModuleName: "top", occurrencePath: [] }
  });
  const input = inspection.connections.find((connection) => connection.pin === "a");
  const html = renderObjectDetails(inspection);

  assert.deepEqual(input.peerTargets, [{ kind: "node", id: "input:a", label: "a.a" }]);
  assert.deepEqual(inspection.hierarchyConnections, []);
  assert.match(html, /Connections <span class="connection-scope-label">Current module<\/span>/);
  assert.doesNotMatch(html, /hierarchy-connection-section/);
  assert.doesNotMatch(html, /data-selection-target-module=/);
  assert.equal(graph.nodes.some((item) => item.ref?.occurrencePath?.length), false);
});

test("hierarchy connections expose only the explicit parent across a module boundary", () => {
  const design = parseVerilog(`module child(a,y); input a; output y; BUF u0(.A(a),.Y(y)); endmodule
module top(a,y); input a; output y; wire n; child u_left(.a(a),.y(n)); child u_right(.a(n),.y(y)); endmodule`);
  const top = design.modules.find((module) => module.name === "top");
  const topGraph = buildSchematicGraph(top, { moduleLibrary: design.modules });
  const topInspection = inspectGraphNet(topGraph, "n", {
    hierarchyContext: { design, currentModule: top, rootModuleName: "top", occurrencePath: [] }
  });
  assert.deepEqual(topInspection.hierarchyConnections, []);
  assert.deepEqual(
    topInspection.connections.flatMap((connection) => connection.peerTargets).map((target) => target.label),
    ["u_left.y", "u_right.a"]
  );
  assert.equal(
    topInspection.connections.some((connection) => connection.peerTargets.some((target) => target.moduleName)),
    false
  );

  const child = design.modules.find((module) => module.name === "child");
  const childGraph = buildSchematicGraph(child, { moduleLibrary: design.modules });
  const childInspection = inspectGraphNet(childGraph, "a", {
    hierarchyContext: {
      design,
      currentModule: child,
      rootModuleName: "top",
      occurrencePath: ["u_right"]
    }
  });
  assert.deepEqual(childInspection.hierarchyConnections, [{
    scope: "Parent",
    boundary: "child.a",
    portDirection: "input",
    flow: "Fanin",
    target: {
      kind: "net",
      name: "n",
      label: "top.n",
      moduleName: "top",
      rootModuleName: "top",
      occurrencePath: []
    }
  }]);

  const cellInspection = inspectGraphNode(
    childGraph,
    childGraph.nodes.find((node) => node.id === "cell:u0"),
    {
      hierarchyContext: {
        design,
        currentModule: child,
        rootModuleName: "top",
        occurrencePath: ["u_right"]
      }
    }
  );
  assert.deepEqual(cellInspection.hierarchyConnections, [
    ...childInspection.hierarchyConnections,
    {
      scope: "Parent",
      boundary: "child.y",
      portDirection: "output",
      flow: "Fanout",
      target: {
        kind: "net",
        name: "y",
        label: "top.y",
        moduleName: "top",
        rootModuleName: "top",
        occurrencePath: []
      }
    }
  ]);

  const html = renderObjectDetails(childInspection);
  assert.match(html, /Connections <span class="connection-scope-label">Current module<\/span>/);
  assert.match(html, /class="connection-section hierarchy-connection-section"/);
  assert.match(html, /Hierarchy <span class="connection-scope-label">Parent occurrence<\/span>/);
  assert.match(html, /class="hierarchy-scope-badge">Parent<\/span>/);
  assert.match(html, /data-selection-target-module="top"/);
  assert.match(html, /data-selection-target-occurrence="\[\]"/);
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

test("focused neighborhood unions independent fanin and fanout depths", () => {
  const graph = buildSchematicGraph(parseVerilog(source).modules[0]);
  const focused = analyzeFocusedNeighborhood(graph, "cell:u0", { faninDepth: 1, fanoutDepth: 2 });
  assert.deepEqual(new Set(focused.nodeIds), new Set(["input:a", "cell:u0", "cell:u1", "cell:u2", "output:y1", "output:y2"]));
  assert.equal(new Set(focused.edgeIds).size, focused.edgeIds.length);
  const fanoutOnly = createFocusedNeighborhoodGraph(graph, "cell:u0", { faninDepth: 0, fanoutDepth: 1 });
  assert.equal(fanoutOnly.nodes.some((node) => node.id === "input:a"), false);
  assert.deepEqual(fanoutOnly.view, { mode: "focused", rootNodeId: "cell:u0", faninDepth: 0, fanoutDepth: 1 });
});

test("focused neighborhood supports multiple roots with stable union and cut edges", () => {
  const graph = buildSchematicGraph(parseVerilog(source).modules[0]);
  const focused = createFocusedNeighborhoodGraph(graph, ["cell:u2", "cell:u1", "cell:u1"], {
    faninDepth: 1,
    fanoutDepth: 1,
    activeRootNodeId: "cell:u2"
  });

  assert.deepEqual(focused.view.rootNodeIds, ["cell:u1", "cell:u2"]);
  assert.equal(focused.view.rootNodeId, null);
  assert.deepEqual(
    new Set(focused.nodes.map((node) => node.id)),
    new Set(["cell:u0", "cell:u1", "cell:u2", "output:y1", "output:y2"])
  );
  assert.equal(focused.edges.length, 4);
  assert.equal(focused.focusBoundary.length, 1);
  assert.deepEqual(
    focused.nodes.filter((node) => node.isFocusedRoot).map((node) => node.id).sort(),
    ["cell:u1", "cell:u2"]
  );
  assert.equal(focused.nodes.find((node) => node.isActiveFocusedRoot)?.id, "cell:u2");

  const limited = analyzeFocusedNeighborhood(graph, ["cell:u1", "cell:u2"], {
    faninDepth: 0,
    fanoutDepth: 1
  });
  assert.deepEqual(new Set(limited.nodeIds), new Set(["cell:u1", "cell:u2", "output:y1", "output:y2"]));
  assert.deepEqual(new Set(limited.cutEdges.map((edge) => edge.net)), new Set(["n"]));
});

test("focused neighborhood accepts a net root and keeps both driver and load seeds", () => {
  const graph = buildSchematicGraph(parseVerilog(source).modules[0]);
  const focused = createFocusedNeighborhoodGraph(graph, null, {
    rootNetIds: ["n"],
    faninDepth: 1,
    fanoutDepth: 1
  });

  assert.deepEqual(focused.view.rootNetIds, ["n"]);
  assert.deepEqual(
    new Set(focused.nodes.map((node) => node.id)),
    new Set(["cell:u0", "cell:u1", "cell:u2", "input:a", "output:y1", "output:y2"])
  );
  assert.deepEqual(
    focused.nodes.filter((node) => node.isFocusedNetEndpoint).map((node) => node.id).sort(),
    ["cell:u0", "cell:u1", "cell:u2"]
  );
  assert.deepEqual(focused.view.netRootDiagnostics, [{
    net: "n", driverCount: 1, loadCount: 2, diagnostics: []
  }]);
});

test("net-focused traversal applies stable visible-node and frontier budgets", () => {
  const graph = buildSchematicGraph(parseVerilog(source).modules[0]);
  const focused = analyzeFocusedNeighborhood(graph, null, {
    rootNetIds: ["n"],
    faninDepth: 4,
    fanoutDepth: 4,
    maximumVisibleNodes: 3,
    maximumFrontier: 1
  });

  assert.equal(focused.truncated, true);
  assert.ok(focused.hiddenEndpointCount > 0);
  assert.ok(focused.nodeIds.length <= 3);
  assert.deepEqual(focused.rootNetIds, ["n"]);
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
