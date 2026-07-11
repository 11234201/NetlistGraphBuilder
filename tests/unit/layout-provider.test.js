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
  let elkInput;
  const provider = new ElkLayoutProvider({
    elkFactory: () => ({
      layout: async (input) => {
        elkInput = input;
        return ({
        ...input,
        width: 500,
        height: 200,
        children: input.children.map((child, index) => ({ ...child, x: index * 250, y: 50 })),
        edges: input.edges.map((edge) => ({
          ...edge,
          sections: [{ startPoint: { x: 100, y: 70 }, bendPoints: [], endPoint: { x: 250, y: 70 } }]
        }))
        });
      }
    })
  });
  const positioned = await provider.layout(graph, {
    nodePositions: new Map([["output:y", { x: 420, y: 140 }]])
  });
  assert.equal(positioned.layoutProvider, ELK_LAYOUT_PROVIDER_ID);
  assert.equal(positioned.nodes.find((node) => node.id === "output:y").x, 420);
  assert.equal(positioned.edges[0].routeKind, "positioned-override");
  assert.ok(positioned.edges[0].points.length >= 2);
  assert.ok(elkInput.children.every((child) => child.ports.length > 0));
  assert.match(elkInput.edges[0].sources[0], /::output:/);
  assert.match(elkInput.edges[0].targets[0], /::input:/);
});

test("ELK fanout edges share the exact source pin instead of splitting on the node border", async () => {
  const fanoutGraph = {
    ...graph,
    nodes: [
      {
        id: "cell:u0",
        kind: "cell",
        label: "u0",
        gateKind: "buffer",
        ref: { pins: [{ pin: "A", net: "a" }, { pin: "ZN", net: "n" }] },
        pinDirections: { A: { direction: "input" }, ZN: { direction: "output" } }
      },
      { id: "output:y0", kind: "output", label: "y0", ref: { name: "y0" } },
      { id: "output:y1", kind: "output", label: "y1", ref: { name: "y1" } }
    ],
    edges: [
      { id: "e0", source: "cell:u0", sourcePin: "ZN", target: "output:y0", targetPin: "y0", net: "n" },
      { id: "e1", source: "cell:u0", sourcePin: "ZN", target: "output:y1", targetPin: "y1", net: "n" }
    ]
  };
  const provider = new ElkLayoutProvider({
    elkFactory: () => ({
      layout: async (input) => ({
        ...input,
        width: 600,
        height: 240,
        children: input.children.map((child, index) => ({ ...child, x: index ? 450 : 50, y: index * 90 })),
        edges: input.edges.map((edge, index) => ({
          ...edge,
          sections: [{
            startPoint: { x: 180, y: 45 + index * 30 },
            bendPoints: [{ x: 320, y: 45 + index * 30 }],
            endPoint: { x: 450, y: 18 + index * 90 }
          }]
        }))
      })
    })
  });

  const positioned = await provider.layout(fanoutGraph);
  assert.deepEqual(positioned.edges[0].points[0], positioned.edges[1].points[0]);
  assert.deepEqual(positioned.edges[0].points[1], positioned.edges[1].points[1]);
  assert.equal(positioned.edges[0].points[0].y, 36);
});
