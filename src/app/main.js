import { parseVerilog } from "../parser/verilogParser.js";
import { buildSchematicGraph } from "../netlist/graph.js";
import { compareLayoutGraphs, createLayoutGolden } from "../layout/layoutGolden.js";
import { DEFAULT_LAYOUT_POLICY } from "../layout/layoutPolicy.js";
import { layoutGraph } from "../layout/simpleLayered.js";
import { snapNodePosition } from "../layout/snap.js";
import { renderSchematicSvg } from "../render/svgRenderer.js";
import { annotateGraphTiming } from "../timing/timingAnnotation.js";
import { parseTimingLog } from "../timing/timingParser.js";
import { bindAdjustPanel, renderAdjustPanel } from "../ui/adjustPanel.js";
import { renderDefinitionRows as statsRows } from "../ui/html.js";
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
  wireSpacingInput: document.querySelector("#wireSpacingInput"),
  wireSpacingValue: document.querySelector("#wireSpacingValue"),
  fitButton: document.querySelector("#fitButton"),
  adjustLayoutButton: document.querySelector("#adjustLayoutButton"),
  saveGoldenButton: document.querySelector("#saveGoldenButton"),
  resetLayoutButton: document.querySelector("#resetLayoutButton"),
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
elements.wireSpacingInput.addEventListener("input", handleWireSpacingChange);
elements.fitButton.addEventListener("click", fitToView);
elements.adjustLayoutButton.addEventListener("click", toggleCalibrationMode);
elements.saveGoldenButton.addEventListener("click", saveLayoutGolden);
elements.resetLayoutButton.addEventListener("click", resetLayoutOverrides);
elements.canvas.addEventListener("wheel", handleWheel, { passive: false });
elements.canvas.addEventListener("pointerdown", handlePointerDown);

loadDesign(sampleNetlist, "built-in sample");
updateCalibrationControls();

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
  renderStats();
  renderDiagnostics();
  renderSelection(null);
  applyTransform();
}

function renderCurrentModuleGraph() {
  const sourceGraph = annotateGraphTiming(
    buildSchematicGraph(state.currentModule, { overrides: state.graphOverrides }),
    state.timing,
    {
      badgeChoices: state.timingBadgeChoices,
      badgePositions: state.timingBadgePositions
    }
  );
  const layoutOptions = { layoutPolicy: state.layoutPolicy };
  state.autoGraph = layoutGraph(sourceGraph, layoutOptions);
  state.graph = layoutGraph(sourceGraph, {
    ...layoutOptions,
    nodePositions: state.nodePositions,
    nodeSizes: state.nodeSizes
  });
  elements.mount.innerHTML = renderSchematicSvg(state.graph);
  bindSchematicEvents();
  updateCalibrationControls();
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

function bindSchematicEvents() {
  const svg = getSvg();
  svg?.addEventListener("click", (event) => {
    const node = event.target.closest("[data-node-id]");
    if (!node) {
      setSelectedNode(null);
      return;
    }
    setSelectedNode(node.dataset.nodeId);
  });
}

function setSelectedNode(nodeId) {
  state.selectedNodeId = nodeId;
  for (const nodeElement of elements.mount.querySelectorAll(".node.is-selected")) {
    nodeElement.classList.remove("is-selected");
  }
  if (nodeId) {
    const nodeElement = elements.mount.querySelector(`[data-node-id="${cssEscape(nodeId)}"]`);
    nodeElement?.classList.add("is-selected");
  }
  const node = state.graph?.nodes.find((item) => item.id === nodeId) || null;
  renderSelection(node);
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
  const lines = [
    ["Kind", node.kind],
    ["Label", node.label],
    ["Gate", node.gateKind || node.title || "-"],
    ["Cell type", node.subtitle || "-"],
    ["Inference", node.inferenceSource || "-"]
  ];
  const instance = getNodeInstance(node);
  const timingChoices = getTimingBadgeChoices(node, state.timingBadgeChoices, instance);
  elements.details.innerHTML = `${statsRows(lines)}${renderTimingPanel(node, timingChoices)}${renderAdjustPanel(node, state.calibrationMode)}`;
  bindSelectionControls(node);
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
  const blob = new Blob([`${JSON.stringify(value, null, 2)}\n`], {
    type: "application/json"
  });
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
