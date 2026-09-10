import assert from "node:assert/strict";
import test from "node:test";
import { measureDiagramGraph } from "../../src/diagram/measure_graph.js";

test("measurement materializes node bounds and ports without mutating the diagram", () => {
  const diagram = {
    nodes: [{
      id: "logic:1",
      kind: "cell",
      label: "logic",
      portDescriptors: [
        { pin: "a", direction: "input", side: "left" },
        { pin: "y", direction: "output", side: "right" }
      ]
    }],
    edges: []
  };
  const measured = measureDiagramGraph(diagram, { cellPinPitch: 40 });
  assert.equal(diagram.nodes[0].width, undefined);
  assert.ok(measured.nodes[0].width >= 128);
  assert.deepEqual(measured.nodes[0].ports.map((port) => port.pin), ["a", "y"]);
});
