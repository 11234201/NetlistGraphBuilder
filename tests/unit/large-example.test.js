import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import test from "node:test";
import { createConeGraph } from "../../src/analysis/graphCone.js";
import { applyWorkspaceOverrides } from "../../src/app/layoutWorkspace.js";
import { getLayoutProvider } from "../../src/layout/layoutProvider.js";
import { buildSchematicGraph } from "../../src/netlist/graph.js";
import { parseVerilog } from "../../src/parser/verilogParser.js";
import { renderSchematicSvg } from "../../src/render/svgRenderer.js";
import { parseTimingLog } from "../../src/timing/timingParser.js";

const largeExampleUrl = new URL("../../examples/large_buffer_chain_1024.v", import.meta.url);
const escapedExampleUrl = new URL("../../examples/hierarchical_escaped_compare.v", import.meta.url);
const escapedTimingUrl = new URL("../../examples/hierarchical_escaped_timing.txt", import.meta.url);

test("concrete 1024-cell example supports a bounded output cone smoke flow", async () => {
  const design = parseVerilog(await readFile(largeExampleUrl, "utf8"));
  const module = design.modules[0];
  const graph = buildSchematicGraph(module);
  const layoutStartedAt = performance.now();
  const fullLayout = getLayoutProvider().layout(graph);
  const layoutElapsed = performance.now() - layoutStartedAt;
  const output = graph.nodes.find((node) => node.kind === "output" && node.ref?.name === "data_out");
  const cone = createConeGraph(graph, output.id, { direction: "fanin", maxDepth: 12 });
  const positioned = getLayoutProvider().layout(cone);
  const svg = renderSchematicSvg(positioned);
  const movedNode = fullLayout.nodes.find((node) => node.label === "u_buf_512");
  const adjustStartedAt = performance.now();
  const adjusted = applyWorkspaceOverrides(fullLayout, {
    nodePositions: new Map([[
      movedNode.id,
      { x: movedNode.x, y: movedNode.y + 96 }
    ]])
  });
  const previewSvg = renderSchematicSvg(adjusted, { wireBridges: false });
  const adjustElapsed = performance.now() - adjustStartedAt;

  assert.equal(module.cells.length, 1024);
  assert.equal(graph.edges.length, 1025);
  assert.equal(fullLayout.nodes.length, 1027);
  assert.ok(layoutElapsed < 5000, `whole layout took ${Math.round(layoutElapsed)}ms`);
  assert.ok(adjustElapsed < 2000, `Adjust preview took ${Math.round(adjustElapsed)}ms`);
  assert.ok(adjusted.edges.some((edge) => edge.routeStrategy));
  assert.match(previewSvg, /u_buf_512/);
  assert.doesNotMatch(previewSvg, /wire-bridge/);
  assert.equal(cone.nodes.length, 13);
  assert.match(svg, /large_buffer_chain_1024 schematic/);
  assert.match(svg, /u_buf_1023/);
});

test("renamed hierarchical compare and timing examples remain consumable", async () => {
  const design = parseVerilog(await readFile(escapedExampleUrl, "utf8"));
  const timing = parseTimingLog(await readFile(escapedTimingUrl, "utf8"));

  assert.equal(design.modules.length, 4);
  assert.ok(design.modules.some((module) => module.name.endsWith("_Flex")));
  assert.ok(design.modules.some((module) =>
    module.ports.some((port) => port.displayName === "\\u_dp_add_0/out0_33")
  ));
  assert.ok(timing.instanceCount > 0);
});
