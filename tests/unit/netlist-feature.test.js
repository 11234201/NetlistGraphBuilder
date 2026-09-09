import assert from "node:assert/strict";
import test from "node:test";
import { netlistFeature, NETLIST_LEGACY_DIAGRAM_CONTRACT } from "../../src/domains/netlist/netlist_feature.js";

const source = "module top(a,y); input a; output y; BUF \\u[0]  (.A(a),.Z(y)); endmodule";

test("netlist feature imports, searches and projects through stable object references", () => {
  const document = netlistFeature.importSource({ name: "escaped.v", text: source }, { documentId: "doc:netlist" });
  assert.equal(document.domainId, "netlist");
  assert.equal(netlistFeature.listUnits(document)[0].objectRef.unitId, "top");
  const index = netlistFeature.buildSearchIndex(document);
  const hit = netlistFeature.search(index, "u[0]")[0];
  assert.equal(hit.objectRef.documentId, "doc:netlist");
  assert.equal(hit.objectRef.localId, "u[0]");

  const query = netlistFeature.queryView(document, {
    unitId: "top",
    mode: "focused",
    rootNodeIds: ["cell:u_0_"],
    faninDepth: 1,
    fanoutDepth: 1
  }, { transforms: { useFanoutHubs: false } });
  assert.ok(query.visibleGraph.nodes.some((node) => node.id === "cell:u_0_"));
  assert.equal(query.projectionMap.get("cell:u_0_").localId, "u[0]");
  const diagram = netlistFeature.projectDiagram(query);
  assert.equal(diagram.contract, NETLIST_LEGACY_DIAGRAM_CONTRACT);
  assert.equal(diagram.graph, query.visibleGraph);
});

test("netlist feature keeps failed imports and wrong-domain queries outside committed state", () => {
  assert.throws(() => netlistFeature.importSource({ name: "bad.v", text: "not verilog" }), /No module/);
  assert.throws(() => netlistFeature.importSource({ name: "bad.aig", bytes: new Uint8Array([0]) }), /must be text/);
  assert.throws(() => netlistFeature.listUnits({ domainId: "aig", model: {} }), /netlist document/);
});
