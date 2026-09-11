import { segmentsConflict } from "../layout/orthogonalRouting.js";
import { getEdgeRouteSegments } from "../layout/routeSegmentIndex.js";
import { RouteSegmentIndex } from "../layout/spatialIndex.js";
import {
  createProgressiveSvgSceneRenderPlan,
  createSvgScene,
  renderSvgScene,
  SVG_SCENE_CONTRACT,
  svgElement,
  svgText
} from "./svg_scene_renderer.js";

const MAX_WIRE_BRIDGES = 2000;

export function renderSchematicSvg(graph, options = {}) {
  return renderSvgScene(createSchematicScene(graph, options));
}

export function createSchematicRenderPlan(graph, options = {}) {
  const progressive = createProgressiveSchematicRenderPlan(graph, options);
  return {
    edges: progressive.renderEdges(0, progressive.edgeCount),
    nodes: progressive.renderNodes(0, progressive.nodeCount),
    openSvg: progressive.openSvg,
    betweenGroups: progressive.betweenGroups,
    closeSvg: progressive.closeSvg
  };
}

export function createProgressiveSchematicRenderPlan(graph, options = {}) {
  return createProgressiveSvgSceneRenderPlan(createSchematicScene(graph, options));
}

export function createSchematicScene(graph, options = {}) {
  if (typeof options.createNodePrimitive !== "function") {
    throw new Error("Schematic scene requires a node presentation");
  }
  const wireItems = createWireRenderItems(graph);
  const crossingByEdge = options.wireBridges === false ? new Map() : findWireCrossings(wireItems);
  return createSvgScene({
    kind: SVG_SCENE_CONTRACT,
    bounds: { width: graph.width || 640, height: graph.height || 420 },
    ariaLabel: `${String(graph.moduleDisplayName || "Diagram")} schematic`,
    edgeCount: wireItems.length,
    nodeCount: graph.nodes.length,
    readEdges: (start, end) => renderRange(wireItems, start, end, (edge) =>
      createEdgePrimitive(edge, crossingByEdge.get(edge.id) || [])),
    readNodes: (start, end) => renderRange(graph.nodes, start, end, options.createNodePrimitive)
  });
}

function createWireRenderItems(graph) {
  if (!Array.isArray(graph.wireRoutes) || graph.wireRoutes.length === 0) return graph.edges || [];
  return graph.wireRoutes.flatMap((route) => (route.segments || []).map((segment, index) => ({
    id: segment.id || `${route.id}:${index}`,
    points: [segment.start, segment.end],
    net: route.net,
    label: index === 0 ? route.label : "",
    labelPoint: route.labelPoint || midpoint(segment.start, segment.end),
    labelAnchor: route.labelAnchor || "middle",
    showLabel: index === 0 && route.showLabel !== false,
    logicalEdgeIds: route.logicalEdgeIds || segment.logicalEdgeIds || [],
    routeId: route.id,
    junctions: index === 0 ? route.junctions || [] : []
  })));
}

function renderRange(items, start, end, renderItem) {
  const first = Math.max(0, Math.floor(Number(start) || 0));
  const last = Math.min(items.length, Math.max(first, Math.floor(Number(end) || 0)));
  const rendered = [];
  for (let index = first; index < last; index += 1) rendered.push(renderItem(items[index]));
  return rendered;
}

function createEdgePrimitive(edge, crossings) {
  const path = edge.points
    .map((point, index) => `${index === 0 ? "M" : "L"} ${round(point.x)} ${round(point.y)}`)
    .join(" ");
  const logicalEdgeIds = edge.logicalEdgeIds || [edge.id];
  const children = [
    svgElement("path", { class: "wire-hit-area", d: path, "pointer-events": "stroke" }),
    svgElement("path", { class: "wire", d: path }),
    ...crossings.flatMap(createWireBridgePrimitives),
    ...(edge.junctions || []).map((point) => svgElement("circle", {
      class: "wire-junction", cx: round(point.x), cy: round(point.y), r: 2.8
    }))
  ];
  if (edge.showLabel !== false) {
    children.push(svgElement("text", {
      class: "wire-label",
      x: round(edge.labelPoint.x),
      y: round(edge.labelPoint.y),
      "text-anchor": edge.labelAnchor || "start"
    }, [svgText(edge.label)]));
  }
  return svgElement("g", {
    class: "edge",
    "data-edge-id": logicalEdgeIds[0] || edge.id,
    "data-edge-ids": logicalEdgeIds.join(","),
    "data-wire-route-id": edge.routeId || "",
    "data-net": edge.net
  }, children);
}

function midpoint(start, end) {
  return {
    x: (Number(start?.x) + Number(end?.x)) / 2,
    y: (Number(start?.y) + Number(end?.y)) / 2 - 6
  };
}

function createWireBridgePrimitives(crossing) {
  const radius = 5;
  const x = round(crossing.x);
  const y = round(crossing.y);
  const d = `M ${x - radius} ${y} Q ${x} ${y - radius} ${x + radius} ${y}`;
  return [
    svgElement("path", { class: "wire-bridge-cutout", d }),
    svgElement("path", { class: "wire-bridge", d })
  ];
}

function findWireCrossings(edges) {
  const crossings = new Map();
  const segmentIndex = new RouteSegmentIndex();
  let bridgeCount = 0;
  for (const edge of edges) {
    for (const segment of getEdgeRouteSegments(edge)) {
      if (!segment.orientation) continue;
      for (const existing of segmentIndex.querySegment(segment)) {
        if (existing.orientation === segment.orientation || existing.edgeId === edge.id || existing.net === edge.net || !segmentsConflict(existing, segment)) continue;
        const horizontal = segment.orientation === "horizontal" ? segment : existing;
        const vertical = segment.orientation === "vertical" ? segment : existing;
        addCrossing(crossings, horizontal.edgeId, { x: vertical.start.x, y: horizontal.start.y });
        bridgeCount += 1;
        if (bridgeCount > MAX_WIRE_BRIDGES) return new Map();
      }
      segmentIndex.push(segment);
    }
  }
  return crossings;
}

function addCrossing(crossings, edgeId, crossing) {
  if (!crossings.has(edgeId)) crossings.set(edgeId, []);
  crossings.get(edgeId).push(crossing);
}

function round(value) {
  return Math.round(value * 10) / 10;
}
