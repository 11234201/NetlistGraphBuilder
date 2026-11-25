import assert from "node:assert/strict";
import test from "node:test";
import {
  analyzeHierarchicalCone,
  analyzeHierarchicalCones,
  buildModuleConnectivityTemplates,
  projectHierarchicalCone,
  projectHierarchicalRenderGraph
} from "../../src/domains/netlist/hierarchy_connectivity.js";

const pin = (name, net) => ({ pin: name, pinDisplayName: name, net, netDisplayName: net });
const cell = (type, instance, pins) => ({ type, instance, instanceDisplayName: instance, pins });
const port = (name, direction) => ({ name, displayName: name, direction });
const module = (name, ports, cells = [], assigns = []) => ({
  name,
  displayName: name,
  ports,
  cells,
  assigns
});

function createDesign() {
  const leaf = module("leaf", [port("in", "input"), port("out", "output")], [
    cell("BUF_X1", "u_buf", [pin("A", "in"), pin("Z", "out")])
  ]);
  const mid = module("mid", [port("in", "input"), port("out", "output")], [
    cell("leaf", "u_leaf", [pin("in", "in"), pin("out", "out")])
  ]);
  const top = module("top", [port("din", "input"), port("dout", "output")], [
    cell("mid", "u_left", [pin("in", "din"), pin("out", "left_out")]),
    cell("mid", "u_right", [pin("in", "din"), pin("out", "dout")])
  ]);
  return { modules: [top, mid, leaf] };
}

test("hierarchical cone crosses child ports without consuming logical depth", () => {
  const design = createDesign();
  const result = analyzeHierarchicalCone(design, {
    rootModuleName: "top",
    occurrencePath: [],
    kind: "net",
    localId: "din"
  }, { direction: "fanout", fanoutDepth: 1 });

  const labels = result.nodes.map((node) => `${node.occurrencePath.join("/") || "top"}:${node.kind}:${node.localId}`);
  assert.ok(labels.includes("top:cell:u_left"));
  assert.ok(labels.includes("u_left:cell:u_leaf"));
  assert.ok(labels.includes("u_left/u_leaf:cell:u_buf"));
  assert.equal(result.truncated, false);
  assert.equal(result.diagnostics.filter((item) => item.code === "depth-limit").length, 0);
});

test("hierarchical cone crosses from a child output back to the parent load", () => {
  const result = analyzeHierarchicalCone(createDesign(), {
    rootModuleName: "top",
    moduleName: "leaf",
    occurrencePath: ["u_left", "u_leaf"],
    kind: "net",
    localId: "out"
  }, { direction: "fanout", fanoutDepth: 0 });

  const keys = result.nodes.map((node) => `${node.occurrencePath.join("/") || "top"}:${node.kind}:${node.localId}`);
  assert.ok(keys.includes("u_left/u_leaf:net:out"));
  assert.ok(keys.includes("u_left:cell:u_leaf"));
  assert.ok(keys.includes("top:cell:u_left"));
  assert.ok(keys.includes("top:cell:u_right") === false);
});

test("repeated module occurrences retain distinct identities and stable ordering", () => {
  const templates = buildModuleConnectivityTemplates(createDesign());
  const left = analyzeHierarchicalCone(createDesign(), {
    rootModuleName: "top",
    moduleName: "mid",
    occurrencePath: ["u_left"],
    kind: "net",
    localId: "in"
  }, { direction: "fanout", fanoutDepth: 0, templates });
  const right = analyzeHierarchicalCone(createDesign(), {
    rootModuleName: "top",
    moduleName: "mid",
    occurrencePath: ["u_right"],
    kind: "net",
    localId: "in"
  }, { direction: "fanout", fanoutDepth: 0, templates });

  assert.notEqual(left.nodes.find((node) => node.kind === "cell")?.id, right.nodes.find((node) => node.kind === "cell")?.id);
  assert.deepEqual(left.nodes.map((node) => node.id), [...left.nodes.map((node) => node.id)].sort());
});

test("hierarchical multi-root queries union occurrence-aware cones under one node budget", () => {
  const result = analyzeHierarchicalCones(createDesign(), [
    { rootModuleName: "top", kind: "net", localId: "din" },
    { rootModuleName: "top", kind: "net", localId: "dout" }
  ], { direction: "fanout", fanoutDepth: 0, maximumVisibleNodes: 64 });
  assert.ok(result.nodes.some((node) => node.kind === "net" && node.localId === "din"));
  assert.ok(result.nodes.some((node) => node.kind === "net" && node.localId === "dout"));
  assert.ok(result.nodes.length <= 64);
  assert.equal(result.root.roots.length, 2);
});

test("hierarchical traversal reports recursive and blackbox boundaries", () => {
  const loop = module("loop", [port("in", "input"), port("out", "output")], [
    cell("loop", "u_self", [pin("in", "in"), pin("out", "out")])
  ]);
  const top = module("top", [port("in", "input")], [
    cell("MISSING", "u_blackbox", [pin("A", "in")])
  ]);
  const loopResult = analyzeHierarchicalCone({ modules: [loop] }, {
    rootModuleName: "loop", kind: "net", localId: "out"
  }, { direction: "fanin", faninDepth: 1 });
  const blackboxResult = analyzeHierarchicalCone({ modules: [top] }, {
    rootModuleName: "top", kind: "net", localId: "in"
  }, { direction: "fanout", fanoutDepth: 1 });

  assert.ok(loopResult.diagnostics.some((item) => item.code === "recursive-cycle"));
  assert.ok(blackboxResult.diagnostics.some((item) => item.code === "blackbox"));
});

test("hierarchical traversal keeps visible nodes and frontier bounded", () => {
  const result = analyzeHierarchicalCone(createDesign(), {
    rootModuleName: "top", kind: "net", localId: "din"
  }, { direction: "fanout", maximumVisibleNodes: 2, maximumFrontier: 2 });
  assert.ok(result.nodes.length <= 2);
  assert.equal(result.truncated, true);
  assert.ok(result.hiddenNodeCount > 0);
});

test("hierarchical cone projection preserves occurrence-aware references", () => {
  const result = analyzeHierarchicalCone(createDesign(), {
    rootModuleName: "top", kind: "net", localId: "din"
  }, { direction: "fanout", fanoutDepth: 1 });
  const graph = projectHierarchicalCone(result, { documentId: "doc:hierarchy" });
  const childCell = graph.nodes.find((node) => node.kind === "cell" && node.ref.localId === "u_leaf");
  assert.ok(childCell);
  assert.deepEqual(childCell.ref.occurrencePath, ["u_left"]);
  assert.equal(graph.view.mode, "hierarchical-cone");
});

test("hierarchical projection adapts to the standard layout graph contract", () => {
  const result = analyzeHierarchicalCone(createDesign(), {
    rootModuleName: "top", kind: "net", localId: "din"
  }, { direction: "fanout", fanoutDepth: 1 });
  const graph = projectHierarchicalRenderGraph(result, { documentId: "doc:hierarchy" });
  assert.ok(graph.nodes.some((node) => node.kind === "hub"));
  assert.ok(graph.nodes.some((node) => node.kind === "cell" && node.portDescriptors.length === 2));
  assert.ok(graph.edges.every((edge) => edge.sourcePin && edge.targetPin && edge.net));
  assert.deepEqual(
    graph.nodes.find((node) => node.kind === "cell" && node.ref.localId === "u_leaf")?.ref.occurrencePath,
    ["u_left"]
  );
});

test("cell-rooted hierarchical projection keeps the entry wire connected", () => {
  const result = analyzeHierarchicalCone(createDesign(), {
    rootModuleName: "top",
    kind: "cell",
    localId: "u_left"
  }, { direction: "fanout", fanoutDepth: 0 });
  const root = result.nodes.find((node) => node.kind === "cell" && node.localId === "u_left");
  const entryNet = result.nodes.find((node) => node.kind === "net" && node.localId === "left_out");
  assert.ok(root);
  assert.ok(entryNet);
  assert.ok(result.links.some((link) => link.source === root.id && link.target === entryNet.id));
});

test("hierarchical boundary continuation keeps parent cell connected to child port net", () => {
  const result = analyzeHierarchicalCone(createDesign(), {
    rootModuleName: "top",
    kind: "cell",
    localId: "u_left"
  }, { direction: "fanin", faninDepth: 0 });
  const parent = result.nodes.find((node) => node.kind === "cell" && node.localId === "u_left" && node.occurrencePath.length === 0);
  const childNet = result.nodes.find((node) => node.kind === "net" && node.localId === "out" && node.occurrencePath.join("/") === "u_left");
  assert.ok(parent);
  assert.ok(childNet);
  assert.ok(result.links.some((link) => link.source === childNet.id && link.target === parent.id));
});

test("a child named top traces every parent concat net and projects distinct named edges", () => {
  const child = module("leaf", [port("data", "input")]);
  const root = module("root", [port("data", "input"), port("b", "input")],
    [cell("leaf", "top", [{ pin: "data", connection: { kind: "concat", items: [
      { kind: "reference", name: "data" }, { kind: "reference", name: "b" }
    ] } }])]);
  const design = { modules: [root, child] };
  const query = () => projectHierarchicalRenderGraph(analyzeHierarchicalCone(design,
    { rootModuleName: "root", moduleName: "leaf", occurrencePath: ["top"], kind: "net", localId: "data" },
    { direction: "fanin" }));
  const first = query();
  const hubs = first.nodes.filter((n) => n.kind === "hub");
  assert.deepEqual(hubs.map((n) => n.label).sort(), ["b", "data", "data"]);
  assert.equal(new Set(hubs.map((n) => n.id)).size, 3);
  assert.ok(first.edges.every((edge) => ["data", "b"].includes(edge.net)));
  assert.equal(new Set(first.edges.map((e) => e.id)).size, first.edges.length);
  design.modules.reverse();
  root.ports.reverse();
  assert.deepEqual(query(), first);
});

test("a node limit retains both depth-nine branches before depth eleven, in either input order", () => {
  const cells = ["a", "z"].flatMap((prefix) => Array.from({ length: 13 }, (_, index) =>
    cell("BUF", prefix + index, [pin("A", index ? prefix + "n" + index : "in"), pin("Y", prefix + "n" + (index + 1))])));
  const root = module("root", [port("in", "input")], cells);
  const run = () => analyzeHierarchicalCone({ modules: [root] }, { rootModuleName: "root", kind: "net", localId: "in" },
    { direction: "fanout", fanoutDepth: 13, maximumVisibleNodes: 41 });
  const first = run();
  assert.ok(first.nodes.some((n) => n.localId === "z9"));
  assert.ok(!first.nodes.some((n) => n.localId === "a11"));
  assert.ok(first.diagnostics.some((entry) => entry.code === "node-limit"));
  cells.reverse();
  assert.deepEqual(run(), first);
});

test("a 600-way frontier stays bounded and independent of instance order", () => {
  const cells = Array.from({ length: 600 }, (_, i) =>
    cell("BUF", "g" + i, [pin("A", "in"), pin("Y", "n" + i)]));
  const root = module("wide", [port("in", "input")], cells);
  const run = () => analyzeHierarchicalCone({ modules: [root] }, { rootModuleName: "wide", kind: "net", localId: "in" },
    { direction: "fanout", fanoutDepth: 2, maximumFrontier: 550, maximumVisibleNodes: 1800 });
  const first = run();
  assert.ok(first.truncated);
  assert.equal(first.diagnostics.filter((d) => d.code === "frontier-limit").length, 1);
  assert.equal(first.nodes.filter((node) => node.kind === "net").length, 551);
  cells.reverse();
  assert.deepEqual(run(), first);
});
