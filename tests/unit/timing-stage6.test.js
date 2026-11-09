import assert from "node:assert/strict";
import test from "node:test";
import { createAppState } from "../../src/app/appState.js";
import { createInputController } from "../../src/app/input_controller.js";
import { detectQuickInputKind } from "../../src/app/quickInput.js";
import { sampleTiming } from "../../src/app/sampleTiming.js";
import { createDocumentStore } from "../../src/application/document_store.js";
import { buildWorkspaceGraph } from "../../src/domains/netlist/netlist_graph_projection.js";
import { renderSchematicSvg } from "../../src/domains/netlist/netlist_scene.js";
import { DEFAULT_LAYOUT_POLICY } from "../../src/layout/layoutPolicy.js";
import { layoutGraph } from "../../src/layout/simpleLayered.js";
import { parseVerilog } from "../../src/parser/verilogParser.js";
import {
  annotateGraphTiming,
  normalizeTimingDisplayPolicy
} from "../../src/timing/timingAnnotation.js";
import { parseTimingLog } from "../../src/timing/timingParser.js";
import { renderNetTimingPanel, renderTimingPanel } from "../../src/ui/timingPanel.js";

test("tabular timing parser supports simple 4-column, missing values, and slack auto-inference", () => {
  const source = `
# Pre-map & Post-map timing sample
@module alu_core
@stage pre_map
@unit ns

point       at      rt      slack
in_a[0]     0.120   0.100   -0.020
out_sum[0]  0.850   0.800   -
clk         0.000   -       -
`;
  const timing = parseTimingLog(source);
  assert.equal(timing.format, "tabular");
  assert.equal(timing.module, "alu_core");
  assert.equal(timing.stage, "pre_map");
  assert.equal(timing.unit, "ns");
  assert.equal(timing.recordCount, 3);
  assert.equal(timing.records[0].point, "in_a[0]");
  assert.equal(timing.records[0].slack, -0.02);
  assert.equal(timing.records[0].slackDerived, false);
  assert.equal(timing.records[1].point, "out_sum[0]");
  assert.equal(timing.records[1].slack, -0.05);
  assert.equal(timing.records[1].slackDerived, true);
  assert.equal(timing.records[2].rt, null);
  assert.equal(timing.records[2].slack, null);
  assert.equal(detectQuickInputKind(source), "timing");
});

test("detailed tabular timing supports delay, slew, edge, and kind columns", () => {
  const source = `
@module alu_core
@stage post_layout
@unit ns
point        at     rt     slack   delay  slew   edge  kind
in_a[0]      0.120  0.100  -0.020  0.000  0.015  r     port
u_buf/A      0.125  0.105  -0.020  0.005  0.022  r     pin
u_buf/Z      0.165  0.145  -0.020  0.040  0.018  r     pin
`;
  const timing = parseTimingLog(source);
  assert.equal(timing.stage, "post_layout");
  assert.equal(timing.recordCount, 3);
  assert.equal(timing.records[1].delay, 0.005);
  assert.equal(timing.records[1].slew, 0.022);
  assert.equal(timing.records[1].edge, "r");
  assert.equal(timing.records[1].kind, "pin");
});

test("JSON timing parser supports compact arrays, detailed objects, and multi-module dictionaries", () => {
  const jsonText = JSON.stringify({
    version: "1.0",
    stage: "post_layout",
    unit: "ns",
    modules: {
      mod_before: {
        points: {
          "in_a": [0.1, 0.2, 0.1],
          "u0/Z": { at: 0.35, rt: 0.3, delay: 0.08, slew: 0.02, edge: "f", kind: "pin" }
        }
      },
      mod_after: {
        points: {
          "u0/Z": [0.28, 0.3, 0.02]
        }
      }
    }
  });
  const timing = parseTimingLog(jsonText);
  assert.equal(timing.format, "json");
  assert.equal(timing.stage, "post_layout");
  assert.equal(timing.recordCount, 3);
  assert.equal(timing.scopes.mod_before.length, 2);
  assert.equal(timing.scopes.mod_before[1].slack, -0.05);
  assert.equal(timing.scopes.mod_before[1].slackDerived, true);
  assert.equal(timing.scopes.mod_before[1].delay, 0.08);
  assert.equal(timing.scopes.mod_after.length, 1);
  assert.equal(detectQuickInputKind(jsonText), "timing");
});

test("disambiguates escaped port names containing '/' from cell instance pins", () => {
  const verilog = `
module \\top_mod (\\u_dp_add_0/w_gen_1207 , out_y);
  input \\u_dp_add_0/w_gen_1207 ;
  output out_y;
  BUF \\u_dp_add_0/u_buf_0 (.A(\\u_dp_add_0/w_gen_1207 ), .Z(out_y));
endmodule`;
  const [mod] = parseVerilog(verilog).modules;
  const timing = parseTimingLog(`
@module \\top_mod
point                        at     rt     slack
\\u_dp_add_0/w_gen_1207      0.100  0.080  -0.020
\\u_dp_add_0/u_buf_0/A       0.110  0.090  -0.020
\\u_dp_add_0/u_buf_0/Z       0.180  0.160  -0.020
`);
  const graph = buildWorkspaceGraph(mod, { timing });
  const inputPort = graph.nodes.find((node) => node.kind === "input");
  const cellNode = graph.nodes.find((node) => node.kind === "cell");

  assert.ok(inputPort.timing, "escaped input port with '/' should receive port timing");
  assert.equal(inputPort.timing.slack, -0.02);
  assert.ok(inputPort.timing.badges.length > 0, "port should have visible timing badges");
  assert.ok(cellNode.timing, "escaped cell should receive pin timing");
  assert.equal(cellNode.timing.pins.A.at, 0.11);
  assert.equal(cellNode.timing.pins.Z.at, 0.18);

  // Clicking the annotated Port must render timingPanel without throwing
  const portPanelHtml = renderTimingPanel(inputPort, inputPort.timing.badges);
  assert.match(portPanelHtml, /-0\.02/);
});

test("Net point timing attaches to its Source driver and survives assign alias normalization", () => {
  const verilog = `
module net_source_demo (input a, output y);
  wire n_drv;
  wire n_alias;
  BUF u_drv (.A(a), .Z(n_drv));
  assign n_alias = n_drv;
  INV u_load (.I(n_alias), .ZN(y));
endmodule`;
  const [mod] = parseVerilog(verilog).modules;
  const timing = parseTimingLog(`
@module net_source_demo
point     at     rt     slack  slew
n_alias   0.420  0.390  -0.030 0.044
`);
  const graph = buildWorkspaceGraph(mod, { timing, showAliases: false });
  const drvCell = graph.nodes.find((node) => node.label === "u_drv");
  const loadCell = graph.nodes.find((node) => node.label === "u_load");

  assert.ok(drvCell.timing, "driver cell u_drv should receive net source timing even after assign collapse");
  assert.equal(drvCell.timing.pins.Z.at, 0.42);
  assert.equal(drvCell.timing.pins.Z.slack, -0.03);
  assert.equal(drvCell.timing.pins.Z.sourceKind, "net");
  assert.equal(loadCell.timing, undefined, "load cell should not falsely receive net source timing");
  assert.ok(graph.netTiming.n_alias);
  assert.ok(graph.netTiming.n_drv);
  assert.equal(graph.netTiming.n_drv.slack, -0.03);

  const netPanelHtml = renderNetTimingPanel(graph.netTiming.n_drv);
  assert.match(netPanelHtml, /-0\.03/);
  assert.match(netPanelHtml, /0\.044/);
});

test("tabular timing parser strips inline comments and trailing notes", () => {
  const source = `
@module top # inline directive comment
point        at     rt     slack // C++ style inline
in_a[0]      0.120  0.100  -0.020 # critical setup
in_a[1]      0.150  0.200  0.050 // normal
`;
  const timing = parseTimingLog(source);
  assert.equal(timing.module, "top");
  assert.equal(timing.recordCount, 2);
  assert.equal(timing.records[0].slack, -0.02);
  assert.equal(timing.records[1].slack, 0.05);
});

test("port timing renders visible badges and tooltip in SVG and normalizes display policy", () => {
  const timing = parseTimingLog(`
@module top
point        at        rt         slack      slew
w_gen_14670  0.311245  -0.017425  -0.328670  0.044
`);
  const annotated = annotateGraphTiming({
    moduleName: "top",
    nodes: [{
      id: "input:w",
      kind: "input",
      label: "w_gen_14670",
      ref: { name: "w_gen_14670" },
      x: 0,
      y: 0,
      width: 80,
      height: 30
    }],
    edges: [],
    bounds: { x: 0, y: 0, width: 100, height: 50 }
  }, timing);
  const svg = renderSchematicSvg(annotated);
  assert.match(svg, /slew 0\.044/);
  assert.match(svg, /timing-badge timing-badge-port/);
  assert.doesNotMatch(svg, />w_gen_14670 [^<]*slew/);

  // When policy is none (empty), all timing badges are suppressed
  const hiddenAnnotated = annotateGraphTiming({
    moduleName: "top",
    nodes: [{
      id: "input:w",
      kind: "input",
      label: "w_gen_14670",
      ref: { name: "w_gen_14670" },
      x: 0,
      y: 0,
      width: 80,
      height: 30
    }],
    edges: [],
    bounds: { x: 0, y: 0, width: 100, height: 50 }
  }, timing, { displayPolicy: { metrics: [] } });
  const hiddenSvg = renderSchematicSvg(hiddenAnnotated);
  assert.doesNotMatch(hiddenSvg, /timing-badge/);

  assert.deepEqual(normalizeTimingDisplayPolicy({ metrics: ["rt", "slew", "rt", "bad"] }), {
    metrics: ["rt", "slew"]
  });
  assert.deepEqual(normalizeTimingDisplayPolicy({ metrics: [] }), {
    metrics: []
  });
  assert.deepEqual(normalizeTimingDisplayPolicy({ metrics: ["none"] }), {
    metrics: []
  });
});

test("default startup opens built-in sample module with timing initialized and verified", async () => {
  const state = createAppState(DEFAULT_LAYOUT_POLICY);
  const elements = {
    searchInput: {},
    layoutProviderSelect: {},
    coneDepthInput: {},
    faninDepthInput: {},
    fanoutDepthInput: {}
  };
  let renderedGraph = null;
  let readyMessageReported = null;
  const noOp = () => {};
  const services = new Proxy({
    documents: createDocumentStore(),
    viewSessions: { closeByDocument: noOp },
    workspaceJobs: { cancelDocument: noOp },
    netlistFeature: { buildSearchIndex: () => [] },
    cloneObjectRefs: (refs) => [...(refs || [])],
    selectModule(name) {
      state.currentModule = state.design.modules.find((mod) => mod.name === name);
    },
    renderCurrentModuleGraph(options = {}) {
      readyMessageReported = options.readyMessage;
      renderedGraph = layoutGraph(buildWorkspaceGraph(state.currentModule, { timing: state.timing }));
      options.onRendered?.(renderedGraph);
    }
  }, { get: (target, key) => key in target ? target[key] : noOp });

  const controller = createInputController({ state, elements, services });
  await controller.initializeApplication(null);

  // 1. Verifies default startup selects the baseline module
  assert.equal(state.currentModule?.name, "root_is_l_resyn3_u_gen_1395_7_159174_5");
  assert.ok(state.timing, "timing should be loaded by default for built-in sample");
  assert.equal(state.timing.format, "tabular");
  assert.equal(state.timing.stage, "post_map");
  assert.equal(state.timing.unit, "ns");
  assert.ok(state.timing.recordCount >= 60, "timing report should contain full point records");

  // 2. Both modules have timing scopes
  assert.ok(state.timing.scopes["root_is_l_resyn3_u_gen_1395_7_159174_5"]);
  assert.ok(state.timing.scopes["root_is_l_resyn3_u_gen_1395_7_159174_5_Flex"]);

  // 3. Status message reports timing instance count
  assert.match(readyMessageReported, /timing: \d+ instance\(s\)/);

  // 4. Default rendered graph for baseline module has critical path annotations
  assert.ok(renderedGraph, "graph should be rendered");
  const criticalNodes = renderedGraph.nodes.filter((node) => node.timing?.worstSlack < 0 || node.timing?.slack < 0);
  assert.ok(criticalNodes.length > 0, "baseline module should have critical timing violations");
  const svg = renderSchematicSvg(renderedGraph);
  assert.match(svg, /timing-badge/);
  assert.match(svg, /timing-critical/);

  // 5. Flex module (resynthesized) meets timing (slack > 0)
  const flexModule = state.design.modules.find((mod) => mod.name === "root_is_l_resyn3_u_gen_1395_7_159174_5_Flex");
  const flexGraph = layoutGraph(buildWorkspaceGraph(flexModule, { timing: state.timing }));
  const flexCritical = flexGraph.nodes.filter((node) => node.timing?.worstSlack < 0 || node.timing?.slack < 0);
  assert.equal(flexCritical.length, 0, "flex module should have 0 timing violations");
  const flexSvg = renderSchematicSvg(flexGraph);
  assert.match(flexSvg, /timing-badge/);
  assert.doesNotMatch(flexSvg, /timing-critical/);
});
