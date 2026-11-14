import assert from "node:assert/strict";
import test from "node:test";
import { cloneObjectRefs } from "../../src/contracts/object_ref.js";
import { cloneGraphOverrides } from "../../src/domains/netlist/graph_overrides.js";
import { graphNodeToObjectRef, objectRefToNodeId } from "../../src/domains/netlist/graph_object_refs.js";
import { collectCellTypeSummary, createInferredCellDefinition } from "../../src/domains/netlist/cell_definition_query.js";
import { parseVerilog } from "../../src/parser/verilogParser.js";

test("graph object references preserve canonical names and distinguish repeated occurrences", () => {
  const nodes = ["left", "right"].map((side) => ({
    id: `${side}:u/0`, kind: "cell", label: "display alias",
    ref: { instance: "u/0", occurrencePath: [side, "escaped/instance"] }
  }));
  const graph = { nodes };
  const ref = graphNodeToObjectRef(nodes[1], { documentId: "doc", unitId: "leaf" });
  assert.equal(ref.localId, "u/0");
  assert.equal(objectRefToNodeId(ref, graph), "right:u/0");
  assert.equal(objectRefToNodeId({ ...ref, occurrencePath: ["missing"] }, graph), null);
  assert.equal(objectRefToNodeId({ ...ref, occurrencePath: [] }, graph), "left:u/0");
  assert.equal(objectRefToNodeId({ ...ref, kind: "net", localId: "a/b[0]" }, graph), "net:a/b[0]");
  const copies = cloneObjectRefs([ref]);
  copies[0].occurrencePath[0] = "changed";
  assert.equal(ref.occurrencePath[0], "right");
  assert.equal(nodes[1].ref.occurrencePath[0], "right");
});

test("override snapshots isolate domain records and retain canonical routing exclusions", () => {
  const input = {
    nodeProperties: { ["__proto__"]: { label: "renamed" } },
    cellPinDirections: { "cell:u/0": { "A[0]": "input" } },
    unroutedNets: ["z", "a/b", "z"]
  };
  const snapshot = cloneGraphOverrides(input);
  snapshot.nodeProperties.__proto__.label = "changed";
  snapshot.cellPinDirections["cell:u/0"]["A[0]"] = "output";
  snapshot.unroutedNets.push("extra");
  assert.equal(input.nodeProperties.__proto__.label, "renamed");
  assert.equal(input.cellPinDirections["cell:u/0"]["A[0]"], "input");
  assert.deepEqual(input.unroutedNets, ["z", "a/b", "z"]);
  assert.deepEqual(cloneGraphOverrides(input).unroutedNets, ["a/b", "z"]);
  assert.deepEqual(cloneGraphOverrides(null), { nodeProperties: {}, cellPinDirections: {} });
});

test("cell definition queries consume structural IR without DOM and preserve inference behavior", () => {
  const design = parseVerilog("module top(input a, output y); BUF_X1 u0 (.A(a), .Z(y)); BUF_X1 u1 (.A(a), .Z(y)); endmodule");
  const before = structuredClone(design);
  const summary = collectCellTypeSummary(design, "BUF_X1");
  assert.equal(summary.instanceCount, 2);
  assert.deepEqual(summary.pins.map((pin) => [pin.canonicalName, pin.count]), [["A", 2], ["Z", 2]]);
  assert.deepEqual(createInferredCellDefinition(summary), {
    displayName: "BUF_X1", gateKind: "BUF", pins: { A: "input", Z: "output" }
  });
  assert.deepEqual(design, before);
});
