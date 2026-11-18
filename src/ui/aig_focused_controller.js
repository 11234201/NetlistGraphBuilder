import { normalizeViewDepth } from "../contracts/view_query.js";
import { createViewHistory, createHistoryOperations } from "../foundation/view_history.js";
import { escapeAttr, escapeHtml } from "./html.js";
import { captureFocusedRootsFocus } from "./focused_roots_focus.js";
import { isEditableInputTarget } from "./quick_input_controller.js";

const { pushViewHistory, replaceCurrentViewHistory, stepViewHistory } = createHistoryOperations(
  (entry) => ({ ...entry }), (left, right) => JSON.stringify(left) === JSON.stringify(right));

export function createAigFocusedController({ get, readWorkspace, readSession, readSelectionRevision, select, relayout, cancelPending, activateRoot, setStatus, resolveFocusedRootAction }) {
  let history = createViewHistory();
  let rootListKey = null;
  let pending = null;
  function snapshot() {
    const session = readSession();
    return { viewMode: session.viewMode, focusedRootNodeIds: session.focusedRootRefs.map((ref) => ref.localId),
      activeFocusedRootNodeId: session.activeFocusedRootRef?.localId || null, faninDepth: session.faninDepth,
      fanoutDepth: session.fanoutDepth };
  }
  function entry() {
    const session = readSession();
    return { ...snapshot(), selectedNodeId: session.selectedObjectRef?.localId, transform: session.viewport,
      presentationPolicy: session.presentationPolicy };
  }
  function reset() {
    history = pushViewHistory(createViewHistory(), entry());
    pending = null;
    get("focusedRootsFilter").value = "";
    rootListKey = null;
  }
  function sync() {
    const ws = readWorkspace();
    if (!ws) return;
    const state = snapshot(), roots = state.focusedRootNodeIds;
    const focused = state.viewMode === "focused";
    const selection = readSession().selectedObjectRef?.localId;
    get("wholeViewButton").classList.toggle("is-active", !focused);
    get("focusedViewButton").classList.toggle("is-active", focused);
    get("focusedViewButton").disabled = !focused && !ws.query.nodeById.has(selection);
    get("wholeViewButton").disabled = false;
    get("focusedToolbar").hidden = !focused;
    get("faninDepthInput").value = pending?.focus.faninDepth ?? state.faninDepth;
    get("fanoutDepthInput").value = pending?.focus.fanoutDepth ?? state.fanoutDepth;
    get("focusedRootCount").textContent = String(roots.length);
    get("setFocusedRootButton").disabled = !ws.query.nodeById.has(selection);
    get("addFocusedRootButton").disabled = !ws.query.nodeById.has(selection) || roots.includes(selection);
    get("removeFocusedRootButton").disabled = !roots.includes(selection);
    get("clearFocusedRootsButton").disabled = !roots.length;
    const timeline = pending?.options.history || history;
    get("moduleBackButton").disabled = timeline.index <= 0;
    get("moduleForwardButton").disabled = timeline.index >= timeline.entries.length - 1;
    const filter = get("focusedRootsFilter").value.trim().toLowerCase();
    const key = JSON.stringify([ws.document.documentId, roots, state.activeFocusedRootNodeId, filter]);
    if (key === rootListKey) return;
    rootListKey = key;
    const list = get("focusedRootsList");
    const restoreFocus = captureFocusedRootsFocus(list);
    const chips = roots.map((id) => {
      const label = ws.query.nodeById.get(id)?.label || id;
      if (!`${id} ${label}`.toLowerCase().includes(filter)) return "";
      const active = id === state.activeFocusedRootNodeId;
      return `<span class="focused-root-chip${active ? " is-active" : ""}"><button type="button" class="focused-root-activate" data-focused-root-activate="${escapeAttr(id)}" aria-pressed="${active}">${escapeHtml(label)}</button><button type="button" data-focused-root-remove="${escapeAttr(id)}" aria-label="Remove ${escapeAttr(label)} from Focused roots">×</button></span>`;
    }).join("");
    list.innerHTML = chips || (roots.length ? "No matching roots" : "No roots");
    restoreFocus();
  }
  async function apply(next, options = {}, operation = "aig.focused.layout") {
    const before = entry();
    const remember = operation !== "aig.style.layout" || pending?.remember;
    const request = { focus: next, remember, options: { presentationPolicy: pending?.options.presentationPolicy,
      selectionRevision: readSelectionRevision(), ...options } };
    pending = request;
    if (options.history) sync();
    try {
      const result = await relayout(next, request.options, operation);
      if (result && request === pending && remember) {
        const checkpoint = replaceCurrentViewHistory(history, before);
        history = options.history || pushViewHistory(checkpoint, entry());
      }
    } finally {
      if (request === pending) { pending = null; sync(); }
    }
  }
  function rootsAction(type, ids, selectedId) {
    const state = pending?.focus || snapshot();
    let root = { rootNodeIds: state.focusedRootNodeIds, activeRootNodeId: state.activeFocusedRootNodeId };
    for (const id of ids) {
      if (id && !readWorkspace().query.nodeById.has(id)) return;
      root = resolveFocusedRootAction(root, { type, nodeId: id });
      if (root.rejected) { setStatus("Focused root limit reached. Remove a root before adding another."); return; }
    }
    const changed = JSON.stringify(root.rootNodeIds) !== JSON.stringify(state.focusedRootNodeIds);
    if (!changed && !pending) {
      const before = entry();
      const activated = root.activeRootNodeId !== state.activeFocusedRootNodeId;
      if (activated) activateRoot(root.activeRootNodeId);
      if (selectedId) select(selectedId);
      if (activated) history = pushViewHistory(replaceCurrentViewHistory(history, before), entry());
      sync(); return;
    }
    const next = { ...state, viewMode: root.rootNodeIds.length ? "focused" : "whole",
      focusedRootNodeIds: root.rootNodeIds, activeFocusedRootNodeId: root.activeRootNodeId };
    if (pending && sameFocus(next, snapshot()) && !hasPendingStyle()) {
      pending = null; cancelPending(); if (selectedId) select(selectedId); sync(); return;
    }
    return apply(next, { selectedId });
  }
  function selectedAction(type) {
    const id = readSession().selectedObjectRef?.localId;
    if (id) return rootsAction(type, [id], type === "remove" ? undefined : id);
  }
  function reveal(id) {
    const ws = readWorkspace();
    if (!ws.visibleNodeIds || ws.visibleNodeIds.has(id) || ws.visibleEdgeIds.has(id)) return false;
    const edge = ws.query.edgeById.get(id);
    const ids = edge ? [edge.source, edge.target] : [id];
    rootsAction("add", ids, id); return true;
  }
  function navigate(delta) {
    const saved = pending?.options.history || replaceCurrentViewHistory(history, entry());
    const result = stepViewHistory(saved, delta);
    if (result.entry) return apply(result.entry, { history: result.history, selectedId: result.entry.selectedNodeId ?? null,
      viewport: result.entry.transform, presentationPolicy: result.entry.presentationPolicy });
  }
  function hasPendingStyle() {
    const style = pending?.options.presentationPolicy?.viewStyle;
    return style !== undefined && style !== readSession().presentationPolicy.viewStyle;
  }
  function changeStyle(viewStyle) {
    const current = readSession().presentationPolicy;
    const requested = pending?.options.presentationPolicy || current;
    if (viewStyle === requested.viewStyle) return;
    if (pending && viewStyle === current.viewStyle && sameFocus(pending.focus, snapshot()) && !pending.options.history) {
      pending = null; cancelPending(); sync(); return;
    }
    return apply(pending?.focus || snapshot(), { ...pending?.options, presentationPolicy: { ...requested, viewStyle } }, "aig.style.layout");
  }
  function shortcut(event) {
    if (isEditableInputTarget(event.target)) return;
    const key = event.key.toLowerCase();
    const direction = event.altKey && !event.ctrlKey && !event.metaKey
      ? ({ arrowleft: -1, arrowright: 1 })[key]
      : !event.altKey && (event.ctrlKey || event.metaKey) && (key === "z" || key === "y")
        ? (key === "z" && !event.shiftKey ? -1 : 1) : null;
    if (direction) { event.preventDefault(); navigate(direction); }
  }
  const commands = {
    setViewMode(mode) {
      if (mode === "whole") return rootsAction("clear", [null]);
      if (pending?.focus.viewMode === "whole" && readSession().viewMode === "focused") {
        if (hasPendingStyle()) return apply(snapshot());
        pending = null; cancelPending(); sync(); return;
      }
      if ((pending?.focus.viewMode || readSession().viewMode) === "whole") return selectedAction("set");
    },
    setSelectedAsFocusedRoot: () => selectedAction("set"),
    addSelectedAsFocusedRoot: () => selectedAction("add"),
    removeSelectedFromFocusedRoots: () => selectedAction("remove"),
    clearFocusedRoots: () => rootsAction("clear", [null]),
    addSearchResultToFocus: (result) => rootsAction("add", [result.id], result.id),
    handleFocusedRootListClick(event) {
      const item = event.target.closest("[data-focused-root-activate], [data-focused-root-remove]");
      if (item?.dataset.focusedRootRemove) return rootsAction("remove", [item.dataset.focusedRootRemove]);
      const id = item?.dataset.focusedRootActivate;
      if (id) return rootsAction("activate", [id], id);
    },
    handleFocusedRootsFilter: sync,
    scheduleFocusedDepthChange() {
      const state = pending?.focus || snapshot();
      const faninDepth = normalizeViewDepth(get("faninDepthInput").valueAsNumber || 0);
      const fanoutDepth = normalizeViewDepth(get("fanoutDepthInput").valueAsNumber || 0);
      if (faninDepth !== state.faninDepth || fanoutDepth !== state.fanoutDepth) return apply({ ...state, faninDepth, fanoutDepth });
    },
    navigateViewHistory: navigate,
    handleViewHistoryShortcut: shortcut
  };
  return { commands, reset, sync, snapshot, reveal, changeStyle };
}

function sameFocus(left, right) {
  return left.viewMode === right.viewMode && left.activeFocusedRootNodeId === right.activeFocusedRootNodeId &&
    left.faninDepth === right.faninDepth && left.fanoutDepth === right.fanoutDepth &&
    left.focusedRootNodeIds.length === right.focusedRootNodeIds.length &&
    left.focusedRootNodeIds.every((id, index) => id === right.focusedRootNodeIds[index]);
}
