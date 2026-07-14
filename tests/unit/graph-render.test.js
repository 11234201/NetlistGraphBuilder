import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { simplifyFanoutWithHubs } from "../../src/analysis/fanoutHub.js";
import { inferCellKind } from "../../src/infer/defaultCellRules.js";
import { compareLayoutGraphs, createLayoutGolden } from "../../src/layout/layoutGolden.js";
import { DEFAULT_LAYOUT_POLICY } from "../../src/layout/layoutPolicy.js";
import {
  DEFAULT_WIRE_LANE_PITCH,
  layoutGraph
} from "../../src/layout/simpleLayered.js";
import { snapNodePosition, snapToGrid } from "../../src/layout/snap.js";
import { buildSchematicGraph } from "../../src/netlist/graph.js";
import { parseVerilog } from "../../src/parser/verilogParser.js";
import { renderSchematicSvg } from "../../src/render/svgRenderer.js";
import { createStandaloneSvg } from "../../src/render/svgExport.js";
import { annotateGraphTiming } from "../../src/timing/timingAnnotation.js";
import { parseTimingLog } from "../../src/timing/timingParser.js";

const fixtureUrl = new URL("../fixtures/two_equivalent_style_modules.v", import.meta.url);

test("cell inference maps common foundry-like names", () => {
  assert.equal(inferCellKind("ND3X2APAH08HVT30P140").kind, "nand");
  assert.equal(inferCellKind("NR2X1ATPH08HVT30P140").kind, "nor");
  assert.equal(inferCellKind("CKINVX8H08HVT30P140").kind, "inv");
  assert.equal(inferCellKind("XNR2X2AONH08HVT30P140").kind, "xnor");
  assert.equal(inferCellKind("UNKNOWN_CELL").kind, "blackbox");
});

test("simple layout bounds levels when a sequential graph contains a large feedback cycle", () => {
  const cellCount = 600;
  const nodes = Array.from({ length: cellCount }, (_, index) => ({
    id: `cell:u${index}`,
    kind: "cell",
    label: `u${index}`,
    gateKind: "buffer",
    pinDirections: { A: { direction: "input" }, Z: { direction: "output" } },
    ref: { pins: [{ pin: "A", net: `n${index}` }, { pin: "Z", net: `n${index + 1}` }] }
  }));
  const edges = nodes.map((node, index) => ({
    id: `e${index}`,
    source: node.id,
    target: nodes[(index + 1) % cellCount].id,
    sourcePin: "Z",
    targetPin: "A",
    net: `n${index}`,
    label: `n${index}`
  }));

  const positioned = layoutGraph({
    moduleName: "feedback",
    moduleDisplayName: "feedback",
    nodes,
    edges,
    diagnostics: [],
    stats: { ports: 0, nets: cellCount, cells: cellCount, assigns: 0 }
  });

  assert.equal(positioned.nodes.length, cellCount);
  assert.ok(Math.max(...positioned.nodes.map((node) => node.level)) <= cellCount);
  assert.ok(positioned.width < cellCount * 1000);
});

test("large render plans skip quadratic wire bridge detection", () => {
  const edges = Array.from({ length: 1201 }, (_, index) => ({
    id: `e${index}`,
    net: `n${index}`,
    label: `n${index}`,
    points: [{ x: 0, y: index }, { x: 100, y: index }],
    labelPoint: { x: 50, y: index },
    labelAnchor: "start"
  }));
  const svg = renderSchematicSvg({
    moduleDisplayName: "large",
    width: 100,
    height: 1201,
    nodes: [],
    edges
  });

  assert.doesNotMatch(svg, /wire-bridge/);
  assert.match(svg, /data-edge-id="e1200"/);
});

test("graph and svg render fixture module", async () => {
  const source = await readFile(fixtureUrl, "utf8");
  const design = parseVerilog(source);
  const graph = buildSchematicGraph(design.modules[0]);
  const laidOut = layoutGraph(graph);
  const svg = renderSchematicSvg(laidOut);

  assert.ok(graph.nodes.some((node) => node.gateKind === "nand"));
  assert.ok(graph.nodes.some((node) => node.gateKind === "xor"));
  assert.ok(graph.edges.some((edge) => edge.label === "sco_891"));
  assert.match(svg, /<svg class="schematic-svg"/);
  assert.match(svg, /l_resyn3_u_gen_1395/);
  assert.match(svg, /class="node-meta"/);
});

test("hierarchical node names use only the leaf on canvas while preserving the full label", () => {
  const fullName = "\\u_dp_add_0/w_gen_726";
  const nodes = [
    { id: "input:h", kind: "input", label: fullName, x: 10, y: 10, width: 120, height: 28 },
    { id: "cell:h", kind: "cell", label: fullName, gateKind: "buffer", x: 180, y: 10, width: 128, height: 72, ports: [] },
    { id: "output:h", kind: "output", label: fullName, x: 360, y: 10, width: 120, height: 36 }
  ];
  const svg = renderSchematicSvg({ moduleDisplayName: "m", width: 520, height: 140, nodes, edges: [] });

  assert.equal(nodes[0].label, fullName);
  assert.equal(svg.match(/>w_gen_726<\/text>/g)?.length, 3);
  assert.equal(svg.match(/data-label="\\u_dp_add_0\/w_gen_726"/g)?.length, 3);
  assert.doesNotMatch(svg, /class="node-label"[^>]*>\\u_dp_add_0\/w_gen_726/);
});

test("standalone SVG export embeds namespace and schematic styles", () => {
  const exported = createStandaloneSvg('<svg class="schematic-svg" viewBox="0 0 10 10"><g></g></svg>');

  assert.match(exported, /^<\?xml version="1\.0"/);
  assert.match(exported, /xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
  assert.match(exported, /<style>[\s\S]*\.wire/);
  assert.match(exported, /<g><\/g><\/svg>$/);
});

test("cell metadata reports type, instance, output nets, and fanout", () => {
  const source = "module m(a,y1,y2); input a; output y1; output y2; wire n; BUF u0 (.A(a), .Z(n)); BUF u1 (.A(n), .Z(y1)); BUF u2 (.A(n), .Z(y2)); endmodule";
  const graph = buildSchematicGraph(parseVerilog(source).modules[0]);
  const node = graph.nodes.find((item) => item.id === "cell:u0");

  assert.deepEqual(node.metadata, {
    cellType: "BUF",
    instance: "u0",
    outputNets: ["n"],
    fanout: 2
  });
  assert.equal(node.metadataText, "BUF | n | fo 2");
});

test("visible timing badges suppress compact cell metadata", () => {
  const node = {
    id: "cell:u0",
    kind: "cell",
    gateKind: "buf",
    label: "u0",
    title: "BUF",
    subtitle: "BUFX1",
    metadataText: "BUFX1 | y | fo 1",
    x: 20,
    y: 20,
    width: 120,
    height: 72,
    ports: [],
    timing: {
      worstSlack: -0.1,
      badgePosition: "bottom-right",
      badges: [{ pin: "Z", metric: "slack", value: -0.1 }]
    }
  };
  const svg = renderSchematicSvg({ moduleDisplayName: "m", width: 180, height: 120, nodes: [node], edges: [] });

  assert.match(svg, /timing-badge/);
  assert.doesNotMatch(svg, /class="node-meta"/);
  assert.match(svg, /BUFX1 \| y \| fo 1/);
});

test("all fixture modules can be converted to renderable graphs", async () => {
  const source = await readFile(fixtureUrl, "utf8");
  const design = parseVerilog(source);

  for (const module of design.modules) {
    const graph = buildSchematicGraph(module);
    const laidOut = layoutGraph(graph);
    const svg = renderSchematicSvg(laidOut);

    assert.ok(graph.nodes.length > 0, `${module.name} should have graph nodes`);
    assert.ok(graph.edges.length > 0, `${module.name} should have graph edges`);
    assert.match(svg, /<svg class="schematic-svg"/);
  }
});

test("cell input edges connect to distinct pin positions", async () => {
  const source = await readFile(fixtureUrl, "utf8");
  const design = parseVerilog(source);
  const graph = buildSchematicGraph(design.modules[0]);
  const laidOut = layoutGraph(graph);
  const nandInputs = laidOut.edges.filter((edge) => edge.target === "cell:l_resyn3_u_gen_1395");
  const targetYs = new Set(nandInputs.map((edge) => edge.points.at(-1).y));
  const nandOutput = laidOut.edges.find((edge) => edge.source === "cell:l_resyn3_u_gen_1395");
  const nandNode = laidOut.nodes.find((node) => node.id === "cell:l_resyn3_u_gen_1395");

  assert.equal(nandInputs.length, 3);
  assert.equal(targetYs.size, 3);
  assert.equal(nandOutput.points[0].x, nandNode.x + nandNode.width + 10);
});

test("many tall cells in one level keep height-aware vertical spacing", () => {
  const pins = ["A1", "A2", "A3", "A4", "A5"].map((pin) => ({ pin, net: pin }));
  const graph = {
    moduleName: "dense",
    moduleDisplayName: "dense",
    nodes: Array.from({ length: 8 }, (_, index) => ({
      id: `cell:u${index}`,
      kind: "cell",
      label: `u${index}`,
      order: index,
      ref: { pins: [...pins, { pin: "ZN", net: `n${index}` }] },
      pinDirections: {
        A1: { direction: "input" }, A2: { direction: "input" },
        A3: { direction: "input" }, A4: { direction: "input" },
        A5: { direction: "input" }, ZN: { direction: "output" }
      }
    })),
    edges: [],
    diagnostics: [],
    stats: { ports: 0, nets: 8, cells: 8, assigns: 0 }
  };

  const laidOut = layoutGraph(graph);
  assert.equal(overlappingNodes(laidOut).length, 0);
  for (let index = 1; index < laidOut.nodes.length; index += 1) {
    assert.ok(laidOut.nodes[index].y >= laidOut.nodes[index - 1].y + laidOut.nodes[index - 1].height + 8);
  }
});

test("fixture input edges stay clear of intermediate cells", async () => {
  const source = await readFile(fixtureUrl, "utf8");
  const design = parseVerilog(source);
  const graph = buildSchematicGraph(design.modules[0]);
  const laidOut = layoutGraph(graph);
  const inputEdges = laidOut.edges.filter((edge) => laidOut.nodes.find((node) => node.id === edge.source)?.kind === "input");

  assert.ok(inputEdges.length >= 2);
  assert.equal(edgesCrossingNonEndpoints({ ...laidOut, edges: inputEdges }).length, 0);
});

test("fanout routing space follows configurable wire lane spacing", () => {
  const source = `module m(a,y0,y1,y2); input a; output y0,y1,y2; wire n;
BUF d (.A(a),.Z(n)); BUF u0 (.A(n),.Z(y0)); BUF u1 (.A(n),.Z(y1)); BUF u2 (.A(n),.Z(y2)); endmodule`;
  const graph = buildSchematicGraph(parseVerilog(source).modules[0]);
  const tight = layoutGraph(graph, { wireLanePitch: 10 });
  const loose = layoutGraph(graph, { wireLanePitch: 28 });

  assert.ok(loose.width > tight.width);
  assert.equal(edgesCrossingNonEndpoints(tight).length, 0);
  assert.equal(edgesCrossingNonEndpoints(loose).length, 0);
});

test("aligned skip-level pins use direct routing instead of top lane", () => {
  const graph = createRoutingTestGraph();
  const base = layoutGraph(graph);
  const source = base.nodes.find((node) => node.id === "input:a");
  const target = base.nodes.find((node) => node.id === "cell:u1");
  const sourcePinY = source.y + source.ports[0].y;
  const targetPinY = target.y + target.ports.find((port) => port.pin === "A").y;
  const adjusted = layoutGraph(graph, {
    nodePositions: {
      "cell:u0": {
        x: base.nodes.find((node) => node.id === "cell:u0").x,
        y: base.nodes.find((node) => node.id === "cell:u0").y + 120
      },
      [target.id]: {
        x: target.x,
        y: target.y + sourcePinY - targetPinY
      }
    }
  });
  const skipEdge = adjusted.edges.find((edge) => edge.id === "edge:skip");

  assert.equal(skipEdge.routeKind, "direct");
  assert.equal(skipEdge.points.length, 2);
  assert.equal(skipEdge.points[0].y, skipEdge.points.at(-1).y);
});

test("aligned skip-level pins avoid direct routing through intermediate cells", () => {
  const graph = createRoutingTestGraph();
  const base = layoutGraph(graph);
  const source = base.nodes.find((node) => node.id === "input:a");
  const target = base.nodes.find((node) => node.id === "cell:u1");
  const sourcePinY = source.y + source.ports[0].y;
  const targetPinY = target.y + target.ports.find((port) => port.pin === "A").y;
  const adjusted = layoutGraph(graph, {
    nodePositions: {
      [target.id]: {
        x: target.x,
        y: target.y + sourcePinY - targetPinY
      }
    }
  });
  const skipEdge = adjusted.edges.find((edge) => edge.id === "edge:skip");

  assert.notEqual(skipEdge.routeKind, "direct");
  assert.ok(skipEdge.points.some((point) => point.y < Math.min(...adjusted.nodes.map((node) => node.y))));
});

test("fixture input sco_897 does not route through intermediate cells", async () => {
  const source = await readFile(fixtureUrl, "utf8");
  const design = parseVerilog(source);
  const graph = buildSchematicGraph(design.modules[0]);
  const laidOut = layoutGraph(graph);
  const edge = laidOut.edges.find(
    (candidate) => candidate.label === "sco_897" && candidate.target === "cell:l_resyn3_u_gen_1395"
  );

  assert.ok(["direct", "local-dogleg", "obstacle-local", "obstacle-lane"].includes(edge.routeKind));
  assert.equal(edgesCrossingNonEndpoints({ ...laidOut, edges: [edge] }).length, 0);
});

test("moved input to the right of a target cell routes around the cell body", () => {
  const graph = createRoutingTestGraph();
  const base = layoutGraph(graph);
  const source = base.nodes.find((node) => node.id === "input:a");
  const target = base.nodes.find((node) => node.id === "cell:u0");
  const targetPinY = target.y + target.ports.find((port) => port.pin === "A").y;
  const sourcePinOffsetY = source.ports[0].y;
  const adjusted = layoutGraph(graph, {
    nodePositions: {
      [source.id]: {
        x: target.x + target.width + 120,
        y: targetPinY - sourcePinOffsetY
      }
    }
  });
  const edge = adjusted.edges.find((candidate) => candidate.id === "edge:n0");
  const adjustedTarget = adjusted.nodes.find((node) => node.id === edge.target);
  const targetPoint = edge.points.at(-1);
  const previousPoint = edge.points.at(-2);

  assert.ok(["obstacle-local", "obstacle-lane"].includes(edge.routeKind));
  assert.equal(targetPoint.x, adjustedTarget.x);
  assert.ok(previousPoint.x < targetPoint.x);
});

test("adjusted layout routes every wire around non-endpoint cells", () => {
  const graph = createRoutingTestGraph();
  const base = layoutGraph(graph);
  const source = base.nodes.find((node) => node.id === "input:a");
  const middle = base.nodes.find((node) => node.id === "cell:u0");
  const target = base.nodes.find((node) => node.id === "cell:u1");
  const adjusted = layoutGraph(graph, {
    nodePositions: {
      [middle.id]: {
        x: source.x + 260,
        y: 0
      },
      [target.id]: {
        x: target.x,
        y: target.y + 96
      }
    }
  });

  assert.equal(edgesCrossingNonEndpoints(adjusted).length, 0);
});

test("long misaligned skip-level pins prefer local routing over the graph top", () => {
  const graph = createRoutingTestGraph();
  const base = layoutGraph(graph);
  const target = base.nodes.find((node) => node.id === "cell:u1");
  const laidOut = layoutGraph(graph, {
    nodePositions: {
      [target.id]: { x: target.x, y: target.y + 96 }
    }
  });
  const skipEdge = laidOut.edges.find((edge) => edge.id === "edge:skip");
  const minNodeY = Math.min(...laidOut.nodes.map((node) => node.y));

  assert.notEqual(skipEdge.routeKind, "top-lane");
  assert.ok(skipEdge.points.every((point) => point.y >= minNodeY));
});

test("wire labels are placed near target pins", () => {
  const graph = createRoutingTestGraph();
  const laidOut = layoutGraph(graph);
  const edge = laidOut.edges.find((candidate) => candidate.id === "edge:n1");
  const target = laidOut.nodes.find((node) => node.id === edge.target);
  const targetPoint = edge.points.at(-1);
  assert.equal(edge.labelAnchor, "start");
  assert.ok(edge.labelPoint.x < target.x);
  assert.ok(Math.abs(edge.labelPoint.y - targetPoint.y) <= 8);
  assert.ok(targetPoint.x - edge.labelPoint.x <= 110);
});

test("snap helpers align to grid and connected pin y", () => {
  const graph = createRoutingTestGraph();
  const laidOut = layoutGraph(graph);
  const source = laidOut.nodes.find((node) => node.id === "input:a");
  const target = laidOut.nodes.find((node) => node.id === "cell:u1");
  const sourcePinY = source.y + source.ports[0].y;
  const targetPinOffset = target.ports.find((port) => port.pin === "A").y;
  const candidate = {
    x: target.x + 3,
    y: sourcePinY - targetPinOffset + 7
  };
  const snapped = snapNodePosition(laidOut, target.id, candidate, {
    gridSize: 8,
    pinSnapThreshold: 10
  });

  assert.deepEqual(snapToGrid({ x: 13, y: 19 }, 8), { x: 16, y: 16 });
  assert.ok(["n1", "skip"].includes(snapped.snap.net));
  assert.equal(snapped.position.y + targetPinOffset, snapped.snap.targetY);
});

test("layout node position overrides reroute connected edges", async () => {
  const source = await readFile(fixtureUrl, "utf8");
  const design = parseVerilog(source);
  const graph = buildSchematicGraph(design.modules[0]);
  const base = layoutGraph(graph);
  const node = base.nodes.find((item) => item.id === "cell:l_resyn3_u_gen_1395");
  const adjusted = layoutGraph(graph, {
    nodePositions: new Map([[node.id, { x: node.x + 48, y: node.y + 36 }]])
  });
  const adjustedNode = adjusted.nodes.find((item) => item.id === node.id);
  const adjustedInputEdge = adjusted.edges.find((edge) => edge.target === node.id);

  assert.equal(adjustedNode.x, node.x + 48);
  assert.equal(adjustedNode.y, node.y + 36);
  assert.equal(adjustedInputEdge.points.at(-1).x, adjustedNode.x);
  assert.ok(adjustedInputEdge.points.at(-1).y >= adjustedNode.y);
});

test("layout node size overrides redistribute pins and reroute edges", () => {
  const graph = createRoutingTestGraph();
  const base = layoutGraph(graph);
  const adjusted = layoutGraph(graph, {
    nodeSizes: {
      "cell:u1": {
        width: 160,
        height: 144
      }
    }
  });
  const baseTarget = base.nodes.find((item) => item.id === "cell:u1");
  const adjustedTarget = adjusted.nodes.find((item) => item.id === "cell:u1");
  const baseInputPin = baseTarget.ports.find((port) => port.pin === "A");
  const adjustedInputPin = adjustedTarget.ports.find((port) => port.pin === "A");
  const edge = adjusted.edges.find((item) => item.target === "cell:u1");

  assert.equal(adjustedTarget.width, 160);
  assert.equal(adjustedTarget.height, 144);
  assert.ok(adjustedInputPin.y > baseInputPin.y);
  assert.equal(edge.points.at(-1).y, adjustedTarget.y + adjustedInputPin.y);
});

test("cell pins use one port-unit spacing by default", async () => {
  const source = await readFile(fixtureUrl, "utf8");
  const design = parseVerilog(source);
  const graph = buildSchematicGraph(design.modules[0]);
  const laidOut = layoutGraph(graph);
  const cell = laidOut.nodes.find((item) => item.id === "cell:l_resyn3_u_gen_1395");
  const inputYs = cell.ports
    .filter((port) => port.direction === "input")
    .map((port) => port.y)
    .toSorted((left, right) => left - right);

  assert.ok(inputYs.length >= 3);
  assert.ok(minGap(inputYs) >= 36);
});

test("single-fanout inputs can localize near consuming cell pins", () => {
  const graph = createLocalityTestGraph();
  const laidOut = layoutGraph(graph, { localizeSingleFanoutInputs: true });
  const target = laidOut.nodes.find((item) => item.id === "cell:u0");
  const inputs = laidOut.nodes
    .filter((item) => item.kind === "input")
    .toSorted((left, right) => left.y - right.y);
  const inputEdges = laidOut.edges.filter((edge) => edge.target === target.id);

  assert.ok(inputs.every((input) => input.x > 48));
  assert.ok(inputs.every((input) => input.x < target.x));
  assert.ok(inputEdges.every((edge) => edge.points[0].y === edge.points.at(-1).y));
  assert.equal(inputs[1].y - (inputs[0].y + inputs[0].height), 8);
});

test("single-load chains stay compact and align each connection as a straight line", () => {
  const source = `module m(a,y); input a; output y; wire n0,n1;
BUF u0 (.A(a),.Z(n0)); BUF u1 (.A(n0),.Z(n1)); BUF u2 (.A(n1),.Z(y)); endmodule`;
  const laidOut = layoutGraph(buildSchematicGraph(parseVerilog(source).modules[0]));
  const cells = laidOut.nodes.filter((node) => node.kind === "cell").toSorted((a, b) => a.level - b.level);

  assert.ok(laidOut.edges.every((edge) => edge.routeKind === "direct"));
  for (let index = 1; index < cells.length; index += 1) {
    const gap = cells[index].x - (cells[index - 1].x + cells[index - 1].width);
    assert.ok(gap >= 40 && gap <= 72);
  }
});

test("multi-load nets reserve routing space and straighten the shallow primary cell branch", () => {
  const source = `module m(a,y0,y1,y2); input a; output y0,y1,y2; wire n;
BUF d (.A(a),.Z(n)); BUF u0 (.A(n),.Z(y0)); BUF u1 (.A(n),.Z(y1)); BUF u2 (.A(n),.Z(y2)); endmodule`;
  const laidOut = layoutGraph(buildSchematicGraph(parseVerilog(source).modules[0]));
  const fanoutEdges = laidOut.edges.filter((edge) => edge.net === "n");
  const driver = laidOut.nodes.find((node) => node.id === "cell:d");
  const targets = fanoutEdges.map((edge) => laidOut.nodes.find((node) => node.id === edge.target));
  const horizontalGap = Math.min(...targets.map((target) => target.x)) - (driver.x + driver.width);

  assert.equal(fanoutEdges.length, 3);
  assert.equal(fanoutEdges.filter((edge) => edge.routeKind === "direct").length, 1);
  assert.ok(fanoutEdges.every((edge) => edge.routeKind !== "top-lane"));
  assert.ok(horizontalGap >= 100);
  assert.equal(edgesCrossingNonEndpoints(laidOut).length, 0);
});

test("multi-fanout inputs center on shared hubs and use distinct net trunks", () => {
  const longInput = "very_long_multi_fanout_input_name_that_must_not_overlap_its_hub";
  const source = `module m(${longInput},b,y0,y1,y2,y3);
input ${longInput},b; output y0,y1,y2,y3;
BUF u0 (.A(${longInput}), .Z(y0)); BUF u1 (.A(${longInput}), .Z(y1));
BUF u2 (.A(b), .Z(y2)); BUF u3 (.A(b), .Z(y3));
endmodule`;
  const module = parseVerilog(source).modules[0];
  const laidOut = layoutGraph(simplifyFanoutWithHubs(buildSchematicGraph(module), {
    inputThreshold: 2
  }), { localizeSingleFanoutInputs: true });
  const hubs = laidOut.nodes.filter((node) => node.kind === "hub");

  assert.equal(hubs.length, 2);
  const trunkXs = [];
  for (const hub of hubs) {
    const loadEdges = laidOut.edges.filter((edge) => edge.source === hub.id);
    const loadYs = loadEdges.map((edge) => edge.points.at(-1).y).toSorted((a, b) => a - b);
    const expectedCenterY = (loadYs[0] + loadYs.at(-1)) / 2;
    const inputEdge = laidOut.edges.find((edge) => edge.target === hub.id);

    assert.equal(hub.y + hub.height / 2, expectedCenterY);
    assert.equal(inputEdge.routeKind, "direct");
    assert.equal(inputEdge.showLabel, false);
    assert.equal(inputEdge.points[0].y, inputEdge.points.at(-1).y);
    assert.ok(loadEdges.every((edge) => edge.showLabel === false));
    assert.ok(loadEdges.some((edge) => edge.routeKind === "fanout-trunk"));
    const trunkEdge = loadEdges.find((edge) => edge.routeKind === "fanout-trunk");
    trunkXs.push(trunkEdge.points[1].x);
  }
  assert.equal(new Set(trunkXs).size, hubs.length);
  assert.equal(overlappingNodes(laidOut).length, 0);
});

test("long localized input names do not overlap upstream cells", () => {
  const longInput = "very_long_hierarchical_input_name_that_must_fit_inside_the_port";
  const source = `module m(a, \\${longInput} , y);
input a; input \\${longInput} ; output y; wire n;
BUF u0 (.A(a), .Z(n));
AND2 u1 (.A1(n), .A2(\\${longInput} ), .Z(y));
endmodule`;
  const design = parseVerilog(source);
  const laidOut = layoutGraph(buildSchematicGraph(design.modules[0]), {
    localizeSingleFanoutInputs: true
  });
  const input = laidOut.nodes.find((node) => node.kind === "input" && node.ref.name === longInput);
  const inputEdge = laidOut.edges.find((edge) => edge.source === input.id);

  assert.ok(input.width > 220);
  assert.equal(inputEdge.routeKind, "direct");
  assert.equal(inputEdge.points[0].y, inputEdge.points.at(-1).y);
  assert.equal(overlappingNodes(laidOut).length, 0);
});

test("primary inputs stay left of cells and deep input nets route around obstacles by default", () => {
  const source = `module m(a,b,c,y);
input a,b,c; output y; wire n0;
BUF u0 (.A(a), .Z(n0));
AND3 u1 (.A1(n0), .A2(b), .A3(c), .Z(y));
endmodule`;
  const graph = layoutGraph(buildSchematicGraph(parseVerilog(source).modules[0]));
  const inputs = graph.nodes.filter((node) => node.kind === "input");
  const cells = graph.nodes.filter((node) => node.kind === "cell");

  assert.ok(inputs.every((input) => cells.every((cell) => input.x + input.width < cell.x)));
  assert.equal(edgesCrossingNonEndpoints(graph).length, 0);
  assert.equal(overlappingDifferentNetSegments(graph).length, 0);
});

test("early outputs stay near their drivers in multi-output graphs", () => {
  const source = `module m(a, early, y);
input a; output early; output y; wire n;
BUF u0 (.A(a), .Z(early));
BUF u1 (.A(early), .Z(n));
BUF u2 (.A(n), .Z(y));
endmodule`;
  const design = parseVerilog(source);
  const laidOut = layoutGraph(buildSchematicGraph(design.modules[0]));
  const early = laidOut.nodes.find((node) => node.id === "output:early");
  const final = laidOut.nodes.find((node) => node.id === "output:y");
  const earlyEdge = laidOut.edges.find((edge) => edge.target === early.id);

  assert.ok(early.level < final.level);
  assert.ok(["direct", "local-dogleg", "fanout-trunk", "obstacle-local"].includes(earlyEdge.routeKind));
  assert.equal(overlappingNodes(laidOut).length, 0);
});

test("golden-style default layout avoids input-cell overlap and straightens cell links", async () => {
  const source = await readFile(fixtureUrl, "utf8");
  const design = parseVerilog(source);
  const graph = buildSchematicGraph(design.modules[0]);
  const laidOut = layoutGraph(graph, {
    cellPinPitch: 36,
    alignCellLinks: true,
    localizeSingleFanoutInputs: true
  });
  const drivenEdges = laidOut.edges.filter((edge) => {
    const sourceNode = laidOut.nodes.find((node) => node.id === edge.source);
    const targetNode = laidOut.nodes.find((node) => node.id === edge.target);
    return sourceNode?.kind === "cell" && (targetNode?.kind === "cell" || targetNode?.kind === "output");
  });

  assert.equal(overlappingNodes(laidOut).length, 0);
  assert.ok(drivenEdges.length > 0);
  assert.ok(drivenEdges.every((edge) => edge.routeKind === "direct"));
});

test("branch-aware lanes approach the flex golden layout", async () => {
  const source = await readFile(fixtureUrl, "utf8");
  const design = parseVerilog(source);
  const module = design.modules.find((item) => item.name.endsWith("_Flex"));
  const graph = buildSchematicGraph(module);
  const laidOut = layoutGraph(graph, {
    layoutPolicy: DEFAULT_LAYOUT_POLICY
  });
  const nodeById = new Map(laidOut.nodes.map((node) => [node.id, node]));
  const nonDirectDrivenEdges = laidOut.edges.filter((edge) =>
    edge.routeKind !== "direct" && nodeById.get(edge.source)?.kind !== "input"
  );

  assert.equal(nodeById.get("cell:l_resyn1_u_gen_1").y, 80);
  assert.equal(nodeById.get("cell:remap37_u0").y, 80);
  assert.equal(nodeById.get("cell:remap37_u1").y, 62);
  assert.equal(nodeById.get("cell:l_resyn1_u_gen_0").y, 308);
  assert.equal(nodeById.get("cell:l_resyn1_u_gen_3").y, 308);
  assert.equal(nodeById.get("cell:l_resyn1_u_gen_5").y, 272);
  assert.equal(nodeById.get("assign:sco_891:sco_925").y, 333);
  assert.equal(nodeById.get("output:sco_891").y, 344);
  assert.deepEqual(nonDirectDrivenEdges.map((edge) => edge.label), ["sco_928"]);
});

test("legacy layout options remain compatible with layout policy", async () => {
  const source = await readFile(fixtureUrl, "utf8");
  const design = parseVerilog(source);
  const module = design.modules.find((item) => item.name.endsWith("_Flex"));
  const graph = buildSchematicGraph(module);
  const policyLayout = layoutGraph(graph, { layoutPolicy: DEFAULT_LAYOUT_POLICY });
  const legacyLayout = layoutGraph(graph, {
    cellPinPitch: 36,
    alignCellLinks: true,
    branchAwareLanes: true,
    localizeSingleFanoutInputs: false
  });

  assert.deepEqual(
    legacyLayout.nodes.map((node) => [node.id, node.x, node.y, node.width, node.height]),
    policyLayout.nodes.map((node) => [node.id, node.x, node.y, node.width, node.height])
  );
});

test("layout golden records moved nodes and diff summary", async () => {
  const source = await readFile(fixtureUrl, "utf8");
  const design = parseVerilog(source);
  const graph = buildSchematicGraph(design.modules[0]);
  const base = layoutGraph(graph);
  const node = base.nodes.find((item) => item.kind === "cell");
  const adjusted = layoutGraph(graph, {
    nodePositions: { [node.id]: { x: node.x + 20, y: node.y + 10 } }
  });
  const golden = createLayoutGolden(adjusted, { layoutOptions: { wireLanePitch: 18 } });
  const diff = compareLayoutGraphs(base, adjusted);

  assert.equal(golden.kind, "netlist-layout-golden");
  assert.equal(golden.layoutOptions.wireLanePitch, 18);
  assert.ok(golden.nodes.some((item) => item.id === node.id && item.x === node.x + 20));
  assert.ok(golden.nodes.every((item) => Number.isFinite(item.width) && Number.isFinite(item.height)));
  assert.equal(diff.movedNodeCount, 1);
  assert.equal(diff.maxMove, 22.4);
});

test("unknown cells render as blackboxes", () => {
  const source = "module m(a,y); input a; output y; AOI21X1APBH08HVT30P140 u0 (.A1(a), .ZN(y)); endmodule";
  const design = parseVerilog(source);
  const graph = buildSchematicGraph(design.modules[0]);
  const laidOut = layoutGraph(graph);
  const svg = renderSchematicSvg(laidOut);
  const node = graph.nodes.find((item) => item.kind === "cell");

  assert.equal(node.gateKind, "blackbox");
  assert.equal(node.title, "AOI21");
  assert.match(svg, /class="node blackbox cell"/);
  assert.match(svg, />AOI21<\/text>/);
  assert.match(svg, /<title>AOI21X1APBH08HVT30P140: u0;/);
  assert.match(svg, /AOI21X1APBH08HVT30P140 \| y \| fo 1/);
});

test("submodule instances use referenced module port directions", () => {
  const source = `module leaf(request,response);
input request; output response;
BUF u0 (.A(request), .Z(response));
endmodule
module top(a,y);
input a; output y;
leaf u_leaf (.request(a), .response(y));
endmodule`;
  const design = parseVerilog(source);
  const top = design.modules.find((module) => module.name === "top");
  const graph = buildSchematicGraph(top, { moduleLibrary: design.modules });
  const instance = graph.nodes.find((node) => node.id === "cell:u_leaf");

  assert.equal(instance.gateKind, "module");
  assert.equal(instance.title, "MODULE");
  assert.equal(instance.inferenceSource, "module-definition");
  assert.equal(instance.referencedModuleName, "leaf");
  assert.deepEqual(instance.pinDirections.request, {
    direction: "input",
    source: "module-definition",
    moduleName: "leaf"
  });
  assert.equal(instance.pinDirections.response.direction, "output");
  assert.ok(graph.edges.some((edge) => edge.source === "input:a" && edge.target === instance.id));
  assert.ok(graph.edges.some((edge) => edge.source === instance.id && edge.target === "output:y"));
  assert.ok(!graph.nodes.some((node) => node.id === "implicit:y"));

  const positionedInstance = layoutGraph(graph).nodes.find((node) => node.id === instance.id);
  assert.equal(positionedInstance.ports.find((port) => port.pin === "request").side, "left");
  assert.equal(positionedInstance.ports.find((port) => port.pin === "response").side, "right");
});

test("cell pin direction overrides repair unknown cell connectivity", () => {
  const source = "module m(a,y); input a; output y; MYSTERY u0 (.A(a), .B(y)); endmodule";
  const design = parseVerilog(source);
  const graph = buildSchematicGraph(design.modules[0], {
    overrides: {
      cellPinDirections: {
        u0: {
          B: "output"
        }
      }
    }
  });
  const laidOut = layoutGraph(graph);
  const outputEdge = graph.edges.find((edge) => edge.target === "output:y");
  const cell = laidOut.nodes.find((node) => node.id === "cell:u0");
  const bPort = cell.ports.find((port) => port.pin === "B");

  assert.equal(outputEdge.source, "cell:u0");
  assert.equal(outputEdge.sourcePin, "B");
  assert.equal(bPort.direction, "output");
  assert.equal(bPort.side, "right");
});

test("node property overrides update graph metadata", () => {
  const source = "module m(a,y); input a; output y; BUF u0 (.A(a), .Z(y)); endmodule";
  const design = parseVerilog(source);
  const graph = buildSchematicGraph(design.modules[0], {
    overrides: {
      nodeProperties: {
        "cell:u0": {
          label: "fixed_u0",
          title: "MANUAL",
          gateKind: "blackbox"
        }
      }
    }
  });
  const node = graph.nodes.find((item) => item.id === "cell:u0");

  assert.equal(node.label, "fixed_u0");
  assert.equal(node.title, "MANUAL");
  assert.equal(node.gateKind, "blackbox");
});

test("LocResyn timing logs attach pin timing to matching cells", () => {
  const timing = parseTimingLog(`[D][LocResyn] inst
<LoResynHinst_of_module_demo/u0>
input timing message: pin A1, at 0.453205, rt 0.100524, slack -0.352681 pin ZN,
at 0.423782, rt 0.090101, slack -0.333681
`);
  const graph = {
    nodes: [
      {
        id: "cell:u0",
        kind: "cell",
        label: "u0",
        ref: { instance: "u0" }
      }
    ],
    edges: []
  };
  const annotated = annotateGraphTiming(graph, timing);

  assert.equal(timing.instanceCount, 1);
  assert.equal(timing.instances.u0.worstPin, "A1");
  assert.equal(timing.instances.u0.pins.ZN.slack, -0.333681);
  assert.equal(annotated.nodes[0].timing.worstSlack, -0.352681);
  assert.equal(annotated.nodes[0].timing.badge.label, "A1 slack -0.353");
});

test("LocResyn timing parser accepts angle-bracket pin names", () => {
  const timing = parseTimingLog(`[D][LocResyn] inst
<LoResynHinst_of_module_demo/u0>
input timing message: pin<A1>, at 0.453205, rt 0.100524, slack -0.352681 pin <ZN>,
at 0.423782, rt 0.090101, slack -0.333681
`);

  assert.deepEqual(Object.keys(timing.instances.u0.pins), ["A1", "ZN"]);
  assert.equal(timing.instances.u0.pins.A1.at, 0.453205);
  assert.equal(timing.instances.u0.worstPin, "A1");
});

test("timing parser recognizes bare inst blocks in arbitrary order", () => {
  const timing = parseTimingLog(`noise before the marker
inst <top/u1>
pin ZN, at 0.200, rt 0.100, slack -0.020
unrelated text
INST<top/u0>
pin B, at 0.400, rt 0.300, slack -0.040
pin A, at 0.300, rt 0.200, slack -0.030`);

  assert.equal(timing.instanceCount, 2);
  assert.equal(timing.instances.u1.pins.ZN.slack, -0.02);
  assert.deepEqual(Object.keys(timing.instances.u0.pins), ["B", "A"]);
  assert.equal(timing.instances.u0.worstPin, "B");
});

test("LocResyn timing uses the longest hierarchical instance suffix", () => {
  const timing = parseTimingLog(`[D][LocResyn] inst
<LoResynHinst_of_module_demo_gen_212/u_dp_add_0/GNUWA_DYNAMIC_ADDER_gen_1234_0>
input timing message: pin Z, at 0.818539, rt 0.813487, slack -0.005052
`);
  const graph = {
    nodes: [
      {
        id: "cell:leaf",
        kind: "cell",
        label: "GNUWA_DYNAMIC_ADDER_gen_1234_0",
        ref: { instance: "GNUWA_DYNAMIC_ADDER_gen_1234_0" }
      },
      {
        id: "cell:hierarchical",
        kind: "cell",
        label: "\\u_dp_add_0/GNUWA_DYNAMIC_ADDER_gen_1234_0",
        ref: { instance: "u_dp_add_0/GNUWA_DYNAMIC_ADDER_gen_1234_0" }
      }
    ],
    edges: []
  };
  const annotated = annotateGraphTiming(graph, timing);

  assert.equal(timing.records[0].fullPath, "LoResynHinst_of_module_demo_gen_212/u_dp_add_0/GNUWA_DYNAMIC_ADDER_gen_1234_0");
  assert.equal(annotated.nodes[0].timing, undefined);
  assert.equal(annotated.nodes[1].timing.pins.Z.slack, -0.005052);
});

test("LocResyn timing scopes duplicate Flex instance names to the current module", () => {
  const firstModule = "root_is_u_dp_add_0/GNUWA_DYNAMIC_ADDER_gen_1208_0_1_83091_2_Flex";
  const secondModule = "root_is_u_dp_add_0/GNUWA_DYNAMIC_ADDER_gen_1134_0_13_78272_7_Flex";
  const timing = parseTimingLog(`[D][LocResyn] inst
<${firstModule}_ConeInst/l_resyn1_u_gen_1>
input timing message: pin Z, at 0.179111, rt 0.170000, slack -0.009111
[D][LocResyn] inst
<${firstModule}_ConeInst/l_resyn1_u_gen_0>
input timing message: pin ZN, at 0.062084, rt 0.050000, slack -0.012084
[D][LocResyn] inst
<${secondModule}_ConeInst/l_resyn1_u_gen_1>
input timing message: pin Z, at 0.185934, rt 0.180000, slack -0.005934
[D][LocResyn] inst
<${secondModule}_ConeInst/l_resyn1_u_gen_0>
input timing message: pin ZN, at 0.027266, rt 0.020000, slack -0.007266
`);
  const makeGraph = (moduleName) => ({
    moduleName,
    nodes: ["l_resyn1_u_gen_0", "l_resyn1_u_gen_1"].map((instance) => ({
      id: `cell:${instance}`,
      kind: "cell",
      label: instance,
      ref: { instance }
    })),
    edges: []
  });

  const first = annotateGraphTiming(makeGraph(firstModule), timing);
  const second = annotateGraphTiming(makeGraph(secondModule), timing);

  assert.equal(first.nodes[0].timing.fullPath, `${firstModule}_ConeInst/l_resyn1_u_gen_0`);
  assert.equal(first.nodes[1].timing.fullPath, `${firstModule}_ConeInst/l_resyn1_u_gen_1`);
  assert.equal(second.nodes[0].timing.fullPath, `${secondModule}_ConeInst/l_resyn1_u_gen_0`);
  assert.equal(second.nodes[1].timing.fullPath, `${secondModule}_ConeInst/l_resyn1_u_gen_1`);
});

test("timing badge choices select the cell corner metric", () => {
  const timing = parseTimingLog(`[D][LocResyn] inst
<LoResynHinst_of_module_demo/u0>
input timing message: pin A1, at 0.453205, rt 0.100524, slack -0.352681 pin ZN,
at 0.423782, rt 0.090101, slack -0.333681
`);
  const graph = {
    moduleDisplayName: "timing",
    width: 220,
    height: 160,
    nodes: [
      {
        id: "cell:u0",
        kind: "cell",
        gateKind: "buf",
        label: "u0",
        title: "BUF",
        x: 40,
        y: 40,
        width: 120,
        height: 72,
        ports: [],
        ref: { instance: "u0" }
      }
    ],
    edges: []
  };
  const annotated = annotateGraphTiming(graph, timing, {
    badgeChoices: {
      u0: { pin: "ZN", metric: "at" }
    }
  });
  const svg = renderSchematicSvg(annotated);

  assert.equal(annotated.nodes[0].timing.badge.label, "ZN at 0.424");
  assert.match(svg, /ZN at 0\.424/);
});

test("timing badges default to all input AT plus output AT and slack", () => {
  const timing = parseTimingLog(`[D][LocResyn] inst
<LoResynHinst_of_module_demo/u0>
input timing message: pin A1, at 0.453205, rt 0.100524, slack -0.352681 pin ZN,
at 0.423782, rt 0.090101, slack -0.333681 pin A2,
at 0.401234, rt 0.110101, slack -0.291133
`);
  const graph = {
    moduleDisplayName: "timing",
    width: 220,
    height: 160,
    nodes: [
      {
        id: "cell:u0",
        kind: "cell",
        gateKind: "buf",
        label: "u0",
        title: "BUF",
        x: 40,
        y: 40,
        width: 120,
        height: 72,
        ports: [],
        pinDirections: {
          A1: { direction: "input" },
          A2: { direction: "input" },
          ZN: { direction: "output" }
        },
        ref: {
          instance: "u0",
          pins: [
            { pin: "A1", pinDisplayName: "A1" },
            { pin: "A2", pinDisplayName: "A2" },
            { pin: "ZN", pinDisplayName: "ZN" }
          ]
        }
      }
    ],
    edges: []
  };
  const defaults = annotateGraphTiming(graph, timing);
  const selected = annotateGraphTiming(graph, timing, {
    badgeChoices: {
      u0: [
        { pin: "A1", metric: "at" },
        { pin: "ZN", metric: "slack" }
      ]
    }
  });
  const hidden = annotateGraphTiming(graph, timing, {
    badgeChoices: { u0: [] }
  });

  assert.deepEqual(
    defaults.nodes[0].timing.badges.map(({ pin, metric }) => ({ pin, metric })),
    [
      { pin: "A1", metric: "at" },
      { pin: "A2", metric: "at" },
      { pin: "ZN", metric: "at" },
      { pin: "ZN", metric: "slack" }
    ]
  );
  assert.match(renderSchematicSvg(defaults), /A1 at 0\.453/);
  assert.match(renderSchematicSvg(defaults), /A2 at 0\.401/);
  assert.match(renderSchematicSvg(defaults), /ZN at 0\.424 slack -0\.334/);
  assert.equal(defaults.nodes[0].timing.badgePosition, "bottom-right");
  assert.match(renderSchematicSvg(defaults), /timing-badge-bottom-right[^>]*y="82"[^>]*text-anchor="end"/);
  assert.match(renderSchematicSvg(selected), /A1 at 0\.453/);
  assert.match(renderSchematicSvg(selected), /ZN slack -0\.334/);
  assert.doesNotMatch(renderSchematicSvg(hidden), /timing-badge/);
});

test("timing badge position supports every cell corner", () => {
  const timing = parseTimingLog(`[D][LocResyn] inst
<LoResynHinst_of_module_demo/u0>
input timing message: pin ZN, at 0.423782, rt 0.090101, slack -0.333681
`);
  const graph = {
    moduleDisplayName: "timing",
    width: 220,
    height: 160,
    nodes: [{
      id: "cell:u0",
      kind: "cell",
      gateKind: "buf",
      label: "u0",
      title: "BUF",
      x: 40,
      y: 40,
      width: 120,
      height: 72,
      ports: [],
      ref: { instance: "u0" }
    }],
    edges: []
  };
  const topLeft = annotateGraphTiming(graph, timing, {
    badgeChoices: { u0: [{ pin: "ZN", metric: "at" }] },
    badgePositions: { u0: "top-left" }
  });
  const bottomLeft = annotateGraphTiming(graph, timing, {
    badgeChoices: { u0: [{ pin: "ZN", metric: "at" }] },
    badgePositions: { u0: "bottom-left" }
  });

  assert.match(renderSchematicSvg(topLeft), /timing-badge-top-left[^>]*x="46"[^>]*y="54"[^>]*text-anchor="start"/);
  assert.match(renderSchematicSvg(bottomLeft), /timing-badge-bottom-left[^>]*x="46"[^>]*y="104"[^>]*text-anchor="start"/);
});

test("svg marks cells and pins with critical timing", () => {
  const svg = renderSchematicSvg({
    moduleDisplayName: "timing",
    width: 220,
    height: 160,
    nodes: [
      {
        id: "cell:u0",
        kind: "cell",
        gateKind: "buf",
        label: "u0",
        title: "BUF",
        x: 40,
        y: 40,
        width: 120,
        height: 72,
        ports: [{ pin: "A1", direction: "input", side: "left", x: 0, y: 36 }],
        timing: {
          worstPin: "A1",
          worstSlack: -0.35,
          pins: {
            A1: { pin: "A1", at: 0.4, rt: 0.1, slack: -0.35 }
          }
        }
      }
    ],
    edges: []
  });

  assert.match(svg, /timing-critical/);
  assert.match(svg, /pin-critical/);
  assert.match(svg, /-0\.350/);
});

test("svg marks crossing wires with bridges", () => {
  const svg = renderSchematicSvg({
    moduleDisplayName: "crossing",
    width: 220,
    height: 180,
    nodes: [],
    edges: [
      {
        id: "edge:h",
        net: "h",
        label: "h",
        points: [
          { x: 20, y: 80 },
          { x: 180, y: 80 }
        ],
        labelPoint: { x: 90, y: 72 }
      },
      {
        id: "edge:v",
        net: "v",
        label: "v",
        points: [
          { x: 100, y: 30 },
          { x: 100, y: 140 }
        ],
        labelPoint: { x: 104, y: 82 }
      }
    ]
  });

  assert.match(svg, /wire-hit-area/);
  assert.match(svg, /wire-bridge-cutout/);
  assert.match(svg, /wire-bridge/);
});

test("same-net crossings do not render bridges", () => {
  const svg = renderSchematicSvg({
    moduleDisplayName: "junction",
    width: 220,
    height: 180,
    nodes: [],
    edges: [
      {
        id: "edge:h",
        net: "n",
        label: "n",
        points: [
          { x: 20, y: 80 },
          { x: 180, y: 80 }
        ],
        labelPoint: { x: 90, y: 72 }
      },
      {
        id: "edge:v",
        net: "n",
        label: "n",
        points: [
          { x: 100, y: 30 },
          { x: 100, y: 140 }
        ],
        labelPoint: { x: 104, y: 82 }
      }
    ]
  });

  assert.doesNotMatch(svg, /wire-bridge-cutout/);
});

function createRoutingTestGraph() {
  return {
    moduleName: "routing_test",
    moduleDisplayName: "routing_test",
    diagnostics: [],
    stats: {
      ports: 1,
      nets: 3,
      cells: 2,
      assigns: 0
    },
    nodes: [
      {
        id: "input:a",
        kind: "input",
        label: "a",
        title: "INPUT",
        order: 0
      },
      {
        id: "cell:u0",
        kind: "cell",
        gateKind: "buf",
        inferenceSource: "rule",
        label: "u0",
        title: "BUF",
        subtitle: "BUF",
        ref: {
          pins: [
            { pin: "A", pinDisplayName: "A" },
            { pin: "Z", pinDisplayName: "Z" }
          ]
        }
      },
      {
        id: "cell:u1",
        kind: "cell",
        gateKind: "buf",
        inferenceSource: "rule",
        label: "u1",
        title: "BUF",
        subtitle: "BUF",
        ref: {
          pins: [
            { pin: "A", pinDisplayName: "A" },
            { pin: "Z", pinDisplayName: "Z" }
          ]
        }
      }
    ],
    edges: [
      {
        id: "edge:n0",
        source: "input:a",
        target: "cell:u0",
        net: "n0",
        label: "n0",
        sourcePin: "a",
        targetPin: "A"
      },
      {
        id: "edge:n1",
        source: "cell:u0",
        target: "cell:u1",
        net: "n1",
        label: "n1",
        sourcePin: "Z",
        targetPin: "A"
      },
      {
        id: "edge:skip",
        source: "input:a",
        target: "cell:u1",
        net: "skip",
        label: "skip",
        sourcePin: "a",
        targetPin: "A"
      }
    ]
  };
}

function createLocalityTestGraph() {
  return {
    moduleName: "locality_test",
    moduleDisplayName: "locality_test",
    diagnostics: [],
    stats: {
      ports: 2,
      nets: 2,
      cells: 1,
      assigns: 0
    },
    nodes: [
      {
        id: "input:a",
        kind: "input",
        label: "a",
        title: "INPUT",
        order: 0
      },
      {
        id: "input:b",
        kind: "input",
        label: "b",
        title: "INPUT",
        order: 1
      },
      {
        id: "cell:u0",
        kind: "cell",
        gateKind: "and",
        inferenceSource: "rule",
        label: "u0",
        title: "AND",
        subtitle: "AND",
        ref: {
          pins: [
            { pin: "A1", pinDisplayName: "A1" },
            { pin: "A2", pinDisplayName: "A2" },
            { pin: "Z", pinDisplayName: "Z" }
          ]
        }
      }
    ],
    edges: [
      {
        id: "edge:a",
        source: "input:a",
        target: "cell:u0",
        net: "a",
        label: "a",
        sourcePin: "a",
        targetPin: "A1"
      },
      {
        id: "edge:b",
        source: "input:b",
        target: "cell:u0",
        net: "b",
        label: "b",
        sourcePin: "b",
        targetPin: "A2"
      }
    ]
  };
}

function minGap(values) {
  const sorted = values.toSorted((left, right) => left - right);
  let gap = Number.POSITIVE_INFINITY;
  for (let index = 1; index < sorted.length; index += 1) {
    gap = Math.min(gap, sorted[index] - sorted[index - 1]);
  }
  return gap;
}

function edgesCrossingNonEndpoints(graph) {
  const crossings = [];
  for (const edge of graph.edges) {
    for (let index = 0; index < edge.points.length - 1; index += 1) {
      const start = edge.points[index];
      const end = edge.points[index + 1];
      for (const node of graph.nodes) {
        if (node.id === edge.source || node.id === edge.target) {
          continue;
        }
        if (segmentIntersectsNode(start, end, node)) {
          crossings.push({ edgeId: edge.id, nodeId: node.id });
        }
      }
    }
  }
  return crossings;
}

function overlappingDifferentNetSegments(graph) {
  const overlaps = [];
  for (let leftIndex = 0; leftIndex < graph.edges.length; leftIndex += 1) {
    const left = graph.edges[leftIndex];
    for (let rightIndex = leftIndex + 1; rightIndex < graph.edges.length; rightIndex += 1) {
      const right = graph.edges[rightIndex];
      if (left.net === right.net) continue;
      for (let leftPoint = 0; leftPoint < left.points.length - 1; leftPoint += 1) {
        for (let rightPoint = 0; rightPoint < right.points.length - 1; rightPoint += 1) {
          if (segmentsOverlap(
            left.points[leftPoint], left.points[leftPoint + 1],
            right.points[rightPoint], right.points[rightPoint + 1]
          )) {
            overlaps.push({ leftEdgeId: left.id, rightEdgeId: right.id });
          }
        }
      }
    }
  }
  return overlaps;
}

function segmentsOverlap(a1, a2, b1, b2) {
  if (a1.y === a2.y && b1.y === b2.y && a1.y === b1.y) {
    return rangesOverlap(a1.x, a2.x, b1.x, b2.x);
  }
  if (a1.x === a2.x && b1.x === b2.x && a1.x === b1.x) {
    return rangesOverlap(a1.y, a2.y, b1.y, b2.y);
  }
  return false;
}

function rangesOverlap(a1, a2, b1, b2) {
  return Math.min(Math.max(a1, a2), Math.max(b1, b2)) >
    Math.max(Math.min(a1, a2), Math.min(b1, b2));
}

function overlappingNodes(graph) {
  const overlaps = [];
  for (let leftIndex = 0; leftIndex < graph.nodes.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < graph.nodes.length; rightIndex += 1) {
      const left = graph.nodes[leftIndex];
      const right = graph.nodes[rightIndex];
      if (nodesOverlap(left, right)) {
        overlaps.push({ leftId: left.id, rightId: right.id });
      }
    }
  }
  return overlaps;
}

function nodesOverlap(left, right) {
  return (
    left.x < right.x + right.width &&
    left.x + left.width > right.x &&
    left.y < right.y + right.height &&
    left.y + left.height > right.y
  );
}

function segmentIntersectsNode(start, end, node) {
  const padding = 8;
  const box = {
    left: node.x - padding,
    right: node.x + node.width + padding,
    top: node.y - padding,
    bottom: node.y + node.height + padding
  };
  if (start.y === end.y) {
    const x1 = Math.min(start.x, end.x);
    const x2 = Math.max(start.x, end.x);
    return start.y >= box.top && start.y <= box.bottom && x2 > box.left && x1 < box.right;
  }
  if (start.x === end.x) {
    const y1 = Math.min(start.y, end.y);
    const y2 = Math.max(start.y, end.y);
    return start.x >= box.left && start.x <= box.right && y2 > box.top && y1 < box.bottom;
  }
  return false;
}
