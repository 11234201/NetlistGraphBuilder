import assert from "node:assert/strict";
import test from "node:test";
import { BuildCanonicalGraph } from "../reference/retired_native_layered/canonical_graph.js";
import { BreakCycles } from "../reference/retired_native_layered/cycle_breaking.js";
import { AssignRanks } from "../reference/retired_native_layered/rank_assignment.js";
import { BuildProperLayering } from "../reference/retired_native_layered/proper_layering.js";
import { MinimizeCrossings } from "../reference/retired_native_layered/crossing_minimization.js";
import { AnalyzeAndPackStructure, OrderStructureBlocks } from "../reference/retired_native_layered/structure_packing.js";

test("shared DAG nodes remain single objects with explicit shared membership", () => {
  const model = BuildCanonicalGraph({
    nodes: ["root", "a", "b", "shared"].map((id) => ({ id, kind: "cell", label: id, isFocusedRoot: id === "root" })),
    edges: [
      { id: "ra", source: "root", target: "a" },
      { id: "rb", source: "root", target: "b" },
      { id: "as", source: "a", target: "shared" },
      { id: "bs", source: "b", target: "shared" }
    ]
  });
  const orientation = BreakCycles(model);
  const placement = { nodes: model.nodes.map((node, index) => ({ key: node.key, x: index * 100, y: 0, width: 50, height: 40 })) };
  const result = AnalyzeAndPackStructure(model, orientation, placement);
  assert.equal(result.nodes.filter((node) => node.key === "shared").length, 1);
  assert.equal(result.membership.get("shared").kind, "shared");
  assert.deepEqual(result.membership.get("shared").owners, ["a", "b"]);
});

test("disconnected components are packed deterministically without overlap", () => {
  const model = BuildCanonicalGraph({
    nodes: ["a", "b"].map((id) => ({ id, kind: "cell", label: id })),
    edges: []
  });
  const orientation = BreakCycles(model);
  const placement = { nodes: model.nodes.map((node) => ({ key: node.key, x: 0, y: 0, width: 50, height: 40 })) };
  const result = AnalyzeAndPackStructure(model, orientation, placement, { componentGap: 60 });
  assert.equal(result.componentCount, 2);
  assert.ok(result.nodes[1].y >= result.nodes[0].y + result.nodes[0].height + 60);
});

test("nested exclusive fanin trees receive distinct placement groups", () => {
  const graph = {
    nodes: ["root", "branch", "a", "b", "a1", "a2", "b1", "b2"].map((id) => ({
      id,
      kind: "cell",
      label: id,
      isFocusedRoot: id === "root"
    })),
    edges: [
      ["a1", "a"], ["a2", "a"], ["b1", "b"], ["b2", "b"],
      ["a", "branch"], ["b", "branch"], ["branch", "root"]
    ].map(([source, target]) => ({ id: `${source}-${target}`, source, target }))
  };
  const structured = BuildStructured(graph);
  const permuted = BuildStructured({
    nodes: graph.nodes.toReversed(),
    edges: graph.edges.toReversed()
  });

  assert.equal(structured.groupByNode.get("a1"), structured.groupByNode.get("a2"));
  assert.equal(structured.groupByNode.get("b1"), structured.groupByNode.get("b2"));
  assert.notEqual(structured.groupByNode.get("a1"), structured.groupByNode.get("b1"));
  assert.equal(structured.groupByNode.get("a"), structured.groupByNode.get("b"));
  assert.deepEqual([...permuted.groupByNode], [...structured.groupByNode]);
});

function BuildStructured(graph) {
  const model = BuildCanonicalGraph(graph);
  const orientation = BreakCycles(model);
  const ranking = AssignRanks(model, orientation);
  const proper = BuildProperLayering(model, orientation, ranking);
  const crossing = MinimizeCrossings(proper);
  return OrderStructureBlocks(model, orientation, proper, crossing);
}
