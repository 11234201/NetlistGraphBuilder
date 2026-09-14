import assert from "node:assert/strict";
import test from "node:test";
import { createSchematicScene } from "../../src/render/svgRenderer.js";
import { createNetlistScene, renderSchematicSvg } from "../../src/domains/netlist/netlist_scene.js";
import {
  createSvgScene,
  createProgressiveSvgSceneRenderPlan,
  renderSvgScene,
  serializeSvgPrimitive,
  svgElement,
  svgText
} from "../../src/render/svg_scene_renderer.js";
import { createNetlistNodePrimitive } from "../../src/domains/netlist/netlist_scene_presentation.js";

const graph = {
  moduleDisplayName: "scene & module",
  width: 320,
  height: 180,
  nodes: [{ id: "input:a", kind: "input", label: "a", x: 10, y: 20, width: 92, height: 28 }],
  edges: []
};

test("schematic scene is lazy and shares the generic SVG scene renderer", () => {
  const scene = createNetlistScene(graph);
  const plan = createProgressiveSvgSceneRenderPlan(scene);

  assert.equal(scene.nodeCount, 1);
  assert.equal(plan.renderNodes(0, 1).length, 1);
  assert.equal(renderSvgScene(scene), renderSchematicSvg(graph));
  assert.match(plan.openSvg, /aria-label="scene &amp; module schematic"/);
});

test("generic SVG scene renderer rejects graph-shaped input", () => {
  assert.throws(() => renderSvgScene(graph), /Expected an SVG scene/);
  assert.throws(() => createSchematicScene(graph), /node presentation/);
  assert.throws(() => createSvgScene({
    kind: "svg-scene.v1", bounds: { width: 10, height: 10 }, edgeCount: -1, nodeCount: 0,
    readEdges() { return []; }, readNodes() { return []; }
  }), /edgeCount/);
});

test("structured SVG primitives escape attributes and text centrally", () => {
  const primitive = svgElement("text", { class: "label", "data-name": 'a"&b' }, [svgText("<unsafe>")]);

  assert.equal(
    serializeSvgPrimitive(primitive),
    '<text class="label" data-name="a&quot;&amp;b">&lt;unsafe&gt;</text>'
  );
});

test("scene metadata is escaped at the generic renderer boundary", () => {
  const scene = createSvgScene({
    kind: "svg-scene.v1",
    bounds: { width: 10, height: 10 },
    ariaLabel: 'unsafe" onload="alert(1)',
    edgeCount: 0,
    nodeCount: 0,
    readEdges: () => [],
    readNodes: () => []
  });
  const svg = renderSvgScene(scene);
  assert.match(svg, /aria-label="unsafe&quot; onload=&quot;alert\(1\)"/);
  assert.doesNotMatch(svg, /"\s+onload=/);
  assert.throws(() => serializeSvgPrimitive(svgElement("g", { onload: "alert(1)" })), /Invalid SVG attribute/);
});

test("generic renderer rejects raw SVG fragments", () => {
  assert.throws(() => serializeSvgPrimitive('<script id="unsafe"></script>'), /Unknown SVG scene primitive/);
  assert.throws(() => serializeSvgPrimitive({ type: "fragment", markup: "<path></path>" }), /Unknown SVG scene primitive/);
});

test("Netlist presentation injection preserves legacy node geometry and markup", () => {
  const legacy = renderSvgScene(createNetlistScene(graph));
  const injected = renderSvgScene(createSchematicScene(graph, { createNodePrimitive: createNetlistNodePrimitive }));

  assert.equal(injected, legacy);
});

test("conventional gate symbols preserve the positioned bounds while changing only the primitive", () => {
  const cellGraph = {
    moduleDisplayName: "gates",
    width: 240,
    height: 160,
    nodes: [{
      id: "cell:u0",
      kind: "cell",
      gateKind: "xor",
      label: "u0",
      title: "XOR",
      subtitle: "XOR2",
      x: 40,
      y: 30,
      width: 160,
      height: 80,
      ports: [
        { pin: "A", direction: "input", side: "left", x: 0, y: 30 },
        { pin: "B", direction: "input", side: "left", x: 0, y: 50 },
        { pin: "Y", direction: "output", side: "right", x: 160, y: 40 }
      ]
    }],
    edges: []
  };
  const rectangle = renderSvgScene(createNetlistScene(cellGraph, {
    presentationPolicy: { gateSymbolMode: "rectangle" }
  }));
  const conventional = renderSvgScene(createNetlistScene(cellGraph, {
    presentationPolicy: { gateSymbolMode: "conventional" }
  }));

  assert.match(rectangle, /class="node xor cell"/);
  assert.match(rectangle, /<rect class="node-shape" x="40" y="30" width="160" height="80"><\/rect>/);
  assert.doesNotMatch(rectangle, /gate-extra-shape/);
  assert.match(conventional, /class="node xor cell gate-conventional"/);
  assert.match(conventional, /<path class="node-shape" d="M 40 42/);
  assert.match(conventional, /class="gate-extra-shape"/);
  assert.match(conventional, /class="gate-port-lead" x1="40" y1="60" x2="54" y2="60"/);
  assert.doesNotMatch(conventional, /<rect class="node-shape"/);
  assert.match(conventional, />XOR<\/text>/);
  assert.doesNotMatch(conventional, />u0<\/text>|>XOR2<\/text>|class="pin-label"/);
});
