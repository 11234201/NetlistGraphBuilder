import assert from "node:assert/strict";
import test from "node:test";
import { summarizeControlledSinkSpacing } from "../../src/layout/layered/branchPlacementMetrics.js";

function node(id, x, y, level = undefined) {
  return { id, x, y, level, width: 60, height: 20 };
}

test("controlled sink spacing detects branch whitespace and primary order", () => {
  const nodes = [
    node("control", 0, 0, 0),
    node("p0", 100, 0, 1), node("p1", 100, 100, 1), node("p2", 100, 200, 1),
    node("s0", 200, 0, 2), node("s1", 200, 40, 2), node("s2", 200, 200, 2)
  ];
  const edges = [
    { id: "c0", source: "control", target: "s0" },
    { id: "c1", source: "control", target: "s1" },
    { id: "c2", source: "control", target: "s2" },
    { id: "d0", source: "p0", target: "s0" },
    { id: "d1", source: "p1", target: "s1" },
    { id: "d2", source: "p2", target: "s2" }
  ];
  const summary = summarizeControlledSinkSpacing(nodes, edges, {
    sharedSourceFanout: 3,
    primarySourceFanout: 1
  });

  assert.equal(summary.sinkCount, 3);
  assert.equal(summary.largeGapCount, 1);
  assert.equal(summary.maximumGap, 140);
  assert.equal(summary.columns[0].primaryOrderAgreement, 1);
  assert.deepEqual(summary.columns[0].largeGaps, [{
    afterNodeId: "s1",
    beforeNodeId: "s2",
    gap: 140
  }]);
});

test("controlled sink metrics are invariant to node and edge order", () => {
  const nodes = [
    node("control", 0, 0), node("p0", 100, 0), node("p1", 100, 100),
    node("s0", 200, 0), node("s1", 200, 80)
  ];
  const edges = [
    { id: "c0", source: "control", target: "s0" },
    { id: "c1", source: "control", target: "s1" },
    { id: "d0", source: "p0", target: "s0" },
    { id: "d1", source: "p1", target: "s1" }
  ];
  const options = { sharedSourceFanout: 2, primarySourceFanout: 1 };
  assert.deepEqual(
    summarizeControlledSinkSpacing(nodes, edges, options),
    summarizeControlledSinkSpacing(nodes.toReversed(), edges.toReversed(), options)
  );
});
