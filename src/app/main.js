import { parseVerilog } from "../parser/verilogParser.js";
import { buildSchematicGraph } from "../netlist/graph.js";
import { inspectGraphNet, inspectGraphNode } from "../analysis/graphInspector.js";
import { createConeGraph } from "../analysis/graphCone.js";
import { normalizeGraphAliases } from "../analysis/aliasNormalizer.js";
import { compareLayoutGraphs, createLayoutGolden } from "../layout/layoutGolden.js";
import { DEFAULT_LAYOUT_POLICY } from "../layout/layoutPolicy.js";
import { layoutGraph } from "../layout/simpleLayered.js";
import { snapNodePosition } from "../layout/snap.js";
import { renderSchematicSvg } from "../render/svgRenderer.js";
import { createStandaloneSvg } from "../render/svgExport.js";
import {
  buildDesignSearchIndex,
  searchDesignIndex
} from "../search/designSearch.js";
import { annotateGraphTiming } from "../timing/timingAnnotation.js";
import { parseTimingLog } from "../timing/timingParser.js";
import { bindAdjustPanel, renderAdjustPanel } from "../ui/adjustPanel.js";
import {
  escapeAttr,
  escapeHtml,
  renderDefinitionRows as statsRows
} from "../ui/html.js";
import { renderObjectDetails } from "../ui/objectDetailsPanel.js";
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
  resetDesignWorkspace,
  resetModuleWorkspace,
  resetTimingPresentation
} from "./appState.js";
import { sampleNetlist } from "./sampleNetlist.js";

const state = createAppState(DEFAULT_LAYOUT_POLICY);

const elements = {
  fileInput: document.querySelector("#fileInput"),
  timingInput: document.querySelector("#timingInput"),
  moduleSelect: document.querySelector("#moduleSelect"),
  searchInput: document.querySelector("#searchInput"),
  searchClearButton: document.querySelector("#searchClearButton"),
  searchResults: document.querySelector("#searchResults"),
  wholeViewButton: document.querySelector("#wholeViewButton"),
  faninViewButton: document.querySelector("#faninViewButton"),
  fanoutViewButton: document.querySelector("#fanoutViewButton"),
  coneDepthInput: document.querySelector("#coneDepthInput"),
  showAliasesInput: document.querySelector("#showAliasesInput"),
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

loadDesign(sampleNetlist, "built-in sample");
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
  if (state.currentModule) {
    rerenderPreservingView(state.selectedNodeId);
    renderStats();
  }
  setStatus(`Loaded timing ${file.name}: ${state.timing.instanceCount} instance(s)`);
}

function loadDesign(source, label) {
  try {
    state.design = parseVerilog(source);
    resetDesignWorkspace(state);
    state.searchIndex = buildDesignSearchIndex(state.design);
    clearSearch();
    renderModuleOptions();
    const firstModule = state.design.modules[0];
    if (firstModule) {
      selectModule(firstModule.name);
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
}

function selectModule(moduleName) {
  const module = state.design.modules.find((item) => item.name === moduleName);
  if (!module) {
    return;
  }
  state.currentModule = module;
  elements.moduleSelect.value = module.name;
  resetModuleWorkspace(state);
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
  const annotatedGraph = annotateGraphTiming(
    buildSchematicGraph(state.currentModule, { overrides: state.graphOverrides }),
    state.timing,
    {
      badgeChoices: state.timingBadgeChoices,
      badgePositions: state.timingBadgePositions
    }
  );
  state.fullGraph = normalizeGraphAliases(annotatedGraph, { showAliases: state.showAliases });
  const sourceGraph = state.viewMode === "whole"
    ? state.fullGraph
    : createConeGraph(state.fullGraph, state.coneRootNodeId, {
        direction: state.viewMode,
        maxDepth: state.coneDepth
      });
  const layoutOptions = { layoutPolicy: state.layoutPolicy };
  state.autoGraph = layoutGraph(sourceGraph, layoutOptions);
  state.graph = layoutGraph(sourceGraph, {
    ...layoutOptions,
    nodePositions: state.nodePositions,
    nodeSizes: state.nodeSizes
  });
  elements.mount.innerHTML = renderSchematicSvg(state.graph);
  updateCalibrationControls();
  updateViewControls();
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
  if (state.viewMode !== "whole") {
    setViewMode(state.viewMode);
  }
}

function handleAliasVisibilityChange(event) {
  const selectedNode = state.graph?.nodes.find((node) => node.id === state.selectedNodeId);
  state.showAliases = event.target.checked;
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
}

function handleWireSpacingChange(event) {
  const value = Number(event.target.value);
  state.layoutPolicy.spacing.wireLanePitch = clamp(value, 8, 40);
  elements.wireSpacingValue.value = String(state.layoutPolicy.spacing.wireLanePitch);
  if (!state.currentModule) {
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
    });
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

function centerGraphPoint(point) {
  const svg = getSvg();
  if (!svg || !point) {
    return;
  }
  const scale = Math.max(state.transform.scale, 1.8);
  const viewBox = svg.viewBox.baseVal;
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
  const svg = getSvg();
  if (!svg) {
    return;
  }
  event.preventDefault();

  const oldScale = state.transform.scale;
  const nextScale = clamp(oldScale * (event.deltaY < 0 ? 1.12 : 0.88), 0.25, 4);
  const point = eventPointToSvg(svg, event);

  state.transform.x = point.x - (point.x - state.transform.x) * (nextScale / oldScale);
  state.transform.y = point.y - (point.y - state.transform.y) * (nextScale / oldScale);
  state.transform.scale = nextScale;
  applyTransform();
}

function handlePointerDown(event) {
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
    const dx = ((moveEvent.clientX - start.x) * viewBox.width) / rect.width;
    const dy = ((moveEvent.clientY - start.y) * viewBox.height) / rect.height;
    state.transform.x = start.transform.x + dx;
    state.transform.y = start.transform.y + dy;
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

    const candidatePosition = {
      x: round(Math.max(16, startPosition.x + point.x - startPoint.x)),
      y: round(Math.max(16, startPosition.y + point.y - startPoint.y))
    };
    const snapResult = snapNodePosition(state.graph, nodeId, candidatePosition);
    const nextPosition = {
      x: round(Math.max(16, snapResult.position.x)),
      y: round(Math.max(16, snapResult.position.y))
    };
    const previous = state.nodePositions.get(nodeId);
    if (previous?.x === nextPosition.x && previous?.y === nextPosition.y) {
      return;
    }

    moved = true;
    state.nodePositions.set(nodeId, nextPosition);
    renderCurrentModuleGraph();
    setSelectedNode(nodeId);
    applyTransform();
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
  elements.saveGoldenButton.disabled = !state.graph;
  elements.resetLayoutButton.disabled =
    state.nodePositions.size === 0 && state.nodeSizes.size === 0 && countGraphOverrides() === 0;
  renderSelection(state.graph?.nodes.find((item) => item.id === state.selectedNodeId) || null);
}

function applyTransform() {
  const content = elements.mount.querySelector("#schematicContent");
  if (!content) {
    return;
  }
  const { x, y, scale } = state.transform;
  content.setAttribute("transform", `translate(${round(x)} ${round(y)}) scale(${round(scale)})`);
}

function eventPointToSvg(svg, event) {
  const rect = svg.getBoundingClientRect();
  const viewBox = svg.viewBox.baseVal;
  return {
    x: viewBox.x + ((event.clientX - rect.left) / rect.width) * viewBox.width,
    y: viewBox.y + ((event.clientY - rect.top) / rect.height) * viewBox.height
  };
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

function setStatus(message) {
  elements.status.textContent = message;
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
