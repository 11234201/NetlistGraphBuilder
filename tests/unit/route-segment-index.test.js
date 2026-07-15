import assert from "node:assert/strict";
import test from "node:test";
import {
  createEdgeRouteSegmentIndex,
  getEdgeRouteSegments,
  getSegmentOrientation
} from "../../src/layout/routeSegmentIndex.js";

test("edge route segments keep stable ownership metadata", () => {
  const edge = {
    id: "edge-a",
    net: "net-a",
    points: [{ x: 0, y: 10 }, { x: 50, y: 10 }, { x: 50, y: 80 }]
  };

  assert.deepEqual(getEdgeRouteSegments(edge).map((segment) => ({
    edgeId: segment.edgeId,
    segmentIndex: segment.segmentIndex,
    orientation: segment.orientation,
    net: segment.net
  })), [
    { edgeId: "edge-a", segmentIndex: 0, orientation: "horizontal", net: "net-a" },
    { edgeId: "edge-a", segmentIndex: 1, orientation: "vertical", net: "net-a" }
  ]);
});

test("edge route index supports ownership-aware spatial queries", () => {
  const edges = [{
    id: "edge-a", net: "net-a",
    points: [{ x: 0, y: 10 }, { x: 50, y: 10 }]
  }, {
    id: "edge-b", net: "net-b",
    points: [{ x: 500, y: 10 }, { x: 550, y: 10 }]
  }];
  const index = createEdgeRouteSegmentIndex(edges);

  assert.deepEqual(index.queryBox({ left: 0, right: 60, top: 0, bottom: 20 })
    .map((segment) => segment.edgeId), ["edge-a"]);
  assert.equal(getSegmentOrientation({
    start: { x: 0, y: 0 }, end: { x: 10, y: 10 }
  }), null);
});
