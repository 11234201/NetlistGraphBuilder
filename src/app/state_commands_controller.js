import { formatViewportTransform } from "../ui/viewport.js";
import { cloneGraphOverrides } from "../domains/netlist/graph_overrides.js";
import { normalizeLayoutPolicy } from "../layout/layoutPolicy.js";
import { normalizeSingleViewMode } from "./singleViewMode.js";
import { focusedNetName } from "./focusedSelection.js";

// Legacy workbench adapter. State and elements are restricted ports supplied
// by the composition root; peer actions are explicit, late-bound services.
export function createStateCommandsController({ state, elements, services }) {
  function applyTransform(shouldPersist = true) {
    const content = elements.mount.querySelector(".schematic-content");
    if (!content) {
      return;
    }
    const { x, y, scale } = state.transform;
    content.setAttribute("transform", formatViewportTransform({ x, y, scale }));
    elements.canvas.classList.toggle("is-low-detail", scale < 0.65);
    if (shouldPersist) services.persistSession();
  }

  function setSingleTransform(transform) {
    if (!state.document?.documentId || !state.currentModule?.name) {
      return services.singleViewSession.importState({ viewport: transform }).viewport;
    }
    return services.singleViewSession.dispatch({
      type: "viewport.set",
      viewport: transform
    }).session.viewport;
  }

  function setSingleLayoutPolicy(layoutPolicy) {
    const normalized = normalizeLayoutPolicy(layoutPolicy);
    if (!state.document?.documentId || !state.currentModule?.name) {
      return services.singleViewSession.importState({ layoutPolicy: normalized }).layoutPolicy;
    }
    services.singleViewSession.dispatch({ type: "layout.policy.set", layoutPolicy: normalized });
    return state.layoutPolicy;
  }

  function setSingleViewMode(viewMode) {
    const normalized = normalizeSingleViewMode(viewMode);
    if (!state.document?.documentId || !state.currentModule?.name) {
      services.singleViewSession.importQuery({ viewMode: normalized });
      services.recordViewHistory();
      return { rejected: null };
    }
    const result = services.singleViewSession.dispatch({ type: "view.mode.set", viewMode: normalized });
    services.recordViewHistory();
    return result;
  }

  function setSingleFocusedDepths(faninDepth, fanoutDepth) {
    if (!state.document?.documentId || !state.currentModule?.name) {
      services.singleViewSession.importQuery({ faninDepth, fanoutDepth });
      services.recordViewHistory();
      return null;
    }
    const result = services.singleViewSession.dispatch({ type: "view.depths.set", faninDepth, fanoutDepth });
    services.recordViewHistory();
    return result;
  }

  function replaceSingleFocusedRoots(nodeIds, activeNodeId = null) {
    if (!state.document?.documentId || !state.currentModule?.name) {
      services.recordViewHistory();
      return null;
    }
    const roots = (nodeIds || []).map((nodeId) => {
      const netName = focusedNetName(nodeId);
      if (netName) return { nodeId, objectRef: services.singleViewSession.objectRefForNet(netName) };
      const node = state.fullGraph?.nodes.find((item) => item.id === nodeId);
      return node ? { nodeId, objectRef: services.singleViewSession.objectRefForNode(node) } : null;
    }).filter((item) => item?.objectRef);
    const activeObjectRef = roots.find((item) => item.nodeId === activeNodeId)?.objectRef
      || roots[0]?.objectRef
      || null;
    const result = services.singleViewSession.dispatch({
      type: "focus.replace",
      objectRefs: roots.map((item) => item.objectRef),
      activeObjectRef
    });
    services.recordViewHistory();
    return result;
  }

  function setSingleOverrides(overrides) {
    if (!state.document?.documentId || !state.currentModule?.name) {
      services.singleViewSession.importState({ overrides: overrides || null });
      services.recordViewHistory();
      return;
    }
    services.singleViewSession.dispatch({ type: "overrides.set", overrides });
    services.recordViewHistory();
  }

  function updateSingleOverrides(update) {
    const current = services.singleViewSession.readState().overrides;
    const overrides = {
      nodePositions: new Map(current?.nodePositions || []),
      nodeSizes: new Map(current?.nodeSizes || []),
      graphOverrides: cloneGraphOverrides(current?.graphOverrides)
    };
    update(overrides);
    setSingleOverrides(overrides);
  }

  function setCompareOverrides(side, overrides) {
    services.compareViewSessions.dispatch(side, { type: "overrides.set", overrides });
    // A Compare-side move/resize is one user operation; capture both side state
    // and the owning side override after the command has committed.
    services.recordViewHistory({
      label: "Layout override",
      affectedSessionIds: [`compare:${side}`]
    });
  }

  function updateCompareOverrides(side, update) {
    const current = services.compareViewSessions.readState(side).overrides;
    const overrides = {
      nodePositions: new Map(current?.nodePositions || []),
      nodeSizes: new Map(current?.nodeSizes || []),
      graphOverrides: cloneGraphOverrides(current?.graphOverrides)
    };
    update(overrides);
    setCompareOverrides(side, overrides);
  }

  return Object.freeze({ applyTransform, setSingleTransform, setSingleLayoutPolicy, setSingleViewMode, setSingleFocusedDepths, replaceSingleFocusedRoots, setSingleOverrides, updateSingleOverrides, setCompareOverrides, updateCompareOverrides });
}

export const stateCommandsPorts = Object.freeze({
  state: [
    "activeFocusedRootNodeId", "compare", "coneRootNodeId", "currentModule", "document",
    "faninDepth", "fanoutDepth", "focusedRootNodeIds", "fullGraph", "graphOverrides",
    "layoutPolicy", "nodePositions", "nodeSizes", "transform", "viewMode"
  ],
  elements: [
    "canvas", "mount"
  ],
  services: [
    "compareViewSessions", "persistSession", "recordViewHistory", "singleViewSession"
  ]
});
