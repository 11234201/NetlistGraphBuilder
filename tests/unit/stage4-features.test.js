import assert from "node:assert/strict";
import test from "node:test";
import { simplifyFanoutWithHubs } from "../../src/analysis/fanoutHub.js";
import { collapseLargeGraph } from "../../src/analysis/groupCollapse.js";
import {
  createSessionSnapshot,
  loadSessionState,
  saveSessionState
} from "../../src/app/sessionState.js";
import { createSchematicRenderPlan } from "../../src/render/svgRenderer.js";

test("fanout simplification inserts a shared hub", () => {
  const graph = {
    nodes: [{ id: "source", kind: "cell" }, ...Array.from({ length: 10 }, (_, index) => ({ id: `n${index}`, kind: "cell" }))],
    edges: Array.from({ length: 10 }, (_, index) => ({ id: `e${index}`, source: "source", target: `n${index}`, net: "wide", label: "wide" }))
  };
  const simplified = simplifyFanoutWithHubs(graph, { threshold: 8 });
  assert.equal(simplified.fanoutHubCount, 1);
  assert.ok(simplified.nodes.some((node) => node.kind === "hub"));
  assert.equal(simplified.edges.filter((edge) => edge.target.startsWith("hub:")).length, 1);
});

test("small input fanout stays native unless an input threshold is requested", () => {
  const graph = {
    nodes: [
      { id: "input:a", kind: "input" },
      { id: "cell:u0", kind: "cell" },
      { id: "cell:u1", kind: "cell" }
    ],
    edges: [
      { id: "e0", source: "input:a", target: "cell:u0", net: "a", label: "a" },
      { id: "e1", source: "input:a", target: "cell:u1", net: "a", label: "a" }
    ]
  };

  assert.equal(simplifyFanoutWithHubs(graph), graph);

  const simplified = simplifyFanoutWithHubs(graph, { inputThreshold: 2 });
  const hub = simplified.nodes.find((node) => node.kind === "hub");
  assert.ok(hub);
  const hubInput = simplified.edges.find((edge) => edge.target === hub.id);
  assert.ok(hubInput);
  assert.equal(hubInput.showLabel, false);
  assert.ok(simplified.edges.filter((edge) => edge.source === hub.id).every((edge) => edge.showLabel === false));
});

test("large graph groups collapse and expand independently", () => {
  const nodes = Array.from({ length: 120 }, (_, index) => ({ id: `c${index}`, kind: "cell", label: `c${index}` }));
  const edges = nodes.slice(1).map((node, index) => ({ id: `e${index}`, source: nodes[index].id, target: node.id, net: `n${index}` }));
  const graph = { nodes, edges };
  const collapsed = collapseLargeGraph(graph, { threshold: 100, groupSize: 50 });
  const firstGroup = collapsed.nodes.find((node) => node.kind === "group");
  const expanded = collapseLargeGraph(graph, { threshold: 100, groupSize: 50, expandedGroupIds: new Set([firstGroup.id]) });
  assert.equal(collapsed.collapsedGroupCount, 3);
  assert.ok(expanded.nodes.length > collapsed.nodes.length);
  assert.equal(expanded.nodes.some((node) => node.id === "c0"), true);
});

test("session state round trips through injected storage", () => {
  const values = new Map();
  const storage = { getItem: (key) => values.get(key), setItem: (key, value) => values.set(key, value) };
  const state = {
    currentSource: "module m; endmodule",
    currentSourceLabel: "m.v",
    currentModule: { name: "m" },
    viewMode: "whole",
    coneRootNodeId: null,
    coneDepth: 4,
    showAliases: false,
    layoutProviderId: "elk-layered",
    transform: { x: 1, y: 2, scale: 3 },
    useFanoutHubs: true,
    collapseLargeGroups: true
  };
  assert.equal(saveSessionState(createSessionSnapshot(state), storage), true);
  assert.deepEqual(loadSessionState(storage).transform, state.transform);
  assert.equal(loadSessionState(storage).layoutProviderId, "elk-layered");
});

test("render plan separates edges and nodes for progressive batches", () => {
  const plan = createSchematicRenderPlan({
    moduleDisplayName: "m",
    width: 640,
    height: 420,
    nodes: [{ id: "input:a", kind: "input", label: "a", x: 10, y: 10, width: 92, height: 28, ports: [] }],
    edges: []
  });
  assert.equal(plan.nodes.length, 1);
  assert.equal(plan.edges.length, 0);
  assert.match(plan.openSvg, /schematicContent/);
});
