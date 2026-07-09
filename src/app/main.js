import { parseVerilog } from "../parser/verilogParser.js";
import { buildSchematicGraph } from "../netlist/graph.js";
import { compareLayoutGraphs, createLayoutGolden } from "../layout/layoutGolden.js";
import { DEFAULT_LAYOUT_POLICY } from "../layout/layoutPolicy.js";
import { layoutGraph } from "../layout/simpleLayered.js";
import { snapNodePosition } from "../layout/snap.js";
import { renderSchematicSvg } from "../render/svgRenderer.js";
import { sampleNetlist } from "./sampleNetlist.js";

const state = {
  design: null,
  currentModule: null,
  autoGraph: null,
  graph: null,
  transform: { x: 0, y: 0, scale: 1 },
  selectedNodeId: null,
  nodePositions: new Map(),
  nodeSizes: new Map(),
  calibrationMode: false,
  layoutPolicy: cloneLayoutPolicy(DEFAULT_LAYOUT_POLICY)
};

const elements = {
  fileInput: document.querySelector("#fileInput"),
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

function loadDesign(source, label) {
  try {
    state.design = parseVerilog(source);
    state.selectedNodeId = null;
    state.nodePositions = new Map();
    state.nodeSizes = new Map();
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
  state.nodePositions = new Map();
  state.nodeSizes = new Map();
  renderCurrentModuleGraph();
  state.transform = { x: 0, y: 0, scale: 1 };
  state.selectedNodeId = null;
  renderStats();
  renderDiagnostics();
  renderSelection(null);
  applyTransform();
}

function renderCurrentModuleGraph() {
  const sourceGraph = buildSchematicGraph(state.currentModule);
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
  elements.details.innerHTML = `${statsRows(lines)}${renderNodeSizeControls(node)}`;
  bindNodeSizeControls(node);
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

function statsRows(rows) {
  return rows
    .map(([label, value]) => `<dt>${escapeHtml(label)}</dt><dd><code>${escapeHtml(value)}</code></dd>`)
    .join("");
}

function renderNodeSizeControls(node) {
  if (!state.calibrationMode) {
    return "";
  }

  const width = Math.round(node.width);
  const height = Math.round(node.height);
  return `<div class="size-controls" aria-label="Node size controls">
    <label>
      <span>Width</span>
      <input id="nodeWidthInput" type="number" min="24" max="420" step="1" value="${width}">
    </label>
    <label>
      <span>Height</span>
      <input id="nodeHeightInput" type="number" min="12" max="260" step="1" value="${height}">
    </label>
    <button id="resetNodeSizeButton" class="mini-button" type="button">Reset size</button>
  </div>`;
}

function bindNodeSizeControls(node) {
  if (!state.calibrationMode) {
    return;
  }

  const widthInput = elements.details.querySelector("#nodeWidthInput");
  const heightInput = elements.details.querySelector("#nodeHeightInput");
  const resetButton = elements.details.querySelector("#resetNodeSizeButton");
  widthInput?.addEventListener("input", () => {
    updateNodeSize(node.id, {
      width: widthInput.value,
      height: heightInput?.value ?? node.height
    });
  });
  heightInput?.addEventListener("input", () => {
    updateNodeSize(node.id, {
      width: widthInput?.value ?? node.width,
      height: heightInput.value
    });
  });
  resetButton?.addEventListener("click", () => {
    state.nodeSizes.delete(node.id);
    rerenderPreservingView(node.id);
    setStatus(`${node.label}: size reset`);
  });
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
  if (state.nodePositions.size === 0 && state.nodeSizes.size === 0) {
    return;
  }

  const selectedNode = state.selectedNodeId;
  state.nodePositions = new Map();
  state.nodeSizes = new Map();
  renderCurrentModuleGraph();
  setSelectedNode(selectedNode);
  applyTransform();
  setStatus("Layout overrides cleared");
}

function saveLayoutGolden() {
  if (!state.graph || !state.currentModule) {
    return;
  }

  const diff = compareLayoutGraphs(state.autoGraph, state.graph);
  const golden = createLayoutGolden(state.graph, {
    layoutOptions: {
      layoutPolicy: state.layoutPolicy
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
  elements.resetLayoutButton.disabled = state.nodePositions.size === 0 && state.nodeSizes.size === 0;
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

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
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

function cloneLayoutPolicy(policy) {
  return {
    name: policy.name,
    spacing: { ...policy.spacing },
    features: { ...policy.features }
  };
}
