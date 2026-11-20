import { createTestViewBridges } from "../helpers/view_session_bridges.js";
import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import test from "node:test";
import { createAppState } from "../../src/app/appState.js";
import { createInputController } from "../../src/app/input_controller.js";
import { detectQuickInputKind } from "../../src/app/quickInput.js";
import { sampleTiming } from "../../src/app/sampleTiming.js";
import { createDocumentStore } from "../../src/application/document_store.js";
import { createImportRequests } from "../../src/application/import_requests.js";
import { mergeNetlistSources } from "../../src/domains/netlist/design_merge.js";
import { buildWorkspaceGraph } from "../../src/domains/netlist/netlist_graph_projection.js";
import { renderSchematicSvg } from "../../src/domains/netlist/netlist_scene.js";
import { DEFAULT_LAYOUT_POLICY } from "../../src/layout/layoutPolicy.js";
import { layoutGraph } from "../../src/layout/simpleLayered.js";
import { parseVerilog } from "../../src/parser/verilogParser.js";
import {
  annotateGraphTiming,
  normalizeTimingDisplayPolicy
} from "../../src/timing/timingAnnotation.js";
import { parseTimingLog, mergeTimingDatasets } from "../../src/timing/timingParser.js";
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
    metrics: ["rt", "slew"],
    threshold: 0
  });
  assert.deepEqual(normalizeTimingDisplayPolicy({ metrics: [] }), {
    metrics: [],
    threshold: 0
  });
  assert.deepEqual(normalizeTimingDisplayPolicy({ metrics: ["none"] }), {
    metrics: [],
    threshold: 0
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
    ...createTestViewBridges(state),
    importRequests: createImportRequests(),
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

  // 6. Worst slack threshold test:
  // When threshold = 0.02, flex module (slack ~ +0.015 < 0.02) gets marked as timing-critical
  const flexGraphThreshold = layoutGraph(buildWorkspaceGraph(flexModule, {
    timing: state.timing,
    timingDisplayPolicy: { metrics: ["slack"], threshold: 0.02 }
  }));
  const flexSvgThreshold = renderSchematicSvg(flexGraphThreshold);
  assert.match(flexSvgThreshold, /timing-critical/);

  // When threshold = -0.05, baseline module (slack ~ -0.040 >= -0.05) is NOT marked as timing-critical
  const baselineModule = state.design.modules.find((mod) => mod.name === "root_is_l_resyn3_u_gen_1395_7_159174_5");
  const baselineGraphRelaxed = layoutGraph(buildWorkspaceGraph(baselineModule, {
    timing: state.timing,
    timingDisplayPolicy: { metrics: ["slack"], threshold: -0.05 }
  }));
  const baselineSvgRelaxed = renderSchematicSvg(baselineGraphRelaxed);
  assert.doesNotMatch(baselineSvgRelaxed, /timing-critical/);
});

test("single or unscoped timing records never bleed into mismatched local or copy modules via leaf suffix fallback", () => {
  const singleScopeTiming = parseTimingLog(`
@module ModKerWrapper_tc_1049
point at rt slack
HinstModKerWrapper_tc_1049_gen_18638/ConeKernel_0/l_resyn0_u_gen_0/A1 0.500 0.400 -0.100
`);
  const unscopedTiming = parseTimingLog(`
point at rt slack
HinstModKerWrapper_tc_1049_gen_18638/ConeKernel_0/l_resyn0_u_gen_0/A1 0.500 0.400 -0.100
`);
  const verilog = `
module ModKerWrapper_tc_1049_cpy (input a, output y);
  BUF l_resyn0_u_gen_0 (.A1(a), .Z(y));
endmodule
module ModKerWrapper_tc_1049_cpy_loc (input a, output y);
  BUF l_resyn0_u_gen_0 (.A1(a), .Z(y));
endmodule`;
  const modules = parseVerilog(verilog).modules;
  for (const mod of modules) {
    for (const timing of [singleScopeTiming, unscopedTiming]) {
      const graph = buildWorkspaceGraph(mod, { timing });
      const cell = graph.nodes.find((node) => node.kind === "cell");
      assert.equal(cell.timing, undefined, `${mod.name} must not receive mismatched global timing`);
    }
  }
});

test("mixed unscoped global records and named @module scope never leak global timing into the named module", () => {
  const globalDs = parseTimingLog("point at rt slack\nother_block/l_resyn0_u_gen_0/A 0.8 0.2 -0.600");
  const localDs = parseTimingLog("@module local_mod\npoint at rt slack\nu_local/A 0.3 0.5 0.200");
  const merged = mergeTimingDatasets([globalDs, localDs]);
  const [mod] = parseVerilog(`
module local_mod (input a, input b, output y, output z);
  BUF l_resyn0_u_gen_0 (.A(a), .Y(y));
  BUF u_local (.A(b), .Y(z));
endmodule`).modules;
  const graph = buildWorkspaceGraph(mod, { timing: merged });
  const leakedCell = graph.nodes.find((n) => n.id === "cell:l_resyn0_u_gen_0");
  const localCell = graph.nodes.find((n) => n.id === "cell:u_local");
  assert.equal(leakedCell.timing, undefined, "unscoped global record must not match local module via suffix");
  assert.equal(localCell.timing.pins.A.slack, 0.2);
});

test("LocalDesign top-wrapper JSON resolves kind='pin' boundary ports, nested submodule pins, and isolates parent/child cell names", () => {
  const timingJson = JSON.stringify({
    module: "LocalDesign_15of15",
    points: {
      "ModKerWrapper_tc_1049_cpy__a_in_12__0": {
        at: 0.2,
        kind: "pin",
        rt: 0.14874130487442017,
        slack: -0.051258698105812073
      },
      "ModKerWrapper_tc_1049_cpy__a_in_14__0": {
        at: 0.2,
        kind: "pin",
        rt: 0.14874130487442017,
        slack: -0.051258698105812073
      },
      "ModKerWrapper_tc_1049_cpy__y_out__0": {
        at: 0.65,
        kind: "pin",
        rt: 0.55,
        slack: -0.1
      },
      "ModKerWrapper_tc_1049_cpy_loc/l_resyn0_u_gen_15/A1": {
        at: 0.25,
        kind: "pin",
        rt: 0.3,
        slack: 0.05
      },
      "ModKerWrapper_tc_1049_cpy_loc/ConeKernel_TM_l_resyn1_u_gen_15776_297015_gen_18633/l_resyn0_u_gen_15/A3": {
        at: 0.40757602453231812,
        kind: "pin",
        rt: -0.033556073904037476,
        slack: -0.44113209843635559
      }
    }
  });
  const timing = parseTimingLog(timingJson);

  // 1. Top flattened LocalDesign_15of15 with boundary ports exported as kind: "pin" and deep escaped instance
  const [topFlat] = parseVerilog(`
module LocalDesign_15of15 (
  input ModKerWrapper_tc_1049_cpy__a_in_12__0,
  input [0:0] ModKerWrapper_tc_1049_cpy__a_in_14,
  output ModKerWrapper_tc_1049_cpy__y_out__0
);
  wire n0;
  AND2 \\ModKerWrapper_tc_1049_cpy_loc/ConeKernel_TM_l_resyn1_u_gen_15776_297015_gen_18633/l_resyn0_u_gen_15  (
    .A1(ModKerWrapper_tc_1049_cpy__a_in_12__0),
    .A3(ModKerWrapper_tc_1049_cpy__a_in_14[0]),
    .Z(ModKerWrapper_tc_1049_cpy__y_out__0)
  );
endmodule`).modules;
  const topGraph = buildWorkspaceGraph(topFlat, { timing });
  const topIn12 = topGraph.nodes.find((n) => n.kind === "input" && n.ref?.name === "ModKerWrapper_tc_1049_cpy__a_in_12__0");
  const topIn14 = topGraph.nodes.find((n) => n.kind === "input" && n.ref?.name === "ModKerWrapper_tc_1049_cpy__a_in_14[0]");
  const topOut = topGraph.nodes.find((n) => n.kind === "output" && n.ref?.name === "ModKerWrapper_tc_1049_cpy__y_out__0");
  const topDeepCell = topGraph.nodes.find((n) => n.kind === "cell");
  assert.ok(topIn12?.timing, "boundary input port with kind='pin' must receive port timing");
  assert.equal(topIn12.timing.at, 0.2);
  assert.ok(topIn14?.timing, "mangled bus-bit port __0 with kind='pin' must resolve to [0]");
  assert.equal(topIn14.timing.slack, -0.051258698105812073);
  assert.ok(topOut?.timing, "boundary output port with kind='pin' must receive port timing");
  assert.equal(topOut.timing.slack, -0.1);
  assert.equal(topDeepCell.timing?.pins?.A3?.slack, -0.44113209843635559);

  // 2. Multi-level hierarchical design: LocalDesign_15of15 -> ModKerWrapper_tc_1049_cpy -> ConeKernel_TM_...
  const hierDesign = parseVerilog(`
module ConeKernel_TM_l_resyn1_u_gen_15776_297015 (input a, output y);
  AND2 l_resyn0_u_gen_15 (.A3(a), .Z(y));
endmodule
module ModKerWrapper_tc_1049_cpy (
  input [0:0] a_in_12,
  input a_in_14__0,
  output y_out__0
);
  wire n_mid;
  BUF l_resyn0_u_gen_15 (.A1(a_in_14__0), .Z(n_mid));
  ConeKernel_TM_l_resyn1_u_gen_15776_297015 ConeKernel_TM_l_resyn1_u_gen_15776_297015_gen_18633 (
    .a(a_in_12[0]),
    .y(y_out__0)
  );
endmodule
module ModKerWrapper_tc_1049 (input [0:0] a_in_12, output y_out__0);
  BUF l_resyn0_u_gen_15 (.A1(a_in_12[0]), .Z(y_out__0));
endmodule
module LocalDesign_15of15 (
  input ModKerWrapper_tc_1049_cpy__a_in_12__0,
  input ModKerWrapper_tc_1049_cpy__a_in_14__0,
  output ModKerWrapper_tc_1049_cpy__y_out__0
);
  ModKerWrapper_tc_1049_cpy ModKerWrapper_tc_1049_cpy_loc (
    .a_in_12(ModKerWrapper_tc_1049_cpy__a_in_12__0),
    .a_in_14__0(ModKerWrapper_tc_1049_cpy__a_in_14__0),
    .y_out__0(ModKerWrapper_tc_1049_cpy__y_out__0)
  );
endmodule`);

  const coneMod = hierDesign.modules.find((m) => m.name === "ConeKernel_TM_l_resyn1_u_gen_15776_297015");
  const cpyMod = hierDesign.modules.find((m) => m.name === "ModKerWrapper_tc_1049_cpy");
  const origMod = hierDesign.modules.find((m) => m.name === "ModKerWrapper_tc_1049");

  // 2a. Leaf module ConeKernel resolves timing both via moduleLibrary and standalone
  for (const lib of [hierDesign.modules, []]) {
    const coneGraph = buildWorkspaceGraph(coneMod, { timing, moduleLibrary: lib });
    const coneCell = coneGraph.nodes.find((n) => n.id === "cell:l_resyn0_u_gen_15");
    assert.equal(coneCell.timing?.pins?.A3?.slack, -0.44113209843635559);
    assert.equal(
      coneCell.timing?.fullPath,
      "ModKerWrapper_tc_1049_cpy_loc/ConeKernel_TM_l_resyn1_u_gen_15776_297015_gen_18633/l_resyn0_u_gen_15"
    );
  }

  // 2b. Parent wrapper ModKerWrapper_tc_1049_cpy resolves its own ports & direct cell without child l_resyn0_u_gen_15 collision
  const cpyGraph = buildWorkspaceGraph(cpyMod, { timing, moduleLibrary: hierDesign.modules });
  const cpyIn12 = cpyGraph.nodes.find((n) => n.kind === "input" && n.ref?.name === "a_in_12[0]");
  const cpyIn14 = cpyGraph.nodes.find((n) => n.kind === "input" && n.ref?.name === "a_in_14__0");
  const cpyOut = cpyGraph.nodes.find((n) => n.kind === "output" && n.ref?.name === "y_out__0");
  const cpyDirectCell = cpyGraph.nodes.find((n) => n.id === "cell:l_resyn0_u_gen_15");
  assert.equal(cpyIn12?.timing?.slack, -0.051258698105812073);
  assert.equal(cpyIn14?.timing?.slack, -0.051258698105812073);
  assert.equal(cpyOut?.timing?.slack, -0.1);
  assert.equal(cpyDirectCell?.timing?.pins?.A1?.slack, 0.05);
  assert.equal(cpyDirectCell?.timing?.pins?.A3, undefined, "child hinst cell timing must not collide onto sibling parent cell");

  // 2c. Flattened cell inside ModKerWrapper_tc_1049_cpy_loc variant also resolves
  const [cpyLocFlat] = parseVerilog(`
module ModKerWrapper_tc_1049_cpy_loc (input a, output y);
  AND2 \\ConeKernel_TM_l_resyn1_u_gen_15776_297015_gen_18633/l_resyn0_u_gen_15  (.A3(a), .Z(y));
endmodule`).modules;
  const cpyLocGraph = buildWorkspaceGraph(cpyLocFlat, { timing });
  const cpyLocCell = cpyLocGraph.nodes.find((n) => n.kind === "cell");
  assert.equal(cpyLocCell.timing?.pins?.A3?.slack, -0.44113209843635559);

  // 2d. Non-copy module ModKerWrapper_tc_1049 must remain completely isolated
  const origGraph = buildWorkspaceGraph(origMod, { timing, moduleLibrary: hierDesign.modules });
  assert.equal(origGraph.nodes.some((n) => Boolean(n.timing)), false, "ModKerWrapper_tc_1049 must stay isolated from _cpy timing");
});

test("Local timing never bleeds into Global ConeKernel across merged designs or occurrence navigation", () => {
  const localTiming = parseTimingLog(JSON.stringify({
    module: "LocalDesign_15of15",
    points: {
      "ModKerWrapper_tc_1049_cpy_loc/ConeKernel_TM_l_resyn1_u_gen_15765_294015_gen_18630/sco_1605": {
        at: 0.39349532127380371,
        kind: "port",
        rt: -0.055862903594970703,
        slack: -0.44935822486877441
      }
    }
  }));

  // Case A: Merged global.v + local.v with GlobalTop and LocalDesign_15of15 roots
  const globalVerilog = `
module ConeKernel_TM_l_resyn1_u_gen_15765_294015 (input a, output sco_1605);
  BUF u_g (.A(a), .Z(sco_1605));
endmodule
module ModKerWrapper_tc_1049 (input a, output sco_1605);
  ConeKernel_TM_l_resyn1_u_gen_15765_294015 ConeKernel_TM_l_resyn1_u_gen_15765_294015_gen_18630 (.a(a), .sco_1605(sco_1605));
endmodule
module GlobalTop (input a, output sco_1605);
  ModKerWrapper_tc_1049 HinstModKerWrapper_tc_1049_gen_18638 (.a(a), .sco_1605(sco_1605));
endmodule`;
  const localVerilog = `
module ConeKernel_TM_l_resyn1_u_gen_15765_294015 (input a, output sco_1605);
  BUF u_l (.A(a), .Z(sco_1605));
endmodule
module ModKerWrapper_tc_1049_cpy (input a, output sco_1605);
  ConeKernel_TM_l_resyn1_u_gen_15765_294015 ConeKernel_TM_l_resyn1_u_gen_15765_294015_gen_18630 (.a(a), .sco_1605(sco_1605));
endmodule
module LocalDesign_15of15 (input a, output sco_1605);
  ModKerWrapper_tc_1049_cpy ModKerWrapper_tc_1049_cpy_loc (.a(a), .sco_1605(sco_1605));
endmodule`;

  const mergedWithTop = mergeNetlistSources([
    { name: "global.v", text: globalVerilog },
    { name: "local.v", text: localVerilog }
  ]).model.modules;
  const globalCone = mergedWithTop.find((m) => m.name === "ConeKernel_TM_l_resyn1_u_gen_15765_294015 [global.v]");
  const localCone = mergedWithTop.find((m) => m.name === "ConeKernel_TM_l_resyn1_u_gen_15765_294015 [local.v]");

  const globalConeGraph = buildWorkspaceGraph(globalCone, { timing: localTiming, moduleLibrary: mergedWithTop });
  const localConeGraph = buildWorkspaceGraph(localCone, { timing: localTiming, moduleLibrary: mergedWithTop });
  assert.equal(
    globalConeGraph.nodes.find((n) => n.kind === "output")?.timing,
    undefined,
    "global ConeKernel sco_1605 must not receive local timing"
  );
  assert.equal(
    localConeGraph.nodes.find((n) => n.kind === "output")?.timing?.slack,
    -0.44935822486877441
  );

  // Case B: Merged global.v + local.v WITHOUT top wrapper modules (roots are ModKerWrapper_tc_1049 vs _cpy)
  const mergedNoTop = mergeNetlistSources([
    {
      name: "global.v",
      text: globalVerilog.replace(/module GlobalTop[\s\S]*?endmodule/, "")
    },
    {
      name: "local.v",
      text: localVerilog.replace(/module LocalDesign_15of15[\s\S]*?endmodule/, "")
    }
  ]).model.modules;
  const globalConeNoTop = mergedNoTop.find((m) => m.name === "ConeKernel_TM_l_resyn1_u_gen_15765_294015 [global.v]");
  const localConeNoTop = mergedNoTop.find((m) => m.name === "ConeKernel_TM_l_resyn1_u_gen_15765_294015 [local.v]");
  assert.equal(
    buildWorkspaceGraph(globalConeNoTop, { timing: localTiming, moduleLibrary: mergedNoTop })
      .nodes.find((n) => n.kind === "output")?.timing,
    undefined,
    "global ConeKernel under ModKerWrapper_tc_1049 must stay isolated when LocalDesign_15of15 is absent"
  );
  assert.equal(
    buildWorkspaceGraph(localConeNoTop, { timing: localTiming, moduleLibrary: mergedNoTop })
      .nodes.find((n) => n.kind === "output")?.timing?.slack,
    -0.44935822486877441
  );

  // Case C: Single-file shared ConeKernel navigated via explicit occurrencePath & occurrenceRootModuleName
  const singleDesign = parseVerilog(`
module ConeKernel_TM_l_resyn1_u_gen_15765_294015 (input a, output sco_1605);
  BUF u0 (.A(a), .Z(sco_1605));
endmodule
module ModKerWrapper_tc_1049 (input a, output sco_1605);
  ConeKernel_TM_l_resyn1_u_gen_15765_294015 ConeKernel_TM_l_resyn1_u_gen_15765_294015_gen_18630 (.a(a), .sco_1605(sco_1605));
endmodule
module ModKerWrapper_tc_1049_cpy (input a, output sco_1605);
  ConeKernel_TM_l_resyn1_u_gen_15765_294015 ConeKernel_TM_l_resyn1_u_gen_15765_294015_gen_18630 (.a(a), .sco_1605(sco_1605));
endmodule
module GlobalTop (input a, output sco_1605);
  ModKerWrapper_tc_1049 HinstModKerWrapper_tc_1049_gen_18638 (.a(a), .sco_1605(sco_1605));
endmodule
module LocalDesign_15of15 (input a, output sco_1605);
  ModKerWrapper_tc_1049_cpy ModKerWrapper_tc_1049_cpy_loc (.a(a), .sco_1605(sco_1605));
endmodule`).modules;
  const sharedCone = singleDesign.find((m) => m.name === "ConeKernel_TM_l_resyn1_u_gen_15765_294015");
  const sharedGlobalOcc = buildWorkspaceGraph(sharedCone, {
    timing: localTiming,
    moduleLibrary: singleDesign,
    occurrenceRootModuleName: "GlobalTop",
    occurrencePath: [
      "HinstModKerWrapper_tc_1049_gen_18638",
      "ConeKernel_TM_l_resyn1_u_gen_15765_294015_gen_18630"
    ]
  });
  const sharedLocalOcc = buildWorkspaceGraph(sharedCone, {
    timing: localTiming,
    moduleLibrary: singleDesign,
    occurrenceRootModuleName: "LocalDesign_15of15",
    occurrencePath: [
      "ModKerWrapper_tc_1049_cpy_loc",
      "ConeKernel_TM_l_resyn1_u_gen_15765_294015_gen_18630"
    ]
  });
  assert.equal(sharedGlobalOcc.nodes.find((n) => n.kind === "output")?.timing, undefined);
  assert.equal(sharedLocalOcc.nodes.find((n) => n.kind === "output")?.timing?.slack, -0.44935822486877441);
});

test("parent module view displays port timing on submodule hinst box and renders escaped pin timing in SVG", () => {
  const timing = parseTimingLog(JSON.stringify({
    module: "LocalDesign_15of15",
    points: {
      "ModKerWrapper_tc_1049_cpy_loc/ConeKernel_TM_l_resyn0_u_gen_1292_273001_gen_18609/a_q\\[33\\]": {
        at: 0.22428335249423981,
        kind: "port",
        rt: -0.29774534702301025,
        slack: -0.52202868461608887
      },
      "ModKerWrapper_tc_1049_cpy_loc/ConeKernel_TM_l_resyn0_u_gen_1292_273001_gen_18609/sco_1605": {
        at: 0.39349532127380371,
        kind: "port",
        rt: -0.055862903594970703,
        slack: -0.44935822486877441
      }
    }
  }));

  const design = parseVerilog(`
module ConeKernel_TM_l_resyn0_u_gen_1292_273001 (input \\a_q[33] , output sco_1605);
  BUF u0 (.A(\\a_q[33] ), .Z(sco_1605));
endmodule
module ModKerWrapper_tc_1049_cpy (input \\a_q[33] , output sco_1605);
  ConeKernel_TM_l_resyn0_u_gen_1292_273001 ConeKernel_TM_l_resyn0_u_gen_1292_273001_gen_18609 (
    .\\a_q[33] (\\a_q[33] ),
    .sco_1605(sco_1605)
  );
endmodule
module LocalDesign_15of15 (input \\a_q[33] , output sco_1605);
  ModKerWrapper_tc_1049_cpy ModKerWrapper_tc_1049_cpy_loc (.\\a_q[33] (\\a_q[33] ), .sco_1605(sco_1605));
endmodule`).modules;

  const cpyMod = design.find((m) => m.name === "ModKerWrapper_tc_1049_cpy");
  const cpyGraph = layoutGraph(buildWorkspaceGraph(cpyMod, { timing, moduleLibrary: design }));
  const hinstNode = cpyGraph.nodes.find((n) => n.id === "cell:ConeKernel_TM_l_resyn0_u_gen_1292_273001_gen_18609");

  assert.ok(hinstNode?.timing, "child hinst node must receive timing from kind='port' submodule port records");
  assert.equal(hinstNode.timing.pins["a_q[33]"]?.slack, -0.52202868461608887);
  assert.equal(hinstNode.timing.pins.sco_1605?.slack, -0.44935822486877441);
  assert.equal(hinstNode.timing.worstPin, "a_q[33]");
  assert.equal(hinstNode.timing.worstSlack, -0.52202868461608887);
  assert.ok(hinstNode.timing.badges.length > 0);
  assert.match(hinstNode.timing.badges.map((b) => b.label).join(" "), /a_q\[33\] slack -0\.522/);

  const svg = renderSchematicSvg(cpyGraph);
  assert.match(svg, /timing-critical/);
  assert.match(svg, /pin-critical/);
  assert.match(svg, /a_q\[33\]: at 0\.224, rt -0\.298, slack -0\.522/);
});

test("backslash-escaped bracket port a_q\\[33\\] resolves onto escaped, bus-expanded, and single-bit packed input ports", () => {
  const timing = parseTimingLog(JSON.stringify({
    module: "LocalDesign_15of15",
    points: {
      "ModKerWrapper_tc_1049_cpy_loc/ConeKernel_TM_l_resyn0_u_gen_1292_273001_gen_18609/a_q\\[33\\]": {
        at: 0.22428335249423981,
        kind: "port",
        rt: -0.29774534702301025,
        slack: -0.52202868461608887
      }
    }
  }));

  const variants = [
    {
      label: "escaped scalar input \\a_q[33]",
      verilog: `
module ConeKernel_TM_l_resyn0_u_gen_1292_273001 (input \\a_q[33] , output y);
  BUF u0 (.A(\\a_q[33] ), .Z(y));
endmodule`
    },
    {
      label: "expanded bus input [34:32] a_q",
      verilog: `
module ConeKernel_TM_l_resyn0_u_gen_1292_273001 (input [34:32] a_q, output y);
  BUF u0 (.A(a_q[33]), .Z(y));
endmodule`
    },
    {
      label: "single-bit packed range input [33:33] a_q referenced as whole a_q",
      verilog: `
module ConeKernel_TM_l_resyn0_u_gen_1292_273001 (input [33:33] a_q, output y);
  BUF u0 (.A(a_q), .Z(y));
endmodule`
    }
  ];

  for (const variant of variants) {
    const [mod] = parseVerilog(variant.verilog).modules;
    const graph = layoutGraph(buildWorkspaceGraph(mod, { timing }));
    const inputPort = graph.nodes.find(
      (n) => n.kind === "input" && (n.ref?.name === "a_q[33]" || n.ref?.name === "a_q")
    );
    assert.ok(inputPort?.timing, `${variant.label}: input port should receive timing`);
    assert.equal(inputPort.timing.at, 0.22428335249423981);
    assert.equal(inputPort.timing.rt, -0.29774534702301025);
    assert.equal(inputPort.timing.slack, -0.52202868461608887);
    const svg = renderSchematicSvg(graph);
    assert.match(svg, /timing-badge timing-badge-port/, `${variant.label}: SVG should show port timing badge`);
    assert.match(svg, /slack -0\.522/);
  }
});

test("multi-occurrence module prevents pin merging without occurrencePath and resolves cleanly with merged global/local timings", () => {
  const verilog = `
module LeafKernel (input a, input b, output y);
  AND2 u_core (.A(a), .B(b), .Z(y));
endmodule
module DualTop (input a0, input b0, input a1, input b1, output y0, output y1);
  LeafKernel u_left (.a(a0), .b(b0), .y(y0));
  LeafKernel u_right (.a(a1), .b(b1), .y(y1));
endmodule`;
  const modules = parseVerilog(verilog).modules;
  const leaf = modules.find((m) => m.name === "LeafKernel");
  const timing = parseTimingLog(JSON.stringify({
    module: "DualTop",
    points: {
      "u_left/u_core/A": { at: 0.1, rt: 0.2, slack: 0.1 },
      "u_left/a": { at: 0.05, rt: 0.2, slack: 0.15 },
      "u_right/u_core/B": { at: 0.8, rt: 0.3, slack: -0.5 },
      "u_right/a": { at: 0.4, rt: 0.1, slack: -0.3 }
    }
  }));

  // Without occurrencePath, ambiguous timing must not Frankenstein-merge A (u_left) and B (u_right)
  const ambiguousGraph = buildWorkspaceGraph(leaf, { timing, moduleLibrary: modules });
  assert.equal(ambiguousGraph.nodes.find((n) => n.id === "cell:u_core")?.timing, undefined);
  assert.equal(ambiguousGraph.nodes.find((n) => n.id === "input:a")?.timing, undefined);
  assert.equal(ambiguousGraph.timingSummary.ambiguousOccurrenceCount, 2);
  assert.equal(ambiguousGraph.timingSummary.matchedRecordCount, 0);

  // When only one occurrence has timing in the report, un-disambiguated open still shows it
  const singleActiveTiming = parseTimingLog(JSON.stringify({
    module: "DualTop",
    points: {
      "u_left/u_core/A": { at: 0.1, rt: 0.2, slack: 0.1 },
      "u_left/a": { at: 0.05, rt: 0.2, slack: 0.15 }
    }
  }));
  const singleActiveGraph = buildWorkspaceGraph(leaf, { timing: singleActiveTiming, moduleLibrary: modules });
  assert.equal(singleActiveGraph.nodes.find((n) => n.id === "cell:u_core")?.timing?.pins?.A?.slack, 0.1);
  assert.equal(singleActiveGraph.nodes.find((n) => n.id === "input:a")?.timing?.slack, 0.15);

  // Explicit occurrence selects strictly the requested instance without merging the sibling's pins
  const rightOcc = buildWorkspaceGraph(leaf, {
    timing,
    moduleLibrary: modules,
    occurrenceRootModuleName: "DualTop",
    occurrencePath: ["u_right"]
  });
  const rightCell = rightOcc.nodes.find((n) => n.id === "cell:u_core");
  assert.equal(rightCell.timing?.pins?.B?.slack, -0.5);
  assert.equal(rightCell.timing?.pins?.A, undefined);
  assert.equal(rightOcc.nodes.find((n) => n.id === "input:a")?.timing?.slack, -0.3);

  // Simultaneous merged Global + Local designs and Global + Local timing datasets stay isolated
  const globalSrc = `
module SharedLeaf (input a, output sco_1605);
  BUF u0 (.A(a), .Z(sco_1605));
endmodule
module GlobalTop (input a, output sco_1605);
  SharedLeaf HinstSharedLeaf_gen_1 (.a(a), .sco_1605(sco_1605));
endmodule`;
  const localSrc = `
module SharedLeaf (input a, output sco_1605);
  BUF u0 (.A(a), .Z(sco_1605));
endmodule
module LocalTop (input a, output sco_1605);
  SharedLeaf SharedLeaf_loc (.a(a), .sco_1605(sco_1605));
endmodule`;
  const mergedDesign = mergeNetlistSources([
    { name: "global.v", text: globalSrc },
    { name: "local.v", text: localSrc }
  ]).model.modules;
  const globalTiming = parseTimingLog(JSON.stringify({
    module: "GlobalTop",
    points: { "HinstSharedLeaf_gen_1/sco_1605": { at: 0.2, kind: "port", rt: 0.3, slack: 0.1 } }
  }));
  const localTiming = parseTimingLog(JSON.stringify({
    module: "LocalTop",
    points: { "SharedLeaf_loc/sco_1605": { at: 0.7, kind: "port", rt: 0.2, slack: -0.5 } }
  }));
  const mergedTiming = mergeTimingDatasets([globalTiming, localTiming]);
  const gLeaf = mergedDesign.find((m) => m.name === "SharedLeaf [global.v]");
  const lLeaf = mergedDesign.find((m) => m.name === "SharedLeaf [local.v]");
  assert.equal(
    buildWorkspaceGraph(gLeaf, { timing: mergedTiming, moduleLibrary: mergedDesign }).nodes.find((n) => n.kind === "output")?.timing?.slack,
    0.1
  );
  assert.equal(
    buildWorkspaceGraph(lLeaf, { timing: mergedTiming, moduleLibrary: mergedDesign }).nodes.find((n) => n.kind === "output")?.timing?.slack,
    -0.5
  );
});

test("3-level hierarchy without top wrappers isolates global and local modules and outer root navigation works", () => {
  const globalVer = `
module ConeKernel (input a, output sco_1605);
  BUF u_g (.A(a), .Z(sco_1605));
endmodule
module SubMid (input a, output sco_1605);
  ConeKernel ConeKernel_gen_18630 (.a(a), .sco_1605(sco_1605));
endmodule
module ModKerWrapper_tc_1049 (input a, output sco_1605);
  SubMid SubMid_inst (.a(a), .sco_1605(sco_1605));
endmodule`;
  const localVer = `
module ConeKernel (input a, output sco_1605);
  BUF u_l (.A(a), .Z(sco_1605));
endmodule
module SubMid (input a, output sco_1605);
  ConeKernel ConeKernel_gen_18630 (.a(a), .sco_1605(sco_1605));
endmodule
module ModKerWrapper_tc_1049_cpy (input a, output sco_1605);
  SubMid SubMid_inst (.a(a), .sco_1605(sco_1605));
endmodule`;

  const merged = mergeNetlistSources([
    { name: "global.v", text: globalVer },
    { name: "local.v", text: localVer }
  ]).model.modules;
  const localTiming = parseTimingLog(JSON.stringify({
    module: "LocalDesign_15of15",
    points: {
      "ModKerWrapper_tc_1049_cpy_loc/SubMid_inst/ConeKernel_gen_18630/sco_1605": {
        at: 0.39,
        kind: "port",
        rt: -0.05,
        slack: -0.44
      }
    }
  }));

  const globalCone = merged.find((m) => m.name === "ConeKernel [global.v]");
  const localCone = merged.find((m) => m.name === "ConeKernel [local.v]");
  assert.equal(
    buildWorkspaceGraph(globalCone, { timing: localTiming, moduleLibrary: merged }).nodes.find((n) => n.kind === "output")?.timing,
    undefined,
    "3-level global module must not match local timing via unrooted multi-segment fallback"
  );
  assert.equal(
    buildWorkspaceGraph(localCone, { timing: localTiming, moduleLibrary: merged }).nodes.find((n) => n.kind === "output")?.timing?.slack,
    -0.44
  );

  // Outer wrapper TopChip wrapping LocalDesign_15of15 and GlobalTop
  const wrappedDesign = parseVerilog(`
module ConeKernel (input a, output sco_1605);
  BUF u0 (.A(a), .Z(sco_1605));
endmodule
module ModKerWrapper_tc_1049 (input a, output sco_1605);
  ConeKernel ConeKernel_gen_18630 (.a(a), .sco_1605(sco_1605));
endmodule
module ModKerWrapper_tc_1049_cpy (input a, output sco_1605);
  ConeKernel ConeKernel_gen_18630 (.a(a), .sco_1605(sco_1605));
endmodule
module GlobalTop (input a, output sco_1605);
  ModKerWrapper_tc_1049 HinstModKerWrapper_tc_1049_gen_18638 (.a(a), .sco_1605(sco_1605));
endmodule
module LocalDesign_15of15 (input a, output sco_1605);
  ModKerWrapper_tc_1049_cpy ModKerWrapper_tc_1049_cpy_loc (.a(a), .sco_1605(sco_1605));
endmodule
module TopChip (input a, output sco_g, output sco_l);
  GlobalTop u_global (.a(a), .sco_1605(sco_g));
  LocalDesign_15of15 u_local (.a(a), .sco_1605(sco_l));
endmodule`).modules;
  const wrappedTiming = parseTimingLog(JSON.stringify({
    module: "LocalDesign_15of15",
    points: {
      "ModKerWrapper_tc_1049_cpy_loc/ConeKernel_gen_18630/sco_1605": {
        at: 0.4,
        kind: "port",
        rt: -0.04,
        slack: -0.44
      }
    }
  }));
  const sharedCone = wrappedDesign.find((m) => m.name === "ConeKernel");
  const outerLocalGraph = buildWorkspaceGraph(sharedCone, {
    timing: wrappedTiming,
    moduleLibrary: wrappedDesign,
    occurrenceRootModuleName: "TopChip",
    occurrencePath: ["u_local", "ModKerWrapper_tc_1049_cpy_loc", "ConeKernel_gen_18630"]
  });
  const outerGlobalGraph = buildWorkspaceGraph(sharedCone, {
    timing: wrappedTiming,
    moduleLibrary: wrappedDesign,
    occurrenceRootModuleName: "TopChip",
    occurrencePath: ["u_global", "HinstModKerWrapper_tc_1049_gen_18638", "ConeKernel_gen_18630"]
  });
  assert.equal(outerLocalGraph.nodes.find((n) => n.kind === "output")?.timing?.slack, -0.44);
  assert.equal(outerGlobalGraph.nodes.find((n) => n.kind === "output")?.timing, undefined);
});

test("escaped ':' in occurrencePath and '\\/' in cell/net/pin names resolve and count accurately", () => {
  const modules = parseVerilog(`
module Leaf (input a, output y);
  BUF \\u_dp_add_0/u_buf_0  (.A(a), .Z(y));
endmodule
module Top (input a, output y);
  Leaf \\u_blk:0  (.a(a), .y(y));
endmodule`).modules;
  const leaf = modules.find((m) => m.name === "Leaf");

  const timing = parseTimingLog(JSON.stringify({
    module: "Top",
    points: {
      "\\u_blk:0 /u_dp_add_0\\/u_buf_0/A": { at: 0.25, rt: 0.15, slack: -0.1, kind: "pin" }
    }
  }));
  const occGraph = buildWorkspaceGraph(leaf, {
    timing,
    moduleLibrary: modules,
    occurrenceRootModuleName: "Top",
    occurrencePath: ["\\u_blk:0 "]
  });
  const escapedCell = occGraph.nodes.find((n) => n.kind === "cell");
  assert.equal(escapedCell?.timing?.pins?.A?.slack, -0.1);

  // Direct module test for escaped '\/' in net and pin names
  const [netMod] = parseVerilog(`
module net_slash_mod (input a, output y);
  wire \\u_dp_add_0/w_gen_1207 ;
  BUF u_drv (.A(a), .Z(\\u_dp_add_0/w_gen_1207 ));
  BUF \\u_dp_add_0/u_buf_1  (.\\a/b (\\u_dp_add_0/w_gen_1207 ), .Z(y));
endmodule`).modules;
  const slashTiming = parseTimingLog(JSON.stringify({
    module: "net_slash_mod",
    points: {
      "u_dp_add_0\\/w_gen_1207": { at: 0.35, rt: 0.20, slack: -0.15, kind: "net" },
      "u_dp_add_0\\/u_buf_1/a\\/b": { at: 0.40, rt: 0.10, slack: -0.30, kind: "pin" },
      "u_dp_add_0\\/u_buf_1/Z": { at: 0.45, rt: 0.10, slack: -0.35, kind: "pin" }
    }
  }));
  assert.equal(slashTiming.instanceCount, 2);
  const netGraph = buildWorkspaceGraph(netMod, { timing: slashTiming });
  assert.equal(netGraph.nodes.find((n) => n.label === "u_drv")?.timing?.pins?.Z?.slack, -0.15);
  assert.equal(netGraph.nodes.find((n) => n.label === "\\u_dp_add_0/u_buf_1")?.timing?.pins?.["a/b"]?.slack, -0.30);
});

test("unexpanded multi-bit bus input port and parent hinst whole-bus pin highlight worst bit deterministically", () => {
  const design = parseVerilog(`
module ConeKernel (input [63:0] a_q, output sco_1605);
  BUF u0 (.A(a_q), .Z(sco_1605));
endmodule
module ModKerWrapper_cpy (input [63:0] a_q, output sco_1605);
  ConeKernel ConeKernel_gen_18609 (.a_q(a_q), .sco_1605(sco_1605));
endmodule
module LocalDesign_15of15 (input [63:0] a_q, output sco_1605);
  ModKerWrapper_cpy ModKerWrapper_cpy_loc (.a_q(a_q), .sco_1605(sco_1605));
endmodule`).modules;

  const timing = parseTimingLog(JSON.stringify({
    module: "LocalDesign_15of15",
    points: {
      "ModKerWrapper_cpy_loc/ConeKernel_gen_18609/a_q\\[12\\]": {
        at: 0.10,
        kind: "port",
        rt: 0.20,
        slack: 0.10
      },
      "ModKerWrapper_cpy_loc/ConeKernel_gen_18609/a_q\\[33\\]": {
        at: 0.22428335249423981,
        kind: "port",
        rt: -0.29774534702301025,
        slack: -0.52202868461608887
      }
    }
  }));

  const cone = design.find((m) => m.name === "ConeKernel");
  const coneGraph = layoutGraph(buildWorkspaceGraph(cone, { timing, moduleLibrary: design }));
  const inputPort = coneGraph.nodes.find((n) => n.kind === "input" && n.ref?.name === "a_q");
  assert.equal(inputPort?.timing?.slack, -0.52202868461608887);

  const wrapper = design.find((m) => m.name === "ModKerWrapper_cpy");
  const wrapperGraph = layoutGraph(buildWorkspaceGraph(wrapper, { timing, moduleLibrary: design }));
  const hinst = wrapperGraph.nodes.find((n) => n.id === "cell:ConeKernel_gen_18609");
  assert.equal(hinst?.timing?.worstPin, "a_q[33]");
  const svg = renderSchematicSvg(wrapperGraph);
  assert.match(svg, /pin-critical/);
  assert.match(svg, /a_q\[33\]: at 0\.224, rt -0\.298, slack -0\.522/);
});

test("timing annotation is invariant to record order and scales boundedly for 1000 cells", () => {
  const cellCount = 1000;
  const cells = [];
  const entries = [];
  for (let i = 0; i < cellCount; i += 1) {
    const inst = `u_cell_${i}`;
    cells.push(`  BUF ${inst} (.A(a), .Z(y_${i}));`);
    entries.push([`${inst}/A`, { at: 0.1, rt: 0.0, slack: i === 500 ? -0.5 : 0.2, kind: "pin" }]);
    entries.push([`${inst}/Z`, { at: 0.2, rt: 0.0, slack: i === 500 ? -0.5 : 0.1, kind: "pin" }]);
    entries.push([`net_${i}`, { at: 0.3, rt: 0.4, slack: 0.1, kind: "net" }]);
    entries.push([`other_wrap/sub_${i}/A`, { at: 0.4, rt: 0.5, slack: 0.1, kind: "pin" }]);
    entries.push([`u_unmatched_${i}/Z`, { at: 0.5, rt: 0.6, slack: 0.1, kind: "pin" }]);
  }
  const modSource = `module scale_top (input a, output ${Array.from({ length: 10 }, (_, i) => `y_${i}`).join(", ")});\n${cells.join("\n")}\nendmodule`;
  const [mod] = parseVerilog(modSource).modules;

  const forwardTiming = parseTimingLog(JSON.stringify({
    module: "scale_top",
    points: Object.fromEntries(entries)
  }));
  const reverseTiming = parseTimingLog(JSON.stringify({
    module: "scale_top",
    points: Object.fromEntries([...entries].reverse())
  }));

  const startedAt = performance.now();
  const forwardGraph = buildWorkspaceGraph(mod, { timing: forwardTiming });
  const elapsedMs = performance.now() - startedAt;
  const reverseGraph = buildWorkspaceGraph(mod, { timing: reverseTiming });

  assert.ok(elapsedMs < 500, `Expected 1000-cell / 5000-point timing annotation < 500ms, took ${Math.round(elapsedMs)}ms`);
  assert.equal(forwardGraph.nodes.find((n) => n.id === "cell:u_cell_500")?.timing?.worstSlack, -0.5);
  assert.equal(
    forwardGraph.nodes.find((n) => n.id === "cell:u_cell_500")?.timing?.worstPin,
    reverseGraph.nodes.find((n) => n.id === "cell:u_cell_500")?.timing?.worstPin,
    "equal worstSlack tie-breaking must be invariant to record order"
  );
  assert.equal(
    forwardGraph.nodes.find((n) => n.id === "cell:u_cell_500")?.timing?.worstSlack,
    reverseGraph.nodes.find((n) => n.id === "cell:u_cell_500")?.timing?.worstSlack
  );
});
