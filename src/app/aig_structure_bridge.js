import { createWorkspaceAnalysis } from "../application/workspace_analysis.js";
import { createAigStructureCanvas } from "../ui/aig_structure_canvas.js";
import { serializeSvgPrimitive } from "../render/svg_scene_renderer.js";
import { revealAigStructureSelection } from "../ui/aig_structure_panels.js";

export function createAigStructureBridge({ jobs, logProcess, mount, readWorkspace, readPanelState, readPolicy, renderPanels, persist, focus, onSelectionChange = () => {}, isAnalysisVisible = () => true }) {
  let query = null, lastData = null, attaching = false;
  const canvas = createAigStructureCanvas({ mount, serialize: serializeSvgPrimitive,
    readBaseEdgeStyle(id) {
      const workspace = readWorkspace();
      return workspace.feature.edgeStyle(workspace, (workspace.displayQuery || workspace.query).edgeById.get(id), readPolicy());
    } });
  const analysis = createWorkspaceAnalysis({ jobs, logProcess, schedule: (callback) => requestAnimationFrame(() => setTimeout(callback, 0)), onChange(state) {
    const workspace = readWorkspace();
    if (!workspace) return;
    if (state.data !== lastData) { lastData = state.data; query = workspace.feature.queryAnalysis?.(state.data); }
    const panel = readPanelState();
    if (state.data && ["complete", "partial"].includes(state.status) && panel.selectedId && !query?.get(panel.selectedId)) panel.selectedId = null;
    refresh(); onSelectionChange();
    if (!attaching && isAnalysisVisible()) renderPanels();
    if (query?.get(panel.selectedId)?.category === "reconvergence" && state.detailStatus === "idle" && ["complete", "partial"].includes(state.status)) requestDetail();
  } });
  function view() { return { ...analysis.read(), query, ...readPanelState() }; }
  function refresh() {
    const workspace = readWorkspace();
    if (workspace?.feature.analysisPresentation) canvas.update(workspace.feature.analysisPresentation(workspace, view(), readPolicy()));
  }
  function requestDetail() { const result = query?.get(readPanelState().selectedId); if (result?.category === "reconvergence") analysis.detail(result); }
  function choose(id) {
    const result = query?.get(id);
    if (!result) return;
    Object.assign(readPanelState(), revealAigStructureSelection(query, readPanelState(), id));
    if (result.category === "reconvergence") requestDetail(); else analysis.detail(null);
    refresh(); renderPanels(); persist();
  }
  function locate() {
    const selected = query?.get(readPanelState().selectedId), workspace = readWorkspace();
    if (!selected || !workspace) return false;
    const presentation = workspace.feature.analysisPresentation(workspace, view(), readPolicy());
    let x = Infinity, y = Infinity, right = -Infinity, bottom = -Infinity;
    for (const id of presentation.nodeRoles.keys()) {
      const node = workspace.positionedNodes.get(id);
      if (!node) continue;
      x = Math.min(x, node.x); y = Math.min(y, node.y);
      right = Math.max(right, node.x + node.width); bottom = Math.max(bottom, node.y + node.height);
    }
    if (!Number.isFinite(x)) return false;
    focus({ x, y, width: right - x, height: bottom - y });
    return true;
  }
  return Object.freeze({ view, refresh, choose, locate,
    attach(workspace, elements) {
      canvas.bind(elements, workspace.positionedNodes);
      attaching = true;
      try { analysis.bind(workspace); refresh(); } finally { attaching = false; }
    },
    clearSelection() { if (!readPanelState().selectedId) return; readPanelState().selectedId = null; analysis.detail(null); refresh(); },
    action(data) {
      if (data.aigAnalysisSelect) { choose(data.aigAnalysisSelect); return true; }
      if (data.aigAnalysisCategory) { Object.assign(readPanelState(), { category: data.aigAnalysisCategory, page: 0 }); renderPanels(); persist(); return true; }
      if (data.aigAnalysisPage !== undefined) { readPanelState().page = Math.max(0, Number(data.aigAnalysisPage) || 0); renderPanels(); persist(); return true; }
      if (data.aigAnalysisDetailPage !== undefined) { readPanelState().detailPage = Math.max(0, Number(data.aigAnalysisDetailPage) || 0); renderPanels(); persist(); return true; }
      if (data.aigAnalysisAction === "locate") locate();
      else if (data.aigAnalysisAction === "clear") { this.clearSelection(); renderPanels(); persist(); }
      else if (data.aigAnalysisAction === "cancel") analysis.cancel();
      else if (data.aigAnalysisAction === "run") analysis.run();
      else return false;
      return true;
    },
    dispose() { analysis.dispose(); canvas.dispose(); query = null; lastData = null; }
  });
}
