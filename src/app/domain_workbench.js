import { defaultPanels, normalizePanels } from "./aig_panel_state.js";
import { createDomainViewCommands } from "./domain_view_commands.js";
import { createAigSourceActions, forwardInputFailure } from "./aig_source_actions.js";
import { createAigWorkbenchShell } from "../ui/aig_workbench_shell.js";
import { createDomainWorkspace } from "../application/domain_workspace.js";
import { createAigCollectionStorage } from "../persistence/aig_collection_storage.js";
import { createAigCollection } from "./aig_collection.js";
import { aigLevelFailureDetails } from "./aig_level_input.js";
import { createGraphvizRuntime } from "../platform/graphviz_runtime.js";
import { renderSvgSceneIntoMount, cancelSchematicRender } from "../render/progressiveSvgRenderer.js";
import { createDomainCanvas } from "../ui/domain_canvas_controller.js";
import { renderAigNavigator, renderAigInspector, revealAigNavigatorSelection } from "../ui/aig_panels.js";
import { aigControls } from "../ui/aig_controls.js";
import { createObjectRef } from "../contracts/object_ref.js";
import { copyBrowserText } from "../platform/browser_clipboard.js";
import { createAigStructureBridge } from "./aig_structure_bridge.js";
import { createAigInspectionCommands } from "./aig_inspection_commands.js";
import { createAigFocusedController } from "../ui/aig_focused_controller.js";
import { resolveFocusedRootAction } from "./focusedSelection.js";
import { createDomainWorkspaceDiagnostics } from "./domain_workspace_diagnostics.js";

const presentations = new Map([[aigControls.domainId, { ...aigControls,
  navigator: renderAigNavigator, inspector: renderAigInspector }]]);


export function createDomainWorkbench({ document, windowTarget, registry, documents, sessions, jobs, download,
  setStatus, logProcess, suspendLegacy, clearSearch, importRequests, netlistSearchGraph, canStartAigCollection }) {
  const get = (id) => document.getElementById(id);
  const mount = get("schematicMount");
  const runtime = createGraphvizRuntime();
  const storage = createAigCollectionStorage(() => windowTarget.sessionStorage);
  const graphSelect = get("aigGraphSelect");
  const collection = createAigCollection({
    validate: (input) => registry.require("aig").importSource(input).model.format,
    activate: async (input, restore, request) => {
      const result = await open("aig", input, restore, beginImport(request), () => {});
      if (!result) throw new DOMException("AIG import superseded", "AbortError");
    },
    render(list, active) {
      graphSelect.replaceChildren(...list.map((item) => new Option(item.name + " (" + item.id + ")", item.id)));
      graphSelect.hidden = list.length < 2;
      graphSelect.value = active || "";
    }
  });
  let workspace = null;
  let source = null;
  let panels = defaultPanels();
  let switchingStyle = false;
  let inputGeneration = 0;
  let selectionRevision = 0;
  let importRequest = null;
  const session = () => workspace ? sessions.require(workspace.sessionId) : null;
  const policy = () => session()?.presentationPolicy || {};
  const selectedId = () => session()?.selectedObjectRef?.localId || null;
  const present = () => presentations.get(workspace?.document.domainId);
  const shell = createAigWorkbenchShell({ document, get, mount, readWorkspace: () => workspace,
    readPanels: () => panels, present, readStructure: () => structure.view(), policy, selectedId,
    isSwitchingStyle: () => switchingStyle, changePresentation, changeStyle: value => focused.changeStyle(value),
    syncFocus: () => focused.sync(), panelEvent, select, persist, clearSearch });
  const { renderPanels, switchShell, applyShapeStyles, syncPolicyControls,
    refreshSelectionHighlights, selectionPolicy, inspectorHost } = shell;
  const diagnostics = createDomainWorkspaceDiagnostics({ readWorkspace: () => workspace, readSession: session, setStatus, logProcess });
  const focused = createAigFocusedController({ get, readWorkspace: () => workspace, readSession: session, select, resolveFocusedRootAction,
    readSelectionRevision: () => selectionRevision,
    relayout: (focus, options, operation) => replaceView({ ...options, focus }, operation), setStatus,
    cancelPending() { importRequest?.cancel(); setStatus(`AIG view: ${aigScopeLabel(session())}`); },
    activateRoot: (id) => sessions.update(workspace.sessionId, (s) => ({ activeFocusedRootRef: s.focusedRootRefs.find((ref) => ref.localId === id) }), { invalidateComputation: false }) });
  function currentView() {
    return { viewport: canvas.viewport(), selectedId: selectedId(), presentationPolicy: policy(),
      focus: focused.snapshot(), panels: structuredClone(panels) };
  }
  function persist() {
    if (!workspace || !source) return;
    try { collection.save(currentView(), storage); diagnostics.saved(); }
    catch (error) { diagnostics.saveFailed(error); }
  }
  function select(id, focus = true, { refreshDetails = true, preserveAnalysis = false } = {}) {
    if (!workspace) return;
    const object = workspace.query.getObject(id);
    const boundary = !object && workspace.displayQuery.getObject(id);
    if (boundary) { if (focus) focusSelection(id); setStatus(boundary.description); return; }
    if (focus && object) {
      const reveal = focused.reveal(id);
      if (reveal) return reveal;
    }
    if (!preserveAnalysis) { selectionRevision++; structure.clearSelection(); }
    const selection = object ? createObjectRef({ documentId: workspace.document.documentId,
      unitId: session().unitId, kind: workspace.query.edgeById.has(id) ? "edge" : object.kind, localId: id }) : null;
    sessions.update(workspace.sessionId, () => ({ selectedObjectRef: selection }), { invalidateComputation: false });
    shell.selectObject(selection?.localId);
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
  function refreshPolicy() {
    if (!workspace) return;
    applyShapeStyles();
    syncPolicyControls();
    refreshSelectionHighlights();
    structure.refresh();
    renderPanels();
  }
  const useCase = createDomainWorkspace({ documents, sessions, jobs, registry, layout: runtime,
    async onCommit(next, restore, isCurrent) {
      const candidateMount = document.createElement("div");
      if (next.searchFirst) {
        candidateMount.innerHTML = '<div class="search-first-empty"><strong>Search-first</strong><span>Search for a signal to open its Focused neighborhood, or use Show Path to choose endpoints. Choose Whole to lay out the full graph.</span></div>';
      } else {
        const result = await renderSvgSceneIntoMount(candidateMount, next.scene, { isCurrent });
        if (result.cancelled) return false;
      }
      if (!isCurrent()) return false;
      // Retain selections made on the still-visible graph while layout was running.
      const sameDocument = workspace?.document === next.document;
      const updatingLevels = Boolean(restore?.levelUpdate);
      const livePolicy = updatingLevels && policy();
      const policyChanged = livePolicy && Object.entries(livePolicy).some(([key, value]) => value !== restore.presentationPolicy[key]);
      const sameGraph = sameDocument || updatingLevels;
      const keepCurrentSelection = sameGraph && (!restore?.restoreSelection || restore.selectionRevision !== selectionRevision);
      const nextSelectedId = keepCurrentSelection ? selectedId() : restore?.selectedId;
      const scopeChanged = workspace?.analysisScopeId !== next.analysisScopeId;
      const nextPanels = sameGraph ? panels : restore?.panels;
      const focusedObjectId = sameGraph ? document.activeElement?.closest("[data-domain-object]")?.dataset.domainObject : null;
      const navigatorScroll = sameGraph ? get("navigatorPanel").scrollTop : 0;
      const inspectorScroll = sameGraph ? inspectorHost.scrollTop : 0;
      if (updatingLevels) sessions.updateViewport(next.sessionId, canvas.viewport());
      if (policyChanged) sessions.update(next.sessionId, () => ({ presentationPolicy: livePolicy }), { invalidateComputation: false });
      suspendLegacy();
      for (const id of ["schematicMount", "leftSchematicMount", "rightSchematicMount"]) cancelSchematicRender(get(id));
      canvas.stop();
      if (workspace && !sameGraph) switchShell(false);
      workspace = next;
      source = null;
      workspace.presentation = { ...next, document: next.document.model };
      workspace.positionedNodes = new Map(next.geometry.nodes.map((node) => [node.id, node]));
      panels = normalizePanels(nextPanels);
      if (!sameGraph) { switchShell(true); focused.reset(); }
      else if (scopeChanged) panels.analysis.selectedId = null;
      get("exportSvgButton").disabled = next.searchFirst;
      mount.replaceChildren(...candidateMount.childNodes);
      const objectElements = shell.indexObjects();
      canvas.apply();
      if (policyChanged) applyShapeStyles();
      // Relayout leaves the visible panel data unchanged. Keep its live inputs,
      // including an IME composition, instead of replacing their DOM.
      structure.attach(workspace, objectElements);
      // Saved graph views can inspect source objects outside the drawing, including in Search-first.
      const selectionQuery = restore?.graphId ? next.query : next.displayQuery;
      const restoredId = selectionQuery.getObject(nextSelectedId) ? nextSelectedId : null;
      select(restoredId, false, { refreshDetails: !sameDocument || scopeChanged || restore?.restoreSelection, preserveAnalysis: true });
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
  function budgetNotice(result, operation, previousScope) {
    if (!result.truncated) return "";
    if (previousScope !== result.analysisScopeLabel) diagnostics.emit("warning", "graph", "Focused budget reached", {
      ...diagnostics.context(), operation, code: "aig.focused.partial", hiddenEndpointCount: result.hiddenEndpointCount,
      roots: focused.snapshot().focusedRootNodeIds });
    return " · Focused budget reached";
  }
  async function open(domainId, input, restore = null, request = beginImport(), forwardFailure) {
    if (!request.isCurrent()) return null;
    const ticket = ++inputGeneration;
    let candidateContext = { domainId };
    setStatus(`Opening ${input.name}…`);
    get("cancelDomainImportButton").hidden = false;
    try {
      if (!restore?.source && !restore?.focus && get("aigSearchFirstInput").checked) {
        restore = { ...restore, focus: { viewMode: "search-first" } };
      }
      if (restore?.levelUpdate) collection.checkReplacement(input);
      const result = await useCase.open(domainId, input, restore, (value) => { candidateContext = value; },
        restore?.levelUpdate ? workspace.document : null);
      if (!result || ticket !== inputGeneration) return null;
      source = { ...input, format:result.document.model.format };
      collection.commit(source, restore?.graphId, request);
      persist();
      const restoredSelectionMissing = restore?.selectedId && !result.query.getObject(restore.selectedId);
      const partial = budgetNotice(result, "aig.focused.restore");
      const summary = result.searchFirst ? `${result.query.nodeById.size} nodes indexed · Search-first` : `${result.geometry.nodes.length} nodes · Graphviz`;
      const levels = result.document.model.levelFile;
      const levelSummary = levels ? ` · ${levels.name} (${levels.pointCount} level points)` : "";
      setStatus(`Loaded ${input.name} · ${summary}${levelSummary}${partial}${restoredSelectionMissing ? " · Source object no longer present; selection cleared." : ""}`);
      diagnostics.emit("info", "import", `Loaded ${input.name}`, { domainId, provider: runtime.version,
        ...(levels ? { ...diagnostics.context(), graphId: collection.active(), operation: "aig.level.import",
          fileName: levels.name, pointCount: levels.pointCount } : {}) });
      const mappingWarnings = result.document.model.model.mappingWarnings;
      if (mappingWarnings) diagnostics.emit("warning", "import", "Some BLIF name mappings need attention",
        { ...mappingWarnings, ...diagnostics.context(), operation: "blif.names.bind", code: "blif.mapping-warnings", fileName: input.name });
      if (restore?.pathSourceMismatch) diagnostics.emit("warning", "persistence", "Source changed; saved Show Path endpoints cleared", {
        ...diagnostics.context(), operation: "show-path.restore", code: "show-path.source-mismatch" });
      const restoredRoots = restore?.focus?.focusedRootNodeIds;
      if (Array.isArray(restoredRoots) && restoredRoots.length !== session().focusedRootRefs.length) {
        diagnostics.emit("warning", "persistence", "Some saved Focused roots could not be restored", { ...diagnostics.context(),
          operation: "aig.focused.restore", code: "aig.focused.stale-roots", requestedCount: restoredRoots.length,
          restoredCount: session().focusedRootRefs.length, fileName: input.name });
      }
      return result;
    } catch (error) {
      const details = { fileName: input.name, retainedPreviousView: Boolean(workspace),
        previousDocumentId: workspace?.document.documentId };
      if (input.levelFile) Object.assign(details, aigLevelFailureDetails(input, error, candidateContext), { graphId: restore?.graphId });
      if (ticket === inputGeneration && request.isCurrent() && restore?.source && restore.focus?.showPath && error?.code?.startsWith("show-path.")) {
        diagnostics.failure(error, "persistence", "show-path.restore", { ...details, code: error.code }, "warning", candidateContext);
        return open(domainId, input, { ...restore, focus: { ...restore.focus, showPath: null } }, request);
      }
      if (forwardFailure) {
        forwardInputFailure(forwardFailure, { ...candidateContext, ...details });
        throw error;
      }
      if (ticket === inputGeneration) diagnostics.failure(error, restore?.source ? "persistence" : "import",
        restore?.source ? "aig.workspace.restore" : "aig.import", details, "error", candidateContext);
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
    shell.clearObjects();
    collection.clear();
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
  function changePresentation(field, value) {
    const next = workspace.feature.normalizePresentation({ ...policy(), [field]: value });
    sessions.update(workspace.sessionId, () => ({ presentationPolicy: next }), { invalidateComputation: false });
    if (field === "connectionHighlight") {
      syncPolicyControls();
      refreshSelectionHighlights();
    }
    else if (field === "structureLabels" || field === "structureDim") structure.refresh();
    else refreshPolicy();
    persist();
  }

  async function replaceView(options, operation) {
    const request = beginImport();
    const ticket = ++inputGeneration;
    const savedSource = source;
    const previousPartialScope = workspace.truncated ? workspace.analysisScopeLabel : null;
    let candidateContext = {};
    const restore = { ...options, panels, restoreSelection: options.selectedId !== undefined || Boolean(options.history),
      presentationPolicy: workspace.feature.normalizePresentation(options.presentationPolicy || policy()) };
    const viewStyle = restore.presentationPolicy.viewStyle;
    switchingStyle = true;
    syncPolicyControls();
    shell.setPendingStyle(viewStyle);
    get("cancelDomainImportButton").hidden = false;
    const scope = aigScopeLabel(restore.focus);
    const label = operation === "aig.style.layout" ? (viewStyle === "abc" ? "Logic View" : "Standard") : scope;
    setStatus(`Switching AIG view to ${label}…`);
    try {
      const result = await useCase.relayout(restore, (value) => { candidateContext = value; });
      if (!result || !request.isCurrent() || ticket !== inputGeneration) return null;
      source = savedSource;
      if (!restore.viewport) { canvas.fit(); if (restore.selectedId && selectedId()) focusSelection(); }
      persist();
      setStatus(`AIG view: ${label}${budgetNotice(result, operation, previousPartialScope)}`);
      return result;
    } catch (error) {
      if (ticket === inputGeneration && operation === "show-path.apply") {
        const failure = error instanceof Error ? error : new Error(String(error), { cause: error });
        throw Object.assign(failure, { pathContext: { ...candidateContext, ...failure.pathContext } });
      }
      if (ticket === inputGeneration) diagnostics.failure(error, "layout", operation, { roots: restore.focus.focusedRootNodeIds,
        faninDepth: restore.focus.faninDepth, fanoutDepth: restore.focus.fanoutDepth, retainedPreviousView: true,
        previousScope: workspace.analysisScopeLabel }, "error", candidateContext);
      if (options.reportToCommand && ticket === inputGeneration) throw error;
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
  async function addGraphs(inputs, request = importRequests.begin()) {
    if (!workspace && canStartAigCollection && !canStartAigCollection()) throw Object.assign(new Error("Open an AIG before appending to this netlist page"),{code:"DOMAIN_MISMATCH"});
    const result = await collection.add(inputs, request);
    persist();
    setStatus("AIG graphs: " + result.graphCount);
    return result;
  }
  graphSelect.addEventListener("change", async () => {
    try { await collection.switchTo(graphSelect.value, importRequests.begin()); }
    catch (error) {
      graphSelect.value = collection.list().find((entry) => entry.active)?.id || "";
      if (error.name !== "AbortError") diagnostics.failure(error, "navigation", "aig.collection.select");
    }
  });
  get("addAigInput").addEventListener("change", async (event) => {
    const request = importRequests.begin();
    const files = [...event.target.files];
    event.target.value = "";
    try { if (files.length) await addGraphs(await Promise.all(files.map(async (file) => ({ name: file.name, text: await file.text() }))), request); }
    catch (error) { if (error.name !== "AbortError") diagnostics.failure(error, "import", "aig.collection.add"); }
  });
  function cancelImport() {
    const active = !get("cancelDomainImportButton").hidden;
    const operation = switchingStyle ? "Layout" : "Import";
    importRequest?.cancel(); setStatus(`${operation} cancelled; previous view retained.`);
    return {cancelled:active};
  }
  get("cancelDomainImportButton").addEventListener("click", cancelImport);
  windowTarget.addEventListener("beforeunload", persist);
  return Object.freeze({
    open, cancelImport,
    resourceUsage:() => registry.require("aig").resourceUsage(),
    runInspectionCommand:createAigInspectionCommands({read:() => workspace, readPanels:() => panels, selectedId, policy,
      changePresentation, changeStyle:focused.changeStyle, panelEvent, structure, renderPanels, syncControls:syncPolicyControls, persist}),
    graphs: { add: addGraphs, list: collection.list, select: (id) => collection.switchTo(id, importRequests.begin()) },
    navigation: {
      read: () => workspace && ({ ...focused.snapshot(), selectedId:selectedId(), documentId:workspace.document.documentId,
        graphId:collection.active(), viewport:canvas.viewport(), mount }),
      object: id => workspace?.query.getObject(id),
      named: name => (workspace?.search(name, 100) || []).filter(hit => hit.label === name ||
        hit.sourceRefs?.some(ref => ref.id === name || ref.label === name) ||
        hit.nameMappings?.some(row => row.name === name || row.signalId === name)).map(hit => hit.id),
      connections: id => workspace?.query.connections(id),
      select, zoom:focusSelection, roots:focused.rootsAction, canNavigate:focused.canNavigate,
      analysis: id => ({critical:workspace.query.criticalNodes.has(id) || workspace.query.criticalEdges.has(id)}),
      depth(fanin, fanout) {
        get("faninDepthInput").value = String(fanin);
        get("fanoutDepthInput").value = String(fanout);
        return focused.commands.scheduleFocusedDepthChange();
      }
    },
    ...createAigSourceActions({ windowTarget, storage, collection, open, beginImport, diagnostics,
      isActive: () => Boolean(workspace), readSource: () => source, currentView, addGraphs, setStatus }),
    ...createDomainViewCommands({ readWorkspace: () => workspace, readRequest: () => importRequest,
      readAnalysisSelection: () => panels.analysis.selectedId, netlistSearchGraph, canvas, mount, sessions,
      session, persist, collection, leave, focused, select, focusSelection, selectionPolicy, selectedId,
      structure, download, diagnostics })
  });
}

function aigScopeLabel(focus) {
  if (focus.showPath?.enabled) return "Show Path";
  return focus.viewMode === "search-first" ? "Search-first" : focus.viewMode === "focused" ? "Focused" : "Whole";
}
