import { parseVerilog } from "../parser/verilogParser.js";
import { buildSchematicGraph } from "../netlist/graph.js";
import { layoutGraph } from "../layout/simpleLayered.js";
import { renderSchematicSvg } from "../render/svgRenderer.js";
import { sampleNetlist } from "./sampleNetlist.js";

const state = {
  design: null,
  currentModule: null,
  graph: null,
  transform: { x: 0, y: 0, scale: 1 },
  selectedNodeId: null,
  layoutOptions: {
    wireLanePitch: 18
  }
};

const elements = {
  fileInput: document.querySelector("#fileInput"),
  moduleSelect: document.querySelector("#moduleSelect"),
  wireSpacingInput: document.querySelector("#wireSpacingInput"),
  wireSpacingValue: document.querySelector("#wireSpacingValue"),
  fitButton: document.querySelector("#fitButton"),
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
elements.canvas.addEventListener("wheel", handleWheel, { passive: false });
elements.canvas.addEventListener("pointerdown", handlePointerDown);

loadDesign(sampleNetlist, "built-in sample");

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
    renderModuleOptions();
    const firstModule = state.design.modules[0];
    if (firstModule) {
      selectModule(firstModule.name);
      setStatus(`Loaded ${label}: ${state.design.modules.length} module(s)`);
    } else {
      elements.mount.innerHTML = "";
      setStatus(`Loaded ${label}: no modules found`);
    }
  } catch (error) {
    elements.mount.innerHTML = "";
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
  renderCurrentModuleGraph();
  state.transform = { x: 0, y: 0, scale: 1 };
  state.selectedNodeId = null;
  renderStats();
  renderDiagnostics();
  renderSelection(null);
  applyTransform();
}

function renderCurrentModuleGraph() {
  state.graph = layoutGraph(buildSchematicGraph(state.currentModule), {
    wireLanePitch: state.layoutOptions.wireLanePitch
  });
  elements.mount.innerHTML = renderSchematicSvg(state.graph);
  bindSchematicEvents();
}

function handleWireSpacingChange(event) {
  const value = Number(event.target.value);
  state.layoutOptions.wireLanePitch = clamp(value, 8, 40);
  elements.wireSpacingValue.value = String(state.layoutOptions.wireLanePitch);
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
  setStatus(`Wire spacing: ${state.layoutOptions.wireLanePitch}px`);
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
  elements.details.innerHTML = statsRows(lines);
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

function fitToView() {
  state.transform = { x: 0, y: 0, scale: 1 };
  applyTransform();
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
