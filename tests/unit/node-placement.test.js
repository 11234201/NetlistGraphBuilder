import assert from "node:assert/strict";
import test from "node:test";
import { alignSingleConnectionEndpoints } from "../../src/layout/nodeAlignment.js";
import { applySingleFanoutInputLocality } from "../../src/layout/nodeLocality.js";
import { findNearestFreeY } from "../../src/layout/nodePlacementShared.js";
import { resolveLevelOverlaps } from "../../src/layout/nodeSpacing.js";

test("single-connection endpoint alignment uses the actual target pin", () => {
  const nodes = [
    {
      id: "input:a", kind: "input", x: 0, y: 0, width: 40, height: 20,
      ports: [{ id: "a", pin: "a", direction: "output", x: 40, y: 10, side: "right" }]
    },
    {
      id: "cell:u0", kind: "cell", x: 100, y: 80, width: 80, height: 60,
      ports: [{ id: "A", pin: "A", direction: "input", x: 0, y: 42, side: "left" }]
    }
  ];
  const edge = { id: "a-u0", source: "input:a", target: "cell:u0", sourcePin: "a", targetPin: "A" };
  const layoutIntent = { getEdge: () => ({ fanout: 1 }) };

  alignSingleConnectionEndpoints(nodes, [edge], layoutIntent);

  assert.equal(nodes[0].y, 112);
});

test("input locality handles vertical target pins without side-entry heuristics", () => {
  const nodes = [
    {
      id: "input:s", kind: "input", x: 0, y: 0, width: 40, height: 20, ports: [
        { id: "s", pin: "s", direction: "output", x: 40, y: 10, side: "right" }
      ]
    },
    {
      id: "cell:mux", kind: "cell", x: 180, y: 100, width: 100, height: 80, ports: [
        { id: "S", pin: "S", direction: "input", x: 50, y: 0, side: "top" }
      ]
    }
  ];
  const edge = { source: "input:s", target: "cell:mux", sourcePin: "s", targetPin: "S", net: "s" };

  applySingleFanoutInputLocality(nodes, [edge], 16);

  assert.deepEqual({ x: nodes[0].x, y: nodes[0].y }, { x: 190, y: 68 });
});

test("spacing helpers choose local free slots and preserve level separation", () => {
  const moving = { id: "moving", x: 100, y: 20, width: 80, height: 40 };
  const blocker = { id: "blocker", x: 110, y: 0, width: 80, height: 40 };
  assert.equal(findNearestFreeY(moving, 20, [blocker], new Set(), 0, 12), 52);

  const nodes = [
    { id: "a", kind: "cell", label: "a", level: 1, y: 10, height: 30 },
    { id: "b", kind: "cell", label: "b", level: 1, y: 20, height: 30 }
  ];
  resolveLevelOverlaps(nodes, [1], 8, 14);
  assert.equal(nodes[0].y, 10);
  assert.equal(nodes[1].y, 54);
});
