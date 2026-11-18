import { snapshotNavigationImport, resolveNavigationImport, projectNavigation, navigationGraph, importViewQuery } from "./view_navigation_import.js";
import { normalizeViewQuery } from "../contracts/view_query.js";
import { graphNodeToObjectRef } from "../domains/netlist/graph_object_refs.js";
import { createCommandBus } from "../application/command_bus.js";
import { importViewState, initialViewState, projectViewState } from "./view_state_import.js";
import { createViewCommandHandlers } from "../application/view_commands.js";
import { createViewSessionStore } from "../application/view_session_store.js";
import { createObjectRef, objectRefKey } from "../contracts/object_ref.js";
import { DEFAULT_FOCUSED_VIEW_POLICY } from "../foundation/view_policy.js";
import { hasProjectedValueChange } from "../foundation/structured_value.js";

export function createSingleViewSessionBridge({
  state,
  getDocumentId,
  sessions = createViewSessionStore(),
  maxFocusedRoots = DEFAULT_FOCUSED_VIEW_POLICY.maximumRoots,
  onDispatch = null
}) {
  const bus = createCommandBus(createViewCommandHandlers({ sessions, maxFocusedRoots }), { onDispatch });

  let pendingNavigation = null;
  // Before a document opens, explicitly imported startup preferences live here.
  // Once opened, the ViewSession is authoritative; legacy fields are projections.
  let initialQuery = importViewQuery(state);
  let initialState = initialViewState(state);
  projectViewState(state, initialState);
  const context = () => ({ documentId: getDocumentId(), unitId: state.currentModule?.name,
    occurrencePath: state.occurrenceContext?.occurrencePath });
  const currentGraph = () => navigationGraph(state.fullGraph, context().unitId, context().occurrencePath || []);

  function project(session, graph = currentGraph()) {
    initialState = Object.freeze({ viewport: session.viewport, layoutPolicy: session.layoutPolicy,
      presentationPolicy: session.presentationPolicy, overrides: session.overrides });
    state.showPath = session.showPath;
    projectViewState(state, session);
    initialQuery = normalizeViewQuery(session);
    Object.assign(state, initialQuery);
    Object.assign(state, projectNavigation(session, graph, pendingNavigation));
  }

  function readQuery() {
    return normalizeViewQuery(sessions.get("single:primary") || initialQuery);
  }

  function importQuery(value = {}) {
    const query = importViewQuery(value, readQuery());
    if (!getDocumentId() || !state.currentModule?.name) {
      initialQuery = query;
      Object.assign(state, query);
      return query;
    }
    const current = synchronizeSession();
    const next = hasProjectedValueChange(current, query)
      ? sessions.update(current.sessionId, () => query) : current;
    project(next);
    return next;
  }

  function readState() {
    return sessions.get("single:primary") || initialState;
  }

  function importState(value = {}) {
    const current = readState();
    const patch = importViewState(value, current);
    if (!getDocumentId() || !state.currentModule?.name) {
      initialState = initialViewState({ ...current, ...patch });
      projectViewState(state, initialState);
      return initialState;
    }
    const session = synchronizeSession();
    const next = hasProjectedValueChange(session, patch)
      ? sessions.update(session.sessionId, () => patch, {
        invalidateComputation: Boolean(patch.layoutPolicy || patch.overrides)
      }) : session;
    project(next);
    return next;
  }

  function synchronizeSession() {
    const { documentId, unitId } = context();
    if (!documentId || !unitId) throw new Error("Legacy view command requires an open document and module");
    const current = sessions.get("single:primary");
    if (!current || current.documentId !== documentId || current.unitId !== unitId) {
      if (current) sessions.close(current.sessionId);
      const initial = snapshotNavigationImport(current ? {} : state);
      pendingNavigation = currentGraph() ? null : initial;
      const viewState = current ? initialViewState({ layoutPolicy: initialState.layoutPolicy,
        presentationPolicy: initialState.presentationPolicy }) : initialState;
      const session = sessions.create({ sessionId: "single:primary", documentId, domainId: "netlist", unitId,
        ...viewState, ...initialQuery, ...resolveNavigationImport(initial, context(), currentGraph()) });
      project(session);
      return session;
    }
    return current;
  }

  function importNavigation(value = {}) {
    const current = synchronizeSession();
    const snapshot = snapshotNavigationImport(value);
    const graph = currentGraph();
    const patch = { ...(Object.hasOwn(value, "showPath") ? { showPath: value.showPath } : {}), ...resolveNavigationImport(snapshot, context(), graph), ...importViewQuery(value, readQuery()),
      ...importViewState(value, current) };
    const next = sessions.update(current.sessionId, () => patch);
    pendingNavigation = graph ? null : snapshot;
    project(next, graph);
    return next;
  }

  function refreshNavigation() {
    const current = synchronizeSession();
    const graph = currentGraph();
    if (!pendingNavigation || !graph) { project(current, graph); return current; }
    const next = sessions.update(current.sessionId,
      () => resolveNavigationImport(pendingNavigation, context(), graph), { invalidateComputation: false });
    pendingNavigation = null;
    project(next, graph);
    return next;
  }

  return Object.freeze({
    setShowPath(showPath) {
      const s = synchronizeSession();
      project(sessions.update(s.sessionId, () => ({ showPath,
        ...(showPath?.enabled && s.viewMode === "search-first" ? { viewMode: "whole" } : {}) })));
    },
    sessions, importNavigation, refreshNavigation, importQuery, readQuery, readState, importState,
    isWorkspaceReady: () => Boolean(state.graph && state.singleWorkspaceIdentity),
    resetNavigation() {
      initialQuery = normalizeViewQuery({ ...readQuery(), viewMode: "whole" });
      const previous = readState();
      initialState = initialViewState({ layoutPolicy: previous.layoutPolicy, presentationPolicy: previous.presentationPolicy });
      sessions.close("single:primary");
      projectViewState(state, initialState);
      pendingNavigation = null;
      state.showPath = null;
      Object.assign(state, initialQuery);
      Object.assign(state, projectNavigation({ focusedRootRefs: [] }, null));
    },
    dispatch(command) {
      const synchronized = synchronizeSession();
      const result = bus.dispatch({ ...command,
        ...(command.type === "overrides.set" ? { overrides: importViewState({ overrides: command.overrides ?? null }, synchronized).overrides } : {}),
        sessionId: "single:primary" });
      if (command.type.startsWith("focus.") || command.type === "unit.set" || command.type === "selection.reveal") {
        if (!result.rejected) pendingNavigation = null;
      } else if (pendingNavigation && command.type.startsWith("selection.")) {
        pendingNavigation = snapshotNavigationImport({ ...pendingNavigation,
          selectedNodeId: null, selectedNet: null, selectedObjectRef: result.session.selectedObjectRef });
      }
      const graph = result.session.unitId === synchronized.unitId ? currentGraph() : null;
      project(result.session, graph);
      return result;
    },
    beginComputation() {
      const current = refreshNavigation();
      return sessions.update(current.sessionId, () => ({}));
    },
    objectRefForNode(node) {
      return nodeToRef(node, getDocumentId(), state.currentModule?.name);
    },
    objectRefForNet(netName) {
      return valueToRef("net", netName, getDocumentId(), state.currentModule?.name, state.occurrenceContext?.occurrencePath);
    },
    visibleObjectKeys() {
      const documentId = getDocumentId();
      const unitId = state.currentModule?.name;
      const nodeKeys = (state.graph?.nodes || []).map((node) => objectRefKey(nodeToRef(node, documentId, unitId)));
      const netKeys = [...new Set((state.graph?.edges || []).map((edge) => edge.net).filter(Boolean))]
        .map((net) => objectRefKey(valueToRef("net", net, documentId, unitId)));
      return [...nodeKeys, ...netKeys];
    }
  });
}

function valueToRef(kind, localId, documentId, unitId, occurrencePath = null) {
  if (!kind || !localId || !documentId || !unitId) return null;
  return createObjectRef({ documentId, unitId, kind, localId, occurrencePath });
}

function nodeToRef(node, documentId, unitId) {
  return graphNodeToObjectRef(node, { documentId, unitId });
}
