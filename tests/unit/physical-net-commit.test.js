import assert from "node:assert/strict";
import test from "node:test";
import { validatePhysicalNetCommit } from "../../src/layout/physical_net_commit.js";

const nodes = [
  { id: "src", kind: "cell", x: 0, y: 40, width: 80, height: 32,
    ports: [{ pin: "Z", direction: "output", side: "right", x: 80, y: 16 }] },
  { id: "a", kind: "cell", x: 240, y: 0, width: 80, height: 32,
    ports: [{ pin: "A", direction: "input", side: "left", x: 0, y: 16 }] },
  { id: "b", kind: "cell", x: 240, y: 100, width: 80, height: 32,
    ports: [{ pin: "A", direction: "input", side: "left", x: 0, y: 16 }] }
];

test("physical net commit accepts one connected source-rooted tree", () => {
  const edges = [
    { id: "a", source: "src", target: "a", sourcePin: "Z", targetPin: "A", net: "n",
      points: [{ x: 80, y: 56 }, { x: 160, y: 56 }, { x: 160, y: 16 }, { x: 240, y: 16 }] },
    { id: "b", source: "src", target: "b", sourcePin: "Z", targetPin: "A", net: "n",
      points: [{ x: 80, y: 56 }, { x: 160, y: 56 }, { x: 160, y: 116 }, { x: 240, y: 116 }] }
  ];
  const result = validatePhysicalNetCommit(edges, nodes);

  assert.equal(result.status, "routed");
  assert.equal(result.wireRoute.topology, "tree");
  assert.equal(result.wireRoute.reachableTargetCount, 2);
});

test("physical net commit reuses a caller-owned node spatial index", () => {
  const edges = [
    { id: "a", source: "src", target: "a", sourcePin: "Z", targetPin: "A", net: "n",
      points: [{ x: 80, y: 56 }, { x: 160, y: 56 }, { x: 160, y: 16 }, { x: 240, y: 16 }] }
  ];
  let queries = 0;
  const nodeIndex = {
    query() {
      queries += 1;
      return [];
    }
  };

  const result = validatePhysicalNetCommit(edges, nodes, { nodeIndex });

  assert.equal(result.status, "routed");
  assert.ok(queries > 0);
});

test("physical net commit rejects a detached or disconnected branch atomically", () => {
  const edges = [
    { id: "a", source: "src", target: "a", sourcePin: "Z", targetPin: "A", net: "n",
      points: [{ x: 80, y: 56 }, { x: 160, y: 56 }, { x: 160, y: 16 }, { x: 240, y: 16 }] },
    { id: "b", source: "src", target: "b", sourcePin: "Z", targetPin: "A", net: "n",
      points: [{ x: 100, y: 56 }, { x: 160, y: 56 }, { x: 160, y: 116 }, { x: 240, y: 116 }] }
  ];
  const result = validatePhysicalNetCommit(edges, nodes);

  assert.equal(result.status, "unroutable");
  assert.ok(result.diagnostics.some((item) =>
    item.code === "detached-endpoint" || item.code === "wire-route-disconnected"));
});

test("physical net commit rejects mixed owners before geometry validation", () => {
  const result = validatePhysicalNetCommit([
    { id: "a", source: "src", target: "a", net: "n", points: [] },
    { id: "b", source: "src", target: "b", net: "m", points: [] }
  ], nodes);

  assert.equal(result.status, "unroutable");
  assert.equal(result.diagnostics[0].code, "physical-net-owner-mismatch");
});
