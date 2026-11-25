export function readWorkbenchViewContext(state, elements, domainWorkbench) {
  return {
    readViews: () => domainWorkbench.viewport.read() || [
      { id: "single", mount: elements.mount, viewport: state.transform },
      { id: "left", mount: elements.leftMount, viewport: state.compare.transforms.left },
      { id: "right", mount: elements.rightMount, viewport: state.compare.transforms.right }
    ],
    readContext: () => ({
      compareActive: state.compare.active, selectedSide: state.compare.selectedSide,
      moduleLabel: elements.moduleHierarchyCurrent.textContent || state.currentModule?.displayName || "Workspace",
      sourceLabel: state.currentSourceLabel || "Sample", viewMode: state.graph?.view?.mode || state.viewMode,
      leftModuleName: state.compare.leftModuleName, rightModuleName: state.compare.rightModuleName,
      pathEnabled: Boolean(state.graph?.path), leftPath: Boolean(state.compare.graphs.left?.path), rightPath: Boolean(state.compare.graphs.right?.path),
      leftMode: state.compare.graphs.left?.view?.mode, rightMode: state.compare.graphs.right?.view?.mode,
      ...domainWorkbench.context()
    }),
  };
}
