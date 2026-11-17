import test from "node:test";
import assert from "node:assert/strict";
import { importAigSource } from "../../src/domains/aig/aig_import.js";
import { createAigQuery } from "../../src/domains/aig/aig_query.js";
import { normalizeAigPresentation } from "../../src/domains/aig/aig_presentation.js";
import { aigSelectionHighlights } from "../../src/domains/aig/selection_highlights.js";

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

test("AIG selection highlights exactly one hop including complemented edges, without walking other cones", () => {
  const { model, analysis } = importAigSource(source, { name: "neighbors.blif" });
  const before = JSON.stringify(model);
  const query = createAigQuery(model, analysis);
  const policy = normalizeAigPresentation();
  const a = model.nodes.find((node) => node.kind === "pi" && node.label === "a");
  const direct = model.nodes.find((node) => node.kind === "po" && node.label === "direct");
  const roles = aigSelectionHighlights(query, a.id, policy);
  assert.equal(roles.size, 4, "two fanout edges and their two immediate targets");
  assert.equal(roles.get(direct.id), "output");
  assert.ok([...roles.values()].every((role) => role === "output"));
  assert.equal(roles.has(a.id), false);
  const selectedAnd = model.nodes.find((node) => node.kind === "and" && query.connections(node.id).incoming.some((edge) => edge.source === a.id));
  const andRoles = aigSelectionHighlights(query, selectedAnd.id, policy);
  assert.equal(andRoles.size, 6, "two inputs plus one output and their three edges");
  assert.equal(andRoles.get(a.id), "input");
  assert.equal(andRoles.has(direct.id), false, "sibling output is not a neighbor of the AND");
  const edge = query.connections(direct.id).incoming[0];
  assert.equal(edge.inverted, true);
  assert.deepEqual(aigSelectionHighlights(query, edge.id, policy), new Map([[a.id, "input"], [direct.id, "output"]]));
  assert.equal(aigSelectionHighlights(query, a.id, { neighbors: false }).size, 0);
  assert.equal(aigSelectionHighlights(query, null, policy).size, 0);
  assert.equal(aigSelectionHighlights(query, "absent", policy).size, 0);
  assert.equal(JSON.stringify(model), before);
});

test("parallel input slots keep both incident edges while sharing one neighbor node", () => {
  const nodes = new Map([["a", {}], ["and", {}]]);
  const query = { nodeById: nodes, connections: () => ({ incoming: [
    { id: "slot0", source: "a", target: "and" }, { id: "slot1", source: "a", target: "and" }
  ], outgoing: [] }) };
  assert.deepEqual(aigSelectionHighlights(query, "and", { neighbors: true }),
    new Map([["slot0", "input"], ["a", "input"], ["slot1", "input"]]));
});
