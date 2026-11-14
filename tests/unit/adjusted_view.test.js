import assert from "node:assert/strict";
import test from "node:test";
import { buildAdjustedView } from "../../src/application/adjusted_view.js";
import { buildModuleWorkspace } from "../../src/app/moduleWorkspace.js";
import { getLayoutProvider } from "../../src/layout/layoutProvider.js";
import { parseVerilog } from "../../src/parser/verilogParser.js";
import { createNetlistScene } from "../../src/domains/netlist/netlist_scene.js";
import { renderSvgScene } from "../../src/render/svg_scene_renderer.js";

test("adjustment shares automatic geometry across views without mutating it or invoking the provider", async () => {
  const provider = getLayoutProvider();
  let layoutCalls = 0;
  const workspace = await buildModuleWorkspace({
    module: parseVerilog("module top(input a, output y); BUF u (.A(a), .Y(y)); endmodule").modules[0],
    layoutProvider: { id: provider.id, layout: (...args) => { layoutCalls++; return provider.layout(...args); } }
  });
  const before = structuredClone(workspace.autoGraph);
  const node = before.nodes.find((node) => node.kind === "cell");
  const override = { nodePositions: new Map([[node.id, { x: node.x + 24, y: node.y + 40 }]]),
    nodeSizes: new Map(), createScene: createNetlistScene };
  const left = buildAdjustedView(workspace.autoGraph, override);
  const right = buildAdjustedView(workspace.autoGraph, override);
  assert.deepEqual(left.graph, right.graph);
  assert.equal(renderSvgScene(left.scene), renderSvgScene(right.scene));
  assert.deepEqual(workspace.autoGraph, before);
  assert.equal(layoutCalls, 1);
  const reset = buildAdjustedView(workspace.autoGraph, { nodePositions: new Map(), nodeSizes: new Map(), createScene: createNetlistScene });
  assert.deepEqual(reset.graph.nodes, workspace.autoGraph.nodes);
});
