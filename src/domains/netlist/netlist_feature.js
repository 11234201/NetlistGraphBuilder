import { applyWorkspaceGraphTransforms, buildWorkspaceGraph, selectWorkspaceGraphView } from "../../app/graphWorkspace.js";
import { createDocumentEnvelope, normalizeSourceInput } from "../../contracts/document.js";
import { defineDomainFeature } from "../../contracts/domain_feature.js";
import { createObjectRef } from "../../contracts/object_ref.js";
import { createViewQuery } from "../../contracts/view_query.js";
import { parseVerilog } from "../../parser/verilogParser.js";
import { buildDesignSearchIndex, searchDesignIndex } from "../../search/designSearch.js";

export const NETLIST_DOMAIN_ID = "netlist";
export const NETLIST_LEGACY_DIAGRAM_CONTRACT = "netlist-schematic-graph.v1";

export const netlistFeature = defineDomainFeature({
  id: NETLIST_DOMAIN_ID,
  inputFormats: [
    Object.freeze({ id: "structural-verilog", extensions: Object.freeze([".v", ".sv"]), sourceKinds: Object.freeze(["text"]) })
  ],
  capabilities: {
    focused: true,
    compare: true,
    timing: true,
    cellConfig: true,
    diagramContract: NETLIST_LEGACY_DIAGRAM_CONTRACT
  },

  importSource(input, context = {}) {
    const source = normalizeSourceInput(input);
    if (source.kind !== "text") throw new Error("Structural Verilog input must be text");
    const model = parseVerilog(source.text);
    if (model.modules.length === 0) throw new Error("No module declarations found");
    const documentId = context.documentId || `netlist:${encodeURIComponent(source.name)}`;
    return createDocumentEnvelope({
      documentId,
      domainId: NETLIST_DOMAIN_ID,
      sourceRevision: context.sourceRevision || 1,
      source: { ...source, size: source.text.length },
      model,
      diagnostics: model.diagnostics
    });
  },

  listUnits(document) {
    assertNetlistDocument(document);
    return document.model.modules.map((module) => Object.freeze({
      id: module.name,
      label: module.displayName || module.name,
      objectRef: createObjectRef({
        documentId: document.documentId,
        unitId: module.name,
        kind: "module",
        localId: module.name
      })
    }));
  },

  buildSearchIndex(document) {
    assertNetlistDocument(document);
    return buildDesignSearchIndex(document.model).map((entry) => Object.freeze({
      ...entry,
      objectRef: searchEntryObjectRef(document.documentId, entry)
    }));
  },

  search(index, query, limit) {
    return searchDesignIndex(index, query, limit);
  },

  queryView(document, query = {}, options = {}) {
    assertNetlistDocument(document);
    const normalizedQuery = createViewQuery(query);
    const module = document.model.modules.find((item) => item.name === normalizedQuery.unitId);
    if (!module) throw new Error(`Unknown netlist module: ${normalizedQuery.unitId}`);
    const fullGraph = buildWorkspaceGraph(module, {
      moduleLibrary: document.model.modules,
      graphOverrides: options.graphOverrides,
      cellConfig: options.cellConfig,
      timing: options.timing,
      timingDisplayPolicy: options.timingDisplayPolicy,
      timingBadgeChoices: options.timingBadgeChoices,
      timingBadgePositions: options.timingBadgePositions,
      showAliases: options.showAliases
    });
    const visibleGraph = selectWorkspaceGraphView(fullGraph, {
      viewMode: normalizedQuery.mode,
      rootNodeIds: normalizedQuery.rootNodeIds,
      activeRootNodeId: normalizedQuery.activeRootNodeId,
      rootNodeId: normalizedQuery.rootNodeId,
      faninDepth: normalizedQuery.faninDepth,
      fanoutDepth: normalizedQuery.fanoutDepth,
      maxDepth: normalizedQuery.maxDepth
    });
    return {
      fullGraph,
      visibleGraph: applyWorkspaceGraphTransforms(visibleGraph, options.transforms),
      projectionMap: createProjectionMap(document.documentId, module.name, fullGraph)
    };
  },

  projectDiagram(queryResult) {
    if (!queryResult?.visibleGraph) throw new Error("Netlist query result requires visibleGraph");
    return {
      contract: NETLIST_LEGACY_DIAGRAM_CONTRACT,
      graph: queryResult.visibleGraph,
      projectionMap: queryResult.projectionMap
    };
  }
});

function searchEntryObjectRef(documentId, entry) {
  const target = entry.target || {};
  return createObjectRef({
    documentId,
    unitId: entry.moduleName,
    kind: target.kind || entry.kind,
    localId: target.name || entry.moduleName
  });
}

function createProjectionMap(documentId, unitId, graph) {
  return new Map(graph.nodes.map((node) => [node.id, createObjectRef({
    documentId,
    unitId,
    kind: node.kind === "cell" ? "cell" : node.kind,
    localId: node.ref?.instance || node.ref?.name || node.id
  })]));
}

function assertNetlistDocument(document) {
  if (document?.domainId !== NETLIST_DOMAIN_ID || !Array.isArray(document?.model?.modules)) {
    throw new Error("A netlist document is required");
  }
}
