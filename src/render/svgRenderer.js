import { getLeafDisplayName } from "../layout/nodeGeometry.js";
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
  const wireItems = createWireRenderItems(graph);
  const crossingByEdge = options.wireBridges === false
    ? new Map()
    : findWireCrossings(wireItems);
  return createSvgScene({
    kind: SVG_SCENE_CONTRACT,
    bounds: { width: graph.width || 640, height: graph.height || 420 },
    ariaLabel: `${escapeAttr(graph.moduleDisplayName)} schematic`,
    edgeCount: wireItems.length,
    nodeCount: graph.nodes.length,
    readEdges(start, end) {
      return renderRange(wireItems, start, end, (edge) =>
        renderEdge(edge, crossingByEdge.get(edge.id) || []));
    },
    readNodes(start, end) {
      return renderRange(graph.nodes, start, end, options.createNodePrimitive || renderNode);
    }
  });
}

function createWireRenderItems(graph) {
  if (!Array.isArray(graph.wireRoutes) || graph.wireRoutes.length === 0) {
    return graph.edges || [];
  }
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
  for (let index = first; index < last; index += 1) {
    rendered.push(renderItem(items[index]));
  }
  return rendered;
}

function renderEdge(edge, crossings) {
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

function renderNode(node) {
  if (node.kind === "input" || node.kind === "focus-input") {
    return renderPortNode(node, node.kind);
  }
  if (node.kind === "output" || node.kind === "focus-output") {
    return renderPortNode(node, node.kind);
  }
  if (node.kind === "implicit" || node.kind === "constant") {
    return renderSimpleNode(node, node.kind);
  }
  if (node.kind === "hub") {
    return renderHubNode(node);
  }
  return renderGateNode(node);
}

function renderHubNode(node) {
  const cx = round(node.x + node.width / 2);
  const cy = round(node.y + node.height / 2);
  return svgElement("g", nodeAttributes(node, "node hub"), [
    svgElement("title", {}, [svgText(`Fanout: ${node.label}`)]),
    svgElement("circle", { class: "node-shape", cx, cy, r: 5 })
  ]);
}

function findWireCrossings(edges) {
  const crossings = new Map();
  const segmentIndex = new RouteSegmentIndex();
  let bridgeCount = 0;

  for (const edge of edges) {
    for (const edgeSegment of getEdgeRouteSegments(edge)) {
      const { orientation } = edgeSegment;
      if (!orientation) continue;
      const segment = edgeSegment;
      for (const existing of segmentIndex.querySegment(segment)) {
        if (
          existing.orientation === orientation ||
          existing.edgeId === edge.id ||
          existing.net === edge.net ||
          !segmentsConflict(existing, segment)
        ) continue;
        const horizontal = orientation === "horizontal" ? segment : existing;
        const vertical = orientation === "vertical" ? segment : existing;
        addCrossing(crossings, horizontal.edgeId, {
          x: vertical.start.x,
          y: horizontal.start.y
        });
        bridgeCount += 1;
        // Beyond this point bridges stop conveying useful information. Returning
        // none avoids both a dense SVG and a data-dependent render-time cliff.
        if (bridgeCount > MAX_WIRE_BRIDGES) return new Map();
      }
      segmentIndex.push(segment);
    }
  }

  return crossings;
}

function addCrossing(crossings, edgeId, crossing) {
  if (!crossings.has(edgeId)) {
    crossings.set(edgeId, []);
  }
  crossings.get(edgeId).push(crossing);
}

function renderPortNode(node, portKind) {
  const x = round(node.x);
  const y = round(node.y);
  const width = round(node.width);
  const height = round(node.height);
  const isInputPort = portKind === "input" || portKind === "focus-input";
  const points =
    isInputPort
      ? `${x},${y} ${x + width - 14},${y} ${x + width},${y + height / 2} ${x + width - 14},${y + height} ${x},${y + height}`
      : `${x + 14},${y} ${x + width},${y} ${x + width},${y + height} ${x + 14},${y + height} ${x},${y + height / 2}`;

  const timingMetrics = node.timing?.metrics || (node.timing ? {
    at: node.timing.at,
    rt: node.timing.rt,
    slack: node.timing.slack
  } : null);
  const timingTitle = timingMetrics
    ? svgElement("title", {}, [svgText(`${node.label}: ${Object.entries(timingMetrics)
      .filter(([, value]) => Number.isFinite(value))
      .map(([name, value]) => `${name} ${formatTimingValue(value)}`).join(", ")}`)])
    : null;
  const timingClass = node.timing
    ? (node.timing.slack < 0 ? " timing-critical" : " timing-annotated") : "";
  const boundaryTitle = node.boundaryDirection
    ? svgElement("title", {}, [svgText(`${node.title || "Focused boundary"}: ${node.label}; hidden endpoint(s): ${node.hiddenEndpointCount || 0}`)])
    : null;
  return svgElement("g", nodeAttributes(node, `node ${portKind}${timingClass}`), [
    boundaryTitle,
    timingTitle,
    svgElement("polygon", { class: "node-shape", points }),
    svgElement("text", {
      class: "node-label", x: x + width / 2, y: y + height / 2 + 4, "text-anchor": "middle"
    }, [svgText(getLeafDisplayName(node.label))])
  ].filter(Boolean));
}

function renderSimpleNode(node, className) {
  const x = round(node.x);
  const y = round(node.y);
  const width = round(node.width);
  const height = round(node.height);

  return svgElement("g", nodeAttributes(node, `node ${className}`), [
    svgElement("rect", { class: "node-shape", x, y, width, height }),
    svgElement("text", {
      class: "node-label", x: x + width / 2, y: y + height / 2 + 4, "text-anchor": "middle"
    }, [svgText(getLeafDisplayName(node.label))])
  ]);
}

function renderGateNode(node) {
  const x = round(node.x);
  const y = round(node.y);
  const width = round(node.width);
  const height = round(node.height);
  const gateKind = node.gateKind || "blackbox";
  const ports = renderGatePorts(node, x, y, width);
  const timingClass = getTimingClass(node);
  const timingBadge = renderTimingBadge(node, x, y, width, height);
  const focusedRootClass = node.isActiveFocusedRoot
    ? " focused-root focused-root-active"
    : node.isFocusedRoot ? " focused-root" : "";
  const navigationHint = node.navigationTarget?.kind === "unit"
    ? `; double-click to open ${node.navigationTarget.id}`
    : "";
  const cellTitle = node.subtitle
    ? svgElement("title", {}, [svgText(`${node.subtitle}: ${node.label}${node.metadataText ? `; ${node.metadataText}` : ""}${navigationHint}`)])
    : null;
  const metadata = node.kind === "cell" && node.metadataText && getTimingBadgeLines(node).length === 0
    ? svgElement("text", {
      class: "node-meta", x: x + width / 2, y: y + height - 6, "text-anchor": "middle"
    }, [svgText(truncateText(node.metadataText, 34))])
    : null;
  const attributes = nodeAttributes(node, `node ${gateKind} ${node.kind}${timingClass}${focusedRootClass}`);
  if (node.navigationTarget) {
    attributes["data-navigation-kind"] = node.navigationTarget.kind;
    attributes["data-navigation-id"] = node.navigationTarget.id;
  }
  return svgElement("g", attributes, [
    cellTitle,
    svgElement("rect", { class: "node-shape", x, y, width, height }),
    ...ports,
    timingBadge,
    svgElement("text", {
      class: "gate-kind", x: x + width / 2, y: y + 22, "text-anchor": "middle"
    }, [svgText(node.title || gateKind.toUpperCase())]),
    svgElement("text", {
      class: "node-label", x: x + width / 2, y: y + 42, "text-anchor": "middle"
    }, [svgText(getLeafDisplayName(node.label))]),
    metadata
  ].filter(Boolean));
}

function nodeAttributes(node, className) {
  return {
    class: className,
    "data-node-id": node.id,
    "data-kind": node.kind,
    "data-label": node.label
  };
}

function truncateText(value, maxLength) {
  const text = String(value || "");
  return text.length <= maxLength ? text : `${text.slice(0, maxLength - 3)}...`;
}

function renderGatePorts(node, x, y, width) {
  return (node.ports || [])
    .flatMap((port) => {
      const px = round(x + port.x);
      const py = round(y + port.y);
      const isOutput = port.direction === "output";
      const isVerticalPort = port.side === "top" || port.side === "bottom";
      const labelX = isVerticalPort ? px : isOutput ? px - 6 : px + 6;
      const labelY = port.side === "top" ? py + 13 : port.side === "bottom" ? py - 7 : py + 3;
      const anchor = isVerticalPort ? "middle" : isOutput ? "end" : "start";
      const timing = node.timing?.pins?.[port.pin];
      const timingClass = timing ? (timing.slack < 0 ? " pin-critical" : " pin-timing") : "";
      const timingTitle = timing
        ? svgElement("title", {}, [svgText(`${port.pin}: at ${formatTimingValue(timing.at)}, rt ${formatTimingValue(timing.rt)}, slack ${formatTimingValue(timing.slack)}`)])
        : null;
      const marker = isOutput && node.outputBubble === true
        ? svgElement("circle", { class: `pin-bubble${timingClass}`, cx: round(x + width + 5), cy: py, r: 5 }, timingTitle ? [timingTitle] : [])
        : svgElement("circle", { class: `pin-dot${timingClass}`, cx: px, cy: py, r: 2.4 }, timingTitle ? [timingTitle] : []);

      return [marker, svgElement("text", {
        class: "pin-label", x: labelX, y: labelY, "text-anchor": anchor
      }, [svgText(port.pin)])];
    });
}

function getTimingClass(node) {
  if (!node.timing) {
    return "";
  }
  return node.timing.worstSlack < 0 ? " timing-critical" : " timing-annotated";
}

function renderTimingBadge(node, x, y, width, height) {
  const lines = getTimingBadgeLines(node);
  if (lines.length === 0) {
    return null;
  }
  const position = node.timing?.badgePosition || "bottom-right";
  const isLeft = position.endsWith("left");
  const isBottom = position.startsWith("bottom");
  const badgeX = round(isLeft ? x + 6 : x + width - 6);
  const badgeY = round(isBottom ? y + height - 8 - (lines.length - 1) * 11 : y + 14);
  const anchor = isLeft ? "start" : "end";
  const tspans = lines.map((line, index) => svgElement("tspan", {
    x: badgeX, dy: index === 0 ? 0 : 11
  }, [svgText(line)]));
  return svgElement("text", {
    class: `timing-badge timing-badge-${position}`, x: badgeX, y: badgeY, "text-anchor": anchor
  }, tspans);
}

function getTimingBadgeLines(node) {
  if (Array.isArray(node.timing?.badges)) {
    const badges = node.timing.badges;
    const byPin = new Map();
    for (const badge of badges) {
      if (!byPin.has(badge.pin)) {
        byPin.set(badge.pin, []);
      }
      byPin.get(badge.pin).push(`${badge.metric} ${formatTimingValue(badge.value)}`);
    }
    return [...byPin].map(([pin, values]) => `${pin} ${values.join(" ")}`);
  }
  if (node.timing?.badge) {
    return [node.timing.badge.label];
  }
  if (Number.isFinite(node.timing?.worstSlack)) {
    return [formatTimingValue(node.timing.worstSlack)];
  }
  return [];
}

function formatTimingValue(value) {
  if (!Number.isFinite(value)) {
    return "-";
  }
  return Number(value).toFixed(3);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function escapeAttr(value) {
  return escapeHtml(value).replaceAll('"', "&quot;");
}

function round(value) {
  return Math.round(value * 10) / 10;
}
