import assert from "node:assert/strict";
import test from "node:test";
import { netlistFeature } from "../../src/domains/netlist/netlist_feature.js";
import { buildModuleWorkspace } from "../../src/app/moduleWorkspace.js";
import { getLayoutProvider } from "../../src/layout/layoutProvider.js";
import { createNetlistScene } from "../../src/domains/netlist/netlist_scene.js";
import { renderSvgScene } from "../../src/render/svg_scene_renderer.js";

const source = `module top(input a, output y, output z);
wire n; assign n=a; BUF u0 (.A(n), .Y(y)); BUF u1 (.A(n), .Y(z)); endmodule`;

for (const mode of ["whole", "focused", "search-first"]) {
  test(`domain and product share ${mode} query semantics through a real Scene`, async () => {
    const document = netlistFeature.importSource({ name: "query.v", text: source }, { documentId: "doc" });
    const original = structuredClone(document.model);
    const query = { unitId: "top", mode, rootNodeIds: ["net:n"], faninDepth: 0, fanoutDepth: 1,
      maximumVisibleNodes: 20, maximumFrontier: 20 };
    const options = { occurrencePath: ["top/instance"], showAliases: true,
      graphOverrides: { unroutedNets: ["z"] }, transforms: { useFanoutHubs: false } };
    const result = netlistFeature.queryView(document, query, options);
    const workspace = await buildModuleWorkspace({
      module: document.model.modules[0], moduleLibrary: document.model.modules,
      layoutProvider: getLayoutProvider(), ...options, useFanoutHubs: false,
      viewMode: mode, focusedRootNodeIds: query.rootNodeIds,
      faninDepth: query.faninDepth, fanoutDepth: query.fanoutDepth,
      maximumVisibleNodes: query.maximumVisibleNodes, maximumFrontier: query.maximumFrontier
    });
    assert.deepEqual(workspace.sourceGraph, result.visibleGraph);
    assert.deepEqual(document.model, original);
    const facadeScene = createNetlistScene(workspace.graph);
    assert.equal(renderSvgScene(workspace.scene), renderSvgScene(facadeScene));
    if (mode !== "search-first") {
      const node = result.visibleGraph.nodes.find((node) => node.kind === "cell");
      assert.deepEqual(result.projectionMap.get(node.id).occurrencePath, ["top/instance"]);
    }
  });
}

test("explicit net roots, budgets and legacy projection are forwarded identically", async () => {
  const document = netlistFeature.importSource({ name: "query.v", text: source });
  for (const legacy of [false, true]) {
    const query = { unitId: "top", mode: "focused", rootNetIds: ["n"], faninDepth: 0, fanoutDepth: 1,
      maximumVisibleNodes: 1, maximumFrontier: 1 };
    const options = { preserveLegacyProjection: legacy, transforms: { useFanoutHubs: false } };
    const result = netlistFeature.queryView(document, query, options);
    const workspace = await buildModuleWorkspace({
      module: document.model.modules[0], layoutProvider: getLayoutProvider(),
      preserveLegacyProjection: legacy, useFanoutHubs: false, viewMode: "focused",
      focusedRootNetIds: query.rootNetIds, faninDepth: 0, fanoutDepth: 1,
      maximumVisibleNodes: 1, maximumFrontier: 1
    });
    assert.deepEqual(workspace.sourceGraph, result.visibleGraph);
  }
});
