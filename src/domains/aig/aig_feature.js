import { defineDomainFeature } from "../../contracts/domain_feature.js";
import { createDocumentEnvelope } from "../../contracts/document.js";
import { importAigSource } from "./aig_import.js";
import { queryAigView, restoreAigFocus } from "./aig_view_query.js";
import { buildAigSearchIndex, searchAigIndex, createAigQuery } from "./aig_query.js";
import { projectAigDot, AIG_DISPLAY_VERSION, AIG_FONT } from "./aig_projection.js";
import { createAigScene } from "./aig_scene.js";
import { normalizeAigPresentation, aigNodeStyle, aigEdgeStyle } from "./aig_presentation.js";
import { graphvizJsonToGeometry } from "../../layout/graphviz_geometry.js";
import { describeAigSelection, AIG_NEIGHBOR_COLORS } from "./selection_highlights.js";
import { createAigStructureRuntime } from "./structure_runtime.js";
import { createStructureQuery } from "./structure_query.js";
import { createStructurePresentation } from "./structure_presentation.js";

const cache = new Map();
const MAX_CACHE_NODES = 20000;
let cacheNodes = 0;

export const aigFeature = defineDomainFeature({
  id: "aig",
  inputFormats: [{ id: "abc-dot", extensions: [".dot"] }, { id: "blif", extensions: [".blif"] }],
  capabilities: { focused: true, compare: false, timing: false, cellConfig: false, adjust: false,
    geometry: "curves", exportSvg: true, whole: true },
  panels: [{ id: "aig-navigator" }, { id: "aig-inspector" }],
  layoutProfiles: [{ id: "graphviz", label: "Graphviz", geometry: "curves" }],
  importSource(input, context = {}) {
    const imported = importAigSource(input.text, { name: input.name, format: input.format });
    return createDocumentEnvelope({ domainId: "aig", documentId: context.documentId || "document:aig",
      sourceRevision: context.sourceRevision || 1, source: { name: input.name, kind: "text", size: input.text.length }, model: imported });
  },
  listUnits: (document) => [{ id: "whole", label: document.model.name }],
  buildSearchIndex: (document) => buildAigSearchIndex(document.model.model),
  search: searchAigIndex,
  queryView: queryAigView,
  restoreFocus: restoreAigFocus,
  projectDiagram: projectAigDiagram,
  normalizePresentation: normalizeAigPresentation,
  createWorkspaceStages({ layout, reportScope }) {
    return {
      query({ document, session }) {
        const view = queryAigView(document, session);
        const real = view.analysisModel || view.model;
        reportScope?.({ viewScopeId: view.analysisScopeLabel || "whole", visibleNodes: real.nodes.length, visibleEdges: real.edges.length });
        return view;
      },
      project: projectAigDiagram,
      measure: (diagram) => diagram,
      async layout(diagram, { document, signal }) {
        const key = JSON.stringify([document.documentId, document.sourceRevision, document.model.model.normalizationVersion,
          AIG_DISPLAY_VERSION, AIG_FONT, layout.version, diagram.dot]);
        if (signal?.aborted) throw Object.assign(new Error("AIG layout cancelled"), { name: "AbortError" });
        if (cache.has(key)) {
          const value = cache.get(key); cache.delete(key); cache.set(key, value); return value;
        }
        const json = await layout.render(diagram.dot, { signal });
        const value = graphvizJsonToGeometry(json, { nodeLabels: diagram.nodeLabels });
        if (signal?.aborted) throw Object.assign(new Error("AIG layout cancelled"), { name: "AbortError" });
        if (value.nodes.length <= MAX_CACHE_NODES) {
          while (cache.size && (cache.size >= 4 || cacheNodes + value.nodes.length > MAX_CACHE_NODES)) {
            const oldest = cache.keys().next().value; cacheNodes -= cache.get(oldest).nodes.length; cache.delete(oldest);
          }
          cache.set(key, value); cacheNodes += value.nodes.length;
        }
        return value;
      },
      applyOverrides: (geometry) => geometry,
      createScene: (geometry, { presentationPolicy }, view) => createAigScene(view.model, view.analysis, geometry, presentationPolicy)
    };
  },
  describeWorkspace(document, pipeline) {
    const index = buildAigSearchIndex(document.model.model);
    const query = createAigQuery(document.model.model, document.model.analysis);
    const view = pipeline.queryResult;
    const displayQuery = createAigQuery(view.model, view.analysis);
    return { geometry: pipeline.graph, scene: pipeline.scene, query, displayQuery, searchIndex: index,
      displayModel: view.model, displayAnalysis: view.analysis, analysisModel: view.analysisModel || view.model,
      analysisScopeId: view.analysisScopeId || "whole", analysisScopeLabel: view.analysisScopeLabel || "whole",
      visibleNodeIds: view.visibleNodeIds, visibleEdgeIds: view.visibleEdgeIds,
      truncated: view.truncated, hiddenEndpointCount: view.hiddenEndpointCount,
      search: (text, limit) => searchAigIndex(index, text, limit) };
  },
  createAnalysisService: (document, workspace) => createAigStructureRuntime(workspace?.analysisModel || document.model.model),
  queryAnalysis: createStructureQuery,
  analysisPresentation: (workspace, view, policy) => createStructurePresentation(workspace.geometry, view, policy),
  scene: (workspace, policy, selectedId, structure) => createAigScene(workspace.displayModel || workspace.document.model.model,
    workspace.displayAnalysis || workspace.document.model.analysis, workspace.geometry, policy, selectedId, structure),
  nodeStyle: (workspace, node, policy) => aigNodeStyle(node, workspace.displayAnalysis, workspace.displayQuery, policy),
  edgeStyle: (workspace, edge, policy) => aigEdgeStyle(edge, workspace.displayQuery, policy),
  selectionHighlights: (workspace, selectedId, policy) => describeAigSelection(workspace.displayQuery, selectedId, policy),
  selectionHighlightColors: AIG_NEIGHBOR_COLORS
});

function projectAigDiagram(imported, { presentationPolicy } = {}) {
  return { dot: projectAigDot(imported.model, presentationPolicy),
    nodeLabels: new Map(imported.model.nodes.map((node) => [node.id, node.label])) };
}
