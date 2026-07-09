import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { inferCellKind } from "../../src/infer/defaultCellRules.js";
import { compareLayoutGraphs, createLayoutGolden } from "../../src/layout/layoutGolden.js";
import {
  DEFAULT_TOP_WIRE_LANE_PITCH,
  DEFAULT_WIRE_LANE_PITCH,
  layoutGraph
} from "../../src/layout/simpleLayered.js";
import { snapNodePosition, snapToGrid } from "../../src/layout/snap.js";
import { buildSchematicGraph } from "../../src/netlist/graph.js";
import { parseVerilog } from "../../src/parser/verilogParser.js";
import { renderSchematicSvg } from "../../src/render/svgRenderer.js";

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

test("long skip-level input edges route through top wire lanes", async () => {
  const source = await readFile(fixtureUrl, "utf8");
  const design = parseVerilog(source);
  const graph = buildSchematicGraph(design.modules[0]);
  const laidOut = layoutGraph(graph);
  const longEdges = laidOut.edges.filter(
    (edge) =>
      edge.points.some((point) => point.y < Math.min(...laidOut.nodes.map((node) => node.y))) &&
      edge.points.length > 4
  );
  const minNodeY = Math.min(...laidOut.nodes.map((node) => node.y));
  const topLaneYs = new Set(longEdges.map((edge) => Math.min(...edge.points.map((point) => point.y))));
  const sourceLaneXs = new Set(longEdges.map((edge) => edge.points[1].x));
  const targetLaneXs = new Set(longEdges.map((edge) => edge.points.at(-2).x));

  assert.ok(longEdges.length >= 2);
  assert.equal(topLaneYs.size, longEdges.length);
  assert.equal(sourceLaneXs.size, longEdges.length);
  assert.equal(targetLaneXs.size, longEdges.length);
  assert.ok(minGap([...topLaneYs]) >= DEFAULT_TOP_WIRE_LANE_PITCH);
  assert.ok(minGap([...sourceLaneXs]) >= DEFAULT_WIRE_LANE_PITCH);
  assert.ok(minGap([...targetLaneXs]) >= DEFAULT_WIRE_LANE_PITCH);
  assert.ok(longEdges.every((edge) => edge.points.some((point) => point.y < minNodeY)));
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

  assert.equal(edge.routeKind, "top-lane");
  assert.ok(edge.points.some((point) => point.y < Math.min(...laidOut.nodes.map((node) => node.y))));
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

  assert.equal(edge.routeKind, "top-lane");
  assert.equal(targetPoint.x, adjustedTarget.x);
  assert.ok(previousPoint.x < targetPoint.x);
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
