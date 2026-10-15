import assert from "node:assert/strict";
import test from "node:test";
import { BuildCanonicalGraph } from "../reference/retired_native_layered/canonical_graph.js";
import { BreakCycles } from "../reference/retired_native_layered/cycle_breaking.js";
import { AssignRanks } from "../reference/retired_native_layered/rank_assignment.js";
import { BuildProperLayering } from "../reference/retired_native_layered/proper_layering.js";
import { MinimizeCrossings } from "../reference/retired_native_layered/crossing_minimization.js";
import { PlaceAlignmentBlocks } from "../reference/retired_native_layered/block_placement.js";
import { AnalyzeAndPackStructure, OrderStructureBlocks } from "../reference/retired_native_layered/structure_packing.js";
import { RouteNativeOrthogonal } from "../reference/retired_native_layered/router/native_orthogonal_router.js";
import { ChooseFreeBridgeY } from "../reference/retired_native_layered/router/segment_splitting.js";
import { BuildTapOverlapConstraints } from "../reference/retired_native_layered/router/segment_dependencies.js";
import {
  BreakResidualCycles,
  FindCyclicComponents
} from "../reference/retired_native_layered/router/segment_cycle_breaking.js";

function SyntheticGraph() {
  return {
    nodes: [
      { id: "src", kind: "input", label: "src" },
      { id: "a", kind: "assign", label: "a" },
      { id: "b", kind: "assign", label: "b" },
      { id: "sink", kind: "output", label: "sink" }
    ],
    edges: [
      { id: "e1", source: "src", target: "a", net: "n1", sourcePin: "src", targetPin: "I" },
      { id: "e2", source: "src", target: "b", net: "n1", sourcePin: "src", targetPin: "I" },
      { id: "e3", source: "a", target: "sink", net: "n2", sourcePin: "Z", targetPin: "sink" },
      { id: "e4", source: "b", target: "sink", net: "n3", sourcePin: "Z", targetPin: "sink" }
    ]
  };
}

function Layout(graph, options = {}) {
  const model = BuildCanonicalGraph(graph, {});
  const orientation = BreakCycles(model);
  const ranking = AssignRanks(model, orientation, {});
  const proper = BuildProperLayering(model, orientation, ranking, {});
  const crossing = MinimizeCrossings(proper, {});
  const structured = OrderStructureBlocks(model, orientation, proper, crossing);
  const placement = PlaceAlignmentBlocks(proper, structured, { layerGap: 104, nodeGap: 32, margin: 40 });
  const structure = AnalyzeAndPackStructure(model, orientation, placement, { margin: 40 });
  return RouteNativeOrthogonal({
    graph,
    model,
    orientation,
    proper,
    structure,
    options: { margin: 40, ...options }
  });
}

test("native router routes every synthetic edge orthogonally", () => {
  const result = Layout(SyntheticGraph());

  assert.equal(result.diagnostics.length, 0, JSON.stringify(result.diagnostics));
  assert.equal(result.edges.length, 4);
  for (const edge of result.edges) {
    assert.ok(edge.points.length >= 2, `edge ${edge.id} has no geometry`);
    for (const point of edge.points) {
      assert.ok(point.x >= 0 && point.x <= result.width, `edge ${edge.id} x is outside the canvas`);
      assert.ok(point.y >= 0 && point.y <= result.height, `edge ${edge.id} y is outside the canvas`);
    }
    for (let index = 0; index < edge.points.length - 1; index += 1) {
      const from = edge.points[index];
      const to = edge.points[index + 1];
      const orthogonal = Math.abs(from.x - to.x) < 0.001 || Math.abs(from.y - to.y) < 0.001;
      assert.ok(orthogonal, `edge ${edge.id} segment ${index} is not orthogonal`);
    }
  }
});

test("native router shares one trunk per boundary for a fanned-out physical net", () => {
  const result = Layout(SyntheticGraph());
  const trunkXs = new Set();

  for (const edge of result.edges.filter((edge) => edge.net === "n1")) {
    const interior = edge.points.slice(1, -1).filter((point) => point.x > 0);
    for (const point of interior) trunkXs.add(Math.round(point.x));
  }

  assert.equal(result.metrics.segmentCount, 3);
  assert.ok(trunkXs.size <= 2, `expected one shared trunk x per branch, received ${[...trunkXs]}`);
});

test("native router reports slot, split and dependency metrics", () => {
  const result = Layout(SyntheticGraph());

  assert.ok(result.metrics.slotCount >= 1);
  assert.equal(typeof result.metrics.dependencyCount, "number");
  assert.equal(typeof result.metrics.maximumActiveCandidates, "number");
  assert.equal(result.metrics.rejectedNetCount, 0);
  assert.ok(result.metrics.committedNetCount >= 1);
});

test("native router is invariant under node and edge permutation", () => {
  const graph = SyntheticGraph();
  const baseline = Layout(graph);
  const shuffled = Layout({
    nodes: [...graph.nodes].reverse(),
    edges: [...graph.edges].reverse()
  });

  assert.deepEqual(
    shuffled.nodes.map((node) => [node.id, node.x, node.y]),
    baseline.nodes.map((node) => [node.id, node.x, node.y])
  );
  assert.deepEqual(
    shuffled.edges.map((edge) => [edge.id, edge.points]),
    baseline.edges.map((edge) => [edge.id, edge.points])
  );
});

test("split bridges reserve the shared foreign-wire clearance", () => {
  const victim = {
    segmentKey: "victim",
    incomingY: [100],
    outgoingY: [100],
    minimumY: 100,
    maximumY: 100
  };
  const occupied = [{
    segmentKey: "other",
    incomingY: [100],
    outgoingY: [100],
    minimumY: 100,
    maximumY: 100
  }];
  const thresholds = { criticalConflictThreshold: 1 };

  const first = ChooseFreeBridgeY(occupied, victim, thresholds);
  const second = ChooseFreeBridgeY([
    ...occupied,
    {
      segmentKey: "first-split",
      incomingY: [first],
      outgoingY: [first],
      minimumY: first,
      maximumY: first
    }
  ], victim, thresholds);

  assert.ok(Math.abs(first - 100) >= 4);
  assert.ok(Math.abs(second - first) >= 4);
  assert.ok(Math.abs(second - 100) >= 4);
});

test("residual cycle breaking isolates independent strongly connected components", () => {
  const dependency = (sourceSegmentKey, targetSegmentKey, weight = 1) => ({
    sourceSegmentKey,
    targetSegmentKey,
    weight,
    hard: false,
    critical: false
  });
  const result = BreakResidualCycles([
    dependency("a", "b"),
    dependency("b", "a", 2),
    dependency("c", "d"),
    dependency("d", "e"),
    dependency("e", "c", 2),
    dependency("b", "c"),
    dependency("x", "y")
  ]);

  assert.equal(FindCyclicComponents(result.dependencies).length, 0);
  assert.equal(result.removedCount, 2);
  assert.ok(result.dependencies.some((item) =>
    item.sourceSegmentKey === "x" && item.targetSegmentKey === "y"));
});

test("exact tap overlap constraints do not truncate hard candidates", () => {
  const segments = Array.from({ length: 140 }, (_, index) => ({
    segmentKey: `out-${String(index).padStart(3, "0")}`,
    physicalNetKey: `net-${index}`,
    incomingY: [],
    outgoingY: [100]
  }));
  segments.push({
    segmentKey: "incoming",
    physicalNetKey: "incoming-net",
    incomingY: [100],
    outgoingY: []
  });
  const result = BuildTapOverlapConstraints(segments, { maximumBucketCandidates: 8 });

  assert.equal(result.truncated, false);
  assert.ok(result.dependencies.some((item) =>
    item.sourceSegmentKey === "incoming" && item.targetSegmentKey === "out-139"));
});
