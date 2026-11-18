import test from "node:test";
import assert from "node:assert/strict";
import { importAigSource } from "../../src/domains/aig/aig_import.js";
import { createAigQuery } from "../../src/domains/aig/aig_query.js";
import { normalizeAigPresentation } from "../../src/domains/aig/aig_presentation.js";
import { aigSelectionHighlights, describeAigSelection } from "../../src/domains/aig/selection_highlights.js";

const source = `.model neighbors
.inputs a b c
.outputs y direct
.names a b first
11 1
.names first c y
10 1
.names a direct
0 1
.end`;

test("one-level AND traces include incident edges and edge selections highlight both endpoints", () => {
  const { model, analysis } = importAigSource(source, { name: "neighbors.blif" });
  const before = JSON.stringify(model);
  const query = createAigQuery(model, analysis);
  const policy = normalizeAigPresentation();
  const a = model.nodes.find((node) => node.kind === "pi" && node.label === "a");
  const direct = model.nodes.find((node) => node.kind === "po" && node.label === "direct");
  const selectedAnd = model.nodes.find((node) => node.kind === "and" && query.connections(node.id).incoming.some((edge) => edge.source === a.id));
  const andRoles = aigSelectionHighlights(query, selectedAnd.id, { connectionHighlight: 1 });
  assert.equal(andRoles.size, 6, "two inputs plus one output and their three edges");
  assert.equal(andRoles.get(a.id), "input");
  assert.equal(andRoles.has(direct.id), false, "sibling output is not a neighbor of the AND");
  const edge = query.connections(direct.id).incoming[0];
  assert.equal(edge.inverted, true);
  assert.deepEqual(aigSelectionHighlights(query, edge.id, policy), new Map([[a.id, "input"], [direct.id, "output"]]));
  assert.equal(aigSelectionHighlights(query, a.id, { connectionHighlight: "off" }).size, 0);
  assert.equal(aigSelectionHighlights(query, null, policy).size, 0);
  assert.equal(aigSelectionHighlights(query, "absent", policy).size, 0);
  assert.equal(JSON.stringify(model), before);
});

test("AND traces apply the same limit in each direction and leave bypass edges outside both cones", () => {
  const { model, analysis } = importAigSource(`.model both_ways
.inputs a b c
.outputs y sibling
.names a b upstream
11 1
.names upstream c selected
10 1
.names selected upstream downstream
11 1
.names downstream y
1 1
.names upstream sibling
1 1
.end`);
  const query = createAigQuery(model, analysis);
  const id = (name) => model.nodes.find((node) => node.sourceRefs.some((ref) => ref.id === name)).id;
  const edgeId = (from, to) => model.edges.find((edge) => edge.source === from && edge.target === to).id;
  const a = id("a"), b = id("b"), c = id("c");
  const upstream = id("upstream"), selected = id("selected"), downstream = id("downstream");
  const output = model.nodes.find((node) => node.kind === "po" && node.label === "y").id;
  const rolesFor = (input, output) => new Map([
    ...input.map((item) => [item, "input"]), ...output.map((item) => [item, "output"])
  ]);
  const trace = (depth) => describeAigSelection(query, selected, { connectionHighlight: depth });
  const inputOne = [upstream, c, edgeId(upstream, selected), edgeId(c, selected)];
  const outputOne = [downstream, edgeId(selected, downstream)];
  assert.deepEqual(trace(1), { dimOutside: true, roles: rolesFor(inputOne, outputOne) });
  const full = rolesFor([...inputOne, a, b, edgeId(a, upstream), edgeId(b, upstream)],
    [...outputOne, output, edgeId(downstream, output)]);
  for (const depth of [2, 17, "all"]) assert.deepEqual(trace(depth), { dimOutside: true, roles: full });
  assert.equal(trace("all").roles.has(edgeId(upstream, downstream)), false, "the bypass joins two traced nodes but skips the selection");
  assert.deepEqual(trace("off"), { dimOutside: false, roles: new Map() });
});

test("input and output selections trace complete directional cones without sibling branches", () => {
  const { model, analysis } = importAigSource(source, { name: "cones.blif" });
  const before = JSON.stringify({ model, analysis });
  const query = createAigQuery(model, analysis);
  const policy = normalizeAigPresentation();
  const port = (kind, label) => model.nodes.find((node) => node.kind === kind && node.label === label);
  const a = port("pi", "a"), b = port("pi", "b"), c = port("pi", "c");
  const y = port("po", "y"), direct = port("po", "direct");
  const downstream = aigSelectionHighlights(query, a.id, policy);
  assert.equal(downstream.size, 8, "both ANDs, both outputs and all four downstream edges");
  for (const node of model.nodes.filter((node) => node.kind === "and" || node.kind === "po")) {
    assert.equal(downstream.get(node.id), "output");
  }
  for (const edge of model.edges) {
    assert.equal(downstream.has(edge.id), ![b.id, c.id].includes(edge.source));
  }
  for (const node of [a, b, c]) assert.equal(downstream.has(node.id), false);
  const upstream = aigSelectionHighlights(query, y.id, policy);
  assert.equal(upstream.size, 10, "both ANDs, all three inputs and all five fanin edges");
  for (const node of model.nodes.filter((node) => node.kind === "and" || node.kind === "pi")) {
    assert.equal(upstream.get(node.id), "input");
  }
  for (const edge of model.edges) assert.equal(upstream.has(edge.id), edge.target !== direct.id);
  assert.equal(upstream.has(direct.id), false);
  assert.equal(upstream.has(y.id), false);
  const directEdge = query.connections(direct.id).incoming[0];
  assert.equal(directEdge.inverted, true);
  assert.deepEqual(aigSelectionHighlights(query, direct.id, policy),
    new Map([[directEdge.id, "input"], [a.id, "input"]]));
  assert.equal(JSON.stringify({ model, analysis }), before);
});

test("port cones include constant boundaries and unused inputs have no highlights", () => {
  const { model, analysis } = importAigSource(".model boundaries\n.inputs unused\n.outputs zero\n.names zero\n.end");
  const query = createAigQuery(model, analysis);
  const output = model.nodes.find((node) => node.kind === "po");
  const edge = query.connections(output.id).incoming[0];
  assert.deepEqual(aigSelectionHighlights(query, output.id, normalizeAigPresentation()),
    new Map([[edge.id, "input"], [edge.source, "input"]]));
  assert.equal(aigSelectionHighlights(query, model.nodes.find((node) => node.kind === "pi").id,
    normalizeAigPresentation()).size, 0);
});

test("bounded port traces expand shared gates at their shortest distance in either direction", () => {
  const links = [
    ["port", "short"], ["short", "shared"], ["port", "long"], ["long", "middle"],
    ["middle", "shared"], ["shared", "last"], ["last", "boundary"]
  ];
  for (const upstream of [false, true]) {
    const role = upstream ? "input" : "output";
    const kinds = { port: upstream ? "po" : "pi", boundary: upstream ? "pi" : "po" };
    for (const order of [links, [...links].reverse()]) {
      const expanded = new Set();
      const query = {
        nodeById: { get: (id) => ({ kind: kinds[id] || "and" }) },
        [upstream ? "incomingEdges" : "outgoingEdges"](id) {
          assert.ok(!expanded.has(id), "shared nodes expand once");
          expanded.add(id);
          return order.filter(([from]) => from === id).map(([from, to]) => ({
            id: from + "-" + to, source: upstream ? to : from, target: upstream ? from : to
          }));
        }
      };
      const trace = (depth) => {
        expanded.clear();
        return aigSelectionHighlights(query, "port", { connectionHighlight: depth });
      };
      const one = ["short", "long", "port-short", "port-long"];
      const two = [...one, "shared", "middle", "short-shared", "long-middle"];
      const three = [...two, "middle-shared", "last", "shared-last"];
      for (const [depth, ids] of [[1, one], [2, two], [3, three]]) {
        assert.deepEqual(trace(depth), new Map(ids.map((id) => [id, role])));
        assert.ok(!expanded.has("last"), "the trace never reads past its boundary");
      }
      assert.deepEqual(trace(4), trace("all"));
      assert.deepEqual(trace(999), trace("all"));
    }
  }
});

test("port tracing mutes unrelated logic even when the selected input is isolated", () => {
  const { model, analysis } = importAigSource(source.replace(".inputs a b c", ".inputs a b c unused"));
  const query = createAigQuery(model, analysis);
  const policy = normalizeAigPresentation();
  const isolated = model.nodes.find((node) => node.label === "unused");
  assert.deepEqual(describeAigSelection(query, isolated.id, policy), { dimOutside: true, roles: new Map() });
  assert.equal(describeAigSelection(query, isolated.id, { connectionHighlight: "off" }).dimOutside, false);
  for (const id of [null, model.edges[0].id]) {
    assert.equal(describeAigSelection(query, id, policy).dimOutside, false);
  }
});

test("deep shared port cones visit each reached node once without recursion or graph enumeration", () => {
  const depth = 10000;
  const visits = new Set();
  const query = {
    nodeById: { get: (id) => ({ kind: id === "input" ? "pi" : id === depth + 1 ? "po" : "and" }) },
    outgoingEdges(id) {
      assert.equal(visits.has(id), false, "shared fanout paths must not expand a node twice");
      visits.add(id);
      const target = id === "input" ? 1 : id + 1;
      return [0, 1].map((slot) => ({ id: `edge:${id}:${slot}`, source: id, target }));
    }
  };
  const roles = aigSelectionHighlights(query, "input", { connectionHighlight: "all" });
  assert.equal(visits.size, depth + 1);
  assert.equal(roles.size, (depth + 1) * 3);
  assert.equal(roles.get(depth + 1), "output");
});

test("tracing an output never enumerates the fanout of its shared drivers", () => {
  const { model, analysis } = importAigSource(source);
  const query = createAigQuery(model, {
    ...analysis, get outgoing() { throw new Error("Unrelated fanout read"); }
  });
  const output = model.nodes.find((node) => node.kind === "po" && node.label === "y");
  assert.equal(aigSelectionHighlights(query, output.id, normalizeAigPresentation()).size, 10);
});

test("parallel input slots keep both incident edges while sharing one neighbor node", () => {
  const nodes = new Map([["a", { kind: "pi" }], ["and", { kind: "and" }]]);
  const query = { nodeById: nodes, incomingEdges: () => [
    { id: "slot0", source: "a", target: "and" }, { id: "slot1", source: "a", target: "and" }
  ], outgoingEdges: () => [] };
  assert.deepEqual(aigSelectionHighlights(query, "and", { connectionHighlight: 3 }),
    new Map([["slot0", "input"], ["a", "input"], ["slot1", "input"]]));
});
