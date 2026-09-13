import assert from "node:assert/strict";
import test from "node:test";
import {
  analyzeHierarchicalCone,
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
