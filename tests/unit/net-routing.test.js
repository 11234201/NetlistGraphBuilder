import assert from "node:assert/strict";
import test from "node:test";
import { parseVerilog } from "../../src/parser/verilogParser.js";
import { buildWorkspaceGraph, applyWorkspaceGraphTransforms, selectWorkspaceGraphView } from "../../src/domains/netlist/netlist_graph_projection.js";
import { normalizeUnroutedNets, resolveUnroutedNets, setNetRoutingEnabled } from "../../src/domains/netlist/net_routing.js";
import { buildModuleWorkspace } from "../../src/app/moduleWorkspace.js";
import { buildCompareWorkspace } from "../../src/app/compareWorkspace.js";
import { createWorkspaceArtifactCache } from "../../src/app/workspaceArtifactCache.js";
import { DEFAULT_LAYOUT_PROVIDER_ID } from "../../src/layout/providerDefaults.js";
import { getLayoutProvider } from "../../src/layout/layoutProvider.js";
import { validateLayoutGraph } from "../../src/layout/layoutValidator.js";
import { renderSchematicSvg } from "../../src/domains/netlist/netlist_scene.js";
import { createAppState, saveModuleWorkspace, restoreModuleWorkspace } from "../../src/app/appState.js";
import { DEFAULT_LAYOUT_POLICY } from "../../src/layout/layoutPolicy.js";
import { createSingleViewSessionBridge } from "../../src/app/single_view_session_bridge.js";
import { createCompareViewSessionBridge } from "../../src/app/compare_view_session_bridge.js";
import { createStateCommandsController } from "../../src/app/state_commands_controller.js";
import { createNetRoutingBridge } from "../../src/app/net_routing_bridge.js";
import { createViewHistoryEntry } from "../../src/app/viewHistory.js";
import { createSessionSnapshot, saveSessionState, loadSessionState } from "../../src/app/sessionState.js";
import { createLayoutGolden, getLayoutGoldenState } from "../../src/domains/netlist/layout_golden.js";
import { createInspectorController } from "../../src/app/inspector_controller.js";
import { createSearchNavigationController } from "../../src/app/search_navigation_controller.js";
import { createGoldenController } from "../../src/app/golden_controller.js";
import { createSingleWorkspaceInput } from "../../src/app/workspace_inputs.js";
import { renderNetRoutingPanel, bindNetRoutingPanel } from "../../src/ui/net_routing_panel.js";

const source = `module top(input clk, reset, d, output y);
wire clock_alias; assign clock_alias = clk;
AND3X1 u0 (.A(clock_alias), .B(reset), .C(d), .Y(y)); endmodule`;
const module = parseVerilog(source).modules[0];
const provider = getLayoutProvider(DEFAULT_LAYOUT_PROVIDER_ID);
const overrides = { nodeProperties: {}, cellPinDirections: {}, unroutedNets: ["clk", "reset"] };

test("routing exclusion normalizes exact canonical names without guessing clock/reset patterns", () => {
  assert.deepEqual(normalizeUnroutedNets(["reset", "clk", "clk", "clk/data[0]", "", null, 7]), ["clk", "clk/data[0]", "reset"]);
  assert.deepEqual(normalizeUnroutedNets("clk,reset"), []);
  const graph = buildWorkspaceGraph(module);
  assert.equal(applyWorkspaceGraphTransforms(graph, { useFanoutHubs: false }), graph);
  assert.ok(graph.edges.some((edge) => edge.net === "reset"));
});

test("routing exclusions preserve full connectivity and pins with aliases shown or folded", () => {
  for (const showAliases of [false, true]) {
    const graph = buildWorkspaceGraph(module, { showAliases });
    const before = structuredClone(graph);
    const projected = applyWorkspaceGraphTransforms(graph, { unroutedNets: overrides.unroutedNets });
    assert.deepEqual(graph, before);
    assert.deepEqual(projected.nodes, graph.nodes);
    assert.deepEqual(projected.unroutedNets, ["clk", "clock_alias", "reset"]);
    assert.deepEqual([...new Set(projected.edges.map((edge) => edge.net))].sort(), ["d", "y"]);
    assert.ok(graph.edges.some((edge) => edge.net === "clock_alias"));
    const restored = setNetRoutingEnabled(overrides, graph, "clock_alias", true);
    assert.deepEqual(restored.unroutedNets, ["reset"]);
    assert.deepEqual(overrides.unroutedNets, ["clk", "reset"]);
  }
});

test("alias cycles and reordered aliases terminate with identical exclusions", () => {
  const aliases = [{ lhs: "a", rhs: "b" }, { lhs: "b", rhs: "c" }, { lhs: "c", rhs: "a" }];
  assert.deepEqual([...resolveUnroutedNets({ aliases }, ["a"])].sort(), ["a", "b", "c"]);
  assert.deepEqual([...resolveUnroutedNets({ aliases: aliases.toReversed() }, ["a"])].sort(), ["a", "b", "c"]);
});

test("constant assignments do not merge independent nets or hide other constant consumers", () => {
  for (const literal of ["1'b0", "'0", "0", "1'bx"]) {
    const constantModule = parseVerilog(`module constants(input d, output y, z, w);
      wire reset, reset_alias, scan_en;
      assign reset = ${literal}; assign reset_alias = reset; assign scan_en = ${literal};
      AND2X1 u0 (.A(reset_alias), .B(d), .Y(y));
      AND2X1 u1 (.A(scan_en), .B(d), .Y(z));
      AND2X1 u2 (.A(${literal}), .B(d), .Y(w)); endmodule`).modules[0];
    for (const showAliases of [false, true]) {
      const fullGraph = buildWorkspaceGraph(constantModule, { showAliases });
      const before = structuredClone(fullGraph);
      const graph = applyWorkspaceGraphTransforms(fullGraph, { unroutedNets: ["reset"], useFanoutHubs: false });
      assert.deepEqual(graph.unroutedNets, ["reset", "reset_alias"]);
      assert.equal(graph.edges.some((edge) => ["reset", "reset_alias"].includes(edge.net)), false);
      assert.ok(graph.edges.some((edge) => edge.net === "scan_en"));
      assert.ok(graph.edges.some((edge) => edge.target === "cell:u2" && edge.net === literal));
      const resetAssign = fullGraph.nodes.find((node) => node.kind === "assign" && node.ref.lhs === "reset");
      if (resetAssign) assert.equal(graph.edges.some((edge) => edge.target === resetAssign.id), false);
      assert.deepEqual(setNetRoutingEnabled({ unroutedNets: ["reset"] }, fullGraph, "scan_en", true).unroutedNets, ["reset"]);
      assert.equal(setNetRoutingEnabled({ unroutedNets: ["reset"] }, fullGraph, "reset_alias", true).unroutedNets, undefined);
      assert.deepEqual(fullGraph, before);
    }
  }
});

test("literal-looking escaped identifiers still participate in real net aliases", () => {
  const escaped = parseVerilog(String.raw`module escaped(input \1'b0 , output y);
    wire alias_net; assign alias_net = \1'b0 ; BUFX1 u (.A(alias_net), .Y(y)); endmodule`).modules[0];
  for (const showAliases of [false, true]) {
    const graph = buildWorkspaceGraph(escaped, { showAliases });
    const excluded = resolveUnroutedNets(graph, ["alias_net"]);
    assert.ok(excluded.has(escaped.ports[0].name));
    assert.equal(excluded.size, 2);
  }
});

test("escaped and indexed net names are exact identifiers, independent of display names", () => {
  const escaped = parseVerilog(String.raw`module escaped(input \clk/div[0] , input clk_data, output y);
    AND2X1 u (.A(\clk/div[0] ), .B(clk_data), .Y(y)); endmodule`).modules[0];
  const graph = buildWorkspaceGraph(escaped);
  const clock = graph.edges.find((edge) => edge.targetPin === "A").net;
  const result = applyWorkspaceGraphTransforms(graph, { unroutedNets: [clock], useFanoutHubs: false });
  assert.equal(result.edges.some((edge) => edge.net === clock), false);
  assert.ok(result.edges.some((edge) => edge.net === "clk_data"));
  assert.deepEqual(result.nodes, graph.nodes);
});

test("high-fanout clocks are excluded before hubs and Focused boundary routing", () => {
  const fanout = parseVerilog(`module many(input clk, input d); wire ${Array.from({ length: 12 }, (_, i) => `n${i}`).join(",")};
    ${Array.from({ length: 12 }, (_, i) => `AND2X1 u${i} (.A(clk),.B(d),.Y(n${i}));`).join("\n")} endmodule`).modules[0];
  const graph = buildWorkspaceGraph(fanout);
  const projected = applyWorkspaceGraphTransforms(graph, { unroutedNets: ["clk"] });
  assert.equal(projected.edges.some((edge) => edge.net === "clk"), false);
  assert.equal(projected.nodes.some((node) => node.kind === "hub" && node.ref.name === "clk"), false);
  assert.equal(projected.nodes.filter((node) => node.kind === "cell").length, 12);
  const focused = selectWorkspaceGraphView(graph, { viewMode: "focused", rootNodeIds: ["cell:u0"], faninDepth: 1, fanoutDepth: 1 });
  const filtered = applyWorkspaceGraphTransforms(focused, { fullGraph: graph, unroutedNets: ["clk"] });
  assert.equal(filtered.edges.some((edge) => edge.net === "clk"), false);
  assert.ok(filtered.nodes.some((node) => node.id === "cell:u0"));
});

test("active provider never receives excluded edges; Adjust and SVG export retain the exclusion", async () => {
  let received;
  const workspace = await buildModuleWorkspace({ module, graphOverrides: overrides,
    layoutProvider: { id: provider.id, layout(graph, options) { received = graph; return provider.layout(graph, options); } } });
  assert.equal(received.edges.some((edge) => ["clk", "clock_alias", "reset"].includes(edge.net)), false);
  assert.ok(workspace.fullGraph.edges.some((edge) => edge.net === "reset"));
  assert.equal(workspace.graph.edges.length, 2);
  assert.deepEqual(validateLayoutGraph(workspace.graph), []);
  assert.doesNotMatch(renderSchematicSvg(workspace.graph), /class="edge[^\"]*"[^>]*data-net="(?:clk|clock_alias|reset)"/);
  const node = workspace.graph.nodes.find((item) => item.id === "cell:u0");
  const moved = await buildModuleWorkspace({ module, graphOverrides: overrides, layoutProvider: provider,
    nodePositions: new Map([[node.id, { x: node.x + 20, y: node.y + 10 }]]) });
  assert.deepEqual(moved.graph.edges.map((edge) => edge.net).sort(), ["d", "y"]);
  assert.deepEqual(moved.graph.wireRoutes.map((route) => route.net).sort(), ["d", "y"]);
});

test("exclusion invalidates prepared-graph geometry caches and remains deterministic", async () => {
  const fullGraph = buildWorkspaceGraph(module);
  const options = { module, preparedFullGraph: fullGraph, layoutProvider: provider,
    artifactCache: createWorkspaceArtifactCache(), artifactIdentity: { documentId: "d", sessionId: "s" } };
  const routed = await buildModuleWorkspace(options);
  const omitted = await buildModuleWorkspace({ ...options, graphOverrides: overrides });
  assert.notEqual(omitted.autoGraph, routed.autoGraph);
  assert.equal((await buildModuleWorkspace({ ...options, graphOverrides: overrides })).autoGraph, omitted.autoGraph);
  assert.equal((await buildModuleWorkspace(options)).autoGraph, routed.autoGraph);
  const reordered = await buildModuleWorkspace({ ...options, graphOverrides: overrides,
    preparedFullGraph: { ...fullGraph, nodes: fullGraph.nodes.toReversed(), edges: fullGraph.edges.toReversed() } });
  const signature = (graph) => ({
    nodes: graph.nodes.map(({ id, x, y }) => ({ id, x, y })).sort((a, b) => a.id.localeCompare(b.id)),
    edges: graph.edges.map(({ id, points }) => ({ id, points })).sort((a, b) => a.id.localeCompare(b.id))
  });
  assert.deepEqual(signature(reordered.graph), signature(omitted.graph));
});

test("Compare routing exclusions are independent and share the Single projection", async () => {
  const workspace = await buildCompareWorkspace({ leftModule: module, rightModule: module,
    layoutProvider: provider, graphOverrides: { left: overrides, right: null } });
  assert.deepEqual(workspace.graphs.left.edges.map((edge) => edge.net).sort(), ["d", "y"]);
  assert.ok(workspace.graphs.right.edges.some((edge) => edge.net === "reset"));
  assert.deepEqual(workspace.fullGraphs.left.edges, workspace.fullGraphs.right.edges);
});

test("routing commands survive Single/Compare bridges, unrelated overrides and module/history/session snapshots", () => {
  const state = createAppState(DEFAULT_LAYOUT_POLICY);
  state.currentModule = module;
  state.document = { documentId: "d" };
  state.fullGraph = buildWorkspaceGraph(module);
  state.compare.leftModuleName = "top";
  state.compare.rightModuleName = "top";
  state.compare.fullGraphs = { left: state.fullGraph, right: state.fullGraph };
  const singleViewSession = createSingleViewSessionBridge({ state, getDocumentId: () => "d" });
  const compareViewSessions = createCompareViewSessionBridge({ state, getDocumentId: () => "d" });
  const commands = createStateCommandsController({ state, elements: {}, services: { singleViewSession, compareViewSessions, recordViewHistory() {} } });
  const rebuilds = [];
  const routing = createNetRoutingBridge({
    readContext: (side) => ({ fullGraph: state.fullGraph, graphOverrides: side ? state.compare.graphOverrides[side] : state.graphOverrides }),
    updateOverrides: (side, update) => side ? commands.updateCompareOverrides(side, update) : commands.updateSingleOverrides(update),
    rebuild: (side) => rebuilds.push(side)
  });
  routing.setEnabled("clk", false);
  assert.equal(routing.isEnabled("clock_alias"), false);
  commands.updateSingleOverrides((value) => value.nodeSizes.set("cell:u0", { width: 120, height: 90 }));
  assert.deepEqual(state.graphOverrides.unroutedNets, ["clk"]);
  assert.deepEqual(singleViewSession.sessions.require("single:primary").overrides.graphOverrides.unroutedNets, ["clk"]);
  saveModuleWorkspace(state, "top");
  const history = createViewHistoryEntry(state);
  let encoded;
  const storage = { setItem(key, value) { encoded = value; }, getItem() { return encoded; } };
  saveSessionState(createSessionSnapshot(state), storage);
  assert.deepEqual(loadSessionState(storage).unroutedNets, ["clk"]);
  routing.setEnabled("clock_alias", true);
  assert.equal(routing.isEnabled("clk"), true);
  assert.deepEqual(history.overrides.graphOverrides.unroutedNets, ["clk"]);
  restoreModuleWorkspace(state, "top");
  assert.deepEqual(state.graphOverrides.unroutedNets, ["clk"]);
  routing.setEnabled("reset", false, "left");
  commands.updateCompareOverrides("left", (value) => value.nodeSizes.set("cell:u0", { width: 120, height: 90 }));
  assert.equal(routing.isEnabled("reset", "left"), false);
  assert.equal(routing.isEnabled("reset", "right"), true);
  assert.deepEqual(rebuilds, [null, null, "left"]);
});

test("Golden round trip retains routing overrides", async () => {
  const workspace = await buildModuleWorkspace({ module, graphOverrides: overrides, layoutProvider: provider });
  const golden = createLayoutGolden(workspace.graph, { layoutOptions: { graphOverrides: overrides } });
  assert.deepEqual(getLayoutGoldenState(JSON.stringify(golden)).graphOverrides.unroutedNets, ["clk", "reset"]);
});

test("folded upstream aliases remain valid Focused roots before and after restoring routing", async () => {
  for (const showAliases of [false, true]) {
    for (const graphOverrides of [overrides, null]) {
      const workspace = await buildModuleWorkspace({ module, layoutProvider: provider, graphOverrides, showAliases,
        viewMode: "focused", focusedRootNodeIds: ["net:clk"], faninDepth: 1, fanoutDepth: 1 });
      assert.ok(workspace.graph.nodes.some((node) => node.id === "cell:u0"));
      assert.ok(workspace.graph.nodes.some((node) => node.id === "input:clk"));
      assert.equal(workspace.graph.edges.some((edge) => edge.net === "clock_alias"), !graphOverrides);
      assert.deepEqual(validateLayoutGraph(workspace.graph), []);
    }
  }
});

test("net inspector uses safe shared routing controls for Single and Compare", () => {
  const hostileName = 'clk/<img src=x onerror="oops">[0]';
  const fullGraph = { nodes: [], edges: [{ id: "e", source: "a", target: "b", net: hostileName, label: hostileName }] };
  const input = { addEventListener(type, callback) { this.change = callback; } };
  const details = { querySelector() { return input; } };
  const changes = [];
  const inspector = createInspectorController({ state: { fullGraph, compare: { fullGraphs: { left: fullGraph }, graphs: {} } },
    elements: { details }, services: { updateCellDefinitionControls() {} },
    netRouting: { isEnabled() { return false; }, setEnabled(...args) { changes.push(args); } } });
  inspector.renderNetSelection(hostileName);
  assert.match(details.innerHTML, /data-route-net/);
  assert.doesNotMatch(details.innerHTML, /<img/);
  input.change({ target: { checked: true } });
  inspector.renderNetSelection(hostileName, "left");
  input.change({ target: { checked: false } });
  assert.deepEqual(changes, [[hostileName, true, null], [hostileName, false, "left"]]);
  assert.match(renderNetRoutingPanel(true), /data-route-net checked/);
  assert.doesNotMatch(renderNetRoutingPanel(false), /checked/);
  assert.doesNotThrow(() => bindNetRoutingPanel({ querySelector() { return null; } }, () => {}));
});

test("search can inspect an unrouted net in the current view without rebuilding", () => {
  const selected = [];
  const fullGraph = buildWorkspaceGraph(module);
  const focused = selectWorkspaceGraphView(fullGraph, { viewMode: "focused", rootNodeIds: ["cell:u0"], faninDepth: 1, fanoutDepth: 1 });
  const graph = applyWorkspaceGraphTransforms(focused, { fullGraph, unroutedNets: ["clk"] });
  const controller = createSearchNavigationController({
    state: { currentModule: module, fullGraph, graph },
    elements: { searchResults: {} }, services: { setSelectedNet: (name) => selected.push(name), setStatus() {} }
  });
  controller.activateSearchResult({ moduleName: "top", target: { kind: "net", name: "clk" }, label: "clk" });
  assert.deepEqual(selected, ["clk"]);
});

test("excluded nets outside Focused and Search-first views still reveal their real neighborhood", async () => {
  for (const viewMode of ["focused", "search-first"]) {
    const harness = await createRoutingSearchHarness(viewMode);
    assert.equal(harness.state.graph.nodes.some((node) => node.id === "cell:u_clock"), false);
    assert.ok(!harness.state.graph.unroutedNets?.includes("clk"));
    harness.controller.activateSearchResult(harness.result);
    await harness.flush();
    assert.ok(harness.state.focusedRootNodeIds.includes("net:clk"));
    assert.ok(harness.state.graph.nodes.some((node) => node.id === "cell:u_clock"));
    assert.equal(harness.state.graph.edges.some((edge) => edge.net === "clk"), false);
    assert.equal(harness.state.selectedNet, "clk");
    assert.equal(harness.history.length, 1);
    harness.state.graphOverrides = setNetRoutingEnabled(harness.state.graphOverrides, harness.state.fullGraph, "clk", true);
    await harness.render();
    assert.ok(harness.state.graph.edges.some((edge) => edge.net === "clk"));
  }
});

test("explicit Add to Focus selects an excluded net after its neighborhood is rendered", async () => {
  const harness = await createRoutingSearchHarness("focused");
  harness.controller.addSearchResultToFocus(harness.result);
  await harness.flush();
  assert.ok(harness.state.focusedRootNodeIds.includes("net:clk"));
  assert.ok(harness.state.graph.nodes.some((node) => node.id === "cell:u_clock"));
  assert.equal(harness.state.selectedNet, "clk");
  assert.equal(harness.history[0].selectedNet, "clk");
});

async function createRoutingSearchHarness(viewMode) {
  const design = parseVerilog(`module isolated(input clk, d, output y, z);
    BUFX1 u_clock (.A(clk), .Y(y)); BUFX1 u_data (.A(d), .Y(z)); endmodule`);
  const state = createAppState(DEFAULT_LAYOUT_POLICY);
  Object.assign(state, { design, currentModule: design.modules[0], document: { documentId: "d" }, viewMode,
    focusedRootNodeIds: viewMode === "focused" ? ["cell:u_data"] : [], selectedNodeId: "cell:u_data",
    graphOverrides: { nodeProperties: {}, cellPinDirections: {}, unroutedNets: ["clk"] } });
  const render = async () => Object.assign(state, await buildModuleWorkspace(createSingleWorkspaceInput(state, provider)));
  await render();
  const bridge = createSingleViewSessionBridge({ state, getDocumentId: () => "d" });
  const history = [];
  let pending;
  const controller = createSearchNavigationController({ state, elements: { searchResults: {} }, services: {
    singleViewSession: bridge,
    setSelectedNet: (name) => bridge.dispatch({ type: "selection.set", objectRef: bridge.objectRefForNet(name) }),
    setSingleTransform: (viewport) => bridge.dispatch({ type: "viewport.set", viewport }),
    renderCurrentModuleGraph: ({ onRendered }) => { pending = render().then(() => onRendered(state.graph)); },
    recordViewHistory: () => history.push(createViewHistoryEntry(state)), setStatus() {}, getSvg: () => null
  } });
  return { state, controller, render, history, flush: () => pending,
    result: { moduleName: "isolated", label: "clk", target: { kind: "net", name: "clk" } } };
}

test("unavailable nets still cannot create a dangling search selection", () => {
  const statuses = [];
  const controller = createSearchNavigationController({
    state: { currentModule: module, graph: { nodes: [], edges: [] }, fullGraph: { nodes: [], edges: [] } },
    elements: { searchResults: {} }, services: {
      setSelectedNet() { assert.fail("Unavailable net selected"); }, setStatus: (message) => statuses.push(message)
    }
  });
  controller.activateSearchResult({ moduleName: "top", target: { kind: "net", name: "missing" }, label: "missing" });
  assert.match(statuses[0], /unavailable/);
});

test("post-layout controls preserve the selected net inspector on both canvases", () => {
  const state = createAppState(DEFAULT_LAYOUT_POLICY);
  state.graph = { nodes: [], edges: [], unroutedNets: ["clk"] };
  state.selectedNet = "clk";
  const element = { classList: { toggle() {} }, setAttribute() {} };
  const selected = [];
  const controller = createGoldenController({ state,
    elements: Object.fromEntries(["canvas", "adjustLayoutButton", "saveGoldenButton", "exportSvgButton", "resetLayoutButton"].map((name) => [name, { ...element }])),
    services: { countGraphOverrides: () => 1, hasCompareLayoutOverrides: () => true,
      renderNetSelection: (...args) => selected.push(args), renderSelection() { assert.fail("Net selection was cleared"); } } });
  controller.updateCalibrationControls();
  state.compare.active = true;
  state.compare.selectedKind = "net";
  state.compare.selectedName = "reset";
  state.compare.selectedSide = "left";
  controller.updateCalibrationControls();
  assert.deepEqual(selected, [["clk"], ["reset", "left"]]);
});
