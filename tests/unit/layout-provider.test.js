import assert from "node:assert/strict";
import test from "node:test";
import {
  getLayoutProvider,
  listLayoutProviders,
  SIMPLE_LAYOUT_PROVIDER_ID,
  SimpleLayeredLayoutProvider
} from "../../src/layout/layoutProvider.js";
import { ELK_LAYOUT_PROVIDER_ID, ElkLayoutProvider } from "../../src/layout/elkLayoutProvider.js";

const graph = {
  moduleName: "m",
  moduleDisplayName: "m",
  nodes: [
    { id: "input:a", kind: "input", label: "a", order: 0, ref: { name: "a" } },
    { id: "output:y", kind: "output", label: "y", order: 1, ref: { name: "y" } }
  ],
  edges: [{ id: "e0", source: "input:a", target: "output:y", net: "a", label: "a" }],
  diagnostics: [],
  stats: { ports: 2, nets: 1, cells: 0, assigns: 0 }
};

test("simple layered provider exposes a stable layout contract", () => {
  const provider = new SimpleLayeredLayoutProvider();
  const positioned = provider.layout(graph);

  assert.equal(provider.id, SIMPLE_LAYOUT_PROVIDER_ID);
  assert.ok(positioned.nodes.every((node) => Number.isFinite(node.x) && Number.isFinite(node.y)));
  assert.ok(positioned.edges[0].points.length >= 2);
});

test("layout provider registry falls back to simple layered", () => {
  assert.deepEqual(listLayoutProviders().map((provider) => provider.id), [
    SIMPLE_LAYOUT_PROVIDER_ID,
    ELK_LAYOUT_PROVIDER_ID
  ]);
  assert.equal(getLayoutProvider("missing").id, SIMPLE_LAYOUT_PROVIDER_ID);
});

test("ELK provider normalizes async layout output", async () => {
  const provider = new ElkLayoutProvider({
    elkFactory: () => ({
      layout: async (input) => ({
        ...input,
        width: 500,
        height: 200,
        children: input.children.map((child, index) => ({ ...child, x: index * 250, y: 50 })),
        edges: input.edges.map((edge) => ({
          ...edge,
          sections: [{ startPoint: { x: 100, y: 70 }, bendPoints: [], endPoint: { x: 250, y: 70 } }]
        }))
      })
    })
  });
  const positioned = await provider.layout(graph);
  assert.equal(positioned.layoutProvider, ELK_LAYOUT_PROVIDER_ID);
  assert.equal(positioned.width, 500);
  assert.equal(positioned.edges[0].routeKind, "elk-orthogonal");
});
