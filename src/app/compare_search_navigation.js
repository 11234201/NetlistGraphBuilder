import { runFocusedViewCommand } from "../application/focused_view_command.js";
import { resolveSearchTargetAction, findSearchTargetNode } from "./searchLocatePolicy.js";
import { createCompareSearchCandidate } from "./compare_search_candidate.js";
import { writeProcessLogSafely } from "./processLog.js";
import { errorMessage, readErrorField } from "../foundation/log_details.js";

export function createCompareSearchNavigation({ scope, readBridge, select, clearSelection, rebuild,
  commitFocus, updateControls, setStatus, logProcess, hideResults }) {
  let requestId = 0, pending;
  function navigationKey(context) {
    return JSON.stringify([context.version, context.outputName, context.syncRoots,
      context.activeSide, context.syncSelection, context.syncViewport,
      ...["left", "right"].map((side) => {
        const session = readBridge().readState(side);
        return [session.viewMode, session.focusedRootRefs, session.activeFocusedRootRef,
          session.showPath, session.selectedObjectRef, session.viewport];
      })]);
  }
  function handle(result, add = false) {
    const context = scope.snapshot();
    if (!context.active && result?.searchScope === undefined) return false;
    const id = ++requestId;
    pending?.abort(); pending = null;
    if (!scope.accepts(result, context)) {
      setStatus("Search scope changed. Search again in the applied Compare modules.");
      return true;
    }
    const { side, target } = result;
    const bridge = readBridge();
    const graph = context.graphs[side];
    const full = context.fullGraphs[side];
    if (!graph || graph.moduleName !== result.moduleName || !full) {
      setStatus("Compare is loading. Search again when the workspace is ready."); return true;
    }
    if (target.kind !== "module" && graph.path &&
        !graph.path.searchKeys.has(JSON.stringify([target.kind, target.name]))) {
      setStatus("Outside Show Path · Add as start or end to edit the query."); return true;
    }
    hideResults();
    let committed = false, settled = false;
    const isScopeCurrent = () => id === requestId && scope.accepts(result);
    let isCurrent = isScopeCurrent;
    const label = `${side === "left" ? "A" : "B"} · ${result.moduleName}`;
    const reportFailure = (error) => {
      if (settled || !isCurrent() || readErrorField(error, "name") === "AbortError") return;
      settled = true;
      // Once mounted, the render boundary owns any presentation failure.
      if (!committed) writeProcessLogSafely(logProcess, "error", "navigation", "Compare search failed", {
        operation: "search.compare.navigate", code: "search.compare.failed", error, side, requestId: id,
        documentId: context.document.documentId, documentRevision: context.document.sourceRevision,
        moduleName: result.moduleName, kind: target.kind, retainedPreviousView: true
      });
      setStatus(`Search ${label}: ${errorMessage(error)}`);
    };
    const locate = () => {
      if (!isScopeCurrent()) return;
      const current = scope.snapshot().graphs[side];
      const unrouted = target.kind === "net" && current?.unroutedNets?.includes(target.name);
      if (!unrouted && resolveSearchTargetAction(target, current) !== "locate") {
        setStatus(`Search ${label}: ${result.label} is unavailable in the current graph`); return;
      }
      select(target.kind, target.name, !unrouted, side, false);
      setStatus(unrouted ? `Search ${label}: net ${result.label} is not routed; enable Route net in Selection to restore`
        : `Search ${label}: ${result.kind} ${result.label}`);
    };
    try {
      if (target.kind === "module") {
        bridge.setActiveSide(side); clearSelection(side); updateControls();
        setStatus(`Search: ${label}`); return true;
      }
      const action = resolveSearchTargetAction(target, graph, full);
      if (!add && (action === "locate" || target.kind === "net" && graph.unroutedNets?.includes(target.name))) {
        locate(); return true;
      }
      const portInPath = target.kind === "port" && graph.path && findSearchTargetNode(target, full);
      if (action === "unavailable" && !portInPath || add && !["cell", "net"].includes(target.kind)) {
        setStatus(`Search ${label}: ${result.label} is unavailable in the current graph`); return true;
      }
      const candidate = createCompareSearchCandidate({ context, bridge, side, target });
      let expectedKey = navigationKey(context);
      const current = () => isScopeCurrent() && expectedKey === navigationKey(scope.snapshot());
      isCurrent = current;
      const controller = new AbortController(); pending = controller;
      runFocusedViewCommand({
        command: { type: "focus.add" }, dispatch: () => candidate,
        readGraph: () => scope.snapshot().graphs[side], isReady: bridge.isWorkspaceReady,
        resetViewport: () => {},
        rebuild(callbacks) {
          rebuild({ ...callbacks, focusCandidate: candidate.focusCandidate, signal: controller.signal,
            pathCurrent: current, commitPath() {
              if (!current()) return;
              candidate.commit(); commitFocus(); committed = true;
              expectedKey = navigationKey(scope.snapshot());
            }, onCommitted: callbacks.onRendered });
        },
        onRejected() {
          settled = true; if (pending === controller) pending = null;
          setStatus("Search target could not be added: Focused root limit reached");
        },
        onRendered() {
          if (!current()) return;
          if (!committed) {
            candidate.commit(); commitFocus(); committed = true;
            expectedKey = navigationKey(scope.snapshot());
          }
          locate(); settled = true; if (pending === controller) pending = null;
        },
        onCancelled() { settled = true; if (pending === controller) pending = null; },
        onFailed: reportFailure
      });
    } catch (error) { reportFailure(error); }
    return true;
  }
  return Object.freeze({ handle });
}
