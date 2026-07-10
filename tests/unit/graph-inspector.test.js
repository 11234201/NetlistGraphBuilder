import assert from "node:assert/strict";
import test from "node:test";
import { inspectGraphNet, inspectGraphNode } from "../../src/analysis/graphInspector.js";
import { buildSchematicGraph } from "../../src/netlist/graph.js";
import { parseVerilog } from "../../src/parser/verilogParser.js";
import { renderObjectDetails } from "../../src/ui/objectDetailsPanel.js";

const source = `module m(a, y1, y2);
input a; output y1; output y2; wire n;
BUF u0 (.A(a), .Z(n));
BUF u1 (.A(n), .Z(y1));
BUF u2 (.A(n), .Z(y2));
endmodule`;

test("graph inspector reports cell pin nets and connected endpoints", () => {
  const graph = buildSchematicGraph(parseVerilog(source).modules[0]);
  const node = graph.nodes.find((item) => item.id === "cell:u0");
  const inspection = inspectGraphNode(graph, node);
  const input = inspection.connections.find((connection) => connection.pin === "A");
  const output = inspection.connections.find((connection) => connection.pin === "Z");

  assert.equal(input.net, "a");
  assert.equal(input.peers, "a.a");
  assert.equal(output.net, "n");
  assert.match(output.peers, /u1\.A/);
  assert.match(output.peers, /u2\.A/);
});

test("graph inspector reports net driver, loads, and escaped HTML", () => {
  const graph = buildSchematicGraph(parseVerilog(source).modules[0]);
  const inspection = inspectGraphNet(graph, "n");
  const html = renderObjectDetails({
    ...inspection,
    connections: [...inspection.connections, { pin: "<P>", direction: "input", net: "a&b", peers: "u<0>" }]
  });

  assert.deepEqual(inspection.summary.at(-1), ["Fanout", 2]);
  assert.match(inspection.summary[2][1], /u0\.Z/);
  assert.match(inspection.summary[3][1], /u1\.A/);
  assert.match(html, /Connections/);
  assert.match(html, /&lt;P&gt;/);
  assert.match(html, /a&amp;b/);
});
