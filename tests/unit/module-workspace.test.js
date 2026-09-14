import assert from "node:assert/strict";
import test from "node:test";
import { buildModuleWorkspace } from "../../src/app/moduleWorkspace.js";
import { getLayoutProvider } from "../../src/layout/layoutProvider.js";
import { parseVerilog } from "../../src/parser/verilogParser.js";

const source = `module top (a, b, y); input a, b; output y; wire n;
AND2X1 u0 (.A(a), .B(b), .Y(n)); BUF u1 (.A(n), .Y(y)); endmodule`;
const hierarchySource = `module child (i, o); input i; output o; BUF u_buf (.A(i), .Y(o)); endmodule
module top_h (a, y); input a; output y; child u_child (.i(a), .o(y)); endmodule`;
const repeatedHierarchySource = `module child_r (i, o); input i; output o; BUF u_buf (.A(i), .Y(o)); endmodule
module top_r (a, y); input a; output y; wire n; child_r u_left (.i(a), .o(n)); child_r u_right (.i(n), .o(y)); endmodule`;

function build(overrides = {}) {
  const module = parseVerilog(source).modules[0];
  return buildModuleWorkspace({
    module,
    moduleLibrary: [module],
    layoutProvider: getLayoutProvider(),
    useFanoutHubs: false,
    collapseLargeGroups: false,
    ...overrides
  });
}

test("module workspace composes graph, view, layout and manual overrides", () => {
  const workspace = build({
    viewMode: "focused",
    coneRootNodeId: "output:y",
    coneDepth: 3,
    nodePositions: new Map([["cell:u0", { x: 333, y: 222 }]])
  });

  assert.ok(workspace.fullGraph.nodes.length >= workspace.graph.nodes.length);
  assert.notEqual(workspace.autoGraph.nodes.find((node) => node.id === "cell:u0").x, 333);
  assert.deepEqual(
    workspace.graph.nodes
      .filter((node) => node.id === "cell:u0")
      .map((node) => ({ x: node.x, y: node.y })),
    [{ x: 333, y: 222 }]
  );
});

test("module workspace preserves asynchronous provider boundaries", async () => {
  const provider = getLayoutProvider();
  const asyncProvider = {
    layout: (...args) => Promise.resolve(provider.layout(...args))
  };
  const workspacePromise = build({ layoutProvider: asyncProvider });

  assert.equal(typeof workspacePromise.then, "function");
  const workspace = await workspacePromise;
  assert.ok(workspace.graph.nodes.length > 0);
  assert.equal(workspace.graph, workspace.autoGraph);
});

test("module workspace applies independent Focused depths", () => {
  const rootOnly = build({
    viewMode: "focused",
    coneRootNodeId: "cell:u0",
    faninDepth: 0,
    fanoutDepth: 0
  });
  const withFanin = build({
    viewMode: "focused",
    coneRootNodeId: "cell:u0",
    faninDepth: 1,
    fanoutDepth: 0
  });

  assert.deepEqual(rootOnly.graph.view, {
    mode: "focused",
    rootNodeId: "cell:u0",
    faninDepth: 0,
    fanoutDepth: 0
  });
  assert.deepEqual(rootOnly.graph.nodes.map((node) => node.id), ["cell:u0"]);
  assert.ok(withFanin.graph.nodes.length > rootOnly.graph.nodes.length);
  assert.equal(withFanin.graph.nodes.some((node) => node.id === "cell:u1"), false);
});

test("module workspace expands an encoded net Focused root without changing the full graph", () => {
  const workspace = build({
    viewMode: "focused",
    focusedRootNodeIds: ["net:n"],
    faninDepth: 1,
    fanoutDepth: 1
  });

  assert.deepEqual(workspace.graph.view.rootNetIds, ["n"]);
  assert.equal(workspace.fullGraph.nodes.length, 5);
  assert.ok(workspace.graph.nodes.some((node) => node.isFocusedNetEndpoint));
  assert.ok(workspace.graph.edges.some((edge) => edge.net === "n"));
});

test("module workspace keeps Focused traversal inside the selected module boundary", () => {
  const design = parseVerilog(hierarchySource);
  const top = design.modules.find((module) => module.name === "top_h");
  const workspace = buildModuleWorkspace({
    module: top,
    moduleLibrary: design.modules,
    viewMode: "focused",
    hierarchyRoot: {
      rootModuleName: "top_h",
      moduleName: "top_h",
      occurrencePath: [],
      kind: "cell",
      localId: "u_child"
    },
    focusedRootNodeIds: ["cell:u_child"],
    faninDepth: 1,
    fanoutDepth: 1,
    layoutProvider: getLayoutProvider(),
    useFanoutHubs: false,
    collapseLargeGroups: false
  });
  assert.ok(workspace.graph.nodes.some((node) => node.id === "cell:u_child"));
  assert.equal(workspace.graph.nodes.some((node) => node.ref?.occurrencePath?.join("/") === "u_child"), false);
  assert.ok(workspace.graph.edges.every((edge) => edge.net));
  assert.ok(workspace.fullGraph.nodes.some((node) => node.id === "output:y"));
  assert.equal(workspace.fullGraph.nodes.some((node) => node.ref?.localId === "u_buf"), false);
});

test("module workspace does not project multiple hierarchy roots onto the canvas", () => {
  const design = parseVerilog(repeatedHierarchySource);
  const top = design.modules.find((module) => module.name === "top_r");
  const workspace = buildModuleWorkspace({
    module: top,
    moduleLibrary: design.modules,
    viewMode: "focused",
    hierarchyRoots: [
      { rootModuleName: "top_r", moduleName: "top_r", occurrencePath: [], kind: "cell", localId: "u_left" },
      { rootModuleName: "top_r", moduleName: "top_r", occurrencePath: [], kind: "cell", localId: "u_right" }
    ],
    focusedRootNodeIds: ["cell:u_left", "cell:u_right"],
    faninDepth: 1,
    fanoutDepth: 1,
    layoutProvider: getLayoutProvider(),
    useFanoutHubs: false,
    collapseLargeGroups: false
  });
  const paths = workspace.graph.nodes
    .filter((node) => node.kind === "cell" && node.ref?.localId === "u_buf")
    .map((node) => node.ref.occurrencePath.join("/"))
    .sort();
  assert.deepEqual(paths, []);
  assert.ok(workspace.graph.nodes.some((node) => node.id === "cell:u_left"));
  assert.ok(workspace.graph.nodes.some((node) => node.id === "cell:u_right"));
});
