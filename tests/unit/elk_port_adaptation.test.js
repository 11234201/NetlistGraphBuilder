import assert from "node:assert/strict";
import test from "node:test";
import Elk from "../../vendor/elkjs-0.11.1/lib/elk.bundled.js";
import { createMeasuredGraph } from "../../src/contracts/diagram.js";
import { MeasuredElkLayoutProvider } from "../../src/layout/measured_elk_layout.js";
import { ElkLayoutProvider } from "../../src/layout/elkLayoutProvider.js";
import { getConnectionPoint } from "../../src/layout/nodeGeometry.js";
import { buildSchematicGraph } from "../../src/netlist/graph.js";
import { parseVerilog } from "../../src/parser/verilogParser.js";

function terminal(id, direction, side) {
  return { id, direction, side,
    x: side === "left" ? 0 : side === "right" ? 72 : 36,
    y: side === "top" ? 0 : side === "bottom" ? 48 : 24 };
}

function measuredPair(sourceSide, targetSide, sourceOffset, targetOffset) {
  const diagram = { nodes: [{ id: "source" }, { id: "target" }], edges: [
    { id: "edge", source: "source", sourcePin: "out", target: "target", targetPin: "in", net: "signal" }
  ] };
  const nodes = new Map([
    ["source", { width: 72, height: 48, ports: [terminal("out", "output", sourceSide)],
      connectionOffsets: { source: sourceOffset } }],
    ["target", { width: 72, height: 48, ports: [terminal("in", "input", targetSide)],
      connectionOffsets: { target: targetOffset } }]
  ]);
  return createMeasuredGraph(diagram, { nodes });
}

function captureElk() {
  const elk = new Elk();
  const capture = {};
  capture.factory = () => ({ layout: async (input) => {
    capture.input = structuredClone(input);
    capture.result = await elk.layout(input);
    capture.snapshot = structuredClone(capture.result);
    return capture.result;
  } });
  return capture;
}

function rawPoints(edge) {
  const section = edge.sections[0];
  return [section.startPoint, ...(section.bendPoints || []), section.endPoint];
}

function translatedRawPoints(capture, graph, edgeId) {
  const node = graph.nodes[0];
  const rawNode = capture.result.children.find((child) => child.id === node.id);
  const dx = node.x - rawNode.x;
  const dy = node.y - rawNode.y;
  return rawPoints(capture.result.edges.find((edge) => edge.id === edgeId))
    .map(({ x, y }) => ({ x: x + dx, y: y + dy }));
}

function assertExactEndpoints(graph) {
  const nodes = new Map(graph.nodes.map((node) => [node.id, node]));
  for (const edge of graph.edges) {
    assert.deepEqual(edge.points[0], getConnectionPoint(nodes.get(edge.source), edge.sourcePin, "source"));
    assert.deepEqual(edge.points.at(-1), getConnectionPoint(nodes.get(edge.target), edge.targetPin, "target"));
    for (let index = 1; index < edge.points.length; index += 1) {
      const previous = edge.points[index - 1];
      const point = edge.points[index];
      assert.ok(previous.x === point.x || previous.y === point.y, "route stays orthogonal");
      assert.notDeepEqual(previous, point, "route has no zero-length segments");
    }
  }
  assert.equal(graph.layoutStatus, "routed");
  assert.equal(graph.validationMetrics.total, 0);
}

test("vendored ELK preserves exact point terminals and section bends on every port side", async () => {
  for (const [sourceSide, targetSide] of [
    ["right", "left"], ["left", "right"], ["top", "bottom"],
    ["bottom", "top"], ["right", "top"], ["bottom", "left"]
  ]) {
    const measured = measuredPair(sourceSide, targetSide);
    const before = structuredClone(measured.diagram);
    const capture = captureElk();
    const result = await new MeasuredElkLayoutProvider({ elkFactory: capture.factory }).layoutMeasured(measured);
    assert.deepEqual(result.edges[0].points, translatedRawPoints(capture, result, "edge"), `${sourceSide}/${targetSide}`);
    assertExactEndpoints(result);
    assert.deepEqual(measured.diagram, before);
    assert.deepEqual(capture.result, capture.snapshot, "normalization must not mutate ELK output");
  }
});

test("ELK routes from measured connection offsets without adding endpoint bends", async () => {
  for (const [sourceSide, targetSide, sourceOffset, targetOffset] of [
    ["right", "left", { x: 10, y: 0 }, { x: -6, y: 0 }],
    ["left", "right", { x: -10, y: 0 }, { x: 6, y: 0 }],
    ["top", "bottom", { x: 0, y: -6 }, { x: 0, y: 4 }],
    ["bottom", "top", { x: 0, y: 6 }, { x: 0, y: -4 }]
  ]) {
    const capture = captureElk();
    const result = await new MeasuredElkLayoutProvider({ elkFactory: capture.factory })
      .layoutMeasured(measuredPair(sourceSide, targetSide, sourceOffset, targetOffset));
    const expected = translatedRawPoints(capture, result, "edge");
    assert.deepEqual(result.edges[0].points, expected, `${sourceSide}/${targetSide}`);
    assertExactEndpoints(result);
  }
});

test("real netlist fanout and inverted outputs retain ELK bends without tiny adapter segments", async () => {
  const graph = buildSchematicGraph(parseVerilog(`
    module fanout(input a, b, output y, z);
      wire n;
      NAND2_X1 gate0(.A1(a), .A2(b), .ZN(n));
      BUF_X1 gate1(.A(n), .Z(y));
      BUF_X1 gate2(.A(n), .Z(z));
    endmodule
  `).modules[0]);
  const before = structuredClone(graph);
  const capture = captureElk();
  const result = await new ElkLayoutProvider({ elkFactory: capture.factory }).layout(graph);
  for (const edge of result.edges) {
    const expected = translatedRawPoints(capture, result, edge.id);
    assert.deepEqual(edge.points, expected, edge.id);
    for (let index = 1; index < edge.points.length; index += 1) {
      const previous = edge.points[index - 1];
      const point = edge.points[index];
      assert.ok(Math.abs(point.x - previous.x) + Math.abs(point.y - previous.y) > 1,
        `no tiny adapter segment: ${edge.id} ${JSON.stringify(edge.points)}`);
    }
  }
  const fanout = result.edges.filter((edge) => edge.net === "n");
  assert.equal(fanout.length, 2);
  assert.deepEqual(fanout[0].points[0], fanout[1].points[0]);
  assertExactEndpoints(result);
  assert.deepEqual(graph, before);
  assert.deepEqual(capture.result, capture.snapshot);
});

test("ELK keeps distinct source and target offsets on a shared inout terminal", async () => {
  const diagram = { nodes: [{ id: "node" }], edges: [
    { id: "loop", source: "node", sourcePin: "io", target: "node", targetPin: "io", net: "loop" }
  ] };
  const measured = createMeasuredGraph(diagram, { nodes: new Map([["node", {
    width: 72, height: 48, ports: [terminal("io", "inout", "right")],
    connectionOffsets: { source: { x: 10, y: -8 }, target: { x: 6, y: 8 } }
  }]]) });
  const capture = captureElk();
  const result = await new MeasuredElkLayoutProvider({ elkFactory: capture.factory }).layoutMeasured(measured);
  assert.notEqual(capture.input.edges[0].sources[0], capture.input.edges[0].targets[0]);
  assert.deepEqual(result.edges[0].points, translatedRawPoints(capture, result, "loop"));
  assertExactEndpoints(result);
});

test("ELK fixes implicit endpoints on portless fanout nodes before routing", async () => {
  const diagram = { nodes: ["source", "junction", "targetA", "targetB"].map((id) => ({ id })), edges: [
    { id: "in", source: "source", target: "junction", net: "input" },
    { id: "outA", source: "junction", target: "targetA", net: "output" },
    { id: "outB", source: "junction", target: "targetB", net: "output" }
  ] };
  const measured = createMeasuredGraph(diagram, { nodes: new Map(diagram.nodes.map(({ id }) =>
    [id, { width: 20, height: 20, ports: [] }])) });
  const capture = captureElk();
  const result = await new MeasuredElkLayoutProvider({ elkFactory: capture.factory }).layoutMeasured(measured);
  for (const edge of result.edges) assert.deepEqual(edge.points, translatedRawPoints(capture, result, edge.id));
  assert.ok(result.nodes.every((node) => node.ports.length === 0), "implicit ELK ports stay internal");
  assertExactEndpoints(result);
});

test("ELK preserves orthogonal sections across fractional endpoint roundoff", async () => {
  for (const value of [0.2, 0.7]) {
    for (const vertical of [false, true]) {
      const diagram = { nodes: [{ id: "a" }, { id: "b" }], edges: [
        { id: "ab", source: "a", target: "b", sourcePin: "out", targetPin: "in" }
      ] };
      const nodes = new Map([
        ["a", { width: 72 + value, height: 48 + value, ports: [{ id: "out", direction: "output",
          side: vertical ? "bottom" : "right", x: vertical ? 24 + value : 72 + value,
          y: vertical ? 48 + value : 24 + value }],
          connectionOffsets: { source: vertical ? { x: value, y: 10 + value } : { x: 10 + value, y: value } } }],
        ["b", { width: 60 + value, height: 48 + value, ports: [{ id: "in", direction: "input",
          side: vertical ? "top" : "left", x: vertical ? 12 + value : 0, y: vertical ? 0 : 12 + value }],
          connectionOffsets: { target: vertical ? { x: value, y: -value } : { x: -value, y: value } } }]
      ]);
      const capture = captureElk();
      const result = await new MeasuredElkLayoutProvider({ elkFactory: capture.factory })
        .layoutMeasured(createMeasuredGraph(diagram, { nodes }));
      assert.deepEqual(result.edges[0].points, translatedRawPoints(capture, result, "ab"));
      for (const [index, pin, role, endpoint] of [
        [0, "out", "source", result.edges[0].points[0]], [1, "in", "target", result.edges[0].points.at(-1)]
      ]) {
        const expected = getConnectionPoint(result.nodes[index], pin, role);
        assert.ok(Math.abs(endpoint.x - expected.x) < 1e-10 && Math.abs(endpoint.y - expected.y) < 1e-10);
      }
      assert.equal(result.validationMetrics.total, 0);
      assert.deepEqual(capture.result, capture.snapshot);
    }
  }
});

test("ELK port IDs avoid node and edge IDs without changing public identities or input-order behavior", async () => {
  for (const [targetId, edgeId, direction] of [
    ["a::output:source", "edge"], ["a::input:target", "edge"], ["b", "a::output:source"],
    ["a::inout:pin::source", "edge", "inout"], ["a::inout:pin::target", "edge", "inout"],
    ["a::output:pin", "edge", "output"]
  ]) {
    const diagram = { nodes: [{ id: "a" }, { id: targetId }], edges: [{ id: edgeId, source: "a", target: targetId }] };
    const nodes = new Map(diagram.nodes.map(({ id }) => [id, { width: 72, height: 48,
      ports: id === "a" && direction ? [terminal("pin", direction, "right")] : [] }]));
    const capture = captureElk();
    const provider = new MeasuredElkLayoutProvider({ elkFactory: capture.factory });
    const result = await provider.layoutMeasured(createMeasuredGraph(diagram, { nodes }));
    const inputIds = [capture.input.id, ...capture.input.children.flatMap((node) => [node.id, ...node.ports.map((port) => port.id)]),
      ...capture.input.edges.map((edge) => edge.id)];
    assert.equal(new Set(inputIds).size, inputIds.length);
    assert.deepEqual(result.nodes.map((node) => node.id), diagram.nodes.map((node) => node.id));
    assert.equal(result.edges[0].id, edgeId);
    assert.equal(result.edges[0].points.length, 2, "a direct route must not become an attachment detour");
    assert.deepEqual(result.edges[0].points, translatedRawPoints(capture, result, edgeId));
    assertExactEndpoints(result);
    const permuted = await provider.layoutMeasured(createMeasuredGraph({ ...diagram, nodes: diagram.nodes.toReversed() }, { nodes }));
    assert.deepEqual(permuted.edges, result.edges);
    const byId = (left, right) => left.id.localeCompare(right.id);
    assert.deepEqual(permuted.nodes.toSorted(byId), result.nodes.toSorted(byId));
  }
});

test("a displaced source attachment does not change an already aligned target section", async () => {
  const measured = measuredPair("right", "left", { x: 0, y: 8 });
  const provider = new MeasuredElkLayoutProvider({ elkFactory: () => ({ layout: async (input) => ({
    ...input,
    children: input.children.map((node, index) => ({ ...node, x: index * 240, y: 0 })),
    edges: [{ ...input.edges[0], sections: [{ startPoint: { x: 72, y: 24 },
      bendPoints: [{ x: 150, y: 24 }, { x: 150, y: 80 }, { x: 200, y: 80 }, { x: 200, y: 24 }],
      endPoint: { x: 240, y: 24 } }] }]
  }) }) });
  const result = await provider.layoutMeasured(measured);
  assert.deepEqual(result.edges[0].points.slice(-3), [{ x: 200, y: 80 }, { x: 200, y: 24 }, { x: 240, y: 24 }]);
  assertExactEndpoints(result);
});
