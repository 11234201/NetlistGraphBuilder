// A request guards every observable completion, including errors and rendering.
// It invalidates results; synchronous provider computation is not interrupted.
export function captureWorkspaceRequest(state) {
  const id = state.layoutRequestId;
  const design = state.design;
  const module = state.currentModule;
  const compare = state.compare.active;
  const left = state.compare.leftModuleName;
  const right = state.compare.rightModuleName;
  const isCurrent = () => id === state.layoutRequestId && design === state.design &&
    module === state.currentModule && compare === state.compare.active &&
    left === state.compare.leftModuleName && right === state.compare.rightModuleName;
  return {
    id,
    isCurrent,
    guard: (callback) => (...args) => isCurrent() ? callback(...args) : undefined
  };
}

export function beginWorkspaceRequest(state) {
  state.layoutRequestId += 1;
  return captureWorkspaceRequest(state);
}
