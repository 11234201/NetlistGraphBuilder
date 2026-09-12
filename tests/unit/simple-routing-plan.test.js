import assert from "node:assert/strict";
import test from "node:test";
import { planSimpleRouting } from "../../src/layout/simpleRoutingPlan.js";

function edge(id, net, target) {
  return {
    id,
    source: "group:source",
    target,
    sourcePin: `out_${id}`,
    targetPin: `in_${id}`,
    net
  };
}

test("long escape lanes are counted per endpoint node and preserve pin metadata", () => {
  const graph = {
    nodes: [
      { id: "group:source", kind: "group" },
      { id: "group:first", kind: "group" },
      { id: "group:second", kind: "group" }
    ],
    edges: [
      edge("z", "net_z", "group:first"),
      edge("a", "net_a", "group:first"),
      edge("b", "net_b", "group:second")
    ]
  };
  const levels = new Map([
    ["group:source", 0],
    ["group:first", 2],
    ["group:second", 2]
  ]);
  const layoutIntent = {
    getEdge(current) {
      return {
        fanout: 1,
        isPrimary: true,
        groupKey: `${current.source}\u0000${current.net}`
      };
    }
  };

  const plan = planSimpleRouting(graph, levels, layoutIntent);
  const first = plan.edges.get("a");
  const second = plan.edges.get("z");
  const otherTarget = plan.edges.get("b");

  assert.equal(first.kind, "long");
  assert.equal(first.sourceLane, 0);
  assert.equal(second.sourceLane, 2);
  assert.equal(otherTarget.sourceLane, 1);
  assert.equal(first.targetLane, 0);
  assert.equal(second.targetLane, 1);
  assert.equal(otherTarget.targetLane, 0);
  assert.equal(first.sourcePin, "out_a");
  assert.equal(first.targetPin, "in_a");
});
