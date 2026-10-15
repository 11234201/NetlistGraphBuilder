import assert from "node:assert/strict";
import test from "node:test";
import { BuildCanonicalGraph } from "../reference/retired_native_layered/canonical_graph.js";
import {
  NATIVE_LAYERED_LAYOUT_PROVIDER_ID,
  NativeLayeredLayoutProvider
} from "../reference/retired_native_layered/native_layered_layout_provider.js";

test("canonical graph is immutable, grouped by physical net, and permutation stable", () => {
  const graph = MakeGraph();
  const before = structuredClone(graph);
  const forward = BuildCanonicalGraph(graph);
  const reversed = BuildCanonicalGraph({
    ...graph,
    nodes: graph.nodes.toReversed(),
    edges: graph.edges.toReversed()
  });

  assert.deepEqual(graph, before);
  assert.ok(Object.isFrozen(forward));
  assert.ok(forward.nodes.every(Object.isFrozen));
  assert.ok(forward.logicalEdges.every(Object.isFrozen));
  assert.deepEqual(Summarize(reversed), Summarize(forward));
  assert.deepEqual(forward.physicalNets.map((net) => net.edgeKeys), [["fan-0", "fan-1"]]);
});

test("canonical graph handles empty, disconnected, cycles, and escaped names", () => {
  const empty = BuildCanonicalGraph({ nodes: [], edges: [] });
  assert.equal(empty.nodes.length, 0);
  assert.equal(empty.logicalEdges.length, 0);

  const graph = MakeGraph();
  graph.nodes.push({ id: "cell:orphan", kind: "cell", label: "\\orphan[3] " });
  graph.edges.push({ id: "cycle", source: "cell:b", target: "cell:a", net: "feedback" });
  const model = BuildCanonicalGraph(graph);
  assert.equal(model.nodeByKey.get("cell:orphan").stableName, "\\orphan[3] ");
  assert.deepEqual(model.outgoingByNode.get("cell:orphan"), []);
  assert.equal(model.logicalEdges.find((edge) => edge.key === "cycle").targetKey, "cell:a");
});

test("native provider exposes a valid empty graph shell", () => {
  const provider = new NativeLayeredLayoutProvider();
  const positioned = provider.layout({ moduleName: "empty", nodes: [], edges: [] });
  assert.equal(provider.id, NATIVE_LAYERED_LAYOUT_PROVIDER_ID);
  assert.equal(positioned.layoutProvider, NATIVE_LAYERED_LAYOUT_PROVIDER_ID);
  assert.equal(positioned.layoutStatus, "routed");
  assert.deepEqual(positioned.nodes, []);
});

function MakeGraph() {
  return {
    nodes: [
      {
        id: "cell:a",
        kind: "cell",
        label: "\\a[0] ",
        portDescriptors: [{ pin: "Y", rawPin: "Y", direction: "output", side: "right" }]
      },
      {
        id: "cell:b",
        kind: "cell",
        label: "b",
        portDescriptors: [
          { pin: "A", rawPin: "A", direction: "input", side: "left" },
          { pin: "B", rawPin: "B", direction: "input", side: "left" }
        ]
      },
      { id: "cell:c", kind: "cell", label: "c" }
    ],
    edges: [
      { id: "fan-1", source: "cell:a", sourcePin: "Y", target: "cell:c", targetPin: "A", net: "n" },
      { id: "fan-0", source: "cell:a", sourcePin: "Y", target: "cell:b", targetPin: "A", net: "n" }
    ]
  };
}

function Summarize(model) {
  return {
    nodes: model.nodes,
    logicalEdges: model.logicalEdges,
    physicalNets: model.physicalNets,
    diagnostics: model.diagnostics,
    outgoing: [...model.outgoingByNode],
    incoming: [...model.incomingByNode]
  };
}
