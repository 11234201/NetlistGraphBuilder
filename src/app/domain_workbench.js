import { createDomainWorkspace } from "../application/domain_workspace.js";
import { createDomainWorkspaceStorage } from "../persistence/domain_workspace_storage.js";
import { createGraphvizRuntime } from "../platform/graphviz_runtime.js";
import { renderSvgSceneIntoMount, cancelSchematicRender } from "../render/progressiveSvgRenderer.js";
import { createStandaloneSvg } from "../render/svgExport.js";
import { renderSvgScene } from "../render/svg_scene_renderer.js";
import { createDomainCanvas } from "../ui/domain_canvas_controller.js";
import { renderAigNavigator, renderAigInspector, revealAigNavigatorSelection } from "../ui/aig_panels.js";
import { aigControls } from "../ui/aig_controls.js";
import { createAigPanelInteractions } from "../ui/aig_panel_interactions.js";
import { updateAigSelectionHighlights } from "../ui/aig_selection_highlights.js";
import { handleFocusShortcut } from "../ui/focus_shortcut.js";
import { searchDesignIndex } from "../search/designSearch.js";
import { createObjectRef } from "../contracts/object_ref.js";
import { sanitizeDownloadFileName } from "../platform/browser_download.js";
import { copyBrowserText } from "../platform/browser_clipboard.js";
import { getQuickInputPriority } from "./quickInput.js";

const presentations = new Map([[aigControls.domainId, { ...aigControls,
  navigator: renderAigNavigator, inspector: renderAigInspector }]]);
const passthrough = new Set(["setStatus", "logProcess", "cssEscape", "clamp", "round", "signed", "isPromise"]);

export function createDomainWorkbench({ document, windowTarget, registry, documents, sessions, jobs, download,
  setStatus, logProcess, suspendLegacy, clearSearch, importRequests }) {
  const get = (id) => document.getElementById(id);
  const mount = get("schematicMount");
  const runtime = createGraphvizRuntime();
  const storage = createDomainWorkspaceStorage(() => windowTarget.sessionStorage);
  const navigatorHost = document.createElement("div");
  const inspectorHost = document.createElement("div");
  const toolbar = document.createElement("div");
  navigatorHost.id = "domainNavigator";
  inspectorHost.id = "domainInspector";
  toolbar.id = "domainToolbar";
  toolbar.className = "domain-toolbar";
  get("navigatorPanel").append(navigatorHost);
  get("inspectorPanel").append(inspectorHost);
  get("canvas").before(toolbar);
  for (const host of [navigatorHost, inspectorHost, toolbar]) host.hidden = true;
  let workspace = null;
  let source = null;
  let panels = defaultPanels();
  let savedVisibility = new Map();
  let objectElements = new Map();
  let oldSelectedId = null;
  let neighborHighlights = new Map();
  let switchingStyle = false;
  let inputGeneration = 0;
  let importRequest = null;
  const panelInteractions = createAigPanelInteractions({ document, navigatorHost, inspectorHost, onAction: panelEvent,
    onFilter(field, value) {
      if (!workspace) return;
      panels.navigator[field] = value;
      panels.navigator.page = 0;
      renderPanels(); persist();
    } });
  const session = () => workspace ? sessions.require(workspace.sessionId) : null;
  const policy = () => session()?.presentationPolicy || {};
  const selectedId = () => session()?.selectedObjectRef?.localId || null;
  const present = () => presentations.get(workspace?.document.domainId);
  const report = (error) => {
    setStatus(error.message);
    logProcess("error", "import", error.message, { error });
  };
  function persist() {
    if (!workspace || !source) return;
    try { storage.save({ domainId: workspace.document.domainId, source, viewport: canvas.viewport(),
      selectedId: selectedId(), presentationPolicy: policy(), panels }); }
    catch (error) { logProcess("warning", "persistence", `Workspace could not be saved: ${error.message}`); }
  }
  function renderPanels() {
    if (!workspace) return;
    const options = { selectedId: selectedId(), fanoutThreshold: policy().fanoutThreshold };
    panelInteractions.render({ navigator: present().navigator(workspace.presentation, { ...panels.navigator, ...options }),
      inspector: present().inspector(workspace.presentation, { ...panels.inspector, ...options }) });
    const object = workspace.query.getObject(selectedId());
    get("selectionSummaryButton").textContent = object?.label || object?.id || "No selection";
    get("focusSelectedButton").disabled = !object;
  }
  function select(id, focus = true, { refreshDetails = true } = {}) {
    if (!workspace) return;
    const object = workspace.query.getObject(id);
    const selection = object ? createObjectRef({ documentId: workspace.document.documentId,
      unitId: session().unitId, kind: workspace.query.edgeById.has(id) ? "edge" : object.kind, localId: id }) : null;
    sessions.update(workspace.sessionId, () => ({ selectedObjectRef: selection }), { invalidateComputation: false });
    for (const [target, visible] of [[oldSelectedId, false], [selection?.localId, true]]) {
      objectElements.get(target)?.classList.toggle("is-selected", visible);
      for (const halo of objectElements.get(target)?.querySelectorAll(".aig-selection-halo") || []) halo.setAttribute("visibility", visible ? "visible" : "hidden");
    }
    oldSelectedId = selection?.localId || null;
    refreshSelectionHighlights();
    if (refreshDetails) renderPanels();
    if (focus && object) focusSelection(id);
    persist();
  }
  function focusSelection(id = selectedId()) {
    if (!workspace) return;
    const node = workspace.positionedNodes.get(id);
    const edge = workspace.query.edgeById.get(id);
    if (node) canvas.focus(node);
    else if (edge) {
      const start = workspace.positionedNodes.get(edge.source);
      const end = workspace.positionedNodes.get(edge.target);
      if (start && end) canvas.focus({ x: Math.min(start.x, end.x), y: Math.min(start.y, end.y),
        width: Math.max(start.x + start.width, end.x + end.width) - Math.min(start.x, end.x),
        height: Math.max(start.y + start.height, end.y + end.height) - Math.min(start.y, end.y) });
    }
  }
  const canvas = createDomainCanvas({ canvas: get("canvas"), mount,
    readViewport: () => session()?.viewport || { x: 0, y: 0, scale: 1 },
    writeViewport: (value) => { if (workspace) sessions.updateViewport(workspace.sessionId, value); }, select, save: persist });
  function switchShell(active) {
    if (active) {
      const legacy = [...get("navigatorPanel").children].filter((item) => item !== navigatorHost && !item.matches("header"));
      legacy.push(get("selectionDetails"), get("comparePanel"), get("compareMount"), get("focusedToolbar"),
        ...get("inspectorPanel").querySelectorAll(".inspector-footer, .inspector-actions"));
      for (const id of present().unavailableControls) {
        const element = get(id);
        if (element) legacy.push(element.matches("input[type=file]") ? element.closest("label") : element);
      }
      savedVisibility = new Map(legacy.filter(Boolean).map((element) => [element, element.hidden]));
      for (const element of savedVisibility.keys()) element.hidden = true;
      mount.hidden = false;
      toolbar.innerHTML = present().toolbar;
      get("searchInput").placeholder = present().searchPlaceholder;
      get("exportSvgButton").disabled = false;
      get("wholeViewButton").classList.add("is-active");
      get("focusedViewButton").classList.remove("is-active");
    } else {
      for (const [element, hidden] of savedVisibility) element.hidden = hidden;
      savedVisibility.clear();
      get("searchInput").placeholder = "Find cell, net, port…";
    }
    for (const host of [navigatorHost, inspectorHost, toolbar]) host.hidden = !active;
    document.body.classList.toggle("has-domain-workspace", active);
    clearSearch();
  }
  function refreshPolicy() {
    if (!workspace) return;
    for (const [id, element] of objectElements) {
      const node = workspace.query.nodeById.get(id);
      const edge = workspace.query.edgeById.get(id);
      const style = node ? workspace.feature.nodeStyle(workspace, node, policy()) : workspace.feature.edgeStyle(workspace, edge, policy());
      const selector = node ? ".aig-node-shape" : ".aig-edge-path";
      for (const shape of element.querySelectorAll(selector)) setAttributes(shape, style);
      if (edge) for (const arrow of element.querySelectorAll(".aig-edge-arrow")) setAttributes(arrow, { fill: style.stroke, stroke: style.stroke });
    }
    syncPolicyControls();
    refreshSelectionHighlights();
    renderPanels();
  }
  function syncPolicyControls() {
    get("cancelDomainImportButton").textContent = switchingStyle ? "Cancel AIG layout" : "Cancel AIG import";
    for (const input of toolbar.querySelectorAll("[data-domain-policy]")) {
      // Keep the requested style visible and keyboard-accessible while preparing
      // it. Choosing the active style cancels the pending replacement.
      if (input.dataset.domainPolicy === "viewStyle" && switchingStyle) continue;
      const value = policy()[input.dataset.domainPolicy];
      if (input.type === "checkbox") input.checked = value; else input.value = value;
      input.disabled = switchingStyle;
    }
  }
  function refreshSelectionHighlights() {
    const next = workspace.feature.selectionHighlights?.(workspace, selectedId(), policy()) || new Map();
    updateAigSelectionHighlights(objectElements, neighborHighlights, next, workspace.feature.selectionHighlightColors);
    neighborHighlights = next;
  }
  const useCase = createDomainWorkspace({ documents, sessions, jobs, registry, layout: runtime,
    async onCommit(next, restore, isCurrent) {
      const candidateMount = document.createElement("div");
      const restoredPolicy = sessions.require(next.sessionId).presentationPolicy;
      const scene = next.feature.scene(next, restoredPolicy);
      const result = await renderSvgSceneIntoMount(candidateMount, scene, { isCurrent });
      if (result.cancelled || !isCurrent()) return false;
      // Retain selections made on the still-visible graph while layout was running.
      const sameDocument = workspace?.document === next.document;
      const nextSelectedId = sameDocument ? selectedId() : restore?.selectedId;
      const nextPanels = sameDocument ? panels : restore?.panels;
      const focusedObjectId = sameDocument ? document.activeElement?.closest("[data-domain-object]")?.dataset.domainObject : null;
      const navigatorScroll = sameDocument ? get("navigatorPanel").scrollTop : 0;
      const inspectorScroll = sameDocument ? inspectorHost.scrollTop : 0;
      suspendLegacy();
      for (const id of ["schematicMount", "leftSchematicMount", "rightSchematicMount"]) cancelSchematicRender(get(id));
      canvas.stop();
      if (workspace && !sameDocument) switchShell(false);
      workspace = next;
      source = null;
      workspace.presentation = { ...next, document: next.document.model };
      workspace.positionedNodes = new Map(next.geometry.nodes.map((node) => [node.id, node]));
      panels = normalizePanels(nextPanels);
      oldSelectedId = null;
      neighborHighlights = new Map();
      if (!sameDocument) switchShell(true);
      mount.replaceChildren(...candidateMount.childNodes);
      objectElements = new Map([...mount.querySelectorAll("[data-domain-object]")].map((element) => [element.dataset.domainObject, element]));
      canvas.apply();
      // Relayout leaves the visible panel data unchanged. Keep its live inputs,
      // including an IME composition, instead of replacing their DOM.
      select(nextSelectedId || null, false, { refreshDetails: !sameDocument });
      syncPolicyControls();
      if (focusedObjectId) objectElements.get(focusedObjectId)?.focus({ preventScroll: true });
      get("navigatorPanel").scrollTop = navigatorScroll;
      inspectorHost.scrollTop = inspectorScroll;
      return true;
    } });
  function beginImport(request = importRequests.begin()) {
    importRequest = request;
    request.signal.addEventListener("abort", () => {
      inputGeneration += 1;
      useCase.cancel();
      switchingStyle = false;
      syncPolicyControls();
      get("cancelDomainImportButton").hidden = true;
    }, { once: true });
    return request;
  }
  async function open(domainId, input, restore = null, request = beginImport(), propagateErrors = false) {
    if (!request.isCurrent()) return null;
    const ticket = ++inputGeneration;
    setStatus(`Opening ${input.name}…`);
    get("cancelDomainImportButton").hidden = false;
    try {
      const result = await useCase.open(domainId, input, restore);
      if (!result || ticket !== inputGeneration) return null;
      source = { ...input };
      persist();
      const restoredSelectionMissing = restore?.selectedId && !result.query.getObject(restore.selectedId);
      setStatus(`Loaded ${input.name} · ${result.geometry.nodes.length} nodes · Graphviz${restoredSelectionMissing ? " · Source object no longer present; selection cleared." : ""}`);
      logProcess("info", "import", `Loaded ${input.name}`, { domainId, provider: runtime.version });
      return result;
    } catch (error) {
      if (propagateErrors) throw error;
      if (ticket === inputGeneration) report(new Error(`${input.name}: ${error.message}`));
      return null;
    }
    finally { if (ticket === inputGeneration) get("cancelDomainImportButton").hidden = true; }
  }
  function leave() {
    importRequest?.cancel();
    inputGeneration += 1;
    canvas.stop();
    useCase.leave();
    if (workspace) switchShell(false);
    workspace = null;
    source = null;
    objectElements.clear();
    neighborHighlights.clear();
    get("cancelDomainImportButton").hidden = true;
    try { storage.clear(); } catch (error) { logProcess("warning", "persistence", error.message); }
  }
  async function copySourceText(text) {
    const target = workspace;
    try {
      await copyBrowserText(text, windowTarget.navigator?.clipboard);
      if (workspace === target) setStatus("Full name or source ID copied.");
    } catch (error) {
      if (workspace !== target) return;
      const message = "Copy unavailable. Select the name or source ID to copy it manually.";
      setStatus(message);
      logProcess("warning", "export", message, { error });
    }
  }
  function panelEvent(data) {
    if (!workspace) return;
    if (data.aigSelect) select(data.aigSelect);
    else if (data.aigZoom) focusSelection(data.aigZoom);
    else if (data.aigCopy !== undefined) copySourceText(data.aigCopy);
    else if (data.aigNavTab) panels.navigator.tab = data.aigNavTab;
    else if (data.aigInspectorTab) panels.inspector.tab = data.aigInspectorTab;
    else if (data.aigPage) panels[data.aigPageTarget].page = Number(data.aigPage);
    else if (data.aigShowSelection) {
      panels.navigator = revealAigNavigatorSelection(workspace.presentation, panels.navigator, data.aigShowSelection, policy().fanoutThreshold);
      select(data.aigShowSelection);
    }
    else return;
    renderPanels(); persist();
  }
  toolbar.addEventListener("change", (event) => {
    const field = event.target.dataset.domainPolicy;
    if (!field || !workspace) return;
    const value = event.target.type === "checkbox" ? event.target.checked : event.target.value;
    if (field === "viewStyle") { changeViewStyle(value); return; }
    sessions.update(workspace.sessionId, () => ({ presentationPolicy: workspace.feature.normalizePresentation({ ...policy(), [field]: value }) }), { invalidateComputation: false });
    if (field === "neighbors") refreshSelectionHighlights(); else refreshPolicy();
    persist();
  });
  async function changeViewStyle(viewStyle) {
    if (viewStyle === policy().viewStyle) {
      if (switchingStyle) {
        importRequest?.cancel();
        setStatus(`AIG view: ${viewStyle === "abc" ? "ABC" : "Standard"}`);
      }
      return;
    }
    const request = beginImport();
    const ticket = ++inputGeneration;
    const savedSource = source;
    const restore = { selectedId: selectedId(), panels, presentationPolicy:
      workspace.feature.normalizePresentation({ ...policy(), viewStyle }) };
    switchingStyle = true;
    syncPolicyControls();
    toolbar.querySelector('[data-domain-policy="viewStyle"]').value = viewStyle;
    get("cancelDomainImportButton").hidden = false;
    setStatus(`Switching AIG view to ${viewStyle === "abc" ? "ABC" : "Standard"}…`);
    try {
      const result = await useCase.relayout(restore);
      if (!result || !request.isCurrent() || ticket !== inputGeneration) return;
      source = savedSource;
      canvas.fit();
      persist();
      setStatus(`AIG view: ${viewStyle === "abc" ? "ABC" : "Standard"}`);
    } catch (error) {
      if (ticket === inputGeneration) report(error);
    } finally {
      if (ticket === inputGeneration) {
        switchingStyle = false;
        syncPolicyControls();
        get("cancelDomainImportButton").hidden = true;
      }
    }
  }
  get("aigFileInput").addEventListener("change", async (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    const request = beginImport();
    const readGeneration = ++inputGeneration;
    useCase.cancel();
    get("cancelDomainImportButton").hidden = false;
    try {
      const text = await file.text();
      if (readGeneration !== inputGeneration) return;
      await open(event.target.dataset.domainId, { text, name: file.name }, null, request);
    } catch (error) {
      if (readGeneration === inputGeneration) { get("cancelDomainImportButton").hidden = true; report(error); }
    }
  });
  get("cancelDomainImportButton").addEventListener("click", () => {
    const operation = switchingStyle ? "Layout" : "Import";
    importRequest?.cancel(); setStatus(`${operation} cancelled; previous view retained.`);
  });
  mount.addEventListener("keydown", (event) => {
    if (!workspace || !["Enter", " "].includes(event.key)) return;
    const object = event.target.closest("[data-domain-object]");
    if (object) { event.preventDefault(); select(object.dataset.domainObject, false); }
  });
  windowTarget.addEventListener("beforeunload", persist);
  return Object.freeze({
    open,
    async initialize(fallback) {
      try {
        const saved = !windowTarget.location.search ? storage.load() : null;
        if (saved) {
          const request = beginImport();
          const restored = await open(saved.domainId, saved.source, saved, request);
          if (restored || !request.isLatest()) return;
        }
      } catch (error) { report(error); }
      await fallback();
    },
    imports: Object.freeze({
      openAigText(text, { label, request, presentationPolicy }) {
        return open("aig", { text, name: label }, { presentationPolicy }, beginImport(request), true);
      },
      route(kind, run) {
        if (workspace && kind !== "netlist" && kind !== "aig") { setStatus("This import is unavailable in the current view. Open a netlist first."); return Promise.resolve(null); }
        return run();
      },
      // Leave the domain successfully before applying Netlist-only attachments.
      // Within Netlist, keep the existing library-first batch policy.
      priority: (kind) => workspace && kind === "netlist" ? -2 : getQuickInputPriority(kind)
    }),
    search(index, query) { return workspace ? workspace.search(query, 100) : searchDesignIndex(index, query); },
    viewport: Object.freeze({
      read: () => workspace ? [{ id: "domain", mount, viewport: canvas.viewport() }] : null,
      preview(id, viewport) {
        if (!workspace || id !== "domain") return false;
        canvas.preview(viewport); return true;
      },
      commit(id, viewport) {
        if (!workspace || id !== "domain") return false;
        sessions.updateViewport(workspace.sessionId, viewport); canvas.apply(); persist(); return true;
      }
    }),
    context: () => workspace ? { compareActive: false, moduleLabel: workspace.document.model.name,
      sourceLabel: workspace.document.source.name, viewMode: "whole", providerLabel: "Graphviz" } : {},
    routeCommand(name, action, args) {
      if (name === "loadDesign" || name === "loadQuickInputText" && args[1]?.kind === "netlist") {
        if (workspace) registry.require("netlist").importSource({ text: args[0], name: args[1]?.label || args[1] });
        leave(); return action(...args);
      }
      if (!workspace || passthrough.has(name)) return action(...args);
      const commands = {
        handleWheel: canvas.wheel, handlePointerDown: canvas.pointerDown, fitToView: canvas.fit,
        focusSelectedCell: focusSelection, activateSearchResult: (result) => select(result.id),
        persistSession: persist,
        exportCurrentSvg: () => download.text(createStandaloneSvg(renderSvgScene(workspace.feature.scene(workspace, policy(), selectedId()))),
          `${sanitizeDownloadFileName(workspace.document.source.name)}.svg`, "image/svg+xml"),
        handleFocusSelectedShortcut: (event) => handleFocusShortcut(event, focusSelection, Boolean(selectedId()))
      };
      return commands[name]?.(...args);
    }
  });
}

function setAttributes(element, values) {
  for (const [key, value] of Object.entries(values)) {
    if (value === null || value === undefined) element.removeAttribute(key); else element.setAttribute(key, String(value));
  }
}
function defaultPanels() {
  return { navigator: { tab: "design", type: "ports", query: "", analysisFilter: "all", sort: "name", page: 0 },
    inspector: { tab: "connections", page: 0 } };
}
function normalizePanels(value) {
  const defaults = defaultPanels();
  return { navigator: { ...defaults.navigator, ...value?.navigator }, inspector: { ...defaults.inspector, ...value?.inspector } };
}
