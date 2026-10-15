import assert from "node:assert/strict";
import test from "node:test";
import { BuildCanonicalGraph } from "../reference/retired_native_layered/canonical_graph.js";
import { BreakCycles } from "../reference/retired_native_layered/cycle_breaking.js";
import { AssignRanks } from "../reference/retired_native_layered/rank_assignment.js";
import { BuildProperLayering, JoinProperLayering } from "../reference/retired_native_layered/proper_layering.js";
import { MergeHyperedgeDummies } from "../reference/retired_native_layered/hyperedge_dummy_merging.js";

test("proper layering makes every segment adjacent and joins every logical edge", () => {
  const proper = Run(MakeGraph());
  const rankByKey = new Map(proper.nodes.map((node) => [node.key, node.rank]));
  assert.ok(proper.segments.every((segment) =>
    rankByKey.get(segment.targetKey) - rankByKey.get(segment.sourceKey) === 1));
  assert.deepEqual(JoinProperLayering(proper).map((chain) => chain.edgeKey), ["a-d", "b-c", "c-d"]);
});

test("fanout on one physical net consumes one demand per crossed boundary", () => {
  const graph = MakeGraph();
  graph.edges.push({ id: "a-c", source: "a", target: "c", net: "shared" });
  graph.edges[0].net = "shared";
  const proper = Run(graph);
  for (const boundary of proper.boundaryDemands) {
    const shared = boundary.demands.filter((demand) => demand.physicalNetKey.endsWith("\u0000shared"));
    assert.ok(shared.length <= 1);
  }
});

test("dummy chains are permutation stable", () => {
  const graph = MakeGraph();
  const first = Run(graph);
  const second = Run({ nodes: graph.nodes.toReversed(), edges: graph.edges.toReversed() });
  assert.deepEqual(Summarize(second), Summarize(first));
});

test("hyperedge dummy merging shares placement anchors without dropping logical chains", () => {
  const graph = {
    nodes: ["source", "near", "far-a", "far-b"].map((id) => ({ id, kind: "cell", label: id })),
    edges: [
      { id: "source-near", source: "source", target: "near", net: "shared" },
      { id: "source-far-a", source: "source", target: "far-a", net: "shared" },
      { id: "source-far-b", source: "source", target: "far-b", net: "shared" },
      { id: "near-far-a", source: "near", target: "far-a", net: "other-a" },
      { id: "far-a-far-b", source: "far-a", target: "far-b", net: "other-b" }
    ]
  };
  const proper = Run(graph);
  const crossing = {
    layers: proper.layers.map((layer) => ({ rank: layer.rank, nodeKeys: layer.nodes.map((node) => node.key) })),
    initialCrossings: 0,
    crossings: 0,
    completedSweeps: 0,
    sweepLimit: 0,
    transposePassLimit: 0
  };

  const merged = MergeHyperedgeDummies(proper, crossing);

  assert.ok(merged.metrics.after < merged.metrics.before);
  assert.deepEqual(JoinProperLayering(merged.proper).map((chain) => chain.edgeKey),
    JoinProperLayering(proper).map((chain) => chain.edgeKey));
  assert.ok(merged.proper.segments.every((segment) =>
    merged.proper.nodes.some((node) => node.key === segment.sourceKey) &&
    merged.proper.nodes.some((node) => node.key === segment.targetKey)));
});

function Run(graph) {
  const model = BuildCanonicalGraph(graph);
  const orientation = BreakCycles(model);
  return BuildProperLayering(model, orientation, AssignRanks(model, orientation));
}

function MakeGraph() {
  return {
    nodes: ["a", "b", "c", "d"].map((id) => ({ id, kind: "cell", label: id })),
    edges: [
      { id: "a-d", source: "a", target: "d", net: "long" },
      { id: "b-c", source: "b", target: "c", net: "bc" },
      { id: "c-d", source: "c", target: "d", net: "cd" }
    ]
  };
}

function Summarize(proper) {
  return {
    nodes: proper.nodes,
    segments: proper.segments,
    chains: proper.chains,
    boundaryDemands: proper.boundaryDemands
  };
}
