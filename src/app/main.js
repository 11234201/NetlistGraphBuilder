import { parseVerilog } from "../parser/verilogParser.js";
import { inspectGraphNet, inspectGraphNode } from "../analysis/graphInspector.js";
import { recommendModulePair } from "../analysis/moduleCompare.js";
import { compareLayoutGraphs, createLayoutGolden } from "../layout/layoutGolden.js";
import { DEFAULT_LAYOUT_POLICY } from "../layout/layoutPolicy.js";
import { getLayoutProvider, listLayoutProviders } from "../layout/layoutProvider.js";
import { applyPositionedOverrides } from "../layout/positionedRouting.js";
import { snapNodePosition } from "../layout/snap.js";
import { renderSchematicSvg } from "../render/svgRenderer.js";
import { renderSchematicIntoMount } from "../render/progressiveSvgRenderer.js";
import { createStandaloneSvg } from "../render/svgExport.js";
import {
  buildDesignSearchIndex,
  searchDesignIndex
} from "../search/designSearch.js";
import { parseTimingLog } from "../timing/timingParser.js";
import { bindAdjustPanel, renderAdjustPanel } from "../ui/adjustPanel.js";
import {
  escapeAttr,
  escapeHtml,
  renderDefinitionRows as statsRows
} from "../ui/html.js";
import { renderObjectDetails } from "../ui/objectDetailsPanel.js";
import { getDraggedNodePosition, sameNodePosition } from "../ui/nodeDrag.js";
import {
  clientPointToViewBox,
  formatViewportTransform,
  getAdaptiveMaxScale,
  getPannedTransform,
  getReadableObjectScale,
  getZoomedTransform
} from "../ui/viewport.js";
import {
  bindTimingPanel,
  getTimingBadgeChoices,
  isTimingBadgePosition,
  renderTimingPanel,
  updateTimingBadgeChoices
} from "../ui/timingPanel.js";
import {
  createAppState,
  createEmptyGraphOverrides,
  restoreCompareWorkspace,
  restoreModuleWorkspace,
  resetDesignWorkspace,
  resetTimingPresentation,
  saveCompareWorkspace,
  saveModuleWorkspace
} from "./appState.js";
import { sampleNetlist } from "./sampleNetlist.js";
import { createSessionSnapshot, loadSessionState, saveSessionState } from "./sessionState.js";
import {
  buildCompareWorkspace,
  findCompareNode,
  getCompareNodeName
} from "./compareWorkspace.js";
import { buildModuleWorkspace } from "./moduleWorkspace.js";

const state = createAppState(DEFAULT_LAYOUT_POLICY);
let sessionSaveTimer = null;

const elements = {
  fileInput: document.querySelector("#fileInput"),
  timingInput: document.querySelector("#timingInput"),
  moduleSelect: document.querySelector("#moduleSelect"),
  layoutProviderSelect: document.querySelector("#layoutProviderSelect"),
  compareButton: document.querySelector("#compareButton"),
  comparePanel: document.querySelector("#comparePanel"),
  leftModuleSelect: document.querySelector("#leftModuleSelect"),
  rightModuleSelect: document.querySelector("#rightModuleSelect"),
  applyCompareButton: document.querySelector("#applyCompareButton"),
  exitCompareButton: document.querySelector("#exitCompareButton"),
  syncCompareInput: document.querySelector("#syncCompareInput"),
  compareLayoutSelect: document.querySelector("#compareLayoutSelect"),
  compareOutputSelect: document.querySelector("#compareOutputSelect"),
  searchInput: document.querySelector("#searchInput"),
  searchClearButton: document.querySelector("#searchClearButton"),
  searchResults: document.querySelector("#searchResults"),
  wholeViewButton: document.querySelector("#wholeViewButton"),
  faninViewButton: document.querySelector("#faninViewButton"),
  fanoutViewButton: document.querySelector("#fanoutViewButton"),
  coneDepthInput: document.querySelector("#coneDepthInput"),
  showAliasesInput: document.querySelector("#showAliasesInput"),
  fanoutHubsInput: document.querySelector("#fanoutHubsInput"),
  collapseGroupsInput: document.querySelector("#collapseGroupsInput"),
  collapseAllButton: document.querySelector("#collapseAllButton"),
  wireSpacingInput: document.querySelector("#wireSpacingInput"),
  wireSpacingValue: document.querySelector("#wireSpacingValue"),
  fitButton: document.querySelector("#fitButton"),
  exportSvgButton: document.querySelector("#exportSvgButton"),
  adjustLayoutButton: document.querySelector("#adjustLayoutButton"),
  saveGoldenButton: document.querySelector("#saveGoldenButton"),
  resetLayoutButton: document.querySelector("#resetLayoutButton"),
  workspace: document.querySelector(".workspace"),
  sidebarResizeHandle: document.querySelector("#sidebarResizeHandle"),
  canvas: document.querySelector("#canvas"),
  mount: document.querySelector("#schematicMount"),
  compareMount: document.querySelector("#compareMount"),
  leftMount: document.querySelector("#leftSchematicMount"),
  rightMount: document.querySelector("#rightSchematicMount"),
  stats: document.querySelector("#designStats"),
  details: document.querySelector("#selectionDetails"),
  diagnostics: document.querySelector("#diagnosticsList"),
  status: document.querySelector("#statusBar")
};

elements.fileInput.addEventListener("change", handleFileChange);
elements.timingInput.addEventListener("change", handleTimingFileChange);
elements.moduleSelect.addEventListener("change", () => {
  selectModule(elements.moduleSelect.value);
});
elements.layoutProviderSelect.addEventListener("change", handleLayoutProviderChange);
elements.compareButton.addEventListener("click", () => {
  if (state.compare.active) exitCompareView();
  else enterCompareView();
});
elements.applyCompareButton.addEventListener("click", applyCompareSelection);
elements.exitCompareButton.addEventListener("click", exitCompareView);
elements.syncCompareInput.addEventListener("change", (event) => { state.compare.synchronized = event.target.checked; });
elements.compareLayoutSelect.addEventListener("change", (event) => {
  state.compare.layout = event.target.value === "horizontal" ? "horizontal" : "vertical";
  applyCompareLayout();
  fitToView();
});
elements.compareOutputSelect.addEventListener("change", (event) => {
  state.compare.outputName = event.target.value || null;
  elements.coneDepthInput.disabled = !state.compare.outputName;
  renderCompareGraphs();
  renderStats();
});
elements.searchInput.addEventListener("input", handleSearchInput);
elements.searchInput.addEventListener("keydown", handleSearchKeydown);
elements.searchInput.addEventListener("focus", handleSearchInput);
elements.searchClearButton.addEventListener("click", clearSearch);
elements.searchResults.addEventListener("click", handleSearchResultClick);
elements.wholeViewButton.addEventListener("click", () => setViewMode("whole"));
elements.faninViewButton.addEventListener("click", () => setViewMode("fanin"));
elements.fanoutViewButton.addEventListener("click", () => setViewMode("fanout"));
elements.coneDepthInput.addEventListener("change", handleConeDepthChange);
elements.showAliasesInput.addEventListener("change", handleAliasVisibilityChange);
elements.fanoutHubsInput.addEventListener("change", handleGraphSimplificationChange);
elements.collapseGroupsInput.addEventListener("change", handleGraphSimplificationChange);
elements.collapseAllButton.addEventListener("click", () => {
  state.expandedGroupIds.clear();
  rerenderActiveGraph();
});
elements.wireSpacingInput.addEventListener("input", handleWireSpacingChange);
elements.fitButton.addEventListener("click", fitToView);
elements.exportSvgButton.addEventListener("click", exportCurrentSvg);
elements.adjustLayoutButton.addEventListener("click", toggleCalibrationMode);
elements.saveGoldenButton.addEventListener("click", saveLayoutGolden);
elements.resetLayoutButton.addEventListener("click", resetLayoutOverrides);
elements.sidebarResizeHandle.addEventListener("pointerdown", startSidebarResize);
elements.sidebarResizeHandle.addEventListener("keydown", handleSidebarResizeKeydown);
elements.canvas.addEventListener("wheel", handleWheel, { passive: false });
elements.canvas.addEventListener("pointerdown", handlePointerDown);
window.addEventListener("beforeunload", () => {
  if (state.currentSource) saveSessionState(createSessionSnapshot(state));
});

const restoredSession = loadSessionState();
applySessionPreferences(restoredSession);
renderLayoutProviderOptions();
loadDesign(restoredSession?.source || sampleNetlist, restoredSession?.sourceLabel || "built-in sample", restoredSession);
updateCalibrationControls();

function startSidebarResize(event) {
  if (event.button !== 0) {
    return;
  }
  event.preventDefault();
  elements.sidebarResizeHandle.setPointerCapture(event.pointerId);
  elements.workspace.classList.add("is-resizing-sidebar");

  const move = (moveEvent) => setSidebarWidth(moveEvent.clientX - elements.workspace.getBoundingClientRect().left);
  const up = () => {
    elements.workspace.classList.remove("is-resizing-sidebar");
    elements.sidebarResizeHandle.removeEventListener("pointermove", move);
    elements.sidebarResizeHandle.removeEventListener("pointerup", up);
    elements.sidebarResizeHandle.removeEventListener("pointercancel", up);
  };

  elements.sidebarResizeHandle.addEventListener("pointermove", move);
  elements.sidebarResizeHandle.addEventListener("pointerup", up);
  elements.sidebarResizeHandle.addEventListener("pointercancel", up);
}

function handleSidebarResizeKeydown(event) {
  if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") {
    return;
  }
  event.preventDefault();
  const currentWidth = Number.parseFloat(getComputedStyle(elements.workspace).getPropertyValue("--sidebar-width")) || 300;
  setSidebarWidth(currentWidth + (event.key === "ArrowRight" ? 16 : -16));
}

function setSidebarWidth(width) {
  const maxWidth = Math.max(320, Math.min(640, elements.workspace.clientWidth - 320));
  const nextWidth = clamp(Math.round(width), 240, maxWidth);
  elements.workspace.style.setProperty("--sidebar-width", `${nextWidth}px`);
  elements.sidebarResizeHandle.setAttribute("aria-valuenow", String(nextWidth));
}

async function handleFileChange(event) {
  const file = event.target.files?.[0];
  if (!file) {
    return;
  }
  const text = await file.text();
  loadDesign(text, file.name);
}

async function handleTimingFileChange(event) {
  const file = event.target.files?.[0];
  if (!file) {
    return;
  }
  const text = await file.text();
  state.timing = parseTimingLog(text);
  resetTimingPresentation(state);
  if (state.compare.active) {
    renderCompareGraphs();
    renderStats();
    setStatus(`Loaded timing ${file.name}: ${state.timing.instanceCount} instance(s)`);
    return;
  }
  if (state.currentModule) {
    rerenderPreservingView(state.selectedNodeId);
    renderStats();
  }
  setStatus(`Loaded timing ${file.name}: ${state.timing.instanceCount} instance(s)`);
}

function loadDesign(source, label, restore = null) {
  try {
    state.design = parseVerilog(source);
    state.currentSource = source;
    state.currentSourceLabel = label;
    resetDesignWorkspace(state);
    state.currentModule = null;
    state.searchIndex = buildDesignSearchIndex(state.design);
    clearSearch();
    if (restore?.searchQuery) {
      state.searchQuery = restore.searchQuery;
      elements.searchInput.value = restore.searchQuery;
      handleSearchInput();
    }
    renderModuleOptions();
    const firstModule = state.design.modules.find((module) => module.name === restore?.moduleName)
      || state.design.modules[0];
    if (firstModule) {
      selectModule(firstModule.name);
      if (restore?.viewMode && restore.viewMode !== "whole" && restore.coneRootNodeId) {
        state.viewMode = restore.viewMode;
        state.coneRootNodeId = restore.coneRootNodeId;
        renderCurrentModuleGraph();
      }
      if (restore?.transform) state.transform = { ...restore.transform };
      setStatus(`Loaded ${label}: ${state.design.modules.length} module(s)`);
    } else {
      state.currentModule = null;
      state.autoGraph = null;
      state.graph = null;
      elements.mount.innerHTML = "";
      updateCalibrationControls();
      setStatus(`Loaded ${label}: no modules found`);
    }
  } catch (error) {
    state.autoGraph = null;
    state.graph = null;
    elements.mount.innerHTML = "";
    updateCalibrationControls();
    setStatus(`Parse failed: ${error.message}`);
    throw error;
  }
}

function renderModuleOptions() {
  elements.moduleSelect.innerHTML = "";
  for (const module of state.design.modules) {
    const option = document.createElement("option");
    option.value = module.name;
    option.textContent = module.displayName;
    elements.moduleSelect.append(option);
  }
  renderCompareModuleOptions();
}

function renderCompareModuleOptions() {
  for (const select of [elements.leftModuleSelect, elements.rightModuleSelect]) {
    select.innerHTML = "";
    for (const module of state.design.modules) {
      const option = document.createElement("option");
      option.value = module.name;
      option.textContent = module.displayName;
      select.append(option);
    }
  }
}

function enterCompareView() {
  const left = state.currentModule || state.design?.modules[0];
  const right = recommendModulePair(state.design?.modules || [], left?.name)
    || state.design?.modules.find((module) => module !== left);
  if (!left || !right) {
    setStatus("Compare requires at least two modules");
    return;
  }
  elements.leftModuleSelect.value = left.name;
  elements.rightModuleSelect.value = right.name;
  applyCompareSelection();
}

function applyCompareSelection() {
  const left = state.design.modules.find((module) => module.name === elements.leftModuleSelect.value);
  const right = state.design.modules.find((module) => module.name === elements.rightModuleSelect.value);
  if (!left || !right || left === right) {
    setStatus("Choose two different modules to compare");
    return;
  }
  const pairChanged = state.compare.leftModuleName !== left.name || state.compare.rightModuleName !== right.name;
  if (state.compare.leftModuleName && state.compare.rightModuleName) {
    saveCompareWorkspace(state);
  }
  state.compare.active = true;
  if (pairChanged) {
    restoreCompareWorkspace(state, left.name, right.name);
  }
  state.compare.leftModuleName = left.name;
  state.compare.rightModuleName = right.name;
  state.compare.outputName = null;
  state.compare.selectedName = null;
  state.compare.selectedSide = null;
  state.compare.transforms.left = { x: 0, y: 0, scale: 1 };
  state.compare.transforms.right = { x: 0, y: 0, scale: 1 };
  elements.comparePanel.hidden = false;
  elements.mount.hidden = true;
  elements.compareMount.hidden = false;
  elements.compareButton.classList.add("is-active");
  elements.compareButton.textContent = "Single";
  elements.compareButton.title = "退出双 module 对比视图";
  elements.compareButton.setAttribute("aria-pressed", "true");
  elements.compareLayoutSelect.value = state.compare.layout;
  applyCompareLayout();
  elements.coneDepthInput.disabled = true;
  renderCompareGraphs();
  renderStats();
  renderSelection(null);
  updateCalibrationControls();
  setStatus(`Comparing ${left.displayName} and ${right.displayName}`);
}

function exitCompareView() {
  saveCompareWorkspace(state);
  state.compare.active = false;
  elements.comparePanel.hidden = true;
  elements.compareMount.hidden = true;
  elements.mount.hidden = false;
  elements.compareButton.classList.remove("is-active");
  elements.compareButton.textContent = "Compare";
  elements.compareButton.title = "进入双 module 对比视图";
  elements.compareButton.setAttribute("aria-pressed", "false");
  updateViewControls();
  renderStats();
  updateCalibrationControls();
  applyTransform();
  setStatus(`Single module view: ${state.currentModule?.displayName || "-"}`);
}

function applyCompareLayout() {
  elements.compareMount.classList.toggle("is-horizontal", state.compare.layout === "horizontal");
  elements.compareMount.classList.toggle("is-vertical", state.compare.layout !== "horizontal");
}

function renderCompareGraphs() {
  const leftModule = getCompareModule("left");
  const rightModule = getCompareModule("right");
  if (!leftModule || !rightModule) return;
  const requestId = ++state.layoutRequestId;
  const workspace = buildCompareWorkspace({
    leftModule,
    rightModule,
    layoutProvider: getCurrentLayoutProvider(),
    layoutPolicy: state.layoutPolicy,
    outputName: state.compare.outputName,
    coneDepth: state.coneDepth,
    showAliases: state.showAliases,
    timing: state.timing,
    timingBadgeChoices: state.compare.timingBadgeChoices,
    timingBadgePositions: state.compare.timingBadgePositions,
    graphOverrides: state.compare.graphOverrides,
    nodePositions: state.compare.nodePositions,
    nodeSizes: state.compare.nodeSizes,
    useFanoutHubs: state.useFanoutHubs,
    collapseLargeGroups: state.collapseLargeGroups,
    expandedGroupIds: state.expandedGroupIds,
    moduleLibrary: state.design.modules
  });
  if (isPromise(workspace)) {
    setStatus(`Layout (${getCurrentLayoutProvider().label})…`);
    workspace.then((result) => {
      if (requestId === state.layoutRequestId) commitCompareWorkspace(result, leftModule, rightModule);
    }).catch(handleLayoutFailure);
    return;
  }
  commitCompareWorkspace(workspace, leftModule, rightModule);
}

function commitCompareWorkspace(workspace, leftModule, rightModule) {
  state.compare.fullGraphs = workspace.fullGraphs;
  state.compare.autoGraphs = workspace.autoGraphs;
  state.compare.graphs = workspace.graphs;
  state.compare.analysis = workspace.analysis;
  elements.compareMount.querySelector('[data-compare-side="left"] > header').textContent = leftModule.displayName;
  elements.compareMount.querySelector('[data-compare-side="right"] > header').textContent = rightModule.displayName;
  renderCompareOutputOptions(leftModule, rightModule);
  Promise.all([
    renderGraphMount(elements.leftMount, state.compare.graphs.left),
    renderGraphMount(elements.rightMount, state.compare.graphs.right)
  ]).then(() => {
    applyCompareHighlights();
    applyCompareTransforms();
    setStatus(`Compare ready (${getCurrentLayoutProvider().label})`);
  });
}

function renderCompareOutputOptions(left, right) {
  const selected = state.compare.outputName || "";
  const rightOutputs = new Set(right.ports.filter((port) => port.direction === "output").map((port) => port.name));
  const outputs = left.ports.filter((port) => port.direction === "output" && rightOutputs.has(port.name));
  elements.compareOutputSelect.innerHTML = `<option value="">Whole module</option>${outputs.map((port) =>
    `<option value="${escapeAttr(port.name)}">${escapeHtml(port.displayName)}</option>`).join("")}`;
  elements.compareOutputSelect.value = selected;
}

function getCompareModule(side) {
  return state.design?.modules.find((module) => module.name === state.compare[`${side}ModuleName`]);
}

function selectModule(moduleName) {
  const module = state.design.modules.find((item) => item.name === moduleName);
  if (!module) {
    return;
  }
  const switchingModule = state.currentModule?.name !== module.name;
  if (state.currentModule && switchingModule) {
    saveModuleWorkspace(state, state.currentModule.name);
  }
  state.currentModule = module;
  elements.moduleSelect.value = module.name;
  if (switchingModule) restoreModuleWorkspace(state, module.name);
  renderCurrentModuleGraph();
  state.transform = { x: 0, y: 0, scale: 1 };
  state.selectedNodeId = null;
  state.selectedNet = null;
  renderStats();
  renderDiagnostics();
  renderSelection(null);
  updateViewControls();
  applyTransform();
}

function renderCurrentModuleGraph() {
  const requestId = ++state.layoutRequestId;
  const layoutProvider = getCurrentLayoutProvider();
  const workspace = buildModuleWorkspace({
    module: state.currentModule,
    moduleLibrary: state.design.modules,
    graphOverrides: state.graphOverrides,
    timing: state.timing,
    timingBadgeChoices: state.timingBadgeChoices,
    timingBadgePositions: state.timingBadgePositions,
    showAliases: state.showAliases,
    viewMode: state.viewMode,
    coneRootNodeId: state.coneRootNodeId,
    coneDepth: state.coneDepth,
    useFanoutHubs: state.useFanoutHubs,
    collapseLargeGroups: state.collapseLargeGroups,
    expandedGroupIds: state.expandedGroupIds,
    layoutProvider,
    layoutPolicy: state.layoutPolicy,
    nodePositions: state.nodePositions,
    nodeSizes: state.nodeSizes
  });
  if (isPromise(workspace)) {
    setStatus(`Layout (${layoutProvider.label})…`);
    workspace.then((result) => {
      if (requestId === state.layoutRequestId) {
        commitCurrentWorkspace(result);
      }
    }).catch(handleLayoutFailure);
    return;
  }
  commitCurrentWorkspace(workspace);
}

function commitCurrentWorkspace(workspace) {
  state.fullGraph = workspace.fullGraph;
  commitCurrentGraph(workspace.autoGraph, workspace.graph);
}

function commitCurrentGraph(autoGraph, graph) {
  state.autoGraph = autoGraph;
  state.graph = graph;
  renderGraphMount(elements.mount, graph).then(() => {
    applyTransform();
    setStatus(`Ready (${getCurrentLayoutProvider().label})`);
  });
  updateCalibrationControls();
  updateViewControls();
  persistSession();
}

function renderGraphMount(mount, graph) {
  return renderSchematicIntoMount(mount, graph, {
    onProgress: ({ phase, rendered, total }) => {
      if (phase === "render") setStatus(`Rendering ${rendered}/${total}…`);
    }
  });
}

function renderLayoutProviderOptions() {
  elements.layoutProviderSelect.innerHTML = listLayoutProviders()
    .map((provider) => `<option value="${escapeAttr(provider.id)}">${escapeHtml(provider.label)}</option>`)
    .join("");
  elements.layoutProviderSelect.value = state.layoutProviderId;
}

function handleLayoutProviderChange(event) {
  state.layoutProviderId = event.target.value;
  state.transform = { x: 0, y: 0, scale: 1 };
  if (state.layoutProviderId === "elk-layered") {
    setStatus("ELK Layered is experimental; Simple Layered is recommended for schematic editing");
  }
  if (state.compare.active) renderCompareGraphs();
  else renderCurrentModuleGraph();
  persistSession();
}

function handleLayoutFailure(error) {
  state.layoutProviderId = "simple-layered";
  elements.layoutProviderSelect.value = state.layoutProviderId;
  setStatus(`Layout failed; using Simple Layered: ${error.message}`);
  if (state.compare.active) renderCompareGraphs();
  else renderCurrentModuleGraph();
}

function isPromise(value) {
  return Boolean(value && typeof value.then === "function");
}

function setViewMode(mode) {
  if (mode !== "whole") {
    const rootNodeId = state.selectedNodeId || state.coneRootNodeId;
    if (!rootNodeId) {
      setStatus(`Select a node before opening the ${mode} cone`);
      return;
    }
    state.coneRootNodeId = rootNodeId;
  }
  state.viewMode = mode;
  renderCurrentModuleGraph();
  state.transform = { x: 0, y: 0, scale: 1 };
  setSelectedNode(state.coneRootNodeId);
  applyTransform();
  setStatus(mode === "whole" ? "Whole module view" : `${mode} cone depth ${state.coneDepth}`);
}

function handleConeDepthChange(event) {
  state.coneDepth = clamp(Math.floor(Number(event.target.value) || 1), 1, 99);
  elements.coneDepthInput.value = String(state.coneDepth);
  if (state.compare.active && state.compare.outputName) {
    renderCompareGraphs();
    renderStats();
    setStatus(`Compare fanin cone depth ${state.coneDepth}`);
    return;
  }
  if (state.viewMode !== "whole") {
    setViewMode(state.viewMode);
  }
}

function handleAliasVisibilityChange(event) {
  const selectedNode = state.graph?.nodes.find((node) => node.id === state.selectedNodeId);
  state.showAliases = event.target.checked;
  if (state.compare.active) {
    renderCompareGraphs();
    renderStats();
    setStatus(state.showAliases ? "Compare aliases shown" : "Compare aliases collapsed");
    return;
  }
  const selectedNodeId = state.selectedNodeId;
  if (!state.showAliases && selectedNode?.kind === "assign") {
    state.viewMode = "whole";
    state.coneRootNodeId = null;
  }
  renderCurrentModuleGraph();
  state.selectedNodeId = null;
  setSelectedNode(state.graph.nodes.some((node) => node.id === selectedNodeId) ? selectedNodeId : null);
  applyTransform();
  setStatus(state.showAliases ? "Alias nodes shown" : `Collapsed ${state.fullGraph.aliases?.length || 0} alias node(s)`);
}

function updateViewControls() {
  const hasRoot = Boolean(state.selectedNodeId || state.coneRootNodeId);
  elements.wholeViewButton.classList.toggle("is-active", state.viewMode === "whole");
  elements.faninViewButton.classList.toggle("is-active", state.viewMode === "fanin");
  elements.fanoutViewButton.classList.toggle("is-active", state.viewMode === "fanout");
  elements.faninViewButton.disabled = !hasRoot;
  elements.fanoutViewButton.disabled = !hasRoot;
  elements.coneDepthInput.disabled = state.viewMode === "whole";
  elements.showAliasesInput.checked = state.showAliases;
  elements.fanoutHubsInput.checked = state.useFanoutHubs;
  elements.collapseGroupsInput.checked = state.collapseLargeGroups;
  elements.collapseAllButton.disabled = state.expandedGroupIds.size === 0;
}

function handleGraphSimplificationChange() {
  state.useFanoutHubs = elements.fanoutHubsInput.checked;
  state.collapseLargeGroups = elements.collapseGroupsInput.checked;
  rerenderActiveGraph();
}

function rerenderActiveGraph() {
  if (state.compare.active) renderCompareGraphs();
  else renderCurrentModuleGraph();
}

function handleWireSpacingChange(event) {
  const value = Number(event.target.value);
  state.layoutPolicy.spacing.wireLanePitch = clamp(value, 8, 40);
  elements.wireSpacingValue.value = String(state.layoutPolicy.spacing.wireLanePitch);
  if (!state.currentModule) {
    return;
  }

  if (state.compare.active) {
    renderCompareGraphs();
    renderStats();
    setStatus(`Wire spacing: ${state.layoutPolicy.spacing.wireLanePitch}px`);
    return;
  }

  const previousTransform = { ...state.transform };
  renderCurrentModuleGraph();
  state.transform = previousTransform;
  renderStats();
  renderDiagnostics();
  const selectedNode = state.selectedNodeId;
  state.selectedNodeId = null;
  setSelectedNode(selectedNode);
  applyTransform();
  setStatus(`Wire spacing: ${state.layoutPolicy.spacing.wireLanePitch}px`);
}

function setSelectedNode(nodeId) {
  state.selectedNodeId = nodeId;
  state.selectedNet = null;
  clearSchematicSelection();
  if (nodeId) {
    const nodeElement = elements.mount.querySelector(`[data-node-id="${cssEscape(nodeId)}"]`);
    nodeElement?.classList.add("is-selected");
  }
  const node = state.graph?.nodes.find((item) => item.id === nodeId) || null;
  renderSelection(node);
  updateViewControls();
}

function setSelectedNet(netName) {
  state.selectedNodeId = null;
  state.selectedNet = netName;
  clearSchematicSelection();
  for (const edgeElement of elements.mount.querySelectorAll(".edge")) {
    if (edgeElement.dataset.net === netName) {
      edgeElement.classList.add("is-selected");
    }
  }
  renderNetSelection(netName);
  updateViewControls();
}

function clearSchematicSelection() {
  for (const element of elements.mount.querySelectorAll(".node.is-selected, .edge.is-selected")) {
    element.classList.remove("is-selected");
  }
}

function handleSearchInput() {
  const query = elements.searchInput.value;
  state.searchQuery = query;
  state.searchResults = searchDesignIndex(state.searchIndex, query);
  state.activeSearchResult = state.searchResults.length > 0 ? 0 : -1;
  renderSearchResults();
}

function handleSearchKeydown(event) {
  if (event.key === "Escape") {
    elements.searchResults.hidden = true;
    state.activeSearchResult = -1;
    return;
  }
  if (event.key !== "ArrowDown" && event.key !== "ArrowUp" && event.key !== "Enter") {
    return;
  }
  if (state.searchResults.length === 0) {
    return;
  }

  event.preventDefault();
  if (event.key === "Enter") {
    activateSearchResult(state.searchResults[Math.max(0, state.activeSearchResult)]);
    return;
  }

  const direction = event.key === "ArrowDown" ? 1 : -1;
  state.activeSearchResult = (
    state.activeSearchResult + direction + state.searchResults.length
  ) % state.searchResults.length;
  renderSearchResults();
  elements.searchResults.querySelector(".search-result.is-active")?.scrollIntoView({ block: "nearest" });
}

function handleSearchResultClick(event) {
  const button = event.target.closest("[data-search-index]");
  if (!button) {
    return;
  }
  activateSearchResult(state.searchResults[Number(button.dataset.searchIndex)]);
}

function renderSearchResults() {
  const hasQuery = elements.searchInput.value.trim() !== "";
  elements.searchClearButton.hidden = !hasQuery;
  if (!hasQuery) {
    elements.searchResults.hidden = true;
    elements.searchResults.innerHTML = "";
    return;
  }

  elements.searchResults.hidden = false;
  if (state.searchResults.length === 0) {
    elements.searchResults.innerHTML = `<div class="search-empty">No matches</div>`;
    return;
  }

  elements.searchResults.innerHTML = state.searchResults
    .map((result, index) => {
      const active = index === state.activeSearchResult;
      const context = result.kind === "module"
        ? result.detail
        : `${result.detail} / ${result.moduleName}`;
      return `<button class="search-result${active ? " is-active" : ""}" type="button" role="option" aria-selected="${active}" data-search-index="${escapeAttr(index)}" title="${escapeAttr(result.label)}">
        <span class="search-result-kind">${escapeHtml(result.kind)}</span>
        <span class="search-result-label">${escapeHtml(result.label)}</span>
        <span class="search-result-context">${escapeHtml(context)}</span>
      </button>`;
    })
    .join("");
}

function clearSearch() {
  elements.searchInput.value = "";
  state.searchQuery = "";
  state.searchResults = [];
  state.activeSearchResult = -1;
  renderSearchResults();
}

function activateSearchResult(result) {
  if (!result) {
    return;
  }
  if (state.currentModule?.name !== result.moduleName) {
    selectModule(result.moduleName);
  }

  elements.searchResults.hidden = true;
  const target = result.target;
  if (target.kind === "module") {
    setSelectedNode(null);
    setStatus(`Search: module ${result.label}`);
    return;
  }
  if (target.kind === "net") {
    const edge = state.graph?.edges.find((item) => item.net === target.name);
    setSelectedNet(target.name);
    if (edge) {
      centerGraphPoint(getEdgeCenter(edge));
    }
    setStatus(`Search: net ${result.label}`);
    return;
  }

  const node = findSearchTargetNode(target);
  setSelectedNode(node?.id || null);
  if (node) {
    centerGraphPoint({
      x: node.x + node.width / 2,
      y: node.y + node.height / 2
    }, node.width);
  }
  setStatus(`Search: ${result.kind} ${result.label}`);
}

function findSearchTargetNode(target) {
  if (target.kind === "cell") {
    return state.graph?.nodes.find(
      (node) => node.kind === "cell" && node.ref?.instance === target.name
    );
  }
  if (target.kind === "port") {
    const preferredKind = target.direction === "output" ? "output" : "input";
    return state.graph?.nodes.find(
      (node) => node.kind === preferredKind && node.ref?.name === target.name
    ) || state.graph?.nodes.find(
      (node) => (node.kind === "input" || node.kind === "output") && node.ref?.name === target.name
    );
  }
  return null;
}

function centerGraphPoint(point, objectWidth = 100) {
  const svg = getSvg();
  if (!svg || !point) {
    return;
  }
  const viewBox = svg.viewBox.baseVal;
  const scale = getReadableObjectScale({
    viewBoxWidth: viewBox.width,
    viewportWidth: svg.getBoundingClientRect().width,
    objectWidth,
    currentScale: state.transform.scale
  });
  state.transform = {
    x: viewBox.width / 2 - point.x * scale,
    y: viewBox.height / 2 - point.y * scale,
    scale
  };
  applyTransform();
}

function getEdgeCenter(edge) {
  const points = edge.points || [];
  const middle = points[Math.floor(points.length / 2)];
  return middle || points[0] || null;
}

function renderStats() {
  if (state.compare.active && state.compare.analysis) {
    const { left, right, delta, unmatchedPorts, unmatchedNets } = state.compare.analysis;
    const pair = (a, b) => `${a} / ${b}`;
    elements.stats.innerHTML = statsRows([
      ["Cells L/R", pair(left.cells, right.cells)],
      ["Cell delta", signed(delta.cells)],
      ["Depth L/R", pair(left.logicDepth, right.logicDepth)],
      ["Depth delta", signed(delta.logicDepth)],
      ["Max fanout L/R", pair(left.maxFanout, right.maxFanout)],
      ["Fanout delta", signed(delta.maxFanout)],
      ["Gate kinds L", formatGateKinds(left.gateKinds)],
      ["Gate kinds R", formatGateKinds(right.gateKinds)],
      ["Unmatched ports", unmatchedPorts.length],
      ["Unmatched nets L/R", pair(unmatchedNets.left.length, unmatchedNets.right.length)]
    ]);
    return;
  }
  const module = state.currentModule;
  const graph = state.graph;
  elements.stats.innerHTML = statsRows([
    ["Module", module.displayName],
    ["Ports", graph.stats.ports],
    ["Nets", graph.stats.nets],
    ["Cells", graph.stats.cells],
    ["Assigns", graph.stats.assigns],
    ["Timing inst", state.timing?.instanceCount || 0],
    ["Graph nodes", graph.nodes.length],
    ["Graph edges", graph.edges.length]
  ]);
}

function signed(value) { return value > 0 ? `+${value}` : String(value); }
function formatGateKinds(counts) { return Object.entries(counts).map(([kind, count]) => `${kind}:${count}`).join(", ") || "-"; }

function applyCompareHighlights() {
  const analysis = state.compare.analysis;
  if (!analysis) return;
  const matchedPorts = new Set(analysis.matchedPorts);
  const unmatchedPorts = new Set(analysis.unmatchedPorts);
  const commonNets = new Set(analysis.commonNets);
  for (const side of ["left", "right"]) {
    const mount = side === "left" ? elements.leftMount : elements.rightMount;
    const graph = state.compare.graphs[side];
    for (const node of mount.querySelectorAll(".node")) {
      const id = node.dataset.nodeId || "";
      const graphNode = graph.nodes.find((item) => item.id === id);
      const name = getCompareNodeName(graphNode);
      if (matchedPorts.has(name)) node.classList.add("is-compare-match");
      if (unmatchedPorts.has(name)) node.classList.add("is-compare-unmatched");
      if (graphNode?.kind === "cell") {
        node.classList.add(analysis.commonGateKinds.includes(graphNode.gateKind || "blackbox")
          ? "is-compare-match"
          : "is-compare-unmatched");
      }
    }
    for (const edge of mount.querySelectorAll(".edge")) {
      edge.classList.add(commonNets.has(edge.dataset.net) ? "is-compare-match" : "is-compare-unmatched");
    }
  }
  if (state.compare.selectedName) selectCompareObject(state.compare.selectedKind, state.compare.selectedName, false);
}

function selectCompareObject(kind, name, focus = true, selectedSide = state.compare.selectedSide) {
  state.compare.selectedKind = kind;
  state.compare.selectedName = name;
  state.compare.selectedSide = selectedSide;
  for (const element of elements.compareMount.querySelectorAll(".is-selected")) element.classList.remove("is-selected");
  for (const side of ["left", "right"]) {
    const mount = side === "left" ? elements.leftMount : elements.rightMount;
    if (kind === "net") {
      for (const edge of mount.querySelectorAll(".edge")) if (edge.dataset.net === name) edge.classList.add("is-selected");
    } else {
      const graphNode = findCompareNode(state.compare.graphs[side], kind, name);
      if (graphNode) mount.querySelector(`[data-node-id="${cssEscape(graphNode.id)}"]`)?.classList.add("is-selected");
    }
  }
  if (focus) focusCompareSelection(kind, name);
  if (kind !== "net" && selectedSide) {
    const node = findCompareNode(state.compare.graphs[selectedSide], kind, name);
    if (node) {
      renderCompareSelection(selectedSide, node);
      return;
    }
  }
  elements.details.className = "details-block";
  elements.details.innerHTML = statsRows([["Compare object", name], ["Kind", kind], ["Present", "highlighted on both sides where available"]]);
}

function renderCompareSelection(side, node) {
  elements.details.className = "details-block";
  const instance = getNodeInstance(node);
  const choices = getTimingBadgeChoices(node, state.compare.timingBadgeChoices[side], instance);
  elements.details.innerHTML = `${statsRows([["Compare side", side]])}${renderObjectDetails(
    inspectGraphNode(state.compare.fullGraphs[side] || state.compare.graphs[side], node)
  )}${renderTimingPanel(node, choices)}${renderAdjustPanel(node, state.calibrationMode)}`;
  bindCompareSelectionControls(side, node);
}

function bindCompareSelectionControls(side, node) {
  const instance = getNodeInstance(node);
  bindTimingPanel(elements.details, {
    onPositionChange: (position) => {
      if (!instance || !isTimingBadgePosition(position)) return;
      state.compare.timingBadgePositions[side][instance] = position;
      renderCompareGraphs();
    },
    onBadgeToggle: (pin, metric, checked) => {
      if (!instance) return;
      const current = getTimingBadgeChoices(node, state.compare.timingBadgeChoices[side], instance);
      state.compare.timingBadgeChoices[side][instance] = updateTimingBadgeChoices(current, pin, metric, checked);
      renderCompareGraphs();
    },
    onReset: () => {
      if (instance) delete state.compare.timingBadgeChoices[side][instance];
      renderCompareGraphs();
    }
  });
  bindAdjustPanel(elements.details, node, state.calibrationMode, {
    onSizeChange: (size) => {
      state.compare.nodeSizes[side].set(node.id, {
        width: clamp(Number(size.width), 24, 420),
        height: clamp(Number(size.height), 12, 260)
      });
      renderCompareGraphs();
    },
    onResetSize: () => {
      state.compare.nodeSizes[side].delete(node.id);
      renderCompareGraphs();
    },
    onPropertyChange: (property, value) => {
      if (!isEditableNodeProperty(property)) return;
      const overrides = state.compare.graphOverrides[side].nodeProperties;
      overrides[node.id] ||= {};
      const trimmed = String(value ?? "").trim();
      if (trimmed) overrides[node.id][property] = trimmed;
      else delete overrides[node.id][property];
      if (Object.keys(overrides[node.id]).length === 0) delete overrides[node.id];
      renderCompareGraphs();
    },
    onResetProperties: () => {
      delete state.compare.graphOverrides[side].nodeProperties[node.id];
      renderCompareGraphs();
    },
    onPinDirectionChange: (pin, direction) => {
      if (!instance) return;
      state.compare.graphOverrides[side].cellPinDirections[instance] ||= {};
      state.compare.graphOverrides[side].cellPinDirections[instance][pin] = direction;
      renderCompareGraphs();
    },
    onResetPinDirections: () => {
      if (instance) delete state.compare.graphOverrides[side].cellPinDirections[instance];
      renderCompareGraphs();
    }
  });
}

function focusCompareSelection(kind, name) {
  if (kind === "net") return;
  for (const side of ["left", "right"]) {
    const graph = state.compare.graphs[side];
    const node = findCompareNode(graph, kind, name);
    const svg = (side === "left" ? elements.leftMount : elements.rightMount).querySelector("svg");
    if (!node || !svg) continue;
    const scale = getReadableObjectScale({
      viewBoxWidth: svg.viewBox.baseVal.width,
      viewportWidth: svg.getBoundingClientRect().width,
      objectWidth: node.width,
      currentScale: state.compare.transforms[side].scale
    });
    state.compare.transforms[side] = {
      x: svg.viewBox.baseVal.width / 2 - (node.x + node.width / 2) * scale,
      y: svg.viewBox.baseVal.height / 2 - (node.y + node.height / 2) * scale,
      scale
    };
  }
  applyCompareTransforms();
}

function renderSelection(node) {
  if (!node) {
    elements.details.className = "details-empty";
    elements.details.textContent = "未选择对象";
    return;
  }

  elements.details.className = "details-block";
  const instance = getNodeInstance(node);
  const timingChoices = getTimingBadgeChoices(node, state.timingBadgeChoices, instance);
  elements.details.innerHTML = `${renderObjectDetails(inspectGraphNode(state.fullGraph || state.graph, node))}${renderTimingPanel(node, timingChoices)}${renderAdjustPanel(node, state.calibrationMode)}`;
  bindSelectionControls(node);
}

function renderNetSelection(netName) {
  elements.details.className = "details-block";
  elements.details.innerHTML = renderObjectDetails(inspectGraphNet(state.fullGraph || state.graph, netName));
}

function renderDiagnostics() {
  const diagnostics = [
    ...(state.design?.diagnostics || []),
    ...(state.graph?.diagnostics || [])
  ];

  elements.diagnostics.innerHTML = "";
  if (diagnostics.length === 0) {
    const item = document.createElement("li");
    item.textContent = "No diagnostics";
    elements.diagnostics.append(item);
    return;
  }

  for (const diagnostic of diagnostics) {
    const item = document.createElement("li");
    item.textContent = diagnostic.message;
    elements.diagnostics.append(item);
  }
}

function bindSelectionControls(node) {
  const instance = getNodeInstance(node);
  bindTimingPanel(elements.details, {
    onPositionChange: (position) => updateTimingBadgePosition(node, position),
    onBadgeToggle: (pin, metric, checked) =>
      updateTimingBadgeChoice(node, pin, metric, checked),
    onReset: () => {
      if (instance) {
        delete state.timingBadgeChoices[instance];
      }
      rerenderPreservingView(node.id);
      setStatus(`${node.label}: timing badges reset to input AT plus output AT and slack`);
    }
  });

  bindAdjustPanel(elements.details, node, state.calibrationMode, {
    onSizeChange: (size) => updateNodeSize(node.id, size),
    onResetSize: () => {
      state.nodeSizes.delete(node.id);
      rerenderPreservingView(node.id);
      setStatus(`${node.label}: size reset`);
    },
    onPropertyChange: (property, value) => updateNodeProperty(node.id, property, value),
    onResetProperties: () => {
      delete state.graphOverrides.nodeProperties[node.id];
      rerenderPreservingView(node.id);
      setStatus(`${node.label}: properties reset`);
    },
    onPinDirectionChange: (pin, direction) => updateCellPinDirection(node, pin, direction),
    onResetPinDirections: () => {
      if (instance) {
        delete state.graphOverrides.cellPinDirections[instance];
      }
      rerenderPreservingView(node.id);
      setStatus(`${node.label}: pin directions reset`);
    }
  });
}

function updateTimingBadgePosition(node, position) {
  const instance = getNodeInstance(node);
  if (!instance || !isTimingBadgePosition(position)) {
    return;
  }
  state.timingBadgePositions[instance] = position;
  rerenderPreservingView(node.id);
  setStatus(`${node.label}: timing badges ${position}`);
}

function updateNodeSize(nodeId, size) {
  const node = state.graph?.nodes.find((item) => item.id === nodeId);
  if (!node) {
    return;
  }

  const nextSize = {
    width: clamp(Number(size.width), 24, 420),
    height: clamp(Number(size.height), 12, 260)
  };
  const previous = state.nodeSizes.get(nodeId);
  if (previous?.width === nextSize.width && previous?.height === nextSize.height) {
    return;
  }

  state.nodeSizes.set(nodeId, nextSize);
  rerenderPreservingView(nodeId);
  setStatus(`${node.label}: width=${nextSize.width}, height=${nextSize.height}`);
}

function updateNodeProperty(nodeId, property, value) {
  const node = state.graph?.nodes.find((item) => item.id === nodeId);
  if (!node || !isEditableNodeProperty(property)) {
    return;
  }
  const trimmed = String(value ?? "").trim();
  if (!state.graphOverrides.nodeProperties[nodeId]) {
    state.graphOverrides.nodeProperties[nodeId] = {};
  }
  if (trimmed === "") {
    delete state.graphOverrides.nodeProperties[nodeId][property];
  } else {
    state.graphOverrides.nodeProperties[nodeId][property] = trimmed;
  }
  if (Object.keys(state.graphOverrides.nodeProperties[nodeId]).length === 0) {
    delete state.graphOverrides.nodeProperties[nodeId];
  }
  rerenderPreservingView(nodeId);
  setStatus(`${node.label}: ${property} updated`);
}

function updateCellPinDirection(node, pinName, direction) {
  const instance = getNodeInstance(node);
  if (!instance || (direction !== "input" && direction !== "output")) {
    return;
  }
  if (!state.graphOverrides.cellPinDirections[instance]) {
    state.graphOverrides.cellPinDirections[instance] = {};
  }
  state.graphOverrides.cellPinDirections[instance][pinName] = direction;
  rerenderPreservingView(node.id);
  setStatus(`${node.label}.${pinName}: ${direction}`);
}

function updateTimingBadgeChoice(node, pin, metric, checked) {
  const instance = getNodeInstance(node);
  if (!instance) {
    return;
  }
  const choices = getTimingBadgeChoices(node, state.timingBadgeChoices, instance);
  state.timingBadgeChoices[instance] = updateTimingBadgeChoices(choices, pin, metric, checked);
  rerenderPreservingView(node.id);
  setStatus(`${node.label}: ${checked ? "show" : "hide"} ${pin} ${metric}`);
}

function rerenderPreservingView(selectedNodeId) {
  const previousTransform = { ...state.transform };
  renderCurrentModuleGraph();
  state.transform = previousTransform;
  state.selectedNodeId = null;
  setSelectedNode(selectedNodeId);
  applyTransform();
}

function handleWheel(event) {
  if (state.compare.active) {
    handleCompareWheel(event);
    return;
  }
  const svg = getSvg();
  if (!svg) {
    return;
  }
  event.preventDefault();

  const rect = svg.getBoundingClientRect();
  const point = eventPointToSvg(svg, event);
  state.transform = getZoomedTransform(
    state.transform,
    point,
    event.deltaY,
    svg.viewBox.baseVal.width,
    rect.width
  );
  applyTransform();
}

function handlePointerDown(event) {
  if (state.compare.active) {
    handleComparePointerDown(event);
    return;
  }
  const svg = getSvg();
  if (!svg || event.button !== 0) {
    return;
  }

  const nodeElement = event.target.closest("[data-node-id]");
  if (state.calibrationMode && nodeElement) {
    startNodeDrag(event, nodeElement.dataset.nodeId);
    return;
  }
  if (nodeElement) {
    const groupNode = state.graph?.nodes.find((node) => node.id === nodeElement.dataset.nodeId && node.kind === "group");
    if (groupNode) {
      state.expandedGroupIds.add(groupNode.ref.groupId);
      renderCurrentModuleGraph();
      return;
    }
    setSelectedNode(nodeElement.dataset.nodeId);
    return;
  }

  const edgeElement = event.target.closest("[data-edge-id]");
  if (edgeElement) {
    setSelectedNet(edgeElement.dataset.net);
    return;
  }

  setSelectedNode(null);

  elements.canvas.setPointerCapture(event.pointerId);
  elements.canvas.classList.add("is-panning");
  const start = {
    x: event.clientX,
    y: event.clientY,
    transform: { ...state.transform }
  };

  const move = (moveEvent) => {
    const viewBox = svg.viewBox.baseVal;
    const rect = svg.getBoundingClientRect();
    state.transform = getPannedTransform(
      start.transform,
      start,
      { x: moveEvent.clientX, y: moveEvent.clientY },
      viewBox,
      rect
    );
    applyTransform();
  };

  const up = () => {
    elements.canvas.classList.remove("is-panning");
    elements.canvas.removeEventListener("pointermove", move);
    elements.canvas.removeEventListener("pointerup", up);
    elements.canvas.removeEventListener("pointercancel", up);
  };

  elements.canvas.addEventListener("pointermove", move);
  elements.canvas.addEventListener("pointerup", up);
  elements.canvas.addEventListener("pointercancel", up);
}

function startNodeDrag(event, nodeId) {
  const node = state.graph?.nodes.find((item) => item.id === nodeId);
  if (!node) {
    return;
  }

  event.preventDefault();
  elements.canvas.setPointerCapture(event.pointerId);
  elements.canvas.classList.add("is-node-dragging");
  setSelectedNode(nodeId);

  const startPoint = eventPointToContent(event);
  const startPosition = { x: node.x, y: node.y };
  let moved = false;

  const move = (moveEvent) => {
    const point = eventPointToContent(moveEvent);
    if (!point || !startPoint) {
      return;
    }

    const candidatePosition = getDraggedNodePosition(startPosition, startPoint, point);
    const snapResult = snapNodePosition(state.graph, nodeId, candidatePosition);
    const nextPosition = {
      x: round(Math.max(16, snapResult.position.x)),
      y: round(Math.max(16, snapResult.position.y))
    };
    const previous = state.nodePositions.get(nodeId);
    if (sameNodePosition(previous, nextPosition)) return;

    moved = true;
    state.nodePositions.set(nodeId, nextPosition);
    if (state.layoutProviderId === "elk-layered" && state.autoGraph?.layoutProvider === "elk-layered") {
      state.graph = applyPositionedOverrides(state.autoGraph, {
        nodePositions: state.nodePositions,
        nodeSizes: state.nodeSizes,
        layoutPolicy: state.layoutPolicy
      });
      elements.mount.innerHTML = renderSchematicSvg(state.graph);
      setSelectedNode(nodeId);
      applyTransform();
      updateCalibrationControls();
    } else {
      renderCurrentModuleGraph();
      setSelectedNode(nodeId);
      applyTransform();
    }
    if (snapResult.snap) {
      setStatus(`${node.label}: snapped ${snapResult.snap.net} to y=${snapResult.snap.targetY}`);
    } else {
      setStatus(`${node.label}: x=${nextPosition.x}, y=${nextPosition.y}`);
    }
  };

  const up = () => {
    elements.canvas.classList.remove("is-node-dragging");
    elements.canvas.removeEventListener("pointermove", move);
    elements.canvas.removeEventListener("pointerup", up);
    elements.canvas.removeEventListener("pointercancel", up);
    if (moved) {
      setStatus(`Layout overrides: ${state.nodePositions.size} moved node(s)`);
    }
  };

  elements.canvas.addEventListener("pointermove", move);
  elements.canvas.addEventListener("pointerup", up);
  elements.canvas.addEventListener("pointercancel", up);
}

function fitToView() {
  if (state.compare.active) {
    state.compare.transforms.left = { x: 0, y: 0, scale: 1 };
    state.compare.transforms.right = { x: 0, y: 0, scale: 1 };
    applyCompareTransforms();
    setStatus("Fit both compare views");
    return;
  }
  state.transform = { x: 0, y: 0, scale: 1 };
  applyTransform();
}

function exportCurrentSvg() {
  if (!state.graph || !state.currentModule) {
    return;
  }
  const viewSuffix = state.viewMode === "whole"
    ? "whole"
    : `${state.viewMode}-depth-${state.coneDepth}`;
  const fileName = `${sanitizeFileName(state.currentModule.name)}-${viewSuffix}.svg`;
  downloadText(createStandaloneSvg(renderSchematicSvg(state.graph)), fileName, "image/svg+xml");
  setStatus(`Exported SVG: ${fileName}`);
}

function toggleCalibrationMode() {
  state.calibrationMode = !state.calibrationMode;
  updateCalibrationControls();
  setStatus(state.calibrationMode ? "Layout calibration mode enabled" : "Layout calibration mode disabled");
}

function resetLayoutOverrides() {
  if (state.compare.active) {
    state.compare.nodePositions = { left: new Map(), right: new Map() };
    state.compare.nodeSizes = { left: new Map(), right: new Map() };
    state.compare.graphOverrides = { left: createEmptyGraphOverrides(), right: createEmptyGraphOverrides() };
    renderCompareGraphs();
    updateCalibrationControls();
    setStatus("Compare Adjust overrides cleared");
    return;
  }
  if (state.nodePositions.size === 0 && state.nodeSizes.size === 0 && countGraphOverrides() === 0) {
    return;
  }

  const selectedNode = state.selectedNodeId;
  state.nodePositions = new Map();
  state.nodeSizes = new Map();
  state.graphOverrides = createEmptyGraphOverrides();
  renderCurrentModuleGraph();
  setSelectedNode(selectedNode);
  applyTransform();
  setStatus("Adjust overrides cleared");
}

function saveLayoutGolden() {
  if (!state.graph || !state.currentModule) {
    return;
  }

  const diff = compareLayoutGraphs(state.autoGraph, state.graph);
  const golden = createLayoutGolden(state.graph, {
    layoutOptions: {
      layoutPolicy: state.layoutPolicy,
      graphOverrides: state.graphOverrides,
      timingBadgeChoices: state.timingBadgeChoices,
      timingBadgePositions: state.timingBadgePositions
    },
    svgSnapshot: renderSchematicSvg(state.graph)
  });
  downloadJson(
    {
      ...golden,
      diff
    },
    `layout-golden-${sanitizeFileName(state.currentModule.name)}.json`
  );
  setStatus(`Saved layout golden: ${diff.movedNodeCount} moved node(s), max move ${diff.maxMove}px`);
}

function updateCalibrationControls() {
  elements.canvas.classList.toggle("is-calibrating", state.calibrationMode);
  elements.adjustLayoutButton.classList.toggle("is-active", state.calibrationMode);
  elements.adjustLayoutButton.setAttribute("aria-pressed", String(state.calibrationMode));
  elements.saveGoldenButton.disabled = state.compare.active || !state.graph;
  elements.resetLayoutButton.disabled = state.compare.active
    ? !hasCompareLayoutOverrides()
    : state.nodePositions.size === 0 && state.nodeSizes.size === 0 && countGraphOverrides() === 0;
  if (state.compare.active && state.compare.selectedSide && state.compare.selectedName) {
    const node = findCompareNode(
      state.compare.graphs[state.compare.selectedSide],
      state.compare.selectedKind,
      state.compare.selectedName
    );
    if (node) renderCompareSelection(state.compare.selectedSide, node);
  } else {
    renderSelection(state.graph?.nodes.find((item) => item.id === state.selectedNodeId) || null);
  }
}

function applyTransform() {
  const content = elements.mount.querySelector("#schematicContent");
  if (!content) {
    return;
  }
  const { x, y, scale } = state.transform;
  content.setAttribute("transform", formatViewportTransform({ x, y, scale }));
  elements.canvas.classList.toggle("is-low-detail", scale < 0.65);
  persistSession();
}

function handleCompareWheel(event) {
  const sideElement = event.target.closest("[data-compare-side]");
  const side = sideElement?.dataset.compareSide;
  const svg = sideElement?.querySelector("svg");
  if (!side || !svg) return;
  event.preventDefault();
  const current = state.compare.transforms[side];
  const rect = svg.getBoundingClientRect();
  const point = eventPointToSvg(svg, event);
  const next = getZoomedTransform(
    current,
    point,
    event.deltaY,
    svg.viewBox.baseVal.width,
    rect.width
  );
  setCompareTransform(side, next);
}

function handleComparePointerDown(event) {
  const sideElement = event.target.closest("[data-compare-side]");
  const side = sideElement?.dataset.compareSide;
  const svg = sideElement?.querySelector("svg");
  if (!side || !svg || event.button !== 0) return;
  const nodeElement = event.target.closest("[data-node-id]");
  if (nodeElement) {
    const id = nodeElement.dataset.nodeId;
    const graphNode = state.compare.graphs[side]?.nodes.find((node) => node.id === id);
    if (graphNode?.kind === "group") {
      state.expandedGroupIds.add(graphNode.ref.groupId);
      renderCompareGraphs();
      return;
    }
    if (state.calibrationMode && graphNode) {
      startCompareNodeDrag(event, side, graphNode);
      return;
    }
    selectCompareObject(graphNode?.kind === "cell" ? "cell" : "port", getCompareNodeName(graphNode), true, side);
    return;
  }
  const edgeElement = event.target.closest("[data-edge-id]");
  if (edgeElement) {
    selectCompareObject("net", edgeElement.dataset.net, true, side);
    return;
  }
  elements.canvas.setPointerCapture(event.pointerId);
  elements.canvas.classList.add("is-panning");
  const start = { x: event.clientX, y: event.clientY, transform: { ...state.compare.transforms[side] } };
  const move = (moveEvent) => {
    const rect = svg.getBoundingClientRect();
    const viewBox = svg.viewBox.baseVal;
    setCompareTransform(side, getPannedTransform(
      start.transform,
      start,
      { x: moveEvent.clientX, y: moveEvent.clientY },
      viewBox,
      rect
    ));
  };
  const up = () => {
    elements.canvas.classList.remove("is-panning");
    elements.canvas.removeEventListener("pointermove", move);
    elements.canvas.removeEventListener("pointerup", up);
    elements.canvas.removeEventListener("pointercancel", up);
  };
  elements.canvas.addEventListener("pointermove", move);
  elements.canvas.addEventListener("pointerup", up);
  elements.canvas.addEventListener("pointercancel", up);
}

function startCompareNodeDrag(event, side, node) {
  const mount = side === "left" ? elements.leftMount : elements.rightMount;
  const content = mount.querySelector("#schematicContent");
  const matrix = content?.getScreenCTM();
  if (!matrix) return;
  event.preventDefault();
  elements.canvas.setPointerCapture(event.pointerId);
  elements.canvas.classList.add("is-node-dragging");
  selectCompareObject(node.kind === "cell" ? "cell" : "port", getCompareNodeName(node), false, side);
  const toContent = (pointerEvent) => {
    const svg = mount.querySelector("svg");
    const currentMatrix = mount.querySelector("#schematicContent")?.getScreenCTM();
    if (!svg || !currentMatrix) return null;
    const point = svg.createSVGPoint();
    point.x = pointerEvent.clientX;
    point.y = pointerEvent.clientY;
    return point.matrixTransform(currentMatrix.inverse());
  };
  const startPoint = toContent(event);
  const startPosition = { x: node.x, y: node.y };
  const move = (moveEvent) => {
    const point = toContent(moveEvent);
    if (!point || !startPoint) return;
    const candidate = getDraggedNodePosition(startPosition, startPoint, point);
    const snapped = snapNodePosition(state.compare.graphs[side], node.id, candidate);
    const previous = state.compare.nodePositions[side].get(node.id);
    if (sameNodePosition(previous, snapped.position)) return;
    state.compare.nodePositions[side].set(node.id, snapped.position);
    renderAdjustedCompareSide(side);
  };
  const up = () => {
    elements.canvas.classList.remove("is-node-dragging");
    elements.canvas.removeEventListener("pointermove", move);
    elements.canvas.removeEventListener("pointerup", up);
    elements.canvas.removeEventListener("pointercancel", up);
    setStatus(`${side} ${node.label}: position adjusted`);
  };
  elements.canvas.addEventListener("pointermove", move);
  elements.canvas.addEventListener("pointerup", up);
  elements.canvas.addEventListener("pointercancel", up);
}

function renderAdjustedCompareSide(side) {
  const autoGraph = state.compare.autoGraphs[side];
  if (!autoGraph) {
    renderCompareGraphs();
    return;
  }
  const graph = applyPositionedOverrides(autoGraph, {
    nodePositions: state.compare.nodePositions[side],
    nodeSizes: state.compare.nodeSizes[side],
    layoutPolicy: state.layoutPolicy
  });
  state.compare.graphs[side] = graph;
  const mount = side === "left" ? elements.leftMount : elements.rightMount;
  mount.innerHTML = renderSchematicSvg(graph);
  applyCompareHighlights();
  applyCompareTransforms();
  updateCalibrationControls();
}

function setCompareTransform(side, transform) {
  state.compare.transforms[side] = transform;
  if (state.compare.synchronized) state.compare.transforms[side === "left" ? "right" : "left"] = { ...transform };
  applyCompareTransforms();
}

function applyCompareTransforms() {
  for (const side of ["left", "right"]) {
    const mount = side === "left" ? elements.leftMount : elements.rightMount;
    const content = mount.querySelector("#schematicContent");
    if (!content) continue;
    const { x, y, scale } = state.compare.transforms[side];
    content.setAttribute("transform", formatViewportTransform({ x, y, scale }));
    mount.closest(".compare-side")?.classList.toggle("is-low-detail", scale < 0.65);
  }
}

function eventPointToSvg(svg, event) {
  const rect = svg.getBoundingClientRect();
  return clientPointToViewBox(
    { x: event.clientX, y: event.clientY },
    rect,
    svg.viewBox.baseVal
  );
}

function eventPointToContent(event) {
  const svg = getSvg();
  const content = elements.mount.querySelector("#schematicContent");
  const matrix = content?.getScreenCTM();
  if (!svg || !matrix) {
    return null;
  }

  const point = svg.createSVGPoint();
  point.x = event.clientX;
  point.y = event.clientY;
  return point.matrixTransform(matrix.inverse());
}

function getSvg() {
  return elements.mount.querySelector("svg");
}

function getCurrentLayoutProvider() {
  return getLayoutProvider(state.layoutProviderId);
}

function setStatus(message) {
  elements.status.textContent = message;
}

function applySessionPreferences(session) {
  if (!session) return;
  state.coneDepth = clamp(Number(session.coneDepth) || 3, 1, 99);
  state.showAliases = Boolean(session.showAliases);
  state.layoutProviderId = session.layoutProviderId || state.layoutProviderId;
  state.useFanoutHubs = session.useFanoutHubs !== false;
  state.collapseLargeGroups = session.collapseLargeGroups !== false;
  elements.coneDepthInput.value = String(state.coneDepth);
}

function persistSession() {
  if (!state.currentSource) return;
  clearTimeout(sessionSaveTimer);
  sessionSaveTimer = setTimeout(() => saveSessionState(createSessionSnapshot(state)), 150);
}

function isEditableNodeProperty(property) {
  return ["label", "title", "subtitle", "gateKind", "inferenceSource"].includes(property);
}

function getNodeInstance(node) {
  return node.ref?.instance || (node.id.startsWith("cell:") ? node.id.slice("cell:".length) : null);
}

function countGraphOverrides() {
  return (
    Object.keys(state.graphOverrides.nodeProperties).length +
    Object.keys(state.graphOverrides.cellPinDirections).length
  );
}

function hasCompareLayoutOverrides() {
  return ["left", "right"].some((side) =>
    state.compare.nodePositions[side].size > 0 ||
    state.compare.nodeSizes[side].size > 0 ||
    Object.keys(state.compare.graphOverrides[side].nodeProperties).length > 0 ||
    Object.keys(state.compare.graphOverrides[side].cellPinDirections).length > 0
  );
}

function cssEscape(value) {
  if (globalThis.CSS?.escape) {
    return globalThis.CSS.escape(value);
  }
  return String(value).replaceAll('"', '\\"');
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function round(value) {
  return Math.round(value * 1000) / 1000;
}

function downloadJson(value, fileName) {
  downloadText(`${JSON.stringify(value, null, 2)}\n`, fileName, "application/json");
}

function downloadText(value, fileName, type) {
  const blob = new Blob([value], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
}

function sanitizeFileName(value) {
  return String(value).replace(/[^A-Za-z0-9_.-]+/g, "_");
}
