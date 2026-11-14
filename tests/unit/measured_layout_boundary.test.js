import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createMeasuredGraph } from "../../src/contracts/diagram.js";
import { MEASURED_GRAPH_CONTRACT } from "../../src/contracts/measured_graph.js";
import { measureNetlistGraph } from "../../src/domains/netlist/measure_graph.js";
import { MeasuredAnchorLayoutProvider } from "../../src/layout/measured_anchor_layout.js";
import { MeasuredElkLayoutProvider } from "../../src/layout/measured_elk_layout.js";
import { getLayoutProvider } from "../../src/layout/layoutProvider.js";
import { materializeMeasuredGraph, resizeMeasuredPorts } from "../../src/layout/measured_geometry.js";
import { buildNodePorts, getConnectionPoint } from "../../src/layout/nodeGeometry.js";
import { applyPositionedOverrides } from "../../src/layout/positionedRouting.js";
import { buildModuleWorkspace } from "../../src/app/moduleWorkspace.js";
import { parseVerilog } from "../../src/parser/verilogParser.js";

function neutralMeasurement() {
  const diagram = { id: "neutral", nodes: [{ id: "a", label: "a" }, { id: "b", label: "b" }],
    edges: [{ id: "ab", source: "a", sourcePin: "exit", target: "b", targetPin: "entry", label: "ab" }] };
  const nodes = new Map([
    ["a", { width: 83, height: 47, ports: [{ id: "exit", direction: "output", side: "right", x: 83, y: 17 }] }],
    ["b", { width: 61, height: 39, ports: [{ id: "entry", direction: "input", side: "left", x: 0, y: 11 }] }]
  ]);
  return { diagram, nodes, measured: createMeasuredGraph(diagram, { nodes }) };
}

test("MeasuredGraph validates complete node geometry and owns immutable measurements", () => {
  const { diagram, nodes, measured } = neutralMeasurement();
  assert.equal(measured.contract, MEASURED_GRAPH_CONTRACT);
  assert.equal(measured.diagram, diagram);
  nodes.get("a").ports[0].x = 999;
  assert.equal(measured.measurements.nodes.get("a").ports[0].x, 83);
  assert.throws(() => measured.measurements.nodes.set("a", {}), /read-only/);
  assert.throws(() => createMeasuredGraph(diagram, { nodes: new Map() }), /dimensions/);
  assert.throws(() => createMeasuredGraph(diagram, { nodes: new Map([["a", { width: Infinity, height: 10 }]]) }), /dimensions/);
  const invalid = neutralMeasurement();
  invalid.nodes.get("a").ports[0].side = "guess";
  assert.throws(() => createMeasuredGraph(invalid.diagram, { nodes: invalid.nodes }), /port geometry/);
});

test("Anchor measured entry consumes domain-neutral dimensions and terminals without inference", async () => {
  const { diagram, measured } = neutralMeasurement();
  const before = structuredClone(diagram);
  const result = await new MeasuredAnchorLayoutProvider().layoutMeasured(measured);
  assert.deepEqual(diagram, before);
  assert.equal(result.layoutStatus, "routed");
  assert.equal(result.validationMetrics.total, 0);
  assert.deepEqual(result.nodes.map(({ width, height }) => [width, height]), [[83, 47], [61, 39]]);
  assert.deepEqual(result.edges[0].points[0], getConnectionPoint(result.nodes[0], "exit", "source"));
  assert.equal(result.nodes[0].ports[0].y, 17);
  assert.equal(result.nodes[1].ports[0].y, 11);
  await assert.rejects(new MeasuredAnchorLayoutProvider().layoutMeasured(diagram), /complete MeasuredGraph/);
});

test("ELK measured entry preserves supplied ports through provider normalization and Adjust", async () => {
  const { measured } = neutralMeasurement();
  let input;
  const provider = new MeasuredElkLayoutProvider({ elkFactory: () => ({ layout: async (value) => {
    input = value;
    return { ...value, children: value.children.map((node, index) => ({ ...node, x: 240 * index, y: 30 })),
      edges: [{ ...value.edges[0], sections: [{ startPoint: { x: 83, y: 47 }, endPoint: { x: 240, y: 41 } }] }] };
  } }) });
  const result = await provider.layoutMeasured(measured);
  assert.equal(input.children[0].ports[0].y, 17);
  assert.equal(result.nodes[0].ports[0].y, 17);
  const adjusted = applyPositionedOverrides(result, { nodePositions: new Map([["a", { x: 10, y: 75 }]]) });
  const node = adjusted.nodes.find((entry) => entry.id === "a");
  assert.equal(node.ports[0].y, 17);
  assert.deepEqual(adjusted.edges[0].points[0], getConnectionPoint(node, "exit", "source"));
});

test("Netlist measurement resolves bubbles and reflow geometry before neutral layout", () => {
  const graph = { nodes: [{ id: "gate", kind: "cell", label: "gate", outputBubble: true, portDescriptors: [
    { pin: "A", direction: "input", side: "left" }, { pin: "B", direction: "input", side: "left" },
    { pin: "C", direction: "input", side: "top" }, { pin: "D", direction: "input", side: "top" },
    { pin: "Q", direction: "output", side: "right" }
  ] }], edges: [] };
  const node = materializeMeasuredGraph(measureNetlistGraph(graph, { cellPinPitch: 40 })).nodes[0];
  assert.deepEqual(node.connectionOffsets.source, { x: 10, y: 0 });
  for (const [width, height] of [[180, 160], [101.7, 55.9], [70, 20]]) {
    const sized = { ...node, width, height };
    const actual = resizeMeasuredPorts(sized).map(({ id, ...port }) => port);
    assert.deepEqual(actual, buildNodePorts(sized, sized, 40));
  }
});

test("production workspace selects measured entry while Simple retains its original path", async () => {
  const module = parseVerilog("module m(input a, output y); INV u(.A(a), .ZN(y)); endmodule").modules[0];
  const active = getLayoutProvider();
  let measuredCalls = 0;
  const provider = { id: active.id, measurementContract: active.measurementContract,
    layout() { throw new Error("raw compatibility entry must not run in product pipeline"); },
    layoutMeasured(graph, options) { measuredCalls += 1; return active.layoutMeasured(graph, options); } };
  const result = await buildModuleWorkspace({ module, layoutProvider: provider, useFanoutHubs: false });
  assert.equal(measuredCalls, 1);
  assert.equal(result.graph.layoutStatus, "routed");
  assert.equal(result.sourceGraph.nodes[0].portLayout, undefined);
  const simple = buildModuleWorkspace({ module, layoutProvider: getLayoutProvider("simple-layered"), useFanoutHubs: false });
  assert.equal(simple.autoGraph.nodes.some((node) => node.connectionOffsets || node.portLayout), false);
});

test("measured provider implementations cannot recreate semantic node geometry", () => {
  for (const name of ["measured_anchor_layout.js", "measured_elk_layout.js", "measured_geometry.js"]) {
    const source = readFileSync(new URL(`../../src/layout/${name}`, import.meta.url), "utf8");
    assert.doesNotMatch(source, /\b(?:buildNodePorts|measureNode|portDescriptors|outputBubble|buildFocusedFaninTreeBlocks)\b/);
    assert.doesNotMatch(source, /\bnode\.kind\b/);
  }
});

test("measurement snapshots isolate nested port metadata, policies and ordering groups", () => {
  const { diagram, nodes } = neutralMeasurement();
  const metadata = { labels: ["first"], flags: new Set(["visible"]) };
  nodes.get("a").ports[0].metadata = metadata;
  nodes.get("a").connectionOffsets = { source: { x: 10, y: 0 } };
  const policy = { mode: "side-distributed", pitch: 36 };
  for (const geometry of nodes.values()) geometry.portLayout = policy;
  const orderGroups = [{ nodeId: "a", ownerIds: ["b"] }];
  const measured = createMeasuredGraph(diagram, { nodes, orderGroups });
  metadata.labels[0] = "changed";
  metadata.flags.clear();
  policy.pitch = 72;
  nodes.get("a").connectionOffsets.source.x = 999;
  orderGroups[0].ownerIds.push("c");
  const geometry = measured.measurements.nodes.get("a");
  assert.equal(geometry.ports[0].metadata.labels[0], "first");
  assert.deepEqual([...geometry.ports[0].metadata.flags], ["visible"]);
  assert.equal(geometry.portLayout.pitch, 36);
  assert.equal(geometry.connectionOffsets.source.x, 10);
  assert.deepEqual(measured.measurements.orderGroups[0].ownerIds, ["b"]);
  assert.throws(() => measured.measurements.nodes.valueOf().clear(), TypeError);
  assert.throws(() => measured.measurements.nodes.forEach((value, key, map) => map.delete(key)), TypeError);
  assert.throws(() => Map.prototype.clear.call(measured.measurements.nodes), TypeError);
  assert.throws(() => { geometry.ports[0].metadata.labels.push("c"); }, TypeError);
  assert.throws(() => geometry.ports[0].metadata.flags.clear(), TypeError);
  nodes.get("a").ports[0].metadata = { callback() {} };
  assert.throws(() => createMeasuredGraph(diagram, { nodes }), /function values/);
});

test("materialization shares protected local geometry and resize copies before editing", () => {
  const { diagram, nodes } = neutralMeasurement();
  nodes.get("a").portLayout = { mode: "side-distributed", pitch: 36 };
  const measured = createMeasuredGraph(diagram, { nodes });
  const first = materializeMeasuredGraph(measured);
  const second = materializeMeasuredGraph(measured);
  const geometry = measured.measurements.nodes.get("a");
  assert.notEqual(first.nodes[0], second.nodes[0]);
  assert.equal(first.nodes[0].ports, geometry.ports);
  assert.throws(() => { first.nodes[0].ports[0].x = 999; }, TypeError);
  assert.throws(() => first.nodes[0].ports.push({}), TypeError);
  first.nodes[0].x = 123;
  assert.equal(second.nodes[0].x, undefined);
  const resized = resizeMeasuredPorts({ ...first.nodes[0], width: 200, height: 100 });
  assert.equal(resized[0].x, 200);
  assert.equal(resized[0].y, 50);
  assert.equal(geometry.ports[0].x, 83);
  assert.equal(geometry.ports[0].y, 17);
  resized[0].x = 456;
  assert.equal(second.nodes[0].ports[0].x, 83);
});

for (const fixture of [
  { name: "internal delimiter", sourceId: "a::b", sourcePort: "c", targetPort: "b::c" },
  { name: "boundary delimiter", sourceId: "a:", sourcePort: "b", targetPort: ":b" },
  { name: "virtual endpoint", sourceId: "a::b", sourcePort: null, targetPort: "b::virtual:source" }
]) test(`Anchor routes colliding ${fixture.name} IDs without changing public identities`, async () => {
  const diagram = { nodes: [{ id: fixture.sourceId }, { id: "a" }], edges: [{ id: "edge",
    source: fixture.sourceId, sourcePin: fixture.sourcePort, target: "a", targetPin: fixture.targetPort }] };
  const nodes = new Map([
    [fixture.sourceId, { width: 80, height: 40, ports: fixture.sourcePort === null ? [] : [
      { id: fixture.sourcePort, direction: "output", side: "right", x: 80, y: 20 }
    ] }],
    ["a", { width: 80, height: 40, ports: [
      { id: fixture.targetPort, direction: "input", side: "left", x: 0, y: 20 }
    ] }]
  ]);
  const inputBefore = structuredClone({ diagram, nodes });
  const provider = new MeasuredAnchorLayoutProvider();
  const result = await provider.layoutMeasured(createMeasuredGraph(diagram, { nodes }));
  assert.equal(result.layoutStatus, "routed");
  assert.equal(result.validationMetrics.total, 0);
  assert.deepEqual(result.nodes.map((node) => node.id), diagram.nodes.map((node) => node.id));
  assert.equal(result.nodes[1].ports[0].id, fixture.targetPort);
  assert.deepEqual(result.edges[0].points[0], getConnectionPoint(result.nodes[0], fixture.sourcePort, "source"));
  assert.deepEqual(result.edges[0].points.at(-1), getConnectionPoint(result.nodes[1], fixture.targetPort, "target"));
  assert.deepEqual({ diagram, nodes }, inputBefore);
  const permuted = await provider.layoutMeasured(createMeasuredGraph({ ...diagram, nodes: diagram.nodes.toReversed() }, { nodes }));
  assert.deepEqual(permuted.layoutMetrics, result.layoutMetrics);
  assert.deepEqual(permuted.nodes.toSorted((a, b) => a.id.localeCompare(b.id)), result.nodes.toSorted((a, b) => a.id.localeCompare(b.id)));
  assert.deepEqual(permuted.edges, result.edges);
});
