import { bindAigConnectionHighlight, syncAigLevelControls } from "./aig_controls.js";
import { createAigPanelInteractions } from "./aig_panel_interactions.js";
import { updateAigSelectionHighlights } from "./aig_selection_highlights.js";

export function createAigWorkbenchShell({ document, get, mount, readWorkspace, readPanels, present,
  readStructure, policy, selectedId, isSwitchingStyle, changePresentation, changeStyle, syncFocus,
  panelEvent, select, persist, clearSearch }) {
  const navigatorHost = document.createElement("div");
  const inspectorHost = document.createElement("div");
  const toolbar = document.createElement("div");
  const overlays = get("aigOverlaySettings");
  navigatorHost.id = "domainNavigator";
  inspectorHost.id = "domainInspector";
  toolbar.id = "domainToolbar";
  toolbar.className = "domain-toolbar";
  const pathPanel = get("pathPanel");
  if (pathPanel) pathPanel.before(navigatorHost);
  else get("navigatorPanel").append(navigatorHost);
  get("inspectorPanel").append(inspectorHost);
  get("canvas").before(toolbar);
  for (const host of [navigatorHost, inspectorHost, toolbar]) host.hidden = true;
  let savedVisibility = new Map();
  let objectElements = new Map();
  let oldSelectedId = null;
  let neighborHighlights = new Map();
  let highlightedSelectionId = null;
  let highlightedDepth = null;
  let connectionControl = null;
  const panelInteractions = createAigPanelInteractions({ document, navigatorHost, inspectorHost, onAction: panelEvent,
    onFilter(field, value) {
      if (!readWorkspace()) return;
      const panels = readPanels();
      if (field === "structureType") { panels.analysis.type = value; panels.analysis.page = 0; }
      else { panels.navigator[field] = value; panels.navigator.page = 0; }
      renderPanels(); persist();
    } });
  function renderPanels() {
    const workspace = readWorkspace();
    if (!workspace) return;
    const panels = readPanels();
    const options = { selectedId: selectedId(), fanoutThreshold: policy().fanoutThreshold, structure: readStructure() };
    panelInteractions.render({ navigator: present().navigator(workspace.presentation, { ...panels.navigator, ...options }),
      inspector: present().inspector(workspace.presentation, { ...panels.inspector, ...options }) });
    const pathSection = get("pathPanel");
    if (pathSection) pathSection.hidden = panels.navigator.tab !== "path";
    const object = workspace.query.getObject(selectedId());
    const result = options.structure.query?.get(options.structure.selectedId);
    get("selectionSummaryButton").textContent = result ? result.category === "block" ? `${result.kind.toUpperCase()} block` : "Reconvergence paths" : object?.label || object?.id || "No selection";
    get("focusSelectedButton").disabled = !object && !result;
    syncFocus();
  }
  function selectObject(id) {
    for (const [target, visible] of [[oldSelectedId, false], [id, true]]) {
      objectElements.get(target)?.classList.toggle("is-selected", visible);
      for (const halo of objectElements.get(target)?.querySelectorAll(".aig-selection-halo") || []) halo.setAttribute("visibility", visible ? "visible" : "hidden");
    }
    oldSelectedId = id || null;
  }
  function switchShell(active) {
    syncAigLevelControls(document, active);
    if (active) {
      const legacy = [...get("navigatorPanel").children].filter((item) => item !== navigatorHost && !item.matches("header"));
      legacy.push(get("selectionDetails"), get("comparePanel"), get("compareMount"),
        ...get("inspectorPanel").querySelectorAll(".inspector-footer"));
      for (const id of present().unavailableControls) {
        const element = get(id);
        if (element) legacy.push(element.matches("input[type=file]") ? element.closest("label") : element);
      }
      savedVisibility = new Map(legacy.filter(Boolean).map((element) => [element, element.hidden]));
      for (const element of savedVisibility.keys()) element.hidden = true;
      mount.hidden = false;
      toolbar.innerHTML = present().toolbar;
      overlays.innerHTML = present().overlays;
      connectionControl = bindAigConnectionHighlight(toolbar, { read: () => policy().connectionHighlight,
        commit: (value) => changePresentation("connectionHighlight", value), preview: refreshSelectionHighlights });
      get("searchInput").placeholder = present().searchPlaceholder;
      get("exportSvgButton").disabled = false;
      get("wholeViewButton").classList.add("is-active");
      get("focusedViewButton").classList.remove("is-active");
    } else {
      panelInteractions.reset();
      connectionControl?.closeEditor();
      connectionControl = null;
      for (const [element, hidden] of savedVisibility) element.hidden = hidden;
      savedVisibility.clear();
      get("searchInput").placeholder = "Find cell, net, port…";
    }
    for (const host of [navigatorHost, inspectorHost, toolbar, overlays]) host.hidden = !active;
    document.body.classList.toggle("has-domain-workspace", active);
    clearSearch();
  }
  function applyShapeStyles() {
    const workspace = readWorkspace();
    for (const [id, element] of objectElements) {
      const node = workspace.displayQuery.nodeById.get(id);
      const edge = workspace.displayQuery.edgeById.get(id);
      const style = node ? workspace.feature.nodeStyle(workspace, node, policy()) : workspace.feature.edgeStyle(workspace, edge, policy());
      const selector = node ? ".aig-node-shape" : ".aig-edge-path";
      for (const shape of element.querySelectorAll(selector)) setAttributes(shape, style);
      if (edge) for (const arrow of element.querySelectorAll(".aig-edge-arrow")) setAttributes(arrow, { fill: style.stroke, stroke: style.stroke });
    }
  }
  function syncPolicyControls() {
    get("cancelDomainImportButton").textContent = isSwitchingStyle() ? "Cancel AIG layout" : "Cancel AIG import";
    connectionControl?.sync(policy().connectionHighlight, isSwitchingStyle());
    for (const input of [...toolbar.querySelectorAll("[data-domain-policy]"), ...overlays.querySelectorAll("[data-domain-policy]")]) {
      // Keep the requested style visible and keyboard-accessible while preparing
      // it. Choosing the active style cancels the pending replacement.
      if (input.dataset.domainPolicy === "viewStyle" && isSwitchingStyle()) continue;
      const value = policy()[input.dataset.domainPolicy];
      if (input.type === "checkbox") input.checked = value; else input.value = value;
      input.disabled = isSwitchingStyle();
    }
  }
  function selectionPolicy() {
    const saved = policy(), depth = connectionControl?.previewDepth();
    return depth == null ? saved : { ...saved, connectionHighlight: depth };
  }
  function refreshSelectionHighlights() {
    const workspace = readWorkspace();
    if (!workspace) return;
    const options = selectionPolicy();
    const analysisSelected = readStructure().query?.get(readPanels().analysis.selectedId);
    const selectionId = options.connectionHighlight !== "off" && !analysisSelected ? selectedId() : null;
    if (highlightedSelectionId === selectionId && highlightedDepth === options.connectionHighlight) return;
    const highlight = selectionId && workspace.feature.selectionHighlights?.(workspace, selectionId, options);
    const next = highlight?.roles || new Map();
    mount.querySelector("svg")?.toggleAttribute("data-aig-cone-trace", Boolean(highlight?.dimOutside));
    updateAigSelectionHighlights(objectElements, neighborHighlights, next, workspace.feature.selectionHighlightColors);
    highlightedSelectionId = selectionId;
    highlightedDepth = options.connectionHighlight;
    neighborHighlights = next;
  }
  for (const host of [toolbar, overlays]) host.addEventListener("change", (event) => {
    const field = event.target.dataset.domainPolicy;
    if (!field || !readWorkspace()) return;
    const value = event.target.type === "checkbox" ? event.target.checked : event.target.value;
    if (field === "viewStyle") { changeStyle(value); return; }
    changePresentation(field, value);
  });
  function indexObjects() {
    objectElements = new Map([...mount.querySelectorAll("[data-domain-object]")].map(element => [element.dataset.domainObject, element]));
    oldSelectedId = null;
    highlightedSelectionId = null;
    highlightedDepth = null;
    neighborHighlights = new Map();
    return objectElements;
  }
  function clearObjects() {
    objectElements.clear();
    neighborHighlights.clear();
  }
  function activateCanvasObject(event) {
    if (!readWorkspace()) return;
    const object = event.target.closest("[data-domain-object]");
    if (object) { event.preventDefault(); select(object.dataset.domainObject, false); }
  }
  mount.addEventListener("keydown", (event) => {
    if (["Enter", " "].includes(event.key)) activateCanvasObject(event);
  });
  mount.addEventListener("click", (event) => {
    // Pointer activation is handled on pointerdown. Assistive clicks can arrive on their own.
    if (event.detail === 0) activateCanvasObject(event);
  });
  document.addEventListener("workbench-open-path", (event) => {
    if (!readWorkspace()) return;
    readPanels().navigator.tab = "path";
    renderPanels();
    persist();
    if (event.detail?.focusSearch) get("pathFind")?.focus?.();
  });
  return { renderPanels, selectObject, indexObjects, clearObjects, switchShell, applyShapeStyles,
    syncPolicyControls, refreshSelectionHighlights, selectionPolicy, inspectorHost,
    setPendingStyle: value => { toolbar.querySelector('[data-domain-policy="viewStyle"]').value = value; }
  };
}

function setAttributes(element, values) {
  for (const [key, value] of Object.entries(values)) {
    if (value === null || value === undefined) element.removeAttribute(key); else element.setAttribute(key, String(value));
  }
}
