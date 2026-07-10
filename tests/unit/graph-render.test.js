import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
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

test("fixture input edges stay clear of intermediate cells", async () => {
  const source = await readFile(fixtureUrl, "utf8");
  const design = parseVerilog(source);
  const graph = buildSchematicGraph(design.modules[0]);
  const laidOut = layoutGraph(graph);
  const inputEdges = laidOut.edges.filter((edge) => laidOut.nodes.find((node) => node.id === edge.source)?.kind === "input");

  assert.ok(inputEdges.length >= 2);
  assert.equal(edgesCrossingNonEndpoints({ ...laidOut, edges: inputEdges }).length, 0);
});

test("wire lane spacing is configurable", async () => {
  const source = await readFile(fixtureUrl, "utf8");
  const design = parseVerilog(source);
  const graph = buildSchematicGraph(design.modules[0]);
  const tight = layoutGraph(graph, { wireLanePitch: 10 });
  const loose = layoutGraph(graph, { wireLanePitch: 28 });

  assert.ok(minLongSourceLaneGap(tight) >= 10);
  assert.ok(minLongSourceLaneGap(loose) >= 28);
  assert.ok(loose.width > tight.width);
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

  assert.ok(["direct", "top-lane", "local-dogleg", "obstacle-lane"].includes(edge.routeKind));
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

  assert.ok(["top-lane", "obstacle-lane"].includes(edge.routeKind));
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

test("long misaligned skip-level pins can still use top lanes", () => {
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

  assert.equal(skipEdge.routeKind, "top-lane");
  assert.ok(skipEdge.points.some((point) => point.y < minNodeY));
});

test("wire labels are placed near target pins", () => {
  const graph = createRoutingTestGraph();
  const laidOut = layoutGraph(graph);
  const edge = laidOut.edges.find((candidate) => candidate.id === "edge:n1");
  const target = laidOut.nodes.find((node) => node.id === edge.target);
  const targetPoint = edge.points.at(-1);
  const pathMiddle = {
    x: (edge.points[0].x + edge.points.at(-1).x) / 2,
    y: (edge.points[0].y + edge.points.at(-1).y) / 2
  };

  assert.equal(edge.labelAnchor, "start");
  assert.ok(edge.labelPoint.x < target.x);
  assert.ok(Math.abs(edge.labelPoint.y - targetPoint.y) <= 8);
  assert.ok(Math.abs(edge.labelPoint.x - pathMiddle.x) > 20);
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
  const inputs = laidOut.nodes.filter((item) => item.kind === "input");
  const inputEdges = laidOut.edges.filter((edge) => edge.target === target.id);

  assert.ok(inputs.every((input) => input.x > 48));
  assert.ok(inputs.every((input) => input.x < target.x));
  assert.ok(inputEdges.every((edge) => edge.points[0].y === edge.points.at(-1).y));
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
  const nonDirectEdges = laidOut.edges.filter((edge) => edge.routeKind !== "direct");

  assert.equal(nodeById.get("cell:l_resyn1_u_gen_1").y, 80);
  assert.equal(nodeById.get("cell:remap37_u0").y, 80);
  assert.equal(nodeById.get("cell:remap37_u1").y, 62);
  assert.equal(nodeById.get("cell:l_resyn1_u_gen_0").y, 308);
  assert.equal(nodeById.get("cell:l_resyn1_u_gen_3").y, 308);
  assert.equal(nodeById.get("cell:l_resyn1_u_gen_5").y, 272);
  assert.equal(nodeById.get("assign:sco_891:sco_925").y, 333);
  assert.equal(nodeById.get("output:sco_891").y, 344);
  assert.deepEqual(nonDirectEdges.map((edge) => edge.label), ["sco_928"]);
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
    localizeSingleFanoutInputs: true
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
  const source = "module m(a,y); input a; output y; MYSTERY u0 (.A(a), .Z(y)); endmodule";
  const design = parseVerilog(source);
  const graph = buildSchematicGraph(design.modules[0]);
  const laidOut = layoutGraph(graph);
  const svg = renderSchematicSvg(laidOut);

  assert.ok(graph.nodes.some((node) => node.gateKind === "blackbox"));
  assert.match(svg, /class="node blackbox cell"/);
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

test("timing badges default to output AT and slack and allow multiple choices", () => {
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
        pinDirections: {
          A1: { direction: "input" },
          ZN: { direction: "output" }
        },
        ref: {
          instance: "u0",
          pins: [
            { pin: "A1", pinDisplayName: "A1" },
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
      { pin: "ZN", metric: "at" },
      { pin: "ZN", metric: "slack" }
    ]
  );
  assert.match(renderSchematicSvg(defaults), /ZN at 0\.424 slack -0\.334/);
  assert.equal(defaults.nodes[0].timing.badgePosition, "bottom-right");
  assert.match(renderSchematicSvg(defaults), /timing-badge-bottom-right[^>]*y="104"[^>]*text-anchor="end"/);
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

function minLongSourceLaneGap(graph) {
  const minNodeY = Math.min(...graph.nodes.map((node) => node.y));
  const laneXs = graph.edges
    .filter((edge) => edge.points.some((point) => point.y < minNodeY) && edge.points.length > 4)
    .map((edge) => edge.points[1].x);
  return minGap(laneXs);
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
