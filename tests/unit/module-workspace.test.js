import assert from "node:assert/strict";
import test from "node:test";
import { buildModuleWorkspace } from "../../src/app/moduleWorkspace.js";
import { getLayoutProvider } from "../../src/layout/layoutProvider.js";
import { parseVerilog } from "../../src/parser/verilogParser.js";

const source = `module top (a, b, y); input a, b; output y; wire n;
AND2X1 u0 (.A(a), .B(b), .Y(n)); BUF u1 (.A(n), .Y(y)); endmodule`;

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
    viewMode: "fanin",
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
