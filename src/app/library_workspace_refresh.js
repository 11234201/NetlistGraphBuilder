// A narrow adapter for the existing workspace lifecycle, with no owned UI state.
export function createLibraryWorkspaceRefresh({ readContext, cancelJobs, renderSingle, renderCompare }) {
  return () => {
    const context = readContext();
    cancelJobs();
    if (context.compareActive) return new Promise((resolve, reject) => renderCompare({
      onCommitted: resolve, onFailed: reject, onCancelled: () => reject(cancelled())
    }));
    if (context.hasModule) return new Promise((resolve, reject) => renderSingle(context.selectedNodeId, {
      onRendered: resolve, onFailed: reject, onCancelled: () => reject(cancelled())
    }));
    return Promise.resolve();
  };
}

function cancelled() { const error = new Error("Library workspace refresh cancelled"); error.name = "AbortError"; return error; }
