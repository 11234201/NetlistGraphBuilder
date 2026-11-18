import { createDomainWorkspace } from "../application/domain_workspace.js";
import { createDomainWorkspaceStorage } from "../persistence/domain_workspace_storage.js";
import { createGraphvizRuntime } from "../platform/graphviz_runtime.js";
import { renderSvgSceneIntoMount, cancelSchematicRender } from "../render/progressiveSvgRenderer.js";
import { createStandaloneSvg } from "../render/svgExport.js";
import { renderSvgScene } from "../render/svg_scene_renderer.js";
import { createDomainCanvas } from "../ui/domain_canvas_controller.js";
import { renderAigNavigator, renderAigInspector, revealAigNavigatorSelection } from "../ui/aig_panels.js";
import { aigControls, bindAigConnectionHighlight } from "../ui/aig_controls.js";
import { createAigPanelInteractions } from "../ui/aig_panel_interactions.js";
import { updateAigSelectionHighlights } from "../ui/aig_selection_highlights.js";
import { handleFocusShortcut } from "../ui/focus_shortcut.js";
import { searchDesignIndex } from "../search/designSearch.js";
import { createObjectRef } from "../contracts/object_ref.js";
import { sanitizeDownloadFileName } from "../platform/browser_download.js";
import { copyBrowserText } from "../platform/browser_clipboard.js";
import { getQuickInputPriority } from "./quickInput.js";
import { createAigStructureBridge } from "./aig_structure_bridge.js";
import { createAigFocusedController } from "../ui/aig_focused_controller.js";
import { resolveFocusedRootAction } from "./focusedSelection.js";
import { createDomainWorkspaceDiagnostics } from "./domain_workspace_diagnostics.js";

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
  let highlightedSelectionId = null;
  let highlightedDepth = null;
  let connectionControl = null;
  let switchingStyle = false;
  let inputGeneration = 0;
  let importRequest = null;
  const panelInteractions = createAigPanelInteractions({ document, navigatorHost, inspectorHost, onAction: panelEvent,
    onFilter(field, value) {
      if (!workspace) return;
      if (field === "structureType") { panels.analysis.type = value; panels.analysis.page = 0; }
      else { panels.navigator[field] = value; panels.navigator.page = 0; }
      renderPanels(); persist();
    } });
  const session = () => workspace ? sessions.require(workspace.sessionId) : null;
  const policy = () => session()?.presentationPolicy || {};
  const selectedId = () => session()?.selectedObjectRef?.localId || null;
  const present = () => presentations.get(workspace?.document.domainId);
  const diagnostics = createDomainWorkspaceDiagnostics({ readWorkspace: () => workspace, readSession: session, setStatus, logProcess });
  const focused = createAigFocusedController({ get, readWorkspace: () => workspace, readSession: session, select, resolveFocusedRootAction,
    relayout: (focus, options) => replaceView({ ...options, focus }, "aig.focused.layout"), setStatus,
    cancelPending() { importRequest?.cancel(); setStatus(`AIG view: ${session().viewMode === "focused" ? "Focused" : "Whole"}`); },
    activateRoot: (id) => sessions.update(workspace.sessionId, (s) => ({ activeFocusedRootRef: s.focusedRootRefs.find((ref) => ref.localId === id) }), { invalidateComputation: false }) });
  function persist() {
    if (!workspace || !source) return;
    try { storage.save({ domainId: workspace.document.domainId, source, viewport: canvas.viewport(),
      selectedId: selectedId(), presentationPolicy: policy(), focus: focused.snapshot(), panels }); diagnostics.saved(); }
    catch (error) { diagnostics.saveFailed(error); }
  }
  function renderPanels() {
    if (!workspace) return;
    const options = { selectedId: selectedId(), fanoutThreshold: policy().fanoutThreshold, structure: structure.view() };
    panelInteractions.render({ navigator: present().navigator(workspace.presentation, { ...panels.navigator, ...options }),
      inspector: present().inspector(workspace.presentation, { ...panels.inspector, ...options }) });
    const object = workspace.query.getObject(selectedId());
    const result = options.structure.query?.get(options.structure.selectedId);
    get("selectionSummaryButton").textContent = result ? result.category === "block" ? `${result.kind.toUpperCase()} block` : "Reconvergence paths" : object?.label || object?.id || "No selection";
    get("focusSelectedButton").disabled = !object && !result;
    focused.sync();
  }
  function select(id, focus = true, { refreshDetails = true, preserveAnalysis = false } = {}) {
    if (!workspace) return;
    const object = workspace.query.getObject(id);
    const boundary = !object && workspace.displayQuery.getObject(id);
    if (boundary) { setStatus(boundary.description); return; }
    if (focus && object && focused.reveal(id)) return;
    if (!preserveAnalysis) structure.clearSelection();
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
    if (id === selectedId() && structure.locate()) return;
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
  const structure = createAigStructureBridge({ jobs, logProcess, mount, readWorkspace: () => workspace,
    readPanelState: () => panels.analysis, readPolicy: policy, renderPanels, persist,
    isAnalysisVisible: () => panels.navigator.tab === "analysis" || Boolean(panels.analysis.selectedId) || panels.inspector.tab === "analysis",
    focus: (bounds) => canvas.focus(bounds), onSelectionChange: () => refreshSelectionHighlights() });
  function switchShell(active) {
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
    for (const host of [navigatorHost, inspectorHost, toolbar]) host.hidden = !active;
    document.body.classList.toggle("has-domain-workspace", active);
    clearSearch();
  }
  function refreshPolicy() {
    if (!workspace) return;
    for (const [id, element] of objectElements) {
      const node = workspace.displayQuery.nodeById.get(id);
      const edge = workspace.displayQuery.edgeById.get(id);
      const style = node ? workspace.feature.nodeStyle(workspace, node, policy()) : workspace.feature.edgeStyle(workspace, edge, policy());
      const selector = node ? ".aig-node-shape" : ".aig-edge-path";
      for (const shape of element.querySelectorAll(selector)) setAttributes(shape, style);
      if (edge) for (const arrow of element.querySelectorAll(".aig-edge-arrow")) setAttributes(arrow, { fill: style.stroke, stroke: style.stroke });
    }
    syncPolicyControls();
    refreshSelectionHighlights();
    structure.refresh();
    renderPanels();
  }
  function syncPolicyControls() {
    get("cancelDomainImportButton").textContent = switchingStyle ? "Cancel AIG layout" : "Cancel AIG import";
    connectionControl?.sync(policy().connectionHighlight, switchingStyle);
    for (const input of toolbar.querySelectorAll("[data-domain-policy]")) {
      // Keep the requested style visible and keyboard-accessible while preparing
      // it. Choosing the active style cancels the pending replacement.
      if (input.dataset.domainPolicy === "viewStyle" && switchingStyle) continue;
      const value = policy()[input.dataset.domainPolicy];
      if (input.type === "checkbox") input.checked = value; else input.value = value;
      input.disabled = switchingStyle;
    }
  }
  function selectionPolicy() {
    const saved = policy(), depth = connectionControl?.previewDepth();
    return depth == null ? saved : { ...saved, connectionHighlight: depth };
  }
  function refreshSelectionHighlights() {
    if (!workspace) return;
    const options = selectionPolicy();
    const analysisSelected = structure.view().query?.get(panels.analysis.selectedId);
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
  const useCase = createDomainWorkspace({ documents, sessions, jobs, registry, layout: runtime,
    async onCommit(next, restore, isCurrent) {
      const candidateMount = document.createElement("div");
      const result = await renderSvgSceneIntoMount(candidateMount, next.scene, { isCurrent });
      if (result.cancelled || !isCurrent()) return false;
      // Retain selections made on the still-visible graph while layout was running.
      const sameDocument = workspace?.document === next.document;
      const nextSelectedId = sameDocument && !restore?.restoreSelection ? selectedId() : restore?.selectedId;
      const scopeChanged = workspace?.analysisScopeId !== next.analysisScopeId;
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
      highlightedSelectionId = null;
      highlightedDepth = null;
      neighborHighlights = new Map();
      if (!sameDocument) { switchShell(true); focused.reset(); }
      else if (scopeChanged) panels.analysis.selectedId = null;
      mount.replaceChildren(...candidateMount.childNodes);
      objectElements = new Map([...mount.querySelectorAll("[data-domain-object]")].map((element) => [element.dataset.domainObject, element]));
      canvas.apply();
      // Relayout leaves the visible panel data unchanged. Keep its live inputs,
      // including an IME composition, instead of replacing their DOM.
      structure.attach(workspace, objectElements);
      const visibleSelection = next.displayQuery.getObject(nextSelectedId) ? nextSelectedId : null;
      select(visibleSelection, false, { refreshDetails: !sameDocument || scopeChanged || restore?.restoreSelection, preserveAnalysis: true });
      focused.sync();
      syncPolicyControls();
      if (focusedObjectId) objectElements.get(focusedObjectId)?.focus({ preventScroll: true });
      get("navigatorPanel").scrollTop = navigatorScroll;
      inspectorHost.scrollTop = inspectorScroll;
      return true;
    } });
  function beginImport(request = importRequests.begin()) {
    if (!request.isCurrent()) return request;
    importRequest = request;
    request.signal.addEventListener("abort", abortImport, { once: true });
    return request;
  }
  function abortImport() {
    importRequest = null;
    inputGeneration += 1;
    useCase.cancel();
    switchingStyle = false;
    syncPolicyControls();
    get("cancelDomainImportButton").hidden = true;
  }
  function finishImport(request) {
    if (importRequest !== request) return;
    request.signal.removeEventListener("abort", abortImport);
    importRequest = null;
    get("cancelDomainImportButton").hidden = true;
  }
  async function open(domainId, input, restore = null, request = beginImport(), propagateErrors = false) {
    if (!request.isCurrent()) return null;
    const ticket = ++inputGeneration;
    let candidateContext = { domainId };
    setStatus(`Opening ${input.name}…`);
    get("cancelDomainImportButton").hidden = false;
    try {
      const result = await useCase.open(domainId, input, restore, (value) => { candidateContext = value; });
      if (!result || ticket !== inputGeneration) return null;
      source = { ...input };
      persist();
      const restoredSelectionMissing = restore?.selectedId && !result.query.getObject(restore.selectedId);
      setStatus(`Loaded ${input.name} · ${result.geometry.nodes.length} nodes · Graphviz${restoredSelectionMissing ? " · Source object no longer present; selection cleared." : ""}`);
      diagnostics.emit("info", "import", `Loaded ${input.name}`, { domainId, provider: runtime.version });
      const mappingWarnings = result.document.model.model.mappingWarnings;
      if (mappingWarnings) diagnostics.emit("warning", "import", "Some BLIF name mappings need attention",
        { ...mappingWarnings, ...diagnostics.context(), operation: "blif.names.bind", code: "blif.mapping-warnings", fileName: input.name });
      const restoredRoots = restore?.focus?.focusedRootNodeIds;
      if (Array.isArray(restoredRoots) && restoredRoots.length !== session().focusedRootRefs.length) {
        diagnostics.emit("warning", "persistence", "Some saved Focused roots could not be restored", { ...diagnostics.context(),
          operation: "aig.focused.restore", code: "aig.focused.stale-roots", requestedCount: restoredRoots.length,
          restoredCount: session().focusedRootRefs.length, fileName: input.name });
      }
      return result;
    } catch (error) {
      if (propagateErrors) throw error;
      if (ticket === inputGeneration) diagnostics.failure(error, restore?.source ? "persistence" : "import",
        restore?.source ? "aig.workspace.restore" : "aig.import", { fileName: input.name, retainedPreviousView: Boolean(workspace),
          previousDocumentId: workspace?.document.documentId }, "error", candidateContext);
      return null;
    }
    finally { if (ticket === inputGeneration) finishImport(request); }
  }
  function leave() {
    importRequest?.cancel();
    inputGeneration += 1;
    canvas.stop();
    structure.dispose();
    useCase.leave();
    if (workspace) switchShell(false);
    workspace = null;
    source = null;
    objectElements.clear();
    neighborHighlights.clear();
    get("cancelDomainImportButton").hidden = true;
    try { storage.clear(); } catch (error) { diagnostics.failure(error, "persistence", "aig.workspace.clear", {}, "warning"); }
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
    if (data.aigAnalysisSelect) panels.navigator.tab = "analysis";
    if (structure.action(data)) { refreshSelectionHighlights(); return; }
    if (data.aigSelect) select(data.aigSelect);
    else if (data.aigZoom) { if (!focused.reveal(data.aigZoom)) focusSelection(data.aigZoom); }
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
    changePresentation(field, value);
  });
  function changePresentation(field, value) {
    const next = workspace.feature.normalizePresentation({ ...policy(), [field]: value });
    sessions.update(workspace.sessionId, () => ({ presentationPolicy: next }), { invalidateComputation: false });
    if (field === "connectionHighlight") {
      connectionControl.sync(next.connectionHighlight, switchingStyle);
      refreshSelectionHighlights();
    }
    else if (field === "structureLabels" || field === "structureDim") structure.refresh();
    else refreshPolicy();
    persist();
  }
  async function changeViewStyle(viewStyle) {
    if (viewStyle === policy().viewStyle) {
      if (switchingStyle) {
        importRequest?.cancel();
        setStatus(`AIG view: ${viewStyle === "abc" ? "Logic View" : "Standard"}`);
      }
      return;
    }
    return replaceView({ focus: focused.snapshot(), presentationPolicy: { ...policy(), viewStyle } }, "aig.style.layout");
  }
  async function replaceView(options, operation) {
    const request = beginImport();
    const ticket = ++inputGeneration;
    const savedSource = source;
    let candidateContext = {};
    const restore = { ...options, panels, restoreSelection: options.selectedId !== undefined || Boolean(options.history),
      presentationPolicy: workspace.feature.normalizePresentation(options.presentationPolicy || policy()) };
    const viewStyle = restore.presentationPolicy.viewStyle;
    switchingStyle = true;
    syncPolicyControls();
    toolbar.querySelector('[data-domain-policy="viewStyle"]').value = viewStyle;
    get("cancelDomainImportButton").hidden = false;
    const label = operation === "aig.style.layout" ? (viewStyle === "abc" ? "Logic View" : "Standard") : restore.focus.viewMode === "focused" ? "Focused" : "Whole";
    setStatus(`Switching AIG view to ${label}…`);
    try {
      const result = await useCase.relayout(restore, (value) => { candidateContext = value; });
      if (!result || !request.isCurrent() || ticket !== inputGeneration) return null;
      source = savedSource;
      if (!restore.viewport) { canvas.fit(); if (restore.selectedId) focusSelection(restore.selectedId); }
      persist();
      setStatus(`AIG view: ${label}${result.truncated ? " · Focused budget reached" : ""}`);
      if (result.truncated) diagnostics.emit("warning", "graph", "Focused budget reached", { ...diagnostics.context(),
        operation, code: "aig.focused.partial", hiddenEndpointCount: result.hiddenEndpointCount, roots: restore.focus.focusedRootNodeIds });
      return result;
    } catch (error) {
      if (ticket === inputGeneration) diagnostics.failure(error, "layout", operation, { roots: restore.focus.focusedRootNodeIds,
        faninDepth: restore.focus.faninDepth, fanoutDepth: restore.focus.fanoutDepth, retainedPreviousView: true,
        previousScope: workspace.analysisScopeLabel }, "error", candidateContext);
      return null;
    } finally {
      if (ticket === inputGeneration) {
        switchingStyle = false;
        syncPolicyControls();
        finishImport(request);
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
      if (readGeneration === inputGeneration) {
        finishImport(request);
        diagnostics.failure(error, "import", "aig.file.read", { fileName: file.name, retainedPreviousView: Boolean(workspace) }, "error", { domainId: "aig" });
      }
    }
  });
  get("cancelDomainImportButton").addEventListener("click", () => {
    const operation = switchingStyle ? "Layout" : "Import";
    importRequest?.cancel(); setStatus(`${operation} cancelled; previous view retained.`);
  });
  function activateCanvasObject(event) {
    if (!workspace) return;
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
      } catch (error) { diagnostics.failure(error, "persistence", "aig.workspace.load"); }
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
    search(index, query) {
      if (!workspace) return searchDesignIndex(index, query);
      const matches = workspace.search(query, 100);
      return workspace.visibleNodeIds ? matches.map((match) => workspace.visibleNodeIds.has(match.id) ? match
        : { ...match, detail: [match.detail, "Outside Focused"].filter(Boolean).join(" · ") }) : matches;
    },
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
      sourceLabel: workspace.document.source.name, viewMode: session().viewMode, providerLabel: "Graphviz" } : {},
    routeCommand(name, action, args) {
      if (name === "loadDesign" || name === "loadQuickInputText" && args[1]?.kind === "netlist") {
        if (workspace) registry.require("netlist").importSource({ text: args[0], name: args[1]?.label || args[1] });
        leave(); return action(...args);
      }
      if (!workspace || passthrough.has(name)) return action(...args);
      const commands = {
        ...focused.commands,
        handleWheel: canvas.wheel, handlePointerDown: canvas.pointerDown, fitToView: canvas.fit,
        focusSelectedCell: focusSelection, activateSearchResult: (result) => select(result.id),
        persistSession: persist,
        exportCurrentSvg() {
          const fileName = `${sanitizeDownloadFileName(workspace.document.source.name)}.svg`;
          try { download.text(createStandaloneSvg(renderSvgScene(workspace.feature.scene(workspace, selectionPolicy(), selectedId(), structure.view()))),
            fileName, "image/svg+xml"); }
          catch (error) { diagnostics.failure(error, "export", "aig.svg.export", { format: "svg", fileName }); }
        },
        handleFocusSelectedShortcut: (event) => handleFocusShortcut(event, focusSelection, Boolean(selectedId() || panels.analysis.selectedId))
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
    inspector: { tab: "connections", page: 0 }, analysis: { category: "reconvergence", type: "all", page: 0, detailPage: 0, selectedId: null } };
}
function normalizePanels(value) {
  const defaults = defaultPanels();
  return { navigator: { ...defaults.navigator, ...value?.navigator }, inspector: { ...defaults.inspector, ...value?.inspector },
    analysis: { ...defaults.analysis, ...value?.analysis } };
}
