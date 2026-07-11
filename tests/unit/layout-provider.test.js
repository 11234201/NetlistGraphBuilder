import assert from "node:assert/strict";
import test from "node:test";
import {
  getLayoutProvider,
  listLayoutProviders,
  SIMPLE_LAYOUT_PROVIDER_ID,
  SimpleLayeredLayoutProvider
} from "../../src/layout/layoutProvider.js";

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
  assert.deepEqual(listLayoutProviders(), [
    { id: SIMPLE_LAYOUT_PROVIDER_ID, label: "Simple Layered" }
  ]);
  assert.equal(getLayoutProvider("missing").id, SIMPLE_LAYOUT_PROVIDER_ID);
});

