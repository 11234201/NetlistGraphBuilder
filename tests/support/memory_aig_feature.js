import { createDocumentEnvelope } from "../../src/contracts/document.js";
import { defineDomainFeature } from "../../src/contracts/domain_feature.js";
import { createObjectRef } from "../../src/contracts/object_ref.js";
import { createDiagramGraph } from "../../src/contracts/diagram.js";
import { createSvgScene, SVG_SCENE_CONTRACT, svgElement, svgText } from "../../src/render/svg_scene_renderer.js";

export const MEMORY_AIG_DOMAIN_ID = "memory-aig";

export function createMemoryAigModel() {
  const nodes = Object.freeze([
    node("a", "input"), node("b", "input"), node("const0", "constant"),
    node("and0", "and"), node("and1", "and"), node("latch0", "latch"), node("y", "output")
  ]);
  return Object.freeze({
    sourceMap: Object.freeze(Object.fromEntries(nodes.map((item, index) => [
      item.id,
      Object.freeze({ sourceName: "memory-aig", record: index + 1 })
    ]))),
    units: Object.freeze([Object.freeze({
      id: "top",
      nodes,
      edges: Object.freeze([
        edge("e0", "a", "and0", 0), edge("e1", "b", "and0", 1, true),
        edge("e2", "and0", "and1", 0), edge("e3", "and0", "and1", 1),
        edge("e4", "and1", "latch0", 0), edge("e5", "latch0", "y", 0, true),
        edge("e6", "const0", "and1", 1)
      ])
    })])
  });
}

export const memoryAigFeature = defineDomainFeature({
  id: MEMORY_AIG_DOMAIN_ID,
  inputFormats: [],
  capabilities: { focused: true, compare: true, timing: false, cellConfig: false },
  importSource(input, context = {}) {
    return createDocumentEnvelope({
      documentId: context.documentId || "aig:memory",
      domainId: MEMORY_AIG_DOMAIN_ID,
      sourceRevision: context.sourceRevision || 1,
      source: { kind: "memory", name: input?.name || "memory-aig" },
      model: input?.model || createMemoryAigModel(),
      diagnostics: []
    });
  },
  listUnits(document) {
    return document.model.units.map((unit) => ({ id: unit.id, label: unit.id, objectRef: ref(document, unit.id, "unit", unit.id) }));
  },
  buildSearchIndex(document) {
    return document.model.units.flatMap((unit) => unit.nodes.map((item) => ({
      label: item.id,
      kind: item.kind,
      unitId: unit.id,
      objectRef: ref(document, unit.id, item.kind, item.id)
    })));
  },
  search(index, query, limit = 20) {
    const needle = String(query || "").toLowerCase();
    return index.filter((item) => item.label.toLowerCase().includes(needle)).slice(0, limit);
  },
  queryView(document, query) {
    const unit = document.model.units.find((item) => item.id === query.unitId);
    if (!unit) throw new Error(`Unknown AIG unit: ${query.unitId}`);
    const rootIds = new Set(query.rootNodeIds || []);
    const visibleIds = query.mode === "focused" ? collectNeighborhood(unit, rootIds) : new Set(unit.nodes.map((item) => item.id));
    return {
      unit,
      nodes: unit.nodes.filter((item) => visibleIds.has(item.id)),
      edges: unit.edges.filter((item) => visibleIds.has(item.source) && visibleIds.has(item.target)),
      projectionMap: new Map(unit.nodes
        .filter((item) => visibleIds.has(item.id))
        .map((item) => [item.id, ref(document, unit.id, item.kind, item.id)]))
    };
  },
  projectDiagram(result) {
    return createDiagramGraph({
      id: `aig-diagram:${result.unit.id}`,
      domainId: MEMORY_AIG_DOMAIN_ID,
      unitId: result.unit.id,
      moduleDisplayName: result.unit.id,
      projectionMap: result.projectionMap,
      nodes: result.nodes.map(projectNode),
      edges: result.edges.map((item) => ({
        ...item,
        sourcePin: "out",
        targetPin: `in${item.slot}`,
        net: item.id,
        label: item.inverted ? "!" : ""
      }))
    });
  }
});

export function createMemoryAigScene(graph) {
  return createSvgScene({
    kind: SVG_SCENE_CONTRACT,
    bounds: { width: graph.width, height: graph.height },
    ariaLabel: "AIG scene",
    objectRefs: graph.projectionMap,
    edgeCount: graph.edges.length,
    nodeCount: graph.nodes.length,
    readEdges: (start, end) => graph.edges.slice(start, end).map(aigEdgePrimitive),
    readNodes: (start, end) => graph.nodes.slice(start, end).map(aigNodePrimitive)
  });
}

function node(id, kind) { return Object.freeze({ id, kind }); }
function edge(id, source, target, slot, inverted = false) { return Object.freeze({ id, source, target, slot, inverted }); }
function ref(document, unitId, kind, localId) {
  return createObjectRef({ documentId: document.documentId, unitId, kind, localId });
}

function collectNeighborhood(unit, roots) {
  const visible = new Set(roots);
  for (const item of unit.edges) {
    if (roots.has(item.source) || roots.has(item.target)) {
      visible.add(item.source);
      visible.add(item.target);
    }
  }
  return visible;
}

function projectNode(item) {
  const isBoundary = item.kind === "input" || item.kind === "output";
  const inputs = item.kind === "and" ? [0, 1] : item.kind === "latch" ? [0] : [];
  return {
    id: item.id,
    kind: isBoundary ? item.kind : item.kind === "constant" ? "constant" : "cell",
    label: item.id,
    title: item.kind.toUpperCase(),
    gateKind: item.kind,
    portDescriptors: [
      ...inputs.map((slot) => ({ pin: `in${slot}`, direction: "input", side: "left", order: slot })),
      ...((item.kind === "output") ? [] : [{ pin: "out", direction: "output", side: "right", order: 0 }])
    ]
  };
}

function aigEdgePrimitive(edge) {
  const d = edge.points.map((point, index) => `${index ? "L" : "M"} ${point.x} ${point.y}`).join(" ");
  return svgElement("g", { class: edge.inverted ? "aig-edge inverted" : "aig-edge", "data-edge-id": edge.id }, [
    svgElement("path", { class: "wire-hit-area", d, "pointer-events": "stroke" }),
    svgElement("path", { class: "wire", d }),
    ...(edge.inverted ? [svgElement("circle", { class: "aig-inversion", cx: edge.points.at(-1).x - 5, cy: edge.points.at(-1).y, r: 4 })] : [])
  ]);
}

function aigNodePrimitive(item) {
  return svgElement("g", { class: `node aig-${item.gateKind || item.kind}`, "data-node-id": item.id }, [
    svgElement("rect", { class: "node-shape", x: item.x, y: item.y, width: item.width, height: item.height }),
    svgElement("text", { class: "node-label", x: item.x + item.width / 2, y: item.y + item.height / 2, "text-anchor": "middle" }, [svgText(item.title || item.label)])
  ]);
}
